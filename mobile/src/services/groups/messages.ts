import { randomUUID } from 'expo-crypto';
import {
  b64,
  decryptMessage,
  encodeMessageBody,
  encryptMessage,
  parseMessageBody,
  type FileBody,
  type ImageBody,
  type ReactionBody,
  type ReplyRef,
  type StoryBody,
  type VoiceBody,
} from '@/crypto';
import type { WireMessage } from '../api';
import type { GroupKeys, Session } from './core';
import type { ProfileCache } from './profiles';

export interface ChatMessage {
  id: string;
  seq: number;
  clientId: string;
  senderId: string;
  senderName: string;
  senderAvatar: string | null;
  /** The sender's account color id (null: the default). */
  senderColor: string | null;
  // All null: could not be verified/decrypted (or a malformed attachment body).
  text: string | null;
  image: ImageBody | null;
  voice: VoiceBody | null;
  /** A document (a PDF…): its name is inside the encrypted body. */
  file: FileBody | null;
  /** A story: shown in the story strip, not in the chat. */
  story: StoryBody | null;
  /** A reaction to another message: counted under it, never shown as a message. */
  reaction: ReactionBody | null;
  /** The message this one answers (quoted inside the encrypted body). */
  replyTo: ReplyRef | null;
  createdAt: string;
  /** Disappearing message or story: gone for everyone at this time. */
  expiresAt: string | null;
  mine: boolean;
  /** Deleted by its sender: nothing left of it but « message supprimé ». */
  deleted: boolean;
}

export async function decryptMessages(s: Session, profiles: ProfileCache, keys: GroupKeys, wire: WireMessage[]): Promise<ChatMessage[]> {
  const known = await profiles.get(wire.map((m) => m.senderId));
  return wire.map((m) => {
    const p = known.get(m.senderId);
    const groupKey = keys.get(m.keyVersion);
    let text: string | null = null;
    let image: ImageBody | null = null;
    let voice: VoiceBody | null = null;
    let file: FileBody | null = null;
    let story: StoryBody | null = null;
    let reaction: ReactionBody | null = null;
    let replyTo: ReplyRef | null = null;
    if (p && groupKey && !m.deleted) {
      try {
        const body = parseMessageBody(
          decryptMessage(
            { nonce: m.nonce, ciphertext: m.ciphertext, signature: m.signature },
            { groupId: m.groupId, senderId: m.senderId, clientId: m.clientId, keyVersion: m.keyVersion },
            groupKey,
            b64.decode(p.publicKeySign),
          ),
        );
        if (body?.kind === 'text') text = body.text;
        if (body?.kind === 'image') image = body;
        if (body?.kind === 'voice') voice = body;
        if (body?.kind === 'file') file = body;
        if (body?.kind === 'story') story = body;
        if (body?.kind === 'reaction') reaction = body;
        replyTo = (body?.kind === 'story' || body?.kind === 'reaction' ? null : body?.replyTo) ?? null;
      } catch {
        // tampered, forged or other key version: shown as unreadable
      }
    }
    return {
      id: m.id,
      seq: m.seq,
      clientId: m.clientId,
      senderId: m.senderId,
      senderName: p?.username ?? '?',
      senderAvatar: p?.avatar ?? null,
      senderColor: p?.color ?? null,
      text,
      image,
      voice,
      file,
      story,
      reaction,
      replyTo,
      createdAt: m.createdAt,
      expiresAt: m.expiresAt ?? null,
      mine: m.senderId === s.account.userId,
      deleted: !!m.deleted,
    };
  });
}

/**
 * All messages after `after`, following pagination, and the group's latest
 * erase (`purgeSeq`): when it moved, messages already shown may be gone.
 */
export async function fetchSince(s: Session, groupId: string, after: number): Promise<{ messages: WireMessage[]; purgeSeq: number }> {
  const out: WireMessage[] = [];
  let cursor = after;
  for (;;) {
    const page = await s.api.messages(groupId, cursor, 200);
    out.push(...page.messages);
    if (!page.hasMore || page.messages.length === 0) return { messages: out, purgeSeq: page.purgeSeq ?? 0 };
    cursor = page.messages[page.messages.length - 1]!.seq;
  }
}

export function newClientId(): string {
  return randomUUID();
}

export async function sendText(
  s: Session,
  groupId: string,
  groupKey: Uint8Array,
  keyVersion: number,
  text: string,
  clientId: string,
  replyTo?: ReplyRef,
): Promise<WireMessage> {
  const body = encodeMessageBody({ kind: 'text', text, ...(replyTo && { replyTo }) });
  const encrypted = encryptMessage(body, { groupId, senderId: s.account.userId, clientId, keyVersion }, groupKey, s.identity);
  return s.api.sendMessage(groupId, { clientId, keyVersion, ...encrypted });
}
