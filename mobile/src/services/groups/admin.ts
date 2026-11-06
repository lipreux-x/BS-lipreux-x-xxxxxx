import { b64, deriveGroupSecrets, encryptGroupMeta, keyFingerprint, parsePublicIdentity, sealHandout, type GroupMeta } from '@/crypto';
import { wipe } from '@/crypto/encoding';
import { ApiError } from '../api';
import { CodeChangedError, GroupTamperedError, hasCode, KeyChangedError, staleCode, summary, type GroupKeys, type Session } from './core';
import type { ProfileCache } from './profiles';
import { verifyGroup } from './verify';

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
  const handout = sealHandout(all.get(v)!, secret.wrapKey, groupId, v, { userId, boxPublicKey: pinned.boxPublicKey }, s.identity, next.name);
  await s.api.approveMember(groupId, userId, {
    keyVersion: v,
    sealedKey: handout.sealedKey,
    keySignature: handout.signature,
    sealedLabel: handout.sealedLabel,
    labelSignature: handout.labelSignature,
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
  if (!hasCode(g)) throw new ApiError(400, 'no_group_code');
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
      return [{ userId: m.userId, keyVersion: kv, ...sealHandout(key, wrapKey, groupId, kv, { userId: m.userId, boxPublicKey: p.boxPublicKey }, s.identity, meta.name) }];
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
