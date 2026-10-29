// Cash on Delivery risk controls — all off until the seller turns them on (Settings → Cash on Delivery):
//  · confirmation: after a COD order the buyer gets a WhatsApp message (the approved fh_cod_confirm template, or
//    Confirm / Cancel buttons while the 24-hour window is open) — or an email — with a signed confirm / cancel link.
//    Their reply ("YES" / "NO", a button) or the link sets order.codStatus: pending → confirmed | cancelled; no
//    answer in N hours → unconfirmed and the seller is told. A buyer's cancel cancels the order (cancelCod).
//  · pincodes: a list of PIN codes delivered to (or "all India except"), and PIN codes where COD isn't offered;
//    checked at checkout before any payment. A rough PIN → state map suggests the state.
//  · risk rules: a maximum COD order value, and no COD for a number with N earlier COD orders that went unconfirmed,
//    were cancelled by the buyer or came back (RTO).
// Order fields: codStatus ('pending' | 'confirmed' | 'cancelled' | 'unconfirmed'), codConfirm { sends: [{ at, via }],
// dueAt, answeredAt, by, expiredAt }, rtoAt (set when a COD order is marked returned to origin — fulfilment.js).
import crypto from 'node:crypto';
import { T, q, tx, JOBS, contactKey, phoneTail, ordersByPhone } from './db.js';
import { waEvent, waReady, waButtons, waSession, sellerAlert, onWaReply } from './hive-wa.js';
import { sendEmail } from './messaging.js';
import { notify, money } from './notify.js';
import { enqueue as fireWebhook } from './webhooks.js';
import { fire as fireAutomation } from './automations.js';
import { cancelCod, markRto } from './fulfilment.js';

const HOUR = Number(process.env.COD_HOUR_MS || 3600000); // tests shrink hours
const TICK = Number(process.env.COD_TICK_MS || 60000);
let SECRET = '';
const clip = (v, n) => String(v ?? '').trim().slice(0, n);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---------- settings (user.settings.cod) ----------
const DEF = { confirm: false, hours: 24, pinMode: 'off', pins: [], noCod: [], maxCod: 0, blockAfter: 0 };
export const codSettings = (u) => ({ ...DEF, ...(u?.settings?.cod || {}) });

// PIN code rules, one per word / line: 302001 (one), 302xxx or 302* (a prefix), 302001-302039 (a range)
export function parsePins(text) {
  const list = [], bad = [];
  const words = Array.isArray(text) ? text : String(text || '').split(/[\s,;]+/);
  for (const raw of words) {
    const t = String(raw).trim().toLowerCase();
    if (!t) continue;
    let m;
    if (/^[1-9]\d{5}$/.test(t)) list.push(t);
    else if ((m = t.match(/^([1-9]\d{0,4})(x+|\*)$/))) list.push(`${m[1]}*`);
    else if ((m = t.match(/^([1-9]\d{5})\s*-\s*([1-9]\d{5})$/))) list.push(m[1] <= m[2] ? `${m[1]}-${m[2]}` : `${m[2]}-${m[1]}`);
    else if (bad.length < 20) bad.push(clip(raw, 20));
  }
  return { list: [...new Set(list)].slice(0, 20000), bad };
}
const pinMatch = (list, pin) => (list || []).some((r) => (r.endsWith('*') ? pin.startsWith(r.slice(0, -1)) : r.includes('-') ? pin >= r.slice(0, 6) && pin <= r.slice(7) : r === pin));

// The state a PIN code most likely belongs to — postal circles follow the first 2–3 digits, roughly. A suggestion only.
const PIN3 = { 160: 'Chandigarh', 194: 'Ladakh', 246: 'Uttarakhand', 247: 'Uttarakhand', 248: 'Uttarakhand', 249: 'Uttarakhand', 262: 'Uttarakhand', 263: 'Uttarakhand', 396: 'Dadra and Nagar Haveli and Daman and Diu', 403: 'Goa', 605: 'Puducherry', 682: 'Kerala', 737: 'Sikkim', 744: 'Andaman and Nicobar Islands', 790: 'Arunachal Pradesh', 791: 'Arunachal Pradesh', 792: 'Arunachal Pradesh', 793: 'Meghalaya', 794: 'Meghalaya', 795: 'Manipur', 796: 'Mizoram', 797: 'Nagaland', 798: 'Nagaland', 799: 'Tripura', 814: 'Jharkhand', 815: 'Jharkhand', 816: 'Jharkhand', 825: 'Jharkhand', 826: 'Jharkhand', 827: 'Jharkhand', 828: 'Jharkhand', 829: 'Jharkhand', 830: 'Jharkhand', 831: 'Jharkhand', 832: 'Jharkhand', 833: 'Jharkhand', 834: 'Jharkhand', 835: 'Jharkhand' };
const PIN2 = { 11: 'Delhi', 12: 'Haryana', 13: 'Haryana', 14: 'Punjab', 15: 'Punjab', 16: 'Punjab', 17: 'Himachal Pradesh', 18: 'Jammu and Kashmir', 19: 'Jammu and Kashmir', 20: 'Uttar Pradesh', 21: 'Uttar Pradesh', 22: 'Uttar Pradesh', 23: 'Uttar Pradesh', 24: 'Uttar Pradesh', 25: 'Uttar Pradesh', 26: 'Uttar Pradesh', 27: 'Uttar Pradesh', 28: 'Uttar Pradesh', 30: 'Rajasthan', 31: 'Rajasthan', 32: 'Rajasthan', 33: 'Rajasthan', 34: 'Rajasthan', 36: 'Gujarat', 37: 'Gujarat', 38: 'Gujarat', 39: 'Gujarat', 40: 'Maharashtra', 41: 'Maharashtra', 42: 'Maharashtra', 43: 'Maharashtra', 44: 'Maharashtra', 45: 'Madhya Pradesh', 46: 'Madhya Pradesh', 47: 'Madhya Pradesh', 48: 'Madhya Pradesh', 49: 'Chhattisgarh', 50: 'Telangana', 51: 'Andhra Pradesh', 52: 'Andhra Pradesh', 53: 'Andhra Pradesh', 56: 'Karnataka', 57: 'Karnataka', 58: 'Karnataka', 59: 'Karnataka', 60: 'Tamil Nadu', 61: 'Tamil Nadu', 62: 'Tamil Nadu', 63: 'Tamil Nadu', 64: 'Tamil Nadu', 67: 'Kerala', 68: 'Kerala', 69: 'Kerala', 70: 'West Bengal', 71: 'West Bengal', 72: 'West Bengal', 73: 'West Bengal', 74: 'West Bengal', 75: 'Odisha', 76: 'Odisha', 77: 'Odisha', 78: 'Assam', 80: 'Bihar', 81: 'Bihar', 82: 'Bihar', 83: 'Jharkhand', 84: 'Bihar', 85: 'Bihar' };
export const pinState = (pin) => PIN3[String(pin).slice(0, 3)] || PIN2[String(pin).slice(0, 2)] || '';

// What a PIN code means for this seller → { valid, deliverable, cod, state, message }
export function pincodeInfo(u, raw) {
  const pin = String(raw ?? '').replace(/\D/g, '');
  if (!/^[1-9]\d{5}$/.test(pin)) return { valid: false, deliverable: false, cod: false, state: '', message: 'Please enter a valid 6-digit PIN code' };
  const s = codSettings(u);
  const deliverable = s.pinMode === 'allow' ? pinMatch(s.pins, pin) : s.pinMode === 'except' ? !pinMatch(s.pins, pin) : true;
  const cod = deliverable && !pinMatch(s.noCod, pin);
  return { valid: true, deliverable, cod, state: pinState(pin), message: !deliverable ? 'We don’t deliver to this PIN code yet' : !cod ? 'Cash on Delivery isn’t available here — please pay online' : '' };
}

// ---------- the buyer's COD history (last 10 digits of the phone) ----------
const isRto = (o) => !!o.rtoAt || o.cancelReason === 'returned';
const isBad = (o) => o.paymentMethod === 'cod' && o.status !== 'paid' && (isRto(o) || ['cancelled', 'unconfirmed'].includes(o.codStatus));
export function codHistory(userId, phone) {
  const list = ordersByPhone({ userId }, phone).filter((o) => o.paymentMethod === 'cod' && !o.demo);
  return { orders: list.length, rto: list.filter(isRto).length, cancelled: list.filter((o) => o.codStatus === 'cancelled').length, unconfirmed: list.filter((o) => o.codStatus === 'unconfirmed' && o.status === 'cod').length, delivered: list.filter((o) => o.status === 'paid').length, bad: list.filter(isBad).length };
}

// ---------- checkout ----------
// a shipping checkout to a PIN code the seller doesn't deliver to (online payments too) → an error, or null
export function shipError(u, charge, buyer) {
  if (!charge.needsAddress || !buyer.address?.pincode) return null;
  const p = pincodeInfo(u, buyer.address.pincode);
  return p.valid && !p.deliverable ? p.message : null;
}
// Cash on Delivery for this buyer and amount → { error, code } or null
export function codCheckoutError(u, charge, buyer) {
  const s = codSettings(u);
  const ship = shipError(u, charge, buyer);
  if (ship) return { error: ship, code: 'pincode' };
  if (buyer.address?.pincode && !pincodeInfo(u, buyer.address.pincode).cod) return { error: 'Cash on Delivery isn’t available at this PIN code — please pay online', code: 'pincode_cod' };
  if (s.maxCod > 0 && charge.total > s.maxCod) return { error: `Cash on Delivery is available on orders up to ${money(s.maxCod)} — please pay online`, code: 'max' };
  if (s.blockAfter > 0 && codHistory(u.id, buyer.phone).bad >= s.blockAfter) return { error: 'Cash on Delivery isn’t available for this number — please pay online', code: 'history' };
  return null;
}

// ---------- confirmation ----------
const sig = (id) => crypto.createHmac('sha256', SECRET).update(`cod.${id}`).digest('base64url').slice(0, 24);
const sameSig = (a, b) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
const originOf = (base) => String(process.env.APP_URL || base || 'http://localhost:4000').replace(/\/+$/, '');
export const codLink = (base, id) => `${originOf(base)}/cod/${id}/${sig(id)}`;
const firstName = (o) => String(o.name || '').split(/\s+/)[0] || 'there';
const whatOf = (o) => o.items.filter((i) => !['shipping', 'cod_fee'].includes(i.kind)).map((i) => i.name).join(', ').slice(0, 200) || 'your order';

// a new COD order: awaiting the buyer's answer (only while the seller asks for confirmation)
export function codPlaced(owner, orderId, base) {
  if (!codSettings(owner).confirm || !orderId) return;
  const o = T.orders.get(orderId);
  if (!o || o.status !== 'cod' || o.demo || o.codStatus) return;
  T.orders.update(o.id, (x) => { x.codStatus = 'pending'; x.codConfirm = { sends: [] }; });
  sendConfirm(owner, o.id, base).catch((e) => console.error('COD confirmation not sent', e.message));
}

// WhatsApp template → WhatsApp buttons (24-hour window open) → email. The answer is due N hours after it went.
export async function sendConfirm(owner0, orderId, base) {
  const owner = T.users.get(owner0.id) || owner0;
  const o = T.orders.get(orderId);
  if (!o || o.status !== 'cod') return null;
  const s = codSettings(owner);
  const link = codLink(base, o.id), n = (o.codConfirm?.sends?.length || 0) + 1;
  const amount = money(o.total, o.currency || 'INR'), what = whatOf(o), ckey = contactKey(o.email, o.phone);
  let via = 'none';
  if (o.phone && waReady(owner, 'cod_confirm')) {
    const r = await waEvent(owner, 'cod_confirm', { to: o.phone, params: [firstName(o), what, amount], link, entityId: `${o.id}-${n}`, ckey });
    if (r.status === 'sent') via = 'whatsapp';
  }
  if (via === 'none' && o.phone) {
    const text = `Hi ${firstName(o)}, thank you for your Cash on Delivery order for ${what} (${amount} to pay on delivery). Please confirm it so we can ship it — tap Confirm or Cancel, or use this link: ${link}`;
    const r = await waButtons(owner, o.phone, text, [{ id: `cod:confirm:${o.id}`, title: 'Confirm' }, { id: `cod:cancel:${o.id}`, title: 'Cancel' }], `cod_btn:${o.id}-${n}`).catch(() => null);
    if (r?.status === 'sent') via = 'whatsapp_buttons';
  }
  if (via === 'none' && o.email) {
    const biz = owner.settings?.businessName || 'our store';
    const r = await sendEmail(owner, { to: o.email, subject: `Please confirm your Cash on Delivery order #${o.id}`, text: `Hi ${firstName(o)},\n\nThank you for your Cash on Delivery order for ${what}. The amount to pay on delivery is ${amount}.\n\nPlease confirm your order (or cancel it) here, so we can ship it:\n${link}\n\n— ${biz}` }).catch(() => null);
    if (r?.status === 'sent') via = 'email';
  }
  const now = Date.now();
  return T.orders.update(o.id, (x) => {
    if (x.codStatus === 'unconfirmed' && via !== 'none') x.codStatus = 'pending'; // a resend gives them time again
    x.codStatus ||= 'pending';
    x.codConfirm = { ...x.codConfirm, sends: [...(x.codConfirm?.sends || []), { at: now, via }].slice(-10), ...(via !== 'none' && x.codStatus === 'pending' ? { dueAt: now + s.hours * HOUR } : {}) };
  });
}

// The buyer's answer (WhatsApp reply / button, the link) or the seller's own note of it. → { ok, order, already? }
export function codAnswer(orderId, act, by) {
  const claimed = tx(() => {
    const o = T.orders.get(orderId);
    if (!o || o.status !== 'cod' || !['pending', 'unconfirmed'].includes(o.codStatus)) return null;
    return T.orders.update(o.id, (x) => { x.codStatus = act === 'confirm' ? 'confirmed' : 'cancelled'; x.codConfirm = { ...x.codConfirm, answeredAt: Date.now(), by }; });
  });
  if (!claimed) { const o = T.orders.get(orderId); return { ok: false, order: o, already: o?.codStatus || o?.status }; }
  let order = claimed;
  if (act === 'cancel') order = cancelCod(claimed, 'buyer_cancelled');
  const f = T.funnels.get(order.funnelId);
  const ev = act === 'confirm' ? 'cod_confirmed' : 'cod_cancelled';
  fireAutomation(order.userId, ev, { email: order.email, phone: order.phone, name: order.name, funnelId: order.funnelId, product: order.items[0]?.name, amount: order.cancelledAmount || order.total, source: order.source });
  const { userId, ...out } = order;
  fireWebhook(order.userId, act === 'confirm' ? 'cod.confirmed' : 'cod.cancelled', { funnel: f?.name, by, ...out });
  if (act === 'cancel' && by !== 'seller') notify(order.userId, { kind: 'order', title: `COD order cancelled by the buyer · #${order.id}`, body: `${order.name || order.phone || 'A buyer'} cancelled ${whatOf(order)}${f ? ` — ${f.name}` : ''}`, link: '/orders', ckey: contactKey(order.email, order.phone) });
  return { ok: true, order };
}

// "YES" / "NO" / a Confirm-Cancel button on WhatsApp → the newest COD order of that number awaiting an answer
const YES = /^\s*(yes|y|yes please|confirm|confirmed|ok|okay|haan|han|ha|haa|ji|1)\s*[.!👍✅]*\s*$/iu;
const NO = /^\s*(no|n|cancel|cancel it|cancelled|nahi|nahin|na|2)\s*[.!❌]*\s*$/iu;
function onReply(u, { num, text, d = {} }) {
  if (!u) return false;
  let order = null, act = null;
  const m = String(d.interactive_id || '').match(/^cod:(confirm|cancel):([\w-]{1,64})$/);
  if (m) {
    const o = T.orders.get(m[2]);
    if (!o || o.userId !== u.id || phoneTail(o.phone) !== phoneTail(num)) return false;
    order = o; act = m[1];
  } else {
    const said = String(d.button_text || d.interactive_title || text || '');
    act = YES.test(said) ? 'confirm' : NO.test(said) ? 'cancel' : null;
    if (!act) return false;
    order = ordersByPhone({ userId: u.id }, num).filter((o) => o.status === 'cod' && ['pending', 'unconfirmed'].includes(o.codStatus)).sort((a, b) => b.at - a.at)[0];
  }
  if (!order) return false;
  const r = codAnswer(order.id, act, 'whatsapp');
  if (!r.ok && !m) return false; // a plain "yes" with nothing left to answer goes to the inbox as usual
  // they just wrote, so the 24-hour window is open: a short thank-you
  const body = r.ok ? (act === 'confirm' ? `Thank you — your order #${order.id} is confirmed ✅ We’ll ship it soon.` : `Your order #${order.id} has been cancelled. Thank you for letting us know.`) : `Your order #${order.id} is already ${r.already}.`;
  waSession(u, num, { type: 'text', text: { body } }, { ikey: `cod_ack:${order.id}:${act}`, event: 'cod_ack' }).catch(() => {});
  return true;
}

// No answer in time → unconfirmed, and the seller hears about it (the bell, and their WhatsApp alert)
export function codTick(now = Date.now()) {
  try {
    const ids = q("SELECT id FROM orders WHERE json_extract(data, '$.codStatus') = 'pending' AND json_extract(data, '$.codConfirm.dueAt') <= ?").all(now).map((r) => r.id);
    for (const id of ids) {
      const o = tx(() => {
        const x = T.orders.get(id);
        if (!x || x.status !== 'cod' || x.codStatus !== 'pending' || !(x.codConfirm?.dueAt <= now)) return null;
        return T.orders.update(id, (y) => { y.codStatus = 'unconfirmed'; y.codConfirm = { ...y.codConfirm, expiredAt: now }; });
      });
      if (!o) continue;
      const f = T.funnels.get(o.funnelId);
      notify(o.userId, { kind: 'order', title: `COD order not confirmed · #${o.id} · ${money(o.total, o.currency || 'INR')}`, body: `${o.name || o.phone || 'The buyer'} hasn’t confirmed ${whatOf(o)} — call them before you ship, or resend the confirmation from Orders.`, link: '/orders', ckey: contactKey(o.email, o.phone) });
      sellerAlert(o.userId, { kind: 'unconfirmed COD order', where: f?.name || 'your store', what: `${money(o.total, o.currency || 'INR')} from ${o.name || o.phone || 'a buyer'} with no reply`, path: '/orders', entityId: `unconfirmed-${o.id}` });
      const { userId, ...out } = o;
      fireWebhook(o.userId, 'cod.unconfirmed', { funnel: f?.name, ...out });
    }
  } catch (e) { console.error('COD confirmation check failed', e.message); }
}

// ---------- the buyer's confirm / cancel page (a signed link; GET only shows it — link previews never act) ----------
const page = (title, inner) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${esc(title)}</title>
<style>body{margin:0;font:16px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#f6f7fb;color:#1f2330}main{max-width:440px;margin:40px auto;padding:28px 22px;background:#fff;border-radius:16px;box-shadow:0 4px 24px #0001}h1{font-size:21px;margin:0 0 10px}p{margin:8px 0}.amt{font-size:26px;font-weight:700}.row{display:flex;gap:10px;margin-top:20px}form{flex:1}button{width:100%;padding:13px;border:0;border-radius:10px;font-size:16px;font-weight:600;cursor:pointer}.ok{background:#16a34a;color:#fff}.no{background:#eef0f4;color:#b42318}.muted{color:#6b7280;font-size:14px}</style></head><body><main>${inner}</main></body></html>`;
function orderPage(o, k, note = '') {
  const biz = T.users.get(o.userId)?.settings?.businessName || '';
  const head = `<p class="muted">${esc(biz)}${biz ? ' · ' : ''}Order #${esc(o.id)}</p>`;
  const what = `<p>${esc(whatOf(o))}</p>`;
  if (o.codStatus === 'confirmed' && o.status === 'cod') return page('Order confirmed', `${head}<h1>Your order is confirmed ✅</h1>${what}<p class="amt">${esc(money(o.total, o.currency || 'INR'))}</p><p class="muted">Please keep this amount ready — it’s Cash on Delivery. ${esc(note)}</p>`);
  if (o.status === 'cancelled') return page('Order cancelled', `${head}<h1>This order is cancelled</h1>${what}<p class="muted">${esc(note)}</p>`);
  if (o.status !== 'cod' || !['pending', 'unconfirmed'].includes(o.codStatus)) return page('Your order', `${head}<h1>Thank you</h1>${what}<p class="muted">Nothing more is needed from you for this order.</p>`);
  return page('Confirm your order', `${head}<h1>Please confirm your Cash on Delivery order</h1>${what}<p class="amt">${esc(money(o.total, o.currency || 'INR'))}</p><p class="muted">to pay when it arrives${o.address?.city ? ` · delivering to ${esc(o.address.city)} ${esc(o.address.pincode)}` : ''}</p>
<div class="row"><form method="post" action="/cod/${esc(o.id)}/${esc(k)}/confirm"><button class="ok" type="submit">Confirm order</button></form><form method="post" action="/cod/${esc(o.id)}/${esc(k)}/cancel"><button class="no" type="submit">Cancel order</button></form></div>`);
}

export function registerCod(app, { auth, rateLimit, isTest, appUrl, pub, secret }) {
  SECRET = secret;
  onWaReply(onReply);
  const linkLimiter = rateLimit({ windowMs: 60000, max: isTest ? 1000 : 30, message: 'Too many tries — please wait a minute.' });
  const pinLimiter = rateLimit({ windowMs: 60000, max: isTest ? 5000 : 120, message: 'Too many PIN code checks — please wait a minute.' });
  const signed = (req, res) => {
    const o = T.orders.get(String(req.params.oid));
    const k = String(req.params.k || '');
    if (!o || o.paymentMethod !== 'cod' || !sameSig(k, sig(o.id))) { res.status(404).type('html').send(page('Not found', '<h1>This link isn’t valid</h1><p class="muted">Please use the latest message we sent you.</p>')); return null; }
    res.set('Cache-Control', 'no-store');
    return o;
  };
  app.get('/cod/:oid/:k', linkLimiter, (req, res) => { const o = signed(req, res); if (o) res.type('html').send(orderPage(o, req.params.k)); });
  app.post('/cod/:oid/:k/:act(confirm|cancel)', linkLimiter, (req, res) => {
    const o = signed(req, res); if (!o) return;
    const r = codAnswer(o.id, req.params.act, 'link');
    res.status(r.ok || r.already ? 200 : 400).type('html').send(orderPage(r.order || o, req.params.k, r.ok ? '' : 'This order was already answered.'));
  });

  // checkout: what a PIN code means here (delivery, COD, the state it's probably in)
  app.get('/api/public/:slug/pincode', pinLimiter, (req, res) => {
    const f = pub(req, res); if (!f) return;
    res.set('Cache-Control', 'no-store').json(pincodeInfo(T.users.get(f.userId), req.query.pin));
  });

  // the seller's settings
  const view = (u) => { const s = codSettings(u); return { ...s, pins: s.pins.join('\n'), noCod: s.noCod.join('\n'), confirmReady: waReady(u, 'cod_confirm') }; };
  app.get('/api/settings/cod', auth, (req, res) => res.json(view(req.user)));
  app.put('/api/settings/cod', auth, (req, res) => {
    const b = req.body || {}, cur = codSettings(req.user), next = { ...cur };
    if ('confirm' in b) next.confirm = !!b.confirm;
    if ('hours' in b) { const h = Number(b.hours); if (!Number.isFinite(h) || h < 1 || h > 168) return res.status(400).json({ error: 'Hours to confirm: 1 to 168' }); next.hours = Math.round(h); }
    if ('pinMode' in b) { if (!['off', 'allow', 'except'].includes(b.pinMode)) return res.status(400).json({ error: 'PIN codes: off, allow or except' }); next.pinMode = b.pinMode; }
    for (const k of ['pins', 'noCod']) {
      if (!(k in b)) continue;
      const p = parsePins(b[k]);
      if (p.bad.length) return res.status(400).json({ error: `Not a PIN code, prefix (302xxx) or range (302001-302039): ${p.bad.slice(0, 5).join(', ')}` });
      next[k] = p.list;
    }
    if ('maxCod' in b) { const v = Number(b.maxCod || 0); if (!Number.isFinite(v) || v < 0) return res.status(400).json({ error: 'Maximum COD order value must be 0 or more' }); next.maxCod = Math.round(v); }
    if ('blockAfter' in b) { const v = Number(b.blockAfter || 0); if (!Number.isInteger(v) || v < 0 || v > 20) return res.status(400).json({ error: 'Block after: 0 (off) to 20 orders' }); next.blockAfter = v; }
    if (next.pinMode === 'allow' && !next.pins.length) return res.status(400).json({ error: 'Add the PIN codes you deliver to (or choose “All India”)' });
    const u = T.users.update(req.user.id, (x) => { x.settings = { ...(x.settings || {}), cod: next }; });
    res.json(view(u));
  });

  // the buyer's COD record with this seller (Orders → an order)
  app.get('/api/orders/:oid/cod-risk', auth, (req, res) => {
    const o = T.orders.get(req.params.oid);
    if (!o || o.userId !== req.user.id) return res.status(404).json({ error: 'Order not found' });
    const h = o.phone ? codHistory(req.user.id, o.phone) : { orders: 0, rto: 0, cancelled: 0, unconfirmed: 0, delivered: 0, bad: 0 };
    res.json({ ...h, link: o.paymentMethod === 'cod' ? codLink(appUrl(req), o.id) : null });
  });

  if (JOBS) setInterval(() => codTick(), TICK).unref();
}

// Orders → an unpaid COD order: resend the confirmation, note the buyer's answer, or mark it returned (RTO).
// Called from the existing /api/orders/:oid/cod route (fulfilment.js). → [status, body] or null (not ours)
export async function codSellerAction(req, o, appUrl) {
  const a = req.body?.action;
  if (a === 'resend') {
    if (o.status !== 'cod') return [400, { error: 'Only unpaid COD orders are confirmed' }];
    if (o.codStatus && !['pending', 'unconfirmed'].includes(o.codStatus)) return [400, { error: `This order is already ${o.codStatus}` }];
    if (!o.phone && !o.email) return [400, { error: 'This order has no phone or email to send to' }];
    const out = await sendConfirm(req.user, o.id, appUrl(req));
    const via = out?.codConfirm?.sends?.at(-1)?.via || 'none';
    return [200, { ...out, sentVia: via }];
  }
  if (a === 'confirm' || a === 'mark_cancelled') {
    if (o.status !== 'cod') return [400, { error: 'This isn’t an unpaid Cash on Delivery order' }];
    if (!o.codStatus) T.orders.update(o.id, (x) => { x.codStatus = 'pending'; });
    const r = codAnswer(o.id, a === 'confirm' ? 'confirm' : 'cancel', 'seller');
    return r.ok ? [200, r.order] : [400, { error: `This order is already ${r.already}` }];
  }
  if (a === 'rto') {
    if (o.paymentMethod !== 'cod') return [400, { error: 'Only Cash on Delivery orders are marked RTO here' }];
    if (o.rtoAt) return [400, { error: 'Already marked returned (RTO)' }];
    if (o.status !== 'cod' && o.status !== 'cancelled') return [400, { error: 'This order was paid — mark it returned from Shipping and refund it' }];
    return [200, markRto(o)];
  }
  return null;
}
