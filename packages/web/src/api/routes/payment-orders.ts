import { z } from 'zod';
import { eq, desc } from 'drizzle-orm';
import { authed } from '../middleware/auth';
import { db } from '../database';
import { orders } from '../database/schema';
import { createOrder, submitOrder } from '../services/payment-orders';
import { base } from '../__core/app';
import { ORDER_PLANS, PLAN_NAMES, PREPAY_DISCOUNT, TOPUP_NAMES, TOPUP_RATE, TRIAL_CREDITS, TRIAL_DAYS, quote, tiers, topups } from '../services/plans';
import { AUDIO_RATE, NARRATED_VIDEO_RATE } from '../services/tariff';

export const paymentOrders = {
  list: authed.handler(({ context }) => db.select().from(orders).where(eq(orders.userId, context.user.id)).orderBy(desc(orders.createdAt)).limit(100)),
  create: authed.input(z.object({ plan: z.enum(ORDER_PLANS), months: z.union([z.literal(1), z.literal(3), z.literal(6)]).default(1) })).handler(({ context, input }) => createOrder(context.user.id, input.plan, input.months)),
  /** Public price list so every client shows the same numbers the server will charge. */
  plans: base.handler(() => ({
    tiers: PLAN_NAMES.map(name => ({ name, ...tiers[name], prepay: [1, 3, 6].map(months => ({ ...quote(name, months), discount: PREPAY_DISCOUNT[months] ?? 0 })) })),
    topups: TOPUP_NAMES.map(name => ({ name, ...topups[name] })),
    trial: { credits: TRIAL_CREDITS, days: TRIAL_DAYS },
    rates: { audio: AUDIO_RATE, video: NARRATED_VIDEO_RATE, topup: TOPUP_RATE },
  })),
  submit: authed.input(z.object({ id: z.string().uuid(), reference: z.string().min(6).max(100) })).handler(({ context, input }) => submitOrder(context.user.id, input.id, input.reference)),
};