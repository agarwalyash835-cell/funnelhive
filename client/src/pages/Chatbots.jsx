import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { AiPrompt, Layout, Panel, Icon, Modal, toast, confirmDialog, useWaTemplates, pagesOrigin } from '../ui';
import { waFmt } from './Inbox';
import { KitIcon } from '../blockIcons';
import '../chat.css';

// /chatbots — WhatsApp chatbots drawn on a canvas, drafted by AI from a sentence, tested on a phone before going
// live; and /chatbots?tab=agent — the AI agent that answers customers from the business's own knowledge.
const AI_BG = 'linear-gradient(135deg, #7c3aed, #2563eb 55%, #06b6d4)';
export const NT = {
  start: ['Start', 'bolt', '#16a34a', 'Where the chat begins'],
  message: ['Send a message', 'chat', '#0ea5e9', 'Text, photo, video, document or voice note'],
  buttons: ['Buttons', 'grip', '#6366f1', 'Up to 3 tap-to-reply buttons'],
  list: ['List menu', 'list', '#8b5cf6', 'A menu of up to 10 options'],
  link: ['Link button', 'link', '#0284c7', 'A button that opens a page — pay, book, buy'],
  template: ['Template message', 'mail', '#475569', 'An approved template — works after 24 hours'],
  ask: ['Ask a question', 'edit', '#f59e0b', 'Text, number, email, date, location or a file'],
  form: ['WhatsApp form', 'clip', '#0d9488', 'A short form inside WhatsApp'],
  ai_route: ['AI router', 'sparkles', AI_BG, 'AI sorts the message by topic'],
  ai_agent: ['AI agent', 'sparkles', AI_BG, 'The AI agent takes the chat'],
  condition: ['Condition', 'split', '#64748b', 'Yes / no on answers, tags or contact fields'],
  split: ['Random split', 'layers', '#a855f7', 'A/B test 2–4 paths'],
  hours: ['Business hours', 'bell', '#059669', 'One path when open, one when closed'],
  wait: ['Wait', 'clock', '#78716c', 'Pause before the next step'],
  tag: ['Add a tag', 'tag', '#ec4899', 'Tag the contact (starts automations)'],
  set: ['Update contact', 'card', '#be185d', 'Fields, tags, pipeline stage, opt-out'],
  api: ['API request', 'globe', '#0f766e', 'Call your own system, use its answer'],
  webhook: ['Webhook', 'send', '#115e59', 'Send the answers to another app'],
  handoff: ['Hand to a person', 'users', '#ea580c', 'Notifies your team'],
  goto: ['Go to chatbot', 'flow', '#334155', 'Carry on in another chatbot'],
  end: ['End', 'check', '#1c1917', 'Finish (optionally resolve)'],
};
const PALETTE = [['Send', ['message', 'buttons', 'list', 'link', 'template']], ['Collect', ['ask', 'form']], ['AI', ['ai_route', 'ai_agent']], ['Logic', ['condition', 'split', 'hours', 'wait']], ['Actions', ['tag', 'set', 'api', 'webhook']], ['Finish', ['handoff', 'goto', 'end']]];
const DEFAULTS = {
  message: { text: '', media: null }, buttons: { text: '', image: '', footer: '', timeout: 0, buttons: [{ id: 'b1', title: 'Yes' }, { id: 'b2', title: 'No' }] }, list: { text: '', header: '', footer: '', timeout: 0, button: 'Choose', rows: [{ id: 'r1', title: 'Option 1', desc: '' }, { id: 'r2', title: 'Option 2', desc: '' }] },
  link: { text: '', label: 'Open', url: '', image: '', footer: '' }, template: { name: '', language: 'en', params: [], preview: '' },
  ask: { text: '', var: 'answer', save: '', validate: 'text', retry: '', timeout: 0 }, condition: { match: 'all', rules: [{ field: 'tag', op: 'has', value: '' }] }, tag: { add: [] },
  split: { branches: [{ id: 'a', label: 'Path A', weight: 50 }, { id: 'b', label: 'Path B', weight: 50 }] }, hours: {},
  set: { actions: [{ do: 'var', key: '', value: '' }] }, api: { method: 'GET', url: '', headers: [], body: '', map: [] }, goto: { flowId: '' },
  ai_route: { intents: [{ id: 'i1', label: 'Sales', desc: 'wants to buy or asks the price' }, { id: 'i2', label: 'Support', desc: 'needs help with something' }] }, ai_agent: { note: '' },
  handoff: { text: 'Someone from our team will reply here shortly 🙏', note: '', assignee: '' }, wait: { minutes: 60 }, webhook: { url: '' }, end: { text: '', resolve: false },
  form: { text: 'Please fill in this short form 👇', title: 'Your details', cta: 'Fill the form', submit: 'Submit', timeout: 0, fields: [{ id: 'name', type: 'text', label: 'Your name', required: true, var: 'name', save: 'name' }, { id: 'email', type: 'email', label: 'Email', required: false, var: 'email', save: 'email' }] },
};
// WhatsApp form questions (Meta's label limits: 30 for radio / checkbox, 20 for the rest)
const FIELD_TYPES = [['text', 'Short text'], ['long', 'Long text'], ['email', 'Email'], ['phone', 'Phone'], ['number', 'Number'], ['date', 'Date'], ['dropdown', 'Dropdown'], ['radio', 'Pick one'], ['checkbox', 'Pick several']];
const CHOICE = ['dropdown', 'radio', 'checkbox'];
const labelMax = (t) => (t === 'radio' || t === 'checkbox' ? 30 : 20);
const toVar = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/^(\d)/, 'q_$1').slice(0, 31) || 'answer';
// what Meta holds for a published form: an edit to these needs publishing again
const formSig = (d) => JSON.stringify([d.title, d.submit, d.fields.map((x) => [x.id, x.type, x.label, !!x.required, (x.options || []).map((o) => [o.id, o.title])])]);
const TRIG = { keyword: 'When a message has a keyword', welcome: 'A new contact’s first message', default: 'Any message nothing else answers', manual: 'Only when started from the inbox', ad: 'A chat started from a Facebook / Instagram ad' };
const IDEAS = ['Take cake orders with flavour, size and delivery date', 'Book a free demo class and ask the child’s age', 'Qualify home-loan leads by income and city', 'Collect a review after a salon visit', 'Answer gym membership questions, pass hot leads to sales'];
const MEDIA = [['image', '📷 Photo'], ['video', '🎬 Video'], ['document', '📄 Document'], ['audio', '🎧 Audio']];
const SET_DO = [['var', 'Set a variable'], ['field', 'Save to a contact field'], ['untag', 'Remove a tag'], ['stage', 'Move to a pipeline stage'], ['optout', 'Unsubscribe from WhatsApp'], ['optin', 'Subscribe again']];
const rid = (p = 'n') => `${p}${Math.random().toString(36).slice(2, 8)}`;
const dur = (m) => (m >= 1440 ? `${Math.round((m / 1440) * 10) / 10} d` : m >= 60 ? `${Math.round((m / 60) * 10) / 10} h` : `${m} min`);
const urlOk = (v) => /^https?:\/\/[^\s/]+\.[^\s]+$/.test(String(v || '').replace(/\{\{[^}]*\}\}/g, 'x'));
const timed = (n) => (['buttons', 'list', 'ask', 'form'].includes(n.type) && n.data.timeout > 0 ? [['timeout', `⏱ No reply in ${dur(n.data.timeout)}`]] : []);
export const portsOf = (n) => {
  const d = n.data;
  switch (n.type) {
    case 'buttons': return [...d.buttons.map((b) => [b.id, b.title || 'Button']), ['other', 'Anything else'], ...timed(n)];
    case 'list': return [...d.rows.map((r) => [r.id, r.title || 'Option']), ['other', 'Anything else'], ...timed(n)];
    case 'ai_route': return [...d.intents.map((i) => [i.id, i.label || 'Topic']), ['other', 'Something else']];
    case 'condition': return [['yes', 'Yes'], ['no', 'No']];
    case 'api': return [['ok', 'Worked'], ['fail', 'Didn’t work']];
    case 'hours': return [['open', 'Open now'], ['closed', 'Closed']];
    case 'split': { const total = d.branches.reduce((a, b) => a + (Number(b.weight) || 0), 0) || 1; return d.branches.map((b) => [b.id, `${b.label || 'Path'} · ${Math.round(((Number(b.weight) || 0) / total) * 100)}%`]); }
    case 'ai_agent': case 'handoff': case 'end': case 'goto': return [];
    default: return [['next', n.type === 'start' ? 'Begin' : n.type === 'ask' ? 'After the answer' : n.type === 'form' ? 'After the form' : 'Next'], ...timed(n)];
  }
};
// the same checks the server runs before a chatbot goes live
export function problemsOf(f) {
  const out = [], bad = (node, msg) => out.push({ node, msg });
  const start = f.nodes.find((n) => n.type === 'start');
  if (f.trigger.type === 'keyword' && !f.trigger.keywords.length) bad(start?.id, 'Add at least one keyword that starts this chatbot');
  if (!f.edges.some((e) => e.from === start?.id)) bad(start?.id, 'Connect the start to the first step');
  for (const n of f.nodes) {
    const d = n.data;
    if (['message', 'buttons', 'list', 'ask'].includes(n.type) && !d.text && !d.image && !d.media) bad(n.id, `${NT[n.type][0]}: write the message`);
    if (n.type === 'message' && d.media && !d.media.url) bad(n.id, 'Send a message: add the file’s web address');
    if (n.type === 'buttons' && (!d.buttons.length || d.buttons.some((b) => !b.title))) bad(n.id, 'Buttons: give every button a title');
    if (n.type === 'list' && (!d.rows.length || d.rows.some((r) => !r.title))) bad(n.id, 'List: give every option a title');
    if (n.type === 'ai_route' && (!d.intents.length || d.intents.some((i) => !i.label))) bad(n.id, 'AI router: name every topic');
    if (n.type === 'tag' && !d.add.length) bad(n.id, 'Add a tag: choose the tag');
    if (n.type === 'webhook' && !urlOk(d.url)) bad(n.id, 'Webhook: enter the web address');
    if (n.type === 'condition' && !d.rules.length) bad(n.id, 'Condition: add a rule');
    if (n.type === 'link' && !d.text) bad(n.id, 'Link button: write the message');
    if (n.type === 'link' && !urlOk(d.url)) bad(n.id, 'Link button: enter the web address (https://…)');
    if (n.type === 'template' && !d.name) bad(n.id, 'Template message: choose an approved template');
    if (n.type === 'set' && (!d.actions.length || d.actions.some((a) => ['var', 'field', 'untag', 'stage'].includes(a.do) && !a.key))) bad(n.id, 'Update contact: finish every action');
    if (n.type === 'api' && !urlOk(d.url)) bad(n.id, 'API request: enter the web address (https://…)');
    if (n.type === 'split' && d.branches.length < 2) bad(n.id, 'Random split: add at least two paths');
    if (n.type === 'goto' && !d.flowId) bad(n.id, 'Go to chatbot: choose the chatbot');
    if (n.type === 'wait' && d.minutes > 1380) { const to = f.edges.find((e) => e.from === n.id)?.to; if (to && f.nodes.find((x) => x.id === to)?.type !== 'template') bad(n.id, 'Wait: over 23 hours, the next step must be a template message'); }
    if (n.type === 'form' && !d.fields.length) bad(n.id, 'WhatsApp form: add a question');
    if (n.type === 'form' && d.fields.some((x) => !x.label?.trim())) bad(n.id, 'WhatsApp form: give every question a label');
    if (n.type === 'form' && d.fields.some((x) => CHOICE.includes(x.type) && (!x.options?.length || x.options.some((o) => !o.title?.trim())))) bad(n.id, 'WhatsApp form: give every choice question its options');
    const words = [d.text, d.button, ...(d.buttons || []).map((b) => b.title), ...(d.rows || []).flatMap((r) => [r.title, r.desc])].filter(Boolean).join(' ');
    const ph = /\[[^\]\n]{2,}\]/.exec(words);
    if (ph) bad(n.id, `${NT[n.type][0]}: fill in ${ph[0]}`);
  }
  return out;
}
const triggerText = (t) => (t.type === 'keyword' ? (t.keywords.length ? `Keywords: ${t.keywords.join(', ')}` : 'No keywords yet') : t.type === 'ad' && t.adIds?.length ? `From ad ${t.adIds.join(', ')}` : TRIG[t.type]);
const pickFlow = (f) => ({ name: f.name, trigger: f.trigger, nodes: f.nodes, edges: f.edges });
// left-to-right by distance from the start; steps nothing reaches go in a last column
function arrange(f) {
  const start = f.nodes.find((n) => n.type === 'start'), depth = new Map([[start?.id, 0]]), order = [start?.id];
  for (let i = 0; i < order.length; i++) for (const e of f.edges.filter((x) => x.from === order[i])) if (!depth.has(e.to)) { depth.set(e.to, depth.get(order[i]) + 1); order.push(e.to); }
  const last = Math.max(0, ...depth.values()) + 1, cols = new Map();
  for (const n of f.nodes) { const c = depth.get(n.id) ?? last; cols.set(c, [...(cols.get(c) || []), n]); }
  for (const [c, list] of cols) list.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id)).forEach((n, i) => { n.x = 40 + c * 320; n.y = 60 + i * 210 - (list.length - 1) * 105 + 200; });
}
const download = (name, data) => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); };
let CLIP = null; // a copied step (Ctrl+C), pasted into any chatbot

export default function Chatbots() {
  const { id } = useParams();
  const [sp, setSp] = useSearchParams();
  const tab = ['agent', 'rules'].includes(sp.get('tab')) ? sp.get('tab') : 'bots';
  const [ind, setInd] = useState(null); // whose industry's ready-made chatbots are shown
  const nav = useNavigate();
  const [d, setD] = useState(null);
  const [draft, setDraft] = useState(null); // an AI-drafted / template flow that isn't saved yet
  const file = useRef();
  const load = () => api('/waflows').then(setD).catch(() => setD({ flows: [], templates: [] }));
  useEffect(() => { load(); }, []);
  const open = id ? (id === 'new' ? draft : d?.flows.find((f) => f.id === id)) : null;
  if (id && open) return <Builder key={open.id || 'new'} initial={open} ai={d?.ai} meta={!!d?.meta} number={d?.number || ''} flows={d?.flows || []} onClose={() => { setDraft(null); nav('/chatbots'); load(); }} onSaved={(f) => { load(); if (!open.id) { setDraft(null); nav(`/chatbots/${f.id}`, { replace: true }); } }} />;
  const create = async (template) => { try { const f = await api('/waflows', 'POST', { template }); await load(); nav(`/chatbots/${f.id}`); } catch (e) { toast(e.message); } };
  // a chatbot exported from here (or another account): opens as a new, switched-off chatbot
  const importFile = async (e) => {
    const fl = e.target.files?.[0];
    e.target.value = '';
    if (!fl) return;
    try {
      const j = JSON.parse(await fl.text());
      if (!Array.isArray(j.nodes)) throw new Error('That file isn’t a FunnelHive chatbot');
      const f = await api('/waflows', 'POST', { flow: { ...pickFlow(j), name: j.name || 'Imported chatbot' } });
      await load(); nav(`/chatbots/${f.id}`); toast('Chatbot imported — it’s switched off until you go live');
    } catch (er) { toast(er instanceof SyntaxError ? 'That file isn’t a FunnelHive chatbot' : er.message); }
  };
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
          <input ref={file} type="file" accept="application/json,.json" hidden onChange={importFile} />
          {d.flows.length > 0 && (
            <Panel title="Your chatbots" actions={<button className="btn ghost sm" onClick={() => file.current.click()}><Icon name="download" size={14} />Import</button>}>
              <div className="cb-grid">
                {d.flows.map((f) => <FlowCard key={f.id} f={f} onOpen={() => nav(`/chatbots/${f.id}`)} onChange={load} />)}
              </div>
            </Panel>
          )}
          {(() => {
            const cur = d.industries?.find((x) => x.id === (ind || d.industry)) || d.industries?.[0];
            return cur && (
              <Panel title={<>Ready-made for <KitIcon type={cur.id} size={16} className="kit-ic" /> {cur.name}</>} actions={<div className="ind-pick"><select value={cur.id} onChange={(e) => setInd(e.target.value)} aria-label="Industry">{d.industries.map((x) => <option key={x.id} value={x.id}>{x.name}{x.id === d.industry ? ' (your industry)' : ''}</option>)}</select></div>}>
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
          <Panel title="Ready-made for any business" actions={<div className="row" style={{ gap: 6 }}>{!d.flows.length && <button className="btn ghost sm" onClick={() => file.current.click()}>Import</button>}<button className="btn ghost sm" onClick={() => create('')}><Icon name="plus" size={14} />Blank chatbot</button></div>}>
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
  const copy = async (e) => { e.stopPropagation(); try { await api('/waflows', 'POST', { flow: { ...pickFlow(f), name: `${f.name} (copy)`.slice(0, 80) } }); onChange(); toast('Copied — the copy is switched off'); } catch (er) { toast(er.message); } };
  const exp = (e) => { e.stopPropagation(); download(`${f.name.replace(/[^\w-]+/g, '-').toLowerCase() || 'chatbot'}.json`, pickFlow(f)); };
  return (
    <div className="cb-card click" role="button" tabIndex={0} onClick={onOpen} onKeyDown={(e) => e.key === 'Enter' && onOpen()} style={{ cursor: 'pointer' }}>
      <div className="row"><span className={`cb-live ${f.active ? '' : 'idle'}`}>{f.trigger.type === 'manual' ? 'Manual' : f.active ? 'Live' : 'Off'}</span>
        <span className="row" style={{ gap: 2 }}>
          {f.trigger.type !== 'manual' && <button className="btn ghost sm" onClick={toggle}>{f.active ? 'Switch off' : 'Go live'}</button>}
          <button className="icon-btn" onClick={copy} aria-label="Duplicate" title="Duplicate"><Icon name="copy" size={15} /></button>
          <button className="icon-btn" onClick={exp} aria-label="Export" title="Download as a file"><Icon name="download" size={15} /></button>
          <button className="icon-btn danger" onClick={del} aria-label="Delete" title="Delete"><Icon name="trash" size={15} /></button>
        </span>
      </div>
      <b>{f.name}</b>
      <small>{triggerText(f.trigger)} · {f.nodes.length - 1} step{f.nodes.length === 2 ? '' : 's'}</small>
      {f.problems.length > 0 && <small style={{ color: 'var(--c-warn)' }}>⚠ {f.problems[0].msg}</small>}
      <div className="stats"><span><b>{s.runs || 0}</b> chats</span><span><b>{s.done || 0}</b> finished</span><span><b>{s.handoffs || 0}</b> to your team</span></div>
    </div>
  );
}

// ---------- the builder ----------
// what the step editors pick from: CRM fields and pipelines, team, funnels, booking pages, templates, other chatbots
function useBuilderData(flows, selfId) {
  const [x, setX] = useState({ crmFields: [], pipelines: [], team: [], funnels: [], calendars: [], handle: '', flows: [] });
  useEffect(() => {
    const get = (p, fn) => api(p).then((r) => setX((s) => ({ ...s, ...fn(r) }))).catch(() => {});
    get('/crm/fields', (r) => ({ crmFields: Array.isArray(r) ? r : [] }));
    get('/pipelines', (r) => ({ pipelines: Array.isArray(r) ? r : [] }));
    get('/inbox/meta', (r) => ({ team: r.team || [] }));
    get('/funnels', (r) => ({ funnels: (Array.isArray(r) ? r : []).filter((f) => f.published) }));
    get('/calendars', (r) => ({ calendars: Array.isArray(r) ? r : [] }));
    get('/booking-page', (r) => ({ handle: r.handle || '' }));
  }, []);
  return { ...x, flows: flows.filter((f) => f.id !== selfId) };
}

function Builder({ initial, ai, meta, number, flows, onClose, onSaved }) {
  const [f, setF] = useState(() => structuredClone(pickFlow(initial)));
  const [saved, setSaved] = useState(() => JSON.stringify(pickFlow(initial)));
  const [active, setActive] = useState(!!initial.active);
  const [sel, setSel] = useState(null);
  const [panel, setPanel] = useState('edit');
  const [view, setView] = useState({ x: 40, y: 40, z: 0.9 });
  const [now, setNow] = useState(null); // the node the test phone is on
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState(''); // palette search
  // the step palette folded to icons: the canvas gets the room (remembered in this browser)
  const [palMini, setPalMini] = useState(() => { try { return localStorage.getItem('ff_wfb_pal_mini') === '1'; } catch { return false; } });
  const foldPal = () => setPalMini((v) => { try { localStorage.setItem('ff_wfb_pal_mini', v ? '' : '1'); } catch { /* private mode */ } return !v; });
  const data = useBuilderData(flows, initial.id);
  const templates = useWaTemplates();
  // the WhatsApp forms published on Meta, as they were published (a changed form needs publishing again)
  const pub = useRef(Object.fromEntries(initial.nodes.filter((n) => n.type === 'form' && initial.forms?.[n.id]).map((n) => [n.id, formSig(n.data)])));
  // undo / redo: every change is a step, except a run of typing or dragging on the same step (merged)
  const hist = useRef({ past: [], future: [], at: 0, key: '' });
  const cur = useRef(f);
  cur.current = f;
  const dirty = JSON.stringify(f) !== saved;
  const probs = problemsOf(f);
  const set = (fn, merge = '') => {
    const h = hist.current;
    if (!merge || merge !== h.key || Date.now() - h.at > 1200) { h.past.push(cur.current); if (h.past.length > 100) h.past.shift(); }
    h.at = Date.now(); h.key = merge; h.future = [];
    setF((x) => { const n = structuredClone(x); fn(n); return n; });
  };
  const undo = () => { const h = hist.current; if (!h.past.length) return; h.future.push(cur.current); setF(h.past.pop()); h.key = ''; };
  const redo = () => { const h = hist.current; if (!h.future.length) return; h.past.push(cur.current); setF(h.future.pop()); h.key = ''; };
  const setNode = (nid, fn) => set((x) => { const n = x.nodes.find((y) => y.id === nid); if (n) fn(n); }, `node:${nid}`);
  const addNode = (type, x, y, link, data0) => {
    const n = { id: rid(), type, x: Math.round(x / 10) * 10, y: Math.round(y / 10) * 10, data: structuredClone(data0 || DEFAULTS[type]) };
    set((g) => { g.nodes.push(n); if (link) g.edges = [...g.edges.filter((e) => !(e.from === link.from && e.port === link.port)), { from: link.from, port: link.port, to: n.id }]; });
    setSel(n.id); setPanel('edit');
    return n.id;
  };
  const delNode = (nid) => { if (f.nodes.find((n) => n.id === nid)?.type === 'start') return; set((g) => { g.nodes = g.nodes.filter((n) => n.id !== nid); g.edges = g.edges.filter((e) => e.from !== nid && e.to !== nid); }); setSel(null); };
  const dupNode = (nid) => { const n = f.nodes.find((x) => x.id === nid); if (n && n.type !== 'start') addNode(n.type, n.x + 40, n.y + 40, null, n.data); };
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
  // saves the chatbot (the server publishes its saved copy), then publishes the form node on Meta
  const publish = async (nid) => {
    if (!initial.id) { toast('Save the chatbot first, then publish the form'); return; }
    if (dirty) await save();
    setBusy(true);
    try {
      const r = await api(`/waflows/${initial.id}/forms/${nid}/publish`, 'POST', {});
      const nd = r.nodes.find((n) => n.id === nid)?.data || {};
      const next = structuredClone(f), x = next.nodes.find((n) => n.id === nid);
      if (x) Object.assign(x.data, { flowId: nd.flowId, flowHash: nd.flowHash, flowAt: nd.flowAt });
      setF(next); setSaved(JSON.stringify(next));
      if (x) pub.current[nid] = formSig(x.data);
      onSaved(r);
      toast('📋 Form published on WhatsApp');
    } catch (e) { toast(e.message); }
    setBusy(false);
  };
  const close = async () => { if (dirty && !await confirmDialog({ title: 'Leave without saving?', text: 'Your changes to this chatbot will be lost.', confirm: 'Leave', danger: true })) return; onClose(); };
  useEffect(() => {
    const k = (e) => {
      const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName), mod = e.ctrlKey || e.metaKey, key = e.key.toLowerCase();
      if (mod && key === 's') { e.preventDefault(); save(); return; }
      if (typing) return;
      if (mod && key === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
      else if (mod && key === 'y') { e.preventDefault(); redo(); }
      else if (mod && key === 'c' && sel) { const n = f.nodes.find((x) => x.id === sel); if (n && n.type !== 'start') { CLIP = structuredClone(n); toast('Step copied — Ctrl+V to paste'); } }
      else if (mod && key === 'v' && CLIP) { e.preventDefault(); addNode(CLIP.type, CLIP.x + 50, CLIP.y + 50, null, CLIP.data); }
      else if (mod && key === 'd' && sel) { e.preventDefault(); dupNode(sel); }
      else if ((e.key === 'Delete' || e.key === 'Backspace') && sel) delNode(sel);
      else if (e.key === 'Escape') setSel(null);
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  });
  const node = f.nodes.find((n) => n.id === sel);
  const ql = q.trim().toLowerCase();
  const reach = initial.stats?.nodes || {};
  // full screen over the app (a portal: the page-transition wrapper would otherwise contain a fixed layer)
  return createPortal(
    <div className="wfb">
      <header className="wfb-top">
        <button className="icon-btn" onClick={close} aria-label="Back"><Icon name="chevron" className="flip" /></button>
        <span className="wfb-logo"><Icon name="bot" size={16} /></span>
        <input className="name" value={f.name} onChange={(e) => set((g) => { g.name = e.target.value; }, 'name')} aria-label="Chatbot name" />
        {f.trigger.type !== 'manual' && <span className={`cb-live ${active ? '' : 'idle'}`}>{active ? 'Live' : 'Off'}</span>}
        {initial.stats?.runs > 0 && <span className="wfb-runs" title="Chats this chatbot has run">{initial.stats.runs} chats · {initial.stats.done || 0} finished</span>}
        <span className="sp" />
        <span className="wfb-hist">
          <button className="icon-btn" onClick={undo} disabled={!hist.current.past.length} aria-label="Undo" title="Undo (Ctrl+Z)"><Icon name="undo" size={16} /></button>
          <button className="icon-btn" onClick={redo} disabled={!hist.current.future.length} aria-label="Redo" title="Redo (Ctrl+Y)"><Icon name="redo" size={16} /></button>
        </span>
        {probs.length > 0 && <button className="pill warn" style={{ cursor: 'pointer' }} onClick={() => { setSel(probs[0].node); setPanel('edit'); }}>⚠ {probs.length} to fix</button>}
        <button className={`btn sm ${panel === 'test' ? 'primary' : 'ghost'}`} onClick={() => setPanel(panel === 'test' ? 'edit' : 'test')}><Icon name="phone" size={14} />Test</button>
        <button className="btn ghost sm" onClick={() => save()} disabled={busy || (!dirty && initial.id)}>{dirty || !initial.id ? 'Save' : 'Saved'}</button>
        {f.trigger.type !== 'manual' && (active ? <button className="btn ghost sm" onClick={() => save({ active: false })} disabled={busy}>Switch off</button> : <button className="btn live sm" onClick={() => save({ active: true })} disabled={busy || probs.length > 0} title={probs[0]?.msg}><Icon name="play" size={13} />Go live</button>)}
      </header>
      <div className={`wfb-body ${palMini ? 'pal-mini' : ''}`}>
        <aside className="wfb-pal">
          <div className="wfb-search">{!palMini && <><Icon name="search" size={14} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a step" aria-label="Find a step" /></>}<button className="wfb-fold" onClick={foldPal} title={palMini ? 'Show step names' : 'Fold to icons — more room for the canvas'} aria-label={palMini ? 'Show step names' : 'Fold the steps'}><Icon name="panel" size={15} /></button></div>
          {PALETTE.map(([g, types]) => {
            const shown = types.filter((t) => !ql || `${NT[t][0]} ${NT[t][3]}`.toLowerCase().includes(ql));
            return shown.length > 0 && (
              <div key={g} style={{ display: 'contents' }}>
                <h5>{g}</h5>
                {shown.map((t) => (
                  <button key={t} className="wfb-pi" draggable onDragStart={(e) => { e.dataTransfer.setData('text/fh-node', t); e.dataTransfer.effectAllowed = 'copy'; }} onClick={() => addNode(t, (300 - view.x) / view.z + Math.random() * 40, (200 - view.y) / view.z + Math.random() * 40)} title={NT[t][3]}>
                    <span className="k" style={{ background: NT[t][2] }}><Icon name={NT[t][1]} size={14} /></span>
                    <span className="wfb-pt"><b>{NT[t][0]}</b><small>{NT[t][3]}</small></span>
                  </button>
                ))}
              </div>
            );
          })}
          {!ai && <p className="hint">AI steps need AI switched on for this account.</p>}
        </aside>
        <Canvas f={f} set={set} setNode={setNode} sel={sel} setSel={(x) => { setSel(x); if (x) setPanel('edit'); }} view={view} setView={setView} addNode={addNode} delNode={delNode} dupNode={dupNode} probs={probs} now={panel === 'test' ? now : null} reach={reach} runs={initial.stats?.runs || 0} flows={data.flows} onArrange={() => set((g) => arrange(g))} />
        <aside className="wfb-right">
          {panel === 'test' ? <TestPhone f={f} onNode={setNow} /> : (
            <div className="wfb-insp">
              {node ? <Inspector key={node.id} n={node} f={f} set={set} setNode={setNode} onDelete={() => delNode(node.id)} onDuplicate={() => dupNode(node.id)} data={data} templates={templates} reach={reach[node.id] || 0} runs={initial.stats?.runs || 0} forms={{ meta, crmFields: data.crmFields, live: node.type === 'form' && pub.current[node.id] === formSig(node.data), published: !!node.data.flowId, publish: () => publish(node.id), busy, saved: !!initial.id }} />
                : <FlowSettings f={f} set={set} probs={probs} onPick={setSel} number={number} />}
            </div>
          )}
        </aside>
      </div>
    </div>,
    document.body,
  );
}

function Canvas({ f, set, setNode, sel, setSel, view, setView, addNode, delNode, dupNode, probs, now, reach, runs, flows, onArrange }) {
  const wrap = useRef(), world = useRef();
  const dots = useRef({});
  const [pts, setPts] = useState({});
  const [drag, setDrag] = useState(null); // { kind: 'pan' | 'node' | 'wire', … }
  const [wire, setWire] = useState(null); // the wire being drawn: { from, port, x, y }
  const [over, setOver] = useState(null);
  const [quick, setQuick] = useState(null); // a wire dropped on empty canvas: pick the step it leads to
  const [size, setSize] = useState({ w: 800, h: 600 });
  const bad = new Set(probs.map((p) => p.node));
  // where every output dot sits in world coordinates (nodes grow with their text, so measured, not computed)
  useLayoutEffect(() => {
    const w = world.current?.getBoundingClientRect();
    if (!w) return;
    const next = {};
    for (const [k, el] of Object.entries(dots.current)) { if (!el) continue; const r = el.getBoundingClientRect(); next[k] = [(r.left + r.width / 2 - w.left) / view.z, (r.top + r.height / 2 - w.top) / view.z]; }
    if (JSON.stringify(next) !== JSON.stringify(pts)) setPts(next);
  });
  useEffect(() => { let raf = 0; const ro = new ResizeObserver(([e]) => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => setSize({ w: e.contentRect.width, h: e.contentRect.height })); }); ro.observe(wrap.current); return () => { cancelAnimationFrame(raf); ro.disconnect(); }; }, []);
  const capture = (e) => { try { wrap.current.setPointerCapture(e.pointerId); } catch { /* a pointer the browser no longer tracks */ } };
  const toWorld = (e) => { const r = wrap.current.getBoundingClientRect(); return [(e.clientX - r.left - view.x) / view.z, (e.clientY - r.top - view.y) / view.z]; };
  const down = (e) => {
    if (e.button !== 0 || e.target.closest('.wfb-node, .wfb-zoom, .wfb-mini, .wfb-quick')) return;
    setSel(null); setQuick(null);
    setDrag({ kind: 'pan', sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y });
    capture(e);
  };
  const move = (e) => {
    if (!drag) return;
    if (drag.kind === 'pan') setView((v) => ({ ...v, x: drag.vx + e.clientX - drag.sx, y: drag.vy + e.clientY - drag.sy }));
    else if (drag.kind === 'node') setNode(drag.id, (n) => { n.x = Math.round((drag.nx + (e.clientX - drag.sx) / view.z) / 10) * 10; n.y = Math.round((drag.ny + (e.clientY - drag.sy) / view.z) / 10) * 10; });
    else if (drag.kind === 'wire') { const [x, y] = toWorld(e); setWire((w) => ({ ...w, x, y })); setOver(document.elementFromPoint(e.clientX, e.clientY)?.closest('.wfb-node')?.dataset.id || null); }
  };
  const up = (e) => {
    if (drag?.kind === 'wire') {
      const to = document.elementFromPoint(e.clientX, e.clientY)?.closest('.wfb-node')?.dataset.id;
      const target = to && f.nodes.find((n) => n.id === to);
      if (target && target.type !== 'start' && target.id !== drag.from) set((g) => { g.edges = [...g.edges.filter((x) => !(x.from === drag.from && x.port === drag.port)), { from: drag.from, port: drag.port, to }]; });
      else if (!to) { const r = wrap.current.getBoundingClientRect(), [x, y] = toWorld(e); setQuick({ sx: Math.min(e.clientX - r.left, r.width - 250), sy: Math.min(e.clientY - r.top, r.height - 330), x, y, from: drag.from, port: drag.port }); }
      setWire(null); setOver(null);
    }
    setDrag(null);
  };
  const wheel = (e) => {
    const r = wrap.current.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
    setView((v) => { const z = Math.min(1.6, Math.max(0.25, v.z * Math.exp(-e.deltaY * 0.0012))); return { z, x: mx - ((mx - v.x) * z) / v.z, y: my - ((my - v.y) * z) / v.z }; });
  };
  useEffect(() => { const el = wrap.current; const h = (e) => e.preventDefault(); el.addEventListener('wheel', h, { passive: false }); return () => el.removeEventListener('wheel', h); }, []);
  const bounds = () => { const xs = f.nodes.map((n) => n.x), ys = f.nodes.map((n) => n.y); const minX = Math.min(...xs), minY = Math.min(...ys); return { minX, minY, w: Math.max(...xs) - minX + 270, h: Math.max(...ys) - minY + 240 }; };
  const fit = () => {
    const r = wrap.current.getBoundingClientRect(), b = bounds();
    const z = Math.min(1.1, Math.max(0.25, Math.min((r.width - 60) / b.w, (r.height - 60) / b.h)));
    setView({ z, x: (r.width - b.w * z) / 2 - b.minX * z, y: (r.height - b.h * z) / 2 - b.minY * z });
  };
  useEffect(() => { fit(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const path = ([x1, y1], [x2, y2]) => { const dx = Math.max(50, Math.abs(x2 - x1) / 2); return `M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}`; };
  const inPt = (n) => [n.x, n.y + 25];
  const byId = Object.fromEntries(f.nodes.map((n) => [n.id, n]));
  // the minimap: every step as a block, the visible area as a frame; click to look there
  const mb = bounds(), MW = 168, MH = 104, ms = Math.min(MW / (mb.w + 200), MH / (mb.h + 200)), mx0 = mb.minX - 100, my0 = mb.minY - 100;
  const miniGo = (e) => { const r = e.currentTarget.getBoundingClientRect(); const wx = (e.clientX - r.left) / ms + mx0, wy = (e.clientY - r.top) / ms + my0; setView((v) => ({ ...v, x: size.w / 2 - wx * v.z, y: size.h / 2 - wy * v.z })); };
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
                <path d={d} className={e.port === 'timeout' ? 'late' : e.port === 'fail' || e.port === 'no' || e.port === 'closed' ? 'neg' : ''} style={hot ? { stroke: '#6366f1', strokeWidth: 2.5 } : undefined} />
                {hot && <path className="flow" d={d} />}
              </g>
            );
          })}
          {wire && pts[`${wire.from}:${wire.port}`] && <path className="draft" d={path(pts[`${wire.from}:${wire.port}`], [wire.x, wire.y])} />}
        </svg>
        {f.nodes.map((n) => {
          const [label, ic, color] = NT[n.type], ports = portsOf(n), r = reach[n.id] || 0;
          return (
            <div key={n.id} data-id={n.id} className={`wfb-node ${sel === n.id ? 'sel' : ''} ${bad.has(n.id) ? 'bad' : ''} ${now === n.id ? 'now' : ''} ${over === n.id && wire ? 'drop' : ''} t-${n.type}`} style={{ left: n.x, top: n.y, '--nc': color.startsWith('linear') ? '#7c3aed' : color }} onPointerDown={(e) => { if (!e.target.closest('.wfb-dot')) setSel(n.id); }}>
              {n.type !== 'start' && <span className="wfb-in" />}
              <div className="wfb-nh" onPointerDown={(e) => { if (e.button !== 0 || e.target.closest('button')) return; e.stopPropagation(); setSel(n.id); setDrag({ kind: 'node', id: n.id, sx: e.clientX, sy: e.clientY, nx: n.x, ny: n.y }); capture(e); }}>
                <span className="k" style={{ background: color }}><Icon name={ic} size={13} /></span><b>{label}</b>
                {r > 0 && <span className="wfb-reach" title={`${r} chat${r === 1 ? '' : 's'} reached this step${runs ? ` (${Math.round((r / runs) * 100)}% of all)` : ''}`}>{r > 999 ? `${Math.round(r / 100) / 10}k` : r}</span>}
                {n.type !== 'start' && <span className="wfb-acts"><button className="icon-btn" onClick={() => dupNode(n.id)} aria-label="Duplicate step" title="Duplicate (Ctrl+D)"><Icon name="copy" size={11} /></button><button className="icon-btn" onClick={() => delNode(n.id)} aria-label="Delete step" title="Delete"><Icon name="x" size={12} /></button></span>}
              </div>
              <NodeBody n={n} flows={flows} />
              {ports.length > 0 && (
                <div className="wfb-ports">
                  {ports.map(([p, l]) => {
                    const wired = f.edges.some((e) => e.from === n.id && e.port === p);
                    return (
                      <div key={p} className={`wfb-port ${['other', 'timeout'].includes(p) ? 'other' : ''}`}>{l}
                        <span ref={(el) => { dots.current[`${n.id}:${p}`] = el; }} className={`wfb-dot ${wired ? 'wired' : ''}`} title="Drag to the next step — or onto empty space to add one"
                          onPointerDown={(e) => { e.stopPropagation(); setQuick(null); const [x, y] = toWorld(e); setWire({ from: n.id, port: p, x, y }); setDrag({ kind: 'wire', from: n.id, port: p }); capture(e); }} />
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {f.nodes.length < 3 && !quick && <div className="wfb-hint">Drag steps from the left onto the canvas — or drag from a ● into empty space to add the next step</div>}
      {quick && (
        <div className="wfb-quick" style={{ left: quick.sx, top: quick.sy }} onPointerDown={(e) => e.stopPropagation()}>
          <div className="row" style={{ justifyContent: 'space-between' }}><b>Add the next step</b><button className="icon-btn" onClick={() => setQuick(null)} aria-label="Close"><Icon name="x" size={13} /></button></div>
          <div className="wfb-qgrid">
            {PALETTE.flatMap(([, ts]) => ts).map((t) => (
              <button key={t} onClick={() => { addNode(t, quick.x + 30, quick.y - 25, { from: quick.from, port: quick.port }); setQuick(null); }} title={NT[t][3]}>
                <span className="k" style={{ background: NT[t][2] }}><Icon name={NT[t][1]} size={12} /></span>{NT[t][0]}
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="wfb-zoom">
        <button className="icon-btn" onClick={() => setView((v) => ({ ...v, z: Math.max(0.25, v.z - 0.1) }))} aria-label="Zoom out">−</button>
        <span>{Math.round(view.z * 100)}%</span>
        <button className="icon-btn" onClick={() => setView((v) => ({ ...v, z: Math.min(1.6, v.z + 0.1) }))} aria-label="Zoom in">+</button>
        <button className="btn ghost sm" onClick={fit}>Fit</button>
        <button className="btn ghost sm" onClick={() => { onArrange(); setTimeout(fit, 30); }} title="Line the steps up neatly"><Icon name="layout" size={13} />Tidy up</button>
      </div>
      {f.nodes.length > 3 && (
        <svg className="wfb-mini" width={MW} height={MH} onClick={miniGo} aria-label="Map of the chatbot — click to move there">
          {f.edges.map((e) => { const a = byId[e.from], b = byId[e.to]; return a && b && <line key={`${e.from}:${e.port}`} x1={(a.x + 250 - mx0) * ms} y1={(a.y + 30 - my0) * ms} x2={(b.x - mx0) * ms} y2={(b.y + 25 - my0) * ms} />; })}
          {f.nodes.map((n) => <rect key={n.id} x={(n.x - mx0) * ms} y={(n.y - my0) * ms} width={250 * ms} height={Math.max(6, 90 * ms)} rx={2} style={{ fill: sel === n.id ? '#6366f1' : NT[n.type][2].startsWith('linear') ? '#7c3aed' : NT[n.type][2] }} />)}
          <rect className="vp" x={(-view.x / view.z - mx0) * ms} y={(-view.y / view.z - my0) * ms} width={(size.w / view.z) * ms} height={(size.h / view.z) * ms} />
        </svg>
      )}
    </div>
  );
}

function NodeBody({ n, flows }) {
  const d = n.data;
  const txt = (s, empty = 'Write the message…') => (s ? <div className="txt">{s}</div> : <div className="txt muted">{empty}</div>);
  const late = d.timeout > 0 && <span className="pill" style={{ justifySelf: 'start' }}>⏱ waits {dur(d.timeout)} for a reply</span>;
  switch (n.type) {
    case 'start': return <div className="wfb-nb"><span className="muted" style={{ fontStyle: 'normal' }}>The customer writes on WhatsApp</span></div>;
    case 'message': return <div className="wfb-nb">{d.media ? <span className="wfb-media">{MEDIA.find((m) => m[0] === d.media.type)?.[1]}{d.media.filename ? ` · ${d.media.filename}` : ''}</span> : d.image && <span className="wfb-media">📷 Photo</span>}{(d.text || !(d.media || d.image)) && txt(d.text)}</div>;
    case 'buttons': return <div className="wfb-nb">{d.image && <span className="wfb-media">📷 Photo on top</span>}{txt(d.text)}{d.footer && <small className="wfb-foot">{d.footer}</small>}{late}</div>;
    case 'list': return <div className="wfb-nb">{d.header && <b className="wfb-hd">{d.header}</b>}{txt(d.text)}<span className="wfb-fake">☰ {d.button || 'Choose'}</span>{late}</div>;
    case 'ask': return <div className="wfb-nb">{txt(d.text)}<span className="pill" style={{ justifySelf: 'start' }}>{d.validate === 'location' ? '📍 location' : d.validate === 'file' ? '📎 photo / file' : d.validate} → {`{{${d.var}}}`}{d.save ? ` → ${d.save.replace('custom:', 'CRM ')}` : ''}</span>{late}</div>;
    case 'link': return <div className="wfb-nb">{d.image && <span className="wfb-media">📷 Photo on top</span>}{txt(d.text)}<span className="wfb-fake">🔗 {d.label || 'Open'}</span>{d.url && <small className="wfb-url">{d.url}</small>}</div>;
    case 'template': return <div className="wfb-nb">{d.name ? <><b className="wfb-hd">📨 {d.name}</b>{d.preview && <div className="txt">{d.preview}</div>}</> : <div className="txt muted">Choose an approved template…</div>}</div>;
    case 'condition': return <div className="wfb-nb">{d.rules.map((r, i) => <div key={i}>{i > 0 && <small className="muted">{d.match === 'any' ? 'or ' : 'and '}</small>}{r.field === 'tag' ? `Tag ${r.op === 'not_has' ? 'is not' : 'is'} “${r.value || '…'}”` : `${r.field.replace(/^(var|custom):/, '')} ${({ eq: 'is', neq: 'is not', contains: 'contains', exists: 'is filled', missing: 'is empty', gt: '>', lt: '<', starts: 'starts with' })[r.op] || r.op} ${['exists', 'missing'].includes(r.op) ? '' : r.value}`}</div>)}</div>;
    case 'tag': return <div className="wfb-nb"><div className="row">{d.add.length ? d.add.map((t) => <span key={t} className="tag">{t}</span>) : <span className="muted">Choose a tag…</span>}</div></div>;
    case 'set': return <div className="wfb-nb">{d.actions.map((a, i) => <div key={i} className="wfb-act">{({ var: `{{${a.key || '…'}}} = ${a.value || '…'}`, field: `${(a.key || '…').replace('custom:', '')} ← ${a.value || '…'}`, untag: `Remove tag “${a.key || '…'}”`, stage: 'Move to a pipeline stage', optout: 'Unsubscribe from WhatsApp', optin: 'Subscribe again' })[a.do]}</div>)}</div>;
    case 'api': return <div className="wfb-nb"><code className="wfb-code"><b>{d.method}</b> {d.url || 'https://…'}</code>{d.map.length > 0 && <small className="muted" style={{ fontStyle: 'normal' }}>saves {d.map.map((m) => `{{${m.var}}}`).join(', ')}</small>}</div>;
    case 'hours': return <div className="wfb-nb"><span className="muted" style={{ fontStyle: 'normal' }}>Your working hours (Inbox automations)</span></div>;
    case 'split': return null;
    case 'goto': return <div className="wfb-nb">{d.flowId ? <b className="wfb-hd">↪ {flows.find((x) => x.id === d.flowId)?.name || 'A deleted chatbot'}</b> : <div className="txt muted">Choose the chatbot…</div>}</div>;
    case 'ai_route': return <div className="wfb-nb"><span className="ai-txt" style={{ fontSize: 12 }}>✦ AI reads the message and picks a topic</span></div>;
    case 'ai_agent': return <div className="wfb-nb"><span className="ai-txt" style={{ fontSize: 12 }}>✦ The AI agent continues the chat</span>{d.note && <div className="txt">{d.note}</div>}</div>;
    case 'handoff': return <div className="wfb-nb">{txt(d.text, 'No message — just notifies your team')}</div>;
    case 'wait': return <div className="wfb-nb">Wait {dur(d.minutes)}</div>;
    case 'webhook': return <div className="wfb-nb">{txt(d.url, 'https://…')}</div>;
    case 'form': return <div className="wfb-nb"><div className="txt"><b>📋 {d.title}</b></div><div className="muted" style={{ fontStyle: 'normal' }}>{d.fields.length ? d.fields.map((x) => x.label || '…').join(' · ') : 'Add questions…'}</div>{late}</div>;
    case 'end': return <div className="wfb-nb">{txt(d.text, 'Ends quietly')}{d.resolve && <span className="pill ok" style={{ justifySelf: 'start' }}>resolves the chat</span>}</div>;
    default: return null;
  }
}

const VARS = ['first_name', 'name', 'phone', 'email', 'business'];
// every answer and variable the chatbot collects, for the {{…}} buttons
const varsOf = (f) => [...new Set(f.nodes.flatMap((n) => (n.type === 'ask' ? [n.data.var] : n.type === 'form' ? n.data.fields.map((x) => x.var) : n.type === 'set' ? n.data.actions.filter((a) => a.do === 'var' && a.key).map((a) => a.key) : n.type === 'api' ? [...n.data.map.map((m) => m.var), 'api_status'] : [])))].filter((v) => v && !VARS.includes(v));
function TextField({ label, value, onChange, f, rows = 4, max = 1024, placeholder = 'Hi {{first_name}}! 👋 …', input = false }) {
  const ref = useRef();
  const insert = (v) => { const el = ref.current, s = el.selectionStart ?? value.length; onChange(`${value.slice(0, s)}{{${v}}}${value.slice(el.selectionEnd ?? s)}`); };
  return (
    <label>{label}
      {input ? <input ref={ref} maxLength={max} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} /> : <textarea ref={ref} rows={rows} maxLength={max} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />}
      <span className="vars">{[...VARS, ...varsOf(f)].map((v) => <button type="button" key={v} onClick={() => insert(v)}>{`{{${v}}}`}</button>)}</span>
    </label>
  );
}
// a list of options (buttons / list rows / AI topics): renaming keeps the connection, removing drops it
function Options({ items, max, titleMax, onChange, fields = [['title', 'Title']] }) {
  const drop = (o) => { onChange(items.filter((x) => x !== o), o.id); };
  const move = (i, by) => { const l = [...items]; const [it] = l.splice(i, 1); l.splice(i + by, 0, it); onChange(l); };
  return (
    <div style={{ display: 'grid', gap: 6 }}>
      {items.map((o, i) => (
        <div key={o.id} className="opt" style={{ gridTemplateColumns: fields.length > 1 ? '1fr 1.3fr auto auto' : '1fr auto auto' }}>
          {fields.map(([k, ph]) => <input key={k} value={o[k] || ''} maxLength={k === 'title' || k === 'label' ? titleMax : 200} placeholder={ph} onChange={(e) => onChange(items.map((x, j) => (j === i ? { ...x, [k]: e.target.value } : x)))} />)}
          <button className="icon-btn" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Move up" title="Move up">↑</button>
          <button className="icon-btn danger" onClick={() => drop(o)} aria-label="Remove"><Icon name="trash" size={14} /></button>
        </div>
      ))}
      {items.length < max && <button className="btn ghost sm" onClick={() => onChange([...items, { id: rid('o'), [fields[0][0]]: '' }])}><Icon name="plus" size={13} />Add</button>}
    </div>
  );
}
// "If they don't reply in …" — gives the step a "No reply" path
function Timeout({ d, up }) {
  const on = d.timeout > 0, hours = d.timeout >= 60 && d.timeout % 60 === 0;
  return (
    <div className="wfb-box">
      <label className="tog"><input type="checkbox" checked={on} onChange={(e) => up((x) => { x.timeout = e.target.checked ? 60 : 0; })} /><span />If they don’t reply</label>
      {on && <div className="row" style={{ gap: 6 }}>
        <span className="hint" style={{ margin: 0 }}>within</span>
        <input type="number" min={1} style={{ width: 80 }} value={hours ? d.timeout / 60 : d.timeout} onChange={(e) => { const v = Math.max(1, Number(e.target.value) || 1); up((x) => { x.timeout = Math.min(1380, hours ? v * 60 : v); }); }} />
        <select value={hours ? 'h' : 'm'} onChange={(e) => up((x) => { x.timeout = e.target.value === 'h' ? Math.min(1380, Math.max(1, Math.round(x.timeout / 60)) * 60) : Math.max(1, x.timeout); })} style={{ width: 'auto' }}><option value="m">minutes</option><option value="h">hours</option></select>
      </div>}
      {on && <span className="hint" style={{ margin: 0 }}>Connect the “⏱ No reply” dot to a reminder or a different path. Up to 23 hours.</span>}
    </div>
  );
}
const FieldSelect = ({ value, onChange, crmFields, none = 'Don’t save' }) => (
  <select value={value || ''} onChange={(e) => onChange(e.target.value)}>
    {none && <option value="">{none}</option>}<option value="name">Name</option><option value="email">Email</option><option value="phone">Phone</option>
    {crmFields.map((c) => <option key={c.id} value={`custom:${c.id}`}>{c.label}</option>)}
  </select>
);

function Inspector({ n, f, set, setNode, onDelete, onDuplicate, data, templates, reach, runs, forms }) {
  const d = n.data;
  const up = (fn) => setNode(n.id, (x) => fn(x.data));
  const opts = (key) => (list, removedId) => set((g) => { const x = g.nodes.find((y) => y.id === n.id); x.data[key] = list; if (removedId) g.edges = g.edges.filter((e) => !(e.from === n.id && e.port === removedId)); });
  const [label, ic, color, desc] = NT[n.type];
  const tpl = templates?.find((t) => t.name === d.name);
  return (
    <>
      <div className="wfb-ih">
        <span className="k" style={{ background: color }}><Icon name={ic} size={16} /></span>
        <div style={{ flex: 1, minWidth: 0 }}><b>{label}</b><div className="hint" style={{ margin: 0 }}>{desc}</div></div>
        {n.type !== 'start' && <><button className="icon-btn" onClick={onDuplicate} aria-label="Duplicate step" title="Duplicate (Ctrl+D)"><Icon name="copy" size={15} /></button><button className="icon-btn danger" onClick={onDelete} aria-label="Delete step" title="Delete"><Icon name="trash" size={16} /></button></>}
      </div>
      {reach > 0 && <div className="wfb-stat"><b>{reach}</b> chat{reach === 1 ? '' : 's'} reached this step{runs ? <> · <b>{Math.round((reach / runs) * 100)}%</b> of everyone who started</> : ''}</div>}
      {n.type === 'start' && <FlowSettings f={f} set={set} probs={problemsOf(f)} compact />}
      {['message', 'buttons', 'list', 'ask', 'handoff', 'end', 'form', 'link'].includes(n.type) && <TextField label={n.type === 'handoff' ? 'Message to the customer (optional)' : n.type === 'end' ? 'Last message (optional)' : n.type === 'form' ? 'Message with the form' : n.type === 'message' && d.media ? 'Caption (optional)' : 'Message'} value={d.text || ''} onChange={(v) => up((x) => { x.text = v; })} f={f} />}
      {n.type === 'message' && <>
        <label>Attach<select value={d.media?.type || (d.image ? 'image' : '')} onChange={(e) => up((x) => { const t = e.target.value; x.media = t ? { type: t, url: x.media?.url || x.image || '', filename: x.media?.filename || '' } : null; x.image = ''; })}><option value="">Nothing — just text</option>{MEDIA.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
        {d.media && <label>{MEDIA.find((m) => m[0] === d.media.type)?.[1].slice(2)} web address<input value={d.media.url} onChange={(e) => up((x) => { x.media.url = e.target.value; })} placeholder={d.media.type === 'document' ? 'https://…/price-list.pdf' : d.media.type === 'video' ? 'https://…/demo.mp4' : d.media.type === 'audio' ? 'https://…/welcome.mp3' : 'https://…/menu.jpg'} /><span className="hint">A public link — e.g. from your file library, Google Drive (“anyone with the link”) or your website.</span></label>}
        {d.media?.type === 'document' && <label>File name customers see<input value={d.media.filename} maxLength={120} onChange={(e) => up((x) => { x.media.filename = e.target.value; })} placeholder="Price list 2026.pdf" /></label>}
      </>}
      {n.type === 'buttons' && <>
        <label>Buttons <span className="muted">(up to 3, 20 characters)</span><Options items={d.buttons} max={3} titleMax={20} onChange={opts('buttons')} /></label>
        <details className="wfb-more"><summary>Photo on top & footer</summary>
          <label>Photo on top (optional)<input value={d.image || ''} onChange={(e) => up((x) => { x.image = e.target.value; })} placeholder="https://…/offer.jpg" /></label>
          <label>Footer (optional)<input value={d.footer || ''} maxLength={60} onChange={(e) => up((x) => { x.footer = e.target.value; })} placeholder="Reply STOP to opt out" /></label>
        </details>
        <Timeout d={d} up={up} />
      </>}
      {n.type === 'list' && <>
        <label>Menu button text<input value={d.button} maxLength={20} onChange={(e) => up((x) => { x.button = e.target.value; })} /></label>
        <label>Options <span className="muted">(up to 10)</span><Options items={d.rows} max={10} titleMax={24} fields={[['title', 'Title'], ['desc', 'Description (optional)']]} onChange={opts('rows')} /></label>
        <details className="wfb-more"><summary>Heading & footer</summary>
          <label>Heading (optional)<input value={d.header || ''} maxLength={60} onChange={(e) => up((x) => { x.header = e.target.value; })} placeholder="Our menu" /></label>
          <label>Footer (optional)<input value={d.footer || ''} maxLength={60} onChange={(e) => up((x) => { x.footer = e.target.value; })} /></label>
        </details>
        <Timeout d={d} up={up} />
      </>}
      {n.type === 'link' && <LinkEditor d={d} up={up} data={data} />}
      {n.type === 'template' && <>
        <label>Approved template
          {templates?.length ? <select value={d.name} onChange={(e) => { const t = templates.find((x) => x.name === e.target.value); up((x) => { x.name = t?.name || ''; x.language = t?.language || 'en'; x.preview = t?.text || t?.body || ''; x.params = Array.from({ length: t?.vars || 0 }, (_, i) => x.params[i] || (i === 0 ? '{{first_name}}' : '')); }); }}><option value="">Choose…</option>{templates.map((t) => <option key={`${t.name}:${t.language}`} value={t.name}>{t.name}{t.category ? ` · ${t.category.toLowerCase()}` : ''}</option>)}</select>
            : <input value={d.name} onChange={(e) => up((x) => { x.name = e.target.value.replace(/[^\w]/g, ''); })} placeholder="template_name" />}
        </label>
        {(tpl?.body || d.preview) && <p className="wfb-tpl">{tpl?.body || d.preview}</p>}
        {(tpl ? tpl.vars > 0 : d.params.length > 0) && d.params.map((p, i) => <TextField key={i} input label={`Variable {{${i + 1}}}`} value={p} onChange={(v) => up((x) => { x.params[i] = v; })} f={f} placeholder="{{first_name}}" max={500} />)}
        {!tpl && <button className="btn ghost sm" onClick={() => up((x) => { x.params.push(''); })}><Icon name="plus" size={13} />Add a variable</button>}
        <p className="hint">Templates are the only messages WhatsApp allows more than 24 hours after the customer’s last message — use one after a long wait to bring them back. <Link to="/settings">Manage templates</Link></p>
      </>}
      {n.type === 'ask' && <>
        <label>The answer should be<select value={d.validate} onChange={(e) => up((x) => { x.validate = e.target.value; })}><option value="text">Any text</option><option value="number">A number</option><option value="email">An email</option><option value="phone">A phone number</option><option value="date">A date</option><option value="location">📍 Their location</option><option value="file">📎 A photo or file</option></select></label>
        <label>Remember it as<input value={d.var} onChange={(e) => up((x) => { x.var = e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 31); })} /><span className="hint">Use it later as {`{{${d.var}}}`}</span></label>
        <label>Also save on the contact<FieldSelect value={d.save} onChange={(v) => up((x) => { x.save = v; })} crmFields={data.crmFields} /></label>
        <label>If the answer doesn’t fit (optional)<input value={d.retry || ''} onChange={(e) => up((x) => { x.retry = e.target.value; })} placeholder="Please send a valid email 🙏" /><span className="hint">Asked up to twice, then the chatbot moves on.</span></label>
        <Timeout d={d} up={up} />
      </>}
      {n.type === 'condition' && <>
        <label>Match<select value={d.match} onChange={(e) => up((x) => { x.match = e.target.value; })}><option value="all">All rules (and)</option><option value="any">Any rule (or)</option></select></label>
        {d.rules.map((r, i) => {
          const kind = r.field.startsWith('var:') ? 'var' : r.field;
          return (
            <div key={i} className="wfb-box">
              <select value={kind} onChange={(e) => up((x) => { x.rules[i].field = e.target.value === 'var' ? `var:${varsOf(f)[0] || 'answer'}` : e.target.value; x.rules[i].op = e.target.value === 'tag' ? 'has' : 'eq'; })}>
                <option value="tag">Contact tag</option><option value="var">An answer / variable</option><option value="name">Name</option><option value="email">Email</option><option value="phone">Phone</option><option value="last_message">Last message</option>
                {data.crmFields.map((c) => <option key={c.id} value={`custom:${c.id}`}>CRM · {c.label}</option>)}
              </select>
              {kind === 'var' && <input list={`vars-${n.id}`} value={r.field.slice(4)} onChange={(e) => up((x) => { x.rules[i].field = `var:${e.target.value}`; })} placeholder="answer name" />}
              <datalist id={`vars-${n.id}`}>{varsOf(f).map((v) => <option key={v} value={v} />)}</datalist>
              <select value={r.op} onChange={(e) => up((x) => { x.rules[i].op = e.target.value; })}>{(r.field === 'tag' ? [['has', 'has'], ['not_has', 'doesn’t have']] : [['eq', 'is'], ['neq', 'is not'], ['contains', 'contains'], ['starts', 'starts with'], ['gt', 'is more than'], ['lt', 'is less than'], ['exists', 'is filled'], ['missing', 'is empty']]).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
              {!['exists', 'missing'].includes(r.op) && <input value={r.value} onChange={(e) => up((x) => { x.rules[i].value = e.target.value; })} placeholder={['gt', 'lt'].includes(r.op) ? '50000' : 'value'} />}
              {d.rules.length > 1 && <button className="btn ghost sm" onClick={() => up((x) => { x.rules.splice(i, 1); })}>Remove rule</button>}
            </div>
          );
        })}
        <button className="btn ghost sm" onClick={() => up((x) => { x.rules.push({ field: 'tag', op: 'has', value: '' }); })}><Icon name="plus" size={13} />Add rule</button>
      </>}
      {n.type === 'split' && <>
        <b className="sm">Paths <span className="muted">(2–4, by share of chats)</span></b>
        {d.branches.map((b, i) => (
          <div key={b.id} className="opt" style={{ gridTemplateColumns: '1fr 76px auto' }}>
            <input value={b.label} maxLength={24} onChange={(e) => up((x) => { x.branches[i].label = e.target.value; })} placeholder="Path name" />
            <label className="wfb-pct"><input type="number" min={1} max={100} value={b.weight} onChange={(e) => up((x) => { x.branches[i].weight = Math.min(100, Math.max(1, Number(e.target.value) || 1)); })} />%</label>
            <button className="icon-btn danger" disabled={d.branches.length <= 2} onClick={() => set((g) => { const x = g.nodes.find((y) => y.id === n.id); x.data.branches.splice(i, 1); g.edges = g.edges.filter((e) => !(e.from === n.id && e.port === b.id)); })} aria-label="Remove path"><Icon name="trash" size={14} /></button>
          </div>
        ))}
        {d.branches.length < 4 && <button className="btn ghost sm" onClick={() => up((x) => { x.branches.push({ id: rid('s'), label: `Path ${String.fromCharCode(65 + x.branches.length)}`, weight: 50 }); })}><Icon name="plus" size={13} />Add a path</button>}
        <p className="hint">Each chat goes down one path at random — test two welcome messages or offers and compare the “reached” counts.</p>
      </>}
      {n.type === 'hours' && <p className="hint">Uses the working hours in <Link to="/chatbots?tab=rules">Inbox automations</Link>. Send “Open now” to a person and “Closed” to a message saying when you’ll reply — or to the AI agent.</p>}
      {n.type === 'wait' && <WaitEditor d={d} up={up} />}
      {n.type === 'tag' && <label>Tags <span className="muted">(comma between them)</span><input defaultValue={d.add.join(', ')} onBlur={(e) => up((x) => { x.add = e.target.value.split(',').map((t) => t.trim()).filter(Boolean).slice(0, 10); })} placeholder="hot-lead, diwali-offer" /><span className="hint">An automation can start when a tag is added (Automations → “A tag is added”).</span></label>}
      {n.type === 'set' && <SetEditor d={d} up={up} data={data} f={f} />}
      {n.type === 'api' && <ApiEditor d={d} up={up} f={f} />}
      {n.type === 'goto' && <>
        <label>Carry on in<select value={d.flowId} onChange={(e) => up((x) => { x.flowId = e.target.value; })}><option value="">Choose a chatbot…</option>{data.flows.map((x) => <option key={x.id} value={x.id}>{x.name}{x.active ? '' : x.trigger.type === 'manual' ? ' (manual)' : ' (off)'}</option>)}</select></label>
        <p className="hint">That chatbot starts from its beginning with every answer collected so far — handy for a shared “book a call” or “main menu” chatbot. It runs even if it’s switched off.</p>
      </>}
      {n.type === 'ai_route' && <label>Topics <span className="muted">(the AI picks one; describe each so it can tell them apart)</span><Options items={d.intents} max={8} titleMax={40} fields={[['label', 'Topic'], ['desc', 'What it means']]} onChange={opts('intents')} /></label>}
      {n.type === 'ai_agent' && <><label>Extra instruction for the AI (optional)<textarea rows={3} value={d.note} onChange={(e) => up((x) => { x.note = e.target.value; })} placeholder="They want to buy — share the right link and ask for their city." /></label><p className="hint">The AI agent answers from what you set up in <Link to="/chatbots?tab=agent">AI agent</Link>, and hands over to your team when it should.</p></>}
      {n.type === 'handoff' && <>
        <label>Give the chat to<select value={d.assignee || ''} onChange={(e) => up((x) => { x.assignee = e.target.value; })}><option value="">Whoever’s free (your assignment rules)</option>{data.team.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        <label>Note for your team (optional)<input value={d.note} onChange={(e) => up((x) => { x.note = e.target.value; })} placeholder="Hot lead — call them today" /></label>
      </>}
      {n.type === 'webhook' && <label>Send the answers to<input value={d.url} onChange={(e) => up((x) => { x.url = e.target.value; })} placeholder="https://hooks.zapier.com/…" /><span className="hint">We POST the contact’s name, phone and every answer as JSON — for Zapier, Pabbly, Make or your own app. To use an answer back, use an API request step.</span></label>}
      {n.type === 'form' && <><FormEditor d={d} up={up} forms={forms} /><Timeout d={d} up={up} /></>}
      {n.type === 'end' && <label className="tog"><input type="checkbox" checked={!!d.resolve} onChange={(e) => up((x) => { x.resolve = e.target.checked; })} /><span />Mark the chat resolved</label>}
    </>
  );
}

// a button to a page: pick one of your live funnels or booking pages, or paste any link
function LinkEditor({ d, up, data }) {
  const pages = [
    ...data.funnels.map((x) => [`${pagesOrigin()}/f/${x.slug}`, `🧭 ${x.name}`]),
    ...(data.handle ? data.calendars.filter((c) => c.slug).map((c) => [`${location.origin}/meet/${data.handle}/${c.slug}`, `📅 Book: ${c.name}`]) : []),
  ];
  return (
    <>
      <label>Button text <span className="muted">(20 characters)</span><input value={d.label} maxLength={20} onChange={(e) => up((x) => { x.label = e.target.value; })} placeholder="Pay now" /></label>
      <label>Opens
        {pages.length > 0 && <select value={pages.some(([u]) => u === d.url) ? d.url : ''} onChange={(e) => e.target.value && up((x) => { x.url = e.target.value; if (!x.label || x.label === 'Open') x.label = e.target.selectedOptions[0].text.startsWith('📅') ? 'Book a slot' : 'Open'; })}><option value="">Pick a page you’ve made…</option>{pages.map(([u, l]) => <option key={u} value={u}>{l}</option>)}</select>}
        <input value={d.url} onChange={(e) => up((x) => { x.url = e.target.value; })} placeholder="https://… (a payment link, catalogue, Maps location…)" />
      </label>
      <details className="wfb-more"><summary>Photo on top & footer</summary>
        <label>Photo on top (optional)<input value={d.image || ''} onChange={(e) => up((x) => { x.image = e.target.value; })} placeholder="https://…/product.jpg" /></label>
        <label>Footer (optional)<input value={d.footer || ''} maxLength={60} onChange={(e) => up((x) => { x.footer = e.target.value; })} /></label>
      </details>
      <p className="hint">The link can use answers, e.g. https://…/track?phone={'{{phone}}'}. If a number can’t show link buttons yet, the link goes in the message instead.</p>
    </>
  );
}
function WaitEditor({ d, up }) {
  const unit = d.minutes % 1440 === 0 ? 'd' : d.minutes % 60 === 0 ? 'h' : 'm', per = { m: 1, h: 60, d: 1440 }[unit];
  return (
    <>
      <label>Wait for
        <div className="row" style={{ gap: 6 }}>
          <input type="number" min={1} style={{ width: 90 }} value={d.minutes / per} onChange={(e) => up((x) => { x.minutes = Math.min(43200, Math.max(1, Math.round((Number(e.target.value) || 1) * per))); })} />
          <select style={{ width: 'auto' }} value={unit} onChange={(e) => up((x) => { const p = { m: 1, h: 60, d: 1440 }[e.target.value]; x.minutes = Math.min(43200, Math.max(1, Math.round(x.minutes / per)) * p); })}><option value="m">minutes</option><option value="h">hours</option><option value="d">days</option></select>
        </div>
      </label>
      <span className="hint">{d.minutes > 1380 ? '⚠ Longer than 23 hours: WhatsApp only lets a template message go now, so connect this wait to a Template message step.' : 'Up to 23 hours for normal messages. Longer waits (up to 30 days) must be followed by a template message.'}</span>
    </>
  );
}
function SetEditor({ d, up, data, f }) {
  return (
    <>
      {d.actions.map((a, i) => {
        const pipe = data.pipelines.find((p) => p.id === a.key);
        return (
          <div key={i} className="wfb-box">
            <div className="row" style={{ gap: 6 }}>
              <select style={{ flex: 1 }} value={a.do} onChange={(e) => up((x) => { x.actions[i] = { do: e.target.value, key: e.target.value === 'field' ? 'email' : '', value: '' }; })}>{SET_DO.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
              <button className="icon-btn danger" onClick={() => up((x) => { x.actions.splice(i, 1); })} aria-label="Remove action"><Icon name="trash" size={14} /></button>
            </div>
            {a.do === 'var' && <><input value={a.key} onChange={(e) => up((x) => { x.actions[i].key = e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 31); })} placeholder="variable name, e.g. offer" /><TextField input label="to" value={a.value} onChange={(v) => up((x) => { x.actions[i].value = v; })} f={f} placeholder="Diwali 20% off" max={500} /></>}
            {a.do === 'field' && <><FieldSelect value={a.key} onChange={(v) => up((x) => { x.actions[i].key = v; })} crmFields={data.crmFields} none="" /><TextField input label="to" value={a.value} onChange={(v) => up((x) => { x.actions[i].value = v; })} f={f} placeholder="{{city}}" max={500} /></>}
            {a.do === 'untag' && <input value={a.key} onChange={(e) => up((x) => { x.actions[i].key = e.target.value; })} placeholder="tag to remove, e.g. cold-lead" />}
            {a.do === 'stage' && <>
              <select value={a.key} onChange={(e) => up((x) => { x.actions[i].key = e.target.value; x.actions[i].value = ''; })}><option value="">Choose a pipeline…</option>{data.pipelines.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
              {pipe && <select value={a.value} onChange={(e) => up((x) => { x.actions[i].value = e.target.value; })}><option value="">Choose the stage…</option>{pipe.stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>}
            </>}
            {a.do === 'optout' && <span className="hint" style={{ margin: 0 }}>They get no more WhatsApp messages from you (broadcasts, automations) until they subscribe again.</span>}
          </div>
        );
      })}
      {d.actions.length < 10 && <button className="btn ghost sm" onClick={() => up((x) => { x.actions.push({ do: 'var', key: '', value: '' }); })}><Icon name="plus" size={13} />Add an action</button>}
      <p className="hint">Moving someone to a stage can start an automation (Automations → “Moves to a stage”).</p>
    </>
  );
}
function ApiEditor({ d, up, f }) {
  return (
    <>
      <div className="row" style={{ gap: 6 }}>
        <select style={{ width: 92 }} value={d.method} onChange={(e) => up((x) => { x.method = e.target.value; })} aria-label="Method">{['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((m) => <option key={m}>{m}</option>)}</select>
        <input style={{ flex: 1 }} value={d.url} onChange={(e) => up((x) => { x.url = e.target.value; })} placeholder="https://api.yourshop.in/orders?phone={{phone}}" aria-label="Web address" />
      </div>
      <details className="wfb-more" open={d.headers.length > 0}><summary>Headers {d.headers.length > 0 && `(${d.headers.length})`}</summary>
        {d.headers.map((h, i) => (
          <div key={i} className="opt" style={{ gridTemplateColumns: '1fr 1.4fr auto' }}>
            <input value={h.key} onChange={(e) => up((x) => { x.headers[i].key = e.target.value.replace(/[^\w-]/g, ''); })} placeholder="Authorization" />
            <input value={h.value} onChange={(e) => up((x) => { x.headers[i].value = e.target.value; })} placeholder="Bearer …" />
            <button className="icon-btn danger" onClick={() => up((x) => { x.headers.splice(i, 1); })} aria-label="Remove header"><Icon name="trash" size={14} /></button>
          </div>
        ))}
        {d.headers.length < 10 && <button className="btn ghost sm" onClick={() => up((x) => { x.headers.push({ key: '', value: '' }); })}><Icon name="plus" size={13} />Add a header</button>}
      </details>
      {d.method !== 'GET' && <TextField label="Body (JSON)" rows={5} max={4000} value={d.body} onChange={(v) => up((x) => { x.body = v; })} f={f} placeholder={'{\n  "phone": "{{phone}}",\n  "name": "{{name}}"\n}'} />}
      <b className="sm">Save from the answer</b>
      {d.map.map((m, i) => (
        <div key={i} className="opt" style={{ gridTemplateColumns: '1fr 1.3fr auto' }}>
          <input value={m.var} onChange={(e) => up((x) => { x.map[i].var = e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 31); })} placeholder="variable" />
          <input value={m.path} onChange={(e) => up((x) => { x.map[i].path = e.target.value; })} placeholder="order.status" />
          <button className="icon-btn danger" onClick={() => up((x) => { x.map.splice(i, 1); })} aria-label="Remove"><Icon name="trash" size={14} /></button>
        </div>
      ))}
      {d.map.length < 10 && <button className="btn ghost sm" onClick={() => up((x) => { x.map.push({ var: '', path: '' }); })}><Icon name="plus" size={13} />Save a value</button>}
      <p className="hint">The path picks a value from the JSON answer: <code>order.status</code>, <code>items.0.name</code>. The HTTP status is in {'{{api_status}}'}. “Worked” runs for 2xx answers, “Didn’t work” for errors or no answer within 8 seconds. The Test phone really calls your API.</p>
    </>
  );
}

// the WhatsApp form node: the screen, its questions (each can be saved on the contact) and publishing on Meta
function FormEditor({ d, up, forms }) {
  const setField = (i, fn) => up((x) => { fn(x.fields[i]); });
  const move = (i, by) => up((x) => { const [it] = x.fields.splice(i, 1); x.fields.splice(i + by, 0, it); });
  const add = () => up((x) => { x.fields.push({ id: rid('q'), type: 'text', label: '', required: false, var: `answer_${x.fields.length + 1}`, save: '' }); });
  return (
    <>
      <label>Form title<input value={d.title} maxLength={30} onChange={(e) => up((x) => { x.title = e.target.value; })} /></label>
      <div className="row" style={{ gap: 8 }}>
        <label style={{ flex: 1 }}>Button to open it<input value={d.cta} maxLength={20} onChange={(e) => up((x) => { x.cta = e.target.value; })} /></label>
        <label style={{ flex: 1 }}>Submit button<input value={d.submit} maxLength={30} onChange={(e) => up((x) => { x.submit = e.target.value; })} /></label>
      </div>
      <b className="sm">Questions <span className="muted">(up to 8)</span></b>
      {d.fields.map((q, i) => (
        <div key={q.id} className="wff-q">
          <div className="row" style={{ gap: 6 }}>
            <input style={{ flex: 1 }} value={q.label} maxLength={labelMax(q.type)} placeholder="Question, e.g. Your name" onChange={(e) => setField(i, (x) => { const auto = !x.var || x.var === toVar(x.label) || /^answer_\d+$/.test(x.var); x.label = e.target.value; if (auto) x.var = toVar(e.target.value); })} />
            <button className="icon-btn" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Move up" title="Move up">↑</button>
            <button className="icon-btn danger" onClick={() => up((x) => { x.fields.splice(i, 1); })} aria-label="Remove question"><Icon name="trash" size={14} /></button>
          </div>
          <div className="row" style={{ gap: 6 }}>
            <select value={q.type} onChange={(e) => setField(i, (x) => { x.type = e.target.value; x.label = x.label.slice(0, labelMax(x.type)); if (CHOICE.includes(x.type) && !x.options?.length) x.options = [{ id: 'o1', title: '' }, { id: 'o2', title: '' }]; })}>{FIELD_TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
            <label className="tog" style={{ margin: 0 }}><input type="checkbox" checked={!!q.required} onChange={(e) => setField(i, (x) => { x.required = e.target.checked; })} /><span />Required</label>
          </div>
          {CHOICE.includes(q.type) && <Options items={q.options || []} max={10} titleMax={30} onChange={(list) => setField(i, (x) => { x.options = list; })} />}
          <select value={q.save || ''} onChange={(e) => setField(i, (x) => { x.save = e.target.value; })} title="Where the answer is saved on the contact">
            <option value="">Don’t save to the CRM</option><option value="name">Save to CRM → Name</option><option value="email">Save to CRM → Email</option><option value="phone">Save to CRM → Phone</option>
            {forms.crmFields.map((c) => <option key={c.id} value={`custom:${c.id}`}>Save to CRM → {c.label}</option>)}
          </select>
          <span className="hint" style={{ margin: 0 }}>Use it later as {`{{${q.var}}}`}</span>
        </div>
      ))}
      {d.fields.length < 8 && <button className="btn ghost sm" onClick={add}><Icon name="plus" size={13} />Add question</button>}
      <div className="wff-pub">
        {!forms.meta ? <p className="hint" style={{ margin: 0 }}>WhatsApp forms need a direct Meta connection (Settings → Channels → WhatsApp Business account ID and token). Until then the chatbot asks these questions one by one in the chat.</p>
          : <>
            <p className="hint" style={{ margin: 0 }}>{forms.live ? '✅ Published — customers get this as a form inside WhatsApp.' : forms.published ? 'Changed since you published it — publish again so customers get the new form. Until then the chatbot asks the questions one by one.' : 'Publish it once on WhatsApp so customers fill it inside the chat. Until then the chatbot asks the questions one by one.'}</p>
            {!forms.live && <button className="btn primary sm" onClick={forms.publish} disabled={forms.busy || !forms.saved || !d.fields.length} title={forms.saved ? '' : 'Save the chatbot first'}>{forms.busy ? <span className="spin" /> : <Icon name="send" size={13} />}{forms.published ? 'Publish again' : 'Publish form'}</button>}
          </>}
      </div>
    </>
  );
}

// a wa.me link (and its QR code) that opens WhatsApp with the keyword typed in — for ads, posters, bios, packaging
function ShareLink({ number, keyword }) {
  const url = `https://wa.me/${number}?text=${encodeURIComponent(keyword)}`;
  const [qr, setQr] = useState('');
  useEffect(() => { let on = true; import('qrcode').then((m) => m.toDataURL(url, { margin: 1, width: 360, errorCorrectionLevel: 'M' })).then((d) => on && setQr(d)).catch(() => {}); return () => { on = false; }; }, [url]);
  return (
    <div className="wfb-share">
      <b className="sm">Share this chatbot</b>
      <div className="row" style={{ gap: 6 }}><input readOnly value={url} onFocus={(e) => e.target.select()} /><button className="btn ghost sm" onClick={() => { navigator.clipboard?.writeText(url); toast('Link copied'); }}><Icon name="copy" size={13} />Copy</button></div>
      {qr && <div className="row" style={{ gap: 10, alignItems: 'center' }}><img src={qr} alt="QR code that opens this chatbot on WhatsApp" width={96} height={96} /><span className="hint" style={{ margin: 0 }}>Opens WhatsApp with “{keyword}” typed in. Put the QR on posters, packaging or your shop counter. <a href={qr} download={`whatsapp-${keyword}.png`}>Download QR</a></span></div>}
    </div>
  );
}

function FlowSettings({ f, set, probs, onPick, compact, number }) {
  const t = f.trigger;
  return (
    <>
      {!compact && <><b>Chatbot settings</b><p className="hint" style={{ margin: 0 }}>Click a step to edit it. Drag from a ● to connect steps — or into empty space to add the next one. Click a line to remove it. Ctrl+Z undo · Ctrl+D duplicate · Ctrl+C / V copy · Delete removes · Ctrl+S saves.</p></>}
      <label>Starts when
        <select value={t.type} onChange={(e) => set((g) => { g.trigger.type = e.target.value; })}>{Object.entries(TRIG).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
      </label>
      {t.type === 'keyword' && <>
        <label>Keywords <span className="muted">(comma between them)</span><input defaultValue={t.keywords.join(', ')} onBlur={(e) => set((g) => { g.trigger.keywords = e.target.value.split(',').map((k) => k.trim().toLowerCase()).filter(Boolean).slice(0, 20); })} placeholder="hi, price, menu" /></label>
        <label className="tog"><input type="checkbox" checked={t.match === 'exact'} onChange={(e) => set((g) => { g.trigger.match = e.target.checked ? 'exact' : 'contains'; })} /><span />Only when the whole message is the keyword</label>
        {!compact && number && t.keywords[0] && <ShareLink number={number} keyword={t.keywords[0]} />}
      </>}
      {t.type === 'welcome' && <p className="hint">Runs once, for someone messaging you for the first time. Only one welcome chatbot can be live.</p>}
      {t.type === 'default' && <p className="hint">Answers any message that no keyword chatbot or person is handling. Only one can be live.</p>}
      {t.type === 'manual' && <p className="hint">Start it on a chat from the inbox (Reply → ☰ → Run a chatbot here), or from another chatbot’s “Go to chatbot” step.</p>}
      {t.type === 'ad' && <>
        <label>Only for these ads <span className="muted">(optional — ad IDs, comma between them)</span><input defaultValue={(t.adIds || []).join(', ')} onBlur={(e) => set((g) => { g.trigger.adIds = e.target.value.split(',').map((k) => k.trim()).filter(Boolean).slice(0, 20); })} placeholder="Leave empty for any ad" /></label>
        <p className="hint">Runs when someone taps “Send WhatsApp message” on your ad. Find the ad ID in Ads Manager, or on a chat from that ad in the inbox. A chatbot for a specific ad wins over one for any ad.</p>
      </>}
      <p className="hint">Anyone can type “talk to a person” to reach your team, and a person replying in the inbox always pauses the chatbot.</p>
      {!compact && probs.length > 0 && <div className="wfb-probs"><b className="sm">To fix before going live</b>{probs.map((p, i) => <button key={i} onClick={() => onPick(p.node)}>⚠ {p.msg}</button>)}</div>}
    </>
  );
}

// the builder's test phone: runs the flow on the server as a dry run (nothing is sent or saved; API steps really call)
function TestPhone({ f, onNode }) {
  const [msgs, setMsgs] = useState([]);
  const [st, setSt] = useState(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [tags, setTags] = useState([]);
  const box = useRef();
  useEffect(() => { box.current && (box.current.scrollTop = box.current.scrollHeight); }, [msgs, busy]);
  const STAGE = 'Moved to a pipeline stage';
  const FX = {
    form: (e) => `📋 Form filled: ${e.answers.map((a) => `${a.label}: ${a.value}`).join(' · ') || 'no answers'}`, tag: (e) => `🏷 Tagged: ${e.tags.join(', ')}`, untag: (e) => `🏷 Tag removed: ${e.tags.join(', ')}`, save: (e) => `💾 Saved ${e.field.replace('custom:', 'CRM ')}: ${e.value}`,
    handoff: (e) => `🙋 Handed to your team${e.note ? ` — ${e.note}` : ''}`, webhook: (e) => `🔗 Sent answers to ${e.url}`, route: (e) => `✦ AI picked: ${e.intent}`, agent: () => '✦ The AI agent takes over', end: (e) => (e.resolve ? '✅ Chat resolved' : '— end of chatbot —'),
    api: (e) => (e.ok ? `🌐 API answered (${e.status})` : `🌐 API didn’t work (${e.status || e.error || 'no answer'})`), stage: () => `📊 ${STAGE}`, optout: () => '🔕 Unsubscribed from WhatsApp', optin: () => '🔔 Subscribed again',
    split: (e) => `🔀 Random split: ${e.label}`, goto: () => '↪ Carries on in another chatbot', timeout: (e) => `⏱ No reply in ${dur(e.minutes || 0)}`,
  };
  const send = async (input, shown) => {
    if (busy) return;
    const next = shown === null ? msgs : [...msgs, { dir: 'in', text: shown ?? input.text }];
    setMsgs(next); setText(''); setBusy(true);
    try {
      const r = await api('/waflows/simulate', 'POST', { flow: f, state: st, input, tags, history: next.filter((m) => m.dir && m.text) });
      const add = [...r.out.map((o) => ({ dir: 'out', ...o })), ...r.fx.flatMap((e) => [...(e.type === 'handoff' && e.text ? [{ dir: 'out', kind: 'text', text: e.text }] : []), { fx: FX[e.type]?.(e) }])].filter((m) => !('fx' in m) || m.fx);
      if (r.agent) add.push({ dir: 'out', ai: true, text: r.agent.reply, buttons: r.agent.buttons.map((b, i) => ({ id: `ai${i}`, title: b })), kind: r.agent.buttons.length ? 'buttons' : 'text' }, ...(r.agent.cards || []).map((c) => ({ dir: 'out', card: c })), ...(r.agent.sendNames || []).map((n) => ({ fx: `📎 Would send: ${n}` })), ...(r.agent.handoff ? [{ fx: `🙋 AI handed over — ${r.agent.reason}` }] : []));
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
  const waitNode = st?.wait === 'reply' && f.nodes.find((n) => n.id === st.node);
  const wants = waitNode?.type === 'ask' ? waitNode.data.validate : '';
  return (
    <div className="phone">
      <div className="phone-h"><span className="cav sm" style={{ background: '#00a884' }}><Icon name="bot" size={15} /></span><div>Test chat<small>{st?.wait === 'time' ? 'waiting (a real chat would pause here)' : 'nothing is sent to anyone'}</small></div><button className="icon-btn" onClick={reset} title="Start again" aria-label="Start again"><Icon name="undo" size={16} /></button></div>
      <div className="phone-b" ref={box}>
        {!msgs.length && <div className="fxn">Type as your customer would — {f.trigger.type === 'keyword' ? `e.g. “${f.trigger.keywords[0] || 'hi'}”` : '“Hi”'} — to start</div>}
        {msgs.map((m, i) => m.fx ? <div key={i} className="fxn">{m.fx}</div> : m.card ? <ProductBubble key={i} c={m.card} /> : (
          <div key={i} className={`bub ${m.dir === 'in' ? 'b-out' : 'b-in'}`} style={m.dir === 'in' ? undefined : m.ai ? { border: '1.5px solid #8b5cf6' } : undefined}>
            {m.ai && <div className="by"><span className="ai-txt">✦ AI agent</span></div>}
            {m.kind === 'template' && <div className="by">📨 Template · {m.template?.name}</div>}
            {m.image && <span className="pill">📷 photo</span>}{m.kind === 'media_link' && <span className="pill">{MEDIA.find((x) => x[0] === m.media?.type)?.[1] || '📎 file'}</span>}
            {m.header && <b style={{ display: 'block' }}>{m.header}</b>}
            {waFmt(m.text)}
            {m.footer && <small style={{ display: 'block', color: '#667781', marginTop: 4 }}>{m.footer}</small>}
            {m.kind === 'list' && <div className="bub-btns"><span>☰ {m.button}</span></div>}
            {m.kind === 'cta' && <div className="bub-btns"><a href={m.cta.url} target="_blank" rel="noreferrer">🔗 {m.cta.label}</a></div>}
          </div>
        ))}
        {opts && <div className="opts">{opts.map((o) => <button key={o.id} onClick={() => send({ text: o.title, id: o.id }, o.title)}>{o.title}</button>)}</div>}
        {wants === 'location' && <div className="opts"><button onClick={() => send({ text: '', location: true }, '📍 Location: Mumbai')}>📍 Share a location</button></div>}
        {wants === 'file' && <div className="opts"><button onClick={() => send({ text: '', file: true }, '📷 photo.jpg')}>📎 Send a photo</button></div>}
        {st?.until && <div className="opts"><button className="late" onClick={() => send({ text: '', timeout: true }, null)}>⏱ Pretend they didn’t reply</button></div>}
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
            <select value={preset} onChange={(e) => setPreset(e.target.value)} aria-label="Industry">{a.presets.map((x) => <option key={x.id} value={x.id}>{x.name}{x.id === a.industry ? ' (your industry)' : ''}</option>)}</select>
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
        <ShopifyStore />
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
        ...(r.cards || []).map((c) => ({ dir: 'out', card: c })),
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
        {msgs.map((m, i) => m.fx ? <div key={i} className="fxn">{m.fx}</div> : m.card ? <ProductBubble key={i} c={m.card} /> : <div key={i} className={`bub ${m.dir === 'in' ? 'b-out' : 'b-in'}`}>{waFmt(m.text)}</div>)}
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

// a Shopify product card as the customer sees it on WhatsApp: photo, name, price, and the Buy now button
const ProductBubble = ({ c }) => (
  <div className="bub b-in shp-card">
    {c.image && <img src={c.image} alt="" loading="lazy" />}
    {waFmt(c.text)}
    {c.cta && <div className="bub-btns"><a href={c.cta.url} target="_blank" rel="noreferrer">🛒 {c.cta.label}</a></div>}
  </div>
);

// ---------- Shopify: the agent searches the store's live catalogue and policies, and sends products ----------
function ShopifyStore() {
  const [s, setS] = useState(undefined);
  const [host, setHost] = useState('');
  const [tok, setTok] = useState({ adminHost: '', adminToken: '' });
  const [q, setQ] = useState('');
  const [res, setRes] = useState(null);
  const [busy, setBusy] = useState('');
  useEffect(() => { api('/shopify').then((r) => setS(r.store)).catch(() => setS(null)); }, []);
  const put = async (body, what) => {
    setBusy(what);
    try { const r = await api('/shopify', 'PUT', body); setS(r.store); setTok({ adminHost: '', adminToken: '' }); toast(what === 'connect' ? '🛍 Store connected — try a search below' : what === 'token' ? (body.adminToken ? 'Order status switched on' : 'Order status switched off') : 'Saved'); } catch (e) { toast(e.message); }
    setBusy('');
  };
  const disconnect = async () => { if (!await confirmDialog({ title: 'Disconnect your Shopify store?', text: 'The agent stops recommending products and checking orders.', confirm: 'Disconnect', danger: true })) return; await api('/shopify', 'DELETE'); setS(null); setRes(null); };
  const tryIt = async (e) => { e.preventDefault(); setBusy('try'); try { setRes(await api('/shopify/try', 'POST', { query: q })); } catch (er) { toast(er.message); } setBusy(''); };
  if (s === undefined) return null;
  return (
    <Panel title={<span className="row" style={{ gap: 8 }}><span className="shp-logo">S</span>Shopify store</span>} actions={s && <button className="btn ghost sm" onClick={disconnect}>Disconnect</button>}>
      {!s ? (
        <form className="shp-connect" onSubmit={(e) => { e.preventDefault(); put({ host }, 'connect'); }}>
          <p className="hint" style={{ margin: 0 }}>Sell on Shopify? Connect it and the agent answers from your live store — products, prices, sizes in stock and your policies — and sends products as cards with a <b>Buy now</b> button straight to checkout. Nothing to install.</p>
          <div className="row" style={{ flexWrap: 'nowrap' }}><input value={host} onChange={(e) => setHost(e.target.value)} placeholder="mystore.myshopify.com or www.mystore.in" aria-label="Store address" /><button className="btn primary" disabled={!host.trim() || busy === 'connect'}>{busy === 'connect' ? <span className="spin" /> : null}Connect</button></div>
        </form>
      ) : (
        <div style={{ display: 'grid', gap: 14 }}>
          <div className="shp-head"><span className="cb-live">Connected</span><b>{s.name || s.host}</b>{s.name && s.name !== s.host && <small className="muted">{s.host}</small>}
            <select value={s.country} onChange={(e) => put({ country: e.target.value }, 'country')} aria-label="Customers’ country" title="Prices and stock for customers in">{[['IN', '🇮🇳 India'], ['AE', '🇦🇪 UAE'], ['US', '🇺🇸 USA'], ['GB', '🇬🇧 UK'], ['SG', '🇸🇬 Singapore'], ['AU', '🇦🇺 Australia'], ['CA', '🇨🇦 Canada']].map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          </div>
          <form className="row" style={{ flexWrap: 'nowrap' }} onSubmit={tryIt}><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Try what a customer asks — “red saree under 3000”, “return policy”" /><button className="btn ghost" disabled={!q.trim() || busy === 'try'}>{busy === 'try' ? <span className="spin dark" /> : <Icon name="search" size={14} />}Search</button></form>
          {res && <div className="shp-res">
            {!res.products.length && <p className="hint" style={{ margin: 0 }}>No products matched — the agent would say so and ask what they’re looking for.</p>}
            {res.products.map((p) => (
              <a key={p.id} className={`shp-p ${p.available ? '' : 'out'}`} href={p.checkout || p.url} target="_blank" rel="noreferrer">
                {p.image ? <img src={p.image} alt="" loading="lazy" /> : <span className="shp-noimg" />}
                <span><b>{p.title}</b><small>{p.price}{p.mrp && <s> {p.mrp}</s>} · {p.available ? (p.options.length ? p.options.slice(0, 6).join(', ') : 'in stock') : 'out of stock — never offered'}</small></span>
              </a>
            ))}
            {res.policies.slice(0, 2).map((x, i) => <p key={i} className="shp-pol"><b>{x.q}</b><br />{x.a}</p>)}
          </div>}
          <details className="wfb-more" open={!s.admin && !!tok.adminToken}>
            <summary>{s.admin ? '✅ Order status is on — the agent answers “where’s my order?” with tracking' : 'Let it answer “where’s my order?” (optional)'}</summary>
            {s.admin ? <button className="btn ghost sm" style={{ justifySelf: 'start' }} onClick={() => put({ adminToken: '' }, 'token')}>Switch off order status</button> : <>
              <p className="hint" style={{ margin: 0 }}>In Shopify admin → Settings → Apps and sales channels → Develop apps: create an app, give it the <b>read_orders</b> permission, install it and copy the Admin API access token (starts with shpat_). The agent looks up orders by the customer’s WhatsApp number.</p>
              {!s.host.endsWith('.myshopify.com') && <input value={tok.adminHost} onChange={(e) => setTok({ ...tok, adminHost: e.target.value })} placeholder="yourstore.myshopify.com (Shopify admin → Settings → Domains)" />}
              <div className="row" style={{ flexWrap: 'nowrap' }}><input type="password" autoComplete="off" value={tok.adminToken} onChange={(e) => setTok({ ...tok, adminToken: e.target.value })} placeholder="shpat_…" aria-label="Admin API access token" /><button className="btn ghost" disabled={!tok.adminToken || busy === 'token'} onClick={() => put({ adminToken: tok.adminToken, adminHost: tok.adminHost }, 'token')}>Save</button></div>
            </>}
          </details>
        </div>
      )}
    </Panel>
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
      <p className="hint top">Price lists, catalogues, brochures, policies — PDF, Word, Excel, PowerPoint, CSV, or photos (JPG, PNG), up to 15 MB each. Scanned PDFs and photos of price lists are read too. The agent answers from the right page and can send the file on WhatsApp — for a long PDF, just the pages that answer the customer. Catalogues also get their products listed (name, code, price).</p>
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
                <select value={x.lang} onChange={(e) => act(() => api(`/wa-agent/docs/${x.id}`, 'PATCH', { lang: e.target.value }), 'Reading it again')} style={{ width: 'auto', height: 30, fontSize: 12 }} aria-label="Language" title="The language it’s written in — Indian languages are read with an Indian-language model"><option value="auto">Any language</option>{Object.entries(d.languages || {}).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
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
  const aiRules = async (prompt) => { const d = (await api('/inbox/rules/ai', 'POST', { prompt })).draft; setR((cur) => ({ ...cur, rules: { ...cur.rules, ...d } })); toast('Set up — check the rules below, then save'); };
  return (
    <div className="rules cb">
      <AiPrompt title="Set up with AI" hint="Describe how your inbox should run" placeholder="e.g. Open 10 to 7, Monday to Saturday. Alert me if a chat waits 20 minutes. Tag price questions as Pricing" onDraft={aiRules} />
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
