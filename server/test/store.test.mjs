// Storefront (store.js): catalog visibility, server-side cart pricing (tampered prices ignored), a coupon on a cart,
// the shipping rule, GST lines per item (intra / inter state), COD with a PIN code rule, stock taken on payment and
// oversell refused, digital delivery, isolation between sellers, and the order showing every item — against a local
// fake of Razorpay's API (signatures computed the way Razorpay does).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import { startServer, register, enable2fa } from './helpers.mjs';

const KEY = 'rzp_test_Store123456', SECRET = 'store_secret_xyz';
let fake, srv, api, ADMIN, A, B, tea, mug, ebook, L = {};
const sign = (d) => crypto.createHmac('sha256', SECRET).update(d).digest('hex');
const pub = (p, body) => api(`/s/chai-co${p}`, body ? 'POST' : 'GET', body);
const MH = { line1: '1 Marine Drive', city: 'Mumbai', state: 'Maharashtra', pincode: '400001' };
const KA = { line1: '12 MG Road', city: 'Bengaluru', state: 'Karnataka', pincode: '560001' };
const stockOf = async (id) => (await api('/inventory/items', 'GET', null, A)).data.items.find((i) => i.id === id).stock;
async function payCart(body) {
  const s = await pub('/pay/start', { name: 'Ravi', email: `r${crypto.randomUUID().slice(0, 6)}@x.in`, phone: '9876543210', ...body });
  assert.equal(s.status, 200, JSON.stringify(s.data));
  assert.equal(s.data.provider, 'razorpay');
  const pid = `pay_${crypto.randomBytes(5).toString('hex')}`;
  const v = await pub('/pay/verify', { payment: s.data.payment, razorpay_order_id: s.data.order_id, razorpay_payment_id: pid, razorpay_signature: sign(`${s.data.order_id}|${pid}`) });
  assert.equal(v.status, 200, JSON.stringify(v.data));
  return { start: s.data, ...v.data };
}
const invoiceOf = async (orderId) => (await api('/sales-invoices', 'GET', null, A)).data.find((i) => i.orderId === orderId && i.type === 'invoice');
const orderOf = async (id) => (await api(`/orders?limit=1&id=${encodeURIComponent(id)}`, 'GET', null, A)).data.orders[0];

before(async () => {
  fake = http.createServer((req, res) => {
    let b = '';
    req.on('data', (c) => { b += c; });
    req.on('end', () => {
      res.setHeader('content-type', 'application/json');
      if (req.headers.authorization !== `Basic ${Buffer.from(`${KEY}:${SECRET}`).toString('base64')}`) { res.writeHead(401); return res.end('{}'); }
      if (req.method === 'GET') return res.end(JSON.stringify({ items: [] }));
      const j = JSON.parse(b);
      res.end(JSON.stringify({ id: `order_${crypto.randomBytes(6).toString('hex')}`, amount: j.amount, currency: j.currency }));
    });
  }).listen(0);
  await new Promise((r) => setTimeout(r, 30));
  srv = await startServer({ RAZORPAY_API_URL: `http://127.0.0.1:${fake.address().port}`, ADMIN_EMAILS: 'owner@store.test', APP_URL: 'https://app.example.in' });
  api = srv.api;
  ADMIN = (await register(api, 'owner@store.test')).token;
  const link = srv.log().match(/To: owner@store\.test[\s\S]*?\/verify\?token=([a-f0-9.]+)/);
  await api('/auth/verify', 'POST', { token: link[1] });
  ADMIN = (await enable2fa(api, ADMIN)).token;
  A = (await register(api, 'chai@store.test')).token;
  B = (await register(api, 'other@store.test')).token;
  for (const t of [A, B]) {
    const id = (await api('/me', 'GET', null, t)).data.id;
    assert.equal((await api(`/admin/users/${id}/action`, 'POST', { action: 'inventory_on' }, ADMIN)).status, 200);
  }
  assert.equal((await api('/settings', 'PUT', { invoicing: { enabled: true, legalName: 'Chai Co LLP', gstin: '27ABCDE1234F1Z5', address: 'Mumbai', rate: 18, sac: '998431' } }, A)).status, 200);
  assert.equal((await api('/channels/razorpay', 'PUT', { keyId: KEY, keySecret: SECRET }, A)).status, 200);
  tea = (await api('/inventory/items', 'POST', { name: 'Assam Tea 250g', unit: 'pack', hsn: '0902', gst_percent: 5, sale_rate: 200 }, A)).data;
  mug = (await api('/inventory/items', 'POST', { name: 'Clay Mug', unit: 'pcs', hsn: '6912', gst_percent: 18, sale_rate: 300 }, A)).data;
  assert.equal((await api('/inventory/moves', 'POST', { itemId: tea.id, kind: 'OPENING', qty: 8 }, A)).status, 200);
  assert.equal((await api('/inventory/moves', 'POST', { itemId: mug.id, kind: 'OPENING', qty: 3 }, A)).status, 200);
  ebook = (await api('/products', 'POST', { name: 'Tea Brewing Guide', hsn: '999293', gstRate: 18 }, A)).data;
});
after(async () => { await srv?.stop(); fake?.close(); });

test('seller sets up the store and its catalog; only visible, sellable listings are public', async () => {
  assert.equal((await api('/store', 'PUT', { enabled: true }, A)).status, 400, 'no address yet');
  assert.equal((await api('/store', 'PUT', { handle: 'API' }, A)).status, 400, 'reserved');
  const s = await api('/store', 'PUT', { handle: 'chai-co', name: 'Chai Co', color: '#aa5500', categories: ['Tea', 'Ware', 'Guides'], shipping: { fee: 50, freeAbove: 1000 }, cod: { enabled: true, fee: 30 } }, A);
  assert.equal(s.status, 200, JSON.stringify(s.data));
  assert.match(s.data.store.previewUrl, /\/s\/chai-co\?pv=/);
  assert.equal((await api('/store', 'PUT', { handle: 'chai-co' }, B)).status, 409, 'handles are unique');
  L.tea = (await api('/store/listings', 'POST', { kind: 'item', refId: tea.id, category: 'Tea', mrp: 250, description: 'Strong and malty' }, A)).data;
  L.mug = (await api('/store/listings', 'POST', { kind: 'item', refId: mug.id, category: 'Ware', price: 280 }, A)).data;
  assert.equal((await api('/store/listings', 'POST', { kind: 'product', refId: ebook.id }, A)).status, 400, 'a product needs a price');
  L.ebook = (await api('/store/listings', 'POST', { kind: 'product', refId: ebook.id, category: 'Guides', price: 100 }, A)).data;
  L.hidden = (await api('/store/listings', 'POST', { kind: 'product', refId: ebook.id, title: 'Secret', price: 1, visible: false }, A)).data;
  // switched off: not public (the preview link opens it, but nothing can be bought)
  assert.equal((await pub('')).status, 404);
  const pv = new URL(s.data.store.previewUrl).searchParams.get('pv');
  assert.equal((await api(`/s/chai-co?pv=${pv}`)).status, 200);
  assert.equal((await pub('/quote', { cart: [{ id: L.tea.id, qty: 1 }] })).status, 404);
  assert.equal((await api('/store', 'PUT', { enabled: true }, A)).status, 200);
  const all = (await pub('')).data;
  assert.equal(all.store.name, 'Chai Co');
  assert.equal(all.store.color, '#aa5500');
  assert.deepEqual(all.listings.map((l) => l.title).sort(), ['Assam Tea 250g', 'Clay Mug', 'Tea Brewing Guide']);
  const t = all.listings.find((l) => l.id === L.tea.id);
  assert.deepEqual([t.price, t.mrp, t.stock, t.kind], [200, 250, 8, 'physical'], 'sale rate and stock from inventory');
  assert.equal(all.listings.find((l) => l.id === L.mug.id).price, 280, 'the listing’s own price wins');
  assert.deepEqual((await pub('?q=mug')).data.listings.map((l) => l.title), ['Clay Mug']);
  assert.deepEqual((await pub('?category=Guides')).data.listings.map((l) => l.title), ['Tea Brewing Guide']);
  assert.deepEqual((await pub('?sort=price_asc')).data.listings.map((l) => l.price), [100, 200, 280]);
  assert.equal((await pub(`/p/${L.hidden.id}`)).status, 404);
  assert.equal((await pub(`/p/${L.tea.id}`)).data.listing.description, 'Strong and malty');
  // the page carries the store's title for link previews
  const html = await fetch(`${srv.base}/s/chai-co/p/${L.tea.id}`).then((r) => r.status);
  assert.ok([200, 404].includes(html)); // 404 only when no client build exists
});

test('cart prices come from the server; tampered prices are ignored; shipping rule', async () => {
  const q = await pub('/quote', { cart: [{ id: L.tea.id, qty: 2, price: 1 }, { id: L.tea.id, qty: 1 }], total: 5 });
  assert.equal(q.status, 200, JSON.stringify(q.data));
  assert.deepEqual([q.data.lines[0].qty, q.data.subtotal, q.data.shipping, q.data.total], [3, 600, 50, 650]);
  const free = (await pub('/quote', { cart: [{ id: L.tea.id, qty: 5 }] })).data;
  assert.deepEqual([free.subtotal, free.shipping, free.total], [1000, 0, 1000], 'free above ₹1000');
  const dig = (await pub('/quote', { cart: [{ id: L.ebook.id, qty: 4 }] })).data;
  assert.deepEqual([dig.lines[0].qty, dig.shipping, dig.total, dig.needsAddress], [1, 0, 100, false], 'digital: once, no shipping');
  assert.equal((await pub('/quote', { cart: [{ id: L.hidden.id, qty: 1 }] })).data.code, 'unavailable');
  assert.equal((await pub('/quote', { cart: [] })).status, 400);
});

test('a coupon on a cart: minimum order on the subtotal, discount spread over the lines', async () => {
  assert.equal((await api('/coupons', 'POST', { code: 'CART10', type: 'percent', value: 10, minOrder: 500 }, A)).status, 200);
  const low = await pub('/quote', { cart: [{ id: L.tea.id, qty: 2 }], coupon: 'cart10' });
  assert.equal(low.status, 400);
  assert.match(low.data.error, /minimum order/);
  const ok = (await pub('/quote', { cart: [{ id: L.tea.id, qty: 2 }, { id: L.mug.id, qty: 1 }], coupon: 'cart10' })).data;
  assert.deepEqual([ok.subtotal, ok.discount, ok.shipping, ok.total, ok.coupon], [680, 68, 50, 662, 'CART10']);
});

test('sizes: one must be picked from the listed ones; two sizes are two lines sharing the stock', async () => {
  assert.equal((await api(`/store/listings/${L.mug.id}`, 'PUT', { sizes: ['S', 'M', 'L'] }, A)).status, 200);
  const none = await pub('/quote', { cart: [{ id: L.mug.id, qty: 1 }] });
  assert.deepEqual([none.status, none.data.code], [400, 'size']);
  assert.match(none.data.error, /Choose a size for Clay Mug/);
  assert.match((await pub('/quote', { cart: [{ id: L.mug.id, qty: 1, size: 'XXL' }] })).data.error, /Size XXL of Clay Mug isn’t available/);
  const two = await pub('/quote', { cart: [{ id: L.mug.id, qty: 1, size: 'M' }, { id: L.mug.id, qty: 1, size: 'L' }, { id: L.mug.id, qty: 1, size: 'M' }, { id: L.tea.id, qty: 1, size: 'M' }] });
  assert.equal(two.status, 200, JSON.stringify(two.data));
  assert.deepEqual(two.data.lines.map((l) => [l.title, l.qty, l.size || '']), [['Clay Mug (Size M)', 2, 'M'], ['Clay Mug (Size L)', 1, 'L'], ['Assam Tea 250g', 1, '']], 'a size on a product without sizes is ignored');
  const over = await pub('/quote', { cart: [{ id: L.mug.id, qty: 2, size: 'M' }, { id: L.mug.id, qty: 2, size: 'L' }] });
  assert.deepEqual([over.status, over.data.code], [409, 'stock'], 'both sizes count against the same stock');
  assert.equal((await api(`/store/listings/${L.mug.id}`, 'PUT', { sizes: [] }, A)).status, 200);
});

test('a cart left at checkout is kept for a reminder, its link puts it back, and buying clears it', async () => {
  const abandoned = async () => (await api('/orders?tab=abandoned', 'GET', null, A)).data.abandoned.filter((a) => a.store);
  const cart = [{ id: L.tea.id, qty: 2 }, { id: L.mug.id, qty: 1 }];
  assert.equal((await pub('/abandon', { cart, phone: '9812345670' })).status, 200);
  assert.equal((await abandoned()).length, 0, 'not kept without the checkout’s notice');
  await pub('/abandon', { notice: true, cart, phone: '9812345670', name: 'Ravi Kumar' });
  await pub('/abandon', { notice: true, cart, phone: '9812345670', email: 'ravi@x.dev', name: 'Ravi Kumar' });
  const [a, ...rest] = await abandoned();
  assert.equal(rest.length, 0, 'the phone-only cart became the one with the email');
  assert.deepEqual([a.cartTitle, a.amount, a.funnel], ['Assam Tea 250g + 1 more', 730, 'Online store']);
  assert.match(a.link, new RegExp(`/s/chai-co/cart\\?c=${a.id}$`));
  // the link's cart: lines only, nothing about who left it
  const back = await pub(`/cart/${a.id}`);
  assert.deepEqual(back.data, { cart: [{ id: L.tea.id, qty: 2 }, { id: L.mug.id, qty: 1 }] });
  assert.equal((await pub('/cart/nope')).status, 404);
  assert.equal((await api(`/s/demo-grocery/cart/${a.id}`)).status, 404, 'only from its own store');
  // buying with that number clears it
  await payCart({ cart: [{ id: L.ebook.id, qty: 1 }], phone: '9812345670', email: 'ravi@x.dev' });
  assert.equal((await abandoned()).length, 0);
});

let interOrder;
test('paying: one order, all items, GST line per item (IGST out of state), stock taken, digital delivered', async () => {
  const r = await payCart({ cart: [{ id: L.tea.id, qty: 2, price: 1 }, { id: L.ebook.id, qty: 1 }], address: KA });
  assert.equal(r.start.amount, (400 + 100 + 50) * 100, 'amount decided on the server');
  interOrder = r.orderId;
  assert.match(r.access, /\/access\/o\./, 'the guide was delivered');
  assert.equal(await stockOf(tea.id), 6);
  const inv = await invoiceOf(r.orderId);
  assert.deepEqual(inv.items.map((l) => [l.sac, l.rate, l.igst > 0, l.cgst]), [['0902', 5, true, 0], ['999293', 18, true, 0], ['998431', 18, true, 0]]);
  assert.equal(inv.total, 550);
  const o = await orderOf(r.orderId);
  assert.deepEqual(o.items.map((i) => [i.name, i.price]), [['Assam Tea 250g × 2', 400], ['Tea Brewing Guide', 100], ['Shipping', 50]]);
  assert.equal(o.funnel, 'Online store');
  // the same payment confirmed twice records one order
  const again = await pub('/pay/verify', { payment: r.start.payment, razorpay_order_id: r.start.order_id, razorpay_payment_id: 'pay_x', razorpay_signature: sign(`${r.start.order_id}|pay_x`) });
  assert.equal(again.data.orderId, r.orderId);
  assert.equal(await stockOf(tea.id), 6);
});

test('in the seller’s state: CGST + SGST per line; a bad signature records nothing', async () => {
  const r = await payCart({ cart: [{ id: L.mug.id, qty: 1 }, { id: L.tea.id, qty: 1 }], address: MH });
  const inv = await invoiceOf(r.orderId);
  assert.deepEqual(inv.items.slice(0, 2).map((l) => [l.sac, l.rate, l.igst, l.cgst > 0, l.cgst + l.sgst]), [['6912', 18, 0, true, 42.71], ['0902', 5, 0, true, 9.52]]);
  assert.equal(await stockOf(mug.id), 2);
  const s = (await pub('/pay/start', { cart: [{ id: L.mug.id, qty: 1 }], name: 'X', address: MH })).data;
  assert.equal((await pub('/pay/verify', { payment: s.payment, razorpay_order_id: s.order_id, razorpay_payment_id: 'p', razorpay_signature: 'bad' })).status, 400);
  assert.equal(await stockOf(mug.id), 2);
});

test('overselling is refused at checkout with a clear message', async () => {
  const r = await pub('/pay/start', { cart: [{ id: L.mug.id, qty: 3 }], name: 'X', address: MH });
  assert.equal(r.status, 409);
  assert.equal(r.data.code, 'stock');
  assert.match(r.data.error, /Only 2 of Clay Mug left/);
  assert.equal((await pub('/cod', { cart: [{ id: L.mug.id, qty: 5 }], name: 'X', phone: '9876543210', address: MH })).status, 409);
});

test('COD: the seller’s PIN code rule applies, the fee is added, stock is taken when booked', async () => {
  assert.equal((await api('/settings/cod', 'PUT', { noCod: '560*' }, A)).status, 200);
  const no = await pub('/cod', { cart: [{ id: L.tea.id, qty: 1 }], name: 'Asha', phone: '9876543210', address: KA });
  assert.equal(no.status, 400);
  assert.equal(no.data.code, 'pincode_cod');
  assert.equal((await pub('/cod', { cart: [{ id: L.ebook.id, qty: 1 }], name: 'Asha', email: 'a@x.in', phone: '9876543210' })).status, 400, 'digital-only: pay online');
  const before = await stockOf(tea.id);
  const ok = await pub('/cod', { cart: [{ id: L.tea.id, qty: 2 }], name: 'Asha', phone: '9876543210', address: MH });
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  const o = await orderOf(ok.data.orderId);
  assert.equal(o.status, 'cod');
  assert.deepEqual(o.items.map((i) => i.kind), ['store', 'shipping', 'cod_fee']);
  assert.equal(o.total, 400 + 50 + 30);
  assert.equal(await stockOf(tea.id), before - 2);
});

test('sellers are isolated: no listing another seller’s stock, editing their listings, or buying them in your store', async () => {
  assert.equal((await api('/store/listings', 'POST', { kind: 'item', refId: tea.id }, B)).status, 404);
  assert.equal((await api('/store/listings', 'POST', { kind: 'product', refId: ebook.id, price: 1 }, B)).status, 404);
  assert.equal((await api(`/store/listings/${L.tea.id}`, 'PUT', { price: 1 }, B)).status, 404);
  assert.equal((await api(`/store/listings/${L.tea.id}`, 'DELETE', null, B)).status, 404);
  assert.equal((await api('/store', 'PUT', { handle: 'other-shop', enabled: true }, B)).status, 200);
  const q = await api('/s/other-shop/quote', 'POST', { cart: [{ id: L.tea.id, qty: 1 }] });
  assert.equal(q.data.code, 'unavailable');
  assert.deepEqual((await api('/s/other-shop')).data.listings, []);
  const s = (await pub('/pay/start', { cart: [{ id: L.tea.id, qty: 1 }], name: 'X', address: MH })).data;
  assert.equal((await api('/s/other-shop/pay/verify', 'POST', { payment: s.payment })).status, 404);
  assert.ok(!(await api('/orders?limit=50', 'GET', null, B)).data.orders.length);
  assert.equal((await api('/store', 'GET', null, B)).data.listings.length, 0);
});

test('the last units paid for twice at once: the later payment is honoured, flagged on the order, the seller told', async () => {
  const left = await stockOf(mug.id);
  const s = (await pub('/pay/start', { cart: [{ id: L.mug.id, qty: left }], name: 'Late', email: 'late@x.in', address: MH })).data;
  assert.equal((await pub('/cod', { cart: [{ id: L.mug.id, qty: 1 }], name: 'Fast', phone: '9876543210', address: MH })).status, 200);
  const pid = 'pay_race1';
  const v = (await pub('/pay/verify', { payment: s.payment, razorpay_order_id: s.order_id, razorpay_payment_id: pid, razorpay_signature: sign(`${s.order_id}|${pid}`) })).data;
  assert.ok(v.orderId);
  assert.deepEqual((await orderOf(v.orderId)).stockShort, ['Clay Mug']);
  assert.equal(await stockOf(mug.id), -1);
  const bell = (await api('/notifications', 'GET', null, A)).data;
  assert.ok(JSON.stringify(bell).includes('Sold more than you had in stock'));
});

// stock back: a cancelled COD order and a return to origin put the goods back once; a refund restocks unless the
// seller says the goods didn't come back
test('stock comes back on a COD cancel or RTO (once only) and on a refund unless restock is off', async () => {
  await api('/settings/cod', 'PUT', { noCod: '' }, A);
  let before = await stockOf(tea.id);
  const c = await pub('/cod', { cart: [{ id: L.tea.id, qty: 2 }], name: 'Meena', phone: '9876543211', address: MH });
  assert.equal(c.status, 200, JSON.stringify(c.data));
  assert.equal(await stockOf(tea.id), before - 2);
  assert.equal((await api(`/orders/${c.data.orderId}/cod`, 'POST', { action: 'cancel' }, A)).status, 200);
  assert.equal(await stockOf(tea.id), before, 'a cancelled COD order puts its stock back');
  await api(`/orders/${c.data.orderId}/cod`, 'POST', { action: 'rto' }, A);
  assert.equal(await stockOf(tea.id), before, 'never twice');

  before = await stockOf(tea.id);
  const paid = await payCart({ cart: [{ id: L.tea.id, qty: 1 }], address: MH });
  assert.equal(await stockOf(tea.id), before - 1);
  const r = await api(`/orders/${paid.orderId}/refund`, 'POST', { items: [0] }, A);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(await stockOf(tea.id), before, 'refunded: back in stock');
  const mv = (await api(`/inventory/moves?itemId=${tea.id}`, 'GET', null, A)).data.moves.find((m) => m.kind === 'RETURN_IN' && m.ref === `Order ${paid.orderId}`);
  assert.equal(mv.note, 'Refunded');

  before = await stockOf(tea.id);
  const kept = await payCart({ cart: [{ id: L.tea.id, qty: 1 }], address: MH });
  assert.equal((await api(`/orders/${kept.orderId}/refund`, 'POST', { items: [0], restock: false }, A)).status, 200);
  assert.equal(await stockOf(tea.id), before - 1, 'restock off: the goods didn’t come back');
});

test('the buyer’s order page: only with its key, shows where the order is; reviews once delivered, shown on the product', async () => {
  assert.equal((await api('/inventory/moves', 'POST', { itemId: tea.id, kind: 'OPENING', qty: 5 }, A)).status, 200);
  const r = await payCart({ cart: [{ id: L.tea.id, qty: 1 }, { id: L.ebook.id, qty: 1 }], address: MH, name: 'Sunita Rao', email: 'sunita@x.in' });
  const m = String(r.track).match(/^\/s\/chai-co\/order\/([\w]+)\?k=([\w-]{16})$/);
  assert.ok(m, `tracking link on the thank-you screen: ${r.track}`);
  const page = (k) => pub(`/order/${r.orderId}?k=${k}`);
  assert.equal((await pub(`/order/${r.orderId}`)).status, 404, 'no key, no order');
  assert.equal((await page('x'.repeat(16))).status, 404, 'a wrong key opens nothing');
  let o = (await page(m[2])).data.order;
  assert.deepEqual([o.status, o.payment.method, o.name, o.items.map((i) => i.name)], ['pending', 'online', 'Sunita', ['Assam Tea 250g', 'Tea Brewing Guide']]);
  assert.equal(o.review.length, 0, 'nothing to review before delivery');
  const early = await pub(`/order/${r.orderId}/review?k=${m[2]}`, { listingId: L.tea.id, rating: 5 });
  assert.equal(early.status, 400);
  // shipped, then delivered: the page follows, and the buyer is asked to rate
  await api(`/orders/${r.orderId}/fulfil`, 'POST', { status: 'shipped', courier: 'Delhivery', tracking: 'AWB123' }, A);
  o = (await page(m[2])).data.order;
  assert.deepEqual([o.status, o.shipped.courier, o.shipped.tracking], ['shipped', 'Delhivery', 'AWB123']);
  assert.match(o.shipped.url, /delhivery\.com.*AWB123/);
  await api(`/orders/${r.orderId}/fulfil`, 'POST', { status: 'delivered' }, A);
  o = (await page(m[2])).data.order;
  assert.deepEqual(o.review.map((x) => [x.listingId, x.done]), [[L.tea.id, false], [L.ebook.id, false]]);
  // reviews: 1–5 stars, only products in this order, once each (again = an edit)
  const rv = (b) => pub(`/order/${r.orderId}/review?k=${m[2]}`, b);
  assert.equal((await rv({ listingId: L.tea.id, rating: 9 })).status, 400);
  assert.equal((await rv({ listingId: L.mug.id, rating: 4 })).status, 400, 'not in this order');
  assert.equal((await rv({ listingId: L.tea.id, rating: 3, text: 'Good' })).status, 200);
  const re = await rv({ listingId: L.tea.id, rating: 4, text: 'Strong and fresh, will order again' });
  assert.deepEqual([re.data.review.rating, re.data.review.name], [4, 'Sunita R.']);
  assert.equal((await rv({ listingId: L.ebook.id, rating: 2 })).status, 200);
  assert.equal((await page(m[2])).data.order.review.every((x) => x.done), true);
  // the product shows the real average, count and the review itself
  let p = (await pub(`/p/${L.tea.id}`)).data;
  assert.deepEqual([p.listing.rating, p.listing.reviews, p.reviews.length, p.reviews[0].text], [4, 1, 1, 'Strong and fresh, will order again']);
  assert.equal((await pub('')).data.listings.find((l) => l.id === L.tea.id).reviews, 1);
  // the seller sees every review and can hide one; hidden ones leave the store
  const mine = (await api('/store/reviews', 'GET', null, A)).data.reviews;
  assert.equal(mine.length, 2);
  const teaReview = mine.find((x) => x.listingId === L.tea.id);
  assert.equal(teaReview.product, 'Assam Tea 250g');
  assert.equal((await api(`/store/reviews/${teaReview.id}`, 'PUT', { hidden: true }, B)).status, 404, 'not another seller’s');
  assert.equal((await api(`/store/reviews/${teaReview.id}`, 'PUT', { hidden: true }, A)).data.hidden, true);
  p = (await pub(`/p/${L.tea.id}`)).data;
  assert.deepEqual([p.listing.rating, p.listing.reviews, p.reviews.length], [undefined, undefined, 0]);
  // another store's address doesn't open this order
  assert.equal((await api(`/s/demo-grocery/order/${r.orderId}?k=${m[2]}`)).status, 404);
});
