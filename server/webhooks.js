// Outgoing webhooks: persisted queue, retries with backoff, HMAC-SHA256 signatures.
// Receivers verify:  expected = HMAC_SHA256(secret, `${t}.${rawBody}`)  and compare with v1 in
// the X-FunnelForge-Signature header ("t=<unix seconds>,v1=<hex>").
import crypto from 'node:crypto';
import dns from 'node:dns/promises';
import net from 'node:net';
import { db, save, uid } from './db.js';

const SCALE = Number(process.env.WEBHOOK_RETRY_SCALE || 1); // tests shrink the delays
const BACKOFF = [0, 30e3, 120e3, 600e3, 3600e3, 6 * 3600e3].map((ms) => ms * SCALE);
const MAX_PER_USER = 500;

// ---- SSRF guard: a webhook may never reach this server's own network ----
// (localhost, private LANs, cloud metadata at 169.254.169.254, …). Tests run receivers on 127.0.0.1.
export const allowPrivate = () => (process.env.WEBHOOK_ALLOW_PRIVATE ? process.env.WEBHOOK_ALLOW_PRIVATE === '1' : process.env.NODE_ENV === 'test');
function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || (a === 198 && (b === 18 || b === 19));
  }
  const v = ip.toLowerCase();
  if (v.startsWith('::ffff:')) return isPrivateIp(v.slice(7));
  return v === '::' || v === '::1' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe8') || v.startsWith('fe9') || v.startsWith('fea') || v.startsWith('feb') || v.startsWith('ff');
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

export const newWebhookSecret = () => `whsec_${crypto.randomBytes(24).toString('hex')}`;
export const sign = (secret, ts, body) => crypto.createHmac('sha256', secret).update(`${ts}.${body}`).digest('hex');

function userOf(id) { return db.users.find((u) => u.id === id); }

export function ensureSecret(user) {
  user.settings ||= {};
  if (!user.settings.webhookSecret) { user.settings.webhookSecret = newWebhookSecret(); save(); }
  return user.settings.webhookSecret;
}

// Queue an event; the first attempt happens right away
export function enqueue(userId, event, data, urlOverride) {
  const u = userOf(userId);
  const url = urlOverride || u?.settings?.webhookUrl;
  if (!url) return null;
  ensureSecret(u);
  const d = { id: uid(), userId, event, url, payload: { id: null, event, data, at: new Date().toISOString() }, status: 'pending', attempts: 0, nextAt: Date.now(), at: Date.now() };
  d.payload.id = d.id;
  db.webhooks.push(d);
  // keep the log bounded per user
  const mine = db.webhooks.filter((w) => w.userId === userId);
  if (mine.length > MAX_PER_USER) { const drop = new Set(mine.slice(0, mine.length - MAX_PER_USER).map((w) => w.id)); db.webhooks = db.webhooks.filter((w) => !drop.has(w.id)); }
  save();
  first.set(d, attempt(d));
  return d;
}
const first = new WeakMap();
// Resolves when the immediate first delivery attempt has finished
export const firstAttempt = (d) => first.get(d) || Promise.resolve(d);

const inFlight = new Set();
export async function attempt(d) {
  if (inFlight.has(d.id) || d.status === 'delivered') return d;
  inFlight.add(d.id);
  const u = userOf(d.userId);
  const body = JSON.stringify(d.payload);
  const ts = Math.floor(Date.now() / 1000);
  d.attempts++;
  try {
    try { await checkWebhookUrl(d.url); } catch (e) { d.blocked = true; throw e; } // re-checked on every send (DNS can change)
    const r = await fetch(d.url, {
      redirect: 'manual', // a redirect must not lead to a private address
      method: 'POST',
      headers: {
        'Content-Type': 'application/json', 'User-Agent': 'FunnelForge-Webhooks/1.0',
        'X-FunnelForge-Event': d.event, 'X-FunnelForge-Delivery': d.id,
        'X-FunnelForge-Signature': `t=${ts},v1=${sign(ensureSecret(u), ts, body)}`,
      },
      body,
      signal: AbortSignal.timeout(10000),
    });
    d.lastStatus = r.status;
    if (r.ok) { d.status = 'delivered'; d.deliveredAt = Date.now(); delete d.lastError; }
    else d.lastError = `HTTP ${r.status}`;
  } catch (e) {
    d.lastStatus = null;
    d.lastError = e.name === 'TimeoutError' ? 'Timed out after 10s' : e.message;
  }
  if (d.status !== 'delivered') {
    if (d.attempts >= BACKOFF.length || d.blocked) d.status = 'failed';
    else d.nextAt = Date.now() + BACKOFF[d.attempts];
  }
  inFlight.delete(d.id);
  save();
  return d;
}

// Background worker: retry anything due
const TICK = Number(process.env.WEBHOOK_TICK_MS || 10000);
setInterval(() => {
  const now = Date.now();
  for (const d of db.webhooks) if (d.status === 'pending' && d.nextAt <= now && !inFlight.has(d.id)) attempt(d);
}, TICK).unref();

export function retryNow(d) {
  d.status = 'pending';
  d.attempts = Math.min(d.attempts, BACKOFF.length - 1);
  d.nextAt = Date.now();
  return attempt(d);
}
