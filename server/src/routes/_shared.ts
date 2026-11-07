import { and, eq, gt, isNull, or, sql } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import type { Context, MiddlewareHandler } from 'hono';
import { z } from 'zod';
import { db, pool } from '../db/client';
import { attachments, groupBans, groupKeys, groupMembers, groups, joinAttempts, messages, userActions } from '../db/schema';
import { fromB64 } from '../lib/crypto';
import { deleteObjects, objectKey } from '../lib/storage';
import { verifyAccessToken } from '../lib/tokens';
import { realtime } from '../realtime';

export type Env = { Variables: { userId: string; tokenExpiresAt: number } };

export const INVITE_TTL_MS = 2 * 3_600_000; // an invite is handed over in person, right away
export const GROUP_LINK_TTL_MS = 24 * 3_600_000; // a link to a group without a code: sent by message, opened within the day
export const OPEN_LINKS_PER_GROUP = 20; // unused and unexpired
export const JOIN_ATTEMPTS_PER_HOUR = 5; // SPEC §4.4: per user, all groups combined
export const GROUP_JOIN_ATTEMPTS_PER_HOUR = 20; // SPEC §4.5: per group, all users combined (many accounts, one group)
export const LOGIN_FAILURES_PER_HOUR = 5; // failed password sign-ins, per username
export const LOGIN_FAILURES_PER_HOUR_ALL = 300; // all usernames together: password spraying
export const OPEN_INVITES_PER_USER = 3; // unused and unexpired
export const INVITES_PER_DAY = 10;
export const GROUP_CODES_PER_DAY = 10; // group creations + code changes: each costs two Argon2id hashes
export const DIRECTS_PER_DAY = 30; // private conversations opened
export const MESSAGES_PER_MINUTE = 60;
export const STORY_SECONDS = 24 * 3600; // a story's lifetime (mobile src/crypto/attachment.ts: STORY_TTL_SECONDS)
export const REGISTER_FAILURES_PER_INVITE = 3; // username already taken
// Argon2id cost of a key backup (mobile src/crypto/backup.ts, native Argon2),
// also given for decoys. It is also the floor: a weaker backup is refused, so
// whoever holds the database cannot be handed an easier target.
export const BACKUP_PARAMS = { ops: 3, mem: 64 * 1024 * 1024 };
export const MAX_CIPHERTEXT_BYTES = 64 * 1024;
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024; // encrypted size, same limit as mobile crypto/attachment.ts
export const UPLOADS_PER_HOUR = 60;
export const MAX_GROUP_LIFETIME_DAYS = 366;
export const MIN_GROUP_LIFETIME_MS = 10 * 60_000;

// ---- Validation --------------------------------------------------------------

export const b64Bytes = (len?: { exact?: number; max?: number }) =>
  z.string().refine((s) => {
    const b = fromB64(s);
    if (!b) return false;
    if (len?.exact !== undefined && b.length !== len.exact) return false;
    if (len?.max !== undefined && b.length > len.max) return false;
    return true;
  }, 'invalid base64url');

export const username = z.string().regex(/^[A-Za-z0-9_.-]{3,24}$/);
// Avatar icons only (mobile src/ui/avatars.tsx): no uploaded picture ever reaches the server.
export const AVATARS = ['mask', 'spy', 'bank', 'vault', 'gem', 'gold', 'loot', 'piggy', 'key', 'drill', 'lookout'] as const;
// Account colors (mobile src/ui/accountColors.tsx): a name, never a free value.
export const COLORS = ['sky', 'phosphor', 'cyan', 'violet', 'rose', 'amber', 'orange', 'gold'] as const;
// Password-sealed identity (mobile src/crypto/backup.ts). Same bounds as the phone checks.
export const keyBackup = z.object({
  salt: b64Bytes({ exact: 16 }),
  ops: z.number().int().min(BACKUP_PARAMS.ops).max(10),
  mem: z.number().int().min(BACKUP_PARAMS.mem).max(256 * 1024 * 1024).multipleOf(1024),
  authKey: b64Bytes({ exact: 32 }),
  box: b64Bytes({ max: 1024 }),
});
export const keyVersion = z.number().int().min(1).max(1_000_000);

export const b64Key = b64Bytes({ exact: 32 });
export const sealedKey = b64Bytes({ max: 256 });
export const signature = b64Bytes({ exact: 64 });
// The group's name sealed to the member beside the key (200 chars of UTF-8 at most, plus the seal's 48 bytes).
export const sealedLabel = b64Bytes({ max: 1024 }).optional();
export const labelSignature = signature.optional();
/** The label columns of a handout row: both when the phone sent both, none otherwise. */
export const label = (h: { sealedLabel?: string; labelSignature?: string }) =>
  h.sealedLabel && h.labelSignature ? { sealedLabel: h.sealedLabel, labelSignature: h.labelSignature } : {};
export const encryptedMeta = b64Bytes({ max: 32 * 1024 });
export const ephemeral = z.union([z.literal(86_400), z.literal(604_800)]).nullable();
/** Where a phone stands in each group: group id -> the last seq it showed (0: never opened there). */
export const cursors = z.record(z.uuid(), z.number().int().min(0)).refine((r) => Object.keys(r).length <= 200, 'too_many_groups');

export async function body<T extends z.ZodType>(c: Context, schema: T): Promise<z.infer<T>> {
  const json = await c.req.json().catch(() => undefined);
  const parsed = schema.safeParse(json);
  if (!parsed.success) throw new HTTPException(400, { message: 'invalid_body' });
  return parsed.data;
}

// ---- Helpers -----------------------------------------------------------------

/** A self-destructing group past its date is gone for everyone, even before the purge deletes it. */
export const groupAlive = or(isNull(groups.expiresAt), gt(groups.expiresAt, sql`now()`));

export const requireAuth: MiddlewareHandler<Env> = async (c, next) => {
  const header = c.req.header('authorization');
  const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
  const userId = token ? await verifyAccessToken(token) : null;
  if (!userId) throw new HTTPException(401, { message: 'unauthorized' });
  c.set('userId', userId);
  await next();
};

/** 404 rather than 403, so non-members cannot probe which groups exist. Pending requests are not members yet. */
export async function requireMember(groupId: string, userId: string) {
  const [row] = await db
    .select({
      role: groupMembers.role,
      currentKeyVersion: groups.currentKeyVersion,
      ephemeralSeconds: groups.ephemeralSeconds,
      kind: groups.kind,
      rotationPending: groups.rotationPending,
    })
    .from(groupMembers)
    .innerJoin(groups, eq(groups.id, groupMembers.groupId))
    .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, userId), eq(groupMembers.status, 'active'), groupAlive));
  if (!row) throw new HTTPException(404, { message: 'not_found' });
  return row;
}

export async function requireAdmin(groupId: string, userId: string) {
  const row = await requireMember(groupId, userId);
  if (row.role !== 'admin') throw new HTTPException(403, { message: 'admin_only' });
  return row;
}

/** What only a group has (members coming and going, admins to name): refused for a private conversation. */
export function requireGroupKind(kind: 'group' | 'direct' | 'link') {
  if (kind === 'direct') throw new HTTPException(400, { message: 'direct_conversation' });
}

/** Records one `action` for the user, or 429 once the day's quota is spent. Record first, then count: races cannot slip past. */
/** An hourly attempt ceiling was reached (login, join): ask the caller to come back in an hour. */
export function tooManyAttempts(c: Context): never {
  c.header('Retry-After', '3600');
  throw new HTTPException(429, { message: 'too_many_attempts' });
}

export async function spendQuota(userId: string, action: 'invite' | 'group_code' | 'direct', perDay: number) {
  await db.insert(userActions).values({ userId, action });
  const [{ count } = { count: 0 }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(userActions)
    .where(and(eq(userActions.userId, userId), eq(userActions.action, action), gt(userActions.at, sql`now() - interval '1 day'`)));
  if (count > perDay) throw new HTTPException(429, { message: 'too_many_requests' });
}

export function groupIdParam(c: Context): string {
  return uuidParam(c, 'groupId');
}

export function uuidParam(c: Context, name: string): string {
  const parsed = z.uuid().safeParse(c.req.param(name));
  if (!parsed.success) throw new HTTPException(404, { message: 'not_found' });
  return parsed.data;
}

export const toWireMessage = (m: typeof messages.$inferSelect) => ({
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
  // Deleted by its sender: nothing left to decrypt, the phones show « message supprimé ».
  ...(m.deletedAt && { deleted: true as const }),
});
export type WireMessage = ReturnType<typeof toWireMessage>;

export async function adminCount(groupId: string): Promise<number> {
  const [{ n } = { n: 0 }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(groupMembers)
    .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.role, 'admin'), eq(groupMembers.status, 'active')));
  return n;
}

export async function activeCount(groupId: string): Promise<number> {
  const [{ n } = { n: 0 }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(groupMembers)
    .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.status, 'active')));
  return n;
}

/**
 * Removes a member and flags the group for key rotation: the leaver keeps the
 * old keys (and history), but the next key is drawn by an admin's phone and
 * sealed only to those who stay (SPEC §4.3). The last member out deletes the
 * group. The last admin must hand the role over before leaving (PUT /admins).
 */
export async function removeMember(groupId: string, userId: string, ban: boolean) {
  const orphaned = await db.transaction(async (tx): Promise<string[]> => {
    await tx.select({ id: groups.id }).from(groups).where(eq(groups.id, groupId)).for('update');
    const [was] = await tx
      .delete(groupMembers)
      .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, userId)))
      .returning({ status: groupMembers.status });
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
    // Someone who held the key: nothing new is sent under it until the next one is drawn (POST /messages).
    if (was?.status === 'active') await tx.update(groups).set({ rotationPending: true }).where(eq(groups.id, groupId));
    return [];
  });
  // After the commit: a storage failure must not keep the group alive. Blobs are
  // encrypted with keys only the members held, so a leftover is unreadable.
  if (orphaned.length) await deleteObjects(orphaned).catch((e: Error) => console.error('[storage]', e.name));
}

/** A private conversation goes for both of us at once: its files, then the group (members, keys, messages cascade). */
export async function deleteConversation(groupId: string) {
  const files = await db.transaction(async (tx) => {
    const files = await tx.select({ id: attachments.id }).from(attachments).where(eq(attachments.groupId, groupId));
    await tx.delete(groups).where(eq(groups.id, groupId));
    return files.map((f) => objectKey(groupId, f.id));
  });
  if (files.length) await deleteObjects(files).catch((e: Error) => console.error('[storage]', e.name));
  realtime.nudge();
}

export async function unreadByGroup(me: string, cursors: Record<string, number>): Promise<Record<string, number>> {
  const ids = Object.keys(cursors);
  if (!ids.length) return {};
  const { rows } = await pool.query<{ group_id: string; n: number }>(
    `select m.group_id, count(*)::int as n
       from unnest($2::uuid[], $3::bigint[]) as c(group_id, seq)
       join group_members gm on gm.group_id = c.group_id and gm.user_id = $1 and gm.status = 'active'
       join messages m on m.group_id = c.group_id and m.seq > c.seq
      where m.sender_id <> $1
        and not m.quiet
        and (m.expires_at is null or m.expires_at > now())
      group by m.group_id`,
    [me, ids, ids.map((id) => cursors[id])],
  );
  return Object.fromEntries(rows.map((r) => [r.group_id, r.n]));
}
