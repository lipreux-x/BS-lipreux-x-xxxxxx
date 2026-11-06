import { KEYWORD_COUNT, normalizeKeyword } from '@/crypto';

/*
 * Join keywords: 3 words chosen at creation, typed with the group code to
 * join. Case, accents, extra spaces and order are ignored (crypto/groupSecret.ts
 * normalizes them before deriving the group's keys).
 */
export { KEYWORD_COUNT, normalizeKeyword };
/** The longest keyword one can choose (a new group, a code change): short enough to be said and remembered. */
export const KEYWORD_MAX_LENGTH = 20;
/** The longest one can type to join or open a group: earlier versions let admins choose up to 40. */
export const KEYWORD_ACCEPT_LENGTH = 40;

/** Null if valid, else the problem to show. `max`: KEYWORD_MAX_LENGTH when choosing them. */
export function keywordsProblem(words: string[], max = KEYWORD_ACCEPT_LENGTH): string | null {
  const n = words.map(normalizeKeyword);
  if (n.length !== KEYWORD_COUNT || n.some((w) => !w)) return 'Remplis les 3 mots-clés';
  if (words.some((w) => w.trim().length > max)) return `${max} caractères au plus par mot-clé`;
  if (new Set(n).size !== n.length) return 'Les 3 mots-clés doivent être différents';
  return null;
}
