import { createCipheriv, createDecipheriv, createHash, createHmac, createPublicKey, randomBytes, timingSafeEqual, verify } from 'node:crypto';

/*
 * Server-side crypto is limited to verification and hashing. It must stay
 * byte-compatible with mobile/src/crypto (framing, base64url, AD labels).
 */

const enc = new TextEncoder();

export const utf8 = (s: string): Uint8Array => enc.encode(s);

/** base64url without padding (libsodium's default). Returns null if malformed. */
export function fromB64(s: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]*$/.test(s)) return null;
  return new Uint8Array(Buffer.from(s, 'base64url'));
}

/** Same framing as mobile/src/crypto/encoding.ts: u32 BE length + bytes per field. */
export function frame(...fields: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(fields.reduce((n, f) => n + 4 + f.length, 0));
  const view = new DataView(out.buffer);
  let o = 0;
  for (const f of fields) {
    view.setUint32(o, f.length, false);
    out.set(f, o + 4);
    o += 4 + f.length;
  }
  return out;
}

const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

export function verifyEd25519(signature: Uint8Array, message: Uint8Array, publicKey: Uint8Array): boolean {
  if (signature.length !== 64 || publicKey.length !== 32) return false;
  try {
    const key = createPublicKey({
      key: Buffer.concat([ED25519_SPKI_PREFIX, publicKey]),
      format: 'der',
      type: 'spki',
    });
    return verify(null, message, key, signature);
  } catch {
    return false;
  }
}

export const sha256Hex = (s: string): string => createHash('sha256').update(s).digest('hex');

// Invite codes: 80 bits from a Crockford base32 alphabet (no I, L, O, U).
const INVITE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export function generateInviteCode(): string {
  const bytes = randomBytes(16);
  let code = '';
  for (const b of bytes) code += INVITE_ALPHABET[b & 31];
  return code.match(/.{4}/g)!.join('-');
}

export function normalizeInviteCode(code: string): string {
  return code.toUpperCase().replace(/[^0-9A-Z]/g, '');
}

/**
 * Finds the group to join. The phone never sends the group code or the
 * keywords: only `joinKey`, derived from both with Argon2id (64 MiB) on the
 * phone (mobile src/crypto/groupSecret.ts). Keyed with a server-only secret
 * so a database dump alone does not even allow testing guesses.
 */
export function joinLookup(joinKey: Uint8Array): string {
  return createHmac('sha256', pepper()).update(joinKey).digest('hex');
}

function pepper(): string {
  const p = process.env.GROUP_CODE_PEPPER;
  if (!p || p.length < 32) throw new Error('GROUP_CODE_PEPPER is missing or too short');
  return p;
}

/*
 * Key backups (mobile src/crypto/backup.ts). The phone already sealed the
 * identity with its password; the server adds a layer keyed by its secret,
 * so a database dump alone is not enough to start guessing passwords.
 */
const serverKey = (label: string) => createHmac('sha256', pepper()).update(`bs/v1/${label}`).digest();

export const backupAuthHash = (authKey: Uint8Array): string =>
  createHmac('sha256', serverKey('backup-auth')).update(authKey).digest('hex');

export function backupAuthMatches(authKey: Uint8Array, stored: string): boolean {
  const a = Buffer.from(backupAuthHash(authKey), 'hex');
  const b = Buffer.from(stored, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

/** A believable salt for usernames without a backup, so sign-in does not reveal who exists. */
export const decoySalt = (username: string): Uint8Array =>
  new Uint8Array(createHmac('sha256', serverKey('decoy-salt')).update(username).digest().subarray(0, 16));

export function sealAtRest(box: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', serverKey('backup-box'), iv);
  const ct = Buffer.concat([cipher.update(box, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ct]).toString('base64url');
}

export function openAtRest(sealed: string): string {
  const raw = Buffer.from(sealed, 'base64url');
  const decipher = createDecipheriv('aes-256-gcm', serverKey('backup-box'), raw.subarray(0, 12));
  decipher.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8');
}
