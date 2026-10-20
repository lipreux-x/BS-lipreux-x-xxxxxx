import { replyExcerpt, type MessageBody, type ReplyRef } from '@/crypto';

/*
 * Replies, independent of React. A reply quotes its original inside the
 * encrypted body (id, sender, excerpt). On screen, the original wins when it
 * is still loaded: the quote cannot be used to put words in someone's mouth.
 * When it is gone (expired, erased history), the excerpt stands in, marked
 * as unverified: it is only what the replier claims. A quote whose original
 * is loaded but was written by someone else is shown as forged.
 */

/** What the chat knows about a message, enough to quote it. */
export interface Quotable {
  id: string;
  senderId: string;
  senderName: string;
  mine: boolean;
  text: string | null;
  image: { kind: 'image' } | null;
  voice?: { kind: 'voice' } | null;
}

export interface Quote {
  author: string;
  excerpt: string;
  image: boolean;
  voice?: true;
  /** The original is loaded: tapping the quote can scroll to it. */
  found: boolean;
}

function bodyOf(m: Quotable): MessageBody | null {
  if (m.image) return m.image as MessageBody;
  if (m.voice) return m.voice as MessageBody;
  return m.text === null ? null : { kind: 'text', text: m.text };
}

/** The reference to put in a reply to `m`; null if `m` cannot be quoted (unreadable). */
export function replyRefFor(m: Quotable): ReplyRef | null {
  const body = bodyOf(m);
  return body ? { messageId: m.id, senderId: m.senderId, ...replyExcerpt(body) } : null;
}

/** How to show the quote of `ref`, given the messages loaded in the chat. */
export function resolveQuote(ref: ReplyRef, messages: Quotable[], me: string): Quote {
  return quoteResolver(messages, me)(ref);
}

/** `resolveQuote` for many quotes at once: the messages are indexed once (by id, and their senders' names). */
export function quoteResolver(messages: Quotable[], me: string): (ref: ReplyRef) => Quote {
  // The first one wins, as a search from the start would find it.
  const byId = new Map<string, Quotable>();
  const names = new Map<string, string>();
  for (const m of messages) {
    if (!byId.has(m.id)) byId.set(m.id, m);
    if (!names.has(m.senderId)) names.set(m.senderId, m.senderName);
  }
  return (ref) => {
    const original = byId.get(ref.messageId);
    const body = original && bodyOf(original);
    if (original && body && original.senderId === ref.senderId) {
      return { author: original.mine ? 'Toi' : original.senderName, ...withImage(replyExcerpt(body)), found: true };
    }
    if (original) return { author: 'Citation falsifiée', excerpt: 'Ce message ne correspond pas à l’original', image: false, found: false };
    const claimed = ref.senderId === me ? 'Toi' : (names.get(ref.senderId) ?? 'Un membre');
    return { author: `${claimed} · non vérifié`, ...withImage(ref), found: false };
  };
}

const withImage = (e: Pick<ReplyRef, 'excerpt' | 'image' | 'voice'>) => ({
  excerpt: e.excerpt,
  image: e.image === true,
  ...(e.voice === true && { voice: true as const }),
});
