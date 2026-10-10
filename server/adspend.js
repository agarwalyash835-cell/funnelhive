// Ad spend for true ROAS: what each campaign cost, next to the leads and sales it brought (matched by UTM campaign).
//   - Meta: a Marketing API token + ad account id; spend per campaign per day is pulled daily (last 30 days)
//   - Google Ads (or any network): a CSV export (date, campaign, cost) uploaded from the dashboard
// Campaign names are matched loosely (case / spaces / dashes ignored) to utm_campaign, so "Diwali Sale" in
// Ads Manager meets ?utm_campaign=diwali-sale.
import { T, q, tx, uid, JOBS } from './db.js';
import { encrypt, decrypt, setChannel } from './messaging.js';

const GRAPH = () => (process.env.META_GRAPH_URL || 'https://graph.facebook.com').replace(/\/$/, '');
const VER = 'v21.0';
const DAY = 86400000;
export const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
const ymd = (t) => new Date(t + 330 * 60000).toISOString().slice(0, 10);

// replace a platform's spend for the given days (re-syncs and re-uploads never double count)
function store(userId, platform, rows) {
  const days = [...new Set(rows.map((r) => r.date))];
  tx(() => {
    for (const d of days) q("DELETE FROM adspend WHERE userId = ? AND json_extract(data, '$.platform') = ? AND json_extract(data, '$.date') = ?").run(userId, platform, d);
    for (const r of rows) T.adspend.insert({ id: uid(), userId, platform, date: r.date, campaign: String(r.campaign).slice(0, 200), key: norm(r.campaign), spend: Math.round(Number(r.spend) * 100) / 100, currency: r.currency || 'INR', at: Date.parse(`${r.date}T00:00:00+05:30`) });
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
export async function syncMeta(u, days = 30) {
  const m = u.channels?.metaAds;
  if (!m?.tokenEnc || !m.account) return 0;
  const token = decrypt(m.tokenEnc), until = ymd(Date.now()), since = ymd(Date.now() - (days - 1) * DAY);
  const rows = [];
  let path = `act_${m.account}/insights?level=campaign&time_increment=1&fields=campaign_name,spend,account_currency&limit=500&time_range=${encodeURIComponent(JSON.stringify({ since, until }))}`;
  for (let i = 0; path && i < 20; i++) {
    const d = await graph(path, token);
    for (const x of d.data || []) rows.push({ date: x.date_start, campaign: x.campaign_name, spend: Number(x.spend) || 0, currency: x.account_currency || 'INR' });
    path = d.paging?.next ? d.paging.next.replace(/^https?:\/\/[^/]+\/v[\d.]+\//, '').replace(/[?&]access_token=[^&]+/, '') : null;
  }
  const n = store(u.id, 'meta', rows);
  T.users.update(u.id, (x) => { x.channels.metaAds = { ...x.channels.metaAds, syncedAt: Date.now(), error: '' }; });
  return n;
}

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
    res.json({ meta: { connected: !!m.tokenEnc, account: m.account || '', syncedAt: m.syncedAt || null, error: m.error || '' }, platforms: last });
  });
  app.put('/api/adspend/meta', auth, wrap(async (req, res) => {
    const b = req.body || {};
    if (b.clear) { setChannel(req.user.id, 'metaAds', undefined); q("DELETE FROM adspend WHERE userId = ? AND json_extract(data, '$.platform') = 'meta'").run(req.user.id); return res.json({ ok: true }); }
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
    for (const row of q("SELECT data FROM users WHERE json_extract(data, '$.channels.metaAds.tokenEnc') IS NOT NULL").all()) {
      const u = JSON.parse(row.data);
      if (Date.now() - (u.channels.metaAds.syncedAt || 0) < 20 * 3600000) continue;
      try { await syncMeta(u, 7); } catch (e) { T.users.update(u.id, (x) => { x.channels.metaAds.error = e.message; }); }
    }
  };
  if (JOBS && process.env.NODE_ENV !== 'test') { setTimeout(job, 120000).unref(); setInterval(job, 3 * 3600000).unref(); }
}
