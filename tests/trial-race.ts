// Separate database connection for trial-claim contention testing only (spawned by tiers.test.ts).
import { spyOn } from 'bun:test';
process.env.DATABASE_URL = process.env.TRIAL_RACE_DB!;
delete process.env.DATABASE_AUTH_TOKEN;
const { auth } = await import('../packages/web/src/api/auth');
const { trial } = await import('../packages/web/src/api/routes/trial');
const { call } = await import('../packages/web/node_modules/@orpc/server/dist/index.mjs');
spyOn(auth.api, 'getSession').mockImplementation(async () => ({ user: { id: 'race', email: 'race@example.invalid', emailVerified: true }, session: {} }) as never);
try {
  await call(trial.claim, undefined, { context: { headers: new Headers() } });
  console.log(JSON.stringify({ success: true }));
} catch (e) {
  console.log(JSON.stringify({ success: false, error: String((e as Error).message) }));
}
