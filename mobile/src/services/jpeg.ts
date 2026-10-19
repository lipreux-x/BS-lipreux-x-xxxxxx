/*
 * Images come from other members: a JPEG can declare huge dimensions in a
 * few bytes and make the image decoder run out of memory every time the
 * conversation opens. The app sends at most 1600 px (services/images.ts), so
 * anything larger, or not a well-formed JPEG, is refused before display.
 */

export const MAX_IMAGE_SIDE = 4096;

/** Width and height from the frame header (SOFn), or null if this is not a readable JPEG. */
export function jpegSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let i = 2;
  while (i + 4 <= bytes.length) {
    if (bytes[i] !== 0xff) return null;
    const marker = bytes[i + 1]!;
    if (marker === 0xff) {
      i++; // fill byte
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) return null; // end, or scan data before any frame header
    const length = (bytes[i + 2]! << 8) | bytes[i + 3]!;
    if (length < 2 || i + 2 + length > bytes.length) return null;
    // SOF0..SOF15, except DHT (C4), JPG (C8) and DAC (CC).
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      if (length < 7) return null;
      const height = (bytes[i + 5]! << 8) | bytes[i + 6]!;
      const width = (bytes[i + 7]! << 8) | bytes[i + 8]!;
      return width > 0 && height > 0 ? { width, height } : null;
    }
    i += 2 + length;
  }
  return null;
}

/** True if the image may be handed to the decoder. */
export function safeToDisplay(bytes: Uint8Array): boolean {
  const size = jpegSize(bytes);
  return !!size && size.width <= MAX_IMAGE_SIDE && size.height <= MAX_IMAGE_SIDE;
}
