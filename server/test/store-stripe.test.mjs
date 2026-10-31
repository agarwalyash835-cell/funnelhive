// The store paid by card through Stripe (a seller with Stripe and no Razorpay): the server sets the amount, the order
// is recorded only once Stripe reports the PaymentIntent paid (once, however often it's verified), the thank-you gets
// its tracking link, and a refund goes back through Stripe. Stripe is a local fake.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import { startServer, register } from './helpers.mjs';

const SK = 'sk_test_51StoreStripeKeyAbc', PK = 'pk_test_51StoreStripeKeyAbc';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const body = (req) => new Promise((r) => { let b = ''; req.on('data', (c) => { b += c; }); req.on('end', () => r(b)); });
const pis = {}, refunds = [];
let st, srv, api, T, L;

before(async () => {
  st = http.createServer(async (req, res) => {
    const p = Object.fromEntries(new URLSearchParams(await body(req)));
    const path = new URL(req.url, 'http://x').pathname;
    res.setHeader('content-type', 'application/json');
    const send = (o) => res.end(JSON.stringify(o));
    if (path === '/balance') return send({ object: 'balance' });
    if (path === '/customers' && req.method === 'POST') return send({ id: 'cus_store' });
    if (path === '/payment_intents' && req.method === 'POST') {
      const id = `pi_${crypto.randomBytes(4).toString('hex')}`;
      pis[id] = { id, amount: Number(p.amount), amount_received: 0, currency: p.currency, client_secret: `${id}_secret`, status: 'requires_payment_method', metadata: { payment: p['metadata[payment]'] } };
      return send(pis[id]);
    }
    const m = /^\/payment_intents\/(\w+)$/.exec(path);
    if (m) return send(pis[m[1]]);
    if (path === '/refunds') { const r = { id: `re_${refunds.length}`, payment_intent: p.payment_intent, amount: Number(p.amount) }; refunds.push(r); return send(r); }
    res.writeHead(404); send({ error: { message: `no ${path}` } });
  }).listen(0);
  await wait(30);
  srv = await startServer({ STRIPE_API_URL: `http://127.0.0.1:${st.address().port}`, APP_URL: 'https://app.example.in' });
  api = srv.api;
  T = (await register(api)).token;
  assert.equal((await api('/channels/stripe', 'PUT', { publishableKey: PK, secretKey: SK }, T)).status, 200);
  const p = (await api('/products', 'POST', { name: 'Chai Masterclass' }, T)).data;
  assert.equal((await api('/store', 'PUT', { handle: 'chai-cards', name: 'Chai Cards', enabled: true }, T)).status, 200);
  L = (await api('/store/listings', 'POST', { kind: 'product', refId: p.id, price: 799 }, T)).data;
});
after(async () => { await srv.stop(); st.close(); });

const pub = (p, b) => api(`/s/chai-cards${p}`, b ? 'POST' : 'GET', b);
const buyer = { name: 'Asha Rao', email: 'asha@x.in', phone: '9876501234' };

let orderId;
test('paying by card: the server sets the amount; the order exists only once Stripe says paid, and only once', async () => {
  assert.equal((await pub('')).data.store.payments, 'stripe');
  const s = await pub('/pay/start', { cart: [{ id: L.id, qty: 1, price: 1 }], ...buyer });
  assert.equal(s.status, 200, JSON.stringify(s.data));
  assert.equal(s.data.provider, 'stripe');
  const pi = Object.values(pis).find((x) => x.metadata.payment === s.data.payment);
  assert.ok(pi, 'a PaymentIntent for this payment');
  assert.deepEqual([pi.amount, pi.currency], [79900, 'inr'], 'the catalogue price, not the cart’s');
  // not paid yet: nothing is recorded
  assert.equal((await pub('/pay/stripe/verify', { payment: s.data.payment })).status, 400);
  assert.equal((await api('/orders', 'GET', null, T)).data.orders.length, 0);
  Object.assign(pi, { status: 'succeeded', amount_received: 79900 });
  const ok = await pub('/pay/stripe/verify', { payment: s.data.payment });
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  assert.ok(ok.data.orderId);
  assert.match(ok.data.track, /^\/s\/chai-cards\/order\/\w+\?k=/, 'the thank-you gets its order page');
  orderId = ok.data.orderId;
  const again = await pub('/pay/stripe/verify', { payment: s.data.payment });
  assert.equal(again.data.orderId, orderId, 'verified twice: one order');
  const orders = (await api('/orders', 'GET', null, T)).data.orders;
  assert.equal(orders.length, 1);
  assert.deepEqual([orders[0].provider, orders[0].total, orders[0].funnel], ['stripe', 799, 'Online store']);
  // another store's address can't confirm this payment
  assert.equal((await api('/s/demo-grocery/pay/stripe/verify', 'POST', { payment: s.data.payment })).status, 404);
});

test('a refund goes back through Stripe', async () => {
  const r = await api(`/orders/${orderId}/refund`, 'POST', { reason: 'Wrong course' }, T);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(refunds.length, 1);
  assert.equal(refunds[0].amount, 79900);
  assert.ok(refunds[0].payment_intent.startsWith('pi_'));
  const o = (await api('/orders', 'GET', null, T)).data.orders.find((x) => x.id === orderId);
  assert.equal(o.status, 'refunded');
});
