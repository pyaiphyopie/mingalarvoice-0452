import { ORPCError } from '@orpc/server';
import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import { db } from '../database';
import { accounts, ledger, payments, subscriptions } from '../database/schema';
import { DAY_MS, TRIAL_CREDITS, TRIAL_DAYS } from './plans';

/** One trial per email address, ever — the ledger key survives account deletion (it holds only a hash). */
export const trialKey = (email: string) => `trial:${createHash('sha256').update(email.trim().toLowerCase()).digest('hex')}`;

export async function trialStatus(user: { id: string; email: string; emailVerified: boolean }) {
  const [claimed] = await db.select().from(ledger).where(eq(ledger.key, trialKey(user.email)));
  const [sub] = await db.select().from(subscriptions).where(eq(subscriptions.userId, user.id));
  const [paid] = await db.select({ id: payments.id }).from(payments).where(eq(payments.userId, user.id)).limit(1);
  return { verified: !!user.emailVerified, claimed: !!claimed, eligible: !!user.emailVerified && !claimed && !sub && !paid, credits: TRIAL_CREDITS, days: TRIAL_DAYS };
}

export async function claimTrial(user: { id: string; email: string; emailVerified: boolean }, now = Date.now()) {
  if (!user.emailVerified) throw new ORPCError('PRECONDITION_FAILED', { message: 'Verify your email first. The free trial is for verified email addresses only.' });
  return db.transaction(async tx => {
    const key = trialKey(user.email);
    const [claimed] = await tx.select().from(ledger).where(eq(ledger.key, key));
    if (claimed) throw new ORPCError('CONFLICT', { message: 'The free trial was already used for this email address.' });
    const [sub] = await tx.select().from(subscriptions).where(eq(subscriptions.userId, user.id));
    const [paid] = await tx.select({ id: payments.id }).from(payments).where(eq(payments.userId, user.id)).limit(1);
    if (sub || paid) throw new ORPCError('CONFLICT', { message: 'The free trial is for new accounts only.' });
    const periodEnd = now + TRIAL_DAYS * DAY_MS;
    // The unique operation_key makes a concurrent second claim fail and roll back.
    await tx.insert(ledger).values({ id: crypto.randomUUID(), userId: user.id, key, type: 'trial_grant', availableDelta: TRIAL_CREDITS, reservedDelta: 0, createdAt: now });
    await tx.insert(accounts).values({ userId: user.id, available: TRIAL_CREDITS, reserved: 0 }).onConflictDoUpdate({ target: accounts.userId, set: { available: sql`${accounts.available} + ${TRIAL_CREDITS}` } });
    await tx.insert(subscriptions).values({ userId: user.id, status: 'active', providerId: 'trial', periodEnd, cancelAtEnd: true, plan: 'Trial' });
    return { credits: TRIAL_CREDITS, periodEnd };
  });
}
