// The client's private quote link: read the proposal, then accept and pay (deposit or full), or decline.
import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { loadRazorpay } from '../api';
import { stripeDialog, fmtMoney } from '../stripePay';

const day = (t) => new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });

export default function QuotePublic() {
  const { id } = useParams();
  const [qs] = useSearchParams();
  const t = qs.get('t') || '';
  const preview = qs.get('preview') ? '&preview=1' : '';
  const [q, setQ] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);
  const load = () => fetch(`/api/q/${id}?t=${encodeURIComponent(t)}${preview}`).then(async (r) => { const d = await r.json(); r.ok ? setQ(d) : setErr(d.error || 'Quote not found'); });
  useEffect(() => { load(); }, [id]);
  const post = async (path, body = {}) => { const r = await fetch(`/api/q/${id}/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ t, ...body }) }); const d = await r.json().catch(() => ({})); return r.ok ? d : { error: d.error || 'That didn’t work — please try again' }; };

  // back from a bank page (Stripe redirect)
  useEffect(() => {
    const pid = qs.get('ff_pay');
    if (pid) post('stripe/verify', { payment: pid }).then((r) => { if (!r.error) { setDone(r); load(); } });
  }, []);

  const pay = async () => {
    setBusy(true);
    const st = await post('pay');
    if (st.error) { setBusy(false); return alert(st.error); }
    let r;
    if (st.provider === 'stripe') {
      const back = new URL(location.href); back.searchParams.set('ff_pay', st.payment);
      try { const x = await stripeDialog({ ...st, button: `Pay ${fmtMoney(st.amount, st.currency)}` }, back.toString()); r = x.error ? x : await post('stripe/verify', { payment: st.payment }); } catch (e) { r = { error: e.message }; }
    } else {
      try { await loadRazorpay(); } catch (e) { setBusy(false); return alert(e.message); }
      r = await new Promise((resolve) => {
        const rz = new window.Razorpay({ key: st.key, order_id: st.order_id, amount: st.amount, currency: st.currency, name: st.name, description: st.description, prefill: st.prefill, retry: { enabled: true },
          handler: async (resp) => resolve(await post('verify', { payment: st.payment, ...resp })),
          modal: { ondismiss: () => resolve({ error: null }) } });
        rz.open();
      });
    }
    setBusy(false);
    if (r?.error) alert(r.error);
    else if (r?.ok) { setDone(r); load(); }
  };
  const decline = async () => {
    const reason = prompt('Sorry this one isn’t right. Anything you’d like to tell them? (optional)', '');
    if (reason === null) return;
    const r = await post('decline', { reason });
    if (r.error) alert(r.error); else setQ(r);
  };

  if (err) return <div className="lib"><div className="lib-msg"><div className="lib-ic">📄</div><h1>Quote not found</h1><p>{err}</p></div></div>;
  if (!q) return <div className="lib"><div className="lib-load" /></div>;
  const m = (n) => fmtMoney(n, q.currency);
  const depositNow = !q.paid && q.deposit > 0 && q.due < q.total;
  return (
    <div className="lib">
      <header className="lib-h"><div className="lib-brand"><span className="lib-logo">{(q.seller.name || 'Q')[0]}</span><b>{q.seller.name}</b></div><div className="lib-who mono">{q.number}</div></header>
      <main className="lib-main quote-pub">
        {preview && <p className="q-note">Preview — this is what your client sees. Opening it here doesn’t mark it as viewed.</p>}
        <p className="q-for">Prepared for <b>{q.client.name}</b>{q.client.company ? `, ${q.client.company}` : ''} · {day(q.at)}{q.validUntil ? ` · valid until ${day(q.validUntil)}` : ''}</p>
        <h1>{q.title}</h1>
        {q.intro && <p className="q-intro">{q.intro}</p>}
        <table className="q-tbl">
          <thead><tr><th>Item</th><th className="r">Qty</th><th className="r">Amount</th></tr></thead>
          <tbody>{q.items.map((it, i) => <tr key={i}><td><b>{it.name}</b>{it.detail && <small>{it.detail}</small>}</td><td className="r">{it.qty}</td><td className="r">{m(it.qty * it.price)}</td></tr>)}</tbody>
          <tfoot>
            <tr className="tot"><td colSpan={2}>Total</td><td className="r">{m(q.total)}</td></tr>
            {q.paid > 0 && <tr><td colSpan={2}>Paid</td><td className="r">− {m(q.paid)}</td></tr>}
            {q.paid > 0 && q.due > 0 && <tr className="tot"><td colSpan={2}>Balance due</td><td className="r">{m(q.due)}</td></tr>}
          </tfoot>
        </table>
        {q.terms && <div className="q-terms"><h3>Terms</h3><p>{q.terms}</p></div>}
        <div className="q-pay">
          {q.status === 'paid' ? <div className="q-state ok">✓ Paid in full — thank you!</div>
            : q.status === 'declined' ? <div className="q-state">This quote was declined.</div>
              : q.status === 'expired' ? <div className="q-state">This quote has expired — please ask {q.seller.name} for a new one.</div>
                : q.canPay ? <>
                  <button className="q-btn" disabled={busy || !!preview} onClick={pay}>{busy ? 'Opening payment…' : depositNow ? `Accept & pay ${q.deposit}% deposit — ${m(q.due)}` : q.paid ? `Pay the balance — ${m(q.due)}` : `Accept & pay ${m(q.due)}`}</button>
                  {depositNow && <p className="q-small">The remaining {m(q.total - q.due)} is paid later from this same link.</p>}
                  <p className="q-small">{q.provider === 'stripe' ? 'Secure card payment by Stripe' : 'Secure payment by Razorpay · UPI, cards, netbanking'}</p>
                  {!q.paid && !preview && <button className="q-link" onClick={decline}>Decline this quote</button>}
                </> : <div className="q-state">To go ahead, reply to {q.seller.name}{q.seller.email ? ` at ${q.seller.email}` : ''} — online payment isn’t set up for this quote.</div>}
          {done?.ok && done.status === 'deposit_paid' && <div className="q-state ok">✓ Deposit received — thank you! We’ve emailed your receipt.</div>}
          {q.invoices?.length > 0 && <p className="q-small">{q.invoices.map((iv, i) => <a key={i} href={iv.url} target="_blank" rel="noreferrer">Invoice for {m(iv.amount)} ({day(iv.at)})</a>).reduce((a, b) => [a, ' · ', b])}</p>}
        </div>
        {(q.seller.email || q.seller.whatsapp) && <p className="q-small">Questions? {q.seller.email && <a href={`mailto:${q.seller.email}?subject=${encodeURIComponent(`${q.number} — ${q.title}`)}`}>{q.seller.email}</a>}{q.seller.email && q.seller.whatsapp && ' · '}{q.seller.whatsapp && <a href={`https://wa.me/${q.seller.whatsapp.replace(/\D/g, '')}`} target="_blank" rel="noreferrer">WhatsApp</a>}</p>}
      </main>
    </div>
  );
}
