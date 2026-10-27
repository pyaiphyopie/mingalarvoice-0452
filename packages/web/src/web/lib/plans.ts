/** Display copy for a tier from the server price list. Numbers always come from the server. */
export type TierInfo = { name: string; credits: number; cloneSlots: number; maxVideoSeconds: number; watermark: boolean; rollover: number; priority: number };
export const tierTagline: Record<string, string> = {
  Creator: 'For your first recaps and everyday narration.',
  Studio: 'For creators posting recaps every day — with your own voice.',
  Business: 'For teams and channels running several pages.',
};
export function tierFeatures(t: TierInfo) {
  return [
    `${t.credits.toLocaleString()} credits / month · about ${Math.round(t.credits / 60)} min of voice`,
    `Recap videos up to ${t.maxVideoSeconds / 60} min, 9:16 with Burmese captions`,
    t.watermark ? 'Small “Mingalar Voice” mark on videos' : 'No watermark',
    t.cloneSlots ? `Clone your own voice · ${t.cloneSlots} voice${t.cloneSlots > 1 ? 's' : ''}` : 'Library voices only',
    t.rollover ? `${Math.round(t.rollover * 100)}% of unused credits roll over when you renew on time` : 'Credits reset each period',
    ...(t.priority ? ['Priority rendering queue'] : []),
    'SRT caption export',
  ];
}
export const planLabel = (name: string, months = 1) =>
  name.startsWith('Topup') ? `Top-up ${Number(name.slice(5)).toLocaleString()} credits` : months > 1 ? `${name} · ${months} months` : name;
