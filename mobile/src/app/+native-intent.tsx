import { parseGroupLink, setPendingLink } from '@/services/groupLink';

/**
 * Every link that opens the app goes through here (Expo Router). A group
 * invitation (basesecrete://invite/<code>) goes to the join screen with its
 * code. The app may be locked: the screens behind the app code are then out
 * of reach and the lock screen shows, so the code is also kept aside for
 * app/(app)/_layout.tsx to take once the app is open. Anything else goes on
 * as it came. Never throws.
 */
export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  try {
    if (!/invite\//.test(path)) return path;
    const code = parseGroupLink(path);
    if (!code) return '/';
    setPendingLink(code);
    return `/group/join?invite=${encodeURIComponent(code)}`;
  } catch {
    return '/';
  }
}
