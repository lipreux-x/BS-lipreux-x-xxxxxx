import { generateGroupKey, generateIdentity } from '@/crypto';
import { initCrypto } from '@/crypto/sodium';
import { FREE_ATTEMPTS, initialLockout, registerFailure, remainingMs } from '../lockout';
import { LockedOutError, Vault, WrongCodeError, type SecretStore } from '../vault';

jest.setTimeout(60_000); // Argon2id at production cost

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

  it('caches group names sealed with the master key', async () => {
    const store = memoryStore();
    const vault = new Vault(store);
    const { masterKey } = await vault.create(account, generateIdentity(), '482913');
    await vault.saveMeta('g1', { name: 'Les Potes' }, masterKey);
    expect([...store.data.values()].join()).not.toContain('Potes');
    expect(await vault.meta('g1', masterKey)).toEqual({ name: 'Les Potes' });
  });
});
