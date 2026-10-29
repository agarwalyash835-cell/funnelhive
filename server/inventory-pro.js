// Inventory for each industry (phase 3), on top of inventory-core.js: manufacturers' bills of materials, distributors'
// batches / expiry / schemes, retailers' variants and counter billing, traders' rate lists and credit limits.
// Routes live under /api/inventory/pro. Every stock change is a move through addMove — nothing keeps a running total,
// so cancelling a counter bill or a production run is just deleting its moves.
import { T, q, tx, uid } from './db.js';
import { inventoryOn, mainGodown, stockOf, addMove, MOVE_SOURCES } from './inventory-core.js';
import { tallyOn, selectedCompany } from './tally.js';

const fail = (status, error, extra) => { throw Object.assign(new Error(error), { status, extra }); };
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const r3 = (n) => Math.round((Number(n) || 0) * 1000) / 1000;
const lower = (v) => String(v || '').trim().toLowerCase();
const clip = (v, n = 120) => (v == null ? '' : String(v).trim().slice(0, n));
const ymd = (d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(d);
const addDays = (day, n) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const isDay = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v || '');
const pos = (v, what) => { const n = Number(v); if (!Number.isFinite(n) || n <= 0) fail(400, `${what} must be more than 0`); return n; };
const itemView = (i) => i && { id: i.id, name: i.name, unit: i.unit || '', sku: i.sku || null, barcode: i.barcode || null };

// the industry each CRM kit maps to, and the order its tools show in (all are always available)
export const SECTIONS = ['bom', 'batches', 'schemes', 'variants', 'counter', 'rates', 'credit'];
const ORDER = {
  manufacturer: ['bom', 'batches', 'rates', 'credit', 'schemes', 'variants', 'counter'],
  distributor: ['batches', 'schemes', 'rates', 'credit', 'counter', 'bom', 'variants'],
  retailer: ['counter', 'variants', 'schemes', 'batches', 'rates', 'credit', 'bom'],
  store: ['variants', 'counter', 'schemes', 'batches', 'rates', 'credit', 'bom'],
};
export const industryOf = (u) => (ORDER[u?.settings?.crmKit?.id] ? u.settings.crmKit.id : null);

// ---------- items ----------
const ownItem = (userId, id) => { const i = id && T.iitems.get(id); if (!i || i.userId !== userId) fail(404, 'That item isn’t in your inventory'); return i; };
// an item from what a person (or Hive) typed: id, barcode, SKU, exact name, or every word found in one item's name
export function findItem(userId, ref) {
  const s = clip(ref, 200);
  if (!s) fail(400, 'Which item?');
  const byId = T.iitems.get(s);
  if (byId && byId.userId === userId) return byId;
  const exact = T.iitems.find({ userId, barcode: s, active: 1 }) || T.iitems.find({ userId, sku: lower(s), active: 1 }) || T.iitems.find({ userId, lname: lower(s), active: 1 });
  if (exact) return exact;
  const words = lower(s).split(/[\s,/-]+/).filter(Boolean);
  const hay = (i) => lower([i.name, i.sku, ...Object.values(i.attrs || {})].join(' '));
  const hits = T.iitems.all({ userId, active: 1 }).filter((i) => words.every((w) => hay(i).split(/[\s,/-]+/).some((x) => x === w || (w.length > 2 && x.startsWith(w)))));
  const leaf = hits.filter((i) => !hits.some((j) => j.parent_id === i.id)); // "shirt M blue" means the variant, not its parent
  if (leaf.length === 1) return leaf[0];
  if (!leaf.length) fail(404, `No item called “${s}” in your inventory`);
  fail(400, `“${s}” matches ${leaf.length} items: ${leaf.slice(0, 6).map((i) => i.name).join(', ')} — say which one`);
}

// ---------- batches & expiry (distributors) ----------
// stock per batch: the sum of moves carrying that batch; its expiry is the one recorded when it came in
export function batchStock(userId, { itemId = null, godownId = null } = {}) {
  const where = ['userId = ?'], args = [userId];
  if (itemId) { where.push('itemId = ?'); args.push(itemId); }
  if (godownId) { where.push('godownId = ?'); args.push(godownId); }
  return q(`SELECT itemId, json_extract(data, '$.batch') AS batch, MIN(json_extract(data, '$.expiry')) AS expiry, SUM(json_extract(data, '$.qty')) AS n
    FROM imoves WHERE ${where.join(' AND ')} GROUP BY itemId, json_extract(data, '$.batch')`).all(...args)
    .map((r) => ({ itemId: r.itemId, batch: r.batch || null, expiry: r.expiry || null, qty: r3(r.n) }));
}
// first-expiry-first-out: which batches to sell qty from (no-expiry stock last, unbatched stock after that); expired
// batches are never suggested — they're listed so the seller can return or write them off
export function fefo(userId, itemId, qty, godownId = null, today = ymd()) {
  const all = batchStock(userId, { itemId, godownId }).filter((b) => b.qty > 0.0005);
  const expired = all.filter((b) => b.expiry && b.expiry < today), open = all.filter((b) => !expired.includes(b))
    .sort((a, b) => (!a.batch) - (!b.batch) || (!a.expiry) - (!b.expiry) || String(a.expiry).localeCompare(String(b.expiry)) || String(a.batch).localeCompare(String(b.batch)));
  const take = [];
  let left = r3(qty);
  for (const b of open) { if (left <= 0) break; const n = r3(Math.min(left, b.qty)); take.push({ batch: b.batch, expiry: b.expiry, qty: n }); left = r3(left - n); }
  return { take, short: left > 0 ? left : 0, expired };
}
export function expiring(userId, days = 30, today = ymd()) {
  const until = addDays(today, days);
  const names = new Map();
  return batchStock(userId).filter((b) => b.qty > 0.0005 && b.expiry && b.expiry <= until)
    .sort((a, b) => a.expiry.localeCompare(b.expiry))
    .map((b) => {
      const i = names.get(b.itemId) || T.iitems.get(b.itemId); names.set(b.itemId, i);
      return { ...b, item: i?.name || '?', unit: i?.unit || '', value: r2(b.qty * (Number(i?.purchase_rate) || 0)), expired: b.expiry < today, days_left: Math.round((Date.parse(b.expiry) - Date.parse(today)) / 86400000) };
    });
}

// ---------- bills of materials (manufacturers) ----------
const bomView = (b) => {
  const f = T.iitems.get(b.itemId);
  return { id: b.id, itemId: b.itemId, item: f?.name || '?', unit: f?.unit || '', note: b.note || '', lines: b.lines.map((l) => { const c = T.iitems.get(l.itemId); return { itemId: l.itemId, name: c?.name || '?', unit: c?.unit || '', qty: l.qty }; }) };
};
function saveBom(userId, body) {
  const f = ownItem(userId, body.itemId);
  const seen = new Set();
  const lines = (Array.isArray(body.lines) ? body.lines : []).filter((l) => l && l.itemId).map((l) => {
    const c = ownItem(userId, l.itemId);
    if (c.id === f.id) fail(400, `${f.name} can’t be made from itself`);
    if (seen.has(c.id)) fail(400, `${c.name} is listed twice — put the total per unit on one line`);
    seen.add(c.id);
    return { itemId: c.id, qty: r3(pos(l.qty, `Quantity of ${c.name}`)) };
  });
  if (!lines.length) fail(400, 'Add at least one component');
  if (lines.length > 100) fail(400, 'Up to 100 components');
  const cur = T.iboms.find({ userId, itemId: f.id });
  return bomView(T.iboms.put({ ...(cur || { id: uid(), userId, itemId: f.id }), lines, note: clip(body.note, 300), at: Date.now() }));
}
const ownBom = (userId, id) => { const b = T.iboms.get(id) || T.iboms.find({ userId, itemId: id }); if (!b || b.userId !== userId) fail(404, 'No bill of materials for that'); return b; };
// what N units need, against what's in the godown
export function requirement(userId, bom, qty, godownId = null) {
  const n = pos(qty, 'Quantity');
  const g = godownId || mainGodown(userId).id;
  const lines = bom.lines.map((l) => {
    const c = T.iitems.get(l.itemId);
    const need = r3(l.qty * n), have = stockOf(l.itemId, g);
    return { itemId: l.itemId, name: c?.name || '?', unit: c?.unit || '', per: l.qty, need, have, short: r3(Math.max(0, need - have)), cost: r2(need * (Number(c?.purchase_rate) || 0)) };
  });
  const canMake = Math.floor(Math.min(...bom.lines.map((l) => stockOf(l.itemId, g) / l.qty)) + 1e-9);
  return { item: T.iitems.get(bom.itemId)?.name, qty: n, lines, can_make: Math.max(0, canMake), cost: r2(lines.reduce((s, l) => s + l.cost, 0)), short: lines.filter((l) => l.short > 0) };
}
// produce N: CONSUME every component and PRODUCE the finished item in one transaction — all or nothing
export function produce(userId, bom, { qty, godownId, day, note, source } = {}) {
  const g = godownId ? T.igodowns.get(godownId) : mainGodown(userId);
  if (!g || g.userId !== userId) fail(404, 'That godown isn’t yours');
  const r = requirement(userId, bom, qty, g.id);
  if (r.short.length) fail(409, `Not enough to make ${r.qty} ${r.item}: short of ${r.short.map((l) => `${l.short} ${l.unit} ${l.name}`.replace('  ', ' ')).join(', ')}`, { shortfall: r.short, can_make: r.can_make });
  const ref = `PRD-${Date.now().toString(36).toUpperCase()}`, src = MOVE_SOURCES.includes(source) ? source : 'BOM';
  const moves = tx(() => [
    ...r.lines.map((l) => addMove(userId, { itemId: l.itemId, godownId: g.id, qty: l.need, kind: 'CONSUME', day, ref, source: src, note: `For ${r.qty} ${r.item}` })),
    addMove(userId, { itemId: bom.itemId, godownId: g.id, qty: r.qty, kind: 'PRODUCE', rate: r.qty ? r2(r.cost / r.qty) : null, day, ref, source: src, note: clip(note, 300) || null }),
  ]);
  return { ok: true, ref, produced: r.qty, item: r.item, consumed: r.lines.map(({ itemId, name, unit, need }) => ({ itemId, name, unit, qty: need })), cost: r.cost, moves: moves.map((m) => m.id), stock: stockOf(bom.itemId, g.id) };
}

// ---------- schemes (distributors): buy X get Y free, or % off ----------
const KINDS = ['FREE', 'PERCENT'];
function saveScheme(userId, body, cur) {
  const i = ownItem(userId, body.itemId ?? cur?.itemId);
  const kind = body.kind ?? cur?.kind;
  if (!KINDS.includes(kind)) fail(400, 'Scheme type is FREE (buy X get Y free) or PERCENT (% off)');
  const named = body.name !== undefined ? !!clip(body.name) : !!cur?.named; // a name the seller typed is kept; ours follows the terms
  const s = { ...(cur || { id: uid(), userId }), itemId: i.id, kind, named, name: named ? clip(body.name ?? cur?.name, 80) : '', active: body.active ?? cur?.active ?? true, at: Date.now(),
    from: isDay(body.from ?? cur?.from) ? (body.from ?? cur?.from) : null, to: isDay(body.to ?? cur?.to) ? (body.to ?? cur?.to) : null };
  if (kind === 'FREE') Object.assign(s, { buy: Math.floor(pos(body.buy ?? cur?.buy, 'Buy quantity')), free: Math.floor(pos(body.free ?? cur?.free, 'Free quantity')), pct: null, min_qty: null });
  else { const p = pos(body.pct ?? cur?.pct, 'Discount %'); if (p > 100) fail(400, 'Discount can’t be over 100%'); Object.assign(s, { pct: r2(p), min_qty: Number(body.min_qty ?? cur?.min_qty) > 0 ? r3(body.min_qty ?? cur?.min_qty) : 1, buy: null, free: null }); }
  s.name ||= kind === 'FREE' ? `Buy ${s.buy} get ${s.free} free` : `${s.pct}% off${s.min_qty > 1 ? ` on ${s.min_qty}+` : ''}`;
  return T.ischemes.put(s);
}
const live = (s, day) => s.active !== false && (!s.from || s.from <= day) && (!s.to || s.to >= day);
// the best scheme for a sale line (the one worth most to the buyer); free units go out of stock too, at ₹0
export function schemeFor(userId, item, qty, rate, day = ymd()) {
  let best = null;
  for (const s of T.ischemes.all({ userId, itemId: item.id }).filter((x) => live(x, day))) {
    const o = s.kind === 'FREE'
      ? (qty >= s.buy ? { free_qty: Math.floor(qty / s.buy) * s.free, discount: 0 } : null)
      : (qty >= (s.min_qty || 1) ? { free_qty: 0, discount: r2((qty * rate * s.pct) / 100) } : null);
    if (!o) continue;
    const value = o.discount + o.free_qty * rate;
    // the terms ride on the bill line, so a later return reprices by the scheme as it was on the day of sale
    if (!best || value > best.value) best = { ...o, value, scheme: { id: s.id, name: s.name, kind: s.kind, ...(s.kind === 'FREE' ? { buy: s.buy, free: s.free } : { pct: s.pct, min_qty: s.min_qty }) } };
  }
  return best;
}
// one sale line: rate (pre-GST), scheme, GST from the item
export function priceLine(userId, item, { qty, rate, schemes = true, day } = {}) {
  const n = r3(pos(qty, `Quantity of ${item.name}`));
  const rt = r2(rate != null && rate !== '' ? rate : item.sale_rate);
  if (!(rt >= 0)) fail(400, `Rate of ${item.name} is missing`);
  const sc = schemes ? schemeFor(userId, item, n, rt, day) : null;
  const gross = r2(n * rt), discount = sc?.discount || 0, taxable = r2(gross - discount), gp = Number(item.gst_percent) || 0, gst = r2((taxable * gp) / 100);
  return { itemId: item.id, name: item.name, unit: item.unit || '', hsn: item.hsn || null, qty: n, free_qty: sc?.free_qty || 0, rate: rt, gross, discount, scheme: sc?.scheme || null, taxable, gst_percent: gp, gst, amount: r2(taxable + gst) };
}

// ---------- rate lists & credit limits (traders) ----------
const ownList = (userId, ref) => {
  if (!ref) return null;
  const l = T.iratelists.get(ref) || T.iratelists.find({ userId, lname: lower(ref) });
  if (!l || l.userId !== userId) fail(404, `No rate list “${ref}”`);
  return l;
};
function saveList(userId, body, cur) {
  const name = clip(body.name ?? cur?.name, 60);
  if (!name) fail(400, 'Name the rate list (e.g. Wholesale)');
  const dupe = T.iratelists.find({ userId, lname: lower(name) });
  if (dupe && dupe.id !== cur?.id) fail(409, `There’s already a rate list called ${dupe.name}`);
  const rates = { ...(cur?.rates || {}) };
  for (const [id, v] of Object.entries(body.rates || {})) {
    if (v === null || v === '') { delete rates[id]; continue; }
    ownItem(userId, id);
    const n = Number(v); if (!Number.isFinite(n) || n < 0) fail(400, 'A rate must be ₹0 or more');
    rates[id] = r2(n);
  }
  return T.iratelists.put({ ...(cur || { id: uid(), userId }), name, rates, at: Date.now() });
}
const creditOf = (userId, party) => (party ? T.icredit.find({ userId, lparty: lower(party) }) : null);
// a sale rate: the named list (or the party's own list), else the item's sale rate
export function rateFor(userId, item, { list, party } = {}) {
  const l = list ? ownList(userId, list) : (creditOf(userId, party)?.ratelistId && T.iratelists.get(creditOf(userId, party).ratelistId)) || null;
  if (l && l.rates[item.id] != null) return { rate: l.rates[item.id], source: 'list', list: { id: l.id, name: l.name } };
  return { rate: Number(item.sale_rate) || 0, source: 'item', list: l ? { id: l.id, name: l.name } : null };
}
const OPEN = ['PENDING', 'PARTIAL', 'OVERDUE'];
// what a party owes: their open receivable bills in the Tally mirror when the seller uses Tally, else their unpaid
// credit counter bills here
export function outstanding(u, party) {
  const lp = lower(party);
  const c = tallyOn(u) && selectedCompany(u.id);
  if (c) {
    const bills = T.touts.all({ companyId: c.id, active: 1 }).filter((o) => o.bill_type === 'RECEIVABLE' && OPEN.includes(o.status) && lower(o.party_name) === lp);
    return { source: 'tally', amount: r2(bills.reduce((s, o) => s + Math.abs(Number(o.pending_amount) || 0), 0)), bills: bills.length };
  }
  // a credit note refunded as credit comes off its own unpaid bill, or (on a paid / cash bill) off the party's account
  const bills = T.ibills.all({ userId: u.id, lparty: lp }).filter((b) => b.credit && !b.paid && !b.cancelled);
  const notes = T.icnotes.all({ userId: u.id, lparty: lp }).filter((n) => n.refund_mode === 'credit');
  const off = (b) => notes.filter((n) => n.applies_to === 'bill' && n.billId === b.id).reduce((s, n) => s + n.total, 0);
  const account = notes.filter((n) => n.applies_to === 'account').reduce((s, n) => s + n.total, 0);
  return { source: 'bills', amount: r2(bills.reduce((s, b) => s + b.total - off(b), 0) - account), bills: bills.length };
}
export function creditCheck(u, party, amount = 0) {
  const cr = creditOf(u.id, party), out = outstanding(u, party);
  const limit = cr ? cr.limit : null, after = r2(out.amount + (Number(amount) || 0));
  const over = limit != null && after > limit + 0.005;
  const inr = (n) => `₹${Math.round(n).toLocaleString('en-IN')}`;
  return { party_name: cr?.party_name || clip(party, 120), limit, outstanding: out.amount, outstanding_from: out.source, open_bills: out.bills, amount: r2(amount), after, available: limit == null ? null : r2(limit - out.amount), over, by: over ? r2(after - limit) : 0,
    message: limit == null ? `No credit limit set for ${clip(party, 120)}` : over ? `${clip(party, 120)} would owe ${inr(after)} — ${inr(after - limit)} over their ${inr(limit)} credit limit` : `${clip(party, 120)} owes ${inr(out.amount)} of a ${inr(limit)} limit` };
}

// ---------- variants (retailers): size / colour as items with parent_id + attrs ----------
const variantsOf = (userId, parentId) => T.iitems.all({ userId, active: 1 }).filter((i) => i.parent_id === parentId);
function variantGrid(userId, parent) {
  const kids = variantsOf(userId, parent.id);
  const uniq = (k) => [...new Set(kids.map((i) => i.attrs?.[k]).filter(Boolean))];
  return { parent: itemView(parent), sizes: uniq('size'), colours: uniq('colour'), cells: kids.map((i) => ({ ...itemView(i), size: i.attrs?.size || null, colour: i.attrs?.colour || null, stock: stockOf(i.id), sale_rate: i.sale_rate ?? null })) };
}
function makeVariants(userId, body) {
  const p = ownItem(userId, body.parentId);
  if (p.parent_id) fail(400, `${p.name} is itself a variant — pick the main item`);
  const list = (v) => [...new Set((Array.isArray(v) ? v : String(v || '').split(',')).map((x) => clip(x, 30)).filter(Boolean))];
  const sizes = list(body.sizes), colours = list(body.colours);
  if (!sizes.length && !colours.length) fail(400, 'Add sizes, colours or both');
  if (sizes.length * Math.max(1, colours.length) > 200) fail(400, 'Up to 200 variants at a time');
  const have = variantsOf(userId, p.id), made = [], skipped = [];
  for (const size of sizes.length ? sizes : [null]) for (const colour of colours.length ? colours : [null]) {
    const name = [p.name, size, colour].filter(Boolean).join(' ');
    if (have.some((i) => lower(i.attrs?.size) === lower(size) && lower(i.attrs?.colour) === lower(colour)) || T.iitems.find({ userId, lname: lower(name) })) { skipped.push(name); continue; }
    const tag = [size, colour].filter(Boolean).map((x) => x.toUpperCase().replace(/\s+/g, ''));
    made.push(T.iitems.insert({ id: uid(), userId, name, unit: p.unit || 'pcs', sku: p.sku ? [p.sku, ...tag].join('-') : null, barcode: null, category: p.category || null, hsn: p.hsn || null, gst_percent: p.gst_percent ?? null, sale_rate: p.sale_rate ?? null, purchase_rate: p.purchase_rate ?? null, reorder_level: p.reorder_level ?? null, parent_id: p.id, attrs: { ...(size ? { size } : {}), ...(colour ? { colour } : {}) }, active: true, at: Date.now() }));
  }
  return { made: made.map(itemView), skipped, grid: variantGrid(userId, p) };
}

// ---------- counter bills (retailers; credit bills feed traders' outstanding) ----------
const notesOf = (b) => (b.cnIds || []).map((id) => T.icnotes.get(id)).filter(Boolean);
const noteView = (n) => { const { userId, lparty, ...rest } = n; return rest; };
// what came back of each line so far (pieces, taxable, GST), from the bill's credit notes
const backOf = (notes, i) => notes.flatMap((n) => n.lines.filter((x) => x.line === i)).reduce((s, x) => ({ qty: r3(s.qty + x.qty), taxable: r2(s.taxable + x.taxable), gst: r2(s.gst + x.gst) }), { qty: 0, taxable: 0, gst: 0 });
const billView = (b) => {
  const { userId, lparty, cnIds, ...rest } = b;
  const notes = notesOf(b), returned = r2(notes.reduce((s, n) => s + n.total, 0));
  return { ...rest, lines: rest.lines.map((l, i) => ({ ...l, returned_qty: backOf(notes, i).qty })), returns: notes.map(({ id, number, day, total, refund_mode, reason }) => ({ id, number, day, total, refund_mode, reason })), returned, net_total: r2(b.total - returned) };
};
export function priceBill(u, body) {
  const lines = Array.isArray(body.lines) ? body.lines.filter((l) => l && (l.itemId || l.barcode || l.item)) : [];
  if (!lines.length) fail(400, 'Add at least one item to the bill');
  if (lines.length > 200) fail(400, 'Up to 200 lines on a bill');
  const party = clip(body.party_name, 120) || null, day = isDay(body.day) ? body.day : ymd();
  const priced = lines.map((l) => {
    const item = l.itemId ? ownItem(u.id, l.itemId) : findItem(u.id, l.barcode || l.item);
    const rate = l.rate != null && l.rate !== '' ? l.rate : rateFor(u.id, item, { list: body.ratelistId, party }).rate;
    return priceLine(u.id, item, { qty: l.qty, rate, schemes: body.schemes !== false, day });
  });
  const sum = (k) => r2(priced.reduce((s, l) => s + l[k], 0));
  const total = sum('amount'), rounded = Math.round(total);
  return { day, party_name: party, credit: !!body.credit, lines: priced, gross: sum('gross'), discount: sum('discount'), taxable: sum('taxable'), gst: sum('gst'), round_off: r2(rounded - total), total: rounded,
    credit_check: party && body.credit ? creditCheck(u, party, rounded) : null };
}
export function saveBill(u, body) {
  const p = priceBill(u, body);
  if (p.credit && !p.party_name) fail(400, 'A credit bill needs the party’s name');
  if (p.credit_check?.over && body.override !== true) fail(409, p.credit_check.message, { code: 'CREDIT_LIMIT', credit_check: p.credit_check });
  const g = body.godownId ? T.igodowns.get(body.godownId) : mainGodown(u.id);
  if (!g || g.userId !== u.id) fail(404, 'That godown isn’t yours');
  const src = MOVE_SOURCES.includes(body.source) ? body.source : 'MANUAL';
  return billView(tx(() => {
    const number = `CB-${String(T.ibills.count({ userId: u.id }) + 1).padStart(4, '0')}`;
    const moveIds = [];
    for (const l of p.lines) {
      // batched stock goes first-expiry-first-out, so batch balances stay true; free units leave stock at ₹0
      const sell = (qty, rate) => {
        const { take, short } = fefo(u.id, l.itemId, qty, g.id);
        for (const t of take) moveIds.push(addMove(u.id, { itemId: l.itemId, godownId: g.id, qty: t.qty, kind: 'SALE', rate, day: p.day, party_name: p.party_name, ref: number, source: src, batch: t.batch, expiry: t.expiry }).id);
        if (short > 0) moveIds.push(addMove(u.id, { itemId: l.itemId, godownId: g.id, qty: short, kind: 'SALE', rate, day: p.day, party_name: p.party_name, ref: number, source: src }, { allowNegative: body.allowNegative === true }).id);
      };
      sell(l.qty, l.qty ? r2(l.taxable / l.qty) : l.rate);
      if (l.free_qty) sell(l.free_qty, 0);
    }
    return T.ibills.insert({ id: uid(), userId: u.id, number, ...p, lparty: p.party_name ? lower(p.party_name) : null, credit_check: undefined, moveIds, paid: !p.credit, cancelled: false, at: Date.now() });
  }));
}
const ownBill = (userId, id) => { const b = T.ibills.get(id); if (!b || b.userId !== userId) fail(404, 'Bill not found'); return b; };

// ---------- returns against a counter bill: credit notes CN-0001… ----------
// The rule for schemes: what the customer keeps is charged as if they had bought only that, under the scheme on the
// bill. Buy 10 get 1 free: 11 pieces sold, 1 comes back → they keep 10, which costs 10, so the refund is ₹0 (the free
// piece is reclaimed by value); 2 come back → they keep 9 for 9, refund 1. Free pieces always go back into stock at ₹0.
// % off below its minimum quantity goes back to the full rate. A refund is never negative and never more than is
// still paid on the line, so the credit notes on a fully returned bill add up to exactly its total.
const pieces = (l) => r3(l.qty + (l.free_qty || 0));
function chargeFor(l, k) {
  const s = l.scheme ? { ...(l.scheme.buy || l.scheme.pct ? {} : T.ischemes.get(l.scheme.id) || {}), ...l.scheme } : null; // bills before terms rode on the line: today's terms
  if (k <= 0) return 0;
  if (s?.kind === 'FREE' && s.buy > 0 && s.free > 0) { const n = Math.floor(k / (s.buy + s.free)); return r2(l.rate * (n * s.buy + Math.min(k - n * (s.buy + s.free), s.buy))); }
  if (s?.kind === 'PERCENT' && s.pct > 0) { const g = r2(k * l.rate); return k >= (s.min_qty || 1) ? r2(g - r2((g * s.pct) / 100)) : g; }
  return r2((l.taxable * Math.min(k, l.qty)) / l.qty); // kept pieces count as paid ones first
}
export function priceReturn(u, b, body = {}) {
  if (b.cancelled) fail(409, `Bill ${b.number} is cancelled — there’s nothing on it to return`);
  const notes = notesOf(b), want = b.lines.map(() => 0);
  const asked = Array.isArray(body.lines) ? body.lines.filter((l) => l && (l.line != null || l.itemId || l.item || l.barcode)) : [];
  for (const r of asked) {
    const n = r3(pos(r.qty, 'Quantity returned'));
    const left = (i) => r3(pieces(b.lines[i]) - backOf(notes, i).qty - want[i]);
    if (r.line != null && r.line !== '') {
      const i = Number(r.line);
      if (!Number.isInteger(i) || !b.lines[i]) fail(400, `Bill ${b.number} has no line ${r.line}`);
      if (n > left(i) + 0.0005) fail(409, `Only ${left(i)} ${b.lines[i].unit} of ${b.lines[i].name} left to return on ${b.number}`.replace('  ', ' '));
      want[i] = r3(want[i] + n); continue;
    }
    const it = r.itemId ? ownItem(u.id, r.itemId) : findItem(u.id, r.barcode || r.item);
    const idx = b.lines.map((l, i) => (l.itemId === it.id ? i : -1)).filter((i) => i >= 0);
    if (!idx.length) fail(400, `${it.name} isn’t on bill ${b.number}`);
    const can = r3(idx.reduce((s, i) => s + left(i), 0));
    if (n > can + 0.0005) fail(409, `Only ${can} ${it.unit || ''} of ${it.name} left to return on ${b.number} — sold ${r3(idx.reduce((s, i) => s + pieces(b.lines[i]), 0))}`.replace('  ', ' '));
    let rest = n; // the same item on two lines: fill the first line first
    for (const i of idx) { const t = r3(Math.min(rest, left(i))); want[i] = r3(want[i] + t); rest = r3(rest - t); }
  }
  if (!want.some((n) => n > 0)) fail(400, 'Pick what came back and how many');
  const mode = body.refund_mode || (b.credit && !b.paid ? 'credit' : 'cash');
  if (!['cash', 'credit'].includes(mode)) fail(400, 'Refund is cash or credit');
  if (mode === 'cash' && b.credit && !b.paid) fail(400, `Bill ${b.number} is on credit and not paid yet — the return comes off what ${b.party_name} owes (refund as credit)`);
  if (mode === 'credit' && !b.party_name) fail(400, `Bill ${b.number} has no customer name, so there’s no account to credit — refund in cash`);
  const lines = [];
  b.lines.forEach((l, i) => {
    if (!(want[i] > 0)) return;
    const back = backOf(notes, i), kept = r3(pieces(l) - back.qty - want[i]);
    const paid = r2(l.taxable - back.taxable), gstPaid = r2(l.gst - back.gst);
    const charge = Math.min(paid, chargeFor(l, kept)), gstNow = kept > 0 ? Math.min(gstPaid, r2((charge * l.gst_percent) / 100)) : 0;
    const taxable = r2(Math.max(0, paid - charge)), gst = r2(Math.max(0, gstPaid - gstNow));
    lines.push({ line: i, itemId: l.itemId, name: l.name, unit: l.unit, hsn: l.hsn, qty: want[i], rate: r2(taxable / want[i]), taxable, gst_percent: l.gst_percent, gst, amount: r2(taxable + gst) });
  });
  // round the bill's remaining balance, not each note, so the notes never drift from the bill's own rounding
  const before = r2(b.total - b.round_off - notes.reduce((s, n) => s + n.taxable + n.gst, 0)), raw = r2(lines.reduce((s, l) => s + l.amount, 0));
  const total = Math.round(before) - Math.round(r2(before - raw));
  return { billId: b.id, bill_number: b.number, bill_day: b.day, day: ymd(), party_name: b.party_name || null, credit: !!b.credit, refund_mode: mode, applies_to: mode === 'credit' ? (b.credit && !b.paid ? 'bill' : 'account') : null,
    reason: clip(body.reason, 200) || null, lines, taxable: r2(lines.reduce((s, l) => s + l.taxable, 0)), gst: r2(lines.reduce((s, l) => s + l.gst, 0)), round_off: r2(total - raw), total };
}
// all or nothing: the credit note, its RETURN_IN moves and the link on the bill
export function saveReturn(u, billId, body = {}) {
  return tx(() => {
    const b = ownBill(u.id, billId), p = priceReturn(u, b, body);
    const number = `CN-${String(T.icnotes.count({ userId: u.id }) + 1).padStart(4, '0')}`;
    const src = MOVE_SOURCES.includes(body.source) ? body.source : 'MANUAL';
    // stock goes back to the godown / batch it left from: the bill's sale moves less what earlier notes put back there
    const key = (m) => `${m.godownId}|${m.batch || ''}`, room = new Map(), info = new Map();
    for (const m of (b.moveIds || []).map((id) => T.imoves.get(id)).filter((m) => m && m.userId === u.id)) { const k = `${m.itemId}#${key(m)}`; room.set(k, r3((room.get(k) || 0) - m.qty)); info.set(k, m); }
    for (const m of notesOf(b).flatMap((n) => n.moveIds || []).map((id) => T.imoves.get(id)).filter(Boolean)) { const k = `${m.itemId}#${key(m)}`; room.set(k, r3((room.get(k) || 0) - m.qty)); }
    const moveIds = [];
    for (const l of p.lines) {
      let left = l.qty;
      const rate = r2(l.taxable / l.qty);
      for (const [k, n] of [...room].reverse()) {
        if (left <= 0) break;
        if (!k.startsWith(`${l.itemId}#`) || n <= 0.0005) continue;
        const t = r3(Math.min(left, n)), m = info.get(k);
        moveIds.push(addMove(u.id, { itemId: l.itemId, godownId: m.godownId, qty: t, kind: 'RETURN_IN', rate, day: p.day, party_name: p.party_name, ref: number, source: src, batch: m.batch, expiry: m.expiry, note: `Return on ${b.number}` }).id);
        room.set(k, r3(n - t)); left = r3(left - t);
      }
      if (left > 0) moveIds.push(addMove(u.id, { itemId: l.itemId, qty: left, kind: 'RETURN_IN', rate, day: p.day, party_name: p.party_name, ref: number, source: src, note: `Return on ${b.number}` }).id);
    }
    const n = T.icnotes.insert({ id: uid(), userId: u.id, number, ...p, lparty: p.party_name ? lower(p.party_name) : null, moveIds, at: Date.now() });
    T.ibills.update(b.id, (x) => { x.cnIds = [...(x.cnIds || []), n.id]; });
    return noteView(n);
  });
}
// the day's counter sales: bills made that day less the credit notes made that day (IST)
export function counterDay(userId, day = ymd()) {
  const d = isDay(day) ? day : ymd();
  const since = Date.parse(`${d}T00:00:00+05:30`) - 86400000; // bills carry their own day; a day's slack for the clock
  const bills = [...T.ibills.iter({ userId, at: { gte: since } })].filter((b) => b.day === d), live = bills.filter((b) => !b.cancelled);
  const notes = T.icnotes.all({ userId, day: d }, { order: 'at' });
  const gross = r2(live.reduce((s, b) => s + b.total, 0)), returns = r2(notes.reduce((s, n) => s + n.total, 0));
  return { day: d, bills: live.length, cancelled: bills.length - live.length, gross, returns, credit_notes: notes.length, net: r2(gross - returns), cash_refunds: r2(notes.filter((n) => n.refund_mode === 'cash').reduce((s, n) => s + n.total, 0)), notes: notes.map(noteView) };
}

// ---------- routes ----------
export function registerInventoryPro(app, { auth, rateLimit, isTest }) {
  const P = '/api/inventory/pro';
  // like wrap, but a refusal can carry details (a production shortfall, a credit-limit warning)
  const send = (fn) => (req, res) => Promise.resolve().then(() => fn(req, res)).then((d) => res.json(d)).catch((e) => {
    if (e.status >= 400 && e.status < 500) return res.status(e.status).json({ error: e.message, ...(e.extra || {}) });
    console.error(e); res.status(500).json({ error: e.message });
  });
  const on = (req, res, next) => (inventoryOn(req.user) ? next() : res.status(403).json({ error: 'Inventory isn’t switched on for your account — ask us to turn it on', code: 'INVENTORY_OFF' }));
  const writeLimit = rateLimit({ windowMs: 60000, max: isTest ? 5000 : 120, key: (req) => req.user.id, message: 'Too many stock changes at once — wait a minute.' });
  const get = (p, fn) => app.get(P + p, auth, on, send(fn));
  const write = (m, p, fn) => app[m](P + p, auth, on, writeLimit, send(fn));
  const uid_ = (req) => req.user.id;

  get('', (req) => { const ind = industryOf(req.user); return { industry: ind, kit: req.user.settings?.crmKit?.name || null, sections: ind ? ORDER[ind] : SECTIONS }; });

  // bills of materials
  get('/boms', (req) => T.iboms.all({ userId: uid_(req) }, { order: 'at', desc: true }).map(bomView));
  write('put', '/boms', (req) => saveBom(uid_(req), req.body || {}));
  write('delete', '/boms/:id', (req) => { T.iboms.del(ownBom(uid_(req), req.params.id).id); return { ok: true }; });
  get('/boms/:id/requirement', (req) => requirement(uid_(req), ownBom(uid_(req), req.params.id), req.query.qty, req.query.godownId || null));
  write('post', '/boms/:id/produce', (req) => produce(uid_(req), ownBom(uid_(req), req.params.id), req.body || {}));

  // batches & expiry
  get('/batches', (req) => {
    const rows = batchStock(uid_(req), { itemId: req.query.itemId || null }).filter((b) => req.query.all === '1' || Math.abs(b.qty) > 0.0005);
    const names = new Map();
    return rows.map((b) => { const i = names.get(b.itemId) || T.iitems.get(b.itemId); names.set(b.itemId, i); return { ...b, item: i?.name || '?', unit: i?.unit || '' }; })
      .sort((a, b) => a.item.localeCompare(b.item) || String(a.expiry || '9').localeCompare(String(b.expiry || '9')));
  });
  get('/expiring', (req) => { const days = [30, 60, 90].includes(Number(req.query.days)) ? Number(req.query.days) : Math.min(365, Math.max(1, Number(req.query.days) || 30)); return { days, until: addDays(ymd(), days), batches: expiring(uid_(req), days) }; });
  get('/fefo', (req) => { const i = ownItem(uid_(req), req.query.itemId); return { item: itemView(i), qty: r3(pos(req.query.qty, 'Quantity')), ...fefo(uid_(req), i.id, req.query.qty, req.query.godownId || null) }; });

  // schemes
  get('/schemes', (req) => T.ischemes.all({ userId: uid_(req) }, { order: 'at', desc: true }).map(({ userId, ...s }) => ({ ...s, item: T.iitems.get(s.itemId)?.name || '?' })));
  write('post', '/schemes', (req) => saveScheme(uid_(req), req.body || {}));
  write('put', '/schemes/:id', (req) => { const s = T.ischemes.get(req.params.id); if (!s || s.userId !== uid_(req)) fail(404, 'Scheme not found'); return saveScheme(uid_(req), req.body || {}, s); });
  write('delete', '/schemes/:id', (req) => { const s = T.ischemes.get(req.params.id); if (!s || s.userId !== uid_(req)) fail(404, 'Scheme not found'); T.ischemes.del(s.id); return { ok: true }; });
  // the calculator: what a sale line comes to with the best scheme
  app.post(`${P}/schemes/calc`, auth, on, send((req) => { const b = req.body || {}; const i = b.itemId ? ownItem(uid_(req), b.itemId) : findItem(uid_(req), b.item); return priceLine(uid_(req), i, { qty: b.qty, rate: b.rate ?? rateFor(uid_(req), i, { list: b.ratelistId, party: b.party_name }).rate }); }));

  // variants
  get('/variants', (req) => { const all = T.iitems.all({ userId: uid_(req), active: 1 }); const parents = [...new Set(all.map((i) => i.parent_id).filter(Boolean))]; return parents.map((id) => all.find((i) => i.id === id)).filter(Boolean).map((p) => variantGrid(uid_(req), p)); });
  get('/variants/:parentId', (req) => variantGrid(uid_(req), ownItem(uid_(req), req.params.parentId)));
  write('post', '/variants', (req) => makeVariants(uid_(req), req.body || {}));

  // counter bills
  get('/bills', (req) => {
    const party = clip(req.query.party, 120);
    const rows = party ? T.ibills.all({ userId: uid_(req), lparty: lower(party) }, { order: 'at', desc: true, limit: 200 }) : T.ibills.all({ userId: uid_(req) }, { order: 'at', desc: true, limit: Math.min(200, Number(req.query.limit) || 50) });
    return rows.filter((b) => req.query.open !== '1' || (b.credit && !b.paid && !b.cancelled)).map(billView);
  });
  get('/bills/:id', (req) => billView(ownBill(uid_(req), req.params.id)));
  app.post(`${P}/bills/preview`, auth, on, send((req) => priceBill(req.user, req.body || {})));
  write('post', '/bills', (req) => saveBill(req.user, req.body || {}));
  write('post', '/bills/:id/paid', (req) => billView(T.ibills.update(ownBill(uid_(req), req.params.id).id, (b) => { b.paid = req.body?.paid !== false; b.paidAt = b.paid ? Date.now() : null; })));
  // cancelling takes its sale moves back out, so the stock returns
  write('post', '/bills/:id/cancel', (req) => {
    const b = ownBill(uid_(req), req.params.id);
    if (b.cancelled) fail(409, 'This bill is cancelled already');
    if (b.cnIds?.length) fail(409, `Bill ${b.number} has returns on it — return the rest of it instead of cancelling`);
    return billView(tx(() => { for (const id of b.moveIds || []) { const m = T.imoves.get(id); if (m && m.userId === b.userId) T.imoves.del(id); } return T.ibills.update(b.id, (x) => { x.cancelled = true; x.cancelledAt = Date.now(); }); }));
  });

  // returns: a credit note against a bill (preview prices it without saving), the notes, and a day's net counter sales
  app.post(`${P}/bills/:id/return/preview`, auth, on, send((req) => priceReturn(req.user, ownBill(uid_(req), req.params.id), req.body || {})));
  write('post', '/bills/:id/return', (req) => saveReturn(req.user, req.params.id, req.body || {}));
  get('/credit-notes', (req) => {
    const w = { userId: uid_(req) }, party = clip(req.query.party, 120);
    if (isDay(req.query.day)) w.day = req.query.day;
    if (party) w.lparty = lower(party);
    if (req.query.billId) w.billId = String(req.query.billId);
    return T.icnotes.all(w, { order: 'at', desc: true, limit: Math.min(500, Number(req.query.limit) || 100) }).map(noteView);
  });
  get('/credit-notes/:id', (req) => { const n = T.icnotes.get(req.params.id); if (!n || n.userId !== uid_(req)) fail(404, 'Credit note not found'); return noteView(n); });
  get('/counter/day', (req) => counterDay(uid_(req), req.query.day));

  // rate lists
  get('/ratelists', (req) => T.iratelists.all({ userId: uid_(req) }, { order: 'lname' }).map(({ userId, ...l }) => l));
  write('post', '/ratelists', (req) => saveList(uid_(req), req.body || {}));
  write('put', '/ratelists/:id', (req) => saveList(uid_(req), req.body || {}, ownList(uid_(req), req.params.id)));
  write('delete', '/ratelists/:id', (req) => { const l = ownList(uid_(req), req.params.id); T.iratelists.del(l.id); for (const c of T.icredit.all({ userId: uid_(req) }).filter((c) => c.ratelistId === l.id)) T.icredit.update(c.id, (x) => { x.ratelistId = null; }); return { ok: true }; });
  get('/rate', (req) => { const i = req.query.itemId ? ownItem(uid_(req), req.query.itemId) : findItem(uid_(req), req.query.item); return { item: itemView(i), ...rateFor(uid_(req), i, { list: req.query.list, party: req.query.party }) }; });

  // credit limits
  get('/credit', (req) => {
    const party = clip(req.query.party, 120);
    if (party) return creditCheck(req.user, party, Number(req.query.amount) || 0);
    return T.icredit.all({ userId: uid_(req) }, { order: 'lparty' }).map((c) => ({ id: c.id, ratelistId: c.ratelistId || null, ...creditCheck(req.user, c.party_name) }));
  });
  write('put', '/credit', (req) => {
    const b = req.body || {}, party = clip(b.party_name, 120);
    if (!party) fail(400, 'Which party?');
    const limit = Number(b.limit);
    if (!Number.isFinite(limit) || limit < 0) fail(400, 'Credit limit must be ₹0 or more');
    if (b.ratelistId) ownList(uid_(req), b.ratelistId);
    const cur = creditOf(uid_(req), party);
    T.icredit.put({ ...(cur || { id: uid(), userId: uid_(req) }), party_name: party, lparty: lower(party), limit: r2(limit), ratelistId: b.ratelistId === undefined ? cur?.ratelistId || null : b.ratelistId || null, at: Date.now() });
    return creditCheck(req.user, party);
  });
  write('delete', '/credit/:id', (req) => { const c = T.icredit.get(req.params.id); if (!c || c.userId !== uid_(req)) fail(404, 'Not found'); T.icredit.del(c.id); return { ok: true }; });
  app.post(`${P}/credit/check`, auth, on, send((req) => creditCheck(req.user, clip(req.body?.party_name, 120) || fail(400, 'Which party?'), Number(req.body?.amount) || 0)));
}
