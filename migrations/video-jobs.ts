// Additive migration: never db:push production. Afterwards run packages/web/scripts/check-schema.ts.
import { createClient } from '@libsql/client';
const client = createClient({ url: process.env.DATABASE_URL!, authToken: process.env.DATABASE_AUTH_TOKEN });
await client.batch([
  `CREATE TABLE IF NOT EXISTS video_jobs (
    id TEXT PRIMARY KEY NOT NULL, user_id TEXT NOT NULL, kind TEXT DEFAULT 'narrated' NOT NULL, script TEXT NOT NULL,
    voice_id TEXT NOT NULL, model TEXT DEFAULT 'eleven_v4' NOT NULL, shape TEXT NOT NULL, image_key TEXT,
    status TEXT DEFAULT 'queued' NOT NULL, cost INTEGER NOT NULL, idempotency TEXT NOT NULL, created_at INTEGER NOT NULL,
    lease_until INTEGER, audio_key TEXT, storage_key TEXT, error TEXT, provider_request_id TEXT, duration_ms INTEGER,
    actual_cost INTEGER, credit_pool TEXT DEFAULT 'web' NOT NULL, purged_at INTEGER)`,
  'CREATE UNIQUE INDEX IF NOT EXISTS video_job_idempotency ON video_jobs (user_id, idempotency)',
], 'write');
console.log('video_jobs schema verified.');
client.close();
