import { parseTrigger, upgradeWebSocket } from '@neon/functions/hono';
import { and, eq, gt, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import { Hono, type Context, type MiddlewareHandler } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import { db } from './db/client';
import { groupKeys, groupMembers, groups, invites, joinAttempts, messages, profiles } from './db/schema';
import {
  frame,
  fromB64,
  generateInviteCode,
  groupCodeLookup,
  hashGroupCode,
  hashKeywords,
  KEYWORD_COUNT,
  normalizeKeyword,
  normalizeInviteCode,
  sha256Hex,
  utf8,
  verifyEd25519,
  verifyGroupCode,
  verifyKeywords,
} from './lib/crypto';
import { issueAccessToken, issueChallenge, verifyAccessToken, verifyChallenge } from './lib/tokens';
import { realtime } from './realtime';

type Env = { Variables: { userId: string } };

const INVITE_TTL_DAYS = 7;
const JOIN_ATTEMPTS_PER_HOUR = 5; // SPEC §4.4: per user, all groups combined
const MAX_CIPHERTEXT_BYTES = 64 * 1024;

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
const groupCode = z.string().regex(/^[0-9A-Za-z]{6,64}$/); // same rule as mobile keywrap.ts
const keyVersion = z.number().int().min(1).max(1_000_000);
// 3 distinct words once normalized (case, accents, spaces ignored).
const keywords = z
  .array(z.string().max(40))
  .length(KEYWORD_COUNT)
  .refine((ws) => {
    const n = ws.map(normalizeKeyword);
    return n.every((w) => w.length > 0) && new Set(n).size === n.length;
  }, 'invalid keywords');

async function body<T extends z.ZodType>(c: Context, schema: T): Promise<z.infer<T>> {
  const json = await c.req.json().catch(() => undefined);
  const parsed = schema.safeParse(json);
  if (!parsed.success) throw new HTTPException(400, { message: 'invalid_body' });
  return parsed.data;
}

// ---- Helpers -----------------------------------------------------------------

const requireAuth: MiddlewareHandler<Env> = async (c, next) => {
  const header = c.req.header('authorization');
  const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
  const userId = token ? await verifyAccessToken(token) : null;
  if (!userId) throw new HTTPException(401, { message: 'unauthorized' });
  c.set('userId', userId);
  await next();
};

/** 404 rather than 403, so non-members cannot probe which groups exist. */
async function requireMember(groupId: string, userId: string) {
  const [row] = await db
    .select({ role: groupMembers.role, currentKeyVersion: groups.currentKeyVersion, ephemeralSeconds: groups.ephemeralSeconds })
    .from(groupMembers)
    .innerJoin(groups, eq(groups.id, groupMembers.groupId))
    .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, userId)));
  if (!row) throw new HTTPException(404, { message: 'not_found' });
  return row;
}

function groupIdParam(c: Context): string {
  const parsed = z.uuid().safeParse(c.req.param('groupId'));
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

app.use('*', bodyLimit({ maxSize: 128 * 1024 }));

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
    }),
  );
  const invite = normalizeInviteCode(input.inviteCode);
  const pkBox = fromB64(input.publicKeyBox)!;
  const pkSign = fromB64(input.publicKeySign)!;
  const message = frame(utf8('bs/v1/register'), utf8(invite), utf8(input.username), pkBox, pkSign);
  if (!verifyEd25519(fromB64(input.proof)!, message, pkSign)) throw new HTTPException(400, { message: 'bad_proof' });

  const userId = await db.transaction(async (tx) => {
    // Lock the invite row so it can only be consumed once.
    const [inv] = await tx
      .select()
      .from(invites)
      .where(eq(invites.codeHash, sha256Hex(invite)))
      .for('update');
    if (!inv || inv.usedBy || inv.expiresAt < new Date()) throw new HTTPException(403, { message: 'invalid_invite' });

    const [taken] = await tx.select({ id: profiles.id }).from(profiles).where(eq(profiles.username, input.username));
    if (taken) throw new HTTPException(409, { message: 'username_taken' });

    const [profile] = await tx
      .insert(profiles)
      .values({ username: input.username, publicKeyBox: input.publicKeyBox, publicKeySign: input.publicKeySign })
      .returning({ id: profiles.id });
    await tx.update(invites).set({ usedBy: profile!.id }).where(eq(invites.codeHash, inv.codeHash));
    return profile!.id;
  });

  return c.json({ userId, accessToken: await issueAccessToken(userId) }, 201);
});

app.post('/auth/challenge', async (c) => {
  const { userId } = await body(c, z.object({ userId: z.uuid() }));
  const [p] = await db.select({ id: profiles.id }).from(profiles).where(eq(profiles.id, userId));
  if (!p) throw new HTTPException(404, { message: 'not_found' });
  return c.json({ challenge: await issueChallenge(userId) });
});

app.post('/auth/token', async (c) => {
  const input = await body(c, z.object({ challenge: z.string().max(1024), signature: b64Bytes({ exact: 64 }) }));
  const userId = await verifyChallenge(input.challenge);
  if (!userId) throw new HTTPException(401, { message: 'bad_challenge' });
  const [p] = await db.select().from(profiles).where(eq(profiles.id, userId));
  const signed = frame(utf8('bs/v1/login'), utf8(input.challenge));
  if (!p || !verifyEd25519(fromB64(input.signature)!, signed, fromB64(p.publicKeySign)!)) {
    throw new HTTPException(401, { message: 'bad_signature' });
  }
  return c.json({ accessToken: await issueAccessToken(userId) });
});

// ---- Everything below requires a valid access token -------------------------

app.use('/me', requireAuth);
app.use('/invites/*', requireAuth);
app.use('/invites', requireAuth);
app.use('/profiles', requireAuth);
app.use('/groups', requireAuth);
app.use('/groups/*', requireAuth);

app.get('/me', async (c) => {
  const [p] = await db.select().from(profiles).where(eq(profiles.id, c.get('userId')));
  if (!p) throw new HTTPException(404, { message: 'not_found' });
  return c.json({ id: p.id, username: p.username, publicKeyBox: p.publicKeyBox, publicKeySign: p.publicKeySign });
});

app.post('/invites', async (c) => {
  const code = generateInviteCode();
  const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 86_400_000);
  await db.insert(invites).values({ codeHash: sha256Hex(normalizeInviteCode(code)), createdBy: c.get('userId'), expiresAt });
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
    })
    .from(profiles)
    .where(
      and(
        inArray(profiles.id, ids.data),
        or(
          eq(profiles.id, me),
          sql`exists (select 1 from ${groupMembers} a join ${groupMembers} b on a.group_id = b.group_id
                      where a.user_id = ${me} and b.user_id = ${profiles.id})`,
        ),
      ),
    );
  return c.json(rows);
});

// ---- Groups ------------------------------------------------------------------

app.get('/groups', async (c) => {
  const me = c.get('userId');
  const rows = await db
    .select({
      id: groups.id,
      encryptedMeta: groups.encryptedMeta,
      currentKeyVersion: groups.currentKeyVersion,
      ephemeralSeconds: groups.ephemeralSeconds,
      rotationPending: groups.rotationPending,
      codeVersion: groups.codeVersion,
      role: groupMembers.role,
    })
    .from(groupMembers)
    .innerJoin(groups, eq(groups.id, groupMembers.groupId))
    .where(eq(groupMembers.userId, me));
  const keys = rows.length
    ? await db
        .select({ groupId: groupKeys.groupId, keyVersion: groupKeys.keyVersion, sealedKey: groupKeys.sealedKey })
        .from(groupKeys)
        .where(and(eq(groupKeys.userId, me), inArray(groupKeys.groupId, rows.map((r) => r.id))))
    : [];
  return c.json(
    rows.map((g) => ({
      ...g,
      sealedKeys: keys.filter((k) => k.groupId === g.id).map(({ keyVersion, sealedKey }) => ({ keyVersion, sealedKey })),
    })),
  );
});

app.post('/groups', async (c) => {
  const input = await body(
    c,
    z.object({
      id: z.uuid(), // generated on the phone: bound into encryptedMeta's AD
      encryptedMeta: b64Bytes({ max: 16 * 1024 }),
      groupCode,
      keywords,
      sealedKey: b64Bytes({ max: 256 }),
      ephemeralSeconds: z.union([z.literal(86_400), z.literal(604_800)]).nullable().optional(),
    }),
  );
  const me = c.get('userId');
  const [codeHash, keywordsHash] = await Promise.all([hashGroupCode(input.groupCode), hashKeywords(input.keywords)]);
  const codeLookup = groupCodeLookup(input.groupCode);
  await db.transaction(async (tx) => {
    // Codes are unique so a code alone identifies the group to join.
    const [taken] = await tx.select({ id: groups.id }).from(groups).where(eq(groups.codeLookup, codeLookup));
    if (taken) throw new HTTPException(409, { message: 'code_taken' });
    const inserted = await tx
      .insert(groups)
      .values({
        id: input.id,
        encryptedMeta: input.encryptedMeta,
        codeHash,
        codeLookup,
        keywordsHash,
        createdBy: me,
        ephemeralSeconds: input.ephemeralSeconds ?? null,
      })
      .onConflictDoNothing()
      .returning({ id: groups.id });
    if (inserted.length === 0) throw new HTTPException(409, { message: 'group_exists' });
    await tx.insert(groupMembers).values({ groupId: input.id, userId: me, role: 'admin' });
    await tx.insert(groupKeys).values({ groupId: input.id, userId: me, keyVersion: 1, sealedKey: input.sealedKey });
  });
  return c.json({ id: input.id, currentKeyVersion: 1 }, 201);
});

/**
 * Join with the group code + the 3 keywords (groups created before keywords:
 * code alone). Success only grants membership: the group key itself arrives
 * later, sealed to the new member by an existing member.
 */
app.post('/groups/join', async (c) => {
  const input = await body(c, z.object({ groupCode: z.string().max(64), keywords: z.array(z.string().max(40)).max(KEYWORD_COUNT).optional() }));
  const me = c.get('userId');

  // Rate limit before any lookup (SPEC §4.4: per user, all groups combined).
  // Record first, then count: concurrent requests cannot slip past the limit.
  const lookup = groupCode.safeParse(input.groupCode).success ? groupCodeLookup(input.groupCode) : null;
  const [group] = lookup
    ? await db.select({ id: groups.id, codeHash: groups.codeHash, keywordsHash: groups.keywordsHash }).from(groups).where(eq(groups.codeLookup, lookup))
    : [];
  await db.insert(joinAttempts).values({ userId: me, groupId: group?.id ?? null });
  const [{ count } = { count: 0 }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(joinAttempts)
    .where(and(eq(joinAttempts.userId, me), gt(joinAttempts.attemptedAt, sql`now() - interval '1 hour'`)));
  if (count > JOIN_ATTEMPTS_PER_HOUR) {
    c.header('Retry-After', '3600');
    throw new HTTPException(429, { message: 'too_many_attempts' });
  }

  // Second factor on the match: the Argon2id hash of the same code, then the
  // keywords. Both always run and a failure never says which part was wrong.
  const [codeOk, keywordsOk] = group
    ? await Promise.all([
        verifyGroupCode(input.groupCode, group.codeHash),
        group.keywordsHash ? verifyKeywords(input.keywords ?? [], group.keywordsHash) : true,
      ])
    : [false, false];
  const ok = codeOk && keywordsOk;
  if (!ok || !group) throw new HTTPException(403, { message: 'wrong_code' });

  await db.insert(groupMembers).values({ groupId: group.id, userId: me, role: 'member' }).onConflictDoNothing();
  return c.json({ groupId: group.id });
});

app.get('/groups/:groupId/members', async (c) => {
  const groupId = groupIdParam(c);
  const { currentKeyVersion } = await requireMember(groupId, c.get('userId'));
  const rows = await db
    .select({
      userId: groupMembers.userId,
      role: groupMembers.role,
      hasCurrentKey: sql<boolean>`${groupKeys.userId} is not null`,
    })
    .from(groupMembers)
    .leftJoin(
      groupKeys,
      and(
        eq(groupKeys.groupId, groupMembers.groupId),
        eq(groupKeys.userId, groupMembers.userId),
        eq(groupKeys.keyVersion, currentKeyVersion),
      ),
    )
    .where(eq(groupMembers.groupId, groupId));
  return c.json({ currentKeyVersion, members: rows });
});

/** An existing member hands the group key (sealed) to members who lack it. */
app.post('/groups/:groupId/keys', async (c) => {
  const groupId = groupIdParam(c);
  const input = await body(
    c,
    z.object({
      keys: z.array(z.object({ userId: z.uuid(), keyVersion, sealedKey: b64Bytes({ max: 256 }) })).min(1).max(100),
    }),
  );
  const { currentKeyVersion } = await requireMember(groupId, c.get('userId'));
  if (input.keys.some((k) => k.keyVersion !== currentKeyVersion)) {
    throw new HTTPException(409, { message: 'stale_key_version' });
  }
  const members = await db
    .select({ userId: groupMembers.userId })
    .from(groupMembers)
    .where(and(eq(groupMembers.groupId, groupId), inArray(groupMembers.userId, input.keys.map((k) => k.userId))));
  const memberIds = new Set(members.map((m) => m.userId));
  const rows = input.keys.filter((k) => memberIds.has(k.userId)).map((k) => ({ groupId, ...k }));
  // First writer wins: a member cannot overwrite a key someone already holds.
  if (rows.length) await db.insert(groupKeys).values(rows).onConflictDoNothing();
  return c.json({ stored: rows.length });
});

// ---- Group settings ----------------------------------------------------------

/**
 * Removes a member and flags the group for key rotation: the leaver keeps the
 * old keys (and history), but the next key is drawn by a remaining member's
 * phone and sealed only to those who stay (SPEC §4.3). The last member out
 * deletes the group; if the last admin leaves, the oldest member becomes admin.
 */
async function removeMember(groupId: string, userId: string) {
  await db.transaction(async (tx) => {
    await tx.select({ id: groups.id }).from(groups).where(eq(groups.id, groupId)).for('update');
    await tx.delete(groupMembers).where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, userId)));
    await tx.delete(groupKeys).where(and(eq(groupKeys.groupId, groupId), eq(groupKeys.userId, userId)));
    const rest = await tx
      .select({ userId: groupMembers.userId, role: groupMembers.role })
      .from(groupMembers)
      .where(eq(groupMembers.groupId, groupId))
      .orderBy(groupMembers.joinedAt);
    if (rest.length === 0) {
      await tx.delete(groups).where(eq(groups.id, groupId));
      return;
    }
    if (!rest.some((m) => m.role === 'admin')) {
      await tx
        .update(groupMembers)
        .set({ role: 'admin' })
        .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, rest[0]!.userId)));
    }
    await tx.update(groups).set({ rotationPending: true }).where(eq(groups.id, groupId));
  });
}

async function requireAdmin(groupId: string, userId: string) {
  const row = await requireMember(groupId, userId);
  if (row.role !== 'admin') throw new HTTPException(403, { message: 'admin_only' });
  return row;
}

app.post('/groups/:groupId/leave', async (c) => {
  const groupId = groupIdParam(c);
  const me = c.get('userId');
  await requireMember(groupId, me);
  await removeMember(groupId, me);
  return c.json({ left: true });
});

app.post('/groups/:groupId/members/:userId/remove', async (c) => {
  const groupId = groupIdParam(c);
  const me = c.get('userId');
  await requireAdmin(groupId, me);
  const target = z.uuid().safeParse(c.req.param('userId'));
  if (!target.success || target.data === me) throw new HTTPException(400, { message: 'invalid_member' });
  const [row] = await db
    .select({ userId: groupMembers.userId })
    .from(groupMembers)
    .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, target.data)));
  if (!row) throw new HTTPException(404, { message: 'not_found' });
  await removeMember(groupId, target.data);
  return c.json({ removed: true });
});

/**
 * Key rotation: a member's phone drew a new group key, sealed it to every
 * current member (itself included) and re-encrypted the meta with it. The
 * key set must cover exactly the current members, so nobody who left gets it
 * and nobody who stays is left out.
 */
app.post('/groups/:groupId/rotate', async (c) => {
  const groupId = groupIdParam(c);
  const input = await body(
    c,
    z.object({
      fromKeyVersion: keyVersion,
      encryptedMeta: b64Bytes({ max: 16 * 1024 }),
      keys: z.array(z.object({ userId: z.uuid(), sealedKey: b64Bytes({ max: 256 }) })).min(1).max(500),
    }),
  );
  await requireMember(groupId, c.get('userId'));
  const next = await db.transaction(async (tx) => {
    const [g] = await tx
      .select({ currentKeyVersion: groups.currentKeyVersion })
      .from(groups)
      .where(eq(groups.id, groupId))
      .for('update');
    if (!g || g.currentKeyVersion !== input.fromKeyVersion) throw new HTTPException(409, { message: 'stale_key_version' });
    const members = await tx.select({ userId: groupMembers.userId }).from(groupMembers).where(eq(groupMembers.groupId, groupId));
    const sent = new Set(input.keys.map((k) => k.userId));
    if (sent.size !== input.keys.length || sent.size !== members.length || !members.every((m) => sent.has(m.userId))) {
      throw new HTTPException(409, { message: 'members_changed' });
    }
    const v = g.currentKeyVersion + 1;
    await tx.insert(groupKeys).values(input.keys.map((k) => ({ groupId, userId: k.userId, keyVersion: v, sealedKey: k.sealedKey })));
    await tx
      .update(groups)
      .set({ currentKeyVersion: v, encryptedMeta: input.encryptedMeta, rotationPending: false })
      .where(eq(groups.id, groupId));
    return v;
  });
  return c.json({ currentKeyVersion: next });
});

/** Admin: new code + keywords (for future joins), with the meta re-encrypted to hold the new keywords. */
app.put('/groups/:groupId/code', async (c) => {
  const groupId = groupIdParam(c);
  const input = await body(c, z.object({ groupCode, keywords, keyVersion, encryptedMeta: b64Bytes({ max: 16 * 1024 }) }));
  await requireAdmin(groupId, c.get('userId'));
  const [codeHash, keywordsHash] = await Promise.all([hashGroupCode(input.groupCode), hashKeywords(input.keywords)]);
  const codeLookup = groupCodeLookup(input.groupCode);
  const codeVersion = await db.transaction(async (tx) => {
    const [g] = await tx
      .select({ currentKeyVersion: groups.currentKeyVersion, codeVersion: groups.codeVersion })
      .from(groups)
      .where(eq(groups.id, groupId))
      .for('update');
    if (!g || g.currentKeyVersion !== input.keyVersion) throw new HTTPException(409, { message: 'stale_key_version' });
    const [taken] = await tx.select({ id: groups.id }).from(groups).where(eq(groups.codeLookup, codeLookup));
    if (taken && taken.id !== groupId) throw new HTTPException(409, { message: 'code_taken' });
    await tx
      .update(groups)
      .set({ codeHash, codeLookup, keywordsHash, encryptedMeta: input.encryptedMeta, codeVersion: g.codeVersion + 1 })
      .where(eq(groups.id, groupId));
    return g.codeVersion + 1;
  });
  return c.json({ codeVersion });
});

/** Admin: disappearing messages, for messages sent from now on. */
app.put('/groups/:groupId/ephemeral', async (c) => {
  const groupId = groupIdParam(c);
  const input = await body(c, z.object({ seconds: z.union([z.literal(86_400), z.literal(604_800)]).nullable() }));
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
      signature: b64Bytes({ exact: 64 }),
    }),
  );
  const me = c.get('userId');
  const { currentKeyVersion, ephemeralSeconds } = await requireMember(groupId, me);
  if (input.keyVersion !== currentKeyVersion) throw new HTTPException(409, { message: 'stale_key_version' });

  await db
    .insert(messages)
    .values({
      ...input,
      groupId,
      senderId: me,
      expiresAt: ephemeralSeconds ? new Date(Date.now() + ephemeralSeconds * 1000) : null,
    })
    .onConflictDoNothing({ target: [messages.senderId, messages.clientId] });
  // Idempotent: a replayed send returns the row stored the first time.
  const [row] = await db
    .select()
    .from(messages)
    .where(and(eq(messages.senderId, me), eq(messages.clientId, input.clientId)));
  realtime.nudge();
  return c.json(toWireMessage(row!), 201);
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
  return c.json({ messages: rows.map(toWireMessage), hasMore: rows.length === limit });
});

// ---- Realtime ----------------------------------------------------------------

app.get(
  '/ws',
  // Native clients can't always set headers on a WebSocket: token in the query.
  async (c, next) => {
    const userId = await verifyAccessToken(c.req.query('token') ?? '');
    if (!userId) return c.text('unauthorized', 401);
    c.set('userId', userId);
    await next();
  },
  upgradeWebSocket((c) => {
    const userId = c.get('userId');
    return {
      onOpen: (_e, ws) => realtime.add(ws, userId),
      onClose: (_e, ws) => realtime.remove(ws),
      onError: (_e, ws) => realtime.remove(ws),
      onMessage: () => {}, // client -> server traffic goes through HTTP (idempotent)
    };
  }),
);

// ---- Scheduled purge of expired messages (Neon Function Trigger) ------------

app.post('/internal/purge', async (c) => {
  await parseTrigger(c); // 401/400 unless it is a signed Neon trigger delivery
  const deleted = await db
    .delete(messages)
    .where(lt(messages.expiresAt, sql`now()`))
    .returning({ id: messages.id });
  return c.json({ deleted: deleted.length });
});
