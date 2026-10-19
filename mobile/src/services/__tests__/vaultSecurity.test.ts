import { generateGroupKey, generateIdentity } from '@/crypto';
import { initCrypto } from '@/crypto/sodium';
import { FREE_ATTEMPTS } from '../lockout';
import { BIOMETRIC_MAX_AGE_MS, LockedOutError, Vault, WipedError, WrongCodeError, type BiometricStore, type SecretStore } from '../vault';

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

const account = { userId: 'u1', username: 'max' };

describe('self-destruct after wrong app codes (SPEC §4.5)', () => {
  it('is off by default: wrong codes only delay', async () => {
    let now = 0;
    const vault = new Vault(memoryStore(), () => now);
    await vault.create(account, generateIdentity(), '482913');
    expect(await vault.wipeAfter()).toBeNull();
    for (let i = 0; i < 12; i++) {
      await expect(vault.unlock('000000')).rejects.toMatchObject({ attemptsBeforeWipe: null });
      now += 3_600_000;
    }
    await expect(vault.unlock('482913')).resolves.toBeDefined();
  });

  it('erases everything at the Nth wrong code in a row, warning before', async () => {
    const store = memoryStore();
    let now = 0;
    const vault = new Vault(store, () => now);
    const { masterKey } = await vault.create(account, generateIdentity(), '482913');
    await vault.saveGroupKey('g1', 1, generateGroupKey(), '777111', masterKey);
    await vault.setWipeAfter(10);

    for (let i = 1; i < 10; i++) {
      const e = await vault.unlock('000000').catch((x: unknown) => x);
      expect(e).toBeInstanceOf(i < FREE_ATTEMPTS ? WrongCodeError : LockedOutError);
      expect(e).toMatchObject({ attemptsBeforeWipe: 10 - i });
      now += 3_600_000;
    }
    await expect(vault.unlock('000000')).rejects.toBeInstanceOf(WipedError);
    expect(store.data.size).toBe(0);
    expect(await vault.account()).toBeNull();
  });

  it('an attempt cut short at the threshold still erases at the next try', async () => {
    const store = memoryStore();
    const vault = new Vault(store);
    await vault.create(account, generateIdentity(), '482913');
    await vault.setWipeAfter(10);
    // Counted before it ran, then the app was killed.
    store.data.set('bs.lockout_app', JSON.stringify({ failures: 10, lockedUntil: 0 }));
    await expect(vault.unlock('482913')).rejects.toBeInstanceOf(WipedError);
    expect(store.data.size).toBe(0);
  });

  it('the right code resets the count', async () => {
    let now = 0;
    const vault = new Vault(memoryStore(), () => now);
    await vault.create(account, generateIdentity(), '482913');
    await vault.setWipeAfter(10);
    for (let i = 0; i < 9; i++) {
      await vault.unlock('000000').catch(() => {});
      now += 3_600_000;
    }
    await vault.unlock('482913');
    await expect(vault.unlock('000000')).rejects.toMatchObject({ attemptsBeforeWipe: 9 });
  });

  it('a wipe cut short is detected and can be finished', async () => {
    const store = memoryStore();
    const vault = new Vault(store);
    await vault.create(account, generateIdentity(), '482913');
    expect(await vault.intact()).toBe(true);
    store.data.delete('bs.master_wrapped');
    expect(await vault.intact()).toBe(false);
    await vault.wipeAll();
    expect(store.data.size).toBe(0);
  });
});

describe('screenshots', () => {
  it('allowed by default, blocked on demand', async () => {
    const vault = new Vault(memoryStore());
    expect(await vault.screenshotsBlocked()).toBe(false);
    await vault.setScreenshotsBlocked(true);
    expect(await vault.screenshotsBlocked()).toBe(true);
    await vault.setScreenshotsBlocked(false);
    expect(await vault.screenshotsBlocked()).toBe(false);
  });
});

describe('fingerprint unlock', () => {
  /** The system's protected item: `pass` is whether the finger check succeeds. */
  function fakeFingerprint(available = true) {
    const bio: BiometricStore & { value: string | null; pass: boolean } = {
      value: null,
      pass: true,
      available: async () => available,
      save: async (v) => void (bio.value = v),
      load: async () => {
        if (!bio.pass) throw new Error('user_cancel');
        return bio.value;
      },
      clear: async () => void (bio.value = null),
    };
    return bio;
  }

  async function setup() {
    const store = memoryStore();
    const bio = fakeFingerprint();
    let now = 1_000_000;
    const clock = { now: () => now, advance: (ms: number) => void (now += ms) };
    const vault = new Vault(store, clock.now, () => null, bio);
    const identity = generateIdentity();
    await vault.create(account, identity, '482913');
    return { store, bio, clock, vault, identity };
  }

  it('is off until turned on with the app code', async () => {
    const { vault } = await setup();
    expect(await vault.canUseBiometrics()).toBe(false);
    expect(await vault.unlockWithBiometrics()).toBeNull();
    await expect(vault.enableBiometrics('000000')).rejects.toBeInstanceOf(WrongCodeError);
    expect(await vault.biometricsEnabled()).toBe(false);
  });

  it('opens the vault with the finger once turned on', async () => {
    const { vault, identity } = await setup();
    await vault.enableBiometrics('482913');
    const u = await vault.unlockWithBiometrics();
    expect(u?.account).toEqual(account);
    expect(u?.identity.signSecretKey).toEqual(identity.signSecretKey);
  });

  it('a cancelled or failed check falls back to the code, without turning the option off', async () => {
    const { vault, bio } = await setup();
    await vault.enableBiometrics('482913');
    bio.pass = false;
    expect(await vault.unlockWithBiometrics()).toBeNull();
    expect(await vault.biometricsEnabled()).toBe(true);
  });

  it('asks the code again 48 h after it was last typed', async () => {
    const { vault, clock } = await setup();
    await vault.enableBiometrics('482913');
    clock.advance(BIOMETRIC_MAX_AGE_MS - 1000);
    expect(await vault.unlockWithBiometrics()).not.toBeNull();
    clock.advance(2000);
    expect(await vault.unlockWithBiometrics()).toBeNull();
    await vault.unlock('482913');
    expect(await vault.canUseBiometrics()).toBe(true);
  });

  it('turns itself off when the system dropped the copy (a finger was added)', async () => {
    const { vault, bio } = await setup();
    await vault.enableBiometrics('482913');
    bio.value = null;
    expect(await vault.unlockWithBiometrics()).toBeNull();
    expect(await vault.biometricsEnabled()).toBe(false);
  });

  it('a wipe deletes the fingerprint copy of the master key', async () => {
    const { vault, bio, store } = await setup();
    await vault.enableBiometrics('482913');
    await vault.wipeAll();
    expect(bio.value).toBeNull();
    expect(store.data.size).toBe(0);
  });

  it('never offered without a fingerprint sensor', async () => {
    const vault = new Vault(memoryStore(), Date.now, () => null, fakeFingerprint(false));
    await vault.create(account, generateIdentity(), '482913');
    await expect(vault.enableBiometrics('482913')).rejects.toThrow('biometrics_unavailable');
    expect(await vault.canUseBiometrics()).toBe(false);
  });
});
