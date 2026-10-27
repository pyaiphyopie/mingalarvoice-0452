import { ORPCError } from '@orpc/server';
import { and, eq, inArray } from 'drizzle-orm';
import { db } from '../database';
import { orders, subscriptions } from '../database/schema';
import { isTopup, quote, tierFor, type OrderPlan } from './plans';

export function normalizeReference(value: string) {
  const reference = value.trim().toUpperCase().replace(/\s+/g, '');
  if (!/^[A-Z0-9_./-]{6,100}$/.test(reference)) throw new ORPCError('BAD_REQUEST', { message: 'Enter a valid transaction reference (6–100 characters). Never enter a PIN or OTP.' });
  return reference;
}
export async function createOrder(userId: string, planName: OrderPlan, months = 1) {
  if (isTopup(planName)) {
    const [sub] = await db.select().from(subscriptions).where(eq(subscriptions.userId, userId));
    const access = tierFor(sub);
    if (!access.active || access.name === 'Trial') throw new ORPCError('PRECONDITION_FAILED', { message: 'Top-ups are for active Creator, Studio and Business subscribers.' });
  }
  // Price and credits are frozen on the order; approval grants exactly what the customer was quoted.
  const plan = quote(planName, months);
  // The partial unique index is the arbiter, including across server instances.
  const [created] = await db.insert(orders).values({ id: crypto.randomUUID(), userId, plan: planName, amount: plan.amount, credits: plan.credits, months: plan.months, createdAt: Date.now() }).onConflictDoNothing().returning();
  if (created) return created;
  const [existing] = await db.select().from(orders).where(and(eq(orders.userId, userId), eq(orders.plan, planName), inArray(orders.status, ['pending_payment', 'pending_review'])));
  if (!existing) throw new ORPCError('CONFLICT', { message: 'Order was just reviewed. Try creating a new order.' });
  // An unpaid order can switch prepay length; a submitted one is frozen for the owner's review.
  if (existing.status === 'pending_payment' && (existing.months !== plan.months || existing.amount !== plan.amount || existing.credits !== plan.credits)) {
    const [updated] = await db.update(orders).set({ amount: plan.amount, credits: plan.credits, months: plan.months }).where(and(eq(orders.id, existing.id), eq(orders.status, 'pending_payment'))).returning();
    if (updated) return updated;
  }
  return existing;
}
export async function submitOrder(userId: string, id: string, rawReference: string) {
  const reference = normalizeReference(rawReference);
  return db.transaction(async tx => {
    const [order] = await tx.select().from(orders).where(and(eq(orders.id, id), eq(orders.userId, userId)));
    if (!order) throw new ORPCError('NOT_FOUND');
    if (order.status === 'pending_review' && order.reference === reference) return order;
    if (order.status !== 'pending_payment') throw new ORPCError('CONFLICT', { message: 'This order has already been submitted or reviewed. Contact the owner for corrections.' });
    const [updated] = await tx.update(orders).set({ reference, status: 'pending_review', submittedAt: Date.now() }).where(and(eq(orders.id, id), eq(orders.status, 'pending_payment'))).returning();
    if (!updated) throw new ORPCError('CONFLICT');
    return updated;
  });
}