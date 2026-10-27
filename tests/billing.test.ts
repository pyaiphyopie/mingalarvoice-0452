import { test, expect, beforeAll } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { audioCharge } from '../packages/web/src/api/services/tariff';
import { publicVoices } from '../packages/web/src/api/services/speech';

// In-memory database: no real customer balances or provider calls are touched.
process.env.DATABASE_URL = `file:${mkdtempSync('/home/user/billing-test-')}/test.db`;
delete process.env.DATABASE_AUTH_TOKEN;
const { db } = await import('../packages/web/src/api/database');
const { jobs, accounts, ledger } = await import('../packages/web/src/api/database/schema');
const { finish } = await import('../packages/web/src/api/services/worker');
const { secretMatches } = await import('../packages/web/src/api/services/owner');
const { eq } = await import('../packages/web/node_modules/drizzle-orm');

beforeAll(async () => {
  await db.run('CREATE TABLE credit_accounts (user_id TEXT PRIMARY KEY, available INTEGER NOT NULL, reserved INTEGER NOT NULL CHECK(reserved >= 0))');
  await db.run('CREATE TABLE generation_jobs (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, script TEXT NOT NULL, voice_id TEXT NOT NULL, model TEXT NOT NULL DEFAULT \'eleven_v4\', status TEXT NOT NULL DEFAULT \'queued\', cost INTEGER NOT NULL, idempotency TEXT NOT NULL, created_at INTEGER NOT NULL, lease_until INTEGER, storage_key TEXT, error TEXT, provider_request_id TEXT, duration_ms INTEGER, actual_cost INTEGER, credit_pool TEXT NOT NULL DEFAULT \'web\')');
  await db.run('CREATE TABLE credit_ledger (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, operation_key TEXT UNIQUE NOT NULL, type TEXT NOT NULL, available_delta INTEGER NOT NULL, reserved_delta INTEGER NOT NULL, job_id TEXT, created_at INTEGER NOT NULL, credit_pool TEXT NOT NULL DEFAULT \'web\')');
});

test('duration rounds up, unused reservation refunds, ceiling prevents surprise overcharge', () => {
  expect(audioCharge(9.792, 120)).toEqual({ durationMs: 9792, actualCost: 10, refund: 110, overrun: false });
  expect(audioCharge(120.001, 120).actualCost).toBe(120);
  expect(audioCharge(120.001, 120).overrun).toBe(true);
  expect(() => audioCharge(NaN, 120)).toThrow();
  expect(() => audioCharge(0, 120)).toThrow();
});

test('public catalog excludes clones, designs and unknown categories', () => {
  const voices = ['premade', 'cloned', 'generated', undefined].map((category, i) => ({ voice_id: String(i), name: 'Sample', category, preview_url: '', labels: {} }));
  expect(publicVoices(voices).map(v => v.voice_id)).toEqual(['0']);
  const [voice] = publicVoices([{ ...voices[0], preview_url: 'https://example.invalid/english.mp3' }]);
  expect(voice.outputLanguage).toBe('my');
  expect('preview_url' in voice).toBe(false);
});

test('owner approval fails closed without a strong secret and rejects wrong values', () => {
  process.env.OWNER_APPROVAL_SECRET = 'short';
  expect(secretMatches('short')).toBe(false);
  process.env.OWNER_APPROVAL_SECRET = 'test-only-owner-secret-123456';
  expect(secretMatches('wrong-secret')).toBe(false);
  expect(secretMatches('test-only-owner-secret-123456')).toBe(true);
});

test('successful settlement bills duration, refunds once and rejects a second settlement', async () => {
  await db.insert(accounts).values({ userId: 'test-user', available: 80, reserved: 120 });
  const [job] = await db.insert(jobs).values({ id: 'test-job', userId: 'test-user', text: 'မင်္ဂလာပါ', voiceId: 'test', status: 'running', cost: 120, idempotency: 'test', createdAt: Date.now() }).returning();
  expect(await finish(job, 'succeeded', 'private/test.mp3', undefined, audioCharge(9.792, 120))).toBe(true);
  expect(await finish(job, 'succeeded', 'private/test.mp3', undefined, audioCharge(9.792, 120))).toBe(false);
  const [wallet] = await db.select().from(accounts).where(eq(accounts.userId, 'test-user'));
  expect(wallet.available).toBe(190); expect(wallet.reserved).toBe(0);
  expect((await db.select().from(ledger)).length).toBe(1);
});

test('missing reservation rolls back rather than reporting a free successful job', async () => {
  await db.insert(accounts).values({ userId: 'broken-user', available: 80, reserved: 0 });
  const [job] = await db.insert(jobs).values({ id: 'broken-job', userId: 'broken-user', text: 'မင်္ဂလာပါ', voiceId: 'test', status: 'running', cost: 120, idempotency: 'broken', createdAt: Date.now() }).returning();
  await expect(finish(job, 'failed')).rejects.toThrow('invariant');
  const [current] = await db.select().from(jobs).where(eq(jobs.id, 'broken-job'));
  expect(current.status).toBe('running');
});

test('explicit failure releases the whole reservation exactly once', async () => {
  await db.insert(accounts).values({ userId: 'failure-user', available: 25, reserved: 60 });
  const [job] = await db.insert(jobs).values({ id: 'failure-job', userId: 'failure-user', text: 'မင်္ဂလာပါ', voiceId: 'test', status: 'running', cost: 60, idempotency: 'failure', createdAt: Date.now() }).returning();
  expect(await finish(job, 'failed')).toBe(true);
  expect(await finish(job, 'failed')).toBe(false);
  const [wallet] = await db.select().from(accounts).where(eq(accounts.userId, 'failure-user'));
  expect(wallet.available).toBe(85); expect(wallet.reserved).toBe(0);
});