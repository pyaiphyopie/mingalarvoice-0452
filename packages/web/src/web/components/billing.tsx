import { useState } from "react";
import { ArrowUpRight, Check, Gift, Loader2, MailCheck, Wallet, Zap } from "lucide-react";
import { authClient } from "../lib/auth";
import { planLabel, tierFeatures, tierTagline } from "../lib/plans";
import { usePlans, useTrialStatus, useClaimTrial } from "../queries/plans";
import { useWallet } from "../queries/studio";
import { ManualPayment, type ManualPlan } from "./manual-payment";
import { PaymentOrderHistory } from "./payment-order";

const ledgerLabel: Record<string, string> = {
  manual_payment_grant: "Plan credits added", topup_grant: "Top-up added", trial_grant: "Free trial credits",
  period_expiry: "Unused credits expired at renewal", reservation: "Reserved for narration", video_reservation: "Reserved for video",
  settlement: "Narration settled", refund: "Unused credits returned",
};

/** Plans & credits: balance, free trial, three tiers with prepay, subscriber top-ups, orders and ledger. */
export function Billing({ notify }: { notify: (m: string) => void }) {
  const { data: session } = authClient.useSession();
  const signedIn = !!session;
  const plans = usePlans(), wallet = useWallet(signedIn), trial = useTrialStatus(signedIn), claim = useClaimTrial();
  const [months, setMonths] = useState<1 | 3 | 6>(1);
  const [purchase, setPurchase] = useState<ManualPlan | null>(null);
  const [sent, setSent] = useState(false);
  const access = wallet.data?.plan;
  const paid = !!access?.active && access.name !== "Trial";
  const end = wallet.data?.subscription?.periodEnd;

  async function claimTrial() {
    try { const r = await claim.mutateAsync(undefined); notify(`${r.credits} free credits added. Your trial ends ${new Date(r.periodEnd).toLocaleDateString()}.`); }
    catch (e) { notify(e instanceof Error ? e.message : "Trial could not be claimed."); }
  }
  async function verify() {
    if (!session) return;
    const r = await authClient.sendVerificationEmail({ email: session.user.email, callbackURL: "/billing" });
    if (r.error) notify(r.error.message ?? "Could not send the verification email.");
    else setSent(true);
  }

  return (
    <>
      <div className="billing-banner">
        <div>
          <div className="eyebrow">YOUR CREATIVE BALANCE</div>
          <h2>{wallet.data?.available.toLocaleString() ?? 0}<span> credits available</span></h2>
          <p>
            {wallet.data?.reserved ?? 0} reserved · {access?.active ? `${access.name} until ${new Date(end!).toLocaleDateString()}` : "No active plan"}
          </p>
        </div>
        <Wallet size={56} />
      </div>

      {signedIn && trial.data && !trial.data.claimed && !paid && (
        <section className="trial-card">
          <Gift size={26} />
          <div>
            <strong>Free trial · {trial.data.credits} credits for {trial.data.days} days</strong>
            <p>
              About 3 minutes of Burmese voice, or a 90-second recap video. Trial videos carry a small watermark. One trial per email address.
            </p>
            {!trial.data.verified && (
              <p className="trial-verify">
                <MailCheck size={14} />
                {trial.data.emailConfigured
                  ? sent ? "Verification email sent. Open the link, then come back here." : "Verify your email address to unlock the trial."
                  : "Email verification is not available yet. Sign in with Google to claim the trial."}
              </p>
            )}
          </div>
          {trial.data.eligible ? (
            <button className="action" disabled={claim.isPending} onClick={claimTrial}>
              {claim.isPending ? <Loader2 size={16} className="spin" /> : <Zap size={16} />} Claim free credits
            </button>
          ) : !trial.data.verified && trial.data.emailConfigured && !sent ? (
            <button className="action" onClick={verify}>Send verification email</button>
          ) : null}
        </section>
      )}

      <div className="billing-alert">
        <strong>Pay by KBZPay. No automatic renewal.</strong>
        <p>
          Create an order, transfer the exact amount and submit the transaction reference. Credits are added after the owner verifies the transfer.
          1 credit = 1 second of voice. Videos cost {plans.data?.rates.video ?? 2} credits per second. Unused reservations are always returned.
        </p>
      </div>

      <div className="billing-toolbar">
        <div className="eyebrow">PAY FOR</div>
        <div className="filters">
          {([1, 3, 6] as const).map(m => (
            <button key={m} className={months === m ? "selected" : ""} onClick={() => setMonths(m)}>
              {m === 1 ? "1 month" : `${m} months · save ${m === 3 ? 10 : 15}%`}
            </button>
          ))}
        </div>
      </div>
      {plans.isLoading ? <p className="muted"><Loader2 size={14} className="spin" /> Loading plans…</p>
        : plans.isError ? <p className="error">Plans could not be loaded. <button onClick={() => plans.refetch()}>Retry</button></p>
        : (
          <div className="plan-grid tiers">
            {plans.data!.tiers.map(t => {
              const q = t.prepay.find(p => p.months === months)!;
              const current = access?.active && access.name === t.name;
              return (
                <article className={t.name === "Studio" ? "plan dark-plan" : "plan"} key={t.name}>
                  <div className="eyebrow">{t.name === "Studio" ? "MOST POPULAR" : t.name === "Business" ? "FOR TEAMS" : "START HERE"}{current ? " · YOUR PLAN" : ""}</div>
                  <h3>{t.name}</h3>
                  <div className="plan-price">
                    {q.amount.toLocaleString()} MMK
                    <span>
                      {months > 1 ? `${months} months · ${Math.round(q.amount / months).toLocaleString()} MMK / month · ${q.credits.toLocaleString()} credits` : `${t.credits.toLocaleString()} credits · 30 days`}
                    </span>
                  </div>
                  <p>{tierTagline[t.name]}</p>
                  <ul>{tierFeatures(t).map(f => <li key={f}><Check size={14} /> {f}</li>)}</ul>
                  <button onClick={() => setPurchase({ name: t.name, label: planLabel(t.name, months), months, price: q.amount, credits: q.credits })}>
                    {current ? "Renew" : "Choose"} {t.name} <ArrowUpRight size={16} />
                  </button>
                </article>
              );
            })}
          </div>
        )}

      <h3 className="ledger-heading">Top-ups</h3>
      {paid ? (
        <div className="topup-row">
          {plans.data?.topups.map(t => (
            <button key={t.name} onClick={() => setPurchase({ name: t.name, label: planLabel(t.name), months: 0, price: t.amount, credits: t.credits })}>
              <strong>+{t.credits.toLocaleString()} credits</strong>
              <span>{t.amount.toLocaleString()} MMK · {plans.data.rates.topup} MMK per credit</span>
              <ArrowUpRight size={16} />
            </button>
          ))}
        </div>
      ) : (
        <p className="muted">Ran out before the month ends? Top-ups are available to active Creator, Studio and Business subscribers.</p>
      )}

      <PaymentOrderHistory />
      <h3 className="ledger-heading">Credit activity</h3>
      {!signedIn ? <p className="muted">Sign in to see your credits.</p>
        : wallet.isError ? <p className="error">Could not load credit records.</p>
        : wallet.data?.entries.length ? (
          <div className="history-list">
            {wallet.data.entries.map(e => (
              <article key={e.id}>
                <Wallet />
                <div>
                  <strong>{ledgerLabel[e.type] ?? e.type.replace(/_/g, " ")}</strong>
                  <p>{new Date(e.createdAt).toLocaleString()}</p>
                </div>
                <span>{e.availableDelta > 0 ? "+" : ""}{e.availableDelta} credits</span>
              </article>
            ))}
          </div>
        ) : <p className="muted">No credit activity yet. Only verified grants and real usage appear here.</p>}
      {purchase && <ManualPayment plan={purchase} onClose={() => setPurchase(null)} />}
    </>
  );
}
