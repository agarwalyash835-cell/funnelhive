// Hive AI — chat on the left, the funnel being built on the right ("Lovable for funnels")
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Paperclip, Square, Plus, Trash2, Check, X, Loader2, Monitor, Smartphone, ExternalLink, PanelLeft, MessageSquare, Eye, Pencil, ArrowUp, Rocket, Presentation, GraduationCap, Workflow, ThumbsUp, ThumbsDown, Undo2, ShieldCheck, History } from 'lucide-react';
import { HiveGlyph as Sparkles } from '../brandIcons';
import { api } from '../api';
import { Layout, toast, ago, confirmDialog, promptDialog, loadFailed } from '../ui';
import { Page } from '../blocks';
import { TeamSide, TeamDialog, RoomDialog, when } from './HiveTeam.jsx';
import { ApprovalsDialog, ActivityDialog } from './HiveApprovals.jsx';

const SUGGESTIONS = [
  { icon: Rocket, title: 'Sales funnel', text: 'Build a funnel for my home bakery in Pune — custom birthday cakes from ₹899' },
  { icon: Presentation, title: 'Webinar funnel', text: 'Create a webinar funnel for my stock-market course at ₹2,999 with a ₹499 upsell' },
  { icon: GraduationCap, title: 'Online course', text: 'Create a 6-lesson course on Instagram Reels for coaches, with a quiz and a certificate' },
  { icon: Workflow, title: 'Follow-ups', text: 'Add an abandoned-checkout automation: email after 30 minutes, WhatsApp next morning at 10' },
];

// the message box: its own text, so typing doesn't re-render the chat and the preview; Enter sends
const ATTACH_TYPES = '.pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.pptx,.jpg,.jpeg,.png,.webp';
const ATTACH_MB = 6;
const asBase64 = (file) => new Promise((ok, fail) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1] || ''); r.onerror = () => fail(r.error); r.readAsDataURL(file); });
function Composer({ ready, busy, placeholder, onSend, onStop, prefill, focusKey }) {
  const [input, setInput] = useState(prefill || '');
  const [files, setFiles] = useState([]); // [{ name, size, data }]
  const boxRef = useRef(null);
  const pickRef = useRef(null);
  const add = async (list) => {
    const next = [...files];
    for (const file of [...list].slice(0, 3 - files.length)) {
      if (file.size > ATTACH_MB * 1048576) { toast(`“${file.name}” is over ${ATTACH_MB} MB`); continue; }
      next.push({ name: file.name, size: file.size, data: await asBase64(file) });
    }
    setFiles(next);
  };
  useEffect(() => { if (prefill) setInput(prefill); }, [prefill]);
  // the box grows with what's typed (up to ~8 lines)
  useEffect(() => { const b = boxRef.current; if (!b) return; b.style.height = 'auto'; b.style.height = `${Math.min(220, b.scrollHeight)}px`; }, [input]);
  useEffect(() => { if (!busy) setTimeout(() => boxRef.current?.focus(), 0); }, [busy, focusKey]);
  const go = () => { const m = input.trim(); if ((!m && !files.length) || busy) return; setInput(''); setFiles([]); onSend(m, files); };
  return (
    <form className="hv-input" onSubmit={(e) => { e.preventDefault(); go(); }} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); if (e.dataTransfer.files?.length) add(e.dataTransfer.files); }}>
      {files.length > 0 && <div className="hv-files">{files.map((x, i) => <span key={i} className="hv-file"><Paperclip size={12} />{x.name}<button type="button" aria-label={`Remove ${x.name}`} onClick={() => setFiles(files.filter((_, j) => j !== i))}><X size={12} /></button></span>)}</div>}
      <textarea ref={boxRef} rows={1} value={input} onChange={(e) => setInput(e.target.value)} disabled={!ready}
        onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); go(); } }}
        placeholder={placeholder} />
      <div className="hv-input-bar">
        <input ref={pickRef} type="file" hidden multiple accept={ATTACH_TYPES} onChange={(e) => { add(e.target.files); e.target.value = ''; }} />
        <button type="button" className="hv-attach" disabled={!ready || busy || files.length >= 3} onClick={() => pickRef.current?.click()} title="Attach a photo, PDF, Word or Excel file (up to 3)" aria-label="Attach a file"><Paperclip size={16} /></button>
        <span className="hv-hint">{busy ? 'Hive is working…' : 'Enter to send · Shift + Enter for a new line'}</span>
        {busy ? <button type="button" className="hv-stop" onClick={onStop} aria-label="Stop"><Square size={13} /> Stop</button>
          : <button className="hv-send" disabled={(!input.trim() && !files.length) || !ready} aria-label="Send"><ArrowUp size={18} /></button>}
      </div>
    </form>
  );
}
// the funnel being built: re-drawn only when the page or its version changes
const Preview = memo(function Preview({ step, funnel }) {
  return <Page key={`${step.id}-${funnel.version}`} blocks={step.blocks} theme={funnel.theme} ctx={PREVIEW_CTX} />;
});
const PREVIEW_CTX = { live: false };

// minimal, safe formatting for replies: **bold**, `code`, bullet lists, links
// memoised: a long chat re-rendered (and re-parsed) every message on each progress event of a running reply
const Rich = memo(function Rich({ text }) {
  const lines = String(text || '').split('\n');
  const inline = (s, k) => s.split(/(\*\*[^*]+\*\*|`[^`]+`|https?:\/\/[^\s)]+)/g).map((p, i) => (
    /^\*\*.+\*\*$/.test(p) ? <b key={`${k}-${i}`}>{p.slice(2, -2)}</b>
      : /^`.+`$/.test(p) ? <code key={`${k}-${i}`}>{p.slice(1, -1)}</code>
        : /^https?:\/\//.test(p) ? <a key={`${k}-${i}`} href={p} target="_blank" rel="noreferrer">{p}</a> : p));
  const out = [];
  let list = [];
  const flush = () => { if (list.length) { out.push(<ul key={`u${out.length}`}>{list.map((l, i) => <li key={i}>{inline(l, `l${i}`)}</li>)}</ul>); list = []; } };
  lines.forEach((l, i) => {
    const m = /^\s*(?:[-*•]|\d+\.)\s+(.*)/.exec(l);
    if (m) list.push(m[1]); else { flush(); if (l.trim()) out.push(<p key={`p${i}`}>{inline(l, `p${i}`)}</p>); }
  });
  flush();
  return <div className="rich">{out}</div>;
});

// what Hive is doing right now, in plain words (the step names stay the same; only the live line is friendlier)
const DOING = {
  create_funnel: 'Building your funnel', create_funnel_from_template: 'Setting up the template', create_website: 'Building your website', duplicate_funnel: 'Copying the funnel',
  get_funnel: 'Looking at your funnel', get_page: 'Reading the page', list_funnels: 'Looking at your funnels', list_templates: 'Browsing templates',
  update_section: 'Updating the page', add_section: 'Adding a section', remove_section: 'Removing a section', move_section: 'Rearranging the page', replace_page: 'Rewriting the page',
  add_step: 'Adding a page', remove_step: 'Removing a page', reorder_steps: 'Reordering pages', update_funnel: 'Updating the funnel', publish_funnel: 'Getting it ready to go live',
  write_marketing_copy: 'Writing your copy', generate_image: 'Creating your image', configure_checkout: 'Setting up checkout', create_product: 'Creating your product', list_products: 'Checking your products',
  create_coupon: 'Creating your coupon', split_test: 'Setting up the A/B test', get_sales: 'Checking your sales', get_analytics: 'Checking your traffic', ads_report: 'Reading your ad results',
  create_automation: 'Writing your follow-ups', update_automation: 'Updating the automation', find_contacts: 'Finding contacts', tag_contacts: 'Tagging contacts', draft_broadcast: 'Drafting your broadcast',
  configure_calendar: 'Setting up your calendar', configure_webinar: 'Setting up your webinar', create_quote: 'Preparing your quote', create_course: 'Writing your course', add_quiz: 'Writing the quiz',
  setup_crm: 'Setting up your CRM', create_pipeline: 'Creating your pipeline', connect_domain: 'Connecting your domain', run_app_action: 'Working in your ads account', find_app_actions: 'Checking your ads account',
  studio_make_reel: 'Writing your Reel', studio_storyboard: 'Drawing up the storyboard', studio_change_scene: 'Changing the scene', studio_animate: 'Bringing the scenes to life',
};
const LONG = new Set(['create_funnel', 'create_website', 'create_course', 'generate_image']);
const MAGIC = ['Working on it', 'Putting it together', 'Writing the copy', 'Polishing the details', 'Teaching your page to sell', 'Lining up the details', 'Checking everything', 'Almost there…'];
function LiveStatus({ tools, since }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  const secs = Math.max(0, Math.floor((now - since) / 1000));
  const n = Math.floor(secs / 3.2);
  const run = [...tools].reverse().find((t) => t.status === 'running');
  const doing = run ? DOING[run.name] || 'Working on it' : tools.length ? 'Putting it all together' : 'Thinking it through';
  return (
    <span className="hv-typing" aria-live="polite">
      <i /><i /><i /> <b>{doing}…</b> <span className="hv-magic" key={n}>{MAGIC[n % MAGIC.length]}</span>
      <small className="hv-long">{Math.floor(secs / 60)}:{String(secs % 60).padStart(2, '0')} · Stop any time</small>
      {run && LONG.has(run.name) && <small className="hv-long">Big job — usually about a minute</small>}
    </span>
  );
}

// under a reply: 👍 / 👎 (a 👎 asks what went wrong, optionally) and Undo for the newest reply that changed things
const undoneLine = (r) => [r.restored && `put back ${r.restored} change${r.restored > 1 ? 's' : ''}`, r.removed && `removed ${r.removed} thing${r.removed > 1 ? 's' : ''} it made`].filter(Boolean).join(' and ') || 'nothing left to change';
function ReplyActions({ m, canUndo, onRate, onUndo, busy }) {
  const r = m.feedback?.rating;
  return (
    <div className="hv-acts">
      <button type="button" className={`hv-act ${r === 'up' ? 'on' : ''}`} title="Helpful" aria-label="Helpful" aria-pressed={r === 'up'} disabled={busy} onClick={() => onRate(m, r === 'up' ? null : 'up')}><ThumbsUp size={13} /></button>
      <button type="button" className={`hv-act ${r === 'down' ? 'on down' : ''}`} title="Not right" aria-label="Not right" aria-pressed={r === 'down'} disabled={busy} onClick={() => onRate(m, r === 'down' ? null : 'down')}><ThumbsDown size={13} /></button>
      {canUndo && <button type="button" className="hv-act undo" disabled={busy} onClick={() => onUndo(m)}><Undo2 size={13} /> Undo this</button>}
      {m.undone?.report && <span className="hv-undone">Undone — {undoneLine(m.undone.report)}.{m.undone.report.kept?.length ? ` Can’t be called back: ${m.undone.report.kept.join(', ')}.` : ''}{m.undone.report.failed?.length ? ` Couldn’t undo: ${m.undone.report.failed.join(', ')}.` : ''}</span>}
    </div>
  );
}

// pictures a step brought back (a Studio storyboard): a strip of thumbnails, each opens large
function SceneStrip({ images }) {
  const [big, setBig] = useState(null);
  useEffect(() => { if (big == null) return undefined; const key = (e) => { if (e.key === 'Escape') setBig(null); }; document.addEventListener('keydown', key); return () => document.removeEventListener('keydown', key); }, [big]);
  const x = images[big];
  return (
    <div className="hv-strip">
      {images.map((m, i) => <button key={m.url} type="button" title={m.caption || m.label} aria-label={`Open ${m.label || `picture ${i + 1}`}`} onClick={() => setBig(i)}><img src={m.url} alt="" loading="lazy" /><span>{m.label}</span></button>)}
      {x && <div className="lightbox" role="dialog" aria-modal="true" onClick={() => setBig(null)}><figure><img src={x.url} alt={x.caption || x.label || ''} /><figcaption>{x.label}{x.caption ? ` — “${x.caption}”` : ''}</figcaption></figure></div>}
    </div>
  );
}

// an action Hive proposed that waits for the seller (sending, publishing, deleting…): Confirm / Cancel
const waiting = (t) => t.pending && !t.resolved;
// the same step with the same outcome shows once, with a count ("Google Ads said: … ×3"), not as a growing list
const stateOf = (t) => (t.status === 'running' ? `run:${t.id}` : t.ok === false || t.status === 'error' ? 'error' : 'done');
function squash(tools = []) {
  const out = [];
  for (const t of tools) {
    const same = !t.pending && !t.images?.length && stateOf(t) !== `run:${t.id}` && out.find((x) => !x.pending && !x.images?.length && x.name === t.name && stateOf(x) === stateOf(t) && (x.summary || '') === (t.summary || ''));
    if (same) same.n = (same.n || 1) + 1; else out.push({ ...t });
  }
  return out;
}
const ToolChips = ({ tools, onDecide, deciding }) => (tools?.length ? (
  <ul className="hv-tools">{squash(tools).map((t, i) => (
    <li key={t.id || i} className={`${waiting(t) ? 'confirm' : t.resolved === 'cancelled' ? 'cancelled' : t.status === 'confirm' ? 'confirm' : t.status || (t.ok === false ? 'error' : 'done')}${t.images?.length ? ' has-pics' : ''}`}>
      {t.status === 'running' ? <Loader2 size={13} className="spin-i" /> : t.ok === false || t.status === 'error' || t.resolved === 'cancelled' ? <X size={13} /> : waiting(t) ? <Square size={13} /> : <Check size={13} />}
      <span>{t.summary || (t.status === 'running' && DOING[t.name] ? `${DOING[t.name]}…` : t.label || t.name)}{t.n > 1 && <b className="hv-times"> ×{t.n}</b>}</span>
      {waiting(t) && onDecide && (
        <span className="hv-ok">
          <button className="btn sm primary" disabled={deciding === t.pending} onClick={() => onDecide(t.pending, true)}>Confirm</button>
          <button className="btn sm" disabled={deciding === t.pending} onClick={() => onDecide(t.pending, false)}>Cancel</button>
        </span>
      )}
      {t.images?.length > 0 && <SceneStrip images={t.images} />}
    </li>
  ))}</ul>
) : null);

export default function Hive() {
  const [status, setStatus] = useState(null);
  const [threads, setThreads] = useState([]);
  const [tid, setTid] = useState(null);
  const [msgs, setMsgs] = useState([]);
  const [live, setLive] = useState(null); // the turn in progress: { tools: [], thinking }
  const [prefill, setPrefill] = useState(''); // a question passed in from elsewhere while Hive was off
  const [busy, setBusy] = useState(false);
  const [funnelId, setFunnelId] = useState(null);
  const [funnel, setFunnel] = useState(null);
  const [stepId, setStepId] = useState(null);
  const [device, setDevice] = useState('desktop');
  const [side, setSide] = useState(true);
  const [mob, setMob] = useState('chat');
  const abort = useRef(null);
  const [deciding, setDeciding] = useState(null);
  const endRef = useRef(null);
  const [first, setFirst] = useState('');
  // AI teammates: the one a new chat is with (null = Hive itself), and the dialog to manage them
  const [team, setTeam] = useState([]);
  const [mate, setMate] = useState(null);
  const [manage, setManage] = useState(null); // null, or { editId }
  const [room, setRoom] = useState(null); // the open chat when it's a team room ({ id, room })
  const [roomEdit, setRoomEdit] = useState(null); // the room dialog: {} new, or a room
  useEffect(() => { api('/hive/team').then((d) => setTeam(d.team)).catch(() => {}); }, []);
  useEffect(() => { api('/me').then((m) => setFirst(String(m?.name || '').trim().split(/\s+/)[0] || '')).catch(() => {}); }, []);

  const loadThreads = () => api('/hive/threads').then(setThreads).catch(() => {});
  // actions waiting for the seller's OK across every chat (checked on load and after each reply — no polling)
  const [approvals, setApprovals] = useState(0);
  const [panel, setPanel] = useState(null); // 'approvals' | 'activity'
  const loadApprovals = () => api('/hive/approvals').then((l) => setApprovals(l.length)).catch(() => {});
  useEffect(() => { api('/hive/status').then(setStatus).catch(loadFailed); loadThreads(); loadApprovals(); }, []);
  // teammates whose task chat has a reply the seller hasn't opened yet
  const unreadMates = useMemo(() => new Set(threads.filter((t) => t.unread && t.teammateId).map((t) => t.teammateId)), [threads]);
  // follow the newest message only while the seller is at the bottom (scrolling up to read stays put), and jump
  // rather than animate: a smooth scroll per progress event piled up and fought the reader
  const stick = useRef(true);
  const onScroll = (e) => { const el = e.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 140; };
  useEffect(() => { if (stick.current) endRef.current?.scrollIntoView({ block: 'end' }); }, [msgs, live]);
  // leaving the page stops the reply (it used to keep running — and spending — with nothing on screen)
  useEffect(() => () => abort.current?.abort(), []);
  // a chat whose reply is still running (from before the page was left): say so, and show the reply when it lands
  const [elsewhere, setElsewhere] = useState(false);
  useEffect(() => {
    if (!elsewhere || !tid) return undefined;
    const t = setInterval(async () => {
      try { const th = await api(`/hive/threads/${tid}`); if (!th.running) { setElsewhere(false); setMsgs(th.messages); } } catch { setElsewhere(false); }
    }, 4000);
    return () => clearInterval(t);
  }, [elsewhere, tid]);
  const loadFunnel = async (id) => {
    if (!id) { setFunnel(null); return; }
    try { const f = await api(`/funnels/${id}`); setFunnel(f); setStepId((s) => (f.steps.some((x) => x.id === s) ? s : f.steps[0]?.id)); } catch { setFunnel(null); }
  };
  useEffect(() => { loadFunnel(funnelId); }, [funnelId]);

  const [drawer, setDrawer] = useState(false); // the chat list on tablets and phones
  const narrow = typeof window !== 'undefined' && window.matchMedia?.('(max-width: 1100px)').matches;
  const openThread = async (id) => {
    if (busy) return;
    setDrawer(false);
    setTid(id); setLive(null); setMob('chat'); setElsewhere(false); stick.current = true;
    if (!id) { setMsgs([]); setFunnelId(null); setMate(null); setRoom(null); return; }
    const t = await api(`/hive/threads/${id}`);
    setMsgs(t.messages); setFunnelId(t.funnelId); setElsewhere(!!t.running);
    setMate(team.find((m) => m.id === t.teammateId) || null);
    setRoom(t.room ? { id: t.id, room: t.room } : null);
    if (threads.some((x) => x.id === id && x.unread)) setThreads((l) => l.map((x) => (x.id === id ? { ...x, unread: false } : x))); // opened: seen
  };
  // the seller confirms (or cancels) an action Hive proposed
  const decide = async (pendingId, ok) => {
    if (deciding) return;
    setDeciding(pendingId);
    try {
      const r = await api(`/hive/threads/${tid}/confirm`, 'POST', { pendingId, ok });
      setMsgs((m) => [...m.map((x) => (x.tools ? { ...x, tools: x.tools.map((t) => (t.pending === pendingId ? { ...t, resolved: r.cancelled ? 'cancelled' : r.ok ? 'done' : 'error', summary: r.summary, ok: r.ok, ...(r.images ? { images: r.images } : {}) } : t)) } : x)), { role: 'assistant', text: r.summary, error: !r.ok, at: Date.now() }]);
      if (r.funnelId && r.funnelId !== funnelId) setFunnelId(r.funnelId); else loadFunnel(funnelId);
    } catch (e) { toast(e.message); }
    setDeciding(null);
    loadApprovals();
  };
  // the newest reply that changed things can be undone (then the one before it, and so on)
  const lastUndo = [...msgs].reverse().find((m) => m.undoId && !m.undone)?.undoId;
  const [acting, setActing] = useState(false);
  const rate = async (m, rating) => {
    let note = '';
    if (rating === 'down') { note = await promptDialog({ title: 'What went wrong?', text: 'Optional — it helps us make Hive better. The request and what Hive did are shared with our team.', label: 'What should it have done?', placeholder: 'e.g. it used the wrong price', value: '' }); if (note === null) return; }
    setMsgs((ms) => ms.map((x) => (x === m ? { ...x, feedback: rating ? { rating } : undefined } : x)));
    try { await api(`/hive/threads/${tid}/feedback`, 'POST', { at: m.at, rating, note }); if (rating) toast(rating === 'up' ? 'Thanks!' : 'Thanks — we’ll look into it'); } catch (e) { toast(e.message); }
  };
  const undo = async (m) => {
    if (!await confirmDialog({ title: 'Undo what Hive did in this reply?', text: 'Pages and settings it changed go back to how they were, and what it created is removed. Messages already sent can’t be called back.', confirm: 'Undo' })) return;
    setActing(true);
    try {
      const r = await api(`/hive/threads/${tid}/undo`, 'POST', { undoId: m.undoId });
      toast(r.ok ? 'Undone' : 'Partly undone — see the note under the reply');
      const t = await api(`/hive/threads/${tid}`); setMsgs(t.messages);
      loadFunnel(funnelId);
    } catch (e) { toast(e.message); }
    setActing(false);
  };
  const removeThread = async (id) => { if (!await confirmDialog({ title: 'Delete this chat?', text: 'Funnels it built are kept.', confirm: 'Delete', danger: true })) return; await api(`/hive/threads/${id}`, 'DELETE'); if (id === tid) openThread(null); loadThreads(); };

  const send = async (text, files = []) => {
    const message = String(text || '').trim();
    if ((!message && !files.length) || busy) return;
    setBusy(true); stick.current = true;
    setMsgs((m) => [...m, { role: 'user', text: message, at: Date.now(), ...(files.length ? { files: files.map((x) => ({ name: x.name })) } : {}) }]);
    setLive({ tools: [], thinking: '', since: Date.now() });
    const ac = new AbortController(); abort.current = ac;
    let finalFunnel = funnelId, threadId = tid, lastLoad = 0;
    try {
      const res = await fetch('/api/hive/chat', { method: 'POST', signal: ac.signal, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('ff_token')}` }, body: JSON.stringify({ message, ...(files.length ? { attachments: files.map(({ name, data }) => ({ name, data })) } : {}), threadId: tid, funnelId, ...(!tid && mate ? { teammateId: mate.id } : {}) }) });
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || 'Hive AI is unavailable right now'); }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const chunk = buf.slice(0, i); buf = buf.slice(i + 2);
          if (!chunk.startsWith('data: ')) continue;
          let ev;
          try { ev = JSON.parse(chunk.slice(6)); } catch { continue; } // one garbled event shouldn't end the reply
          if (ev.type === 'thread') { setTid(ev.threadId); threadId = ev.threadId; }
          else if (ev.type === 'thinking') setLive((l) => ({ ...l, thinking: ev.text }));
          else if (ev.type === 'speaker') setLive((l) => ({ ...l, by: ev.by, tools: [], thinking: '' }));
          else if (ev.type === 'tool') {
            setLive((l) => ({ ...l, tools: ev.status === 'running' ? [...l.tools, ev] : l.tools.map((t) => (t.id === ev.id ? { ...t, ...ev } : t)) }));
            if (ev.status === 'done' && ev.funnelId) { if (ev.funnelId !== finalFunnel) { finalFunnel = ev.funnelId; setFunnelId(ev.funnelId); } else if (Date.now() - lastLoad > 2000) { lastLoad = Date.now(); loadFunnel(ev.funnelId); } }
          } else if (ev.type === 'reply') {
            setMsgs((m) => [...m, { role: 'assistant', text: ev.text, tools: ev.tools, at: Date.now(), ...(ev.by ? { by: ev.by } : {}) }]);
            if (ev.by) setLive((l) => (l ? { ...l, tools: [], thinking: '' } : l));
            if (ev.funnelId && ev.funnelId !== finalFunnel) setFunnelId(ev.funnelId); else if (ev.funnelId) loadFunnel(ev.funnelId);
          } else if (ev.type === 'error') setMsgs((m) => [...m, { role: 'assistant', text: ev.error, error: true, at: Date.now() }]);
        }
      }
    } catch (e) {
      if (e.name !== 'AbortError') setMsgs((m) => [...m, { role: 'assistant', text: e.message, error: true, at: Date.now() }]);
      else setMsgs((m) => [...m, { role: 'assistant', text: 'Stopped.', at: Date.now() }]);
    }
    setLive(null); setBusy(false); abort.current = null;
    loadThreads(); loadApprovals();
    // the saved copy (its time, what can be undone) — a stopped reply is saved a moment later
    if (threadId) setTimeout(() => api(`/hive/threads/${threadId}`).then((t) => setMsgs(t.messages)).catch(() => {}), ac.signal.aborted ? 1200 : 0);
  };

  const step = funnel?.steps.find((s) => s.id === stepId) || funnel?.steps[0];
  const ready = status?.ready;
  // a question asked from elsewhere in the app (e.g. the CRM's Ask Hive bar): /hive?ask=…
  const [params, setParams] = useSearchParams();
  const asked = useRef(false);
  useEffect(() => {
    const q = params.get('ask'), th = params.get('thread');
    if (params.get('skills')) { setManage({ skills: true }); setParams({}, { replace: true }); return; } // 'skills to review' from the bell
    if (status && th && !asked.current) { asked.current = true; setParams({}, { replace: true }); openThread(th).catch(() => {}); return; }
    if (!status || !q || asked.current) return;
    asked.current = true; setParams({}, { replace: true });
    if (ready) send(q); else setPrefill(q);
  }, [status]);
  // who said a message in a room: a teammate, or the team's combined summary
  const who = (m) => (!m?.by ? null : m.by === 'summary' ? { emoji: '👥', name: 'Team summary' } : team.find((x) => x.id === m.by) || null);
  const empty = !msgs.length && !live;
  const composer = (
    <Composer ready={ready} busy={busy} prefill={prefill} focusKey={tid} onSend={send} onStop={() => abort.current?.abort()}
      placeholder={ready === false ? 'Hive AI isn’t switched on yet' : room ? `Message ${room.room.name} — @name to ask one, @everyone for all` : msgs.length ? `Reply to ${mate ? mate.name : 'Hive'}…` : mate ? `Ask ${mate.name}…` : funnel ? `Ask Hive to change “${funnel.name}”, add a page, an offer or an automation…` : 'Describe your business, or what you want to build…'} />
  );

  return (
    <Layout title={<span className="hv-title"><Sparkles size={20} /> Hive AI</span>} subtitle="Describe it — Hive builds the funnel, pages, offers and automations while you watch." wide>
      <div className={`hive ${side ? '' : 'no-side'} ${funnel ? 'with-prev' : 'no-prev'} ${empty ? 'is-empty' : ''} mob-${mob} ${drawer ? 'drawer-open' : ''}`}>
        {drawer && <button className="hv-drawer-bg" aria-label="Close chats" onClick={() => setDrawer(false)} />}
        <aside className="hv-threads">
          <button className="hv-new" onClick={() => openThread(null)} disabled={busy}><Plus size={15} /> New chat</button>
          <TeamSide team={team} unread={unreadMates} mate={!tid ? mate : null} disabled={busy} onPick={(m) => { openThread(null).then(() => setMate(m)); }} onManage={() => setManage({})} rooms={threads.filter((t) => t.room)} roomId={room?.id || null} onRoom={(id) => openThread(id)} onNewRoom={() => setRoomEdit({})} />
          {approvals > 0 && <button className="hv-side-btn ask" onClick={() => setPanel('approvals')}><ShieldCheck size={14} /> Waiting for your OK ({approvals})</button>}
          <button className="hv-side-btn" onClick={() => setPanel('activity')}><History size={14} /> Activity</button>
          {threads.length > 0 && <small className="hv-tlabel">Recent</small>}
          <div className="hv-tlist">
            {threads.filter((t) => !t.room).map((t) => (
              <div key={t.id} className={`hv-t ${t.id === tid ? 'on' : ''}`} onClick={() => openThread(t.id)}>
                {team.find((m) => m.id === t.teammateId) ? <span className="hv-t-e" aria-hidden="true">{team.find((m) => m.id === t.teammateId).emoji}</span> : <MessageSquare size={14} />}<span title={t.title}>{t.title}</span><small>{ago(t.updatedAt)}</small>
                <button className="icon-btn xs" title="Delete chat" aria-label="Delete chat" onClick={(e) => { e.stopPropagation(); removeThread(t.id); }}><Trash2 size={12} /></button>
              </div>
            ))}
            {!threads.length && <p className="hv-tnone">Your chats with Hive appear here.</p>}
          </div>
        </aside>

        <section className="hv-chat">
          <div className="hv-chat-h">
            <button className="icon-btn" title={narrow ? 'Chats' : side ? 'Hide chats' : 'Show chats'} aria-label={narrow ? 'Chats' : side ? 'Hide chats' : 'Show chats'} onClick={() => (window.matchMedia('(max-width: 1100px)').matches ? setDrawer((d) => !d) : setSide(!side))}><PanelLeft size={17} /></button>
            <b>{mate && <span className="hv-mate-tag" style={{ '--mc': mate.color }}>{mate.emoji} {mate.name}</span>}{threads.find((t) => t.id === tid)?.title || (mate ? '' : 'New chat')}</b>
            {mate && <button className="btn ghost sm" onClick={() => setManage({ editId: mate.id })}>Settings</button>}
            {room && <span className="hv-room-tag">{room.room.members.map((id) => team.find((m) => m.id === id)).filter(Boolean).map((m) => <span key={m.id} title={m.name}>{m.emoji}</span>)}</span>}
            {room && <button className="btn ghost sm" onClick={() => setRoomEdit(threads.find((t) => t.id === room.id) || { id: room.id, room: room.room })}>Room settings</button>}
            {(tid || msgs.length > 0) && <button className="btn ghost sm hv-newchat" onClick={() => openThread(null)} disabled={busy} title="End this chat and start a new one (this one stays in your list)"><Plus size={14} /> New chat</button>}
            {status?.provider && <span className="hv-prov" title="Only you (the platform owner) see this">{status.provider}</span>}
            <span className={`hv-state ${ready ? 'on' : ''}`}><i />{ready ? 'Hive AI' : 'Offline'}</span>
          </div>
          <div className="hv-msgs" onScroll={onScroll}>
            {empty && (
              <div className="hv-empty">
                <span className="hv-orb" aria-hidden="true"><Sparkles size={28} /></span>
                {mate ? <>
                  <h2>{mate.emoji} {mate.name}</h2>
                  <p>{mate.role}{mate.schedule?.on ? ` · Regular task ${when(mate.schedule)}: “${mate.schedule.task}”` : ''}</p>
                </> : <>
                <h2>{first ? `Hi ${first}, what are we building today?` : 'What are we building today?'}</h2>
                <p>Describe your business in a sentence. Hive builds the whole funnel — pages, checkout, upsells, course, follow-ups — and changes anything you ask.</p>
                </>}
                {ready === false && <p className="hv-warn">Hive AI isn’t switched on yet — check back soon.</p>}
                {composer}
                {mate ? (mate.schedule?.task && <div className="hv-sugg one"><button onClick={() => send(mate.schedule.task)} disabled={!ready}><span className="hv-sugg-ic">{mate.emoji}</span><b>Do your regular task now</b><small>{mate.schedule.task}</small></button></div>) : <div className="hv-sugg">{SUGGESTIONS.map((x) => (
                  <button key={x.title} onClick={() => send(x.text)} disabled={!ready}>
                    <span className="hv-sugg-ic"><x.icon size={16} /></span>
                    <b>{x.title}</b>
                    <small>{x.text}</small>
                  </button>
                ))}</div>}
              </div>
            )}
            {msgs.map((m, i) => (
              <div key={`${m.at || ''}-${i}`} className={`hv-msg ${m.role} ${m.error ? 'err' : ''}`}>
                {m.role === 'assistant' && <span className="hv-av" title={who(m)?.name}>{who(m)?.emoji || (mate ? mate.emoji : <Sparkles size={14} />)}</span>}
                <div className="hv-bub">{m.role === 'assistant' && room && who(m) && <small className="hv-by">{who(m).name}</small>}{m.role === 'assistant' ? <><ToolChips tools={m.tools} onDecide={busy ? null : decide} deciding={deciding} /><Rich text={m.text} />{tid && <ReplyActions m={m} canUndo={!!m.undoId && m.undoId === lastUndo} onRate={rate} onUndo={undo} busy={busy || acting} />}</> : <>{m.files?.length > 0 && <div className="hv-files sent">{m.files.map((x, i) => <span key={i} className="hv-file"><Paperclip size={12} />{x.name}</span>)}</div>}{m.text}</>}</div>
              </div>
            ))}
            {live && (
              <div className="hv-msg assistant live">
                <span className="hv-av">{who(live)?.emoji || (mate ? mate.emoji : <Sparkles size={14} />)}</span>
                <div className="hv-bub">
                  {room && who(live) && <small className="hv-by">{who(live).name}</small>}
                  {live.thinking && <Rich text={live.thinking} />}
                  <ToolChips tools={live.tools} />
                  <LiveStatus tools={live.tools} since={live.since || Date.now()} />
                </div>
              </div>
            )}
            {elsewhere && !live && (
              <div className="hv-msg assistant live">
                <span className="hv-av">{mate ? mate.emoji : <Sparkles size={14} />}</span>
                <div className="hv-bub"><span className="hv-typing"><i /><i /><i /> <b>Hive is still finishing a reply in this chat…</b> <small className="hv-long">It shows here when it’s done.</small></span></div>
              </div>
            )}
            <div ref={endRef} />
          </div>
          {!empty && <div className="hv-dock">{composer}</div>}
        </section>

        <section className="hv-prev">
          <div className="hv-prev-h">
            {funnel ? <>
              <div className="hv-steps">{funnel.steps.map((s) => <button key={s.id} className={s.id === step?.id ? 'on' : ''} onClick={() => setStepId(s.id)}>{s.name}</button>)}</div>
              <div className="seg sm">
                <button className={device === 'desktop' ? 'on' : ''} onClick={() => setDevice('desktop')} title="Desktop" aria-label="Desktop"><Monitor size={14} /></button>
                <button className={device === 'mobile' ? 'on' : ''} onClick={() => setDevice('mobile')} title="Phone" aria-label="Phone"><Smartphone size={14} /></button>
              </div>
              <Link className="btn ghost sm" to={`/funnels/${funnel.id}`}><Pencil size={13} /> Edit</Link>
              <a className="btn ghost sm" href={`/f/${funnel.slug}${step ? `/${step.slug}` : ''}${funnel.published ? '' : `?preview=1&pv=${funnel.previewKey || ''}`}`} target="_blank" rel="noreferrer"><ExternalLink size={13} /> {funnel.published ? 'Live' : 'Preview'}</a>
            </> : <span className="muted sm">The funnel Hive builds or edits shows up here, live.</span>}
          </div>
          <div className="hv-canvas">
            {funnel && step ? (
              <div className={`hv-frame ${device}`}><Preview step={step} funnel={funnel} /></div>
            ) : (
              <div className="hv-blank"><Eye size={30} /><b>Nothing to preview yet</b><span>Start by telling Hive what you sell.</span></div>
            )}
          </div>
        </section>

        {panel === 'approvals' && <ApprovalsDialog onClose={() => { setPanel(null); loadApprovals(); }} onOpen={(id) => openThread(id).catch(() => {})}
          onDecided={(id) => { if (id === tid) api(`/hive/threads/${id}`).then((t) => setMsgs(t.messages)).catch(() => {}); }} />}
        {panel === 'activity' && <ActivityDialog team={team} onClose={() => setPanel(null)} />}
        {roomEdit && <RoomDialog team={team} room={roomEdit.id ? roomEdit : null} onClose={() => setRoomEdit(null)} onSaved={(r) => { loadThreads(); if (!roomEdit.id) openThread(r.id); else setRoom({ id: r.id, room: r.room }); }} onDeleted={(id) => { loadThreads(); if (room?.id === id) openThread(null); }} onRun={(id) => { loadThreads(); openThread(id); }} />}
        {manage && <TeamDialog editId={manage.editId} skills={!!manage.skills} onClose={() => setManage(null)} onChanged={(t) => { setTeam(t); setMate((m) => (m ? t.find((x) => x.id === m.id) || null : m)); }} onRun={(id) => { loadThreads(); openThread(id); }} />}
        <nav className="hv-mobtabs">
          <button className={mob === 'chat' ? 'on' : ''} onClick={() => setMob('chat')}><MessageSquare size={16} /> Chat</button>
          <button className={mob === 'preview' ? 'on' : ''} onClick={() => setMob('preview')}><Eye size={16} /> Preview{funnel ? '' : ''}</button>
        </nav>
      </div>
    </Layout>
  );
}
