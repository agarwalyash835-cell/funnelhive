// GST returns and e-documents (gst-returns.js): one GSTR-1 for a month built from counter bills and checkout sales
// together (each source can be left out), its CSV, the shared number series, e-invoice JSON (NIC schema 1.1) with
// plain-English validation and the IRN pasted back, and e-way bill JSON with its thresholds. Checkout invoices are
// written straight into the database in the shape sales.js issues them (a real checkout needs a payment provider).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, register } from './helpers.mjs';

let srv, api, S, sellerId, T, uid;
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
const month = today.slice(0, 7), [yy, mm, dd] = today.split('-');
const fy = Number(mm) >= 4 ? `${yy}-${String((Number(yy) + 1) % 100).padStart(2, '0')}` : `${Number(yy) - 1}-${yy.slice(2)}`;
const slash = `${dd}/${mm}/${yy}`;
const item = (name, o = {}) => T.iitems.insert({ id: uid(), userId: sellerId, name, unit: 'pcs', sku: null, barcode: null, category: null, hsn: null, gst_percent: 18, sale_rate: 100, purchase_rate: 50, reorder_level: 0, active: true, at: Date.now(), ...o });
const P = '/inventory/pro';
const SELLER = { name: 'Sharma Traders', gstin: '27ABCDE1234F1Z5', address: 'Plot 4, MIDC Bhosari, Pune', state: 'Maharashtra', stateCode: '27', email: 'accounts@sharma.test' };
const sale = (o) => T.sinvoices.insert({ id: uid(), userId: sellerId, orderId: null, funnelId: null, type: 'invoice', against: null, prefix: 'INV', fy, at: Date.now(), paymentId: 'pay_x', registered: true, seller: SELLER, ...o });
const line = (name, sac, amount, rate, intra) => { const taxable = Math.round((amount / (1 + rate / 100)) * 100) / 100, tax = Math.round((amount - taxable) * 100) / 100; return { index: 0, name, kind: 'main', sac, rate, amount, taxable, cgst: intra ? tax / 2 : 0, sgst: intra ? tax / 2 : 0, igst: intra ? 0 : tax }; };
const csv = async (qs) => { const r = await fetch(`${srv.base}/api/gst/gstr1.csv?${qs}`, { headers: { authorization: `Bearer ${S}` } }); return { status: r.status, type: r.headers.get('content-type'), text: await r.text() }; };

let walkIn, kaB2b, mhB2b, gjBig, noHsn, cn1, cn3, chkB2b, chkB2c, chkCn;
before(async () => {
  srv = await startServer();
  api = srv.api;
  S = (await register(api, 'gst@returns.test')).token;
  sellerId = (await api('/me', 'GET', null, S)).data.id;
  process.env.DATA_DIR = srv.dataDir;
  ({ T, uid } = await import('../db.js'));
  T.users.update(sellerId, (u) => { u.addons = { ...u.addons, inventory: true }; });
});
after(async () => { await srv?.stop(); });

test('settings: PIN code, city and phone for e-documents, validated', async () => {
  assert.match((await api('/settings', 'PUT', { invoicing: { enabled: true, legalName: 'Sharma Traders', gstin: SELLER.gstin, address: SELLER.address, pincode: '41102' } }, S)).data.error, /PIN code has 6 digits/);
  assert.match((await api('/settings', 'PUT', { invoicing: { enabled: true, legalName: 'Sharma Traders', gstin: SELLER.gstin, address: SELLER.address, phone: 'call me' } }, S)).data.error, /phone number/);
  const r = await api('/settings', 'PUT', { invoicing: { enabled: true, legalName: 'Sharma Traders', gstin: SELLER.gstin, address: SELLER.address, email: SELLER.email } }, S);
  assert.equal(r.status, 200, JSON.stringify(r.data));
});

test('a mixed month: counter bills, checkout sales and credit notes from both in one GSTR-1, numbers in one series', async () => {
  const steel = item('Steel Rod', { unit: 'Kg', hsn: '7214', sale_rate: 100 }), lathe = item('Lathe', { unit: 'Nos', hsn: '8458', sale_rate: 60000 }), misc = item('Misc Part', { hsn: null, sale_rate: 500 });
  const bill = async (body) => { const r = await api(`${P}/bills`, 'POST', { allowNegative: true, ...body }, S); assert.equal(r.status, 200, JSON.stringify(r.data)); return r.data; };
  assert.match((await api(`${P}/bills`, 'POST', { lines: [{ itemId: steel.id, qty: 1 }], buyer: { gstin: '29AAACB1234C1Z5', pincode: '5600' }, allowNegative: true }, S)).data.error, /PIN code has 6 digits/);
  walkIn = await bill({ lines: [{ itemId: steel.id, qty: 10 }] });
  kaB2b = await bill({ lines: [{ itemId: steel.id, qty: 20 }], buyer: { gstin: '29AAACB1234C1Z5', name: 'Bangalore Builders', address: '14 MG Road, Bengaluru', pincode: '560001' } });
  mhB2b = await bill({ lines: [{ itemId: lathe.id, qty: 1 }], buyer: { gstin: '27AAACM1234D1Z2', name: 'Mumbai Machines', address: 'Andheri East, Mumbai 400069' } });
  gjBig = await bill({ lines: [{ itemId: lathe.id, qty: 2 }], buyer: { state: 'Gujarat', name: 'Patel Works' } });
  noHsn = await bill({ lines: [{ itemId: misc.id, qty: 1 }], buyer: { gstin: '29AAACB1234C1Z5', name: 'Bangalore Builders' } });
  assert.equal(kaB2b.buyer.pincode, '560001');
  assert.deepEqual([kaB2b.intra, mhB2b.intra, gjBig.intra, gjBig.total], [false, true, false, 141600]);

  // checkout: a B2B course to Karnataka (IGST), a B2C one in Maharashtra, a test-mode sale, an export under LUT
  chkB2b = sale({ number: `INV/${fy}/0001`, intra: false, placeOfSupply: 'Karnataka', items: [line('Growth Course', '999293', 11800, 18, false)], rates: [], total: 11800, taxable: 10000, cgst: 0, sgst: 0, igst: 1800, billedTo: { name: 'Bangalore Builders', person: 'Ravi', email: 'ravi@bb.test', phone: '9845012345', gstin: '29AAACB1234C1Z5', state: 'Karnataka', stateCode: '29' } });
  chkB2c = sale({ number: `INV/${fy}/0002`, intra: true, placeOfSupply: 'Maharashtra', items: [line('Starter Course', '999293', 5900, 18, true)], rates: [], total: 5900, taxable: 5000, cgst: 450, sgst: 450, igst: 0, billedTo: { name: 'Asha', email: 'asha@x.test', gstin: '', state: 'Maharashtra', stateCode: '27' } });
  sale({ number: `TEST-INV/${fy}/0001`, prefix: 'TEST-INV', test: true, intra: true, placeOfSupply: 'Maharashtra', items: [line('Test', '999293', 1180, 18, true)], rates: [], total: 1180, billedTo: { name: 'T', gstin: '' } });
  sale({ number: `INV/${fy}/0003`, intra: false, placeOfSupply: 'Outside India', export: true, lut: true, currency: 'USD', fx: 83, items: [{ ...line('Consulting', '998311', 100, 0, false) }], rates: [], total: 100, taxable: 100, cgst: 0, sgst: 0, igst: 0, billedTo: { name: 'Acme Inc', email: 'a@acme.test', gstin: '', state: '', stateCode: '' } });

  // credit notes: counter first, then a checkout refund, then the counter again — one CN series, no repeats
  cn1 = (await api(`${P}/bills/${kaB2b.id}/return`, 'POST', { lines: [{ itemId: steel.id, qty: 5 }] }, S)).data;
  assert.equal(cn1.number, `CN/${fy}/0001`);
  chkCn = sale({ type: 'credit', against: chkB2b.number, prefix: 'CN', number: `CN/${fy}/0002`, intra: false, placeOfSupply: 'Karnataka', items: [line('Growth Course', '999293', 11800, 18, false)], rates: [], total: 11800, taxable: 10000, cgst: 0, sgst: 0, igst: 1800, billedTo: chkB2b.billedTo });
  cn3 = (await api(`${P}/bills/${walkIn.id}/return`, 'POST', { lines: [{ itemId: steel.id, qty: 2 }] }, S)).data;
  assert.equal(cn3.number, `CN/${fy}/0003`, 'the counter continues past the checkout credit note');

  const r = await api(`/gst/gstr1?month=${month}`, 'GET', null, S);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const j = r.data.json, s = r.data.summary;
  assert.deepEqual(r.data.sources, { counter: true, checkout: true });
  // B2B: one row per buyer GSTIN, both sources' invoices under it
  const ka = j.b2b.find((x) => x.ctin === '29AAACB1234C1Z5');
  assert.deepEqual(ka.inv.map((i) => i.inum).sort(), [kaB2b.number, noHsn.number, chkB2b.number].sort());
  assert.deepEqual(ka.inv.find((i) => i.inum === chkB2b.number), { inum: chkB2b.number, idt: `${dd}-${mm}-${yy}`, val: 11800, pos: '29', rchrg: 'N', inv_typ: 'R', itms: [{ num: 1, itm_det: { txval: 10000, rt: 18, iamt: 1800, camt: 0, samt: 0, csamt: 0 } }] });
  assert.equal(j.b2b.find((x) => x.ctin === '27AAACM1234D1Z2').inv[0].itms[0].itm_det.camt, 5400);
  assert.deepEqual(j.b2cl.map((x) => [x.pos, x.inv.map((i) => i.inum)]), [['24', [gjBig.number]]]);
  // B2CS: the walk-in (1000, less 2 kg returned) and the checkout B2C sale share the INTRA / 27 / 18% row
  const row = j.b2cs.find((x) => x.sply_ty === 'INTRA' && x.pos === '27' && x.rt === 18);
  assert.deepEqual([row.txval, row.camt, row.samt], [800 + 5000, 72 + 450, 72 + 450]);
  // the export (USD 100 at ₹83) under LUT; the test sale nowhere
  assert.deepEqual(j.exp, [{ exp_typ: 'WOPAY', inv: [{ inum: `INV/${fy}/0003`, idt: `${dd}-${mm}-${yy}`, val: 8300, sbpcode: '', sbnum: '', sbdt: '', itms: [{ txval: 8300, rt: 0, iamt: 0, csamt: 0 }] }] }]);
  assert.ok(!JSON.stringify(j).includes('TEST-INV'));
  // CDNR: both sources' notes to the Karnataka buyer
  assert.deepEqual(j.cdnr.find((x) => x.ctin === '29AAACB1234C1Z5').nt.map((n) => [n.nt_num, n.val]), [[cn1.number, cn1.total], [chkCn.number, 11800]]);
  // HSN: goods with their unit, services (SAC 99…) with UQC NA and no quantity
  const h = j.hsn;
  assert.deepEqual(h.hsn_b2b.filter((x) => x.hsn_sc === '7214').map((x) => [x.qty, x.uqc, x.txval]), [[15, 'KGS', 1500]]);
  assert.deepEqual(h.hsn_b2b.filter((x) => x.hsn_sc === '999293').map((x) => [x.uqc, x.qty, x.txval]), [['NA', 0, 0]], 'refunded in full');
  assert.deepEqual(h.hsn_b2c.filter((x) => x.hsn_sc === '999293').map((x) => [x.uqc, x.qty, x.txval, x.camt]), [['NA', 0, 5000, 450]]);
  assert.deepEqual(h.hsn_b2c.filter((x) => x.hsn_sc === '998311').map((x) => [x.uqc, x.txval]), [['NA', 8300]]);
  // documents issued: one row per series under its type; the shared CN series once, 0001–0003
  const inv = j.doc_issue.doc_det.find((d) => d.doc_num === 1).docs, notes = j.doc_issue.doc_det.find((d) => d.doc_num === 5).docs;
  assert.deepEqual(inv.map((d) => [d.from.split('/')[0], d.totnum, d.cancel, d.net_issue]).sort(), [['CB', 5, 0, 5], ['INV', 3, 0, 3]]);
  assert.deepEqual(notes, [{ num: 1, from: `CN/${fy}/0001`, to: `CN/${fy}/0003`, totnum: 3, cancel: 0, net_issue: 3 }]);
  assert.deepEqual([s.invoices, s.credit_notes, s.b2b, s.b2cl, s.exp, s.by_source.counter.invoices, s.by_source.checkout.invoices, s.by_source.checkout.credit_notes], [8, 3, 4, 1, 1, 5, 3, 1]);
  assert.ok(s.warnings.some((w) => /HSN code missing on Misc Part/.test(w)));

  // each source on its own
  const c = (await api(`/gst/gstr1?month=${month}&checkout=0`, 'GET', null, S)).data;
  assert.deepEqual(c.sources, { counter: true, checkout: false });
  assert.ok(!c.json.exp && !JSON.stringify(c.json).includes(`INV/${fy}`));
  assert.deepEqual(c.json.doc_issue.doc_det.find((d) => d.doc_num === 5).docs[0].totnum, 2);
  const k = (await api(`/gst/gstr1?month=${month}&counter=0`, 'GET', null, S)).data;
  assert.equal(k.summary.invoices, 3);
  assert.ok(!JSON.stringify(k.json).includes(`CB/${fy}`));
  assert.match((await api(`/gst/gstr1?month=${month}&counter=0&checkout=0`, 'GET', null, S)).data.error, /counter bills, checkout sales or both/);
  assert.match((await api('/gst/gstr1?month=2026-13', 'GET', null, S)).data.error, /Pick a month/);
  // the old counter route still answers, both sources by default
  assert.equal((await api(`${P}/gstr1?month=${month}`, 'GET', null, S)).data.summary.invoices, 8);
});

test('CSV of the month: one row per invoice or credit note, both sources', async () => {
  const r = await csv(`month=${month}`);
  assert.equal(r.status, 200);
  assert.match(r.type, /text\/csv/);
  const rows = r.text.replace(/^﻿/, '').trim().split('\r\n');
  assert.equal(rows[0], 'Source,Document,Number,Date,Against invoice,Against date,Buyer,Buyer GSTIN,Place of supply,GSTR-1 table,Taxable value,GST rates,IGST,CGST,SGST,Cess,Total,Status,IRN');
  assert.equal(rows.length, 1 + 11);
  assert.ok(rows.includes(`Checkout,Invoice,${chkB2b.number},${dd}-${mm}-${yy},,,Bangalore Builders,29AAACB1234C1Z5,29-Karnataka,B2B,10000,18%,1800,0,0,0,11800,Issued,`));
  assert.ok(rows.some((x) => x.startsWith(`Checkout,Credit note,${chkCn.number},${dd}-${mm}-${yy},${chkB2b.number},${dd}-${mm}-${yy},`) && x.includes(',CDNR,')));
  assert.ok(rows.some((x) => x.startsWith(`Counter bill,Invoice,${gjBig.number},`) && x.includes(',24-Gujarat,B2CL,')));
  assert.equal((await csv(`month=${month}&counter=0`)).text.trim().split('\r\n').length, 1 + 4);
});

test('e-invoice JSON (schema 1.1): intra and inter-state B2B, credit notes, and what’s missing in plain words', async () => {
  const einv = (source, id, body) => api(`/gst/einvoice/${source}/${id}`, 'POST', body || {}, S);
  // the seller's PIN isn't in Settings or the address yet
  const no = await einv('counter', kaB2b.id);
  assert.equal(no.status, 422);
  assert.ok(no.data.missing.some((m) => /your 6-digit PIN code/.test(m)), no.data.error);
  assert.equal((await api('/settings', 'PUT', { invoicing: { pincode: '411026', city: 'Pune', phone: '+91 98765 43210' } }, S)).status, 200);

  // inter-state: IGST, buyer Pos / Stcd 29
  const k = await einv('counter', kaB2b.id);
  assert.equal(k.status, 200, JSON.stringify(k.data));
  const e = k.data.json;
  assert.deepEqual([e.Version, e.TranDtls, e.DocDtls], ['1.1', { TaxSch: 'GST', SupTyp: 'B2B', RegRev: 'N', EcmGstin: null, IgstOnIntra: 'N' }, { Typ: 'INV', No: kaB2b.number, Dt: slash }]);
  assert.deepEqual(e.SellerDtls, { Gstin: '27ABCDE1234F1Z5', LglNm: 'Sharma Traders', Addr1: 'Plot 4, MIDC Bhosari, Pune', Loc: 'Pune', Pin: 411026, Stcd: '27', Ph: '919876543210', Em: 'accounts@sharma.test' });
  assert.deepEqual(e.BuyerDtls, { Gstin: '29AAACB1234C1Z5', LglNm: 'Bangalore Builders', Pos: '29', Addr1: '14 MG Road, Bengaluru', Loc: 'Bengaluru', Pin: 560001, Stcd: '29' });
  const it = e.ItemList[0];
  assert.deepEqual([it.SlNo, it.IsServc, it.HsnCd, it.Qty, it.Unit, it.UnitPrice, it.TotAmt, it.AssAmt, it.GstRt, it.IgstAmt, it.CgstAmt, it.TotItemVal], ['1', 'N', '7214', 20, 'KGS', 100, 2000, 2000, 18, 360, 0, 2360]);
  assert.deepEqual(e.ValDtls, { AssVal: 2000, CgstVal: 0, SgstVal: 0, IgstVal: 360, CesVal: 0, StCesVal: 0, Discount: 0, OthChrg: 0, RndOffAmt: 0, TotInvVal: kaB2b.total });
  assert.equal(k.data.filename, `EINV_CB-${fy}-${kaB2b.number.slice(-4)}.json`);

  // intra-state: CGST + SGST, place and PIN read from the address
  const m = (await einv('counter', mhB2b.id)).data.json;
  assert.deepEqual([m.BuyerDtls.Pos, m.BuyerDtls.Stcd, m.BuyerDtls.Pin, m.BuyerDtls.Loc, m.ValDtls.CgstVal, m.ValDtls.SgstVal, m.ValDtls.IgstVal, m.ValDtls.TotInvVal], ['27', '27', 400069, 'Mumbai', 5400, 5400, 0, 70800]);

  // a counter credit note: CRN against its invoice
  const n = (await einv('counter-note', cn1.id)).data.json;
  assert.deepEqual([n.DocDtls.Typ, n.DocDtls.No, n.RefDtls.PrecDocDtls[0].InvNo, n.RefDtls.PrecDocDtls[0].InvDt, n.ItemList[0].Qty, n.ValDtls.IgstVal], ['CRN', cn1.number, kaB2b.number, slash, 5, 90]);

  // a checkout credit note: the sale had no address, so the buyer's address and PIN are asked for, then saved
  const bad = await einv('checkout', chkCn.id);
  assert.equal(bad.status, 422);
  assert.match(bad.data.error, /can’t become an e-invoice yet\. Missing: the buyer’s address; the buyer’s 6-digit PIN code/);
  assert.match((await einv('checkout', chkCn.id, { buyer: { pincode: '56001' } })).data.error, /6 digits/);
  const ok = await einv('checkout', chkCn.id, { buyer: { address: '14 MG Road, Bengaluru', pincode: '560001' } });
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  const c = ok.data.json;
  assert.deepEqual([c.DocDtls.Typ, c.RefDtls.PrecDocDtls[0].InvNo, c.ItemList[0].IsServc, c.ItemList[0].HsnCd, c.ItemList[0].IgstAmt, c.ValDtls.TotInvVal, c.BuyerDtls.Em, c.BuyerDtls.Ph], ['CRN', chkB2b.number, 'Y', '999293', 1800, 11800, 'ravi@bb.test', '9845012345']);
  assert.equal(T.sinvoices.get(chkCn.id).einv_buyer.pincode, '560001');

  // not possible: no HSN on a line and no buyer address; a B2C bill; a test-mode sale
  const h = await einv('counter', noHsn.id);
  assert.equal(h.status, 422);
  assert.ok(h.data.missing.some((x) => /HSN\/SAC code on “Misc Part”/.test(x)) && h.data.missing.some((x) => /buyer’s address/.test(x)), h.data.error);
  assert.match((await einv('counter', walkIn.id)).data.error, /buyer’s GSTIN — e-invoices are only for sales to GST-registered businesses/);
  assert.match((await einv('checkout', chkB2c.id)).data.error, /buyer’s GSTIN/);
  assert.equal((await einv('checkout', 'nope')).status, 404);
  assert.equal((await einv('elsewhere', kaB2b.id)).status, 404);
});

test('IRN, ack and signed QR pasted back onto the invoice; checked and kept unique', async () => {
  const irn = 'a'.repeat(32) + '0123456789abcdef'.repeat(2), put = (source, id, body) => api(`/gst/irn/${source}/${id}`, 'PUT', body, S);
  assert.match((await put('counter', kaB2b.id, { irn: 'xyz' })).data.error, /64 letters and digits/);
  assert.match((await put('counter', kaB2b.id, { irn, signed_qr: 'not a jwt' })).data.error, /three parts separated by dots/);
  assert.match((await put('counter', walkIn.id, { irn })).data.error, /only B2B invoices get an IRN/);
  const r = await put('counter', kaB2b.id, { irn: irn.toUpperCase(), ack_no: '112610000012345', ack_dt: '2026-10-29 14:05:00', signed_qr: 'eyJhbGciOiJSUzI1NiJ9.eyJkYXRhIjoiMSJ9.c2lnbmF0dXJl' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.deepEqual([r.data.irn.irn, r.data.irn.ack_no, r.data.irn.by], [irn, '112610000012345', 'manual']);
  const b = (await api(`${P}/bills/${kaB2b.id}`, 'GET', null, S)).data;
  assert.equal(b.irn.signed_qr, 'eyJhbGciOiJSUzI1NiJ9.eyJkYXRhIjoiMSJ9.c2lnbmF0dXJl');
  assert.equal(b.returns[0].irn, null);
  assert.match((await put('checkout', chkB2b.id, { irn })).data.error, /already on/);
  assert.equal((await put('checkout', chkB2b.id, { irn: 'b'.repeat(64) })).status, 200);
  assert.ok((await csv(`month=${month}`)).text.includes(`,Issued,${irn}`));
  assert.equal((await api(`/gst/einvoice/counter/${kaB2b.id}`, 'POST', {}, S)).data.irn.irn, irn);
  assert.equal((await api(`/gst/irn/checkout/${chkB2b.id}`, 'DELETE', null, S)).status, 200);
  assert.equal(T.sinvoices.get(chkB2b.id).irn, undefined);
});

test('e-way bill JSON: needed over ₹50,000 inter-state or the state’s own limit; transport checked', async () => {
  const way = (id, body) => api(`/gst/eway/${id}`, 'POST', body, S);
  const road = { mode: 'road', distance: 520, vehicle_no: 'mh 12 ab 1234' };
  // inter-state ₹1,41,600 → needed
  const chk = (await api(`/gst/eway/${gjBig.id}`, 'GET', null, S)).data;
  assert.deepEqual([chk.required, chk.limit, chk.value, chk.intra], [true, 50000, 141600, false]);
  const miss = await way(gjBig.id, { transport: {} });
  assert.equal(miss.status, 422);
  assert.ok(miss.data.missing.some((m) => /how it travels/.test(m)) && miss.data.missing.some((m) => /distance/.test(m)) && miss.data.missing.some((m) => /buyer’s 6-digit PIN/.test(m)), miss.data.error);
  assert.ok((await way(gjBig.id, { transport: { ...road, vehicle_no: 'ABC' } })).data.missing.some((m) => /valid vehicle number — ABC isn’t/.test(m)));
  assert.ok((await way(gjBig.id, { transport: { mode: 'rail', distance: 900 } })).data.missing.some((m) => /railway receipt number and date/.test(m)));
  const r = await way(gjBig.id, { transport: road, buyer: { address: 'Ring Road, Surat', pincode: '395002' } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.json.version, '1.0.1118');
  const e = r.data.json.billLists[0];
  assert.deepEqual([e.userGstin, e.supplyType, e.subSupplyType, e.docType, e.docNo, e.docDate, e.transType], ['27ABCDE1234F1Z5', 'O', 1, 'INV', gjBig.number, slash, 1]);
  assert.deepEqual([e.fromPincode, e.fromStateCode, e.actualFromStateCode, e.fromPlace, e.toGstin, e.toTrdName, e.toPincode, e.toStateCode, e.toPlace], [411026, 27, 27, 'Pune', 'URP', 'Patel Works', 395002, 24, 'Surat']);
  assert.deepEqual([e.totalValue, e.igstValue, e.cgstValue, e.totInvValue, e.transMode, e.transDistance, e.vehicleNo, e.vehicleType, e.mainHsnCode], [120000, 21600, 0, 141600, 1, 520, 'MH12AB1234', 'R', 8458]);
  assert.deepEqual(e.itemList, [{ itemNo: 1, productName: 'Lathe', productDesc: 'Lathe', hsnCode: 8458, quantity: 2, qtyUnit: 'NOS', taxableAmount: 120000, sgstRate: 0, cgstRate: 0, igstRate: 18, cessRate: 0, cessNonAdvol: 0 }]);
  assert.deepEqual((await api(`/gst/eway/${gjBig.id}`, 'GET', null, S)).data.transport.vehicle_no, 'MH12AB1234', 'the transport is remembered');

  // within Maharashtra ₹70,800 is under its ₹1 lakh limit: not needed, unless the seller wants one anyway
  const no = await way(mhB2b.id, { transport: road });
  assert.equal(no.status, 409);
  assert.equal(no.data.code, 'EWAY_NOT_NEEDED');
  assert.match(no.data.error, /Not needed: goods worth ₹70,800 are within the ₹1,00,000 limit for movement within Maharashtra/);
  const vol = await way(mhB2b.id, { transport: { transporter_id: '27AAACT1234E1Z9', distance: 0 }, voluntary: true });
  assert.equal(vol.status, 200, JSON.stringify(vol.data));
  const v = vol.data.json.billLists[0];
  assert.deepEqual([v.toGstin, v.toPincode, v.toStateCode, v.cgstValue, v.sgstValue, v.transMode, v.transporterId, v.vehicleNo, v.itemList[0].cgstRate], ['27AAACM1234D1Z2', 400069, 27, 5400, 5400, '', '27AAACT1234E1Z9', '', 9]);
  assert.match((await way(walkIn.id, { transport: road })).data.error, /Not needed/);
});
