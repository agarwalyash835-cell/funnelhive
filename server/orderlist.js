// The Orders page a page at a time: filters, search and the totals run in SQLite over every matching
// order (not over the newest few thousand in the browser), with the same rules the page always used.
import { q } from './db.js';

export const ORDERS_MAX = 5000; // the most one request returns (and what callers without ?limit get, as before)
const J = (p) => `json_extract(x.data, '$.${p}')`;
const FX = `COALESCE(NULLIF(${J('fx')}, 0), 1)`;
const ST = `IFNULL(${J('status')}, '')`;
// testOrder (db.js) in SQL: paid with test keys, or placed while no payment provider was connected
const TEST = `(IFNULL(${J('mode')} = 'test', 0) OR (IFNULL(${J('provider')}, '') IN ('', 0) AND NOT IFNULL(x.demo, 0) AND IFNULL(${J('paymentMethod')}, '') <> 'cod' AND IFNULL(x.total, 0) > 0 AND ${ST} NOT IN ('cod', 'cancelled')))`;
const REAL = `(NOT ${TEST} AND ${ST} NOT IN ('cod', 'cancelled'))`; // real money came in
const RTO = `(${J('rtoAt')} IS NOT NULL OR ${J('cancelReason')} = 'returned')`;
const STATUS = {
  paid: `(${REAL} AND ${ST} <> 'refunded')`, cod: `${ST} = 'cod'`,
  ship: `(${J('fulfilment.status')} = 'pending' AND ${ST} NOT IN ('cancelled', 'refunded'))`,
  // courier shipments (shipping.js): on the way, and failed delivery attempts (NDR)
  in_transit: `(${J('fulfilment.status')} = 'shipped' AND ${ST} NOT IN ('cancelled', 'refunded'))`, ndr: `${J('shipment.stage')} = 'ndr'`,
  // Cash on Delivery confirmation (cod.js) and returned to origin
  cod_pending: `(${ST} = 'cod' AND ${J('codStatus')} = 'pending')`, cod_confirmed: `(${ST} = 'cod' AND ${J('codStatus')} = 'confirmed')`,
  cod_unconfirmed: `(${ST} = 'cod' AND ${J('codStatus')} = 'unconfirmed')`, cod_cancelled: `${J('codStatus')} = 'cancelled'`, rto: RTO,
  refunded: `${ST} IN ('refunded', 'partially_refunded')`, plan: `IFNULL(json_type(x.data, '$.plan'), 'null') NOT IN ('null', 'false')`, test: TEST,
};
// the funnel's name as the page shows it: live funnels by id, a deleted one by the name its orders carry
const FUNNEL = `COALESCE(NULLIF(fn.fname, ''), CASE WHEN IFNULL(x.funnelId, '') = '' THEN COALESCE(NULLIF(${J('funnelName')}, ''), 'Direct') ELSE COALESCE(NULLIF(${J('funnelName')}, ''), 'Deleted funnel') || ' (deleted)' END)`;
const CAMP = `CASE WHEN IFNULL(${J('attr.utm_campaign')}, '') <> '' AND IFNULL(${J('attr.utm_content')}, '') <> '' THEN ${J('attr.utm_campaign')} || ' · ' || ${J('attr.utm_content')} ELSE IFNULL(NULLIF(${J('attr.utm_campaign')}, ''), '') || IFNULL(NULLIF(${J('attr.utm_content')}, ''), '') END`;
// the text the search box looks in: name, email, phone, funnel, order id, campaign, tags, note
const HAY = (funnel) => `lower(IFNULL(${J('name')}, '') || ' ' || IFNULL(${J('email')}, '') || ' ' || IFNULL(${J('phone')}, '') || ' ' || ${funnel} || ' ' || x.id || ' ' || ${CAMP} || ' ' || IFNULL((SELECT group_concat(value, ' ') FROM json_each(x.data, '$.tags')), '') || ' ' || IFNULL(${J('note')}, ''))`;
const FN = 'fn(fid, fname) AS (SELECT key, value FROM json_each($names))';

const cursorIn = (s) => { const i = String(s || '').indexOf(','); if (i < 1) return null; const at = Number(String(s).slice(0, i)); return Number.isFinite(at) ? { cat: at, cid: String(s).slice(i + 1) } : null; };
const cursorOut = (r) => `${r.at},${r.id}`;

// opts: { limit, cursor, q, funnel, status, days, id, tab: orders|abandoned }; names: { funnelId: name }
// → first page: { orders, abandoned, nextCursor, abandonedCursor, total, abandonedTotal, kpis, funnels }
//   with a cursor: only the list named by tab, and its next cursor
export function orderPage(userId, names, opts = {}) {
  const limit = Math.max(1, Math.min(ORDERS_MAX, Number(opts.limit) || ORDERS_MAX));
  const base = { uid: userId, names: JSON.stringify(names) };
  // the period, funnel and search — what the totals follow; the status filter only narrows the list
  const filters = (funnel) => {
    const w = [], a = {};
    if (Number(opts.days) > 0) { w.push('x.at >= $since'); a.since = Date.now() - Number(opts.days) * 864e5; }
    if (opts.funnel) { w.push(`${funnel} = $funnel`); a.funnel = String(opts.funnel); }
    const text = String(opts.q || '').trim().toLowerCase();
    if (text) { w.push(`instr(${HAY(funnel)}, $q) > 0`); a.q = text; }
    if (opts.id) { w.push('x.id = $id'); a.id = String(opts.id); }
    return [w, a];
  };
  const page = (sql, a) => {
    const cur = opts.cursor && cursorIn(opts.cursor);
    const rows = q(sql.replace('$after', cur ? 'x.at <= $cat AND (x.at < $cat OR x.id < $cid)' : '1')).all({ ...a, ...(cur || {}), limit: limit + 1 });
    const more = rows.length > limit;
    if (more) rows.pop();
    return [rows, more ? cursorOut(rows.at(-1)) : null];
  };
  const out = {};
  const tab = opts.tab === 'abandoned' ? 'abandoned' : 'orders';
  if (!opts.cursor || tab === 'orders') {
    const [w, a] = filters(FUNNEL);
    const st = STATUS[opts.status] || '1';
    const where = ['x.userId = $uid', ...w].join(' AND ');
    const [rows, next] = page(`WITH ${FN} SELECT x.id, x.at, x.data, ${FUNNEL} AS funnel FROM orders x LEFT JOIN fn ON fn.fid = x.funnelId
      WHERE ${where} AND ${st} AND $after ORDER BY x.at DESC, x.id DESC LIMIT $limit`, { ...base, ...a });
    Object.assign(out, { orders: rows.map((r) => ({ ...JSON.parse(r.data), funnel: r.funnel })), nextCursor: next });
    if (!opts.cursor) {
      const k = q(`WITH ${FN} SELECT COUNT(*) AS n, TOTAL(CASE WHEN ${st} THEN 1 END) AS shown, TOTAL(CASE WHEN ${REAL} THEN 1 END) AS paid,
        TOTAL(CASE WHEN ${REAL} THEN IFNULL(x.total, 0) * ${FX} END) AS revenue, TOTAL(CASE WHEN NOT ${TEST} THEN IFNULL(${J('refunded')}, 0) * ${FX} END) AS refunded,
        TOTAL(CASE WHEN ${ST} = 'cod' THEN IFNULL(x.total, 0) * ${FX} END) AS codDue, TOTAL(CASE WHEN ${TEST} THEN 1 END) AS tests,
        TOTAL(CASE WHEN ${RTO} THEN 1 END) AS rto, TOTAL(CASE WHEN ${STATUS.cod_unconfirmed} THEN 1 END) AS codUnconfirmed
        FROM orders x LEFT JOIN fn ON fn.fid = x.funnelId WHERE ${where}`).get({ ...base, ...a });
      const toShip = q(`SELECT COUNT(*) AS n FROM orders x WHERE x.userId = $uid AND ${STATUS.ship}`).get({ uid: userId }).n;
      const funnels = q(`WITH ${FN} SELECT DISTINCT ${FUNNEL} AS f FROM orders x LEFT JOIN fn ON fn.fid = x.funnelId WHERE x.userId = $uid`).all(base).map((r) => r.f).sort();
      // revenue: paid orders after refunds (a refund already comes off total), COD once collected, never test orders
      out.kpis = { revenue: k.revenue, paid: k.paid, aov: k.paid ? k.revenue / k.paid : 0, refunded: k.refunded, codDue: k.codDue, tests: k.tests, orders: k.n, toShip, rto: k.rto, codUnconfirmed: k.codUnconfirmed };
      Object.assign(out, { total: k.shown, funnels });
    }
  }
  if (!opts.cursor || tab === 'abandoned') {
    // checkouts nobody finished, on funnels that still exist
    const [w, a] = filters('fn.fname');
    const where = ['x.userId = $uid', 'x.recovered = 0', ...w].join(' AND ');
    const [rows, next] = page(`WITH ${FN} SELECT x.id, x.at, x.data, fn.fname AS funnel FROM abandoned x JOIN fn ON fn.fid = x.funnelId AND fn.fname <> ''
      WHERE ${where} AND $after ORDER BY x.at DESC, x.id DESC LIMIT $limit`, { ...base, ...a });
    Object.assign(out, { abandoned: rows.map((r) => ({ ...JSON.parse(r.data), funnel: r.funnel })), abandonedCursor: next });
    if (!opts.cursor) {
      out.abandonedTotal = q(`WITH ${FN} SELECT COUNT(*) AS n FROM abandoned x JOIN fn ON fn.fid = x.funnelId AND fn.fname <> '' WHERE ${where}`).get({ ...base, ...a }).n;
      if (out.kpis) out.kpis.abandoned = out.abandonedTotal;
    }
  }
  return out;
}
