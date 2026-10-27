import { useState } from 'react';
import { Link } from 'wouter';
import { authClient } from '../lib/auth';
import { useCreateOrder, useSubmitOrder, usePaymentOrders } from '../queries/payment-orders';
import type { ManualPlan } from './manual-payment';

export function PaymentOrder({ plan }: { plan: ManualPlan }) {
  const { data: session } = authClient.useSession();
  const create = useCreateOrder(), submit = useSubmitOrder(), list = usePaymentOrders(!!session);
  const [reference, setReference] = useState(''), [notice, setNotice] = useState('');
  const order = list.data?.find(o => o.plan === plan.name && ['pending_payment', 'pending_review'].includes(o.status));
  const stale = order?.status === 'pending_payment' && plan.months > 0 && order.months !== plan.months;
  const place = async () => { try { await create.mutateAsync({ plan: plan.name, months: (plan.months || 1) as 1 | 3 | 6 }); await list.refetch(); } catch (e) { setNotice(e instanceof Error ? e.message : 'Order creation failed.'); } };
  if (!session) return <section className="payment-verification"><h3>Create your pending order</h3><p>Sign in before paying so the order and credits belong to your account.</p><Link href="/sign-in">Sign in to create an order</Link></section>;
  return <section className="payment-verification">
    <h3>Your payment order</h3>
    {list.isLoading ? <p>Loading orders…</p> : list.isError ? <p className="error">Unable to load orders. <button onClick={() => list.refetch()}>Retry</button></p> : !order ? <button disabled={create.isPending} onClick={place}>{create.isPending ? 'Creating…' : 'Create pending KBZPay order'}</button> : <>
      <p>Order: <strong>{order.id}</strong><br />Status: {order.status.replace(/_/g, " ")}<br />{order.amount.toLocaleString()} MMK · {order.credits.toLocaleString()} credits{order.months > 1 ? ` · ${order.months} months` : ''}</p>
      {stale && <button disabled={create.isPending} onClick={place}>{create.isPending ? 'Updating…' : `Switch this unpaid order to ${plan.months} month${plan.months > 1 ? 's' : ''}`}</button>}
      {order.status === 'pending_payment' && <form onSubmit={async e => {
        e.preventDefault();
        try { await submit.mutateAsync({ id: order.id, reference }); await list.refetch(); setNotice('Submitted for admin verification. No credits are granted until approval.'); } catch (error) { setNotice(error instanceof Error ? error.message : 'Submission failed.'); }
      }}>
        <label>KBZPay transaction reference<input aria-label="KBZPay transaction reference" required minLength={6} maxLength={100} value={reference} onChange={e => setReference(e.target.value)} /></label>
        <button disabled={submit.isPending}>{submit.isPending ? 'Submitting…' : 'I have paid — submit for review'}</button>
      </form>}
      <p>{order.status === 'pending_payment' ? `Pay ${order.amount.toLocaleString()} MMK to 09400080040.` : 'Your transfer is awaiting owner verification. Do not pay again.'} Use this order ID in your Telegram receipt message. Never submit a PIN, OTP or wallet password.</p>
    </>}
    {notice && <output>{notice}</output>}
  </section>;
}

export function PaymentOrderHistory() {
  const { data: session } = authClient.useSession();
  const list = usePaymentOrders(!!session);
  if (!session) return null;
  return <section><h3 className="ledger-heading">Payment orders</h3>
    {list.isLoading ? <p>Loading orders…</p> : list.isError ? <p className="error">Unable to load payment orders.</p> : !list.data?.length ? <p>No orders yet. Buy a plan to create a pending order.</p> : <div className="history-list">{list.data.map(order => <article key={order.id}><div><strong>{order.plan.replace('Topup', 'Top-up ')}{order.months > 1 ? ` × ${order.months} months` : ''} · {order.amount.toLocaleString()} MMK</strong><p>{order.id} · {order.status.replace(/_/g, " ")}</p>{order.rejectionReason && <p className="error">{order.rejectionReason}</p>}<p>{order.status === 'approved' ? `${order.credits.toLocaleString()} credits granted` : 'No credits granted for this order yet'}</p></div></article>)}</div>}
  </section>;
}