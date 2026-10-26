import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { Layout, Panel, Icon, toast, confirmDialog } from '../ui';
import { waFmt } from './Inbox';
import '../chat.css';

// /chatbots — WhatsApp chatbots drawn on a canvas, drafted by AI from a sentence, tested on a phone before going
// live; and /chatbots?tab=agent — the AI agent that answers customers from the business's own knowledge.
const AI_BG = 'linear-gradient(135deg, #7c3aed, #2563eb 55%, #06b6d4)';
export const NT = {
  start: ['Start', 'bolt', '#16a34a', 'Where the chat begins'],
  message: ['Send a message', 'chat', '#0ea5e9', 'Text or a photo'],
  buttons: ['Buttons', 'grip', '#6366f1', 'Up to 3 tap-to-reply buttons'],
  list: ['List menu', 'list', '#8b5cf6', 'A menu of up to 10 options'],
  ask: ['Ask a question', 'edit', '#f59e0b', 'Saves the answer to the contact'],
  condition: ['Condition', 'split', '#64748b', 'Yes / no on tags or answers'],
  tag: ['Add a tag', 'tag', '#ec4899', 'Tag the contact (starts automations)'],
  ai_route: ['AI router', 'sparkles', AI_BG, 'AI sorts the message by topic'],
  ai_agent: ['AI agent', 'sparkles', AI_BG, 'The AI agent takes the chat'],
  handoff: ['Hand to a person', 'users', '#ea580c', 'Notifies your team'],
  wait: ['Wait', 'clock', '#78716c', 'Pause before the next step'],
  webhook: ['Webhook', 'link', '#0f766e', 'Send the answers to another app'],
  end: ['End', 'check', '#1c1917', 'Finish (optionally resolve)'],
};
const PALETTE = [['Messages', ['message', 'buttons', 'list', 'ask']], ['AI', ['ai_route', 'ai_agent']], ['Logic & actions', ['condition', 'tag', 'wait', 'webhook']], ['Finish', ['handoff', 'end']]];
const DEFAULTS = {
  message: { text: '' }, buttons: { text: '', buttons: [{ id: 'b1', title: 'Yes' }, { id: 'b2', title: 'No' }] }, list: { text: '', button: 'Choose', rows: [{ id: 'r1', title: 'Option 1', desc: '' }, { id: 'r2', title: 'Option 2', desc: '' }] },
  ask: { text: '', var: 'answer', save: '', validate: 'text', retry: '' }, condition: { match: 'all', rules: [{ field: 'tag', op: 'has', value: '' }] }, tag: { add: [] },
  ai_route: { intents: [{ id: 'i1', label: 'Sales', desc: 'wants to buy or asks the price' }, { id: 'i2', label: 'Support', desc: 'needs help with something' }] }, ai_agent: { note: '' },
  handoff: { text: 'Someone from our team will reply here shortly 🙏', note: '' }, wait: { minutes: 60 }, webhook: { url: '' }, end: { text: '', resolve: false },
};
const TRIG = { keyword: 'When a message has a keyword', welcome: 'A new contact’s first message', default: 'Any message nothing else answers', manual: 'Only when started from the inbox' };
const IDEAS = ['Take cake orders with flavour, size and delivery date', 'Book a free demo class and ask the child’s age', 'Qualify home-loan leads by income and city', 'Collect a review after a salon visit', 'Answer gym membership questions, pass hot leads to sales'];
const rid = (p = 'n') => `${p}${Math.random().toString(36).slice(2, 8)}`;
export const portsOf = (n) => (n.type === 'buttons' ? [...n.data.buttons.map((b) => [b.id, b.title || 'Button']), ['other', 'Anything else']]
  : n.type === 'list' ? [...n.data.rows.map((r) => [r.id, r.title || 'Option']), ['other', 'Anything else']]
    : n.type === 'ai_route' ? [...n.data.intents.map((i) => [i.id, i.label || 'Topic']), ['other', 'Something else']]
      : n.type === 'condition' ? [['yes', 'Yes'], ['no', 'No']] : ['ai_agent', 'handoff', 'end'].includes(n.type) ? [] : [['next', n.type === 'start' ? 'Begin' : n.type === 'ask' ? 'After the answer' : 'Next']]);
// the same checks the server runs before a chatbot goes live
export function problemsOf(f) {
  const out = [], bad = (node, msg) => out.push({ node, msg });
  const start = f.nodes.find((n) => n.type === 'start');
  if (f.trigger.type === 'keyword' && !f.trigger.keywords.length) bad(start?.id, 'Add at least one keyword that starts this chatbot');
  if (!f.edges.some((e) => e.from === start?.id)) bad(start?.id, 'Connect the start to the first step');
  for (const n of f.nodes) {
    const d = n.data;
    if (['message', 'buttons', 'list', 'ask'].includes(n.type) && !d.text && !d.image) bad(n.id, `${NT[n.type][0]}: write the message`);
    if (n.type === 'buttons' && (!d.buttons.length || d.buttons.some((b) => !b.title))) bad(n.id, 'Buttons: give every button a title');
    if (n.type === 'list' && (!d.rows.length || d.rows.some((r) => !r.title))) bad(n.id, 'List: give every option a title');
    if (n.type === 'ai_route' && (!d.intents.length || d.intents.some((i) => !i.label))) bad(n.id, 'AI router: name every topic');
    if (n.type === 'tag' && !d.add.length) bad(n.id, 'Add a tag: choose the tag');
    if (n.type === 'webhook' && !/^https?:\/\/[^\s/]+\.[^\s]+$/.test(d.url)) bad(n.id, 'Webhook: enter the web address');
    if (n.type === 'condition' && !d.rules.length) bad(n.id, 'Condition: add a rule');
  }
  return out;
}
const triggerText = (t) => (t.type === 'keyword' ? (t.keywords.length ? `Keywords: ${t.keywords.join(', ')}` : 'No keywords yet') : TRIG[t.type]);

export default function Chatbots() {
  const { id } = useParams();
  const [sp, setSp] = useSearchParams();
  const tab = sp.get('tab') === 'agent' ? 'agent' : 'bots';
  const nav = useNavigate();
  const [d, setD] = useState(null);
  const [draft, setDraft] = useState(null); // an AI-drafted / template flow that isn't saved yet
  const load = () => api('/waflows').then(setD).catch(() => setD({ flows: [], templates: [] }));
  useEffect(() => { load(); }, []);
  const open = id ? (id === 'new' ? draft : d?.flows.find((f) => f.id === id)) : null;
  if (id && open) return <Builder key={open.id || 'new'} initial={open} ai={d?.ai} onClose={() => { setDraft(null); nav('/chatbots'); load(); }} onSaved={(f) => { load(); if (!open.id) { setDraft(null); nav(`/chatbots/${f.id}`, { replace: true }); } }} />;
  const create = async (template) => { try { const f = await api('/waflows', 'POST', { template }); await load(); nav(`/chatbots/${f.id}`); } catch (e) { toast(e.message); } };
  return (
    <Layout title="Chatbots & AI agent" subtitle="Automate WhatsApp: chatbots that collect details and route chats, and an AI agent that answers like your best salesperson." actions={<Link className="btn ghost sm" to="/inbox"><Icon name="chat" size={15} />Open inbox</Link>}>
      <div className="seg" style={{ justifySelf: 'start' }}>
        <button className={tab === 'bots' ? 'on' : ''} onClick={() => setSp({})}><Icon name="bot" size={14} />Chatbots</button>
        <button className={tab === 'agent' ? 'on' : ''} onClick={() => setSp({ tab: 'agent' })}><Icon name="sparkles" size={14} />AI agent</button>
      </div>
      {d && !d.connected && <div className="app-banner info" style={{ margin: 0 }}><Icon name="chat" size={15} /><span>Connect your Hive WhatsApp number in Settings → Channels so chatbots can reply to real customers. You can build and test them now.</span><Link to="/settings">Settings</Link></div>}
      {tab === 'agent' ? <Agent /> : !d ? <span className="spin dark" /> : (
        <>
          <AiDraft ai={d.ai} onDraft={(f) => { setDraft(f); nav('/chatbots/new'); }} />
          {d.flows.length > 0 && (
            <Panel title="Your chatbots">
              <div className="cb-grid">
                {d.flows.map((f) => <FlowCard key={f.id} f={f} onOpen={() => nav(`/chatbots/${f.id}`)} onChange={load} />)}
              </div>
            </Panel>
          )}
          <Panel title="Start from a ready-made chatbot" actions={<button className="btn ghost sm" onClick={() => create('')}><Icon name="plus" size={14} />Blank chatbot</button>}>
            <div className="cb-grid">
              {d.templates.map((t) => (
                <button key={t.id} className="cb-card" onClick={() => create(t.id)}>
                  <span className="ic" style={t.icon === 'sparkles' ? { background: AI_BG, color: '#fff' } : undefined}><Icon name={t.icon} size={18} /></span>
                  <b>{t.title}</b><small>{t.desc}</small>
                </button>
              ))}
            </div>
          </Panel>
        </>
      )}
    </Layout>
  );
}

function AiDraft({ ai, onDraft }) {
  const [p, setP] = useState('');
  const [busy, setBusy] = useState(false);
  const go = async (e) => {
    e?.preventDefault();
    if (p.trim().length < 8) return toast('Describe what the chatbot should do');
    setBusy(true);
    try { onDraft((await api('/waflows/ai', 'POST', { prompt: p })).flow); } catch (er) { toast(er.message); }
    setBusy(false);
  };
  return (
    <section className="cb-hero">
      <h2><span style={{ color: '#67e8f9' }}>✦</span> Describe a chatbot — AI builds it</h2>
      <p>Say what it should do in plain words (English, Hindi or Hinglish). You get a complete flow on the canvas to tweak, test on a phone and switch on.</p>
      <form className="cb-prompt" onSubmit={go}>
        <input value={p} onChange={(e) => setP(e.target.value)} placeholder="e.g. Ask what service they need, their budget and city, then pass serious leads to my team" disabled={!ai || busy} />
        <button className="btn ai lg" disabled={!ai || busy}>{busy ? <><span className="spin" />Drawing…</> : <><Icon name="sparkles" size={16} />Build it</>}</button>
      </form>
      {ai ? <div className="cb-ideas">{IDEAS.map((x) => <button key={x} type="button" onClick={() => setP(x)}>{x}</button>)}</div> : <p style={{ position: 'relative', zIndex: 1 }}>AI isn’t switched on for this account — start from a ready-made chatbot below.</p>}
    </section>
  );
}

function FlowCard({ f, onOpen, onChange }) {
  const s = f.stats || {};
  const toggle = async (e) => { e.stopPropagation(); try { await api(`/waflows/${f.id}`, 'PUT', { active: !f.active }); onChange(); toast(f.active ? 'Chatbot switched off' : 'Chatbot is live'); } catch (er) { toast(er.message); } };
  const del = async (e) => { e.stopPropagation(); if (!await confirmDialog({ title: `Delete “${f.name}”?`, text: 'Chats it is running stop where they are.', confirm: 'Delete', danger: true })) return; await api(`/waflows/${f.id}`, 'DELETE'); onChange(); };
  return (
    <div className="cb-card click" role="button" tabIndex={0} onClick={onOpen} onKeyDown={(e) => e.key === 'Enter' && onOpen()} style={{ cursor: 'pointer' }}>
      <div className="row"><span className={`cb-live ${f.active ? '' : 'off'}`}>{f.trigger.type === 'manual' ? 'Manual' : f.active ? 'Live' : 'Off'}</span><span className="row" style={{ gap: 2 }}>{f.trigger.type !== 'manual' && <button className="btn ghost sm" onClick={toggle}>{f.active ? 'Switch off' : 'Go live'}</button>}<button className="icon-btn danger" onClick={del} aria-label="Delete"><Icon name="trash" size={15} /></button></span></div>
      <b>{f.name}</b>
      <small>{triggerText(f.trigger)}</small>
      {f.problems.length > 0 && <small style={{ color: 'var(--c-warn)' }}>⚠ {f.problems[0].msg}</small>}
      <div className="stats"><span><b>{s.runs || 0}</b> chats</span><span><b>{s.done || 0}</b> finished</span><span><b>{s.handoffs || 0}</b> to your team</span></div>
    </div>
  );
}

// ---------- the builder ----------
function Builder({ initial, ai, onClose, onSaved }) {
  const [f, setF] = useState(() => structuredClone({ name: initial.name, trigger: initial.trigger, nodes: initial.nodes, edges: initial.edges }));
  const [saved, setSaved] = useState(() => JSON.stringify({ name: initial.name, trigger: initial.trigger, nodes: initial.nodes, edges: initial.edges }));
  const [active, setActive] = useState(!!initial.active);
  const [sel, setSel] = useState(null);
  const [panel, setPanel] = useState('edit');
  const [view, setView] = useState({ x: 40, y: 40, z: 0.9 });
  const [now, setNow] = useState(null); // the node the test phone is on
  const [busy, setBusy] = useState(false);
  const dirty = JSON.stringify(f) !== saved;
  const probs = problemsOf(f);
  const set = (fn) => setF((x) => { const n = structuredClone(x); fn(n); return n; });
  const setNode = (nid, fn) => set((x) => { const n = x.nodes.find((y) => y.id === nid); if (n) fn(n); });
  const addNode = (type, x, y) => { const n = { id: rid(), type, x: Math.round(x), y: Math.round(y), data: structuredClone(DEFAULTS[type]) }; set((g) => { g.nodes.push(n); }); setSel(n.id); setPanel('edit'); };
  const delNode = (nid) => { if (f.nodes.find((n) => n.id === nid)?.type === 'start') return; set((g) => { g.nodes = g.nodes.filter((n) => n.id !== nid); g.edges = g.edges.filter((e) => e.from !== nid && e.to !== nid); }); setSel(null); };
  const save = async (extra = {}) => {
    setBusy(true);
    try {
      const body = { ...f, ...extra };
      const r = initial.id ? await api(`/waflows/${initial.id}`, 'PUT', body) : await api('/waflows', 'POST', { flow: body });
      if (!initial.id && extra.active) await api(`/waflows/${r.id}`, 'PUT', { active: true });
      setSaved(JSON.stringify(f)); setActive(!!(extra.active ?? r.active));
      onSaved(r);
      toast(extra.active ? '🚀 Chatbot is live' : extra.active === false ? 'Chatbot switched off' : 'Saved');
    } catch (e) { toast(e.message); if (e.data?.problems?.[0]?.node) setSel(e.data.problems[0].node); }
    setBusy(false);
  };
  const close = async () => { if (dirty && !await confirmDialog({ title: 'Leave without saving?', text: 'Your changes to this chatbot will be lost.', confirm: 'Leave', danger: true })) return; onClose(); };
  useEffect(() => {
    const k = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); save(); }
      if ((e.key === 'Delete' || e.key === 'Backspace') && sel && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName)) delNode(sel);
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  });
  const node = f.nodes.find((n) => n.id === sel);
  // full screen over the app (a portal: the page-transition wrapper would otherwise contain a fixed layer)
  return createPortal(
    <div className="wfb">
      <header className="wfb-top">
        <button className="icon-btn" onClick={close} aria-label="Back"><Icon name="chevron" className="flip" /></button>
        <span className="k" style={{ width: 30, height: 30, borderRadius: 9, display: 'grid', placeItems: 'center', background: '#eef2ff', color: '#4338ca' }}><Icon name="bot" size={16} /></span>
        <input className="name" value={f.name} onChange={(e) => set((g) => { g.name = e.target.value; })} aria-label="Chatbot name" />
        {f.trigger.type !== 'manual' && <span className={`cb-live ${active ? '' : 'off'}`}>{active ? 'Live' : 'Off'}</span>}
        <span className="sp" />
        {probs.length > 0 && <button className="pill warn" style={{ cursor: 'pointer' }} onClick={() => { setSel(probs[0].node); setPanel('edit'); }}>⚠ {probs.length} to fix</button>}
        <button className={`btn sm ${panel === 'test' ? 'primary' : 'ghost'}`} onClick={() => setPanel(panel === 'test' ? 'edit' : 'test')}><Icon name="phone" size={14} />Test</button>
        <button className="btn ghost sm" onClick={() => save()} disabled={busy || (!dirty && initial.id)}>{dirty || !initial.id ? 'Save' : 'Saved'}</button>
        {f.trigger.type !== 'manual' && (active ? <button className="btn ghost sm" onClick={() => save({ active: false })} disabled={busy}>Switch off</button> : <button className="btn live sm" onClick={() => save({ active: true })} disabled={busy || probs.length > 0} title={probs[0]?.msg}><Icon name="play" size={13} />Go live</button>)}
      </header>
      <div className="wfb-body">
        <aside className="wfb-pal">
          {PALETTE.map(([g, types]) => (
            <div key={g} style={{ display: 'contents' }}>
              <h5>{g}</h5>
              {types.map((t) => (
                <button key={t} className="wfb-pi" draggable onDragStart={(e) => { e.dataTransfer.setData('text/fh-node', t); e.dataTransfer.effectAllowed = 'copy'; }} onClick={() => addNode(t, (300 - view.x) / view.z + Math.random() * 40, (200 - view.y) / view.z + Math.random() * 40)} title={NT[t][3]}>
                  <span className="k" style={{ background: NT[t][2] }}><Icon name={NT[t][1]} size={14} /></span>{NT[t][0]}
                </button>
              ))}
            </div>
          ))}
          {!ai && <p className="hint">AI steps need AI switched on for this account.</p>}
        </aside>
        <Canvas f={f} set={set} setNode={setNode} sel={sel} setSel={(x) => { setSel(x); if (x) setPanel('edit'); }} view={view} setView={setView} addNode={addNode} delNode={delNode} probs={probs} now={panel === 'test' ? now : null} />
        <aside className="wfb-right">
          {panel === 'test' ? <TestPhone f={f} onNode={setNow} /> : (
            <div className="wfb-insp">
              {node ? <Inspector key={node.id} n={node} f={f} set={set} setNode={setNode} onDelete={() => delNode(node.id)} /> : <FlowSettings f={f} set={set} probs={probs} onPick={setSel} />}
            </div>
          )}
        </aside>
      </div>
    </div>,
    document.body,
  );
}

function Canvas({ f, set, setNode, sel, setSel, view, setView, addNode, delNode, probs, now }) {
  const wrap = useRef(), world = useRef();
  const dots = useRef({});
  const [pts, setPts] = useState({});
  const [drag, setDrag] = useState(null); // { kind: 'pan' | 'node' | 'wire', … }
  const [wire, setWire] = useState(null); // the wire being drawn: { from, port, x, y }
  const [over, setOver] = useState(null);
  const bad = new Set(probs.map((p) => p.node));
  // where every output dot sits in world coordinates (nodes grow with their text, so measured, not computed)
  useLayoutEffect(() => {
    const w = world.current?.getBoundingClientRect();
    if (!w) return;
    const next = {};
    for (const [k, el] of Object.entries(dots.current)) { if (!el) continue; const r = el.getBoundingClientRect(); next[k] = [(r.left + r.width / 2 - w.left) / view.z, (r.top + r.height / 2 - w.top) / view.z]; }
    if (JSON.stringify(next) !== JSON.stringify(pts)) setPts(next);
  });
  const capture = (e) => { try { wrap.current.setPointerCapture(e.pointerId); } catch { /* a pointer the browser no longer tracks */ } };
  const toWorld = (e) => { const r = wrap.current.getBoundingClientRect(); return [(e.clientX - r.left - view.x) / view.z, (e.clientY - r.top - view.y) / view.z]; };
  const down = (e) => {
    if (e.button !== 0 || e.target.closest('.wfb-node, .wfb-zoom')) return;
    setSel(null);
    setDrag({ kind: 'pan', sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y });
    capture(e);
  };
  const move = (e) => {
    if (!drag) return;
    if (drag.kind === 'pan') setView((v) => ({ ...v, x: drag.vx + e.clientX - drag.sx, y: drag.vy + e.clientY - drag.sy }));
    else if (drag.kind === 'node') setNode(drag.id, (n) => { n.x = Math.round(drag.nx + (e.clientX - drag.sx) / view.z); n.y = Math.round(drag.ny + (e.clientY - drag.sy) / view.z); });
    else if (drag.kind === 'wire') { const [x, y] = toWorld(e); setWire((w) => ({ ...w, x, y })); setOver(document.elementFromPoint(e.clientX, e.clientY)?.closest('.wfb-node')?.dataset.id || null); }
  };
  const up = (e) => {
    if (drag?.kind === 'wire') {
      const to = document.elementFromPoint(e.clientX, e.clientY)?.closest('.wfb-node')?.dataset.id;
      const target = to && f.nodes.find((n) => n.id === to);
      if (target && target.type !== 'start') set((g) => { g.edges = [...g.edges.filter((x) => !(x.from === drag.from && x.port === drag.port)), { from: drag.from, port: drag.port, to }]; });
      setWire(null); setOver(null);
    }
    setDrag(null);
  };
  const wheel = (e) => {
    const r = wrap.current.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
    setView((v) => { const z = Math.min(1.6, Math.max(0.3, v.z * Math.exp(-e.deltaY * 0.0012))); return { z, x: mx - ((mx - v.x) * z) / v.z, y: my - ((my - v.y) * z) / v.z }; });
  };
  useEffect(() => { const el = wrap.current; const h = (e) => e.preventDefault(); el.addEventListener('wheel', h, { passive: false }); return () => el.removeEventListener('wheel', h); }, []);
  const fit = () => {
    const r = wrap.current.getBoundingClientRect();
    const xs = f.nodes.map((n) => n.x), ys = f.nodes.map((n) => n.y);
    const minX = Math.min(...xs), minY = Math.min(...ys), w = Math.max(...xs) - minX + 270, h = Math.max(...ys) - minY + 220;
    const z = Math.min(1.1, Math.max(0.3, Math.min((r.width - 60) / w, (r.height - 60) / h)));
    setView({ z, x: (r.width - w * z) / 2 - minX * z, y: (r.height - h * z) / 2 - minY * z });
  };
  useEffect(() => { fit(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const path = ([x1, y1], [x2, y2]) => { const dx = Math.max(50, Math.abs(x2 - x1) / 2); return `M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}`; };
  const inPt = (n) => [n.x, n.y + 25];
  const byId = Object.fromEntries(f.nodes.map((n) => [n.id, n]));
  return (
    <div className={`wfb-canvas ${drag?.kind === 'pan' ? 'panning' : ''}`} ref={wrap} onPointerDown={down} onPointerMove={move} onPointerUp={up} onWheel={wheel}
      style={{ backgroundSize: `${22 * view.z}px ${22 * view.z}px`, backgroundPosition: `${view.x}px ${view.y}px` }}
      onDragOver={(e) => { if (e.dataTransfer.types.includes('text/fh-node')) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } }}
      onDrop={(e) => { const t = e.dataTransfer.getData('text/fh-node'); if (!NT[t]) return; e.preventDefault(); const [x, y] = toWorld(e); addNode(t, x - 20, y - 20); }}>
      <div className="wfb-world" ref={world} style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.z})` }}>
        <svg className="wfb-edges" width="1" height="1">
          <defs><linearGradient id="fbgrad" x1="0" x2="1"><stop offset="0" stopColor="#7c3aed" /><stop offset="1" stopColor="#06b6d4" /></linearGradient></defs>
          {f.edges.map((e) => {
            const a = pts[`${e.from}:${e.port}`], b = byId[e.to];
            if (!a || !b) return null;
            const d = path(a, inPt(b)), hot = sel && (e.from === sel || e.to === sel);
            return (
              <g key={`${e.from}:${e.port}`}>
                <path className="hit" d={d} onClick={() => set((g) => { g.edges = g.edges.filter((x) => !(x.from === e.from && x.port === e.port)); })}><title>Click to remove this connection</title></path>
                <path d={d} style={hot ? { stroke: '#6366f1', strokeWidth: 2.5 } : undefined} />
                {hot && <path className="flow" d={d} />}
              </g>
            );
          })}
          {wire && pts[`${wire.from}:${wire.port}`] && <path className="draft" d={path(pts[`${wire.from}:${wire.port}`], [wire.x, wire.y])} />}
        </svg>
        {f.nodes.map((n) => {
          const [label, ic, color] = NT[n.type], ports = portsOf(n);
          return (
            <div key={n.id} data-id={n.id} className={`wfb-node ${sel === n.id ? 'sel' : ''} ${bad.has(n.id) ? 'bad' : ''} ${now === n.id ? 'now' : ''} ${over === n.id && wire ? 'drop' : ''}`} style={{ left: n.x, top: n.y }} onPointerDown={(e) => { if (!e.target.closest('.wfb-dot')) setSel(n.id); }}>
              {n.type !== 'start' && <span className="wfb-in" />}
              <div className="wfb-nh" onPointerDown={(e) => { if (e.button !== 0 || e.target.closest('button')) return; e.stopPropagation(); setSel(n.id); setDrag({ kind: 'node', id: n.id, sx: e.clientX, sy: e.clientY, nx: n.x, ny: n.y }); capture(e); }}>
                <span className="k" style={{ background: color }}><Icon name={ic} size={13} /></span><b>{label}</b>
                {n.type !== 'start' && <button className="icon-btn" onClick={() => delNode(n.id)} aria-label="Delete step"><Icon name="x" size={12} /></button>}
              </div>
              <NodeBody n={n} />
              {ports.length > 0 && (
                <div className="wfb-ports">
                  {ports.map(([p, l]) => {
                    const wired = f.edges.some((e) => e.from === n.id && e.port === p);
                    return (
                      <div key={p} className={`wfb-port ${p === 'other' ? 'other' : ''}`}>{l}
                        <span ref={(el) => { dots.current[`${n.id}:${p}`] = el; }} className={`wfb-dot ${wired ? 'wired' : ''}`} title="Drag to the next step"
                          onPointerDown={(e) => { e.stopPropagation(); const [x, y] = toWorld(e); setWire({ from: n.id, port: p, x, y }); setDrag({ kind: 'wire', from: n.id, port: p }); capture(e); }} />
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {f.nodes.length < 3 && <div className="wfb-hint">Drag steps from the left onto the canvas, then drag from a ● to connect them</div>}
      <div className="wfb-zoom">
        <button className="icon-btn" onClick={() => setView((v) => ({ ...v, z: Math.max(0.3, v.z - 0.1) }))} aria-label="Zoom out">−</button>
        <span>{Math.round(view.z * 100)}%</span>
        <button className="icon-btn" onClick={() => setView((v) => ({ ...v, z: Math.min(1.6, v.z + 0.1) }))} aria-label="Zoom in">+</button>
        <button className="btn ghost sm" onClick={fit}>Fit</button>
      </div>
    </div>
  );
}

function NodeBody({ n }) {
  const d = n.data;
  const txt = (s, empty = 'Write the message…') => (s ? <div className="txt">{s}</div> : <div className="txt muted">{empty}</div>);
  switch (n.type) {
    case 'start': return <div className="wfb-nb"><span className="muted" style={{ fontStyle: 'normal' }}>The customer writes on WhatsApp</span></div>;
    case 'message': return <div className="wfb-nb">{d.image && <span className="pill">📷 photo</span>}{txt(d.text)}</div>;
    case 'buttons': case 'list': case 'ask': return <div className="wfb-nb">{txt(d.text)}{n.type === 'ask' && <span className="pill" style={{ justifySelf: 'start' }}>saves {`{{${d.var}}}`}{d.save ? ` → ${d.save.replace('custom:', '')}` : ''}</span>}</div>;
    case 'condition': return <div className="wfb-nb">{d.rules.map((r, i) => <div key={i}>{r.field === 'tag' ? `Tag ${r.op === 'not_has' ? 'is not' : 'is'} “${r.value || '…'}”` : `${r.field.replace('var:', '')} ${r.op} ${r.value}`}</div>)}</div>;
    case 'tag': return <div className="wfb-nb"><div className="row">{d.add.length ? d.add.map((t) => <span key={t} className="tag">{t}</span>) : <span className="muted">Choose a tag…</span>}</div></div>;
    case 'ai_route': return <div className="wfb-nb"><span className="ai-txt" style={{ fontSize: 12 }}>✦ AI reads the message and picks a topic</span></div>;
    case 'ai_agent': return <div className="wfb-nb"><span className="ai-txt" style={{ fontSize: 12 }}>✦ The AI agent continues the chat</span>{d.note && <div className="txt">{d.note}</div>}</div>;
    case 'handoff': return <div className="wfb-nb">{txt(d.text, 'No message — just notifies your team')}</div>;
    case 'wait': return <div className="wfb-nb">Wait {d.minutes >= 60 ? `${Math.round((d.minutes / 60) * 10) / 10} h` : `${d.minutes} min`}</div>;
    case 'webhook': return <div className="wfb-nb">{txt(d.url, 'https://…')}</div>;
    case 'end': return <div className="wfb-nb">{txt(d.text, 'Ends quietly')}{d.resolve && <span className="pill ok" style={{ justifySelf: 'start' }}>resolves the chat</span>}</div>;
    default: return null;
  }
}

const VARS = ['first_name', 'name', 'business'];
function TextField({ label, value, onChange, f, rows = 4, max = 1024 }) {
  const ref = useRef();
  const asked = [...new Set(f.nodes.filter((n) => n.type === 'ask').map((n) => n.data.var))].filter((v) => !VARS.includes(v));
  const insert = (v) => { const el = ref.current, s = el.selectionStart ?? value.length; onChange(`${value.slice(0, s)}{{${v}}}${value.slice(el.selectionEnd ?? s)}`); };
  return (
    <label>{label}
      <textarea ref={ref} rows={rows} maxLength={max} value={value} onChange={(e) => onChange(e.target.value)} placeholder="Hi {{first_name}}! 👋 …" />
      <span className="vars">{[...VARS, ...asked].map((v) => <button type="button" key={v} onClick={() => insert(v)}>{`{{${v}}}`}</button>)}</span>
    </label>
  );
}
// a list of options (buttons / list rows / AI topics): renaming keeps the connection, removing drops it
function Options({ items, max, titleMax, onChange, f, nodeId, fields = [['title', 'Title']] }) {
  const drop = (o) => { onChange(items.filter((x) => x !== o), o.id); };
  return (
    <div style={{ display: 'grid', gap: 6 }}>
      {items.map((o, i) => (
        <div key={o.id} className="opt" style={{ gridTemplateColumns: fields.length > 1 ? '1fr 1.3fr auto' : '1fr auto' }}>
          {fields.map(([k, ph]) => <input key={k} value={o[k] || ''} maxLength={k === 'title' || k === 'label' ? titleMax : 200} placeholder={ph} onChange={(e) => onChange(items.map((x, j) => (j === i ? { ...x, [k]: e.target.value } : x)))} />)}
          <button className="icon-btn danger" onClick={() => drop(o)} aria-label="Remove"><Icon name="trash" size={14} /></button>
        </div>
      ))}
      {items.length < max && <button className="btn ghost sm" onClick={() => onChange([...items, { id: rid('o'), [fields[0][0]]: '' }])}><Icon name="plus" size={13} />Add</button>}
    </div>
  );
}

function Inspector({ n, f, set, setNode, onDelete }) {
  const d = n.data;
  const up = (fn) => setNode(n.id, (x) => fn(x.data));
  const opts = (key) => (list, removedId) => set((g) => { const x = g.nodes.find((y) => y.id === n.id); x.data[key] = list; if (removedId) g.edges = g.edges.filter((e) => !(e.from === n.id && e.port === removedId)); });
  const [label, ic, color, desc] = NT[n.type];
  return (
    <>
      <div className="row" style={{ gap: 10 }}><span className="k" style={{ width: 32, height: 32, borderRadius: 10, display: 'grid', placeItems: 'center', color: '#fff', background: color }}><Icon name={ic} size={16} /></span><div style={{ flex: 1 }}><b>{label}</b><div className="hint" style={{ margin: 0 }}>{desc}</div></div>{n.type !== 'start' && <button className="icon-btn danger" onClick={onDelete} aria-label="Delete step"><Icon name="trash" size={16} /></button>}</div>
      {n.type === 'start' && <FlowSettings f={f} set={set} probs={problemsOf(f)} compact />}
      {['message', 'buttons', 'list', 'ask', 'handoff', 'end'].includes(n.type) && <TextField label={n.type === 'handoff' ? 'Message to the customer (optional)' : n.type === 'end' ? 'Last message (optional)' : 'Message'} value={d.text || ''} onChange={(v) => up((x) => { x.text = v; })} f={f} />}
      {n.type === 'message' && <label>Photo link (optional)<input value={d.image || ''} onChange={(e) => up((x) => { x.image = e.target.value; })} placeholder="https://…/menu.jpg" /></label>}
      {n.type === 'buttons' && <label>Buttons <span className="muted">(up to 3, 20 characters)</span><Options items={d.buttons} max={3} titleMax={20} onChange={opts('buttons')} /></label>}
      {n.type === 'list' && <>
        <label>Menu button text<input value={d.button} maxLength={20} onChange={(e) => up((x) => { x.button = e.target.value; })} /></label>
        <label>Options <span className="muted">(up to 10)</span><Options items={d.rows} max={10} titleMax={24} fields={[['title', 'Title'], ['desc', 'Description (optional)']]} onChange={opts('rows')} /></label>
      </>}
      {n.type === 'ask' && <>
        <label>Check the answer is<select value={d.validate} onChange={(e) => up((x) => { x.validate = e.target.value; })}><option value="text">Any text</option><option value="email">An email</option><option value="phone">A phone number</option><option value="number">A number</option><option value="date">A date</option></select></label>
        <label>Remember it as<input value={d.var} onChange={(e) => up((x) => { x.var = e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 31); })} /></label>
        <label>Also save on the contact<select value={d.save} onChange={(e) => up((x) => { x.save = e.target.value; })}><option value="">Don’t save</option><option value="name">Name</option><option value="email">Email</option><option value="phone">Phone</option></select></label>
        <label>If the answer doesn’t fit (optional)<input value={d.retry || ''} onChange={(e) => up((x) => { x.retry = e.target.value; })} placeholder="Please send a valid email 🙏" /></label>
      </>}
      {n.type === 'condition' && <>
        <label>Match<select value={d.match} onChange={(e) => up((x) => { x.match = e.target.value; })}><option value="all">All rules</option><option value="any">Any rule</option></select></label>
        {d.rules.map((r, i) => (
          <div key={i} className="ib-ai" style={{ background: 'var(--c-surface-2)', border: '1px solid var(--c-line)' }}>
            <select value={r.field.startsWith('var:') ? 'var' : r.field} onChange={(e) => up((x) => { x.rules[i].field = e.target.value === 'var' ? 'var:answer' : e.target.value; x.rules[i].op = e.target.value === 'tag' ? 'has' : 'eq'; })}><option value="tag">Contact tag</option><option value="var">An answer</option><option value="email">Email</option><option value="name">Name</option><option value="last_message">Last message</option></select>
            {r.field.startsWith('var:') && <input value={r.field.slice(4)} onChange={(e) => up((x) => { x.rules[i].field = `var:${e.target.value}`; })} placeholder="answer name" />}
            <select value={r.op} onChange={(e) => up((x) => { x.rules[i].op = e.target.value; })}>{(r.field === 'tag' ? [['has', 'has'], ['not_has', 'doesn’t have']] : [['eq', 'is'], ['neq', 'is not'], ['contains', 'contains'], ['exists', 'is filled'], ['missing', 'is empty']]).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
            {!['exists', 'missing'].includes(r.op) && <input value={r.value} onChange={(e) => up((x) => { x.rules[i].value = e.target.value; })} placeholder="value" />}
            <button className="btn ghost sm" onClick={() => up((x) => { x.rules.splice(i, 1); })}>Remove rule</button>
          </div>
        ))}
        <button className="btn ghost sm" onClick={() => up((x) => { x.rules.push({ field: 'tag', op: 'has', value: '' }); })}><Icon name="plus" size={13} />Add rule</button>
      </>}
      {n.type === 'tag' && <label>Tags <span className="muted">(comma between them)</span><input defaultValue={d.add.join(', ')} onBlur={(e) => up((x) => { x.add = e.target.value.split(',').map((t) => t.trim()).filter(Boolean).slice(0, 10); })} placeholder="hot-lead, diwali-offer" /><span className="hint">An automation can start when a tag is added (Automations → “A tag is added”).</span></label>}
      {n.type === 'ai_route' && <label>Topics <span className="muted">(the AI picks one; describe each so it can tell them apart)</span><Options items={d.intents} max={8} titleMax={40} fields={[['label', 'Topic'], ['desc', 'What it means']]} onChange={opts('intents')} /></label>}
      {n.type === 'ai_agent' && <><label>Extra instruction for the AI (optional)<textarea rows={3} value={d.note} onChange={(e) => up((x) => { x.note = e.target.value; })} placeholder="They want to buy — share the right link and ask for their city." /></label><p className="hint">The AI agent answers from what you set up in <Link to="/chatbots?tab=agent">AI agent</Link>, and hands over to your team when it should.</p></>}
      {n.type === 'handoff' && <label>Note for your team (optional)<input value={d.note} onChange={(e) => up((x) => { x.note = e.target.value; })} placeholder="Hot lead — call them today" /></label>}
      {n.type === 'wait' && <label>Wait for (minutes)<input type="number" min={1} max={1380} value={d.minutes} onChange={(e) => up((x) => { x.minutes = Number(e.target.value) || 1; })} /><span className="hint">Up to 23 hours — WhatsApp only allows free replies for 24 hours after the customer’s last message.</span></label>}
      {n.type === 'webhook' && <label>Send the answers to<input value={d.url} onChange={(e) => up((x) => { x.url = e.target.value; })} placeholder="https://hooks.zapier.com/…" /><span className="hint">We POST the contact’s name, phone and every answer as JSON — for Zapier, Pabbly, Make or your own app.</span></label>}
      {n.type === 'end' && <label className="tog"><input type="checkbox" checked={!!d.resolve} onChange={(e) => up((x) => { x.resolve = e.target.checked; })} /><span />Mark the chat resolved</label>}
    </>
  );
}

function FlowSettings({ f, set, probs, onPick, compact }) {
  const t = f.trigger;
  return (
    <>
      {!compact && <><b>Chatbot settings</b><p className="hint" style={{ margin: 0 }}>Click a step on the canvas to edit it. Drag from a ● to connect steps; click a line to remove it. Delete removes the selected step, Ctrl+S saves.</p></>}
      <label>Starts when
        <select value={t.type} onChange={(e) => set((g) => { g.trigger.type = e.target.value; })}>{Object.entries(TRIG).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
      </label>
      {t.type === 'keyword' && <>
        <label>Keywords <span className="muted">(comma between them)</span><input defaultValue={t.keywords.join(', ')} onBlur={(e) => set((g) => { g.trigger.keywords = e.target.value.split(',').map((k) => k.trim().toLowerCase()).filter(Boolean).slice(0, 20); })} placeholder="hi, price, menu" /></label>
        <label className="tog"><input type="checkbox" checked={t.match === 'exact'} onChange={(e) => set((g) => { g.trigger.match = e.target.checked ? 'exact' : 'contains'; })} /><span />Only when the whole message is the keyword</label>
      </>}
      {t.type === 'welcome' && <p className="hint">Runs once, for someone messaging you for the first time. Only one welcome chatbot can be live.</p>}
      {t.type === 'default' && <p className="hint">Answers any message that no keyword chatbot or person is handling. Only one can be live.</p>}
      {t.type === 'manual' && <p className="hint">Start it on a chat from the inbox (Reply → ☰ → Run a chatbot here).</p>}
      <p className="hint">Anyone can type “talk to a person” to reach your team, and a person replying in the inbox always pauses the chatbot.</p>
      {!compact && probs.length > 0 && <div className="wfb-probs"><b className="sm">To fix before going live</b>{probs.map((p, i) => <button key={i} onClick={() => onPick(p.node)}>⚠ {p.msg}</button>)}</div>}
    </>
  );
}

// the builder's test phone: runs the flow on the server as a dry run (nothing is sent or saved)
function TestPhone({ f, onNode }) {
  const [msgs, setMsgs] = useState([]);
  const [st, setSt] = useState(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [tags, setTags] = useState([]);
  const box = useRef();
  useEffect(() => { box.current && (box.current.scrollTop = box.current.scrollHeight); }, [msgs, busy]);
  const FX = { tag: (e) => `🏷 Tagged: ${e.tags.join(', ')}`, save: (e) => `💾 Saved ${e.field}: ${e.value}`, handoff: (e) => `🙋 Handed to your team${e.note ? ` — ${e.note}` : ''}`, webhook: (e) => `🔗 Sent answers to ${e.url}`, route: (e) => `✦ AI picked: ${e.intent}`, agent: () => '✦ The AI agent takes over', end: (e) => (e.resolve ? '✅ Chat resolved' : '— end of chatbot —') };
  const send = async (input, shown) => {
    if (busy) return;
    const next = [...msgs, { dir: 'in', text: shown ?? input.text }];
    setMsgs(next); setText(''); setBusy(true);
    try {
      const r = await api('/waflows/simulate', 'POST', { flow: f, state: st, input, tags, history: next.filter((m) => m.dir && m.text) });
      const add = [...r.out.map((o) => ({ dir: 'out', ...o })), ...r.fx.flatMap((e) => [...(e.type === 'handoff' && e.text ? [{ dir: 'out', kind: 'text', text: e.text }] : []), { fx: FX[e.type]?.(e) }])];
      if (r.agent) add.push({ dir: 'out', ai: true, text: r.agent.reply, buttons: r.agent.buttons.map((b, i) => ({ id: `ai${i}`, title: b })), kind: r.agent.buttons.length ? 'buttons' : 'text' }, ...(r.agent.handoff ? [{ fx: `🙋 AI handed over — ${r.agent.reason}` }] : []));
      else if (r.fx.some((e) => e.type === 'agent')) add.push({ fx: 'AI isn’t switched on — in a real chat your team would be notified' });
      if (r.fx.some((e) => e.type === 'tag')) setTags([...tags, ...r.fx.filter((e) => e.type === 'tag').flatMap((e) => e.tags)]);
      if (!r.out.length && !r.fx.length && !r.agent && !st) add.push({ fx: 'Nothing happens — connect the start to a step' });
      setMsgs([...next, ...add]); setSt(r.state); onNode(r.state?.node || null);
    } catch (e) { toast(e.message); }
    setBusy(false);
  };
  const reset = () => { setMsgs([]); setSt(null); setTags([]); onNode(null); };
  const last = [...msgs].reverse().find((m) => m.dir === 'out');
  const opts = st?.wait === 'reply' && last && (last.kind === 'buttons' || last.kind === 'list') ? (last.buttons || last.rows) : null;
  return (
    <div className="phone">
      <div className="phone-h"><span className="cav sm" style={{ background: '#00a884' }}><Icon name="bot" size={15} /></span><div>Test chat<small>{st?.wait === 'time' ? 'waiting (a real chat would pause here)' : 'nothing is sent to anyone'}</small></div><button className="icon-btn" onClick={reset} title="Start again" aria-label="Start again"><Icon name="undo" size={16} /></button></div>
      <div className="phone-b" ref={box}>
        {!msgs.length && <div className="fxn">Type as your customer would — {f.trigger.type === 'keyword' ? `e.g. “${f.trigger.keywords[0] || 'hi'}”` : '“Hi”'} — to start</div>}
        {msgs.map((m, i) => m.fx ? <div key={i} className="fxn">{m.fx}</div> : (
          <div key={i} className={`bub ${m.dir === 'in' ? 'out' : `in ${m.ai ? '' : ''}`}`} style={m.dir === 'in' ? undefined : m.ai ? { border: '1.5px solid #8b5cf6' } : undefined}>
            {m.ai && <div className="by"><span className="ai-txt">✦ AI agent</span></div>}
            {m.image && <span className="pill">📷 photo</span>}{waFmt(m.text)}
            {m.kind === 'list' && <div className="bub-btns"><span>☰ {m.button}</span></div>}
          </div>
        ))}
        {opts && <div className="opts">{opts.map((o) => <button key={o.id} onClick={() => send({ text: o.title, id: o.id }, o.title)}>{o.title}</button>)}</div>}
        {busy && <div className="ctyping"><i /><i /><i /></div>}
      </div>
      <form className="phone-f" onSubmit={(e) => { e.preventDefault(); if (text.trim()) send({ text: text.trim() }); }}>
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Message" />
        <button aria-label="Send"><Icon name="send" size={16} /></button>
      </form>
    </div>
  );
}

// ---------- the AI agent ----------
const pickA = (x) => ({ on: x.on, auto: x.auto, name: x.name, tone: x.tone, knowledge: x.knowledge, faqs: x.faqs, capture: x.capture, handoff: x.handoff });
const TONES = [['friendly', 'Friendly'], ['professional', 'Professional'], ['fun', 'Fun & lively'], ['calm', 'Calm & caring']];
function Agent() {
  const [a, setA] = useState(null);
  const [saved, setSaved] = useState('');
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState('');
  useEffect(() => { api('/wa-agent').then((x) => { setA(x); setSaved(JSON.stringify(pickA(x))); }).catch((e) => toast(e.message)); }, []);
  if (!a) return <span className="spin dark" />;
  const dirty = JSON.stringify(pickA(a)) !== saved;
  const save = async (patch = {}) => {
    setBusy('save');
    try { const x = await api('/wa-agent', 'PUT', { ...pickA(a), ...patch }); setA(x); setSaved(JSON.stringify(pickA(x))); toast(patch.on === true ? `✦ ${x.name} is answering your WhatsApp` : patch.on === false ? 'AI agent switched off' : 'Saved'); } catch (e) { toast(e.message); }
    setBusy('');
  };
  const learn = async (e) => {
    e.preventDefault();
    setBusy('learn');
    try { const r = await api('/wa-agent/learn', 'POST', { url }); setA({ ...a, knowledge: `${a.knowledge ? `${a.knowledge}\n\n` : ''}From ${r.url}:\n${r.text}`.slice(0, 20000) }); setUrl(''); toast('Added to the knowledge — check it, then save'); } catch (er) { toast(er.message); }
    setBusy('');
  };
  const faq = (i, k, v) => setA({ ...a, faqs: a.faqs.map((x, j) => (j === i ? { ...x, [k]: v } : x)) });
  return (
    <div className="ag cb">
      <div style={{ display: 'grid', gap: 16 }}>
        <Panel>
          <div className="ag-id">
            <span className={`ag-orb ${a.on ? 'on' : ''}`}><Icon name="sparkles" size={26} /></span>
            <div style={{ flex: 1 }}>
              <b style={{ fontSize: 16 }}>{a.name}</b> <span className={`cb-live ${a.on ? '' : 'off'}`} style={{ marginLeft: 6 }}>{a.on ? 'Answering' : 'Off'}</span>
              <p className="hint" style={{ margin: '2px 0 0' }}>Answers your customers on WhatsApp in their language, day and night — from your offers, prices and FAQs — and passes the chat to your team when a person is needed.</p>
            </div>
            {a.on ? <button className="btn ghost" onClick={() => save({ on: false })} disabled={!!busy}>Switch off</button> : <button className="btn ai" onClick={() => save({ on: true })} disabled={!!busy || !a.ai}><Icon name="play" size={14} />Switch on</button>}
          </div>
          {!a.ai && <p className="hint">AI isn’t switched on for this account yet.</p>}
        </Panel>
        <Panel title="Personality">
          <div style={{ display: 'grid', gap: 12 }}>
            <label className="sm strong">Name<input value={a.name} maxLength={40} onChange={(e) => setA({ ...a, name: e.target.value })} /></label>
            <div className="sm strong">Tone<div className="tones" style={{ marginTop: 6 }}>{TONES.map(([k, l]) => <button key={k} className={a.tone === k ? 'on' : ''} onClick={() => setA({ ...a, tone: k })}>{l}</button>)}</div></div>
            <label className="tog"><input type="checkbox" checked={a.auto} onChange={(e) => setA({ ...a, auto: e.target.checked })} /><span />Answer new chats automatically <small className="muted">· off: only when a chatbot or your team hands a chat to it</small></label>
            <label className="tog"><input type="checkbox" checked={a.capture} onChange={(e) => setA({ ...a, capture: e.target.checked })} /><span />Ask for their name and email (saved on the contact)</label>
          </div>
        </Panel>
        <Panel title="What it knows">
          <div style={{ display: 'grid', gap: 12 }}>
            <label className="sm strong">About your business — offers, prices, timings, address, policies, how to pay
              <textarea rows={9} value={a.knowledge} maxLength={20000} onChange={(e) => setA({ ...a, knowledge: e.target.value })} placeholder={'We run online yoga classes for working women.\nBatches: 6:30 am and 7 pm, Mon–Fri.\nMonthly plan ₹999, quarterly ₹2,499.\nFree trial class every Saturday.\nRefunds within 7 days if you haven’t attended.'} />
              <span className="hint">{a.knowledge.length.toLocaleString('en-IN')} / 20,000 characters</span>
            </label>
            <form className="row" onSubmit={learn} style={{ flexWrap: 'nowrap' }}><input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://yourbusiness.in/about — read a page of your website" /><button className="btn ghost" disabled={!url || busy === 'learn'}>{busy === 'learn' ? <span className="spin dark" /> : <Icon name="globe" size={14} />}Read page</button></form>
            <div className="sm strong">Questions people ask</div>
            {a.faqs.map((x, i) => (
              <div key={i} className="ag-faq">
                <input value={x.q} onChange={(e) => faq(i, 'q', e.target.value)} placeholder="Do you have weekend batches?" />
                <textarea rows={2} value={x.a} onChange={(e) => faq(i, 'a', e.target.value)} placeholder="Yes — Saturday and Sunday at 8 am." />
                <button className="icon-btn danger" onClick={() => setA({ ...a, faqs: a.faqs.filter((_, j) => j !== i) })} aria-label="Remove"><Icon name="trash" size={15} /></button>
              </div>
            ))}
            <button className="btn ghost sm" style={{ justifySelf: 'start' }} onClick={() => setA({ ...a, faqs: [...a.faqs, { q: '', a: '' }] })}><Icon name="plus" size={13} />Add a question</button>
            <div className="sm strong">Already learned from your account <span className="muted" style={{ fontWeight: 400 }}>· your live funnels and products, kept up to date</span></div>
            <pre className="ag-learned">{a.learned || 'Nothing yet — publish a funnel or add a product and it’s picked up automatically.'}</pre>
          </div>
        </Panel>
        <Panel title="When to hand over to your team">
          <textarea rows={3} value={a.handoff} maxLength={1000} onChange={(e) => setA({ ...a, handoff: e.target.value })} placeholder="Bulk or corporate orders, anyone asking for a discount above 10%, and any medical question." />
          <p className="hint">It always hands over for complaints, refunds, payment problems, or when someone asks for a person — your team gets a notification and the chat waits in the inbox.</p>
        </Panel>
        <div className="row" style={{ position: 'sticky', bottom: 12 }}><button className="btn primary lg" onClick={() => save()} disabled={!dirty || !!busy}>{busy === 'save' ? <span className="spin" /> : null}{dirty ? 'Save changes' : 'All changes saved'}</button></div>
      </div>
      <AgentPhone a={pickA(a)} name={a.name} ai={a.ai} />
    </div>
  );
}
function AgentPhone({ a, name, ai }) {
  const [msgs, setMsgs] = useState([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const box = useRef();
  useEffect(() => { box.current && (box.current.scrollTop = box.current.scrollHeight); }, [msgs, busy]);
  const send = async (t) => {
    if (!t || busy) return;
    const next = [...msgs, { dir: 'in', text: t }];
    setMsgs(next); setText(''); setBusy(true);
    try {
      const r = await api('/wa-agent/test', 'POST', { agent: a, messages: next.filter((m) => m.dir) });
      setMsgs([...next, { dir: 'out', text: r.reply, buttons: r.buttons }, ...(r.handoff ? [{ fx: `🙋 Would hand over to your team — ${r.reason || 'needs a person'}` }] : []), ...(r.lead?.email ? [{ fx: `💾 Would save email: ${r.lead.email}` }] : [])]);
    } catch (e) { toast(e.message); }
    setBusy(false);
  };
  const lastBtns = msgs.at(-1)?.buttons;
  return (
    <div className="phone">
      <div className="phone-h"><span className="cav sm" style={{ background: AI_BG }}><Icon name="sparkles" size={15} /></span><div>{name}<small>Test chat · uses your unsaved changes</small></div><button className="icon-btn" onClick={() => setMsgs([])} aria-label="Start again" title="Start again"><Icon name="undo" size={16} /></button></div>
      <div className="phone-b" ref={box}>
        {!msgs.length && <div className="fxn">{ai ? 'Ask what your customers ask — “What’s the price?”, “Kal ka slot milega?”' : 'AI isn’t switched on for this account'}</div>}
        {msgs.map((m, i) => m.fx ? <div key={i} className="fxn">{m.fx}</div> : <div key={i} className={`bub ${m.dir === 'in' ? 'out' : 'in'}`}>{waFmt(m.text)}</div>)}
        {lastBtns?.length > 0 && <div className="opts">{lastBtns.map((b) => <button key={b} onClick={() => send(b)}>{b}</button>)}</div>}
        {busy && <div className="ctyping"><i /><i /><i /></div>}
      </div>
      <form className="phone-f" onSubmit={(e) => { e.preventDefault(); send(text.trim()); }}>
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Message" disabled={!ai} />
        <button aria-label="Send" disabled={!ai}><Icon name="send" size={16} /></button>
      </form>
    </div>
  );
}
