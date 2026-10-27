export const previewText = 'မင်္ဂလာပါ။ မင်္ဂလာအသံမှ ကြိုဆိုပါတယ်။ သင့်စိတ်ကူးတွေကို မြန်မာအသံအဖြစ် ပြောင်းလဲလိုက်ပါ။';
const available = new Set(['CwhRBWXzGAHq8TQ4Fs17', 'FGY2WhTYpPnrIDTdsKH5', 'pqHfZKP75CvOlQylNhV4']);
export function burmesePreview(id: string) {
  return available.has(id) ? { url: `/audio/burmese-previews/${id}.mp3`, captions: `/audio/burmese-previews/${id}.vtt`, text: previewText, language: 'my' as const } : null;
}