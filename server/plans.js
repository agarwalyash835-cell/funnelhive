// Payment plans and memberships through Razorpay Subscriptions.
//   installments — "3 × ₹10,999 / month" next to pay-in-full: a fixed number of monthly charges
//   recurring    — a membership billed monthly or yearly until it's cancelled
// The first charge is verified like any payment (signature on payment_id|subscription_id) and creates the
// order. Every later charge, failure, cancellation and completion is read back from Razorpay (webhook
// subscription.* events, plus a daily check for sellers without a webhook) by syncPlan, which is idempotent:
// each Razorpay payment is added to the order once, with its own GST invoice.
import crypto from 'node:crypto';
import { T, q, uid, tx, JOBS, contactKey } from './db.js';
import { call, rzpCreds } from './razorpay.js';
import { stripe, stripeCreds } from './stripe.js';
import { revoke } from './products.js';
import { issueInvoice } from './sales.js';
import { fire as fireAutomation } from './automations.js';
import { enqueue as fireWebhook } from './webhooks.js';
import { sendEmail } from './messaging.js';

const DAY = 86400000;
const intIn = (v, lo, hi) => Math.min(hi, Math.max(lo, Math.round(Number(v) || 0)));
const RECURRING_COUNT = { monthly: 120, yearly: 10 }; // Razorpay needs an end: 10 years
export const INTERVAL_LABEL = { monthly: 'month', yearly: 'year' };

// What the buyer chose on a checkout: a plan, nothing (pay in full) or an error
export function planFor(p, body) {
  if (p.billing === 'monthly' || p.billing === 'yearly') return { type: 'recurring', interval: p.billing, count: RECURRING_COUNT[p.billing] };
  if (body.plan !== 'installments') return null;
  const count = intIn(p.planCount, 0, 36), amount = Math.round(Number(p.planPrice) || 0);
  if (!p.planEnabled || count < 2 || amount <= 0) return { error: 'This product can’t be paid in instalments' };
  return { type: 'installments', interval: 'monthly', count, amount };
}
export const planText = (pl) => (pl.type === 'installments' ? `${pl.count} × ₹${pl.amount.toLocaleString('en-IN')}/month` : `₹${pl.amount.toLocaleString('en-IN')}/${INTERVAL_LABEL[pl.interval]}`);

// One Razorpay plan per seller + price + period + name, created once and reused
async function rzpPlan(creds, userId, { interval, amount, name }) {
  const key = crypto.createHash('sha1').update(`${creds.mode}|${interval}|${amount}|${name}`).digest('hex').slice(0, 20);
  const have = T.rzplans.find({ userId, key });
  if (have) return have.planId;
  const r = await call(creds, 'POST', '/plans', { period: interval, interval: 1, item: { name: String(name).slice(0, 120), amount: Math.round(amount * 100), currency: 'INR' }, notes: { by: 'funnelhive' } });
  try { T.rzplans.insert({ id: uid(), userId, key, planId: r.id, at: Date.now() }); } catch {} // another process made it at the same moment
  return r.id;
}
// The subscription the buyer authorises in Razorpay Checkout. Order bumps, shipping etc. are one-time
// add-ons on the first charge.
export async function startSubscription(creds, { userId, charge, payId, funnelName }) {
  const main = charge.items[0];
  const planId = await rzpPlan(creds, userId, { interval: charge.plan.interval, amount: main.price, name: main.name });
  const addons = charge.items.slice(1).filter((i) => i.price > 0).map((i) => ({ item: { name: String(i.name).slice(0, 120), amount: Math.round(i.price * 100), currency: 'INR' } }));
  return call(creds, 'POST', '/subscriptions', { plan_id: planId, total_count: charge.plan.count, quantity: 1, customer_notify: 1, ...(addons.length ? { addons } : {}), notes: { payment: payId, funnel: String(funnelName).slice(0, 200) } });
}
const hmac = (secret, data) => crypto.createHmac('sha256', secret).update(data).digest('hex');
export const validSubscription = (secret, subId, paymentId, signature) => {
  const want = hmac(secret, `${paymentId}|${subId}`), got = String(signature || '');
  return want.length === got.length && crypto.timingSafeEqual(Buffer.from(want), Buffer.from(got));
};

// ---------- keeping orders in step with Razorpay ----------
const locks = new Set();
const orderOfSub = (subId) => { const pay = T.payments.find({ rzpOrderId: subId }); return pay ? { pay, order: pay.result?.orderId ? T.orders.get(pay.result.orderId) : null } : { pay: null, order: null }; };

// finalize: (pay, paymentId) → creates the order for a first charge the browser never reported back
// Razorpay: read the subscription and its paid invoices
export async function syncPlan(subId, { finalize, base } = {}) {
  return withLock(subId, async () => {
    const { pay } = orderOfSub(subId);
    if (!pay) return null;
    const owner = T.users.get(pay.userId);
    const creds = owner && rzpCreds(owner);
    if (!creds) return null;
    const sub = await call(creds, 'GET', `/subscriptions/${subId}`);
    const inv = await call(creds, 'GET', `/invoices?subscription_id=${encodeURIComponent(subId)}&count=100`);
    const paid = (inv.items || []).filter((i) => i.status === 'paid' && i.payment_id).sort((a, b) => (a.paid_at || 0) - (b.paid_at || 0))
      .map((i) => ({ paymentId: i.payment_id, amount: (i.amount_paid ?? i.amount ?? 0) / 100, at: (i.paid_at || Date.now() / 1000) * 1000 }));
    return applyPlan(subId, owner, { status: sub.status, paidCount: sub.paid_count, nextAt: sub.charge_at ? sub.charge_at * 1000 : null, paid }, { finalize, base });
  });
}
// Stripe: the same, from the subscription and its paid invoices (statuses mapped to Razorpay's words)
const STRIPE_STATUS = { active: 'active', trialing: 'active', past_due: 'pending', unpaid: 'halted', canceled: 'cancelled', incomplete: 'created', incomplete_expired: 'expired', paused: 'halted' };
export async function syncStripePlan(subId, { finalize, base } = {}) {
  return withLock(subId, async () => {
    const { pay, order } = orderOfSub(subId);
    if (!pay) return null;
    const owner = T.users.get(pay.userId);
    const sc = owner && stripeCreds(owner);
    if (!sc) return null;
    const sub = await stripe(sc, 'GET', `/subscriptions/${subId}`);
    const inv = await stripe(sc, 'GET', '/invoices', { subscription: subId, status: 'paid', limit: 100 });
    const paid = (inv.data || []).filter((i) => i.payment_intent).sort((a, b) => (a.status_transitions?.paid_at || 0) - (b.status_transitions?.paid_at || 0))
      .map((i) => ({ paymentId: typeof i.payment_intent === 'string' ? i.payment_intent : i.payment_intent.id, amount: (i.amount_paid || 0) / 100, at: (i.status_transitions?.paid_at || Date.now() / 1000) * 1000 }));
    let status = STRIPE_STATUS[sub.status] || sub.status;
    // instalments end by cancel_at after the last payment: that's "paid in full", not a cancellation
    const pl = order?.plan || pay.plan;
    if (pl?.type === 'installments' && paid.length >= pl.count) status = 'completed';
    return applyPlan(subId, owner, { status, paidCount: paid.length, nextAt: status === 'active' && sub.current_period_end ? sub.current_period_end * 1000 : null, paid, cancelAtEnd: !!sub.cancel_at_period_end }, { finalize, base });
  });
}
async function withLock(subId, fn) {
  if (!subId || locks.has(subId)) return null;
  locks.add(subId);
  try { return await fn(); } catch (e) { console.error('plan sync failed', subId, e.message); return null; } finally { locks.delete(subId); }
}
// paid: [{ paymentId, amount, at }] oldest first — the first is the checkout payment, the rest renewals (added once each)
function applyPlan(subId, owner, { status, paidCount, nextAt, paid, cancelAtEnd }, { finalize, base }) {
  let { pay, order } = orderOfSub(subId);
  if (!order && paid.length && finalize) { finalize(pay, paid[0].paymentId, base); ({ order } = orderOfSub(subId)); }
  if (!order?.plan) return null;
  const mainName = order.items.find((i) => i.kind === 'main')?.name || 'Membership';
  const added = [];
  const prev = order.plan.status;
  order = tx(() => T.orders.update(order.id, (o) => {
    const known = new Set(o.items.map((i) => i.paymentId).filter(Boolean));
    let n = o.items.filter((i) => i.kind === 'main' || i.kind === 'renewal').length;
    for (const p of paid) {
      if (known.has(p.paymentId)) continue;
      n++;
      const price = Math.round(p.amount * 100) / 100;
      o.items.push({ name: `${mainName} — ${o.plan.type === 'installments' ? `instalment ${n} of ${o.plan.count}` : `renewal ${n}`}`, price, kind: 'renewal', paymentId: p.paymentId, at: p.at, txn: `${o.id}-${o.items.length + 1}` });
      o.total += price;
      added.push(o.items.length - 1);
    }
    o.plan = { ...o.plan, status, paid: paidCount ?? o.plan.paid, nextAt, syncedAt: Date.now(), ...(cancelAtEnd ? { cancelAtEnd: true } : {}) };
  }));
  const who = { email: order.email, phone: order.phone, name: order.name, funnelId: order.funnelId, product: mainName };
  for (const idx of added) {
    const it = order.items[idx];
    issueInvoice(owner, order, [{ index: idx, name: it.name, kind: it.kind, amount: it.price }], { paymentId: it.paymentId, gst: order.gst || null });
    fireAutomation(order.userId, 'renewal', { ...who, amount: it.price });
    fireWebhook(order.userId, 'order.renewed', { order: order.id, amount: it.price, payment: it.paymentId, plan: order.plan });
  }
  if (status !== prev) onStatusChange(owner, order, prev, status);
  return order;
}

function onStatusChange(owner, order, prev, now) {
  const pl = order.plan, product = order.items.find((i) => i.kind === 'main')?.name || '';
  const who = { email: order.email, phone: order.phone, name: order.name, funnelId: order.funnelId, product, amount: pl.amount };
  // a charge failed (Razorpay retries, then halts): dunning automations and the seller's webhook
  if (now === 'pending' || (now === 'halted' && prev !== 'pending')) {
    fireAutomation(order.userId, 'payment_failed', who);
    fireWebhook(order.userId, 'order.payment_failed', { order: order.id, plan: pl, email: order.email });
  }
  // access ends when payments stop: retries exhausted, a cancelled membership, or an expired one
  const ends = now === 'halted' || now === 'expired' || (now === 'cancelled' && pl.type === 'recurring');
  if (ends && !pl.accessEnded) {
    revoke(order.userId, { orderId: order.id }, now === 'cancelled' ? 'cancelled' : 'payment failed');
    T.orders.update(order.id, (o) => { o.plan.accessEnded = Date.now(); });
    fireWebhook(order.userId, 'order.plan_ended', { order: order.id, status: now, email: order.email });
    const biz = owner.settings?.businessName || owner.name;
    if (order.email && now === 'halted') sendEmail(owner, { to: order.email, subject: `Your payment for ${product} didn’t go through`, text: `Hi ${String(order.name || '').split(/\s+/)[0] || 'there'},\n\nWe couldn’t collect your payment for ${product} (${planText(pl)}), so your access is paused. Reply to this email or contact ${biz} to continue.\n\n— ${biz}` }).catch(() => {});
  }
  // payments are back on track: access returns
  if (now === 'active' && pl.accessEnded && ['pending', 'halted'].includes(prev)) {
    for (const a of T.access.all({ userId: order.userId, orderId: order.id })) if (a.revoked && a.revokeReason === 'payment failed') T.access.update(a.id, (x) => { x.revoked = false; delete x.revokeReason; delete x.revokedAt; });
    T.orders.update(order.id, (o) => { delete o.plan.accessEnded; });
  }
  if (now === 'completed') fireWebhook(order.userId, 'order.plan_completed', { order: order.id });
}

// webhook: any subscription.* event re-reads that subscription
export function onSubscriptionEvent(ev, { finalize, base }) {
  const subId = ev.payload?.subscription?.entity?.id;
  if (subId) syncPlan(subId, { finalize, base });
}

// daily: sellers without a webhook still see renewals and failures within a day
let lastJob = 0;
export async function planJob(now = Date.now(), opts = {}) {
  if (now - lastJob < 3600000 && !opts.force) return;
  lastJob = now;
  const due = q("SELECT data FROM orders WHERE json_extract(data, '$.plan.subId') IS NOT NULL AND json_extract(data, '$.plan.status') IN ('created','authenticated','active','pending','halted')").all().map((r) => JSON.parse(r.data))
    .filter((o) => opts.force || now - (o.plan.syncedAt || 0) > 20 * 3600000);
  for (const o of due.slice(0, 500)) await (o.plan.provider === 'stripe' ? syncStripePlan : syncPlan)(o.plan.subId, opts);
}

// ---------- cancelling ----------
async function cancel(order, { atCycleEnd }) {
  const owner = T.users.get(order.userId);
  if (!order.plan?.subId) throw new Error('This plan isn’t billed automatically');
  if (!['active', 'authenticated', 'pending', 'halted', 'created'].includes(order.plan.status)) throw new Error('This plan has already ended');
  if (order.plan.provider === 'stripe') {
    const sc = stripeCreds(owner);
    if (!sc) throw new Error('Stripe isn’t connected');
    if (atCycleEnd) { await stripe(sc, 'POST', `/subscriptions/${order.plan.subId}`, { cancel_at_period_end: true }); return T.orders.update(order.id, (o) => { o.plan.cancelAtEnd = true; }); }
    await stripe(sc, 'DELETE', `/subscriptions/${order.plan.subId}`);
    return (await syncStripePlan(order.plan.subId)) || T.orders.get(order.id);
  }
  const creds = rzpCreds(owner);
  if (!creds) throw new Error('Razorpay isn’t connected');
  await call(creds, 'POST', `/subscriptions/${order.plan.subId}/cancel`, { cancel_at_cycle_end: atCycleEnd ? 1 : 0 });
  if (atCycleEnd) return T.orders.update(order.id, (o) => { o.plan.cancelAtEnd = true; });
  return (await syncPlan(order.plan.subId)) || T.orders.get(order.id);
}

export function registerPlans(app, { auth, resolveToken }) {
  // seller: stop a plan now (instalments) or at the end of the paid period (memberships)
  app.post('/api/orders/:oid/plan/cancel', auth, async (req, res) => {
    const o = T.orders.get(req.params.oid);
    if (!o || o.userId !== req.user.id || !o.plan) return res.status(404).json({ error: 'Order not found' });
    try { res.json(await cancel(o, { atCycleEnd: o.plan.type === 'recurring' && req.body?.now !== true })); } catch (e) { res.status(400).json({ error: e.message }); }
  });
  app.post('/api/orders/:oid/plan/sync', auth, async (req, res) => {
    const o = T.orders.get(req.params.oid);
    if (!o || o.userId !== req.user.id || !o.plan?.subId) return res.status(404).json({ error: 'Order not found' });
    res.json((await (o.plan.provider === 'stripe' ? syncStripePlan : syncPlan)(o.plan.subId)) || o);
  });
  // buyer, from their library link: cancel a membership (access lasts until the end of the paid period)
  app.post('/api/access/:token/plan/:oid/cancel', async (req, res) => {
    const ctx = resolveToken(req.params.token);
    const o = ctx && T.orders.get(req.params.oid);
    if (!o || o.userId !== ctx.userId || !o.plan || String(o.email).toLowerCase() !== String(ctx.rows[0]?.email || '').toLowerCase()) return res.status(404).json({ error: 'Not found' });
    if (o.plan.type !== 'recurring') return res.status(400).json({ error: 'Instalment plans can’t be cancelled here — please contact the seller' });
    try { const r = await cancel(o, { atCycleEnd: true }); res.json({ ok: true, cancelAtEnd: !!r.plan?.cancelAtEnd }); } catch (e) { res.status(400).json({ error: e.message }); }
  });
  if (JOBS) setInterval(() => planJob().catch(() => {}), 3600000).unref();
}

// the buyer's plans, for their library page
export function buyerPlans(userId, email) {
  if (!email) return [];
  return q("SELECT data FROM orders WHERE userId = ? AND ckey = ? AND json_extract(data, '$.plan') IS NOT NULL ORDER BY at DESC").all(userId, contactKey(email)).map((r) => JSON.parse(r.data))
    .map((o) => ({ orderId: o.id, product: o.items.find((i) => i.kind === 'main')?.name || '', type: o.plan.type, text: planText(o.plan), status: o.plan.status, paid: o.plan.paid || 1, count: o.plan.type === 'installments' ? o.plan.count : null, nextAt: o.plan.nextAt || null, cancelAtEnd: !!o.plan.cancelAtEnd }));
}
