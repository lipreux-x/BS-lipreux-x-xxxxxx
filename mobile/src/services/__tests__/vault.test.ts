import { generateGroupKey, generateIdentity } from '@/crypto';
import { initCrypto } from '@/crypto/sodium';
import { checkLockout, FREE_ATTEMPTS, initialLockout, registerFailure, remainingMs } from '../lockout';
import { LockedOutError, Vault, WrongCodeError, type SecretStore } from '../vault';

jest.setTimeout(60_000);

function memoryStore(): SecretStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    get: async (k) => data.get(k) ?? null,
    set: async (k, v) => void data.set(k, v),
    delete: async (k) => void data.delete(k),
  };
}

beforeAll(() => initCrypto());

describe('lockout', () => {
  it('allows 5 free attempts, then growing delays', () => {
    let s = initialLockout();
    for (let i = 0; i < FREE_ATTEMPTS - 1; i++) s = registerFailure(s, 0);
    expect(remainingMs(s, 0)).toBe(0);
    s = registerFailure(s, 0);
    expect(remainingMs(s, 0)).toBe(30_000);
    s = registerFailure(s, 0);
    expect(remainingMs(s, 0)).toBe(60_000);
    for (let i = 0; i < 10; i++) s = registerFailure(s, 0);
    expect(remainingMs(s, 0)).toBe(3_600_000); // capped
  });

  it('on the uptime clock, setting the date forward skips nothing', () => {
    let s = initialLockout();
    for (let i = 0; i < FREE_ATTEMPTS; i++) s = registerFailure(s, 0, 50_000);
    // Wall clock one year later, uptime 10 s later: 20 s still to wait.
    expect(remainingMs(s, 365 * 86_400_000, 60_000)).toBe(20_000);
    expect(remainingMs(s, 0, 80_000)).toBe(0);
  });

  it('a reboot restarts the wait instead of ending it', () => {
    let s = initialLockout();
    for (let i = 0; i < FREE_ATTEMPTS; i++) s = registerFailure(s, 0, 50_000);
    const after = checkLockout(s, 0, 1_000); // uptime went back: rebooted
    expect(after.remaining).toBe(30_000);
    expect(after.rebased?.upAt).toBe(1_000);
  });
});

describe('vault', () => {
  const account = { userId: 'u1', username: 'max' };

  it('stores nothing sensitive in clear', async () => {
    const store = memoryStore();
    const identity = generateIdentity();
    await new Vault(store).create(account, identity, '482913');
    const all = [...store.data.values()].join('\n');
    expect(all).not.toContain('482913');
    expect(all).not.toContain(Buffer.from(identity.signSecretKey).toString('base64url'));
    expect(all).not.toContain(Buffer.from(identity.boxSecretKey).toString('base64url'));
  });

  it('unlocks with the right code and restores the identity', async () => {
    const store = memoryStore();
    const identity = generateIdentity();
    await new Vault(store).create(account, identity, '482913');
    const unlocked = await new Vault(store).unlock('482913');
    expect(unlocked.account).toEqual(account);
    expect(unlocked.identity.signSecretKey).toEqual(identity.signSecretKey);
  });

  it('counts wrong codes, then locks out even the right code', async () => {
    const store = memoryStore();
    let now = 1_000_000;
    const vault = new Vault(store, () => now);
    await vault.create(account, generateIdentity(), '482913');

    for (let i = 1; i < FREE_ATTEMPTS; i++) {
      await expect(vault.unlock('000000')).rejects.toEqual(expect.objectContaining({ attemptsBeforeDelay: FREE_ATTEMPTS - i }));
    }
    await expect(vault.unlock('000000')).rejects.toBeInstanceOf(LockedOutError);
    await expect(vault.unlock('482913')).rejects.toBeInstanceOf(LockedOutError);

    // The counter is persisted: a fresh Vault (app restart) is still locked out.
    await expect(new Vault(store, () => now).unlock('482913')).rejects.toBeInstanceOf(LockedOutError);

    now += 30_000;
    await expect(vault.unlock('482913')).resolves.toBeDefined();
    expect((await vault.appLockout()).failures).toBe(0);
  });

  it('a wrong code is a WrongCodeError, not a crash', async () => {
    const store = memoryStore();
    const vault = new Vault(store);
    await vault.create(account, generateIdentity(), '482913');
    await expect(vault.unlock('111111')).rejects.toBeInstanceOf(WrongCodeError);
  });

  it('group keys need the group code and have their own counter', async () => {
    const store = memoryStore();
    const vault = new Vault(store);
    const { masterKey } = await vault.create(account, generateIdentity(), '482913');
    const groupKey = generateGroupKey();
    await vault.saveGroupKey('g1', 1, groupKey, '777111', masterKey);

    expect(await vault.hasGroupKey('g1', 1)).toBe(true);
    await expect(vault.openGroupKey('g1', 1, '777112', masterKey)).rejects.toBeInstanceOf(WrongCodeError);
    expect((await vault.appLockout()).failures).toBe(0);
    expect(await vault.openGroupKey('g1', 1, '777111', masterKey)).toEqual(groupKey);
  });

  it('changes the app code', async () => {
    const store = memoryStore();
    const vault = new Vault(store);
    await vault.create(account, generateIdentity(), '482913');
    await vault.changeAppCode('482913', '135790');
    await expect(vault.unlock('482913')).rejects.toBeInstanceOf(WrongCodeError);
    await expect(vault.unlock('135790')).resolves.toBeDefined();
  });

  it('keeps the verified meta sealed with the master key, with its key version', async () => {
    const store = memoryStore();
    const vault = new Vault(store);
    const { masterKey } = await vault.create(account, generateIdentity(), '482913');
    const meta = { name: 'Les Potes', keywords: ['a', 'b', 'c'], admins: ['u1'], members: ['u1'], rev: 2 };
    await vault.saveMeta('g1', meta, 3, masterKey);
    expect([...store.data.values()].join()).not.toContain('Potes');
    expect(await vault.metaRecord('g1', masterKey)).toEqual({ meta, keyVersion: 3 });
  });

  it('keeps the group secret and pinned contact keys sealed', async () => {
    const store = memoryStore();
    const vault = new Vault(store);
    const { masterKey } = await vault.create(account, generateIdentity(), '482913');
    const wrapKey = generateGroupKey();
    await vault.saveGroupSecret('g1', { wrapKey, keywords: ['plage', 'été', 'soleil'], codeVersion: 2 }, masterKey);
    await vault.pin('u2', { signPublicKey: 'SIGN', boxPublicKey: 'BOX' }, masterKey);
    const all = [...store.data.values()].join();
    expect(all).not.toContain('plage');
    expect(all).not.toContain(Buffer.from(wrapKey).toString('base64url'));
    expect(await vault.groupSecret('g1', masterKey)).toEqual({ wrapKey, keywords: ['plage', 'été', 'soleil'], codeVersion: 2 });
    expect(await vault.pinned('u2', masterKey)).toEqual({ signPublicKey: 'SIGN', boxPublicKey: 'BOX' });
    expect(await vault.pinned('u3', masterKey)).toBeNull();
  });

  it('counts an attempt before running it: killing the app mid-attempt gives no free guess', async () => {
    const store = memoryStore();
    const vault = new Vault(store);
    await vault.create(account, generateIdentity(), '482913');
    const writes: number[] = [];
    const set = store.set;
    store.set = async (k, v) => {
      if (k === 'bs.lockout_app') writes.push(JSON.parse(v).failures);
      return set(k, v);
    };
    await vault.unlock('482913');
    // Recorded as a failure first, cleared once the right code was confirmed.
    expect(writes).toEqual([1, 0]);
  });

  it('wipeAll erases the account and every group it knows', async () => {
    const store = memoryStore();
    const vault = new Vault(store);
    const { masterKey } = await vault.create(account, generateIdentity(), '482913');
    await vault.saveGroupKey('g1', 1, generateGroupKey(), '777111', masterKey);
    await vault.saveGroupSecret('g1', { wrapKey: generateGroupKey(), keywords: ['a', 'b', 'c'], codeVersion: 1 }, masterKey);
    await vault.wipeAll();
    expect(await vault.account()).toBeNull();
    expect([...store.data.keys()]).toEqual([]);
  });
});
