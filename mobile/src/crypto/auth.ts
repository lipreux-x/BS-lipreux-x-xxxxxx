import * as aead from './aead';
import { b64, frame, utf8 } from './encoding';
import { attempt, CryptoError } from './errors';
import { sign, type Identity } from './identity';
import { sodium } from './sodium';

/*
 * Proofs sent to the API. Byte layout must match server/src/app.ts:
 * - register: Ed25519(frame('bs/v1/register', invite, username, pkBox, pkSign))
 * - login:    Ed25519(frame('bs/v1/login', challenge))
 */

/** Same normalization as the server: case-insensitive, separators ignored, I and L read as 1, O as 0. */
export function normalizeInviteCode(code: string): string {
  return code
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, '')
    .replace(/[IL]/g, '1')
    .replace(/O/g, '0');
}

export function registrationProof(identity: Identity, inviteCode: string, username: string): string {
  const message = frame(
    utf8.encode('bs/v1/register'),
    utf8.encode(normalizeInviteCode(inviteCode)),
    utf8.encode(username),
    identity.boxPublicKey,
    identity.signPublicKey,
  );
  return b64.encode(sign(message, identity.signSecretKey));
}

export function loginSignature(identity: Identity, challenge: string): string {
  return b64.encode(sign(frame(utf8.encode('bs/v1/login'), utf8.encode(challenge)), identity.signSecretKey));
}

// ---- Identity at rest: sealed with the local master key --------------------

const IDENTITY_AD = utf8.encode('bs/v1/identity');

export function sealIdentity(identity: Identity, masterKey: Uint8Array): string {
  const json = JSON.stringify({
    bp: b64.encode(identity.boxPublicKey),
    bs: b64.encode(identity.boxSecretKey),
    sp: b64.encode(identity.signPublicKey),
    ss: b64.encode(identity.signSecretKey),
  });
  return b64.encode(aead.seal(masterKey, utf8.encode(json), IDENTITY_AD));
}

export function openIdentity(sealed: string, masterKey: Uint8Array): Identity {
  const blob = attempt('DECRYPT_FAILED', () => b64.decode(sealed));
  const json = aead.open(masterKey, blob, IDENTITY_AD);
  const o = attempt('DECRYPT_FAILED', () => JSON.parse(utf8.decode(json)) as Record<string, string>);
  if (!o.bp || !o.bs || !o.sp || !o.ss) throw new CryptoError('DECRYPT_FAILED');
  return {
    boxPublicKey: b64.decode(o.bp),
    boxSecretKey: b64.decode(o.bs),
    signPublicKey: b64.decode(o.sp),
    signSecretKey: b64.decode(o.ss),
  };
}

// ---- Small local records (e.g. decrypted group names) sealed with the master key

export function sealLocal(value: unknown, label: string, masterKey: Uint8Array): string {
  return b64.encode(aead.seal(masterKey, utf8.encode(JSON.stringify(value)), utf8.encode(`bs/v1/local/${label}`)));
}

export function openLocal<T>(sealed: string, label: string, masterKey: Uint8Array): T {
  const blob = attempt('DECRYPT_FAILED', () => b64.decode(sealed));
  const json = aead.open(masterKey, blob, utf8.encode(`bs/v1/local/${label}`));
  return attempt('DECRYPT_FAILED', () => JSON.parse(utf8.decode(json)) as T);
}

// ---- Local message database (SPEC §5.2) ---------------------------------------

/**
 * Subkey for the local database, derived from the master key (keyed BLAKE2b),
 * so the master key itself never sits in the long-lived database object.
 */
export function deriveLocalDbKey(masterKey: Uint8Array): Uint8Array {
  if (masterKey.length !== aead.KEY_BYTES) throw new CryptoError('INVALID_INPUT');
  return sodium.crypto_generichash(aead.KEY_BYTES, utf8.encode('bs/v1/local-db-key'), masterKey);
}

/** Keyed hash of an id: rows can be looked up by group without the file showing which group. */
export function blindLocalId(id: string, dbKey: Uint8Array): string {
  return b64.encode(sodium.crypto_generichash(16, frame(utf8.encode('bs/v1/local-id'), utf8.encode(id)), dbKey));
}
