import { randomUUID } from 'expo-crypto';
import { b64, deriveGroupSecrets, directWrapKey, encryptGroupMeta, generateGroupKey, sealHandout, type GroupMeta } from '@/crypto';
import { wipe } from '@/crypto/encoding';
import { fetchGroups, isActive, KeyChangedError, noCodeSecret, peerOf, type Session } from './core';
import type { KnownProfile, ProfileCache } from './profiles';

/**
 * `groupCode` null: a group without a code (no keywords either), entered with
 * an admin's single-use link, opened on the phone by the app code alone.
 * `expiresAt`: self-destruct date (the group and everything in it is deleted for everyone), or null.
 */
export async function createGroup(
  s: Session,
  name: string,
  groupCode: string | null,
  keywords: string[],
  expiresAt: Date | null = null,
): Promise<{ id: string; groupKey: Uint8Array; meta: GroupMeta }> {
  const id = randomUUID();
  const me = s.account.userId;
  const groupKey = generateGroupKey();
  const { joinKey, wrapKey } = groupCode === null ? { joinKey: null, wrapKey: directWrapKey() } : await deriveGroupSecrets(groupCode, keywords);
  const meta: GroupMeta =
    groupCode === null ? { name, keywords: [], admins: [me], members: [me], rev: 1, link: true } : { name, keywords, admins: [me], members: [me], rev: 1 };
  const signed = encryptGroupMeta(meta, id, 1, groupKey, s.identity);
  const handout = sealHandout(groupKey, wrapKey, id, 1, { userId: me, boxPublicKey: s.identity.boxPublicKey }, s.identity, name);
  await s.api.createGroup({
    id,
    ...signed,
    ...(joinKey ? { joinKey: b64.encode(joinKey) } : { kind: 'link' as const }),
    sealedKey: handout.sealedKey,
    keySignature: handout.signature,
    sealedLabel: handout.sealedLabel,
    labelSignature: handout.labelSignature,
    ...(expiresAt && { expiresAt: expiresAt.toISOString() }),
  });
  if (joinKey) wipe(joinKey);
  await s.vault.saveGroupSecret(id, { wrapKey, keywords: meta.keywords, codeVersion: 1 }, s.masterKey);
  if (groupCode === null) await s.vault.saveGroupKeyNoCode(id, 1, groupKey, s.masterKey);
  else await s.vault.saveGroupKey(id, 1, groupKey, groupCode, s.masterKey);
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

/**
 * Asks to join a group without a code with the link (or the code under it)
 * an admin sent. Returns the group id; the request waits for an admin. The
 * link is burnt by this request: refused, the admin sends a new one.
 * ApiError 403 invalid_link: wrong, already used, expired or revoked.
 */
export async function joinWithLink(s: Session, code: string): Promise<string> {
  const { groupId } = await s.api.joinWithLink(code);
  // codeVersion 0: not known until approved, like a join by code.
  await s.vault.saveGroupSecret(groupId, noCodeSecret(0), s.masterKey);
  return groupId;
}

/** Admin of a group without a code: a new single-use link to send to one person (valid 24 h). */
export async function createGroupLink(s: Session, groupId: string): Promise<{ code: string; expiresAt: string }> {
  return s.api.createGroupLink(groupId);
}

/** Admin: the links sent and not used yet stop working. How many. */
export async function revokeGroupLinks(s: Session, groupId: string): Promise<number> {
  return (await s.api.revokeGroupLinks(groupId)).revoked;
}

// ---- Private conversations ----------------------------------------------------------

/** How a conversation is called: a group's name, or the other person's username for a private one. */
export async function conversationName(s: Session, profiles: ProfileCache, meta: GroupMeta): Promise<string> {
  const peer = peerOf(meta, s.account.userId);
  if (!peer) return meta.name;
  return (await profiles.get([peer]).catch(() => new Map<string, KnownProfile>())).get(peer)?.username ?? '';
}

/** Our private conversation with `peerId`, if there is one (from the server's list, or the one saved offline). */
export async function directWith(s: Session, peerId: string): Promise<string | null> {
  const { groups } = await fetchGroups(s);
  for (const g of groups) {
    if (!isActive(g) || g.kind !== 'direct') continue;
    const meta = await s.vault.meta(g.id, s.masterKey);
    if ((meta ? peerOf(meta, s.account.userId) : g.peerId) === peerId) return g.id;
  }
  return null;
}

/**
 * Opens a private conversation with someone met in a group: the key is drawn
 * here, sealed to both of us and signed; the meta lists the two of us as its
 * only members and admins. `code` locks it on this phone. Each handout carries
 * the other's username as its sealed label, so the plate names them before the
 * first unlock. ApiError 409 direct_exists: there is already one (directWith).
 */
export async function createDirect(
  s: Session,
  profiles: ProfileCache,
  peerId: string,
  code: string,
): Promise<{ id: string; groupKey: Uint8Array; meta: GroupMeta; name: string }> {
  const me = s.account.userId;
  const peer = (await profiles.get([peerId])).get(peerId);
  const pinned = (await profiles.trustedKeys([peerId])).get(peerId);
  if (!peer || !pinned) throw new KeyChangedError(peerId);
  const id = randomUUID();
  const groupKey = generateGroupKey();
  const wrapKey = directWrapKey();
  const meta: GroupMeta = { name: '', keywords: [], admins: [me, peerId], members: [me, peerId], rev: 1, direct: true };
  const mine = sealHandout(groupKey, wrapKey, id, 1, { userId: me, boxPublicKey: s.identity.boxPublicKey }, s.identity, peer.username);
  const theirs = sealHandout(groupKey, wrapKey, id, 1, { userId: peerId, boxPublicKey: pinned.boxPublicKey }, s.identity, s.account.username);
  await s.api.createDirect({
    id,
    peerId,
    ...encryptGroupMeta(meta, id, 1, groupKey, s.identity),
    keys: [
      { userId: me, ...mine },
      { userId: peerId, ...theirs },
    ],
  });
  await s.vault.saveGroupSecret(id, { wrapKey, keywords: [], codeVersion: 1 }, s.masterKey);
  await s.vault.saveGroupKey(id, 1, groupKey, code, s.masterKey);
  await s.vault.saveMeta(id, meta, 1, s.masterKey);
  await s.vault.setCodeVersion(id, 1);
  return { id, groupKey, meta, name: peer.username };
}
