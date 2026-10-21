import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, loadRazorpay, fmtDate } from '../api';
import { Layout, Panel, Icon, inr, num, toast, confirmDialog } from '../ui';
import { stripeDialog, fmtMoney } from '../stripePay';

// billing country: India pays in ₹ (Razorpay, GST invoice); everyone else by card in USD / EUR / GBP (export invoice)
const EURO = ['AT', 'BE', 'CY', 'DE', 'EE', 'ES', 'FI', 'FR', 'GR', 'HR', 'IE', 'IT', 'LT', 'LU', 'LV', 'MT', 'NL', 'PT', 'SI', 'SK'];
const curFor = (c) => (c === 'GB' ? 'GBP' : EURO.includes(c) ? 'EUR' : 'USD');
const COUNTRIES = [['IN', 'India'], ['US', 'United States'], ['GB', 'United Kingdom'], ['CA', 'Canada'], ['AU', 'Australia'], ['AE', 'United Arab Emirates'], ['SG', 'Singapore'], ['DE', 'Germany'], ['FR', 'France'], ['NL', 'Netherlands'], ['IE', 'Ireland'], ['ES', 'Spain'], ['IT', 'Italy'], ['NZ', 'New Zealand'], ['ZA', 'South Africa'], ['NG', 'Nigeria'], ['KE', 'Kenya'], ['MY', 'Malaysia'], ['PH', 'Philippines'], ['ID', 'Indonesia'], ['BD', 'Bangladesh'], ['NP', 'Nepal'], ['LK', 'Sri Lanka'], ['PK', 'Pakistan'], ['SA', 'Saudi Arabia'], ['QA', 'Qatar'], ['BR', 'Brazil'], ['MX', 'Mexico'], ['JP', 'Japan'], ['XX', 'Other']];

const FEATURES = ['Up to 200 funnels, unlimited pages', '100+ expert templates', 'Hive AI funnel builder', 'CRM, pipelines & automations', 'Email + WhatsApp automations', 'Razorpay checkout, upsells & coupons', 'Custom domains with free SSL', 'A/B tests & analytics'];

export function statusLine(a) {
  if (!a) return '';
  switch (a.status) {
    case 'admin': return 'Platform admin — no subscription needed';
    case 'comped': return 'Complimentary access';
    case 'trialing': return `Free trial · ${a.daysLeft} day${a.daysLeft === 1 ? '' : 's'} left (until ${fmtDate(a.trialEndsAt)})`;
    case 'active': return a.currentPeriodEnd && a.currentPeriodEnd > (a.trialEndsAt || 0) ? `${a.interval?.startsWith('agency') ? 'Agency ' : ''}${a.interval?.endsWith('yearly') ? 'Yearly' : 'Monthly'} plan · renews ${fmtDate(a.currentPeriodEnd)}` : `${a.interval?.startsWith('agency') ? 'Agency ' : ''}${a.interval?.endsWith('yearly') ? 'Yearly' : 'Monthly'} plan · first charge ${fmtDate(a.currentPeriodEnd)}`;
    case 'past_due': return `Payment issue — Razorpay is retrying. Your access continues until ${fmtDate(a.endsAt)}.`;
    case 'cancelled': return `Cancelled · access until ${fmtDate(a.currentPeriodEnd)}`;
    case 'suspended': return 'Suspended — please contact support';
    default: return a.reason || 'No active plan';
  }
}

export default function Billing() {
  const [b, setB] = useState(null);
  const [period, setPeriod] = useState('yearly');
  const [tier, setTier] = useState('pro');
  const interval = tier === 'agency' ? `agency_${period}` : period;
  const [details, setDetails] = useState(null);
  const [busy, setBusy] = useState(false);
  const load = () => api('/billing').then((x) => { setB(x); setDetails((d) => d || { name: '', state: '', gstin: '', address: '', country: 'IN', ...x.details }); });
  useEffect(() => { load(); }, []);
  if (!b) return <Layout title="Plan & billing"><div className="skeleton" /></Layout>;
  const a = b.access;
  // abroad (the country picked below, saved or not): the same plans in the seller's currency, by card through Stripe
  const abroad = (details?.country || b.details?.country || 'IN') !== 'IN', cur = abroad ? curFor(details?.country || b.details?.country) : 'INR';
  const ip = b.intl?.all?.[cur] || {};
  const price = abroad ? { amount: ip[interval], perMonth: interval.endsWith('yearly') ? Math.round(ip[interval] / 12) : ip[interval] } : b.prices[interval];
  const money = (n) => (abroad ? fmtMoney(n, cur) : inr(n));
  if (a.agencyManaged) return <Layout title="Plan & billing"><section className="bill-status st-active"><Icon name="check" size={20} /><div><b>This account is covered by {a.agency || 'your agency'}’s plan</b><small>Billing, invoices and plan changes are handled by your agency.</small></div></section></Layout>;
  const hasDetails = !!(b.details?.state || (b.details?.country && b.details.country !== 'IN'));
  const detailsOk = !!details?.name && (details.country !== 'IN' || !!details.state);
  const subscribed = b.subscriptionId && ['active', 'past_due'].includes(a.planStatus) && !a.cancelAtPeriodEnd && !b.halted;
  const switching = subscribed && a.interval !== interval;
  const canSubscribe = !a.admin && a.status !== 'comped' && a.status !== 'suspended' && (!subscribed || switching);

  const saveDetails = async (e) => {
    e?.preventDefault();
    try { setB(await api('/billing/details', 'PUT', details)); toast('Billing details saved'); return true; } catch (x) { toast(x.message); return false; }
  };
  const subscribeIntl = async () => {
    setBusy(true);
    try {
      const s = await api('/billing/subscribe-intl', 'POST', { interval });
      const r = await stripeDialog({ ...s, button: s.mode === 'setup' ? 'Save card — first charge after your trial' : undefined }, location.href);
      if (r.error) toast(r.error);
      else { setB(await api('/billing/stripe/confirm', 'POST', { subscription: s.subscription })); toast(s.startsLater ? 'You’re subscribed — your first charge is after the trial' : 'Payment received — thank you!'); }
    } catch (x) { toast(x.message); }
    setBusy(false);
  };
  const subscribe = async () => {
    if ((!hasDetails || details.country !== (b.details?.country || 'IN')) && !(await saveDetails())) return;
    if (details.country && details.country !== 'IN') return subscribeIntl();
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
    if (!await confirmDialog({ title: 'Cancel your subscription?', text: `You keep full access until ${fmtDate(a.currentPeriodEnd)}; nothing more will be charged.`, confirm: 'Cancel subscription', cancel: 'Keep it', danger: true })) return;
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
            <Panel title="Choose your plan" actions={<div className="row"><div className="seg"><button className={tier === 'pro' ? 'on' : ''} onClick={() => setTier('pro')}>Pro</button><button className={tier === 'agency' ? 'on' : ''} onClick={() => setTier('agency')}>Agency</button></div><div className="seg"><button className={period === 'monthly' ? 'on' : ''} onClick={() => setPeriod('monthly')}>Monthly</button><button className={period === 'yearly' ? 'on' : ''} onClick={() => setPeriod('yearly')}>Yearly <span className="save-tag">2 months free</span></button></div></div>}>
              <div className="plan-card">
                <div className="plan-price"><span className="amt">{money(price.amount)}</span><span className="per">/{period === 'yearly' ? 'year' : 'month'}</span></div>
                <p className="muted sm">{period === 'yearly' ? `Just ${money(price.perMonth)}/month${abroad ? '' : ` · you save ${inr(tier === 'agency' ? b.prices.agencyYearlySaves : b.prices.yearlySaves)} a year`}` : 'Billed monthly · cancel any time'}{abroad ? ' · card, Apple Pay or Google Pay' : b.companyRegistered ? ' · incl. 18% GST' : ''}</p>
                <ul className="plan-feats">{tier === 'agency' && <><li><Icon name="layers" size={15} /><b>Up to {num(b.prices.agencyClients)} client accounts</b> — one login, one bill</li><li><Icon name="palette" size={15} />White-label: your brand, logo and app domain</li><li><Icon name="chart" size={15} />Client report links · copy funnels to clients</li></>}{FEATURES.map((f) => <li key={f}><Icon name="check" size={15} />{f}</li>)}<li><Icon name="sparkles" size={15} />{num(b.aiCredits.paid)} AI credits every month</li></ul>
                {!(abroad ? b.intl?.ready : b.ready) ? <p className="err">Online payments aren’t set up on this server yet. Please contact support.</p> : (
                  <button className="btn primary lg block" disabled={busy || !detailsOk} onClick={subscribe}>{busy ? <><span className="spin" /> {details?.country !== 'IN' ? 'Opening the card form…' : 'Opening Razorpay…'}</> : switching ? `Switch to this plan — from your next renewal` : a.status === 'trialing' ? `Subscribe — first charge after your trial` : `Subscribe for ${money(price.amount)}`}</button>
                )}
                {!abroad && price.amount > 15000 && <p className="hint center">Each renewal above ₹15,000 needs your approval in your bank app — Razorpay sends you a request before every charge.</p>}
                <p className="hint center">{abroad ? `Secure card payment by Stripe · billed in ${cur}${b.intl?.mode === 'test' ? ' · TEST MODE' : ''}` : `Secure payment by Razorpay · UPI Autopay, cards, netbanking${b.mode === 'test' ? ' · TEST MODE' : ''}`}</p>
              </div>
            </Panel>
            <Panel title={abroad ? 'Billing details (for your invoice)' : 'Billing details (for your GST invoice)'}>
              <form className="bill-form" onSubmit={saveDetails}>
                <label>Name on invoice<input value={details.name} onChange={(e) => setDetails({ ...details, name: e.target.value })} placeholder="Your business or full name" /></label>
                <label>Country<select value={details.country || 'IN'} onChange={(e) => setDetails({ ...details, country: e.target.value })}>{COUNTRIES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
                {details.country !== 'IN' && <p className="hint">Outside India you’re billed by card in {curFor(details.country)} with an export invoice — no GST.</p>}
                {details.country === 'IN' && <label>State<select value={details.state} onChange={(e) => setDetails({ ...details, state: e.target.value })}><option value="">Choose your state…</option>{b.states.map((s) => <option key={s}>{s}</option>)}</select></label>}
                {details.country === 'IN' && <label><span>GSTIN <small className="muted">· optional, to claim input tax credit</small></span><input value={details.gstin} onChange={(e) => setDetails({ ...details, gstin: e.target.value.toUpperCase() })} placeholder="27ABCDE1234F1Z5" maxLength={15} /></label>}
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
                <tbody>{b.invoices.map((i) => <tr key={i.id}><td className="mono strong">{i.number}</td><td>{fmtDate(i.at)}</td><td>{i.interval === 'yearly' ? 'Yearly' : 'Monthly'}</td><td className="r">{i.currency && i.currency !== 'INR' ? fmtMoney(i.total, i.currency) : inr(i.total)}</td><td className="r"><Link className="btn ghost sm" to={`/billing/invoices/${i.id}`}>View</Link></td></tr>)}</tbody></table>
            ) : <p className="muted sm" style={{ padding: 18 }}>Your GST invoices will appear here after each payment.</p>}
          </Panel>
        </div>
      </div>
    </Layout>
  );
}
