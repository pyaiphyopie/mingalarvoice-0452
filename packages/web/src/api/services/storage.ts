import { DeleteObjectsCommand, GetObjectCommand, HeadObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

/** Private object storage (Tigris, S3 API). Every key lives under private/{userId}/... */
let client: S3Client | null = null;
function s3() {
  client ??= new S3Client({ region: 'auto', endpoint: process.env.S3_ENDPOINT, credentials: { accessKeyId: process.env.S3_ACCESS_KEY_ID!, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY! } });
  return client;
}
const Bucket = () => process.env.S3_BUCKET;

export async function putObject(key: string, body: Uint8Array, contentType: string) {
  await s3().send(new PutObjectCommand({ Bucket: Bucket(), Key: key, Body: body, ContentType: contentType }));
}
export async function getObject(key: string, maxBytes: number) {
  const result = await s3().send(new GetObjectCommand({ Bucket: Bucket(), Key: key }));
  if ((result.ContentLength ?? 0) > maxBytes) throw new Error('Stored object is too large');
  const bytes = await result.Body!.transformToByteArray();
  if (bytes.byteLength > maxBytes) throw new Error('Stored object is too large');
  return { bytes, contentType: result.ContentType ?? '' };
}
export async function headObject(key: string) {
  try {
    const result = await s3().send(new HeadObjectCommand({ Bucket: Bucket(), Key: key }));
    return { size: result.ContentLength ?? 0, contentType: result.ContentType ?? '' };
  } catch { return null; }
}
export const signedGet = (key: string, expiresIn = 300) => getSignedUrl(s3(), new GetObjectCommand({ Bucket: Bucket(), Key: key }), { expiresIn });
export const signedPut = (key: string, contentType: string, expiresIn = 600) => getSignedUrl(s3(), new PutObjectCommand({ Bucket: Bucket(), Key: key, ContentType: contentType }), { expiresIn });

export async function deleteObjects(keys: string[]) {
  for (let i = 0; i < keys.length; i += 1000) {
    const result = await s3().send(new DeleteObjectsCommand({ Bucket: Bucket(), Delete: { Objects: keys.slice(i, i + 1000).map(Key => ({ Key })), Quiet: true } }));
    if (result.Errors?.length) throw new Error('Object deletion incomplete');
  }
}
/** Keys under prefix last modified before cutoff (ms). */
export async function listOlderThan(prefix: string, cutoff: number) {
  const keys: string[] = [];
  let token: string | undefined;
  do {
    const page = await s3().send(new ListObjectsV2Command({ Bucket: Bucket(), Prefix: prefix, ContinuationToken: token }));
    for (const item of page.Contents ?? []) if (item.Key && item.LastModified && item.LastModified.getTime() < cutoff) keys.push(item.Key);
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);
  return keys;
}

/** Streams a (possibly large) object to a local file without holding it in memory. */
export async function downloadToFile(key: string, path: string, maxBytes: number) {
  const { createWriteStream } = await import('node:fs');
  const { pipeline } = await import('node:stream/promises');
  const result = await s3().send(new GetObjectCommand({ Bucket: Bucket(), Key: key }));
  if ((result.ContentLength ?? 0) > maxBytes) throw new Error('Stored object is too large');
  await pipeline(result.Body as never, createWriteStream(path));
  return result.ContentLength ?? 0;
}
/** Uploads a local file by streaming it (rendered videos can be hundreds of MB). */
export async function putFile(key: string, path: string, contentType: string) {
  const { createReadStream, statSync } = await import('node:fs');
  await s3().send(new PutObjectCommand({ Bucket: Bucket(), Key: key, Body: createReadStream(path), ContentLength: statSync(path).size, ContentType: contentType }));
}
