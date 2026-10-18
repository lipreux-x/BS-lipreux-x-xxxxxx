import { concatBytes } from './encoding';
import { attempt, CryptoError } from './errors';
import { sodium } from './sodium';

// XChaCha20-Poly1305: 192-bit random nonces are safe to generate at random.
export const KEY_BYTES = 32;
export const NONCE_BYTES = 24;
const TAG_BYTES = 16;

export function randomKey(): Uint8Array {
  return sodium.randombytes_buf(KEY_BYTES);
}

export function randomBytes(length: number): Uint8Array {
  return sodium.randombytes_buf(length);
}

export function encrypt(
  key: Uint8Array,
  plaintext: Uint8Array,
  ad: Uint8Array,
): { nonce: Uint8Array; ciphertext: Uint8Array } {
  assertKey(key);
  const nonce = sodium.randombytes_buf(NONCE_BYTES);
  const ciphertext = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(plaintext, ad, null, nonce, key);
  return { nonce, ciphertext };
}

export function decrypt(key: Uint8Array, nonce: Uint8Array, ciphertext: Uint8Array, ad: Uint8Array): Uint8Array {
  assertKey(key);
  if (nonce.length !== NONCE_BYTES || ciphertext.length < TAG_BYTES) throw new CryptoError('DECRYPT_FAILED');
  return attempt('DECRYPT_FAILED', () =>
    sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(null, ciphertext, ad, nonce, key),
  );
}

/** encrypt() packed as a single `nonce || ciphertext` blob, for local storage. */
export function seal(key: Uint8Array, plaintext: Uint8Array, ad: Uint8Array): Uint8Array {
  const { nonce, ciphertext } = encrypt(key, plaintext, ad);
  return concatBytes(nonce, ciphertext);
}

export function open(key: Uint8Array, blob: Uint8Array, ad: Uint8Array): Uint8Array {
  return decrypt(key, blob.subarray(0, NONCE_BYTES), blob.subarray(NONCE_BYTES), ad);
}

function assertKey(key: Uint8Array): void {
  if (key.length !== KEY_BYTES) throw new CryptoError('INVALID_INPUT');
}
