// Automations: "when <trigger> → wait / email / WhatsApp / tag / move stage / webhook / notify me".
// Each contact that enters an automation gets a persisted run; a background worker advances runs
// whose wait is over. Every message sent (or skipped, and why) is written to the contact's timeline.
import crypto from 'node:crypto';
import { T, q, tx, uid, JOBS, ordersByPhone } from './db.js';
import { sendEmail, sendWhatsApp, emailStatus, whatsappStatus } from './messaging.js';
import { logActivity, contactKey, ensureMeta, metaFor, stageFor, cleanCustom, pipelinesFor } from './crm.js';
import { funnelUrl } from './domains.js';
import { enqueue as fireWebhook, checkWebhookUrl } from './webhooks.js';
import { accessFor } from './billing.js';
import { sellerTz, zoned, localYmd, addDays } from './tz.js';
import { broadcastSeen } from './broadcasts.js';
import { waOptedOut } from './hive-wa.js';
import { sendCrmEvent, metaReady } from './tracking.js';
export const META_STEP_EVENTS = ['Lead', 'QualifiedLead', 'Schedule', 'Contact', 'SubmitApplication', 'CompleteRegistration', 'Purchase', 'custom'];

export const TRIGGERS = {
  lead: 'Someone signs up (opt-in or form)',
  quiz: 'Someone finishes a quiz (any result, or one result)',
  purchase: 'Someone buys',
  offer: 'Someone accepts an upsell / downsell / add-on',
  abandoned: 'Someone starts checkout but doesn’t pay',
  refund: 'Someone is refunded',
  booking: 'Someone books a call',
  booking_cancelled: 'Someone cancels a booked call',
  shipped: 'An order is shipped (courier + tracking)',
  renewal: 'A membership renews / an instalment is paid',
  payment_failed: 'A membership or instalment payment fails',
  webinar_registered: 'Someone registers for a webinar',
  webinar_attended: 'Someone attended a webinar (after it ends)',
  webinar_missed: 'Someone registered but missed a webinar (after it ends)',
  stage: 'A contact moves to a pipeline stage',
  tag: 'A tag is added to a contact',
  field: 'A contact field changes (e.g. Home loan → Needed)',
  stuck: 'A contact stays in a pipeline stage too long',
  date: 'A date in a contact field arrives (birthday, renewal…)',
  student_joined: 'A student signs in to the members area for the first time',
  quiz_passed: 'A student passes a quiz',
  course_completed: 'A student finishes a course (certificate earned)',
  community_post: 'A student posts in the community',
  quote_viewed: 'A client opens a quote',
  quote_accepted: 'A client accepts a quote (without paying online)',
  quote_declined: 'A client declines a quote',
  inbound: 'A webhook is received (Zapier, Pabbly, Make, Google Forms…)',
  wa_message: 'A contact messages you on WhatsApp (any message, or one with a keyword)',
  wa_handoff: 'A WhatsApp chat is handed to your team (by a chatbot, the AI agent or a person)',
  wa_resolved: 'A WhatsApp chat is marked resolved',
  manual: 'Only when I add a contact to it',
};
const STEP_TYPES = ['wait', 'email', 'whatsapp', 'tag', 'stage', 'field', 'access', 'enroll', 'note', 'meta', 'webhook', 'notify', 'condition', 'split', 'exit'];
const COURSE_EVENTS = ['student_joined', 'quiz_passed', 'course_completed', 'community_post'];
// branch names inside a step: If/else → yes/no, A/B split → a/b
const BRANCHES = { condition: ['yes', 'no'], split: ['a', 'b'] };
const BRANCH_LABEL = { yes: 'Yes', no: 'No', a: 'Path A', b: 'Path B' };
const UNITS = { minutes: 60000, hours: 3600000, days: 86400000 };
const MAX_STEPS = 60, MAX_DEPTH = 3, MAX_RULES = 10, MAX_PER_USER = 50, LOG_MAX = 60;
const TZ_MIN = Number(process.env.REPORT_TZ_OFFSET_MIN ?? 330); // "wait until 10:00" is India time by default
const TICK = Number(process.env.AUTOMATION_TICK_MS || 15000);
const SCALE = Number(process.env.AUTOMATION_TIME_SCALE || 1); // tests shrink waits
const str = (v, n) => String(v ?? '').slice(0, n);

let SECRET = '';
let originFallback = () => process.env.APP_URL || 'http://localhost:4000';

// ---------- unsubscribe links ----------
const sig = (userId, key) => crypto.createHmac('sha256', SECRET).update(`unsub:${userId}:${key}`).digest('hex').slice(0, 24);
const unsubUrl = (origin, userId, key) => `${origin}/u/${userId}/${encodeURIComponent(key)}/${sig(userId, key)}`;

// open / click tracking and the unsubscribe link for one email (automations and broadcasts)
export const emailTracking = (origin, userId, key, msgId) => {
  const unsubscribeUrl = unsubUrl(origin, userId, key);
  return { unsubscribeUrl, track: { pixel: `${origin}/t/o/${msgId}.gif`, link: (url) => (url === unsubscribeUrl ? url : `${origin}/t/c/${msgId}?u=${encodeURIComponent(url)}&s=${linkSig(msgId, url)}`) } };
};
const linkSig = (id, url) => crypto.createHmac('sha256', SECRET).update(`click:${id}:${url}`).digest('hex').slice(0, 16);

// ---------- template variables ----------
export const VARIABLES = ['first_name', 'name', 'email', 'phone', 'product', 'amount', 'funnel', 'funnel_link', 'checkout_link', 'access_link', 'invoice_link', 'booking_time', 'booking_link', 'meeting_link', 'webinar_time', 'join_link', 'tracking_link', 'courier', 'tracking_id', 'quiz_result', 'quiz_score', 'business'];
export function fill(text, ctx) {
  return String(text || '').replace(/\{\{\s*([a-z][a-z0-9_-]*)\s*\}\}/gi, (m, k) => {
    const v = ctx[k.toLowerCase()];
    return v == null || v === '' ? (k.toLowerCase() === 'first_name' ? 'there' : '') : String(v);
  });
}

// ---------- validation ----------
function cleanTrigger(t = {}, userId) {
  const type = TRIGGERS[t.type] ? t.type : 'lead';
  const out = { type };
  if (t.funnelId && T.funnels.get(t.funnelId)?.userId === userId) out.funnelId = t.funnelId;
  if (type === 'abandoned') out.delayMin = Math.min(10080, Math.max(5, Math.round(Number(t.delayMin) || 30)));
  if (type === 'stage') { out.pipelineId = str(t.pipelineId, 20); out.stageId = str(t.stageId, 20); }
  if (type === 'tag') out.tag = str(t.tag, 30).trim();
  if (type === 'wa_message') out.keyword = str(t.keyword, 60).trim(); // blank = any message
  if (type === 'quiz') out.outcome = str(t.outcome, 120).trim(); // blank = any result
  if (COURSE_EVENTS.includes(type) && t.productId && T.products.get(t.productId)?.userId === userId) out.productId = t.productId; // blank = any course
  if (type === 'field') { out.fieldId = str(t.fieldId, 20); out.value = str(t.value, 200).trim(); } // value: blank = any change
  if (type === 'stuck') { out.pipelineId = str(t.pipelineId, 20); out.stageId = str(t.stageId, 20); out.days = Math.max(1, Math.min(365, Math.round(Number(t.days) || 7))); }
  if (type === 'date') {
    out.fieldId = str(t.fieldId, 20);
    out.offsetDays = Math.max(-365, Math.min(365, Math.round(Number(t.offsetDays) || 0)));
    out.time = /^([01]\d|2[0-3]):[0-5]\d$/.test(t.time) ? t.time : '10:00';
    out.yearly = !!t.yearly;
  }
  return out;
}
// If/else rules: what can be checked about the contact when the automation reaches the step
export const RULE_FIELDS = {
  bought: 'Has bought', tag: 'Has tag', stage: 'Pipeline stage', has: 'Has contact detail', source: 'Came from (source)',
  custom: 'Custom field', amount: 'Order amount (from the trigger)', funnel: 'Trigger funnel', unsubscribed: 'Unsubscribed from emails',
  opened: 'Opened an email (from this automation)', clicked: 'Clicked a link in an email (from this automation)',
  qualified: 'Application qualified (from the trigger)',
};
const RULE_OPS = ['is', 'not', 'equals', 'not_equals', 'contains', 'gt', 'lt', 'empty', 'filled'];
function cleanRule(r = {}) {
  if (!RULE_FIELDS[r.field]) return null;
  return {
    field: r.field, op: RULE_OPS.includes(r.op) ? r.op : 'is', value: str(r.value, 200),
    ...(r.funnelId ? { funnelId: str(r.funnelId, 20) } : {}), ...(r.pipelineId ? { pipelineId: str(r.pipelineId, 20), stageId: str(r.stageId, 20) } : {}),
    ...(r.fieldId ? { fieldId: str(r.fieldId, 20) } : {}), ...(r.stepId ? { stepId: str(r.stepId, 20) } : {}),
  };
}
let stepBudget = 0;
function cleanSteps(list, depth = 0) {
  return (Array.isArray(list) ? list : []).map((x) => cleanStep(x, depth)).filter(Boolean);
}
function cleanStep(s, depth = 0) {
  if (!s || typeof s !== 'object') return null;
  const type = STEP_TYPES.includes(s.type) ? s.type : null;
  if (!type || stepBudget-- <= 0) return null;
  const id = str(s.id, 20) || uid();
  switch (type) {
    case 'wait':
      if (s.mode === 'until') return { id, type, mode: 'until', time: /^([01]\d|2[0-3]):[0-5]\d$/.test(s.time) ? s.time : '10:00' };
      return { id, type, amount: Math.min(365, Math.max(1, Math.round(Number(s.amount) || 1))), unit: UNITS[s.unit] ? s.unit : 'hours' };
    case 'condition':
      if (depth >= MAX_DEPTH) return null;
      return { id, type, match: s.match === 'any' ? 'any' : 'all', rules: (Array.isArray(s.rules) ? s.rules : []).slice(0, MAX_RULES).map(cleanRule).filter(Boolean), yes: cleanSteps(s.yes, depth + 1), no: cleanSteps(s.no, depth + 1) };
    case 'split':
      if (depth >= MAX_DEPTH) return null;
      return { id, type, percent: Math.min(95, Math.max(5, Math.round(Number(s.percent) || 50))), a: cleanSteps(s.a, depth + 1), b: cleanSteps(s.b, depth + 1) };
    case 'exit': return { id, type };
    case 'email': return { id, type, subject: str(s.subject, 200), body: str(s.body, 20000) };
    case 'notify': return { id, type, subject: str(s.subject, 200), body: str(s.body, 5000) };
    case 'whatsapp': return { id, type, mode: s.mode === 'text' ? 'text' : 'template', template: str(s.template, 120).trim(), language: str(s.language, 10).trim() || 'en', params: str(s.params, 1000), text: str(s.text, 4096) };
    case 'tag': return { id, type, tag: str(s.tag, 30).trim(), action: s.action === 'remove' ? 'remove' : 'add' };
    case 'stage': return { id, type, pipelineId: str(s.pipelineId, 20), stageId: str(s.stageId, 20) };
    case 'field': return { id, type, fieldId: str(s.fieldId, 20), value: str(s.value, 500) };
    case 'access': return { id, type, productId: str(s.productId, 20), action: s.action === 'revoke' ? 'revoke' : 'grant', notify: s.notify !== false };
    case 'enroll': return { id, type, automationId: str(s.automationId, 20) };
    case 'note': return { id, type, text: str(s.text, 2000) };
    case 'meta': { // send a CRM event to Meta (Conversions API) so ads optimise for leads that turn into customers
      const ev = META_STEP_EVENTS.includes(s.event) ? s.event : 'custom';
      return { id, type, event: ev, name: ev === 'custom' ? str(s.name, 40).replace(/[^\w]/g, '').trim() : '', value: str(s.value, 200).trim() };
    }
    case 'webhook': return { id, type, url: str(s.url, 500).trim() };
    default: return null;
  }
}
// Problems that would make a step fail — shown in the builder before turning an automation on
// Every step in the tree, with a readable position: "Step 3 → Yes → 1"
function walk(list, fn, label = '') {
  list.forEach((s, i) => {
    const n = label ? `${label} → ${i + 1}` : `Step ${i + 1}`;
    fn(s, n);
    for (const b of BRANCHES[s.type] || []) walk(s[b], fn, `${n} → ${BRANCH_LABEL[b]}`);
  });
}
const allSteps = (list) => { const out = []; walk(list, (s) => out.push(s)); return out; };
export const findStep = (list, id) => allSteps(list).find((s) => s.id === id);
function problems(a, u) {
  const p = [];
  if (a.trigger.type === 'stage' && !a.trigger.stageId) p.push('Choose the pipeline stage that starts this automation');
  if (a.trigger.type === 'tag' && !a.trigger.tag) p.push('Enter the tag that starts this automation');
  if (a.trigger.type === 'field' && !(u.crmFields || []).some((x) => x.id === a.trigger.fieldId)) p.push('Choose the field whose change starts this automation');
  if (a.trigger.type === 'stuck' && !a.trigger.stageId) p.push('Choose the pipeline stage to watch');
  const flat = allSteps(a.steps);
  if (!flat.some((s) => !['wait', 'condition', 'split', 'exit'].includes(s.type))) p.push('Add at least one action (email, WhatsApp, tag…)');
  if (a.trigger.type === 'date') {
    const f = (u.crmFields || []).find((x) => x.id === a.trigger.fieldId);
    if (!f) p.push('Choose the date field that starts this automation');
    else if (f.type !== 'date') p.push(`“${f.label}” isn’t a date field`);
  }
  walk(a.steps, (s, n) => {
    if (s.type === 'condition' && !s.rules.length) p.push(`${n}: add at least one rule to the If / else`);
    if (s.type === 'split' && !s.a.length && !s.b.length) p.push(`${n}: add steps to at least one path of the A/B split`);
    if (s.type === 'condition') s.rules.forEach((r) => {
      if (r.field === 'tag' && !r.value) p.push(`${n}: enter the tag to check`);
      if (r.field === 'stage' && !r.stageId) p.push(`${n}: choose the pipeline stage to check`);
      if (r.field === 'custom' && !r.fieldId) p.push(`${n}: choose the custom field to check`);
      if (r.field === 'amount' && !Number.isFinite(Number(r.value))) p.push(`${n}: enter an amount`);
      if (r.field === 'source' && !r.value) p.push(`${n}: enter the source to check (e.g. instagram)`);
      if ((r.field === 'opened' || r.field === 'clicked') && r.stepId && !flat.some((x) => x.id === r.stepId && x.type === 'email')) p.push(`${n}: the email it checks was removed — pick another`);
    });
    if (s.type === 'email' && (!s.subject || !s.body)) p.push(`${n}: the email needs a subject and a message`);
    if (s.type === 'notify' && !s.subject) p.push(`${n}: add a subject for the notification`);
    if (s.type === 'whatsapp' && s.mode === 'template' && !s.template) p.push(`${n}: enter the approved WhatsApp template name`);
    if (s.type === 'whatsapp' && s.mode === 'text' && !s.text) p.push(`${n}: write the WhatsApp message`);
    if (s.type === 'tag' && !s.tag) p.push(`${n}: enter a tag`);
    if (s.type === 'stage' && !s.stageId) p.push(`${n}: choose a pipeline stage`);
    if (s.type === 'field' && !(u.crmFields || []).some((x) => x.id === s.fieldId)) p.push(`${n}: choose the field to update`);
    if (s.type === 'access' && T.products.get(s.productId)?.userId !== a.userId) p.push(`${n}: choose the product or course`);
    if (s.type === 'enroll' && (!s.automationId || s.automationId === a.id || T.automations.get(s.automationId)?.userId !== a.userId)) p.push(`${n}: choose another automation to start`);
    if (s.type === 'note' && !s.text.trim()) p.push(`${n}: write the note`);
    if (s.type === 'meta' && s.event === 'custom' && !s.name) p.push(`${n}: name the event to send to Meta (e.g. QualifiedLead)`);
    if (s.type === 'webhook' && !s.url) p.push(`${n}: enter the webhook URL`);
  });
  const warn = [];
  const steps = flat;
  if (steps.some((s) => s.type === 'email' || s.type === 'notify') && !emailStatus(u).configured) warn.push('Email sending isn’t set up yet — email steps will be skipped until you add SMTP details in Settings.');
  if (steps.some((s) => s.type === 'whatsapp') && !whatsappStatus(u).configured) warn.push('WhatsApp isn’t connected yet — WhatsApp steps will be skipped until you add your API details in Settings.');
  if (steps.some((s) => s.type === 'meta') && !metaReady(u)) warn.push('Meta isn’t connected yet — “Send to Meta” steps will be skipped until you connect Meta Ads and pick a pixel in Settings → Apps & ads.');
  if (steps.some((s) => s.type === 'whatsapp' && s.mode === 'text')) warn.push('Plain WhatsApp text only delivers if the contact messaged you in the last 24 hours — use an approved template for automated messages.');
  return { errors: p, warnings: warn };
}

// ---------- starting runs ----------
const userOf = (id) => T.users.get(id);
function contextFor(userId, data) {
  const f = data.funnelId ? T.funnels.get(data.funnelId) : null;
  const a = T.automations.all({ userId }).find((x) => x.origin);
  const origin = a?.origin || originFallback();
  const checkout = f?.steps.find((s) => s.type === 'checkout');
  const name = data.name || '';
  return {
    key: data.key || contactKey(data.email, data.phone), name, first_name: name.split(/\s+/)[0] || '', email: data.email || '', phone: data.phone || '',
    qualified: typeof data.qualified === 'boolean' ? data.qualified : null,
    product: data.product || '', amount: data.amount != null ? `₹${Number(data.amount).toLocaleString('en-IN')}` : '', amountRaw: data.amount != null ? Number(data.amount) : null, source: data.source || '', funnel: f?.name || '', funnelId: f?.id || null,
    funnel_link: f ? funnelUrl(f, origin) : '', checkout_link: f ? funnelUrl(f, origin, checkout?.slug) : '', business: userOf(userId)?.settings?.businessName || '', origin,
    access_link: data.accessLink || '', invoice_link: data.invoiceLink || '',
    booking_time: data.bookingTime || '', booking_link: data.bookingLink || '', meeting_link: data.meetingLink || '',
    webinar_time: data.webinarTime || '', join_link: data.joinLink || '',
    quiz_result: data.outcome || '', quiz_score: data.score != null ? String(data.score) : '',
    tracking_link: data.trackingLink || '', courier: data.courier || '', tracking_id: data.trackingId || '',
  };
}
// Called by the app when something happens; starts every matching active automation
export function fire(userId, event, data = {}) {
  try {
    // a purchase immediately ends sequences that were chasing it (no waiting for the next step)
    if ((event === 'purchase' || event === 'offer') && data.email) stopForBuyer(userId, data.email);
    const list = T.automations.all({ userId, triggerType: event, active: 1 });
    for (const a of list) {
      const t = a.trigger;
      if (t.funnelId && t.funnelId !== data.funnelId) continue;
      if (event === 'stage' && (t.pipelineId !== data.pipelineId || t.stageId !== data.stageId)) continue;
      if (event === 'quiz' && t.outcome && t.outcome.toLowerCase() !== String(data.outcome || '').toLowerCase()) continue;
      if (event === 'tag' && String(t.tag).toLowerCase() !== String(data.tag || '').toLowerCase()) continue;
      if (event === 'wa_message' && t.keyword && !String(data.text || '').toLowerCase().includes(t.keyword.toLowerCase())) continue;
      if (COURSE_EVENTS.includes(event) && t.productId && t.productId !== data.productId) continue;
      if (event === 'field' && (t.fieldId !== data.fieldId || (t.value && String(t.value).trim().toLowerCase() !== String(data.value ?? '').trim().toLowerCase()))) continue;
      start(a, data);
    }
  } catch (e) { console.error('automation trigger failed', e); }
}
function start(a, data) {
  const ctx = contextFor(a.userId, data);
  if (!ctx.key) return null;
  // one run per contact per automation (repeats only when the automation allows them)
  const prev = q('SELECT status FROM runs WHERE automationId = ? AND key = ?').all(a.id, ctx.key);
  if (prev.some((r) => r.status === 'active' || !a.allowRepeat)) return null;
  const r = { id: uid(), userId: a.userId, automationId: a.id, key: ctx.key, ctx, pos: [0], nextAt: Date.now(), status: 'active', at: Date.now(), log: [] };
  tx(() => {
    T.runs.insert(r);
    T.automations.update(a.id, (x) => { x.stats = { ...x.stats, started: (x.stats?.started || 0) + 1 }; });
  });
  setImmediate(() => advance(r.id));
  return r;
}

function stopForBuyer(userId, email) {
  const e = String(email).trim().toLowerCase();
  tx(() => {
    for (const r of T.runs.all({ userId, status: 'active', email: e })) {
      if (!T.automations.get(r.automationId)?.stopOnPurchase) continue;
      r.status = 'stopped'; note(r, { result: 'stopped', detail: 'Contact bought — follow-ups stopped' });
      T.runs.put(r);
    }
  });
}

// ---------- running ----------
const inFlight = new Set();
// (a contact with only a phone number, e.g. a phone-only abandoned checkout, is matched by that number)
const boughtSince = (r) => (r.ctx.email ? T.orders.exists({ userId: r.userId, ckey: contactKey(r.ctx.email), at: { gt: r.at } }) : !!r.ctx.phone && ordersByPhone({ userId: r.userId }, r.ctx.phone, r.at).length > 0);
const note = (r, entry) => { r.log.push({ at: Date.now(), ...entry }); if (r.log.length > LOG_MAX) r.log.splice(0, r.log.length - LOG_MAX); };
const meta = (r) => metaFor(r.userId, r.key);

// ---------- if / else ----------
const low = (v) => String(v ?? '').trim().toLowerCase();
function ordersOf(r) {
  const e = low(r.ctx.email);
  if (!e) return [];
  return T.orders.all({ userId: r.userId, ckey: e }, { order: 'at' });
}
// where the contact first came from (their earliest sign-up or order)
function sourceOf(r) {
  if (r.ctx.source) return low(r.ctx.source);
  const hit = [T.orders.find({ userId: r.userId, ckey: r.key }, { order: 'at' }), T.leads.find({ userId: r.userId, ckey: r.key }, { order: 'at' })].filter(Boolean).sort((x, y) => x.at - y.at)[0];
  return low(hit?.source);
}
function cmp(op, actual, expected) {
  const a = low(actual), e = low(expected);
  switch (op) {
    case 'equals': case 'is': return a === e;
    case 'not_equals': case 'not': return a !== e;
    case 'contains': return a.includes(e);
    case 'gt': return Number(actual) > Number(expected);
    case 'lt': return Number(actual) < Number(expected);
    case 'empty': return a === '';
    case 'filled': return a !== '';
    default: return false;
  }
}
export function evalRule(r, rule) {
  const m = meta(r);
  const neg = rule.op === 'not';
  switch (rule.field) {
    case 'bought': {
      const hit = ordersOf(r).some((o) => (!rule.funnelId || o.funnelId === rule.funnelId) && (!rule.value || (o.items || []).some((it) => low(it.name).includes(low(rule.value)))));
      return neg ? !hit : hit;
    }
    case 'tag': { const hit = (m?.tags || []).some((t) => low(t) === low(rule.value)); return neg ? !hit : hit; }
    case 'stage': {
      const p = T.pipelines.get(rule.pipelineId);
      if (!p || p.userId !== r.userId) return false;
      const hit = stageFor(p, m, ordersOf(r).length > 0) === rule.stageId;
      return neg ? !hit : hit;
    }
    case 'has': { const v = rule.value === 'phone' ? m?.phone || r.ctx.phone : m?.email || r.ctx.email; return neg ? !v : !!v; }
    case 'unsubscribed': return neg ? !m?.unsubscribed : !!m?.unsubscribed;
    case 'opened': case 'clicked': {
      const k = rule.field === 'opened' ? 'opens' : 'clicks';
      const hit = T.msgs.all({ runId: r.id }).some((x) => (!rule.stepId || x.stepId === rule.stepId) && x[k] > 0);
      return neg ? !hit : hit;
    }
    case 'source': return cmp(rule.op === 'not' ? 'not_equals' : rule.op === 'is' ? 'equals' : rule.op, sourceOf(r), rule.value);
    case 'funnel': { const hit = r.ctx.funnelId === rule.funnelId; return neg ? !hit : hit; }
    case 'qualified': { const hit = r.ctx.qualified === true; return neg ? !hit : hit; }
    case 'amount': return r.ctx.amountRaw != null && cmp(rule.op, r.ctx.amountRaw, rule.value);
    case 'custom': return cmp(rule.op === 'is' ? 'equals' : rule.op === 'not' ? 'not_equals' : rule.op, m?.custom?.[rule.fieldId], rule.value);
    default: return false;
  }
}
export const evalCondition = (r, s) => (s.match === 'any' ? s.rules.some((x) => evalRule(r, x)) : s.rules.every((x) => evalRule(r, x)));

// A run's position is a path through the tree: [3] = 4th top-level step; [1, 'yes', 0] = first step of the Yes branch of step 2
function listAt(steps, pos) {
  let list = steps;
  for (let k = 0; k + 1 < pos.length; k += 2) list = list?.[pos[k]]?.[pos[k + 1]];
  return Array.isArray(list) ? list : [];
}
// past the end of a branch → continue after its If / else
function settle(steps, pos) {
  pos = [...pos];
  while (pos.length > 1 && pos.at(-1) >= listAt(steps, pos).length) { pos = pos.slice(0, -2); pos[pos.length - 1]++; }
  return pos;
}
const nextPos = (steps, pos) => settle(steps, [...pos.slice(0, -1), pos.at(-1) + 1]);
const posLabel = (pos) => pos.map((x) => (typeof x === 'number' ? x + 1 : BRANCH_LABEL[x] || x)).join(' → ');
// next HH:MM in India time (or REPORT_TZ_OFFSET_MIN)
export function nextTimeOfDay(hhmm, now = Date.now(), tz = process.env.REPORT_TZ_OFFSET_MIN ? `fixed:${TZ_MIN}` : 'Asia/Kolkata') {
  const [h, m] = hhmm.split(':').map(Number);
  const today = localYmd(tz, now);
  let t = zoned(tz, today, h * 60 + m);
  if (t <= now) t = zoned(tz, addDays(today, 1), h * 60 + m);
  return t;
}
// per-step counters, updated on the stored automation (several runs may finish steps at once)
const bump = (a, s, result) => T.automations.update(a.id, (x) => { x.stepStats ||= {}; const c = (x.stepStats[s.id] ||= {}); c[result] = (c[result] || 0) + 1; });

// the platform's shared email sender protects everyone's deliverability: automated emails have their own daily
// cap per seller (separate from broadcasts, so a big broadcast never holds up a welcome email); the rest waits a day
const AUTO_SHARED_DAILY = Number(process.env.AUTOMATION_SHARED_DAILY || 500);
const sellerMidnight = (u, now = Date.now()) => { const tz = sellerTz(u); return zoned(tz, localYmd(tz, now), 0); };
const autoEmailsToday = (u) => q('SELECT COUNT(*) AS n FROM msgs WHERE userId = ? AND at >= ? AND automationId IS NOT NULL').get(u.id, sellerMidnight(u)).n;
const RETRY_STEPS = new Set(['email', 'notify']), RETRIES = 2;

// a contact's custom fields as message variables: {{f_re_visit}} → 24 Oct 2026, money as ₹45,00,000
function fieldVars(u, m) {
  const out = {};
  for (const d of u?.crmFields || []) {
    const v = m?.custom?.[d.id];
    if (v == null || v === '') continue;
    out[`f_${d.id}`.toLowerCase()] = d.type === 'date' && /^\d{4}-\d{2}-\d{2}/.test(v) ? new Date(`${String(v).slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
      : d.type === 'money' ? `₹${Number(v).toLocaleString('en-IN')}` : d.type === 'checkbox' ? (v ? 'Yes' : 'No') : String(v);
  }
  return out;
}
async function runStep(a, r, s, u) {
  const ctx = { ...r.ctx, ...fieldVars(u, meta(r)) };
  const tl = (type, title, text, extra = {}) => logActivity(r.userId, r.key, { type, title, text, by: 'automation', automation: a.name, ...extra });
  switch (s.type) {
    case 'email': {
      if (!ctx.email) return { result: 'skipped', detail: 'No email address' };
      if (meta(r)?.unsubscribed) return { result: 'skipped', detail: 'Contact unsubscribed' };
      if (meta(r)?.optIn === false) return { result: 'skipped', detail: 'Contact withdrew marketing consent' };
      if (!emailStatus(u).configured) { tl('email', `Email not sent — email isn’t set up (${a.name})`, fill(s.subject, ctx), { status: 'not-configured' }); return { result: 'skipped', detail: 'Email not set up' }; }
      if (emailStatus(u).via !== 'your SMTP' && autoEmailsToday(u) >= AUTO_SHARED_DAILY) return { later: sellerMidnight(u) + 86400000 + 60000 - Date.now(), detail: `Daily limit of ${AUTO_SHARED_DAILY} automated emails reached — sends tomorrow (connect your own SMTP for more)` };
      const subject = fill(s.subject, ctx), text = fill(s.body, ctx);
      const msg = { id: uid(), userId: r.userId, automationId: a.id, stepId: s.id, runId: r.id, key: r.key, subject, at: Date.now(), opens: 0, clicks: 0 };
      const unsub = unsubUrl(ctx.origin, r.userId, r.key);
      await sendEmail(u, { to: ctx.email, subject, text, unsubscribeUrl: unsub, track: { pixel: `${ctx.origin}/t/o/${msg.id}.gif`, link: (url) => (url === unsub ? url : `${ctx.origin}/t/c/${msg.id}?u=${encodeURIComponent(url)}&s=${linkSig(msg.id, url)}`) } });
      T.msgs.insert(msg);
      tl('email', `Email sent: ${subject}`, text, { status: 'sent' });
      return { result: 'sent', detail: subject };
    }
    case 'notify': {
      if (!emailStatus(u).configured) return { result: 'skipped', detail: 'Email not set up' };
      await sendEmail(u, { to: u.email, subject: fill(s.subject, ctx), text: `${fill(s.body, ctx)}\n\nContact: ${ctx.name || '—'} · ${ctx.email || ''} ${ctx.phone || ''}\nAutomation: ${a.name}` });
      return { result: 'sent', detail: `Notified ${u.email}` };
    }
    case 'whatsapp': {
      if (!ctx.phone) return { result: 'skipped', detail: 'No phone number' };
      if (meta(r)?.waOptOut || waOptedOut(r.userId, ctx.phone)) return { result: 'skipped', detail: 'Contact opted out of WhatsApp' };
      if (!whatsappStatus(u).configured) { tl('whatsapp', `WhatsApp not sent — WhatsApp isn’t connected (${a.name})`, s.mode === 'text' ? fill(s.text, ctx) : `Template: ${s.template}`, { status: 'not-configured' }); return { result: 'skipped', detail: 'WhatsApp not connected' }; }
      const msg = s.mode === 'text' ? { text: fill(s.text, ctx) } : { template: s.template, language: s.language, params: s.params ? s.params.split(',').map((p) => fill(p.trim(), ctx)) : [] };
      // one message per run and step: a retried step never sends twice (Hive's Idempotency-Key)
      await sendWhatsApp(u, ctx.phone, { ...msg, key: `auto:${r.id}:${s.id}`, ckey: r.key });
      tl('whatsapp', s.mode === 'text' ? 'WhatsApp sent' : `WhatsApp template sent: ${s.template}`, msg.text || (msg.params.length ? msg.params.join(' · ') : ''), { status: 'sent' });
      return { result: 'sent', detail: s.mode === 'text' ? 'text' : s.template };
    }
    case 'tag': {
      const mm = ensureMeta(r.userId, r.key);
      const had = (mm.tags || []).some((t) => t.toLowerCase() === s.tag.toLowerCase());
      mm.tags = s.action === 'remove' ? (mm.tags || []).filter((t) => t.toLowerCase() !== s.tag.toLowerCase()) : had ? mm.tags : [...(mm.tags || []), s.tag].slice(0, 20);
      T.crm.put(mm);
      if (s.action === 'add' && !had) fire(r.userId, 'tag', { ...ctx, key: r.key, tag: s.tag, funnelId: ctx.funnelId });
      return { result: 'done', detail: `${s.action === 'remove' ? 'Removed' : 'Added'} tag ${s.tag}` };
    }
    case 'stage': {
      const p0 = T.pipelines.get(s.pipelineId);
      const p = p0?.userId === r.userId ? p0 : null;
      const st = p?.stages.find((x) => x.id === s.stageId);
      if (!st) return { result: 'skipped', detail: 'That stage no longer exists' };
      logActivity(r.userId, r.key, { type: 'stage', title: `Moved to ${st.name}`, text: `${p.name} · by automation “${a.name}”` });
      const mm = ensureMeta(r.userId, r.key);
      if (mm.stages?.[p.id] !== st.id) mm.stagesAt = { ...mm.stagesAt, [p.id]: Date.now() };
      mm.stages = { ...mm.stages, [p.id]: st.id };
      T.crm.put(mm);
      return { result: 'done', detail: `Moved to ${st.name}` };
    }
    case 'field': {
      const d = (u.crmFields || []).find((x) => x.id === s.fieldId);
      if (!d) return { result: 'skipped', detail: 'That field no longer exists' };
      // dates: "today" or "+3 days" / "-1 day" from today (seller's calendar); anything else goes through {{variables}}
      let raw = fill(s.value, ctx).trim();
      const rel = /^(today|([+-]\s*\d{1,3})\s*days?)$/i.exec(raw);
      if (d.type === 'date' && rel) raw = addDays(localYmd(sellerTz(u), Date.now()), rel[2] ? Number(rel[2].replace(/\s/g, '')) : 0);
      const mm = ensureMeta(r.userId, r.key);
      const val = raw === '' ? {} : cleanCustom([d], { [d.id]: raw });
      if (raw !== '' && !(d.id in val)) return { result: 'skipped', detail: `“${raw}” isn’t a valid ${d.label}` };
      mm.custom = { ...mm.custom, ...(raw === '' ? { [d.id]: '' } : val) };
      T.crm.put(mm);
      tl('note', `${d.label} set to ${raw === '' ? '(empty)' : raw}`, `by automation “${a.name}”`);
      return { result: 'done', detail: `${d.label} → ${raw || '(empty)'}` };
    }
    case 'access': {
      const P = await import('./products.js'); // loaded when needed: products.js sits further down the import graph
      const prod = T.products.get(s.productId);
      if (!prod || prod.userId !== r.userId) return { result: 'skipped', detail: 'That product no longer exists' };
      if (!ctx.email) return { result: 'skipped', detail: 'No email address' };
      if (s.action === 'revoke') {
        let n = 0;
        for (const x of T.access.all({ userId: r.userId, productId: prod.id })) if (!x.revoked && String(x.email).toLowerCase() === ctx.email.toLowerCase()) { T.access.update(x.id, (y) => { y.revoked = true; y.revokedAt = Date.now(); y.revokeReason = `removed by automation “${a.name}”`; }); n++; }
        tl('note', `Access to ${prod.name} removed`, `by automation “${a.name}”`);
        return { result: 'done', detail: `Removed access to ${prod.name}${n === 0 ? ' (they had none)' : ''}` };
      }
      const acc = P.grant(r.userId, { email: ctx.email, name: ctx.name, phone: ctx.phone, productId: prod.id, via: 'automation' });
      if (s.notify && acc) {
        const lib = P.libraryUrl(ctx.origin, P.libraryToken(r.userId, ctx.email));
        await sendEmail(u, { to: ctx.email, subject: `You now have access to ${prod.name}`, text: `Hi ${ctx.first_name || 'there'},\n\n${ctx.business || u.name} has given you access to ${prod.name}.\n\nOpen it here: ${lib}\n\n— ${ctx.business || u.name}` }).catch(() => null);
      }
      tl('note', `Access to ${prod.name} given`, `by automation “${a.name}”`);
      return { result: 'done', detail: `Gave access to ${prod.name}` };
    }
    case 'enroll': {
      const other = T.automations.get(s.automationId);
      if (!other || other.userId !== r.userId || other.id === a.id) return { result: 'skipped', detail: 'That automation no longer exists' };
      if (!other.active) return { result: 'skipped', detail: `“${other.name}” is paused` };
      const run = start(other, { key: r.key, email: ctx.email, phone: ctx.phone, name: ctx.name });
      return { result: run ? 'done' : 'skipped', detail: run ? `Started “${other.name}”` : `Already in “${other.name}”` };
    }
    case 'note': {
      tl('note', fill(s.text, ctx).slice(0, 200), `by automation “${a.name}”`);
      return { result: 'done', detail: 'Note added' };
    }
    case 'meta': {
      if (!ctx.email && !ctx.phone) return { result: 'skipped', detail: 'No email or phone to match on' };
      const name = s.event === 'custom' ? s.name : s.event;
      const value = Number(fill(s.value, ctx).replace(/[^\d.]/g, '')) || 0;
      // one event per run and step: Meta drops a repeat with the same event_id
      const d = sendCrmEvent(r.userId, { name, value, buyer: { email: ctx.email, phone: ctx.phone, name: ctx.name }, id: `auto_${r.id}_${s.id}` });
      if (!d) return { result: 'skipped', detail: 'Meta isn’t connected (Settings → Apps & ads)' };
      tl('note', `Sent to Meta: ${name}${value ? ` (₹${value})` : ''}`, `by automation “${a.name}”`);
      return { result: 'sent', detail: `${name}${value ? ` · ₹${value}` : ''}` };
    }
    case 'webhook': {
      await checkWebhookUrl(s.url);
      fireWebhook(r.userId, 'automation.step', { automation: a.name, contact: { name: ctx.name, email: ctx.email, phone: ctx.phone }, funnel: ctx.funnel, product: ctx.product }, s.url);
      return { result: 'sent', detail: 'Webhook queued' };
    }
    default: return { result: 'skipped', detail: 'Unknown step' };
  }
}

// A run is claimed before it's advanced (its nextAt moves 10 minutes ahead), so two processes never
// send the same step twice; if a process dies mid-step the claim simply expires and it's retried.
const LEASE = 10 * 60000;
const claim = (id) => q("UPDATE runs SET nextAt = ? WHERE id = ? AND status = 'active' AND nextAt <= ?").run(Date.now() + LEASE, id, Date.now()).changes === 1;
export async function advance(id) {
  if (inFlight.has(id)) return;
  const r = T.runs.get(id);
  if (!r || r.status !== 'active' || r.nextAt > Date.now() || !claim(id)) return;
  inFlight.add(id);
  try {
    const a = T.automations.get(r.automationId);
    const u = userOf(r.userId);
    if (!a || !u) { r.status = 'stopped'; note(r, { result: 'stopped', detail: 'Automation deleted' }); return; }
    if (!a.active) { r.status = 'stopped'; note(r, { result: 'stopped', detail: 'Automation turned off' }); return; }
    // paused while the seller's subscription is inactive; picks up where it left off after they renew
    if (!accessFor(u).ok) { r.nextAt = Date.now() + 3600000; if (r.log.at(-1)?.result !== 'paused') note(r, { result: 'paused', detail: 'Paused — subscription inactive' }); return; }
    if (!r.pos) r.pos = [r.step || 0]; // runs started before branching existed
    r.pos = settle(a.steps, r.pos);
    for (let guard = 0; r.status === 'active' && guard < 500; guard++) {
      const list = listAt(a.steps, r.pos);
      const s = list[r.pos.at(-1)];
      if (!s) break; // reached the end
      // a purchase ends follow-ups meant to get the sale (abandoned-cart reminders, lead nurture…)
      if (a.stopOnPurchase && r.log.length && boughtSince(r)) { r.status = 'stopped'; note(r, { result: 'stopped', detail: 'Contact bought — follow-ups stopped' }); break; }
      const where = posLabel(r.pos);
      if (s.type === 'wait') {
        if (!r.waitUntil) {
          r.waitUntil = s.mode === 'until' ? nextTimeOfDay(s.time, Date.now(), sellerTz(u)) : Date.now() + s.amount * UNITS[s.unit] * SCALE;
          r.nextAt = r.waitUntil;
          note(r, { step: where, type: 'wait', result: 'waiting', detail: s.mode === 'until' ? `until ${s.time}` : `${s.amount} ${s.amount === 1 ? s.unit.replace(/s$/, '') : s.unit}` });
          return;
        }
        if (Date.now() < r.waitUntil) { r.nextAt = r.waitUntil; return; }
        delete r.waitUntil; r.pos = nextPos(a.steps, r.pos); continue;
      }
      if (s.type === 'exit') { note(r, { step: where, type: 'exit', result: 'done', detail: 'Reached an “End automation” step' }); bump(a, s, 'done'); r.pos = [a.steps.length]; break; }
      if (s.type === 'split') {
        const b = Math.random() * 100 < s.percent ? 'a' : 'b';
        r.splits = { ...r.splits, [s.id]: b };
        note(r, { step: where, type: 'split', result: b, detail: `A/B split → ${BRANCH_LABEL[b]}` });
        bump(a, s, b);
        r.pos = settle(a.steps, [...r.pos, b, 0]);
        continue;
      }
      if (s.type === 'condition') {
        const yes = evalCondition(r, s);
        note(r, { step: where, type: 'condition', result: yes ? 'yes' : 'no', detail: yes ? 'Condition met → Yes branch' : 'Condition not met → No branch' });
        bump(a, s, yes ? 'yes' : 'no');
        r.pos = settle(a.steps, [...r.pos, yes ? 'yes' : 'no', 0]);
        continue;
      }
      try {
        const out = await runStep(a, r, s, u);
        // not now: the same step runs again later (e.g. the daily email limit)
        if (out.later) { r.nextAt = Date.now() + out.later; if (r.log.at(-1)?.detail !== out.detail) note(r, { step: where, type: s.type, result: 'waiting', detail: out.detail }); return; }
        if (r.tries?.[s.id]) { const { [s.id]: _, ...rest } = r.tries; r.tries = rest; }
        note(r, { step: where, type: s.type, ...out });
        bump(a, s, out.result);
      } catch (e) {
        // a mail server hiccup: try this step again in 10, then 20 minutes before giving up on it
        const tries = (r.tries?.[s.id] || 0) + 1;
        if (RETRY_STEPS.has(s.type) && tries <= RETRIES) { r.tries = { ...r.tries, [s.id]: tries }; r.nextAt = Date.now() + tries * 10 * 60000; note(r, { step: where, type: s.type, result: 'retrying', detail: `${e.message} — trying again in ${tries * 10} minutes` }); return; }
        if (r.tries?.[s.id]) { const { [s.id]: _, ...rest } = r.tries; r.tries = rest; }
        note(r, { step: where, type: s.type, result: 'failed', detail: e.message });
        bump(a, s, 'failed');
        logActivity(r.userId, r.key, { type: s.type === 'whatsapp' ? 'whatsapp' : 'email', title: `${s.type === 'whatsapp' ? 'WhatsApp' : 'Email'} failed (${a.name})`, text: e.message, by: 'automation', status: 'failed' });
      }
      r.pos = nextPos(a.steps, r.pos);
    }
    if (r.status === 'active' && !listAt(a.steps, r.pos)[r.pos.at(-1)]) { r.status = 'done'; r.doneAt = Date.now(); T.automations.update(a.id, (x) => { x.stats = { ...x.stats, completed: (x.stats?.completed || 0) + 1 }; }); }
  } finally {
    // stopped elsewhere while a message was being sent (the contact bought, or the seller stopped it)? keep that
    const cur = T.runs.get(id);
    if (cur && cur.status !== 'active' && r.status === 'active') { r.status = cur.status; r.log = [...r.log, ...cur.log.filter((x) => !r.log.some((y) => y.at === x.at && y.detail === x.detail))].slice(-LOG_MAX); }
    if (cur) T.runs.put(r);
    inFlight.delete(id);
  }
}

// Abandoned checkouts become a trigger once they've waited long enough without a purchase
// Carts become eligible once they've waited `delay`; each scan looks at the last 2 days of eligible carts
const ABANDON_WINDOW = 2 * 86400000;
function scanAbandoned() {
  const now = Date.now();
  for (const a of T.automations.all({ triggerType: 'abandoned', active: 1 })) {
    const delay = (a.trigger.delayMin || 30) * 60000 * SCALE;
    const since = Math.max(a.activatedAt || a.createdAt || 0, now - delay - ABANDON_WINDOW);
    for (const c of T.abandoned.all({ userId: a.userId, recovered: 0, demo: 0, at: { gte: since, lte: now - delay } })) {
      if (a.trigger.funnelId && a.trigger.funnelId !== c.funnelId) continue;
      if ((c.auto || []).includes(a.id)) continue;
      const f = T.funnels.get(c.funnelId);
      if (!f || f.userId !== a.userId) continue;
      c.auto = [...(c.auto || []), a.id];
      T.abandoned.put(c);
      const chk = f.steps.find((s) => s.type === 'checkout')?.blocks.find((b) => b.type === 'checkout')?.props;
      start(a, { email: c.email, name: c.name, phone: c.phone, funnelId: f.id, product: chk?.productName, amount: chk?.price });
    }
  }
}
// contact details for a key, from the CRM record or their latest sign-up / order
function contactInfo(userId, key) {
  const m = metaFor(userId, key);
  const last = [T.orders.find({ userId, ckey: key }, { order: 'at', desc: true }), T.leads.find({ userId, ckey: key }, { order: 'at', desc: true })].filter(Boolean).sort((x, y) => y.at - x.at)[0];
  if (!m && !last) return null;
  return { key, email: m?.email || last?.email || (key.startsWith('phone:') ? '' : key), phone: m?.phone || last?.phone || (key.startsWith('phone:') ? key.slice(6) : ''), name: m?.name || last?.name || '', funnelId: last?.funnelId, source: last?.source };
}
// "A date arrives": birthday / renewal / course start stored in a date custom field (India time)
export function scanDates(now = Date.now()) {
  for (const a of T.automations.all({ triggerType: 'date', active: 1 })) {
    // dates fire on the seller's own calendar day and clock
    const tz = sellerTz(userOf(a.userId)), today = localYmd(tz, now);
    if (!a.trigger.fieldId || !/^[\w-]{1,20}$/.test(a.trigger.fieldId)) continue;
    const t = a.trigger;
    // only contacts that have this date filled in (filtered inside SQLite)
    const rows = q("SELECT data FROM crm WHERE userId = ? AND json_extract(data, '$.custom.' || ?) IS NOT NULL").all(a.userId, t.fieldId);
    for (const row of rows) {
      const m = JSON.parse(row.data);
      const v = m.custom?.[t.fieldId];
      if (!v || !/^\d{4}-\d{2}-\d{2}/.test(v)) continue;
      // the day it should fire: the date (this year's, for yearly ones) shifted by the offset
      // yearly with an offset can cross New Year (“3 days before 2 Jan” fires on 30 Dec): try last, this and next year's date
      const y = Number(today.slice(0, 4)), date = String(v).slice(0, 10);
      const leap = (d) => (!Number.isFinite(Date.parse(`${d}T00:00:00Z`)) && d.slice(5) === '02-29' ? `${d.slice(0, 4)}-02-28` : d); // leap-day birthdays → 28 Feb
      const base = (t.yearly ? [y - 1, y, y + 1].map((yr) => leap(`${yr}${date.slice(4)}`)) : [leap(date)])
        .find((d) => Number.isFinite(Date.parse(`${d}T00:00:00Z`)) && addDays(d, t.offsetDays) === today);
      if (!base) continue;
      const [h, mi] = t.time.split(':').map(Number);
      const at = zoned(tz, today, h * 60 + mi);
      if (now < at) continue;
      const mark = t.yearly ? base.slice(0, 4) : 'once'; // the occasion's year: one send per birthday
      m.dateFired ||= {};
      if (m.dateFired[a.id] === mark) continue;
      m.dateFired[a.id] = mark;
      T.crm.update(m.id, (x) => { x.dateFired = { ...x.dateFired, [a.id]: mark }; });
      const info = contactInfo(a.userId, m.key);
      if (info) start(a, info);
    }
  }
}
// "Stuck in a stage": contacts that entered the stage (stagesAt, recorded since this feature) N days ago and
// are still there — once per time they entered it
export function scanStuck(now = Date.now()) {
  for (const a of T.automations.all({ triggerType: 'stuck', active: 1 })) {
    const t = a.trigger;
    if (!/^[\w-]{1,20}$/.test(t.pipelineId || '') || !t.stageId) continue;
    const rows = q("SELECT data FROM crm WHERE userId = ? AND json_extract(data, '$.stages.' || ?) = ? AND json_extract(data, '$.stagesAt.' || ?) <= ?").all(a.userId, t.pipelineId, t.stageId, t.pipelineId, now - t.days * 86400000 * SCALE);
    for (const row of rows) {
      const m = JSON.parse(row.data);
      const since = m.stagesAt[t.pipelineId];
      if (m.stuckFired?.[a.id] === since) continue;
      T.crm.update(m.id, (x) => { x.stuckFired = { ...x.stuckFired, [a.id]: since }; });
      const info = contactInfo(a.userId, m.key);
      if (info) start(a, { ...info, pipelineId: t.pipelineId, stageId: t.stageId });
    }
  }
}
// at most this many runs are started per tick, so a burst can't monopolise the server
const BATCH = Number(process.env.AUTOMATION_BATCH || 500);
let lastPrune = 0, lastDates = 0;
export function tick() {
  const now = Date.now();
  scanAbandoned();
  if (now - lastDates > Math.min(60000, TICK * 4) || SCALE < 1) { lastDates = now; scanDates(); scanStuck(now); }
  for (const r of q(`SELECT id FROM runs WHERE status = 'active' AND nextAt <= ? ORDER BY nextAt LIMIT ${BATCH}`).all(now)) advance(r.id);
  // keep finished runs for 60 days, email tracking records for 90 (pruned hourly)
  if (now - lastPrune > 3600000) {
    lastPrune = now;
    q('DELETE FROM msgs WHERE at < ?').run(now - 90 * 86400000);
    q("DELETE FROM runs WHERE status != 'active' AND COALESCE(doneAt, at) < ?").run(now - 60 * 86400000);
  }
}

// ---------- API ----------
const view = (a) => { const { userId, ...x } = a; return { ...x, running: T.runs.count({ automationId: a.id, status: 'active' }) }; };
// A/B results: how many went each way, and how many of them bought afterwards
function splitResults(a) {
  const out = {};
  const splits = allSteps(a.steps).filter((s) => s.type === 'split');
  if (!splits.length) return out;
  const runs = T.runs.all({ automationId: a.id }).filter((r) => r.splits);
  for (const s of splits) {
    const res = { a: { n: 0, bought: 0 }, b: { n: 0, bought: 0 } };
    for (const r of runs) {
      const b = r.splits[s.id];
      if (!b) continue;
      res[b].n++;
      if (r.ctx.email && ordersOf(r).some((o) => o.at > r.at)) res[b].bought++;
    }
    out[s.id] = res;
  }
  return out;
}
// opens / clicks per email step (unique per email sent)
function emailResults(a) {
  const out = {};
  for (const r of q(`SELECT json_extract(data, '$.stepId') AS stepId, COUNT(*) AS sent, SUM(json_extract(data, '$.opens') > 0) AS opened, SUM(json_extract(data, '$.clicks') > 0) AS clicked FROM msgs WHERE automationId = ? GROUP BY stepId`).all(a.id)) {
    out[r.stepId] = { sent: r.sent, opened: r.opened || 0, clicked: r.clicked || 0 };
  }
  return out;
}
// ---- version history: a snapshot before each burst of edits (and before every restore) ----
const VERSION_GAP = 2 * 60000, VERSIONS_KEPT = 30;
function snapshot(a, note) {
  const last = T.autoversions.find({ automationId: a.id }, { order: 'at', desc: true });
  const same = last && JSON.stringify([last.name, last.trigger, last.steps]) === JSON.stringify([a.name, a.trigger, a.steps]);
  if (same || (!note && last && Date.now() - last.at < VERSION_GAP && last.auto)) return;
  T.autoversions.insert({ id: uid(), automationId: a.id, userId: a.userId, at: Date.now(), auto: !note, note: note || '', name: a.name, trigger: a.trigger, steps: structuredClone(a.steps), stopOnPurchase: a.stopOnPurchase, allowRepeat: a.allowRepeat });
  q(`DELETE FROM autoversions WHERE id IN (SELECT id FROM autoversions WHERE automationId = ? ORDER BY at DESC LIMIT -1 OFFSET ${VERSIONS_KEPT})`).run(a.id);
}
// ---------- "Build with Hive AI": an automation designed from a sentence, with this seller's own ids ----------
const AI_SPEC = `You design marketing / CRM automations for a small Indian business. Reply with ONLY JSON:
{"name": "short name", "trigger": {...}, "steps": [...], "stopOnPurchase": true|false}
trigger.type is one of: ${Object.keys(TRIGGERS).join(', ')}.
  Extra trigger fields: funnelId (lead/quiz/purchase/offer/abandoned, optional) · delayMin (abandoned) · pipelineId + stageId (stage) · pipelineId + stageId + days (stuck) · tag (tag) · outcome (quiz: a result title, optional) · fieldId + value (field; value optional) · fieldId + offsetDays (negative = before) + time "HH:MM" + yearly (date) · productId (student_joined / quiz_passed / course_completed, optional).
steps run top to bottom; each is one of:
  {"type":"wait","amount":2,"unit":"minutes|hours|days"} · {"type":"wait","mode":"until","time":"10:00"}
  {"type":"email","subject":"…","body":"…"} · {"type":"notify","subject":"…","body":"…"} (an alert to the business owner)
  {"type":"whatsapp","mode":"text","text":"…"} (only reaches people who messaged in the last 24 h — prefer email for cold follow-ups)
  {"type":"tag","tag":"…","action":"add|remove"} · {"type":"stage","pipelineId":"…","stageId":"…"} · {"type":"field","fieldId":"…","value":"… (dates: today / +3 days)"}
  {"type":"note","text":"…"} · {"type":"meta","event":"QualifiedLead|Lead|Schedule|Contact|SubmitApplication|CompleteRegistration|Purchase|custom","name":"(custom only)","value":"(optional ₹ or {{amount}})"} — tells Meta ads this contact qualified/bought · {"type":"access","productId":"…","action":"grant|revoke","notify":true} · {"type":"enroll","automationId":"…"}
  {"type":"webhook","url":"https://…"} · {"type":"exit"}
  {"type":"condition","match":"all|any","rules":[{"field":"tag|stage|custom|bought|has|source|amount","op":"is|not|equals|contains|gt|lt|filled|empty","value":"…","fieldId":"…","pipelineId":"…","stageId":"…"}],"yes":[steps],"no":[steps]}
  {"type":"split","percent":50,"a":[steps],"b":[steps]}
Message variables: ${VARIABLES.map((v) => `{{${v}}}`).join(' ')} and contact fields as {{f_<field id>}}.
Rules: use ONLY ids from the business context below; warm, short, Indian-English messages signed {{business}}; waits at sensible hours ("until 10:00" before WhatsApp); never invent prices or links; 2–8 steps unless asked for more.`;
function aiContext(userId) {
  const u = userOf(userId);
  return JSON.stringify({
    pipelines: pipelinesFor(userId).map((p) => ({ id: p.id, name: p.name, stages: p.stages.map((s) => ({ id: s.id, name: s.name })) })),
    fields: (u?.crmFields || []).map((f) => ({ id: f.id, label: f.label, type: f.type, ...(f.options ? { options: f.options } : {}) })),
    products: T.products.all({ userId }).slice(0, 60).map((p) => ({ id: p.id, name: p.name, course: (p.lessons || []).length > 0 })),
    funnels: T.funnels.all({ userId }).slice(0, 60).map((f) => ({ id: f.id, name: f.name })),
    automations: T.automations.all({ userId }).map((a) => ({ id: a.id, name: a.name })),
    business: u?.settings?.businessName || u?.name || '',
  });
}

export function registerAutomations(app, { auth, secret, appUrl, rateLimit, isTest, credits = () => (req, res, next) => next() }) {
  SECRET = secret;
  const own = (req, res) => { const a = T.automations.get(req.params.aid); if (!a || a.userId !== req.user.id) { res.status(404).json({ error: 'Automation not found' }); return null; } return a; };
  const build = (req, cur = {}) => {
    const b = req.body || {};
    stepBudget = MAX_STEPS;
    const steps = cleanSteps(Array.isArray(b.steps) ? b.steps : cur.steps || []);
    const trigger = cleanTrigger(b.trigger ?? cur.trigger, req.user.id);
    return {
      hookToken: cur.hookToken || (trigger.type === 'inbound' ? crypto.randomBytes(16).toString('hex') : undefined),
      name: str(b.name ?? cur.name, 80).trim() || 'Untitled automation',
      trigger: cleanTrigger(b.trigger ?? cur.trigger, req.user.id),
      steps,
      // follow-ups that chase a sale stop once the contact buys; after-purchase sequences keep going
      stopOnPurchase: 'stopOnPurchase' in b ? !!b.stopOnPurchase : cur.stopOnPurchase ?? !['purchase', 'offer'].includes(cleanTrigger(b.trigger ?? cur.trigger, req.user.id).type),
      allowRepeat: 'allowRepeat' in b ? !!b.allowRepeat : !!cur.allowRepeat,
    };
  };

  app.get('/api/automations', auth, (req, res) => res.json({
    automations: T.automations.all({ userId: req.user.id }).sort((x, y) => (x.createdAt || 0) - (y.createdAt || 0)).map(view),
    triggers: TRIGGERS, variables: VARIABLES, ruleFields: RULE_FIELDS,
    channels: { email: emailStatus(req.user).configured, whatsapp: whatsappStatus(req.user).configured, meta: metaReady(req.user) },
  }));
  app.get('/api/automations/:aid', auth, (req, res) => {
    const a = own(req, res);
    if (!a) return;
    const runs = T.runs.all({ automationId: a.id }, { order: 'at', desc: true, limit: 50 }).map((r) => ({ id: r.id, key: r.key, name: r.ctx.name, email: r.ctx.email, phone: r.ctx.phone, status: r.status, pos: r.pos, nextAt: r.nextAt, at: r.at, log: r.log.slice(-6) }));
    res.json({ ...view(a), runs, check: problems(a, req.user), hookUrl: a.hookToken ? `${appUrl(req)}/api/hooks/automation/${a.hookToken}` : null, splitResults: splitResults(a), emailResults: emailResults(a) });
  });
  app.post('/api/ai/automation', auth, rateLimit({ windowMs: 60000, max: isTest ? 100 : 6, key: (req) => req.user.id }), credits('edit'), async (req, res) => {
    const { aiEnabled, aiJson } = await import('./ai.js'); // loaded when used: ai.js sits elsewhere in the import graph
    if (!aiEnabled()) return res.status(503).json({ error: 'Hive AI isn’t switched on yet' });
    const d = str(req.body?.description, 1500).trim();
    if (d.length < 10) return res.status(400).json({ error: 'Describe what should happen in a sentence or two' });
    if (T.automations.count({ userId: req.user.id }) >= MAX_PER_USER) return res.status(400).json({ error: `You can have up to ${MAX_PER_USER} automations` });
    let out;
    try { out = await aiJson(AI_SPEC, `Business context: ${aiContext(req.user.id)}\n\nWhat they want: ${d}`); } catch { return res.status(502).json({ error: 'Hive AI couldn’t build it just now — please try again' }); }
    if (!out || typeof out !== 'object' || !Array.isArray(out.steps) || !out.steps.length) return res.status(502).json({ error: 'Hive AI couldn’t build it — try describing it a little differently' });
    // cleaned exactly like an automation saved in the builder; created paused so the seller reviews it first
    const a = T.automations.insert({ id: uid(), userId: req.user.id, ...build({ body: out, user: req.user }), active: false, stats: { started: 0, completed: 0 }, createdAt: Date.now(), origin: appUrl(req), madeBy: 'ai' });
    res.json({ ...view(a), check: problems(a, req.user) });
  });
  app.post('/api/automations', auth, (req, res) => {
    if (T.automations.count({ userId: req.user.id }) >= MAX_PER_USER) return res.status(400).json({ error: `You can have up to ${MAX_PER_USER} automations` });
    const a = T.automations.insert({ id: uid(), userId: req.user.id, ...build(req), active: false, stats: { started: 0, completed: 0 }, createdAt: Date.now(), origin: appUrl(req) });
    res.json(view(a));
  });
  app.put('/api/automations/:aid', auth, (req, res) => {
    const a = own(req, res);
    if (!a) return;
    const next = build(req, a);
    if (JSON.stringify([next.name, next.trigger, next.steps]) !== JSON.stringify([a.name, a.trigger, a.steps])) snapshot(a);
    Object.assign(a, next, { origin: appUrl(req), updatedAt: Date.now() });
    if ('active' in req.body) {
      const on = !!req.body.active;
      if (on) { const { errors } = problems(a, req.user); if (errors.length) { T.automations.put(a); return res.status(400).json({ error: errors[0], errors }); } }
      if (on && !a.active) a.activatedAt = Date.now();
      a.active = on;
    } else if (a.active) {
      const { errors } = problems(a, req.user);
      if (errors.length) { a.active = false; }
    }
    T.automations.put(a);
    res.json({ ...view(a), check: problems(a, req.user) });
  });
  app.get('/api/automations/:aid/versions', auth, (req, res) => {
    const a = own(req, res);
    if (!a) return;
    res.json(T.autoversions.all({ automationId: a.id }, { order: 'at', desc: true }).map((v) => ({ id: v.id, at: v.at, note: v.note, name: v.name, trigger: v.trigger.type, steps: allSteps(v.steps).length })));
  });
  app.post('/api/automations/:aid/versions/:vid/restore', auth, (req, res) => {
    const a = own(req, res);
    if (!a) return;
    const v = T.autoversions.get(req.params.vid);
    if (!v || v.automationId !== a.id) return res.status(404).json({ error: 'Version not found' });
    snapshot(a, 'Before restoring an earlier version');
    Object.assign(a, { name: v.name, trigger: v.trigger, steps: JSON.parse(JSON.stringify(v.steps)), stopOnPurchase: v.stopOnPurchase, allowRepeat: v.allowRepeat, updatedAt: Date.now() });
    let paused = false;
    if (a.active && problems(a, req.user).errors.length) { a.active = false; paused = true; }
    T.automations.put(a);
    res.json({ ...view(a), paused, check: problems(a, req.user) });
  });
  // many contacts at once (from the contacts list)
  app.post('/api/automations/:aid/enroll-bulk', auth, (req, res) => {
    const a = own(req, res);
    if (!a) return;
    if (!a.active) return res.status(400).json({ error: 'Turn the automation on first' });
    const keys = [...new Set((Array.isArray(req.body.keys) ? req.body.keys : []).map(String))].slice(0, 2000);
    let added = 0, skipped = 0;
    for (const key of keys) {
      const info = contactInfo(req.user.id, key);
      if (info && start(a, { ...info, funnelId: a.trigger.funnelId || info.funnelId })) added++; else skipped++;
    }
    res.json({ added, skipped });
  });
  app.delete('/api/automations/:aid', auth, (req, res) => {
    const a = own(req, res);
    if (!a) return;
    tx(() => {
      T.automations.del(a.id);
      T.autoversions.delWhere({ automationId: a.id });
      for (const r of T.runs.all({ automationId: a.id, status: 'active' })) { r.status = 'stopped'; note(r, { result: 'stopped', detail: 'Automation deleted' }); T.runs.put(r); }
    });
    res.json({ ok: true });
  });
  // run it now for one contact (manual enrolment / testing)
  app.post('/api/automations/:aid/enroll', auth, (req, res) => {
    const a = own(req, res);
    if (!a) return;
    if (!a.active) return res.status(400).json({ error: 'Turn the automation on first' });
    // by contact key, or (integrations) by email / phone — a new contact is added
    const email = String(req.body.email || '').trim().toLowerCase().slice(0, 200), phone = String(req.body.phone || '').trim().slice(0, 40);
    const key = String(req.body.key || contactKey(email, phone) || '');
    if (!req.body.key && email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Invalid email' });
    let c = key ? metaFor(req.user.id, key) : null;
    const lead = key ? [T.leads.find({ userId: req.user.id, ckey: key }, { order: 'at', desc: true }), T.orders.find({ userId: req.user.id, ckey: key }, { order: 'at', desc: true })].filter(Boolean).sort((x, y) => y.at - x.at)[0] : null;
    if (!c && !lead && !req.body.key && key) { c = ensureMeta(req.user.id, key); Object.assign(c, { manual: true, email, phone, name: String(req.body.name || '').slice(0, 120), at: Date.now() }); T.crm.put(c); }
    if (!c && !lead) return res.status(404).json({ error: 'Contact not found' });
    const r = start(a, { key, email: c?.email || lead?.email || (key.startsWith('phone:') ? '' : key), phone: c?.phone || lead?.phone || (key.startsWith('phone:') ? key.slice(6) : ''), name: c?.name || lead?.name || '', funnelId: a.trigger.funnelId || lead?.funnelId });
    if (!r) return res.status(409).json({ error: 'This contact is already in this automation' });
    res.json({ ok: true, run: r.id });
  });
  // try one message step on yourself, with sample data
  const testLimiter = rateLimit({ windowMs: 60000, max: isTest ? 1000 : 10, key: (req) => req.user.id, message: 'Too many test messages — please wait a minute.' });
  app.post('/api/automations/:aid/test', auth, testLimiter, async (req, res) => {
    const a = own(req, res);
    if (!a) return;
    stepBudget = MAX_STEPS;
    const draft = req.body.step ? cleanStep(req.body.step) : findStep(a.steps, req.body.stepId);
    if (!draft || !['email', 'notify', 'whatsapp'].includes(draft.type)) return res.status(400).json({ error: 'Only email and WhatsApp steps can be tested' });
    const u = req.user;
    const f = (a.trigger.funnelId && T.funnels.get(a.trigger.funnelId)) || T.funnels.find({ userId: u.id });
    const ctx = contextFor(u.id, { name: u.name || 'Test Contact', email: u.email, phone: String(req.body.to || ''), funnelId: f?.id, product: f?.steps.find((s) => s.type === 'checkout')?.blocks.find((b) => b.type === 'checkout')?.props.productName || 'Sample product', amount: 499 });
    try {
      if (draft.type === 'whatsapp') {
        if (!req.body.to) return res.status(400).json({ error: 'Enter your WhatsApp number for the test' });
        const msg = draft.mode === 'text' ? { text: fill(draft.text, ctx) } : { template: draft.template, language: draft.language, params: draft.params ? draft.params.split(',').map((x) => fill(x.trim(), ctx)) : [] };
        const r = await sendWhatsApp(u, req.body.to, msg);
        if (r.status !== 'sent') return res.status(400).json({ error: 'WhatsApp isn’t connected yet — add it in Settings' });
        return res.json({ ok: true, to: req.body.to });
      }
      const r = await sendEmail(u, { to: u.email, subject: `[Test] ${fill(draft.subject, ctx)}`, text: fill(draft.body, ctx) });
      if (r.status !== 'sent') return res.status(400).json({ error: 'Email sending isn’t set up yet — add SMTP details in Settings' });
      res.json({ ok: true, to: u.email });
    } catch (e) { res.status(400).json({ error: e.message }); }
  });

  // "A webhook is received" trigger: Zapier / Pabbly / Make / Google Forms post a contact here
  const hookLimiter = rateLimit({ windowMs: 60000, max: isTest ? 1000 : 120, key: (req) => req.params.token });
  app.post('/api/hooks/automation/:token', hookLimiter, (req, res) => {
    const a = T.automations.find({ hookToken: String(req.params.token), triggerType: 'inbound' });
    if (!a) return res.status(404).json({ error: 'Unknown webhook' });
    if (!a.active) return res.status(409).json({ error: 'This automation is turned off' });
    const b = req.body || {};
    const email = str(b.email, 200).trim().toLowerCase(), phone = str(b.phone || b.mobile || b.whatsapp, 40).trim(), name = str(b.name || [b.first_name, b.last_name].filter(Boolean).join(' '), 120).trim();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Invalid email' });
    if (!email && !phone) return res.status(400).json({ error: 'Send an email or phone' });
    const key = contactKey(email, phone);
    const m = ensureMeta(a.userId, key);
    if (!T.leads.exists({ userId: a.userId, ckey: key }) && !T.orders.exists({ userId: a.userId, ckey: key })) Object.assign(m, { manual: true, name: m.name || name, email: m.email || email, phone: m.phone || phone });
    if (Array.isArray(b.tags)) m.tags = [...new Set([...(m.tags || []), ...b.tags.map((t) => str(t, 30).trim()).filter(Boolean)])].slice(0, 20);
    T.crm.put(m);
    logActivity(a.userId, key, { type: 'note', title: `Received by webhook (${a.name})`, text: Object.entries(b).filter(([k2]) => !['tags'].includes(k2)).slice(0, 20).map(([k2, v]) => `${k2}: ${String(v).slice(0, 200)}`).join('\n') });
    const r = start(a, { key, email, phone, name, source: str(b.source, 40) || 'webhook', funnelId: a.trigger.funnelId });
    res.json({ ok: true, started: !!r });
  });

  app.post('/api/automations/runs/:rid/stop', auth, (req, res) => {
    const r = T.runs.get(req.params.rid);
    if (!r || r.userId !== req.user.id) return res.status(404).json({ error: 'Not found' });
    if (r.status === 'active') { r.status = 'stopped'; note(r, { result: 'stopped', detail: 'Stopped by you' }); T.runs.put(r); }
    res.json({ ok: true });
  });

  // ---- email open & click tracking ----
  const GIF = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
  const first = (msg, kind) => {
    if (msg.broadcastId) return broadcastSeen(msg, kind);
    const a = T.automations.get(msg.automationId);
    if (kind === 'open') logActivity(msg.userId, msg.key, { type: 'email', title: `Opened email: ${msg.subject}`, by: 'automation', automation: a?.name, status: 'opened' });
    else logActivity(msg.userId, msg.key, { type: 'email', title: `Clicked a link in: ${msg.subject}`, text: msg.lastUrl, by: 'automation', automation: a?.name, status: 'clicked' });
  };
  app.get('/t/o/:mid.gif', (req, res) => {
    const m = T.msgs.get(req.params.mid);
    if (m) { m.opens++; if (m.opens === 1) { m.openedAt = Date.now(); first(m, 'open'); } T.msgs.put(m); }
    res.set({ 'Content-Type': 'image/gif', 'Cache-Control': 'no-store, max-age=0' }).send(GIF);
  });
  app.get('/t/c/:mid', (req, res) => {
    const url = String(req.query.u || '');
    const m = T.msgs.get(req.params.mid);
    const ok = m && /^https?:\/\//i.test(url) && String(req.query.s || '').length === 16 && crypto.timingSafeEqual(Buffer.from(String(req.query.s)), Buffer.from(linkSig(m.id, url)));
    if (!ok) return res.status(400).type('html').send('<p style="font:16px system-ui;padding:40px;text-align:center">This link isn’t valid.</p>');
    m.clicks++; m.lastUrl = url;
    if (!m.opens) { m.opens = 1; m.openedAt = Date.now(); if (m.broadcastId) first(m, 'open'); } // a click proves the email was opened (images may be blocked)
    if (m.clicks === 1) { m.clickedAt = Date.now(); first(m, 'click'); }
    T.msgs.put(m);
    res.redirect(302, url);
  });

  // one-click unsubscribe (link in every automated email)
  const unsub = (req, res) => {
    const { uid: userId, key, sig: s } = req.params;
    const ok = s && s.length === 24 && crypto.timingSafeEqual(Buffer.from(s), Buffer.from(sig(userId, key)));
    if (!ok) return res.status(400).type('html').send('<p style="font:16px system-ui;padding:40px;text-align:center">This unsubscribe link isn’t valid.</p>');
    const m = T.users.get(userId) ? ensureMeta(userId, key) : null;
    if (m && !m.unsubscribed) { m.unsubscribed = true; m.activities.push({ id: uid(), at: Date.now(), type: 'note', title: 'Unsubscribed from emails', text: 'Clicked the unsubscribe link' }); T.crm.put(m); }
    const biz = userOf(userId)?.settings?.businessName;
    res.type('html').send(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Unsubscribed</title><div style="font:16px/1.6 system-ui;max-width:420px;margin:12vh auto;padding:24px;text-align:center"><h1 style="font-size:22px">You’re unsubscribed ✅</h1><p>You won’t receive marketing emails${biz ? ` from ${biz.replace(/[<>&]/g, '')}` : ''} any more.</p></div>`);
  };
  app.get('/u/:uid/:key/:sig', unsub);
  app.post('/u/:uid/:key/:sig', unsub); // RFC 8058 one-click

  originFallback = () => process.env.APP_URL || 'http://localhost:4000';
  if (JOBS) setInterval(tick, TICK).unref();
}
