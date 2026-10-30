// After a store order: the buyer's "Where's my order?" page and their reviews of what they bought.
//   - /s/<handle>/order/<id>?k=<key> — the key is an HMAC of the order id, so an order number alone opens nothing.
//     Linked from the thank-you screen and the shipped / out-for-delivery messages (trackUrl).
//   - once delivered (or paid, for downloads), each product in the order can be rated 1–5 with a few words — one
//     review per product per order. The seller sees them all (Store → Reviews) and can hide one; never written by AI.
//   - listings show the real average and count of the visible reviews (reviewStats, used by store.js).
import crypto from 'node:crypto';
import { T, q, uid } from './db.js';

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
    // products to review (once each, the first time they appear in the order)
    review: canReview(o) ? productLines(o).filter((it) => !seen.has(it.listingId) && seen.add(it.listingId)).map((it) => {
      const l = T.slistings.get(it.listingId);
      return l && l.userId === s.userId ? { listingId: it.listingId, title: String(it.name).replace(/ × \d+$/, ''), image: (l.images || [])[0] || '', done: reviewed.has(it.listingId) } : null;
    }).filter(Boolean) : [],
  };
}

// deps from store.js: { auth, rateLimit, isTest, secret, openStore, publicStore, storeFunnelId }
export function registerStoreOrders(app, { auth, rateLimit, isTest, secret, openStore, publicStore, storeFunnelId }) {
  SECRET = secret;
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

  // ---- the seller ----
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
