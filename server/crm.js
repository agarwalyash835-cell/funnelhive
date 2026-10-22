// CRM: contacts (built from leads + orders, plus anything the seller adds), pipelines with stages,
// custom contact fields and a per-contact timeline of visits, sign-ups, purchases and messages.
import { T, q, tx, uid, contactKey } from './db.js';
import { sendEmail, emailStatus, sendWhatsApp, whatsappStatus } from './messaging.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SESSION_GAP = 30 * 60000; // page views more than 30 min apart count as a new visit
export const FIELD_TYPES = ['text', 'longtext', 'number', 'money', 'phone', 'date', 'select', 'url', 'checkbox'];
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
  // every funnel id their orders and leads have (from an index, no JSON read); the name only for ids that aren't live
  const ids = new Set(['orders', 'leads'].flatMap((t) => q(`SELECT DISTINCT funnelId FROM ${t} WHERE userId = ?`).all(userId).map((r) => r.funnelId)));
  for (const id of ids) {
    if (m[id]) continue;
    const r = q("SELECT MIN(name) AS name FROM (SELECT MIN(json_extract(data, '$.funnelName')) AS name FROM orders WHERE userId = $u AND funnelId IS $f UNION ALL SELECT MIN(json_extract(data, '$.funnelName')) FROM leads WHERE userId = $u AND funnelId IS $f)").get({ u: userId, f: id });
    if (r?.name != null) m[id] = `${r.name} (deleted)`;
  }
  return m;
};
// onlyKey: one key, or a list of keys (a page of the contacts list)
function buildContacts(userId, onlyKey, name = funnelNames(userId)) {
  const keys = onlyKey == null ? null : [].concat(onlyKey);
  const where = keys ? { userId, ckey: keys } : { userId };
  // a page of keys: looked up by key and put in time order here (ORDER BY at would walk every row by date)
  const rowsOf = (t) => (keys?.length > 1 ? T[t].all(where).sort((a, b) => a.at - b.at) : T[t].iter(where, { order: 'at' }));
  const m = {};
  const get = (key) => (m[key] ||= { key, email: key.startsWith('phone:') ? '' : key, name: '', phone: '', type: 'lead', orders: 0, ltv: 0, funnels: new Set(), fids: new Set(), source: 'direct', firstSeen: Infinity, lastSeen: 0, refs: { leads: [], orders: [], abandoned: [] } });
  const touch = (c, x) => { c.firstSeen = Math.min(c.firstSeen, x.at); c.lastSeen = Math.max(c.lastSeen, x.at); c.funnels.add(name[x.funnelId]); c.fids.add(x.funnelId); c.name ||= x.name || ''; c.phone ||= x.phone || ''; if (x.source) c.source = x.source; };
  for (const l of rowsOf('leads')) if (name[l.funnelId] && (l.email || l.phone)) { const c = get(contactKey(l.email, l.phone)); touch(c, l); c.refs.leads.push(l); if (l.fields) c.fields = { ...(c.fields || {}), ...l.fields }; }
  for (const o of rowsOf('orders')) if (name[o.funnelId] && o.email) { const c = get(contactKey(o.email)); touch(c, o); c.type = 'customer'; c.orders++; c.ltv += o.total; c.refs.orders.push(o); }
  for (const a of rowsOf('abandoned')) if (name[a.funnelId] && a.email && m[contactKey(a.email)]) m[contactKey(a.email)].refs.abandoned.push(a);
  // the seller's own additions and edits
  for (const meta of keys ? (keys.length === 1 ? [metaFor(userId, keys[0])].filter(Boolean) : T.crm.all({ userId, key: keys })) : T.crm.iter({ userId })) {
    if (!m[meta.key] && !meta.manual) continue;
    meta.activities ||= [];
    const c = m[meta.key] || get(meta.key);
    if (meta.manual && c.firstSeen === Infinity) { c.firstSeen = meta.at; c.lastSeen = meta.at; c.source = meta.source || 'added by you'; }
    for (const k of ['name', 'phone', 'email']) if (meta[k]) c[k] = meta[k];
    c.meta = meta;
    const lastAct = meta.activities.at(-1)?.at;
    if (lastAct) c.lastSeen = Math.max(c.lastSeen, lastAct);
  }
  return { contacts: m, funnelName: name };
}
const listItem = (c, pipelines) => ({
  key: c.key, email: c.email, name: c.name, phone: c.phone, type: c.type, orders: c.orders, ltv: c.ltv, funnels: [...c.funnels].filter(Boolean),
  source: c.source, firstSeen: c.firstSeen, lastSeen: c.lastSeen, fields: c.fields, custom: c.meta?.custom || {}, tags: c.meta?.tags || [], unsubscribed: !!c.meta?.unsubscribed, ...(c.meta?.waOptOut ? { waOptOut: true } : {}),
  // agreed to marketing: ticked/accepted the consent line on a form, or the seller recorded it (by hand or on import)
  optIn: c.meta?.optIn === false ? false : !!c.meta?.optIn || c.refs.leads.some((l) => l.consent?.given === true),
  stages: Object.fromEntries(pipelines.map((p) => [p.id, stageFor(p, c.meta, c.type === 'customer')])),
});

// every contact as the Contacts page lists them, plus the funnels they came through (for segments)
export function contactList(userId) {
  const pipelines = pipelinesFor(userId);
  return Object.values(buildContacts(userId).contacts).map((c) => ({ ...listItem(c, pipelines), funnelIds: [...c.fids] }));
}

// ---------- the contacts list, a page at a time ----------
// SQLite sums every contact up (json_extract + GROUP BY ckey) with the same rules as buildContacts — only
// the columns needed to search, filter, sort and count — so nothing is loaded and parsed in JS. The page
// itself (100 or so contacts) is then built by buildContacts, so each row is exactly what it always was.
// first non-empty value in time order: "at" is padded so MIN of at||value picks the earliest
const firstOf = (v, at) => `substr(MIN(CASE WHEN ${v} <> '' THEN printf('%015d', ${at}) || ${v} END), 16)`;
// Leads, orders and CRM records in one GROUP BY. Counts, value and last activity come from indexed columns;
// text = also name / email / phone (to search or sort by name), the only part that reads each lead's JSON.
// Booking and quote orders have no funnel (funnelId null) but count when funnelNames gives them a name.
const summary = (text) => `
  f AS (SELECT value AS id FROM json_each($fids)),
  r AS (SELECT ckey, at AS lat, NULL AS oat, 0 AS n, 0 AS ltv, ${text ? "json_extract(data, '$.name') AS lname, json_extract(data, '$.phone') AS lphone, NULL AS oname, NULL AS ophone," : ''} NULL AS meta
      FROM leads WHERE userId = $uid AND ckey <> '' AND (funnelId IN (SELECT id FROM f) OR ($nofunnel AND funnelId IS NULL))
    UNION ALL SELECT ckey, NULL, at, 1, total, ${text ? "NULL, NULL, json_extract(data, '$.name'), json_extract(data, '$.phone')," : ''} NULL
      FROM orders WHERE userId = $uid AND ckey <> '' AND (funnelId IN (SELECT id FROM f) OR ($nofunnel AND funnelId IS NULL))
    UNION ALL SELECT key, NULL, NULL, 0, 0, ${text ? 'NULL, NULL, NULL, NULL,' : ''} data FROM crm WHERE userId = $uid),
  g AS (SELECT ckey, MAX(lat) AS lls, MAX(oat) AS ols, SUM(n) AS n, SUM(ltv) AS ltv, MAX(meta) AS meta${text ? `, ${firstOf('lname', 'lat')} AS lname, ${firstOf('lphone', 'lat')} AS lphone, ${firstOf('oname', 'oat')} AS oname, ${firstOf('ophone', 'oat')} AS ophone` : ''}
    FROM r GROUP BY ckey),
  c AS MATERIALIZED (SELECT ckey AS key, ${text ? `
    COALESCE(NULLIF(json_extract(meta, '$.name'), ''), lname, oname, '') AS name,
    COALESCE(NULLIF(json_extract(meta, '$.email'), ''), CASE WHEN substr(ckey, 1, 6) = 'phone:' THEN '' ELSE ckey END) AS email,
    COALESCE(NULLIF(json_extract(meta, '$.phone'), ''), lphone, ophone, '') AS phone,` : ''}
    CASE WHEN n > 0 THEN 'customer' ELSE 'lead' END AS type, n AS orders, ltv,
    MAX(IFNULL(lls, 0), IFNULL(ols, 0), IFNULL(json_extract(meta, '$.activities[#-1].at'), 0), CASE WHEN lls IS NULL AND ols IS NULL THEN IFNULL(json_extract(meta, '$.at'), 0) ELSE 0 END) AS lastSeen,
    json_extract(meta, '$.tags') AS tags, json_extract(meta, '$.stages') AS stages, json_extract(meta, '$.custom') AS custom
    FROM g WHERE lls IS NOT NULL OR ols IS NOT NULL OR json_extract(meta, '$.manual'))`;
const SORTS = { recent: ['lastSeen', 'DESC'], ltv: ['ltv', 'DESC'], name: ["lower(name)", 'ASC'] };
export const CONTACTS_PAGE_MAX = 1000;
const cursorOut = (v, key) => Buffer.from(JSON.stringify([v, key])).toString('base64url');
const cursorIn = (s) => { try { const c = JSON.parse(Buffer.from(String(s), 'base64url').toString()); return Array.isArray(c) && c.length === 2 && typeof c[1] === 'string' ? c : null; } catch { return null; } };

// opts: { limit, cursor, q, type: lead|customer, tag, pipeline, stage, sort: recent|ltv|name, keysOnly, cf: { fieldId: value }, sum: fieldId }
// → { contacts, nextCursor, total, totalLtv, kpis: { total, customers, leads, avgLtv } }
export function contactPage(userId, opts = {}) {
  const name = funnelNames(userId);
  const pipelines = pipelinesFor(userId);
  const limit = opts.keysOnly ? 5000 : Math.max(1, Math.min(CONTACTS_PAGE_MAX, Number(opts.limit) || 100));
  const [col, dir] = SORTS[opts.sort] || SORTS.recent;
  const args = { uid: userId, fids: JSON.stringify(Object.keys(name).filter((id) => name[id])), nofunnel: name.null ? 1 : 0, limit: limit + 1 };
  const where = [];
  if (opts.type === 'lead' || opts.type === 'customer') { where.push('type = $type'); args.type = opts.type; }
  const text = String(opts.q || '').trim().toLowerCase();
  // the same text the page always searched: name, email, phone and tags
  if (text) { where.push("instr(lower(name || ' ' || email || ' ' || phone || ' ' || IFNULL((SELECT group_concat(value, ' ') FROM json_each(c.tags)), '')), $q) > 0"); args.q = text; }
  if (opts.tag) { where.push('EXISTS (SELECT 1 FROM json_each(c.tags) WHERE lower(value) = $tag)'); args.tag = String(opts.tag).trim().toLowerCase(); }
  // custom-field filters (the CRM kit's quick filters): { fieldId: value }
  Object.entries(opts.cf || {}).slice(0, 5).forEach(([fid, v], i) => {
    if (!/^[\w-]{1,20}$/.test(fid) || v == null || v === '') return;
    where.push(`CAST(json_extract(custom, $cfp${i}) AS TEXT) = $cfv${i}`);
    args[`cfp${i}`] = `$."${fid}"`; args[`cfv${i}`] = String(v).slice(0, 200);
  });
  // a number field's total over the matches (the board's column value, e.g. budgets)
  const sumField = /^[\w-]{1,20}$/.test(opts.sum || '') ? opts.sum : null;
  args.sump = sumField ? `$."${sumField}"` : '$.none';
  const p = opts.stage && pipelines.find((x) => x.id === opts.pipeline);
  if (opts.stage && !p) return { contacts: [], nextCursor: null, total: 0, totalLtv: 0, kpis: { total: 0, customers: 0, leads: 0, avgLtv: 0 } };
  if (p) {
    // stageFor in SQL: their stage if it still exists, else customers in the "won" stage and everyone else in the first
    where.push(`(CASE WHEN json_extract(stages, $spath) IN (SELECT value FROM json_each($sids)) THEN json_extract(stages, $spath) WHEN type = 'customer' AND $won IS NOT NULL THEN $won ELSE $first END) = $stage`);
    Object.assign(args, { spath: `$."${String(p.id).replace(/["\\]/g, '')}"`, sids: JSON.stringify(p.stages.map((s) => s.id)), won: p.stages.find((s) => s.won)?.id ?? null, first: p.stages[0]?.id ?? null, stage: String(opts.stage) });
  }
  const cur = opts.cursor && cursorIn(opts.cursor);
  const after = cur ? `(${col} ${dir === 'DESC' ? '<' : '>'} $cv OR (${col} = $cv AND key ${dir === 'DESC' ? '<' : '>'} $ck))` : '1';
  if (cur) Object.assign(args, { cv: cur[0], ck: cur[1] });
  const rows = q(`WITH ${summary(text || col !== 'lastSeen' && col !== 'ltv')}, hits AS MATERIALIZED (SELECT * FROM c${where.length ? ` WHERE ${where.join(' AND ')}` : ''})
    SELECT 0 AS kind, NULL AS key, NULL AS sv, (SELECT COUNT(*) FROM c) AS a, (SELECT COUNT(*) FROM c WHERE type = 'customer') AS b, (SELECT TOTAL(ltv) FROM c WHERE type = 'customer') AS d, (SELECT COUNT(*) FROM hits) AS e, (SELECT TOTAL(ltv) FROM hits) AS g, (SELECT TOTAL(CAST(json_extract(custom, $sump) AS REAL)) FROM hits) AS h
    UNION ALL SELECT * FROM (SELECT 1, key, ${col}, NULL, NULL, NULL, NULL, NULL, NULL FROM hits WHERE ${after} ORDER BY ${col} ${dir}, key ${dir} LIMIT $limit)`).all(args);
  const k = rows[0], page = rows.slice(1);
  const more = page.length > limit;
  if (more) page.pop();
  const out = { nextCursor: more ? cursorOut(page.at(-1).sv, page.at(-1).key) : null, total: k.e, totalLtv: k.g, ...(sumField ? { totalValue: k.h } : {}), kpis: { total: k.a, customers: k.b, leads: k.a - k.b, avgLtv: k.b ? k.d / k.b : 0 } };
  if (opts.keysOnly) return { ...out, keys: page.map((r) => r.key) };
  const built = page.length ? buildContacts(userId, page.map((r) => r.key), name).contacts : {};
  return { ...out, contacts: page.map((r) => built[r.key]).filter(Boolean).map((c) => listItem(c, pipelines)) };
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
  if (c.meta?.manual) out.push({ type: 'created', at: c.meta.at, title: c.meta.source?.startsWith('import') ? 'Imported from a CSV file' : 'Added by you' });
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
    else if (d.type === 'number' || d.type === 'money') { const n = Number(String(v ?? '').replace(/[₹,\s]/g, '')); if (v !== '' && v != null && Number.isFinite(n)) out[d.id] = n; }
    else if (v != null && v !== '') out[d.id] = str(v, 2000);
  }
  return out;
};

// ---------- CSV import ----------
// The browser parses the file; rows arrive as objects keyed by column name. Imported people are CRM
// records like "Add contact" — never funnel leads — so they don't count as sign-ups and start no automations.
export const IMPORT_MAX = 10000;
const ALIASES = {
  email: ['email', 'e-mail', 'email address', 'e-mail address', 'mail'], phone: ['phone', 'mobile', 'whatsapp', 'number', 'phone number', 'mobile number', 'whatsapp number', 'contact number'],
  name: ['name', 'full name', 'fullname', 'contact name'], first: ['first name', 'firstname', 'first'], last: ['last name', 'lastname', 'surname', 'last'],
  tags: ['tags', 'tag', 'labels'], stage: ['stage', 'pipeline stage'], source: ['source', 'lead source'], notes: ['notes', 'note', 'comments', 'remarks'],
};
const TARGETS = Object.keys(ALIASES);
const norm = (h) => String(h).trim().toLowerCase().replace(/[_\s]+/g, ' ');
// a column → what it fills: a target above, custom:<field id>, extra (kept in a note) or '' (ignored)
function importMapping(given, headers, defs) {
  const ok = (t) => t === '' || t === 'extra' || TARGETS.includes(t) || (t.startsWith('custom:') && defs.some((d) => `custom:${d.id}` === t));
  const auto = (h) => TARGETS.find((t) => ALIASES[t].includes(norm(h))) || ((d) => d && `custom:${d.id}`)(defs.find((d) => norm(d.label) === norm(h))) || 'extra';
  const out = {};
  for (const h of headers) {
    const t = given && typeof given === 'object' && typeof given[h] === 'string' ? given[h] : auto(h);
    out[h] = ok(t) ? t : 'extra';
  }
  return out;
}
// phone numbers compare by their last 10 digits (+91 98765 43210 = 9876543210)
const phoneId = (p) => { const d = String(p || '').replace(/\D/g, ''); return d.length < 6 ? '' : d.slice(-10); };
const splitTags = (v) => String(v || '').split(/[;,|]/).map((t) => str(t, 30)).filter(Boolean);
const addTags = (have = [], more) => { const seen = new Set(have.map((t) => t.toLowerCase())); return [...have, ...more.filter((t) => !seen.has(t.toLowerCase()) && seen.add(t.toLowerCase()))].slice(0, 20); };

// Everything stored about one contact for this seller — a DPDP / GDPR access request
const SECRETISH = /token|hash|secret|signature/i;
const scrub = (x) => (Array.isArray(x) ? x.map(scrub) : x && typeof x === 'object' ? Object.fromEntries(Object.entries(x).filter(([k]) => k !== 'userId' && !SECRETISH.test(k)).map(([k, v]) => [k, scrub(v)])) : x);
function contactExport(u, key) {
  const userId = u.id;
  const { contacts, funnelName } = buildContacts(userId, key);
  const c = contacts[key], meta = metaFor(userId, key);
  const byEmail = !key.startsWith('phone:');
  const leads = T.leads.all({ userId, ckey: key }, { order: 'at' });
  const orders = byEmail ? T.orders.all({ userId, ckey: key }, { order: 'at' }) : [];
  const data = {
    leads: leads.map((l) => ({ ...l, funnel: funnelName[l.funnelId] || null })),
    orders: orders.map((o) => ({ ...o, funnel: funnelName[o.funnelId] || null, invoices: T.sinvoices.all({ orderId: o.id }).filter((i) => i.userId === userId).map((i) => ({ number: i.number, type: i.type || 'invoice', at: i.at, total: i.total })) })),
    abandonedCarts: T.abandoned.all({ userId, ckey: key }, { order: 'at' }), // phone-only carts too
    bookings: T.bookings.all({ userId, ckey: key }, { order: 'at' }),
    webinarRegistrations: T.registrations.all({ userId, ckey: key }, { order: 'at' }).map((r) => ({ ...r, webinar: T.webinars.get(r.webinarId)?.name || null })),
    productAccess: byEmail ? T.access.all({ userId, ckey: key }, { order: 'at' }).map((a) => ({ ...a, product: T.products.get(a.productId)?.name || null })) : [],
    messages: q("SELECT data FROM msgs WHERE userId = ? AND json_extract(data, '$.key') = ? ORDER BY at").all(userId, key).map((r) => JSON.parse(r.data)),
    broadcastMessages: q("SELECT data FROM bsends WHERE userId = ? AND json_extract(data, '$.key') = ? ORDER BY at").all(userId, key).map((r) => JSON.parse(r.data)),
  };
  if (!c && !meta && !Object.values(data).some((v) => v.length)) return null;
  const pipelines = pipelinesFor(userId), labels = Object.fromEntries((u.crmFields || []).map((f) => [f.id, f.label]));
  return scrub({
    exportedAt: new Date().toISOString(),
    seller: { business: u.settings?.businessName || u.name || '', email: u.email },
    contact: { key, email: c?.email || meta?.email || (byEmail ? key : ''), name: c?.name || meta?.name || '', phone: c?.phone || meta?.phone || '', type: c?.type || 'lead', source: c?.source || null, firstSeen: c && c.firstSeen !== Infinity ? new Date(c.firstSeen).toISOString() : null, lastSeen: c?.lastSeen ? new Date(c.lastSeen).toISOString() : null, orders: c?.orders || 0, lifetimeValue: c?.ltv || 0 },
    crm: meta ? {
      tags: meta.tags || [], unsubscribed: !!meta.unsubscribed, ...(meta.optIn != null ? { marketingOptIn: { given: meta.optIn, at: meta.optInAt ? new Date(meta.optInAt).toISOString() : null, by: meta.optInBy || null } } : {}), addedBy: meta.manual ? meta.source || 'added by you' : null,
      customFields: Object.fromEntries(Object.entries(meta.custom || {}).map(([id, v]) => [labels[id] || id, v])),
      stages: Object.fromEntries(pipelines.map((p) => [p.name, p.stages.find((s) => s.id === stageFor(p, meta, c?.type === 'customer'))?.name || null])),
      activities: meta.activities || [],
    } : null,
    consents: leads.filter((l) => l.consent).map((l) => ({ at: l.consent.at, given: l.consent.given, text: l.consent.text, funnel: funnelName[l.funnelId] || null })),
    ...data,
  });
}

const jsonObj = (t) => { try { const o = JSON.parse(t || '{}'); return o && typeof o === 'object' && !Array.isArray(o) ? o : {}; } catch { return {}; } };
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

  // ?limit=&cursor=&q=&type=&tag=&pipeline=&stage=&sort= → one page plus the totals (the Contacts page);
  // keys=1 → just the keys of every match (up to 5000, for "select all"). Without any of these: the whole
  // list as a plain array, as before (older callers and the tests)
  const PAGED = ['limit', 'cursor', 'q', 'type', 'tag', 'stage', 'sort', 'keys', 'cf', 'sum'];
  app.get('/api/contacts', auth, (req, res) => {
    if (PAGED.some((k) => req.query[k] != null)) {
      const s = (k) => (typeof req.query[k] === 'string' ? req.query[k].slice(0, 200) : '');
      return res.json(contactPage(req.user.id, { limit: s('limit'), cursor: s('cursor'), q: s('q'), type: s('type'), tag: s('tag'), pipeline: s('pipeline'), stage: s('stage'), sort: s('sort'), keysOnly: s('keys') === '1', cf: jsonObj(s('cf')), sum: s('sum') }));
    }
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
    if ('optIn' in b) Object.assign(m, { optIn: !!b.optIn, optInAt: Date.now(), optInBy: 'you' });
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

  // Import contacts from a CSV the browser has parsed: new people are added, known ones (same email, else
  // same phone) get blanks filled in, tags added and a stage set. Nothing here fires an automation.
  const importLimiter = rateLimit({ windowMs: 60000, max: isTest ? 1000 : 10, key: (req) => req.user.id, message: 'Too many imports — please wait a minute.' });
  app.post('/api/contacts/import', auth, importLimiter, (req, res) => {
    const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
    if (!rows.length) return res.status(400).json({ error: 'The file has no rows to import' });
    if (rows.length > IMPORT_MAX) return res.status(400).json({ error: `Up to ${IMPORT_MAX.toLocaleString('en-IN')} rows at a time — please split the file` });
    const userId = req.user.id, defs = userOf(req).crmFields || [];
    const headers = new Set();
    for (const r of rows) if (r && typeof r === 'object' && !Array.isArray(r)) for (const h of Object.keys(r)) if (headers.size < 100) headers.add(h);
    const mapping = importMapping(req.body.mapping, [...headers], defs);
    const everyone = splitTags((Array.isArray(req.body.tags) ? req.body.tags : []).join(','));
    const { contacts } = buildContacts(userId);
    const byPhone = new Map();
    for (const c of Object.values(contacts)) { const p = phoneId(c.phone || (c.key.startsWith('phone:') ? c.key.slice(6) : '')); if (p && !byPhone.has(p)) byPhone.set(p, c.key); }
    const pipelines = pipelinesFor(userId);
    const stageNamed = (n) => { for (const p of pipelines) { const s = p.stages.find((x) => x.name.toLowerCase() === n.toLowerCase()); if (s) return [p, s]; } return null; };
    const out = { created: 0, updated: 0, skipped: 0, errors: [] };
    const note = (row, reason) => { if (out.errors.length < 50) out.errors.push({ row, reason }); };
    const skip = (row, reason) => { out.skipped++; note(row, reason); };
    const now = Date.now(), optIn = req.body.consent === true;
    tx(() => rows.forEach((r, i) => {
      const row = i + 1;
      if (!r || typeof r !== 'object' || Array.isArray(r)) return skip(row, 'Not a row');
      const v = { custom: {}, extra: [], tags: [] };
      for (const [h, t] of Object.entries(mapping)) {
        const val = str(r[h], 2000);
        if (!t || !val) continue;
        if (t === 'tags') v.tags.push(...splitTags(val));
        else if (t === 'extra') v.extra.push(`${str(h, 60)}: ${val}`);
        else if (t.startsWith('custom:')) v.custom[t.slice(7)] = val;
        else v[t] ||= val;
      }
      const email = str(v.email, 200).toLowerCase(), phone = str(v.phone, 40);
      const name = str(v.name || [v.first, v.last].filter(Boolean).join(' '), 120);
      if (!email && !phone) return skip(row, 'No email or phone number');
      if (email && !EMAIL_RE.test(email)) return skip(row, `Not a valid email: ${email.slice(0, 80)}`);
      // the same person: same email — or, when that email is new to us, a phone-only contact with this number
      const pk = byPhone.get(phoneId(phone));
      let key = email && contacts[email] ? email : pk && (!email || pk.startsWith('phone:')) ? pk : null;
      const isNew = !key;
      key ||= contactKey(email, phone);
      const c = contacts[key];
      const m = ensureMeta(userId, key);
      if (isNew) Object.assign(m, { manual: true, name, email, phone, source: v.source ? `import · ${str(v.source, 40)}` : 'import', at: now });
      else {
        // fill in what's missing; never overwrite what the seller (or the contact) already gave
        if (name && !m.name && !c?.name) m.name = name;
        if (phone && !m.phone && !c?.phone) m.phone = phone;
        if (email && key.startsWith('phone:') && !m.email) m.email = email;
      }
      const tags = [...v.tags, ...everyone];
      if (tags.length) m.tags = addTags(m.tags || [], tags);
      if (v.stage) {
        const hit = stageNamed(str(v.stage, 40));
        if (!hit) note(row, `No stage called “${str(v.stage, 40)}” — imported without a stage`);
        else if (m.stages?.[hit[0].id] !== hit[1].id) { m.stages = { ...m.stages, [hit[0].id]: hit[1].id }; if (!isNew) m.activities.push({ id: uid(), at: now, type: 'stage', title: `Moved to ${hit[1].name}`, text: `${hit[0].name} · CSV import` }); }
      }
      if (optIn && m.optIn === undefined) Object.assign(m, { optIn: true, optInAt: now, optInBy: 'import' }); // the seller ticked “these contacts agreed to receive marketing”
      if (Object.keys(v.custom).length) m.custom = { ...m.custom, ...cleanCustom(defs, v.custom) };
      const text = str([v.notes, ...v.extra].filter(Boolean).join('\n'), 4000);
      if (text && !m.activities.some((a) => a.type === 'note' && a.text === text)) m.activities = [...m.activities, { id: uid(), at: now, type: 'note', title: 'Note (imported)', text, by: 'import' }].slice(-500);
      T.crm.put(m);
      // later rows of the same file find this person too
      contacts[key] ||= { key, email: m.email || '', phone: m.phone || '', name: m.name || '' };
      if (phoneId(phone) && !byPhone.has(phoneId(phone))) byPhone.set(phoneId(phone), key);
      out[isNew ? 'created' : 'updated']++;
    }));
    res.json(out);
  });

  // Everything about one contact as a JSON file (their DPDP / GDPR access request): owners and admins only
  app.get('/api/contacts/:key/export', auth, (req, res) => {
    if (req.role && !['admin', 'agency'].includes(req.role)) return res.status(403).json({ error: 'Only the account owner or an admin can download a contact’s data' });
    const key = String(req.params.key || '').toLowerCase().startsWith('phone:') ? String(req.params.key) : String(req.params.key || '').toLowerCase();
    const data = key && contactExport(userOf(req), key);
    if (!data) return res.status(404).json({ error: 'Contact not found' });
    const safe = key.replace(/[^a-z0-9@._+-]/gi, '_').slice(0, 80);
    res.set('Content-Disposition', `attachment; filename="contact-${safe}.json"`).set('Cache-Control', 'no-store').json(data);
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
      const out = await sendWhatsApp(userOf(req), r.c.phone, { text, ckey: r.c.key });
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
