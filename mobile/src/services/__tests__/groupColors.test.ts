/*
 * A color per member and per group. The pure part always runs; the part
 * against a running API is opt-in, because it needs a fresh invite code:
 *
 *   cd ../server && npx tsx scripts/create-invite.ts 1     # prints an invite
 *   E2E_API_URL=https://... E2E_INVITE=XXXX-... npx jest groupColors --selectProjects libsodium
 *
 * The accounts are deleted by the test itself.
 */
import { randomInt } from 'node:crypto';
import { createKeyBackup, generateIdentity } from '@/crypto';
import { setArgon2ForTests } from '@/crypto/kdf';
import { initCrypto } from '@/crypto/sodium';
import { Api, ApiError, type Member } from '../api';
import { colorIn, colorsOf } from '../groupColors';
import { approveMember, createGroup, joinGroup, ProfileCache, unlockGroup, type Session } from '../groups';
import { nodeSqlite } from '../../../test-support/nodeSqlite';
import { LocalStore } from '../localStore';
import { Vault, type SecretStore } from '../vault';

const member = (userId: string, color?: string | null): Member => ({ userId, role: 'member', keyVersions: [1], ...(color === undefined ? {} : { color }) });

describe('group colors', () => {
  it('reads each member’s color in the group, the profile’s for someone no longer in it', () => {
    const colors = colorsOf([member('a', 'violet'), member('b', null)]);
    expect(colors).toEqual({ a: 'violet', b: null });
    expect(colorIn(colors, 'a', 'gold')).toBe('violet');
    // Chosen « Par défaut » in this group: not the color of older apps' profile.
    expect(colorIn(colors, 'b', 'gold')).toBeNull();
    expect(colorIn(colors, 'gone', 'gold')).toBe('gold');
  });

  it('keeps the profile colors with an older server, which sends none', () => {
    expect(colorsOf([member('a'), member('b')])).toBeNull();
    expect(colorIn(null, 'a', 'rose')).toBe('rose');
    expect(colorsOf([])).toEqual({});
  });
});

const API_URL = process.env.E2E_API_URL;
const INVITE = process.env.E2E_INVITE;
const run = API_URL && INVITE ? describe : describe.skip;

function memoryStore(): SecretStore {
  const data = new Map<string, string>();
  return { get: async (k) => data.get(k) ?? null, set: async (k, v) => void data.set(k, v), delete: async (k) => void data.delete(k) };
}

type Phone = Session & { profiles: ProfileCache };

async function onboard(username: string, invite: string): Promise<Phone> {
  const identity = generateIdentity();
  const { userId } = await new Api(API_URL!).register(invite, username, identity, await createKeyBackup(identity, username, 'correct horse battery 42'));
  const vault = new Vault(memoryStore());
  const unlocked = await vault.create({ userId, username }, identity, String(randomInt(100000, 999999)));
  const local = await LocalStore.open(nodeSqlite(), unlocked.masterKey);
  const s = { ...unlocked, vault, local, api: new Api(API_URL!, { userId, identity }) };
  return { ...s, profiles: new ProfileCache(s.api, vault, unlocked.masterKey) };
}

const code = (e: unknown) => (e instanceof ApiError ? e.code : String(e));

run('group colors against the API', () => {
  jest.setTimeout(600_000);
  beforeAll(async () => {
    await initCrypto();
    setArgon2ForTests(null); // the server refuses weaker backups
  });
  afterAll(() => setArgon2ForTests({ ops: 1, mem: 1024 * 1024 }));

  it('gives each member one color per group, seen by the others', async () => {
    const tag = randomInt(1000, 9999);
    const admin = await onboard(`e2e_col_a${tag}`, INVITE!);
    const bob = await onboard(`e2e_col_b${tag}`, (await admin.api.createInvite()).code);
    const outsider = await onboard(`e2e_col_c${tag}`, (await admin.api.createInvite()).code);
    try {
      const keywords = ['alpha', 'bravo', 'charlie'];
      const groupIds: string[] = [];
      for (const name of ['Colors one', 'Colors two']) {
        const groupCode = String(randomInt(1000, 10_000));
        const { id } = await createGroup(admin, name, groupCode, keywords);
        const open = (await unlockGroup(admin, admin.profiles, id, groupCode))!;
        await joinGroup(bob, groupCode, keywords);
        await approveMember(admin, admin.profiles, id, open.keys, bob.account.userId);
        groupIds.push(id);
      }
      const [one, two] = groupIds;
      const colorsSeenBy = async (p: Phone, groupId: string) => colorsOf((await p.api.members(groupId)).members);

      // Nobody chose: the default everywhere.
      expect(await colorsSeenBy(bob, one)).toEqual({ [admin.account.userId]: null, [bob.account.userId]: null });

      await expect(bob.api.setGroupColor(one, 'violet')).resolves.toEqual({ color: 'violet' });
      await bob.api.setGroupColor(two, 'gold');
      await admin.api.setGroupColor(two, 'cyan');
      expect(await colorsSeenBy(admin, one)).toEqual({ [admin.account.userId]: null, [bob.account.userId]: 'violet' });
      expect(await colorsSeenBy(admin, two)).toEqual({ [admin.account.userId]: 'cyan', [bob.account.userId]: 'gold' });

      // Back to the default in one group only.
      await bob.api.setGroupColor(one, null);
      expect((await colorsSeenBy(admin, one))?.[bob.account.userId]).toBeNull();
      expect((await colorsSeenBy(admin, two))?.[bob.account.userId]).toBe('gold');

      // Only one of the listed colors, and only in a group of mine.
      await expect(bob.api.setGroupColor(two, 'red')).rejects.toBeInstanceOf(ApiError);
      expect((await colorsSeenBy(admin, two))?.[bob.account.userId]).toBe('gold');
      expect(code(await outsider.api.setGroupColor(two, 'rose').catch((e) => e))).toBe('not_found');
    } finally {
      for (const p of [bob, outsider]) await p.api.deleteAccount(true).catch(() => {});
      await admin.api.deleteAccount(true).catch(() => {});
    }
  });
});
