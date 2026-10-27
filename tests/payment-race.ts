// Separate database connection for isolated approval contention testing only.
import { spyOn } from 'bun:test';
import { auth } from '../packages/web/src/api/auth';
import { owner } from '../packages/web/src/api/routes/owner';
import { call } from '../packages/web/node_modules/@orpc/server/dist/index.mjs';
spyOn(auth.api, 'getSession').mockImplementation(async () => ({ user: { id: 'owner', email: 'pyaiphyopie@gmail.com' } }) as never);
try {
  const result = await call(owner.approve, { secret: process.env.OWNER_APPROVAL_SECRET!, orderId: process.argv[2], reference: 'RACE001', customerEmail: 'customer@example.invalid', plan: 'Creator', method: 'KBZPay', settlementVerified: true }, { context: { headers: new Headers() } });
  console.log(JSON.stringify({ success: true, duplicate: result.duplicate }));
} catch {
  console.log(JSON.stringify({ success: false }));
}