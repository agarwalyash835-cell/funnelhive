// Stock insights on the Tally mirror (tally-insights.js): sales speed, days of stock left, reorder quantities, fast /
// slow / dead stock, each item's last supplier, purchase-order drafts per supplier, and the add-on gate.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, register, enable2fa } from './helpers.mjs';
import { TOOLS } from '../hive-tally-insights.js';

let srv, api, ADMIN, T, AG;
const A = '/v1/agent/tally';
const agent = (path, method = 'GET', body) => api(`${A}${path}`, method, body, AG);
const ago = (n) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date(Date.now() - n * 864e5));
const COMPANY = { tally_guid: 'ci-guid-1', name: 'Sharma Hardware', financial_year_from: '2026-04-01', financial_year_to: '2027-03-31' };
let vn = 0;
const voucher = (type, days, party, lines, extra = {}) => ({ tally_guid: `vi-${++vn}`, voucher_number: String(vn), voucher_type: type, voucher_date: ago(days), party_name: party, amount: lines.reduce((s, [, q, r]) => s + q * r, 0),
  inventory_entries: lines.map(([name, q, rate]) => ({ stock_item_name: name, actual_qty: type === 'Sales' ? -q : q, billed_qty: q, rate, amount: q * rate })), ...extra });

before(async () => {
  srv = await startServer({ ADMIN_EMAILS: 'owner@insights.test' });
  api = srv.api;
  ADMIN = (await register(api, 'owner@insights.test')).token;
  const link = srv.log().match(/To: owner@insights\.test[\s\S]*?\/verify\?token=([a-f0-9.]+)/);
  await api('/auth/verify', 'POST', { token: link[1] });
  ADMIN = (await enable2fa(api, ADMIN)).token;
  T = (await register(api, 'seller@insights.test')).token;
  const sellerId = (await api('/me', 'GET', null, T)).data.id;
  assert.equal((await api('/tally/insights', 'GET', null, T)).data.code, 'TALLY_OFF', 'off until the add-on is on');
  await api(`/admin/users/${sellerId}/action`, 'POST', { action: 'tally_on' }, ADMIN);
  const { code } = (await api('/tally/connect-code', 'POST', {}, T)).data;
  AG = (await api(`${A}/activate`, 'POST', { license_key: code, machine_fingerprint: 'machine-fp-ins1', machine_name: 'SHOP-PC', app_version: '1.1.2' })).data.agent_token;
  await agent('/heartbeat', 'POST', { tally_status: 'ONLINE', company_name: COMPANY.name, company_guid: COMPANY.tally_guid, app_version: '1.1.2' });
  await agent('/sync/companies', 'POST', { records: [COMPANY] });
  const g = COMPANY.tally_guid;
  await agent('/sync/ledgers', 'POST', { company_guid: g, records: [
    { name: 'Gupta Suppliers', parent: 'Sundry Creditors', phone: '98765 43210, 0141-2345678' },
    { name: 'Mehta Traders', parent: 'Sundry Creditors' },
    { name: 'Ravi Stores', parent: 'Sundry Debtors' },
  ] });
  await agent('/sync/stock-items', 'POST', { company_guid: g, records: [
    { name: 'Steel Rod 12mm', base_units: 'Nos', closing_balance: 10, closing_value: 3000, last_purchase_rate: 290 },
    { name: 'Cement Bag', base_units: 'Bags', closing_balance: 0, closing_value: 0 },
    { name: 'Paint 1L', base_units: 'Nos', closing_balance: 500, closing_value: 50000 },
    { name: 'Old Tiles', base_units: 'Box', closing_balance: 40, closing_value: 12000 },
    { name: 'Wire Roll', base_units: 'Nos', closing_balance: 100, closing_value: 5000 },
  ] });
  const r = await agent('/sync/vouchers', 'POST', { company_guid: g, records: [
    // Steel: 70 sold in the last 30 days, 10 back on a credit note → 60 a month (2 a day); 30 more 60 days ago
    voucher('Sales', 5, 'Ravi Stores', [['Steel Rod 12mm', 40, 300], ['Paint 1L', 10, 150]]),
    voucher('Sales', 10, 'Ravi Stores', [['Steel Rod 12mm', 30, 300]]),
    voucher('Credit Note', 8, 'Ravi Stores', [['Steel Rod 12mm', 10, 300]]),
    voucher('Sales', 60, 'Ravi Stores', [['Steel Rod 12mm', 30, 300]]),
    voucher('Sales', 45, 'Ravi Stores', [['Cement Bag', 9, 400]]),
    voucher('Sales', 120, 'Ravi Stores', [['Old Tiles', 5, 300]]),
    // not sales: a cancelled invoice and an order move no stock
    voucher('Sales', 3, 'Ravi Stores', [['Paint 1L', 400, 150]], { is_cancelled: true }),
    voucher('Sales Order', 3, 'Ravi Stores', [['Old Tiles', 50, 300]]),
    // the latest purchase names the supplier: Gupta for Steel (Mehta's was older), Mehta for Cement
    voucher('Purchase', 70, 'Mehta Traders', [['Steel Rod 12mm', 100, 280]]),
    voucher('Purchase', 20, 'Gupta Suppliers', [['Steel Rod 12mm', 50, 300], ['Paint 1L', 500, 100]]),
    voucher('Purchase', 100, 'Mehta Traders', [['Cement Bag', 50, 350]]),
  ] });
  assert.equal(r.status, 200, JSON.stringify(r.data));
});
after(async () => { await srv?.stop(); });

test('speed, days of stock left and the reorder quantity', async () => {
  const d = (await api('/tally/insights', 'GET', null, T)).data;
  assert.equal(d.company.name, COMPANY.name);
  assert.deepEqual([d.leadDays, d.safetyDays], [7, 7]);
  const steel = d.reorder.find((x) => x.name === 'Steel Rod 12mm');
  assert.deepEqual([steel.sold30, steel.sold90, steel.perDay], [60, 90, 2], 'credit notes come off; the busier of 30 and 90 days sets the speed');
  assert.equal(steel.daysLeft, 5, '10 in stock at 2 a day');
  assert.equal(steel.reorderQty, 18, '2 a day × (7 + 7 days) − 10 on hand');
  const cement = d.reorder.find((x) => x.name === 'Cement Bag');
  assert.deepEqual([cement.daysLeft, cement.perDay, cement.reorderQty], [0, 0.1, 2], 'out of stock while it sold recently → reorder now');
  assert.deepEqual(d.reorder.map((x) => x.name), ['Cement Bag', 'Steel Rod 12mm'], 'fewest days left first');
  const item = (await api('/tally/insights?search=paint', 'GET', null, T)).data.items;
  assert.equal(item.length, 1);
  assert.deepEqual([item[0].sold30, item[0].reorderQty], [10, 0], 'a cancelled invoice and a sales order don’t count');
});

test('fast, slow and dead stock with the money stuck in it', async () => {
  const d = (await api('/tally/insights', 'GET', null, T)).data;
  assert.deepEqual(d.fast.map((x) => x.name), ['Steel Rod 12mm'], 'the top fifth by sales value');
  assert.deepEqual(d.slow.map((x) => x.name), ['Paint 1L'], '500 in stock at a third a day is years of stock');
  assert.deepEqual(d.dead.map((x) => x.name), ['Old Tiles', 'Wire Roll'], 'in stock, no sale in 90 days; biggest money first');
  assert.equal(d.deadValue, 17000);
  assert.deepEqual(d.counts, { items: 5, reorder: 2, fast: 1, slow: 1, dead: 2 });
});

test('last supplier and rate come from the latest purchase', async () => {
  const d = (await api('/tally/insights', 'GET', null, T)).data;
  const steel = d.reorder.find((x) => x.name === 'Steel Rod 12mm'), cement = d.reorder.find((x) => x.name === 'Cement Bag');
  assert.deepEqual([steel.supplier, steel.lastRate, steel.lastPurchased], ['Gupta Suppliers', 300, ago(20)]);
  assert.deepEqual([cement.supplier, cement.lastRate], ['Mehta Traders', 350]);
  assert.equal(d.dead.find((x) => x.name === 'Wire Roll').supplier, null, 'never bought in Tally');
});

test('purchase-order drafts, grouped by supplier, with a WhatsApp link only when there is a mobile', async () => {
  const d = (await api('/tally/insights/purchase-orders', 'GET', null, T)).data;
  assert.deepEqual(d.orders.map((o) => o.supplier), ['Gupta Suppliers', 'Mehta Traders']);
  const [gupta, mehta] = d.orders;
  assert.deepEqual(gupta.items.map((i) => [i.name, i.qty, i.lastRate, i.urgent]), [['Steel Rod 12mm', 18, 300, true]]);
  assert.equal(gupta.approxTotal, 5400);
  assert.match(gupta.message, /Namaste Gupta Suppliers/);
  assert.match(gupta.message, /Steel Rod 12mm — 18 Nos \(last rate ₹300\)/);
  assert.match(gupta.message, /Sharma Hardware$/);
  assert.equal(gupta.phone, '919876543210', 'the first mobile in Tally’s phone field');
  assert.equal(gupta.whatsapp, `https://wa.me/919876543210?text=${encodeURIComponent(gupta.message)}`);
  assert.deepEqual([mehta.items[0].name, mehta.items[0].qty, mehta.whatsapp], ['Cement Bag', 2, null], 'no phone on the ledger → no link');
  const one = (await api('/tally/insights/purchase-orders?supplier=gupta', 'GET', null, T)).data;
  assert.deepEqual(one.orders.map((o) => o.supplier), ['Gupta Suppliers']);
  assert.match((await api('/tally/insights/purchase-orders?supplier=Nobody%20Co', 'GET', null, T)).data.note, /No purchase from a supplier named/);
});

test('Hive tools read the same figures and never send anything', async () => {
  const ctx = { call: async (method, path) => { const r = await api(path, method, null, T); if (r.status !== 200) throw new Error(r.data.error); return r.data; } };
  const tool = (n) => TOOLS.find((t) => t.name === n);
  const ins = await tool('tally_stock_insights').run(ctx, { focus: 'reorder' });
  assert.deepEqual(ins.reorderNow.map((x) => [x.item, x.orderQty]), [['Cement Bag', '2 Bags'], ['Steel Rod 12mm', '18 Nos']]);
  assert.equal(ins.deadStock, undefined, 'focus picks one list');
  assert.equal((await tool('tally_stock_insights').run(ctx, { focus: 'dead' })).moneyStuckInDeadStock, '₹17,000');
  const po = await tool('tally_purchase_orders').run(ctx, { supplier: 'Gupta Suppliers' });
  assert.equal(po.orders.length, 1);
  assert.ok(po.orders[0].whatsappLink.startsWith('https://wa.me/919876543210?text='));
});

test('another seller without the add-on is refused', async () => {
  const other = (await register(api, 'other@insights.test')).token;
  for (const p of ['/tally/insights', '/tally/insights/purchase-orders']) {
    const r = await api(p, 'GET', null, other);
    assert.deepEqual([r.status, r.data.code], [403, 'TALLY_OFF']);
  }
});
