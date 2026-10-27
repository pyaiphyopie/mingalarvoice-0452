import { useState } from 'react';
import { usePlans } from '../queries/plans';
import { planLabel } from '../lib/plans';

type OrderPlan = 'Creator' | 'Studio' | 'Business' | 'Topup1000' | 'Topup2500';
import { useApprovePayment, useApprovals } from '../queries/owner';
import { usePendingOrders, useRejectOrder } from '../queries/payment-orders';

export function OwnerPayments() {
  const approve = useApprovePayment(), history = useApprovals();
  const pending = usePendingOrders(), reject = useRejectOrder();
  const [queue, setQueue] = useState<NonNullable<typeof pending.data>>([]);
  const [audit, setAudit] = useState<NonNullable<typeof history.data>>([]);
  const [orderId, setOrderId] = useState<string | undefined>();
  const [reason, setReason] = useState('');
  const [secret, setSecret] = useState(''), [email, setEmail] = useState(''), [reference, setReference] = useState('');
  const plans = usePlans();
  const [selected, setSelected] = useState<{ amount: number; credits: number; months: number } | null>(null);
  const [plan, setPlan] = useState<OrderPlan>('Creator'), [method, setMethod] = useState<'KBZPay' | 'KBZ Bank'>('KBZPay');
  const [verified, setVerified] = useState(false), [notice, setNotice] = useState('');
  // A selected order is approved at its stored terms (grandfathered prices, prepaid months); a direct grant uses the 1-month list price.
  const list = plans.data ? [...plans.data.tiers, ...plans.data.topups].find(p => p.name === plan) : undefined;
  const expected = selected ?? (list ? { amount: list.amount, credits: list.credits, months: plan.startsWith('Topup') ? 0 : 1 } : null);
  return <section className="account-panel owner-payments">
    <div className="eyebrow">OWNER CONTROL · PRIVATE PASSPHRASE REQUIRED</div>
    <h2>Verify a manual payment</h2>
    <p>Check the settled transfer in your own KBZPay or bank records. A screenshot alone is not verification. Each transfer reference can grant credits only once.</p>
    <form onSubmit={async e => {
      e.preventDefault(); setNotice('');
      try {
        const result = await approve.mutateAsync({ secret, customerEmail: email, reference, plan, method, settlementVerified: true, orderId });
        setNotice(result.duplicate ? 'Already approved. No additional credits granted.' : `Approved ${result.approval.credits.toLocaleString()} credits. Access ends ${new Date(result.approval.periodEnd).toLocaleString()}.`);
        setVerified(false); setReference(''); setOrderId(undefined); setSelected(null); setQueue([]);
      } catch (error) { setNotice(error instanceof Error ? error.message : 'Approval failed.'); }
      finally { setSecret(''); approve.reset(); }
    }}>
      <label>Owner approval passphrase<input aria-label="Owner approval passphrase" type="password" value={secret} minLength={20} maxLength={512} autoComplete="off" required onChange={e => setSecret(e.target.value)} /></label>
      <label>Customer account email<input aria-label="Customer account email" type="email" value={email} required onChange={e => setEmail(e.target.value)} /></label>
      <label>Purchased plan<select value={plan} disabled={!!orderId} onChange={e => setPlan(e.target.value as OrderPlan)}>{(['Creator', 'Studio', 'Business', 'Topup1000', 'Topup2500'] as const).map(p => <option key={p} value={p}>{planLabel(p)}</option>)}</select></label>
      <label>Payment method<select value={method} onChange={e => setMethod(e.target.value as typeof method)}><option>KBZPay</option><option>KBZ Bank</option></select></label>
      <label>Settled transaction reference<input aria-label="Settled transaction reference" value={reference} minLength={6} maxLength={100} required onChange={e => setReference(e.target.value)} /></label>
      <label className="owner-confirm"><input aria-label="Settled amount verified" type="checkbox" checked={verified} required onChange={e => setVerified(e.target.checked)} />I verified the settled amount: {expected ? `${expected.amount.toLocaleString()} MMK (${expected.credits.toLocaleString()} credits${expected.months ? `, ${expected.months * 30} days` : ', no extra days'})` : '…'}.</label>
      <button className="action" disabled={!verified || !expected || approve.isPending}>{approve.isPending ? 'Approving…' : plan.startsWith('Topup') ? 'Approve payment & add top-up credits' : `Approve payment & grant ${(expected?.months ?? 1) * 30}-day access`}</button>
    </form>
    {notice && <output>{notice}</output>}
    <button disabled={secret.length < 20 || pending.isPending} onClick={async () => {
      try { setQueue(await pending.mutateAsync({ secret })); } catch (error) { setNotice(error instanceof Error ? error.message : 'Unable to load pending orders.'); }
      finally { setSecret(''); pending.reset(); }
    }}>{pending.isPending ? 'Loading…' : 'Load pending payment orders'}</button>
    {queue.map(({ order, customerEmail }) => <div key={order.id} className="payment-verification">
      <strong>{customerEmail} · {planLabel(order.plan, order.months)} · {order.amount.toLocaleString()} MMK · {order.credits.toLocaleString()} credits</strong>
      <p>Order {order.id}<br />Transaction: {order.reference}</p>
      <button onClick={() => { setOrderId(order.id); setEmail(customerEmail); setReference(order.reference ?? ''); setPlan(order.plan as OrderPlan); setSelected({ amount: order.amount, credits: order.credits, months: order.plan.startsWith('Topup') ? 0 : Math.max(1, order.months) }); setMethod(order.method as typeof method); setVerified(false); setNotice('Order selected. Enter your passphrase and verify the settled transfer above before approving.'); }}>Select for review</button>
    </div>)}
    {orderId && <section><p>Selected order: {orderId}</p><label>Rejection reason<input aria-label="Rejection reason" value={reason} onChange={e => setReason(e.target.value)} maxLength={500} /></label><button disabled={reason.trim().length < 5 || secret.length < 20 || reject.isPending} onClick={async () => {
      try { await reject.mutateAsync({ id: orderId, secret, reason }); setNotice('Order rejected. No credits granted.'); setOrderId(undefined); setSelected(null); setQueue([]); } catch (error) { setNotice(error instanceof Error ? error.message : 'Rejection failed.'); }
      finally { setSecret(''); reject.reset(); }
    }}>{reject.isPending ? 'Rejecting…' : 'Reject selected order'}</button><button onClick={() => { setOrderId(undefined); setSelected(null); setVerified(false); }}>Clear selected order</button></section>}
    <button disabled={secret.length < 20 || history.isPending} onClick={async () => {
      try { setAudit(await history.mutateAsync({ secret })); } catch (error) { setNotice(error instanceof Error ? error.message : 'Unable to load approvals.'); }
      finally { setSecret(''); history.reset(); }
    }}>{history.isPending ? 'Loading…' : 'View approval audit'}</button>
    {audit.map(p => <p key={p.id}>{p.reference} · {p.plan} · {p.credits} credits · {new Date(p.approvedAt).toLocaleString()}</p>)}
  </section>;
}