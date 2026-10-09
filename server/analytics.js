// Reporting queries. Everything is aggregated inside SQLite using the (userId, at) / (funnelId, at)
// indexes, so a seller's dashboard costs the same whether the platform has 10 or 10,000 sellers.
import { q } from './db.js';
import { DAY, localDate } from './time.js';

// scope: { userId } (whole account) or { funnelId } (one funnel)
const by = (scope) => (scope.funnelId ? ['funnelId', scope.funnelId] : ['userId', scope.userId]);

export function totals(scope, from, to) {
  const [col, id] = by(scope);
  const v = q(`SELECT COUNT(*) AS views, COUNT(DISTINCT COALESCE(visitor, at)) AS visitors FROM events WHERE ${col} = ? AND at >= ? AND at < ? AND type = 'view'`).get(id, from, to);
  const leads = q(`SELECT COUNT(*) AS n FROM leads WHERE ${col} = ? AND at >= ? AND at < ?`).get(id, from, to).n;
  const o = q(`SELECT COUNT(*) AS n, COALESCE(SUM(inr), 0) AS revenue FROM orders WHERE ${col} = ? AND at >= ? AND at < ?`).get(id, from, to);
  return shape(v.views, v.visitors, leads, o.n, o.revenue);
}
function shape(views, visitors, leads, orders, revenue) {
  return { views, visitors, leads, orders, revenue, aov: orders ? Math.round(revenue / orders) : 0, conversion: visitors ? +((orders / visitors) * 100).toFixed(2) : 0, epv: visitors ? +(revenue / visitors).toFixed(2) : 0 };
}

// The same numbers for every funnel of a seller, in three grouped queries
export function totalsByFunnel(userId, from, to) {
  const m = {};
  const get = (fid) => (m[fid] ||= { views: 0, visitors: 0, leads: 0, orders: 0, revenue: 0 });
  for (const r of q(`SELECT funnelId, COUNT(*) AS views, COUNT(DISTINCT COALESCE(visitor, at)) AS visitors FROM events WHERE userId = ? AND at >= ? AND at < ? AND type = 'view' GROUP BY funnelId`).all(userId, from, to)) Object.assign(get(r.funnelId), { views: r.views, visitors: r.visitors });
  for (const r of q('SELECT funnelId, COUNT(*) AS n FROM leads WHERE userId = ? AND at >= ? AND at < ? GROUP BY funnelId').all(userId, from, to)) get(r.funnelId).leads = r.n;
  for (const r of q('SELECT funnelId, COUNT(*) AS n, COALESCE(SUM(inr), 0) AS revenue FROM orders WHERE userId = ? AND at >= ? AND at < ? GROUP BY funnelId').all(userId, from, to)) Object.assign(get(r.funnelId), { orders: r.n, revenue: r.revenue });
  return (fid) => { const x = m[fid] || get(fid); return shape(x.views, x.visitors, x.leads, x.orders, x.revenue); };
}

export function series(scope, from, days, off) {
  const [col, id] = by(scope);
  const to = from + days * DAY;
  const out = Array.from({ length: days }, (_, i) => ({ date: localDate(from + i * DAY, off), views: 0, leads: 0, orders: 0, revenue: 0 }));
  const day = 'CAST((at - ?) / 86400000 AS INTEGER)';
  for (const r of q(`SELECT ${day} AS d, COUNT(*) AS n FROM events WHERE ${col} = ? AND at >= ? AND at < ? AND type = 'view' GROUP BY d`).all(from, id, from, to)) if (out[r.d]) out[r.d].views = r.n;
  for (const r of q(`SELECT ${day} AS d, COUNT(*) AS n FROM leads WHERE ${col} = ? AND at >= ? AND at < ? GROUP BY d`).all(from, id, from, to)) if (out[r.d]) out[r.d].leads = r.n;
  for (const r of q(`SELECT ${day} AS d, COUNT(*) AS n, COALESCE(SUM(inr), 0) AS revenue FROM orders WHERE ${col} = ? AND at >= ? AND at < ? GROUP BY d`).all(from, id, from, to)) if (out[r.d]) Object.assign(out[r.d], { orders: r.n, revenue: r.revenue });
  return out;
}

export function sources(scope, from) {
  const [col, id] = by(scope);
  const m = {};
  const get = (s) => (m[s || 'direct'] ||= { source: s || 'direct', views: 0, leads: 0, orders: 0, revenue: 0 });
  for (const r of q(`SELECT source, COUNT(*) AS n FROM events WHERE ${col} = ? AND at >= ? AND type = 'view' GROUP BY source`).all(id, from)) get(r.source).views += r.n;
  for (const r of q(`SELECT source, COUNT(*) AS n FROM leads WHERE ${col} = ? AND at >= ? GROUP BY source`).all(id, from)) get(r.source).leads += r.n;
  for (const r of q(`SELECT source, COUNT(*) AS n, COALESCE(SUM(inr), 0) AS revenue FROM orders WHERE ${col} = ? AND at >= ? GROUP BY source`).all(id, from)) { const g = get(r.source); g.orders += r.n; g.revenue += r.revenue; }
  return Object.values(m).sort((a, b) => b.revenue - a.revenue || b.views - a.views);
}

export function revenueByKind(scope, from) {
  const [col, id] = by(scope);
  const m = { main: 0, bump: 0, upsell: 0, downsell: 0, crosssell: 0 };
  const rows = q(`SELECT COALESCE(json_extract(i.value, '$.kind'), 'main') AS kind, SUM(json_extract(i.value, '$.price') * COALESCE(json_extract(o.data, '$.fx'), 1)) AS amount
    FROM orders o, json_each(o.data, '$.items') i WHERE o.${col} = ? AND o.at >= ? AND json_extract(i.value, '$.refunded') IS NULL GROUP BY kind`).all(id, from);
  for (const r of rows) m[r.kind] = (m[r.kind] || 0) + (r.amount || 0);
  // part-payment refunds (not tied to one item) come off the main product
  m.main -= q(`SELECT COALESCE(SUM(json_extract(data, '$.refundedUnassigned') * COALESCE(json_extract(data, '$.fx'), 1)), 0) AS n FROM orders WHERE ${col} = ? AND at >= ?`).get(id, from).n;
  return m;
}

// views / conversions per step (and A/B variant) of one funnel
export function stepCounts(funnelId, from) {
  const m = {};
  for (const r of q(`SELECT stepId, type, COALESCE(variant, 'A') AS variant, COUNT(*) AS n FROM events WHERE funnelId = ? AND type IN ('view', 'convert') AND at >= ? GROUP BY stepId, type, variant`).all(funnelId, from)) {
    m[`${r.stepId}|${r.type}|${r.variant}`] = r.n;
  }
  return (stepId, type, variant) => (variant ? m[`${stepId}|${type}|${variant}`] || 0 : (m[`${stepId}|${type}|A`] || 0) + (m[`${stepId}|${type}|B`] || 0));
}

export function bumpRate(funnelId, from) {
  const r = q(`SELECT COUNT(*) AS n, COALESCE(SUM(EXISTS (SELECT 1 FROM json_each(data, '$.items') WHERE json_extract(value, '$.kind') = 'bump')), 0) AS b FROM orders WHERE funnelId = ? AND at >= ?`).get(funnelId, from);
  return r.n ? Math.round((r.b / r.n) * 100) : 0;
}

// Leads, orders and revenue by ad campaign (UTM tags captured on the visit that converted).
// Without UTM tags a row falls back to the traffic source, so organic and direct sales still show up.
export function campaigns(scope, from, to = Date.now() + 1) {
  const [col, id] = by(scope);
  const key = (r) => [r.src || 'direct', r.med || '', r.camp || '', r.ad || ''].join('|');
  const m = {};
  const get = (r) => (m[key(r)] ||= { source: r.src || 'direct', medium: r.med || '', campaign: r.camp || '', content: r.ad || '', leads: 0, orders: 0, revenue: 0, refunded: 0 });
  const fields = `COALESCE(json_extract(data, '$.attr.utm_source'), source) AS src, json_extract(data, '$.attr.utm_medium') AS med, json_extract(data, '$.attr.utm_campaign') AS camp, json_extract(data, '$.attr.utm_content') AS ad`;
  for (const r of q(`SELECT ${fields}, COUNT(*) AS n FROM leads WHERE ${col} = ? AND at >= ? AND at < ? GROUP BY src, med, camp, ad`).all(id, from, to)) get(r).leads += r.n;
  for (const r of q(`SELECT ${fields}, COUNT(*) AS n, COALESCE(SUM(inr), 0) AS revenue, COALESCE(SUM(json_extract(data, '$.refunded') * COALESCE(json_extract(data, '$.fx'), 1)), 0) AS refunded FROM orders WHERE ${col} = ? AND at >= ? AND at < ? GROUP BY src, med, camp, ad`).all(id, from, to)) { const g = get(r); g.orders += r.n; g.revenue += r.revenue; g.refunded += r.refunded; }
  return Object.values(m).sort((a, b) => b.revenue - a.revenue || b.orders - a.orders || b.leads - a.leads).slice(0, 200);
}
export function refundsTotal(scope, from, to) {
  const [col, id] = by(scope);
  return q(`SELECT COALESCE(SUM(json_extract(data, '$.refunded') * COALESCE(json_extract(data, '$.fx'), 1)), 0) AS n FROM orders WHERE ${col} = ? AND at >= ? AND at < ?`).get(id, from, to).n;
}
