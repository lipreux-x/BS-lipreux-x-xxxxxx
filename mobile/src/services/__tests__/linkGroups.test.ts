/*
 * Groups without a code, against an in-memory server that keeps the real
 * server's rules for them (server/src/app.ts): a link opens one join request
 * and is burnt by it, whatever the admin decides; a removed member is banned.
 * On the phones: no code is ever typed, the key is kept under the master key,
 * and a newcomer gets the key only once an admin approves.
 */
import { generateIdentity, toPublicIdentity, type Identity } from '@/crypto';
import { initCrypto } from '@/crypto/sodium';
import { ApiError, type Api, type GroupSummary, type Profile, type WireHandout } from '../api';
import { groupLinkUrl, parseGroupLink } from '../groupLink';
import {
  approveMember,
  changeGroupCode,
  createGroup,
  createGroupLink,
  joinWithLink,
  listGroups,
  ProfileCache,
  rejectMember,
  revokeGroupLinks,
  rotateNow,
  unlockGroup,
  type GroupKeys,
  type Session,
} from '../groups';
import { nodeSqlite } from '../../../test-support/nodeSqlite';
import { LocalStore } from '../localStore';
import { Vault, type SecretStore } from '../vault';

jest.setTimeout(120_000);

interface Row {
  id: string;
  kind: 'group' | 'link';
  encryptedMeta: string;
  metaSignerId: string;
  metaSignature: string;
  currentKeyVersion: number;
  rotationPending: boolean;
  members: Map<string, { role: 'admin' | 'member'; status: 'active' | 'pending' }>;
  keys: (WireHandout & { userId: string })[];
  bans: Set<string>;
}

/** The server's rules for groups without a code, in memory. */
class FakeServer {
  readonly profiles = new Map<string, Profile>();
  readonly groups = new Map<string, Row>();
  readonly links = new Map<string, { groupId: string; usedBy: string | null; expiresAt: number }>();
  private n = 0;

  as(me: string): Api {
    const g = (id: string) => this.groups.get(id)!;
    const admin = (id: string) => {
      if (g(id).members.get(me)?.role !== 'admin') throw new ApiError(403, 'admin_only');
    };
    const api = {
      profiles: async (ids: string[]) => ids.flatMap((id) => (this.profiles.has(id) ? [this.profiles.get(id)!] : [])),
      unread: async () => ({}),
      groups: async () =>
        [...this.groups.values()]
          .filter((r) => r.members.has(me))
          .map((r): GroupSummary => {
            const m = r.members.get(me)!;
            if (m.status === 'pending') return { id: r.id, status: 'pending', expiresAt: null } as unknown as GroupSummary;
            return {
              id: r.id,
              status: 'active',
              kind: r.kind,
              encryptedMeta: r.encryptedMeta,
              metaSignerId: r.metaSignerId,
              metaSignature: r.metaSignature,
              currentKeyVersion: r.currentKeyVersion,
              ephemeralSeconds: null,
              rotationPending: r.rotationPending,
              codeVersion: 1,
              expiresAt: null,
              role: m.role,
              sealedKeys: r.keys.filter((k) => k.userId === me).map(({ userId: _, ...k }) => k),
            };
          }),
      createGroup: async (i: { id: string; kind?: 'group' | 'link'; joinKey?: string; encryptedMeta: string; metaSignature: string; sealedKey: string; keySignature: string; sealedLabel?: string; labelSignature?: string }) => {
        const kind = i.kind ?? 'group';
        if ((kind === 'group') !== !!i.joinKey) throw new ApiError(400, 'invalid_body');
        this.groups.set(i.id, {
          id: i.id,
          kind,
          encryptedMeta: i.encryptedMeta,
          metaSignerId: me,
          metaSignature: i.metaSignature,
          currentKeyVersion: 1,
          rotationPending: false,
          members: new Map([[me, { role: 'admin', status: 'active' }]]),
          keys: [{ userId: me, keyVersion: 1, sealedKey: i.sealedKey, signerId: me, signature: i.keySignature, sealedLabel: i.sealedLabel, labelSignature: i.labelSignature }],
          bans: new Set(),
        });
        return { id: i.id, currentKeyVersion: 1 };
      },
      createGroupLink: async (id: string) => {
        admin(id);
        if (g(id).kind !== 'link') throw new ApiError(400, 'not_a_link_group');
        const code = `LINK-${String(++this.n).padStart(4, '0')}-AAAA-BBBB`;
        this.links.set(code, { groupId: id, usedBy: null, expiresAt: Date.now() + 86_400_000 });
        return { code, expiresAt: new Date(Date.now() + 86_400_000).toISOString() };
      },
      revokeGroupLinks: async (id: string) => {
        admin(id);
        let revoked = 0;
        for (const [code, l] of this.links) {
          if (l.groupId !== id || l.usedBy) continue;
          this.links.delete(code);
          revoked++;
        }
        return { revoked };
      },
      joinWithLink: async (code: string) => {
        const l = this.links.get(code);
        const r = l && this.groups.get(l.groupId);
        if (!l || !r || r.kind !== 'link') throw new ApiError(403, 'invalid_link');
        const already = r.members.get(me);
        if (already) return { groupId: r.id, status: already.status };
        if (l.usedBy || l.expiresAt < Date.now() || r.bans.has(me)) throw new ApiError(403, 'invalid_link');
        l.usedBy = me;
        r.members.set(me, { role: 'member', status: 'pending' });
        return { groupId: r.id, status: 'pending' as const };
      },
      members: async (id: string) => {
        const r = g(id);
        const all = [...r.members.entries()];
        return {
          currentKeyVersion: r.currentKeyVersion,
          members: all
            .filter(([, m]) => m.status === 'active')
            .map(([userId, m]) => ({
              userId,
              role: m.role,
              keyVersions: r.keys.filter((k) => k.userId === userId).map((k) => k.keyVersion),
              unlabelledKeyVersions: r.keys.filter((k) => k.userId === userId && !k.sealedLabel).map((k) => k.keyVersion),
            })),
          pending: all.filter(([, m]) => m.status === 'pending').map(([userId]) => ({ userId, requestedAt: '' })),
        };
      },
      approveMember: async (
        id: string,
        userId: string,
        i: { keyVersion: number; sealedKey: string; keySignature: string; sealedLabel?: string; labelSignature?: string; encryptedMeta: string; metaSignature: string },
      ) => {
        admin(id);
        const r = g(id);
        if (i.keyVersion !== r.currentKeyVersion) throw new ApiError(409, 'stale_key_version');
        if (r.members.get(userId)?.status !== 'pending') throw new ApiError(404, 'not_found');
        r.members.set(userId, { role: 'member', status: 'active' });
        r.keys.push({ userId, keyVersion: i.keyVersion, sealedKey: i.sealedKey, signerId: me, signature: i.keySignature, sealedLabel: i.sealedLabel, labelSignature: i.labelSignature });
        Object.assign(r, { encryptedMeta: i.encryptedMeta, metaSignature: i.metaSignature, metaSignerId: me });
        return { approved: true };
      },
      rejectMember: async (id: string, userId: string) => {
        admin(id);
        if (g(id).members.get(userId)?.status !== 'pending') throw new ApiError(404, 'not_found');
        g(id).members.delete(userId);
        return { rejected: true };
      },
      removeMember: async (id: string, userId: string) => {
        admin(id);
        const r = g(id);
        r.members.delete(userId);
        r.keys = r.keys.filter((k) => k.userId !== userId);
        r.bans.add(userId);
        r.rotationPending = true;
        return { removed: true };
      },
      rotateKey: async (
        id: string,
        i: { fromKeyVersion: number; encryptedMeta: string; metaSignature: string; admins: string[]; keys: { userId: string; sealedKey: string; signature: string; sealedLabel?: string; labelSignature?: string }[] },
      ) => {
        const r = g(id);
        if (i.fromKeyVersion !== r.currentKeyVersion) throw new ApiError(409, 'stale_key_version');
        const v = r.currentKeyVersion + 1;
        for (const k of i.keys) r.keys.push({ userId: k.userId, keyVersion: v, sealedKey: k.sealedKey, signerId: me, signature: k.signature, sealedLabel: k.sealedLabel, labelSignature: k.labelSignature });
        Object.assign(r, { currentKeyVersion: v, rotationPending: false, encryptedMeta: i.encryptedMeta, metaSignature: i.metaSignature, metaSignerId: me });
        return { currentKeyVersion: v };
      },
      labelKeys: async () => ({ labelled: 0 }),
    };
    return api as unknown as Api;
  }
}

function memoryStore(): SecretStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, get: async (k) => data.get(k) ?? null, set: async (k, v) => void data.set(k, v), delete: async (k) => void data.delete(k) };
}

type Phone = Session & { profiles: ProfileCache; store: ReturnType<typeof memoryStore> };

async function phone(server: FakeServer, name: string): Promise<Phone> {
  const identity: Identity = generateIdentity();
  const userId = crypto.randomUUID();
  server.profiles.set(userId, { id: userId, username: name, ...toPublicIdentity(identity) });
  const store = memoryStore();
  const vault = new Vault(store);
  const unlocked = await vault.create({ userId, username: name }, identity, '482913');
  const local = await LocalStore.open(nodeSqlite(), unlocked.masterKey);
  const s: Session = { ...unlocked, vault, local, api: server.as(userId) };
  return { ...s, store, profiles: new ProfileCache(s.api, vault, unlocked.masterKey) };
}

/** A group without a code, made by `admin`. */
async function linkGroup(server: FakeServer) {
  const admin = await phone(server, 'admin');
  const { id, groupKey, meta } = await createGroup(admin, 'Le Garage', null, []);
  return { admin, id, keys: new Map([[1, groupKey]]) as GroupKeys, meta };
}

beforeAll(() => initCrypto());

describe('groups without a code', () => {
  it('created without code nor keywords: the signed meta says so, and the admin opens it with nothing to type', async () => {
    const server = new FakeServer();
    const { admin, id, meta } = await linkGroup(server);
    expect(meta).toMatchObject({ name: 'Le Garage', keywords: [], link: true });
    expect(server.groups.get(id)!.kind).toBe('link');
    const [item] = (await listGroups(admin, admin.profiles)).items;
    expect(item).toMatchObject({ id, link: true, state: { kind: 'locked', codeChanged: false } });
    expect(await unlockGroup(admin, admin.profiles, id, '')).toMatchObject({ keyVersion: 1, name: 'Le Garage', meta: { link: true } });
  });

  it('a link files one request; once approved, the newcomer opens the group with no code', async () => {
    const server = new FakeServer();
    const { admin, id, keys } = await linkGroup(server);
    const { code } = await createGroupLink(admin, id);
    const bob = await phone(server, 'bob');

    expect(await joinWithLink(bob, code)).toBe(id);
    expect((await listGroups(bob, bob.profiles)).items[0]).toMatchObject({ id, state: { kind: 'pending' } });
    await approveMember(admin, admin.profiles, id, keys, bob.account.userId);

    expect((await listGroups(bob, bob.profiles)).items[0]).toMatchObject({ link: true, state: { kind: 'first-unlock', needsKeywords: false } });
    const opened = (await unlockGroup(bob, bob.profiles, id, ''))!;
    expect(opened.groupKey).toEqual(keys.get(1));
    expect(opened.meta.members).toEqual([admin.account.userId, bob.account.userId]);
    // From then on the key is on the phone, under the master key alone.
    expect((await listGroups(bob, bob.profiles)).items[0]!.state).toEqual({ kind: 'locked', codeChanged: false });
    expect((await unlockGroup(bob, bob.profiles, id, ''))!.groupKey).toEqual(keys.get(1));
  });

  it('a link works once: a second person, or the same one after a refusal, needs a new one', async () => {
    const server = new FakeServer();
    const { admin, id } = await linkGroup(server);
    const { code } = await createGroupLink(admin, id);
    const bob = await phone(server, 'bob');
    const eve = await phone(server, 'eve');

    await joinWithLink(bob, code);
    await expect(joinWithLink(eve, code)).rejects.toMatchObject({ code: 'invalid_link' });
    // Bob tapping it again while his request waits: still his, nothing burnt twice.
    expect(await joinWithLink(bob, code)).toBe(id);

    await rejectMember(admin, id, bob.account.userId);
    await expect(joinWithLink(bob, code)).rejects.toMatchObject({ code: 'invalid_link' });
    expect(await joinWithLink(bob, (await createGroupLink(admin, id)).code)).toBe(id);
  });

  it('revoked links stop working; a removed member cannot come back, even with a new link', async () => {
    const server = new FakeServer();
    const { admin, id, keys } = await linkGroup(server);
    const sent = await createGroupLink(admin, id);
    expect(await revokeGroupLinks(admin, id)).toBe(1);
    const bob = await phone(server, 'bob');
    await expect(joinWithLink(bob, sent.code)).rejects.toMatchObject({ code: 'invalid_link' });

    await joinWithLink(bob, (await createGroupLink(admin, id)).code);
    await approveMember(admin, admin.profiles, id, keys, bob.account.userId);
    await unlockGroup(bob, bob.profiles, id, '');
    await admin.api.removeMember(id, bob.account.userId);
    const r = await rotateNow(admin, admin.profiles, id, keys);
    expect(r.keyVersion).toBe(2);
    expect(r.meta.members).toEqual([admin.account.userId]);
    await expect(joinWithLink(bob, (await createGroupLink(admin, id)).code)).rejects.toMatchObject({ code: 'invalid_link' });
  });

  it('after a rotation the members still open it with no code, under the new key', async () => {
    const server = new FakeServer();
    const { admin, id, keys } = await linkGroup(server);
    const [bob, carol] = [await phone(server, 'bob'), await phone(server, 'carol')];
    for (const p of [bob, carol]) {
      await joinWithLink(p, (await createGroupLink(admin, id)).code);
      await approveMember(admin, admin.profiles, id, keys, p.account.userId);
      await unlockGroup(p, p.profiles, id, '');
    }
    await admin.api.removeMember(id, carol.account.userId);
    const r = await rotateNow(admin, admin.profiles, id, keys);
    const opened = (await unlockGroup(bob, bob.profiles, id, ''))!;
    expect(opened.keyVersion).toBe(2);
    expect(opened.groupKey).toEqual(r.keys.get(2));
  });

  it('nothing to change: no code, and the server cannot pass a coded group off as one without (or back)', async () => {
    const server = new FakeServer();
    const { admin, id, keys } = await linkGroup(server);
    await expect(changeGroupCode(admin, admin.profiles, id, keys, '1234', ['a', 'b', 'c'])).rejects.toMatchObject({ code: 'no_group_code' });

    // The server says 'group': the signed meta says otherwise, the phone refuses it.
    server.groups.get(id)!.kind = 'group';
    await expect(unlockGroup(admin, admin.profiles, id, '1234')).rejects.toThrow();
    server.groups.get(id)!.kind = 'link';

    const coded = await createGroup(admin, 'Le Coffre', '1234', ['pelle', 'tunnel', 'lingot']);
    server.groups.get(coded.id)!.kind = 'link';
    await expect(unlockGroup(admin, admin.profiles, coded.id, '')).rejects.toThrow();
  });

  it('signed in again on a new phone: the group opens with no code and no keywords', async () => {
    const server = new FakeServer();
    const { admin, id, keys } = await linkGroup(server);
    const bob = await phone(server, 'bob');
    await joinWithLink(bob, (await createGroupLink(admin, id)).code);
    await approveMember(admin, admin.profiles, id, keys, bob.account.userId);

    // Same account and identity, empty vault: as after « Se connecter ».
    const vault = new Vault(memoryStore());
    const again = await vault.create(bob.account, bob.identity, '135790');
    const local = await LocalStore.open(nodeSqlite(), again.masterKey);
    const s: Session = { ...again, vault, local, api: bob.api };
    const profiles = new ProfileCache(s.api, vault, again.masterKey);
    expect((await listGroups(s, profiles)).items[0]!.state).toEqual({ kind: 'first-unlock', needsKeywords: false });
    expect((await unlockGroup(s, profiles, id, ''))!.groupKey).toEqual(keys.get(1));
  });
});

describe('group links', () => {
  it('the code comes back out of the link, a pasted message, or typed by hand', () => {
    const url = groupLinkUrl('AB12-CD34-EF56-GH78');
    expect(url).toBe('basesecrete://invite/AB12-CD34-EF56-GH78');
    expect(parseGroupLink(url)).toBe('AB12-CD34-EF56-GH78');
    expect(parseGroupLink(`Invitation à un groupe BaseSecrète…\n${url}`)).toBe('AB12-CD34-EF56-GH78');
    expect(parseGroupLink('basesecrete-dev://invite/ab12cd34ef56gh78')).toBe('AB12CD34EF56GH78');
    expect(parseGroupLink(' ab12-cd34-ef56-gh78 ')).toBe('AB12-CD34-EF56-GH78');
    for (const bad of ['', 'basesecrete://invite/', 'AB12-CD34', 'basesecrete://group/new']) expect(parseGroupLink(bad)).toBeNull();
  });
});
