import * as aead from './aead';
import { b64, frame, u32, utf8, wipe } from './encoding';
import { attempt, CryptoError } from './errors';
import { handoutKey } from './groupSecret';
import { openSealed, sealTo, sign, verify, type Identity } from './identity';
import { sodium } from './sodium';

/*
 * Group crypto (§4.3).
 *
 * - Group key: random 256 bits. Each member gets it as a handout: wrapped
 *   under the key derived from the group code + keywords (groupSecret.ts),
 *   sealed to the member's X25519 key (crypto_box_seal), and signed by the
 *   admin who handed it over. Opening one needs the member's identity AND
 *   the group's code + keywords; the signature tells who vouched for it.
 * - Meta (name, keywords, admins, members): encrypted under the group key and
 *   signed by the admin who wrote it, with a revision number that only grows.
 * - Private conversation (two people who share a group): the same, with no
 *   code + keywords. Its handouts are wrapped under directWrapKey(), a fixed
 *   public value, so they open with the member's identity alone (still sealed
 *   to them and signed by the one who opened the conversation). Each phone
 *   then locks the key under a code of its own (vault), like a group's.
 * - Messages: XChaCha20-Poly1305 under the group key, then signed (Ed25519) by
 *   the sender. The associated data binds each ciphertext to its group,
 *   sender, client_id and key version, so the server cannot move a message
 *   to another group, re-attribute it, or replay it under another client_id.
 */

export function generateGroupKey(): Uint8Array {
  return aead.randomKey();
}

/**
 * The wrap key of a private conversation's handouts: public and the same for
 * all (no code is shared). The seal to the member's key is what keeps a
 * handout theirs; this only keeps one code path for groups and conversations.
 */
export function directWrapKey(): Uint8Array {
  return sodium.crypto_generichash(32, utf8.encode('bs/v2/direct-wrap'), null);
}

// ---- Key handouts ----------------------------------------------------------

export interface Handout {
  sealedKey: string; // row value for group_keys.sealed_key
  signature: string;
  /**
   * The group's name, sealed to the member alone (no code needed) and signed
   * by the same admin: what their locked plate shows before the first unlock,
   * so they know which code to type. Absent on handouts from before it.
   */
  sealedLabel?: string;
  labelSignature?: string;
}

/** Same bound as a meta's name. */
const MAX_LABEL = 200;

const handoutAd = (groupId: string, recipientId: string, keyVersion: number) =>
  frame(utf8.encode('bs/v2/handout'), utf8.encode(groupId), utf8.encode(recipientId), u32(keyVersion));

const handoutSigned = (groupId: string, recipientId: string, keyVersion: number, sealed: Uint8Array) =>
  frame(utf8.encode('bs/v2/handout-sig'), utf8.encode(groupId), utf8.encode(recipientId), u32(keyVersion), sealed);

const labelSigned = (groupId: string, recipientId: string, keyVersion: number, sealed: Uint8Array) =>
  frame(utf8.encode('bs/v2/handout-label-sig'), utf8.encode(groupId), utf8.encode(recipientId), u32(keyVersion), sealed);

/** `label`: the group's name to seal beside the key (see Handout.sealedLabel). */
export function sealHandout(
  groupKey: Uint8Array,
  wrapKey: Uint8Array,
  groupId: string,
  keyVersion: number,
  recipient: { userId: string; boxPublicKey: Uint8Array },
  signer: Pick<Identity, 'signSecretKey'>,
  label?: string,
): Handout {
  const k = handoutKey(wrapKey, groupId);
  try {
    const inner = aead.seal(k, groupKey, handoutAd(groupId, recipient.userId, keyVersion));
    const sealed = sealTo(inner, recipient.boxPublicKey);
    const signature = sign(handoutSigned(groupId, recipient.userId, keyVersion, sealed), signer.signSecretKey);
    const h: Handout = { sealedKey: b64.encode(sealed), signature: b64.encode(signature) };
    if (label !== undefined) Object.assign(h, sealLabel(label, groupId, keyVersion, recipient, signer));
    return h;
  } finally {
    wipe(k);
  }
}

/**
 * The group's name sealed to `recipient` alone and signed: a handout's
 * sealedLabel and labelSignature, also filled in later on handouts from
 * before it (an admin opening the group).
 */
export function sealLabel(
  label: string,
  groupId: string,
  keyVersion: number,
  recipient: { userId: string; boxPublicKey: Uint8Array },
  signer: Pick<Identity, 'signSecretKey'>,
): { sealedLabel: string; labelSignature: string } {
  // The group id travels inside: a label sealed for another group of ours is refused on opening.
  const sealed = sealTo(utf8.encode(JSON.stringify({ g: groupId, name: label.slice(0, MAX_LABEL) })), recipient.boxPublicKey);
  return {
    sealedLabel: b64.encode(sealed),
    labelSignature: b64.encode(sign(labelSigned(groupId, recipient.userId, keyVersion, sealed), signer.signSecretKey)),
  };
}

/**
 * The name sealed beside the key, readable with our identity alone (before
 * the group code), or null on a handout without one. Checks the signature
 * against `signerSignPublicKey` (pinned locally) first: BAD_SIGNATURE, or
 * DECRYPT_FAILED (not sealed to us, or sealed for another group).
 */
export function openHandoutLabel(
  h: Pick<Handout, 'sealedLabel' | 'labelSignature'>,
  signerSignPublicKey: Uint8Array,
  groupId: string,
  keyVersion: number,
  me: Identity & { userId: string },
): string | null {
  if (!h.sealedLabel || !h.labelSignature) return null;
  const { sealed, signature } = attempt('INVALID_INPUT', () => ({ sealed: b64.decode(h.sealedLabel!), signature: b64.decode(h.labelSignature!) }));
  if (!verify(signature, labelSigned(groupId, me.userId, keyVersion, sealed), signerSignPublicKey)) throw new CryptoError('BAD_SIGNATURE');
  const json = openSealed(sealed, me);
  const o = attempt('DECRYPT_FAILED', () => JSON.parse(utf8.decode(json)) as { g?: unknown; name?: unknown });
  if (o.g !== groupId || typeof o.name !== 'string' || o.name.length > MAX_LABEL) throw new CryptoError('DECRYPT_FAILED');
  return o.name;
}

/**
 * Checks the signature against `signerSignPublicKey` (pinned locally, never
 * taken from the row), then opens with our identity and the group's
 * wrapKey. BAD_SIGNATURE, or DECRYPT_FAILED (which is also what a wrong code
 * or wrong keywords give).
 */
export function openHandout(
  h: Handout,
  signerSignPublicKey: Uint8Array,
  wrapKey: Uint8Array,
  groupId: string,
  keyVersion: number,
  me: Identity & { userId: string },
): Uint8Array {
  const { sealed, signature } = attempt('INVALID_INPUT', () => ({ sealed: b64.decode(h.sealedKey), signature: b64.decode(h.signature) }));
  if (!verify(signature, handoutSigned(groupId, me.userId, keyVersion, sealed), signerSignPublicKey)) {
    throw new CryptoError('BAD_SIGNATURE');
  }
  const inner = openSealed(sealed, me);
  const k = handoutKey(wrapKey, groupId);
  try {
    const key = aead.open(k, inner, handoutAd(groupId, me.userId, keyVersion));
    if (key.length !== aead.KEY_BYTES) throw new CryptoError('DECRYPT_FAILED');
    return key;
  } finally {
    wipe(k);
    wipe(inner);
  }
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

// ---- Group metadata ------------------------------------------------------------

export interface GroupMeta {
  /** Empty for a private conversation: it is shown under the other person's name. */
  name: string;
  avatar?: string;
  /** The 3 join keywords as typed at creation (members re-derive the group secret from them after a code change); none in a private conversation. */
  keywords: string[];
  /** User ids allowed to hand out keys, approve newcomers and rotate. */
  admins: string[];
  /** Everyone an admin let in: only they get the next key. */
  members: string[];
  /** Grows with every change: a phone never goes back to an older meta. */
  rev: number;
  /** A private conversation: exactly two members, both admins, no keywords. */
  direct?: true;
}

export interface SignedMeta {
  encryptedMeta: string;
  metaSignature: string;
}

const metaAd = (groupId: string, keyVersion: number) =>
  frame(utf8.encode('bs/v2/group-meta'), utf8.encode(groupId), u32(keyVersion));

const metaSigned = (groupId: string, keyVersion: number, blob: Uint8Array) =>
  frame(utf8.encode('bs/v2/meta-sig'), utf8.encode(groupId), u32(keyVersion), blob);

/** Values for `groups.encrypted_meta` and `meta_signature`, written by `signer` (an admin). */
export function encryptGroupMeta(
  meta: GroupMeta,
  groupId: string,
  keyVersion: number,
  groupKey: Uint8Array,
  signer: Pick<Identity, 'signSecretKey'>,
): SignedMeta {
  const blob = aead.seal(groupKey, utf8.encode(JSON.stringify(meta)), metaAd(groupId, keyVersion));
  const signature = sign(metaSigned(groupId, keyVersion, blob), signer.signSecretKey);
  return { encryptedMeta: b64.encode(blob), metaSignature: b64.encode(signature) };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isIdList = (v: unknown): v is string[] =>
  Array.isArray(v) && v.length >= 1 && v.length <= 1000 && v.every((x) => typeof x === 'string' && UUID.test(x)) && new Set(v).size === v.length;

/** Verifies the writer's signature, then decrypts and checks the shape. */
export function decryptGroupMeta(
  m: SignedMeta,
  signerSignPublicKey: Uint8Array,
  groupId: string,
  keyVersion: number,
  groupKey: Uint8Array,
): GroupMeta {
  const { blob, signature } = attempt('INVALID_INPUT', () => ({ blob: b64.decode(m.encryptedMeta), signature: b64.decode(m.metaSignature) }));
  if (!verify(signature, metaSigned(groupId, keyVersion, blob), signerSignPublicKey)) throw new CryptoError('BAD_SIGNATURE');
  const json = aead.open(groupKey, blob, metaAd(groupId, keyVersion));
  const o = attempt('DECRYPT_FAILED', () => JSON.parse(utf8.decode(json)) as Partial<GroupMeta>);
  const direct = o.direct === true;
  const ok =
    typeof o.name === 'string' && o.name.length <= 200 &&
    (o.avatar === undefined || (typeof o.avatar === 'string' && o.avatar.length <= 40)) &&
    Array.isArray(o.keywords) && o.keywords.length === (direct ? 0 : 3) && o.keywords.every((w) => typeof w === 'string' && w.length <= 40) &&
    isIdList(o.admins) && isIdList(o.members) && o.admins.every((a) => o.members!.includes(a)) &&
    // A private conversation: the two of them, both admins, nobody else ever.
    (o.direct === undefined || (direct && o.members!.length === 2 && o.admins!.length === 2)) &&
    Number.isInteger(o.rev) && o.rev! >= 1;
  if (!ok) throw new CryptoError('DECRYPT_FAILED');
  return {
    name: o.name!,
    ...(o.avatar !== undefined && { avatar: o.avatar }),
    keywords: o.keywords!,
    admins: o.admins!,
    members: o.members!,
    rev: o.rev!,
    ...(direct && { direct: true as const }),
  };
}
