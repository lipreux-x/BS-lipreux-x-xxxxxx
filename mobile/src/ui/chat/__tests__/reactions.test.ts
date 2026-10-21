import type { ReactionBody } from '@/crypto';
import { myReaction, nextReaction, tallyReactions, type ReactionMessage } from '../reactions';

const M1 = '1b9d6bcd-0000-4000-8000-0000000000aa';
const M2 = '1b9d6bcd-0000-4000-8000-0000000000ab';
const r = (senderId: string, seq: number, messageId: string, reaction: ReactionBody['reaction']): ReactionMessage => ({
  senderId,
  seq,
  reaction: { kind: 'reaction', messageId, reaction },
});

describe('reaction tally', () => {
  it('counts each member once, in the palette order, mine flagged', () => {
    const tally = tallyReactions([r('bob', 1, M1, 'fire'), r('me', 2, M1, 'crown'), r('carol', 3, M1, 'fire'), r('bob', 4, M2, 'like')], [], 'me');
    expect(tally.get(M1)).toEqual([
      { reaction: 'crown', count: 1, mine: true },
      { reaction: 'fire', count: 2, mine: false },
    ]);
    expect(tally.get(M2)).toEqual([{ reaction: 'like', count: 1, mine: false }]);
  });

  it('keeps only the latest reaction of a member, whatever the order received', () => {
    const tally = tallyReactions([r('bob', 5, M1, 'money'), r('bob', 2, M1, 'fire')], [], 'me');
    expect(tally.get(M1)).toEqual([{ reaction: 'money', count: 1, mine: false }]);
  });

  it('a null reaction takes it back; a message with nothing left is absent', () => {
    const tally = tallyReactions([r('bob', 1, M1, 'fire'), r('bob', 2, M1, null)], [], 'me');
    expect(tally.has(M1)).toBe(false);
  });

  it('pending reactions are mine and come last', () => {
    const tally = tallyReactions([r('me', 1, M1, 'fire')], [{ kind: 'reaction', messageId: M1, reaction: 'secret' }], 'me');
    expect(tally.get(M1)).toEqual([{ reaction: 'secret', count: 1, mine: true }]);
    expect(myReaction(tally.get(M1))).toBe('secret');
    expect(myReaction(tally.get(M2))).toBeNull();
  });
});

describe('a tap on a reaction', () => {
  it('takes the same one back, replaces another', () => {
    expect(nextReaction(null, 'like')).toBe('like');
    expect(nextReaction('like', 'like')).toBeNull();
    expect(nextReaction('like', 'crown')).toBe('crown');
  });
});
