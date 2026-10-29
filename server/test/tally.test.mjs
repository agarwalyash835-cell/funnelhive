// Tally (tally.js): the connector's contract (activate with a one-time code, heartbeat, uploads in batches with
// reconcile, the command queue and its results) and the seller's side (the add-on switch, the mirror, writes that wait
// for a connected PC, pre-checks, what a confirmed delete / create does to the mirror).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, register, enable2fa } from './helpers.mjs';

let srv, api, ADMIN, T, sellerId, AG, agentId;
const A = '/v1/agent/tally';
const agent = (path, method = 'GET', body) => api(`${A}${path}`, method, body, AG);
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
const COMPANY = { tally_guid: 'c-guid-1', name: 'Sharma Traders', financial_year_from: '2026-04-01', financial_year_to: '2026-10-02' };

before(async () => {
  srv = await startServer({ ADMIN_EMAILS: 'owner@tally.test' });
  api = srv.api;
  ADMIN = (await register(api, 'owner@tally.test')).token;
  const link = srv.log().match(/To: owner@tally\.test[\s\S]*?\/verify\?token=([a-f0-9.]+)/);
  await api('/auth/verify', 'POST', { token: link[1] });
  ADMIN = (await enable2fa(api, ADMIN)).token;
  T = (await register(api, 'seller@tally.test')).token;
  sellerId = (await api('/me', 'GET', null, T)).data.id;
});
after(async () => { await srv?.stop(); });

test('Tally is an add-on: off until an admin switches it on', async () => {
  assert.equal((await api('/tally', 'GET', null, T)).data.on, false);
  assert.equal((await api('/tally/summary', 'GET', null, T)).data.code, 'TALLY_OFF');
  assert.equal((await api('/tally/connect-code', 'POST', {}, T)).status, 403);
  assert.equal((await api(`/admin/users/${sellerId}/action`, 'POST', { action: 'tally_on' }, ADMIN)).status, 200);
  const s = (await api('/tally', 'GET', null, T)).data;
  assert.equal(s.on, true);
  assert.equal(s.download, null, 'no installer published on this server yet');
  assert.equal((await fetch(`${srv.base}/downloads/funnelhive-tally-connector-setup.exe`)).status, 404);
  assert.ok(s.groups.includes('Sundry Debtors'));
});

test('connecting a PC: a one-time code is traded for a token; the code works once', async () => {
  const { code } = (await api('/tally/connect-code', 'POST', {}, T)).data;
  assert.match(code, /^FH-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$/);
  const body = { license_key: code, machine_fingerprint: 'machine-fp-0001', machine_name: 'ACCOUNTS-PC', app_version: '1.0.1', tally_host: '127.0.0.1', tally_port: 9000 };
  assert.equal((await api(`${A}/activate`, 'POST', { ...body, license_key: 'FH-0000-0000-0000' })).status, 400);
  const r = await api(`${A}/activate`, 'POST', body);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.ok(r.data.agent_token.startsWith('fht_') && r.data.agent_id);
  assert.deepEqual([r.data.poll_interval_seconds, r.data.live_sync_enabled, r.data.full_reconcile_interval_minutes], [5, true, 360]);
  AG = r.data.agent_token; agentId = r.data.agent_id;
  assert.equal((await api(`${A}/activate`, 'POST', body)).status, 400, 'a code is used once');
  // the connector's routes never take a seller session, and a seller's routes never take a connector token
  assert.equal((await api(`${A}/commands/pending`, 'GET', null, T)).status, 401);
  assert.equal((await api('/tally/summary', 'GET', null, AG)).status, 401);
});

test('heartbeat: status, the open company, intervals pushed back', async () => {
  const r = await agent('/heartbeat', 'POST', { agent_id: agentId, tally_status: 'ONLINE', company_loaded: true, company_name: COMPANY.name, company_guid: COMPANY.tally_guid, tally_version: 'TallyPrime 5.1', app_version: '1.0.1' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.intervals.poll_interval_seconds, 5);
  assert.equal(r.data.agent.tally_status, 'ONLINE');
  assert.equal((await agent('/heartbeat', 'POST', { agent_id: 'someone-else', tally_status: 'ONLINE' })).status, 403);
});

test('sync: companies, ledgers, stock, vouchers with lines / bills / stock lines, outstanding bills', async () => {
  assert.equal((await agent('/sync/ledgers', 'POST', { company_guid: 'nope', records: [{ name: 'X' }] })).status, 404, 'companies come first');
  assert.equal((await agent('/sync/companies', 'POST', { records: [COMPANY] })).data.records_created, 1);
  const led = await agent('/sync/ledgers', 'POST', { company_guid: COMPANY.tally_guid, reconcile: true, records: [
    { tally_guid: 'l-1', name: 'Gupta Hardware', parent: 'Sundry Debtors', ledger_group: 'Sundry Debtors', closing_balance: -45000, email: 'gupta@hw.in', phone: '9876543210', address: ['12 MG Road', 'Jaipur'] },
    { tally_guid: 'l-2', name: 'Sales Account', parent: 'Sales Accounts' },
    { tally_guid: 'l-3', name: 'Cash', parent: 'Cash-in-Hand' },
    { tally_guid: 'l-4', name: 'Old Party', parent: 'Sundry Debtors' },
  ] });
  assert.equal(led.data.records_created, 4, JSON.stringify(led.data));
  assert.ok(led.data.reconcile_before, 'the watermark for a multi-batch run');
  await agent('/sync/units', 'POST', { company_guid: COMPANY.tally_guid, reconcile: true, records: [{ tally_guid: 'u-1', name: 'Nos' }] });
  await agent('/sync/godowns', 'POST', { company_guid: COMPANY.tally_guid, reconcile: true, records: [{ name: 'Main Location', parent: '&#4; Primary' }, { name: 'Warehouse' }] });
  await agent('/sync/stock-items', 'POST', { company_guid: COMPANY.tally_guid, reconcile: true, records: [{ tally_guid: 's-1', name: 'Steel Rod 12mm', base_units: 'Nos', closing_balance: 270, closing_value: 81000 }] });
  const v = await agent('/sync/vouchers', 'POST', { company_guid: COMPANY.tally_guid, reconcile: true, records: [{
    tally_guid: 'v-1', voucher_number: '1', voucher_type: 'Sales', voucher_date: '2026-08-10', party_name: 'Gupta Hardware', amount: -45000,
    ledger_entries: [{ ledger_name: 'Gupta Hardware', amount: -45000, is_party_ledger: true, bill_allocations: [{ bill_name: 'INV-1', bill_type: 'New Ref', amount: -45000 }] }, { ledger_name: 'Sales Account', amount: 45000 }, { ledger_name: 'Unknown Ledger', amount: null }],
    inventory_entries: [{ stock_item_name: 'Steel Rod 12mm', actual_qty: 150, billed_qty: 150, rate: 300, amount: 45000, godown_name: 'Main Location' }],
  }] });
  assert.equal(v.data.records_created, 1);
  const o = await agent('/sync/outstandings', 'POST', { company_guid: COMPANY.tally_guid, reconcile: true, records: [
    { party_name: 'Gupta Hardware', bill_number: 'INV-1', bill_date: '2026-08-10', due_date: '2026-09-09', amount: -45000, pending_amount: -45000, bill_type: 'RECEIVABLE', status: 'PENDING' },
    { party_name: 'Steel Supplier', bill_number: 'P-77', due_date: '2099-01-01', amount: 20000, pending_amount: 20000, bill_type: 'PAYABLE' },
  ] });
  assert.equal(o.data.records_created, 2);

  const s = (await api('/tally/summary', 'GET', null, T)).data;
  assert.equal(s.company.name, 'Sharma Traders', 'the open company became the working company');
  assert.deepEqual([s.receivable.total, s.receivable.overdue, s.payable.total], [45000, 45000, 20000], 'amounts are magnitudes; past-due bills are overdue');
  assert.deepEqual(s.topDebtors[0], { name: 'Gupta Hardware', amount: 45000 });
  assert.equal(s.stock.value, 81000);
  const vouchers = (await api('/tally/vouchers', 'GET', null, T)).data;
  assert.equal(vouchers.total, 1);
  assert.equal(vouchers.items[0].status, 'DUE', 'a voucher with an overdue bill is DUE');
  const vd = (await api(`/tally/vouchers/${vouchers.items[0].id}`, 'GET', null, T)).data;
  assert.equal(vd.amount, 45000);
  assert.deepEqual(vd.lines.map((l) => l.ledger_name), ['Gupta Hardware', 'Sales Account'], 'placeholder lines are dropped');
  assert.equal(vd.items[0].godown_name, 'Main Location');
  assert.equal(vd.outstandings[0].bill_number, 'INV-1', 'the bill is linked to the voucher that raised it');
  const godowns = (await api('/tally/godowns', 'GET', null, T)).data.items;
  assert.equal(godowns.find((g) => g.name === 'Main Location').parent, 'Primary', 'Tally’s &#4; is cleaned');
  const ledgers = (await api('/tally/ledgers?search=gupta', 'GET', null, T)).data;
  assert.equal(ledgers.total, 1);
  assert.equal(ledgers.items[0].address, '12 MG Road, Jaipur');
  const ld = (await api(`/tally/ledgers/${ledgers.items[0].id}`, 'GET', null, T)).data;
  assert.equal(ld.vouchers.length, 1);
  assert.equal(ld.outstandings.length, 1);
  const stock = (await api('/tally/stock', 'GET', null, T)).data.items[0];
  assert.equal((await api(`/tally/stock/${stock.id}`, 'GET', null, T)).data.movements[0].lines[0].actual_qty, 150);
  assert.equal((await api('/tally/outstandings?bill_type=PAYABLE', 'GET', null, T)).data.items[0].party_name, 'Steel Supplier');
});

test('customer and supplier ledgers with a phone or email become CRM contacts (never banks or sales accounts)', async () => {
  const c = (await api(`/contacts/${encodeURIComponent('gupta@hw.in')}`, 'GET', null, T)).data;
  assert.equal(c.name, 'Gupta Hardware');
  assert.ok((c.tags || []).includes('tally-customer'), JSON.stringify(c.tags));
  assert.match(JSON.stringify(c.timeline), /Linked to the Tally ledger Gupta Hardware/);
  const all = (await api('/contacts', 'GET', null, T)).data;
  const list = Array.isArray(all) ? all : all.contacts || all.items || [];
  assert.ok(!list.some((x) => /Sales Account|Cash/.test(x.name || '')), 'only parties');
});

test('payment reminders: settings, a reminder for a bill owed to you (never for one you owe or one that’s paid)', async () => {
  const s = (await api('/tally/settings', 'GET', null, T)).data;
  assert.deepEqual([s.contacts, s.reminders.on, s.reminders.channel], [true, false, 'both'], 'automatic reminders start off');
  const saved = (await api('/tally/settings', 'PUT', { reminders: { on: true, afterDays: 3, everyDays: 0, channel: 'email' }, payNote: 'UPI: sharma@okhdfc' }, T)).data;
  assert.deepEqual([saved.reminders.on, saved.reminders.afterDays, saved.reminders.everyDays, saved.payNote], [true, 3, 1, 'UPI: sharma@okhdfc'], 'every day at most');
  const bills = (await api('/tally/outstandings', 'GET', null, T)).data.items;
  const owed = bills.find((b) => b.bill_type === 'RECEIVABLE'), owing = bills.find((b) => b.bill_type === 'PAYABLE');
  assert.match((await api(`/tally/outstandings/${owing.id}/remind`, 'POST', {}, T)).data.error, /money owed to you/);
  const r = (await api(`/tally/outstandings/${owed.id}/remind`, 'POST', { channel: 'both' }, T)).data;
  assert.equal(r.email, 'not-configured', 'reported as it is — no email provider on this test server');
  assert.ok(['off', 'no-phone'].includes(r.whatsapp), JSON.stringify(r));
  assert.equal((await api('/tally/settings', 'PUT', { reminders: { on: false } }, T)).data.reminders.on, false);
});

test('reconcile: a ledger deleted in Tally leaves the list; multi-batch runs use the watermark; empty exports change nothing', async () => {
  const first = await agent('/sync/ledgers', 'POST', { company_guid: COMPANY.tally_guid, reconcile: false, records: [{ tally_guid: 'l-1', name: 'Gupta Hardware', parent: 'Sundry Debtors' }, { tally_guid: 'l-2', name: 'Sales Account' }] });
  await agent('/sync/ledgers', 'POST', { company_guid: COMPANY.tally_guid, reconcile: true, reconcile_before: first.data.reconcile_before, records: [{ tally_guid: 'l-3', name: 'Cash', parent: 'Cash-in-Hand' }] });
  const names = (await api('/tally/ledgers', 'GET', null, T)).data.items.map((l) => l.name);
  assert.deepEqual(names.sort(), ['Cash', 'Gupta Hardware', 'Sales Account'], 'Old Party was not in the export');
  await agent('/sync/units', 'POST', { company_guid: COMPANY.tally_guid, reconcile: true, records: [] });
  assert.equal((await api('/tally/units', 'GET', null, T)).data.total, 1, 'an empty export never wipes the mirror');
});

test('writes: queued for the PC; pre-checks for the books and stock; the result updates the mirror', async () => {
  const post = (type, payload) => api('/tally/commands', 'POST', { type, payload }, T);
  assert.match((await post('CREATE_VOUCHER', { voucher_type: 'Sales', party_name: 'Gupta Hardware' })).data.error, /amount/);
  assert.match((await post('CREATE_VOUCHER', { voucher_type: 'Sales', party_name: 'Gupta Hardware', amount: 1000, date: '2025-01-10' })).data.error, /outside Sharma Traders’s books/);
  assert.match((await post('CREATE_VOUCHER', { voucher_type: 'Sales', party_name: 'Gupta Hardware', items: [{ stock_item_name: 'Steel Rod 12mm', quantity: 300, rate: 300 }] })).data.error, /Not enough stock of Steel Rod 12mm: this needs 300/);
  // a receipt dated before the bill it settles: TallyPrime would turn it into a new bill (seen live)
  assert.match((await post('CREATE_RECEIPT', { party_name: 'Gupta Hardware', offset_ledger: 'Cash', amount: 100, date: '2026-08-01', bill_number: 'INV-1' })).data.error, /Bill INV-1 is dated 2026-08-10/);
  assert.match((await post('CREATE_UNIT', { name: 'Kg 2' })).data.error, /letters only/);
  assert.match((await post('CREATE_STOCK_JOURNAL', { stock_item_name: 'Steel Rod 12mm', quantity: 5, unit: 'Nos', source_godown: 'Main Location', dest_godown: 'main location' })).data.error, /two different godowns/);

  const c = await post('CREATE_VOUCHER', { voucher_type: 'Receipt', party_name: 'Gupta Hardware', offset_ledger: 'Cash', amount: 6000, date: today, bill_number: 'INV-1', bill_type: 'Agst Ref' });
  assert.equal(c.status, 200, JSON.stringify(c.data));
  assert.equal(c.data.status, 'PENDING');
  assert.equal(c.data.payload.company_guid, COMPANY.tally_guid, 'stamped with the company to check in TallyPrime');
  assert.ok(c.data.payload.remote_id, 'our import id, to address the voucher later');

  const pending = (await agent('/commands/pending?limit=10')).data;
  assert.equal(pending.length, 1);
  assert.deepEqual([pending[0].command_type, pending[0].payload.party_name], ['CREATE_VOUCHER', 'Gupta Hardware']);
  assert.equal((await api(`/tally/commands/${c.data.id}`, 'GET', null, T)).data.status, 'SENT');
  assert.equal((await agent(`/commands/${pending[0].command_id}/result`, 'POST', { status: 'SUCCESS', result: { created: 1 } })).status, 200);
  assert.equal((await agent(`/commands/${pending[0].command_id}/result`, 'POST', { status: 'SUCCESS' })).status, 409, 'a result is taken once');
  assert.equal((await api(`/tally/commands/${c.data.id}`, 'GET', null, T)).data.status, 'SUCCESS');
  // a follow-up sync is queued for the PC, and the receipt waits as a skeleton until Tally exports it
  assert.deepEqual((await agent('/commands/pending')).data.map((x) => x.command_type), ['SYNC_VOUCHERS']);
  assert.equal((await api('/tally/vouchers', 'GET', null, T)).data.total, 1, 'skeletons stay hidden');
  // Tally exports it with its own guid: the skeleton is adopted (keeps our remote id), not duplicated
  await agent('/sync/vouchers', 'POST', { company_guid: COMPANY.tally_guid, records: [{ tally_guid: 'v-2', voucher_number: '1', voucher_type: 'Receipt', voucher_date: today, party_name: 'Gupta Hardware', amount: -6000, ledger_entries: [{ ledger_name: 'Gupta Hardware', amount: 6000 }, { ledger_name: 'Cash', amount: -6000 }] }] });
  const list = (await api('/tally/vouchers', 'GET', null, T)).data.items;
  const receipt = list.find((v) => v.voucher_type === 'Receipt');
  assert.equal(list.length, 2);
  assert.equal(receipt.remoteId, c.data.payload.remote_id);
  assert.equal(receipt.source, 'CRM');
  assert.equal(receipt.pending, undefined, 'no longer waiting for Tally');
  // an invoice made from items, with our bill number: Tally's export has no reference or amount we sent, only the bill
  // allocation (found live on TallyPrime 7.2) — still adopted, by the bill
  const sale = await post('CREATE_VOUCHER', { voucher_type: 'Sales', party_name: 'Gupta Hardware', offset_ledger: 'Sales', date: today, bill_number: 'FH/9', items: [{ stock_item_name: 'Steel Rod 12mm', quantity: 2, rate: 300 }] });
  const ps = (await agent('/commands/pending')).data.find((x) => x.command_type === 'CREATE_VOUCHER');
  await agent(`/commands/${ps.command_id}/result`, 'POST', { status: 'SUCCESS', result: { created: 1 } });
  await agent('/sync/vouchers', 'POST', { company_guid: COMPANY.tally_guid, records: [{ tally_guid: 'v-9', voucher_number: '7', voucher_type: 'Sales', voucher_date: today, party_name: 'Gupta Hardware', amount: 600, bill_allocations: [{ bill_name: 'FH/9', amount: -600 }], ledger_entries: [{ ledger_name: 'Gupta Hardware', amount: -600 }, { ledger_name: 'Sales', amount: 600 }] }] });
  const sold = (await api('/tally/vouchers', 'GET', null, T)).data.items.find((v) => v.tally_guid === 'v-9');
  assert.equal(sold.remoteId, sale.data.payload.remote_id);
  assert.equal((await api('/tally/vouchers', 'GET', null, T)).data.total, 3, 'adopted, not duplicated');

  // cancel it from FunnelHive: the voucher's type, date and remote id are filled from the mirror
  const cancel = await post('CANCEL_VOUCHER', { record_id: receipt.id });
  assert.deepEqual([cancel.data.payload.voucher_type, cancel.data.payload.date, cancel.data.payload.remote_id], ['Receipt', today, c.data.payload.remote_id]);
  const p2 = (await agent('/commands/pending')).data.find((x) => x.command_type === 'CANCEL_VOUCHER');
  await agent(`/commands/${p2.command_id}/result`, 'POST', { status: 'SUCCESS' });
  assert.equal((await api(`/tally/vouchers/${receipt.id}`, 'GET', null, T)).data.status, 'CANCELLED');
  // Tally exports a cancelled voucher without lines, party or amount: the mirror keeps who and how much
  await agent('/sync/vouchers', 'POST', { company_guid: COMPANY.tally_guid, records: [{ tally_guid: 'v-2', voucher_number: '1', voucher_type: 'Receipt', voucher_date: today, is_cancelled: true }] });
  const gone = (await api(`/tally/vouchers/${receipt.id}`, 'GET', null, T)).data;
  assert.deepEqual([gone.status, gone.party_name, gone.amount], ['CANCELLED', 'Gupta Hardware', 6000]);
  // a refusal from Tally comes back as the command's error
  const led = await post('CREATE_LEDGER', { name: 'Verma Steels', parent: 'Sundry Creditors', email: 'verma@steel.in' });
  const p3 = (await agent('/commands/pending')).data.find((x) => x.command_type === 'CREATE_LEDGER');
  await agent(`/commands/${p3.command_id}/result`, 'POST', { status: 'FAILED', error_message: 'Ledger already exists', result: { tally_response: '<LINEERROR>…' } });
  const failed = (await api(`/tally/commands/${led.data.id}`, 'GET', null, T)).data;
  assert.deepEqual([failed.status, failed.error_message], ['FAILED', 'Ledger already exists']);

  // GST: CGST + SGST half each inside the state, IGST across states, on the company's own Duties & Taxes ledgers
  const gstSale = { voucher_type: 'Sales', party_name: 'Gupta Hardware', offset_ledger: 'Sales Account', date: today, items: [{ stock_item_name: 'Steel Rod 12mm', quantity: 2, rate: 500 }], gst_percent: 18 };
  assert.match((await post('CREATE_VOUCHER', gstSale)).data.error, /Create Output CGST and Output SGST under Duties & Taxes/);
  await agent('/sync/ledgers', 'POST', { company_guid: COMPANY.tally_guid, records: ['Output CGST', 'Output SGST', 'Output IGST', 'Input CGST', 'Input SGST'].map((n, i) => ({ tally_guid: `tax-${i}`, name: n, parent: 'Duties & Taxes', ledger_group: 'Duties & Taxes' })).concat({ tally_guid: 'l-2', name: 'Sales Account', parent: 'Sales Accounts' }) });
  assert.match((await post('CREATE_VOUCHER', gstSale)).data.error, /Update the FunnelHive Tally Connector/, 'a connector before 1.1.2 would drop the tax lines');
  await agent('/heartbeat', 'POST', { agent_id: agentId, tally_status: 'ONLINE', company_loaded: true, company_name: COMPANY.name, company_guid: COMPANY.tally_guid, app_version: '1.1.2' });
  const g1 = (await post('CREATE_VOUCHER', { ...gstSale, offset_ledger: 'Sales' })).data.payload;
  assert.deepEqual(g1.taxes, [{ ledger_name: 'Output CGST', amount: 90 }, { ledger_name: 'Output SGST', amount: 90 }]);
  assert.equal(g1.offset_ledger, 'Sales Account', '"Sales" (a voucher type, said by Hive live) → the one Sales Accounts ledger');
  assert.equal((await post('CREATE_VOUCHER', { ...gstSale, offset_ledger: 'Gupta Hardware' })).data.payload.offset_ledger, 'Sales Account', 'the party as its own offset (said by Hive live) → the Sales Accounts ledger');
  assert.deepEqual((await post('CREATE_VOUCHER', { ...gstSale, interstate: true })).data.payload.taxes, [{ ledger_name: 'Output IGST', amount: 180 }]);
  assert.deepEqual((await post('CREATE_VOUCHER', { ...gstSale, voucher_type: 'Purchase', gst_percent: 5 })).data.payload.taxes, [{ ledger_name: 'Input CGST', amount: 25 }, { ledger_name: 'Input SGST', amount: 25 }]);
  assert.match((await post('CREATE_VOUCHER', { ...gstSale, voucher_type: 'Purchase', interstate: true })).data.error, /Create Input IGST/);
  assert.equal((await post('CREATE_VOUCHER', { ...gstSale, voucher_type: 'Receipt', offset_ledger: 'Cash', items: undefined, amount: 100 })).data.payload.taxes, undefined, 'no GST on a receipt');
});

test('the PC must be online with the company open; a disconnected PC stops working', async () => {
  await agent('/heartbeat', 'POST', { agent_id: agentId, tally_status: 'COMPANY_NOT_LOADED', company_guid: null });
  assert.match((await api('/tally/commands', 'POST', { type: 'CREATE_LEDGER', payload: { name: 'X' } }, T)).data.error, /offline — open TallyPrime/);
  await agent('/heartbeat', 'POST', { agent_id: agentId, tally_status: 'ONLINE', company_guid: 'another-company', company_name: 'Other Co' });
  assert.match((await api('/tally/commands', 'POST', { type: 'CREATE_LEDGER', payload: { name: 'X' } }, T)).data.error, /Open Sharma Traders in TallyPrime/);
  const agents = (await api('/tally', 'GET', null, T)).data.agents;
  assert.equal(agents[0].machine_name, 'ACCOUNTS-PC');
  assert.equal((await api(`/tally/agents/${agents[0].id}/disconnect`, 'POST', {}, T)).status, 200);
  assert.equal((await agent('/commands/pending')).status, 401, 'its token no longer works');
});

test('switching the add-on off stops the connector and the seller screens; the mirror is kept', async () => {
  const { code } = (await api('/tally/connect-code', 'POST', {}, T)).data;
  AG = (await api(`${A}/activate`, 'POST', { license_key: code, machine_fingerprint: 'machine-fp-0002', machine_name: 'SHOP-PC', app_version: '1.0.1' })).data.agent_token;
  await api(`/admin/users/${sellerId}/action`, 'POST', { action: 'tally_off' }, ADMIN);
  assert.equal((await agent('/commands/pending')).status, 403);
  assert.equal((await api('/tally/vouchers', 'GET', null, T)).status, 403);
  await api(`/admin/users/${sellerId}/action`, 'POST', { action: 'tally_on' }, ADMIN);
  assert.equal((await api('/tally/vouchers', 'GET', null, T)).data.total, 3);
  // another seller sees nothing of it
  const other = (await register(api, 'other@tally.test')).token;
  const vid = (await api('/tally/vouchers', 'GET', null, T)).data.items[0].id;
  const otherId = (await api('/me', 'GET', null, other)).data.id;
  await api(`/admin/users/${otherId}/action`, 'POST', { action: 'tally_on' }, ADMIN);
  assert.equal((await api(`/tally/vouchers/${vid}`, 'GET', null, other)).status, 404);
  assert.equal((await api('/tally/vouchers', 'GET', null, other)).data.total, 0);
});

test('a big upload is saved in chunks: every row kept, the reconcile still retires what the export dropped', async () => {
  const BIG = { tally_guid: 'c-big', name: 'Big Traders', financial_year_from: '2026-04-01', financial_year_to: '2027-03-31' };
  await agent('/sync/companies', 'POST', { records: [BIG] });
  const v = (i) => ({ tally_guid: `big-${i}`, voucher_number: String(i), voucher_type: 'Sales', voucher_date: '2026-06-01', party_name: 'Gupta Hardware', amount: 100 + i });
  const first = await agent('/sync/vouchers', 'POST', { company_guid: BIG.tally_guid, reconcile: true, records: Array.from({ length: 1200 }, (_, i) => v(i)) });
  assert.equal(first.status, 200, JSON.stringify(first.data));
  assert.equal(first.data.records_created, 1200);
  const co = (await api('/tally', 'GET', null, T)).data.companies.find((c) => c.tally_guid === BIG.tally_guid);
  await api(`/tally/companies/${co.id}/select`, 'POST', {}, T);
  assert.equal((await api('/tally/vouchers', 'GET', null, T)).data.total, 1200);
  // the next full export no longer has the first 100
  await agent('/sync/vouchers', 'POST', { company_guid: BIG.tally_guid, reconcile: true, records: Array.from({ length: 1100 }, (_, i) => v(i + 100)) });
  assert.equal((await api('/tally/vouchers', 'GET', null, T)).data.total, 1100);
});
