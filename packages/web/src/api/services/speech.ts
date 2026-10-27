import { ORPCError } from '@orpc/server';
import { burmesePreview } from './voice-previews';
type Voice = { voice_id: string; name: string; category?: string; preview_url: string; labels: Record<string, string> };
export function publicVoices(voices: Voice[]) {
  // Never expose account-owned clones/designed voices through a public endpoint.
  // Provider previews are not Burmese; never publish their URLs in this library.
  return voices.filter(v => v.category === 'premade' && !/™|huffington|feynman/i.test(v.name)).map(v => ({ voice_id: v.voice_id, name: v.name, labels: v.labels ?? {}, outputLanguage: 'my' as const, preview: burmesePreview(v.voice_id) }));
}
type Model = { model_id: string; can_do_text_to_speech: boolean; languages: { language_id: string; name: string }[] };
async function get<T>(path: string): Promise<T> {
  if (!process.env.ELEVENLABS_API_KEY) throw new ORPCError('SERVICE_UNAVAILABLE', { message: 'Speech provider is not configured.' });
  const r = await fetch(`https://api.elevenlabs.io/v1/${path}`, { headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY }, signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new ORPCError('SERVICE_UNAVAILABLE', { message: 'Unable to load your speech provider. Please retry.' });
  return r.json() as Promise<T>;
}
let cached: { expires: number; voices: ReturnType<typeof publicVoices>; models: Model[] } | undefined;
export async function catalog() {
  if (!cached || cached.expires < Date.now()) {
    const [voices, models] = await Promise.all([get<{ voices: Voice[] }>('voices'), get<Model[]>('models')]);
    cached = { expires: Date.now() + 300000, voices: publicVoices(voices.voices), models };
  }
  return { voices: cached.voices, models: cached.models.filter(m => m.can_do_text_to_speech && m.languages.some(l => l.language_id === 'my')) };
}
export function normalizedScript(text: string) {
  const normalized = text.normalize('NFC').trim();
  if (!normalized || [...normalized].length > 2000) throw new ORPCError('BAD_REQUEST', { message: 'Enter between 1 and 2,000 characters.' });
  if (!/[က-႟ꩠ-ꩿ]/.test(normalized)) throw new ORPCError('BAD_REQUEST', { message: 'Add Burmese text to your script.' });
  return normalized;
}