import { b64, type ImageBody, type ReplyRef, type VoiceBody } from '@/crypto';
import type { PreparedImage, PreparedVoice } from './groups';
import { records, type LocalStore } from './localStore';

/*
 * Messages written but not confirmed by the server yet (SPEC §5.2), kept in
 * the local store so they survive the app being closed or locked. They go out
 * in order the next time the group is open with network. The clientId stays
 * the same on every attempt: the server ignores a message it already has.
 *
 * Sealed with the local database key like everything else there. An image
 * or a voice message keeps its bytes until sent, and its uploaded body so a
 * retry does not upload it again.
 */

export type Pending = {
  clientId: string;
  at: string;
  /** Refused by the server (not a network problem): shown with a retry button. */
  failed: boolean;
  /** Set when retrying cannot help (e.g. image too large). */
  error?: string;
  replyTo?: ReplyRef;
} & (
  | { kind: 'text'; text: string }
  // `body` is set once the encrypted file is uploaded: a retry only resends the message.
  | { kind: 'image'; image: PreparedImage; body?: ImageBody }
  | { kind: 'voice'; voice: PreparedVoice; body?: VoiceBody }
);

type Saved =
  | Extract<Pending, { kind: 'text' }>
  | (Omit<Extract<Pending, { kind: 'image' }>, 'image'> & { image: Omit<PreparedImage, 'jpeg'> & { jpeg: string } })
  | (Omit<Extract<Pending, { kind: 'voice' }>, 'voice'> & { voice: Omit<PreparedVoice, 'audio'> & { audio: string } });

export async function loadOutbox(local: LocalStore, groupId: string): Promise<Pending[]> {
  const saved = (await local.getRecord<Saved[]>(records.outbox(groupId))) ?? [];
  return saved.flatMap((p): Pending[] => {
    try {
      if (p.kind === 'text') return [p];
      if (p.kind === 'image') return [{ ...p, image: { ...p.image, jpeg: b64.decode(p.image.jpeg) } }];
      if (p.kind === 'voice') return [{ ...p, voice: { ...p.voice, audio: b64.decode(p.voice.audio) } }];
    } catch {
      // unreadable entry: dropped
    }
    return [];
  });
}

export async function saveOutbox(local: LocalStore, groupId: string, items: Pending[]) {
  const saved: Saved[] = items.map((p) => {
    if (p.kind === 'image') return { ...p, image: { ...p.image, jpeg: b64.encode(p.image.jpeg) } };
    if (p.kind === 'voice') return { ...p, voice: { ...p.voice, audio: b64.encode(p.voice.audio) } };
    return p;
  });
  await local.setRecord(records.outbox(groupId), saved);
}
