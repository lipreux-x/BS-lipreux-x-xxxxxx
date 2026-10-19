import {
  decryptAttachment,
  encodeMessageBody,
  encryptAttachment,
  parseMessageBody,
  type AttachmentContext,
  type ImageBody,
} from '../attachment';
import { b64 } from '../encoding';
import { CryptoError } from '../errors';
import { initCrypto } from '../sodium';

const ctx: AttachmentContext = {
  groupId: '6f1c2a9e-0000-4000-8000-000000000001',
  attachmentId: '9d3c1f00-0000-4000-8000-0000000000bb',
};

beforeAll(() => initCrypto());

function expectDecryptFailure(fn: () => unknown) {
  expect(fn).toThrow(CryptoError);
  try {
    fn();
  } catch (e) {
    expect((e as CryptoError).code).toBe('DECRYPT_FAILED');
  }
}

describe('attachments', () => {
  const image = new Uint8Array(50_000).map((_, i) => (i * 31) & 0xff);

  it('round-trips, with a fresh key and nonce for each file', () => {
    const a = encryptAttachment(image, ctx);
    const b = encryptAttachment(image, ctx);
    expect(a.fileKey).toHaveLength(32);
    expect(a.blob.length).toBe(image.length + 24 + 16);
    expect(b64.encode(a.fileKey)).not.toBe(b64.encode(b.fileKey));
    expect(decryptAttachment(a.blob, a.fileKey, ctx)).toEqual(image);
  });

  it('rejects a tampered blob, another key, or a blob moved to another attachment or group', () => {
    const { blob, fileKey } = encryptAttachment(image, ctx);
    const tampered = blob.slice();
    tampered[100] ^= 1;
    expectDecryptFailure(() => decryptAttachment(tampered, fileKey, ctx));
    expectDecryptFailure(() => decryptAttachment(blob, encryptAttachment(image, ctx).fileKey, ctx));
    expectDecryptFailure(() => decryptAttachment(blob, fileKey, { ...ctx, attachmentId: '9d3c1f00-0000-4000-8000-0000000000cc' }));
    expectDecryptFailure(() => decryptAttachment(blob, fileKey, { ...ctx, groupId: '6f1c2a9e-0000-4000-8000-000000000002' }));
    expectDecryptFailure(() => decryptAttachment(blob.subarray(0, 10), fileKey, ctx));
  });
});

describe('message bodies', () => {
  // 32 bytes of 0x07, base64url (b64 needs sodium, which is not ready at collection time).
  const body: ImageBody = {
    kind: 'image',
    attachmentId: ctx.attachmentId,
    fileKey: 'BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc',
    mime: 'image/jpeg',
    width: 1600,
    height: 1200,
    size: 250_000,
    preview: 'AAAA',
  };

  it('keeps plain text as is (messages sent before attachments)', () => {
    expect(encodeMessageBody({ kind: 'text', text: 'salut {"kind":"image"}' })).toBe('salut {"kind":"image"}');
    expect(parseMessageBody('salut')).toEqual({ kind: 'text', text: 'salut' });
  });

  it('round-trips an image body', () => {
    expect(parseMessageBody(encodeMessageBody(body))).toEqual(body);
    const { preview: _, ...noPreview } = body;
    expect(parseMessageBody(encodeMessageBody(noPreview))).toEqual(noPreview);
  });

  it('refuses text that would read as an image', () => {
    expect(() => encodeMessageBody({ kind: 'text', text: '\u0000{}' })).toThrow(CryptoError);
  });

  it('reads malformed image bodies as null', () => {
    const enc = (v: object) => '\u0000' + JSON.stringify({ ...body, ...v });
    expect(parseMessageBody('\u0000not json')).toBeNull();
    expect(parseMessageBody(enc({ kind: 'video' }))).toBeNull();
    expect(parseMessageBody(enc({ attachmentId: '../etc/passwd' }))).toBeNull();
    expect(parseMessageBody(enc({ fileKey: b64.encode(new Uint8Array(16)) }))).toBeNull();
    expect(parseMessageBody(enc({ fileKey: '!!' }))).toBeNull();
    expect(parseMessageBody(enc({ mime: 'text/html' }))).toBeNull();
    expect(parseMessageBody(enc({ width: -1 }))).toBeNull();
    expect(parseMessageBody(enc({ size: 50 * 1024 * 1024 }))).toBeNull();
    expect(parseMessageBody(enc({ preview: 'x'.repeat(10_000) }))).toBeNull();
  });
});
