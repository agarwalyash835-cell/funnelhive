import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  Clock, Mail, MessageCircle, Tag, ArrowRightLeft, Webhook, BellRing, Zap, Plus, Trash2, ChevronUp, ChevronDown, Copy, UserPlus,
  ShoppingBag, TrendingUp, ShoppingCart, Kanban, AlertTriangle, ArrowLeft, Square, Workflow, Sparkles, GitBranch, CircleStop, Send, Link2, Hand, Split, CalendarDays, History, PenLine, Hourglass, KeyRound, StickyNote, GripVertical, Search, X, GraduationCap, BadgeCheck, Award, MessagesSquare, Eye, FileX,
  CalendarCheck, CalendarX, Target, ListTodo, Video, Presentation, Undo2, RefreshCw, CreditCard, Truck, UserCheck, UserX,
} from 'lucide-react';
import { api } from '../api';
import { useBizTz, zoneCity } from '../tzfmt';
import { Layout, Panel, Empty, Modal, toast, ago, num, useWaTemplates, WaTemplateSelect, WaTemplateInfo, confirmDialog, promptDialog } from '../ui';

// one-click ideas for “Build with Hive AI” (the part before — is the button)
const AI_IDEAS = [
  'Welcome series — when someone signs up, send a welcome email now, a tip after 2 days and a WhatsApp nudge at 10 am on day 3; stop if they buy',
  'Course nudge — when a student signs in for the first time, email them how to start; if they haven’t finished the course in 14 days, remind them',
  'Stuck deals — when a contact sits in a stage for 5 days, alert me and send them a friendly check-in email',
  'Thank buyers — after a purchase, wait 7 days, ask for a review by email and tag them happy-customer',
];
// events the “Send to Meta” step can send (Meta's standard names, plus your own)
const META_EVENTS = { QualifiedLead: 'Qualified lead', Lead: 'Lead', Schedule: 'Booked a call / visit', Contact: 'Contacted', SubmitApplication: 'Submitted application', CompleteRegistration: 'Registered', Purchase: 'Purchase (with value)', custom: 'Custom event…' };
const BRANCH_KEYS = { condition: ['yes', 'no'], split: ['a', 'b'] };
const BRANCH_TITLE = { yes: '✓ Yes', no: '✕ No', a: 'Path A', b: 'Path B' };
const flatSteps = (list, out = []) => { for (const s of list || []) { out.push(s); for (const b of BRANCH_KEYS[s.type] || []) flatSteps(s[b], out); } return out; };

const STEP = {
  wait: { label: 'Wait', icon: Clock, color: '#64748b' },
  email: { label: 'Send email', icon: Mail, color: '#6366f1' },
  whatsapp: { label: 'Send WhatsApp', icon: MessageCircle, color: '#16a34a' },
  tag: { label: 'Add / remove tag', icon: Tag, color: '#d97706' },
  stage: { label: 'Move pipeline stage', icon: ArrowRightLeft, color: '#0ea5e9' },
  field: { label: 'Update a contact field', icon: PenLine, color: '#14b8a6' },
  note: { label: 'Add a note', icon: StickyNote, color: '#a16207' },
  meta: { label: 'Send to Meta', icon: Target, color: '#1877f2' },
  access: { label: 'Give / remove course access', icon: KeyRound, color: '#7c3aed' },
  enroll: { label: 'Start another automation', icon: Workflow, color: '#0f766e' },
  notify: { label: 'Email me', icon: BellRing, color: '#ec4899' },
  webhook: { label: 'Send to webhook', icon: Webhook, color: '#475569' },
  condition: { label: 'If / else', icon: GitBranch, color: '#8b5cf6' },
  split: { label: 'A/B split', icon: Split, color: '#0891b2' },
  exit: { label: 'End automation', icon: CircleStop, color: '#ef4444' },
};
const TRIGGER_ICON = {
  lead: UserPlus, quiz: ListTodo, purchase: ShoppingBag, offer: TrendingUp, abandoned: ShoppingCart, refund: Undo2, renewal: RefreshCw, payment_failed: CreditCard, shipped: Truck,
  booking: CalendarCheck, booking_cancelled: CalendarX, webinar_registered: Presentation, webinar_attended: UserCheck, webinar_missed: UserX,
  stage: Kanban, tag: Tag, field: PenLine, stuck: Hourglass, date: CalendarDays, inbound: Link2, manual: Hand,
  student_joined: GraduationCap, quiz_passed: BadgeCheck, course_completed: Award, community_post: MessagesSquare, quote_viewed: Eye, quote_declined: FileX,
};
// the pickers: grouped like Zapier, with a line on what each one is for
const TRIGGER_GROUPS = [
  ['Leads & forms', ['lead', 'quiz', 'inbound', 'manual']],
  ['Sales & payments', ['purchase', 'offer', 'abandoned', 'refund', 'renewal', 'payment_failed', 'shipped']],
  ['CRM', ['stage', 'stuck', 'field', 'tag', 'date']],
  ['Calls & webinars', ['booking', 'booking_cancelled', 'webinar_registered', 'webinar_attended', 'webinar_missed']],
  ['Courses & community', ['student_joined', 'quiz_passed', 'course_completed', 'community_post']],
  ['Quotes', ['quote_viewed', 'quote_declined']],
];
const TRIGGER_HELP = {
  lead: 'An opt-in or form on a funnel is filled in', quiz: 'A quiz funnel is finished — any result, or one result', inbound: 'Zapier, Pabbly, Make or Google Forms sends you a contact', manual: 'You add contacts by hand or in bulk',
  purchase: 'A checkout, quote or booking is paid', offer: 'An upsell, downsell or add-on is accepted', abandoned: 'Checkout started but not paid', refund: 'An order is refunded',
  renewal: 'A membership renews or an instalment is paid', payment_failed: 'A renewal or instalment fails', shipped: 'An order gets a courier and tracking number',
  booking: 'A call is booked on your calendar', booking_cancelled: 'A booked call is cancelled', webinar_registered: 'Someone registers for a webinar',
  webinar_attended: 'After the webinar — they showed up', webinar_missed: 'After the webinar — they didn’t',
  stage: 'A contact moves to a pipeline stage', stuck: 'A contact sits in a stage for N days', field: 'A CRM field changes — e.g. Home loan → Needed',
  tag: 'A tag is added to a contact', date: 'A date field arrives — site visit, renewal, birthday',
  student_joined: 'First sign-in to your members area', quiz_passed: 'A lesson quiz is passed', course_completed: 'Every lesson done (certificate earned)', community_post: 'A student posts in your community',
  quote_viewed: 'A client opens the quote you sent', quote_declined: 'A client declines a quote',
};
const STEP_GROUPS = [
  ['Send a message', ['email', 'whatsapp', 'notify']],
  ['CRM', ['tag', 'stage', 'field', 'note']],
  ['Courses & products', ['access']],
  ['Timing & logic', ['wait', 'condition', 'split', 'enroll', 'exit']],
  ['Apps & integrations', ['meta', 'webhook']],
];
const STEP_HELP = {
  email: 'An email from you, personalised', whatsapp: 'An approved template, or a reply within 24 hours', notify: 'An alert to you with the contact’s details',
  tag: 'Add or remove a tag', stage: 'Move them to a pipeline stage', field: 'Set a CRM field — e.g. Site visit = +3 days', note: 'Write on the contact’s timeline',
  access: 'Give or take away a course or product', wait: 'Pause for a while, or until a time of day', condition: 'Branch on tags, stage, fields, purchases…',
  split: 'Send people down A or B at random', enroll: 'Hand them to another automation', exit: 'Stop here for this contact', meta: 'Tell Meta this lead qualified or bought — ads find more like them', webhook: 'Send their details to Zapier, Pabbly or Sheets',
};
const COURSE_TRIGGERS = ['student_joined', 'quiz_passed', 'course_completed', 'community_post'];
const tempId = () => `n${Math.random().toString(36).slice(2, 10)}`;
const newStep = (type) => ({ id: tempId(), ...({
  wait: { type, amount: 1, unit: 'days' },
  email: { type, subject: '', body: '' },
  whatsapp: { type, mode: 'template', template: '', language: 'en', params: '{{first_name}}' },
  tag: { type, tag: '', action: 'add' },
  stage: { type, pipelineId: '', stageId: '' },
  field: { type, fieldId: '', value: '' },
  note: { type, text: '' },
  meta: { type, event: 'QualifiedLead', name: '', value: '' },
  access: { type, productId: '', action: 'grant', notify: true },
  enroll: { type, automationId: '' },
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
  const [aiText, setAiText] = useState('');
  const [aiBusy, setAiBusy] = useState(false);
  const buildAi = async () => {
    setAiBusy(true);
    try { const a = await api('/ai/automation', 'POST', { description: aiText }); toast(a.check?.errors?.length ? 'Built — check the cards marked with a red dot, then turn it on' : 'Built — have a look, then turn it on'); nav(`/automations/${a.id}`); } catch (e) { toast(e.message); }
    setAiBusy(false);
  };
  const load = () => api('/automations').then(setD);
  useEffect(() => { load(); }, []);
  // ready-made automations for the seller's CRM style (real estate, clinic…), with their own stage and field ids
  const [kitAuto, setKitAuto] = useState(null);
  useEffect(() => { if (pick && !kitAuto) api('/crm/kit-automations').then(setKitAuto).catch(() => setKitAuto({ recipes: [] })); }, [pick]);
  const create = async (body) => { try { const a = await api('/automations', 'POST', body); nav(`/automations/${a.id}`); } catch (e) { toast(e.message); } };
  const toggle = async (a) => { try { await api(`/automations/${a.id}`, 'PUT', { active: !a.active }); load(); toast(a.active ? 'Automation paused' : 'Automation is live'); } catch (e) { toast(e.message); nav(`/automations/${a.id}`); } };
  const stripIds = (list) => list.map(({ id: _, ...s }) => { for (const b of BRANCH_KEYS[s.type] || []) s[b] = stripIds(s[b]); return s; });
  const dup = (a) => create({ name: `${a.name} copy`, trigger: a.trigger, steps: stripIds(a.steps), stopOnPurchase: a.stopOnPurchase, allowRepeat: a.allowRepeat });
  const del = async (a) => { if (!await confirmDialog({ title: `Delete “${a.name}”?`, text: 'Contacts in it stop receiving its messages.', confirm: 'Delete', danger: true })) return; await api(`/automations/${a.id}`, 'DELETE'); load(); };
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
                      <span className="au-acts"><button className="icon-btn" title="Duplicate" aria-label="Duplicate" onClick={() => dup(a)}><Copy size={15} /></button><button className="icon-btn danger" title="Delete" aria-label="Delete" onClick={() => del(a)}><Trash2 size={15} /></button></span>
                    </footer>
                  </article>
                );
              })}
            </div>
          )}
        </>
      )}
      {pick && (
        <Modal title="New automation" onClose={() => setPick(false)} width={760}>
          <div className="m-body au-start">
            <div className="au-ai">
              <div className="au-ai-h"><span className="au-ai-ic"><Sparkles size={18} /></span><div><b>Build with Hive AI</b><small>Say what should happen — Hive builds it with your own stages, fields and courses. It opens paused so you can check it.</small></div></div>
              <textarea rows={3} value={aiText} onChange={(e) => setAiText(e.target.value)} maxLength={1500} placeholder="e.g. When a lead’s site visit is tomorrow, email them the location at 10 am and remind me to call. If they don’t book in 3 days, tag them cold." />
              <div className="au-ai-bar">
                <div className="au-ai-ideas">{AI_IDEAS.map((t) => <button key={t} onClick={() => setAiText(t)}>{t.split(' — ')[0]}</button>)}</div>
                <button className="btn primary" disabled={aiBusy || aiText.trim().length < 10} onClick={buildAi}><Sparkles size={15} /> {aiBusy ? 'Building…' : 'Build it'}</button>
              </div>
            </div>
            <button className="au-scratch" onClick={() => create({ name: 'New automation', trigger: { type: 'lead' }, steps: [] })}><span className="au-ti"><Plus size={18} /></span><b>Start from scratch</b><small>Pick a trigger and drag in your own steps.</small></button>
          </div>
          {kitAuto?.recipes?.length > 0 && <div className="m-body recipes kit">
            <h5 className="recipes-h">For your {kitAuto.kit} CRM</h5>
            {kitAuto.recipes.map((r) => { const I = r.a.trigger.type === 'stuck' ? Hourglass : CalendarDays; return <button key={r.key} className="recipe" onClick={() => create(r.a)}><span className="au-ti"><I size={18} /></span><b>{r.title}</b><small>{r.text}</small></button>; })}
          </div>}
          <div className="m-body recipes">
            <h5 className="recipes-h">{kitAuto?.recipes?.length > 0 ? 'Ready-made for every business' : 'Or start from a ready-made recipe'}</h5>
            {RECIPES.map((r) => <button key={r.key} className="recipe" onClick={() => create(r.a)}><span className="au-ti"><r.icon size={18} /></span><b>{r.title}</b><small>{r.text}</small></button>)}
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
  const [history, setHistory] = useState(null);
  const lastField = useRef(null);
  const waTpls = useWaTemplates(); // approved Hive WhatsApp templates (null: type a name)
  const [sel, setSel] = useState(null); // 'trigger' or a step id: what the right panel edits
  const [picker, setPicker] = useState(null); // { mode: 'trigger' } or { mode: 'step', path, at, depth }
  const [pq, setPq] = useState('');
  const [dragId, setDragId] = useState(null);
  const [over, setOver] = useState(null);
  const [products, setProducts] = useState([]);
  // on narrower screens the edit panel sits below the flow: bring it into view when a card is picked
  useEffect(() => { if (sel && window.innerWidth < 1100) setTimeout(() => document.querySelector('.zf-insp')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60); }, [sel]);
  const load = () => api(`/automations/${id}`).then((x) => { setA(x); setDirty(false); }).catch(() => nav('/automations'));
  useEffect(() => { load(); api('/automations').then(setMeta); api('/funnels').then(setFunnels); api('/pipelines').then(setPipes); api('/crm/fields').then(setFields).catch(() => {}); api('/products').then((d) => setProducts(d.products || [])).catch(() => {}); }, [id]);
  useEffect(() => { const t = setInterval(() => { if (!dirty) api(`/automations/${id}`).then((x) => setA((cur) => (cur ? { ...cur, runs: x.runs, running: x.running, stats: x.stats, stepStats: x.stepStats } : x))).catch(() => {}); }, 8000); return () => clearInterval(t); }, [id, dirty]);
  useEffect(() => { const w = (e) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } }; window.addEventListener('beforeunload', w); return () => window.removeEventListener('beforeunload', w); }, [dirty]);
  if (!a || !meta) return <Layout title="Automation"><div className="skeleton" /></Layout>;

  const edit = (patch) => { setA((x) => ({ ...x, ...patch })); setDirty(true); };
  const setTrigger = (patch) => edit({ trigger: { ...a.trigger, ...patch } });
  const mutate = (fn) => { const st = clone(a.steps); fn(st); edit({ steps: st }); };
  const update = (path, i, patch) => mutate((st) => Object.assign(listRef(st, path)[i], patch));
  const remove = (path, i) => mutate((st) => listRef(st, path).splice(i, 1));
  const save = async (extra = {}) => {
    setBusy(true);
    try {
      const r = await api(`/automations/${id}`, 'PUT', { name: a.name, trigger: a.trigger, steps: a.steps, stopOnPurchase: a.stopOnPurchase, allowRepeat: a.allowRepeat, ...extra });
      setA((x) => ({ ...x, ...r })); setDirty(false);
      if (r.hookToken && !a.hookUrl) load();
      toast(extra.active === true ? 'Automation is live' : extra.active === false ? 'Automation paused' : 'Saved');
    } catch (e) { toast(e.message); }
    setBusy(false);
  };
  const testStep = async (s) => {
    let to = '';
    if (s.type === 'whatsapp') { to = await promptDialog({ title: 'Send a test', text: 'Send the test to which WhatsApp number?', type: 'tel', placeholder: '+91 98765 43210', confirm: 'Send test' }); if (!to) return; }
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
    if (dirty && !await confirmDialog({ title: 'Restore this version?', text: 'You have unsaved changes — restoring replaces them. Continue?', confirm: 'Restore' })) return;
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

  // ---- the flow: find a step anywhere in the tree by its id ----
  const locate = (list, id, path = []) => {
    for (let i = 0; i < list.length; i++) {
      const s = list[i];
      if (s.id === id) return { path, i, s };
      for (const b of BRANCH_KEYS[s.type] || []) { const hit = locate(s[b], id, [...path, i, b]); if (hit) return hit; }
    }
    return null;
  };
  const selected = sel && sel !== 'trigger' ? locate(a.steps, sel) : null;
  const addAt = (path, at, type) => {
    const st = newStep(type);
    mutate((steps) => listRef(steps, path).splice(at, 0, st));
    setPicker(null); setSel(st.id);
  };
  // drag a card onto any connector (also into / out of a branch, never into its own branches)
  const dropAt = (path, at) => {
    const src = dragId && locate(a.steps, dragId);
    setDragId(null); setOver(null);
    if (!src) return;
    const own = [...src.path, src.i];
    if (path.length >= own.length && own.every((x, k) => path[k] === x)) return toast('A step can’t go inside its own branches');
    mutate((steps) => {
      const [node] = listRef(steps, src.path).splice(src.i, 1);
      const p = [...path];
      const sameParent = src.path.length <= p.length && src.path.every((x, k) => p[k] === x);
      if (sameParent && p.length > src.path.length && p[src.path.length] > src.i) p[src.path.length] -= 1; // the target sits after the moved card
      let at2 = at;
      if (sameParent && p.length === src.path.length && at > src.i) at2 -= 1;
      listRef(steps, p).splice(at2, 0, node);
    });
  };
  const dup = (path, i) => {
    const strip = (s) => { const c = { ...clone(s), id: tempId() }; for (const b of BRANCH_KEYS[c.type] || []) c[b] = c[b].map(strip); return c; };
    mutate((steps) => { const l = listRef(steps, path); l.splice(i + 1, 0, strip(l[i])); });
  };
  const del = async (path, i, s) => {
    if (BRANCH_KEYS[s.type] && BRANCH_KEYS[s.type].some((b) => s[b].length) && !await confirmDialog({ title: `Remove this ${STEP[s.type].label} and every step inside it?`, confirm: 'Remove', danger: true })) return;
    remove(path, i); setSel(null);
  };

  // what a step still needs (shown as a red dot on its card)
  const missing = (s) => {
    if (s.type === 'email') return !s.subject || !s.body ? 'Add a subject and a message' : '';
    if (s.type === 'notify') return !s.subject ? 'Add a subject' : '';
    if (s.type === 'whatsapp') return s.mode === 'template' ? (!s.template ? 'Choose a template' : '') : (!s.text ? 'Write the message' : '');
    if (s.type === 'tag') return !s.tag ? 'Enter a tag' : '';
    if (s.type === 'stage') return !s.stageId ? 'Choose a stage' : '';
    if (s.type === 'field') return !fields.some((x) => x.id === s.fieldId) ? 'Choose a field' : '';
    if (s.type === 'access') return !products.some((x) => x.id === s.productId) ? 'Choose a product or course' : '';
    if (s.type === 'enroll') return !s.automationId ? 'Choose an automation' : '';
    if (s.type === 'note') return !String(s.text || '').trim() ? 'Write the note' : '';
    if (s.type === 'webhook') return !s.url ? 'Enter the webhook URL' : '';
    if (s.type === 'meta') return s.event === 'custom' && !String(s.name || '').trim() ? 'Name the event' : '';
    if (s.type === 'condition') return !s.rules.length ? 'Add a rule' : '';
    return '';
  };
  const trigMissing = () => {
    const t = a.trigger;
    if (t.type === 'stage' || t.type === 'stuck') return !t.stageId ? 'Choose the stage' : '';
    if (t.type === 'tag') return !t.tag ? 'Enter the tag' : '';
    if (t.type === 'field') return !fields.some((x) => x.id === t.fieldId) ? 'Choose the field' : '';
    if (t.type === 'date') return !dateFields.some((x) => x.id === t.fieldId) ? 'Choose the date field' : '';
    return '';
  };
  // a card's one-line summary
  const fieldName = (fid) => fields.find((x) => x.id === fid)?.label || 'a field';
  const stageName = (pid, sid) => pipe(pid)?.stages.find((x) => x.id === sid)?.name;
  const summary = (s) => {
    switch (s.type) {
      case 'wait': return s.mode === 'until' ? `Until ${s.time || '10:00'}` : `${s.amount || 1} ${s.unit || 'days'}`;
      case 'email': return s.subject || 'No subject yet';
      case 'notify': return s.subject || 'To you';
      case 'whatsapp': return s.mode === 'template' ? (s.template ? `Template · ${s.template}` : 'Choose a template') : (s.text || 'Plain text').slice(0, 60);
      case 'tag': return s.tag ? `${s.action === 'remove' ? 'Remove' : 'Add'} “${s.tag}”` : 'Choose a tag';
      case 'stage': return stageName(s.pipelineId, s.stageId) ? `→ ${stageName(s.pipelineId, s.stageId)}` : 'Choose a stage';
      case 'field': return s.fieldId ? `${fieldName(s.fieldId)} → ${s.value || '(empty)'}` : 'Choose a field';
      case 'access': { const p = products.find((x) => x.id === s.productId); return p ? `${s.action === 'revoke' ? 'Remove' : 'Give'} ${p.name}` : 'Choose a product'; }
      case 'enroll': return meta.automations?.find((x) => x.id === s.automationId)?.name || 'Choose an automation';
      case 'note': return (s.text || 'Write a note').slice(0, 60);
      case 'meta': return `${s.event === 'custom' ? s.name || 'Custom event' : META_EVENTS[s.event] || s.event}${s.value ? ` · ₹${s.value}` : ''}`;
      case 'webhook': return s.url ? s.url.replace(/^https?:\/\//, '').slice(0, 40) : 'Enter a URL';
      case 'condition': return `${s.rules.length} rule${s.rules.length === 1 ? '' : 's'} · ${s.match === 'any' ? 'any' : 'all'} must match`;
      case 'split': return `${s.percent}% A · ${100 - s.percent}% B`;
      case 'exit': return 'Nothing after this runs';
      default: return '';
    }
  };
  const trigSummary = () => {
    const t = a.trigger;
    if (t.type === 'stage') return stageName(t.pipelineId, t.stageId) ? `Moves to ${stageName(t.pipelineId, t.stageId)}` : 'Choose a stage';
    if (t.type === 'stuck') return stageName(t.pipelineId, t.stageId) ? `${t.days || 7} days in ${stageName(t.pipelineId, t.stageId)}` : 'Choose a stage';
    if (t.type === 'tag') return t.tag ? `Tag “${t.tag}”` : 'Choose a tag';
    if (t.type === 'quiz' && t.outcome) return `Result: ${t.outcome}`;
    if (t.type === 'field') return t.fieldId ? `${fieldName(t.fieldId)}${t.value ? ` → ${t.value}` : ' changes'}` : 'Choose a field';
    if (t.type === 'date') return t.fieldId ? `${!t.offsetDays ? 'On' : `${Math.abs(t.offsetDays)} days ${t.offsetDays < 0 ? 'before' : 'after'}`} ${fieldName(t.fieldId)}` : 'Choose a date field';
    if (t.funnelId) return funnels.find((f) => f.id === t.funnelId)?.name || '';
    if (t.productId) return products.find((p) => p.id === t.productId)?.name || '';
    return '';
  };

  // ---- the editors (right panel) ----
  const renderRule = (path, i, s, ri) => {
    const r = s.rules[ri];
    const set = (patch) => update(path, i, { rules: s.rules.map((x, j) => (j === ri ? { ...x, ...patch } : x)) });
    const ops = OPS[r.field] || OPS.tag;
    return (
      <div className="zf-rule" key={ri}>
        <div className="zf-rule-h"><small>Rule {ri + 1}</small><button className="icon-btn xs danger" title="Remove rule" aria-label="Remove rule" onClick={() => update(path, i, { rules: s.rules.filter((_, j) => j !== ri) })}><Trash2 size={13} /></button></div>
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
      </div>
    );
  };

  const stepEditor = (path, i, s) => (
    <div className="zf-form">
      {s.type === 'wait' && <>
        <div className="seg sm"><button className={s.mode !== 'until' ? 'on' : ''} onClick={() => update(path, i, { mode: 'duration', amount: s.amount || 1, unit: s.unit || 'days' })}>For a while</button><button className={s.mode === 'until' ? 'on' : ''} onClick={() => update(path, i, { mode: 'until', time: s.time || '10:00' })}>Until a time of day</button></div>
        {s.mode === 'until'
          ? <label>Continue at<div className="au-inline"><input type="time" value={s.time || '10:00'} onChange={(e) => update(path, i, { time: e.target.value })} /> {zoneCity(window.__FF_BIZ_TZ__ || 'Asia/Kolkata')} time</div><small className="muted">So WhatsApp never arrives at night.</small></label>
          : <label>Wait for<div className="au-inline"><input type="number" min="1" value={s.amount ?? 1} onChange={(e) => update(path, i, { amount: e.target.value })} /><select value={s.unit || 'days'} onChange={(e) => update(path, i, { unit: e.target.value })}><option value="minutes">minutes</option><option value="hours">hours</option><option value="days">days</option></select></div></label>}
      </>}
      {(s.type === 'email' || s.type === 'notify') && <>
        {s.type === 'notify' && <p className="hint top">Sent to you, with the contact’s details.</p>}
        <label>Subject<input placeholder="Subject" {...fp(path, i, s, 'subject')} /></label>
        <label>Message<textarea rows={s.type === 'email' ? 9 : 4} placeholder={s.type === 'email' ? 'Hi {{first_name}},\n\n…' : 'Optional message'} {...fp(path, i, s, 'body')} /></label>
        {s.type === 'email' && <p className="hint">An unsubscribe link is added automatically.</p>}
      </>}
      {s.type === 'whatsapp' && <>
        <div className="seg sm"><button className={s.mode === 'template' ? 'on' : ''} onClick={() => update(path, i, { mode: 'template' })}>Approved template</button><button className={s.mode === 'text' ? 'on' : ''} onClick={() => update(path, i, { mode: 'text' })}>Plain text</button></div>
        {s.mode === 'template' ? <>
          <label>Template{waTpls
            ? <WaTemplateSelect list={waTpls} value={s.template} onPick={(t) => update(path, i, { template: t?.name || '', language: t?.language || s.language || 'en' })} inputProps={{ placeholder: 'cart_reminder', ...fp(path, i, s, 'template') }} />
            : <input placeholder="cart_reminder" {...fp(path, i, s, 'template')} />}</label>
          <label>Language<input placeholder="en" {...fp(path, i, s, 'language')} /></label>
          <label>Template variables <small className="muted">· in order, comma separated → {'{{1}}'}, {'{{2}}'}…</small><input placeholder="{{first_name}}, {{checkout_link}}" {...fp(path, i, s, 'params')} /></label>
          <WaTemplateInfo t={waTpls?.find((t) => t.name === s.template)} />
          <p className="hint">{waTpls ? 'Create your own in Settings → Channels → WhatsApp → Your own templates; Meta approves them.' : 'Templates are created and approved in Meta WhatsApp Manager.'} They can be sent any time.</p>
        </> : <>
          <label>Message<textarea rows={5} placeholder="Hi {{first_name}}! …" {...fp(path, i, s, 'text')} /></label>
          <p className="hint warn">Plain text only reaches people who messaged you in the last 24 hours. For automated follow-ups use a template.</p>
        </>}
      </>}
      {s.type === 'tag' && <>
        <div className="seg sm"><button className={s.action !== 'remove' ? 'on' : ''} onClick={() => update(path, i, { action: 'add' })}>Add tag</button><button className={s.action === 'remove' ? 'on' : ''} onClick={() => update(path, i, { action: 'remove' })}>Remove tag</button></div>
        <label>Tag<input placeholder="e.g. hot-lead" value={s.tag} onChange={(e) => update(path, i, { tag: e.target.value })} /></label>
      </>}
      {s.type === 'stage' && <>
        <label>Pipeline<select value={s.pipelineId || ''} onChange={(e) => update(path, i, { pipelineId: e.target.value, stageId: '' })}><option value="">Choose…</option>{pipes.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        <label>Move to<select value={s.stageId || ''} onChange={(e) => update(path, i, { stageId: e.target.value })}><option value="">Choose…</option>{pipe(s.pipelineId)?.stages.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
      </>}
      {s.type === 'field' && (() => { const fd = fields.find((x) => x.id === s.fieldId); return <>
        <label>Field<select value={s.fieldId || ''} onChange={(e) => update(path, i, { fieldId: e.target.value, value: '' })}><option value="">Choose…</option>{fields.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}</select></label>
        <label>Set it to{fd?.type === 'select'
          ? <select value={s.value || ''} onChange={(e) => update(path, i, { value: e.target.value })}><option value="">(empty)</option>{String(fd.options || '').split(',').map((o) => o.trim()).filter(Boolean).map((o) => <option key={o} value={o}>{o}</option>)}</select>
          : fd?.type === 'checkbox' ? <select value={s.value || ''} onChange={(e) => update(path, i, { value: e.target.value })}><option value="yes">Yes</option><option value="">No</option></select>
          : <input placeholder={fd?.type === 'date' ? 'today, +3 days or 2026-12-31' : fd?.type === 'money' || fd?.type === 'number' ? '25000' : 'value or {{first_name}}…'} {...fp(path, i, s, 'value')} />}</label>
        {!fields.length && <p className="hint warn">Add custom fields first — CRM → Custom fields, or pick a CRM style.</p>}
        {fd?.type === 'date' && <p className="hint">“today” or “+3 days” counts from the day this step runs.</p>}
      </>; })()}
      {s.type === 'access' && <>
        <div className="seg sm"><button className={s.action !== 'revoke' ? 'on' : ''} onClick={() => update(path, i, { action: 'grant' })}>Give access</button><button className={s.action === 'revoke' ? 'on' : ''} onClick={() => update(path, i, { action: 'revoke' })}>Remove access</button></div>
        <label>Product or course<select value={s.productId || ''} onChange={(e) => update(path, i, { productId: e.target.value })}><option value="">Choose…</option>{products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        {s.action !== 'revoke' && <label className="tog"><input type="checkbox" checked={s.notify !== false} onChange={(e) => update(path, i, { notify: e.target.checked })} /><span />Email them the access link</label>}
        {!products.length && <p className="hint warn">Create a product or course first in Products.</p>}
      </>}
      {s.type === 'enroll' && <>
        <label>Start this automation<select value={s.automationId || ''} onChange={(e) => update(path, i, { automationId: e.target.value })}><option value="">Choose…</option>{(meta.automations || []).filter((x) => x.id !== a.id).map((x) => <option key={x.id} value={x.id}>{x.name}{x.active ? '' : ' (paused)'}</option>)}</select></label>
        <p className="hint">The contact enters it from its first step — handy to hand a buyer over to an onboarding sequence.</p>
      </>}
      {s.type === 'note' && <label>Note on the contact’s timeline<textarea rows={4} placeholder="e.g. Asked about the loan — call back on Monday" {...fp(path, i, s, 'text')} /></label>}
      {s.type === 'meta' && <>
        <label>Event<select value={s.event} onChange={(e) => update(path, i, { event: e.target.value })}>{Object.entries(META_EVENTS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        {s.event === 'custom' && <label>Event name<input placeholder="e.g. SiteVisitDone" value={s.name || ''} onChange={(e) => update(path, i, { name: e.target.value.replace(/[^\w]/g, '') })} /></label>}
        <label>Value in ₹ <small className="muted">(optional)</small><input placeholder={s.event === 'Purchase' ? 'e.g. 4999 or {{amount}}' : 'e.g. 500'} {...fp(path, i, s, 'value')} /></label>
        <p className="hint">Sends this contact (email and phone, hashed) to your Meta pixel as a server event. Meta matches it to the ad they came from, so campaigns optimised for this event find more people like your best leads.</p>
        {!meta.channels?.meta && <p className="hint warn">Connect Meta Ads and pick a pixel in <Link to="/settings#apps">Settings → Apps &amp; ads</Link> — until then this step is skipped.</p>}
      </>}
      {s.type === 'webhook' && <><label>URL<input placeholder="https://hooks.zapier.com/…" value={s.url} onChange={(e) => update(path, i, { url: e.target.value })} /></label><p className="hint">Sends the contact’s details (signed, retried) — e.g. to Zapier, Pabbly or Google Sheets.</p></>}
      {s.type === 'exit' && <p className="hint top">The automation ends here for this contact — nothing after this step runs.</p>}
      {s.type === 'split' && <>
        <label>Path A gets<div className="au-inline"><input type="number" min="5" max="95" value={s.percent} onChange={(e) => update(path, i, { percent: e.target.value })} />% of contacts · Path B the rest ({Math.max(0, 100 - (Number(s.percent) || 0))}%)</div></label>
        <p className="hint">Test two messages, offers or timings. Results show how many in each path bought afterwards.</p>
      </>}
      {s.type === 'condition' && <>
        <label>Go to <b className="yes">Yes</b> when<select value={s.match} onChange={(e) => update(path, i, { match: e.target.value })}><option value="all">all of these are true</option><option value="any">any of these is true</option></select></label>
        {s.rules.map((r, ri) => renderRule(path, i, s, ri))}
        <button className="btn ghost sm" onClick={() => update(path, i, { rules: [...s.rules, { field: 'tag', op: 'is', value: '' }] })}><Plus size={13} /> Add rule</button>
      </>}
    </div>
  );

  const triggerEditor = () => (
    <div className="zf-form">
      <button className="zf-pick" onClick={() => setPicker({ mode: 'trigger' })}><span className="zf-ic" style={{ '--sc': '#f59e0b' }}><TI size={16} /></span><span><b>{meta.triggers[a.trigger.type]}</b><small>Change trigger</small></span></button>
      {['lead', 'quiz', 'purchase', 'offer', 'abandoned'].includes(a.trigger.type) && (
        <label>Funnel<select value={a.trigger.funnelId || ''} onChange={(e) => setTrigger({ funnelId: e.target.value || undefined })}><option value="">Any funnel</option>{funnels.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</select></label>
      )}
      {COURSE_TRIGGERS.includes(a.trigger.type) && a.trigger.type !== 'community_post' && (
        <label>Course<select value={a.trigger.productId || ''} onChange={(e) => setTrigger({ productId: e.target.value || undefined })}><option value="">Any course</option>{products.filter((p) => p.lessons > 0).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
      )}
      {a.trigger.type === 'abandoned' && <label>Counts as abandoned after<div className="au-inline"><input type="number" min="5" value={a.trigger.delayMin || 30} onChange={(e) => setTrigger({ delayMin: e.target.value })} /> minutes without paying</div></label>}
      {(a.trigger.type === 'stage' || a.trigger.type === 'stuck') && <>
        <label>Pipeline<select value={a.trigger.pipelineId || ''} onChange={(e) => setTrigger({ pipelineId: e.target.value, stageId: '' })}><option value="">Choose…</option>{pipes.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        <label>Stage<select value={a.trigger.stageId || ''} onChange={(e) => setTrigger({ stageId: e.target.value })}><option value="">Choose…</option>{pipe(a.trigger.pipelineId)?.stages.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
      </>}
      {a.trigger.type === 'stuck' && <>
        <label>After<div className="au-inline"><input type="number" min="1" max="365" value={a.trigger.days || 7} onChange={(e) => setTrigger({ days: e.target.value })} /> days in this stage</div></label>
        <p className="hint">Counts from when they were moved into the stage. Runs once each time they enter it.</p>
      </>}
      {a.trigger.type === 'quiz' && <><label>Result<input value={a.trigger.outcome || ''} onChange={(e) => setTrigger({ outcome: e.target.value })} placeholder="Any result (leave empty) — or e.g. The Starter Path" /></label><p className="hint">Use {'{{quiz_result}}'} in messages for the result they got. Answer tags (set in the quiz) also start “A tag is added” automations.</p></>}
      {a.trigger.type === 'tag' && <label>Tag<input value={a.trigger.tag || ''} onChange={(e) => setTrigger({ tag: e.target.value })} placeholder="e.g. webinar" /></label>}
      {a.trigger.type === 'field' && (() => { const fd = fields.find((x) => x.id === a.trigger.fieldId); return <>
        <label>Field<select value={a.trigger.fieldId || ''} onChange={(e) => setTrigger({ fieldId: e.target.value, value: '' })}><option value="">Choose…</option>{fields.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}</select></label>
        <label>Changes to{fd?.type === 'select'
          ? <select value={a.trigger.value || ''} onChange={(e) => setTrigger({ value: e.target.value })}><option value="">Any value</option>{String(fd.options || '').split(',').map((o) => o.trim()).filter(Boolean).map((o) => <option key={o} value={o}>{o}</option>)}</select>
          : <input value={a.trigger.value || ''} onChange={(e) => setTrigger({ value: e.target.value })} placeholder="any value (leave empty)" />}</label>
        {!fields.length && <p className="hint warn">Add custom fields first — CRM → Custom fields, or pick a CRM style.</p>}
      </>; })()}
      {a.trigger.type === 'date' && <>
        <label>Date field<select value={a.trigger.fieldId || ''} onChange={(e) => setTrigger({ fieldId: e.target.value })}><option value="">Choose…</option>{dateFields.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}</select></label>
        {!dateFields.length && <p className="hint warn">Create a date field first (e.g. “Birthday” or “Renewal date”) in <Link to="/contacts">CRM → Custom fields</Link>.</p>}
        <label>When<div className="au-inline"><input type="number" min="0" max="365" value={Math.abs(a.trigger.offsetDays || 0)} onChange={(e) => setTrigger({ offsetDays: (a.trigger.offsetDays < 0 ? -1 : 1) * Math.abs(Number(e.target.value) || 0) })} /> days
          <select value={!a.trigger.offsetDays ? 'on' : a.trigger.offsetDays < 0 ? 'before' : 'after'} onChange={(e) => { const n = Math.abs(a.trigger.offsetDays || 1); setTrigger({ offsetDays: e.target.value === 'on' ? 0 : e.target.value === 'before' ? -n : n }); }}><option value="before">before</option><option value="on">— on the day</option><option value="after">after</option></select></div></label>
        <label>At<div className="au-inline"><input type="time" value={a.trigger.time || '10:00'} onChange={(e) => setTrigger({ time: e.target.value })} /> {zoneCity(window.__FF_BIZ_TZ__ || 'Asia/Kolkata')} time</div></label>
        <label className="tog"><input type="checkbox" checked={!!a.trigger.yearly} onChange={(e) => setTrigger({ yearly: e.target.checked })} /><span />Every year (birthdays, anniversaries)</label>
      </>}
      {a.trigger.type === 'manual' && <p className="hint">Add people from their contact screen, or select many in CRM → “Add to automation”.</p>}
      {a.trigger.type === 'inbound' && (a.hookUrl && !dirty ? <>
        <label>Your webhook URL<div className="au-inline"><input readOnly value={a.hookUrl} onFocus={(e) => e.target.select()} /><button className="btn ghost sm" onClick={() => { navigator.clipboard?.writeText(a.hookUrl); toast('Copied'); }}><Copy size={13} /> Copy</button></div></label>
        <p className="hint">POST JSON with <code>email</code> and/or <code>phone</code>, plus optional <code>name</code>, <code>tags</code> and <code>source</code> — e.g. from Zapier, Pabbly, Make or a Google Form script.</p>
      </> : <p className="hint">Save to get your webhook URL.</p>)}
    </div>
  );

  // ---- the canvas ----
  // a plain render function (not a component), so the drop targets stay the same elements while dragging
  const renderConn = (path, at, end) => {
    const k = `${path.join('.')}:${at}`;
    return (
      <div key={k} className={`zf-conn ${dragId ? 'dropping' : ''} ${over === k ? 'over' : ''} ${end ? 'end' : ''}`}
        onDragOver={(e) => { if (dragId) { e.preventDefault(); if (over !== k) setOver(k); } }}
        onDragLeave={() => over === k && setOver(null)}
        onDrop={(e) => { e.preventDefault(); dropAt(path, at); }}>
        <button className="zf-plus" onClick={() => setPicker({ mode: 'step', path, at, depth: path.length / 2 })} title="Add a step here" aria-label="Add a step here"><Plus size={14} /></button>
      </div>
    );
  };
  const renderCard = (path, i, s) => {
    const S = STEP[s.type] || { label: s.type, icon: Zap, color: '#64748b' };
    const er = s.type === 'email' && a.emailResults?.[s.id];
    const stats = er?.sent ? `${er.sent} sent · ${Math.round((er.opened / er.sent) * 100)}% opened` : statText(a.stepStats?.[s.id], s.type);
    const miss = missing(s);
    return (
      <div className={`zf-card ${sel === s.id ? 'on' : ''} ${dragId === s.id ? 'dragging' : ''}`} style={{ '--sc': S.color }} draggable
        onDragStart={(e) => { setDragId(s.id); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', s.id); }}
        onDragEnd={() => { setDragId(null); setOver(null); }}
        onClick={() => setSel(s.id)} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') setSel(s.id); }}>
        <span className="zf-grip" aria-hidden="true"><GripVertical size={14} /></span>
        <span className="zf-ic"><S.icon size={16} /></span>
        <span className="zf-txt"><b>{S.label}</b><small>{summary(s)}</small></span>
        {miss && <span className="zf-miss" title={miss} />}
        {stats && <span className="zf-stat">{stats}</span>}
      </div>
    );
  };
  const renderList = (list, path) => (
    <div className="zf-list">
      {renderConn(path, 0)}
      {list.map((s, i) => (
        <div key={s.id || `${path.join('.')}-${i}`} className="zf-item">
          {renderCard(path, i, s)}
          {BRANCH_KEYS[s.type] && (
            <div className="zf-branches">
              {BRANCH_KEYS[s.type].map((b) => {
                const sr = s.type === 'split' && a.splitResults?.[s.id];
                return (
                  <div key={b} className={`zf-branch ${b}`}>
                    <div className="zf-blabel">{BRANCH_TITLE[b]}{s.type === 'split' && ` · ${b === 'a' ? s.percent : 100 - s.percent}%`}{sr && sr[b].n > 0 && <small> · {sr[b].bought}/{sr[b].n} bought</small>}</div>
                    {renderList(s[b], [...path, i, b])}
                  </div>
                );
              })}
            </div>
          )}
          {renderConn(path, i + 1, i === list.length - 1)}
        </div>
      ))}
    </div>
  );

  // ---- pickers (trigger / step), Zapier style: search + categories ----
  const pickerItems = picker?.mode === 'trigger'
    ? TRIGGER_GROUPS.map(([g, keys]) => [g, keys.filter((k) => meta.triggers[k]).map((k) => ({ key: k, icon: TRIGGER_ICON[k] || Zap, title: meta.triggers[k].split(' (')[0], text: TRIGGER_HELP[k] || meta.triggers[k], color: '#f59e0b' }))])
    : STEP_GROUPS.map(([g, keys]) => [g, keys.filter((k) => !BRANCH_KEYS[k] || (picker?.depth || 0) < 3).map((k) => ({ key: k, icon: STEP[k].icon, title: STEP[k].label, text: STEP_HELP[k], color: STEP[k].color }))]);
  const needle = pq.trim().toLowerCase();
  const shown = pickerItems.map(([g, items]) => [g, items.filter((x) => !needle || `${x.title} ${x.text} ${g}`.toLowerCase().includes(needle))]).filter(([, items]) => items.length);
  const choose = (key) => {
    if (picker.mode === 'trigger') { setTrigger({ type: key }); setPicker(null); setSel('trigger'); setPq(''); return; }
    addAt(picker.path, picker.at, key); setPq('');
  };

  const selPanel = sel === 'trigger'
    ? { title: 'Trigger', icon: TI, color: '#f59e0b', body: triggerEditor() }
    : selected ? { title: STEP[selected.s.type]?.label, icon: STEP[selected.s.type]?.icon || Zap, color: STEP[selected.s.type]?.color, body: stepEditor(selected.path, selected.i, selected.s), s: selected.s } : null;

  return (
    <Layout title={<span className="au-title"><Link to="/automations" className="icon-btn" title="All automations" aria-label="All automations"><ArrowLeft size={18} /></Link><input value={a.name} onChange={(e) => edit({ name: e.target.value })} aria-label="Automation name" /></span>}
      subtitle={a.active ? '● Live — new contacts that match the trigger enter it automatically' : 'Paused — nothing is sent while it’s off'}
      wide
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
      {picker && (
        <Modal title={picker.mode === 'trigger' ? 'When should this start?' : 'Add a step'} onClose={() => { setPicker(null); setPq(''); }} width={760}>
          <div className="m-body zf-picker">
            <div className="zf-search"><Search size={16} /><input autoFocus value={pq} onChange={(e) => setPq(e.target.value)} placeholder={picker.mode === 'trigger' ? 'Search triggers — sale, form, stage, course…' : 'Search steps — email, WhatsApp, tag, wait…'} /></div>
            {shown.map(([g, items]) => (
              <section key={g}>
                <h5>{g}</h5>
                <div className="zf-grid">{items.map((x) => (
                  <button key={x.key} className={`zf-opt ${picker.mode === 'trigger' && a.trigger.type === x.key ? 'on' : ''}`} style={{ '--sc': x.color }} onClick={() => choose(x.key)}>
                    <span className="zf-ic"><x.icon size={16} /></span><span><b>{x.title}</b><small>{x.text}</small></span>
                  </button>
                ))}</div>
              </section>
            ))}
            {!shown.length && <p className="muted center">Nothing matches “{pq}”.</p>}
          </div>
        </Modal>
      )}
      <div className="zf-wrap">
        <div className="zf-canvas" onClick={(e) => { if (e.target === e.currentTarget) setSel(null); }}>
          <div className="zf-flow">
            <div className="zf-start">Start</div>
            <div className={`zf-card trig ${sel === 'trigger' ? 'on' : ''}`} style={{ '--sc': '#f59e0b' }} onClick={() => setSel('trigger')} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') setSel('trigger'); }}>
              <span className="zf-ic"><TI size={16} /></span>
              <span className="zf-txt"><small className="zf-kicker">Trigger</small><b>{meta.triggers[a.trigger.type]?.split(' (')[0]}</b>{trigSummary() && <small>{trigSummary()}</small>}</span>
              {trigMissing() && <span className="zf-miss" title={trigMissing()} />}
            </div>
            {renderList(a.steps, [])}
            <div className="zf-endcap">End</div>
            {!a.steps.length && <p className="hint center">Press + to add the first step — or drag steps around once you have a few.</p>}
          </div>
        </div>

        <aside className="zf-side">
          {selPanel ? (
            <div className="zf-insp">
              <header style={{ '--sc': selPanel.color }}>
                <span className="zf-ic"><selPanel.icon size={16} /></span>
                <b>{selPanel.title}</b>
                {selPanel.s && ['email', 'notify', 'whatsapp'].includes(selPanel.s.type) && <button className="btn ghost sm" onClick={() => testStep(selPanel.s)} title="Send this message to yourself with sample data"><Send size={13} /> Test</button>}
                {/* moving without dragging: phones and tablets can't drag, keyboards can't either */}
                {selected && <button className="icon-btn" title="Move up" aria-label="Move step up" disabled={selected.i === 0} onClick={() => mutate((st) => { const l = listRef(st, selected.path); [l[selected.i - 1], l[selected.i]] = [l[selected.i], l[selected.i - 1]]; })}><ChevronUp size={16} /></button>}
                {selected && <button className="icon-btn" title="Move down" aria-label="Move step down" disabled={selected.i === listRef(a.steps, selected.path).length - 1} onClick={() => mutate((st) => { const l = listRef(st, selected.path); [l[selected.i + 1], l[selected.i]] = [l[selected.i], l[selected.i + 1]]; })}><ChevronDown size={16} /></button>}
                {selected && <button className="icon-btn" title="Duplicate" aria-label="Duplicate step" onClick={() => dup(selected.path, selected.i)}><Copy size={15} /></button>}
                {selected && <button className="icon-btn danger" title="Remove" aria-label="Remove step" onClick={() => del(selected.path, selected.i, selected.s)}><Trash2 size={15} /></button>}
                <button className="icon-btn" title="Close" aria-label="Close" onClick={() => setSel(null)}><X size={16} /></button>
              </header>
              {(selected ? missing(selected.s) : trigMissing()) && <p className="zf-need"><AlertTriangle size={14} /> {selected ? missing(selected.s) : trigMissing()}</p>}
              {selPanel.body}
              <div className="zf-vars">
                <small className="muted">Personalise — click into a message, then:</small>
                <div className="au-vars">{meta.variables.map((v) => <button key={v} onMouseDown={(e) => e.preventDefault()} onClick={() => insertVar(v)}>{`{{${v}}}`}</button>)}</div>
                {fields.length > 0 && <div className="au-vars">{fields.map((x) => <button key={x.id} title={`{{f_${x.id}}}`} onMouseDown={(e) => e.preventDefault()} onClick={() => insertVar(`f_${x.id}`.toLowerCase())}>{x.label.replace(/ \(₹\)$/, '')}</button>)}</div>}
              </div>
            </div>
          ) : (
            <>
              {(errors.length > 0 || warnings.length > 0) && !dirty && (
                <Panel title="Before it goes live">
                  {errors.map((e) => <p key={e} className="au-err"><AlertTriangle size={14} /> {e}</p>)}
                  {warnings.map((w) => <p key={w} className="au-warn"><AlertTriangle size={14} /> {w}</p>)}
                </Panel>
              )}
              <Panel title="How it works">
                <p className="hint top">Click a card to edit it. Press <b>+</b> to add a step, or drag a card onto any line to move it — into and out of If / else branches too.</p>
              </Panel>
              <Panel title="Options">
                <label className="tog"><input type="checkbox" checked={!!a.stopOnPurchase} onChange={(e) => edit({ stopOnPurchase: e.target.checked })} /><span />Stop when the contact buys</label>
                <p className="hint">Recommended for reminders and lead nurturing.</p>
                <label className="tog"><input type="checkbox" checked={!!a.allowRepeat} onChange={(e) => edit({ allowRepeat: e.target.checked })} /><span />Allow a contact to go through it again</label>
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
            </>
          )}
        </aside>
      </div>
    </Layout>
  );
}
