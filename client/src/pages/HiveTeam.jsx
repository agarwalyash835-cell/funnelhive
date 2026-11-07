// Hive teammates: the seller's AI specialists (Sales Manager, Accountant…) — the list beside Hive's chats, and
// the dialog to hire, change, schedule and let them go. The server keeps them (/api/hive/team, hive-team.js).
import { useEffect, useState } from 'react';
import { Plus, Clock, Play, Trash2, ArrowLeft, Users, Pin, RotateCcw, AlertTriangle, Brain, X, Search, Sparkles, Merge, Check } from 'lucide-react';
import { api } from '../api';
import { Modal, toast, confirmDialog } from '../ui';

const DAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
// a run that stopped: failed (an error) or interrupted (started, never finished) — Retry waits for the seller
const stopped = (m) => ['failed', 'interrupted'].includes(m?.lastRun?.status);
const stopNote = (r) => (r.status === 'interrupted' ? 'Stopped before finishing' : `Failed${r.error ? `: ${r.error}` : ''}`);
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const when = (s) => {
  if (!s?.on) return '';
  const d = s.days.length === 7 ? 'every day' : s.days.join() === '1,2,3,4,5' ? 'weekdays' : s.days.join() === '1,2,3,4,5,6' ? 'Mon–Sat' : s.days.map((x) => DAY_NAMES[x]).join(', ');
  return `${d} at ${s.time}`;
};

// pinned teammates first (the server sends them that way too; kept here for lists changed on the page)
const pinnedFirst = (team) => [...team.filter((m) => m.pinned), ...team.filter((m) => !m.pinned)];
// the team beside the chats: pick one to start a chat with them; a dot = a task reply not opened yet
export function TeamSide({ team, mate, onPick, onManage, disabled, unread = new Set(), rooms = [], roomId = null, onRoom, onNewRoom }) {
  return (
    <div className="hv-team">
      <small className="hv-tlabel">Your AI team</small>
      {pinnedFirst(team).map((m) => (
        <button key={m.id} className={`hv-mate ${mate?.id === m.id ? 'on' : ''}`} style={{ '--mc': m.color }} onClick={() => onPick(m)} disabled={disabled} title={m.role}>
          <span className="hv-mate-e" aria-hidden="true">{m.emoji}</span>
          <span className="hv-mate-t"><b>{m.name}</b><small>{m.pinned && <Pin size={10} />}{m.schedule?.on ? <><Clock size={10} /> {when(m.schedule)}</> : m.role}</small></span>
          {stopped(m) ? <AlertTriangle className="hv-stopped" size={13} aria-label={stopNote(m.lastRun)} /> : unread.has(m.id) && <i className="hv-unread" title="New report you haven’t opened" aria-label="New report" />}
        </button>
      ))}
      {(rooms.length > 0 || team.length >= 2) && <small className="hv-tlabel">Team rooms</small>}
      {rooms.map((r) => (
        <button key={r.id} className={`hv-mate room ${roomId === r.id ? 'on' : ''}`} onClick={() => onRoom?.(r.id)} disabled={disabled} title={r.room.name}>
          <span className="hv-mate-e hv-room-e" aria-hidden="true">{r.room.members.slice(0, 3).map((id) => team.find((m) => m.id === id)?.emoji).filter(Boolean).join('')}</span>
          <span className="hv-mate-t"><b>{r.room.name}</b><small>{r.room.schedule?.on ? <><Clock size={10} /> {when(r.room.schedule)}</> : `${r.room.members.length} teammates`}</small></span>
          {r.unread && <i className="hv-unread" aria-label="New report" />}
        </button>
      ))}
      {team.length >= 2 && <button className="hv-mate add" onClick={onNewRoom} disabled={disabled}><span className="hv-mate-e"><Plus size={14} /></span><span className="hv-mate-t"><b>New team room</b><small>A chat with several teammates</small></span></button>}
      <button className="hv-mate add" onClick={onManage} disabled={disabled}><span className="hv-mate-e"><Brain size={14} /></span><span className="hv-mate-t"><b>Memory</b><small>What Hive keeps in mind</small></span></button>
      <button className="hv-mate add" onClick={onManage} disabled={disabled}><span className="hv-mate-e"><Users size={14} /></span><span className="hv-mate-t"><b>{team.length ? 'Manage team' : 'Hire AI teammates'}</b><small>{team.length ? 'Hire, change or schedule' : 'Sales, accounts, marketing…'}</small></span></button>
    </div>
  );
}

// hire (ready-made or your own), change, schedule, run now, let go
export function TeamDialog({ onClose, onChanged, onRun, editId = null, skills = false }) {
  const [data, setData] = useState(null);
  const [edit, setEdit] = useState(null); // the teammate being changed (a copy), or a new one
  const [busy, setBusy] = useState(false);
  const load = () => api('/hive/team').then((d) => { setData(d); return d; });
  useEffect(() => { load().then((d) => { const m = d.team.find((x) => x.id === editId); if (m) setEdit(structuredClone(m)); }).catch((e) => toast(e.message)); }, []);
  const done = async () => { const d = await load(); onChanged?.(d.team); };

  const hire = async (preset) => {
    setBusy(true);
    try { const m = await api('/hive/team', 'POST', { preset }); toast(`${m.name} joined your team`); await done(); setEdit(structuredClone(m)); } catch (e) { toast(e.message); }
    setBusy(false);
  };
  const save = async () => {
    setBusy(true);
    try {
      const m = edit.id ? await api(`/hive/team/${edit.id}`, 'PUT', edit) : await api('/hive/team', 'POST', edit);
      toast('Saved'); await done(); setEdit(null); return m;
    } catch (e) { toast(e.message); } finally { setBusy(false); }
    return null;
  };
  const remove = async () => {
    if (!await confirmDialog({ title: `Let ${edit.name} go?`, text: 'Their chats stay. Scheduled tasks stop.', confirm: 'Remove', danger: true })) return;
    await api(`/hive/team/${edit.id}`, 'DELETE').catch((e) => toast(e.message));
    await done(); setEdit(null);
  };
  const retry = async () => {
    try { const r = await api(`/hive/team/${edit.id}/retry`, 'POST'); onRun?.(r.threadId); onClose(); } catch (e) { toast(e.message); }
  };
  const runNow = async () => {
    const m = edit.id && await save();
    if (!m) return;
    try { const r = await api(`/hive/team/${m.id}/run`, 'POST'); onRun?.(r.threadId); onClose(); } catch (e) { toast(e.message); }
  };

  if (!data) return <Modal title="Your AI team" onClose={onClose} width={720}><div className="m-body"><div className="skeleton" /></div></Modal>;
  const hiredPresets = new Set(data.team.map((m) => m.preset).filter(Boolean));
  const full = data.team.length >= data.max;

  if (edit) {
    const set = (k, v) => setEdit((x) => ({ ...x, [k]: v }));
    const s = edit.schedule || { on: false, time: '09:30', days: [1, 2, 3, 4, 5, 6], task: '', whatsapp: false };
    const setS = (k, v) => set('schedule', { ...s, [k]: v });
    const toggle = (list, x) => (list.includes(x) ? list.filter((y) => y !== x) : [...list, x]);
    return (
      <Modal title={edit.id ? `${edit.emoji} ${edit.name}` : 'A teammate of your own'} onClose={onClose} width={720}>
        <div className="m-body hv-tm">
          <button className="btn ghost sm" onClick={() => setEdit(null)}><ArrowLeft size={13} /> Team</button>
          <div className="hv-tm-row">
            <label className="fld" style={{ maxWidth: 80 }}><span>Emoji</span><input value={edit.emoji || ''} maxLength={4} onChange={(e) => set('emoji', e.target.value)} /></label>
            <label className="fld" style={{ flex: 1 }}><span>Name</span><input value={edit.name || ''} maxLength={40} onChange={(e) => set('name', e.target.value)} placeholder="e.g. Sales Manager" /></label>
            <label className="fld" style={{ maxWidth: 90 }}><span>Colour</span><input type="color" value={edit.color || '#6366f1'} onChange={(e) => set('color', e.target.value)} /></label>
          </div>
          <label className="fld"><span>Role <small>one line</small></span><input value={edit.role || ''} maxLength={120} onChange={(e) => set('role', e.target.value)} placeholder="e.g. Leads, follow-ups and site visits" /></label>
          <label className="fld"><span>How they work <small>their instructions</small></span><textarea rows={4} value={edit.instructions || ''} maxLength={2000} onChange={(e) => set('instructions', e.target.value)} placeholder="e.g. Reply in Hinglish. Call hot leads first. Never offer a discount above 10%." /></label>
          <div className="fld"><label>What they can work on</label>
            <div className="hv-chips">
              <button type="button" className={edit.core ? 'on' : ''} onClick={() => set('core', !edit.core)} title="Build and edit funnels and pages">funnels</button>
              {data.groups.map((g) => <button type="button" key={g.id} className={edit.groups?.includes(g.id) ? 'on' : ''} onClick={() => set('groups', toggle(edit.groups || [], g.id))} title={g.about}>{g.id.replace('_', ' ')}</button>)}
            </div>
          </div>
          <label className="tog"><input type="checkbox" checked={!!edit.pinned} onChange={(e) => set('pinned', e.target.checked)} /><span /><div><b>Pin to the top</b> — shown first in your AI team list.</div></label>
          <label className="tog"><input type="checkbox" checked={edit.memory !== false} onChange={(e) => set('memory', e.target.checked)} /><span /><div><b>Uses Hive’s memory</b> — follows what you asked Hive to remember (and its published skills), and can add to it when you ask.</div></label>
          <label className="tog"><input type="checkbox" checked={edit.learn !== false} onChange={(e) => set('learn', e.target.checked)} /><span /><div><b>Learns from its chats</b> — each night it suggests skills from what you corrected; nothing is used until you publish it.</div></label>
          <label className="tog"><input type="checkbox" checked={!!edit.askFirst} onChange={(e) => set('askFirst', e.target.checked)} /><span /><div><b>Ask before every change</b> — reading is free; anything they save, send or change waits for your Confirm.</div></label>

          {stopped(edit) && (
            <div className="hv-run-stop">
              <AlertTriangle size={15} />
              <div><b>{stopNote(edit.lastRun)}</b><small>{edit.lastRun.day ? `The ${edit.lastRun.day} task. ` : ''}Some of it may already be done — open its chat and check before retrying.</small></div>
              {edit.lastRun.threadId && <button className="btn ghost sm" onClick={() => { onRun?.(edit.lastRun.threadId); onClose(); }}>Open chat</button>}
              <button className="btn sm" onClick={retry} disabled={busy}><RotateCcw size={13} /> Retry</button>
            </div>
          )}
          <div className="hv-tm-sched">
            <label className="tog"><input type="checkbox" checked={!!s.on} onChange={(e) => setS('on', e.target.checked)} /><span /><div><b>Regular task</b> — they do this on their own, on schedule. Changes still wait for your OK.</div></label>
            <label className="fld"><span>Task</span><textarea rows={3} value={s.task || ''} maxLength={600} onChange={(e) => setS('task', e.target.value)} placeholder="e.g. Every morning: list new leads and who to follow up today, with what to say" /></label>
            {s.on && <div className="hv-tm-row">
              <label className="fld" style={{ maxWidth: 120 }}><span>Time</span><input type="time" value={s.time} onChange={(e) => setS('time', e.target.value)} /></label>
              <div className="fld"><label>Days</label><div className="hv-chips days">{DAYS.map((d, i) => <button type="button" key={i} className={s.days.includes(i) ? 'on' : ''} onClick={() => setS('days', toggle(s.days, i).sort())} aria-label={DAY_NAMES[i]}>{d}</button>)}</div></div>
            </div>}
            {s.on && <label className="tog"><input type="checkbox" checked={!!s.whatsapp} onChange={(e) => setS('whatsapp', e.target.checked)} /><span /><div><b>Send me the summary on WhatsApp</b> — to your alert number (Settings → WhatsApp). It always shows in the bell.</div></label>}
          </div>

          <div className="cm-foot">
            {edit.id && <button className="btn ghost sm danger" onClick={remove} disabled={busy}><Trash2 size={13} /> Remove</button>}
            <span className="muted" />
            {edit.id && s.task && <button className="btn ghost" onClick={runNow} disabled={busy}><Play size={13} /> Run task now</button>}
            <button className="btn" onClick={save} disabled={busy || !edit.name}>{edit.id ? 'Save' : 'Hire'}</button>
          </div>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title="Your AI team" onClose={onClose} width={720}>
      <div className="m-body hv-tm">
        <MemoryPanel team={data.team} startTab={skills ? 'skills' : 'memory'} onOpen={(id) => { onRun?.(id); onClose(); }} />
        <p className="muted sm">Specialists who work inside Hive with only the tools their job needs. Give them a regular task and they report to you every day — anything they’d change waits for your OK.</p>
        {data.team.length > 0 && <>
          <h4>Your team</h4>
          <div className="hv-tm-grid">{pinnedFirst(data.team).map((m) => (
            <button key={m.id} className="hv-tm-card" style={{ '--mc': m.color }} onClick={() => setEdit(structuredClone(m))}>
              <span className="hv-mate-e">{m.emoji}</span><b>{m.name}</b><small>{m.role}</small>
              {stopped(m) ? <em className="warn"><AlertTriangle size={11} /> {stopNote(m.lastRun).slice(0, 40)} — open to retry</em> : m.schedule?.on && <em><Clock size={11} /> {when(m.schedule)}</em>}
            </button>
          ))}</div>
        </>}
        <h4>Hire</h4>
        <div className="hv-tm-grid">
          {data.presets.filter((p) => !hiredPresets.has(p.preset)).map((p) => (
            <button key={p.preset} className="hv-tm-card hire" style={{ '--mc': p.color }} onClick={() => hire(p.preset)} disabled={busy || full}>
              <span className="hv-mate-e">{p.emoji}</span><b>{p.name}</b><small>{p.role}</small>
              {p.schedule.on && <em><Clock size={11} /> {when(p.schedule)}</em>}
              <i><Plus size={12} /> Hire</i>
            </button>
          ))}
          <button className="hv-tm-card hire" onClick={() => setEdit({ name: '', emoji: '🧩', color: '#6366f1', role: '', instructions: '', groups: [], core: false, askFirst: true })} disabled={busy || full}>
            <span className="hv-mate-e">🧩</span><b>Your own</b><small>Any role, your instructions</small><i><Plus size={12} /> Create</i>
          </button>
        </div>
        {full && <p className="hint">Your team is full ({data.max}). Remove one to hire another.</p>}
      </div>
    </Modal>
  );
}

// what Hive and the teammates keep in mind: memory (the seller's own rules and facts) and skills (learned from chats,
// used only once published). Search finds by words and meaning; Tidy up merges items that say the same thing.
function MemoryPanel({ team = [], onOpen, startTab = 'memory' }) {
  const [d, setD] = useState(null);
  const [tab, setTab] = useState(startTab);
  const [text, setText] = useState('');
  const [always, setAlways] = useState(false);
  const [scope, setScope] = useState('all');
  const [find, setFind] = useState('');
  const [found, setFound] = useState(null);
  const [editing, setEditing] = useState(null); // { id, text, title }
  const [pairs, setPairs] = useState(null);
  const [busy, setBusy] = useState(false);
  const load = () => api('/hive/memory').then(setD).catch(() => setD({ items: [], skills: [], drafts: [], max: 500 }));
  useEffect(() => { load(); }, []);
  useEffect(() => {
    if (!find.trim()) { setFound(null); return undefined; }
    const t = setTimeout(() => api(`/hive/memory/search?q=${encodeURIComponent(find)}&kind=${tab === 'skills' ? 'skill' : 'memory'}`).then((r) => setFound(r.items)).catch(() => {}), 300);
    return () => clearTimeout(t);
  }, [find, tab]);
  const run = async (fn) => { setBusy(true); try { await fn(); await load(); } catch (x) { toast(x.message); } setBusy(false); };
  const add = (e) => { e.preventDefault(); if (text.trim()) run(async () => { await api('/hive/memory', 'POST', { text, always, scope }); setText(''); setAlways(false); }); };
  const put = (id, body) => run(() => api(`/hive/memory/${id}`, 'PUT', body));
  const del = (id) => run(() => api(`/hive/memory/${id}`, 'DELETE'));
  const tidy = () => run(async () => { const r = await api(`/hive/memory/similar?kind=${tab === 'skills' ? 'skill' : 'memory'}`); setPairs(r.pairs.map((p) => ({ ...p, text: p.a.text.length >= p.b.text.length ? p.a.text : p.b.text }))); });
  const merge = (p) => run(async () => { await api('/hive/memory/merge', 'POST', { keep: p.a.id, drop: p.b.id, text: p.text }); setPairs((x) => x.filter((y) => y !== p && y.a.id !== p.b.id && y.b.id !== p.b.id)); });
  const learn = () => run(async () => { const r = await api('/hive/learn', 'POST'); toast(r.made ? `${r.made} new skill${r.made === 1 ? '' : 's'} to review` : 'Nothing new to learn from today’s chats'); });
  if (!d) return null;
  const scopePick = (value, onChange) => (
    <select className="hv-mem-scope" value={team.some((m) => m.id === value) ? value : 'all'} onChange={(e) => onChange(e.target.value)} aria-label="Who it’s for">
      <option value="all">Everyone</option>{team.map((m) => <option key={m.id} value={m.id}>{m.emoji} {m.name}</option>)}
    </select>
  );
  const item = (m) => (
    <li key={m.id}>
      {editing?.id === m.id
        ? <div className="hv-mem-edit">
            {m.kind === 'skill' && <input value={editing.title} maxLength={80} placeholder="Title" onChange={(e) => setEditing({ ...editing, title: e.target.value })} />}
            <textarea autoFocus rows={2} value={editing.text} maxLength={m.kind === 'skill' ? 600 : 300} onChange={(e) => setEditing({ ...editing, text: e.target.value })} />
            <div className="row"><button className="btn sm" onClick={() => { put(m.id, { text: editing.text, ...(m.kind === 'skill' ? { title: editing.title } : {}) }); setEditing(null); }}>Save</button><button className="btn ghost sm" onClick={() => setEditing(null)}>Cancel</button></div>
          </div>
        : <button className="hv-mem-t" onClick={() => setEditing({ id: m.id, text: m.text, title: m.title })} title="Click to change">{m.title && <b>{m.title}: </b>}{m.text}</button>}
      <span className="hv-mem-meta">
        {m.kind === 'memory' && <button className={`hv-mem-always ${m.always ? 'on' : ''}`} onClick={() => put(m.id, { always: !m.always })} title={m.always ? 'Sent with every message' : 'Sent when it fits the message'}>{m.always ? 'Always' : 'When relevant'}</button>}
        {team.length > 0 && scopePick(m.scope, (v) => put(m.id, { scope: v }))}
        {m.by === 'hive' && m.kind === 'memory' && <small className="muted">saved by Hive</small>}
        <button className="icon-btn" aria-label="Forget this" title="Forget this" onClick={() => del(m.id)}><X size={14} /></button>
      </span>
    </li>
  );
  const listed = tab === 'memory' ? d.items : d.skills;
  const shown = found || listed;
  return (
    <section className="hv-mem">
      <div className="hv-mem-head">
        <h4><Brain size={15} /> What Hive knows</h4>
        <div className="seg sm">
          <button className={tab === 'memory' ? 'on' : ''} onClick={() => { setTab('memory'); setPairs(null); setFind(''); }}>Memory · {d.items.length}</button>
          <button className={tab === 'skills' ? 'on' : ''} onClick={() => { setTab('skills'); setPairs(null); setFind(''); }}>Skills · {d.skills.length}{d.drafts.length > 0 && <i className="hv-mem-badge">{d.drafts.length}</i>}</button>
        </div>
      </div>
      <p className="muted sm">{tab === 'memory'
        ? <>Your rules and facts. <b>Always</b> ones go with every message; the rest go when they fit what’s asked{d.items.length > (d.allUnder || 40) ? '' : ' (while the list is short, Hive reads all of them)'}. Say “remember…” in a chat to add one.</>
        : <>How-tos Hive learns each night from what you corrected. A suggested skill is never used until you publish it.</>}</p>

      {tab === 'skills' && d.drafts.length > 0 && (
        <div className="hv-mem-drafts">
          <b className="sm"><Sparkles size={13} /> To review</b>
          {d.drafts.map((s) => (
            <div key={s.id} className="hv-mem-draft">
              {editing?.id === s.id
                ? <div className="hv-mem-edit"><input value={editing.title} maxLength={80} onChange={(e) => setEditing({ ...editing, title: e.target.value })} /><textarea rows={3} value={editing.text} maxLength={600} onChange={(e) => setEditing({ ...editing, text: e.target.value })} /></div>
                : <p><b>{s.title}</b> — {s.text}</p>}
              {s.evidence?.why && <small className="muted">Learned from: {s.evidence.why}{s.evidence.threads?.length > 0 && <> · {s.evidence.threads.map((t, i) => <button key={t} className="link-btn" onClick={() => onOpen?.(t)}>chat {i + 1}</button>)}</>}</small>}
              <div className="row">
                {team.length > 0 && scopePick(s.scope, (v) => put(s.id, { scope: v }))}
                <span className="grow" />
                {editing?.id === s.id
                  ? <button className="btn sm" disabled={busy} onClick={() => { put(s.id, { publish: true, text: editing.text, title: editing.title }); setEditing(null); }}><Check size={13} /> Save & publish</button>
                  : <><button className="btn ghost sm" onClick={() => setEditing({ id: s.id, text: s.text, title: s.title })}>Edit</button>
                    <button className="btn ghost sm" disabled={busy} onClick={() => run(() => api(`/hive/memory/${s.id}/reject`, 'POST'))}>Reject</button>
                    <button className="btn sm" disabled={busy} onClick={() => put(s.id, { publish: true })}><Check size={13} /> Publish</button></>}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="hv-mem-tools">
        <label className="hv-mem-find"><Search size={14} /><input value={find} onChange={(e) => setFind(e.target.value)} placeholder={tab === 'memory' ? 'Search by words or meaning' : 'Search skills'} /></label>
        {listed.length > 1 && <button className="btn ghost sm" onClick={tidy} disabled={busy}><Merge size={13} /> Tidy up</button>}
        {tab === 'skills' && <button className="btn ghost sm" onClick={learn} disabled={busy}><Sparkles size={13} /> Learn from today’s chats</button>}
      </div>

      {pairs && (pairs.length ? (
        <div className="hv-mem-pairs">{pairs.map((p, i) => (
          <div key={i} className="hv-mem-pair">
            <small className="muted">These say the same thing:</small>
            <p>“{p.a.text}”<br />“{p.b.text}”</p>
            <div className="row"><input className="grow" value={p.text} maxLength={p.a.kind === 'skill' ? 600 : 300} onChange={(e) => setPairs((x) => x.map((y) => (y === p ? { ...y, text: e.target.value } : y)))} /><button className="btn sm" disabled={busy} onClick={() => merge(p)}>Merge</button><button className="btn ghost sm" onClick={() => setPairs((x) => x.filter((y) => y !== p))}>Keep both</button></div>
          </div>
        ))}</div>
      ) : <p className="muted sm">Nothing to tidy — no two items say the same thing.</p>)}

      {shown.length > 0 ? <ul>{shown.map(item)}</ul> : found ? <p className="muted sm">Nothing matches.</p> : null}

      {tab === 'memory' && (
        <form className="hv-mem-add" onSubmit={add}>
          <input value={text} maxLength={300} onChange={(e) => setText(e.target.value)} placeholder="e.g. Reply to customers in Hinglish · We’re closed on Sundays" />
          <label className="hv-mem-check"><input type="checkbox" checked={always} onChange={(e) => setAlways(e.target.checked)} /> Always</label>
          {team.length > 0 && scopePick(scope, setScope)}
          <button className="btn sm" disabled={!text.trim() || busy}><Plus size={13} /> Add</button>
        </form>
      )}
      <small className="muted">{tab === 'memory' ? `${d.items.length} of ${d.max}` : `${d.skills.length} of ${d.skillsMax || 200} skills`}</small>
    </section>
  );
}

// a team room: its name, who's in it, and an optional regular task (a stand-up) — every member reports, then one summary
export function RoomDialog({ team, room = null, onClose, onSaved, onDeleted, onRun }) {
  const [v, setV] = useState(() => ({ name: room?.room.name || '', members: room?.room.members || [], schedule: room?.room.schedule || { on: false, time: '09:30', days: [1, 2, 3, 4, 5, 6], task: '', whatsapp: false } }));
  const [busy, setBusy] = useState(false);
  const s = v.schedule;
  const setS = (k, x) => setV((o) => ({ ...o, schedule: { ...o.schedule, [k]: x } }));
  const toggle = (list, x) => (list.includes(x) ? list.filter((y) => y !== x) : [...list, x]);
  const save = async () => {
    setBusy(true);
    try { const r = room ? await api(`/hive/rooms/${room.id}`, 'PUT', v) : await api('/hive/rooms', 'POST', v); toast(room ? 'Saved' : 'Room ready'); onSaved?.(r); return r; } catch (e) { toast(e.message); return null; } finally { setBusy(false); }
  };
  const runNow = async () => { const r = await save(); if (!r) return; try { await api(`/hive/rooms/${r.id}/run`, 'POST'); onRun?.(r.id); onClose(); } catch (e) { toast(e.message); } };
  const remove = async () => {
    if (!await confirmDialog({ title: `Delete the room “${room.room.name}”?`, text: 'Its chat goes too. The teammates stay on your team.', confirm: 'Delete', danger: true })) return;
    await api(`/hive/threads/${room.id}`, 'DELETE').catch((e) => toast(e.message));
    onDeleted?.(room.id); onClose();
  };
  return (
    <Modal title={room ? `👥 ${room.room.name}` : 'New team room'} onClose={onClose} width={640}>
      <div className="m-body hv-tm">
        <p className="muted sm">A chat with several teammates. Write once and the right one answers — or @mention one (“@everyone” asks them all). They can hand work to each other; anything they’d change still waits for your OK.</p>
        <label className="fld"><span>Room name</span><input value={v.name} maxLength={40} onChange={(e) => { const name = e.target.value; setV((o) => ({ ...o, name })); }} placeholder="e.g. Diwali launch, Daily ops" /></label>
        <div className="fld"><label>Who’s in it <small className="muted">· pick 2 to 6</small></label>
          {team.length < 2 ? <p className="hint">Hire at least two teammates first (Hive → Your AI team).</p> : (
            <div className="hv-chips">{team.map((m) => <button type="button" key={m.id} className={v.members.includes(m.id) ? 'on' : ''} onClick={() => setV((o) => ({ ...o, members: toggle(o.members, m.id).slice(0, 6) }))}>{m.emoji} {m.name}</button>)}</div>
          )}
        </div>
        <div className="hv-tm-sched">
          <label className="tog"><input type="checkbox" checked={!!s.on} onChange={(e) => setS('on', e.target.checked)} /><span /><div><b>Regular team task</b> — e.g. a morning stand-up: each member reports, then you get one combined summary.</div></label>
          <label className="fld"><span>Task</span><textarea rows={3} value={s.task || ''} maxLength={600} onChange={(e) => setS('task', e.target.value)} placeholder="e.g. Morning stand-up: what you did yesterday, what’s due today, and what needs my OK" /></label>
          {s.on && <div className="hv-tm-row">
            <label className="fld" style={{ maxWidth: 120 }}><span>Time</span><input type="time" value={s.time} onChange={(e) => setS('time', e.target.value)} /></label>
            <div className="fld"><label>Days</label><div className="hv-chips days">{DAYS.map((d, i) => <button type="button" key={i} className={s.days.includes(i) ? 'on' : ''} onClick={() => setS('days', toggle(s.days, i).sort())} aria-label={DAY_NAMES[i]}>{d}</button>)}</div></div>
          </div>}
          {s.on && <label className="tog"><input type="checkbox" checked={!!s.whatsapp} onChange={(e) => setS('whatsapp', e.target.checked)} /><span /><div><b>Send me the summary on WhatsApp</b> — to your alert number. It always shows in the bell.</div></label>}
        </div>
        <div className="cm-foot">
          {room && <button className="btn ghost sm danger" onClick={remove} disabled={busy}><Trash2 size={13} /> Delete room</button>}
          <span className="muted" />
          {s.task && v.members.length >= 2 && <button className="btn ghost" onClick={runNow} disabled={busy}><Play size={13} /> Run task now</button>}
          <button className="btn" onClick={async () => { if (await save()) onClose(); }} disabled={busy || v.members.length < 2}>{room ? 'Save' : 'Create room'}</button>
        </div>
      </div>
    </Modal>
  );
}
