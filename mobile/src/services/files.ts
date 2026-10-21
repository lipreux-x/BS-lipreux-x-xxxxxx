import * as DocumentPicker from 'expo-document-picker';
import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { MAX_ATTACHMENT_BYTES } from '@/crypto';
import { whileSystemUi } from '@/session/autoLock';
import { safeFileName } from '@/ui/chat/files';
import type { PreparedFile } from './groups';

/*
 * Documents (a PDF, anything): picked with the system's picker, sent as they
 * are, encrypted like an image (services/groups.ts uploadDocument). To be
 * read, a document has to leave the app: it is decrypted into the app's
 * cache and handed to the system share sheet (a viewer, a save). That copy
 * is the only plaintext one; it is deleted before the next document is
 * handed out, at lock (dropOpenedDocuments) and at launch (services/sweep.ts).
 */

/** Room for the nonce and the tag of the encrypted blob (crypto/attachment.ts). */
const MAX_FILE_BYTES = MAX_ATTACHMENT_BYTES - 40;
const OPEN_DIR = () => new Directory(Paths.cache, 'files');

export class FileTooLargeError extends Error {
  constructor() {
    super('file_too_large');
    this.name = 'FileTooLargeError';
  }
}

/**
 * The system's document picker. null if the user backed out; throws
 * FileTooLargeError above the attachment limit. The picker's copy in the
 * cache is deleted once read.
 */
export async function pickDocument(): Promise<PreparedFile | null> {
  const res = await whileSystemUi(() => DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true, multiple: false }));
  const asset = res.canceled ? undefined : res.assets?.[0];
  if (!asset) return null;
  const file = new File(asset.uri);
  try {
    if ((asset.size ?? 0) > MAX_FILE_BYTES) throw new FileTooLargeError();
    const bytes = await file.bytes();
    if (bytes.length > MAX_FILE_BYTES) throw new FileTooLargeError();
    return { bytes, name: safeFileName(asset.name), mime: asset.mimeType || 'application/octet-stream' };
  } finally {
    try {
      file.delete();
    } catch {
      // the picker's copy stays in the cache: swept at the next launch
    }
  }
}

/**
 * Hands a decrypted document to another app through the share sheet (a
 * viewer, "save to…"). Written in clear in the app's cache first, under its
 * own name so the other app sees it; see the note at the top.
 */
export async function openDocument(bytes: Uint8Array, name: string, mime: string): Promise<void> {
  dropOpenedDocuments();
  const dir = OPEN_DIR();
  dir.create();
  const file = new File(dir, safeFileName(name));
  file.writeSync(bytes);
  await whileSystemUi(() => Sharing.shareAsync(file.uri, { mimeType: mime, dialogTitle: name }));
}

/** Deletes the document last handed out, if any (lock, next opening). */
export function dropOpenedDocuments(): void {
  try {
    const dir = OPEN_DIR();
    if (dir.exists) dir.delete();
  } catch {
    // in use by the other app: swept at the next launch
  }
}
