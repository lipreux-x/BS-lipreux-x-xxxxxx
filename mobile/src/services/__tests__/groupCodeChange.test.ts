/*
 * Group code changes seen from every phone, against an in-memory server that
 * keeps the real server's rules (server/src/app.ts): handouts re-wrapped and
 * code_version bumped on a change, rotation on a stale version refused.
 * Members whose phone still holds the old code must get back in with the new
 * one, and no phone may hand a key out under a code nobody types any more.
 */
import { generateIdentity, toPublicIdentity, type Identity } from '@/crypto';
import { initCrypto } from '@/crypto/sodium';
import { ApiError, type Api, type GroupSummary, type Profile, type WireHandout } from '../api';
import {
  approveMember,
  changeGroupCode,
  CodeChangedError,
  createGroup,
  joinGroup,
  listGroups,
  ProfileCache,
  relockGroup,
  rotateNow,
  setAdmins,
  syncGroup,
  unlockGroup,
  type GroupKeys,
  type Session,
} from '../groups';
import { nodeSqlite } from '../../../test-support/nodeSqlite';
import { LocalStore } from '../localStore';
import { Vault, WrongCodeError, type SecretStore } from '../vault';

jest.setTimeout(120_000);

interface Row {
  id: string;
  encryptedMeta: string;
  metaSignerId: string;
  metaSignature: string;
  joinKey: string;
  currentKeyVersion: number;
  codeVersion: number;
  rotationPending: boolean;
  members: Map<string, { role: 'admin' | 'member'; status: 'active' | 'pending' }>;
  keys: (WireHandout & { userId: string })[];
}

/** The server's group rules, in memory. */
class FakeServer {
  readonly profiles = new Map<string, Profile>();
  readonly groups = new Map<string, Row>();

  as(me: string): Api {
    const g = (id: string) => this.groups.get(id)!;
    const api = {
      profiles: async (ids: string[]) => ids.flatMap((id) => (this.profiles.has(id) ? [this.profiles.get(id)!] : [])),
      groups: async () =>
        [...this.groups.values()]
          .filter((r) => r.members.has(me))
          .map((r): GroupSummary => {
            const m = r.members.get(me)!;
            if (m.status === 'pending') return { id: r.id, status: 'pending', expiresAt: null } as unknown as GroupSummary;
            return {
              id: r.id,
              status: 'active',
              encryptedMeta: r.encryptedMeta,
              metaSignerId: r.metaSignerId,
              metaSignature: r.metaSignature,
              currentKeyVersion: r.currentKeyVersion,
              ephemeralSeconds: null,
              rotationPending: r.rotationPending,
              codeVersion: r.codeVersion,
              expiresAt: null,
              role: m.role,
              sealedKeys: r.keys.filter((k) => k.userId === me).map(({ userId: _, ...k }) => k),
            };
          }),
      createGroup: async (i: { id: string; encryptedMeta: string; metaSignature: string; joinKey: string; sealedKey: string; keySignature: string }) => {
        this.groups.set(i.id, {
          id: i.id,
          encryptedMeta: i.encryptedMeta,
          metaSignerId: me,
          metaSignature: i.metaSignature,
          joinKey: i.joinKey,
          currentKeyVersion: 1,
          codeVersion: 1,
          rotationPending: false,
          members: new Map([[me, { role: 'admin', status: 'active' }]]),
          keys: [{ userId: me, keyVersion: 1, sealedKey: i.sealedKey, signerId: me, signature: i.keySignature }],
        });
        return { id: i.id, currentKeyVersion: 1 };
      },
      joinGroup: async (joinKey: string) => {
        const r = [...this.groups.values()].find((x) => x.joinKey === joinKey);
        if (!r) throw new ApiError(403, 'wrong_code');
        if (!r.members.has(me)) r.members.set(me, { role: 'member', status: 'pending' });
        return { groupId: r.id, status: r.members.get(me)!.status };
      },
      members: async (id: string) => {
        const r = g(id);
        const all = [...r.members.entries()];
        return {
          currentKeyVersion: r.currentKeyVersion,
          members: all
            .filter(([, m]) => m.status === 'active')
            .map(([userId, m]) => ({ userId, role: m.role, keyVersions: r.keys.filter((k) => k.userId === userId).map((k) => k.keyVersion) })),
          pending: all.filter(([, m]) => m.status === 'pending').map(([userId]) => ({ userId, requestedAt: '' })),
        };
      },
      approveMember: async (id: string, userId: string, i: { keyVersion: number; sealedKey: string; keySignature: string; encryptedMeta: string; metaSignature: string }) => {
        const r = g(id);
        if (i.keyVersion !== r.currentKeyVersion) throw new ApiError(409, 'stale_key_version');
        r.members.set(userId, { role: 'member', status: 'active' });
        r.keys.push({ userId, keyVersion: i.keyVersion, sealedKey: i.sealedKey, signerId: me, signature: i.keySignature });
        Object.assign(r, { encryptedMeta: i.encryptedMeta, metaSignature: i.metaSignature, metaSignerId: me });
        return { approved: true };
      },
      rotateKey: async (id: string, i: { fromKeyVersion: number; encryptedMeta: string; metaSignature: string; admins: string[]; keys: { userId: string; sealedKey: string; signature: string }[] }) => {
        const r = g(id);
        if (i.fromKeyVersion !== r.currentKeyVersion) throw new ApiError(409, 'stale_key_version');
        const v = r.currentKeyVersion + 1;
        for (const k of i.keys) r.keys.push({ userId: k.userId, keyVersion: v, sealedKey: k.sealedKey, signerId: me, signature: k.signature });
        for (const [uid, m] of r.members) if (m.status === 'active') m.role = i.admins.includes(uid) ? 'admin' : 'member';
        Object.assign(r, { currentKeyVersion: v, rotationPending: false, encryptedMeta: i.encryptedMeta, metaSignature: i.metaSignature, metaSignerId: me });
        return { currentKeyVersion: v };
      },
      setAdmins: async (id: string, i: { keyVersion: number; admins: string[]; encryptedMeta: string; metaSignature: string }) => {
        const r = g(id);
        if (i.keyVersion !== r.currentKeyVersion) throw new ApiError(409, 'stale_key_version');
        for (const [uid, m] of r.members) if (m.status === 'active') m.role = i.admins.includes(uid) ? 'admin' : 'member';
        Object.assign(r, { encryptedMeta: i.encryptedMeta, metaSignature: i.metaSignature, metaSignerId: me });
        return { admins: i.admins };
      },
      removeMember: async (id: string, userId: string) => {
        const r = g(id);
        r.members.delete(userId);
        r.keys = r.keys.filter((k) => k.userId !== userId);
        r.rotationPending = true;
        return { removed: true };
      },
      changeGroupCode: async (
        id: string,
        i: { joinKey: string; keyVersion: number; encryptedMeta: string; metaSignature: string; keys: { userId: string; keyVersion: number; sealedKey: string; signature: string }[] },
      ) => {
        const r = g(id);
        if (i.keyVersion !== r.currentKeyVersion) throw new ApiError(409, 'stale_key_version');
        r.keys = i.keys.map((k) => ({ ...k, signerId: me }));
        Object.assign(r, { joinKey: i.joinKey, encryptedMeta: i.encryptedMeta, metaSignature: i.metaSignature, metaSignerId: me, codeVersion: r.codeVersion + 1 });
        return { codeVersion: r.codeVersion };
      },
    };
    return api as unknown as Api;
  }
}

function memoryStore(): SecretStore {
  const data = new Map<string, string>();
  return { get: async (k) => data.get(k) ?? null, set: async (k, v) => void data.set(k, v), delete: async (k) => void data.delete(k) };
}

type Phone = Session & { profiles: ProfileCache };

async function phone(server: FakeServer, name: string): Promise<Phone> {
  const identity: Identity = generateIdentity();
  const userId = crypto.randomUUID();
  server.profiles.set(userId, { id: userId, username: name, ...toPublicIdentity(identity) });
  const vault = new Vault(memoryStore());
  const unlocked = await vault.create({ userId, username: name }, identity, '482913');
  const local = await LocalStore.open(nodeSqlite(), unlocked.masterKey);
  const s: Session = { ...unlocked, vault, local, api: server.as(userId) };
  return { ...s, profiles: new ProfileCache(s.api, vault, unlocked.masterKey) };
}

const WORDS = ['lune', 'mer', 'vent'];

/** Admin creates the group, each member asks to join with the code and is approved, then unlocks it once. */
async function groupWith(server: FakeServer, n: number) {
  const admin = await phone(server, 'admin');
  const { id, groupKey } = await createGroup(admin, 'Les Potes', '111111', WORDS);
  const keys: GroupKeys = new Map([[1, groupKey]]);
  const members: Phone[] = [];
  for (let i = 0; i < n; i++) {
    const m = await phone(server, `m${i}`);
    await joinGroup(m, '111111', WORDS);
    await approveMember(admin, admin.profiles, id, keys, m.account.userId);
    expect(await unlockGroup(m, m.profiles, id, '111111')).toMatchObject({ codeChanged: false });
    members.push(m);
  }
  return { admin, id, keys, members };
}

beforeAll(() => initCrypto());

describe('group code changes', () => {
  it('two code changes: the newest code opens the group directly, the old one still leads to it', async () => {
    const server = new FakeServer();
    const { admin, id, keys, members } = await groupWith(server, 2);
    await changeGroupCode(admin, admin.profiles, id, keys, '222222', WORDS);
    await changeGroupCode(admin, admin.profiles, id, keys, '333333', WORDS);
    const [a, b] = members as [Phone, Phone];

    expect((await listGroups(a)).items[0]!.state).toEqual({ kind: 'locked', codeChanged: true });
    // The code in between opens nothing.
    await expect(unlockGroup(a, a.profiles, id, '222222')).rejects.toBeInstanceOf(WrongCodeError);
    // The newest one does, and from then on it is the code of this phone.
    expect(await unlockGroup(a, a.profiles, id, '333333')).toMatchObject({ codeChanged: false, keyVersion: 1 });
    expect((await listGroups(a)).items[0]!.state).toEqual({ kind: 'locked', codeChanged: false });
    expect(await unlockGroup(a, a.profiles, id, '333333')).toMatchObject({ codeChanged: false });
    await expect(unlockGroup(a, a.profiles, id, '111111')).rejects.toBeInstanceOf(WrongCodeError);

    // The very first code still works once, then asks for the new one (relock).
    const old = await unlockGroup(b, b.profiles, id, '111111');
    expect(old).toMatchObject({ codeChanged: true });
    await relockGroup(b, b.profiles, id, old!.keys, '333333');
    expect(await unlockGroup(b, b.profiles, id, '333333')).toMatchObject({ codeChanged: false });
  });

  it('new keywords too: the new code with the old keywords fails, with the new ones it opens', async () => {
    const server = new FakeServer();
    const { admin, id, keys, members } = await groupWith(server, 1);
    await changeGroupCode(admin, admin.profiles, id, keys, '444444', ['soleil', 'pluie', 'neige']);
    const [a] = members as [Phone];
    await expect(unlockGroup(a, a.profiles, id, '444444')).rejects.toBeInstanceOf(WrongCodeError);
    expect(await unlockGroup(a, a.profiles, id, '444444', ['soleil', 'pluie', 'neige'])).toMatchObject({
      codeChanged: false,
      meta: { keywords: ['soleil', 'pluie', 'neige'] },
    });
  });

  it('group open during the change, then a key rotation: sync says the code changed, the new code opens the new key', async () => {
    const server = new FakeServer();
    const { admin, id, keys, members } = await groupWith(server, 2);
    const [a, gone] = members as [Phone, Phone];
    const openKeys = (await unlockGroup(a, a.profiles, id, '111111'))!.keys;
    await changeGroupCode(admin, admin.profiles, id, keys, '555555', ['soleil', 'pluie', 'neige']);
    // Someone is removed: the admin rotates under the new code.
    await admin.api.removeMember(id, gone.account.userId);
    await rotateNow(admin, admin.profiles, id, keys);

    await expect(syncGroup(a, a.profiles, id, openKeys)).rejects.toBeInstanceOf(CodeChangedError);
    // Old code: the kept key opens, then the relock needs the new keywords (the verified meta is older).
    const old = await unlockGroup(a, a.profiles, id, '111111');
    expect(old).toMatchObject({ codeChanged: true, keyVersion: 1 });
    await expect(relockGroup(a, a.profiles, id, old!.keys, '555555')).rejects.toBeInstanceOf(WrongCodeError);
    const r = await relockGroup(a, a.profiles, id, old!.keys, '555555', ['soleil', 'pluie', 'neige']);
    expect(r.keyVersion).toBe(2);
    expect(await unlockGroup(a, a.profiles, id, '555555')).toMatchObject({ codeChanged: false, keyVersion: 2 });
  });

  it('a second admin still on the old code neither rotates nor approves under it', async () => {
    const server = new FakeServer();
    const { admin, id, keys, members } = await groupWith(server, 2);
    const [admin2, leaver] = members as [Phone, Phone];
    await setAdmins(admin, admin.profiles, id, keys, [admin.account.userId, admin2.account.userId]);
    const open2 = (await unlockGroup(admin2, admin2.profiles, id, '111111'))!.keys;

    await changeGroupCode(admin, admin.profiles, id, keys, '666666', WORDS);
    await admin.api.removeMember(id, leaver.account.userId);
    // admin2's phone, open with the old code: no rotation from it (the others could not open that key).
    await syncGroup(admin2, admin2.profiles, id, open2);
    expect(server.groups.get(id)!.rotationPending).toBe(true);
    await expect(rotateNow(admin2, admin2.profiles, id, open2)).rejects.toBeInstanceOf(CodeChangedError);

    // A newcomer who knows only the new code: admin2 must not approve with the old one.
    const newcomer = await phone(server, 'newcomer');
    await joinGroup(newcomer, '666666', WORDS);
    await expect(approveMember(admin2, admin2.profiles, id, open2, newcomer.account.userId)).rejects.toBeInstanceOf(CodeChangedError);
    // The first admin rotates and approves: the newcomer opens with the new code.
    const now = await syncGroup(admin, admin.profiles, id, keys);
    await approveMember(admin, admin.profiles, id, now.keys, newcomer.account.userId);
    expect(await unlockGroup(newcomer, newcomer.profiles, id, '666666')).toMatchObject({ codeChanged: false });
  });

  it('asked to join before a code change: the old code is a wrong code, the new one opens', async () => {
    const server = new FakeServer();
    const { admin, id, keys } = await groupWith(server, 0);
    const late = await phone(server, 'late');
    await joinGroup(late, '111111', WORDS);
    await changeGroupCode(admin, admin.profiles, id, keys, '777777', WORDS);
    await approveMember(admin, admin.profiles, id, keys, late.account.userId);

    expect((await listGroups(late)).items[0]!.state).toEqual({ kind: 'first-unlock', needsKeywords: false });
    await expect(unlockGroup(late, late.profiles, id, '111111')).rejects.toBeInstanceOf(WrongCodeError);
    expect(await unlockGroup(late, late.profiles, id, '777777')).toMatchObject({ codeChanged: false });
  });

  it('a wrong code counts once, whichever way it was tried', async () => {
    const server = new FakeServer();
    const { admin, id, keys, members } = await groupWith(server, 1);
    await changeGroupCode(admin, admin.profiles, id, keys, '888888', WORDS);
    const [a] = members as [Phone];
    const err = await unlockGroup(a, a.profiles, id, '999999').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(WrongCodeError);
    const first = (err as WrongCodeError).attemptsBeforeDelay;
    const err2 = (await unlockGroup(a, a.profiles, id, '999998').catch((e: unknown) => e)) as WrongCodeError;
    expect(err2.attemptsBeforeDelay).toBe(first - 1);
  });
});
