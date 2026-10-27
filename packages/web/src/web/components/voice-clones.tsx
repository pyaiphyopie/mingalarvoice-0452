import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { ArrowUpRight, Loader2, Mic, Square, Trash2, Upload, UserRound, ShieldCheck } from "lucide-react";
import { useClones, useCreateClone, useDeleteClone, useUploadSample } from "../queries/clones";

const sampleTypes = ["audio/webm", "audio/mp4", "audio/x-m4a", "audio/mpeg", "audio/wav", "audio/x-wav", "audio/ogg", "audio/aac"] as const;
type SampleType = (typeof sampleTypes)[number];
const baseType = (t: string) => t.split(";")[0]!.trim() as SampleType;
const statusText: Record<string, string> = { checking: "Checking consent…", active: "Ready", paused: "Paused — renew Studio or Business" };

/** Own-voice cloning: read the Burmese consent sentence, keep talking, and we check it before cloning. */
export function VoiceClones({ signedIn, notify }: { signedIn: boolean; notify: (m: string) => void }) {
  const list = useClones(signedIn), upload = useUploadSample(), create = useCreateClone(), remove = useDeleteClone();
  const [name, setName] = useState("My voice");
  const [agree, setAgree] = useState(false);
  const [sample, setSample] = useState<{ blob: Blob; type: SampleType; url: string; seconds?: number; label: string } | null>(null);
  const [recording, setRecording] = useState(false), [elapsed, setElapsed] = useState(0), [busy, setBusy] = useState(false);
  const recorder = useRef<MediaRecorder | null>(null), started = useRef(0), file = useRef<HTMLInputElement>(null);
  const data = list.data;
  const min = data?.minSeconds ?? 20, max = data?.maxSeconds ?? 300;
  const full = !!data && data.clones.length >= data.slots;
  useEffect(() => { if (!recording) return; const t = setInterval(() => setElapsed((Date.now() - started.current) / 1000), 250); return () => clearInterval(t); }, [recording]);
  useEffect(() => () => { if (sample) URL.revokeObjectURL(sample.url); }, [sample]);
  useEffect(() => { if (recording && elapsed >= max) recorder.current?.stop(); }, [elapsed, max, recording]);

  async function record() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      const mime = ["audio/webm", "audio/mp4", "audio/ogg"].find(t => MediaRecorder.isTypeSupported(t));
      const r = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      const parts: Blob[] = [];
      r.ondataavailable = e => e.data.size && parts.push(e.data);
      r.onstop = () => {
        stream.getTracks().forEach(t => t.stop());
        const type = baseType(r.mimeType || mime || "audio/webm");
        const blob = new Blob(parts, { type });
        setSample({ blob, type, url: URL.createObjectURL(blob), seconds: (Date.now() - started.current) / 1000, label: "Your recording" });
        setRecording(false);
      };
      started.current = Date.now(); setElapsed(0); setSample(null);
      r.start(1000); recorder.current = r; setRecording(true);
    } catch {
      notify("Microphone access was blocked. Allow the microphone, or upload a recording instead.");
    }
  }
  function pick(f: File | undefined) {
    if (!f) return;
    const type = baseType(f.type);
    if (!sampleTypes.includes(type)) return notify("Use an MP3, M4A, WAV, OGG or WebM recording.");
    if (f.size > 10 * 1024 * 1024) return notify("Recordings must be 10 MB or smaller.");
    setSample({ blob: f, type, url: URL.createObjectURL(f), label: f.name });
    if (file.current) file.current.value = "";
  }
  async function submit() {
    if (!sample) return;
    if (sample.seconds !== undefined && sample.seconds < min) return notify(`Keep talking for at least ${min} seconds after the consent sentence.`);
    setBusy(true);
    try {
      const { key, url } = await upload.mutateAsync({ contentType: sample.type, size: sample.blob.size });
      const put = await fetch(url, { method: "PUT", body: sample.blob, headers: { "Content-Type": sample.type } });
      if (!put.ok) throw new Error("Upload failed. Please try again.");
      const made = await create.mutateAsync({ name: name.trim() || "My voice", sampleKey: key, consent: true });
      notify(`“${made.name}” is ready. Pick it in the voice studio or video studio.`);
      setSample(null); setAgree(false);
    } catch (e) {
      notify(e instanceof Error ? e.message : "Cloning failed. Please try again.");
    } finally { setBusy(false); }
  }
  async function del(id: string, label: string) {
    if (!window.confirm(`Delete “${label}”? The cloned voice is removed from our voice provider and cannot be restored.`)) return;
    try { await remove.mutateAsync({ id }); notify("Cloned voice deleted."); }
    catch (e) { notify(e instanceof Error ? e.message : "Delete failed."); }
  }

  if (!signedIn) return <div className="empty"><UserRound /><h3>Your own voice, in every recap.</h3><p>Sign in to clone your voice. Included with Studio and Business.</p><Link className="action" href="/sign-in">Sign in <ArrowUpRight size={17} /></Link></div>;
  if (list.isLoading) return <div className="empty"><Loader2 className="spin" />Loading your voices…</div>;
  if (list.isError || !data) return <p className="error">Your voices could not be loaded. <button onClick={() => list.refetch()}>Retry</button></p>;

  return (
    <>
      <div className="studio-grid">
        <section className="editor-panel clone-panel">
          <div className="panel-title"><span><Mic size={18} /> Record your voice</span><span className="muted">{data.clones.length} / {data.slots} voice{data.slots === 1 ? "" : "s"} used</span></div>
          {data.slots < 1 ? (
            <div className="clone-locked">
              <h3>Voice cloning comes with Studio and Business.</h3>
              <p>Studio includes 1 cloned voice, Business includes 3. Your clone works while your plan is active; if it lapses, the clone pauses for 30 days before it is deleted.</p>
              <Link className="action" href="/billing">See plans <ArrowUpRight size={16} /></Link>
            </div>
          ) : (
            <>
              <div className="eyebrow">STEP 1 · READ THIS FIRST, SLOWLY</div>
              <blockquote className="consent-sentence" lang="my">{data.consentSentence}</blockquote>
              <p className="muted">Then keep talking naturally — tell a story or read a recap — for {min} seconds to {max / 60} minutes. Quiet room, phone close to your mouth, no music. Only your own voice.</p>
              <div className="eyebrow">STEP 2 · RECORD OR UPLOAD</div>
              <div className="recorder">
                {recording ? (
                  <button className="action rec" onClick={() => recorder.current?.stop()}><Square size={16} /> Stop · {Math.floor(elapsed)} s</button>
                ) : (
                  <button className="action" disabled={full || busy} onClick={record}><Mic size={16} /> {sample ? "Record again" : "Start recording"}</button>
                )}
                <button className="ghost" disabled={recording || full || busy} onClick={() => file.current?.click()}><Upload size={15} /> Upload a file</button>
                <input ref={file} type="file" hidden accept={sampleTypes.join(",")} aria-label="Voice recording file" onChange={e => pick(e.target.files?.[0])} />
              </div>
              {recording && <div className="rec-meter"><span style={{ width: `${Math.min(100, (elapsed / Math.max(min, 60)) * 100)}%` }} /><small>{elapsed < min ? `Keep going — at least ${Math.ceil(min - elapsed)} s more` : "Good length. Stop whenever you're ready."}</small></div>}
              {sample && !recording && (
                <div className="sample-preview">
                  <audio aria-label="Play back your recording" controls src={sample.url} preload="metadata"><track kind="captions" /></audio>
                  <small>{sample.label}{sample.seconds ? ` · ${Math.round(sample.seconds)} s` : ""}</small>
                </div>
              )}
              <div className="eyebrow">STEP 3 · CONFIRM</div>
              <label className="field">Voice name<input value={name} maxLength={40} onChange={e => setName(e.target.value)} aria-label="Voice name" /></label>
              <label className="owner-confirm"><input type="checkbox" checked={agree} onChange={e => setAgree(e.target.checked)} aria-label="Consent confirmation" />This is my own voice. I agree to it being cloned for my Mingalar Voice account only.</label>
              <div className="generate-footer">
                <div>
                  <strong>We check the consent sentence before cloning.</strong>
                  <small>The recording is deleted as soon as the check finishes. No credits are used.</small>
                </div>
                <button className="action" disabled={!sample || !agree || busy || recording || full || !data.ready} onClick={submit}>
                  {busy ? <Loader2 size={18} className="spin" /> : <ShieldCheck size={18} />} {busy ? "Checking…" : "Clone my voice"}
                </button>
              </div>
              {!data.ready && <p className="error">Voice cloning is not switched on yet. You can prepare your recording; nothing is sent until it is enabled.</p>}
              {full && <p className="muted">All your voice slots are in use. Delete a voice to record a new one{data.slots < 3 ? ", or upgrade to Business for 3 voices" : ""}.</p>}
            </>
          )}
        </section>
        <aside className="voice-settings">
          <div className="panel-title"><span><UserRound size={17} /> Your voices</span></div>
          {data.clones.length ? data.clones.map(c => (
            <div className="clone-item" key={c.id}>
              <div className="avatar lavender-avatar"><Mic size={20} /></div>
              <div><h3>{c.name}</h3><p className={c.usable ? "" : "error"}>{c.usable ? "Ready" : statusText[c.status] ?? c.status}</p></div>
              <button aria-label={`Delete ${c.name}`} disabled={remove.isPending || c.status === "checking"} onClick={() => del(c.id, c.name)}><Trash2 size={17} /></button>
            </div>
          )) : <p className="muted">No cloned voices yet.</p>}
          <div className="settings-note">Your clone is private to your account. Only clone your own voice — cloning someone else is not allowed and the consent check will reject it.</div>
        </aside>
      </div>
    </>
  );
}
