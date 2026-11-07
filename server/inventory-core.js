// Inventory (the add-on): stock kept in FunnelHive itself, for traders, manufacturers, retailers and distributors who
// don't run Tally (or run it badly). This file is the shared contract the inventory modules build on:
//   iitems   — an item: { id, userId, name, unit, sku, barcode, category, hsn, gst_percent, sale_rate, purchase_rate,
//              reorder_level, tax_inclusive, active, at }  (modules may add their own fields; never rename these)
//              tax_inclusive: sale_rate (and its rate-list rates) already hold GST — an MRP; sales back GST out of it
//   igodowns — a godown / store / warehouse: { id, userId, name, active }
//   imoves   — one change in stock: { id, userId, itemId, godownId, qty (+in / −out), rate, kind, day (YYYY-MM-DD),
//              party_name, ref, source, note, batch, expiry, at }
// A balance is the sum of an item's moves; nothing stores a running total, so a move can be undone by deleting it.
import { T, q, tx, uid } from './db.js';

export const inventoryOn = (u) => !!u?.addons?.inventory;

// what a move is: the sign it must carry and how it reads
export const MOVE_KINDS = {
  OPENING: +1, PURCHASE: +1, SALE: -1, RETURN_IN: +1, RETURN_OUT: -1, ADJUST: 0, TRANSFER_IN: +1, TRANSFER_OUT: -1,
  PRODUCE: +1, CONSUME: -1,
};
// where the move came from — a form, a bill photo, Hive, a WhatsApp message, an import, a bill of materials, Tally
export const MOVE_SOURCES = ['MANUAL', 'PHOTO', 'HIVE', 'WHATSAPP', 'IMPORT', 'BOM', 'TALLY'];

const fail = (status, error) => { throw Object.assign(new Error(error), { status }); };
const r3 = (n) => Math.round(n * 1000) / 1000;
const ymd = (d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(d);

// the seller's default godown, made on first use
export function mainGodown(userId) {
  return T.igodowns.find({ userId, active: 1 }, { order: 'rowid' }) || T.igodowns.insert({ id: uid(), userId, name: 'Main', active: true });
}

// an item's stock: overall, or in one godown
export function stockOf(itemId, godownId = null) {
  const r = godownId
    ? q("SELECT SUM(json_extract(data, '$.qty')) AS n FROM imoves WHERE itemId = ? AND godownId = ?").get(itemId, godownId)
    : q("SELECT SUM(json_extract(data, '$.qty')) AS n FROM imoves WHERE itemId = ?").get(itemId);
  return r3(Number(r?.n) || 0);
}

// every item's stock for a seller, in one query → Map(itemId → qty)
export function stockMap(userId, godownId = null) {
  const rows = godownId
    ? q("SELECT itemId, SUM(json_extract(data, '$.qty')) AS n FROM imoves WHERE userId = ? AND godownId = ? GROUP BY itemId").all(userId, godownId)
    : q("SELECT itemId, SUM(json_extract(data, '$.qty')) AS n FROM imoves WHERE userId = ? GROUP BY itemId").all(userId);
  return new Map(rows.map((r) => [r.itemId, r3(Number(r.n) || 0)]));
}

// records one move; the sign follows its kind (ADJUST keeps the sign given). Refuses stock going below zero unless
// allowNegative (a sale the seller already made in the real world is still recorded, with a warning, by callers).
// The check and the insert share one transaction (joining the caller's), so two workers can't both pass the check.
export function addMove(userId, m, opts = {}) { return tx(() => insertMove(userId, m, opts)); }
function insertMove(userId, m, { allowNegative = false } = {}) {
  const item = T.iitems.get(m.itemId);
  if (!item || item.userId !== userId) fail(404, 'That item isn’t in your inventory');
  if (!(m.kind in MOVE_KINDS)) fail(400, `Unknown stock change ${m.kind}`);
  const godown = m.godownId ? T.igodowns.get(m.godownId) : mainGodown(userId);
  if (!godown || godown.userId !== userId) fail(404, 'That godown isn’t yours');
  const raw = Number(m.qty);
  if (!Number.isFinite(raw) || raw === 0) fail(400, 'Enter a quantity');
  const sign = MOVE_KINDS[m.kind];
  const qty = r3(sign === 0 ? raw : sign * Math.abs(raw));
  if (qty < 0 && !allowNegative && stockOf(item.id, godown.id) + qty < -0.0005) {
    fail(409, `Only ${stockOf(item.id, godown.id)} ${item.unit || ''} of ${item.name} in ${godown.name} — record a purchase or adjustment first`.replace('  ', ' '));
  }
  const day = /^\d{4}-\d{2}-\d{2}$/.test(m.day || '') ? m.day : ymd();
  return T.imoves.insert({
    id: uid(), userId, itemId: item.id, godownId: godown.id, qty, kind: m.kind, day,
    rate: m.rate != null && m.rate !== '' ? Number(m.rate) : null, party_name: m.party_name || null, ref: m.ref || null,
    source: MOVE_SOURCES.includes(m.source) ? m.source : 'MANUAL', note: m.note || null, batch: m.batch || null, expiry: m.expiry || null, at: Date.now(),
  });
}

// ---------- batches & expiry ----------
// stock per batch: the sum of moves carrying that batch; its expiry is the one recorded when it came in
export function batchStock(userId, { itemId = null, godownId = null } = {}) {
  const where = ['userId = ?'], args = [userId];
  if (itemId) { where.push('itemId = ?'); args.push(itemId); }
  if (godownId) { where.push('godownId = ?'); args.push(godownId); }
  return q(`SELECT itemId, json_extract(data, '$.batch') AS batch, MIN(json_extract(data, '$.expiry')) AS expiry, SUM(json_extract(data, '$.qty')) AS n
    FROM imoves WHERE ${where.join(' AND ')} GROUP BY itemId, json_extract(data, '$.batch')`).all(...args)
    .map((r) => ({ itemId: r.itemId, batch: r.batch || null, expiry: r.expiry || null, qty: r3(Number(r.n) || 0) }));
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
// does this item carry batches in this godown (any move with a batch)?
export const batched = (itemId, godownId) => !!q("SELECT 1 FROM imoves WHERE itemId = ? AND godownId = ? AND json_extract(data, '$.batch') IS NOT NULL LIMIT 1").get(itemId, godownId);
// a sale (or any stock going out) of a batch-tracked item, first-expiry-first-out: one move per batch it comes from.
// Expired batches are never sold; when the in-date stock runs out the rest is refused — the godown's total would
// count the expired units and let an unbatched line go below zero while the expired batch stays full — unless
// allowNegative (a sale that already happened), when the rest goes out unbatched.
export function sellFefo(userId, m, { allowNegative = false } = {}) {
  return tx(() => {
    const item = T.iitems.get(m.itemId);
    if (!item || item.userId !== userId) fail(404, 'That item isn’t in your inventory');
    const godownId = m.godownId || mainGodown(userId).id;
    const qty = r3(Math.abs(Number(m.qty)));
    if (!Number.isFinite(qty) || qty === 0) fail(400, 'Enter a quantity');
    const { take, short, expired } = fefo(userId, item.id, qty, godownId);
    if (short > 0 && expired.length && !allowNegative) {
      const ex = r3(expired.reduce((s, b) => s + b.qty, 0)), what = `${ex} ${item.unit || ''} expired (${expired.map((b) => `batch ${b.batch}, ${b.expiry}`).join('; ')})`.replace('  ', ' ');
      fail(409, take.length ? `Only ${r3(qty - short)} ${item.unit || ''} of ${item.name} is in date — the rest is ${what}; write it off first`.replace('  ', ' ')
        : `Only expired stock left for ${item.name}: ${what} — write it off first`);
    }
    const moves = take.map((t) => addMove(userId, { ...m, godownId, qty: t.qty, batch: t.batch, expiry: t.expiry }));
    if (short > 0) moves.push(addMove(userId, { ...m, godownId, qty: short, batch: null, expiry: null }, { allowNegative }));
    return moves;
  });
}
