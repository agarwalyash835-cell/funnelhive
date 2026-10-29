// Inventory (the add-on, phase 2): items, godowns and stock moves kept in FunnelHive (inventory-core.js), for sellers
// without Tally — entries from forms, bill photos, Hive and imports. Routes live under /api/inventory.
//   GET  /api/inventory                 { on }  (no add-on needed: the page shows "ask us to turn it on")
//   GET  /items?search&godownId&all     { items, godowns, summary }        POST /items · PUT|DELETE /items/:id
//   GET  /items/:id                     { item, byGodown, moves }          GET /barcode/:code → { item }
//   POST /godowns · PUT /godowns/:id    GET /low → { items }               GET /moves?itemId&kind&limit → { moves }
//   POST /moves (one) · POST /moves/batch (a bill: several lines, all or nothing) · DELETE /moves/:id (undo)
//   POST /transfer (a TRANSFER_OUT + TRANSFER_IN pair) · POST /import (CSV with opening stock) · POST /photo (bill → draft)
// The /api/inventory paths are the 'tally' team area in the menu (ui.jsx PAGE_AREAS).
import { T, q, tx, uid } from './db.js';
import { inventoryOn, MOVE_KINDS, MOVE_SOURCES, mainGodown, stockMap, stockOf, addMove } from './inventory-core.js';
import { readImage, visionReady } from './waknow.js';
import { aiJson, aiEnabled } from './ai.js';
import { creditsShort, spendCredits, AI_COST } from './billing.js';

class InvError extends Error { constructor(status, message, extra) { super(message); this.status = status; this.extra = extra; } }
const fail = (status, message, extra) => { throw new InvError(status, message, extra); };
const clip = (v, n = 200) => (v == null ? '' : String(v).trim().slice(0, n));
const lname = (v) => String(v ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
const r3 = (n) => Math.round(n * 1000) / 1000;
const r2 = (n) => Math.round(n * 100) / 100;
const ymd = (d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(d);
// a number field: blank → null; anything else must be a number ≥ 0
const amount = (v, label) => {
  if (v == null || v === '') return null;
  const n = Number(String(v).replace(/[₹,\s]/g, ''));
  if (!Number.isFinite(n) || n < 0) fail(400, `${label} must be a number`);
  return n;
};
// what the seller may record by hand (transfers have their own route; production moves belong to bills of materials)
export const ENTRY_KINDS = ['OPENING', 'PURCHASE', 'SALE', 'RETURN_IN', 'RETURN_OUT', 'ADJUST'];
const OUT_KINDS = new Set(Object.keys(MOVE_KINDS).filter((k) => MOVE_KINDS[k] < 0));

// ---------- items ----------
const ITEM_FIELDS = ['name', 'unit', 'sku', 'barcode', 'category', 'hsn', 'gst_percent', 'sale_rate', 'purchase_rate', 'reorder_level'];
function cleanItem(b, old = {}) {
  const x = {};
  if ('name' in b || !old.name) x.name = clip(b.name, 120) || fail(400, 'Give the item a name');
  for (const f of ['unit', 'sku', 'barcode', 'category', 'hsn']) if (f in b) x[f] = clip(b[f], f === 'category' ? 80 : 40) || null;
  if (!old.unit && !x.unit) x.unit = 'pcs';
  if ('gst_percent' in b) { x.gst_percent = amount(b.gst_percent, 'GST %'); if (x.gst_percent > 100) fail(400, 'GST % must be between 0 and 100'); }
  for (const [f, l] of [['sale_rate', 'Sale rate'], ['purchase_rate', 'Purchase rate'], ['reorder_level', 'Reorder level']]) if (f in b) x[f] = amount(b[f], l);
  if (x.barcode && !/^[\w\-.]{3,40}$/.test(x.barcode)) fail(400, 'A barcode is letters and digits only');
  return x;
}
// no two active items share a name, SKU or barcode
function clash(userId, x, id = null) {
  const other = (row) => row && row.id !== id;
  if (x.name && other(T.iitems.find({ userId, lname: lname(x.name), active: 1 }))) fail(409, `You already have an item called “${x.name}”`);
  if (x.sku && other(T.iitems.find({ userId, sku: lname(x.sku), active: 1 }))) fail(409, `SKU ${x.sku} is already on another item`);
  if (x.barcode && other(T.iitems.find({ userId, barcode: x.barcode, active: 1 }))) fail(409, `Barcode ${x.barcode} is already on another item`);
}
export function createItem(userId, b) {
  const x = cleanItem(b);
  clash(userId, x);
  return T.iitems.insert({ id: uid(), userId, unit: 'pcs', sku: null, barcode: null, category: null, hsn: null, gst_percent: null, sale_rate: null, purchase_rate: null, reorder_level: null, ...x, active: true, at: Date.now() });
}
const own = (table, userId, id, what) => { const r = id && T[table].get(id); return r && r.userId === userId ? r : fail(404, `That ${what} isn’t in your inventory`); };
const itemOut = (i, qty) => ({
  id: i.id, name: i.name, unit: i.unit, sku: i.sku, barcode: i.barcode, category: i.category, sale_rate: i.sale_rate, purchase_rate: i.purchase_rate,
  reorder_level: i.reorder_level, gst_percent: i.gst_percent, hsn: i.hsn, active: i.active !== false, stock: qty || 0, low: (qty || 0) <= (Number(i.reorder_level) || 0),
});

// one query per godown table: every (godown, item) balance → Map(godownId → Map(itemId → qty))
function byGodownMap(userId) {
  const m = new Map();
  for (const r of q("SELECT godownId, itemId, SUM(json_extract(data, '$.qty')) AS n FROM imoves WHERE userId = ? GROUP BY godownId, itemId").all(userId)) {
    if (!m.has(r.godownId)) m.set(r.godownId, new Map());
    m.get(r.godownId).set(r.itemId, r3(Number(r.n) || 0));
  }
  return m;
}
const godownsOf = (userId) => { mainGodown(userId); return T.igodowns.all({ userId, active: 1 }, { order: 'rowid' }); };

export function listItems(userId, { search = '', godownId = '', all = false } = {}) {
  const godowns = godownsOf(userId);
  if (godownId) own('igodowns', userId, godownId, 'godown');
  const stock = stockMap(userId, godownId || null);
  const s = lname(search);
  const all_ = T.iitems.all(all ? { userId } : { userId, active: 1 });
  const items = all_.filter((i) => !s || [i.name, i.sku, i.barcode, i.category, i.hsn].some((v) => v && lname(v).includes(s))).map((i) => itemOut(i, stock.get(i.id))).sort((a, b) => a.name.localeCompare(b.name));
  // the strip and the godowns count every active item (not just the ones the search shows)
  const active = all_.filter((i) => i.active !== false), live = active.map((i) => itemOut(i, stock.get(i.id)));
  const bg = byGodownMap(userId);
  const worth = (qtyOf) => r2(active.reduce((t, i) => t + Math.max(0, qtyOf(i.id) || 0) * (Number(i.purchase_rate) || 0), 0));
  return {
    items,
    godowns: godowns.map((g) => { const m = bg.get(g.id) || new Map(); return { id: g.id, name: g.name, items: [...m.values()].filter((n) => n > 0).length, value: worth((id) => m.get(id)) }; }),
    summary: { value: worth((id) => stock.get(id)), items: live.length, low: live.filter((i) => i.low && i.stock > 0).length, out: live.filter((i) => i.stock <= 0).length },
  };
}

const moveOut = (m, items, godowns) => {
  const i = items.get(m.itemId), g = godowns.get(m.godownId);
  return { id: m.id, itemId: m.itemId, item_name: i?.name || '—', unit: i?.unit || '', godownId: m.godownId, godown_name: g?.name || '—', qty: m.qty, rate: m.rate, kind: m.kind, day: m.day, party_name: m.party_name, ref: m.ref, source: m.source, note: m.note, pair: m.pair || null, at: m.at };
};
const lookups = (userId) => [new Map(T.iitems.all({ userId }).map((i) => [i.id, i])), new Map(T.igodowns.all({ userId }).map((g) => [g.id, g]))];
export function listMoves(userId, { itemId = '', kind = '', limit = 200 } = {}) {
  const where = { userId };
  if (itemId) where.itemId = own('iitems', userId, itemId, 'item').id;
  if (kind) where.kind = kind;
  const [items, godowns] = lookups(userId);
  return T.imoves.all(where, { order: 'at', desc: true, limit: Math.min(1000, Math.max(1, Number(limit) || 200)) }).map((m) => moveOut(m, items, godowns));
}

// ---------- finding an item by what the seller calls it ----------
// exact name, SKU or barcode; else the only active item whose name contains the words (or is contained in them)
export function findItem(userId, text, rows = T.iitems.all({ userId, active: 1 })) {
  const n = lname(text);
  if (!n) return { item: null, suggestions: [] };
  const exact = rows.find((r) => lname(r.name) === n || (r.sku && lname(r.sku) === n) || (r.barcode && r.barcode === String(text).trim()));
  if (exact) return { item: exact, exact: true, suggestions: [] };
  const words = n.split(/[^a-z0-9]+/).filter((w) => w.length > 2);
  const scored = rows.map((r) => {
    const rn = lname(r.name);
    const s = rn.includes(n) || n.includes(rn) ? 10 : words.filter((w) => rn.includes(w.replace(/s$/, ''))).length;
    return [r, s];
  }).filter(([, s]) => s > 0).sort((a, b) => b[1] - a[1]);
  const strong = scored.filter(([, s]) => s >= 10);
  return { item: strong.length === 1 ? strong[0][0] : null, exact: false, suggestions: scored.slice(0, 4).map(([r]) => ({ id: r.id, name: r.name, unit: r.unit })) };
}
const godownByRef = (userId, ref) => {
  if (!ref) return mainGodown(userId);
  const g = T.igodowns.get(ref);
  if (g && g.userId === userId) return g;
  return T.igodowns.find({ userId, lname: lname(ref), active: 1 }) || fail(404, `No godown called “${ref}” — your godowns: ${godownsOf(userId).map((x) => x.name).join(', ')}`);
};

// ---------- moves ----------
const moveBody = (b) => ({ day: /^\d{4}-\d{2}-\d{2}$/.test(b.day || '') ? b.day : ymd(), rate: amount(b.rate, 'Rate'), party_name: clip(b.party_name, 120) || null, ref: clip(b.ref, 60) || null, note: clip(b.note, 300) || null, source: MOVE_SOURCES.includes(b.source) ? b.source : 'MANUAL' });
export function recordMove(userId, b) {
  const kind = String(b.kind || '');
  if (!ENTRY_KINDS.includes(kind)) fail(400, `Pick what happened: ${ENTRY_KINDS.join(', ')}`);
  const item = own('iitems', userId, b.itemId, 'item');
  return addMove(userId, { ...moveBody(b), itemId: item.id, godownId: godownByRef(userId, b.godownId || b.godown).id, kind, qty: b.qty }, { allowNegative: !!b.force && OUT_KINDS.has(kind) });
}

// a whole bill (a photo, Hive, WhatsApp): every line or none. A line names its item by itemId, by name / SKU / barcode
// (item), or brings newItem for one the seller chose to create. Lines that match nothing come back as `unmatched`.
export function recordBatch(userId, b) {
  const kind = String(b.kind || '');
  if (!ENTRY_KINDS.includes(kind)) fail(400, `Pick what happened: ${ENTRY_KINDS.join(', ')}`);
  const lines = Array.isArray(b.lines) ? b.lines.slice(0, 200) : [];
  if (!lines.length) fail(400, 'Add at least one item');
  const godown = godownByRef(userId, b.godownId || b.godown);
  const rows = T.iitems.all({ userId, active: 1 });
  const unmatched = [];
  const plan = lines.map((l, k) => {
    if (l.newItem) return { l, k, create: l.newItem };
    if (l.itemId) return { l, k, item: own('iitems', userId, l.itemId, 'item') };
    const f = findItem(userId, l.item, rows);
    if (!f.item) unmatched.push({ line: k, item: clip(l.item, 120), suggestions: f.suggestions });
    return { l, k, item: f.item };
  });
  if (unmatched.length) fail(422, `Not in your items yet: ${unmatched.map((u) => `“${u.item}”${u.suggestions.length ? ` (did you mean ${u.suggestions.map((s) => s.name).join(' / ')}?)` : ''}`).join(', ')} — pick the right item or create it first`, { unmatched });
  const base = moveBody({ ...b, source: b.source });
  const saved = tx(() => plan.map(({ l, k, item, create }) => {
    const it = item || createItem(userId, { purchase_rate: kind === 'PURCHASE' ? l.rate : undefined, sale_rate: kind === 'SALE' ? l.rate : undefined, ...create });
    try {
      return addMove(userId, { ...base, rate: amount(l.rate, 'Rate'), note: clip(l.note, 300) || base.note, itemId: it.id, godownId: godown.id, kind, qty: l.qty }, { allowNegative: !!b.force && OUT_KINDS.has(kind) });
    } catch (e) { e.message = `Line ${k + 1} (${it.name}): ${e.message}`; throw e; }
  }));
  const [items, godowns] = lookups(userId);
  return { moves: saved.map((m) => moveOut(m, items, godowns)) };
}

export function transfer(userId, b) {
  const item = b.itemId ? own('iitems', userId, b.itemId, 'item') : findItem(userId, b.item).item || fail(404, `No item called “${clip(b.item, 80)}”`);
  const from = godownByRef(userId, b.from), to = godownByRef(userId, b.to);
  if (from.id === to.id) fail(400, 'Pick two different godowns');
  const base = { ...moveBody(b), itemId: item.id }, pair = uid();
  return tx(() => {
    const out = addMove(userId, { ...base, godownId: from.id, kind: 'TRANSFER_OUT', qty: b.qty, party_name: to.name });
    const inn = addMove(userId, { ...base, godownId: to.id, kind: 'TRANSFER_IN', qty: b.qty, party_name: from.name });
    for (const m of [out, inn]) T.imoves.update(m.id, (x) => { x.pair = pair; });
    return { pair, out: { ...out, pair }, in: { ...inn, pair } };
  });
}

// undo: a move (both halves of a transfer) goes, unless that would leave a godown below zero
export function undoMove(userId, id) {
  const m = own('imoves', userId, id, 'entry');
  const set = m.pair ? T.imoves.all({ userId, itemId: m.itemId }).filter((x) => x.pair === m.pair) : [m];
  for (const x of set) if (x.qty > 0 && stockOf(x.itemId, x.godownId) - x.qty < -0.0005) fail(409, 'Undoing this would leave less than zero in stock — undo the later sales first');
  tx(() => { for (const x of set) T.imoves.del(x.id); });
  return { ok: true, removed: set.length };
}

// ---------- CSV import: items with opening stock ----------
export function parseCsv(text) {
  const rows = [];
  let row = [], cell = '', quoted = false;
  const s = String(text || '').replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) { if (c === '"' && s[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') quoted = false; else cell += c; continue; }
    if (c === '"') quoted = true;
    else if (c === ',') { row.push(cell); cell = ''; } else if (c === '\n' || c === '\r') { if (c === '\r' && s[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; } else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim()));
}
// column names sellers use for each field (lower case, letters and digits only)
const HEADS = {
  name: ['name', 'item', 'itemname', 'product', 'productname', 'description', 'particulars'], unit: ['unit', 'uom', 'units'], sku: ['sku', 'code', 'itemcode', 'productcode'],
  barcode: ['barcode', 'ean', 'upc', 'gtin'], category: ['category', 'group', 'stockgroup', 'type'], hsn: ['hsn', 'hsncode', 'hsnsac', 'sac'], gst_percent: ['gst', 'gstpercent', 'gstrate', 'tax', 'taxrate'],
  sale_rate: ['salerate', 'saleprice', 'sellingprice', 'mrp', 'price', 'rate'], purchase_rate: ['purchaserate', 'purchaseprice', 'costprice', 'cost', 'buyingprice'],
  reorder_level: ['reorderlevel', 'reorder', 'minstock', 'minimumstock', 'minqty'], opening: ['openingstock', 'opening', 'openingqty', 'qty', 'quantity', 'stock', 'closingstock', 'balance'], godown: ['godown', 'warehouse', 'location', 'store'],
};
export function importCsv(userId, text) {
  const rows = parseCsv(text);
  if (rows.length < 2) fail(400, 'The file needs a header row and at least one item');
  if (rows.length > 5001) fail(400, 'Up to 5,000 items at a time — split the file');
  const key = (h) => String(h).toLowerCase().replace(/[^a-z0-9]/g, '');
  const col = {};
  rows[0].forEach((h, i) => { const k = key(h); const f = Object.keys(HEADS).find((f) => HEADS[f].includes(k)); if (f && !(f in col)) col[f] = i; });
  if (!('name' in col)) fail(400, 'Couldn’t find the item name column — call it “Name” or “Item”');
  const out = { created: 0, updated: 0, opening: 0, skipped: [] };
  const day = ymd();
  tx(() => rows.slice(1).forEach((r, n) => {
    const line = n + 2;
    try {
      const b = Object.fromEntries(Object.entries(col).map(([f, i]) => [f, (r[i] ?? '').trim()]));
      const fields = Object.fromEntries(ITEM_FIELDS.filter((f) => f in b && b[f] !== '').map((f) => [f, b[f]]));
      if (fields.gst_percent) fields.gst_percent = String(fields.gst_percent).replace('%', '');
      let item = (b.sku && T.iitems.find({ userId, sku: lname(b.sku), active: 1 })) || T.iitems.find({ userId, lname: lname(b.name), active: 1 });
      if (item) {
        const x = cleanItem(fields, item);
        clash(userId, x, item.id);
        item = T.iitems.update(item.id, (i) => Object.assign(i, x));
        out.updated++;
      } else { item = createItem(userId, fields); out.created++; }
      const qty = amount(b.opening, 'Opening stock');
      if (qty) {
        const g = godownByRef(userId, b.godown || null);
        if (q('SELECT 1 FROM imoves WHERE itemId = ? AND godownId = ? LIMIT 1').get(item.id, g.id)) out.skipped.push({ line, name: item.name, error: `has stock entries in ${g.name} already — opening stock not added` });
        else { addMove(userId, { itemId: item.id, godownId: g.id, kind: 'OPENING', qty, day, rate: item.purchase_rate, source: 'IMPORT', note: 'Imported opening stock' }); out.opening++; }
      }
    } catch (e) { if (!(e instanceof InvError) && !e.status) throw e; out.skipped.push({ line, name: clip(r[col.name], 80), error: e.message }); }
  }));
  return out;
}

// ---------- a bill photo → a draft the seller reviews (the same reader as Tally's invoice photos) ----------
const EXTRACT = `You read Indian GST tax invoices and bills. From the bill text below, return ONLY JSON:
{"invoice_number": string|null, "date": "YYYY-MM-DD"|null,
 "seller": {"name": string|null, "gstin": string|null}, "buyer": {"name": string|null, "gstin": string|null},
 "items": [{"description": string, "quantity": number|null, "unit": string|null, "rate": number|null, "amount": number|null, "hsn": string|null, "tax_percent": number|null}],
 "grand_total": number|null}
Use null for anything you can't read. Dates as YYYY-MM-DD (Indian bills write day first). Amounts are plain numbers without ₹ or commas. Items are the goods lines only — never CGST, SGST, IGST, round-off, freight or discount lines.`;
const pos = (v) => { const n = Number(String(v ?? '').replace(/[₹,\s]/g, '')); return Number.isFinite(n) && n > 0 ? n : null; };
// what the AI read (the JSON above) → the moves to review: each line matched to an item, or left for the seller
export function draftFromBill(userId, bill, kind = 'PURCHASE') {
  const inv = bill && typeof bill === 'object' ? bill : fail(422, 'Couldn’t make sense of this bill — try a clearer photo');
  const sale = kind === 'SALE' || kind === 'RETURN_IN';
  const party = (sale ? inv.buyer : inv.seller) || {};
  const rows = T.iitems.all({ userId, active: 1 });
  const lines = (Array.isArray(inv.items) ? inv.items : []).filter((i) => i && String(i.description || '').trim()).slice(0, 100).map((i) => {
    const description = clip(i.description, 160), f = findItem(userId, description, rows);
    const qty = pos(i.quantity), rate = pos(i.rate) || (qty && pos(i.amount) ? r2(pos(i.amount) / qty) : null);
    return { description, qty, unit: clip(i.unit, 20) || null, rate, amount: pos(i.amount), hsn: clip(i.hsn, 12) || null, gst_percent: pos(i.tax_percent),
      itemId: f.item?.id || null, item_name: f.item?.name || null, matched: !!f.item, exact: !!f.exact, suggestions: f.suggestions };
  });
  const ref = clip(inv.invoice_number, 60) || null, day = /^\d{4}-\d{2}-\d{2}$/.test(String(inv.date || '')) ? inv.date : null;
  // the same bill saved before (same number and party)?
  const dup = ref && T.imoves.all({ userId }, { order: 'at', desc: true, limit: 2000 }).find((m) => m.ref && lname(m.ref) === lname(ref) && (!party.name || lname(m.party_name) === lname(party.name)));
  return { kind, party_name: clip(party.name, 120) || null, gstin: clip(party.gstin, 20) || null, ref, day, lines, grand_total: pos(inv.grand_total), unmatched: lines.filter((l) => !l.matched).length, duplicate: dup ? { day: dup.day, kind: dup.kind } : null };
}
async function readBill(userId, image, kind) {
  if (!visionReady() || !aiEnabled()) fail(400, 'Reading bill photos isn’t switched on yet — ask us to turn it on');
  const text = await readImage(image);
  if (!text || text.trim().length < 20) fail(422, 'Couldn’t read this photo — take it straight on, in good light, with the whole bill in view');
  return draftFromBill(userId, await aiJson(EXTRACT, `Bill text:\n${text.slice(0, 12000)}`), kind);
}

// ---------- routes ----------
export function registerInventory(app, { auth, wrap, rateLimit, isTest }) {
  const send = (fn) => wrap(async (req, res) => {
    try { res.json(await fn(req, res)); } catch (e) {
      if (e instanceof InvError || (e.status && e.status < 500)) return res.status(e.status).json({ error: e.message, message: e.message, ...(e.extra || {}) });
      throw e;
    }
  });
  const S = '/api/inventory';
  const on = (req, res, next) => (inventoryOn(req.user) ? next() : res.status(403).json({ error: 'Inventory isn’t switched on for your account — ask us to turn it on', code: 'INVENTORY_OFF' }));
  const writeLimit = rateLimit({ windowMs: 60000, max: isTest ? 10000 : 120, key: (req) => req.user.id, message: 'Too many stock changes at once — wait a minute.' });
  const W = [auth, on, writeLimit];
  const uidOf = (req) => req.user.id;

  app.get(S, auth, send((req) => ({ on: inventoryOn(req.user), kinds: ENTRY_KINDS })));
  app.get(`${S}/items`, auth, on, send((req) => listItems(uidOf(req), { search: clip(req.query.search, 80), godownId: clip(req.query.godownId, 60), all: req.query.all === '1' })));
  app.get(`${S}/items/:id`, auth, on, send((req) => {
    const i = own('iitems', uidOf(req), req.params.id, 'item');
    const bg = byGodownMap(uidOf(req));
    return { item: itemOut(i, stockOf(i.id)), byGodown: godownsOf(uidOf(req)).map((g) => ({ id: g.id, name: g.name, qty: bg.get(g.id)?.get(i.id) || 0 })), moves: listMoves(uidOf(req), { itemId: i.id, limit: req.query.limit }) };
  }));
  app.post(`${S}/items`, ...W, send((req) => itemOut(createItem(uidOf(req), req.body || {}), 0)));
  app.put(`${S}/items/:id`, ...W, send((req) => {
    const i = own('iitems', uidOf(req), req.params.id, 'item'), b = req.body || {};
    const x = cleanItem(Object.fromEntries(ITEM_FIELDS.filter((f) => f in b).map((f) => [f, b[f]])), i);
    if (b.active === true || i.active !== false) clash(uidOf(req), { ...i, ...x }, i.id);
    return itemOut(T.iitems.update(i.id, (r) => { Object.assign(r, x); if (typeof b.active === 'boolean') r.active = b.active; }), stockOf(i.id));
  }));
  // deactivating keeps the item's history; it just leaves the lists
  app.delete(`${S}/items/:id`, ...W, send((req) => { const i = own('iitems', uidOf(req), req.params.id, 'item'); T.iitems.update(i.id, (r) => { r.active = false; }); return { ok: true }; }));
  app.get(`${S}/barcode/:code`, auth, on, send((req) => {
    const code = clip(req.params.code, 40);
    const i = T.iitems.find({ userId: uidOf(req), barcode: code, active: 1 }) || T.iitems.find({ userId: uidOf(req), sku: lname(code), active: 1 }) || fail(404, `No item has barcode ${code} yet`);
    return { item: itemOut(i, stockOf(i.id)) };
  }));
  app.get(`${S}/low`, auth, on, send((req) => ({ items: listItems(uidOf(req)).items.filter((i) => i.low).sort((a, b) => a.stock - b.stock) })));

  app.post(`${S}/godowns`, ...W, send((req) => {
    const name = clip(req.body?.name, 80) || fail(400, 'Give the godown a name');
    godownsOf(uidOf(req));
    if (T.igodowns.find({ userId: uidOf(req), lname: lname(name), active: 1 })) fail(409, `You already have a godown called “${name}”`);
    const g = T.igodowns.insert({ id: uid(), userId: uidOf(req), name, active: true });
    return { id: g.id, name: g.name };
  }));
  app.put(`${S}/godowns/:id`, ...W, send((req) => {
    const g = own('igodowns', uidOf(req), req.params.id, 'godown'), name = clip(req.body?.name, 80) || fail(400, 'Give the godown a name');
    const other = T.igodowns.find({ userId: uidOf(req), lname: lname(name), active: 1 });
    if (other && other.id !== g.id) fail(409, `You already have a godown called “${name}”`);
    T.igodowns.update(g.id, (x) => { x.name = name; });
    return { id: g.id, name };
  }));

  app.get(`${S}/moves`, auth, on, send((req) => ({ moves: listMoves(uidOf(req), { itemId: clip(req.query.itemId, 60), kind: clip(req.query.kind, 20), limit: req.query.limit }) })));
  app.post(`${S}/moves`, ...W, send((req) => { const m = recordMove(uidOf(req), req.body || {}); const [i, g] = lookups(uidOf(req)); return moveOut(m, i, g); }));
  app.post(`${S}/moves/batch`, ...W, send((req) => recordBatch(uidOf(req), req.body || {})));
  app.delete(`${S}/moves/:id`, ...W, send((req) => undoMove(uidOf(req), req.params.id)));
  app.post(`${S}/transfer`, ...W, send((req) => transfer(uidOf(req), req.body || {})));
  app.post(`${S}/import`, ...W, send((req) => importCsv(uidOf(req), String(req.body?.csv || ''))));

  // a bill photo (the global 4 MB JSON limit: the page sends it shrunk to ~1,600 px). AI credits as Tally's reader:
  // checked first, spent only when the draft came back
  const photoLimit = rateLimit({ windowMs: 60000, max: isTest ? 1000 : 10, key: (req) => req.user.id, message: 'Too many bills at once — wait a minute.' });
  app.post(`${S}/photo`, auth, on, photoLimit, send(async (req) => {
    const kind = ['PURCHASE', 'SALE', 'RETURN_IN', 'RETURN_OUT'].includes(req.body?.kind) ? req.body.kind : 'PURCHASE';
    if (isTest && req.body?.bill) return draftFromBill(uidOf(req), req.body.bill, kind); // tests: a canned reading, no AI
    const img = String(req.body?.image || '');
    if (!/^data:image\/(jpeg|jpg|png|webp);base64,/.test(img)) fail(400, 'Send a photo of the bill (JPG, PNG or WebP)');
    const short = creditsShort(req.user, AI_COST.edit);
    if (short) fail(402, short);
    let d;
    try { d = await readBill(uidOf(req), img, kind); } catch (e) { if (e instanceof InvError) throw e; fail(502, 'Couldn’t read the bill right now — try again in a minute'); }
    spendCredits(req.user, AI_COST.edit);
    return d;
  }));
}
