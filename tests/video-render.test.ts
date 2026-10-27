import { describe, expect, test } from 'bun:test';
import { buildAss, captionLines, ffmpegArgs, proportionalCues } from '../packages/web/src/api/services/video-render';

const script = 'မင်္ဂလာပါ။ ဒီနေ့ မင်္ဂလာအသံကို စမ်းသပ်နေပါတယ်။ မြန်မာစကားကို သဘာဝကျကျ ပြောနိုင်ပါသလား။';

describe('narrated video render', () => {
  test('splits Burmese sentences and caps line length', () => {
    const lines = captionLines(script);
    expect(lines[0]).toBe('မင်္ဂလာပါ။');
    expect(lines.every(line => line.length <= 32 || !line.includes(' '))).toBe(true);
    expect(lines.join(' ').replace(/\s/g, '')).toBe(script.replace(/\s/g, ''));
  });
  test('cues cover the full duration without gaps', () => {
    const cues = proportionalCues(captionLines(script), 7.079);
    expect(cues[0]!.start).toBe(0);
    expect(cues.at(-1)!.end).toBeCloseTo(7.079, 6);
    for (let i = 1; i < cues.length; i++) expect(cues[i]!.start).toBe(cues[i - 1]!.end);
  });
  test('ASS uses shape resolution and strips override braces', () => {
    const ass = buildAss([{ start: 0, end: 1.5, text: 'a{\\pos(0,0)}b' }], '9:16');
    expect(ass).toContain('PlayResX: 1080');
    expect(ass).toContain('PlayResY: 1920');
    expect(ass).toContain('Dialogue: 0,0:00:00.00,0:00:01.50,Caption,,0,0,0,,a\\\\pos(0,0)b');
  });
  test('ffmpeg args bound duration and size', () => {
    const args = ffmpegArgs({ image: '/t/bg.jpg', audio: '/t/a.mp3', ass: '/t/c.ass', output: '/t/o.mp4', shape: '16:9', durationSeconds: 7.079 });
    expect(args.join(' ')).toContain('s=1920x1080');
    expect(args[args.indexOf('-t') + 1]).toBe('7.079');
  });
});
