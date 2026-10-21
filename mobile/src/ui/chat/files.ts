import { MAX_FILE_NAME } from '@/crypto';

/*
 * Documents in the chat, independent of React: how a size reads, under what
 * name a file is sent and written back, what its badge says. Pure functions,
 * unit-tested.
 */

/** "830 o", "12 Ko", "1,2 Mo": the size shown on a document. */
export function fileSizeLabel(bytes: number): string {
  if (bytes < 1000) return `${bytes} o`;
  if (bytes < 1_000_000) return `${Math.round(bytes / 1000)} Ko`;
  const mb = bytes / 1_000_000;
  return `${(mb < 10 ? mb.toFixed(1) : String(Math.round(mb))).replace('.', ',')} Mo`;
}

/**
 * The name a document travels (and is written back) under: no path, no
 * control characters, at most MAX_FILE_NAME characters with its extension
 * kept, "document" when nothing readable is left.
 */
export function safeFileName(name: string): string {
  const clean = name.replace(/[\\/\u0000-\u001f\u007f]/g, '').trim();
  if (!clean || clean === '.' || clean === '..') return 'document';
  if (clean.length <= MAX_FILE_NAME) return clean;
  const ext = fileExt(clean);
  const tail = ext ? `.${ext.toLowerCase()}` : '';
  return clean.slice(0, MAX_FILE_NAME - tail.length).trimEnd() + tail;
}

/** The extension, in upper case ("PDF"), for the badge; empty without one (or with a silly one). */
export function fileExt(name: string): string {
  const m = /\.([a-z0-9]{1,5})$/i.exec(name);
  return m && m.index > 0 ? m[1]!.toUpperCase() : '';
}
