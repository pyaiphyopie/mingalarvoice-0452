import { processOneJob } from '../packages/web/src/api/services/worker';
let dispatched = false;
try {
  await processOneJob({ request: (async () => { dispatched = true; throw new Error('Mock ambiguous failure'); }) as typeof fetch, store: async () => {} });
} catch {}
console.log(JSON.stringify({ dispatched }));