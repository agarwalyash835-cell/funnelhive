// CRM kits: the CRM shaped for a kind of business — its words (Patients, Buyers, Clients), its fields (budget and
// BHK for property, next appointment for a clinic), its pipeline stages, the columns and board cards that matter,
// quick filters and the money field the board totals. Switching kits never deletes data: fields from an earlier
// kit stay on the contacts (and in Custom fields); only what's shown changes. AI can design a kit from a description.
import { T, uid } from './db.js';
import { pipelinesFor, FIELD_TYPES } from './crm.js';
import { aiEnabled, aiJson } from './ai.js';

const S = (name, color, flag) => ({ name, color, ...(flag ? { [flag]: true } : {}) });
const sel = (id, label, options) => ({ id, label, type: 'select', options });
const f = (id, label, type = 'text') => ({ id, label, type });

export const KITS = [
  {
    id: 'general', name: 'Coach & creator', icon: '🎯', desc: 'Leads from your funnels, customers from checkouts, lifetime value — the standard FunnelHive CRM.',
    labels: { title: 'Contacts', one: 'contact', customers: 'Customers', leads: 'Leads', value: 'Lifetime value' },
    fields: [], pipeline: null, columns: [], cardFields: [], filters: [], valueField: null, showSales: true,
  },
  {
    id: 'realestate', name: 'Real estate builder / broker', icon: '🏠', desc: 'Budget, BHK, location and site visits — from portal enquiry to booking.',
    labels: { title: 'Leads', one: 'lead', customers: 'Buyers', leads: 'Prospects', value: 'Budget' },
    fields: [
      f('re_budget', 'Budget (₹)', 'money'), sel('re_type', 'Property type', 'Apartment, Villa, Plot, Row house, Commercial shop, Office space'),
      sel('re_bhk', 'BHK', '1 RK, 1 BHK, 2 BHK, 3 BHK, 4 BHK, 5+ BHK'), f('re_location', 'Preferred location'), f('re_project', 'Project / property'),
      sel('re_purpose', 'Purpose', 'Self use, Investment, Rent / lease'), sel('re_timeline', 'Buying in', 'Immediately, 1–3 months, 3–6 months, 6+ months'),
      f('re_visit', 'Site visit', 'date'), sel('re_loan', 'Home loan', 'Needed, Not needed, Pre-approved'),
      sel('re_from', 'Enquiry from', '99acres, MagicBricks, Housing.com, Facebook ads, Google ads, Walk-in, Referral, Channel partner, Website'),
    ],
    pipeline: { name: 'Property sales', stages: [S('New enquiry', '#6366f1'), S('Contacted', '#0ea5e9'), S('Site visit scheduled', '#f59e0b'), S('Site visit done', '#8b5cf6'), S('Negotiation', '#ec4899'), S('Booking done', '#16a34a', 'won'), S('Lost', '#94a3b8', 'lost')] },
    columns: ['re_budget', 're_bhk', 're_location', 're_visit'], cardFields: ['re_budget', 're_bhk', 're_location'], filters: ['re_type', 're_bhk', 're_timeline', 're_from'], valueField: 're_budget', showSales: false,
  },
  {
    id: 'clinic', name: 'Clinic & healthcare', icon: '🩺', desc: 'Patients, concerns, doctors, next appointments and follow-ups.',
    labels: { title: 'Patients', one: 'patient', customers: 'Patients', leads: 'Enquiries', value: 'Treatment value' },
    fields: [
      f('cl_concern', 'Concern / reason for visit'), f('cl_doctor', 'Doctor'), f('cl_next', 'Next appointment', 'date'), f('cl_last', 'Last visit', 'date'),
      f('cl_dob', 'Date of birth', 'date'), sel('cl_gender', 'Gender', 'Female, Male, Other'), f('cl_plan', 'Treatment plan', 'longtext'),
      f('cl_value', 'Treatment value (₹)', 'money'), sel('cl_pay', 'Payment', 'Self pay, Insurance, Corporate'),
      sel('cl_from', 'Found us via', 'Google, Practo, Instagram, Facebook ads, Referral, Walk-in, Website'),
    ],
    pipeline: { name: 'Patient journey', stages: [S('New enquiry', '#6366f1'), S('Appointment booked', '#0ea5e9'), S('Consulted', '#8b5cf6'), S('In treatment', '#f59e0b'), S('Follow-up due', '#ec4899'), S('Treatment completed', '#16a34a', 'won'), S('Not proceeding', '#94a3b8', 'lost')] },
    columns: ['cl_concern', 'cl_next', 'cl_doctor', 'cl_last'], cardFields: ['cl_concern', 'cl_next'], filters: ['cl_gender', 'cl_pay', 'cl_from'], valueField: 'cl_value', showSales: false,
    note: 'Health details are personal data: record only what you need for care, and patients can ask you to erase them.',
  },
  {
    id: 'consultant', name: 'Consultant / agency / B2B', icon: '💼', desc: 'Companies, decision makers, proposals and deal values.',
    labels: { title: 'Clients', one: 'client', customers: 'Clients', leads: 'Prospects', value: 'Deal value' },
    fields: [
      f('co_company', 'Company'), f('co_role', 'Role / designation'), sel('co_industry', 'Industry', 'IT & software, Manufacturing, Retail, Healthcare, Education, Finance, Real estate, Hospitality, Other'),
      sel('co_size', 'Company size', '1–10, 11–50, 51–200, 201–1000, 1000+'), sel('co_service', 'Interested in', 'Strategy, Marketing, Sales, Finance, HR, Technology, Operations'),
      f('co_value', 'Deal value (₹)', 'money'), f('co_proposal', 'Proposal sent', 'date'), f('co_close', 'Expected close', 'date'), f('co_site', 'Website', 'url'),
    ],
    pipeline: { name: 'B2B sales', stages: [S('Lead', '#6366f1'), S('Discovery call', '#0ea5e9'), S('Proposal sent', '#f59e0b'), S('Negotiation', '#ec4899'), S('Won', '#16a34a', 'won'), S('Lost', '#94a3b8', 'lost')] },
    columns: ['co_company', 'co_service', 'co_value', 'co_close'], cardFields: ['co_company', 'co_value'], filters: ['co_industry', 'co_size', 'co_service'], valueField: 'co_value', showSales: false,
  },
  {
    id: 'education', name: 'Coaching institute / admissions', icon: '🎓', desc: 'Enquiries, counselling, demo classes, batches and fees.',
    labels: { title: 'Students', one: 'student', customers: 'Enrolled', leads: 'Enquiries', value: 'Fee' },
    fields: [
      f('ed_student', 'Student name'), sel('ed_course', 'Class / course', 'Class 6–8, Class 9–10, Class 11–12, JEE, NEET, UPSC, CA / CS, Spoken English, Other'),
      f('ed_parent', 'Parent / guardian'), f('ed_demo', 'Demo class', 'date'), f('ed_batch', 'Batch'), sel('ed_mode', 'Mode', 'Offline, Online, Hybrid'),
      f('ed_fee', 'Fee (₹)', 'money'), sel('ed_from', 'Enquiry from', 'Google, Instagram, Facebook ads, JustDial, Referral, Walk-in, School tie-up, Website'),
    ],
    pipeline: { name: 'Admissions', stages: [S('Enquiry', '#6366f1'), S('Counselling done', '#0ea5e9'), S('Demo class', '#f59e0b'), S('Fee discussion', '#ec4899'), S('Admitted', '#16a34a', 'won'), S('Lost', '#94a3b8', 'lost')] },
    columns: ['ed_course', 'ed_demo', 'ed_batch', 'ed_fee'], cardFields: ['ed_course', 'ed_demo'], filters: ['ed_course', 'ed_mode', 'ed_from'], valueField: 'ed_fee', showSales: false,
  },
  {
    id: 'fitness', name: 'Gym, salon & wellness', icon: '💪', desc: 'Trials, memberships, plans and renewals.',
    labels: { title: 'Members', one: 'member', customers: 'Members', leads: 'Enquiries', value: 'Plan value' },
    fields: [
      sel('fi_goal', 'Goal', 'Weight loss, Muscle gain, General fitness, Flexibility, Skin & hair, Relaxation'),
      sel('fi_plan', 'Plan', 'Monthly, Quarterly, Half-yearly, Yearly, Per session'), f('fi_value', 'Plan value (₹)', 'money'),
      f('fi_trial', 'Trial visit', 'date'), f('fi_start', 'Plan start', 'date'), f('fi_renew', 'Renewal due', 'date'), f('fi_trainer', 'Trainer / stylist'),
    ],
    pipeline: { name: 'Memberships', stages: [S('Enquiry', '#6366f1'), S('Trial booked', '#0ea5e9'), S('Trial done', '#f59e0b'), S('Joined', '#16a34a', 'won'), S('Renewal due', '#ec4899'), S('Lost', '#94a3b8', 'lost')] },
    columns: ['fi_goal', 'fi_plan', 'fi_renew', 'fi_trainer'], cardFields: ['fi_plan', 'fi_renew'], filters: ['fi_goal', 'fi_plan'], valueField: 'fi_value', showSales: false,
  },
  {
    id: 'finance', name: 'Financial advisor / insurance / loans', icon: '📈', desc: 'Products, ticket sizes, documents and follow-ups.',
    labels: { title: 'Clients', one: 'client', customers: 'Clients', leads: 'Leads', value: 'Ticket size' },
    fields: [
      sel('fa_product', 'Product', 'Mutual funds / SIP, Life insurance, Health insurance, Home loan, Personal loan, Business loan, Tax filing, Wealth management'),
      f('fa_amount', 'Amount (₹)', 'money'), sel('fa_income', 'Monthly income', 'Under ₹25k, ₹25k–50k, ₹50k–1L, ₹1L–3L, Over ₹3L'), f('fa_age', 'Age', 'number'),
      f('fa_city', 'City'), f('fa_follow', 'Next follow-up', 'date'), sel('fa_docs', 'Documents', 'Pending, Partly received, Complete'),
    ],
    pipeline: { name: 'Advisory pipeline', stages: [S('New lead', '#6366f1'), S('Contacted', '#0ea5e9'), S('Needs analysis', '#8b5cf6'), S('Proposal shared', '#f59e0b'), S('Documents', '#ec4899'), S('Closed', '#16a34a', 'won'), S('Lost', '#94a3b8', 'lost')] },
    columns: ['fa_product', 'fa_amount', 'fa_follow', 'fa_docs'], cardFields: ['fa_product', 'fa_amount'], filters: ['fa_product', 'fa_income', 'fa_docs'], valueField: 'fa_amount', showSales: false,
  },
];
const kitById = (id) => KITS.find((k) => k.id === id) || null;

// ---------- a kit from anywhere (AI, the user) is cleaned before it's used ----------
const str = (v, n) => String(v ?? '').trim().slice(0, n);
const COLORS = ['#6366f1', '#0ea5e9', '#14b8a6', '#f59e0b', '#ec4899', '#8b5cf6', '#16a34a', '#94a3b8'];
export function cleanKit(k) {
  if (!k || typeof k !== 'object') return null;
  const slug = (s) => str(s, 30).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 16);
  const fields = (Array.isArray(k.fields) ? k.fields : []).slice(0, 16).map((x) => {
    const type = FIELD_TYPES.includes(x?.type) ? x.type : 'text';
    const label = str(x?.label, 60);
    return label ? { id: str(x?.id, 20).replace(/[^\w-]/g, '') || `ck_${slug(label)}`, label, type, ...(type === 'select' ? { options: (Array.isArray(x.options) ? x.options.join(', ') : str(x.options, 600)) || 'Option 1, Option 2' } : {}) } : null;
  }).filter(Boolean).filter((x, i, a) => a.findIndex((y) => y.id === x.id) === i);
  const ids = new Set(fields.map((x) => x.id));
  const pick = (list, n, ok = () => true) => (Array.isArray(list) ? list : []).map(String).filter((id) => ids.has(id) && ok(fields.find((x) => x.id === id))).slice(0, n);
  const stages = (Array.isArray(k.pipeline?.stages) ? k.pipeline.stages : []).slice(0, 10).map((s, i) => ({ name: str(s?.name ?? s, 40) || `Stage ${i + 1}`, color: /^#[0-9a-f]{6}$/i.test(s?.color) ? s.color : COLORS[i % COLORS.length], ...(s?.won ? { won: true } : {}), ...(s?.lost ? { lost: true } : {}) }));
  const L = k.labels || {};
  return {
    id: 'custom', name: str(k.name, 60) || 'My CRM', icon: str(k.icon, 4) || '✨', desc: str(k.desc, 200),
    labels: { title: str(L.title, 30) || 'Contacts', one: str(L.one, 30).toLowerCase() || 'contact', customers: str(L.customers, 30) || 'Customers', leads: str(L.leads, 30) || 'Leads', value: str(L.value, 30) || 'Value' },
    fields, pipeline: stages.length >= 2 ? { name: str(k.pipeline?.name, 60) || 'Pipeline', stages } : null,
    columns: pick(k.columns, 5), cardFields: pick(k.cardFields, 3), filters: pick(k.filters, 4, (x) => x.type === 'select'),
    valueField: pick([k.valueField], 1, (x) => x.type === 'money' || x.type === 'number')[0] || null, showSales: !!k.showSales,
  };
}

// ---------- switching ----------
// fields: added when missing (matched by id, then by name — nothing is duplicated or removed); the kit's pipeline:
// reused if one with that name exists, else created; the kit becomes what Contacts shows
export function applyKit(userId, kit) {
  const u = T.users.get(userId);
  const have = u.crmFields || [];
  const fields = [...have], idMap = {};
  for (const x of kit.fields) {
    const ex = have.find((y) => y.id === x.id) || have.find((y) => y.label.toLowerCase() === x.label.toLowerCase());
    if (ex) { idMap[x.id] = ex.id; continue; }
    if (fields.length >= 30) continue;
    fields.push({ ...x }); idMap[x.id] = x.id;
  }
  let pipelineId = null;
  if (kit.pipeline) {
    const pipes = pipelinesFor(userId);
    const same = pipes.find((p) => p.name.toLowerCase() === kit.pipeline.name.toLowerCase());
    if (same) pipelineId = same.id;
    else if (pipes.length < 20) pipelineId = T.pipelines.insert({ id: uid(), userId, name: kit.pipeline.name, stages: kit.pipeline.stages.map((s) => ({ id: uid(), ...s })), at: Date.now() }).id;
  }
  const map = (list) => (list || []).map((id) => idMap[id]).filter(Boolean);
  const current = {
    id: kit.id, name: kit.name, icon: kit.icon, labels: kit.labels, columns: map(kit.columns), cardFields: map(kit.cardFields), filters: map(kit.filters),
    valueField: kit.valueField ? idMap[kit.valueField] || null : null, showSales: !!kit.showSales, pipelineId, ...(kit.note ? { note: kit.note } : {}), at: Date.now(),
  };
  T.users.update(userId, (x) => { x.crmFields = fields; x.settings = { ...x.settings, crmKit: current }; });
  return { current, fields };
}
export const currentKit = (u) => u?.settings?.crmKit || { ...kitById('general'), pipelineId: null };

const KIT_SYSTEM = `You design a CRM for one kind of business (Indian context unless told otherwise). Reply with ONLY JSON:
{"name": "short name of this CRM", "icon": "one emoji", "desc": "one line",
 "labels": {"title": "what the contacts list is called (plural, e.g. Patients)", "one": "one of them (singular, lowercase)", "customers": "those who bought / signed up", "leads": "those who haven't yet", "value": "what the money field means"},
 "fields": [{"id": "short_snake_case", "label": "Field name", "type": "text|longtext|number|money|phone|date|select|url|checkbox", "options": "for select only: Option A, Option B"}],
 "pipeline": {"name": "pipeline name", "stages": [{"name": "Stage"}, ..., {"name": "Won-type stage", "won": true}, {"name": "Lost", "lost": true}]},
 "columns": [field ids to show as list columns, up to 4], "cardFields": [up to 2 field ids on pipeline cards], "filters": [up to 3 SELECT field ids for quick filters], "valueField": "a money field id or null", "showSales": false}
Rules: 6–12 fields that this business really tracks; 5–8 stages in the real order of their sales process; never ask for passwords, card numbers, Aadhaar/PAN or other identity numbers; keep health or financial details minimal.`;

export function registerCrmKits(app, { auth, wrap, rateLimit, isTest, credits }) {
  const view = (u) => ({ current: currentKit(u), kits: KITS });
  app.get('/api/crm/kits', auth, (req, res) => res.json(view(req.user)));
  // switch to a built-in kit ({ id }) or a designed one ({ kit })
  app.post('/api/crm/kit', auth, (req, res) => {
    const kit = req.body?.id ? kitById(String(req.body.id)) : cleanKit(req.body?.kit);
    if (!kit) return res.status(400).json({ error: 'Pick a CRM style' });
    const r = applyKit(req.user.id, kit);
    res.json({ ...r, kits: KITS });
  });
  // AI: a kit designed from a description of the business — returned for a preview, not applied
  app.post('/api/ai/crm-kit', auth, rateLimit({ windowMs: 60000, max: isTest ? 100 : 6, key: (req) => req.user.id }), credits('edit'), wrap(async (req, res) => {
    if (!aiEnabled()) return res.status(503).json({ error: 'AI isn’t switched on for this server yet' });
    const d = str(req.body?.description, 1500);
    if (d.length < 8) return res.status(400).json({ error: 'Describe your business in a sentence or two' });
    let out;
    try { out = await aiJson(KIT_SYSTEM, d); } catch { return res.status(502).json({ error: 'The AI couldn’t design it just now — please try again' }); }
    const kit = cleanKit(out);
    if (!kit?.fields.length) return res.status(502).json({ error: 'The AI returned an empty design — please try again' });
    res.json({ kit });
  }));
}
