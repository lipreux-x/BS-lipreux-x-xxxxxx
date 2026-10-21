import { parseTrigger, upgradeWebSocket } from '@neon/functions/hono';
import { and, eq, gt, gte, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import { Hono, type Context, type MiddlewareHandler } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import { db } from './db/client';
import {
  attachments,
  groupBans,
  groupKeys,
  groupMembers,
  groupPurges,
  groups,
  invites,
  joinAttempts,
  loginAttempts,
  messages,
  profiles,
  pushTokens,
  usedChallenges,
  userActions,
} from './db/schema';
import {
  backupAuthHash,
  backupAuthMatches,
  decoySalt,
  frame,
  fromB64,
  generateInviteCode,
  joinLookup,
  normalizeInviteCode,
  openAtRest,
  sealAtRest,
  sha256Hex,
  utf8,
  verifyEd25519,
} from './lib/crypto';
import { notifyAction, notifyGroup, PUSH_TOKEN } from './lib/push';
import { deleteObjects, downloadUrl, objectKey, uploadUrl } from './lib/storage';
import { issueAccessToken, issueChallenge, readAccessToken, verifyAccessToken, verifyChallenge } from './lib/tokens';
import { realtime } from './realtime';

type Env = { Variables: { userId: string; tokenExpiresAt: number } };

const INVITE_TTL_MS = 2 * 3_600_000; // an invite is handed over in person, right away
const JOIN_ATTEMPTS_PER_HOUR = 5; // SPEC §4.4: per user, all groups combined
const GROUP_JOIN_ATTEMPTS_PER_HOUR = 20; // SPEC §4.5: per group, all users combined (many accounts, one group)
const LOGIN_FAILURES_PER_HOUR = 5; // failed password sign-ins, per username
const LOGIN_FAILURES_PER_HOUR_ALL = 300; // all usernames together: password spraying
const OPEN_INVITES_PER_USER = 3; // unused and unexpired
const INVITES_PER_DAY = 10;
const GROUP_CODES_PER_DAY = 10; // group creations + code changes: each costs two Argon2id hashes
const MESSAGES_PER_MINUTE = 60;
const STORY_SECONDS = 24 * 3600; // a story's lifetime (mobile src/crypto/attachment.ts: STORY_TTL_SECONDS)
const REGISTER_FAILURES_PER_INVITE = 3; // username already taken
// Argon2id cost of a key backup (mobile src/crypto/backup.ts, native Argon2),
// also given for decoys. It is also the floor: a weaker backup is refused, so
// whoever holds the database cannot be handed an easier target.
const BACKUP_PARAMS = { ops: 3, mem: 64 * 1024 * 1024 };
const MAX_CIPHERTEXT_BYTES = 64 * 1024;
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024; // encrypted size, same limit as mobile crypto/attachment.ts
const UPLOADS_PER_HOUR = 60;
const MAX_GROUP_LIFETIME_DAYS = 366;
const MIN_GROUP_LIFETIME_MS = 10 * 60_000;

// ---- Validation --------------------------------------------------------------

const b64Bytes = (len?: { exact?: number; max?: number }) =>
  z.string().refine((s) => {
    const b = fromB64(s);
    if (!b) return false;
    if (len?.exact !== undefined && b.length !== len.exact) return false;
    if (len?.max !== undefined && b.length > len.max) return false;
    return true;
  }, 'invalid base64url');

const username = z.string().regex(/^[A-Za-z0-9_.-]{3,24}$/);
// Avatar icons only (mobile src/ui/avatars.tsx): no uploaded picture ever reaches the server.
export const AVATARS = ['mask', 'spy', 'bank', 'vault', 'gem', 'gold', 'loot', 'piggy', 'key', 'drill', 'lookout'] as const;
// Password-sealed identity (mobile src/crypto/backup.ts). Same bounds as the phone checks.
const keyBackup = z.object({
  salt: b64Bytes({ exact: 16 }),
  ops: z.number().int().min(BACKUP_PARAMS.ops).max(10),
  mem: z.number().int().min(BACKUP_PARAMS.mem).max(256 * 1024 * 1024).multipleOf(1024),
  authKey: b64Bytes({ exact: 32 }),
  box: b64Bytes({ max: 1024 }),
});
const keyVersion = z.number().int().min(1).max(1_000_000);
async function body<T extends z.ZodType>(c: Context, schema: T): Promise<z.infer<T>> {
  const json = await c.req.json().catch(() => undefined);
  const parsed = schema.safeParse(json);
  if (!parsed.success) throw new HTTPException(400, { message: 'invalid_body' });
  return parsed.data;
}

// ---- Helpers -----------------------------------------------------------------

/** A self-destructing group past its date is gone for everyone, even before the purge deletes it. */
const groupAlive = or(isNull(groups.expiresAt), gt(groups.expiresAt, sql`now()`));

const requireAuth: MiddlewareHandler<Env> = async (c, next) => {
  const header = c.req.header('authorization');
  const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
  const userId = token ? await verifyAccessToken(token) : null;
  if (!userId) throw new HTTPException(401, { message: 'unauthorized' });
  c.set('userId', userId);
  await next();
};

/** 404 rather than 403, so non-members cannot probe which groups exist. Pending requests are not members yet. */
async function requireMember(groupId: string, userId: string) {
  const [row] = await db
    .select({ role: groupMembers.role, currentKeyVersion: groups.currentKeyVersion, ephemeralSeconds: groups.ephemeralSeconds })
    .from(groupMembers)
    .innerJoin(groups, eq(groups.id, groupMembers.groupId))
    .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, userId), eq(groupMembers.status, 'active'), groupAlive));
  if (!row) throw new HTTPException(404, { message: 'not_found' });
  return row;
}

/** Records one `action` for the user, or 429 once the day's quota is spent. Record first, then count: races cannot slip past. */
async function spendQuota(userId: string, action: 'invite' | 'group_code', perDay: number) {
  await db.insert(userActions).values({ userId, action });
  const [{ count } = { count: 0 }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(userActions)
    .where(and(eq(userActions.userId, userId), eq(userActions.action, action), gt(userActions.at, sql`now() - interval '1 day'`)));
  if (count > perDay) throw new HTTPException(429, { message: 'too_many_requests' });
}

/*
 * Argon2id at 64 MiB per hash: only a few at a time per isolate, so a burst
 * of group creations cannot exhaust its memory. Over the cap: 503, retry.
 */
const MAX_CONCURRENT_HASHES = 4;
let hashing = 0;
async function withHashSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (hashing >= MAX_CONCURRENT_HASHES) throw new HTTPException(503, { message: 'busy' });
  hashing++;
  try {
    return await fn();
  } finally {
    hashing--;
  }
}

function groupIdParam(c: Context): string {
  return uuidParam(c, 'groupId');
}

function uuidParam(c: Context, name: string): string {
  const parsed = z.uuid().safeParse(c.req.param(name));
  if (!parsed.success) throw new HTTPException(404, { message: 'not_found' });
  return parsed.data;
}

const toWireMessage = (m: typeof messages.$inferSelect) => ({
  id: m.id,
  seq: m.seq,
  clientId: m.clientId,
  groupId: m.groupId,
  senderId: m.senderId,
  keyVersion: m.keyVersion,
  nonce: m.nonce,
  ciphertext: m.ciphertext,
  signature: m.signature,
  createdAt: m.createdAt.toISOString(),
  expiresAt: m.expiresAt?.toISOString() ?? null,
});
export type WireMessage = ReturnType<typeof toWireMessage>;

// ---- App ---------------------------------------------------------------------

export const app = new Hono<Env>();

app.onError((err, c) => {
  if (err instanceof HTTPException) return c.json({ error: err.message }, err.status);
  // Never log request data: only the error class (SPEC §4.7).
  console.error('[error]', err.name);
  return c.json({ error: 'internal' }, 500);
});

// A code change re-sends every key handout of the group: a bigger body.
const smallBody = bodyLimit({ maxSize: 128 * 1024 });
const largeBody = bodyLimit({ maxSize: 2 * 1024 * 1024 });
app.use('*', (c, next) => (c.req.method === 'PUT' && c.req.path.endsWith('/code') ? largeBody : smallBody)(c, next));

app.get('/health', (c) => c.json({ ok: true }));

// ---- Auth: invite-only registration, then device-key challenge login --------

app.post('/auth/register', async (c) => {
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
app.post('/auth/recover/params', async (c) => {
  const input = await body(c, z.object({ username }));
  const [p] = await db.select({ params: profiles.backupParams }).from(profiles).where(eq(profiles.username, input.username));
  if (p?.params) return c.json(JSON.parse(p.params));
  return c.json({ salt: Buffer.from(decoySalt(input.username)).toString('base64url'), ...BACKUP_PARAMS });
});

app.post('/auth/recover', async (c) => {
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
  if ((counts?.mine ?? 0) > LOGIN_FAILURES_PER_HOUR || (counts?.all ?? 0) > LOGIN_FAILURES_PER_HOUR_ALL) {
    c.header('Retry-After', '3600');
    throw new HTTPException(429, { message: 'too_many_attempts' });
  }
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

app.post('/auth/challenge', async (c) => {
  const { userId } = await body(c, z.object({ userId: z.uuid() }));
  const [p] = await db.select({ id: profiles.id }).from(profiles).where(eq(profiles.id, userId));
  if (!p) throw new HTTPException(404, { message: 'not_found' });
  return c.json({ challenge: await issueChallenge(userId) });
});

app.post('/auth/token', async (c) => {
  const input = await body(c, z.object({ challenge: z.string().max(1024), signature: b64Bytes({ exact: 64 }) }));
  const challenge = await verifyChallenge(input.challenge);
  if (!challenge) throw new HTTPException(401, { message: 'bad_challenge' });
  const { userId } = challenge;
  const [p] = await db.select().from(profiles).where(eq(profiles.id, userId));
  const signed = frame(utf8('bs/v1/login'), utf8(input.challenge));
  if (!p || !verifyEd25519(fromB64(input.signature)!, signed, fromB64(p.publicKeySign)!)) {
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

// ---- Everything below requires a valid access token -------------------------

app.use('/me', requireAuth);
app.use('/me/*', requireAuth);
app.use('/invites/*', requireAuth);
app.use('/invites', requireAuth);
app.use('/profiles', requireAuth);
app.use('/groups', requireAuth);
app.use('/groups/*', requireAuth);

app.get('/me', async (c) => {
  const [p] = await db.select().from(profiles).where(eq(profiles.id, c.get('userId')));
  if (!p) throw new HTTPException(404, { message: 'not_found' });
  return c.json({ id: p.id, username: p.username, publicKeyBox: p.publicKeyBox, publicKeySign: p.publicKeySign, avatar: p.avatar });
});

/** Picks one of the avatar icons, or null for the default silhouette. */
app.put('/me/avatar', async (c) => {
  const { avatar } = await body(c, z.object({ avatar: z.enum(AVATARS).nullable() }));
  await db.update(profiles).set({ avatar }).where(eq(profiles.id, c.get('userId')));
  return c.json({ avatar });
});

/** This phone's push token (the notification is a fixed generic line, see lib/push.ts). */
app.put('/me/push-token', async (c) => {
  const { token } = await body(c, z.object({ token: z.string().regex(PUSH_TOKEN) }));
  const userId = c.get('userId');
  // A token belongs to one phone: if it was another account's, it moves to this one.
  await db
    .insert(pushTokens)
    .values({ token, userId })
    .onConflictDoUpdate({ target: pushTokens.token, set: { userId, createdAt: sql`now()` } });
  return c.json({ ok: true });
});

app.delete('/me/push-token', async (c) => {
  const { token } = await body(c, z.object({ token: z.string().regex(PUSH_TOKEN) }));
  await db.delete(pushTokens).where(and(eq(pushTokens.token, token), eq(pushTokens.userId, c.get('userId'))));
  return c.json({ ok: true });
});

app.post('/invites', async (c) => {
  const me = c.get('userId');
  // Each invite is a new account: per-user limits mean little if accounts are free.
  const [{ open } = { open: 0 }] = await db
    .select({ open: sql<number>`count(*)::int` })
    .from(invites)
    .where(and(eq(invites.createdBy, me), isNull(invites.usedBy), gt(invites.expiresAt, sql`now()`)));
  if (open >= OPEN_INVITES_PER_USER) throw new HTTPException(429, { message: 'too_many_invites' });
  await spendQuota(me, 'invite', INVITES_PER_DAY);
  const code = generateInviteCode();
  const expiresAt = new Date(Date.now() + INVITE_TTL_MS);
  await db.insert(invites).values({ codeHash: sha256Hex(normalizeInviteCode(code)), createdBy: me, expiresAt });
  return c.json({ code, expiresAt: expiresAt.toISOString() }, 201);
});

/** Public keys of the caller and of people sharing at least one group with them. */
app.get('/profiles', async (c) => {
  const ids = z
    .array(z.uuid())
    .max(100)
    .safeParse((c.req.query('ids') ?? '').split(',').filter(Boolean));
  if (!ids.success) throw new HTTPException(400, { message: 'invalid_ids' });
  if (ids.data.length === 0) return c.json([]);
  const me = c.get('userId');
  const rows = await db
    .selectDistinct({
      id: profiles.id,
      username: profiles.username,
      publicKeyBox: profiles.publicKeyBox,
      publicKeySign: profiles.publicKeySign,
      avatar: profiles.avatar,
    })
    .from(profiles)
    .where(
      and(
        inArray(profiles.id, ids.data),
        or(
          eq(profiles.id, me),
          sql`exists (select 1 from ${groupMembers} a join ${groupMembers} b on a.group_id = b.group_id
                      where a.user_id = ${me} and a.status = 'active' and b.user_id = ${profiles.id})`,
          // Someone who left still signed the messages they wrote: their keys check them.
          sql`exists (select 1 from ${groupMembers} a join ${messages} m on m.group_id = a.group_id
                      where a.user_id = ${me} and a.status = 'active' and m.sender_id = ${profiles.id})`,
        ),
      ),
    );
  return c.json(rows);
});

// ---- Groups ------------------------------------------------------------------

/*
 * Trust model (SPEC §4.3–4.4). The server routes and stores; it cannot hand a
 * group key to anyone or swap one, because:
 * - every key handout is wrapped under a key derived from the group code +
 *   keywords (which the server never sees) and signed by an admin;
 * - the meta (name, keywords, admins, members) is encrypted under the group
 *   key and signed by an admin;
 * - a newcomer gets a key only when an admin approves them on their phone.
 * The checks below keep honest clients consistent and abusers out; the
 * phones verify everything that matters.
 */

const b64Key = b64Bytes({ exact: 32 });
const sealedKey = b64Bytes({ max: 256 });
const signature = b64Bytes({ exact: 64 });
const encryptedMeta = b64Bytes({ max: 32 * 1024 });
const ephemeral = z.union([z.literal(86_400), z.literal(604_800)]).nullable();

app.get('/groups', async (c) => {
  const me = c.get('userId');
  const rows = await db
    .select({
      id: groups.id,
      encryptedMeta: groups.encryptedMeta,
      metaSignerId: groups.metaSignerId,
      metaSignature: groups.metaSignature,
      currentKeyVersion: groups.currentKeyVersion,
      ephemeralSeconds: groups.ephemeralSeconds,
      rotationPending: groups.rotationPending,
      codeVersion: groups.codeVersion,
      expiresAt: groups.expiresAt,
      role: groupMembers.role,
      status: groupMembers.status,
    })
    .from(groupMembers)
    .innerJoin(groups, eq(groups.id, groupMembers.groupId))
    .where(and(eq(groupMembers.userId, me), groupAlive));
  const active = rows.filter((r) => r.status === 'active');
  const keys = active.length
    ? await db
        .select({
          groupId: groupKeys.groupId,
          keyVersion: groupKeys.keyVersion,
          sealedKey: groupKeys.sealedKey,
          signerId: groupKeys.signerId,
          signature: groupKeys.signature,
        })
        .from(groupKeys)
        .where(and(eq(groupKeys.userId, me), inArray(groupKeys.groupId, active.map((r) => r.id))))
    : [];
  return c.json(
    rows.map((g) =>
      g.status === 'pending'
        ? // Waiting for an admin: nothing of the group yet, not even its meta.
          { id: g.id, status: 'pending' as const, expiresAt: g.expiresAt?.toISOString() ?? null }
        : {
            ...g,
            expiresAt: g.expiresAt?.toISOString() ?? null,
            sealedKeys: keys
              .filter((k) => k.groupId === g.id)
              .map(({ keyVersion, sealedKey, signerId, signature }) => ({ keyVersion, sealedKey, signerId, signature })),
          },
    ),
  );
});

app.post('/groups', async (c) => {
  const input = await body(
    c,
    z.object({
      id: z.uuid(), // generated on the phone: bound into the meta and key handouts
      encryptedMeta,
      metaSignature: signature,
      joinKey: b64Key,
      sealedKey,
      keySignature: signature,
      ephemeralSeconds: ephemeral.optional(),
      // Self-destruct date, chosen at creation only.
      expiresAt: z.iso.datetime().nullable().optional(),
    }),
  );
  const me = c.get('userId');
  const expiresAt = input.expiresAt ? new Date(input.expiresAt) : null;
  if (expiresAt) {
    const ms = expiresAt.getTime() - Date.now();
    if (ms < MIN_GROUP_LIFETIME_MS || ms > MAX_GROUP_LIFETIME_DAYS * 86_400_000) throw new HTTPException(400, { message: 'invalid_expiry' });
  }
  // Each creation can tell whether a code + keywords pair is in use: a guess, so a quota.
  await spendQuota(me, 'group_code', GROUP_CODES_PER_DAY);
  const lookup = joinLookup(fromB64(input.joinKey)!);
  await db.transaction(async (tx) => {
    // Unique, so the code + keywords identify the group to join.
    const [taken] = await tx.select({ id: groups.id }).from(groups).where(eq(groups.joinLookup, lookup));
    if (taken) throw new HTTPException(409, { message: 'code_taken' });
    const inserted = await tx
      .insert(groups)
      .values({
        id: input.id,
        encryptedMeta: input.encryptedMeta,
        metaSignerId: me,
        metaSignature: input.metaSignature,
        joinLookup: lookup,
        createdBy: me,
        ephemeralSeconds: input.ephemeralSeconds ?? null,
        expiresAt,
      })
      .onConflictDoNothing()
      .returning({ id: groups.id });
    if (inserted.length === 0) throw new HTTPException(409, { message: 'group_exists' });
    await tx.insert(groupMembers).values({ groupId: input.id, userId: me, role: 'admin', status: 'active' });
    await tx.insert(groupKeys).values({
      groupId: input.id,
      userId: me,
      keyVersion: 1,
      sealedKey: input.sealedKey,
      signerId: me,
      signature: input.keySignature,
    });
  });
  return c.json({ id: input.id, currentKeyVersion: 1 }, 201);
});

/**
 * Asks to join with the key derived from the code + 3 keywords. Success only
 * creates a pending membership: an admin approves it from their phone, which
 * hands over the group key. Banned users get the same answer as a wrong code.
 */
app.post('/groups/join', async (c) => {
  const input = await body(c, z.object({ joinKey: b64Key }));
  const me = c.get('userId');

  // Record first, then count: concurrent requests cannot slip past the limit.
  // Per user (SPEC §4.4), and per group for groups the key did match.
  const [group] = await db
    .select({ id: groups.id })
    .from(groups)
    .where(and(eq(groups.joinLookup, joinLookup(fromB64(input.joinKey)!)), groupAlive));
  await db.insert(joinAttempts).values({ userId: me, groupId: group?.id ?? null });
  const [counts] = await db
    .select({
      mine: sql<number>`(count(*) filter (where ${joinAttempts.userId} = ${me}))::int`,
      group: group ? sql<number>`(count(*) filter (where ${joinAttempts.groupId} = ${group.id}))::int` : sql<number>`0`,
    })
    .from(joinAttempts)
    .where(and(gt(joinAttempts.attemptedAt, sql`now() - interval '1 hour'`), or(eq(joinAttempts.userId, me), group ? eq(joinAttempts.groupId, group.id) : sql`false`)));
  if ((counts?.mine ?? 0) > JOIN_ATTEMPTS_PER_HOUR || (counts?.group ?? 0) > GROUP_JOIN_ATTEMPTS_PER_HOUR) {
    c.header('Retry-After', '3600');
    throw new HTTPException(429, { message: 'too_many_attempts' });
  }
  if (!group) throw new HTTPException(403, { message: 'wrong_code' });
  const [banned] = await db
    .select({ userId: groupBans.userId })
    .from(groupBans)
    .where(and(eq(groupBans.groupId, group.id), eq(groupBans.userId, me)));
  if (banned) throw new HTTPException(403, { message: 'wrong_code' });

  const filed = await db
    .insert(groupMembers)
    .values({ groupId: group.id, userId: me, role: 'member', status: 'pending' })
    .onConflictDoNothing()
    .returning({ userId: groupMembers.userId });
  const [row] = await db
    .select({ status: groupMembers.status })
    .from(groupMembers)
    .where(and(eq(groupMembers.groupId, group.id), eq(groupMembers.userId, me)));
  // A new request: the admins have someone to let in (asking again does not ring twice).
  if (filed.length) await notifyAction(group.id, 'admins', me);
  return c.json({ groupId: group.id, status: row!.status });
});

/** Active members, with the key versions each one holds (for rotation and code changes), and pending requests. */
app.get('/groups/:groupId/members', async (c) => {
  const groupId = groupIdParam(c);
  const { currentKeyVersion, role } = await requireMember(groupId, c.get('userId'));
  const rows = await db
    .select({ userId: groupMembers.userId, role: groupMembers.role, status: groupMembers.status, joinedAt: groupMembers.joinedAt })
    .from(groupMembers)
    .where(eq(groupMembers.groupId, groupId))
    .orderBy(groupMembers.joinedAt);
  const held = await db
    .select({ userId: groupKeys.userId, keyVersion: groupKeys.keyVersion })
    .from(groupKeys)
    .where(eq(groupKeys.groupId, groupId));
  const members = rows
    .filter((r) => r.status === 'active')
    .map((r) => ({
      userId: r.userId,
      role: r.role,
      keyVersions: held.filter((h) => h.userId === r.userId).map((h) => h.keyVersion),
    }));
  // Only admins decide on requests; members do not see who knocked.
  const pending =
    role === 'admin'
      ? rows.filter((r) => r.status === 'pending').map((r) => ({ userId: r.userId, requestedAt: r.joinedAt.toISOString() }))
      : [];
  return c.json({ currentKeyVersion, members, pending });
});

/** Admin: accepts a request, handing over the current key and the meta that now lists the newcomer. */
app.post('/groups/:groupId/members/:userId/approve', async (c) => {
  const groupId = groupIdParam(c);
  const me = c.get('userId');
  const target = uuidParam(c, 'userId');
  const input = await body(c, z.object({ keyVersion, sealedKey, keySignature: signature, encryptedMeta, metaSignature: signature }));
  await requireAdmin(groupId, me);
  await db.transaction(async (tx) => {
    const [g] = await tx.select({ currentKeyVersion: groups.currentKeyVersion }).from(groups).where(eq(groups.id, groupId)).for('update');
    if (!g || g.currentKeyVersion !== input.keyVersion) throw new HTTPException(409, { message: 'stale_key_version' });
    const approved = await tx
      .update(groupMembers)
      .set({ status: 'active' })
      .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, target), eq(groupMembers.status, 'pending')))
      .returning({ userId: groupMembers.userId });
    if (approved.length === 0) throw new HTTPException(404, { message: 'not_found' });
    await tx.insert(groupKeys).values({
      groupId,
      userId: target,
      keyVersion: input.keyVersion,
      sealedKey: input.sealedKey,
      signerId: me,
      signature: input.keySignature,
    });
    await tx
      .update(groups)
      .set({ encryptedMeta: input.encryptedMeta, metaSignerId: me, metaSignature: input.metaSignature })
      .where(eq(groups.id, groupId));
  });
  realtime.nudge();
  await notifyAction(groupId, [target]);
  return c.json({ approved: true });
});

/** Admin: turns a request down. The user may ask again (a removal, not a refusal, bans). */
app.post('/groups/:groupId/members/:userId/reject', async (c) => {
  const groupId = groupIdParam(c);
  const target = uuidParam(c, 'userId');
  await requireAdmin(groupId, c.get('userId'));
  const rows = await db
    .delete(groupMembers)
    .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, target), eq(groupMembers.status, 'pending')))
    .returning({ userId: groupMembers.userId });
  if (rows.length === 0) throw new HTTPException(404, { message: 'not_found' });
  return c.json({ rejected: true });
});

// ---- Group settings ----------------------------------------------------------

/**
 * Removes a member and flags the group for key rotation: the leaver keeps the
 * old keys (and history), but the next key is drawn by an admin's phone and
 * sealed only to those who stay (SPEC §4.3). The last member out deletes the
 * group. The last admin must hand the role over before leaving (PUT /admins).
 */
async function removeMember(groupId: string, userId: string, ban: boolean) {
  const orphaned = await db.transaction(async (tx): Promise<string[]> => {
    await tx.select({ id: groups.id }).from(groups).where(eq(groups.id, groupId)).for('update');
    await tx.delete(groupMembers).where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, userId)));
    await tx.delete(groupKeys).where(and(eq(groupKeys.groupId, groupId), eq(groupKeys.userId, userId)));
    if (ban) await tx.insert(groupBans).values({ groupId, userId }).onConflictDoNothing();
    const rest = await tx
      .select({ userId: groupMembers.userId })
      .from(groupMembers)
      .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.status, 'active')));
    if (rest.length === 0) {
      const files = await tx.select({ id: attachments.id }).from(attachments).where(eq(attachments.groupId, groupId));
      await tx.delete(joinAttempts).where(eq(joinAttempts.groupId, groupId));
      await tx.delete(groups).where(eq(groups.id, groupId));
      return files.map((f) => objectKey(groupId, f.id));
    }
    await tx.update(groups).set({ rotationPending: true }).where(eq(groups.id, groupId));
    return [];
  });
  // After the commit: a storage failure must not keep the group alive. Blobs are
  // encrypted with keys only the members held, so a leftover is unreadable.
  if (orphaned.length) await deleteObjects(orphaned).catch((e: Error) => console.error('[storage]', e.name));
}

async function requireAdmin(groupId: string, userId: string) {
  const row = await requireMember(groupId, userId);
  if (row.role !== 'admin') throw new HTTPException(403, { message: 'admin_only' });
  return row;
}

async function adminCount(groupId: string): Promise<number> {
  const [{ n } = { n: 0 }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(groupMembers)
    .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.role, 'admin'), eq(groupMembers.status, 'active')));
  return n;
}

async function activeCount(groupId: string): Promise<number> {
  const [{ n } = { n: 0 }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(groupMembers)
    .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.status, 'active')));
  return n;
}

app.post('/groups/:groupId/leave', async (c) => {
  const groupId = groupIdParam(c);
  const me = c.get('userId');
  const { role } = await requireMember(groupId, me);
  // Nobody could approve newcomers or rotate keys any more.
  if (role === 'admin' && (await adminCount(groupId)) === 1 && (await activeCount(groupId)) > 1) {
    throw new HTTPException(409, { message: 'handover_required' });
  }
  await removeMember(groupId, me, false);
  await notifyAction(groupId, 'admins', me);
  return c.json({ left: true });
});

/** Admin: removes a member for good (banned: the code they know no longer lets them back in). */
app.post('/groups/:groupId/members/:userId/remove', async (c) => {
  const groupId = groupIdParam(c);
  const me = c.get('userId');
  await requireAdmin(groupId, me);
  const target = uuidParam(c, 'userId');
  if (target === me) throw new HTTPException(400, { message: 'invalid_member' });
  const [row] = await db
    .select({ userId: groupMembers.userId })
    .from(groupMembers)
    .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, target), eq(groupMembers.status, 'active')));
  if (!row) throw new HTTPException(404, { message: 'not_found' });
  await removeMember(groupId, target, true);
  return c.json({ removed: true });
});

/**
 * Admin: key rotation. The admin's phone drew a new group key, sealed it to
 * every active member (itself included), signed each handout and wrote the
 * new signed meta, whose admin list the server mirrors in `role`. The key set
 * must cover exactly the active members: nobody who left gets it and nobody
 * who stays is left out.
 */
app.post('/groups/:groupId/rotate', async (c) => {
  const groupId = groupIdParam(c);
  const me = c.get('userId');
  const input = await body(
    c,
    z.object({
      fromKeyVersion: keyVersion,
      encryptedMeta,
      metaSignature: signature,
      admins: z.array(z.uuid()).min(1).max(500),
      keys: z.array(z.object({ userId: z.uuid(), sealedKey, signature })).min(1).max(500),
    }),
  );
  await requireAdmin(groupId, me);
  const next = await db.transaction(async (tx) => {
    const [g] = await tx
      .select({ currentKeyVersion: groups.currentKeyVersion })
      .from(groups)
      .where(eq(groups.id, groupId))
      .for('update');
    if (!g || g.currentKeyVersion !== input.fromKeyVersion) throw new HTTPException(409, { message: 'stale_key_version' });
    const members = await tx
      .select({ userId: groupMembers.userId })
      .from(groupMembers)
      .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.status, 'active')));
    const ids = new Set(members.map((m) => m.userId));
    const sent = new Set(input.keys.map((k) => k.userId));
    if (sent.size !== input.keys.length || sent.size !== ids.size || ![...ids].every((id) => sent.has(id))) {
      throw new HTTPException(409, { message: 'members_changed' });
    }
    if (!input.admins.every((a) => ids.has(a))) throw new HTTPException(400, { message: 'invalid_admins' });
    const v = g.currentKeyVersion + 1;
    await tx
      .insert(groupKeys)
      .values(input.keys.map((k) => ({ groupId, userId: k.userId, keyVersion: v, sealedKey: k.sealedKey, signerId: me, signature: k.signature })));
    await tx
      .update(groups)
      .set({ currentKeyVersion: v, encryptedMeta: input.encryptedMeta, metaSignerId: me, metaSignature: input.metaSignature, rotationPending: false })
      .where(eq(groups.id, groupId));
    await setAdmins(tx, groupId, input.admins);
    return v;
  });
  realtime.nudge();
  return c.json({ currentKeyVersion: next });
});

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function setAdmins(tx: Tx, groupId: string, admins: string[]) {
  await tx
    .update(groupMembers)
    .set({ role: sql`case when ${inArray(groupMembers.userId, admins)} then 'admin' else 'member' end` })
    .where(eq(groupMembers.groupId, groupId));
}

/** Admin: changes who the admins are (e.g. before leaving), with the signed meta listing them. */
app.put('/groups/:groupId/admins', async (c) => {
  const groupId = groupIdParam(c);
  const me = c.get('userId');
  const input = await body(c, z.object({ keyVersion, admins: z.array(z.uuid()).min(1).max(500), encryptedMeta, metaSignature: signature }));
  await requireAdmin(groupId, me);
  await db.transaction(async (tx) => {
    const [g] = await tx.select({ currentKeyVersion: groups.currentKeyVersion }).from(groups).where(eq(groups.id, groupId)).for('update');
    if (!g || g.currentKeyVersion !== input.keyVersion) throw new HTTPException(409, { message: 'stale_key_version' });
    const members = await tx
      .select({ userId: groupMembers.userId })
      .from(groupMembers)
      .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.status, 'active'), inArray(groupMembers.userId, input.admins)));
    if (members.length !== new Set(input.admins).size) throw new HTTPException(400, { message: 'invalid_admins' });
    await tx
      .update(groups)
      .set({ encryptedMeta: input.encryptedMeta, metaSignerId: me, metaSignature: input.metaSignature })
      .where(eq(groups.id, groupId));
    await setAdmins(tx, groupId, input.admins);
  });
  return c.json({ admins: input.admins });
});

/**
 * Admin: new code + keywords. New join key for future requests, the meta
 * re-encrypted with the new keywords, and every key handout re-wrapped under
 * the new code (the old code no longer opens anything on the server).
 */
app.put('/groups/:groupId/code', async (c) => {
  const groupId = groupIdParam(c);
  const me = c.get('userId');
  const input = await body(
    c,
    z.object({
      joinKey: b64Key,
      keyVersion,
      encryptedMeta,
      metaSignature: signature,
      keys: z.array(z.object({ userId: z.uuid(), keyVersion, sealedKey, signature })).max(5000),
    }),
  );
  await requireAdmin(groupId, me);
  await spendQuota(me, 'group_code', GROUP_CODES_PER_DAY);
  const lookup = joinLookup(fromB64(input.joinKey)!);
  const codeVersion = await db.transaction(async (tx) => {
    const [g] = await tx
      .select({ currentKeyVersion: groups.currentKeyVersion, codeVersion: groups.codeVersion })
      .from(groups)
      .where(eq(groups.id, groupId))
      .for('update');
    if (!g || g.currentKeyVersion !== input.keyVersion) throw new HTTPException(409, { message: 'stale_key_version' });
    const [taken] = await tx.select({ id: groups.id }).from(groups).where(eq(groups.joinLookup, lookup));
    if (taken && taken.id !== groupId) throw new HTTPException(409, { message: 'code_taken' });
    // Every handout is replaced or dropped: one left under the old code would stay openable with it.
    // Dropped: versions older than the admin's own (they cannot re-wrap them); only history on a new phone is lost.
    const held = await tx.select({ userId: groupKeys.userId, keyVersion: groupKeys.keyVersion }).from(groupKeys).where(eq(groupKeys.groupId, groupId));
    const exists = new Set(held.map((h) => `${h.userId}/${h.keyVersion}`));
    const sent = new Set(input.keys.map((k) => `${k.userId}/${k.keyVersion}`));
    if (sent.size !== input.keys.length || ![...sent].every((k) => exists.has(k))) throw new HTTPException(409, { message: 'members_changed' });
    // The current key must reach every active member, or someone would be locked out.
    const active = await tx
      .select({ userId: groupMembers.userId })
      .from(groupMembers)
      .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.status, 'active')));
    if (!active.every((m) => sent.has(`${m.userId}/${g.currentKeyVersion}`))) throw new HTTPException(409, { message: 'members_changed' });
    await tx.delete(groupKeys).where(eq(groupKeys.groupId, groupId));
    if (input.keys.length) {
      await tx
        .insert(groupKeys)
        .values(input.keys.map((k) => ({ groupId, userId: k.userId, keyVersion: k.keyVersion, sealedKey: k.sealedKey, signerId: me, signature: k.signature })));
    }
    await tx
      .update(groups)
      .set({ joinLookup: lookup, encryptedMeta: input.encryptedMeta, metaSignerId: me, metaSignature: input.metaSignature, codeVersion: g.codeVersion + 1 })
      .where(eq(groups.id, groupId));
    return g.codeVersion + 1;
  });
  await notifyAction(groupId, 'members', me);
  return c.json({ codeVersion });
});

/** Admin: disappearing messages, for messages sent from now on. */
app.put('/groups/:groupId/ephemeral', async (c) => {
  const groupId = groupIdParam(c);
  const input = await body(c, z.object({ seconds: ephemeral }));
  await requireAdmin(groupId, c.get('userId'));
  await db.update(groups).set({ ephemeralSeconds: input.seconds }).where(eq(groups.id, groupId));
  return c.json({ ephemeralSeconds: input.seconds });
});

// ---- Messages ----------------------------------------------------------------

app.post('/groups/:groupId/messages', async (c) => {
  const groupId = groupIdParam(c);
  const input = await body(
    c,
    z.object({
      clientId: z.uuid(),
      keyVersion,
      nonce: b64Bytes({ exact: 24 }),
      ciphertext: b64Bytes({ max: MAX_CIPHERTEXT_BYTES }),
      signature,
      // Image or voice message: the upload it refers to (the file key is inside the ciphertext).
      attachmentId: z.uuid().optional(),
      // A story: lives 24 h, even in a group without disappearing messages (never longer than them).
      expiresInSeconds: z.literal(STORY_SECONDS).optional(),
    }),
  );
  const me = c.get('userId');
  const { currentKeyVersion, ephemeralSeconds } = await requireMember(groupId, me);
  if (input.keyVersion !== currentKeyVersion) throw new HTTPException(409, { message: 'stale_key_version' });
  const { attachmentId, expiresInSeconds, ...msg } = input;
  const lifetimes = [ephemeralSeconds, expiresInSeconds].filter((s): s is number => !!s);
  const expiresAt = lifetimes.length ? new Date(Date.now() + Math.min(...lifetimes) * 1000) : null;

  const row = await db.transaction(async (tx) => {
    // One sender at a time: the rate limit below cannot be raced.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'send:' + me}))`);
    const [{ recent } = { recent: 0 }] = await tx
      .select({ recent: sql<number>`count(*)::int` })
      .from(messages)
      .where(and(eq(messages.senderId, me), gt(messages.createdAt, sql`now() - interval '1 minute'`)));
    if (recent >= MESSAGES_PER_MINUTE) throw new HTTPException(429, { message: 'too_many_messages' });
    await tx
      .insert(messages)
      .values({
        ...msg,
        groupId,
        senderId: me,
        expiresAt,
      })
      .onConflictDoNothing({ target: [messages.senderId, messages.clientId] });
    // Idempotent: a replayed send returns the row stored the first time (in this group only).
    const [stored] = await tx
      .select()
      .from(messages)
      .where(and(eq(messages.senderId, me), eq(messages.clientId, input.clientId)));
    if (stored!.groupId !== groupId) throw new HTTPException(409, { message: 'client_id_reused' });
    if (attachmentId) {
      // Only our own upload, in this group, not used by another message yet (or
      // by this same message, on a replay). It now lives as long as the message.
      const linked = await tx
        .update(attachments)
        .set({ messageId: stored!.id })
        .where(
          and(
            eq(attachments.id, attachmentId),
            eq(attachments.groupId, groupId),
            eq(attachments.uploaderId, me),
            or(isNull(attachments.messageId), eq(attachments.messageId, stored!.id)),
          ),
        )
        .returning({ id: attachments.id });
      if (linked.length === 0) throw new HTTPException(400, { message: 'invalid_attachment' });
    }
    return stored!;
  });
  realtime.nudge();
  // A replayed send (same clientId, already stored earlier) does not ring again.
  if (Date.now() - row.createdAt.getTime() < 60_000) await notifyGroup(groupId, me);
  return c.json(toWireMessage(row), 201);
});

/** Resync: everything after a cursor, oldest first. */
app.get('/groups/:groupId/messages', async (c) => {
  const groupId = groupIdParam(c);
  const after = z.coerce.number().int().min(0).catch(0).parse(c.req.query('after'));
  const limit = z.coerce.number().int().min(1).max(200).catch(100).parse(c.req.query('limit'));
  await requireMember(groupId, c.get('userId'));
  const rows = await db
    .select()
    .from(messages)
    .where(
      and(
        eq(messages.groupId, groupId),
        gt(messages.seq, after),
        or(isNull(messages.expiresAt), gt(messages.expiresAt, sql`now()`)),
      ),
    )
    .orderBy(messages.seq)
    .limit(limit);
  // Latest erase of this group's history: a phone that saw a lower one reloads the conversation.
  const [{ purgeSeq } = { purgeSeq: 0 }] = await db
    .select({ purgeSeq: sql<number>`coalesce(max(${groupPurges.seq}), 0)::int` })
    .from(groupPurges)
    .where(eq(groupPurges.groupId, groupId));
  return c.json({ messages: rows.map(toWireMessage), hasMore: rows.length === limit, purgeSeq });
});

/**
 * Admin: erases every message sent in [from, to) (a day or a few, in the
 * admin's local time) for everyone, with their images. The span itself is
 * not recorded: only that the history changed, so phones reload it.
 */
app.post('/groups/:groupId/messages/erase', async (c) => {
  const groupId = groupIdParam(c);
  const input = await body(c, z.object({ from: z.iso.datetime(), to: z.iso.datetime() }));
  const from = new Date(input.from);
  const to = new Date(input.to);
  if (from >= to) throw new HTTPException(400, { message: 'invalid_range' });
  await requireAdmin(groupId, c.get('userId'));
  const inSpan = and(eq(messages.groupId, groupId), gte(messages.createdAt, from), lt(messages.createdAt, to));

  // The files go with their messages: attachment rows are detached (set null)
  // and their objects deleted here; anything left over (storage failure, a
  // message sent meanwhile) is an unlinked row the purge sweeps.
  const { deleted, files } = await db.transaction(async (tx) => {
    const files = await tx
      .select({ id: attachments.id })
      .from(attachments)
      .innerJoin(messages, eq(messages.id, attachments.messageId))
      .where(inSpan);
    const rows = await tx.delete(messages).where(inSpan).returning({ id: messages.id });
    if (rows.length) await tx.insert(groupPurges).values({ groupId });
    return { deleted: rows.length, files };
  });
  if (files.length) {
    await deleteObjects(files.map((f) => objectKey(groupId, f.id)))
      .then(() => db.delete(attachments).where(inArray(attachments.id, files.map((f) => f.id))))
      .catch((e: Error) => console.error('[storage]', e.name));
  }
  if (deleted) realtime.nudge();
  return c.json({ deleted });
});

// ---- Attachments (encrypted on the phone, SPEC §4.3) -------------------------

/** Reserves an attachment id and returns a short-lived URL to PUT exactly `size` encrypted bytes. */
app.post('/groups/:groupId/attachments', async (c) => {
  const groupId = groupIdParam(c);
  const { size } = await body(c, z.object({ size: z.number().int().min(1).max(MAX_ATTACHMENT_BYTES) }));
  const me = c.get('userId');
  await requireMember(groupId, me);
  const row = await db.transaction(async (tx) => {
    // One reservation at a time per user: the hourly limit cannot be raced.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'upload:' + me}))`);
    const [{ count } = { count: 0 }] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(attachments)
      .where(and(eq(attachments.uploaderId, me), gt(attachments.createdAt, sql`now() - interval '1 hour'`)));
    if (count >= UPLOADS_PER_HOUR) {
      c.header('Retry-After', '3600');
      throw new HTTPException(429, { message: 'too_many_uploads' });
    }
    const [row] = await tx.insert(attachments).values({ groupId, uploaderId: me, size }).returning({ id: attachments.id });
    return row!;
  });
  return c.json({ id: row.id, uploadUrl: await uploadUrl(objectKey(groupId, row.id), size) }, 201);
});

/** Short-lived URL to GET the encrypted blob of an image or voice message that is still visible. */
app.get('/groups/:groupId/attachments/:attachmentId', async (c) => {
  const groupId = groupIdParam(c);
  const attachmentId = z.uuid().safeParse(c.req.param('attachmentId'));
  if (!attachmentId.success) throw new HTTPException(404, { message: 'not_found' });
  await requireMember(groupId, c.get('userId'));
  const [row] = await db
    .select({ id: attachments.id })
    .from(attachments)
    .innerJoin(messages, eq(messages.id, attachments.messageId))
    .where(
      and(
        eq(attachments.id, attachmentId.data),
        eq(attachments.groupId, groupId),
        or(isNull(messages.expiresAt), gt(messages.expiresAt, sql`now()`)),
      ),
    );
  if (!row) throw new HTTPException(404, { message: 'not_found' });
  return c.json({ url: await downloadUrl(objectKey(groupId, row.id)) });
});

// ---- Realtime ----------------------------------------------------------------

app.get(
  '/ws',
  // Native clients can't always set headers on a WebSocket: token in the query.
  async (c, next) => {
    const token = await readAccessToken(c.req.query('token') ?? '');
    if (!token) return c.text('unauthorized', 401);
    c.set('userId', token.userId);
    c.set('tokenExpiresAt', token.expiresAt);
    await next();
  },
  upgradeWebSocket((c) => {
    const userId = c.get('userId');
    const expiresAt = c.get('tokenExpiresAt');
    return {
      onOpen: (_e, ws) => realtime.add(ws, userId, expiresAt),
      onClose: (_e, ws) => realtime.remove(ws),
      onError: (_e, ws) => realtime.remove(ws),
      onMessage: () => {}, // client -> server traffic goes through HTTP (idempotent)
    };
  }),
);

// ---- Scheduled purge of expired messages and groups (Neon Function Trigger) -

app.post('/internal/purge', async (c) => {
  // Only Neon's scheduler can call this: its proxy strips client-sent x-neon-*
  // headers, so the invocation header proves the delivery came from a trigger.
  await parseTrigger(c);
  // One cutoff for every step, so nothing expires between two of them.
  const cutoff = new Date();

  // Files of expired messages, and uploads without a message for a day (never
  // sent, or left behind when their message went: rows are detached, not
  // deleted, so no object is ever forgotten). Storage first: if it fails,
  // the rows stay and the next run retries.
  const files = await db
    .select({ id: attachments.id, groupId: attachments.groupId })
    .from(attachments)
    .leftJoin(messages, eq(messages.id, attachments.messageId))
    .where(
      or(
        lt(messages.expiresAt, cutoff),
        and(isNull(attachments.messageId), lt(attachments.createdAt, sql`now() - interval '1 day'`)),
      ),
    )
    .limit(1000);
  await deleteObjects(files.map((f) => objectKey(f.groupId, f.id)));
  if (files.length) await db.delete(attachments).where(inArray(attachments.id, files.map((f) => f.id)));
  const deleted = await db.delete(messages).where(lt(messages.expiresAt, cutoff)).returning({ id: messages.id });

  // Self-destructed groups: their files, then the group (members, keys,
  // messages and attachment rows cascade) and its join attempts.
  const dead = await db.select({ id: groups.id }).from(groups).where(lt(groups.expiresAt, cutoff));
  const deadIds = dead.map((g) => g.id);
  if (deadIds.length) {
    const groupFiles = await db
      .select({ id: attachments.id, groupId: attachments.groupId })
      .from(attachments)
      .where(inArray(attachments.groupId, deadIds));
    await deleteObjects(groupFiles.map((f) => objectKey(f.groupId, f.id)));
    await db.transaction(async (tx) => {
      await tx.delete(joinAttempts).where(inArray(joinAttempts.groupId, deadIds));
      await tx.delete(groups).where(inArray(groups.id, deadIds));
    });
  }

  // Bookkeeping that only serves rate limits and single use.
  await db.delete(loginAttempts).where(lt(loginAttempts.attemptedAt, sql`now() - interval '1 day'`));
  await db.delete(joinAttempts).where(lt(joinAttempts.attemptedAt, sql`now() - interval '1 day'`));
  await db.delete(userActions).where(lt(userActions.at, sql`now() - interval '2 days'`));
  await db.delete(usedChallenges).where(lt(usedChallenges.expiresAt, sql`now()`));
  await db.delete(invites).where(and(isNull(invites.usedBy), lt(invites.expiresAt, sql`now()`)));
  return c.json({ deleted: deleted.length, files: files.length, groups: deadIds.length });
});
