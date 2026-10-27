type Preview = { url: string; captions: string; text: string; language: 'my' };
export function BurmesePreview({ preview, name }: { preview: Preview | null; name: string }) {
  if (!preview) return <p className="preview-caption">Burmese preview unavailable — provider rejected the preview request.</p>;
  return <div className="burmese-preview">
    <small className="preview-caption">မြန်မာ · Burmese preview</small>
    <audio aria-label={`Burmese preview for ${name}`} controls preload="none" src={preview.url}>
      <track kind="captions" srcLang="my" label="မြန်မာ" src={preview.captions} />
    </audio>
    <details><summary>Preview transcript</summary><p lang="my">{preview.text}</p></details>
  </div>;
}