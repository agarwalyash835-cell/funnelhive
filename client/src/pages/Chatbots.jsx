import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { Layout, Panel, Icon, Modal, toast, confirmDialog } from '../ui';
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
    const words = [d.text, d.button, ...(d.buttons || []).map((b) => b.title), ...(d.rows || []).flatMap((r) => [r.title, r.desc])].filter(Boolean).join(' ');
    const ph = /\[[^\]\n]{2,}\]/.exec(words);
    if (ph) bad(n.id, `${NT[n.type][0]}: fill in ${ph[0]}`);
  }
  return out;
}
const triggerText = (t) => (t.type === 'keyword' ? (t.keywords.length ? `Keywords: ${t.keywords.join(', ')}` : 'No keywords yet') : TRIG[t.type]);

export default function Chatbots() {
  const { id } = useParams();
  const [sp, setSp] = useSearchParams();
  const tab = ['agent', 'rules'].includes(sp.get('tab')) ? sp.get('tab') : 'bots';
  const [ind, setInd] = useState(null); // whose industry's ready-made chatbots are shown
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
        <button className={tab === 'rules' ? 'on' : ''} onClick={() => setSp({ tab: 'rules' })}><Icon name="bolt" size={14} />Inbox automations</button>
      </div>
      {d && !d.connected && <div className="app-banner info" style={{ margin: 0 }}><Icon name="chat" size={15} /><span>Connect your Hive WhatsApp number in Settings → Channels so chatbots can reply to real customers. You can build and test them now.</span><Link to="/settings">Settings</Link></div>}
      {tab === 'agent' ? <Agent /> : tab === 'rules' ? <InboxRules /> : !d ? <span className="spin dark" /> : (
        <>
          <AiDraft ai={d.ai} onDraft={(f) => { setDraft(f); nav('/chatbots/new'); }} />
          {d.flows.length > 0 && (
            <Panel title="Your chatbots">
              <div className="cb-grid">
                {d.flows.map((f) => <FlowCard key={f.id} f={f} onOpen={() => nav(`/chatbots/${f.id}`)} onChange={load} />)}
              </div>
            </Panel>
          )}
          {(() => {
            const cur = d.industries?.find((x) => x.id === (ind || d.industry)) || d.industries?.[0];
            return cur && (
              <Panel title={<>Ready-made for {cur.icon} {cur.name}</>} actions={<div className="ind-pick"><select value={cur.id} onChange={(e) => setInd(e.target.value)} aria-label="Industry">{d.industries.map((x) => <option key={x.id} value={x.id}>{x.icon} {x.name}{x.id === d.industry ? ' (your industry)' : ''}</option>)}</select></div>}>
                <p className="hint top">Written for your industry — your answers, questions and booking words. Fill in the details in [brackets], test it on the phone, then go live.</p>
                <div className="cb-grid">
                  {cur.templates.map((t) => (
                    <button key={t.id} className="cb-card" onClick={() => create(t.id)}>
                      <span className="ic"><Icon name={t.icon} size={18} /></span>
                      <b>{t.title}</b><small>{t.desc}</small>
                    </button>
                  ))}
                </div>
              </Panel>
            );
          })()}
          <Panel title="Ready-made for any business" actions={<button className="btn ghost sm" onClick={() => create('')}><Icon name="plus" size={14} />Blank chatbot</button>}>
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
      <div className="row"><span className={`cb-live ${f.active ? '' : 'idle'}`}>{f.trigger.type === 'manual' ? 'Manual' : f.active ? 'Live' : 'Off'}</span><span className="row" style={{ gap: 2 }}>{f.trigger.type !== 'manual' && <button className="btn ghost sm" onClick={toggle}>{f.active ? 'Switch off' : 'Go live'}</button>}<button className="icon-btn danger" onClick={del} aria-label="Delete"><Icon name="trash" size={15} /></button></span></div>
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
        {f.trigger.type !== 'manual' && <span className={`cb-live ${active ? '' : 'idle'}`}>{active ? 'Live' : 'Off'}</span>}
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
      if (r.agent) add.push({ dir: 'out', ai: true, text: r.agent.reply, buttons: r.agent.buttons.map((b, i) => ({ id: `ai${i}`, title: b })), kind: r.agent.buttons.length ? 'buttons' : 'text' }, ...(r.agent.sendNames || []).map((n) => ({ fx: `📎 Would send: ${n}` })), ...(r.agent.handoff ? [{ fx: `🙋 AI handed over — ${r.agent.reason}` }] : []));
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
          <div key={i} className={`bub ${m.dir === 'in' ? 'b-out' : 'b-in'}`} style={m.dir === 'in' ? undefined : m.ai ? { border: '1.5px solid #8b5cf6' } : undefined}>
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
const pickA = (x) => ({ on: x.on, auto: x.auto, name: x.name, role: x.role, tone: x.tone, knowledge: x.knowledge, faqs: x.faqs, capture: x.capture, handoff: x.handoff });
const TONES = [['friendly', 'Friendly'], ['professional', 'Professional'], ['fun', 'Fun & lively'], ['calm', 'Calm & caring']];
function Agent() {
  const [a, setA] = useState(null);
  const [saved, setSaved] = useState('');
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState('');
  const [preset, setPreset] = useState('general');
  useEffect(() => { api('/wa-agent').then((x) => { setA(x); setPreset(x.industry || 'general'); setSaved(JSON.stringify(pickA(x))); }).catch((e) => toast(e.message)); }, []);
  if (!a) return <span className="spin dark" />;
  const dirty = JSON.stringify(pickA(a)) !== saved;
  const placeholders = [a.knowledge, ...a.faqs.map((f) => f.a)].join('\n').match(/\[[^\]\n]{2,}\]/g)?.length || 0;
  const usePreset = async () => {
    if ((a.knowledge.trim() || a.faqs.length) && !await confirmDialog({ title: 'Replace what the agent knows?', text: 'Its name, role, knowledge, questions and hand-over rules are replaced with the industry outline. Nothing is saved until you press Save.', confirm: 'Replace' })) return;
    setBusy('preset');
    try { const p = await api(`/wa-agent/preset/${preset}`); setA({ ...a, ...p }); toast('Filled in — replace the [brackets] with your details'); } catch (e) { toast(e.message); }
    setBusy('');
  };
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
              <b style={{ fontSize: 16 }}>{a.name}</b> <span className={`cb-live ${a.on ? '' : 'idle'}`} style={{ marginLeft: 6 }}>{a.on ? 'Answering' : 'Off'}</span>
              <p className="hint" style={{ margin: '2px 0 0' }}>Answers your customers on WhatsApp in their language, day and night — from your offers, prices and FAQs — and passes the chat to your team when a person is needed.</p>
            </div>
            {a.on ? <button className="btn ghost" onClick={() => save({ on: false })} disabled={!!busy}>Switch off</button> : <button className="btn ai" onClick={() => save({ on: true })} disabled={!!busy || !a.ai}><Icon name="play" size={14} />Switch on</button>}
          </div>
          {!a.ai && <p className="hint">AI isn’t switched on for this account yet.</p>}
        </Panel>
        <Panel title="Start from your industry">
          <div className="ind-pick">
            <select value={preset} onChange={(e) => setPreset(e.target.value)} aria-label="Industry">{a.presets.map((x) => <option key={x.id} value={x.id}>{x.icon} {x.name}{x.id === a.industry ? ' (your industry)' : ''}</option>)}</select>
            <button className="btn ghost" onClick={usePreset} disabled={busy === 'preset'}>{busy === 'preset' ? <span className="spin dark" /> : <Icon name="wand" size={14} />}Fill in for this industry</button>
          </div>
          <p className="hint">Sets the agent’s name, role, a knowledge outline, the questions your customers usually ask and when to hand over — written for that industry. Replace the [brackets] with your details, test it on the phone, then save.</p>
        </Panel>
        <Panel title="Personality">
          <div style={{ display: 'grid', gap: 12 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.4fr', gap: 10 }}>
              <label className="sm strong">Name<input value={a.name} maxLength={40} onChange={(e) => setA({ ...a, name: e.target.value })} /></label>
              <label className="sm strong">Role<input value={a.role || ''} maxLength={60} onChange={(e) => setA({ ...a, role: e.target.value })} placeholder="e.g. admissions counsellor, property advisor" /></label>
            </div>
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
              {placeholders > 0 && <span className="hint" style={{ color: 'var(--c-warn)' }}>⚠ {placeholders} detail{placeholders > 1 ? 's' : ''} still in [brackets] — the agent treats {placeholders > 1 ? 'them' : 'it'} as unknown until you fill {placeholders > 1 ? 'them' : 'it'} in.</span>}
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
        <AgentDocs />
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
      setMsgs([...next,
        ...(r.found?.passages?.length || r.found?.products ? [{ fx: `🔎 Found: ${[...r.found.passages.slice(0, 2), r.found.products ? `${r.found.products} products` : ''].filter(Boolean).join(', ')}` }] : []),
        { dir: 'out', text: r.reply, buttons: r.buttons },
        ...(r.sendNames || []).map((n) => ({ fx: `📎 Would send: ${n}` })),
        ...(r.facts || []).map((f) => ({ fx: `🧠 Would remember: ${f}` })),
        ...(r.handoff ? [{ fx: `🙋 Would hand over to your team — ${r.reason || 'needs a person'}` }] : []), ...(r.lead?.email ? [{ fx: `💾 Would save email: ${r.lead.email}` }] : [])]);
    } catch (e) { toast(e.message); }
    setBusy(false);
  };
  const lastBtns = msgs.at(-1)?.buttons;
  return (
    <div className="phone">
      <div className="phone-h"><span className="cav sm" style={{ background: AI_BG }}><Icon name="sparkles" size={15} /></span><div>{name}<small>Test chat · uses your unsaved changes</small></div><button className="icon-btn" onClick={() => setMsgs([])} aria-label="Start again" title="Start again"><Icon name="undo" size={16} /></button></div>
      <div className="phone-b" ref={box}>
        {!msgs.length && <div className="fxn">{ai ? 'Ask what your customers ask — “What’s the price?”, “Kal ka slot milega?”' : 'AI isn’t switched on for this account'}</div>}
        {msgs.map((m, i) => m.fx ? <div key={i} className="fxn">{m.fx}</div> : <div key={i} className={`bub ${m.dir === 'in' ? 'b-out' : 'b-in'}`}>{waFmt(m.text)}</div>)}
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

// ---------- the agent's documents and catalogues (Vault files it reads, searches and can send) ----------
const DOC_STATUS = { queued: ['Waiting', ''], processing: ['Reading…', 'warn'], ready: ['Ready', 'ok'], failed: ['Couldn’t read', 'bad'] };
const kb = (n) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
function AgentDocs() {
  const [d, setD] = useState(null);
  const [pick, setPick] = useState(null); // Vault files to choose from
  const [chosen, setChosen] = useState([]);
  const [kind, setKind] = useState('catalogue');
  const [busy, setBusy] = useState('');
  const [prods, setProds] = useState(null);
  const [q, setQ] = useState('');
  const [found, setFound] = useState(null);
  const fileIn = useRef();
  const load = () => api('/wa-agent/docs').then(setD).catch(() => {});
  useEffect(() => { load(); }, []);
  // while files are being read, refresh every few seconds
  useEffect(() => {
    if (!d?.docs.some((x) => ['queued', 'processing'].includes(x.status) || (x.status === 'ready' && d.search === 'smart' && !x.vectors && x.chunks))) return undefined;
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [d]);
  const act = async (fn, msg) => { try { const r = await fn(); if (r?.docs) setD((x) => ({ ...x, docs: r.docs })); if (msg) toast(msg); } catch (e) { toast(e.message); } };
  const openPicker = async () => { try { const r = await api('/vault/files'); setPick((Array.isArray(r) ? r : r.files || []).filter((f) => !d.docs.some((x) => x.fileId === f.id))); setChosen([]); } catch (e) { toast(e.message); } };
  const add = () => act(() => api('/wa-agent/docs', 'POST', { fileIds: chosen, kind }), `${chosen.length} file${chosen.length > 1 ? 's' : ''} added — reading now`).then(() => setPick(null));
  // new files go to the Vault folder "AI agent knowledge" first, then to the agent
  const upload = async (files) => {
    if (!files.length) return;
    setBusy('up');
    try {
      const { folderId } = await api('/wa-agent/folder');
      const ids = [];
      for (const f of files) {
        if (f.size > 15 * 1024 * 1024) { toast(`${f.name} is over 15 MB`); continue; }
        const r = await fetch(`/api/vault/files?folder=${folderId}`, { method: 'POST', headers: { Authorization: `Bearer ${localStorage.getItem('ff_token')}`, 'Content-Type': 'application/octet-stream', 'X-File-Name': encodeURIComponent(f.name) }, body: f });
        const x = await r.json();
        if (!r.ok) { toast(x.error || `Couldn’t upload ${f.name}`); continue; }
        ids.push(x.id);
      }
      if (ids.length) await act(() => api('/wa-agent/docs', 'POST', { fileIds: ids, kind }), `${ids.length} file${ids.length > 1 ? 's' : ''} uploaded — reading now`);
    } catch (e) { toast(e.message); }
    setBusy('');
  };
  const search = async (e) => { e.preventDefault(); if (!q.trim()) return; setBusy('q'); try { setFound(await api('/wa-agent/search', 'POST', { q })); } catch (er) { toast(er.message); } setBusy(''); };
  if (!d) return null;
  return (
    <Panel title="Catalogues & documents" actions={<span className="pill" title={d.search === 'smart' ? 'Finds answers by meaning, in any language' : 'Finds answers by matching words'}>{d.search === 'smart' ? '✦ Smart search' : 'Keyword search'}</span>}>
      <p className="hint top">Price lists, catalogues, brochures, policies — PDF, Word, Excel, PowerPoint or CSV, up to 15 MB each. The agent reads them, answers from the right page, and can send the file itself on WhatsApp. Catalogues also get their products listed (name, code, price).</p>
      <div className="row" style={{ marginBottom: 12 }}>
        <select value={kind} onChange={(e) => setKind(e.target.value)} style={{ width: 'auto' }} aria-label="Type"><option value="catalogue">Catalogue / price list</option><option value="document">Document (FAQs, policies…)</option></select>
        <button className="btn primary sm" onClick={() => fileIn.current?.click()} disabled={busy === 'up'}>{busy === 'up' ? <span className="spin" /> : <Icon name="plus" size={14} />}Upload files</button>
        <button className="btn ghost sm" onClick={openPicker}><Icon name="vault" size={14} />Choose from Vault</button>
        <input ref={fileIn} type="file" multiple hidden accept=".pdf,.docx,.xlsx,.pptx,.csv,.txt,.jpg,.jpeg,.png" onChange={(e) => { upload([...e.target.files]); e.target.value = ''; }} />
      </div>
      {!d.docs.length ? <p className="muted sm">No documents yet.</p> : (
        <div style={{ display: 'grid', gap: 8 }}>
          {d.docs.map((x) => {
            const [label, tone] = DOC_STATUS[x.status] || ['', ''];
            return (
              <div key={x.id} className="kdoc">
                <span className="kdoc-ic">{x.kind === 'catalogue' ? '📒' : '📄'}</span>
                <div className="kdoc-b">
                  <b>{x.name}</b>
                  <small>{x.status === 'ready' ? [x.pages && `${x.pages} page${x.pages > 1 ? 's' : ''}`, `${x.chunks} passage${x.chunks === 1 ? '' : 's'}`, x.products ? `${x.products} products` : '', d.search === 'smart' ? (x.vectors ? 'smart search ✓' : 'smart search pending…') : ''].filter(Boolean).join(' · ') : x.error || (x.status === 'processing' ? 'Reading the file…' : 'In the queue')}{x.size ? ` · ${kb(x.size)}` : ''}</small>
                  {x.summary && <small className="muted">{x.summary}</small>}
                  {x.note && <small style={{ color: 'var(--c-warn)' }}>{x.note}</small>}
                </div>
                <span className={`pill ${tone}`}>{x.status === 'processing' && <span className="spin dark" style={{ width: 10, height: 10 }} />}{label}</span>
                <label className="tog mini" title="The agent may send this file to customers"><input type="checkbox" checked={x.send} onChange={(e) => act(() => api(`/wa-agent/docs/${x.id}`, 'PATCH', { send: e.target.checked }))} /><span />Send</label>
                <select value={x.kind} onChange={(e) => act(() => api(`/wa-agent/docs/${x.id}`, 'PATCH', { kind: e.target.value }), 'Reading it again')} style={{ width: 'auto', height: 30, fontSize: 12 }} aria-label="Type"><option value="catalogue">Catalogue</option><option value="document">Document</option></select>
                {x.products > 0 && <button className="btn ghost sm" onClick={async () => setProds({ name: x.name, list: (await api(`/wa-agent/docs/${x.id}/products`)).products })}>Products</button>}
                <button className="icon-btn" title="Read again" onClick={() => act(() => api(`/wa-agent/docs/${x.id}/reprocess`, 'POST'), 'Reading it again')}><Icon name="redo" size={15} /></button>
                <button className="icon-btn danger" title="Remove from the agent (the file stays in your Vault)" onClick={() => act(() => api(`/wa-agent/docs/${x.id}`, 'DELETE'))}><Icon name="trash" size={15} /></button>
              </div>
            );
          })}
        </div>
      )}
      {d.docs.some((x) => x.status === 'ready') && (
        <form onSubmit={search} style={{ marginTop: 14, display: 'grid', gap: 8 }}>
          <div className="sm strong">Check what the agent finds</div>
          <div className="row" style={{ flexWrap: 'nowrap' }}><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask like a customer: “L shape kitchen ka rate?”" /><button className="btn ghost" disabled={busy === 'q'}>{busy === 'q' ? <span className="spin dark" /> : <Icon name="search" size={14} />}Search</button></div>
          {found && (
            <div className="ib-ai" style={{ background: 'var(--c-surface-2)', border: '1px solid var(--c-line)' }}>
              {found.products.length > 0 && <div><b className="sm">Products</b>{found.products.slice(0, 5).map((p) => <div key={p.id} className="sm">• {p.name}{p.sku ? ` [${p.sku}]` : ''}{p.price != null ? ` — ₹${p.price.toLocaleString('en-IN')}` : ''} <span className="muted">({p.doc}, p.{p.page})</span></div>)}</div>}
              {found.passages.slice(0, 3).map((p, i) => <div key={i} className="sm"><b>{p.doc} · page {p.page}</b><div className="muted" style={{ whiteSpace: 'pre-wrap' }}>{p.text.slice(0, 300)}{p.text.length > 300 ? '…' : ''}</div></div>)}
              {found.docs.length > 0 && <div className="sm"><b>Could send:</b> {found.docs.map((x) => x.name).join(', ')}</div>}
              {!found.passages.length && !found.products.length && <p className="muted sm" style={{ margin: 0 }}>Nothing found — the agent would answer from what you wrote above, or hand over.</p>}
            </div>
          )}
        </form>
      )}
      {pick && (
        <Modal title="Choose from your Vault" onClose={() => setPick(null)} width={560}>
          {!pick.length ? <p className="muted">Every file in your Vault is already here — upload new ones instead.</p> : (
            <div style={{ display: 'grid', gap: 4, maxHeight: 400, overflowY: 'auto' }}>
              {pick.map((f) => <label key={f.id} className="tog" style={{ margin: 0 }}><input type="checkbox" checked={chosen.includes(f.id)} onChange={(e) => setChosen(e.target.checked ? [...chosen, f.id] : chosen.filter((x) => x !== f.id))} /><span />{f.name} <small className="muted">· {kb(f.size)}</small></label>)}
            </div>
          )}
          <div className="row end" style={{ marginTop: 12 }}><button className="btn ghost" onClick={() => setPick(null)}>Cancel</button><button className="btn primary" disabled={!chosen.length} onClick={add}>Add {chosen.length || ''} as {kind === 'catalogue' ? 'catalogues' : 'documents'}</button></div>
        </Modal>
      )}
      {prods && (
        <Modal title={`Products in ${prods.name}`} onClose={() => setProds(null)} width={760}>
          <p className="hint top">Read from the catalogue by AI — the agent quotes these prices. If one is wrong, fix it in the file and press “Read again”.</p>
          <div style={{ maxHeight: 460, overflowY: 'auto' }}>
            <table className="tbl"><thead><tr><th>Product</th><th>Code</th><th className="r">Price</th><th>Details</th><th>Page</th></tr></thead>
              <tbody>{prods.list.map((p) => <tr key={p.id}><td>{p.name}</td><td className="mono">{p.sku || '—'}</td><td className="r">{p.price != null ? `₹${p.price.toLocaleString('en-IN')}` : '—'}{p.unit ? <small className="muted"> {p.unit}</small> : ''}</td><td className="sm">{p.specs}</td><td>{p.page}</td></tr>)}</tbody></table>
          </div>
        </Modal>
      )}
    </Panel>
  );
}

// ---------- inbox automations: rules the inbox runs by itself ----------
const DAY_LABELS = [['mon', 'Mon'], ['tue', 'Tue'], ['wed', 'Wed'], ['thu', 'Thu'], ['fri', 'Fri'], ['sat', 'Sat'], ['sun', 'Sun']];
function Rule({ on, onToggle, icon, color, title, text, children }) {
  return (
    <section className={`rule ${on ? 'on' : ''}`}>
      <div className="rule-h">
        <span className="ic" style={{ background: color }}><Icon name={icon} size={18} /></span>
        <div><b>{title}</b><small>{text}</small></div>
        <label className="tog"><input type="checkbox" checked={on} onChange={(e) => onToggle(e.target.checked)} /><span /></label>
      </div>
      {on && children}
    </section>
  );
}
function InboxRules() {
  const [r, setR] = useState(null);
  const [meta, setMeta] = useState(null);
  const [saved, setSaved] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api('/inbox/rules').then((x) => { setR(x); setSaved(JSON.stringify(x.rules)); }).catch((e) => toast(e.message));
    api('/inbox/meta').then(setMeta).catch(() => {});
  }, []);
  if (!r) return <span className="spin dark" />;
  const ru = r.rules;
  const set = (k, patch) => setR({ ...r, rules: { ...ru, [k]: { ...ru[k], ...patch } } });
  const dirty = JSON.stringify(ru) !== saved;
  const save = async () => { setBusy(true); try { const x = await api('/inbox/rules', 'PUT', ru); setR({ ...r, ...x }); setSaved(JSON.stringify(x.rules)); toast('Inbox automations saved'); } catch (e) { toast(e.message); } setBusy(false); };
  const team = meta?.team || [];
  return (
    <div className="rules cb">
      <p className="hint top" style={{ margin: 0 }}>These run on every WhatsApp chat, next to your chatbots and AI agent. For anything bigger — emails, CRM stages, tags, webhooks — use <Link to="/automations">Automations</Link> with the WhatsApp triggers (“A contact messages you on WhatsApp”, “A chat is handed to your team”, “A chat is resolved”).</p>
      <Rule on={ru.hours.on} onToggle={(v) => set('hours', { on: v, ...(v && !ru.hours.days.length ? { days: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat'] } : {}) })} icon="clock" color="#0ea5e9" title="Business hours & away reply" text={`Outside your hours, a chat waiting for a person gets an automatic reply (once every 12 hours). Right now you’re ${r.open ? 'open' : 'closed'} (${r.timezone}).`}>
        <div className="days">{DAY_LABELS.map(([k, l]) => <button key={k} className={ru.hours.days.includes(k) ? 'on' : ''} onClick={() => set('hours', { days: ru.hours.days.includes(k) ? ru.hours.days.filter((x) => x !== k) : [...ru.hours.days, k] })}>{l}</button>)}</div>
        <div className="grid2"><label>Open from<input type="time" value={ru.hours.from} onChange={(e) => set('hours', { from: e.target.value })} /></label><label>Until<input type="time" value={ru.hours.to} onChange={(e) => set('hours', { to: e.target.value })} /></label></div>
        <label>Away reply<textarea rows={2} maxLength={600} value={ru.hours.away} onChange={(e) => set('hours', { away: e.target.value })} /><span className="hint">{'{{opens}}'} becomes when you next open, e.g. “Mon 9:00 am”. Chatbots and the AI agent keep answering out of hours.</span></label>
      </Rule>
      <Rule on={ru.assign.on} onToggle={(v) => set('assign', { on: v, ...(v && !ru.assign.people.length ? { people: team.map((p) => p.id) } : {}) })} icon="users" color="#8b5cf6" title="Auto-assign chats" text="A chat that needs a person and has no owner goes to the next person in turn (round robin) — they get the notification.">
        <div className="days" style={{ gap: 6 }}>{team.map((p) => <button key={p.id} style={{ width: 'auto', padding: '0 12px' }} className={ru.assign.people.includes(p.id) ? 'on' : ''} onClick={() => set('assign', { people: ru.assign.people.includes(p.id) ? ru.assign.people.filter((x) => x !== p.id) : [...ru.assign.people, p.id] })}>{p.name}</button>)}</div>
        {team.length < 2 && <p className="hint" style={{ margin: 0 }}>Invite your team in Settings → Team to share chats between them.</p>}
      </Rule>
      <Rule on={ru.sla.on} onToggle={(v) => set('sla', { on: v })} icon="bell" color="#f59e0b" title="Reply-time alert" text="When a customer has waited too long for a reply (during business hours), alert your team — or let the AI agent answer.">
        <div className="grid2">
          <label>After (minutes)<input type="number" min={2} max={1440} value={ru.sla.minutes} onChange={(e) => set('sla', { minutes: Number(e.target.value) || 15 })} /></label>
          <label>Then<select value={ru.sla.action} onChange={(e) => set('sla', { action: e.target.value })}><option value="notify">Notify my team</option><option value="ai">Let the AI agent reply{meta?.agent?.on ? '' : ' (switch it on first)'}</option></select></label>
        </div>
      </Rule>
      <Rule on={ru.resolve.on} onToggle={(v) => set('resolve', { on: v })} icon="check" color="#16a34a" title="Close quiet chats" text="When you’ve replied and the customer goes quiet, the chat is marked resolved — your open list stays short. It reopens if they write again.">
        <label style={{ maxWidth: 220 }}>After (hours with no reply)<input type="number" min={1} max={720} value={ru.resolve.hours} onChange={(e) => set('resolve', { hours: Number(e.target.value) || 24 })} /></label>
      </Rule>
      <Rule on={ru.labels.length > 0} onToggle={(v) => setR({ ...r, rules: { ...ru, labels: v ? [{ word: 'price', label: 'Pricing' }] : [] } })} icon="tag" color="#ec4899" title="Auto-labels" text="Label a chat when the customer’s message has a word — e.g. “refund” → Refund, “bulk” → Wholesale. Filter and report on them in the inbox.">
        {ru.labels.map((x, i) => (
          <div key={i} className="grid2" style={{ gridTemplateColumns: '1fr 1fr auto', alignItems: 'end' }}>
            <label>When the message has<input value={x.word} onChange={(e) => setR({ ...r, rules: { ...ru, labels: ru.labels.map((y, j) => (j === i ? { ...y, word: e.target.value } : y)) } })} placeholder="refund" /></label>
            <label>Add the label<input value={x.label} onChange={(e) => setR({ ...r, rules: { ...ru, labels: ru.labels.map((y, j) => (j === i ? { ...y, label: e.target.value } : y)) } })} placeholder="Refund" /></label>
            <button className="icon-btn danger" onClick={() => setR({ ...r, rules: { ...ru, labels: ru.labels.filter((_, j) => j !== i) } })} aria-label="Remove"><Icon name="trash" size={15} /></button>
          </div>
        ))}
        <button className="btn ghost sm" style={{ justifySelf: 'start' }} onClick={() => setR({ ...r, rules: { ...ru, labels: [...ru.labels, { word: '', label: '' }] } })}><Icon name="plus" size={13} />Add a rule</button>
      </Rule>
      <Rule on={ru.csat.on} onToggle={(v) => set('csat', { on: v })} icon="bookmark" color="#ea580c" title="Feedback after a chat" text="When a person resolves a chat, run a chatbot — e.g. “Feedback & reviews” to collect a rating and ask happy customers for a Google review.">
        <label style={{ maxWidth: 320 }}>Chatbot<select value={ru.csat.flowId} onChange={(e) => set('csat', { flowId: e.target.value })}><option value="">Choose a chatbot…</option>{r.flows.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</select></label>
        {!r.flows.length && <p className="hint" style={{ margin: 0 }}>Make one from the “Feedback & reviews” template in Chatbots first.</p>}
      </Rule>
      <div className="row" style={{ position: 'sticky', bottom: 12 }}><button className="btn primary lg" onClick={save} disabled={!dirty || busy}>{busy && <span className="spin" />}{dirty ? 'Save inbox automations' : 'All changes saved'}</button></div>
    </div>
  );
}
