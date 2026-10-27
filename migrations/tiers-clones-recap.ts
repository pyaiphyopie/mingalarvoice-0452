// Additive migration: never db:push production. Afterwards run packages/web/scripts/check-schema.ts.
// Safe to re-run: each ALTER is skipped when the column already exists.
import { createClient } from '@libsql/client';
const client = createClient({ url: process.env.DATABASE_URL!, authToken: process.env.DATABASE_AUTH_TOKEN });
const columns = async (table: string) => new Set((await client.execute(`PRAGMA table_info(${table})`)).rows.map(r => String(r.name)));
const add = [
  ['subscriptions', 'plan', 'ALTER TABLE subscriptions ADD COLUMN plan TEXT'],
  ['manual_payment_orders', 'months', 'ALTER TABLE manual_payment_orders ADD COLUMN months INTEGER DEFAULT 1 NOT NULL'],
  ['video_jobs', 'watermark', 'ALTER TABLE video_jobs ADD COLUMN watermark INTEGER DEFAULT 0 NOT NULL'],
  ['video_jobs', 'priority', 'ALTER TABLE video_jobs ADD COLUMN priority INTEGER DEFAULT 0 NOT NULL'],
  ['video_jobs', 'options', 'ALTER TABLE video_jobs ADD COLUMN options TEXT'],
  ['video_jobs', 'srt_key', 'ALTER TABLE video_jobs ADD COLUMN srt_key TEXT'],
] as const;
for (const [table, column, sql] of add) if (!(await columns(table)).has(column)) { await client.execute(sql); console.log(`added ${table}.${column}`); }
await client.batch([
  `CREATE TABLE IF NOT EXISTS voice_clones (
    id TEXT PRIMARY KEY NOT NULL, user_id TEXT NOT NULL, name TEXT NOT NULL, provider_voice_id TEXT, status TEXT NOT NULL,
    consent_text TEXT NOT NULL, transcript TEXT, consent_score INTEGER, sample_key TEXT, error TEXT, created_at INTEGER NOT NULL,
    paused_at INTEGER, deleted_at INTEGER)`,
  'CREATE UNIQUE INDEX IF NOT EXISTS voice_clone_provider ON voice_clones (provider_voice_id)',
], 'write');
console.log('tiers/clones/recap schema verified.');
client.close();
