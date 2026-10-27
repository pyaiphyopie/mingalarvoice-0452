import { test, expect, beforeAll, beforeEach, spyOn, mock } from 'bun:test';
import { mkdtempSync } from 'node:fs';

// Isolated SQLite + stubbed storage + stubbed provider. No paid calls, no real bucket.
process.env.DATABASE_URL = `file:${mkdtempSync('/home/user/video-test-')}/test.db`;
delete process.env.DATABASE_AUTH_TOKEN;
process.env.GENERATION_TARIFF_APPROVED = 'true';
process.env.VIDEO_GENERATION_APPROVED = 'true';
for (const key of ['ELEVENLABS_API_KEY', 'S3_ENDPOINT', 'S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY']) process.env[key] = 'isolated-fixture';

const bucket = new Map<string, { bytes: Uint8Array; modified: number }>();
mock.module('../packages/web/src/api/services/storage', () => ({
  putObject: async (key: string, bytes: Uint8Array) => { bucket.set(key, { bytes, modified: Date.now() }); },
  getObject: async (key: string) => { const o = bucket.get(key); if (!o) throw new Error('missing'); return { bytes: o.bytes, contentType: '' }; },
  headObject: async (key: string) => { const o = bucket.get(key); return o ? { size: o.bytes.byteLength, contentType: '' } : null; },
  signedGet: async (key: string) => `https://signed.invalid/${key}`,
  signedPut: async (key: string) => `https://signed.invalid/put/${key}`,
  deleteObjects: async (keys: string[]) => { for (const k of keys) bucket.delete(k); },
  listOlderThan: async (prefix: string, cutoff: number) => [...bucket].filter(([k, o]) => k.startsWith(prefix) && o.modified < cutoff).map(([k]) => k),
  downloadToFile: async (key: string, path: string) => { const o = bucket.get(key); if (!o) throw new Error('missing'); await Bun.write(path, o.bytes); },
  putFile: async (key: string, path: string) => { bucket.set(key, { bytes: new Uint8Array(await Bun.file(path).arrayBuffer()), modified: Date.now() }); },
}));

const { db } = await import('../packages/web/src/api/database');
const { accounts, ledger, subscriptions, videoJobs, jobs } = await import('../packages/web/src/api/database/schema');
const { auth } = await import('../packages/web/src/api/auth');
const { video } = await import('../packages/web/src/api/routes/video');
const { call } = await import('../packages/web/node_modules/@orpc/server/dist/index.mjs');
const { eq } = await import('../packages/web/node_modules/drizzle-orm');
const { processOneVideoJob } = await import('../packages/web/src/api/services/video-worker');
const { heartbeat } = await import('../packages/web/src/api/services/generation-status');
const { purgeExpiredMedia, RETENTION_MS } = await import('../packages/web/src/api/services/retention');

let identity = 'customer';
spyOn(auth.api, 'getSession').mockImplementation(async () => identity === 'guest' ? null : ({ user: { id: identity, email: `${identity}@example.invalid` } }) as never);
spyOn(globalThis, 'fetch').mockImplementation(async url => {
  if (String(url).endsWith('/voices')) return Response.json({ voices: [{ voice_id: 'test-voice', name: 'Test', category: 'premade', preview_url: '', labels: {} }] });
  if (String(url).endsWith('/models')) return Response.json([{ model_id: 'eleven_v4', can_do_text_to_speech: true, languages: [{ language_id: 'my', name: 'Burmese' }] }]);
  throw new Error('Unexpected external request blocked in test');
});
const context = { headers: new Headers() };
const script = 'မင်္ဂလာပါ။ ဒီနေ့ မင်္ဂလာအသံကို စမ်းသပ်နေပါတယ်။ မြန်မာစကားကို သဘာဝကျကျ ပြောနိုင်ပါသလား။';
// Previously approved 7.08 s sample reused from disk — no provider spend.
const sample = new Uint8Array(await Bun.file('/home/user/burmese-engines.report/eleven-test/burmese-eleven-v4.mp3').arrayBuffer());
const photo = new Uint8Array(await Bun.file('/home/user/mingalar-voice/packages/web/public/images/studio.jpg').arrayBuffer());
const tts = (counter: { n: number }) => (async () => { counter.n++; return new Response(sample, { headers: { 'content-type': 'audio/mpeg', 'request-id': 'test-only' } }); }) as unknown as typeof fetch;

async function upload(user = 'customer') {
  const { key } = await call(video.uploadImage, { contentType: 'image/jpeg', size: photo.byteLength }, { context });
  expect(key.startsWith(`private/${user}/uploads/`)).toBe(true);
  bucket.set(key, { bytes: photo, modified: Date.now() });
  return key;
}
const request = (imageKey: string, extra: Record<string, unknown> = {}) => ({ text: script, voiceId: 'test-voice', shape: '9:16' as const, imageKey, idempotency: crypto.randomUUID(), maxCredits: 60, ...extra });

beforeAll(async () => {
  for (const statement of [
    'CREATE TABLE credit_accounts (user_id TEXT PRIMARY KEY, available INTEGER NOT NULL, reserved INTEGER NOT NULL CHECK(reserved >= 0))',
    "CREATE TABLE generation_jobs (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, script TEXT NOT NULL, voice_id TEXT NOT NULL, model TEXT NOT NULL DEFAULT 'eleven_v4', status TEXT NOT NULL DEFAULT 'queued', cost INTEGER NOT NULL, idempotency TEXT NOT NULL, created_at INTEGER NOT NULL, lease_until INTEGER, storage_key TEXT, error TEXT, provider_request_id TEXT, duration_ms INTEGER, actual_cost INTEGER, credit_pool TEXT NOT NULL DEFAULT 'web')",
    'CREATE TABLE credit_ledger (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, operation_key TEXT UNIQUE NOT NULL, type TEXT NOT NULL, available_delta INTEGER NOT NULL, reserved_delta INTEGER NOT NULL, job_id TEXT, created_at INTEGER NOT NULL, credit_pool TEXT NOT NULL DEFAULT \'web\')',
    'CREATE TABLE apple_credit_accounts (user_id TEXT PRIMARY KEY, available INTEGER NOT NULL DEFAULT 0, reserved INTEGER NOT NULL DEFAULT 0, CHECK(available >= 0 AND reserved >= 0))',
    'CREATE TABLE subscriptions (user_id TEXT PRIMARY KEY, status TEXT NOT NULL, provider_id TEXT, period_end INTEGER, cancel_at_end INTEGER, plan TEXT)',
    'CREATE TABLE generation_worker_health (id TEXT PRIMARY KEY, heartbeat_at INTEGER NOT NULL)',
  ]) await db.run(statement);
  // Same DDL the production migration runs.
  const migration = await Bun.file('/home/user/mingalar-voice/migrations/video-jobs.ts').text();
  for (const sql of migration.match(/`CREATE TABLE[\s\S]*?\)`|'CREATE UNIQUE INDEX[^']*'/g)!) await db.run(sql.slice(1, -1));
  const tiers = await Bun.file('/home/user/mingalar-voice/migrations/tiers-clones-recap.ts').text();
  for (const sql of tiers.match(/'ALTER TABLE video_jobs[^']*'/g)!) await db.run(sql.slice(1, -1));
  for (const sql of tiers.match(/`CREATE TABLE IF NOT EXISTS voice_clones[^`]+`|'CREATE UNIQUE INDEX IF NOT EXISTS voice_clone_provider[^']*'/g)!) await db.run(sql.slice(1, -1));
});
beforeEach(async () => {
  for (const table of ['apple_credit_accounts', 'credit_accounts', 'generation_jobs', 'video_jobs', 'credit_ledger', 'subscriptions', 'generation_worker_health']) await db.run(`DELETE FROM ${table}`);
  bucket.clear(); identity = 'customer'; process.env.VIDEO_GENERATION_APPROVED = 'true';
  await db.insert(accounts).values({ userId: 'customer', available: 500, reserved: 0 });
  await db.insert(subscriptions).values({ userId: 'customer', status: 'active', periodEnd: Date.now() + 86400000 });
  await heartbeat();
});

test('switch, guest, foreign image, missing upload, minimum and balance guards reserve nothing', async () => {
  const key = await upload();
  process.env.VIDEO_GENERATION_APPROVED = 'false';
  expect((await call(video.status, undefined, { context })).ready).toBe(false);
  await expect(call(video.create, request(key), { context })).rejects.toThrow('not switched on');
  process.env.VIDEO_GENERATION_APPROVED = 'true';
  await expect(call(video.create, request('private/someone-else/uploads/x.jpg'), { context })).rejects.toThrow('Upload a background image');
  await expect(call(video.create, request('private/customer/uploads/never-uploaded.jpg'), { context })).rejects.toThrow('did not finish');
  await expect(call(video.create, request(key, { maxCredits: 20 }), { context })).rejects.toThrow('Reserve at least');
  await expect(call(video.create, request(key, { maxCredits: 361 }), { context })).rejects.toThrow();
  await db.update(accounts).set({ available: 30 });
  await expect(call(video.create, request(key), { context })).rejects.toThrow('Not enough credits');
  identity = 'guest'; await expect(call(video.uploadImage, { contentType: 'image/jpeg', size: 10 }, { context })).rejects.toThrow();
  expect(await db.select().from(videoJobs)).toEqual([]); expect(await db.select().from(ledger)).toEqual([]);
});

test('end to end: reserve, single narration, real ffmpeg render, 2 credits/second settlement, ownership', async () => {
  const key = await upload(); const input = request(key);
  const job = await call(video.create, input, { context });
  expect((await call(video.create, input, { context })).id).toBe(job.id);
  await expect(call(video.create, { ...input, shape: '16:9' }, { context })).rejects.toThrow('different video');
  expect((await db.select().from(accounts))[0]).toMatchObject({ available: 440, reserved: 60 });
  const calls = { n: 0 };
  expect((await processOneVideoJob({ request: tts(calls) })).status).toBe('succeeded');
  expect((await processOneVideoJob({ request: tts(calls) })).processed).toBe(false);
  expect(calls.n).toBe(1);
  const [done] = await db.select().from(videoJobs);
  // 7.08 s -> ceil 8 s x 2 credits = 16.
  expect(done).toMatchObject({ status: 'succeeded', actualCost: 16, storageKey: `private/customer/video/${job.id}.mp4`, audioKey: `private/customer/video/${job.id}.mp3` });
  expect((await db.select().from(accounts))[0]).toMatchObject({ available: 484, reserved: 0 });
  const mp4 = bucket.get(done!.storageKey!)!.bytes;
  expect(new TextDecoder().decode(mp4.slice(4, 8))).toBe('ftyp');
  const ledgerSum = (await db.select().from(ledger)).reduce((s, e) => s + e.availableDelta, 0);
  expect(ledgerSum).toBe(-16);
  expect((await call(video.download, { id: job.id }, { context })).url).toContain(done!.storageKey!);
  identity = 'other';
  expect(await call(video.list, undefined, { context })).toEqual([]);
  await expect(call(video.download, { id: job.id }, { context })).rejects.toThrow();
}, 60000);

test('unreadable image fails before any paid call and refunds in full', async () => {
  const key = await upload(); bucket.set(key, { bytes: new TextEncoder().encode('not an image at all'), modified: Date.now() });
  await call(video.create, request(key), { context });
  const calls = { n: 0 };
  expect((await processOneVideoJob({ request: tts(calls) })).status).toBe('failed');
  expect(calls.n).toBe(0);
  expect((await db.select().from(accounts))[0]).toMatchObject({ available: 500, reserved: 0 });
});

test('provider 5xx is uncertain (credits held, never retried); 4xx refunds; render failure refunds and keeps narration', async () => {
  const key = await upload();
  await call(video.create, request(key), { context });
  let n = 0;
  const fail = (status: number) => (async () => { n++; return new Response('x', { status }); }) as unknown as typeof fetch;
  expect((await processOneVideoJob({ request: fail(503) })).status).toBe('uncertain');
  expect((await processOneVideoJob({ request: fail(503) })).processed).toBe(false);
  expect(n).toBe(1);
  expect((await db.select().from(accounts))[0]).toMatchObject({ available: 440, reserved: 60 });

  await call(video.create, request(key), { context });
  expect((await processOneVideoJob({ request: fail(422) })).status).toBe('failed');
  expect((await db.select().from(accounts))[0]).toMatchObject({ available: 440, reserved: 60 });

  const job = await call(video.create, request(key), { context });
  const render = async () => { throw new Error('boom'); };
  expect((await processOneVideoJob({ request: tts({ n: 0 }), render })).status).toBe('failed');
  const [row] = await db.select().from(videoJobs).where(eq(videoJobs.id, job.id));
  expect(row).toMatchObject({ status: 'failed', actualCost: 0, audioKey: `private/customer/video/${job.id}.mp3` });
  expect(bucket.has(row!.audioKey!)).toBe(true);
  expect((await db.select().from(accounts))[0]).toMatchObject({ available: 440, reserved: 60 });
});

test('30-day retention deletes expired audio, video, narration, uploads and orphans; keeps recent and in-flight media', async () => {
  const old = Date.now() - RETENTION_MS - 1000, now = Date.now();
  const put = (k: string, modified: number) => bucket.set(k, { bytes: new Uint8Array([1]), modified });
  put('private/customer/audio/old.mp3', old); put('private/customer/audio/new.mp3', now);
  put('private/customer/video/old.mp4', old); put('private/customer/video/old.mp3', old); put('private/customer/uploads/old.jpg', old);
  put('private/customer/uploads/orphan.jpg', old); put('private/customer/uploads/fresh.jpg', now);
  put('private/customer/video/held.mp3', old); put('private/customer/uploads/held.jpg', old);
  const base = { userId: 'customer', voiceId: 'v', cost: 10, idempotency: crypto.randomUUID() };
  await db.insert(jobs).values([
    { ...base, id: 'a-old', text: 's', status: 'succeeded', createdAt: old, storageKey: 'private/customer/audio/old.mp3' },
    { ...base, id: 'a-new', text: 's', status: 'succeeded', createdAt: now, storageKey: 'private/customer/audio/new.mp3', idempotency: crypto.randomUUID() },
  ]);
  await db.insert(videoJobs).values([
    { ...base, id: 'v-old', text: 's', shape: '9:16', status: 'succeeded', createdAt: old, storageKey: 'private/customer/video/old.mp4', audioKey: 'private/customer/video/old.mp3', imageKey: 'private/customer/uploads/old.jpg' },
    { ...base, id: 'v-held', text: 's', shape: '9:16', status: 'uncertain', createdAt: old, audioKey: 'private/customer/video/held.mp3', imageKey: 'private/customer/uploads/held.jpg', idempotency: crypto.randomUUID() },
  ]);
  const result = await purgeExpiredMedia(now);
  expect(result).toMatchObject({ audioJobs: 1, videoJobs: 1 });
  expect([...bucket.keys()].sort()).toEqual(['private/customer/audio/new.mp3', 'private/customer/uploads/fresh.jpg', 'private/customer/uploads/held.jpg', 'private/customer/video/held.mp3']);
  expect((await db.select().from(jobs).where(eq(jobs.id, 'a-old')))[0]!.storageKey).toBeNull();
  expect((await db.select().from(videoJobs).where(eq(videoJobs.id, 'v-old')))[0]).toMatchObject({ storageKey: null, audioKey: null, imageKey: null, purgedAt: now });
  expect((await purgeExpiredMedia(now)).deletedObjects).toBe(0);
});
