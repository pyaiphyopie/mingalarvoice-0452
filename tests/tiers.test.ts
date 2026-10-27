/**
 * Free trial, own-voice cloning and recap video.
 *
 *   bun --env-file=.env test tests/tiers.test.ts
 *
 * Schema: read-only DDL pull from the live database into a throwaway SQLite file (no rows copied,
 * nothing written to production). Storage and every provider call are stubbed; ffmpeg runs for real.
 */
import { test, expect, beforeAll, beforeEach, spyOn, mock } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { createClient } from '../packages/web/node_modules/@libsql/client';

const dir = mkdtempSync('/home/user/tiers-test-');
const liveUrl = process.env.DATABASE_URL!;
if (!liveUrl || liveUrl.startsWith('file:')) throw new Error('Run with --env-file=.env so the live schema can be read');
const remote = createClient({ url: liveUrl, authToken: process.env.DATABASE_AUTH_TOKEN });
const ddl = (await remote.execute("SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY CASE type WHEN 'table' THEN 0 ELSE 1 END")).rows.map(r => String(r.sql));
remote.close();
const local = createClient({ url: `file:${dir}/t.db` });
for (const statement of ddl) await local.execute(statement);
local.close();
process.env.DATABASE_URL = `file:${dir}/t.db`;
delete process.env.DATABASE_AUTH_TOKEN;
process.env.GENERATION_TARIFF_APPROVED = 'true';
process.env.VIDEO_GENERATION_APPROVED = 'true';
process.env.VOICE_CLONING_APPROVED = 'true';
for (const key of ['ELEVENLABS_API_KEY', 'S3_ENDPOINT', 'S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY']) process.env[key] = 'isolated-fixture';

const bucket = new Map<string, { bytes: Uint8Array; modified: number }>();
mock.module('../packages/web/src/api/services/storage', () => ({
  putObject: async (key: string, bytes: Uint8Array) => { bucket.set(key, { bytes, modified: Date.now() }); },
  getObject: async (key: string) => { const o = bucket.get(key); if (!o) throw new Error('missing'); return { bytes: o.bytes, contentType: '' }; },
  headObject: async (key: string) => { const o = bucket.get(key); return o ? { size: o.bytes.byteLength, contentType: '' } : null; },
  signedGet: async (key: string) => `https://signed.invalid/${key}`,
  signedPut: async (key: string) => `https://signed.invalid/put/${key}`,
  deleteObjects: async (keys: string[]) => { for (const k of keys) bucket.delete(k); },
  listOlderThan: async () => [],
  downloadToFile: async (key: string, path: string) => { const o = bucket.get(key); if (!o) throw new Error('missing'); await Bun.write(path, o.bytes); },
  putFile: async (key: string, path: string) => { bucket.set(key, { bytes: new Uint8Array(await Bun.file(path).arrayBuffer()), modified: Date.now() }); },
}));

const { db } = await import('../packages/web/src/api/database');
const { accounts, ledger, subscriptions, videoJobs, voiceClones, payments } = await import('../packages/web/src/api/database/schema');
const { auth } = await import('../packages/web/src/api/auth');
const { trial } = await import('../packages/web/src/api/routes/trial');
const { clones } = await import('../packages/web/src/api/routes/clones');
const { video } = await import('../packages/web/src/api/routes/video');
const { consentScore, CONSENT_SENTENCE, prepareSample, sweepClones, assertVoiceAllowed } = await import('../packages/web/src/api/services/clones');
const { splitScript, chunkCues, buildSrt } = await import('../packages/web/src/api/services/recap-render');
const { processOneVideoJob } = await import('../packages/web/src/api/services/video-worker');
const { heartbeat } = await import('../packages/web/src/api/services/generation-status');
const { call } = await import('../packages/web/node_modules/@orpc/server/dist/index.mjs');
const { eq } = await import('../packages/web/node_modules/drizzle-orm');

type Who = { id: string; email: string; emailVerified: boolean };
let who: Who | null = { id: 'u1', email: 'a@example.invalid', emailVerified: true };
spyOn(auth.api, 'getSession').mockImplementation(async () => (who ? { user: who, session: {} } : null) as never);
const context = { headers: new Headers() };

// Provider stub: catalog + STT + voice add/delete. Anything else is blocked.
const provider = { stt: CONSENT_SENTENCE + ' ဒီနေ့ ကျွန်တော် ရုပ်ရှင်အကြောင်း ပြောပြပါမယ်။', added: 0, deleted: [] as string[], other: [] as string[] };
spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
  const u = String(url);
  if (u.endsWith('/voices')) return Response.json({ voices: [{ voice_id: 'lib-voice', name: 'Lib', category: 'premade', preview_url: '', labels: {} }] });
  if (u.endsWith('/models')) return Response.json([{ model_id: 'eleven_v4', can_do_text_to_speech: true, languages: [{ language_id: 'my', name: 'Burmese' }] }]);
  if (u.endsWith('/v1/speech-to-text')) return Response.json({ text: provider.stt });
  if (u.endsWith('/v1/voices/add')) { provider.added++; return Response.json({ voice_id: `clone-${provider.added}` }); }
  if (u.includes('/v1/voices/') && init?.method === 'DELETE') { provider.deleted.push(u.split('/').pop()!); return new Response(null, { status: 200 }); }
  provider.other.push(u);
  throw new Error(`blocked: ${u}`);
});

const ff = (args: string[]) => { const r = Bun.spawnSync(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', ...args]); if (r.exitCode !== 0) throw new Error(r.stderr.toString()); };
ff(['-f', 'lavfi', '-i', 'sine=frequency=220:duration=25', '-c:a', 'libopus', `${dir}/voice.webm`]);
ff(['-f', 'lavfi', '-i', 'sine=frequency=220:duration=8', '-c:a', 'libmp3lame', `${dir}/short.mp3`]);
ff(['-f', 'lavfi', '-i', 'testsrc=size=640x360:rate=25:duration=4', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=4', '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', `${dir}/clip.mp4`]);
const voiceWebm = new Uint8Array(await Bun.file(`${dir}/voice.webm`).arrayBuffer());
const shortMp3 = new Uint8Array(await Bun.file(`${dir}/short.mp3`).arrayBuffer());
const clipMp4 = new Uint8Array(await Bun.file(`${dir}/clip.mp4`).arrayBuffer());
// Previously approved 7.08 s Burmese sample reused from disk — no provider spend.
const narration = new Uint8Array(await Bun.file('/home/user/burmese-engines.report/eleven-test/burmese-eleven-v4.mp3').arrayBuffer());
const tts = (counter: { n: number }) => (async () => { counter.n++; return new Response(narration, { headers: { 'content-type': 'audio/mpeg', 'request-id': 'test-only' } }); }) as unknown as typeof fetch;

const DAY = 86400000;
async function plan(userId: string, name: string | null, periodEnd = Date.now() + 30 * DAY, available = 0) {
  await db.insert(subscriptions).values({ userId, status: 'active', providerId: 'manual', periodEnd, cancelAtEnd: true, plan: name })
    .onConflictDoUpdate({ target: subscriptions.userId, set: { status: 'active', periodEnd, plan: name } });
  await db.insert(accounts).values({ userId, available, reserved: 0 }).onConflictDoUpdate({ target: accounts.userId, set: { available } });
}
async function putSample(userId: string, bytes = voiceWebm, ext = 'webm') {
  const { key } = await call(clones.uploadSample, { contentType: ext === 'webm' ? 'audio/webm' : 'audio/mpeg', size: bytes.byteLength }, { context });
  expect(key.startsWith(`private/${userId}/clone-samples/`)).toBe(true);
  bucket.set(key, { bytes, modified: Date.now() });
  return key;
}

beforeAll(async () => { await heartbeat(); });
beforeEach(async () => {
  for (const t of ['credit_accounts', 'credit_ledger', 'subscriptions', 'video_jobs', 'voice_clones', 'manual_payment_approvals']) await db.run(`DELETE FROM ${t}`);
  bucket.clear(); provider.added = 0; provider.deleted = []; provider.other = [];
  provider.stt = CONSENT_SENTENCE + ' ဒီနေ့ ကျွန်တော် ရုပ်ရှင်အကြောင်း ပြောပြပါမယ်။';
  who = { id: 'u1', email: 'a@example.invalid', emailVerified: true };
  process.env.VOICE_CLONING_APPROVED = 'true'; process.env.VIDEO_GENERATION_APPROVED = 'true';
  await heartbeat();
});

// ---------- trial ----------
test('trial: verified email only, once per email ever, never after a payment', async () => {
  who = { id: 'u1', email: 'A@Example.invalid', emailVerified: false };
  expect(await call(trial.status, undefined, { context })).toMatchObject({ verified: false, eligible: false, credits: 180 });
  await expect(call(trial.claim, undefined, { context })).rejects.toThrow('Verify your email');
  expect(await db.select().from(accounts)).toEqual([]);

  who = { ...who, emailVerified: true };
  const before = Date.now();
  const r = await call(trial.claim, undefined, { context });
  expect(r.credits).toBe(180);
  expect(r.periodEnd).toBeGreaterThanOrEqual(before + 14 * DAY);
  expect((await db.select().from(accounts))[0]).toMatchObject({ userId: 'u1', available: 180, reserved: 0 });
  expect((await db.select().from(subscriptions))[0]).toMatchObject({ plan: 'Trial', providerId: 'trial', status: 'active' });
  expect((await db.select().from(ledger)).map(e => [e.type, e.availableDelta])).toEqual([['trial_grant', 180]]);
  await expect(call(trial.claim, undefined, { context })).rejects.toThrow('already used');
  expect(await call(trial.status, undefined, { context })).toMatchObject({ claimed: true, eligible: false });

  // Delete the account and sign up again with the same address (case/space-insensitive): still refused.
  await db.run('DELETE FROM subscriptions'); await db.run('DELETE FROM credit_accounts');
  who = { id: 'u1-again', email: ' a@example.INVALID ', emailVerified: true };
  await expect(call(trial.claim, undefined, { context })).rejects.toThrow('already used');

  // A paying customer is not offered the trial.
  who = { id: 'payer', email: 'payer@example.invalid', emailVerified: true };
  await db.insert(payments).values({ id: crypto.randomUUID(), reference: 'KBZTEST1', userId: 'payer', ownerId: 'o', plan: 'Creator', method: 'KBZPay', amount: 25000, credits: 2400, approvedAt: Date.now(), periodEnd: Date.now() + 30 * DAY });
  expect((await call(trial.status, undefined, { context })).eligible).toBe(false);
  await expect(call(trial.claim, undefined, { context })).rejects.toThrow('new accounts only');
});

test('trial: two concurrent claims from separate connections grant exactly once', async () => {
  // Separate processes = separate database connections, like two app instances.
  const env = { ...process.env, TRIAL_RACE_DB: process.env.DATABASE_URL! };
  const spawnOne = () => Bun.spawn(['bun', '/home/user/mingalar-voice/tests/trial-race.ts'], { env, stdout: 'pipe', stderr: 'pipe' });
  const procs = [spawnOne(), spawnOne()];
  const out = await Promise.all(procs.map(async p => { await p.exited; return JSON.parse((await new Response(p.stdout).text()).trim().split('\n').pop()!); }));
  expect(out.filter(o => o.success).length).toBe(1);
  const rows = await db.select().from(accounts).where(eq(accounts.userId, 'race'));
  expect(rows[0]!.available).toBe(180);
  expect((await db.select().from(ledger).where(eq(ledger.userId, 'race'))).length).toBe(1);
}, 30000);

// ---------- consent + sample ----------
test('consent score: exact, embedded and unrelated speech', () => {
  expect(consentScore(CONSENT_SENTENCE)).toBe(1);
  expect(consentScore(`အင်း ${CONSENT_SENTENCE.replace('။', '')} ပြီးတော့ ဒီနေ့ ဇာတ်ကားအကြောင်း ပြောမယ်`)).toBeGreaterThan(0.9);
  // Small STT slips (one dropped syllable) still pass the 0.7 threshold.
  expect(consentScore(CONSENT_SENTENCE.replace('ကိုယ်ပိုင်', 'ကိုယ်'))).toBeGreaterThan(0.7);
  expect(consentScore('ဒီနေ့ ရာသီဥတု အရမ်းကောင်းတယ်။ ဈေးသွားမယ်။')).toBeLessThan(0.5);
  expect(consentScore('This is my voice and I agree')).toBe(0);
  // Said at the end instead of the start: refused.
  expect(consentScore(`${'ဒီနေ့ ရုပ်ရှင်ဇာတ်လမ်းအကြောင်း ပြောပြပါမယ်။ '.repeat(6)}${CONSENT_SENTENCE}`)).toBeLessThan(0.7);
  expect(consentScore('')).toBe(0);
});

test('prepareSample decodes a browser WebM recording to MP3 and measures it locally', async () => {
  const s = await prepareSample(voiceWebm, 'webm');
  expect(s.seconds).toBeGreaterThan(24.5);
  expect(s.seconds).toBeLessThan(25.5);
  expect(s.mp3.byteLength).toBeGreaterThan(1000);
});

// ---------- cloning ----------
test('cloning: switch, plan slots, length and consent gates; nothing reaches the provider when refused', async () => {
  await plan('u1', 'Studio');
  process.env.VOICE_CLONING_APPROVED = 'false';
  const key = await putSample('u1');
  await expect(call(clones.create, { name: 'Me', sampleKey: key, consent: true }, { context })).rejects.toThrow('not switched on');
  process.env.VOICE_CLONING_APPROVED = 'true';

  await plan('u1', 'Creator');
  await expect(call(clones.create, { name: 'Me', sampleKey: key, consent: true }, { context })).rejects.toThrow('Studio (1 voice)');

  await plan('u1', 'Studio');
  await expect(call(clones.create, { name: 'Me', sampleKey: 'private/someone-else/clone-samples/x.webm', consent: true }, { context })).rejects.toThrow('Upload your recording');

  const short = await putSample('u1', shortMp3, 'mp3');
  await expect(call(clones.create, { name: 'Me', sampleKey: short, consent: true }, { context })).rejects.toThrow('20 seconds');
  expect(bucket.has(short)).toBe(false); // refused samples are deleted

  provider.stt = 'ဒီနေ့ ရာသီဥတု အရမ်းကောင်းတယ်။';
  const k2 = await putSample('u1');
  await expect(call(clones.create, { name: 'Me', sampleKey: k2, consent: true }, { context })).rejects.toThrow('consent sentence');
  expect(bucket.has(k2)).toBe(false);
  expect(provider.added).toBe(0);
  const rows = await db.select().from(voiceClones);
  expect(rows.map(r => r.status).sort()).toEqual(['rejected', 'rejected']);
  expect(rows.every(r => r.sampleKey === null && r.providerVoiceId === null)).toBe(true);
  expect((await call(clones.list, undefined, { context })).clones).toEqual([]);
});

test('cloning: Studio gets one usable clone, the sample is deleted, other users cannot use it', async () => {
  await plan('u1', 'Studio');
  const key = await putSample('u1');
  const made = await call(clones.create, { name: 'My voice', sampleKey: key, consent: true }, { context });
  expect(made).toMatchObject({ status: 'active', voiceId: 'clone-1' });
  expect(bucket.has(key)).toBe(false);
  const [row] = await db.select().from(voiceClones);
  expect(row).toMatchObject({ status: 'active', sampleKey: null, consentText: CONSENT_SENTENCE });
  expect(row!.consentScore).toBeGreaterThanOrEqual(90);

  const list = await call(clones.list, undefined, { context });
  expect(list).toMatchObject({ ready: true, slots: 1, plan: 'Studio' });
  expect(list.clones.map((c: any) => [c.name, c.voiceId, c.usable])).toEqual([['My voice', 'clone-1', true]]);
  // Slot full.
  const k2 = await putSample('u1');
  await expect(call(clones.create, { name: 'Second', sampleKey: k2, consent: true }, { context })).rejects.toThrow('includes 1 cloned voice');
  expect(provider.added).toBe(1);

  expect(await assertVoiceAllowed('u1', 'clone-1', ['lib-voice'])).toEqual({ cloned: true });
  await expect(assertVoiceAllowed('intruder', 'clone-1', ['lib-voice'])).rejects.toThrow('unavailable');

  // Delete: provider voice removed, slot freed.
  await call(clones.delete, { id: row!.id }, { context });
  expect(provider.deleted).toEqual(['clone-1']);
  expect((await call(clones.list, undefined, { context })).clones).toEqual([]);
});

test('cloning: lapse pauses the clone, renewal wakes it, 30 days paused deletes it at the provider', async () => {
  await plan('u1', 'Studio');
  await call(clones.create, { name: 'Me', sampleKey: await putSample('u1'), consent: true }, { context });
  const now = Date.now();
  await db.update(subscriptions).set({ periodEnd: now - 1000 }).where(eq(subscriptions.userId, 'u1'));
  expect(await sweepClones(now)).toEqual({ paused: 1, woke: 0, deleted: 0 });
  await expect(assertVoiceAllowed('u1', 'clone-1', [])).rejects.toThrow('paused');

  await plan('u1', 'Studio');
  expect(await sweepClones(now)).toEqual({ paused: 0, woke: 1, deleted: 0 });
  expect(await assertVoiceAllowed('u1', 'clone-1', [])).toEqual({ cloned: true });

  // Downgrade to Creator (no slots) then wait out the grace period.
  await plan('u1', 'Creator');
  expect((await sweepClones(now)).paused).toBe(1);
  expect(await sweepClones(now + 31 * DAY)).toMatchObject({ deleted: 1 });
  expect(provider.deleted).toEqual(['clone-1']);
  expect((await db.select().from(voiceClones))[0]!.status).toBe('deleted');
});

// ---------- recap ----------
test('recap helpers: sentence-aligned chunks, timed cues and SRT', () => {
  const sentence = 'ဒီဇာတ်ကားမှာ သူရဲကောင်းဟာ မြို့ကို ကယ်တင်ဖို့ ကြိုးစားပါတယ်။';
  const long = Array(80).fill(sentence).join(' ');
  const chunks = splitScript(long);
  expect(chunks.length).toBeGreaterThan(2);
  expect(chunks.every(c => [...c].length <= 1500)).toBe(true);
  expect(chunks.every(c => c.endsWith('။'))).toBe(true);
  expect(chunks.join(' ').replace(/\s+/g, '')).toBe(long.replace(/\s+/g, ''));
  const cues = chunkCues([{ text: chunks[0]!, seconds: 10 }, { text: chunks[1]!, seconds: 20 }]);
  expect(cues[0]!.start).toBe(0);
  expect(cues.at(-1)!.end).toBeCloseTo(30, 5);
  const srt = buildSrt([{ start: 0, end: 1.5, text: 'က' }, { start: 61.25, end: 3725.001, text: 'ခ' }]);
  expect(srt).toBe('1\n00:00:00,000 --> 00:00:01,500\nက\n\n2\n00:01:01,250 --> 01:02:05,001\nခ\n');
});

const recapScript = 'မင်္ဂလာပါ။ ဒီနေ့ မင်္ဂလာအသံကို စမ်းသပ်နေပါတယ်။ မြန်မာစကားကို သဘာဝကျကျ ပြောနိုင်ပါသလား။';
async function uploadClip() {
  const { key } = await call(video.uploadClip, { contentType: 'video/mp4', size: clipMp4.byteLength }, { context });
  expect(key.startsWith('private/u1/uploads/')).toBe(true);
  bucket.set(key, { bytes: clipMp4, modified: Date.now() });
  return key;
}
const recapInput = (clipKey: string, extra: Record<string, unknown> = {}) => ({ text: recapScript, voiceId: 'lib-voice', clipKey, audio: 'duck', framing: 'fit', idempotency: crypto.randomUUID(), maxCredits: 60, ...extra });

test('recap: plan limits and guards reserve nothing', async () => {
  const key = await uploadClip();
  await expect(call(video.createRecap, recapInput(key), { context })).rejects.toThrow('active plan');
  await plan('u1', 'Creator', undefined, 10000);
  const status = await call(video.status, undefined, { context });
  expect(status).toMatchObject({ plan: 'Creator', watermark: true, priority: false, recap: { maxSeconds: 180, maxChars: 2880 } });
  await expect(call(video.createRecap, recapInput(key, { text: 'က'.repeat(2881) }), { context })).rejects.toThrow('2880 characters');
  await expect(call(video.createRecap, recapInput(key, { maxCredits: 361 }), { context })).rejects.toThrow('360 credits');
  await expect(call(video.createRecap, recapInput(key, { text: 'English only' }), { context })).rejects.toThrow('Burmese');
  await expect(call(video.createRecap, recapInput('private/u1/uploads/missing.mp4'), { context })).rejects.toThrow('did not finish');
  await expect(call(video.createRecap, recapInput(key, { voiceId: 'someone-elses-clone' }), { context })).rejects.toThrow('unavailable');
  process.env.VIDEO_GENERATION_APPROVED = 'false';
  await expect(call(video.createRecap, recapInput(key), { context })).rejects.toThrow('not switched on');
  expect(await db.select().from(videoJobs)).toEqual([]);
  expect((await db.select().from(accounts))[0]).toMatchObject({ available: 10000, reserved: 0 });
  // Business allows 20-minute recaps and gets priority.
  await plan('u1', 'Business', undefined, 10000);
  expect((await call(video.status, undefined, { context })).recap.maxSeconds).toBe(1200);
});

test('recap end to end: Creator clip + voiceover, real ffmpeg 9:16 render with watermark, SRT, settle by length', async () => {
  await plan('u1', 'Creator', undefined, 500);
  const key = await uploadClip();
  const job = await call(video.createRecap, recapInput(key), { context });
  expect(job).toMatchObject({ kind: 'recap', watermark: true, priority: 0, shape: '9:16', status: 'queued' });
  expect((await db.select().from(accounts))[0]).toMatchObject({ available: 440, reserved: 60 });
  const calls = { n: 0 };
  let renderedWith: any;
  const r = await processOneVideoJob({ request: tts(calls), recap: { render: async (input) => { renderedWith = input; const { renderRecap } = await import('../packages/web/src/api/services/recap-render'); return renderRecap(input); } } });
  expect(r.status).toBe('succeeded');
  expect(calls.n).toBe(1);
  expect(renderedWith).toMatchObject({ watermark: true, clipHasAudio: true, options: { audio: 'duck', framing: 'fit', maxSeconds: 180 } });
  const [done] = await db.select().from(videoJobs);
  expect(done).toMatchObject({ status: 'succeeded', actualCost: 16, srtKey: `private/u1/video/${job.id}.srt` });
  expect((await db.select().from(accounts))[0]).toMatchObject({ available: 484, reserved: 0 });
  // The output is a real 1080x1920 MP4 covering the full narration (the 4 s clip loops).
  const out = `${dir}/out.mp4`;
  await Bun.write(out, bucket.get(done!.storageKey!)!.bytes);
  const probe = JSON.parse(Bun.spawnSync(['ffprobe', '-v', 'error', '-show_entries', 'stream=codec_type,width,height:format=duration', '-of', 'json', out]).stdout.toString());
  expect(probe.streams.find((s: any) => s.codec_type === 'video')).toMatchObject({ width: 1080, height: 1920 });
  expect(probe.streams.some((s: any) => s.codec_type === 'audio')).toBe(true);
  expect(Number(probe.format.duration)).toBeGreaterThan(6.9);
  const srt = new TextDecoder().decode(bucket.get(done!.srtKey!)!.bytes);
  expect(srt.startsWith('1\n00:00:00,000 --> ')).toBe(true);
  expect(srt).toContain('မင်္ဂလာပါ');
  expect((await call(video.captions, { id: job.id }, { context })).url).toContain(done!.srtKey!);
  who = { id: 'u2', email: 'b@example.invalid', emailVerified: true };
  await expect(call(video.captions, { id: job.id }, { context })).rejects.toThrow();
}, 120000);

test('recap: unreadable clip refunds before any paid call; Studio uses own clone without watermark', async () => {
  await plan('u1', 'Studio', undefined, 500);
  const bad = await uploadClip();
  bucket.set(bad, { bytes: new TextEncoder().encode('not a video'), modified: Date.now() });
  await call(video.createRecap, recapInput(bad), { context });
  const calls = { n: 0 };
  expect((await processOneVideoJob({ request: tts(calls) })).status).toBe('failed');
  expect(calls.n).toBe(0);
  expect((await db.select().from(accounts))[0]).toMatchObject({ available: 500, reserved: 0 });

  await call(clones.create, { name: 'Me', sampleKey: await putSample('u1'), consent: true }, { context });
  const key = await uploadClip();
  const job = await call(video.createRecap, recapInput(key, { voiceId: 'clone-1', audio: 'replace', framing: 'fill' }), { context });
  expect(job).toMatchObject({ watermark: false, voiceId: 'clone-1' });
  let seen: any;
  expect((await processOneVideoJob({ request: tts(calls), recap: { render: async input => { seen = input; return `${dir}/clip.mp4`; } } })).status).toBe('succeeded');
  expect(seen).toMatchObject({ watermark: false, options: { audio: 'replace', framing: 'fill', maxSeconds: 600 } });
}, 60000);
