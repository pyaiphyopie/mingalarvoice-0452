import { z } from 'zod';
import { desc, eq } from 'drizzle-orm';
import { authed } from '../middleware/auth';
import { db } from '../database';
import { appleTransactions } from '../database/schema';
import { appleAccountToken, appleConfig, appleProducts, redeemAppleTransaction } from '../services/apple';

export const apple = {
  /** Store state for the iOS app. Prices always come from StoreKit on device, never from this server. */
  config: authed.handler(async ({ context }) => {
    const config = appleConfig();
    return {
      enabled: config.enabled,
      products: Object.entries(appleProducts).map(([productId, p]) => ({ productId, credits: p.credits, label: p.label })),
      appAccountToken: config.enabled ? await appleAccountToken(context.user.id) : null,
    };
  }),
  redeem: authed
    .input(z.object({ signedTransaction: z.string().min(20).max(20000) }))
    .handler(({ context, input }) => redeemAppleTransaction(context.user.id, input.signedTransaction)),
  purchases: authed.handler(({ context }) =>
    db.select({ transactionId: appleTransactions.transactionId, productId: appleTransactions.productId, credits: appleTransactions.credits, status: appleTransactions.status, grantedAt: appleTransactions.grantedAt })
      .from(appleTransactions).where(eq(appleTransactions.userId, context.user.id)).orderBy(desc(appleTransactions.grantedAt)).limit(100),
  ),
};
