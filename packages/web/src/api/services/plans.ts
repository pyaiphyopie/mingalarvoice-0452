/**
 * Plan catalog — single source of truth for prices, credits and tier features.
 * 1 credit = 1 second of narration audio; narrated/recap video = 2 credits per output second.
 *
 * Balance check (worst case: every credit spent as audio at 4.4 MMK/s, i.e. 4.0 MMK/s provider
 * cost + 10% FX/overrun buffer, plus ~2,450 MMK/month per cloned-voice slot):
 *   Creator   25,000 MMK /  2,400 cr = 10.42 MMK/cr → margin ≈ 58%
 *   Studio    59,000 MMK /  6,000 cr =  9.83 MMK/cr → margin ≈ 51% (1 clone slot)
 *   Business 122,000 MMK / 12,600 cr =  9.68 MMK/cr → margin ≈ 49% (3 clone slots)
 * Price per credit still falls with each tier, so upgrading is always the better deal.
 */
export type PlanName = 'Creator' | 'Studio' | 'Business';
export type TierName = PlanName | 'Trial';
export type TopupName = 'Topup1000' | 'Topup2500';
export type OrderPlan = PlanName | TopupName;

export type Tier = {
  amount: number; credits: number; cloneSlots: number; maxVideoSeconds: number;
  watermark: boolean; rollover: number; priority: number;
};
export const tiers: Record<TierName, Tier> = {
  Trial: { amount: 0, credits: 180, cloneSlots: 0, maxVideoSeconds: 180, watermark: true, rollover: 0, priority: 0 },
  Creator: { amount: 25000, credits: 2400, cloneSlots: 0, maxVideoSeconds: 180, watermark: true, rollover: 0, priority: 0 },
  Studio: { amount: 59000, credits: 6000, cloneSlots: 1, maxVideoSeconds: 600, watermark: false, rollover: 0.5, priority: 0 },
  Business: { amount: 122000, credits: 12600, cloneSlots: 3, maxVideoSeconds: 1200, watermark: false, rollover: 0.5, priority: 1 },
};
export const PLAN_NAMES = ['Creator', 'Studio', 'Business'] as const;
export const TOPUP_NAMES = ['Topup1000', 'Topup2500'] as const;
export const ORDER_PLANS = [...PLAN_NAMES, ...TOPUP_NAMES] as const;

/** Top-ups: subscribers only, 12 MMK per credit, no extra days. */
export const TOPUP_RATE = 12;
export const topups: Record<TopupName, { credits: number; amount: number }> = {
  Topup1000: { credits: 1000, amount: 1000 * TOPUP_RATE },
  Topup2500: { credits: 2500, amount: 2500 * TOPUP_RATE },
};

/** Prepay: 1, 3 or 6 months paid at once. All months' credits are granted on approval. */
export const PREPAY_DISCOUNT: Record<number, number> = { 1: 0, 3: 0.1, 6: 0.15 };
export const TRIAL_CREDITS = tiers.Trial.credits;
export const TRIAL_DAYS = 14;
/** A lapsed clone is paused (unusable) for this long, then deleted from the provider. */
export const CLONE_GRACE_MS = 30 * 86400000;
export const DAY_MS = 86400000;

export const isTopup = (plan: string): plan is TopupName => (TOPUP_NAMES as readonly string[]).includes(plan);
export const isPlan = (plan: string): plan is PlanName => (PLAN_NAMES as readonly string[]).includes(plan);

/** Price in MMK, rounded to the nearest 100 after the prepay discount. */
export function quote(plan: OrderPlan, months = 1) {
  if (isTopup(plan)) return { amount: topups[plan].amount, credits: topups[plan].credits, months: 0 };
  const discount = PREPAY_DISCOUNT[months];
  if (discount === undefined) throw new Error('Unsupported prepay length');
  const t = tiers[plan];
  return { amount: Math.round((t.amount * months * (1 - discount)) / 100) * 100, credits: t.credits * months, months };
}

/** Features for the caller's current access. Lapsed or missing plans fall back to "none". */
export function tierFor(sub: { status: string; periodEnd: number | null; plan?: string | null } | undefined | null, now = Date.now()) {
  const active = sub?.status === 'active' && !!sub.periodEnd && sub.periodEnd > now;
  // Pre-tier subscriptions (approved before plans were recorded) behave like Studio.
  const name = (active ? (sub!.plan ?? 'Studio') : null) as TierName | null;
  return { active, name, tier: name && name in tiers ? tiers[name] : null };
}

const rank: Record<TierName, number> = { Trial: 0, Creator: 1, Studio: 2, Business: 3 };
/**
 * Unused credits kept when a new plan period is approved:
 *  - lapsed (renewed late) or no plan: none are kept;
 *  - upgrade while active (e.g. Trial→Creator, Creator→Studio): all are kept;
 *  - on-time renewal/downgrade: the current plan's rollover share (Studio/Business 50%, Creator 0%).
 */
export function carryOver(current: { plan?: string | null; periodEnd: number | null; status: string } | undefined | null, available: number, next: PlanName, now = Date.now()) {
  if (available <= 0 || !current || current.status !== 'active' || !current.periodEnd || current.periodEnd <= now) return 0;
  const name = (current.plan ?? 'Studio') as TierName;
  const t = tiers[name];
  if (!t) return 0;
  if (rank[next] > rank[name]) return available;
  return Math.floor(available * t.rollover);
}
