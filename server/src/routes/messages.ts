import { and, eq, gt, gte, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import { db } from '../db/client';
import { attachments, groupPurges, messages } from '../db/schema';
import { notifyGroup } from '../lib/push';
import { deleteObjects, downloadUrl, objectKey, uploadUrl } from '../lib/storage';
import { realtime } from '../realtime';
import {
  b64Bytes,
  body,
  groupIdParam,
  keyVersion,
  MAX_ATTACHMENT_BYTES,
  MAX_CIPHERTEXT_BYTES,
  MESSAGES_PER_MINUTE,
  requireAdmin,
  requireMember,
  signature,
  STORY_SECONDS,
  toWireMessage,
  UPLOADS_PER_HOUR,
  type Env,
} from './_shared';

export const messagesRoutes = new Hono<Env>();

messagesRoutes.post('/groups/:groupId/messages', async (c) => {
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
      // A reaction: stored and relayed like any message, but nobody's phone rings for it.
      quiet: z.literal(true).optional(),
    }),
  );
  const me = c.get('userId');
  const { currentKeyVersion, ephemeralSeconds, rotationPending } = await requireMember(groupId, me);
  if (input.keyVersion !== currentKeyVersion) throw new HTTPException(409, { message: 'stale_key_version' });
  // Someone left with the current key: nothing new under it. The phone keeps the message and sends it
  // under the next key, which an admin's phone draws when it opens the group (any member's if none is left).
  if (rotationPending) throw new HTTPException(409, { message: 'rotation_pending' });
  const { attachmentId, expiresInSeconds, quiet, ...msg } = input;
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
        quiet: !!quiet,
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
  // A replayed send (same clientId, already stored earlier) does not ring again; a quiet one never does.
  if (!quiet && Date.now() - row.createdAt.getTime() < 60_000) await notifyGroup(groupId, me);
  return c.json(toWireMessage(row), 201);
});

/** Resync: everything after a cursor, oldest first. */
messagesRoutes.get('/groups/:groupId/messages', async (c) => {
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
messagesRoutes.post('/groups/:groupId/messages/erase', async (c) => {
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

/**
 * The sender deletes one of their messages (text, photo, voice, document,
 * story) for everyone. Its content goes (nonce, ciphertext, signature
 * emptied, its file deleted); the row stays as a tombstone so that phones
 * show « message supprimé » in its place. Quiet from then on: it no longer
 * counts as unread. A story (`?story=1`, which only the sender's phone can
 * tell) leaves no tombstone: it was never in the conversation, it just goes.
 * Phones learn of it as of an erase (group_purges): they reload the
 * history, and their own copy of the message goes with it.
 */
messagesRoutes.delete('/groups/:groupId/messages/:messageId', async (c) => {
  const groupId = groupIdParam(c);
  const messageId = z.uuid().safeParse(c.req.param('messageId'));
  if (!messageId.success) throw new HTTPException(404, { message: 'not_found' });
  const me = c.get('userId');
  const story = c.req.query('story') === '1';
  await requireMember(groupId, me);
  const files = await db.transaction(async (tx) => {
    const [row] = await tx
      .select({ senderId: messages.senderId, deletedAt: messages.deletedAt })
      .from(messages)
      .where(and(eq(messages.id, messageId.data), eq(messages.groupId, groupId)))
      .for('update');
    if (!row) throw new HTTPException(404, { message: 'not_found' });
    if (row.senderId !== me) throw new HTTPException(403, { message: 'not_yours' });
    if (row.deletedAt) return null; // already gone: nothing to do again
    // Unlinked: if the storage fails below, the purge sweeps them like any leftover upload.
    const files = await tx
      .update(attachments)
      .set({ messageId: null })
      .where(eq(attachments.messageId, messageId.data))
      .returning({ id: attachments.id });
    if (story) await tx.delete(messages).where(eq(messages.id, messageId.data));
    else {
      await tx
        .update(messages)
        .set({ nonce: '', ciphertext: '', signature: '', quiet: true, deletedAt: sql`now()` })
        .where(eq(messages.id, messageId.data));
    }
    await tx.insert(groupPurges).values({ groupId });
    return files;
  });
  if (files === null) return c.json({ deleted: false });
  if (files.length) {
    await deleteObjects(files.map((f) => objectKey(groupId, f.id)))
      .then(() => db.delete(attachments).where(inArray(attachments.id, files.map((f) => f.id))))
      .catch((e: Error) => console.error('[storage]', e.name));
  }
  realtime.nudge();
  return c.json({ deleted: true });
});

// ---- Attachments (encrypted on the phone, SPEC §4.3) -------------------------

/** Reserves an attachment id and returns a short-lived URL to PUT exactly `size` encrypted bytes. */
messagesRoutes.post('/groups/:groupId/attachments', async (c) => {
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
messagesRoutes.get('/groups/:groupId/attachments/:attachmentId', async (c) => {
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
        isNull(messages.deletedAt),
      ),
    );
  if (!row) throw new HTTPException(404, { message: 'not_found' });
  return c.json({ url: await downloadUrl(objectKey(groupId, row.id)) });
});
