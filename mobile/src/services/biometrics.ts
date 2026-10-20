import { AuthenticationType, isEnrolledAsync, supportedAuthenticationTypesAsync } from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { whileSystemUi } from '@/session/autoLock';
import type { BiometricStore } from './vault';

/*
 * Opening the app with the fingerprint (Settings), in place of the app code.
 * Fingerprint only: the option is offered only on a phone with a fingerprint
 * sensor and a finger enrolled, never for face unlock. Android's prompt
 * accepts any strong biometric (a Pixel's face, a Samsung's iris) and cannot
 * be limited to the finger: there the option needs a phone whose only
 * biometric hardware is the fingerprint sensor.
 *
 * A copy of the master key that only the fingerprint releases: the Keychain
 * (iOS, Touch ID, biometryCurrentSet) or the Keystore (Android, user
 * authentication required) keeps it, and the system runs the check itself;
 * the app never sees the finger. Adding a finger invalidates the copy;
 * removing the phone's own passcode deletes it
 * (WHEN_PASSCODE_SET_THIS_DEVICE_ONLY). Never in a backup.
 */

const KEY = 'bs.master_bio';
const options: SecureStore.SecureStoreOptions = {
  requireAuthentication: true,
  authenticationPrompt: 'Ouvrir BaseSecrète',
  keychainAccessible: SecureStore.WHEN_PASSCODE_SET_THIS_DEVICE_ONLY,
};

export const biometricStore: BiometricStore = {
  // Android's Keystore asks for the finger to seal the copy; iOS only to open it.
  saveAsksFinger: Platform.OS === 'android',
  async available() {
    try {
      const [types, enrolled] = await Promise.all([supportedAuthenticationTypesAsync(), isEnrolledAsync()]);
      const fingerprint =
        Platform.OS === 'android'
          ? types.length > 0 && types.every((t) => t === AuthenticationType.FINGERPRINT)
          : types.includes(AuthenticationType.FINGERPRINT);
      return enrolled && fingerprint && SecureStore.canUseBiometricAuthentication();
    } catch {
      return false;
    }
  },
  save: (value) => whileSystemUi(() => SecureStore.setItemAsync(KEY, value, options)),
  load: () => whileSystemUi(() => SecureStore.getItemAsync(KEY, options)),
  clear: () => SecureStore.deleteItemAsync(KEY, options),
};
