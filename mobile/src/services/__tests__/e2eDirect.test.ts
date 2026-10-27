/*
 * End-to-end test of private conversations (two people who share a group)
 * against a running API. Opt-in, like e2e.test.ts, with its own invite:
 *
 *   cd ../server && npx tsx scripts/create-invite.ts 1
 *   E2E_API_URL=https://... E2E_INVITE=XXXX-... npx jest e2eDirect --selectProjects libsodium
 *   cd ../server && npx tsx scripts/cleanup-test-users.ts
 */
import { createKeyBackup, generateIdentity } from '@/crypto';
import { setArgon2ForTests } from '@/crypto/kdf';
import { initCrypto } from '@/crypto/sodium';
import { Api } from '../api';
import {
  createDirect,
  createGroup,
  decryptMessages,
  directWith,
  fetchSince,
  joinGroup,
  listGroups,
  approveMember,
  newClientId,
  ProfileCache,
  sendText,
  unlockGroup,
  type Session,
} from '../groups';
import { nodeSqlite } from '../../../test-support/nodeSqlite';
import { LocalStore } from '../localStore';
import { Vault, WrongCodeError, type SecretStore } from '../vault';

const API_URL = process.env.E2E_API_URL;
const INVITE = process.env.E2E_INVITE;
const run = API_URL && INVITE ? describe : describe.skip;

jest.setTimeout(600_000);

function memoryStore(): SecretStore {
  const data = new Map<string, string>();
  return { get: async (k) => data.get(k) ?? null, set: async (k, v) => void data.set(k, v), delete: async (k) => void data.delete(k) };
}

async function onboard(name: string, invite: string, appCode: string): Promise<Session & { profiles: ProfileCache }> {
  const identity = generateIdentity();
  const username = `e2e_${name}_${Math.floor(Math.random() * 1e6)}`;
  const { userId } = await new Api(API_URL!).register(invite, username, identity, await createKeyBackup(identity, username, 'Mot de passe e2e 42'));
  const vault = new Vault(memoryStore());
  const unlocked = await vault.create({ userId, username }, identity, appCode);
  const local = await LocalStore.open(nodeSqlite(), unlocked.masterKey);
  const s = { ...unlocked, vault, local, api: new Api(API_URL!, { userId, identity }) };
  return { ...s, profiles: new ProfileCache(s.api, vault, unlocked.masterKey, local) };
}

const randomCode = () => `ZZ${Math.random().toString(36).slice(2, 8).toUpperCase()}`;

run('private conversations against the API', () => {
  beforeAll(async () => {
    await initCrypto();
    setArgon2ForTests(null);
  });
  afterAll(() => setArgon2ForTests({ ops: 1, mem: 1024 * 1024 }));

  it('opened from a shared group, locked by each phone with its own code, deleted for both', async () => {
    const alice = await onboard('dmalice', INVITE!, '482913');
    const bob = await onboard('dmbob', (await alice.api.createInvite()).code, '135790');
    const carol = await onboard('dmcarol', (await alice.api.createInvite()).code, '246802');
    const A = alice.account.userId;
    const B = bob.account.userId;

    // Carol shares no group with Alice: no conversation with her (and her profile is not even visible).
    await expect(createDirect(alice, alice.profiles, carol.account.userId, '111111')).rejects.toBeTruthy();

    // Alice and Bob share a group.
    const code = randomCode();
    const keywords = ['quai', 'brume', 'phare'];
    const { id: groupId } = await createGroup(alice, 'Le Port', code, keywords);
    const aliceGroup = (await unlockGroup(alice, alice.profiles, groupId, code))!;
    await joinGroup(bob, code, keywords);
    await approveMember(alice, alice.profiles, groupId, aliceGroup.keys, B);
    await unlockGroup(bob, bob.profiles, groupId, code);

    // Alice opens a private conversation with Bob, locked on her phone with 424242.
    const dm = await createDirect(alice, alice.profiles, B, '424242');
    expect(dm.meta).toMatchObject({ direct: true, keywords: [], members: [A, B], admins: [A, B] });
    expect(dm.name).toBe(bob.account.username);
    // One per pair, whoever opens it.
    await expect(createDirect(bob, bob.profiles, A, '000000')).rejects.toMatchObject({ code: 'direct_exists' });
    expect(await directWith(alice, B)).toBe(dm.id);
    expect(await directWith(bob, A)).toBe(dm.id);

    // Alice's list: the conversation under Bob's name, kept apart from the groups.
    const aliceItem = (await listGroups(alice, alice.profiles)).items.find((g) => g.id === dm.id)!;
    expect(aliceItem).toMatchObject({ direct: true, name: bob.account.username, peerId: B, state: { kind: 'locked' } });
    expect((await listGroups(alice, alice.profiles)).items.find((g) => g.id === groupId)).toMatchObject({ direct: false, name: 'Le Port' });

    // Bob's list: under Alice's name (sealed to him beside the key) before any code; his first unlock chooses his own.
    const bobItem = (await listGroups(bob, bob.profiles)).items.find((g) => g.id === dm.id)!;
    expect(bobItem).toMatchObject({ direct: true, name: alice.account.username, state: { kind: 'first-unlock', needsKeywords: false } });
    const bobDm = (await unlockGroup(bob, bob.profiles, dm.id, '777777'))!;
    expect(bobDm).toMatchObject({ name: alice.account.username, meta: { direct: true } });
    // From then on, his code (not Alice's) opens it on his phone.
    await expect(unlockGroup(bob, bob.profiles, dm.id, '424242')).rejects.toBeInstanceOf(WrongCodeError);
    expect((await unlockGroup(bob, bob.profiles, dm.id, '777777'))!.keyVersion).toBe(1);
    await expect(unlockGroup(alice, alice.profiles, dm.id, '777777')).rejects.toBeInstanceOf(WrongCodeError);

    // Messages, both ways.
    await sendText(alice, dm.id, dm.groupKey, 1, 'en privé 🔒', newClientId());
    await sendText(bob, dm.id, bobDm.groupKey, 1, 'reçu', newClientId());
    const read = await decryptMessages(bob, bob.profiles, bobDm.keys, (await fetchSince(bob, dm.id, 0)).messages);
    expect(read.map((m) => [m.text, m.mine])).toEqual([
      ['en privé 🔒', false],
      ['reçu', true],
    ]);

    // Nobody is removed from (or added to) a private conversation, and it has no code to change.
    await expect(alice.api.removeMember(dm.id, B)).rejects.toMatchObject({ code: 'direct_conversation' });

    // Bob deletes it: gone for Alice too, and her phone forgets it.
    await bob.api.leaveGroup(dm.id);
    expect((await listGroups(alice, alice.profiles)).items.some((g) => g.id === dm.id)).toBe(false);
    await expect(fetchSince(alice, dm.id, 0)).rejects.toMatchObject({ status: 404 });
    expect(await directWith(alice, B)).toBeNull();
  });
});
