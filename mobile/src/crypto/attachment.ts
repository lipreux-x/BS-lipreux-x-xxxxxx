import * as aead from './aead';
import { b64, frame, utf8 } from './encoding';
import { attempt, CryptoError } from './errors';

/*
 * Attachments (images) — SPEC §4.3.
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
 * The plaintext of a message is either plain text (every message sent before
 * attachments existed) or, for an image, a NUL byte followed by JSON. The
 * composer never produces a leading NUL, so the two cannot be confused.
 */

export interface ImageBody {
  kind: 'image';
  attachmentId: string;
  fileKey: string; // base64url, 32 bytes
  mime: 'image/jpeg';
  width: number;
  height: number;
  size: number; // encrypted blob size, shown before downloading
  preview?: string; // tiny JPEG (base64url) shown blurred until the full image is loaded
}

export type MessageBody = { kind: 'text'; text: string } | ImageBody;

const IMAGE_PREFIX = '\u0000';
const MAX_PREVIEW_CHARS = 8 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function encodeMessageBody(body: MessageBody): string {
  if (body.kind === 'text') {
    if (body.text.startsWith(IMAGE_PREFIX)) throw new CryptoError('INVALID_INPUT');
    return body.text;
  }
  const { kind, attachmentId, fileKey, mime, width, height, size, preview } = body;
  return IMAGE_PREFIX + JSON.stringify({ kind, attachmentId, fileKey, mime, width, height, size, preview });
}

/** Never throws: a malformed image body (from a buggy or hostile member) reads as null. */
export function parseMessageBody(plaintext: string): MessageBody | null {
  if (!plaintext.startsWith(IMAGE_PREFIX)) return { kind: 'text', text: plaintext };
  try {
    const v = JSON.parse(plaintext.slice(IMAGE_PREFIX.length)) as Record<string, unknown>;
    const dim = (n: unknown) => typeof n === 'number' && Number.isInteger(n) && n > 0 && n <= 20_000;
    if (
      v.kind !== 'image' ||
      typeof v.attachmentId !== 'string' ||
      !UUID.test(v.attachmentId) ||
      typeof v.fileKey !== 'string' ||
      attempt('INVALID_INPUT', () => b64.decode(v.fileKey as string)).length !== aead.KEY_BYTES ||
      v.mime !== 'image/jpeg' ||
      !dim(v.width) ||
      !dim(v.height) ||
      typeof v.size !== 'number' ||
      !Number.isInteger(v.size) ||
      v.size <= 0 ||
      v.size > MAX_ATTACHMENT_BYTES ||
      (v.preview !== undefined && (typeof v.preview !== 'string' || v.preview.length > MAX_PREVIEW_CHARS))
    ) {
      return null;
    }
    return {
      kind: 'image',
      attachmentId: v.attachmentId,
      fileKey: v.fileKey,
      mime: 'image/jpeg',
      width: v.width as number,
      height: v.height as number,
      size: v.size,
      ...(v.preview !== undefined && { preview: v.preview as string }),
    };
  } catch {
    return null;
  }
}
