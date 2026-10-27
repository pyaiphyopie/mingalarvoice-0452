import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import {
  ArrowUpRight, Clapperboard, ImagePlus, Loader2, RectangleHorizontal, RectangleVertical, Film, Upload, Captions, Volume1, VolumeX, Maximize, Minimize,
} from "lucide-react";
import { useCaptions, useCreateRecap, useCreateVideo, useUploadClip, useUploadImage, useVideoDownload, useVideoStatus, useVideos } from "../queries/video";

type Voice = { voice_id: string };
const types = ["image/jpeg", "image/png", "image/webp"] as const;
type ImageType = (typeof types)[number];
const clipTypes = ["video/mp4", "video/quicktime", "video/webm"] as const;
type ClipType = (typeof clipTypes)[number];
const mb = (n: number) => `${Math.round(n / 1024 / 1024)} MB`;
const statusLabel: Record<string, string> = { queued: "Queued", running: "Rendering", succeeded: "Ready", failed: "Failed", uncertain: "Held for review" };

/**
 * Video studio. Recap: the creator's own clip + Burmese voiceover + burned-in captions, 9:16.
 * Narrated: background image + narration + captions. Both bill per second of the finished video.
 */
export function VideoStudio({ signedIn, voices, voice, setVoice, notify, label }: {
  signedIn: boolean; voices: Voice[]; voice: string; setVoice: (v: string) => void; notify: (m: string) => void; label: (id: string) => string;
}) {
  const status = useVideoStatus(signedIn), list = useVideos(signedIn);
  const upload = useUploadImage(), create = useCreateVideo(), download = useVideoDownload();
  const uploadClip = useUploadClip(), createRecap = useCreateRecap(), captions = useCaptions();
  const [mode, setMode] = useState<"recap" | "narrated">("recap");
  const [script, setScript] = useState("");
  const [shape, setShape] = useState<"9:16" | "16:9">("9:16");
  const [image, setImage] = useState<{ key: string; preview: string; name: string } | null>(null);
  const [clip, setClip] = useState<{ key: string; preview: string; name: string; size: number } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [audio, setAudio] = useState<"duck" | "replace">("duck");
  const [framing, setFraming] = useState<"fit" | "fill">("fill");
  const [maxCredits, setMaxCredits] = useState(120);
  const input = useRef<HTMLInputElement>(null), clipInput = useRef<HTMLInputElement>(null);

  const recap = mode === "recap";
  const limits = status.data?.recap;
  const rate = status.data?.rate ?? 2;
  const cap = recap ? limits?.maxReservation ?? 360 : status.data?.maxReservation ?? 360;
  const maxChars = recap ? limits?.maxChars ?? 2000 : 2000;
  const maxClip = limits?.maxClipBytes ?? 500 * 1024 * 1024;
  const busy = uploading || progress !== null;
  useEffect(() => () => { if (image) URL.revokeObjectURL(image.preview); }, [image]);
  useEffect(() => () => { if (clip) URL.revokeObjectURL(clip.preview); }, [clip]);

  async function pick(file: File | undefined) {
    if (!file) return;
    if (!signedIn) return notify("Sign in to upload a background image.");
    if (!types.includes(file.type as ImageType)) return notify("Use a JPG, PNG or WebP image.");
    if (file.size > 10 * 1024 * 1024) return notify("Images must be 10 MB or smaller.");
    setUploading(true);
    try {
      const { key, url } = await upload.mutateAsync({ contentType: file.type as ImageType, size: file.size });
      const put = await fetch(url, { method: "PUT", body: file, headers: { "Content-Type": file.type } });
      if (!put.ok) throw new Error("Upload failed. Please try again.");
      setImage({ key, preview: URL.createObjectURL(file), name: file.name });
    } catch (e) {
      notify(e instanceof Error ? e.message : "Upload failed.");
    } finally {
      setUploading(false);
      if (input.current) input.current.value = "";
    }
  }
  /** XHR rather than fetch so large clips show upload progress. */
  function put(url: string, file: File) {
    return new Promise<void>((resolve, reject) => {
      const x = new XMLHttpRequest();
      x.open("PUT", url);
      x.setRequestHeader("Content-Type", file.type);
      x.upload.onprogress = (e) => { if (e.lengthComputable) setProgress(Math.round((e.loaded / e.total) * 100)); };
      x.onload = () => (x.status >= 200 && x.status < 300 ? resolve() : reject(new Error("Upload failed. Please try again.")));
      x.onerror = () => reject(new Error("Upload failed. Check your connection and try again."));
      x.send(file);
    });
  }
  async function pickClip(file: File | undefined) {
    if (!file) return;
    if (!signedIn) return notify("Sign in to upload your clip.");
    if (!clipTypes.includes(file.type as ClipType)) return notify("Use an MP4, MOV or WebM video.");
    if (file.size > maxClip) return notify(`Clips must be ${mb(maxClip)} or smaller.`);
    setProgress(0);
    try {
      const { key, url } = await uploadClip.mutateAsync({ contentType: file.type as ClipType, size: file.size });
      await put(url, file);
      setClip({ key, preview: URL.createObjectURL(file), name: file.name, size: file.size });
    } catch (e) {
      notify(e instanceof Error ? e.message : "Upload failed.");
    } finally {
      setProgress(null);
      if (clipInput.current) clipInput.current.value = "";
    }
  }
  async function submit() {
    if (!signedIn) return notify("Sign in to continue. Videos need an active plan or the free trial.");
    try {
      if (recap) {
        if (!clip) return notify("Upload your clip first.");
        await createRecap.mutateAsync({ text: script, voiceId: voice, clipKey: clip.key, audio, framing, idempotency: crypto.randomUUID(), maxCredits });
      } else {
        if (!image) return notify("Add a background image first.");
        await create.mutateAsync({ text: script, voiceId: voice, shape, imageKey: image.key, idempotency: crypto.randomUUID(), maxCredits });
      }
      notify(`${recap ? "Recap" : "Video"} queued${status.data?.priority ? " in the priority queue" : ""}. Credits are reserved; you are billed ${rate} credits per second of the finished video.`);
    } catch (e) {
      notify(e instanceof Error ? e.message : "Video could not be queued.");
    }
  }
  async function open(id: string) {
    try { window.open((await download.mutateAsync({ id })).url, "_blank", "noopener"); }
    catch (e) { notify(e instanceof Error ? e.message : "Download failed."); }
  }
  async function srt(id: string) {
    try { window.open((await captions.mutateAsync({ id })).url, "_blank", "noopener"); }
    catch (e) { notify(e instanceof Error ? e.message : "Captions are unavailable."); }
  }
  const pending = create.isPending || createRecap.isPending;
  const plan = status.data?.plan;

  return (
    <>
      <div className="studio-grid">
        <section className="editor-panel">
          <div className="panel-title">
            <span><Clapperboard size={18} /> {recap ? "Recap script" : "Narration script"}</span>
            <div className="filters mode-toggle" role="tablist" aria-label="Video type">
              <button role="tab" aria-selected={recap} className={recap ? "selected" : ""} onClick={() => setMode("recap")}><Film size={14} /> Recap my clip</button>
              <button role="tab" aria-selected={!recap} className={!recap ? "selected" : ""} onClick={() => setMode("narrated")}><ImagePlus size={14} /> Narrate a picture</button>
            </div>
          </div>
          <textarea value={script} maxLength={maxChars} onChange={(e) => setScript(e.target.value)} aria-label={recap ? "Burmese recap script" : "Burmese narration script"}
            placeholder={recap
              ? "Write your recap in Burmese. Captions are made from this text…\n\nဒီဇာတ်ကားမှာ အဓိကဇာတ်ကောင်က…"
              : "Write the narration for your video…\n\nမင်္ဂလာပါ။ ဗီဒီယိုအတွက် စာသားကို ဒီနေရာမှာ ရေးပါ။"} />
          <div className="editor-footer">
            <span>Burmese Unicode · {recap ? `up to ${Math.round((limits?.maxSeconds ?? 180) / 60)} minutes on your plan` : "up to 3 minutes of narration"}</span>
            <span>{[...script].length.toLocaleString()} / {maxChars.toLocaleString()}</span>
          </div>
          <div className="editor-controls">
            <div><div className="eyebrow">OUTPUT</div><strong>MP4 <span>· H.264 · {recap || shape === "9:16" ? "1080×1920" : "1920×1080"}</span></strong></div>
            <div><div className="eyebrow">CAPTIONS</div><strong>Burned in <span>· Noto Sans Myanmar{recap ? " · SRT too" : ""}</span></strong></div>
          </div>
          <div className="generate-footer">
            <div>
              <strong>{rate} credits / video second · rounded up</strong>
              <label>Maximum credit reservation <input aria-label="Maximum video credit reservation" type="number" min={20} max={cap} value={maxCredits} onChange={(e) => setMaxCredits(Number(e.target.value))} /></label>
              <small>About {Math.floor(maxCredits / rate)} seconds of video, up to {cap.toLocaleString()} credits on your plan. Unused credits are refunded after the video is measured.</small>
            </div>
            <button className="action" disabled={!script.trim() || (recap ? !clip : !image) || pending || busy} onClick={submit}>
              {pending ? <Loader2 size={18} className="spin" /> : <Film size={18} />} {recap ? "Make recap" : "Generate video"} <ArrowUpRight size={18} />
            </button>
          </div>
        </section>
        <aside className="voice-settings">
          {recap ? (
            <>
              <div className="panel-title"><span><Film size={17} /> Your clip</span></div>
              <button className="image-drop tall clip-drop" onClick={() => clipInput.current?.click()} disabled={busy} aria-label="Choose your clip">
                {clip ? <video aria-label="Clip preview" src={clip.preview} muted playsInline loop autoPlay className={framing}><track kind="captions" /></video>
                  : progress !== null ? <><Loader2 className="spin" /><span>Uploading… {progress}%</span></>
                  : <><Upload size={22} /><span>MP4, MOV or WebM · up to {mb(maxClip)}</span></>}
              </button>
              {progress !== null && <div className="upload-bar"><span style={{ width: `${progress}%` }} /></div>}
              <input ref={clipInput} aria-label="Clip file" type="file" accept={clipTypes.join(",")} hidden onChange={(e) => pickClip(e.target.files?.[0])} />
              {clip && <small className="muted image-name">{clip.name} · {mb(clip.size)} · tap the preview to replace</small>}
              <div className="eyebrow">ORIGINAL SOUND</div>
              <div className="filters shape-toggle">
                <button className={audio === "duck" ? "selected" : ""} onClick={() => setAudio("duck")}><Volume1 size={14} /> Keep it quiet</button>
                <button className={audio === "replace" ? "selected" : ""} onClick={() => setAudio("replace")}><VolumeX size={14} /> Remove</button>
              </div>
              <div className="eyebrow">FRAMING · 9:16</div>
              <div className="filters shape-toggle">
                <button className={framing === "fill" ? "selected" : ""} onClick={() => setFraming("fill")}><Maximize size={14} /> Fill (crop)</button>
                <button className={framing === "fit" ? "selected" : ""} onClick={() => setFraming("fit")}><Minimize size={14} /> Fit (blurred bars)</button>
              </div>
            </>
          ) : (
            <>
              <div className="panel-title"><span><ImagePlus size={17} /> Picture & format</span></div>
              <div className="eyebrow">SHAPE</div>
              <div className="filters shape-toggle">
                <button className={shape === "9:16" ? "selected" : ""} onClick={() => setShape("9:16")}><RectangleVertical size={14} /> 9:16 Story</button>
                <button className={shape === "16:9" ? "selected" : ""} onClick={() => setShape("16:9")}><RectangleHorizontal size={14} /> 16:9 Wide</button>
              </div>
              <div className="eyebrow">BACKGROUND IMAGE</div>
              <button className={`image-drop ${shape === "9:16" ? "tall" : "wide"}`} onClick={() => input.current?.click()} disabled={busy}
                style={image ? { backgroundImage: `url(${image.preview})` } : undefined} aria-label="Choose background image">
                {uploading ? <Loader2 className="spin" /> : !image && <><ImagePlus size={22} /><span>JPG, PNG or WebP · up to 10 MB</span></>}
              </button>
              <input ref={input} aria-label="Background image file" type="file" accept={types.join(",")} hidden onChange={(e) => pick(e.target.files?.[0])} />
              {image && <small className="muted image-name">{image.name} · cropped to fill the frame</small>}
            </>
          )}
          <div className="eyebrow">VOICE</div>
          <select value={voice} onChange={(e) => setVoice(e.target.value)} aria-label="Select narration voice">
            {voices.map((v) => <option key={v.voice_id} value={v.voice_id}>{label(v.voice_id)}</option>)}
          </select>
          <div className="settings-note">
            {signedIn && plan ? `${plan === "Trial" ? "Free trial" : plan}: ${status.data?.watermark ? "videos carry a small Mingalar Voice mark" : "no watermark"}${status.data?.priority ? " · priority queue" : ""}. ` : ""}
            {recap ? "Only upload clips you have the right to use. " : ""}Files are private and deleted automatically after 30 days.
          </div>
        </aside>
      </div>
      <div className="studio-status">
        <span className="dot" />
        <p><strong>{!signedIn ? "Sign in to check video access." : status.data?.ready ? "Video generation enabled." : "Video generation is not switched on yet."}</strong> An active plan or the free trial and enough credits are required. Uncertain requests are held for review, never retried automatically.</p>
        <Link href="/billing">View credits <ArrowUpRight size={15} /></Link>
      </div>
      <h3 className="ledger-heading">Your videos</h3>
      {!signedIn ? <p className="muted">Sign in to see your videos.</p>
        : list.isLoading ? <p className="muted"><Loader2 size={14} className="spin" /> Loading videos…</p>
        : list.isError ? <p className="error">Videos could not be loaded.</p>
        : list.data?.length ? (
          <div className="history-list">
            {list.data.map((job) => (
              <article key={job.id}>
                <Film />
                <div>
                  <strong>{job.text.slice(0, 70)}</strong>
                  <p>
                    {new Date(job.createdAt).toLocaleString()} · {job.kind === "recap" ? "Recap" : job.shape} · {statusLabel[job.status] ?? job.status} · {job.actualCost ?? job.cost} {job.actualCost === null ? "credits reserved" : "credits billed"}
                    {job.durationMs !== null && ` · ${(job.durationMs / 1000).toFixed(1)} s`}
                  </p>
                  {job.error && <p className="error">{job.error}</p>}
                  {job.purgedAt && <p>Deleted after 30 days.</p>}
                </div>
                {job.status === "succeeded" && job.storageKey && !job.purgedAt && (
                  <div className="job-actions">
                    {job.srtKey && <button disabled={captions.isPending} onClick={() => srt(job.id)}><Captions size={16} /> SRT</button>}
                    <button disabled={download.isPending} onClick={() => open(job.id)}>Download MP4 <ArrowUpRight size={17} /></button>
                  </div>
                )}
              </article>
            ))}
          </div>
        ) : <p className="muted">No videos yet. Finished videos appear here for 30 days.</p>}
    </>
  );
}
