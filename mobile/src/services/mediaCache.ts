import { File } from 'expo-file-system';
import { wipe } from '@/crypto/encoding';

/**
 * A small in-memory cache of decrypted media (images, voice), by attachment
 * id, kept only for this session. The newest `max` are held (Map insertion
 * order); the oldest fall off without being wiped (a bubble on screen may
 * still show them). `clear()` (on lock) wipes every value in memory.
 */
export function createBlobCache(max: number) {
  const cache = new Map<string, Uint8Array>();
  return {
    get: (id: string) => cache.get(id),
    set(id: string, bytes: Uint8Array) {
      cache.delete(id);
      cache.set(id, bytes);
      for (const old of cache.keys()) {
        if (cache.size <= max) break;
        cache.delete(old);
      }
    },
    clear() {
      for (const bytes of cache.values()) wipe(bytes);
      cache.clear();
    },
  };
}

/** Deletes a file if it is there, swallowing the error if it is already gone. */
export function deleteQuietly(uri: string) {
  try {
    const f = new File(uri);
    if (f.exists) f.delete();
  } catch {
    // already gone
  }
}
