// CRM: contacts (built from leads + orders, plus anything the seller adds), pipelines with stages,
// custom contact fields and a per-contact timeline of visits, sign-ups, purchases and messages.
import { T, q, tx, uid, contactKey } from './db.js';
import { sendEmail, emailStatus, sendWhatsApp, whatsappStatus } from './messaging.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SESSION_GAP = 30 * 60000; // page views more than 30 min apart count as a new visit
export const FIELD_TYPES = ['text', 'longtext', 'number', 'date', 'select', 'url', 'checkbox'];
const COLORS = ['#6366f1', '#0ea5e9', '#f59e0b', '#16a34a', '#94a3b8', '#ec4899', '#8b5cf6', '#ef4444', '#14b8a6'];
const DEFAULT_STAGES = [['New lead', '#6366f1'], ['Contacted', '#0ea5e9'], ['Interested', '#f59e0b'], ['Customer', '#16a34a', 'won'], ['Lost', '#94a3b8', 'lost']];

export { contactKey };
const str = (v, n) => String(v ?? '').trim().slice(0, n);
export const metaFor = (userId, key) => T.crm.find({ userId, key });
// The seller's record for a contact (tags, stages, custom fields, activity), created on first use.
// Change it and save with T.crm.put(m) — with no `await` in between.
export function ensureMeta(userId, key) {
  let m = metaFor(userId, key);
  if (!m) {
    // another process may create it at the same moment: then use theirs
    try { m = T.crm.insert({ id: uid(), userId, key, stages: {}, custom: {}, tags: [], activities: [], at: Date.now() }); } catch (e) { m = metaFor(userId, key); if (!m) throw e; }
  }
  m.activities ||= [];
  return m;
}

// Anything that messages a contact (manual emails, automations) records it here
export function logActivity(userId, key, act) {
  if (!key || !act) return null;
  const a = { id: uid(), at: Date.now(), ...act };
  T.crm.update(ensureMeta(userId, key).id, (m) => {
    m.activities = [...(m.activities || []), a].slice(-500);
  });
  return a;
}

// ---------- pipelines ----------
export function pipelinesFor(userId) {
  const list = T.pipelines.all({ userId }, { order: 'at' });
  if (list.length) return list;
  return [T.pipelines.insert({ id: uid(), userId, name: 'Sales pipeline', stages: DEFAULT_STAGES.map(([name, color, flag]) => ({ id: uid(), name, color, ...(flag ? { [flag]: true } : {}) })), at: Date.now() })];
}
// Contacts nobody has placed yet: customers go to the "won" stage, everyone else to the first one
export const stageFor = (p, meta, isCustomer) => {
  const set = meta?.stages?.[p.id];
  if (set && p.stages.some((s) => s.id === set)) return set;
  return (isCustomer && p.stages.find((s) => s.won)?.id) || p.stages[0]?.id;
};

// ---------- contacts ----------
// All of a seller's contacts — or just one (onlyKey) — from their sign-ups, orders and CRM records
// live funnels by id; a deleted funnel's leads and orders carry its name (funnelName) — see deleteFunnel
const funnelNames = (userId) => {
  const m = Object.fromEntries(q("SELECT id, json_extract(data, '$.name') AS name FROM funnels WHERE userId = ?").all(userId).map((r) => [r.id, r.name]));
  for (const r of q("SELECT DISTINCT funnelId, json_extract(data, '$.funnelName') AS name FROM orders WHERE userId = ? AND json_extract(data, '$.funnelName') IS NOT NULL UNION SELECT DISTINCT funnelId, json_extract(data, '$.funnelName') FROM leads WHERE userId = ? AND json_extract(data, '$.funnelName') IS NOT NULL").all(userId, userId)) m[r.funnelId] ||= `${r.name} (deleted)`;
  return m;
};
function buildContacts(userId, onlyKey) {
  const name = funnelNames(userId);
  const where = onlyKey ? { userId, ckey: onlyKey } : { userId };
  const m = {};
  const get = (key) => (m[key] ||= { key, email: key.startsWith('phone:') ? '' : key, name: '', phone: '', type: 'lead', orders: 0, ltv: 0, funnels: new Set(), fids: new Set(), source: 'direct', firstSeen: Infinity, lastSeen: 0, refs: { leads: [], orders: [], abandoned: [] } });
  const touch = (c, x) => { c.firstSeen = Math.min(c.firstSeen, x.at); c.lastSeen = Math.max(c.lastSeen, x.at); c.funnels.add(name[x.funnelId]); c.fids.add(x.funnelId); c.name ||= x.name || ''; c.phone ||= x.phone || ''; if (x.source) c.source = x.source; };
  for (const l of T.leads.iter(where, { order: 'at' })) if (name[l.funnelId] && (l.email || l.phone)) { const c = get(contactKey(l.email, l.phone)); touch(c, l); c.refs.leads.push(l); if (l.fields) c.fields = { ...(c.fields || {}), ...l.fields }; }
  for (const o of T.orders.iter(where, { order: 'at' })) if (name[o.funnelId] && o.email) { const c = get(contactKey(o.email)); touch(c, o); c.type = 'customer'; c.orders++; c.ltv += o.total; c.refs.orders.push(o); }
  for (const a of T.abandoned.iter(where, { order: 'at' })) if (name[a.funnelId] && a.email && m[contactKey(a.email)]) m[contactKey(a.email)].refs.abandoned.push(a);
  // the seller's own additions and edits
  for (const meta of onlyKey ? [metaFor(userId, onlyKey)].filter(Boolean) : T.crm.iter({ userId })) {
    if (!m[meta.key] && !meta.manual) continue;
    meta.activities ||= [];
    const c = m[meta.key] || get(meta.key);
    if (meta.manual && c.firstSeen === Infinity) { c.firstSeen = meta.at; c.lastSeen = meta.at; c.source = 'added by you'; }
    for (const k of ['name', 'phone', 'email']) if (meta[k]) c[k] = meta[k];
    c.meta = meta;
    const lastAct = meta.activities.at(-1)?.at;
    if (lastAct) c.lastSeen = Math.max(c.lastSeen, lastAct);
  }
  return { contacts: m, funnelName: name };
}
const listItem = (c, pipelines) => ({
  key: c.key, email: c.email, name: c.name, phone: c.phone, type: c.type, orders: c.orders, ltv: c.ltv, funnels: [...c.funnels].filter(Boolean),
  source: c.source, firstSeen: c.firstSeen, lastSeen: c.lastSeen, fields: c.fields, custom: c.meta?.custom || {}, tags: c.meta?.tags || [], unsubscribed: !!c.meta?.unsubscribed,
  stages: Object.fromEntries(pipelines.map((p) => [p.id, stageFor(p, c.meta, c.type === 'customer')])),
});

// every contact as the Contacts page lists them, plus the funnels they came through (for segments)
export function contactList(userId) {
  const pipelines = pipelinesFor(userId);
  return Object.values(buildContacts(userId).contacts).map((c) => ({ ...listItem(c, pipelines), funnelIds: [...c.fids] }));
}

const ITEM_TITLE = { main: 'Bought', bump: 'Added order bump', upsell: 'Accepted upsell', downsell: 'Accepted downsell', crosssell: 'Bought add-on' };
function timeline(userId, c, funnelName) {
  const out = [];
  const funnels = new Map();
  const stepName = (fid, sid) => { if (!funnels.has(fid)) funnels.set(fid, T.funnels.get(fid)); return funnels.get(fid)?.steps.find((s) => s.id === sid)?.name; };
  // visits: page views from the same browser, grouped into sessions
  const vids = [...new Set([...c.refs.leads, ...c.refs.orders, ...c.refs.abandoned].map((x) => x.visitor).filter(Boolean))].slice(0, 200);
  const views = vids.length ? q(`SELECT funnelId, stepId, source, at FROM events WHERE visitor IN (${vids.map(() => '?').join(',')}) AND userId = ? AND type = 'view' ORDER BY at LIMIT 20000`).all(...vids, userId).filter((e) => funnelName[e.funnelId]) : [];
  const sessions = [];
  for (const v of views) {
    const s = sessions.at(-1);
    if (s && v.at - s.last < SESSION_GAP && s.funnelId === v.funnelId) { s.last = v.at; s.pages.add(v.stepId); }
    else sessions.push({ at: v.at, last: v.at, funnelId: v.funnelId, source: v.source, pages: new Set([v.stepId]) });
  }
  sessions.forEach((s, i) => out.push({ type: 'visit', at: s.at, title: i === 0 ? 'First visit' : 'Came back', text: `${funnelName[s.funnelId]} · ${s.pages.size} page${s.pages.size > 1 ? 's' : ''} viewed${s.source && s.source !== 'direct' ? ` · from ${s.source}` : ''}` }));
  if (!sessions.length && c.firstSeen !== Infinity && !c.meta?.manual) out.push({ type: 'visit', at: c.firstSeen, title: 'First came in', text: `${[...c.funnels].filter(Boolean)[0] || ''}${c.source && c.source !== 'direct' ? ` · from ${c.source}` : ''}` });
  if (c.meta?.manual) out.push({ type: 'created', at: c.meta.at, title: 'Added by you' });
  for (const l of c.refs.leads) out.push({ type: 'lead', at: l.at, title: l.qualified === undefined ? `Signed up on ${funnelName[l.funnelId]}` : `Applied on ${funnelName[l.funnelId]} — ${l.qualified ? 'qualified ✓' : 'not a fit'}`, text: [stepName(l.funnelId, l.stepId), l.source && l.source !== 'direct' ? `from ${l.source}` : ''].filter(Boolean).join(' · '), fields: l.fields });
  for (const a of c.refs.abandoned) out.push({ type: 'abandon', at: a.at, title: 'Started checkout but didn’t pay', text: `${funnelName[a.funnelId]}${a.recovered ? ' · bought later' : ''}` });
  for (const o of c.refs.orders) {
    for (const it of o.items || []) out.push({ type: it.kind === 'main' ? 'purchase' : it.kind, at: it.at || o.at, title: `${ITEM_TITLE[it.kind] || 'Bought'}: ${it.name}`, amount: it.price, text: `${funnelName[o.funnelId]}${it.kind === 'main' && o.coupon ? ` · coupon ${o.coupon}` : ''}` });
  }
  for (const a of c.meta?.activities || []) out.push({ ...a });
  // newest first; things that happened in the same moment keep their natural order
  const rank = { visit: 0, created: 0, lead: 1, abandon: 2, purchase: 3, bump: 4, upsell: 5, downsell: 6, crosssell: 7 };
  return out.sort((a, b) => b.at - a.at || (rank[b.type] ?? 9) - (rank[a.type] ?? 9));
}

const cleanFields = (list) => (Array.isArray(list) ? list : []).filter((f) => f && typeof f === 'object').slice(0, 30).map((f) => ({
  id: str(f.id, 20) || uid(), label: str(f.label, 60) || 'Untitled field', type: FIELD_TYPES.includes(f.type) ? f.type : 'text',
  ...(f.type === 'select' ? { options: str(f.options, 1000) } : {}),
})).filter((f, i, a) => a.findIndex((x) => x.id === f.id) === i);

const cleanCustom = (defs, input = {}) => {
  const out = {};
  for (const d of defs) {
    if (!(d.id in input)) continue;
    const v = input[d.id];
    if (d.type === 'checkbox') out[d.id] = !!v;
    else if (d.type === 'number') { if (v !== '' && v != null && Number.isFinite(Number(v))) out[d.id] = Number(v); }
    else if (v != null && v !== '') out[d.id] = str(v, 2000);
  }
  return out;
};

export function registerCrm(app, { auth, rateLimit, isTest, onEvent = () => {} }) {
  const mailLimiter = rateLimit({ windowMs: 60000, max: isTest ? 1000 : 20, key: (req) => req.user.id, message: 'You are sending emails too quickly — please wait a minute.' });
  const userOf = (req) => req.user;
  const load = (req, res) => {
    const key = String(req.params.key || '').toLowerCase().startsWith('phone:') ? String(req.params.key) : String(req.params.key || '').toLowerCase();
    const { contacts, funnelName } = buildContacts(req.user.id, key);
    const c = contacts[key];
    if (!c) { res.status(404).json({ error: 'Contact not found' }); return null; }
    return { c, funnelName };
  };

  app.get('/api/contacts', auth, (req, res) => {
    const pipelines = pipelinesFor(req.user.id);
    const { contacts } = buildContacts(req.user.id);
    res.json(Object.values(contacts).map((c) => listItem(c, pipelines)).sort((a, b) => b.lastSeen - a.lastSeen));
  });

  app.post('/api/contacts', auth, (req, res) => {
    const email = str(req.body.email, 200).toLowerCase(), phone = str(req.body.phone, 40), name = str(req.body.name, 120);
    if (email && !EMAIL_RE.test(email)) return res.status(400).json({ error: 'Please enter a valid email address' });
    if (!email && !phone) return res.status(400).json({ error: 'Add an email or a phone number' });
    const key = contactKey(email, phone);
    if (buildContacts(req.user.id, key).contacts[key]) return res.status(409).json({ error: 'This contact already exists', key });
    const m = ensureMeta(req.user.id, key);
    T.crm.put(Object.assign(m, { manual: true, name, email, phone, at: Date.now() }));
    res.json({ key });
  });

  app.get('/api/contacts/:key', auth, (req, res) => {
    const r = load(req, res);
    if (!r) return;
    const { c, funnelName } = r;
    const pipelines = pipelinesFor(req.user.id);
    res.json({
      ...listItem(c, pipelines),
      orderList: c.refs.orders.map((o) => ({ id: o.id, at: o.at, total: o.total, items: o.items, funnel: funnelName[o.funnelId], coupon: o.coupon })).reverse(),
      timeline: timeline(req.user.id, c, funnelName),
      canEmail: !!c.email, mailConfigured: emailStatus(userOf(req)).configured, whatsappConfigured: whatsappStatus(userOf(req)).configured,
    });
  });

  app.patch('/api/contacts/:key', auth, (req, res) => {
    const r = load(req, res);
    if (!r) return;
    const m = ensureMeta(req.user.id, r.c.key);
    const b = req.body || {};
    if ('name' in b) m.name = str(b.name, 120);
    if ('phone' in b) m.phone = str(b.phone, 40);
    if ('email' in b) {
      const e = str(b.email, 200).toLowerCase();
      if (e && !EMAIL_RE.test(e)) return res.status(400).json({ error: 'Please enter a valid email address' });
      if (r.c.key.startsWith('phone:') || m.manual) m.email = e; // a contact found by email keeps that email as its identity
    }
    if (b.custom && typeof b.custom === 'object') m.custom = { ...m.custom, ...cleanCustom(userOf(req).crmFields || [], b.custom) };
    const added = [];
    if (Array.isArray(b.tags)) {
      const before = new Set((m.tags || []).map((t) => t.toLowerCase()));
      m.tags = [...new Set(b.tags.map((t) => str(t, 30)).filter(Boolean))].slice(0, 20);
      added.push(...m.tags.filter((t) => !before.has(t.toLowerCase())));
    }
    if ('unsubscribed' in b) m.unsubscribed = !!b.unsubscribed;
    let moved = null;
    if (b.stage?.pipelineId) {
      const p = pipelinesFor(req.user.id).find((x) => x.id === b.stage.pipelineId);
      const s = p?.stages.find((x) => x.id === b.stage.stageId);
      if (!s) return res.status(400).json({ error: 'Unknown stage' });
      if (stageFor(p, m, r.c.type === 'customer') !== s.id) { m.activities.push({ id: uid(), at: Date.now(), type: 'stage', title: `Moved to ${s.name}`, text: p.name }); moved = { pipelineId: p.id, stageId: s.id }; }
      m.stages = { ...m.stages, [p.id]: s.id };
    }
    T.crm.put(m);
    const who = { key: r.c.key, email: m.email || r.c.email, phone: m.phone || r.c.phone, name: m.name || r.c.name };
    if (moved) onEvent(req.user.id, 'stage', { ...who, ...moved });
    for (const tag of added) onEvent(req.user.id, 'tag', { ...who, tag });
    res.json({ ok: true });
  });

  // bulk actions from the contacts list: add / remove a tag, move to a stage
  app.post('/api/contacts/bulk', auth, (req, res) => {
    const keys = [...new Set((Array.isArray(req.body.keys) ? req.body.keys : []).map(String))].slice(0, 5000);
    if (!keys.length) return res.status(400).json({ error: 'Select some contacts first' });
    const { contacts } = buildContacts(req.user.id);
    const addTag = str(req.body.addTag, 30), removeTag = str(req.body.removeTag, 30);
    const p = req.body.stage?.pipelineId && pipelinesFor(req.user.id).find((x) => x.id === req.body.stage.pipelineId);
    const st = p && p.stages.find((x) => x.id === req.body.stage.stageId);
    if (req.body.stage && !st) return res.status(400).json({ error: 'Unknown stage' });
    if (!addTag && !removeTag && !st) return res.status(400).json({ error: 'Nothing to do' });
    let n = 0;
    const events = [];
    tx(() => { for (const key of keys) {
      const c = contacts[key];
      if (!c) continue;
      const m = ensureMeta(req.user.id, key);
      const who = { key, email: m.email || c.email, phone: m.phone || c.phone, name: m.name || c.name };
      if (addTag && !(m.tags || []).some((t) => t.toLowerCase() === addTag.toLowerCase())) { m.tags = [...(m.tags || []), addTag].slice(0, 20); events.push(['tag', { ...who, tag: addTag }]); }
      if (removeTag) m.tags = (m.tags || []).filter((t) => t.toLowerCase() !== removeTag.toLowerCase());
      if (st && stageFor(p, m, c.type === 'customer') !== st.id) {
        m.activities.push({ id: uid(), at: Date.now(), type: 'stage', title: `Moved to ${st.name}`, text: `${p.name} · bulk action` });
        m.stages = { ...m.stages, [p.id]: st.id };
        events.push(['stage', { ...who, pipelineId: p.id, stageId: st.id }]);
      }
      T.crm.put(m);
      n++;
    } });
    for (const [type, data] of events) onEvent(req.user.id, type, data);
    res.json({ updated: n });
  });

  // notes, calls and WhatsApp messages the seller sends from the contact screen
  const ACT = { note: 'Note', call: 'Call', whatsapp: 'WhatsApp message sent', meeting: 'Meeting' };
  app.post('/api/contacts/:key/activity', auth, (req, res) => {
    const r = load(req, res);
    if (!r) return;
    const type = ACT[req.body.type] ? req.body.type : 'note';
    const text = str(req.body.text, 4000);
    if (!text && type === 'note') return res.status(400).json({ error: 'Write something first' });
    res.json(logActivity(req.user.id, r.c.key, { type, title: ACT[type], text, by: 'you' }));
  });
  app.delete('/api/contacts/:key/activity/:aid', auth, (req, res) => {
    const r = load(req, res);
    if (!r) return;
    const m = metaFor(req.user.id, r.c.key);
    if (m) { m.activities = (m.activities || []).filter((a) => !(a.id === req.params.aid && a.by === 'you')); T.crm.put(m); }
    res.json({ ok: true });
  });

  app.post('/api/contacts/:key/whatsapp', auth, mailLimiter, async (req, res) => {
    const r = load(req, res);
    if (!r) return;
    const text = str(req.body.text, 4096);
    if (!r.c.phone) return res.status(400).json({ error: 'This contact has no phone number' });
    if (!text) return res.status(400).json({ error: 'Write a message first' });
    try {
      const out = await sendWhatsApp(userOf(req), r.c.phone, { text });
      if (out.status !== 'sent') return res.status(400).json({ error: 'WhatsApp isn’t connected yet' });
      res.json(logActivity(req.user.id, r.c.key, { type: 'whatsapp', title: 'WhatsApp sent', text, status: 'sent', by: 'you' }));
    } catch (e) { res.status(502).json({ error: e.message }); }
  });
  app.post('/api/contacts/:key/email', auth, mailLimiter, async (req, res) => {
    const r = load(req, res);
    if (!r) return;
    const subject = str(req.body.subject, 200), text = str(req.body.text, 20000);
    if (!r.c.email) return res.status(400).json({ error: 'This contact has no email address' });
    if (!subject || !text) return res.status(400).json({ error: 'Add a subject and a message' });
    const u = userOf(req);
    const biz = u.settings?.businessName;
    let status;
    try { status = (await sendEmail(u, { to: r.c.email, subject, text: biz ? `${text}\n\n— ${biz}` : text })).status; } catch (e) { return res.status(502).json({ error: `Email could not be sent: ${e.message}` }); }
    res.json(logActivity(req.user.id, r.c.key, { type: 'email', title: status === 'sent' ? `Email sent: ${subject}` : `Email (not delivered — email not set up): ${subject}`, text, status, by: 'you' }));
  });

  // ---- pipelines ----
  app.get('/api/pipelines', auth, (req, res) => res.json(pipelinesFor(req.user.id).map(({ userId, ...p }) => p)));
  const cleanStages = (stages) => (Array.isArray(stages) ? stages : []).slice(0, 20).map((s, i) => ({
    id: str(s.id, 20) || uid(), name: str(s.name, 40) || `Stage ${i + 1}`, color: /^#[0-9a-f]{6}$/i.test(s.color) ? s.color : COLORS[i % COLORS.length],
    ...(s.won ? { won: true } : {}), ...(s.lost ? { lost: true } : {}),
  }));
  app.post('/api/pipelines', auth, (req, res) => {
    const mineP = pipelinesFor(req.user.id);
    if (mineP.length >= 20) return res.status(400).json({ error: 'You can have up to 20 pipelines' });
    const stages = cleanStages(req.body.stages?.length ? req.body.stages : DEFAULT_STAGES.map(([name, color, flag]) => ({ name, color, [flag]: !!flag })));
    const p = T.pipelines.insert({ id: uid(), userId: req.user.id, name: str(req.body.name, 60) || 'New pipeline', stages, at: Date.now() });
    const { userId, ...out } = p;
    res.json(out);
  });
  app.put('/api/pipelines/:pid', auth, (req, res) => {
    const p = T.pipelines.get(req.params.pid);
    if (!p || p.userId !== req.user.id) return res.status(404).json({ error: 'Pipeline not found' });
    if ('name' in req.body) p.name = str(req.body.name, 60) || p.name;
    if (req.body.stages) { const st = cleanStages(req.body.stages); if (!st.length) return res.status(400).json({ error: 'A pipeline needs at least one stage' }); p.stages = st; }
    T.pipelines.put(p);
    const { userId, ...out } = p;
    res.json(out);
  });
  app.delete('/api/pipelines/:pid', auth, (req, res) => {
    if (pipelinesFor(req.user.id).length <= 1) return res.status(400).json({ error: 'Keep at least one pipeline' });
    T.pipelines.delWhere({ id: req.params.pid, userId: req.user.id });
    res.json({ ok: true });
  });

  // ---- custom contact fields ----
  app.get('/api/crm/fields', auth, (req, res) => res.json(userOf(req).crmFields || []));
  app.put('/api/crm/fields', auth, (req, res) => {
    const fields = cleanFields(req.body.fields);
    T.users.update(req.user.id, (u) => { u.crmFields = fields; });
    res.json(fields);
  });
}
