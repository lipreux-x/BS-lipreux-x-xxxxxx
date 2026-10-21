import type { ReactionBody } from '@/crypto';
import { moveKey, myReaction, nextReaction, orderCounts, reactionOrder, tallyReactions, withAlpha, type ReactionMessage } from '../reactions';

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

describe('the order of the keys', () => {
  it('moves a key, keeps the others in place', () => {
    expect(moveKey(['like', 'crown', 'money', 'fire', 'secret'], 0, 2)).toEqual(['crown', 'money', 'like', 'fire', 'secret']);
    expect(moveKey(['like', 'crown', 'money', 'fire', 'secret'], 4, 0)).toEqual(['secret', 'like', 'crown', 'money', 'fire']);
  });

  it('reads a stored order, falls back to the palette on anything else', () => {
    expect(reactionOrder(['secret', 'fire', 'money', 'crown', 'like'])).toEqual(['secret', 'fire', 'money', 'crown', 'like']);
    expect(reactionOrder(['secret', 'fire'])).toEqual(['like', 'crown', 'money', 'fire', 'secret']);
    expect(reactionOrder(null)).toEqual(['like', 'crown', 'money', 'fire', 'secret']);
  });

  it('sorts counts by it', () => {
    const counts = [
      { reaction: 'like' as const, count: 1, mine: false },
      { reaction: 'fire' as const, count: 2, mine: true },
    ];
    expect(orderCounts(counts, ['fire', 'like', 'crown', 'money', 'secret']).map((c) => c.reaction)).toEqual(['fire', 'like']);
  });

  it('colours get an alpha', () => {
    expect(withAlpha('#3DD68C', 0.5)).toBe('rgba(61,214,140,0.5)');
  });
});
