/*
 * The app locks 5 min after it leaves the foreground. A system screen the user
 * opened from the app (photo picker, permission prompt) also sends it to the
 * background on Android: those calls run inside `whileSystemUi` so the lock
 * timer does not fire under the user's feet while they pick a photo. The time
 * away still counts when the app comes back (SessionProvider).
 */

let active = 0;

export async function whileSystemUi<T>(fn: () => Promise<T>): Promise<T> {
  active++;
  try {
    return await fn();
  } finally {
    active--;
  }
}

export const systemUiOpen = () => active > 0;
