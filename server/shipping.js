// Courier integration: the seller connects a courier aggregator (Shiprocket today — couriers/*.js are adapters with
// one shape, so Delhivery can be added as another), then ships an order from Orders: the order is created on the
// courier's side, the seller picks a courier (with rates) or takes the recommended one, an AWB is assigned, the
// pickup is requested and the label / manifest links are kept on the order. Tracking comes back by webhook (a
// per-seller secret URL) with a poll every few hours as the fallback, and moves the order's shipping along:
// delivered → fulfilment.js's "delivered" (a COD order's cash counts as collected, as with the manual flow),
// RTO → fulfilment.js markRto (counts in the buyer's COD record), undelivered (NDR) → the seller is told.
//
// Stored on the account (user.channels.<provider>, secrets encrypted with messaging.js, never sent back):
//   { email, passEnc, tokenEnc, tokenExp, pickups: [...], pickup, pkg: { weight, length, breadth, height },
//     notifyBuyer, checkPincode, hookEnc, hookHash, origin, connectedAt, error }
// On the order: order.shipment = { provider, orderId, shipmentId, awb, courier, courierId, rate, labelUrl,
//   manifestUrl, pickup: { scheduledFor, error }, stage, status, events: [...], ndr, createdAt, updatedAt, polledAt }
// and order.fulfilment.stage mirrors shipment.stage (fulfilment.status stays pending | shipped | delivered | returned).
import crypto from 'node:crypto';
import { T, q, JOBS } from './db.js';
import { encrypt, decrypt, setChannel, sendEmail } from './messaging.js';
import { applyFulfilment, markRto } from './fulfilment.js';
import { trackUrl } from './store-orders.js';
import { codSettings, usePincodeCourier, codDue } from './cod.js';
import { notify } from './notify.js';
import { linkBase } from './products.js';
import * as shiprocket from './couriers/shiprocket.js';
import { CourierError } from './couriers/shiprocket.js';

export const ADAPTERS = { shiprocket };
const POLL_EVERY = Number(process.env.SHIP_POLL_MS || 3 * 3600000);  // the fallback poll
const POLL_AGE = Number(process.env.SHIP_POLL_AGE_MS ?? 2 * 3600000); // a shipment is checked at most this often
const POLL_MAX = Number(process.env.SHIP_POLL_MAX || 60);             // shipments per poll run
const POLL_GAP = Number(process.env.SHIP_POLL_GAP_MS ?? 1500);        // between two tracking calls
const FINAL = ['delivered', 'rto_delivered', 'cancelled', 'lost'];
const clip = (v, n) => String(v ?? '').trim().slice(0, n);
const err = (msg, status = 400, extra = {}) => new CourierError(msg, status, extra);
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const DEF_PKG = { weight: 0.5, length: 15, breadth: 12, height: 8 };
export const STAGES = { booked: 'Booked — pickup requested', picked_up: 'Picked up', in_transit: 'In transit', out_for_delivery: 'Out for delivery', delivered: 'Delivered', ndr: 'Delivery attempt failed (NDR)', rto_initiated: 'Returning to you (RTO)', rto_delivered: 'Returned to you (RTO delivered)', cancelled: 'Shipment cancelled', lost: 'Lost / damaged' };

const cfgOf = (u, p = 'shiprocket') => u?.channels?.[p] || null;
const connected = (u, p = 'shiprocket') => !!(cfgOf(u, p)?.email && cfgOf(u, p)?.passEnc);
const pkgOf = (c) => ({ ...DEF_PKG, ...(c?.pkg || {}) });

// ---------- the token: kept ~9 days, refreshed when Shiprocket says 401 ----------
const logins = new Map();
async function freshToken(userId, p) {
  const key = `${userId}:${p}`;
  if (logins.has(key)) return logins.get(key);
  const run = (async () => {
    const c = cfgOf(T.users.get(userId), p);
    if (!c?.passEnc) throw err('Connect Shiprocket first (Settings → Shipping)');
    try {
      const t = await ADAPTERS[p].login({ email: c.email, password: decrypt(c.passEnc) });
      T.users.update(userId, (x) => { if (x.channels?.[p]) Object.assign(x.channels[p], { tokenEnc: encrypt(t.token), tokenExp: t.expiresAt, error: '' }); });
      return t.token;
    } catch (e) {
      T.users.update(userId, (x) => { if (x.channels?.[p]) x.channels[p].error = e.message; });
      throw e;
    }
  })().finally(() => logins.delete(key));
  logins.set(key, run);
  return run;
}
async function ctxFor(u, p = 'shiprocket') {
  const c = cfgOf(T.users.get(u.id) || u, p);
  if (!c?.passEnc) throw err('Connect Shiprocket first (Settings → Shipping)');
  const ctx = { token: c.tokenEnc && c.tokenExp > Date.now() ? decrypt(c.tokenEnc) : '', relogin: () => freshToken(u.id, p) };
  if (!ctx.token) ctx.token = await freshToken(u.id, p);
  return ctx;
}

// ---------- what the seller sees (no password, no token) ----------
function view(u, req, appUrl) {
  const c = cfgOf(u) || {};
  const origin = String(process.env.APP_URL || (req ? appUrl(req) : c.origin) || '').replace(/\/+$/, '');
  const hook = c.hookEnc ? decrypt(c.hookEnc) : '';
  return {
    providers: Object.entries(ADAPTERS).map(([id, a]) => ({ id, name: a.name })),
    shiprocket: { connected: connected(u), email: c.email || '', hasPassword: !!c.passEnc, pickups: c.pickups || [], pickup: c.pickup || '', pkg: pkgOf(c), notifyBuyer: !!c.notifyBuyer, checkPincode: !!c.checkPincode, connectedAt: c.connectedAt || null, error: c.error || '', webhookUrl: hook ? `${origin}/api/tracking-updates/${hook}` : '', webhookToken: hook },
    codConfirm: !!codSettings(u).confirm,
  };
}
const num = (v, lo, hi) => { const n = Number(v); return Number.isFinite(n) && n >= lo && n <= hi ? n : null; };

// ---------- shipping one order ----------
const PRODUCT_KINDS = (i) => !['shipping', 'cod_fee'].includes(i.kind) && !i.refunded && Number(i.price) >= 0;
const sum = (l) => l.reduce((a, i) => a + Number(i.price || 0), 0);
const slug = (s) => String(s || 'item').toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'ITEM';

// a COD order the buyer cancelled, or (when the seller asks buyers to confirm) one not confirmed yet → the reason
export function codBlock(u, o) {
  if (o.status !== 'cod') return null;
  if (o.codStatus === 'cancelled') return 'The buyer cancelled this Cash on Delivery order.';
  if (codSettings(u).confirm && o.codStatus !== 'confirmed') return o.codStatus === 'unconfirmed' ? 'The buyer didn’t confirm this Cash on Delivery order. Call them first — or ship it anyway.' : 'The buyer hasn’t confirmed this Cash on Delivery order yet. Wait for their reply — or ship it anyway.';
  return null;
}
function shippable(u, o, { override } = {}) {
  if (['cancelled', 'refunded'].includes(o.status)) throw err(`This order is ${o.status}`);
  if (!o.address?.pincode) throw err('This order has no delivery address');
  if (!o.fulfilment) throw err('This order has nothing to ship');
  if (['delivered', 'returned'].includes(o.fulfilment.status)) throw err(`This order is already ${o.fulfilment.status}`);
  if (o.shipment?.awb) throw err(`Already shipped with ${o.shipment.courier || 'a courier'} · AWB ${o.shipment.awb}`);
  const block = codBlock(u, o);
  if (block && !(override && o.codStatus !== 'cancelled')) throw err(block, 409, { code: o.codStatus === 'cancelled' ? 'cod_cancelled' : 'cod_unconfirmed', canOverride: o.codStatus !== 'cancelled' });
}
function courierOrder(o, c, pkg) {
  const items = o.items.filter(PRODUCT_KINDS).filter((i) => Number(i.price) > 0 || i.kind === 'main');
  const subTotal = sum(items), shipping = sum(o.items.filter((i) => i.kind === 'shipping' && !i.refunded)), codFee = sum(o.items.filter((i) => i.kind === 'cod_fee' && !i.refunded));
  const [first, ...rest] = String(o.name || 'Customer').trim().split(/\s+/);
  return {
    ref: o.id, at: o.at, pickup: c.pickup,
    buyer: { first: first || 'Customer', last: rest.join(' '), phone: String(o.phone || '').replace(/\D/g, '').slice(-10), email: o.email || '', address: o.address },
    items: items.map((i) => { const qty = Math.max(1, Number(i.qty) || 1); const prod = i.productId ? T.products.get(i.productId) : null; return { name: clip(i.name, 200) || 'Item', sku: clip(i.sku || prod?.sku || (i.productId ? `P-${i.productId}` : slug(i.name)), 50), qty, price: Math.round((Number(i.price) / qty) * 100) / 100, hsn: prod?.hsn || '' }; }),
    // a COD order's advance paid online (cod.js) is taken off as a discount, so the courier collects only what's due
    cod: o.status === 'cod', subTotal, shipping, codFee, discount: Math.max(0, Math.round((subTotal + shipping + codFee - (o.status === 'cod' ? codDue(o) : Number(o.total || 0))) * 100) / 100), pkg,
  };
}
const saveShipment = (id, patch) => T.orders.update(id, (x) => { x.shipment = { ...(x.shipment || {}), ...patch, updatedAt: Date.now() }; });

export async function quote(u, o, { pkg: pkgIn } = {}) {
  const c = cfgOf(u);
  if (!connected(u)) throw err('Connect Shiprocket first (Settings → Shipping)');
  const from = (c.pickups || []).find((p) => p.name === c.pickup)?.pincode;
  if (!from) throw err('Choose your pickup address in Settings → Shipping');
  if (!o.address?.pincode) throw err('This order has no delivery address');
  const pkg = { ...pkgOf(c), ...(pkgIn || {}) };
  const ctx = await ctxFor(u);
  return { ...(await shiprocket.rates(ctx, { from, to: o.address.pincode, cod: o.status === 'cod', weight: pkg.weight })), pickup: c.pickup, pkg };
}

// create (once) → assign an AWB → request the pickup → label + manifest → "shipped". Each step is kept on the order,
// so a retry after a failure carries on where it stopped.
export async function shipOrder(u0, o0, { courierId, override, pkg: pkgIn } = {}) {
  const u = T.users.get(u0.id) || u0;
  let o = T.orders.get(o0.id);
  const c = cfgOf(u);
  if (!connected(u)) throw err('Connect Shiprocket first (Settings → Shipping)');
  if (!c.pickup) throw err('Choose your pickup address in Settings → Shipping');
  shippable(u, o, { override });
  const pkg = { ...pkgOf(c), ...(pkgIn || {}) };
  const ctx = await ctxFor(u);
  if (!o.shipment?.shipmentId || o.shipment.provider !== 'shiprocket') {
    const r = await shiprocket.createOrder(ctx, courierOrder(o, c, pkg));
    o = saveShipment(o.id, { provider: 'shiprocket', orderId: r.orderId, shipmentId: r.shipmentId, pkg, createdAt: Date.now(), ...(override && codBlock(u, o) ? { codOverride: { at: Date.now(), was: o.codStatus || null } } : {}) });
  }
  let chosen = Number(courierId) || null, rate = null;
  if (!chosen) {
    const from = (c.pickups || []).find((p) => p.name === c.pickup)?.pincode;
    const r = await shiprocket.rates(ctx, { from, to: o.address.pincode, cod: o.status === 'cod', weight: pkg.weight, orderId: o.shipment.orderId });
    if (!r.couriers.length) throw err('No courier serves this PIN code for this shipment');
    chosen = r.recommended; rate = r.couriers.find((x) => x.id === chosen)?.rate ?? null;
  }
  const a = await shiprocket.assign(ctx, o.shipment.shipmentId, chosen);
  o = saveShipment(o.id, { awb: a.awb, courierId: a.courierId, courier: a.courier, ...(rate != null ? { rate } : {}), stage: 'booked', status: 'AWB assigned' });
  const sid = o.shipment.shipmentId;
  const pk = await shiprocket.pickup(ctx, sid).catch((e) => ({ error: e.message }));
  const labelUrl = await shiprocket.label(ctx, sid).catch(() => '');
  const manifestUrl = await shiprocket.manifest(ctx, sid).catch(() => '');
  o = saveShipment(o.id, { pickup: pk, labelUrl, manifestUrl, events: [{ at: Date.now(), status: pk.error ? 'AWB assigned — pickup not requested' : 'AWB assigned · pickup requested', activity: pk.error || (pk.scheduledFor ? `Pickup on ${pk.scheduledFor}` : ''), location: c.pickup }] });
  return applyFulfilment(u, o, 'shipped', { courier: a.courier || 'Shiprocket', tracking: a.awb, trackingUrl: `https://shiprocket.co/tracking/${encodeURIComponent(a.awb)}`, buyer: !!c.notifyBuyer, set: { stage: 'booked', provider: 'shiprocket' } }, baseOf(u, o));
}
const baseOf = (u, o) => linkBase(o.funnelId, process.env.APP_URL || cfgOf(u)?.origin || 'http://localhost:4000');

// ---------- tracking ----------
const same = (a, b) => a.at === b.at && a.status === b.status;
// a tracking update (webhook or poll) → the order's stage, and what follows from it
export function applyTracking(o0, upd, via) {
  const o = T.orders.get(o0.id);
  if (!o?.shipment) return null;
  const u = T.users.get(o.userId);
  const st = shiprocket.stage(upd.status, upd.statusId) || o.shipment.stage;
  const prev = o.shipment.stage;
  const events = [...(o.shipment.events || [])];
  for (const e of upd.events || []) if (!events.some((x) => same(x, e))) events.push(e);
  if (upd.status && !(upd.events || []).length && prev !== st) events.push({ at: Date.now(), status: clip(upd.status, 120), activity: '', location: '' });
  events.sort((a, b) => a.at - b.at);
  let order = T.orders.update(o.id, (x) => {
    x.shipment = { ...x.shipment, stage: st, status: clip(upd.status, 120) || x.shipment.status, events: events.slice(-50), updatedAt: Date.now(), [via === 'poll' ? 'polledAt' : 'hookAt']: Date.now(), ...(upd.trackUrl ? { trackUrl: clip(upd.trackUrl, 300) } : {}), ...(upd.etd ? { etd: clip(upd.etd, 40) } : {}) };
    if (st === 'ndr' && prev !== 'ndr') x.shipment.ndr = { at: Date.now(), reason: clip(upd.events?.at(-1)?.activity || upd.status, 200), count: (x.shipment.ndr?.count || 0) + 1 };
    if (x.fulfilment) x.fulfilment.stage = st;
  });
  if (st === prev || !u) return order;
  const who = o.name || o.phone || 'the buyer', ck = o.email || '';
  if (st === 'delivered' && order.fulfilment?.status !== 'delivered' && !['cancelled', 'refunded'].includes(order.status)) {
    order = applyFulfilment(u, order, 'delivered', { set: { stage: 'delivered' } }, baseOf(u, order));
  } else if ((st === 'rto_initiated' || st === 'rto_delivered') && !order.rtoAt && order.cancelReason !== 'returned' && order.status !== 'refunded') {
    order = markRto(order);
    notify(o.userId, { kind: 'order', title: `Returning to you (RTO) · #${o.id}`, body: `${o.shipment.courier || 'The courier'} is returning ${who}’s parcel (AWB ${o.shipment.awb}).${o.status === 'cod' ? ' The unpaid COD order was cancelled.' : ''}`, link: '/orders', ckey: ck });
  } else if (st === 'ndr') {
    notify(o.userId, { kind: 'order', title: `Delivery failed · #${o.id}`, body: `${o.shipment.courier || 'The courier'} couldn’t deliver to ${who}: ${order.shipment.ndr?.reason || 'undelivered'}. Call the buyer, then reattempt or return it in Shiprocket.`, link: '/orders', ckey: ck });
  } else if (st === 'lost' || st === 'cancelled') {
    notify(o.userId, { kind: 'order', title: `Shipment ${st === 'lost' ? 'lost or damaged' : 'cancelled'} · #${o.id}`, body: `AWB ${o.shipment.awb} with ${o.shipment.courier || 'the courier'} — check it in Shiprocket.`, link: '/orders', ckey: ck });
  } else if (st === 'out_for_delivery' && cfgOf(u)?.notifyBuyer && o.email) {
    const first = String(o.name || '').split(/\s+/)[0] || 'there', biz = u.settings?.businessName || u.name;
    sendEmail(u, { to: o.email, subject: 'Your order is out for delivery today 🚚', text: `Hi ${first},\n\nYour order (#${o.id}) is out for delivery with ${o.shipment.courier || 'our courier'}.${order.fulfilment?.trackingUrl ? `\nTrack it here: ${order.fulfilment.trackingUrl}` : ''}${trackUrl(o) ? `\nYour order page: ${trackUrl(o)}` : ''}${o.status === 'cod' ? `\n\nPlease keep ₹${codDue(o).toLocaleString('en-IN')} ready — it’s Cash on Delivery.` : ''}\n\n— ${biz}` }).catch(() => {});
  }
  return T.orders.get(o.id);
}

// cancel a booked shipment before the courier picks it up: Shiprocket cancels it, the order goes back to "not shipped"
// (the cancelled shipment is kept in its history) so it can be shipped again; after pickup it's an RTO, not a cancel
const PICKED = ['picked_up', 'in_transit', 'out_for_delivery', 'delivered', 'ndr', 'rto_initiated', 'rto_delivered', 'lost'];
export async function cancelShipment(u, o) {
  const sh = o.shipment;
  if (!sh?.provider) throw err('This order hasn’t been shipped with a courier');
  if (sh.stage === 'cancelled') throw err('This shipment is already cancelled');
  if (PICKED.includes(sh.stage)) throw err('The courier has already picked this up — ask them to return it (RTO) instead', 409);
  const ctx = await ctxFor(u, sh.provider);
  await shiprocket.cancel(ctx, { orderId: sh.orderId, awb: sh.awb });
  return T.orders.update(o.id, (x) => {
    x.cancelledShipments = [...(x.cancelledShipments || []), { ...x.shipment, stage: 'cancelled', cancelledAt: Date.now() }].slice(-10);
    delete x.shipment;
    if (x.fulfilment) x.fulfilment = { status: 'pending', at: Date.now() };
  });
}

export async function trackNow(u, o) {
  if (!o.shipment?.awb) throw err('This order hasn’t been shipped with Shiprocket');
  const ctx = await ctxFor(u, o.shipment.provider || 'shiprocket');
  const t = await shiprocket.track(ctx, o.shipment.awb);
  return applyTracking(o, t, 'poll');
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let polling = false;
export async function pollShipments(now = Date.now()) {
  if (polling) return 0;
  polling = true;
  let n = 0;
  try {
    const rows = q(`SELECT id FROM orders WHERE json_extract(data, '$.shipment.awb') IS NOT NULL AND IFNULL(json_extract(data, '$.shipment.stage'), '') NOT IN (${FINAL.map(() => '?').join(',')}) AND IFNULL(json_extract(data, '$.shipment.polledAt'), 0) <= ? ORDER BY IFNULL(json_extract(data, '$.shipment.polledAt'), 0) LIMIT ?`).all(...FINAL, now - POLL_AGE, POLL_MAX);
    for (const { id } of rows) {
      const o = T.orders.get(id), u = o && T.users.get(o.userId);
      if (!o || !u || !connected(u, o.shipment.provider || 'shiprocket')) { if (o) saveShipment(id, { polledAt: now }); continue; }
      try { await trackNow(u, o); n++; } catch (e) { saveShipment(id, { polledAt: now, pollError: clip(e.message, 200) }); }
      if (POLL_GAP) await sleep(POLL_GAP);
    }
  } catch (e) { console.error('Shipment tracking poll failed', e.message); } finally { polling = false; }
  return n;
}

// ---------- checkout: can a courier deliver here (and take cash)? Cached per PIN code for 12 hours ----------
const pinCache = new Map();
async function courierPincode(u, pin) {
  const c = cfgOf(u);
  if (!connected(u) || !c.checkPincode) return null;
  const from = (c.pickups || []).find((p) => p.name === c.pickup)?.pincode;
  if (!from) return null;
  const key = `${u.id}:${from}:${pin}`, hit = pinCache.get(key);
  if (hit && hit.exp > Date.now()) return hit.v;
  const ctx = await ctxFor(u);
  const [any, cod] = await Promise.all([shiprocket.rates(ctx, { from, to: pin, cod: false, weight: pkgOf(c).weight }).catch(() => null), shiprocket.rates(ctx, { from, to: pin, cod: true, weight: pkgOf(c).weight }).catch(() => null)]);
  if (!any) return null; // unknown: the seller's own rules stand
  const v = { deliverable: any.couriers.length > 0, cod: !!cod?.couriers.length };
  if (pinCache.size > 20000) pinCache.clear();
  pinCache.set(key, { v, exp: Date.now() + 12 * 3600000 });
  return v;
}

// ---------- routes ----------
export function registerShipping(app, { auth, wrap, rateLimit, isTest, appUrl }) {
  usePincodeCourier(courierPincode);
  const provider = (req, res) => { if (!ADAPTERS[req.params.provider]) { res.status(404).json({ error: 'Unknown courier' }); return null; } return req.params.provider; };
  const own = (req, res) => { const o = T.orders.get(req.params.oid); if (!o || o.userId !== req.user.id) { res.status(404).json({ error: 'Order not found' }); return null; } return o; };
  const fail = (res, e) => { if (e instanceof CourierError || (e.status >= 400 && e.status < 500)) return res.status(e.status || 400).json({ error: e.message, ...(e.code ? { code: e.code, canOverride: !!e.canOverride } : {}) }); throw e; };
  const shipLimiter = rateLimit({ windowMs: 60000, max: isTest ? 5000 : 60, key: (req) => req.user.id, message: 'Too many shipping requests — please wait a minute.' });
  const hookLimiter = rateLimit({ windowMs: 60000, max: isTest ? 5000 : 600, message: 'Too many tracking updates' });

  app.get('/api/settings/shipping', auth, (req, res) => res.json(view(req.user, req, appUrl)));
  // connect / update: the API user's email + password (checked by logging in), the pickup address, package defaults
  app.put('/api/settings/shipping/:provider', auth, shipLimiter, wrap(async (req, res) => {
    const p = provider(req, res); if (!p) return;
    const b = req.body || {}, cur = cfgOf(req.user, p) || {};
    const next = { ...cur };
    const email = 'email' in b ? clip(b.email, 120).toLowerCase() : cur.email;
    const password = String(b.password ?? '').trim();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Enter your Shiprocket API user’s email' });
    if (!password && !cur.passEnc) return res.status(400).json({ error: 'Enter your Shiprocket API user’s password' });
    if (b.pkg && typeof b.pkg === 'object') {
      const k = { weight: num(b.pkg.weight, 0.01, 100), length: num(b.pkg.length, 0.5, 300), breadth: num(b.pkg.breadth, 0.5, 300), height: num(b.pkg.height, 0.5, 300) };
      if (Object.values(k).some((v) => v === null)) return res.status(400).json({ error: 'Package: weight 0.01–100 kg, sides 0.5–300 cm' });
      next.pkg = k;
    }
    for (const k of ['notifyBuyer', 'checkPincode']) if (k in b) next[k] = !!b[k];
    if (password || email !== cur.email) {
      let t;
      try { t = await ADAPTERS[p].login({ email, password: password || decrypt(cur.passEnc) }); } catch (e) { return fail(res, e); }
      Object.assign(next, { email, passEnc: password ? encrypt(password) : cur.passEnc, tokenEnc: encrypt(t.token), tokenExp: t.expiresAt, connectedAt: Date.now(), error: '' });
      try { next.pickups = await ADAPTERS[p].pickups({ token: t.token }); } catch (e) { next.pickups = cur.pickups || []; next.error = e.message; }
    }
    if ('pickup' in b) { const pk = clip(b.pickup, 120); if (pk && !(next.pickups || []).some((x) => x.name === pk)) return res.status(400).json({ error: 'Choose one of your Shiprocket pickup addresses' }); next.pickup = pk; }
    if (!next.pickup && next.pickups?.length) next.pickup = next.pickups.find((x) => x.name === 'Primary')?.name || next.pickups[0].name;
    if (!next.hookEnc) { const tok = crypto.randomBytes(24).toString('hex'); Object.assign(next, { hookEnc: encrypt(tok), hookHash: sha(tok) }); }
    next.origin = String(process.env.APP_URL || appUrl(req)).replace(/\/+$/, '');
    const u = setChannel(req.user.id, p, next);
    res.json(view(u, req, appUrl));
  }));
  app.post('/api/settings/shipping/:provider/pickups', auth, shipLimiter, wrap(async (req, res) => {
    const p = provider(req, res); if (!p) return;
    try {
      const list = await ADAPTERS[p].pickups(await ctxFor(req.user, p));
      const u = T.users.update(req.user.id, (x) => { x.channels[p].pickups = list; if (!list.some((y) => y.name === x.channels[p].pickup)) x.channels[p].pickup = list[0]?.name || ''; x.channels[p].error = ''; });
      res.json(view(u, req, appUrl));
    } catch (e) { fail(res, e); }
  }));
  // a new tracking URL (the old one stops working)
  app.post('/api/settings/shipping/:provider/webhook', auth, (req, res) => {
    const p = provider(req, res); if (!p) return;
    if (!connected(req.user, p)) return res.status(400).json({ error: 'Connect Shiprocket first' });
    const tok = crypto.randomBytes(24).toString('hex');
    const u = T.users.update(req.user.id, (x) => { Object.assign(x.channels[p], { hookEnc: encrypt(tok), hookHash: sha(tok) }); });
    res.json(view(u, req, appUrl));
  });
  app.delete('/api/settings/shipping/:provider', auth, (req, res) => {
    const p = provider(req, res); if (!p) return;
    res.json(view(setChannel(req.user.id, p, undefined), req, appUrl));
  });

  // an order: couriers + rates, ship it, refresh its tracking
  app.get('/api/orders/:oid/shipping/rates', auth, shipLimiter, wrap(async (req, res) => {
    const o = own(req, res); if (!o) return;
    try { res.json({ ...(await quote(req.user, o)), codBlock: codBlock(req.user, o) }); } catch (e) { fail(res, e); }
  }));
  app.post('/api/orders/:oid/shipping/:provider', auth, shipLimiter, wrap(async (req, res) => {
    const o = own(req, res); if (!o) return;
    if (!provider(req, res)) return;
    const b = req.body || {};
    try { res.json(await shipOrder(req.user, o, { courierId: b.courierId, override: !!b.override, pkg: pkgBody(b.pkg) })); } catch (e) { fail(res, e); }
  }));
  app.post('/api/orders/:oid/shipping-cancel', auth, shipLimiter, wrap(async (req, res) => {
    const o = own(req, res); if (!o) return;
    try { res.json(await cancelShipment(req.user, o)); } catch (e) { fail(res, e); }
  }));
  app.post('/api/orders/:oid/shipping-track', auth, shipLimiter, wrap(async (req, res) => {
    const o = own(req, res); if (!o) return;
    try { res.json(await trackNow(req.user, o)); } catch (e) { fail(res, e); }
  }));
  // several orders, one after the other, each with the recommended courier → a result per order
  app.post('/api/shipping/:provider/bulk', auth, shipLimiter, wrap(async (req, res) => {
    if (!provider(req, res)) return;
    const ids = [...new Set((Array.isArray(req.body?.orders) ? req.body.orders : []).map(String))].slice(0, 50);
    if (!ids.length) return res.status(400).json({ error: 'Choose the orders to ship' });
    const results = [];
    for (const id of ids) {
      const o = T.orders.get(id);
      if (!o || o.userId !== req.user.id) { results.push({ id, ok: false, error: 'Order not found' }); continue; }
      try { const r = await shipOrder(req.user, o, { override: !!req.body.override }); results.push({ id, ok: true, awb: r.shipment?.awb, courier: r.shipment?.courier }); } catch (e) {
        if (!(e instanceof CourierError) && !(e.status >= 400 && e.status < 500)) console.error('Bulk ship failed', e);
        results.push({ id, ok: false, error: e.message, ...(e.code ? { code: e.code } : {}) });
      }
    }
    res.json({ shipped: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length, results });
  }));

  // Shiprocket's tracking webhook: the seller's secret URL (hex, so it never contains words Shiprocket refuses in
  // webhook URLs). If the seller also sets the token in Shiprocket, it arrives as x-api-key and must match.
  app.post('/api/tracking-updates/:token', hookLimiter, (req, res) => {
    const tok = String(req.params.token || '');
    if (!/^[0-9a-f]{48}$/.test(tok)) return res.status(404).json({ error: 'Not found' });
    const row = q("SELECT id FROM users WHERE json_extract(data, '$.channels.shiprocket.hookHash') = ?").get(sha(tok));
    if (!row) return res.status(404).json({ error: 'Not found' });
    const key = req.headers['x-api-key'];
    if (key && String(key) !== tok) return res.status(401).json({ error: 'Wrong token' });
    const upd = shiprocket.webhook(req.body || {});
    if (!upd.awb) return res.json({ ok: true, ignored: 'no awb' }); // Shiprocket's test ping
    const id = q("SELECT id FROM orders WHERE userId = ? AND json_extract(data, '$.shipment.awb') = ? LIMIT 1").get(row.id, upd.awb)?.id;
    const o = id && T.orders.get(id);
    if (!o) return res.json({ ok: true, ignored: 'unknown awb' }); // 200, or Shiprocket keeps retrying
    applyTracking(o, upd, 'webhook');
    res.json({ ok: true });
  });

  if (JOBS) setInterval(() => { pollShipments().catch(() => {}); }, POLL_EVERY).unref();
}
const pkgBody = (p) => {
  if (!p || typeof p !== 'object') return undefined;
  const out = {};
  for (const [k, lo, hi] of [['weight', 0.01, 100], ['length', 0.5, 300], ['breadth', 0.5, 300], ['height', 0.5, 300]]) { const v = num(p[k], lo, hi); if (v !== null) out[k] = v; }
  return out;
};
