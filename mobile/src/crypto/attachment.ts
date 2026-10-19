import * as aead from './aead';
import { b64, frame, utf8 } from './encoding';
import { attempt, CryptoError } from './errors';

/*
 * Attachments (images, voice messages) — SPEC §4.3.
 *
 * - Each file gets its own random key; the file is encrypted with it
 *   (XChaCha20-Poly1305) and the blob goes to object storage. The associated
 *   data binds the blob to its group and attachment id, so the server cannot
 *   serve one stored blob in place of another.
 * - The file key travels inside an ordinary group message (encrypted with the
 *   group key and signed by the sender): only members can read it, and the
 *   server cannot swap the key or re-attribute the image. Rotating the group
 *   key never requires re-encrypting stored files.
 */

export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024; // encrypted size, same limit as the server

export interface AttachmentContext {
  groupId: string;
  attachmentId: string; // issued by the server before the upload
}

const attachmentAd = (ctx: AttachmentContext) =>
  frame(utf8.encode('bs/v1/attachment'), utf8.encode(ctx.groupId), utf8.encode(ctx.attachmentId));

/** Returns the blob to upload (`nonce || ciphertext`) and its key (to put in the message). */
export function encryptAttachment(plaintext: Uint8Array, ctx: AttachmentContext): { blob: Uint8Array; fileKey: Uint8Array } {
  const fileKey = aead.randomKey();
  return { blob: aead.seal(fileKey, plaintext, attachmentAd(ctx)), fileKey };
}

export function decryptAttachment(blob: Uint8Array, fileKey: Uint8Array, ctx: AttachmentContext): Uint8Array {
  if (blob.length < aead.NONCE_BYTES) throw new CryptoError('DECRYPT_FAILED');
  return aead.open(fileKey, blob, attachmentAd(ctx));
}

// ---- Message bodies ----------------------------------------------------------

/*
 * The plaintext of a message is either plain text (every plain message, and
 * all messages sent before attachments existed) or a NUL byte followed by
 * JSON: an image, a voice message, or a text that replies to another message. The composer
 * never produces a leading NUL, so the two cannot be confused.
 */

/**
 * The message being answered, quoted inside the (encrypted, signed) reply.
 * The excerpt is what the replier saw; when the original is still loaded,
 * the app shows the original instead, so a member cannot misquote someone.
 */
export interface ReplyRef {
  messageId: string; // server id of the original
  senderId: string;
  excerpt: string; // up to MAX_EXCERPT chars; empty for an image or a voice message
  image?: true;
  voice?: true;
}

export interface ImageBody {
  kind: 'image';
  attachmentId: string;
  fileKey: string; // base64url, 32 bytes
  mime: 'image/jpeg';
  width: number;
  height: number;
  size: number; // encrypted blob size, shown before downloading
  preview?: string; // tiny JPEG (base64url) shown blurred until the full image is loaded
  replyTo?: ReplyRef;
}

/** Recorded on the phone (AAC in an MP4 container), encrypted like an image. */
export interface VoiceBody {
  kind: 'voice';
  attachmentId: string;
  fileKey: string; // base64url, 32 bytes
  mime: 'audio/mp4';
  durationMs: number;
  size: number; // encrypted blob size
  /** Loudness along the recording, 0–100, at most MAX_WAVEFORM bars: drawn before downloading. */
  waveform?: number[];
  replyTo?: ReplyRef;
}

export interface TextBody {
  kind: 'text';
  text: string;
  replyTo?: ReplyRef;
}

export type MessageBody = TextBody | ImageBody | VoiceBody;

export const MAX_EXCERPT = 140;
export const MAX_VOICE_MS = 5 * 60 * 1000;
export const MAX_WAVEFORM = 64;
const STRUCTURED_PREFIX = '\u0000';
const MAX_PREVIEW_CHARS = 8 * 1024;
const MAX_TEXT = 4000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The excerpt to quote for a message: its text cut to MAX_EXCERPT, empty for an image or a voice message. */
export function replyExcerpt(body: MessageBody): Pick<ReplyRef, 'excerpt' | 'image' | 'voice'> {
  if (body.kind === 'image') return { excerpt: '', image: true };
  if (body.kind === 'voice') return { excerpt: '', voice: true };
  const flat = body.text.replace(/\s+/g, ' ').trim();
  return { excerpt: flat.length > MAX_EXCERPT ? flat.slice(0, MAX_EXCERPT - 1) + '…' : flat };
}

export function encodeMessageBody(body: MessageBody): string {
  if (body.kind === 'text') {
    if (body.text.startsWith(STRUCTURED_PREFIX)) throw new CryptoError('INVALID_INPUT');
    if (!body.replyTo) return body.text;
    return STRUCTURED_PREFIX + JSON.stringify({ kind: 'text', text: body.text, replyTo: body.replyTo });
  }
  if (body.kind === 'voice') {
    const { kind, attachmentId, fileKey, mime, durationMs, size, waveform, replyTo } = body;
    return STRUCTURED_PREFIX + JSON.stringify({ kind, attachmentId, fileKey, mime, durationMs, size, waveform, replyTo });
  }
  const { kind, attachmentId, fileKey, mime, width, height, size, preview, replyTo } = body;
  return STRUCTURED_PREFIX + JSON.stringify({ kind, attachmentId, fileKey, mime, width, height, size, preview, replyTo });
}

function parseReply(v: unknown): ReplyRef | undefined | null {
  if (v === undefined) return undefined;
  const r = v as Record<string, unknown>;
  if (
    typeof v !== 'object' ||
    v === null ||
    typeof r.messageId !== 'string' ||
    !UUID.test(r.messageId) ||
    typeof r.senderId !== 'string' ||
    !UUID.test(r.senderId) ||
    typeof r.excerpt !== 'string' ||
    r.excerpt.length > MAX_EXCERPT ||
    (r.image !== undefined && r.image !== true) ||
    (r.voice !== undefined && r.voice !== true)
  ) {
    return null;
  }
  return {
    messageId: r.messageId,
    senderId: r.senderId,
    excerpt: r.excerpt,
    ...(r.image === true && { image: true as const }),
    ...(r.voice === true && { voice: true as const }),
  };
}

/** Never throws: a malformed body (from a buggy or hostile member) reads as null. */
export function parseMessageBody(plaintext: string): MessageBody | null {
  if (!plaintext.startsWith(STRUCTURED_PREFIX)) return { kind: 'text', text: plaintext };
  try {
    const v = JSON.parse(plaintext.slice(STRUCTURED_PREFIX.length)) as Record<string, unknown>;
    const replyTo = parseReply(v.replyTo);
    if (replyTo === null) return null;
    const reply = replyTo ? { replyTo } : {};
    if (v.kind === 'text') {
      if (typeof v.text !== 'string' || v.text.length === 0 || v.text.length > MAX_TEXT || !replyTo) return null;
      return { kind: 'text', text: v.text, ...reply };
    }
    const fileOk = (v: Record<string, unknown>) =>
      typeof v.attachmentId === 'string' &&
      UUID.test(v.attachmentId) &&
      typeof v.fileKey === 'string' &&
      attempt('INVALID_INPUT', () => b64.decode(v.fileKey as string)).length === aead.KEY_BYTES &&
      typeof v.size === 'number' &&
      Number.isInteger(v.size) &&
      v.size > 0 &&
      v.size <= MAX_ATTACHMENT_BYTES;
    if (v.kind === 'voice') {
      const level = (n: unknown) => typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= 100;
      if (
        !fileOk(v) ||
        v.mime !== 'audio/mp4' ||
        typeof v.durationMs !== 'number' ||
        !Number.isInteger(v.durationMs) ||
        v.durationMs <= 0 ||
        v.durationMs > MAX_VOICE_MS + 5_000 || // the recorder may overshoot the limit slightly
        (v.waveform !== undefined && (!Array.isArray(v.waveform) || v.waveform.length > MAX_WAVEFORM || !v.waveform.every(level)))
      ) {
        return null;
      }
      return {
        kind: 'voice',
        attachmentId: v.attachmentId as string,
        fileKey: v.fileKey as string,
        mime: 'audio/mp4',
        durationMs: v.durationMs,
        size: v.size as number,
        ...(v.waveform !== undefined && { waveform: [...(v.waveform as number[])] }),
        ...reply,
      };
    }
    const dim = (n: unknown) => typeof n === 'number' && Number.isInteger(n) && n > 0 && n <= 20_000;
    if (
      v.kind !== 'image' ||
      !fileOk(v) ||
      v.mime !== 'image/jpeg' ||
      !dim(v.width) ||
      !dim(v.height) ||
      (v.preview !== undefined && (typeof v.preview !== 'string' || v.preview.length > MAX_PREVIEW_CHARS))
    ) {
      return null;
    }
    return {
      kind: 'image',
      attachmentId: v.attachmentId as string,
      fileKey: v.fileKey as string,
      mime: 'image/jpeg',
      width: v.width as number,
      height: v.height as number,
      size: v.size as number,
      ...(v.preview !== undefined && { preview: v.preview as string }),
      ...reply,
    };
  } catch {
    return null;
  }
}
