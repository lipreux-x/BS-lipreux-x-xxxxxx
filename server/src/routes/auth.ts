import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import { db } from '../db/client';
import { invites, loginAttempts, profiles, usedChallenges } from '../db/schema';
import {
  backupAuthHash,
  backupAuthMatches,
  decoySalt,
  frame,
  fromB64,
  normalizeInviteCode,
  openAtRest,
  sealAtRest,
  sha256Hex,
  utf8,
  verifyEd25519,
} from '../lib/crypto';
import { issueAccessToken, issueChallenge, verifyChallenge } from '../lib/tokens';
import {
  b64Bytes,
  BACKUP_PARAMS,
  body,
  keyBackup,
  LOGIN_FAILURES_PER_HOUR,
  LOGIN_FAILURES_PER_HOUR_ALL,
  REGISTER_FAILURES_PER_INVITE,
  tooManyAttempts,
  username,
  type Env,
} from './_shared';

// ---- Auth: invite-only registration, then device-key challenge login --------

export const auth = new Hono<Env>();

auth.post('/auth/register', async (c) => {
  const input = await body(
    c,
    z.object({
      inviteCode: z.string().min(1).max(64),
      username,
      publicKeyBox: b64Bytes({ exact: 32 }),
      publicKeySign: b64Bytes({ exact: 32 }),
      // Ed25519 over frame('bs/v1/register', invite, username, pkBox, pkSign): proves key possession.
      proof: b64Bytes({ exact: 64 }),
      // Required: the password is how the account comes back on a new phone.
      backup: keyBackup,
    }),
  );
  // The name a deleted account is left with (DELETE /me): nobody else can take it.
  if (/^deleted_/i.test(input.username)) throw new HTTPException(409, { message: 'username_taken' });
  const invite = normalizeInviteCode(input.inviteCode);
  const pkBox = fromB64(input.publicKeyBox)!;
  const pkSign = fromB64(input.publicKeySign)!;
  const message = frame(utf8('bs/v1/register'), utf8(invite), utf8(input.username), pkBox, pkSign);
  if (!verifyEd25519(fromB64(input.proof)!, message, pkSign)) throw new HTTPException(400, { message: 'bad_proof' });

  const inviteHash = sha256Hex(invite);
  const userId = await db.transaction(async (tx) => {
    // Lock the invite row so it can only be consumed once.
    const [inv] = await tx.select().from(invites).where(eq(invites.codeHash, inviteHash)).for('update');
    if (!inv || inv.usedBy || inv.expiresAt < new Date() || inv.failedUses >= REGISTER_FAILURES_PER_INVITE) {
      throw new HTTPException(403, { message: 'invalid_invite' });
    }

    const [taken] = await tx
      .select({ id: profiles.id })
      .from(profiles)
      .where(sql`lower(${profiles.username}) = lower(${input.username})`);
    if (taken) return null;

    const [profile] = await tx
      .insert(profiles)
      .values({
        username: input.username,
        publicKeyBox: input.publicKeyBox,
        publicKeySign: input.publicKeySign,
        backupParams: JSON.stringify({ salt: input.backup.salt, ops: input.backup.ops, mem: input.backup.mem }),
        backupAuth: backupAuthHash(fromB64(input.backup.authKey)!),
        backupBox: sealAtRest(input.backup.box),
      })
      .returning({ id: profiles.id });
    await tx.update(invites).set({ usedBy: profile!.id }).where(eq(invites.codeHash, inv.codeHash));
    return profile!.id;
  });
  if (!userId) {
    // Counted outside the transaction so it sticks: one invite tests only a few usernames.
    await db
      .update(invites)
      .set({ failedUses: sql`${invites.failedUses} + 1` })
      .where(eq(invites.codeHash, inviteHash));
    throw new HTTPException(409, { message: 'username_taken' });
  }

  return c.json({ userId, accessToken: await issueAccessToken(userId) }, 201);
});

/*
 * Sign in again with username + password, on a phone that lost its data.
 * Step 1 gives the Argon2id parameters (a decoy for unknown usernames, so the
 * answer does not reveal who exists). Step 2 checks the derived authKey and
 * returns the identity, still sealed with the password: only the phone opens it.
 */
auth.post('/auth/recover/params', async (c) => {
  const input = await body(c, z.object({ username }));
  const [p] = await db.select({ params: profiles.backupParams }).from(profiles).where(eq(profiles.username, input.username));
  if (p?.params) return c.json(JSON.parse(p.params));
  return c.json({ salt: Buffer.from(decoySalt(input.username)).toString('base64url'), ...BACKUP_PARAMS });
});

auth.post('/auth/recover', async (c) => {
  const input = await body(c, z.object({ username, authKey: b64Bytes({ exact: 32 }) }));
  // Record first, then count: concurrent requests cannot slip past the limit.
  // The row goes again on success, so only failures count (per username, and
  // all usernames together against password spraying).
  await db.insert(loginAttempts).values({ username: input.username });
  const [counts] = await db
    .select({
      mine: sql<number>`(count(*) filter (where ${loginAttempts.username} = ${input.username}))::int`,
      all: sql<number>`count(*)::int`,
    })
    .from(loginAttempts)
    .where(gt(loginAttempts.attemptedAt, sql`now() - interval '1 hour'`));
  if ((counts?.mine ?? 0) > LOGIN_FAILURES_PER_HOUR || (counts?.all ?? 0) > LOGIN_FAILURES_PER_HOUR_ALL) tooManyAttempts(c);
  const [p] = await db.select().from(profiles).where(eq(profiles.username, input.username));
  if (!p?.backupAuth || !p.backupBox || !backupAuthMatches(fromB64(input.authKey)!, p.backupAuth)) {
    throw new HTTPException(401, { message: 'bad_credentials' });
  }
  // This attempt's row (the newest; compared in SQL, timestamps lose precision in JS).
  await db.execute(
    sql`delete from ${loginAttempts} where ctid = (select ctid from ${loginAttempts} where ${loginAttempts.username} = ${input.username} order by ${loginAttempts.attemptedAt} desc limit 1)`,
  );
  return c.json({ userId: p.id, box: openAtRest(p.backupBox) });
});

auth.post('/auth/challenge', async (c) => {
  const { userId } = await body(c, z.object({ userId: z.uuid() }));
  const [p] = await db.select({ id: profiles.id }).from(profiles).where(and(eq(profiles.id, userId), isNull(profiles.deletedAt)));
  if (!p) throw new HTTPException(404, { message: 'not_found' });
  return c.json({ challenge: await issueChallenge(userId) });
});

auth.post('/auth/token', async (c) => {
  const input = await body(c, z.object({ challenge: z.string().max(1024), signature: b64Bytes({ exact: 64 }) }));
  const challenge = await verifyChallenge(input.challenge);
  if (!challenge) throw new HTTPException(401, { message: 'bad_challenge' });
  const { userId } = challenge;
  const [p] = await db.select().from(profiles).where(eq(profiles.id, userId));
  const signed = frame(utf8('bs/v1/login'), utf8(input.challenge));
  if (!p || p.deletedAt || !verifyEd25519(fromB64(input.signature)!, signed, fromB64(p.publicKeySign)!)) {
    throw new HTTPException(401, { message: 'bad_signature' });
  }
  // Single use: a captured (challenge, signature) pair mints nothing more.
  const fresh = await db
    .insert(usedChallenges)
    .values({ nonce: challenge.nonce, expiresAt: challenge.expiresAt })
    .onConflictDoNothing()
    .returning({ nonce: usedChallenges.nonce });
  if (fresh.length === 0) throw new HTTPException(401, { message: 'bad_challenge' });
  return c.json({ accessToken: await issueAccessToken(userId) });
});
