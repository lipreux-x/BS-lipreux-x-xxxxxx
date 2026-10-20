/*
 * Creates the App Review demo account on a deployed API: `apple_review` plus a
 * second member, in a group with a short conversation, so a reviewer who signs
 * in sees a living group. Opt-in, run once, libsodium backend only:
 *
 *   cd ../server && npx tsx scripts/create-invite.ts 1     # prints an invite
 *   DEMO_API_URL=https://... DEMO_INVITE=XXXX-... npx jest demo-account --selectProjects libsodium
 *
 * Prints the credentials, group code and keywords to give App Store Connect.
 */
import { randomInt } from 'node:crypto';
import { createKeyBackup, generateIdentity } from '@/crypto';
import { setArgon2ForTests } from '@/crypto/kdf';
import { initCrypto } from '@/crypto/sodium';
import { Api } from '../api';
import { approveMember, createGroup, joinGroup, newClientId, ProfileCache, sendText, unlockGroup, type Session } from '../groups';
import { nodeSqlite } from '../../../test-support/nodeSqlite';
import { LocalStore } from '../localStore';
import { Vault, type SecretStore } from '../vault';

const API_URL = process.env.DEMO_API_URL;
const INVITE = process.env.DEMO_INVITE;
const run = API_URL && INVITE ? describe : describe.skip;

jest.setTimeout(600_000);

function memoryStore(): SecretStore {
  const data = new Map<string, string>();
  return { get: async (k) => data.get(k) ?? null, set: async (k, v) => void data.set(k, v), delete: async (k) => void data.delete(k) };
}

/** Readable but strong: three groups of letters and digits, e.g. "Kq7m-Xw3p-Rt9v". */
function randomPassword(): string {
  const chars = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const group = () => Array.from({ length: 4 }, () => chars[randomInt(chars.length)]).join('');
  return `${group()}-${group()}-${group()}-${randomInt(10, 99)}`;
}

async function onboard(username: string, password: string, invite: string): Promise<Session & { profiles: ProfileCache }> {
  const identity = generateIdentity();
  const { userId } = await new Api(API_URL!).register(invite, username, identity, await createKeyBackup(identity, username, password));
  const vault = new Vault(memoryStore());
  const unlocked = await vault.create({ userId, username }, identity, String(randomInt(100000, 999999)));
  const local = await LocalStore.open(nodeSqlite(), unlocked.masterKey);
  const s = { ...unlocked, vault, local, api: new Api(API_URL!, { userId, identity }) };
  return { ...s, profiles: new ProfileCache(s.api, vault, unlocked.masterKey) };
}

run('App Review demo account', () => {
  // Same Argon2 cost as the app: the server refuses weaker backups.
  beforeAll(async () => {
    await initCrypto();
    setArgon2ForTests(null);
  });
  afterAll(() => setArgon2ForTests({ ops: 1, mem: 1024 * 1024 }));

  it('creates the account, a second member and a group with a conversation', async () => {
    const password = randomPassword();
    const review = await onboard('apple_review', password, INVITE!);
    const camille = await onboard('camille_demo', randomPassword(), (await review.api.createInvite()).code);

    const groupCode = String(randomInt(100000, 999999));
    const keywords = ['sun', 'beach', 'summer'];
    const { id: groupId } = await createGroup(review, 'Demo group', groupCode, keywords);
    const reviewOpen = (await unlockGroup(review, review.profiles, groupId, groupCode))!;

    await joinGroup(camille, groupCode, keywords);
    await approveMember(review, review.profiles, groupId, reviewOpen.keys, camille.account.userId);
    const camilleOpen = (await unlockGroup(camille, camille.profiles, groupId, groupCode))!;

    const say = (s: Session, key: Uint8Array, text: string) => sendText(s, groupId, key, 1, text, newClientId());
    await say(camille, camilleOpen.groupKey, 'Hi! Welcome to BaseSecrète 👋');
    await say(review, reviewOpen.groupKey, 'Hello! Is this really end-to-end encrypted?');
    await say(camille, camilleOpen.groupKey, 'Yes: the server only stores ciphertext. Even the group name is encrypted.');
    await say(camille, camilleOpen.groupKey, 'Long-press a message to reply to it.');

    console.log(
      [
        'App Review demo account',
        `  username: apple_review`,
        `  password: ${password}`,
        `  group: "Demo group", code ${groupCode}, keywords ${keywords.join(' ')}`,
      ].join('\n'),
    );
  });
});
