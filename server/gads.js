// Google Ads offline conversions: sales that close after a call (lead from an ad → booking → payment days later,
// a quote paid later) are credited to the ad click that brought the person in.
//  - Option A (everyone, no API approval): a secret HTTPS feed in Google's "conversions from clicks" import format,
//    for Google Ads → Goals → Conversions → Uploads → Schedules (HTTPS), or downloaded and uploaded by hand.
//  - Option B (beta, needs Google Ads API access): uploads the same rows hourly with
//    ConversionUploadService.UploadClickConversions, once per sale (uploaded ids and results are kept).
// The click id comes from the sale itself or, when that has none, from the buyer's earlier lead / booking / order
// (same contact) in the 90 days before — usually where the ad click happened.
// Hashed email / phone (enhanced conversions for leads) are off by default and only ever sent for contacts who
// agreed on a form (or the seller recorded their consent); a contact who refused is left out entirely.
import crypto from 'node:crypto';
import { T, q, JOBS, contactKey } from './db.js';
import { encrypt, decrypt, setChannel } from './messaging.js';
import { sellerTz, offsetAt } from './tz.js';
import { appUrl } from './mail.js';

const DAY = 86400000;
const WINDOW = 90 * DAY; // Google accepts clicks up to 90 days old
const API = () => (process.env.GOOGLE_ADS_API_URL || 'https://googleads.googleapis.com/v23').replace(/\/$/, '');
const TOKEN_URL = () => process.env.GOOGLE_ADS_TOKEN_URL || process.env.GOOGLE_TOKEN_URL || 'https://oauth2.googleapis.com/token';
const TICK = Number(process.env.GADS_TICK_MS || 3600000); // hourly
const MAX_TRIES = 3;
const KINDS = ['purchase', 'booking', 'lead'];
export const GADS_NAMES = { purchase: 'FunnelHive purchase', booking: 'FunnelHive booking', lead: 'FunnelHive qualified lead' };
const INCLUDE = { purchase: true, booking: false, lead: false };

const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const cfgOf = (u) => u?.channels?.gads || {};
const namesOf = (g) => Object.fromEntries(KINDS.map((k) => [k, g.names?.[k] || GADS_NAMES[k]]));
const includeOf = (g) => Object.fromEntries(KINDS.map((k) => [k, typeof g.include?.[k] === 'boolean' ? g.include[k] : INCLUDE[k]]));

// ---------- normalising (Google's rules for enhanced conversions) ----------
export function normEmail(e) {
  const v = String(e || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return '';
  const [local, domain] = v.split('@');
  return /^(gmail|googlemail)\.com$/.test(domain) ? `${local.replace(/\./g, '')}@${domain}` : v;
}
export function normPhone(p) {
  const raw = String(p || '').trim(), d = raw.replace(/\D/g, '');
  if (raw.startsWith('+') && d.length >= 8 && d.length <= 15) return `+${d}`;
  if (/^[6-9]\d{9}$/.test(d)) return `+91${d}`;
  if (/^0[6-9]\d{9}$/.test(d)) return `+91${d.slice(1)}`;
  if (/^91[6-9]\d{9}$/.test(d)) return `+${d}`;
  return '';
}
// "2026-10-16 14:05:00+05:30" in the seller's time zone
export function gTime(t, tz = 'Asia/Kolkata') {
  const off = offsetAt(tz, t);
  const local = new Date(t + off * 60000).toISOString().slice(0, 19).replace('T', ' ');
  const a = Math.abs(off);
  return `${local}${off < 0 ? '-' : '+'}${String(Math.floor(a / 60)).padStart(2, '0')}:${String(a % 60).padStart(2, '0')}`;
}

// ---------- which sales and leads count ----------
const clickOf = (attr) => (attr?.gclid ? { gclid: attr.gclid } : attr?.gbraid ? { gbraid: attr.gbraid } : attr?.wbraid ? { wbraid: attr.wbraid } : null);
const HAS_CLICK = "COALESCE(json_extract(data, '$.attr.gclid'), json_extract(data, '$.attr.gbraid'), json_extract(data, '$.attr.wbraid')) IS NOT NULL";
const keysOf = (r) => [...new Set([contactKey(r.email), r.phone ? contactKey(null, r.phone) : ''].filter(Boolean))];
// the latest ad click by this contact before the conversion (and within Google's 90 days): lead, booking or earlier order
function earlierClick(userId, keys, at, selfId) {
  let best = null;
  for (const t of ['leads', 'bookings', 'orders']) for (const k of keys) {
    const row = q(`SELECT data FROM ${t} WHERE userId = ? AND ckey = ? AND at <= ? AND at >= ? AND id != ? AND ${HAS_CLICK} ORDER BY at DESC LIMIT 1`).get(userId, k, at, at - WINDOW, selfId || '');
    const r = row && JSON.parse(row.data);
    if (r && (!best || r.at > best.at)) best = r;
  }
  return best ? { ...clickOf(best.attr), from: best.id } : null;
}
// agreed to marketing (like the contacts list): the seller's record wins, else a ticked consent line on any form.
// true / false (refused) / undefined (never asked)
function consentOf(userId, keys) {
  let given;
  for (const k of keys) {
    const c = T.crm.find({ userId, key: k });
    if (typeof c?.optIn === 'boolean') return c.optIn;
    for (const r of q("SELECT json_extract(data, '$.consent.given') AS g FROM leads WHERE userId = ? AND ckey = ? AND json_extract(data, '$.consent') IS NOT NULL").all(userId, k)) {
      if (r.g === 1) given = true; else if (given === undefined) given = false;
    }
  }
  return given;
}
const round2 = (n) => Math.round(n * 100) / 100;

// Every conversion in the last 90 days that Google could use, newest first:
// { key, kind, id, name, at, time, value, currency, gclid|gbraid|wbraid, email, phone (hashed, consented only) }
export function offlineConversions(u, { now = Date.now(), limit } = {}) {
  const g = cfgOf(u), names = namesOf(g), inc = includeOf(g), tz = sellerTz(u), since = now - WINDOW;
  const src = [];
  if (inc.purchase) {
    // real money only (no test orders, unpaid COD or cancelled — see paidOrder), refunds already off the total
    for (const o of T.orders.all({ userId: u.id, at: { gte: since }, paid: true, demo: false }, { order: 'at', desc: true })) {
      const value = round2((Number(o.total) || 0) * (Number(o.fx) || 1));
      if (o.status === 'refunded' || value <= 0) continue;
      src.push({ kind: 'purchase', r: o, value });
    }
  }
  if (inc.booking) {
    // a booked call (moved calls count once, on the original); not held / awaiting payment / cancelled
    for (const b of T.bookings.all({ userId: u.id, at: { gte: since }, status: ['confirmed', 'rescheduled'] }, { order: 'at', desc: true })) {
      if (!b.replaces && !b.unpaid) src.push({ kind: 'booking', r: b });
    }
  }
  if (inc.lead) {
    for (const row of q("SELECT data FROM leads WHERE userId = ? AND at >= ? AND demo = 0 AND json_extract(data, '$.qualified') = 1 ORDER BY at DESC").all(u.id, since)) src.push({ kind: 'lead', r: JSON.parse(row.data) });
  }
  const out = [];
  for (const { kind, r, value } of src.sort((a, b) => b.r.at - a.r.at)) {
    const keys = keysOf(r);
    const consent = keys.length ? consentOf(u.id, keys) : undefined;
    if (consent === false) continue; // refused: nothing about them goes to Google
    const click = clickOf(r.attr) || (keys.length ? earlierClick(u.id, keys, r.at, r.id) : null);
    const ids = g.hashed && consent === true ? { email: normEmail(r.email) ? sha(normEmail(r.email)) : '', phone: normPhone(r.phone) ? sha(normPhone(r.phone)) : '' } : {};
    if (!click && !ids.email && !ids.phone) continue;
    const { from, ...cid } = click || {};
    out.push({ key: `${kind}:${r.id}`, kind, id: r.id, name: names[kind], at: r.at, time: gTime(r.at, tz), ...(value != null ? { value } : {}), currency: 'INR', ...cid, ...(from ? { clickFrom: from } : {}), ...(ids.email ? { email: ids.email } : {}), ...(ids.phone ? { phone: ids.phone } : {}) });
    if (limit && out.length >= limit) break;
  }
  return out;
}

// ---------- the import file ----------
const cell = (v) => { const s = String(v ?? ''); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
// Google's "conversions from clicks" template. Only gclid rows: the file import has no braid columns
// (iOS gbraid / wbraid clicks go through the API upload). With hashed identifiers on, the enhanced-conversions-for-
// leads columns Email / Phone Number are added, and consented contacts without a click id can be matched by them.
export function offlineCsv(u, rows = offlineConversions(u)) {
  const hashed = !!cfgOf(u).hashed;
  const head = ['Google Click ID', ...(hashed ? ['Email', 'Phone Number'] : []), 'Conversion Name', 'Conversion Time', 'Conversion Value', 'Conversion Currency', 'Order ID'];
  const lines = [head.join(',')];
  for (const r of rows) {
    if (!r.gclid && !(hashed && (r.email || r.phone))) continue;
    lines.push([r.gclid || '', ...(hashed ? [r.email || '', r.phone || ''] : []), r.name, r.time, r.value ?? '', r.value != null ? r.currency : '', r.id].map(cell).join(','));
  }
  return `${lines.join('\r\n')}\r\n`;
}

// ---------- Option B: Google Ads API (beta) ----------
const apiOf = (g) => g.api || {};
const apiReady = (a) => !!(a.devTokenEnc && a.clientId && a.clientSecretEnc && a.refreshEnc && a.customerId);
async function accessToken(a) {
  const r = await fetch(TOKEN_URL(), { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: a.clientId, client_secret: decrypt(a.clientSecretEnc), refresh_token: decrypt(a.refreshEnc), grant_type: 'refresh_token' }), signal: AbortSignal.timeout(10000) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw new Error(`Google sign-in failed: ${j.error_description || j.error || `HTTP ${r.status}`}`);
  return j.access_token;
}
const headers = (a, token) => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'developer-token': decrypt(a.devTokenEnc), ...(a.loginCustomerId ? { 'login-customer-id': a.loginCustomerId } : {}) });
const apiError = (j, status) => String(j?.error?.details?.[0]?.errors?.[0]?.message || j?.error?.message || `HTTP ${status}`).slice(0, 300);

export async function testConnection(u) {
  const a = apiOf(cfgOf(u));
  if (!apiReady(a)) return { ok: false, error: 'Add the developer token, OAuth client id and secret, refresh token and customer ID first' };
  try {
    const token = await accessToken(a);
    const want = KINDS.map((k) => a.actions?.[k]).filter(Boolean);
    const query = `SELECT conversion_action.resource_name, conversion_action.name, conversion_action.status FROM conversion_action${want.length ? ` WHERE conversion_action.resource_name IN (${want.map((x) => `'${x}'`).join(', ')})` : ' LIMIT 20'}`;
    const r = await fetch(`${API()}/customers/${a.customerId}/googleAds:search`, { method: 'POST', headers: headers(a, token), body: JSON.stringify({ query }), signal: AbortSignal.timeout(15000) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return { ok: false, error: apiError(j, r.status) };
    const actions = (j.results || []).map((x) => ({ resource: x.conversionAction?.resourceName, name: x.conversionAction?.name, status: x.conversionAction?.status }));
    const missing = want.filter((w) => !actions.some((x) => x.resource === w));
    return { ok: !missing.length, actions, ...(missing.length ? { error: `Conversion action not found in this account: ${missing.join(', ')}` } : {}) };
  } catch (e) { return { ok: false, error: e.name === 'TimeoutError' ? 'Google Ads didn’t answer in time' : String(e.message).slice(0, 300) }; }
}

const busy = new Set();
// Uploads the eligible conversions not uploaded yet (failed ones are retried up to 3 times). → { sent, failed, skipped }
export async function uploadConversions(userId, { now = Date.now() } = {}) {
  if (busy.has(userId)) return { busy: true };
  // claimed in the database too, so two app processes never upload the same rows at once
  let claimed = false;
  T.users.update(userId, (x) => { const a = x.channels?.gads?.api; if (a && !((a.lockUntil || 0) > now)) { a.lockUntil = now + 600000; claimed = true; } });
  if (!claimed) return { busy: true };
  busy.add(userId);
  const result = { sent: 0, failed: 0, skipped: 0 };
  const marks = {};
  let lastError;
  try {
    const u = T.users.get(userId), g = cfgOf(u), a = apiOf(g), done = marksOf(userId);
    if (!apiReady(a)) throw new Error('Google Ads API isn’t fully connected');
    const rows = offlineConversions(u, { now }).filter((r) => {
      const d = done[r.key];
      if (d?.ok || (d?.tries || 0) >= MAX_TRIES) return false;
      if (!a.actions?.[r.kind]) { result.skipped++; return false; } // no conversion action for this kind
      return true;
    });
    if (rows.length) {
      const token = await accessToken(a);
      for (let i = 0; i < rows.length; i += 200) {
        const chunk = rows.slice(i, i + 200);
        const conversions = chunk.map((r) => ({
          conversionAction: a.actions[r.kind], conversionDateTime: r.time, orderId: r.id,
          ...(r.gclid ? { gclid: r.gclid } : r.gbraid ? { gbraid: r.gbraid } : r.wbraid ? { wbraid: r.wbraid } : {}),
          ...(r.value != null ? { conversionValue: r.value, currencyCode: r.currency } : {}),
          ...(r.email || r.phone ? { userIdentifiers: [...(r.email ? [{ hashedEmail: r.email }] : []), ...(r.phone ? [{ hashedPhoneNumber: r.phone }] : [])] } : {}),
        }));
        let res, j;
        try {
          res = await fetch(`${API()}/customers/${a.customerId}:uploadClickConversions`, { method: 'POST', headers: headers(a, token), body: JSON.stringify({ conversions, partialFailure: true }), signal: AbortSignal.timeout(30000) });
          j = await res.json().catch(() => ({}));
        } catch (e) { res = null; j = { error: { message: e.name === 'TimeoutError' ? 'Timed out' : e.message } }; }
        if (!res?.ok) {
          // the whole request failed: count a try for every row in it
          lastError = apiError(j, res?.status);
          for (const r of chunk) { marks[r.key] = { at: now, tries: (done[r.key]?.tries || 0) + 1, err: lastError }; result.failed++; }
          if (res && (res.status === 401 || res.status === 403)) break; // bad credentials: don't hammer
          continue;
        }
        // partial failures: per-row errors point at conversions[index]
        const errs = {};
        for (const d of j.partialFailureError?.details || []) for (const e of d.errors || []) {
          const idx = (e.location?.fieldPathElements || []).find((p) => p.fieldName === 'conversions')?.index;
          if (idx != null) errs[idx] = e;
        }
        chunk.forEach((r, n) => {
          const e = errs[n];
          if (e && !/ALREADY_EXISTS|already exists/i.test(JSON.stringify(e))) { marks[r.key] = { at: now, tries: (done[r.key]?.tries || 0) + 1, err: String(e.message || 'Rejected').slice(0, 300) }; result.failed++; }
          else { marks[r.key] = { at: now, ok: 1 }; result.sent++; }
        });
      }
    }
  } catch (e) { lastError = String(e.message).slice(0, 300); }
  finally {
    busy.delete(userId);
    saveMarks(userId, marks, now);
    T.users.update(userId, (x) => {
      const g = x.channels?.gads;
      if (!g) return;
      if (g.api) { g.api.lockUntil = 0; g.api.lastRun = now; g.api.lastResult = { ...result, ...(lastError ? { error: lastError } : {}) }; }
    });
  }
  return { ...result, ...(lastError ? { error: lastError } : {}) };
}
// what was uploaded (or keeps failing), per conversion: its own table, not the seller's account record (read on every request)
q('CREATE TABLE IF NOT EXISTS gadsmarks (userId TEXT NOT NULL, key TEXT NOT NULL, at INTEGER NOT NULL, ok INTEGER NOT NULL DEFAULT 0, tries INTEGER NOT NULL DEFAULT 0, err TEXT, PRIMARY KEY (userId, key))').run();
function marksOf(userId) {
  // older accounts kept these inside the account record: moved here once
  const legacy = T.users.get(userId)?.channels?.gads?.done;
  if (legacy && Object.keys(legacy).length) { saveMarks(userId, legacy, Date.now()); T.users.update(userId, (x) => { if (x.channels?.gads) delete x.channels.gads.done; }); }
  return Object.fromEntries(q('SELECT key, at, ok, tries, err FROM gadsmarks WHERE userId = ?').all(userId).map((r) => [r.key, { at: r.at, ok: r.ok, tries: r.tries, err: r.err }]));
}
function saveMarks(userId, marks, now) {
  const up = q('INSERT INTO gadsmarks (userId, key, at, ok, tries, err) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(userId, key) DO UPDATE SET at = excluded.at, ok = excluded.ok, tries = excluded.tries, err = excluded.err');
  for (const [k, v] of Object.entries(marks)) up.run(userId, k, v.at || now, v.ok ? 1 : 0, v.tries || 0, v.err || null);
  q('DELETE FROM gadsmarks WHERE userId = ? AND at < ?').run(userId, now - 100 * DAY); // older than Google takes
}
if (JOBS) setInterval(() => {
  for (const { id } of q("SELECT id FROM users WHERE json_extract(data, '$.channels.gads.api.enabled') = 1").all()) uploadConversions(id).catch(() => {});
}, TICK).unref();

// ---------- settings ----------
const NAME_RE = /^[\p{L}\p{N}][\p{L}\p{N} _().&'/-]{0,99}$/u; // never starts with = + - @ (a spreadsheet formula)
const feedUrl = (u, req) => {
  const g = cfgOf(u);
  return g.feedEnc ? `${appUrl(req).replace(/\/$/, '')}/api/gads/offline.csv?token=${u.id}.${decrypt(g.feedEnc)}` : '';
};
const newSecret = () => crypto.randomBytes(24).toString('hex');
function view(u, req) {
  const g = cfgOf(u), a = apiOf(g);
  const uploaded = q('SELECT COUNT(*) AS n FROM gadsmarks WHERE userId = ? AND ok = 1').get(u.id).n;
  const failing = q('SELECT key, err, tries FROM gadsmarks WHERE userId = ? AND ok = 0 ORDER BY at DESC LIMIT 10').all(u.id);
  const rows = offlineConversions(u);
  return {
    feedUrl: feedUrl(u, req), names: namesOf(g), include: includeOf(g), hashed: !!g.hashed,
    eligible: rows.filter((r) => r.gclid || (g.hashed && (r.email || r.phone))).length, braidOnly: rows.filter((r) => !r.gclid && (r.gbraid || r.wbraid)).length,
    preview: rows.slice(0, 10).map(({ email, phone, ...r }) => ({ ...r, hashedEmail: !!email, hashedPhone: !!phone })),
    api: {
      developerToken: !!a.devTokenEnc, clientId: a.clientId || '', clientSecret: !!a.clientSecretEnc, refreshToken: !!a.refreshEnc,
      customerId: a.customerId || '', loginCustomerId: a.loginCustomerId || '', actions: Object.fromEntries(KINDS.map((k) => [k, a.actions?.[k] || ''])),
      enabled: !!a.enabled, ready: apiReady(a), lastRun: a.lastRun || null, lastResult: a.lastResult || null,
      uploaded, failing: failing.map((d) => ({ key: d.key, err: d.err, tries: d.tries })),
    },
  };
}
const ensureFeed = (u) => (cfgOf(u).feedEnc ? u : setChannel(u.id, 'gads', { ...cfgOf(u), feedEnc: encrypt(newSecret()) }));
const custId = (v) => String(v ?? '').replace(/[\s-]/g, '');

export function registerGads(app, { auth, wrap }) {
  // The feed Google fetches: no login, the secret in the address is the key. HTTPS only (outside local testing).
  app.get('/api/gads/offline.csv', (req, res) => {
    const local = process.env.NODE_ENV === 'test' || /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(String(req.headers.host || ''));
    if (!req.secure && !local) return res.status(403).type('text/plain').send('HTTPS only');
    const tok = String(req.query.token || ''), dot = tok.indexOf('.');
    const u = dot > 0 ? T.users.get(tok.slice(0, dot)) : null;
    const secret = u ? decrypt(cfgOf(u).feedEnc) : '';
    if (!secret || !crypto.timingSafeEqual(Buffer.from(sha(secret)), Buffer.from(sha(tok.slice(dot + 1))))) return res.status(404).type('text/plain').send('Not found');
    res.set({ 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex', 'Referrer-Policy': 'no-referrer' });
    if (req.query.download) res.attachment(`google-ads-offline-conversions-${new Date().toISOString().slice(0, 10)}.csv`);
    res.type('text/csv; charset=utf-8').send(offlineCsv(u));
  });
  // settings (account-wide secrets: owners and admins — /api/channels/ is admin-only for team members)
  app.get('/api/channels/gads', auth, (req, res) => res.json(view(ensureFeed(req.user), req)));
  app.post('/api/channels/gads/rotate', auth, (req, res) => res.json(view(setChannel(req.user.id, 'gads', { ...cfgOf(req.user), feedEnc: encrypt(newSecret()) }), req)));
  app.put('/api/channels/gads', auth, (req, res) => {
    const b = req.body || {}, prev = cfgOf(ensureFeed(req.user)), next = { ...prev };
    if (b.names && typeof b.names === 'object') {
      next.names = { ...prev.names };
      for (const k of KINDS) if (k in b.names) {
        const v = String(b.names[k] ?? '').trim();
        if (v && !NAME_RE.test(v)) return res.status(400).json({ error: 'Conversion names: letters, numbers, spaces and - _ ( ) & / only, up to 100 characters — exactly as in Google Ads' });
        if (v) next.names[k] = v; else delete next.names[k];
      }
    }
    if (b.include && typeof b.include === 'object') next.include = { ...includeOf(prev), ...Object.fromEntries(KINDS.filter((k) => typeof b.include[k] === 'boolean').map((k) => [k, b.include[k]])) };
    if ('hashed' in b) next.hashed = b.hashed === true;
    if (b.api === null) { const { devTokenEnc, clientSecretEnc, refreshEnc, ...rest } = prev.api || {}; next.api = { ...rest, enabled: false, clientId: '', customerId: '', loginCustomerId: '' }; }
    else if (b.api && typeof b.api === 'object') {
      const x = b.api, a = { ...(prev.api || {}) };
      const secret = (k, enc, re, msg) => { if (!(k in x)) return null; const v = String(x[k] ?? '').trim(); if (v && !re.test(v)) return msg; a[enc] = v ? encrypt(v) : ''; return null; };
      const err = secret('developerToken', 'devTokenEnc', /^[\w-]{10,100}$/, 'The developer token is in Google Ads → Tools → API Center (about 22 characters)')
        || secret('clientSecret', 'clientSecretEnc', /^[\w-]{10,100}$/, 'That doesn’t look like an OAuth client secret (Google Cloud → APIs & Services → Credentials)')
        || secret('refreshToken', 'refreshEnc', /^[\w/.-]{10,600}$/, 'That doesn’t look like an OAuth refresh token (it usually starts with 1//)');
      if (err) return res.status(400).json({ error: err });
      if ('clientId' in x) { const v = String(x.clientId ?? '').trim(); if (v && !/^[\w.-]{10,200}$/.test(v)) return res.status(400).json({ error: 'The OAuth client ID looks like 1234-abc.apps.googleusercontent.com' }); a.clientId = v; }
      for (const k of ['customerId', 'loginCustomerId']) if (k in x) {
        const v = custId(x[k]);
        if (v && !/^\d{10}$/.test(v)) return res.status(400).json({ error: 'A Google Ads customer ID is 10 digits, like 123-456-7890' });
        a[k] = v;
      }
      if (x.actions && typeof x.actions === 'object') {
        a.actions = { ...(a.actions || {}) };
        for (const k of KINDS) if (k in x.actions) {
          let v = String(x.actions[k] ?? '').trim();
          if (/^\d{1,20}$/.test(v) && a.customerId) v = `customers/${a.customerId}/conversionActions/${v}`; // just the id
          if (v && !/^customers\/\d{10}\/conversionActions\/\d{1,20}$/.test(v)) return res.status(400).json({ error: 'A conversion action is its id (Goals → Conversions → the action → the ctId in the address) or customers/1234567890/conversionActions/123' });
          a.actions[k] = v;
        }
      }
      if ('enabled' in x) a.enabled = x.enabled === true;
      if (a.enabled && !apiReady(a)) return res.status(400).json({ error: 'Add all the Google Ads API details before turning on automatic upload' });
      next.api = a;
    }
    next.at = Date.now();
    res.json(view(setChannel(req.user.id, 'gads', next), req));
  });
  app.post('/api/channels/gads/test', auth, wrap(async (req, res) => res.json(await testConnection(req.user))));
  app.post('/api/channels/gads/upload', auth, wrap(async (req, res) => {
    if (!apiReady(apiOf(cfgOf(req.user)))) return res.status(400).json({ error: 'Connect the Google Ads API first' });
    const r = await uploadConversions(req.user.id);
    res.json({ ...r, status: view(T.users.get(req.user.id), req) });
  }));
}
