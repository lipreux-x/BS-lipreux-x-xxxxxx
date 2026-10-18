import * as aead from './aead';
import { b64, frame, u32, utf8 } from './encoding';
import { attempt, CryptoError } from './errors';
import { openSealed, sealTo, sign, verify, type Identity } from './identity';

/*
 * Group crypto (§4.3).
 *
 * - Group key: random 256 bits, distributed to each member with crypto_box_seal.
 * - Messages: XChaCha20-Poly1305 under the group key, then signed (Ed25519) by
 *   the sender. The associated data binds each ciphertext to its group,
 *   sender, client_id and key version, so the server cannot move a message
 *   to another group, re-attribute it, or replay it under another client_id.
 */

export function generateGroupKey(): Uint8Array {
  return aead.randomKey();
}

/** Row value for `group_keys.sealed_key`. */
export function sealGroupKeyFor(groupKey: Uint8Array, recipientBoxPublicKey: Uint8Array): string {
  return b64.encode(sealTo(groupKey, recipientBoxPublicKey));
}

export function openGroupKey(sealedKey: string, identity: Identity): Uint8Array {
  const sealed = attempt('DECRYPT_FAILED', () => b64.decode(sealedKey));
  const key = openSealed(sealed, identity);
  if (key.length !== aead.KEY_BYTES) throw new CryptoError('DECRYPT_FAILED');
  return key;
}

// ---- Messages --------------------------------------------------------------

export interface MessageContext {
  groupId: string;
  senderId: string;
  clientId: string; // UUID generated on the phone (offline de-duplication)
  keyVersion: number;
}

/** Wire fields stored in `messages` (all base64). */
export interface EncryptedMessage {
  nonce: string;
  ciphertext: string;
  signature: string;
}

function messageAd(ctx: MessageContext): Uint8Array {
  return frame(
    utf8.encode('bs/v1/message'),
    utf8.encode(ctx.groupId),
    utf8.encode(ctx.senderId),
    utf8.encode(ctx.clientId),
    u32(ctx.keyVersion),
  );
}

function signedBytes(ad: Uint8Array, nonce: Uint8Array, ciphertext: Uint8Array): Uint8Array {
  return frame(ad, nonce, ciphertext);
}

export function encryptMessage(
  plaintext: string,
  ctx: MessageContext,
  groupKey: Uint8Array,
  sender: Pick<Identity, 'signSecretKey'>,
): EncryptedMessage {
  const ad = messageAd(ctx);
  const { nonce, ciphertext } = aead.encrypt(groupKey, utf8.encode(plaintext), ad);
  const signature = sign(signedBytes(ad, nonce, ciphertext), sender.signSecretKey);
  return { nonce: b64.encode(nonce), ciphertext: b64.encode(ciphertext), signature: b64.encode(signature) };
}

/**
 * Verifies the sender's signature BEFORE decrypting. `senderSignPublicKey`
 * must come from the local copy of the sender's profile, never from the
 * message row itself.
 */
export function decryptMessage(
  msg: EncryptedMessage,
  ctx: MessageContext,
  groupKey: Uint8Array,
  senderSignPublicKey: Uint8Array,
): string {
  const { nonce, ciphertext, signature } = attempt('INVALID_INPUT', () => ({
    nonce: b64.decode(msg.nonce),
    ciphertext: b64.decode(msg.ciphertext),
    signature: b64.decode(msg.signature),
  }));
  const ad = messageAd(ctx);
  if (!verify(signature, signedBytes(ad, nonce, ciphertext), senderSignPublicKey)) {
    throw new CryptoError('BAD_SIGNATURE');
  }
  const plaintext = aead.decrypt(groupKey, nonce, ciphertext, ad);
  return attempt('DECRYPT_FAILED', () => utf8.decode(plaintext));
}

// ---- Group metadata (name, avatar) -----------------------------------------

export interface GroupMeta {
  name: string;
  avatar?: string;
}

const metaAd = (groupId: string, keyVersion: number) =>
  frame(utf8.encode('bs/v1/group-meta'), utf8.encode(groupId), u32(keyVersion));

/** Value for `groups.encrypted_meta`. */
export function encryptGroupMeta(meta: GroupMeta, groupId: string, keyVersion: number, groupKey: Uint8Array): string {
  return b64.encode(aead.seal(groupKey, utf8.encode(JSON.stringify(meta)), metaAd(groupId, keyVersion)));
}

export function decryptGroupMeta(
  encryptedMeta: string,
  groupId: string,
  keyVersion: number,
  groupKey: Uint8Array,
): GroupMeta {
  const blob = attempt('DECRYPT_FAILED', () => b64.decode(encryptedMeta));
  const json = aead.open(groupKey, blob, metaAd(groupId, keyVersion));
  return attempt('DECRYPT_FAILED', () => JSON.parse(utf8.decode(json)) as GroupMeta);
}
