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
 */

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

export class LockedOutError extends Error {
  constructor(public readonly retryInMs: number) {
    super('locked_out');
    this.name = 'LockedOutError';
  }
}

export class WrongCodeError extends Error {
  constructor(public readonly attemptsBeforeDelay: number) {
    super('wrong_code');
    this.name = 'WrongCodeError';
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
};

export class Vault {
  constructor(
    private readonly store: SecretStore,
    private readonly now: () => number = Date.now,
    private readonly uptime: () => number | null = uptimeMs,
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

    const masterKey = await this.withLockout(K.lockoutApp, () =>
      unwrapMasterKey(JSON.parse(master) as WrappedKey, appCode, b64.decode(secret)),
    );
    return { account, identity: openIdentity(sealedIdentity, masterKey), masterKey };
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
   * Erases the account from this phone: every item the vault can name. (A
   * contact pin left behind is sealed with the master key, gone with it.)
   */
  async wipeAll() {
    for (const [id, upTo] of Object.entries(await this.knownGroups())) await this.forgetGroup(id, upTo);
    for (const key of [K.account, K.identity, K.master, K.deviceSecret, K.lockoutApp, K.groups]) await this.store.delete(key);
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
  private async withLockout<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const state = parseLockout(await this.store.get(key));
    const { remaining, rebased } = checkLockout(state, this.now(), this.uptime());
    if (rebased) await this.store.set(key, JSON.stringify(rebased));
    if (remaining > 0) throw new LockedOutError(remaining);
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
      const { remaining: wait } = checkLockout(next, this.now(), this.uptime());
      if (wait > 0) throw new LockedOutError(wait);
      throw new WrongCodeError(FREE_ATTEMPTS - next.failures);
    }
  }
}
