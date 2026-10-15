// WhatsApp through the owner's own Hive WhatsApp API (backend.theaihive.io/wa/v1) — a second provider next to
// Meta's Cloud API (messaging.js). Numbers may be "coexistence" numbers: the WhatsApp Business app and the API
// on one number. Buyers get short approved UTILITY templates (receipt, booking, access, shipping…); replies,
// opt-outs, delivery statuses, template reviews and what the seller sends from the phone app come back on a
// signed webhook. The API key and the webhook secret are stored encrypted and never leave the server.
import crypto from 'node:crypto';
import { T, q, tx, uid, hit, JOBS, phoneTail, contactKey, ordersByPhone } from './db.js';
import { encrypt, decrypt, registerWhatsAppProvider } from './messaging.js';
import { logActivity, ensureMeta } from './crm.js';
import { notify } from './notify.js';
import { funnelUrl } from './domains.js';

const API = () => String(process.env.HIVE_WA_API_URL || 'https://backend.theaihive.io/wa/v1').replace(/\/+$/, '');
const TICK = Number(process.env.HIVE_WA_TICK_MS || 60000);
const ABANDON_MS = Number(process.env.HIVE_WA_ABANDON_MS || 30 * 60000); // cart reminder after 30 minutes
const DAY = 86400000;
const clip = (v, n) => String(v ?? '').trim().slice(0, n);
// the events we register: never history.sync (old coexistence chats) — that stays off
const EVENTS = ['message.inbound', 'message.status', 'message.echo', 'message.opt_out', 'template.status', 'phone.quality'];

// ---------- the standard templates (UTILITY, English; Meta won't take a variable at the very start or end, and
// refuses ones with too many variables for their length — so each carries plenty of fixed wording) ----------
export const TEMPLATES = {
  order_receipt: { label: 'Order receipt', text: 'Hi {{1}}, thank you for your order. We have received your order for {{2}}, and your payment of {{3}} is confirmed.\n\nYou can view and download your receipt at any time using this link: {{4}}\n\nIf you have any questions about your order, simply reply to this message and we will help you.', samples: ['Priya', 'Yoga for Beginners', '₹1,999', 'https://example.com/invoice/INV-104'] },
  booking_confirmed: { label: 'Booking confirmed', text: 'Hi {{1}}, thank you for booking with us. Your {{2}} is confirmed for {{3}}, and we look forward to speaking with you.\n\nIf you need to reschedule or cancel, you can do it yourself using this link: {{4}}\n\nPlease reply to this message if you have any questions before the call.', samples: ['Priya', 'Strategy call', 'Mon 5 Oct, 10:00 am', 'https://example.com/booking/abc'] },
  booking_reminder: { label: 'Booking reminder', text: 'This is a friendly reminder that your {{1}} is scheduled for {{2}}. Please keep a few minutes free before it starts.\n\nYou can join using this link when it is time: {{3}}\n\nIf you are no longer able to attend, please reply to this message so we can help you find another time.', samples: ['Strategy call', 'Mon 5 Oct, 10:00 am', 'https://meet.google.com/abc-defg-hij'] },
  booking_changed: { label: 'Booking changed', text: 'Hi {{1}}, this is an update about your upcoming {{2}}. Your booking has been {{3}}.\n\nYou can see the latest details of your booking using this link: {{4}}\n\nIf you have any questions about this change, please reply to this message and we will help you.', samples: ['Priya', 'Strategy call', 'moved to Tue 6 Oct, 11:00 am', 'https://example.com/booking/abc'] },
  access_link: { label: 'Access link', text: 'Hi {{1}}, thank you for your purchase. Your access to {{2}} is now ready and waiting for you.\n\nYou can open it at any time using this link: {{3}}\n\nPlease keep this message safe so you can come back to it later, and reply here if you need any help.', samples: ['Priya', 'Yoga for Beginners', 'https://example.com/access/abc'] },
  order_shipped: { label: 'Order shipped', text: 'Hi {{1}}, good news: your order has been packed and shipped with {{2}} and is now on its way to you.\n\nYou can follow your parcel at any time using this tracking link: {{3}}\n\nIf you have any questions about your delivery, please reply to this message and we will help you.', samples: ['Priya', 'Delhivery', 'https://www.delhivery.com/track/package/123'] },
  webinar_reminder: { label: 'Webinar reminder', text: 'This is a friendly reminder that {{1}} starts at {{2}}. We recommend joining a few minutes early so you do not miss the beginning.\n\nYou can join the session using your personal link: {{3}}\n\nIf you have any questions before the session, please reply to this message.', samples: ['Yoga Masterclass', 'Sat 10 Oct, 7:00 pm', 'https://example.com/w/abc'] },
  quote_sent: { label: 'Quote sent', text: 'Hi {{1}}, thank you for your interest. Your quote for {{2}} is ready, and the total amount is {{3}}.\n\nYou can view the full quote and pay securely online using this link: {{4}}\n\nIf you have any questions or would like any changes, please reply to this message.', samples: ['Priya', 'Website redesign', '₹45,000', 'https://example.com/q/abc'] },
  payment_failed: { label: 'Payment failed', text: 'Hi {{1}}, we tried to collect your payment for {{2}}, but unfortunately it did not go through this time.\n\nYou can complete the payment securely using this link: {{3}}\n\nIf you need any help or have questions about your payment, please reply to this message.', samples: ['Priya', 'Yoga Membership', 'https://example.com/access/abc'] },
  abandoned_checkout: { label: 'Unfinished checkout', text: 'Hi {{1}}, we noticed that your order for {{2}} was not completed. Your details are saved, so it only takes a moment to finish.\n\nYou can complete your order using this link: {{3}}\n\nIf you had any trouble during checkout or have a question, please reply to this message and we will help.', samples: ['Priya', 'Yoga for Beginners', 'https://example.com/f/yoga/checkout'] },
  seller_alert: { label: 'Alerts to you (new orders and bookings)', text: 'You have a new {{1}} on your funnel {{2}}. Here are the details: {{3}}.\n\nYou can open your dashboard to see everything about it using this link: {{4}}\n\nThis is an automatic alert from your FunnelHive account.', samples: ['order', 'Yoga for Beginners', '₹1,999 from Priya', 'https://app.example.com/orders'] },
};
const tplName = (ev) => `fh_${ev}`;

// ---------- helpers ----------
// WhatsApp numbers: digits only; a 10-digit Indian number gets 91, a leading 0 / 00 is dropped
export const waNumber = (p = '') => {
  let d = String(p).replace(/\D/g, '').replace(/^00/, '');
  if (/^0\d{10}$/.test(d)) d = d.slice(1);
  if (d.length === 10) d = `91${d}`;
  return d.length >= 11 && d.length <= 15 ? d : '';
};
// the contact key a phone-only contact gets (the same shape checkout uses)
const phoneKey = (num) => (num.length === 12 && num.startsWith('91') ? `phone:${num.slice(2)}` : `phone:+${num}`);
const hiveOf = (u) => u?.channels?.whatsapp?.hive || null;
const keyOf = (h) => decrypt(h?.apiKeyEnc);
const isOn = (u) => { const h = hiveOf(u); return u?.channels?.whatsapp?.provider === 'hive' && !!(h?.apiKeyEnc && h?.from); };
// in use: Hive is the chosen provider, with a key and a number
const live = (u) => (isOn(u) ? hiveOf(u) : null);
const originOf = (h) => String(process.env.APP_URL || h?.origin || 'http://localhost:4000').replace(/\/+$/, '');
// buyers must give a WhatsApp number at checkout and booking while Hive WhatsApp is in use
export const waRequired = (u) => isOn(u);
export const waPhoneOk = (p) => !!waNumber(p);
export const waReady = (u, event) => { const h = live(u); return !!h && h.templates?.[event]?.status === 'APPROVED' && h.events?.[event] !== false; };

// one call to Hive; errors carry a plain message (the key itself never appears in one)
async function call(key, method, path, body, headers = {}) {
  let r;
  try {
    r = await fetch(`${API()}${path}`, { method, headers: { Authorization: `Bearer ${key}`, ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(15000) });
  } catch { throw Object.assign(new Error('Couldn’t reach Hive WhatsApp — please try again in a minute'), { status: 502 }); }
  const data = await r.json().catch(() => ({}));
  if (r.ok) return data;
  const code = data.code || data.error?.code || '';
  const said = typeof data.error === 'string' ? data.error : data.error?.message || data.message || `HTTP ${r.status}`;
  const msg = r.status === 401 ? 'Hive didn’t accept this API key — copy it again from Hive → WhatsApp API'
    : code === 'WHATSAPP_API_SUBSCRIPTION_REQUIRED' ? 'Your Hive WhatsApp API subscription isn’t active'
      : code === 'WA_WALLET_INSUFFICIENT' ? 'Your Hive WhatsApp wallet is too low to send — top it up in Hive'
        : `Hive WhatsApp: ${String(said).slice(0, 200)}`;
  throw Object.assign(new Error(msg), { status: r.status, code });
}
// template variables: no line breaks or long runs of spaces (Meta refuses them), never empty
const param = (v) => String(v ?? '').replace(/[\r\n\t]+/g, ' ').replace(/ {4,}/g, '   ').trim().slice(0, 1000) || '-';
const setHive = (userId, fn) => T.users.update(userId, (u) => {
  u.channels = { ...u.channels };
  const w = (u.channels.whatsapp = { ...(u.channels.whatsapp || {}) });
  w.hive = { ...(w.hive || {}) };
  fn(w.hive, w);
});

// ---------- opt-outs and contacts ----------
// opted out (STOP, or Meta's marketing opt-out): matched on the last 10 digits, whichever contact holds the number
export function waOptedOut(userId, phone) {
  const t = phoneTail(phone);
  if (t.length < 8) return false;
  return q("SELECT key, json_extract(data, '$.phone') AS p, json_extract(data, '$.waOptPhone') AS o FROM crm WHERE userId = ? AND json_extract(data, '$.waOptOut') = 1").all(userId)
    .some((r) => [r.p, r.o, String(r.key).startsWith('phone:') ? r.key.slice(6) : ''].some((x) => x && phoneTail(x) === t));
}
// the contact with this number: the seller's own record, a buyer, a lead, a booking… (null when nobody has it)
function contactByPhone(userId, phone) {
  const t = phoneTail(phone);
  if (t.length < 8) return null;
  const like = `%${t.slice(-4)}`;
  const crm = q("SELECT key, json_extract(data, '$.phone') AS p FROM crm WHERE userId = ? AND (key LIKE ? OR json_extract(data, '$.phone') LIKE ?)").all(userId, `phone:${like}`, like)
    .find((r) => phoneTail(r.p || (String(r.key).startsWith('phone:') ? r.key.slice(6) : '')) === t);
  if (crm) return crm.key;
  const o = ordersByPhone({ userId }, phone)[0];
  if (o?.email) return contactKey(o.email);
  for (const tb of ['leads', 'bookings', 'registrations', 'abandoned']) {
    const r = q(`SELECT ckey, json_extract(data, '$.phone') AS p FROM ${tb} WHERE userId = ? AND json_extract(data, '$.phone') LIKE ? ORDER BY at DESC LIMIT 50`).all(userId, like).find((x) => x.ckey && phoneTail(x.p) === t);
    if (r) return r.ckey;
  }
  return null;
}
// finds the contact for a number, or adds one (shown in Contacts as "from WhatsApp")
function contactFor(userId, num, name) {
  const key = contactByPhone(userId, num) || phoneKey(num);
  const m = ensureMeta(userId, key);
  if (!T.leads.exists({ userId, ckey: key }) && !T.orders.exists({ userId, ckey: key }) && !m.manual) {
    Object.assign(m, { manual: true, source: 'whatsapp', name: m.name || clip(name, 120), phone: m.phone || `+${num}`, at: m.at || Date.now() });
    T.crm.put(m);
  }
  return key;
}
function optOut(userId, key, num, why) {
  const m = ensureMeta(userId, key);
  if (m.waOptOut) return;
  T.crm.update(m.id, (x) => { x.waOptOut = true; x.waOptPhone = num; x.waOptAt = Date.now(); x.activities = [...(x.activities || []), { id: uid(), at: Date.now(), type: 'note', title: 'Unsubscribed from WhatsApp', text: why }].slice(-500); });
}

// ---------- sending ----------
// One record per logical message (ikey): a retry reuses it and Hive's Idempotency-Key stops a double send.
// → { status: 'sent', id } (duplicate: true when it already went); throws on a provider error
async function send(u, to, payload, { ikey, event = '', ckey = '' } = {}) {
  const h = live(u);
  if (!h) return { status: 'not-configured' };
  const num = waNumber(to);
  if (!num) throw new Error('Not a valid phone number');
  ikey = clip(ikey || `msg:${uid()}`, 200);
  let rec = T.wamsgs.find({ userId: u.id, ikey });
  if (rec && rec.status !== 'failed') return { status: 'sent', id: rec.hiveId || rec.id, duplicate: true };
  if (!rec) {
    try { rec = T.wamsgs.insert({ id: uid(), userId: u.id, ikey, event, to: num, ckey, template: payload.template?.name || '', status: 'sending', at: Date.now() }); } catch {
      const other = T.wamsgs.find({ userId: u.id, ikey }); // sent at this same moment by another request
      return { status: 'sent', id: other?.hiveId || other?.id, duplicate: true };
    }
  } else rec = T.wamsgs.update(rec.id, (x) => { x.status = 'sending'; delete x.error; });
  try {
    const r = await call(keyOf(h), 'POST', '/messages', { ...payload, from: h.from, to: num, callback_data: rec.id }, { 'Idempotency-Key': ikey });
    T.wamsgs.update(rec.id, (x) => { x.status = 'sent'; x.hiveId = r.id || null; x.wamid = r.wamid || null; x.sentAt = Date.now(); });
    return { status: 'sent', id: r.id || rec.id };
  } catch (e) {
    T.wamsgs.update(rec.id, (x) => { x.status = 'failed'; x.error = String(e.message).slice(0, 300); });
    throw e;
  }
}
// is a free-form session message allowed (the customer wrote in the last 24 hours)?
const windowOpen = async (h, num) => !!(await call(keyOf(h), 'GET', `/window?from=${encodeURIComponent(h.from)}&to=${num}`).catch(() => null))?.open;

// messaging.js sendWhatsApp(u, to, msg) when Hive is the provider: automations, broadcasts, the contact screen, tests
async function providerSend(u, to, msg = {}) {
  const h = live(u);
  if (!h) return { status: 'not-configured' };
  if (waOptedOut(u.id, to)) throw new Error('This contact opted out of WhatsApp messages');
  const opts = { ikey: msg.key, ckey: msg.ckey, event: msg.event || '' };
  if (msg.template) return send(u, to, { type: 'template', template: { name: msg.template, language: msg.language || 'en', body: (msg.params || []).map(param) } }, opts);
  if (await windowOpen(h, waNumber(to))) return send(u, to, { type: 'text', text: { body: String(msg.text || '').slice(0, 4096) } }, opts);
  // outside the 24-hour window: the event's template if there is one, else nothing can go
  if (msg.fallback && waReady(u, msg.fallback.event)) return send(u, to, { type: 'template', template: { name: tplName(msg.fallback.event), language: h.templates[msg.fallback.event].language || 'en', body: msg.fallback.params.map(param) } }, opts);
  throw new Error('More than 24 hours since this contact last messaged you — WhatsApp only allows approved templates now');
}
registerWhatsAppProvider('hive', { configured: isOn, send: providerSend });

// A buyer message for something that happened (order, booking, access…): the event's approved template, when
// Hive is in use, the event is switched on and the buyer has a number and hasn't opted out. Never throws —
// a message must never break the sale or booking behind it.
export async function waEvent(u0, event, { to, params = [], link, entityId, ckey = '' } = {}) {
  try {
    const u = typeof u0 === 'string' ? T.users.get(u0) : u0?.id ? T.users.get(u0.id) || u0 : null;
    if (!u || !waReady(u, event) || !TEMPLATES[event]) return { status: 'off' };
    const num = waNumber(to);
    if (!num) return { status: 'no-phone' };
    if (waOptedOut(u.id, num)) return { status: 'opted-out' };
    const tpl = hiveOf(u).templates[event];
    const body = [...params, ...(link ? [link] : [])].map(param);
    const r = await send(u, num, { type: 'template', template: { name: tpl.name || tplName(event), language: tpl.language || 'en', body } }, { ikey: `${event}:${entityId || uid()}:${num}`, event, ckey });
    if (ckey && r.status === 'sent' && !r.duplicate) logActivity(u.id, ckey, { type: 'whatsapp', title: `WhatsApp sent: ${TEMPLATES[event].label.toLowerCase()}`, text: body.join(' · '), status: 'sent', by: 'auto' });
    return r;
  } catch (e) { console.error(`WhatsApp ${event} not sent:`, e.message); return { status: 'failed', error: e.message }; }
}
// the seller's own alert (new order / booking) to the number they gave
export function sellerAlert(u0, { kind, where, what, path, entityId }) {
  const u = typeof u0 === 'string' ? T.users.get(u0) : u0;
  const h = live(u);
  if (!h?.notifyPhone) return null;
  return waEvent(u, 'seller_alert', { to: h.notifyPhone, params: [kind, where, what], link: `${originOf(h)}${path}`, entityId });
}

// ---------- templates ----------
async function refreshTemplates(u) {
  const h = hiveOf(u);
  const r = await call(keyOf(h), 'GET', `/templates?from=${encodeURIComponent(h.from)}`);
  const list = Array.isArray(r.templates) ? r.templates : [];
  return setHive(u.id, (x) => {
    x.templates = { ...x.templates };
    for (const ev of Object.keys(TEMPLATES)) {
      const t = list.find((y) => y.name === tplName(ev) && /^en/i.test(y.language || 'en'));
      if (t) x.templates[ev] = { ...x.templates[ev], name: t.name, language: t.language || 'en', status: String(t.status || 'PENDING').toUpperCase(), id: t.id || null, reason: t.rejected_reason || t.reason || '', at: Date.now() };
    }
  });
}
// submits the templates that aren't there yet; one that already exists (409 / duplicate) is picked up by the refresh
async function setupTemplates(u) {
  const h = hiveOf(u), key = keyOf(h), out = {};
  for (const [ev, d] of Object.entries(TEMPLATES)) {
    const have = h.templates?.[ev]?.status;
    if (['APPROVED', 'PENDING', 'IN_APPEAL'].includes(have)) { out[ev] = have; continue; }
    try {
      const r = await call(key, 'POST', '/templates', { from: h.from, name: tplName(ev), category: 'UTILITY', language: 'en', components: [{ type: 'body', parameters: [{ type: 'text', text: d.text }] }], samples: { body: d.samples } });
      out[ev] = String(r.status || 'PENDING').toUpperCase();
      setHive(u.id, (x) => { x.templates = { ...x.templates, [ev]: { name: r.name || tplName(ev), language: r.language || 'en', status: out[ev], id: r.id || null, at: Date.now() } }; });
    } catch (e) {
      if (e.status === 409 || /exist|duplicate/i.test(e.message)) { out[ev] = 'EXISTS'; continue; }
      if (e.status === 401 || e.status === 402) throw e; // the rest would fail the same way
      out[ev] = 'ERROR';
      setHive(u.id, (x) => { x.templates = { ...x.templates, [ev]: { name: tplName(ev), language: 'en', status: 'ERROR', reason: e.message, at: Date.now() } }; });
    }
  }
  return out;
}

// ---------- abandoned checkouts: one WhatsApp reminder per cart, 30 minutes after it was left ----------
export async function hiveTick(now = Date.now()) {
  try {
    const users = q("SELECT id FROM users WHERE json_extract(data, '$.channels.whatsapp.provider') = 'hive' AND json_extract(data, '$.channels.whatsapp.hive.abandonedReminder') = 1").all();
    for (const { id } of users) {
      const u = T.users.get(id);
      const h = live(u);
      if (!h || !waReady(u, 'abandoned_checkout')) continue;
      for (const c of T.abandoned.all({ userId: id, recovered: 0, demo: 0, at: { gte: Math.max(h.abandonedSince || 0, now - ABANDON_MS - 2 * DAY), lte: now - ABANDON_MS } })) {
        if (c.waReminded || !waNumber(c.phone)) continue;
        // bought since (recovery marks most carts; this catches a purchase in another funnel)
        if ((c.email && T.orders.exists({ userId: id, ckey: contactKey(c.email), at: { gt: c.at } })) || ordersByPhone({ userId: id }, c.phone, c.at).length) continue;
        const claimed = tx(() => { const x = T.abandoned.get(c.id); if (!x || x.waReminded || x.recovered) return false; x.waReminded = now; T.abandoned.put(x); return true; });
        const f = claimed && T.funnels.get(c.funnelId);
        if (!f) continue;
        const step = f.steps.find((s) => s.id === c.stepId) || f.steps.find((s) => s.type === 'checkout');
        const chk = f.steps.find((s) => s.type === 'checkout')?.blocks.find((b) => b.type === 'checkout')?.props;
        await waEvent(u, 'abandoned_checkout', { to: c.phone, params: [String(c.name || '').split(/\s+/)[0] || 'there', chk?.productName || f.name], link: funnelUrl(f, originOf(h), step?.slug), entityId: c.id, ckey: contactKey(c.email, c.phone) });
      }
    }
    if (Math.random() < 0.02) q('DELETE FROM wamsgs WHERE at < ?').run(now - 90 * DAY);
  } catch (e) { console.error('WhatsApp reminders failed', e.message); }
}

// ---------- the webhook ----------
const STOP = /^\s*(stop|stop all|unsubscribe|opt[\s-]?out)\s*[.!]*\s*$/i;
const RANK = { sending: 0, queued: 1, sent: 2, delivered: 3, read: 4 };
function handle(userId, ev, d = {}, env = {}) {
  const u = T.users.get(userId);
  if (ev === 'message.inbound') {
    const num = waNumber(d.from);
    if (!num) return;
    const text = clip(d.text || d.interactive_title || (d.type && d.type !== 'text' ? `[${d.type}]` : ''), 4000);
    const key = contactFor(userId, num, d.contact_name);
    logActivity(userId, key, { type: 'whatsapp', title: `WhatsApp message: ${clip(text, 120) || '(empty)'}`, text, status: 'received', by: 'contact' });
    notify(userId, { kind: 'whatsapp', title: `WhatsApp from ${clip(d.contact_name, 60) || `+${num}`}`, body: text, link: `/contacts/${encodeURIComponent(key)}` });
    if (STOP.test(text)) optOut(userId, key, num, `Replied “${clip(text, 40)}” on WhatsApp`);
  } else if (ev === 'message.opt_out') {
    for (const p of Array.isArray(d.preferences) ? d.preferences : []) {
      const num = waNumber(p.wa_id);
      if (!num) continue;
      const key = contactFor(userId, num);
      if (/^(resume|start)$/i.test(p.value)) T.crm.update(ensureMeta(userId, key).id, (x) => { if (x.waOptOut) { delete x.waOptOut; x.activities = [...(x.activities || []), { id: uid(), at: Date.now(), type: 'note', title: 'Resubscribed to WhatsApp' }].slice(-500); } });
      else optOut(userId, key, num, 'Stopped marketing messages in WhatsApp');
    }
  } else if (ev === 'message.status') {
    const rec = (d.callback_data && T.wamsgs.get(d.callback_data)) || (d.message_id && T.wamsgs.find({ hiveId: d.message_id }));
    if (!rec || rec.userId !== userId) return;
    const st = String(d.status || '').toLowerCase();
    const next = T.wamsgs.update(rec.id, (x) => {
      if (st === 'failed') { x.status = 'failed'; x.error = clip(d.error?.message || d.error?.title || d.error || d.reason || 'Not delivered', 300); } else if ((RANK[st] ?? -1) > (RANK[x.status] ?? -1)) x.status = st;
      if (RANK[st] || st === 'failed') x[`${st}At`] = Date.now();
    });
    if (st === 'failed' && rec.status !== 'failed' && next.ckey) logActivity(userId, next.ckey, { type: 'whatsapp', title: `WhatsApp not delivered${next.template ? `: ${next.template}` : ''}`, text: next.error, status: 'failed', by: 'auto' });
  } else if (ev === 'message.echo') {
    // sent by the seller from the WhatsApp Business app (coexistence): the customer is the other side
    const ours = new Set([env.number?.display, env.number?.phone_number_id, hiveOf(u)?.from].map((x) => String(x || '').replace(/\D/g, '')).filter(Boolean));
    const num = [d.to, d.recipient, d.wa_id, d.customer, d.from].map(waNumber).find((x) => x && !ours.has(x));
    if (!num) return;
    const text = clip(d.text || (d.type && d.type !== 'text' ? `[${d.type}]` : ''), 4000);
    logActivity(userId, contactFor(userId, num), { type: 'whatsapp', title: `You (from the WhatsApp app): ${clip(text, 120)}`, text, status: 'sent', by: 'you' });
  } else if (ev === 'template.status') {
    const ent = Object.entries(TEMPLATES).find(([e]) => tplName(e) === d.name);
    if (!ent || !d.status) return;
    setHive(userId, (x) => { x.templates = { ...x.templates, [ent[0]]: { ...x.templates?.[ent[0]], name: d.name, language: d.language || x.templates?.[ent[0]]?.language || 'en', status: String(d.status).toUpperCase(), reason: clip(d.reason || d.rejected_reason, 300), at: Date.now() } }; });
  } else if (ev === 'phone.quality') {
    setHive(userId, (x) => { x.quality = { rating: clip(d.quality_rating, 20) || x.quality?.rating || '', event: clip(d.event, 40), limit: clip(d.limit, 40) || x.quality?.limit || '', at: Date.now() }; });
  }
}
const tsOf = (v) => { if (v == null || v === '') return null; const n = /^\d+$/.test(String(v)) ? Number(v) : Date.parse(v); return Number.isFinite(n) ? (n < 1e12 ? n * 1000 : n) : null; };
const sameHex = (a, b) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

// ---------- settings API (admins only: /api/channels/ is a secret area in team.js) ----------
function view(u) {
  const w = u.channels?.whatsapp || {}, h = w.hive || {};
  return {
    provider: w.provider || 'meta', configured: isOn(u), hasKey: !!h.apiKeyEnc, keyPrefix: h.keyPrefix || '', mode: h.mode || null,
    from: h.from || '', fromLabel: h.fromLabel || '', notifyPhone: h.notifyPhone || '', metaConfigured: !!(w.phoneNumberId && w.tokenEnc),
    webhook: h.webhook ? { url: h.webhook.url, connectedAt: h.webhook.at, lastEventAt: h.webhook.lastEventAt || null, events: h.webhook.events || [] } : null,
    quality: h.quality || null, abandonedReminder: !!h.abandonedReminder,
    // the latest sends and how they went (delivery statuses come in on the webhook)
    recent: T.wamsgs.all({ userId: u.id }, { order: 'at', desc: true, limit: 20 }).map((m) => ({ id: m.id, event: m.event || '', template: m.template || '', to: m.to, status: m.status, error: m.error || '', at: m.at })),
    templates: Object.entries(TEMPLATES).map(([event, d]) => { const t = h.templates?.[event] || {}; return { event, label: d.label, name: tplName(event), text: d.text, status: t.status || null, reason: t.reason || '', enabled: h.events?.[event] !== false }; }),
  };
}
export function registerHiveWhatsApp(app, { auth, wrap, rateLimit, isTest, appUrl }) {
  const testLimiter = rateLimit({ windowMs: 60000, max: isTest ? 1000 : 6, key: (req) => req.user.id, message: 'Too many test messages — please wait a minute.' });
  const setupLimiter = rateLimit({ windowMs: 60000, max: isTest ? 1000 : 10, key: (req) => req.user.id, message: 'Please wait a minute and try again.' });
  const hookLimiter = rateLimit({ windowMs: 60000, max: isTest ? 5000 : 600, key: (req) => req.params.uid });
  // Hive's own 401 / 402 must not look like our session ending or the account locking: always a 400 here
  const fail = (res, e) => res.status(400).json({ error: e.message });
  const need = (req, res) => { const h = hiveOf(req.user); if (!h?.apiKeyEnc) { res.status(400).json({ error: 'Add your Hive WhatsApp API key first' }); return null; } return h; };
  const needNumber = (req, res) => { const h = need(req, res); if (h && !h.from) { res.status(400).json({ error: 'Choose your WhatsApp number first' }); return null; } return h; };
  const P = '/api/channels/whatsapp/hive';

  app.get(P, auth, (req, res) => res.json(view(req.user)));
  // { apiKey?, from?, notifyPhone?, provider?, events?, abandonedReminder?, clear? }
  app.put(P, auth, wrap(async (req, res) => {
    const b = req.body || {}, uidv = req.user.id;
    if (b.clear) return res.json(view(setHive(uidv, (h, w) => { delete w.hive; delete w.provider; })));
    const prev = hiveOf(req.user) || {};
    const apiKey = clip(b.apiKey, 400);
    let me = null, numbers = null;
    if (apiKey) {
      if (!/^hk_(live|test)_\S{4,}$/.test(apiKey)) return res.status(400).json({ error: 'A Hive WhatsApp API key starts with hk_live_ or hk_test_' });
      try { me = await call(apiKey, 'GET', '/me'); numbers = (await call(apiKey, 'GET', '/numbers')).numbers || []; } catch (e) { return fail(res, e); }
    } else if (!prev.apiKeyEnc) return res.status(400).json({ error: 'Paste your Hive WhatsApp API key' });
    let from = 'from' in b ? clip(b.from, 80) : prev.from || '', fromLabel = prev.fromLabel || '', fromId = prev.fromId || '';
    if ('from' in b || (numbers && !from)) {
      numbers ||= (await call(keyOf(prev), 'GET', '/numbers').catch((e) => { throw Object.assign(e, { status: 400 }); })).numbers || [];
      // with a single number connected, it's picked for you
      const n = from ? numbers.find((x) => [x.id, x.display, x.phone_number_id].includes(from)) : numbers.length === 1 ? numbers[0] : null;
      if (from && !n) return res.status(400).json({ error: 'That number isn’t connected to your Hive WhatsApp account' });
      if (n) { from = n.phone_number_id || n.display || n.id; fromLabel = n.display || from; fromId = n.id || ''; }
    }
    let notifyPhone = prev.notifyPhone || '';
    if ('notifyPhone' in b) {
      notifyPhone = String(b.notifyPhone || '').trim() ? waNumber(b.notifyPhone) : '';
      if (String(b.notifyPhone || '').trim() && !notifyPhone) return res.status(400).json({ error: 'Enter your WhatsApp number with the country code, e.g. +91 98765 43210' });
    }
    const out = setHive(uidv, (h, w) => {
      if (apiKey) Object.assign(h, { apiKeyEnc: encrypt(apiKey), keyPrefix: clip(me?.prefix, 24) || apiKey.slice(0, 12), mode: apiKey.startsWith('hk_live_') ? 'live' : 'test', workspaceId: clip(me?.workspace_id, 80), origin: h.origin || appUrl(req) });
      if (apiKey && !prev.apiKeyEnc) w.provider = 'hive'; // connecting Hive switches to it
      Object.assign(h, { from, fromLabel, fromId, notifyPhone });
      if (from !== prev.from && prev.from) { h.templates = {}; delete h.quality; } // another number has its own templates
      if (['hive', 'meta'].includes(b.provider)) w.provider = b.provider;
      if (b.events && typeof b.events === 'object') { h.events = { ...h.events }; for (const k of Object.keys(TEMPLATES)) if (typeof b.events[k] === 'boolean') h.events[k] = b.events[k]; }
      if ('abandonedReminder' in b) { if (b.abandonedReminder && !h.abandonedReminder) h.abandonedSince = Date.now(); h.abandonedReminder = !!b.abandonedReminder; }
    });
    res.json(view(out));
  }));
  app.get(`${P}/numbers`, auth, wrap(async (req, res) => {
    const h = need(req, res); if (!h) return;
    try { res.json({ numbers: ((await call(keyOf(h), 'GET', '/numbers')).numbers || []).map((n) => ({ id: n.id, display: n.display, phone_number_id: n.phone_number_id, quality: n.quality || null })) }); } catch (e) { fail(res, e); }
  }));
  // registers our webhook with Hive — the seller never copies a URL or secret
  app.post(`${P}/webhook`, auth, setupLimiter, wrap(async (req, res) => {
    const h = needNumber(req, res); if (!h) return;
    const url = `${String(process.env.APP_URL || appUrl(req)).replace(/\/+$/, '')}/api/hive/webhook/${req.user.id}`;
    const secret = crypto.randomBytes(32).toString('hex');
    try { await call(keyOf(h), 'PUT', '/webhooks', { url, secret, events: EVENTS, ...(h.fromId ? { channel_ids: [h.fromId] } : {}) }); } catch (e) { return fail(res, e); }
    res.json(view(setHive(req.user.id, (x) => { x.webhookSecretEnc = encrypt(secret); x.webhook = { url, at: Date.now(), events: EVENTS }; })));
  }));
  app.post(`${P}/webhook/test`, auth, testLimiter, wrap(async (req, res) => {
    const h = need(req, res); if (!h) return;
    if (!h.webhookSecretEnc) return res.status(400).json({ error: 'Connect the webhook first' });
    try { await call(keyOf(h), 'POST', '/webhooks/test'); res.json({ ok: true }); } catch (e) { fail(res, e); }
  }));
  app.post(`${P}/templates/setup`, auth, setupLimiter, wrap(async (req, res) => {
    const h = needNumber(req, res); if (!h) return;
    let result;
    try { result = await setupTemplates(req.user); } catch (e) { return fail(res, e); }
    let u = T.users.get(req.user.id);
    try { u = await refreshTemplates(u); } catch (e) { console.error('template refresh failed', e.message); }
    res.json({ ...view(u), result });
  }));
  app.get(`${P}/templates`, auth, wrap(async (req, res) => {
    const h = needNumber(req, res); if (!h) return;
    try { res.json(view(await refreshTemplates(req.user))); } catch (e) { fail(res, e); }
  }));
  // a test to the seller's own number: the alert template once approved, else plain text inside the 24-hour window
  app.post(`${P}/test`, auth, testLimiter, wrap(async (req, res) => {
    const h = needNumber(req, res); if (!h) return;
    const to = waNumber(req.body?.to || h.notifyPhone);
    if (!to) return res.status(400).json({ error: 'Add your own WhatsApp number (for alerts) first' });
    try {
      if (h.templates?.seller_alert?.status === 'APPROVED') await send(req.user, to, { type: 'template', template: { name: tplName('seller_alert'), language: h.templates.seller_alert.language || 'en', body: ['test message', 'FunnelHive', 'your WhatsApp is connected', `${originOf(h)}/settings`].map(param) } }, { event: 'test' });
      else if (await windowOpen(h, to)) await send(req.user, to, { type: 'text', text: { body: 'Test from FunnelHive ✅ — your Hive WhatsApp is connected.' } }, { event: 'test' });
      else return res.status(400).json({ error: 'Your alert template isn’t approved yet. Send any message to your business number from your phone first, then try again (WhatsApp allows plain messages for 24 hours after you write).' });
      res.json({ ok: true, to });
    } catch (e) { fail(res, e); }
  }));

  // Hive → us: signed (HMAC-SHA256 of the raw body with this seller's secret), ACKed straight away
  app.post('/api/hive/webhook/:uid', hookLimiter, (req, res) => {
    const u = T.users.get(String(req.params.uid));
    const h = hiveOf(u);
    const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from('');
    const secret = decrypt(h?.webhookSecretEnc);
    const given = String(req.headers['x-hive-signature'] || '').replace(/^sha256=/i, '').toLowerCase();
    if (!secret || !given || !sameHex(given, crypto.createHmac('sha256', secret).update(raw).digest('hex'))) return res.status(401).json({ error: 'Bad signature' });
    let body;
    try { body = JSON.parse(raw.toString('utf8')); } catch { return res.status(400).json({ error: 'Bad JSON' }); }
    const at = tsOf(req.headers['x-hive-timestamp']) ?? tsOf(body.created_at);
    if (at && Math.abs(Date.now() - at) > 10 * 60000) return res.status(401).json({ error: 'Stale delivery' });
    // each delivery once (Hive retries what it thinks failed)
    const did = clip(req.headers['x-hive-delivery-id'] || body.id, 120);
    if (did && hit(`hivewa:${u.id}:${did}`, 3 * DAY).n > 1) return res.json({ ok: true, duplicate: true });
    try {
      handle(u.id, String(body.event || req.headers['x-hive-event'] || ''), body.data || {}, body);
      if (Date.now() - (h.webhook?.lastEventAt || 0) > 5 * 60000) setHive(u.id, (x) => { x.webhook = { ...x.webhook, lastEventAt: Date.now() }; });
    } catch (e) { console.error('Hive WhatsApp webhook failed', e.message); }
    res.json({ ok: true });
  });

  if (JOBS) setInterval(() => hiveTick(), TICK).unref();
}
