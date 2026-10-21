import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { fmtWhenShort, zoneCity, allZones, zoneOption } from '../tzfmt';
import { Layout, Panel, Icon, Empty, toast, num, downloadCSV, loadFailed } from '../ui';

const DAYS = [['mon', 'Mon'], ['tue', 'Tue'], ['wed', 'Wed'], ['thu', 'Thu'], ['fri', 'Fri'], ['sat', 'Sat'], ['sun', 'Sun']];
const fmt = (t, zone) => (t ? fmtWhenShort(t, zone ?? 330) : '—');

export default function Webinars() {
  const [list, setList] = useState(null);
  const [sel, setSel] = useState(null);
  const load = () => api('/webinars').then((l) => { setList(l); setSel((s) => l.find((w) => w.id === s?.id) || l[0] || null); });
  useEffect(() => { load(); }, []);
  return (
    <Layout title="Webinars" subtitle="Live sessions behind your registration pages — schedule, joining link, reminders, attendance and replays.">
      {!list ? <div className="skeleton" /> : !list.length ? (
        <Panel><Empty icon="play" title="No webinars yet" text="Use a webinar template (or add an opt-in form marked as a webinar registration). Sign-ups get a seat in the next session, a personal joining link and reminders by email — and you see who attended.">
          <Link className="btn primary" to="/templates">Browse webinar funnels</Link>
        </Empty></Panel>
      ) : (
        <div className="pr-cols">
          <div className="pr-main">{sel && <WebinarEditor key={sel.id} w={sel} onSaved={load} />}</div>
          <aside className="pr-side">
            <Panel title="Your webinars">
              <div className="cal-list">{list.map((w) => <button key={w.id} className={w.id === sel?.id ? 'on' : ''} onClick={() => setSel(w)}><b>{w.name}</b><small>{w.next ? `Next: ${fmt(w.next, w.timezone || w.tzOffset)} · ${num(w.upcomingSeats)} registered` : 'No upcoming session'}</small><small>{w.funnel || 'Funnel deleted'}</small></button>)}</div>
            </Panel>
          </aside>
        </div>
      )}
    </Layout>
  );
}

function WebinarEditor({ w, onSaved }) {
  const [v, setV] = useState(w);
  const [regs, setRegs] = useState(null);
  const [busy, setBusy] = useState(false);
  const [newDate, setNewDate] = useState('');
  useEffect(() => { api(`/webinars/${w.id}/registrations`).then(setRegs).catch(loadFailed); }, [w.id]);
  const s = v.schedule;
  const set = (patch) => setV({ ...v, ...patch });
  const setS = (patch) => set({ schedule: { ...s, ...patch } });
  const save = async () => { setBusy(true); try { await api(`/webinars/${w.id}`, 'PUT', v); toast('Webinar saved'); onSaved(); } catch (e) { toast(e.message); } setBusy(false); };
  const bySession = {};
  for (const r of regs || []) (bySession[r.session] ||= []).push(r);
  const sessions = Object.keys(bySession).map(Number).sort((a, b) => b - a);
  const exportCsv = () => downloadCSV(`${w.name}-registrants.csv`, (regs || []).map((r) => ({ session: new Date(r.session).toISOString(), name: r.name, email: r.email, phone: r.phone, status: r.status, attended: r.attended ? 'yes' : 'no', joined_at: r.joinedAt ? new Date(r.joinedAt).toISOString() : '', registered_at: new Date(r.at).toISOString() })));
  const total = regs?.length || 0, attended = (regs || []).filter((r) => r.attended).length, past = (regs || []).filter((r) => r.session + w.duration * 60000 < Date.now()).length;
  return (
    <>
      <div className="kpis k4">
        <div className="kpi"><span className="kpi-l">Next session</span><b className="kpi-v sm-v">{fmt(w.next, w.timezone || w.tzOffset)}</b></div>
        <div className="kpi"><span className="kpi-l">Registered for it</span><b className="kpi-v">{num(w.upcomingSeats)}</b></div>
        <div className="kpi"><span className="kpi-l">All registrations</span><b className="kpi-v">{num(total)}</b></div>
        <div className="kpi"><span className="kpi-l">Show-up rate</span><b className="kpi-v">{past ? `${Math.round((attended / past) * 100)}%` : '—'}</b><small>of past sessions</small></div>
      </div>
      <Panel title="Session" actions={<button className="btn primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save'}</button>}>
        <div className="form2">
          <label className="fld"><span>Name</span><input value={v.name} maxLength={120} onChange={(e) => set({ name: e.target.value })} /></label>
          <label className="fld"><span>Length</span><select value={v.duration} onChange={(e) => set({ duration: Number(e.target.value) })}>{[30, 45, 60, 75, 90, 120, 150, 180].map((m) => <option key={m} value={m}>{m} minutes</option>)}</select></label>
          <label className="fld full"><span>Joining link <small className="muted">· Zoom, Google Meet, YouTube Live, StreamYard… Registrants never see it until the room opens</small></span><input value={v.joinUrl || ''} onChange={(e) => set({ joinUrl: e.target.value })} placeholder="https://us06web.zoom.us/j/…" /></label>
          {!v.joinUrl && <p className="hint full warn-t">⚠ Add the joining link before your first session — the “Join” button waits for it.</p>}
        </div>
      </Panel>
      <Panel title={`Schedule (${zoneCity(v.timezone || 'Asia/Kolkata')} time)`} actions={<select value={v.timezone || 'Asia/Kolkata'} onChange={(e) => set({ timezone: e.target.value })} title="The webinar’s time zone — registrants see times in their own">{allZones().map((z) => <option key={z} value={z}>{zoneOption(z)}</option>)}</select>}>
        <div className="seg">{[['weekly', 'Weekly'], ['daily', 'Every day (evergreen)'], ['once', 'Specific dates']].map(([k, l]) => <button key={k} className={s.type === k ? 'on' : ''} onClick={() => setS({ type: k, ...(k === 'weekly' && !s.days?.length ? { days: ['sun'] } : {}), ...(k !== 'once' && !s.times?.length ? { times: ['11:00'] } : {}) })}>{l}</button>)}</div>
        {s.type === 'weekly' && <div className="chips wb-days">{DAYS.map(([d, l]) => { const on = s.days.includes(d); return <button key={d} className={on ? 'on' : ''} onClick={() => setS({ days: on ? s.days.filter((x) => x !== d) : [...s.days, d] })}>{l}</button>; })}</div>}
        {s.type !== 'once' && (
          <div className="wb-times">{s.times.map((t, i) => <span key={i} className="cal-win"><input type="time" value={t} onChange={(e) => setS({ times: s.times.map((x, k) => (k === i ? e.target.value : x)) })} />{s.times.length > 1 && <button className="icon-btn xs" aria-label="Remove time" onClick={() => setS({ times: s.times.filter((_, k) => k !== i) })}><Icon name="x" size={12} /></button>}</span>)}
            {s.times.length < 6 && <button className="link-btn" onClick={() => setS({ times: [...s.times, '19:00'] })}>+ add a time</button>}</div>
        )}
        {s.type === 'daily' && <label className="fld"><span>Sessions a visitor can choose from</span><select value={s.show} onChange={(e) => setS({ show: Number(e.target.value) })}>{[1, 2, 3, 4, 6].map((n) => <option key={n} value={n}>{n}</option>)}</select></label>}
        {s.type === 'once' && (
          <>
            <div className="row"><input type="datetime-local" value={newDate} onChange={(e) => setNewDate(e.target.value)} /><button className="btn ghost sm" disabled={!newDate} onClick={() => { setS({ dates: [...new Set([...s.dates, newDate.slice(0, 16)])].sort() }); setNewDate(''); }}>Add date</button></div>
            <div className="chips">{s.dates.map((d) => <button key={d} onClick={() => setS({ dates: s.dates.filter((x) => x !== d) })}>{new Date(`${d}:00Z`).toLocaleString('en-IN', { timeZone: 'UTC', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true })} ✕</button>)}</div>
          </>
        )}
        <p className="hint">When there’s more than one upcoming session, the registration form lets people pick. The page’s hero shows the next date automatically.</p>
      </Panel>
      <Panel title="Emails & replay">
        <div className="row wrap">{[['day', 'Reminder a day before'], ['hour', '1 hour before'], ['live', '“We’re live” at the start'], ['replay', 'Replay afterwards']].map(([k, l]) => <label key={k} className="tog"><input type="checkbox" checked={v.emails?.[k] !== false} onChange={(e) => set({ emails: { ...v.emails, [k]: e.target.checked } })} /><span />{l}</label>)}</div>
        <div className="form2">
          <label className="fld"><span>Replay link <small className="muted">· optional — otherwise your funnel’s replay page</small></span><input value={v.replayUrl || ''} onChange={(e) => set({ replayUrl: e.target.value })} placeholder="https://youtu.be/…" /></label>
          <label className="fld"><span>Replay available for</span><select value={v.replayHours} onChange={(e) => set({ replayHours: Number(e.target.value) })}>{[[24, '24 hours'], [48, '48 hours'], [72, '3 days'], [168, '7 days'], [0, 'Always']].map(([h, l]) => <option key={h} value={h}>{l}</option>)}</select></label>
        </div>
        <p className="hint">Confirmation and reminders include each person’s private joining link, which records who attended. Automations can follow up with “attended” and “missed” triggers.</p>
      </Panel>
      <Panel pad={false} title="Registrants" actions={regs?.length > 0 && <button className="btn ghost sm" onClick={exportCsv}><Icon name="download" size={14} /> CSV</button>}>
        {!regs ? <div className="skeleton" /> : !regs.length ? <Empty icon="users" title="No registrations yet" text="Share your registration page — sign-ups appear here per session." /> : sessions.map((t) => (
          <details key={t} className="wb-sess" open={t === sessions.find((x) => x + w.duration * 60000 >= Date.now()) || t === sessions[0]}>
            <summary><b>{fmt(t, w.timezone || w.tzOffset)}</b><span>{bySession[t].length} registered{t + w.duration * 60000 < Date.now() ? ` · ${bySession[t].filter((r) => r.attended).length} attended` : ''}</span></summary>
            <table className="tbl compact"><tbody>{bySession[t].map((r) => <tr key={r.id}><td><b>{r.name || '—'}</b><small className="sub-t">{r.email}{r.phone ? ` · ${r.phone}` : ''}</small></td><td>{r.attended ? <span className="pill ok">attended</span> : r.status === 'missed' ? <span className="pill bad">missed</span> : <span className="pill">registered</span>}</td><td className="r muted sm">{new Date(r.at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</td></tr>)}</tbody></table>
          </details>
        ))}
      </Panel>
    </>
  );
}
