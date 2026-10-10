import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { hit } from './db.js';

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

// ---------- security headers ----------
export function securityHeaders(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  // booking pages may be embedded on the seller's own website
  if (!req.path.startsWith('/meet/')) res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
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
export const verifyTotp = (secret, code) => [-1, 0, 1].some((w) => totp(secret, Date.now() + w * 30000) === String(code || '').replace(/\s/g, ''));
export const otpauthUrl = (secret, email) => `otpauth://totp/FunnelHive:${encodeURIComponent(email)}?secret=${secret}&issuer=FunnelHive&digits=6&period=30`;
