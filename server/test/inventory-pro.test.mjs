// Inventory for each industry (inventory-pro.js): the add-on gate, bills of materials (produce all-or-nothing, raw
// material requirement), batches and expiry (stock per batch, expiring lists, first-expiry-first-out), schemes, variants,
// counter bills (stock moves + GST), rate lists and credit limits (outstanding from Tally, or from credit counter bills).
// Items and stock are written straight into the server's database, as the Inventory page (phase 2) isn't here yet.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, register, enable2fa } from './helpers.mjs';

let srv, api, ADMIN, S, sellerId, T, uid, addMove, stockOf;
const P = '/inventory/pro';
const day = (n = 0) => new Date(Date.parse(`${new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date())}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const item = (name, o = {}) => T.iitems.insert({ id: uid(), userId: sellerId, name, unit: 'pcs', sku: null, barcode: null, category: null, hsn: null, gst_percent: 18, sale_rate: 100, purchase_rate: 50, reorder_level: 0, active: true, at: Date.now(), ...o });
const stockIn = (it, qty, o = {}) => addMove(sellerId, { itemId: it.id, qty, kind: 'PURCHASE', ...o });

before(async () => {
  srv = await startServer({ ADMIN_EMAILS: 'owner@inv.test' });
  api = srv.api;
  ADMIN = (await register(api, 'owner@inv.test')).token;
  const link = srv.log().match(/To: owner@inv\.test[\s\S]*?\/verify\?token=([a-f0-9.]+)/);
  await api('/auth/verify', 'POST', { token: link[1] });
  ADMIN = (await enable2fa(api, ADMIN)).token;
  S = (await register(api, 'seller@inv.test')).token;
  sellerId = (await api('/me', 'GET', null, S)).data.id;
  // the same database file as the server (SQLite in WAL mode takes several processes)
  process.env.DATA_DIR = srv.dataDir;
  ({ T, uid } = await import('../db.js'));
  ({ addMove, stockOf } = await import('../inventory-core.js'));
});
after(async () => { await srv?.stop(); });

test('an add-on: refused until an admin switches Inventory on; tools ordered by the seller’s industry', async () => {
  const r = await api(P, 'GET', null, S);
  assert.equal(r.status, 403);
  assert.equal(r.data.code, 'INVENTORY_OFF');
  assert.equal((await api(`${P}/bills`, 'POST', { lines: [] }, S)).data.code, 'INVENTORY_OFF');
  assert.equal((await api(`/admin/users/${sellerId}/action`, 'POST', { action: 'inventory_on' }, ADMIN)).status, 200);
  assert.equal((await api(P, 'GET', null, S)).data.industry, null);
  T.users.update(sellerId, (u) => { u.settings = { ...u.settings, crmKit: { id: 'manufacturer', name: 'Manufacturer / factory' } }; });
  const d = (await api(P, 'GET', null, S)).data;
  assert.equal(d.industry, 'manufacturer');
  assert.equal(d.sections[0], 'bom');
  assert.equal(d.sections.length, 7, 'every tool stays available');
});

test('bills of materials: requirement maths, produce all-or-nothing with the shortfall listed', async () => {
  const chair = item('Chair', { sale_rate: 1500 }), leg = item('Chair Leg', { purchase_rate: 40 }), seat = item('Seat', { purchase_rate: 200 }), screw = item('Screw', { purchase_rate: 0.5 });
  stockIn(leg, 100); stockIn(seat, 30); stockIn(screw, 1000);
  assert.equal((await api(`${P}/boms`, 'PUT', { itemId: chair.id, lines: [{ itemId: chair.id, qty: 1 }] }, S)).status, 400, 'not made from itself');
  const bom = (await api(`${P}/boms`, 'PUT', { itemId: chair.id, lines: [{ itemId: leg.id, qty: 4 }, { itemId: seat.id, qty: 1 }, { itemId: screw.id, qty: 12 }] }, S)).data;
  assert.equal(bom.lines.length, 3);

  const req = (await api(`${P}/boms/${bom.id}/requirement?qty=50`, 'GET', null, S)).data;
  assert.deepEqual(req.lines.map((l) => [l.name, l.need, l.have, l.short]), [['Chair Leg', 200, 100, 100], ['Seat', 50, 30, 20], ['Screw', 600, 1000, 0]]);
  assert.equal(req.can_make, 25, 'legs allow 25 chairs');
  assert.equal(req.cost, 50 * (4 * 40 + 200 + 12 * 0.5));
  // the finished item's id finds its BOM too
  assert.equal((await api(`${P}/boms/${chair.id}/requirement?qty=1`, 'GET', null, S)).data.can_make, 25);

  const before = T.imoves.count({ userId: sellerId });
  const no = await api(`${P}/boms/${bom.id}/produce`, 'POST', { qty: 50 }, S);
  assert.equal(no.status, 409);
  assert.match(no.data.error, /short of 100 pcs Chair Leg, 20 pcs Seat/);
  assert.deepEqual(no.data.shortfall.map((s) => [s.name, s.short]), [['Chair Leg', 100], ['Seat', 20]]);
  assert.equal(T.imoves.count({ userId: sellerId }), before, 'nothing moved');
  assert.equal(stockOf(chair.id), 0);

  const ok = await api(`${P}/boms/${bom.id}/produce`, 'POST', { qty: 20 }, S);
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  assert.equal(ok.data.produced, 20);
  assert.deepEqual([stockOf(chair.id), stockOf(leg.id), stockOf(seat.id), stockOf(screw.id)], [20, 20, 10, 760]);
  const moves = T.imoves.all({ userId: sellerId, itemId: [chair.id, leg.id, seat.id, screw.id] }).filter((m) => m.ref === ok.data.ref);
  assert.deepEqual(moves.map((m) => m.kind).sort(), ['CONSUME', 'CONSUME', 'CONSUME', 'PRODUCE']);
  assert.ok(moves.every((m) => m.source === 'BOM'));
  assert.equal(moves.find((m) => m.kind === 'PRODUCE').rate, 366, 'cost per chair from component rates');
});

test('batches and expiry: stock per batch, expiring in 30 / 60 / 90 days, first-expiry-first-out', async () => {
  const syrup = item('Cough Syrup', { gst_percent: 12, sale_rate: 80 });
  stockIn(syrup, 50, { batch: 'B1', expiry: day(20) });
  stockIn(syrup, 30, { batch: 'B2', expiry: day(75) });
  stockIn(syrup, 10, { batch: 'B0', expiry: day(-3) });
  addMove(sellerId, { itemId: syrup.id, qty: 5, kind: 'SALE', batch: 'B1', expiry: day(20) });
  const b = (await api(`${P}/batches?itemId=${syrup.id}`, 'GET', null, S)).data;
  assert.deepEqual(b.map((x) => [x.batch, x.qty]), [['B0', 10], ['B1', 45], ['B2', 30]]);

  const e30 = (await api(`${P}/expiring?days=30`, 'GET', null, S)).data;
  assert.deepEqual(e30.batches.map((x) => [x.batch, x.qty, x.expired]), [['B0', 10, true], ['B1', 45, false]]);
  assert.equal(e30.batches[1].days_left, 20);
  assert.equal((await api(`${P}/expiring?days=60`, 'GET', null, S)).data.batches.length, 2);
  assert.deepEqual((await api(`${P}/expiring?days=90`, 'GET', null, S)).data.batches.map((x) => x.batch), ['B0', 'B1', 'B2']);

  const f = (await api(`${P}/fefo?itemId=${syrup.id}&qty=60`, 'GET', null, S)).data;
  assert.deepEqual(f.take.map((t) => [t.batch, t.qty]), [['B1', 45], ['B2', 15]], 'the expired batch is never suggested');
  assert.deepEqual([f.short, f.expired[0].batch], [0, 'B0']);
  assert.equal((await api(`${P}/fefo?itemId=${syrup.id}&qty=100`, 'GET', null, S)).data.short, 25);
});

test('schemes: buy X get Y free and % off, the calculator picks the better one', async () => {
  const soap = item('Soap', { sale_rate: 30, gst_percent: 18 });
  assert.equal((await api(`${P}/schemes`, 'POST', { itemId: soap.id, kind: 'FREE', buy: 10 }, S)).status, 400);
  await api(`${P}/schemes`, 'POST', { itemId: soap.id, kind: 'FREE', buy: 10, free: 1 }, S);
  const pct = (await api(`${P}/schemes`, 'POST', { itemId: soap.id, kind: 'PERCENT', pct: 5, min_qty: 24 }, S)).data;
  assert.equal(pct.name, '5% off on 24+');

  let c = (await api(`${P}/schemes/calc`, 'POST', { itemId: soap.id, qty: 25 }, S)).data;
  assert.equal(c.scheme.kind, 'FREE', '2 free (₹60) beats 5% (₹37.50)');
  assert.deepEqual([c.free_qty, c.gross, c.discount, c.taxable, c.gst, c.amount], [2, 750, 0, 750, 135, 885]);
  c = (await api(`${P}/schemes/calc`, 'POST', { item: 'soap', qty: 9 }, S)).data;
  assert.equal(c.scheme, null, 'below both thresholds');
  await api(`${P}/schemes/${pct.id}`, 'PUT', { pct: 10 }, S);
  c = (await api(`${P}/schemes/calc`, 'POST', { itemId: soap.id, qty: 25 }, S)).data;
  assert.equal(c.scheme.kind, 'PERCENT', '10% (₹75) now beats 2 free (₹60)');
  assert.equal(c.scheme.name, '10% off on 24+', 'our name follows the new terms');
  assert.deepEqual([c.free_qty, c.discount, c.taxable, c.gst, c.amount], [0, 75, 675, 121.5, 796.5]);
  // an ended scheme doesn't count
  await api(`${P}/schemes/${pct.id}`, 'PUT', { to: day(-1) }, S);
  assert.equal((await api(`${P}/schemes/calc`, 'POST', { itemId: soap.id, qty: 25 }, S)).data.scheme.kind, 'FREE');
});

test('variants and counter bill: SALE moves by barcode or name, GST from each item, schemes and FEFO on the way', async () => {
  const shirt = item('Shirt', { sku: 'SH', sale_rate: 500, gst_percent: 5 });
  const v = (await api(`${P}/variants`, 'POST', { parentId: shirt.id, sizes: ['M', 'L'], colours: 'Blue, White' }, S)).data;
  assert.equal(v.made.length, 4);
  assert.deepEqual(v.grid.sizes, ['M', 'L']);
  assert.ok(v.made.some((i) => i.name === 'Shirt M Blue' && i.sku === 'SH-M-BLUE'));
  assert.equal((await api(`${P}/variants`, 'POST', { parentId: shirt.id, sizes: ['M'], colours: ['Blue'] }, S)).data.made.length, 0, 'no duplicates');
  const mBlue = T.iitems.all({ userId: sellerId, active: 1 }).find((i) => i.name === 'Shirt M Blue');
  T.iitems.update(mBlue.id, (i) => { i.barcode = '8901234567890'; });
  stockIn(mBlue, 10);
  const lWhite = T.iitems.all({ userId: sellerId, active: 1 }).find((i) => i.name === 'Shirt L White');
  stockIn(lWhite, 1);
  const pen = item('Pen', { sale_rate: 10, gst_percent: 18 });
  stockIn(pen, 100);

  const ambiguous = await api(`${P}/bills/preview`, 'POST', { lines: [{ item: 'shirt blue', qty: 1 }] }, S);
  assert.equal(ambiguous.status, 400);
  assert.match(ambiguous.data.error, /matches 2 items/);

  // short on one line → nothing is sold
  const before = stockOf(mBlue.id);
  const short = await api(`${P}/bills`, 'POST', { lines: [{ barcode: '8901234567890', qty: 2 }, { item: 'shirt L white', qty: 3 }] }, S);
  assert.equal(short.status, 409);
  assert.equal(stockOf(mBlue.id), before);

  const bill = await api(`${P}/bills`, 'POST', { lines: [{ barcode: '8901234567890', qty: 2 }, { item: 'shirt m blue', qty: 1, rate: 450 }, { itemId: pen.id, qty: 3 }] }, S);
  assert.equal(bill.status, 200, JSON.stringify(bill.data));
  const b = bill.data;
  assert.match(b.number, /^CB-\d{4}$/);
  assert.deepEqual(b.lines.map((l) => [l.name, l.qty, l.rate, l.gst]), [['Shirt M Blue', 2, 500, 50], ['Shirt M Blue', 1, 450, 22.5], ['Pen', 3, 10, 5.4]]);
  assert.equal(b.taxable, 1480);
  assert.equal(b.gst, 77.9);
  assert.equal(b.total, 1558, '1557.90 rounded');
  assert.equal(b.round_off, 0.1);
  assert.equal(stockOf(mBlue.id), 7);
  assert.equal(stockOf(pen.id), 97);
  const sales = b.moveIds.map((id) => T.imoves.get(id));
  assert.ok(sales.every((m) => m.kind === 'SALE' && m.qty < 0 && m.ref === b.number));

  // a scheme's free units leave stock at ₹0; batched stock goes first-expiry-first-out
  const soap = T.iitems.find({ userId: sellerId, lname: 'soap' });
  stockIn(soap, 20, { batch: 'S2', expiry: day(200) }); stockIn(soap, 5, { batch: 'S1', expiry: day(40) });
  const sb = (await api(`${P}/bills`, 'POST', { lines: [{ itemId: soap.id, qty: 20 }] }, S)).data;
  assert.equal(sb.lines[0].free_qty, 2);
  assert.equal(sb.total, Math.round(20 * 30 * 1.18));
  assert.equal(stockOf(soap.id), 3);
  const sm = sb.moveIds.map((id) => T.imoves.get(id));
  assert.deepEqual(sm.map((m) => [m.batch, m.qty, m.rate]), [['S1', -5, 30], ['S2', -15, 30], ['S2', -2, 0]]);

  // cancelling puts the stock back
  assert.equal((await api(`${P}/bills/${b.id}/cancel`, 'POST', {}, S)).data.cancelled, true);
  assert.equal(stockOf(mBlue.id), 10);
  assert.equal(stockOf(pen.id), 100);
  assert.equal((await api(`${P}/bills/${b.id}/cancel`, 'POST', {}, S)).status, 409);
});

test('rate lists: a named list, a party’s own list, else the item’s rate; bills use them', async () => {
  const rice = item('Basmati Rice 25kg', { sale_rate: 2000, gst_percent: 5, unit: 'bag' });
  const other = item('Sugar 50kg', { sale_rate: 2200, gst_percent: 5, unit: 'bag' });
  const ws = (await api(`${P}/ratelists`, 'POST', { name: 'Wholesale', rates: { [rice.id]: 1850 } }, S)).data;
  await api(`${P}/ratelists`, 'POST', { name: 'Dealer', rates: { [rice.id]: 1800 } }, S);
  assert.equal((await api(`${P}/ratelists`, 'POST', { name: 'wholesale' }, S)).status, 409);
  assert.deepEqual((await api(`${P}/ratelists`, 'GET', null, S)).data.map((l) => l.name), ['Dealer', 'Wholesale']);

  let r = (await api(`${P}/rate?itemId=${rice.id}&list=Wholesale`, 'GET', null, S)).data;
  assert.deepEqual([r.rate, r.source], [1850, 'list']);
  r = (await api(`${P}/rate?item=sugar&list=dealer`, 'GET', null, S)).data;
  assert.deepEqual([r.rate, r.source], [2200, 'item'], 'not on the list → the item’s rate');
  r = (await api(`${P}/rate?itemId=${rice.id}`, 'GET', null, S)).data;
  assert.equal(r.rate, 2000);
  await api(`${P}/credit`, 'PUT', { party_name: 'Gupta Kirana', limit: 100000, ratelistId: ws.id }, S);
  r = (await api(`${P}/rate?itemId=${rice.id}&party=gupta kirana`, 'GET', null, S)).data;
  assert.deepEqual([r.rate, r.list.name], [1850, 'Wholesale']);

  stockIn(rice, 10); stockIn(other, 10);
  const p = (await api(`${P}/bills/preview`, 'POST', { party_name: 'Gupta Kirana', lines: [{ itemId: rice.id, qty: 2 }] }, S)).data;
  assert.equal(p.lines[0].rate, 1850);
  assert.equal(p.total, Math.round(3700 * 1.05));
  await api(`${P}/ratelists/${ws.id}`, 'PUT', { rates: { [rice.id]: 1900 } }, S);
  assert.equal((await api(`${P}/rate?itemId=${rice.id}&list=${ws.id}`, 'GET', null, S)).data.rate, 1900);
});

test('credit limits: warns past the limit — outstanding from credit counter bills, or from Tally when used', async () => {
  const cement = item('Cement', { sale_rate: 400, gst_percent: 28, unit: 'bag' });
  stockIn(cement, 500);
  await api(`${P}/credit`, 'PUT', { party_name: 'Sharma Builders', limit: 10000 }, S);
  let c = (await api(`${P}/credit?party=sharma builders`, 'GET', null, S)).data;
  assert.deepEqual([c.limit, c.outstanding, c.outstanding_from, c.over], [10000, 0, 'bills', false]);

  // 15 bags × ₹400 + 28% = ₹7,680 on credit: within the limit
  const b1 = await api(`${P}/bills`, 'POST', { party_name: 'Sharma Builders', credit: true, lines: [{ itemId: cement.id, qty: 15 }] }, S);
  assert.equal(b1.status, 200, JSON.stringify(b1.data));
  assert.equal(b1.data.total, 7680);
  assert.equal(b1.data.paid, false);
  c = (await api(`${P}/credit/check`, 'POST', { party_name: 'Sharma Builders', amount: 5000 }, S)).data;
  assert.deepEqual([c.outstanding, c.after, c.over, c.by], [7680, 12680, true, 2680]);
  assert.match(c.message, /₹2,680 over their ₹10,000 credit limit/);

  // the next credit bill would cross it: warned, not saved, unless the seller goes ahead
  const stock = stockOf(cement.id);
  const warn = await api(`${P}/bills`, 'POST', { party_name: 'Sharma Builders', credit: true, lines: [{ itemId: cement.id, qty: 10 }] }, S);
  assert.equal(warn.status, 409);
  assert.equal(warn.data.code, 'CREDIT_LIMIT');
  assert.equal(warn.data.credit_check.over, true);
  assert.equal(stockOf(cement.id), stock);
  const cash = await api(`${P}/bills`, 'POST', { party_name: 'Sharma Builders', lines: [{ itemId: cement.id, qty: 10 }] }, S);
  assert.equal(cash.status, 200, 'a cash sale needs no credit');
  const go = await api(`${P}/bills`, 'POST', { party_name: 'Sharma Builders', credit: true, override: true, lines: [{ itemId: cement.id, qty: 10 }] }, S);
  assert.equal(go.status, 200);
  assert.equal((await api(`${P}/credit?party=Sharma Builders`, 'GET', null, S)).data.outstanding, 7680 + 5120);
  await api(`/inventory/pro/bills/${b1.data.id}/paid`, 'POST', {}, S);
  assert.equal((await api(`${P}/credit?party=Sharma Builders`, 'GET', null, S)).data.outstanding, 5120, 'paid bills no longer count');
  assert.equal((await api(`${P}/bills?party=sharma builders&open=1`, 'GET', null, S)).data.length, 1);

  // with Tally: the party's open receivable bills in the mirror are what they owe
  const co = T.tcompanies.insert({ id: uid(), userId: sellerId, tally_guid: 'g-1', name: 'Sharma & Sons', active: true, at: Date.now() });
  T.users.update(sellerId, (u) => { u.addons = { ...u.addons, tally: true }; u.tally = { ...u.tally, companyId: co.id }; });
  const out = (o) => T.touts.insert({ id: uid(), userId: sellerId, companyId: co.id, okey: uid(), party_name: 'Sharma Builders', bill_type: 'RECEIVABLE', status: 'PENDING', pending_amount: -1000, amount: -1000, active: true, syncedAt: Date.now(), ...o });
  out({ pending_amount: -6000, status: 'OVERDUE' }); out({ pending_amount: -2500, status: 'PARTIAL' });
  out({ pending_amount: -9999, status: 'PAID' }); out({ bill_type: 'PAYABLE', pending_amount: 7777 }); out({ party_name: 'Someone Else', pending_amount: -5555 });
  c = (await api(`${P}/credit?party=Sharma Builders`, 'GET', null, S)).data;
  assert.deepEqual([c.outstanding, c.outstanding_from, c.open_bills, c.over], [8500, 'tally', 2, false]);
  c = (await api(`${P}/credit/check`, 'POST', { party_name: 'sharma builders', amount: 2000 }, S)).data;
  assert.deepEqual([c.after, c.over, c.by], [10500, true, 500]);
  assert.equal((await api(`${P}/bills`, 'POST', { party_name: 'Sharma Builders', credit: true, lines: [{ itemId: cement.id, qty: 4 }] }, S)).data.code, 'CREDIT_LIMIT', '₹2,048 more crosses ₹10,000');
  const list = (await api(`${P}/credit`, 'GET', null, S)).data;
  assert.ok(list.some((x) => x.party_name === 'Sharma Builders' && x.outstanding === 8500));
});

test('Hive tools: produce, expiring, counter bill by name, credit limit — writes wait for Confirm', async () => {
  const { TOOLS, OK } = await import('../hive-inventory-pro.js');
  const tool = Object.fromEntries(TOOLS.map((t) => [t.name, t]));
  const ctx = { call: async (method, path, body) => { const r = await api(path, method, body, S); if (r.status >= 400) throw new Error(r.data.error); return r.data; } };
  assert.deepEqual(Object.keys(OK).sort(), ['inventory_counter_bill', 'inventory_make_variants', 'inventory_produce', 'inventory_set_bom', 'inventory_set_credit_limit', 'inventory_set_scheme']);
  assert.match(OK.inventory_counter_bill({ lines: [{ item: 'shirt M blue', qty: 2 }] }), /2 × shirt M blue/);

  const need = await tool.inventory_production.run(ctx, { item: 'chair', qty: 10 });
  assert.equal(need.canMakeNow, 5, '20 legs left → 5 chairs');
  await assert.rejects(tool.inventory_produce.run(ctx, { item: 'chair', qty: 10 }), /short of 20 pcs Chair Leg/);
  const made = await tool.inventory_produce.run(ctx, { item: 'Chair', qty: 5 });
  assert.equal(made.produced, 5);
  assert.deepEqual([T.imoves.get(made.moves.at(-1)).kind, T.imoves.get(made.moves.at(-1)).source], ['PRODUCE', 'HIVE']);

  const exp = await tool.inventory_expiring.run(ctx, { days: 30 });
  assert.ok(exp.batches.some((b) => b.batch === 'B1' && b.status === '20 days left'));

  const bill = await tool.inventory_counter_bill.run(ctx, { lines: [{ item: 'shirt m blue', qty: 2 }] });
  assert.match(bill.bill, /^CB-/);
  assert.equal(bill.total, '₹1,050');
  const priced = await tool.inventory_price_check.run(ctx, { lines: [{ item: 'cement', qty: 4 }], party_name: 'Sharma Builders', credit: true });
  assert.equal(priced.overLimit, true);
  await assert.rejects(tool.inventory_counter_bill.run(ctx, { lines: [{ item: 'cement', qty: 4 }], party_name: 'Sharma Builders', credit: true }), /over their ₹10,000 credit limit/);

  const cr = await tool.inventory_credit.run(ctx, { party: "sharma builders" });
  assert.deepEqual([cr.limit, cr.owes, cr.from], ['₹10,000', '₹8,500', 'Tally']);
  const set = await tool.inventory_set_credit_limit.run(ctx, { party: 'Sharma Builders', limit: 20000, ratelist: 'dealer' });
  assert.equal(set.limit, '₹20,000');
  assert.equal((await tool.inventory_rate.run(ctx, { item: 'basmati', party: 'Sharma Builders' })).rate, '₹1,800');
});

// found in the end-to-end run of each industry through Hive: there was no tool for a bill of materials, a scheme,
// sizes / colours or the day's counter sales, batches didn't reach stock, and a product with variants showed "out"
test('Hive end-to-end gaps: bill of materials, scheme, variants, counter sales; batches on entries; variant parents', async () => {
  const { TOOLS } = await import('../hive-inventory-pro.js');
  const tool = Object.fromEntries(TOOLS.map((t) => [t.name, t]));
  const ctx = { call: async (method, path, body) => { const r = await api(path, method, body, S); if (r.status >= 400) throw new Error(r.data.error); return r.data; } };
  const mk = async (b) => (await api('/inventory/items', 'POST', b, S)).data;
  await mk({ name: 'Plastic Stool', unit: 'Nos', sale_rate: 300, gst_percent: 18 });
  await mk({ name: 'Granules', unit: 'Kg', purchase_rate: 95 });
  const legs = await mk({ name: 'Stool Leg', unit: 'Nos', purchase_rate: 10 });

  const bom = await tool.inventory_set_bom.run(ctx, { item: 'plastic stool', components: [{ item: 'Granules', qty: 1.5 }, { item: 'Stool Leg', qty: 4 }] });
  assert.equal(bom.item, 'Plastic Stool');
  await api('/inventory/moves/batch', 'POST', { kind: 'PURCHASE', lines: [{ item: 'Granules', qty: 30 }, { item: 'Stool Leg', qty: 40 }] }, S);
  assert.equal((await tool.inventory_production.run(ctx, { item: 'Plastic Stool', qty: 20 })).canMakeNow, 10, '40 legs ÷ 4');
  await assert.rejects(tool.inventory_set_bom.run(ctx, { item: 'Nope', components: [] }), /No item “Nope”/);

  const sch = await tool.inventory_set_scheme.run(ctx, { item: 'Plastic Stool', kind: 'FREE', buy: 10, free: 1 });
  assert.match(sch.scheme, /Buy 10 get 1 free/i);

  // a batch and expiry given on an entry reach the stock and the expiry list
  await api('/inventory/moves/batch', 'POST', { kind: 'PURCHASE', lines: [{ item: 'Granules', qty: 5, batch: 'G-77', expiry: day(20) }] }, S);
  assert.ok(T.imoves.all({ itemId: (await api('/inventory/items?search=granules', 'GET', null, S)).data.items[0].id }).some((m) => m.batch === 'G-77' && m.expiry === day(20)));
  const one = await api('/inventory/moves', 'POST', { kind: 'PURCHASE', itemId: legs.id, qty: 2, batch: 'L-1', expiry: day(40) }, S);
  assert.deepEqual([T.imoves.get(one.data.id).batch, T.imoves.get(one.data.id).expiry], ['L-1', day(40)]);

  // sizes / colours from the main item; the main item is never "out of stock" — its variants hold the stock
  await mk({ name: 'Linen Kurta', unit: 'Nos', sale_rate: 1299, gst_percent: 5 });
  const v = await tool.inventory_make_variants.run(ctx, { item: 'Linen Kurta', sizes: ['M', 'L'], colours: ['Beige'] });
  assert.deepEqual(v.made.sort(), ['Linen Kurta L Beige', 'Linen Kurta M Beige']);
  const list = (await api('/inventory/items?search=linen', 'GET', null, S)).data;
  const main = list.items.find((x) => x.name === 'Linen Kurta');
  assert.deepEqual([main.has_variants, main.low], [true, false]);
  assert.ok(!(await api('/inventory/low', 'GET', null, S)).data.items.some((x) => x.name === 'Linen Kurta'));

  // the day's counter sales add up every bill made today, cancelled ones left out
  await api('/inventory/moves/batch', 'POST', { kind: 'PURCHASE', lines: [{ item: 'Linen Kurta M Beige', qty: 5 }] }, S);
  const before_ = await tool.inventory_counter_bills.run(ctx, {});
  await tool.inventory_counter_bill.run(ctx, { lines: [{ item: 'linen kurta m beige', qty: 1 }] });
  const after_ = await tool.inventory_counter_bills.run(ctx, {});
  assert.equal(after_.count, before_.count + 1);
  assert.ok(after_.bills.some((b) => b.total === '₹1,364'), '₹1,299 + 5% GST, rounded');
});
