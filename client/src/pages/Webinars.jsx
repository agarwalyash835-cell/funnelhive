import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { fmtWhenShort, zoneCity, allZones, zoneOption } from '../tzfmt';
import { AiPrompt, Layout, Panel, Icon, Empty, toast, num, inr, downloadCSV, loadFailed, confirmDialog } from '../ui';

const DAYS = [['mon', 'Mon'], ['tue', 'Tue'], ['wed', 'Wed'], ['thu', 'Thu'], ['fri', 'Fri'], ['sat', 'Sat'], ['sun', 'Sun']];
const fmt = (t, zone) => (t ? fmtWhenShort(t, zone ?? 330) : '—');
const PROVIDERS = [['link', 'Any link', 'Google Meet, YouTube Live, StreamYard…'], ['zoom', 'Zoom', 'Personal links, watch time'], ['webinargg', 'webinar.gg', 'Straight into the room, no app']];
const ZOOM_SCOPES = ['user:read:user:admin', 'webinar:write:webinar:admin', 'webinar:read:webinar:admin', 'webinar:write:registrant:admin', 'meeting:write:meeting:admin', 'meeting:read:meeting:admin', 'report:read:list_webinar_participants:admin', 'report:read:list_meeting_participants:admin'];

export default function Webinars() {
  const [list, setList] = useState(null);
  const [sel, setSel] = useState(null);
  const [zoom, setZoom] = useState(undefined);
  const [gg, setGg] = useState(undefined); // { webinargg, hook }
  const load = () => api('/webinars').then((l) => { setList(l); setSel((s) => l.find((w) => w.id === s?.id) || l[0] || null); });
  useEffect(() => { load(); api('/zoom').then((r) => setZoom(r.zoom)).catch(() => setZoom(null)); api('/webinargg').then(setGg).catch(() => setGg({ webinargg: null })); }, []);
  return (
    <Layout title="Webinars" subtitle="Live sessions behind your registration pages — schedule, Zoom or any platform, reminders, attendance, watch time and sales.">
      {!list ? <div className="skeleton" /> : !list.length ? (
        <Panel><Empty icon="play" title="No webinars yet" text="Use a webinar template (or add an opt-in form marked as a webinar registration). Sign-ups get a seat in the next session, a personal joining link and reminders by email — and you see who attended.">
          <Link className="btn primary" to="/templates">Browse webinar funnels</Link>
        </Empty></Panel>
      ) : (
        <div className="pr-cols">
          <div className="pr-main">{sel && <WebinarEditor key={sel.id} w={sel} onSaved={load} zoom={zoom} setZoom={setZoom} gg={gg} setGg={setGg} />}</div>
          <aside className="pr-side">
            <Panel title="Your webinars">
              <div className="cal-list">{list.map((w) => <button key={w.id} className={w.id === sel?.id ? 'on' : ''} onClick={() => setSel(w)}><b>{w.name}</b><small>{w.next ? `Next: ${fmt(w.next, w.timezone || w.tzOffset)} · ${num(w.upcomingSeats)} registered` : 'No upcoming session'}</small><small>{w.funnel || 'Funnel deleted'}{w.provider === 'zoom' ? ' · Zoom' : w.provider === 'webinargg' ? ' · webinar.gg' : ''}</small></button>)}</div>
            </Panel>
          </aside>
        </div>
      )}
    </Layout>
  );
}

// the seller's webinar.gg: an API token (premium plan) from Settings → Integrations
function WggConnect({ onDone }) {
  const [v, setV] = useState({ token: '', email: '' });
  const [busy, setBusy] = useState(false);
  const go = async (e) => { e.preventDefault(); setBusy(true); try { const r = await api('/webinargg', 'PUT', v); onDone(r); toast('webinar.gg connected'); } catch (er) { toast(er.message); } setBusy(false); };
  return (
    <form className="wb-zoom" onSubmit={go}>
      <b>Connect your webinar.gg account</b>
      <ol className="wb-steps">
        <li>Sign in at <a href="https://webinar.gg" target="_blank" rel="noreferrer">webinar.gg</a> and open <b>Settings → Integrations</b> (the API needs a premium plan).</li>
        <li>Create an API token and copy it — it’s shown only once.</li>
      </ol>
      <div className="form2">
        <label className="fld"><span>API token</span><input type="password" value={v.token} onChange={(e) => setV({ ...v, token: e.target.value.trim() })} placeholder="wg_live_…" autoComplete="off" /></label>
        <label className="fld"><span>Your webinar.gg login email <small className="muted">· for the host studio link</small></span><input type="email" value={v.email} onChange={(e) => setV({ ...v, email: e.target.value.trim() })} placeholder="you@business.in" /></label>
      </div>
      <button className="btn primary" disabled={busy || !v.token}>{busy ? <span className="spin" /> : null}Connect webinar.gg</button>
    </form>
  );
}

// the seller's own Zoom: a Server-to-Server OAuth app (marketplace.zoom.us → Develop → Build app)
function ZoomConnect({ onDone }) {
  const [v, setV] = useState({ accountId: '', clientId: '', clientSecret: '' });
  const [busy, setBusy] = useState(false);
  const go = async (e) => { e.preventDefault(); setBusy(true); try { const r = await api('/zoom', 'PUT', v); onDone(r.zoom); toast(`Zoom connected — ${r.zoom.email}`); } catch (er) { toast(er.message); } setBusy(false); };
  return (
    <form className="wb-zoom" onSubmit={go}>
      <b>Connect your Zoom account</b>
      <ol className="wb-steps">
        <li>Open <a href="https://marketplace.zoom.us/develop/create" target="_blank" rel="noreferrer">Zoom App Marketplace → Develop → Build app</a> and choose <b>Server-to-Server OAuth</b>.</li>
        <li>Under <b>Scopes</b>, add: <code>{ZOOM_SCOPES.join(', ')}</code></li>
        <li>Activate the app, then copy its Account ID, Client ID and Client secret here.</li>
      </ol>
      <div className="form2">
        <label className="fld"><span>Account ID</span><input value={v.accountId} onChange={(e) => setV({ ...v, accountId: e.target.value.trim() })} autoComplete="off" /></label>
        <label className="fld"><span>Client ID</span><input value={v.clientId} onChange={(e) => setV({ ...v, clientId: e.target.value.trim() })} autoComplete="off" /></label>
        <label className="fld full"><span>Client secret</span><input type="password" value={v.clientSecret} onChange={(e) => setV({ ...v, clientSecret: e.target.value.trim() })} autoComplete="off" /></label>
      </div>
      <button className="btn primary" disabled={busy || !v.accountId || !v.clientId || !v.clientSecret}>{busy ? <span className="spin" /> : null}Connect Zoom</button>
    </form>
  );
}

function WebinarEditor({ w, onSaved, zoom, setZoom, gg, setGg }) {
  const [v, setV] = useState({ provider: 'link', ...w });
  const [regs, setRegs] = useState(null);
  const [stats, setStats] = useState(null);
  const [busy, setBusy] = useState(false);
  const [newDate, setNewDate] = useState('');
  const loadRegs = () => { api(`/webinars/${w.id}/registrations`).then(setRegs).catch(loadFailed); api(`/webinars/${w.id}/analytics`).then(setStats).catch(() => {}); };
  useEffect(loadRegs, [w.id]);
  const s = v.schedule;
  const set = (patch) => setV((cur) => ({ ...cur, ...patch }));
  const setS = (patch) => set({ schedule: { ...s, ...patch } });
  const save = async () => { setBusy(true); try { await api(`/webinars/${w.id}`, 'PUT', v); toast('Webinar saved'); onSaved(); } catch (e) { toast(e.message); } setBusy(false); };
  const host = async () => { setBusy(true); try { const r = await api(`/webinars/${w.id}/host`, 'POST', {}); window.open(r.url, '_blank', 'noopener'); } catch (e) { toast(e.message); } setBusy(false); };
  const dropGg = async () => { if (!await confirmDialog({ title: 'Disconnect webinar.gg?', text: 'Rooms already made stay on webinar.gg, but new sessions won’t get one until you connect again.', confirm: 'Disconnect', danger: true })) return; await api('/webinargg', 'DELETE'); setGg({ ...gg, webinargg: null }); };
  const dropZoom = async () => { if (!await confirmDialog({ title: 'Disconnect Zoom?', text: 'Webinars on Zoom keep the sessions already made, but new ones can’t be created until you connect again.', confirm: 'Disconnect', danger: true })) return; await api('/zoom', 'DELETE'); setZoom(null); };
  const bySession = {};
  for (const r of regs || []) (bySession[r.session] ||= []).push(r);
  const sessions = Object.keys(bySession).map(Number).sort((a, b) => b - a);
  const exportCsv = () => downloadCSV(`${w.name}-registrants.csv`, (regs || []).map((r) => ({ session: new Date(r.session).toISOString(), name: r.name, email: r.email, phone: r.phone, status: r.status, attended: r.attended ? 'yes' : 'no', minutes_watched: r.watchMinutes ?? '', watched_replay: r.replay ? 'yes' : 'no', joined_at: r.joinedAt ? new Date(r.joinedAt).toISOString() : '', registered_at: new Date(r.at).toISOString() })));
  const t = stats?.totals;
  const onZoom = v.provider === 'zoom' && zoom;
  return (
    <>
      <div className="kpis k4">
        <div className="kpi"><span className="kpi-l">Next session</span><b className="kpi-v sm-v">{fmt(w.next, w.timezone || w.tzOffset)}</b><small>{num(w.upcomingSeats)} registered</small></div>
        <div className="kpi"><span className="kpi-l">Show-up rate</span><b className="kpi-v">{t?.showUp != null ? `${t.showUp}%` : '—'}</b><small>{t ? `${num(t.attended)} of ${num(t.past)} came live` : 'of past sessions'}</small></div>
        <div className="kpi"><span className="kpi-l">Average watch time</span><b className="kpi-v">{t?.avgMinutes != null ? `${t.avgMinutes} min` : '—'}</b><small>{t?.timed ? `${num(t.stayed)} stayed half or more` : 'from Zoom or an attendance list'}</small></div>
        <div className="kpi"><span className="kpi-l">Sales from it</span><b className="kpi-v">{t ? inr(t.revenue) : '—'}</b><small>{t ? `${num(t.buyers)} buyer${t.buyers === 1 ? '' : 's'} within 14 days` : ''}</small></div>
      </div>
      <AiPrompt title="Set it up with AI" hint="Schedule, length and replay from one sentence" placeholder="e.g. Free masterclass every Sunday 11 am and Wednesday 7 pm, 75 minutes, replay for 2 days" onDraft={async (prompt) => { const r = await api(`/webinars/${w.id}/ai`, 'POST', { prompt }); set(r.draft); toast(`Set up — next: ${fmt(r.next[0], w.timezone || w.tzOffset)}. Check it, then Save`); }} />
      <Panel title="Where it’s held" actions={<button className="btn primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save'}</button>}>
        <div className="wb-prov">{PROVIDERS.map(([k, l, d]) => <button key={k} className={v.provider === k ? 'on' : ''} onClick={() => set({ provider: k })}><b>{l}</b><small>{d}</small></button>)}</div>
        <div className="form2">
          <label className="fld"><span>Name</span><input value={v.name} maxLength={120} onChange={(e) => set({ name: e.target.value })} /></label>
          <label className="fld"><span>Length</span><select value={v.duration} onChange={(e) => set({ duration: Number(e.target.value) })}>{[30, 45, 60, 75, 90, 120, 150, 180].map((m) => <option key={m} value={m}>{m} minutes</option>)}</select></label>
          {v.provider === 'link' && <>
            <label className="fld full"><span>Joining link <small className="muted">· Google Meet, YouTube Live, StreamYard… Registrants never see it until the room opens</small></span><input value={v.joinUrl || ''} onChange={(e) => set({ joinUrl: e.target.value })} placeholder="https://meet.google.com/…" /></label>
            {!v.joinUrl && <p className="hint full warn-t">⚠ Add the joining link before your first session — the “Join” button waits for it.</p>}
          </>}
          {v.provider === 'webinargg' && !gg?.webinargg && <>
            <label className="fld full"><span>Or paste a webinar.gg attendee link <small className="muted">· if you’d rather not connect your account</small></span><input value={v.joinUrl || ''} onChange={(e) => set({ joinUrl: e.target.value })} placeholder="https://webinar.gg/…" /></label>
          </>}
        </div>
        {v.provider === 'webinargg' && (gg === undefined ? <span className="spin dark" /> : !gg.webinargg ? <WggConnect onDone={setGg} /> : (
          <div className="wb-zoom">
            <div className="row" style={{ justifyContent: 'space-between' }}><span><span className="cb-live">webinar.gg connected</span> <b>{gg.webinargg.email}</b></span><button className="link-btn" onClick={dropGg}>Disconnect</button></div>
            <p className="hint" style={{ margin: 0 }}>Each session gets its own webinar.gg room, made when the first person registers. Registrants go straight into the room from their joining link — no form or OTP — and afterwards the room’s attendee list marks who came.</p>
            <label className="tog"><input type="checkbox" checked={!!v.wggRecord} onChange={(e) => set({ wggRecord: e.target.checked })} /><span />Record the sessions (the recording becomes that session’s replay)</label>
            {w.next && <button className="btn ghost" style={{ justifySelf: 'start' }} onClick={host} disabled={busy || w.provider !== 'webinargg'}><Icon name="play" size={14} />Open the next session’s host studio</button>}
            <div className="wb-att" style={{ marginTop: 0, paddingTop: 10 }}>
              <b className="sm">Once: paste this in webinar.gg → Settings → Integrations → Webhook callback URL</b>
              <div className="row" style={{ gap: 6, flexWrap: 'nowrap' }}><input readOnly value={gg.hook} onFocus={(e) => e.target.select()} aria-label="webinar.gg webhook" /><button className="btn ghost sm" onClick={() => { navigator.clipboard?.writeText(gg.hook); toast('Copied'); }}><Icon name="copy" size={13} />Copy</button></div>
              <span className="hint" style={{ margin: 0 }}>So attendance comes in the moment a session ends, and recordings become replays.</span>
            </div>
            {w.provider !== 'webinargg' && <p className="hint warn-t" style={{ margin: 0 }}>Save to move this webinar to webinar.gg.</p>}
          </div>
        ))}
        {v.provider === 'zoom' && (zoom === undefined ? <span className="spin dark" /> : !zoom ? <ZoomConnect onDone={setZoom} /> : (
          <div className="wb-zoom">
            <div className="row" style={{ justifyContent: 'space-between' }}><span><span className="cb-live">Zoom connected</span> <b>{zoom.email}</b>{zoom.name ? ` · ${zoom.name}` : ''}</span><button className="link-btn" onClick={dropZoom}>Disconnect</button></div>
            <div className="seg">
              <button className={v.zoomKind !== 'meeting' && zoom.webinars ? 'on' : ''} disabled={!zoom.webinars} onClick={() => set({ zoomKind: 'webinar' })} title={zoom.webinars ? '' : 'Needs the Zoom Webinars add-on'}>Zoom webinar</button>
              <button className={v.zoomKind === 'meeting' || !zoom.webinars ? 'on' : ''} onClick={() => set({ zoomKind: 'meeting' })}>Zoom meeting</button>
            </div>
            <p className="hint" style={{ margin: 0 }}>{v.zoomKind !== 'meeting' && zoom.webinars ? 'Each session becomes its own Zoom webinar and every registrant gets a personal Zoom link — so Zoom’s report shows exactly who watched and for how long.' : `Each session becomes its own Zoom meeting.${zoom.webinars ? '' : ' (Your Zoom account has no Webinars add-on, so sessions are meetings.)'} Attendance and watch time come from Zoom’s report, matched by email.`}</p>
            <label className="tog"><input type="checkbox" checked={!!v.zoomRecord} onChange={(e) => set({ zoomRecord: e.target.checked })} /><span />Record to the Zoom cloud (for your replay)</label>
            {w.next && <button className="btn ghost" style={{ justifySelf: 'start' }} onClick={host} disabled={busy}><Icon name="play" size={14} />Start the next session as host</button>}
            {w.provider !== 'zoom' && <p className="hint warn-t" style={{ margin: 0 }}>Save to move this webinar to Zoom.</p>}
          </div>
        ))}
      </Panel>
      <Panel title={`Schedule (${zoneCity(v.timezone || 'Asia/Kolkata')} time)`} actions={<select value={v.timezone || 'Asia/Kolkata'} onChange={(e) => set({ timezone: e.target.value })} title="The webinar’s time zone — registrants see times in their own">{allZones().map((z) => <option key={z} value={z}>{zoneOption(z)}</option>)}</select>}>
        <div className="seg">{[['weekly', 'Weekly'], ['daily', 'Every day (evergreen)'], ['once', 'Specific dates']].map(([k, l]) => <button key={k} className={s.type === k ? 'on' : ''} onClick={() => setS({ type: k, ...(k === 'weekly' && !s.days?.length ? { days: ['sun'] } : {}), ...(k !== 'once' && !s.times?.length ? { times: ['11:00'] } : {}) })}>{l}</button>)}</div>
        {s.type === 'weekly' && <div className="chips wb-days">{DAYS.map(([d, l]) => { const on = s.days.includes(d); return <button key={d} className={on ? 'on' : ''} onClick={() => setS({ days: on ? s.days.filter((x) => x !== d) : [...s.days, d] })}>{l}</button>; })}</div>}
        {s.type !== 'once' && (
          <div className="wb-times">{s.times.map((tm, i) => <span key={i} className="cal-win"><input type="time" value={tm} onChange={(e) => setS({ times: s.times.map((x, k) => (k === i ? e.target.value : x)) })} />{s.times.length > 1 && <button className="icon-btn xs" aria-label="Remove time" onClick={() => setS({ times: s.times.filter((_, k) => k !== i) })}><Icon name="x" size={12} /></button>}</span>)}
            {s.times.length < 6 && <button className="link-btn" onClick={() => setS({ times: [...s.times, '19:00'] })}>+ add a time</button>}</div>
        )}
        {s.type === 'daily' && <label className="fld"><span>Sessions a visitor can choose from</span><select value={s.show} onChange={(e) => setS({ show: Number(e.target.value) })}>{[1, 2, 3, 4, 6].map((n) => <option key={n} value={n}>{n}</option>)}</select></label>}
        {s.type === 'once' && (
          <>
            <div className="row"><input type="datetime-local" value={newDate} onChange={(e) => setNewDate(e.target.value)} /><button className="btn ghost sm" disabled={!newDate} onClick={() => { setS({ dates: [...new Set([...s.dates, newDate.slice(0, 16)])].sort() }); setNewDate(''); }}>Add date</button></div>
            <div className="chips">{s.dates.map((d) => <button key={d} onClick={() => setS({ dates: s.dates.filter((x) => x !== d) })}>{new Date(`${d}:00Z`).toLocaleString('en-IN', { timeZone: 'UTC', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true })} ✕</button>)}</div>
          </>
        )}
        <p className="hint">When there’s more than one upcoming session, the registration form lets people pick. The page’s hero shows the next date automatically.{v.provider === 'zoom' ? ' Zoom sessions are created on Zoom automatically when the first person registers.' : ''}</p>
      </Panel>
      <Panel title="Emails & replay">
        <div className="row wrap">{[['day', 'Reminder a day before'], ['hour', '1 hour before'], ['live', '“We’re live” at the start'], ['replay', 'Replay afterwards']].map(([k, l]) => <label key={k} className="tog"><input type="checkbox" checked={v.emails?.[k] !== false} onChange={(e) => set({ emails: { ...v.emails, [k]: e.target.checked } })} /><span />{l}</label>)}</div>
        <div className="form2">
          <label className="fld"><span>Replay link <small className="muted">· optional — otherwise your funnel’s replay page</small></span><input value={v.replayUrl || ''} onChange={(e) => set({ replayUrl: e.target.value })} placeholder="https://youtu.be/…" /></label>
          <label className="fld"><span>Replay available for</span><select value={v.replayHours} onChange={(e) => set({ replayHours: Number(e.target.value) })}>{[[24, '24 hours'], [48, '48 hours'], [72, '3 days'], [168, '7 days'], [0, 'Always']].map(([h, l]) => <option key={h} value={h}>{l}</option>)}</select></label>
        </div>
        <p className="hint">Confirmation and reminders include each person’s private joining link, which records who attended. Automations can follow up with “attended” and “missed” triggers.</p>
      </Panel>
      {stats && <Analytics w={w} stats={stats} sessions={sessions} onImported={loadRegs} />}
      <Panel pad={false} title="Registrants" actions={regs?.length > 0 && <button className="btn ghost sm" onClick={exportCsv}><Icon name="download" size={14} /> CSV</button>}>
        {!regs ? <div className="skeleton" /> : !regs.length ? <Empty icon="users" title="No registrations yet" text="Share your registration page — sign-ups appear here per session." /> : sessions.map((tm) => (
          <details key={tm} className="wb-sess" open={tm === sessions.find((x) => x + w.duration * 60000 >= Date.now()) || tm === sessions[0]}>
            <summary><b>{fmt(tm, w.timezone || w.tzOffset)}</b><span>{bySession[tm].length} registered{tm + w.duration * 60000 < Date.now() ? ` · ${bySession[tm].filter((r) => r.attended).length} attended` : ''}</span></summary>
            <table className="tbl compact"><tbody>{bySession[tm].map((r) => <tr key={r.id}><td><b>{r.name || '—'}</b><small className="sub-t">{r.email}{r.phone ? ` · ${r.phone}` : ''}</small></td><td>{r.attended ? <span className="pill ok">attended{r.watchMinutes ? ` · ${r.watchMinutes} min` : ''}</span> : r.status === 'missed' ? <span className="pill bad">missed{r.replay ? ' · saw replay' : ''}</span> : <span className="pill">registered</span>}</td><td className="r muted sm">{new Date(r.at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</td></tr>)}</tbody></table>
          </details>
        ))}
      </Panel>
    </>
  );
}

// an attendee export from any platform: the email column, and minutes watched when there's a column for it
function parseAttendees(text) {
  const rows = text.split(/\r?\n/).map((l) => l.split(/,|\t|;/).map((c) => c.trim().replace(/^"|"$/g, '')));
  const head = rows.findIndex((r) => r.some((c) => /e-?mail/i.test(c)));
  const hdr = head >= 0 ? rows[head].map((c) => c.toLowerCase()) : [];
  const ei = hdr.findIndex((c) => /e-?mail/.test(c)), mi = hdr.findIndex((c) => /minute|duration|time in|watch/.test(c));
  const secs = mi >= 0 && /sec/.test(hdr[mi]);
  return rows.slice(head + 1).map((r) => {
    const email = (ei >= 0 ? r[ei] : r.find((c) => /@/.test(c))) || '';
    const n = mi >= 0 ? Number(String(r[mi]).replace(/[^\d.]/g, '')) : 0;
    return /@/.test(email) ? { email: email.toLowerCase(), ...(n > 0 ? (secs ? { seconds: n } : { minutes: n }) : {}) } : null;
  }).filter(Boolean);
}

function Analytics({ w, stats, sessions, onImported }) {
  const t = stats.totals, file = useRef();
  const past = sessions.filter((x) => x + w.duration * 60000 < Date.now());
  const [session, setSession] = useState(past[0] || '');
  const steps = [['Registered', t.registered], ['Came live', t.attended], ['Stayed half or more', t.stayed], ['Bought', t.buyers]];
  const top = Math.max(1, t.registered);
  const peak = Math.max(1, ...stats.signups.map((d) => d.n));
  const upload = async (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    const rows = parseAttendees(await f.text());
    if (!rows.length) return toast('No email addresses found in that file');
    try { const r = await api(`/webinars/${w.id}/attendance`, 'POST', { session: Number(session), rows }); toast(`✅ ${r.matched} registrant${r.matched === 1 ? '' : 's'} marked as attended${r.walkIns ? ` · ${r.walkIns} others weren’t registered` : ''}`); onImported(); } catch (er) { toast(er.message); }
  };
  return (
    <Panel title="Analytics">
      <div className="wb-an">
        <div className="wb-funnel">{steps.map(([l, n], i) => (
          <div key={l} className="wb-fstep"><span className="wb-fl">{l}</span><span className="wb-fbar"><i style={{ width: `${Math.max(2, (n / top) * 100)}%`, opacity: 1 - i * 0.16 }} /></span><b>{num(n)}</b><small>{i && steps[i - 1][1] ? `${Math.round((n / steps[i - 1][1]) * 100)}%` : ''}</small></div>
        ))}</div>
        <div>
          <span className="kpi-l">Sign-ups, last 30 days</span>
          <div className="wb-spark" aria-label="Sign-ups per day">{stats.signups.map((d) => <i key={d.day} style={{ height: `${(d.n / peak) * 100}%` }} title={`${d.day}: ${d.n}`} />)}</div>
          {t.replays > 0 && <p className="hint">{num(t.replays)} who missed it opened the replay.</p>}
        </div>
      </div>
      {stats.sessions.length > 0 && (
        <div className="tbl-wrap"><table className="tbl compact">
          <thead><tr><th>Session</th><th className="r">Registered</th><th className="r">Came</th><th className="r">Show-up</th><th className="r">Avg watch</th><th className="r">Buyers</th><th className="r">Sales</th></tr></thead>
          <tbody>{stats.sessions.slice(0, 12).map((x) => <tr key={x.session}><td>{fmt(x.session, w.timezone || w.tzOffset)}{x.zoom && <small className="sub-t">Zoom report · {x.zoom.people} joined{x.zoom.walkIns ? ` (${x.zoom.walkIns} not registered)` : ''}</small>}{x.wgg?.metrics && <small className="sub-t">webinar.gg · {x.wgg.metrics.totalUsers ?? '—'} in the room, peak {x.wgg.metrics.peak ?? '—'}</small>}</td><td className="r">{num(x.registered)}</td><td className="r">{x.past ? num(x.attended) : '—'}</td><td className="r">{x.showUp != null ? `${x.showUp}%` : '—'}</td><td className="r">{x.avgMinutes != null ? `${x.avgMinutes} min` : '—'}</td><td className="r">{num(x.buyers)}</td><td className="r">{inr(x.revenue)}</td></tr>)}</tbody>
        </table></div>
      )}
      <div className="wb-att">
        <b className="sm">Add attendance from another platform</b>
        <p className="hint" style={{ margin: 0 }}>{w.provider === 'zoom' ? 'Zoom attendance comes in by itself about 20 minutes after each session. ' : w.provider === 'webinargg' && gg?.webinargg ? 'webinar.gg attendance comes in by itself after each session. ' : ''}From webinar.gg, YouTube, Meet or anything else: upload the attendee list (CSV with an email column, and minutes watched if it has them), or have the platform / Zapier send each attendee to the webhook below.</p>
        {past.length > 0 ? <div className="row" style={{ gap: 8 }}>
          <select value={session} onChange={(e) => setSession(e.target.value)} style={{ width: 'auto' }}>{past.map((x) => <option key={x} value={x}>{fmt(x, w.timezone || w.tzOffset)}</option>)}</select>
          <input ref={file} type="file" accept=".csv,text/csv,text/plain" hidden onChange={upload} />
          <button className="btn ghost sm" onClick={() => file.current.click()}><Icon name="download" size={14} />Upload attendee list</button>
        </div> : <p className="hint" style={{ margin: 0 }}>Available after your first session.</p>}
        <div className="row" style={{ gap: 6, flexWrap: 'nowrap' }}><input readOnly value={stats.hook} onFocus={(e) => e.target.select()} aria-label="Attendance webhook" /><button className="btn ghost sm" onClick={() => { navigator.clipboard?.writeText(stats.hook); toast('Webhook copied'); }}><Icon name="copy" size={13} />Copy</button></div>
        <p className="hint" style={{ margin: 0 }}>POST JSON <code>{'{ "email": "…", "minutes": 42 }'}</code> (or <code>{'{ "attendees": [ … ] }'}</code>, optional <code>"session"</code> time) — keep this link private.</p>
      </div>
    </Panel>
  );
}
