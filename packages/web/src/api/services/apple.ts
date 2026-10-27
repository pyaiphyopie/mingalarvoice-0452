import { ORPCError } from '@orpc/server';
import { and, eq, sql } from 'drizzle-orm';
import { Environment, SignedDataVerifier, type JWSTransactionDecodedPayload, type ResponseBodyV2DecodedPayload } from '@apple/app-store-server-library';
import { db } from '../database';
import { appleAccountTokens, appleCredits, appleNotifications, appleTransactions, ledger } from '../database/schema';
import { appleRootCertificates } from './apple-roots';

/** Must match packages/mobile/app.json ios.bundleIdentifier and the App Store Connect app. */
export const APPLE_BUNDLE_ID = 'com.mingalarvoice.k7q2';
/** Server-side allowlist. Client-supplied product IDs, prices or credit amounts are never trusted. */
export const appleProducts: Record<string, { credits: number; label: string }> = {
  [`${APPLE_BUNDLE_ID}.credits6300`]: { credits: 6300, label: 'Creator credits' },
  [`${APPLE_BUNDLE_ID}.credits14400`]: { credits: 14400, label: 'Studio credits' },
};

type Verifier = Pick<SignedDataVerifier, 'verifyAndDecodeTransaction' | 'verifyAndDecodeNotification'>;

/** Fails closed: purchases stay disabled until every Apple value is configured explicitly. */
export function appleConfig() {
  const environment = process.env.APPLE_ENVIRONMENT;
  const appAppleId = Number(process.env.APPLE_APP_APPLE_ID);
  const missing: string[] = [];
  if (process.env.APPLE_IAP_ENABLED !== 'true') missing.push('APPLE_IAP_ENABLED');
  if (environment !== Environment.SANDBOX && environment !== Environment.PRODUCTION) missing.push('APPLE_ENVIRONMENT');
  if (environment === Environment.PRODUCTION && !(Number.isSafeInteger(appAppleId) && appAppleId > 0)) missing.push('APPLE_APP_APPLE_ID');
  return {
    enabled: missing.length === 0,
    missing,
    environment: environment as Environment.SANDBOX | Environment.PRODUCTION,
    appAppleId: Number.isSafeInteger(appAppleId) && appAppleId > 0 ? appAppleId : undefined,
  };
}

let cachedVerifier: { key: string; verifier: SignedDataVerifier } | undefined;
function defaultVerifier(): Verifier {
  const config = appleConfig();
  if (!config.enabled) throw new ORPCError('PRECONDITION_FAILED', { message: 'App Store purchases are not available yet. No payment was taken by this app.' });
  const key = `${config.environment}:${config.appAppleId ?? ''}`;
  if (cachedVerifier?.key !== key) {
    // Online revocation checks in production; Apple signing chain, bundle ID and environment always verified.
    cachedVerifier = { key, verifier: new SignedDataVerifier(appleRootCertificates, config.environment === Environment.PRODUCTION, config.environment, APPLE_BUNDLE_ID, config.appAppleId) };
  }
  return cachedVerifier.verifier;
}

export async function appleAccountToken(userId: string) {
  await db.insert(appleAccountTokens).values({ userId, token: crypto.randomUUID(), createdAt: Date.now() }).onConflictDoNothing();
  const [row] = await db.select().from(appleAccountTokens).where(eq(appleAccountTokens.userId, userId));
  return row!.token;
}

function rejected(message: string): never {
  throw new ORPCError('BAD_REQUEST', { message });
}

/** Validates an Apple-signed transaction and grants its allowlisted credits exactly once. */
export async function redeemAppleTransaction(userId: string, signedTransaction: string, verifier: Verifier = defaultVerifier()) {
  const config = appleConfig();
  if (!config.enabled) throw new ORPCError('PRECONDITION_FAILED', { message: 'App Store purchases are not available yet.' });
  let tx: JWSTransactionDecodedPayload;
  try {
    tx = await verifier.verifyAndDecodeTransaction(signedTransaction);
  } catch {
    rejected('Apple could not verify this purchase. No credits were added.');
  }
  if (tx.bundleId !== APPLE_BUNDLE_ID || tx.environment !== config.environment) rejected('This purchase belongs to a different app or environment.');
  const product = tx.productId ? appleProducts[tx.productId] : undefined;
  if (!product || tx.type !== 'Consumable' || !tx.transactionId) rejected('This product is not a Mingalar Voice credit pack.');
  if ((tx.quantity ?? 1) !== 1) rejected('Purchase quantity must be one.');
  if (tx.revocationDate) rejected('This purchase was refunded or revoked.');
  const token = await appleAccountToken(userId);
  if (tx.appAccountToken?.toLowerCase() !== token.toLowerCase()) throw new ORPCError('FORBIDDEN', { message: 'This purchase was made from a different Mingalar Voice account.' });
  const transactionId = tx.transactionId;
  return db.transaction(async t => {
    const now = Date.now();
    const [inserted] = await t.insert(appleTransactions).values({
      transactionId, originalTransactionId: tx.originalTransactionId, userId, productId: tx.productId!, credits: product.credits,
      environment: tx.environment!, purchasedAt: tx.purchaseDate, grantedAt: now,
    }).onConflictDoNothing().returning();
    if (!inserted) {
      const [existing] = await t.select().from(appleTransactions).where(eq(appleTransactions.transactionId, transactionId));
      if (existing?.userId !== userId) throw new ORPCError('FORBIDDEN', { message: 'This purchase is linked to another account.' });
      return { transactionId, credits: existing.credits, duplicate: true, status: existing.status };
    }
    await t.insert(appleCredits).values({ userId, available: product.credits, reserved: 0 })
      .onConflictDoUpdate({ target: appleCredits.userId, set: { available: sql`${appleCredits.available} + ${product.credits}` } });
    await t.insert(ledger).values({ id: crypto.randomUUID(), userId, key: `apple:${transactionId}`, type: 'apple_purchase_grant', availableDelta: product.credits, reservedDelta: 0, createdAt: now, pool: 'apple' });
    return { transactionId, credits: product.credits, duplicate: false, status: 'granted' };
  });
}

/** App Store Server Notifications V2: refunds/revocations remove unspent credits; shortfall is recorded. */
export async function handleAppleNotification(signedPayload: string, verifier: Verifier = defaultVerifier()) {
  const config = appleConfig();
  let notification: ResponseBodyV2DecodedPayload;
  try {
    notification = await verifier.verifyAndDecodeNotification(signedPayload);
  } catch {
    return { status: 400 as const, result: 'unverified' };
  }
  if (notification.data?.environment !== config.environment || notification.data?.bundleId !== APPLE_BUNDLE_ID) return { status: 400 as const, result: 'wrong environment' };
  const id = notification.notificationUUID;
  if (!id) return { status: 400 as const, result: 'missing id' };
  const type = String(notification.notificationType);
  let tx: JWSTransactionDecodedPayload | undefined;
  if (notification.data.signedTransactionInfo) {
    try { tx = await verifier.verifyAndDecodeTransaction(notification.data.signedTransactionInfo); } catch { return { status: 400 as const, result: 'unverified transaction' }; }
  }
  return db.transaction(async t => {
    const [fresh] = await t.insert(appleNotifications).values({ id, type, transactionId: tx?.transactionId, receivedAt: Date.now() }).onConflictDoNothing().returning();
    if (!fresh || !tx?.transactionId) return { status: 200 as const, result: fresh ? 'recorded' : 'duplicate' };
    const [record] = await t.select().from(appleTransactions).where(eq(appleTransactions.transactionId, tx.transactionId));
    if (!record) return { status: 200 as const, result: 'unknown transaction' };
    const now = Date.now();
    if ((type === 'REFUND' || type === 'REVOKE') && record.status === 'granted') {
      const [balance] = await t.select().from(appleCredits).where(eq(appleCredits.userId, record.userId));
      const removed = Math.min(record.credits, balance?.available ?? 0);
      if (removed > 0) await t.update(appleCredits).set({ available: sql`${appleCredits.available} - ${removed}` }).where(and(eq(appleCredits.userId, record.userId)));
      await t.update(appleTransactions).set({ status: 'revoked', revokedAt: now, revokedCredits: removed, shortfall: record.credits - removed }).where(eq(appleTransactions.transactionId, record.transactionId));
      await t.insert(ledger).values({ id: crypto.randomUUID(), userId: record.userId, key: `apple-revoke:${id}`, type: 'apple_refund_revocation', availableDelta: -removed, reservedDelta: 0, createdAt: now, pool: 'apple' });
      return { status: 200 as const, result: 'revoked' };
    }
    if (type === 'REFUND_REVERSED' && record.status === 'revoked') {
      const restored = record.revokedCredits ?? 0;
      await t.insert(appleCredits).values({ userId: record.userId, available: restored, reserved: 0 })
        .onConflictDoUpdate({ target: appleCredits.userId, set: { available: sql`${appleCredits.available} + ${restored}` } });
      await t.update(appleTransactions).set({ status: 'granted', revokedAt: null, revokedCredits: null, shortfall: null }).where(eq(appleTransactions.transactionId, record.transactionId));
      await t.insert(ledger).values({ id: crypto.randomUUID(), userId: record.userId, key: `apple-reinstate:${id}`, type: 'apple_refund_reversed', availableDelta: restored, reservedDelta: 0, createdAt: now, pool: 'apple' });
      return { status: 200 as const, result: 'reinstated' };
    }
    return { status: 200 as const, result: 'recorded' };
  });
}

/** HTTP adapter for the webhook route. Non-200 makes Apple retry; 503 while unconfigured. */
export async function appleWebhook(body: unknown) {
  const payload = (body as { signedPayload?: unknown } | null)?.signedPayload;
  if (typeof payload !== 'string') return { status: 400 as const, body: { error: 'invalid payload' } };
  if (!appleConfig().enabled) return { status: 503 as const, body: { error: 'App Store notifications are not configured' } };
  const outcome = await handleAppleNotification(payload);
  return { status: outcome.status, body: { result: outcome.result } };
}
