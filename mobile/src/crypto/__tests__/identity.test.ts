import { CryptoError } from '../errors';
import { generateIdentity, parsePublicIdentity, safetyNumber, toPublicIdentity } from '../identity';
import { initCrypto } from '../sodium';

beforeAll(() => initCrypto());

describe('identity', () => {
  it('generates distinct X25519 and Ed25519 key pairs', () => {
    const id = generateIdentity();
    expect(id.boxPublicKey).toHaveLength(32);
    expect(id.signPublicKey).toHaveLength(32);
    expect(id.boxPublicKey).not.toEqual(id.signPublicKey);
    expect(generateIdentity().boxPublicKey).not.toEqual(id.boxPublicKey);
  });

  it('public identity round-trips and never includes secret keys', () => {
    const id = generateIdentity();
    const pub = toPublicIdentity(id);
    expect(Object.keys(pub).sort()).toEqual(['publicKeyBox', 'publicKeySign']);
    expect(parsePublicIdentity(pub)).toEqual({ boxPublicKey: id.boxPublicKey, signPublicKey: id.signPublicKey });
  });

  it('rejects malformed public keys', () => {
    expect(() => parsePublicIdentity({ publicKeyBox: 'AAAA', publicKeySign: 'AAAA' })).toThrow(CryptoError);
  });
});

describe('safety number', () => {
  it('is the same on both phones and has 12 groups of 5 digits', () => {
    const a = generateIdentity();
    const b = generateIdentity();
    const n = safetyNumber(a, b);
    expect(n).toBe(safetyNumber(b, a));
    expect(n).toMatch(/^(\d{5} ){11}\d{5}$/);
  });

  it('changes if either key is swapped', () => {
    const a = generateIdentity();
    const b = generateIdentity();
    const evil = generateIdentity();
    expect(safetyNumber(a, b)).not.toBe(safetyNumber(a, { ...b, boxPublicKey: evil.boxPublicKey }));
    expect(safetyNumber(a, b)).not.toBe(safetyNumber(a, { ...b, signPublicKey: evil.signPublicKey }));
  });
});
