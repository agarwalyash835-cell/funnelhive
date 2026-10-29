// Counter mode (the phone app at /counter): bills are idempotent by the phone's clientId, offline bills are priced
// again on the server (a different total is flagged, the server's stands), offline sales may take stock below zero
// (flagged), the catalog a phone caches, the UPI ID for receipts, and the sales role working all of it.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, register, enable2fa } from './helpers.mjs';

let srv, api, owner, ownerId, sales;
const P = '/inventory/pro';
const cid = () => `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

before(async () => {
  srv = await startServer({ ADMIN_EMAILS: 'admin@counter.test' });
  api = srv.api;
  let admin = (await register(api, 'admin@counter.test')).token;
  const link = srv.log().match(/To: admin@counter\.test[\s\S]*?\/verify\?token=([a-f0-9.]+)/);
  await api('/auth/verify', 'POST', { token: link[1] });
  admin = (await enable2fa(api, admin)).token;
  owner = (await register(api, 'owner@counter.test')).token;
  ownerId = (await api('/me', 'GET', null, owner)).data.id;
  await api(`/admin/users/${ownerId}/action`, 'POST', { action: 'inventory_on' }, admin);
  const me = await register(api, 'sales@counter.test');
  const inv = (await api('/team/invite', 'POST', { email: 'sales@counter.test', role: 'sales' }, owner)).data;
  sales = (await api('/team/accept', 'POST', { token: inv.token }, me.token)).data.token;
});
after(async () => { await srv?.stop(); });

const newItem = async (name, o = {}) => (await api('/inventory/items', 'POST', { name, unit: 'pcs', sale_rate: 100, gst_percent: 18, ...o }, owner)).data;
const stockIn = (it, qty) => api('/inventory/moves', 'POST', { kind: 'PURCHASE', itemId: it.id, qty }, owner);
const stock = async (it) => (await api(`/inventory/items/${it.id}`, 'GET', null, owner)).data;

test('a bill sent twice with the same clientId is made once; different clientIds make two', async () => {
  const soap = await newItem('Idem soap');
  await stockIn(soap, 10);
  const id = cid();
  const a = await api(`${P}/bills`, 'POST', { clientId: id, lines: [{ itemId: soap.id, qty: 2 }], pay_mode: 'upi' }, owner);
  assert.equal(a.status, 200, JSON.stringify(a.data));
  assert.equal(a.data.clientId, id);
  assert.equal(a.data.pay_mode, 'upi');
  const b = await api(`${P}/bills`, 'POST', { clientId: id, lines: [{ itemId: soap.id, qty: 2 }] }, owner);
  assert.equal(b.status, 200);
  assert.equal(b.data.id, a.data.id, 'the same bill');
  assert.equal(b.data.number, a.data.number);
  assert.equal(b.data.repeat, true);
  // two at once with one clientId: still one bill
  const id2 = cid();
  const [x, y] = await Promise.all([1, 2].map(() => api(`${P}/bills`, 'POST', { clientId: id2, lines: [{ itemId: soap.id, qty: 1 }] }, owner)));
  assert.equal(x.data.id, y.data.id);
  const c = await api(`${P}/bills`, 'POST', { clientId: cid(), lines: [{ itemId: soap.id, qty: 2 }] }, owner);
  assert.notEqual(c.data.id, a.data.id);
  assert.notEqual(c.data.number, a.data.number);
  const mine = (await api(`${P}/bills?limit=50`, 'GET', null, owner)).data.filter((bill) => bill.lines[0].itemId === soap.id);
  assert.equal(mine.length, 3, 'two with the first clientId → one, the parallel pair → one, a new clientId → one');
  const s = await stock(soap);
  assert.equal(s.stock ?? s.item?.stock, 5, 'stock left once per bill');
  assert.equal((await api(`${P}/bills`, 'POST', { clientId: 'bad id!', lines: [{ itemId: soap.id, qty: 1 }] }, owner)).status, 400);
  // no clientId: as before, every post is a new bill
  const n1 = await api(`${P}/bills`, 'POST', { lines: [{ itemId: soap.id, qty: 1 }] }, owner), n2 = await api(`${P}/bills`, 'POST', { lines: [{ itemId: soap.id, qty: 1 }] }, owner);
  assert.notEqual(n1.data.id, n2.data.id);
});

test('an offline bill priced differently from the server keeps the server’s total and is flagged', async () => {
  const oil = await newItem('Offline oil', { sale_rate: 200, gst_percent: 5 });
  await stockIn(oil, 10);
  // the phone cached ₹180 + 5% = ₹189; the rate is now ₹200 → ₹210
  const r = await api(`${P}/bills`, 'POST', { clientId: cid(), lines: [{ itemId: oil.id, qty: 1 }], offline: { total: 189, at: Date.now() - 60000 } }, owner);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.total, 210, 'the server’s price stands');
  assert.equal(r.data.offline.total, 189);
  const f = r.data.flags.find((x) => x.code === 'PRICE_CHANGED');
  assert.ok(f, JSON.stringify(r.data.flags));
  assert.equal(f.diff, 21);
  // the same price offline: no flag
  const ok = await api(`${P}/bills`, 'POST', { clientId: cid(), lines: [{ itemId: oil.id, qty: 1 }], offline: { total: 210, at: Date.now() } }, owner);
  assert.equal(ok.data.flags, undefined);
  const flagged = (await api(`${P}/bills?flagged=1`, 'GET', null, owner)).data;
  assert.ok(flagged.some((b) => b.id === r.data.id));
  assert.ok(!flagged.some((b) => b.id === ok.data.id));
});

test('offline sales may take stock below zero (flagged); online ones still may not', async () => {
  const pen = await newItem('Offline pen', { sale_rate: 10, gst_percent: 0 });
  await stockIn(pen, 2);
  assert.equal((await api(`${P}/bills`, 'POST', { clientId: cid(), lines: [{ itemId: pen.id, qty: 5 }] }, owner)).status, 409, 'online: refused as before');
  const r = await api(`${P}/bills`, 'POST', { clientId: cid(), lines: [{ itemId: pen.id, qty: 5 }], offline: { total: 50, at: Date.now() } }, owner);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const f = r.data.flags.find((x) => x.code === 'NEGATIVE_STOCK');
  assert.ok(f);
  assert.equal(f.items[0].stock, -3);
  assert.ok(!r.data.flags.some((x) => x.code === 'PRICE_CHANGED'));
});

test('sales staff use counter mode: catalog, bills with a clientId; only the owner sets the UPI ID', async () => {
  const tea = await newItem('Counter tea', { sale_rate: 50, gst_percent: 5, barcode: '8900000000017' });
  await stockIn(tea, 20);
  const cat = await api(`${P}/counter/catalog`, 'GET', null, sales);
  assert.equal(cat.status, 200, JSON.stringify(cat.data));
  const t = cat.data.items.find((i) => i.id === tea.id);
  assert.equal(t.barcode, '8900000000017');
  assert.equal(t.sale_rate, 50);
  assert.equal(t.stock, 20);
  assert.ok(Array.isArray(cat.data.schemes) && Array.isArray(cat.data.ratelists) && cat.data.states.Maharashtra === '27');
  assert.equal(cat.data.settings.upi_id, null);

  const id = cid();
  const b = await api(`${P}/bills`, 'POST', { clientId: id, lines: [{ itemId: tea.id, qty: 2 }], party_name: 'Asha', party_phone: '98765 43210', pay_mode: 'cash' }, sales);
  assert.equal(b.status, 200, JSON.stringify(b.data));
  assert.equal((await api(`${P}/bills`, 'POST', { clientId: id, lines: [{ itemId: tea.id, qty: 2 }] }, sales)).data.id, b.data.id);
  assert.equal((await api(`${P}/bills/preview`, 'POST', { lines: [{ itemId: tea.id, qty: 1 }] }, sales)).status, 200);
  assert.ok((await api(`${P}/counter/catalog`, 'GET', null, sales)).data.popular.includes(tea.id), 'what sells shows as a tile');

  assert.equal((await api(`${P}/counter/settings`, 'GET', null, sales)).status, 200);
  assert.equal((await api(`${P}/counter/settings`, 'PUT', { upi_id: 'x@okaxis' }, sales)).status, 403);
  assert.equal((await api(`${P}/counter/settings`, 'PUT', { upi_id: 'not a upi' }, owner)).status, 400);
  const s = await api(`${P}/counter/settings`, 'PUT', { upi_id: 'shop.name@okhdfcbank', upi_name: 'Shop Name' }, owner);
  assert.equal(s.status, 200, JSON.stringify(s.data));
  assert.equal((await api(`${P}/counter/catalog`, 'GET', null, sales)).data.settings.upi_id, 'shop.name@okhdfcbank');
});
