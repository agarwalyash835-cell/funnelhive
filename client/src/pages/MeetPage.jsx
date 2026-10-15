// Your own booking page: /meet/<handle> lists your call types, /meet/<handle>/<call> books one.
// A month calendar, the free times of the chosen day in the visitor's own time zone, then the form.
// Paid calls go through Razorpay (UPI / cards) or Stripe; ?embed=1 drops the page chrome for iframes.
import { useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { loadRazorpay } from '../api';
import { stripeDialog } from '../stripePay';
import { viewerTz, dayKey, fmtTime, zoneLabel, zoneCity } from '../tzfmt';
import '../meet.css';

const money = (iso, v) => { try { return new Intl.NumberFormat(iso === 'INR' ? 'en-IN' : 'en-US', { style: 'currency', currency: iso || 'INR', minimumFractionDigits: 0 }).format(Number(v || 0)); } catch { return `${iso} ${v}`; } };
const lengthLabel = (m) => (m % 60 === 0 ? `${m / 60} hr` : m > 60 ? `${Math.floor(m / 60)} hr ${m % 60} min` : `${m} min`);
const longDay = (t, z) => new Date(t).toLocaleDateString('en-IN', { timeZone: z, weekday: 'long', day: 'numeric', month: 'long' });
const post = async (url, body) => {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const d = await r.json().catch(() => ({}));
  return r.ok ? d : { ...d, error: d.error || 'Something went wrong — please try again', taken: r.status === 409 };
};

function Shell({ seller, embed, children }) {
  if (embed) return <div className="mt mt-embed">{children}</div>;
  return (
    <div className="mt">
      <main className="mt-main">{children}</main>
      <footer className="mt-foot">{seller ? `${seller.name} · ` : ''}Scheduling by <a href="/" target="_blank" rel="noreferrer">FunnelHive</a></footer>
    </div>
  );
}
const Avatar = ({ seller }) => (seller?.logo ? <img className="mt-av" src={seller.logo} alt="" /> : <span className="mt-av">{(seller?.name || 'B')[0].toUpperCase()}</span>);

// /meet/<handle>: every listed call type
function Profile({ handle, embed }) {
  const [d, setD] = useState(null);
  useEffect(() => { fetch(`/api/meet/${handle}`).then(async (r) => setD(r.ok ? await r.json() : { error: (await r.json().catch(() => ({}))).error || 'This booking page doesn’t exist' })); }, [handle]);
  useEffect(() => { if (d?.seller) document.title = `Book a call · ${d.seller.name}`; }, [d]);
  if (!d) return <Shell embed={embed}><div className="mt-card mt-load" /></Shell>;
  if (d.error) return <Shell embed={embed}><div className="mt-card mt-msg"><h1>Page not found</h1><p>{d.error}</p></div></Shell>;
  return (
    <Shell seller={d.seller} embed={embed}>
      <div className="mt-card mt-profile">
        <div className="mt-who"><Avatar seller={d.seller} /><h1>{d.seller.name}</h1>{d.seller.person && d.seller.person !== d.seller.name && <p>{d.seller.person}</p>}<p className="mt-mute">Pick a call to see the times that work for you.</p></div>
        {!d.calendars.length ? <p className="mt-mute center">No calls are open for booking right now.</p> : (
          <div className="mt-types">
            {d.calendars.map((c) => (
              <Link key={c.slug} className="mt-type" to={`/meet/${handle}/${c.slug}${embed ? '?embed=1' : ''}`} style={c.color ? { '--mt-c': c.color } : undefined}>
                <b>{c.name}</b>
                <span>{c.durations.map(lengthLabel).join(' / ')}{c.price > 0 ? ` · ${money(c.currency, c.price)}` : ' · Free'}</span>
                {c.description && <p>{c.description}</p>}
                <i aria-hidden="true">→</i>
              </Link>
            ))}
          </div>
        )}
      </div>
    </Shell>
  );
}

// a month grid; days with free times are clickable
function Month({ month, setMonth, free, day, setDay, z }) {
  const [y, m] = month.split('-').map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1)), days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const lead = (first.getUTCDay() + 6) % 7; // weeks start on Monday
  const today = dayKey(Date.now(), z);
  const shift = (n) => { const d = new Date(Date.UTC(y, m - 1 + n, 1)); setMonth(d.toISOString().slice(0, 7)); };
  const firstFree = [...free].sort()[0], lastFree = [...free].sort().pop();
  return (
    <div className="mt-month">
      <div className="mt-mhead">
        <b>{first.toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' })}</b>
        <div><button type="button" aria-label="Previous month" disabled={!firstFree || month <= today.slice(0, 7)} onClick={() => shift(-1)}>‹</button><button type="button" aria-label="Next month" disabled={!lastFree || month >= lastFree.slice(0, 7)} onClick={() => shift(1)}>›</button></div>
      </div>
      <div className="mt-grid" role="grid">
        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((w) => <span key={w} className="mt-wd">{w}</span>)}
        {Array.from({ length: lead }, (_, i) => <span key={`x${i}`} />)}
        {Array.from({ length: days }, (_, i) => {
          const k = `${month}-${String(i + 1).padStart(2, '0')}`, on = free.has(k);
          return <button type="button" key={k} disabled={!on} className={`${on ? 'free' : ''} ${k === day ? 'on' : ''} ${k === today ? 'today' : ''}`} onClick={() => setDay(k)} aria-label={k}>{i + 1}</button>;
        })}
      </div>
    </div>
  );
}

// /meet/<handle>/<call>
function Book({ handle, cal: slug, embed }) {
  const [qs, setQs] = useSearchParams();
  const [d, setD] = useState(null);
  const [len, setLen] = useState(Number(qs.get('d')) || null);
  const [month, setMonth] = useState(null);
  const [day, setDay] = useState(null);
  const [pick, setPick] = useState(null);
  const [form, setForm] = useState({ name: '', email: '', phone: '', notes: '' });
  const [answers, setAnswers] = useState({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [done, setDone] = useState(null);
  const [h24, setH24] = useState(false);
  const z = viewerTz();
  const base = `/api/meet/${handle}/${slug}`;
  const load = (l = len) => fetch(`${base}${l ? `?d=${l}` : ''}`).then(async (r) => { const x = await r.json().catch(() => ({})); setD(r.ok ? x : { error: x.error || 'This call type doesn’t exist any more' }); if (r.ok) setLen(x.duration); });
  useEffect(() => { load(); }, [handle, slug]);
  useEffect(() => { if (d?.calendar) document.title = `${d.calendar.name} · ${d.seller.name}`; }, [d?.calendar?.name]);
  const free = useMemo(() => new Set((d?.slots || []).map((s) => dayKey(s, z))), [d?.slots]);
  // open on the first month and day with free times
  useEffect(() => { if (!d?.slots) return; const f = [...free].sort()[0]; if (!day || !free.has(day)) { setDay(f || null); setMonth((f || dayKey(Date.now(), z)).slice(0, 7)); } }, [free]);
  const times = (d?.slots || []).filter((s) => dayKey(s, z) === day);
  const t12 = (s) => (h24 ? new Date(s).toLocaleTimeString('en-GB', { timeZone: z, hour: '2-digit', minute: '2-digit' }) : fmtTime(s, z));
  const chooseLen = (m) => { setLen(m); setPick(null); setQs((q) => { q.set('d', m); return q; }, { replace: true }); load(m); };

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setErr('');
    const r = await post(`${base}/book`, { ...form, start: pick, duration: len, answers, source: embed ? 'embed' : 'booking page' });
    if (r.error) { setBusy(false); setErr(r.error); if (r.taken) { setPick(null); load(); } return; }
    let v = r;
    if (r.pay?.provider === 'stripe') {
      const back = new URL(location.href);
      try { const s = await stripeDialog(r.pay, back.toString()); if (s.error) { setBusy(false); return setErr(s.error); } } catch (x) { setBusy(false); return setErr(x.message); }
      v = await post(`${base}/stripe/verify`, { payment: r.pay.payment });
    } else if (r.pay) {
      try { await loadRazorpay(); } catch (x) { setBusy(false); return setErr(x.message); }
      v = await new Promise((resolve) => {
        const rz = new window.Razorpay({
          key: r.pay.key, order_id: r.pay.order_id, amount: r.pay.amount, currency: r.pay.currency, name: r.pay.name, description: r.pay.description,
          prefill: r.pay.prefill, theme: { color: r.pay.color }, retry: { enabled: true },
          handler: async (resp) => resolve(await post(`${base}/verify`, { payment: r.pay.payment, ...resp })),
          modal: { ondismiss: () => resolve({ error: 'Payment cancelled — your time is held for 15 minutes if you’d like to try again' }) },
        });
        rz.open();
      });
    }
    setBusy(false);
    if (v.error) return setErr(v.error);
    setDone(v);
    try { window.parent !== window && window.parent.postMessage({ type: 'funnelhive:booked', start: v.start }, '*'); } catch {}
  };

  if (!d) return <Shell embed={embed}><div className="mt-card mt-load" /></Shell>;
  if (d.error) return <Shell embed={embed}><div className="mt-card mt-msg"><h1>Not available</h1><p>{d.error}</p><Link to={`/meet/${handle}`}>See other calls →</Link></div></Shell>;
  const c = d.calendar, price = c.prices?.[len] ?? c.price;

  if (done) {
    const g = new URLSearchParams({ action: 'TEMPLATE', text: `${c.name} · ${d.seller.name}`, dates: `${new Date(done.start).toISOString().replace(/[-:]|\.\d{3}/g, '')}/${new Date(done.end).toISOString().replace(/[-:]|\.\d{3}/g, '')}`, details: done.meetingLink ? `Join: ${done.meetingLink}` : '' });
    return (
      <Shell seller={d.seller} embed={embed}>
        <div className="mt-card mt-done">
          <div className="mt-tick" aria-hidden="true">✓</div>
          <h1>You’re booked</h1>
          <p className="mt-mute">A confirmation is on its way to {form.email}.</p>
          <div className="mt-sum">
            <b>{c.name}</b>
            <span>{longDay(done.start, z)}</span>
            <span>{t12(done.start)} – {t12(done.end)} · {zoneLabel(z, done.start)}</span>
            <span>with {d.seller.name}</span>
          </div>
          <div className="mt-acts">
            {done.meetingLink && <a className="mt-btn" href={done.meetingLink} target="_blank" rel="noreferrer">Joining link</a>}
            <a className="mt-btn ghost" href={`https://calendar.google.com/calendar/render?${g}`} target="_blank" rel="noreferrer">Add to Google Calendar</a>
            {done.manage && <a className="mt-btn ghost" href={done.manage}>Reschedule or cancel</a>}
            {done.invoice && <a className="mt-btn ghost" href={done.invoice} target="_blank" rel="noreferrer">Invoice</a>}
          </div>
        </div>
      </Shell>
    );
  }

  return (
    <Shell seller={d.seller} embed={embed}>
      <div className={`mt-card mt-book ${pick ? 'step-form' : ''}`}>
        <aside className="mt-info">
          <Link className="mt-back" to={`/meet/${handle}${embed ? '?embed=1' : ''}`} aria-label="All calls">←</Link>
          <Avatar seller={d.seller} />
          <p className="mt-seller">{d.seller.name}</p>
          <h1>{c.name}</h1>
          <ul className="mt-facts">
            <li><Ico d="M12 7v5l3 2M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z" />{lengthLabel(len || c.duration)}</li>
            {c.location && <li><Ico d="M15 10l4.5-2.5v9L15 14M3 7h12v10H3z" />{c.location}</li>}
            {price > 0 && <li><Ico d="M6 4h12M6 9h12M13 20 6 13h3a4 4 0 0 0 0-9" />{money(c.currency, price)}</li>}
            <li><Ico d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM3 12h18M12 3c2.5 2.7 2.5 15.3 0 18M12 3c-2.5 2.7-2.5 15.3 0 18" />{zoneCity(z)} ({zoneLabel(z)})</li>
          </ul>
          {c.durations.length > 1 && (
            <div className="mt-lens" role="radiogroup" aria-label="Call length">
              {c.durations.map((m) => <button type="button" key={m} role="radio" aria-checked={m === len} className={m === len ? 'on' : ''} onClick={() => chooseLen(m)}>{lengthLabel(m)}</button>)}
            </div>
          )}
          {c.description && <p className="mt-desc">{c.description}</p>}
          {pick && <p className="mt-picked"><b>{longDay(pick, z)}</b><br />{t12(pick)} – {t12(pick + (len || c.duration) * 60000)}</p>}
        </aside>

        {!pick ? (
          <section className="mt-pick">
            <h2>Select a date &amp; time</h2>
            {!d.slots.length ? <p className="mt-mute mt-none">No times are free right now — please check back soon.</p> : (
              <div className="mt-cal">
                {month && <Month month={month} setMonth={setMonth} free={free} day={day} setDay={(k) => { setDay(k); setPick(null); }} z={z} />}
                <div className="mt-times">
                  <div className="mt-thead"><b>{times[0] ? longDay(times[0], z) : ''}</b><button type="button" className="mt-fmt" onClick={() => setH24(!h24)}>{h24 ? '24h' : 'am/pm'}</button></div>
                  <div className="mt-tlist">{times.map((s) => <button type="button" key={s} onClick={() => setPick(s)}>{t12(s)}</button>)}</div>
                </div>
              </div>
            )}
          </section>
        ) : (
          <form className="mt-form" onSubmit={submit}>
            <button type="button" className="mt-link" onClick={() => setPick(null)}>← Change time</button>
            <h2>Your details</h2>
            <label>Name<input required autoComplete="name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
            <label>Email<input required type="email" autoComplete="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></label>
            <label>{c.waRequired ? <>WhatsApp number <small>for your confirmation and reminders</small></> : <>WhatsApp / phone <small>for reminders</small></>}<input type="tel" autoComplete="tel" required={!!c.waRequired} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></label>
            {(c.questions || []).map((q) => (
              <label key={q.id}>{q.label}{q.required ? ' *' : ''}
                {q.type === 'long' ? <textarea rows={3} required={q.required} value={answers[q.id] || ''} onChange={(e) => setAnswers({ ...answers, [q.id]: e.target.value })} />
                  : q.type === 'select' ? <select required={q.required} value={answers[q.id] || ''} onChange={(e) => setAnswers({ ...answers, [q.id]: e.target.value })}><option value="">Choose…</option>{(q.options || []).map((o) => <option key={o}>{o}</option>)}</select>
                  : <input type={q.type === 'phone' ? 'tel' : 'text'} required={q.required} value={answers[q.id] || ''} onChange={(e) => setAnswers({ ...answers, [q.id]: e.target.value })} />}
              </label>
            ))}
            <label>Anything to share before the call? <small>optional</small><textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></label>
            {err && <p className="mt-err" role="alert">{err}</p>}
            <button className="mt-btn big" disabled={busy}>{busy ? 'Booking…' : price > 0 ? `Pay ${money(c.currency, price)} & confirm` : 'Confirm booking'}</button>
            {price > 0 && <p className="mt-fine">{c.refundHours ? `Full refund if you cancel at least ${c.refundHours >= 48 && c.refundHours % 24 === 0 ? `${c.refundHours / 24} days` : `${c.refundHours} hours`} before the call.` : 'Full refund if you cancel any time before the call.'} Rescheduling is free.</p>}
          </form>
        )}
      </div>
    </Shell>
  );
}
const Ico = ({ d }) => <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>;

export default function MeetPage() {
  const { handle, cal } = useParams();
  const [qs] = useSearchParams();
  const embed = qs.get('embed') === '1';
  return cal ? <Book handle={handle} cal={cal} embed={embed} /> : <Profile handle={handle} embed={embed} />;
}
