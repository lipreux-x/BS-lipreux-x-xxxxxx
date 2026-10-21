import { blindLocalId, deriveLocalDbKey, openLocal, sealLocal } from '@/crypto';
import { wipe } from '@/crypto/encoding';
import type { WireMessage } from './api';

/*
 * What the phone keeps to work without network (SPEC §5.2), in a SQLite file.
 *
 * Every row is sealed (XChaCha20-Poly1305) with a key derived from the master
 * key, so the file is unreadable without the app code + device secret. Group
 * ids are keyed hashes: the file does not show which groups the phone is in.
 *
 * Messages are stored as the server sent them, still encrypted and signed
 * with the group key. Reading them back needs the group key too, so a group
 * still needs its code to be read offline, exactly as online. A row is only
 * accepted under the group and seq sealed inside it, so rows cannot be
 * swapped around.
 *
 * Records keep the rest of what an offline unlock needs: the last group
 * summaries (sealed group keys, encrypted meta) and the members' profiles
 * (names, public keys to check signatures), plus the contacts verified with
 * their safety number and the messages waiting to be sent (outbox).
 *
 * Images: the encrypted blob, as downloaded from (or uploaded to) the server,
 * is kept in a file named by a keyed hash. Its file key only exists inside
 * the image's message, so the file alone reveals nothing the server does not
 * already hold. The newest MAX_BLOBS are kept; older ones download again.
 */

/** The subset of expo-sqlite's SQLiteDatabase used here (tests plug in node:sqlite). */
export interface SqlDb {
  execAsync(sql: string): Promise<void>;
  runAsync(sql: string, params: SqlValue[]): Promise<unknown>;
  getAllAsync<T>(sql: string, params: SqlValue[]): Promise<T[]>;
  closeAsync(): Promise<void>;
}
export type SqlValue = string | number | null;

/** Files for the encrypted image blobs (expo-file-system on the phone, memory in tests). */
export interface BlobFiles {
  read(name: string): Promise<Uint8Array | null>;
  write(name: string, bytes: Uint8Array): Promise<void>;
  remove(name: string): Promise<void>;
}

export const MAX_BLOBS = 300;

export class LocalStoreClosedError extends Error {
  constructor() {
    super('local_store_closed');
    this.name = 'LocalStoreClosedError';
  }
}

const SCHEMA = `
  PRAGMA journal_mode = WAL;
  PRAGMA secure_delete = ON;
  CREATE TABLE IF NOT EXISTS messages (gid TEXT NOT NULL, seq INTEGER NOT NULL, body TEXT NOT NULL, PRIMARY KEY (gid, seq));
  CREATE TABLE IF NOT EXISTS records (k TEXT PRIMARY KEY NOT NULL, body TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS blobs (name TEXT PRIMARY KEY NOT NULL, gid TEXT NOT NULL);
`;

export class LocalStore {
  private key: Uint8Array | null;
  private closing: Promise<void> | null = null;

  private constructor(
    private readonly db: SqlDb,
    masterKey: Uint8Array,
    private readonly now: () => number,
    private readonly files: BlobFiles | null,
  ) {
    this.key = deriveLocalDbKey(masterKey);
  }

  /** `files`: where image blobs go; null keeps none (they are then always downloaded). */
  static async open(db: SqlDb, masterKey: Uint8Array, now: () => number = Date.now, files: BlobFiles | null = null): Promise<LocalStore> {
    await db.execAsync(SCHEMA);
    const store = new LocalStore(db, masterKey, now, files);
    await store.pruneExpired();
    return store;
  }

  /** At lock: the key leaves memory; any later call throws instead of sealing with a wiped key. */
  close(): Promise<void> {
    if (!this.closing) {
      wipe(this.key!);
      this.key = null;
      this.closing = this.db.closeAsync();
    }
    return this.closing;
  }

  // ---- messages ------------------------------------------------------------------

  /** Adds or updates messages (de-duplicated by group and seq). */
  async saveMessages(groupId: string, wire: WireMessage[]) {
    const key = this.k();
    const gid = blindLocalId(groupId, key);
    for (const m of wire) {
      if (m.groupId !== groupId) continue;
      await this.db.runAsync('INSERT OR REPLACE INTO messages (gid, seq, body) VALUES (?, ?, ?)', [
        gid,
        m.seq,
        sealLocal(m, MSG_LABEL, key),
      ]);
    }
  }

  /** After an erase: the history fetched again replaces what the phone had. */
  async replaceMessages(groupId: string, wire: WireMessage[]) {
    await this.db.runAsync('DELETE FROM messages WHERE gid = ?', [blindLocalId(groupId, this.k())]);
    await this.saveMessages(groupId, wire);
  }

  /** The group's messages, oldest first. Expired ones (disappearing messages) are deleted, not returned. */
  async messages(groupId: string): Promise<WireMessage[]> {
    const key = this.k();
    const gid = blindLocalId(groupId, key);
    const rows = await this.db.getAllAsync<{ seq: number; body: string }>('SELECT seq, body FROM messages WHERE gid = ? ORDER BY seq', [gid]);
    const out: WireMessage[] = [];
    for (const r of rows) {
      const m = this.openRow(gid, r.seq, r.body);
      if (m && !this.expired(m)) out.push(m);
      else await this.db.runAsync('DELETE FROM messages WHERE gid = ? AND seq = ?', [gid, r.seq]);
    }
    return out;
  }

  /** The group's messages, images and records: left, removed or self-destructed. */
  async forgetGroup(groupId: string) {
    const key = this.k();
    const gid = blindLocalId(groupId, key);
    await this.db.runAsync('DELETE FROM messages WHERE gid = ?', [gid]);
    for (const name of [records.group(groupId), records.chat(groupId), records.outbox(groupId), records.stories(groupId)]) {
      await this.db.runAsync('DELETE FROM records WHERE k = ?', [blindLocalId(name, key)]);
    }
    const blobs = await this.db.getAllAsync<{ name: string }>('SELECT name FROM blobs WHERE gid = ?', [gid]);
    for (const b of blobs) await this.removeBlob(b.name);
  }

  // ---- image blobs ---------------------------------------------------------------

  /** Keeps an image's encrypted blob (as on the server) for offline viewing. */
  async saveBlob(groupId: string, attachmentId: string, blob: Uint8Array) {
    if (!this.files) return;
    const key = this.k();
    const name = blobName(attachmentId, key);
    await this.files.write(name, blob);
    // REPLACE gives the row a new rowid: rowid order is the order of use, no date stored.
    await this.db.runAsync('INSERT OR REPLACE INTO blobs (name, gid) VALUES (?, ?)', [name, blindLocalId(groupId, key)]);
    const old = await this.db.getAllAsync<{ name: string }>('SELECT name FROM blobs ORDER BY rowid DESC LIMIT -1 OFFSET ?', [MAX_BLOBS]);
    for (const o of old) await this.removeBlob(o.name);
  }

  /** The encrypted blob kept for this image, or null. */
  async blob(attachmentId: string): Promise<Uint8Array | null> {
    if (!this.files) return null;
    const name = blobName(attachmentId, this.k());
    const rows = await this.db.getAllAsync<{ name: string }>('SELECT name FROM blobs WHERE name = ?', [name]);
    if (!rows.length) return null;
    const bytes = await this.files.read(name);
    if (!bytes) await this.db.runAsync('DELETE FROM blobs WHERE name = ?', [name]);
    return bytes;
  }

  /** A kept blob that no longer decrypts: dropped, downloaded again next time. */
  async dropBlob(attachmentId: string) {
    if (this.files) await this.removeBlob(blobName(attachmentId, this.k()));
  }

  /**
   * Deletes disappearing messages past their date. Expiry dates are inside
   * the sealed rows (not in a clear column), so every row is opened: fine for
   * a chat history, and it runs once per unlock.
   */
  async pruneExpired() {
    const rows = await this.db.getAllAsync<{ gid: string; seq: number; body: string }>('SELECT gid, seq, body FROM messages', []);
    for (const r of rows) {
      const m = this.openRow(r.gid, r.seq, r.body);
      if (!m || this.expired(m)) await this.db.runAsync('DELETE FROM messages WHERE gid = ? AND seq = ?', [r.gid, r.seq]);
    }
  }

  // ---- records -------------------------------------------------------------------

  async getRecord<T>(name: string): Promise<T | null> {
    const key = this.k();
    const rows = await this.db.getAllAsync<{ body: string }>('SELECT body FROM records WHERE k = ?', [blindLocalId(name, key)]);
    if (!rows[0]) return null;
    try {
      return openLocal<T>(rows[0].body, `record/${name}`, key);
    } catch {
      return null;
    }
  }

  async setRecord(name: string, value: unknown) {
    const key = this.k();
    await this.db.runAsync('INSERT OR REPLACE INTO records (k, body) VALUES (?, ?)', [
      blindLocalId(name, key),
      sealLocal(value, `record/${name}`, key),
    ]);
  }

  // ---- internals -----------------------------------------------------------------

  private async removeBlob(name: string) {
    await this.files?.remove(name);
    await this.db.runAsync('DELETE FROM blobs WHERE name = ?', [name]);
  }

  private k(): Uint8Array {
    if (!this.key) throw new LocalStoreClosedError();
    return this.key;
  }

  /** Null if the row does not open, or was not sealed for this place (group, seq). */
  private openRow(gid: string, seq: number, body: string): WireMessage | null {
    const key = this.k();
    try {
      const m = openLocal<WireMessage>(body, MSG_LABEL, key);
      return blindLocalId(m.groupId, key) === gid && m.seq === seq ? m : null;
    } catch {
      return null;
    }
  }

  private expired(m: WireMessage): boolean {
    return m.expiresAt !== null && Date.parse(m.expiresAt) <= this.now();
  }
}

const MSG_LABEL = 'msg';
const blobName = (attachmentId: string, key: Uint8Array) => blindLocalId(`blob/${attachmentId}`, key);

/** Record names (hashed in the file, like group ids). */
export const records = {
  /** Server ids of our groups, in the order of the last list. */
  groups: 'groups',
  /** Last GroupSummary from the server. */
  group: (id: string) => `group/${id}`,
  /** Chat state: latest erase seen ({ purgeSeq }). */
  chat: (id: string) => `chat/${id}`,
  /** Stories already watched in a group: { seen: message ids } (ui/stories). */
  stories: (id: string) => `stories/${id}`,
  /** Messages written but not sent yet (services/outbox.ts). */
  outbox: (id: string) => `outbox/${id}`,
  /** Profiles of people met in groups, by user id. */
  profiles: 'profiles',
  /** Contacts checked in person: user id -> public keys at the time. */
  verified: 'verified',
};
