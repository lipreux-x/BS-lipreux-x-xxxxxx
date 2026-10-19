import { frame, utf8, wipe } from './encoding';
import { CryptoError } from './errors';
import { argon2id, argon2Params } from './kdf';
import { isValidGroupCode } from './keywrap';
import { sodium } from './sodium';

/*
 * What the group code + 3 keywords are worth (SPEC §4.4). They never leave
 * the phone: one Argon2id (64 MiB) turns them into two independent keys.
 *
 * - joinKey: sent to the server to find the group and ask to join. The
 *   server keys it again with its own secret; testing a guess against it
 *   costs a full Argon2id, and the server rate-limits joins.
 * - wrapKey: never sent. Every group key handout on the server is wrapped
 *   under it (handoutKey), so opening one needs the code and keywords, not
 *   just the account's identity: neither the server nor someone who only
 *   knows the account password can read the group.
 *
 * The salt is fixed because whoever joins does not know the group yet; the
 * keywords give the input its entropy.
 */

const SALT = utf8.encode('bs/v2/group-sec!'); // 16 bytes
export const KEYWORD_COUNT = 3;

export interface GroupSecrets {
  joinKey: Uint8Array;
  wrapKey: Uint8Array;
}

/** Case, accents and extra spaces do not matter (same as the join form). */
export function normalizeKeyword(word: string): string {
  return word.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim().replace(/\s+/g, ' ');
}

/** Order does not matter either. */
export function normalizeKeywords(words: string[]): string {
  return words.map(normalizeKeyword).sort().join('\n');
}

export function sameKeywords(a: string[], b: string[]): boolean {
  return normalizeKeywords(a) === normalizeKeywords(b);
}

export async function deriveGroupSecrets(groupCode: string, keywords: string[]): Promise<GroupSecrets> {
  const n = keywords.map(normalizeKeyword);
  if (!isValidGroupCode(groupCode) || n.length !== KEYWORD_COUNT || n.some((w) => !w) || new Set(n).size !== n.length) {
    throw new CryptoError('INVALID_INPUT');
  }
  const master = await argon2id(64, frame(utf8.encode('bs/v2/group'), utf8.encode(groupCode), utf8.encode(n.sort().join('\n'))), SALT, argon2Params());
  try {
    return {
      joinKey: sodium.crypto_generichash(32, utf8.encode('bs/v2/join'), master),
      wrapKey: sodium.crypto_generichash(32, utf8.encode('bs/v2/wrap'), master),
    };
  } finally {
    wipe(master);
  }
}

/** The key one group's handouts are wrapped under. */
export function handoutKey(wrapKey: Uint8Array, groupId: string): Uint8Array {
  if (wrapKey.length !== 32) throw new CryptoError('INVALID_INPUT');
  return sodium.crypto_generichash(32, frame(utf8.encode('bs/v2/handout-key'), utf8.encode(groupId)), wrapKey);
}
