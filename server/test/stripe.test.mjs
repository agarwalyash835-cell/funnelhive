// Stripe for international buyers: a USD checkout paid in the Payment Element (verified by reading the PaymentIntent
// back), a one-click upsell on the saved card, refunds through Stripe, revenue reported in rupees, export invoices,
// a monthly membership with renewals from the webhook, and the signed webhook itself. Stripe is a local fake.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import { startServer, register } from './helpers.mjs';

const SK = 'sk_test_51FakeStripeKeyAbcdef', PK = 'pk_test_51FakeStripeKeyAbcdef', WH = 'whsec_FakeStripeHook123';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 4000) => { const end = Date.now() + ms; while (Date.now() < end) { const v = await fn(); if (v) return v; await wait(50); } return fn(); };
const body = (req) => new Promise((r) => { let b = ''; req.on('data', (c) => { b += c; }); req.on('end', () => r(b)); });
const S = { pis: {}, subs: {}, invoices: {}, refunds: [], saved: false };
let st, srv, api, T, me, f, co, up;

before(async () => {
  st = http.createServer(async (req, res) => {
    const p = Object.fromEntries(new URLSearchParams(await body(req)));
    const url = new URL(req.url, 'http://x');
    res.setHeader('content-type', 'application/json');
    const send = (o) => res.end(JSON.stringify(o));
    if (req.headers.authorization !== `Bearer ${SK}`) { res.writeHead(401); return send({ error: { message: 'bad key' } }); }
    const path = url.pathname;
    if (path === '/balance') return send({ object: 'balance' });
    if (path === '/customers' && req.method === 'POST') return send({ id: 'cus_1' });
    if (path === '/products') return send({ id: 'prod_1' });
    if (/^\/customers\/\w+\/payment_methods$/.test(path)) return send({ data: S.saved ? [{ id: 'pm_card' }] : [] });
    if (path === '/payment_intents' && req.method === 'POST') {
      const id = `pi_${crypto.randomBytes(4).toString('hex')}`;
      const pi = { id, amount: Number(p.amount), amount_received: p.confirm ? Number(p.amount) : 0, currency: p.currency, client_secret: `${id}_secret`, status: p.confirm ? 'succeeded' : 'requires_payment_method', metadata: { payment: p['metadata[payment]'] }, off_session: p.off_session, setup: p.setup_future_usage };
      S.pis[id] = pi;
      return send(pi);
    }
    let m = /^\/payment_intents\/(\w+)$/.exec(path);
    if (m) return send(S.pis[m[1]]);
    if (path === '/subscriptions' && req.method === 'POST') {
      const id = `sub_${crypto.randomBytes(4).toString('hex')}`;
      const pi = { id: `pi_${crypto.randomBytes(4).toString('hex')}`, client_secret: 'x_secret', status: 'requires_payment_method', amount: Number(p['items[0][price_data][unit_amount]']) };
      S.pis[pi.id] = pi;
      S.subs[id] = { id, status: 'incomplete', metadata: { payment: p['metadata[payment]'] }, interval: p['items[0][price_data][recurring][interval]'], latest_invoice: { payment_intent: pi } };
      S.invoices[id] = [];
      return send(S.subs[id]);
    }
    m = /^\/subscriptions\/(\w+)$/.exec(path);
    if (m && req.method === 'GET') return send(S.subs[m[1]]);
    if (m && req.method === 'POST') { S.subs[m[1]].cancel_at_period_end = p.cancel_at_period_end === 'true'; return send(S.subs[m[1]]); }
    if (m && req.method === 'DELETE') { S.subs[m[1]].status = 'canceled'; return send(S.subs[m[1]]); }
    if (path === '/invoices') return send({ data: S.invoices[url.searchParams.get('subscription')] || [] });
    if (path === '/refunds') { const r = { id: `re_${S.refunds.length}`, payment_intent: p.payment_intent, amount: Number(p.amount) }; S.refunds.push(r); return send(r); }
    res.writeHead(404); send({ error: { message: `no ${path}` } });
  }).listen(0);
  await wait(30);
  srv = await startServer({ STRIPE_API_URL: `http://127.0.0.1:${st.address().port}`, APP_URL: 'https://app.example.in', FX_RATES: 'USD:80' });
  api = srv.api;
  T = (await register(api)).token;
  me = (await api('/me', 'GET', null, T)).data;
  f = (await api('/templates/coding/use', 'POST', {}, T)).data;
  for (const s of f.steps) for (const b of s.blocks) if (b.type === 'checkout') Object.assign(b.props, { currency: '$', price: 199, bumpEnabled: false });
  f = (await api(`/funnels/${f.id}`, 'PUT', { steps: f.steps, published: true }, T)).data;
  co = f.steps.find((s) => s.type === 'checkout');
  up = f.steps.find((s) => s.type === 'upsell');
});
after(async () => { await srv.stop(); st.close(); });

const order = async (id) => (await api('/orders', 'GET', null, T)).data.orders.find((o) => o.id === id);
const buyer = (email) => ({ stepId: co.id, email, name: 'Jane Doe' });

test('connecting Stripe checks the keys; a USD checkout needs Stripe', async () => {
  assert.equal((await api(`/public/${f.slug}/pay/start`, 'POST', buyer('a@x.com'))).data.provider, 'demo', 'nothing connected: demo checkout');
  assert.equal((await api('/channels/stripe', 'PUT', { publishableKey: 'pk_live_abcdefghijkl', secretKey: SK }, T)).status, 400, 'live + test mixed');
  assert.equal((await api('/channels/stripe', 'PUT', { publishableKey: PK, secretKey: 'sk_test_wrongwrongwrong' }, T)).status, 400, 'Stripe rejects the key');
  const ok = (await api('/channels/stripe', 'PUT', { publishableKey: PK, secretKey: SK, webhookSecret: WH }, T)).data;
  assert.deepEqual([ok.configured, ok.mode, ok.hasWebhookSecret], [true, 'test', true]);
  assert.ok(!JSON.stringify(ok).includes(SK));
  assert.equal((await api(`/public/${f.slug}`)).data.currency, 'USD');
});

let paid;
test('USD checkout: a PaymentIntent in cents, saved for upsells; counts only once Stripe says it succeeded', async () => {
  const r = (await api(`/public/${f.slug}/pay/start`, 'POST', buyer('jane@x.com'))).data;
  assert.equal(r.provider, 'stripe');
  assert.equal(r.publishableKey, PK);
  const pi = S.pis[r.intent];
  assert.deepEqual([pi.amount, pi.currency, pi.setup], [19900, 'usd', 'off_session']);
  assert.equal((await api(`/public/${f.slug}/pay/stripe/verify`, 'POST', { payment: r.payment })).status, 400, 'not paid yet');
  Object.assign(pi, { status: 'succeeded', amount_received: 19900 }); S.saved = true;
  paid = (await api(`/public/${f.slug}/pay/stripe/verify`, 'POST', { payment: r.payment })).data;
  assert.ok(paid.orderId);
  const o = await order(paid.orderId);
  assert.deepEqual([o.currency, o.total, o.fx, o.stripeCustomer], ['USD', 199, 80, 'cus_1']);
  const ov = (await api('/analytics/overview?days=7', 'GET', null, T)).data;
  assert.equal(ov.totals.revenue, 199 * 80, 'reported in rupees');
});

test('one-click upsell charges the saved card off-session; refunds go back through Stripe', async () => {
  const offer = up.blocks.find((b) => b.type === 'offer').props;
  const r = (await api(`/public/${f.slug}/pay/start`, 'POST', { stepId: up.id, orderId: paid.orderId })).data;
  assert.equal(r.provider, 'stripe');
  assert.ok(r.orderId, 'no form — charged straight away');
  const o = await order(paid.orderId);
  assert.equal(o.total, 199 + Number(offer.price));
  assert.equal(Object.values(S.pis).filter((p) => p.off_session).length, 1);
  const ref = (await api(`/orders/${paid.orderId}/refund`, 'POST', { items: [1], reason: 'changed mind' }, T)).data;
  assert.ok(!ref.error, JSON.stringify(ref));
  assert.equal(S.refunds.at(-1).amount, Number(offer.price) * 100);
});

test('export invoices: a foreign-currency sale is invoiced in that currency, zero-rated under a LUT', async () => {
  await api('/settings', 'PUT', { invoicing: { enabled: true, legalName: 'Code Co LLP', gstin: '27ABCDE1234F1Z5', address: 'Pune', rate: 18, lut: true } }, T);
  const r = (await api(`/public/${f.slug}/pay/start`, 'POST', buyer('exp@x.com'))).data;
  Object.assign(S.pis[r.intent], { status: 'succeeded', amount_received: 19900 });
  const ok = (await api(`/public/${f.slug}/pay/stripe/verify`, 'POST', { payment: r.payment })).data;
  const inv = (await api('/sales-invoices', 'GET', null, T)).data.find((i) => i.orderId === ok.orderId);
  assert.deepEqual([inv.currency, inv.export, inv.rate, inv.igst, inv.placeOfSupply], ['USD', true, 0, 0, 'Outside India']);
});

test('a USD membership: first invoice on the page, renewals from the signed webhook', async () => {
  for (const s of f.steps) for (const b of s.blocks) if (b.type === 'checkout') Object.assign(b.props, { billing: 'monthly', price: 29 });
  f = (await api(`/funnels/${f.id}`, 'PUT', { steps: f.steps }, T)).data;
  co = f.steps.find((s) => s.type === 'checkout');
  const r = (await api(`/public/${f.slug}/pay/start`, 'POST', buyer('member@x.com'))).data;
  assert.ok(r.subscription && r.clientSecret);
  const sub = S.subs[r.subscription];
  assert.equal(sub.interval, 'month');
  const pi = sub.latest_invoice.payment_intent;
  pi.status = 'succeeded'; sub.status = 'active';
  S.invoices[sub.id].push({ payment_intent: pi.id, amount_paid: 2900, status_transitions: { paid_at: Math.floor(Date.now() / 1000) } });
  const ok = (await api(`/public/${f.slug}/pay/stripe/verify`, 'POST', { payment: r.payment })).data;
  assert.ok(ok.orderId);
  // next month
  S.invoices[sub.id].push({ payment_intent: 'pi_renew1', amount_paid: 2900, status_transitions: { paid_at: Math.floor(Date.now() / 1000) + 10 } });
  const raw = JSON.stringify({ type: 'invoice.paid', data: { object: { subscription: sub.id } } });
  const t = Math.floor(Date.now() / 1000);
  const sig = crypto.createHmac('sha256', WH).update(`${t}.${raw}`).digest('hex');
  assert.equal((await fetch(`${srv.base}/api/stripe/webhook/${me.id}`, { method: 'POST', headers: { 'content-type': 'application/json', 'stripe-signature': `t=${t},v1=${'0'.repeat(64)}` }, body: raw })).status, 400, 'forged signature');
  assert.equal((await fetch(`${srv.base}/api/stripe/webhook/${me.id}`, { method: 'POST', headers: { 'content-type': 'application/json', 'stripe-signature': `t=${t},v1=${sig}` }, body: raw })).status, 200);
  const o = await until(async () => { const x = await order(ok.orderId); return x.items.some((i) => i.kind === 'renewal') && x; });
  assert.equal(o.total, 58);
  assert.equal(o.plan.provider, 'stripe');
  // the seller cancels: at period end
  const c = (await api(`/orders/${ok.orderId}/plan/cancel`, 'POST', {}, T)).data;
  assert.equal(c.plan.cancelAtEnd, true);
  assert.equal(sub.cancel_at_period_end, true);
});

test('with Stripe connected the free demo order is refused (no bypassing the card form)', async () => {
  const r = await api(`/public/${f.slug}/order`, 'POST', { stepId: co.id, email: 'free@x.com', name: 'Free Rider' });
  assert.equal(r.status, 409);
  assert.equal((await api(`/public/${f.slug}`)).data.testCheckout, undefined);
});
