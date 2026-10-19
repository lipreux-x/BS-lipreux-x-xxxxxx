/*
 * The app locks as soon as it leaves the foreground. A system screen the user
 * opened from the app (photo picker, permission prompt) also sends it to the
 * background on Android: those calls run inside `whileSystemUi` so they do
 * not lock the session under the user's feet.
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
