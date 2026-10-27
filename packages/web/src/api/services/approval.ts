import { ORPCError } from '@orpc/server';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '../database';
import { accounts, ledger, orders, payments, subscriptions, user, voiceClones } from '../database/schema';
import { normalizeReference } from './payment-orders';
import { carryOver, DAY_MS, tiers, isTopup, quote, tierFor, type OrderPlan, type PlanName } from './plans';

type Input = { customerEmail: string; plan: OrderPlan; method: 'KBZPay' | 'KBZ Bank'; reference: string; orderId?: string; ownerId: string };

/**
 * Owner-verified KBZPay/KBZ Bank grant. With an order, the amount, credits and months stored on the
 * order are granted exactly as quoted (orders created under older prices keep their old credits).
 * Without an order (direct grant), the current price list applies.
 */
export async function approvePayment(input: Input, now = Date.now()) {
  const reference = normalizeReference(input.reference);
  return db.transaction(async tx => {
    const [customer] = await tx.select().from(user).where(eq(user.email, input.customerEmail.trim().toLowerCase()));
    if (!customer) throw new ORPCError('NOT_FOUND', { message: 'Customer must create an account before approval.' });
    const [order] = input.orderId ? await tx.select().from(orders).where(eq(orders.id, input.orderId)) : [];
    if (input.orderId && (!order || order.userId !== customer.id || order.plan !== input.plan || order.currency !== 'MMK' || order.reference !== reference || order.method !== input.method || !['pending_review', 'approved'].includes(order.status) || !(order.amount > 0) || !(order.credits > 0)))
      throw new ORPCError('CONFLICT', { message: 'Order details do not match the submitted transfer.' });
    const terms = order ? { amount: order.amount, credits: order.credits, months: isTopup(order.plan) ? 0 : Math.max(1, order.months) } : quote(input.plan, 1);
    const [existing] = await tx.select().from(payments).where(eq(payments.reference, reference));
    if (existing) {
      if (existing.userId !== customer.id || existing.plan !== input.plan || existing.method !== input.method) throw new ORPCError('CONFLICT', { message: 'This transfer reference was already used for a different customer, method or plan.' });
      if (order && order.approvalId !== existing.id) throw new ORPCError('CONFLICT', { message: 'This transfer was already approved against another order or direct grant.' });
      return { approval: existing, duplicate: true, forfeited: 0 };
    }
    const [current] = await tx.select().from(subscriptions).where(eq(subscriptions.userId, customer.id));
    const access = tierFor(current, now);
    const topup = isTopup(input.plan);
    if (topup && (!access.active || access.name === 'Trial')) throw new ORPCError('PRECONDITION_FAILED', { message: 'Top-ups need an active paid plan. Approve a plan first.' });
    // Each paid period runs from verification (or stacks on the current one). Top-ups never add days.
    const periodEnd = topup ? current!.periodEnd! : Math.max(now, current?.periodEnd ?? 0) + terms.months * 30 * DAY_MS;
    const approval = { id: crypto.randomUUID(), reference, userId: customer.id, ownerId: input.ownerId, plan: input.plan, method: input.method, amount: terms.amount, credits: terms.credits, approvedAt: now, periodEnd };
    await tx.insert(payments).values(approval);
    if (order) {
      const updated = await tx.update(orders).set({ status: 'approved', approvalId: approval.id, reviewedBy: input.ownerId, reviewedAt: now }).where(and(eq(orders.id, order.id), eq(orders.status, 'pending_review'))).returning();
      if (!updated.length) throw new ORPCError('CONFLICT', { message: 'Order has already been reviewed.' });
    }
    // Rollover: unused credits beyond the carry-over share are forfeited at a new plan period.
    let forfeited = 0;
    const [balance] = await tx.select().from(accounts).where(eq(accounts.userId, customer.id));
    if (!topup && balance?.available) {
      forfeited = balance.available - carryOver(current, balance.available, input.plan as PlanName, now);
      if (forfeited > 0) {
        await tx.update(accounts).set({ available: sql`${accounts.available} - ${forfeited}` }).where(eq(accounts.userId, customer.id));
        await tx.insert(ledger).values({ id: crypto.randomUUID(), userId: customer.id, key: `expire:${approval.id}`, type: 'period_expiry', availableDelta: -forfeited, reservedDelta: 0, createdAt: now });
      }
    }
    await tx.insert(accounts).values({ userId: customer.id, available: terms.credits, reserved: 0 }).onConflictDoUpdate({ target: accounts.userId, set: { available: sql`${accounts.available} + ${terms.credits}` } });
    const plan = topup ? current!.plan : input.plan;
    await tx.insert(subscriptions).values({ userId: customer.id, status: 'active', providerId: 'manual', periodEnd, cancelAtEnd: true, plan }).onConflictDoUpdate({ target: subscriptions.userId, set: { status: 'active', providerId: 'manual', periodEnd, cancelAtEnd: true, plan } });
    await tx.insert(ledger).values({ id: crypto.randomUUID(), userId: customer.id, key: `payment:${approval.id}`, type: topup ? 'topup_grant' : 'manual_payment_grant', availableDelta: terms.credits, reservedDelta: 0, createdAt: now });
    // A renewed Studio/Business plan wakes paused clones (within the 30-day grace period).
    if (!topup && tiers[input.plan as PlanName].cloneSlots > 0) await tx.update(voiceClones).set({ status: 'active', pausedAt: null }).where(and(eq(voiceClones.userId, customer.id), eq(voiceClones.status, 'paused')));
    return { approval, duplicate: false, forfeited };
  });
}
