// The affiliate's side of a seller's program (/affiliate/<slug>, server/affiliates.js): join, sign in with an emailed
// link, and a dashboard — clicks, sales, commission on hold / approved / paid, their links and coupon, payout details.
import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import '../affiliates.css';

const inr = (n) => '₹' + (Number(n) || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });
const date = (t) => (t ? new Date(t).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
const STATUS = { awaiting: 'Awaiting COD payment', pending: 'On hold', approved: 'Approved', paid: 'Paid', reversed: 'Reversed' };
const store = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { if (v) localStorage.setItem(k, v); else localStorage.removeItem(k); } catch {} } };
async function call(path, method = 'GET', body, session) {
  const r = await fetch(`/api/aff/${path}`, { method, headers: { 'Content-Type': 'application/json', ...(session ? { 'X-Affiliate': session } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(d.error || 'Something went wrong — please try again'), { status: r.status, data: d });
  return d;
}

export default function AffiliatePortal() {
  const { pslug } = useParams();
  const [qs, setQs] = useSearchParams();
  const key = `ff_aff_session_${pslug}`;
  const [prog, setProg] = useState(null);
  const [err, setErr] = useState('');
  const [session, setSession] = useState(() => store.get(key));
  const [me, setMe] = useState(null);
  useEffect(() => { call(pslug).then(setProg).catch((e) => setErr(e.message)); }, [pslug]);
  // the emailed sign-in link
  useEffect(() => {
    const t = qs.get('login');
    if (!t) return;
    setQs({}, { replace: true });
    call(`${pslug}/session`, 'POST', { token: t }).then((r) => { store.set(key, r.session); setSession(r.session); }).catch((e) => setErr(e.message));
  }, []);
  const load = () => call(`${pslug}/me`, 'GET', null, session).then(setMe).catch((e) => { if (e.status === 401) { store.set(key, ''); setSession(null); } else setErr(e.message); });
  useEffect(() => { if (session) load(); }, [session]);
  const signOut = () => { call(`${pslug}/logout`, 'POST', {}, session).catch(() => {}); store.set(key, ''); setSession(null); setMe(null); };

  if (err && !prog) return <div className="affp"><div className="affp-card"><h2>Affiliate program</h2><p>{err}</p></div></div>;
  if (!prog) return <div className="affp"><div className="affp-card skeleton" style={{ height: 200 }} /></div>;
  return (
    <div className="affp" style={prog.color ? { '--affp': prog.color } : undefined}>
      <header className="affp-head"><div><small>{prog.business}</small><h1>{prog.name}</h1></div>{me && <button className="affp-link" onClick={signOut}>Sign out</button>}</header>
      {err && <p className="affp-err">{err}</p>}
      {session && me ? <Dashboard d={me} pslug={pslug} session={session} onSaved={load} /> : session ? <div className="affp-card skeleton" style={{ height: 200 }} /> : <Join prog={prog} pslug={pslug} />}
    </div>
  );
}

function Join({ prog, pslug }) {
  const [mode, setMode] = useState('join');
  const [f, setF] = useState({ name: '', email: '', phone: '', upi: '', agree: false });
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);
  const [msg, setMsg] = useState('');
  const join = async (e) => {
    e.preventDefault(); setBusy(true); setMsg('');
    try { setDone(await call(`${pslug}/join`, 'POST', { name: f.name, email: f.email, phone: f.phone, agree: f.agree, ...(f.upi ? { payout: { upi: f.upi } } : {}) })); } catch (e) { setMsg(e.message); if (e.data?.signin) setMode('signin'); }
    setBusy(false);
  };
  const signin = async (e) => {
    e.preventDefault(); setBusy(true); setMsg('');
    try { await call(`${pslug}/login`, 'POST', { email: f.email }); setDone({ sent: true }); } catch (e) { setMsg(e.message); }
    setBusy(false);
  };
  if (done?.sent) return <div className="affp-card"><h2>Check your email</h2><p>If {f.email} is part of this program, a sign-in link is on its way. It works once, for 30 minutes.</p></div>;
  if (done) return <div className="affp-card"><h2>{done.status === 'approved' ? 'You’re in!' : 'Thanks — you’re on the list'}</h2><p>{done.status === 'approved' ? <>Your code is <b>{done.code}</b>. </> : 'We’ll review your sign-up and email you once you’re approved. '}Sign in with your email to see your links.</p><button className="affp-btn" onClick={() => { setDone(null); setMode('signin'); }}>Sign in</button></div>;
  return (
    <div className="affp-card">
      <ul className="affp-facts"><li><b>{prog.commission}</b><small>commission</small></li><li><b>{prog.cookieDays} days</b><small>link tracking</small></li><li><b>{inr(prog.minPayout)}</b><small>minimum payout</small></li></ul>
      <div className="affp-tabs"><button className={mode === 'join' ? 'on' : ''} onClick={() => setMode('join')}>Join</button><button className={mode === 'signin' ? 'on' : ''} onClick={() => setMode('signin')}>I’m an affiliate</button></div>
      {msg && <p className="affp-err">{msg}</p>}
      {mode === 'join' ? <form className="affp-form" onSubmit={join}>
        <label>Your name<input required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
        <label>Email<input required type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></label>
        <label>Mobile<input inputMode="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></label>
        <label>UPI ID for payouts <small>· optional, you can add it later</small><input value={f.upi} placeholder="name@okaxis" onChange={(e) => setF({ ...f, upi: e.target.value })} /></label>
        {prog.terms && <details className="affp-terms"><summary>Program terms</summary><p>{prog.terms}</p></details>}
        {prog.terms && <label className="affp-check"><input type="checkbox" checked={f.agree} onChange={(e) => setF({ ...f, agree: e.target.checked })} /> I accept the program terms</label>}
        <button className="affp-btn" disabled={busy}>{busy ? 'Joining…' : 'Join the program'}</button>
        <p className="affp-small">Commission is confirmed {prog.holdDays} days after a sale (in case of refunds) and paid by UPI or bank transfer.</p>
      </form> : <form className="affp-form" onSubmit={signin}>
        <label>Your email<input required type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></label>
        <button className="affp-btn" disabled={busy}>{busy ? 'Sending…' : 'Email me a sign-in link'}</button>
      </form>}
    </div>
  );
}

function Dashboard({ d, pslug, session, onSaved }) {
  const s = d.stats;
  const [edit, setEdit] = useState(false);
  const [p, setP] = useState({ upi: '', account: '', ifsc: '', holder: '', bank: '' });
  const [msg, setMsg] = useState('');
  const copy = (t) => navigator.clipboard?.writeText(t).then(() => setMsg('Copied'), () => {});
  const save = async (e) => {
    e.preventDefault(); setMsg('');
    try { await call(`${pslug}/me`, 'PUT', { payout: p.upi ? { upi: p.upi } : { account: p.account, ifsc: p.ifsc, holder: p.holder, bank: p.bank } }, session); setEdit(false); onSaved(); setMsg('Payout details saved'); } catch (e2) { setMsg(e2.message); }
  };
  if (d.me.status !== 'approved') return <div className="affp-card"><h2>Hi {d.me.name.split(' ')[0]}</h2><p>{d.me.status === 'pending' ? 'Your sign-up is waiting for approval. You’ll get an email once you’re in.' : 'This account isn’t active.'}</p></div>;
  return <>
    <div className="affp-stats">
      <div><small>Clicks (30 days)</small><b>{s.clicks30}</b></div>
      <div><small>Sales</small><b>{s.sales}</b></div>
      <div><small>On hold</small><b>{inr(s.pending + s.awaiting)}</b></div>
      <div><small>Approved</small><b>{inr(s.approved)}</b></div>
      <div><small>Paid</small><b>{inr(s.paid)}</b></div>
    </div>
    {msg && <p className="affp-ok">{msg}</p>}
    <div className="affp-card">
      <h3>Your links <small>· code {d.me.code}</small></h3>
      {!d.links.length ? <p className="affp-small">No live pages yet.</p> : d.links.map((l) => <div key={l.funnelId} className="affp-row"><div><b>{l.funnel}</b><code>{l.url}</code></div><button className="affp-btn ghost" onClick={() => copy(l.url)}>Copy</button></div>)}
      {d.coupon && <div className="affp-row"><div><b>Your coupon</b><code>{d.coupon.code}</code><small>{d.coupon.type === 'flat' ? `₹${d.coupon.value}` : `${d.coupon.value}%`} off for your audience — sales with it are yours even without the link</small></div><button className="affp-btn ghost" onClick={() => copy(d.coupon.code)}>Copy</button></div>}
      <p className="affp-small">{d.program.commission} · links count for {d.program.cookieDays} days after a click · commission is approved {d.program.holdDays} days after the sale.</p>
    </div>
    <div className="affp-card">
      <h3>Commission</h3>
      {!d.commissions.length ? <p className="affp-small">No sales yet — share your links.</p> : <div className="affp-table"><table><thead><tr><th>Date</th><th>Order</th><th className="num">Sale</th><th className="num">You earn</th><th>Status</th></tr></thead>
        <tbody>{d.commissions.map((c) => <tr key={c.id}><td>{date(c.at)}</td><td><code>{c.ref}</code>{c.test && <small> test</small>}</td><td className="num">{inr(c.orderTotal)}</td><td className="num">{inr(c.amount)}</td><td>{STATUS[c.status]}{c.status === 'pending' && c.holdUntil && <small> until {date(c.holdUntil)}</small>}{c.reason && <small> · {c.reason}</small>}</td></tr>)}</tbody></table></div>}
    </div>
    <div className="affp-card">
      <h3>Payouts</h3>
      {d.me.payout ? <p>Paid to <b>{d.me.payout.upi || `${d.me.payout.account} · ${d.me.payout.ifsc}`}</b> <button className="affp-link" onClick={() => setEdit(!edit)}>Change</button></p> : <p>Add a UPI ID or bank account so we can pay you. <button className="affp-link" onClick={() => setEdit(!edit)}>Add</button></p>}
      {edit && <form className="affp-form" onSubmit={save}>
        <label>UPI ID<input value={p.upi} placeholder="name@okaxis" onChange={(e) => setP({ ...p, upi: e.target.value })} /></label>
        <p className="affp-small">…or a bank account</p>
        <label>Account number<input inputMode="numeric" value={p.account} onChange={(e) => setP({ ...p, account: e.target.value })} /></label>
        <label>IFSC<input value={p.ifsc} onChange={(e) => setP({ ...p, ifsc: e.target.value.toUpperCase() })} /></label>
        <label>Account holder<input value={p.holder} onChange={(e) => setP({ ...p, holder: e.target.value })} /></label>
        <button className="affp-btn">Save</button>
      </form>}
      {!!d.payouts.length && <div className="affp-table"><table><tbody>{d.payouts.map((x) => <tr key={x.id}><td>{date(x.at)}</td><td className="num">{inr(x.amount)}</td><td>Ref <code>{x.reference}</code></td></tr>)}</tbody></table></div>}
    </div>
  </>;
}
