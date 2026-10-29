// Business reports for sellers who keep stock in the Inventory add-on instead of Tally: stock valuation (FIFO and
// weighted average), a trading account (gross profit — expenses aren't kept here, so there is no net profit), a party
// ledger, the day book, sales and purchase registers, a GST summary and fast / slow / dead stock. Nothing is stored:
// every figure is worked out from the stock moves (inventory-core.js), the counter bills and the credit notes
// (inventory-pro.js). Routes live under /api/inventory/reports; every report also comes as CSV (?format=csv).
//   GET /valuation?asOf&godownId     GET /pnl?from&to          GET /parties          GET /ledger?party&from&to
//   GET /daybook?from&to             GET /sales-register?from&to                     GET /purchase-register?from&to
//   GET /gst-summary?from&to         GET /movement
//
// How stock is costed (one pass over the moves, in date order; within a day: opening, then stock in, transfers,
// stock out, customer returns — then the order they were entered):
// - Stock comes in at the rate on its move: purchases and opening stock at their purchase rate (before GST),
//   production (PRODUCE) at the bill-of-materials cost recorded on it. A move without a rate is costed at the item's
//   purchase rate (flagged "assumed"); with neither, at ₹0 (flagged "no cost rate").
// - Stock found in an adjustment comes in at the current average cost (else the item's purchase rate).
// - A customer return (RETURN_IN) goes back in at the cost it last went out at — never at its selling price, so the
//   cost of goods sold is reversed exactly and free scheme units (sold at ₹0) still carry their real cost.
// - Transfers carry their cost from one godown to the other (FIFO: the same layers; average: the source's average).
// - FIFO: what goes out takes the oldest layers in that godown first. Weighted average: a running (perpetual)
//   average per item per godown. Stock sold beyond what the books show is costed at the last cost in (flagged).
import { T, q } from './db.js';
import { inventoryOn } from './inventory-core.js';

const fail = (status, error) => { throw Object.assign(new Error(error), { status }); };
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const r3 = (n) => Math.round((Number(n) || 0) * 1000) / 1000;
const lower = (v) => String(v ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
const clip = (v, n = 120) => (v == null ? '' : String(v).trim().slice(0, n));
const ymd = (d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(d);
const isDay = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v || '');
export const addDays = (day, n) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : null);
const EPS = 0.0005;

// a period: from / to (both days included); defaults to this month so far
export function period(query = {}, today = ymd()) {
  const to = isDay(query.to) ? query.to : today;
  const from = isDay(query.from) ? query.from : `${to.slice(0, 7)}-01`;
  if (from > to) fail(400, 'The start date is after the end date');
  return { from, to };
}
const inP = (day, p) => day >= p.from && day <= p.to;

// ---------- lookups ----------
const itemsOf = (userId) => new Map(T.iitems.all({ userId }).map((i) => [i.id, i]));
const godownsOf = (userId) => new Map(T.igodowns.all({ userId }).map((g) => [g.id, g]));
const billsOf = (userId) => T.ibills.all({ userId }, { order: 'at' });
const notesOf = (userId) => T.icnotes.all({ userId }, { order: 'at' });
// moves that belong to a counter bill or a credit note (their money is on the bill / note, not the move)
function docMoves(bills, notes) {
  const bill = new Map(), note = new Map();
  for (const b of bills) for (const id of b.moveIds || []) bill.set(id, b);
  for (const n of notes) for (const id of n.moveIds || []) note.set(id, n);
  return { bill, note };
}

// ---------- the cost engine ----------
const PRIORITY = { OPENING: 0, PURCHASE: 1, PRODUCE: 1, TRANSFER_OUT: 2, TRANSFER_IN: 2, SALE: 3, CONSUME: 3, RETURN_OUT: 3, RETURN_IN: 4 };
const prio = (m) => (m.kind === 'ADJUST' ? (m.qty > 0 ? 1 : 3) : PRIORITY[m.kind] ?? 3);
export function orderedMoves(userId, until = null) {
  const rows = T.imoves.all(until ? { userId, day: { lte: until } } : { userId }, { order: 'rowid' });
  return rows.map((m, i) => [m, i]).sort(([a, i], [b, j]) => a.day.localeCompare(b.day) || prio(a) - prio(b) || i - j).map(([m]) => m);
}

// runs every move up to `until` through FIFO and weighted average; onMove(m, { fifo, avg, unit }) sees each move's
// cost (a positive amount: what came in or what went out)
export function costRun(userId, { until = null, items = itemsOf(userId), onMove = null, moves = null } = {}) {
  const st = new Map(); // `${itemId}|${godownId}` → state
  const stateOf = (m) => {
    const k = `${m.itemId}|${m.godownId}`;
    let s = st.get(k);
    if (!s) st.set(k, (s = { itemId: m.itemId, godownId: m.godownId, qty: 0, layers: [], short: 0, aQty: 0, aVal: 0, lastIn: null, lastOut: null, oversold: false }));
    return s;
  };
  const pairs = new Map(); // a transfer's layers on their way to the other godown
  const itemRate = (i) => (i && i.purchase_rate != null && i.purchase_rate !== '' ? Number(i.purchase_rate) : null);
  const avgOf = (s) => (s.aQty > EPS ? s.aVal / s.aQty : null);

  const takeIn = (s, n, cost, src, avgCost = cost) => {
    let add = n;
    if (s.short > EPS) { const c = Math.min(s.short, add); s.short = r3(s.short - c); add = r3(add - c); } // fills what was oversold
    if (add > EPS) s.layers.push({ qty: add, cost, src });
    s.aQty = r3(s.aQty + n); s.aVal += n * avgCost;
    if (Math.abs(s.aQty) <= EPS) { s.aQty = 0; s.aVal = 0; }
    s.qty = r3(s.qty + n); s.lastIn = cost;
  };
  const takeOut = (s, n, item) => {
    let left = n, fifo = 0;
    const taken = [];
    while (left > EPS && s.layers.length) {
      const L = s.layers[0], t = Math.min(L.qty, left);
      fifo += t * L.cost; taken.push({ qty: t, cost: L.cost, src: L.src });
      L.qty = r3(L.qty - t); left = r3(left - t);
      if (L.qty <= EPS) s.layers.shift();
    }
    if (left > EPS) { // more went out than the books show: cost it at the last cost in
      const c = s.lastIn ?? avgOf(s) ?? itemRate(item) ?? 0;
      fifo += left * c; taken.push({ qty: left, cost: c, src: 'oversold' });
      s.short = r3(s.short + left); s.oversold = true;
    }
    const a = avgOf(s) ?? (n ? fifo / n : 0);
    const avg = n * a;
    s.aQty = r3(s.aQty - n); s.aVal -= avg;
    if (Math.abs(s.aQty) <= EPS) { s.aQty = 0; s.aVal = 0; }
    s.qty = r3(s.qty - n); s.lastOut = n ? fifo / n : s.lastOut;
    return { fifo, avg, taken };
  };

  for (const m of moves || orderedMoves(userId, until)) {
    if (until && m.day > until) continue;
    const item = items.get(m.itemId), s = stateOf(m), n = Math.abs(Number(m.qty) || 0);
    if (!n) continue;
    let fifo = 0, avg = 0;
    if (m.qty > 0) {
      let cost, src = 'rate', aCost;
      if (m.kind === 'TRANSFER_IN' && m.pair && pairs.has(m.pair)) {
        const p = pairs.get(m.pair); pairs.delete(m.pair);
        for (const L of p.taken) { takeIn(s, L.qty, L.cost, L.src, p.avgUnit); fifo += L.qty * L.cost; }
        const extra = r3(n - p.taken.reduce((t, L) => t + L.qty, 0));
        if (extra > EPS) { takeIn(s, extra, p.avgUnit, 'rate'); fifo += extra * p.avgUnit; }
        avg = n * p.avgUnit;
        onMove?.(m, { fifo: r2(fifo), avg: r2(avg), unit: n ? fifo / n : 0 });
        continue;
      }
      if (m.kind === 'RETURN_IN') { cost = s.lastOut ?? avgOf(s) ?? itemRate(item); aCost = avgOf(s) ?? cost; }
      else if (m.kind === 'ADJUST' && m.rate == null) cost = avgOf(s) ?? s.lastIn ?? itemRate(item);
      else if (m.rate != null && m.rate !== '') cost = Number(m.rate);
      else { cost = itemRate(item); src = 'item'; }
      if (cost == null || !Number.isFinite(cost)) { cost = 0; src = 'none'; }
      if (m.kind === 'RETURN_IN' || m.kind === 'ADJUST' || m.kind === 'TRANSFER_IN') src = cost ? 'rate' : 'none';
      takeIn(s, n, cost, src, aCost ?? cost);
      fifo = n * cost; avg = n * (aCost ?? cost);
    } else {
      const o = takeOut(s, n, item);
      fifo = o.fifo; avg = o.avg;
      if (m.kind === 'TRANSFER_OUT' && m.pair) pairs.set(m.pair, { taken: o.taken, avgUnit: n ? o.avg / n : 0 });
    }
    onMove?.(m, { fifo: r2(fifo), avg: r2(avg), unit: n ? fifo / n : 0 });
  }
  return st;
}

// ---------- 1. stock valuation ----------
export function valuation(userId, { asOf = ymd(), godownId = '', all = false } = {}) {
  if (!isDay(asOf)) fail(400, 'Pick a date, like 2026-10-31');
  const items = itemsOf(userId), godowns = godownsOf(userId);
  if (godownId && godowns.get(godownId)?.userId !== userId) fail(404, 'That godown isn’t yours');
  const st = costRun(userId, { until: asOf, items });
  const per = new Map();
  for (const s of st.values()) {
    if (godownId && s.godownId !== godownId) continue;
    const qty = r3(s.qty), live = s.layers.filter((L) => L.qty > EPS);
    const fifo = qty > EPS ? r2(live.reduce((t, L) => t + L.qty * L.cost, 0)) : 0, avg = qty > EPS ? r2(s.aVal) : 0;
    const row = per.get(s.itemId) || per.set(s.itemId, { qty: 0, fifo: 0, average: 0, by_godown: [], no_cost: false, assumed: false, negative: false, oversold: false }).get(s.itemId);
    row.qty = r3(row.qty + qty); row.fifo = r2(row.fifo + fifo); row.average = r2(row.average + avg);
    if (qty > EPS && live.some((L) => L.src === 'none' || L.cost === 0)) row.no_cost = true;
    if (qty > EPS && live.some((L) => L.src === 'item')) row.assumed = true;
    if (qty < -EPS) row.negative = true;
    if (s.oversold) row.oversold = true;
    row.by_godown.push({ godownId: s.godownId, godown: godowns.get(s.godownId)?.name || '—', qty, fifo, average: avg });
  }
  const parents = new Set([...items.values()].map((i) => i.parent_id).filter(Boolean));
  const out = [...per.entries()].map(([id, x]) => {
    const i = items.get(id) || {};
    return { id, name: i.name || '?', unit: i.unit || '', category: i.category || null, active: i.active !== false, qty: x.qty,
      fifo: { value: x.fifo, rate: x.qty > EPS ? r2(x.fifo / x.qty) : null }, average: { value: x.average, rate: x.qty > EPS ? r2(x.average / x.qty) : null },
      by_godown: x.by_godown.filter((g) => Math.abs(g.qty) > EPS).sort((a, b) => a.godown.localeCompare(b.godown)),
      no_cost: x.no_cost, assumed_cost: x.assumed, negative: x.negative, flagged: x.no_cost || x.negative };
  }).filter((x) => !parents.has(x.id) && (all || Math.abs(x.qty) > EPS)).sort((a, b) => b.fifo.value - a.fifo.value || a.name.localeCompare(b.name));
  const byG = new Map();
  for (const x of out) for (const g of x.by_godown) {
    const t = byG.get(g.godownId) || byG.set(g.godownId, { id: g.godownId, name: g.godown, items: 0, fifo: 0, average: 0 }).get(g.godownId);
    if (g.qty > EPS) t.items++;
    t.fifo = r2(t.fifo + g.fifo); t.average = r2(t.average + g.average);
  }
  return {
    as_of: asOf, godownId: godownId || null,
    totals: { items: out.filter((x) => x.qty > EPS).length, qty_lines: out.length, fifo: r2(out.reduce((t, x) => t + x.fifo.value, 0)), average: r2(out.reduce((t, x) => t + x.average.value, 0)) },
    godowns: [...byG.values()].sort((a, b) => b.fifo - a.fifo), items: out,
    flagged: { no_cost: out.filter((x) => x.no_cost).map((x) => x.name), assumed_cost: out.filter((x) => x.assumed_cost).map((x) => x.name), negative: out.filter((x) => x.negative).map((x) => x.name) },
    rules: 'Purchases and opening stock at their purchase rate (before GST); production at the bill-of-materials cost recorded on it; customer returns at the cost they went out at. A stock entry with no rate uses the item’s purchase rate (marked “assumed”); with neither it counts at ₹0 (marked “no cost rate”). Stock below zero counts as ₹0.',
  };
}
const stockValue = (userId, day, items) => {
  let v = 0;
  for (const s of costRun(userId, { until: day, items }).values()) if (s.qty > EPS) v += s.layers.reduce((t, L) => t + L.qty * L.cost, 0);
  return r2(v);
};

// ---------- 2. profit & loss: the trading account ----------
export function profitLoss(u, p, { orders = true } = {}) {
  const userId = u.id ?? u, items = itemsOf(userId), bills = billsOf(userId), notes = notesOf(userId), docs = docMoves(bills, notes);
  const rows = new Map();
  const row = (id) => rows.get(id) || rows.set(id, { qty: 0, free_qty: 0, returned_qty: 0, sales: 0, returns: 0, cogs: 0 }).get(id);
  const sales = { counter_bills: 0, credit_notes: 0, stock_sales: 0, stock_returns: 0 }, warn = { unpriced: 0, oversold: new Set() };
  const purchases = { gross: 0, returns: 0, assumed: 0 };
  for (const b of bills) {
    if (b.cancelled || !inP(b.day, p)) continue;
    for (const l of b.lines) { const r = row(l.itemId); r.qty = r3(r.qty + l.qty); r.free_qty = r3(r.free_qty + (l.free_qty || 0)); r.sales = r2(r.sales + l.taxable); }
    sales.counter_bills = r2(sales.counter_bills + b.lines.reduce((t, l) => t + l.taxable, 0));
  }
  for (const n of notes) {
    if (!inP(n.day, p)) continue;
    for (const l of n.lines) { const r = row(l.itemId); r.returned_qty = r3(r.returned_qty + l.qty); r.returns = r2(r.returns + l.taxable); }
    sales.credit_notes = r2(sales.credit_notes + n.taxable);
  }
  costRun(userId, {
    until: p.to, items,
    onMove: (m, c) => {
      if (m.day < p.from) return;
      const n = Math.abs(m.qty), rate = m.rate != null && m.rate !== '' ? Number(m.rate) : null;
      if (m.kind === 'SALE') {
        const r = row(m.itemId); r.cogs = r2(r.cogs + c.fifo);
        if (!docs.bill.has(m.id)) { r.qty = r3(r.qty + n); if (rate == null) warn.unpriced++; const v = r2(n * (rate || 0)); r.sales = r2(r.sales + v); sales.stock_sales = r2(sales.stock_sales + v); }
      } else if (m.kind === 'RETURN_IN') {
        const r = row(m.itemId); r.cogs = r2(r.cogs - c.fifo);
        if (!docs.note.has(m.id)) { r.returned_qty = r3(r.returned_qty + n); const v = r2(n * (rate || 0)); r.returns = r2(r.returns + v); sales.stock_returns = r2(sales.stock_returns + v); }
      } else if (m.kind === 'PURCHASE') {
        const i = items.get(m.itemId), v = r2(n * (rate ?? (Number(i?.purchase_rate) || 0)));
        if (rate == null) purchases.assumed++;
        purchases.gross = r2(purchases.gross + v);
      } else if (m.kind === 'RETURN_OUT') purchases.returns = r2(purchases.returns + (rate != null ? r2(n * rate) : c.fifo));
    },
  });
  const net = r2(sales.counter_bills - sales.credit_notes + sales.stock_sales - sales.stock_returns);
  const by_item = [...rows.entries()].map(([id, r]) => {
    const i = items.get(id) || {}, ns = r2(r.sales - r.returns), gp = r2(ns - r.cogs);
    return { id, name: i.name || '?', unit: i.unit || '', category: i.category || 'Uncategorised', qty_sold: r.qty, free_qty: r.free_qty, returned_qty: r.returned_qty, sales: r.sales, returns: r.returns, net_sales: ns, cogs: r2(r.cogs), gross_profit: gp, margin_pct: pct(gp, ns) };
  }).filter((x) => x.sales || x.returns || x.cogs || x.qty_sold).sort((a, b) => b.net_sales - a.net_sales || a.name.localeCompare(b.name));
  const cats = new Map();
  for (const x of by_item) {
    const c = cats.get(x.category) || cats.set(x.category, { category: x.category, items: 0, net_sales: 0, cogs: 0, gross_profit: 0 }).get(x.category);
    c.items++; c.net_sales = r2(c.net_sales + x.net_sales); c.cogs = r2(c.cogs + x.cogs); c.gross_profit = r2(c.gross_profit + x.gross_profit);
  }
  const by_category = [...cats.values()].map((c) => ({ ...c, margin_pct: pct(c.gross_profit, c.net_sales) })).sort((a, b) => b.net_sales - a.net_sales);
  const cogs = r2(by_item.reduce((t, x) => t + x.cogs, 0)), gross_profit = r2(net - cogs);
  const opening = stockValue(userId, addDays(p.from, -1), items), closing = stockValue(userId, p.to, items);
  const purchasesNet = r2(purchases.gross - purchases.returns), used = r2(opening + purchasesNet - closing);
  // money from funnel checkouts (orders.js / sales.js) is a different till: shown on its own line, never in the gross profit
  let funnel = null;
  if (orders) {
    const r = q('SELECT COUNT(*) AS n, SUM(net) AS s FROM orders WHERE userId = ? AND paid = 1 AND at >= ? AND at < ?').get(userId, Date.parse(`${p.from}T00:00:00+05:30`), Date.parse(`${addDays(p.to, 1)}T00:00:00+05:30`));
    funnel = { orders: Number(r?.n) || 0, amount: r2(r?.s), note: 'Online checkout sales from your funnels, after refunds and including GST — not part of the stock trading account above (they have no stock cost here).' };
  }
  const warnings = [];
  if (warn.unpriced) warnings.push(`${warn.unpriced} stock ${warn.unpriced === 1 ? 'sale has' : 'sales have'} no rate, so ${warn.unpriced === 1 ? 'it counts' : 'they count'} as ₹0 in sales`);
  if (purchases.assumed) warnings.push(`${purchases.assumed} ${purchases.assumed === 1 ? 'purchase has' : 'purchases have'} no rate — valued at the item’s purchase rate`);
  return {
    from: p.from, to: p.to,
    sales: { ...sales, net }, cogs, gross_profit, margin_pct: pct(gross_profit, net),
    purchases: { gross: purchases.gross, returns: purchases.returns, net: purchasesNet },
    stock: { opening, closing, used, other: r2(used - cogs) },
    by_item, by_category, funnel_sales: funnel, warnings,
    note: 'A gross-profit statement (trading account): sales less the cost of the goods sold. Expenses — rent, salaries, freight, power — aren’t kept in Inventory, so this is not your net profit.',
  };
}

// ---------- 3. party ledger ----------
const LEDGER_KINDS = { SALE: ['Stock sale', 1], RETURN_IN: ['Return from party', -1], PURCHASE: ['Stock purchase', -1], RETURN_OUT: ['Return to party', 1] };
const lineText = (ls, items) => ls.map((m) => `${items.get(m.itemId)?.name || '?'} × ${r3(Math.abs(m.qty))}${m.rate != null ? ` @ ₹${r2(m.rate)}` : ''}`).join(', ');
export function parties(userId) {
  const m = new Map();
  const add = (name, what) => { const k = lower(name); if (!k) return; const x = m.get(k) || m.set(k, { name: clip(name), bills: 0, notes: 0, moves: 0 }).get(k); x[what]++; };
  for (const b of billsOf(userId)) if (!b.cancelled) add(b.party_name, 'bills');
  for (const n of notesOf(userId)) add(n.party_name, 'notes');
  const docs = docMoves(billsOf(userId), notesOf(userId));
  for (const mv of T.imoves.all({ userId, kind: Object.keys(LEDGER_KINDS) })) if (!docs.bill.has(mv.id) && !docs.note.has(mv.id)) add(mv.party_name, 'moves');
  return [...m.values()].sort((a, b) => a.name.localeCompare(b.name));
}
export function partyLedger(userId, party, p = {}) {
  const typed = clip(party, 120);
  if (!typed) fail(400, 'Which party? Give the customer or supplier name');
  const lp = lower(typed), items = itemsOf(userId);
  const name = parties(userId).find((x) => lower(x.name) === lp)?.name || typed; // the name as the books spell it
  const bills = billsOf(userId), notes = notesOf(userId), docs = docMoves(bills, notes);
  const e = [];
  const push = (day, at, type, ref, details, debit, credit) => e.push({ day, at, type, ref: ref || '', details: details || '', debit: r2(debit), credit: r2(credit) });
  for (const b of bills.filter((x) => lower(x.party_name) === lp && !x.cancelled)) {
    const what = b.lines.map((l) => `${l.name} × ${l.qty}${l.free_qty ? ` (+${l.free_qty} free)` : ''}`).join(', ');
    push(b.day, b.at, 'Counter bill', b.number, `${b.credit ? 'On credit' : 'Cash / paid at the counter'} — ${what}`, b.total, 0);
    if (!b.credit) push(b.day, b.at + 1, 'Payment (at the counter)', b.number, 'Paid with the bill', 0, b.total);
    else if (b.paid) {
      const off = notes.filter((n) => n.billId === b.id && n.applies_to === 'bill').reduce((t, n) => t + n.total, 0);
      const at = b.paidAt || b.at + 2;
      push(b.paidAt ? ymd(new Date(b.paidAt)) : b.day, at, 'Payment received (marked paid)', b.number, 'Credit bill marked paid', 0, r2(b.total - off));
    }
  }
  for (const n of notes.filter((x) => lower(x.party_name) === lp)) {
    push(n.day, n.at, 'Credit note', n.number, `Return on ${n.bill_number}${n.reason ? ` — ${n.reason}` : ''} · refund ${n.refund_mode === 'cash' ? 'in cash' : 'as credit'}`, 0, n.total);
    if (n.refund_mode === 'cash') push(n.day, n.at + 1, 'Refund paid (cash)', n.number, 'Cash refund for the return', n.total, 0);
  }
  // stock entries with this party, outside bills and notes: one line per (day, kind, bill number)
  const groups = new Map();
  for (const m of T.imoves.all({ userId, kind: Object.keys(LEDGER_KINDS) }, { order: 'rowid' })) {
    if (lower(m.party_name) !== lp || docs.bill.has(m.id) || docs.note.has(m.id)) continue;
    const k = `${m.day}|${m.kind}|${m.ref || m.id}`;
    (groups.get(k) || groups.set(k, []).get(k)).push(m);
  }
  let unpriced = 0;
  for (const ms of groups.values()) {
    const m = ms[0], [label, sign] = LEDGER_KINDS[m.kind];
    if (ms.some((x) => x.rate == null)) unpriced++;
    const v = ms.reduce((t, x) => t + Math.abs(x.qty) * (Number(x.rate) || 0), 0);
    push(m.day, m.at, label, m.ref, lineText(ms, items), sign > 0 ? v : 0, sign < 0 ? v : 0);
  }
  e.sort((a, b) => a.day.localeCompare(b.day) || a.at - b.at);
  const from = isDay(p.from) ? p.from : null, to = isDay(p.to) ? p.to : null;
  const opening = r2(e.filter((x) => from && x.day < from).reduce((t, x) => t + x.debit - x.credit, 0));
  let bal = opening;
  const entries = e.filter((x) => (!from || x.day >= from) && (!to || x.day <= to)).map(({ at, ...x }) => { bal = r2(bal + x.debit - x.credit); return { ...x, balance: bal, side: bal > 0 ? 'Dr' : bal < 0 ? 'Cr' : '' }; });
  const debit = r2(entries.reduce((t, x) => t + x.debit, 0)), credit = r2(entries.reduce((t, x) => t + x.credit, 0));
  return {
    party: name, from, to, opening, opening_side: opening > 0 ? 'Dr' : opening < 0 ? 'Cr' : '', entries, totals: { debit, credit }, closing: bal, closing_side: bal > 0 ? 'Dr' : bal < 0 ? 'Cr' : '',
    meaning: bal > 0 ? `${name} owes you ₹${Math.abs(bal).toLocaleString('en-IN')}` : bal < 0 ? `You owe ${name} ₹${Math.abs(bal).toLocaleString('en-IN')}` : `Nothing due either way`,
    found: e.length > 0,
    note: 'Dr = the party owes you; Cr = you owe the party. Counter bills, credit notes and payments come from your counter billing; stock entries (purchases, sales and returns with this party’s name) at their recorded rates — payments against stock entries aren’t recorded in Inventory, so settle those in your books.'
      + (unpriced ? ` ${unpriced} stock ${unpriced === 1 ? 'entry has' : 'entries have'} no rate and count as ₹0.` : ''),
  };
}

// ---------- 4. day book, registers, GST summary ----------
const KIND_NAME = { OPENING: 'Opening stock', PURCHASE: 'Purchase', SALE: 'Stock sale', RETURN_IN: 'Return in', RETURN_OUT: 'Return out', ADJUST: 'Adjustment', TRANSFER_IN: 'Transfer', TRANSFER_OUT: 'Transfer', PRODUCE: 'Production', CONSUME: 'Production' };
export function dayBook(userId, p) {
  const items = itemsOf(userId), godowns = godownsOf(userId), bills = billsOf(userId), notes = notesOf(userId), docs = docMoves(bills, notes);
  const rows = [];
  for (const b of bills) if (inP(b.day, p)) rows.push({ day: b.day, at: b.at, type: b.cancelled ? 'Counter bill (cancelled)' : 'Counter bill', ref: b.number, party: b.party_name || '', details: `${b.lines.length} ${b.lines.length === 1 ? 'line' : 'lines'}${b.credit ? ' · on credit' : ''}`, qty: r3(b.lines.reduce((t, l) => t + l.qty + (l.free_qty || 0), 0)), amount: b.cancelled ? 0 : b.total });
  for (const n of notes) if (inP(n.day, p)) rows.push({ day: n.day, at: n.at, type: 'Credit note', ref: n.number, party: n.party_name || '', details: `Return on ${n.bill_number} · refund ${n.refund_mode}`, qty: r3(n.lines.reduce((t, l) => t + l.qty, 0)), amount: n.total });
  const groups = new Map();
  for (const m of T.imoves.all({ userId, day: { gte: p.from, lte: p.to } }, { order: 'rowid' })) {
    if (docs.bill.has(m.id) || docs.note.has(m.id)) continue;
    const k = m.pair ? `pair|${m.pair}` : ['PRODUCE', 'CONSUME'].includes(m.kind) && m.ref ? `prd|${m.ref}` : `${m.day}|${m.kind}|${m.ref || ''}|${lower(m.party_name)}|${m.godownId}|${m.ref ? '' : m.id}`;
    (groups.get(k) || groups.set(k, []).get(k)).push(m);
  }
  for (const ms of groups.values()) {
    const m = ms[0], priced = ms.every((x) => x.rate != null);
    let details, qty = r3(ms.reduce((t, x) => t + Math.abs(x.qty), 0)), amount = priced ? r2(ms.reduce((t, x) => t + Math.abs(x.qty) * Number(x.rate), 0)) : null;
    if (m.pair) {
      const out = ms.find((x) => x.kind === 'TRANSFER_OUT') || m, inn = ms.find((x) => x.kind === 'TRANSFER_IN') || m;
      details = `${items.get(m.itemId)?.name || '?'} × ${r3(Math.abs(out.qty))}: ${godowns.get(out.godownId)?.name || '?'} → ${godowns.get(inn.godownId)?.name || '?'}`;
      qty = r3(Math.abs(out.qty)); amount = null;
    } else if (m.kind === 'PRODUCE' || m.kind === 'CONSUME') {
      const made = ms.filter((x) => x.kind === 'PRODUCE'), used = ms.filter((x) => x.kind === 'CONSUME');
      details = `Made ${lineText(made, items)}${used.length ? ` · used ${used.length} ${used.length === 1 ? 'item' : 'items'}` : ''}`;
      qty = r3(made.reduce((t, x) => t + x.qty, 0)); amount = made.length && made.every((x) => x.rate != null) ? r2(made.reduce((t, x) => t + x.qty * x.rate, 0)) : null;
    } else details = lineText(ms, items) + (m.kind === 'ADJUST' ? ` (${m.qty > 0 ? '+' : '−'})` : '');
    rows.push({ day: m.day, at: m.at, type: KIND_NAME[m.kind] || m.kind, ref: m.ref || '', party: m.pair ? '' : m.party_name || '', details, qty, amount });
  }
  rows.sort((a, b) => a.day.localeCompare(b.day) || a.at - b.at);
  return { from: p.from, to: p.to, rows: rows.map(({ at, ...r }) => r), count: rows.length };
}

export function salesRegister(userId, p) {
  const items = itemsOf(userId), bills = billsOf(userId), notes = notesOf(userId), docs = docMoves(bills, notes);
  const rows = [];
  const doc = (d, type, sign, status) => rows.push({ day: d.day, at: d.at, type, number: d.number, party: d.party_name || '', gstin: d.buyer?.gstin || '', place_of_supply: d.place_of_supply || '',
    taxable: r2(sign * d.taxable), cgst: r2(sign * (d.cgst || 0)), sgst: r2(sign * (d.sgst || 0)), igst: r2(sign * (d.igst || 0)), total: r2(sign * d.total), status });
  for (const b of bills) if (inP(b.day, p)) {
    if (b.cancelled) rows.push({ day: b.day, at: b.at, type: 'Counter bill', number: b.number, party: b.party_name || '', gstin: b.buyer?.gstin || '', place_of_supply: b.place_of_supply || '', taxable: 0, cgst: 0, sgst: 0, igst: 0, total: 0, status: 'Cancelled' });
    else doc(b, 'Counter bill', 1, b.credit ? (b.paid ? 'Credit · paid' : 'Credit · unpaid') : 'Paid');
  }
  for (const n of notes) if (inP(n.day, p)) doc(n, 'Credit note', -1, `Against ${n.bill_number} · ${n.refund_mode}`);
  // stock sales recorded without a counter bill: no GST worked out on them here
  const groups = new Map();
  for (const m of T.imoves.all({ userId, kind: 'SALE', day: { gte: p.from, lte: p.to } }, { order: 'rowid' })) {
    if (docs.bill.has(m.id)) continue;
    const k = `${m.day}|${m.ref || m.id}|${lower(m.party_name)}`;
    (groups.get(k) || groups.set(k, []).get(k)).push(m);
  }
  for (const ms of groups.values()) {
    const m = ms[0], v = r2(ms.reduce((t, x) => t + Math.abs(x.qty) * (Number(x.rate) || 0), 0));
    rows.push({ day: m.day, at: m.at, type: 'Stock sale', number: m.ref || '', party: m.party_name || '', gstin: '', place_of_supply: '', taxable: v, cgst: null, sgst: null, igst: null, total: v, status: `No bill · ${lineText(ms, items)}` });
  }
  rows.sort((a, b) => a.day.localeCompare(b.day) || a.at - b.at);
  const sum = (k) => r2(rows.reduce((t, r) => t + (Number(r[k]) || 0), 0));
  return { from: p.from, to: p.to, rows: rows.map(({ at, ...r }) => r), totals: { taxable: sum('taxable'), cgst: sum('cgst'), sgst: sum('sgst'), igst: sum('igst'), total: sum('total') } };
}

export function purchaseRegister(userId, p) {
  const items = itemsOf(userId);
  const groups = new Map();
  for (const m of T.imoves.all({ userId, kind: ['PURCHASE', 'RETURN_OUT'], day: { gte: p.from, lte: p.to } }, { order: 'rowid' })) {
    const k = `${m.day}|${m.kind}|${m.ref || m.id}|${lower(m.party_name)}`;
    (groups.get(k) || groups.set(k, []).get(k)).push(m);
  }
  const rows = [...groups.values()].map((ms) => {
    const m = ms[0], sign = m.kind === 'RETURN_OUT' ? -1 : 1;
    const val = (x) => Math.abs(x.qty) * (x.rate != null ? Number(x.rate) : Number(items.get(x.itemId)?.purchase_rate) || 0);
    const value = r2(sign * ms.reduce((t, x) => t + val(x), 0)), gst = r2(sign * ms.reduce((t, x) => t + (val(x) * (Number(items.get(x.itemId)?.gst_percent) || 0)) / 100, 0));
    return { day: m.day, at: m.at, type: m.kind === 'RETURN_OUT' ? 'Return to supplier' : 'Purchase', ref: m.ref || '', party: m.party_name || '', items: lineText(ms, items), qty: r3(ms.reduce((t, x) => t + Math.abs(x.qty), 0)), value, gst_est: gst, total_est: r2(value + gst), rate_missing: ms.some((x) => x.rate == null) };
  }).sort((a, b) => a.day.localeCompare(b.day) || a.at - b.at);
  const sum = (k) => r2(rows.reduce((t, r) => t + r[k], 0));
  return { from: p.from, to: p.to, rows: rows.map(({ at, ...r }) => r), totals: { value: sum('value'), gst_est: sum('gst_est'), total_est: sum('total_est') },
    note: 'Purchase values are at the rates on your stock entries (before GST). GST is an estimate at each item’s GST % — your supplier’s bill is what counts for input credit.' };
}

export function gstSummary(userId, p) {
  const bills = billsOf(userId).filter((b) => !b.cancelled && inP(b.day, p)), notes = notesOf(userId).filter((n) => inP(n.day, p));
  const m = new Map();
  const add = (lines, sign, intra) => {
    for (const l of lines) {
      const rate = Number(l.gst_percent) || 0;
      const x = m.get(rate) || m.set(rate, { rate, sales_taxable: 0, returns_taxable: 0, taxable: 0, cgst: 0, sgst: 0, igst: 0, tax: 0 }).get(rate);
      if (sign > 0) x.sales_taxable += l.taxable; else x.returns_taxable += l.taxable;
      // older lines may not carry the split: work it out from intra / inter
      const cg = l.cgst ?? (intra ? l.gst / 2 : 0), sg = l.sgst ?? (intra ? l.gst - l.gst / 2 : 0), ig = l.igst ?? (intra ? 0 : l.gst);
      x.taxable += sign * l.taxable; x.cgst += sign * cg; x.sgst += sign * sg; x.igst += sign * ig; x.tax += sign * l.gst;
    }
  };
  for (const b of bills) add(b.lines, 1, b.intra !== false);
  for (const n of notes) add(n.lines, -1, n.intra !== false);
  const rows = [...m.values()].map((x) => Object.fromEntries(Object.entries(x).map(([k, v]) => [k, k === 'rate' ? v : r2(v)]))).sort((a, b) => a.rate - b.rate);
  const sum = (k) => r2(rows.reduce((t, r) => t + r[k], 0));
  const onBill = docMoves(billsOf(userId), []).bill;
  const unbilled = T.imoves.all({ userId, kind: 'SALE', day: { gte: p.from, lte: p.to } }).filter((mv) => !onBill.has(mv.id));
  return { from: p.from, to: p.to, rows, totals: { sales_taxable: sum('sales_taxable'), returns_taxable: sum('returns_taxable'), taxable: sum('taxable'), cgst: sum('cgst'), sgst: sum('sgst'), igst: sum('igst'), tax: sum('tax') },
    bills: bills.length, credit_notes: notes.length, unbilled_sales: unbilled.length,
    note: `Counter bills less credit notes, by GST rate.${unbilled.length ? ` ${unbilled.length} stock ${unbilled.length === 1 ? 'sale' : 'sales'} recorded without a counter bill ${unbilled.length === 1 ? 'isn’t' : 'aren’t'} included — no GST was worked out on ${unbilled.length === 1 ? 'it' : 'them'}.` : ''}` };
}

// ---------- 5. fast / slow / dead stock ----------
// the same rules as Tally's insights (tally-insights.js): speed is the busier of the last 30 and 90 days; stock lasting
// more than 90 days at that speed is slow; stock with no sale in 90 days is dead. Speed counts what was sold and what
// production used, less customer returns. Reorder: when stock is at / below the reorder level or runs out within the
// supplier's lead time; suggested quantity covers lead + safety days of sales and keeps the reorder level in hand.
export const LEAD_DAYS = 7, SAFETY_DAYS = 7, SLOW_DAYS = 90;
export function movement(userId, today = ymd()) {
  const items = itemsOf(userId), d30 = addDays(today, -30), d90 = addDays(today, -90);
  const used = new Map(), lastSold = new Map(), supplier = new Map();
  const bump = (id) => used.get(id) || used.set(id, { s30: 0, s90: 0, value90: 0 }).get(id);
  const st = costRun(userId, {
    until: today, items,
    onMove: (m) => {
      if (m.kind === 'SALE' && (!lastSold.has(m.itemId) || m.day > lastSold.get(m.itemId))) lastSold.set(m.itemId, m.day);
      if (m.kind === 'PURCHASE' && m.party_name) supplier.set(m.itemId, { name: m.party_name, rate: m.rate, day: m.day }); // date order: the latest wins
      if (m.day <= d90 || !['SALE', 'CONSUME', 'RETURN_IN'].includes(m.kind)) return;
      const n = m.kind === 'RETURN_IN' ? -Math.abs(m.qty) : Math.abs(m.qty), s = bump(m.itemId);
      s.s90 += n; if (m.day > d30) s.s30 += n;
      const rate = m.kind === 'CONSUME' ? Number(items.get(m.itemId)?.purchase_rate) || 0 : Number(m.rate) || 0;
      s.value90 += n * rate;
    },
  });
  const qty = new Map(), value = new Map();
  for (const s of st.values()) {
    qty.set(s.itemId, r3((qty.get(s.itemId) || 0) + s.qty));
    if (s.qty > EPS) value.set(s.itemId, (value.get(s.itemId) || 0) + s.layers.reduce((t, L) => t + L.qty * L.cost, 0));
  }
  const parents = new Set([...items.values()].map((i) => i.parent_id).filter(Boolean));
  const all = [...items.values()].filter((i) => i.active !== false && !parents.has(i.id)).map((i) => {
    const s = used.get(i.id), s30 = Math.max(0, s?.s30 || 0), s90 = Math.max(0, s?.s90 || 0), speed = Math.max(s30 / 30, s90 / 90);
    const stock = qty.get(i.id) || 0, level = Number(i.reorder_level) || 0, last = lastSold.get(i.id) || null, sup = supplier.get(i.id);
    const daysLeft = !speed ? null : stock <= 0 ? 0 : Math.floor(stock / speed);
    const due = (speed > 0 && (stock <= 0 || daysLeft <= LEAD_DAYS)) || (level > 0 && stock <= level);
    const reorderQty = due ? Math.max(0, Math.ceil(speed * (LEAD_DAYS + SAFETY_DAYS) + level - Math.max(stock, 0) - 1e-9)) : 0;
    return { id: i.id, name: i.name, unit: i.unit || '', category: i.category || null, stock, value: r2(value.get(i.id) || 0), reorder_level: i.reorder_level ?? null,
      sold30: r2(s30), sold90: r2(s90), salesValue90: r2(Math.max(0, s?.value90 || 0)), perDay: r2(speed), daysLeft, lastSold: last, soldIn90: !!last && last > d90,
      reorder: due, reorderQty, supplier: sup?.name || null, lastRate: sup?.rate ?? (i.purchase_rate ?? null) };
  });
  const reorder = all.filter((x) => x.reorder).sort((a, b) => (a.daysLeft ?? 1e9) - (b.daysLeft ?? 1e9) || b.perDay - a.perDay);
  const dead = all.filter((x) => x.stock > EPS && !x.soldIn90 && !(x.sold90 > 0)).sort((a, b) => b.value - a.value);
  const selling = all.filter((x) => x.salesValue90 > 0).sort((a, b) => b.salesValue90 - a.salesValue90);
  const fast = selling.slice(0, Math.min(25, Math.max(1, Math.ceil(selling.length / 5)))).filter((x) => x.perDay > 0);
  const slow = all.filter((x) => x.stock > EPS && x.perDay > 0 && x.daysLeft != null && x.daysLeft > SLOW_DAYS).sort((a, b) => b.value - a.value);
  return { asOf: today, leadDays: LEAD_DAYS, safetyDays: SAFETY_DAYS, slowDays: SLOW_DAYS,
    counts: { items: all.length, reorder: reorder.length, fast: fast.length, slow: slow.length, dead: dead.length },
    deadValue: r2(dead.reduce((t, x) => t + x.value, 0)), slowValue: r2(slow.reduce((t, x) => t + x.value, 0)),
    reorder: reorder.slice(0, 100), fast, slow: slow.slice(0, 100), dead: dead.slice(0, 100), all };
}

// ---------- CSV ----------
// a text cell starting with = + - @ could run as a formula in a spreadsheet: it gets a leading apostrophe
const csvCell = (v) => {
  if (v == null) return '';
  if (typeof v === 'number') return String(v);
  const s = /^[=+\-@]/.test(String(v)) ? `'${v}` : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
export const toCsv = (cols, rows) => `﻿${[cols.map(([, l]) => csvCell(l)).join(','), ...rows.map((r) => cols.map(([k]) => csvCell(typeof k === 'function' ? k(r) : r[k])).join(','))].join('\r\n')}\r\n`;
export const CSV = {
  valuation: (d) => [`stock-valuation-${d.as_of}.csv`, toCsv([['name', 'Item'], ['category', 'Category'], ['unit', 'Unit'], ['qty', 'Quantity'], [(r) => r.fifo.rate, 'FIFO rate'], [(r) => r.fifo.value, 'FIFO value'], [(r) => r.average.rate, 'Average rate'], [(r) => r.average.value, 'Average value'], [(r) => r.by_godown.map((g) => `${g.godown}: ${g.qty}`).join('; '), 'Godowns'], [(r) => [r.no_cost && 'no cost rate', r.assumed_cost && 'assumed at item rate', r.negative && 'below zero'].filter(Boolean).join('; '), 'Flags']],
    [...d.items, { name: 'Total', fifo: { value: d.totals.fifo }, average: { value: d.totals.average }, by_godown: [] }])],
  ledger: (d) => [`ledger-${lower(d.party).replace(/[^a-z0-9]+/g, '-')}.csv`, toCsv([['day', 'Date'], ['type', 'Type'], ['ref', 'Number'], ['details', 'Details'], ['debit', 'Debit (₹)'], ['credit', 'Credit (₹)'], [(r) => r.balance == null ? '' : `${Math.abs(r.balance)} ${r.side}`.trim(), 'Balance']],
    [{ day: d.from || '', type: 'Opening balance', balance: d.opening, side: d.opening_side }, ...d.entries, { type: 'Total', debit: d.totals.debit, credit: d.totals.credit, balance: d.closing, side: d.closing_side }])],
  daybook: (d) => [`day-book-${d.from}-to-${d.to}.csv`, toCsv([['day', 'Date'], ['type', 'Type'], ['ref', 'Number'], ['party', 'Party'], ['details', 'Details'], ['qty', 'Quantity'], ['amount', 'Amount (₹)']], d.rows)],
  sales: (d) => [`sales-register-${d.from}-to-${d.to}.csv`, toCsv([['day', 'Date'], ['type', 'Type'], ['number', 'Number'], ['party', 'Party'], ['gstin', 'GSTIN'], ['place_of_supply', 'Place of supply'], ['taxable', 'Taxable (₹)'], ['cgst', 'CGST'], ['sgst', 'SGST'], ['igst', 'IGST'], ['total', 'Total (₹)'], ['status', 'Status']], [...d.rows, { type: 'Total', ...d.totals }])],
  purchases: (d) => [`purchase-register-${d.from}-to-${d.to}.csv`, toCsv([['day', 'Date'], ['type', 'Type'], ['ref', 'Bill number'], ['party', 'Supplier'], ['items', 'Items'], ['qty', 'Quantity'], ['value', 'Value before GST (₹)'], ['gst_est', 'GST (estimated)'], ['total_est', 'Total (estimated)']], [...d.rows, { type: 'Total', ...d.totals }])],
  gst: (d) => [`gst-summary-${d.from}-to-${d.to}.csv`, toCsv([[(r) => (r.rate == null ? 'Total' : `${r.rate}%`), 'GST rate'], ['sales_taxable', 'Sales taxable (₹)'], ['returns_taxable', 'Returns taxable (₹)'], ['taxable', 'Net taxable (₹)'], ['cgst', 'CGST'], ['sgst', 'SGST'], ['igst', 'IGST'], ['tax', 'Total tax']], [...d.rows, { rate: null, ...d.totals }])],
  movement: (d) => [`stock-movement-${d.asOf}.csv`, toCsv([['name', 'Item'], ['category', 'Category'], ['unit', 'Unit'], ['stock', 'In stock'], ['value', 'Value (FIFO)'], ['sold30', 'Sold 30 days'], ['sold90', 'Sold 90 days'], ['perDay', 'Per day'], ['daysLeft', 'Days of stock'], ['lastSold', 'Last sold'], [(r) => r.reorder ? r.reorderQty : '', 'Reorder qty'], ['supplier', 'Last supplier'],
    [(r) => (d.fast.some((x) => x.id === r.id) ? 'Fast' : d.dead.some((x) => x.id === r.id) ? 'Dead' : d.slow.some((x) => x.id === r.id) ? 'Slow' : ''), 'Speed']], d.all)],
};
// the trading account, then its items and categories
CSV.pnl = (d) => [`profit-and-loss-${d.from}-to-${d.to}.csv`, toCsv([['a', 'Line'], ['b', 'Amount (₹)'], ['c', 'Cost of goods (₹)'], ['d', 'Gross profit (₹)'], ['e', 'Margin %'], ['f', 'Qty sold'], ['g', 'Free units']], [
  { a: 'Counter bills (taxable value)', b: d.sales.counter_bills }, { a: 'Less: credit notes', b: -d.sales.credit_notes }, { a: 'Stock sales without a bill', b: d.sales.stock_sales }, { a: 'Less: returns without a credit note', b: -d.sales.stock_returns },
  { a: 'Net sales', b: d.sales.net }, { a: 'Cost of goods sold (FIFO)', b: d.cogs }, { a: 'Gross profit', b: d.gross_profit }, { a: 'Gross margin %', b: d.margin_pct },
  { a: 'Opening stock', b: d.stock.opening }, { a: 'Purchases (net of returns)', b: d.purchases.net }, { a: 'Closing stock', b: d.stock.closing }, { a: 'Adjustments, write-offs & production (net)', b: d.stock.other },
  ...(d.funnel_sales ? [{ a: 'Memo: online funnel sales (incl. GST, not in the above)', b: d.funnel_sales.amount }] : []), { a: 'Expenses are not tracked in Inventory: this is gross profit, not net profit' }, {}, { a: 'By item' },
  ...d.by_item.map((x) => ({ a: x.name, b: x.net_sales, c: x.cogs, d: x.gross_profit, e: x.margin_pct, f: x.qty_sold, g: x.free_qty })),
  {}, { a: 'By category' }, ...d.by_category.map((x) => ({ a: x.category, b: x.net_sales, c: x.cogs, d: x.gross_profit, e: x.margin_pct })),
])];

// ---------- routes ----------
export function registerInventoryReports(app, { auth }) {
  const R = '/api/inventory/reports';
  const on = (req, res, next) => (inventoryOn(req.user) ? next() : res.status(403).json({ error: 'Inventory isn’t switched on for your account — ask us to turn it on', code: 'INVENTORY_OFF' }));
  // JSON, or CSV with ?format=csv
  const get = (path, csv, fn) => app.get(R + path, auth, on, (req, res) => {
    try {
      const d = fn(req);
      if (req.query.format === 'csv' && csv) { const [name, text] = CSV[csv](d); res.setHeader('Content-Type', 'text/csv; charset=utf-8'); res.setHeader('Content-Disposition', `attachment; filename="${name}"`); return res.send(text); }
      res.json(d);
    } catch (e) {
      if (e.status >= 400 && e.status < 500) return res.status(e.status).json({ error: e.message });
      console.error(e); res.status(500).json({ error: 'Couldn’t make this report right now — try again' });
    }
  });
  const uid_ = (req) => req.user.id;
  get('/valuation', 'valuation', (req) => valuation(uid_(req), { asOf: req.query.asOf ? String(req.query.asOf) : ymd(), godownId: clip(req.query.godownId, 60), all: req.query.all === '1' }));
  get('/pnl', 'pnl', (req) => profitLoss(req.user, period(req.query)));
  get('/parties', null, (req) => ({ parties: parties(uid_(req)) }));
  get('/ledger', 'ledger', (req) => partyLedger(uid_(req), req.query.party, { from: req.query.from, to: req.query.to }));
  get('/daybook', 'daybook', (req) => dayBook(uid_(req), period(req.query)));
  get('/sales-register', 'sales', (req) => salesRegister(uid_(req), period(req.query)));
  get('/purchase-register', 'purchases', (req) => purchaseRegister(uid_(req), period(req.query)));
  get('/gst-summary', 'gst', (req) => gstSummary(uid_(req), period(req.query)));
  get('/movement', 'movement', (req) => movement(uid_(req)));
}
