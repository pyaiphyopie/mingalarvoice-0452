import { useState } from "react";
import { Link } from "wouter";
import {
  ArrowUpRight,
  ArrowRight,
  Plus,
  Minus,
  AudioLines,
  Mic2,
  Globe2,
  Check,
  Menu,
} from "lucide-react";
import { Brand, ArrowButton, Wave } from "../components/brand";
import { usePlans } from "../queries/plans";
import { tierFeatures, tierTagline } from "../lib/plans";

export default function Home() {
  const plans = usePlans();
  const [menu, setMenu] = useState(false),
    [faq, setFaq] = useState(-1),
    [my, setMy] = useState(false);
  const questions = [
    [
      "Does Mingalar Voice support Burmese?",
      "Yes. Every voice speaks Burmese Unicode through ElevenLabs v4. Paste Zawgyi text and some characters may read wrongly, so convert it to Unicode first. Listen to the Burmese previews in the voice library before you pick one.",
    ],
    [
      "Can I clone my voice?",
      "Your own voice only, on Studio (1 voice) and Business (3 voices). You record yourself reading a short Burmese consent sentence and keep talking for at least 20 seconds; we check the sentence before cloning. Clones pause if your plan lapses and are deleted after 30 days paused. You can delete a clone at any time.",
    ],
    [
      "How do subscriptions and credits work?",
      "1 credit is 1 second of voice; recap videos cost 2 credits per second. Creator is 25,000 MMK for 2,400 credits, Studio 59,000 MMK for 6,000 credits and Business 122,000 MMK for 12,600 credits, each for 30 days. Pay 3 months ahead to save 10%, or 6 months to save 15%. Pay by KBZPay; credits are added once the transfer is verified. Nothing renews automatically.",
    ],
    [
      "Is there a free trial?",
      "Yes. Verify your email address, or sign in with Google, and claim 180 credits for 14 days. That is about three minutes of voice or a 90-second recap. Trial videos carry a small watermark. One trial per person.",
    ],
    [
      "How do recap videos work?",
      "Upload your own clip (MP4, MOV or WebM), write the Burmese recap script and choose a voice. We narrate it, lower or replace the original sound, frame it 9:16 for TikTok and burn in Burmese captions. You also get the captions as an SRT file. Only upload clips you have the right to use.",
    ],
    [
      "Can I use the audio commercially?",
      "Yes, for content you have the rights to. Generated audio is produced on a paid ElevenLabs plan that allows commercial use. You remain responsible for your script, the clips you upload and how you publish them. Files are deleted after 30 days, so download what you want to keep.",
    ],
  ];
  return (
    <div className="landing">
      <div className="announcement">
        A new home for Burmese storytelling{" "}
        <span>Independent. Creator-first.</span>
      </div>
      <header className="topbar">
        <Brand />
        <nav className={menu ? "open" : ""}>
          <a href="#how">How it works</a>
          <a href="#voices">Voice library</a>
          <a href="#plans">Plans</a>
        </nav>
        <div className="header-actions">
          <button className="language" onClick={() => setMy(!my)}>
            {my ? "EN" : "မြန်မာ"}
          </button>
          <Link className="nav-cta" href="/studio">
            Open studio <ArrowUpRight size={16} />
          </Link>
          <button
            className="mobile-menu"
            aria-label="Toggle navigation"
            onClick={() => setMenu(!menu)}
          >
            <Menu />
          </button>
        </div>
      </header>
      <section className="hero section-wrap">
        <div className="hero-copy">
          <div className="eyebrow">
            <span className="dot" /> FOR TIKTOK MOVIE-RECAP CREATORS
          </div>
          <h1>
            {my ? (
              <span className="burmese-title">
                သင့်စိတ်ကူးကို
                <br />
                အသံပေးပါ။
              </span>
            ) : (
              <>
                YOUR RECAP.
                <br />
                REAL VOICE.
                <br />
                <span className="italic lavender-text">IN BURMESE.</span>
              </>
            )}
          </h1>
          <p>
            {my
              ? "သင့်စာသားကို မြန်မာအသံအဖြစ် ဖန်တီးပါ။"
              : "Upload your clip, paste your Burmese script and get a 9:16 recap with voiceover and burned-in captions. Or clone your own voice and never record a take again."}
          </p>
          <div className="hero-buttons">
            <ArrowButton href="/billing" light>
              Start free · 180 credits
            </ArrowButton>
            <a href="#how" className="text-link">
              See how it works <ArrowRight size={17} />
            </a>
          </div>
          <div className="hero-note">
            <Globe2 size={14} /> Built for Burmese creators. Pay by KBZPay.
            Powered by ElevenLabs.
          </div>
        </div>
        <div className="hero-art">
          <div className="art-top">
            <span>THE SOUND OF YOUR NEXT IDEA</span>
            <span>01 / VOICE</span>
          </div>
          <Wave />
          <div className="sound-pill">
            <AudioLines size={20} />
            <span>မင်္ဂလာပါ။ သင့်အသံနဲ့ စတင်လိုက်ပါ။</span>
          </div>
          <img
            src="/images/studio.jpg"
            alt="Microphone and recording equipment in a sound studio"
          />
          <div className="photo-label">
            LESS RECORDING.
            <br />
            MORE CREATING. <ArrowUpRight size={24} />
          </div>
          <div className="art-bottom">
            <span>STORYTELLING, WITHOUT THE STUDIO.</span>
            <span>✳</span>
          </div>
        </div>
      </section>
      <div className="ticker">
        {[
          "MOVIE RECAPS",
          "9:16 FOR TIKTOK",
          "BURNED-IN CAPTIONS",
          "YOUR OWN VOICE",
          "SRT EXPORT",
        ].map((t) => (
          <span key={t}>
            {t}
            <span>✳</span>
          </span>
        ))}
      </div>
      <section id="how" className="how section-wrap">
        <div className="section-heading">
          <div>
            <div className="eyebrow">A LITTLE TEXT. A LOT OF POSSIBILITY.</div>
            <h2>
              YOU BRING THE CLIP.
              <br />
              WE GIVE IT A VOICE.
            </h2>
          </div>
          <p>
            No mic check. No second take.
            <br />
            Just a simpler creative workflow.
          </p>
        </div>
        <div className="steps">
          {[
            [
              "01",
              "Upload your clip",
              "Add the scene you are recapping — MP4, MOV or WebM. Write or paste your Burmese recap script.",
            ],
            [
              "02",
              "Pick a voice — or yours",
              "Choose a Burmese-speaking library voice, or clone your own voice on Studio and Business.",
            ],
            [
              "03",
              "Post it",
              "Download a 9:16 MP4 with voiceover and Burmese captions, plus the SRT file. Narration-only MP3s too.",
            ],
          ].map(([n, h, p]) => (
            <article key={n}>
              <span className="step-num">
                {n}
                <ArrowUpRight size={25} />
              </span>
              <h3>{h}</h3>
              <p>{p}</p>
            </article>
          ))}
        </div>
        <div className="development-note">
          <Check size={16} /> 1 credit = 1 second of voice · recap video 2
          credits per second · unused reservations always returned
        </div>
      </section>
      <section id="voices" className="voices-section section-wrap">
        <div className="section-heading">
          <div>
            <div className="eyebrow">ONE SCRIPT. DIFFERENT POSSIBILITIES.</div>
            <h2>
              FIND YOUR
              <br />
              <span className="italic">SIGNATURE SOUND.</span>
            </h2>
          </div>
          <ArrowButton href="/voices">Explore voice library</ArrowButton>
        </div>
        <div className="voice-teasers">
          {[
            ["ကိုမင်း", "Warm storyteller", "JBFqnCBsd6RMkjVDRZzb"],
            ["မသီတာ", "Reassuring & confident", "EXAVITQu4vr4xnSDxMaL"],
            ["ကိုဟိန်း", "Steady broadcaster", "onwK4e9ZLuTAKqWW03F9"],
          ].map(([name, style, id], i) => (
            <Link
              href={`/voices?voice=${id}`}
              className="voice-teaser"
              key={name}
            >
              <div className="voice-art">
                <div className={`voice-orb orb-${i}`}>
                  <AudioLines size={48} />
                </div>
                <span>0{i + 1}</span>
              </div>
              <div className="voice-title">
                <h3>{name}</h3>
                <ArrowUpRight size={23} />
              </div>
              <p>{style}</p>
              <small>ElevenLabs voice · Burmese evaluation pending</small>
            </Link>
          ))}
        </div>
      </section>
      <section className="feature section-wrap">
        <div className="feature-photo">
          <img
            src="/images/studio.jpg"
            alt="A studio microphone ready for a recording"
          />
          <span>
            YOUR CREATIVE CORNER,
            <br />
            WHEREVER YOU ARE.
          </span>
        </div>
        <div className="feature-copy">
          <div className="eyebrow">MADE TO KEEP YOU IN FLOW</div>
          <h2>
            LESS SETUP.
            <br />
            MORE STORIES.
          </h2>
          <p>
            Keep your scripts, voices, recaps and captions in one place. Leave
            the recording booth behind — not your creative control.
          </p>
          <ul>
            <li>
              <Check size={18} /> A focused Burmese script editor
            </li>
            <li>
              <Check size={18} /> Recap videos with captions, framed for TikTok
            </li>
            <li>
              <Check size={18} /> Your cloned voice, with consent checked
            </li>
            <li>
              <Check size={18} /> Clear history and credit records
            </li>
          </ul>
          <ArrowButton href="/studio">Step inside the studio</ArrowButton>
        </div>
      </section>
      <section id="plans" className="plans section-wrap">
        <div className="section-heading">
          <div>
            <div className="eyebrow">ROOM FOR YOUR NEXT CHAPTER</div>
            <h2>
              A PLAN FOR
              <br />
              YOUR CREATIVE PACE.
            </h2>
          </div>
          <p>
            Pay by KBZPay. Save up to 15% ahead.
            <br />
            Transparent credits. No automatic renewal.
          </p>
        </div>
        {plans.isError ? (
          <p className="error">Plans could not be loaded. <button onClick={() => plans.refetch()}>Retry</button></p>
        ) : (
          <div className="plan-grid tiers">
            {(plans.data?.tiers ?? []).map((t) => (
              <article className={t.name === "Studio" ? "plan dark-plan" : "plan"} key={t.name}>
                <div className="eyebrow">
                  {t.name === "Studio" ? "MOST POPULAR" : t.name === "Business" ? "FOR TEAMS & PAGES" : "START HERE"}
                </div>
                <h3>{t.name}</h3>
                <div className="plan-price">
                  {t.amount.toLocaleString()} MMK
                  <span>30 days · {t.credits.toLocaleString()} credits</span>
                </div>
                <p>{tierTagline[t.name]}</p>
                <ul>
                  {tierFeatures(t).map((f) => (
                    <li key={f}><Check size={16} /> {f}</li>
                  ))}
                </ul>
                <Link className="plan-button" href="/billing">
                  Choose {t.name} <ArrowUpRight size={18} />
                </Link>
              </article>
            ))}
          </div>
        )}
        <p className="plan-disclaimer">
          Pay by KBZPay. Credits are added once your transfer is verified.
          Top-ups at 12 MMK per credit for active subscribers. Try it first
          with 180 free credits.
        </p>
      </section>
      <section className="faq section-wrap">
        <div>
          <div className="eyebrow">GOOD QUESTIONS. STRAIGHT ANSWERS.</div>
          <h2>
            LET'S CLEAR
            <br />
            THE AIR.
          </h2>
        </div>
        <div>
          {questions.map(([q, a], i) => (
            <div className="faq-item" key={q}>
              <button
                onClick={() => setFaq(faq === i ? -1 : i)}
                aria-expanded={faq === i}
              >
                {q}
                {faq === i ? <Minus size={20} /> : <Plus size={20} />}
              </button>
              {faq === i && <p>{a}</p>}
            </div>
          ))}
        </div>
      </section>
      <section className="closing section-wrap">
        <div className="eyebrow">YOUR NEXT STORY STARTS HERE</div>
        <h2>
          LET'S MAKE
          <br />
          <span className="italic lavender-text">SOME SOUND.</span>
        </h2>
        <ArrowButton href="/studio" light>
          Open your studio
        </ArrowButton>
        <Mic2 className="closing-icon" />
      </section>
      <footer className="section-wrap">
        <Brand />
        <div>
          <Link href="/studio">Studio</Link>
          <Link href="/video">Recap studio</Link>
          <Link href="/voices">Voice library</Link>
          <Link href="/billing">Plans & credits</Link>
          <Link href="/sign-in">Sign in</Link>
          <Link href="/support">Support</Link>
          <Link href="/privacy">Privacy</Link>
          <Link href="/terms">Terms</Link>
        </div>
        <div className="footer-bottom">
          <span>© 2026 Mingalar Voice. Independent by design.</span>
          <span>Built for stories worth hearing.</span>
        </div>
      </footer>
    </div>
  );
}
