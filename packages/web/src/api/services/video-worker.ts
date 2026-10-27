import { and, asc, desc, eq, gte, lt, sql } from 'drizzle-orm';
import { parseBuffer } from 'music-metadata';
import { db } from '../database';
import { accounts, appleCredits, ledger, videoJobs } from '../database/schema';
import { videoCharge } from './tariff';
import { getObject, putObject } from './storage';
import { processRecapJob, recapLeaseMs, type RecapDeps } from './recap-worker';
import { imageExt, MAX_VIDEO_SECONDS, probeImage, renderNarratedVideo, type VideoShape } from './video-render';

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const LEASE_MS = 15 * 60000;
type Job = typeof videoJobs.$inferSelect;

export function videoSwitchOn() {
  return process.env.GENERATION_TARIFF_APPROVED === 'true' && process.env.VIDEO_GENERATION_APPROVED === 'true';
}

const defaults = {
  request: fetch as typeof fetch,
  store: putObject,
  load: (key: string) => getObject(key, MAX_IMAGE_BYTES).then(r => r.bytes),
  probe: probeImage,
  render: renderNarratedVideo,
  recap: undefined as Partial<RecapDeps> | undefined,
};

/** One narrated-video job: validate image (free) -> narration (paid, once) -> render -> private storage -> settle. */
export async function processOneVideoJob(dependencies: Partial<typeof defaults> = {}) {
  const deps = { ...defaults, ...dependencies };
  if (!videoSwitchOn()) return { processed: false, disabled: true };
  const now = Date.now();
  // An expired lease means the paid narration call may have happened: never repeat it automatically.
  await db.update(videoJobs).set({ status: 'uncertain', error: 'Worker lease expired. Reconciliation required before retry or settlement.' }).where(and(eq(videoJobs.status, 'running'), lt(videoJobs.leaseUntil, now)));
  // Business jobs (priority 1) go first, then oldest first.
  const [candidate] = await db.select().from(videoJobs).where(eq(videoJobs.status, 'queued')).orderBy(desc(videoJobs.priority), asc(videoJobs.createdAt)).limit(1);
  if (!candidate) return { processed: false };
  const lease = candidate.kind === 'recap' ? recapLeaseMs(candidate) : LEASE_MS;
  const [job] = await db.update(videoJobs).set({ status: 'running', leaseUntil: now + lease }).where(and(eq(videoJobs.id, candidate.id), eq(videoJobs.status, 'queued'))).returning();
  if (!job) return { processed: false };
  if (job.kind === 'recap') return processRecapJob(job, deps.request, dependencies.recap);

  // Stage 1 — free checks. Any failure here releases the full reservation.
  let image: Uint8Array;
  try {
    image = await deps.load(job.imageKey!);
  } catch {
    return { processed: true, status: (await finishVideo(job, 'failed', { error: 'Background image is missing or larger than 10 MB. No credits were charged.' })) ? 'failed' : 'uncertain' };
  }
  const ext = imageExt(job.imageKey!);
  if (!(await deps.probe(image, ext)))
    return { processed: true, status: (await finishVideo(job, 'failed', { error: 'Background image could not be read. Upload a JPG, PNG or WebP. No credits were charged.' })) ? 'failed' : 'uncertain' };

  // Stage 2 — paid narration, dispatched exactly once.
  let audio: Uint8Array, seconds: number;
  try {
    const response = await deps.request('https://api.elevenlabs.io/v1/text-to-dialogue?output_format=mp3_44100_128', {
      method: 'POST', headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY!, 'Content-Type': 'application/json' },
      body: JSON.stringify({ inputs: [{ text: job.text, voice_id: job.voiceId }], model_id: job.model, language_code: 'my' }),
      signal: AbortSignal.timeout(240000),
    });
    if (!response.ok) {
      if (response.status >= 500) throw new Error('ambiguous');
      return { processed: true, status: (await finishVideo(job, 'failed', { error: `Speech provider rejected the narration (${response.status}). No credits were charged.` })) ? 'failed' : 'uncertain' };
    }
    const requestId = response.headers.get('request-id') ?? response.headers.get('x-request-id') ?? undefined;
    await db.update(videoJobs).set({ providerRequestId: requestId }).where(and(eq(videoJobs.id, job.id), eq(videoJobs.status, 'running')));
    audio = new Uint8Array(await response.arrayBuffer());
    if (audio.byteLength < 100 || !response.headers.get('content-type')?.startsWith('audio/')) throw new Error('unverified audio');
    seconds = (await parseBuffer(audio, { mimeType: 'audio/mpeg' }, { duration: true })).format.duration ?? NaN;
    if (!(seconds > 0)) throw new Error('unmeasurable audio');
  } catch {
    await markUncertain(job, 'Narration outcome is uncertain. Credits remain reserved pending reconciliation.');
    return { processed: true, status: 'uncertain' };
  }

  // Stage 3 — keep the paid narration first so a render problem never loses it.
  const audioKey = `private/${job.userId}/video/${job.id}.mp3`;
  try {
    await deps.store(audioKey, audio, 'audio/mpeg');
    await db.update(videoJobs).set({ audioKey }).where(eq(videoJobs.id, job.id));
  } catch {
    await markUncertain(job, 'Narration was generated but could not be stored. Credits remain reserved pending reconciliation.');
    return { processed: true, status: 'uncertain' };
  }
  if (seconds > MAX_VIDEO_SECONDS)
    return { processed: true, status: (await finishVideo(job, 'failed', { audioKey, error: 'Narration is longer than 3 minutes. Shorten the script. No credits were charged.' })) ? 'failed' : 'uncertain' };

  // Stage 4 — local render. Deterministic failures after a valid image are ours: full refund.
  let video: Uint8Array;
  try {
    video = await deps.render({ image, imageExt: ext, audio, script: job.text, durationSeconds: seconds, shape: job.shape as VideoShape, watermark: job.watermark });
  } catch {
    return { processed: true, status: (await finishVideo(job, 'failed', { audioKey, error: 'Video rendering failed. No credits were charged; please try again.' })) ? 'failed' : 'uncertain' };
  }
  const storageKey = `private/${job.userId}/video/${job.id}.mp4`;
  try {
    await deps.store(storageKey, video, 'video/mp4');
  } catch {
    await markUncertain(job, 'Video was rendered but could not be stored. Credits remain reserved pending reconciliation.');
    return { processed: true, status: 'uncertain' };
  }
  const charge = videoCharge(seconds, job.cost);
  const settled = await finishVideo(job, 'succeeded', { audioKey, storageKey, charge, error: charge.overrun ? 'Measured length exceeded your authorized ceiling; the service absorbed the difference.' : undefined });
  return { processed: true, status: settled ? 'succeeded' : 'uncertain' };
}

export async function markUncertain(job: Job, error: string) {
  await db.update(videoJobs).set({ status: 'uncertain', error }).where(and(eq(videoJobs.id, job.id), eq(videoJobs.status, 'running')));
}

export async function finishVideo(job: Job, status: 'succeeded' | 'failed', result: { audioKey?: string; storageKey?: string; error?: string; charge?: ReturnType<typeof videoCharge> }) {
  return db.transaction(async tx => {
    const [locked] = await tx.select().from(videoJobs).where(eq(videoJobs.id, job.id));
    if (locked?.status !== 'running') return false;
    if (status === 'succeeded' && !result.charge) throw new Error('Duration settlement required');
    const refund = status === 'failed' ? job.cost : result.charge!.refund;
    const table = locked.pool === 'apple' ? appleCredits : accounts;
    const updated = await tx.update(table).set({ available: sql`${table.available} + ${refund}`, reserved: sql`${table.reserved} - ${job.cost}` }).where(and(eq(table.userId, job.userId), gte(table.reserved, job.cost))).returning();
    if (!updated.length) throw new Error('Credit reservation invariant failed');
    await tx.insert(ledger).values({ id: crypto.randomUUID(), userId: job.userId, key: `finish:${job.id}`, type: status === 'failed' ? 'refund' : 'settlement', availableDelta: refund, reservedDelta: -job.cost, jobId: job.id, createdAt: Date.now(), pool: locked.pool });
    await tx.update(videoJobs).set({ status, audioKey: result.audioKey, storageKey: result.storageKey, durationMs: result.charge?.durationMs, actualCost: status === 'failed' ? 0 : result.charge!.actualCost, error: result.error ?? null, leaseUntil: null }).where(eq(videoJobs.id, job.id));
    return true;
  });
}
