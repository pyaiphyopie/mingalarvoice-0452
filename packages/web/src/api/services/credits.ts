import { ORPCError } from '@orpc/server';
import { and, eq, gte, sql } from 'drizzle-orm';
import { db } from '../database';
import { accounts, appleCredits, subscriptions } from '../database/schema';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Moves `cost` from available to reserved inside the caller's transaction.
 * Active 30-day plan credits first, then non-expiring Apple credits (same order as narration).
 */
export async function reserveCredits(tx: Tx, userId: string, cost: number): Promise<'web' | 'apple'> {
  const [sub] = await tx.select().from(subscriptions).where(eq(subscriptions.userId, userId));
  const planActive = sub?.status === 'active' && !!sub.periodEnd && sub.periodEnd > Date.now();
  if (planActive) {
    const updated = await tx.update(accounts).set({ available: sql`${accounts.available} - ${cost}`, reserved: sql`${accounts.reserved} + ${cost}` })
      .where(and(eq(accounts.userId, userId), gte(accounts.available, cost))).returning();
    if (updated.length) return 'web';
  }
  const updated = await tx.update(appleCredits).set({ available: sql`${appleCredits.available} - ${cost}`, reserved: sql`${appleCredits.reserved} + ${cost}` })
    .where(and(eq(appleCredits.userId, userId), gte(appleCredits.available, cost))).returning();
  if (updated.length) return 'apple';
  const [apple] = await tx.select().from(appleCredits).where(eq(appleCredits.userId, userId));
  if (!planActive && !(apple?.available ?? 0))
    throw new ORPCError('PRECONDITION_FAILED', { message: 'An active plan is required to generate.' });
  throw new ORPCError('PRECONDITION_FAILED', { message: 'Not enough credits for the selected maximum reservation.' });
}
