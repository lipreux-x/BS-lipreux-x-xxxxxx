import * as aead from './aead';
import { b64, frame, u32, utf8, wipe } from './encoding';
import { attempt, CryptoError } from './errors';
import { backend, sodium } from './sodium';

/*
 * Local key wrapping (§4.2, §4.4).
 *
 * A 6-digit code has only 10^6 values, so it is never the sole protection of
 * a key: the app code is always combined with `deviceSecret`, a random value
 * kept in the Keychain/Keystore, and the group code wrap is itself wrapped by
 * the master key. A wrong code is detected by AEAD authentication failure —
 * no hash of the code is stored anywhere on the device.
 */

// Argon2id cost, recorded in every WrappedKey so a key always unwraps with
// the parameters it was wrapped with.
// - Native libsodium: tuned for mid-range phones (~0.3–0.5 s).
// - JS backend (Expo Go, no JIT): 64 MiB would take tens of seconds, so a
//   lighter cost is used. The app-code key also mixes in the 256-bit device
//   secret from the Keychain, so offline guessing still needs that secret.
export interface Argon2Params {
  ops: number;
  mem: number; // bytes
}
export const ARGON2_NATIVE: Argon2Params = { ops: 3, mem: 64 * 1024 * 1024 };
// ~0.9 s for 1 MiB / 2 passes measured with `node --jitless` (4 MiB / 3 passes: 6.3 s).
export const ARGON2_JS: Argon2Params = { ops: 2, mem: 1024 * 1024 };
const ARGON2_DEFAULT = backend === 'libsodium' ? ARGON2_NATIVE : ARGON2_JS;
// Bounds for stored params: a tampered record must not make us allocate GBs.
const MIN_OPS = 1;
const MAX_OPS = 10;
const MIN_MEM = 1024 * 1024;
const MAX_MEM = 256 * 1024 * 1024;
const SALT_BYTES = 16;

/** Serializable form, stored as JSON in expo-secure-store. */
export interface WrappedKey {
  v: 1;
  salt: string;
  box: string; // nonce || ciphertext
  ops?: number; // Argon2id params; absent = ARGON2_NATIVE (records written before they were stored)
  mem?: number;
}

export const APP_CODE_PATTERN = /^\d{6}$/;
// MVP: 6+ digits. Longer alphanumeric codes are already accepted.
export const GROUP_CODE_PATTERN = /^[0-9A-Za-z]{6,64}$/;

export function isValidAppCode(code: string): boolean {
  return APP_CODE_PATTERN.test(code);
}

export function isValidGroupCode(code: string): boolean {
  return GROUP_CODE_PATTERN.test(code);
}

export function generateDeviceSecret(): Uint8Array {
  return aead.randomKey();
}

export function generateMasterKey(): Uint8Array {
  return aead.randomKey();
}

function deriveCodeKey(code: string, salt: Uint8Array, pepper: Uint8Array, p: Argon2Params): Uint8Array {
  return sodium.crypto_pwhash(
    aead.KEY_BYTES,
    frame(utf8.encode(code), pepper),
    salt,
    p.ops,
    p.mem,
    sodium.crypto_pwhash_ALG_ARGON2ID13,
  );
}

// ---- Master key, unlocked by the app code ----------------------------------

const MASTER_AD = utf8.encode('bs/v1/master-key');

export function wrapMasterKey(masterKey: Uint8Array, appCode: string, deviceSecret: Uint8Array): WrappedKey {
  if (!isValidAppCode(appCode) || deviceSecret.length !== aead.KEY_BYTES) throw new CryptoError('INVALID_INPUT');
  const salt = aead.randomBytes(SALT_BYTES);
  const p = ARGON2_DEFAULT;
  const kek = deriveCodeKey(appCode, salt, deviceSecret, p);
  try {
    return { v: 1, salt: b64.encode(salt), box: b64.encode(aead.seal(kek, masterKey, MASTER_AD)), ...p };
  } finally {
    wipe(kek);
  }
}

/** Throws CryptoError('DECRYPT_FAILED') on a wrong code. */
export function unwrapMasterKey(wrapped: WrappedKey, appCode: string, deviceSecret: Uint8Array): Uint8Array {
  if (!isValidAppCode(appCode)) throw new CryptoError('DECRYPT_FAILED');
  const { salt, box, params } = parseWrapped(wrapped);
  const kek = deriveCodeKey(appCode, salt, deviceSecret, params);
  try {
    return aead.open(kek, box, MASTER_AD);
  } finally {
    wipe(kek);
  }
}

// ---- Group key, unlocked by the group code AND the master key ---------------

const groupInnerAd = (groupId: string, keyVersion: number) =>
  frame(utf8.encode('bs/v1/group-key/code'), utf8.encode(groupId), u32(keyVersion));
const groupOuterAd = (groupId: string, keyVersion: number) =>
  frame(utf8.encode('bs/v1/group-key/master'), utf8.encode(groupId), u32(keyVersion));

export function lockGroupKey(
  groupKey: Uint8Array,
  groupCode: string,
  masterKey: Uint8Array,
  groupId: string,
  keyVersion: number,
): WrappedKey {
  if (!isValidGroupCode(groupCode)) throw new CryptoError('INVALID_INPUT');
  const salt = aead.randomBytes(SALT_BYTES);
  const p = ARGON2_DEFAULT;
  const codeKey = deriveCodeKey(groupCode, salt, new Uint8Array(0), p);
  try {
    const inner = aead.seal(codeKey, groupKey, groupInnerAd(groupId, keyVersion));
    const outer = aead.seal(masterKey, inner, groupOuterAd(groupId, keyVersion));
    return { v: 1, salt: b64.encode(salt), box: b64.encode(outer), ...p };
  } finally {
    wipe(codeKey);
  }
}

/** Throws CryptoError('DECRYPT_FAILED') on a wrong group code or master key. */
export function unlockGroupKey(
  locked: WrappedKey,
  groupCode: string,
  masterKey: Uint8Array,
  groupId: string,
  keyVersion: number,
): Uint8Array {
  if (!isValidGroupCode(groupCode)) throw new CryptoError('DECRYPT_FAILED');
  const { salt, box, params } = parseWrapped(locked);
  // Outer layer first: no Argon2 work is spent if the master key is wrong.
  const inner = aead.open(masterKey, box, groupOuterAd(groupId, keyVersion));
  const codeKey = deriveCodeKey(groupCode, salt, new Uint8Array(0), params);
  try {
    return aead.open(codeKey, inner, groupInnerAd(groupId, keyVersion));
  } finally {
    wipe(codeKey);
    wipe(inner);
  }
}

function parseWrapped(w: WrappedKey): { salt: Uint8Array; box: Uint8Array; params: Argon2Params } {
  if (w?.v !== 1) throw new CryptoError('INVALID_INPUT');
  const parsed = attempt('INVALID_INPUT', () => ({ salt: b64.decode(w.salt), box: b64.decode(w.box) }));
  if (parsed.salt.length !== SALT_BYTES) throw new CryptoError('INVALID_INPUT');
  const params = { ops: w.ops ?? ARGON2_NATIVE.ops, mem: w.mem ?? ARGON2_NATIVE.mem };
  const ok =
    Number.isInteger(params.ops) && params.ops >= MIN_OPS && params.ops <= MAX_OPS &&
    Number.isInteger(params.mem) && params.mem >= MIN_MEM && params.mem <= MAX_MEM && params.mem % 1024 === 0;
  if (!ok) throw new CryptoError('INVALID_INPUT');
  return { ...parsed, params };
}
