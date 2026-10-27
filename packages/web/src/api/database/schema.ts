import { sqliteTable, text, integer, uniqueIndex, check } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
export * from './auth-schema';

export const favorites = sqliteTable('voice_favorites', {
  id: text('id').primaryKey(), userId: text('user_id').notNull(), voiceId: text('voice_id').notNull(),
}, t => [uniqueIndex('favorite_owner_voice').on(t.userId, t.voiceId)]);
export const accounts = sqliteTable('credit_accounts', {
  userId: text('user_id').primaryKey(), available: integer('available').notNull().default(0), reserved: integer('reserved').notNull().default(0),
}, t => [check('nonnegative_credit_balance', sql`${t.available} >= 0 AND ${t.reserved} >= 0`)]);
export const subscriptions = sqliteTable('subscriptions', {
  userId: text('user_id').primaryKey(), status: text('status').notNull(), providerId: text('provider_id'),
  periodEnd: integer('period_end'), cancelAtEnd: integer('cancel_at_end', { mode: 'boolean' }).default(false),
  // Tier that unlocks features (Trial | Creator | Studio | Business). Null = approved before tiers existed.
  plan: text('plan'),
});
export const jobs = sqliteTable('generation_jobs', {
  id: text('id').primaryKey(), userId: text('user_id').notNull(), text: text('script').notNull(), voiceId: text('voice_id').notNull(),
  model: text('model').notNull().default('eleven_v4'), status: text('status').notNull().default('queued'),
  cost: integer('cost').notNull(), idempotency: text('idempotency').notNull(),
  createdAt: integer('created_at').notNull(), leaseUntil: integer('lease_until'),
  storageKey: text('storage_key'), error: text('error'), providerRequestId: text('provider_request_id'),
  durationMs: integer('duration_ms'), actualCost: integer('actual_cost'),
  // Credit pool that funded the reservation: 'web' (30-day manual plans) or 'apple' (non-expiring IAP credits).
  pool: text('credit_pool').notNull().default('web'),
}, t => [uniqueIndex('job_idempotency').on(t.userId, t.idempotency)]);
export const ledger = sqliteTable('credit_ledger', {
  id: text('id').primaryKey(), userId: text('user_id').notNull(), key: text('operation_key').notNull().unique(),
  type: text('type').notNull(), availableDelta: integer('available_delta').notNull(), reservedDelta: integer('reserved_delta').notNull(),
  jobId: text('job_id'), createdAt: integer('created_at').notNull(),
  pool: text('credit_pool').notNull().default('web'),
});

export const payments = sqliteTable('manual_payment_approvals', {
  id: text('id').primaryKey(), reference: text('reference').notNull().unique(),
  userId: text('user_id').notNull(), ownerId: text('owner_id').notNull(),
  plan: text('plan').notNull(), method: text('method').notNull(),
  amount: integer('amount_mmk').notNull(), credits: integer('credits').notNull(),
  approvedAt: integer('approved_at').notNull(), periodEnd: integer('period_end').notNull(),
});
export const ownerAttempts = sqliteTable('owner_approval_attempts', {
  id: text('id').primaryKey(), createdAt: integer('created_at').notNull(),
});
export const workerHealth = sqliteTable('generation_worker_health', {
  id: text('id').primaryKey(), heartbeatAt: integer('heartbeat_at').notNull(),
});
export const orders = sqliteTable('manual_payment_orders', {
  id: text('id').primaryKey(), userId: text('user_id').notNull(),
  plan: text('plan').notNull(), amount: integer('amount_mmk').notNull(),
  credits: integer('credits').notNull(), currency: text('currency').notNull().default('MMK'),
  status: text('status').notNull().default('pending_payment'),
  reference: text('reference'), method: text('method').notNull().default('KBZPay'),
  createdAt: integer('created_at').notNull(), submittedAt: integer('submitted_at'),
  reviewedAt: integer('reviewed_at'), reviewedBy: text('reviewed_by'),
  rejectionReason: text('rejection_reason'), approvalId: text('approval_id'),
  // Prepaid months (1, 3 or 6); 0 for credit top-ups, which never extend access.
  months: integer('months').notNull().default(1),
}, t => [uniqueIndex('one_open_order_per_plan').on(t.userId, t.plan).where(sql`${t.status} IN ('pending_payment', 'pending_review')`)]);

/** Apple In-App Purchase credits: never expire, kept separate so they never extend web plan access. */
export const appleCredits = sqliteTable('apple_credit_accounts', {
  userId: text('user_id').primaryKey(), available: integer('available').notNull().default(0), reserved: integer('reserved').notNull().default(0),
}, t => [check('nonnegative_apple_balance', sql`${t.available} >= 0 AND ${t.reserved} >= 0`)]);
/** Stable per-user UUID passed to StoreKit as appAccountToken and checked on every signed transaction. */
export const appleAccountTokens = sqliteTable('apple_account_tokens', {
  userId: text('user_id').primaryKey(), token: text('token').notNull().unique(), createdAt: integer('created_at').notNull(),
});
export const appleTransactions = sqliteTable('apple_transactions', {
  transactionId: text('transaction_id').primaryKey(), originalTransactionId: text('original_transaction_id'),
  userId: text('user_id').notNull(), productId: text('product_id').notNull(), credits: integer('credits').notNull(),
  environment: text('environment').notNull(), status: text('status').notNull().default('granted'),
  purchasedAt: integer('purchased_at'), grantedAt: integer('granted_at').notNull(),
  revokedAt: integer('revoked_at'), revokedCredits: integer('revoked_credits'), shortfall: integer('shortfall'),
});
export const appleNotifications = sqliteTable('apple_notifications', {
  id: text('notification_uuid').primaryKey(), type: text('type').notNull(), transactionId: text('transaction_id'), receivedAt: integer('received_at').notNull(),
});

/**
 * Video jobs. kind 'narrated' = TTS narration + background image + burned-in captions (ffmpeg).
 * kind 'recap' = the creator's own clip + Burmese voiceover + burned-in captions, 9:16.
 * image_key holds the uploaded source (background image or recap clip) for both kinds.
 * Reservations and settlement mirror generation_jobs and share credit_ledger (job_id = video job id).
 */
export const videoJobs = sqliteTable('video_jobs', {
  id: text('id').primaryKey(), userId: text('user_id').notNull(), kind: text('kind').notNull().default('narrated'),
  text: text('script').notNull(), voiceId: text('voice_id').notNull(), model: text('model').notNull().default('eleven_v4'),
  shape: text('shape').notNull(), imageKey: text('image_key'), status: text('status').notNull().default('queued'),
  cost: integer('cost').notNull(), idempotency: text('idempotency').notNull(), createdAt: integer('created_at').notNull(),
  leaseUntil: integer('lease_until'), audioKey: text('audio_key'), storageKey: text('storage_key'), error: text('error'),
  providerRequestId: text('provider_request_id'), durationMs: integer('duration_ms'), actualCost: integer('actual_cost'),
  pool: text('credit_pool').notNull().default('web'), purgedAt: integer('purged_at'),
  // Tier features frozen at creation: Creator/Trial watermark, Business priority queue.
  watermark: integer('watermark', { mode: 'boolean' }).notNull().default(false),
  priority: integer('priority').notNull().default(0),
  // Recap options JSON ({ audio: 'duck'|'replace', framing: 'fit'|'fill' }); caption file key.
  options: text('options'), srtKey: text('srt_key'),
}, t => [uniqueIndex('video_job_idempotency').on(t.userId, t.idempotency)]);

/**
 * Instant voice clones of the account holder's own voice (Studio: 1 slot, Business: 3).
 * status: active | paused (plan lapsed; deleted at the provider after 30 days) | deleted | rejected.
 * provider_voice_id is never listed publicly; only the owner can narrate with it.
 */
export const voiceClones = sqliteTable('voice_clones', {
  id: text('id').primaryKey(), userId: text('user_id').notNull(), name: text('name').notNull(),
  providerVoiceId: text('provider_voice_id'), status: text('status').notNull(),
  consentText: text('consent_text').notNull(), transcript: text('transcript'), consentScore: integer('consent_score'),
  sampleKey: text('sample_key'), error: text('error'), createdAt: integer('created_at').notNull(),
  pausedAt: integer('paused_at'), deletedAt: integer('deleted_at'),
}, t => [uniqueIndex('voice_clone_provider').on(t.providerVoiceId)]);
