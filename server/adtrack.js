// The Ads report: which ads really make money. Every lead, booked call, sale and won deal is credited to the ad
// that brought the person — by the ad they last clicked before it happened (last click) or the ad that first
// brought them in (first click) — next to what that ad cost. Lifetime value follows each person acquired in the
// period through every later purchase (upsells, renewals, repeat orders), credited to their first ad.
// Ads are recognised by the URL parameters on the ad (utm_campaign / utm_term / utm_content = campaign / ad set /
// ad name, ad_id = the Meta ad id); spend per ad comes from the seller's Meta connection (adspend.js).
import { q, T } from './db.js';
import { norm } from './adspend.js';
import { metaLink } from './composio.js';

const DAY = 86400000;
// the URL parameters to paste into every Meta ad (Ads Manager → ad → Tracking → URL parameters)
export const META_URL_PARAMS = 'utm_source=facebook&utm_medium=paid&utm_campaign={{campaign.name}}&utm_term={{adset.name}}&utm_content={{ad.name}}&ad_id={{ad.id}}';

const parse = (s) => { try { return s ? JSON.parse(s) : null; } catch { return null; } };
const tagged = (a) => !!(a && (a.utm_campaign || a.utm_content || a.ad_id || a.fbclid || a.gclid));
const sourceOf = (a) => a?.utm_source || (a?.fbclid ? 'facebook' : a?.gclid ? 'google' : a?.ref || 'direct');
// one row per ad (or per campaign when the ad isn't tagged, or per source for untagged traffic)
const adOf = (a) => {
  const src = sourceOf(a), campaign = a?.utm_campaign || '', ad = a?.utm_content || '', adId = a?.ad_id || '';
  const key = adId ? `id:${adId}` : `${norm(src)}|${norm(campaign)}|${norm(ad)}`;
  return { key, source: src, campaign, adset: a?.utm_term || '', ad, adId };
};

export function adReport(userId, { from, to = Date.now() + 1, model = 'last', funnelId = '' } = {}) {
  const fz = funnelId ? ' AND funnelId = ?' : '';
  const args = (...x) => (funnelId ? [...x, funnelId] : x);
  // everything each person did, oldest first, to find the ad that first brought them
  const events = [
    ...q(`SELECT 'lead' AS t, ckey, at, json_extract(data, '$.attr') AS attr FROM leads WHERE userId = ? AND COALESCE(demo, 0) = 0${fz}`).all(...args(userId)),
    ...q(`SELECT 'order' AS t, ckey, at, paid, net, json_extract(data, '$.attr') AS attr FROM orders WHERE userId = ? AND COALESCE(demo, 0) = 0${fz}`).all(...args(userId)),
    ...q(`SELECT 'call' AS t, ckey, at, status, json_extract(data, '$.attr') AS attr FROM bookings WHERE userId = ?${funnelId ? " AND json_extract(data, '$.funnelId') = ?" : ''}`).all(...args(userId)),
  ].filter((e) => e.ckey).sort((x, y) => x.at - y.at);
  const first = new Map(), seen = new Map();
  for (const e of events) {
    e.a = parse(e.attr);
    if (!seen.has(e.ckey)) seen.set(e.ckey, e.at);
    if (!first.has(e.ckey) && tagged(e.a)) first.set(e.ckey, e.a);
  }
  // people whose deal reached a “won” stage (CRM)
  const wonStages = new Set(T.pipelines.all({ userId }).flatMap((p) => p.stages.filter((s) => s.won).map((s) => s.id)));
  const won = new Set();
  if (wonStages.size) for (const m of q("SELECT json_extract(data, '$.key') AS k, json_extract(data, '$.stages') AS st FROM crm WHERE userId = ?").all(userId)) if (Object.values(parse(m.st) || {}).some((id) => wonStages.has(id))) won.add(m.k);

  const rows = new Map();
  const row = (a) => { const id = adOf(a); return rows.get(id.key) || rows.set(id.key, { ...id, leads: 0, calls: 0, sales: 0, revenue: 0, customers: 0, ltv: 0, won: 0, spend: 0, impressions: 0, clicks: 0, people: new Set() }).get(id.key); };
  const inRange = (t) => t >= from && t < to;
  const credit = (e) => (model === 'first' ? first.get(e.ckey) || e.a : e.a);
  for (const e of events) {
    if (!inRange(e.at)) continue;
    if (e.t === 'lead') { const r = row(credit(e)); r.leads += 1; r.people.add(e.ckey); }
    else if (e.t === 'call' && e.status !== 'cancelled') { const r = row(credit(e)); r.calls += 1; r.people.add(e.ckey); }
    else if (e.t === 'order' && e.paid) { const r = row(credit(e)); r.sales += 1; r.revenue += e.net || 0; r.people.add(e.ckey); }
  }
  // lifetime value: people first seen in the period, every paid order of theirs to date, credited to their first ad
  const ltvOf = new Map();
  for (const e of events) if (e.t === 'order' && e.paid) ltvOf.set(e.ckey, (ltvOf.get(e.ckey) || 0) + (e.net || 0));
  for (const [ck, at] of seen) {
    if (!inRange(at)) continue;
    const r = row(first.get(ck) || events.find((e) => e.ckey === ck)?.a);
    if (ltvOf.has(ck)) { r.customers += 1; r.ltv += ltvOf.get(ck); }
    if (won.has(ck)) r.won += 1;
  }

  // what each ad cost: matched by ad id, else campaign + ad name, else campaign; spend nobody matched still shows
  const spend = q("SELECT json_extract(data, '$.platform') AS p, json_extract(data, '$.campaign') AS c, json_extract(data, '$.key') AS k, json_extract(data, '$.ad') AS ad, json_extract(data, '$.adKey') AS ak, json_extract(data, '$.adId') AS id, json_extract(data, '$.adset') AS adset, SUM(json_extract(data, '$.spend')) AS s, SUM(COALESCE(json_extract(data, '$.impressions'), 0)) AS imp, SUM(COALESCE(json_extract(data, '$.clicks'), 0)) AS clk FROM adspend WHERE userId = ? AND at >= ? AND at < ? GROUP BY p, k, ak, id").all(userId, from - DAY / 2, to);
  if (!funnelId) {
    const list = [...rows.values()];
    for (const sp of spend) {
      let r = sp.id && rows.get(`id:${sp.id}`);
      if (!r && sp.ak) r = list.find((x) => !x.adId && norm(x.campaign) === sp.k && norm(x.ad) === sp.ak);
      if (!r && sp.ak) r = list.find((x) => !x.adId && !x.campaign && norm(x.ad) === sp.ak);
      if (!r && !sp.ak) r = list.find((x) => !x.adId && norm(x.campaign) === sp.k && !x.ad);
      if (!r) r = row({ utm_source: sp.p === 'meta' ? 'facebook' : sp.p, utm_campaign: sp.c, utm_content: sp.ad || '', utm_term: sp.adset || '', ad_id: sp.id || '' });
      r.spend += sp.s || 0; r.impressions += sp.imp || 0; r.clicks += sp.clk || 0;
      if (!r.adset && sp.adset) r.adset = sp.adset;
      if (!r.adId && sp.id) r.adId = sp.id;
    }
  }
  const r2 = (n) => Math.round(n * 100) / 100;
  const out = [...rows.values()].map(({ people, ...r }) => ({
    ...r, spend: Math.round(r.spend), revenue: Math.round(r.revenue), ltv: Math.round(r.ltv), people: people.size,
    cpl: r.leads && r.spend ? Math.round(r.spend / r.leads) : null, cpa: r.sales && r.spend ? Math.round(r.spend / r.sales) : null,
    roas: r.spend ? r2(r.revenue / r.spend) : null, ltvRoas: r.spend ? r2(r.ltv / r.spend) : null,
    profit: Math.round(r.ltv - r.spend),
  })).filter((r) => r.leads || r.calls || r.sales || r.spend || r.customers)
    .sort((x, y) => y.spend - x.spend || y.revenue - x.revenue || y.leads - x.leads).slice(0, 300);
  const sum = (k) => out.reduce((n, r) => n + (r[k] || 0), 0);
  const totals = { spend: sum('spend'), leads: sum('leads'), calls: sum('calls'), sales: sum('sales'), revenue: sum('revenue'), ltv: sum('ltv'), customers: sum('customers'), won: sum('won') };
  totals.roas = totals.spend ? r2(totals.revenue / totals.spend) : null;
  totals.ltvRoas = totals.spend ? r2(totals.ltv / totals.spend) : null;
  const paid = out.filter((r) => r.source !== 'direct');
  return {
    model, rows: out, totals,
    setup: {
      meta: !!metaLink(T.users.get(userId)), adSpend: spend.some((s) => s.ak || s.id), anySpend: spend.length > 0,
      taggedAds: paid.filter((r) => r.ad || r.adId).length, untaggedSpend: out.filter((r) => r.spend && !r.leads && !r.sales && !r.calls).length,
      urlParams: META_URL_PARAMS,
    },
  };
}

export function registerAds(app, { auth }) {
  app.get('/api/ads/report', auth, (req, res) => {
    const days = req.query.days === 'all' ? 3650 : Math.min(3650, Math.max(1, Number(req.query.days) || 30));
    const funnelId = typeof req.query.funnelId === 'string' && T.funnels.get(req.query.funnelId)?.userId === req.user.id ? req.query.funnelId : '';
    res.json({ days, ...adReport(req.user.id, { from: Date.now() - days * DAY, model: req.query.model === 'first' ? 'first' : 'last', funnelId }) });
  });
}
