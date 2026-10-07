// Razorpay checkout: a local fake of Razorpay's API checks auth and hands out order ids;
// signatures are computed exactly like Razorpay does (HMAC-SHA256 with the key secret).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import { startServer, register } from './helpers.mjs';

const KEY = 'rzp_test_AbCdEf123456', SECRET = 'test_secret_xyz', WH = 'whsec_test_123';
const created = [];
let fake, srv, api, T, f, co, up;
const sign = (s, d) => crypto.createHmac('sha256', s).update(d).digest('hex');

before(async () => {
  fake = http.createServer((req, res) => {
    const ok = req.headers.authorization === `Basic ${Buffer.from(`${KEY}:${SECRET}`).toString('base64')}`;
    let b = '';
    req.on('data', (c) => { b += c; });
    req.on('end', () => {
      res.setHeader('content-type', 'application/json');
      if (!ok) { res.writeHead(401); return res.end(JSON.stringify({ error: { description: 'Authentication failed' } })); }
      if (req.method === 'GET') return res.end(JSON.stringify({ items: [] }));
      const body = JSON.parse(b);
      const o = { id: `order_${crypto.randomBytes(6).toString('hex')}`, amount: body.amount, currency: body.currency, receipt: body.receipt };
      created.push(o);
      res.end(JSON.stringify(o));
    });
  }).listen(0);
  await new Promise((r) => setTimeout(r, 30));
  srv = await startServer({ RAZORPAY_API_URL: `http://127.0.0.1:${fake.address().port}` });
  api = srv.api;
  T = (await register(api)).token;
  f = (await api('/templates/yoga/use', 'POST', {}, T)).data;
  await api(`/funnels/${f.id}`, 'PUT', { published: true }, T);
  co = f.steps.find((s) => s.type === 'checkout');
  up = f.steps.find((s) => s.type === 'upsell');
});
after(async () => { await srv.stop(); fake.close(); });
const checkout = () => co.blocks.find((b) => b.type === 'checkout').props;
const pay = (body) => api(`/public/${f.slug}/pay/start`, 'POST', body);
const verify = (start, over = {}) => {
  const pid = `pay_${crypto.randomBytes(5).toString('hex')}`;
  return api(`/public/${f.slug}/pay/verify`, 'POST', { payment: start.payment, razorpay_order_id: start.order_id, razorpay_payment_id: pid, razorpay_signature: sign(SECRET, `${start.order_id}|${pid}`), ...over });
};

test('without Razorpay connected, checkout stays in demo mode', async () => {
  assert.equal((await pay({ stepId: co.id, email: 'demo@x.dev' })).data.provider, 'demo');
  assert.equal((await api(`/public/${f.slug}/order`, 'POST', { stepId: co.id, email: 'demo@x.dev' })).status, 200);
});

test('connecting: keys are checked with Razorpay, the secret is never returned', async () => {
  assert.equal((await api('/channels/razorpay', 'PUT', { keyId: 'pk_live_nope', keySecret: 'x' }, T)).status, 400);
  const bad = await api('/channels/razorpay', 'PUT', { keyId: KEY, keySecret: 'wrong' }, T);
  assert.equal(bad.status, 400);
  assert.match(bad.data.error, /rejected these keys/);
  const ok = await api('/channels/razorpay', 'PUT', { keyId: KEY, keySecret: SECRET, webhookSecret: WH }, T);
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  assert.deepEqual([ok.data.configured, ok.data.mode, ok.data.hasWebhookSecret], [true, 'test', true]);
  const ch = (await api('/channels', 'GET', null, T)).data;
  assert.equal(ch.razorpay.configured, true);
  assert.ok(!JSON.stringify(ch).includes(SECRET) && !JSON.stringify(ch).includes(WH));
});

test('paying: server-side amount, signature verified, coupon counted only once paid', async () => {
  assert.equal((await api(`/public/${f.slug}/order`, 'POST', { stepId: co.id, email: 'free@x.dev' })).status, 409, 'no more "paid" orders without paying');
  assert.equal((await api(`/public/${f.slug}/order?preview=1`, 'POST', { stepId: co.id, email: 'pv@x.dev' })).status, 200, 'preview still works');
  const c = (await api('/coupons', 'POST', { code: 'RZP10', type: 'percent', value: 10 }, T)).data;
  const p = checkout();
  const price = Number(p.price), bump = Number(p.bumpPrice);
  const s = (await pay({ stepId: co.id, email: 'asha@x.dev', name: 'Asha', phone: '9876500000', coupon: 'rzp10', withBump: true, price: 1 })).data;
  assert.equal(s.provider, 'razorpay');
  assert.equal(s.key, KEY);
  const expected = price - Math.round(price * 0.1) + bump;
  assert.equal(s.amount, expected * 100, 'amount in paise, from the funnel — not from the browser');
  assert.deepEqual(s.prefill, { name: 'Asha', email: 'asha@x.dev', contact: '9876500000' });
  assert.equal((await api('/coupons', 'GET', null, T)).data.find((x) => x.id === c.id).uses, 0, 'not used until paid');
  assert.equal((await verify(s, { razorpay_signature: 'f'.repeat(64) })).status, 400, 'forged signature refused');
  assert.equal((await verify(s, { razorpay_order_id: 'order_other' })).status, 400, 'signature for another order refused');
  const pid = 'pay_fixed123';
  const v = await verify(s, { razorpay_payment_id: pid, razorpay_signature: sign(SECRET, `${s.order_id}|${pid}`) });
  assert.equal(v.status, 200, JSON.stringify(v.data));
  assert.equal(v.data.total, expected);
  const again = await verify(s, { razorpay_payment_id: pid, razorpay_signature: sign(SECRET, `${s.order_id}|${pid}`) });
  assert.equal(again.data.orderId, v.data.orderId, 'verifying twice never creates two orders');
  assert.equal((await api('/coupons', 'GET', null, T)).data.find((x) => x.id === c.id).uses, 1);
  const orders = (await api('/orders', 'GET', null, T)).data.orders.filter((o) => o.email === 'asha@x.dev');
  assert.equal(orders.length, 1);
  assert.equal(orders[0].provider, 'razorpay');
  assert.equal(orders[0].mode, 'test');
  assert.equal(orders[0].items[0].paymentId, pid);

  // upsell: a second Razorpay payment added to the same order
  const u = (await pay({ stepId: up.id, orderId: v.data.orderId })).data;
  assert.equal(u.provider, 'razorpay');
  assert.equal(u.prefill.email, 'asha@x.dev', 'buyer details carried over to the upsell');
  const uv = (await verify(u)).data;
  assert.equal(uv.orderId, v.data.orderId);
  assert.ok(uv.added > 0 && uv.total === expected + uv.added);
});

test('webhook backup: payment.captured completes an order whose browser never reported back', async () => {
  const s = (await pay({ stepId: co.id, email: 'closed-tab@x.dev', name: 'Ravi' })).data;
  const me = (await api('/me', 'GET', null, T)).data;
  const body = JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: { id: 'pay_hook1', order_id: s.order_id, amount: s.amount } } } });
  const hook = (sig) => fetch(`${srv.base}/api/razorpay/webhook/${me.id}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-razorpay-signature': sig }, body });
  assert.equal((await hook('0'.repeat(64))).status, 400, 'unsigned webhook refused');
  assert.equal((await hook(sign(WH, body))).status, 200);
  assert.equal((await hook(sign(WH, body))).status, 200, 'retries are harmless');
  const orders = (await api('/orders', 'GET', null, T)).data.orders.filter((o) => o.email === 'closed-tab@x.dev');
  assert.equal(orders.length, 1);
  // the browser arriving late gets the same order
  const late = (await verify(s, { razorpay_payment_id: 'pay_hook1', razorpay_signature: sign(SECRET, `${s.order_id}|pay_hook1`) })).data;
  assert.equal(late.orderId, orders[0].id);
});

test('nothing to charge (100% coupon) → order without opening Razorpay', async () => {
  await api('/coupons', 'POST', { code: 'GIFT100', type: 'percent', value: 100 }, T);
  const r = (await pay({ stepId: co.id, email: 'gift@x.dev', coupon: 'GIFT100' })).data;
  assert.equal(r.provider, 'free');
  assert.equal(r.total, 0);
  assert.ok(r.orderId);
});
