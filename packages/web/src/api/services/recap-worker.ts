import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { parseBuffer } from 'music-metadata';
import { db } from '../database';
import { videoJobs } from '../database/schema';
import { videoCharge } from './tariff';
import { downloadToFile, putFile, putObject } from './storage';
import { buildSrt, chunkCues, MAX_CLIP_BYTES, probeClip, renderRecap, splitScript, type RecapOptions } from './recap-render';
import { finishVideo, markUncertain } from './video-worker';

type Job = typeof videoJobs.$inferSelect;
export type RecapDeps = {
  download: typeof downloadToFile; probe: typeof probeClip; render: typeof renderRecap;
  storeFile: typeof putFile; store: typeof putObject;
};
const defaults: RecapDeps = { download: downloadToFile, probe: probeClip, render: renderRecap, storeFile: putFile, store: putObject };

export const recapOptions = (job: Pick<Job, 'options'>): RecapOptions => ({ audio: 'duck', framing: 'fit', maxSeconds: 180, ...(job.options ? JSON.parse(job.options) : {}) });
/** Lease grows with the longest allowed recap so a slow render is not mistaken for a crash. */
export const recapLeaseMs = (job: Pick<Job, 'options'>) => 15 * 60000 + recapOptions(job).maxSeconds * 3000;

/**
 * Recap job: clip check (free) -> chunked narration (paid, each chunk once) -> render -> storage -> settle.
 * Ambiguous provider/storage outcomes keep the reservation for reconciliation; nothing paid is retried.
 */
export async function processRecapJob(job: Job, request: typeof fetch, overrides: Partial<RecapDeps> = {}) {
  const deps = { ...defaults, ...overrides };
  const options = recapOptions(job);
  const failed = async (error: string, extra: { audioKey?: string } = {}) =>
    ({ processed: true, status: (await finishVideo(job, 'failed', { ...extra, error })) ? 'failed' : 'uncertain' });
  const dir = await mkdtemp(join(tmpdir(), 'mv-recap-'));
  try {
    // Stage 1 — free checks on the uploaded clip.
    const clip = join(dir, 'clip');
    let probe: Awaited<ReturnType<typeof probeClip>>;
    try {
      await deps.download(job.imageKey!, clip, MAX_CLIP_BYTES);
      probe = await deps.probe(clip);
      if (!probe.hasVideo || !(probe.seconds > 0)) throw new Error('no video');
    } catch {
      return failed('The clip could not be read. Upload an MP4, MOV or WebM up to 500 MB. No credits were charged.');
    }

    // Stage 2 — paid narration, one request per chunk, never repeated.
    const chunks = splitScript(job.text);
    const parts: { text: string; seconds: number; audio: Uint8Array }[] = [];
    for (const [index, text] of chunks.entries()) {
      try {
        const response = await request('https://api.elevenlabs.io/v1/text-to-dialogue?output_format=mp3_44100_128', {
          method: 'POST', headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY!, 'Content-Type': 'application/json' },
          body: JSON.stringify({ inputs: [{ text, voice_id: job.voiceId }], model_id: job.model, language_code: 'my' }),
          signal: AbortSignal.timeout(240000),
        });
        if (!response.ok) {
          if (response.status < 500 && index === 0) return failed(`Speech provider rejected the narration (${response.status}). No credits were charged.`);
          throw new Error('ambiguous');
        }
        if (index === 0) {
          const requestId = response.headers.get('request-id') ?? response.headers.get('x-request-id') ?? undefined;
          await db.update(videoJobs).set({ providerRequestId: requestId }).where(eq(videoJobs.id, job.id));
        }
        const audio = new Uint8Array(await response.arrayBuffer());
        if (audio.byteLength < 100 || !response.headers.get('content-type')?.startsWith('audio/')) throw new Error('unverified audio');
        const seconds = (await parseBuffer(audio, { mimeType: 'audio/mpeg' }, { duration: true })).format.duration ?? NaN;
        if (!(seconds > 0)) throw new Error('unmeasurable');
        parts.push({ text, seconds, audio });
      } catch {
        await markUncertain(job, `Narration part ${index + 1} of ${chunks.length} is uncertain. Credits remain reserved pending reconciliation.`);
        return { processed: true, status: 'uncertain' };
      }
    }
    // MP3 frames concatenate cleanly; keep the paid narration before rendering.
    const narrationBytes = new Uint8Array(parts.reduce((n, p) => n + p.audio.byteLength, 0));
    let offset = 0;
    for (const p of parts) { narrationBytes.set(p.audio, offset); offset += p.audio.byteLength; }
    const seconds = parts.reduce((n, p) => n + p.seconds, 0);
    const narration = join(dir, 'narration.mp3');
    await writeFile(narration, narrationBytes);
    const audioKey = `private/${job.userId}/video/${job.id}.mp3`;
    try {
      await deps.store(audioKey, narrationBytes, 'audio/mpeg');
      await db.update(videoJobs).set({ audioKey }).where(eq(videoJobs.id, job.id));
    } catch {
      await markUncertain(job, 'Narration was generated but could not be stored. Credits remain reserved pending reconciliation.');
      return { processed: true, status: 'uncertain' };
    }
    if (seconds > options.maxSeconds)
      return failed(`Voiceover is longer than your plan's ${Math.round(options.maxSeconds / 60)}-minute limit. Shorten the script. No credits were charged.`, { audioKey });

    // Stage 3 — render. Deterministic failures after a valid clip are ours: full refund.
    const cues = chunkCues(parts);
    let output: string;
    try {
      output = await deps.render({ clip, narration, dir, seconds, cues, options, clipHasAudio: probe.hasAudio, watermark: job.watermark });
    } catch {
      return failed('Video rendering failed. No credits were charged; please try again.', { audioKey });
    }
    const storageKey = `private/${job.userId}/video/${job.id}.mp4`;
    const srtKey = `private/${job.userId}/video/${job.id}.srt`;
    try {
      await deps.storeFile(storageKey, output, 'video/mp4');
      await deps.store(srtKey, new TextEncoder().encode(buildSrt(cues)), 'application/x-subrip');
      await db.update(videoJobs).set({ srtKey }).where(eq(videoJobs.id, job.id));
    } catch {
      await markUncertain(job, 'Video was rendered but could not be stored. Credits remain reserved pending reconciliation.');
      return { processed: true, status: 'uncertain' };
    }
    const charge = videoCharge(seconds, job.cost);
    const settled = await finishVideo(job, 'succeeded', { audioKey, storageKey, charge, error: charge.overrun ? 'Measured length exceeded your authorized ceiling; the service absorbed the difference.' : undefined });
    return { processed: true, status: settled ? 'succeeded' : 'uncertain' };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
