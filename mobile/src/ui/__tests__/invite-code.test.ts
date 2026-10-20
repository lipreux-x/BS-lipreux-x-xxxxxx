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

  it('stops at 16 characters when typing', () => {
    expect(nextInvite('0123456789ABCDEF', '0123456789ABCDEFG')).toBe('0123456789ABCDEF');
  });

  it('takes a pasted code, with dashes or spaces, even over a partly typed one', () => {
    expect(nextInvite('', '0123-4567-89ab cdef \n')).toBe('0123456789ABCDEF');
    expect(nextInvite('XY', 'XY0123-4567-89AB-CDEF')).toBe('0123456789ABCDEF');
  });
});
