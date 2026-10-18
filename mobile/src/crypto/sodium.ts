// Single entry point to libsodium. On device this is the native JSI build
// (react-native-libsodium); under Jest it is mapped to libsodium-wrappers-sumo,
// which exposes the same API.
import sodium from 'react-native-libsodium';

export { sodium };

/** Must be awaited once before calling any function in `crypto/`. */
export async function initCrypto(): Promise<void> {
  await sodium.ready;
}
