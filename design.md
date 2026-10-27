# Mingalar Voice

Independent Burmese narration studio; responsive web. Reference: supplied editorial Collab image. Interpret its alternating black/white/periwinkle surfaces and large uppercase typography, not its brand or wording.

## Tokens
Ink #101010, paper #faf9f6, periwinkle #b3aff8, lavender light #e9e7ff, muted #77766f, border #deddd6. Square section edges, 6px UI radii, pill navigation and CTAs. 1160px content max; 24px mobile gutters; 80–110px section padding.

## Typography
Arial/Helvetica bold editorial display with tight tracking; Poppins body paired with Noto Sans Myanmar for Burmese. Display 88px desktop/46px mobile. Body 14–17px. Small uppercase monospaced labels. Comfortable Burmese line height 1.9.

## Layout
Black navigation and split hero with oversized stacked headline, periwinkle CTA, original waveform composition and studio photo. Horizontal use-case ticker. White numbered workflow. Periwinkle voice-library section. Dark closing CTA and warm neutral footer. No fictional testimonials, metrics, prices or completed audio.

Studio: dark sidebar, paper work area, black heading, large script editor, right-hand voice selector and generation settings. History and billing keep the same restrained shell. No original English preview players in Studio or the library. Each library card indicates Burmese output; selection retains the provider voice ID and generation forces language code my. Do not imply native-Burmese speakers or individually verified quality for all presets.

## Routes and states
## Burmese previews
Restore native audio controls only for locally generated Burmese previews with matching provider IDs. Label them Burmese previews, preload none, show the exact script in a collapsible transcript and provide Burmese VTT text. Missing previews explicitly say unavailable; never substitute another voice or an English recording. Three clips currently exist; provider rejected the remaining batch requests.

/ home; /sign-in combined sign-in/sign-up; /studio; /voices; /history; /billing; /account. Owned data and generation are protected server-side. Public studio exploration can show editor without granting access. Loading, error, disabled integration, zero-credit, empty-history states must be explicit. Managed Google and email/password; after sign-in return to Studio.

## Pending payment orders
The existing payment dialog includes a sign-in guard, pending KBZPay order ID and transaction-reference submission. Statuses are plain-language pending payment, pending review, approved or rejected; never show credits as granted before approval. Billing shows customer-owned order history and rejection reasons. Account owner controls show the protected review queue and require explicit settlement verification. KBZ Bank remains a separate owner-assisted transfer, not a KBZPay order. Long identifiers wrap on mobile; errors, loading and retry states remain explicit. Receipts are sent separately through Telegram, never automatically uploaded.

## Integration status
Generation activation keeps the current layout. Studio status reflects the server switch and recent worker heartbeat, not a hard-coded success label. Verified paid access and sufficient credits still apply. Quality copy distinguishes the approved single Burmese preset/sample from unreviewed voices. Billing/payment copy explains active duration billing without claiming every voice has passed review.
ElevenLabs discovery verified; model eleven_v4 with Burmese my. Real generation remains gated by server entitlement and verified credits. Payments are manual via owner-supplied KBZPay and KBZ Bank instructions. Creator 25,000 MMK/2,400 credits, Studio 59,000/6,000 (1 clone), Business 122,000/12,600 (3 clones); prepay 3 months −10%, 6 months −15%; subscriber top-ups at 12 MMK/credit; free trial 180 credits/14 days (verified email). 30 days per month paid after manual verification, no auto-renewal. Prices always come from the server price list (`paymentOrders.plans`), never hard-coded in UI. Buy opens an accessible payment dialog with copy controls, Telegram contact and a clearly labeled scripted assistant guide. It does not submit or verify receipts. Burmese-only display aliases preserve actual provider IDs and do not assert voice nationality. No active paid plan or fake payment result. No free production allowance without explicit budget authorization.
## iOS app (packages/mobile)
Same identity, native shell. Light: paper #faf9f6 background, ink #101010 text, periwinkle #b3aff8 primary surfaces/CTAs, lavender #e9e7ff tints, border #deddd6, muted #77766f. Dark: ink background, #1a1a1a cards, periwinkle accent, paper text. Poppins (400/600/700) for Latin UI; Noto Sans Myanmar (400/700) for every Burmese string, line height ≥1.8×. Screen titles: Poppins 700, 34px, uppercase, tight tracking, with a small Burmese subtitle. Pill CTAs (radius 999), 10px card radius, 20px gutters.
Tabs: Studio, Voices, History, Credits, Account. Studio = large Burmese script editor, selected-voice strip, reservation stepper, explicit status (worker offline/paused, signed out, zero credits). Voices = list with Burmese alias, provider name, favorite heart, Burmese preview play button only for the three real clips; others read "Burmese preview unavailable". History = jobs with status chips, play/share when succeeded. Credits = App Store packs with StoreKit-localized prices only; when Apple is not configured, show "App Store purchases are not available yet" and no prices. Plan credits from elsewhere are shown as a neutral balance with expiry, with no external purchase links or mentions (App Store 3.1.1). Account = email, sign out, support/privacy/terms links, delete account (re-authentication + typed DELETE).
Sign-in sheet: Sign in with Apple first (black pill), Google, then email/password. Keyboard-avoiding forms, SafeAreaView on every screen.

## Session 8 additions (web)
- Plans: three tier cards in one row (`.plan-grid.tiers`, stacks under 900 px); Studio is the dark card. Trial card is solid periwinkle. Top-ups are two white row buttons.
- My voices: consent sentence in Noto Sans Myanmar 19 px on pale periwinkle with a periwinkle left rule; recording button turns red with a soft pulse.
- Video studio: mode tabs "Recap my clip" / "Narrate a picture" in the panel title; clip preview is a 9:16 black frame reflecting fill/fit.
- Destructive actions (account deletion) use a pale red zone, never the main ink button.
