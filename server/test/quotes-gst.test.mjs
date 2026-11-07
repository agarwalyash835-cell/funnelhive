// Quotes after the audit: GST is added on top of the price (or already inside it) and the invoice shows that same
// GST; accepted quotes don't expire and can't be declined or edited; 2.5 kg stays 2.5; re-sending an expired quote
// opens it again; two tabs paying get the same Razorpay order. Payment provider is a local fake.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import { startServer, register } from './helpers.mjs';

const KEY = 'rzp_test_QuOtEsGsT1234', SECRET = 'quotes_gst_secret';
const sign = (oid, pid) => crypto.createHmac('sha256', SECRET).update(`${oid}|${pid}`).digest('hex');
const body = (req) => new Promise((r) => { let b = ''; req.on('data', (c) => { b += c; }); req.on('end', () => r(b)); });
let rzp, srv, api, T;
before(async () => {
  rzp = http.createServer(async (req, res) => { const b = JSON.parse((await body(req)) || '{}'); res.setHeader('content-type', 'application/json'); if (req.method === 'GET') return res.end('{"items":[]}'); res.end(JSON.stringify({ id: `order_${crypto.randomBytes(5).toString('hex')}`, amount: b.amount, currency: 'INR' })); }).listen(0);
  await new Promise((r) => setTimeout(r, 30));
  srv = await startServer({ RAZORPAY_API_URL: `http://127.0.0.1:${rzp.address().port}`, APP_URL: 'https://app.example.in' });
  api = srv.api;
  T = (await register(api)).token;
  assert.equal((await api('/channels/razorpay', 'PUT', { keyId: KEY, keySecret: SECRET }, T)).status, 200);
  assert.equal((await api('/settings', 'PUT', { invoicing: { enabled: true, legalName: 'Rao Consulting LLP', gstin: '29ABCDE1234F1Z5', address: 'Bengaluru', state: 'Karnataka', rate: 18 } }, T)).status, 200);
});
after(async () => { await srv.stop(); rzp.close(); });
const tok = (q) => new URL(q.link).searchParams.get('t');
const client = { name: 'Meera Rao', email: 'meera@client.in' };

test('GST at the usual rate is added on top, and the invoice carries that GST (not taken out of the price)', async () => {
  const q = (await api('/quotes', 'POST', { client, title: 'Audit', items: [{ name: 'Audit', qty: 1, price: 100000 }] }, T)).data;
  assert.deepEqual([q.gstRate, q.subtotal, q.gst, q.total], [18, 100000, 18000, 118000]);
  const v = (await api(`/q/${q.id}?t=${tok(q)}`)).data;
  assert.deepEqual([v.subtotal, v.gst, v.total, v.due], [100000, 18000, 118000, 118000]);
  const p = (await api(`/q/${q.id}/pay`, 'POST', { t: tok(q) })).data;
  assert.equal(p.amount, 11800000);
  const again = (await api(`/q/${q.id}/pay`, 'POST', { t: tok(q) })).data;
  assert.equal(again.order_id, p.order_id, 'a second tab gets the same Razorpay order, so it can’t be paid twice');
  const ok = (await api(`/q/${q.id}/verify`, 'POST', { t: tok(q), payment: p.payment, razorpay_order_id: p.order_id, razorpay_payment_id: 'pay_g1', razorpay_signature: sign(p.order_id, 'pay_g1') })).data;
  assert.equal(ok.status, 'paid');
  const inv = (await api('/sales-invoices', 'GET', null, T)).data.find((i) => i.orderId === ok.orderId);
  assert.ok(inv, 'invoice issued');
  const it = inv.items[0];
  assert.deepEqual([it.rate, it.taxable, it.cgst + it.sgst + it.igst, inv.total], [18, 100000, 18000, 118000]);
});

test('prices that already include GST: the total stays, GST is shown inside it; no GST chosen → none added', async () => {
  const incl = (await api('/quotes', 'POST', { client, title: 'Incl', items: [{ name: 'Pack', qty: 1, price: 1180 }], gstRate: 18, taxIncl: true }, T)).data;
  assert.deepEqual([incl.total, incl.gst], [1180, 180]);
  const none = (await api('/quotes', 'POST', { client, title: 'None', items: [{ name: 'Pack', qty: 1, price: 1000 }], gstRate: null }, T)).data;
  assert.deepEqual([none.gstRate, none.total, none.gst], [null, 1000, 0]);
  const five = (await api(`/quotes/${none.id}`, 'PUT', { gstRate: 5 }, T)).data;
  assert.deepEqual([five.total, five.gst], [1050, 50]);
});

test('2.5 kg stays 2.5; an accepted quote stays accepted, can’t be declined or edited', async () => {
  // a seller without online payment: the client accepts instead of paying
  const T2 = (await register(api)).token;
  const q = (await api('/quotes', 'POST', { client, title: 'Rice', items: [{ name: 'Basmati (kg)', qty: 2.5, price: 100 }], gstRate: null, validUntil: Date.now() + 2000 }, T2)).data;
  assert.deepEqual([q.items[0].qty, q.total], [2.5, 250]);
  const a = await api(`/q/${q.id}/accept`, 'POST', { t: tok(q) });
  assert.equal(a.status, 200, JSON.stringify(a.data));
  assert.equal(a.data.status, 'accepted');
  assert.equal((await api(`/q/${q.id}/decline`, 'POST', { t: tok(q), reason: 'changed mind' })).status, 400);
  assert.equal((await api(`/quotes/${q.id}`, 'PUT', { title: 'Changed' }, T2)).status, 400);
  await new Promise((r) => setTimeout(r, 2100));
  assert.equal((await api(`/quotes/${q.id}`, 'GET', null, T2)).data.status, 'accepted', 'still accepted after its date');
});

test('an accepted quote doesn’t expire; re-sending an expired one opens it again', async () => {
  const q = (await api('/quotes', 'POST', { client, title: 'Old', items: [{ name: 'Work', qty: 1, price: 500 }], gstRate: null, validUntil: Date.now() - 1000 }, T)).data;
  assert.equal(q.status, 'draft');
  await api(`/quotes/${q.id}/send`, 'POST', {}, T).catch(() => {});
  const s = (await api(`/quotes/${q.id}`, 'GET', null, T)).data;
  assert.equal(s.status, 'sent', 'sent again → valid again');
  assert.ok(s.validUntil > Date.now());
});
