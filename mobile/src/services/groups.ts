import { randomUUID } from 'expo-crypto';
import {
  b64,
  decryptGroupMeta,
  decryptMessage,
  encryptGroupMeta,
  encryptMessage,
  generateGroupKey,
  openGroupKey as openSealedGroupKey,
  parsePublicIdentity,
  sealGroupKeyFor,
  type GroupMeta,
} from '@/crypto';
import { ApiError, type Api, type GroupSummary, type Profile, type WireMessage } from './api';
import type { UnlockedVault, Vault } from './vault';

/*
 * Group flows on top of the API, the crypto module and the vault.
 *
 * Key flow (SPEC §4.3–4.4):
 * - create: the phone draws the group key, encrypts the name with it, seals it
 *   for itself (server copy) and locks it locally with group code + master key.
 * - join: the server checks the code (rate-limited) and adds a membership; the
 *   key arrives later, sealed to us by a member who has it (shareMissingKeys).
 * - first unlock after the key arrived: we open the sealed copy with our
 *   identity, then lock it locally with the code the user just typed.
 */

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
  if (await s.vault.hasGroupKey(g.id, g.currentKeyVersion)) return { kind: 'locked' };
  if (g.sealedKeys.some((k) => k.keyVersion === g.currentKeyVersion)) return { kind: 'first-unlock' };
  return { kind: 'waiting-key' };
}

export async function createGroup(s: Session, name: string, groupCode: string): Promise<{ id: string; groupKey: Uint8Array }> {
  const id = randomUUID();
  const groupKey = generateGroupKey();
  const meta: GroupMeta = { name };
  await s.api.createGroup({
    id,
    encryptedMeta: encryptGroupMeta(meta, id, 1, groupKey),
    groupCode,
    sealedKey: sealGroupKeyFor(groupKey, s.identity.boxPublicKey),
  });
  await s.vault.saveGroupKey(id, 1, groupKey, groupCode, s.masterKey);
  await s.vault.saveMeta(id, meta, s.masterKey);
  return { id, groupKey };
}

export async function joinGroup(s: Session, groupId: string, groupCode: string): Promise<void> {
  await s.api.joinGroup(groupId.trim().toLowerCase(), groupCode);
}

/**
 * Unlocks a group with its code. Returns the group key, or null if the key
 * has not been shared with us yet. Wrong codes throw from the vault
 * (WrongCodeError / LockedOutError) and count toward the lockout.
 */
export async function unlockGroup(s: Session, groupId: string, groupCode: string): Promise<{ groupKey: Uint8Array; keyVersion: number; meta: GroupMeta } | null> {
  const g = (await s.api.groups()).find((x) => x.id === groupId);
  if (!g) throw new ApiError(404, 'not_found');
  const v = g.currentKeyVersion;

  let groupKey: Uint8Array;
  if (await s.vault.hasGroupKey(groupId, v)) {
    groupKey = await s.vault.openGroupKey(groupId, v, groupCode, s.masterKey);
  } else {
    const sealed = g.sealedKeys.find((k) => k.keyVersion === v);
    if (!sealed) return null;
    groupKey = openSealedGroupKey(sealed.sealedKey, s.identity);
    await s.vault.saveGroupKey(groupId, v, groupKey, groupCode, s.masterKey);
  }
  const meta = decryptGroupMeta(g.encryptedMeta, groupId, 1, groupKey);
  await s.vault.saveMeta(groupId, meta, s.masterKey);
  return { groupKey, keyVersion: v, meta };
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
  text: string | null; // null: could not be verified/decrypted
  createdAt: string;
  mine: boolean;
}

export async function decryptMessages(s: Session, profiles: ProfileCache, groupKey: Uint8Array, wire: WireMessage[]): Promise<ChatMessage[]> {
  const known = await profiles.get(wire.map((m) => m.senderId));
  return wire.map((m) => {
    const p = known.get(m.senderId);
    let text: string | null = null;
    if (p) {
      try {
        text = decryptMessage(
          { nonce: m.nonce, ciphertext: m.ciphertext, signature: m.signature },
          { groupId: m.groupId, senderId: m.senderId, clientId: m.clientId, keyVersion: m.keyVersion },
          groupKey,
          b64.decode(p.publicKeySign),
        );
      } catch {
        text = null; // tampered, forged or other key version: shown as unreadable
      }
    }
    return {
      id: m.id,
      seq: m.seq,
      clientId: m.clientId,
      senderId: m.senderId,
      senderName: p?.username ?? '?',
      text,
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
  const encrypted = encryptMessage(text, { groupId, senderId: s.account.userId, clientId, keyVersion }, groupKey, s.identity);
  return s.api.sendMessage(groupId, { clientId, keyVersion, ...encrypted });
}
