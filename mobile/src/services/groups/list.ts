import { openHandoutLabel } from '@/crypto';
import { records } from '../localStore';
import type { GroupSummary } from '../api';
import {
  fetchGroups,
  forgetGroup,
  hasCode,
  isActive,
  listedGroups,
  peerOf,
  rememberListed,
  staleCode,
  type GroupListItem,
  type GroupLockState,
  type Session,
} from './core';
import type { KnownProfile, ProfileCache } from './profiles';

/** What the phone keeps of a conversation's reading: the last seq shown, and when it was last on screen. */
interface SeenRecord {
  seq: number;
  at: number;
}

/**
 * The groups we belong to (or asked to join), the ones opened last first,
 * each with the number of messages waiting in it. A group this phone kept
 * something for that the server no longer lists (self-destructed, removed,
 * request refused) is erased from the phone too: keys, name, counters,
 * messages. Without network: the last list saved on the phone (`offline`).
 */
export async function listGroups(s: Session, profiles: ProfileCache): Promise<{ items: GroupListItem[]; offline: boolean }> {
  const { groups, offline } = await fetchGroups(s);
  if (!offline) {
    const alive = new Set(groups.map((g) => g.id));
    for (const [id, upTo] of Object.entries(await s.vault.knownGroups())) {
      if (!alive.has(id)) await forgetGroup(s, id, upTo);
    }
  }
  const seen = new Map(await Promise.all(groups.map(async (g) => [g.id, await s.local.getRecord<SeenRecord>(records.seen(g.id)).catch(() => null)] as const)));
  const unread = offline ? {} : await unreadCounts(s, groups.filter(isActive).map((g) => [g.id, seen.get(g.id)?.seq ?? 0]));
  const items = await Promise.all(
    groups.map(async (g): Promise<GroupListItem> => {
      const openedAt = seen.get(g.id)?.at ?? null;
      if (!isActive(g)) {
        return {
          id: g.id,
          name: null,
          members: null,
          keyVersion: 0,
          role: 'member',
          state: { kind: 'pending' },
          expiresAt: g.expiresAt ?? null,
          unread: 0,
          openedAt,
          direct: false,
          peerId: null,
          avatar: null,
          link: false,
        };
      }
      const meta = await s.vault.meta(g.id, s.masterKey);
      const direct = g.kind === 'direct';
      const peerId = direct ? ((meta && peerOf(meta, s.account.userId)) ?? g.peerId ?? null) : null;
      const peer = peerId ? (await profiles.get([peerId]).catch(() => new Map<string, KnownProfile>())).get(peerId) : undefined;
      const name = direct ? (peer?.username ?? (await handoutName(s, profiles, g))) : (meta?.name ?? (await handoutName(s, profiles, g)));
      return {
        id: g.id,
        name,
        members: name === null && !offline && !direct ? await otherMembers(s, profiles, g.id) : null,
        keyVersion: g.currentKeyVersion,
        role: g.role,
        state: await lockState(s, g),
        expiresAt: g.expiresAt ?? null,
        unread: unread[g.id] ?? 0,
        openedAt,
        direct,
        peerId,
        avatar: peer?.avatar ?? null,
        link: g.kind === 'link',
      };
    }),
  );
  // Opened last on top; never opened after, in the server's order.
  items.sort((a, b) => (b.openedAt ?? 0) - (a.openedAt ?? 0));
  rememberListed(s, items);
  return { items, offline };
}

/**
 * Where this phone stands in each group (group id -> last seq shown here), for
 * the server to count what waits as the app goes to the background: the app
 * icon's badge. The groups of the last list, or those this phone keeps keys for.
 */
export async function readCursors(s: Session): Promise<Record<string, number>> {
  const ids = listedGroups(s)?.filter((g) => g.state.kind !== 'pending').map((g) => g.id) ?? Object.keys(await s.vault.knownGroups());
  const entries = await Promise.all(
    ids.slice(0, 200).map(async (id) => [id, (await s.local.getRecord<SeenRecord>(records.seen(id)).catch(() => null))?.seq ?? 0] as const),
  );
  return Object.fromEntries(entries);
}

/** Best effort: without an answer (old server, outage) nothing waits anywhere. */
async function unreadCounts(s: Session, cursors: (readonly [string, number])[]): Promise<Record<string, number>> {
  if (!cursors.length) return {};
  try {
    return await s.api.unread(Object.fromEntries(cursors));
  } catch {
    return {};
  }
}

/**
 * The conversation is on screen, showing messages up to `seq`: nothing up to
 * there waits any more, and the group moves to the top of the list. The seq
 * never goes back (a screen that opens before its history loads passes 0).
 */
export async function markOpened(s: Session, groupId: string, seq = 0) {
  try {
    const prev = await s.local.getRecord<SeenRecord>(records.seen(groupId));
    await s.local.setRecord(records.seen(groupId), { seq: Math.max(prev?.seq ?? 0, seq), at: Date.now() });
  } catch {
    // Store closed (locked meanwhile): the next opening marks it.
  }
}

/**
 * Before the first unlock on this phone (the meta is still sealed under the
 * group key): the name an admin sealed to us beside a key, newest version
 * first, from a signer whose key is pinned. Null without one, or offline
 * with an unknown signer: the plate then says "Groupe verrouillé".
 */
async function handoutName(s: Session, profiles: ProfileCache, g: GroupSummary): Promise<string | null> {
  const labelled = g.sealedKeys.filter((h) => h.sealedLabel && h.labelSignature).sort((a, b) => b.keyVersion - a.keyVersion);
  if (!labelled.length) return null;
  try {
    const signers = await profiles.trustedKeys([...new Set(labelled.map((h) => h.labelSignerId ?? h.signerId))]);
    for (const h of labelled) {
      const signer = signers.get(h.labelSignerId ?? h.signerId);
      if (!signer) continue;
      try {
        return openHandoutLabel(h, signer.signPublicKey, g.id, h.keyVersion, { ...s.identity, userId: s.account.userId });
      } catch {
        // Forged or not for us: the next one may do.
      }
    }
  } catch {
    // Profiles unreachable: no name this time.
  }
  return null;
}

/**
 * A group with no name on this phone (from before the sealed name, until an
 * admin opens it): the usernames of the others in it, admins first. Only a
 * hint to tell plates apart, nothing is verified. Null if unreachable.
 */
async function otherMembers(s: Session, profiles: ProfileCache, groupId: string): Promise<string[] | null> {
  try {
    const { members } = await s.api.members(groupId);
    const others = members.filter((m) => m.userId !== s.account.userId).sort((a, b) => (a.role === b.role ? 0 : a.role === 'admin' ? -1 : 1));
    const known = await profiles.get(others.map((m) => m.userId));
    return others.flatMap((m) => {
      const p = known.get(m.userId);
      return p ? [p.username] : [];
    });
  } catch {
    return null;
  }
}

async function lockState(s: Session, g: GroupSummary): Promise<GroupLockState> {
  // An older local key still proves the code after a rotation (see unlockGroup).
  if ((await s.vault.latestGroupKeyVersion(g.id, g.currentKeyVersion)) !== null) {
    const secret = await s.vault.groupSecret(g.id, s.masterKey);
    return { kind: 'locked', codeChanged: !!secret && staleCode(secret, g) };
  }
  if (g.sealedKeys.some((k) => k.keyVersion === g.currentKeyVersion)) {
    // A private conversation has no keywords (its first unlock only chooses this phone's code); a group without a code neither.
    return { kind: 'first-unlock', needsKeywords: hasCode(g) && (await s.vault.groupSecret(g.id, s.masterKey)) === null };
  }
  return { kind: 'waiting-key' };
}
