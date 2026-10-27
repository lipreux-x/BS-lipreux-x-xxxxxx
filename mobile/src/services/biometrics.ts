import { AuthenticationType, isEnrolledAsync, supportedAuthenticationTypesAsync } from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { whileSystemUi } from '@/session/autoLock';
import type { BiometricStore } from './vault';

/*
 * Opening the app with the phone's biometrics (Settings), in place of the
 * app code: Face ID or Touch ID on iOS (an iPhone has one or the other), the
 * fingerprint or a strong face unlock on Android. The choice between finger
 * and face is not the app's to make: iOS gives what the phone has, and
 * Android's prompt accepts every strong biometric enrolled (class 3: the
 * fingerprint, and the face only on phones whose face unlock is strong,
 * which Samsung's is not) and cannot be limited to one of them. What the
 * person chooses is in the phone's own settings; the app names what it got
 * (`biometricKind`).
 *
 * A copy of the master key that only the biometric releases: the Keychain
 * (iOS, biometryCurrentSet) or the Keystore (Android, user authentication
 * required) keeps it, and the system runs the check itself; the app never
 * sees the finger or the face. Enrolling a new one invalidates the copy;
 * removing the phone's own passcode deletes it
 * (WHEN_PASSCODE_SET_THIS_DEVICE_ONLY). Never in a backup.
 */

const KEY = 'bs.master_bio';

/** What the phone can check: a face (Face ID), a finger (Touch ID / sensor), or either (Android with both). */
export type BiometricKind = 'face' | 'fingerprint' | 'both';

/** The biometrics enrolled on this phone, or null without any. */
export async function biometricKind(): Promise<BiometricKind | null> {
  try {
    const [types, enrolled] = await Promise.all([supportedAuthenticationTypesAsync(), isEnrolledAsync()]);
    if (!enrolled) return null;
    const face = types.includes(AuthenticationType.FACIAL_RECOGNITION);
    const finger = types.includes(AuthenticationType.FINGERPRINT);
    if (face && finger) return 'both';
    if (face) return 'face';
    if (finger) return 'fingerprint';
    return types.length ? 'both' : null;
  } catch {
    return null;
  }
}

/** How the option is named: the system's name on iOS, the plain word on Android. */
export function biometricName(kind: BiometricKind | null): string {
  if (Platform.OS === 'ios') return kind === 'face' ? 'Face ID' : 'Touch ID';
  return kind === 'face' ? 'Reconnaissance faciale' : kind === 'both' ? 'Empreinte ou visage' : 'Empreinte digitale';
}

/** The lock screen's switch back from the keypad. */
export function biometricSwitchLabel(kind: BiometricKind | null): string {
  if (Platform.OS === 'ios') return `Utiliser ${biometricName(kind)}`;
  return kind === 'face' ? 'Utiliser le visage' : kind === 'both' ? 'Empreinte ou visage' : 'Utiliser l’empreinte';
}

/** "ton empreinte", "Face ID"…: what opens the app, in a sentence. */
export function biometricWord(kind: BiometricKind | null): string {
  if (Platform.OS === 'ios') return kind === 'face' ? 'Face ID' : 'Touch ID';
  return kind === 'face' ? 'ton visage' : kind === 'both' ? 'ton empreinte ou ton visage' : 'ton empreinte';
}
const options: SecureStore.SecureStoreOptions = {
  requireAuthentication: true,
  authenticationPrompt: 'Ouvrir le coffre',
  keychainAccessible: SecureStore.WHEN_PASSCODE_SET_THIS_DEVICE_ONLY,
};

export const biometricStore: BiometricStore = {
  // Android's Keystore asks for the biometric to seal the copy; iOS only to open it.
  saveAsksFinger: Platform.OS === 'android',
  async available() {
    try {
      return (await biometricKind()) !== null && SecureStore.canUseBiometricAuthentication();
    } catch {
      return false;
    }
  },
  save: (value) => whileSystemUi(() => SecureStore.setItemAsync(KEY, value, options)),
  load: () => whileSystemUi(() => SecureStore.getItemAsync(KEY, options)),
  clear: () => SecureStore.deleteItemAsync(KEY, options),
};
