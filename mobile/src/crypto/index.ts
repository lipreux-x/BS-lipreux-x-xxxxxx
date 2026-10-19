export { initCrypto } from './sodium';
export { CryptoError, type CryptoErrorCode } from './errors';
export {
  generateIdentity,
  toPublicIdentity,
  parsePublicIdentity,
  safetyNumber,
  type Identity,
  type PublicIdentity,
} from './identity';
export {
  generateDeviceSecret,
  generateMasterKey,
  wrapMasterKey,
  unwrapMasterKey,
  lockGroupKey,
  unlockGroupKey,
  isValidAppCode,
  isValidGroupCode,
  type WrappedKey,
} from './keywrap';
export {
  generateGroupKey,
  sealGroupKeyFor,
  openGroupKey,
  encryptMessage,
  decryptMessage,
  encryptGroupMeta,
  decryptGroupMeta,
  type MessageContext,
  type EncryptedMessage,
  type GroupMeta,
} from './group';
export {
  MAX_ATTACHMENT_BYTES,
  encryptAttachment,
  decryptAttachment,
  encodeMessageBody,
  parseMessageBody,
  type AttachmentContext,
  type ImageBody,
  type MessageBody,
} from './attachment';
export {
  normalizeInviteCode,
  registrationProof,
  loginSignature,
  sealIdentity,
  openIdentity,
  sealLocal,
  openLocal,
} from './auth';
export { b64, utf8 } from './encoding';
