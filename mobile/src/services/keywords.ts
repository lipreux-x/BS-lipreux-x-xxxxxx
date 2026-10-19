import { KEYWORD_COUNT, normalizeKeyword } from '@/crypto';

/*
 * Join keywords: 3 words chosen at creation, typed with the group code to
 * join. Case, accents, extra spaces and order are ignored (crypto/groupSecret.ts
 * normalizes them before deriving the group's keys).
 */
export { KEYWORD_COUNT, normalizeKeyword };
export const KEYWORD_MAX_LENGTH = 40;

/** Null if valid, else the problem to show. */
export function keywordsProblem(words: string[]): string | null {
  const n = words.map(normalizeKeyword);
  if (n.length !== KEYWORD_COUNT || n.some((w) => !w)) return 'Remplis les 3 mots-clés';
  if (new Set(n).size !== n.length) return 'Les 3 mots-clés doivent être différents';
  return null;
}
