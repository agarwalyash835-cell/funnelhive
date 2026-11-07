// Hive teammates: the seller's AI specialists (Sales Manager, Accountant…) — the list beside Hive's chats, and
// the dialog to hire, change, schedule and let them go. The server keeps them (/api/hive/team, hive-team.js).
import { useEffect, useState } from 'react';
import { Plus, Clock, Play, Trash2, ArrowLeft, Users, Pin, RotateCcw, AlertTriangle, Brain, X } from 'lucide-react';
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
export function TeamSide({ team, mate, onPick, onManage, disabled, unread = new Set() }) {
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
      <button className="hv-mate add" onClick={onManage} disabled={disabled}><span className="hv-mate-e"><Brain size={14} /></span><span className="hv-mate-t"><b>Memory</b><small>What Hive keeps in mind</small></span></button>
      <button className="hv-mate add" onClick={onManage} disabled={disabled}><span className="hv-mate-e"><Users size={14} /></span><span className="hv-mate-t"><b>{team.length ? 'Manage team' : 'Hire AI teammates'}</b><small>{team.length ? 'Hire, change or schedule' : 'Sales, accounts, marketing…'}</small></span></button>
    </div>
  );
}

// hire (ready-made or your own), change, schedule, run now, let go
export function TeamDialog({ onClose, onChanged, onRun, editId = null }) {
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
          <label className="tog"><input type="checkbox" checked={edit.memory !== false} onChange={(e) => set('memory', e.target.checked)} /><span /><div><b>Uses Hive’s memory</b> — follows what you asked Hive to remember, and can add to it when you ask.</div></label>
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
        <MemoryPanel />
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

// what Hive (and teammates who use memory) keep in mind in every chat: add, change, delete
function MemoryPanel() {
  const [d, setD] = useState(null);
  const [text, setText] = useState('');
  const [editing, setEditing] = useState(null); // { id, text }
  const load = () => api('/hive/memory').then(setD).catch(() => setD({ items: [], max: 50 }));
  useEffect(() => { load(); }, []);
  const add = async (e) => { e.preventDefault(); if (!text.trim()) return; try { await api('/hive/memory', 'POST', { text }); setText(''); load(); } catch (x) { toast(x.message); } };
  const saveEdit = async () => { try { await api(`/hive/memory/${editing.id}`, 'PUT', { text: editing.text }); setEditing(null); load(); } catch (x) { toast(x.message); } };
  const del = async (id) => { await api(`/hive/memory/${id}`, 'DELETE').catch((x) => toast(x.message)); load(); };
  if (!d) return null;
  return (
    <section className="hv-mem">
      <h4><Brain size={15} /> Memory <small className="muted">{d.items.length}/{d.max}</small></h4>
      <p className="muted sm">Things Hive and your teammates keep in mind in every chat — your preferences, rules and facts about the business. Say “remember…” in a chat to add one.</p>
      {d.items.length > 0 && <ul>{d.items.map((m) => (
        <li key={m.id}>
          {editing?.id === m.id
            ? <><input autoFocus value={editing.text} maxLength={300} onChange={(e) => setEditing({ ...editing, text: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter') saveEdit(); if (e.key === 'Escape') setEditing(null); }} /><button className="btn sm" onClick={saveEdit}>Save</button></>
            : <><button className="hv-mem-t" onClick={() => setEditing({ id: m.id, text: m.text })} title="Click to change">{m.text}</button>{m.by === 'hive' && <small className="muted">saved by Hive</small>}</>}
          <button className="icon-btn" aria-label="Forget this" title="Forget this" onClick={() => del(m.id)}><X size={14} /></button>
        </li>
      ))}</ul>}
      <form className="hv-mem-add" onSubmit={add}><input value={text} maxLength={300} onChange={(e) => setText(e.target.value)} placeholder="e.g. Reply to customers in Hinglish · We’re closed on Sundays" /><button className="btn sm" disabled={!text.trim()}><Plus size={13} /> Add</button></form>
    </section>
  );
}
