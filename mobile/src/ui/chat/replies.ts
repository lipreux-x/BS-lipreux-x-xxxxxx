import { replyExcerpt, type MessageBody, type ReplyRef } from '@/crypto';

/*
 * Replies, independent of React. A reply quotes its original inside the
 * encrypted body (id, sender, excerpt). On screen, the original wins when it
 * is still loaded: the quote cannot be used to put words in someone's mouth.
 * When it is gone (expired, deleted group history), the excerpt stands in.
 */

/** What the chat knows about a message, enough to quote it. */
export interface Quotable {
  id: string;
  senderId: string;
  senderName: string;
  mine: boolean;
  text: string | null;
  image: { kind: 'image' } | null;
}

export interface Quote {
  author: string;
  excerpt: string;
  image: boolean;
  /** The original is loaded: tapping the quote can scroll to it. */
  found: boolean;
}

function bodyOf(m: Quotable): MessageBody | null {
  if (m.image) return m.image as MessageBody;
  return m.text === null ? null : { kind: 'text', text: m.text };
}

/** The reference to put in a reply to `m`; null if `m` cannot be quoted (unreadable). */
export function replyRefFor(m: Quotable): ReplyRef | null {
  const body = bodyOf(m);
  return body ? { messageId: m.id, senderId: m.senderId, ...replyExcerpt(body) } : null;
}

/** How to show the quote of `ref`, given the messages loaded in the chat. */
export function resolveQuote(ref: ReplyRef, messages: Quotable[], me: string): Quote {
  const original = messages.find((m) => m.id === ref.messageId);
  const body = original && bodyOf(original);
  if (original && body && original.senderId === ref.senderId) {
    return { author: original.mine ? 'Toi' : original.senderName, ...withImage(replyExcerpt(body)), found: true };
  }
  const author =
    ref.senderId === me ? 'Toi' : (messages.find((m) => m.senderId === ref.senderId)?.senderName ?? 'Un membre');
  return { author, excerpt: ref.excerpt, image: ref.image === true, found: false };
}

const withImage = (e: Pick<ReplyRef, 'excerpt' | 'image'>) => ({ excerpt: e.excerpt, image: e.image === true });
