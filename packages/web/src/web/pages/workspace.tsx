import { useState } from "react";
import { Link, useLocation } from "wouter";
import {
  AudioLines,
  LayoutGrid,
  Clock3,
  Wallet,
  Settings,
  ArrowUpRight,
  ChevronDown,
  ArrowLeft,
  Star,
  Search,
  Loader2,
  CircleHelp,
  LogOut,
  FileAudio,
  SlidersHorizontal,
  Check,
  Menu,
  Clapperboard,
  Mic,
} from "lucide-react";
import { Brand } from "../components/brand";
import { BurmesePreview } from '../components/burmese-preview';
import { authClient } from "../lib/auth";
import { voiceName } from "../lib/voice-names";
import { OwnerPayments } from '../components/owner-payments';
import { VideoStudio } from '../components/video-studio';
import { useOwnerStatus } from '../queries/owner';
import { Billing } from '../components/billing';
import { VoiceClones } from '../components/voice-clones';
import { useClones } from '../queries/clones';
import { DeleteAccount } from '../components/delete-account';
import {
  useCatalog,
  useFavorites,
  useFavorite,
  useWallet,
  useHistory,
  useGenerate,
  useDownload,
} from "../queries/studio";

const sample =
  "မင်္ဂလာပါ။ သင့်စိတ်ကူးတွေကို အသံအဖြစ် ပြောင်းလဲလိုက်ပါ။ ပုံပြင်တစ်ပုဒ်တိုင်းမှာ ပြောစရာတစ်ခု ရှိပါတယ်။";
export default function Workspace() {
  const [path] = useLocation(),
    { data: session, isPending } = authClient.useSession();
  const catalog = useCatalog(),
    wallet = useWallet(!!session),
    history = useHistory(!!session),
    favorites = useFavorites(!!session),
    favorite = useFavorite(),
    generate = useGenerate(),
    download = useDownload();
  const ownerStatus = useOwnerStatus(!!session);
  const clones = useClones(!!session);
  const myVoices = (clones.data?.clones ?? []).filter((c) => c.usable && c.voiceId);
  const [maxCredits, setMaxCredits] = useState(120);
  const [script, setScript] = useState(""),
    [voice, setVoice] = useState("JBFqnCBsd6RMkjVDRZzb"),
    [search, setSearch] = useState(""),
    [filter, setFilter] = useState("All voices"),
    [mobile, setMobile] = useState(false),
    [notice, setNotice] = useState("");
  const page =
    path === "/video"
      ? "video"
      : path === "/voices"
      ? "voices"
      : path === "/clones"
      ? "clones"
      : path === "/history"
        ? "history"
        : path === "/billing"
          ? "billing"
          : path === "/account"
            ? "account"
            : "studio";
  const library = catalog.data?.voices ?? [];
  // The caller's own ready clones sit beside the library voices in every picker.
  const voices = [
    ...myVoices.map((c) => ({
      voice_id: c.voiceId!,
      name: c.name,
      labels: { descriptive: "Your cloned voice", gender: "own voice" } as Record<string, string>,
      preview: null,
    })),
    ...library,
  ] as typeof library;
  const cloneNames = new Map(myVoices.map((c) => [c.voiceId!, `${c.name} (your voice)`]));
  const label = (id: string) => cloneNames.get(id) ?? voiceName(id);
  const selected = voices.find((v) => v.voice_id === voice);
  const saved = new Set(favorites.data?.map((v) => v.voiceId) ?? []);
  const filtered = library.filter(
    (v) =>
      (voiceName(v.voice_id) + " " + Object.values(v.labels).join(" "))
        .toLowerCase()
        .includes(search.toLowerCase()) &&
      (filter !== "Favorites" || saved.has(v.voice_id)) &&
      (filter !== "Female" || v.labels.gender === "female") &&
      (filter !== "Male" || v.labels.gender === "male"),
  );
  const nav = [
    ["/studio", "Voice studio", AudioLines],
    ["/video", "Video studio", Clapperboard],
    ["/voices", "Voice library", LayoutGrid],
    ["/clones", "My voices", Mic],
    ["/history", "Generation history", Clock3],
    ["/billing", "Plans & credits", Wallet],
    ["/account", "Account settings", Settings],
  ] as const;
  async function toggle(id: string) {
    if (!session) {
      setNotice("Sign in to save voices to your library.");
      return;
    }
    try {
      await favorite.mutateAsync({ voiceId: id, saved: !saved.has(id) });
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Unable to save voice.");
    }
  }
  async function create() {
    setNotice("");
    if (!session) {
      setNotice(
        "Sign in to continue. Generation requires verified plan access.",
      );
      return;
    }
    try {
      await generate.mutateAsync({
        text: script,
        voiceId: voice,
        idempotency: crypto.randomUUID(),
        maxCredits,
      });
      setNotice('Job queued. Credits are reserved; actual audio seconds are billed after processing.');
      await history.refetch();
      await wallet.refetch();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Generation failed.");
    }
  }
  const names = {
    studio: "Voice studio",
    video: "Video studio",
    voices: "Voice library",
    clones: "My voices",
    history: "Generation history",
    billing: "Plans & credits",
    account: "Your account",
  };
  return (
    <div className="workspace">
      <aside className={`sidebar ${mobile ? "shown" : ""}`}>
        <Brand />
        <div className="sidebar-label">YOUR CREATIVE SPACE</div>
        <nav>
          {nav.map(([url, label, Icon]) => (
            <Link
              href={url}
              key={url}
              className={path === url ? "active" : ""}
              onClick={() => setMobile(false)}
            >
              <Icon size={19} />
              {label}
              {path === url && <ArrowUpRight size={15} />}
            </Link>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="credit-box">
            <span>YOUR CREDIT BALANCE</span>
            <strong>
              {wallet.isLoading ? "…" : (wallet.data?.available ?? 0)}
              <small> credits</small>
            </strong>
            <Link href="/billing">
              Explore plans <ArrowUpRight size={15} />
            </Link>
          </div>
          <a href="/#faq">
            <CircleHelp size={17} />
            Questions? Start here
          </a>
          <div className="user-row">
            <div className="avatar">
              {session?.user.name?.slice(0, 1).toUpperCase() ?? "G"}
            </div>
            <div>
              <strong>{session?.user.name ?? "Guest workspace"}</strong>
              <small>
                {session
                  ? (wallet.data?.plan?.active ? `${wallet.data.plan.name === 'Trial' ? 'Free trial' : `${wallet.data.plan.name} plan`} · until ${new Date(wallet.data.subscription!.periodEnd!).toLocaleDateString()}` : 'No active plan')
                  : "Sign in to save your work"}
              </small>
            </div>
            {session ? (
              <button
                aria-label="Sign out"
                onClick={() => authClient.signOut()}
              >
                <LogOut size={17} />
              </button>
            ) : (
              <Link href="/sign-in">
                <ArrowUpRight size={18} />
              </Link>
            )}
          </div>
        </div>
      </aside>
      <main className="workspace-main">
        <header className="workspace-top">
          <div>
            <button
              aria-label="Toggle sidebar"
              className="mobile-menu"
              onClick={() => setMobile(!mobile)}
            >
              <Menu />
            </button>
            <span>Workspace</span>
            <span className="breadcrumb">/</span>
            <strong>{names[page]}</strong>
          </div>
          <div>
            <span className="preview-label">DEVELOPMENT BUILD</span>
            {!session && (
              <Link href="/sign-in">
                Sign in <ArrowUpRight size={15} />
              </Link>
            )}
          </div>
        </header>
        <div className="workspace-body">
          <Link className="back-home" href="/">
            <ArrowLeft size={14} /> Back to Mingalar Voice
          </Link>
          <div className="workspace-heading">
            <div>
              <div className="eyebrow">
                {page === "studio" || page === "video"
                  ? "LET YOUR IDEAS SPEAK."
                  : "YOUR CREATIVE TOOLKIT."}
              </div>
              <h1>
                {page === "studio" ? (
                  <>
                    Words in.<span className="italic"> Voice out.</span>
                  </>
                ) : page === "video" ? (
                  <>
                    Words in.<span className="italic"> Video out.</span>
                  </>
                ) : (
                  names[page]
                )}
              </h1>
              <p>
                {page === "studio"
                  ? "A focused space to bring your Burmese script to life."
                  : page === "video"
                    ? "Recap your clip in Burmese, or narrate over a picture. 9:16 with captions."
                  : page === "clones"
                    ? "Clone your own voice for narration and recaps. Studio and Business."
                  : page === "voices"
                    ? "Find a sound that feels like your story."
                    : page === "history"
                      ? "Your stories, from first idea to finished audio."
                      : page === "billing"
                        ? "Clear credits. A plan that works for you."
                        : "Make this space your own."}
              </p>
            </div>
            {page === "studio" && (
              <span className="language-badge">
                မြန်မာ <ChevronDown size={14} />
              </span>
            )}
          </div>
          {notice && (
            <output className="notice">
              {notice}
              <button onClick={() => setNotice("")}>Dismiss</button>
            </output>
          )}
          {page === "studio" && (
            <>
              <div className="studio-grid">
                <section className="editor-panel">
                  <div className="panel-title">
                    <span>
                      <FileAudio size={18} /> Your script
                    </span>
                    <button onClick={() => setScript(sample)}>
                      Try a sample <ArrowUpRight size={14} />
                    </button>
                  </div>
                  <textarea
                    value={script}
                    maxLength={2000}
                    onChange={(e) => setScript(e.target.value)}
                    placeholder={
                      "Write your story here…\n\nမင်္ဂလာပါ။ သင့်စာသားကို ဒီနေရာမှာ ရေးပါ။"
                    }
                    aria-label="Burmese script"
                  />
                  <div className="editor-footer">
                    <span>Burmese Unicode · Up to 2,000 characters</span>
                    <span>{[...script].length.toLocaleString()} / 2,000</span>
                  </div>
                  <div className="editor-controls">
                    <div>
                      <div className="eyebrow">OUTPUT FORMAT</div>
                      <strong>
                        MP3 <span>· 44.1 kHz</span>
                      </strong>
                    </div>
                    <div>
                      <div className="eyebrow">MODEL</div>
                      <strong>
                        Eleven v4 <span>· Burmese</span>
                      </strong>
                    </div>
                  </div>
                  <div className="generate-footer">
                    <div>
                      <strong>Make every word count.</strong>
                      <small>1 credit / audio second · rounded up</small>
                      <label>Maximum credit reservation <input aria-label="Maximum credit reservation" type="number" min={10} max={600} value={maxCredits} onChange={e => setMaxCredits(Number(e.target.value))} /></label>
                      <small>Unused credits refunded. Minimum reservation depends on script length; overruns are absorbed by the service.</small>
                    </div>
                    <button
                      className="action"
                      disabled={!script.trim() || generate.isPending}
                      onClick={create}
                    >
                      {generate.isPending ? (
                        <Loader2 size={18} className="spin" />
                      ) : (
                        <AudioLines size={18} />
                      )}
                      Generate voice
                      <ArrowUpRight size={18} />
                    </button>
                  </div>
                </section>
                <aside className="voice-settings">
                  <div className="panel-title">
                    <span>
                      <SlidersHorizontal size={17} /> Voice & delivery
                    </span>
                  </div>
                  <div className="eyebrow">YOUR VOICE</div>
                  {catalog.isLoading ? (
                    <p>
                      <Loader2 size={17} className="spin" /> Loading voices…
                    </p>
                  ) : catalog.isError ? (
                    <p className="error">Could not load provider voices.</p>
                  ) : (
                    <>
                      <select
                        value={voice}
                        onChange={(e) => setVoice(e.target.value)}
                        aria-label="Select voice"
                      >
                        {voices.map((v) => (
                          <option key={v.voice_id} value={v.voice_id}>
                            {label(v.voice_id)}
                          </option>
                        ))}
                      </select>
                      <div className="selected-voice">
                        <div className="avatar lavender-avatar">
                          <AudioLines size={27} />
                        </div>
                        <div>
                          <h3>
                            {selected ? label(selected.voice_id) : ""}
                          </h3>
                          <p>
                            {selected?.labels.descriptive ?? "Narration"} ·{" "}
                            {selected?.labels.gender}
                          </p>
                        </div>
                        <button
                          aria-label="Save selected voice"
                          disabled={favorite.isPending}
                          onClick={() => toggle(voice)}
                        >
                          <Star
                            size={19}
                            fill={saved.has(voice) ? "currentColor" : "none"}
                          />
                        </button>
                      </div>
                      {!cloneNames.has(voice) && <BurmesePreview preview={selected?.preview ?? null} name={selected ? voiceName(selected.voice_id) : ''} />}
                    </>
                  )}
                  <Link className="browse-voices" href="/voices">
                    Browse all voices <ArrowUpRight size={16} />
                  </Link>
                  <div className="delivery-note">
                    <Check size={16} />
                    <div>
                      <strong>Model capability verified</strong>
                      <p>
                        The ကိုမင်း Burmese sample was approved. Other voices
                        have not been individually reviewed.
                      </p>
                    </div>
                  </div>
                  <Link className="settings-note" href="/clones">
                    {myVoices.length ? `${myVoices.length} of your own voice${myVoices.length > 1 ? 's' : ''} in this list.` : 'Want your own voice? Clone it on Studio or Business.'} <ArrowUpRight size={13} />
                  </Link>
                </aside>
              </div>
              <div className="studio-status">
                <span className="dot" />
                <p>
                  <strong>{wallet.data?.generationReady ? 'Generation enabled.' : session ? 'Generation temporarily unavailable.' : 'Sign in to check generation access.'}</strong> Verified paid access and sufficient credits are required. Uncertain requests are held for review, never automatically retried.
                </p>
                <Link href="/billing">
                  View status <ArrowUpRight size={15} />
                </Link>
              </div>
              <div className="workspace-tips">
                <span>
                  01 <strong>Write naturally.</strong> Punctuation helps shape
                  the delivery.
                </span>
                <span>
                  02 <strong>Keep your voice.</strong> Save favorites for your
                  next script.
                </span>
                <span>
                  03 <strong>Stay in control.</strong> Real jobs will appear in
                  your history.
                </span>
              </div>
            </>
          )}
          {page === "video" && (
            <VideoStudio signedIn={!!session} voices={voices} voice={voice} setVoice={setVoice} notify={setNotice} label={label} />
          )}
          {page === "voices" && (
            <>
              <div className="library-tools">
                <div className="search-box">
                  <Search size={17} />
                  <input
                    placeholder="Search voices or styles"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    aria-label="Search voices"
                  />
                </div>
                <div className="filters">
                  {["All voices", "Female", "Male", "Favorites"].map((f) => (
                    <button
                      className={filter === f ? "selected" : ""}
                      onClick={() => setFilter(f)}
                      key={f}
                    >
                      {f}
                    </button>
                  ))}
                </div>
              </div>
              <p className="library-note">
                Every voice generates Burmese using Eleven v4. Play the available Burmese previews below; English previews are removed. Some previews are unavailable because the provider rejected their requests.
                These are multilingual presets, not a claim of native-Burmese speakers. The ကိုမင်း sample was approved; other presets remain unreviewed.
              </p>
              {catalog.isLoading ? (
                <div className="empty">
                  <Loader2 className="spin" />
                  Loading voice library…
                </div>
              ) : catalog.isError ? (
                <div className="error">
                  Voice library could not be loaded.{" "}
                  <button onClick={() => catalog.refetch()}>Retry</button>
                </div>
              ) : (
                <div className="library-grid">
                  {filtered.map((v, i) => (
                    <article className="library-card" key={v.voice_id}>
                      <div className="library-card-top">
                        <div className={`voice-orb orb-${i % 3}`}>
                          <AudioLines size={30} />
                        </div>
                        <button
                          aria-label={`Save ${voiceName(v.voice_id)}`}
                          disabled={favorite.isPending}
                          onClick={() => toggle(v.voice_id)}
                        >
                          <Star
                            size={19}
                            fill={
                              saved.has(v.voice_id) ? "currentColor" : "none"
                            }
                          />
                        </button>
                      </div>
                      <h3>{voiceName(v.voice_id)}</h3>
                      <p>
                        {v.labels.descriptive ?? "Narration"} ·{" "}
                        {v.labels.use_case?.replace(/_/g, " ") ?? "Voice"}
                      </p>
                      <div className="tags">
                        <span>မြန်မာ · Burmese</span>
                        <span>{v.labels.gender ?? "Voice"}</span>
                        <span>
                          {v.labels.descriptive ??
                            v.labels.use_case?.replace(/_/g, " ") ??
                            "Narration"}
                        </span>
                      </div>
                      <BurmesePreview preview={v.preview} name={voiceName(v.voice_id)} />
                      <button
                        className="choose-voice"
                        onClick={() => {
                          setVoice(v.voice_id);
                          window.history.pushState(null, "", "/studio");
                          window.dispatchEvent(new PopStateEvent("popstate"));
                        }}
                      >
                        Use this voice <ArrowUpRight size={17} />
                      </button>
                    </article>
                  ))}
                </div>
              )}
              {!catalog.isLoading && !filtered.length && (
                <div className="empty">
                  <Search />
                  No voices match your filters.
                </div>
              )}
            </>
          )}
          {page === "history" &&
            (!session ? (
              <div className="empty">
                <Clock3 />
                <h3>Your stories belong here.</h3>
                <p>
                  Sign in to see your generation history. No demo jobs or
                  fabricated results.
                </p>
                <Link className="action" href="/sign-in">
                  Sign in <ArrowUpRight size={17} />
                </Link>
              </div>
            ) : history.isLoading ? (
              <div className="empty">
                <Loader2 className="spin" />
                Loading history…
              </div>
            ) : history.isError ? (
              <p className="error">History could not be loaded.</p>
            ) : history.data?.length ? (
              <div className="history-list">
                {history.data.map((job) => (
                  <article key={job.id}>
                    <FileAudio />
                    <div>
                      <strong>{job.text.slice(0, 70)}</strong>
                      <p>
                        {new Date(job.createdAt).toLocaleString()} · {job.actualCost ?? job.cost}{" "}
                        {job.actualCost === null ? 'credits reserved' : 'credits billed'} · {job.status}
                        {job.durationMs !== null && ` · ${(job.durationMs / 1000).toFixed(2)} seconds`}
                      </p>
                      {job.error && <p className="error">{job.error}</p>}
                    </div>
                    {job.status === "succeeded" && (
                      <button
                        disabled={download.isPending}
                        onClick={async () => {
                          try {
                            const r = await download.mutateAsync({
                              id: job.id,
                            });
                            window.open(r.url, "_blank", "noopener");
                          } catch (e) {
                            setNotice(
                              e instanceof Error
                                ? e.message
                                : "Download failed.",
                            );
                          }
                        }}
                      >
                        Download <ArrowUpRight size={17} />
                      </button>
                    )}
                  </article>
                ))}
              </div>
            ) : (
              <div className="empty">
                <FileAudio />
                <h3>A blank page. A fresh start.</h3>
                <p>
                  You haven't generated any audio yet. Your finished stories
                  will appear here.
                </p>
                <Link className="action" href="/studio">
                  Write your first script <ArrowUpRight size={17} />
                </Link>
              </div>
            ))}
          {page === "billing" && <Billing notify={setNotice} />}
          {page === "clones" && <VoiceClones signedIn={!!session} notify={setNotice} />}
          {page === "account" && (
            <div className="account-panel">
              <div className="eyebrow">YOUR PROFILE</div>
              <h2>{session?.user.name ?? "Guest explorer"}</h2>
              <p>
                {session?.user.email ?? "You are exploring without an account."}
              </p>
              <hr />
              <p>Authentication: Google and email/password</p>
              <p>Plan: {wallet.data?.plan?.active ? `${wallet.data.plan.name} · until ${new Date(wallet.data.subscription!.periodEnd!).toLocaleDateString()}` : 'No active plan'} · <Link href="/billing">Plans & credits</Link></p>
              <p>Email: {session ? (session.user.emailVerified ? 'verified' : 'not verified yet') : '—'}</p>
              <p>
                Media policy: generated audio, videos, uploaded clips and images
                are deleted automatically after 30 days. Voice recordings used
                for cloning are deleted once the clone is checked.
              </p>
              <p className="muted">
                Remove a cloned voice any time from <Link href="/clones">My voices</Link>. Questions? Visit the <Link href="/support">support page</Link>.
              </p>
              {session && <DeleteAccount />}
              {session ? (
                <button className="action" onClick={() => authClient.signOut()}>
                  Sign out <LogOut size={18} />
                </button>
              ) : (
                <Link className="action" href="/sign-in">
                  Create your account <ArrowUpRight size={18} />
                </Link>
              )}
            </div>
          )}
          {page === 'account' && ownerStatus.data?.eligible && <OwnerPayments />}
          {isPending && <span className="muted">Checking session…</span>}
        </div>
      </main>
    </div>
  );
}
