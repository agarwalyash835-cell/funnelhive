// Selling and delivering digital products end to end: products and files, delivery after a verified
// Razorpay payment (never on a demo checkout), the buyer's library and signed downloads, lead magnets,
// GST invoices and credit notes, refunds, server-side conversions and campaign attribution.
// Razorpay, Meta's Conversions API and GA4's Measurement Protocol are local fakes.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { startServer, register } from './helpers.mjs';

const KEY = 'rzp_test_AbCdEf123456', SECRET = 'test_secret_xyz', WH = 'whsec_test_123';
const refunds = [], conv = [];
let rzp, sink, srv, api, T, me, f, co, up, ebook, course, bonus;
const sign = (s, d) => crypto.createHmac('sha256', s).update(d).digest('hex');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const body = (req) => new Promise((r) => { let b = ''; req.on('data', (c) => { b += c; }); req.on('end', () => r(b)); });

before(async () => {
  rzp = http.createServer(async (req, res) => {
    const b = await body(req);
    res.setHeader('content-type', 'application/json');
    if (req.headers.authorization !== `Basic ${Buffer.from(`${KEY}:${SECRET}`).toString('base64')}`) { res.writeHead(401); return res.end('{}'); }
    if (req.method === 'GET') return res.end(JSON.stringify({ items: [] }));
    const m = /^\/payments\/([\w]+)\/refund$/.exec(req.url);
    if (m) { const r = { id: `rfnd_${crypto.randomBytes(5).toString('hex')}`, payment_id: m[1], amount: JSON.parse(b).amount }; refunds.push(r); return res.end(JSON.stringify(r)); }
    const o = JSON.parse(b);
    res.end(JSON.stringify({ id: `order_${crypto.randomBytes(6).toString('hex')}`, amount: o.amount, currency: 'INR' }));
  }).listen(0);
  sink = http.createServer(async (req, res) => { conv.push({ url: req.url, body: JSON.parse(await body(req) || '{}') }); res.setHeader('content-type', 'application/json'); res.end('{"events_received":1}'); }).listen(0);
  await wait(30);
  srv = await startServer({
    RAZORPAY_API_URL: `http://127.0.0.1:${rzp.address().port}`, META_GRAPH_URL: `http://127.0.0.1:${sink.address().port}/meta`, GA4_MP_URL: `http://127.0.0.1:${sink.address().port}/ga4`,
    APP_URL: 'https://app.example.in', PRODUCT_FILE_MAX_MB: '1',
  });
  api = srv.api;
  T = (await register(api)).token;
  me = (await api('/me', 'GET', null, T)).data;
  f = (await api('/templates/coding/use', 'POST', {}, T)).data;
  co = f.steps.find((s) => s.type === 'checkout');
  up = f.steps.find((s) => s.type === 'upsell');
});
after(async () => { await srv.stop(); rzp.close(); sink.close(); });

const upload = (pid, name, content, type = 'application/pdf') => fetch(`${srv.base}/api/products/${pid}/files`, { method: 'POST', headers: { authorization: `Bearer ${T}`, 'content-type': 'application/octet-stream', 'x-file-name': encodeURIComponent(name), 'x-file-type': type }, body: content });
const saveFunnel = async () => { f = (await api(`/funnels/${f.id}`, 'PUT', { steps: f.steps, published: true }, T)).data; co = f.steps.find((s) => s.type === 'checkout'); up = f.steps.find((s) => s.type === 'upsell'); };
const pay = (b) => api(`/public/${f.slug}/pay/start`, 'POST', b);
const verify = (start) => {
  const pid = `pay_${crypto.randomBytes(5).toString('hex')}`;
  return api(`/public/${f.slug}/pay/verify`, 'POST', { payment: start.payment, razorpay_order_id: start.order_id, razorpay_payment_id: pid, razorpay_signature: sign(SECRET, `${start.order_id}|${pid}`) }).then((r) => ({ ...r, pid }));
};
const library = (receiptUrl) => api(`/access/${receiptUrl.split('/access/')[1]}`);
const get = (url) => fetch(srv.base + url);

test('products: create, upload files (streamed), validation and storage', async () => {
  ebook = (await api('/products', 'POST', { name: 'Full-Stack Handbook (PDF)', description: 'The 240-page handbook', downloadLimit: 2, links: [{ label: 'Starter repo', url: 'https://github.com/x/y' }, { label: 'bad', url: 'javascript:alert(1)' }] }, T)).data;
  assert.equal(ebook.links.length, 1, 'only http(s) links are kept');
  assert.equal((await api('/products', 'POST', { name: '' }, T)).status, 400);
  const pdf = Buffer.concat([Buffer.from('%PDF-1.7\n'), crypto.randomBytes(5000)]);
  const r = await upload(ebook.id, 'handbook v2.pdf', pdf);
  assert.equal(r.status, 200);
  const file = (await r.json()).file;
  assert.equal(file.size, pdf.length);
  assert.equal((await upload(ebook.id, 'huge.zip', crypto.randomBytes(1.2 * 1024 * 1024), 'application/zip')).status, 413, 'over the per-file limit');
  // the seller can download their own file; nobody else can
  const own = await fetch(`${srv.base}/api/products/${ebook.id}/files/${file.id}`, { headers: { authorization: `Bearer ${T}` } });
  assert.equal(own.status, 200);
  assert.ok(Buffer.from(await own.arrayBuffer()).equals(pdf));
  assert.equal((await fetch(`${srv.base}/api/products/${ebook.id}/files/${file.id}`)).status, 401);
  const pub = await get(`/uploads/${me.id}/${file.id}`);
  assert.ok(!Buffer.from(await pub.arrayBuffer()).equals(pdf), 'product files are never on the public uploads path');
  const other = (await register(api)).token;
  assert.equal((await api(`/products/${ebook.id}`, 'GET', null, other)).status, 404);

  course = (await api('/products', 'POST', { name: 'Job-Ready Projects Course', accessDays: 365 }, T)).data;
  const vid = (await (await upload(course.id, 'lesson1.mp4', crypto.randomBytes(3000), 'video/mp4')).json()).file;
  course = (await api(`/products/${course.id}`, 'PUT', { lessons: [
    { title: 'Welcome', section: 'Week 1', videoFileId: vid.id, body: 'Start here.' },
    { title: 'Build the API', section: 'Week 1', videoUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' },
    { title: 'Deploy', section: 'Week 2', dripDays: 7 },
  ] }, T)).data;
  assert.equal(course.lessons.length, 3);
  bonus = (await api('/products', 'POST', { name: 'Interview Question Bank', links: [{ label: 'Open the bank', url: 'https://notion.so/bank' }] }, T)).data;
  const list = (await api('/products', 'GET', null, T)).data;
  assert.equal(list.products.length, 3);
  assert.ok(list.storage.used >= pdf.length + 3000);
});

test('a demo checkout never hands out a product', async () => {
  const chk = co.blocks.find((b) => b.type === 'checkout');
  chk.props.productId = ebook.id; chk.props.bumpProductId = bonus.id; chk.props.bumpEnabled = true;
  up.blocks.find((b) => b.type === 'offer').props.productId = course.id;
  await saveFunnel();
  assert.deepEqual((await api(`/products/${ebook.id}`, 'GET', null, T)).data.usage.map((u) => u.as), ['main product']);
  const r = (await api(`/public/${f.slug}/order`, 'POST', { stepId: co.id, email: 'freeloader@x.dev', name: 'Free Loader', withBump: true })).data;
  assert.ok(r.orderId && !r.access, 'no access link without a payment');
  assert.equal((await api(`/products/${ebook.id}/buyers`, 'GET', null, T)).data.length, 0);
  const o = (await api('/orders', 'GET', null, T)).data.orders.find((x) => x.id === r.orderId);
  assert.equal(o.undelivered, true);
});

test('settings: Razorpay, GST invoicing, server-side tracking — and no secrets on public pages', async () => {
  assert.equal((await api('/channels/razorpay', 'PUT', { keyId: KEY, keySecret: SECRET, webhookSecret: WH }, T)).status, 200);
  assert.equal((await api('/settings', 'PUT', { invoicing: { enabled: true, legalName: 'CodeNest Labs LLP', gstin: 'BAD' } }, T)).status, 400);
  const s = (await api('/settings', 'PUT', { businessName: 'CodeNest', invoicing: { enabled: true, legalName: 'CodeNest Labs LLP', gstin: '27ABCDE1234F1Z5', address: 'Baner, Pune', rate: 18 }, tracking: { fbPixel: '123456789012345', ga4: 'G-TEST1234' } }, T)).data;
  assert.equal(s.invoicing.state, 'Maharashtra', 'state comes from the GSTIN');
  assert.equal((await api('/channels/tracking', 'PUT', { metaToken: 'short' }, T)).status, 400);
  const t = (await api('/channels/tracking', 'PUT', { metaToken: `EAAG${'x'.repeat(60)}`, metaTestCode: 'TEST4321', ga4Secret: 'mp_secret_abc123' }, T)).data;
  assert.deepEqual([t.metaToken, t.ga4Secret, t.metaTestCode], [true, true, 'TEST4321']);
  const pub = (await api(`/public/${f.slug}`)).data;
  assert.deepEqual(pub.tracking, { fbPixel: '123456789012345', ga4: 'G-TEST1234' });
  assert.equal(pub.gstInvoices, true);
  assert.ok(!JSON.stringify(pub).includes('EAAG') && !JSON.stringify(pub).includes('mp_secret'), 'tokens never reach the browser');
});

let order, receipt, mainPid;
test('a verified payment delivers the products, issues a GST invoice and reports the sale from the server', async () => {
  conv.length = 0;
  const attr = { utm_source: 'facebook', utm_medium: 'paid', utm_campaign: 'Diwali-Launch', utm_content: 'reel-3', fbclid: 'IwAR123abc' };
  const tk = { fbp: 'fb.1.1700000000000.1234567890', fbc: 'fb.1.1700000000000.IwAR123abc', ga: '1234567890.1700000000', url: 'https://app.example.in/f/x/checkout' };
  const s = (await pay({ stepId: co.id, email: 'Asha.Rao@Example.com', name: 'Asha Rao', phone: '98765 43210', withBump: true, attr, tk, eventId: 'ic-test-123456', gst: { gstin: '29AAACB1234C1Z2', company: 'Rao Consulting' } })).data;
  assert.equal(s.provider, 'razorpay');
  const v = await verify(s);
  mainPid = v.pid;
  assert.equal(v.status, 200);
  order = v.data;
  assert.match(order.access, /^https:\/\/app\.example\.in\/access\/o\./, 'receipt link for the thank-you page');
  assert.match(order.invoice, /^https:\/\/app\.example\.in\/invoice\//);
  receipt = order.access;

  // the receipt shows exactly what this order delivered
  const lib = (await library(receipt)).data;
  assert.deepEqual(lib.products.map((p) => p.name).sort(), ['Full-Stack Handbook (PDF)', 'Interview Question Bank']);
  assert.equal(lib.seller.name, 'CodeNest');
  const book = lib.products.find((p) => p.name.startsWith('Full-Stack'));
  assert.equal(book.files.length, 1);
  assert.equal(book.links[0].url, 'https://github.com/x/y');

  // signed downloads: work, are counted, can't be forged, and respect the limit (2)
  const url = book.files[0].url;
  const d1 = await get(url);
  assert.equal(d1.status, 200);
  assert.match(d1.headers.get('content-disposition'), /attachment; filename="handbook v2.pdf"/);
  assert.equal(d1.headers.get('x-content-type-options'), 'nosniff');
  assert.equal((await get(url.replace(/s=[^&]+/, 's=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'))).status, 403, 'forged signature');
  assert.equal((await get(url.replace(/e=\d+/, `e=${Date.now() - 1000}`))).status, 403, 'expired link');
  assert.equal((await get(url)).status, 200);
  assert.equal((await get(url)).status, 403, 'third download over the limit of 2');
  assert.equal((await library(receipt)).data.products.find((p) => p.name.startsWith('Full-Stack')).files[0].left, 0);
  assert.equal((await get(`${url}&inline=1`)).status, 403, 'opening the PDF in the browser counts as a download too');

  // GST: seller in Maharashtra, buyer's business in Karnataka → IGST; one invoice per payment
  const inv = (await api(`/public/invoices/${order.invoice.split('/invoice/')[1].replace('?k=', '?k=')}`)).data;
  assert.match(inv.number, /^TEST-INV\/\d{4}-\d{2}\/0001$/, 'Razorpay test-mode sales never use the real invoice series');
  assert.equal(inv.test, true);
  assert.equal(inv.billedTo.gstin, '29AAACB1234C1Z2');
  assert.equal(inv.billedTo.state, 'Karnataka');
  assert.equal(inv.intra, false);
  const checkoutP = co.blocks.find((b) => b.type === 'checkout').props;
  assert.equal(inv.total, Number(checkoutP.price) + Number(checkoutP.bumpPrice));
  assert.equal(inv.igst + inv.taxable, inv.total);
  assert.equal(inv.cgst, 0);
  assert.equal((await api(`/public/invoices/${inv.id}?k=wrongwrongwrongwrongwrong`)).status, 404);

  // attribution stored on the order
  const o = (await api('/orders', 'GET', null, T)).data.orders.find((x) => x.id === order.orderId);
  assert.equal(o.attr.utm_campaign, 'diwali-launch');
  assert.equal(o.invoices.length, 1);

  // server-side events: InitiateCheckout + Purchase to Meta (same ids as the browser), purchase to GA4
  await wait(400);
  const meta = conv.filter((c) => c.url.startsWith('/meta/123456789012345/events'));
  const ic = meta.find((c) => c.body.data[0].event_name === 'InitiateCheckout');
  const pur = meta.find((c) => c.body.data[0].event_name === 'Purchase');
  assert.equal(ic.body.data[0].event_id, 'ic-test-123456');
  assert.equal(pur.body.data[0].event_id, order.txn, 'the browser Purchase uses this id too');
  assert.equal(pur.body.test_event_code, 'TEST4321');
  const ud = pur.body.data[0].user_data;
  assert.deepEqual(ud.em, [crypto.createHash('sha256').update('asha.rao@example.com').digest('hex')]);
  assert.deepEqual(ud.ph, [crypto.createHash('sha256').update('919876543210').digest('hex')]);
  assert.equal(ud.fbc, tk.fbc);
  assert.ok(pur.url.includes('access_token=EAAG'));
  assert.equal(pur.body.data[0].custom_data.value, order.added);
  const ga = conv.find((c) => c.url.startsWith('/ga4'));
  assert.ok(ga.url.includes('measurement_id=G-TEST1234') && ga.url.includes('api_secret=mp_secret_abc123'));
  assert.equal(ga.body.client_id, tk.ga);
  assert.equal(ga.body.events[0].params.transaction_id, order.txn);
  const log = (await api('/conversions', 'GET', null, T)).data;
  assert.ok(log.length >= 3 && log.every((d) => d.status === 'sent' && !d.body));
});

test('one-click upsell: delivered, invoiced with its own number, the library grows', async () => {
  const s = (await pay({ stepId: up.id, orderId: order.orderId })).data;
  const v = (await verify(s)).data;
  assert.equal(v.orderId, order.orderId);
  assert.match(v.invoice, /invoice\//);
  const inv = (await api(`/public/invoices/${v.invoice.split('/invoice/')[1]}`)).data;
  assert.match(inv.number, /\/0002$/);
  assert.equal(inv.billedTo.gstin, '29AAACB1234C1Z2', 'the business details carry over to upsells');
  const lib = (await library(v.access)).data;
  const c = lib.products.find((p) => p.name === 'Job-Ready Projects Course');
  assert.equal(c.kind, 'course');
  assert.ok(c.expiresAt > Date.now() + 360 * 86400000, 'course access lasts 365 days');
  assert.equal(c.lessons[0].video.includes('inline=1'), true);
  assert.equal(c.lessons[2].locked, true, 'drip: week 2 opens after 7 days');
  // progress
  assert.equal((await api(`/access/${v.access.split('/access/')[1]}/progress`, 'POST', { accessId: c.accessId, lessonId: c.lessons[0].id })).status, 200);
  assert.equal((await library(v.access)).data.products.find((p) => p.kind === 'course').lessons[0].done, true);
  // streaming a lesson video doesn't use up downloads
  const vr = await fetch(srv.base + c.lessons[0].video, { headers: { range: 'bytes=0-99' } });
  assert.equal(vr.status, 206);
  assert.match(vr.headers.get('content-disposition'), /^inline/);
});

test('the full library link: seller can copy/reset it; buyers can recover it by email', async () => {
  const buyers = (await api(`/products/${course.id}/buyers`, 'GET', null, T)).data;
  assert.equal(buyers.length, 1);
  const link = (await api(`/access-admin/${buyers[0].id}/link`, 'POST', {}, T)).data.library;
  assert.match(link, /^https:\/\/app\.example\.in\/access\/L[0-9a-f]{40}$/);
  const lib = (await library(link)).data;
  assert.equal(lib.scope, 'library');
  assert.equal(lib.products.length, 3);
  assert.equal((await api(`/access-admin/${buyers[0].id}/link`, 'POST', {}, T)).data.library, link, 'the same link every time');
  const fresh = (await api(`/access-admin/${buyers[0].id}/link`, 'POST', { reset: true }, T)).data.library;
  assert.notEqual(fresh, link);
  assert.equal((await library(link)).status, 404, 'the old link stops working after a reset');
  assert.equal((await api('/access-recover', 'POST', { seller: me.id, email: 'asha.rao@example.com' })).data.ok, true);
  assert.equal((await api('/access-recover', 'POST', { seller: me.id, email: 'nobody@example.com' })).data.ok, true, 'never reveals who bought');
  assert.equal((await api('/access/o.abcd1234.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA')).status, 404, 'forged receipt');
});

test('refunds: through Razorpay, access removed, credit note, revenue netted out; dashboard refunds sync via webhook', async () => {
  conv.length = 0;
  const before = (await api('/orders', 'GET', null, T)).data.orders.find((x) => x.id === order.orderId);
  const upIdx = before.items.findIndex((i) => i.kind === 'upsell');
  const upPrice = before.items[upIdx].price;
  const r = await api(`/orders/${order.orderId}/refund`, 'POST', { items: [upIdx], reason: 'Changed mind' }, T);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(refunds.at(-1).amount, upPrice * 100, 'Razorpay was asked to refund exactly the upsell');
  assert.equal(r.data.order.total, before.total - upPrice);
  assert.equal(r.data.order.status, 'partially_refunded');
  assert.equal((await api(`/orders/${order.orderId}/refund`, 'POST', { items: [upIdx] }, T)).status, 400, 'can’t refund twice');
  let lib = (await library(receipt)).data;
  assert.equal(lib.products.find((p) => p.name === 'Job-Ready Projects Course').status, 'refunded');
  assert.equal(lib.products.find((p) => p.name.startsWith('Full-Stack')).status, 'active', 'the rest of the order keeps working');
  const invs = (await api('/sales-invoices', 'GET', null, T)).data;
  const cn = invs.find((i) => i.type === 'credit');
  assert.match(cn.number, /^TEST-CN\/\d{4}-\d{2}\/0001$/);
  assert.equal(cn.total, upPrice);
  await wait(300);
  assert.ok(conv.some((c) => c.url.startsWith('/ga4') && c.body.events[0].name === 'refund'));

  // a refund made in the Razorpay dashboard for the checkout payment → synced by the webhook
  const raw = JSON.stringify({ event: 'refund.processed', payload: { refund: { entity: { id: 'rfnd_dash1', payment_id: mainPid, amount: Math.round((before.total - upPrice) * 100) } } } });
  const hook = await fetch(`${srv.base}/api/razorpay/webhook/${me.id}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-razorpay-signature': sign(WH, raw) }, body: raw });
  assert.equal(hook.status, 200);
  const after = (await api('/orders', 'GET', null, T)).data.orders.find((x) => x.id === order.orderId);
  assert.equal(after.status, 'refunded');
  assert.equal(after.total, 0);
  lib = (await library(receipt)).data;
  assert.ok(lib.products.every((p) => p.status === 'refunded'));
  assert.equal(lib.products[0].files, undefined, 'no files once access has ended');
  const ov = (await api('/analytics/overview?days=30', 'GET', null, T)).data;
  assert.equal(ov.refunded, 0, 'a refund of a Razorpay test-mode sale isn’t real money');
  assert.equal(ov.totals.revenue, 0);
  assert.equal(ov.byKind.upsell || 0, 0);
});

test('lead magnet: a free product on an opt-in is delivered on sign-up; applicants who aren’t a fit get nothing', async () => {
  const lm = (await api('/products', 'POST', { name: 'Free DSA Cheatsheet', links: [{ label: 'Download', url: 'https://cdn.example.in/dsa.pdf' }] }, T)).data;
  const g = (await api('/templates/webinar/use', 'POST', {}, T)).data;
  const reg = g.steps[0];
  reg.blocks.find((b) => b.type === 'optin').props.productId = lm.id;
  await api(`/funnels/${g.id}`, 'PUT', { steps: g.steps, published: true }, T);
  const r = (await api(`/public/${g.slug}/lead`, 'POST', { stepId: reg.id, email: 'kiran@example.com', name: 'Kiran', attr: { utm_source: 'instagram', utm_campaign: 'reels-oct' }, eventId: 'lead-abc-123456' })).data;
  assert.match(r.access, /\/access\/l\./);
  assert.equal(r.eventId, 'lead-abc-123456');
  assert.equal((await library(r.access)).data.products[0].links[0].url, 'https://cdn.example.in/dsa.pdf');
  // a VSL application form with a "not a fit" answer
  const v = (await api('/templates/v-founders/use', 'POST', {}, T)).data;
  const apply = v.steps[1];
  const form = apply.blocks.find((b) => b.type === 'form');
  form.props.productId = lm.id;
  await api(`/funnels/${v.id}`, 'PUT', { steps: v.steps, published: true }, T);
  const q = form.props.fields.find((x) => x.reject);
  const no = (await api(`/public/${v.slug}/lead`, 'POST', { stepId: apply.id, email: 'nofit@example.com', fields: { [q.label]: q.reject.split(', ')[0] } })).data;
  assert.equal(no.qualified, false);
  assert.equal(no.access, undefined);
  // campaigns report
  const ov = (await api('/analytics/overview?days=30', 'GET', null, T)).data;
  assert.ok(ov.campaigns.some((c) => c.campaign === 'reels-oct' && c.leads === 1));
  assert.ok(ov.campaigns.some((c) => c.campaign === 'diwali-launch' && c.orders === 0), 'paid with Razorpay test keys: not counted as a sale');
});

test('manual access, revoke and restore; deleting a product warns about its buyers', async () => {
  const g = (await api(`/products/${bonus.id}/grant`, 'POST', { email: 'offline.buyer@example.com', name: 'Offline Buyer', notify: false }, T)).data;
  assert.match(g.library, /\/access\/L/);
  assert.equal((await library(g.library)).data.products[0].status, 'active');
  await api(`/access-admin/${g.access.id}/revoke`, 'POST', {}, T);
  assert.equal((await library(g.library)).data.products[0].status, 'revoked');
  await api(`/access-admin/${g.access.id}/restore`, 'POST', {}, T);
  assert.equal((await library(g.library)).data.products[0].status, 'active');
  assert.equal((await api(`/products/${bonus.id}`, 'DELETE', null, T)).status, 409);
  assert.equal((await api(`/products/${bonus.id}?confirm=1`, 'DELETE', null, T)).status, 200);
  assert.equal((await library(g.library)).data.products.length, 0);
});

test('a partial refund from the Razorpay dashboard is matched to the item it covers (just the order bump)', async () => {
  const lm = (await api('/products', 'POST', { name: 'Bump Bonus Pack', links: [{ label: 'Open', url: 'https://example.in/bonus' }] }, T)).data;
  co.blocks.find((b) => b.type === 'checkout').props.bumpProductId = lm.id;
  await saveFunnel();
  const s = (await pay({ stepId: co.id, email: 'meera@example.com', name: 'Meera K', withBump: true })).data;
  const v = await verify(s);
  const o0 = (await api('/orders', 'GET', null, T)).data.orders.find((x) => x.id === v.data.orderId);
  const bumpIdx = o0.items.findIndex((i) => i.kind === 'bump');
  const raw = JSON.stringify({ event: 'refund.created', payload: { refund: { entity: { id: 'rfnd_bumponly', payment_id: v.pid, amount: Math.round(o0.items[bumpIdx].price * 100) } } } });
  await fetch(`${srv.base}/api/razorpay/webhook/${me.id}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-razorpay-signature': sign(WH, raw) }, body: raw });
  const o = (await api('/orders', 'GET', null, T)).data.orders.find((x) => x.id === v.data.orderId);
  assert.ok(o.items[bumpIdx].refunded, 'the bump is the refunded item');
  assert.ok(!o.items.find((i) => i.kind === 'main').refunded);
  assert.equal(o.status, 'partially_refunded');
  const lib = (await library(v.data.access)).data;
  assert.equal(lib.products.find((p) => p.name === 'Bump Bonus Pack').status, 'refunded');
  assert.equal(lib.products.find((p) => p.name.startsWith('Full-Stack')).status, 'active');
});

test('account export includes products; deleting the account removes the files', async () => {
  const ex = await fetch(`${srv.base}/api/account/export`, { headers: { authorization: `Bearer ${T}` } }).then((r) => r.json());
  assert.ok(ex.products.length >= 2 && ex.access.length >= 1 && ex.salesInvoices.length >= 3);
  assert.ok(!JSON.stringify(ex.portals).includes('tokenEnc'));
  const dir = path.join(srv.dataDir, 'products', me.id);
  assert.ok(fs.existsSync(dir));
  assert.equal((await api('/account/delete', 'POST', { password: 'secret123', confirm: 'DELETE' }, T)).status, 200);
  assert.ok(!fs.existsSync(dir));
});

test('bundles: one product unlocks several, for the bundle’s access period; only your own products; no bundle inside a bundle', async () => {
  const S = (await register(api)).token; // the account above was deleted
  const a = (await api('/products', 'POST', { name: 'Course A', links: [{ label: 'A', url: 'https://cdn.example.in/a' }] }, S)).data;
  const b = (await api('/products', 'POST', { name: 'Course B', links: [{ label: 'B', url: 'https://cdn.example.in/b' }] }, S)).data;
  const bundle = (await api('/products', 'POST', { name: 'All-access bundle' }, S)).data;
  const saved = await api(`/products/${bundle.id}`, 'PUT', { includes: [a.id, b.id, bundle.id], accessDays: 365 }, S);
  assert.equal(saved.status, 200, JSON.stringify(saved.data));
  assert.deepEqual(saved.data.includes, [a.id, b.id], 'not itself');
  // nesting is refused both ways
  const outer = (await api('/products', 'POST', { name: 'Outer' }, S)).data;
  assert.equal((await api(`/products/${outer.id}`, 'PUT', { includes: [bundle.id] }, S)).status, 400, 'no bundle inside a bundle');
  assert.equal((await api(`/products/${a.id}`, 'PUT', { includes: [b.id] }, S)).status, 400, 'a product inside a bundle can’t become one');
  const other = (await register(api)).token;
  const theirs = (await api('/products', 'POST', { name: 'Not yours' }, other)).data;
  assert.equal((await api(`/products/${bundle.id}`, 'PUT', { includes: [a.id, theirs.id] }, S)).status, 400, 'only your own products');
  // given away on an opt-in: the buyer's library has both courses (not an empty bundle card), with the bundle's access period
  const g = (await api('/templates/webinar/use', 'POST', {}, S)).data;
  g.steps[0].blocks.find((x) => x.type === 'optin').props.productId = bundle.id;
  await api(`/funnels/${g.id}`, 'PUT', { steps: g.steps, published: true }, S);
  const r = (await api(`/public/${g.slug}/lead`, 'POST', { stepId: g.steps[0].id, email: 'bundle.buyer@example.com', name: 'Bea' })).data;
  const lib = (await library(r.access)).data;
  assert.deepEqual(lib.products.map((p) => p.name).sort(), ['Course A', 'Course B']);
  assert.ok(lib.products.every((p) => p.expiresAt > Date.now() + 360 * 86400000), 'the bundle’s 1-year access');
});
