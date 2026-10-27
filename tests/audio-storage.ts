import { PutObjectCommand, GetObjectCommand, DeleteObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '../packages/web/node_modules/@aws-sdk/s3-request-presigner';
import { parseBuffer } from '../packages/web/node_modules/music-metadata/lib/index.js';
import { audioCharge } from '../packages/web/src/api/services/tariff';

const path = '/home/user/burmese-engines.report/eleven-test/burmese-eleven-v4.mp3';
const audio = new Uint8Array(await Bun.file(path).arrayBuffer());
const metadata = await parseBuffer(audio, { mimeType: 'audio/mpeg' }, { duration: true });
const charge = audioCharge(metadata.format.duration ?? NaN, 120);
const client = new S3Client({ region: 'auto', endpoint: process.env.S3_ENDPOINT, credentials: { accessKeyId: process.env.S3_ACCESS_KEY_ID!, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY! } });
const key = `private/diagnostics/${crypto.randomUUID()}.mp3`;
const Bucket = process.env.S3_BUCKET!;
try {
 await client.send(new PutObjectCommand({ Bucket, Key: key, Body: audio, ContentType: 'audio/mpeg' }));
 const url = await getSignedUrl(client, new GetObjectCommand({ Bucket, Key: key }), { expiresIn: 60 });
 const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
 if (!response.ok) throw new Error(`Signed download failed: ${response.status}`);
 const downloaded = new Uint8Array(await response.arrayBuffer());
 if (Buffer.compare(Buffer.from(audio), Buffer.from(downloaded)) !== 0) throw new Error('Downloaded audio differs');
 // Remove signing parameters to verify the object is not publicly readable.
 const unsigned = new URL(url); unsigned.search = '';
 const publicResponse = await fetch(unsigned, { signal: AbortSignal.timeout(30000) });
 if (publicResponse.ok) throw new Error('SECURITY FAILURE: object is publicly readable');
 const result = { privateUpload: 'passed', signedDownload: 'passed', exactByteMatch: true, unsignedAccessStatus: publicResponse.status, ...charge };
 await Bun.write('/home/user/burmese-engines.report/eleven-test/storage-result.json', JSON.stringify(result, null, 2));
 console.log(result);
} finally {
 await client.send(new DeleteObjectCommand({ Bucket, Key: key }));
 console.log('Diagnostic object removed.');
}