import { ApiError } from './api';
import type { ProfileCache, Session } from './groups';

export interface GroupInfoMember {
  userId: string;
  username: string;
  role: 'admin' | 'member';
  me: boolean;
  hasKey: boolean; // false: joined, waiting for a member to share the key
}

export interface GroupInfo {
  name: string | null;
  keywords: string[] | null; // null: group created before keywords existed
  members: GroupInfoMember[]; // admins first, then by username
  myRole: 'admin' | 'member';
  ephemeralSeconds: number | null;
  keyVersion: number;
}

/**
 * The group's settings sheet. Name and keywords come from the meta decrypted
 * on this phone (saved at unlock), so the server never sees them; members,
 * roles and settings come from the server.
 */
export async function groupInfo(s: Session, profiles: ProfileCache, groupId: string): Promise<GroupInfo> {
  const [meta, { members }, groups] = await Promise.all([s.vault.meta(groupId, s.masterKey), s.api.members(groupId), s.api.groups()]);
  const g = groups.find((x) => x.id === groupId);
  if (!g) throw new ApiError(404, 'not_found');
  const known = await profiles.get(members.map((m) => m.userId));
  const rows = members.map((m) => ({
    userId: m.userId,
    username: known.get(m.userId)?.username ?? '?',
    role: m.role,
    me: m.userId === s.account.userId,
    hasKey: m.hasCurrentKey,
  }));
  rows.sort((a, b) => (a.role === b.role ? a.username.localeCompare(b.username) : a.role === 'admin' ? -1 : 1));
  return {
    name: meta?.name ?? null,
    keywords: meta?.keywords ?? null,
    members: rows,
    myRole: g.role,
    ephemeralSeconds: g.ephemeralSeconds,
    keyVersion: g.currentKeyVersion,
  };
}

/** Leaves the group and erases what this phone kept of it (keys, name, attempt counter). */
export async function leaveGroup(s: Session, groupId: string, keyVersion: number): Promise<void> {
  await s.api.leaveGroup(groupId);
  await s.vault.forgetGroup(groupId, keyVersion);
}
