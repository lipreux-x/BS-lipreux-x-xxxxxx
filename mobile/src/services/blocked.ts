import { records, type LocalStore } from './localStore';

/**
 * Members blocked on this phone (App Store rule 1.2): their messages and
 * stories are no longer shown, in every group. The server and they know
 * nothing of it. Kept in the local store, by user id, with the username at
 * the time (to list them in the settings and unblock them).
 */
export type BlockedUsers = Readonly<Record<string, string>>;

export async function blockedUsers(local: LocalStore): Promise<BlockedUsers> {
  return (await local.getRecord<BlockedUsers>(records.blocked)) ?? {};
}

export async function block(local: LocalStore, userId: string, username: string): Promise<BlockedUsers> {
  const next = { ...(await blockedUsers(local)), [userId]: username };
  await local.setRecord(records.blocked, next);
  return next;
}

export async function unblock(local: LocalStore, userId: string): Promise<BlockedUsers> {
  const next: Record<string, string> = { ...(await blockedUsers(local)) };
  delete next[userId];
  await local.setRecord(records.blocked, next);
  return next;
}
