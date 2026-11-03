// Bookings → Calendar: every booking on a day / week / month calendar in your own time. Drag a booking to move it
// (the customer is told, as when they reschedule), click an empty time to book someone in or block it (lunch, leave),
// click a booking for its details, and see blocked times and your hours at a glance. Times on the grid are the
// browser's own (local Date), which is the viewer's zone.
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api';
import { Panel, Icon, Modal, toast, confirmDialog } from '../ui';
import { fmtTime } from '../tzfmt';

const MIN = 60000, DAY = 864e5;
const COLORS = ['#4f46e5', '#0ea5e9', '#16a34a', '#f59e0b', '#ec4899', '#8b5cf6', '#14b8a6', '#ef4444'];
const DOW = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const SLOT = 30; // minutes per grid row
const ROW = 28; // px per grid row
const startOfDay = (t) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
const addDays = (t, n) => { const d = new Date(t); d.setDate(d.getDate() + n); return d.getTime(); };
const startOfWeek = (t) => { const d = new Date(startOfDay(t)); return addDays(d.getTime(), -((d.getDay() + 6) % 7)); }; // Monday
const startOfMonth = (t) => { const d = new Date(startOfDay(t)); d.setDate(1); return d.getTime(); };
const hm = (t) => { const d = new Date(t); return d.getHours() * 60 + d.getMinutes(); };
const toMin = (s) => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };
const label = (t, o) => new Date(t).toLocaleDateString('en-IN', o);
const z = undefined; // fmtTime with the browser's own zone

export default function BookingCalendar({ cals }) {
  const [view, setView] = useState(() => (window.innerWidth < 700 ? 'day' : 'week'));
  const [at, setAt] = useState(() => startOfDay(Date.now()));
  const [calId, setCalId] = useState('');
  const [rows, setRows] = useState(null);
  const [blocks, setBlocks] = useState([]);
  const [showOff, setShowOff] = useState(false);
  const [open, setOpen] = useState(null); // a booking's details
  const [pick, setPick] = useState(null); // an empty time clicked: { start }
  const [drag, setDrag] = useState(null); // { id, dy, start }
  const color = useMemo(() => Object.fromEntries((cals || []).map((c, i) => [c.id, COLORS[i % COLORS.length]])), [cals]);
  const [from, to] = view === 'day' ? [at, addDays(at, 1)] : view === 'week' ? [startOfWeek(at), addDays(startOfWeek(at), 7)] : [startOfWeek(startOfMonth(at)), addDays(startOfWeek(startOfMonth(at)), 42)];
  const load = () => Promise.all([api(`/bookings?from=${from}&to=${to}`), api('/booking-blocks')]).then(([b, bl]) => { setRows(b); setBlocks(bl); }).catch((e) => toast(e.message));
  useEffect(() => { setRows(null); load(); }, [from, to]);
  const shown = (rows || []).filter((b) => (!calId || b.calendar?.id === calId) && (showOff ? b.status !== 'rescheduled' : b.status === 'confirmed'));
  const blk = blocks.filter((x) => !calId || !x.calendarId || x.calendarId === calId);
  const days = view === 'day' ? [at] : Array.from({ length: 7 }, (_, i) => addDays(startOfWeek(at), i));
  // the hours shown: 8 am–8 pm, widened to the calendars' working hours and anything booked
  const cal = cals?.find((c) => c.id === calId);
  const [h0, h1] = useMemo(() => {
    let a = 8 * 60, b = 20 * 60;
    for (const c of calId ? [cal].filter(Boolean) : cals || []) for (const d of DOW) for (const [x, y] of c.hours?.[d] || []) { a = Math.min(a, toMin(x)); b = Math.max(b, toMin(y)); }
    for (const x of shown) { a = Math.min(a, hm(x.start)); b = Math.max(b, Math.min(24 * 60, hm(x.end) || 24 * 60)); }
    return [Math.floor(a / 60) * 60, Math.min(24 * 60, Math.ceil(b / 60) * 60)];
  }, [cals, calId, rows]);
  const nRows = (h1 - h0) / SLOT;
  const y = (t, day) => ((Math.max(t, day) - day) / MIN - h0) / SLOT * ROW;
  const go = (n) => setAt(view === 'day' ? addDays(at, n) : view === 'week' ? addDays(at, 7 * n) : (() => { const d = new Date(startOfMonth(at)); d.setMonth(d.getMonth() + n); return d.getTime(); })());
  const title = view === 'day' ? label(at, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) : view === 'week' ? `${label(days[0], { day: 'numeric', month: 'short' })} – ${label(days[6], { day: 'numeric', month: 'short', year: 'numeric' })}` : label(startOfMonth(at), { month: 'long', year: 'numeric' });
  // working hours of the call type shown (or of any), for shading the grid
  const isOpen = (day, m) => (calId ? [cal] : cals || []).some((c) => (c?.hours?.[DOW[new Date(day).getDay()]] || []).some(([x, y2]) => m >= toMin(x) && m < toMin(y2)));

  // dragging a booking to another time (15-minute steps) or another day (week view)
  const gridRef = useRef();
  const startDrag = (e, b) => {
    if (b.status !== 'confirmed' || b.end < Date.now() || e.button > 0) return;
    e.stopPropagation();
    const rect = gridRef.current.getBoundingClientRect(), colW = (rect.width - 56) / days.length;
    const s = { x0: e.clientX, y0: e.clientY, on: false };
    const at2 = (ev) => {
      const col = Math.min(days.length - 1, Math.max(0, Math.floor((ev.clientX - rect.left - 56) / colW)));
      const mins = Math.round(((ev.clientY - s.y0) / ROW) * SLOT / 15) * 15;
      const day = days[col], base = b.start - startOfDay(b.start);
      return day + base + mins * MIN;
    };
    const move = (ev) => { if (!s.on && Math.hypot(ev.clientX - s.x0, ev.clientY - s.y0) < 5) return; s.on = true; setDrag({ id: b.id, start: at2(ev) }); };
    const up = async (ev) => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
      if (!s.on) { setDrag(null); return setOpen(b); }
      const start = at2(ev);
      if (start === b.start) return setDrag(null);
      if (start < Date.now()) { setDrag(null); return toast('Pick a time from now on'); }
      if (!(await confirmDialog({ title: `Move ${b.name || b.email} to ${label(start, { weekday: 'short', day: 'numeric', month: 'short' })}, ${fmtTime(start, z)}?`, text: 'They’ll get an email (and WhatsApp, if they gave a number) with the new time.', confirm: 'Move it' }))) return setDrag(null);
      try {
        const nb = await api(`/bookings/${b.id}/move`, 'POST', { start });
        setRows((list) => (list || []).map((x) => (x.id === b.id ? { ...nb, funnel: x.funnel } : x))); // there at once; the reload brings the rest
        toast('Moved — they’ve been told');
      } catch (x) { toast(x.message); }
      setDrag(null); load();
    };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  };
  const clickGrid = (e, day) => {
    if (e.target.closest('.bc-ev, .bc-blk')) return;
    const r = e.currentTarget.getBoundingClientRect();
    const m = h0 + Math.floor((e.clientY - r.top) / ROW) * SLOT;
    const start = day + m * MIN;
    if (start + SLOT * MIN < Date.now()) return toast('That time has passed');
    setPick({ start: Math.max(start, Math.ceil(Date.now() / (5 * MIN)) * 5 * MIN) });
  };

  return (
    <Panel pad={false}>
      <div className="bc-bar">
        <div className="row"><button className="btn ghost sm" onClick={() => setAt(startOfDay(Date.now()))}>Today</button><button className="icon-btn" aria-label="Previous" onClick={() => go(-1)}><span style={{ display: 'inline-flex', transform: 'rotate(180deg)' }}><Icon name="chevron" size={16} /></span></button><button className="icon-btn" aria-label="Next" onClick={() => go(1)}><Icon name="chevron" size={16} /></button><b className="bc-title">{title}</b></div>
        <div className="row">
          {cals?.length > 1 && <select value={calId} onChange={(e) => setCalId(e.target.value)} aria-label="Call type"><option value="">All call types</option>{cals.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>}
          <label className="tog sm"><input type="checkbox" checked={showOff} onChange={(e) => setShowOff(e.target.checked)} /><span />Cancelled</label>
          <div className="seg sm">{[['day', 'Day'], ['week', 'Week'], ['month', 'Month']].map(([k, l]) => <button key={k} className={view === k ? 'on' : ''} onClick={() => setView(k)}>{l}</button>)}</div>
        </div>
      </div>
      {!rows ? <div className="skeleton" style={{ margin: 16 }} /> : view === 'month' ? (
        <div className="bc-month">
          {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => <div key={d} className="bc-mh">{d}</div>)}
          {Array.from({ length: 42 }, (_, i) => addDays(from, i)).map((d) => {
            const list = shown.filter((b) => startOfDay(b.start) === d), off = new Date(d).getMonth() !== new Date(startOfMonth(at)).getMonth();
            const blocked = blk.some((x) => x.start < addDays(d, 1) && x.end > d);
            return (
              <button key={d} className={`bc-md ${off ? 'off' : ''} ${d === startOfDay(Date.now()) ? 'today' : ''}`} onClick={() => { setAt(d); setView('day'); }}>
                <span className="n">{new Date(d).getDate()}{blocked && <i className="bc-bdot" title="Some time blocked" />}</span>
                {list.slice(0, 3).map((b) => <span key={b.id} className={`bc-chip ${b.status}`} style={{ '--c': color[b.calendar?.id] }}>{fmtTime(b.start, z)} {b.name || b.email}</span>)}
                {list.length > 3 && <small className="muted">+{list.length - 3} more</small>}
              </button>
            );
          })}
        </div>
      ) : (
        <div className="bc-wrap">
          <div className="bc-head" style={{ gridTemplateColumns: `56px repeat(${days.length}, 1fr)` }}><span />{days.map((d) => <button key={d} className={`bc-dh ${d === startOfDay(Date.now()) ? 'today' : ''}`} onClick={() => { setAt(d); setView('day'); }}>{label(d, { weekday: 'short' })} <b>{new Date(d).getDate()}</b></button>)}</div>
          <div className="bc-grid" ref={gridRef} style={{ gridTemplateColumns: `56px repeat(${days.length}, 1fr)`, height: nRows * ROW }}>
            <div className="bc-times">{Array.from({ length: nRows }, (_, i) => h0 + i * SLOT).map((m) => <span key={m} style={{ height: ROW }}>{m % 60 === 0 ? fmtTime(startOfDay(Date.now()) + m * MIN, z) : ''}</span>)}</div>
            {days.map((d) => (
              <div key={d} className="bc-col" onClick={(e) => clickGrid(e, d)}>
                {Array.from({ length: nRows }, (_, i) => h0 + i * SLOT).map((m) => <i key={m} className={`bc-cell ${isOpen(d, m) ? 'open' : ''} ${m % 60 === 0 ? 'hr' : ''}`} style={{ height: ROW }} />)}
                {d === startOfDay(Date.now()) && hm(Date.now()) >= h0 && hm(Date.now()) < h1 && <i className="bc-now" style={{ top: y(Date.now(), d) }} />}
                {blk.filter((x) => x.start < addDays(d, 1) && x.end > d).map((x) => (
                  <button key={x.id + d} className="bc-blk" style={{ top: y(Math.max(x.start, d + h0 * MIN), d), height: Math.max(ROW / 2, (Math.min(x.end, d + h1 * MIN) - Math.max(x.start, d + h0 * MIN)) / MIN / SLOT * ROW) }}
                    title="Click to remove" onClick={async () => { if (await confirmDialog({ title: 'Remove this blocked time?', text: `${x.note ? `${x.note} · ` : ''}${fmtTime(x.start, z)} – ${fmtTime(x.end, z)}. People can book it again.`, confirm: 'Remove' })) { try { setBlocks((await api(`/booking-blocks/${x.id}`, 'DELETE')).blocks); toast('Unblocked'); } catch (e) { toast(e.message); } } }}>
                    <Icon name="shield" size={11} /> {x.note || 'Blocked'}
                  </button>
                ))}
                {shown.filter((b) => startOfDay(b.start) === d && drag?.id !== b.id).concat(drag && startOfDay(drag.start) === d ? [{ ...shown.find((b) => b.id === drag.id), start: drag.start, end: drag.start + (shown.find((b) => b.id === drag.id).end - shown.find((b) => b.id === drag.id).start), ghost: true }] : []).map((b) => (
                  <div key={b.id + (b.ghost ? 'g' : '')} className={`bc-ev ${b.status} ${b.ghost ? 'ghost' : ''} ${b.end < Date.now() ? 'past' : ''}`} style={{ '--c': color[b.calendar?.id], top: y(b.start, d), height: Math.max(ROW - 2, (b.end - b.start) / MIN / SLOT * ROW - 2) }}
                    onPointerDown={(e) => startDrag(e, b)} onClick={(e) => { e.stopPropagation(); if (!b.ghost && (b.status !== 'confirmed' || b.end < Date.now())) setOpen(b); }} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && setOpen(b)}
                    title={`${b.name || b.email} · ${b.calendar?.name}`}>
                    <b>{b.name || b.email}</b><small>{fmtTime(b.start, z)} · {b.calendar?.name}</small>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
      <p className="hint" style={{ padding: '8px 16px' }}>Drag a booking to move it · click an empty time to book someone in or block it · shaded = your working hours</p>
      {open && <BookingDetails b={open} onClose={() => setOpen(null)} onChanged={() => { setOpen(null); load(); }} />}
      {pick && <NewAtTime start={pick.start} cals={cals} calId={calId} onClose={() => setPick(null)} onDone={(bl) => { setPick(null); if (bl) setBlocks(bl); load(); }} />}
    </Panel>
  );
}

// a booking clicked on the calendar
function BookingDetails({ b, onClose, onChanged }) {
  const past = b.end < Date.now();
  const cancel = async () => {
    if (!(await confirmDialog({ title: `Cancel the booking with ${b.name || b.email}?`, text: b.paid && !b.refunded ? 'They’ll get an email and a full refund.' : 'They’ll get an email.', confirm: 'Cancel booking', danger: true }))) return;
    try { await api(`/bookings/${b.id}/cancel`, 'POST', {}); toast('Cancelled — they’ve been told'); onChanged(); } catch (e) { toast(e.message); }
  };
  const outcome = async (o) => { try { await api(`/bookings/${b.id}`, 'PUT', { outcome: b.outcome === o ? null : o }); toast('Saved'); onChanged(); } catch (e) { toast(e.message); } };
  return (
    <Modal title={b.name || b.email} onClose={onClose} width={440}>
      <div className="m-body">
      <dl className="bk-ans">
        <dt>When</dt><dd>{label(b.start, { weekday: 'long', day: 'numeric', month: 'long' })}, {fmtTime(b.start, z)} – {fmtTime(b.end, z)}</dd>
        <dt>Call type</dt><dd>{b.calendar?.name}{b.status !== 'confirmed' ? ` · ${b.status}` : ''}</dd>
        <dt>Email</dt><dd>{b.email}</dd>
        {b.phone && <><dt>Phone</dt><dd>{b.phone}</dd></>}
        {Object.entries(b.answers || {}).map(([q, a]) => <Fragment key={q}><dt>{q}</dt><dd>{a}</dd></Fragment>)}
        {b.notes && <><dt>Notes</dt><dd>{b.notes}</dd></>}
      </dl>
      <div className="row" style={{ flexWrap: 'wrap', marginTop: 12 }}>
        {b.status === 'confirmed' && !past && b.calendar?.meetingLink && <a className="btn soft sm" href={b.calendar.meetingLink} target="_blank" rel="noreferrer">Join</a>}
        {b.phone && <a className="btn ghost sm" href={`https://wa.me/${b.phone.replace(/\D/g, '').replace(/^(\d{10})$/, '91$1')}`} target="_blank" rel="noreferrer"><Icon name="send" size={14} />WhatsApp</a>}
        <a className="btn ghost sm" href={`mailto:${b.email}`}><Icon name="mail" size={14} />Email</a>
        {b.status === 'confirmed' && past && <><button className={`btn sm ${b.outcome === 'completed' ? 'primary' : 'ghost'}`} onClick={() => outcome('completed')}>Completed</button><button className={`btn sm ${b.outcome === 'no_show' ? 'danger' : 'ghost'}`} onClick={() => outcome('no_show')}>No-show</button></>}
        {b.status === 'confirmed' && !past && <button className="btn ghost sm danger" onClick={cancel}>Cancel booking</button>}
      </div>
      {b.status === 'confirmed' && !past && <p className="hint">To move it, drag it on the calendar.</p>}
      </div>
    </Modal>
  );
}

// an empty time clicked: book someone in at that time, or block it
function NewAtTime({ start, cals, calId, onClose, onDone }) {
  const [tab, setTab] = useState('book');
  const [v, setV] = useState({ calendarId: calId || cals?.[0]?.id || '', name: '', email: '', phone: '', notes: '' });
  const [blk, setBlk] = useState({ minutes: 60, note: '', all: true });
  const [busy, setBusy] = useState(false);
  const c = cals?.find((x) => x.id === v.calendarId);
  const book = async () => {
    setBusy(true);
    try { await api('/bookings', 'POST', { ...v, start, anytime: true }); toast('Booked — they’ll get the confirmation'); onDone(); } catch (e) { toast(e.message); }
    setBusy(false);
  };
  const block = async () => {
    setBusy(true);
    const end = blk.minutes === 'day' ? addDays(startOfDay(start), 1) : start + blk.minutes * MIN;
    try { const r = await api('/booking-blocks', 'POST', { start, end, note: blk.note, ...(blk.all ? {} : { calendarId: calId || v.calendarId }) }); toast(r.clash ? `Blocked — ${r.clash} booking${r.clash > 1 ? 's are' : ' is'} already in that time; cancel or move ${r.clash > 1 ? 'them' : 'it'} if needed` : 'Blocked — nobody can book that time'); onDone(r.blocks); } catch (e) { toast(e.message); }
    setBusy(false);
  };
  return (
    <Modal title={`${label(start, { weekday: 'long', day: 'numeric', month: 'short' })}, ${fmtTime(start, z)}`} onClose={onClose} width={440}>
      <div className="m-body">
      <div className="seg sm" style={{ marginBottom: 12 }}><button className={tab === 'book' ? 'on' : ''} onClick={() => setTab('book')}>Book someone in</button><button className={tab === 'block' ? 'on' : ''} onClick={() => setTab('block')}>Block this time</button></div>
      {tab === 'book' ? (
        <div className="bc-form">
          <label className="fld"><span>Call type</span><select value={v.calendarId} onChange={(e) => setV({ ...v, calendarId: e.target.value })}>{(cals || []).map((x) => <option key={x.id} value={x.id}>{x.name} · {x.duration} min</option>)}</select></label>
          <label className="fld"><span>Name</span><input value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} /></label>
          <label className="fld"><span>Email</span><input type="email" value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} placeholder="The confirmation and invite go here" /></label>
          <label className="fld"><span>Phone / WhatsApp <small className="muted">(optional)</small></span><input type="tel" value={v.phone} onChange={(e) => setV({ ...v, phone: e.target.value })} placeholder="+91 98765 43210" /></label>
          <label className="fld"><span>Notes <small className="muted">(optional)</small></span><input value={v.notes} onChange={(e) => setV({ ...v, notes: e.target.value })} /></label>
          {c && c.price > 0 && <p className="hint">A booking you add isn’t charged — collect the {c.currency} {c.price} yourself if needed.</p>}
          <button className="btn primary" disabled={busy || !v.email || !v.calendarId} onClick={book}>{busy ? <span className="spin" /> : null}Book {fmtTime(start, z)}</button>
        </div>
      ) : (
        <div className="bc-form">
          <label className="fld"><span>For how long</span><select value={blk.minutes} onChange={(e) => setBlk({ ...blk, minutes: e.target.value === 'day' ? 'day' : Number(e.target.value) })}>{[[30, '30 minutes'], [60, '1 hour'], [90, '1½ hours'], [120, '2 hours'], [180, '3 hours'], [240, '4 hours'], ['day', 'The rest of the day']].map(([m, l]) => <option key={m} value={m}>{l}</option>)}</select></label>
          <label className="fld"><span>Note <small className="muted">(only you see it)</small></span><input value={blk.note} maxLength={120} onChange={(e) => setBlk({ ...blk, note: e.target.value })} placeholder="Lunch · Site visit · On leave" /></label>
          {cals?.length > 1 && <label className="tog"><input type="checkbox" checked={blk.all} onChange={(e) => setBlk({ ...blk, all: e.target.checked })} /><span />Block every call type{!blk.all && ` (only ${cals.find((x) => x.id === (calId || v.calendarId))?.name})`}</label>}
          <button className="btn primary" disabled={busy} onClick={block}>{busy ? <span className="spin" /> : <Icon name="shield" size={14} />}Block it</button>
        </div>
      )}
      </div>
    </Modal>
  );
}
