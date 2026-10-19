import { randomUUID } from 'expo-crypto';
import { File, Paths } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { launchImageLibraryAsync } from 'expo-image-picker';
import { Asset, requestPermissionsAsync } from 'expo-media-library';
import { b64 } from '@/crypto';
import { wipe } from '@/crypto/encoding';
import { whileSystemUi } from '@/session/autoLock';
import type { PreparedImage } from './groups';

/*
 * Native side of images: picking, re-encoding, display and saving.
 *
 * - Re-encoding to JPEG drops every piece of metadata (GPS position, device,
 *   date) before encryption: the recipients only get the pixels.
 * - Decrypted images live in memory only (data: URIs), cleared when the app
 *   locks. Nothing readable is written to disk, except the moment the user
 *   explicitly saves an image to the gallery (a temporary file, deleted right
 *   after the gallery copied it).
 */

const MAX_SIDE = 1600;
const QUALITY = 0.7;
const PREVIEW_SIDE = 24;

/** Opens the photo library. Null if the user cancelled. */
export async function pickImage(): Promise<PreparedImage | null> {
  const res = await whileSystemUi(() => launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1, exif: false }));
  const asset = res.canceled ? undefined : res.assets?.[0];
  return asset ? prepareImage(asset.uri, asset.width, asset.height) : null;
}

async function prepareImage(uri: string, width: number, height: number): Promise<PreparedImage> {
  const scale = Math.min(1, MAX_SIDE / Math.max(width, height, 1));
  const full = ImageManipulator.manipulate(uri);
  if (scale < 1) full.resize({ width: Math.round(width * scale), height: Math.round(height * scale) });
  const image = await (await full.renderAsync()).saveAsync({ format: SaveFormat.JPEG, compress: QUALITY, base64: true });

  const small = ImageManipulator.manipulate(uri);
  small.resize(width >= height ? { width: PREVIEW_SIDE, height: null } : { width: null, height: PREVIEW_SIDE });
  const preview = await (await small.renderAsync()).saveAsync({ format: SaveFormat.JPEG, compress: 0.5, base64: true });

  // The manipulator writes its output to the cache, and the picker may have
  // copied the original there too: keep only the bytes in memory.
  for (const out of [image.uri, preview.uri]) deleteQuietly(out);
  if (uri.startsWith(Paths.cache.uri)) deleteQuietly(uri);
  return {
    jpeg: fromStdBase64(image.base64!),
    width: image.width,
    height: image.height,
    preview: preview.base64 ? b64.encode(fromStdBase64(preview.base64)) : undefined,
  };
}

/** Writes the decrypted image to the gallery, through a temporary file deleted afterwards. */
export async function saveToGallery(jpeg: Uint8Array): Promise<'saved' | 'denied'> {
  const { granted } = await whileSystemUi(() => requestPermissionsAsync(true, ['photo']));
  if (!granted) return 'denied';
  const file = new File(Paths.cache, `${randomUUID()}.jpg`);
  try {
    file.create();
    file.writeSync(jpeg);
    await Asset.create(file.uri);
    return 'saved';
  } finally {
    deleteQuietly(file.uri);
  }
}

function deleteQuietly(uri: string) {
  try {
    const f = new File(uri);
    if (f.exists) f.delete();
  } catch {
    // already gone
  }
}

// ---- Display ---------------------------------------------------------------------

/** data: URI for <Image>, from JPEG bytes or a base64url preview. */
export const jpegUri = (jpeg: Uint8Array) => `data:image/jpeg;base64,${toStdBase64(b64.encode(jpeg))}`;
export const previewUri = (preview: string) => `data:image/jpeg;base64,${toStdBase64(preview)}`;

/** Decrypted images of this session, by attachment id. Cleared on lock. */
const cache = new Map<string, Uint8Array>();
const MAX_CACHED = 30;

export const imageCache = {
  get: (id: string) => cache.get(id),
  set(id: string, jpeg: Uint8Array) {
    cache.delete(id);
    cache.set(id, jpeg);
    // Oldest first (Map keeps insertion order). Not wiped: a bubble on screen may still show it.
    for (const old of cache.keys()) {
      if (cache.size <= MAX_CACHED) break;
      cache.delete(old);
    }
  },
  clear() {
    for (const bytes of cache.values()) wipe(bytes);
    cache.clear();
  },
};

// expo-image-manipulator speaks standard base64; the crypto module, base64url.
function toStdBase64(url: string): string {
  const s = url.replace(/-/g, '+').replace(/_/g, '/');
  return s + '='.repeat((4 - (s.length % 4)) % 4);
}

function fromStdBase64(std: string): Uint8Array {
  return b64.decode(std.replace(/^data:[^,]*,/, '').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '').replace(/\s/g, ''));
}
