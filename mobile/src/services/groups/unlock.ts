import { CryptoError, deriveGroupSecrets, openHandout, sealLabel, type GroupMeta } from '@/crypto';
import { constantTimeEqual, wipe } from '@/crypto/encoding';
import { ApiError, type GroupSummary } from '../api';
import type { StoredGroupSecret } from '../vault';
import { fetchGroups, GroupTamperedError, isActive, KeyChangedError, noCodeSecret, staleCode, summary, type GroupKeys, type Session } from './core';
import { conversationName } from './membership';
import type { ProfileCache } from './profiles';
import { verifyGroup } from './verify';

export interface OpenedGroup {
  groupKey: Uint8Array;
  keys: GroupKeys;
  keyVersion: number;
  meta: GroupMeta;
  /** What to call it: the group's name, or the other person's for a private conversation. */
  name: string;
  /** The admin changed the code since this phone stored it: ask for the new one (relockGroup). */
  codeChanged: boolean;
  /** Someone became admin since the meta this phone last verified (shown to the user). */
  adminChanged: boolean;
}

/**
 * Unlocks a group with its code (+ keywords the first time on a phone that
 * does not know them). Returns null if no key was handed to us yet. Wrong
 * codes throw WrongCodeError / LockedOutError and count toward the lockout.
 * A group without a code: `groupCode` is ignored (pass ''), the master key opens it.
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
  const noCode = g.kind === 'link';

  // Re-locked under the code typed now: it is the admin's new code.
  let tookNewCode = false;
  if (noCode) {
    if (local !== null) known.set(local, await s.vault.openGroupKeyNoCode(groupId, local, s.masterKey));
    else if (!g.sealedKeys.some((h) => h.keyVersion === v)) return null;
    // Signed in again on this phone: nothing kept, nothing to type either.
    secret ??= noCodeSecret(g.codeVersion);
  } else if (local !== null && secret && staleCode(secret, g) && g.sealedKeys.some((h) => h.keyVersion === v)) {
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
    // A private conversation's first unlock chooses this phone's code: nothing to check it against.
    secret =
      g.kind === 'direct'
        ? noCodeSecret(g.codeVersion)
        : await s.vault.checkGroupCode(groupId, () => firstUnlockSecret(s, profiles, g, groupCode, secret, keywords));
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
    return { groupKey: known.get(local)!, keys: known, keyVersion: local, meta, name: await conversationName(s, profiles, meta), codeChanged, adminChanged: false };
  }
  const groupKey = opened.keys.get(v)!;
  if (local !== v || tookNewCode) {
    // First unlock, a rotation, or the new code: lock the current key under this code (the master key alone without one).
    if (noCode) await s.vault.saveGroupKeyNoCode(groupId, v, groupKey, s.masterKey);
    else await s.vault.saveGroupKey(groupId, v, groupKey, groupCode, s.masterKey);
    if (local !== null && local !== v) await s.vault.deleteGroupKey(groupId, local);
  }
  if (secret.codeVersion === 0 || local === null || tookNewCode) {
    await s.vault.saveGroupSecret(groupId, { ...secret, codeVersion: g.codeVersion }, s.masterKey);
    await s.vault.setCodeVersion(groupId, g.codeVersion);
  }
  // Admin: handouts from before the sealed name get it now, in the background (best effort).
  // (A private conversation's handouts carry the other's name from the start.)
  if (g.role === 'admin' && !opened.meta.direct && opened.meta.admins.includes(s.account.userId)) void labelHandouts(s, profiles, groupId, opened.meta).catch(() => {});
  const name = await conversationName(s, profiles, opened.meta);
  return { groupKey, keys: opened.keys, keyVersion: v, meta: opened.meta, name, codeChanged, adminChanged: opened.adminChanged };
}

/**
 * Admin: every handout of the group without the group's name sealed beside
 * the key (from before it) gets one, sealed to its member and signed by us,
 * so that their locked plate names the group. How many were filled in.
 */
export async function labelHandouts(s: Session, profiles: ProfileCache, groupId: string, meta: GroupMeta): Promise<number> {
  const { members } = await s.api.members(groupId);
  const todo = members.flatMap((m) => (m.unlabelledKeyVersions ?? []).map((keyVersion) => ({ userId: m.userId, keyVersion })));
  if (!todo.length) return 0;
  const pinned = await profiles.trustedKeys([...new Set(todo.map((t) => t.userId))]);
  const keys = todo.flatMap(({ userId, keyVersion }) => {
    const p = pinned.get(userId);
    return p ? [{ userId, keyVersion, ...sealLabel(meta.name, groupId, keyVersion, { userId, boxPublicKey: p.boxPublicKey }, s.identity) }] : [];
  });
  if (!keys.length) return 0;
  return (await s.api.labelKeys(groupId, { keys })).labelled;
}

/**
 * First unlock: the code (and keywords, if this phone does not have them)
 * must re-derive a wrapKey that opens our handout of the current key. Throws
 * CryptoError on a wrong code, which the caller counts as a failed attempt.
 */
export async function firstUnlockSecret(
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
  return { ...opened, keyVersion: v, name: await conversationName(s, profiles, opened.meta) };
}
