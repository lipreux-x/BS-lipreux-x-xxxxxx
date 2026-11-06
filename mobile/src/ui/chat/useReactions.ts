import * as Haptics from 'expo-haptics';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactionId } from '@/crypto';
import { newClientId, type ChatMessage } from '@/services/groups';
import { records } from '@/services/localStore';
import type { Pending } from '@/services/outbox';
import { myReaction, nextReaction, orderCounts, reactionOrder, tallyReactions } from './reactions';
import type { Keep } from './useKeep';

type SendFn = (item: Pending, opts?: { scroll?: boolean }) => void;

/**
 * The five reaction keys in the order chosen on this phone (long press in the
 * panel, kept in the local store), and what each message got: every member's
 * latest reaction, mine on their way included, in that order. A reaction goes
 * out like a quiet message (nobody's phone rings for it).
 */
export function useReactions(shown: ChatMessage[], pending: Pending[], userId: string, keep: Keep, send: SendFn) {
  const [order, setOrder] = useState(() => reactionOrder(null));
  useEffect(() => {
    void keep(async (l) => setOrder(reactionOrder((await l.getRecord<{ order: unknown }>(records.reactionOrder))?.order)));
  }, [keep]);
  const reorder = useCallback(
    (next: ReactionId[]) => {
      setOrder(next);
      void keep((l) => l.setRecord(records.reactionOrder, { order: next }));
    },
    [keep],
  );
  const reactionTally = useMemo(() => {
    const tally = tallyReactions(
      shown.flatMap((m) => (m.reaction ? [{ senderId: m.senderId, seq: m.seq, reaction: m.reaction }] : [])),
      pending.flatMap((p) => (p.kind === 'reaction' ? [p.reaction] : [])),
      userId,
    );
    for (const [id, counts] of tally) tally.set(id, orderCounts(counts, order));
    return tally;
  }, [shown, pending, userId, order]);

  /** One of the five keys for `m`: the same as mine takes it back, another replaces it. Goes out like a message. */
  const react = useCallback(
    (m: ChatMessage, id: ReactionId) => {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      const reaction = nextReaction(myReaction(reactionTally.get(m.id)), id);
      send(
        { clientId: newClientId(), at: new Date().toISOString(), kind: 'reaction', reaction: { kind: 'reaction', messageId: m.id, reaction }, failed: false },
        { scroll: false },
      );
    },
    [reactionTally, send],
  );
  /** Two taps on a message: the first key of this phone's order (the same one again takes it back). */
  const quickReact = useCallback((m: ChatMessage) => react(m, order[0]!), [react, order]);

  return { order, reorder, reactionTally, react, quickReact };
}
