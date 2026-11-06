import { encryptGroupMeta, generateGroupKey, sealHandout, type GroupMeta } from '@/crypto';
import { wipe } from '@/crypto/encoding';
import { ApiError, type GroupSummary } from '../api';
import type { StoredGroupSecret } from '../vault';
import { CodeChangedError, GroupTamperedError, KeyChangedError, staleCode, summary, type GroupKeys, type Session } from './core';
import { conversationName } from './membership';
import type { ProfileCache } from './profiles';
import { verifyGroup } from './verify';

/**
 * Brings an open group up to date: an admin's phone rotates the key if a
 * member left; everyone opens versions rotated by an admin and refreshes the
 * verified meta. Throws ApiError 404 if we are no longer a member.
 */
export async function syncGroup(
  s: Session,
  profiles: ProfileCache,
  groupId: string,
  keys: GroupKeys,
): Promise<{ summary: GroupSummary; keys: GroupKeys; keyVersion: number; meta: GroupMeta; name: string; adminChanged: boolean }> {
  let g = await summary(s, groupId);
  const secret = await s.vault.groupSecret(groupId, s.masterKey);
  if (!secret) throw new ApiError(409, 'no_group_secret');
  let opened: Awaited<ReturnType<typeof verifyGroup>>;
  try {
    opened = await verifyGroup(s, profiles, g, secret, keys);
  } catch (e) {
    // A key rotated under the admin's new code: only that code reads it.
    if (staleCode(secret, g) && e instanceof ApiError && e.status === 409) throw new CodeChangedError();
    throw e;
  }
  // Under an old code the new key would be wrapped where the others can no longer open it: rotate once relocked.
  if (!staleCode(secret, g) && (await rotationDue(s, g, opened.meta))) {
    try {
      await rotateKey(s, profiles, g, opened.meta, secret);
    } catch (e) {
      // Another admin rotated first, or membership changed meanwhile: take theirs, retry later.
      if (!(e instanceof ApiError && e.status === 409)) throw e;
    }
    g = await summary(s, groupId);
    opened = await verifyGroup(s, profiles, g, secret, opened.keys);
  }
  const name = await conversationName(s, profiles, opened.meta);
  return { summary: g, keys: opened.keys, keyVersion: g.currentKeyVersion, meta: opened.meta, name, adminChanged: opened.adminChanged };
}

/** A key older than this is replaced by the next admin who opens the group: a key that leaks opens a week at most. */
export const KEY_LIFETIME_MS = 7 * 86_400_000;

/**
 * Whether this phone draws the next key now:
 * - an admin, when someone who held the key left, or once the key is a week
 *   old (not in a private conversation: nobody ever leaves one, it is deleted);
 * - any member, when someone left and no admin is left to do it (the last
 *   one deleted their account): the server refuses messages until then, and
 *   the member's phone names itself admin in the new meta.
 */
async function rotationDue(s: Session, g: GroupSummary, meta: GroupMeta): Promise<boolean> {
  const me = s.account.userId;
  if (g.role === 'admin' && meta.admins.includes(me)) {
    if (g.rotationPending) return true;
    return g.kind !== 'direct' && !!g.keySince && Date.now() - Date.parse(g.keySince) > KEY_LIFETIME_MS;
  }
  if (!g.rotationPending || g.kind === 'direct') return false;
  const { members } = await s.api.members(g.id);
  return members.every((m) => m.role !== 'admin');
}

/**
 * Admin: draws a new key for the meta's members who are still in the group.
 * Anyone the server lists that no admin let in stops it (GroupTamperedError):
 * a ghost never receives a key.
 */
async function rotateKey(s: Session, profiles: ProfileCache, g: GroupSummary, meta: GroupMeta, secret: StoredGroupSecret) {
  const me = s.account.userId;
  const { members } = await s.api.members(g.id);
  const ids = members.map((m) => m.userId);
  if (ids.some((id) => !meta.members.includes(id))) throw new GroupTamperedError('unknown_member');
  const pinned = await profiles.trustedKeys(ids);
  const groupKey = generateGroupKey();
  const v = g.currentKeyVersion + 1;
  const admins = meta.admins.filter((a) => ids.includes(a));
  const next: GroupMeta = { ...meta, members: ids, admins: admins.length ? admins : [me], rev: meta.rev + 1 };
  const handouts = ids.map((userId) => {
    const p = pinned.get(userId);
    if (!p) throw new KeyChangedError(userId);
    return { userId, ...sealHandout(groupKey, secret.wrapKey, g.id, v, { userId, boxPublicKey: p.boxPublicKey }, s.identity, next.name) };
  });
  await s.api.rotateKey(g.id, {
    fromKeyVersion: g.currentKeyVersion,
    ...encryptGroupMeta(next, g.id, v, groupKey, s.identity),
    admins: next.admins,
    keys: handouts,
  });
  wipe(groupKey); // the next verifyGroup opens our own handout
}

/** Admin, right after removing someone: the removed member's key stops working for anything new. */
export async function rotateNow(s: Session, profiles: ProfileCache, groupId: string, keys: GroupKeys) {
  const g = await summary(s, groupId);
  const secret = await s.vault.groupSecret(groupId, s.masterKey);
  if (!secret) throw new ApiError(409, 'no_group_secret');
  if (staleCode(secret, g)) throw new CodeChangedError();
  const { keys: all, meta } = await verifyGroup(s, profiles, g, secret, keys);
  await rotateKey(s, profiles, g, meta, secret);
  return syncGroup(s, profiles, groupId, all);
}
