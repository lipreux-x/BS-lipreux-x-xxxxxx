/*
 * End-to-end test of the app's services against a running API, with three
 * simulated phones. Opt-in, because it needs a fresh invite code:
 *
 *   cd ../server && npx tsx scripts/create-invite.ts 1     # prints an invite
 *   E2E_API_URL=https://... E2E_INVITE=XXXX-... npx jest e2e
 *   cd ../server && npx tsx scripts/cleanup-test-users.ts  # removes e2e_* users
 *
 * E2E_NO_WS=1 skips the WebSocket part (an API served without upgrades).
 */
import { b64, backupKeys, createKeyBackup, deriveGroupSecrets, encryptGroupMeta, generateGroupKey, generateIdentity, openKeyBackup, sealHandout } from '@/crypto';
import { setArgon2ForTests } from '@/crypto/kdf';
import { initCrypto } from '@/crypto/sodium';
import { Api, type WireMessage } from '../api';
import {
  approveMember,
  changeGroupCode,
  createGroup,
  decryptMessages,
  fetchSince,
  GroupTamperedError,
  joinGroup,
  joinRequests,
  listGroups,
  loadAttachment,
  newClientId,
  ProfileCache,
  relockGroup,
  rotateNow,
  sendAttachment,
  sendText,
  syncGroup,
  unlockGroup,
  uploadImage,
  uploadVoice,
  type Session,
} from '../groups';
import { RealtimeClient } from '../realtime';
import { Vault, WrongCodeError, type SecretStore } from '../vault';

const API_URL = process.env.E2E_API_URL;
const INVITE = process.env.E2E_INVITE;
const run = API_URL && INVITE ? describe : describe.skip;

jest.setTimeout(600_000);
const PASSWORD = 'Mot de passe e2e 42';

function memoryStore(): SecretStore {
  const data = new Map<string, string>();
  return { get: async (k) => data.get(k) ?? null, set: async (k, v) => void data.set(k, v), delete: async (k) => void data.delete(k) };
}

/** What the onboarding screen does: keys on the phone, register, then create the vault. */
async function onboard(name: string, invite: string, appCode: string): Promise<Session & { profiles: ProfileCache }> {
  const identity = generateIdentity();
  const username = `e2e_${name}_${Math.floor(Math.random() * 1e6)}`;
  const { userId } = await new Api(API_URL!).register(invite, username, identity, await createKeyBackup(identity, username, PASSWORD));
  const vault = new Vault(memoryStore());
  const unlocked = await vault.create({ userId, username }, identity, appCode);
  const s = { ...unlocked, vault, api: new Api(API_URL!, { userId, identity }) };
  return { ...s, profiles: new ProfileCache(s.api, vault, unlocked.masterKey) };
}

// Letter codes: never collide with a real (digit) group code on the branch.
const randomCode = () => `ZZ${Math.random().toString(36).slice(2, 8).toUpperCase()}`;

run('app services against the API', () => {
  // The server refuses backups weaker than production: same cost as the app.
  beforeAll(async () => {
    await initCrypto();
    setArgon2ForTests(null);
  });
  afterAll(() => setArgon2ForTests({ ops: 1, mem: 1024 * 1024 }));

  it('accounts, join requests, approval, encrypted chat, removal and code change', async () => {
    const alice = await onboard('alice', INVITE!, '482913');
    expect((await alice.api.me()).username).toBe(alice.account.username);

    // A phone that lost everything: username + password bring the identity back.
    const anon = new Api(API_URL!);
    const { kek, authKey } = await backupKeys(alice.account.username, PASSWORD, await anon.recoverParams(alice.account.username));
    const back = await anon.recover(alice.account.username, authKey);
    expect(back.userId).toBe(alice.account.userId);
    const restoredIdentity = openKeyBackup(back.box, alice.account.username, kek);
    expect(restoredIdentity.signSecretKey).toEqual(alice.identity.signSecretKey);
    await expect(anon.recover(alice.account.username, b64.encode(new Uint8Array(32)))).rejects.toMatchObject({ code: 'bad_credentials' });

    // Alice creates a group; the server sees neither the code nor the keywords.
    const groupCode = randomCode();
    const keywords = ['Été', 'plage', 'soleil'];
    const { id: groupId } = await createGroup(alice, 'Les Potes', groupCode, keywords);
    const aliceOpen = (await unlockGroup(alice, alice.profiles, groupId, groupCode))!;
    expect(aliceOpen.meta).toMatchObject({ name: 'Les Potes', keywords, admins: [alice.account.userId], members: [alice.account.userId] });

    const bob = await onboard('bob', (await alice.api.createInvite()).code, '135790');
    const mallory = await onboard('mallory', (await alice.api.createInvite()).code, '246802');

    // Bob asks to join: wrong keywords are refused; case, accents and order do not matter.
    await expect(joinGroup(bob, groupCode, ['ete', 'plage', 'lune'])).rejects.toMatchObject({ code: 'wrong_code' });
    expect(await joinGroup(bob, groupCode, ['SOLEIL', 'ete', 'plage'])).toBe(groupId);
    // Pending: nothing of the group is visible, not even messages.
    expect((await listGroups(bob))[0]).toMatchObject({ id: groupId, name: null, state: { kind: 'pending' } });
    await expect(bob.api.messages(groupId, 0)).rejects.toMatchObject({ status: 404 });

    // Alice sees the request with Bob's fingerprint, and lets him in.
    const [request] = await joinRequests(alice, alice.profiles, groupId);
    expect(request).toMatchObject({ userId: bob.account.userId, keyChanged: false });
    expect(request!.fingerprint).toMatch(/^(\d{5} ){5}\d{5}$/);
    await approveMember(alice, alice.profiles, groupId, aliceOpen.keys, bob.account.userId);

    // Bob's first unlock: his handout opens with the code he joined with, then is locked under it.
    expect((await listGroups(bob))[0]!.state).toEqual({ kind: 'first-unlock', needsKeywords: false });
    await expect(unlockGroup(bob, bob.profiles, groupId, 'ZZWRONG1')).rejects.toBeInstanceOf(WrongCodeError);
    const bobOpen = (await unlockGroup(bob, bob.profiles, groupId, groupCode))!;
    expect(bobOpen.meta.members).toEqual([alice.account.userId, bob.account.userId]);
    expect((await listGroups(bob))[0]).toMatchObject({ name: 'Les Potes', state: { kind: 'locked' } });

    // Mallory knows the code + keywords (overheard) and asks too: she stays pending until an admin decides.
    expect(await joinGroup(mallory, groupCode, keywords)).toBe(groupId);
    expect((await joinRequests(alice, alice.profiles, groupId)).map((r) => r.userId)).toEqual([mallory.account.userId]);
    await alice.api.rejectMember(groupId, mallory.account.userId);
    expect(await listGroups(mallory)).toEqual([]);

    // Chat: Bob sends, Alice reads (live over the WebSocket when available).
    const clientId = newClientId();
    let sent: WireMessage | undefined;
    const send = async () => {
      sent = await sendText(bob, groupId, bobOpen.groupKey, 1, 'rdv à la base 🔒', clientId);
      // Offline replay of the same message is de-duplicated by the server.
      expect((await sendText(bob, groupId, bobOpen.groupKey, 1, 'rdv à la base 🔒', clientId)).id).toBe(sent.id);
    };
    if (process.env.E2E_NO_WS) {
      await send();
    } else {
      const live = new Promise<WireMessage>((resolve) => {
        const rt = new RealtimeClient(API_URL!, () => alice.api.accessToken(), {
          onConnected: () => void send(),
          onMessage: (m) => {
            rt.stop();
            resolve(m);
          },
        });
        rt.start();
      });
      expect((await live).id).toBe(sent!.id);
    }
    const history = await decryptMessages(alice, alice.profiles, aliceOpen.keys, (await fetchSince(alice, groupId, 0)).messages);
    expect(history).toMatchObject([{ text: 'rdv à la base 🔒', senderName: bob.account.username, mine: false }]);

    // An image and a voice message: encrypted on the phone, blob in storage, key in the message.
    const jpeg = new Uint8Array(200_000).map((_, i) => (i * 7) & 0xff);
    const imageBody = await uploadImage(bob, groupId, { jpeg, width: 800, height: 600, preview: 'AAAA' });
    const imageMsg = await sendAttachment(bob, groupId, bobOpen.groupKey, 1, imageBody, newClientId());
    const [imageChat] = await decryptMessages(alice, alice.profiles, aliceOpen.keys, [imageMsg]);
    expect(await loadAttachment(alice, groupId, imageChat!.image!)).toEqual(jpeg);
    const audio = new Uint8Array(30_000).map((_, i) => (i * 13) & 0xff);
    const voiceBody = await uploadVoice(bob, groupId, { audio, durationMs: 4200, waveform: [10, 80, 40] });
    const voiceMsg = await sendAttachment(bob, groupId, bobOpen.groupKey, 1, voiceBody, newClientId());
    const [voiceChat] = await decryptMessages(alice, alice.profiles, aliceOpen.keys, [voiceMsg]);
    expect(await loadAttachment(alice, groupId, voiceChat!.voice!)).toEqual(audio);

    // A key handed over by a non-admin is refused, even with the right code: Bob forges a "rotation".
    const fake = generateGroupKey();
    const { wrapKey } = await deriveGroupSecrets(groupCode, keywords);
    const forged = [alice, bob].map((p) => ({
      userId: p.account.userId,
      ...sealHandout(fake, wrapKey, groupId, 2, { userId: p.account.userId, boxPublicKey: p.identity.boxPublicKey }, bob.identity),
    }));
    // The server already refuses it (admins only)...
    await expect(
      bob.api.rotateKey(groupId, {
        fromKeyVersion: 1,
        ...encryptGroupMeta({ ...bobOpen.meta, admins: [bob.account.userId], rev: 99 }, groupId, 2, fake, bob.identity),
        admins: [bob.account.userId],
        keys: forged.map(({ userId, sealedKey, signature }) => ({ userId, sealedKey, signature })),
      }),
    ).rejects.toMatchObject({ status: 403 });

    // Alice removes Bob: rotation right away, and he cannot come back with the code he knows.
    await alice.api.removeMember(groupId, bob.account.userId);
    const rotated = await rotateNow(alice, alice.profiles, groupId, aliceOpen.keys);
    expect(rotated.keyVersion).toBe(2);
    expect(rotated.meta.members).toEqual([alice.account.userId]);
    await expect(fetchSince(bob, groupId, 0)).rejects.toMatchObject({ status: 404 });
    await expect(joinGroup(bob, groupCode, keywords)).rejects.toMatchObject({ code: 'wrong_code' });
    await sendText(alice, groupId, rotated.keys.get(2)!, 2, 'sans Bob', newClientId());

    // Alice signs in again on a new phone: password, then the group needs its code AND keywords.
    const newPhone = new Vault(memoryStore());
    const re = await newPhone.create(alice.account, restoredIdentity, '111111');
    const alice2 = { ...re, vault: newPhone, api: new Api(API_URL!, { userId: alice.account.userId, identity: restoredIdentity }) };
    const profiles2 = new ProfileCache(alice2.api, newPhone, re.masterKey);
    expect((await listGroups(alice2))[0]!.state).toEqual({ kind: 'first-unlock', needsKeywords: true });
    await expect(unlockGroup(alice2, profiles2, groupId, groupCode, ['ete', 'plage', 'lune'])).rejects.toBeInstanceOf(WrongCodeError);
    const again = (await unlockGroup(alice2, profiles2, groupId, groupCode, keywords))!;
    expect(again.keyVersion).toBe(2);
    const all = await decryptMessages(alice2, profiles2, again.keys, (await fetchSince(alice2, groupId, 0)).messages);
    expect(all.map((m) => m.text ?? m.image?.attachmentId ?? m.voice?.attachmentId)).toEqual([
      'rdv à la base 🔒',
      imageBody.attachmentId,
      voiceBody.attachmentId,
      'sans Bob',
    ]);

    // Alice changes code + keywords on her first phone: the old code opens nothing anymore.
    const newCode = randomCode();
    await changeGroupCode(alice, alice.profiles, groupId, rotated.keys, newCode, ['lune', 'mer', 'vent']);
    await expect(unlockGroup(alice, alice.profiles, groupId, groupCode)).rejects.toBeInstanceOf(WrongCodeError);
    expect(await unlockGroup(alice, alice.profiles, groupId, newCode)).toMatchObject({ codeChanged: false, meta: { keywords: ['lune', 'mer', 'vent'] } });
    // Her second phone is asked for the new code, which must open the re-wrapped key.
    expect((await unlockGroup(alice2, profiles2, groupId, groupCode))!.codeChanged).toBe(true);
    await expect(relockGroup(alice2, profiles2, groupId, again.keys, 'ZZWRONG2')).rejects.toBeInstanceOf(WrongCodeError);
    await relockGroup(alice2, profiles2, groupId, again.keys, newCode);
    expect(await unlockGroup(alice2, profiles2, groupId, newCode)).toMatchObject({ codeChanged: false });
    // Nobody can join with the old code + keywords.
    await expect(joinGroup(mallory, groupCode, keywords)).rejects.toMatchObject({ code: 'wrong_code' });

    // Sync after all that: verified, nothing tampered.
    await expect(syncGroup(alice, alice.profiles, groupId, rotated.keys)).resolves.toMatchObject({ keyVersion: 2 });
    expect(GroupTamperedError).toBeDefined();
  });
});
