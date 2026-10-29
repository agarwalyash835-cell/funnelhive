// Inventory (inventory.js): the add-on switch, items, godowns, stock moves (signs, no negative stock, transfers,
// per-godown stock, low stock, undo), CSV import with opening stock, and a bill photo's draft from a canned reading.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, register, enable2fa } from './helpers.mjs';

let srv, api, ADMIN, T, sellerId;
const inv = (path, method = 'GET', body) => api(`/inventory${path}`, method, body, T);
const items = async (qs = '') => (await inv(`/items${qs}`)).data;
const stockOf = async (id, qs = '') => (await items(qs)).items.find((i) => i.id === id)?.stock;

before(async () => {
  srv = await startServer({ ADMIN_EMAILS: 'owner@inv.test' });
  api = srv.api;
  ADMIN = (await register(api, 'owner@inv.test')).token;
  const link = srv.log().match(/To: owner@inv\.test[\s\S]*?\/verify\?token=([a-f0-9.]+)/);
  await api('/auth/verify', 'POST', { token: link[1] });
  ADMIN = (await enable2fa(api, ADMIN)).token;
  T = (await register(api, 'seller@inv.test')).token;
  sellerId = (await api('/me', 'GET', null, T)).data.id;
});
after(async () => { await srv?.stop(); });

test('Inventory is an add-on: refused until an admin switches it on', async () => {
  assert.equal((await inv('')).data.on, false);
  const r = await inv('/items');
  assert.equal(r.status, 403);
  assert.equal(r.data.code, 'INVENTORY_OFF');
  assert.equal((await inv('/items', 'POST', { name: 'Cement' })).data.code, 'INVENTORY_OFF');
  assert.equal((await api(`/admin/users/${sellerId}/action`, 'POST', { action: 'inventory_on' }, ADMIN)).status, 200);
  assert.equal((await inv('')).data.on, true);
  const d = await items();
  assert.deepEqual(d.items, []);
  assert.deepEqual(d.godowns.map((g) => g.name), ['Main']); // made on first use
});

let cement, tmt;
test('items: create, edit, search, barcode, deactivate', async () => {
  const r = await inv('/items', 'POST', { name: 'Cement OPC 53', unit: 'bag', sku: 'CEM-53', barcode: '8901234567890', category: 'Cement', hsn: '2523', gst_percent: 28, sale_rate: 420, purchase_rate: 380, reorder_level: 50 });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  cement = r.data;
  assert.equal(cement.stock, 0);
  assert.equal(cement.low, true);
  assert.equal((await inv('/items', 'POST', { name: 'cement opc 53' })).status, 409); // same name, any case
  assert.equal((await inv('/items', 'POST', { name: 'Other', sku: 'cem-53' })).status, 409);
  assert.equal((await inv('/items', 'POST', { name: '' })).status, 400);
  assert.equal((await inv('/items', 'POST', { name: 'Bad', sale_rate: 'abc' })).status, 400);
  tmt = (await inv('/items', 'POST', { name: 'TMT Bar 12mm', unit: 'pcs', purchase_rate: 650 })).data;
  assert.equal(tmt.unit, 'pcs');
  const e = await inv(`/items/${tmt.id}`, 'PUT', { reorder_level: 20, category: 'Steel' });
  assert.equal(e.data.reorder_level, 20);
  assert.equal(e.data.name, 'TMT Bar 12mm');
  assert.deepEqual((await items('?search=steel')).items.map((i) => i.name), ['TMT Bar 12mm']);
  assert.deepEqual((await items('?search=cem-53')).items.map((i) => i.name), ['Cement OPC 53']);
  assert.equal((await inv('/barcode/8901234567890')).data.item.id, cement.id);
  assert.equal((await inv('/barcode/000111')).status, 404);
  const tmp = (await inv('/items', 'POST', { name: 'Old stock' })).data;
  assert.equal((await inv(`/items/${tmp.id}`, 'DELETE')).status, 200);
  assert.ok(!(await items()).items.some((i) => i.id === tmp.id));
  assert.ok((await items('?all=1')).items.some((i) => i.id === tmp.id && i.active === false));
  assert.equal((await inv('/items', 'POST', { name: 'Old stock' })).status, 200); // the name is free again
});

test('moves carry the sign of their kind; stock never goes below zero unless forced', async () => {
  const p = await inv('/moves', 'POST', { itemId: cement.id, kind: 'PURCHASE', qty: -100, rate: 380, party_name: 'Gupta Traders' });
  assert.equal(p.status, 200, JSON.stringify(p.data));
  assert.equal(p.data.qty, 100); // a purchase is always in
  assert.equal(p.data.godown_name, 'Main');
  assert.equal((await inv('/moves', 'POST', { itemId: cement.id, kind: 'SALE', qty: 20, party_name: 'Sharma' })).data.qty, -20);
  assert.equal((await inv('/moves', 'POST', { itemId: cement.id, kind: 'RETURN_IN', qty: 2 })).data.qty, 2);
  assert.equal((await inv('/moves', 'POST', { itemId: cement.id, kind: 'RETURN_OUT', qty: 1 })).data.qty, -1);
  assert.equal((await inv('/moves', 'POST', { itemId: cement.id, kind: 'ADJUST', qty: -1, note: 'torn bag' })).data.qty, -1);
  assert.equal(await stockOf(cement.id), 80);
  assert.equal((await inv('/moves', 'POST', { itemId: cement.id, kind: 'TRANSFER_IN', qty: 5 })).status, 400); // transfers have their own route
  assert.equal((await inv('/moves', 'POST', { itemId: cement.id, kind: 'SALE', qty: 0 })).status, 400);
  const over = await inv('/moves', 'POST', { itemId: tmt.id, kind: 'SALE', qty: 5 });
  assert.equal(over.status, 409);
  assert.match(over.data.error, /Only 0/);
  assert.equal((await inv('/moves', 'POST', { itemId: tmt.id, kind: 'ADJUST', qty: -1 })).status, 409);
  assert.equal((await inv('/moves', 'POST', { itemId: tmt.id, kind: 'SALE', qty: 5, force: true })).data.qty, -5); // already went out in the real world
  assert.equal(await stockOf(tmt.id), -5);
  const h = (await inv(`/items/${cement.id}`)).data;
  assert.equal(h.item.stock, 80);
  assert.deepEqual(h.moves.map((m) => m.kind), ['ADJUST', 'RETURN_OUT', 'RETURN_IN', 'SALE', 'PURCHASE']);
  assert.equal(h.byGodown.find((g) => g.name === 'Main').qty, 80);
});

test('godowns, a transfer pair, stock per godown, and undo', async () => {
  const g = await inv('/godowns', 'POST', { name: 'Site Godown' });
  assert.equal(g.status, 200);
  assert.equal((await inv('/godowns', 'POST', { name: 'site godown' })).status, 409);
  assert.equal((await inv(`/godowns/${g.data.id}`, 'PUT', { name: 'Site Store' })).data.name, 'Site Store');
  assert.equal((await inv('/transfer', 'POST', { itemId: cement.id, from: 'Main', to: 'Site Store', qty: 500 })).status, 409); // not enough in Main
  assert.equal((await inv('/transfer', 'POST', { itemId: cement.id, from: 'Main', to: 'Main', qty: 1 })).status, 400);
  const t = await inv('/transfer', 'POST', { itemId: cement.id, from: 'Main', to: 'Site Store', qty: 30 });
  assert.equal(t.status, 200, JSON.stringify(t.data));
  assert.equal(t.data.out.kind, 'TRANSFER_OUT');
  assert.equal(t.data.out.qty, -30);
  assert.equal(t.data.in.kind, 'TRANSFER_IN');
  assert.equal(t.data.in.qty, 30);
  assert.equal(t.data.out.pair, t.data.in.pair);
  const main = (await items()).godowns.find((x) => x.name === 'Main');
  assert.equal(await stockOf(cement.id), 80); // overall unchanged
  assert.equal(await stockOf(cement.id, `?godownId=${main.id}`), 50);
  assert.equal(await stockOf(cement.id, `?godownId=${g.data.id}`), 30);
  const site = (await items()).godowns.find((x) => x.id === g.data.id);
  assert.equal(site.value, 30 * 380);
  // a sale from the site, then undoing the transfer would leave the site below zero
  await inv('/moves', 'POST', { itemId: cement.id, kind: 'SALE', qty: 25, godownId: g.data.id });
  assert.equal((await inv(`/moves/${t.data.in.id}`, 'DELETE')).status, 409);
  const sale = (await inv(`/moves?itemId=${cement.id}&kind=SALE`)).data.moves[0];
  assert.equal(sale.godown_name, 'Site Store');
  assert.equal((await inv(`/moves/${sale.id}`, 'DELETE')).status, 200);
  const u = await inv(`/moves/${t.data.out.id}`, 'DELETE');
  assert.equal(u.data.removed, 2); // both halves go
  assert.equal(await stockOf(cement.id, `?godownId=${main.id}`), 80);
  assert.equal(await stockOf(cement.id, `?godownId=${g.data.id}`), 0);
});

test('low stock: stock at or below the reorder level', async () => {
  await inv(`/items/${cement.id}`, 'PUT', { reorder_level: 80 });
  let low = (await inv('/low')).data.items.map((i) => i.name);
  assert.ok(low.includes('Cement OPC 53'));
  assert.ok(low.includes('TMT Bar 12mm')); // −5, reorder at 20
  await inv(`/items/${cement.id}`, 'PUT', { reorder_level: 79 });
  low = (await inv('/low')).data.items.map((i) => i.name);
  assert.ok(!low.includes('Cement OPC 53'));
  const s = (await items()).summary;
  assert.equal(s.value, 80 * 380); // TMT is below zero: counts nothing
  assert.ok(s.out >= 1);
});

test('CSV import: items with opening stock, quotes and godowns; a second import adds no opening twice', async () => {
  const csv = 'Item Name,Unit,SKU,HSN,GST %,Sale Rate,Purchase Rate,Reorder Level,Opening Stock,Godown\r\n'
    + '"Paint, White 20L",bucket,PNT-20,3209,18%,"2,450",2100,5,12,Site Store\r\n'
    + 'Wall Putty 40kg,bag,,3214,18,800,690,10,40,\r\n'
    + 'Cement OPC 53,bag,CEM-53,,,,,,10,\r\n' // already has stock in Main: details kept, opening skipped
    + ',bag,,,,,,,5,\r\n' // no name
    + 'Bad Rate,pcs,,,,abc,,,,\r\n';
  const r = await inv('/import', 'POST', { csv });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.created, 2);
  assert.equal(r.data.updated, 1);
  assert.equal(r.data.opening, 2);
  assert.equal(r.data.skipped.length, 3);
  assert.ok(r.data.skipped.some((s) => s.line === 4 && /opening stock not added/.test(s.error)));
  const d = await items();
  const paint = d.items.find((i) => i.name === 'Paint, White 20L');
  assert.equal(paint.stock, 12);
  assert.equal(paint.sale_rate, 2450);
  assert.equal(paint.gst_percent, 18);
  const site = d.godowns.find((g) => g.name === 'Site Store');
  assert.equal(await stockOf(paint.id, `?godownId=${site.id}`), 12);
  const hist = (await inv(`/items/${paint.id}`)).data.moves;
  assert.equal(hist[0].kind, 'OPENING');
  assert.equal(hist[0].source, 'IMPORT');
  const again = await inv('/import', 'POST', { csv: 'name,opening stock\nWall Putty 40kg,99\n' });
  assert.equal(again.data.updated, 1);
  assert.equal(again.data.opening, 0);
  assert.equal((await items()).items.find((i) => i.name === 'Wall Putty 40kg').stock, 40);
  assert.equal((await inv('/import', 'POST', { csv: 'colour,size\nred,10\n' })).status, 400); // no name column
});

test('a bill photo becomes a draft: lines matched to items, the rest left for the seller; saving is all or nothing', async () => {
  const bill = {
    invoice_number: 'GT/2026/118', date: '2026-10-20',
    seller: { name: 'Gupta Traders', gstin: '07ABCDE1234F1Z5' }, buyer: { name: 'Our Shop' },
    items: [
      { description: 'CEMENT OPC 53', quantity: '50', unit: 'bag', rate: null, amount: '19,000', tax_percent: 28 },
      { description: 'TMT Bar 12mm Fe500', quantity: 20, unit: 'pcs', rate: 640 },
      { description: 'Binding wire', quantity: 5, unit: 'kg', rate: 90 },
      { description: 'CGST', amount: 100 }, // the model shouldn't send these, but a description-only line still shows
    ],
    grand_total: 45000,
  };
  const r = await inv('/photo', 'POST', { kind: 'PURCHASE', bill });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const d = r.data;
  assert.equal(d.party_name, 'Gupta Traders'); // a purchase: who sold to you
  assert.equal(d.ref, 'GT/2026/118');
  assert.equal(d.day, '2026-10-20');
  const [c, t, w] = d.lines;
  assert.equal(c.itemId, cement.id);
  assert.equal(c.exact, true);
  assert.equal(c.qty, 50);
  assert.equal(c.rate, 380); // from amount ÷ quantity
  assert.equal(t.itemId, tmt.id); // the bill's name contains the item's
  assert.equal(t.exact, false);
  assert.equal(w.matched, false);
  assert.equal(w.itemId, null);
  assert.ok(d.unmatched >= 1);
  assert.equal((await inv('/photo', 'POST', { kind: 'SALE', bill })).data.party_name, 'Our Shop'); // a sale: who you sold to
  // saving with an unmatched line is refused and nothing is saved
  const before = await stockOf(cement.id);
  const bad = await inv('/moves/batch', 'POST', { kind: 'PURCHASE', source: 'PHOTO', ref: d.ref, party_name: d.party_name, lines: [{ itemId: c.itemId, qty: 50, rate: 380 }, { item: 'Binding wire', qty: 5 }] });
  assert.equal(bad.status, 422);
  assert.equal(bad.data.unmatched[0].item, 'Binding wire');
  assert.equal(await stockOf(cement.id), before);
  // the seller maps one and creates the other
  const ok = await inv('/moves/batch', 'POST', { kind: 'PURCHASE', source: 'PHOTO', ref: d.ref, party_name: d.party_name, day: d.day, lines: [{ itemId: c.itemId, qty: 50, rate: 380 }, { itemId: t.itemId, qty: 20, rate: 640 }, { newItem: { name: 'Binding Wire', unit: 'kg' }, qty: 5, rate: 90 }] });
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  assert.equal(ok.data.moves.length, 3);
  assert.equal(await stockOf(cement.id), before + 50);
  const wire = (await items()).items.find((i) => i.name === 'Binding Wire');
  assert.equal(wire.stock, 5);
  assert.equal(wire.purchase_rate, 90);
  const m = (await inv(`/moves?itemId=${wire.id}`)).data.moves[0];
  assert.equal(m.source, 'PHOTO');
  assert.equal(m.ref, 'GT/2026/118');
  // the same bill again is flagged
  assert.ok((await inv('/photo', 'POST', { kind: 'PURCHASE', bill })).data.duplicate);
  // a sale by item names (what Hive sends): one line short of stock fails the whole bill
  const sale = await inv('/moves/batch', 'POST', { kind: 'SALE', source: 'HIVE', party_name: 'Sharma', lines: [{ item: 'cement opc 53', qty: 20 }, { item: 'Binding Wire', qty: 50 }] });
  assert.equal(sale.status, 409);
  assert.match(sale.data.error, /Binding Wire/);
  assert.equal(await stockOf(cement.id), before + 50);
  assert.equal((await inv('/photo', 'POST', { kind: 'PURCHASE', image: 'not a photo' })).status, 400);
});

test('another seller sees none of it', async () => {
  const other = (await register(api, 'other@inv.test')).token;
  const oid = (await api('/me', 'GET', null, other)).data.id;
  await api(`/admin/users/${oid}/action`, 'POST', { action: 'inventory_on' }, ADMIN);
  assert.deepEqual((await api('/inventory/items', 'GET', null, other)).data.items, []);
  assert.equal((await api(`/inventory/items/${cement.id}`, 'GET', null, other)).status, 404);
  assert.equal((await api('/inventory/moves', 'POST', { itemId: cement.id, kind: 'PURCHASE', qty: 1 }, other)).status, 404);
});

test('Hive: plain-language entries become stock_entry calls that wait for Confirm, and save through the API', async () => {
  const { TOOLS, OK } = await import('../hive-inventory.js');
  const tool = Object.fromEntries(TOOLS.map((t) => [t.name, t]));
  for (const n of Object.keys(OK)) assert.ok(tool[n], n); // every confirm belongs to a tool
  assert.ok(!OK.find_stock && !OK.inventory_overview); // reads don't wait
  const ctx = { call: async (method, path, body) => { const r = await api(path, method, body, T); if (r.status >= 400) throw new Error(r.data.error); return r.data; } };
  // "sold 20 bags of cement to Sharma"
  const args = { kind: 'SALE', party_name: 'Sharma', lines: [{ item: 'Cement OPC 53', qty: 20 }] };
  assert.match(OK.stock_entry(args), /Stock out \(sale\) — Sharma: 20 Cement OPC 53/);
  const before = await stockOf(cement.id);
  assert.equal((await tool.stock_entry.run(ctx, args)).saved, 1);
  assert.equal(await stockOf(cement.id), before - 20);
  assert.equal((await inv(`/moves?itemId=${cement.id}`)).data.moves[0].source, 'HIVE');
  // "received 100 TMT bars from Gupta": two items could fit, so nothing is guessed — Hive gets the choices
  await inv('/items', 'POST', { name: 'TMT Bar 16mm', unit: 'pcs' });
  await assert.rejects(tool.stock_entry.run(ctx, { kind: 'PURCHASE', party_name: 'Gupta', lines: [{ item: 'TMT bars', qty: 100 }] }), /did you mean TMT Bar/);
  assert.equal((await tool.find_stock.run(ctx, { search: 'tmt' })).total, 2);
  assert.ok((await tool.inventory_overview.run(ctx)).summary.items >= 5);
});

// seen live: Hive made “Paracetamol 500 strip” next to “Paracetamol 500”, splitting stock and schemes across two items
test('Hive won’t create a near-twin of an existing item unless the seller says it’s different', async () => {
  const { TOOLS } = await import('../hive-inventory.js');
  const tool = Object.fromEntries(TOOLS.map((t) => [t.name, t]));
  const ctx = { call: async (method, path, body) => { const r = await api(path, method, body, T); if (r.status >= 400) throw new Error(r.data.error); return r.data; } };
  await tool.inventory_item.run(ctx, { name: 'Paracetamol 500', unit: 'Strip' });
  await assert.rejects(tool.inventory_item.run(ctx, { name: 'Paracetamol 500 strip', unit: 'Strip' }), /Similar item already in Inventory: Paracetamol 500/);
  await assert.rejects(tool.inventory_item.run(ctx, { name: 'paracetamol-500' }), /Similar item/);
  assert.equal((await tool.inventory_item.run(ctx, { name: 'Paracetamol 500 syrup', unit: 'Bottle', different_item: true })).name, 'Paracetamol 500 syrup');
  assert.equal((await tool.inventory_item.run(ctx, { name: 'Paracetamol 650', unit: 'Strip' })).name, 'Paracetamol 650', 'a different strength isn’t a twin');
});
