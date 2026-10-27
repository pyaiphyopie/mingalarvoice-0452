import { z } from 'zod';
import { ORPCError } from '@orpc/server';
import { and, desc, eq } from 'drizzle-orm';
import { authed } from '../middleware/auth';
import { db } from '../database';
import { ledger, videoJobs } from '../database/schema';
import { catalog, normalizedScript } from '../services/speech';
import { generationReady } from '../services/generation-status';
import { headObject, signedGet, signedPut } from '../services/storage';
import { MAX_IMAGE_BYTES, videoSwitchOn } from '../services/video-worker';
import { reserveCredits } from '../services/credits';
import { NARRATED_VIDEO_RATE } from '../services/tariff';
import { assertVoiceAllowed } from '../services/clones';
import { tierFor } from '../services/plans';
import { subscriptions } from '../database/schema';
import { MAX_CLIP_BYTES } from '../services/recap-render';

const clipTypes = { 'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm' } as const;
/** Burmese narration runs ~12–13 characters per second; 16/s leaves headroom for fast readers. */
const CHARS_PER_SECOND = 16;
async function accessFor(userId: string) {
  const [sub] = await db.select().from(subscriptions).where(eq(subscriptions.userId, userId));
  return tierFor(sub);
}

/** Narrated video (photo + narration, 9:16 or 16:9) and recap video (own clip + voiceover, 9:16). */
const RETENTION_MS = 30 * 86400000;
const imageTypes = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' } as const;
const MAX_RESERVATION = 180 * NARRATED_VIDEO_RATE;

const videoReady = async () => videoSwitchOn() && (await generationReady());

export const video = {
  status: authed.handler(async ({ context }) => {
    const access = await accessFor(context.user.id);
    const recapSeconds = access.tier?.maxVideoSeconds ?? 180;
    return {
      ready: await videoReady(), rate: NARRATED_VIDEO_RATE, maxSeconds: 180, maxReservation: MAX_RESERVATION,
      plan: access.name, watermark: access.tier?.watermark ?? true, priority: (access.tier?.priority ?? 0) > 0,
      recap: { maxSeconds: recapSeconds, maxReservation: recapSeconds * NARRATED_VIDEO_RATE, maxChars: recapSeconds * CHARS_PER_SECOND, maxClipBytes: MAX_CLIP_BYTES },
    };
  }),
  /** Presigned direct upload of the creator's own clip (recap mode). */
  uploadClip: authed
    .input(z.object({ contentType: z.enum(['video/mp4', 'video/quicktime', 'video/webm']), size: z.number().int().min(1).max(MAX_CLIP_BYTES) }))
    .handler(async ({ context, input }) => {
      const key = `private/${context.user.id}/uploads/${crypto.randomUUID()}.${clipTypes[input.contentType]}`;
      return { key, url: await signedPut(key, input.contentType, 3600) };
    }),
  /** Recap: own clip + Burmese voiceover + burned-in captions, 9:16. Limits follow the plan. */
  createRecap: authed
    .input(z.object({
      text: z.string().max(20000), voiceId: z.string().min(1), clipKey: z.string().min(1),
      audio: z.enum(['duck', 'replace']), framing: z.enum(['fit', 'fill']),
      idempotency: z.string().uuid(), maxCredits: z.number().int().min(1).max(1200 * NARRATED_VIDEO_RATE),
    }))
    .handler(async ({ context, input }) => {
      const userId = context.user.id;
      const access = await accessFor(userId);
      if (!access.tier) throw new ORPCError('PRECONDITION_FAILED', { message: 'An active plan or the free trial is required to make videos.' });
      const maxSeconds = access.tier.maxVideoSeconds;
      const text = input.text.normalize('NFC').trim();
      if (!text || [...text].length > maxSeconds * CHARS_PER_SECOND) throw new ORPCError('BAD_REQUEST', { message: `Your plan allows up to ${maxSeconds * CHARS_PER_SECOND} characters (about ${maxSeconds / 60} minutes).` });
      if (!/[က-႟ꩠ-ꩿ]/.test(text)) throw new ORPCError('BAD_REQUEST', { message: 'Add Burmese text to your script.' });
      if (!input.clipKey.startsWith(`private/${userId}/uploads/`) || !/\.(mp4|mov|webm)$/.test(input.clipKey))
        throw new ORPCError('BAD_REQUEST', { message: 'Upload your clip first.' });
      if (input.maxCredits > maxSeconds * NARRATED_VIDEO_RATE) throw new ORPCError('BAD_REQUEST', { message: `Your plan allows up to ${maxSeconds * NARRATED_VIDEO_RATE} credits per video.` });
      const c = await catalog();
      await assertVoiceAllowed(userId, input.voiceId, c.voices.map(v => v.voice_id));
      if (!(await videoReady())) throw new ORPCError('PRECONDITION_FAILED', { message: 'Video generation is not switched on yet. No credits were reserved.' });
      const minimum = Math.max(20, Math.ceil([...text].length / 4) * NARRATED_VIDEO_RATE);
      if (input.maxCredits < minimum) throw new ORPCError('BAD_REQUEST', { message: `Reserve at least ${minimum} credits for this script. Unused credits are returned after the video is measured.` });
      const clip = await headObject(input.clipKey);
      if (!clip || clip.size > MAX_CLIP_BYTES) throw new ORPCError('BAD_REQUEST', { message: 'The clip upload did not finish, or is larger than 500 MB.' });
      const options = JSON.stringify({ audio: input.audio, framing: input.framing, maxSeconds });
      return db.transaction(async tx => {
        const [existing] = await tx.select().from(videoJobs).where(and(eq(videoJobs.userId, userId), eq(videoJobs.idempotency, input.idempotency)));
        if (existing) {
          if (existing.text !== text || existing.voiceId !== input.voiceId || existing.cost !== input.maxCredits || existing.imageKey !== input.clipKey)
            throw new ORPCError('CONFLICT', { message: 'Request key already used for a different video.' });
          return existing;
        }
        const pool = await reserveCredits(tx, userId, input.maxCredits);
        const id = crypto.randomUUID(), now = Date.now();
        await tx.insert(ledger).values({ id: crypto.randomUUID(), userId, key: `reserve:${id}`, type: 'video_reservation', availableDelta: -input.maxCredits, reservedDelta: input.maxCredits, jobId: id, createdAt: now, pool });
        const [job] = await tx.insert(videoJobs).values({ id, userId, kind: 'recap', text, voiceId: input.voiceId, shape: '9:16', imageKey: input.clipKey, cost: input.maxCredits, idempotency: input.idempotency, createdAt: now, pool, watermark: access.tier!.watermark, priority: access.tier!.priority, options }).returning();
        return job!;
      });
    }),
  captions: authed.input(z.object({ id: z.string() })).handler(async ({ context, input }) => {
    const [job] = await db.select().from(videoJobs).where(and(eq(videoJobs.id, input.id), eq(videoJobs.userId, context.user.id)));
    if (!job?.srtKey || job.status !== 'succeeded' || job.createdAt + RETENTION_MS < Date.now()) throw new ORPCError('NOT_FOUND', { message: 'Captions are unavailable or expired.' });
    return { url: await signedGet(job.srtKey) };
  }),
  /** Presigned direct upload of a background image to the caller's private prefix. */
  uploadImage: authed
    .input(z.object({ contentType: z.enum(['image/jpeg', 'image/png', 'image/webp']), size: z.number().int().min(1).max(MAX_IMAGE_BYTES) }))
    .handler(async ({ context, input }) => {
      const key = `private/${context.user.id}/uploads/${crypto.randomUUID()}.${imageTypes[input.contentType]}`;
      return { key, url: await signedPut(key, input.contentType) };
    }),
  list: authed.handler(({ context }) =>
    db.select().from(videoJobs).where(eq(videoJobs.userId, context.user.id)).orderBy(desc(videoJobs.createdAt)).limit(50),
  ),
  create: authed
    .input(z.object({
      text: z.string(), voiceId: z.string().min(1), shape: z.enum(['9:16', '16:9']), imageKey: z.string().min(1),
      idempotency: z.string().uuid(), maxCredits: z.number().int().min(1).max(MAX_RESERVATION),
    }))
    .handler(async ({ context, input }) => {
      const text = normalizedScript(input.text);
      if (!input.imageKey.startsWith(`private/${context.user.id}/uploads/`) || !/\.(jpg|png|webp)$/.test(input.imageKey))
        throw new ORPCError('BAD_REQUEST', { message: 'Upload a background image first.' });
      const c = await catalog();
      await assertVoiceAllowed(context.user.id, input.voiceId, c.voices.map(v => v.voice_id));
      const access = await accessFor(context.user.id);
      if (!(await videoReady()))
        throw new ORPCError('PRECONDITION_FAILED', { message: 'Video generation is not switched on yet. No credits were reserved.' });
      const minimum = Math.max(20, Math.ceil([...text].length / 4) * NARRATED_VIDEO_RATE);
      if (input.maxCredits < minimum)
        throw new ORPCError('BAD_REQUEST', { message: `Reserve at least ${minimum} credits for this script. Unused credits are returned after the video is measured.` });
      const image = await headObject(input.imageKey);
      if (!image || image.size > MAX_IMAGE_BYTES) throw new ORPCError('BAD_REQUEST', { message: 'The background image upload did not finish, or is larger than 10 MB.' });
      return db.transaction(async tx => {
        const [existing] = await tx.select().from(videoJobs).where(and(eq(videoJobs.userId, context.user.id), eq(videoJobs.idempotency, input.idempotency)));
        if (existing) {
          if (existing.text !== text || existing.voiceId !== input.voiceId || existing.cost !== input.maxCredits || existing.shape !== input.shape || existing.imageKey !== input.imageKey)
            throw new ORPCError('CONFLICT', { message: 'Request key already used for a different video.' });
          return existing;
        }
        const pool = await reserveCredits(tx, context.user.id, input.maxCredits);
        const id = crypto.randomUUID(), now = Date.now();
        await tx.insert(ledger).values({ id: crypto.randomUUID(), userId: context.user.id, key: `reserve:${id}`, type: 'video_reservation', availableDelta: -input.maxCredits, reservedDelta: input.maxCredits, jobId: id, createdAt: now, pool });
        const [job] = await tx.insert(videoJobs).values({ id, userId: context.user.id, text, voiceId: input.voiceId, shape: input.shape, imageKey: input.imageKey, cost: input.maxCredits, idempotency: input.idempotency, createdAt: now, pool, watermark: access.tier?.watermark ?? true, priority: access.tier?.priority ?? 0 }).returning();
        return job!;
      });
    }),
  download: authed.input(z.object({ id: z.string() })).handler(async ({ context, input }) => {
    const [job] = await db.select().from(videoJobs).where(and(eq(videoJobs.id, input.id), eq(videoJobs.userId, context.user.id)));
    if (!job?.storageKey || job.status !== 'succeeded' || job.createdAt + RETENTION_MS < Date.now())
      throw new ORPCError('NOT_FOUND', { message: 'This video is unavailable or expired.' });
    return { url: await signedGet(job.storageKey) };
  }),
};
