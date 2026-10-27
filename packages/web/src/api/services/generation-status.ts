import { db } from '../database';
import { workerHealth } from '../database/schema';

export async function generationReady() {
  if (process.env.GENERATION_TARIFF_APPROVED !== 'true') return false;
  if (!['ELEVENLABS_API_KEY', 'S3_ENDPOINT', 'S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'].every(key => !!process.env[key])) return false;
  const [health] = await db.select().from(workerHealth);
  return !!health && Date.now() - health.heartbeatAt < 60000;
}

export async function heartbeat() {
  await db.insert(workerHealth).values({ id: 'primary', heartbeatAt: Date.now() }).onConflictDoUpdate({ target: workerHealth.id, set: { heartbeatAt: Date.now() } });
}