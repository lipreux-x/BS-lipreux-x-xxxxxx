import * as Clipboard from 'expo-clipboard';
import { Platform } from 'react-native';
import { bsNative } from '../../modules/bs-native';

const CLEAR_AFTER_MS = 60_000;
let timer: ReturnType<typeof setTimeout> | undefined;

/**
 * Copies decrypted text or an invite code so that it does not linger for
 * other apps. iOS: kept off the user's other Apple devices and removed by
 * iOS itself after a minute, even if the app is in the background (reading
 * the pasteboard back would show "Allow Paste" once another app copied).
 * Android: marked sensitive (no preview, keyboards do not suggest it), and
 * cleared after a minute if it is still what we put there.
 */
export async function copySensitive(text: string): Promise<void> {
  if (Platform.OS === 'ios' && bsNative?.copyLocal) return bsNative.copyLocal(text, CLEAR_AFTER_MS / 1000);
  await Clipboard.setStringAsync(text, { android: { isSensitive: true } });
  clearTimeout(timer);
  timer = setTimeout(() => {
    void Clipboard.getStringAsync()
      .then((now) => (now === text ? Clipboard.setStringAsync('') : undefined))
      .catch(() => {});
  }, CLEAR_AFTER_MS);
}
