import { ORPCError } from '@orpc/server';
import { and, eq, inArray, isNotNull } from 'drizzle-orm';
import { deleteObjects, listOlderThan } from './storage';
import { db } from '../database';
import { accounts, appleAccountTokens, appleCredits, favorites, jobs, ledger, subscriptions, user, videoJobs, voiceClones } from '../database/schema';
import { deleteProviderVoice } from './clones';

/** Account deletion requires a sign-in no older than this. */
export const REAUTH_WINDOW_MS = 15 * 60000;

/** Deletes the listed keys plus everything else under the user's private prefix (e.g. unused uploads). */
async function deleteStoredAudio(keys: string[], userId?: string) {
  const all = new Set(keys);
  if (userId) for (const key of await listOlderThan(`private/${userId}/`, Infinity)) all.add(key);
  if (all.size) await deleteObjects([...all]);
}

/**
 * Permanently deletes the profile, sign-in methods, sessions, scripts, audio, favorites and balances.
 * Pseudonymous purchase/ledger records stay for accounting, refunds and fraud prevention (see privacy policy).
 */
export async function deleteAccount(userId: string, sessionCreatedAt: Date | number, dependencies: { deleteAudio: (keys: string[], userId?: string) => Promise<void>; deleteVoice?: (voiceId: string) => Promise<void> } = { deleteAudio: deleteStoredAudio }) {
  if (Date.now() - new Date(sessionCreatedAt).getTime() > REAUTH_WINDOW_MS)
    throw new ORPCError('PRECONDITION_FAILED', { message: 'For your security, sign in again, then delete your account within 15 minutes.' });
  const active = await db.select({ id: jobs.id }).from(jobs).where(and(eq(jobs.userId, userId), inArray(jobs.status, ['queued', 'running', 'uncertain'])));
  const activeVideo = await db.select({ id: videoJobs.id }).from(videoJobs).where(and(eq(videoJobs.userId, userId), inArray(videoJobs.status, ['queued', 'running', 'uncertain'])));
  if (active.length || activeVideo.length)
    throw new ORPCError('CONFLICT', { message: 'A narration is still processing or awaiting reconciliation. Try again after it settles, or contact support.' });
  // Cloned voices are biometric data: remove them at the provider before anything else.
  const clones = await db.select().from(voiceClones).where(and(eq(voiceClones.userId, userId), inArray(voiceClones.status, ['checking', 'active', 'paused', 'failed', 'rejected'])));
  if (clones.some(c => c.status === 'checking')) throw new ORPCError('CONFLICT', { message: 'A voice clone is still being checked. Try again in a minute.' });
  try {
    for (const c of clones) if (c.providerVoiceId) await (dependencies.deleteVoice ?? deleteProviderVoice)(c.providerVoiceId);
  } catch {
    throw new ORPCError('SERVICE_UNAVAILABLE', { message: 'Deletion did not finish: your cloned voice could not be removed yet. Nothing else was deleted. Please retry.' });
  }
  const stored = await db.select({ key: jobs.storageKey }).from(jobs).where(and(eq(jobs.userId, userId), isNotNull(jobs.storageKey)));
  const videoKeys = (await db.select().from(videoJobs).where(eq(videoJobs.userId, userId))).flatMap(v => [v.storageKey, v.audioKey, v.imageKey]).filter(Boolean) as string[];
  try {
    await dependencies.deleteAudio([...stored.map(s => s.key!), ...videoKeys], userId);
  } catch {
    throw new ORPCError('SERVICE_UNAVAILABLE', {
      message: 'Deletion did not finish: some audio files could not be removed, and others may already be gone. Your account, credits and history were not deleted. Please retry.',
    });
  }
  const deletedKeys = new Set(stored.map(s => s.key));
  await db.transaction(async tx => {
    // Re-check inside the transaction: a narration started or finished elsewhere since the checks
    // above would otherwise lose its reservation or leave an undeleted audio file behind.
    const current = await tx.select({ status: jobs.status, key: jobs.storageKey }).from(jobs).where(eq(jobs.userId, userId));
    const currentVideo = await tx.select().from(videoJobs).where(eq(videoJobs.userId, userId));
    const deletedVideo = new Set(videoKeys);
    if (current.some(j => ['queued', 'running', 'uncertain'].includes(j.status) || (j.key && !deletedKeys.has(j.key)))
      || currentVideo.some(v => ['queued', 'running', 'uncertain'].includes(v.status) || [v.storageKey, v.audioKey, v.imageKey].some(k => k && !deletedVideo.has(k))))
      throw new ORPCError('CONFLICT', { message: 'A narration changed while deleting your account. Your account was not deleted; please retry.' });
    const now = Date.now();
    const [plan] = await tx.select().from(accounts).where(eq(accounts.userId, userId));
    const [apple] = await tx.select().from(appleCredits).where(eq(appleCredits.userId, userId));
    if (plan?.available) await tx.insert(ledger).values({ id: crypto.randomUUID(), userId, key: `delete:web:${userId}`, type: 'account_deleted_forfeit', availableDelta: -plan.available, reservedDelta: 0, createdAt: now, pool: 'web' });
    if (apple?.available) await tx.insert(ledger).values({ id: crypto.randomUUID(), userId, key: `delete:apple:${userId}`, type: 'account_deleted_forfeit', availableDelta: -apple.available, reservedDelta: 0, createdAt: now, pool: 'apple' });
    await tx.delete(favorites).where(eq(favorites.userId, userId));
    await tx.delete(voiceClones).where(eq(voiceClones.userId, userId));
    await tx.delete(jobs).where(eq(jobs.userId, userId));
    await tx.delete(videoJobs).where(eq(videoJobs.userId, userId));
    await tx.delete(accounts).where(eq(accounts.userId, userId));
    await tx.delete(appleCredits).where(eq(appleCredits.userId, userId));
    await tx.delete(subscriptions).where(eq(subscriptions.userId, userId));
    await tx.delete(appleAccountTokens).where(eq(appleAccountTokens.userId, userId));
    // Sessions and linked sign-in accounts cascade from the user row.
    await tx.delete(user).where(eq(user.id, userId));
  });
  return { deleted: true };
}
