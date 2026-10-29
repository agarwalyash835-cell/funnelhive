// Stock insights on the Tally mirror (phase 1 of inventory): reorder alerts from how fast items sell, fast / slow /
// dead stock, purchase-order drafts. Routes live under /api/tally/insights.
// Everything is worked out from what the connector already synced (tally.js): stock items' closing balance / value and
// the stock lines of Sales, Credit Note and Purchase vouchers. Nothing is stored; nothing is sent to suppliers — the PO
// drafts are text plus a wa.me link the seller taps themselves.
import { T, q } from './db.js';
import { tallyOn, selectedCompany, istDay, TallyError } from './tally.js';

const DAY = 864e5;
// days a supplier takes to deliver, and the cushion kept on top (seller-adjustable later)
export const LEAD_DAYS = 7, SAFETY_DAYS = 7;
const SLOW_DAYS = 90; // more than this many days of stock at today's speed is slow
const CAP = 100; // rows per list in one reply
const lname = (v) => String(v ?? '').trim().toLowerCase();
const r2 = (n) => Math.round(n * 100) / 100;
const fail = (status, message) => { throw new TallyError(status, message); };

// Tally voucher types are the seller's own names too ("Sales GST", "Purchase - Local"): judge by the words.
// Orders and quotations don't move stock.
const kindOf = (t) => {
  const s = lname(t);
  if (!s || /order|quotation|memorandum|delivery|receipt note|rejection/.test(s)) return null;
  if (/credit note|sales return/.test(s)) return 'return';
  if (/purchase/.test(s)) return 'purchase';
  if (/sale|invoice/.test(s)) return 'sale';
  return null;
};
// a stock line's quantity: what physically moved (actual), else what was billed; Tally's sign depends on direction
const qtyOf = (i) => Math.abs(Number(i.actual_qty ?? i.billed_qty) || 0);

// an Indian mobile for wa.me (91 + 10 digits) from Tally's free-text phone field ("98765 43210, 0141-2345678")
export function waPhone(v) {
  for (const part of String(v || '').split(/[,;/]|\s{2,}/)) {
    let d = part.replace(/\D/g, '');
    if (d.length === 11 && d[0] === '0') d = d.slice(1);
    if (d.length === 10 && /^[6-9]/.test(d)) return `91${d}`;
    if (d.length === 12 && /^91[6-9]/.test(d)) return d;
  }
  return null;
}

// one pass over the vouchers: sales (and returns) in the last 90 days, and the latest purchase of every item
export function stockInsights(company, now = Date.now()) {
  const today = istDay(new Date(now)), d30 = istDay(new Date(now - 30 * DAY)), d90 = istDay(new Date(now - 90 * DAY));
  const sold = new Map(); // lname → { s30, s90, value90, lastSold }
  const rows = q("SELECT json_extract(data, '$.voucher_type') AS t, json_extract(data, '$.voucher_date') AS d, json_extract(data, '$.items') AS i FROM tvouchers WHERE companyId = ? AND active = 1 AND json_extract(data, '$.is_cancelled') = 0 AND json_extract(data, '$.voucher_date') > ? AND json_extract(data, '$.voucher_date') <= ? AND json_array_length(json_extract(data, '$.items')) > 0").all(company.id, d90, today);
  for (const v of rows) {
    const k = kindOf(v.t);
    if (k !== 'sale' && k !== 'return') continue;
    const sign = k === 'sale' ? 1 : -1;
    for (const i of JSON.parse(v.i)) {
      const key = lname(i.stock_item_name), n = qtyOf(i);
      if (!key || !n) continue;
      const s = sold.get(key) || sold.set(key, { s30: 0, s90: 0, value90: 0, lastSold: null }).get(key);
      s.s90 += sign * n;
      if (v.d > d30) s.s30 += sign * n;
      s.value90 += sign * Math.abs(Number(i.amount) || n * (Number(i.rate) || 0));
      if (k === 'sale' && (!s.lastSold || v.d > s.lastSold)) s.lastSold = v.d;
    }
  }
  // the latest purchase per item (any date): who supplied it and at what rate; newest first, first one wins
  const bought = new Map();
  const buys = q("SELECT json_extract(data, '$.voucher_type') AS t, json_extract(data, '$.voucher_date') AS d, json_extract(data, '$.party_name') AS p, json_extract(data, '$.voucher_number') AS n, json_extract(data, '$.items') AS i FROM tvouchers WHERE companyId = ? AND active = 1 AND json_extract(data, '$.is_cancelled') = 0 AND lower(json_extract(data, '$.voucher_type')) LIKE '%purchase%' AND json_array_length(json_extract(data, '$.items')) > 0 ORDER BY json_extract(data, '$.voucher_date') DESC, at DESC").all(company.id);
  for (const v of buys) {
    if (kindOf(v.t) !== 'purchase' || !v.p) continue;
    for (const i of JSON.parse(v.i)) {
      const key = lname(i.stock_item_name);
      if (!key || bought.has(key)) continue;
      const n = qtyOf(i), rate = Number(i.rate) || (n && Number(i.amount) ? Math.abs(Number(i.amount)) / n : null);
      bought.set(key, { supplier: v.p, rate: rate ? r2(Math.abs(rate)) : null, date: v.d, voucher: v.n || null });
    }
  }

  const items = T.tstock.all({ companyId: company.id, active: 1 }).map((x) => {
    const key = lname(x.name), s = sold.get(key), b = bought.get(key);
    const s30 = Math.max(0, s?.s30 || 0), s90 = Math.max(0, s?.s90 || 0);
    // speed: the busier of the last month and the last three months, so a pick-up in demand isn't averaged away
    const speed = Math.max(s30 / 30, s90 / 90);
    const stock = x.closing_balance == null ? null : Number(x.closing_balance), value = Number(x.closing_value) || 0;
    const daysLeft = stock == null || !speed ? null : stock <= 0 ? 0 : Math.floor(stock / speed);
    // enough for the supplier's lead time plus the cushion, less what's on hand (oversold stock doesn't add to it)
    const reorderQty = stock == null || !speed ? 0 : Math.max(0, Math.ceil(speed * (LEAD_DAYS + SAFETY_DAYS) - Math.max(stock, 0) - 1e-9));
    return {
      id: x.id, name: x.name, unit: x.base_units || null, group: x.parent || null, stock, value: r2(value),
      sold30: r2(s30), sold90: r2(s90), salesValue90: r2(Math.max(0, s?.value90 || 0)), perDay: r2(speed), daysLeft, reorderQty, lastSold: s?.lastSold || null,
      supplier: b?.supplier || null, lastRate: b?.rate ?? (x.last_purchase_rate != null ? Math.abs(Number(x.last_purchase_rate)) : null), lastPurchased: b?.date || null,
    };
  });

  const reorder = items.filter((x) => x.stock != null && x.perDay > 0 && (x.stock <= 0 || x.daysLeft <= LEAD_DAYS)).sort((a, b) => a.daysLeft - b.daysLeft || b.perDay - a.perDay);
  const dead = items.filter((x) => x.stock > 0 && !x.lastSold).sort((a, b) => b.value - a.value);
  const selling = items.filter((x) => x.salesValue90 > 0).sort((a, b) => b.salesValue90 - a.salesValue90);
  // fast: the top fifth by what they brought in over 90 days (value, since units differ: kg vs pieces)
  const fast = selling.slice(0, Math.min(25, Math.max(1, Math.ceil(selling.length / 5)))).filter((x) => x.perDay > 0);
  const slow = items.filter((x) => x.lastSold && x.stock > 0 && x.daysLeft != null && x.daysLeft > SLOW_DAYS).sort((a, b) => b.value - a.value);
  return {
    company: { id: company.id, name: company.name }, asOf: today, leadDays: LEAD_DAYS, safetyDays: SAFETY_DAYS, slowDays: SLOW_DAYS,
    counts: { items: items.length, reorder: reorder.length, fast: fast.length, slow: slow.length, dead: dead.length },
    deadValue: r2(dead.reduce((s, x) => s + x.value, 0)), slowValue: r2(slow.reduce((s, x) => s + x.value, 0)),
    reorder: reorder.slice(0, CAP), fast, slow: slow.slice(0, CAP), dead: dead.slice(0, CAP), all: items,
  };
}

// purchase-order drafts: everything that runs out within lead + safety days, grouped by the item's last supplier
export function purchaseOrders(company, ins, { supplier } = {}) {
  const want = lname(supplier);
  const phones = new Map(T.tledgers.all({ companyId: company.id, active: 1 }).map((l) => [lname(l.name), l.phone]));
  const groups = new Map();
  for (const x of ins.all) {
    if (!(x.reorderQty > 0)) continue;
    if (want && !lname(x.supplier).includes(want)) continue;
    const k = lname(x.supplier);
    if (!groups.has(k)) groups.set(k, { supplier: x.supplier, items: [] });
    groups.get(k).items.push({ id: x.id, name: x.name, qty: x.reorderQty, unit: x.unit, lastRate: x.lastRate, stock: x.stock, daysLeft: x.daysLeft, urgent: x.stock <= 0 || x.daysLeft <= LEAD_DAYS });
  }
  const orders = [...groups.values()].map((g) => {
    g.items.sort((a, b) => b.urgent - a.urgent || a.name.localeCompare(b.name));
    const total = g.items.reduce((s, i) => s + (i.lastRate ? i.lastRate * i.qty : 0), 0);
    const priced = g.items.every((i) => i.lastRate);
    const rupees = (n) => `₹${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
    const lines = g.items.map((i, n) => `${n + 1}. ${i.name} — ${i.qty.toLocaleString('en-IN')}${i.unit ? ` ${i.unit}` : ''}${i.lastRate ? ` (last rate ${rupees(i.lastRate)})` : ''}`);
    const message = [`Namaste${g.supplier ? ` ${g.supplier}` : ''},`, '', `Please send the following for ${company.name}:`, ...lines, '',
      ...(total ? [`Approx. ${priced ? '' : 'at least '}${rupees(Math.round(total))} at last rates.`] : []), 'Kindly confirm today’s rates and the delivery date.', '', 'Thank you,', company.name].join('\n');
    const phone = g.supplier ? waPhone(phones.get(lname(g.supplier))) : null;
    return { supplier: g.supplier, phone, items: g.items, urgent: g.items.filter((i) => i.urgent).length, approxTotal: r2(total), message, whatsapp: phone ? `https://wa.me/${phone}?text=${encodeURIComponent(message)}` : null };
  });
  // suppliers with urgent items first, then the biggest orders; items with no known supplier last
  orders.sort((a, b) => !a.supplier - !b.supplier || b.urgent - a.urgent || b.approxTotal - a.approxTotal);
  if (want && !orders.length) {
    const known = [...new Set(ins.all.map((x) => x.supplier).filter(Boolean))].filter((s) => lname(s).includes(want));
    return { company: ins.company, orders, note: known.length ? `Nothing from ${known[0]} needs reordering in the next ${LEAD_DAYS + SAFETY_DAYS} days.` : `No purchase from a supplier named “${supplier}” in Tally yet.` };
  }
  return { company: ins.company, orders };
}

export function registerTallyInsights(app, { auth, wrap }) {
  const send = (fn) => wrap(async (req, res) => {
    try { res.json(await fn(req, res)); } catch (e) { if (e instanceof TallyError) return res.status(e.status).json({ error: e.message, message: e.message }); throw e; }
  });
  const on = (req, res, next) => (tallyOn(req.user) ? next() : res.status(403).json({ error: 'Tally isn’t switched on for your account — ask us to turn it on', code: 'TALLY_OFF' }));
  const S = '/api/tally/insights';
  const company = (req) => selectedCompany(req.user.id) || fail(404, 'No Tally company synced yet — connect your PC on the Tally page');
  app.get(S, auth, on, send((req) => {
    const { all, ...ins } = stockInsights(company(req));
    // one item's figures when asked (Hive: "how fast does Steel Rod sell?")
    const s = lname(req.query.search).slice(0, 120);
    return s ? { ...ins, items: all.filter((x) => lname(x.name).includes(s)).slice(0, 25) } : ins;
  }));
  app.get(`${S}/purchase-orders`, auth, on, send((req) => { const c = company(req); return purchaseOrders(c, stockInsights(c), { supplier: String(req.query.supplier || '').slice(0, 200) }); }));
}
