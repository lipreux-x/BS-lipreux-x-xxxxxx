import {
  b64,
  decryptAttachment,
  encodeMessageBody,
  encryptAttachment,
  encryptMessage,
  MAX_ATTACHMENT_BYTES,
  STORY_TTL_SECONDS,
  type FileBody,
  type ImageBody,
  type ReactionBody,
  type StoryBody,
  type VoiceBody,
} from '@/crypto';
import type { WireMessage } from '../api';
import type { Session } from './core';

/** An image ready to send: re-encoded JPEG (no metadata) and a tiny preview. */
export interface PreparedImage {
  jpeg: Uint8Array;
  width: number;
  height: number;
  preview?: string; // base64url JPEG, a few hundred bytes
}

/** A document picked on the phone, sent as it is. */
export interface PreparedFile {
  bytes: Uint8Array;
  name: string;
  mime: string;
}

/** A recorded voice message ready to send: AAC audio in an MP4 container. */
export interface PreparedVoice {
  audio: Uint8Array;
  durationMs: number;
  waveform?: number[];
}

export class AttachmentTooLargeError extends Error {
  constructor() {
    super('attachment_too_large');
    this.name = 'AttachmentTooLargeError';
  }
}

/** Encrypts a file under a fresh file key and uploads the blob. */
async function uploadFile(s: Session, groupId: string, plaintext: Uint8Array) {
  const size = plaintext.length + 24 + 16; // nonce + Poly1305 tag
  if (size > MAX_ATTACHMENT_BYTES) throw new AttachmentTooLargeError();
  const { id, uploadUrl } = await s.api.createAttachment(groupId, size);
  const { blob, fileKey } = encryptAttachment(plaintext, { groupId, attachmentId: id });
  await s.api.uploadBlob(uploadUrl, blob);
  await s.local.saveBlob(groupId, id, blob).catch(() => {}); // our own file, readable offline
  return { attachmentId: id, fileKey: b64.encode(fileKey), size: blob.length };
}

/**
 * Encrypts the image and uploads it. Returns the message body to send; keep
 * it to retry the send without uploading again.
 */
export async function uploadImage(s: Session, groupId: string, image: PreparedImage): Promise<ImageBody> {
  return {
    kind: 'image',
    ...(await uploadFile(s, groupId, image.jpeg)),
    mime: 'image/jpeg',
    width: image.width,
    height: image.height,
    ...(image.preview && { preview: image.preview }),
  };
}

/** Same for a story: the photo is encrypted and uploaded like an image. */
export async function uploadStory(s: Session, groupId: string, image: PreparedImage): Promise<StoryBody> {
  return {
    kind: 'story',
    ...(await uploadFile(s, groupId, image.jpeg)),
    mime: 'image/jpeg',
    width: image.width,
    height: image.height,
    ...(image.preview && { preview: image.preview }),
  };
}

/** Same for a document: sent as it is, its name and type inside the encrypted message. */
export async function uploadDocument(s: Session, groupId: string, file: PreparedFile): Promise<FileBody> {
  return { kind: 'file', ...(await uploadFile(s, groupId, file.bytes)), mime: file.mime, name: file.name };
}

/** Same for a voice message. */
export async function uploadVoice(s: Session, groupId: string, voice: PreparedVoice): Promise<VoiceBody> {
  return {
    kind: 'voice',
    ...(await uploadFile(s, groupId, voice.audio)),
    mime: 'audio/mp4',
    durationMs: voice.durationMs,
    ...(voice.waveform && { waveform: voice.waveform }),
  };
}

/** A reaction to a message: a quiet message (the server rings nobody for it), never shown as one. */
export async function sendReaction(
  s: Session,
  groupId: string,
  groupKey: Uint8Array,
  keyVersion: number,
  body: ReactionBody,
  clientId: string,
): Promise<WireMessage> {
  const encrypted = encryptMessage(encodeMessageBody(body), { groupId, senderId: s.account.userId, clientId, keyVersion }, groupKey, s.identity);
  return s.api.sendMessage(groupId, { clientId, keyVersion, ...encrypted, quiet: true });
}

/**
 * Sends the message carrying the file key of an uploaded image, voice
 * message or story. A story also tells the server when to delete it (the
 * server only learns that the message lives 24 h, not what it is).
 */
export async function sendAttachment(
  s: Session,
  groupId: string,
  groupKey: Uint8Array,
  keyVersion: number,
  body: ImageBody | VoiceBody | StoryBody | FileBody,
  clientId: string,
): Promise<WireMessage> {
  const encrypted = encryptMessage(encodeMessageBody(body), { groupId, senderId: s.account.userId, clientId, keyVersion }, groupKey, s.identity);
  return s.api.sendMessage(groupId, {
    clientId,
    keyVersion,
    ...encrypted,
    attachmentId: body.attachmentId,
    ...(body.kind === 'story' && { expiresInSeconds: STORY_TTL_SECONDS }),
  });
}

/**
 * Decrypts an image or a voice message: the blob kept on the phone if any,
 * else downloaded (and kept for offline use). Throws CryptoError if the blob
 * was tampered with or swapped.
 */
export async function loadAttachment(s: Session, groupId: string, body: ImageBody | VoiceBody | StoryBody | FileBody): Promise<Uint8Array> {
  const ctx = { groupId, attachmentId: body.attachmentId };
  const fileKey = b64.decode(body.fileKey);
  const kept = await s.local.blob(body.attachmentId).catch(() => null);
  if (kept) {
    try {
      return decryptAttachment(kept, fileKey, ctx);
    } catch {
      await s.local.dropBlob(body.attachmentId).catch(() => {}); // damaged: fetch it again
    }
  }
  const { url } = await s.api.attachmentUrl(groupId, body.attachmentId);
  const blob = await s.api.downloadBlob(url);
  const plain = decryptAttachment(blob, fileKey, ctx);
  await s.local.saveBlob(groupId, body.attachmentId, blob).catch(() => {});
  return plain;
}
