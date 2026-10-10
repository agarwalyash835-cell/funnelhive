// Quotes with a pay link: a consultant writes a ₹ proposal with a 50% deposit, the client opens the private link,
// pays the deposit (Razorpay), then the balance — one order, two invoices; a USD proposal is paid by card (Stripe).
// Wrong tokens, forged signatures, editing a paid quote and paying an expired one are refused. Payment providers are local fakes.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import { startServer, register } from './helpers.mjs';

const KEY = 'rzp_test_QuOtEs1234567', SECRET = 'quotes_secret', SK = 'sk_test_51QuotesStripeKey', PK = 'pk_test_51QuotesStripeKey';
const sign = (oid, pid) => crypto.createHmac('sha256', SECRET).update(`${oid}|${pid}`).digest('hex');
const body = (req) => new Promise((r) => { let b = ''; req.on('data', (c) => { b += c; }); req.on('end', () => r(b)); });
const pis = {};
let rzp, st, srv, api, T;
before(async () => {
  rzp = http.createServer(async (req, res) => { const b = JSON.parse((await body(req)) || '{}'); res.setHeader('content-type', 'application/json'); if (req.method === 'GET') return res.end('{"items":[]}'); res.end(JSON.stringify({ id: `order_${crypto.randomBytes(5).toString('hex')}`, amount: b.amount, currency: 'INR' })); }).listen(0);
  st = http.createServer(async (req, res) => {
    const p = Object.fromEntries(new URLSearchParams(await body(req)));
    const path = new URL(req.url, 'http://x').pathname;
    res.setHeader('content-type', 'application/json');
    const send = (o) => res.end(JSON.stringify(o));
    if (path === '/balance') return send({});
    if (path === '/customers') return send({ id: 'cus_q' });
    if (path === '/payment_intents' && req.method === 'POST') { const id = `pi_${crypto.randomBytes(4).toString('hex')}`; pis[id] = { id, amount: Number(p.amount), currency: p.currency, client_secret: `${id}_s`, status: 'requires_payment_method', amount_received: 0, metadata: { payment: p['metadata[payment]'] } }; return send(pis[id]); }
    const m = /^\/payment_intents\/(\w+)$/.exec(path);
    if (m) return send(pis[m[1]]);
    res.writeHead(404); send({});
  }).listen(0);
  await new Promise((r) => setTimeout(r, 30));
  srv = await startServer({ RAZORPAY_API_URL: `http://127.0.0.1:${rzp.address().port}`, STRIPE_API_URL: `http://127.0.0.1:${st.address().port}`, APP_URL: 'https://app.example.in', FX_RATES: 'USD:80' });
  api = srv.api;
  T = (await register(api)).token;
  assert.equal((await api('/channels/razorpay', 'PUT', { keyId: KEY, keySecret: SECRET }, T)).status, 200);
  assert.equal((await api('/channels/stripe', 'PUT', { publishableKey: PK, secretKey: SK }, T)).status, 200);
});
after(async () => { await srv.stop(); rzp.close(); st.close(); });

const tok = (q) => new URL(q.link).searchParams.get('t');
let q;
test('a ₹ proposal with a 50% deposit: deposit then balance, one order, two invoices', async () => {
  q = (await api('/quotes', 'POST', { client: { name: 'Meera Rao', email: 'meera@client.in', phone: '9876500000' }, title: 'Brand strategy sprint', intro: 'Four weeks.', items: [{ name: 'Strategy workshop', qty: 2, price: 25000 }, { name: 'Messaging guide', qty: 1, price: 10000 }], currency: 'INR', deposit: 50, validDays: 14 }, T)).data;
  assert.deepEqual([q.number, q.total, q.due, q.status], ['Q-0001', 60000, 30000, 'draft']);
  assert.match(q.link, /^https:\/\/app\.example\.in\/q\/\w+\?t=[0-9a-f]{24}$/);
  assert.equal((await api(`/q/${q.id}?t=wrongtoken`)).status, 404);
  const v = (await api(`/q/${q.id}?t=${tok(q)}`)).data;
  assert.deepEqual([v.status, v.due, v.provider, v.canPay, v.seller.name !== undefined], ['viewed', 30000, 'razorpay', true, true]);
  assert.equal(v.token, undefined, 'the link token is not echoed');
  const p1 = (await api(`/q/${q.id}/pay`, 'POST', { t: tok(q), amount: 1 })).data;
  assert.deepEqual([p1.provider, p1.amount], ['razorpay', 3000000], 'the browser can’t pick the amount');
  assert.equal((await api(`/q/${q.id}/verify`, 'POST', { t: tok(q), payment: p1.payment, razorpay_order_id: p1.order_id, razorpay_payment_id: 'pay_1', razorpay_signature: 'forged' })).status, 400);
  const ok1 = (await api(`/q/${q.id}/verify`, 'POST', { t: tok(q), payment: p1.payment, razorpay_order_id: p1.order_id, razorpay_payment_id: 'pay_1', razorpay_signature: sign(p1.order_id, 'pay_1') })).data;
  assert.deepEqual([ok1.status, ok1.paid, ok1.due], ['deposit_paid', 30000, 30000]);
  assert.equal((await api(`/quotes/${q.id}`, 'PUT', { title: 'Changed' }, T)).status, 400, 'a paid quote is locked');
  assert.equal((await api(`/quotes/${q.id}`, 'DELETE', null, T)).status, 400);
  const p2 = (await api(`/q/${q.id}/pay`, 'POST', { t: tok(q) })).data;
  assert.equal(p2.amount, 3000000);
  const ok2 = (await api(`/q/${q.id}/verify`, 'POST', { t: tok(q), payment: p2.payment, razorpay_order_id: p2.order_id, razorpay_payment_id: 'pay_2', razorpay_signature: sign(p2.order_id, 'pay_2') })).data;
  assert.deepEqual([ok2.status, ok2.due], ['paid', 0]);
  // verifying the same payment again changes nothing
  await api(`/q/${q.id}/verify`, 'POST', { t: tok(q), payment: p2.payment, razorpay_order_id: p2.order_id, razorpay_payment_id: 'pay_2', razorpay_signature: sign(p2.order_id, 'pay_2') });
  const orders = (await api('/orders', 'GET', null, T)).data.orders.filter((o) => o.quoteId === q.id);
  assert.equal(orders.length, 1);
  assert.deepEqual([orders[0].total, orders[0].items.length, orders[0].funnel, orders[0].email], [60000, 2, 'Quote Q-0001', 'meera@client.in']);
  assert.equal((await api(`/q/${q.id}/pay`, 'POST', { t: tok(q) })).status, 400, 'nothing left to pay');
  const s = (await api(`/quotes/${q.id}`, 'GET', null, T)).data;
  assert.deepEqual([s.status, s.paid, s.payments.length], ['paid', 60000, 2]);
});

test('a USD proposal is paid by card through Stripe; an expired or declined one can’t be paid', async () => {
  const u = (await api('/quotes', 'POST', { client: { name: 'Sam Lee', email: 'sam@acme.com' }, title: 'Advisory retainer', items: [{ name: 'Monthly advisory', qty: 1, price: 1500 }], currency: 'USD' }, T)).data;
  const p = (await api(`/q/${u.id}/pay`, 'POST', { t: tok(u) })).data;
  assert.deepEqual([p.provider, p.currency, p.amount, pis[p.intent].amount, pis[p.intent].currency], ['stripe', 'USD', 1500, 150000, 'usd']);
  assert.equal((await api(`/q/${u.id}/stripe/verify`, 'POST', { t: tok(u), payment: p.payment })).status, 400, 'not paid yet');
  Object.assign(pis[p.intent], { status: 'succeeded', amount_received: 150000 });
  const ok = (await api(`/q/${u.id}/stripe/verify`, 'POST', { t: tok(u), payment: p.payment })).data;
  assert.equal(ok.status, 'paid');
  const o = (await api('/orders', 'GET', null, T)).data.orders.find((x) => x.quoteId === u.id);
  assert.deepEqual([o.currency, o.total, o.provider], ['USD', 1500, 'stripe']);

  const old = (await api('/quotes', 'POST', { client: { name: 'X', email: 'x@y.in' }, title: 'Old', items: [{ name: 'A', price: 100 }], validUntil: Date.now() - 1000 }, T)).data;
  await api(`/quotes/${old.id}/send`, 'POST', {}, T);
  assert.equal((await api(`/q/${old.id}?t=${tok(old)}`)).data.status, 'expired');
  assert.equal((await api(`/q/${old.id}/pay`, 'POST', { t: tok(old) })).status, 400);
  const d = (await api('/quotes', 'POST', { client: { name: 'Z', email: 'z@y.in' }, title: 'Nope', items: [{ name: 'A', price: 100 }] }, T)).data;
  assert.equal((await api(`/q/${d.id}/decline`, 'POST', { t: tok(d), reason: 'Budget' })).data.status, 'declined');
  assert.equal((await api(`/q/${d.id}/pay`, 'POST', { t: tok(d) })).status, 400);
  const list = (await api('/quotes', 'GET', null, T)).data;
  assert.equal(list.length, 4);
  assert.ok((await api(`/quotes/${d.id}/duplicate`, 'POST', {}, T)).data.number.startsWith('Q-0005'));
});

test('the client’s GST details are checked like a checkout’s: a bad GSTIN is refused, its state wins over a typed one', async () => {
  const items = [{ name: 'Audit', qty: 1, price: 5000 }];
  assert.equal((await api('/quotes', 'POST', { title: 'GST', items, client: { name: 'Ravi', email: 'r@x.in', gstin: 'NOTAGSTIN' } }, T)).status, 400);
  const g = (await api('/quotes', 'POST', { title: 'GST', items, client: { name: 'Ravi', email: 'r@x.in', gstin: '29abcde1234f1z5', state: 'Maharashtra' } }, T)).data;
  assert.deepEqual([g.client.gstin, g.client.state], ['29ABCDE1234F1Z5', 'Karnataka']);
  assert.equal((await api(`/quotes/${g.id}`, 'PUT', { client: { name: 'Ravi', gstin: '27ABCDE' } }, T)).status, 400);
});
