import { sodium } from './sodium';

const encoder = new TextEncoder();
// Hermes may lack TextDecoder: fall back to a strict decoder (rejects malformed input).
const decoder = typeof TextDecoder === 'function' ? new TextDecoder('utf-8', { fatal: true }) : null;

export const utf8 = {
  encode: (text: string): Uint8Array => encoder.encode(text),
  decode: (bytes: Uint8Array): string => (decoder ? decoder.decode(bytes) : decodeUtf8Strict(bytes)),
};

export function decodeUtf8Strict(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; ) {
    const b0 = bytes[i++];
    let cp: number;
    let extra: number;
    let min: number;
    if (b0 < 0x80) [cp, extra, min] = [b0, 0, 0];
    else if (b0 >= 0xc2 && b0 < 0xe0) [cp, extra, min] = [b0 & 0x1f, 1, 0x80];
    else if (b0 >= 0xe0 && b0 < 0xf0) [cp, extra, min] = [b0 & 0x0f, 2, 0x800];
    else if (b0 >= 0xf0 && b0 < 0xf5) [cp, extra, min] = [b0 & 0x07, 3, 0x10000];
    else throw new TypeError('invalid utf-8');
    for (let k = 0; k < extra; k++) {
      const b = bytes[i++];
      if (b === undefined || (b & 0xc0) !== 0x80) throw new TypeError('invalid utf-8');
      cp = (cp << 6) | (b & 0x3f);
    }
    if (cp < min || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) throw new TypeError('invalid utf-8');
    out += String.fromCodePoint(cp);
  }
  return out;
}

/** URL-safe base64 without padding (libsodium default variant). */
export const b64 = {
  encode: (bytes: Uint8Array): string => sodium.to_base64(bytes),
  decode: (text: string): Uint8Array => sodium.from_base64(text),
};

export function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

/** Big-endian uint32, used to frame variable-length fields unambiguously. */
export function u32(n: number): Uint8Array {
  if (!Number.isInteger(n) || n < 0 || n > 0xffffffff) throw new RangeError('u32 out of range');
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, n, false);
  return out;
}

/** Length-prefixed concatenation: no two different field lists encode the same bytes. */
export function frame(...fields: Uint8Array[]): Uint8Array {
  return concatBytes(...fields.flatMap((f) => [u32(f.length), f]));
}

/** Constant-time comparison (react-native-libsodium does not expose sodium_memcmp). */
export function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/** Best-effort wipe of key material held in JS memory. */
export function wipe(bytes: Uint8Array | null | undefined): void {
  bytes?.fill(0);
}
