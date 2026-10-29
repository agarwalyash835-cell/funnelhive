// Physical orders: Cash on Delivery and shipping. A COD order is booked unpaid; the seller ships it (courier +
// tracking, emailed to the buyer), and when it's delivered the cash counts as paid — the GST invoice is issued and
// any digital products are delivered then. A COD order that's refused / returned (RTO) is cancelled and nets out of
// revenue. Online-paid orders use the same shipping steps.
import { T, tx, contactKey } from './db.js';
import { sendEmail } from './messaging.js';
import { waEvent } from './hive-wa.js';
import { enqueue as fireWebhook } from './webhooks.js';
import { fire as fireAutomation } from './automations.js';
import { deliver, revoke, linkBase } from './products.js';
import { issueInvoice, invoiceUrl } from './sales.js';
import { STATES } from './platform.js';
import { codSellerAction } from './cod.js';

const clip = (v, n) => String(v ?? '').trim().slice(0, n);
// "Where should we ship it?" — checked whenever a checkout asks for an address
export function cleanAddress(a) {
  if (!a || typeof a !== 'object') return null;
  const out = { line1: clip(a.line1, 200), line2: clip(a.line2, 200), city: clip(a.city, 80), state: clip(a.state, 60), pincode: clip(a.pincode, 6).replace(/\D/g, '') };
  if (!out.line1 && !out.city && !out.pincode) return null;
  if (!out.line1 || !out.city) return { error: 'Please enter your full delivery address' };
  if (!/^[1-9]\d{5}$/.test(out.pincode)) return { error: 'Please enter a valid 6-digit PIN code' };
  if (out.state && !STATES[out.state]) return { error: 'Please choose your state' };
  return out;
}
export const addressText = (a) => (a ? [a.line1, a.line2, `${a.city}${a.state ? `, ${a.state}` : ''} – ${a.pincode}`].filter(Boolean).join(', ') : '');

const TRACK = { delhivery: 'https://www.delhivery.com/track/package/', bluedart: 'https://www.bluedart.com/tracking?trackFor=0&trackNo=', dtdc: 'https://www.dtdc.in/tracking.asp?cnno=', 'india post': 'https://www.indiapost.gov.in/_layouts/15/dop.portal.tracking/trackconsignment.aspx?', ekart: 'https://ekartlogistics.com/shipmenttrack/', xpressbees: 'https://www.xpressbees.com/shipment/tracking?awbNo=', shiprocket: 'https://shiprocket.co/tracking/', 'ecom express': 'https://ecomexpress.in/tracking/?awb_field=' };
const trackingUrl = (courier, awb) => { const k = Object.keys(TRACK).find((c) => String(courier).toLowerCase().includes(c)); return k && awb ? `${TRACK[k]}${encodeURIComponent(awb)}` : ''; };

// Cash collected (COD delivered, or the seller says it's paid): invoice + digital delivery, once
function settleCod(owner, order, base) {
  if (order.status !== 'cod') return order;
  const f = T.funnels.get(order.funnelId);
  const lines = order.items.map((it, i) => ({ index: i, name: it.name, kind: it.kind, amount: it.price })).filter((l) => l.amount > 0 && !order.items[l.index].refunded);
  const paid = T.orders.update(order.id, (o) => { o.status = 'paid'; o.codPaidAt = Date.now(); });
  // place of supply for goods: where they were delivered (unless the buyer gave a GSTIN)
  const inv = issueInvoice(owner, paid, lines, { test: false, gst: paid.gst || (paid.address?.state ? { state: paid.address.state } : null) });
  const invUrl = inv ? invoiceUrl(linkBase(order.funnelId, base), inv) : null;
  const grants = paid.items.map((it, i) => (it.productId ? { productId: it.productId, item: i } : null)).filter(Boolean);
  if (f && grants.length && paid.email) deliver({ f, owner, email: paid.email, name: paid.name, phone: paid.phone, grants, orderId: paid.id, base, invoiceUrl: invUrl });
  const { userId, ...out } = paid;
  fireWebhook(order.userId, 'order.updated', { funnel: f?.name, ...out, ...(invUrl ? { invoice: invUrl } : {}) });
  return T.orders.get(order.id);
}

export function registerFulfilment(app, { auth, appUrl }) {
  const own = (req, res) => { const o = T.orders.get(req.params.oid); if (!o || o.userId !== req.user.id) { res.status(404).json({ error: 'Order not found' }); return null; } return o; };
  // shipping: shipped (courier + tracking) → delivered, or returned
  app.post('/api/orders/:oid/fulfil', auth, (req, res) => {
    const o = own(req, res); if (!o) return;
    const status = req.body?.status;
    if (!['shipped', 'delivered', 'returned', 'pending'].includes(status)) return res.status(400).json({ error: 'Unknown shipping status' });
    if (o.status === 'cancelled' || o.status === 'refunded') return res.status(400).json({ error: `This order is ${o.status}` });
    const base = linkBase(o.funnelId, process.env.APP_URL || appUrl(req));
    const courier = clip(req.body.courier, 60), tracking = clip(req.body.tracking, 60);
    let order = T.orders.update(o.id, (x) => {
      x.fulfilment = { ...(x.fulfilment || {}), status, at: Date.now() };
      if (status === 'shipped') Object.assign(x.fulfilment, { courier, tracking, trackingUrl: clip(req.body.trackingUrl, 300) || trackingUrl(courier, tracking), shippedAt: Date.now() });
      if (status === 'delivered') x.fulfilment.deliveredAt = Date.now();
    });
    const owner = req.user, biz = owner.settings?.businessName || owner.name, first = String(o.name || '').split(/\s+/)[0] || 'there';
    if (status === 'shipped') {
      const ff = order.fulfilment;
      if (o.email) sendEmail(owner, { to: o.email, subject: `Your order is on its way 🚚`, text: `Hi ${first},\n\nYour order (#${o.id}) has been shipped${ff.courier ? ` with ${ff.courier}` : ''}.${ff.tracking ? `\nTracking number: ${ff.tracking}` : ''}${ff.trackingUrl ? `\nTrack it here: ${ff.trackingUrl}` : ''}${o.status === 'cod' ? `\n\nPlease keep ₹${o.total.toLocaleString('en-IN')} ready — it’s Cash on Delivery.` : ''}\n\n— ${biz}` }).catch(() => {});
      waEvent(owner, 'order_shipped', { to: o.phone, params: [first, ff.courier || 'our courier'], link: ff.trackingUrl || (ff.tracking ? `tracking number ${ff.tracking}` : 'we will share the tracking soon'), entityId: o.id, ckey: contactKey(o.email, o.phone) });
      fireAutomation(o.userId, 'shipped', { email: o.email, phone: o.phone, name: o.name, funnelId: o.funnelId, product: o.items[0]?.name, amount: o.total, trackingLink: ff.trackingUrl || '', courier: ff.courier || '', trackingId: ff.tracking || '' });
      fireWebhook(o.userId, 'order.shipped', { order: o.id, courier: ff.courier, tracking: ff.tracking, trackingUrl: ff.trackingUrl, email: o.email });
    }
    // a delivered COD order means the cash was collected
    if (status === 'delivered' && o.status === 'cod') order = settleCod(owner, order, base);
    // returned to origin: an unpaid COD order is cancelled (nothing to refund); a paid one needs a refund from Orders
    if (status === 'returned' && o.status === 'cod') order = cancelCod(o, 'returned');
    res.json(order);
  });
  // COD: cash received (without the shipping steps), or cancel before it ships
  // (cod.js: resend the confirmation, note the buyer's answer, returned to origin)
  app.post('/api/orders/:oid/cod', auth, async (req, res, next) => {
    const o = own(req, res); if (!o) return;
    let r;
    try { r = await codSellerAction(req, o, appUrl); } catch (e) { return next(e); }
    if (r) return res.status(r[0]).json(r[1]);
    if (o.status !== 'cod') return res.status(400).json({ error: 'This isn’t an unpaid Cash on Delivery order' });
    if (req.body?.action === 'paid') return res.json(settleCod(req.user, o, linkBase(o.funnelId, process.env.APP_URL || appUrl(req))));
    if (req.body?.action === 'cancel') return res.json(cancelCod(o, 'cancelled'));
    res.status(400).json({ error: 'action must be paid or cancel' });
  });
}

// an unpaid COD order cancelled (by the seller, the buyer, or returned to origin): nothing to refund. COD orders
// don't take stock out of Inventory or the stock counter (those count paid orders only), so there's none to put back.
export function cancelCod(o, why) {
  const order = tx(() => T.orders.update(o.id, (x) => { x.cancelledAmount = x.total; x.total = 0; x.status = 'cancelled'; x.cancelReason = why; x.cancelledAt = Date.now(); if (why === 'returned') x.rtoAt ||= Date.now(); for (const it of x.items) it.refunded ||= { at: Date.now(), cod: true }; }));
  revoke(o.userId, { orderId: o.id }, 'cancelled');
  const { userId, ...out } = order;
  fireWebhook(o.userId, 'order.cancelled', { reason: why, order: out });
  return order;
}

// Returned to origin: the buyer refused it / wasn't there. An unpaid COD order is cancelled; one the seller already
// cancelled is just marked. It counts against the buyer's number (cod.js codHistory) and in Orders.
export function markRto(o) {
  if (o.status === 'cod') { T.orders.update(o.id, (x) => { if (x.fulfilment) x.fulfilment = { ...x.fulfilment, status: 'returned', at: Date.now() }; }); return cancelCod(o, 'returned'); }
  return T.orders.update(o.id, (x) => { x.rtoAt = Date.now(); if (x.fulfilment) x.fulfilment = { ...x.fulfilment, status: 'returned', at: Date.now() }; });
}
