import { test, expect, beforeAll, beforeEach, spyOn } from 'bun:test';
import { mkdtempSync } from 'node:fs';

// Isolated file database and a fake verifier: no Apple, provider, storage or customer data is touched.
process.env.DATABASE_URL = `file:${mkdtempSync('/home/user/apple-test-')}/test.db`;
delete process.env.DATABASE_AUTH_TOKEN;
process.env.GENERATION_TARIFF_APPROVED = 'true';
for (const key of ['ELEVENLABS_API_KEY', 'S3_ENDPOINT', 'S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY']) process.env[key] = 'isolated-fixture';
const { db } = await import('../packages/web/src/api/database');
const schema = await import('../packages/web/src/api/database/schema');
const { appleCredits, accounts, subscriptions, jobs, ledger, appleTransactions, favorites, user, videoJobs } = schema;
const { auth } = await import('../packages/web/src/api/auth');
const { studio } = await import('../packages/web/src/api/routes/studio');
const { apple } = await import('../packages/web/src/api/routes/apple');
const apl = await import('../packages/web/src/api/services/apple');
const { deleteAccount } = await import('../packages/web/src/api/services/account');
const { finish } = await import('../packages/web/src/api/services/worker');
const { audioCharge } = await import('../packages/web/src/api/services/tariff');
const { heartbeat } = await import('../packages/web/src/api/services/generation-status');
const { call } = await import('../packages/web/node_modules/@orpc/server/dist/index.mjs');
const { eq } = await import('../packages/web/node_modules/drizzle-orm');

let identity = 'buyer';
spyOn(auth.api, 'getSession').mockImplementation(async () => ({ user: { id: identity, email: `${identity}@example.invalid`, name: identity }, session: { createdAt: new Date() } }) as never);
spyOn(globalThis, 'fetch').mockImplementation(async url => {
  if (String(url).endsWith('/voices')) return Response.json({ voices: [{ voice_id: 'test-voice', name: 'Test', category: 'premade', preview_url: '', labels: {} }] });
  if (String(url).endsWith('/models')) return Response.json([{ model_id: 'eleven_v4', can_do_text_to_speech: true, languages: [{ language_id: 'my', name: 'Burmese' }] }]);
  throw new Error('Unexpected external request blocked in test');
});
const context = { headers: new Headers() };
const CREATOR = `${apl.APPLE_BUNDLE_ID}.credits6300`;
const verifier = {
  verifyAndDecodeTransaction: async (jws: string) => { if (jws.startsWith('bad')) throw new Error('signature'); return JSON.parse(jws); },
  verifyAndDecodeNotification: async (jws: string) => { if (jws.startsWith('bad')) throw new Error('signature'); return JSON.parse(jws); },
} as never;
const signed = (overrides: Record<string, unknown> = {}, token?: string) => JSON.stringify({
  transactionId: 'tx-1', originalTransactionId: 'tx-1', bundleId: apl.APPLE_BUNDLE_ID, productId: CREATOR, type: 'Consumable',
  environment: 'Sandbox', quantity: 1, appAccountToken: token, purchaseDate: Date.now(), ...overrides,
});
const balance = async (id = 'buyer') => (await db.select().from(appleCredits).where(eq(appleCredits.userId, id)))[0];

beforeAll(async () => {
  for (const statement of [
    'CREATE TABLE user (id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT UNIQUE NOT NULL, email_verified INTEGER NOT NULL DEFAULT 0, image TEXT, created_at INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL DEFAULT 0)',
    'CREATE TABLE credit_accounts (user_id TEXT PRIMARY KEY, available INTEGER NOT NULL DEFAULT 0, reserved INTEGER NOT NULL DEFAULT 0, CHECK(available >= 0 AND reserved >= 0))',
    'CREATE TABLE subscriptions (user_id TEXT PRIMARY KEY, status TEXT NOT NULL, provider_id TEXT, period_end INTEGER, cancel_at_end INTEGER, plan TEXT)',
    "CREATE TABLE generation_jobs (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, script TEXT NOT NULL, voice_id TEXT NOT NULL, model TEXT NOT NULL DEFAULT 'eleven_v4', status TEXT NOT NULL DEFAULT 'queued', cost INTEGER NOT NULL, idempotency TEXT NOT NULL, created_at INTEGER NOT NULL, lease_until INTEGER, storage_key TEXT, error TEXT, provider_request_id TEXT, duration_ms INTEGER, actual_cost INTEGER, credit_pool TEXT NOT NULL DEFAULT 'web')",
    'CREATE UNIQUE INDEX job_idempotency ON generation_jobs(user_id, idempotency)',
    "CREATE TABLE credit_ledger (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, operation_key TEXT UNIQUE NOT NULL, type TEXT NOT NULL, available_delta INTEGER NOT NULL, reserved_delta INTEGER NOT NULL, job_id TEXT, created_at INTEGER NOT NULL, credit_pool TEXT NOT NULL DEFAULT 'web')",
    'CREATE TABLE voice_favorites (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, voice_id TEXT NOT NULL)',
    'CREATE TABLE generation_worker_health (id TEXT PRIMARY KEY, heartbeat_at INTEGER NOT NULL)',
  ]) await db.run(statement);
  // Same additive statements as production (scripts/migrate-apple-iap.ts).
  const migration = await Bun.file(new URL('../scripts/migrate-apple-iap.ts', import.meta.url)).text();
  for (const sql of migration.match(/`CREATE TABLE IF NOT EXISTS [^`]+`/g)!) await db.run(sql.slice(1, -1));
  const videoMigration = await Bun.file(new URL('../migrations/video-jobs.ts', import.meta.url)).text();
  for (const sql of videoMigration.match(/`CREATE TABLE[\s\S]*?\)`|'CREATE UNIQUE INDEX[^']*'/g)!) await db.run(sql.slice(1, -1));  const tiers = await Bun.file(new URL('../migrations/tiers-clones-recap.ts', import.meta.url)).text();
  for (const sql of tiers.match(/'ALTER TABLE video_jobs[^']*'/g)!) await db.run(sql.slice(1, -1));
  for (const sql of tiers.match(/`CREATE TABLE IF NOT EXISTS voice_clones[^`]+`|'CREATE UNIQUE INDEX IF NOT EXISTS voice_clone_provider[^']*'/g)!) await db.run(sql.slice(1, -1));
});
beforeEach(async () => {
  for (const table of ['user', 'credit_accounts', 'subscriptions', 'generation_jobs', 'video_jobs', 'credit_ledger', 'voice_favorites', 'generation_worker_health', 'apple_credit_accounts', 'apple_account_tokens', 'apple_transactions', 'apple_notifications', 'voice_clones']) await db.run(`DELETE FROM ${table}`);
  identity = 'buyer';
  process.env.APPLE_IAP_ENABLED = 'true'; process.env.APPLE_ENVIRONMENT = 'Sandbox'; delete process.env.APPLE_APP_APPLE_ID;
  await heartbeat();
});

test('fails closed until Apple is fully configured', async () => {
  delete process.env.APPLE_IAP_ENABLED;
  expect(apl.appleConfig().enabled).toBe(false);
  const config = await call(apple.config, undefined, { context });
  expect(config.enabled).toBe(false); expect(config.appAccountToken).toBeNull();
  await expect(apl.redeemAppleTransaction('buyer', signed(), verifier)).rejects.toThrow();
  process.env.APPLE_IAP_ENABLED = 'true'; process.env.APPLE_ENVIRONMENT = 'Production';
  expect(apl.appleConfig().missing).toEqual(['APPLE_APP_APPLE_ID']);
  expect(await balance()).toBeUndefined();
});

test('grants allowlisted consumable exactly once, bound to the purchasing account', async () => {
  const token = await apl.appleAccountToken('buyer');
  expect(await apl.appleAccountToken('buyer')).toBe(token);
  // Concurrent redemptions from separate processes/connections: the transaction-ID key arbitrates.
  const requests = [0, 1, 2].map(() => Bun.spawn(['bun', 'tests/apple-race.ts', signed({}, token)], { env: process.env, stdout: 'pipe', stderr: 'pipe' }));
  const outcomes = await Promise.all(requests.map(async r => JSON.parse((await new Response(r.stdout).text()).trim())));
  expect(outcomes.filter(o => o.success && !o.duplicate)).toHaveLength(1);
  expect((await balance())!.available).toBe(6300);
  expect(await db.select().from(ledger)).toHaveLength(1);
  const again = await apl.redeemAppleTransaction('buyer', signed({}, token.toUpperCase()), verifier);
  expect(again.duplicate).toBe(true);
  await expect(apl.redeemAppleTransaction('intruder', signed({}, token), verifier)).rejects.toThrow('different Mingalar Voice account');
  expect(await balance('intruder')).toBeUndefined();
  expect((await balance())!.available).toBe(6300);
});

test('rejects forged, foreign, refunded and non-allowlisted transactions without granting', async () => {
  const token = await apl.appleAccountToken('buyer');
  for (const jws of [
    'bad-signature-payload-xxxxxxxx',
    signed({ bundleId: 'com.other.app' }, token),
    signed({ environment: 'Production' }, token),
    signed({ productId: 'com.mingalarvoice.k7q2.credits999999' }, token),
    signed({ type: 'Non-Consumable' }, token),
    signed({ quantity: 3 }, token),
    signed({ revocationDate: Date.now() }, token),
    signed({}, crypto.randomUUID()),
    signed({}),
  ]) await expect(apl.redeemAppleTransaction('buyer', jws, verifier)).rejects.toThrow();
  expect(await balance()).toBeUndefined();
  expect(await db.select().from(appleTransactions)).toEqual([]);
});

test('Apple credits fund generation without plan access and settle back to the Apple pool', async () => {
  const token = await apl.appleAccountToken('buyer');
  await apl.redeemAppleTransaction('buyer', signed({}, token), verifier);
  // Expired web plan credits must stay locked even though Apple credits exist.
  await db.insert(accounts).values({ userId: 'buyer', available: 900, reserved: 0 });
  await db.insert(subscriptions).values({ userId: 'buyer', status: 'active', periodEnd: Date.now() - 1 });
  const job = await call(studio.create, { text: 'မင်္ဂလာပါ။', voiceId: 'test-voice', idempotency: crypto.randomUUID(), maxCredits: 120 }, { context });
  expect(job.pool).toBe('apple');
  expect(await balance()).toEqual({ userId: 'buyer', available: 6180, reserved: 120 });
  expect((await db.select().from(accounts))[0]).toEqual({ userId: 'buyer', available: 900, reserved: 0 });
  await db.update(jobs).set({ status: 'running' }).where(eq(jobs.id, job.id));
  expect(await finish({ ...job, status: 'running' }, 'succeeded', 'private/buyer/audio/x.mp3', undefined, audioCharge(7.2, 120))).toBe(true);
  expect(await balance()).toEqual({ userId: 'buyer', available: 6292, reserved: 0 });
  const wallet = await call(studio.wallet, undefined, { context });
  expect(wallet.apple).toEqual({ available: 6292, reserved: 0 });
  // Active plan credits are spent first.
  await db.update(subscriptions).set({ periodEnd: Date.now() + 86400000 });
  const planJob = await call(studio.create, { text: 'မင်္ဂလာပါ။', voiceId: 'test-voice', idempotency: crypto.randomUUID(), maxCredits: 120 }, { context });
  expect(planJob.pool).toBe('web');
  // No access at all is still rejected and reserves nothing.
  identity = 'nobody';
  await expect(call(studio.create, { text: 'မင်္ဂလာပါ။', voiceId: 'test-voice', idempotency: crypto.randomUUID(), maxCredits: 120 }, { context })).rejects.toThrow('active subscription');
});

test('refund notifications revoke unspent credits once, record shortfall and honour reversals', async () => {
  const token = await apl.appleAccountToken('buyer');
  await apl.redeemAppleTransaction('buyer', signed({}, token), verifier);
  await db.update(appleCredits).set({ available: 5000 });
  const note = (type: string, uuid: string) => JSON.stringify({ notificationType: type, notificationUUID: uuid, data: { environment: 'Sandbox', bundleId: apl.APPLE_BUNDLE_ID, signedTransactionInfo: signed({}, token) } });
  expect((await apl.handleAppleNotification(note('REFUND', 'n1'), verifier)).result).toBe('revoked');
  expect((await apl.handleAppleNotification(note('REFUND', 'n1'), verifier)).result).toBe('duplicate');
  expect((await apl.handleAppleNotification(note('REVOKE', 'n2'), verifier)).result).toBe('recorded');
  expect((await balance())!.available).toBe(0);
  const [record] = await db.select().from(appleTransactions);
  expect(record).toMatchObject({ status: 'revoked', revokedCredits: 5000, shortfall: 1300 });
  expect((await apl.handleAppleNotification('bad-signature-payload-xxxx', verifier)).status).toBe(400);
  expect((await apl.handleAppleNotification(note('REFUND_REVERSED', 'n3'), verifier)).result).toBe('reinstated');
  expect((await balance())!.available).toBe(5000);
  expect((await apl.appleWebhook({})).status).toBe(400);
  delete process.env.APPLE_IAP_ENABLED;
  expect((await apl.appleWebhook({ signedPayload: 'x' })).status).toBe(503);
});

test('account deletion requires recent sign-in, waits for settlement and removes owned data', async () => {
  await db.insert(user).values({ id: 'buyer', name: 'Buyer', email: 'buyer@example.invalid', emailVerified: false, createdAt: new Date(), updatedAt: new Date() });
  await db.insert(favorites).values({ id: 'f', userId: 'buyer', voiceId: 'test-voice' });
  await db.insert(appleCredits).values({ userId: 'buyer', available: 50, reserved: 0 });
  await db.insert(jobs).values({ id: 'j1', userId: 'buyer', text: 'x', voiceId: 'v', cost: 10, idempotency: 'i1', createdAt: Date.now(), status: 'succeeded', storageKey: 'private/buyer/audio/j1.mp3' });
  await db.insert(videoJobs).values({ id: 'v1', userId: 'buyer', text: 'x', voiceId: 'v', shape: '9:16', cost: 20, idempotency: 'vi1', createdAt: Date.now(), status: 'succeeded', storageKey: 'private/buyer/video/v1.mp4', audioKey: 'private/buyer/video/v1.mp3', imageKey: 'private/buyer/uploads/bg.jpg' });
  const deleted: string[][] = [];
  const deps = { deleteAudio: async (keys: string[]) => { deleted.push(keys); } };
  await expect(deleteAccount('buyer', Date.now() - 16 * 60000, deps)).rejects.toThrow('sign in again');
  await db.insert(jobs).values({ id: 'j2', userId: 'buyer', text: 'x', voiceId: 'v', cost: 10, idempotency: 'i2', createdAt: Date.now(), status: 'uncertain' });
  await expect(deleteAccount('buyer', Date.now(), deps)).rejects.toThrow('still processing');
  await db.delete(jobs).where(eq(jobs.id, 'j2'));
  await expect(deleteAccount('buyer', Date.now(), { deleteAudio: async () => { throw new Error('s3'); } })).rejects.toThrow('were not deleted');
  expect(await db.select().from(user)).toHaveLength(1);
  // A narration started elsewhere while audio is being removed aborts deletion instead of losing it.
  const racing = { deleteAudio: async () => { await db.insert(jobs).values({ id: 'j3', userId: 'buyer', text: 'x', voiceId: 'v', cost: 10, idempotency: 'i3', createdAt: Date.now(), status: 'queued' }); } };
  await expect(deleteAccount('buyer', Date.now(), racing)).rejects.toThrow('changed while deleting');
  expect(await db.select().from(user)).toHaveLength(1);
  expect((await db.select().from(appleCredits))[0]).toMatchObject({ available: 50 });
  await db.delete(jobs).where(eq(jobs.id, 'j3'));
  expect(await deleteAccount('buyer', Date.now(), deps)).toEqual({ deleted: true });
  expect(deleted).toEqual([['private/buyer/audio/j1.mp3', 'private/buyer/video/v1.mp4', 'private/buyer/video/v1.mp3', 'private/buyer/uploads/bg.jpg']]);
  for (const table of [user, favorites, jobs, videoJobs, appleCredits]) expect(await db.select().from(table)).toEqual([]);
  expect((await db.select().from(ledger))[0]).toMatchObject({ type: 'account_deleted_forfeit', availableDelta: -50, pool: 'apple' });
});
