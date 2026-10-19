import { b64 } from '../encoding';
import { CryptoError } from '../errors';
import {
  decryptGroupMeta,
  decryptMessage,
  encryptGroupMeta,
  encryptMessage,
  generateGroupKey,
  openHandout,
  sealHandout,
  type EncryptedMessage,
  type GroupMeta,
  type MessageContext,
} from '../group';
import { deriveGroupSecrets, sameKeywords } from '../groupSecret';
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

const ALICE = '0b0e7a52-0000-4000-8000-00000000a11c';
const BOB = '0b0e7a52-0000-4000-8000-0000000000b0';
const MALLORY = '0b0e7a52-0000-4000-8000-00000000ba0d';

describe('group secret (code + keywords)', () => {
  it('same code and keywords give the same keys, whatever the case, accents and order', async () => {
    const a = await deriveGroupSecrets('482913', ['Été', 'plage', 'Soleil']);
    const b = await deriveGroupSecrets('482913', ['soleil', 'ete', '  PLAGE ']);
    expect(b.joinKey).toEqual(a.joinKey);
    expect(b.wrapKey).toEqual(a.wrapKey);
    expect(sameKeywords(['Été', 'plage', 'Soleil'], ['soleil', 'ete', 'PLAGE'])).toBe(true);
  });

  it('the key sent to the server says nothing of the one that stays on the phone', async () => {
    const { joinKey, wrapKey } = await deriveGroupSecrets('482913', ['été', 'plage', 'soleil']);
    expect(joinKey).not.toEqual(wrapKey);
  });

  it('another code or another keyword gives other keys', async () => {
    const a = await deriveGroupSecrets('482913', ['été', 'plage', 'soleil']);
    const b = await deriveGroupSecrets('482914', ['été', 'plage', 'soleil']);
    const c = await deriveGroupSecrets('482913', ['été', 'plage', 'lune']);
    expect(b.wrapKey).not.toEqual(a.wrapKey);
    expect(c.wrapKey).not.toEqual(a.wrapKey);
  });

  it('refuses invalid input', async () => {
    await expect(deriveGroupSecrets('123', ['a', 'b', 'c'])).rejects.toThrow(CryptoError);
    await expect(deriveGroupSecrets('482913', ['a', 'A', 'c'])).rejects.toThrow(CryptoError);
  });
});

describe('key handouts', () => {
  let wrapKey: Uint8Array;
  const bobMe = () => ({ ...bob, userId: BOB });
  beforeAll(async () => {
    wrapKey = (await deriveGroupSecrets('482913', ['été', 'plage', 'soleil'])).wrapKey;
  });

  it('the member opens the key an admin handed to them', () => {
    const h = sealHandout(groupKey, wrapKey, ctx.groupId, 3, { userId: BOB, boxPublicKey: bob.boxPublicKey }, alice);
    expect(openHandout(h, alice.signPublicKey, wrapKey, ctx.groupId, 3, bobMe())).toEqual(groupKey);
  });

  it('needs the group code: the account identity alone does not open it', async () => {
    const h = sealHandout(groupKey, wrapKey, ctx.groupId, 1, { userId: BOB, boxPublicKey: bob.boxPublicKey }, alice);
    const wrongCode = (await deriveGroupSecrets('000000', ['été', 'plage', 'soleil'])).wrapKey;
    expectCryptoError(() => openHandout(h, alice.signPublicKey, wrongCode, ctx.groupId, 1, bobMe()), 'DECRYPT_FAILED');
  });

  it('only the recipient can open it', () => {
    const h = sealHandout(groupKey, wrapKey, ctx.groupId, 1, { userId: BOB, boxPublicKey: bob.boxPublicKey }, alice);
    expectCryptoError(() => openHandout(h, alice.signPublicKey, wrapKey, ctx.groupId, 1, { ...mallory, userId: BOB }), 'DECRYPT_FAILED');
  });

  it('a handout from someone else than the claimed signer is refused (the server cannot forge one)', () => {
    // Mallory knows Bob's public key and even the code, but signs with her own key.
    const forged = sealHandout(generateGroupKey(), wrapKey, ctx.groupId, 1, { userId: BOB, boxPublicKey: bob.boxPublicKey }, mallory);
    expectCryptoError(() => openHandout(forged, alice.signPublicKey, wrapKey, ctx.groupId, 1, bobMe()), 'BAD_SIGNATURE');
  });

  it('cannot be moved to another group, version or member', () => {
    const h = sealHandout(groupKey, wrapKey, ctx.groupId, 1, { userId: BOB, boxPublicKey: bob.boxPublicKey }, alice);
    expectCryptoError(() => openHandout(h, alice.signPublicKey, wrapKey, 'other-group', 1, bobMe()), 'BAD_SIGNATURE');
    expectCryptoError(() => openHandout(h, alice.signPublicKey, wrapKey, ctx.groupId, 2, bobMe()), 'BAD_SIGNATURE');
    expectCryptoError(() => openHandout(h, alice.signPublicKey, wrapKey, ctx.groupId, 1, { ...bob, userId: MALLORY }), 'BAD_SIGNATURE');
  });

  it('a tampered handout is rejected', () => {
    const h = sealHandout(groupKey, wrapKey, ctx.groupId, 1, { userId: BOB, boxPublicKey: bob.boxPublicKey }, alice);
    expectCryptoError(() => openHandout({ ...h, sealedKey: tamper(h.sealedKey) }, alice.signPublicKey, wrapKey, ctx.groupId, 1, bobMe()), 'BAD_SIGNATURE');
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
  const meta: GroupMeta = { name: 'Les Potes', avatar: 'vault', keywords: ['été', 'plage', 'soleil'], admins: [ALICE], members: [ALICE, BOB], rev: 4 };

  it('round-trips, encrypted and signed by the admin who wrote it', () => {
    const enc = encryptGroupMeta(meta, ctx.groupId, 1, groupKey, alice);
    expect(enc.encryptedMeta).not.toContain('Potes');
    expect(decryptGroupMeta(enc, alice.signPublicKey, ctx.groupId, 1, groupKey)).toEqual(meta);
  });

  it('a meta written by someone else than the claimed admin is refused', () => {
    const forged = encryptGroupMeta({ ...meta, admins: [MALLORY], members: [ALICE, BOB, MALLORY] }, ctx.groupId, 1, groupKey, mallory);
    expectCryptoError(() => decryptGroupMeta(forged, alice.signPublicKey, ctx.groupId, 1, groupKey), 'BAD_SIGNATURE');
  });

  it('wrong key, group or version fails', () => {
    const enc = encryptGroupMeta(meta, ctx.groupId, 1, groupKey, alice);
    expectCryptoError(() => decryptGroupMeta(enc, alice.signPublicKey, ctx.groupId, 1, generateGroupKey()), 'DECRYPT_FAILED');
    expectCryptoError(() => decryptGroupMeta(enc, alice.signPublicKey, 'other-group', 1, groupKey), 'BAD_SIGNATURE');
    expectCryptoError(() => decryptGroupMeta(enc, alice.signPublicKey, ctx.groupId, 2, groupKey), 'BAD_SIGNATURE');
  });

  it('a malformed meta is refused even when properly signed', () => {
    const bad = encryptGroupMeta({ ...meta, admins: [MALLORY] }, ctx.groupId, 1, groupKey, alice); // admin not a member
    expectCryptoError(() => decryptGroupMeta(bad, alice.signPublicKey, ctx.groupId, 1, groupKey), 'DECRYPT_FAILED');
  });
});
