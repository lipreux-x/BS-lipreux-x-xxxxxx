import { ApiError } from './api';
import type { ProfileCache, Session } from './groups';

export interface GroupInfoMember {
  userId: string;
  username: string;
  avatar: string | null;
  role: 'admin' | 'member';
  me: boolean;
  /** Their keys changed since this phone first saw them: messages and keys from them are not trusted. */
  keyChanged: boolean;
  /** Listed by the server but not let in by an admin (the meta does not know them). */
  unknown: boolean;
}

export interface GroupInfo {
  name: string | null;
  keywords: string[] | null;
  members: GroupInfoMember[]; // admins first, then by username
  myRole: 'admin' | 'member';
  ephemeralSeconds: number | null;
  keyVersion: number;
  /** Self-destruct date (ISO), null for a permanent group. */
  expiresAt: string | null;
}

/**
 * The group's settings sheet. Name and keywords come from the meta decrypted
 * on this phone (saved at unlock), so the server never sees them; members,
 * roles and settings come from the server.
 */
export async function groupInfo(s: Session, profiles: ProfileCache, groupId: string): Promise<GroupInfo> {
  const [meta, { members }, groups] = await Promise.all([s.vault.meta(groupId, s.masterKey), s.api.members(groupId), s.api.groups()]);
  const g = groups.find((x) => x.id === groupId);
  if (!g || g.status !== 'active') throw new ApiError(404, 'not_found');
  const known = await profiles.get(members.map((m) => m.userId));
  // Roles come from the signed meta (the server's copy only mirrors it).
  const rows = members.map((m) => ({
    userId: m.userId,
    username: known.get(m.userId)?.username ?? '?',
    avatar: known.get(m.userId)?.avatar ?? null,
    role: meta?.admins.includes(m.userId) ? ('admin' as const) : ('member' as const),
    me: m.userId === s.account.userId,
    keyChanged: known.get(m.userId)?.keyChanged ?? false,
    unknown: !!meta && !meta.members.includes(m.userId),
  }));
  rows.sort((a, b) => (a.role === b.role ? a.username.localeCompare(b.username) : a.role === 'admin' ? -1 : 1));
  return {
    name: meta?.name ?? null,
    keywords: meta?.keywords ?? null,
    members: rows,
    myRole: meta?.admins.includes(s.account.userId) ? 'admin' : 'member',
    ephemeralSeconds: g.ephemeralSeconds,
    keyVersion: g.currentKeyVersion,
    expiresAt: g.expiresAt ?? null,
  };
}

/** Leaves the group and erases what this phone kept of it (keys, secret, name, attempt counter). 409 handover_required for the last admin. */
export async function leaveGroup(s: Session, groupId: string, keyVersion: number): Promise<void> {
  await s.api.leaveGroup(groupId);
  await s.vault.forgetGroup(groupId, keyVersion);
}
