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
  wrapMasterKey,
  type GroupMeta,
  type Identity,
  type WrappedKey,
} from '@/crypto';
import { FREE_ATTEMPTS, parseLockout, registerFailure, remainingMs, type LockoutState } from './lockout';

/*
 * Everything this phone keeps between launches, in the Keychain/Keystore
 * (SPEC §4.2). Nothing sensitive is stored in clear:
 *
 *   device_secret        random 32 bytes (never leaves the Keychain)
 *   master_wrapped       master key wrapped by Argon2id(app code + device_secret)
 *   identity_sealed      identity secret keys, sealed with the master key
 *   account              { userId, username } (public data)
 *   lockout_app          failed-attempt counter for the app code
 *   group_<id>_v<n>      group key locked by group code + master key
 *   meta_<id>            decrypted group name, sealed with the master key
 *   lockout_g_<id>       failed-attempt counter for that group's code
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
export function prepareVault(identity: Identity, appCode: string): PreparedVault {
  const deviceSecret = generateDeviceSecret();
  const masterKey = generateMasterKey();
  return { identity, deviceSecret, masterKey, appCodeWrap: wrapMasterKey(masterKey, appCode, deviceSecret) };
}

const K = {
  deviceSecret: 'bs.device_secret',
  master: 'bs.master_wrapped',
  identity: 'bs.identity_sealed',
  account: 'bs.account',
  lockoutApp: 'bs.lockout_app',
  group: (id: string, v: number) => `bs.group_${id}_v${v}`,
  meta: (id: string) => `bs.meta_${id}`,
  lockoutGroup: (id: string) => `bs.lockout_g_${id}`,
};

export class Vault {
  constructor(
    private readonly store: SecretStore,
    private readonly now: () => number = Date.now,
  ) {}

  async account(): Promise<Account | null> {
    const raw = await this.store.get(K.account);
    return raw ? (JSON.parse(raw) as Account) : null;
  }

  /** First launch, after the server accepted the registration. */
  async create(account: Account, identity: Identity, appCode: string): Promise<UnlockedVault> {
    return this.commit(account, prepareVault(identity, appCode));
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

  /** Re-wraps the master key under a new app code (the old one is required). */
  async changeAppCode(oldCode: string, newCode: string): Promise<void> {
    const { masterKey } = await this.unlock(oldCode);
    const secret = (await this.store.get(K.deviceSecret))!;
    await this.store.set(K.master, JSON.stringify(wrapMasterKey(masterKey, newCode, b64.decode(secret))));
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

  /** After leaving: every local key version (≤ upTo), the meta and the attempt counter. */
  async forgetGroup(groupId: string, upTo: number) {
    for (let v = 1; v <= upTo; v++) await this.store.delete(K.group(groupId, v));
    await this.store.delete(K.meta(groupId));
    await this.store.delete(K.lockoutGroup(groupId));
  }

  async saveGroupKey(groupId: string, keyVersion: number, groupKey: Uint8Array, groupCode: string, masterKey: Uint8Array) {
    const locked = lockGroupKey(groupKey, groupCode, masterKey, groupId, keyVersion);
    await this.store.set(K.group(groupId, keyVersion), JSON.stringify(locked));
  }

  /** Throws LockedOutError / WrongCodeError like the app code. */
  async openGroupKey(groupId: string, keyVersion: number, groupCode: string, masterKey: Uint8Array): Promise<Uint8Array> {
    const raw = await this.store.get(K.group(groupId, keyVersion));
    if (!raw) throw new Error('no_group_key');
    return this.withLockout(K.lockoutGroup(groupId), () =>
      unlockGroupKey(JSON.parse(raw) as WrappedKey, groupCode, masterKey, groupId, keyVersion),
    );
  }

  async saveMeta(groupId: string, meta: GroupMeta, masterKey: Uint8Array) {
    await this.store.set(K.meta(groupId), sealLocal(meta, `meta/${groupId}`, masterKey));
  }

  async meta(groupId: string, masterKey: Uint8Array): Promise<GroupMeta | null> {
    const raw = await this.store.get(K.meta(groupId));
    if (!raw) return null;
    try {
      return openLocal<GroupMeta>(raw, `meta/${groupId}`, masterKey);
    } catch {
      return null;
    }
  }

  // ---- internals -----------------------------------------------------------------

  private async withLockout<T>(key: string, fn: () => T): Promise<T> {
    const state = parseLockout(await this.store.get(key));
    const wait = remainingMs(state, this.now());
    if (wait > 0) throw new LockedOutError(wait);
    try {
      const result = fn();
      if (state.failures > 0) await this.store.set(key, JSON.stringify({ failures: 0, lockedUntil: 0 }));
      return result;
    } catch (e) {
      if (!(e instanceof CryptoError)) throw e;
      const next = registerFailure(state, this.now());
      await this.store.set(key, JSON.stringify(next));
      if (next.lockedUntil > 0) throw new LockedOutError(remainingMs(next, this.now()));
      throw new WrongCodeError(FREE_ATTEMPTS - next.failures);
    }
  }
}
