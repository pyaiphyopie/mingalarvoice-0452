/**
 * Payment rail end-to-end test.
 *
 *   bun --env-file=.env test tests/payment-rail.e2e.test.ts
 *
 * - Database: a throwaway local SQLite file built from the LIVE Turso DDL (schema only,
 *   read-only pull, no rows), so this runs against the real production schema rather than
 *   hand-written test tables. The live database is never written.
 * - HTTP: every customer/owner call goes through the real Hono app (Better Auth sign-up and
 *   session cookies, oRPC at /api/rpc, the Apple webhook route). In-process, no network.
 * - Owner: an isolated user with the owner email exists only in the throwaway database; the
 *   approval passphrase is a test value, not the real OWNER_APPROVAL_SECRET.
 * - Apple: the production verifier with Apple's real root certificates is exercised over
 *   HTTP with forged JWS. The positive path uses the same @apple/app-store-server-library
 *   verifier with a locally generated test PKI (real ES256 signature and chain checks).
 * - ElevenLabs/S3 are stubbed; no real money, transfers, StoreKit or provider calls.
 */
import { test, expect, beforeAll, afterAll, spyOn } from 'bun:test';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createPrivateKey, sign as signData } from 'node:crypto';
import { createClient } from '../packages/web/node_modules/@libsql/client';

const dir = mkdtempSync('/home/user/payment-rail-');
const liveUrl = process.env.DATABASE_URL!;
const liveToken = process.env.DATABASE_AUTH_TOKEN;
if (!liveUrl || liveUrl.startsWith('file:')) throw new Error('Run with --env-file=.env so the live schema can be read');

// 1. Read-only DDL pull from the live database.
const remote = createClient({ url: liveUrl, authToken: liveToken });
const ddl = (await remote.execute("SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY CASE type WHEN 'table' THEN 0 ELSE 1 END")).rows.map(r => String(r.sql));
remote.close();
const local = createClient({ url: `file:${dir}/rail.db` });
for (const statement of ddl) await local.execute(statement);
local.close();

// 2. Point the app at the throwaway copy and isolate every secret/provider.
process.env.DATABASE_URL = `file:${dir}/rail.db`;
delete process.env.DATABASE_AUTH_TOKEN;
const OWNER_SECRET = 'rail-test-owner-passphrase-not-real-123';
process.env.OWNER_APPROVAL_SECRET = OWNER_SECRET;
process.env.GENERATION_TARIFF_APPROVED = 'true';
for (const key of ['ELEVENLABS_API_KEY', 'S3_ENDPOINT', 'S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY']) process.env[key] = 'rail-fixture';
for (const key of ['APPLE_IAP_ENABLED', 'APPLE_ENVIRONMENT', 'APPLE_APP_APPLE_ID']) delete process.env[key];

const blocked: string[] = [];
spyOn(globalThis, 'fetch').mockImplementation(async url => {
  const u = String(url);
  if (u.endsWith('/voices')) return Response.json({ voices: [{ voice_id: 'rail-voice', name: 'Rail', category: 'premade', preview_url: '', labels: {} }] });
  if (u.endsWith('/models')) return Response.json([{ model_id: 'eleven_v4', can_do_text_to_speech: true, languages: [{ language_id: 'my', name: 'Burmese' }] }]);
  blocked.push(u);
  throw new Error(`external request blocked in rail test: ${u}`);
});

const { default: app } = await import('../packages/web/src/api/index');
const { db } = await import('../packages/web/src/api/database');
const schema = await import('../packages/web/src/api/database/schema');
const apl = await import('../packages/web/src/api/services/apple');
const { finish } = await import('../packages/web/src/api/services/worker');
const { audioCharge } = await import('../packages/web/src/api/services/tariff');
const { heartbeat } = await import('../packages/web/src/api/services/generation-status');
const { SignedDataVerifier, Environment } = await import('../packages/web/node_modules/@apple/app-store-server-library');
const { eq } = await import('../packages/web/node_modules/drizzle-orm');

const ORIGIN = 'http://localhost:4200';
type Session = { cookie: string; id: string; email: string };
async function signUp(email: string, name: string): Promise<Session> {
  const res = await app.fetch(new Request(`${ORIGIN}/api/auth/sign-up/email`, {
    method: 'POST', headers: { 'content-type': 'application/json', origin: ORIGIN },
    body: JSON.stringify({ email, name, password: 'rail-test-password-1' }),
  }));
  const body = await res.json() as { user?: { id: string } };
  if (res.status !== 200 || !body.user) throw new Error(`sign-up ${email}: ${res.status} ${JSON.stringify(body)}`);
  const cookie = res.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
  return { cookie, id: body.user.id, email };
}
async function rpc(who: Session | null, path: string, input?: unknown) {
  const res = await app.fetch(new Request(`${ORIGIN}/api/rpc/${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json', origin: ORIGIN, ...(who ? { cookie: who.cookie } : {}) },
    body: JSON.stringify(input === undefined ? {} : { json: input }),
  }));
  const body = await res.json() as { json: any };
  return { status: res.status, data: body.json, code: body.json?.code as string | undefined, message: body.json?.message as string | undefined };
}
const ok = async (who: Session | null, path: string, input?: unknown) => {
  const r = await rpc(who, path, input);
  if (r.status !== 200) throw new Error(`${path} → ${r.status} ${r.code}: ${r.message}`);
  return r.data;
};
const webhook = async (body: unknown) => {
  const res = await app.fetch(new Request(`${ORIGIN}/api/webhooks/apple`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: typeof body === 'string' ? body : JSON.stringify(body) }));
  return { status: res.status, body: await res.json() as Record<string, string> };
};
const rows = async (table: any, column: any, value: string) => db.select().from(table).where(eq(column, value));

// 3. Local test PKI that mimics Apple's chain shape (root → intermediate with Apple WWDR OID → leaf with App Store OID).
function openssl(args: string[]) {
  const r = Bun.spawnSync(['openssl', ...args], { cwd: dir });
  if (r.exitCode !== 0) throw new Error(`openssl ${args.join(' ')}: ${r.stderr.toString()}`);
}
let pki: { root: Buffer; x5c: string[]; leafKey: ReturnType<typeof createPrivateKey> };
function buildPki() {
  writeFileSync(join(dir, 'ext.cnf'), [
    '[root]', 'basicConstraints=critical,CA:TRUE', 'keyUsage=critical,keyCertSign,cRLSign',
    '[inter]', 'basicConstraints=critical,CA:TRUE,pathlen:0', 'keyUsage=critical,keyCertSign,cRLSign', '1.2.840.113635.100.6.2.1=ASN1:NULL',
    '[leaf]', 'basicConstraints=critical,CA:FALSE', 'keyUsage=critical,digitalSignature', '1.2.840.113635.100.6.11.1=ASN1:NULL', '',
  ].join('\n'));
  for (const n of ['root', 'inter', 'leaf']) openssl(['ecparam', '-name', 'prime256v1', '-genkey', '-noout', '-out', `${n}.key`]);
  openssl(['req', '-new', '-x509', '-key', 'root.key', '-subj', '/CN=Rail Test Root CA', '-days', '30', '-out', 'root.pem', '-extensions', 'root', '-config', 'ext.cnf']);
  for (const [n, issuer, cn] of [['inter', 'root', 'Rail Test WWDR'], ['leaf', 'inter', 'Rail Test StoreKit Signing']]) {
    openssl(['req', '-new', '-key', `${n}.key`, '-subj', `/CN=${cn}`, '-out', `${n}.csr`, '-config', 'ext.cnf']);
    openssl(['x509', '-req', '-in', `${n}.csr`, '-CA', `${issuer}.pem`, '-CAkey', `${issuer}.key`, '-CAcreateserial', '-days', '30', '-out', `${n}.pem`, '-extfile', 'ext.cnf', '-extensions', n]);
  }
  const der = (n: string) => { openssl(['x509', '-in', `${n}.pem`, '-outform', 'DER', '-out', `${n}.der`]); return readFileSync(join(dir, `${n}.der`)); };
  const root = der('root');
  pki = { root, x5c: [der('leaf'), der('inter'), root].map(b => b.toString('base64')), leafKey: createPrivateKey(readFileSync(join(dir, 'leaf.key'))) };
}
const b64url = (v: string | Buffer) => Buffer.from(v).toString('base64url');
function jws(payload: Record<string, unknown>) {
  const head = b64url(JSON.stringify({ alg: 'ES256', x5c: pki.x5c })) + '.' + b64url(JSON.stringify(payload));
  return `${head}.${b64url(signData('sha256', Buffer.from(head), { key: pki.leafKey, dsaEncoding: 'ieee-p1363' }))}`;
}
const CREATOR = `${apl.APPLE_BUNDLE_ID}.credits6300`;
const STUDIO = `${apl.APPLE_BUNDLE_ID}.credits14400`;
const txPayload = (token: string, o: Record<string, unknown> = {}) => ({
  transactionId: `2000000${Math.floor(Math.random() * 1e9)}`, originalTransactionId: 'orig-1', bundleId: apl.APPLE_BUNDLE_ID, productId: CREATOR,
  type: 'Consumable', environment: 'Sandbox', quantity: 1, appAccountToken: token, purchaseDate: Date.now(), signedDate: Date.now(),
  inAppOwnershipType: 'PURCHASED', storefront: 'MMR', currency: 'USD', price: 9990, ...o,
});
let testVerifier: InstanceType<typeof SignedDataVerifier>;

let customer: Session, owner: Session, intruder: Session, iosBuyer: Session;
beforeAll(async () => {
  buildPki();
  testVerifier = new SignedDataVerifier([pki.root], false, Environment.SANDBOX, apl.APPLE_BUNDLE_ID);
  customer = await signUp('rail-customer@example.invalid', 'Rail Customer');
  owner = await signUp('pyaiphyopie@gmail.com', 'Owner (isolated copy)');
  intruder = await signUp('rail-intruder@example.invalid', 'Rail Intruder');
  iosBuyer = await signUp('rail-ios@example.invalid', 'Rail iOS Buyer');
  await heartbeat();
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

test('live schema copy has every payment table', async () => {
  for (const t of ['manual_payment_orders', 'manual_payment_approvals', 'credit_accounts', 'credit_ledger', 'subscriptions', 'apple_credit_accounts', 'apple_transactions', 'apple_notifications', 'apple_account_tokens', 'owner_approval_attempts']) {
    expect(ddl.some(s => s.includes(t))).toBe(true);
  }
});

test('KBZPay rail: no access before payment, checkout is manual, guests rejected', async () => {
  expect((await rpc(null, 'paymentOrders/create', { plan: 'Creator' })).status).toBe(401);
  const checkout = await rpc(customer, 'studio/checkout');
  expect(checkout.code).toBe('SERVICE_UNAVAILABLE');
  const w = await ok(customer, 'studio/wallet');
  expect([w.available, w.reserved, w.subscription, w.apple.available]).toEqual([0, 0, null, 0]);
  const gen = await rpc(customer, 'studio/create', { text: 'မင်္ဂလာပါ။', voiceId: 'rail-voice', idempotency: crypto.randomUUID(), maxCredits: 50 });
  expect(gen.code).toBe('PRECONDITION_FAILED');
  expect(await db.select().from(schema.jobs)).toEqual([]);
});

let creatorOrder: any;
test('KBZPay rail: customer creates order and submits transfer reference', async () => {
  creatorOrder = await ok(customer, 'paymentOrders/create', { plan: 'Creator' });
  expect(creatorOrder).toMatchObject({ plan: 'Creator', amount: 25000, credits: 2400, currency: 'MMK', status: 'pending_payment' });
  expect((await ok(customer, 'paymentOrders/create', { plan: 'Creator' })).id).toBe(creatorOrder.id); // reused, not duplicated
  expect((await rpc(customer, 'paymentOrders/submit', { id: creatorOrder.id, reference: '12345!' })).code).toBe('BAD_REQUEST');
  const submitted = await ok(customer, 'paymentOrders/submit', { id: creatorOrder.id, reference: ' kbz 2026 1021 01 ' });
  expect(submitted).toMatchObject({ status: 'pending_review', reference: 'KBZ2026102101' });
  expect((await rpc(customer, 'paymentOrders/submit', { id: creatorOrder.id, reference: 'DIFFERENT01' })).code).toBe('CONFLICT');
  // Another account cannot see or touch it.
  expect(await ok(intruder, 'paymentOrders/list')).toEqual([]);
  expect((await rpc(intruder, 'paymentOrders/submit', { id: creatorOrder.id, reference: 'KBZ2026102101' })).code).toBe('NOT_FOUND');
  // Submitting grants nothing.
  expect((await ok(customer, 'studio/wallet')).available).toBe(0);
});

test('KBZPay rail: owner gate — email and passphrase both required', async () => {
  expect((await rpc(customer, 'owner/pendingOrders', { secret: OWNER_SECRET })).code).toBe('FORBIDDEN');
  expect((await rpc(owner, 'owner/pendingOrders', { secret: 'wrong-passphrase-wrong-passphrase' })).code).toBe('FORBIDDEN');
  expect(await ok(customer, 'owner/status')).toEqual({ eligible: false });
  expect(await ok(owner, 'owner/status')).toEqual({ eligible: true });
  const queue = await ok(owner, 'owner/pendingOrders', { secret: OWNER_SECRET });
  expect(queue.map((q: any) => [q.order.id, q.customerEmail])).toEqual([[creatorOrder.id, customer.email]]);
});

const approveInput = (o: Record<string, unknown> = {}) => ({ secret: OWNER_SECRET, customerEmail: customer.email, plan: 'Creator', method: 'KBZPay', reference: 'KBZ2026102101', settlementVerified: true, orderId: creatorOrder.id, ...o });
test('KBZPay rail: mismatched approvals are refused and grant nothing', async () => {
  expect((await rpc(owner, 'owner/approve', approveInput({ plan: 'Studio' }))).code).toBe('CONFLICT');
  expect((await rpc(owner, 'owner/approve', approveInput({ reference: 'KBZ2026102199' }))).code).toBe('CONFLICT');
  expect((await rpc(owner, 'owner/approve', approveInput({ method: 'KBZ Bank' }))).code).toBe('CONFLICT');
  expect((await rpc(owner, 'owner/approve', approveInput({ customerEmail: intruder.email }))).code).toBe('CONFLICT');
  expect((await rpc(owner, 'owner/approve', approveInput({ settlementVerified: false }))).status).toBe(400);
  expect((await rpc(customer, 'owner/approve', approveInput())).code).toBe('FORBIDDEN');
  expect(await db.select().from(schema.payments)).toEqual([]);
  expect((await ok(customer, 'studio/wallet')).available).toBe(0);
});

test('KBZPay rail: approval grants 2,400 credits + 30-day access exactly once', async () => {
  const before = Date.now();
  const r = await ok(owner, 'owner/approve', approveInput());
  expect(r.duplicate).toBe(false);
  expect(r.approval).toMatchObject({ credits: 2400, amount: 25000, plan: 'Creator', userId: customer.id });
  expect(r.approval.periodEnd).toBeGreaterThanOrEqual(before + 30 * 86400000);
  expect(r.approval.periodEnd).toBeLessThan(Date.now() + 30 * 86400000 + 1000);
  const replay = await ok(owner, 'owner/approve', approveInput());
  expect(replay.duplicate).toBe(true);
  const w = await ok(customer, 'studio/wallet');
  expect([w.available, w.reserved, w.subscription.status]).toEqual([2400, 0, 'active']);
  expect(w.entries.filter((e: any) => e.type === 'manual_payment_grant').map((e: any) => e.availableDelta)).toEqual([2400]);
  expect((await ok(customer, 'paymentOrders/list'))[0]).toMatchObject({ id: creatorOrder.id, status: 'approved', approvalId: r.approval.id });
  expect(await ok(owner, 'owner/pendingOrders', { secret: OWNER_SECRET })).toEqual([]);
  // A new order can now be opened again (approved order is not reused).
  const fresh = await ok(customer, 'paymentOrders/create', { plan: 'Creator' });
  expect(fresh.id).not.toBe(creatorOrder.id);
});

test('KBZPay rail: one transfer reference cannot pay for another customer', async () => {
  const o = await ok(intruder, 'paymentOrders/create', { plan: 'Creator' });
  await ok(intruder, 'paymentOrders/submit', { id: o.id, reference: 'KBZ2026102101' });
  const r = await rpc(owner, 'owner/approve', approveInput({ customerEmail: intruder.email, orderId: o.id }));
  expect(r.code).toBe('CONFLICT');
  expect((await ok(intruder, 'studio/wallet')).available).toBe(0);
});

test('KBZPay rail: rejection shows the reason to the customer and grants nothing', async () => {
  const o = await ok(customer, 'paymentOrders/create', { plan: 'Studio' });
  await ok(customer, 'paymentOrders/submit', { id: o.id, reference: 'KBZ2026102102' });
  const rejected = await ok(owner, 'owner/rejectOrder', { secret: OWNER_SECRET, id: o.id, reason: 'Transfer not received in KBZPay' });
  expect(rejected.status).toBe('rejected');
  expect((await rpc(owner, 'owner/rejectOrder', { secret: OWNER_SECRET, id: o.id, reason: 'Second rejection' })).code).toBe('CONFLICT');
  expect((await rpc(owner, 'owner/approve', approveInput({ plan: 'Studio', reference: 'KBZ2026102102', orderId: o.id }))).code).toBe('CONFLICT');
  const mine = (await ok(customer, 'paymentOrders/list')).find((x: any) => x.id === o.id);
  expect(mine).toMatchObject({ status: 'rejected', rejectionReason: 'Transfer not received in KBZPay' });
  expect((await ok(customer, 'studio/wallet')).available).toBe(2400);
});

test('KBZPay rail: paid credits fund a narration and settle by duration', async () => {
  const idempotency = crypto.randomUUID();
  const job = await ok(customer, 'studio/create', { text: 'မင်္ဂလာပါ။ ကြိုဆိုပါတယ်။', voiceId: 'rail-voice', idempotency, maxCredits: 100 });
  expect(job).toMatchObject({ pool: 'web', cost: 100, status: 'queued' });
  expect((await ok(customer, 'studio/create', { text: 'မင်္ဂလာပါ။ ကြိုဆိုပါတယ်။', voiceId: 'rail-voice', idempotency, maxCredits: 100 })).id).toBe(job.id);
  let w = await ok(customer, 'studio/wallet');
  expect([w.available, w.reserved]).toEqual([2300, 100]);
  await db.update(schema.jobs).set({ status: 'running' }).where(eq(schema.jobs.id, job.id));
  const [running] = await rows(schema.jobs, schema.jobs.id, job.id);
  expect(await finish(running as any, 'succeeded', `private/${customer.id}/audio/rail.mp3`, undefined, audioCharge(7.2, 100))).toBe(true);
  expect(await finish(running as any, 'succeeded', `private/${customer.id}/audio/rail.mp3`, undefined, audioCharge(7.2, 100))).toBe(false);
  w = await ok(customer, 'studio/wallet');
  expect([w.available, w.reserved]).toEqual([2392, 0]); // 8 credits for 7.2 s, 92 returned
  const sum = (await rows(schema.ledger, schema.ledger.userId, customer.id)).reduce((s: number, e: any) => s + e.availableDelta, 0);
  expect(sum).toBe(2392); // ledger reconciles with the wallet
});

test('Apple rail: fails closed while unconfigured (current production state)', async () => {
  const cfg = await ok(iosBuyer, 'apple/config');
  expect(cfg.enabled).toBe(false);
  expect(cfg.appAccountToken).toBeNull();
  expect(cfg.products.map((p: any) => [p.productId, p.credits])).toEqual([[CREATOR, 6300], [STUDIO, 14400]]);
  expect((await rpc(iosBuyer, 'apple/redeem', { signedTransaction: 'x'.repeat(40) })).code).toBe('PRECONDITION_FAILED');
  expect((await webhook({ signedPayload: 'x'.repeat(40) })).status).toBe(503);
  expect((await webhook('not json')).status).toBe(400);
  process.env.APPLE_IAP_ENABLED = 'true';
  process.env.APPLE_ENVIRONMENT = 'Production';
  expect((await ok(iosBuyer, 'apple/config')).enabled).toBe(false); // Production without numeric app ID stays closed
  process.env.APPLE_ENVIRONMENT = 'Sandbox';
  expect((await ok(iosBuyer, 'apple/config')).enabled).toBe(true);
});

test("Apple rail: real verifier with Apple's roots rejects forged purchases and notifications over HTTP", async () => {
  const { appAccountToken } = await ok(iosBuyer, 'apple/config');
  expect(appAccountToken).toMatch(/^[0-9a-f-]{36}$/);
  const forged = jws(txPayload(appAccountToken));
  // Correctly shaped, correctly signed by a chain that is not Apple's.
  expect(await testVerifier.verifyAndDecodeTransaction(forged)).toMatchObject({ productId: CREATOR });
  const r = await rpc(iosBuyer, 'apple/redeem', { signedTransaction: forged });
  expect(r.code).toBe('BAD_REQUEST');
  expect(r.message).toContain('could not verify');
  expect((await rpc(iosBuyer, 'apple/redeem', { signedTransaction: 'eyJhbGciOiJub25lIn0.eyJ0cmFuc2FjdGlvbklkIjoiMSJ9.' })).code).toBe('BAD_REQUEST');
  const note = jws({ notificationType: 'REFUND', notificationUUID: crypto.randomUUID(), version: '2.0', signedDate: Date.now(), data: { environment: 'Sandbox', bundleId: apl.APPLE_BUNDLE_ID, signedTransactionInfo: forged } });
  expect(await webhook({ signedPayload: note })).toEqual({ status: 400, body: { result: 'unverified' } });
  expect(await db.select().from(schema.appleTransactions)).toEqual([]);
  expect(await db.select().from(schema.appleNotifications)).toEqual([]);
  expect((await ok(iosBuyer, 'studio/wallet')).apple.available).toBe(0);
});

test('Apple rail: genuine-shape signed purchase grants once, bound to the buying account', async () => {
  const { appAccountToken } = await ok(iosBuyer, 'apple/config');
  const payload = txPayload(appAccountToken);
  const signed = jws(payload);
  const first = await apl.redeemAppleTransaction(iosBuyer.id, signed, testVerifier);
  expect(first).toMatchObject({ credits: 6300, duplicate: false, status: 'granted' });
  expect(await apl.redeemAppleTransaction(iosBuyer.id, signed, testVerifier)).toMatchObject({ duplicate: true, credits: 6300 });
  await expect(apl.redeemAppleTransaction(intruder.id, signed, testVerifier)).rejects.toThrow('different Mingalar Voice account');
  // Tampering, wrong product/environment/bundle, refunded, multi-quantity, foreign token.
  const [h, p, s] = signed.split('.');
  const tampered = `${h}.${b64url(JSON.stringify({ ...payload, productId: STUDIO }))}.${s}`;
  for (const bad of [
    tampered,
    jws(txPayload(appAccountToken, { productId: `${apl.APPLE_BUNDLE_ID}.free` })),
    jws(txPayload(appAccountToken, { environment: 'Production' })),
    jws(txPayload(appAccountToken, { bundleId: 'com.other.app' })),
    jws(txPayload(appAccountToken, { revocationDate: Date.now() })),
    jws(txPayload(appAccountToken, { quantity: 2 })),
    jws(txPayload(appAccountToken, { type: 'Non-Consumable' })),
    jws(txPayload(crypto.randomUUID())),
  ]) await expect(apl.redeemAppleTransaction(iosBuyer.id, bad, testVerifier)).rejects.toThrow();
  void p;
  const w = await ok(iosBuyer, 'studio/wallet');
  expect([w.apple.available, w.available, w.subscription]).toEqual([6300, 0, null]);
  const purchases = await ok(iosBuyer, 'apple/purchases');
  expect(purchases.map((x: any) => [x.productId, x.credits, x.status])).toEqual([[CREATOR, 6300, 'granted']]);
  // Studio pack.
  expect(await apl.redeemAppleTransaction(iosBuyer.id, jws(txPayload(appAccountToken, { productId: STUDIO })), testVerifier)).toMatchObject({ credits: 14400 });
  expect((await ok(iosBuyer, 'studio/wallet')).apple.available).toBe(20700);
});

test('Apple rail: credits never expire, fund generation without a plan, settle back to Apple pool', async () => {
  const job = await ok(iosBuyer, 'studio/create', { text: 'မင်္ဂလာပါ။', voiceId: 'rail-voice', idempotency: crypto.randomUUID(), maxCredits: 60 });
  expect(job.pool).toBe('apple');
  await db.update(schema.jobs).set({ status: 'running' }).where(eq(schema.jobs.id, job.id));
  const [running] = await rows(schema.jobs, schema.jobs.id, job.id);
  expect(await finish(running as any, 'failed', undefined, 'provider rejected')).toBe(true);
  const w = await ok(iosBuyer, 'studio/wallet');
  expect([w.apple.available, w.apple.reserved]).toEqual([20700, 0]); // failed job refunds in full
  expect((await rpc(iosBuyer, 'studio/create', { text: 'မင်္ဂလာပါ။', voiceId: 'rail-voice', idempotency: crypto.randomUUID(), maxCredits: 601 })).status).toBe(400);
});

test('Apple rail: refund notification revokes once, reversal reinstates, all via the verifier', async () => {
  const [tx] = await db.select().from(schema.appleTransactions).where(eq(schema.appleTransactions.productId, CREATOR));
  const { appAccountToken } = await ok(iosBuyer, 'apple/config');
  const info = jws(txPayload(appAccountToken, { transactionId: tx!.transactionId }));
  const note = (type: string, id: string) => jws({ notificationType: type, notificationUUID: id, version: '2.0', signedDate: Date.now(), data: { environment: 'Sandbox', bundleId: apl.APPLE_BUNDLE_ID, signedTransactionInfo: info } });
  const n1 = crypto.randomUUID();
  expect((await apl.handleAppleNotification(note('REFUND', n1), testVerifier)).result).toBe('revoked');
  expect((await apl.handleAppleNotification(note('REFUND', n1), testVerifier)).result).toBe('duplicate');
  expect((await apl.handleAppleNotification(note('REFUND', crypto.randomUUID()), testVerifier)).result).toBe('recorded');
  expect((await ok(iosBuyer, 'studio/wallet')).apple.available).toBe(14400);
  expect((await ok(iosBuyer, 'apple/purchases')).find((x: any) => x.productId === CREATOR).status).toBe('revoked');
  expect((await apl.handleAppleNotification(note('REFUND_REVERSED', crypto.randomUUID()), testVerifier)).result).toBe('reinstated');
  expect((await ok(iosBuyer, 'studio/wallet')).apple.available).toBe(20700);
  const sum = (await rows(schema.ledger, schema.ledger.userId, iosBuyer.id)).reduce((s: number, e: any) => s + e.availableDelta, 0);
  expect(sum).toBe(20700);
});

test('KBZPay rail: a long legitimate review session never locks the owner out', async () => {
  for (let i = 0; i < 15; i++) await ok(owner, 'owner/pendingOrders', { secret: OWNER_SECRET });
  expect((await ok(owner, 'owner/approvals', { secret: OWNER_SECRET })).length).toBe(1);
});

test('KBZPay rail: owner passphrase guessing is throttled across sessions', async () => {
  const second = await app.fetch(new Request(`${ORIGIN}/api/auth/sign-in/email`, {
    method: 'POST', headers: { 'content-type': 'application/json', origin: ORIGIN },
    body: JSON.stringify({ email: owner.email, password: 'rail-test-password-1' }),
  }));
  const otherSession = { ...owner, cookie: second.headers.getSetCookie().map(c => c.split(';')[0]).join('; ') };
  expect(otherSession.cookie).not.toBe(owner.cookie);
  // 1 wrong attempt already made in the owner-gate test; 5 + 4 more = 10 failures across two sessions.
  for (let i = 0; i < 5; i++) expect((await rpc(owner, 'owner/pendingOrders', { secret: `guess-a${i}-xxxxxxxxxxxxxxxxxxxx` })).code).toBe('FORBIDDEN');
  for (let i = 0; i < 4; i++) expect((await rpc(otherSession, 'owner/pendingOrders', { secret: `guess-b${i}-xxxxxxxxxxxxxxxxxxxx` })).code).toBe('FORBIDDEN');
  expect((await rpc(otherSession, 'owner/pendingOrders', { secret: 'guess-c-xxxxxxxxxxxxxxxxxxxx' })).code).toBe('TOO_MANY_REQUESTS');
  let throttled = false;
  for (let i = 0; i < 12 && !throttled; i++) {
    throttled = (await rpc(owner, 'owner/pendingOrders', { secret: `guess-${i}-xxxxxxxxxxxxxxxxxxxx` })).code === 'TOO_MANY_REQUESTS';
  }
  expect(throttled).toBe(true);
  expect((await rpc(owner, 'owner/pendingOrders', { secret: OWNER_SECRET })).code).toBe('TOO_MANY_REQUESTS'); // even the right one, until the window passes
});

test('no unexpected external network calls', () => {
  expect(blocked).toEqual([]);
});
