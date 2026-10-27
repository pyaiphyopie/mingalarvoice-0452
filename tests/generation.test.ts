import { test, expect, beforeAll, beforeEach, spyOn } from 'bun:test';
import { mkdtempSync } from 'node:fs';

process.env.DATABASE_URL = `file:${mkdtempSync('/home/user/generation-test-')}/test.db`;
delete process.env.DATABASE_AUTH_TOKEN;
process.env.GENERATION_TARIFF_APPROVED = 'true';
for (const key of ['ELEVENLABS_API_KEY', 'S3_ENDPOINT', 'S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY']) process.env[key] = 'isolated-fixture';
const { db } = await import('../packages/web/src/api/database');
const { jobs, accounts, ledger, subscriptions, workerHealth } = await import('../packages/web/src/api/database/schema');
const { auth } = await import('../packages/web/src/api/auth');
const { studio } = await import('../packages/web/src/api/routes/studio');
const { call } = await import('../packages/web/node_modules/@orpc/server/dist/index.mjs');
const { eq } = await import('../packages/web/node_modules/drizzle-orm');
const { processOneJob } = await import('../packages/web/src/api/services/worker');
const { heartbeat, generationReady } = await import('../packages/web/src/api/services/generation-status');
let identity = 'customer';
spyOn(auth.api, 'getSession').mockImplementation(async () => identity === 'guest' ? null : ({ user: { id: identity, email: `${identity}@example.invalid` } }) as never);
spyOn(globalThis, 'fetch').mockImplementation(async url => {
  if (String(url).endsWith('/voices')) return Response.json({ voices: [{ voice_id: 'test-voice', name: 'Test', category: 'premade', preview_url: '', labels: {} }] });
  if (String(url).endsWith('/models')) return Response.json([{ model_id: 'eleven_v4', can_do_text_to_speech: true, languages: [{ language_id: 'my', name: 'Burmese' }] }]);
  throw new Error('Unexpected external request blocked in test');
});
const context = { headers: new Headers() };
const input = () => ({ text: 'မင်္ဂလာပါ။', voiceId: 'test-voice', idempotency: crypto.randomUUID(), maxCredits: 120 });
const queue = () => call(studio.create, input(), { context });

beforeAll(async () => {
  for (const statement of [
    'CREATE TABLE credit_accounts (user_id TEXT PRIMARY KEY, available INTEGER NOT NULL, reserved INTEGER NOT NULL CHECK(reserved >= 0))',
    "CREATE TABLE generation_jobs (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, script TEXT NOT NULL, voice_id TEXT NOT NULL, model TEXT NOT NULL DEFAULT 'eleven_v4', status TEXT NOT NULL DEFAULT 'queued', cost INTEGER NOT NULL, idempotency TEXT NOT NULL, created_at INTEGER NOT NULL, lease_until INTEGER, storage_key TEXT, error TEXT, provider_request_id TEXT, duration_ms INTEGER, actual_cost INTEGER, credit_pool TEXT NOT NULL DEFAULT 'web')",
    'CREATE UNIQUE INDEX job_idempotency ON generation_jobs(user_id, idempotency)',
    'CREATE TABLE credit_ledger (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, operation_key TEXT UNIQUE NOT NULL, type TEXT NOT NULL, available_delta INTEGER NOT NULL, reserved_delta INTEGER NOT NULL, job_id TEXT, created_at INTEGER NOT NULL, credit_pool TEXT NOT NULL DEFAULT \'web\')',
    'CREATE TABLE apple_credit_accounts (user_id TEXT PRIMARY KEY, available INTEGER NOT NULL DEFAULT 0, reserved INTEGER NOT NULL DEFAULT 0, CHECK(available >= 0 AND reserved >= 0))',
    'CREATE TABLE subscriptions (user_id TEXT PRIMARY KEY, status TEXT NOT NULL, provider_id TEXT, period_end INTEGER, cancel_at_end INTEGER, plan TEXT)',
    'CREATE TABLE generation_worker_health (id TEXT PRIMARY KEY, heartbeat_at INTEGER NOT NULL)',
  ]) await db.run(statement);
});
beforeEach(async () => {
  for (const table of ['apple_credit_accounts', 'credit_accounts', 'generation_jobs', 'credit_ledger', 'subscriptions', 'generation_worker_health']) await db.run(`DELETE FROM ${table}`);
  identity = 'customer'; process.env.GENERATION_TARIFF_APPROVED = 'true';
  await db.insert(accounts).values({ userId: 'customer', available: 500, reserved: 0 });
  await db.insert(subscriptions).values({ userId: 'customer', status: 'active', periodEnd: Date.now() + 86400000 });
  await heartbeat();
});

test('switch, heartbeat, guest, access and balance guards reserve no credits', async () => {
  process.env.GENERATION_TARIFF_APPROVED = 'false'; await expect(queue()).rejects.toThrow();
  process.env.GENERATION_TARIFF_APPROVED = 'true';
  await db.update(workerHealth).set({ heartbeatAt: Date.now() - 60001 });
  expect(await generationReady()).toBe(false); await expect(queue()).rejects.toThrow(); await heartbeat();
  identity = 'guest'; await expect(queue()).rejects.toThrow(); identity = 'customer';
  await db.update(subscriptions).set({ periodEnd: Date.now() - 1 }); await expect(queue()).rejects.toThrow();
  await db.update(subscriptions).set({ periodEnd: Date.now() + 86400000 });
  await db.update(accounts).set({ available: 10 }); await expect(queue()).rejects.toThrow();
  expect(await db.select().from(jobs)).toEqual([]); expect(await db.select().from(ledger)).toEqual([]);
});

test('idempotent reservation and history/download ownership', async () => {
  const request = input(); const job = await call(studio.create, request, { context });
  expect((await call(studio.create, request, { context })).id).toBe(job.id);
  await expect(call(studio.create, { ...request, text: 'မြန်မာစာပါ။' }, { context })).rejects.toThrow();
  expect((await db.select().from(accounts))[0]).toMatchObject({ available: 380, reserved: 120 });
  expect((await db.select().from(ledger)).length).toBe(1);
  identity = 'other'; expect(await call(studio.history, undefined, { context })).toEqual([]);
  await expect(call(studio.download, { id: job.id }, { context })).rejects.toThrow();
});

test('worker reused sample success measures 8 credits, private upload, single dispatch and refund', async () => {
  const job = await queue(); let requests = 0; let stored = '';
  // Previously approved sample reused from disk; NO generation/provider spending.
  const audio = new Uint8Array(await Bun.file('/home/user/burmese-engines.report/eleven-test/burmese-eleven-v4.mp3').arrayBuffer());
  const deps = { request: (async (_url, options) => {
    const body = JSON.parse(String(options?.body));
    expect(body.language_code).toBe('my');
    expect(body.model_id).toBe('eleven_v4');
    expect(body.inputs[0].voice_id).toBe(job.voiceId);
    requests++; return new Response(audio, { headers: { 'content-type': 'audio/mpeg', 'request-id': 'test-only' } });
  }) as typeof fetch, store: async (key: string) => { stored = key; } };
  expect((await processOneJob(deps)).status).toBe('succeeded');
  expect((await processOneJob(deps)).processed).toBe(false); expect(requests).toBe(1);
  expect(stored).toBe(`private/customer/audio/${job.id}.mp3`);
  const [current] = await db.select().from(jobs); expect(current.actualCost).toBe(8); expect(current.durationMs).toBe(7079);
  expect((await db.select().from(accounts))[0]).toMatchObject({ available: 492, reserved: 0 });
});

test('explicit rejection refunds once; ambiguous dispatch and expired lease never retry', async () => {
  await queue();
  const deps = { request: (async () => new Response('', { status: 400 })) as typeof fetch, store: async () => {} };
  expect((await processOneJob(deps)).status).toBe('failed');
  expect((await db.select().from(accounts))[0]).toMatchObject({ available: 500, reserved: 0 });
  const second = await queue(); let requests = 0;
  deps.request = (async () => { requests++; throw new Error('Ambiguous network failure'); }) as typeof fetch;
  expect((await processOneJob(deps)).status).toBe('uncertain'); await processOneJob(deps); expect(requests).toBe(1);
  expect((await db.select().from(accounts))[0].reserved).toBe(120);
  await db.update(jobs).set({ status: 'running', leaseUntil: Date.now() - 1 }).where(eq(jobs.id, second.id));
  await processOneJob(deps); expect(requests).toBe(1);
  expect((await db.select().from(jobs).where(eq(jobs.id, second.id)))[0].status).toBe('uncertain');
});

test('separate competing workers can dispatch a queued job only once', async () => {
  const job = await queue();
  const children = [0, 1].map(() => Bun.spawn(['bun', 'tests/worker-race.ts'], { env: process.env, stdout: 'pipe', stderr: 'pipe' }));
  const outputs = await Promise.all(children.map(async child => { const output = await new Response(child.stdout).text(); await child.exited; return JSON.parse(output); }));
  expect(outputs.filter(o => o.dispatched).length).toBe(1);
  expect((await db.select().from(jobs).where(eq(jobs.id, job.id)))[0].status).toBe('uncertain');
  expect((await db.select().from(accounts))[0].reserved).toBe(120);
});