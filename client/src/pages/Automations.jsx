import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  Clock, Mail, MessageCircle, Tag, ArrowRightLeft, Webhook, BellRing, Zap, Plus, Trash2, ChevronUp, ChevronDown, Copy, UserPlus,
  ShoppingBag, TrendingUp, ShoppingCart, Kanban, AlertTriangle, ArrowLeft, Square, Workflow, Sparkles, GitBranch, CircleStop, Send, Link2, Hand, Split, CalendarDays, History,
} from 'lucide-react';
import { api } from '../api';
import { useBizTz, zoneCity } from '../tzfmt';
import { Layout, Panel, Empty, Modal, toast, ago, num } from '../ui';

const BRANCH_KEYS = { condition: ['yes', 'no'], split: ['a', 'b'] };
const BRANCH_TITLE = { yes: '✓ Yes', no: '✕ No', a: 'Path A', b: 'Path B' };
const flatSteps = (list, out = []) => { for (const s of list || []) { out.push(s); for (const b of BRANCH_KEYS[s.type] || []) flatSteps(s[b], out); } return out; };

const STEP = {
  wait: { label: 'Wait', icon: Clock, color: '#64748b' },
  email: { label: 'Send email', icon: Mail, color: '#6366f1' },
  whatsapp: { label: 'Send WhatsApp', icon: MessageCircle, color: '#16a34a' },
  tag: { label: 'Add / remove tag', icon: Tag, color: '#d97706' },
  stage: { label: 'Move pipeline stage', icon: ArrowRightLeft, color: '#0ea5e9' },
  notify: { label: 'Email me', icon: BellRing, color: '#ec4899' },
  webhook: { label: 'Send to webhook', icon: Webhook, color: '#475569' },
  condition: { label: 'If / else', icon: GitBranch, color: '#8b5cf6' },
  split: { label: 'A/B split', icon: Split, color: '#0891b2' },
  exit: { label: 'End automation', icon: CircleStop, color: '#ef4444' },
};
const TRIGGER_ICON = { lead: UserPlus, purchase: ShoppingBag, offer: TrendingUp, abandoned: ShoppingCart, stage: Kanban, tag: Tag, inbound: Link2, manual: Hand, date: CalendarDays };
const tempId = () => `n${Math.random().toString(36).slice(2, 10)}`;
const newStep = (type) => ({ id: tempId(), ...({
  wait: { type, amount: 1, unit: 'days' },
  email: { type, subject: '', body: '' },
  whatsapp: { type, mode: 'template', template: '', language: 'en', params: '{{first_name}}' },
  tag: { type, tag: '', action: 'add' },
  stage: { type, pipelineId: '', stageId: '' },
  notify: { type, subject: 'New activity: {{name}}', body: '' },
  webhook: { type, url: '' },
  condition: { type, match: 'all', rules: [{ field: 'has', op: 'is', value: 'phone' }], yes: [], no: [] },
  split: { type, percent: 50, a: [], b: [] },
  exit: { type },
})[type] });

const RECIPES = [
  {
    key: 'welcome', icon: UserPlus, title: 'Welcome new leads', text: 'Welcome email right away, a helpful follow-up the next day and a WhatsApp nudge on day 3. Stops if they buy.',
    a: { name: 'Welcome new leads', trigger: { type: 'lead' }, stopOnPurchase: true, steps: [
      { type: 'email', subject: 'Welcome, {{first_name}}! Here’s what’s next', body: 'Hi {{first_name}},\n\nThanks for signing up! Here’s the link to get started:\n{{funnel_link}}\n\nReply to this email if you have any questions.\n\n— {{business}}' },
      { type: 'wait', amount: 1, unit: 'days' },
      { type: 'email', subject: '{{first_name}}, a quick tip to get results faster', body: 'Hi {{first_name}},\n\nMost people who succeed with this start with one small step today.\n\nWhen you’re ready, everything is here: {{funnel_link}}\n\n— {{business}}' },
      { type: 'wait', amount: 2, unit: 'days' },
      { type: 'whatsapp', mode: 'template', template: 'lead_followup', language: 'en', params: '{{first_name}}, {{funnel_link}}' },
    ] },
  },
  {
    key: 'cart', icon: ShoppingCart, title: 'Abandoned checkout recovery', text: 'Started checkout but didn’t pay? Email after 30 minutes, WhatsApp next day, last-chance email on day 2.',
    a: { name: 'Abandoned checkout recovery', trigger: { type: 'abandoned', delayMin: 30 }, stopOnPurchase: true, steps: [
      { type: 'email', subject: '{{first_name}}, you left something behind', body: 'Hi {{first_name}},\n\nYou were just one step away from {{product}}. Your order is saved — finish it here:\n{{checkout_link}}\n\n— {{business}}' },
      { type: 'wait', amount: 1, unit: 'days' },
      { type: 'whatsapp', mode: 'template', template: 'cart_reminder', language: 'en', params: '{{first_name}}, {{product}}, {{checkout_link}}' },
      { type: 'wait', amount: 1, unit: 'days' },
      { type: 'email', subject: 'Last chance: {{product}}', body: 'Hi {{first_name}},\n\nThis is a final reminder — complete your order here:\n{{checkout_link}}\n\n— {{business}}' },
    ] },
  },
  {
    key: 'smart', icon: GitBranch, title: 'WhatsApp if possible, else email', text: 'An hour after sign-up: WhatsApp the people who gave a phone number, email everyone else. Uses If / else.',
    a: { name: 'Follow up on the best channel', trigger: { type: 'lead' }, stopOnPurchase: true, steps: [
      { type: 'wait', amount: 1, unit: 'hours' },
      { type: 'condition', match: 'all', rules: [{ field: 'has', op: 'is', value: 'phone' }],
        yes: [{ type: 'wait', mode: 'until', time: '10:00' }, { type: 'whatsapp', mode: 'template', template: 'lead_followup', language: 'en', params: '{{first_name}}, {{funnel_link}}' }],
        no: [{ type: 'email', subject: '{{first_name}}, your next step', body: 'Hi {{first_name}},\n\nHere’s everything you need to get started:\n{{funnel_link}}\n\n— {{business}}' }] },
    ] },
  },
  {
    key: 'thanks', icon: ShoppingBag, title: 'Thank buyers & check in', text: 'Thank-you email on purchase, tag them as a customer, check in after 3 days.',
    a: { name: 'Thank buyers & check in', trigger: { type: 'purchase' }, stopOnPurchase: false, steps: [
      { type: 'email', subject: 'Thank you for your order, {{first_name}}! 🎉', body: 'Hi {{first_name}},\n\nThank you for buying {{product}} ({{amount}}). You’ll get access details shortly.\n\n— {{business}}' },
      { type: 'tag', tag: 'customer', action: 'add' },
      { type: 'wait', amount: 3, unit: 'days' },
      { type: 'email', subject: 'How is it going, {{first_name}}?', body: 'Hi {{first_name}},\n\nJust checking in — is everything working well with {{product}}? Hit reply and tell us.\n\n— {{business}}' },
    ] },
  },
  {
    key: 'notify', icon: BellRing, title: 'Tell me about every sale', text: 'An email to you for each new order, with the buyer’s details.',
    a: { name: 'Tell me about every sale', trigger: { type: 'purchase' }, stopOnPurchase: false, steps: [{ type: 'notify', subject: '💰 New sale: {{product}} — {{amount}}', body: '{{name}} just bought {{product}} for {{amount}}.' }] },
  },
];

export default function Automations() {
  const { id } = useParams();
  return id ? <Builder id={id} /> : <List />;
}

function ChannelBanner({ channels }) {
  if (!channels || (channels.email && channels.whatsapp)) return null;
  const miss = [!channels.email && 'email (SMTP)', !channels.whatsapp && 'WhatsApp'].filter(Boolean).join(' and ');
  return <div className="au-banner"><AlertTriangle size={16} /><span>Connect {miss} in <Link to="/settings">Settings</Link> — until then those steps are skipped and noted on each contact’s timeline.</span></div>;
}

function List() {
  const nav = useNavigate();
  const [d, setD] = useState(null);
  const [pick, setPick] = useState(false);
  const load = () => api('/automations').then(setD);
  useEffect(() => { load(); }, []);
  const create = async (body) => { try { const a = await api('/automations', 'POST', body); nav(`/automations/${a.id}`); } catch (e) { toast(e.message); } };
  const toggle = async (a) => { try { await api(`/automations/${a.id}`, 'PUT', { active: !a.active }); load(); toast(a.active ? 'Automation paused' : 'Automation is live'); } catch (e) { toast(e.message); nav(`/automations/${a.id}`); } };
  const stripIds = (list) => list.map(({ id: _, ...s }) => { for (const b of BRANCH_KEYS[s.type] || []) s[b] = stripIds(s[b]); return s; });
  const dup = (a) => create({ name: `${a.name} copy`, trigger: a.trigger, steps: stripIds(a.steps), stopOnPurchase: a.stopOnPurchase, allowRepeat: a.allowRepeat });
  const del = async (a) => { if (!confirm(`Delete “${a.name}”? Contacts in it stop receiving its messages.`)) return; await api(`/automations/${a.id}`, 'DELETE'); load(); };
  return (
    <Layout title="Automations" subtitle="Follow up automatically — emails, WhatsApp, tags and pipeline moves." actions={<button className="btn primary" onClick={() => setPick(true)}><Plus size={16} /> New automation</button>}>
      {!d ? <div className="skeleton" /> : (
        <>
          <ChannelBanner channels={d.channels} />
          {!d.automations.length ? (
            <Panel><Empty icon="flow" title="No automations yet" text="Start from a ready-made recipe — abandoned checkout recovery is the quickest win for most funnels."><button className="btn primary" onClick={() => setPick(true)}><Sparkles size={15} /> Browse recipes</button></Empty></Panel>
          ) : (
            <div className="au-grid">
              {d.automations.map((a) => {
                const TI = TRIGGER_ICON[a.trigger.type] || Zap;
                return (
                  <article key={a.id} className={`au-card ${a.active ? 'on' : ''}`}>
                    <header>
                      <span className="au-ti"><TI size={16} /></span>
                      <Link to={`/automations/${a.id}`} className="au-name">{a.name}</Link>
                      <label className="tog" title={a.active ? 'Pause' : 'Turn on'}><input type="checkbox" checked={a.active} onChange={() => toggle(a)} /><span /></label>
                    </header>
                    <p className="au-when">When {d.triggers[a.trigger.type]?.toLowerCase().replace(/^someone /, 'someone ')}</p>
                    <div className="au-chain">{a.steps.slice(0, 8).map((s) => { const I = STEP[s.type]?.icon || Zap; return <span key={s.id} title={s.type === 'condition' ? `If / else (${s.yes.length} yes · ${s.no.length} no steps)` : s.type === 'split' ? `A/B split ${s.percent}/${100 - s.percent}` : STEP[s.type]?.label} style={{ '--sc': STEP[s.type]?.color }}><I size={13} /></span>; })}{a.steps.length > 8 && <small>+{a.steps.length - 8}</small>}</div>
                    <footer>
                      <span><b>{num(a.running)}</b> in progress</span><span><b>{num(a.stats?.completed || 0)}</b> completed</span>
                      <span className="au-acts"><button className="icon-btn" title="Duplicate" onClick={() => dup(a)}><Copy size={15} /></button><button className="icon-btn danger" title="Delete" onClick={() => del(a)}><Trash2 size={15} /></button></span>
                    </footer>
                  </article>
                );
              })}
            </div>
          )}
        </>
      )}
      {pick && (
        <Modal title="New automation" onClose={() => setPick(false)} width={720}>
          <div className="m-body recipes">
            {RECIPES.map((r) => <button key={r.key} className="recipe" onClick={() => create(r.a)}><span className="au-ti"><r.icon size={18} /></span><b>{r.title}</b><small>{r.text}</small></button>)}
            <button className="recipe blank" onClick={() => create({ name: 'New automation', trigger: { type: 'lead' }, steps: [] })}><span className="au-ti"><Plus size={18} /></span><b>Start from scratch</b><small>Choose a trigger and add your own steps.</small></button>
          </div>
        </Modal>
      )}
    </Layout>
  );
}

// ---------------- builder ----------------
const clone = (x) => JSON.parse(JSON.stringify(x));
// a list path is pairs of [stepIndex, 'yes' | 'no'] from the top-level list
const listRef = (steps, path) => { let l = steps; for (let k = 0; k < path.length; k += 2) l = l[path[k]][path[k + 1]]; return l; };
const posLabel = (pos = []) => pos.map((x) => (typeof x === 'number' ? x + 1 : { yes: 'Yes', no: 'No', a: 'A', b: 'B' }[x] || x)).join(' → ');
const OPS = {
  bought: [['is', 'has bought'], ['not', 'has not bought']],
  tag: [['is', 'has the tag'], ['not', 'doesn’t have the tag']],
  stage: [['is', 'is in stage'], ['not', 'is not in stage']],
  has: [['is', 'has'], ['not', 'doesn’t have']],
  source: [['equals', 'is'], ['not_equals', 'is not'], ['contains', 'contains']],
  custom: [['equals', 'is'], ['not_equals', 'is not'], ['contains', 'contains'], ['gt', 'is more than'], ['lt', 'is less than'], ['filled', 'is filled in'], ['empty', 'is empty']],
  amount: [['gt', 'is more than'], ['lt', 'is less than'], ['equals', 'is exactly']],
  funnel: [['is', 'is'], ['not', 'is not']],
  unsubscribed: [['is', 'yes — unsubscribed'], ['not', 'no — still subscribed']],
  opened: [['is', 'did open'], ['not', 'did not open']],
  clicked: [['is', 'did click'], ['not', 'did not click']],
};
const statText = (st, type) => {
  if (!st) return '';
  if (type === 'condition') return `${st.yes || 0} yes · ${st.no || 0} no`;
  if (type === 'split') return `${st.a || 0} A · ${st.b || 0} B`;
  return [st.sent && `${st.sent} sent`, st.done && `${st.done} done`, st.skipped && `${st.skipped} skipped`, st.failed && `${st.failed} failed`].filter(Boolean).join(' · ');
};

function Builder({ id }) {
  const nav = useNavigate();
  const [a, setA] = useState(null);
  const [meta, setMeta] = useState(null); // triggers, variables, channels, rule fields
  const [funnels, setFunnels] = useState([]);
  const [pipes, setPipes] = useState([]);
  const [fields, setFields] = useState([]);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(null); // "<list path>:<index>"
  const [history, setHistory] = useState(null);
  const lastField = useRef(null);
  const load = () => api(`/automations/${id}`).then((x) => { setA(x); setDirty(false); }).catch(() => nav('/automations'));
  useEffect(() => { load(); api('/automations').then(setMeta); api('/funnels').then(setFunnels); api('/pipelines').then(setPipes); api('/crm/fields').then(setFields).catch(() => {}); }, [id]);
  useEffect(() => { const t = setInterval(() => { if (!dirty) api(`/automations/${id}`).then((x) => setA((cur) => (cur ? { ...cur, runs: x.runs, running: x.running, stats: x.stats, stepStats: x.stepStats } : x))).catch(() => {}); }, 8000); return () => clearInterval(t); }, [id, dirty]);
  useEffect(() => { const w = (e) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } }; window.addEventListener('beforeunload', w); return () => window.removeEventListener('beforeunload', w); }, [dirty]);
  useEffect(() => { if (adding == null) return; const close = (e) => { if (!e.target.closest('.au-add')) setAdding(null); }; document.addEventListener('mousedown', close); return () => document.removeEventListener('mousedown', close); }, [adding]);
  if (!a || !meta) return <Layout title="Automation"><div className="skeleton" /></Layout>;

  const edit = (patch) => { setA((x) => ({ ...x, ...patch })); setDirty(true); };
  const setTrigger = (patch) => edit({ trigger: { ...a.trigger, ...patch } });
  const mutate = (fn) => { const st = clone(a.steps); fn(st); edit({ steps: st }); };
  const update = (path, i, patch) => mutate((st) => Object.assign(listRef(st, path)[i], patch));
  const insert = (path, at, type) => { mutate((st) => listRef(st, path).splice(at, 0, newStep(type))); setAdding(null); };
  const remove = (path, i) => mutate((st) => listRef(st, path).splice(i, 1));
  const move = (path, i, d) => mutate((st) => { const l = listRef(st, path); [l[i], l[i + d]] = [l[i + d], l[i]]; });
  const save = async (extra = {}) => {
    setBusy(true);
    try {
      const r = await api(`/automations/${id}`, 'PUT', { name: a.name, trigger: a.trigger, steps: a.steps, stopOnPurchase: a.stopOnPurchase, allowRepeat: a.allowRepeat, ...extra });
      setA((x) => ({ ...x, ...r })); setDirty(false);
      if (r.hookToken && !a.hookUrl) load();
      toast(extra.active === true ? 'Automation is live ✅' : extra.active === false ? 'Automation paused' : 'Saved');
    } catch (e) { toast(e.message); }
    setBusy(false);
  };
  const testStep = async (s) => {
    let to = '';
    if (s.type === 'whatsapp') { to = prompt('Send the test to which WhatsApp number?', ''); if (!to) return; }
    try { const r = await api(`/automations/${id}/test`, 'POST', { step: s, to }); toast(`Test sent to ${r.to}`); } catch (e) { toast(e.message); }
  };
  const insertVar = (v) => {
    const f = lastField.current;
    if (!f) return toast('Click into a message first, then pick a variable');
    const val = f.get() || '';
    const pos = f.el.selectionStart ?? val.length;
    f.set(`${val.slice(0, pos)}{{${v}}}${val.slice(f.el.selectionEnd ?? pos)}`);
    setTimeout(() => { f.el.focus(); const p = pos + v.length + 4; f.el.setSelectionRange?.(p, p); }, 0);
  };
  const fp = (path, i, s, k) => ({
    value: s[k] ?? '',
    onFocus: (e) => { lastField.current = { el: e.target, get: () => listRef(clone(a.steps), path)[i]?.[k], set: (v) => update(path, i, { [k]: v }) }; },
    onChange: (e) => update(path, i, { [k]: e.target.value }),
  });
  const stop = async (r) => { await api(`/automations/runs/${r.id}/stop`, 'POST'); load(); };
  const openHistory = async () => { setHistory('loading'); setHistory(await api(`/automations/${id}/versions`)); };
  const restore = async (v) => {
    if (dirty && !confirm('You have unsaved changes — restoring replaces them. Continue?')) return;
    try {
      const r = await api(`/automations/${id}/versions/${v.id}/restore`, 'POST');
      setHistory(null); await load();
      toast(r.paused ? 'Restored — the automation was paused because that version has incomplete steps' : 'Earlier version restored');
    } catch (e) { toast(e.message); }
  };
  const emails = flatSteps(a.steps).filter((x) => x.type === 'email');
  const dateFields = fields.filter((f) => f.type === 'date');
  const TI = TRIGGER_ICON[a.trigger.type] || Zap;
  const pipe = (pid) => pipes.find((p) => p.id === pid);
  const errors = a.check?.errors || [], warnings = a.check?.warnings || [];

  const renderAdder = (path, at, depth) => {
    const k = `${path.join('.')}:${at}`;
    return (
      <div className="au-add">
        <button className="au-plus" onClick={() => setAdding(adding === k ? null : k)} title="Add a step"><Plus size={14} /></button>
        {adding === k && <div className="au-menu">{Object.entries(STEP).filter(([t]) => !BRANCH_KEYS[t] || depth < 3).map(([t, s]) => <button key={t} onClick={() => insert(path, at, t)}><span style={{ '--sc': s.color }}><s.icon size={14} /></span>{s.label}</button>)}</div>}
      </div>
    );
  };

  const renderRule = (path, i, s, ri) => {
    const r = s.rules[ri];
    const set = (patch) => update(path, i, { rules: s.rules.map((x, j) => (j === ri ? { ...x, ...patch } : x)) });
    const ops = OPS[r.field] || OPS.tag;
    return (
      <div className="au-rule" key={ri}>
        <select value={r.field} onChange={(e) => set({ field: e.target.value, op: OPS[e.target.value][0][0], value: e.target.value === 'has' ? 'phone' : '' })}>{Object.entries(meta.ruleFields).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        {r.field === 'custom' && <select value={r.fieldId || ''} onChange={(e) => set({ fieldId: e.target.value })}><option value="">Choose field…</option>{fields.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}</select>}
        <select value={r.op} onChange={(e) => set({ op: e.target.value })}>{ops.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        {r.field === 'bought' && <>
          <select value={r.funnelId || ''} onChange={(e) => set({ funnelId: e.target.value || undefined })}><option value="">from any funnel</option>{funnels.map((f) => <option key={f.id} value={f.id}>from {f.name}</option>)}</select>
          <input placeholder="product name contains… (optional)" value={r.value || ''} onChange={(e) => set({ value: e.target.value })} />
        </>}
        {r.field === 'tag' && <input placeholder="tag" value={r.value || ''} onChange={(e) => set({ value: e.target.value })} />}
        {r.field === 'stage' && <>
          <select value={r.pipelineId || ''} onChange={(e) => set({ pipelineId: e.target.value, stageId: '' })}><option value="">Pipeline…</option>{pipes.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
          <select value={r.stageId || ''} onChange={(e) => set({ stageId: e.target.value })}><option value="">Stage…</option>{pipe(r.pipelineId)?.stages.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
        </>}
        {r.field === 'has' && <select value={r.value || 'phone'} onChange={(e) => set({ value: e.target.value })}><option value="phone">a phone number</option><option value="email">an email address</option></select>}
        {r.field === 'source' && <input placeholder="instagram, facebook, google…" value={r.value || ''} onChange={(e) => set({ value: e.target.value })} />}
        {r.field === 'custom' && !['empty', 'filled'].includes(r.op) && <input placeholder="value" value={r.value || ''} onChange={(e) => set({ value: e.target.value })} />}
        {r.field === 'amount' && <input type="number" placeholder="₹" value={r.value || ''} onChange={(e) => set({ value: e.target.value })} />}
        {(r.field === 'opened' || r.field === 'clicked') && <select value={r.stepId || ''} onChange={(e) => set({ stepId: e.target.value || undefined })}><option value="">any email in this automation</option>{emails.map((x) => <option key={x.id} value={x.id}>“{x.subject || 'untitled email'}”</option>)}</select>}
        {r.field === 'funnel' && <select value={r.funnelId || ''} onChange={(e) => set({ funnelId: e.target.value })}><option value="">Choose funnel…</option>{funnels.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</select>}
        <button className="icon-btn xs danger" title="Remove rule" onClick={() => update(path, i, { rules: s.rules.filter((_, j) => j !== ri) })}><Trash2 size={13} /></button>
      </div>
    );
  };

  const renderNode = (path, i, s, n, depth, count) => {
    const S = STEP[s.type];
    const er = s.type === 'email' && a.emailResults?.[s.id];
    const stats = er?.sent ? `${er.sent} sent · ${Math.round((er.opened / er.sent) * 100)}% opened · ${Math.round((er.clicked / er.sent) * 100)}% clicked` : statText(a.stepStats?.[s.id], s.type);
    const sr = s.type === 'split' && a.splitResults?.[s.id];
    return (
      <section className={`au-node ${BRANCH_KEYS[s.type] ? 'cond' : ''}`} style={{ '--sc': S.color }}>
        <div className="au-nh">
          <span className="au-ti"><S.icon size={16} /></span><b>{n}. {S.label}</b>
          {stats && <small className="au-stat">{stats}</small>}
          <span className="au-tools">
            {['email', 'notify', 'whatsapp'].includes(s.type) && <button className="link-btn" onClick={() => testStep(s)} title="Send this message to yourself with sample data"><Send size={12} /> Test</button>}
            <button className="icon-btn xs" disabled={i === 0} onClick={() => move(path, i, -1)} title="Move up"><ChevronUp size={14} /></button>
            <button className="icon-btn xs" disabled={i === count - 1} onClick={() => move(path, i, 1)} title="Move down"><ChevronDown size={14} /></button>
            <button className="icon-btn xs danger" onClick={() => { if (s.type !== 'condition' || !(s.yes.length + s.no.length) || confirm('Remove this If / else and every step inside it?')) remove(path, i); }} title="Remove step"><Trash2 size={13} /></button>
          </span>
        </div>
        <div className="au-nb">
          {s.type === 'wait' && <>
            <div className="seg sm"><button className={s.mode !== 'until' ? 'on' : ''} onClick={() => update(path, i, { mode: 'duration', amount: s.amount || 1, unit: s.unit || 'days' })}>For a while</button><button className={s.mode === 'until' ? 'on' : ''} onClick={() => update(path, i, { mode: 'until', time: s.time || '10:00' })}>Until a time of day</button></div>
            {s.mode === 'until'
              ? <div className="au-inline">Wait until <input type="time" value={s.time || '10:00'} onChange={(e) => update(path, i, { time: e.target.value })} /> {zoneCity(window.__FF_BIZ_TZ__ || 'Asia/Kolkata')} time, then continue <span className="muted sm">— e.g. so WhatsApp doesn’t arrive at night</span></div>
              : <div className="au-inline">Wait <input type="number" min="1" value={s.amount ?? 1} onChange={(e) => update(path, i, { amount: e.target.value })} /><select value={s.unit || 'days'} onChange={(e) => update(path, i, { unit: e.target.value })}><option value="minutes">minutes</option><option value="hours">hours</option><option value="days">days</option></select> then continue</div>}
          </>}
          {(s.type === 'email' || s.type === 'notify') && <>
            {s.type === 'notify' && <p className="hint">Sent to you, with the contact’s details.</p>}
            <input placeholder="Subject" {...fp(path, i, s, 'subject')} />
            <textarea rows={s.type === 'email' ? 6 : 3} placeholder={s.type === 'email' ? 'Hi {{first_name}},\n\n…' : 'Optional message'} {...fp(path, i, s, 'body')} />
            {s.type === 'email' && <p className="hint">An unsubscribe link is added automatically.</p>}
          </>}
          {s.type === 'whatsapp' && <>
            <div className="seg sm"><button className={s.mode === 'template' ? 'on' : ''} onClick={() => update(path, i, { mode: 'template' })}>Approved template</button><button className={s.mode === 'text' ? 'on' : ''} onClick={() => update(path, i, { mode: 'text' })}>Plain text</button></div>
            {s.mode === 'template' ? <>
              <div className="form2c"><label>Template name<input placeholder="cart_reminder" {...fp(path, i, s, 'template')} /></label><label>Language<input placeholder="en" {...fp(path, i, s, 'language')} /></label></div>
              <label>Template variables <small className="muted">· in order, comma separated → {'{{1}}'}, {'{{2}}'}…</small><input placeholder="{{first_name}}, {{checkout_link}}" {...fp(path, i, s, 'params')} /></label>
              <p className="hint">Templates are created and approved in Meta WhatsApp Manager. They can be sent any time.</p>
            </> : <>
              <textarea rows={4} placeholder="Hi {{first_name}}! …" {...fp(path, i, s, 'text')} />
              <p className="hint warn">Plain text only reaches people who messaged you in the last 24 hours. For automated follow-ups use a template.</p>
            </>}
          </>}
          {s.type === 'tag' && <div className="au-inline"><select value={s.action} onChange={(e) => update(path, i, { action: e.target.value })}><option value="add">Add tag</option><option value="remove">Remove tag</option></select><input placeholder="tag name" value={s.tag} onChange={(e) => update(path, i, { tag: e.target.value })} /></div>}
          {s.type === 'stage' && <div className="form2c">
            <label>Pipeline<select value={s.pipelineId || ''} onChange={(e) => update(path, i, { pipelineId: e.target.value, stageId: '' })}><option value="">Choose…</option>{pipes.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
            <label>Move to<select value={s.stageId || ''} onChange={(e) => update(path, i, { stageId: e.target.value })}><option value="">Choose…</option>{pipe(s.pipelineId)?.stages.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
          </div>}
          {s.type === 'webhook' && <><input placeholder="https://hooks.zapier.com/…" value={s.url} onChange={(e) => update(path, i, { url: e.target.value })} /><p className="hint">Sends the contact’s details (signed, retried) — e.g. to Zapier, Pabbly or Google Sheets.</p></>}
          {s.type === 'exit' && <p className="hint top">The automation ends here for this contact — nothing after this step runs.</p>}
          {s.type === 'split' && <>
            <div className="au-inline">Send <input type="number" min="5" max="95" value={s.percent} onChange={(e) => update(path, i, { percent: e.target.value })} />% of contacts down <b>Path A</b> and the rest ({Math.max(0, 100 - (Number(s.percent) || 0))}%) down <b>Path B</b> — at random.</div>
            <p className="hint">Test two messages, offers or timings. Results show how many in each path bought afterwards.</p>
          </>}
          {s.type === 'condition' && <>
            <div className="au-inline">Go to <b className="yes">Yes</b> if <select value={s.match} onChange={(e) => update(path, i, { match: e.target.value })}><option value="all">all</option><option value="any">any</option></select> of these are true, otherwise <b className="no">No</b>:</div>
            {s.rules.map((r, ri) => renderRule(path, i, s, ri))}
            <button className="link-btn" onClick={() => update(path, i, { rules: [...s.rules, { field: 'tag', op: 'is', value: '' }] })}><Plus size={13} /> Add rule</button>
          </>}
        </div>
        {BRANCH_KEYS[s.type] && (
          <div className="au-branches">
            {BRANCH_KEYS[s.type].map((b) => (
              <div key={b} className={`au-branch ${b}`}>
                <div className="au-bh">{BRANCH_TITLE[b]}{s.type === 'split' && ` · ${b === 'a' ? s.percent : 100 - s.percent}%`}<small>{s[b].length ? `${s[b].length} step${s[b].length > 1 ? 's' : ''}` : 'nothing — continues below'}</small></div>
                {sr && sr[b].n > 0 && <div className="au-res"><b>{sr[b].n}</b> contacts · <b>{sr[b].bought}</b> bought ({Math.round((sr[b].bought / sr[b].n) * 100)}%){sr.a.n && sr.b.n && sr[b].bought / sr[b].n > sr[b === 'a' ? 'b' : 'a'].bought / sr[b === 'a' ? 'b' : 'a'].n ? <span className="pill ok">leading</span> : null}</div>}
                {renderList(s[b], [...path, i, b], depth + 1)}
              </div>
            ))}
          </div>
        )}
      </section>
    );
  };

  const renderList = (list, path, depth) => (
    <div className={`au-list ${depth ? 'nested' : ''}`}>
      {renderAdder(path, 0, depth)}
      {list.map((s, i) => (
        <div key={s.id || `${path.join('.')}-${i}`} className="au-stepwrap">
          {renderNode(path, i, s, i + 1, depth, list.length)}
          {renderAdder(path, i + 1, depth)}
        </div>
      ))}
    </div>
  );

  return (
    <Layout title={<span className="au-title"><Link to="/automations" className="icon-btn" title="All automations"><ArrowLeft size={18} /></Link><input value={a.name} onChange={(e) => edit({ name: e.target.value })} aria-label="Automation name" /></span>}
      subtitle={a.active ? '● Live — new contacts that match the trigger enter it automatically' : 'Paused — nothing is sent while it’s off'}
      actions={<>
        <button className="btn ghost" onClick={openHistory} title="Earlier versions"><History size={15} /> History</button>
        <button className="btn ghost" disabled={busy || !dirty} onClick={() => save()}>{dirty ? 'Save changes' : 'Saved'}</button>
        {a.active ? <button className="btn ghost" disabled={busy} onClick={() => save({ active: false })}><Square size={14} /> Pause</button> : <button className="btn primary" disabled={busy} onClick={() => save({ active: true })}><Zap size={15} /> Turn on</button>}
      </>}>
      <ChannelBanner channels={meta.channels} />
      {history && (
        <Modal title="Version history" onClose={() => setHistory(null)} width={520}>
          <div className="m-body">
            {history === 'loading' ? <div className="skeleton sm" /> : !history.length ? <p className="muted">No earlier versions yet. A version is kept automatically before each round of changes you save.</p> : (
              <ul className="au-hist">{history.map((v) => (
                <li key={v.id}><div><b>{new Date(v.at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</b><small className="muted">{v.note || `${v.name} · ${v.steps} step${v.steps === 1 ? '' : 's'} · ${meta.triggers[v.trigger]?.split('(')[0] || v.trigger}`}</small></div><button className="btn ghost sm" onClick={() => restore(v)}>Restore</button></li>
              ))}</ul>
            )}
            <p className="hint">Contacts already in the automation continue from their current position after a restore.</p>
          </div>
        </Modal>
      )}
      <div className="au-wrap">
        <div className="au-flow">
          <section className="au-node trig">
            <div className="au-nh"><span className="au-ti"><TI size={16} /></span><b>Trigger</b><small>When should this start?</small></div>
            <div className="au-nb">
              <select value={a.trigger.type} onChange={(e) => setTrigger({ type: e.target.value })}>{Object.entries(meta.triggers).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
              {['lead', 'purchase', 'offer', 'abandoned'].includes(a.trigger.type) && (
                <label>Funnel<select value={a.trigger.funnelId || ''} onChange={(e) => setTrigger({ funnelId: e.target.value || undefined })}><option value="">Any funnel</option>{funnels.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</select></label>
              )}
              {a.trigger.type === 'abandoned' && <label>Wait before it counts as abandoned<div className="au-inline"><input type="number" min="5" value={a.trigger.delayMin || 30} onChange={(e) => setTrigger({ delayMin: e.target.value })} /> minutes without paying</div></label>}
              {a.trigger.type === 'stage' && (
                <div className="form2c">
                  <label>Pipeline<select value={a.trigger.pipelineId || ''} onChange={(e) => setTrigger({ pipelineId: e.target.value, stageId: '' })}><option value="">Choose…</option>{pipes.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
                  <label>Stage<select value={a.trigger.stageId || ''} onChange={(e) => setTrigger({ stageId: e.target.value })}><option value="">Choose…</option>{pipe(a.trigger.pipelineId)?.stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
                </div>
              )}
              {a.trigger.type === 'tag' && <label>Tag<input value={a.trigger.tag || ''} onChange={(e) => setTrigger({ tag: e.target.value })} placeholder="e.g. webinar" /></label>}
              {a.trigger.type === 'date' && <>
                <label>Date field<select value={a.trigger.fieldId || ''} onChange={(e) => setTrigger({ fieldId: e.target.value })}><option value="">Choose…</option>{dateFields.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}</select></label>
                {!dateFields.length && <p className="hint warn">Create a date field first (e.g. “Birthday” or “Renewal date”) in <Link to="/contacts">Contacts → Custom fields</Link>, and fill it in on your contacts.</p>}
                <div className="au-inline">Start <input type="number" min="0" max="365" value={Math.abs(a.trigger.offsetDays || 0)} onChange={(e) => setTrigger({ offsetDays: (a.trigger.offsetDays < 0 ? -1 : 1) * Math.abs(Number(e.target.value) || 0) })} /> days
                  <select value={!a.trigger.offsetDays ? 'on' : a.trigger.offsetDays < 0 ? 'before' : 'after'} onChange={(e) => { const n = Math.abs(a.trigger.offsetDays || 1); setTrigger({ offsetDays: e.target.value === 'on' ? 0 : e.target.value === 'before' ? -n : n }); }}><option value="before">before</option><option value="on">— on the day</option><option value="after">after</option></select>
                  the date, at <input type="time" value={a.trigger.time || '10:00'} onChange={(e) => setTrigger({ time: e.target.value })} /> {zoneCity(window.__FF_BIZ_TZ__ || 'Asia/Kolkata')} time</div>
                <label className="tog"><input type="checkbox" checked={!!a.trigger.yearly} onChange={(e) => setTrigger({ yearly: e.target.checked })} /><span />Every year (birthdays, anniversaries)</label>
              </>}
              {a.trigger.type === 'manual' && <p className="hint">Add people from their contact screen, or select many in Contacts → “Add to automation”.</p>}
              {a.trigger.type === 'inbound' && (a.hookUrl && !dirty ? <>
                <label>Your webhook URL<div className="au-inline"><input readOnly value={a.hookUrl} onFocus={(e) => e.target.select()} /><button className="btn ghost sm" onClick={() => { navigator.clipboard?.writeText(a.hookUrl); toast('Copied'); }}><Copy size={13} /> Copy</button></div></label>
                <p className="hint">POST JSON with <code>email</code> and/or <code>phone</code>, plus optional <code>name</code>, <code>tags</code> and <code>source</code> — e.g. from Zapier, Pabbly, Make or a Google Form script. The contact is created if new.</p>
              </> : <p className="hint">Save to get your webhook URL.</p>)}
            </div>
          </section>
          {renderList(a.steps, [], 0)}
          {!a.steps.length && <p className="hint center">Add the first step with the + button above.</p>}
          <div className="au-end">End</div>
        </div>

        <aside className="au-side">
          {(errors.length > 0 || warnings.length > 0) && !dirty && (
            <Panel title="Before it goes live">
              {errors.map((e) => <p key={e} className="au-err"><AlertTriangle size={14} /> {e}</p>)}
              {warnings.map((w) => <p key={w} className="au-warn"><AlertTriangle size={14} /> {w}</p>)}
            </Panel>
          )}
          <Panel title="Options">
            <label className="tog"><input type="checkbox" checked={!!a.stopOnPurchase} onChange={(e) => edit({ stopOnPurchase: e.target.checked })} /><span />Stop when the contact buys</label>
            <p className="hint">Recommended for reminders and lead nurturing.</p>
            <label className="tog"><input type="checkbox" checked={!!a.allowRepeat} onChange={(e) => edit({ allowRepeat: e.target.checked })} /><span />Allow a contact to go through it again</label>
          </Panel>
          <Panel title="Personalise">
            <p className="hint top">Click into a message, then a variable:</p>
            <div className="au-vars">{meta.variables.map((v) => <button key={v} onMouseDown={(e) => e.preventDefault()} onClick={() => insertVar(v)}>{`{{${v}}}`}</button>)}</div>
          </Panel>
          <Panel title={`Activity · ${num(a.stats?.started || 0)} started`}>
            {!a.runs?.length ? <p className="hint">Nobody has entered this automation yet.</p> : (
              <ul className="au-runs">{a.runs.slice(0, 15).map((r) => (
                <li key={r.id}>
                  <Link to={`/contacts/${encodeURIComponent(r.key)}`}><b>{r.name || r.email || r.phone || r.key}</b></Link>
                  <span className={`pill ${r.status === 'done' ? 'ok' : r.status === 'active' ? 'warn' : ''}`}>{r.status === 'active' ? (r.nextAt > Date.now() ? 'waiting' : 'running') : r.status}</span>
                  <small className="muted">{r.status === 'active' && r.pos ? `at step ${posLabel(r.pos)} · ` : ''}{r.log.at(-1)?.detail || 'Started'} · {ago(r.log.at(-1)?.at || r.at)}</small>
                  {r.status === 'active' && <button className="link-btn" onClick={() => stop(r)}>Stop</button>}
                </li>
              ))}</ul>
            )}
          </Panel>
        </aside>
      </div>
    </Layout>
  );
}
