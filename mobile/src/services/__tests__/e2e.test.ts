/*
 * End-to-end test of the app's services against a deployed API, with two
 * simulated phones. Opt-in, because it needs a fresh invite code:
 *
 *   cd ../server && npx tsx scripts/create-invite.ts 1     # prints an invite
 *   E2E_API_URL=https://... E2E_INVITE=XXXX-... npx jest e2e
 *   cd ../server && npx tsx scripts/cleanup-test-users.ts  # removes e2e_* users
 */
import { b64, generateIdentity } from '@/crypto';
import { initCrypto } from '@/crypto/sodium';
import { Api, type WireMessage } from '../api';
import {
  changeGroupCode,
  createGroup,
  decryptMessages,
  fetchSince,
  joinGroup,
  listGroups,
  loadImage,
  newClientId,
  ProfileCache,
  sendImage,
  sendText,
  shareMissingKeys,
  syncGroup,
  unlockGroup,
  uploadImage,
  type Session,
} from '../groups';
import { RealtimeClient } from '../realtime';
import { Vault, WrongCodeError, type SecretStore } from '../vault';

const API_URL = process.env.E2E_API_URL;
const INVITE = process.env.E2E_INVITE;
const run = API_URL && INVITE ? describe : describe.skip;

jest.setTimeout(120_000);

function memoryStore(): SecretStore {
  const data = new Map<string, string>();
  return { get: async (k) => data.get(k) ?? null, set: async (k, v) => void data.set(k, v), delete: async (k) => void data.delete(k) };
}

/** What the onboarding screen does: keys on the phone, register, then create the vault. */
async function onboard(name: string, invite: string, appCode: string): Promise<Session> {
  const identity = generateIdentity();
  const username = `e2e_${name}_${Math.floor(Math.random() * 1e6)}`;
  const { userId } = await new Api(API_URL!).register(invite, username, identity);
  const vault = new Vault(memoryStore());
  const unlocked = await vault.create({ userId, username }, identity, appCode);
  return { ...unlocked, vault, api: new Api(API_URL!, { userId, identity }) };
}

run('app services against the deployed API', () => {
  beforeAll(() => initCrypto());

  it('onboarding, group, key sharing, encrypted chat and realtime', async () => {
    const alice = await onboard('alice', INVITE!, '482913');
    expect((await alice.api.me()).username).toBe(alice.account.username);

    // Alice creates a group and invites Bob.
    // Letter codes: never collide with a real (digit) group code on the branch.
    const groupCode = `ZZ${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
    const keywords = ['Été', 'plage', 'soleil'];
    const { id: groupId } = await createGroup(alice, 'Les Potes', groupCode, keywords);
    const { code } = await alice.api.createInvite();
    const bob = await onboard('bob', code, '135790');

    // Bob joins with the code + keywords; he is a member but has no key yet.
    // Wrong keywords are refused; case, accents and order do not matter.
    await expect(joinGroup(bob, groupCode, ['ete', 'plage', 'lune'])).rejects.toMatchObject({ code: 'wrong_code' });
    expect(await joinGroup(bob, groupCode, ['SOLEIL', 'ete', 'plage'])).toBe(groupId);
    expect((await listGroups(bob))[0]).toMatchObject({ id: groupId, name: null, state: { kind: 'waiting-key' } });

    // Alice opens the group: her phone seals the key for Bob.
    const aliceProfiles = new ProfileCache(alice.api);
    const aliceUnlock = await unlockGroup(alice, groupId, groupCode);
    expect(aliceUnlock?.meta).toMatchObject({ name: 'Les Potes', keywords });
    expect(await shareMissingKeys(alice, aliceProfiles, groupId, aliceUnlock!.groupKey, 1)).toBe(1);

    // Bob's first unlock stores the key locally under the code he types.
    expect((await listGroups(bob))[0]!.state.kind).toBe('first-unlock');
    const bobUnlock = await unlockGroup(bob, groupId, groupCode);
    expect(bobUnlock?.meta.name).toBe('Les Potes');
    expect((await listGroups(bob))[0]).toMatchObject({ name: 'Les Potes', state: { kind: 'locked' } });

    // Alice picks an avatar icon: Bob sees it on her profile; anything outside the list is refused.
    expect((await alice.api.me()).avatar).toBeNull();
    await alice.api.setAvatar('mask');
    expect((await bob.api.profiles([alice.account.userId]))[0]?.avatar).toBe('mask');
    await expect(alice.api.setAvatar('https://example.com/me.jpg')).rejects.toMatchObject({ status: 400 });
    await alice.api.setAvatar(null);
    expect((await alice.api.me()).avatar).toBeNull();

    // Alice listens on the WebSocket while Bob sends.
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
    let sent: WireMessage | undefined;
    const clientId = newClientId();
    const send = async () => {
      sent = await sendText(bob, groupId, bobUnlock!.groupKey, 1, 'rdv à la base 🔒', clientId);
      // Offline replay of the same message is de-duplicated by the server.
      expect((await sendText(bob, groupId, bobUnlock!.groupKey, 1, 'rdv à la base 🔒', clientId)).id).toBe(sent.id);
    };

    const received = await live;
    expect(received.id).toBe(sent!.id);
    const [chat] = await decryptMessages(alice, aliceProfiles, aliceUnlock!.keys, [received]);
    expect(chat).toMatchObject({ text: 'rdv à la base 🔒', senderName: bob.account.username, mine: false });

    // Resync over HTTP gives the same message.
    const history = await decryptMessages(alice, aliceProfiles, aliceUnlock!.keys, await fetchSince(alice, groupId, 0));
    expect(history.map((m) => m.text)).toEqual(['rdv à la base 🔒']);

    // Alice answers Bob's message: the quote travels inside the encrypted, signed body.
    const replyTo = { messageId: sent!.id, senderId: bob.account.userId, excerpt: 'rdv à la base 🔒' };
    const reply = await sendText(alice, groupId, aliceUnlock!.groupKey, 1, 'J’y serai', newClientId(), replyTo);
    const [bobSees] = await decryptMessages(bob, new ProfileCache(bob.api), bobUnlock!.keys, [reply]);
    expect(bobSees).toMatchObject({ text: 'J’y serai', replyTo });

    // Bob sends an image: encrypted on his phone, blob in object storage, key in the message.
    const jpeg = new Uint8Array(200_000).map((_, i) => (i * 7) & 0xff);
    const imageBody = await uploadImage(bob, groupId, { jpeg, width: 800, height: 600, preview: 'AAAA' });
    const imageMsg = await sendImage(bob, groupId, bobUnlock!.groupKey, 1, imageBody, newClientId());
    const [imageChat] = await decryptMessages(alice, aliceProfiles, aliceUnlock!.keys, [imageMsg]);
    expect(imageChat).toMatchObject({ text: null, image: { attachmentId: imageBody.attachmentId, width: 800, height: 600 } });
    expect(await loadImage(alice, groupId, imageChat!.image!)).toEqual(jpeg);
    // The server holds only ciphertext, and the upload cannot be reused by another message.
    const { url } = await alice.api.attachmentUrl(groupId, imageBody.attachmentId);
    const stored = await alice.api.downloadBlob(url);
    expect(stored.length).toBe(jpeg.length + 40);
    expect(Buffer.from(stored).includes(Buffer.from(jpeg.subarray(0, 64)))).toBe(false);
    await expect(sendImage(alice, groupId, aliceUnlock!.groupKey, 1, imageBody, newClientId())).rejects.toMatchObject({ code: 'invalid_attachment' });
    // A wrong file key does not open it.
    await expect(loadImage(alice, groupId, { ...imageBody, fileKey: b64.encode(new Uint8Array(32)) })).rejects.toMatchObject({ code: 'DECRYPT_FAILED' });

    // Alice removes Bob: her next sync draws key v2 for those who remain.
    await alice.api.removeMember(groupId, bob.account.userId);
    const synced = await syncGroup(alice, aliceProfiles, groupId, aliceUnlock!.keys);
    expect(synced.keyVersion).toBe(2);
    expect(synced.summary.rotationPending).toBe(false);
    await sendText(alice, groupId, synced.keys.get(2)!, 2, 'sans Bob', newClientId());
    const both = await decryptMessages(alice, aliceProfiles, synced.keys, await fetchSince(alice, groupId, 0));
    expect(both.map((m) => m.text ?? m.image?.attachmentId)).toEqual(['rdv à la base 🔒', 'J’y serai', imageBody.attachmentId, 'sans Bob']);
    await expect(fetchSince(bob, groupId, 0)).rejects.toMatchObject({ status: 404 });

    // Next unlock: the code still opens (v1 on the phone), v2 gets locked under it.
    const reopened = await unlockGroup(alice, groupId, groupCode);
    expect(reopened?.keyVersion).toBe(2);
    expect([...reopened!.keys.keys()].sort()).toEqual([1, 2]);
    expect(await alice.vault.latestGroupKeyVersion(groupId, 2)).toBe(2);

    // Alice (admin) changes code + keywords: the new code opens the group, the old one no longer does.
    const newCode = `ZZ${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
    await changeGroupCode(alice, groupId, reopened!.keys, 2, newCode, ['lune', 'mer', 'vent']);
    await expect(unlockGroup(alice, groupId, groupCode)).rejects.toBeInstanceOf(WrongCodeError);
    const withNew = await unlockGroup(alice, groupId, newCode);
    expect(withNew).toMatchObject({ codeChanged: false, meta: { keywords: ['lune', 'mer', 'vent'] } });
  });
});
