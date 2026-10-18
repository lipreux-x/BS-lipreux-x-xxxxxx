/*
 * The pure-JS backend (Expo Go) must be byte-compatible with libsodium: data
 * written by one must be readable by the other, and deterministic functions
 * must give identical output. Runs in both Jest projects; it imports both
 * backends directly.
 */
import libsodium from 'libsodium-wrappers-sumo';
import { jsSodium } from '../jsSodium';

const enc = (s: string) => new TextEncoder().encode(s);

beforeAll(() => libsodium.ready);

describe.each([
  ['libsodium -> js', () => libsodium as unknown as typeof jsSodium, () => jsSodium],
  ['js -> libsodium', () => jsSodium, () => libsodium as unknown as typeof jsSodium],
])('%s', (_, writerOf, readerOf) => {
  it('XChaCha20-Poly1305 AEAD', () => {
    const [w, r] = [writerOf(), readerOf()];
    const key = w.randombytes_buf(32);
    const nonce = w.randombytes_buf(24);
    const ad = enc('context');
    const c = w.crypto_aead_xchacha20poly1305_ietf_encrypt(enc('salut 🔒'), ad, null, nonce, key);
    expect(new TextDecoder().decode(r.crypto_aead_xchacha20poly1305_ietf_decrypt(null, c, ad, nonce, key))).toBe('salut 🔒');
    expect(() => r.crypto_aead_xchacha20poly1305_ietf_decrypt(null, c, enc('other'), nonce, key)).toThrow();
  });

  it('crypto_box_seal', () => {
    const [w, r] = [writerOf(), readerOf()];
    const recipient = r.crypto_box_keypair();
    const sealed = w.crypto_box_seal(enc('group key'), recipient.publicKey);
    expect(sealed.length).toBe(32 + 16 + 9);
    expect(new TextDecoder().decode(r.crypto_box_seal_open(sealed, recipient.publicKey, recipient.privateKey))).toBe('group key');
    const other = r.crypto_box_keypair();
    expect(() => r.crypto_box_seal_open(sealed, other.publicKey, other.privateKey)).toThrow();
  });

  it('Ed25519 detached signatures', () => {
    const [w, r] = [writerOf(), readerOf()];
    const kp = w.crypto_sign_keypair();
    const sig = w.crypto_sign_detached(enc('message'), kp.privateKey);
    expect(r.crypto_sign_verify_detached(sig, enc('message'), kp.publicKey)).toBe(true);
    expect(r.crypto_sign_verify_detached(sig, enc('messagE'), kp.publicKey)).toBe(false);
  });

  it('base64url', () => {
    const [w, r] = [writerOf(), readerOf()];
    for (let n = 0; n < 40; n++) {
      const bytes = w.randombytes_buf(n);
      expect(r.from_base64(w.to_base64(bytes))).toEqual(bytes);
    }
  });
});

describe('deterministic functions are identical', () => {
  it('Ed25519 signatures are identical for the same key', () => {
    const kp = libsodium.crypto_sign_keypair();
    const m = enc('same input');
    expect(jsSodium.crypto_sign_detached(m, kp.privateKey)).toEqual(libsodium.crypto_sign_detached(m, kp.privateKey));
  });

  it('BLAKE2b (safety numbers)', () => {
    const m = enc('bs/v1/safety');
    expect(jsSodium.crypto_generichash(30, m, null)).toEqual(libsodium.crypto_generichash(30, m, null));
  });

  it('Argon2id (code keys)', () => {
    const salt = libsodium.randombytes_buf(16);
    const pw = enc('482913');
    const args = [32, pw, salt, 3, 4 * 1024 * 1024, libsodium.crypto_pwhash_ALG_ARGON2ID13] as const;
    expect(jsSodium.crypto_pwhash(...args)).toEqual(libsodium.crypto_pwhash(...args));
  });

  it('base64 output matches libsodium exactly', () => {
    const bytes = libsodium.randombytes_buf(37);
    expect(jsSodium.to_base64(bytes)).toBe(libsodium.to_base64(bytes));
  });

  it('JS base64 rejects malformed input like libsodium', () => {
    for (const bad of ['***', 'A', 'AB=', 'a+b/']) expect(() => jsSodium.from_base64(bad)).toThrow();
  });
});
