import * as aead from './aead';
import { b64, frame, utf8, wipe } from './encoding';
import { attempt, CryptoError } from './errors';
import type { Identity } from './identity';
import { argon2id, argon2Params, MAX_MEM, MAX_OPS } from './kdf';

/*
 * Account key backup, to sign in again on a phone that lost its data
 * (reinstall, new build). The identity secret keys are sealed on the phone
 * with a key derived from a dedicated password (never the 6-digit app code:
 * a server-held copy needs real entropy, SPEC §4).
 *
 *   Argon2id(frame('bs/v1/backup', username, password), salt) -> 64 bytes
 *     [0..32)  kek      seals the identity, never leaves the phone
 *     [32..64) authKey  sent to sign in; the server only keeps a hash of it,
 *                       and returns the sealed identity once it matches
 *
 * The server never sees the password or the kek, and it rate-limits sign-in
 * attempts, so guessing the password needs the database itself. The cost
 * (Argon2id, 64 MiB) comes from the server at sign-in, so the phone refuses
 * anything weaker than its own: a hostile server cannot make it hand over an
 * authKey that is cheap to attack.
 */

export const MIN_PASSWORD_LENGTH = 10;
const SALT_BYTES = 16;

/** Public parameters the server hands out before sign-in. */
export interface BackupParams {
  salt: string;
  ops: number;
  mem: number;
}

/** Sent once at registration. */
export interface KeyBackup extends BackupParams {
  authKey: string;
  box: string; // nonce || ciphertext of the identity
}

export function isValidPassword(password: string): boolean {
  return passwordProblem(password) === null;
}

/**
 * Null if the password is acceptable, else what is wrong, to show. This copy
 * of the keys can be attacked offline by whoever holds the server database,
 * so it rejects what attackers try first: short, repetitive or sequential.
 */
export function passwordProblem(password: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) return `Au moins ${MIN_PASSWORD_LENGTH} caractères`;
  if (password.length > 128) return '128 caractères au plus';
  if (new Set(password.toLowerCase()).size < 6) return 'Trop répétitif : varie les caractères';
  const lower = password.toLowerCase();
  for (const run of ['0123456789', 'abcdefghijklmnopqrstuvwxyz', 'azertyuiop', 'qwertyuiop', 'motdepasse', 'password']) {
    for (let i = 0; i + 6 <= run.length; i++) if (lower.includes(run.slice(i, i + 6))) return 'Évite les suites (123456, azerty…)';
  }
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((r) => r.test(password)).length;
  // A long passphrase is fine as it is; a shorter password needs variety.
  if (password.length < 16 && classes < 3) return 'Mélange minuscules, majuscules, chiffres ou symboles (ou fais une phrase de 16 caractères)';
  return null;
}

const backupAd = (username: string) => frame(utf8.encode('bs/v1/key-backup'), utf8.encode(username));

async function derive(username: string, password: string, p: BackupParams): Promise<{ kek: Uint8Array; authKey: Uint8Array }> {
  const salt = attempt('INVALID_INPUT', () => b64.decode(p.salt));
  const floor = argon2Params();
  const ok =
    salt.length === SALT_BYTES &&
    Number.isInteger(p.ops) && p.ops >= floor.ops && p.ops <= MAX_OPS &&
    Number.isInteger(p.mem) && p.mem >= floor.mem && p.mem <= MAX_MEM && p.mem % 1024 === 0;
  if (!ok) throw new CryptoError('INVALID_INPUT');
  const out = await argon2id(64, frame(utf8.encode('bs/v1/backup'), utf8.encode(username), utf8.encode(password)), salt, p);
  return { kek: out.slice(0, 32), authKey: out.slice(32) };
}

export async function createKeyBackup(identity: Identity, username: string, password: string): Promise<KeyBackup> {
  if (!isValidPassword(password)) throw new CryptoError('INVALID_INPUT');
  const params: BackupParams = { salt: b64.encode(aead.randomBytes(SALT_BYTES)), ...argon2Params() };
  const { kek, authKey } = await derive(username, password, params);
  try {
    const json = JSON.stringify({
      bp: b64.encode(identity.boxPublicKey),
      bs: b64.encode(identity.boxSecretKey),
      sp: b64.encode(identity.signPublicKey),
      ss: b64.encode(identity.signSecretKey),
    });
    return { ...params, authKey: b64.encode(authKey), box: b64.encode(aead.seal(kek, utf8.encode(json), backupAd(username))) };
  } finally {
    wipe(kek);
  }
}

/** The slow step of signing in: keep the kek to open the box the server returns. */
export async function backupKeys(username: string, password: string, params: BackupParams): Promise<{ kek: Uint8Array; authKey: string }> {
  const { kek, authKey } = await derive(username, password, params);
  return { kek, authKey: b64.encode(authKey) };
}

/** Throws CryptoError('DECRYPT_FAILED') if the box does not open with this kek. */
export function openKeyBackup(box: string, username: string, kek: Uint8Array): Identity {
  const blob = attempt('DECRYPT_FAILED', () => b64.decode(box));
  const json = aead.open(kek, blob, backupAd(username));
  const o = attempt('DECRYPT_FAILED', () => JSON.parse(utf8.decode(json)) as Record<string, string>);
  if (!o.bp || !o.bs || !o.sp || !o.ss) throw new CryptoError('DECRYPT_FAILED');
  return {
    boxPublicKey: b64.decode(o.bp),
    boxSecretKey: b64.decode(o.bs),
    signPublicKey: b64.decode(o.sp),
    signSecretKey: b64.decode(o.ss),
  };
}
