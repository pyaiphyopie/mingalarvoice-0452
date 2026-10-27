import { timingSafeEqual, createHash } from 'node:crypto';
import { ORPCError } from '@orpc/server';
import { gte } from 'drizzle-orm';
import { db } from '../database';
import { ownerAttempts } from '../database/schema';

export const OWNER_EMAIL = 'pyaiphyopie@gmail.com';
export function ownerConfigured() { return (process.env.OWNER_APPROVAL_SECRET?.length ?? 0) >= 20; }
export function secretMatches(value: string) {
  if (!ownerConfigured()) return false;
  const hash = (s: string) => createHash('sha256').update(s).digest();
  return timingSafeEqual(hash(value), hash(process.env.OWNER_APPROVAL_SECRET!));
}
export async function authorizeOwner(email: string, secret: string) {
  if (email.toLowerCase() !== OWNER_EMAIL || !ownerConfigured()) throw new ORPCError('FORBIDDEN');
  // Persistent global throttle on FAILED passphrase attempts (new sessions or network addresses
  // cannot bypass it). Correct-passphrase actions are not counted, so reviewing a long queue of
  // orders never locks the owner out; once 10 failures accumulate, even the right passphrase waits.
  const outcome = await db.transaction(async tx => {
    const recent = await tx.select().from(ownerAttempts).where(gte(ownerAttempts.createdAt, Date.now() - 15 * 60000));
    if (recent.length >= 10) return 'throttled' as const;
    if (secretMatches(secret)) return 'ok' as const;
    await tx.insert(ownerAttempts).values({ id: crypto.randomUUID(), createdAt: Date.now() });
    return 'wrong' as const;
  });
  if (outcome === 'throttled') throw new ORPCError('TOO_MANY_REQUESTS', { message: 'Too many wrong passphrase attempts. Try again in 15 minutes.' });
  if (outcome === 'wrong') throw new ORPCError('FORBIDDEN', { message: 'Invalid owner approval credentials.' });
}