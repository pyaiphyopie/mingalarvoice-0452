import { ORPCError } from '@orpc/server';
import { spawn } from 'node:child_process';
import type { EventEmitter } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { and, asc, eq, inArray, lt, ne } from 'drizzle-orm';
import { db } from '../database';
import { subscriptions, voiceClones } from '../database/schema';
import { CLONE_GRACE_MS, tierFor } from './plans';
import { deleteObjects, getObject } from './storage';

/** Read aloud at the start of the sample. Avoids brand names and digits so speech-to-text stays reliable. */
export const CONSENT_SENTENCE = 'ဤအသံသည် ကျွန်ုပ်၏ ကိုယ်ပိုင်အသံ ဖြစ်ပြီး အသံပွားယူရန် ကျွန်ုပ် သဘောတူပါသည်။';
export const CONSENT_THRESHOLD = 0.7;
export const MAX_SAMPLE_BYTES = 10 * 1024 * 1024;
export const MIN_SAMPLE_SECONDS = 20;
export const MAX_SAMPLE_SECONDS = 300;
export const sampleTypes = { 'audio/webm': 'webm', 'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a', 'audio/mpeg': 'mp3', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/ogg': 'ogg', 'audio/aac': 'aac' } as const;
export type SampleType = keyof typeof sampleTypes;

export const cloningSwitchOn = () => process.env.VOICE_CLONING_APPROVED === 'true' && !!process.env.ELEVENLABS_API_KEY;

/** Keep only Myanmar letters, so spacing, punctuation and Latin words never affect the score. */
const myanmarOnly = (text: string) => [...text.normalize('NFC')].filter(ch => /[က-႟ꩠ-ꩿꧠ-꧿]/u.test(ch));
function levenshtein(a: string[], b: string[]) {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0]!; row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = row[j]!;
      row[j] = Math.min(row[j]! + 1, row[j - 1]! + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return row[b.length]!;
}
/**
 * Best similarity (0..1) between the consent sentence and any window near the start of the transcript.
 * The sentence must open the recording, so only the first ~3 sentence-lengths are searched.
 */
export function consentScore(transcript: string, sentence = CONSENT_SENTENCE) {
  const want = myanmarOnly(sentence), all = myanmarOnly(transcript);
  if (!want.length || !all.length) return 0;
  const span = want.length;
  const got = all.slice(0, span * 3);
  let best = 0;
  for (let start = 0; start <= Math.max(0, got.length - Math.floor(span * 0.6)); start++) {
    for (const len of [Math.floor(span * 0.85), Math.floor(span * 0.93), span, Math.ceil(span * 1.07), Math.ceil(span * 1.15)]) {
      const window = got.slice(start, start + len);
      best = Math.max(best, 1 - levenshtein(want, window) / Math.max(want.length, window.length));
    }
  }
  return Math.max(0, Math.min(1, best));
}

function run(args: string[], timeoutMs = 60000) {
  return new Promise<string>((resolve, reject) => {
    const spawned = spawn(process.env.FFMPEG_PATH || 'ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });
    const child = spawned as unknown as EventEmitter & { kill(signal: string): void };
    let stderr = '';
    (spawned.stderr as unknown as EventEmitter).on('data', chunk => { stderr = (stderr + chunk).slice(-4000); });
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('Audio processing timed out')); }, timeoutMs);
    child.on('error', (e: Error) => { clearTimeout(timer); reject(e); });
    child.on('close', (code: number | null) => { clearTimeout(timer); if (code === 0) resolve(stderr); else reject(new Error(`ffmpeg exited ${code}`)); });
  });
}

/** Free, local: decode any browser recording, measure it and convert to mono MP3 for the provider. */
export async function prepareSample(bytes: Uint8Array, ext: string) {
  const dir = await mkdtemp(join(tmpdir(), 'mv-clone-'));
  try {
    const input = join(dir, `in.${ext}`), output = join(dir, 'sample.mp3');
    await writeFile(input, bytes);
    const log = await run(['-hide_banner', '-y', '-i', input, '-vn', '-ac', '1', '-ar', '44100', '-b:a', '128k', output]);
    const m = /time=(\d+):(\d+):(\d+(?:\.\d+)?)/g;
    let seconds = 0;
    for (const hit of log.matchAll(m)) seconds = Number(hit[1]) * 3600 + Number(hit[2]) * 60 + Number(hit[3]);
    const mp3 = new Uint8Array(await readFile(output));
    return { mp3, seconds };
  } finally { await rm(dir, { recursive: true, force: true }); }
}

type Fetch = typeof fetch;
const key = () => process.env.ELEVENLABS_API_KEY!;

export async function transcribe(mp3: Uint8Array, request: Fetch = fetch) {
  const form = new FormData();
  form.append('model_id', 'scribe_v1');
  form.append('language_code', 'mya');
  form.append('file', new Blob([mp3 as BlobPart], { type: 'audio/mpeg' }), 'sample.mp3');
  const r = await request('https://api.elevenlabs.io/v1/speech-to-text', { method: 'POST', headers: { 'xi-api-key': key() }, body: form, signal: AbortSignal.timeout(90000) });
  if (!r.ok) throw new ORPCError('SERVICE_UNAVAILABLE', { message: `Consent check is unavailable right now (${r.status}). Your recording was not used.` });
  return ((await r.json()) as { text?: string }).text ?? '';
}

export async function createProviderVoice(name: string, mp3: Uint8Array, request: Fetch = fetch) {
  const form = new FormData();
  form.append('name', `MV ${name}`.slice(0, 80));
  form.append('description', 'Mingalar Voice customer clone (owner consent recorded).');
  form.append('remove_background_noise', 'true');
  form.append('files', new Blob([mp3 as BlobPart], { type: 'audio/mpeg' }), 'sample.mp3');
  const r = await request('https://api.elevenlabs.io/v1/voices/add', { method: 'POST', headers: { 'xi-api-key': key() }, body: form, signal: AbortSignal.timeout(120000) });
  if (!r.ok) throw new ORPCError('SERVICE_UNAVAILABLE', { message: `The voice provider could not create the clone (${r.status}).` });
  const body = (await r.json()) as { voice_id?: string };
  if (!body.voice_id) throw new ORPCError('SERVICE_UNAVAILABLE', { message: 'The voice provider returned no voice.' });
  return body.voice_id;
}
export async function deleteProviderVoice(voiceId: string, request: Fetch = fetch) {
  const r = await request(`https://api.elevenlabs.io/v1/voices/${encodeURIComponent(voiceId)}`, { method: 'DELETE', headers: { 'xi-api-key': key() }, signal: AbortSignal.timeout(30000) });
  if (!r.ok && r.status !== 404) throw new Error(`Provider voice deletion failed (${r.status})`);
}

const LIVE = ['checking', 'active', 'paused'];
/** Clones the account currently holds, oldest first, with whether the plan lets them narrate. */
export async function clonesFor(userId: string, now = Date.now()) {
  const [sub] = await db.select().from(subscriptions).where(eq(subscriptions.userId, userId));
  const access = tierFor(sub, now);
  const slots = access.tier?.cloneSlots ?? 0;
  const rows = await db.select().from(voiceClones).where(and(eq(voiceClones.userId, userId), inArray(voiceClones.status, LIVE))).orderBy(asc(voiceClones.createdAt));
  return { slots, plan: access.name, clones: rows.map((c, i) => ({ ...c, usable: c.status === 'active' && i < slots })) };
}

/** Throws unless voiceId is a public library voice or one of the caller's own usable clones. */
export async function assertVoiceAllowed(userId: string, voiceId: string, publicIds: string[]) {
  if (publicIds.includes(voiceId)) return { cloned: false };
  const { clones } = await clonesFor(userId);
  const clone = clones.find(c => c.providerVoiceId === voiceId);
  if (!clone) throw new ORPCError('BAD_REQUEST', { message: 'This voice is unavailable.' });
  if (!clone.usable) throw new ORPCError('PRECONDITION_FAILED', { message: 'Your cloned voice is paused. Renew Studio or Business to use it again.' });
  return { cloned: true };
}

/**
 * Hourly: pause clones whose plan lapsed or lost slots; wake them when the plan returns;
 * delete them at the provider 30 days after pausing. Provider failures retry next hour.
 */
export async function sweepClones(now = Date.now(), request: Fetch = fetch) {
  const owners = await db.selectDistinct({ userId: voiceClones.userId }).from(voiceClones).where(inArray(voiceClones.status, ['active', 'paused']));
  let paused = 0, woke = 0, deleted = 0;
  for (const { userId } of owners) {
    const { clones, slots } = await clonesFor(userId, now);
    for (const [i, c] of clones.entries()) {
      const allowed = i < slots;
      if (c.status === 'active' && !allowed) { await db.update(voiceClones).set({ status: 'paused', pausedAt: now }).where(and(eq(voiceClones.id, c.id), eq(voiceClones.status, 'active'))); paused++; }
      else if (c.status === 'paused' && allowed) { await db.update(voiceClones).set({ status: 'active', pausedAt: null }).where(and(eq(voiceClones.id, c.id), eq(voiceClones.status, 'paused'))); woke++; }
    }
  }
  const expired = await db.select().from(voiceClones).where(and(eq(voiceClones.status, 'paused'), lt(voiceClones.pausedAt, now - CLONE_GRACE_MS)));
  for (const c of expired) {
    try {
      if (c.providerVoiceId) await deleteProviderVoice(c.providerVoiceId, request);
      await db.update(voiceClones).set({ status: 'deleted', deletedAt: now }).where(eq(voiceClones.id, c.id));
      deleted++;
    } catch { /* retried next sweep */ }
  }
  return { paused, woke, deleted };
}

/** Customer-initiated delete, and account deletion: removes the provider voice and the sample. */
export async function deleteClone(userId: string, id: string, request: Fetch = fetch) {
  const [c] = await db.select().from(voiceClones).where(and(eq(voiceClones.id, id), eq(voiceClones.userId, userId), ne(voiceClones.status, 'deleted')));
  if (!c) throw new ORPCError('NOT_FOUND');
  if (c.status === 'checking') throw new ORPCError('CONFLICT', { message: 'This clone is still being checked. Try again in a minute.' });
  if (c.providerVoiceId) await deleteProviderVoice(c.providerVoiceId, request);
  if (c.sampleKey) await deleteObjects([c.sampleKey]).catch(() => undefined);
  await db.update(voiceClones).set({ status: 'deleted', deletedAt: Date.now(), sampleKey: null }).where(eq(voiceClones.id, c.id));
  return { deleted: true };
}

export async function loadSample(key: string) {
  return (await getObject(key, MAX_SAMPLE_BYTES)).bytes;
}
