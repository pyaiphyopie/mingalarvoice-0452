# Mingalar Voice — development status

## Web app complete: tiers, trial, cloning, recap — 27 October 2026
- **Plans** (`services/plans.ts`): Creator 25,000 MMK / 2,400 credits, Studio 59,000 / 6,000 (1 clone, 50% rollover), Business 122,000 / 12,600 (3 clones, 50% rollover, priority queue). Prepay 3 months −10%, 6 months −15%. Top-ups 1,000 / 2,500 credits at 12 MMK, active paid subscribers only. Approval grants the stored order values (the pending Studio order 859b0ec6… keeps 55,000 / 14,400 — owner approves it in the UI).
- **Free trial**: 180 credits for 14 days, verified email only, one per user (race-tested), watermarked videos.
- **Web UI** (all on the managed stack, port 4200):
  - `/billing` → `components/billing.tsx`: balance, trial card (claim / verify email), 1-3-6 month selector, three tier cards from the server price list, subscriber top-ups, order history (months, amount, credits), friendly ledger labels.
  - `/clones` "My voices" → `components/voice-clones.tsx`: consent sentence, MediaRecorder or file upload, signed PUT, clone list/delete, locked / slots-full / not-switched-on states. Ready clones appear in the voice and video pickers as "(your voice)".
  - `/video` → `components/video-studio.tsx`: **Recap my clip** (MP4/MOV/WebM up to 500 MB with upload progress, keep-quiet/remove original sound, fill/fit framing, plan-based script and reservation limits, watermark/priority note, SRT download) and **Narrate a picture**.
  - `/account`: plan, email verification state, **web account deletion** (`components/delete-account.tsx`: 15-minute re-auth + typed DELETE).
  - Owner panel: Business and both top-ups selectable; the verified-amount label shows the selected order's stored amount/credits/days.
  - Landing page rewritten for TikTok movie-recap creators: three tiers from the server, trial CTA, new FAQ (pricing, trial, recap, cloning, commercial use).
  - Legal pages: plans/KBZPay, trial, recap, cloning consent/pause/delete, clip rights, Resend as processor, rollover/watermark terms.
- **Verified 27 Oct**: `tsc -p tsconfig.app.json` clean (note: `bun run typecheck` runs `tsc --noEmit` on a references-only tsconfig and checks nothing — use the -p form), lint 0 errors, build OK, tests apple 6, billing 6, generation 5, payment-orders 8, payment-rail.e2e 17, tiers 11, video-render 4, video 5 (run each file in its own process). Playwright screenshots of billing / My voices / video / studio / account at 1440 and 390 px with mocked signed-in fixtures: no page errors, no overflow (`/home/user/shots/s8-*.png`).
- **Not verified (needs owner action / spend)**: email verification sends (no `RESEND_API_KEY`/`EMAIL_FROM`), a real clone + STT consent check (`VOICE_CLONING_APPROVED` unset, ElevenLabs key permissions unconfirmed), a live recap render (`VIDEO_GENERATION_APPROVED` unset), a live KBZPay approval of a new-tier order. Android screens for KBZPay/clone/recap are not built yet.

## Mobile upgraded to Expo SDK 58 — 24 October 2026
- Reason: the user's Expo Go is SDK 58 (it only runs SDK 58 projects). `bunx expo install expo@^58.0.0 --fix`: expo 58.0.19, react-native 0.88.0, react 19.3.0, expo-router 58.0.26, all expo-* at 58.x; mobile TypeScript is now ~6.0.3 (expo's pick); added expo-asset (expo-audio peer). Web package still on React 19.1 (separate bundle).
- app.json: removed `newArchEnabled` and `android.edgeToEdgeEnabled` (no longer in the schema), moved `splash` into the `expo-splash-screen` plugin config. `extra` and `scheme` untouched.
- Code: three strict-type fixes (tab icon color, RefreshControl onRefresh, ListEmptyComponent) and taller web tab bar (labels were clipped under the new layout).
- Verified: manifest reports `runtimeVersion exposdk:58.0.0`; iOS and Android Hermes dev bundles build (1,632 modules, one copy of react 19.3.0); Expo web at 390 px renders all five tabs and sign-in with no page or console errors and no overflow; expo-doctor 19/20 (remaining warning: same-version duplicate copies from Bun's isolated linker, only one copy ends up in the bundle); lint, typecheck, build pass. Backup of SDK 54 package.json/app.json/bun.lock in /home/user/backup/mobile-sdk54/.
- Not verified: opening it on a physical device in Expo Go 58. StoreKit stays off in Expo Go by design (lib/storekit.ts).

## Video generation — first build (21 October 2026; superseded above: jobs table, routes, worker, UI and charging are now wired in)
- Website only. Two types requested: narrated video (narration + background image + burned-in Burmese captions) and talking photo (portrait lip-synced to narration).
- **Narrated video renderer built and tested locally** (`packages/web/src/api/services/video-render.ts`, tests `tests/video-render.test.ts` 4 pass). ffmpeg + libass/HarfBuzz with Noto Sans Myanmar; stacked consonants and kinzi render correctly. 9:16 1080×1920 and 16:9 1920×1080, H.264/AAC, faststart.
- Measured on this 2-vCPU sandbox: 7 s clip renders in ~3.4 s; a 180 s video renders in ~46–48 s and is ~10 MB. No provider spend.
- Caption timing is currently proportional to line length (approximate). Production should use ElevenLabs alignment (with-timestamps) for exact sync.
- Since wired in (video_jobs, routes/video.ts, video-worker, recap-worker, UI, 2 credits/s settlement). ffmpeg presence in the deployed environment is still unverified.
- **Talking photo blocked:** the ElevenLabs key lacks `image_video_generation` (HTTP 401); Image & Video API needs Pro+. Provider cost per second is unpublished and must be measured with one approved paid test.

## Payment rail test — 21 October 2026
- New `tests/payment-rail.e2e.test.ts` (17 tests): real Hono app, real Better Auth sign-up/sessions, oRPC over HTTP, on a throwaway SQLite built from the LIVE Turso DDL (read-only pull; live DB never written). Run: `bun --env-file=.env test tests/payment-rail.e2e.test.ts`.
- KBZPay rail covered: guest/no-plan blocked, order reuse, reference normalization + bad-reference rejection, cross-account isolation, owner email+passphrase gate, mismatched plan/reference/method/customer refused, approval = 6,300 credits + 30 days exactly once (replay = duplicate), reference reuse across customers refused, rejection reason shown and nothing granted, paid credits reserve → duration settlement (7.2 s = 8 credits) with ledger reconciling to wallet, cross-session passphrase throttle.
- Apple rail covered: fails closed now (config disabled, redeem PRECONDITION_FAILED, webhook 503; Production without app ID stays closed); with Sandbox enabled, the production verifier with Apple's real roots rejects a correctly signed non-Apple JWS over HTTP (redeem and webhook, nothing recorded); with a local test PKI through the same Apple library: grant once, replay duplicate, bound to buying account, tampered/wrong product/env/bundle/refunded/qty 2/non-consumable/foreign token rejected, both packs, Apple pool funds generation without plan and refunds failed jobs, REFUND revokes once, REFUND_REVERSED reinstates, ledger reconciles.
- **Bug fixed:** owner throttle counted every owner action, so after 10 actions in 15 min (e.g. load queue + several approvals) the owner was locked out even with the right passphrase. `services/owner.ts` now counts only failed passphrase attempts; 10 failures still lock everything for 15 min across sessions.
- Also passing: apple 6, billing 6, generation 5, payment-orders 6, `tests/payment-browser.py` UI fixture, lint, typecheck, build. Preview webhook reachable; proxy rewrites the 503 to 502 (Apple retries any non-2xx).
- Still untested: a real KBZPay transfer + owner approval on the live DB, a real StoreKit sandbox purchase/refund (needs Apple setup and a device build).

## Native iOS app (packages/mobile) — 15 October 2026
Release checklist and blockers: APP_STORE.md. **Not built for iOS, not signed, not submitted; no real Apple purchase or Sign in with Apple test performed.**
- Expo SDK 54 app: Studio, Voices (3 real Burmese previews), History (play/share, 30-day expiry), Credits (Apple IAP only, no KBZPay), Account (support/privacy/terms, sign-out, in-app deletion). Apple + email sign-in through managed auth / Better Auth bearer in SecureStore.
- Bundle com.mingalarvoice.k7q2; consumables .credits6300 / .credits14400; Apple credits never expire, separate pool from web plans. One pool must cover each reservation (UI now explains this).
- Server IAP fails closed: APPLE_IAP_ENABLED unset, so StoreKit never connects and the Credits tab says purchases are unavailable.
- This round: fixed Metro "@/..." alias failure (template TypeScript 7 RC has no JS API, so Expo cannot read tsconfig paths) by switching mobile imports to relative paths; email sign-in exception handling; query reset on sign-in; signed-out cache purge of shared MP3s; audio load-failure/timeout handling; serialized StoreKit connect/disconnect; truthful redelivery message; Studio voice gating; web-preview tab-bar label clipping.
- Backend: account deletion re-checks jobs inside the transaction (aborts if a narration started/finished meanwhile); partial-audio-deletion error no longer claims "nothing was removed". New race test.
- Verified: mobile tsc; root build, lint, typecheck; apple 6, billing 6, generation 5, payment-orders 6 tests pass; `expo config --type prebuild` resolves bundle ID/plugins/scheme; `expo export --platform ios` produces a Hermes bundle; Expo web preview at 390px light/dark has no overflow; end-to-end in preview: email sign-up → signed-in Studio/Credits/History/Account → delete account → re-login rejected; Roger preview MP3 loads (206) and plays.
- Schema decision: **never run `bun run db:push` on production.** Live Turso matches the Drizzle schema (17 tables; columns, NOT NULL, indexes, uniques). Push fails on `credit_pool` and would rebuild many tables only because the raw-SQL additive migrations differ textually from Drizzle DDL. Future changes: additive script + backup, then `packages/web/scripts/check-schema.ts` (read-only; exit 1 on drift; verified to detect a renamed column). Remote was never modified by the push investigation.
- Not verified: native iOS runtime, expo-iap 6.0.2 on SDK 54 in a real build (docs: SDK 53+ supported, 57 validated), Sign in with Apple native flow, StoreKit sandbox purchase/refund, share sheet, prebuild of native project. expo-dev-client intentionally not installed.

## Burmese preview batch — 15 October 2026
- User authorized all 21 library previews with a $10 USD ceiling and no script preference. Used the proposed 88-character Burmese greeting, eleven_v4, language my. Published v4 API price checked at https://elevenlabs.io/pricing/api: $0.08/1,000 characters; conservative fourfold batch estimate $0.59136.
- Three successful clips: ကိုအောင် / Roger, မနှင်း / Laura, ဦးတင် / Bill. Each response reports 88 provider credits, total 264. List-rate estimate for successes $0.02112 before taxes; actual invoice unavailable because API key lacks user_read. No top-up or credit purchase performed.
- Remaining 18 requests rejected: 13 HTTP 429 and five HTTP 401. No automatic retries performed. Durable manifest scripts/burmese-previews-manifest.json prevents repeat dispatch. Never silently reuse a different voice's clip.
- Three MP3s and Burmese VTT transcripts in public/audio/burmese-previews. Full FFmpeg decode and measured durations pass (6.43–7.08 seconds). Both library and Studio display matching Burmese audio controls or explicit unavailable state, plus the script transcript. No English previews restored.
- Browser verifies actual playback of ကိုအောင် and no mobile overflow. Build/lint and eleven billing/generation tests pass. Batch audio quality has not been native-speaker reviewed; only prior ကိုမင်း sample had user approval.

## Burmese-only library output — 15 October 2026
- User chose Burmese generation for every existing preset, not replacement with native-speaker clones. Every generation uses eleven_v4 and forced language_code my, retaining selected provider voice IDs.
- Removed original English audio players from both Voice Library and Studio. Catalog no longer exposes provider preview URLs and marks each public preset outputLanguage my. Library cards show Burmese output; descriptions distinguish multilingual presets from native-Burmese identity and retain the single-sample quality caveat.
- Build/lint, eleven billing/generation tests and mobile browser regression pass. Tests verify preview URL omission, Burmese request language/model/selected voice ID, no audio players on library/Studio and voice selection preserving the provider ID. No new paid generation, previews or credit grants.

## Current activation — 15 October 2026
This checkpoint supersedes historical disabled-generation notes below.
- User explicitly requested enabling voice generation. Root generation switch is now true. PM2 generation-worker runs one serial dispatch at a time, auto-restarts and is saved in the process list. Preview API restarted and generationReady verified true against a fresh database heartbeat.
- New worker-health table gates API admission: missing credentials, paused switch or heartbeat older than 60 seconds blocks reservation. Credentials are configured; no values are exposed.
- Only authenticated customers with active verified paid access and sufficient credits can queue jobs. No free credits or owner bypass added. Browser verifies enabled status and rejects a new unpaid account without queuing a job.
- Five new isolated tests pass: switch/heartbeat/access/balance guards; idempotent reservation and owned history/download; sample reuse duration settlement; explicit rejection refund and uncertain/crash no-retry; competing separate worker connections dispatch once. Existing twelve billing/payment tests pass. Tests reuse the approved MP3 and mock provider/storage; no additional paid generation or real credit grants occurred.
- Worker supervised startup required direct Bun execution: PM2's Bun require wrapper rejected an async module. Config now invokes /usr/bin/bun directly, and final worker process was online with zero restarts and a fresh heartbeat.
- Preview browser and payment fixture regressions, build, lint and API health pass. Bundle-size advisory remains.
- This activates the current preview/runtime and adds worker to the existing deployment process configuration. Separate published-runtime operation has not been verified. PM2 process list is saved, but host boot integration is not installed here.
- Remaining operational limitations: no automated reconciliation for uncertain jobs, no retention cleanup, no remote Turso contention/crash test and no new paid end-to-end generation this round. Uncertain jobs keep credits reserved for manual review and never automatically repeat the paid provider call.

## Latest payment and voice changes
- Voice display names are Burmese aliases; provider IDs remain unchanged. Original English previews have been removed. Aliases do not establish Burmese-native voice quality.
- Manual payment replaces recurring subscriptions. Creator: 25,000 MMK / 6,300 credits; Studio: 55,000 MMK / 14,400 credits; 30-day access after owner verification.
- Buy opens the owner-supplied KBZPay/bank instructions with copy controls and Telegram contact.
- Scripted payment-assistant UI explains how to pay and prepares a message template; it does not send receipts, contact the owner or approve payments.
- Owner review/credit grants require the owner email plus a private approval passphrase, with persistent throttling, a unique transfer reference and transactional grants. Isolated backend lifecycle and payment contention tests pass; browser owner controls are tested with fixtures, not a real merchant settlement. Generation remains disabled; Buy or a receipt alone cannot grant access.

## Verified in this build
- Independent editorial landing page and responsive Studio, Voices, History, Billing and Account screens.
- Managed database schema applied successfully.
- ElevenLabs account discovery returned Burmese-capable v4 models and real voice metadata.
- Email/password account creation and session-backed access tested in the browser.
- Voice catalog search and favorites persisted across reloads.
- Guest generation guard and 390px Studio overflow check passed.
- Build and lint passed before this status update; bundle-size advisory remains.

## Implemented but not validated end to end
- Managed Google sign-in integration (interactive provider login not tested).
- Duration billing now reserves an explicit customer-selected ceiling, rounds measured audio seconds up, refunds the unused reservation and absorbs overruns. Sequential settlement/refund and missing-reservation rollback regression tests pass; contention and crash tests remain pending.
- Single-job worker with leases, private object upload, settlement/refund and uncertain outcomes.
- Owner-authorized download procedure is implemented; user-level end-to-end isolation remains untested. A diagnostic upload of the real generated MP3 passed signed download, byte comparison and unsigned-access rejection (403); the diagnostic object was removed.

## Not ready / blocked
- Generation is disabled by default. No synthetic successful results or purchased credits.
- Manual settlement verification still requires the owner to inspect real merchant records. Receipt ingestion is not implemented; real owner-session/merchant-settlement end-to-end validation remains pending.
- One authorized short ElevenLabs v4 Burmese generation passed (HTTP 200, 7.079 seconds, MP3 44.1kHz mono, reported provider cost 86). The user rated it natural Burmese and approved continuing with ElevenLabs. This approves the single tested preset/sample, not every voice or cloned/designed voice.
- No operational worker runner is deployed. Worker entrypoint: `bun --env-file=.env worker.ts`; do not enable before release gates pass.
- Email verification/recovery, profile editing, deletion, production legal policies, retention cleanup, administration and observability remain incomplete.
- Provider previews have no supplied transcript; captions need real transcripts rather than placeholder text.
- Marketing locale toggle is partial, not full app localization.

## Next integration decisions
The owner-only transfer review and credit-grant workflow is implemented; verify real settlement against merchant records before granting access. Confirm rollover/refund policies. Authorize a bounded Burmese evaluation set before spending provider credits. Complete job contention/recovery and worker deployment checks before enabling paid generation.

This is an explorable development foundation, not a complete production first release.

## Bug-fix checkpoint — 15 October 2026
- Public catalog now permits only premade provider voices; private clones, designed voices and unknown categories are excluded.
- Transfer references cannot be replayed under a different payment-method label; early renewal cannot shorten existing access.
- Worker settlement now checks the reserved balance, returns an explicit settlement outcome and does not report success after a rejected settlement.
- Provider request ID is saved before reading/parsing the audio body; queued jobs are processed oldest-first.
- Added standalone billing/security regression tests using an isolated temporary SQLite database; no provider spending or real customer balance changes.
- Updated Burmese alias browser tests and mobile form styling; guest guard, signup, empty history, catalog search and favorites persistence passed.
- Additive database migration applied and verified after Drizzle push failed on duration columns. Build and lint passed; bundle-size advisory remains.

## Audio checkpoint
- User-approved test: ကိုမင်း / George, eleven_v4, Burmese language code my. No alternative engine or additional paid generation was needed.
- Same audio parsed by the app's metadata library: 7.079 seconds → 8 app credits; 120-credit diagnostic reservation → 112-credit calculated refund. No customer ledger was charged by this diagnostic.
- Private Tigris upload and 60-second signed retrieval passed with exact bytes. Unsigned retrieval returned 403. Test object deletion completed.
- Outstanding before enabling all customer generation: real owner-session approval validation, remote-database payment contention, job concurrency and crash recovery, durable deployed worker, operational spend controls.

## Pending KBZPay orders checkpoint
- Customers can create/reuse a pending Creator or Studio KBZPay order, pay to 09400080040 and submit a normalized transaction reference. Neither creating nor submitting grants credits.
- Owner queue requires the private passphrase; approval checks matching customer, plan, MMK amount, credits, method and reference. Approval atomically marks the order approved, records the transfer, grants credits, writes the ledger and activates 30-day access. Rejection records a reason and grants nothing.
- A partial unique index prevents duplicate open orders per customer/plan. Transfer references remain globally unique at settlement; reference replay cannot grant another order.
- Billing shows customer-owned order history. The dialog distinguishes separate owner-assisted KBZ Bank transfers from app KBZPay orders. Receipts remain through Telegram; no upload or automated gateway is implemented.
- Owner passphrase fields and mutation observers reset after protected actions; owner mutation cache has zero retention once inactive.
- Six isolated payment tests cover authentication/authorization, user isolation, normalization, create/reuse, submission without grants, approval/replay, mismatched details, rejection, transactional rollback on ledger failure and contention through separate local SQLite connections. Remote Turso contention and real merchant approval remain untested.
- Browser fixtures verify customer submission, owner queue selection/approval, passphrase clearing, approved orders not reused and 390px dialog overflow. Fixtures never grant real credits or submit real payment orders.
- Existing browser signup, catalog, favorites, guest guard and empty-history regression suite passes. Existing six duration/security regression tests pass. Additive order migration and unique index applied. Build/lint pass; Vite bundle-size advisory remains.