// Inventory (the add-on): stock kept in FunnelHive itself, for traders, manufacturers, retailers and distributors who
// don't run Tally (or run it badly). This file is the shared contract the inventory modules build on:
//   iitems   — an item: { id, userId, name, unit, sku, barcode, category, hsn, gst_percent, sale_rate, purchase_rate,
//              reorder_level, active, at }  (modules may add their own fields; never rename these)
//   igodowns — a godown / store / warehouse: { id, userId, name, active }
//   imoves   — one change in stock: { id, userId, itemId, godownId, qty (+in / −out), rate, kind, day (YYYY-MM-DD),
//              party_name, ref, source, note, batch, expiry, at }
// A balance is the sum of an item's moves; nothing stores a running total, so a move can be undone by deleting it.
import { T, q, uid } from './db.js';

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
// allowNegative (a sale the seller already made in the real world is still recorded, with a warning, by callers)
export function addMove(userId, m, { allowNegative = false } = {}) {
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
