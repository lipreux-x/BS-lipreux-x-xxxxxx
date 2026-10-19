import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

/*
 * Neon Object Storage (private bucket, declared in neon.ts). Credentials,
 * endpoint and region come from the AWS_* variables Neon injects into the
 * function. Phones never get credentials: they upload and download the
 * already-encrypted blobs through short-lived presigned URLs.
 */

export const BUCKET = 'attachments';
const URL_TTL_SECONDS = 5 * 60;

let client: S3Client | undefined;
const s3 = () =>
  (client ??= new S3Client({
    forcePathStyle: true, // Neon requires path-style addressing
    // No SDK checksum headers: the phone's plain PUT to a presigned URL could not match them.
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  }));

export const objectKey = (groupId: string, attachmentId: string) => `${groupId}/${attachmentId}`;

/** PUT URL for exactly `size` bytes: Content-Length is part of the signature. */
export function uploadUrl(key: string, size: number): Promise<string> {
  return getSignedUrl(
    s3(),
    new PutObjectCommand({ Bucket: BUCKET, Key: key, ContentLength: size, ContentType: 'application/octet-stream' }),
    { expiresIn: URL_TTL_SECONDS, signableHeaders: new Set(['content-length', 'content-type']) },
  );
}

export function downloadUrl(key: string): Promise<string> {
  return getSignedUrl(s3(), new GetObjectCommand({ Bucket: BUCKET, Key: key }), { expiresIn: URL_TTL_SECONDS });
}

/** Deleting a key that was never uploaded is not an error (S3 semantics). */
export async function deleteObjects(keys: string[]): Promise<void> {
  for (let i = 0; i < keys.length; i += 20) {
    await Promise.all(keys.slice(i, i + 20).map((Key) => s3().send(new DeleteObjectCommand({ Bucket: BUCKET, Key }))));
  }
}
