import { randomUUID } from 'expo-crypto';
import {
  b64,
  CryptoError,
  decryptAttachment,
  decryptGroupMeta,
  decryptMessage,
  deriveGroupSecrets,
  encodeMessageBody,
  encryptAttachment,
  encryptGroupMeta,
  encryptMessage,
  generateGroupKey,
  MAX_ATTACHMENT_BYTES,
  openHandout,
  parseMessageBody,
  keyFingerprint,
  parsePublicIdentity,
  sameKeywords,
  sealHandout,
  STORY_TTL_SECONDS,
  type FileBody,
  type GroupMeta,
  type ImageBody,
  type ReactionBody,
  type ReplyRef,
  type StoryBody,
  type VoiceBody,
} from '@/crypto';
import { constantTimeEqual, wipe } from '@/crypto/encoding';
import { ApiError, NetworkError, type Api, type GroupSummary, type PendingGroupSummary, type Profile, type WireMessage } from './api';
import { records, type LocalStore } from './localStore';
import type { StoredGroupSecret, UnlockedVault, Vault } from './vault';

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
  name: string | null; // null until the group was unlocked once on this phone
  keyVersion: number;
  role: 'admin' | 'member';
  state: GroupLockState;
  /** Self-destruct date (ISO), null for a permanent group. */
  expiresAt: string | null;
  /** Messages from others past the last one shown here (0 offline, or for a pending group). */
  unread: number;
  /** When the conversation was last on screen on this phone (ms), null if never. */
  openedAt: number | null;
}

/** What the phone keeps of a conversation's reading: the last seq shown, and when it was last on screen. */
interface SeenRecord {
  seq: number;
  at: number;
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

/** Stored before the admin's last code change (0: joined, approval pending, not known yet). */
const staleCode = (secret: StoredGroupSecret, g: GroupSummary) => secret.codeVersion !== 0 && secret.codeVersion < g.codeVersion;

/** A contact's public keys differ from the ones pinned on this phone. */
export class KeyChangedError extends Error {
  constructor(public readonly userId: string) {
    super('key_changed');
    this.name = 'KeyChangedError';
  }
}

const isActive = (g: GroupSummary | PendingGroupSummary): g is GroupSummary => g.status === 'active';

/**
 * The groups we belong to (or asked to join), the ones opened last first,
 * each with the number of messages waiting in it. A group this phone kept
 * something for that the server no longer lists (self-destructed, removed,
 * request refused) is erased from the phone too: keys, name, counters,
 * messages. Without network: the last list saved on the phone (`offline`).
 */
export async function listGroups(s: Session): Promise<{ items: GroupListItem[]; offline: boolean }> {
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
      return isActive(g)
        ? {
            id: g.id,
            name: (await s.vault.meta(g.id, s.masterKey))?.name ?? null,
            keyVersion: g.currentKeyVersion,
            role: g.role,
            state: await lockState(s, g),
            expiresAt: g.expiresAt ?? null,
            unread: unread[g.id] ?? 0,
            openedAt,
          }
        : { id: g.id, name: null, keyVersion: 0, role: 'member', state: { kind: 'pending' }, expiresAt: g.expiresAt ?? null, unread: 0, openedAt };
    }),
  );
  // Opened last on top; never opened after, in the server's order.
  items.sort((a, b) => (b.openedAt ?? 0) - (a.openedAt ?? 0));
  return { items, offline };
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

type AnyGroupSummary = GroupSummary | PendingGroupSummary;

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

async function lockState(s: Session, g: GroupSummary): Promise<GroupLockState> {
  // An older local key still proves the code after a rotation (see unlockGroup).
  if ((await s.vault.latestGroupKeyVersion(g.id, g.currentKeyVersion)) !== null) {
    const secret = await s.vault.groupSecret(g.id, s.masterKey);
    return { kind: 'locked', codeChanged: !!secret && staleCode(secret, g) };
  }
  if (g.sealedKeys.some((k) => k.keyVersion === g.currentKeyVersion)) {
    return { kind: 'first-unlock', needsKeywords: (await s.vault.groupSecret(g.id, s.masterKey)) === null };
  }
  return { kind: 'waiting-key' };
}

async function summary(s: Session, groupId: string): Promise<GroupSummary> {
  const g = (await s.api.groups()).find((x) => x.id === groupId);
  if (!g || !isActive(g)) throw new ApiError(404, 'not_found');
  return g;
}

/** `expiresAt`: self-destruct date (the group and everything in it is deleted for everyone), or null. */
export async function createGroup(
  s: Session,
  name: string,
  groupCode: string,
  keywords: string[],
  expiresAt: Date | null = null,
): Promise<{ id: string; groupKey: Uint8Array; meta: GroupMeta }> {
  const id = randomUUID();
  const me = s.account.userId;
  const groupKey = generateGroupKey();
  const { joinKey, wrapKey } = await deriveGroupSecrets(groupCode, keywords);
  const meta: GroupMeta = { name, keywords, admins: [me], members: [me], rev: 1 };
  const signed = encryptGroupMeta(meta, id, 1, groupKey, s.identity);
  const handout = sealHandout(groupKey, wrapKey, id, 1, { userId: me, boxPublicKey: s.identity.boxPublicKey }, s.identity);
  await s.api.createGroup({
    id,
    ...signed,
    joinKey: b64.encode(joinKey),
    sealedKey: handout.sealedKey,
    keySignature: handout.signature,
    ...(expiresAt && { expiresAt: expiresAt.toISOString() }),
  });
  wipe(joinKey);
  await s.vault.saveGroupSecret(id, { wrapKey, keywords, codeVersion: 1 }, s.masterKey);
  await s.vault.saveGroupKey(id, 1, groupKey, groupCode, s.masterKey);
  await s.vault.saveMeta(id, meta, 1, s.masterKey);
  await s.vault.setCodeVersion(id, 1);
  return { id, groupKey, meta };
}

/**
 * Asks to join. Returns the group id; the request waits for an admin. The
 * code and keywords stay on this phone (their wrapKey is kept to open the
 * key once an admin hands it over).
 */
export async function joinGroup(s: Session, groupCode: string, keywords: string[]): Promise<string> {
  const { joinKey, wrapKey } = await deriveGroupSecrets(groupCode, keywords);
  try {
    const { groupId } = await s.api.joinGroup(b64.encode(joinKey));
    // codeVersion 0: not known until approved (then checked against the server's).
    await s.vault.saveGroupSecret(groupId, { wrapKey, keywords, codeVersion: 0 }, s.masterKey);
    return groupId;
  } finally {
    wipe(joinKey);
  }
}

// ---- Verifying what the server returns -------------------------------------------

/**
 * Opens every handout we can (each one's signature checked against the
 * signer's pinned key), then accepts the current key and meta only if an
 * admin we trust vouches for them:
 * - with a meta already verified on this phone: the new meta's revision must
 *   not go back, and its writer and the current key's giver must be admins
 *   of the meta we trusted (or, after an admin handover we missed, members
 *   of it whom the new meta makes admin);
 * - first time on this phone: the meta must carry the keywords we know (the
 *   server never sees them) and be written by one of its own admins, who
 *   also handed us the key.
 * Throws GroupTamperedError otherwise; a missing current key: ApiError 409.
 */
async function verifyGroup(
  s: Session,
  profiles: ProfileCache,
  g: GroupSummary,
  secret: StoredGroupSecret,
  known: GroupKeys,
): Promise<{ keys: GroupKeys; meta: GroupMeta; adminChanged: boolean }> {
  const me = s.account.userId;
  const keys: GroupKeys = new Map(known);
  const givers = new Map<number, string>();
  const signers = await profiles.trustedKeys([...g.sealedKeys.map((h) => h.signerId), g.metaSignerId]);
  for (const h of g.sealedKeys) {
    givers.set(h.keyVersion, h.signerId);
    if (keys.has(h.keyVersion)) continue;
    const signer = signers.get(h.signerId);
    if (!signer) continue;
    try {
      keys.set(h.keyVersion, openHandout(h, signer.signPublicKey, secret.wrapKey, g.id, h.keyVersion, { ...s.identity, userId: me }));
    } catch {
      // Forged, swapped, or wrapped under a code we do not have: that version stays unreadable.
    }
  }
  const v = g.currentKeyVersion;
  const current = keys.get(v);
  const metaSigner = signers.get(g.metaSignerId);
  if (!current || !metaSigner) throw new ApiError(409, 'stale_key_version');
  const meta = decryptGroupMeta(g, metaSigner.signPublicKey, g.id, v, current);
  const giver = givers.get(v);

  const trusted = await s.vault.metaRecord(g.id, s.masterKey);
  let adminChanged = false;
  if (trusted) {
    if (meta.rev < trusted.meta.rev || v < trusted.keyVersion) throw new GroupTamperedError('rollback');
    const vouched = (id: string | undefined) =>
      !!id && (trusted.meta.admins.includes(id) || (trusted.meta.members.includes(id) && meta.admins.includes(id)));
    if (!vouched(g.metaSignerId)) throw new GroupTamperedError('untrusted_signer');
    // A key we already held (locally, or from an earlier version check) needs no new voucher.
    if (!known.has(v) && v !== trusted.keyVersion && !vouched(giver)) throw new GroupTamperedError('untrusted_signer');
    adminChanged = meta.admins.some((a) => !trusted.meta.admins.includes(a));
  } else {
    if (!sameKeywords(meta.keywords, secret.keywords)) throw new GroupTamperedError('keywords_mismatch');
    if (!meta.admins.includes(g.metaSignerId) || !giver || !meta.admins.includes(giver)) throw new GroupTamperedError('untrusted_signer');
  }
  if (!meta.members.includes(me)) throw new GroupTamperedError('not_a_member');
  await s.vault.saveMeta(g.id, meta, v, s.masterKey);
  return { keys, meta, adminChanged };
}

// ---- Unlocking ----------------------------------------------------------------------

export interface OpenedGroup {
  groupKey: Uint8Array;
  keys: GroupKeys;
  keyVersion: number;
  meta: GroupMeta;
  /** The admin changed the code since this phone stored it: ask for the new one (relockGroup). */
  codeChanged: boolean;
  /** Someone became admin since the meta this phone last verified (shown to the user). */
  adminChanged: boolean;
}

/**
 * Unlocks a group with its code (+ keywords the first time on a phone that
 * does not know them). Returns null if no key was handed to us yet. Wrong
 * codes throw WrongCodeError / LockedOutError and count toward the lockout.
 */
export async function unlockGroup(
  s: Session,
  profiles: ProfileCache,
  groupId: string,
  groupCode: string,
  keywords?: string[],
): Promise<OpenedGroup | null> {
  // Without network: the summary saved at the last list (same checks follow).
  const g = (await fetchGroups(s)).groups.find((x): x is GroupSummary => x.id === groupId && isActive(x));
  if (!g) throw new ApiError(404, 'not_found');
  const v = g.currentKeyVersion;
  const local = await s.vault.latestGroupKeyVersion(groupId, v);
  const known: GroupKeys = new Map();
  let secret = await s.vault.groupSecret(groupId, s.masterKey);

  // Re-locked under the code typed now: it is the admin's new code.
  let tookNewCode = false;
  if (local !== null && secret && staleCode(secret, g) && g.sealedKeys.some((h) => h.keyVersion === v)) {
    // The admin changed the code (maybe more than once) since this phone locked its key: the old code
    // still opens that key, the new one our handout (re-wrapped under it, with the keywords as they are
    // now: the ones typed, else the ones we know). Either works; one attempt is counted.
    const stored = secret;
    const opened = await s.vault.checkGroupCode(groupId, async () => {
      try {
        return { key: await s.vault.tryGroupKey(groupId, local, groupCode, s.masterKey) };
      } catch (e) {
        if (!(e instanceof CryptoError)) throw e;
        return { secret: await firstUnlockSecret(s, profiles, g, groupCode, null, keywords ?? stored.keywords) };
      }
    });
    if (opened.key) known.set(local, opened.key);
    else {
      secret = opened.secret!;
      tookNewCode = true;
    }
  } else if (local !== null) {
    // The newest key locked on this phone checks the code (throws if wrong).
    known.set(local, await s.vault.openGroupKey(groupId, local, groupCode, s.masterKey));
  } else {
    if (!g.sealedKeys.some((h) => h.keyVersion === v)) return null;
    secret = await s.vault.checkGroupCode(groupId, () => firstUnlockSecret(s, profiles, g, groupCode, secret, keywords));
  }
  if (!secret) throw new ApiError(409, 'no_group_secret');

  const codeChanged = secret.codeVersion !== 0 && secret.codeVersion < g.codeVersion;
  let opened: { keys: GroupKeys; meta: GroupMeta; adminChanged: boolean };
  try {
    opened = await verifyGroup(s, profiles, g, secret, known);
  } catch (e) {
    // The code changed and a newer key is wrapped under it: the local key still opens what we had.
    if (!(codeChanged && e instanceof ApiError && e.status === 409 && local !== null)) throw e;
    const meta = (await s.vault.meta(groupId, s.masterKey))!;
    return { groupKey: known.get(local)!, keys: known, keyVersion: local, meta, codeChanged, adminChanged: false };
  }
  const groupKey = opened.keys.get(v)!;
  if (local !== v || tookNewCode) {
    // First unlock, a rotation, or the new code: lock the current key under this code.
    await s.vault.saveGroupKey(groupId, v, groupKey, groupCode, s.masterKey);
    if (local !== null && local !== v) await s.vault.deleteGroupKey(groupId, local);
  }
  if (secret.codeVersion === 0 || local === null || tookNewCode) {
    await s.vault.saveGroupSecret(groupId, { ...secret, codeVersion: g.codeVersion }, s.masterKey);
    await s.vault.setCodeVersion(groupId, g.codeVersion);
  }
  return { groupKey, keys: opened.keys, keyVersion: v, meta: opened.meta, codeChanged, adminChanged: opened.adminChanged };
}

/**
 * First unlock: the code (and keywords, if this phone does not have them)
 * must re-derive a wrapKey that opens our handout of the current key. Throws
 * CryptoError on a wrong code, which the caller counts as a failed attempt.
 */
async function firstUnlockSecret(
  s: Session,
  profiles: ProfileCache,
  g: GroupSummary,
  groupCode: string,
  stored: StoredGroupSecret | null,
  keywords: string[] | undefined,
): Promise<StoredGroupSecret> {
  // Keywords typed now win: the stored ones may predate a change by the admin.
  const words = keywords ?? stored?.keywords;
  if (!words) throw new ApiError(400, 'keywords_required');
  const derived = await deriveGroupSecrets(groupCode, words).catch(() => {
    throw new CryptoError('DECRYPT_FAILED');
  });
  wipe(derived.joinKey);
  // Whatever it is (even the code we joined with: the admin may have changed it since), it must open our handout.
  const h = g.sealedKeys.find((x) => x.keyVersion === g.currentKeyVersion)!;
  const signer = (await profiles.trustedKeys([h.signerId])).get(h.signerId);
  if (!signer) throw new KeyChangedError(h.signerId);
  try {
    wipe(openHandout(h, signer.signPublicKey, derived.wrapKey, g.id, h.keyVersion, { ...s.identity, userId: s.account.userId }));
  } catch (e) {
    if (e instanceof CryptoError && e.code === 'BAD_SIGNATURE') throw new GroupTamperedError('untrusted_signer');
    throw new CryptoError('DECRYPT_FAILED');
  }
  if (stored && constantTimeEqual(derived.wrapKey, stored.wrapKey)) return { ...stored, codeVersion: g.codeVersion };
  return { wrapKey: derived.wrapKey, keywords: words, codeVersion: g.codeVersion };
}

/**
 * After the admin changed the code: the new code (with the keywords from the
 * verified meta) re-derives the group secret, which must open our current
 * handout; the local key is then re-locked under it.
 */
export async function relockGroup(s: Session, profiles: ProfileCache, groupId: string, keys: GroupKeys, newCode: string, keywords?: string[]) {
  const g = await summary(s, groupId);
  const meta = await s.vault.meta(groupId, s.masterKey);
  if (!meta) throw new ApiError(409, 'no_meta');
  // The verified meta may predate the new keywords (a key rotated under the new code could not be read): typed ones win.
  const secret = await s.vault.checkGroupCode(groupId, () => firstUnlockSecret(s, profiles, g, newCode, null, keywords ?? meta.keywords));
  await s.vault.saveGroupSecret(groupId, secret, s.masterKey);
  const opened = await verifyGroup(s, profiles, g, secret, keys);
  const v = g.currentKeyVersion;
  await s.vault.saveGroupKey(groupId, v, opened.keys.get(v)!, newCode, s.masterKey);
  for (let x = v - 1; x >= 1; x--) if (await s.vault.hasGroupKey(groupId, x)) await s.vault.deleteGroupKey(groupId, x);
  await s.vault.setCodeVersion(groupId, g.codeVersion);
  return { ...opened, keyVersion: v };
}

// ---- Keeping an open group up to date ------------------------------------------------

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
): Promise<{ summary: GroupSummary; keys: GroupKeys; keyVersion: number; meta: GroupMeta; adminChanged: boolean }> {
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
  if (g.rotationPending && g.role === 'admin' && opened.meta.admins.includes(s.account.userId) && !staleCode(secret, g)) {
    try {
      await rotateKey(s, profiles, g, opened.meta, secret);
    } catch (e) {
      // Another admin rotated first, or membership changed meanwhile: take theirs, retry later.
      if (!(e instanceof ApiError && e.status === 409)) throw e;
    }
    g = await summary(s, groupId);
    opened = await verifyGroup(s, profiles, g, secret, opened.keys);
  }
  return { summary: g, keys: opened.keys, keyVersion: g.currentKeyVersion, meta: opened.meta, adminChanged: opened.adminChanged };
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
    return { userId, ...sealHandout(groupKey, secret.wrapKey, g.id, v, { userId, boxPublicKey: p.boxPublicKey }, s.identity) };
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

// ---- Join requests (admin) ---------------------------------------------------------

export interface JoinRequestInfo {
  userId: string;
  username: string;
  avatar: string | null;
  requestedAt: string;
  /** Their key fingerprint as this phone received it: compare in person with the one on their phone (Réglages). */
  fingerprint: string;
  /** Their keys changed since this phone pinned them: do not approve. */
  keyChanged: boolean;
}

export async function joinRequests(s: Session, profiles: ProfileCache, groupId: string): Promise<JoinRequestInfo[]> {
  const { pending } = await s.api.members(groupId);
  if (!pending.length) return [];
  const known = await profiles.get(pending.map((p) => p.userId));
  return pending.flatMap((r) => {
    const p = known.get(r.userId);
    if (!p) return [];
    return [
      {
        userId: r.userId,
        username: p.username,
        avatar: p.avatar ?? null,
        requestedAt: r.requestedAt,
        fingerprint: keyFingerprint(parsePublicIdentity(p)),
        keyChanged: p.keyChanged,
      },
    ];
  });
}

/** Admin: lets a newcomer in, handing over the current key and listing them in the meta. */
export async function approveMember(s: Session, profiles: ProfileCache, groupId: string, keys: GroupKeys, userId: string) {
  const g = await summary(s, groupId);
  const secret = await s.vault.groupSecret(groupId, s.masterKey);
  if (!secret) throw new ApiError(409, 'no_group_secret');
  // The newcomer's key is wrapped under our code: it must be the current one, the one they will type.
  if (staleCode(secret, g)) throw new CodeChangedError();
  const { keys: all, meta } = await verifyGroup(s, profiles, g, secret, keys);
  const v = g.currentKeyVersion;
  const pinned = (await profiles.trustedKeys([userId])).get(userId);
  if (!pinned) throw new KeyChangedError(userId);
  const next: GroupMeta = { ...meta, members: [...meta.members.filter((m) => m !== userId), userId], rev: meta.rev + 1 };
  const handout = sealHandout(all.get(v)!, secret.wrapKey, groupId, v, { userId, boxPublicKey: pinned.boxPublicKey }, s.identity);
  await s.api.approveMember(groupId, userId, {
    keyVersion: v,
    sealedKey: handout.sealedKey,
    keySignature: handout.signature,
    ...encryptGroupMeta(next, groupId, v, all.get(v)!, s.identity),
  });
  await s.vault.saveMeta(groupId, next, v, s.masterKey);
}

export async function rejectMember(s: Session, groupId: string, userId: string) {
  await s.api.rejectMember(groupId, userId);
}

// ---- Admin settings -----------------------------------------------------------------

/** Admin: names the admins (e.g. hands the role over before leaving). */
export async function setAdmins(s: Session, profiles: ProfileCache, groupId: string, keys: GroupKeys, admins: string[]) {
  const g = await summary(s, groupId);
  const secret = await s.vault.groupSecret(groupId, s.masterKey);
  if (!secret) throw new ApiError(409, 'no_group_secret');
  const { keys: all, meta } = await verifyGroup(s, profiles, g, secret, keys);
  if (!admins.length || admins.some((a) => !meta.members.includes(a))) throw new ApiError(400, 'invalid_admins');
  const v = g.currentKeyVersion;
  const next: GroupMeta = { ...meta, admins, rev: meta.rev + 1 };
  await s.api.setAdmins(groupId, { keyVersion: v, admins, ...encryptGroupMeta(next, groupId, v, all.get(v)!, s.identity) });
  await s.vault.saveMeta(groupId, next, v, s.masterKey);
}

/**
 * Admin: new code + keywords. The server gets the new joinKey and every
 * handout re-wrapped under the new code (the versions this phone can open;
 * any other is dropped rather than left openable with the old code). This
 * phone re-locks the current key under the new code.
 */
export async function changeGroupCode(s: Session, profiles: ProfileCache, groupId: string, keys: GroupKeys, groupCode: string, keywords: string[]) {
  const g = await summary(s, groupId);
  const secret = await s.vault.groupSecret(groupId, s.masterKey);
  if (!secret) throw new ApiError(409, 'no_group_secret');
  const { keys: all, meta } = await verifyGroup(s, profiles, g, secret, keys);
  const v = g.currentKeyVersion;
  const { joinKey, wrapKey } = await deriveGroupSecrets(groupCode, keywords);
  const { members } = await s.api.members(groupId);
  if (members.some((m) => !meta.members.includes(m.userId))) throw new GroupTamperedError('unknown_member');
  const pinned = await profiles.trustedKeys(members.map((m) => m.userId));
  const handouts = members.flatMap((m) =>
    m.keyVersions.flatMap((kv) => {
      const key = all.get(kv);
      const p = pinned.get(m.userId);
      if (!key || !p) return [];
      return [{ userId: m.userId, keyVersion: kv, ...sealHandout(key, wrapKey, groupId, kv, { userId: m.userId, boxPublicKey: p.boxPublicKey }, s.identity) }];
    }),
  );
  const next: GroupMeta = { ...meta, keywords, rev: meta.rev + 1 };
  const { codeVersion } = await s.api.changeGroupCode(groupId, {
    joinKey: b64.encode(joinKey),
    keyVersion: v,
    ...encryptGroupMeta(next, groupId, v, all.get(v)!, s.identity),
    keys: handouts,
  });
  wipe(joinKey);
  await s.vault.saveGroupSecret(groupId, { wrapKey, keywords, codeVersion }, s.masterKey);
  await s.vault.saveGroupKey(groupId, v, all.get(v)!, groupCode, s.masterKey);
  for (let x = v - 1; x >= 1; x--) if (await s.vault.hasGroupKey(groupId, x)) await s.vault.deleteGroupKey(groupId, x);
  await s.vault.saveMeta(groupId, next, v, s.masterKey);
  await s.vault.setCodeVersion(groupId, codeVersion);
}

// ---- Contacts ------------------------------------------------------------------------

export interface KnownProfile extends Profile {
  /** The server now returns other keys than the ones pinned on this phone: they are not used. */
  keyChanged: boolean;
}

/**
 * Public profiles of group members, cached for the session. Each contact's
 * keys are pinned in the vault the first time this phone sees them; after
 * that the pinned keys are the only ones used (the server's copy is only
 * compared, and a difference is flagged).
 */
export class ProfileCache {
  private readonly byId = new Map<string, KnownProfile>();
  constructor(
    private readonly api: Api,
    private readonly vault: Vault,
    private readonly masterKey: Uint8Array,
    /** Where profiles are saved for offline use (names, avatars; keys still come from the pins). */
    private readonly local: LocalStore | null = null,
  ) {}

  async get(ids: string[]): Promise<Map<string, KnownProfile>> {
    const missing = [...new Set(ids)].filter((id) => !this.byId.has(id));
    if (missing.length) {
      for (const p of await this.fetch(missing)) {
        const pinned = await this.vault.pinned(p.id, this.masterKey);
        if (!pinned) {
          await this.vault.pin(p.id, { signPublicKey: p.publicKeySign, boxPublicKey: p.publicKeyBox }, this.masterKey);
          this.byId.set(p.id, { ...p, keyChanged: false });
        } else {
          const changed = pinned.signPublicKey !== p.publicKeySign || pinned.boxPublicKey !== p.publicKeyBox;
          this.byId.set(p.id, { ...p, publicKeySign: pinned.signPublicKey, publicKeyBox: pinned.boxPublicKey, keyChanged: changed });
        }
      }
    }
    return this.byId;
  }

  /** From the server (saved on the phone); offline, the profiles saved earlier. */
  private async fetch(ids: string[]): Promise<Profile[]> {
    try {
      const fetched = await this.api.profiles(ids);
      if (this.local && fetched.length) {
        const saved = (await this.local.getRecord<Record<string, Profile>>(records.profiles).catch(() => null)) ?? {};
        for (const p of fetched) saved[p.id] = p;
        await this.local.setRecord(records.profiles, saved).catch(() => {});
      }
      return fetched;
    } catch (e) {
      if (!(e instanceof NetworkError) || !this.local) throw e;
      const saved = (await this.local.getRecord<Record<string, Profile>>(records.profiles)) ?? {};
      return ids.flatMap((id) => (saved[id] ? [saved[id]] : []));
    }
  }

  /** Pinned keys of these users; a user whose keys changed is left out (never trusted). */
  async trustedKeys(ids: string[]): Promise<Map<string, { signPublicKey: Uint8Array; boxPublicKey: Uint8Array }>> {
    const known = await this.get(ids);
    const out = new Map<string, { signPublicKey: Uint8Array; boxPublicKey: Uint8Array }>();
    for (const id of ids) {
      const p = known.get(id);
      if (p && !p.keyChanged) out.set(id, parsePublicIdentity(p));
    }
    return out;
  }

  /** After changing our own avatar: shown right away in groups and chats. */
  setAvatar(id: string, avatar: string | null) {
    const p = this.byId.get(id);
    if (p) this.byId.set(id, { ...p, avatar });
  }
}

/** A contact's key fingerprint, from the keys pinned on this phone (compare with the one on their phone). */
export async function fingerprintOf(profiles: ProfileCache, userId: string): Promise<{ fingerprint: string; keyChanged: boolean } | null> {
  const p = (await profiles.get([userId])).get(userId);
  if (!p) return null;
  return { fingerprint: keyFingerprint(parsePublicIdentity(p)), keyChanged: p.keyChanged };
}

// ---- Messages ----------------------------------------------------------------------

export interface ChatMessage {
  id: string;
  seq: number;
  clientId: string;
  senderId: string;
  senderName: string;
  senderAvatar: string | null;
  // All null: could not be verified/decrypted (or a malformed attachment body).
  text: string | null;
  image: ImageBody | null;
  voice: VoiceBody | null;
  /** A document (a PDF…): its name is inside the encrypted body. */
  file: FileBody | null;
  /** A story: shown in the story strip, not in the chat. */
  story: StoryBody | null;
  /** A reaction to another message: counted under it, never shown as a message. */
  reaction: ReactionBody | null;
  /** The message this one answers (quoted inside the encrypted body). */
  replyTo: ReplyRef | null;
  createdAt: string;
  /** Disappearing message or story: gone for everyone at this time. */
  expiresAt: string | null;
  mine: boolean;
}

export async function decryptMessages(s: Session, profiles: ProfileCache, keys: GroupKeys, wire: WireMessage[]): Promise<ChatMessage[]> {
  const known = await profiles.get(wire.map((m) => m.senderId));
  return wire.map((m) => {
    const p = known.get(m.senderId);
    const groupKey = keys.get(m.keyVersion);
    let text: string | null = null;
    let image: ImageBody | null = null;
    let voice: VoiceBody | null = null;
    let file: FileBody | null = null;
    let story: StoryBody | null = null;
    let reaction: ReactionBody | null = null;
    let replyTo: ReplyRef | null = null;
    if (p && groupKey) {
      try {
        const body = parseMessageBody(
          decryptMessage(
            { nonce: m.nonce, ciphertext: m.ciphertext, signature: m.signature },
            { groupId: m.groupId, senderId: m.senderId, clientId: m.clientId, keyVersion: m.keyVersion },
            groupKey,
            b64.decode(p.publicKeySign),
          ),
        );
        if (body?.kind === 'text') text = body.text;
        if (body?.kind === 'image') image = body;
        if (body?.kind === 'voice') voice = body;
        if (body?.kind === 'file') file = body;
        if (body?.kind === 'story') story = body;
        if (body?.kind === 'reaction') reaction = body;
        replyTo = (body?.kind === 'story' || body?.kind === 'reaction' ? null : body?.replyTo) ?? null;
      } catch {
        // tampered, forged or other key version: shown as unreadable
      }
    }
    return {
      id: m.id,
      seq: m.seq,
      clientId: m.clientId,
      senderId: m.senderId,
      senderName: p?.username ?? '?',
      senderAvatar: p?.avatar ?? null,
      text,
      image,
      voice,
      file,
      story,
      reaction,
      replyTo,
      createdAt: m.createdAt,
      expiresAt: m.expiresAt ?? null,
      mine: m.senderId === s.account.userId,
    };
  });
}

/**
 * All messages after `after`, following pagination, and the group's latest
 * erase (`purgeSeq`): when it moved, messages already shown may be gone.
 */
export async function fetchSince(s: Session, groupId: string, after: number): Promise<{ messages: WireMessage[]; purgeSeq: number }> {
  const out: WireMessage[] = [];
  let cursor = after;
  for (;;) {
    const page = await s.api.messages(groupId, cursor, 200);
    out.push(...page.messages);
    if (!page.hasMore || page.messages.length === 0) return { messages: out, purgeSeq: page.purgeSeq ?? 0 };
    cursor = page.messages[page.messages.length - 1]!.seq;
  }
}

export function newClientId(): string {
  return randomUUID();
}

export async function sendText(
  s: Session,
  groupId: string,
  groupKey: Uint8Array,
  keyVersion: number,
  text: string,
  clientId: string,
  replyTo?: ReplyRef,
): Promise<WireMessage> {
  const body = encodeMessageBody({ kind: 'text', text, ...(replyTo && { replyTo }) });
  const encrypted = encryptMessage(body, { groupId, senderId: s.account.userId, clientId, keyVersion }, groupKey, s.identity);
  return s.api.sendMessage(groupId, { clientId, keyVersion, ...encrypted });
}

// ---- Images and voice messages (SPEC §4.3) ------------------------------------------

/** An image ready to send: re-encoded JPEG (no metadata) and a tiny preview. */
export interface PreparedImage {
  jpeg: Uint8Array;
  width: number;
  height: number;
  preview?: string; // base64url JPEG, a few hundred bytes
}

/** A document picked on the phone, sent as it is. */
export interface PreparedFile {
  bytes: Uint8Array;
  name: string;
  mime: string;
}

/** A recorded voice message ready to send: AAC audio in an MP4 container. */
export interface PreparedVoice {
  audio: Uint8Array;
  durationMs: number;
  waveform?: number[];
}

export class AttachmentTooLargeError extends Error {
  constructor() {
    super('attachment_too_large');
    this.name = 'AttachmentTooLargeError';
  }
}

/** Encrypts a file under a fresh file key and uploads the blob. */
async function uploadFile(s: Session, groupId: string, plaintext: Uint8Array) {
  const size = plaintext.length + 24 + 16; // nonce + Poly1305 tag
  if (size > MAX_ATTACHMENT_BYTES) throw new AttachmentTooLargeError();
  const { id, uploadUrl } = await s.api.createAttachment(groupId, size);
  const { blob, fileKey } = encryptAttachment(plaintext, { groupId, attachmentId: id });
  await s.api.uploadBlob(uploadUrl, blob);
  await s.local.saveBlob(groupId, id, blob).catch(() => {}); // our own file, readable offline
  return { attachmentId: id, fileKey: b64.encode(fileKey), size: blob.length };
}

/**
 * Encrypts the image and uploads it. Returns the message body to send; keep
 * it to retry the send without uploading again.
 */
export async function uploadImage(s: Session, groupId: string, image: PreparedImage): Promise<ImageBody> {
  return {
    kind: 'image',
    ...(await uploadFile(s, groupId, image.jpeg)),
    mime: 'image/jpeg',
    width: image.width,
    height: image.height,
    ...(image.preview && { preview: image.preview }),
  };
}

/** Same for a story: the photo is encrypted and uploaded like an image. */
export async function uploadStory(s: Session, groupId: string, image: PreparedImage): Promise<StoryBody> {
  return {
    kind: 'story',
    ...(await uploadFile(s, groupId, image.jpeg)),
    mime: 'image/jpeg',
    width: image.width,
    height: image.height,
    ...(image.preview && { preview: image.preview }),
  };
}

/** Same for a document: sent as it is, its name and type inside the encrypted message. */
export async function uploadDocument(s: Session, groupId: string, file: PreparedFile): Promise<FileBody> {
  return { kind: 'file', ...(await uploadFile(s, groupId, file.bytes)), mime: file.mime, name: file.name };
}

/** Same for a voice message. */
export async function uploadVoice(s: Session, groupId: string, voice: PreparedVoice): Promise<VoiceBody> {
  return {
    kind: 'voice',
    ...(await uploadFile(s, groupId, voice.audio)),
    mime: 'audio/mp4',
    durationMs: voice.durationMs,
    ...(voice.waveform && { waveform: voice.waveform }),
  };
}

/** A reaction to a message: a quiet message (the server rings nobody for it), never shown as one. */
export async function sendReaction(
  s: Session,
  groupId: string,
  groupKey: Uint8Array,
  keyVersion: number,
  body: ReactionBody,
  clientId: string,
): Promise<WireMessage> {
  const encrypted = encryptMessage(encodeMessageBody(body), { groupId, senderId: s.account.userId, clientId, keyVersion }, groupKey, s.identity);
  return s.api.sendMessage(groupId, { clientId, keyVersion, ...encrypted, quiet: true });
}

/**
 * Sends the message carrying the file key of an uploaded image, voice
 * message or story. A story also tells the server when to delete it (the
 * server only learns that the message lives 24 h, not what it is).
 */
export async function sendAttachment(
  s: Session,
  groupId: string,
  groupKey: Uint8Array,
  keyVersion: number,
  body: ImageBody | VoiceBody | StoryBody | FileBody,
  clientId: string,
): Promise<WireMessage> {
  const encrypted = encryptMessage(encodeMessageBody(body), { groupId, senderId: s.account.userId, clientId, keyVersion }, groupKey, s.identity);
  return s.api.sendMessage(groupId, {
    clientId,
    keyVersion,
    ...encrypted,
    attachmentId: body.attachmentId,
    ...(body.kind === 'story' && { expiresInSeconds: STORY_TTL_SECONDS }),
  });
}

/**
 * Decrypts an image or a voice message: the blob kept on the phone if any,
 * else downloaded (and kept for offline use). Throws CryptoError if the blob
 * was tampered with or swapped.
 */
export async function loadAttachment(s: Session, groupId: string, body: ImageBody | VoiceBody | StoryBody | FileBody): Promise<Uint8Array> {
  const ctx = { groupId, attachmentId: body.attachmentId };
  const fileKey = b64.decode(body.fileKey);
  const kept = await s.local.blob(body.attachmentId).catch(() => null);
  if (kept) {
    try {
      return decryptAttachment(kept, fileKey, ctx);
    } catch {
      await s.local.dropBlob(body.attachmentId).catch(() => {}); // damaged: fetch it again
    }
  }
  const { url } = await s.api.attachmentUrl(groupId, body.attachmentId);
  const blob = await s.api.downloadBlob(url);
  const plain = decryptAttachment(blob, fileKey, ctx);
  await s.local.saveBlob(groupId, body.attachmentId, blob).catch(() => {});
  return plain;
}
