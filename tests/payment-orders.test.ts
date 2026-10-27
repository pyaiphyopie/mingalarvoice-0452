import { test, expect, beforeAll, beforeEach, spyOn } from 'bun:test';
import { mkdtempSync } from 'node:fs';

// Isolated SQLite and mocked session lookup; no merchant, customer or provider calls.
process.env.DATABASE_URL = `file:${mkdtempSync('/home/user/payment-test-')}/test.db`;
delete process.env.DATABASE_AUTH_TOKEN;
process.env.OWNER_APPROVAL_SECRET = 'isolated-test-owner-passphrase-12345';
const { db } = await import('../packages/web/src/api/database');
const { orders, accounts, ledger, payments, subscriptions } = await import('../packages/web/src/api/database/schema');
const { eq } = await import('../packages/web/node_modules/drizzle-orm');
const { call } = await import('../packages/web/node_modules/@orpc/server/dist/index.mjs');
const { auth } = await import('../packages/web/src/api/auth');
const { owner } = await import('../packages/web/src/api/routes/owner');
const { paymentOrders } = await import('../packages/web/src/api/routes/payment-orders');
const { createOrder, submitOrder } = await import('../packages/web/src/api/services/payment-orders');
const secret = process.env.OWNER_APPROVAL_SECRET;
let identity = 'customer';
spyOn(auth.api, 'getSession').mockImplementation(async () => identity === 'guest' ? null : ({ user: { id: identity, email: identity === 'owner' ? 'pyaiphyopie@gmail.com' : `${identity}@example.invalid` } }) as never);
const context = { headers: new Headers() };
const approval = (id: string, reference: string) => ({ secret, orderId: id, reference, customerEmail: 'customer@example.invalid', plan: 'Creator' as const, method: 'KBZPay' as const, settlementVerified: true as const });

beforeAll(async () => {
  for (const statement of [
    'CREATE TABLE user (id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT UNIQUE NOT NULL, email_verified INTEGER NOT NULL DEFAULT 0, image TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)',
    "CREATE TABLE manual_payment_orders (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, plan TEXT NOT NULL, amount_mmk INTEGER NOT NULL, credits INTEGER NOT NULL, currency TEXT NOT NULL DEFAULT 'MMK', status TEXT NOT NULL DEFAULT 'pending_payment', reference TEXT, method TEXT NOT NULL DEFAULT 'KBZPay', created_at INTEGER NOT NULL, submitted_at INTEGER, reviewed_at INTEGER, reviewed_by TEXT, rejection_reason TEXT, approval_id TEXT, months INTEGER NOT NULL DEFAULT 1)",
    "CREATE UNIQUE INDEX one_open_order_per_plan ON manual_payment_orders(user_id, plan) WHERE status IN ('pending_payment', 'pending_review')",
    'CREATE TABLE manual_payment_approvals (id TEXT PRIMARY KEY, reference TEXT UNIQUE NOT NULL, user_id TEXT NOT NULL, owner_id TEXT NOT NULL, plan TEXT NOT NULL, method TEXT NOT NULL, amount_mmk INTEGER NOT NULL, credits INTEGER NOT NULL, approved_at INTEGER NOT NULL, period_end INTEGER NOT NULL)',
    'CREATE TABLE owner_approval_attempts (id TEXT PRIMARY KEY, created_at INTEGER NOT NULL)',
    'CREATE TABLE credit_accounts (user_id TEXT PRIMARY KEY, available INTEGER NOT NULL DEFAULT 0, reserved INTEGER NOT NULL DEFAULT 0)',
    'CREATE TABLE subscriptions (user_id TEXT PRIMARY KEY, status TEXT NOT NULL, provider_id TEXT, period_end INTEGER, cancel_at_end INTEGER, plan TEXT)',
    'CREATE TABLE voice_clones (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL, provider_voice_id TEXT UNIQUE, status TEXT NOT NULL, consent_text TEXT NOT NULL, transcript TEXT, consent_score INTEGER, sample_key TEXT, error TEXT, created_at INTEGER NOT NULL, paused_at INTEGER, deleted_at INTEGER)',
    'CREATE TABLE credit_ledger (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, operation_key TEXT UNIQUE NOT NULL, type TEXT NOT NULL, available_delta INTEGER NOT NULL, reserved_delta INTEGER NOT NULL, job_id TEXT, created_at INTEGER NOT NULL, credit_pool TEXT NOT NULL DEFAULT \'web\')',
    "INSERT INTO user VALUES ('customer', 'Customer', 'customer@example.invalid', 0, NULL, 0, 0)",
  ]) await db.run(statement);
});
beforeEach(async () => {
  identity = 'customer';
  for (const table of ['manual_payment_orders', 'manual_payment_approvals', 'owner_approval_attempts', 'credit_accounts', 'subscriptions', 'credit_ledger']) await db.run(`DELETE FROM ${table}`);
});

test('create reuses open order; submitted reference is normalized; no grants; user isolation', async () => {
  const order = await call(paymentOrders.create, { plan: 'Creator' }, { context });
  expect((await createOrder('customer', 'Creator')).id).toBe(order.id);
  const submitted = await submitOrder('customer', order.id, ' test 001 ');
  expect(submitted.status).toBe('pending_review'); expect(submitted.reference).toBe('TEST001');
  expect((await submitOrder('customer', order.id, 'test001')).id).toBe(order.id);
  await expect(submitOrder('other', order.id, 'test001')).rejects.toThrow();
  await expect(submitOrder('customer', order.id, 'changed001')).rejects.toThrow();
  identity = 'other'; expect(await call(paymentOrders.list, undefined, { context })).toEqual([]);
  identity = 'guest'; await expect(call(paymentOrders.create, { plan: 'Creator' }, { context })).rejects.toThrow();
  expect(await db.select().from(accounts)).toEqual([]); expect(await db.select().from(ledger)).toEqual([]);
});

test('owner email and secret required for queue, approval and rejection', async () => {
  const order = await createOrder('customer', 'Creator'); await submitOrder('customer', order.id, 'AUTH001');
  await expect(call(owner.pendingOrders, { secret }, { context })).rejects.toThrow();
  await expect(call(owner.approve, approval(order.id, 'AUTH001'), { context })).rejects.toThrow();
  identity = 'owner';
  await expect(call(owner.pendingOrders, { secret: 'wrong' }, { context })).rejects.toThrow();
  await expect(call(owner.rejectOrder, { secret: 'wrong', id: order.id, reason: 'Not received' }, { context })).rejects.toThrow();
  expect((await call(owner.pendingOrders, { secret }, { context }))[0].order.id).toBe(order.id);
  expect(await db.select().from(payments)).toEqual([]);
});

test('approval is atomic, 30-day access, exactly one grant on replay', async () => {
  const order = await createOrder('customer', 'Creator'); await submitOrder('customer', order.id, 'PAY001'); identity = 'owner';
  const start = Date.now(); const result = await call(owner.approve, approval(order.id, 'PAY001'), { context });
  expect(result.duplicate).toBe(false); expect(result.approval.periodEnd).toBeGreaterThanOrEqual(start + 30 * 86400000);
  expect((await call(owner.approve, approval(order.id, 'pay001'), { context })).duplicate).toBe(true);
  expect((await db.select().from(orders))[0].status).toBe('approved');
  expect((await db.select().from(accounts))[0].available).toBe(2400);
  expect((await db.select().from(ledger)).length).toBe(1); expect((await db.select().from(payments)).length).toBe(1);
  expect((await db.select().from(subscriptions))[0].cancelAtEnd).toBe(true);
  const replay = await createOrder('customer', 'Creator'); await submitOrder('customer', replay.id, 'PAY001');
  await expect(call(owner.approve, approval(replay.id, 'PAY001'), { context })).rejects.toThrow();
  expect((await db.select().from(accounts))[0].available).toBe(2400);
});

test('altered details rejected and rejection grants nothing', async () => {
  const order = await createOrder('customer', 'Creator'); await submitOrder('customer', order.id, 'REJECT001'); identity = 'owner';
  await expect(call(owner.approve, { ...approval(order.id, 'REJECT001'), method: 'KBZ Bank' }, { context })).rejects.toThrow();
  await expect(call(owner.approve, { ...approval(order.id, 'REJECT001'), plan: 'Studio' }, { context })).rejects.toThrow();
  await call(owner.rejectOrder, { secret, id: order.id, reason: 'Transfer not found in wallet records' }, { context });
  await expect(call(owner.approve, approval(order.id, 'REJECT001'), { context })).rejects.toThrow();
  expect((await db.select().from(orders))[0].status).toBe('rejected'); expect(await db.select().from(ledger)).toEqual([]);
});

test('ledger failure rolls back payment, wallet, access and order status together', async () => {
  const order = await createOrder('customer', 'Creator'); await submitOrder('customer', order.id, 'ROLLBACK001'); identity = 'owner';
  await db.run("CREATE TRIGGER test_ledger_failure BEFORE INSERT ON credit_ledger BEGIN SELECT RAISE(ABORT, 'test failure'); END");
  try { await expect(call(owner.approve, approval(order.id, 'ROLLBACK001'), { context })).rejects.toThrow(); }
  finally { await db.run('DROP TRIGGER test_ledger_failure'); }
  expect((await db.select().from(orders))[0].status).toBe('pending_review');
  expect(await db.select().from(accounts)).toEqual([]); expect(await db.select().from(payments)).toEqual([]);
  expect(await db.select().from(subscriptions)).toEqual([]); expect(await db.select().from(ledger)).toEqual([]);
});

test('concurrent creation cannot produce two open orders; concurrent approval cannot double grant', async () => {
  const creates = await Promise.allSettled([createOrder('customer', 'Creator'), createOrder('customer', 'Creator')]);
  expect(creates.some(r => r.status === 'fulfilled')).toBe(true);
  expect((await db.select().from(orders)).length).toBe(1);
  const [order] = await db.select().from(orders); await submitOrder('customer', order.id, 'RACE001'); identity = 'owner';
  const requests = [0, 1].map(() => Bun.spawn(['bun', 'tests/payment-race.ts', order.id], { env: process.env, stdout: 'pipe', stderr: 'pipe' }));
  const results = await Promise.all(requests.map(async child => { const output = await new Response(child.stdout).text(); await child.exited; return JSON.parse(output); }));
  expect(results.some(r => r.success)).toBe(true);
  expect((await db.select().from(payments)).length).toBe(1); expect((await db.select().from(ledger)).length).toBe(1);
  expect((await db.select().from(accounts).where(eq(accounts.userId, 'customer')))[0].available).toBe(2400);
});
test('grandfathered order keeps its stored price and credits; Business uses the new list', async () => {
  // Simulates the live pending Studio order created under the old 55,000 MMK / 14,400 credit list.
  await db.insert(orders).values({ id: '859b0ec6-4e8a-46c2-ad75-741545e70b3c', userId: 'customer', plan: 'Studio', amount: 55000, credits: 14400, status: 'pending_review', reference: 'OLDSTUDIO1', method: 'KBZPay', createdAt: 1, submittedAt: 2 });
  identity = 'owner';
  const r = await call(owner.approve, { ...approval('859b0ec6-4e8a-46c2-ad75-741545e70b3c', 'OLDSTUDIO1'), plan: 'Studio' }, { context });
  expect([r.approval.amount, r.approval.credits]).toEqual([55000, 14400]);
  expect((await db.select().from(accounts))[0].available).toBe(14400);
  expect((await db.select().from(subscriptions))[0].plan).toBe('Studio');
  identity = 'customer';
  const business = await call(paymentOrders.create, { plan: 'Business', months: 1 }, { context }).catch(e => { console.log(JSON.stringify(e.data ?? e.message)); throw e; });
  expect([business.amount, business.credits, business.months]).toEqual([122000, 12600, 1]);
  const prepay = await call(paymentOrders.create, { plan: 'Business', months: 3 }, { context });
  expect(prepay.id).toBe(business.id);
  expect([prepay.amount, prepay.credits, prepay.months]).toEqual([329400, 37800, 3]);
});

test('on-time Studio renewal keeps 50% of unused credits; top-ups need a paid plan and add no days', async () => {
  identity = 'customer';
  await expect(call(paymentOrders.create, { plan: 'Topup1000', months: 1 }, { context })).rejects.toThrow();
  const first = await createOrder('customer', 'Studio'); await submitOrder('customer', first.id, 'STUDIO001'); identity = 'owner';
  const a = await call(owner.approve, { ...approval(first.id, 'STUDIO001'), plan: 'Studio' }, { context });
  expect((await db.select().from(accounts))[0].available).toBe(6000);
  identity = 'customer';
  const top = await createOrder('customer', 'Topup1000'); expect([top.amount, top.credits, top.months]).toEqual([12000, 1000, 0]);
  await submitOrder('customer', top.id, 'TOPUP001'); identity = 'owner';
  const t = await call(owner.approve, { ...approval(top.id, 'TOPUP001'), plan: 'Topup1000' }, { context });
  expect(t.approval.periodEnd).toBe(a.approval.periodEnd);
  expect((await db.select().from(accounts))[0].available).toBe(7000);
  identity = 'customer';
  const renew = await createOrder('customer', 'Studio'); await submitOrder('customer', renew.id, 'STUDIO002'); identity = 'owner';
  const r = await call(owner.approve, { ...approval(renew.id, 'STUDIO002'), plan: 'Studio' }, { context });
  expect(r.forfeited).toBe(3500);
  expect((await db.select().from(accounts))[0].available).toBe(3500 + 6000);
  expect(r.approval.periodEnd).toBe(a.approval.periodEnd + 30 * 86400000);
});
