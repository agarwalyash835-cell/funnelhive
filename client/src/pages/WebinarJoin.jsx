// A registrant's personal webinar page (the link in their emails): countdown, add to calendar, join, replay.
import { useEffect, useRef, useState } from 'react';
import { viewerTz, zoneLabel } from '../tzfmt';
import { useParams, useSearchParams } from 'react-router-dom';
import { alertDialog } from '../ui';

// in the registrant's own time zone
const fmt = (t) => { const z = viewerTz(); return `${new Date(t).toLocaleString('en-IN', { timeZone: z, weekday: 'long', day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit', hour12: true })} ${zoneLabel(z, t)}`; };
const two = (n) => String(n).padStart(2, '0');

export default function WebinarJoin() {
  const { id } = useParams();
  const [qs] = useSearchParams();
  const t = qs.get('t') || '';
  const [w, setW] = useState(null);
  const [err, setErr] = useState('');
  const [now, setNow] = useState(Date.now());
  const [busy, setBusy] = useState(false);
  const load = () => fetch(`/api/webinar-reg/${id}?t=${encodeURIComponent(t)}`).then(async (r) => { const d = await r.json(); r.ok ? setW(d) : setErr(d.error); });
  useEffect(() => { load(); const i = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(i); }, [id]);
  // the room opens 15 minutes before: refresh the state when it does — at most every ~30 s (spread out), so a full
  // webinar's attendees don't all ask the server every second while it still says “soon”
  const lastLoad = useRef(0), gap = useRef(25000 + Math.random() * 10000);
  useEffect(() => {
    if (!w || now - lastLoad.current < gap.current) return;
    if ((w.state === 'soon' && now >= w.session - 15 * 60000) || (w.state === 'live' && now > w.end)) { lastLoad.current = now; load(); }
  }, [now]);
  useEffect(() => { if (w?.name) document.title = w.name; }, [w?.name]);
  const join = async () => {
    setBusy(true);
    const r = await fetch(`/api/webinar-reg/${id}/join`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ t }) });
    const d = await r.json().catch(() => ({}));
    setBusy(false);
    if (d.url) location.href = d.url; else alertDialog({ text: d.error || 'Couldn’t open the room — please try again', buyer: true });
  };
  if (err) return <div className="lib"><div className="lib-msg"><div className="lib-ic">🎟️</div><h1>Link not valid</h1><p>{err}</p></div></div>;
  if (!w) return <div className="lib"><div className="lib-load" /></div>;
  const left = Math.max(0, w.session - now);
  const d = Math.floor(left / 864e5), h = Math.floor((left % 864e5) / 36e5), m = Math.floor((left % 36e5) / 6e4), s = Math.floor((left % 6e4) / 1000);
  return (
    <div className="lib">
      <header className="lib-h"><div className="lib-brand"><span className="lib-logo">{(w.seller || 'W')[0]}</span><b>{w.seller}</b></div><div className="lib-who">{w.email}</div></header>
      <main className="lib-main wb-join">
        <span className={`wb-state s-${w.state}`}>{w.state === 'live' ? '● Live now' : w.state === 'soon' ? 'Your seat is confirmed' : 'This session has ended'}</span>
        <h1>{w.name}</h1>
        <p className="lib-mute">📅 {fmt(w.session, w.tzOffset)} · {w.duration} minutes</p>
        {w.state === 'soon' && (
          <>
            <div className="wb-count">{[[d, 'days'], [h, 'hours'], [m, 'minutes'], [s, 'seconds']].map(([n, l]) => <div key={l}><b>{two(n)}</b><small>{l}</small></div>)}</div>
            <p className="lib-mute">The joining button switches on 15 minutes before the start. Keep this page bookmarked — it’s your personal link.</p>
            <a className="lib-btn ghost" href={`/api/webinar-reg/${id}/ics?t=${encodeURIComponent(t)}`}>Add to my calendar</a>
          </>
        )}
        {w.state === 'live' && <button className="lib-btn wb-go" disabled={busy} onClick={join}>{busy ? 'Opening…' : 'Join the live session →'}</button>}
        {w.state === 'over' && (w.replay ? <a className="lib-btn wb-go" href={w.replay}>Watch the replay →</a> : <p className="lib-mute">The replay link will be emailed to you if there is one.</p>)}
      </main>
    </div>
  );
}
