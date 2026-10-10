import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { fmtWhenShort, zoneCity, allZones, zoneOption } from '../tzfmt';
import { Layout, Panel, Icon, Empty, toast, num } from '../ui';

const DAYS = [['mon', 'Monday'], ['tue', 'Tuesday'], ['wed', 'Wednesday'], ['thu', 'Thursday'], ['fri', 'Friday'], ['sat', 'Saturday'], ['sun', 'Sunday']];
const inTz = (t, off) => new Date(t + (off ?? 330) * 60000);
export const fmtWhen = (t, zone) => fmtWhenShort(t, zone ?? 330);

export default function Bookings() {
  const [qs, setQs] = useSearchParams();
  const tab = qs.get('tab') || (qs.get('gcal') ? 'calendars' : 'upcoming');
  // back from Google's consent screen
  useEffect(() => {
    const g = qs.get('gcal');
    if (!g) return;
    toast({ connected: 'Google Calendar connected', cancelled: 'Google Calendar wasn’t connected', expired: 'That took too long — please try connecting again', failed: 'Couldn’t connect Google Calendar — please try again' }[g] || g);
    setQs({ tab: 'calendars' });
  }, []);
  return (
    <Layout title="Bookings" subtitle="Calls booked from your funnels — and the hours you’re available.">
      <div className="seg pr-tabs">{[['upcoming', 'Upcoming calls'], ['past', 'Past & cancelled'], ['calendars', 'Calendars & hours']].map(([k, l]) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => setQs({ tab: k })}>{l}</button>)}</div>
      {tab === 'calendars' ? <Calendars /> : <BookingList past={tab === 'past'} />}
    </Layout>
  );
}

function BookingList({ past }) {
  const [rows, setRows] = useState(null);
  const load = () => api(`/bookings?from=${Date.now() - 90 * 864e5}`).then(setRows);
  useEffect(() => { load(); }, []);
  const now = Date.now();
  const shown = (rows || []).filter((b) => (past ? b.status !== 'confirmed' || b.end < now : b.status === 'confirmed' && b.end >= now));
  if (past) shown.reverse();
  const cancel = async (b) => {
    const reason = prompt(`Cancel the call with ${b.name || b.email} on ${fmtWhen(b.start, b.calendar?.timezone || b.calendar?.tzOffset)}? They’ll get an email${b.paid && !b.refunded ? ' and a full refund' : ''}. Reason (optional):`);
    if (reason === null) return;
    try { await api(`/bookings/${b.id}/cancel`, 'POST', { reason }); toast('Booking cancelled — they’ve been emailed'); load(); } catch (e) { toast(e.message); }
  };
  const today = rows ? rows.filter((b) => b.status === 'confirmed' && inTz(b.start, 330).toISOString().slice(0, 10) === inTz(now, 330).toISOString().slice(0, 10)).length : 0;
  const week = rows ? rows.filter((b) => b.status === 'confirmed' && b.start >= now && b.start < now + 7 * 864e5).length : 0;
  return (
    <>
      {!past && rows && (
        <div className="kpis k4">
          <div className="kpi"><span className="kpi-l">Calls today</span><b className="kpi-v">{num(today)}</b></div>
          <div className="kpi"><span className="kpi-l">Next 7 days</span><b className="kpi-v">{num(week)}</b></div>
          <div className="kpi"><span className="kpi-l">Booked (90 days)</span><b className="kpi-v">{num(rows.filter((b) => b.status !== 'cancelled').length)}</b></div>
          <div className="kpi"><span className="kpi-l">Cancelled</span><b className="kpi-v">{num(rows.filter((b) => b.status === 'cancelled').length)}</b></div>
        </div>
      )}
      <Panel pad={false}>
        {!rows ? <div className="skeleton" /> : !shown.length ? (
          <Empty icon="clock" title={past ? 'Nothing here yet' : 'No upcoming calls'} text={past ? 'Finished, rescheduled and cancelled calls show up here.' : 'Add a booking calendar to a funnel page (it’s already on every “VSL + application” template) and calls land here, with email confirmations and reminders sent for you.'}>
            {!past && <Link className="btn primary" to="/templates">Browse application funnels</Link>}
          </Empty>
        ) : (
          <div className="tbl-wrap"><table className="tbl">
            <thead><tr><th>When</th><th>Who</th><th>Call</th><th>From</th><th>Status</th><th /></tr></thead>
            <tbody>{shown.map((b) => (
              <tr key={b.id}>
                <td><b>{fmtWhen(b.start, b.calendar?.timezone || b.calendar?.tzOffset)}</b><small className="sub-t">{b.calendar?.duration} min</small></td>
                <td><b>{b.name || '—'}</b><small className="sub-t">{b.email}{b.phone ? ` · ${b.phone}` : ''}</small>{b.notes && <small className="sub-t" title={b.notes}>“{b.notes.slice(0, 80)}”</small>}</td>
                <td>{b.calendar?.name}</td><td className="muted sm">{b.funnel || '—'}</td>
                <td><span className={`pill ${b.status === 'confirmed' ? 'ok' : b.status === 'cancelled' ? 'bad' : 'warn'}`}>{b.status}{b.cancelledBy ? ` by ${b.cancelledBy === 'buyer' ? 'them' : 'you'}` : ''}</span>{b.paid && <span className="pill ok" title="Paid through Razorpay">{b.refunded ? 'refunded' : `paid ₹${Number(b.paid).toLocaleString('en-IN')}`}</span>}{b.unpaid && <span className="pill warn" title="Payments weren’t connected when they booked — collect it yourself">unpaid</span>}{b.google && <span className="pill" title="In your Google Calendar">G</span>}</td>
                <td className="r"><div className="row end">
                  {b.status === 'confirmed' && b.calendar?.meetingLink && <a className="btn soft sm" href={b.calendar.meetingLink} target="_blank" rel="noreferrer">Join</a>}
                  {b.phone && <a className="icon-btn" title="WhatsApp" href={`https://wa.me/${b.phone.replace(/\D/g, '').replace(/^(\d{10})$/, '91$1')}`} target="_blank" rel="noreferrer"><Icon name="send" size={15} /></a>}
                  {b.status === 'confirmed' && b.start > now && <button className="icon-btn danger" title="Cancel" onClick={() => cancel(b)}><Icon name="x" size={15} /></button>}
                </div></td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </Panel>
    </>
  );
}

function Calendars() {
  const [list, setList] = useState(null);
  const [sel, setSel] = useState(null);
  const load = () => api('/calendars').then((l) => { setList(l); setSel((s) => l.find((c) => c.id === s?.id) || l[0]); });
  useEffect(() => { load(); }, []);
  const add = async () => { try { const c = await api('/calendars', 'POST', { name: 'New call type', duration: 30 }); await load(); setSel(c); } catch (e) { toast(e.message); } };
  if (!list) return <div className="skeleton" />;
  return (
    <div className="pr-cols">
      <div className="pr-main"><GoogleCalendar />{sel && <CalendarEditor key={sel.id} c={sel} onSaved={load} canDelete={list.length > 1} />}</div>
      <aside className="pr-side">
        <Panel title="Calendars" actions={<button className="btn ghost sm" onClick={add}><Icon name="plus" size={14} /> Add</button>}>
          <div className="cal-list">{list.map((c) => <button key={c.id} className={c.id === sel?.id ? 'on' : ''} onClick={() => setSel(c)}><b>{c.name}</b><small>{c.duration} min{c === list[0] ? ' · default' : ''}</small></button>)}</div>
          <p className="hint">The first calendar is the default for booking blocks that don’t pick one. Each funnel’s booking section can use its own.</p>
        </Panel>
      </aside>
    </div>
  );
}

// Google Calendar: busy times block slots; bookings are added with a Meet link
function GoogleCalendar() {
  const [g, setG] = useState(null);
  const load = () => api('/google/calendar').then(setG).catch(() => setG(null));
  useEffect(() => { load(); }, []);
  if (!g || !g.available) return null;
  const connect = async () => { try { const r = await api('/google/calendar/connect', 'POST'); location.href = r.url; } catch (e) { toast(e.message); } };
  const set = async (patch) => { try { setG(await api('/google/calendar', 'PUT', patch)); } catch (e) { toast(e.message); } };
  return (
    <Panel title="Google Calendar">
      <div className="gcal-card">
        <span className="gcal-ic">📅</span>
        {g.connected ? (
          <>
            <div><b>Connected · {g.email}</b><small className="sub-t">Calls are added to your Google Calendar (with a Google Meet link when a calendar has no video link of its own).</small></div>
            <button className="btn ghost sm" onClick={async () => { if (confirm('Disconnect Google Calendar?')) setG(await api('/google/calendar', 'DELETE')); }}>Disconnect</button>
          </>
        ) : (
          <>
            <div><b>Connect Google Calendar</b><small className="sub-t">Stop double-bookings: times you’re busy in Google aren’t offered, and every call lands in your calendar with a Meet link.</small></div>
            <button className="btn primary sm" onClick={connect}>Connect</button>
          </>
        )}
      </div>
      {g.connected && <div className="row wrap"><label className="tog"><input type="checkbox" checked={g.blockBusy} onChange={(e) => set({ blockBusy: e.target.checked })} /><span />Hide times I’m busy in Google</label><label className="tog"><input type="checkbox" checked={g.addEvents} onChange={(e) => set({ addEvents: e.target.checked })} /><span />Add bookings to Google Calendar</label></div>}
    </Panel>
  );
}

function CalendarEditor({ c, onSaved, canDelete }) {
  const [v, setV] = useState(c);
  const [busy, setBusy] = useState(false);
  const [newDate, setNewDate] = useState('');
  const set = (patch) => setV({ ...v, ...patch });
  const setDay = (d, windows) => set({ hours: { ...v.hours, [d]: windows } });
  const save = async () => { setBusy(true); try { await api(`/calendars/${c.id}`, 'PUT', v); toast('Calendar saved'); onSaved(); } catch (e) { toast(e.message); } setBusy(false); };
  const del = async () => { if (!confirm(`Delete “${c.name}”?`)) return; try { await api(`/calendars/${c.id}`, 'DELETE'); onSaved(); } catch (e) { toast(e.message); } };
  return (
    <>
      <Panel title="Call details" actions={<button className="btn primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save'}</button>}>
        <div className="form2">
          <label className="fld"><span>Name</span><input value={v.name} maxLength={80} onChange={(e) => set({ name: e.target.value })} placeholder="Strategy call" /></label>
          <label className="fld"><span>Length</span><select value={v.duration} onChange={(e) => set({ duration: Number(e.target.value) })}>{[15, 20, 30, 45, 60, 90, 120].map((m) => <option key={m} value={m}>{m} minutes</option>)}</select></label>
          <label className="fld full"><span>Video call link <small className="muted">· Zoom, Google Meet or Teams — sent to everyone who books</small></span><input value={v.meetingLink || ''} onChange={(e) => set({ meetingLink: e.target.value })} placeholder="https://meet.google.com/abc-defg-hij" /></label>
          <label className="fld full"><span>…or a location / instructions</span><input value={v.location || ''} maxLength={200} onChange={(e) => set({ location: e.target.value })} placeholder="We’ll call you on WhatsApp · or · Office, Baner, Pune" /></label>
          <label className="fld"><span>Price <small className="muted">· 0 = free call</small></span><div className="row"><select value={v.currency || 'INR'} onChange={(e) => set({ currency: e.target.value })} style={{ width: 90 }}>{['INR', 'USD', 'EUR', 'GBP', 'AUD', 'CAD', 'SGD', 'AED'].map((c) => <option key={c}>{c}</option>)}</select><input type="number" min="0" value={v.price || 0} onChange={(e) => set({ price: Math.max(0, Number(e.target.value) || 0) })} /></div><small className="hint">{(v.currency || 'INR') === 'INR' ? 'Paid calls are confirmed once paid — through Razorpay, or Stripe if that’s what you connected.' : 'Paid by card through Stripe (connect it in Settings → Payments).'}</small></label>
          <label className="fld"><span>Refund if they cancel</span><select value={v.refundHours ?? 24} disabled={!v.price} onChange={(e) => set({ refundHours: Number(e.target.value) })}>{[[0, 'Any time before the call'], [12, '12+ hours before'], [24, '24+ hours before'], [48, '2+ days before'], [168, '7+ days before'], [720, 'No refunds']].map(([h, l]) => <option key={h} value={h}>{l}</option>)}</select></label>
          <label className="fld"><span>Gap between calls</span><select value={v.buffer} onChange={(e) => set({ buffer: Number(e.target.value) })}>{[0, 5, 10, 15, 30, 60].map((m) => <option key={m} value={m}>{m ? `${m} minutes` : 'None'}</option>)}</select></label>
          <label className="fld"><span>Minimum notice</span><select value={v.noticeHours} onChange={(e) => set({ noticeHours: Number(e.target.value) })}>{[0, 1, 2, 4, 12, 24, 48].map((h) => <option key={h} value={h}>{h ? `${h} hour${h > 1 ? 's' : ''}` : 'None'}</option>)}</select></label>
          <label className="fld"><span>Book up to</span><select value={v.daysAhead} onChange={(e) => set({ daysAhead: Number(e.target.value) })}>{[7, 14, 21, 30, 60, 90].map((d) => <option key={d} value={d}>{d} days ahead</option>)}</select></label>
          <label className="fld"><span>Max calls per day</span><input type="number" min="0" max="100" value={v.perDay} onChange={(e) => set({ perDay: Number(e.target.value) || 0 })} /><small className="hint">0 = no limit</small></label>
        </div>
        <div className="row"><label className="tog"><input type="checkbox" checked={!!v.reminders?.day} onChange={(e) => set({ reminders: { ...v.reminders, day: e.target.checked } })} /><span />Email reminder the day before</label>
          <label className="tog"><input type="checkbox" checked={!!v.reminders?.hour} onChange={(e) => set({ reminders: { ...v.reminders, hour: e.target.checked } })} /><span />Reminder 1 hour before</label></div>
      </Panel>
      <Panel title={`Weekly hours (${zoneCity(v.timezone || 'Asia/Kolkata')} time)`} actions={<select value={v.timezone || 'Asia/Kolkata'} onChange={(e) => set({ timezone: e.target.value })} title="This calendar’s time zone">{allZones().map((z) => <option key={z} value={z}>{zoneOption(z)}</option>)}</select>}>
        <div className="cal-week">{DAYS.map(([d, label]) => {
          const w = v.hours?.[d] || [];
          return (
            <div key={d} className="cal-day">
              <label className="tog"><input type="checkbox" checked={w.length > 0} onChange={(e) => setDay(d, e.target.checked ? [['10:00', '18:00']] : [])} /><span />{label}</label>
              <div className="cal-wins">{w.length ? w.map((win, i) => (
                <div key={i} className="cal-win">
                  <input type="time" value={win[0]} onChange={(e) => setDay(d, w.map((x, k) => (k === i ? [e.target.value, x[1]] : x)))} /><span>–</span>
                  <input type="time" value={win[1]} onChange={(e) => setDay(d, w.map((x, k) => (k === i ? [x[0], e.target.value] : x)))} />
                  <button className="icon-btn xs" title="Remove" onClick={() => setDay(d, w.filter((_, k) => k !== i))}><Icon name="x" size={12} /></button>
                </div>
              )) : <span className="muted sm">Unavailable</span>}
              {w.length > 0 && w.length < 4 && <button className="link-btn" onClick={() => setDay(d, [...w, ['16:00', '19:00']])}>+ add hours</button>}</div>
            </div>
          );
        })}</div>
      </Panel>
      <Panel title="Days off">
        <div className="row"><input type="date" value={newDate} onChange={(e) => setNewDate(e.target.value)} /><button className="btn ghost sm" disabled={!newDate} onClick={() => { set({ blocked: [...new Set([...(v.blocked || []), newDate])].sort() }); setNewDate(''); }}>Block this day</button></div>
        <div className="chips">{(v.blocked || []).map((d) => <button key={d} onClick={() => set({ blocked: v.blocked.filter((x) => x !== d) })}>{new Date(`${d}T00:00:00Z`).toLocaleDateString('en-IN', { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' })} ✕</button>)}</div>
        <p className="hint">Holidays and leave — nobody can book on these days. Remember to click Save.</p>
        {canDelete && <button className="btn ghost danger sm" onClick={del}><Icon name="trash" size={14} /> Delete this calendar</button>}
      </Panel>
    </>
  );
}
