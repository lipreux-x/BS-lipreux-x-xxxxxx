import { xchacha20poly1305 } from '@noble/ciphers/chacha';
import { argon2id } from '@noble/hashes/argon2';
import { blake2b } from '@noble/hashes/blake2b';
import { getRandomValues } from 'expo-crypto';
import nacl from 'tweetnacl';

/*
 * Pure-JavaScript stand-in for the libsodium subset this app uses, for Expo
 * Go (which cannot load the native libsodium module). No new cryptography:
 * every primitive comes from audited libraries and reproduces libsodium's
 * exact constructions, so data is interchangeable with the native build
 * (checked byte for byte against libsodium in __tests__/backends.test.ts):
 *
 *   XChaCha20-Poly1305 IETF  @noble/ciphers
 *   X25519 box, Ed25519      tweetnacl (crypto_box / crypto_sign)
 *   crypto_box_seal          libsodium's construction: ephemeral X25519 key,
 *                            nonce = BLAKE2b-192(epk || pk), crypto_box
 *   BLAKE2b, Argon2id        @noble/hashes
 */

function randomBytes(n: number): Uint8Array {
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i += 1024) getRandomValues(out.subarray(i, Math.min(n, i + 1024)));
  return out;
}

nacl.setPRNG((x, n) => x.set(randomBytes(n)));

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a);
  out.set(b, a.length);
  return out;
}

const sealNonce = (epk: Uint8Array, pk: Uint8Array) => blake2b(concat(epk, pk), { dkLen: 24 });

// base64url without padding (libsodium's default variant), strict on input.
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const LOOKUP = new Map([...ALPHABET].map((c, i) => [c, i]));

function toBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i]! << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    const chars = Math.min(4, Math.ceil(((bytes.length - i) * 8) / 6));
    for (let k = 0; k < chars; k++) out += ALPHABET[(n >> (18 - 6 * k)) & 63];
  }
  return out;
}

function fromBase64(text: string): Uint8Array {
  if (text.length % 4 === 1) throw new TypeError('invalid base64');
  const out = new Uint8Array(Math.floor((text.length * 6) / 8));
  let acc = 0;
  let bits = 0;
  let o = 0;
  for (const c of text) {
    const v = LOOKUP.get(c);
    if (v === undefined) throw new TypeError('invalid base64');
    acc = (acc << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o++] = (acc >> bits) & 0xff;
    }
  }
  if ((acc & ((1 << bits) - 1)) !== 0) throw new TypeError('invalid base64'); // non-canonical trailing bits
  return out;
}

const ARGON2ID13 = 2;

export const jsSodium = {
  ready: Promise.resolve(),
  crypto_pwhash_ALG_ARGON2ID13: ARGON2ID13,

  randombytes_buf: randomBytes,
  to_base64: toBase64,
  from_base64: fromBase64,

  crypto_aead_xchacha20poly1305_ietf_encrypt(
    message: Uint8Array,
    ad: Uint8Array | null,
    _secretNonce: null,
    nonce: Uint8Array,
    key: Uint8Array,
  ): Uint8Array {
    return xchacha20poly1305(key, nonce, ad ?? undefined).encrypt(message);
  },

  crypto_aead_xchacha20poly1305_ietf_decrypt(
    _secretNonce: null,
    ciphertext: Uint8Array,
    ad: Uint8Array | null,
    nonce: Uint8Array,
    key: Uint8Array,
  ): Uint8Array {
    return xchacha20poly1305(key, nonce, ad ?? undefined).decrypt(ciphertext); // throws if forged
  },

  crypto_box_keypair() {
    const kp = nacl.box.keyPair();
    return { publicKey: kp.publicKey, privateKey: kp.secretKey, keyType: 'x25519' as const };
  },

  crypto_sign_keypair() {
    const kp = nacl.sign.keyPair(); // secretKey = seed || publicKey, same layout as libsodium
    return { publicKey: kp.publicKey, privateKey: kp.secretKey, keyType: 'ed25519' as const };
  },

  crypto_sign_detached(message: Uint8Array, secretKey: Uint8Array): Uint8Array {
    return nacl.sign.detached(message, secretKey);
  },

  crypto_sign_verify_detached(signature: Uint8Array, message: Uint8Array, publicKey: Uint8Array): boolean {
    return nacl.sign.detached.verify(message, signature, publicKey);
  },

  crypto_box_seal(message: Uint8Array, recipientPublicKey: Uint8Array): Uint8Array {
    if (recipientPublicKey.length !== 32) throw new TypeError('invalid public key');
    const eph = nacl.box.keyPair();
    const boxed = nacl.box(message, sealNonce(eph.publicKey, recipientPublicKey), recipientPublicKey, eph.secretKey);
    eph.secretKey.fill(0);
    return concat(eph.publicKey, boxed);
  },

  crypto_box_seal_open(sealed: Uint8Array, publicKey: Uint8Array, secretKey: Uint8Array): Uint8Array {
    if (sealed.length < 32 + nacl.box.overheadLength) throw new TypeError('ciphertext too short');
    const epk = sealed.subarray(0, 32);
    const opened = nacl.box.open(sealed.subarray(32), sealNonce(epk, publicKey), epk, secretKey);
    if (!opened) throw new Error('incorrect key pair for the given ciphertext');
    return opened;
  },

  crypto_generichash(length: number, message: Uint8Array, key: Uint8Array | null): Uint8Array {
    return blake2b(message, { dkLen: length, ...(key ? { key } : {}) });
  },

  crypto_pwhash(
    length: number,
    password: Uint8Array,
    salt: Uint8Array,
    opsLimit: number,
    memLimitBytes: number,
    algorithm: number,
  ): Uint8Array {
    if (algorithm !== ARGON2ID13) throw new TypeError('only Argon2id is supported');
    // libsodium's crypto_pwhash: Argon2id v1.3, one lane, memory given in bytes.
    return argon2id(password, salt, { t: opsLimit, m: memLimitBytes / 1024, p: 1, dkLen: length });
  },
};
