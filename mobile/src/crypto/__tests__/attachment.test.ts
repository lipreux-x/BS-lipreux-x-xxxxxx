import {
  decryptAttachment,
  encodeMessageBody,
  encryptAttachment,
  parseMessageBody,
  replyExcerpt,
  type ReplyRef,
  type AttachmentContext,
  type ImageBody,
  type VoiceBody,
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
    expect(encodeMessageBody({ kind: 'text', text: 'salut {"kind":"image"}' }).trimEnd()).toBe('salut {"kind":"image"}');
    expect(parseMessageBody('salut')).toEqual({ kind: 'text', text: 'salut' });
  });

  it('pads every body to a fixed size, and reads it back unpadded', () => {
    const short = encodeMessageBody({ kind: 'text', text: 'ok' });
    const longer = encodeMessageBody({ kind: 'text', text: 'Une phrase bien plus longue que « ok », mais pas tant que ça.' });
    const bytes = (x: string) => new TextEncoder().encode(x).length;
    expect(bytes(short)).toBe(256);
    expect(bytes(longer)).toBe(256);
    expect(parseMessageBody(short)).toEqual({ kind: 'text', text: 'ok' });
    // Bytes, not characters: accented letters weigh two.
    expect(bytes(encodeMessageBody({ kind: 'text', text: 'é'.repeat(200) }))).toBe(1024);
    expect(encodeMessageBody({ kind: 'text', text: 'a'.repeat(4000) }).length).toBe(4096);
    expect(parseMessageBody(encodeMessageBody(body))).toEqual(body);
    // A version without padding reads a structured body all the same (JSON ignores trailing blanks).
    expect(() => JSON.parse(encodeMessageBody({ kind: 'reaction', messageId: body.attachmentId, reaction: null }).slice(1))).not.toThrow();
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

describe('voice message bodies', () => {
  const voice: VoiceBody = {
    kind: 'voice',
    attachmentId: ctx.attachmentId,
    fileKey: 'BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc',
    mime: 'audio/mp4',
    durationMs: 7300,
    size: 60_000,
    waveform: [0, 12, 100, 55],
  };

  it('round-trips, with or without a waveform', () => {
    expect(parseMessageBody(encodeMessageBody(voice))).toEqual(voice);
    const { waveform: _, ...flat } = voice;
    expect(parseMessageBody(encodeMessageBody(flat))).toEqual(flat);
  });

  it('is quoted without text', () => {
    expect(replyExcerpt(voice)).toEqual({ excerpt: '', voice: true });
  });

  it('reads malformed voice bodies as null', () => {
    const enc = (v: object) => '\u0000' + JSON.stringify({ ...voice, ...v });
    expect(parseMessageBody(enc({ mime: 'audio/x-wav' }))).toBeNull();
    expect(parseMessageBody(enc({ durationMs: 0 }))).toBeNull();
    expect(parseMessageBody(enc({ durationMs: 60 * 60 * 1000 }))).toBeNull();
    expect(parseMessageBody(enc({ waveform: [101] }))).toBeNull();
    expect(parseMessageBody(enc({ waveform: new Array(65).fill(1) }))).toBeNull();
    expect(parseMessageBody(enc({ waveform: 'loud' }))).toBeNull();
    expect(parseMessageBody(enc({ fileKey: '!!' }))).toBeNull();
    expect(parseMessageBody(enc({ size: 50 * 1024 * 1024 }))).toBeNull();
  });
});

describe('story bodies', () => {
  const story = {
    kind: 'story' as const,
    attachmentId: ctx.attachmentId,
    fileKey: 'BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc',
    mime: 'image/jpeg' as const,
    width: 1200,
    height: 1600,
    size: 180_000,
    preview: 'AAAA',
  };

  it('round-trips, with or without a preview', () => {
    expect(parseMessageBody(encodeMessageBody(story))).toEqual(story);
    const { preview: _, ...flat } = story;
    expect(parseMessageBody(encodeMessageBody(flat))).toEqual(flat);
  });

  it('is checked like an image, and can answer nothing', () => {
    const enc = (v: object) => '\u0000' + JSON.stringify({ ...story, ...v });
    expect(parseMessageBody(enc({ mime: 'image/png' }))).toBeNull();
    expect(parseMessageBody(enc({ height: 0 }))).toBeNull();
    expect(parseMessageBody(enc({ fileKey: '!!' }))).toBeNull();
    const replyTo = { messageId: '1b9d6bcd-0000-4000-8000-0000000000aa', senderId: '2c8e7a00-0000-4000-8000-0000000000bb', excerpt: '' };
    expect(parseMessageBody(enc({ replyTo }))).toBeNull();
  });

  it('is quoted as a story, and as an image for older versions', () => {
    expect(replyExcerpt(story)).toEqual({ excerpt: '', image: true, story: true });
  });
});

describe('document bodies', () => {
  const doc = {
    kind: 'file' as const,
    attachmentId: ctx.attachmentId,
    fileKey: 'BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc',
    mime: 'application/pdf',
    name: 'Contrat 2026.pdf',
    size: 180_000,
  };

  it('round-trips, with or without a reply', () => {
    expect(parseMessageBody(encodeMessageBody(doc))).toEqual(doc);
    const replyTo = { messageId: '1b9d6bcd-0000-4000-8000-0000000000aa', senderId: '2c8e7a00-0000-4000-8000-0000000000bb', excerpt: 'ok' };
    expect(parseMessageBody(encodeMessageBody({ ...doc, replyTo }))).toEqual({ ...doc, replyTo });
  });

  it('refuses a name with a path or control characters, a silly type, a bad key', () => {
    const enc = (v: object) => ' ' + JSON.stringify({ ...doc, ...v });
    expect(parseMessageBody(enc({ name: '../x.pdf' }))).toBeNull();
    expect(parseMessageBody(enc({ name: 'a b' }))).toBeNull();
    expect(parseMessageBody(enc({ name: '' }))).toBeNull();
    expect(parseMessageBody(enc({ name: 'x'.repeat(121) }))).toBeNull();
    expect(parseMessageBody(enc({ mime: 'not a type' }))).toBeNull();
    expect(parseMessageBody(enc({ fileKey: '!!' }))).toBeNull();
    expect(parseMessageBody(enc({ size: 0 }))).toBeNull();
  });

  it('is quoted by its name', () => {
    expect(replyExcerpt(doc)).toEqual({ excerpt: 'Contrat 2026.pdf', file: true });
  });
});

describe('reaction bodies', () => {
  const reaction = { kind: 'reaction' as const, messageId: '1b9d6bcd-0000-4000-8000-0000000000aa', reaction: 'crown' as const };

  it('round-trips, taking one back included', () => {
    expect(parseMessageBody(encodeMessageBody(reaction))).toEqual(reaction);
    expect(parseMessageBody(encodeMessageBody({ ...reaction, reaction: null }))).toEqual({ ...reaction, reaction: null });
  });

  it('refuses an unknown reaction, a bad target, a reply', () => {
    const enc = (v: object) => ' ' + JSON.stringify({ ...reaction, ...v });
    expect(parseMessageBody(enc({ reaction: 'rocket' }))).toBeNull();
    expect(parseMessageBody(enc({ reaction: '👍' }))).toBeNull();
    expect(parseMessageBody(enc({ messageId: 'nope' }))).toBeNull();
    const replyTo = { messageId: '1b9d6bcd-0000-4000-8000-0000000000aa', senderId: '2c8e7a00-0000-4000-8000-0000000000bb', excerpt: '' };
    expect(parseMessageBody(enc({ replyTo }))).toBeNull();
  });
});

describe('replies', () => {
  const replyTo: ReplyRef = {
    messageId: '1b9d6bcd-0000-4000-8000-0000000000aa',
    senderId: '2c8e7a00-0000-4000-8000-0000000000bb',
    excerpt: 'Rdv à la base ce soir ?',
  };

  it('round-trips a text reply and an image reply', () => {
    const text = { kind: 'text' as const, text: 'Ok 👍', replyTo };
    expect(parseMessageBody(encodeMessageBody(text))).toEqual(text);
    const image = {
      kind: 'image' as const,
      attachmentId: ctx.attachmentId,
      fileKey: 'BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc',
      mime: 'image/jpeg' as const,
      width: 10,
      height: 10,
      size: 100,
      replyTo: { ...replyTo, excerpt: '', image: true as const },
    };
    expect(parseMessageBody(encodeMessageBody(image))).toEqual(image);
  });

  it('round-trips a reply to a story, which older versions read as a reply to a photo', () => {
    const text = { kind: 'text' as const, text: 'Trop bien', replyTo: { ...replyTo, excerpt: '', image: true as const, story: true as const } };
    expect(parseMessageBody(encodeMessageBody(text))).toEqual(text);
  });

  it('keeps a text without reply as plain text (readable by older versions)', () => {
    expect(encodeMessageBody({ kind: 'text', text: 'salut' }).trimEnd()).toBe('salut');
  });

  it('cuts long excerpts and quotes images without text', () => {
    const long = replyExcerpt({ kind: 'text', text: 'a\n\nb '.repeat(100) });
    expect(long.excerpt.length).toBe(140);
    expect(long.excerpt.endsWith('…')).toBe(true);
    expect(long.excerpt).not.toContain('\n');
    expect(replyExcerpt({ kind: 'text', text: 'court' })).toEqual({ excerpt: 'court' });
  });

  it('reads malformed replies as null', () => {
    const enc = (r: object) => '\u0000' + JSON.stringify({ kind: 'text', text: 'ok', replyTo: { ...replyTo, ...r } });
    expect(parseMessageBody(enc({ messageId: 'nope' }))).toBeNull();
    expect(parseMessageBody(enc({ senderId: 42 }))).toBeNull();
    expect(parseMessageBody(enc({ excerpt: 'x'.repeat(500) }))).toBeNull();
    expect(parseMessageBody(enc({ image: 'yes' }))).toBeNull();
    expect(parseMessageBody(enc({ voice: 1 }))).toBeNull();
    expect(parseMessageBody(enc({ story: 'yes' }))).toBeNull();
    // A structured text must be a reply, and not empty.
    expect(parseMessageBody('\u0000' + JSON.stringify({ kind: 'text', text: 'ok' }))).toBeNull();
    expect(parseMessageBody('\u0000' + JSON.stringify({ kind: 'text', text: '', replyTo }))).toBeNull();
  });
});
