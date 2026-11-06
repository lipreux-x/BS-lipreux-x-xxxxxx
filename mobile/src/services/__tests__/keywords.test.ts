import { KEYWORD_MAX_LENGTH, keywordsProblem } from '../keywords';

describe('keywordsProblem', () => {
  const long = 'a'.repeat(KEYWORD_MAX_LENGTH + 1);

  it('caps chosen keywords at 20 characters, spaces around them aside', () => {
    expect(keywordsProblem(['marteau', 'coffre', 'b'.repeat(20)], KEYWORD_MAX_LENGTH)).toBeNull();
    expect(keywordsProblem(['marteau', 'coffre', ` ${'b'.repeat(20)} `], KEYWORD_MAX_LENGTH)).toBeNull();
    expect(keywordsProblem(['marteau', 'coffre', long], KEYWORD_MAX_LENGTH)).toBe('20 caractères au plus par mot-clé');
  });

  it('still takes the longer keywords of earlier groups when typed to join or open one', () => {
    expect(keywordsProblem(['marteau', 'coffre', long])).toBeNull();
    expect(keywordsProblem(['marteau', 'coffre', 'c'.repeat(41)])).toBe('40 caractères au plus par mot-clé');
  });

  it('wants 3 different words', () => {
    expect(keywordsProblem(['marteau', '', 'secret'])).toBe('Remplis les 3 mots-clés');
    expect(keywordsProblem(['Marteau', 'marteau', 'secret'])).toBe('Les 3 mots-clés doivent être différents');
  });
});
