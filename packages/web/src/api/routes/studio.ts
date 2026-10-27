import { z } from "zod";
import { ORPCError } from "@orpc/server";
import { and, eq, desc, gte, sql } from "drizzle-orm";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { base } from "../__core/app";
import { authed } from "../middleware/auth";
import { db } from "../database";
import {
  accounts,
  appleCredits,
  favorites,
  jobs,
  ledger,
  subscriptions,
} from "../database/schema";
import { catalog, normalizedScript } from "../services/speech";
import { generationReady } from '../services/generation-status';
import { assertVoiceAllowed } from '../services/clones';
import { tierFor } from '../services/plans';

const input = z.object({
  text: z.string(),
  voiceId: z.string().min(1),
  idempotency: z.string().uuid(),
  maxCredits: z.number().int().min(1).max(600),
});
export const studio = {
  catalog: base.handler(catalog),
  favorites: authed.handler(({ context }) =>
    db.select().from(favorites).where(eq(favorites.userId, context.user.id)),
  ),
  favorite: authed
    .input(z.object({ voiceId: z.string(), saved: z.boolean() }))
    .handler(async ({ context, input }) => {
      if (!(await catalog()).voices.some((v) => v.voice_id === input.voiceId))
        throw new ORPCError("BAD_REQUEST");
      if (input.saved)
        await db
          .insert(favorites)
          .values({
            id: crypto.randomUUID(),
            userId: context.user.id,
            voiceId: input.voiceId,
          })
          .onConflictDoNothing();
      else
        await db
          .delete(favorites)
          .where(
            and(
              eq(favorites.userId, context.user.id),
              eq(favorites.voiceId, input.voiceId),
            ),
          );
      return { saved: input.saved };
    }),
  wallet: authed.handler(async ({ context }) => {
    const [account] = await db
      .select()
      .from(accounts)
      .where(eq(accounts.userId, context.user.id));
    const [subscription] = await db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.userId, context.user.id));
    const [apple] = await db
      .select()
      .from(appleCredits)
      .where(eq(appleCredits.userId, context.user.id));
    const entries = await db
      .select()
      .from(ledger)
      .where(eq(ledger.userId, context.user.id))
      .orderBy(desc(ledger.createdAt))
      .limit(50);
    return {
      available: account?.available ?? 0,
      reserved: account?.reserved ?? 0,
      subscription: subscription ?? null,
      plan: tierFor(subscription),
      apple: { available: apple?.available ?? 0, reserved: apple?.reserved ?? 0 },
      entries,
      billingReady: true,
      generationReady: await generationReady(),
    };
  }),
  history: authed.handler(({ context }) =>
    db
      .select()
      .from(jobs)
      .where(eq(jobs.userId, context.user.id))
      .orderBy(desc(jobs.createdAt))
      .limit(100),
  ),
  create: authed.input(input).handler(async ({ context, input }) => {
    const text = normalizedScript(input.text);
    const c = await catalog();
    if (!c.models.some((m) => m.model_id === "eleven_v4"))
      throw new ORPCError("BAD_REQUEST", {
        message: "This voice or Burmese model is unavailable.",
      });
    // Public library voices, or the caller's own clone while their plan includes it.
    await assertVoiceAllowed(context.user.id, input.voiceId, c.voices.map((v) => v.voice_id));
    // Tariff must be commercially approved before any real credit reservation/generation.
    if (!(await generationReady()))
      throw new ORPCError("PRECONDITION_FAILED", {
        message:
          "Generation is temporarily unavailable. The worker is offline or generation is paused; no credits were reserved.",
      });
    const cost = input.maxCredits;
    const minimumReservation = Math.max(10, Math.ceil([...text].length / 4));
    if (cost < minimumReservation) throw new ORPCError('BAD_REQUEST', { message: `Reserve at least ${minimumReservation} credits for this script. Unused credits are returned after duration measurement.` });
    return db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(jobs)
        .where(
          and(
            eq(jobs.userId, context.user.id),
            eq(jobs.idempotency, input.idempotency),
          ),
        );
      if (existing) {
        if (existing.text !== text || existing.voiceId !== input.voiceId || existing.cost !== cost)
          throw new ORPCError("CONFLICT", {
            message: "Request key already used for a different script.",
          });
        return existing;
      }
      const [sub] = await tx
        .select()
        .from(subscriptions)
        .where(eq(subscriptions.userId, context.user.id));
      const planActive =
        sub?.status === "active" && !!sub.periodEnd && sub.periodEnd > Date.now();
      // Plan credits (30-day access) are spent first while active; Apple credits never expire
      // but are a separate pool, so they never unlock expired plan credits.
      let pool: "web" | "apple" | null = null;
      if (planActive) {
        const updated = await tx
          .update(accounts)
          .set({
            available: sql`${accounts.available} - ${cost}`,
            reserved: sql`${accounts.reserved} + ${cost}`,
          })
          .where(and(eq(accounts.userId, context.user.id), gte(accounts.available, cost)))
          .returning();
        if (updated.length) pool = "web";
      }
      if (!pool) {
        const updated = await tx
          .update(appleCredits)
          .set({
            available: sql`${appleCredits.available} - ${cost}`,
            reserved: sql`${appleCredits.reserved} + ${cost}`,
          })
          .where(and(eq(appleCredits.userId, context.user.id), gte(appleCredits.available, cost)))
          .returning();
        if (updated.length) pool = "apple";
      }
      if (!pool) {
        const [apple] = await tx.select().from(appleCredits).where(eq(appleCredits.userId, context.user.id));
        if (!planActive && !(apple?.available ?? 0))
          throw new ORPCError("PRECONDITION_FAILED", {
            message: "An active subscription is required, or App Store credits in the iOS app.",
          });
        throw new ORPCError("PRECONDITION_FAILED", {
          message: "Not enough credits for the selected maximum reservation.",
        });
      }
      const id = crypto.randomUUID(),
        now = Date.now();
      await tx
        .insert(ledger)
        .values({
          id: crypto.randomUUID(),
          userId: context.user.id,
          key: `reserve:${id}`,
          type: "reservation",
          availableDelta: -cost,
          reservedDelta: cost,
          jobId: id,
          createdAt: now,
          pool,
        });
      const [job] = await tx
        .insert(jobs)
        .values({
          id,
          userId: context.user.id,
          text,
          voiceId: input.voiceId,
          cost,
          idempotency: input.idempotency,
          createdAt: now,
          pool,
        })
        .returning();
      return job;
    });
  }),
  download: authed
    .input(z.object({ id: z.string() }))
    .handler(async ({ context, input }) => {
      const [job] = await db
        .select()
        .from(jobs)
        .where(and(eq(jobs.id, input.id), eq(jobs.userId, context.user.id)));
      if (
        !job?.storageKey ||
        job.status !== "succeeded" ||
        job.createdAt + 30 * 86400000 < Date.now()
      )
        throw new ORPCError("NOT_FOUND", {
          message: "This audio is unavailable or expired.",
        });
      const s3 = new S3Client({
        region: "auto",
        endpoint: process.env.S3_ENDPOINT,
        credentials: {
          accessKeyId: process.env.S3_ACCESS_KEY_ID!,
          secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!,
        },
      });
      return {
        url: await getSignedUrl(
          s3,
          new GetObjectCommand({
            Bucket: process.env.S3_BUCKET,
            Key: job.storageKey,
          }),
          { expiresIn: 300 },
        ),
      };
    }),
  checkout: authed.handler(() => {
    throw new ORPCError("SERVICE_UNAVAILABLE", {
      message:
        "Payments are manual. Use the Buy button for transfer instructions and contact the owner through Telegram. No payment has been verified by this request.",
    });
  }),
};
