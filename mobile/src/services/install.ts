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
  } catch {
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
