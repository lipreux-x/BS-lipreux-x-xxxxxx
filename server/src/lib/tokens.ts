import { jwtVerify, SignJWT } from 'jose';
import { randomBytes } from 'node:crypto';

/*
 * Two token kinds, both HS256 with JWT_SECRET:
 * - challenge (60 s): stateless login nonce the device must sign with Ed25519;
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
  try {
    const { payload } = await jwtVerify(token, secret(), { issuer: ISSUER, algorithms: ['HS256'] });
    return payload.typ === 'access' && typeof payload.sub === 'string' ? payload.sub : null;
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

export async function verifyChallenge(challenge: string): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(challenge, secret(), { issuer: ISSUER, algorithms: ['HS256'] });
    return payload.typ === 'challenge' && typeof payload.sub === 'string' ? payload.sub : null;
  } catch {
    return null;
  }
}
