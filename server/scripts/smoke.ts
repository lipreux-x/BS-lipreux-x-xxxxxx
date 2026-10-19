/*
 * End-to-end smoke test of the API against the dev branch, with two simulated
 * phones (libsodium, same framing and AD labels as mobile/src/crypto).
 *
 *   npx tsx scripts/smoke.ts                 -> in-process (app.fetch), HTTP routes only
 *   BASE_URL=https://... npx tsx scripts/smoke.ts  -> deployed function, plus WebSocket
 *
 * Creates throwaway users/groups prefixed `smoke_` and deletes them at the end.
 * The server cannot read what the phones send (handouts, metas, join keys):
 * random bytes stand in for them; mobile src/services/__tests__/e2e.test.ts
 * runs the real crypto against the API.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import sodium from 'libsodium-wrappers-sumo';

process.loadEnvFile('.env');
const { app } = await import('../src/app');
const { db, pool } = await import('../src/db/client');
const schema = await import('../src/db/schema');
const { frame, generateInviteCode, normalizeInviteCode, sha256Hex, utf8 } = await import('../src/lib/crypto');
const { inArray, like, or } = await import('drizzle-orm');

await sodium.ready;
const BASE_URL = process.env.BASE_URL?.replace(/\/$/, '');
const b64 = (b: Uint8Array) => sodium.to_base64(b);
const u32 = (n: number) => {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n, false);
  return b;
};

async function call(method: string, path: string, opts: { token?: string; json?: unknown } = {}) {
  const init: RequestInit = {
    method,
    headers: {
      ...(opts.json !== undefined && { 'content-type': 'application/json' }),
      ...(opts.token && { authorization: `Bearer ${opts.token}` }),
    },
    body: opts.json !== undefined ? JSON.stringify(opts.json) : undefined,
  };
  const res = BASE_URL ? await fetch(BASE_URL + path, init) : await app.fetch(new Request('http://local' + path, init));
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

function makePhone(name: string) {
  const box = sodium.crypto_box_keypair();
  const sign = sodium.crypto_sign_keypair();
  return { username: `smoke_${name}_${sodium.randombytes_uniform(1e6)}`, box, sign, id: '', token: '' };
}
type Phone = ReturnType<typeof makePhone>;

/** Registration body (keys + proof of possession), without the backup. */
function registration(phone: Phone, inviteCode: string) {
  const proof = sodium.crypto_sign_detached(
    frame(utf8('bs/v1/register'), utf8(normalizeInviteCode(inviteCode)), utf8(phone.username), phone.box.publicKey, phone.sign.publicKey),
    phone.sign.privateKey,
  );
  return { inviteCode, username: phone.username, publicKeyBox: b64(phone.box.publicKey), publicKeySign: b64(phone.sign.publicKey), proof: b64(proof) };
}

async function register(phone: Phone, inviteCode: string, backup: unknown) {
  const r = await call('POST', '/auth/register', { json: { ...registration(phone, inviteCode), backup } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  phone.id = r.body.userId;
  phone.token = r.body.accessToken;
}

const messageAd = (groupId: string, senderId: string, clientId: string, keyVersion: number) =>
  frame(utf8('bs/v1/message'), utf8(groupId), utf8(senderId), utf8(clientId), u32(keyVersion));

const step = (s: string) => console.log(`  ✓ ${s}`);
// The server only ever sees keys derived on the phone (mobile src/crypto/groupSecret.ts):
// random bytes stand in for them, and for handouts and metas (the server cannot read either).
const rand = (n = 32) => b64(sodium.randombytes_buf(n));
const JOIN_KEY = rand();
const BACKUP = () => ({ salt: rand(16), ops: 3, mem: 64 * 1024 * 1024, authKey: rand(), box: rand(200) });
let groupId = '';
let otherGroupId = '';
let tempGroupId = '';

const inviteRow = async () => {
  const code = generateInviteCode();
  await db.insert(schema.invites).values({ codeHash: sha256Hex(normalizeInviteCode(code)), expiresAt: new Date(Date.now() + 60_000) });
  return code;
};
const createGroup = (token: string, id: string, joinKey: string, extra: Record<string, unknown> = {}) =>
  call('POST', '/groups', {
    token,
    json: { id, encryptedMeta: rand(64), metaSignature: rand(64), joinKey, sealedKey: rand(80), keySignature: rand(64), ...extra },
  });

try {
  console.log(`Smoke test against ${BASE_URL ?? 'in-process app'}`);

  // 1. Bootstrap invite + first account (a password backup is required, at full cost)
  const firstInvite = await inviteRow();
  const alice = makePhone('alice');
  const weak = await call('POST', '/auth/register', {
    json: { ...registration(alice, firstInvite), backup: { ...BACKUP(), mem: 4 * 1024 * 1024 } },
  });
  assert.equal(weak.status, 400);
  assert.equal((await call('POST', '/auth/register', { json: { ...registration(alice, firstInvite), backup: undefined } })).status, 400);
  const aliceBackup = BACKUP();
  await register(alice, firstInvite, aliceBackup);
  step('alice registered; a missing or weaker-than-64-MiB backup is refused');
  assert.equal((await call('POST', '/auth/register', { json: { inviteCode: firstInvite, username: 'smoke_reuse', publicKeyBox: b64(alice.box.publicKey), publicKeySign: b64(alice.sign.publicKey), proof: b64(new Uint8Array(64)) } })).status, 400);

  // 2. Challenge login, single use
  const ch = await call('POST', '/auth/challenge', { json: { userId: alice.id } });
  const sig = sodium.crypto_sign_detached(frame(utf8('bs/v1/login'), utf8(ch.body.challenge)), alice.sign.privateKey);
  const forged = sodium.crypto_sign_detached(frame(utf8('bs/v1/login'), utf8(ch.body.challenge)), sodium.crypto_sign_keypair().privateKey);
  assert.equal((await call('POST', '/auth/token', { json: { challenge: ch.body.challenge, signature: b64(forged) } })).status, 401);
  assert.equal((await call('POST', '/auth/token', { json: { challenge: ch.body.challenge, signature: b64(sig) } })).status, 200);
  assert.equal((await call('POST', '/auth/token', { json: { challenge: ch.body.challenge, signature: b64(sig) } })).status, 401);
  step('challenge login works; forged signature and a replayed challenge are rejected');
  assert.equal((await call('GET', '/me')).status, 401);
  step('unauthenticated request rejected');

  // 3. Usernames are unique whatever the case; one invite cannot probe many names
  const upper = makePhone('x');
  upper.username = alice.username.toUpperCase();
  const probe = await inviteRow();
  for (let i = 0; i < 3; i++) {
    const r = await call('POST', '/auth/register', { json: { ...registration(upper, probe), backup: BACKUP() } });
    assert.equal(r.status, 409);
  }
  const fresh = makePhone('fresh');
  assert.equal((await call('POST', '/auth/register', { json: { ...registration(fresh, probe), backup: BACKUP() } })).status, 403);
  step('"ALICE" is taken when "alice" exists; an invite burns after 3 taken usernames');

  // 4. Sign in again with a password: only failures count, 5 per hour
  const params = await call('POST', '/auth/recover/params', { json: { username: alice.username } });
  assert.deepEqual(params.body, { salt: aliceBackup.salt, ops: aliceBackup.ops, mem: aliceBackup.mem });
  const decoy = await call('POST', '/auth/recover/params', { json: { username: 'smoke_nobody' } });
  assert.deepEqual(Object.keys(decoy.body).sort(), ['mem', 'ops', 'salt']);
  assert.equal(decoy.body.mem, 64 * 1024 * 1024);
  assert.deepEqual((await call('POST', '/auth/recover/params', { json: { username: 'smoke_nobody' } })).body, decoy.body);
  const recover = (authKey: string) => call('POST', '/auth/recover', { json: { username: alice.username, authKey } });
  for (let i = 0; i < 3; i++) assert.equal((await recover(aliceBackup.authKey)).status, 200);
  assert.deepEqual((await recover(aliceBackup.authKey)).body, { userId: alice.id, box: aliceBackup.box });
  for (let i = 0; i < 5; i++) assert.equal((await recover(rand())).status, 401);
  assert.equal((await recover(aliceBackup.authKey)).status, 429);
  step('password sign-in: successes are free, 5 failures per hour, decoy for unknown users');

  // 5. Create a group: the join key, never the code or keywords
  groupId = randomUUID();
  const created = await createGroup(alice.token, groupId, JOIN_KEY);
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const dup = await createGroup(alice.token, randomUUID(), JOIN_KEY);
  assert.equal(dup.status, 409);
  assert.equal(dup.body.error, 'code_taken');
  step('alice created a group; another group cannot take the same code + keywords');

  // 6. Invites: at most 3 open per member
  const invites = [];
  for (let i = 0; i < 3; i++) invites.push((await call('POST', '/invites', { token: alice.token })).body.code);
  assert.equal((await call('POST', '/invites', { token: alice.token })).status, 429);
  const bob = makePhone('bob');
  await register(bob, invites[0], BACKUP());
  const carol = makePhone('carol');
  await register(carol, invites[1], BACKUP());
  step('invites are capped (3 open per member); bob and carol registered');

  // 7. Join request: pending until an admin approves
  assert.equal((await call('GET', `/groups/${groupId}/messages`, { token: bob.token })).status, 404);
  assert.equal((await call('POST', '/groups/join', { token: bob.token, json: { joinKey: rand() } })).status, 403);
  const joined = await call('POST', '/groups/join', { token: bob.token, json: { joinKey: JOIN_KEY } });
  assert.deepEqual(joined.body, { groupId, status: 'pending' });
  const bobList = (await call('GET', '/groups', { token: bob.token })).body;
  assert.deepEqual(Object.keys(bobList[0]).sort(), ['expiresAt', 'id', 'status']);
  assert.equal((await call('GET', `/groups/${groupId}/messages`, { token: bob.token })).status, 404);
  assert.equal((await call('GET', `/groups/${groupId}/members`, { token: bob.token })).status, 404);
  const seen = (await call('GET', `/groups/${groupId}/members`, { token: alice.token })).body;
  assert.deepEqual(seen.members.map((m: { userId: string }) => m.userId), [alice.id]);
  assert.deepEqual(seen.pending.map((m: { userId: string }) => m.userId), [bob.id]);
  const approval = { keyVersion: 1, sealedKey: rand(80), keySignature: rand(64), encryptedMeta: rand(64), metaSignature: rand(64) };
  assert.equal((await call('POST', `/groups/${groupId}/members/${bob.id}/approve`, { token: bob.token, json: approval })).status, 404);
  assert.equal((await call('POST', `/groups/${groupId}/members/${bob.id}/approve`, { token: alice.token, json: approval })).status, 200);
  const bobGroup = (await call('GET', '/groups', { token: bob.token })).body[0];
  assert.equal(bobGroup.status, 'active');
  assert.deepEqual(bobGroup.sealedKeys, [{ keyVersion: 1, sealedKey: approval.sealedKey, signerId: alice.id, signature: approval.keySignature }]);
  assert.equal(bobGroup.metaSignerId, alice.id);
  step('bob asked to join: pending (sees nothing), then approved by alice with a signed handout');

  // 8. Messages: replay de-duplicated, client ids cannot cross groups, rate-limited
  let ws: WebSocket | undefined;
  const received: Promise<any> | undefined = BASE_URL
    ? new Promise((resolve, reject) => {
        ws = new WebSocket(`${BASE_URL.replace(/^http/, 'ws')}/ws?token=${alice.token}`);
        const timer = setTimeout(() => reject(new Error('no realtime message within 10 s')), 10_000);
        ws.onmessage = (e) => {
          const msg = JSON.parse(String(e.data));
          if (msg.type === 'message') {
            clearTimeout(timer);
            resolve(msg.message);
          }
        };
        ws.onerror = () => reject(new Error('websocket error'));
      })
    : undefined;
  if (ws) await new Promise((r) => setTimeout(r, 1500)); // let the socket open and seed its cursor

  const groupKey = sodium.randombytes_buf(32);
  const encrypted = (gid: string, clientId: string, text: string) => {
    const ad = messageAd(gid, bob.id, clientId, 1);
    const nonce = sodium.randombytes_buf(24);
    const ct = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(utf8(text), ad, null, nonce, groupKey);
    const signature = sodium.crypto_sign_detached(frame(ad, nonce, ct), bob.sign.privateKey);
    return { clientId, keyVersion: 1, nonce: b64(nonce), ciphertext: b64(ct), signature: b64(signature) };
  };
  const clientId = randomUUID();
  const msg = encrypted(groupId, clientId, 'rdv à la base 🔒');
  const sent1 = await call('POST', `/groups/${groupId}/messages`, { token: bob.token, json: msg });
  const sent2 = await call('POST', `/groups/${groupId}/messages`, { token: bob.token, json: msg });
  assert.equal(sent1.status, 201);
  assert.equal(sent1.body.id, sent2.body.id);
  otherGroupId = randomUUID();
  assert.equal((await createGroup(bob.token, otherGroupId, rand())).status, 201);
  assert.equal((await call('POST', `/groups/${otherGroupId}/messages`, { token: bob.token, json: encrypted(otherGroupId, clientId, 'x') })).status, 409);
  step('bob sent a message; a replay is de-duplicated, its client id cannot be reused in another group');

  const resync = await call('GET', `/groups/${groupId}/messages?after=0`, { token: alice.token });
  assert.equal(resync.body.messages.length, 1);
  const m = resync.body.messages[0];
  const mAd = messageAd(m.groupId, m.senderId, m.clientId, m.keyVersion);
  assert.ok(sodium.crypto_sign_verify_detached(sodium.from_base64(m.signature), frame(mAd, sodium.from_base64(m.nonce), sodium.from_base64(m.ciphertext)), bob.sign.publicKey));
  step('alice resynced and verified the signature');
  if (received) {
    assert.equal((await received).id, sent1.body.id);
    ws!.close();
    step('alice received it live over WebSocket');
  }

  const burst: number[] = [];
  for (let i = 0; i < 60; i++) burst.push((await call('POST', `/groups/${otherGroupId}/messages`, { token: bob.token, json: encrypted(otherGroupId, randomUUID(), 'spam') })).status);
  assert.ok(burst.slice(0, 57).every((s) => s === 201));
  assert.equal(burst.at(-1), 429);
  step('sending is rate-limited (60 messages a minute)');

  // 9. Erasing a span of history: admin only, signalled by purgeSeq
  const erase = (token: string, from: Date, to: Date) =>
    call('POST', `/groups/${groupId}/messages/erase`, { token, json: { from: from.toISOString(), to: to.toISOString() } });
  const purgeBefore = resync.body.purgeSeq;
  const hourAgo = new Date(Date.now() - 3_600_000);
  const inAnHour = new Date(Date.now() + 3_600_000);
  assert.equal((await erase(bob.token, hourAgo, inAnHour)).status, 403);
  assert.equal((await erase(alice.token, inAnHour, hourAgo)).status, 400);
  const erased = await erase(alice.token, hourAgo, inAnHour);
  assert.equal(erased.body.deleted, 1);
  const afterErase = await call('GET', `/groups/${groupId}/messages?after=0`, { token: bob.token });
  assert.equal(afterErase.body.messages.length, 0);
  assert.ok(afterErase.body.purgeSeq > purgeBefore);
  step('admin erased a span of history for everyone (members cannot); purgeSeq moved');

  // 10. Rate limit on join
  const statuses: number[] = [];
  for (let i = 0; i < 6; i++) statuses.push((await call('POST', '/groups/join', { token: carol.token, json: { joinKey: rand() } })).status);
  assert.deepEqual(statuses, [403, 403, 403, 403, 403, 429]);
  assert.equal((await call('POST', '/groups/join', { token: carol.token, json: { joinKey: JOIN_KEY } })).status, 429);
  step('join is rate-limited after 5 attempts (even with the right key)');

  // 11. Admin settings: ephemeral, rotation (admins only), code change (every handout re-wrapped)
  const ephemeral = (token: string, seconds: number | null) => call('PUT', `/groups/${groupId}/ephemeral`, { token, json: { seconds } });
  assert.equal((await ephemeral(bob.token, 86_400)).status, 403);
  assert.equal((await ephemeral(alice.token, 86_400)).status, 200);
  assert.equal((await ephemeral(alice.token, null)).status, 200);
  const rotate = (token: string, from: number, ids: string[]) =>
    call('POST', `/groups/${groupId}/rotate`, {
      token,
      json: { fromKeyVersion: from, encryptedMeta: rand(64), metaSignature: rand(64), admins: [alice.id], keys: ids.map((userId) => ({ userId, sealedKey: rand(80), signature: rand(64) })) },
    });
  assert.equal((await rotate(bob.token, 1, [alice.id, bob.id])).status, 403);
  assert.equal((await rotate(alice.token, 1, [alice.id])).status, 409);
  assert.equal((await rotate(alice.token, 1, [alice.id, bob.id])).body.currentKeyVersion, 2);
  step('only an admin rotates, and the new key must reach exactly the active members');

  const NEW_JOIN_KEY = rand();
  const change = (keys: { userId: string; keyVersion: number }[]) =>
    call('PUT', `/groups/${groupId}/code`, {
      token: alice.token,
      json: { joinKey: NEW_JOIN_KEY, keyVersion: 2, encryptedMeta: rand(64), metaSignature: rand(64), keys: keys.map((k) => ({ ...k, sealedKey: rand(80), signature: rand(64) })) },
    });
  assert.equal((await change([{ userId: alice.id, keyVersion: 2 }])).status, 409); // bob would lose the current key
  const changed = await change([
    { userId: alice.id, keyVersion: 1 },
    { userId: alice.id, keyVersion: 2 },
    { userId: bob.id, keyVersion: 2 },
  ]);
  assert.equal(changed.body.codeVersion, 2);
  const bobKeys = (await call('GET', '/groups', { token: bob.token })).body.find((g: { id: string }) => g.id === groupId).sealedKeys;
  assert.deepEqual(bobKeys.map((k: { keyVersion: number }) => k.keyVersion), [2]); // v1 could not be re-wrapped: dropped
  step('code change: new join key, handouts re-wrapped, none left under the old code');

  // 12. Removal bans; the last admin must hand over before leaving
  assert.equal((await call('POST', `/groups/${groupId}/members/${alice.id}/remove`, { token: bob.token })).status, 403);
  assert.equal((await call('POST', `/groups/${groupId}/leave`, { token: alice.token })).status, 409);
  assert.equal((await call('POST', `/groups/${groupId}/members/${bob.id}/remove`, { token: alice.token })).status, 200);
  assert.equal((await call('GET', `/groups/${groupId}/messages`, { token: bob.token })).status, 404);
  assert.equal((await call('POST', '/groups/join', { token: bob.token, json: { joinKey: NEW_JOIN_KEY } })).status, 403);
  const flagged = (await call('GET', '/groups', { token: alice.token })).body.find((g: { id: string }) => g.id === groupId);
  assert.equal(flagged.rotationPending, true);
  step('removed member is banned (the code no longer lets him in); the last admin cannot just walk out');

  // 13. Self-destructing group: date checked at creation, gone for everyone once past
  assert.equal((await createGroup(alice.token, randomUUID(), rand(), { expiresAt: new Date(Date.now() + 60_000).toISOString() })).status, 400);
  assert.equal((await createGroup(alice.token, randomUUID(), rand(), { expiresAt: new Date(Date.now() + 400 * 86_400_000).toISOString() })).status, 400);
  tempGroupId = randomUUID();
  const expiry = new Date(Date.now() + 86_400_000);
  assert.equal((await createGroup(alice.token, tempGroupId, rand(), { expiresAt: expiry.toISOString() })).status, 201);
  const listed = (await call('GET', '/groups', { token: alice.token })).body.find((g: { id: string }) => g.id === tempGroupId);
  assert.equal(listed.expiresAt, expiry.toISOString());
  const { eq } = await import('drizzle-orm');
  await db.update(schema.groups).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(schema.groups.id, tempGroupId));
  assert.ok(!(await call('GET', '/groups', { token: alice.token })).body.some((g: { id: string }) => g.id === tempGroupId));
  assert.equal((await call('GET', `/groups/${tempGroupId}/messages`, { token: alice.token })).status, 404);
  step('self-destruct date validated at creation; past it the group is hidden');

  assert.equal((await call('POST', `/groups/${groupId}/leave`, { token: alice.token })).status, 200);
  assert.ok(!(await call('GET', '/groups', { token: alice.token })).body.some((g: { id: string }) => g.id === groupId));
  step('the last member leaving deletes the group');

  console.log('Smoke test passed.');
} finally {
  const testGroups = [groupId, otherGroupId, tempGroupId].filter(Boolean);
  if (testGroups.length) await db.delete(schema.groups).where(inArray(schema.groups.id, testGroups));
  const smokeIds = (
    await db.select({ id: schema.profiles.id }).from(schema.profiles).where(like(schema.profiles.username, 'smoke\\_%'))
  ).map((p) => p.id);
  await db.delete(schema.loginAttempts).where(like(schema.loginAttempts.username, 'smoke\\_%'));
  if (smokeIds.length) {
    await db.delete(schema.invites).where(or(inArray(schema.invites.usedBy, smokeIds), inArray(schema.invites.createdBy, smokeIds)));
    await db.delete(schema.profiles).where(inArray(schema.profiles.id, smokeIds));
  }
  await pool.end();
}

// Reached only on success (a failed assertion rejects the top-level await and exits 1).
// Exit explicitly: Node's WebSocket client can keep the event loop alive after close().
process.exit(0);
