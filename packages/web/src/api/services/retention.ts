import { and, inArray, isNotNull, lt, notInArray, or } from 'drizzle-orm';
import { db } from '../database';
import { jobs, videoJobs } from '../database/schema';
import { deleteObjects, listOlderThan } from './storage';

/**
 * 30-day media retention (privacy policy): generated audio, generated video, narration tracks and
 * uploaded background images are deleted 30 days after creation. Scripts, history rows and the credit
 * ledger stay until account deletion. Jobs still queued/running/uncertain keep their files until settled,
 * because they are the evidence needed for reconciliation.
 */
export const RETENTION_MS = 30 * 86400000;
const ACTIVE = ['queued', 'running', 'uncertain'];

const defaults = { list: listOlderThan, remove: deleteObjects };

export async function purgeExpiredMedia(now = Date.now(), dependencies: Partial<typeof defaults> = {}) {
  const deps = { ...defaults, ...dependencies };
  const cutoff = now - RETENTION_MS;
  const audioRows = await db.select({ id: jobs.id, key: jobs.storageKey }).from(jobs)
    .where(and(lt(jobs.createdAt, cutoff), isNotNull(jobs.storageKey), notInArray(jobs.status, ACTIVE)));
  const videoRows = await db.select().from(videoJobs)
    .where(and(lt(videoJobs.createdAt, cutoff), notInArray(videoJobs.status, ACTIVE), or(isNotNull(videoJobs.storageKey), isNotNull(videoJobs.audioKey), isNotNull(videoJobs.imageKey))));
  // Anything still held for an active job is protected, even if the object itself is old.
  const held = new Set((await db.select({ a: videoJobs.audioKey, s: videoJobs.storageKey, i: videoJobs.imageKey }).from(videoJobs).where(inArray(videoJobs.status, ACTIVE)))
    .flatMap(r => [r.a, r.s, r.i]).filter(Boolean) as string[]);
  for (const r of await db.select({ key: jobs.storageKey }).from(jobs).where(and(inArray(jobs.status, ACTIVE), isNotNull(jobs.storageKey)))) held.add(r.key!);

  const keys = new Set<string>();
  for (const r of audioRows) keys.add(r.key!);
  for (const r of videoRows) for (const k of [r.storageKey, r.audioKey, r.imageKey]) if (k) keys.add(k);
  // Orphans: abandoned uploads and anything else under private/ older than the window.
  for (const k of await deps.list('private/', cutoff)) keys.add(k);
  for (const k of held) keys.delete(k);

  const toDelete = [...keys];
  if (toDelete.length) await deps.remove(toDelete);
  if (audioRows.length) await db.update(jobs).set({ storageKey: null }).where(inArray(jobs.id, audioRows.map(r => r.id)));
  if (videoRows.length) await db.update(videoJobs).set({ storageKey: null, audioKey: null, imageKey: null, srtKey: null, purgedAt: now }).where(inArray(videoJobs.id, videoRows.map(r => r.id)));
  return { deletedObjects: toDelete.length, audioJobs: audioRows.length, videoJobs: videoRows.length, held: held.size };
}
