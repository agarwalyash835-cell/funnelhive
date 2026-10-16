// Revenue reports: gross, refunds, net, buyers, cohorts, lifetime value, per funnel / product / source, recurring revenue.
// Money is real money only, the same as the Dashboard (analytics.js): paid = 1 leaves out test orders, unpaid COD
// and cancelled orders; net is the order's rupee value after refunds (fx applied); gross = net + what was refunded.
// A buyer is a contact (the order's email); an order without an email is a buyer of its own.
// One read of the seller's paid orders over the (userId, at) index; only the orders a report needs are parsed
// (the period, the one before it, the cohort months and plans), the rest give their columns only. Cached for a minute.
import { T, q } from './db.js';
import { DAY } from './time.js';
import { sellerTz, offsetAt, zoned, addDays, localYmd } from './tz.js';
import { spendBy, norm } from './adspend.js';

const ADDONS = ['bump', 'upsell', 'downsell', 'crosssell'];
const LIVE_PLAN = ['active', 'authenticated', 'pending'];
const MONTHS = 12; // cohort columns: months 0..11 since the first purchase
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : 0);
const YMD = /^\d{4}-\d{2}-\d{2}$/;

// ?days=30|90|365|all or ?from=YYYY-MM-DD&to=YYYY-MM-DD (both days included), in the seller's time zone
export function reportPeriod(query, tz, now = Date.now()) {
  const end = zoned(tz, addDays(localYmd(tz, now), 1));
  if (YMD.test(query.from) && YMD.test(query.to) && query.from <= query.to) return { key: `${query.from}..${query.to}`, from: zoned(tz, query.from), to: zoned(tz, addDays(query.to, 1)) };
  if (query.days === 'all') return { key: 'all', from: 0, to: end };
  const days = [30, 90, 365].includes(Number(query.days)) ? Number(query.days) : 30;
  return { key: String(days), days, from: end - days * DAY, to: end };
}

// totals of a group of orders
const acc = () => ({ orders: 0, net: 0, refunds: 0, keys: new Set() });
const addTo = (g, k, net, refunds) => { g.orders++; g.net += net; g.refunds += refunds; g.keys.add(k); };
const money = (g) => ({ orders: g.orders, buyers: g.keys.size, gross: r2(g.net + g.refunds), refunds: r2(g.refunds), refundRate: pct(g.refunds, g.net + g.refunds), net: r2(g.net), aov: g.orders ? r2(g.net / g.orders) : 0 });

export function buildReport(user, { from, to, key, days }, funnelId = '') {
  const uid = user.id, off = offsetAt(sellerTz(user)) * 60000, now = Date.now();
  const month = (t) => { const d = new Date(t + off); return d.getUTCFullYear() * 12 + d.getUTCMonth(); };
  const startOf = (m) => Date.UTC(Math.floor(m / 12), m % 12, 1) - off;
  const funnels = T.funnels.all({ userId: uid });
  const fname = Object.fromEntries(funnels.map((f) => [f.id, f.name]));
  const inFunnel = (f) => !funnelId || f === funnelId;
  const prevFrom = from > 0 ? from - (to - from) : 0;
  // cohorts: the last 12 months, or the whole period when it's longer — at most 24
  const nowM = month(now), endM = Math.min(nowM, month(to - 1));
  const cohortFrom = from > 0 ? startOf(Math.max(Math.min(month(from), endM - (MONTHS - 1)), endM - 23)) : 0;
  const parseFrom = Math.min(prevFrom, cohortFrom);

  const rows = q(`SELECT id, COALESCE(NULLIF(ckey, ''), 'order:' || id) AS k, at, funnelId AS f, net, CASE WHEN at >= ? OR instr(data, '"plan":') THEN data END AS data
    FROM orders WHERE userId = ? AND paid = 1 ORDER BY at`).all(parseFrom, uid);

  const buyers = new Map(); // every buyer: first purchase (and its funnel), lifetime value to date, orders
  const total = acc(), prev = acc(), newB = { keys: new Set(), net: 0 };
  const kinds = {}, byFunnel = {}, products = {}, sources = {}, dayNet = new Map(), campFunnels = new Map();
  const rec = { members: 0, mrr: 0, pastDue: 0, ending: 0, plans: 0, instalmentsDue: 0, instalmentsLeft: 0 };
  const pays = []; // [buyer, at, amount] for the cohorts
  for (const r of rows) {
    let b = buyers.get(r.k);
    if (!b) buyers.set(r.k, (b = { k: r.k, first: r.at, f: r.f, ltv: 0, n: 0 }));
    b.ltv += r.net; b.n++;
    if (!r.data) continue;
    const o = JSON.parse(r.data), fx = Number(o.fx) || 1, refunds = (Number(o.refunded) || 0) * fx;
    if (!b.fn && b.first === r.at) b.fn = o.funnelName;
    b.who = { name: o.name || '', email: o.email || '', phone: o.phone || '' }; // the latest order's details
    // recurring revenue now (not limited to the period): active memberships and instalments still to collect
    const pl = o.plan;
    if (pl && LIVE_PLAN.includes(pl.status) && inFunnel(r.f)) {
      const amt = (Number(pl.amount) || 0) * fx;
      if (pl.type === 'recurring') {
        if (pl.status === 'pending') rec.pastDue++; // a failed renewal being retried: not counted until it's paid
        else { rec.members++; rec.mrr += pl.interval === 'yearly' ? amt / 12 : amt; if (pl.cancelAtEnd) rec.ending++; }
      } else if (pl.type === 'installments') {
        const left = Math.max(0, (Number(pl.count) || 0) - (Number(pl.paid) || 1));
        if (left) { rec.plans++; rec.instalmentsLeft += left; rec.instalmentsDue += left * amt; }
      }
    }
    if (r.at >= cohortFrom) {
      // a plan's renewals / instalments count on the day each was paid, the rest of the order on its date
      const rn = pl ? o.items.filter((i) => i.kind === 'renewal' && !i.refunded) : [];
      let rest = r.net;
      for (const i of rn) { const v = (Number(i.price) || 0) * fx; rest -= v; pays.push([r.k, i.at || r.at, v]); }
      pays.push([r.k, r.at, rest]);
    }
    if (!inFunnel(r.f) || r.at >= to) continue;
    if (r.at >= prevFrom && r.at < from) { addTo(prev, r.k, r.net, refunds); continue; }
    if (r.at < from) continue;
    // ---------- in the period ----------
    addTo(total, r.k, r.net, refunds);
    if (b.first >= from) { newB.keys.add(r.k); newB.net += r.net; } // first ever purchase in the period: a new buyer
    addTo((byFunnel[r.f || ''] ||= { ...acc(), fn: o.funnelName }), r.k, r.net, refunds);
    const main = o.items?.find((i) => i.kind === 'main') || o.items?.[0];
    addTo((products[main?.name || 'Other'] ||= acc()), r.k, r.net, refunds);
    addTo((sources[o.attr?.utm_source || o.source || 'direct'] ||= acc()), r.k, r.net, refunds);
    // what each kind of item brought in (refunded items left out; part-refunds not tied to an item come off the main product)
    for (const i of o.items || []) if (!i.refunded) kinds[i.kind || 'main'] = (kinds[i.kind || 'main'] || 0) + (Number(i.price) || 0) * fx;
    if (o.refundedUnassigned) kinds.main = (kinds.main || 0) - o.refundedUnassigned * fx;
    const d = Math.floor((r.at + off) / DAY), s = dayNet.get(d) || { net: 0, refunds: 0, orders: 0 };
    s.net += r.net; s.refunds += refunds; s.orders++; dayNet.set(d, s);
    const c = norm(o.attr?.utm_campaign);
    if (c) { if (!campFunnels.has(c)) campFunnels.set(c, new Set()); campFunnels.get(c).add(r.f); }
  }
  rec.mrr = r2(rec.mrr); rec.arr = r2(rec.mrr * 12); rec.instalmentsDue = r2(rec.instalmentsDue);
  for (const k of Object.keys(kinds)) kinds[k] = r2(kinds[k]);
  const itemTotal = Object.values(kinds).reduce((s, v) => s + v, 0), addOn = ADDONS.reduce((s, k) => s + (kinds[k] || 0), 0);

  // ---------- ad spend, matched to a funnel by UTM campaign (a campaign seen on several funnels, or none, stays account-wide) ----------
  const sp = spendBy(uid, from, to);
  if (Object.keys(sp).length) for (const r of q("SELECT DISTINCT funnelId AS f, json_extract(data, '$.attr.utm_campaign') AS c FROM leads WHERE userId = ? AND at >= ? AND at < ? AND instr(data, 'utm_campaign')").all(uid, from, to)) {
    const c = norm(r.c);
    if (c) { if (!campFunnels.has(c)) campFunnels.set(c, new Set()); campFunnels.get(c).add(r.f); }
  }
  const spendOf = {}; let spendTotal = 0, unmapped = 0;
  for (const [k, s] of Object.entries(sp)) {
    spendTotal += s.spend;
    const fs = campFunnels.get(k);
    if (fs?.size === 1) { const [f] = fs; spendOf[f] = (spendOf[f] || 0) + s.spend; } else unmapped += s.spend;
  }
  const spend = funnelId ? spendOf[funnelId] || 0 : spendTotal;

  // ---------- lifetime value of the buyers acquired in the period (first purchase in it) ----------
  const nameOf = (id, fn) => fname[id] || (fn ? `${fn} (deleted)` : id ? 'Deleted funnel' : 'No funnel');
  const acquired = [...buyers.values()].filter((b) => b.first >= from && b.first < to && inFunnel(b.f));
  const ltvBy = {};
  for (const b of acquired) { const g = (ltvBy[b.f || ''] ||= { buyers: 0, total: 0, orders: 0, name: nameOf(b.f, b.fn) }); g.buyers++; g.total += b.ltv; g.orders += b.n; }
  const acqTotal = acquired.reduce((s, b) => s + b.ltv, 0), acqOrders = acquired.reduce((s, b) => s + b.n, 0);
  const top = [...acquired].sort((a, b) => b.ltv - a.ltv).slice(0, 10).map((b) => ({ key: b.k.startsWith('order:') ? null : b.k, ...(b.who || { name: '', email: '', phone: '' }), total: r2(b.ltv), orders: b.n, first: b.first }));

  // ---------- revenue over time: by day up to 120 days, by month beyond ----------
  const series = [];
  const dKeys = [...dayNet.keys()];
  const d0 = from > 0 ? Math.floor((from + off) / DAY) : dKeys.length ? Math.min(...dKeys) : null, d1 = Math.floor((to - 1 + off) / DAY);
  if (d0 != null) {
    const monthly = d1 - d0 > 120, idx = new Map(), bucket = (d) => { const date = new Date(d * DAY).toISOString().slice(0, 10); return monthly ? `${date.slice(0, 7)}-01` : date; };
    for (let d = d0; d <= d1; d++) { const b = bucket(d); if (!idx.has(b)) { idx.set(b, series.length); series.push({ date: b, net: 0, refunds: 0, orders: 0 }); } }
    for (const [d, v] of dayNet) { const s = series[idx.get(bucket(d))]; if (s) { s.net += v.net; s.refunds += v.refunds; s.orders += v.orders; } }
    for (const s of series) { s.net = r2(s.net); s.refunds = r2(s.refunds); }
  }

  const t = money(total), table = (m) => Object.entries(m).map(([name, g]) => ({ name, ...money(g) })).sort((a, b) => b.net - a.net).slice(0, 100);
  return {
    period: { key, days: days || null, from, to },
    funnel: funnelId || null,
    funnels: funnels.map((f) => ({ id: f.id, name: f.name })),
    overview: {
      ...t, perBuyer: t.buyers ? r2(t.net / t.buyers) : 0,
      newBuyers: newB.keys.size, returningBuyers: t.buyers - newB.keys.size, newShare: pct(newB.keys.size, t.buyers), newRevenue: r2(newB.net), returningRevenue: r2(t.net - newB.net),
      kinds, addOnRevenue: r2(addOn), addOnShare: pct(addOn, itemTotal),
      spend: r2(spend), roas: spend ? r2(t.net / spend) : null,
      prev: from > 0 ? money(prev) : null,
    },
    recurring: rec,
    series,
    cohorts: cohorts(buyers, pays, { cohortFrom, endM, nowM, month, funnelId }),
    ltv: { buyers: acquired.length, avg: acquired.length ? r2(acqTotal / acquired.length) : 0, avgOrders: acquired.length ? r2(acqOrders / acquired.length) : 0, total: r2(acqTotal), byFunnel: Object.entries(ltvBy).map(([id, g]) => ({ id: id || null, name: g.name, buyers: g.buyers, avg: r2(g.total / g.buyers), avgOrders: r2(g.orders / g.buyers) })).sort((a, b) => b.avg - a.avg), top },
    byFunnel: Object.entries(byFunnel).map(([id, g]) => {
      const a = ltvBy[id], s = spendOf[id] || 0, m = money(g);
      return { id: id || null, name: nameOf(id, g.fn), deleted: !fname[id], ...m, acquired: a?.buyers || 0, ltv: a ? r2(a.total / a.buyers) : 0, spend: s ? r2(s) : null, roas: s ? r2(m.net / s) : null };
    }).sort((a, b) => b.net - a.net),
    products: table(products), sources: table(sources),
    spend: { total: r2(spendTotal), unmapped: r2(unmapped) },
  };
}

// Monthly cohorts: buyers grouped by the month of their first purchase (with a funnel chosen: first bought there).
// Cell k = k months after that month: revenue per buyer so far (all funnels, after refunds; renewals and instalments on
// the month they were paid) and the share of the cohort who had paid again by then. Months still to come are null.
function cohorts(buyers, pays, { cohortFrom, endM, nowM, month, funnelId }) {
  const rows = new Map(), cohortOf = new Map();
  for (const b of buyers.values()) {
    const m = month(b.first);
    if (b.first < cohortFrom || m > endM || (funnelId && b.f !== funnelId)) continue;
    cohortOf.set(b.k, m);
    if (!rows.has(m)) rows.set(m, { size: 0, rev: Array(MONTHS).fill(0), again: Array(MONTHS).fill(0) });
    rows.get(m).size++;
  }
  const count = new Map(); // payments seen per buyer, in time order
  pays.sort((a, b) => a[1] - b[1]);
  for (const [k, t, amt] of pays) {
    const m0 = cohortOf.get(k);
    if (m0 == null) continue;
    const row = rows.get(m0), j = Math.max(0, month(t) - m0), n = (count.get(k) || 0) + 1;
    count.set(k, n);
    if (j >= MONTHS) continue;
    row.rev[j] += amt;
    if (n === 2) row.again[j]++; // the second payment: a repeat buyer from that month on
  }
  return {
    months: MONTHS,
    rows: [...rows.entries()].sort((a, b) => b[0] - a[0]).slice(0, 24).map(([m, r]) => {
      let rev = 0, again = 0;
      return {
        month: `${Math.floor(m / 12)}-${String((m % 12) + 1).padStart(2, '0')}`, buyers: r.size,
        cells: r.rev.map((v, j) => { rev += v; again += r.again[j]; return m + j > nowM ? null : { ltv: r2(rev / r.size), repeat: pct(again, r.size) }; }),
      };
    }),
  };
}

// one minute per (account, period, funnel); a small LRU so a busy server doesn't hold every report
const cache = new Map();
const TTL = 60000, MAX = 300;
export function cachedReport(user, query) {
  const period = reportPeriod(query, sellerTz(user));
  const funnelId = typeof query.funnel === 'string' ? query.funnel.slice(0, 64) : '';
  const k = `${user.id}|${period.key}|${funnelId}`, hit = cache.get(k);
  if (hit && Date.now() - hit.at < TTL) return hit.data;
  const data = buildReport(user, period, funnelId);
  cache.delete(k); cache.set(k, { at: Date.now(), data });
  while (cache.size > MAX) cache.delete(cache.keys().next().value);
  return data;
}

const SECTIONS = { overview: ['period', 'funnel', 'overview', 'recurring', 'series'], cohorts: ['period', 'funnel', 'cohorts'], ltv: ['period', 'funnel', 'ltv'], funnels: ['period', 'funnel', 'byFunnel', 'spend'], products: ['period', 'funnel', 'products'], sources: ['period', 'funnel', 'sources'] };
export function registerReports(app, { auth }) {
  // the whole report (what the Reports page loads), or one part of it
  app.get('/api/reports', auth, (req, res) => res.json(cachedReport(req.user, req.query)));
  app.get('/api/reports/:section', auth, (req, res) => {
    const keys = SECTIONS[req.params.section];
    if (!keys) return res.status(404).json({ error: 'No such report' });
    const r = cachedReport(req.user, req.query);
    res.json(Object.fromEntries(keys.map((x) => [x, r[x]])));
  });
}
