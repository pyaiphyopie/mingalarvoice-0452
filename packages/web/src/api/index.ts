import type { RouterClient } from "@orpc/server";
import { createApp } from "./__core/app";
import { ping } from "./routes/ping";
import { studio } from './routes/studio';
import { auth } from './auth';
import { owner } from './routes/owner';
import { paymentOrders } from './routes/payment-orders';
import { apple } from './routes/apple';
import { account } from './routes/account';
import { video } from './routes/video';
import { trial } from './routes/trial';
import { clones } from './routes/clones';
import { appleWebhook } from './services/apple';

// API features are oRPC procedures, one file per feature in ./routes/,
// composed into this router — typed end-to-end via the clients
// (web: src/web/lib/api.ts, mobile: lib/api.ts).
// Keep each routes/ file under 500 lines (`bun run lint` enforces this);
// split into more feature files as they grow.
// Patterns and examples: skills/app/references/api.md
export const router = {
  ping,
  studio,
  owner,
  paymentOrders,
  apple,
  account,
  video,
  trial,
  clones,
};

export type AppRouter = typeof router;
/** Typed client for the router — used by the web and mobile api clients. */
export type AppRouterClient = RouterClient<AppRouter>;

const app = createApp(router);
app.on(['GET', 'POST'], '/api/auth/*', c => auth.handler(c.req.raw));
// App Store Server Notifications V2 (refunds/revocations). Fails closed until Apple is configured.
app.post('/api/webhooks/apple', async c => {
  const outcome = await appleWebhook(await c.req.json().catch(() => null));
  return c.json(outcome.body, outcome.status);
});
// Rare plain-HTTP endpoints (webhooks, streaming, the Better Auth handler)
// register here with full paths, e.g. app.post("/api/webhooks/example", ...)

export default app;
