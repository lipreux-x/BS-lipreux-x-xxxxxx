import { directWrapKey, type GroupMeta } from '@/crypto';
import { ApiError, NetworkError, type Api, type GroupSummary, type PendingGroupSummary } from '../api';
import { records, type LocalStore } from '../localStore';
import type { StoredGroupSecret, UnlockedVault, Vault } from '../vault';

/*
 * Group flows on top of the API, the crypto module and the vault (SPEC §4.3–4.4).
 *
 * What protects a group:
 * - the code + 3 keywords never leave the phones; they derive joinKey (sent,
 *   to find the group) and wrapKey (kept), see crypto/groupSecret.ts;
 * - every key handout on the server is wrapped under wrapKey, sealed to the
 *   member and signed by an admin: a handout opens only with the member's
 *   identity AND the code + keywords, and is accepted only from an admin;
 * - the meta (name, keywords, admins, members, revision) is signed by an
 *   admin: phones follow its admin and member lists, never the server's;
 * - contacts' public keys are pinned on first sight: a key the server swaps
 *   later is refused (and shown), never used.
 *
 * Flows:
 * - create: the phone draws the group key, writes the signed meta, hands the
 *   key to itself and locks it locally with code + master key.
 * - join: joinKey goes to the server, which records a pending request. An
 *   admin compares safety numbers if they want, then approves from their
 *   phone: that hands over the current key and adds the newcomer to the meta.
 * - first unlock: the handout is opened with the code (+ keywords if this
 *   phone does not know them yet, e.g. after signing in again), checked
 *   against the meta, then locked locally under the code.
 * - rotation (a member left or was removed): an admin's phone draws a new key
 *   for the members of the meta who are still there.
 * - code change (admin): new joinKey, new keywords in the meta, every handout
 *   re-wrapped under the new code. Other members type the new code once.
 * - offline: the last group list from the server is kept in the local store
 *   (handouts included), so the list shows and a group unlocks without
 *   network, with the same checks (code, signatures, meta revision).
 * - private conversation (createDirect): a group of two, opened from a group
 *   both are in. No code + keywords: its handouts open with the identity
 *   alone (crypto/group.ts directWrapKey), and each phone locks the key under
 *   a code of its own, chosen at the first unlock. Nobody joins, leaves or
 *   rotates; leaving deletes it for both.
 * - group without a code (createGroup with a null code, kind 'link'): its
 *   handouts open with the identity alone, like a private conversation's, and
 *   the phone keeps the key under the master key only (the app code opens
 *   it). Newcomers come in with a single-use link an admin sends them
 *   (createGroupLink, joinWithLink): it files a join request, approved from
 *   an admin's phone as usual, and is burnt whatever the answer.
 */

/** Group keys by version (messages carry the version they were sent with). */
export type GroupKeys = Map<number, Uint8Array>;

export interface Session extends UnlockedVault {
  api: Api;
  vault: Vault;
  /** Messages, group summaries, profiles and media kept on the phone (SPEC §5.2). */
  local: LocalStore;
}

export type GroupLockState =
  | { kind: 'pending' } // asked to join, waiting for an admin to approve
  | { kind: 'locked'; codeChanged: boolean } // local key present: type the group code (the admin changed it since: old or new)
  | { kind: 'first-unlock'; needsKeywords: boolean } // key handed over, not stored locally yet
  | { kind: 'waiting-key' }; // member, but no key for the current version reached us yet

export interface GroupListItem {
  id: string;
  /** From the meta once the group was unlocked on this phone; before that, the name an admin sealed to us beside the key; null without either. */
  name: string | null;
  /**
   * Without a name: who else is in it (usernames, as the server lists them),
   * so that locked groups can still be told apart. Null with a name, for a
   * pending group, or offline.
   */
  members: string[] | null;
  keyVersion: number;
  role: 'admin' | 'member';
  state: GroupLockState;
  /** Self-destruct date (ISO), null for a permanent group. */
  expiresAt: string | null;
  /** Messages from others past the last one shown here (0 offline, or for a pending group). */
  unread: number;
  /** When the conversation was last on screen on this phone (ms), null if never. */
  openedAt: number | null;
  /** A private conversation: `name` is the other person's username. */
  direct: boolean;
  /** Private conversation: the other person (from the verified meta once opened here, the server's hint before). */
  peerId: string | null;
  /** Private conversation: the other person's avatar icon id. */
  avatar: string | null;
  /** A group without a code: the app code alone opens it, newcomers come in with a link. */
  link: boolean;
}

/** The name on a group's plate: its own, or "Avec …" its other members when the phone has none yet; null with neither. */
export function plateName(item: GroupListItem): string | null {
  if (item.name) return item.name;
  return item.members?.length ? `Avec ${item.members.join(', ')}` : null;
}

/** The server put someone in the group no admin let in, or a key it should not have. */
export class GroupTamperedError extends Error {
  constructor(public readonly reason: 'unknown_member' | 'untrusted_signer' | 'rollback' | 'not_a_member' | 'keywords_mismatch') {
    super(reason);
    this.name = 'GroupTamperedError';
  }
}

/**
 * The admin changed the group code since this phone stored it: keys must not
 * be handed out (or read) under the old one. The group is locked again and
 * the new code typed (unlockGroup takes it).
 */
export class CodeChangedError extends Error {
  constructor() {
    super('code_changed');
    this.name = 'CodeChangedError';
  }
}

/** A contact's public keys differ from the ones pinned on this phone. */
export class KeyChangedError extends Error {
  constructor(public readonly userId: string) {
    super('key_changed');
    this.name = 'KeyChangedError';
  }
}

/** Stored before the admin's last code change (0: joined, approval pending, not known yet). */
export const staleCode = (secret: StoredGroupSecret, g: GroupSummary) => secret.codeVersion !== 0 && secret.codeVersion < g.codeVersion;

export const isActive = (g: GroupSummary | PendingGroupSummary): g is GroupSummary => g.status === 'active';

/** A group entered with its code + keywords (not a private conversation, nor a group without a code). */
export const hasCode = (g: GroupSummary) => (g.kind ?? 'group') === 'group';

/** The other member of a private conversation's meta. */
export function peerOf(meta: GroupMeta, me: string): string | null {
  return meta.direct ? (meta.members.find((m) => m !== me) ?? null) : null;
}

/** What the handouts of a private conversation or a group without a code open with: no code, no keywords (crypto/group.ts directWrapKey). */
export const noCodeSecret = (codeVersion: number): StoredGroupSecret => ({ wrapKey: directWrapKey(), keywords: [], codeVersion });

export type AnyGroupSummary = GroupSummary | PendingGroupSummary;

/**
 * The last list built for this session, in memory only (gone with the session
 * when the app locks): a group's screen starts from it at once, then refreshes.
 */
const lastListed = new WeakMap<Session, GroupListItem[]>();

/** Records the list built for this session (listGroups), for listedGroups/readCursors to read back. */
export function rememberListed(s: Session, items: GroupListItem[]) {
  lastListed.set(s, items);
}

export function listedGroups(s: Session): GroupListItem[] | undefined {
  return lastListed.get(s);
}

/**
 * Our groups from the server, saved on the phone; the saved list when there
 * is no network (`offline`). Throws NetworkError if nothing was saved yet.
 */
export async function fetchGroups(s: Session): Promise<{ groups: AnyGroupSummary[]; offline: boolean }> {
  try {
    const groups = await s.api.groups();
    await s.local.setRecord(records.groups, groups.map((g) => g.id));
    for (const g of groups) await s.local.setRecord(records.group(g.id), g);
    return { groups, offline: false };
  } catch (e) {
    if (!(e instanceof NetworkError)) throw e;
    const ids = await s.local.getRecord<string[]>(records.groups);
    if (!ids) throw e;
    const saved = await Promise.all(ids.map((id) => s.local.getRecord<AnyGroupSummary>(records.group(id))));
    return { groups: saved.filter((g): g is AnyGroupSummary => g !== null), offline: true };
  }
}

/** Erases what the phone keeps of a group: keys, secret, meta, counters, messages, media. */
export async function forgetGroup(s: Session, groupId: string, upTo: number) {
  await s.vault.forgetGroup(groupId, upTo);
  await s.local.forgetGroup(groupId).catch(() => {});
}

export async function summary(s: Session, groupId: string): Promise<GroupSummary> {
  const g = (await s.api.groups()).find((x) => x.id === groupId);
  if (!g || !isActive(g)) throw new ApiError(404, 'not_found');
  return g;
}
