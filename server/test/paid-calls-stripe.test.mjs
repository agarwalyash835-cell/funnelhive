// Paid calls by card: a calendar priced in USD holds the slot while the buyer pays in the Stripe form, is confirmed only
// once Stripe reports the PaymentIntent paid (order in USD), and a seller cancellation refunds through Stripe. Stripe is a local fake.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import { startServer, register } from './helpers.mjs';

const SK = 'sk_test_51CallsStripeKeyAbc', PK = 'pk_test_51CallsStripeKeyAbc';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 4000) => { const end = Date.now() + ms; while (Date.now() < end) { const v = await fn(); if (v) return v; await wait(50); } return fn(); };
const body = (req) => new Promise((r) => { let b = ''; req.on('data', (c) => { b += c; }); req.on('end', () => r(b)); });
const pis = {}, refunds = [];
let st, srv, api, T, v, cal;

before(async () => {
  st = http.createServer(async (req, res) => {
    const p = Object.fromEntries(new URLSearchParams(await body(req)));
    const path = new URL(req.url, 'http://x').pathname;
    res.setHeader('content-type', 'application/json');
    const send = (o) => res.end(JSON.stringify(o));
    if (path === '/balance') return send({ object: 'balance' });
    if (path === '/customers' && req.method === 'POST') return send({ id: 'cus_call' });
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
  srv = await startServer({ STRIPE_API_URL: `http://127.0.0.1:${st.address().port}`, APP_URL: 'https://app.example.in', FX_RATES: 'USD:80' });
  api = srv.api;
  T = (await register(api)).token;
  assert.equal((await api('/channels/stripe', 'PUT', { publishableKey: PK, secretKey: SK }, T)).status, 200);
  v = (await api('/templates/v-founders/use', 'POST', {}, T)).data;
  const s = v.steps.find((x) => x.blocks.some((b) => b.type === 'booking'));
  s.blocks.find((b) => b.type === 'booking').props.qualifiedOnly = false;
  v = (await api(`/funnels/${v.id}`, 'PUT', { steps: v.steps, published: true }, T)).data;
  cal = (await api('/calendars', 'GET', null, T)).data[0];
  const hours = Object.fromEntries(['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].map((d) => [d, [['09:00', '13:00']]]));
  cal = (await api(`/calendars/${cal.id}`, 'PUT', { duration: 60, buffer: 0, noticeHours: 0, daysAhead: 7, hours, price: 50, currency: 'USD', refundHours: 24 }, T)).data;
});
after(async () => { await srv.stop(); st.close(); });

const bookStep = () => v.steps.find((s) => s.blocks.some((b) => b.type === 'booking'));
const blockId = () => bookStep().blocks.find((b) => b.type === 'booking').id;
const slots = async () => (await api(`/public/${v.slug}/slots?stepId=${bookStep().id}&blockId=${blockId()}`)).data;

test('a USD call: the slot is held, confirmed only once Stripe says paid, recorded as a USD order', async () => {
  assert.equal(cal.currency, 'USD');
  const s = await slots();
  assert.deepEqual([s.calendar.price, s.calendar.currency], [50, 'USD']);
  const start = s.slots[1];
  const r = (await api(`/public/${v.slug}/book`, 'POST', { stepId: bookStep().id, blockId: blockId(), start, email: 'jane@x.com', name: 'Jane Doe', phone: '+15555550100' })).data;
  assert.deepEqual([r.pay.provider, r.pay.currency, r.pay.amount, r.pay.publishableKey], ['stripe', 'USD', 50, PK]);
  const pi = pis[r.pay.intent];
  assert.deepEqual([pi.amount, pi.currency], [5000, 'usd']);
  assert.ok(!(await slots()).slots.includes(start), 'held while paying');
  // not paid yet: refused
  assert.equal((await api(`/public/${v.slug}/book/stripe/verify`, 'POST', { payment: r.pay.payment })).status, 400);
  Object.assign(pi, { status: 'succeeded', amount_received: 5000 });
  const ok = await api(`/public/${v.slug}/book/stripe/verify`, 'POST', { payment: r.pay.payment });
  assert.equal(ok.status, 200);
  assert.ok(ok.data.ok && ok.data.manage);
  const bk = (await api('/bookings', 'GET', null, T)).data.find((b) => b.email === 'jane@x.com');
  assert.deepEqual([bk.status, bk.paid, bk.calendar.currency], ['confirmed', 50, 'USD']);
  const order = (await api('/orders', 'GET', null, T)).data.orders.find((o) => o.id === bk.orderId);
  assert.deepEqual([order.currency, order.total, order.provider], ['USD', 50, 'stripe']);
  // verifying again is harmless
  assert.equal((await api(`/public/${v.slug}/book/stripe/verify`, 'POST', { payment: r.pay.payment })).status, 200);
});

test('the seller cancels: refunded through Stripe in USD', async () => {
  const bk = (await api('/bookings', 'GET', null, T)).data.find((b) => b.email === 'jane@x.com');
  assert.equal((await api(`/bookings/${bk.id}/cancel`, 'POST', {}, T)).status, 200);
  const re = await until(() => refunds[0]);
  assert.deepEqual([re.payment_intent, re.amount], [bk.paymentId || re.payment_intent, 5000]);
  assert.ok((await until(async () => (await api('/bookings', 'GET', null, T)).data.find((b) => b.id === bk.id && b.refunded))));
});

test('a priced call with nothing connected for its currency is booked unpaid', async () => {
  await api(`/calendars/${cal.id}`, 'PUT', { currency: 'INR' }, T);
  await api('/channels/stripe', 'PUT', { clear: true }, T);
  const s = await slots();
  const r = await api(`/public/${v.slug}/book`, 'POST', { stepId: bookStep().id, blockId: blockId(), start: s.slots[3], email: 'ravi@x.in', name: 'Ravi K' });
  assert.equal(r.status, 200);
  assert.ok(!r.data.pay);
  assert.equal((await api('/bookings', 'GET', null, T)).data.find((b) => b.email === 'ravi@x.in').unpaid, true);
});
