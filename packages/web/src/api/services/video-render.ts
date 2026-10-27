import { spawn } from 'node:child_process';
import type { EventEmitter } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Narrated video: narration MP3 + still background + burned-in Burmese captions -> H.264/AAC MP4. */
export type VideoShape = '9:16' | '16:9';
export const VIDEO_SIZES: Record<VideoShape, { width: number; height: number }> = {
  '9:16': { width: 1080, height: 1920 },
  '16:9': { width: 1920, height: 1080 },
};
export const MAX_VIDEO_SECONDS = 180;

export type Cue = { start: number; end: number; text: string };

/** Split a Burmese script into caption lines on sentence marks (။ ၊ . ! ?) and cap each line length. */
export function captionLines(script: string, maxChars = 32) {
  const sentences = script.replace(/\s+/g, ' ').split(/(?<=[။၊.!?])\s*/u).map(s => s.trim()).filter(Boolean);
  const lines: string[] = [];
  for (const sentence of sentences) {
    if (sentence.length <= maxChars) { lines.push(sentence); continue; }
    // Break long sentences at spaces (Burmese writers space between phrases).
    let current = '';
    for (const word of sentence.split(' ')) {
      if (current && (current + ' ' + word).length > maxChars) { lines.push(current); current = word; }
      else current = current ? `${current} ${word}` : word;
    }
    if (current) lines.push(current);
  }
  return lines;
}

/**
 * Fallback timing when no provider alignment exists: share the audio duration in proportion to
 * line length. Production should prefer ElevenLabs character alignment (with-timestamps endpoint).
 */
export function proportionalCues(lines: string[], durationSeconds: number): Cue[] {
  const total = lines.reduce((sum, line) => sum + line.length, 0);
  if (!total || !(durationSeconds > 0)) return [];
  let cursor = 0;
  return lines.map(text => {
    const start = cursor;
    cursor += (text.length / total) * durationSeconds;
    return { start, end: cursor, text };
  });
}

function assTime(seconds: number) {
  const cs = Math.max(0, Math.round(seconds * 100));
  const h = Math.floor(cs / 360000), m = Math.floor((cs % 360000) / 6000), s = Math.floor((cs % 6000) / 100);
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs % 100).padStart(2, '0')}`;
}

/** ASS subtitles: libass + HarfBuzz shapes Myanmar script correctly (drawtext does not). */
export const WATERMARK_TEXT = 'Mingalar Voice';
export function buildAss(cues: Cue[], shape: VideoShape, options: { watermark?: boolean; durationSeconds?: number } = {}) {
  const { width, height } = VIDEO_SIZES[shape];
  const vertical = shape === '9:16';
  const fontSize = vertical ? 96 : 78;
  const marginV = vertical ? 420 : 120;
  const escape = (text: string) => text.replace(/\\/g, '\\\\').replace(/[{}]/g, '').replace(/\n/g, '\\N');
  return [
    '[Script Info]', 'ScriptType: v4.00+', `PlayResX: ${width}`, `PlayResY: ${height}`, 'WrapStyle: 0', 'ScaledBorderAndShadow: yes', '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    // White text on a translucent ink box (BorderStyle 3) keeps captions legible over any photo.
    `Style: Caption,Noto Sans Myanmar,${fontSize},&H00FAF9F6,&H00FAF9F6,&H90101010,&H90101010,1,0,0,0,100,100,0,0,3,18,0,2,90,90,${marginV},1`,
    // Trial/Creator watermark: top-right, ~45% opaque, for the whole video.
    `Style: Mark,Noto Sans Myanmar,${vertical ? 46 : 40},&H70FFFFFF,&H70FFFFFF,&H90000000,&H00000000,1,0,0,0,100,100,1,0,1,2,0,9,48,48,${vertical ? 80 : 48},1`,
    '',
    '[Events]', 'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
    ...cues.map(cue => `Dialogue: 0,${assTime(cue.start)},${assTime(cue.end)},Caption,,0,0,0,,${escape(cue.text)}`),
    ...(options.watermark ? [`Dialogue: 1,${assTime(0)},${assTime((options.durationSeconds ?? cues[cues.length - 1]?.end ?? 0) + 1)},Mark,,0,0,0,,${WATERMARK_TEXT}`] : []),
    '',
  ].join('\n');
}

/** ffmpeg arguments. Background is cover-cropped to the shape; a slow push-in avoids a dead still frame. */
export function ffmpegArgs(input: { image: string; audio: string; ass: string; output: string; shape: VideoShape; durationSeconds: number; fontsDir?: string }) {
  const { width, height } = VIDEO_SIZES[input.shape];
  const fps = 30;
  const frames = Math.ceil(input.durationSeconds * fps);
  const assFilter = `ass=${input.ass.replace(/[:\\']/g, m => `\\${m}`)}${input.fontsDir ? `:fontsdir=${input.fontsDir}` : ''}`;
  const filter = [
    `[0:v]scale=${width * 2}:${height * 2}:force_original_aspect_ratio=increase,crop=${width * 2}:${height * 2}`,
    `zoompan=z='min(1+0.0004*on,1.08)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${width}x${height}:fps=${fps}`,
    `format=yuv420p,${assFilter}[v]`,
  ].join(',');
  return [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-loop', '1', '-i', input.image, '-i', input.audio,
    '-filter_complex', filter, '-map', '[v]', '-map', '1:a',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21', '-r', String(fps),
    '-c:a', 'aac', '-b:a', '160k', '-t', input.durationSeconds.toFixed(3), '-movflags', '+faststart', input.output,
  ];
}

export function run(command: string, args: string[], timeoutMs: number) {
  return new Promise<void>((resolve, reject) => {
    const spawned = spawn(command, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    // Typed through EventEmitter so the mobile package's typecheck of the shared API stays happy.
    const child = spawned as unknown as EventEmitter & { kill(signal: string): void };
    let stderr = '';
    (spawned.stderr as unknown as EventEmitter).on('data', chunk => { stderr = (stderr + chunk).slice(-2000); });
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('Video render timed out')); }, timeoutMs);
    child.on('error', (error: Error) => { clearTimeout(timer); reject(error); });
    child.on('close', (code: number | null) => { clearTimeout(timer); if (code === 0) resolve(); else reject(new Error(`ffmpeg exited ${code}: ${stderr}`)); });
  });
}

/** Renders to a temp directory and returns the MP4 bytes; temp files are always removed. */
export async function renderNarratedVideo(input: { image: Uint8Array; imageExt: 'jpg' | 'png' | 'webp'; audio: Uint8Array; script: string; durationSeconds: number; shape: VideoShape; cues?: Cue[]; watermark?: boolean }) {
  if (!(input.durationSeconds > 0) || input.durationSeconds > MAX_VIDEO_SECONDS) throw new Error('Narration must be between 0 and 180 seconds');
  const dir = await mkdtemp(join(tmpdir(), 'mv-render-'));
  try {
    const paths = { image: join(dir, `bg.${input.imageExt}`), audio: join(dir, 'narration.mp3'), ass: join(dir, 'captions.ass'), output: join(dir, 'video.mp4') };
    const cues = input.cues ?? proportionalCues(captionLines(input.script), input.durationSeconds);
    await Promise.all([writeFile(paths.image, input.image), writeFile(paths.audio, input.audio), writeFile(paths.ass, buildAss(cues, input.shape, { watermark: input.watermark, durationSeconds: input.durationSeconds }))]);
    await run(process.env.FFMPEG_PATH || 'ffmpeg', ffmpegArgs({ ...paths, shape: input.shape, durationSeconds: input.durationSeconds, fontsDir: process.env.CAPTION_FONTS_DIR }), 10 * 60 * 1000);
    return new Uint8Array(await readFile(paths.output));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Decodes the image once (no network, no spend) so bad uploads fail before narration is paid for. */
export async function probeImage(image: Uint8Array, ext: 'jpg' | 'png' | 'webp') {
  const dir = await mkdtemp(join(tmpdir(), 'mv-probe-'));
  try {
    const path = join(dir, `bg.${ext}`);
    await writeFile(path, image);
    await run(process.env.FFMPEG_PATH || 'ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', path, '-frames:v', '1', '-f', 'null', '-'], 30000);
    return true;
  } catch { return false; } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
export const imageExt = (key: string) => (key.endsWith('.png') ? 'png' : key.endsWith('.webp') ? 'webp' : 'jpg') as 'jpg' | 'png' | 'webp';
