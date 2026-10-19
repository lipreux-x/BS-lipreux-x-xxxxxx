// Single entry point to the crypto primitives.
//
// - App (store builds and Expo Go): a pure-JS implementation of the libsodium
//   functions this app uses, with byte-identical output (./jsSodium.ts).
//   react-native-libsodium was dropped: it does not build on the New
//   Architecture (see ./nativeSodium.ts).
// - Jest: ./nativeSodium is mapped to libsodium-wrappers-sumo; the
//   BS_CRYPTO_BACKEND env var selects which backend a test run exercises.
import native from './nativeSodium';
import { jsSodium } from './jsSodium';

export type CryptoBackend = 'libsodium' | 'js';

function pickBackend(): CryptoBackend {
  const forced = typeof process !== 'undefined' ? process.env?.BS_CRYPTO_BACKEND : undefined;
  return forced === 'libsodium' && native ? 'libsodium' : 'js';
}

export const backend: CryptoBackend = pickBackend();

// Both expose the same functions with the same signatures (see jsSodium.ts).
export const sodium = (backend === 'libsodium' ? native : jsSodium) as typeof jsSodium;

/** Must be awaited once before calling any function in `crypto/`. */
export async function initCrypto(): Promise<void> {
  await sodium.ready;
}
