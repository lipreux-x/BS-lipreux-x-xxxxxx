import { File, Paths } from 'expo-file-system';

/*
 * iOS keeps Keychain items when the app is deleted: without this, a
 * reinstall would find the old vault (and deleting the app would not erase
 * the account). The app's documents folder does go with it, so a marker
 * file there tells a fresh install from a normal launch.
 */

const marker = () => new File(Paths.document, '.installed');

export function isFreshInstall(): boolean {
  try {
    return !marker().exists;
  } catch (e) {
    // Can't tell (file-system error): treat it as a normal launch rather than
    // wipe what might be a legitimate vault. The cost is missing the rare
    // reinstall-with-FS-error case; the vault still needs the app code to open.
    if (__DEV__) console.warn('[install] fresh-install check failed', e);
    return false;
  }
}

export function markInstalled(): void {
  try {
    const f = marker();
    if (!f.exists) f.create();
  } catch {
    // Checked again at the next launch.
  }
}
