// Cash on Delivery with an advance paid online (cod.js prepaid): off by default; flat and percent advances (minimum,
// capped at the total − ₹1); the advance paid through Razorpay books a COD order with codDue; COD rules refuse before
// any charge; delivered → one invoice for the full value noting the advance; RTO → the advance refunded at the gateway
// (policy refund) or kept as a booking fee (policy keep, no refund, no invoice); skipConfirm; the store checkout; and
// Shiprocket collecting only what's due — against local fakes of Razorpay and Shiprocket.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import { startServer, register, enable2fa } from './helpers.mjs';

const KEY = 'rzp_test_Prepaid12345', SECRET = 'prepaid_secret_xyz';
const sign = (d) => crypto.createHmac('sha256', SECRET).update(d).digest('hex');
const rz = { orders: [], refunds: [] }, sr = { orders: [], token: '' };
let rzp, ship, srv, api, T, ADMIN, f, step, L;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms = 5000) { for (let t = 0; t < ms; t += 50) { const v = await fn(); if (v) return v; await wait(50); } return fn(); }
const ADDR = { line1: '12, MG Road', city: 'Bengaluru', state: 'Karnataka', pincode: '560001' };
let n = 0;
const buyer = (extra = {}) => ({ stepId: step.id, email: `p${++n}@example.in`, name: 'Ravi Kumar', phone: `98765${String(10000 + n).slice(-5)}`, address: ADDR, method: 'cod', ...extra });
const order = async (id) => (await api(`/orders?limit=1&id=${encodeURIComponent(id)}`, 'GET', null, T)).data.orders[0];
const invoices = async (id) => (await api('/sales-invoices', 'GET', null, T)).data.filter((i) => i.orderId === id);
const setCod = async (patch) => { const r = await api('/settings/cod', 'PUT', patch, T); assert.equal(r.status, 200, JSON.stringify(r.data)); return r.data; };
// the buyer pays the advance: pay/start (method cod) → Razorpay's signed result → the COD order
async function payAdvance(path, body) {
  const s = await api(`${path}/pay/start`, 'POST', body);
  assert.equal(s.status, 200, JSON.stringify(s.data));
  assert.equal(s.data.provider, 'razorpay');
  const pid = `pay_${crypto.randomBytes(5).toString('hex')}`;
  const v = await api(`${path}/pay/verify`, 'POST', { payment: s.data.payment, razorpay_order_id: s.data.order_id, razorpay_payment_id: pid, razorpay_signature: sign(`${s.data.order_id}|${pid}`) });
  assert.equal(v.status, 200, JSON.stringify(v.data));
  assert.equal(v.data.provider, 'cod');
  return { start: s.data, pid, ...v.data };
}
const fpath = () => `/public/${f.slug}`;

before(async () => {
  rzp = http.createServer((req, res) => {
    let b = '';
    req.on('data', (c) => { b += c; });
    req.on('end', () => {
      res.setHeader('content-type', 'application/json');
      if (req.headers.authorization !== `Basic ${Buffer.from(`${KEY}:${SECRET}`).toString('base64')}`) { res.writeHead(401); return res.end('{}'); }
      if (req.method === 'GET') return res.end(JSON.stringify({ items: [] }));
      const j = JSON.parse(b || '{}');
      const m = req.url.match(/^\/payments\/([^/]+)\/refund$/);
      if (m) { const r = { id: `rfnd_${crypto.randomBytes(4).toString('hex')}`, payment_id: m[1], amount: j.amount }; rz.refunds.push(r); return res.end(JSON.stringify(r)); }
      const o = { id: `order_${crypto.randomBytes(6).toString('hex')}`, amount: j.amount, currency: j.currency || 'INR' };
      rz.orders.push(o);
      res.end(JSON.stringify(o));
    });
  }).listen(0);
  ship = http.createServer(async (req, res) => {
    let body = '';
    for await (const c of req) body += c;
    const b = body ? JSON.parse(body) : {};
    const url = new URL(req.url, 'http://x');
    const send = (s, d) => { res.writeHead(s, { 'content-type': 'application/json' }); res.end(JSON.stringify(d)); };
    if (url.pathname === '/auth/login') { sr.token = `tok-${Date.now()}`; return send(200, { token: sr.token }); }
    if (req.headers.authorization !== `Bearer ${sr.token}`) return send(401, { message: 'Token has expired' });
    if (url.pathname === '/settings/company/pickup') return send(200, { data: { shipping_address: [{ id: 1, pickup_location: 'Primary', pin_code: '560034', city: 'Bengaluru', address: 'Koramangala' }] } });
    if (url.pathname === '/orders/create/adhoc') { sr.orders.push(b); return send(200, { order_id: 5000 + sr.orders.length, shipment_id: 9000 + sr.orders.length, status: 'NEW', status_code: 1 }); }
    if (url.pathname === '/courier/assign/awb') return send(200, { awb_assign_status: 1, response: { data: { awb_code: `AWB${b.shipment_id}`, courier_company_id: b.courier_id, courier_name: 'Xpressbees', shipment_id: b.shipment_id } } });
    if (url.pathname === '/courier/generate/pickup') return send(200, { pickup_status: 1, response: { pickup_scheduled_date: '2026-10-31 10:00:00' } });
    if (url.pathname === '/courier/generate/label') return send(200, { label_created: 1, label_url: 'https://labels.example/1.pdf' });
    if (url.pathname === '/manifests/generate') return send(200, { status: 1, manifest_url: 'https://manifests.example/1.pdf' });
    send(404, { message: 'not found' });
  }).listen(0);
  await wait(30);
  srv = await startServer({ RAZORPAY_API_URL: `http://127.0.0.1:${rzp.address().port}`, SHIPROCKET_BASE_URL: `http://127.0.0.1:${ship.address().port}`, SHIP_POLL_MS: '600000', APP_URL: 'https://app.example.in', ADMIN_EMAILS: 'owner@prepaid.test' });
  api = srv.api;
  ADMIN = (await register(api, 'owner@prepaid.test')).token;
  const link = srv.log().match(/To: owner@prepaid\.test[\s\S]*?\/verify\?token=([a-f0-9.]+)/);
  await api('/auth/verify', 'POST', { token: link[1] });
  ADMIN = (await enable2fa(api, ADMIN)).token;
  T = (await register(api, 'seller@prepaid.test')).token;
  assert.equal((await api('/settings', 'PUT', { invoicing: { enabled: true, legalName: 'Amma Pickles LLP', gstin: '29ABCDE1234F1Z5', address: 'Bengaluru', state: 'Karnataka', rate: 12 } }, T)).status, 200);
  f = (await api('/templates/pickle/use', 'POST', {}, T)).data;
  step = f.steps.find((s) => s.blocks.some((b) => b.type === 'checkout'));
  const steps = f.steps.map((s) => (s.id !== step.id ? s : { ...s, blocks: s.blocks.map((b) => (b.type === 'checkout' ? { ...b, props: { ...b.props, price: 499, currency: '₹', cod: true, codFee: 0, shippingFee: 0, shipping: 'address', bumpEnabled: false, planEnabled: false, billing: '' } } : b)) }));
  f = (await api(`/funnels/${f.id}`, 'PUT', { steps, published: true }, T)).data;
  step = f.steps.find((s) => s.id === step.id);
});
after(async () => { await srv?.stop(); rzp?.close(); ship?.close(); });

test('off by default: plain COD as before, nothing shown to the buyer; bad settings refused', async () => {
  const s = (await api('/settings/cod', 'GET', null, T)).data;
  assert.deepEqual([s.prepaid, s.refusal, s.skipConfirm], [{ mode: 'off', value: 0, min: 0 }, 'refund', false]);
  assert.equal((await api('/channels/razorpay', 'PUT', { keyId: KEY, keySecret: SECRET }, T)).status, 200);
  const r = await api(`${fpath()}/cod`, 'POST', buyer());
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const o = await order(r.data.orderId);
  assert.equal(o.status, 'cod');
  assert.equal(o.prepaid, undefined);
  assert.equal((await api(`/public/${f.slug}`)).data.codPrepaid, undefined);
  for (const bad of [{ prepaid: { mode: 'half' } }, { prepaid: { mode: 'percent', value: 100 } }, { prepaid: { mode: 'flat', value: 0 } }, { refusal: 'maybe' }]) assert.equal((await api('/settings/cod', 'PUT', bad, T)).status, 400, JSON.stringify(bad));
});

test('flat and percent advances: the minimum applies, never more than the total − ₹1; plain COD is refused', async () => {
  const adv = async () => { const r = await api(`${fpath()}/cod`, 'POST', buyer()); assert.equal(r.status, 400); assert.equal(r.data.code, 'prepaid'); return r.data.prepaid; };
  await setCod({ prepaid: { mode: 'flat', value: 99 } });
  assert.deepEqual(await adv(), { amount: 99, due: 400, keep: false });
  assert.deepEqual((await api(`/public/${f.slug}`)).data.codPrepaid, { mode: 'flat', value: 99, min: 0, keep: false });
  await setCod({ prepaid: { mode: 'percent', value: 10, min: 49 } });
  assert.equal((await adv()).amount, 50, '10% of ₹499, rounded up');
  await setCod({ prepaid: { mode: 'percent', value: 5, min: 49 } });
  assert.equal((await adv()).amount, 49, 'the minimum');
  await setCod({ prepaid: { mode: 'flat', value: 900 } });
  assert.deepEqual(await adv(), { amount: 498, due: 1, keep: false });
  await setCod({ prepaid: { mode: 'flat', value: 99 } });
});

let paidId;
test('the advance paid → a COD order with codDue; delivered → one invoice for the full value noting the advance', async () => {
  const r = await payAdvance(fpath(), buyer());
  assert.equal(r.start.amount, 9900, 'only the advance is charged');
  const o = await order(r.orderId);
  assert.equal(o.status, 'cod');
  assert.equal(o.paymentMethod, 'cod');
  assert.equal(o.total, 499);
  assert.equal(o.codDue, 400);
  assert.deepEqual([o.prepaid.amount, o.prepaid.paymentId, o.prepaid.provider, o.prepaid.policy], [99, r.pid, 'razorpay', 'refund']);
  assert.ok(o.prepaid.at > 0);
  assert.equal((await invoices(o.id)).length, 0, 'no invoice until it is delivered');
  // the same payment verified again (webhook + browser): one order
  const again = await api(`${fpath()}/pay/verify`, 'POST', { payment: r.start.payment, razorpay_order_id: r.start.order_id, razorpay_payment_id: r.pid, razorpay_signature: sign(`${r.start.order_id}|${r.pid}`) });
  assert.equal(again.data.orderId, o.id);
  paidId = o.id;
  const d = await api(`/orders/${o.id}/cod`, 'POST', { action: 'paid' }, T);
  assert.equal(d.status, 200, JSON.stringify(d.data));
  assert.equal(d.data.status, 'paid');
  const inv = await invoices(o.id);
  assert.equal(inv.length, 1, 'one invoice');
  assert.equal(inv[0].total, 499, 'for the full order value');
  assert.deepEqual(inv[0].paidSplit, { advance: 99, onDelivery: 400 });
  assert.match(inv[0].note, /Paid in advance ₹99 · collected on delivery ₹400/);
});

test('a refund after delivery sends the advance back through the online payment; the rest is cash the seller returns', async () => {
  const o = await order(paidId);
  const before = rz.refunds.length;
  const r = await api(`/orders/${paidId}/refund`, 'POST', { reason: 'Damaged in transit' }, T);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.deepEqual([r.data.refundedOnline, r.data.cashToReturn], [99, 400]);
  const back = rz.refunds.slice(before);
  assert.deepEqual(back.map((x) => [x.payment_id, x.amount]), [[o.prepaid.paymentId, 9900]], 'only the advance, on its own payment');
  assert.equal((await order(paidId)).prepaid.refundedOnline, 99);
  assert.equal((await api(`/orders/${paidId}/refund`, 'POST', {}, T)).status, 400, 'nothing left to refund');
  assert.equal(rz.refunds.length, before + 1, 'never twice');
});

test('COD rules refuse before anything is charged', async () => {
  await setCod({ maxCod: 300 });
  const before = rz.orders.length;
  const r = await api(`${fpath()}/pay/start`, 'POST', buyer());
  assert.equal(r.status, 400);
  assert.equal(r.data.code, 'max', 'the maximum applies to the full order value');
  await setCod({ maxCod: 0, noCod: '560001' });
  const p = await api(`${fpath()}/pay/start`, 'POST', buyer());
  assert.equal(p.data.code, 'pincode_cod');
  assert.equal(rz.orders.length, before, 'no Razorpay order opened');
  await setCod({ noCod: '' });
});

test('RTO with the refund policy: the advance is refunded at the gateway, no invoice', async () => {
  const r = await payAdvance(fpath(), buyer());
  const rto = await api(`/orders/${r.orderId}/cod`, 'POST', { action: 'rto' }, T);
  assert.equal(rto.status, 200, JSON.stringify(rto.data));
  const o = await waitFor(async () => { const x = await order(r.orderId); return x.prepaid.refund?.status === 'done' && x; });
  assert.equal(o.status, 'cancelled');
  assert.equal(o.prepaid.refund.amount, 99);
  const at = rz.refunds.find((x) => x.payment_id === r.pid);
  assert.equal(at.amount, 9900);
  assert.equal(o.prepaid.refund.id, at.id);
  assert.equal(o.prepaid.retained, undefined);
  assert.equal((await invoices(o.id)).length, 0);
});

test('keep policy: the buyer must tick; refused (RTO) → kept as a booking fee, no refund, no invoice; a seller cancel still refunds', async () => {
  await setCod({ refusal: 'keep' });
  assert.equal((await api(`/public/${f.slug}`)).data.codPrepaid.keep, true);
  const no = await api(`${fpath()}/pay/start`, 'POST', buyer());
  assert.equal(no.status, 400);
  assert.equal(no.data.code, 'prepaid_terms');
  const r = await payAdvance(fpath(), buyer({ acceptAdvance: true }));
  assert.equal((await order(r.orderId)).prepaid.policy, 'keep');
  const refunds = rz.refunds.length;
  assert.equal((await api(`/orders/${r.orderId}/cod`, 'POST', { action: 'rto' }, T)).status, 200);
  await wait(200);
  const o = await order(r.orderId);
  assert.equal(o.status, 'cancelled');
  assert.equal(o.prepaid.retained.amount, 99);
  assert.equal(o.prepaid.refund, undefined);
  assert.equal(rz.refunds.length, refunds, 'nothing refunded');
  assert.equal((await invoices(o.id)).length, 0);
  // the seller cancelling (not the buyer refusing) gives the advance back
  const c = await payAdvance(fpath(), buyer({ acceptAdvance: true }));
  assert.equal((await api(`/orders/${c.orderId}/cod`, 'POST', { action: 'cancel' }, T)).status, 200);
  const x = await waitFor(async () => { const y = await order(c.orderId); return y.prepaid.refund?.status === 'done' && y; });
  assert.equal(x.prepaid.retained, undefined);
  await setCod({ refusal: 'refund' });
});

test('skipConfirm: a COD order with its advance paid counts as confirmed', async () => {
  await setCod({ confirm: true });
  const a = await payAdvance(fpath(), buyer());
  assert.equal((await waitFor(async () => (await order(a.orderId)).codStatus)), 'pending', 'asked to confirm as usual');
  await setCod({ skipConfirm: true });
  const b = await payAdvance(fpath(), buyer());
  const o = await order(b.orderId);
  assert.equal(o.codStatus, 'confirmed');
  assert.equal(o.codConfirm.by, 'prepaid');
  await setCod({ confirm: false, skipConfirm: false });
});

test('Shiprocket collects only what is due (the order total less the advance)', async () => {
  const c = await api('/settings/shipping/shiprocket', 'PUT', { email: 'api@seller.in', password: 'good-pass', pkg: { weight: 0.5, length: 10, breadth: 10, height: 10 } }, T);
  assert.equal(c.status, 200, JSON.stringify(c.data));
  const r = await payAdvance(fpath(), buyer());
  const s = await api(`/orders/${r.orderId}/shipping/shiprocket`, 'POST', { courierId: 24 }, T);
  assert.equal(s.status, 200, JSON.stringify(s.data));
  const body = sr.orders.at(-1);
  assert.equal(body.payment_method, 'COD');
  assert.equal(body.sub_total + body.shipping_charges + body.transaction_charges - body.total_discount, 400, 'COD to collect = codDue');
});

test('store checkout: the quote shows the advance; paying it books a COD order (stock taken)', async () => {
  const id = (await api('/me', 'GET', null, T)).data.id;
  assert.equal((await api(`/admin/users/${id}/action`, 'POST', { action: 'inventory_on' }, ADMIN)).status, 200);
  const jar = (await api('/inventory/items', 'POST', { name: 'Mango Pickle 500g', unit: 'jar', hsn: '2001', gst_percent: 12, sale_rate: 300 }, T)).data;
  assert.equal((await api('/inventory/moves', 'POST', { itemId: jar.id, kind: 'OPENING', qty: 5 }, T)).status, 200);
  const st = await api('/store', 'PUT', { handle: 'amma-pickles', name: 'Amma Pickles', shipping: { fee: 0, freeAbove: 0 }, cod: { enabled: true, fee: 0 } }, T);
  assert.equal(st.status, 200, JSON.stringify(st.data));
  L = (await api('/store/listings', 'POST', { kind: 'item', refId: jar.id }, T)).data;
  assert.equal((await api('/store', 'PUT', { enabled: true }, T)).status, 200);
  const cart = { cart: [{ id: L.id, qty: 2 }] };
  const q = await api('/s/amma-pickles/quote', 'POST', { ...cart, method: 'cod' });
  assert.equal(q.status, 200, JSON.stringify(q.data));
  assert.deepEqual(q.data.prepaid, { amount: 99, due: 501, keep: false });
  assert.equal((await api('/s/amma-pickles/cod', 'POST', { ...cart, name: 'Meena', phone: '9876500001', address: ADDR })).data.code, 'prepaid');
  const r = await payAdvance('/s/amma-pickles', { ...cart, method: 'cod', name: 'Meena', phone: '9876500001', address: ADDR });
  const o = await order(r.orderId);
  assert.deepEqual([o.status, o.total, o.codDue, o.prepaid.amount], ['cod', 600, 501, 99]);
  const stock = (await api('/inventory/items', 'GET', null, T)).data.items.find((i) => i.id === jar.id).stock;
  assert.equal(stock, 3);
  // RTO puts the stock back and refunds the advance
  assert.equal((await api(`/orders/${o.id}/cod`, 'POST', { action: 'rto' }, T)).status, 200);
  await waitFor(async () => (await order(o.id)).prepaid.refund?.status === 'done');
  assert.equal((await api('/inventory/items', 'GET', null, T)).data.items.find((i) => i.id === jar.id).stock, 5);
});
