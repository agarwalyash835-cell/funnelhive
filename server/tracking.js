// Attribution and server-side conversions.
//  - Attribution: where a lead or buyer came from (UTM tags, Meta/Google click ids, referrer, landing page),
//    captured by the browser and stored on every lead and order.
//  - Server-side conversions: Meta Conversions API and GA4 Measurement Protocol. They report what ad blockers
//    and closed tabs hide from the browser pixel. Each event carries the same id as the browser event
//    (Meta event_id / GA4 transaction_id), so the platforms count it once.
// Events go through a persisted queue with retries, like webhooks.
import crypto from 'node:crypto';
import { T, q, uid, JOBS, contactKey } from './db.js';
import { encrypt, decrypt, setChannel } from './messaging.js';

const META = () => (process.env.META_GRAPH_URL || 'https://graph.facebook.com/v21.0').replace(/\/$/, '');
const GA4 = () => process.env.GA4_MP_URL || 'https://www.google-analytics.com/mp/collect';
const SCALE = Number(process.env.WEBHOOK_RETRY_SCALE || 1);
const BACKOFF = [0, 60e3, 300e3, 1800e3, 7200e3, 6 * 3600e3].map((ms) => ms * SCALE);
const KEEP = 300; // log entries kept per seller

// ---------- attribution ----------
export const ATTR_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'fbclid', 'gclid', 'ref', 'landing'];
export function cleanAttr(a) {
  if (!a || typeof a !== 'object') return undefined;
  const out = {};
  for (const k of ATTR_KEYS) {
    const v = String(a[k] ?? '').trim().replace(/[\u0000-\u001f]/g, '').slice(0, k === 'fbclid' || k === 'gclid' ? 400 : 160);
    if (v) out[k] = k.startsWith('utm_') ? v.toLowerCase() : v;
  }
  return Object.keys(out).length ? out : undefined;
}
// Browser identifiers the ad platforms match on (never shown to anyone): Meta _fbp/_fbc cookies, the GA client id
export function cleanTk(tk, req) {
  const t = tk && typeof tk === 'object' ? tk : {};
  const out = {
    fbp: /^fb\.\d\.\d{10,16}\.\d{1,24}$/.test(t.fbp || '') ? t.fbp : undefined,
    fbc: /^fb\.\d\.\d{10,16}\.[\w-]{10,400}$/.test(t.fbc || '') ? t.fbc : undefined,
    ga: /^\d{4,12}\.\d{6,12}$/.test(t.ga || '') ? t.ga : undefined,
    url: /^https?:\/\/[^\s"'<>]{3,500}$/.test(t.url || '') ? t.url : undefined,
    ip: req?.ip || undefined,
    ua: String(req?.headers?.['user-agent'] || '').slice(0, 400) || undefined,
    consent: t.consent === false ? false : undefined, // declined on the consent banner
  };
  for (const k of Object.keys(out)) if (out[k] === undefined) delete out[k];
  return out;
}
export const safeEventId = (v) => (/^[\w.:-]{6,80}$/.test(String(v || '')) ? String(v) : null);

// ---------- seller settings (tokens are stored encrypted, never sent to browsers) ----------
export function capiStatus(u) {
  const c = u?.channels?.capi || {};
  return { metaToken: !!c.metaTokenEnc, metaTestCode: c.metaTestCode || '', ga4Secret: !!c.ga4SecretEnc, pixel: u?.settings?.tracking?.fbPixel || '', ga4: u?.settings?.tracking?.ga4 || '' };
}
const creds = (u) => {
  const c = u?.channels?.capi || {}, t = u?.settings?.tracking || {};
  return {
    meta: t.fbPixel && c.metaTokenEnc ? { pixel: t.fbPixel, token: decrypt(c.metaTokenEnc), test: c.metaTestCode || '' } : null,
    ga4: t.ga4 && c.ga4SecretEnc ? { id: t.ga4, secret: decrypt(c.ga4SecretEnc) } : null,
  };
};

// ---------- building events ----------
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const phoneDigits = (p) => { const d = String(p || '').replace(/\D/g, '').replace(/^0+/, ''); return d.length === 10 ? `91${d}` : d.length >= 11 ? d : ''; };
function metaUser(b, tk) {
  const [fn, ...rest] = String(b.name || '').trim().toLowerCase().split(/\s+/);
  const ln = rest.pop();
  const u = { country: [sha('in')] };
  if (b.email) u.em = [sha(String(b.email).trim().toLowerCase())];
  if (phoneDigits(b.phone)) u.ph = [sha(phoneDigits(b.phone))];
  if (fn) u.fn = [sha(fn)];
  if (ln) u.ln = [sha(ln)];
  const key = contactKey(b.email, b.phone);
  if (key) u.external_id = [sha(key)];
  if (tk?.ip) u.client_ip_address = tk.ip;
  if (tk?.ua) u.client_user_agent = tk.ua;
  if (tk?.fbp) u.fbp = tk.fbp;
  if (tk?.fbc) u.fbc = tk.fbc;
  return u;
}
// GA4 needs the browser's client id to join the hit to the session; without one, a stable id per buyer
const gaClient = (tk, b) => tk?.ga || `${parseInt(sha(contactKey(b.email, b.phone) || 'anon').slice(0, 8), 16)}.${Math.floor(Date.now() / 1000)}`;

const META_EVENTS = new Set(['Purchase', 'Lead', 'InitiateCheckout', 'CompleteRegistration']);
// event: { name, id, value, items: [{ id, name, price }], buyer: { email, phone, name }, tk, orderId }
export function trackServer(userId, event) {
  if (event.tk?.consent === false) return []; // the visitor declined tracking on the consent banner
  const u = T.users.get(userId);
  const c = creds(u);
  if (!c.meta && !c.ga4) return [];
  const at = Date.now();
  const rows = [];
  if (c.meta && META_EVENTS.has(event.name)) {
    const custom = event.value != null ? { value: Number(event.value) || 0, currency: event.currency || 'INR' } : {};
    if (event.items?.length) Object.assign(custom, { content_type: 'product', content_ids: event.items.map((i) => i.id), contents: event.items.map((i) => ({ id: i.id, quantity: 1, item_price: Number(i.price) || 0 })), content_name: event.items.map((i) => i.name).join(', ').slice(0, 200), num_items: event.items.length });
    if (event.orderId) custom.order_id = event.orderId;
    rows.push({ provider: 'meta', event: event.name, body: { data: [{ event_name: event.name, event_time: Math.floor(at / 1000), event_id: event.id, action_source: 'website', ...(event.tk?.url ? { event_source_url: event.tk.url } : {}), user_data: metaUser(event.buyer || {}, event.tk), custom_data: custom }], ...(c.meta.test ? { test_event_code: c.meta.test } : {}) } });
  }
  if (c.ga4 && (event.name === 'Purchase' || event.name === 'Refund')) {
    const items = (event.items || []).map((i) => ({ item_id: i.id, item_name: i.name, price: Number(i.price) || 0, quantity: 1 }));
    rows.push({ provider: 'ga4', event: event.name, body: { client_id: gaClient(event.tk, event.buyer || {}), timestamp_micros: at * 1000, non_personalized_ads: false, events: [{ name: event.name === 'Refund' ? 'refund' : 'purchase', params: { transaction_id: event.id, value: Number(event.value) || 0, currency: event.currency || 'INR', items, engagement_time_msec: 1 } }] } });
  }
  return rows.map((r) => {
    const d = T.conversions.insert({ id: uid(), userId, ...r, eventId: event.id, status: 'pending', attempts: 0, nextAt: at, at });
    attempt(d.id);
    return d;
  }).concat(prune(userId));
}
function prune(userId) { q(`DELETE FROM conversions WHERE id IN (SELECT id FROM conversions WHERE userId = ? AND status != 'pending' ORDER BY at DESC LIMIT -1 OFFSET ${KEEP})`).run(userId); return []; }

// ---------- sending ----------
const inFlight = new Set();
const claim = (id) => q("UPDATE conversions SET nextAt = ? WHERE id = ? AND status = 'pending' AND nextAt <= ?").run(Date.now() + 120000, id, Date.now()).changes === 1;
export async function attempt(id) {
  let d = T.conversions.get(id);
  if (!d || inFlight.has(id) || d.status !== 'pending' || !claim(id)) return d;
  inFlight.add(id);
  try {
    const c = creds(T.users.get(d.userId));
    const r0 = { attempts: d.attempts + 1 };
    try {
      let url;
      if (d.provider === 'meta') { if (!c.meta) throw Object.assign(new Error('Meta Conversions API is no longer connected'), { final: true }); url = `${META()}/${c.meta.pixel}/events?access_token=${encodeURIComponent(c.meta.token)}`; }
      else { if (!c.ga4) throw Object.assign(new Error('GA4 Measurement Protocol is no longer connected'), { final: true }); url = `${GA4()}?measurement_id=${encodeURIComponent(c.ga4.id)}&api_secret=${encodeURIComponent(c.ga4.secret)}`; }
      const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(d.body), signal: AbortSignal.timeout(10000) });
      r0.lastStatus = r.status;
      if (r.ok) { r0.status = 'sent'; r0.sentAt = Date.now(); r0.lastError = undefined; }
      else {
        const j = await r.json().catch(() => ({}));
        r0.lastError = String(j?.error?.message || `HTTP ${r.status}`).slice(0, 300);
        if (r.status >= 400 && r.status < 500 && r.status !== 429) r0.final = true; // a bad token or payload won't fix itself
      }
    } catch (e) { r0.lastError = e.name === 'TimeoutError' ? 'Timed out after 10s' : String(e.message).slice(0, 300); if (e.final) r0.final = true; }
    d = T.conversions.update(id, (x) => {
      const final = r0.final; delete r0.final;
      Object.assign(x, r0);
      if (r0.lastError === undefined) delete x.lastError;
      if (x.status !== 'sent') { if (final || x.attempts >= BACKOFF.length) x.status = 'failed'; else x.nextAt = Date.now() + BACKOFF[x.attempts]; }
    }) || d;
    return d;
  } finally { inFlight.delete(id); }
}
const TICK = Number(process.env.WEBHOOK_TICK_MS || 10000);
if (JOBS) setInterval(() => { for (const id of T.conversions.ids({ status: 'pending', nextAt: { lte: Date.now() } })) if (!inFlight.has(id)) attempt(id); }, TICK).unref();

// ---------- routes ----------
export function registerTracking(app, { auth, wrap }) {
  app.get('/api/channels/tracking', auth, (req, res) => res.json(capiStatus(req.user)));
  app.put('/api/channels/tracking', auth, wrap(async (req, res) => {
    const b = req.body || {};
    const prev = req.user.channels?.capi || {};
    const next = { ...prev };
    if ('metaToken' in b) {
      const t = String(b.metaToken || '').trim();
      if (t && !/^[A-Za-z0-9_-]{30,600}$/.test(t)) return res.status(400).json({ error: 'That doesn’t look like a Conversions API access token (Events Manager → your pixel → Settings → Generate access token)' });
      next.metaTokenEnc = t ? encrypt(t) : '';
    }
    if ('metaTestCode' in b) { const t = String(b.metaTestCode || '').trim(); if (t && !/^TEST[A-Z0-9]{2,20}$/i.test(t)) return res.status(400).json({ error: 'Test event codes look like TEST12345 (Events Manager → Test events)' }); next.metaTestCode = t.toUpperCase(); }
    if ('ga4Secret' in b) {
      const t = String(b.ga4Secret || '').trim();
      if (t && !/^[\w-]{10,100}$/.test(t)) return res.status(400).json({ error: 'That doesn’t look like a Measurement Protocol API secret (GA4 Admin → Data streams → your stream → Measurement Protocol API secrets)' });
      next.ga4SecretEnc = t ? encrypt(t) : '';
    }
    next.at = Date.now();
    res.json(capiStatus(setChannel(req.user.id, 'capi', next)));
  }));
  app.get('/api/conversions', auth, (req, res) => {
    res.json(T.conversions.all({ userId: req.user.id }, { order: 'at', desc: true, limit: 30 }).map(({ body, userId, ...d }) => d));
  });
  app.post('/api/conversions/:cid/retry', auth, wrap(async (req, res) => {
    const d = T.conversions.get(req.params.cid);
    if (!d || d.userId !== req.user.id) return res.status(404).json({ error: 'Not found' });
    T.conversions.update(d.id, (x) => { x.status = 'pending'; x.attempts = Math.min(x.attempts, BACKOFF.length - 1); x.nextAt = Date.now(); });
    const { body, userId, ...out } = (await attempt(d.id)) || d;
    res.json(out);
  }));
}
