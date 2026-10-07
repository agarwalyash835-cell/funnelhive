import express from 'express';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { T, Events, q, tx, uid, contactKey, dir as DATA_DIR, JOBS } from './db.js';
import { generateFunnel, editBlocks, aiEnabled, aiProvider, chatAI, AGENTS, runAgent } from './ai.js';
import { templateList, getTemplate, matchTemplate } from './templates.js';
import { applyActions, offlineChat } from './actions.js';
import { abResult } from './stats.js';
import { DAY, reportRange } from './time.js';
import { totals, totalsByFunnel, series, sources, revenueByKind, stepCounts, bumpRate } from './analytics.js';
import { loadSecret, rateLimit, securityHeaders, randomToken, hashToken, newTotpSecret, verifyTotp, otpauthUrl } from './security.js';
import { sendMail, mailEnabled, appUrl } from './mail.js';
import { registerCrm } from './crm.js';
import { initMessaging, registerChannels } from './messaging.js';
import { rzpCreds, createOrder as rzpCreateOrder, validPayment, validWebhook, registerRazorpaySettings } from './razorpay.js';
import { registerDomains, domainRouter, funnelUrl, domainOfFunnel } from './domains.js';
import { registerAutomations, fire as fireAutomation } from './automations.js';
import { registerHive } from './hive.js';
import { registerBilling, accessFor, lockedOut, newBilling, spendCredits, usageSummary, AI_COST, pricing } from './billing.js';
import { platform, isAdmin, brand } from './platform.js';
import { registerAdmin } from './admin.js';
import { registerAccount } from './account.js';
import { verifyGoogleToken, googleClientId } from './google.js';
import { enqueue as fireWebhook, firstAttempt, retryNow, ensureSecret, newWebhookSecret, checkWebhookUrl } from './webhooks.js';

const SECRET = loadSecret(DATA_DIR);
initMessaging(SECRET);
const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(securityHeaders);
// Same-origin by default; allow extra origins (e.g. a marketing site) via CORS_ORIGINS=https://a.com,https://b.com
const ALLOWED = (process.env.CORS_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
app.use(cors({ origin: (origin, cb) => cb(null, !origin || ALLOWED.includes(origin)) }));
app.use('/api/uploads', express.json({ limit: '8mb' }));
app.use('/api/razorpay/webhook', express.raw({ type: '*/*', limit: '1mb' }));
app.use('/api/billing/webhook', express.raw({ type: '*/*', limit: '1mb' }));
app.use(express.json({ limit: '4mb' }));
// Requests on a seller's own domain (offer.theirbrand.in) show their funnel
app.use(domainRouter((...a) => renderFunnel(...a)));

const isTest = process.env.NODE_ENV === 'test';
const authLimiter = rateLimit({ windowMs: 15 * 60000, max: isTest ? 1000 : 20, message: 'Too many attempts — please wait 15 minutes and try again.', shared: true, name: 'auth' });
const publicLimiter = rateLimit({ windowMs: 60000, max: isTest ? 5000 : 120 });
const aiLimiter = rateLimit({ windowMs: 60000, max: isTest ? 1000 : 20, key: (req) => req.user?.id || req.ip, message: 'You are sending AI requests too quickly — please wait a minute.' });
app.use('/api/public', (req, res, next) => (req.method === 'POST' ? publicLimiter(req, res, next) : next()));

const wrap = (fn) => (req, res) => Promise.resolve(fn(req, res)).catch((e) => {
  console.error(e);
  res.status(500).json({ error: e.message });
});

// ---------- auth ----------
const DEFAULT_SETTINGS = { businessName: '', currency: '₹', supportWhatsapp: '', payments: { provider: 'razorpay', razorpayKey: '', stripeKey: '', cashfreeKey: '', phonepeKey: '', mode: 'test' }, tracking: { fbPixel: '', ga4: '' }, webhookUrl: '', customDomain: '' };
// pv (password version) lets us invalidate every existing session when the password changes
const sign = (u) => jwt.sign({ id: u.id, pv: u.pv || 0 }, SECRET, { expiresIn: '30d' });
// an admin "logging in as" a seller (support): short-lived, and the seller's account shows it
const signAs = (u, adminId) => jwt.sign({ id: u.id, pv: u.pv || 0, imp: adminId }, SECRET, { expiresIn: '2h' });
const pubUser = (u) => ({ id: u.id, email: u.email, name: u.name });
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const withDefaults = (u) => { u.settings = { ...DEFAULT_SETTINGS, ...(u.settings || {}) }; return u; };
const auth = (req, res, next) => {
  try {
    const t = (req.headers.authorization || '').replace('Bearer ', '');
    const p = jwt.verify(t, SECRET);
    req.user = T.users.get(p.id);
    if (!req.user || (p.pv || 0) !== (req.user.pv || 0)) throw new Error();
    if (p.imp) req.impersonator = p.imp;
    withDefaults(req.user);
    if (Date.now() - (req.user.lastSeenAt || 0) > 10 * 60000 && !p.imp) T.users.update(req.user.id, (u) => { u.lastSeenAt = Date.now(); });
  } catch {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  // an account whose trial / subscription has ended is read-only (402 Payment Required)
  const locked = lockedOut(req);
  if (locked) return res.status(402).json({ error: locked, locked: true });
  next();
};
// AI features use monthly credits
const credits = (kind) => (req, res, next) => {
  const err = spendCredits(req.user, AI_COST[kind]);
  return err ? res.status(402).json({ error: err, credits: true }) : next();
};
// Saves changes made to req.user. After an `await`, re-read first so concurrent changes aren't lost.
const saveUser = (u) => T.users.put(u);

// One-time links carry the account id, so they're checked against one record instead of every account
const userToken = (u) => `${u.id}.${randomToken()}`;
function userByToken(token, hashField, expField) {
  const s = String(token || '');
  const h = hashToken(s);
  const id = s.includes('.') ? s.split('.')[0] : null;
  const u = id ? T.users.get(id) : null;
  return u && u[hashField] === h && u[expField] > Date.now() ? u : null;
}

async function sendVerification(req, user) {
  const token = userToken(user);
  T.users.update(user.id, (u) => { u.verifyHash = hashToken(token); u.verifyExp = Date.now() + 3 * DAY; });
  await sendMail({ to: user.email, subject: `Verify your ${brand()} email`, text: `Hi ${user.name},\n\nConfirm your email address by opening this link:\n${appUrl(req)}/verify?token=${token}\n\nThe link is valid for 3 days.` }).catch((e) => console.error('verification email failed', e.message));
}

app.post('/api/auth/register', authLimiter, wrap(async (req, res) => {
  const { email, password, name } = req.body;
  if (!email || !EMAIL_RE.test(email) || !password || password.length < 6) return res.status(400).json({ error: 'A valid email and a 6+ character password are required' });
  if (!platform().signupsOpen) return res.status(403).json({ error: 'New sign-ups are paused right now — please check back soon.' });
  if (T.users.exists({ email: email.toLowerCase() })) return res.status(409).json({ error: 'Email already registered' });
  const user = { id: uid(), email: email.toLowerCase(), name: String(name || email.split('@')[0]).slice(0, 80), hash: bcrypt.hashSync(password, 10), settings: { ...DEFAULT_SETTINGS }, emailVerified: false, pv: 0, createdAt: Date.now(), billing: newBilling() };
  try { T.users.insert(user); } catch { return res.status(409).json({ error: 'Email already registered' }); }
  sendVerification(req, user);
  res.json({ token: sign(user), user: pubUser(user) });
}));

app.post('/api/auth/login', authLimiter, (req, res) => {
  const user = T.users.find({ email: String(req.body.email || '').toLowerCase() });
  if (!user || !bcrypt.compareSync(req.body.password || '', user.hash)) return res.status(401).json({ error: 'Invalid email or password' });
  if (user.totpEnabled) {
    if (!req.body.code) return res.json({ twoFactorRequired: true });
    if (!verifyTotp(user.totpSecret, req.body.code)) return res.status(401).json({ error: 'That 2-step code is not valid', twoFactorRequired: true });
  }
  res.json({ token: sign(user), user: pubUser(user) });
});

// Continue with Google: signs in, or creates the account on first use (the email is verified by Google)
app.post('/api/auth/google', authLimiter, wrap(async (req, res) => {
  let g;
  try { g = await verifyGoogleToken(req.body.credential); } catch (e) { return res.status(401).json({ error: e.message }); }
  let user = T.users.find({ email: g.email });
  if (!user) {
    if (!platform().signupsOpen) return res.status(403).json({ error: 'New sign-ups are paused right now — please check back soon.' });
    user = { id: uid(), email: g.email, name: g.name, hash: bcrypt.hashSync(randomToken(), 10), googleId: g.sub, settings: { ...DEFAULT_SETTINGS }, emailVerified: true, pv: 0, createdAt: Date.now(), billing: newBilling() };
    try { T.users.insert(user); } catch { user = T.users.find({ email: g.email }); }
  } else if (!user.googleId || !user.emailVerified) {
    user = T.users.update(user.id, (u) => { u.googleId ||= g.sub; u.emailVerified = true; });
  }
  if (user.totpEnabled) {
    if (!req.body.code) return res.json({ twoFactorRequired: true });
    if (!verifyTotp(user.totpSecret, req.body.code)) return res.status(401).json({ error: 'That 2-step code is not valid', twoFactorRequired: true });
  }
  res.json({ token: sign(user), user: pubUser(user) });
}));

app.post('/api/auth/verify', authLimiter, (req, res) => {
  const user = userByToken(req.body.token, 'verifyHash', 'verifyExp');
  if (!user) return res.status(400).json({ error: 'This verification link is invalid or has expired.' });
  user.emailVerified = true;
  delete user.verifyHash; delete user.verifyExp;
  saveUser(user);
  res.json({ ok: true });
});

// Always answers OK so the endpoint can't be used to discover which emails have accounts
app.post('/api/auth/forgot', authLimiter, wrap(async (req, res) => {
  const user = T.users.find({ email: String(req.body.email || '').toLowerCase() });
  if (user) {
    const token = userToken(user);
    user.resetHash = hashToken(token);
    user.resetExp = Date.now() + 60 * 60000;
    saveUser(user);
    await sendMail({ to: user.email, subject: `Reset your ${brand()} password`, text: `Hi ${user.name},\n\nReset your password here (valid for 1 hour):\n${appUrl(req)}/reset?token=${token}\n\nIf you didn't ask for this, you can ignore this email.` }).catch((e) => console.error('reset email failed', e.message));
  }
  res.json({ ok: true, emailConfigured: mailEnabled() });
}));

app.post('/api/auth/reset', authLimiter, (req, res) => {
  const { token, password } = req.body;
  if (!password || password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
  const user = userByToken(token, 'resetHash', 'resetExp');
  if (!user) return res.status(400).json({ error: 'This reset link is invalid or has expired.' });
  user.hash = bcrypt.hashSync(password, 10);
  user.pv = (user.pv || 0) + 1; // signs out every other session
  user.emailVerified = true; // they proved access to the inbox
  delete user.resetHash; delete user.resetExp;
  saveUser(user);
  res.json({ token: sign(user), user: pubUser(user) });
});

app.post('/api/auth/resend-verification', auth, authLimiter, wrap(async (req, res) => {
  if (req.user.emailVerified) return res.json({ ok: true });
  await sendVerification(req, req.user);
  res.json({ ok: true, emailConfigured: mailEnabled() });
}));

app.post('/api/auth/change-password', auth, authLimiter, (req, res) => {
  const { current, password } = req.body;
  if (!bcrypt.compareSync(current || '', req.user.hash)) return res.status(401).json({ error: 'Current password is incorrect' });
  if (!password || password.length < 6) return res.status(400).json({ error: 'New password must be at least 6 characters' });
  req.user.hash = bcrypt.hashSync(password, 10);
  req.user.pv = (req.user.pv || 0) + 1;
  saveUser(req.user);
  res.json({ token: sign(req.user) });
});

// Two-step login: setup returns a secret to add to an authenticator app; enable/disable require a valid code
app.post('/api/auth/2fa/setup', auth, (req, res) => {
  if (req.user.totpEnabled) return res.status(400).json({ error: '2-step verification is already on' });
  req.user.totpPending = newTotpSecret();
  saveUser(req.user);
  res.json({ secret: req.user.totpPending, otpauth: otpauthUrl(req.user.totpPending, req.user.email) });
});
app.post('/api/auth/2fa/enable', auth, authLimiter, (req, res) => {
  if (!req.user.totpPending || !verifyTotp(req.user.totpPending, req.body.code)) return res.status(400).json({ error: 'That code is not valid — check your authenticator app and try again' });
  req.user.totpSecret = req.user.totpPending;
  req.user.totpEnabled = true;
  delete req.user.totpPending;
  saveUser(req.user);
  res.json({ ok: true });
});
app.post('/api/auth/2fa/disable', auth, authLimiter, (req, res) => {
  if (!req.user.totpEnabled || !verifyTotp(req.user.totpSecret, req.body.code)) return res.status(400).json({ error: 'That code is not valid' });
  req.user.totpEnabled = false;
  delete req.user.totpSecret;
  saveUser(req.user);
  res.json({ ok: true });
});

const mine = (req) => T.funnels.all({ userId: req.user.id });
const ownFunnel = (req, id) => { const f = T.funnels.get(id); return f && f.userId === req.user.id ? f : null; };

// Liveness/readiness for Docker, load balancers and uptime monitors
const startedAt = Date.now();
app.get('/api/health', (_, res) => {
  q('SELECT 1').get(); // the database answers
  res.json({ ok: true, uptimeSec: Math.round((Date.now() - startedAt) / 1000) });
});

const demoCount = (userId) => ({
  events: q('SELECT COUNT(*) AS n FROM events WHERE userId = ? AND demo = 1').get(userId).n,
  orders: T.orders.count({ userId, demo: 1 }), leads: T.leads.count({ userId, demo: 1 }), abandoned: T.abandoned.count({ userId, demo: 1 }),
});
app.get('/api/me', auth, (req, res) => {
  const s = req.user.settings;
  const funnels = q('SELECT COUNT(*) AS n, COALESCE(SUM(json_extract(data, \'$.published\')), 0) AS pub FROM funnels WHERE userId = ?').get(req.user.id);
  res.json({
    ...pubUser(req.user), hasDemo: !!q('SELECT 1 FROM events WHERE userId = ? AND demo = 1 LIMIT 1').get(req.user.id) || T.orders.exists({ userId: req.user.id, demo: 1 }) || T.leads.exists({ userId: req.user.id, demo: 1 }),
    aiEnabled: aiEnabled(), aiProvider: aiProvider(), mailEnabled: mailEnabled(), emailVerified: req.user.emailVerified !== false, twoFactor: !!req.user.totpEnabled, settings: s,
    billing: req.access || accessFor(req.user), credits: usageSummary(req.user), admin: isAdmin(req.user), brand: platform().brand, announcement: platform().announcement || '',
    impersonating: !!req.impersonator,
    onboarding: {
      funnel: funnels.n > 0,
      published: funnels.pub > 0,
      payments: !!(s.payments.razorpayKey || s.payments.stripeKey || s.payments.cashfreeKey || s.payments.phonepeKey),
      tracking: !!(s.tracking.fbPixel || s.tracking.ga4),
      lead: T.leads.exists({ userId: req.user.id }),
    },
  });
});

// ---------- settings, coupons, webhooks ----------
app.get('/api/settings', auth, (req, res) => { ensureSecret(req.user); res.json(req.user.settings); });
// Only known settings are stored, and each is checked (the signing secret can only be rotated, never set)
const SETTING_KEYS = ['businessName', 'currency', 'supportWhatsapp', 'webhookUrl', 'customDomain'];
app.put('/api/settings', auth, wrap(async (req, res) => {
  const s = req.user.settings;
  const body = req.body || {};
  const next = { ...s };
  for (const k of SETTING_KEYS) if (k in body) next[k] = String(body[k] ?? '').trim().slice(0, 300);
  if (body.payments && typeof body.payments === 'object') {
    next.payments = { ...s.payments };
    for (const k of ['provider', 'razorpayKey', 'stripeKey', 'cashfreeKey', 'phonepeKey', 'mode']) if (k in body.payments) next.payments[k] = String(body.payments[k] ?? '').trim().slice(0, 200);
  }
  if (body.tracking && typeof body.tracking === 'object') {
    next.tracking = { ...s.tracking };
    if ('fbPixel' in body.tracking) {
      const v = String(body.tracking.fbPixel ?? '').trim();
      if (v && !/^\d{6,20}$/.test(v)) return res.status(400).json({ error: 'The Meta Pixel ID is the number in Events Manager, e.g. 123456789012345' });
      next.tracking.fbPixel = v;
    }
    if ('ga4' in body.tracking) {
      const v = String(body.tracking.ga4 ?? '').trim().toUpperCase();
      if (v && !/^G-[A-Z0-9]{4,20}$/.test(v)) return res.status(400).json({ error: 'The Google Analytics 4 ID looks like G-XXXXXXX (from Admin → Data streams)' });
      next.tracking.ga4 = v;
    }
  }
  if (next.webhookUrl && next.webhookUrl !== s.webhookUrl) {
    try { next.webhookUrl = await checkWebhookUrl(next.webhookUrl); } catch (e) { return res.status(400).json({ error: e.message }); }
  }
  const u = T.users.update(req.user.id, (x) => { withDefaults(x); x.settings = { ...next, webhookSecret: x.settings.webhookSecret || next.webhookSecret }; });
  ensureSecret(u);
  res.json(u.settings);
}));
app.post('/api/settings/webhook-secret', auth, (req, res) => {
  req.user.settings.webhookSecret = newWebhookSecret();
  saveUser(req.user);
  res.json({ webhookSecret: req.user.settings.webhookSecret });
});

app.post('/api/settings/test-webhook', auth, wrap(async (req, res) => {
  const d = fireWebhook(req.user.id, 'test.ping', { message: `Hello from ${brand()} 👋` });
  if (!d) return res.json({ skipped: true });
  const out = await firstAttempt(d);
  res.json({ status: out.lastStatus, error: out.lastError, delivery: out.id });
}));

app.get('/api/webhooks/deliveries', auth, (req, res) => {
  res.json(T.webhooks.all({ userId: req.user.id }, { order: 'at', desc: true, limit: 50 }));
});
app.post('/api/webhooks/deliveries/:did/retry', auth, wrap(async (req, res) => {
  const d = T.webhooks.get(req.params.did);
  if (!d || d.userId !== req.user.id) return res.status(404).json({ error: 'Not found' });
  res.json(await retryNow(d));
}));

// ---------- saved sections (reusable across funnels) ----------
const SAVED_MAX = 200;
app.get('/api/saved', auth, (req, res) => res.json(T.saved.all({ userId: req.user.id }, { order: 'at', desc: true }).map(({ userId, ...x }) => x)));
app.post('/api/saved', auth, (req, res) => {
  const block = req.body.block;
  if (!block || typeof block.type !== 'string' || !block.props || typeof block.props !== 'object' || Array.isArray(block.props)) return res.status(400).json({ error: 'Nothing to save' });
  if (JSON.stringify(block).length > 300000) return res.status(413).json({ error: 'That section is too large to save' });
  if (T.saved.count({ userId: req.user.id }) >= SAVED_MAX) return res.status(400).json({ error: `You can keep up to ${SAVED_MAX} saved sections — delete some first` });
  const item = T.saved.insert({ id: uid(), userId: req.user.id, name: String(req.body.name || block.type).slice(0, 80), block: { type: block.type, props: block.props }, at: Date.now() });
  const { userId, ...out } = item;
  res.json(out);
});
app.delete('/api/saved/:sid', auth, (req, res) => {
  T.saved.delWhere({ id: req.params.sid, userId: req.user.id });
  res.json({ ok: true });
});

app.get('/api/coupons', auth, (req, res) => res.json(T.coupons.all({ userId: req.user.id })));
// Coupon rules: % off is 1–100, ₹ off is positive; optional expiry, total-use limit, one use per customer,
// minimum order and specific funnels. Returns the cleaned fields or { error }.
function couponRules(body, cur = {}, userId) {
  const out = {};
  const type = 'type' in body ? (body.type === 'flat' ? 'flat' : 'percent') : cur.type || 'percent';
  out.type = type;
  if ('value' in body || !cur.id) {
    const v = Number(body.value);
    if (!Number.isFinite(v) || v <= 0) return { error: 'Enter a discount greater than 0' };
    if (type === 'percent' && v > 100) return { error: 'A percentage discount can be at most 100%' };
    if (type === 'flat' && v > 10000000) return { error: 'That discount is too large' };
    out.value = type === 'percent' ? Math.round(v * 100) / 100 : Math.round(v);
  } else if (type === 'percent' && cur.value > 100) return { error: 'A percentage discount can be at most 100%' };
  if ('active' in body) out.active = !!body.active;
  if ('expiresAt' in body) {
    if (!body.expiresAt) out.expiresAt = null;
    else { const t = new Date(body.expiresAt).getTime(); if (!Number.isFinite(t)) return { error: 'Invalid expiry date' }; out.expiresAt = t; }
  }
  for (const k of ['maxUses', 'minOrder']) if (k in body) {
    if (body[k] === '' || body[k] == null || Number(body[k]) === 0) out[k] = null;
    else { const n = Math.round(Number(body[k])); if (!Number.isFinite(n) || n < 0) return { error: `Invalid ${k === 'maxUses' ? 'usage limit' : 'minimum order'}` }; out[k] = n; }
  }
  if ('oncePerCustomer' in body) out.oncePerCustomer = !!body.oncePerCustomer;
  if ('funnelIds' in body) {
    const own = new Set(T.funnels.ids({ userId }));
    out.funnelIds = (Array.isArray(body.funnelIds) ? body.funnelIds : []).filter((id) => own.has(id));
  }
  return out;
}
app.post('/api/coupons', auth, (req, res) => {
  const code = String(req.body.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 30);
  if (!code) return res.status(400).json({ error: 'Code required' });
  if (T.coupons.exists({ userId: req.user.id, code })) return res.status(409).json({ error: 'Code already exists' });
  const r = couponRules(req.body, {}, req.user.id);
  if (r.error) return res.status(400).json(r);
  const c = T.coupons.insert({ id: uid(), userId: req.user.id, code, active: true, uses: 0, createdAt: Date.now(), expiresAt: null, maxUses: null, minOrder: null, oncePerCustomer: false, funnelIds: [], ...r });
  res.json(c);
});
app.put('/api/coupons/:cid', auth, (req, res) => {
  const c = T.coupons.get(req.params.cid);
  if (!c || c.userId !== req.user.id) return res.status(404).json({ error: 'Not found' });
  const r = couponRules(req.body, c, req.user.id);
  if (r.error) return res.status(400).json(r);
  Object.assign(c, r);
  T.coupons.put(c);
  res.json(c);
});
app.delete('/api/coupons/:cid', auth, (req, res) => {
  T.coupons.delWhere({ id: req.params.cid, userId: req.user.id });
  res.json({ ok: true });
});

// ---------- funnels ----------
const owned = (req, res) => {
  const f = ownFunnel(req, req.params.id);
  if (!f) res.status(404).json({ error: 'Not found' });
  return f;
};
const uniqueSlug = (base) => {
  let s = base.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'funnel';
  while (T.funnels.exists({ slug: s })) s += '-' + uid().slice(0, 3);
  return s;
};
// Every code advertised in an exit popup must actually work at checkout: create missing ones
// (INDIA10 → 10% off). Existing coupons — including paused or edited ones — are left alone.
function ensurePopupCoupons(f) {
  for (const s of f.steps) for (const b of [...s.blocks, ...(s.ab?.blocks || [])]) {
    if (b.type !== 'exitpopup') continue;
    const code = String(b.props?.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!code || T.coupons.exists({ userId: f.userId, code })) continue;
    const pct = Number(code.match(/(\d{1,2})$/)?.[1]) || 10;
    T.coupons.insert({ id: uid(), userId: f.userId, code, type: 'percent', value: Math.min(pct, 90), active: true, uses: 0, auto: true, createdAt: Date.now() });
  }
}

const createFunnel = (userId, data) => {
  const f = { id: uid(), userId, name: data.name, slug: uniqueSlug(data.name), published: false, theme: data.theme, steps: data.steps, createdAt: Date.now(), updatedAt: Date.now() };
  tx(() => { T.funnels.insert(f); ensurePopupCoupons(f); });
  return f;
};

app.get('/api/funnels', auth, (req, res) => {
  const since = Date.now() - 30 * DAY;
  const stats = totalsByFunnel(req.user.id, since, Date.now());
  res.json(T.funnels.all({ userId: req.user.id }, { order: 'updatedAt', desc: true }).map((f) => ({
    id: f.id, name: f.name, slug: f.slug, published: f.published, theme: f.theme, steps: f.steps.map((s) => ({ id: s.id, name: s.name, type: s.type })), hero: f.steps[0]?.blocks.find((b) => b.type === 'hero') || null, createdAt: f.createdAt, updatedAt: f.updatedAt, stats: stats(f.id),
  })));
});

app.post('/api/funnels', auth, (req, res) => {
  const name = req.body.name || 'Untitled funnel';
  res.json(createFunnel(req.user.id, {
    name, theme: { style: 'aurora', primary: '#6366f1', secondary: '#ec4899' },
    steps: [{ id: uid(), name: 'Landing page', type: 'landing', slug: 'start', blocks: [{ id: uid(), type: 'hero', props: { badge: '⭐ Trusted by 10,000+ customers', headline: 'Your big promise — *the result they want*', subheadline: 'One sentence that makes your visitor want it.', ctaText: 'Get Started', secondaryText: 'See how it works', socialText: 'Loved by 10,000+ customers', rating: 4.9, reviews: '2,300', image: '', cardEmoji: '🚀', cardTitle: name, cardPrice: '₹499', cardMrp: '₹1,999', cardPoints: [{ text: 'Key benefit one' }, { text: 'Key benefit two' }], chip1: '🔥 120 joined today', chip2: '🔒 Secure payment' } }] }],
  }));
});

app.get('/api/funnels/:id', auth, (req, res) => { const f = owned(req, res); if (f) res.json(f); });

// ---------- version history ----------
// A restore point is the state *before* a burst of edits; bursts within 60s share one point.
const REV_KEEP = 40;
function snapshot(f, label, force = false) {
  const last = q('SELECT at FROM revisions WHERE funnelId = ? ORDER BY at DESC LIMIT 1').get(f.id);
  if (!force && last && Date.now() - last.at < 60000) return;
  T.revisions.insert({ id: uid(), funnelId: f.id, userId: f.userId, at: Date.now(), label: label || 'Edits', data: structuredClone({ name: f.name, theme: f.theme, steps: f.steps }) });
  q(`DELETE FROM revisions WHERE id IN (SELECT id FROM revisions WHERE funnelId = ? ORDER BY at DESC LIMIT -1 OFFSET ${REV_KEEP})`).run(f.id);
}

// Optimistic concurrency: clients send the version they edited; a stale version gets 409 + the latest copy
app.put('/api/funnels/:id', auth, (req, res) => {
  const f = owned(req, res);
  if (!f) return;
  f.version ||= 1;
  if (req.body.baseVersion != null && Number(req.body.baseVersion) !== f.version) {
    return res.status(409).json({ error: 'This funnel was changed somewhere else (another tab, device or teammate).', funnel: f });
  }
  tx(() => {
    const contentChange = ['name', 'steps', 'theme'].some((k) => k in req.body && JSON.stringify(req.body[k]) !== JSON.stringify(f[k]));
    if (contentChange) snapshot(f);
    for (const k of ['name', 'steps', 'theme', 'published']) if (k in req.body) f[k] = req.body[k];
    if ('steps' in req.body) ensurePopupCoupons(f);
    f.version++;
    f.updatedAt = Date.now();
    T.funnels.put(f);
  });
  res.json(f);
});

app.get('/api/funnels/:id/revisions', auth, (req, res) => {
  const f = owned(req, res);
  if (!f) return;
  res.json(T.revisions.all({ funnelId: f.id }, { order: 'at', desc: true }).map((r) => ({ id: r.id, at: r.at, label: r.label, steps: r.data.steps.length, sections: r.data.steps.reduce((a, s) => a + s.blocks.length, 0), name: r.data.name })));
});
app.post('/api/funnels/:id/revisions/:rid/restore', auth, (req, res) => {
  const f = owned(req, res);
  if (!f) return;
  const r = T.revisions.get(req.params.rid);
  if (!r || r.funnelId !== f.id) return res.status(404).json({ error: 'Version not found' });
  tx(() => {
    snapshot(f, 'Before restoring an older version', true);
    Object.assign(f, structuredClone(r.data));
    f.version = (f.version || 1) + 1;
    f.updatedAt = Date.now();
    ensurePopupCoupons(f);
    T.funnels.put(f);
  });
  res.json(f);
});

// ---------- image uploads ----------
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
// Optional CDN in front of /uploads (e.g. Cloudflare / CloudFront pulling from this server)
const CDN_URL = /^https:\/\/[^\s"'<>]+$/.test(process.env.CDN_URL || '') ? process.env.CDN_URL.replace(/\/+$/, '') : '';
globalThis.__FF_CDN__ = CDN_URL; // read by the server renderer
const IMG_TYPES = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'image/avif': 'avif' };
const MAGIC = { png: [0x89, 0x50, 0x4e, 0x47], jpg: [0xff, 0xd8, 0xff], gif: [0x47, 0x49, 0x46], webp: [0x52, 0x49, 0x46, 0x46] };
app.post('/api/uploads', auth, rateLimit({ windowMs: 60000, max: isTest ? 500 : 30, key: (req) => req.user.id }), (req, res) => {
  const ext = IMG_TYPES[req.body.type];
  if (!ext) return res.status(400).json({ error: 'Please upload a PNG, JPG, WebP, GIF or AVIF image' });
  const buf = Buffer.from(String(req.body.data || '').replace(/^data:[^,]+,/, ''), 'base64');
  if (!buf.length) return res.status(400).json({ error: 'Empty file' });
  if (buf.length > 5 * 1024 * 1024) return res.status(413).json({ error: 'Images must be 5 MB or smaller' });
  // check the bytes really are that image type (not a renamed script)
  if (MAGIC[ext] && !MAGIC[ext].every((b, i) => buf[i] === b)) return res.status(400).json({ error: 'That file does not look like a valid image' });
  if (ext === 'webp' && buf.toString('latin1', 8, 12) !== 'WEBP') return res.status(400).json({ error: 'That file does not look like a valid image' });
  // optional phone-sized copy from the editor's optimiser → served through srcset
  const small = ext === 'webp' && req.body.small ? Buffer.from(String(req.body.small).replace(/^data:[^,]+,/, ''), 'base64') : null;
  const smallOk = small && small.length && small.length <= 1024 * 1024 && small.toString('latin1', 0, 4) === 'RIFF' && small.toString('latin1', 8, 12) === 'WEBP';
  const dir = path.join(UPLOAD_DIR, req.user.id);
  fs.mkdirSync(dir, { recursive: true });
  const base = `${Date.now().toString(36)}-${uid()}`;
  const name = smallOk ? `${base}.v.webp` : `${base}.${ext}`;
  fs.writeFileSync(path.join(dir, name), buf);
  if (smallOk) fs.writeFileSync(path.join(dir, `${base}.v-800.webp`), small);
  res.json({ url: `/uploads/${req.user.id}/${name}`, bytes: buf.length });
});
app.use('/uploads', express.static(UPLOAD_DIR, { maxAge: '30d', immutable: true, setHeaders: (res) => res.setHeader('Content-Security-Policy', "default-src 'none'") }));

app.post('/api/funnels/:id/duplicate', auth, (req, res) => {
  const f = owned(req, res);
  if (!f) return;
  const copy = structuredClone(f);
  copy.steps.forEach((s) => { s.id = uid(); s.blocks.forEach((b) => { b.id = uid(); }); });
  res.json(createFunnel(req.user.id, { name: `${f.name} (copy)`, theme: copy.theme, steps: copy.steps }));
});

function deleteFunnel(f) {
  tx(() => {
    T.funnels.del(f.id);
    for (const t of ['leads', 'orders', 'abandoned', 'revisions']) T[t].delWhere({ funnelId: f.id });
    q('DELETE FROM events WHERE funnelId = ?').run(f.id);
  });
  renderCache.clear();
}
app.delete('/api/funnels/:id', auth, (req, res) => {
  const f = owned(req, res);
  if (!f) return;
  deleteFunnel(f);
  res.json({ ok: true });
});

// ---------- analytics ----------
const range = (req) => reportRange(Math.min(365, Math.max(1, Number(req.query.days) || 30)));

app.get('/api/analytics/overview', auth, (req, res) => {
  const { days, from, to } = range(req);
  const scope = { userId: req.user.id };
  const funnels = T.funnels.all({ userId: req.user.id });
  const name = Object.fromEntries(funnels.map((f) => [f.id, f.name]));
  const per = totalsByFunnel(req.user.id, from, to);
  res.json({
    days, totals: totals(scope, from, to), prev: totals(scope, from - days * DAY, from), series: series(scope, from, days), sources: sources(scope, from), byKind: revenueByKind(scope, from),
    funnels: funnels.map((f) => ({ id: f.id, name: f.name, published: f.published, ...per(f.id) })).sort((a, b) => b.revenue - a.revenue),
    recentOrders: T.orders.all({ userId: req.user.id }, { order: 'at', desc: true, limit: 8 }).filter((o) => name[o.funnelId]).map((o) => ({ ...o, funnel: name[o.funnelId] })),
  });
});

app.get('/api/funnels/:id/analytics', auth, (req, res) => {
  const f = owned(req, res);
  if (!f) return;
  const { days, from, to } = range(req);
  const scope = { funnelId: f.id };
  const count = stepCounts(f.id, from);
  res.json({
    days, totals: totals(scope, from, to), prev: totals(scope, from - days * DAY, from), series: series(scope, from, days), sources: sources(scope, from), byKind: revenueByKind(scope, from),
    bumpRate: bumpRate(f.id, from),
    steps: f.steps.map((s) => ({
      id: s.id, name: s.name, type: s.type, views: count(s.id, 'view'), conversions: count(s.id, 'convert'),
      ab: s.ab?.enabled ? (() => {
        const A = { views: count(s.id, 'view', 'A'), conversions: count(s.id, 'convert', 'A') };
        const B = { views: count(s.id, 'view', 'B'), conversions: count(s.id, 'convert', 'B') };
        return { A, B, result: abResult(A, B) };
      })() : null,
    })),
    leads: T.leads.all({ funnelId: f.id }, { order: 'at', desc: true, limit: 50 }),
    orders: T.orders.all({ funnelId: f.id }, { order: 'at', desc: true, limit: 50 }),
  });
});

// ---------- CRM ----------
registerCrm(app, { auth, rateLimit, isTest, onEvent: fireAutomation });
registerChannels(app, { auth, wrap, rateLimit, isTest });
registerRazorpaySettings(app, { auth, wrap });
registerDomains(app, { auth });
registerAutomations(app, { auth, secret: SECRET, appUrl, rateLimit, isTest });
registerHive(app, { auth, sign, port: process.env.PORT || 4000, rateLimit, isTest, appUrl, credits: credits('hive') });
registerBilling(app, { auth, wrap, rateLimit, isTest });
registerAdmin(app, { auth, wrap, signAs });
registerAccount(app, { auth, rateLimit, isTest });

const ORDERS_MAX = 5000; // newest first; CSV export covers the same list
app.get('/api/orders', auth, (req, res) => {
  const name = Object.fromEntries(T.funnels.all({ userId: req.user.id }).map((f) => [f.id, f.name]));
  res.json({
    orders: T.orders.all({ userId: req.user.id }, { order: 'at', desc: true, limit: ORDERS_MAX }).filter((o) => name[o.funnelId]).map((o) => ({ ...o, funnel: name[o.funnelId] })),
    abandoned: T.abandoned.all({ userId: req.user.id, recovered: 0 }, { order: 'at', desc: true, limit: ORDERS_MAX }).filter((a) => name[a.funnelId]).map((a) => ({ ...a, funnel: name[a.funnelId] })),
  });
});

// ---------- public site: prices and company details for the landing, pricing and policy pages ----------
app.get('/api/site', (_, res) => {
  const p = platform(), pr = pricing();
  res.json({ brand: p.brand, googleClientId: googleClientId() || null, trialDays: p.trialDays, aiCredits: p.aiCredits, signupsOpen: p.signupsOpen, prices: { monthly: pr.monthly.amount, yearly: pr.yearly.amount, yearlyPerMonth: pr.yearly.perMonth, yearlySaves: pr.yearlySaves }, gstRegistered: !!p.company.gstin, company: { name: p.company.name, email: p.company.email, address: p.company.address, state: p.company.state, gstin: p.company.gstin } });
});

// ---------- templates ----------
app.get('/api/templates', (_, res) => res.json(templateList()));
app.get('/api/templates/:tid', (req, res) => { const t = getTemplate(req.params.tid); t ? res.json(t) : res.status(404).json({ error: 'Not found' }); });
app.post('/api/templates/:tid/use', auth, (req, res) => {
  const t = getTemplate(req.params.tid);
  if (!t) return res.status(404).json({ error: 'Not found' });
  res.json(createFunnel(req.user.id, { name: t.name, theme: t.theme, steps: t.steps }));
});

// ---------- AI ----------
app.post('/api/ai/generate', auth, aiLimiter, credits('generate'), wrap(async (req, res) => {
  const { prompt } = req.body;
  if (!prompt || prompt.length < 5) return res.status(400).json({ error: 'Describe your business or offer in a sentence' });
  const gen = aiEnabled() ? await generateFunnel(prompt) : matchTemplate(prompt);
  const usedAI = aiEnabled() && !gen.fallback;
  const quality = gen.quality;
  delete gen.fallback; delete gen.quality;
  const f = createFunnel(req.user.id, gen);
  if (quality) { f.aiQuality = { ...quality, at: Date.now() }; T.funnels.put(f); }
  res.json({ ...f, usedAI, quality });
}));

app.post('/api/ai/edit', auth, aiLimiter, credits('edit'), wrap(async (req, res) => {
  const f = ownFunnel(req, req.body.funnelId);
  const step = f?.steps.find((s) => s.id === req.body.stepId);
  if (!step) return res.status(404).json({ error: 'Step not found' });
  res.json({ blocks: await editBlocks(step, f.theme, req.body.instruction) });
}));

// Conversational builder: the model (or offline parser) returns actions which we apply to the funnel
app.post('/api/ai/chat', auth, aiLimiter, credits('chat'), wrap(async (req, res) => {
  if (!ownFunnel(req, req.body.funnelId)) return res.status(404).json({ error: 'Funnel not found' });
  const { message, stepId, history } = req.body;
  if (!message?.trim()) return res.status(400).json({ error: 'Say something 🙂' });
  const out = aiEnabled() ? await chatAI(ownFunnel(req, req.body.funnelId), stepId, message, history) : offlineChat(message, ownFunnel(req, req.body.funnelId), stepId);
  // the AI call took a while: apply its changes to the latest copy of the funnel
  const f = ownFunnel(req, req.body.funnelId);
  if (!f) return res.status(404).json({ error: 'Funnel not found' });
  const before = structuredClone({ name: f.name, theme: f.theme, steps: f.steps });
  const changes = [...new Set(applyActions(f, out.actions || [], stepId))];
  if (changes.length) {
    tx(() => {
      T.revisions.insert({ id: uid(), funnelId: f.id, userId: f.userId, at: Date.now(), label: `Before AI: “${message.slice(0, 60)}”`, data: before });
      f.version = (f.version || 1) + 1;
      f.updatedAt = Date.now();
      ensurePopupCoupons(f);
      T.funnels.put(f);
    });
  }
  const reply = out.reply || (changes.length ? `Done! ${changes.join(' · ')}. Anything else?` : 'I could not find anything to change there.');
  res.json({ reply, changes, funnel: f, usedAI: aiEnabled() });
}));

app.get('/api/ai/agents', auth, (_, res) => res.json(AGENTS));
app.post('/api/ai/agent', auth, aiLimiter, credits('agent'), wrap(async (req, res) => {
  const { kind, funnelId, extra } = req.body;
  if (!AGENTS[kind]) return res.status(400).json({ error: 'Unknown agent' });
  const f = ownFunnel(req, funnelId) || T.funnels.find({ userId: req.user.id });
  const hero = f?.steps.flatMap((s) => s.blocks).find((b) => b.type === 'hero')?.props || {};
  const price = f?.steps.flatMap((s) => s.blocks).find((b) => b.type === 'checkout' || b.type === 'pricing')?.props.price || 999;
  const ctx = { product: f?.name || req.body.product || 'your product', price, headline: (hero.headline || f?.name || '').replace(/\*/g, ''), audience: req.body.audience || 'people', extra };
  res.json(await runAgent(kind, ctx));
}));

// ---------- demo data (so analytics are meaningful from minute one) ----------
// Every demo record is tagged demo=1 so it can be removed later.
app.post('/api/demo/seed', auth, (req, res) => {
  const userId = req.user.id;
  tx(() => {
    if (!T.funnels.exists({ userId })) for (const id of ['yoga', 'skincare']) { const t = getTemplate(id); const f = createFunnel(userId, { name: t.name, theme: t.theme, steps: t.steps }); f.demo = true; T.funnels.put(f); }
    const SRC = ['facebook', 'facebook', 'instagram', 'instagram', 'google', 'youtube', 'whatsapp', 'direct', 'direct', 'email'];
    const NAMES = ['Rahul Sharma', 'Priya Mehta', 'Ankit Patel', 'Sneha Reddy', 'Vikram Joshi', 'Anjali Kapoor', 'Rohit Das', 'Neha Gupta', 'Arjun Verma', 'Pooja Nair', 'Karan Bhatia', 'Divya Iyer', 'Aman Khan', 'Kavya Rao'];
    const now = Date.now();
    const pick = (a) => a[Math.floor(Math.random() * a.length)];
    const events = [];
    const ev = (e) => events.push({ ...e, userId, demo: true });
    for (const f of T.funnels.all({ userId })) {
      f.published = true;
      T.funnels.put(f);
      const base = { funnelId: f.id, userId, demo: true };
      const land = f.steps[0], co = f.steps.find((s) => s.type === 'checkout'), up = f.steps.find((s) => s.type === 'upsell'), down = f.steps.find((s) => s.type === 'downsell'), ty = f.steps.find((s) => s.type === 'thankyou');
      const chk = co?.blocks.find((b) => b.type === 'checkout')?.props;
      const upP = up?.blocks.find((b) => b.type === 'offer')?.props, downP = down?.blocks.find((b) => b.type === 'offer')?.props;
      for (let d = 59; d >= 0; d--) {
        const visitors = Math.round((40 + Math.random() * 50) * (1 + (59 - d) / 70));
        for (let v = 0; v < visitors; v++) {
          const at = now - d * DAY - Math.random() * DAY;
          const source = pick(SRC), visitor = uid();
          ev({ funnelId: f.id, stepId: land.id, type: 'view', at, source, visitor });
          if (Math.random() > 0.22) continue;
          const nm = pick(NAMES), email = `${nm.split(' ')[0].toLowerCase()}.${uid().slice(0, 4)}@gmail.com`;
          ev({ funnelId: f.id, stepId: land.id, type: 'convert', at: at + 6e4, source, visitor });
          if (Math.random() < 0.35) ev({ funnelId: f.id, stepId: land.id, type: 'view', at: Math.min(Date.now() - 6e4, at + DAY * (0.5 + Math.random() * 3)), source: pick(SRC), visitor });
          if (!chk) { T.leads.insert({ id: uid(), ...base, stepId: land.id, email, name: nm, phone: '', source, visitor, at: at + 6e4 }); if (ty) ev({ funnelId: f.id, stepId: ty.id, type: 'view', at: at + 7e4, source, visitor }); continue; }
          ev({ funnelId: f.id, stepId: co.id, type: 'view', at: at + 7e4, source, visitor });
          if (Math.random() > 0.38) { if (Math.random() < 0.5) T.abandoned.insert({ id: uid(), ...base, stepId: co.id, email, name: nm, phone: '', visitor, at: at + 8e4, recovered: false }); continue; }
          const items = [{ name: chk.productName, price: Number(chk.price), kind: 'main' }];
          if (chk.bumpEnabled && Math.random() < 0.35) items.push({ name: chk.bumpTitle, price: Number(chk.bumpPrice), kind: 'bump' });
          ev({ funnelId: f.id, stepId: co.id, type: 'convert', at: at + 9e4, source, visitor });
          if (up && upP) {
            ev({ funnelId: f.id, stepId: up.id, type: 'view', at: at + 1e5, source, visitor });
            if (Math.random() < 0.24) { items.push({ name: upP.productName, price: Number(upP.price), kind: 'upsell' }); ev({ funnelId: f.id, stepId: up.id, type: 'convert', at: at + 1.1e5, source, visitor }); }
            else if (down && downP) {
              ev({ funnelId: f.id, stepId: down.id, type: 'view', at: at + 1.2e5, source, visitor });
              if (Math.random() < 0.3) { items.push({ name: downP.productName, price: Number(downP.price), kind: 'downsell' }); ev({ funnelId: f.id, stepId: down.id, type: 'convert', at: at + 1.3e5, source, visitor }); }
            }
          }
          const cs = ty?.blocks.find((b) => b.type === 'crosssell')?.props;
          if (ty) ev({ funnelId: f.id, stepId: ty.id, type: 'view', at: at + 1.4e5, source, visitor });
          if (cs && Math.random() < 0.12) { const it = pick(cs.items); items.push({ name: it.name, price: Number(it.price), kind: 'crosssell' }); }
          items.forEach((it, n) => { it.at = at + 9e4 + n * 1e4; });
          T.orders.insert({ id: uid(), ...base, email, name: nm, phone: '', items, total: items.reduce((a, i) => a + i.price, 0), source, visitor, at: at + 9e4, status: 'paid' });
        }
      }
    }
    Events.addMany(events);
  });
  renderCache.clear();
  res.json({ ok: true });
});

app.delete('/api/demo', auth, (req, res) => {
  const userId = req.user.id;
  const removed = demoCount(userId);
  let demoFunnels = 0;
  tx(() => {
    q('DELETE FROM events WHERE userId = ? AND demo = 1').run(userId);
    for (const t of ['orders', 'leads', 'abandoned']) T[t].delWhere({ userId, demo: 1 });
    // Funnels the seeder created (and nothing else) are removed too
    for (const f of T.funnels.all({ userId })) if (f.demo) { deleteFunnel(f); demoFunnels++; }
  });
  res.json({ removed: { ...removed, funnels: demoFunnels } });
});

// ---------- public funnel runtime ----------
// a funnel is live when it's published and its owner's account still serves pages
const live = (f, preview) => f && (f.published || preview) && accessFor(T.users.get(f.userId)).pagesLive;
const pub = (req, res) => {
  const f = T.funnels.find({ slug: req.params.slug });
  if (!live(f, req.query.preview === '1')) { res.status(404).json({ error: 'This page is not available right now.' }); return null; }
  return f;
};
const isPreview = (req) => req.query.preview === '1';
const allBlocks = (s) => [...s.blocks, ...(s.ab?.blocks || [])];

// Templates ship with a placeholder WhatsApp number. On live pages it becomes the seller's
// "Support WhatsApp" from Settings; with none set, the button is hidden instead of linking nowhere.
export const WA_PLACEHOLDER = '919999999999';
const waDigits = (n) => { const d = String(n || '').replace(/\D/g, '').replace(/^0+/, ''); return d.length === 10 ? `91${d}` : d.length >= 11 ? d : ''; };
function resolveWhatsApp(steps, supportNumber) {
  const support = waDigits(supportNumber);
  const fix = (blocks) => blocks.flatMap((b) => {
    if (b.type !== 'whatsapp') return [b];
    const own = waDigits(b.props?.number);
    const number = !own || own === WA_PLACEHOLDER ? support : own;
    return number ? [{ ...b, props: { ...b.props, number } }] : [];
  });
  return steps.map((s) => ({ ...s, blocks: fix(s.blocks), ...(s.ab ? { ab: { ...s.ab, blocks: fix(s.ab.blocks || []) } } : {}) }));
}

function publicData(f, owner = T.users.get(f.userId)) {
  return { name: f.name, slug: f.slug, theme: f.theme, steps: resolveWhatsApp(f.steps, owner?.settings?.supportWhatsapp), tracking: owner?.settings?.tracking || {} };
}
app.get('/api/public/:slug', (req, res) => {
  const f = pub(req, res);
  if (f) res.json(publicData(f));
});

app.post('/api/public/:slug/event', (req, res) => {
  const f = pub(req, res);
  if (!f) return;
  const { stepId, type, variant, source, visitor } = req.body;
  if (!isPreview(req) && ['view', 'convert'].includes(type) && f.steps.some((s) => s.id === stepId)) {
    Events.add({ userId: f.userId, funnelId: f.id, stepId, type, variant: variant === 'B' ? 'B' : 'A', source: String(source || 'direct').slice(0, 40), visitor: typeof visitor === 'string' ? visitor.slice(0, 64) : null, at: Date.now() });
  }
  res.json({ ok: true });
});

const visitorOf = (req) => (typeof req.body.visitor === 'string' && /^[\w-]{4,64}$/.test(req.body.visitor) ? req.body.visitor : undefined);
app.post('/api/public/:slug/lead', (req, res) => {
  const f = pub(req, res);
  if (!f) return;
  const { email, name, phone, stepId, source } = req.body;
  const cleanEmail = String(email || '').trim().slice(0, 200);
  const cleanPhone = String(phone || '').trim().slice(0, 40);
  if (cleanEmail && !EMAIL_RE.test(cleanEmail)) return res.status(400).json({ error: 'Please enter a valid email address' });
  if (!cleanEmail && !cleanPhone) return res.status(400).json({ error: 'Please enter your email or phone number' });
  // Custom form answers: at most 30 fields, 2,000 characters each
  const fields = {};
  if (req.body.fields && typeof req.body.fields === 'object') {
    for (const [k, v] of Object.entries(req.body.fields).slice(0, 30)) fields[String(k).slice(0, 80)] = typeof v === 'boolean' ? v : String(v ?? '').slice(0, 2000);
  }
  const lead = { id: uid(), userId: f.userId, funnelId: f.id, stepId, email: cleanEmail, name: String(name || '').slice(0, 120), phone: cleanPhone, source: String(source || 'direct').slice(0, 40), visitor: visitorOf(req), at: Date.now(), ...(Object.keys(fields).length ? { fields } : {}) };
  if (!isPreview(req)) {
    T.leads.insert(lead);
    const { userId, ...out } = lead;
    fireWebhook(f.userId, 'lead.created', { funnel: f.name, ...out });
    fireAutomation(f.userId, 'lead', { email: lead.email, phone: lead.phone, name: lead.name, funnelId: f.id, source: lead.source });
  }
  res.json({ ok: true });
});

app.post('/api/public/:slug/abandon', (req, res) => {
  const f = pub(req, res);
  if (!f) return;
  const { email, name, phone, stepId } = req.body;
  const ckey = contactKey(email);
  if (!isPreview(req) && email && EMAIL_RE.test(String(email)) && !T.orders.exists({ funnelId: f.id, ckey })) {
    const ex = T.abandoned.find({ funnelId: f.id, ckey });
    if (ex) T.abandoned.put(Object.assign(ex, { name: name || ex.name, phone: phone || ex.phone, visitor: ex.visitor || visitorOf(req), at: Date.now() }));
    else T.abandoned.insert({ id: uid(), userId: f.userId, funnelId: f.id, stepId, email: String(email).slice(0, 200), name: String(name || '').slice(0, 120), phone: String(phone || '').slice(0, 40), visitor: visitorOf(req), at: Date.now(), recovered: false });
  }
  res.json({ ok: true });
});

// Finds a usable coupon for this funnel; { coupon } or { reason } explaining why not
function couponFor(f, code, { email, subtotal } = {}) {
  const c = T.coupons.find({ userId: f.userId, code: String(code || '').trim().toUpperCase() });
  if (!c || !c.active) return { reason: 'That code isn’t valid' };
  if (c.expiresAt && Date.now() > c.expiresAt) return { reason: 'This code has expired' };
  if (c.maxUses && c.uses >= c.maxUses) return { reason: 'This code has reached its usage limit' };
  if (c.funnelIds?.length && !c.funnelIds.includes(f.id)) return { reason: 'This code can’t be used for this product' };
  if (c.minOrder && subtotal != null && subtotal < c.minOrder) return { reason: `This code needs a minimum order of ₹${c.minOrder.toLocaleString('en-IN')}` };
  if (c.oncePerCustomer && email && T.orders.all({ userId: f.userId, ckey: contactKey(email) }).some((o) => o.coupon === c.code)) return { reason: 'You’ve already used this code' };
  return { coupon: c };
}
// Never more than the price, never negative
const discountFor = (c, price) => Math.max(0, Math.min(price, c.type === 'percent' ? Math.round((price * Math.min(100, c.value)) / 100) : Math.round(c.value)));
const checkoutPrice = (f, stepId) => {
  const step = f.steps.find((s) => s.id === stepId) || f.steps.find((s) => allBlocks(s).some((b) => b.type === 'checkout'));
  const b = step && allBlocks(step).find((x) => x.type === 'checkout');
  return b ? Number(b.props.price) || 0 : null;
};
app.post('/api/public/:slug/coupon', (req, res) => {
  const f = pub(req, res);
  if (!f) return;
  const r = couponFor(f, req.body.code, { email: req.body.email, subtotal: checkoutPrice(f, req.body.stepId) });
  if (!r.coupon) return res.json({ valid: false, reason: r.reason });
  const c = r.coupon;
  res.json({ valid: true, code: c.code, type: c.type, value: c.value, ...(c.minOrder ? { minOrder: c.minOrder } : {}) });
});

const previewOrders = [];
// What this request charges: the main product (+ bump, coupon), an upsell / downsell, or a cross-sell item.
// Prices always come from the funnel itself — never from the browser.
function buildCharge(f, body) {
  const { stepId, email, withBump, coupon, blockId, itemIndex } = body;
  const step = f.steps.find((s) => s.id === stepId);
  if (!step) return { status: 400, error: 'Bad step' };
  const blocks = allBlocks(step);
  const items = [];
  let discount = 0, usedCoupon = null, couponObj = null;
  if (blockId) {
    const cs = blocks.find((b) => b.id === blockId && b.type === 'crosssell');
    const it = cs?.props.items?.[itemIndex];
    if (!it) return { status: 400, error: 'Item not found' };
    items.push({ name: it.name, price: Number(it.price) || 0, kind: 'crosssell' });
  } else {
    const b = blocks.find((x) => x.type === 'checkout' || x.type === 'offer');
    if (!b) return { status: 400, error: 'Nothing to buy on this step' };
    const p = b.props;
    if (b.type === 'checkout') {
      const price = Number(p.price) || 0;
      if (coupon) {
        const r = couponFor(f, coupon, { email, subtotal: price });
        // never charge a different amount than the shopper saw: a code that stopped working is reported, not ignored
        if (!r.coupon) return { status: 400, error: `${r.reason} — remove it to continue`, coupon: false };
        discount = discountFor(r.coupon, price); usedCoupon = r.coupon.code; couponObj = r.coupon;
      }
      items.push({ name: p.productName, price: price - discount, kind: 'main' });
      if (withBump && p.bumpEnabled) items.push({ name: p.bumpTitle, price: Number(p.bumpPrice) || 0, kind: 'bump' });
    } else items.push({ name: p.productName || p.headline, price: Number(p.price) || 0, kind: step.type === 'downsell' ? 'downsell' : 'upsell' });
  }
  return { step, items, total: items.reduce((a, i) => a + i.price, 0), discount, usedCoupon, couponObj };
}
// Records a paid charge: a new order, or more items on the buyer's order (upsells, cross-sells)
function recordOrder(f, charge, buyer, { orderId, preview, payment } = {}) {
  const now = Date.now();
  const items = charge.items.map((i) => ({ ...i, at: now, ...(payment ? { paymentId: payment.id } : {}) }));
  let order;
  if (preview) {
    // Preview orders live in a throwaway in-memory list and can never touch real orders, carts or coupons
    order = orderId && previewOrders.find((o) => o.id === orderId && o.funnelId === f.id);
    if (order) { order.items.push(...items); order.total += charge.total; }
    else { order = { id: `pv-${uid()}`, funnelId: f.id, email: buyer.email || '', name: buyer.name || '', phone: buyer.phone || '', items, total: charge.total, coupon: charge.usedCoupon, discount: charge.discount, source: buyer.source || 'direct', visitor: buyer.visitor, status: 'paid', at: now }; previewOrders.push(order); }
    while (previewOrders.length > 500) previewOrders.shift();
  } else {
    tx(() => {
      if (charge.couponObj) T.coupons.update(charge.couponObj.id, (c) => { c.uses = (c.uses || 0) + 1; });
      const ex = orderId && T.orders.get(orderId);
      if (ex && ex.funnelId === f.id) { order = ex; order.items.push(...items); order.total += charge.total; T.orders.put(order); }
      else {
        order = T.orders.insert({ id: uid(), userId: f.userId, funnelId: f.id, email: buyer.email || '', name: buyer.name || '', phone: buyer.phone || '', items, total: charge.total, coupon: charge.usedCoupon, discount: charge.discount, source: buyer.source || 'direct', visitor: buyer.visitor, status: 'paid', at: now, ...(payment ? { provider: payment.provider, mode: payment.mode } : {}) });
        if (buyer.email) for (const a of T.abandoned.all({ funnelId: f.id, ckey: contactKey(buyer.email) })) { a.recovered = true; T.abandoned.put(a); }
      }
    });
    const updated = order.items.length > items.length;
    const { userId, ...out } = order;
    fireWebhook(f.userId, updated ? 'order.updated' : 'order.created', { funnel: f.name, ...out });
    fireAutomation(f.userId, updated ? 'offer' : 'purchase', { email: order.email, phone: order.phone, name: order.name, funnelId: f.id, product: items[0]?.name, amount: charge.total, source: order.source });
  }
  // `added` is what this request charged — pixels report that, so upsells aren't double-counted
  return { orderId: order.id, total: order.total, added: charge.total, txn: `${order.id}-${order.items.length}`, discount: charge.discount, preview };
}
const ownerOf = (f) => T.users.get(f.userId);
const buyerOf = (req, b = req.body) => ({ email: String(b.email || '').trim().slice(0, 200), name: String(b.name || '').slice(0, 120), phone: String(b.phone || '').slice(0, 40), source: String(b.source || 'direct').slice(0, 40), visitor: visitorOf(req) });

// Demo / preview checkout (no payment provider). Refused once real payments are connected,
// so nobody can create "paid" orders without paying.
app.post('/api/public/:slug/order', (req, res) => {
  const f = pub(req, res);
  if (!f) return;
  const preview = isPreview(req);
  if (!preview && rzpCreds(ownerOf(f))) return res.status(409).json({ error: 'This funnel takes payments through Razorpay', provider: 'razorpay' });
  const charge = buildCharge(f, req.body);
  if (charge.error) return res.status(charge.status).json(charge);
  res.json(recordOrder(f, charge, buyerOf(req), { orderId: req.body.orderId, preview }));
});

// ---------- Razorpay ----------
function finalizePayment(pay, paymentId) {
  if (pay.status === 'paid') return pay.result;
  const f = T.funnels.get(pay.funnelId);
  if (!f) return null;
  pay.status = 'paid'; pay.paymentId = paymentId; pay.paidAt = Date.now();
  const charge = { ...pay.charge, couponObj: pay.charge.usedCoupon ? T.coupons.find({ userId: f.userId, code: pay.charge.usedCoupon }) : null };
  pay.result = recordOrder(f, charge, pay.buyer, { orderId: pay.orderId, payment: { id: paymentId, provider: 'razorpay', mode: pay.mode } });
  T.payments.put(pay);
  return pay.result;
}
// 1. Start: decide the amount on the server and open a Razorpay order for it
app.post('/api/public/:slug/pay/start', wrap(async (req, res) => {
  const f = pub(req, res);
  if (!f) return;
  const preview = isPreview(req);
  const owner = ownerOf(f);
  const creds = rzpCreds(owner);
  if (preview || !creds) return res.json({ provider: 'demo' });
  const charge = buildCharge(f, req.body);
  if (charge.error) return res.status(charge.status).json(charge);
  const buyer = buyerOf(req);
  const prev = req.body.orderId && T.orders.get(req.body.orderId);
  const orderId = prev && prev.funnelId === f.id ? prev.id : undefined;
  if (orderId && !buyer.email) Object.assign(buyer, { email: prev.email, name: prev.name, phone: prev.phone });
  // nothing to charge (e.g. a 100% coupon): record it straight away
  if (charge.total <= 0) return res.json({ provider: 'free', ...recordOrder(f, charge, buyer, { orderId }) });
  const pay = { id: uid(), userId: f.userId, funnelId: f.id, stepId: charge.step.id, orderId, buyer, charge: { items: charge.items, total: charge.total, discount: charge.discount, usedCoupon: charge.usedCoupon }, mode: creds.mode, status: 'created', at: Date.now() };
  let rzp;
  try { rzp = await rzpCreateOrder(creds, { amount: Math.round(charge.total * 100), receipt: pay.id, notes: { funnel: f.name.slice(0, 200), payment: pay.id } }); } catch (e) {
    console.error('Razorpay order failed', e.message);
    return res.status(502).json({ error: 'Payments are temporarily unavailable — please try again in a minute' });
  }
  pay.rzpOrderId = rzp.id;
  T.payments.insert(pay);
  const s = owner.settings || {};
  res.json({
    provider: 'razorpay', payment: pay.id, key: creds.keyId, order_id: rzp.id, amount: rzp.amount, currency: rzp.currency || 'INR',
    name: s.businessName || f.name, description: charge.items.map((i) => i.name).join(' + ').slice(0, 250),
    prefill: { name: buyer.name, email: buyer.email, contact: buyer.phone }, color: f.theme?.primary || '#6366f1',
  });
}));
// 2. Verify: the browser sends Razorpay's signed result; only a valid signature creates the paid order
app.post('/api/public/:slug/pay/verify', (req, res) => {
  const f = pub(req, res);
  if (!f) return;
  const pay = T.payments.get(req.body.payment);
  if (!pay || pay.funnelId !== f.id) return res.status(404).json({ error: 'Payment not found' });
  const creds = rzpCreds(ownerOf(f));
  const { razorpay_order_id: oid, razorpay_payment_id: pid, razorpay_signature: sig } = req.body;
  if (!creds || oid !== pay.rzpOrderId || !validPayment(creds.secret, oid, pid, sig)) return res.status(400).json({ error: 'We couldn’t confirm this payment. If money was deducted it will be refunded automatically — please contact the seller.' });
  res.json(finalizePayment(pay, pid));
});
// 3. Webhook backup: Razorpay → /api/razorpay/webhook/<seller id>, signed with the webhook secret
app.post('/api/razorpay/webhook/:uid', (req, res) => {
  const owner = T.users.get(req.params.uid);
  const creds = owner && rzpCreds(owner);
  const raw = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : '';
  if (!creds?.webhookSecret || !validWebhook(creds.webhookSecret, raw, req.headers['x-razorpay-signature'])) return res.status(400).json({ error: 'Invalid signature' });
  let ev;
  try { ev = JSON.parse(raw); } catch { return res.status(400).json({ error: 'Bad JSON' }); }
  if (['payment.captured', 'order.paid'].includes(ev.event)) {
    const entity = ev.payload?.payment?.entity || {};
    const oid = entity.order_id || ev.payload?.order?.entity?.id;
    const pay = oid && T.payments.find({ rzpOrderId: oid, userId: owner.id });
    if (pay && entity.id) finalizePayment(pay, entity.id);
  }
  res.json({ ok: true }); // always 200 for events we don't use, so Razorpay doesn't retry them
});

// ---------- housekeeping ----------
// unpaid payment attempts are kept for 30 days; raw page-view events for 400 days (reports go back 365)
const EVENTS_KEEP_DAYS = Number(process.env.EVENTS_KEEP_DAYS || 400);
function housekeeping() {
  const now = Date.now();
  q("DELETE FROM payments WHERE status IS NOT 'paid' AND at < ?").run(now - 30 * DAY);
  // in batches so a large delete never holds the database for long
  for (let i = 0; i < 50; i++) if (!q('DELETE FROM events WHERE id IN (SELECT id FROM events WHERE at < ? ORDER BY at LIMIT 5000)').run(now - EVENTS_KEEP_DAYS * DAY).changes) break;
}
if (JOBS && !isTest) { setTimeout(housekeeping, 60000).unref(); setInterval(housekeeping, 6 * 3600000).unref(); }

// ---------- serve built client in production ----------
const CLIENT = path.join(path.dirname(fileURLToPath(import.meta.url)), '../client');
const dist = path.join(CLIENT, 'dist');
const indexHtml = fs.existsSync(path.join(dist, 'index.html')) ? fs.readFileSync(path.join(dist, 'index.html'), 'utf8') : null;
let ssr = null;
const ssrEntry = path.join(CLIENT, 'dist-ssr', 'entry-server.js');
if (fs.existsSync(ssrEntry)) {
  try { ssr = await import(pathToFileURL(ssrEntry).href); } catch (e) { console.error('SSR bundle failed to load — live pages will render in the browser only:', e.message); }
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const plain = (s) => String(s || '').replace(/\*/g, '').trim();

// Rendered live pages are cached (keyed by everything that changes their HTML), so a page shared on
// Instagram that gets thousands of visits is rendered once, not thousands of times.
const RENDER_CACHE_MAX = Number(process.env.RENDER_CACHE_MAX || 2000);
const renderCache = new Map();
const cacheGet = (k) => { const v = renderCache.get(k); if (v) { renderCache.delete(k); renderCache.set(k, v); } return v; };
const cacheSet = (k, v) => { renderCache.set(k, v); if (renderCache.size > RENDER_CACHE_MAX) renderCache.delete(renderCache.keys().next().value); };

// Live funnel pages are rendered on the server: crawlers and link previews (WhatsApp, Facebook,
// LinkedIn) see real content and meta tags, and visitors see the page before any JS runs.
app.get(['/f/:slug', '/f/:slug/:step'], (req, res, next) => {
  if (!indexHtml) return next();
  const f = T.funnels.find({ slug: req.params.slug });
  const preview = isPreview(req);
  if (!f || (!f.published && !preview)) return next();
  renderFunnel(req, res, f, req.params.step, { preview });
});
function renderFunnel(req, res, f, stepSlug, { domain = null, preview = false } = {}) {
  if (!indexHtml) return res.status(503).type('text').send('The app is not built yet');
  const owner = ownerOf(f);
  if (!accessFor(owner).pagesLive) return res.status(404).type('html').send('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Not available</title><p style="font:16px system-ui;padding:40px;text-align:center">This page isn’t available right now.</p>');
  const base = domain ? `https://${domain}` : appUrl(req);
  const key = JSON.stringify([f.id, f.version || 0, f.updatedAt, f.slug, stepSlug || '', domain, domainOfFunnel(f.id), preview, base, owner?.settings?.supportWhatsapp || '', owner?.settings?.tracking || {}]);
  let html = cacheGet(key);
  if (!html) {
    html = renderHtml(f, owner, stepSlug, { domain, preview, base });
    cacheSet(key, html);
  }
  res.set('Cache-Control', 'no-cache').type('html').send(html);
}
function renderHtml(f, owner, stepSlug, { domain, preview, base }) {
  const data = publicData(f, owner);
  const step = data.steps.find((s) => s.slug === stepSlug) || data.steps[0];
  const hero = step.blocks.find((b) => b.type === 'hero')?.props || data.steps[0].blocks.find((b) => b.type === 'hero')?.props || {};
  // Same rule as the browser: SEO title → this step's headline → step + funnel name
  const title = step.seo?.title || plain(step.blocks.find((b) => b.type === 'hero')?.props.headline) || `${step.name} · ${f.name}`;
  const desc = step.seo?.description || plain(hero.subheadline) || f.name;
  const img = hero.image ? (/^https?:/.test(hero.image) ? hero.image : (CDN_URL && hero.image.startsWith('/uploads/') ? CDN_URL : base) + hero.image) : '';
  // canonical address: the custom domain when one is connected
  const url = domain ? `${base}${step === data.steps[0] ? '/' : `/${step.slug}`}` : funnelUrl(f, base, step === data.steps[0] ? null : step.slug);
  const head = [
    `<title>${esc(title)}</title>`,
    `<meta name="description" content="${esc(desc)}">`,
    `<link rel="canonical" href="${esc(url)}">`,
    `<meta property="og:type" content="website">`,
    `<meta property="og:title" content="${esc(title)}">`,
    `<meta property="og:description" content="${esc(desc)}">`,
    `<meta property="og:url" content="${esc(url)}">`,
    `<meta property="og:site_name" content="${esc(f.name)}">`,
    img && `<meta property="og:image" content="${esc(img)}">`,
    `<meta name="twitter:card" content="${img ? 'summary_large_image' : 'summary'}">`,
    `<meta name="twitter:title" content="${esc(title)}">`,
    `<meta name="twitter:description" content="${esc(desc)}">`,
    img && `<meta name="twitter:image" content="${esc(img)}">`,
    `<meta name="theme-color" content="${esc(f.theme?.primary || '#6366f1')}">`,
    preview && '<meta name="robots" content="noindex">',
    CDN_URL && `<link rel="preconnect" href="${esc(CDN_URL)}"><script>window.__FF_CDN__=${JSON.stringify(CDN_URL)}</script>`,
    domain && `<script>window.__FF_DOMAIN__=${JSON.stringify(domain)}</script>`,
    ssr && `<link rel="stylesheet" href="${esc(ssr.fontHrefFor ? ssr.fontHrefFor(f.theme || {}) : ssr.fontHref(f.theme?.style || 'aurora'))}">`,
  ].filter(Boolean).join('\n    ');
  let body = '';
  // A/B steps are rendered in the browser so each visitor sees only their own variant
  if (ssr && !step.ab?.enabled) {
    try { body = ssr.renderFunnelPage({ blocks: step.blocks, theme: f.theme }); } catch (e) { console.error('SSR failed for', f.slug, e.message); }
  }
  const json = JSON.stringify(data).replace(/</g, '\\u003c').replace(new RegExp('[\\u2028\\u2029]', 'g'), '');
  return indexHtml
    .replace('<title>FunnelHive</title>', '')
    .replace('<!--ff-head-->', head)
    .replace('<!--ff-ssr-->', `${body}<script>window.__FUNNEL__=${json}</script>`);
}

if (indexHtml) {
  app.use(express.static(dist, { index: false }));
  app.get('*', (_, res) => res.type('html').send(indexHtml));
}

const port = process.env.PORT || 4000;
const worker = process.env.WORKER_INDEX;
app.listen(port, () => { if (!worker || worker === '0') console.log(`FunnelHive API on :${port} (AI ${aiEnabled() ? 'on' : 'off — offline assistant'}${ssr ? ', server rendering on' : ''}${worker ? `, ${process.env.WEB_CONCURRENCY} processes` : ''})`); });
