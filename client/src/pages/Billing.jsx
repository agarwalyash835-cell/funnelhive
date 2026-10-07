import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, loadRazorpay, fmtDate } from '../api';
import { Layout, Panel, Icon, inr, num, toast } from '../ui';

const FEATURES = ['Unlimited funnels & pages', '53 expert templates', 'Hive AI funnel builder', 'CRM, pipelines & automations', 'Email + WhatsApp automations', 'Razorpay checkout, upsells & coupons', 'Custom domains with free SSL', 'A/B tests & analytics'];

export function statusLine(a) {
  if (!a) return '';
  switch (a.status) {
    case 'admin': return 'Platform admin — no subscription needed';
    case 'comped': return 'Complimentary access';
    case 'trialing': return `Free trial · ${a.daysLeft} day${a.daysLeft === 1 ? '' : 's'} left (until ${fmtDate(a.trialEndsAt)})`;
    case 'active': return a.currentPeriodEnd && a.currentPeriodEnd > (a.trialEndsAt || 0) ? `${a.interval === 'yearly' ? 'Yearly' : 'Monthly'} plan · renews ${fmtDate(a.currentPeriodEnd)}` : `${a.interval === 'yearly' ? 'Yearly' : 'Monthly'} plan · first charge ${fmtDate(a.currentPeriodEnd)}`;
    case 'past_due': return `Payment issue — Razorpay is retrying. Your access continues until ${fmtDate(a.endsAt)}.`;
    case 'cancelled': return `Cancelled · access until ${fmtDate(a.currentPeriodEnd)}`;
    case 'suspended': return 'Suspended — please contact support';
    default: return a.reason || 'No active plan';
  }
}

export default function Billing() {
  const [b, setB] = useState(null);
  const [interval, setPeriod] = useState('yearly');
  const [details, setDetails] = useState(null);
  const [busy, setBusy] = useState(false);
  const load = () => api('/billing').then((x) => { setB(x); setDetails((d) => d || { name: '', state: '', gstin: '', address: '', ...x.details }); });
  useEffect(() => { load(); }, []);
  if (!b) return <Layout title="Plan & billing"><div className="skeleton" /></Layout>;
  const a = b.access, price = b.prices[interval];
  const hasDetails = !!b.details?.state;
  const canSubscribe = !a.admin && a.status !== 'comped' && a.status !== 'suspended' && !(b.subscriptionId && ['active', 'past_due'].includes(a.planStatus) && !a.cancelAtPeriodEnd && !b.halted);

  const saveDetails = async (e) => {
    e?.preventDefault();
    try { setB(await api('/billing/details', 'PUT', details)); toast('Billing details saved'); return true; } catch (x) { toast(x.message); return false; }
  };
  const subscribe = async () => {
    if (!hasDetails && !(await saveDetails())) return;
    setBusy(true);
    try {
      const co = await api('/billing/subscribe', 'POST', { interval });
      await loadRazorpay();
      const rz = new window.Razorpay({
        key: co.key, subscription_id: co.subscription_id, name: co.name, description: co.description, prefill: co.prefill, notes: co.notes, theme: { color: '#5b5bf6' },
        handler: async (r) => {
          try { setB(await api('/billing/verify', 'POST', r)); toast(co.startsLater ? 'You’re subscribed — your first charge is after the trial' : 'Payment received — thank you!'); } catch (x) { toast(x.message); }
          setBusy(false);
        },
        modal: { ondismiss: () => setBusy(false) },
      });
      rz.on('payment.failed', (r) => { toast(r.error?.description || 'Payment failed'); setBusy(false); });
      rz.open();
    } catch (x) { toast(x.message); setBusy(false); }
  };
  const cancel = async () => {
    if (!confirm(`Cancel your subscription? You keep full access until ${fmtDate(a.currentPeriodEnd)}; nothing more will be charged.`)) return;
    try { setB(await api('/billing/cancel', 'POST')); toast('Subscription cancelled'); } catch (x) { toast(x.message); }
  };
  const pct = b.credits.limit ? Math.min(100, Math.round((b.credits.used / b.credits.limit) * 100)) : 0;

  return (
    <Layout title="Plan & billing" subtitle={`One plan with everything in ${b.brand}.`}>
      <div className="billing">
        <section className={`bill-status st-${a.status}`}>
          <Icon name={a.ok ? 'check' : 'clock'} size={20} />
          <div><b>{statusLine(a)}</b>{!a.ok && a.status !== 'suspended' && <small>Your account is read-only. {a.pagesLive ? `Live pages stay up until ${fmtDate(a.pagesOfflineAt)}.` : 'Your live pages are offline.'}</small>}</div>
          {b.subscriptionId && ['active', 'past_due'].includes(a.planStatus) && !a.cancelAtPeriodEnd && <button className="btn ghost sm" onClick={cancel}>Cancel subscription</button>}
        </section>

        {canSubscribe && (
          <div className="bill-grid">
            <Panel title="Choose your plan" actions={<div className="seg"><button className={interval === 'monthly' ? 'on' : ''} onClick={() => setPeriod('monthly')}>Monthly</button><button className={interval === 'yearly' ? 'on' : ''} onClick={() => setPeriod('yearly')}>Yearly <span className="save-tag">2 months free</span></button></div>}>
              <div className="plan-card">
                <div className="plan-price"><span className="amt">{inr(price.amount)}</span><span className="per">/{interval === 'yearly' ? 'year' : 'month'}</span></div>
                <p className="muted sm">{interval === 'yearly' ? `Just ${inr(price.perMonth)}/month · you save ${inr(b.prices.yearlySaves)} a year` : 'Billed monthly · cancel any time'}{b.companyRegistered ? ' · incl. 18% GST' : ''}</p>
                <ul className="plan-feats">{FEATURES.map((f) => <li key={f}><Icon name="check" size={15} />{f}</li>)}<li><Icon name="sparkles" size={15} />{num(b.aiCredits.paid)} AI credits every month</li></ul>
                {!b.ready ? <p className="err">Online payments aren’t set up on this server yet. Please contact support.</p> : (
                  <button className="btn primary lg block" disabled={busy || !details?.name || !details?.state} onClick={subscribe}>{busy ? <><span className="spin" /> Opening Razorpay…</> : a.status === 'trialing' ? `Subscribe — first charge after your trial` : `Subscribe for ${inr(price.amount)}`}</button>
                )}
                <p className="hint center">Secure payment by Razorpay · UPI Autopay, cards, netbanking{b.mode === 'test' ? ' · TEST MODE' : ''}</p>
              </div>
            </Panel>
            <Panel title="Billing details (for your GST invoice)">
              <form className="bill-form" onSubmit={saveDetails}>
                <label>Name on invoice<input value={details.name} onChange={(e) => setDetails({ ...details, name: e.target.value })} placeholder="Your business or full name" /></label>
                <label>State<select value={details.state} onChange={(e) => setDetails({ ...details, state: e.target.value })}><option value="">Choose your state…</option>{b.states.map((s) => <option key={s}>{s}</option>)}</select></label>
                <label><span>GSTIN <small className="muted">· optional, to claim input tax credit</small></span><input value={details.gstin} onChange={(e) => setDetails({ ...details, gstin: e.target.value.toUpperCase() })} placeholder="27ABCDE1234F1Z5" maxLength={15} /></label>
                <label><span>Address <small className="muted">· optional</small></span><input value={details.address} onChange={(e) => setDetails({ ...details, address: e.target.value })} placeholder="City, PIN" /></label>
                <button className="btn ghost">Save details</button>
              </form>
            </Panel>
          </div>
        )}

        <div className="bill-grid">
          <Panel title="AI credits this month">
            <div className="credits">
              <div className="credits-n"><b>{num(b.credits.used)}</b> used{b.credits.limit != null && <> of {num(b.credits.limit)}</>}</div>
              {b.credits.limit != null && <div className="meter"><span style={{ width: `${pct}%` }} className={pct > 90 ? 'hot' : ''} /></div>}
              <p className="hint">A full AI funnel uses 5 credits; an AI edit, chat message or Hive AI message uses 1. Credits renew on the 1st of each month.</p>
            </div>
          </Panel>
          <Panel title="Invoices" pad={false}>
            {b.invoices.length ? (
              <table className="tbl compact"><thead><tr><th>Invoice</th><th>Date</th><th>Plan</th><th className="r">Amount</th><th /></tr></thead>
                <tbody>{b.invoices.map((i) => <tr key={i.id}><td className="mono strong">{i.number}</td><td>{fmtDate(i.at)}</td><td>{i.interval === 'yearly' ? 'Yearly' : 'Monthly'}</td><td className="r">{inr(i.total)}</td><td className="r"><Link className="btn ghost sm" to={`/billing/invoices/${i.id}`}>View</Link></td></tr>)}</tbody></table>
            ) : <p className="muted sm" style={{ padding: 18 }}>Your GST invoices will appear here after each payment.</p>}
          </Panel>
        </div>
      </div>
    </Layout>
  );
}
