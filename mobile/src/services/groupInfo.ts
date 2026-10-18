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
}

/**
 * The group's info sheet. Name and keywords come from the meta decrypted on
 * this phone (saved at unlock), so the server never sees them; members and
 * roles come from the server.
 */
export async function groupInfo(s: Session, profiles: ProfileCache, groupId: string): Promise<GroupInfo> {
  const [meta, { members }] = await Promise.all([s.vault.meta(groupId, s.masterKey), s.api.members(groupId)]);
  const known = await profiles.get(members.map((m) => m.userId));
  const rows = members.map((m) => ({
    userId: m.userId,
    username: known.get(m.userId)?.username ?? '?',
    role: m.role,
    me: m.userId === s.account.userId,
    hasKey: m.hasCurrentKey,
  }));
  rows.sort((a, b) => (a.role === b.role ? a.username.localeCompare(b.username) : a.role === 'admin' ? -1 : 1));
  return { name: meta?.name ?? null, keywords: meta?.keywords ?? null, members: rows };
}
