import { generateMasterKey } from '@/crypto';
import { initCrypto } from '@/crypto/sodium';
import { nodeSqlite } from '../../../test-support/nodeSqlite';
import type { WireMessage } from '../api';
import { LocalStore, LocalStoreClosedError, MAX_BLOBS, records } from '../localStore';
import { loadOutbox, saveOutbox, type Pending } from '../outbox';

beforeAll(() => initCrypto());

const G1 = '6f1c2a8e-0000-4000-8000-000000000001';
const G2 = '6f1c2a8e-0000-4000-8000-000000000002';

function wire(groupId: string, seq: number, extra: Partial<WireMessage> = {}): WireMessage {
  return {
    id: `m-${groupId}-${seq}`,
    seq,
    clientId: `c-${seq}`,
    groupId,
    senderId: 'sender-alice',
    keyVersion: 1,
    nonce: 'NONCE',
    ciphertext: `CIPHERTEXT${seq}`,
    signature: 'SIG',
    createdAt: '2026-10-19T10:00:00.000Z',
    expiresAt: null,
    ...extra,
  };
}

/** Every value stored in the file, as one string. */
function dump(db: ReturnType<typeof nodeSqlite>): string {
  const rows = [
    ...db.raw.prepare('SELECT gid, seq, body FROM messages').all(),
    ...db.raw.prepare('SELECT k, body FROM records').all(),
  ];
  return JSON.stringify(rows);
}

describe('local store (SPEC §5.2)', () => {
  it('keeps messages and gives them back in order', async () => {
    const store = await LocalStore.open(nodeSqlite(), generateMasterKey());
    await store.saveMessages(G1, [wire(G1, 3), wire(G1, 1)]);
    await store.saveMessages(G1, [wire(G1, 2), wire(G1, 3)]); // duplicates are fine
    await store.saveMessages(G2, [wire(G2, 1)]);
    expect((await store.messages(G1)).map((m) => m.seq)).toEqual([1, 2, 3]);
    expect(await store.messages(G2)).toEqual([wire(G2, 1)]);
  });

  it('shows nothing in clear: no content, sender, group id or record name', async () => {
    const db = nodeSqlite();
    const store = await LocalStore.open(db, generateMasterKey());
    await store.saveMessages(G1, [wire(G1, 1)]);
    await store.setRecord(records.group(G1), { encryptedMeta: 'META' });
    const all = dump(db);
    for (const clear of ['CIPHERTEXT', 'sender-alice', G1, 'META', 'group/']) expect(all).not.toContain(clear);
  });

  it('needs the same master key to read back', async () => {
    const db = nodeSqlite();
    const store = await LocalStore.open(db, generateMasterKey());
    await store.saveMessages(G1, [wire(G1, 1)]);
    await store.setRecord(records.profiles, { a: 1 });
    // Another master key: the blinded group id differs and the rows do not open.
    const other = await LocalStore.open(db, generateMasterKey());
    expect(await other.messages(G1)).toEqual([]);
    expect(await other.getRecord(records.profiles)).toBeNull();
  });

  it('drops a row moved to another seq or group', async () => {
    const db = nodeSqlite();
    const store = await LocalStore.open(db, generateMasterKey());
    await store.saveMessages(G1, [wire(G1, 1), wire(G1, 2)]);
    db.raw.exec('UPDATE messages SET seq = 9 WHERE seq = 2');
    expect((await store.messages(G1)).map((m) => m.seq)).toEqual([1]);
    expect(db.raw.prepare('SELECT COUNT(*) AS n FROM messages').get()).toEqual(expect.objectContaining({ n: 1 }));
  });

  it('deletes disappearing messages past their date', async () => {
    let now = Date.parse('2026-10-19T12:00:00Z');
    const db = nodeSqlite();
    const masterKey = generateMasterKey();
    const store = await LocalStore.open(db, masterKey, () => now);
    await store.saveMessages(G1, [
      wire(G1, 1, { expiresAt: '2026-10-19T13:00:00Z' }),
      wire(G1, 2, { expiresAt: '2026-10-20T13:00:00Z' }),
      wire(G1, 3),
    ]);
    now = Date.parse('2026-10-19T14:00:00Z');
    expect((await store.messages(G1)).map((m) => m.seq)).toEqual([2, 3]);

    // Also at the next unlock, without opening the group.
    now = Date.parse('2026-10-21T00:00:00Z');
    await LocalStore.open(db, masterKey, () => now);
    expect(db.raw.prepare('SELECT COUNT(*) AS n FROM messages').get()).toEqual(expect.objectContaining({ n: 1 }));
  });

  it('replaces the history after an erase, and forgets a group', async () => {
    const store = await LocalStore.open(nodeSqlite(), generateMasterKey());
    await store.saveMessages(G1, [wire(G1, 1), wire(G1, 2), wire(G1, 3)]);
    await store.saveMessages(G2, [wire(G2, 1)]);
    await store.replaceMessages(G1, [wire(G1, 3)]);
    expect((await store.messages(G1)).map((m) => m.seq)).toEqual([3]);

    await store.setRecord(records.group(G1), { id: G1 });
    await store.setRecord(records.chat(G1), { purgeSeq: 2 });
    await store.setRecord(records.seen(G1), { seq: 3, at: 1 });
    await store.forgetGroup(G1);
    expect(await store.messages(G1)).toEqual([]);
    expect(await store.getRecord(records.group(G1))).toBeNull();
    expect(await store.getRecord(records.chat(G1))).toBeNull();
    expect(await store.getRecord(records.seen(G1))).toBeNull();
    expect(await store.messages(G2)).toHaveLength(1);
  });

  it('refuses any use once closed (locked app)', async () => {
    const store = await LocalStore.open(nodeSqlite(), generateMasterKey());
    await store.close();
    await expect(store.saveMessages(G1, [wire(G1, 1)])).rejects.toBeInstanceOf(LocalStoreClosedError);
    await expect(store.getRecord(records.profiles)).rejects.toBeInstanceOf(LocalStoreClosedError);
  });
});

describe('image blobs kept for offline viewing', () => {
  function memoryFiles() {
    const files = new Map<string, Uint8Array>();
    return {
      files,
      read: async (n: string) => files.get(n) ?? null,
      write: async (n: string, b: Uint8Array) => void files.set(n, b),
      remove: async (n: string) => void files.delete(n),
    };
  }

  it('keeps a blob under a hashed name and gives it back', async () => {
    const fs = memoryFiles();
    const store = await LocalStore.open(nodeSqlite(), generateMasterKey(), Date.now, fs);
    const blob = new Uint8Array([1, 2, 3]);
    await store.saveBlob(G1, 'att-1', blob);
    expect(await store.blob('att-1')).toEqual(blob);
    expect(await store.blob('att-2')).toBeNull();
    expect([...fs.files.keys()].join()).not.toContain('att-1');
  });

  it('forgetting a group deletes its blobs, and only those', async () => {
    const fs = memoryFiles();
    const store = await LocalStore.open(nodeSqlite(), generateMasterKey(), Date.now, fs);
    await store.saveBlob(G1, 'a', new Uint8Array([1]));
    await store.saveBlob(G2, 'b', new Uint8Array([2]));
    await store.forgetGroup(G1);
    expect(await store.blob('a')).toBeNull();
    expect(await store.blob('b')).toEqual(new Uint8Array([2]));
    expect(fs.files.size).toBe(1);
  });

  it('keeps only the newest MAX_BLOBS', async () => {
    const fs = memoryFiles();
    const store = await LocalStore.open(nodeSqlite(), generateMasterKey(), Date.now, fs);
    for (let i = 0; i < MAX_BLOBS + 2; i++) await store.saveBlob(G1, `img-${i}`, new Uint8Array([i % 256]));
    expect(fs.files.size).toBe(MAX_BLOBS);
    expect(await store.blob('img-0')).toBeNull();
    expect(await store.blob('img-1')).toBeNull();
    expect(await store.blob(`img-${MAX_BLOBS + 1}`)).not.toBeNull();
  });

  it('a damaged blob can be dropped; no files means nothing kept', async () => {
    const fs = memoryFiles();
    const store = await LocalStore.open(nodeSqlite(), generateMasterKey(), Date.now, fs);
    await store.saveBlob(G1, 'a', new Uint8Array([1]));
    await store.dropBlob('a');
    expect(await store.blob('a')).toBeNull();
    expect(fs.files.size).toBe(0);

    const none = await LocalStore.open(nodeSqlite(), generateMasterKey());
    await none.saveBlob(G1, 'a', new Uint8Array([1]));
    expect(await none.blob('a')).toBeNull();
  });
});

describe('outbox (messages waiting to be sent)', () => {
  it('survives a restart, image and voice bytes included', async () => {
    const db = nodeSqlite();
    const masterKey = generateMasterKey();
    const store = await LocalStore.open(db, masterKey);
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3]);
    const items: Pending[] = [
      { clientId: 'c1', at: '2026-10-19T10:00:00Z', failed: false, kind: 'text', text: 'Rendez-vous à 20 h' },
      { clientId: 'c2', at: '2026-10-19T10:01:00Z', failed: true, kind: 'image', image: { jpeg, width: 4, height: 3, preview: 'abc' } },
      { clientId: 'c3', at: '2026-10-19T10:02:00Z', failed: false, kind: 'voice', voice: { audio: new Uint8Array([9, 8, 7]), durationMs: 1500, waveform: [1, 2] } },
    ];
    await saveOutbox(store, G1, items);
    expect(dump(db)).not.toContain('Rendez-vous');

    const reopened = await LocalStore.open(db, masterKey);
    expect(await loadOutbox(reopened, G1)).toEqual(items);
    expect(await loadOutbox(reopened, G2)).toEqual([]);

    await reopened.forgetGroup(G1);
    expect(await loadOutbox(reopened, G1)).toEqual([]);
  });
});
