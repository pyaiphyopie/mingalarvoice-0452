import { spawn } from 'node:child_process';
import type { EventEmitter } from 'node:events';
import { buildAss, captionLines, type Cue } from './video-render';
import { run } from './video-render';

/**
 * Movie-recap render: the creator's own clip + Burmese voiceover + burned-in captions, always 9:16.
 * framing 'fit' = whole frame over a blurred fill (no crop); 'fill' = centre-crop to full screen.
 * audio 'duck' keeps the clip's sound quietly under the voiceover; 'replace' drops it.
 */
export type RecapOptions = { audio: 'duck' | 'replace'; framing: 'fit' | 'fill'; maxSeconds: number };
export const W = 1080, H = 1920;
export const MAX_CLIP_BYTES = 500 * 1024 * 1024;
/** Longest single TTS request; long recaps are narrated in sentence-aligned chunks. */
export const CHUNK_CHARS = 1500;

export function splitScript(script: string, max = CHUNK_CHARS) {
  const sentences = script.split(/(?<=[။.!?\n])\s*/u).map(s => s.trim()).filter(Boolean);
  const chunks: string[] = [];
  let current = '';
  for (const s of sentences) {
    if ([...s].length > max) {
      if (current) { chunks.push(current); current = ''; }
      const chars = [...s];
      for (let i = 0; i < chars.length; i += max) chunks.push(chars.slice(i, i + max).join(''));
      continue;
    }
    if (current && [...current].length + [...s].length + 1 > max) { chunks.push(current); current = s; }
    else current = current ? `${current} ${s}` : s;
  }
  if (current) chunks.push(current);
  return chunks;
}

/** Caption cues timed per narration chunk (each chunk's measured length), proportional inside a chunk. */
export function chunkCues(chunks: { text: string; seconds: number }[]): Cue[] {
  const cues: Cue[] = [];
  let offset = 0;
  for (const chunk of chunks) {
    const lines = captionLines(chunk.text);
    const total = lines.reduce((n, l) => n + l.length, 0) || 1;
    let cursor = offset;
    for (const text of lines) { const start = cursor; cursor += (text.length / total) * chunk.seconds; cues.push({ start, end: cursor, text }); }
    offset += chunk.seconds;
  }
  return cues;
}

const srtTime = (s: number) => {
  const ms = Math.max(0, Math.round(s * 1000));
  const h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000), sec = Math.floor((ms % 60000) / 1000);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')}`;
};
export const buildSrt = (cues: Cue[]) => cues.map((c, i) => `${i + 1}\n${srtTime(c.start)} --> ${srtTime(c.end)}\n${c.text}\n`).join('\n');

/** ffprobe: duration and whether the clip has sound. Free and local; runs before any paid call. */
export function probeClip(path: string) {
  return new Promise<{ seconds: number; hasAudio: boolean; hasVideo: boolean }>((resolve, reject) => {
    const spawned = spawn(process.env.FFPROBE_PATH || 'ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type:format=duration', '-of', 'json', path], { stdio: ['ignore', 'pipe', 'ignore'] });
    const child = spawned as unknown as EventEmitter;
    let out = '';
    (spawned.stdout as unknown as EventEmitter).on('data', chunk => { out += chunk; });
    const timer = setTimeout(() => reject(new Error('probe timeout')), 60000);
    child.on('error', (e: Error) => { clearTimeout(timer); reject(e); });
    child.on('close', (code: number | null) => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error('unreadable clip'));
      try {
        const j = JSON.parse(out) as { streams?: { codec_type: string }[]; format?: { duration?: string } };
        resolve({ seconds: Number(j.format?.duration ?? NaN), hasAudio: !!j.streams?.some(s => s.codec_type === 'audio'), hasVideo: !!j.streams?.some(s => s.codec_type === 'video') });
      } catch (e) { reject(e); }
    });
  });
}

export function recapArgs(input: { clip: string; narration: string; ass: string; output: string; seconds: number; options: RecapOptions; clipHasAudio: boolean; fontsDir?: string }) {
  const ass = `ass=${input.ass.replace(/[:\\']/g, m => `\\${m}`)}${input.fontsDir ? `:fontsdir=${input.fontsDir}` : ''}`;
  const video = input.options.framing === 'fill'
    ? `[0:v]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1,fps=30,format=yuv420p,${ass}[v]`
    : `[0:v]split[a][b];[a]scale=${W / 4}:${H / 4}:force_original_aspect_ratio=increase,crop=${W / 4}:${H / 4},boxblur=12:2,scale=${W}:${H},eq=brightness=-0.12[bg];[b]scale=${W}:${H}:force_original_aspect_ratio=decrease[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2,setsar=1,fps=30,format=yuv420p,${ass}[v]`;
  const duck = input.options.audio === 'duck' && input.clipHasAudio;
  const audio = duck ? `;[0:a]volume=0.18,aresample=44100[o];[1:a]aresample=44100[n];[n][o]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[a]` : '';
  return [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-stream_loop', '-1', '-i', input.clip, '-i', input.narration,
    '-filter_complex', video + audio, '-map', '[v]', '-map', duck ? '[a]' : '1:a',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-maxrate', '5M', '-bufsize', '10M',
    '-c:a', 'aac', '-b:a', '160k', '-t', input.seconds.toFixed(3), '-movflags', '+faststart', input.output,
  ];
}

export async function renderRecap(input: { clip: string; narration: string; dir: string; seconds: number; cues: Cue[]; options: RecapOptions; clipHasAudio: boolean; watermark: boolean }) {
  const { writeFile } = await import('node:fs/promises');
  const { join } = await import('node:path');
  const ass = join(input.dir, 'captions.ass'), output = join(input.dir, 'recap.mp4');
  await writeFile(ass, buildAss(input.cues, '9:16', { watermark: input.watermark, durationSeconds: input.seconds }));
  // Generous timeout: long recaps render at roughly real time on one CPU.
  await run(process.env.FFMPEG_PATH || 'ffmpeg', recapArgs({ ...input, ass, output, fontsDir: process.env.CAPTION_FONTS_DIR }), Math.max(10 * 60000, input.seconds * 3000));
  return output;
}
