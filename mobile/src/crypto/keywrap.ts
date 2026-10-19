import * as aead from './aead';
import { b64, frame, u32, utf8, wipe } from './encoding';
import { attempt, CryptoError } from './errors';
import { argon2id, argon2Params, devicePrf, hasNativeCrypto, MAX_MEM, MAX_OPS, type Argon2Params } from './kdf';
import { sodium } from './sodium';

export type { Argon2Params } from './kdf';

/*
 * Local key wrapping (§4.2, §4.4).
 *
 * A 6-digit code has only 10^6 values, so it is never the sole protection of
 * a key:
 * - the master key's wrap mixes the app code with `deviceSecret` (random,
 *   in the Keychain/Keystore) through Argon2id, then with a PRF of the
 *   phone's secure hardware (Secure Enclave / Keystore). A copy of the app's
 *   storage is not enough to guess the code: every guess needs this phone,
 *   where the attempt counter applies;
 * - the group code wrap is itself wrapped by the master key.
 * A wrong code is detected by AEAD authentication failure: no hash of the
 * code is stored anywhere on the device.
 */

const SALT_BYTES = 16;
// Floor for records read back: a tampered record must not lower the cost.
const MIN_OPS = 3;
const MIN_MEM = 64 * 1024 * 1024;

/** Serializable form, stored as JSON in expo-secure-store. */
export interface WrappedKey {
  v: 2;
  salt: string;
  box: string; // nonce || ciphertext
  ops: number; // Argon2id params it was wrapped with
  mem: number;
  /** The hardware PRF is mixed in (false only where the native module is absent: tests). */
  hw?: boolean;
}

export const APP_CODE_PATTERN = /^\d{6}$/;
// 6+ characters; longer alphanumeric codes are accepted too.
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

const deriveCodeKey = (code: string, salt: Uint8Array, pepper: Uint8Array, p: Argon2Params) =>
  argon2id(aead.KEY_BYTES, frame(utf8.encode(code), pepper), salt, p);

// ---- Master key, unlocked by the app code ----------------------------------

const MASTER_AD = utf8.encode('bs/v2/master-key');

/** Argon2id(code, device secret), then the hardware PRF of it: the key-encryption key. */
async function masterKek(appCode: string, deviceSecret: Uint8Array, salt: Uint8Array, p: Argon2Params, hw: boolean): Promise<Uint8Array> {
  const k1 = await deriveCodeKey(appCode, salt, deviceSecret, p);
  if (!hw) return k1;
  const k2 = await devicePrf(frame(utf8.encode('bs/v2/app-code'), k1));
  if (!k2) {
    wipe(k1);
    throw new CryptoError('INVALID_INPUT'); // wrapped on a phone with secure hardware, opened without
  }
  try {
    return sodium.crypto_generichash(aead.KEY_BYTES, frame(utf8.encode('bs/v2/kek'), k1, k2), null);
  } finally {
    wipe(k1);
    wipe(k2);
  }
}

export async function wrapMasterKey(masterKey: Uint8Array, appCode: string, deviceSecret: Uint8Array): Promise<WrappedKey> {
  if (!isValidAppCode(appCode) || deviceSecret.length !== aead.KEY_BYTES) throw new CryptoError('INVALID_INPUT');
  const salt = aead.randomBytes(SALT_BYTES);
  const p = argon2Params();
  const hw = hasNativeCrypto;
  const kek = await masterKek(appCode, deviceSecret, salt, p, hw);
  try {
    return { v: 2, salt: b64.encode(salt), box: b64.encode(aead.seal(kek, masterKey, MASTER_AD)), ...p, hw };
  } finally {
    wipe(kek);
  }
}

/** Throws CryptoError('DECRYPT_FAILED') on a wrong code. */
export async function unwrapMasterKey(wrapped: WrappedKey, appCode: string, deviceSecret: Uint8Array): Promise<Uint8Array> {
  if (!isValidAppCode(appCode)) throw new CryptoError('DECRYPT_FAILED');
  const { salt, box, params } = parseWrapped(wrapped);
  const kek = await masterKek(appCode, deviceSecret, salt, params, wrapped.hw === true);
  try {
    return aead.open(kek, box, MASTER_AD);
  } finally {
    wipe(kek);
  }
}

// ---- Group key, unlocked by the group code AND the master key ---------------

const groupInnerAd = (groupId: string, keyVersion: number) =>
  frame(utf8.encode('bs/v2/group-key/code'), utf8.encode(groupId), u32(keyVersion));
const groupOuterAd = (groupId: string, keyVersion: number) =>
  frame(utf8.encode('bs/v2/group-key/master'), utf8.encode(groupId), u32(keyVersion));

export async function lockGroupKey(
  groupKey: Uint8Array,
  groupCode: string,
  masterKey: Uint8Array,
  groupId: string,
  keyVersion: number,
): Promise<WrappedKey> {
  if (!isValidGroupCode(groupCode)) throw new CryptoError('INVALID_INPUT');
  const salt = aead.randomBytes(SALT_BYTES);
  const p = argon2Params();
  const codeKey = await deriveCodeKey(groupCode, salt, new Uint8Array(0), p);
  try {
    const inner = aead.seal(codeKey, groupKey, groupInnerAd(groupId, keyVersion));
    const outer = aead.seal(masterKey, inner, groupOuterAd(groupId, keyVersion));
    return { v: 2, salt: b64.encode(salt), box: b64.encode(outer), ...p };
  } finally {
    wipe(codeKey);
  }
}

/** Throws CryptoError('DECRYPT_FAILED') on a wrong group code or master key. */
export async function unlockGroupKey(
  locked: WrappedKey,
  groupCode: string,
  masterKey: Uint8Array,
  groupId: string,
  keyVersion: number,
): Promise<Uint8Array> {
  if (!isValidGroupCode(groupCode)) throw new CryptoError('DECRYPT_FAILED');
  const { salt, box, params } = parseWrapped(locked);
  // Outer layer first: no Argon2 work is spent if the master key is wrong.
  const inner = aead.open(masterKey, box, groupOuterAd(groupId, keyVersion));
  const codeKey = await deriveCodeKey(groupCode, salt, new Uint8Array(0), params);
  try {
    return aead.open(codeKey, inner, groupInnerAd(groupId, keyVersion));
  } finally {
    wipe(codeKey);
    wipe(inner);
  }
}

function parseWrapped(w: WrappedKey): { salt: Uint8Array; box: Uint8Array; params: Argon2Params } {
  if (w?.v !== 2) throw new CryptoError('INVALID_INPUT');
  const parsed = attempt('INVALID_INPUT', () => ({ salt: b64.decode(w.salt), box: b64.decode(w.box) }));
  if (parsed.salt.length !== SALT_BYTES) throw new CryptoError('INVALID_INPUT');
  const params = { ops: w.ops, mem: w.mem };
  const floor = argon2Params(); // production cost, or the test cost under Jest
  const ok =
    Number.isInteger(params.ops) && params.ops >= Math.min(MIN_OPS, floor.ops) && params.ops <= MAX_OPS &&
    Number.isInteger(params.mem) && params.mem >= Math.min(MIN_MEM, floor.mem) && params.mem <= MAX_MEM && params.mem % 1024 === 0;
  if (!ok) throw new CryptoError('INVALID_INPUT');
  return { ...parsed, params };
}
