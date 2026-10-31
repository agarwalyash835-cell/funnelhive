import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { hit, q, tx, T, uid, JOBS } from './db.js';

// ---------- signing secret ----------
// Use JWT_SECRET when provided; otherwise generate a strong one once and keep it next to the data,
// so tokens can't be forged with a well-known default and still survive restarts.
export function loadSecret(dataDir) {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  const file = path.join(dataDir, '.jwt-secret');
  try { const s = fs.readFileSync(file, 'utf8').trim(); if (s) return s; } catch {}
  // created at most once: if another app process wins the race, use the secret it wrote
  try {
    fs.writeFileSync(file, crypto.randomBytes(48).toString('hex'), { mode: 0o600, flag: 'wx' });
    console.warn('JWT_SECRET not set — generated a random one in', file);
  } catch (e) { if (e.code !== 'EEXIST') throw e; }
  for (let i = 0; i < 50; i++) { const s = fs.readFileSync(file, 'utf8').trim(); if (s) return s; Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20); }
  throw new Error(`Couldn't read ${file}`);
}

// ---------- rate limiting (fixed window) ----------
// In memory by default (per process). shared: true counts in the database, so the limit holds across
// all processes in cluster mode — used where it matters for security (sign-in, password reset).
let limiterId = 0;
export function rateLimit({ windowMs, max, key = (req) => req.ip, message = 'Too many requests — please wait a moment and try again.', shared = false, name }) {
  const hits = new Map();
  const id = name || `rl${++limiterId}`;
  if (!shared) setInterval(() => { const now = Date.now(); for (const [k, v] of hits) if (v.reset < now) hits.delete(k); }, windowMs).unref();
  return (req, res, next) => {
    const k = key(req);
    const now = Date.now();
    let h;
    if (shared) h = hit(`${id}:${k}`, windowMs);
    else {
      h = hits.get(k);
      if (!h || h.reset < now) { h = { n: 0, reset: now + windowMs }; hits.set(k, h); }
      h.n++;
    }
    res.setHeader('RateLimit-Remaining', Math.max(0, max - h.n));
    if (h.n > max) {
      res.setHeader('Retry-After', Math.ceil((h.reset - now) / 1000));
      return res.status(429).json({ error: message });
    }
    next();
  };
}

// ---------- per-account lockout (shared across processes) ----------
// Counts failures per key (an email, an account); at max the key is locked for windowMs from that moment.
export function lockout(name, { max = 10, windowMs = 15 * 60000 } = {}) {
  const k = (key) => `${name}:${String(key).toLowerCase()}`;
  return {
    // minutes left on a lock, or 0
    locked(key) { const r = q('SELECT n, reset FROM counters WHERE k = ?').get(k(key)); return r && r.n >= max && r.reset > Date.now() ? Math.ceil((r.reset - Date.now()) / 60000) : 0; },
    fail(key) { const h = hit(k(key), windowMs); if (h.n === max) q('UPDATE counters SET reset = ? WHERE k = ?').run(Date.now() + windowMs, k(key)); },
    clear(key) { q('DELETE FROM counters WHERE k = ?').run(k(key)); },
  };
}

// ---------- passwords ----------
// New passwords only (existing ones keep working): 8+ characters and not one of the most common passwords
const COMMON = new Set(`password password1 password12 password123 password1234 passw0rd p@ssword p@ssw0rd pass1234 12345678 123456789 1234567890 12345678910 87654321 11111111 00000000 22222222 88888888 99999999 12341234 11223344 12121212 123123123 147258369 159753456 123456789a 1q2w3e4r 1q2w3e4r5t 1qaz2wsx qwerty123 qwertyuiop qwerty12 qwerty1234 qwertyui asdfghjkl asdfasdf asdf1234 zxcvbnm1 zxcvbnm123 abcd1234 abc12345 abcdefgh abcdefg1 a1b2c3d4 aa123456 iloveyou iloveyou1 sunshine sunshine1 princess princess1 football football1 baseball basketball superman batman123 starwars whatever trustno1 welcome1 welcome123 letmein1 letmein123 monkey123 dragon123 master123 shadow123 michael1 jennifer computer internet samsung123 google123 changeme changeme123 admin123 admin1234 administrator root1234 test1234 testtest guest123 india123 india@123 bharat123 krishna123 ganesh123 jaishreeram om123456 sairam123 mumbai123 delhi123 cricket1 cricket123 pakistan123 lovely123 loveyou1 mylove123 babygirl1 sweetheart chocolate butterfly cookie123 pokemon123 minecraft fortnite1 liverpool chelsea1 arsenal1 manchester barcelona realmadrid 1234qwer qwer1234 q1w2e3r4 zaq12wsx !qaz2wsx qazwsxedc 123qweasd 123abc123 abc123456 password! password@1 welcome@123 admin@123 pass@123 test@123 hello123 hello1234 helloworld 12345abc 123456abc 1234abcd 123456qwerty qwerty123456 987654321 9876543210 aaaaaaaa abcabc123 asdasdasd qweqweqwe zxczxczxc 147852369 741852963 963852741 01234567 123654789 1111111111 0987654321 summer2024 winter2024 spring2024 autumn2024 summer2025 winter2025 summer2026 password2024 password2025 password2026 funnelhive funnelhive1 funnelhive123`.split(/\s+/));
export function weakPassword(p) {
  const s = String(p || '');
  if (s.length < 8) return 'Use at least 8 characters for your password';
  if (s.length > 200) return 'That password is too long';
  if (COMMON.has(s.toLowerCase()) || /^(.)\1+$/.test(s)) return 'That password is too common — choose one that’s harder to guess';
  return null;
}

// ---------- sessions ----------
// Every sign-in is a session (one per device): tokens carry its id (sid), so a single device can be signed out,
// and Settings → Security lists them. Impersonation ("log in as seller") sessions carry the admin's id (imp).
const ipShort = (ip) => { const s = String(ip || '').replace(/^::ffff:/, ''); return s.includes(':') ? `${s.split(':').slice(0, 3).join(':')}::` : s.replace(/\.\d+$/, '.0'); };
const device = (ua) => {
  const s = String(ua || '');
  const b = /Edg\//.test(s) ? 'Edge' : /OPR\//.test(s) ? 'Opera' : /SamsungBrowser/.test(s) ? 'Samsung Internet' : /Firefox\//.test(s) ? 'Firefox' : /Chrome\//.test(s) ? 'Chrome' : /Safari\//.test(s) ? 'Safari' : /curl|node|undici|python/i.test(s) ? 'Script' : 'Browser';
  const o = /Android/.test(s) ? 'Android' : /iPhone|iPad/.test(s) ? 'iOS' : /Windows/.test(s) ? 'Windows' : /Mac OS X/.test(s) ? 'macOS' : /Linux/.test(s) ? 'Linux' : '';
  return o ? `${b} on ${o}` : b;
};
export const SESSION_MS = 14 * 86400000;
export function startSession(req, u, { imp = null, ms = SESSION_MS } = {}) {
  const now = Date.now();
  return T.sessions.insert({ id: uid(), userId: u.id, createdAt: now, lastSeenAt: now, expiresAt: now + ms, ip: ipShort(req.ip), device: device(req.headers['user-agent']), ...(imp ? { imp } : {}) }).id;
}
// a token's session: still signed in? (tokens from before sessions existed have no sid — accepted until they
// expire or "sign out everywhere else" is used, which sets u.legacyBefore)
export function sessionOk(p, u) {
  if (!p.sid) return !(u.legacyBefore && (p.iat + 1) * 1000 <= u.legacyBefore);
  const s = T.sessions.get(p.sid);
  if (!s || s.userId !== u.id || s.revokedAt || s.expiresAt < Date.now()) return false;
  if (Date.now() - s.lastSeenAt > 10 * 60000) T.sessions.update(s.id, (x) => { x.lastSeenAt = Date.now(); });
  return true;
}
export const extendSession = (sid) => T.sessions.update(sid, (s) => { if (!s.imp) s.expiresAt = Date.now() + SESSION_MS; });
export const revokeSession = (sid, userId) => T.sessions.update(sid, (s) => (s.userId === userId && !s.revokedAt ? Object.assign(s, { revokedAt: Date.now() }) : s));
// every session but keep (null: all), and tokens from before sessions existed
export function revokeOthers(userId, keep = null) {
  const now = Date.now();
  tx(() => {
    for (const s of T.sessions.all({ userId, expiresAt: { gt: now } })) if (s.id !== keep && !s.revokedAt) { s.revokedAt = now; T.sessions.put(s); }
    T.users.update(userId, (u) => { u.legacyBefore = now; });
  });
}
export const activeSessions = (userId) => T.sessions.all({ userId, expiresAt: { gt: Date.now() } }).filter((s) => !s.revokedAt).sort((a, b) => b.lastSeenAt - a.lastSeenAt);
if (JOBS && process.env.NODE_ENV !== 'test') setInterval(() => { try { q('DELETE FROM sessions WHERE expiresAt < ?').run(Date.now() - 86400000); } catch {} }, 6 * 3600000).unref();

// ---------- Content Security Policy ----------
// One builder for every page, so it's easy to adjust:
//   'app'   the dashboard, editor and sign-in pages (no inline scripts at all)
//   'page'  live funnel pages: the inline data scripts carry a per-request nonce; pixels and checkouts by host
//   'embed' a live page with a custom-HTML block: that code runs in a sandboxed srcdoc iframe, which inherits the
//           page's policy, so a seller's own inline scripts and script hosts (Calendly, Typeform…) must be allowed
const PAY = ['https://checkout.razorpay.com', 'https://js.stripe.com', 'https://*.js.stripe.com'];
const PIXELS = ['https://connect.facebook.net', 'https://www.googletagmanager.com', 'https://www.googleadservices.com', 'https://googleads.g.doubleclick.net', 'https://www.google.com'];
const SIGNIN = ['https://accounts.google.com', 'https://challenges.cloudflare.com'];
// "Connect with Facebook" for WhatsApp (meta-signup.js): the Facebook SDK, loaded only when a seller clicks it
const FBSDK = ['https://connect.facebook.net', 'https://*.facebook.com'];
// the storage buckets the browser fetches signed links from (course video pieces): added to connect-src.
// var + function declaration: platform.js registers this while modules are still loading
var connectHosts;
export function useConnectHosts(fn) { connectHosts = fn; }
const bucketHosts = () => { try { return connectHosts?.() || []; } catch { return []; } };
export const newNonce = () => crypto.randomBytes(16).toString('base64');
export function csp(kind = 'app', { nonce, frameAncestors = "'self'" } = {}) {
  const app = kind === 'app';
  const d = {
    'default-src': ["'self'"],
    'script-src': kind === 'embed' ? ["'self'", "'unsafe-inline'", "'unsafe-eval'", 'https:'] : ["'self'", ...(nonce ? [`'nonce-${nonce}'`] : []), ...PAY, ...(app ? [...SIGNIN, ...FBSDK] : PIXELS)],
    'style-src': app ? ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com', 'https://accounts.google.com'] : ["'self'", "'unsafe-inline'", 'https:'],
    'font-src': app ? ["'self'", 'data:', 'https://fonts.gstatic.com'] : ["'self'", 'data:', 'https:'],
    'img-src': ["'self'", 'data:', 'blob:', 'https:'],
    'media-src': ["'self'", 'data:', 'blob:', 'https:'],
    'connect-src': app ? ["'self'", 'https://*.razorpay.com', 'https://*.stripe.com', ...SIGNIN, ...FBSDK, 'https://*.ingest.sentry.io', 'https://*.ingest.de.sentry.io', ...bucketHosts()] : ["'self'", 'https:', ...(kind === 'embed' ? ['wss:'] : [])],
    // video blocks take any https address (YouTube, Vimeo, Loom, Drive…); checkouts open their own frames
    'frame-src': ["'self'", 'https:', 'data:', 'blob:'],
    'worker-src': ["'self'", 'blob:'],
    'object-src': ["'none'"],
    'base-uri': ["'self'"],
    'frame-ancestors': [frameAncestors],
  };
  return Object.entries(d).map(([k, v]) => `${k} ${v.join(' ')}`).join('; ');
}

// ---------- security headers ----------
export function securityHeaders(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  // booking pages may be embedded on the seller's own website
  const embeddable = req.path.startsWith('/meet/');
  if (!embeddable) res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  // the dashboard's policy by default; live funnel pages set their own (renderFunnel), uploads a stricter one
  res.setHeader('Content-Security-Policy', csp('app', { frameAncestors: embeddable ? '*' : "'self'" }));
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups'); // Razorpay / Google sign-in popups
  if (req.secure || req.headers['x-forwarded-proto'] === 'https') res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
}

// ---------- one-time tokens (email verification, password reset) ----------
export const randomToken = () => crypto.randomBytes(32).toString('hex');
export const hashToken = (t) => crypto.createHash('sha256').update(String(t)).digest('hex');

// ---------- TOTP two-factor (RFC 6238, compatible with Google Authenticator / Authy) ----------
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function newTotpSecret() {
  const bytes = crypto.randomBytes(20);
  let bits = '', out = '';
  for (const b of bytes) bits += b.toString(2).padStart(8, '0');
  for (let i = 0; i + 5 <= bits.length; i += 5) out += B32[parseInt(bits.slice(i, i + 5), 2)];
  return out;
}
function b32decode(s) {
  let bits = '';
  for (const c of s.replace(/=+$/, '').toUpperCase()) { const v = B32.indexOf(c); if (v >= 0) bits += v.toString(2).padStart(5, '0'); }
  const out = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) out.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(out);
}
export function totp(secret, at = Date.now(), step = 30) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 1000 / step)));
  const h = crypto.createHmac('sha1', b32decode(secret)).update(counter).digest();
  const o = h[h.length - 1] & 0xf;
  const code = ((h.readUInt32BE(o) & 0x7fffffff) % 1e6).toString().padStart(6, '0');
  return code;
}
// Accept the current code and one step either side to allow for clock drift
export const verifyTotp = (secret, code) => totpStep(secret, code) != null;
// the time step a code belongs to (null: not valid). A code is good once: steps at or before `used` (the last one
// accepted for this account) are refused, so an overheard or phished code can't be replayed.
export function totpStep(secret, code, used = 0) {
  const c = String(code || '').replace(/\s/g, '');
  if (!secret || !/^\d{6}$/.test(c)) return null;
  const now = Math.floor(Date.now() / 30000);
  for (const w of [-1, 0, 1]) if (now + w > used && totp(secret, (now + w) * 30000) === c) return now + w;
  return null;
}
// issuer: the brand the person signs in to (an agency's, for its clients) — what their authenticator app shows
export const otpauthUrl = (secret, email, issuer = 'FunnelHive') => {
  const i = encodeURIComponent(String(issuer).replace(/:/g, ' ').trim() || 'FunnelHive');
  return `otpauth://totp/${i}:${encodeURIComponent(email)}?secret=${secret}&issuer=${i}&digits=6&period=30`;
};
