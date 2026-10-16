// The buyer's link from their confirmation email: see the booking, add it to a calendar, reschedule or cancel.
import { useEffect, useMemo, useState } from 'react';
import { viewerTz, dayKey, fmtTime, zoneLabel } from '../tzfmt';
import { useParams, useSearchParams } from 'react-router-dom';
import { alertDialog, confirmDialog } from '../ui';

// times are shown in the buyer's own time zone
const day = (t, z) => new Date(t).toLocaleDateString('en-IN', { timeZone: z, weekday: 'long', day: 'numeric', month: 'long' });
const time = (t, z) => fmtTime(t, z);
const key = (t, z) => dayKey(t, z);
const short = (t, z) => new Date(t).toLocaleDateString('en-IN', { timeZone: z, weekday: 'short', day: 'numeric', month: 'short' });

export default function BookingManage() {
  const { id } = useParams();
  const [qs] = useSearchParams();
  const t = qs.get('t') || '';
  const [b, setB] = useState(null);
  const [err, setErr] = useState('');
  const [mode, setMode] = useState(null);
  const [pickDay, setPickDay] = useState(null);
  const [busy, setBusy] = useState(false);
  const load = () => fetch(`/api/booking/${id}?t=${encodeURIComponent(t)}`).then(async (r) => { const d = await r.json(); r.ok ? setB(d) : setErr(d.error || 'Booking not found'); });
  useEffect(() => { load(); }, [id]);
  const off = viewerTz();
  const days = useMemo(() => [...new Set((b?.slots || []).map((s) => key(s, off)))], [b]);
  useEffect(() => { if (days.length && !pickDay) setPickDay(days[0]); }, [days]);
  const post = async (path, body) => {
    setBusy(true);
    const r = await fetch(`/api/booking/${id}/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ t, ...body }) });
    const d = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) return alertDialog({ text: d.error || 'That didn’t work — please try again', buyer: true });
    if (path === 'reschedule' && d.manage) location.href = d.manage; else { setMode(null); load(); }
  };
  if (err) return <div className="lib"><div className="lib-msg"><div className="lib-ic">📅</div><h1>Booking not found</h1><p>{err}</p></div></div>;
  if (!b) return <div className="lib"><div className="lib-load" /></div>;
  return (
    <div className="lib">
      <header className="lib-h"><div className="lib-brand"><span className="lib-logo">{(b.seller || 'B')[0]}</span><b>{b.seller}</b></div><div className="lib-who">{b.email}</div></header>
      <main className="lib-main bk-manage">
        <h1>{b.status === 'cancelled' ? 'This call was cancelled' : b.status === 'rescheduled' ? 'This call was moved' : b.calendar?.name}</h1>
        <div className="bk-sum">
          <p className="bk-big">📅 {day(b.start, off)}<br />🕐 {time(b.start, off)} – {time(b.end, off)} {zoneLabel(off, b.start)}</p>
          {b.status === 'confirmed' && b.calendar?.meetingLink && <a className="lib-btn" href={b.calendar.meetingLink} target="_blank" rel="noreferrer">Open the joining link</a>}
          {b.status === 'confirmed' && b.calendar?.location && <p className="lib-mute">📍 {b.calendar.location}</p>}
          {b.status === 'confirmed' && <a className="lib-btn ghost" href={`/api/booking/${id}/ics?t=${encodeURIComponent(t)}`}>Add to my calendar</a>}
        </div>
        {b.canChange && !mode && <div className="bk-acts2"><button className="lib-btn ghost" onClick={() => setMode('move')}>Reschedule</button><button className="lib-btn ghost" onClick={() => setMode('cancel')}>Cancel the call</button></div>}
        {mode === 'cancel' && (
          <div className="bk-sum"><p>Cancel your {b.calendar?.name} on {day(b.start, off)}?</p>
            <div className="bk-acts2"><button className="lib-btn" disabled={busy} onClick={() => post('cancel', {})}>{busy ? 'Cancelling…' : 'Yes, cancel it'}</button><button className="lib-btn ghost" onClick={() => setMode(null)}>Keep my booking</button></div></div>
        )}
        {mode === 'move' && (
          <div className="bk-sum">
            <p><b>Pick a new time</b> <span className="lib-mute">(your time · {zoneLabel(off)})</span></p>
            {!b.slots.length ? <p className="lib-mute">No other times are free right now.</p> : <>
              <div className="bk-days">{days.slice(0, 21).map((d) => { const s = b.slots.find((x) => key(x, off) === d); return <button key={d} className={d === pickDay ? 'on' : ''} onClick={() => setPickDay(d)}>{short(s, off).split(' ').map((x, i) => <span key={i}>{x}</span>)}</button>; })}</div>
              <div className="bk-slots">{b.slots.filter((s) => key(s, off) === pickDay).map((s) => <button key={s} disabled={busy} onClick={async () => (await confirmDialog({ title: `Move your call to ${day(s, off)}, ${time(s, off)}?`, confirm: 'Move my call', buyer: true })) && post('reschedule', { start: s })}>{time(s, off)}</button>)}</div>
            </>}
            <button className="lib-back" onClick={() => setMode(null)}>← Back</button>
          </div>
        )}
      </main>
    </div>
  );
}
