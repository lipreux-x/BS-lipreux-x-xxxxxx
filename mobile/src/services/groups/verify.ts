import { decryptGroupMeta, openHandout, sameKeywords, type GroupMeta } from '@/crypto';
import { ApiError, type GroupSummary } from '../api';
import type { StoredGroupSecret } from '../vault';
import { GroupTamperedError, type GroupKeys, type Session } from './core';
import type { ProfileCache } from './profiles';

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
export async function verifyGroup(
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
  // A group passed off as a private conversation or as a group without a code (or the other way round): the signed meta says which.
  if (!!meta.direct !== (g.kind === 'direct') || !!meta.link !== (g.kind === 'link')) throw new GroupTamperedError('untrusted_signer');

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
