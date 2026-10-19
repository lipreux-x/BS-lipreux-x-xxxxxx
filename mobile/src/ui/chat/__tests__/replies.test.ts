import { replyRefFor, resolveQuote, type Quotable } from '../replies';

const alice = 'a11ce000-0000-4000-8000-000000000001';
const bob = 'b0b00000-0000-4000-8000-000000000002';
const msg = (id: string, senderId: string, text: string | null, extra: Partial<Quotable> = {}): Quotable => ({
  id,
  senderId,
  senderName: senderId === alice ? 'alice' : 'bob',
  mine: senderId === alice,
  text,
  image: null,
  ...extra,
});

const m1 = msg('11111111-0000-4000-8000-000000000001', bob, 'Rdv à la base ce soir ?');
const photo = msg('22222222-0000-4000-8000-000000000002', bob, null, { image: { kind: 'image' } });
const unreadable = msg('33333333-0000-4000-8000-000000000003', bob, null);

describe('replyRefFor', () => {
  it('quotes text and images, not unreadable messages', () => {
    expect(replyRefFor(m1)).toEqual({ messageId: m1.id, senderId: bob, excerpt: 'Rdv à la base ce soir ?' });
    expect(replyRefFor(photo)).toEqual({ messageId: photo.id, senderId: bob, excerpt: '', image: true });
    expect(replyRefFor(unreadable)).toBeNull();
  });
});

describe('resolveQuote', () => {
  it('shows the original when it is loaded, whatever the reply claims', () => {
    const forged = { messageId: m1.id, senderId: bob, excerpt: 'Je balance tout aux flics' };
    expect(resolveQuote(forged, [m1], alice)).toEqual({ author: 'bob', excerpt: 'Rdv à la base ce soir ?', image: false, found: true });
  });

  it('says "Toi" for my own messages and handles images', () => {
    const mine = msg('44444444-0000-4000-8000-000000000004', alice, 'Ok');
    expect(resolveQuote(replyRefFor(mine)!, [mine], alice)).toMatchObject({ author: 'Toi', excerpt: 'Ok' });
    expect(resolveQuote(replyRefFor(photo)!, [photo], alice)).toMatchObject({ image: true, found: true });
  });

  it('falls back to the quoted excerpt when the original is gone', () => {
    const ref = { messageId: '55555555-0000-4000-8000-000000000005', senderId: bob, excerpt: 'ancien message' };
    expect(resolveQuote(ref, [m1], alice)).toEqual({ author: 'bob', excerpt: 'ancien message', image: false, found: false });
    expect(resolveQuote(ref, [], alice).author).toBe('Un membre');
  });

  it('does not attach a quote to a message from someone else with the same id', () => {
    const ref = { messageId: m1.id, senderId: alice, excerpt: 'autre' };
    expect(resolveQuote(ref, [m1], alice)).toMatchObject({ found: false, excerpt: 'autre', author: 'Toi' });
  });
});
