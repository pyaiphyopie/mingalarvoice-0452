import { createClient } from '@libsql/client';
const client = createClient({ url: process.env.DATABASE_URL!, authToken: process.env.DATABASE_AUTH_TOKEN });
await client.execute('CREATE TABLE IF NOT EXISTS generation_worker_health (id TEXT PRIMARY KEY NOT NULL, heartbeat_at INTEGER NOT NULL)');
console.log('Generation worker health schema verified.');
client.close();