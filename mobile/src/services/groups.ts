import { randomUUID } from 'expo-crypto';
import {
  b64,
  decryptAttachment,
  decryptGroupMeta,
  decryptMessage,
  encodeMessageBody,
  encryptAttachment,
  encryptGroupMeta,
  encryptMessage,
  generateGroupKey,
  MAX_ATTACHMENT_BYTES,
  openGroupKey as openSealedGroupKey,
  parseMessageBody,
  parsePublicIdentity,
  sealGroupKeyFor,
  type GroupMeta,
  type ImageBody,
} from '@/crypto';
import { ApiError, type Api, type GroupSummary, type Profile, type WireMessage } from './api';
import type { UnlockedVault, Vault } from './vault';

/*
 * Group flows on top of the API, the crypto module and the vault.
 *
 * Key flow (SPEC §4.3–4.4):
 * - create: the phone draws the group key, encrypts the name and the 3 join
 *   keywords with it, seals it for itself (server copy) and locks it locally
 *   with group code + master key. The server gets code and keywords to hash.
 * - join: the code finds the group; the server checks code + keywords
 *   (rate-limited) and adds a membership; the key arrives later, sealed to us by a member who has it (shareMissingKeys).
 * - first unlock after the key arrived: we open the sealed copy with our
 *   identity, then lock it locally with the code the user just typed.
 * - rotation (a member left or was removed): a remaining member's phone draws
 *   a new key, seals it to each member who stays and re-encrypts the meta
 *   with it. Older versions stay readable: the server keeps every version
 *   sealed to us, opened with our identity once the code was checked on the
 *   newest key locked on this phone (one Argon2id per unlock).
 */

/** Group keys by version (messages carry the version they were sent with). */
export type GroupKeys = Map<number, Uint8Array>;

export interface Session extends UnlockedVault {
  api: Api;
  vault: Vault;
}

export type GroupLockState =
  | { kind: 'locked' } // local key present: type the group code
  | { kind: 'first-unlock' } // sealed key received, not stored locally yet: choose/confirm the code
  | { kind: 'waiting-key' }; // joined, no member has shared the key yet

export interface GroupListItem {
  id: string;
  name: string | null; // null until the group was unlocked once on this phone
  keyVersion: number;
  role: 'admin' | 'member';
  state: GroupLockState;
}

export async function listGroups(s: Session): Promise<GroupListItem[]> {
  const groups = await s.api.groups();
  return Promise.all(
    groups.map(async (g) => ({
      id: g.id,
      name: (await s.vault.meta(g.id, s.masterKey))?.name ?? null,
      keyVersion: g.currentKeyVersion,
      role: g.role,
      state: await lockState(s, g),
    })),
  );
}

async function lockState(s: Session, g: GroupSummary): Promise<GroupLockState> {
  // An older local key still proves the code after a rotation (see unlockGroup).
  if ((await s.vault.latestGroupKeyVersion(g.id, g.currentKeyVersion)) !== null) return { kind: 'locked' };
  if (g.sealedKeys.some((k) => k.keyVersion === g.currentKeyVersion)) return { kind: 'first-unlock' };
  return { kind: 'waiting-key' };
}

export async function createGroup(s: Session, name: string, groupCode: string, keywords: string[]): Promise<{ id: string; groupKey: Uint8Array }> {
  const id = randomUUID();
  const groupKey = generateGroupKey();
  const meta: GroupMeta = { name, keywords };
  await s.api.createGroup({
    id,
    encryptedMeta: encryptGroupMeta(meta, id, 1, groupKey),
    groupCode,
    keywords,
    sealedKey: sealGroupKeyFor(groupKey, s.identity.boxPublicKey),
  });
  await s.vault.saveGroupKey(id, 1, groupKey, groupCode, s.masterKey);
  await s.vault.saveMeta(id, meta, s.masterKey);
  return { id, groupKey };
}

/** Returns the id of the group the code belongs to. */
export async function joinGroup(s: Session, groupCode: string, keywords: string[]): Promise<string> {
  return (await s.api.joinGroup(groupCode, keywords)).groupId;
}

/**
 * Unlocks a group with its code. Returns the group key, or null if the key
 * has not been shared with us yet. Wrong codes throw from the vault
 * (WrongCodeError / LockedOutError) and count toward the lockout.
 */
export async function unlockGroup(
  s: Session,
  groupId: string,
  groupCode: string,
): Promise<{ groupKey: Uint8Array; keys: GroupKeys; keyVersion: number; meta: GroupMeta; codeChanged: boolean } | null> {
  const g = (await s.api.groups()).find((x) => x.id === groupId);
  if (!g) throw new ApiError(404, 'not_found');
  const v = g.currentKeyVersion;

  // The newest key locked on this phone checks the code (throws if wrong).
  const local = await s.vault.latestGroupKeyVersion(groupId, v);
  const keys: GroupKeys = new Map();
  if (local !== null) keys.set(local, await s.vault.openGroupKey(groupId, local, groupCode, s.masterKey));
  openSealedKeys(s, g, keys);
  const groupKey = keys.get(v);
  if (!groupKey) return null;

  // First unlock, or the key was rotated: lock the current one under this code.
  if (local !== v) {
    await s.vault.saveGroupKey(groupId, v, groupKey, groupCode, s.masterKey);
    if (local !== null) await s.vault.deleteGroupKey(groupId, local);
  }
  const meta = decryptGroupMeta(g.encryptedMeta, groupId, v, groupKey);
  await s.vault.saveMeta(groupId, meta, s.masterKey);
  // First unlock: the code just typed is the current one. Otherwise the admin
  // may have changed it since this phone locked the key: ask for the new one.
  if (local === null) await s.vault.setCodeVersion(groupId, g.codeVersion);
  const codeChanged = local !== null && (await s.vault.codeVersion(groupId)) < g.codeVersion;
  return { groupKey, keys, keyVersion: v, meta, codeChanged };
}

/** Re-locks the current key on this phone under the new group code (after the admin changed it). */
export async function relockGroup(s: Session, groupId: string, keyVersion: number, groupKey: Uint8Array, newCode: string) {
  const g = await summary(s, groupId);
  await s.vault.saveGroupKey(groupId, keyVersion, groupKey, newCode, s.masterKey);
  await s.vault.setCodeVersion(groupId, g.codeVersion);
}

/**
 * Admin: new code + keywords. The server re-hashes them for future joins;
 * the meta is re-encrypted with the new keywords; this phone re-locks the
 * current key under the new code (older versions stay sealed on the server).
 */
export async function changeGroupCode(s: Session, groupId: string, keys: GroupKeys, keyVersion: number, groupCode: string, keywords: string[]) {
  const groupKey = keys.get(keyVersion);
  if (!groupKey) throw new ApiError(409, 'stale_key_version');
  const g = await summary(s, groupId);
  const meta: GroupMeta = { ...decryptGroupMeta(g.encryptedMeta, groupId, keyVersion, groupKey), keywords };
  const { codeVersion } = await s.api.changeGroupCode(groupId, {
    groupCode,
    keywords,
    keyVersion,
    encryptedMeta: encryptGroupMeta(meta, groupId, keyVersion, groupKey),
  });
  await s.vault.saveGroupKey(groupId, keyVersion, groupKey, groupCode, s.masterKey);
  for (let v = keyVersion - 1; v >= 1; v--) if (await s.vault.hasGroupKey(groupId, v)) await s.vault.deleteGroupKey(groupId, v);
  await s.vault.saveMeta(groupId, meta, s.masterKey);
  await s.vault.setCodeVersion(groupId, codeVersion);
}

/** Adds every version the server holds sealed to us that is not in `keys` yet. */
function openSealedKeys(s: Session, g: GroupSummary, keys: GroupKeys) {
  for (const k of g.sealedKeys) {
    if (keys.has(k.keyVersion)) continue;
    try {
      keys.set(k.keyVersion, openSealedGroupKey(k.sealedKey, s.identity));
    } catch {
      // Not sealed to our current identity: that version stays unreadable.
    }
  }
}

/**
 * Brings an open group up to date: rotates the key if a member left (the
 * first phone to try wins, the others pick up its key), opens versions
 * rotated by others, and refreshes the local meta. Throws ApiError 404 if
 * we are no longer a member.
 */
export async function syncGroup(
  s: Session,
  profiles: ProfileCache,
  groupId: string,
  keys: GroupKeys,
): Promise<{ summary: GroupSummary; keys: GroupKeys; keyVersion: number; meta: GroupMeta }> {
  let g = await summary(s, groupId);
  const next: GroupKeys = new Map(keys);
  openSealedKeys(s, g, next);
  if (g.rotationPending && next.has(g.currentKeyVersion)) {
    const meta = decryptGroupMeta(g.encryptedMeta, groupId, g.currentKeyVersion, next.get(g.currentKeyVersion)!);
    try {
      await rotateKey(s, profiles, groupId, g.currentKeyVersion, meta);
    } catch (e) {
      // Someone rotated first, or membership changed meanwhile: take theirs, retry later.
      if (!(e instanceof ApiError && e.status === 409)) throw e;
    }
    g = await summary(s, groupId);
    openSealedKeys(s, g, next);
  }
  const current = next.get(g.currentKeyVersion);
  if (!current) throw new ApiError(409, 'stale_key_version');
  const meta = decryptGroupMeta(g.encryptedMeta, groupId, g.currentKeyVersion, current);
  await s.vault.saveMeta(groupId, meta, s.masterKey);
  return { summary: g, keys: next, keyVersion: g.currentKeyVersion, meta };
}

async function summary(s: Session, groupId: string): Promise<GroupSummary> {
  const g = (await s.api.groups()).find((x) => x.id === groupId);
  if (!g) throw new ApiError(404, 'not_found');
  return g;
}

/** Draws a new group key and seals it to every current member, us included. */
async function rotateKey(s: Session, profiles: ProfileCache, groupId: string, fromKeyVersion: number, meta: GroupMeta) {
  const { members } = await s.api.members(groupId);
  const known = await profiles.get(members.map((m) => m.userId));
  const groupKey = generateGroupKey();
  const keys = members.map((m) => {
    const p = known.get(m.userId);
    if (!p) throw new Error('missing_profile');
    return { userId: m.userId, sealedKey: sealGroupKeyFor(groupKey, parsePublicIdentity(p).boxPublicKey) };
  });
  await s.api.rotateKey(groupId, {
    fromKeyVersion,
    encryptedMeta: encryptGroupMeta(meta, groupId, fromKeyVersion + 1, groupKey),
    keys,
  });
}

// ---- Members and key distribution -----------------------------------------------

/** Public keys of group members, cached for the session. */
export class ProfileCache {
  private readonly byId = new Map<string, Profile>();
  constructor(private readonly api: Api) {}

  async get(ids: string[]): Promise<Map<string, Profile>> {
    const missing = [...new Set(ids)].filter((id) => !this.byId.has(id));
    if (missing.length) for (const p of await this.api.profiles(missing)) this.byId.set(p.id, p);
    return this.byId;
  }

  /** After changing our own avatar: shown right away in groups and chats. */
  setAvatar(id: string, avatar: string | null) {
    const p = this.byId.get(id);
    if (p) this.byId.set(id, { ...p, avatar });
  }
}

/**
 * Seals the current group key for members who joined but do not have it yet.
 * Trust on first use: a member's public key is the one the server returns;
 * comparing safety numbers in person detects a substituted key.
 */
export async function shareMissingKeys(s: Session, profiles: ProfileCache, groupId: string, groupKey: Uint8Array, keyVersion: number): Promise<number> {
  const { currentKeyVersion, members } = await s.api.members(groupId);
  if (currentKeyVersion !== keyVersion) return 0;
  const pending = members.filter((m) => !m.hasCurrentKey && m.userId !== s.account.userId);
  if (!pending.length) return 0;
  const known = await profiles.get(pending.map((m) => m.userId));
  const keys = pending.flatMap((m) => {
    const p = known.get(m.userId);
    if (!p) return [];
    const { boxPublicKey } = parsePublicIdentity(p);
    return [{ userId: m.userId, keyVersion, sealedKey: sealGroupKeyFor(groupKey, boxPublicKey) }];
  });
  if (!keys.length) return 0;
  return (await s.api.shareKeys(groupId, keys)).stored;
}

// ---- Messages ----------------------------------------------------------------------

export interface ChatMessage {
  id: string;
  seq: number;
  clientId: string;
  senderId: string;
  senderName: string;
  senderAvatar: string | null;
  // Both null: could not be verified/decrypted (or a malformed image body).
  text: string | null;
  image: ImageBody | null;
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
      createdAt: m.createdAt,
      mine: m.senderId === s.account.userId,
    };
  });
}

/** All messages after `after`, following pagination. */
export async function fetchSince(s: Session, groupId: string, after: number): Promise<WireMessage[]> {
  const out: WireMessage[] = [];
  let cursor = after;
  for (;;) {
    const page = await s.api.messages(groupId, cursor, 200);
    out.push(...page.messages);
    if (!page.hasMore || page.messages.length === 0) return out;
    cursor = page.messages[page.messages.length - 1]!.seq;
  }
}

export function newClientId(): string {
  return randomUUID();
}

export async function sendText(s: Session, groupId: string, groupKey: Uint8Array, keyVersion: number, text: string, clientId: string): Promise<WireMessage> {
  const body = encodeMessageBody({ kind: 'text', text });
  const encrypted = encryptMessage(body, { groupId, senderId: s.account.userId, clientId, keyVersion }, groupKey, s.identity);
  return s.api.sendMessage(groupId, { clientId, keyVersion, ...encrypted });
}

// ---- Images (SPEC §4.3) ----------------------------------------------------------

/** An image ready to send: re-encoded JPEG (no metadata) and a tiny preview. */
export interface PreparedImage {
  jpeg: Uint8Array;
  width: number;
  height: number;
  preview?: string; // base64url JPEG, a few hundred bytes
}

export class ImageTooLargeError extends Error {
  constructor() {
    super('image_too_large');
    this.name = 'ImageTooLargeError';
  }
}

/**
 * Encrypts the image under a fresh file key and uploads the blob. Returns the
 * message body to send; keep it to retry the send without uploading again.
 */
export async function uploadImage(s: Session, groupId: string, image: PreparedImage): Promise<ImageBody> {
  const size = image.jpeg.length + 24 + 16; // nonce + Poly1305 tag
  if (size > MAX_ATTACHMENT_BYTES) throw new ImageTooLargeError();
  const { id, uploadUrl } = await s.api.createAttachment(groupId, size);
  const { blob, fileKey } = encryptAttachment(image.jpeg, { groupId, attachmentId: id });
  await s.api.uploadBlob(uploadUrl, blob);
  return {
    kind: 'image',
    attachmentId: id,
    fileKey: b64.encode(fileKey),
    mime: 'image/jpeg',
    width: image.width,
    height: image.height,
    size: blob.length,
    ...(image.preview && { preview: image.preview }),
  };
}

export async function sendImage(s: Session, groupId: string, groupKey: Uint8Array, keyVersion: number, body: ImageBody, clientId: string): Promise<WireMessage> {
  const encrypted = encryptMessage(encodeMessageBody(body), { groupId, senderId: s.account.userId, clientId, keyVersion }, groupKey, s.identity);
  return s.api.sendMessage(groupId, { clientId, keyVersion, ...encrypted, attachmentId: body.attachmentId });
}

/** Downloads and decrypts an image. Throws CryptoError if the blob was tampered with or swapped. */
export async function loadImage(s: Session, groupId: string, body: ImageBody): Promise<Uint8Array> {
  const { url } = await s.api.attachmentUrl(groupId, body.attachmentId);
  const blob = await s.api.downloadBlob(url);
  return decryptAttachment(blob, b64.decode(body.fileKey), { groupId, attachmentId: body.attachmentId });
}
