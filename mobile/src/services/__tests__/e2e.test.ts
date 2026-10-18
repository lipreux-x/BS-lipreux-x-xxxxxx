/*
 * End-to-end test of the app's services against a deployed API, with two
 * simulated phones. Opt-in, because it needs a fresh invite code:
 *
 *   cd ../server && npx tsx scripts/create-invite.ts 1     # prints an invite
 *   E2E_API_URL=https://... E2E_INVITE=XXXX-... npx jest e2e
 *   cd ../server && npx tsx scripts/cleanup-test-users.ts  # removes e2e_* users
 */
import { generateIdentity } from '@/crypto';
import { initCrypto } from '@/crypto/sodium';
import { Api, type WireMessage } from '../api';
import {
  createGroup,
  decryptMessages,
  fetchSince,
  joinGroup,
  listGroups,
  newClientId,
  ProfileCache,
  sendText,
  shareMissingKeys,
  unlockGroup,
  type Session,
} from '../groups';
import { RealtimeClient } from '../realtime';
import { Vault, type SecretStore } from '../vault';

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
    const { id: groupId } = await createGroup(alice, 'Les Potes', groupCode);
    const { code } = await alice.api.createInvite();
    const bob = await onboard('bob', code, '135790');

    // Bob joins with the code; he is a member but has no key yet.
    expect(await joinGroup(bob, groupCode)).toBe(groupId);
    expect((await listGroups(bob))[0]).toMatchObject({ id: groupId, name: null, state: { kind: 'waiting-key' } });

    // Alice opens the group: her phone seals the key for Bob.
    const aliceProfiles = new ProfileCache(alice.api);
    const aliceUnlock = await unlockGroup(alice, groupId, groupCode);
    expect(aliceUnlock?.meta.name).toBe('Les Potes');
    expect(await shareMissingKeys(alice, aliceProfiles, groupId, aliceUnlock!.groupKey, 1)).toBe(1);

    // Bob's first unlock stores the key locally under the code he types.
    expect((await listGroups(bob))[0]!.state.kind).toBe('first-unlock');
    const bobUnlock = await unlockGroup(bob, groupId, groupCode);
    expect(bobUnlock?.meta.name).toBe('Les Potes');
    expect((await listGroups(bob))[0]).toMatchObject({ name: 'Les Potes', state: { kind: 'locked' } });

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
    const [chat] = await decryptMessages(alice, aliceProfiles, aliceUnlock!.groupKey, [received]);
    expect(chat).toMatchObject({ text: 'rdv à la base 🔒', senderName: bob.account.username, mine: false });

    // Resync over HTTP gives the same message.
    const history = await decryptMessages(alice, aliceProfiles, aliceUnlock!.groupKey, await fetchSince(alice, groupId, 0));
    expect(history.map((m) => m.text)).toEqual(['rdv à la base 🔒']);
  });
});
