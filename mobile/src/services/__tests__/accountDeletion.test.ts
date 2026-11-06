/*
 * Account deletion and reports (App Store rules 5.1.1(v) and 1.2) against a
 * running API. Opt-in, because it needs a fresh invite code:
 *
 *   cd ../server && npx tsx scripts/create-invite.ts 1     # prints an invite
 *   E2E_API_URL=https://... E2E_INVITE=XXXX-... npx jest accountDeletion --selectProjects libsodium
 *
 * The accounts are deleted by the test itself (their tombstones stay, as in the app).
 */
import { randomInt } from 'node:crypto';
import { createKeyBackup, generateIdentity } from '@/crypto';
import { setArgon2ForTests } from '@/crypto/kdf';
import { initCrypto } from '@/crypto/sodium';
import { Api, ApiError } from '../api';
import { approveMember, createGroup, fetchSince, joinGroup, newClientId, ProfileCache, sendText, syncGroup, unlockGroup, type Session } from '../groups';
import { nodeSqlite } from '../../../test-support/nodeSqlite';
import { LocalStore } from '../localStore';
import { Vault, type SecretStore } from '../vault';

const API_URL = process.env.E2E_API_URL;
const INVITE = process.env.E2E_INVITE;
const run = API_URL && INVITE ? describe : describe.skip;

jest.setTimeout(600_000);

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

run('account deletion and reports', () => {
  beforeAll(async () => {
    await initCrypto();
    setArgon2ForTests(null); // the server refuses weaker backups
  });
  afterAll(() => setArgon2ForTests({ ops: 1, mem: 1024 * 1024 }));

  it('reports a message, deletes a member, then the only admin', async () => {
    const tag = randomInt(1000, 9999);
    const admin = await onboard(`e2e_del_a${tag}`, INVITE!);
    const bob = await onboard(`e2e_del_b${tag}`, (await admin.api.createInvite()).code);
    const carol = await onboard(`e2e_del_c${tag}`, (await admin.api.createInvite()).code);

    const groupCode = String(randomInt(1000, 10_000));
    const keywords = ['alpha', 'bravo', 'charlie'];
    const { id: groupId } = await createGroup(admin, 'Deletion test', groupCode, keywords);
    const adminOpen = (await unlockGroup(admin, admin.profiles, groupId, groupCode))!;
    for (const p of [bob, carol]) {
      await joinGroup(p, groupCode, keywords);
      await approveMember(admin, admin.profiles, groupId, adminOpen.keys, p.account.userId);
    }
    const bobOpen = (await unlockGroup(bob, bob.profiles, groupId, groupCode))!;
    const sent = await sendText(bob, groupId, bobOpen.groupKey, bobOpen.keyVersion, 'something rude', newClientId());

    // Reports: someone else's message, with what the reporter chose to hand over.
    await expect(admin.api.report(groupId, { userId: bob.account.userId, messageId: sent.id, reason: 'abuse', excerpt: 'something rude' })).resolves.toEqual({
      reported: true,
    });
    expect(code(await admin.api.report(groupId, { userId: admin.account.userId, reason: 'spam' }).catch((e) => e))).toBe('invalid_member');
    expect(code(await carol.api.report(groupId, { userId: admin.account.userId, messageId: sent.id, reason: 'spam' }).catch((e) => e))).toBe('not_found');

    // A member goes: out of the group, their messages gone, no sign-in any more.
    await expect(bob.api.deleteAccount()).resolves.toEqual({ deleted: true });
    const left = await fetchSince(admin, groupId, 0);
    expect(left.messages.some((m) => m.senderId === bob.account.userId)).toBe(false);
    const bobAgain = new Api(API_URL!, { userId: bob.account.userId, identity: bob.identity });
    expect(code(await bobAgain.me().catch((e) => e))).toBe('not_found');
    // Nothing of Bob is left in the group: his profile is not handed out any more.
    expect(await admin.api.profiles([bob.account.userId])).toEqual([]);

    // Bob held the key: nothing new goes out under it until an admin's phone draws the next one.
    const carolOld = (await unlockGroup(carol, carol.profiles, groupId, groupCode))!;
    expect(code(await sendText(carol, groupId, carolOld.groupKey, carolOld.keyVersion, 'hello?', newClientId()).catch((e) => e))).toBe('rotation_pending');
    const rotated = await syncGroup(admin, admin.profiles, groupId, adminOpen.keys);
    expect(rotated.keyVersion).toBe(carolOld.keyVersion + 1);
    const carolNew = await syncGroup(carol, carol.profiles, groupId, carolOld.keys);
    await sendText(carol, groupId, carolNew.keys.get(carolNew.keyVersion)!, carolNew.keyVersion, 'hello again', newClientId());

    // The only admin, with Carol still in: refused unless forced.
    expect(code(await admin.api.deleteAccount().catch((e) => e))).toBe('handover_required');
    await expect(admin.api.deleteAccount(true)).resolves.toEqual({ deleted: true });

    // What the admin signed still verifies for Carol, even on a new phone (fresh profile cache). No admin is
    // left to draw the key the admin held: Carol's phone does, and names her admin.
    const fresh = new ProfileCache(carol.api, carol.vault, carol.masterKey);
    expect(code(await sendText(carol, groupId, carolNew.keys.get(carolNew.keyVersion)!, carolNew.keyVersion, 'x', newClientId()).catch((e) => e))).toBe(
      'rotation_pending',
    );
    const orphan = await syncGroup(carol, fresh, groupId, carolNew.keys);
    expect(orphan.keyVersion).toBe(carolNew.keyVersion + 1);
    expect(orphan.meta.admins).toEqual([carol.account.userId]);
    await sendText(carol, groupId, orphan.keys.get(orphan.keyVersion)!, orphan.keyVersion, 'still here', newClientId());
    const [tomb] = await carol.api.profiles([admin.account.userId]);
    expect(tomb?.username).toMatch(/^deleted_/);
    expect(tomb?.avatar).toBeNull();

    // A name a deleted account is left with cannot be taken.
    const squatter = generateIdentity();
    const backup = await createKeyBackup(squatter, tomb!.username, 'correct horse battery 42');
    const squat = await new Api(API_URL!)
      .register((await carol.api.createInvite()).code, tomb!.username, squatter, backup)
      .catch((e: unknown) => e);
    expect(code(squat)).toBe('username_taken');

    await expect(carol.api.deleteAccount()).resolves.toEqual({ deleted: true });
  });
});
