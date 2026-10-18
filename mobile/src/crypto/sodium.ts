// Single entry point to the crypto primitives.
//
// - Development / store builds: native libsodium (react-native-libsodium, JSI).
// - Expo Go: the native module is absent, so a pure-JS implementation with the
//   same API and byte-identical output is used instead (./jsSodium.ts).
// - Jest: react-native-libsodium is mapped to libsodium-wrappers-sumo; the
//   BS_CRYPTO_BACKEND env var selects which backend a test run exercises.
import native from 'react-native-libsodium';
import { jsSodium } from './jsSodium';

export type CryptoBackend = 'libsodium' | 'js';

function pickBackend(): CryptoBackend {
  const forced = typeof process !== 'undefined' ? process.env?.BS_CRYPTO_BACKEND : undefined;
  if (forced === 'libsodium' || forced === 'js') return forced;
  // react-native-libsodium installs these JSI functions when its native module is linked.
  return typeof (globalThis as { jsi_crypto_sign_keypair?: unknown }).jsi_crypto_sign_keypair === 'function'
    ? 'libsodium'
    : 'js';
}

export const backend: CryptoBackend = pickBackend();

// Both expose the same functions with the same signatures (see jsSodium.ts).
export const sodium = (backend === 'libsodium' ? native : jsSodium) as typeof jsSodium;

/** Must be awaited once before calling any function in `crypto/`. */
export async function initCrypto(): Promise<void> {
  await sodium.ready;
}
