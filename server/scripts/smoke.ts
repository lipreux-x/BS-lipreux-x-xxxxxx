/*
 * End-to-end smoke test of the API against the dev branch, with two simulated
 * phones (libsodium, same framing and AD labels as mobile/src/crypto).
 *
 *   npx tsx scripts/smoke.ts                 -> in-process (app.fetch), HTTP routes only
 *   BASE_URL=https://... npx tsx scripts/smoke.ts  -> deployed function, plus WebSocket
 *
 * Creates throwaway users/groups prefixed `smoke_` and deletes them at the end.
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

async function register(phone: Phone, inviteCode: string) {
  const proof = sodium.crypto_sign_detached(
    frame(utf8('bs/v1/register'), utf8(normalizeInviteCode(inviteCode)), utf8(phone.username), phone.box.publicKey, phone.sign.publicKey),
    phone.sign.privateKey,
  );
  const r = await call('POST', '/auth/register', {
    json: { inviteCode, username: phone.username, publicKeyBox: b64(phone.box.publicKey), publicKeySign: b64(phone.sign.publicKey), proof: b64(proof) },
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  phone.id = r.body.userId;
  phone.token = r.body.accessToken;
}

const messageAd = (groupId: string, senderId: string, clientId: string, keyVersion: number) =>
  frame(utf8('bs/v1/message'), utf8(groupId), utf8(senderId), utf8(clientId), u32(keyVersion));

const step = (s: string) => console.log(`  ✓ ${s}`);
// Codes now identify groups globally: use letters so test codes can never
// collide with a real (digit) group code on the branch.
const rnd = () => Math.random().toString(36).slice(2, 8).toUpperCase();
const GROUP_CODE = `ZZ${rnd()}`;
const KEYWORDS = ['Été', 'plage', 'soleil'];
let groupId = '';
let tempGroupId = '';

try {
  console.log(`Smoke test against ${BASE_URL ?? 'in-process app'}`);

  // 1. Bootstrap invite + first account
  const firstInvite = generateInviteCode();
  await db.insert(schema.invites).values({ codeHash: sha256Hex(normalizeInviteCode(firstInvite)), expiresAt: new Date(Date.now() + 60_000) });
  const alice = makePhone('alice');
  await register(alice, firstInvite);
  step('alice registered with bootstrap invite');
  assert.equal((await call('POST', '/auth/register', { json: { inviteCode: firstInvite, username: 'smoke_reuse', publicKeyBox: b64(alice.box.publicKey), publicKeySign: b64(alice.sign.publicKey), proof: b64(new Uint8Array(64)) } })).status, 400);

  // 2. Challenge login
  const ch = await call('POST', '/auth/challenge', { json: { userId: alice.id } });
  const sig = sodium.crypto_sign_detached(frame(utf8('bs/v1/login'), utf8(ch.body.challenge)), alice.sign.privateKey);
  const tok = await call('POST', '/auth/token', { json: { challenge: ch.body.challenge, signature: b64(sig) } });
  assert.equal(tok.status, 200);
  const forged = sodium.crypto_sign_detached(frame(utf8('bs/v1/login'), utf8(ch.body.challenge)), sodium.crypto_sign_keypair().privateKey);
  assert.equal((await call('POST', '/auth/token', { json: { challenge: ch.body.challenge, signature: b64(forged) } })).status, 401);
  step('challenge login works, forged signature rejected');
  assert.equal((await call('GET', '/me')).status, 401);
  step('unauthenticated request rejected');

  // 3. Create group
  groupId = randomUUID();
  const groupKey = sodium.randombytes_buf(32);
  const created = await call('POST', '/groups', {
    token: alice.token,
    json: { id: groupId, encryptedMeta: b64(sodium.randombytes_buf(64)), groupCode: GROUP_CODE, keywords: KEYWORDS, sealedKey: b64(sodium.crypto_box_seal(groupKey, alice.box.publicKey)) },
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const dup = await call('POST', '/groups', {
    token: alice.token,
    json: { id: randomUUID(), encryptedMeta: b64(sodium.randombytes_buf(64)), groupCode: GROUP_CODE, keywords: KEYWORDS, sealedKey: b64(sodium.crypto_box_seal(groupKey, alice.box.publicKey)) },
  });
  assert.equal(dup.status, 409);
  assert.equal(dup.body.error, 'code_taken');
  step('alice created a group; a second group cannot reuse its code');

  // 4. Invite bob via API
  const inv = await call('POST', '/invites', { token: alice.token });
  assert.equal(inv.status, 201);
  const bob = makePhone('bob');
  await register(bob, inv.body.code);
  step('bob registered with an invite created by alice');

  // 5. Join with code
  assert.equal((await call('POST', `/groups/${groupId}/messages`, { token: bob.token, json: {} })).status, 400);
  assert.equal((await call('GET', `/groups/${groupId}/messages`, { token: bob.token })).status, 404);
  assert.equal((await call('POST', '/groups/join', { token: bob.token, json: { groupCode: `ZZ${rnd()}` } })).status, 403);
  assert.equal((await call('POST', '/groups/join', { token: bob.token, json: { groupCode: GROUP_CODE } })).status, 403);
  assert.equal((await call('POST', '/groups/join', { token: bob.token, json: { groupCode: GROUP_CODE, keywords: ['ete', 'plage', 'lune'] } })).status, 403);
  // Case, accents and order do not matter.
  const joined = await call('POST', '/groups/join', { token: bob.token, json: { groupCode: GROUP_CODE, keywords: ['SOLEIL', 'ete', ' Plage '] } });
  assert.equal(joined.status, 200);
  assert.equal(joined.body.groupId, groupId);
  step('bob: non-member gets 404, wrong code or keywords 403, code + keywords join the group');

  // 6. Alice seals the key for bob
  const members = await call('GET', `/groups/${groupId}/members`, { token: alice.token });
  const pending = members.body.members.filter((m: { hasCurrentKey: boolean }) => !m.hasCurrentKey);
  assert.deepEqual(pending.map((m: { userId: string }) => m.userId), [bob.id]);
  const profiles = await call('GET', `/profiles?ids=${bob.id}`, { token: alice.token });
  const bobBoxPk = sodium.from_base64(profiles.body[0].publicKeyBox);
  const keys = await call('POST', `/groups/${groupId}/keys`, { token: alice.token, json: { keys: [{ userId: bob.id, keyVersion: 1, sealedKey: b64(sodium.crypto_box_seal(groupKey, bobBoxPk)) }] } });
  assert.equal(keys.body.stored, 1);
  const bobGroups = await call('GET', '/groups', { token: bob.token });
  const bobKey = sodium.crypto_box_seal_open(sodium.from_base64(bobGroups.body[0].sealedKeys[0].sealedKey), bob.box.publicKey, bob.box.privateKey);
  assert.deepEqual(bobKey, groupKey);
  step('alice sealed the group key for bob; bob opened it');

  // 7. Realtime (deployed only): alice listens while bob sends
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

  // 8. Bob sends an encrypted, signed message (twice: offline replay)
  const clientId = randomUUID();
  const ad = messageAd(groupId, bob.id, clientId, 1);
  const nonce = sodium.randombytes_buf(24);
  const ct = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(utf8('rdv à la base 🔒'), ad, null, nonce, bobKey);
  const signature = sodium.crypto_sign_detached(frame(ad, nonce, ct), bob.sign.privateKey);
  const msg = { clientId, keyVersion: 1, nonce: b64(nonce), ciphertext: b64(ct), signature: b64(signature) };
  const sent1 = await call('POST', `/groups/${groupId}/messages`, { token: bob.token, json: msg });
  const sent2 = await call('POST', `/groups/${groupId}/messages`, { token: bob.token, json: msg });
  assert.equal(sent1.status, 201);
  assert.equal(sent1.body.id, sent2.body.id);
  step('bob sent a message; replay is de-duplicated');

  // 9. Alice resyncs, verifies and decrypts
  const resync = await call('GET', `/groups/${groupId}/messages?after=0`, { token: alice.token });
  assert.equal(resync.body.messages.length, 1);
  const m = resync.body.messages[0];
  const mAd = messageAd(m.groupId, m.senderId, m.clientId, m.keyVersion);
  assert.ok(sodium.crypto_sign_verify_detached(sodium.from_base64(m.signature), frame(mAd, sodium.from_base64(m.nonce), sodium.from_base64(m.ciphertext)), bob.sign.publicKey));
  const plain = sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(null, sodium.from_base64(m.ciphertext), mAd, sodium.from_base64(m.nonce), groupKey);
  assert.equal(new TextDecoder().decode(plain), 'rdv à la base 🔒');
  step('alice resynced, verified the signature and decrypted');

  if (received) {
    const live = await received;
    assert.equal(live.id, sent1.body.id);
    ws!.close();
    step('alice received it live over WebSocket');
  }

  // 9b. Erasing a span of history: admin only, everyone's copy, signalled by purgeSeq
  const erase = (token: string, from: Date, to: Date) =>
    call('POST', `/groups/${groupId}/messages/erase`, { token, json: { from: from.toISOString(), to: to.toISOString() } });
  const purgeBefore = resync.body.purgeSeq;
  assert.equal(typeof purgeBefore, 'number');
  const hourAgo = new Date(Date.now() - 3_600_000);
  const inAnHour = new Date(Date.now() + 3_600_000);
  assert.equal((await erase(bob.token, hourAgo, inAnHour)).status, 403);
  assert.equal((await erase(alice.token, inAnHour, hourAgo)).status, 400);
  const yesterday = await erase(alice.token, new Date(Date.now() - 2 * 86_400_000), new Date(Date.now() - 86_400_000));
  assert.equal(yesterday.body.deleted, 0);
  assert.equal((await call('GET', `/groups/${groupId}/messages?after=0`, { token: alice.token })).body.purgeSeq, purgeBefore);
  const erased = await erase(alice.token, hourAgo, inAnHour);
  assert.equal(erased.status, 200);
  assert.equal(erased.body.deleted, 1);
  const afterErase = await call('GET', `/groups/${groupId}/messages?after=0`, { token: bob.token });
  assert.equal(afterErase.body.messages.length, 0);
  assert.ok(afterErase.body.purgeSeq > purgeBefore);
  step('admin erased a span of history for everyone (members cannot); purgeSeq moved');

  // 10. Rate limit on join
  const carol = makePhone('carol');
  const inv2 = await call('POST', '/invites', { token: alice.token });
  await register(carol, inv2.body.code);
  const statuses: number[] = [];
  for (let i = 0; i < 6; i++) statuses.push((await call('POST', '/groups/join', { token: carol.token, json: { groupCode: `ZZ${rnd()}` } })).status);
  assert.deepEqual(statuses, [403, 403, 403, 403, 403, 429]);
  assert.equal((await call('POST', '/groups/join', { token: carol.token, json: { groupCode: GROUP_CODE, keywords: KEYWORDS } })).status, 429);
  step('join is rate-limited after 5 attempts (even with the right code)');

  // 11. Group settings: admin rights, ephemeral, code change, removal + key rotation, leave
  const ephemeral = (token: string, seconds: number | null) => call('PUT', `/groups/${groupId}/ephemeral`, { token, json: { seconds } });
  assert.equal((await ephemeral(bob.token, 86_400)).status, 403);
  assert.equal((await ephemeral(alice.token, 86_400)).status, 200);
  assert.equal((await ephemeral(alice.token, null)).status, 200);
  const newCode = `ZZ${rnd()}`;
  const changed = await call('PUT', `/groups/${groupId}/code`, {
    token: alice.token,
    json: { groupCode: newCode, keywords: ['lune', 'mer', 'vent'], keyVersion: 1, encryptedMeta: b64(sodium.randombytes_buf(64)) },
  });
  assert.equal(changed.status, 200, JSON.stringify(changed.body));
  assert.equal(changed.body.codeVersion, 2);
  step('only the admin sets ephemeral messages and changes the code + keywords');

  assert.equal((await call('POST', `/groups/${groupId}/members/${alice.id}/remove`, { token: bob.token })).status, 403);
  assert.equal((await call('POST', `/groups/${groupId}/members/${bob.id}/remove`, { token: alice.token })).status, 200);
  assert.equal((await call('GET', `/groups/${groupId}/messages`, { token: bob.token })).status, 404);
  const flagged = (await call('GET', '/groups', { token: alice.token })).body.find((g: { id: string }) => g.id === groupId);
  assert.equal(flagged.rotationPending, true);
  const newKey = sodium.randombytes_buf(32);
  const rotate = (keys: { userId: string; sealedKey: string }[]) =>
    call('POST', `/groups/${groupId}/rotate`, { token: alice.token, json: { fromKeyVersion: 1, encryptedMeta: b64(sodium.randombytes_buf(64)), keys } });
  const forBob = { userId: bob.id, sealedKey: b64(sodium.crypto_box_seal(newKey, bobBoxPk)) };
  const forAlice = { userId: alice.id, sealedKey: b64(sodium.crypto_box_seal(newKey, alice.box.publicKey)) };
  assert.equal((await rotate([forAlice, forBob])).status, 409);
  const rotated = await rotate([forAlice]);
  assert.equal(rotated.status, 200);
  assert.equal(rotated.body.currentKeyVersion, 2);
  const after = (await call('GET', '/groups', { token: alice.token })).body.find((g: { id: string }) => g.id === groupId);
  assert.equal(after.rotationPending, false);
  step('admin removed bob; the new key can only be sealed to those who remain');

  // 12. Self-destructing group: date checked at creation, gone for everyone once past
  const tempCode = `ZZ${rnd()}`;
  const createTemp = (id: string, expiresAt: Date) =>
    call('POST', '/groups', {
      token: alice.token,
      json: {
        id,
        encryptedMeta: b64(sodium.randombytes_buf(64)),
        groupCode: tempCode,
        keywords: KEYWORDS,
        sealedKey: b64(sodium.crypto_box_seal(groupKey, alice.box.publicKey)),
        expiresAt: expiresAt.toISOString(),
      },
    });
  assert.equal((await createTemp(randomUUID(), new Date(Date.now() + 60_000))).status, 400);
  assert.equal((await createTemp(randomUUID(), new Date(Date.now() + 400 * 86_400_000))).status, 400);
  tempGroupId = randomUUID();
  const expiry = new Date(Date.now() + 86_400_000);
  assert.equal((await createTemp(tempGroupId, expiry)).status, 201);
  const listed = (await call('GET', '/groups', { token: alice.token })).body.find((g: { id: string }) => g.id === tempGroupId);
  assert.equal(listed.expiresAt, expiry.toISOString());
  // Fast-forward past its date (the hourly purge then deletes it for good).
  const { eq } = await import('drizzle-orm');
  await db.update(schema.groups).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(schema.groups.id, tempGroupId));
  assert.ok(!(await call('GET', '/groups', { token: alice.token })).body.some((g: { id: string }) => g.id === tempGroupId));
  assert.equal((await call('GET', `/groups/${tempGroupId}/messages`, { token: alice.token })).status, 404);
  assert.equal((await call('POST', '/groups/join', { token: bob.token, json: { groupCode: tempCode, keywords: KEYWORDS } })).status, 403);
  step('self-destruct date validated at creation; past it the group is hidden and cannot be joined');

  assert.equal((await call('POST', `/groups/${groupId}/leave`, { token: alice.token })).status, 200);
  assert.equal((await call('GET', '/groups', { token: alice.token })).body.length, 0);
  step('the last member leaving deletes the group');

  console.log('Smoke test passed.');
} finally {
  const testGroups = [groupId, tempGroupId].filter(Boolean);
  if (testGroups.length) await db.delete(schema.groups).where(inArray(schema.groups.id, testGroups));
  const smokeIds = (
    await db.select({ id: schema.profiles.id }).from(schema.profiles).where(like(schema.profiles.username, 'smoke\\_%'))
  ).map((p) => p.id);
  if (smokeIds.length) {
    await db.delete(schema.invites).where(or(inArray(schema.invites.usedBy, smokeIds), inArray(schema.invites.createdBy, smokeIds)));
    await db.delete(schema.profiles).where(inArray(schema.profiles.id, smokeIds));
  }
  await pool.end();
}

// Reached only on success (a failed assertion rejects the top-level await and exits 1).
// Exit explicitly: Node's WebSocket client can keep the event loop alive after close().
process.exit(0);
