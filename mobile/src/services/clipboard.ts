import * as Clipboard from 'expo-clipboard';

const CLEAR_AFTER_MS = 60_000;
let timer: ReturnType<typeof setTimeout> | undefined;

/**
 * Copies decrypted text or an invite code: marked sensitive on Android (no
 * preview, keyboards do not suggest it), and cleared after a minute if it
 * is still what we put there, so it does not linger for other apps.
 */
export async function copySensitive(text: string): Promise<void> {
  await Clipboard.setStringAsync(text, { android: { isSensitive: true } });
  clearTimeout(timer);
  timer = setTimeout(() => {
    void Clipboard.getStringAsync()
      .then((now) => (now === text ? Clipboard.setStringAsync('') : undefined))
      .catch(() => {});
  }, CLEAR_AFTER_MS);
}
