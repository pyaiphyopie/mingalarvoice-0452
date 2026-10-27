import { createClient } from '@libsql/client';
const client = createClient({ url: process.env.DATABASE_URL!, authToken: process.env.DATABASE_AUTH_TOKEN });
await client.execute(`CREATE TABLE IF NOT EXISTS manual_payment_orders (
 id TEXT PRIMARY KEY NOT NULL, user_id TEXT NOT NULL, plan TEXT NOT NULL,
 amount_mmk INTEGER NOT NULL, credits INTEGER NOT NULL, currency TEXT NOT NULL DEFAULT 'MMK',
 status TEXT NOT NULL DEFAULT 'pending_payment', reference TEXT, method TEXT NOT NULL DEFAULT 'KBZPay',
 created_at INTEGER NOT NULL, submitted_at INTEGER, reviewed_at INTEGER, reviewed_by TEXT,
 rejection_reason TEXT, approval_id TEXT)`);
const result = await client.execute('PRAGMA table_info(manual_payment_orders)');
if (result.rows.length !== 15) throw new Error('Order migration verification failed');
await client.execute("CREATE UNIQUE INDEX IF NOT EXISTS one_open_order_per_plan ON manual_payment_orders(user_id, plan) WHERE status IN ('pending_payment', 'pending_review')");
console.log('Pending order schema verified.');
client.close();