import { Fragment, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { fmtWhenShort, zoneCity, allZones, zoneOption, viewerTz, dayKey, fmtTime, zoneLabel } from '../tzfmt';
import { Layout, Panel, Icon, Empty, Modal, toast, num, confirmDialog, promptDialog } from '../ui';

const DAYS = [['mon', 'Monday'], ['tue', 'Tuesday'], ['wed', 'Wednesday'], ['thu', 'Thursday'], ['fri', 'Friday'], ['sat', 'Saturday'], ['sun', 'Sunday']];
export const fmtWhen = (t, zone) => fmtWhenShort(t, zone ?? 330);
const money = (iso, v) => { try { return new Intl.NumberFormat(iso === 'INR' ? 'en-IN' : 'en-US', { style: 'currency', currency: iso || 'INR', minimumFractionDigits: 0 }).format(Number(v || 0)); } catch { return `${iso} ${v}`; } };
const lengthLabel = (m) => (m % 60 === 0 ? `${m / 60} hr` : m > 60 ? `${Math.floor(m / 60)} hr ${m % 60} min` : `${m} min`);
const copy = (text, what = 'Link') => navigator.clipboard?.writeText(text).then(() => toast(`${what} copied`), () => promptDialog({ title: 'Copy this', value: text, readOnly: true, confirm: 'Done', cancel: null }));
const meetUrl = (handle, slug) => `${location.origin}/meet/${handle}${slug ? `/${slug}` : ''}`;

export default function Bookings() {
  const [qs, setQs] = useSearchParams();
  const tab = qs.get('tab') || (qs.get('gcal') ? 'calendars' : 'upcoming');
  const [handle, setHandle] = useState(null);
  const [cals, setCals] = useState(null);
  const loadCals = () => api('/calendars').then(setCals);
  useEffect(() => { api('/booking-page').then((r) => setHandle(r.handle)).catch(() => {}); loadCals(); }, []);
  // back from Google's consent screen
  useEffect(() => {
    const g = qs.get('gcal');
    if (!g) return;
    toast({ connected: 'Google Calendar connected', cancelled: 'Google Calendar wasn’t connected', expired: 'That took too long — please try connecting again', failed: 'Couldn’t connect Google Calendar — please try again' }[g] || g);
    setQs({ tab: 'calendars' });
  }, []);
  return (
    <Layout title="Bookings" subtitle="Your booking page, your call types, and every call booked.">
      {handle && cals && <BookingPage handle={handle} setHandle={setHandle} cals={cals} onEdit={(id) => setQs({ tab: 'calendars', cal: id })} />}
      <div className="seg pr-tabs">{[['upcoming', 'Upcoming calls'], ['past', 'Past & cancelled'], ['calendars', 'Call types & hours']].map(([k, l]) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => setQs({ tab: k })}>{l}</button>)}</div>
      {tab === 'calendars' ? <Calendars handle={handle} initial={qs.get('cal')} onChange={loadCals} /> : <BookingList past={tab === 'past'} handle={handle} />}
    </Layout>
  );
}

// your public booking page: the link, the embed code, and a card per call type
function BookingPage({ handle, setHandle, cals, onEdit }) {
  const [edit, setEdit] = useState(false);
  const [embed, setEmbed] = useState(null);
  const url = meetUrl(handle);
  return (
    <section className="bp">
      <div className="bp-link">
        <div className="bp-l">
          <span className="bp-k">Your booking page</span>
          <a className="bp-url" href={url} target="_blank" rel="noreferrer">{url.replace(/^https?:\/\//, '')}</a>
          <small>Share it anywhere — Instagram bio, WhatsApp, email signature. Visitors see your free times in their own time zone.</small>
        </div>
        <div className="row">
          <button className="btn primary sm" onClick={() => copy(url)}><Icon name="copy" size={14} /> Copy link</button>
          <a className="btn ghost sm" href={url} target="_blank" rel="noreferrer"><Icon name="external" size={14} /> Open</a>
          <button className="btn ghost sm" onClick={() => setEmbed({ name: 'your booking page', url })}>Embed</button>
          <button className="btn ghost sm" onClick={() => setEdit(true)}><Icon name="edit" size={14} /> Change address</button>
        </div>
      </div>
      <div className="bp-types">
        {cals.map((c) => {
          const link = meetUrl(handle, c.slug);
          return (
            <div key={c.id} className="bp-type">
              <div className="bp-th"><b>{c.name}</b>{c.listed === false && <span className="pill" title="Not shown on your booking page — only people with the link can book">hidden</span>}</div>
              <span className="bp-meta">{(c.durations || [c.duration]).map(lengthLabel).join(' / ')} · {c.price > 0 ? money(c.currency, c.price) : 'Free'}</span>
              <div className="bp-acts">
                <button className="link-btn" onClick={() => copy(link)}><Icon name="link" size={13} /> Copy link</button>
                <button className="link-btn" onClick={() => setEmbed({ name: c.name, url: link })}>Embed</button>
                <button className="link-btn" onClick={() => onEdit(c.id)}>Edit</button>
              </div>
            </div>
          );
        })}
      </div>
      {edit && <HandleModal handle={handle} onClose={() => setEdit(false)} onSaved={(h) => { setHandle(h); setEdit(false); }} />}
      {embed && <EmbedModal {...embed} onClose={() => setEmbed(null)} />}
    </section>
  );
}

function HandleModal({ handle, onClose, onSaved }) {
  const [v, setV] = useState(handle);
  const [busy, setBusy] = useState(false);
  const save = async (e) => {
    e.preventDefault(); setBusy(true);
    try { const r = await api('/booking-page', 'PUT', { handle: v }); toast('Booking page address saved'); onSaved(r.handle); } catch (x) { toast(x.message); }
    setBusy(false);
  };
  return (
    <Modal title="Your booking page address" onClose={onClose} width={520}>
      <form onSubmit={save} className="m-body stack">
        <label className="fld"><span>Address</span><div className="bp-addr"><span>{location.host}/meet/</span><input value={v} autoFocus maxLength={30} onChange={(e) => setV(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))} /></div></label>
        <p className="hint">Old links stop working once you change it.</p>
        <div className="row end"><button type="button" className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy || v.length < 3}>{busy ? 'Saving…' : 'Save'}</button></div>
      </form>
    </Modal>
  );
}

function EmbedModal({ name, url, onClose }) {
  const inline = `<iframe src="${url}?embed=1" style="width:100%;min-height:720px;border:0" title="Book ${name.replace(/"/g, '')}"></iframe>`;
  const button = `<a href="${url}" target="_blank" style="display:inline-block;padding:12px 22px;border-radius:999px;background:#1c1917;color:#fff;font:600 15px system-ui;text-decoration:none">Book a call</a>`;
  return (
    <Modal title={`Add ${name} to your website`} onClose={onClose} width={620}>
      <div className="m-body stack">
        <div><b>Inline calendar</b><p className="hint">Paste where the calendar should appear (WordPress “Custom HTML”, Webflow “Embed”, Wix “Embed code”).</p><textarea className="code-area bp-code" readOnly rows={3} value={inline} onFocus={(e) => e.target.select()} /><button className="btn ghost sm" onClick={() => copy(inline, 'Embed code')}><Icon name="copy" size={14} /> Copy</button></div>
        <div><b>Button</b><p className="hint">A button that opens your booking page.</p><textarea className="code-area bp-code" readOnly rows={3} value={button} onFocus={(e) => e.target.select()} /><button className="btn ghost sm" onClick={() => copy(button, 'Button code')}><Icon name="copy" size={14} /> Copy</button></div>
      </div>
    </Modal>
  );
}

function BookingList({ past, handle }) {
  const [rows, setRows] = useState(null);
  const [open, setOpen] = useState(null);
  const load = () => api(`/bookings?from=${Date.now() - 90 * 864e5}`).then(setRows);
  useEffect(() => { load(); }, []);
  const z = viewerTz();
  const now = Date.now();
  const shown = (rows || []).filter((b) => (past ? b.status !== 'confirmed' || b.end < now : b.status === 'confirmed' && b.end >= now));
  if (past) shown.reverse();
  const cancel = async (b) => {
    const reason = await promptDialog({ title: `Cancel the call with ${b.name || b.email} on ${fmtWhen(b.start, z)}?`, text: `They’ll get an email${b.paid && !b.refunded ? ' and a full refund' : ''}.`, label: 'Reason (optional)', confirm: 'Cancel the call', cancel: 'Keep it', danger: true });
    if (reason === null) return;
    try { await api(`/bookings/${b.id}/cancel`, 'POST', { reason }); toast('Booking cancelled — they’ve been emailed'); load(); } catch (e) { toast(e.message); }
  };
  const outcome = async (b, o) => { try { const r = await api(`/bookings/${b.id}`, 'PUT', { outcome: b.outcome === o ? null : o }); setRows(rows.map((x) => (x.id === b.id ? { ...x, outcome: r.outcome } : x))); } catch (e) { toast(e.message); } };
  const today = dayKey(now, z), tomorrow = dayKey(now + 864e5, z);
  const live = (rows || []).filter((b) => b.status === 'confirmed');
  const done = live.filter((b) => b.end < now);
  // grouped by day, in your own time zone
  const groups = [];
  for (const b of shown) { const k = dayKey(b.start, z); const g = groups[groups.length - 1]; if (g?.k === k) g.list.push(b); else groups.push({ k, list: [b] }); }
  const dayTitle = (k, t) => `${k === today ? 'Today · ' : k === tomorrow ? 'Tomorrow · ' : ''}${new Date(t).toLocaleDateString('en-IN', { timeZone: z, weekday: 'long', day: 'numeric', month: 'long' })}`;
  return (
    <>
      {rows && (past ? (
        <div className="kpis k4">
          <div className="kpi"><span className="kpi-l">Calls held (90 days)</span><b className="kpi-v">{num(done.length)}</b></div>
          <div className="kpi"><span className="kpi-l">Marked completed</span><b className="kpi-v">{num(done.filter((b) => b.outcome === 'completed').length)}</b></div>
          <div className="kpi"><span className="kpi-l">No-shows</span><b className="kpi-v">{num(done.filter((b) => b.outcome === 'no_show').length)}</b></div>
          <div className="kpi"><span className="kpi-l">Cancelled</span><b className="kpi-v">{num(rows.filter((b) => b.status === 'cancelled').length)}</b></div>
        </div>
      ) : (
        <div className="kpis k4">
          <div className="kpi"><span className="kpi-l">Calls today</span><b className="kpi-v">{num(live.filter((b) => dayKey(b.start, z) === today).length)}</b></div>
          <div className="kpi"><span className="kpi-l">Next 7 days</span><b className="kpi-v">{num(live.filter((b) => b.start >= now && b.start < now + 7 * 864e5).length)}</b></div>
          <div className="kpi"><span className="kpi-l">Booked (90 days)</span><b className="kpi-v">{num(rows.filter((b) => b.status !== 'cancelled').length)}</b></div>
          <div className="kpi"><span className="kpi-l">Cancelled</span><b className="kpi-v">{num(rows.filter((b) => b.status === 'cancelled').length)}</b></div>
        </div>
      ))}
      {!rows ? <div className="skeleton" /> : !shown.length ? (
        <Panel>
          <Empty icon="clock" title={past ? 'Nothing here yet' : 'No upcoming calls'} text={past ? 'Finished, rescheduled and cancelled calls show up here — mark each one completed or no-show.' : 'Share your booking page link, or add a booking calendar to a funnel page. Calls land here, with confirmations and reminders sent for you.'}>
            {!past && <div className="row center">{handle && <button className="btn primary" onClick={() => copy(meetUrl(handle))}><Icon name="copy" size={14} /> Copy booking link</button>}<Link className="btn ghost" to="/templates">Browse application funnels</Link></div>}
          </Empty>
        </Panel>
      ) : groups.map((g) => (
        <section key={g.k} className="bk-day">
          <h3 className="bk-dh">{dayTitle(g.k, g.list[0].start)}<span>{g.list.length} call{g.list.length > 1 ? 's' : ''}</span></h3>
          <div className="bk-list">{g.list.map((b) => (
            <div key={b.id} className={`bk-row ${b.status !== 'confirmed' ? 'off' : ''}`}>
              <div className="bk-time"><b>{fmtTime(b.start, z)}</b><small>{fmtTime(b.end, z)} · {zoneLabel(z, b.start)}</small></div>
              <i className="bk-bar" />
              <div className="bk-who">
                <b>{b.name || b.email}</b>
                <small>{b.calendar?.name} · {lengthLabel(b.minutes || b.calendar?.duration || 30)} · {b.funnel ? `from ${b.funnel}` : b.source === 'embed' ? 'from your website' : b.source === 'booking page' ? 'from your booking page' : 'from a funnel'}</small>
                {(b.answers || b.notes) && <button className="link-btn" onClick={() => setOpen(open === b.id ? null : b.id)}>{open === b.id ? 'Hide details' : 'Details'}</button>}
                {open === b.id && (
                  <dl className="bk-ans">
                    <dt>Email</dt><dd>{b.email}</dd>
                    {b.phone && <><dt>Phone</dt><dd>{b.phone}</dd></>}
                    {Object.entries(b.answers || {}).map(([q, a]) => <Fragment key={q}><dt>{q}</dt><dd>{a}</dd></Fragment>)}
                    {b.notes && <><dt>Notes</dt><dd>{b.notes}</dd></>}
                  </dl>
                )}
              </div>
              <div className="bk-tags">
                {b.status !== 'confirmed' && <span className={`pill ${b.status === 'cancelled' ? 'bad' : 'warn'}`}>{b.status}{b.cancelledBy ? ` by ${b.cancelledBy === 'buyer' ? 'them' : 'you'}` : ''}</span>}
                {b.paid && <span className="pill ok">{b.refunded ? 'refunded' : `paid ${money(b.calendar?.currency, b.paid)}`}</span>}
                {b.unpaid && <span className="pill warn" title="Payments weren’t connected when they booked — collect it yourself">unpaid</span>}
                {b.google && <span className="pill" title="In your Google Calendar">G</span>}
              </div>
              <div className="bkr-acts">
                {b.status === 'confirmed' && b.end < now && <div className="seg sm bk-out">
                  <button className={b.outcome === 'completed' ? 'on' : ''} onClick={() => outcome(b, 'completed')}><Icon name="check" size={13} /> Completed</button>
                  <button className={b.outcome === 'no_show' ? 'on bad' : ''} onClick={() => outcome(b, 'no_show')}>No-show</button>
                </div>}
                {b.status === 'confirmed' && b.end >= now && b.calendar?.meetingLink && <a className="btn soft sm" href={b.calendar.meetingLink} target="_blank" rel="noreferrer">Join</a>}
                {b.phone && <a className="icon-btn" title="WhatsApp" aria-label="WhatsApp" href={`https://wa.me/${b.phone.replace(/\D/g, '').replace(/^(\d{10})$/, '91$1')}`} target="_blank" rel="noreferrer"><Icon name="send" size={15} /></a>}
                <a className="icon-btn" title="Email" aria-label="Email" href={`mailto:${b.email}`}><Icon name="mail" size={15} /></a>
                {b.status === 'confirmed' && b.start > now && <button className="icon-btn danger" title="Cancel" aria-label="Cancel" onClick={() => cancel(b)}><Icon name="x" size={15} /></button>}
              </div>
            </div>
          ))}</div>
        </section>
      ))}
    </>
  );
}

function Calendars({ handle, initial, onChange }) {
  const [list, setList] = useState(null);
  const [sel, setSel] = useState(null);
  const load = () => api('/calendars').then((l) => { setList(l); setSel((s) => l.find((c) => c.id === (s?.id || initial)) || l[0]); onChange?.(); });
  useEffect(() => { load(); }, [initial]);
  const add = async () => { try { const c = await api('/calendars', 'POST', { name: 'New call type', duration: 30 }); await load(); setSel(c); } catch (e) { toast(e.message); } };
  if (!list) return <div className="skeleton" />;
  return (
    <div className="pr-cols">
      <div className="pr-main"><GoogleCalendar />{sel && <CalendarEditor key={sel.id} c={sel} handle={handle} onSaved={load} canDelete={list.length > 1} />}</div>
      <aside className="pr-side">
        <Panel title="Call types" actions={<button className="btn ghost sm" onClick={add}><Icon name="plus" size={14} /> Add</button>}>
          <div className="cal-list">{list.map((c) => <button key={c.id} className={c.id === sel?.id ? 'on' : ''} onClick={() => setSel(c)}><b>{c.name}</b><small>{(c.durations || [c.duration]).join(' / ')} min{c.listed === false ? ' · hidden' : ''}{c === list[0] ? ' · default' : ''}</small></button>)}</div>
          <p className="hint">Each call type has its own page and link. The first one is the default for funnel booking blocks that don’t pick one.</p>
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
            <button className="btn ghost sm" onClick={async () => { if (await confirmDialog({ title: 'Disconnect Google Calendar?', confirm: 'Disconnect', danger: true })) setG(await api('/google/calendar', 'DELETE')); }}>Disconnect</button>
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

const LENGTHS = [10, 15, 20, 30, 45, 60, 90, 120];
function CalendarEditor({ c, handle, onSaved, canDelete }) {
  const [v, setV] = useState({ ...c, durations: c.durations || [c.duration], questions: c.questions || [] });
  const [busy, setBusy] = useState(false);
  const [newDate, setNewDate] = useState('');
  const set = (patch) => setV({ ...v, ...patch });
  const setDay = (d, windows) => set({ hours: { ...v.hours, [d]: windows } });
  const setQ = (i, patch) => set({ questions: v.questions.map((q, k) => (k === i ? { ...q, ...patch } : q)) });
  // the main length is always offered; others are extra choices for the person booking
  const toggleLen = (m) => { if (m === v.duration) return; set({ durations: v.durations.includes(m) ? v.durations.filter((x) => x !== m) : [...v.durations, m].sort((a, b) => a - b) }); };
  const save = async () => { setBusy(true); try { const r = await api(`/calendars/${c.id}`, 'PUT', v); setV({ ...v, ...r }); toast('Call type saved'); onSaved(); } catch (e) { toast(e.message); } setBusy(false); };
  const del = async () => { if (!await confirmDialog({ title: `Delete “${c.name}”?`, confirm: 'Delete', danger: true })) return; try { await api(`/calendars/${c.id}`, 'DELETE'); onSaved(); } catch (e) { toast(e.message); } };
  const link = handle && meetUrl(handle, c.slug);
  return (
    <>
      <Panel title="Call details" actions={<button className="btn primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save'}</button>}>
        <div className="form2">
          <label className="fld"><span>Name</span><input value={v.name} maxLength={80} onChange={(e) => set({ name: e.target.value })} placeholder="Strategy call" /></label>
          <label className="fld"><span>Length</span><select value={v.duration} onChange={(e) => { const d = Number(e.target.value); set({ duration: d, durations: [...new Set([d, ...v.durations])].sort((a, b) => a - b) }); }}>{LENGTHS.map((m) => <option key={m} value={m}>{m} minutes</option>)}</select></label>
          <div className="fld full"><span>Let them choose a length <small className="muted">· optional — the price scales with the length</small></span><div className="chips pick">{LENGTHS.map((m) => <button type="button" key={m} className={v.durations.includes(m) ? 'on' : ''} disabled={m === v.duration} onClick={() => toggleLen(m)}>{lengthLabel(m)}</button>)}</div></div>
          <label className="fld full"><span>Description <small className="muted">· shown on the booking page</small></span><textarea rows={3} maxLength={1000} value={v.description || ''} onChange={(e) => set({ description: e.target.value })} placeholder="A 30-minute call to map out your funnel and next steps. Come with your numbers." /></label>
          <label className="fld full"><span>Video call link <small className="muted">· Zoom, Google Meet or Teams — sent to everyone who books</small></span><input value={v.meetingLink || ''} onChange={(e) => set({ meetingLink: e.target.value })} placeholder="https://meet.google.com/abc-defg-hij" /></label>
          <label className="fld full"><span>…or a location / instructions</span><input value={v.location || ''} maxLength={200} onChange={(e) => set({ location: e.target.value })} placeholder="We’ll call you on WhatsApp · or · Office, Baner, Pune" /></label>
          <label className="fld"><span>Price <small className="muted">· 0 = free call</small></span><div className="row"><select value={v.currency || 'INR'} onChange={(e) => set({ currency: e.target.value })} style={{ width: 90 }}>{['INR', 'USD', 'EUR', 'GBP', 'AUD', 'CAD', 'SGD', 'AED'].map((x) => <option key={x}>{x}</option>)}</select><input type="number" min="0" value={v.price || 0} onChange={(e) => set({ price: Math.max(0, Number(e.target.value) || 0) })} /></div><small className="hint">{(v.currency || 'INR') === 'INR' ? 'Paid by UPI or card through Razorpay (or Stripe if that’s what you connected). The call is confirmed once paid.' : 'Paid by card through Stripe (connect it in Settings → Payments).'}</small></label>
          <label className="fld"><span>Refund if they cancel</span><select value={v.refundHours ?? 24} disabled={!v.price} onChange={(e) => set({ refundHours: Number(e.target.value) })}>{[[0, 'Any time before the call'], [12, '12+ hours before'], [24, '24+ hours before'], [48, '2+ days before'], [168, '7+ days before'], [720, 'No refunds']].map(([h, l]) => <option key={h} value={h}>{l}</option>)}</select></label>
          <label className="fld"><span>Start times</span><select value={v.interval || 0} onChange={(e) => set({ interval: Number(e.target.value) })}>{[[0, 'Automatic (clean times)'], [15, 'Every 15 minutes'], [20, 'Every 20 minutes'], [30, 'Every 30 minutes'], [60, 'On the hour']].map(([m, l]) => <option key={m} value={m}>{l}</option>)}</select></label>
          <label className="fld"><span>Gap between calls</span><select value={v.buffer} onChange={(e) => set({ buffer: Number(e.target.value) })}>{[0, 5, 10, 15, 30, 60].map((m) => <option key={m} value={m}>{m ? `${m} minutes` : 'None'}</option>)}</select></label>
          <label className="fld"><span>Minimum notice</span><select value={v.noticeHours} onChange={(e) => set({ noticeHours: Number(e.target.value) })}>{[0, 1, 2, 4, 12, 24, 48].map((h) => <option key={h} value={h}>{h ? `${h} hour${h > 1 ? 's' : ''}` : 'None'}</option>)}</select></label>
          <label className="fld"><span>Book up to</span><select value={v.daysAhead} onChange={(e) => set({ daysAhead: Number(e.target.value) })}>{[7, 14, 21, 30, 60, 90].map((d) => <option key={d} value={d}>{d} days ahead</option>)}</select></label>
          <label className="fld"><span>Max calls per day</span><input type="number" min="0" max="100" value={v.perDay} onChange={(e) => set({ perDay: Number(e.target.value) || 0 })} /><small className="hint">0 = no limit</small></label>
        </div>
        <div className="row"><label className="tog"><input type="checkbox" checked={!!v.reminders?.day} onChange={(e) => set({ reminders: { ...v.reminders, day: e.target.checked } })} /><span />Email reminder the day before</label>
          <label className="tog"><input type="checkbox" checked={!!v.reminders?.hour} onChange={(e) => set({ reminders: { ...v.reminders, hour: e.target.checked } })} /><span />Reminder 1 hour before</label></div>
      </Panel>
      <Panel title="Booking page" actions={<button className="btn primary sm" disabled={busy} onClick={save}>Save</button>}>
        <div className="form2">
          <label className="fld full"><span>Link</span><div className="bp-addr"><span>{location.host}/meet/{handle}/</span><input value={v.slug || ''} maxLength={40} onChange={(e) => set({ slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-') })} /></div></label>
        </div>
        <div className="row wrap">
          <label className="tog"><input type="checkbox" checked={v.listed !== false} onChange={(e) => set({ listed: e.target.checked })} /><span />Show on my booking page <small className="muted">(off = only people with the link can book)</small></label>
          {link && <><button className="btn ghost sm" onClick={() => copy(link)}><Icon name="copy" size={14} /> Copy link</button><a className="btn ghost sm" href={link} target="_blank" rel="noreferrer"><Icon name="external" size={14} /> Preview</a></>}
        </div>
      </Panel>
      <Panel title="Questions on the booking form" actions={<>{v.questions.length < 10 && <button className="btn ghost sm" onClick={() => set({ questions: [...v.questions, { label: '', type: 'text', required: false }] })}><Icon name="plus" size={14} /> Add question</button>}<button className="btn primary sm" disabled={busy} onClick={save}>Save</button></>}>
        <p className="hint">Name, email and phone are always asked. Add what you need to prepare — their answers show on the booking and in your email.</p>
        <div className="bq-list">{v.questions.map((q, i) => (
          <div key={q.id || i} className="bq">
            <input value={q.label} maxLength={200} placeholder="e.g. What’s your monthly revenue?" onChange={(e) => setQ(i, { label: e.target.value })} />
            <select value={q.type} onChange={(e) => setQ(i, { type: e.target.value })}><option value="text">Short answer</option><option value="long">Paragraph</option><option value="phone">Phone</option><option value="select">Dropdown</option></select>
            <label className="tog sm"><input type="checkbox" checked={!!q.required} onChange={(e) => setQ(i, { required: e.target.checked })} /><span />Required</label>
            <button className="icon-btn xs" title="Remove" aria-label="Remove" onClick={() => set({ questions: v.questions.filter((_, k) => k !== i) })}><Icon name="x" size={12} /></button>
            {q.type === 'select' && <input className="bq-opts" value={Array.isArray(q.options) ? q.options.join(', ') : q.options || ''} placeholder="Options, separated by commas" onChange={(e) => setQ(i, { options: e.target.value })} />}
          </div>
        ))}</div>
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
                  <button className="icon-btn xs" title="Remove" aria-label="Remove" onClick={() => setDay(d, w.filter((_, k) => k !== i))}><Icon name="x" size={12} /></button>
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
        {canDelete && <button className="btn ghost danger sm" onClick={del}><Icon name="trash" size={14} /> Delete this call type</button>}
      </Panel>
    </>
  );
}
