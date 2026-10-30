// Storefront: a seller's shop at /s/<handle> — digital Products and (with the Inventory add-on) stock items, a cart,
// and one checkout for the whole cart. Everything that takes money reuses the funnel checkout's machinery:
//   - orders are recorded by index.js recordOrder() against a "store funnel" (storeFunnel(): id store_<userId>,
//     no steps), so the Orders page, GST invoices (one line per item, with its own HSN / rate), digital delivery,
//     webhooks, automations, WhatsApp receipts and COD settlement all work as for funnels;
//   - payments are rows in T.payments (kind 'store') finished by index.js finalizePayment(), so the Razorpay and
//     Stripe webhooks complete a store payment the browser never confirmed;
//   - coupons (couponFor / discountFor), COD rules (cod.js) and buyer cleaning (buyerOf) are the funnel ones.
// Prices are always computed here from the catalog; the browser sends only listing ids and quantities.
//
// Stock (inventory items): checked when the buyer starts paying (an oversell is refused with a clear message) and
// taken as a SALE move once the money is in (or the COD order is booked). Nothing is reserved: two buyers can pay for
// the last unit at the same moment. The payment that lands second is still honoured — the move is recorded with
// allowNegative, the order is flagged (order.stockShort) and the seller is told, so they can refund or restock.
import crypto from 'node:crypto';
import { T, q, uid, contactKey } from './db.js';
import { accessFor } from './billing.js';
import { inventoryOn, stockOf, addMove } from './inventory-core.js';
import { GST_RATES } from './sales.js';
import { rzpCreds, createOrder as rzpCreateOrder, validPayment } from './razorpay.js';
import { stripeCreds, startStripePayment, confirmedIntent } from './stripe.js';
import { codCheckoutError, shipError, codPlaced } from './cod.js';
import { waRequired, waPhoneOk } from './hive-wa.js';
import { notify } from './notify.js';

const clip = (v, n) => String(v ?? '').trim().slice(0, n);
const r2 = (n) => Math.round(n * 100) / 100;
const HANDLE = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/;
const RESERVED = new Set(['api', 'admin', 'store', 'shop', 'www', 'app', 'login', 'cart', 'checkout']);
const imgOk = (u) => /^(https:\/\/|\/uploads\/)[^\s"'<>]{1,500}$/.test(String(u || ''));
const urlOk = (u) => /^https?:\/\/[^\s"'<>]{1,500}$/.test(String(u || ''));
const MAX_LINES = 50, MAX_QTY = 999;

export const storeFunnelId = (userId) => `store_${userId}`;
export const STORE_NAME = 'Online store';
const storeOf = (userId) => T.stores.find({ userId });
// the "funnel" store orders and payments hang off — enough of one for recordOrder / deliver / invoices
export function storeFunnel(userIdOrStore) {
  const s = typeof userIdOrStore === 'string' ? storeOf(userIdOrStore) : userIdOrStore;
  const userId = typeof userIdOrStore === 'string' ? userIdOrStore : s?.userId;
  if (!userId) return null;
  const owner = T.users.get(userId);
  return { id: storeFunnelId(userId), userId, name: s?.name || owner?.settings?.businessName || STORE_NAME, slug: s?.handle || '', steps: [], store: true, theme: { primary: s?.color || '#6366f1' } };
}

// ---------- stock, taken when an order is paid (or booked as COD) — called from recordOrder ----------
export function takeStock(order, items) {
  const short = [];
  for (const it of items) {
    if (!it.itemId || !(it.qty > 0)) continue;
    const item = T.iitems.get(it.itemId);
    if (!item || item.userId !== order.userId) continue;
    if (stockOf(item.id) < it.qty) short.push(item.name);
    // from the godown that holds the most of it (addMove would otherwise use the main one)
    const g = q("SELECT godownId, SUM(json_extract(data, '$.qty')) AS n FROM imoves WHERE itemId = ? GROUP BY godownId ORDER BY n DESC LIMIT 1").get(item.id);
    try {
      addMove(order.userId, { itemId: item.id, godownId: g?.godownId || null, kind: 'SALE', qty: it.qty, rate: it.unitPrice, party_name: order.name || order.email || order.phone || 'Store buyer', ref: `Order ${order.id}`, note: 'Online store' }, { allowNegative: true });
    } catch (e) { console.error('store stock move failed', e.message); }
  }
  if (short.length) {
    T.orders.update(order.id, (o) => { o.stockShort = short; });
    notify(order.userId, { kind: 'order', title: `Sold more than you had in stock · #${order.id}`, body: `${short.join(', ')} — another buyer paid for the last units at the same time. Restock or refund this order.`, link: '/orders', ckey: contactKey(order.email, order.phone) });
  }
}

// ---------- cleaning ----------
function cleanStore(b, cur = {}) {
  const out = {};
  if ('enabled' in b) out.enabled = !!b.enabled;
  if ('handle' in b) {
    const h = clip(b.handle, 40).toLowerCase();
    if (!HANDLE.test(h) || RESERVED.has(h)) return { error: 'The store address is 3–40 letters, numbers or dashes (not starting or ending with a dash)' };
    out.handle = h;
  }
  for (const [k, n] of [['name', 80], ['tagline', 160], ['about', 2000]]) if (k in b) out[k] = clip(b[k], n);
  if ('color' in b) { const c = clip(b.color, 9); if (c && !/^#[0-9a-fA-F]{6}$/.test(c)) return { error: 'Brand colour is a hex colour like #6366f1' }; out.color = c || '#6366f1'; }
  if ('logo' in b) { if (b.logo && !imgOk(b.logo)) return { error: 'Logo must be an uploaded image' }; out.logo = b.logo || ''; }
  if ('categories' in b) out.categories = [...new Set((Array.isArray(b.categories) ? b.categories : []).map((c) => clip(c, 40)).filter(Boolean))].slice(0, 40);
  if ('shipping' in b) {
    const s = b.shipping || {}, fee = Number(s.fee || 0), above = Number(s.freeAbove || 0);
    if (!Number.isFinite(fee) || fee < 0 || fee > 100000 || !Number.isFinite(above) || above < 0) return { error: 'Shipping fee and free-shipping amount must be 0 or more' };
    out.shipping = { fee: Math.round(fee), freeAbove: Math.round(above) };
  }
  if ('cod' in b) {
    const c = b.cod || {}, fee = Number(c.fee || 0);
    if (!Number.isFinite(fee) || fee < 0 || fee > 10000) return { error: 'COD fee must be 0 or more' };
    out.cod = { enabled: !!c.enabled, fee: Math.round(fee) };
  }
  if ('policies' in b) {
    const p = b.policies || {}, pol = {};
    for (const k of ['refund', 'shipping', 'terms', 'privacy', 'contact']) {
      const v = clip(p[k], 500);
      if (v && !urlOk(v)) return { error: `The ${k} policy link must start with https://` };
      if (v) pol[k] = v;
    }
    out.policies = pol;
  }
  return out;
}
function cleanListing(b, cur = {}) {
  const out = {};
  if (!cur.id) {
    if (!['product', 'item'].includes(b.kind)) return { error: 'Choose a product or an inventory item' };
    out.kind = b.kind; out.refId = clip(b.refId, 60);
  }
  if ('title' in b) out.title = clip(b.title, 120);
  if ('description' in b) out.description = clip(b.description, 5000);
  if ('category' in b) out.category = clip(b.category, 40);
  if ('images' in b) {
    const list = (Array.isArray(b.images) ? b.images : []).filter(Boolean);
    if (list.some((u) => !imgOk(u))) return { error: 'Images must be uploaded images' };
    out.images = list.slice(0, 8);
  }
  for (const k of ['price', 'mrp']) if (k in b) {
    if (b[k] === '' || b[k] == null) { out[k] = null; continue; }
    const v = Number(b[k]);
    if (!Number.isFinite(v) || v < 0 || v > 10000000) return { error: `Invalid ${k === 'mrp' ? 'MRP' : 'price'}` };
    out[k] = r2(v);
  }
  if ('visible' in b) out.visible = !!b.visible;
  if ('sort' in b) out.sort = Math.max(0, Math.min(100000, Math.round(Number(b.sort) || 0)));
  return out;
}

// what a listing sells right now → { title, price, images, stock?, product?, item? } or null when it can't be sold
function resolve(l, owner) {
  if (l.kind === 'product') {
    const p = T.products.get(l.refId);
    if (!p || p.userId !== l.userId) return null;
    if (l.price == null) return null; // a product has no price of its own: the listing must set one
    return { title: l.title || p.name, price: l.price, images: l.images?.length ? l.images : p.cover ? [p.cover] : [], digital: true, product: p };
  }
  if (!inventoryOn(owner)) return null;
  const i = T.iitems.get(l.refId);
  if (!i || i.userId !== l.userId || i.active === false) return null;
  const price = l.price ?? (i.sale_rate != null ? Number(i.sale_rate) : null);
  if (price == null || !Number.isFinite(price)) return null;
  return { title: l.title || i.name, price: r2(price), images: l.images || [], item: i, stock: stockOf(i.id), unit: i.unit || '' };
}
const publicListing = (l, r) => ({
  id: l.id, title: r.title, description: l.description || '', category: l.category || '', images: r.images, price: r.price,
  ...(l.mrp && l.mrp > r.price ? { mrp: l.mrp } : {}), kind: r.digital ? 'digital' : 'physical',
  ...(r.item ? { unit: r.unit, stock: Math.max(0, Math.floor(r.stock)), soldOut: r.stock < 1 } : {}),
});

// ---------- pricing the cart (server side, from the catalog) ----------
// body: { cart: [{ id, qty }], coupon, email, method: 'cod' | undefined }
// → { status, error, code } or a charge { items, total, discount, usedCoupon, couponObj, needsAddress, codAllowed, lines, subtotal, shipping, codFee }
export function priceCart(store, owner, body, { couponFor, discountFor }) {
  const raw = Array.isArray(body.cart) ? body.cart : [];
  if (!raw.length) return { status: 400, error: 'Your cart is empty' };
  if (raw.length > MAX_LINES) return { status: 400, error: `Up to ${MAX_LINES} different products in one order` };
  const want = new Map();
  for (const x of raw) {
    const id = clip(x?.id, 60), n = Math.floor(Number(x?.qty));
    if (!id) continue;
    if (!Number.isFinite(n) || n < 1) return { status: 400, error: 'Quantities must be 1 or more' };
    want.set(id, Math.min(MAX_QTY, (want.get(id) || 0) + n));
  }
  const lines = [];
  for (const [id, n] of want) {
    const l = T.slistings.get(id);
    const r = l && l.userId === store.userId && l.visible !== false ? resolve(l, owner) : null;
    if (!r) return { status: 400, error: 'Something in your cart is no longer available — please remove it and try again', code: 'unavailable', id };
    const qty = r.digital ? 1 : n; // a digital product is bought once
    if (r.item && qty > r.stock) return { status: 409, error: r.stock < 1 ? `${r.title} is sold out — please remove it from your cart` : `Only ${Math.floor(r.stock)} of ${r.title} left — please lower the quantity`, code: 'stock', id, left: Math.max(0, Math.floor(r.stock)) };
    lines.push({ id, title: r.title, qty, unitPrice: r.price, amount: r2(r.price * qty), r });
  }
  const subtotal = r2(lines.reduce((s, l) => s + l.amount, 0));
  const f = storeFunnel(store);
  let discount = 0, usedCoupon = null, couponObj = null;
  if (body.coupon) {
    const c = couponFor(f, body.coupon, { email: body.email, subtotal });
    if (!c.coupon) return { status: 400, error: `${c.reason} — remove it to continue`, coupon: false, code: 'coupon' };
    discount = discountFor(c.coupon, subtotal); usedCoupon = c.coupon.code; couponObj = c.coupon;
  }
  // the discount is spread over the lines by value (GST is on the discounted price of each line); rounding goes to the last
  let left = discount;
  const items = lines.map((l, i) => {
    const share = i === lines.length - 1 ? left : r2(subtotal ? (discount * l.amount) / subtotal : 0);
    left = r2(left - share);
    const it = l.r;
    const gst = it.item && GST_RATES.includes(Number(it.item.gst_percent)) && it.item.gst_percent !== '' && it.item.gst_percent != null ? Number(it.item.gst_percent) : null;
    return {
      name: l.qty > 1 ? `${l.title} × ${l.qty}` : l.title, price: r2(l.amount - share), kind: 'store', qty: l.qty, unitPrice: l.unitPrice, listingId: l.id,
      ...(it.product ? { productId: it.product.id } : {}),
      ...(it.item ? { itemId: it.item.id, ...(it.item.hsn ? { hsn: String(it.item.hsn) } : {}), ...(gst != null ? { gstRate: gst } : {}) } : {}),
    };
  });
  const physical = lines.some((l) => l.r.item);
  const sh = store.shipping || {};
  const shipping = physical && sh.fee > 0 && !(sh.freeAbove > 0 && subtotal - discount >= sh.freeAbove) ? sh.fee : 0;
  if (shipping) items.push({ name: 'Shipping', price: shipping, kind: 'shipping' });
  const codAllowed = physical && !!store.cod?.enabled;
  const codFee = body.method === 'cod' && codAllowed && store.cod.fee > 0 ? store.cod.fee : 0;
  if (codFee) items.push({ name: 'Cash on Delivery fee', price: codFee, kind: 'cod_fee' });
  const total = r2(items.reduce((s, i) => s + i.price, 0));
  return { items, total, discount, usedCoupon, couponObj, needsAddress: physical, codAllowed, digital: lines.some((l) => l.r.digital), subtotal, shipping, codFee, lines: lines.map(({ r, ...x }) => x) };
}

// ---------- routes ----------
export function registerStore(app, { auth, wrap, rateLimit, isTest, appUrl, secret, recordOrder, finalizePayment, couponFor, discountFor, buyerOf, indexHtml, codAdvanceFor, startCodAdvance }) {
  const pvKey = (s) => crypto.createHmac('sha256', secret).update(`store.${s.id}`).digest('base64url').slice(0, 16);
  const storeUrl = (req, s) => `${(process.env.PAGES_URL || appUrl(req)).replace(/\/+$/, '')}/s/${s.handle}`;
  const sellerView = (req, s) => ({ ...s, url: s.handle ? storeUrl(req, s) : null, previewUrl: s.handle ? `${storeUrl(req, s)}?pv=${pvKey(s)}` : null });
  const ensure = (u) => storeOf(u.id) || T.stores.insert({ id: uid(), userId: u.id, handle: null, enabled: false, name: u.settings?.businessName || '', tagline: '', about: '', color: '#6366f1', logo: '', categories: [], shipping: { fee: 0, freeAbove: 0 }, cod: { enabled: false, fee: 0 }, policies: {}, at: Date.now() });
  const productsFor = (u) => T.products.all({ userId: u.id }, { order: 'at', desc: true }).map((p) => ({ id: p.id, name: p.name, cover: p.cover || '', hsn: p.hsn || '', gstRate: p.gstRate ?? null }));
  const itemsFor = (u) => (inventoryOn(u) ? T.iitems.all({ userId: u.id, active: 1 }).map((i) => ({ id: i.id, name: i.name, unit: i.unit || '', sale_rate: i.sale_rate ?? null, hsn: i.hsn || '', gst_percent: i.gst_percent ?? null, category: i.category || '', stock: stockOf(i.id) })) : []);
  const listingsFor = (userId) => T.slistings.all({ userId }, { order: 'at' }).sort((a, b) => (a.sort || 0) - (b.sort || 0));
  const ownListing = (req, res) => { const l = T.slistings.get(req.params.lid); if (!l || l.userId !== req.user.id) { res.status(404).json({ error: 'Listing not found' }); return null; } return l; };

  // ---- the seller ----
  app.get('/api/store', auth, (req, res) => {
    const s = ensure(req.user);
    res.json({ store: sellerView(req, s), listings: listingsFor(req.user.id), products: productsFor(req.user), items: itemsFor(req.user), inventory: inventoryOn(req.user) });
  });
  app.put('/api/store', auth, (req, res) => {
    const s = ensure(req.user);
    const x = cleanStore(req.body || {}, s);
    if (x.error) return res.status(400).json(x);
    if (x.handle && x.handle !== s.handle && T.stores.find({ handle: x.handle })) return res.status(409).json({ error: 'That store address is taken — try another' });
    if ((x.enabled ?? s.enabled) && !(x.handle || s.handle)) return res.status(400).json({ error: 'Choose your store address first' });
    res.json({ store: sellerView(req, T.stores.update(s.id, (r) => Object.assign(r, x))) });
  });
  app.post('/api/store/listings', auth, (req, res) => {
    if (T.slistings.count({ userId: req.user.id }) >= 2000) return res.status(400).json({ error: 'You can list up to 2000 products' });
    const x = cleanListing(req.body || {});
    if (x.error) return res.status(400).json(x);
    const ok = x.kind === 'product' ? T.products.get(x.refId)?.userId === req.user.id : inventoryOn(req.user) && T.iitems.get(x.refId)?.userId === req.user.id;
    if (!ok) return res.status(404).json({ error: x.kind === 'item' && !inventoryOn(req.user) ? 'Inventory isn’t switched on for your account' : 'Not found' });
    if (x.kind === 'product' && x.price == null) return res.status(400).json({ error: 'Set a price for this product' });
    res.json(T.slistings.insert({ id: uid(), userId: req.user.id, visible: true, images: [], sort: 0, ...x, at: Date.now() }));
  });
  app.put('/api/store/listings/:lid', auth, (req, res) => {
    const l = ownListing(req, res);
    if (!l) return;
    const x = cleanListing(req.body || {}, l);
    if (x.error) return res.status(400).json(x);
    if (l.kind === 'product' && 'price' in x && x.price == null) return res.status(400).json({ error: 'Set a price for this product' });
    res.json(T.slistings.update(l.id, (r) => Object.assign(r, x)));
  });
  app.delete('/api/store/listings/:lid', auth, (req, res) => {
    const l = ownListing(req, res);
    if (!l) return;
    T.slistings.del(l.id);
    res.json({ ok: true });
  });

  // ---- the public store ----
  // open when switched on and the owner's account serves pages; the seller's preview link (?pv=) opens it before that
  const openStore = (req, res, { buying = false } = {}) => {
    const s = T.stores.find({ handle: clip(req.params.handle, 40).toLowerCase() });
    const owner = s && T.users.get(s.userId);
    const pv = s && typeof req.query.pv === 'string' && req.query.pv === pvKey(s);
    if (!s || !owner || !accessFor(owner).pagesLive || !(s.enabled || (pv && !buying))) { res.status(404).json({ error: 'This store is not available right now.' }); return null; }
    return { s, owner };
  };
  const publicStore = (s, owner) => ({
    handle: s.handle, name: s.name || owner.settings?.businessName || STORE_NAME, tagline: s.tagline || '', about: s.about || '', color: s.color || '#6366f1', logo: s.logo || '',
    categories: s.categories || [], policies: s.policies || {}, shipping: s.shipping || { fee: 0, freeAbove: 0 }, cod: s.cod?.enabled ? { enabled: true, fee: s.cod.fee || 0 } : { enabled: false },
    payments: rzpCreds(owner) ? 'razorpay' : stripeCreds(owner) ? 'stripe' : 'demo', enabled: !!s.enabled,
  });
  const catalog = (s, owner) => listingsFor(s.userId).filter((l) => l.visible !== false).map((l) => { const r = resolve(l, owner); return r ? publicListing(l, r) : null; }).filter(Boolean);

  app.get('/api/s/:handle', (req, res) => {
    const o = openStore(req, res);
    if (!o) return;
    let list = catalog(o.s, o.owner);
    const term = clip(req.query.q, 80).toLowerCase(), cat = clip(req.query.category, 40);
    if (cat) list = list.filter((l) => l.category === cat);
    if (term) list = list.filter((l) => `${l.title} ${l.description} ${l.category}`.toLowerCase().includes(term));
    const sort = String(req.query.sort || '');
    if (sort === 'price_asc') list.sort((a, b) => a.price - b.price);
    else if (sort === 'price_desc') list.sort((a, b) => b.price - a.price);
    else if (sort === 'name') list.sort((a, b) => a.title.localeCompare(b.title));
    res.json({ store: publicStore(o.s, o.owner), listings: list });
  });
  app.get('/api/s/:handle/p/:lid', (req, res) => {
    const o = openStore(req, res);
    if (!o) return;
    const l = T.slistings.get(req.params.lid);
    const r = l && l.userId === o.s.userId && l.visible !== false ? resolve(l, o.owner) : null;
    if (!r) return res.status(404).json({ error: 'This product isn’t available' });
    res.json({ store: publicStore(o.s, o.owner), listing: publicListing(l, r) });
  });

  const quoteLimiter = rateLimit({ windowMs: 60000, max: isTest ? 1000 : 30, key: (req) => `${req.ip}:s:${req.params.handle}`, message: 'Too many tries — please wait a minute and try again.' });
  const payLimiter = rateLimit({ windowMs: 3600000, max: isTest ? 1000 : 30, key: (req) => `${req.ip}:sp`, message: 'Too many orders from this network — please try again later.' });
  const view = (c) => ({ lines: c.lines, subtotal: c.subtotal, discount: c.discount, coupon: c.usedCoupon, shipping: c.shipping, codFee: c.codFee, total: c.total, needsAddress: c.needsAddress, codAllowed: c.codAllowed, digital: c.digital });
  // the cart's prices, as the checkout will charge them (coupon, shipping, COD fee)
  app.post('/api/s/:handle/quote', quoteLimiter, (req, res) => {
    const o = openStore(req, res, { buying: true });
    if (!o) return;
    const c = priceCart(o.s, o.owner, req.body || {}, { couponFor, discountFor });
    if (c.error) return res.status(c.status).json(c);
    // Cash on Delivery with an advance (cod.js): what's paid now and what's left for delivery
    const adv = req.body?.method === 'cod' && c.codAllowed ? codAdvanceFor(o.owner, c.total) : null;
    res.json({ ...view(c), ...(adv ? { prepaid: adv } : {}) });
  });

  // everything the checkout needs before money moves → { o, charge, buyer } or an error already sent
  const prepare = (req, res, method) => {
    const o = openStore(req, res, { buying: true });
    if (!o) return null;
    const body = req.body || {};
    const charge = priceCart(o.s, o.owner, { ...body, method }, { couponFor, discountFor });
    if (charge.error) { res.status(charge.status).json(charge); return null; }
    const buyer = buyerOf(req);
    const fail = (error, extra = {}) => { res.status(400).json({ error, ...extra }); return null; };
    if (buyer.gstError) return fail(buyer.gstError);
    if (charge.digital && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(buyer.email)) return fail('Please enter your email — your downloads are sent there');
    if (charge.needsAddress && !buyer.address) return fail(buyer.addressError || 'Please enter your delivery address');
    const ship = shipError(o.owner, charge, buyer);
    if (ship) return fail(ship, { code: 'pincode' });
    if (waRequired(o.owner) && !waPhoneOk(buyer.phone)) return fail('Please enter your WhatsApp number');
    return { ...o, f: storeFunnel(o.s), charge, buyer };
  };

  // no payment provider connected: a demo order (nothing delivered, no stock taken) — refused once payments are live
  app.post('/api/s/:handle/order', payLimiter, (req, res) => {
    const p = prepare(req, res);
    if (!p) return;
    if (rzpCreds(p.owner) || stripeCreds(p.owner)) return res.status(409).json({ error: 'This store takes real payments' });
    delete p.buyer.tk;
    res.json(recordOrder(p.f, p.charge, p.buyer, { base: appUrl(req) }));
  });

  // a COD checkout: the store's checks, then the seller's COD rules (cod.js) → { ...prepare } or null (answered)
  const prepareCod = (req, res) => {
    const p = prepare(req, res, 'cod');
    if (!p) return null;
    const fail = (body) => { res.status(400).json(body); return null; };
    if (!p.charge.codAllowed) return fail({ error: 'Cash on Delivery isn’t available for this order' });
    if (!/^\d{10}$/.test(String(p.buyer.phone).replace(/\D/g, '').replace(/^91(?=\d{10}$)/, ''))) return fail({ error: 'Please enter your 10-digit mobile number — the courier will call before delivery' });
    const risk = codCheckoutError(p.owner, p.charge, p.buyer);
    if (risk) return fail(risk);
    return p;
  };
  app.post('/api/s/:handle/cod', payLimiter, (req, res) => {
    const p = prepareCod(req, res);
    if (!p) return;
    // an advance is due first: the checkout pays it through pay/start (method: 'cod')
    const adv = codAdvanceFor(p.owner, p.charge.total);
    if (adv) return res.status(400).json({ error: `Pay ₹${adv.amount} now to confirm your Cash on Delivery order`, code: 'prepaid', prepaid: adv });
    const out = recordOrder(p.f, p.charge, p.buyer, { cod: true, base: appUrl(req) });
    codPlaced(p.owner, out.orderId, appUrl(req));
    res.json({ provider: 'cod', ...out });
  });

  // 1. start: the server's price, a payment row (kind 'store') and a Razorpay order / Stripe intent for it
  app.post('/api/s/:handle/pay/start', payLimiter, wrap(async (req, res) => {
    // Cash on Delivery with an advance paid online first (cod.js) — none due: booked as plain COD
    if (req.body?.method === 'cod') {
      const c = prepareCod(req, res);
      if (!c) return;
      const adv = codAdvanceFor(c.owner, c.charge.total);
      if (adv) return startCodAdvance(req, res, { f: c.f, owner: c.owner, charge: c.charge, buyer: c.buyer, kind: 'store', adv });
      const out = recordOrder(c.f, c.charge, c.buyer, { cod: true, base: appUrl(req) });
      codPlaced(c.owner, out.orderId, appUrl(req));
      return res.json({ provider: 'cod', ...out });
    }
    const p = prepare(req, res);
    if (!p) return;
    const { owner, f, charge, buyer } = p;
    const creds = rzpCreds(owner), sc = stripeCreds(owner);
    if (!creds && !sc) return res.json({ provider: 'demo' });
    const useStripe = !creds; // a store sells in ₹: Razorpay when connected, Stripe otherwise
    if (charge.total <= 0) return res.json({ provider: 'free', ...recordOrder(f, charge, buyer, { verified: true, base: appUrl(req), testMode: (useStripe ? sc : creds).mode === 'test' }) });
    const pay = { id: uid(), kind: 'store', userId: f.userId, funnelId: f.id, buyer, charge: { items: charge.items, total: charge.total, discount: charge.discount, usedCoupon: charge.usedCoupon }, mode: (useStripe ? sc : creds).mode, status: 'created', at: Date.now(), base: appUrl(req), ...(useStripe ? { provider: 'stripe', currency: 'INR' } : {}) };
    const description = charge.items.filter((i) => i.kind === 'store').map((i) => i.name).join(' + ').slice(0, 250);
    const name = owner.settings?.businessName || f.name, color = f.theme.primary;
    if (useStripe) {
      try {
        const r = await startStripePayment(sc, { userId: f.userId, pay, iso: 'INR', buyer, description });
        Object.assign(pay, { stripeIntent: r.intent, stripeCustomer: r.customer, rzpOrderId: r.intent });
        T.payments.insert(pay);
        return res.json({ ...r, amount: charge.total, currency: 'INR', name, description, color });
      } catch (e) {
        console.error('Stripe payment failed', e.message);
        return res.status(502).json({ error: 'Card payments are temporarily unavailable — please try again in a minute' });
      }
    }
    let rzp;
    try { rzp = await rzpCreateOrder(creds, { amount: Math.round(charge.total * 100), receipt: pay.id, notes: { store: f.name.slice(0, 200), payment: pay.id } }); } catch (e) {
      console.error('Razorpay order failed', e.message);
      return res.status(502).json({ error: 'Payments are temporarily unavailable — please try again in a minute' });
    }
    pay.rzpOrderId = rzp.id;
    T.payments.insert(pay);
    res.json({ provider: 'razorpay', payment: pay.id, key: creds.keyId, order_id: rzp.id, amount: rzp.amount, currency: rzp.currency || 'INR', name, description, prefill: { name: buyer.name, email: buyer.email, contact: buyer.phone }, color });
  }));
  // 2. verify: only a valid signature (Razorpay) or a succeeded intent (Stripe) records the paid order
  const storePay = (req, res) => {
    const s = T.stores.find({ handle: clip(req.params.handle, 40).toLowerCase() });
    const pay = s && T.payments.get(clip(req.body?.payment, 60));
    if (!pay || pay.kind !== 'store' || pay.userId !== s.userId) { res.status(404).json({ error: 'Payment not found' }); return null; }
    return { s, pay, owner: T.users.get(s.userId) };
  };
  const NOT_CONFIRMED = 'We couldn’t confirm this payment. If money was deducted it will be refunded automatically — please contact the seller.';
  app.post('/api/s/:handle/pay/verify', (req, res) => {
    const x = storePay(req, res);
    if (!x) return;
    const creds = rzpCreds(x.owner);
    const { razorpay_order_id: oid, razorpay_payment_id: pid, razorpay_signature: sig } = req.body;
    if (!creds || oid !== x.pay.rzpOrderId || !validPayment(creds.secret, oid, pid, sig)) return res.status(400).json({ error: NOT_CONFIRMED });
    res.json(finalizePayment(x.pay, pid, appUrl(req)));
  });
  app.post('/api/s/:handle/pay/stripe/verify', wrap(async (req, res) => {
    const x = storePay(req, res);
    if (!x) return;
    if (x.pay.status === 'paid') return res.json(x.pay.result);
    const sc = stripeCreds(x.owner);
    const id = sc && x.pay.provider === 'stripe' && await confirmedIntent(sc, x.pay).catch(() => null);
    if (!id) return res.status(400).json({ error: NOT_CONFIRMED });
    res.json(finalizePayment(x.pay, id, appUrl(req)));
  }));

  // ---- the page: the app's HTML with the store's title and link-preview tags ----
  if (indexHtml) {
    const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
    app.get(['/s/:handle', '/s/:handle/*'], (req, res) => {
      const s = T.stores.find({ handle: clip(req.params.handle, 40).toLowerCase() });
      const owner = s && T.users.get(s.userId);
      const pv = s && req.query.pv === pvKey(s);
      if (!s || !owner || !(s.enabled || pv)) return res.status(404).set('Cache-Control', 'no-cache').type('html').send(indexHtml.replace('<!--ff-head-->', '<meta name="robots" content="noindex">'));
      const st = publicStore(s, owner);
      const m = String(req.params[0] || '').match(/^p\/([\w-]{1,60})/);
      const l = m && T.slistings.get(m[1]);
      const r = l && l.userId === s.userId && l.visible !== false ? resolve(l, owner) : null;
      const title = r ? `${r.title} · ${st.name}` : st.name;
      const desc = (r ? l.description : st.tagline || st.about) || '';
      const img = (r ? r.images[0] : st.logo) || '';
      const abs = (u) => (u.startsWith('/') ? `${appUrl(req)}${u}` : u);
      const head = `<meta name="description" content="${esc(desc.slice(0, 200))}"><meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc.slice(0, 200))}">${img ? `<meta property="og:image" content="${esc(abs(img))}">` : ''}<meta name="theme-color" content="${esc(st.color)}">${pv && !s.enabled ? '<meta name="robots" content="noindex">' : ''}`;
      res.set('Cache-Control', 'no-cache').type('html').send(indexHtml.replace(/<title>[^<]*<\/title>/, () => `<title>${esc(title)}</title>`).replace('<!--ff-head-->', () => head));
    });
  }
}
