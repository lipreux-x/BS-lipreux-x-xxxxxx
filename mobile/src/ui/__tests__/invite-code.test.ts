import { nextInvite } from '../invite';

describe('invitation code field', () => {
  it('keeps letters and digits only, upper case', () => {
    expect(nextInvite('', 'a')).toBe('A');
    expect(nextInvite('ABC', 'ABCd')).toBe('ABCD');
  });

  it('ignores a typed dash', () => {
    expect(nextInvite('ABCD', 'ABCD-')).toBe('ABCD');
    expect(nextInvite('ABCD', 'ABCD-E')).toBe('ABCDE');
  });

  it('reads I and L as 1, O as 0: those letters are never in a code', () => {
    expect(nextInvite('', 'o')).toBe('0');
    expect(nextInvite('0', '0I')).toBe('01');
    expect(nextInvite('', 'OIL0-ABCD-EFGH-JKMN')).toBe('0110ABCDEFGHJKMN');
  });

  it('stops at 16 characters when typing', () => {
    expect(nextInvite('0123456789ABCDEF', '0123456789ABCDEFG')).toBe('0123456789ABCDEF');
  });

  it('takes a pasted code, with dashes or spaces, even over a partly typed one', () => {
    expect(nextInvite('', '0123-4567-89ab cdef \n')).toBe('0123456789ABCDEF');
    expect(nextInvite('XY', 'XY0123-4567-89AB-CDEF')).toBe('0123456789ABCDEF');
  });
});
