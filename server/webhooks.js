// Outgoing webhooks: persisted queue, retries with backoff, HMAC-SHA256 signatures.
// Receivers verify:  expected = HMAC_SHA256(secret, `${t}.${rawBody}`)  and compare with v1 in
// the X-FunnelHive-Signature header ("t=<unix seconds>,v1=<hex>").
import crypto from 'node:crypto';
import dns from 'node:dns/promises';
import net from 'node:net';
import http from 'node:http';
import https from 'node:https';
import { lookup as dnsLookup } from 'node:dns';
import { subscribers } from './api.js';
import { T, q, uid, JOBS } from './db.js';

const SCALE = Number(process.env.WEBHOOK_RETRY_SCALE || 1); // tests shrink the delays
const BACKOFF = [0, 30e3, 120e3, 600e3, 3600e3, 6 * 3600e3].map((ms) => ms * SCALE);
const MAX_PER_USER = 500;

// ---- SSRF guard: a webhook may never reach this server's own network ----
// (localhost, private LANs, cloud metadata at 169.254.169.254, …). Tests run receivers on 127.0.0.1.
export const allowPrivate = () => (process.env.WEBHOOK_ALLOW_PRIVATE ? process.env.WEBHOOK_ALLOW_PRIVATE === '1' : process.env.NODE_ENV === 'test');
export function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || (a === 198 && (b === 18 || b === 19));
  }
  const v = ip.toLowerCase().replace(/%.*$/, '');
  if (!net.isIPv6(v)) return true; // anything we can't parse is refused
  const g = expand6(v);
  // IPv4-mapped (::ffff:a.b.c.d), IPv4-compatible (::a.b.c.d), NAT64 (64:ff9b::a.b.c.d) and IPv4-translated
  // addresses reach the IPv4 address in their last 32 bits — judge them as that address
  const v4 = (hi, lo) => [hi >> 8, hi & 255, lo >> 8, lo & 255].join('.');
  if (g.slice(0, 5).every((x) => x === 0) && (g[5] === 0xffff || g[5] === 0)) return g[5] === 0 && g[6] === 0 && g[7] <= 1 ? true : isPrivateIp(v4(g[6], g[7]));
  if (g[0] === 0x64 && g[1] === 0xff9b) return isPrivateIp(v4(g[6], g[7]));
  if (g.slice(0, 4).every((x) => x === 0) && g[4] === 0xffff && g[5] === 0) return isPrivateIp(v4(g[6], g[7]));
  const first = g[0];
  return first === 0 || (first & 0xfe00) === 0xfc00 || (first & 0xffc0) === 0xfe80 || (first & 0xff00) === 0xff00 || first === 0x2002 || (first === 0x2001 && g[1] === 0);
}
// "::ffff:7f00:1" → [0,0,0,0,0,0xffff,0x7f00,1] (handles :: and a trailing dotted IPv4)
function expand6(ip) {
  let s = ip;
  const m = /(\d+\.\d+\.\d+\.\d+)$/.exec(s);
  if (m) { const [a, b, c, d] = m[1].split('.').map(Number); s = s.slice(0, -m[1].length) + ((a << 8) | b).toString(16) + ':' + ((c << 8) | d).toString(16); }
  const [head, tail] = s.split('::');
  const h = head ? head.split(':') : [], t = tail !== undefined ? (tail ? tail.split(':') : []) : null;
  const parts = t === null ? h : [...h, ...Array(8 - h.length - t.length).fill('0'), ...t];
  return parts.map((x) => parseInt(x || '0', 16));
}
// Throws unless the host name resolves only to public internet addresses
export async function checkPublicHost(host) {
  if (allowPrivate()) return;
  host = String(host).replace(/^\[|\]$/g, '');
  if (/^(localhost|.*\.localhost|.*\.local|.*\.internal)$/i.test(host)) throw new Error('This must be a public internet address');
  let ips;
  try { ips = net.isIP(host) ? [host] : (await dns.lookup(host, { all: true })).map((r) => r.address); } catch { throw new Error(`Couldn’t find ${host} — check the address`); }
  if (!ips.length || ips.some(isPrivateIp)) throw new Error('This must be a public internet address');
}
// Throws a friendly error for anything that is not a public http(s) address
export async function checkWebhookUrl(raw) {
  let u;
  try { u = new URL(String(raw).trim()); } catch { throw new Error('Enter a full URL, e.g. https://hooks.zapier.com/…'); }
  if (!['http:', 'https:'].includes(u.protocol)) throw new Error('Webhook URLs must start with https://');
  if (u.username || u.password) throw new Error('Remove the username/password from the URL');
  if (allowPrivate()) return u.toString();
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (/^(localhost|.*\.localhost|.*\.local|.*\.internal)$/i.test(host)) throw new Error('Webhooks must point to a public internet address');
  let ips;
  try { ips = net.isIP(host) ? [host] : (await dns.lookup(host, { all: true })).map((r) => r.address); } catch { throw new Error(`Couldn’t find ${host} — check the URL`); }
  if (!ips.length || ips.some(isPrivateIp)) throw new Error('Webhooks must point to a public internet address');
  return u.toString();
}

// POST that checks the address at the moment of connecting, so a DNS answer that changes between the check
// above and the request (DNS rebinding) can't reach the server's private network. No redirects are followed.
const safeLookup = (host, opts, cb) => dnsLookup(host, opts, (err, addr, family) => {
  if (err) return cb(err);
  const list = Array.isArray(addr) ? addr.map((a) => a.address) : [addr];
  if (!allowPrivate() && (!list.length || list.some(isPrivateIp))) return cb(new Error('Webhooks must point to a public internet address'));
  cb(null, addr, family);
});
export function postPinned(url, { headers, body, timeout = 10000 }) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = (u.protocol === 'https:' ? https : http).request(u, { method: 'POST', headers: { ...headers, 'Content-Length': Buffer.byteLength(body) }, lookup: safeLookup, timeout }, (res) => {
      res.resume();
      res.on('end', () => resolve({ status: res.statusCode, ok: res.statusCode >= 200 && res.statusCode < 300 }));
    });
    req.on('timeout', () => { const e = new Error('Timed out after 10s'); e.name = 'TimeoutError'; req.destroy(e); });
    req.on('error', reject);
    req.end(body);
  });
}

export const newWebhookSecret = () => `whsec_${crypto.randomBytes(24).toString('hex')}`;
export const sign = (secret, ts, body) => crypto.createHmac('sha256', secret).update(`${ts}.${body}`).digest('hex');

const userOf = (id) => T.users.get(id);

// Creates the user's signing secret on first use (saved on the account)
export function ensureSecret(user) {
  user.settings ||= {};
  if (!user.settings.webhookSecret) {
    const saved = T.users.update(user.id, (u) => { u.settings ||= {}; u.settings.webhookSecret ||= newWebhookSecret(); });
    user.settings.webhookSecret = saved?.settings.webhookSecret || newWebhookSecret();
  }
  return user.settings.webhookSecret;
}

// Queue an event; the first attempt happens right away
export function enqueue(userId, event, data, urlOverride) {
  // REST-hook subscribers (Zapier, Pabbly, Make…) get their events too
  if (!urlOverride) for (const sub of subscribers(userId, event)) enqueue(userId, event, data, sub);
  const u = userOf(userId);
  const url = urlOverride || u?.settings?.webhookUrl;
  if (!url) return null;
  ensureSecret(u);
  const d = { id: uid(), userId, event, url, payload: { id: null, event, data, at: new Date().toISOString() }, status: 'pending', attempts: 0, nextAt: Date.now(), at: Date.now() };
  d.payload.id = d.id;
  T.webhooks.insert(d);
  // keep the log bounded per user
  q(`DELETE FROM webhooks WHERE id IN (SELECT id FROM webhooks WHERE userId = ? ORDER BY at DESC LIMIT -1 OFFSET ${MAX_PER_USER})`).run(userId);
  first.set(d.id, attempt(d.id));
  return d;
}
const first = new Map();
// Resolves (with the delivery's latest state) when the immediate first attempt has finished
export const firstAttempt = (d) => first.get(d.id) || Promise.resolve(T.webhooks.get(d.id) || d);

const inFlight = new Set();
// claimed first (nextAt moves ahead) so two processes never send the same delivery at once
const claim = (id) => q("UPDATE webhooks SET nextAt = ? WHERE id = ? AND status = 'pending' AND nextAt <= ?").run(Date.now() + 120000, id, Date.now()).changes === 1;
export async function attempt(id) {
  let d = T.webhooks.get(id);
  if (!d || inFlight.has(d.id) || d.status !== 'pending' || !claim(id)) return d;
  inFlight.add(d.id);
  try {
    const u = userOf(d.userId);
    const body = JSON.stringify(d.payload);
    const ts = Math.floor(Date.now() / 1000);
    const r0 = { attempts: d.attempts + 1 };
    try {
      try { await checkWebhookUrl(d.url); } catch (e) { r0.blocked = true; throw e; } // re-checked on every send (DNS can change)
      const r = await postPinned(d.url, { // redirects aren't followed: one must not lead to a private address
        headers: {
          'Content-Type': 'application/json', 'User-Agent': 'FunnelHive-Webhooks/1.0',
          'X-FunnelHive-Event': d.event, 'X-FunnelHive-Delivery': d.id,
          'X-FunnelHive-Signature': `t=${ts},v1=${sign(ensureSecret(u), ts, body)}`,
        },
        body,
      });
      r0.lastStatus = r.status;
      if (r.ok) { r0.status = 'delivered'; r0.deliveredAt = Date.now(); r0.lastError = undefined; }
      else r0.lastError = `HTTP ${r.status}`;
    } catch (e) {
      r0.lastStatus = null;
      r0.lastError = e.name === 'TimeoutError' ? 'Timed out after 10s' : e.message;
    }
    // apply the result to the latest copy of the delivery
    d = T.webhooks.update(id, (x) => {
      Object.assign(x, r0);
      if (r0.lastError === undefined) delete x.lastError;
      if (x.status !== 'delivered') {
        if (x.attempts >= BACKOFF.length || x.blocked) x.status = 'failed';
        else x.nextAt = Date.now() + BACKOFF[x.attempts];
      }
    }) || d;
    return d;
  } finally {
    inFlight.delete(id);
    setTimeout(() => first.delete(id), 60000).unref();
  }
}

// Background worker: retry anything due
const TICK = Number(process.env.WEBHOOK_TICK_MS || 10000);
if (JOBS) setInterval(() => {
  for (const id of T.webhooks.ids({ status: 'pending', nextAt: { lte: Date.now() } })) if (!inFlight.has(id)) attempt(id);
}, TICK).unref();

export function retryNow(d) {
  T.webhooks.update(d.id, (x) => { x.status = 'pending'; x.attempts = Math.min(x.attempts, BACKOFF.length - 1); x.nextAt = Date.now(); });
  return attempt(d.id);
}
