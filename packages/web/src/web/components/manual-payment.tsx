import { useEffect, useRef, useState } from "react";
import { X, Copy, ArrowUpRight, MessageCircle, Check } from "lucide-react";
import { PaymentOrder } from './payment-order';

/** A quote from the server price list (paymentOrders.plans). months = 0 for a top-up. */
export type ManualPlan = { name: "Creator" | "Studio" | "Business" | "Topup1000" | "Topup2500"; label: string; months: number; price: number; credits: number };
export const accessText = (p: Pick<ManualPlan, "months">) => p.months ? `${p.months * 30} days after verification` : "added to your current plan · no extra days";

export function ManualPayment({
  plan,
  onClose,
}: {
  plan: ManualPlan;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [copied, setCopied] = useState("");
  const [guide, setGuide] = useState(false);
  const [step, setStep] = useState(0);
  const [error, setError] = useState("");
  useEffect(() => {
    const node = dialog.current;
    node?.showModal();
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      node?.close();
      document.body.style.overflow = previous;
    };
  }, []);
  async function copy(value: string, label: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(label);
      setError("");
    } catch {
      setError("Copy unavailable. Please select and copy the details below.");
    }
  }
  const reference = `Mingalar Voice — ${plan.label}\nAmount: ${plan.price.toLocaleString()} MMK\nCredits: ${plan.credits.toLocaleString()}\nAccount email: [your email]\nTransaction reference: [reference]\nPayment time: [date and time]\nPlease verify my transfer${plan.months ? ` and activate ${plan.months * 30}-day access` : ''}.`;
  return (
    <dialog
      ref={dialog}
      className="payment-modal"
      aria-labelledby="payment-title"
      onCancel={onClose}
    >
      <div className="payment-header">
        <div>
          <div className="eyebrow">MANUAL PAYMENT · NO AUTO-RENEWAL</div>
          <h2 id="payment-title">Buy {plan.label}</h2>
        </div>
        <button onClick={onClose} aria-label="Close payment instructions">
          <X size={22} />
        </button>
      </div>
      <div className="payment-total">
        <strong>
          {plan.price.toLocaleString()} <small>MMK</small>
        </strong>
        <span>
          {plan.credits.toLocaleString()} credits · {accessText(plan)}
        </span>
      </div>
      <p className="payment-intro">
        Create a KBZPay order before paying, then transfer the exact amount to
        09400080040. Renew on time to keep rollover credits (Studio and Business).
      </p>
      <PaymentOrder plan={plan} />
      <section className="payment-method">
        <div>
          <h3>KBZPay</h3>
          <span>Account holder: Pyai Phyo Pie</span>
        </div>
        <div className="payment-number">
          <strong>09400080040</strong>
          <button
            aria-label="Copy KBZPay number"
            onClick={() => copy("09400080040", "KBZPay number")}
          >
            <Copy size={16} />
          </button>
        </div>
      </section>
      <section className="payment-method">
        <div>
          <h3>KBZ Bank</h3>
          <span>Account holder: Pyai Phyo Pie</span>
          <p>Separate owner-assisted option: contact the owner first. Do not submit a bank transfer as a KBZPay order.</p>
        </div>
        <div className="payment-number">
          <strong>12630112602960301</strong>
          <button
            aria-label="Copy bank account number"
            onClick={() => copy("12630112602960301", "Bank account number")}
          >
            <Copy size={16} />
          </button>
        </div>
      </section>
      {copied && (
        <output className="payment-copy">
          <Check size={14} />
          {copied} copied.
        </output>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="payment-verification">
        <h3>After you transfer</h3>
        <p>
          Send your receipt, transaction reference, plan name and Mingalar Voice
          account email through Telegram. Contact number:{" "}
          <strong>09400080040</strong>.
        </p>
        <p>
          Access and credits are added only after the owner verifies the
          transfer against bank or wallet records. Sending a receipt is not
          payment approval.
        </p>
      </div>
      <div className="payment-actions">
        <a className="action" href="tg://resolve?phone=959400080040">
          <MessageCircle size={17} />
          Open Telegram
          <ArrowUpRight size={16} />
        </a>
        <button
          className="payment-guide-button"
          onClick={() => setGuide(!guide)}
        >
          <MessageCircle size={17} />
          {guide ? "Hide payment guide" : "Ask payment assistant"}
        </button>
      </div>
      <small className="payment-telegram-note">
        Telegram app required. If the number cannot be found due to privacy
        settings, add 09400080040 to your contacts and contact the owner there.
      </small>
      {guide && (
        <section className="payment-chat" aria-label="Payment assistant guide">
          <div className="eyebrow">PAYMENT ASSISTANT · AUTOMATED GUIDE</div>
          <p className="chat-bubble">
            {step === 0
              ? `You're buying ${plan.label} for ${plan.price.toLocaleString()} MMK. Create a pending KBZPay order and pay to 09400080040. For KBZ Bank, contact the owner first instead. Do not pay both.`
              : step === 1
                ? "After paying, prepare your receipt, transaction reference, payment date/time and account email. Never share a PIN, OTP or password."
                : "Copy the message below, fill in your details and send it with your receipt through Telegram. This guide does not send messages or verify transfers."}
          </p>
          <div className="chat-choices">
            <button onClick={() => setStep(0)}>How do I pay?</button>
            <button onClick={() => setStep(1)}>I have paid</button>
            <button onClick={() => setStep(2)}>Prepare my message</button>
          </div>
          {step === 2 && (
            <>
              <pre>{reference}</pre>
              <button
                className="payment-guide-button"
                onClick={() => copy(reference, "Payment message")}
              >
                <Copy size={15} />
                Copy message template
              </button>
            </>
          )}
          <small>
            No receipt is uploaded or sent in this guide. Verification happens
            with the owner through Telegram.
          </small>
        </section>
      )}
      <p className="payment-live-note">
        Generation requires verified paid access, sufficient credits and an online worker. Billing is 1 credit per audio second, rounded up. The ကိုမင်း Burmese sample was approved; other voices remain unreviewed.
      </p>
    </dialog>
  );
}
