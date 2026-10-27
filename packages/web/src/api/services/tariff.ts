/** Credits per measured second. Narration: 1. Narrated video: 2 (voice + render, captions, storage). Approved 22 Oct 2026. */
export const AUDIO_RATE = 1;
export const NARRATED_VIDEO_RATE = 2;

/** User-authorized ceiling. Overruns are absorbed by the service, never silently charged. */
export function durationCharge(durationSeconds: number, reservation: number, rate: number) {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) throw new Error('Invalid audio duration');
  if (!Number.isSafeInteger(reservation) || reservation <= 0) throw new Error('Invalid credit reservation');
  const measured = Math.ceil(durationSeconds) * rate;
  return { durationMs: Math.round(durationSeconds * 1000), actualCost: Math.min(measured, reservation), refund: Math.max(0, reservation - measured), overrun: measured > reservation };
}
export const audioCharge = (durationSeconds: number, reservation: number) => durationCharge(durationSeconds, reservation, AUDIO_RATE);
export const videoCharge = (durationSeconds: number, reservation: number) => durationCharge(durationSeconds, reservation, NARRATED_VIDEO_RATE);
