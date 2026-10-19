import { requireOptionalNativeModule } from 'expo';

/*
 * Native helpers for src/crypto (see ios/BsNativeModule.swift and
 * android/.../BsNativeModule.kt). Null where the module is not compiled in
 * (Jest, Expo Go): callers fall back or refuse, never silently weaken.
 *
 * Bytes cross the bridge as base64 (standard alphabet, with padding).
 */
export interface BsNative {
  /** Argon2id v1.3, one lane: the same output as libsodium's crypto_pwhash. */
  argon2id(password: string, salt: string, ops: number, memBytes: number, length: number): Promise<string>;
  /**
   * HMAC-SHA256 under a key that never leaves this phone's secure hardware
   * (Secure Enclave / Android Keystore, StrongBox when present): its output
   * cannot be computed from a copy of the app's storage.
   */
  devicePrf(input: string): Promise<string>;
  /** Forgets that key (account erased on this phone). */
  deleteDeviceKey(): Promise<void>;
  /** Milliseconds since boot, sleep included: cannot be moved by changing the clock. */
  uptimeMs(): number;
}

export const bsNative = requireOptionalNativeModule<BsNative>('BsNative');
