import { and, eq, lt, gte, sql, asc } from 'drizzle-orm';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { db } from '../database';
import { accounts, appleCredits, jobs, ledger } from '../database/schema';
import { parseBuffer } from 'music-metadata';
import { audioCharge } from './tariff';

async function storeAudio(key: string, audio: Uint8Array) {
  const s3 = new S3Client({ region: 'auto', endpoint: process.env.S3_ENDPOINT, credentials: { accessKeyId: process.env.S3_ACCESS_KEY_ID!, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY! } });
  await s3.send(new PutObjectCommand({ Bucket: process.env.S3_BUCKET, Key: key, Body: audio, ContentType: 'audio/mpeg' }));
}

/** Dependencies are injected only by isolated tests; production uses real fetch/private storage. */
export async function processOneJob(dependencies = { request: fetch, store: storeAudio }) {
  if (process.env.GENERATION_TARIFF_APPROVED !== 'true') return { processed: false, disabled: true };
  const now = Date.now();
  // Expired dispatched jobs are ambiguous: never automatically repeat the paid API call.
  await db.update(jobs).set({ status: 'uncertain', error: 'Worker lease expired. Reconciliation required before retry or settlement.' }).where(and(eq(jobs.status, 'running'), lt(jobs.leaseUntil, now)));
  const [candidate] = await db.select().from(jobs).where(eq(jobs.status, 'queued')).orderBy(asc(jobs.createdAt)).limit(1);
  if (!candidate) return { processed: false };
  const [job] = await db.update(jobs).set({ status: 'running', leaseUntil: now + 300000 }).where(and(eq(jobs.id, candidate.id), eq(jobs.status, 'queued'))).returning();
  if (!job) return { processed: false };
  try {
    const response = await dependencies.request('https://api.elevenlabs.io/v1/text-to-dialogue?output_format=mp3_44100_128', {
      method: 'POST', headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY!, 'Content-Type': 'application/json' },
      body: JSON.stringify({ inputs: [{ text: job.text, voice_id: job.voiceId }], model_id: job.model, language_code: 'my' }),
      signal: AbortSignal.timeout(180000),
    });
    if (!response.ok) {
      // Explicit 4xx rejection: no usable result; release exactly once. 5xx is ambiguous.
      if (response.status >= 500) throw new Error('Ambiguous speech provider failure. Reconciliation required.');
      const settled = await finish(job, 'failed', undefined, `Speech provider rejected generation (${response.status}).`);
      return { processed: true, status: settled ? 'failed' : 'uncertain' };
    }
    const requestId = response.headers.get('request-id') ?? response.headers.get('x-request-id') ?? undefined;
    await db.update(jobs).set({ providerRequestId: requestId }).where(and(eq(jobs.id, job.id), eq(jobs.status, 'running')));
    const audio = new Uint8Array(await response.arrayBuffer());
    if (audio.byteLength < 100 || !response.headers.get('content-type')?.startsWith('audio/')) throw new Error('Speech provider returned an unverified audio result.');
    const metadata = await parseBuffer(audio, { mimeType: 'audio/mpeg' }, { duration: true });
    const charge = audioCharge(metadata.format.duration ?? NaN, job.cost);
    const key = `private/${job.userId}/audio/${job.id}.mp3`;
    // Store provider request reference before object upload to help recover ambiguous crashes.
    await db.update(jobs).set({ providerRequestId: requestId }).where(eq(jobs.id, job.id));
    await dependencies.store(key, audio);
    const settled = await finish(job, 'succeeded', key, charge.overrun ? 'Measured duration exceeded your authorized ceiling; the service absorbed the difference.' : undefined, charge);
    return { processed: true, status: settled ? 'succeeded' : 'uncertain' };
  } catch {
    await db.update(jobs).set({ status: 'uncertain', error: 'Generation or storage outcome is uncertain. Credits remain reserved pending reconciliation.' }).where(and(eq(jobs.id, job.id), eq(jobs.status, 'running')));
    return { processed: true, status: 'uncertain' };
  }
}

export async function finish(job: typeof jobs.$inferSelect, status: 'succeeded' | 'failed', storageKey?: string, error?: string, charge?: ReturnType<typeof audioCharge>) {
  return db.transaction(async tx => {
    const [locked] = await tx.select().from(jobs).where(eq(jobs.id, job.id));
    if (locked?.status !== 'running') return false;
    if (status === 'succeeded' && !charge) throw new Error('Duration settlement required');
    const refund = status === 'failed' ? job.cost : charge!.refund;
    // Settle into the same pool that funded the reservation.
    const table = locked.pool === 'apple' ? appleCredits : accounts;
    const updated = await tx.update(table).set({ available: sql`${table.available} + ${refund}`, reserved: sql`${table.reserved} - ${job.cost}` }).where(and(eq(table.userId, job.userId), gte(table.reserved, job.cost))).returning();
    if (!updated.length) throw new Error('Credit reservation invariant failed');
    await tx.insert(ledger).values({ id: crypto.randomUUID(), userId: job.userId, key: `finish:${job.id}`, type: status === 'failed' ? 'refund' : 'settlement', availableDelta: refund, reservedDelta: -job.cost, jobId: job.id, createdAt: Date.now(), pool: locked.pool });
    await tx.update(jobs).set({ status, storageKey, durationMs: charge?.durationMs, actualCost: status === 'failed' ? 0 : charge!.actualCost, error: error ?? null, leaseUntil: null }).where(eq(jobs.id, job.id));
    return true;
  });
}