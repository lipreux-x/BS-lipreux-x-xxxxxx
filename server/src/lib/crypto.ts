import { argon2id, argon2Verify } from 'hash-wasm';
import { createHash, createHmac, createPublicKey, randomBytes, verify } from 'node:crypto';

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
 * Index for joining with the code alone. Keyed with a server-only secret so a
 * database dump alone does not reveal which group uses which code.
 */
export function groupCodeLookup(code: string): string {
  const pepper = process.env.GROUP_CODE_PEPPER;
  if (!pepper || pepper.length < 32) throw new Error('GROUP_CODE_PEPPER is missing or too short');
  return createHmac('sha256', pepper).update(code).digest('hex');
}

// Group code: low entropy by design, so Argon2id + strict rate limiting.
export async function hashGroupCode(code: string): Promise<string> {
  return argon2id({
    password: code,
    salt: randomBytes(16),
    parallelism: 1,
    iterations: 3,
    memorySize: 64 * 1024, // KiB
    hashLength: 32,
    outputType: 'encoded',
  });
}

export async function verifyGroupCode(code: string, encoded: string): Promise<boolean> {
  try {
    return await argon2Verify({ password: code, hash: encoded });
  } catch {
    return false;
  }
}
