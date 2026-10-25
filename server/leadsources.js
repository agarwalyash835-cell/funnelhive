// Lead sources: enquiries from IndiaMART, JustDial, Google Ads lead forms and the listing portals (99acres,
// MagicBricks, Housing.com, NoBroker, Sulekha, TradeIndia, Shiksha, CollegeDunia — by forwarded email) land in
// the CRM by themselves: the contact is made (or found), the enquiry goes on its timeline with the source as a tag,
// the seller is told, and "new lead" automations start (instant WhatsApp / email reply, assignment…).
//
// Each account gets private receiving addresses (a URL token and an email address); the same enquiry delivered
// twice is skipped (by the source's own id). IndiaMART's key is stored encrypted and never shown again.
import crypto from 'node:crypto';
import { T, uid, contactKey } from './db.js';
import { ensureMeta, logActivity, metaFor } from './crm.js';
import { fire } from './automations.js';
import { notify } from './notify.js';
import { aiEnabled, aiJson } from './ai.js';
import { encrypt, decrypt } from './messaging.js';

export const SOURCES = {
  indiamart: 'IndiaMART', justdial: 'JustDial', google_ads: 'Google Ads lead form',
  '99acres': '99acres', magicbricks: 'MagicBricks', housing: 'Housing.com', nobroker: 'NoBroker', sulekha: 'Sulekha',
  tradeindia: 'TradeIndia', shiksha: 'Shiksha', collegedunia: 'CollegeDunia', email: 'Forwarded email',
};
// the portals whose enquiry emails can be forwarded in (by sender domain)
export const PORTALS = [
  ['99acres', /99acres\.com/i], ['magicbricks', /magicbricks\.com/i], ['housing', /housing\.com/i], ['nobroker', /nobroker\.(in|com)/i],
  ['sulekha', /sulekha\.(com|in)/i], ['tradeindia', /tradeindia\.com/i], ['shiksha', /shiksha\.com/i], ['collegedunia', /collegedunia\.com/i],
  ['indiamart', /indiamart\.com/i], ['justdial', /justdial\.com/i],
];
const INBOUND_DOMAIN = () => (process.env.INBOUND_EMAIL_DOMAIN || '').toLowerCase();
const str = (v, n = 200) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

// Indian mobiles as 10 digits (how checkout and forms keep them); other countries as +digits
export function normPhone(v) {
  const d = String(v || '').replace(/\D/g, '');
  if (d.length === 10 && /^[6-9]/.test(d)) return d;
  if (d.length === 12 && d.startsWith('91') && /^[6-9]/.test(d.slice(2))) return d.slice(2);
  if (d.length === 11 && d.startsWith('0') && /^[6-9]/.test(d.slice(1))) return d.slice(1);
  return d.length >= 8 && d.length <= 15 ? `+${d}` : '';
}
const cleanEmail = (v) => { const e = str(v, 200).toLowerCase(); return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? e : ''; };

// ---------- the account's addresses ----------
// leadTokens: a URL token → the account (kind 'url'), an email id → the account (kind 'email'), and one row per
// account with an IndiaMART key (kind 'indiamart', for the pull job)
export function addressesFor(userId) {
  const u = T.users.get(userId);
  let ls = u.leadSources || {};
  if (!ls.token || !ls.emailId) {
    ls = { ...ls, token: ls.token || crypto.randomBytes(18).toString('hex'), emailId: ls.emailId || crypto.randomBytes(5).toString('hex'), googleKey: ls.googleKey || crypto.randomBytes(12).toString('hex') };
    T.users.update(userId, (x) => { x.leadSources = { ...(x.leadSources || {}), ...ls }; });
    T.leadTokens.put({ id: ls.token, userId, kind: 'url' });
    T.leadTokens.put({ id: `leads-${ls.emailId}`, userId, kind: 'email' });
  }
  return ls;
}
const ownerOf = (id, kind) => { const r = T.leadTokens.get(String(id || '').toLowerCase()); return r && r.kind === kind ? r.userId : null; };

// ---------- one enquiry into the CRM ----------
// lead: { source, extId?, name, email, phone, city?, company?, message?, product?, test? } → what happened
export function ingest(userId, lead) {
  const source = SOURCES[lead.source] ? lead.source : 'email', label = SOURCES[source];
  const evId = lead.extId ? `${userId}:${source}:${str(lead.extId, 80)}` : `${userId}:${source}:${uid()}`;
  if (lead.extId && T.leadEvents.get(evId)) return { duplicate: true };
  const email = cleanEmail(lead.email), phone = normPhone(lead.phone), name = str(lead.name, 120);
  const details = [['Name', name], ['Phone', phone], ['Email', email], ['Company', str(lead.company, 120)], ['City', str(lead.city, 80)], ['Interested in', str(lead.product, 200)], ['Message', str(lead.message, 1500)]].filter(([, v]) => v);
  const summary = str(lead.product || lead.message, 140);
  if (!email && !phone) {
    T.leadEvents.insert({ id: evId, userId, at: Date.now(), source, name, summary, status: 'no-contact', test: !!lead.test });
    return { skipped: 'no phone or email in the enquiry' };
  }
  const key = contactKey(email, phone);
  const known = !!metaFor(userId, key) || T.leads.exists({ userId, ckey: key }) || T.orders.exists({ userId, ckey: key });
  const m = ensureMeta(userId, key);
  if (!known) Object.assign(m, { manual: true, source: `lead:${source}`, name: m.name || name, email: m.email || email, phone: m.phone || phone, at: m.at || Date.now() });
  else Object.assign(m, { name: m.name || name, email: m.email || email, phone: m.phone || phone });
  m.tags = [...new Set([...(m.tags || []), label, ...(lead.test ? ['test lead'] : [])])].slice(0, 30);
  T.crm.put(m);
  logActivity(userId, key, { type: 'note', title: `${lead.test ? 'Test enquiry' : 'New enquiry'} from ${label}`, text: details.map(([k, v]) => `${k}: ${v}`).join('\n') });
  notify(userId, { kind: 'lead', title: `${lead.test ? 'Test lead' : 'New lead'} from ${label} · ${name || phone || email}`, body: summary || [phone, email].filter(Boolean).join(' · '), link: `/contacts/${encodeURIComponent(key)}`, ckey: key });
  // a real, new contact starts the "new lead" automations (a returning one is just noted on its timeline)
  if (!known && !lead.test) fire(userId, 'lead', { email, phone, name, source: label });
  T.leadEvents.insert({ id: evId, userId, at: Date.now(), source, name, phone, email, ckey: key, summary, status: known ? 'existing' : 'new', test: !!lead.test });
  return { ok: true, key, new: !known };
}

// ---------- what each source sends ----------
const pickCI = (o, ...names) => { const ks = Object.keys(o || {}); for (const n of names) { const k = ks.find((x) => x.toLowerCase() === n.toLowerCase()); if (k && o[k] != null && o[k] !== '') return o[k]; } return ''; };
// IndiaMART Lead Manager (Push API body, or one row of the Pull API)
export function fromIndiaMart(r) {
  const box = r?.body?.RESPONSE ? r.body : r; // the push example sometimes arrives wrapped in its request description
  const x = box?.RESPONSE && !Array.isArray(box.RESPONSE) ? box.RESPONSE : box;
  return {
    source: 'indiamart', extId: pickCI(x, 'UNIQUE_QUERY_ID', 'QUERY_ID'), name: pickCI(x, 'SENDER_NAME'), phone: pickCI(x, 'SENDER_MOBILE', 'SENDER_PHONE', 'SENDER_MOBILE_ALT'),
    email: pickCI(x, 'SENDER_EMAIL', 'SENDER_EMAIL_ALT'), company: pickCI(x, 'SENDER_COMPANY'), city: [pickCI(x, 'SENDER_CITY'), pickCI(x, 'SENDER_STATE')].filter(Boolean).join(', '),
    product: pickCI(x, 'QUERY_PRODUCT_NAME', 'SUBJECT', 'QUERY_MCAT_NAME'), message: pickCI(x, 'QUERY_MESSAGE'),
  };
}
// JustDial's lead push (posted, or sent as query parameters)
export function fromJustDial(x) {
  return {
    source: 'justdial', extId: pickCI(x, 'leadid', 'lead_id', 'id'), name: [pickCI(x, 'prefix'), pickCI(x, 'name', 'customer_name')].filter(Boolean).join(' '),
    phone: pickCI(x, 'mobile', 'phone', 'mobile_no'), email: pickCI(x, 'email'), company: pickCI(x, 'company'),
    city: [pickCI(x, 'area', 'brancharea'), pickCI(x, 'city')].filter(Boolean).join(', '), product: pickCI(x, 'category', 'service'), message: pickCI(x, 'requirement', 'message', 'remarks'),
  };
}
// Google Ads lead form webhook: user_column_data [{ column_id, string_value }]
export function fromGoogle(b) {
  const col = {};
  for (const c of b?.user_column_data || []) col[String(c.column_id || c.column_name || '').toUpperCase()] = c.string_value;
  const extra = Object.entries(col).filter(([k]) => !['FULL_NAME', 'FIRST_NAME', 'LAST_NAME', 'EMAIL', 'PHONE_NUMBER', 'CITY', 'COMPANY_NAME'].includes(k)).map(([k, v]) => `${k.toLowerCase().replace(/_/g, ' ')}: ${v}`);
  return {
    source: 'google_ads', extId: b?.lead_id, name: col.FULL_NAME || [col.FIRST_NAME, col.LAST_NAME].filter(Boolean).join(' '), phone: col.PHONE_NUMBER, email: col.EMAIL,
    city: col.CITY, company: col.COMPANY_NAME, message: extra.join('\n'), product: b?.campaign_id ? `Campaign ${b.campaign_id}` : '', test: !!b?.is_test,
  };
}

// ---------- forwarded emails (listing portals) ----------
const htmlText = (h) => String(h || '').replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<br\s*\/?>|<\/(p|div|tr|li|h\d)>/gi, '\n').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();
const portalOf = (from, subject, text) => (PORTALS.find(([, re]) => re.test(from)) || PORTALS.find(([, re]) => re.test(`${subject}\n${text.slice(0, 2000)}`)) || ['email'])[0];
// labelled fields ("Name: …", "Mobile: …") — what most portal emails carry
function labelled(text) {
  const get = (re) => (re.exec(text)?.[1] || '').trim();
  return {
    name: get(/(?:^|\n)\s*(?:name|customer name|buyer name|client name|student name|contact person)\s*[:\-–]\s*([^\n]{2,80})/i),
    phone: get(/(?:mobile|phone|contact(?: no\.?| number)?|mob\.?)\s*(?:no\.?|number)?\s*[:\-–]\s*(\+?[\d\s\-()]{10,18})/i),
    email: get(/(?:e-?mail(?: id| address)?)\s*[:\-–]\s*([^\s<>"]+@[^\s<>"]+\.[a-z]{2,})/i),
    city: get(/(?:^|\n)\s*(?:city|location|locality)\s*[:\-–]\s*([^\n]{2,60})/i),
    product: get(/(?:^|\n)\s*(?:property|project|listing|requirement|course|product|service|interested in|looking for)\s*[:\-–]\s*([^\n]{2,160})/i),
  };
}
// Gmail asks the address to confirm forwarding first: the seller gets the code / link in their bell
function gmailConfirm(userId, from, text) {
  if (!/forwarding-noreply@google\.com/i.test(from)) return false;
  const code = /confirmation code:\s*(\d{6,})/i.exec(text)?.[1], link = /(https:\/\/mail(?:-settings)?\.google\.com\/mail\/[^\s<>"]+)/i.exec(text)?.[1];
  notify(userId, { kind: 'lead', title: `Gmail forwarding: confirm with code ${code || '(see the email)'}`, body: link ? `Or open this link to confirm: ${link}` : 'Paste the code in Gmail → Settings → Forwarding to start forwarding portal enquiries here.', link: '/settings#lead-sources' });
  T.users.update(userId, (x) => { x.leadSources = { ...(x.leadSources || {}), gmailCode: code || null, gmailLink: link || null, gmailAt: Date.now() }; });
  return true;
}
// one forwarded email → a lead (AI reads it when it's switched on; labelled fields otherwise)
export async function ingestEmail({ to, from = '', subject = '', text = '', html = '', messageId = '' }) {
  const local = String(to || '').toLowerCase().split('@')[0];
  const userId = ownerOf(local, 'email');
  if (!userId) return { skipped: 'unknown address' };
  const body = (text || htmlText(html)).slice(0, 12000);
  if (gmailConfirm(userId, from, body)) return { confirmation: true };
  const u = T.users.get(userId), own = [u?.email, u?.settings?.supportWhatsapp].map((x) => String(x || '').toLowerCase());
  const portal = portalOf(from, subject, body);
  let got = labelled(body);
  if (aiEnabled() && (!got.phone && !got.email || !got.name)) {
    try {
      const j = await aiJson('You read enquiry emails that property, listing and business portals send to a seller, and pull out the BUYER who enquired (never the portal, never the seller). Reply with JSON only: {"isLead":true|false,"name":"","phone":"","email":"","city":"","interest":"what they asked about","message":"their message"}. Empty strings for anything not in the email. isLead=false for newsletters, invoices, password or account emails.',
        `From: ${from}\nSubject: ${subject}\n\n${body.slice(0, 6000)}`);
      if (j && j.isLead === false) { T.leadEvents.insert({ id: `${userId}:email:${uid()}`, userId, at: Date.now(), source: portal, name: '', summary: str(subject, 140), status: 'not-a-lead' }); return { skipped: 'not an enquiry' }; }
      got = { name: got.name || j?.name, phone: got.phone || j?.phone, email: got.email || j?.email, city: got.city || j?.city, product: got.product || j?.interest, message: j?.message || '' };
    } catch { /* fall back to the labelled fields */ }
  }
  // the seller's own email / number in a signature is never the lead
  if (own.includes(String(got.email || '').toLowerCase())) got.email = '';
  if (got.phone && own.some((o) => o && normPhone(o) === normPhone(got.phone))) got.phone = '';
  return ingest(userId, { source: portal, extId: messageId || undefined, ...got, message: got.message || str(subject, 300) });
}

// ---------- IndiaMART: pulled every 15 minutes with the seller's Pull API key (paid sellers); times are IST ----------
// (format 01-Jan-202209:00:00; one call per 5 minutes at most; a key unused for 7 days expires — the job keeps it alive)
const IST = 5.5 * 3600000;
const imTime = (ms) => { const d = new Date(ms + IST), M = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']; const p = (n) => String(n).padStart(2, '0'); return `${p(d.getUTCDate())}-${M[d.getUTCMonth()]}-${d.getUTCFullYear()}${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`; };
const IM_URL = () => process.env.INDIAMART_API_URL || 'https://mapi.indiamart.com/wservce/crm/crmListing/v2/';
export async function pullIndiaMart(userId, { key, since } = {}) {
  const u = T.users.get(userId), im = u?.leadSources?.indiamart || {};
  const k = key || decrypt(im.key);
  if (!k) return { error: 'No IndiaMART key' };
  // IndiaMART's advice: start 5 minutes before the last pull ended (repeats are skipped by their id); at most 7 days
  const end = Date.now(), start = Math.max(since ?? (im.lastPull ? im.lastPull - 5 * 60000 : end - 24 * 3600000), end - 7 * 24 * 3600000 + 60000);
  const url = `${IM_URL()}?glusr_crm_key=${encodeURIComponent(k)}&start_time=${encodeURIComponent(imTime(start))}&end_time=${encodeURIComponent(imTime(end))}`;
  let d;
  try { d = await (await fetch(url, { signal: AbortSignal.timeout(30000) })).json(); } catch (e) { return { error: `IndiaMART didn’t answer (${e.message})` }; }
  const code = Number(d?.CODE);
  if (code === 200 || code === 204) {
    const rows = Array.isArray(d.RESPONSE) ? d.RESPONSE : [];
    let added = 0;
    for (const r of rows) if (ingest(userId, fromIndiaMart(r)).ok) added++;
    return { ok: true, added, total: rows.length, until: end };
  }
  return { error: d?.MESSAGE || `IndiaMART said ${code || 'no'} (check the key)`, code };
}
export async function indiaMartJob() {
  for (const r of T.leadTokens.all({ kind: 'indiamart' })) {
    const u = T.users.get(r.userId);
    if (!u?.leadSources?.indiamart?.key) { T.leadTokens.del(r.id); continue; }
    const out = await pullIndiaMart(r.userId).catch((e) => ({ error: e.message }));
    T.users.update(r.userId, (x) => { const im = x.leadSources.indiamart; if (out.ok) { im.lastPull = out.until; im.lastError = null; } else if (out.code !== 429) im.lastError = out.error; im.checkedAt = Date.now(); });
  }
}

// ---------- routes ----------
export function registerLeadSources(app, { auth, wrap, rateLimit, isTest, appUrl }) {
  const view = (req) => {
    const ls = addressesFor(req.user.id), base = `${appUrl(req)}/api/leads/in/${ls.token}`, im = T.users.get(req.user.id).leadSources?.indiamart || null;
    const since = Date.now() - 30 * 86400000, events = T.leadEvents.all({ userId: req.user.id, at: { gte: since } }, { order: 'at', desc: true });
    const stats = {};
    for (const e of events) { const s = stats[e.source] ||= { count: 0, last: 0 }; if (!e.test && ['new', 'existing'].includes(e.status)) s.count++; s.last = Math.max(s.last, e.at); }
    const dom = INBOUND_DOMAIN();
    return {
      indiamart: { pushUrl: `${base}/indiamart`, connected: !!im?.key, keyHint: im?.keyHint || null, lastPull: im?.lastPull || null, lastError: im?.lastError || null },
      justdial: { url: `${base}/justdial` },
      google: { url: `${base}/google`, key: ls.googleKey },
      email: { address: dom ? `leads-${ls.emailId}@${dom}` : null, portals: PORTALS.filter(([p]) => !['indiamart', 'justdial'].includes(p)).map(([p]) => SOURCES[p]), gmailCode: ls.gmailCode || null, gmailLink: ls.gmailLink || null },
      stats, recent: events.slice(0, 25).map(({ userId, ...e }) => ({ ...e, label: SOURCES[e.source] || e.source })),
    };
  };
  const ownerOnly = (req, res) => { if (req.actor && !['admin', 'agency'].includes(req.role)) { res.status(403).json({ error: 'Only the account owner or an admin can change lead sources' }); return false; } return true; };
  app.get('/api/lead-sources', auth, (req, res) => res.json(view(req)));
  // IndiaMART: the CRM key from seller.indiamart.com → Lead Manager → CRM integration; checked with one pull first
  app.put('/api/lead-sources/indiamart', auth, wrap(async (req, res) => {
    if (!ownerOnly(req, res)) return;
    const key = str(req.body?.key, 200);
    if (!key) return res.status(400).json({ error: 'Paste your IndiaMART CRM key' });
    const r = await pullIndiaMart(req.user.id, { key, since: Date.now() - 24 * 3600000 });
    if (r.error && r.code !== 429) return res.status(400).json({ error: `IndiaMART didn’t accept that key: ${r.error}` });
    T.users.update(req.user.id, (x) => { x.leadSources = { ...(x.leadSources || {}), indiamart: { key: encrypt(key), keyHint: `…${key.slice(-4)}`, lastPull: r.until || Date.now(), lastError: null, since: Date.now() } }; });
    T.leadTokens.put({ id: `im:${req.user.id}`, userId: req.user.id, kind: 'indiamart' });
    res.json({ ...view(req), pulled: r.added || 0 });
  }));
  app.delete('/api/lead-sources/indiamart', auth, (req, res) => {
    if (!ownerOnly(req, res)) return;
    T.users.update(req.user.id, (x) => { if (x.leadSources) delete x.leadSources.indiamart; });
    T.leadTokens.del(`im:${req.user.id}`);
    res.json(view(req));
  });
  // new addresses (the old URLs, key and email address stop working)
  app.post('/api/lead-sources/rotate', auth, (req, res) => {
    if (!ownerOnly(req, res)) return;
    const ls = T.users.get(req.user.id).leadSources || {};
    for (const id of [ls.token, ls.emailId && `leads-${ls.emailId}`]) if (id) T.leadTokens.del(id);
    T.users.update(req.user.id, (x) => { x.leadSources = { ...(x.leadSources || {}), token: null, emailId: null, googleKey: null }; });
    res.json(view(req));
  });
  // a sample enquiry through the same path, so the seller sees where leads land
  const SAMPLE = {
    indiamart: { UNIQUE_QUERY_ID: '', SENDER_NAME: 'Ramesh Kumar', SENDER_MOBILE: '+91-9876500001', SENDER_EMAIL: 'ramesh.test@example.com', SENDER_COMPANY: 'Kumar Traders', SENDER_CITY: 'Jaipur', SENDER_STATE: 'Rajasthan', QUERY_PRODUCT_NAME: 'Your product', QUERY_MESSAGE: 'Need a quotation for 100 units.' },
    justdial: { leadid: '', prefix: 'Ms', name: 'Priya Sharma', mobile: '9876500002', email: 'priya.test@example.com', category: 'Your service', area: 'Andheri West', city: 'Mumbai' },
    google_ads: { lead_id: '', is_test: true, user_column_data: [{ column_id: 'FULL_NAME', string_value: 'Arjun Mehta' }, { column_id: 'PHONE_NUMBER', string_value: '+919876500003' }, { column_id: 'EMAIL', string_value: 'arjun.test@example.com' }, { column_id: 'CITY', string_value: 'Pune' }] },
  };
  const PARSE = { indiamart: fromIndiaMart, justdial: fromJustDial, google_ads: fromGoogle };
  app.post('/api/lead-sources/test/:source', auth, (req, res) => {
    const s = req.params.source;
    if (!SAMPLE[s]) return res.status(404).json({ error: 'Unknown source' });
    const sample = structuredClone(SAMPLE[s]), id = `test-${uid()}`;
    if (s === 'indiamart') sample.UNIQUE_QUERY_ID = id; else if (s === 'justdial') sample.leadid = id; else sample.lead_id = id;
    res.json(ingest(req.user.id, { ...PARSE[s](sample), test: true }));
  });

  // ---------- receivers (no login: the token in the address is the key) ----------
  const inLimiter = rateLimit({ windowMs: 60000, max: isTest ? 5000 : 240, key: (req) => req.params.token });
  const receive = (req, res) => {
    const userId = ownerOf(req.params.token, 'url');
    if (!userId) return res.status(404).json({ error: 'Unknown address' });
    const b = { ...(req.query || {}), ...(req.body && typeof req.body === 'object' ? req.body : {}) };
    const s = req.params.source;
    let r;
    if (s === 'indiamart') r = ingest(userId, fromIndiaMart(b));
    else if (s === 'justdial') r = ingest(userId, fromJustDial(b));
    else if (s === 'google') {
      const key = T.users.get(userId)?.leadSources?.googleKey;
      if (!key || String(b.google_key || '') !== key) return res.status(403).json({ error: 'Wrong key' });
      r = ingest(userId, fromGoogle(b));
    } else return res.status(404).json({ error: 'Unknown source' });
    // IndiaMART and Google only need a 200; an enquiry without contact details is still accepted (and logged)
    res.json(s === 'indiamart' ? { CODE: 200, STATUS: 'SUCCESS' } : { ok: true, ...(r.duplicate ? { duplicate: true } : {}) });
  };
  app.post('/api/leads/in/:token/:source', inLimiter, receive);
  app.get('/api/leads/in/:token/:source', inLimiter, receive); // JustDial can send its leads as a GET with parameters
}

// ---------- the mail receiver for forwarded portal emails (one app process runs it) ----------
// Only takes mail for leads-…@INBOUND_EMAIL_DOMAIN addresses that exist; never sends or relays anything.
export async function startMailReceiver(port = Number(process.env.INBOUND_SMTP_PORT)) {
  const dom = INBOUND_DOMAIN();
  if (!port || !dom) return null;
  const { SMTPServer } = await import('smtp-server');
  const { simpleParser } = await import('mailparser');
  const srv = new SMTPServer({
    authOptional: true, disabledCommands: ['AUTH', 'STARTTLS'], size: 2 * 1024 * 1024, banner: 'FunnelHive lead inbox', logger: false,
    onRcptTo(addr, session, cb) {
      const [local, d] = String(addr.address || '').toLowerCase().split('@');
      if (d !== dom || !ownerOf(local, 'email')) return cb(Object.assign(new Error('No such mailbox'), { responseCode: 550 }));
      cb();
    },
    onData(stream, session, cb) {
      simpleParser(stream, { maxHtmlLengthToParse: 500000 }).then(async (mail) => {
        if (stream.sizeExceeded) return cb(Object.assign(new Error('Message too large'), { responseCode: 552 }));
        for (const r of session.envelope.rcptTo) {
          await ingestEmail({ to: r.address, from: mail.from?.text || session.envelope.mailFrom?.address || '', subject: mail.subject || '', text: mail.text || '', html: mail.html || '', messageId: mail.messageId || '' }).catch((e) => console.error('lead email failed', e.message));
        }
        cb();
      }).catch((e) => cb(e));
    },
  });
  srv.on('error', (e) => console.error('lead inbox:', e.message));
  await new Promise((r) => srv.listen(port, r));
  console.log(`Lead inbox: receiving mail for *@${dom} on :${port}`);
  return srv;
}
