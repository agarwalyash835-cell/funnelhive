// What happens to a sale after the payment: the buyer's GST invoice, and refunds (with a credit note,
// the buyer's access removed and the revenue taken out of every report).
//
// Invoices: one per payment (checkout, then each one-click upsell / add-on is its own supply), numbered
// per seller per financial year (INV/2026-27/0001). Prices on funnels include GST; the invoice splits out
// CGST + SGST (buyer in the seller's state) or IGST (another state). Without a GSTIN the seller issues a
// plain invoice with no tax. Each line has its own HSN/SAC and rate: the linked product's, else the seller's
// defaults (checkout prices without a product, shipping, booking calls, quotes); totals are summed per rate.
import crypto from 'node:crypto';
import { T, q, tx, uid } from './db.js';
import { STATES, GSTIN_RE } from './platform.js';
import { TZ_OFFSET } from './time.js';
import { rzpCreds, call as rzpCall } from './razorpay.js';
import { enqueue as fireWebhook } from './webhooks.js';
import { fire as fireAutomation } from './automations.js';
import { linkBase } from './products.js';
import { stripeCreds, stripeRefund } from './stripe.js';
import { trackServer } from './tracking.js';
import { notify, money } from './notify.js';

let SECRET = '';
const r2 = (x) => Math.round(x * 100) / 100;
const STATE_BY_CODE = Object.fromEntries(Object.entries(STATES).map(([n, c]) => [c, n]));
export const INVOICING_DEFAULTS = { enabled: false, legalName: '', gstin: '', address: '', state: '', rate: 18, prefix: 'INV', sac: '998431', email: '', lut: false };
export const invoicingOf = (u) => ({ ...INVOICING_DEFAULTS, ...(u?.settings?.invoicing || {}) });
// GST slabs (0.25% / 3%: rough diamonds, gold and jewellery; 40%: the post-2025 luxury slab)
export const GST_RATES = [0, 0.25, 3, 5, 12, 18, 28, 40];
// HSN (goods, 4–8 digits) or SAC (services, 6 digits starting 99): digits only, '' = none
export const cleanHsn = (v) => { const c = String(v ?? '').replace(/\s/g, ''); return !c ? '' : /^\d{4,8}$/.test(c) ? c : null; };

export function cleanInvoicing(b = {}, cur = {}) {
  const out = { ...INVOICING_DEFAULTS, ...cur };
  const s = (v, n) => String(v ?? '').trim().slice(0, n);
  if ('enabled' in b) out.enabled = !!b.enabled;
  if ('legalName' in b) out.legalName = s(b.legalName, 160);
  if ('address' in b) out.address = s(b.address, 400);
  if ('email' in b) out.email = s(b.email, 160);
  if ('gstin' in b) { const g = s(b.gstin, 15).toUpperCase(); if (g && !GSTIN_RE.test(g)) return { error: 'That GSTIN doesn’t look right — it has 15 characters, like 27ABCDE1234F1Z5' }; out.gstin = g; if (g && STATE_BY_CODE[g.slice(0, 2)]) out.state = STATE_BY_CODE[g.slice(0, 2)]; }
  if ('state' in b && !(out.gstin && STATE_BY_CODE[out.gstin.slice(0, 2)])) { const st = s(b.state, 60); if (st && !STATES[st]) return { error: 'Pick your state from the list' }; out.state = st; }
  if ('rate' in b) { const r = Number(b.rate); if (!GST_RATES.includes(r)) return { error: `GST rate must be one of ${GST_RATES.join(', ')}%` }; out.rate = r; }
  if ('prefix' in b) { const p = s(b.prefix, 10).toUpperCase().replace(/[^A-Z0-9-]/g, ''); out.prefix = p || 'INV'; }
  if ('lut' in b) out.lut = !!b.lut; // exports of services under a Letter of Undertaking: zero-rated
  if ('sac' in b) { const c = cleanHsn(s(b.sac, 12)); if (c === null) return { error: 'The default HSN/SAC code is 4–8 digits, like 998431' }; out.sac = c; }
  if (out.enabled && !out.legalName) return { error: 'Enter the business name to show on invoices' };
  if (out.enabled && !out.state) return { error: 'Choose the state your business is registered in' };
  return out;
}

// Business details a buyer may add at checkout for a B2B invoice
export function cleanBuyerGst(g) {
  if (!g || typeof g !== 'object') return null;
  const gstin = String(g.gstin || '').trim().toUpperCase();
  const company = String(g.company || '').trim().slice(0, 160);
  if (gstin && !GSTIN_RE.test(gstin)) return { error: 'That GSTIN doesn’t look right — it has 15 characters, like 27ABCDE1234F1Z5' };
  // the GSTIN's first two digits are the registered state: that is the place of supply, whatever was typed
  const state = gstin && STATE_BY_CODE[gstin.slice(0, 2)] ? STATE_BY_CODE[gstin.slice(0, 2)] : STATES[String(g.state || '').trim()] ? String(g.state).trim() : '';
  if (!gstin && !company && !state) return null;
  return { gstin, company, state };
}

function financialYear(t) {
  const d = new Date(t + TZ_OFFSET);
  const y = d.getUTCFullYear(), m = d.getUTCMonth() + 1;
  return m >= 4 ? `${y}-${String((y + 1) % 100).padStart(2, '0')}` : `${y - 1}-${String(y % 100).padStart(2, '0')}`;
}
const viewKey = (id) => crypto.createHmac('sha256', SECRET).update(`inv.${id}`).digest('base64url').slice(0, 24);
export const invoiceUrl = (base, inv) => `${base}/invoice/${inv.id}?k=${viewKey(inv.id)}`;

function split(amount, rate, intra, registered) {
  if (!registered || !rate) return { taxable: r2(amount), cgst: 0, sgst: 0, igst: 0 };
  const taxable = r2(amount / (1 + rate / 100)), tax = r2(amount - taxable);
  return intra ? { taxable, cgst: r2(tax / 2), sgst: r2(tax - r2(tax / 2)), igst: 0 } : { taxable, cgst: 0, sgst: 0, igst: tax };
}
function nextNumber(userId, prefix, fy) {
  const n = q("SELECT COUNT(*) AS n FROM sinvoices WHERE userId = ? AND json_extract(data, '$.fy') = ? AND json_extract(data, '$.prefix') = ?").get(userId, fy, prefix).n;
  return `${prefix}/${fy}/${String(n + 1).padStart(4, '0')}`;
}

// lines: [{ index, name, kind, amount, sac?, rate? }] — amounts include GST; sac / rate given (credit notes) win,
// otherwise the order item's product decides, otherwise the seller's defaults
export function issueInvoice(owner, order, lines, { paymentId = null, gst = null, type = 'invoice', against = null, at = Date.now(), test = order.mode === 'test' } = {}) {
  const cfg = invoicingOf(owner);
  if (!cfg.enabled || !lines.length) return null;
  const registered = !!cfg.gstin;
  // a sale in a foreign currency is an export of services: IGST, or zero-rated under a LUT
  const iso = order.currency || 'INR', exported = iso !== 'INR';
  const buyerState = exported ? '' : gst?.state || '';
  const pos = exported ? 'Outside India' : buyerState || cfg.state; // place of supply: the buyer's state when known, otherwise the seller's
  const intra = !exported && pos === cfg.state;
  // a renewal / instalment is the plan's main product again
  const productOf = (i) => { const it = order.items?.[i], id = it?.productId || (it?.kind === 'renewal' ? order.items.find((x) => x.kind === 'main')?.productId : null), p = id && T.products.get(id); return p && p.userId === owner.id ? p : null; };
  const items = lines.map((l) => {
    const p = l.sac == null || l.rate == null ? productOf(l.index) : null;
    const own = l.rate ?? (GST_RATES.includes(p?.gstRate) ? p.gstRate : cfg.rate);
    const rate = registered ? (exported && cfg.lut ? 0 : own) : 0;
    return { index: l.index, name: l.name, kind: l.kind, sac: l.sac ?? (p?.hsn || cfg.sac), rate, amount: r2(l.amount), ...split(l.amount, rate, intra, registered) };
  });
  const sum = (k, list = items) => r2(list.reduce((s, i) => s + i[k], 0));
  // the per-rate summary (GSTR-1 reports taxable value and tax rate by rate)
  const rates = [...new Set(items.map((i) => i.rate))].sort((a, b) => a - b).map((rate) => { const list = items.filter((i) => i.rate === rate); return { rate, taxable: sum('taxable', list), cgst: sum('cgst', list), sgst: sum('sgst', list), igst: sum('igst', list), amount: sum('amount', list) }; });
  return tx(() => {
    const fy = financialYear(at);
    // Razorpay test-mode sales get their own TEST- series, so the real GST sequence has no gaps or fake sales
    const prefix = `${test ? 'TEST-' : ''}${type === 'credit' ? 'CN' : cfg.prefix}`;
    return T.sinvoices.insert({
      id: uid(), userId: owner.id, orderId: order.id, funnelId: order.funnelId, type, against, number: nextNumber(owner.id, prefix, fy), prefix, fy, at, paymentId, ...(test ? { test: true } : {}),
      registered, rate: rates.length === 1 ? rates[0].rate : null, rates, intra, items, total: sum('amount'), taxable: sum('taxable'), cgst: sum('cgst'), sgst: sum('sgst'), igst: sum('igst'),
      billedTo: { name: gst?.company || order.name || '', person: order.name || '', email: order.email || '', phone: order.phone || '', gstin: gst?.gstin || '', state: buyerState, stateCode: STATES[buyerState] || '' },
      seller: { name: cfg.legalName || owner.settings?.businessName || owner.name, gstin: cfg.gstin, address: cfg.address, state: cfg.state, stateCode: STATES[cfg.state] || '', email: cfg.email || owner.email },
      placeOfSupply: pos, ...(exported ? { currency: iso, export: true, lut: !!(registered && cfg.lut), fx: order.fx || null } : {}),
    });
  });
}

// ---------- refunds ----------
// itemIndexes: which items of the order to refund (default: everything not refunded yet)
export async function refundOrder(owner, order0, { itemIndexes, reason = '', by = 'seller' } = {}) {
  // claim the items first (re-read inside a transaction): a double click or a second tab can't refund them twice
  // while the first refund is still waiting on Razorpay / Stripe; a claim older than 5 minutes counts as abandoned
  const want = (itemIndexes?.length ? itemIndexes : order0.items.map((_, i) => i)).map(Number);
  let idx = [];
  const order = tx(() => {
    const o = T.orders.get(order0.id) || order0;
    idx = want.filter((i) => o.items[i] && !o.items[i].refunded && !(o.items[i].refundingAt && Date.now() - o.items[i].refundingAt < 300000));
    if (idx.length) { for (const i of idx) o.items[i].refundingAt = Date.now(); T.orders.put(o); }
    return o;
  });
  if (!idx.length) return { error: want.some((i) => order.items[i]?.refundingAt && !order.items[i]?.refunded) ? 'This refund is already being processed' : 'Nothing left to refund on this order' };
  const release = (list) => T.orders.update(order.id, (o) => { for (const i of list) if (o.items[i]) delete o.items[i].refundingAt; });
  try { return await refundClaimed(owner, order, idx, { reason, by }); } finally { release(idx); }
}
async function refundClaimed(owner, order, idx, { reason, by }) {
  const creds = rzpCreds(owner);
  const groups = new Map(); // payment id → item indexes
  for (const i of idx) { const pid = order.items[i].paymentId || ''; groups.set(pid, [...(groups.get(pid) || []), i]); }
  const done = [], errors = [];
  for (const [pid, list] of groups) {
    const amount = list.reduce((s, i) => s + Number(order.items[i].price || 0), 0);
    let refundId = null;
    // card payments through Stripe (pi_…) are refunded there
    if (pid.startsWith('pi_') && amount > 0) {
      const sc = stripeCreds(owner);
      if (!sc) { errors.push('Stripe isn’t connected, so this payment can’t be refunded from here — refund it in your Stripe dashboard'); continue; }
      try { refundId = (await stripeRefund(sc, pid, amount, order.currency || 'INR', reason)).id; } catch (e) { errors.push(`Stripe couldn’t refund this payment: ${e.message}`); continue; }
    } else if (pid && amount > 0) {
      if (!creds) { errors.push('Razorpay isn’t connected, so this payment can’t be refunded from here — refund it in your Razorpay dashboard'); continue; }
      try { refundId = (await rzpCall(creds, 'POST', `/payments/${pid}/refund`, { amount: Math.round(amount * 100), notes: { order: order.id, reason: String(reason).slice(0, 200) } })).id; } catch (e) { errors.push(`Razorpay couldn’t refund this payment: ${e.message}`); continue; }
    }
    done.push({ pid, list, amount, refundId });
  }
  if (!done.length) return { error: errors.join(' · ') };
  let updated = applyRefund(owner, order.id, done.map((d) => ({ items: d.list, amount: d.amount, refundId: d.refundId, paymentId: d.pid || null })), { reason, by });
  // a refunded plan stops billing: its subscription is cancelled straight away (plans.js imports this file, hence the late import)
  const planRefunded = done.some((d) => d.list.some((i) => ['main', 'renewal'].includes(order.items[i].kind)));
  if (planRefunded && order.plan?.subId && ['active', 'authenticated', 'pending', 'halted', 'paused'].includes(updated?.plan?.status)) {
    try {
      const { cancelPlan } = await import('./plans.js');
      await cancelPlan(updated, { atCycleEnd: false });
      updated = T.orders.update(order.id, (o) => { o.plan.cancelledOnRefund = Date.now(); });
    } catch (e) { errors.push(`Refunded, but the subscription couldn’t be cancelled: ${e.message} — cancel it in your payment dashboard`); }
  }
  return { order: updated, errors };
}

// Records refunds on the order (already refunded at the payment provider): items, totals, access,
// credit notes, webhooks, automations and analytics. parts: [{ items: [index], amount, refundId, paymentId }]
export function applyRefund(owner, orderId, parts, { reason = '', by = 'seller', base = null } = {}) {
  let order, fresh = [];
  tx(() => {
    order = T.orders.get(orderId);
    if (!order) return;
    order.refunds ||= [];
    for (const part of parts) {
      if (part.refundId && order.refunds.some((r) => r.refundId === part.refundId)) continue; // already recorded
      const items = part.items.filter((i) => order.items[i] && !order.items[i].refunded);
      const amount = items.length ? items.reduce((s, i) => s + Number(order.items[i].price || 0), 0) : Math.min(Number(part.amount) || 0, order.total);
      if (amount <= 0 && !items.length) continue;
      const at = Date.now();
      for (const i of items) order.items[i].refunded = { at, refundId: part.refundId || null };
      const r = { id: uid(), at, amount, items, refundId: part.refundId || null, paymentId: part.paymentId || null, reason: String(reason).slice(0, 300), by };
      order.refunds.push(r);
      order.refunded = (order.refunded || 0) + amount;
      if (!items.length) order.refundedUnassigned = (order.refundedUnassigned || 0) + amount; // part of a payment, not tied to an item
      order.total = Math.max(0, order.total - amount);
      fresh.push(r);
    }
    const was = order.status;
    order.status = order.items.every((i) => i.refunded) || order.total <= 0 ? 'refunded' : order.refunded ? 'partially_refunded' : order.status;
    // a fully refunded order gives its coupon use back
    if (order.status === 'refunded' && was !== 'refunded' && order.coupon) T.coupons.update(T.coupons.find({ userId: order.userId, code: order.coupon })?.id, (c) => { c.uses = Math.max(0, (c.uses || 0) - 1); });
    T.orders.put(order);
  });
  if (!order || !fresh.length) return order;
  // access: only the refunded items' products (other products in the same order stay)
  const refundedIdx = new Set(fresh.flatMap((r) => r.items));
  for (const a of T.access.all({ orderId: order.id })) if (refundedIdx.has(a.item) && !a.revoked) { a.revoked = true; a.revokedAt = Date.now(); a.revokeReason = 'refunded'; T.access.put(a); }
  // credit notes for invoiced items
  for (const r of fresh) {
    const invs = T.sinvoices.all({ orderId: order.id }).filter((i) => i.type === 'invoice');
    for (const inv of invs) {
      // the credit note mirrors the original lines: same code and rate (invoices from before per-line rates: the invoice's)
      const lines = inv.items.filter((l) => r.items.includes(l.index)).map((l) => ({ index: l.index, name: l.name, kind: l.kind, amount: l.amount, sac: l.sac ?? '', rate: l.rate ?? inv.rate ?? 0 }));
      if (lines.length) issueInvoice(owner, order, lines, { type: 'credit', against: inv.number, gst: inv.billedTo.gstin || inv.billedTo.state ? { gstin: inv.billedTo.gstin, company: inv.billedTo.name, state: inv.billedTo.state } : null });
    }
  }
  const { userId, ...out } = order;
  fireWebhook(order.userId, 'order.refunded', { refund: fresh.map((r) => ({ amount: r.amount, items: r.items.map((i) => order.items[i]?.name), refundId: r.refundId, reason: r.reason })), order: out });
  fireAutomation(order.userId, 'refund', { email: order.email, phone: order.phone, name: order.name, funnelId: order.funnelId, product: order.items[fresh[0].items[0]]?.name || '', amount: fresh.reduce((s, r) => s + r.amount, 0), source: order.source });
  // GA4: one refund per original payment (its transaction id), so the platform nets it out
  const byTxn = new Map();
  for (const r of fresh) for (const i of r.items) { const it = order.items[i]; if (it?.txn) byTxn.set(it.txn, [...(byTxn.get(it.txn) || []), it]); }
  for (const [txn, its] of byTxn) trackServer(order.userId, { name: 'Refund', funnelId: order.funnelId, id: txn, value: its.reduce((s, it) => s + Number(it.price || 0), 0), items: its.map((it) => ({ id: it.productId || it.kind, name: it.name, price: it.price })), buyer: order });
  return order;
}

// A refund made in the Razorpay dashboard (refund.processed webhook) → recorded here too
export function refundFromWebhook(owner, entity) {
  const pid = entity?.payment_id, rid = entity?.id;
  if (!pid || !rid) return null;
  const row = q("SELECT o.id FROM orders o, json_each(o.data, '$.items') i WHERE o.userId = ? AND json_extract(i.value, '$.paymentId') = ? LIMIT 1").get(owner.id, pid);
  const order = row && T.orders.get(row.id);
  if (!order || (order.refunds || []).some((r) => r.refundId === rid)) return order || null;
  const amount = Number(entity.amount || 0) / 100;
  const open = order.items.map((it, i) => [it, i]).filter(([it]) => it.paymentId === pid && !it.refunded);
  // which of this payment's items add up to the refunded amount (all of them, or e.g. just the bump);
  // this also covers our own refunds when Razorpay's webhook arrives before we've recorded them
  let items = [];
  const n = Math.min(open.length, 12);
  for (let mask = (1 << n) - 1; mask > 0; mask--) {
    const pick = open.slice(0, n).filter((_, k) => mask & (1 << k));
    if (Math.abs(pick.reduce((s, [it]) => s + Number(it.price || 0), 0) - amount) < 0.01) { items = pick.map(([, i]) => i); break; }
  }
  notify(owner.id, { kind: 'refund', title: `Refund · ${money(amount, order.currency || 'INR')} · ${order.name || order.email || order.phone}`, body: 'Refunded in Razorpay', link: '/orders' });
  return applyRefund(owner, order.id, [{ items, amount, refundId: rid, paymentId: pid }], { reason: 'Refunded in Razorpay', by: 'razorpay' });
}

// ---------- routes ----------
export function registerSales(app, { auth, wrap, secret, appUrl }) {
  SECRET = secret;
  app.get('/api/sales-invoices', auth, (req, res) => {
    const from = Number(req.query.from) || 0, to = Number(req.query.to) || Date.now() + 1;
    res.json(T.sinvoices.all({ userId: req.user.id, at: { gte: from, lt: to } }, { order: 'at', desc: true, limit: 10000 }).map((i) => ({ ...i, url: invoiceUrl(process.env.APP_URL || appUrl(req), i) })));
  });
  app.get('/api/sales-invoices/:iid', auth, (req, res) => {
    const i = T.sinvoices.get(req.params.iid);
    if (!i || i.userId !== req.user.id) return res.status(404).json({ error: 'Invoice not found' });
    res.json(i);
  });
  // the buyer's copy (the link in their email / library): ?k= proves they were given it
  app.get('/api/public/invoices/:iid', (req, res) => {
    const i = T.sinvoices.get(req.params.iid);
    const k = String(req.query.k || '');
    if (!i || k.length !== 24 || !crypto.timingSafeEqual(Buffer.from(k), Buffer.from(viewKey(i.id)))) return res.status(404).json({ error: 'Invoice not found' });
    res.set('Cache-Control', 'no-store').json(i);
  });
  app.post('/api/orders/:oid/refund', auth, wrap(async (req, res) => {
    const order = T.orders.get(req.params.oid);
    if (!order || order.userId !== req.user.id) return res.status(404).json({ error: 'Order not found' });
    const r = await refundOrder(req.user, order, { itemIndexes: Array.isArray(req.body?.items) ? req.body.items : null, reason: req.body?.reason });
    if (r.error) return res.status(400).json(r);
    res.json(r);
  }));
}

// Invoice link for an order's latest invoice (for emails and the thank-you page)
export const latestInvoiceUrl = (order, fallbackBase) => {
  const inv = T.sinvoices.all({ orderId: order.id }).filter((i) => i.type === 'invoice').sort((a, b) => b.at - a.at)[0];
  return inv ? invoiceUrl(linkBase(order.funnelId, fallbackBase), inv) : null;
};
