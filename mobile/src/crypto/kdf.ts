import { bsNative } from '../../modules/bs-native';
import { b64 } from './encoding';
import { CryptoError } from './errors';
import { sodium } from './sodium';

/*
 * Every password/code hashing in the app goes through here (SPEC §4.2):
 * Argon2id v1.3, one lane, 64 MiB, 3 passes. The native module computes it
 * in a fraction of a second; pure JS would need about a minute on a phone,
 * so the app refuses to run without it rather than silently using less.
 *
 * Also: a PRF keyed by the phone's secure hardware (devicePrf), and a clock
 * the user cannot move (uptimeMs).
 */

export interface Argon2Params {
  ops: number;
  mem: number; // bytes
}

const PRODUCTION: Argon2Params = { ops: 3, mem: 64 * 1024 * 1024 };
// Unit tests run hundreds of derivations in JS: same code, lighter cost.
const TESTS: Argon2Params = { ops: 1, mem: 1024 * 1024 };
const inJest = typeof process !== 'undefined' && !!process.env?.JEST_WORKER_ID;
let current: Argon2Params = inJest ? TESTS : PRODUCTION;

/** The cost used for every new derivation. */
export const argon2Params = (): Argon2Params => current;

/** Tests only: `null` restores the production cost (tests against the real server). */
export function setArgon2ForTests(p: Argon2Params | null): void {
  if (!inJest) throw new Error('test only');
  current = p ?? PRODUCTION;
}

/** False in Expo Go: the app shows that a real build is needed. */
export const hasNativeCrypto = bsNative !== null;

export class NativeCryptoMissingError extends Error {
  constructor() {
    super('native_crypto_missing');
    this.name = 'NativeCryptoMissingError';
  }
}

// Bounds for parameters read back from storage or the server: never allocate GBs.
export const MAX_OPS = 10;
export const MAX_MEM = 256 * 1024 * 1024;

export async function argon2id(length: number, password: Uint8Array, salt: Uint8Array, p: Argon2Params): Promise<Uint8Array> {
  if (!Number.isInteger(p.ops) || p.ops < 1 || p.ops > MAX_OPS || !Number.isInteger(p.mem) || p.mem < 8192 || p.mem > MAX_MEM || p.mem % 1024) {
    throw new CryptoError('INVALID_INPUT');
  }
  if (bsNative) {
    const out = await bsNative.argon2id(std.encode(password), std.encode(salt), p.ops, p.mem, length);
    return std.decode(out);
  }
  if (!inJest) throw new NativeCryptoMissingError();
  return sodium.crypto_pwhash(length, password, salt, p.ops, p.mem, sodium.crypto_pwhash_ALG_ARGON2ID13);
}

/**
 * HMAC under a key held by the Secure Enclave / Android Keystore. Null when
 * the module is absent (tests): callers then skip this layer, and record it.
 */
export async function devicePrf(input: Uint8Array): Promise<Uint8Array | null> {
  if (!bsNative) return null;
  return std.decode(await bsNative.devicePrf(std.encode(input)));
}

export async function deleteDeviceKey(): Promise<void> {
  await bsNative?.deleteDeviceKey();
}

/** Milliseconds since boot (sleep included), or null without the native module. */
export function uptimeMs(): number | null {
  return bsNative ? bsNative.uptimeMs() : null;
}

/** Standard base64 with padding, as the native side expects. */
const std = {
  encode: (bytes: Uint8Array): string => {
    const s = b64.encode(bytes).replace(/-/g, '+').replace(/_/g, '/');
    return s + '='.repeat((4 - (s.length % 4)) % 4);
  },
  decode: (text: string): Uint8Array => b64.decode(text.replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')),
};
