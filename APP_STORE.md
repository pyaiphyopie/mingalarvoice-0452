# Mingalar Voice — iOS App Store release checklist

Status on 2026-10-15: **not submitted. No iOS build, signing credentials, sandbox purchase or App Store Connect record exists yet.**
In-app purchases are switched off on the server (`APPLE_IAP_ENABLED` unset), so the app shows "App Store purchases are not available yet" and never connects to StoreKit.

Fixed identifiers (already in code — use exactly these in Apple's portals):

| Item | Value |
|---|---|
| App name | Mingalar Voice |
| Bundle ID | `com.mingalarvoice.k7q2` |
| Consumable 1 | `com.mingalarvoice.k7q2.credits6300` — 6,300 credits |
| Consumable 2 | `com.mingalarvoice.k7q2.credits14400` — 14,400 credits |
| Apple ID for the developer account | `phyopie96@icloud.com` (enrollment not confirmed) |
| Support email | `pyaiphyopie@gmail.com` |
| Server notifications URL | `https://<production-domain>/api/webhooks/apple` |
| Support / Privacy / Terms | `https://<production-domain>/support`, `/privacy`, `/terms` |

Apple credits never expire, are separate from the 30-day web plans, and are the only way to buy credits in the iOS app. The iOS app has no KBZPay links or mentions of web prices.

---

## 1. Apple Developer Program (owner — only you can do this)
- [ ] Enroll `phyopie96@icloud.com` in the Apple Developer Program (US$99/year). Individual enrollment shows your personal legal name as the seller; an organization needs a D-U-N-S number.
- [ ] Turn on two-factor authentication on the Apple ID. Never share the password or codes with anyone, including this assistant.
- [ ] App Store Connect → Business: accept the **Paid Apps agreement**, add bank account and tax forms. Products cannot be sold until this is "Active".
- [ ] Optional: apply for the App Store Small Business Program (lower commission) once the account is active.

## 2. Identifiers and the app record
- [ ] Certificates, Identifiers & Profiles → register App ID `com.mingalarvoice.k7q2` (In-App Purchase is enabled by default; leave Sign in with Apple enabled if you register it).
- [ ] App Store Connect → My Apps → New App: platform iOS, name "Mingalar Voice", primary language, bundle ID above, SKU of your choice.
- [ ] Copy the numeric **Apple ID of the app** (App Information page). It is needed for `APPLE_APP_APPLE_ID` and for `ascAppId` in `packages/mobile/eas.json`.

## 3. In-app purchase products
- [ ] Create two **Consumable** products with the exact product IDs above.
- [ ] Choose prices from Apple's price points. $9.99 and $19.99 were only suggestions; nothing in the app hard-codes a price. The app shows Apple's localized price.
- [ ] Add a display name and description for each (for example "6,300 credits", "About 105 minutes of Burmese narration, never expires").
- [ ] Add a review screenshot for each product (the Credits tab after StoreKit loads).
- [ ] Status must reach "Ready to Submit". The first products are submitted **with** the first app version.

## 4. Server configuration (needed before purchases can be tested)
Put these in the root `.env` of the deployed app (never anywhere else), then restart the web server and `generation-worker`:

```
APPLE_IAP_ENABLED=true
APPLE_ENVIRONMENT=Sandbox            # switch to Production only for the live release
APPLE_APP_APPLE_ID=<numeric app id>  # required for Production
```

- [ ] App Store Connect → App Information → App Store Server Notifications: set **Version 2**, Sandbox and Production URL to `https://<production-domain>/api/webhooks/apple`. Use "Request a Test Notification" and check it is accepted.
- [ ] Publish the website to its production domain and point `expo.extra.apiUrl` at it (the platform manages this field). The current URL is a development preview.
- [ ] Confirm the published `generation-worker` starts on boot and stays online (not yet verified).
- [ ] Before enabling: review the open items in §8.

## 5. Build and TestFlight
Builds run on Expo's EAS servers from the Runable mobile dashboard (publish option, connect your Expo account). Do **not** build in the sandbox.

- [ ] Link an Expo/EAS project and let EAS create the distribution certificate and provisioning profile through its Apple login (you sign in yourself).
- [ ] Builds must use Xcode 26 / iOS 26 SDK or later (Apple requirement since 28 April 2026). Use the default EAS image for Expo SDK 54.
- [ ] `expo-iap` does not work in Expo Go or the web preview. Test purchases with an internal `preview` build or a TestFlight build on a **physical iPhone**. There is no development-client profile; add `expo-dev-client` and a `development` profile only if you want a dev build. It changes how `expo start` opens the app.
- [ ] Add `ascAppId` to `submit.production.ios` in `eas.json` after §2.
- [ ] Upload a production build to TestFlight (`autoIncrement` handles build numbers remotely).

## 6. Test matrix on a real iPhone (with a Sandbox Apple account)
- [ ] Sign in with Apple, including "Hide My Email". Email sign-up and sign-in. Sign out, then sign in as a different user. Check that no data from the previous account is shown.
- [ ] Voices: the three real Burmese previews (ကိုအောင် / မနှင်း / ဦးတင်) play with the silent switch on. Favorites survive a relaunch.
- [ ] Studio: generate one short narration. It appears in History, plays, and Share opens the iOS share sheet.
- [ ] Credits: both products show Apple's localized price. Buy 6,300 and check credits arrive once. Kill the app mid-purchase and relaunch to check credits arrive once, not twice. Cancel the purchase sheet and check no error and no grant. Test "Ask to Buy"/pending to check the waiting message.
- [ ] Refund a sandbox purchase (App Store Connect → Sandbox → refund test) and check unspent credits are removed and the purchase shows "Refunded by Apple".
- [ ] Delete account (within 15 minutes of signing in). Signing in again then fails, and Apple transactions are kept only in pseudonymous form.
- [ ] Airplane mode on each tab shows clear errors and no crashes. Check light and dark mode.

## 7. App Store listing and review
- [ ] Screenshots: at least one iPhone set in the size App Store Connect currently asks for (6.9-inch class, e.g. 1320×2868). iPad is not needed (`supportsTablet: false`).
- [ ] Description, keywords, subtitle, category (suggested: Productivity or Utilities), support URL, privacy policy URL, copyright line with the operator's legal name.
- [ ] Age rating questionnaire. Users write free text that becomes audio, so answer the user-generated content questions honestly.
- [ ] **App Privacy (nutrition labels)**, based on what the app actually does: Contact info (name, email) for app functionality and account; User content (scripts and generated audio) for app functionality; Purchases for app functionality; Identifiers (user ID) for app functionality; Usage data for analytics (OneDollarStats, no tracking across apps). Third-party processors: ElevenLabs (text-to-speech), Turso (database), Tigris/S3 (audio storage), the Runable sign-in broker, Apple. No tracking, so no App Tracking Transparency prompt.
- [ ] Export compliance: the app sets `ITSAppUsesNonExemptEncryption = false` (it uses only standard HTTPS and OS keychain). Confirm this is right for you before the first upload.
- [ ] App Review notes: provide a **demo account** (email and password) with some App Store credits granted from a sandbox purchase, and explain that 1 credit is about 1 second of Burmese audio. Mention that account deletion is under Account → Delete account.
- [ ] Guideline checks: purchases only through Apple IAP (3.1.1) ✔ in code; account deletion in-app (5.1.1(v)) ✔; Sign in with Apple offered alongside email ✔; no links or wording that steer users to KBZPay or web prices ✔.

## 8. Must be resolved before turning purchases on
- [ ] **Legal review.** Pages now also cover KBZPay plans, the free trial, recap clip rights and voice cloning (biometric data, consent, pause/delete) — 27 Oct 2026. `/privacy` and `/terms` are drafts marked "pending review". Add the operator's legal name and address and the governing law. Have them reviewed. Remove the draft banner only after that.
- [x] Retention: `services/retention.ts` purges media after 30 days, run hourly by the root `worker.ts`; `sweepClones` pauses clones on a lapsed plan and deletes them after 30 days paused.
- [ ] Refund accounting: refunds of credits already reserved by a running narration, and the shortfall records, need a final review against real sandbox notifications.
- [ ] "Uncertain" narration jobs have no reconciliation tool yet. They keep the user's reservation, and they block account deletion until handled by support.
- [ ] Load and contention tests against the real Turso database (local SQLite tests pass, and one same-connection test hit `SQLITE_BUSY`).
- [x] **Schema: do not run `bun run db:push` against production.** The live database already matches the Drizzle schema (all 17 tables, columns, NOT NULL, indexes and unique constraints; checked 15 Oct 2026). Push still fails with `no such column: "credit_pool"` and, on a local copy, plans to rebuild many tables (create `__new_*`, copy, drop, rename), only because the additive raw-SQL migrations write DDL differently from Drizzle. That rebuild would be risky and gains nothing. The policy: write any future change as an additive script like `scripts/migrate-apple-iap.ts`, back up first, then run `cd packages/web && bun --env-file=../../.env scripts/check-schema.ts` (read-only, exits 1 on drift).

- [x] Server payment rail test: `bun --env-file=.env test tests/payment-rail.e2e.test.ts` (17 pass, 21 Oct 2026). Re-run before enabling purchases and after any billing change. Expectations updated for the Creator 2,400-credit tier (27 Oct 2026); the Apple products credits6300/credits14400 are unchanged. It cannot replace a real StoreKit sandbox purchase on a device.

## 9. Release
- [ ] Switch `APPLE_ENVIRONMENT=Production` with `APPLE_APP_APPLE_ID` set, and restart the server and worker.
- [ ] Submit the version with both IAP products attached. Choose manual release so you control the launch moment.
- [ ] After launch: watch `/api/webhooks/apple` logs, purchases (`apple.purchases`), and support email.

## Note — website tiers vs. iOS (27 Oct 2026)
- The website now sells Creator / Studio / Business by KBZPay, with a free trial, cloning and recap video. The iOS app stays Apple IAP only and must not mention or link to KBZPay (3.1.1). Cloning and recap are not in the iOS app.
