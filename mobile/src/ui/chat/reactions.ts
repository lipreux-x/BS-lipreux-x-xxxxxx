import { REACTIONS, type ReactionBody, type ReactionId } from '@/crypto';

/*
 * Reactions, independent of React: what a message got, counted from each
 * member's latest reaction to it, and what a tap means. Pure functions,
 * unit-tested. Drawn by ReactionKeys.tsx, in the app's own style, never as
 * emoji.
 */

export const REACTION_LABELS: Record<ReactionId, string> = {
  like: 'J’aime',
  crown: 'Couronne',
  money: 'Pièces',
  fire: 'Flamme',
  secret: 'Secret',
};

export interface ReactionCount {
  reaction: ReactionId;
  count: number;
  /** One of them is mine. */
  mine: boolean;
}

/** A reaction as the chat received it: who, in what order (the server's seq). */
export interface ReactionMessage {
  senderId: string;
  seq: number;
  reaction: ReactionBody;
}

/**
 * Per message id, what it got: each member's latest reaction to it (a null
 * one takes the previous back), counted in the palette's order, mine flagged.
 * Reactions still on their way (`pending`, mine) come after everything.
 */
export function tallyReactions(received: ReactionMessage[], pending: ReactionBody[], me: string): Map<string, ReactionCount[]> {
  // Latest per (message, member).
  const latest = new Map<string, Map<string, ReactionId | null>>();
  const set = (messageId: string, senderId: string, reaction: ReactionId | null) => {
    let byMember = latest.get(messageId);
    if (!byMember) latest.set(messageId, (byMember = new Map()));
    byMember.set(senderId, reaction);
  };
  for (const r of [...received].sort((a, b) => a.seq - b.seq)) set(r.reaction.messageId, r.senderId, r.reaction.reaction);
  for (const p of pending) set(p.messageId, me, p.reaction);

  const out = new Map<string, ReactionCount[]>();
  for (const [messageId, byMember] of latest) {
    const counts = REACTIONS.map((reaction) => ({ reaction, count: 0, mine: false }));
    for (const [senderId, reaction] of byMember) {
      if (reaction === null) continue;
      const c = counts[REACTIONS.indexOf(reaction)]!;
      c.count += 1;
      if (senderId === me) c.mine = true;
    }
    const got = counts.filter((c) => c.count > 0);
    if (got.length) out.set(messageId, got);
  }
  return out;
}

/** My reaction to a message, from its tally. */
export const myReaction = (counts: ReactionCount[] | undefined): ReactionId | null => counts?.find((c) => c.mine)?.reaction ?? null;

/** What a tap on `tapped` means for someone whose reaction is `mine`: the same one takes it back, another replaces it. */
export const nextReaction = (mine: ReactionId | null, tapped: ReactionId): ReactionId | null => (mine === tapped ? null : tapped);
