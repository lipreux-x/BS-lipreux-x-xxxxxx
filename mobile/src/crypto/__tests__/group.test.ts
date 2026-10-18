import { b64 } from '../encoding';
import { CryptoError } from '../errors';
import {
  decryptGroupMeta,
  decryptMessage,
  encryptGroupMeta,
  encryptMessage,
  generateGroupKey,
  openGroupKey,
  sealGroupKeyFor,
  type EncryptedMessage,
  type MessageContext,
} from '../group';
import { generateIdentity, type Identity } from '../identity';
import { initCrypto } from '../sodium';

let alice: Identity;
let bob: Identity;
let mallory: Identity;
let groupKey: Uint8Array;
const ctx: MessageContext = {
  groupId: '6f1c2a9e-0000-4000-8000-000000000001',
  senderId: 'alice-id',
  clientId: '0b0e7a52-0000-4000-8000-0000000000aa',
  keyVersion: 1,
};

beforeAll(async () => {
  await initCrypto();
  alice = generateIdentity();
  bob = generateIdentity();
  mallory = generateIdentity();
  groupKey = generateGroupKey();
});

function expectCryptoError(fn: () => unknown, code: CryptoError['code']) {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(CryptoError);
    expect((e as CryptoError).code).toBe(code);
    return;
  }
  throw new Error(`expected CryptoError(${code})`);
}

/** Flips one bit of a base64 field. */
function tamper(field: string): string {
  const bytes = b64.decode(field);
  bytes[bytes.length - 1] ^= 0x01;
  return b64.encode(bytes);
}

describe('group key distribution', () => {
  it('a member opens the key sealed for them', () => {
    const sealed = sealGroupKeyFor(groupKey, bob.boxPublicKey);
    expect(openGroupKey(sealed, bob)).toEqual(groupKey);
  });

  it('another user cannot open a key sealed for someone else', () => {
    const sealed = sealGroupKeyFor(groupKey, bob.boxPublicKey);
    expectCryptoError(() => openGroupKey(sealed, mallory), 'DECRYPT_FAILED');
  });

  it('a tampered sealed key is rejected', () => {
    const sealed = sealGroupKeyFor(groupKey, bob.boxPublicKey);
    expectCryptoError(() => openGroupKey(tamper(sealed), bob), 'DECRYPT_FAILED');
  });
});

describe('messages', () => {
  it('encrypt -> decrypt round-trips, including unicode', () => {
    const text = 'Rdv ce soir 🔒 à la base — ne le dis à personne';
    const msg = encryptMessage(text, ctx, groupKey, alice);
    expect(decryptMessage(msg, ctx, groupKey, alice.signPublicKey)).toBe(text);
  });

  it('ciphertext does not contain the plaintext and nonces are unique', () => {
    const a = encryptMessage('salut', ctx, groupKey, alice);
    const b = encryptMessage('salut', ctx, groupKey, alice);
    expect(a.nonce).not.toBe(b.nonce);
    expect(a.ciphertext).not.toBe(b.ciphertext);
    expect(Buffer.from(b64.decode(a.ciphertext)).toString('utf8')).not.toContain('salut');
  });

  it('wrong group key fails', () => {
    const msg = encryptMessage('secret', ctx, groupKey, alice);
    expectCryptoError(() => decryptMessage(msg, ctx, generateGroupKey(), alice.signPublicKey), 'DECRYPT_FAILED');
  });

  it('signature from a different key is rejected', () => {
    const msg = encryptMessage('secret', ctx, groupKey, alice);
    expectCryptoError(() => decryptMessage(msg, ctx, groupKey, mallory.signPublicKey), 'BAD_SIGNATURE');
  });

  it('a group member cannot impersonate another member', () => {
    // Mallory knows the group key but signs with her own key while claiming to be Alice.
    const forged = encryptMessage('je suis Alice', ctx, groupKey, mallory);
    expectCryptoError(() => decryptMessage(forged, ctx, groupKey, alice.signPublicKey), 'BAD_SIGNATURE');
  });

  it.each<keyof EncryptedMessage>(['ciphertext', 'nonce', 'signature'])('tampered %s is rejected', (field) => {
    const msg = encryptMessage('secret', ctx, groupKey, alice);
    const bad = { ...msg, [field]: tamper(msg[field]) };
    expectCryptoError(() => decryptMessage(bad, ctx, groupKey, alice.signPublicKey), 'BAD_SIGNATURE');
  });

  it.each<[string, Partial<MessageContext>]>([
    ['moved to another group', { groupId: 'other-group' }],
    ['re-attributed to another sender', { senderId: 'bob-id' }],
    ['replayed under another client_id', { clientId: 'another-client-id' }],
    ['relabelled with another key version', { keyVersion: 2 }],
  ])('message %s is rejected', (_, change) => {
    const msg = encryptMessage('secret', ctx, groupKey, alice);
    expectCryptoError(
      () => decryptMessage(msg, { ...ctx, ...change }, groupKey, alice.signPublicKey),
      'BAD_SIGNATURE',
    );
  });

  it('malformed base64 is reported as invalid input', () => {
    const msg = encryptMessage('secret', ctx, groupKey, alice);
    expectCryptoError(() => decryptMessage({ ...msg, nonce: '***' }, ctx, groupKey, alice.signPublicKey), 'INVALID_INPUT');
  });
});

describe('group metadata', () => {
  it('round-trips name and avatar', () => {
    const enc = encryptGroupMeta({ name: 'Les Potes', avatar: '🦊' }, ctx.groupId, 1, groupKey);
    expect(enc).not.toContain('Potes');
    expect(decryptGroupMeta(enc, ctx.groupId, 1, groupKey)).toEqual({ name: 'Les Potes', avatar: '🦊' });
  });

  it('wrong key or wrong group fails', () => {
    const enc = encryptGroupMeta({ name: 'Les Potes' }, ctx.groupId, 1, groupKey);
    expectCryptoError(() => decryptGroupMeta(enc, ctx.groupId, 1, generateGroupKey()), 'DECRYPT_FAILED');
    expectCryptoError(() => decryptGroupMeta(enc, 'other-group', 1, groupKey), 'DECRYPT_FAILED');
  });
});
