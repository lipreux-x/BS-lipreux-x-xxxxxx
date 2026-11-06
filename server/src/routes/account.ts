import { and, eq, gt, inArray, isNull, or, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import { db } from '../db/client';
import { attachments, groupBans, groupKeys, groupMembers, groups, invites, joinAttempts, messages, profiles, pushTokens, userActions } from '../db/schema';
import { generateInviteCode, normalizeInviteCode, sha256Hex } from '../lib/crypto';
import { notifyAction, PRESENCE_SECONDS, PUSH_TOKEN } from '../lib/push';
import { deleteObjects, objectKey } from '../lib/storage';
import { realtime } from '../realtime';
import {
  activeCount,
  adminCount,
  AVATARS,
  body,
  COLORS,
  cursors,
  deleteConversation,
  INVITE_TTL_MS,
  INVITES_PER_DAY,
  OPEN_INVITES_PER_USER,
  removeMember,
  spendQuota,
  unreadByGroup,
  type Env,
} from './_shared';

export const account = new Hono<Env>();

account.get('/me', async (c) => {
  const [p] = await db.select().from(profiles).where(eq(profiles.id, c.get('userId')));
  if (!p) throw new HTTPException(404, { message: 'not_found' });
  return c.json({ id: p.id, username: p.username, publicKeyBox: p.publicKeyBox, publicKeySign: p.publicKeySign, avatar: p.avatar, color: p.color });
});

/** Picks one of the avatar icons, or null for the default silhouette. */
account.put('/me/avatar', async (c) => {
  const { avatar } = await body(c, z.object({ avatar: z.enum(AVATARS).nullable() }));
  await db.update(profiles).set({ avatar }).where(eq(profiles.id, c.get('userId')));
  return c.json({ avatar });
});

/**
 * Older apps: one color for every group. It still goes to each of them
 * (the color is now chosen per group: PUT /groups/:id/color).
 */
account.put('/me/color', async (c) => {
  const me = c.get('userId');
  const { color } = await body(c, z.object({ color: z.enum(COLORS).nullable() }));
  await db.transaction(async (tx) => {
    await tx.update(profiles).set({ color }).where(eq(profiles.id, me));
    await tx.update(groupMembers).set({ color }).where(eq(groupMembers.userId, me));
  });
  return c.json({ color });
});

/** This phone's push token and platform (what it gets: see lib/push.ts). */
account.put('/me/push-token', async (c) => {
  const { token, platform = null } = await body(c, z.object({ token: z.string().regex(PUSH_TOKEN), platform: z.enum(['ios', 'android']).optional() }));
  const userId = c.get('userId');
  // A token belongs to one phone: if it was another account's, it moves to this one.
  await db
    .insert(pushTokens)
    .values({ token, userId, platform })
    .onConflictDoUpdate({ target: pushTokens.token, set: { userId, platform, createdAt: sql`now()` } });
  return c.json({ ok: true });
});

/**
 * The app is open and unlocked on one of this person's phones: no "new
 * message" push until PRESENCE_SECONDS from now (the app renews it every 30 s
 * and withdraws it when it goes to the background).
 */
account.put('/me/presence', async (c) => {
  await db
    .update(profiles)
    .set({ awakeUntil: sql`now() + make_interval(secs => ${PRESENCE_SECONDS})` })
    .where(eq(profiles.id, c.get('userId')));
  return c.json({ ok: true });
});

/**
 * The app went to the background. With `cursors` (as for POST /groups/unread),
 * what waits unread then is counted and kept: the base of the app icon's badge
 * in the pushes that follow (lib/push.ts), and handed back for the phone to
 * show at once.
 */
account.delete('/me/presence', async (c) => {
  const me = c.get('userId');
  const parsed = z.object({ cursors }).safeParse(await c.req.json().catch(() => undefined));
  if (!parsed.success) {
    await db.update(profiles).set({ awakeUntil: null }).where(eq(profiles.id, me));
    return c.json({ ok: true });
  }
  const counts = await unreadByGroup(me, parsed.data.cursors);
  const badge = Object.values(counts).reduce((a, n) => a + n, 0);
  await db.update(profiles).set({ awakeUntil: null, badgeBase: badge, badgeSince: sql`now()` }).where(eq(profiles.id, me));
  return c.json({ ok: true, badge });
});

account.delete('/me/push-token', async (c) => {
  const { token } = await body(c, z.object({ token: z.string().regex(PUSH_TOKEN) }));
  await db.delete(pushTokens).where(and(eq(pushTokens.token, token), eq(pushTokens.userId, c.get('userId'))));
  return c.json({ ok: true });
});

/**
 * Deletes the account (App Store rule 5.1.1(v)). It leaves every group (a
 * private conversation goes for both), its messages and files go, and the
 * profile keeps only its id and public keys: what it signed in other people's
 * groups (meta, key handouts) must still verify. Username, avatar, color and
 * the password-sealed backup go, and it can never sign in again.
 *
 * The only admin of a group others stay in: 409 `handover_required` with those
 * groups, unless `force` (the group then has no admin: nobody new gets in).
 */
account.delete('/me', async (c) => {
  const me = c.get('userId');
  const { force = false } = await body(c, z.object({ force: z.boolean().optional() }));
  const mine = await db
    .select({ groupId: groupMembers.groupId, role: groupMembers.role, status: groupMembers.status, kind: groups.kind })
    .from(groupMembers)
    .innerJoin(groups, eq(groups.id, groupMembers.groupId))
    .where(eq(groupMembers.userId, me));
  if (!force) {
    const stuck: string[] = [];
    for (const g of mine) {
      if (g.kind === 'direct' || g.status !== 'active' || g.role !== 'admin') continue;
      if ((await adminCount(g.groupId)) === 1 && (await activeCount(g.groupId)) > 1) stuck.push(g.groupId);
    }
    if (stuck.length) return c.json({ error: 'handover_required', groups: stuck }, 409);
  }
  for (const g of mine) {
    if (g.kind === 'direct') await deleteConversation(g.groupId);
    else {
      await removeMember(g.groupId, me, false);
      if (g.status === 'active') await notifyAction(g.groupId, 'member_left', 'admins', me);
    }
  }
  // What it sent in the groups that remain, files first (their rows go with the messages).
  const files = await db.select({ id: attachments.id, groupId: attachments.groupId }).from(attachments).where(eq(attachments.uploaderId, me));
  await db.transaction(async (tx) => {
    await tx.delete(attachments).where(eq(attachments.uploaderId, me));
    await tx.delete(messages).where(eq(messages.senderId, me));
    await tx.delete(invites).where(and(eq(invites.createdBy, me), isNull(invites.usedBy)));
    await tx.delete(pushTokens).where(eq(pushTokens.userId, me));
    await tx.delete(userActions).where(eq(userActions.userId, me));
    await tx.delete(joinAttempts).where(eq(joinAttempts.userId, me));
    await tx.delete(groupBans).where(eq(groupBans.userId, me));
    await tx
      .update(profiles)
      .set({
        username: `deleted_${me.replace(/-/g, '').slice(0, 12)}`,
        avatar: null,
        color: null,
        backupParams: null,
        backupAuth: null,
        backupBox: null,
        awakeUntil: null,
        badgeBase: null,
        badgeSince: null,
        deletedAt: sql`now()`,
      })
      .where(eq(profiles.id, me));
  });
  if (files.length) await deleteObjects(files.map((f) => objectKey(f.groupId, f.id))).catch((e: Error) => console.error('[storage]', e.name));
  realtime.nudge();
  return c.json({ deleted: true });
});

account.post('/invites', async (c) => {
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
account.get('/profiles', async (c) => {
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
      color: profiles.color,
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
          // Same for the meta and the key handouts of my groups: a gone admin (deleted account) still signed them.
          sql`exists (select 1 from ${groupMembers} a join ${groups} g on g.id = a.group_id
                      where a.user_id = ${me} and a.status = 'active' and g.meta_signer_id = ${profiles.id})`,
          sql`exists (select 1 from ${groupMembers} a join ${groupKeys} k on k.group_id = a.group_id
                      where a.user_id = ${me} and a.status = 'active' and (k.signer_id = ${profiles.id} or k.label_signer_id = ${profiles.id}))`,
        ),
      ),
    );
  return c.json(rows);
});
