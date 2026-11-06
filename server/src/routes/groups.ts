import { and, eq, gt, inArray, isNull, or, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import { db } from '../db/client';
import { groupBans, groupKeys, groupLinks, groupMembers, groups, joinAttempts } from '../db/schema';
import { fromB64, generateInviteCode, joinLookup, normalizeInviteCode, sha256Hex } from '../lib/crypto';
import { notifyAction } from '../lib/push';
import { realtime } from '../realtime';
import {
  b64Bytes,
  b64Key,
  body,
  DIRECTS_PER_DAY,
  encryptedMeta,
  ephemeral,
  GROUP_CODES_PER_DAY,
  GROUP_JOIN_ATTEMPTS_PER_HOUR,
  GROUP_LINK_TTL_MS,
  groupAlive,
  groupIdParam,
  JOIN_ATTEMPTS_PER_HOUR,
  keyVersion,
  label,
  labelSignature,
  MAX_GROUP_LIFETIME_DAYS,
  MIN_GROUP_LIFETIME_MS,
  OPEN_LINKS_PER_GROUP,
  requireAdmin,
  requireMember,
  sealedKey,
  sealedLabel,
  signature,
  spendQuota,
  uuidParam,
  type Env,
} from './_shared';

/*
 * Trust model (SPEC §4.3–4.4). The server routes and stores; it cannot hand a
 * group key to anyone or swap one, because:
 * - every key handout is wrapped under a key derived from the group code +
 *   keywords (which the server never sees) and signed by an admin;
 * - the meta (name, keywords, admins, members) is encrypted under the group
 *   key and signed by an admin;
 * - a newcomer gets a key only when an admin approves them on their phone.
 * A group without a code (kind 'link') has no code + keywords: its handouts
 * are only sealed to each member and signed, like a private conversation's;
 * the single-use links below only file requests, the approval is the gate.
 * The checks below keep honest clients consistent and abusers out; the
 * phones verify everything that matters.
 */

export const groupsRoutes = new Hono<Env>();

groupsRoutes.get('/groups', async (c) => {
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
      keySince: groups.keySince,
      codeVersion: groups.codeVersion,
      expiresAt: groups.expiresAt,
      kind: groups.kind,
      directPair: groups.directPair,
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
          sealedLabel: groupKeys.sealedLabel,
          labelSignature: groupKeys.labelSignature,
          labelSignerId: groupKeys.labelSignerId,
        })
        .from(groupKeys)
        .where(and(eq(groupKeys.userId, me), inArray(groupKeys.groupId, active.map((r) => r.id))))
    : [];
  return c.json(
    rows.map(({ directPair, ...g }) =>
      g.status === 'pending'
        ? // Waiting for an admin: nothing of the group yet, not even its meta.
          { id: g.id, status: 'pending' as const, expiresAt: g.expiresAt?.toISOString() ?? null }
        : {
            ...g,
            // Direct conversation: who the other one is (a hint for the list; the phones go by the signed meta).
            ...(directPair && { peerId: directPair.split(':').find((u) => u !== me) ?? me }),
            expiresAt: g.expiresAt?.toISOString() ?? null,
            sealedKeys: keys
              .filter((k) => k.groupId === g.id)
              .map(({ keyVersion, sealedKey, signerId, signature, sealedLabel, labelSignature, labelSignerId }) => ({
                keyVersion,
                sealedKey,
                signerId,
                signature,
                ...(sealedLabel && labelSignature && { sealedLabel, labelSignature, ...(labelSignerId && { labelSignerId }) }),
              })),
          },
    ),
  );
});

groupsRoutes.post('/groups', async (c) => {
  const input = await body(
    c,
    z.object({
      id: z.uuid(), // generated on the phone: bound into the meta and key handouts
      encryptedMeta,
      metaSignature: signature,
      // 'link': no code, so no joinKey; newcomers come in with single-use links (POST /groups/:id/links).
      kind: z.enum(['group', 'link']).optional(),
      joinKey: b64Key.optional(),
      sealedKey,
      keySignature: signature,
      sealedLabel,
      labelSignature,
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
  const kind = input.kind ?? 'group';
  if ((kind === 'group') !== !!input.joinKey) throw new HTTPException(400, { message: 'invalid_body' });
  // Each creation can tell whether a code + keywords pair is in use: a guess, so a quota.
  if (kind === 'group') await spendQuota(me, 'group_code', GROUP_CODES_PER_DAY);
  const lookup = input.joinKey ? joinLookup(fromB64(input.joinKey)!) : null;
  await db.transaction(async (tx) => {
    // Unique, so the code + keywords identify the group to join.
    if (lookup) {
      const [taken] = await tx.select({ id: groups.id }).from(groups).where(eq(groups.joinLookup, lookup));
      if (taken) throw new HTTPException(409, { message: 'code_taken' });
    }
    const inserted = await tx
      .insert(groups)
      .values({
        id: input.id,
        kind,
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
      ...label(input),
    });
  });
  return c.json({ id: input.id, currentKeyVersion: 1 }, 201);
});

/**
 * A private conversation with someone we share a group with (SPEC §4.3). The
 * phone drew its key, sealed it to both of us and signed both handouts and
 * the meta (the two of us, both admins). No code reaches the server: each
 * phone locks the key with a code of its own. One conversation per pair.
 */
groupsRoutes.post('/groups/direct', async (c) => {
  const input = await body(
    c,
    z.object({
      id: z.uuid(),
      peerId: z.uuid(),
      encryptedMeta,
      metaSignature: signature,
      keys: z.array(z.object({ userId: z.uuid(), sealedKey, signature, sealedLabel, labelSignature })).length(2),
    }),
  );
  const me = c.get('userId');
  const peer = input.peerId;
  if (peer === me) throw new HTTPException(400, { message: 'invalid_peer' });
  const sent = new Set(input.keys.map((k) => k.userId));
  if (sent.size !== 2 || !sent.has(me) || !sent.has(peer)) throw new HTTPException(400, { message: 'invalid_keys' });
  // Only someone met in a group: no directory of usernames to write to.
  const shared = await db.execute(sql`
    select 1 from ${groupMembers} a
      join ${groupMembers} b on b.group_id = a.group_id
      join ${groups} g on g.id = a.group_id
     where a.user_id = ${me} and b.user_id = ${peer} and a.status = 'active' and b.status = 'active'
       and g.kind <> 'direct' and (g.expires_at is null or g.expires_at > now())
     limit 1`);
  if (!shared.rows.length) throw new HTTPException(404, { message: 'not_found' });
  await spendQuota(me, 'direct', DIRECTS_PER_DAY);
  const pair = [me, peer].sort().join(':');
  await db.transaction(async (tx) => {
    const inserted = await tx
      .insert(groups)
      .values({
        id: input.id,
        kind: 'direct',
        directPair: pair,
        encryptedMeta: input.encryptedMeta,
        metaSignerId: me,
        metaSignature: input.metaSignature,
        createdBy: me,
      })
      .onConflictDoNothing()
      .returning({ id: groups.id });
    if (inserted.length === 0) {
      const [existing] = await tx.select({ id: groups.id }).from(groups).where(eq(groups.directPair, pair));
      throw new HTTPException(409, { message: existing ? 'direct_exists' : 'group_exists' });
    }
    await tx.insert(groupMembers).values([
      { groupId: input.id, userId: me, role: 'admin', status: 'active' },
      { groupId: input.id, userId: peer, role: 'admin', status: 'active' },
    ]);
    await tx
      .insert(groupKeys)
      .values(input.keys.map((k) => ({ groupId: input.id, userId: k.userId, keyVersion: 1, sealedKey: k.sealedKey, signerId: me, signature: k.signature, ...label(k) })));
  });
  await notifyAction(input.id, 'direct', [peer]);
  return c.json({ id: input.id, currentKeyVersion: 1 }, 201);
});

/**
 * Asks to join with the key derived from the code + 3 keywords. Success only
 * creates a pending membership: an admin approves it from their phone, which
 * hands over the group key. Banned users get the same answer as a wrong code.
 */
groupsRoutes.post('/groups/join', async (c) => {
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
  if (filed.length) await notifyAction(group.id, 'join_request', 'admins', me);
  return c.json({ groupId: group.id, status: row!.status });
});

/**
 * Admin of a group without a code: a single-use link for one newcomer. Only
 * its SHA-256 is kept. Using it files a join request, still approved by an
 * admin from their phone (which hands over the key): a link that leaks lets
 * someone knock, not read.
 */
groupsRoutes.post('/groups/:groupId/links', async (c) => {
  const groupId = groupIdParam(c);
  const me = c.get('userId');
  if ((await requireAdmin(groupId, me)).kind !== 'link') throw new HTTPException(400, { message: 'not_a_link_group' });
  const [{ open } = { open: 0 }] = await db
    .select({ open: sql<number>`count(*)::int` })
    .from(groupLinks)
    .where(and(eq(groupLinks.groupId, groupId), isNull(groupLinks.usedBy), gt(groupLinks.expiresAt, sql`now()`)));
  if (open >= OPEN_LINKS_PER_GROUP) throw new HTTPException(429, { message: 'too_many_links' });
  const code = generateInviteCode();
  const expiresAt = new Date(Date.now() + GROUP_LINK_TTL_MS);
  await db.insert(groupLinks).values({ codeHash: sha256Hex(normalizeInviteCode(code)), groupId, createdBy: me, expiresAt });
  return c.json({ code, expiresAt: expiresAt.toISOString() }, 201);
});

/** Admin: every unused link of the group stops working. */
groupsRoutes.delete('/groups/:groupId/links', async (c) => {
  const groupId = groupIdParam(c);
  await requireAdmin(groupId, c.get('userId'));
  const gone = await db
    .delete(groupLinks)
    .where(and(eq(groupLinks.groupId, groupId), isNull(groupLinks.usedBy)))
    .returning({ codeHash: groupLinks.codeHash });
  return c.json({ revoked: gone.length });
});

/**
 * Asks to join a group without a code with a link from its admin. The link is
 * burnt by this request, whatever the admin then decides: refused, or lost on
 * the way, the admin sends a new one. Already in (or asked): the link is kept.
 * A wrong, used, expired or revoked link, or a ban: the same answer.
 */
groupsRoutes.post('/groups/join-link', async (c) => {
  const input = await body(c, z.object({ code: z.string().min(1).max(64) }));
  const me = c.get('userId');
  // Same per-user limit as joining by code: links are long, this only keeps a script from hammering.
  await db.insert(joinAttempts).values({ userId: me, groupId: null });
  const [{ mine } = { mine: 0 }] = await db
    .select({ mine: sql<number>`count(*)::int` })
    .from(joinAttempts)
    .where(and(eq(joinAttempts.userId, me), gt(joinAttempts.attemptedAt, sql`now() - interval '1 hour'`)));
  if (mine > JOIN_ATTEMPTS_PER_HOUR) {
    c.header('Retry-After', '3600');
    throw new HTTPException(429, { message: 'too_many_attempts' });
  }
  const result = await db.transaction(async (tx) => {
    const [link] = await tx
      .select({ codeHash: groupLinks.codeHash, groupId: groupLinks.groupId, usedBy: groupLinks.usedBy, expiresAt: groupLinks.expiresAt })
      .from(groupLinks)
      .innerJoin(groups, eq(groups.id, groupLinks.groupId))
      .where(and(eq(groupLinks.codeHash, sha256Hex(normalizeInviteCode(input.code))), eq(groups.kind, 'link'), groupAlive))
      .for('update');
    if (!link) return null;
    const [already] = await tx
      .select({ status: groupMembers.status })
      .from(groupMembers)
      .where(and(eq(groupMembers.groupId, link.groupId), eq(groupMembers.userId, me)));
    if (already) return { groupId: link.groupId, status: already.status, filed: false };
    if (link.usedBy || link.expiresAt < new Date()) return null;
    const [banned] = await tx
      .select({ userId: groupBans.userId })
      .from(groupBans)
      .where(and(eq(groupBans.groupId, link.groupId), eq(groupBans.userId, me)));
    if (banned) return null;
    await tx.update(groupLinks).set({ usedBy: me, usedAt: sql`now()` }).where(eq(groupLinks.codeHash, link.codeHash));
    await tx.insert(groupMembers).values({ groupId: link.groupId, userId: me, role: 'member', status: 'pending' });
    return { groupId: link.groupId, status: 'pending' as const, filed: true };
  });
  if (!result) throw new HTTPException(403, { message: 'invalid_link' });
  if (result.filed) await notifyAction(result.groupId, 'join_request', 'admins', me);
  return c.json({ groupId: result.groupId, status: result.status });
});

/** Active members, with the key versions each one holds (for rotation and code changes), and pending requests. */
groupsRoutes.get('/groups/:groupId/members', async (c) => {
  const groupId = groupIdParam(c);
  const { currentKeyVersion, role } = await requireMember(groupId, c.get('userId'));
  const rows = await db
    .select({ userId: groupMembers.userId, role: groupMembers.role, status: groupMembers.status, color: groupMembers.color, joinedAt: groupMembers.joinedAt })
    .from(groupMembers)
    .where(eq(groupMembers.groupId, groupId))
    .orderBy(groupMembers.joinedAt);
  const held = await db
    .select({ userId: groupKeys.userId, keyVersion: groupKeys.keyVersion, sealedLabel: groupKeys.sealedLabel })
    .from(groupKeys)
    .where(eq(groupKeys.groupId, groupId));
  const members = rows
    .filter((r) => r.status === 'active')
    .map((r) => ({
      userId: r.userId,
      role: r.role,
      // Their color in this group (null: the default).
      color: r.color,
      keyVersions: held.filter((h) => h.userId === r.userId).map((h) => h.keyVersion),
      // Handouts without the group's name sealed beside the key (from before it): an admin's phone fills them in.
      unlabelledKeyVersions: held.filter((h) => h.userId === r.userId && !h.sealedLabel).map((h) => h.keyVersion),
    }));
  // Only admins decide on requests; members do not see who knocked.
  const pending =
    role === 'admin'
      ? rows.filter((r) => r.status === 'pending').map((r) => ({ userId: r.userId, requestedAt: r.joinedAt.toISOString() }))
      : [];
  return c.json({ currentKeyVersion, members, pending });
});

/**
 * Admin: the group's name sealed beside handouts that have none (from before
 * it): filled in, never replaced, signed by this admin (label_signer_id).
 * The phones verify the signature against that admin's pinned key.
 */
groupsRoutes.post('/groups/:groupId/keys/labels', async (c) => {
  const groupId = groupIdParam(c);
  const me = c.get('userId');
  const input = await body(
    c,
    z.object({ keys: z.array(z.object({ userId: z.uuid(), keyVersion, sealedLabel: b64Bytes({ max: 1024 }), labelSignature: signature })).min(1).max(5000) }),
  );
  await requireAdmin(groupId, me);
  let labelled = 0;
  for (const k of input.keys) {
    const done = await db
      .update(groupKeys)
      .set({ sealedLabel: k.sealedLabel, labelSignature: k.labelSignature, labelSignerId: me })
      .where(and(eq(groupKeys.groupId, groupId), eq(groupKeys.userId, k.userId), eq(groupKeys.keyVersion, k.keyVersion), isNull(groupKeys.sealedLabel)))
      .returning({ userId: groupKeys.userId });
    labelled += done.length;
  }
  return c.json({ labelled });
});

/** Admin: accepts a request, handing over the current key and the meta that now lists the newcomer. */
groupsRoutes.post('/groups/:groupId/members/:userId/approve', async (c) => {
  const groupId = groupIdParam(c);
  const me = c.get('userId');
  const target = uuidParam(c, 'userId');
  const input = await body(c, z.object({ keyVersion, sealedKey, keySignature: signature, sealedLabel, labelSignature, encryptedMeta, metaSignature: signature }));
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
      ...label(input),
    });
    await tx
      .update(groups)
      .set({ encryptedMeta: input.encryptedMeta, metaSignerId: me, metaSignature: input.metaSignature })
      .where(eq(groups.id, groupId));
  });
  realtime.nudge();
  await notifyAction(groupId, 'approved', [target]);
  return c.json({ approved: true });
});

/** Admin: turns a request down. The user may ask again (a removal, not a refusal, bans). */
groupsRoutes.post('/groups/:groupId/members/:userId/reject', async (c) => {
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
