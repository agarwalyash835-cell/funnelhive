// Contact de-duplication: one person, one contact.
//   findContact      — the existing contact for an email / phone, so a new enquiry or WhatsApp chat joins it
//   findDuplicates   — likely duplicate groups (same number, same email, very similar name in the same city)
//   mergeContacts    — 2–20 contacts into one: every record that points at a contact key follows, in one transaction
//
// A contact's key is its lower-case email, or phone:<number> when it has none (db.js contactKey). Most tables
// don't store the key itself but work it out from the row's email / phone (leads, orders, carts, bookings…), so
// moving a row to another contact means giving it that contact's email (or number); what it had before is kept
// on the row as mergedFrom.
import { T, q, tx, uid, contactKey, phoneTail } from './db.js';
import { metaFor, contactsByKey, contactItem, contactList, pipelinesFor, stageFor } from './crm.js';
import { contactByPhone } from './hive-wa.js';

export const MERGE_MAX = 20;
const str = (v, n) => String(v ?? '').trim().slice(0, n);
const isPhoneKey = (k) => String(k).startsWith('phone:');
const normKey = (k) => (isPhoneKey(k) ? String(k) : String(k || '').trim().toLowerCase());
const phoneOf = (c) => c.phone || (isPhoneKey(c.key) ? c.key.slice(6) : '');

// ---------- matching on the way in ----------
// The same email; else the same number (last 10 digits, so +91 98765 43210 = 09876543210 = 9876543210). When the
// enquiry carries an email of its own, only a phone-only contact is joined (an email contact with this number but a
// different email may be someone else — it shows up under Duplicates instead), as the CSV import matches.
export function findContact(userId, { email, phone } = {}) {
  const e = String(email || '').trim().toLowerCase();
  if (e) {
    if (metaFor(userId, e) || T.leads.exists({ userId, ckey: e }) || T.orders.exists({ userId, ckey: e })) return e;
    const r = q("SELECT key FROM crm WHERE userId = ? AND key LIKE 'phone:%' AND lower(json_extract(data, '$.email')) = ?").get(userId, e);
    if (r) return r.key;
  }
  const byPhone = phone ? contactByPhone(userId, phone) : null;
  if (byPhone && (!e || (isPhoneKey(byPhone) && !metaFor(userId, byPhone)?.email))) return byPhone;
  return null;
}

// ---------- finding duplicates ----------
const normName = (n) => String(n || '').toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N} ]/gu, ' ').replace(/\b(mr|mrs|ms|dr|shri|smt)\b/g, ' ').replace(/\s+/g, ' ').trim();
function editDistance(a, b) {
  if (Math.abs(a.length - b.length) > 3) return 99;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}
// "Ravi Kumar" ~ "ravi kumar" ~ "Kumar Ravi" ~ "Ravi Kumaar": same words, or a typo or two in a long enough name
const similarNames = (a, b) => {
  if (!a || !b || a.length < 4 || b.length < 4) return false;
  if (a === b || a.split(' ').sort().join(' ') === b.split(' ').sort().join(' ')) return true;
  return Math.min(a.length, b.length) >= 8 && editDistance(a, b) <= (Math.min(a.length, b.length) >= 14 ? 2 : 1);
};
// the city: a form's "city" answer, or a CRM field labelled City
function cityOf(c, cityFields) {
  for (const [k, v] of Object.entries(c.fields || {})) if (/^(city|town|location)$/i.test(k) && v) return String(v).trim().toLowerCase();
  for (const id of cityFields) if (c.custom?.[id]) return String(c.custom[id]).trim().toLowerCase();
  return '';
}
const view = (c, city) => ({ key: c.key, name: c.name || '', email: c.email || '', phone: c.phone || '', type: c.type, orders: c.orders || 0, ltv: c.ltv || 0, tags: c.tags || [], firstSeen: c.firstSeen === Infinity ? null : c.firstSeen, lastSeen: c.lastSeen || 0, city: city || '', waOptOut: !!c.waOptOut, unsubscribed: !!c.unsubscribed });
// which one to keep by default: a buyer (most orders / value), then the one with an email, then the oldest
const suggest = (list) => [...list].sort((a, b) => b.orders - a.orders || b.ltv - a.ltv || (isPhoneKey(a.key) ? 1 : 0) - (isPhoneKey(b.key) ? 1 : 0) || (a.firstSeen || 0) - (b.firstSeen || 0))[0].key;

// → [{ id, reasons: [text], contacts: [...], suggested }] — biggest groups first, at most 200
export function findDuplicates(u, { key } = {}) {
  const userId = u.id;
  const cityFields = (u.crmFields || []).filter((f) => /city|town/i.test(f.label || '')).map((f) => f.id);
  const all = contactList(userId);
  const parent = new Map(all.map((c) => [c.key, c.key]));
  const find = (k) => { while (parent.get(k) !== k) { parent.set(k, parent.get(parent.get(k))); k = parent.get(k); } return k; };
  const reasons = new Map(); // root-independent: pair reasons, collected per key and joined at the end
  const why = (a, b, text) => { const ra = find(a), rb = find(b); if (ra !== rb) parent.set(ra, rb); for (const k of [a, b]) reasons.set(k, (reasons.get(k) || new Set()).add(text)); };
  const by = (fn) => { const m = new Map(); for (const c of all) { const v = fn(c); if (v) m.set(v, [...(m.get(v) || []), c]); } return m; };
  for (const [tail, list] of by((c) => { const t = phoneTail(phoneOf(c)); return t.length === 10 ? t : ''; })) if (list.length > 1) for (const c of list.slice(1)) why(list[0].key, c.key, `Same phone number (${tail.slice(0, 5)} ${tail.slice(5)})`);
  for (const [e, list] of by((c) => String(c.email || '').trim().toLowerCase())) if (list.length > 1) for (const c of list.slice(1)) why(list[0].key, c.key, `Same email (${e})`);
  const cities = new Map(all.map((c) => [c.key, cityOf(c, cityFields)]));
  for (const [city, list] of by((c) => cities.get(c.key))) {
    if (list.length < 2 || list.length > 3000) continue;
    const named = list.map((c) => [c, normName(c.name)]).filter(([, n]) => n);
    for (let i = 0; i < named.length; i++) for (let j = i + 1; j < named.length; j++) if (similarNames(named[i][1], named[j][1])) why(named[i][0].key, named[j][0].key, `Similar name in ${city.replace(/\b\w/g, (x) => x.toUpperCase())}`);
  }
  const groups = new Map();
  for (const c of all) if (reasons.has(c.key)) { const r = find(c.key); groups.set(r, [...(groups.get(r) || []), c]); }
  let out = [...groups.values()].filter((g) => g.length > 1).map((g) => {
    const contacts = g.map((c) => view(c, cities.get(c.key)));
    return { id: g.map((c) => c.key).sort().join('|'), reasons: [...new Set(g.flatMap((c) => [...reasons.get(c.key)]))], contacts, suggested: suggest(contacts) };
  });
  if (key) out = out.filter((g) => g.contacts.some((c) => c.key === key));
  return out.sort((a, b) => b.contacts.length - a.contacts.length || Math.max(...b.contacts.map((c) => c.lastSeen)) - Math.max(...a.contacts.map((c) => c.lastSeen))).slice(0, 200);
}

// ---------- merging ----------
const rankStage = (p, id) => { const i = p.stages.findIndex((s) => s.id === id); const s = p.stages[i]; return !s ? -2 : s.won ? 1000 : s.lost ? -1 : i; };
const SKIP_META = new Set(['id', 'userId', 'key', 'name', 'email', 'phone', 'tags', 'custom', 'stages', 'stagesAt', 'activities', 'unsubscribed', 'waOptOut', 'waOptPhone', 'waOptAt', 'optIn', 'optInAt', 'optInBy', 'manual', 'source', 'at', 'aiFacts', 'merged']);

// The merged contact as it would be: what's kept from whom. → { error } or { target, primary, keys, contacts, meta, kept }
function plan(u, keysIn, primaryIn) {
  const userId = u.id;
  const keys = [...new Set((Array.isArray(keysIn) ? keysIn : []).map(normKey).filter(Boolean))];
  const primary = normKey(primaryIn || keys[0] || '');
  if (primary && !keys.includes(primary)) keys.unshift(primary);
  if (keys.length < 2) return { error: 'Pick at least two contacts to merge', status: 400 };
  if (keys.length > MERGE_MAX) return { error: `Up to ${MERGE_MAX} contacts can be merged at once`, status: 400 };
  // only this seller's own contacts: anything else is simply not found here
  const found = contactsByKey(userId, keys);
  const missing = keys.filter((k) => !found[k]);
  if (missing.length) return { error: `Not found in your contacts: ${missing.slice(0, 3).join(', ')}`, status: 404 };
  const pipelines = pipelinesFor(userId);
  const order = [primary, ...keys.filter((k) => k !== primary)];
  const cs = order.map((k) => found[k]);
  const metas = order.map((k) => metaFor(userId, k));
  // orders are filed by email only, so when anyone has an email the merged contact is filed under one:
  // the primary's, else the email of the copy with the most orders
  const target = !isPhoneKey(primary) ? primary : ([...cs].filter((c) => !isPhoneKey(c.key)).sort((a, b) => b.orders - a.orders || b.ltv - a.ltv)[0]?.key || primary);
  const pick = (f) => cs.map(f).find((v) => v != null && v !== '') ?? '';
  const M = { name: pick((c) => c.name), email: isPhoneKey(target) ? pick((c) => c.meta?.email || '') : target, phone: pick((c) => c.phone) };
  // tags: everyone's; custom fields: the primary's, blanks filled from the others
  const seen = new Set();
  M.tags = metas.flatMap((m) => m?.tags || []).filter((t) => !seen.has(t.toLowerCase()) && seen.add(t.toLowerCase())).slice(0, 30);
  M.custom = {};
  for (const m of metas) for (const [k, v] of Object.entries(m?.custom || {})) if ((M.custom[k] == null || M.custom[k] === '') && v != null && v !== '') M.custom[k] = v;
  // pipeline stage: the furthest along (won beats everything, lost counts least); a tie keeps the primary's
  M.stages = {}; M.stagesAt = {};
  const stageNames = {};
  for (const p of pipelines) {
    let best = null;
    cs.forEach((c, i) => { const id = stageFor(p, metas[i], c.type === 'customer'); if (id && (!best || rankStage(p, id) > rankStage(p, best.id))) best = { id, i }; });
    if (!best) continue;
    const anySet = metas.some((m) => m?.stages?.[p.id]);
    if (anySet) { M.stages[p.id] = best.id; const at = metas[best.i]?.stagesAt?.[p.id]; if (at) M.stagesAt[p.id] = at; }
    stageNames[p.name] = p.stages.find((s) => s.id === best.id)?.name || '';
  }
  // consent is never widened: opted out anywhere = opted out; a "no" to marketing anywhere stays a no
  const out = (f) => metas.find((m) => m?.[f]);
  if (out('unsubscribed')) M.unsubscribed = true;
  const wa = out('waOptOut');
  if (wa) Object.assign(M, { waOptOut: true, waOptPhone: wa.waOptPhone || wa.phone || '', waOptAt: wa.waOptAt || Date.now() });
  const no = metas.find((m) => m?.optIn === false), yes = metas.find((m) => m?.optIn === true);
  const consent = no || yes;
  if (consent) Object.assign(M, { optIn: consent.optIn, optInAt: consent.optInAt, optInBy: consent.optInBy });
  const manual = metas.filter((m) => m?.manual).sort((a, b) => (a.at || 0) - (b.at || 0))[0];
  if (manual) Object.assign(M, { manual: true, source: manual.source, at: manual.at });
  const fs = new Set();
  M.aiFacts = metas.flatMap((m) => m?.aiFacts || []).filter((f) => f?.text && !fs.has(f.text) && fs.add(f.text)).slice(-25);
  // anything else the CRM keeps on a contact (ad touches, kit data…): the primary's, else the first copy that has it
  for (const m of metas) for (const [k, v] of Object.entries(m || {})) if (!SKIP_META.has(k) && M[k] === undefined) M[k] = v;
  M.merged = [...metas.flatMap((m) => m?.merged || [])];
  const kept = {
    key: target, name: M.name, email: M.email || '', phone: M.phone || '', tags: M.tags, custom: M.custom, stages: stageNames,
    orders: cs.reduce((s, c) => s + (c.orders || 0), 0), ltv: cs.reduce((s, c) => s + (c.ltv || 0), 0),
    unsubscribed: !!M.unsubscribed, waOptOut: !!M.waOptOut, optIn: M.optIn ?? null,
    activities: metas.reduce((s, m) => s + (m?.activities?.length || 0), 0),
  };
  return { userId, target, primary, keys: order, contacts: cs.map((c) => contactItem(c, pipelines)), metas, M, kept };
}

export function previewMerge(u, keys, primary) {
  const p = plan(u, keys, primary);
  if (p.error) return p;
  return { primary: p.primary, key: p.target, contacts: p.contacts, kept: p.kept };
}

// Every table that points at a contact, and how. Rows whose key comes from their email / phone are re-addressed.
const DERIVED = ['leads', 'abandoned', 'bookings', 'registrations']; // key from email, else phone
const BY_EMAIL = ['orders', 'access']; // key from email only
const JSON_KEY = [['msgs', '$.key'], ['bsends', '$.key'], ['vcalls', '$.key'], ['notifications', '$.ckey'], ['leadEvents', '$.ckey'], ['wamsgs', '$.ckey'], ['waconvs', '$.ckey']];
export const MERGE_TABLES = ['crm', ...DERIVED, ...BY_EMAIL, 'portals', 'students', 'runs', 'vaultLinks', 'quotes', 'payments', ...JSON_KEY.map(([t]) => t)];

export function mergeContacts(u, keysIn, primaryIn, { by = 'you' } = {}) {
  return tx(() => {
    const p = plan(u, keysIn, primaryIn);
    if (p.error) return p;
    const { userId, target, M } = p;
    const tEmail = isPhoneKey(target) ? '' : target, tPhone = isPhoneKey(target) ? target.slice(6) : '';
    const moved = Object.fromEntries(MERGE_TABLES.map((t) => [t, 0]));
    const others = p.keys.filter((k) => k !== target);
    const readdress = (x) => {
      x.mergedFrom ||= { email: x.email || '', phone: x.phone || '', at: Date.now() };
      if (tEmail) x.email = tEmail; else x.phone = tPhone;
    };
    for (const k of others) {
      for (const t of DERIVED) for (const x of T[t].all({ userId, ckey: k })) { readdress(x); T[t].put(x); moved[t]++; }
      if (!isPhoneKey(k)) {
        for (const t of BY_EMAIL) for (const x of T[t].all({ userId, ckey: k })) { readdress(x); T[t].put(x); moved[t]++; }
        // the buyer's library link and members-area login: moved when the kept contact has none (else the kept one's is used)
        for (const t of ['portals', 'students']) {
          const x = T[t].find({ userId, ckey: k });
          if (!x) continue;
          if (!T[t].exists({ userId, ckey: target })) { x.ckey = target; if (t === 'students' && tEmail) x.email = tEmail; T[t].put(x); moved[t]++; }
          else if (t === 'portals') { T.portals.del(x.id); moved[t]++; }
        }
        for (const x of T.quotes.all({ userId })) if (String(x.client?.email || '').trim().toLowerCase() === k && tEmail) { x.client = { ...x.client, email: tEmail }; T.quotes.put(x); moved.quotes++; }
        if (tEmail) moved.payments += q("UPDATE payments SET data = json_set(data, '$.buyer.email', ?) WHERE userId = ? AND lower(json_extract(data, '$.buyer.email')) = ?").run(tEmail, userId, k).changes;
      }
      for (const r of T.runs.all({ userId, key: k })) {
        r.key = target;
        r.ctx = { ...r.ctx, key: target, email: r.ctx?.email || tEmail, phone: r.ctx?.phone || M.phone || '' };
        T.runs.put(r); moved.runs++;
      }
      for (const x of T.vaultLinks.all({ userId, ckey: k })) {
        if (T.vaultLinks.exists({ userId, ckey: target, fileId: x.fileId })) T.vaultLinks.del(x.id);
        else { x.ckey = target; T.vaultLinks.put(x); }
        moved.vaultLinks++;
      }
      for (const [t, path] of JSON_KEY) moved[t] += q(`UPDATE ${t} SET data = json_set(data, '${path}', ?) WHERE userId = ? AND json_extract(data, '${path}') = ?`).run(target, userId, k).changes;
    }
    // the one CRM record: everyone's timeline in time order, with the merge itself on it
    const now = Date.now();
    const names = p.contacts.filter((c) => c.key !== target).map((c) => [c.name, c.email || c.phone || c.key].filter(Boolean).join(' · '));
    const ids = new Set();
    const activities = p.metas.flatMap((m) => m?.activities || []).filter((a) => a && !ids.has(a.id) && ids.add(a.id)).sort((a, b) => (a.at || 0) - (b.at || 0));
    activities.push({ id: uid(), at: now, type: 'merge', title: `Merged ${others.length} duplicate contact${others.length > 1 ? 's' : ''} into this one`, text: names.join('\n'), by });
    const keep = metaFor(userId, target);
    for (const k of others) moved.crm += T.crm.delWhere({ userId, key: k });
    const merged = [...M.merged, ...p.contacts.filter((c) => c.key !== target).map((c) => ({ key: c.key, name: c.name || '', email: c.email || '', phone: c.phone || '', at: now }))].slice(-50);
    const rec = { ...M, merged, activities: activities.slice(-500), id: keep?.id || uid(), userId, key: target, at: M.at || keep?.at || now };
    if (!rec.manual) delete rec.manual;
    T.crm.put(rec);
    return { ok: true, key: target, merged: others, moved: Object.fromEntries(Object.entries(moved).filter(([, n]) => n)) };
  });
}

// ---------- the API ----------
export function registerContactsMerge(app, { auth, rateLimit, isTest }) {
  const limiter = rateLimit({ windowMs: 60000, max: isTest ? 1000 : 30, key: (req) => req.user.id, message: 'Too many merges at once — please wait a minute.' });
  // ?key= → only the groups this contact is in
  app.get('/api/contacts/duplicates', auth, (req, res) => {
    const key = typeof req.query.key === 'string' ? normKey(req.query.key.slice(0, 200)) : '';
    res.json({ groups: findDuplicates(req.user, { key }) });
  });
  // { keys: [..], primary } → merged (dryRun: true → what would be kept)
  app.post('/api/contacts/merge', auth, limiter, (req, res) => {
    const b = req.body || {};
    const keys = Array.isArray(b.keys) ? b.keys.slice(0, MERGE_MAX + 5).map((k) => str(k, 200)) : [];
    if (keys.length > MERGE_MAX) return res.status(400).json({ error: `Up to ${MERGE_MAX} contacts can be merged at once` });
    const r = b.dryRun ? previewMerge(req.user, keys, str(b.primary, 200)) : mergeContacts(req.user, keys, str(b.primary, 200));
    if (r.error) return res.status(r.status || 400).json({ error: r.error });
    res.json(r);
  });
}
