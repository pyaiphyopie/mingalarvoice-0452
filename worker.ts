import { processOneJob } from './packages/web/src/api/services/worker';
import { processOneVideoJob, videoSwitchOn } from './packages/web/src/api/services/video-worker';
import { heartbeat } from './packages/web/src/api/services/generation-status';
import { purgeExpiredMedia } from './packages/web/src/api/services/retention';
import { sweepClones } from './packages/web/src/api/services/clones';

// Supervised service; one paid dispatch at a time. Uncertain jobs are never retried.
// The 30-day media retention sweep runs even while generation is switched off.
if (!['S3_ENDPOINT', 'S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'].every(key => !!process.env[key])) throw new Error('Worker storage credentials are incomplete');
const generating = process.env.GENERATION_TARIFF_APPROVED === 'true';
if (generating && !process.env.ELEVENLABS_API_KEY) throw new Error('Worker credentials are incomplete');

let stopping = false;
const timers: ReturnType<typeof setInterval>[] = [];
async function sweep() {
  try { console.log(JSON.stringify({ retention: await purgeExpiredMedia() })); }
  catch { console.error('Retention sweep failed; will retry next hour'); }
  // Pause clones whose plan lapsed; delete them at the provider 30 days later.
  if (process.env.ELEVENLABS_API_KEY) {
    try { console.log(JSON.stringify({ clones: await sweepClones() })); }
    catch { console.error('Clone sweep failed; will retry next hour'); }
  }
}
timers.push(setInterval(() => { void sweep(); }, 3600000));
void sweep();

if (generating) {
  timers.push(setInterval(() => { heartbeat().catch(() => console.error('Worker heartbeat failed')); }, 15000));
  const tick = async () => {
    if (stopping) return;
    try {
      await heartbeat();
      const audio = await processOneJob();
      if (audio.processed) console.log(JSON.stringify(audio));
      if (videoSwitchOn()) {
        const video = await processOneVideoJob();
        if (video.processed) console.log(JSON.stringify({ video }));
      }
    } catch { console.error('Worker tick failed; no paid job automatically retried'); }
    if (!stopping) setTimeout(tick, 2000);
  };
  void tick();
  console.log('Generation worker started');
} else console.log('Generation switched off; retention sweep only.');

for (const signal of ['SIGTERM', 'SIGINT'] as const) process.on(signal, () => {
  stopping = true;
  for (const t of timers) clearInterval(t);
  // Allow in-flight dispatch to settle; supervisor hard timeout marks it uncertain on restart.
});
