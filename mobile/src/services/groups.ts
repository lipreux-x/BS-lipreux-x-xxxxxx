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
  type GroupMeta,
  type ImageBody,
  type ReplyRef,
  type VoiceBody,
} from '@/crypto';
import { constantTimeEqual, wipe } from '@/crypto/encoding';
import { ApiError, type Api, type GroupSummary, type PendingGroupSummary, type Profile, type WireMessage } from './api';
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
 */

/** Group keys by version (messages carry the version they were sent with). */
export type GroupKeys = Map<number, Uint8Array>;

export interface Session extends UnlockedVault {
  api: Api;
  vault: Vault;
}

export type GroupLockState =
  | { kind: 'pending' } // asked to join, waiting for an admin to approve
  | { kind: 'locked' } // local key present: type the group code
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
}

/** The server put someone in the group no admin let in, or a key it should not have. */
export class GroupTamperedError extends Error {
  constructor(public readonly reason: 'unknown_member' | 'untrusted_signer' | 'rollback' | 'not_a_member' | 'keywords_mismatch') {
    super(reason);
    this.name = 'GroupTamperedError';
  }
}

/** A contact's public keys differ from the ones pinned on this phone. */
export class KeyChangedError extends Error {
  constructor(public readonly userId: string) {
    super('key_changed');
    this.name = 'KeyChangedError';
  }
}

const isActive = (g: GroupSummary | PendingGroupSummary): g is GroupSummary => g.status === 'active';

/**
 * The groups we belong to (or asked to join). A group this phone kept
 * something for that the server no longer lists (self-destructed, removed,
 * request refused) is erased from the phone too: keys, name, counters.
 */
export async function listGroups(s: Session): Promise<GroupListItem[]> {
  const groups = await s.api.groups();
  const alive = new Set(groups.map((g) => g.id));
  for (const [id, upTo] of Object.entries(await s.vault.knownGroups())) {
    if (!alive.has(id)) await s.vault.forgetGroup(id, upTo);
  }
  return Promise.all(
    groups.map(async (g) =>
      isActive(g)
        ? {
            id: g.id,
            name: (await s.vault.meta(g.id, s.masterKey))?.name ?? null,
            keyVersion: g.currentKeyVersion,
            role: g.role,
            state: await lockState(s, g),
            expiresAt: g.expiresAt ?? null,
          }
        : { id: g.id, name: null, keyVersion: 0, role: 'member' as const, state: { kind: 'pending' as const }, expiresAt: g.expiresAt ?? null },
    ),
  );
}

async function lockState(s: Session, g: GroupSummary): Promise<GroupLockState> {
  // An older local key still proves the code after a rotation (see unlockGroup).
  if ((await s.vault.latestGroupKeyVersion(g.id, g.currentKeyVersion)) !== null) return { kind: 'locked' };
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
  const g = await summary(s, groupId);
  const v = g.currentKeyVersion;
  const local = await s.vault.latestGroupKeyVersion(groupId, v);
  const known: GroupKeys = new Map();
  let secret = await s.vault.groupSecret(groupId, s.masterKey);

  if (local !== null) {
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
  if (local !== v) {
    // First unlock, or a rotation: lock the current key under this code.
    await s.vault.saveGroupKey(groupId, v, groupKey, groupCode, s.masterKey);
    if (local !== null) await s.vault.deleteGroupKey(groupId, local);
  }
  if (secret.codeVersion === 0 || local === null) {
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
  const words = stored?.keywords ?? keywords;
  if (!words) throw new ApiError(400, 'keywords_required');
  const derived = await deriveGroupSecrets(groupCode, words).catch(() => {
    throw new CryptoError('DECRYPT_FAILED');
  });
  wipe(derived.joinKey);
  if (stored && constantTimeEqual(derived.wrapKey, stored.wrapKey)) return stored;
  // Not the code we joined with (or no stored secret): it must open our handout.
  const h = g.sealedKeys.find((x) => x.keyVersion === g.currentKeyVersion)!;
  const signer = (await profiles.trustedKeys([h.signerId])).get(h.signerId);
  if (!signer) throw new KeyChangedError(h.signerId);
  try {
    wipe(openHandout(h, signer.signPublicKey, derived.wrapKey, g.id, h.keyVersion, { ...s.identity, userId: s.account.userId }));
  } catch (e) {
    if (e instanceof CryptoError && e.code === 'BAD_SIGNATURE') throw new GroupTamperedError('untrusted_signer');
    throw new CryptoError('DECRYPT_FAILED');
  }
  return { wrapKey: derived.wrapKey, keywords: words, codeVersion: g.codeVersion };
}

/**
 * After the admin changed the code: the new code (with the keywords from the
 * verified meta) re-derives the group secret, which must open our current
 * handout; the local key is then re-locked under it.
 */
export async function relockGroup(s: Session, profiles: ProfileCache, groupId: string, keys: GroupKeys, newCode: string) {
  const g = await summary(s, groupId);
  const meta = await s.vault.meta(groupId, s.masterKey);
  if (!meta) throw new ApiError(409, 'no_meta');
  const secret = await s.vault.checkGroupCode(groupId, () => firstUnlockSecret(s, profiles, g, newCode, null, meta.keywords));
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
  let opened = await verifyGroup(s, profiles, g, secret, keys);
  if (g.rotationPending && g.role === 'admin' && opened.meta.admins.includes(s.account.userId)) {
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
  ) {}

  async get(ids: string[]): Promise<Map<string, KnownProfile>> {
    const missing = [...new Set(ids)].filter((id) => !this.byId.has(id));
    if (missing.length) {
      for (const p of await this.api.profiles(missing)) {
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
  /** The message this one answers (quoted inside the encrypted body). */
  replyTo: ReplyRef | null;
  createdAt: string;
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
        replyTo = body?.replyTo ?? null;
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
      replyTo,
      createdAt: m.createdAt,
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

/** Sends the message carrying the file key of an uploaded image or voice message. */
export async function sendAttachment(
  s: Session,
  groupId: string,
  groupKey: Uint8Array,
  keyVersion: number,
  body: ImageBody | VoiceBody,
  clientId: string,
): Promise<WireMessage> {
  const encrypted = encryptMessage(encodeMessageBody(body), { groupId, senderId: s.account.userId, clientId, keyVersion }, groupKey, s.identity);
  return s.api.sendMessage(groupId, { clientId, keyVersion, ...encrypted, attachmentId: body.attachmentId });
}

/** Downloads and decrypts an image or a voice message. Throws CryptoError if the blob was tampered with or swapped. */
export async function loadAttachment(s: Session, groupId: string, body: ImageBody | VoiceBody): Promise<Uint8Array> {
  const { url } = await s.api.attachmentUrl(groupId, body.attachmentId);
  const blob = await s.api.downloadBlob(url);
  return decryptAttachment(blob, b64.decode(body.fileKey), { groupId, attachmentId: body.attachmentId });
}
