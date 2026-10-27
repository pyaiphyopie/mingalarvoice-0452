import { Link, useRoute } from "wouter";
import { Brand } from "../components/brand";

const SUPPORT = "pyaiphyopie@gmail.com";
const UPDATED = "Draft prepared for review — not yet in effect";

type Section = { heading: string; body: (string | string[])[] };
type Doc = { title: string; burmese: string; intro: string; sections: Section[] };

const docs: Record<"support" | "privacy" | "terms", Doc> = {
  support: {
    title: "Support",
    burmese: "အကူအညီ",
    intro: "Help with the Mingalar Voice website and apps: sign-in, plans and KBZPay orders, the free trial, narration and recap videos, cloned voices and account deletion.",
    sections: [
      { heading: "Contact", body: [`Email ${SUPPORT}. Include the email address of your Mingalar Voice account and, for a purchase, the date and the Apple order ID from your App Store receipt. Never send passwords, PINs or one-time codes.`, "We aim to reply within 3 business days. Response time is a goal, not a guarantee."] },
      { heading: "Plans and KBZPay orders", body: ["On the website, choose Creator, Studio or Business for 1, 3 or 6 months (3 months saves 10%, 6 months 15%), create an order, transfer the exact amount by KBZPay and submit the transaction reference. Credits are added when we have verified the transfer in our own records, usually within one business day. Nothing renews automatically.", "Top-ups (1,000 or 2,500 credits at 12 MMK per credit) are for active subscribers and do not extend your plan. If an order is rejected, the reason is shown in your order history; contact us if you believe it was a mistake."] },
      { heading: "Free trial", body: ["New accounts with a verified email address (or Google sign-in) can claim 180 credits once. They last 14 days. Trial videos carry a small watermark."] },
      { heading: "App Store purchases", body: ["Credit packs bought in the iOS app are processed by Apple. Apple handles charges, receipts and refund requests at reportaproblem.apple.com. We never see your card details.", "If a completed purchase does not show credits, keep the app open while signed in to the same account and pull to refresh on the Credits tab; the app retries verification automatically. If credits still do not appear, email us with the Apple order ID.", "Apple-purchased credits do not expire. If Apple refunds a purchase, the unspent credits from that purchase are removed."] },
      { heading: "Narration and recap jobs", body: ["Each job reserves a maximum number of credits. Narration costs one credit per second of measured audio and videos two credits per second of finished video, rounded up; unused credits return automatically. If a clip cannot be read, the whole reservation is returned. If a job is shown as needing review, its credits stay reserved until we reconcile it manually — contact us with the job time."] },
      { heading: "Cloned voices", body: ["Studio includes one cloned voice and Business three. You may only clone your own voice. If the consent sentence is not recognised at the start of your recording, read it clearly first and try again. Delete a clone at any time from My voices; if your plan lapses the clone is paused and is deleted after 30 days."] },
      { heading: "Delete your account", body: ["Website: Account settings → Delete my account (you will be asked to sign in again if your last sign-in is older than 15 minutes). iOS app: Account → Delete account. Deletion permanently removes your profile, sign-in methods, scripts, generated audio and video, uploaded clips, cloned voices, favorites and remaining credits. See the Privacy Policy for the limited records we keep."] },
    ],
  },
  privacy: {
    title: "Privacy Policy",
    burmese: "ကိုယ်ရေးအချက်အလက် မူဝါဒ",
    intro: "How Mingalar Voice collects, uses and shares information when you use the website and iOS app.",
    sections: [
      { heading: "Who we are", body: [`Mingalar Voice ("we") operates this service. Contact: ${SUPPORT}. The operator's legal name and postal address will be added here before public release.`] },
      { heading: "Information we collect", body: [[
        "Account: email address, name and profile image provided by you or by Sign in with Apple / Google, plus sign-in sessions. If you use Hide My Email, we receive Apple's relay address.",
        "Content: Burmese scripts you submit, the voice you choose, generated audio and video files, captions, video clips and background images you upload, and saved favorite voices.",
        "Voice cloning (only if you use it): the recording of your voice, a transcript of its opening used to check the consent sentence, and the cloned voice created from it. A voice recording is biometric information; we use it only to create the voice you asked for.",
        "Credits and payments: credit balances and ledger entries; for App Store purchases, Apple transaction identifiers, product and purchase date (no card details); for KBZPay transfers, the plan, months, amount and transfer reference you submit; whether you have claimed the free trial.",
        "Usage: privacy-focused page and screen analytics and technical logs (for example request times and errors) used to operate and secure the service.",
      ]] },
      { heading: "How we use it", body: ["To provide sign-in, generate and deliver narration, keep balances accurate, verify purchases and refunds, prevent fraud and abuse, answer support requests and improve reliability. We do not sell personal information and do not use it for third-party advertising or cross-app tracking."] },
      { heading: "Service providers", body: [[
        "Runable — application hosting, sign-in broker and analytics.",
        "Turso — database hosting.",
        "Tigris — private audio, video and image file storage.",
        "ElevenLabs — receives your script text and chosen voice to generate speech; if you clone your voice, your recording to transcribe the consent check and to create the clone.",
        "Resend — sends account emails such as email verification.",
        "Apple — App Store payments and Sign in with Apple; Google — Google sign-in on the website.",
      ], "These providers process data on our behalf and may store it outside your country."] },
      { heading: "Retention", body: ["Account data is kept while your account exists. Generated audio and video, captions, narration tracks and clips or images you upload for videos are deleted automatically 30 days after creation (a job still being processed or reviewed keeps its files until it is settled). Voice recordings for cloning are deleted as soon as the clone has been checked, whether or not it succeeds. A cloned voice is deleted at the provider when you delete it, when you delete your account, or 30 days after it was paused because your plan lapsed. Scripts and generation history stay until you delete your account. Purchase, transfer and credit-ledger records are kept, without your profile, after account deletion for accounting, refund and fraud-prevention purposes."] },
      { heading: "Your choices", body: ["You can delete your account on the website (Account settings → Delete my account), in the iOS app (Account → Delete account) or by emailing us. You can delete a cloned voice at any time from My voices. You can ask us to access, correct or delete your information. Local laws may give you further rights."] },
      { heading: "Children", body: ["The service is not directed to children under 13, and we do not knowingly collect their information."] },
      { heading: "Changes", body: ["We will update this page and the date above when this policy changes."] },
    ],
  },
  terms: {
    title: "Terms of Use",
    burmese: "အသုံးပြုမှု စည်းမျဉ်းများ",
    intro: "Rules for using Mingalar Voice on the web and in the iOS app.",
    sections: [
      { heading: "The service", body: ["Mingalar Voice turns Burmese text into synthetic speech using third-party AI voices, and can add that voiceover and captions to video clips you upload. Library voices are presets with Burmese display names; they are not recordings of, or endorsements by, real Burmese speakers. Pronunciation and quality vary by voice and are not guaranteed."] },
      { heading: "Accounts", body: ["Keep your sign-in secure. You are responsible for activity on your account. We may suspend accounts used for fraud, abuse or unlawful content."] },
      { heading: "Acceptable use", body: ["Do not generate content that is unlawful, defamatory, harassing or deceptive, that impersonates a real person without consent, or that infringes others' rights. You are responsible for the scripts you submit and how you use the audio.", "Only upload video clips you have the right to use and publish. Recaps of films and shows may be subject to the rights holder's and the platform's rules; you are responsible for complying with them. We remove content when we receive a valid rights complaint."] },
      { heading: "Voice cloning", body: ["You may clone only your own voice. Each recording must open with the Burmese consent sentence shown in the app, read by you; recordings that do not are rejected and deleted. Cloning someone else's voice, or a recording of someone else, is prohibited and leads to account closure. A cloned voice is available only to you and only while your Studio or Business plan is active; it is paused when the plan lapses and deleted after 30 days paused."] },
      { heading: "Credits", body: ["Credits are a prepaid allowance for generation, are not money and cannot be transferred or exchanged for cash. One credit covers one second of generated audio, rounded up per job. Narrated and recap videos cost two credits per second of finished video, rounded up per job.", "Website plans (Creator, Studio, Business) last 30 days per month paid, and their credits are usable during that period. When you renew Studio or Business before the period ends, 50% of unused plan credits carry over; otherwise unused plan credits expire. Top-up credits follow your plan period. The free trial gives 180 credits for 14 days, once per person. Creator and trial videos carry a small watermark.", "Prices are shown in MMK before you pay and are fixed for that order. KBZPay payments are verified manually and do not renew automatically. Refunds of verified transfers are at our discretion except where the law requires otherwise.", "Apple In-App Purchase credits do not expire while your account exists.", "Purchases in the iOS app are processed by Apple under Apple's terms. Refunds for App Store purchases are handled by Apple; credits from refunded purchases are removed. Remaining credits are forfeited when you delete your account."] },
      { heading: "Your content", body: ["You keep your rights in your scripts. You give us permission to process them and to store the resulting audio to provide the service. Subject to these terms and the voice provider's terms, you may use the audio you generate."] },
      { heading: "Availability and liability", body: ["The service is provided as is. Generation may be paused or unavailable. To the extent permitted by law, our liability is limited to the amount you paid in the 12 months before a claim."] },
      { heading: "Apple", body: ["These terms are between you and Mingalar Voice, not Apple. Apple has no obligation to provide support or maintenance for the app and is not responsible for claims about it. Apple and its subsidiaries are third-party beneficiaries of these terms for the iOS app."] },
      { heading: "Contact", body: [`Questions: ${SUPPORT}.`] },
    ],
  },
};

export default function Legal() {
  const [, params] = useRoute<{ page: string }>("/:page");
  const key = (params?.page ?? "support") as keyof typeof docs;
  const doc = docs[key] ?? docs.support;
  return (
    <div className="legal-page">
      <header className="topbar"><Brand /></header>
      <main className="section-wrap legal-body">
        <p className="eyebrow">{doc.burmese}</p>
        <h1>{doc.title}</h1>
        {key !== "support" && <p className="legal-draft" role="note">Draft — pending review by the operator and a qualified legal adviser. {UPDATED}.</p>}
        <p className="legal-intro">{doc.intro}</p>
        {doc.sections.map((s) => (
          <section key={s.heading}>
            <h2>{s.heading}</h2>
            {s.body.map((b, i) => Array.isArray(b)
              ? <ul key={i}>{b.map((li) => <li key={li}>{li}</li>)}</ul>
              : <p key={i}>{b}</p>)}
          </section>
        ))}
        <nav className="legal-links" aria-label="Policies">
          <Link href="/support">Support</Link><Link href="/privacy">Privacy</Link><Link href="/terms">Terms</Link><Link href="/">Home</Link>
        </nav>
      </main>
    </div>
  );
}
