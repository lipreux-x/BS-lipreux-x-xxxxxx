import { sodium } from './sodium';

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

export const utf8 = {
  encode: (text: string): Uint8Array => encoder.encode(text),
  decode: (bytes: Uint8Array): string => decoder.decode(bytes),
};

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
