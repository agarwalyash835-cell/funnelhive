// Inventory reports (inventory-reports.js), every number worked out by hand: stock valuation by FIFO and weighted
// average (with a godown transfer, production at its BOM rate, items with no cost rate), the trading account with a
// credit note and a free scheme unit, a party ledger's running balance, the registers, the GST summary, fast / slow /
// dead stock, the CSVs and the Hive tools.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, register, enable2fa } from './helpers.mjs';

let srv, api, ADMIN, T, uid, addMove;
const R = '/inventory/reports';
const day = (n = 0) => new Date(Date.parse(`${new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date())}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const A = {}, B = {}; // two sellers: A for valuation and stock speed, B for profit, ledger, registers and GST

async function seller(email) {
  const token = (await register(api, email)).token;
  const id = (await api('/me', 'GET', null, token)).data.id;
  assert.equal((await api(`/admin/users/${id}/action`, 'POST', { action: 'inventory_on' }, ADMIN)).status, 200);
  return { token, id };
}
const item = (s, name, o = {}) => T.iitems.insert({ id: uid(), userId: s.id, name, lname: name.toLowerCase(), unit: 'pcs', sku: null, barcode: null, category: null, hsn: null, gst_percent: 0, sale_rate: null, purchase_rate: null, reorder_level: null, active: true, at: Date.now(), ...o });
const move = (s, it, kind, qty, o = {}) => addMove(s.id, { itemId: it.id, kind, qty, ...o });
const get = async (s, path) => { const r = await api(path, 'GET', null, s.token); assert.equal(r.status, 200, `${path}: ${JSON.stringify(r.data)}`); return r.data; };
const csv = async (s, path) => { const r = await fetch(`${srv.base}/api${path}${path.includes('?') ? '&' : '?'}format=csv`, { headers: { authorization: `Bearer ${s.token}` } }); return { type: r.headers.get('content-type'), disposition: r.headers.get('content-disposition'), text: await r.text() }; };

before(async () => {
  srv = await startServer({ ADMIN_EMAILS: 'owner@rep.test' });
  api = srv.api;
  ADMIN = (await register(api, 'owner@rep.test')).token;
  const link = srv.log().match(/To: owner@rep\.test[\s\S]*?\/verify\?token=([a-f0-9.]+)/);
  await api('/auth/verify', 'POST', { token: link[1] });
  ADMIN = (await enable2fa(api, ADMIN)).token;
  process.env.DATA_DIR = srv.dataDir;
  ({ T, uid } = await import('../db.js'));
  ({ addMove } = await import('../inventory-core.js'));
  Object.assign(A, await seller('a@rep.test'));
  Object.assign(B, await seller('b@rep.test'));
});
after(async () => { await srv?.stop(); });

test('an add-on: reports are refused until Inventory is on', async () => {
  const other = (await register(api, 'off@rep.test')).token;
  const r = await api(`${R}/valuation`, 'GET', null, other);
  assert.equal(r.status, 403);
  assert.equal(r.data.code, 'INVENTORY_OFF');
});

test('stock valuation: FIFO vs weighted average, per godown, as of a date; production at its BOM rate; no-cost items flagged', async () => {
  const rice = A.rice = item(A, 'Rice', { category: 'Grains', purchase_rate: 50 });
  move(A, rice, 'OPENING', 10, { rate: 40, day: day(-20) });
  move(A, rice, 'PURCHASE', 20, { rate: 50, day: day(-15) });
  move(A, rice, 'SALE', 15, { rate: 70, day: day(-10), party_name: 'Walk-in' });
  move(A, rice, 'PURCHASE', 10, { rate: 60, day: day(-5) });
  const shop = (await api('/inventory/godowns', 'POST', { name: 'Shop' }, A.token)).data;
  assert.equal((await api('/inventory/transfer', 'POST', { itemId: rice.id, qty: 5, from: 'Main', to: 'Shop', day: day(-3) }, A.token)).status, 200);
  const mystery = item(A, 'Mystery Box'); // no rate anywhere
  move(A, mystery, 'PURCHASE', 5, { day: day(-2) });
  const nails = item(A, 'Nails', { purchase_rate: 30 }); // no rate on the entry: the item's purchase rate
  move(A, nails, 'PURCHASE', 4, { day: day(-2) });
  const chair = item(A, 'Chair', { category: 'Furniture' });
  move(A, chair, 'PRODUCE', 2, { rate: 366, day: day(-2), ref: 'PRD-1', source: 'BOM' });

  // before the sale: 10 @ 40 + 20 @ 50 = 1,400 either way
  let v = await get(A, `${R}/valuation?asOf=${day(-12)}`);
  assert.deepEqual([v.totals.fifo, v.totals.average, v.items.length], [1400, 1400, 1]);
  // after selling 15: FIFO took 10 @ 40 + 5 @ 50 → 15 @ 50 = 750 left; average 1,400 / 30 = 46.67 → 15 × 46.67 = 700
  v = await get(A, `${R}/valuation?asOf=${day(-10)}`);
  assert.deepEqual([v.items[0].qty, v.totals.fifo, v.totals.average], [15, 750, 700]);

  v = await get(A, `${R}/valuation`);
  const r = v.items.find((x) => x.name === 'Rice');
  // FIFO: Main 10 @ 50 + 10 @ 60 = 1,100, Shop got the oldest 5 @ 50 = 250 → 1,350 (rate 54)
  // average: 25 for 1,300 (52 each) before the transfer → Main 20 = 1,040, Shop 5 = 260 → 1,300
  assert.deepEqual([r.qty, r.fifo.value, r.fifo.rate, r.average.value, r.average.rate], [25, 1350, 54, 1300, 52]);
  assert.deepEqual(r.by_godown.map((g) => [g.godown, g.qty, g.fifo, g.average]), [['Main', 20, 1100, 1040], ['Shop', 5, 250, 260]]);
  const by = Object.fromEntries(v.items.map((x) => [x.name, x]));
  assert.equal(by.Chair.fifo.value, 732, 'production at the BOM cost on the PRODUCE move');
  assert.equal(by['Mystery Box'].fifo.value, 0);
  assert.ok(by['Mystery Box'].no_cost && by['Mystery Box'].flagged);
  assert.ok(by.Nails.assumed_cost && !by.Nails.no_cost);
  assert.equal(by.Nails.fifo.value, 120);
  assert.deepEqual(v.flagged.no_cost, ['Mystery Box']);
  assert.deepEqual([v.totals.fifo, v.totals.average], [2202, 2152]);
  const g = Object.fromEntries(v.godowns.map((x) => [x.name, x]));
  assert.deepEqual([g.Main.fifo, g.Main.average, g.Shop.fifo, g.Shop.average], [1952, 1892, 250, 260]);
  // one godown only
  const s = await get(A, `${R}/valuation?godownId=${shop.id}`);
  assert.deepEqual([s.totals.fifo, s.items.length], [250, 1]);
  assert.equal((await api(`${R}/valuation?asOf=yesterday`, 'GET', null, A.token)).status, 400);
  // CSV
  const c = await csv(A, `${R}/valuation`);
  assert.match(c.type, /text\/csv/);
  assert.match(c.disposition, /stock-valuation-\d{4}-\d{2}-\d{2}\.csv/);
  const lines = c.text.replace(/^﻿/, '').trim().split('\r\n');
  assert.equal(lines[0], 'Item,Category,Unit,Quantity,FIFO rate,FIFO value,Average rate,Average value,Godowns,Flags');
  assert.ok(lines.includes('Rice,Grains,pcs,25,54,1350,52,1300,Main: 20; Shop: 5,'), lines.join('\n'));
  assert.ok(lines.some((l) => l.startsWith('Mystery Box,') && l.endsWith('no cost rate')));
  assert.equal(lines.at(-1), 'Total,,,,,2202,,2152,,');
});

// seller B's books (period: the last 20 days)
//   Soap (18% GST, FMCG): opening 30 @ 60 on day −25; scheme buy 10 get 1 free
//   Oil (5% GST, Grocery): bought 20 @ 150 from Gupta Traders on day −15; 1 returned to Gupta on day −4
//   bill 1 (day −10, cash, no party): Soap 10 (+1 free) @ 100, Oil 12 @ 200 → 1,180 + 2,520 = 3,700
//   bill 2 (day −8, credit, Sharma Stores, Karnataka GSTIN → IGST): Soap 2 @ 100 → 200 + 36 = 236
//   stock sale without a bill (day −5, SHARMA STORES): Soap 5 @ 90 = 450
//   bill 3 (day −3, cash, Sharma Stores): Oil 1 @ 200 → 210
//   credit note on bill 1 (today, cash): the free Soap back (refund ₹0 — they keep 10 for 10) and 2 Oil (400 + 20)
//   bill 2 marked paid (today)
async function booksB() {
  if (B.ready) return;
  T.users.update(B.id, (u) => { u.settings = { ...u.settings, invoicing: { ...(u.settings?.invoicing || {}), gstin: '27ABCDE1234F1Z5', legalName: 'B Traders', state: 'Maharashtra' } }; });
  const soap = B.soap = item(B, 'Soap', { gst_percent: 18, sale_rate: 100, purchase_rate: 60, category: 'FMCG', hsn: '3401', reorder_level: 15 });
  const oil = B.oil = item(B, 'Oil', { gst_percent: 5, sale_rate: 200, purchase_rate: 150, category: 'Grocery', hsn: '1508' });
  move(B, soap, 'OPENING', 30, { rate: 60, day: day(-25) });
  move(B, oil, 'PURCHASE', 20, { rate: 150, day: day(-15), party_name: 'Gupta Traders', ref: 'GT-101' });
  assert.equal((await api('/inventory/pro/schemes', 'POST', { itemId: soap.id, kind: 'FREE', buy: 10, free: 1 }, B.token)).status, 200);
  const bill = async (b) => { const r = await api('/inventory/pro/bills', 'POST', b, B.token); assert.equal(r.status, 200, JSON.stringify(r.data)); return r.data; };
  B.bill1 = await bill({ day: day(-10), lines: [{ itemId: soap.id, qty: 10 }, { itemId: oil.id, qty: 12 }] });
  assert.deepEqual([B.bill1.lines[0].free_qty, B.bill1.total], [1, 3700]);
  B.bill2 = await bill({ day: day(-8), party_name: 'Sharma Stores', credit: true, buyer: { gstin: '29ABCDE1234F1Z5' }, lines: [{ itemId: soap.id, qty: 2 }] });
  assert.deepEqual([B.bill2.igst, B.bill2.total], [36, 236]);
  move(B, oil, 'RETURN_OUT', 1, { rate: 150, day: day(-4), party_name: 'Gupta Traders', ref: 'DN-1' });
  move(B, soap, 'SALE', 5, { rate: 90, day: day(-5), party_name: 'SHARMA STORES', ref: 'S-55' });
  B.bill3 = await bill({ day: day(-3), party_name: 'Sharma Stores', lines: [{ itemId: oil.id, qty: 1 }] });
  assert.equal(B.bill3.total, 210);
  const cn = await api(`/inventory/pro/bills/${B.bill1.id}/return`, 'POST', { lines: [{ line: 0, qty: 1 }, { line: 1, qty: 2 }] }, B.token);
  assert.equal(cn.status, 200, JSON.stringify(cn.data));
  assert.deepEqual([cn.data.lines[0].taxable, cn.data.lines[1].taxable, cn.data.total, cn.data.refund_mode], [0, 400, 420, 'cash']);
  B.cn = cn.data;
  assert.equal((await api(`/inventory/pro/bills/${B.bill2.id}/paid`, 'POST', {}, B.token)).status, 200);
  B.ready = true;
}

test('profit & loss: net sales after a credit note, FIFO cost of goods incl. a free scheme unit, purchases and stock', async () => {
  await booksB();
  const d = await get(B, `${R}/pnl?from=${day(-20)}&to=${day(0)}`);
  // counter bills 1,000 + 2,400 + 200 + 200 = 3,800; credit note 400; stock sale 450 → 3,850
  assert.deepEqual(d.sales, { counter_bills: 3800, credit_notes: 400, stock_sales: 450, stock_returns: 0, net: 3850 });
  // Soap: 18 pieces out (incl. the free one) @ 60 = 1,080 less the free piece back @ 60 → 1,020
  // Oil: 13 out @ 150 = 1,950 less 2 back @ 150 → 1,650 (the return to Gupta isn't a sale)
  assert.equal(d.cogs, 2670);
  assert.equal(d.gross_profit, 1180);
  assert.equal(d.margin_pct, 30.6);
  const soap = d.by_item.find((x) => x.name === 'Soap'), oil = d.by_item.find((x) => x.name === 'Oil');
  assert.deepEqual([soap.qty_sold, soap.free_qty, soap.returned_qty, soap.net_sales, soap.cogs, soap.gross_profit, soap.margin_pct], [17, 1, 1, 1650, 1020, 630, 38.2]);
  assert.deepEqual([oil.sales, oil.returns, oil.net_sales, oil.cogs, oil.gross_profit, oil.margin_pct], [2600, 400, 2200, 1650, 550, 25]);
  assert.deepEqual(d.by_category.map((c) => [c.category, c.net_sales, c.gross_profit]), [['Grocery', 2200, 550], ['FMCG', 1650, 630]]);
  assert.deepEqual(d.purchases, { gross: 3000, returns: 150, net: 2850 });
  // opening: Soap 30 @ 60; closing: Soap 13 @ 60 = 780 + Oil 8 @ 150 = 1,200
  assert.deepEqual(d.stock, { opening: 1800, closing: 1980, used: 2670, other: 0 });
  assert.match(d.note, /not your net profit/);
  assert.deepEqual(d.funnel_sales.orders, 0);
  // a period before the bills: only opening stock
  const early = await get(B, `${R}/pnl?from=${day(-25)}&to=${day(-20)}`);
  assert.deepEqual([early.sales.net, early.cogs, early.stock.opening, early.stock.closing], [0, 0, 0, 1800]);
  assert.equal((await api(`${R}/pnl?from=${day(0)}&to=${day(-1)}`, 'GET', null, B.token)).status, 400);
  const c = await csv(B, `${R}/pnl?from=${day(-20)}&to=${day(0)}`);
  assert.match(c.text, /\r\nGross profit,1180,/);
  assert.match(c.text, /\r\nSoap,1650,1020,630,38\.2,17,1\r\n/);
  assert.match(c.text, /not net profit/);
});

test('party ledger: bills, a stock sale, a cash bill and its payment, a credit bill marked paid — running balance', async () => {
  await booksB();
  const p = (await get(B, `${R}/parties`)).parties;
  assert.deepEqual(p.map((x) => x.name), ['Gupta Traders', 'Sharma Stores']);
  const d = await get(B, `${R}/ledger?party=${encodeURIComponent('sharma stores')}`);
  assert.deepEqual(d.entries.map((e) => [e.day, e.type, e.debit, e.credit, e.balance]), [
    [day(-8), 'Counter bill', 236, 0, 236],
    [day(-5), 'Stock sale', 450, 0, 686],
    [day(-3), 'Counter bill', 210, 0, 896],
    [day(-3), 'Payment (at the counter)', 0, 210, 686],
    [day(0), 'Payment received (marked paid)', 0, 236, 450],
  ]);
  assert.deepEqual([d.closing, d.closing_side, d.totals.debit, d.totals.credit], [450, 'Dr', 896, 446]);
  assert.match(d.meaning, /Sharma Stores owes you ₹450/);
  // from a date: what came before is the opening balance
  const late = await get(B, `${R}/ledger?party=Sharma%20Stores&from=${day(-6)}`);
  assert.deepEqual([late.opening, late.entries.length, late.entries[0].balance, late.closing], [236, 4, 686, 450]);
  // a supplier: purchases are what the seller owes (Cr), a return to them comes off it
  const g = await get(B, `${R}/ledger?party=Gupta%20Traders`);
  assert.deepEqual(g.entries.map((e) => [e.type, e.debit, e.credit, e.balance]), [['Stock purchase', 0, 3000, -3000], ['Return to party', 150, 0, -2850]]);
  assert.deepEqual([g.closing, g.closing_side], [-2850, 'Cr']);
  assert.equal((await get(B, `${R}/ledger?party=Nobody`)).found, false);
  assert.equal((await api(`${R}/ledger`, 'GET', null, B.token)).status, 400);
  const c = await csv(B, `${R}/ledger?party=Sharma%20Stores&from=${day(-6)}`);
  assert.match(c.disposition, /ledger-sharma-stores\.csv/);
  const lines = c.text.replace(/^﻿/, '').trim().split('\r\n');
  assert.equal(lines[0], 'Date,Type,Number,Details,Debit (₹),Credit (₹),Balance');
  assert.equal(lines[1], `${day(-6)},Opening balance,,,,,236 Dr`);
  assert.equal(lines.at(-1), ',Total,,,660,446,450 Dr');
});

test('sales and purchase registers, day book and the GST summary (CGST / SGST / IGST by rate, net of credit notes)', async () => {
  await booksB();
  const q = `from=${day(-20)}&to=${day(0)}`;
  const s = await get(B, `${R}/sales-register?${q}`);
  assert.deepEqual(s.rows.map((r) => [r.type, r.taxable, r.cgst, r.sgst, r.igst, r.total]), [
    ['Counter bill', 3400, 150, 150, 0, 3700],
    ['Counter bill', 200, 0, 0, 36, 236],
    ['Stock sale', 450, null, null, null, 450],
    ['Counter bill', 200, 5, 5, 0, 210],
    ['Credit note', -400, -10, -10, 0, -420],
  ]);
  assert.equal(s.rows[1].gstin, '29ABCDE1234F1Z5');
  assert.equal(s.rows[1].status, 'Credit · paid');
  assert.deepEqual(s.totals, { taxable: 3850, cgst: 145, sgst: 145, igst: 36, total: 4176 });

  const p = await get(B, `${R}/purchase-register?${q}`);
  assert.deepEqual(p.rows.map((r) => [r.type, r.party, r.ref, r.value, r.gst_est]), [['Purchase', 'Gupta Traders', 'GT-101', 3000, 150], ['Return to supplier', 'Gupta Traders', 'DN-1', -150, -7.5]]);
  assert.deepEqual(p.totals, { value: 2850, gst_est: 142.5, total_est: 2992.5 });

  const db = await get(B, `${R}/daybook?${q}`);
  assert.deepEqual(db.rows.map((r) => r.type), ['Purchase', 'Counter bill', 'Counter bill', 'Stock sale', 'Return out', 'Counter bill', 'Credit note']);
  assert.equal(db.rows[1].qty, 23, '10 soap + 1 free + 12 oil');

  const g = await get(B, `${R}/gst-summary?${q}`);
  assert.deepEqual(g.rows, [
    { rate: 5, sales_taxable: 2600, returns_taxable: 400, taxable: 2200, cgst: 55, sgst: 55, igst: 0, tax: 110 },
    { rate: 18, sales_taxable: 1200, returns_taxable: 0, taxable: 1200, cgst: 90, sgst: 90, igst: 36, tax: 216 },
  ]);
  assert.deepEqual(g.totals, { sales_taxable: 3800, returns_taxable: 400, taxable: 3400, cgst: 145, sgst: 145, igst: 36, tax: 326 });
  assert.equal(g.unbilled_sales, 1);
  assert.match(g.note, /1 stock sale recorded without a counter bill isn’t included/);

  // CSVs
  const gc = (await csv(B, `${R}/gst-summary?${q}`)).text.replace(/^﻿/, '').trim().split('\r\n');
  assert.deepEqual(gc, ['GST rate,Sales taxable (₹),Returns taxable (₹),Net taxable (₹),CGST,SGST,IGST,Total tax', '5%,2600,400,2200,55,55,0,110', '18%,1200,0,1200,90,90,36,216', 'Total,3800,400,3400,145,145,36,326']);
  const sc = (await csv(B, `${R}/sales-register?${q}`)).text;
  assert.match(sc, /,Credit note,CN\/\d{4}-\d{2}\/0001,,,.*,-400,-10,-10,0,-420,/);
  assert.match(sc, /\r\n,Total,,,,,3850,145,145,36,4176,\r\n$/);
  const pc = (await csv(B, `${R}/purchase-register?${q}`)).text;
  assert.match(pc, /Return to supplier,DN-1,Gupta Traders,Oil × 1 @ ₹150,1,-150,-7\.5,-157\.5/);
  const dc = (await csv(B, `${R}/daybook?${q}`)).text;
  assert.equal(dc.replace(/^﻿/, '').trim().split('\r\n').length, 8);
});

test('fast / slow / dead stock and reorder suggestions', async () => {
  const old = item(A, 'Old Stock', { purchase_rate: 20 });
  move(A, old, 'OPENING', 10, { rate: 20, day: day(-200) });
  const slow = item(A, 'Slow Mover');
  move(A, slow, 'OPENING', 100, { rate: 10, day: day(-100) });
  move(A, slow, 'SALE', 2, { rate: 15, day: day(-50) });
  const bolt = item(A, 'Bolt', { reorder_level: 50 });
  move(A, bolt, 'PURCHASE', 60, { rate: 2, day: day(-40), party_name: 'Iron Co' });
  move(A, bolt, 'SALE', 30, { rate: 3, day: day(-20) });
  const d = await get(A, `${R}/movement`);
  const by = Object.fromEntries(d.all.map((x) => [x.name, x]));
  // Rice: 15 sold in 30 days → 0.5 a day, 25 in stock → 50 days
  assert.deepEqual([by.Rice.sold30, by.Rice.perDay, by.Rice.daysLeft, by.Rice.reorder], [15, 0.5, 50, false]);
  assert.deepEqual(d.fast.map((x) => x.name), ['Rice'], 'the top fifth by value sold');
  // Bolt: 1 a day, 30 left (at / below its reorder level of 50) → 1 × (7 + 7) + 50 − 30 = 34
  assert.deepEqual([by.Bolt.perDay, by.Bolt.daysLeft, by.Bolt.reorder, by.Bolt.reorderQty, by.Bolt.supplier, by.Bolt.lastRate], [1, 30, true, 34, 'Iron Co', 2]);
  assert.deepEqual(d.reorder.map((x) => x.name), ['Bolt']);
  // Slow Mover: 2 in 90 days → 98 left lasts ~4,410 days
  assert.ok(d.slow.some((x) => x.name === 'Slow Mover' && x.daysLeft > 90 && x.value === 980));
  assert.ok(d.dead.some((x) => x.name === 'Old Stock' && x.value === 200));
  assert.ok(!d.dead.some((x) => x.name === 'Slow Mover' || x.name === 'Rice'));
  const c = (await csv(A, `${R}/movement`)).text;
  assert.match(c, /\r\nBolt,,pcs,30,60,30,30,1,30,\d{4}-\d{2}-\d{2},34,Iron Co,\r\n/);
  assert.match(c, /\r\nOld Stock,,pcs,10,200,0,0,0,,,,,Dead\r\n/);
});

test('another seller sees none of it', async () => {
  const C = await seller('c@rep.test');
  const v = await get(C, `${R}/valuation`);
  assert.deepEqual([v.items.length, v.totals.fifo], [0, 0]);
  assert.equal((await get(C, `${R}/ledger?party=Sharma%20Stores`)).found, false);
  assert.deepEqual((await get(C, `${R}/parties`)).parties, []);
  assert.equal((await api(`${R}/valuation?godownId=${(await get(A, '/inventory/items')).godowns[0].id}`, 'GET', null, C.token)).status, 404);
});

test('Hive: report tools read through the API and never wait for Confirm', async () => {
  await booksB();
  const { TOOLS, OK } = await import('../hive-inventory-reports.js');
  assert.deepEqual(OK, {});
  const tool = Object.fromEntries(TOOLS.map((t) => [t.name, t]));
  const ctx = (s) => ({ call: async (method, path, body) => { const r = await api(path, method, body, s.token); if (r.status >= 400) throw new Error(r.data.error); return r.data; } });
  assert.equal((await tool.inventory_stock_value.run(ctx(A), {})).totals.fifo, 3442); // 2,202 + Old Stock 200 + Slow Mover 980 + Bolt 30 × 2
  assert.equal((await tool.inventory_stock_value.run(ctx(A), { godown: 'shop' })).totals.fifo, 250);
  await assert.rejects(tool.inventory_stock_value.run(ctx(A), { godown: 'Roof' }), /No godown called “Roof”/);
  const pl = await tool.inventory_profit.run(ctx(B), { from: day(-20), to: day(0) });
  assert.equal(pl.gross_profit, 1180);
  assert.match(tool.inventory_profit.summary(pl), /Gross profit ₹1,180 on sales of ₹3,850/);
  const l = await tool.party_ledger.run(ctx(B), { party: 'Sharma Stores' });
  assert.equal(l.closing, 450);
  assert.deepEqual((await tool.party_ledger.run(ctx(B), { party: 'Sharma' })).similar, ['Sharma Stores']);
  assert.equal((await tool.inventory_register.run(ctx(B), { register: 'gst', from: day(-20) })).totals.tax, 326);
  assert.deepEqual((await tool.inventory_stock_speed.run(ctx(A), { search: 'bolt' })).items.map((x) => x.reorderQty), [34]);
  // wired into Hive: in the registry, the confirm list and the inventory tool group
  const hive = (await import('node:fs')).readFileSync(new URL('../hive.js', import.meta.url), 'utf8');
  assert.match(hive, /\.\.\.proTools\.TOOLS, \.\.\.reportTools\.TOOLS/);
  assert.match(hive, /inventory: \{[^\n]*tools: \[\.\.\.inventoryTools\.TOOLS, \.\.\.reportTools\.TOOLS\]/);
});
