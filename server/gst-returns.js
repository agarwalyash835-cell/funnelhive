// GST returns and e-documents for both of a seller's sales sources: counter bills (inventory-pro.js: ibills / icnotes)
// and funnel checkout sales (sales.js: sinvoices, invoices and credit notes). Routes live under /api/gst.
//
// - GSTR-1 for a month (one entry point, `gstr1`): both sources are normalised into the same document shape and sorted
//   into the portal's tables; each source can be left out. A CSV of the same month (one row per invoice / note) is for
//   accountants. Format: the GST offline tool's GSTR-1 JSON, "GST3.2.1"-style keys (b2b, b2cl, b2cs, exp, cdnr, cdnur,
//   hsn.hsn_b2b / hsn_b2c as split from 2025, doc_issue).
// - E-invoice JSON (IRN-ready): NIC e-invoice schema version 1.1 (Version, TranDtls, DocDtls, SellerDtls, BuyerDtls,
//   ItemList, ValDtls, RefDtls). No GST Suvidha Provider (GSP) is chosen yet, so nothing calls the IRP: the JSON is
//   uploaded on the IRP portal's bulk tool (as an array of invoices) or handed to any GSP later, and the IRN / ack /
//   signed QR the seller gets back is pasted in here and printed on the invoice.
// - E-way bill JSON: the e-way bill portal's bulk-generation format (version "1.0.1118", billLists[]), for counter bills.
//
// Dates: GSTR-1 wants dd-mm-yyyy, the e-invoice and e-way bill want dd/mm/yyyy. State codes: two-character strings in
// GSTR-1 and the e-invoice ("27"), numbers in the e-way bill JSON (27). PIN codes: numbers in both e-documents.
import { T, q } from './db.js';
import { STATES, GSTIN_RE } from './platform.js';
// (inventory-core.js's switch, inlined: importing it here would make a module cycle through sales.js)
const inventoryOn = (u) => !!u?.addons?.inventory;

const fail = (status, error, extra) => { throw Object.assign(new Error(error), { status, extra }); };
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const r3 = (n) => Math.round((Number(n) || 0) * 1000) / 1000;
const lower = (v) => String(v || '').trim().toLowerCase();
const clip = (v, n = 120) => (v == null ? '' : String(v).trim().slice(0, n));
const ymd = (d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(d);
const inr = (n) => `₹${Math.round(n).toLocaleString('en-IN')}`;
// built on first use: sales.js imports this file while platform.js may still be loading (a module cycle), so nothing
// here may read an imported value at load time
let BY_CODE = null;
const STATE_BY_CODE = new Proxy({}, { get: (_, k) => (BY_CODE ??= Object.fromEntries(Object.entries(STATES).map(([n, c]) => [c, n])))[k] });
export const PIN_RE = /^[1-9][0-9]{5}$/;
export const fyOf = (day) => { const [y, m] = String(day).split('-').map(Number); return m >= 4 ? `${y}-${String((y + 1) % 100).padStart(2, '0')}` : `${y - 1}-${String(y % 100).padStart(2, '0')}`; };
const gstDate = (day) => { const [y, m, d] = String(day).split('-'); return `${d}-${m}-${y}`; }; // GSTR-1: dd-mm-yyyy
const slashDate = (day) => { const [y, m, d] = String(day).split('-'); return `${d}/${m}/${y}`; }; // e-invoice / e-way bill: dd/mm/yyyy

// ---------- the seller (Settings → GST invoices) ----------
// GSTIN fixes the state; PIN code, city and phone are what the e-invoice and e-way bill need on top of the invoice
export function sellerOf(u) {
  const i = u.settings?.invoicing || {}, gstin = clip(i.gstin, 15).toUpperCase();
  const state = (gstin && STATE_BY_CODE[gstin.slice(0, 2)]) || (STATES[i.state] ? i.state : '');
  const pin = String(i.pincode || '').replace(/\s/g, '');
  return { name: clip(i.legalName, 160) || clip(u.settings?.businessName, 160) || u.name || '', gstin: gstin || null, address: clip(i.address, 400) || null, state: state || null,
    pincode: PIN_RE.test(pin) ? pin : null, city: clip(i.city, 50) || null, phone: clip(i.phone, 20) || null, email: clip(i.email, 160) || null };
}

// ---------- one number series per prefix and financial year, shared by both sources ----------
// A GSTIN's documents need unique numbers: counter credit notes and checkout credit notes are both CN/2026-27/…, and a
// seller may give checkout invoices the counter's CB prefix. The next number is one past everything already in the
// series, in either table, so the two sources continue one series instead of each starting their own.
export function nextInSeries(userId, prefix, fy) {
  const like = `${prefix}/${fy}/%`;
  const n = q("SELECT COUNT(*) AS n FROM ibills WHERE userId = ? AND json_extract(data, '$.number') LIKE ?").get(userId, like).n
    + q("SELECT COUNT(*) AS n FROM icnotes WHERE userId = ? AND json_extract(data, '$.number') LIKE ?").get(userId, like).n
    + q('SELECT COUNT(*) AS n FROM sinvoices WHERE userId = ? AND number LIKE ?').get(userId, like).n;
  return `${prefix}/${fy}/${String(n + 1).padStart(4, '0')}`;
}

// ---------- units ----------
const UQC = { nos: 'NOS', no: 'NOS', pcs: 'PCS', pc: 'PCS', piece: 'PCS', pieces: 'PCS', kg: 'KGS', kgs: 'KGS', g: 'GMS', gm: 'GMS', gms: 'GMS', bag: 'BAG', bags: 'BAG', box: 'BOX', boxes: 'BOX', set: 'SET', sets: 'SET', l: 'LTR', ltr: 'LTR', litre: 'LTR', liter: 'LTR', ml: 'MLT', m: 'MTR', mtr: 'MTR', metre: 'MTR', meter: 'MTR', bottle: 'BTL', btl: 'BTL', dozen: 'DOZ', doz: 'DOZ', ton: 'TON', tonne: 'TON', roll: 'ROL', pair: 'PRS', pairs: 'PRS', packet: 'PAC', pack: 'PAC', strip: 'OTH' };
export const uqcOf = (unit) => UQC[lower(unit).replace(/\.$/, '')] || 'OTH';
const isService = (code) => /^99/.test(String(code || ''));

// ---------- both sources as one list of documents ----------
// { source, kind: INV | CRN, id, number, day, cancelled, gstin, buyer, pos, intra, total, large (B2C large), export
//   (WPAY | WOPAY | null), against { number, day }, lines [{ name, hsn, uqc, qty, taxable, rt, igst, cgst, sgst }], irn }
const isLarge = (d) => !d.gstin && !d.export && d.intra === false && d.total > 100000; // B2CL: inter-state, no GSTIN, over ₹1 lakh
function counterDocs(u, month, home) {
  const inMonth = (x) => String(x.day).startsWith(month) && x.doc_type === 'TAX_INVOICE';
  const bills = T.ibills.all({ userId: u.id }).filter(inMonth), notes = T.icnotes.all({ userId: u.id }).filter(inMonth);
  const lines = (d) => d.lines.map((l) => ({ name: l.name, hsn: l.hsn || '', uqc: uqcOf(l.unit), qty: Number(l.qty) || 0, taxable: l.taxable, rt: Number(l.gst_percent) || 0, igst: l.igst || 0, cgst: l.cgst || 0, sgst: l.sgst || 0 }));
  const base = (d) => ({ source: 'counter', id: d.id, number: d.number, day: d.day, gstin: d.buyer?.gstin || null, buyer: d.buyer?.name || d.party_name || '', pos: d.pos_code || home, intra: d.intra !== false, total: d.total, export: null, lines: lines(d), irn: d.irn?.irn || null });
  const out = bills.map((b) => { const d = { ...base(b), kind: 'INV', cancelled: !!b.cancelled }; d.large = isLarge(d); return d; });
  for (const n of notes) {
    const b = T.ibills.get(n.billId), d = { ...base(n), kind: 'CRN', cancelled: false, against: { number: n.bill_number, day: n.bill_day } };
    d.large = !!b && isLarge({ gstin: b.buyer?.gstin, intra: b.intra !== false, total: b.total }); // a note follows its invoice's table
    out.push(d);
  }
  return out;
}
function checkoutDocs(u, month, home) {
  const from = Date.parse(`${month}-01T00:00:00+05:30`), [y, m] = month.split('-').map(Number);
  const to = Date.parse(`${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, '0')}-01T00:00:00+05:30`);
  // test-mode sales (their own TEST- series) and invoices issued without a GSTIN are not reported
  const all = T.sinvoices.all({ userId: u.id, at: { gte: from, lt: to } }, { order: 'at' }).filter((i) => i.registered && !i.test);
  const warnings = [];
  const docOf = (i) => {
    // an export is billed in its own currency: GSTR-1 wants rupees, at the rate recorded on the sale
    const fx = i.export ? Number(i.fx) || 0 : 1;
    if (i.export && !fx) warnings.push(`Export invoice ${i.number} has no rupee rate recorded — its value is shown in ${i.currency}; correct it in the offline tool`);
    const rs = (n) => r2((Number(n) || 0) * (fx || 1));
    const lines = i.items.map((l) => { const svc = isService(l.sac); return { name: l.name, hsn: l.sac || '', uqc: svc ? 'NA' : 'NOS', qty: svc ? 0 : 1, taxable: rs(l.taxable), rt: Number(l.rate ?? i.rate) || 0, igst: rs(l.igst), cgst: rs(l.cgst), sgst: rs(l.sgst) }; });
    const pos = i.export ? '96' : STATES[i.placeOfSupply] || i.billedTo?.stateCode || i.seller?.stateCode || home;
    const d = { source: 'checkout', kind: i.type === 'credit' ? 'CRN' : 'INV', id: i.id, number: i.number, day: ymd(new Date(i.at)), cancelled: false, gstin: (!i.export && i.billedTo?.gstin) || null,
      buyer: i.billedTo?.name || i.billedTo?.email || '', pos, intra: !!i.intra, total: rs(i.total), export: i.export ? (i.lut ? 'WOPAY' : 'WPAY') : null, lines, irn: i.irn?.irn || null };
    if (d.kind === 'CRN') {
      const orig = i.against ? T.sinvoices.find({ userId: u.id, number: i.against }) : null;
      d.against = { number: i.against || '', day: orig ? ymd(new Date(orig.at)) : null };
      d.large = !!orig && isLarge({ gstin: d.gstin, export: d.export, intra: !!orig.intra, total: rs(orig.total) });
    } else d.large = isLarge(d);
    return d;
  };
  return { docs: all.map(docOf), warnings };
}
// the GSTR-1 table a document lands in
const sectionOf = (d) => (d.kind === 'INV'
  ? (d.export ? 'EXP' : d.gstin ? 'B2B' : d.large ? 'B2CL' : 'B2CS')
  : (d.export ? 'CDNUR' : d.gstin ? 'CDNR' : d.large ? 'CDNUR' : 'B2CS'));

function monthDocs(u, month, { counter = true, checkout = true } = {}) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month || '')) fail(400, 'Pick a month, like 2026-10');
  if (!counter && !checkout) fail(400, 'Include counter bills, checkout sales or both');
  const seller = sellerOf(u);
  if (!seller.gstin) fail(400, 'Add your GSTIN in Settings → GST invoices first — GSTR-1 is for registered businesses');
  const home = STATES[seller.state];
  const docs = [], warnings = [];
  if (counter) docs.push(...counterDocs(u, month, home));
  if (checkout) { const c = checkoutDocs(u, month, home); docs.push(...c.docs); warnings.push(...c.warnings); }
  docs.sort((a, b) => a.day.localeCompare(b.day) || a.number.localeCompare(b.number, 'en', { numeric: true }));
  for (const d of docs) d.section = sectionOf(d);
  // the same number on two documents of one kind (only possible from before the two sources shared a series)
  const seen = new Map();
  for (const d of docs) { const k = `${d.kind}|${d.number}`; seen.set(k, [...(seen.get(k) || []), d]); }
  for (const [k, list] of seen) if (list.length > 1) warnings.push(`${k.startsWith('INV') ? 'Invoice' : 'Credit note'} number ${k.slice(4)} is used ${list.length} times (${[...new Set(list.map((d) => (d.source === 'counter' ? 'counter' : 'checkout')))].join(' and ')}) — GST needs each number once; renumber one of them in the offline tool`);
  return { seller, home, docs, warnings };
}

// ---------- GSTR-1 ----------
const byRate = (lines) => {
  const m = new Map();
  for (const l of lines) { const x = m.get(l.rt) || { txval: 0, iamt: 0, camt: 0, samt: 0 }; x.txval += l.taxable; x.iamt += l.igst; x.camt += l.cgst; x.samt += l.sgst; m.set(l.rt, x); }
  return [...m].map(([rt, x], i) => ({ num: i + 1, itm_det: { txval: r2(x.txval), rt, iamt: r2(x.iamt), camt: r2(x.camt), samt: r2(x.samt), csamt: 0 } }));
};
export function gstr1(u, month, opts = {}) {
  const sources = { counter: opts.counter !== false, checkout: opts.checkout !== false };
  const { seller, home, docs, warnings } = monthDocs(u, month, sources);
  const live = docs.filter((d) => !d.cancelled), inv = live.filter((d) => d.kind === 'INV'), notes = live.filter((d) => d.kind === 'CRN');
  const json = { gstin: seller.gstin, fp: `${month.slice(5)}${month.slice(0, 4)}`, version: 'GST3.2.1', hash: 'hash', b2b: [], b2cl: [], b2cs: [], exp: [], cdnr: [], cdnur: [], hsn: { hsn_b2b: [], hsn_b2c: [] }, doc_issue: { doc_det: [] } };
  const invRow = (d) => ({ inum: d.number, idt: gstDate(d.day), val: r2(d.total), pos: d.pos, rchrg: 'N', inv_typ: 'R', itms: byRate(d.lines) });
  for (const d of inv.filter((x) => x.section === 'B2B')) { let r = json.b2b.find((x) => x.ctin === d.gstin); if (!r) json.b2b.push(r = { ctin: d.gstin, inv: [] }); r.inv.push(invRow(d)); }
  for (const d of inv.filter((x) => x.section === 'B2CL')) { let r = json.b2cl.find((x) => x.pos === d.pos); if (!r) json.b2cl.push(r = { pos: d.pos, inv: [] }); const { pos, rchrg, inv_typ, ...rest } = invRow(d); r.inv.push(rest); }
  // exports of services: no shipping bill, so sbpcode / sbnum / sbdt stay empty (the offline tool accepts that for services)
  for (const d of inv.filter((x) => x.section === 'EXP')) {
    let r = json.exp.find((x) => x.exp_typ === d.export); if (!r) json.exp.push(r = { exp_typ: d.export, inv: [] });
    r.inv.push({ inum: d.number, idt: gstDate(d.day), val: r2(d.total), sbpcode: '', sbnum: '', sbdt: '', itms: byRate(d.lines).map(({ itm_det: x }) => ({ txval: x.txval, rt: x.rt, iamt: x.iamt, csamt: 0 })) });
  }
  // b2cs: small B2C supplies summed by (intra / inter, place, rate); their credit notes come off the same rows
  const cs = new Map();
  const addCs = (d, sign) => { for (const l of d.lines) { const k = `${d.intra}|${d.pos}|${l.rt}`; const x = cs.get(k) || { sply_ty: d.intra ? 'INTRA' : 'INTER', pos: d.pos, typ: 'OE', rt: l.rt, txval: 0, iamt: 0, camt: 0, samt: 0, csamt: 0 }; x.txval += sign * l.taxable; x.iamt += sign * l.igst; x.camt += sign * l.cgst; x.samt += sign * l.sgst; cs.set(k, x); } };
  for (const d of inv.filter((x) => x.section === 'B2CS')) addCs(d, 1);
  const noteRow = (d) => ({ ntty: 'C', nt_num: d.number, nt_dt: gstDate(d.day), val: r2(d.total), pos: d.pos, rchrg: 'N', inv_typ: 'R', itms: byRate(d.lines) });
  for (const d of notes) {
    if (d.section === 'CDNR') { let r = json.cdnr.find((x) => x.ctin === d.gstin); if (!r) json.cdnr.push(r = { ctin: d.gstin, nt: [] }); r.nt.push(noteRow(d)); }
    else if (d.section === 'CDNUR') { const { rchrg, inv_typ, ...row } = noteRow(d); json.cdnur.push({ ...row, typ: d.export ? (d.export === 'WOPAY' ? 'EXPWOP' : 'EXPWP') : 'B2CL' }); }
    else addCs(d, -1);
  }
  json.b2cs = [...cs.values()].map((x) => ({ ...x, txval: r2(x.txval), iamt: r2(x.iamt), camt: r2(x.camt), samt: r2(x.samt) })).filter((x) => x.txval || x.iamt || x.camt || x.samt);
  // HSN summary net of credit notes, split B2B / B2C; services (SAC 99…) carry UQC NA and no quantity
  for (const [key, keep] of [['hsn_b2b', (d) => !!d.gstin], ['hsn_b2c', (d) => !d.gstin]]) {
    const m = new Map();
    for (const d of live.filter(keep)) {
      const sign = d.kind === 'CRN' ? -1 : 1;
      for (const l of d.lines) { const uqc = isService(l.hsn) ? 'NA' : l.uqc, k = `${l.hsn}|${l.rt}|${uqc}`; const x = m.get(k) || { hsn_sc: l.hsn, desc: l.name, uqc, qty: 0, rt: l.rt, txval: 0, iamt: 0, camt: 0, samt: 0, csamt: 0 }; x.qty += uqc === 'NA' ? 0 : sign * l.qty; x.txval += sign * l.taxable; x.iamt += sign * l.igst; x.camt += sign * l.cgst; x.samt += sign * l.sgst; m.set(k, x); }
    }
    json.hsn[key] = [...m.values()].map((x, i) => ({ num: i + 1, ...x, qty: r3(x.qty), txval: r2(x.txval), iamt: r2(x.iamt), camt: r2(x.camt), samt: r2(x.samt) }));
  }
  // documents issued: one row per number series (CB/2026-27, INV/2026-27, CN/2026-27…) under its document type, both
  // sources merged into a series they share; a number counts once, cancelled invoices are counted as cancelled
  for (const [kind, doc_num] of [['INV', 1], ['CRN', 5]]) {
    const series = new Map();
    for (const d of docs.filter((x) => x.kind === kind)) { const s = d.number.replace(/\d+$/, ''), m = series.get(s) || new Map(); m.set(d.number, (m.get(d.number) || false) || d.cancelled); series.set(s, m); }
    if (!series.size) continue;
    json.doc_issue.doc_det.push({ doc_num, docs: [...series.values()].map((m, i) => { const nums = [...m.keys()].sort((a, b) => a.localeCompare(b, 'en', { numeric: true })), cancel = [...m.values()].filter(Boolean).length; return { num: i + 1, from: nums[0], to: nums.at(-1), totnum: nums.length, cancel, net_issue: nums.length - cancel }; }) });
  }
  if (!json.exp.length) delete json.exp;
  const missingHsn = [...new Set(live.flatMap((d) => d.lines.filter((l) => !l.hsn).map((l) => l.name)))];
  if (missingHsn.length) warnings.push(`HSN code missing on ${missingHsn.slice(0, 5).join(', ')}${missingHsn.length > 5 ? ` and ${missingHsn.length - 5} more` : ''} — add it to the item (or product) so the HSN summary is complete`);
  const sum = (list, f) => r2(list.reduce((t, d) => t + d.lines.reduce((s, l) => s + f(l), 0), 0));
  const count = (src) => ({ invoices: inv.filter((d) => d.source === src).length, credit_notes: notes.filter((d) => d.source === src).length });
  return { month, sources, json, summary: {
    invoices: inv.length, cancelled: docs.filter((d) => d.cancelled).length, credit_notes: notes.length,
    b2b: inv.filter((d) => d.section === 'B2B').length, b2cl: inv.filter((d) => d.section === 'B2CL').length, exp: inv.filter((d) => d.section === 'EXP').length,
    by_source: { counter: count('counter'), checkout: count('checkout') },
    taxable: r2(sum(inv, (l) => l.taxable) - sum(notes, (l) => l.taxable)), tax: r2(sum(inv, (l) => l.igst + l.cgst + l.sgst) - sum(notes, (l) => l.igst + l.cgst + l.sgst)),
    warnings } };
}

// the same month as a sheet: one row per invoice / credit note, both sources
const csvCell = (v) => { let s = String(v ?? ''); if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`; return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
export function gstr1Csv(u, month, opts = {}) {
  const sources = { counter: opts.counter !== false, checkout: opts.checkout !== false };
  const { seller, docs } = monthDocs(u, month, sources);
  const head = ['Source', 'Document', 'Number', 'Date', 'Against invoice', 'Against date', 'Buyer', 'Buyer GSTIN', 'Place of supply', 'GSTR-1 table', 'Taxable value', 'GST rates', 'IGST', 'CGST', 'SGST', 'Cess', 'Total', 'Status', 'IRN'];
  const t = (d, k) => r2(d.lines.reduce((s, l) => s + l[k], 0));
  const rows = docs.map((d) => [d.source === 'counter' ? 'Counter bill' : 'Checkout', d.kind === 'INV' ? 'Invoice' : 'Credit note', d.number, gstDate(d.day), d.against?.number || '', d.against?.day ? gstDate(d.against.day) : '',
    d.buyer, d.gstin || '', `${d.pos}-${d.pos === '96' ? 'Other Countries' : STATE_BY_CODE[d.pos] || ''}`, d.section, t(d, 'taxable'), [...new Set(d.lines.map((l) => `${l.rt}%`))].join(' + '),
    t(d, 'igst'), t(d, 'cgst'), t(d, 'sgst'), 0, r2(d.total), d.cancelled ? 'Cancelled' : 'Issued', d.irn || '']);
  return { filename: `GSTR1_${seller.gstin}_${month.slice(5)}${month.slice(0, 4)}.csv`, csv: [head, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n', rows: rows.length };
}

// ---------- the documents an e-invoice / IRN / e-way bill is about ----------
export const SOURCES = { counter: 'ibills', 'counter-note': 'icnotes', checkout: 'sinvoices' };
function ownDoc(u, source, id) {
  if (!SOURCES[source]) fail(404, 'Unknown document type — counter, counter-note or checkout');
  if (source !== 'checkout' && !inventoryOn(u)) fail(403, 'Inventory isn’t switched on for your account — ask us to turn it on');
  const d = T[SOURCES[source]].get(String(id || ''));
  if (!d || d.userId !== u.id) fail(404, source === 'checkout' ? 'Invoice not found' : source === 'counter' ? 'Bill not found' : 'Credit note not found');
  return d;
}

// address helpers: the e-documents want two lines of up to 100 characters, a place (city / town) and a 6-digit PIN
const flat = (a) => String(a || '').split(/[\n,]+/).map((x) => x.trim()).filter(Boolean).join(', ');
function addrLines(a) {
  const s = flat(a);
  if (s.length <= 100) return [s, ''];
  let cut = s.lastIndexOf(', ', 100); if (cut < 20) cut = 100;
  return [s.slice(0, cut).trim(), s.slice(cut).replace(/^,\s*/, '').slice(0, 100).trim()];
}
const pinOf = (pin, address) => {
  const p = String(pin || '').replace(/\s/g, '');
  if (PIN_RE.test(p)) return p;
  const all = [...String(address || '').matchAll(/(?:^|\D)([1-9]\d{2})\s?(\d{3})(?!\d)/g)];
  return all.length ? all.at(-1)[1] + all.at(-1)[2] : null;
};
// the place: the city given, else the last part of the address that is a word (not the state, not the PIN)
function placeOf(city, address, state) {
  if (clip(city, 50).length >= 3) return clip(city, 50);
  const parts = flat(address).split(', ').map((p) => p.replace(/[-–]?\s*[1-9]\d{2}\s?\d{3}\b/g, '').trim()).filter((p) => /[a-z]{3}/i.test(p) && lower(p) !== lower(state) && !STATES[p]);
  const p = parts.at(-1) || state || '';
  return p.length >= 3 ? p.slice(0, 50) : null;
}
const phoneOf = (v) => { let d = String(v || '').replace(/\D/g, ''); if (d.length > 12) d = d.slice(-10); return d.length >= 6 ? d : undefined; };
const emailOf = (v) => { const s = clip(v, 100); return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s) && s.length >= 6 ? s : undefined; };
const HSN_RE = /^(\d{4}|\d{6}|\d{8})$/;
const DOCNO_RE = /^[A-Z1-9][A-Z0-9/-]{0,15}$/; // IRP: up to 16 characters, letters / digits / "/" / "-", not starting with 0, / or -
const drop = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== ''));

// the parties and lines of one tax invoice / credit note, whichever source it came from
function einvInput(u, source, d) {
  const cur = sellerOf(u), extra = d.einv_buyer || {};
  if (source !== 'checkout') {
    if (d.doc_type !== 'TAX_INVOICE') fail(400, `${d.number} is a plain bill, not a tax invoice — add your GSTIN in Settings → GST invoices before billing`);
    if (d.cancelled) fail(409, `Bill ${d.number} is cancelled — there’s nothing to report`);
    const s = d.seller || {}, b = d.buyer || {};
    return { typ: source === 'counter-note' ? 'CRN' : 'INV', number: d.number, day: d.day,
      seller: { gstin: s.gstin || cur.gstin, name: s.name || cur.name, address: s.address || cur.address, state: s.state || cur.state, pincode: s.pincode || cur.pincode, city: s.city || cur.city, phone: s.phone || cur.phone, email: s.email || cur.email },
      buyer: { gstin: b.gstin || null, name: b.name || d.party_name || '', address: extra.address || b.address || '', pincode: extra.pincode || b.pincode || null, city: extra.city || b.city || null, state: b.state || null, phone: extra.phone || b.phone || null, email: extra.email || b.email || null },
      pos: d.pos_code || null,
      lines: d.lines.map((l) => ({ name: l.name, hsn: l.hsn || '', service: isService(l.hsn), qty: Number(l.qty) || 0, free_qty: Number(l.free_qty) || 0, unit: uqcOf(l.unit), unit_price: l.qty ? (l.gross != null ? l.rate : r3(l.taxable / l.qty)) : 0, gross: l.gross ?? l.taxable, discount: l.discount || 0, taxable: l.taxable, rt: Number(l.gst_percent) || 0, igst: l.igst || 0, cgst: l.cgst || 0, sgst: l.sgst || 0 })),
      round_off: d.round_off || 0, ref: source === 'counter-note' ? { number: d.bill_number, day: d.bill_day } : null };
  }
  if (d.test) fail(400, `${d.number} is from a test-mode sale — e-invoices are only for real sales`);
  if (!d.registered) fail(400, `${d.number} was issued without a GSTIN, so it isn’t a tax invoice`);
  if (d.export) fail(400, `${d.number} is an export — export e-invoices need port and shipping details; make that one on the IRP portal`);
  const s = d.seller || {}, b = d.billedTo || {}, order = T.orders.get(d.orderId), a = order?.userId === u.id ? order.address : null;
  const orderAddr = a ? [a.line1, a.line2, a.city, a.state].filter(Boolean).join(', ') : '';
  const orig = d.type === 'credit' && d.against ? T.sinvoices.find({ userId: u.id, number: d.against }) : null;
  return { typ: d.type === 'credit' ? 'CRN' : 'INV', number: d.number, day: ymd(new Date(d.at)),
    seller: { gstin: s.gstin || cur.gstin, name: s.name || cur.name, address: s.address || cur.address, state: s.state || cur.state, pincode: cur.pincode, city: cur.city, phone: cur.phone, email: s.email || cur.email },
    buyer: { gstin: b.gstin || null, name: b.name || '', address: extra.address || orderAddr, pincode: extra.pincode || a?.pincode || null, city: extra.city || a?.city || null, state: b.state || null, phone: extra.phone || b.phone || null, email: extra.email || b.email || null },
    pos: STATES[d.placeOfSupply] || null,
    lines: d.items.map((l) => ({ name: l.name, hsn: l.sac || '', service: isService(l.sac), qty: 1, free_qty: 0, unit: isService(l.sac) ? 'OTH' : 'NOS', unit_price: l.taxable, gross: l.taxable, discount: 0, taxable: l.taxable, rt: Number(l.rate ?? d.rate) || 0, igst: l.igst || 0, cgst: l.cgst || 0, sgst: l.sgst || 0 })),
    round_off: 0, ref: d.type === 'credit' ? { number: d.against || '', day: orig ? ymd(new Date(orig.at)) : null } : null };
}

// ---------- e-invoice JSON, NIC schema version 1.1 ----------
export function einvoice(u, source, d) {
  const x = einvInput(u, source, d), s = x.seller, b = x.buyer, missing = [];
  const sState = s.gstin ? s.gstin.slice(0, 2) : STATES[s.state], bState = b.gstin ? b.gstin.slice(0, 2) : STATES[b.state];
  const sPin = pinOf(s.pincode, s.address), bPin = pinOf(b.pincode, b.address);
  const sLoc = placeOf(s.city, s.address, s.state), bLoc = placeOf(b.city, b.address, b.state);
  // what's missing, in plain words
  if (!s.gstin) missing.push('your GSTIN (Settings → GST invoices)');
  if (clip(s.name, 100).length < 3) missing.push('your legal business name (Settings → GST invoices)');
  if (!flat(s.address)) missing.push('your business address (Settings → GST invoices)');
  if (!sPin) missing.push('your 6-digit PIN code (Settings → GST invoices)');
  if (flat(s.address) && !sLoc) missing.push('your city or town (Settings → GST invoices)');
  if (!b.gstin) missing.push('the buyer’s GSTIN — e-invoices are only for sales to GST-registered businesses (B2B)');
  else if (!GSTIN_RE.test(b.gstin)) missing.push('a valid buyer GSTIN (15 characters, like 29AAACB1234C1Z5)');
  else if (b.gstin === s.gstin) missing.push('a buyer GSTIN different from your own');
  if (clip(b.name, 100).length < 3) missing.push('the buyer’s registered name');
  if (!flat(b.address)) missing.push('the buyer’s address');
  if (!bPin) missing.push('the buyer’s 6-digit PIN code');
  if (flat(b.address) && !bLoc) missing.push('the buyer’s city or town');
  if (!bState) missing.push('the buyer’s state');
  if (!x.pos) missing.push('the place of supply');
  if (!DOCNO_RE.test(x.number)) missing.push(`a document number the IRP accepts (up to 16 letters, digits, / or -, not starting with 0) — ${x.number} isn’t`);
  for (const l of x.lines) if (!HSN_RE.test(l.hsn)) missing.push(`${l.hsn ? 'a valid' : 'the'} HSN/SAC code on “${l.name}” (4, 6 or 8 digits)${l.hsn ? ` — ${l.hsn} isn’t` : ''}`);
  if (x.typ === 'CRN' && (!x.ref?.number || !x.ref?.day)) missing.push('the number and date of the invoice this credit note is against');
  if (!x.lines.length) missing.push('at least one line');
  if (x.lines.length > 1000) missing.push('no more than 1000 lines (the IRP’s limit)');
  if (missing.length) fail(422, `This ${x.typ === 'CRN' ? 'credit note' : 'invoice'} can’t become an e-invoice yet. Missing: ${missing.join('; ')}.`, { missing, number: x.number });

  const [sA1, sA2] = addrLines(s.address), [bA1, bA2] = addrLines(b.address);
  const items = x.lines.map((l, i) => {
    const ass = r2(l.gross - l.discount), tax = r2(l.igst + l.cgst + l.sgst);
    return { SlNo: String(i + 1), PrdDesc: clip(l.name, 300).padEnd(3, '.'), IsServc: l.service ? 'Y' : 'N', HsnCd: l.hsn, Qty: r3(l.qty), FreeQty: r3(l.free_qty), Unit: l.unit, UnitPrice: r3(l.unit_price), TotAmt: r2(l.gross), Discount: r2(l.discount), PreTaxVal: 0, AssAmt: ass,
      GstRt: l.rt, IgstAmt: r2(l.igst), CgstAmt: r2(l.cgst), SgstAmt: r2(l.sgst), CesRt: 0, CesAmt: 0, CesNonAdvlAmt: 0, StateCesRt: 0, StateCesAmt: 0, StateCesNonAdvlAmt: 0, OthChrg: 0, TotItemVal: r2(ass + tax) };
  });
  const sum = (k) => r2(items.reduce((t, i) => t + i[k], 0));
  const val = { AssVal: sum('AssAmt'), CgstVal: sum('CgstAmt'), SgstVal: sum('SgstAmt'), IgstVal: sum('IgstAmt'), CesVal: 0, StCesVal: 0, Discount: 0, OthChrg: 0, RndOffAmt: r2(x.round_off) };
  val.TotInvVal = r2(val.AssVal + val.CgstVal + val.SgstVal + val.IgstVal + val.RndOffAmt);
  const json = {
    Version: '1.1',
    TranDtls: { TaxSch: 'GST', SupTyp: 'B2B', RegRev: 'N', EcmGstin: null, IgstOnIntra: 'N' },
    DocDtls: { Typ: x.typ, No: x.number, Dt: slashDate(x.day) },
    SellerDtls: drop({ Gstin: s.gstin, LglNm: clip(s.name, 100), Addr1: sA1, Addr2: sA2.length >= 3 ? sA2 : undefined, Loc: sLoc, Pin: Number(sPin), Stcd: sState, Ph: phoneOf(s.phone), Em: emailOf(s.email) }),
    BuyerDtls: drop({ Gstin: b.gstin, LglNm: clip(b.name, 100), Pos: x.pos, Addr1: bA1, Addr2: bA2.length >= 3 ? bA2 : undefined, Loc: bLoc, Pin: Number(bPin), Stcd: bState, Ph: phoneOf(b.phone), Em: emailOf(b.email) }),
    ItemList: items,
    ValDtls: val,
    ...(x.typ === 'CRN' ? { RefDtls: { PrecDocDtls: [{ InvNo: x.ref.number, InvDt: slashDate(x.ref.day) }] } } : {}),
  };
  return { json, filename: `EINV_${x.number.replace(/[^A-Za-z0-9-]/g, '-')}.json`, number: x.number, type: x.typ };
}
// buyer details the seller adds for the e-invoice (a checkout sale has no address unless it shipped)
function saveBuyerExtra(source, d, body) {
  const b = body && typeof body === 'object' ? body : null;
  if (!b) return d;
  const pin = String(b.pincode ?? '').replace(/\s/g, '');
  if (pin && !PIN_RE.test(pin)) fail(400, 'The buyer’s PIN code has 6 digits, like 560001');
  const patch = drop({ address: clip(b.address, 300) || undefined, pincode: pin || undefined, city: clip(b.city, 50) || undefined, phone: clip(b.phone, 20) || undefined, email: clip(b.email, 100) || undefined });
  if (!Object.keys(patch).length) return d;
  return T[SOURCES[source]].update(d.id, (x) => { x.einv_buyer = { ...(x.einv_buyer || {}), ...patch }; });
}

// ---------- IRN, ack and signed QR, as the IRP (or a GSP) returned them ----------
export function setIrn(u, source, d, body = {}) {
  const irn = String(body.irn || '').trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(irn)) fail(400, 'The IRN is 64 letters and digits (0–9, a–f) — copy it from the IRP portal');
  if (source === 'checkout' ? !d.billedTo?.gstin : !d.buyer?.gstin) fail(400, `${d.number} has no buyer GSTIN — only B2B invoices get an IRN`);
  if (d.cancelled) fail(409, `${d.number} is cancelled`);
  const dup = [...T.ibills.all({ userId: u.id }), ...T.icnotes.all({ userId: u.id }), ...T.sinvoices.all({ userId: u.id })].find((x) => x.id !== d.id && x.irn?.irn === irn);
  if (dup) fail(409, `That IRN is already on ${dup.number}`);
  const ack = String(body.ack_no ?? '').replace(/\s/g, '');
  if (ack && !/^\d{10,20}$/.test(ack)) fail(400, 'The acknowledgement number is digits only, like 112010000012345');
  const ackDt = clip(body.ack_dt, 25);
  if (ackDt && !/^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}(:\d{2})?)?$|^\d{2}[/-]\d{2}[/-]\d{4}( \d{2}:\d{2}(:\d{2})?)?$/.test(ackDt)) fail(400, 'The acknowledgement date looks like 2026-10-29 14:05:00');
  const qr = String(body.signed_qr || '').trim();
  if (qr && (qr.length > 6000 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(qr))) fail(400, 'The signed QR code is the long text from the IRP — three parts separated by dots');
  const rec = { irn, ack_no: ack || null, ack_dt: ackDt || null, signed_qr: qr || null, at: Date.now(), by: body.by === 'gsp' ? 'gsp' : 'manual' };
  T[SOURCES[source]].update(d.id, (x) => { x.irn = rec; });
  return rec;
}

// ---------- e-way bill JSON (bulk generation, version 1.0.1118) ----------
// Needed when a consignment of goods is worth more than ₹50,000 (Rule 138): always for inter-state movement; within a
// state, some states set a higher limit. The table is the commonly published one (2025) — check your state's notice.
export const EWAY_LIMIT = 50000;
export const INTRA_LIMITS = { Maharashtra: 100000, Delhi: 100000, 'Tamil Nadu': 100000, Punjab: 100000, Bihar: 100000, 'Madhya Pradesh': 100000, Rajasthan: 100000, 'West Bengal': 50000, Karnataka: 50000, Gujarat: 50000, 'Uttar Pradesh': 50000, Telangana: 50000 };
const MODES = { road: 1, rail: 2, air: 3, ship: 4 };
const VEHICLE_RE = /^[A-Z]{2}[0-9]{1,2}[A-Z]{0,3}[0-9]{4}$|^[0-9]{2}BH[0-9]{4}[A-Z]{1,2}$|^TR[A-Z0-9]{6,13}$/;
export function ewayCheck(u, b) {
  const value = r2(b.lines.filter((l) => !isService(l.hsn)).reduce((s, l) => s + l.taxable + (l.gst || 0), 0));
  const intra = b.intra !== false, state = b.seller?.state || sellerOf(u).state;
  const limit = intra ? INTRA_LIMITS[state] || EWAY_LIMIT : EWAY_LIMIT;
  const required = value > limit;
  return { value, limit, intra, required, message: required ? `Needed: goods worth ${inr(value)} — over the ${inr(limit)} limit for ${intra ? `movement within ${state || 'your state'}` : 'inter-state movement'}`
    : `Not needed: goods worth ${inr(value)} are within the ${inr(limit)} limit for ${intra ? `movement within ${state || 'your state'}` : 'inter-state movement'} — you can still make one if you want` };
}
function cleanTransport(t = {}) {
  const errors = [];
  const mode = lower(t.mode), tid = clip(t.transporter_id, 15).toUpperCase(), veh = clip(t.vehicle_no, 20).toUpperCase().replace(/[\s-]/g, '');
  const dist = Number(t.distance);
  if (mode && !MODES[mode]) errors.push('how it travels: road, rail, air or ship');
  if (!mode && !tid) errors.push('how it travels (road, rail, air or ship), or the transporter’s ID so they can fill in the vehicle');
  if (t.distance === '' || t.distance == null || !Number.isInteger(dist) || dist < 0 || dist > 4000) errors.push('the distance in whole km (0–4000; 0 lets the portal work it out from the PIN codes)');
  if (tid && !/^[0-9]{2}[A-Z0-9]{13}$/.test(tid)) errors.push('a valid transporter ID (15 characters — their GSTIN or TRANSIN)');
  if (mode === 'road' && !veh && !tid) errors.push('the vehicle number (like MH12AB1234)');
  if (veh && !VEHICLE_RE.test(veh)) errors.push(`a valid vehicle number — ${veh} isn’t (like MH12AB1234)`);
  const docNo = clip(t.doc_no, 15), docDay = /^\d{4}-\d{2}-\d{2}$/.test(t.doc_date || '') ? t.doc_date : '';
  if (['rail', 'air', 'ship'].includes(mode) && (!docNo || !docDay)) errors.push(`the ${mode === 'rail' ? 'railway receipt' : mode === 'air' ? 'airway bill' : 'bill of lading'} number and date`);
  const vtype = t.vehicle_type === 'O' ? 'O' : 'R';
  return { errors, transport: { mode: mode || null, distance: Number.isInteger(dist) ? dist : null, vehicle_no: veh || null, vehicle_type: vtype, transporter_id: tid || null, transporter_name: clip(t.transporter_name, 100) || null, doc_no: docNo || null, doc_date: docDay || null } };
}
export function ewayBill(u, b, body = {}) {
  if (b.cancelled) fail(409, `Bill ${b.number} is cancelled`);
  if (b.doc_type !== 'TAX_INVOICE') fail(400, `${b.number} is a plain bill — an e-way bill needs your GSTIN on a tax invoice (Settings → GST invoices)`);
  const chk = ewayCheck(u, b);
  if (!chk.required && body.voluntary !== true) fail(409, chk.message, { code: 'EWAY_NOT_NEEDED', ...chk });
  const { errors, transport } = cleanTransport(body.transport || {});
  const cur = sellerOf(u), s = { ...cur, ...Object.fromEntries(Object.entries(b.seller || {}).filter(([, v]) => v)) }, by = b.buyer || {}, extra = b.einv_buyer || {};
  const toAddr = extra.address || by.address || '', toPin = pinOf(extra.pincode || by.pincode, toAddr), fromPin = pinOf(s.pincode, s.address);
  const fromPlace = placeOf(s.city, s.address, s.state), toPlace = placeOf(extra.city || by.city, toAddr, by.state || s.state);
  const toState = Number(b.pos_code || STATES[s.state]);
  if (!flat(s.address)) errors.push('your business address (Settings → GST invoices)');
  if (!fromPin) errors.push('your 6-digit PIN code (Settings → GST invoices)');
  if (flat(s.address) && !fromPlace) errors.push('your city or town (Settings → GST invoices)');
  if (!flat(toAddr)) errors.push('the buyer’s delivery address');
  if (!toPin) errors.push('the buyer’s 6-digit PIN code');
  if (!toState) errors.push('the buyer’s state');
  for (const l of b.lines) if (!HSN_RE.test(l.hsn || '')) errors.push(`the HSN code on “${l.name}” (4, 6 or 8 digits)`);
  if (errors.length) fail(422, `The e-way bill for ${b.number} can’t be made yet. Missing: ${errors.join('; ')}.`, { missing: errors, ...chk });
  const fromState = Number(s.gstin.slice(0, 2)), [fA1, fA2] = addrLines(s.address), [tA1, tA2] = addrLines(toAddr);
  const goods = b.lines.filter((l) => !isService(l.hsn));
  const sum = (k) => r2(goods.reduce((t, l) => t + (l[k] || 0), 0));
  const main = [...goods].sort((x, y) => y.taxable - x.taxable)[0];
  const bill = {
    userGstin: s.gstin, supplyType: 'O', subSupplyType: 1, subSupplyDesc: '', docType: 'INV', docNo: b.number, docDate: slashDate(b.day), transType: 1,
    fromGstin: s.gstin, fromTrdName: clip(s.name, 100), fromAddr1: fA1, fromAddr2: fA2, fromPlace, fromPincode: Number(fromPin), fromStateCode: fromState, actualFromStateCode: fromState,
    toGstin: by.gstin || 'URP', toTrdName: clip(by.name || b.party_name || '', 100), toAddr1: tA1, toAddr2: tA2, toPlace: toPlace || '', toPincode: Number(toPin), toStateCode: toState, actualToStateCode: toState,
    totalValue: sum('taxable'), cgstValue: sum('cgst'), sgstValue: sum('sgst'), igstValue: sum('igst'), cessValue: 0, TotNonAdvolVal: 0, OthValue: r2(b.round_off || 0), totInvValue: r2(sum('taxable') + sum('cgst') + sum('sgst') + sum('igst') + (b.round_off || 0)),
    transMode: transport.mode ? MODES[transport.mode] : '', transDistance: transport.distance, transporterName: transport.transporter_name || '', transporterId: transport.transporter_id || '',
    transDocNo: transport.doc_no || '', transDocDate: transport.doc_date ? slashDate(transport.doc_date) : '', vehicleNo: transport.vehicle_no || '', vehicleType: transport.mode === 'road' || transport.vehicle_no ? transport.vehicle_type : '',
    mainHsnCode: Number(main.hsn),
    itemList: goods.map((l, i) => ({ itemNo: i + 1, productName: clip(l.name, 100), productDesc: clip(l.name, 100), hsnCode: Number(l.hsn), quantity: r3(Number(l.qty) + (Number(l.free_qty) || 0)), qtyUnit: uqcOf(l.unit),
      taxableAmount: r2(l.taxable), sgstRate: l.sgst ? r2(l.gst_percent / 2) : 0, cgstRate: l.cgst ? r2(l.gst_percent / 2) : 0, igstRate: l.igst ? Number(l.gst_percent) : 0, cessRate: 0, cessNonAdvol: 0 })),
  };
  T.ibills.update(b.id, (x) => { x.eway = { transport, at: Date.now() }; });
  return { json: { version: '1.0.1118', billLists: [bill] }, filename: `EWB_${b.number.replace(/[^A-Za-z0-9-]/g, '-')}.json`, ...chk };
}

// ---------- routes ----------
export function registerGstReturns(app, { auth, rateLimit, isTest }) {
  const send = (fn) => (req, res) => Promise.resolve().then(() => fn(req, res)).then((d) => { if (d !== undefined) res.json(d); }).catch((e) => {
    if (e.status >= 400 && e.status < 500) return res.status(e.status).json({ error: e.message, ...(e.extra || {}) });
    console.error(e); res.status(500).json({ error: e.message });
  });
  const writeLimit = rateLimit({ windowMs: 60000, max: isTest ? 5000 : 120, key: (req) => req.user.id, message: 'Too many changes at once — wait a minute.' });
  const opts = (req) => ({ counter: req.query.counter !== '0', checkout: req.query.checkout !== '0' });
  // GSTR-1: ?month=2026-10&counter=0|1&checkout=0|1 (both by default)
  app.get('/api/gst/gstr1', auth, send((req) => gstr1(req.user, clip(req.query.month, 7), opts(req))));
  app.get('/api/gst/gstr1.csv', auth, send((req, res) => {
    const { filename, csv } = gstr1Csv(req.user, clip(req.query.month, 7), opts(req));
    res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${filename}"`, 'Cache-Control': 'no-store' }).send('﻿' + csv);
  }));
  // e-invoice JSON for one document; a body { buyer: { address, pincode, city, phone, email } } fills in what's missing first
  app.post('/api/gst/einvoice/:source/:id', auth, writeLimit, send((req) => {
    const d = saveBuyerExtra(req.params.source, ownDoc(req.user, req.params.source, req.params.id), req.body?.buyer);
    return { ...einvoice(req.user, req.params.source, d), irn: d.irn || null };
  }));
  app.put('/api/gst/irn/:source/:id', auth, writeLimit, send((req) => ({ ok: true, irn: setIrn(req.user, req.params.source, ownDoc(req.user, req.params.source, req.params.id), req.body || {}) })));
  app.delete('/api/gst/irn/:source/:id', auth, writeLimit, send((req) => { const d = ownDoc(req.user, req.params.source, req.params.id); T[SOURCES[req.params.source]].update(d.id, (x) => { delete x.irn; }); return { ok: true }; }));
  // e-way bills for counter bills: whether one is needed, and the JSON from the transport details
  app.get('/api/gst/eway/:id', auth, send((req) => { const b = ownDoc(req.user, 'counter', req.params.id); return { number: b.number, ...ewayCheck(req.user, b), transport: b.eway?.transport || null, buyer: { address: b.einv_buyer?.address || b.buyer?.address || '', pincode: pinOf(b.einv_buyer?.pincode || b.buyer?.pincode, b.einv_buyer?.address || b.buyer?.address) || '' } }; }));
  app.post('/api/gst/eway/:id', auth, writeLimit, send((req) => {
    const b = saveBuyerExtra('counter', ownDoc(req.user, 'counter', req.params.id), req.body?.buyer);
    return ewayBill(req.user, b, req.body || {});
  }));
}
