import { CryptoError } from '../errors';
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

// Argon2id at production cost: a few hundred ms per derivation.
jest.setTimeout(30_000);

beforeAll(() => initCrypto());

function expectDecryptFailed(fn: () => unknown) {
  expect(fn).toThrow(CryptoError);
  try {
    fn();
  } catch (e) {
    expect((e as CryptoError).code).toBe('DECRYPT_FAILED');
  }
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

  it('right code + right device unwraps the master key', () => {
    const master = generateMasterKey();
    const secret = deviceSecret();
    const wrapped = wrapMasterKey(master, '482913', secret);
    expect(unwrapMasterKey(wrapped, '482913', secret)).toEqual(master);
  });

  it('wrong code fails', () => {
    const secret = deviceSecret();
    const wrapped = wrapMasterKey(generateMasterKey(), '482913', secret);
    expectDecryptFailed(() => unwrapMasterKey(wrapped, '482914', secret));
  });

  it('right code on another device (different device secret) fails', () => {
    const wrapped = wrapMasterKey(generateMasterKey(), '482913', deviceSecret());
    expectDecryptFailed(() => unwrapMasterKey(wrapped, '482913', deviceSecret()));
  });

  it('stored form contains neither the code nor the key', () => {
    const master = generateMasterKey();
    const wrapped = wrapMasterKey(master, '482913', deviceSecret());
    const json = JSON.stringify(wrapped);
    expect(json).not.toContain('482913');
    expect(json).not.toContain(Buffer.from(master).toString('base64url'));
  });

  it('refuses to wrap with an invalid code', () => {
    expect(() => wrapMasterKey(generateMasterKey(), '1234', deviceSecret())).toThrow(CryptoError);
  });
});

describe('group key (group code + master key)', () => {
  const groupId = 'group-1';

  it('right group code + right master key unlocks', () => {
    const master = generateMasterKey();
    const groupKey = generateGroupKey();
    const locked = lockGroupKey(groupKey, '777111', master, groupId, 1);
    expect(unlockGroupKey(locked, '777111', master, groupId, 1)).toEqual(groupKey);
  });

  it('wrong group code fails', () => {
    const master = generateMasterKey();
    const locked = lockGroupKey(generateGroupKey(), '777111', master, groupId, 1);
    expectDecryptFailed(() => unlockGroupKey(locked, '777112', master, groupId, 1));
  });

  it('right group code without the master key fails', () => {
    const locked = lockGroupKey(generateGroupKey(), '777111', generateMasterKey(), groupId, 1);
    expectDecryptFailed(() => unlockGroupKey(locked, '777111', generateMasterKey(), groupId, 1));
  });

  it('a locked key cannot be swapped onto another group or key version', () => {
    const master = generateMasterKey();
    const locked = lockGroupKey(generateGroupKey(), '777111', master, groupId, 1);
    expectDecryptFailed(() => unlockGroupKey(locked, '777111', master, 'group-2', 1));
    expectDecryptFailed(() => unlockGroupKey(locked, '777111', master, groupId, 2));
  });
});

describe('stored Argon2id parameters', () => {
  it('records the cost used, so another backend can unwrap it', () => {
    const wrapped = wrapMasterKey(generateMasterKey(), '482913', generateDeviceSecret());
    expect(wrapped.ops).toBeGreaterThanOrEqual(1);
    expect(wrapped.mem).toBeGreaterThanOrEqual(1024 * 1024);
  });

  it('rejects out-of-bounds parameters from a tampered record', () => {
    const secret = generateDeviceSecret();
    const wrapped = wrapMasterKey(generateMasterKey(), '482913', secret);
    for (const bad of [{ mem: 8 * 1024 * 1024 * 1024 }, { ops: 1000 }, { ops: 0 }, { mem: 1000 }]) {
      expect(() => unwrapMasterKey({ ...wrapped, ...bad }, '482913', secret)).toThrow(CryptoError);
    }
  });

  it('a record without parameters (written before they were stored) uses the native defaults', () => {
    const master = generateMasterKey();
    const secret = generateDeviceSecret();
    const { ops, mem, ...legacy } = wrapMasterKey(master, '482913', secret);
    if (ops === 3 && mem === 64 * 1024 * 1024) expect(unwrapMasterKey(legacy, '482913', secret)).toEqual(master);
    else expect(() => unwrapMasterKey(legacy, '482913', secret)).toThrow(CryptoError);
  });
});
