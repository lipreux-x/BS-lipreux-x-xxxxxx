import * as SecureStore from 'expo-secure-store';
import type { SecretStore } from './vault';

// Keychain (iOS) / Keystore-backed storage (Android). THIS_DEVICE_ONLY: never
// restored onto another phone from a backup (the device secret must not move).
const options: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

export const secureStore: SecretStore = {
  get: (key) => SecureStore.getItemAsync(key, options),
  set: (key, value) => SecureStore.setItemAsync(key, value, options),
  delete: (key) => SecureStore.deleteItemAsync(key, options),
};
