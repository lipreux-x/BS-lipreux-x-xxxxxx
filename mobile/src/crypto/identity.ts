import { b64, frame, utf8 } from './encoding';
import { attempt, CryptoError } from './errors';
import { sodium } from './sodium';

/** Device identity (§4.1). Secret keys never leave the device. */
export interface Identity {
  boxPublicKey: Uint8Array; // X25519
  boxSecretKey: Uint8Array;
  signPublicKey: Uint8Array; // Ed25519
  signSecretKey: Uint8Array;
}

/** What goes into the `profiles` table. */
export interface PublicIdentity {
  publicKeyBox: string;
  publicKeySign: string;
}

export const SIGNATURE_BYTES = 64;

export function generateIdentity(): Identity {
  const box = sodium.crypto_box_keypair();
  const sign = sodium.crypto_sign_keypair();
  return {
    boxPublicKey: box.publicKey,
    boxSecretKey: box.privateKey,
    signPublicKey: sign.publicKey,
    signSecretKey: sign.privateKey,
  };
}

export function toPublicIdentity(identity: Identity): PublicIdentity {
  return {
    publicKeyBox: b64.encode(identity.boxPublicKey),
    publicKeySign: b64.encode(identity.signPublicKey),
  };
}

export function parsePublicIdentity(pub: PublicIdentity): { boxPublicKey: Uint8Array; signPublicKey: Uint8Array } {
  const keys = attempt('INVALID_INPUT', () => ({
    boxPublicKey: b64.decode(pub.publicKeyBox),
    signPublicKey: b64.decode(pub.publicKeySign),
  }));
  if (keys.boxPublicKey.length !== 32 || keys.signPublicKey.length !== 32) throw new CryptoError('INVALID_INPUT');
  return keys;
}

export function sign(message: Uint8Array, signSecretKey: Uint8Array): Uint8Array {
  return sodium.crypto_sign_detached(message, signSecretKey);
}

export function verify(signature: Uint8Array, message: Uint8Array, signPublicKey: Uint8Array): boolean {
  if (signature.length !== SIGNATURE_BYTES || signPublicKey.length !== 32) return false;
  try {
    return sodium.crypto_sign_verify_detached(signature, message, signPublicKey);
  } catch {
    return false;
  }
}

/** Anonymous public-key encryption to a recipient (crypto_box_seal). */
export function sealTo(plaintext: Uint8Array, recipientBoxPublicKey: Uint8Array): Uint8Array {
  return attempt('INVALID_INPUT', () => sodium.crypto_box_seal(plaintext, recipientBoxPublicKey));
}

export function openSealed(sealed: Uint8Array, identity: Identity): Uint8Array {
  return attempt('DECRYPT_FAILED', () =>
    sodium.crypto_box_seal_open(sealed, identity.boxPublicKey, identity.boxSecretKey),
  );
}

/**
 * Safety number (§4.7): 60 digits, identical on both phones, to compare in
 * person. Each half is derived from one user's public keys; halves are
 * sorted so the result does not depend on who computes it.
 */
export function safetyNumber(
  a: { boxPublicKey: Uint8Array; signPublicKey: Uint8Array },
  b: { boxPublicKey: Uint8Array; signPublicKey: Uint8Array },
): string {
  const halves = [fingerprintDigits(a), fingerprintDigits(b)].sort();
  return halves.join('').match(/.{5}/g)!.join(' ');
}

/**
 * One person's own key fingerprint: 30 digits, the same on their phone
 * (Réglages) and on any phone that received their keys from the server. An
 * admin compares it in person before letting a newcomer in: a key the
 * server swapped shows other digits.
 */
export function keyFingerprint(keys: { boxPublicKey: Uint8Array; signPublicKey: Uint8Array }): string {
  return fingerprintDigits(keys).match(/.{5}/g)!.join(' ');
}

function fingerprintDigits(keys: { boxPublicKey: Uint8Array; signPublicKey: Uint8Array }): string {
  const hash = sodium.crypto_generichash(
    30,
    frame(utf8.encode('bs/v1/safety'), keys.signPublicKey, keys.boxPublicKey),
    null,
  );
  let digits = '';
  for (let i = 0; i < 30; i += 5) {
    // 5 bytes -> 40-bit integer -> 5 decimal digits (bias is negligible for display).
    let n = 0;
    for (let j = 0; j < 5; j++) n = n * 256 + hash[i + j];
    digits += String(n % 100000).padStart(5, '0');
  }
  return digits;
}
