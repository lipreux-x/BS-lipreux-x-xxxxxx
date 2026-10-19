import { jwtVerify, SignJWT } from 'jose';
import { randomBytes } from 'node:crypto';

/*
 * Two token kinds, both HS256 with JWT_SECRET:
 * - challenge (60 s): login nonce the device must sign with Ed25519, used
 *   once (its nonce is recorded, app.ts /auth/token);
 * - access (1 h): bearer token for the API and the WebSocket.
 */

const ISSUER = 'basesecrete';
const ACCESS_TTL = '1h';
const CHALLENGE_TTL = '60s';

function secret(): Uint8Array {
  const s = process.env.JWT_SECRET;
  if (!s || s.length < 32) throw new Error('JWT_SECRET is missing or too short');
  return new TextEncoder().encode(s);
}

export async function issueAccessToken(userId: string): Promise<string> {
  return new SignJWT({ typ: 'access' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer(ISSUER)
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(ACCESS_TTL)
    .sign(secret());
}

export async function verifyAccessToken(token: string): Promise<string | null> {
  return (await readAccessToken(token))?.userId ?? null;
}

/** With its expiry (ms): a WebSocket is closed when its token runs out. */
export async function readAccessToken(token: string): Promise<{ userId: string; expiresAt: number } | null> {
  try {
    const { payload } = await jwtVerify(token, secret(), { issuer: ISSUER, algorithms: ['HS256'] });
    if (payload.typ !== 'access' || typeof payload.sub !== 'string' || typeof payload.exp !== 'number') return null;
    return { userId: payload.sub, expiresAt: payload.exp * 1000 };
  } catch {
    return null;
  }
}

export async function issueChallenge(userId: string): Promise<string> {
  return new SignJWT({ typ: 'challenge', n: randomBytes(16).toString('base64url') })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer(ISSUER)
    .setSubject(userId)
    .setExpirationTime(CHALLENGE_TTL)
    .sign(secret());
}

export async function verifyChallenge(challenge: string): Promise<{ userId: string; nonce: string; expiresAt: Date } | null> {
  try {
    const { payload } = await jwtVerify(challenge, secret(), { issuer: ISSUER, algorithms: ['HS256'] });
    if (payload.typ !== 'challenge' || typeof payload.sub !== 'string') return null;
    if (typeof payload.n !== 'string' || typeof payload.exp !== 'number') return null;
    return { userId: payload.sub, nonce: payload.n, expiresAt: new Date(payload.exp * 1000) };
  } catch {
    return null;
  }
}
