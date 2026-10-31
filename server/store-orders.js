// After a store order: the buyer's "Where's my order?" page and their reviews of what they bought.
//   - /s/<handle>/order/<id>?k=<key> — the key is an HMAC of the order id, so an order number alone opens nothing.
//     Linked from the thank-you screen and the shipped / out-for-delivery messages (trackUrl).
//   - once delivered (or paid, for downloads), each product in the order can be rated 1–5 with a few words — one
//     review per product per order. The seller sees them all (Store → Reviews) and can hide one; never written by AI.
//   - listings show the real average and count of the visible reviews (reviewStats, used by store.js).
import crypto from 'node:crypto';
import { T, q, uid, JOBS } from './db.js';
import { notify } from './notify.js';
import { sendEmail } from './messaging.js';

let SECRET = '';
const clip = (v, n) => String(v ?? '').trim().slice(0, n);
export const trackKey = (orderId) => crypto.createHmac('sha256', SECRET).update(`track.${orderId}`).digest('base64url').slice(0, 16);
const keyOk = (orderId, k) => {
  const a = Buffer.from(trackKey(orderId)), b = Buffer.from(String(k || ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};
// the buyer's tracking page for a store order ('' when the order isn't from a store with an address)
export function trackUrl(order, base = process.env.PAGES_URL || process.env.APP_URL || '') {
  if (!SECRET || !order?.id || !String(order.funnelId || '').startsWith('store_')) return '';
  const s = T.stores.find({ userId: order.userId });
  return s?.handle && base ? `${String(base).replace(/\/+$/, '')}/s/${s.handle}/order/${order.id}?k=${trackKey(order.id)}` : '';
}

// { listingId: { rating, reviews } } from the visible reviews of a seller's products
export function reviewStats(userId) {
  const out = {};
  for (const r of q("SELECT listingId, COUNT(*) AS n, AVG(json_extract(data, '$.rating')) AS avg FROM sreviews WHERE userId = ? AND hidden = 0 GROUP BY listingId").all(userId)) {
    out[r.listingId] = { rating: Math.round(r.avg * 10) / 10, reviews: r.n };
  }
  return out;
}
// a buyer's name as shown under a review: "Ravi K."
const shortName = (n) => { const p = clip(n, 80).split(/\s+/).filter(Boolean); return p.length ? `${p[0]}${p[1] ? ` ${p[1][0].toUpperCase()}.` : ''}` : 'A buyer'; };
export const publicReview = (r) => ({ id: r.id, rating: r.rating, text: r.text || '', name: r.name, at: r.at, size: r.size || '' });

const FINAL_BAD = ['cancelled', 'refunded'];
const productLines = (o) => (o.items || []).filter((it) => it.kind === 'store' && it.listingId);
// what the buyer can review: a delivered order, or a paid one with nothing to ship (downloads)
const canReview = (o) => !FINAL_BAD.includes(o.status) && (o.fulfilment ? o.fulfilment.status === 'delivered' : o.status === 'paid');

// ---------- returns and exchanges ----------
// The store's rule (store.returns, set in Store settings): days after delivery, 0 = no returns; exchanges on or off.
// A request names the order's product lines, return or exchange (with the new size, when the product has sizes), a
// reason and a note; the seller approves, rejects or marks it received from Orders. Money goes back through the
// normal refund (sales.js), so stock, invoices and credit notes stay in step.
export const returnsOf = (s) => ({ days: s?.returns?.days ?? 7, exchange: s?.returns?.exchange !== false });
export const RETURN_REASONS = { size: 'Wrong size or fit', damaged: 'Arrived damaged', wrong: 'Wrong item sent', different: 'Not as described', mind: 'Changed my mind', other: 'Something else' };
export const RETURN_STATUS = ['requested', 'approved', 'rejected', 'received', 'closed'];
const DAY = 86400000;
const OPEN = ['requested', 'approved', 'received'];
// the lines a buyer can still ask about: delivered store products not already in an open request
function returnable(o, s) {
  const rule = returnsOf(s);
  if (!rule.days || o.fulfilment?.status !== 'delivered' || FINAL_BAD.includes(o.status)) return { until: null, lines: [] };
  const until = (o.fulfilment.deliveredAt || o.fulfilment.at || o.at) + rule.days * DAY;
  if (Date.now() > until) return { until, lines: [] };
  const taken = new Set((o.returns || []).filter((r) => OPEN.includes(r.status)).flatMap((r) => r.items));
  const lines = (o.items || []).map((it, i) => ({ it, i })).filter(({ it, i }) => it.kind === 'store' && it.listingId && !taken.has(i))
    .map(({ it, i }) => { const l = T.slistings.get(it.listingId); return { index: i, name: it.name, ...(l?.sizes?.length ? { sizes: l.sizes } : {}) }; });
  return { until, lines };
}
const returnView = (r) => ({ id: r.id, items: r.items, names: r.names, kind: r.kind, reason: r.reason, reasonText: RETURN_REASONS[r.reason] || '', note: r.note || '', size: r.size || '', status: r.status, sellerNote: r.sellerNote || '', at: r.at, updatedAt: r.updatedAt || null });

// the buyer's view of an order: what they bought, how they paid, where it is
function orderView(o, s) {
  const ff = o.fulfilment || null, sh = o.shipment || {};
  const reviewed = new Set(T.sreviews.all({ orderId: o.id }).map((r) => r.listingId));
  const seen = new Set();
  return {
    id: o.id, at: o.at, name: String(o.name || '').split(/\s+/)[0] || '',
    items: (o.items || []).filter((it) => it.kind !== 'shipping' && it.kind !== 'cod_fee').map((it) => ({ name: it.name, price: it.price, ...(it.listingId ? { listingId: it.listingId } : {}) })),
    shipping: (o.items || []).filter((it) => it.kind === 'shipping').reduce((n, it) => n + it.price, 0),
    total: o.status === 'cancelled' ? o.cancelledAmount || 0 : o.total,
    // how it's paid: online, cash on delivery (with an advance paid online, if any), or not at all yet
    payment: o.status === 'cod' ? { method: 'cod', due: Math.max(0, Math.round(((Number(o.total) || 0) - (o.prepaid?.amount || 0)) * 100) / 100), ...(o.prepaid?.amount ? { advance: o.prepaid.amount } : {}) }
      : { method: o.codPaidAt ? 'cod' : 'online', paid: true },
    status: o.status === 'cancelled' ? (o.cancelReason === 'returned' || o.rtoAt ? 'returned' : 'cancelled') : o.status === 'refunded' ? 'refunded' : ff ? ff.status : 'paid',
    stage: ff?.stage || null,
    shipped: ff?.shippedAt ? { at: ff.shippedAt, courier: ff.courier || sh.courier || '', tracking: ff.tracking || sh.awb || '', url: ff.trackingUrl || '' } : null,
    deliveredAt: ff?.deliveredAt || null,
    digital: !ff,
    // returns and exchanges: what can still be asked about (until when), and the requests so far
    returns: (() => { const rule = returnsOf(s), r = returnable(o, s); return { days: rule.days, exchange: rule.exchange, until: r.until, lines: r.lines, reasons: RETURN_REASONS, requests: (o.returns || []).map(returnView) }; })(),
    // products to review (once each, the first time they appear in the order)
    review: canReview(o) ? productLines(o).filter((it) => !seen.has(it.listingId) && seen.add(it.listingId)).map((it) => {
      const l = T.slistings.get(it.listingId);
      return l && l.userId === s.userId ? { listingId: it.listingId, title: String(it.name).replace(/ × \d+$/, ''), image: (l.images || [])[0] || '', done: reviewed.has(it.listingId) } : null;
    }).filter(Boolean) : [],
  };
}

// ---------- back in stock ----------
// A buyer on a sold-out product leaves an email; when the product has stock again they get one email with its link,
// from the seller (a background job, and on demand in tests). Nothing else is ever sent to that address from here.
export const waitingCounts = (userId) => Object.fromEntries(q('SELECT listingId, COUNT(*) AS n FROM swatch WHERE userId = ? AND sentAt IS NULL GROUP BY listingId').all(userId).map((r) => [r.listingId, r.n]));
let stockFn = null; // (listing, owner) → units in stock, or null when it isn't a stock item (store.js)
export async function sendBackInStock() {
  let sent = 0;
  for (const { listingId } of q('SELECT DISTINCT listingId FROM swatch WHERE sentAt IS NULL').all()) {
    const l = T.slistings.get(listingId), owner = l && T.users.get(l.userId), s = owner && T.stores.find({ userId: owner.id });
    if (!l || !owner || !s?.enabled || l.visible === false) continue;
    const left = stockFn ? stockFn(l, owner) : null;
    if (!(left > 0)) continue;
    const base = String(process.env.PAGES_URL || process.env.APP_URL || '').replace(/\/+$/, '');
    const link = base && s.handle ? `${base}/s/${s.handle}/p/${l.id}` : '';
    const title = l.title || T.iitems.get(l.refId)?.name || 'The product you wanted';
    const biz = s.name || owner.settings?.businessName || owner.name || 'the store';
    for (const w of q('SELECT data FROM swatch WHERE listingId = ? AND sentAt IS NULL').all(listingId).map((r) => JSON.parse(r.data))) {
      T.swatch.update(w.id, (x) => { x.sentAt = Date.now(); });
      sendEmail(owner, { to: w.email, subject: `${title} is back in stock`, text: `Hi,\n\nGood news — ${title} is back in stock at ${biz}.${link ? `\n\nGet it here before it sells out again: ${link}` : ''}\n\nYou asked us to tell you once, so this is the only email about it.\n\n— ${biz}` }).catch(() => {});
      sent++;
    }
  }
  return sent;
}

const lim0 = (rateLimit, isTest) => rateLimit({ windowMs: 3600000, max: isTest ? 2000 : 20, key: (req) => `${req.ip}:swatch`, message: 'Too many tries — please try again later.' });
// deps from store.js: { auth, rateLimit, isTest, secret, openStore, publicStore, storeFunnelId, stockOfListing }
export function registerStoreOrders(app, { auth, rateLimit, isTest, secret, openStore, publicStore, storeFunnelId, stockOfListing }) {
  SECRET = secret;
  stockFn = stockOfListing;
  // body: { email } — only for a product that's sold out right now
  app.post('/api/s/:handle/p/:lid/notify', lim0(rateLimit, isTest), (req, res) => {
    const o = openStore(req, res, { buying: true, quote: true });
    if (!o) return;
    if (o.demo) return res.json({ ok: true, demo: true });
    const l = T.slistings.get(clip(req.params.lid, 60));
    if (!l || l.userId !== o.s.userId || l.visible === false) return res.status(404).json({ error: 'This product isn’t available' });
    const email = clip(req.body?.email, 200).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Enter your email address' });
    const left = stockOfListing(l, o.owner);
    if (left == null || left > 0) return res.status(400).json({ error: 'This product is in stock — you can buy it now' });
    if (T.swatch.count({ listingId: l.id }) >= 5000) return res.json({ ok: true });
    const ex = T.swatch.find({ listingId: l.id, email });
    if (ex) T.swatch.update(ex.id, (x) => { delete x.sentAt; x.at = Date.now(); });
    else T.swatch.insert({ id: uid(), userId: o.s.userId, listingId: l.id, email, at: Date.now() });
    res.json({ ok: true });
  });
  if (isTest) app.post('/api/__test/back-in-stock', async (req, res) => res.json({ sent: await sendBackInStock() }));
  else if (JOBS) setInterval(() => { sendBackInStock().catch((e) => console.error('back-in-stock emails failed', e.message)); }, 10 * 60000).unref();
  const lim = rateLimit({ windowMs: 60000, max: isTest ? 2000 : 30, key: (req) => `${req.ip}:so`, message: 'Too many tries — please wait a minute and try again.' });
  // the order, when the key matches and it belongs to this store
  const theOrder = (req, res) => {
    const o = openStore(req, res);
    if (!o) return null;
    const ord = !o.demo && T.orders.get(clip(req.params.oid, 40));
    if (!ord || ord.funnelId !== storeFunnelId(o.s.userId) || !keyOk(ord.id, req.query.k)) { res.status(404).json({ error: 'We couldn’t find that order — please use the link from your order message' }); return null; }
    return { ...o, ord };
  };

  // ---- the buyer ----
  app.get('/api/s/:handle/order/:oid', lim, (req, res) => {
    const x = theOrder(req, res);
    if (!x) return;
    res.set('Cache-Control', 'no-store').json({ store: publicStore(x.s, x.owner), order: orderView(x.ord, x.s) });
  });
  // body: { listingId, rating 1–5, text } — again for the same product replaces the earlier review
  app.post('/api/s/:handle/order/:oid/review', lim, (req, res) => {
    const x = theOrder(req, res);
    if (!x) return;
    const o = x.ord;
    if (!canReview(o)) return res.status(400).json({ error: o.fulfilment ? 'You can review once your order is delivered' : 'You can review once your order is paid' });
    const lid = clip(req.body?.listingId, 60);
    const line = productLines(o).find((it) => it.listingId === lid);
    if (!line) return res.status(400).json({ error: 'That product isn’t in this order' });
    const rating = Math.round(Number(req.body?.rating));
    if (!(rating >= 1 && rating <= 5)) return res.status(400).json({ error: 'Choose 1 to 5 stars' });
    const text = clip(req.body?.text, 600);
    const ex = T.sreviews.find({ orderId: o.id, listingId: lid });
    const r = ex
      ? T.sreviews.update(ex.id, (v) => Object.assign(v, { rating, text, editedAt: Date.now() }))
      : T.sreviews.insert({ id: uid(), userId: o.userId, listingId: lid, orderId: o.id, rating, text, name: shortName(o.name), ...(line.size ? { size: line.size } : {}), hidden: false, at: Date.now() });
    res.json({ review: publicReview(r) });
  });

  // body: { items: [line index], kind: 'return' | 'exchange', reason, note, size } — one request per set of lines
  app.post('/api/s/:handle/order/:oid/return', lim, (req, res) => {
    const x = theOrder(req, res);
    if (!x) return;
    const o = x.ord, b = req.body || {}, rule = returnsOf(x.s), r = returnable(o, x.s);
    if (!rule.days) return res.status(400).json({ error: 'This store doesn’t take returns online — please contact them on WhatsApp' });
    if (!r.lines.length) return res.status(400).json({ error: o.fulfilment?.status !== 'delivered' ? 'You can ask for a return once your order is delivered' : 'The return window for this order has closed' });
    const kind = b.kind === 'exchange' ? 'exchange' : 'return';
    if (kind === 'exchange' && !rule.exchange) return res.status(400).json({ error: 'This store doesn’t offer exchanges — you can ask for a return instead' });
    const want = [...new Set((Array.isArray(b.items) ? b.items : []).map(Number))];
    const lines = r.lines.filter((l) => want.includes(l.index));
    if (!lines.length || lines.length !== want.length) return res.status(400).json({ error: 'Choose the products you want to return or exchange' });
    if (!RETURN_REASONS[b.reason]) return res.status(400).json({ error: 'Tell the seller why' });
    const note = clip(b.note, 500);
    if (b.reason === 'other' && note.length < 3) return res.status(400).json({ error: 'Add a few words about what went wrong' });
    let size = '';
    if (kind === 'exchange' && lines.some((l) => l.sizes)) {
      size = clip(b.size, 12);
      if (!lines.some((l) => l.sizes?.includes(size))) return res.status(400).json({ error: 'Choose the size you want instead' });
    }
    const req1 = { id: uid(), items: lines.map((l) => l.index), names: lines.map((l) => l.name), kind, reason: b.reason, note, ...(size ? { size } : {}), status: 'requested', at: Date.now() };
    T.orders.update(o.id, (v) => { v.returns = [...(v.returns || []), req1]; });
    const what = `${kind === 'exchange' ? 'Exchange' : 'Return'} requested · #${o.id}`;
    notify(o.userId, { kind: 'order', title: what, body: `${o.name || o.email || o.phone || 'A buyer'}: ${req1.names.join(', ')} — ${RETURN_REASONS[b.reason]}${size ? ` (wants size ${size})` : ''}${note ? `. “${note}”` : ''}`, link: '/orders' });
    res.json({ request: returnView(req1) });
  });

  // ---- the seller ----
  // a return / exchange request: approve, reject (with a note the buyer reads), mark received, or close it
  app.put('/api/orders/:oid/returns/:rid', auth, (req, res) => {
    const o = T.orders.get(req.params.oid);
    if (!o || o.userId !== req.user.id) return res.status(404).json({ error: 'Order not found' });
    const r = (o.returns || []).find((x) => x.id === req.params.rid);
    if (!r) return res.status(404).json({ error: 'Return request not found' });
    const status = String(req.body?.status || '');
    if (!['approved', 'rejected', 'received', 'closed'].includes(status)) return res.status(400).json({ error: 'Unknown status' });
    const sellerNote = clip(req.body?.note, 500);
    if (status === 'rejected' && sellerNote.length < 3) return res.status(400).json({ error: 'Tell the buyer why — they’ll read this' });
    const u = T.orders.update(o.id, (v) => { const x = v.returns.find((y) => y.id === r.id); Object.assign(x, { status, updatedAt: Date.now(), ...(sellerNote ? { sellerNote } : {}) }); });
    // the buyer hears about approvals and rejections, with their order page to follow it
    const owner = T.users.get(o.userId), page = trackUrl(u);
    const first = String(o.name || '').split(/\s+/)[0] || 'there', biz = owner?.settings?.businessName || owner?.name || 'the store';
    const word = r.kind === 'exchange' ? 'exchange' : 'return';
    const text = status === 'approved' ? `Hi ${first},\n\nYour ${word} for ${r.names.join(', ')} (order #${o.id}) is approved.${sellerNote ? `\n\n${sellerNote}` : '\n\nWe’ll be in touch about the pickup.'}${page ? `\n\nFollow it here: ${page}` : ''}\n\n— ${biz}`
      : status === 'rejected' ? `Hi ${first},\n\nWe couldn’t accept your ${word} request for ${r.names.join(', ')} (order #${o.id}):\n\n${sellerNote}${page ? `\n\nYour order: ${page}` : ''}\n\n— ${biz}` : '';
    if (text && o.email && owner) sendEmail(owner, { to: o.email, subject: status === 'approved' ? `Your ${word} is approved` : `About your ${word} request`, text }).catch(() => {});
    res.json({ returns: u.returns.map(returnView) });
  });
  app.get('/api/store/reviews', auth, (req, res) => {
    // a listing's own title, else its stock item's or product's name
    const titles = Object.fromEntries(T.slistings.all({ userId: req.user.id }).map((l) => [l.id, l.title || (l.kind === 'item' ? T.iitems.get(l.refId)?.name : T.products.get(l.refId)?.name) || '']));
    res.json({ reviews: T.sreviews.all({ userId: req.user.id }, { order: 'at', desc: true, limit: 500 }).map((r) => ({ ...publicReview(r), listingId: r.listingId, product: titles[r.listingId] || '', orderId: r.orderId, hidden: !!r.hidden })) });
  });
  app.put('/api/store/reviews/:id', auth, (req, res) => {
    const r = T.sreviews.get(req.params.id);
    if (!r || r.userId !== req.user.id) return res.status(404).json({ error: 'Review not found' });
    const v = T.sreviews.update(r.id, (x) => { x.hidden = !!req.body?.hidden; });
    res.json({ ...publicReview(v), hidden: !!v.hidden });
  });
}
