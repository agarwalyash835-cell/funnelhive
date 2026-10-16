// GST per item and card rules for India: each product's own HSN/SAC and rate on invoice lines (CGST + SGST in the
// seller's state, IGST elsewhere) with a per-rate summary, credit notes that mirror the lines, cards saved only with
// the buyer's consent (or for a subscription), no off-session one-click charge in INR, and platform credit notes.
// Stripe and Razorpay are local fakes.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import { startServer, register } from './helpers.mjs';
import { totp } from '../security.js';

const SK = 'sk_test_51FakeStripeKeyGstCard', PK = 'pk_test_51FakeStripeKeyGstCard';
const KEY = 'rzp_test_Platform12345', SECRET = 'platform_secret', WH = 'platform_wh';
const body = (req) => new Promise((r) => { let b = ''; req.on('data', (c) => { b += c; }); req.on('end', () => r(b)); });
const sign = (s, d) => crypto.createHmac('sha256', s).update(d).digest('hex');
const S = { pis: {}, subs: {}, saved: false, refunds: [] };
const subs = {};
let st, rz, srv, api, T, f, co, up, A, B;

before(async () => {
  st = http.createServer(async (req, res) => {
    const p = Object.fromEntries(new URLSearchParams(await body(req)));
    const path = new URL(req.url, 'http://x').pathname;
    res.setHeader('content-type', 'application/json');
    const send = (o) => res.end(JSON.stringify(o));
    if (path === '/balance') return send({ object: 'balance' });
    if (path === '/customers' && req.method === 'POST') return send({ id: 'cus_1' });
    if (path === '/products') return send({ id: 'prod_1' });
    if (/^\/customers\/\w+\/payment_methods$/.test(path)) return send({ data: S.saved ? [{ id: 'pm_card', card: { country: 'IN' } }] : [] });
    if (path === '/payment_intents' && req.method === 'POST') {
      const id = `pi_${crypto.randomBytes(4).toString('hex')}`;
      S.pis[id] = { id, amount: Number(p.amount), amount_received: 0, currency: p.currency, client_secret: `${id}_secret`, status: p.confirm ? 'succeeded' : 'requires_payment_method', metadata: { payment: p['metadata[payment]'] }, off_session: p.off_session, setup: p.setup_future_usage };
      return send(S.pis[id]);
    }
    const m = /^\/payment_intents\/(\w+)$/.exec(path);
    if (m) return send(S.pis[m[1]]);
    if (path === '/subscriptions' && req.method === 'POST') {
      const id = `sub_${crypto.randomBytes(4).toString('hex')}`;
      S.subs[id] = { id, status: 'incomplete', save: p['payment_settings[save_default_payment_method]'], setup: p.setup_future_usage, latest_invoice: { payment_intent: { id: 'pi_sub', client_secret: 'x_secret' } } };
      return send(S.subs[id]);
    }
    if (path === '/refunds') { const r = { id: `re_${S.refunds.length}`, amount: Number(p.amount) }; S.refunds.push(r); return send(r); }
    res.writeHead(404); send({ error: { message: `no ${path}` } });
  }).listen(0);
  rz = http.createServer(async (req, res) => {
    const b = await body(req);
    res.setHeader('content-type', 'application/json');
    const j = b ? JSON.parse(b) : {};
    if (req.method === 'POST' && req.url === '/plans') return res.end(JSON.stringify({ id: 'plan_1', ...j }));
    if (req.method === 'POST' && req.url === '/subscriptions') { const s = { id: `sub_${crypto.randomBytes(4).toString('hex')}`, status: 'created', ...j }; subs[s.id] = s; return res.end(JSON.stringify(s)); }
    const m = req.url.match(/^\/subscriptions\/(sub_\w+)$/);
    if (m && subs[m[1]]) return res.end(JSON.stringify(subs[m[1]]));
    if (req.method === 'GET') return res.end(JSON.stringify({ items: [] })); // the key check
    res.writeHead(404); res.end('{}');
  }).listen(0);
  await new Promise((r) => setTimeout(r, 30));
  srv = await startServer({ STRIPE_API_URL: `http://127.0.0.1:${st.address().port}`, RAZORPAY_API_URL: `http://127.0.0.1:${rz.address().port}`, APP_URL: 'https://app.example.in', ADMIN_EMAILS: 'owner@gst.test' });
  api = srv.api;
  T = (await register(api)).token;
  assert.equal((await api('/channels/stripe', 'PUT', { publishableKey: PK, secretKey: SK }, T)).status, 200);
  assert.equal((await api('/settings', 'PUT', { invoicing: { enabled: true, legalName: 'Asha Learning LLP', gstin: '27ABCDE1234F1Z5', address: 'Pune', rate: 18, sac: '998431' } }, T)).status, 200);
  assert.equal((await api('/products', 'POST', { name: 'Course', hsn: '99A' }, T)).status, 400, 'HSN is digits');
  assert.equal((await api('/products', 'POST', { name: 'Course', gstRate: 7 }, T)).status, 400, 'not a GST slab');
  A = (await api('/products', 'POST', { name: 'Coaching course', hsn: '999293', gstRate: 18 }, T)).data;
  B = (await api('/products', 'POST', { name: 'Printed workbook', hsn: '49011010', gstRate: 5 }, T)).data;
  assert.deepEqual([B.hsn, B.gstRate], ['49011010', 5]);
  f = (await api('/templates/coding/use', 'POST', {}, T)).data;
  for (const s of f.steps) for (const b of s.blocks) if (b.type === 'checkout') Object.assign(b.props, { currency: '₹', price: 1180, productId: A.id, bumpEnabled: true, bumpPrice: 105, bumpProductId: B.id, billing: '', planEnabled: false, shipping: '', cod: false });
  for (const s of f.steps) for (const b of s.blocks) if (b.type === 'offer') Object.assign(b.props, { currency: '₹', price: 590, productId: '' });
  f = (await api(`/funnels/${f.id}`, 'PUT', { steps: f.steps, published: true }, T)).data;
  co = f.steps.find((s) => s.type === 'checkout');
  up = f.steps.find((s) => s.type === 'upsell');
});
after(async () => { await srv.stop(); st.close(); rz.close(); });

const checkout = async (extra) => {
  const r = (await api(`/public/${f.slug}/pay/start`, 'POST', { stepId: co.id, email: `b${Math.random()}@x.in`, name: 'Ravi', withBump: true, ...extra })).data;
  assert.equal(r.provider, 'stripe', JSON.stringify(r));
  return r;
};
const finish = async (r) => {
  Object.assign(S.pis[r.intent], { status: 'succeeded', amount_received: S.pis[r.intent].amount });
  return (await api(`/public/${f.slug}/pay/stripe/verify`, 'POST', { payment: r.payment })).data;
};
const invoicesOf = async (orderId) => (await api('/sales-invoices', 'GET', null, T)).data.filter((i) => i.orderId === orderId);

let intraOrder;
test('two products at different HSN / rates: per-line codes, CGST + SGST in the seller’s state, a per-rate summary', async () => {
  const r = await checkout({ gst: { state: 'Maharashtra' } });
  intraOrder = await finish(r);
  const [inv] = await invoicesOf(intraOrder.orderId);
  assert.deepEqual(inv.items.map((l) => [l.sac, l.rate, l.taxable, l.cgst, l.sgst, l.igst]), [['999293', 18, 1000, 90, 90, 0], ['49011010', 5, 100, 2.5, 2.5, 0]]);
  assert.deepEqual(inv.rates.map((x) => [x.rate, x.taxable, x.cgst + x.sgst]), [[5, 100, 5], [18, 1000, 180]]);
  assert.deepEqual([inv.rate, inv.taxable, inv.cgst, inv.sgst, inv.total, inv.intra], [null, 1100, 92.5, 92.5, 1285, true]);
});

test('another state: IGST per line at each line’s own rate', async () => {
  const ok = await finish(await checkout({ gst: { state: 'Karnataka' } }));
  const [inv] = await invoicesOf(ok.orderId);
  assert.deepEqual(inv.items.map((l) => [l.rate, l.igst, l.cgst]), [[18, 180, 0], [5, 5, 0]]);
  assert.deepEqual(inv.rates.map((x) => x.igst), [5, 180]);
});

test('a refund’s credit note mirrors the original lines’ codes and rates', async () => {
  const ref = (await api(`/orders/${intraOrder.orderId}/refund`, 'POST', { items: [1], reason: 'damaged' }, T)).data;
  assert.ok(!ref.error, JSON.stringify(ref));
  const cn = (await invoicesOf(intraOrder.orderId)).find((i) => i.type === 'credit');
  assert.deepEqual(cn.items.map((l) => [l.sac, l.rate, l.taxable, l.cgst, l.sgst]), [['49011010', 5, 100, 2.5, 2.5]]);
  assert.deepEqual([cn.rate, cn.total], [5, 105]);
});

test('lines without a product use the seller’s default SAC and rate', async () => {
  for (const s of f.steps) for (const b of s.blocks) if (b.type === 'checkout') Object.assign(b.props, { productId: '', bumpProductId: '' });
  f = (await api(`/funnels/${f.id}`, 'PUT', { steps: f.steps }, T)).data;
  const ok = await finish(await checkout({}));
  const [inv] = await invoicesOf(ok.orderId);
  assert.deepEqual(inv.items.map((l) => [l.sac, l.rate]), [['998431', 18], ['998431', 18]]);
  assert.equal(inv.rate, 18);
});

test('cards: saved only when the buyer ticks “save my card”; one-click upsells in INR are never charged off-session', async () => {
  const plain = await checkout({});
  assert.equal(S.pis[plain.intent].setup, undefined, 'no consent: nothing saved');
  const consent = await checkout({ saveCard: true });
  assert.equal(S.pis[consent.intent].setup, 'off_session');
  const paid = await finish(consent);
  S.saved = true;
  const r = (await api(`/public/${f.slug}/pay/start`, 'POST', { stepId: up.id, orderId: paid.orderId })).data;
  assert.ok(!r.orderId && r.clientSecret, 'the buyer confirms in the card form');
  assert.equal(Object.values(S.pis).filter((p) => p.off_session).length, 0, 'no off-session charge');
});

test('a membership saves the card for the renewals, and says so', async () => {
  for (const s of f.steps) for (const b of s.blocks) if (b.type === 'checkout') Object.assign(b.props, { billing: 'monthly', price: 999, bumpEnabled: false });
  f = (await api(`/funnels/${f.id}`, 'PUT', { steps: f.steps }, T)).data;
  const r = (await api(`/public/${f.slug}/pay/start`, 'POST', { stepId: co.id, email: 'm@x.in', name: 'Mira' })).data;
  assert.ok(r.subscription);
  assert.equal(S.subs[r.subscription].save, 'on_subscription');
  assert.match(r.description, /card will be saved for the renewals/);
});

test('platform invoices: the state is asked for first, SAC on the invoice, a credit note for a refund', async () => {
  const ADMIN = (await register(api, 'owner@gst.test')).token;
  await new Promise((r) => setTimeout(r, 150));
  const link = srv.log().match(/To: owner@gst\.test[\s\S]*?\/verify\?token=([a-f0-9.]+)/);
  await api('/auth/verify', 'POST', { token: link[1] });
  // the admin panel needs 2-step login (when it's required)
  const { secret } = (await api('/auth/2fa/setup', 'POST', {}, ADMIN)).data || {};
  if (secret) await api('/auth/2fa/enable', 'POST', { code: totp(secret) }, ADMIN);
  const as =await api('/admin/settings', 'PUT', { company: { name: 'Hive Labs Pvt Ltd', gstin: '27ABCDE1234F1Z5', state: 'Maharashtra', address: 'Pune', invoicePrefix: 'FH' }, razorpay: { keyId: KEY, keySecret: SECRET, webhookSecret: WH } }, ADMIN);
  assert.equal(as.status, 200, JSON.stringify(as.data));
  const S1 = (await register(api)).token;
  assert.equal((await api('/billing/subscribe', 'POST', { interval: 'monthly' }, S1)).data.needDetails, true, 'asks for the state first');
  await api('/billing/details', 'PUT', { name: 'Seller', state: 'Maharashtra' }, S1);
  const yearly = (await api('/billing', 'GET', null, S1)).data.prices.agency_yearly;
  if (yearly.amount > 15000) assert.equal(yearly.afa, true, 'renewals above ₹15,000 need approval');
  const coRes = (await api('/billing/subscribe', 'POST', { interval: 'monthly' }, S1)).data;
  const sub = subs[coRes.subscription_id];
  assert.equal(sub.customer_notify, 1);
  const start = Math.floor(Date.now() / 1000);
  Object.assign(sub, { status: 'active', current_start: start, current_end: start + 30 * 86400 });
  const hook = (ev) => { const raw = JSON.stringify(ev); return fetch(`${srv.base}/api/billing/webhook`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-razorpay-signature': sign(WH, raw) }, body: raw }); };
  await hook({ event: 'subscription.charged', payload: { subscription: { entity: sub }, payment: { entity: { id: 'pay_p1' } } } });
  const list = (await api('/billing', 'GET', null, S1)).data.invoices;
  const inv = (await api(`/billing/invoices/${list[0].id}`, 'GET', null, S1)).data;
  assert.equal(inv.sac, '998314');
  assert.ok(inv.cgst > 0 && inv.igst === 0, 'same state: CGST + SGST');
  const refund = { event: 'refund.processed', payload: { refund: { entity: { id: 'rfnd_1', payment_id: 'pay_p1', amount: inv.total * 100 } } } };
  assert.equal((await hook(refund)).status, 200);
  await hook(refund); // retries are harmless
  const all = (await api('/billing', 'GET', null, S1)).data.invoices;
  assert.equal(all.length, 2);
  const cn = (await api(`/billing/invoices/${all.find((i) => i.total < 0).id}`, 'GET', null, S1)).data;
  assert.deepEqual([cn.type, cn.against, cn.total, cn.sac], ['credit', inv.number, -inv.total, '998314']);
  assert.match(cn.number, /^FH-CN\/20\d\d-\d\d\/0001$/);
  assert.equal(inv.number.endsWith('/0001'), true, 'invoice numbering untouched');
});
