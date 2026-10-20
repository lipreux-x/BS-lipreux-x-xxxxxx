import {
  b64,
  CryptoError,
  generateDeviceSecret,
  generateMasterKey,
  lockGroupKey,
  openIdentity,
  openLocal,
  sealIdentity,
  sealLocal,
  unlockGroupKey,
  unwrapMasterKey,
  uptimeMs,
  wrapMasterKey,
  type GroupMeta,
  type Identity,
  type WrappedKey,
} from '@/crypto';
import { wipe } from '@/crypto/encoding';
import { checkLockout, FREE_ATTEMPTS, parseLockout, registerFailure, type LockoutState } from './lockout';

/*
 * Everything this phone keeps between launches, in the Keychain/Keystore
 * (SPEC §4.2). Nothing sensitive is stored in clear:
 *
 *   device_secret        random 32 bytes (never leaves the Keychain)
 *   master_wrapped       master key wrapped by Argon2id(app code + device_secret)
 *                        and the secure hardware's PRF (crypto/keywrap.ts)
 *   identity_sealed      identity secret keys, sealed with the master key
 *   account              { userId, username } (public data)
 *   lockout_app          failed-attempt counter for the app code
 *   group_<id>_v<n>      group key locked by group code + master key
 *   gsec_<id>            the group's wrapKey + keywords (from code + keywords),
 *                        sealed with the master key: opens key handouts
 *   meta_<id>            last verified group meta (name, admins, members,
 *                        revision) and its key version, sealed with the master key
 *   lockout_g_<id>       failed-attempt counter for that group's code
 *   codever_<id>         version of the group code the local lock uses
 *   pin_<userId>         a contact's public keys as first seen, sealed with
 *                        the master key: a key the server later swaps is refused
 *   groups               { <id>: highest key version } of every group this
 *                        phone keeps something for, to forget the ones that
 *                        are gone from the server (self-destructed, removed)
 *   wipe_after           wrong app codes in a row that erase everything
 *                        (SPEC §4.5), absent when the option is off
 *   bio                  "1" when opening the app with the fingerprint is on;
 *                        the master key copy itself is in the BiometricStore
 *   code_at              last time the app code was typed (wall clock, ms)
 *   no_screenshots       "1" when screenshots and screen recording are blocked
 */

/**
 * Where the fingerprint copy of the master key lives (services/biometrics.ts).
 * `load` makes the system ask for the finger; it throws or returns null when
 * the user cancels, fails, or the copy was invalidated.
 */
export interface BiometricStore {
  /** A fingerprint sensor with a finger enrolled. */
  available(): Promise<boolean>;
  /** Saving already asks for the finger (Android), so it proves the finger works. */
  readonly saveAsksFinger?: boolean;
  save(value: string): Promise<void>;
  load(): Promise<string | null>;
  clear(): Promise<void>;
}

/** The fingerprint opens the app only this long after the app code was last typed. */
export const BIOMETRIC_MAX_AGE_MS = 48 * 3_600_000;

/** Choices offered in Settings for the self-destruct option (SPEC §4.5). */
export const WIPE_AFTER_CHOICES = [10, 20] as const;

/** Minimal key/value interface, so the vault can be tested without a device. */
export interface SecretStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

export interface Account {
  userId: string;
  username: string;
}

export interface UnlockedVault {
  account: Account;
  identity: Identity;
  masterKey: Uint8Array;
}

/** What the group code + keywords give (crypto/groupSecret.ts), kept to open future handouts. */
export interface StoredGroupSecret {
  wrapKey: Uint8Array;
  keywords: string[];
  /** Version of the code it was derived from (bumped when an admin changes the code). */
  codeVersion: number;
}

/** A contact's keys as pinned on first sight. */
export interface PinnedKeys {
  signPublicKey: string;
  boxPublicKey: string;
}

/** `attemptsBeforeWipe`: wrong app codes left before the phone is erased, null when that option is off. */
export class LockedOutError extends Error {
  constructor(
    public readonly retryInMs: number,
    public readonly attemptsBeforeWipe: number | null = null,
  ) {
    super('locked_out');
    this.name = 'LockedOutError';
  }
}

export class WrongCodeError extends Error {
  constructor(
    public readonly attemptsBeforeDelay: number,
    public readonly attemptsBeforeWipe: number | null = null,
  ) {
    super('wrong_code');
    this.name = 'WrongCodeError';
  }
}

/** Too many wrong app codes with the self-destruct option on: everything on the phone was erased. */
export class WipedError extends Error {
  constructor() {
    super('wiped');
    this.name = 'WipedError';
  }
}

/** Key material computed before registering: the slow Argon2id step, no I/O. */
export interface PreparedVault {
  identity: Identity;
  deviceSecret: Uint8Array;
  masterKey: Uint8Array;
  appCodeWrap: WrappedKey;
}

/**
 * Runs the expensive part of account creation up front, so the invite is
 * only consumed on the server once the phone is ready to save the account.
 */
export async function prepareVault(identity: Identity, appCode: string): Promise<PreparedVault> {
  const deviceSecret = generateDeviceSecret();
  const masterKey = generateMasterKey();
  return { identity, deviceSecret, masterKey, appCodeWrap: await wrapMasterKey(masterKey, appCode, deviceSecret) };
}

const K = {
  deviceSecret: 'bs.device_secret',
  master: 'bs.master_wrapped',
  identity: 'bs.identity_sealed',
  account: 'bs.account',
  lockoutApp: 'bs.lockout_app',
  group: (id: string, v: number) => `bs.group_${id}_v${v}`,
  groupSecret: (id: string) => `bs.gsec_${id}`,
  meta: (id: string) => `bs.meta_${id}`,
  lockoutGroup: (id: string) => `bs.lockout_g_${id}`,
  codeVersion: (id: string) => `bs.codever_${id}`,
  pin: (userId: string) => `bs.pin_${userId}`,
  groups: 'bs.groups',
  wipeAfter: 'bs.wipe_after',
  bio: 'bs.bio',
  codeAt: 'bs.code_at',
  noScreenshots: 'bs.no_screenshots',
};

export class Vault {
  constructor(
    private readonly store: SecretStore,
    private readonly now: () => number = Date.now,
    private readonly uptime: () => number | null = uptimeMs,
    private readonly bio: BiometricStore | null = null,
  ) {}

  async account(): Promise<Account | null> {
    const raw = await this.store.get(K.account);
    return raw ? (JSON.parse(raw) as Account) : null;
  }

  /** First launch, after the server accepted the registration. */
  async create(account: Account, identity: Identity, appCode: string): Promise<UnlockedVault> {
    return this.commit(account, await prepareVault(identity, appCode));
  }

  /** Persists a prepared vault once the server has accepted the account. */
  async commit(account: Account, { identity, appCodeWrap: wrapped, deviceSecret, masterKey }: PreparedVault): Promise<UnlockedVault> {
    await this.store.set(K.deviceSecret, b64.encode(deviceSecret));
    await this.store.set(K.master, JSON.stringify(wrapped));
    await this.store.set(K.identity, sealIdentity(identity, masterKey));
    await this.store.set(K.lockoutApp, JSON.stringify({ failures: 0, lockedUntil: 0 }));
    // Written last: its presence means "an account exists on this phone".
    await this.store.set(K.account, JSON.stringify(account));
    return { account, identity, masterKey };
  }

  /** Throws LockedOutError while delayed, WrongCodeError on a wrong code. */
  async unlock(appCode: string): Promise<UnlockedVault> {
    const [account, secret, master, sealedIdentity] = await Promise.all([
      this.account(),
      this.store.get(K.deviceSecret),
      this.store.get(K.master),
      this.store.get(K.identity),
    ]);
    if (!account || !secret || !master || !sealedIdentity) throw new Error('no_account');

    const masterKey = await this.withLockout(
      K.lockoutApp,
      () => unwrapMasterKey(JSON.parse(master) as WrappedKey, appCode, b64.decode(secret)),
      await this.wipeAfter(),
    );
    await this.store.set(K.codeAt, String(this.now()));
    return { account, identity: openIdentity(sealedIdentity, masterKey), masterKey };
  }

  /** False when an account is recorded but its keys are gone (a wipe was cut short). */
  async intact(): Promise<boolean> {
    const [secret, master, identity] = await Promise.all([
      this.store.get(K.deviceSecret),
      this.store.get(K.master),
      this.store.get(K.identity),
    ]);
    return !!secret && !!master && !!identity;
  }

  // ---- self-destruct, screenshots ----------------------------------------------------

  /** Wrong app codes in a row that erase the phone, or null (option off). */
  async wipeAfter(): Promise<number | null> {
    const n = Number(await this.store.get(K.wipeAfter));
    return Number.isInteger(n) && n > 0 ? n : null;
  }

  async setWipeAfter(attempts: number | null) {
    if (attempts === null) await this.store.delete(K.wipeAfter);
    else await this.store.set(K.wipeAfter, String(attempts));
  }

  /** Screenshots and screen recording blocked in the app (a per-phone choice, off by default). */
  async screenshotsBlocked(): Promise<boolean> {
    return (await this.store.get(K.noScreenshots)) === '1';
  }

  async setScreenshotsBlocked(blocked: boolean) {
    if (blocked) await this.store.set(K.noScreenshots, '1');
    else await this.store.delete(K.noScreenshots);
  }

  // ---- biometrics ------------------------------------------------------------------

  /** A fingerprint sensor with a finger enrolled on this phone. */
  async biometricsAvailable(): Promise<boolean> {
    return (await this.bio?.available()) ?? false;
  }

  async biometricsEnabled(): Promise<boolean> {
    return (await this.store.get(K.bio)) === '1';
  }

  /**
   * The fingerprint may open the app now: option on, and the app code typed
   * in the last 48 h (so it is never forgotten, and a phone left aside long
   * enough needs the code again).
   */
  async canUseBiometrics(): Promise<boolean> {
    if (!(await this.biometricsEnabled()) || !(await this.biometricsAvailable())) return false;
    const at = Number(await this.store.get(K.codeAt));
    const age = this.now() - at;
    return Number.isFinite(at) && at > 0 && age >= 0 && age < BIOMETRIC_MAX_AGE_MS;
  }

  /**
   * Turns the option on. The app code is asked again (and counts toward the
   * lockout like on the lock screen); the system then asks for the finger
   * once, to check it works before relying on it (on Android, saving the
   * copy is that check: no second prompt).
   */
  async enableBiometrics(appCode: string): Promise<void> {
    if (!this.bio || !(await this.biometricsAvailable())) throw new Error('biometrics_unavailable');
    const { masterKey, identity } = await this.unlock(appCode);
    try {
      await this.bio.save(b64.encode(masterKey));
      if (!this.bio.saveAsksFinger && (await this.bio.load()) !== b64.encode(masterKey)) throw new Error('biometrics_failed');
    } catch (e) {
      await this.bio.clear().catch(() => {});
      throw e;
    } finally {
      // A second copy of the keys, only needed to check the code: out of memory now.
      for (const k of [masterKey, identity.boxSecretKey, identity.signSecretKey]) wipe(k);
    }
    await this.store.set(K.bio, '1');
  }

  async disableBiometrics() {
    await this.store.delete(K.bio);
    await this.bio?.clear().catch(() => {});
  }

  /**
   * Opens the vault with the fingerprint. Null when not allowed right now,
   * cancelled or failed: the app code is then asked. A copy the system
   * invalidated (a finger was added) turns the option off.
   */
  async unlockWithBiometrics(): Promise<UnlockedVault | null> {
    if (!this.bio || !(await this.canUseBiometrics())) return null;
    const [account, sealedIdentity] = await Promise.all([this.account(), this.store.get(K.identity)]);
    if (!account || !sealedIdentity) return null;
    let raw: string | null;
    try {
      raw = await this.bio.load();
    } catch {
      return null; // cancelled, failed, locked out by the system: the code is there
    }
    if (!raw) {
      await this.disableBiometrics();
      return null;
    }
    try {
      const masterKey = b64.decode(raw);
      return { account, identity: openIdentity(sealedIdentity, masterKey), masterKey };
    } catch {
      await this.disableBiometrics();
      return null;
    }
  }

  async appLockout(): Promise<LockoutState> {
    return parseLockout(await this.store.get(K.lockoutApp));
  }

  /** Time left before the app code can be tried again (uptime clock). */
  async appLockoutRemainingMs(): Promise<number> {
    return checkLockout(await this.appLockout(), this.now(), this.uptime()).remaining;
  }

  /** Re-wraps the master key under a new app code (the old one is required). */
  async changeAppCode(oldCode: string, newCode: string): Promise<void> {
    const { masterKey } = await this.unlock(oldCode);
    const secret = (await this.store.get(K.deviceSecret))!;
    await this.store.set(K.master, JSON.stringify(await wrapMasterKey(masterKey, newCode, b64.decode(secret))));
  }

  // ---- groups ------------------------------------------------------------------

  async hasGroupKey(groupId: string, keyVersion: number): Promise<boolean> {
    return (await this.store.get(K.group(groupId, keyVersion))) !== null;
  }

  /** Highest key version (≤ upTo) locked on this phone, or null. */
  async latestGroupKeyVersion(groupId: string, upTo: number): Promise<number | null> {
    for (let v = upTo; v >= 1; v--) if (await this.hasGroupKey(groupId, v)) return v;
    return null;
  }

  async deleteGroupKey(groupId: string, keyVersion: number) {
    await this.store.delete(K.group(groupId, keyVersion));
  }

  /** After leaving: every local key version (≤ upTo), the secret, the meta and the attempt counter. */
  async forgetGroup(groupId: string, upTo: number) {
    for (let v = 1; v <= upTo; v++) await this.store.delete(K.group(groupId, v));
    await this.store.delete(K.groupSecret(groupId));
    await this.store.delete(K.meta(groupId));
    await this.store.delete(K.lockoutGroup(groupId));
    await this.store.delete(K.codeVersion(groupId));
    const known = await this.knownGroups();
    if (groupId in known) {
      delete known[groupId];
      await this.store.set(K.groups, JSON.stringify(known));
    }
  }

  /** Groups this phone keeps something for, with the highest key version saved (0: joined, no key yet). */
  async knownGroups(): Promise<Record<string, number>> {
    const raw = await this.store.get(K.groups);
    return raw ? (JSON.parse(raw) as Record<string, number>) : {};
  }

  private async remember(groupId: string, keyVersion: number) {
    const known = await this.knownGroups();
    if (!(groupId in known) || known[groupId]! < keyVersion) {
      known[groupId] = keyVersion;
      await this.store.set(K.groups, JSON.stringify(known));
    }
  }

  /** Version of the group code the local lock uses (1 until the admin first changes it). */
  async codeVersion(groupId: string): Promise<number> {
    return Number((await this.store.get(K.codeVersion(groupId))) ?? 1);
  }

  async setCodeVersion(groupId: string, version: number) {
    await this.store.set(K.codeVersion(groupId), String(version));
  }

  async saveGroupKey(groupId: string, keyVersion: number, groupKey: Uint8Array, groupCode: string, masterKey: Uint8Array) {
    const locked = await lockGroupKey(groupKey, groupCode, masterKey, groupId, keyVersion);
    await this.store.set(K.group(groupId, keyVersion), JSON.stringify(locked));
    await this.remember(groupId, keyVersion);
  }

  /** Throws LockedOutError / WrongCodeError like the app code. */
  async openGroupKey(groupId: string, keyVersion: number, groupCode: string, masterKey: Uint8Array): Promise<Uint8Array> {
    const raw = await this.store.get(K.group(groupId, keyVersion));
    if (!raw) throw new Error('no_group_key');
    return this.withLockout(K.lockoutGroup(groupId), () =>
      unlockGroupKey(JSON.parse(raw) as WrappedKey, groupCode, masterKey, groupId, keyVersion),
    );
  }

  /**
   * Counts a group code attempt that was checked some other way (deriving the
   * group secret on a first unlock): same counter and delays as a local key.
   */
  async checkGroupCode<T>(groupId: string, fn: () => Promise<T>): Promise<T> {
    return this.withLockout(K.lockoutGroup(groupId), fn);
  }

  async saveGroupSecret(groupId: string, secret: StoredGroupSecret, masterKey: Uint8Array) {
    const json = { wrapKey: b64.encode(secret.wrapKey), keywords: secret.keywords, codeVersion: secret.codeVersion };
    await this.store.set(K.groupSecret(groupId), sealLocal(json, `gsec/${groupId}`, masterKey));
    await this.remember(groupId, 0);
  }

  async groupSecret(groupId: string, masterKey: Uint8Array): Promise<StoredGroupSecret | null> {
    const raw = await this.store.get(K.groupSecret(groupId));
    if (!raw) return null;
    try {
      const o = openLocal<{ wrapKey: string; keywords: string[]; codeVersion: number }>(raw, `gsec/${groupId}`, masterKey);
      return { wrapKey: b64.decode(o.wrapKey), keywords: o.keywords, codeVersion: o.codeVersion };
    } catch {
      return null;
    }
  }

  /** The last meta this phone verified, with the key version it was read under. */
  async saveMeta(groupId: string, meta: GroupMeta, keyVersion: number, masterKey: Uint8Array) {
    await this.store.set(K.meta(groupId), sealLocal({ meta, keyVersion }, `meta/${groupId}`, masterKey));
  }

  async metaRecord(groupId: string, masterKey: Uint8Array): Promise<{ meta: GroupMeta; keyVersion: number } | null> {
    const raw = await this.store.get(K.meta(groupId));
    if (!raw) return null;
    try {
      return openLocal<{ meta: GroupMeta; keyVersion: number }>(raw, `meta/${groupId}`, masterKey);
    } catch {
      return null;
    }
  }

  async meta(groupId: string, masterKey: Uint8Array): Promise<GroupMeta | null> {
    return (await this.metaRecord(groupId, masterKey))?.meta ?? null;
  }

  /**
   * Erases the account from this phone: every item the vault can name. The
   * device secret, the wrapped master key and its biometric copy go first:
   * without them every other record is unreadable, so a wipe cut short still
   * leaves nothing to recover (crypto-shredding). Safe to call again to
   * finish an interrupted wipe. (A contact pin left behind is sealed with the
   * master key, gone with it.)
   */
  async wipeAll() {
    const known = await this.knownGroups().catch(() => ({}) as Record<string, number>);
    await this.store.delete(K.deviceSecret);
    await this.store.delete(K.master);
    await this.disableBiometrics();
    for (const key of [K.account, K.identity, K.lockoutApp, K.wipeAfter, K.codeAt]) await this.store.delete(key);
    for (const [id, upTo] of Object.entries(known)) await this.forgetGroup(id, upTo);
    await this.store.delete(K.groups);
  }

  // ---- contacts ------------------------------------------------------------------

  async pinned(userId: string, masterKey: Uint8Array): Promise<PinnedKeys | null> {
    const raw = await this.store.get(K.pin(userId));
    if (!raw) return null;
    try {
      return openLocal<PinnedKeys>(raw, `pin/${userId}`, masterKey);
    } catch {
      return null;
    }
  }

  async pin(userId: string, keys: PinnedKeys, masterKey: Uint8Array) {
    await this.store.set(K.pin(userId), sealLocal(keys, `pin/${userId}`, masterKey));
  }

  // ---- internals -----------------------------------------------------------------

  /**
   * The attempt is counted as a failure BEFORE it runs and cleared after a
   * success: killing the app mid-attempt does not give a free guess.
   */
  /**
   * `wipeAt` (app code only): failures in a row that erase the phone, or
   * null. An attempt cut short (app killed) still counts toward it.
   */
  private async withLockout<T>(key: string, fn: () => Promise<T>, wipeAt: number | null = null): Promise<T> {
    const state = parseLockout(await this.store.get(key));
    const left = (failures: number) => (wipeAt === null ? null : Math.max(0, wipeAt - failures));
    if (wipeAt !== null && state.failures >= wipeAt) {
      await this.wipeAll();
      throw new WipedError();
    }
    const { remaining, rebased } = checkLockout(state, this.now(), this.uptime());
    if (rebased) await this.store.set(key, JSON.stringify(rebased));
    if (remaining > 0) throw new LockedOutError(remaining, left(state.failures));
    const next = registerFailure(state, this.now(), this.uptime());
    await this.store.set(key, JSON.stringify(next));
    try {
      const result = await fn();
      await this.store.set(key, JSON.stringify({ failures: 0, lockedUntil: 0 }));
      return result;
    } catch (e) {
      if (!(e instanceof CryptoError)) {
        await this.store.set(key, JSON.stringify(state)); // not a wrong code: give the attempt back
        throw e;
      }
      if (wipeAt !== null && next.failures >= wipeAt) {
        await this.wipeAll();
        throw new WipedError();
      }
      const { remaining: wait } = checkLockout(next, this.now(), this.uptime());
      if (wait > 0) throw new LockedOutError(wait, left(next.failures));
      throw new WrongCodeError(FREE_ATTEMPTS - next.failures, left(next.failures));
    }
  }
}
