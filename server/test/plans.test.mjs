// Payment plans and memberships (Razorpay Subscriptions): instalments next to pay-in-full, a monthly
// membership, verified first charge, renewals added once each with their own invoice, failed payments
// pausing access (and restoring it), cancellation by the seller and by the buyer. Razorpay is a local fake.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import { startServer, register } from './helpers.mjs';

const KEY = 'rzp_test_PlAnS1234567', SECRET = 'plan_secret', WH = 'whsec_plans';
const sign = (s, d) => crypto.createHmac('sha256', s).update(d).digest('hex');
const subs = {}, invoices = {}, plans = [];
let rzp, srv, api, T, me, f, co, course;
const body = (req) => new Promise((r) => { let b = ''; req.on('data', (c) => { b += c; }); req.on('end', () => r(b)); });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 4000) => { const end = Date.now() + ms; while (Date.now() < end) { const v = await fn(); if (v) return v; await wait(50); } return fn(); };

before(async () => {
  rzp = http.createServer(async (req, res) => {
    const b = JSON.parse((await body(req)) || '{}');
    res.setHeader('content-type', 'application/json');
    const url = new URL(req.url, 'http://x');
    if (req.method === 'POST' && url.pathname === '/plans') { const p = { id: `plan_${plans.length + 1}`, ...b }; plans.push(p); return res.end(JSON.stringify(p)); }
    if (req.method === 'POST' && url.pathname === '/subscriptions') {
      const id = `sub_${crypto.randomBytes(4).toString('hex')}`;
      subs[id] = { id, plan_id: b.plan_id, total_count: b.total_count, addons: b.addons || [], status: 'created', paid_count: 0, charge_at: null };
      invoices[id] = [];
      return res.end(JSON.stringify(subs[id]));
    }
    let m = /^\/subscriptions\/(\w+)\/cancel$/.exec(url.pathname);
    if (m) { subs[m[1]].status = b.cancel_at_cycle_end ? subs[m[1]].status : 'cancelled'; subs[m[1]].cancelAtEnd = !!b.cancel_at_cycle_end; return res.end(JSON.stringify(subs[m[1]])); }
    m = /^\/subscriptions\/(\w+)$/.exec(url.pathname);
    if (m) return res.end(JSON.stringify(subs[m[1]]));
    if (req.method === 'GET' && url.pathname === '/orders') return res.end('{"items":[]}');
    if (url.pathname === '/invoices') return res.end(JSON.stringify({ items: invoices[url.searchParams.get('subscription_id')] || [] }));
    res.writeHead(404); res.end('{}');
  }).listen(0);
  await wait(30);
  srv = await startServer({ RAZORPAY_API_URL: `http://127.0.0.1:${rzp.address().port}`, APP_URL: 'https://app.example.in' });
  api = srv.api;
  ({ token: T } = await register(api));
  me = (await api('/me', 'GET', null, T)).data;
  await api('/channels/razorpay', 'PUT', { keyId: KEY, keySecret: SECRET, webhookSecret: WH }, T);
  course = (await api('/products', 'POST', { name: 'Coaching Programme', links: [{ label: 'Portal', url: 'https://example.com/portal' }] }, T)).data;
  f = (await api('/templates/coding/use', 'POST', {}, T)).data;
  co = f.steps.find((s) => s.type === 'checkout');
  const chk = co.blocks.find((b) => b.type === 'checkout');
  Object.assign(chk.props, { price: 29999, productId: course.id, planEnabled: true, planCount: 3, planPrice: 10999, bumpEnabled: true, bumpPrice: 499 });
  f = (await api(`/funnels/${f.id}`, 'PUT', { steps: f.steps, published: true }, T)).data;
  co = f.steps.find((s) => s.type === 'checkout');
});
after(async () => { await srv.stop(); rzp.close(); });

// Razorpay charges a subscription: an invoice is paid, then the webhook arrives
const charge = (subId, amount) => { const pid = `pay_${crypto.randomBytes(5).toString('hex')}`; invoices[subId].push({ id: `inv_${invoices[subId].length}`, status: 'paid', payment_id: pid, amount, amount_paid: amount, paid_at: Math.floor(Date.now() / 1000) }); subs[subId].paid_count++; subs[subId].status = 'active'; return pid; };
const webhook = (event, subId) => {
  const raw = JSON.stringify({ event, payload: { subscription: { entity: { id: subId } } } });
  return fetch(`${srv.base}/api/razorpay/webhook/${me.id}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-razorpay-signature': sign(WH, raw) }, body: raw });
};
const order = async (id) => (await api('/orders', 'GET', null, T)).data.orders.find((o) => o.id === id);
const buyer = (email) => ({ stepId: co.id, email, name: 'Kavya Rao', phone: '9876500000' });

let inst, instOrder;
test('instalments: 3 × ₹10,999 through a Razorpay subscription; coupons only for pay-in-full', async () => {
  await api('/coupons', 'POST', { code: 'FULL10', type: 'percent', value: 10 }, T);
  assert.equal((await api(`/public/${f.slug}/pay/start`, 'POST', { ...buyer('k@x.in'), plan: 'installments', coupon: 'FULL10' })).status, 400);
  const st = (await api(`/public/${f.slug}/pay/start`, 'POST', { ...buyer('k@x.in'), plan: 'installments', withBump: true })).data;
  assert.ok(st.subscription_id, JSON.stringify(st));
  assert.equal(st.order_id, undefined);
  const sub = subs[st.subscription_id];
  assert.equal(sub.total_count, 3);
  assert.equal(plans.at(-1).item.amount, 1099900);
  assert.deepEqual(sub.addons.map((a) => a.item.amount), [49900], 'the bump is a one-time add-on on the first charge');
  // a forged signature is refused; the real one creates the order
  const pid = charge(st.subscription_id, 1099900 + 49900);
  assert.equal((await api(`/public/${f.slug}/pay/verify`, 'POST', { payment: st.payment, razorpay_subscription_id: st.subscription_id, razorpay_payment_id: pid, razorpay_signature: 'x'.repeat(64) })).status, 400);
  const ok = (await api(`/public/${f.slug}/pay/verify`, 'POST', { payment: st.payment, razorpay_subscription_id: st.subscription_id, razorpay_payment_id: pid, razorpay_signature: sign(SECRET, `${pid}|${st.subscription_id}`) })).data;
  assert.ok(ok.orderId && ok.access, 'paid and delivered');
  inst = st; instOrder = ok.orderId;
  const o = await order(ok.orderId);
  assert.deepEqual([o.plan.type, o.plan.count, o.plan.amount, o.plan.status], ['installments', 3, 10999, 'active']);
  assert.equal(o.total, 10999 + 499);
  assert.equal((await api(`/public/${f.slug}/pay/start`, 'POST', { ...buyer('k@x.in'), plan: 'installments', orderId: ok.orderId })).status, 400, 'can’t be bolted onto an earlier order');
});

test('renewals are added once each with their own invoice; the plan completes', async () => {
  await api('/settings', 'PUT', { invoicing: { enabled: true, legalName: 'Coach LLP', gstin: '27ABCDE1234F1Z5', address: 'Pune', rate: 18 } }, T);
  charge(inst.subscription_id, 1099900);
  await webhook('subscription.charged', inst.subscription_id);
  await webhook('subscription.charged', inst.subscription_id); // Razorpay may deliver twice
  const o = await until(async () => { const x = await order(instOrder); return x.items.filter((i) => i.kind === 'renewal').length === 1 && x; });
  assert.ok(o, 'one renewal recorded');
  await wait(200);
  const again = await order(instOrder);
  assert.equal(again.items.filter((i) => i.kind === 'renewal').length, 1, 'no duplicate');
  assert.equal(again.total, 10999 * 2 + 499);
  assert.match(again.items.at(-1).name, /instalment 2 of 3/);
  assert.equal(again.invoices.filter((i) => i.type !== 'credit').length, 1, 'the renewal is invoiced (the first charge predates invoicing here)');
  charge(inst.subscription_id, 1099900);
  subs[inst.subscription_id].status = 'completed';
  await webhook('subscription.completed', inst.subscription_id);
  const done = await until(async () => { const x = await order(instOrder); return x.plan.status === 'completed' && x; });
  assert.equal(done.total, 10999 * 3 + 499);
});

let mem, memOrder, lib;
test('membership: ₹999/month; a failed payment pauses access, a successful retry restores it', async () => {
  const chk = co.blocks.find((b) => b.type === 'checkout');
  Object.assign(chk.props, { billing: 'monthly', price: 999, planEnabled: false, bumpEnabled: false });
  f = (await api(`/funnels/${f.id}`, 'PUT', { steps: f.steps }, T)).data;
  co = f.steps.find((s) => s.type === 'checkout');
  mem = (await api(`/public/${f.slug}/pay/start`, 'POST', buyer('m@x.in'))).data;
  assert.equal(subs[mem.subscription_id].total_count, 120);
  assert.equal(plans.at(-1).period, 'monthly');
  const pid = charge(mem.subscription_id, 99900);
  const ok = (await api(`/public/${f.slug}/pay/verify`, 'POST', { payment: mem.payment, razorpay_subscription_id: mem.subscription_id, razorpay_payment_id: pid, razorpay_signature: sign(SECRET, `${pid}|${mem.subscription_id}`) })).data;
  memOrder = ok.orderId; lib = ok.access;
  const libView = async () => (await api(`/access/${lib.split('/access/')[1]}`)).data;
  assert.equal((await libView()).products[0].status, 'active');
  assert.equal((await libView()).plans[0].text, '₹999/month');
  subs[mem.subscription_id].status = 'halted';
  await webhook('subscription.halted', mem.subscription_id);
  await until(async () => (await libView()).products[0].status !== 'active');
  assert.equal((await order(memOrder)).plan.status, 'halted');
  charge(mem.subscription_id, 99900); // the buyer updated their card, Razorpay charged again
  await webhook('subscription.charged', mem.subscription_id);
  assert.ok(await until(async () => (await libView()).products[0].status === 'active'), 'access is back');
});

test('cancelling: the buyer cancels a membership from their library (at the end of the period); the seller cancels plans', async () => {
  const token = lib.split('/access/')[1];
  assert.equal((await api(`/access/${token}/plan/${instOrder}/cancel`, 'POST')).status, 404, 'not their order');
  const r = (await api(`/access/${token}/plan/${memOrder}/cancel`, 'POST')).data;
  assert.equal(r.cancelAtEnd, true);
  assert.equal(subs[mem.subscription_id].cancelAtEnd, true);
  // seller: cancel straight away
  const c = (await api(`/orders/${memOrder}/plan/cancel`, 'POST', { now: true }, T)).data;
  assert.equal(c.plan.status, 'cancelled');
  assert.equal((await api(`/access/${token}`)).data.products[0].status, 'revoked', 'a cancelled membership ends access');
  const other = (await register(api)).token;
  assert.equal((await api(`/orders/${memOrder}/plan/cancel`, 'POST', {}, other)).status, 404);
  assert.equal((await api(`/public/${f.slug}/cod`, 'POST', { ...buyer('c@x.in') })).status, 400, 'no COD for memberships');
});
