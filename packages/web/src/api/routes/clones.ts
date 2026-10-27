import { z } from 'zod';
import { ORPCError } from '@orpc/server';
import { and, eq, inArray } from 'drizzle-orm';
import { authed } from '../middleware/auth';
import { db } from '../database';
import { voiceClones } from '../database/schema';
import { signedPut, deleteObjects, headObject } from '../services/storage';
import {
  CONSENT_SENTENCE, CONSENT_THRESHOLD, MAX_SAMPLE_BYTES, MAX_SAMPLE_SECONDS, MIN_SAMPLE_SECONDS, sampleTypes,
  clonesFor, cloningSwitchOn, consentScore, createProviderVoice, deleteClone, loadSample, prepareSample, transcribe,
} from '../services/clones';

const types = Object.keys(sampleTypes) as [keyof typeof sampleTypes, ...(keyof typeof sampleTypes)[]];

/** Own-voice cloning (Studio: 1, Business: 3). The sample must start with the Burmese consent sentence. */
export const clones = {
  list: authed.handler(async ({ context }) => {
    const { clones, slots, plan } = await clonesFor(context.user.id);
    return {
      ready: cloningSwitchOn(), slots, plan, consentSentence: CONSENT_SENTENCE, minSeconds: MIN_SAMPLE_SECONDS, maxSeconds: MAX_SAMPLE_SECONDS,
      clones: clones.map(c => ({ id: c.id, name: c.name, voiceId: c.usable ? c.providerVoiceId : null, status: c.status, usable: c.usable, createdAt: c.createdAt, pausedAt: c.pausedAt, error: c.error })),
    };
  }),
  uploadSample: authed
    .input(z.object({ contentType: z.enum(types), size: z.number().int().min(1).max(MAX_SAMPLE_BYTES) }))
    .handler(async ({ context, input }) => {
      const key = `private/${context.user.id}/clone-samples/${crypto.randomUUID()}.${sampleTypes[input.contentType]}`;
      return { key, url: await signedPut(key, input.contentType) };
    }),
  create: authed
    .input(z.object({ name: z.string().trim().min(1).max(40), sampleKey: z.string().min(1), consent: z.literal(true) }))
    .handler(async ({ context, input }) => {
      const userId = context.user.id;
      if (!cloningSwitchOn()) throw new ORPCError('PRECONDITION_FAILED', { message: 'Voice cloning is not switched on yet. Your recording was not used.' });
      const ext = /\.([a-z0-9]+)$/.exec(input.sampleKey)?.[1] ?? '';
      if (!input.sampleKey.startsWith(`private/${userId}/clone-samples/`) || !Object.values(sampleTypes).includes(ext as never))
        throw new ORPCError('BAD_REQUEST', { message: 'Upload your recording first.' });
      const head = await headObject(input.sampleKey);
      if (!head || head.size > MAX_SAMPLE_BYTES) throw new ORPCError('BAD_REQUEST', { message: 'The recording upload did not finish, or is larger than 10 MB.' });
      // Reserve the slot first so two parallel requests cannot exceed the plan.
      const id = crypto.randomUUID();
      await db.transaction(async tx => {
        const { slots } = await clonesFor(userId);
        if (slots < 1) throw new ORPCError('PRECONDITION_FAILED', { message: 'Voice cloning is included with Studio (1 voice) and Business (3 voices).' });
        const live = await tx.select({ id: voiceClones.id }).from(voiceClones).where(and(eq(voiceClones.userId, userId), inArray(voiceClones.status, ['checking', 'active', 'paused'])));
        if (live.length >= slots) throw new ORPCError('PRECONDITION_FAILED', { message: `Your plan includes ${slots} cloned voice${slots > 1 ? 's' : ''}. Delete one first, or upgrade to Business.` });
        await tx.insert(voiceClones).values({ id, userId, name: input.name, status: 'checking', consentText: CONSENT_SENTENCE, sampleKey: input.sampleKey, createdAt: Date.now() });
      });
      const fail = async (status: 'rejected' | 'failed', error: string, extra: Partial<typeof voiceClones.$inferInsert> = {}) => {
        await db.update(voiceClones).set({ status, error, ...extra }).where(eq(voiceClones.id, id));
        await deleteObjects([input.sampleKey]).catch(() => undefined);
        await db.update(voiceClones).set({ sampleKey: null }).where(eq(voiceClones.id, id));
      };
      try {
        const sample = await prepareSample(await loadSample(input.sampleKey), ext);
        if (sample.seconds < MIN_SAMPLE_SECONDS || sample.seconds > MAX_SAMPLE_SECONDS) {
          await fail('rejected', `Recording must be ${MIN_SAMPLE_SECONDS} seconds to 5 minutes long (yours: ${Math.round(sample.seconds)} s).`);
          throw new ORPCError('BAD_REQUEST', { message: `Record ${MIN_SAMPLE_SECONDS} seconds to 5 minutes of your own voice, starting with the consent sentence.` });
        }
        const transcript = await transcribe(sample.mp3);
        const score = consentScore(transcript);
        if (score < CONSENT_THRESHOLD) {
          await fail('rejected', 'The consent sentence was not heard clearly at the start of the recording.', { transcript: transcript.slice(0, 2000), consentScore: Math.round(score * 100) });
          throw new ORPCError('BAD_REQUEST', { message: 'We could not hear the consent sentence clearly. Read it first, slowly, in a quiet room, then keep talking.' });
        }
        const providerVoiceId = await createProviderVoice(input.name, sample.mp3);
        await db.update(voiceClones).set({ status: 'active', providerVoiceId, transcript: transcript.slice(0, 2000), consentScore: Math.round(score * 100), error: null }).where(eq(voiceClones.id, id));
        // The sample is only needed for creation; keep nothing longer than necessary.
        await deleteObjects([input.sampleKey]).catch(() => undefined);
        await db.update(voiceClones).set({ sampleKey: null }).where(eq(voiceClones.id, id));
        return { id, name: input.name, voiceId: providerVoiceId, status: 'active' as const };
      } catch (error) {
        const [row] = await db.select().from(voiceClones).where(eq(voiceClones.id, id));
        if (row?.status === 'checking') await fail('failed', error instanceof ORPCError ? error.message : 'Cloning failed. Please try again.');
        throw error instanceof ORPCError ? error : new ORPCError('SERVICE_UNAVAILABLE', { message: 'Cloning failed. Please try again; your recording was deleted.' });
      }
    }),
  delete: authed.input(z.object({ id: z.string().uuid() })).handler(({ context, input }) => deleteClone(context.user.id, input.id)),
};
