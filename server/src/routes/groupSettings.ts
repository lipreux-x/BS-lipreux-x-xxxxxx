import { and, eq, inArray, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import { db } from '../db/client';
import { groupKeys, groupMembers, groups, messages, profiles, reports } from '../db/schema';
import { fromB64, joinLookup } from '../lib/crypto';
import { notifyAction } from '../lib/push';
import { realtime } from '../realtime';
import {
  activeCount,
  adminCount,
  b64Key,
  body,
  COLORS,
  cursors,
  deleteConversation,
  encryptedMeta,
  ephemeral,
  GROUP_CODES_PER_DAY,
  groupIdParam,
  keyVersion,
  label,
  removeMember,
  requireAdmin,
  requireGroupKind,
  requireMember,
  sealedKey,
  sealedLabel,
  signature,
  labelSignature,
  spendQuota,
  unreadByGroup,
  uuidParam,
  type Env,
} from './_shared';

export const groupSettings = new Hono<Env>();

groupSettings.post('/groups/:groupId/leave', async (c) => {
  const groupId = groupIdParam(c);
  const me = c.get('userId');
  const { role, kind } = await requireMember(groupId, me);
  // Leaving a private conversation deletes it, for the other one too.
  if (kind === 'direct') {
    await deleteConversation(groupId);
    return c.json({ left: true });
  }
  // Nobody could approve newcomers or rotate keys any more.
  if (role === 'admin' && (await adminCount(groupId)) === 1 && (await activeCount(groupId)) > 1) {
    throw new HTTPException(409, { message: 'handover_required' });
  }
  await removeMember(groupId, me, false);
  await notifyAction(groupId, 'member_left', 'admins', me);
  return c.json({ left: true });
});

/** Admin: removes a member for good (banned: the code they know no longer lets them back in). */
groupSettings.post('/groups/:groupId/members/:userId/remove', async (c) => {
  const groupId = groupIdParam(c);
  const me = c.get('userId');
  requireGroupKind((await requireAdmin(groupId, me)).kind);
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
 * A member reports another one, or one of their messages (App Store rule 1.2).
 * The server cannot read the group: `excerpt` is what the reporter chose to
 * hand over, decrypted on their phone. Read with scripts/reports.ts.
 */
groupSettings.post('/groups/:groupId/reports', async (c) => {
  const groupId = groupIdParam(c);
  const me = c.get('userId');
  await requireMember(groupId, me);
  const input = await body(
    c,
    z.object({
      userId: z.uuid(),
      messageId: z.uuid().optional(),
      reason: z.enum(['abuse', 'spam', 'illegal', 'other']),
      excerpt: z.string().max(2000).optional(),
    }),
  );
  if (input.userId === me) throw new HTTPException(400, { message: 'invalid_member' });
  const [target] = await db
    .select({ username: profiles.username })
    .from(groupMembers)
    .innerJoin(profiles, eq(profiles.id, groupMembers.userId))
    .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, input.userId)));
  if (!target) throw new HTTPException(404, { message: 'not_found' });
  if (input.messageId) {
    const [m] = await db
      .select({ id: messages.id })
      .from(messages)
      .where(and(eq(messages.id, input.messageId), eq(messages.groupId, groupId), eq(messages.senderId, input.userId)));
    if (!m) throw new HTTPException(404, { message: 'not_found' });
  }
  await db.insert(reports).values({
    reporterId: me,
    reportedId: input.userId,
    reportedUsername: target.username,
    groupId,
    messageId: input.messageId ?? null,
    reason: input.reason,
    excerpt: input.excerpt ?? null,
  });
  return c.json({ reported: true });
});

/**
 * Admin: key rotation. The admin's phone drew a new group key, sealed it to
 * every active member (itself included), signed each handout and wrote the
 * new signed meta, whose admin list the server mirrors in `role`. The key set
 * must cover exactly the active members: nobody who left gets it and nobody
 * who stays is left out.
 */
groupSettings.post('/groups/:groupId/rotate', async (c) => {
  const groupId = groupIdParam(c);
  const me = c.get('userId');
  const input = await body(
    c,
    z.object({
      fromKeyVersion: keyVersion,
      encryptedMeta,
      metaSignature: signature,
      admins: z.array(z.uuid()).min(1).max(500),
      keys: z.array(z.object({ userId: z.uuid(), sealedKey, signature, sealedLabel, labelSignature })).min(1).max(500),
    }),
  );
  // An admin; or, once no admin is left (the last one deleted their account), any member, who becomes one:
  // otherwise a pending rotation would freeze the group for good (no message under the old key).
  const { role, kind } = await requireMember(groupId, me);
  requireGroupKind(kind); // a private conversation never rotates (nobody leaves one)
  if (role !== 'admin' && (await adminCount(groupId)) > 0) throw new HTTPException(403, { message: 'admin_only' });
  // Their phone names them admin in the signed meta: the other phones accept a key only from an admin.
  if (role !== 'admin' && !input.admins.includes(me)) throw new HTTPException(400, { message: 'invalid_admins' });
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
      .values(input.keys.map((k) => ({ groupId, userId: k.userId, keyVersion: v, sealedKey: k.sealedKey, signerId: me, signature: k.signature, ...label(k) })));
    await tx
      .update(groups)
      .set({
        currentKeyVersion: v,
        encryptedMeta: input.encryptedMeta,
        metaSignerId: me,
        metaSignature: input.metaSignature,
        rotationPending: false,
        keySince: sql`now()`,
      })
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
groupSettings.put('/groups/:groupId/admins', async (c) => {
  const groupId = groupIdParam(c);
  const me = c.get('userId');
  const input = await body(c, z.object({ keyVersion, admins: z.array(z.uuid()).min(1).max(500), encryptedMeta, metaSignature: signature }));
  requireGroupKind((await requireAdmin(groupId, me)).kind);
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
groupSettings.put('/groups/:groupId/code', async (c) => {
  const groupId = groupIdParam(c);
  const me = c.get('userId');
  const input = await body(
    c,
    z.object({
      joinKey: b64Key,
      keyVersion,
      encryptedMeta,
      metaSignature: signature,
      keys: z.array(z.object({ userId: z.uuid(), keyVersion, sealedKey, signature, sealedLabel, labelSignature })).max(5000),
    }),
  );
  // A group without a code has none to change; a private conversation neither.
  if ((await requireAdmin(groupId, me)).kind !== 'group') throw new HTTPException(400, { message: 'no_group_code' });
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
        .values(input.keys.map((k) => ({ groupId, userId: k.userId, keyVersion: k.keyVersion, sealedKey: k.sealedKey, signerId: me, signature: k.signature, ...label(k) })));
    }
    await tx
      .update(groups)
      .set({ joinLookup: lookup, encryptedMeta: input.encryptedMeta, metaSignerId: me, metaSignature: input.metaSignature, codeVersion: g.codeVersion + 1 })
      .where(eq(groups.id, groupId));
    return g.codeVersion + 1;
  });
  await notifyAction(groupId, 'code_changed', 'members', me);
  return c.json({ codeVersion });
});

/** Any member: their own color in this group (name, avatar, messages), or null for the default. Seen by every member. */
groupSettings.put('/groups/:groupId/color', async (c) => {
  const groupId = groupIdParam(c);
  const me = c.get('userId');
  const { color } = await body(c, z.object({ color: z.enum(COLORS).nullable() }));
  await requireMember(groupId, me);
  await db
    .update(groupMembers)
    .set({ color })
    .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, me)));
  return c.json({ color });
});

/** Admin: disappearing messages, for messages sent from now on. */
groupSettings.put('/groups/:groupId/ephemeral', async (c) => {
  const groupId = groupIdParam(c);
  const input = await body(c, z.object({ seconds: ephemeral }));
  requireGroupKind((await requireAdmin(groupId, c.get('userId'))).kind);
  await db.update(groups).set({ ephemeralSeconds: input.seconds }).where(eq(groups.id, groupId));
  return c.json({ ephemeralSeconds: input.seconds });
});

/**
 * How many messages wait in each group, past the last one this phone showed
 * (`cursors`: group id -> seq, 0 for a group never opened here). Our own
 * messages, quiet ones (reactions) and expired ones do not count; only a
 * number per group goes back, never a message.
 */
groupSettings.post('/groups/unread', async (c) => {
  const input = await body(c, z.object({ cursors }));
  return c.json(await unreadByGroup(c.get('userId'), input.cursors));
});
