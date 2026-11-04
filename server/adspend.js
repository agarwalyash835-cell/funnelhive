// Ad spend for true ROAS: what each campaign cost, next to the leads and sales it brought (matched by UTM campaign).
//   - Meta: a Marketing API token + ad account id; spend per campaign per day is pulled daily (last 30 days)
//     — or, with no token, through the seller's Meta connection in Settings → Apps & ads (Composio)
//   - Google Ads (or any network): a CSV export (date, campaign, cost) uploaded from the dashboard
// Meta comes in per ad and per day with what an agency reports on: reach, impressions, link clicks, landing page
// views, Meta's own results (leads, purchases and their value, chats) in the seller's attribution window, video hook
// and hold (3-second plays, ThruPlays) — and each ad's thumbnail, so the Ads report shows the creative.
// Campaign names are matched loosely (case / spaces / dashes ignored) to utm_campaign, so "Diwali Sale" in
// Ads Manager meets ?utm_campaign=diwali-sale.
import { T, q, tx, uid, JOBS } from './db.js';
import { encrypt, decrypt, setChannel } from './messaging.js';
import { composioReady, runAs, proxyAs, USE_META_CONNECTION } from './composio.js';

const GRAPH = () => (process.env.META_GRAPH_URL || 'https://graph.facebook.com').replace(/\/$/, '');
const VER = 'v21.0';
const DAY = 86400000;
export const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
const ymd = (t) => new Date(t + 330 * 60000).toISOString().slice(0, 10);
// the numbers kept per ad per day, besides spend
export const METRICS = ['impressions', 'reach', 'clicks', 'linkClicks', 'lpv', 'metaLeads', 'metaPurchases', 'metaValue', 'chats', 'video3s', 'thruplay'];
// the attribution window Meta counts its results in (the seller's pick; Meta's default is 7-day click + 1-day view).
// No 28-day click: Meta retired it and Composio's insights action refuses it (an old pick falls back to the default)
export const WINDOWS = { '7d_click_1d_view': ['7d_click', '1d_view'], '7d_click': ['7d_click'], '1d_click': ['1d_click'] };
export const windowOf = (u) => (WINDOWS[u?.settings?.adWindow] ? u.settings.adWindow : '7d_click_1d_view');
const INSIGHT_FIELDS = ['campaign_name', 'adset_name', 'ad_name', 'ad_id', 'spend', 'impressions', 'reach', 'clicks', 'inline_link_clicks', 'actions', 'action_values', 'video_thruplay_watched_actions', 'account_currency', 'date_start'];
// Meta's action list → one number: the first type present (they overlap — omni_purchase already includes purchase)
const act = (list, types) => { for (const t of types) { const a = (list || []).find((x) => x.action_type === t); if (a) return Number(a.value) || 0; } return 0; };
const LEAD = ['lead', 'onsite_conversion.lead_grouped', 'offsite_conversion.fb_pixel_lead'], BUY = ['omni_purchase', 'purchase', 'offsite_conversion.fb_pixel_purchase'];
export function insightRow(x) {
  return {
    date: x.date_start, campaign: x.campaign_name, spend: Number(x.spend) || 0, currency: x.account_currency || 'INR',
    ad: x.ad_name || '', adId: x.ad_id || '', adset: x.adset_name || '',
    impressions: Number(x.impressions) || 0, reach: Number(x.reach) || 0, clicks: Number(x.clicks) || 0, linkClicks: Number(x.inline_link_clicks) || act(x.actions, ['link_click']),
    lpv: act(x.actions, ['landing_page_view', 'omni_landing_page_view']), metaLeads: act(x.actions, LEAD), metaPurchases: act(x.actions, BUY), metaValue: act(x.action_values, BUY),
    chats: act(x.actions, ['onsite_conversion.messaging_conversation_started_7d']), video3s: act(x.actions, ['video_view']), thruplay: act(x.video_thruplay_watched_actions, ['video_view']),
  };
}

// replace a platform's spend for the given days (re-syncs and re-uploads never double count)
function store(userId, platform, rows) {
  const days = [...new Set(rows.map((r) => r.date))];
  tx(() => {
    for (const d of days) q("DELETE FROM adspend WHERE userId = ? AND json_extract(data, '$.platform') = ? AND json_extract(data, '$.date') = ?").run(userId, platform, d);
    for (const r of rows) T.adspend.insert({ id: uid(), userId, platform, date: r.date, campaign: String(r.campaign).slice(0, 200), key: norm(r.campaign), spend: Math.round(Number(r.spend) * 100) / 100, currency: r.currency || 'INR', at: Date.parse(`${r.date}T00:00:00+05:30`), ...(r.ad ? { ad: String(r.ad).slice(0, 200), adKey: norm(r.ad), adId: String(r.adId || ''), adset: String(r.adset || '').slice(0, 200), ...Object.fromEntries(METRICS.map((k) => [k, Number(r[k]) || 0])) } : {}) });
  });
  return rows.length;
}

// ---------- Meta ----------
async function graph(path, token) {
  const r = await fetch(`${GRAPH()}/${VER}/${path}${path.includes('?') ? '&' : '?'}access_token=${encodeURIComponent(token)}`, { signal: AbortSignal.timeout(20000) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error?.message || `Meta ${r.status}`);
  return d;
}
// spend through the seller's Meta connection (Settings → Apps & ads), when there's no Marketing API token
async function syncMetaApp(u, days) {
  const m = u.channels.metaApp, rows = [];
  // per ad, so the Ads report can show spend, cost per lead and ROAS for every ad (campaign totals still add up)
  const args = { object_id: `act_${m.account}`, level: 'ad', fields: INSIGHT_FIELDS, action_attribution_windows: WINDOWS[windowOf(u)], time_increment: 1, limit: 500, time_range: { since: ymd(Date.now() - (days - 1) * DAY), until: ymd(Date.now()) } };
  try {
    for (let i = 0, after; i < 20; i++) {
      let d;
      try { d = await runAs(u.id, 'METAADS_GET_INSIGHTS', after ? { ...args, after } : args); } catch (e) {
        // a version of the action without the window option: Meta's default window then
        if (i || !args.action_attribution_windows) throw e;
        delete args.action_attribution_windows; i--; continue;
      }
      for (const x of d.data || []) rows.push(insightRow(x));
      after = d.paging?.next && d.paging?.cursors?.after;
      if (!after) break;
    }
  } catch (e) { T.users.update(u.id, (x) => { if (x.channels?.metaApp) x.channels.metaApp.error = e.message; }); throw e; }
  const n = store(u.id, 'meta', rows.filter((r) => r.date && r.campaign));
  await saveThumbs(u.id, rows, (ids) => proxyAs(u.id, 'metaads', `/${VER}/?ids=${ids.join(',')}&fields=creative{thumbnail_url,title,body}`)).catch((e) => console.error('ad thumbnails (apps)', e.message));
  T.users.update(u.id, (x) => { if (x.channels?.metaApp) x.channels.metaApp = { ...x.channels.metaApp, syncedAt: Date.now(), error: '' }; });
  return n;
}
const appSpend = (u) => !u.channels?.metaAds?.tokenEnc && composioReady() && u.channels?.metaApp?.account;
export async function syncMeta(u, days = 30) {
  if (appSpend(u)) return syncMetaApp(u, days);
  const m = u.channels?.metaAds;
  if (!m?.tokenEnc || !m.account) return 0;
  const token = decrypt(m.tokenEnc), until = ymd(Date.now()), since = ymd(Date.now() - (days - 1) * DAY);
  const rows = [];
  let path = `act_${m.account}/insights?level=ad&time_increment=1&fields=${INSIGHT_FIELDS.join(',')}&action_attribution_windows=${encodeURIComponent(JSON.stringify(WINDOWS[windowOf(u)]))}&limit=500&time_range=${encodeURIComponent(JSON.stringify({ since, until }))}`;
  for (let i = 0; path && i < 20; i++) {
    const d = await graph(path, token);
    for (const x of d.data || []) rows.push(insightRow(x));
    path = d.paging?.next ? d.paging.next.replace(/^https?:\/\/[^/]+\/v[\d.]+\//, '').replace(/[?&]access_token=[^&]+/, '') : null;
  }
  const n = store(u.id, 'meta', rows);
  await saveThumbs(u.id, rows, (ids) => graph(`?ids=${ids.join(',')}&fields=creative{thumbnail_url,title,body}`, token)).catch((e) => console.error('ad thumbnails', e.message));
  T.users.update(u.id, (x) => { x.channels.metaAds = { ...x.channels.metaAds, syncedAt: Date.now(), error: '' }; });
  return n;
}

// each ad's creative (thumbnail, headline, text), fetched 50 ads at a time and kept in adcreatives (one row per ad,
// refreshed weekly — Meta's thumbnail links expire)
async function saveThumbs(userId, rows, fetchIds) {
  const ids = [...new Set(rows.map((r) => r.adId).filter((id) => /^\d+$/.test(id)))];
  const fresh = new Set(q("SELECT json_extract(data, '$.adId') AS id FROM adcreatives WHERE userId = ? AND json_extract(data, '$.at') > ?").all(userId, Date.now() - 7 * DAY).map((x) => x.id));
  const need = ids.filter((id) => !fresh.has(id)).slice(0, 500);
  for (let i = 0; i < need.length; i += 50) {
    const d = await fetchIds(need.slice(i, i + 50));
    tx(() => {
      for (const [id, a] of Object.entries(d || {})) {
        const c = a?.creative || {};
        if (!c.thumbnail_url) continue;
        q("DELETE FROM adcreatives WHERE userId = ? AND json_extract(data, '$.adId') = ?").run(userId, id);
        T.adcreatives.insert({ id: uid(), userId, adId: id, thumb: String(c.thumbnail_url).slice(0, 1000), title: String(c.title || '').slice(0, 200), body: String(c.body || '').slice(0, 500), at: Date.now() });
      }
    });
  }
}
export const creativesOf = (userId) => new Map(q('SELECT data FROM adcreatives WHERE userId = ?').all(userId).map((x) => { const c = JSON.parse(x.data); return [c.adId, c]; }));

// ---------- CSV (Google Ads and others) ----------
// accepts Google Ads' "Campaign report" export: a header row with Day/Date, Campaign, Cost (other columns ignored)
export function parseSpendCsv(text) {
  const lines = String(text || '').replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
  const split = (l) => { const out = []; let cur = '', inQ = false; for (const ch of l) { if (ch === '"') inQ = !inQ; else if ((ch === ',' || ch === '\t') && !inQ) { out.push(cur); cur = ''; } else cur += ch; } out.push(cur); return out.map((s) => s.trim()); };
  const hIdx = lines.findIndex((l) => /campaign/i.test(l) && /(cost|spend|amount)/i.test(l));
  if (hIdx < 0) throw new Error('The file needs columns for the date, the campaign and the cost');
  const h = split(lines[hIdx]).map((x) => x.toLowerCase());
  const col = (re) => h.findIndex((x) => re.test(x));
  const di = col(/^(day|date)/), ci = col(/^campaign( name)?$/) >= 0 ? col(/^campaign( name)?$/) : col(/campaign/), si = col(/^(cost|spend|amount)/);
  if (di < 0 || ci < 0 || si < 0) throw new Error('The file needs columns for the date, the campaign and the cost');
  const rows = [];
  for (const l of lines.slice(hIdx + 1)) {
    const c = split(l);
    const raw = c[di];
    const date = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.test(raw) ? raw.replace(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/, (m, d, mo, y) => `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`) : null;
    const spend = Number(String(c[si] || '').replace(/[^\d.-]/g, ''));
    if (!date || !c[ci] || !Number.isFinite(spend) || /^total/i.test(c[ci])) continue;
    rows.push({ date, campaign: c[ci], spend });
  }
  if (!rows.length) throw new Error('No rows with a date, campaign and cost were found');
  return rows.slice(0, 20000);
}

// ---------- reports ----------
// spend per normalised campaign name, per platform, in a time range
export function spendBy(userId, from, to) {
  const out = {};
  for (const r of q("SELECT json_extract(data, '$.key') AS k, json_extract(data, '$.platform') AS p, json_extract(data, '$.campaign') AS c, SUM(json_extract(data, '$.spend')) AS s FROM adspend WHERE userId = ? AND at >= ? AND at < ? GROUP BY k, p").all(userId, from - DAY / 2, to)) {
    const g = (out[r.k] ||= { campaign: r.c, spend: 0, platforms: [] });
    g.spend += r.s || 0; g.platforms.push(r.p);
  }
  return out;
}
// the campaign rows of the reports, with spend, ROAS and cost per lead / sale; spend with no matching UTM shows too
export function withSpend(userId, rows, from, to) {
  const sp = spendBy(userId, from, to);
  const used = new Set();
  const out = rows.map((r) => {
    const s = r.campaign && sp[norm(r.campaign)];
    if (!s) return r;
    used.add(norm(r.campaign));
    const net = r.revenue; // already after refunds (an order's total drops when it's refunded)
    return { ...r, spend: Math.round(s.spend), roas: s.spend ? Math.round((net / s.spend) * 100) / 100 : null, cpl: r.leads ? Math.round(s.spend / r.leads) : null, cpa: r.orders ? Math.round(s.spend / r.orders) : null, platforms: s.platforms };
  });
  for (const [k, s] of Object.entries(sp)) if (!used.has(k)) out.push({ source: s.platforms.join(' + '), medium: 'paid', campaign: s.campaign, content: '', leads: 0, orders: 0, revenue: 0, refunded: 0, spend: Math.round(s.spend), roas: 0, unmatched: true });
  return out;
}
export const totalSpend = (userId, from, to) => q('SELECT COALESCE(SUM(json_extract(data, \'$.spend\')), 0) AS s FROM adspend WHERE userId = ? AND at >= ? AND at < ?').get(userId, from - DAY / 2, to).s;

export function registerAdSpend(app, { auth, wrap }) {
  app.get('/api/adspend', auth, (req, res) => {
    const m = req.user.channels?.metaAds || {};
    const last = q("SELECT json_extract(data, '$.platform') AS p, MAX(json_extract(data, '$.date')) AS d, COUNT(*) AS n FROM adspend WHERE userId = ? GROUP BY p").all(req.user.id);
    const a = appSpend(req.user) ? req.user.channels.metaApp : null;
    res.json({ meta: a ? { connected: true, via: 'apps', account: a.account, syncedAt: a.syncedAt || null, error: a.error || '' } : { connected: !!m.tokenEnc, account: m.account || '', syncedAt: m.syncedAt || null, error: m.error || '' }, apps: composioReady(), platforms: last });
  });
  app.put('/api/adspend/meta', auth, wrap(async (req, res) => {
    const b = req.body || {};
    if (b.clear) { setChannel(req.user.id, 'metaAds', undefined); q("DELETE FROM adspend WHERE userId = ? AND json_extract(data, '$.platform') = 'meta'").run(req.user.id); return res.json({ ok: true }); }
    if (composioReady()) return res.status(400).json({ error: USE_META_CONNECTION });
    const account = String(b.account || '').replace(/^act_/, '').trim();
    if (!/^\d{5,25}$/.test(account)) return res.status(400).json({ error: 'The ad account ID is the number in Ads Manager (act_…)' });
    const prev = req.user.channels?.metaAds || {};
    const token = String(b.token || '').trim() || (prev.tokenEnc ? decrypt(prev.tokenEnc) : '');
    if (!token) return res.status(400).json({ error: 'Paste a Marketing API access token with ads_read' });
    try { await graph(`act_${account}?fields=name,currency`, token); } catch (e) { return res.status(400).json({ error: `Meta: ${e.message}` }); }
    const u = setChannel(req.user.id, 'metaAds', { account, tokenEnc: encrypt(token), at: Date.now() });
    let n = 0;
    try { n = await syncMeta(u); } catch (e) { T.users.update(u.id, (x) => { x.channels.metaAds.error = e.message; }); return res.status(400).json({ error: `Connected, but the first sync failed: ${e.message}` }); }
    res.json({ ok: true, rows: n });
  }));
  app.post('/api/adspend/meta/sync', auth, wrap(async (req, res) => {
    try { res.json({ rows: await syncMeta(req.user, Math.min(90, Number(req.body?.days) || 30)) }); } catch (e) { res.status(400).json({ error: e.message }); }
  }));
  app.post('/api/adspend/csv', auth, (req, res) => {
    const platform = ['google', 'youtube', 'linkedin', 'tiktok', 'other'].includes(req.body?.platform) ? req.body.platform : 'google';
    try { res.json({ rows: store(req.user.id, platform, parseSpendCsv(req.body?.csv)) }); } catch (e) { res.status(400).json({ error: e.message }); }
  });
  app.delete('/api/adspend/:platform', auth, (req, res) => { res.json({ deleted: q("DELETE FROM adspend WHERE userId = ? AND json_extract(data, '$.platform') = ?").run(req.user.id, String(req.params.platform)).changes }); });

  // daily Meta sync for everyone connected
  const job = async () => {
    for (const row of q("SELECT data FROM users WHERE json_extract(data, '$.channels.metaAds.tokenEnc') IS NOT NULL OR json_extract(data, '$.channels.metaApp.account') IS NOT NULL").all()) {
      const u = JSON.parse(row.data);
      const app = appSpend(u);
      if (!app && !u.channels.metaAds?.tokenEnc) continue;
      if (Date.now() - ((app ? u.channels.metaApp : u.channels.metaAds).syncedAt || 0) < 20 * 3600000) continue;
      try { await syncMeta(u, 7); } catch (e) { if (!app) T.users.update(u.id, (x) => { x.channels.metaAds.error = e.message; }); }
    }
  };
  if (JOBS && process.env.NODE_ENV !== 'test') { setTimeout(job, 120000).unref(); setInterval(job, 3 * 3600000).unref(); }
}
