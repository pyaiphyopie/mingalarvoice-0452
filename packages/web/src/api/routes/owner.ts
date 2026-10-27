import { z } from 'zod';
import { ORPCError } from '@orpc/server';
import { and, eq, desc } from 'drizzle-orm';
import { authed } from '../middleware/auth';
import { db } from '../database';
import { payments, user, orders } from '../database/schema';
import { authorizeOwner, OWNER_EMAIL, ownerConfigured } from '../services/owner';
import { approvePayment } from '../services/approval';
import { ORDER_PLANS } from '../services/plans';
export const owner = {
  pendingOrders: authed.input(z.object({ secret: z.string().max(512) })).handler(async ({ context, input }) => {
    await authorizeOwner(context.user.email, input.secret);
    return db.select({ order: orders, customerEmail: user.email }).from(orders).innerJoin(user, eq(orders.userId, user.id)).where(eq(orders.status, 'pending_review')).orderBy(desc(orders.submittedAt)).limit(100);
  }),
  rejectOrder: authed.input(z.object({ secret: z.string().max(512), id: z.string().uuid(), reason: z.string().trim().min(5).max(500) })).handler(async ({ context, input }) => {
    await authorizeOwner(context.user.email, input.secret);
    const [order] = await db.update(orders).set({ status: 'rejected', rejectionReason: input.reason, reviewedBy: context.user.id, reviewedAt: Date.now() }).where(and(eq(orders.id, input.id), eq(orders.status, 'pending_review'))).returning();
    if (!order) throw new ORPCError('CONFLICT', { message: 'Order is no longer awaiting review.' });
    return order;
  }),
  status: authed.handler(({ context }) => ({
    eligible: context.user.email.toLowerCase() === OWNER_EMAIL && ownerConfigured(),
  })),
  approvals: authed.input(z.object({ secret: z.string().max(512) })).handler(async ({ context, input }) => {
    await authorizeOwner(context.user.email, input.secret);
    return db.select().from(payments).orderBy(desc(payments.approvedAt)).limit(100);
  }),
  approve: authed.input(z.object({
    secret: z.string().min(20).max(512),
    customerEmail: z.string().email().max(254),
    plan: z.enum(ORDER_PLANS),
    method: z.enum(['KBZPay', 'KBZ Bank']),
    reference: z.string().trim().min(6).max(100).regex(/^[a-zA-Z0-9 _./-]+$/),
    settlementVerified: z.literal(true),
    orderId: z.string().uuid().optional(),
  })).handler(async ({ context, input }) => {
    await authorizeOwner(context.user.email, input.secret);
    return approvePayment({ ...input, ownerId: context.user.id });
  }),
};