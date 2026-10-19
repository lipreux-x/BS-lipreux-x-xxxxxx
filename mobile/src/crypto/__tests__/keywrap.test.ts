import { CryptoError } from '../errors';
import { argon2Params } from '../kdf';
import {
  generateDeviceSecret,
  generateMasterKey,
  isValidAppCode,
  isValidGroupCode,
  lockGroupKey,
  unlockGroupKey,
  unwrapMasterKey,
  wrapMasterKey,
} from '../keywrap';
import { generateGroupKey } from '../group';
import { initCrypto } from '../sodium';

jest.setTimeout(30_000);

beforeAll(() => initCrypto());

async function expectDecryptFailed(p: Promise<unknown>) {
  await expect(p).rejects.toThrow(CryptoError);
  await p.catch((e: CryptoError) => expect(e.code).toBe('DECRYPT_FAILED'));
}

describe('code validation', () => {
  it('app code is exactly 6 digits', () => {
    expect(isValidAppCode('123456')).toBe(true);
    for (const bad of ['12345', '1234567', '12345a', '', ' 123456']) expect(isValidAppCode(bad)).toBe(false);
  });

  it('group code is 6+ alphanumerics', () => {
    expect(isValidGroupCode('000000')).toBe(true);
    expect(isValidGroupCode('BaseSecrete2026')).toBe(true);
    for (const bad of ['12345', '12 3456', 'abc-def']) expect(isValidGroupCode(bad)).toBe(false);
  });
});

describe('master key (app code)', () => {
  const deviceSecret = () => generateDeviceSecret();

  it('right code + right device unwraps the master key', async () => {
    const master = generateMasterKey();
    const secret = deviceSecret();
    const wrapped = await wrapMasterKey(master, '482913', secret);
    expect(await unwrapMasterKey(wrapped, '482913', secret)).toEqual(master);
  });

  it('wrong code fails', async () => {
    const secret = deviceSecret();
    const wrapped = await wrapMasterKey(generateMasterKey(), '482913', secret);
    await expectDecryptFailed(unwrapMasterKey(wrapped, '482914', secret));
  });

  it('right code on another device (different device secret) fails', async () => {
    const wrapped = await wrapMasterKey(generateMasterKey(), '482913', deviceSecret());
    await expectDecryptFailed(unwrapMasterKey(wrapped, '482913', deviceSecret()));
  });

  it('stored form contains neither the code nor the key', async () => {
    const master = generateMasterKey();
    const wrapped = await wrapMasterKey(master, '482913', deviceSecret());
    const json = JSON.stringify(wrapped);
    expect(json).not.toContain('482913');
    expect(json).not.toContain(Buffer.from(master).toString('base64url'));
  });

  it('refuses to wrap with an invalid code', async () => {
    await expect(wrapMasterKey(generateMasterKey(), '1234', deviceSecret())).rejects.toThrow(CryptoError);
  });

  it('without the native module (tests), records that no hardware key is mixed in', async () => {
    expect((await wrapMasterKey(generateMasterKey(), '482913', deviceSecret())).hw).toBe(false);
  });

  it('a record that needs the hardware key cannot be opened without it', async () => {
    const secret = deviceSecret();
    const wrapped = await wrapMasterKey(generateMasterKey(), '482913', secret);
    await expect(unwrapMasterKey({ ...wrapped, hw: true }, '482913', secret)).rejects.toThrow(CryptoError);
  });
});

describe('group key (group code + master key)', () => {
  const groupId = 'group-1';

  it('right group code + right master key unlocks', async () => {
    const master = generateMasterKey();
    const groupKey = generateGroupKey();
    const locked = await lockGroupKey(groupKey, '777111', master, groupId, 1);
    expect(await unlockGroupKey(locked, '777111', master, groupId, 1)).toEqual(groupKey);
  });

  it('wrong group code fails', async () => {
    const master = generateMasterKey();
    const locked = await lockGroupKey(generateGroupKey(), '777111', master, groupId, 1);
    await expectDecryptFailed(unlockGroupKey(locked, '777112', master, groupId, 1));
  });

  it('right group code without the master key fails', async () => {
    const locked = await lockGroupKey(generateGroupKey(), '777111', generateMasterKey(), groupId, 1);
    await expectDecryptFailed(unlockGroupKey(locked, '777111', generateMasterKey(), groupId, 1));
  });

  it('a locked key cannot be swapped onto another group or key version', async () => {
    const master = generateMasterKey();
    const locked = await lockGroupKey(generateGroupKey(), '777111', master, groupId, 1);
    await expectDecryptFailed(unlockGroupKey(locked, '777111', master, 'group-2', 1));
    await expectDecryptFailed(unlockGroupKey(locked, '777111', master, groupId, 2));
  });
});

describe('stored Argon2id parameters', () => {
  it('records the cost used', async () => {
    const wrapped = await wrapMasterKey(generateMasterKey(), '482913', generateDeviceSecret());
    expect({ ops: wrapped.ops, mem: wrapped.mem }).toEqual(argon2Params());
  });

  it('rejects out-of-bounds or lowered parameters from a tampered record', async () => {
    const secret = generateDeviceSecret();
    const wrapped = await wrapMasterKey(generateMasterKey(), '482913', secret);
    for (const bad of [{ mem: 8 * 1024 * 1024 * 1024 }, { ops: 1000 }, { ops: 0 }, { mem: 1000 }, { mem: 512 * 1024 }]) {
      await expect(unwrapMasterKey({ ...wrapped, ...bad }, '482913', secret)).rejects.toThrow(CryptoError);
    }
  });

  it('refuses records of the previous format', async () => {
    const secret = generateDeviceSecret();
    const wrapped = await wrapMasterKey(generateMasterKey(), '482913', secret);
    await expect(unwrapMasterKey({ ...wrapped, v: 1 } as never, '482913', secret)).rejects.toThrow(CryptoError);
  });
});
