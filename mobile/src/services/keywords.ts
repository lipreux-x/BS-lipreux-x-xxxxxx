/*
 * Join keywords: 3 words chosen at creation, typed with the group code to
 * join. Same normalization as server/src/lib/crypto.ts (case, accents and
 * extra spaces ignored; the server also ignores the order).
 */
export const KEYWORD_COUNT = 3;
export const KEYWORD_MAX_LENGTH = 40;

export function normalizeKeyword(word: string): string {
  return word.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim().replace(/\s+/g, ' ');
}

/** Null if valid, else the problem to show. */
export function keywordsProblem(words: string[]): string | null {
  const n = words.map(normalizeKeyword);
  if (n.length !== KEYWORD_COUNT || n.some((w) => !w)) return 'Remplis les 3 mots-clés';
  if (new Set(n).size !== n.length) return 'Les 3 mots-clés doivent être différents';
  return null;
}
