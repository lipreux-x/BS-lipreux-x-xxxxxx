import { parseTrigger, upgradeWebSocket } from '@neon/functions/hono';
import { and, eq, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { db } from '../db/client';
import { attachments, groups, invites, joinAttempts, loginAttempts, messages, usedChallenges, userActions } from '../db/schema';
import { deleteObjects, objectKey } from '../lib/storage';
import { readAccessToken } from '../lib/tokens';
import { realtime } from '../realtime';
import type { Env } from './_shared';

export const internal = new Hono<Env>();

// ---- Realtime ----------------------------------------------------------------

internal.get(
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

internal.post('/internal/purge', async (c) => {
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
