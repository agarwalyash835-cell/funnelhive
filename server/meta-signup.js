// Sellers connect their own WhatsApp number through Meta Embedded Signup (the platform is a Meta Tech Provider):
// a Facebook popup in Settings → WhatsApp, then a code we exchange for a business token. Two ways in:
//  • "coexistence" — the number they already use in the WhatsApp Business app keeps working there, and the API
//    runs next to it. Never registered again; what they send from the phone comes back as smb_message_echoes,
//    their app contacts as smb_app_state_sync, and (only if they opt in) up to 6 months of chats as history.
//  • a new number — registered for the Cloud API with a PIN we generate (stored encrypted).
// The number lands in the ordinary Meta channel (messaging.js), so automations, broadcasts and templates work as
// before; the inbox, chatbots and AI agent run over Meta through the hooks in hive-wa.js. One app-level webhook
// (/api/meta/webhook, signed with the app secret) serves every seller, matched on the phone number ID.
// The owner turns it on in Admin → Platform settings; until the app details are there, sellers never see it.
import crypto from 'node:crypto';
import { T, q, hit } from './db.js';
import { encrypt, decrypt, setChannel } from './messaging.js';
import { platform, savePlatform, DEFAULTS } from './platform.js';
import { useMetaWhatsApp, waHandle, waContact, waInbox, waNumber } from './hive-wa.js';
import { appUrl } from './mail.js';

const DAY = 86400000;
const clip = (v, n) => String(v ?? '').trim().slice(0, n);
const DIGITS = /^\d{5,30}$/;
export const ES_VERSIONS = ['v5', 'v4', 'v3'];
// the webhook fields the owner subscribes the app to (App Dashboard → WhatsApp → Configuration)
export const WEBHOOK_FIELDS = ['messages', 'smb_message_echoes', 'smb_app_state_sync', 'history', 'account_update'];

// ---------- the owner's Meta app (Admin) ----------
const cfg = () => ({ ...DEFAULTS.metaSignup, ...platform().metaSignup });
const secretOf = () => decrypt(cfg().secretEnc);
export const signupReady = () => { const c = cfg(); return !!(c.appId && c.configId && c.secretEnc); };
const base = () => String(process.env.META_GRAPH_BASE || 'https://graph.facebook.com').replace(/\/+$/, '');
const ver = () => cfg().graphVersion || DEFAULTS.metaSignup.graphVersion;

// one Graph API call; errors carry Meta's message, never a token or the app secret
async function graph(method, path, { token, query, body, form } = {}) {
  const url = new URL(`${base()}/${ver()}/${path.replace(/^\/+/, '')}`);
  for (const [k, v] of Object.entries(query || {})) url.searchParams.set(k, v);
  let r;
  try {
    r = await fetch(url, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: form || (body ? JSON.stringify(body) : undefined), signal: AbortSignal.timeout(20000) });
  } catch { throw Object.assign(new Error('Couldn’t reach Meta — please try again in a minute'), { status: 502 }); }
  const d = await r.json().catch(() => ({}));
  if (r.ok && !d.error) return d;
  const e = d.error || {};
  throw Object.assign(new Error(clip(e.error_user_msg || e.error_data?.details || e.message || `HTTP ${r.status}`, 300)), { status: r.status, code: e.code });
}

export function metaSignupView() {
  const c = cfg();
  const connected = q("SELECT COUNT(*) AS n FROM users WHERE json_extract(data, '$.channels.whatsapp.es.at') IS NOT NULL").get().n;
  return { appId: c.appId, configId: c.configId, graphVersion: ver(), esVersion: c.esVersion, hasSecret: !!c.secretEnc, ready: signupReady(), verifyToken: c.verifyToken, webhookPath: '/api/meta/webhook', fields: WEBHOOK_FIELDS, connected };
}
// Admin → Platform settings → WhatsApp sign-up: the app secret is checked with Meta before it's saved
export async function saveMetaSignup(m = {}) {
  const cur = cfg();
  if (m.clear) { savePlatform((s) => { s.metaSignup = { ...DEFAULTS.metaSignup, verifyToken: cur.verifyToken }; }); return; }
  const appId = clip(m.appId ?? cur.appId, 40), configId = clip(m.configId ?? cur.configId, 40);
  const graphVersion = clip(m.graphVersion ?? cur.graphVersion, 10) || DEFAULTS.metaSignup.graphVersion;
  const esVersion = clip(m.esVersion ?? cur.esVersion, 10) || 'v5';
  if (!DIGITS.test(appId)) throw new Error('The App ID is a long number (Meta for Developers → your app → App settings → Basic)');
  if (!DIGITS.test(configId)) throw new Error('The Configuration ID is a long number (your app → Facebook Login for Business → Configurations)');
  if (!/^v\d{1,3}\.\d$/.test(graphVersion)) throw new Error('The Graph API version looks like v26.0');
  if (!ES_VERSIONS.includes(esVersion)) throw new Error(`Embedded Signup version: ${ES_VERSIONS.join(', ')}`);
  const secret = m.secret ? clip(m.secret, 200) : decrypt(cur.secretEnc);
  if (!/^[a-f0-9]{32}$/i.test(secret || '')) throw new Error('Paste the App Secret (32 letters and numbers, from App settings → Basic)');
  // an app access token (id|secret) reads the app itself: a wrong secret or ID fails here, not on a seller's sign-up
  const prev = platform().metaSignup;
  savePlatform((s) => { s.metaSignup = { ...cur, graphVersion }; }); // graph() reads the version being saved
  try { await graph('GET', appId, { query: { fields: 'id,name', access_token: `${appId}|${secret}` } }); } catch (e) {
    savePlatform((s) => { s.metaSignup = prev; });
    throw new Error(e.status === 502 ? e.message : `Meta didn’t accept this App ID and secret: ${e.message}`);
  }
  savePlatform((s) => { s.metaSignup = { appId, configId, graphVersion, esVersion, secretEnc: m.secret ? encrypt(secret) : cur.secretEnc, verifyToken: cur.verifyToken || crypto.randomBytes(18).toString('base64url') }; });
}

// ---------- a seller's number connected this way ----------
const chanOf = (u) => u?.channels?.whatsapp || null;
// in use: Meta is the provider and the number came through Embedded Signup (a pasted token has no webhook here)
const live = (u) => { const w = chanOf(u); return w?.provider !== 'hive' && w?.es?.at && w.phoneNumberId && w.tokenEnc ? { meta: true, origin: w.es.origin || '' } : null; };
const tokenOf = (u) => decrypt(chanOf(u).tokenEnc);
// the inbox's payloads are Meta's Cloud API shape, except a template: Hive's { name, language, body: [params] }
function cloudPayload(p) {
  if (p.type !== 'template' || !Array.isArray(p.template?.body)) return p;
  const t = p.template;
  return { type: 'template', template: { name: t.name, language: { code: t.language || 'en' }, ...(t.body.length ? { components: [{ type: 'body', parameters: t.body.map((x) => ({ type: 'text', text: String(x) })) }] } : {}) } };
}
const part = (t, type) => String((t?.components || []).find((x) => String(x.type).toUpperCase() === type)?.text ?? '');
useMetaWhatsApp({
  live,
  async post(u, payload, num) {
    try {
      const d = await graph('POST', `${encodeURIComponent(chanOf(u).phoneNumberId)}/messages`, { token: tokenOf(u), body: { messaging_product: 'whatsapp', recipient_type: 'individual', to: num, ...cloudPayload(payload) } });
      return { id: d.messages?.[0]?.id || null, wamid: d.messages?.[0]?.id || null };
    } catch (e) {
      if (e.code === 131047) throw new Error('More than 24 hours since this contact last messaged you — WhatsApp only allows approved templates now');
      throw new Error(`WhatsApp: ${e.message}`);
    }
  },
  async approved(u) {
    const d = await graph('GET', `${encodeURIComponent(chanOf(u).businessId)}/message_templates`, { token: tokenOf(u), query: { status: 'APPROVED', limit: '200', fields: 'name,language,category,status,components' } });
    return (d.data || []).filter((t) => String(t.status).toUpperCase() === 'APPROVED').map((t) => { const body = part(t, 'BODY'); return { name: t.name, category: t.category || '', language: t.language || 'en', vars: Math.max(0, ...[...body.matchAll(/\{\{\s*(\d+)\s*\}\}/g)].map((x) => Number(x[1]))), body }; });
  },
  async upload(u, buf, mime, filename) {
    const form = new FormData();
    form.append('messaging_product', 'whatsapp');
    form.append('type', mime);
    form.append('file', new Blob([buf], { type: mime }), filename || 'file');
    try { return String((await graph('POST', `${encodeURIComponent(chanOf(u).phoneNumberId)}/media`, { token: tokenOf(u), form })).id); } catch (e) { throw new Error(`WhatsApp couldn’t take this file: ${e.message}`); }
  },
  // a customer's file: Meta gives a short-lived link on its own servers, fetched with the same token
  async media(u, id) {
    let link;
    try { link = (await graph('GET', encodeURIComponent(id), { token: tokenOf(u) })).url; } catch { throw Object.assign(new Error('This file isn’t available any more'), { status: 404 }); }
    const host = (() => { try { return new URL(link); } catch { return null; } })();
    if (!host || !(host.origin === new URL(base()).origin || (host.protocol === 'https:' && /(^|\.)(fbsbx\.com|facebook\.com|whatsapp\.net|fbcdn\.net)$/.test(host.hostname)))) throw Object.assign(new Error('This file isn’t available any more'), { status: 404 });
    const r = await fetch(host, { headers: { Authorization: `Bearer ${tokenOf(u)}` }, signal: AbortSignal.timeout(30000) });
    if (!r.ok) throw Object.assign(new Error('This file isn’t available any more'), { status: 404 });
    return { type: r.headers.get('content-type') || 'application/octet-stream', buf: Buffer.from(await r.arrayBuffer()) };
  },
});

// the status card in Settings
function statusOf(u) {
  const w = chanOf(u);
  if (!w?.es?.at) return null;
  const h = w.es.history || null;
  return {
    display: w.es.display || '', name: w.es.name || '', coexistence: !!w.coexistence, at: w.es.at, inUse: !!live(u),
    history: h ? { state: h.declined ? 'declined' : h.progress >= 100 ? 'done' : 'importing', progress: h.progress || 0, imported: h.imported || 0, requestedAt: h.requestedAt } : null,
    // Meta allows the history request once, within 24 hours of connecting
    canImportHistory: !!w.coexistence && !h && Date.now() - w.es.at < DAY,
  };
}
const requestSync = (u, pnid, token, type) => graph('POST', `${encodeURIComponent(pnid)}/smb_app_data`, { token, body: { messaging_product: 'whatsapp', sync_type: type } }).then((d) => clip(d.request_id, 120) || 'ok');
const setEs = (userId, fn) => T.users.update(userId, (u) => {
  u.channels = { ...u.channels };
  const w = (u.channels.whatsapp = { ...(u.channels.whatsapp || {}) });
  w.es = { ...(w.es || {}) };
  fn(w.es, w);
});
// which seller a webhook is for: the phone number ID (or the WhatsApp Business account, entry.id)
function sellerFor(pnid, wabaId) {
  const by = (path, v) => v && q(`SELECT id FROM users WHERE json_extract(data, '$.channels.whatsapp.${path}') = ? AND json_extract(data, '$.channels.whatsapp.es.at') IS NOT NULL LIMIT 1`).get(String(v))?.id;
  const id = by('phoneNumberId', pnid) || by('businessId', wabaId);
  return id ? T.users.get(id) : null;
}

// ---------- the webhook ----------
// a Cloud API message → the shape hive-wa.js's handler takes (Hive's event data)
function eventData(m, name) {
  const type = clip(m.type, 20);
  const ia = m.interactive?.button_reply || m.interactive?.list_reply || null;
  const text = m.text?.body || ia?.title || m.button?.text || m[type]?.caption || (m.reaction ? m.reaction.emoji : '') || '';
  return { from: m.from, to: m.to, id: m.id, type: ia || m.button ? 'interactive' : type, text: clip(text, 4000), ...(ia ? { interactive_title: clip(ia.title, 200), interactive_id: clip(ia.id, 100) } : m.button ? { interactive_title: clip(m.button.text, 200), interactive_id: clip(m.button.payload, 100) } : {}), ...(name ? { contact_name: name } : {}), ...(!['text', 'interactive', 'button', 'location'].includes(type) && m[type] && typeof m[type] === 'object' ? { [type]: m[type] } : {}), ...(m.location ? { location: m.location } : {}) };
}
const seen = (u, id) => !!id && hit(`metawa:${u.id}:${id}`, 3 * DAY).n > 1;
// one chunk of chat history (only after the seller opted in): straight into the inbox, marked imported —
// no chatbot, AI agent, automation, rule or notification runs on it
function importHistory(u, value, ours) {
  for (const h of Array.isArray(value.history) ? value.history : []) {
    if ((h.errors || []).some((e) => Number(e.code) === 2593109)) { setEs(u.id, (es) => { es.history = { ...es.history, declined: true, progress: 100 }; }); continue; }
    let n = 0;
    for (const th of Array.isArray(h.threads) ? h.threads : []) {
      const num = waNumber(th.id);
      if (!num || ours.has(num)) continue;
      const key = waContact(u.id, num);
      const items = (Array.isArray(th.messages) ? th.messages : []).map((m) => {
        const d = eventData(m), mine = waNumber(m.from) !== num;
        return { dir: mine ? 'out' : 'in', by: mine ? 'app' : 'contact', type: d.type || 'text', text: d.text || (d.type && d.type !== 'text' ? `[${d.type}]` : ''), wamid: clip(m.id, 200), at: Number(m.timestamp) * 1000 || Date.now(), ...(mine ? { status: clip(m.history_context?.status, 20).toLowerCase() || 'sent' } : {}) };
      });
      n += waInbox()?.history?.(u, { num, key, items }) || 0;
    }
    const meta = h.metadata || {};
    setEs(u.id, (es) => { es.history = { ...es.history, imported: (es.history?.imported || 0) + n, phase: Number(meta.phase) || 0, progress: Math.max(es.history?.progress || 0, Number(meta.progress) || 0) }; });
  }
}
function handleChange(field, value = {}, entryId) {
  const md = value.metadata || {};
  const u = sellerFor(md.phone_number_id, entryId);
  if (!u) return;
  const ours = new Set([md.display_phone_number, chanOf(u).es?.display].map(waNumber).filter(Boolean));
  if (field === 'messages') {
    const names = new Map((value.contacts || []).map((c) => [String(c.wa_id), clip(c.profile?.name, 120)]));
    for (const m of value.messages || []) if (!seen(u, m.id)) waHandle(u.id, 'message.inbound', eventData(m, names.get(String(m.from))));
    for (const s of value.statuses || []) waHandle(u.id, 'message.status', { message_id: s.id, status: s.status, error: s.errors?.[0] ? { message: s.errors[0].error_data?.details || s.errors[0].title || s.errors[0].message } : undefined });
  } else if (field === 'smb_message_echoes') {
    for (const m of value.message_echoes || []) if (!seen(u, m.id)) waHandle(u.id, 'message.echo', eventData(m), { number: { display: md.display_phone_number, phone_number_id: md.phone_number_id } });
  } else if (field === 'smb_app_state_sync') {
    for (const s of value.state_sync || []) {
      const num = waNumber(s.contact?.phone_number);
      if (s.type === 'contact' && s.action !== 'remove' && num && !ours.has(num)) waContact(u.id, num, s.contact.full_name || s.contact.first_name);
    }
  } else if (field === 'history') {
    if (chanOf(u).es?.history?.requestedAt) importHistory(u, value, ours);
  }
}

export function registerMetaSignup(app, { auth, wrap, rateLimit, isTest }) {
  const limiter = rateLimit({ windowMs: 60000, max: isTest ? 1000 : 10, key: (req) => req.user.id, message: 'Please wait a minute and try again.' });
  const hookLimiter = rateLimit({ windowMs: 60000, max: isTest ? 5000 : 3000, key: () => 'meta' });

  // what the Settings card needs (never the app secret): hidden until the owner has set the app up
  app.get('/api/channels/whatsapp/signup', auth, (req, res) => {
    if (!signupReady()) return res.json({ available: false });
    const c = cfg();
    res.json({ available: true, appId: c.appId, configId: c.configId, graphVersion: ver(), esVersion: c.esVersion, connected: statusOf(req.user) });
  });

  // the popup finished: code (valid ~30 seconds) + the account and number it shared
  app.post('/api/channels/whatsapp/signup', auth, limiter, wrap(async (req, res) => {
    if (!signupReady()) return res.status(404).json({ error: 'Connecting with Facebook isn’t available yet' });
    const b = req.body || {};
    const code = clip(b.code, 2000), wabaId = clip(b.wabaId, 40);
    let pnid = clip(b.phoneNumberId, 40);
    const coexistence = !!b.coexistence;
    if (!code) return res.status(400).json({ error: 'Facebook didn’t finish connecting — please try again' });
    if (!DIGITS.test(wabaId) || (pnid && !DIGITS.test(pnid))) return res.status(400).json({ error: 'Facebook didn’t share your WhatsApp account — please try again and pick your number' });
    const c = cfg();
    const fail = (e, what) => res.status(400).json({ error: `${what}: ${e.message}` });
    let token;
    try { token = clip((await graph('GET', 'oauth/access_token', { query: { client_id: c.appId, client_secret: secretOf(), code } })).access_token, 2000); } catch (e) { return fail(e, 'Facebook didn’t accept the sign-in (it expires after 30 seconds — please try again)'); }
    if (!token) return res.status(400).json({ error: 'Facebook didn’t return access — please try again' });
    // the number: from the popup, or the account's numbers (coexistence sometimes only shares the account)
    let num = null;
    try {
      const list = (await graph('GET', `${wabaId}/phone_numbers`, { token, query: { fields: 'id,display_phone_number,verified_name,is_on_biz_app,platform_type' } })).data || [];
      num = list.find((x) => String(x.id) === pnid) || (!pnid ? list.find((x) => x.is_on_biz_app === coexistence) || list[0] : null);
    } catch (e) { if (!pnid) return fail(e, 'Couldn’t read your WhatsApp numbers'); }
    pnid = pnid || String(num?.id || '');
    if (!DIGITS.test(pnid)) return res.status(400).json({ error: 'No WhatsApp number came back from Facebook — please try again and pick your number' });
    const other = q("SELECT id FROM users WHERE json_extract(data, '$.channels.whatsapp.phoneNumberId') = ? AND id != ? AND json_extract(data, '$.channels.whatsapp.es.at') IS NOT NULL LIMIT 1").get(pnid, req.user.id);
    if (other) return res.status(409).json({ error: 'This WhatsApp number is already connected to another account here' });
    // our app receives this account's webhooks
    try { await graph('POST', `${wabaId}/subscribed_apps`, { token }); } catch (e) { return fail(e, 'Couldn’t link your WhatsApp account'); }
    // a new number is registered for the Cloud API; a WhatsApp Business app number already is (never again)
    let pinEnc = '';
    if (!coexistence) {
      const pin = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
      try { await graph('POST', `${pnid}/register`, { token, body: { messaging_product: 'whatsapp', pin } }); } catch (e) { return fail(e, 'Couldn’t switch on your number for WhatsApp messages'); }
      pinEnc = encrypt(pin);
    }
    const prev = chanOf(req.user) || {};
    const display = waNumber(num?.display_phone_number) || '';
    const es = { at: Date.now(), display, name: clip(num?.verified_name, 120), origin: String(process.env.APP_URL || appUrl(req)).replace(/\/+$/, ''), ...(pinEnc ? { pinEnc } : {}) };
    const u = setChannel(req.user.id, 'whatsapp', { ...(prev.hive ? { hive: prev.hive } : {}), provider: 'meta', phoneNumberId: pnid, businessId: wabaId, tokenEnc: encrypt(token), coexistence, es });
    // coexistence: the app's contacts come across; chat history only if the seller asked for it
    if (coexistence) {
      requestSync(u, pnid, token, 'smb_app_state_sync').then((id) => setEs(u.id, (x) => { x.contactsRequestId = id; })).catch((e) => console.error('WhatsApp contacts sync not requested:', e.message));
      if (b.importHistory) {
        try { const id = await requestSync(u, pnid, token, 'history'); setEs(u.id, (x) => { x.history = { requestedAt: Date.now(), requestId: id, progress: 0, imported: 0 }; }); } catch (e) { console.error('WhatsApp history sync not requested:', e.message); }
      }
    }
    res.json({ ok: true, connected: statusOf(T.users.get(req.user.id)) });
  }));

  // "Import my last 6 months of chats" after connecting (Meta allows it once, within 24 hours)
  app.post('/api/channels/whatsapp/signup/history', auth, limiter, wrap(async (req, res) => {
    const st = statusOf(req.user);
    if (!st?.canImportHistory) return res.status(400).json({ error: st?.history ? 'Your chats are already being imported' : 'Chats can only be imported within 24 hours of connecting a WhatsApp Business app number' });
    const w = chanOf(req.user);
    try { const id = await requestSync(req.user, w.phoneNumberId, tokenOf(req.user), 'history'); setEs(req.user.id, (x) => { x.history = { requestedAt: Date.now(), requestId: id, progress: 0, imported: 0 }; }); } catch (e) { return res.status(400).json({ error: `Meta didn’t start the import: ${e.message}` }); }
    res.json({ ok: true, connected: statusOf(T.users.get(req.user.id)) });
  }));

  // Meta checks the URL once when the owner saves it in the App Dashboard
  app.get('/api/meta/webhook', (req, res) => {
    const tok = cfg().verifyToken;
    if (req.query['hub.mode'] === 'subscribe' && tok && req.query['hub.verify_token'] === tok) return res.type('text/plain').send(String(req.query['hub.challenge'] || ''));
    res.status(403).send('Forbidden');
  });
  // events for every connected seller: signed with the app secret (HMAC-SHA256 of the raw body), ACKed at once
  app.post('/api/meta/webhook', hookLimiter, (req, res) => {
    const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from('');
    const secret = secretOf();
    const given = String(req.headers['x-hub-signature-256'] || '').replace(/^sha256=/i, '').toLowerCase();
    const want = secret ? crypto.createHmac('sha256', secret).update(raw).digest('hex') : '';
    if (!secret || given.length !== want.length || !crypto.timingSafeEqual(Buffer.from(given), Buffer.from(want))) return res.status(401).json({ error: 'Bad signature' });
    let body;
    try { body = JSON.parse(raw.toString('utf8')); } catch { return res.status(400).json({ error: 'Bad JSON' }); }
    for (const e of Array.isArray(body.entry) ? body.entry : []) {
      for (const ch of Array.isArray(e.changes) ? e.changes : []) {
        try { handleChange(String(ch.field || ''), ch.value || {}, e.id); } catch (err) { console.error('Meta WhatsApp webhook failed', err.message); }
      }
    }
    res.sendStatus(200);
  });
}
