import { backupKeys, createKeyBackup, isValidPassword, openKeyBackup, passwordProblem } from '../backup';
import { CryptoError } from '../errors';
import { generateIdentity } from '../identity';
import { argon2Params } from '../kdf';
import { initCrypto } from '../sodium';

jest.setTimeout(60_000);

beforeAll(() => initCrypto());

const PASSWORD = 'Phrase secrète 42';

describe('password rules', () => {
  it('needs 10+ characters', () => {
    expect(isValidPassword('Court1!')).toBe(false);
    expect(isValidPassword('Assez-long-1')).toBe(true);
  });

  it('rejects what attackers try first', () => {
    for (const weak of ['aaaaaaaaaaaa', 'azertyuiop12', 'Motdepasse123', '1234567890ab', 'abcabcabcabc']) {
      expect(passwordProblem(weak)).not.toBeNull();
    }
  });

  it('a short password needs variety, a long passphrase does not', () => {
    expect(passwordProblem('chienrouge')).not.toBeNull();
    expect(passwordProblem('Chien-rouge7')).toBeNull();
    expect(passwordProblem('le chien rouge danse le soir')).toBeNull();
  });

  it('createKeyBackup refuses a weak password', async () => {
    await expect(createKeyBackup(generateIdentity(), 'alice', '123456')).rejects.toThrow(CryptoError);
  });
});

describe('key backup', () => {
  it('restores the identity with the right username and password only', async () => {
    const identity = generateIdentity();
    const backup = await createKeyBackup(identity, 'alice', PASSWORD);

    const ok = await backupKeys('alice', PASSWORD, backup);
    expect(ok.authKey).toBe(backup.authKey);
    const restored = openKeyBackup(backup.box, 'alice', ok.kek);
    expect(restored.signSecretKey).toEqual(identity.signSecretKey);
    expect(restored.boxSecretKey).toEqual(identity.boxSecretKey);

    const wrong = await backupKeys('alice', 'Phrase secrète 43', backup);
    expect(wrong.authKey).not.toBe(backup.authKey);
    expect(() => openKeyBackup(backup.box, 'alice', wrong.kek)).toThrow(CryptoError);
    // Bound to the username: the box cannot be passed off as someone else's.
    expect(() => openKeyBackup(backup.box, 'bob', ok.kek)).toThrow(CryptoError);
  });

  it('rejects tampered parameters', async () => {
    const { ops, mem } = argon2Params();
    await expect(backupKeys('alice', PASSWORD, { salt: 'AAAA', ops, mem })).rejects.toThrow(CryptoError);
    await expect(backupKeys('alice', PASSWORD, { salt: 'AAAAAAAAAAAAAAAAAAAAAA', ops, mem: 2 ** 31 })).rejects.toThrow(CryptoError);
  });

  it('refuses a cost lower than its own (a server cannot ask for an easier authKey)', async () => {
    const { ops, mem } = argon2Params();
    const salt = 'AAAAAAAAAAAAAAAAAAAAAA';
    await expect(backupKeys('alice', PASSWORD, { salt, ops: ops - 1 || 0, mem })).rejects.toThrow(CryptoError);
    await expect(backupKeys('alice', PASSWORD, { salt, ops, mem: mem / 2 })).rejects.toThrow(CryptoError);
  });
});
