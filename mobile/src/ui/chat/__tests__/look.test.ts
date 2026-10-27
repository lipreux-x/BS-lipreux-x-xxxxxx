import { CHAT_LOOKS, chatLook } from '../look';

describe('chat look', () => {
  it('reads back the look saved on this phone', () => {
    expect(chatLook('plates')).toBe('plates');
    expect(chatLook('terminal')).toBe('terminal');
  });

  it('is the terminal when nothing (or nothing known) was saved', () => {
    for (const v of [undefined, null, '', 'bubbles', 1, {}]) expect(chatLook(v)).toBe('terminal');
  });

  it('offers the terminal first, then the plates with avatars', () => {
    expect(CHAT_LOOKS.map((l) => l.value)).toEqual(['terminal', 'plates']);
  });
});
