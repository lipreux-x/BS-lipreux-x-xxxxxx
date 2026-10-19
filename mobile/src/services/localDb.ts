import { Directory, File, Paths } from 'expo-file-system';
import * as SQLite from 'expo-sqlite';
import { LocalStore, type BlobFiles, type SqlDb } from './localStore';

// expo-sqlite (in Expo Go too). Rows are sealed by LocalStore, not by SQLCipher.
const NAME = 'bs-local.db';
// Encrypted image blobs, one file each (names are keyed hashes).
const blobDir = () => new Directory(Paths.document, 'bs-blobs');

const blobFiles: BlobFiles = {
  async read(name) {
    const f = new File(blobDir(), name);
    return f.exists ? f.bytes() : null;
  },
  async write(name, bytes) {
    const dir = blobDir();
    if (!dir.exists) dir.create({ intermediates: true });
    const f = new File(dir, name);
    if (!f.exists) f.create();
    await f.write(bytes);
  },
  async remove(name) {
    const f = new File(blobDir(), name);
    if (f.exists) f.delete();
  },
};

export async function openLocalStore(masterKey: Uint8Array): Promise<LocalStore> {
  const db = await SQLite.openDatabaseAsync(NAME, { useNewConnection: true });
  return LocalStore.open(db as unknown as SqlDb, masterKey, Date.now, blobFiles);
}

/** Deletes the file and the image blobs (wipe, or no account on this phone). The store must be closed. */
export async function deleteLocalDb() {
  try {
    await SQLite.deleteDatabaseAsync(NAME);
  } catch {
    // no file yet
  }
  try {
    const dir = blobDir();
    if (dir.exists) dir.delete();
  } catch {
    // nothing to delete
  }
}
