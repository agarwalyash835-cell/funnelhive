import express from 'express';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { db, save, uid, dir as DATA_DIR } from './db.js';
import { generateFunnel, editBlocks, aiEnabled, aiProvider, chatAI, AGENTS, runAgent } from './ai.js';
import { templateList, getTemplate, matchTemplate } from './templates.js';
import { applyActions, offlineChat } from './actions.js';
import { abResult } from './stats.js';
import { DAY, localDate, reportRange } from './time.js';
import { loadSecret, rateLimit, securityHeaders, randomToken, hashToken, newTotpSecret, verifyTotp, otpauthUrl } from './security.js';
import { sendMail, mailEnabled, appUrl } from './mail.js';
import { registerCrm } from './crm.js';
import { initMessaging, registerChannels } from './messaging.js';
import { rzpCreds, createOrder as rzpCreateOrder, validPayment, validWebhook, registerRazorpaySettings } from './razorpay.js';
import { registerDomains, domainRouter, funnelUrl } from './domains.js';
import { registerAutomations, fire as fireAutomation } from './automations.js';
import { registerHive } from './hive.js';
import { enqueue as fireWebhook, firstAttempt, retryNow, ensureSecret, newWebhookSecret, checkWebhookUrl } from './webhooks.js';

db.coupons ||= [];
db.abandoned ||= [];

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
app.use(express.json({ limit: '4mb' }));
// Requests on a seller's own domain (offer.theirbrand.in) show their funnel
app.use(domainRouter((...a) => renderFunnel(...a)));

const isTest = process.env.NODE_ENV === 'test';
const authLimiter = rateLimit({ windowMs: 15 * 60000, max: isTest ? 1000 : 20, message: 'Too many attempts — please wait 15 minutes and try again.' });
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
const pubUser = (u) => ({ id: u.id, email: u.email, name: u.name });
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const auth = (req, res, next) => {
  try {
    const t = (req.headers.authorization || '').replace('Bearer ', '');
    const p = jwt.verify(t, SECRET);
    req.user = db.users.find((u) => u.id === p.id);
    if (!req.user || (p.pv || 0) !== (req.user.pv || 0)) throw new Error();
    req.user.settings = { ...DEFAULT_SETTINGS, ...(req.user.settings || {}) };
    next();
  } catch {
    res.status(401).json({ error: 'Unauthorized' });
  }
};

async function sendVerification(req, user) {
  const token = randomToken();
  user.verifyHash = hashToken(token);
  user.verifyExp = Date.now() + 3 * DAY;
  save();
  await sendMail({ to: user.email, subject: 'Verify your FunnelForge email', text: `Hi ${user.name},\n\nConfirm your email address by opening this link:\n${appUrl(req)}/verify?token=${token}\n\nThe link is valid for 3 days.` }).catch((e) => console.error('verification email failed', e.message));
}

app.post('/api/auth/register', authLimiter, wrap(async (req, res) => {
  const { email, password, name } = req.body;
  if (!email || !EMAIL_RE.test(email) || !password || password.length < 6) return res.status(400).json({ error: 'A valid email and a 6+ character password are required' });
  if (db.users.some((u) => u.email === email.toLowerCase())) return res.status(409).json({ error: 'Email already registered' });
  const user = { id: uid(), email: email.toLowerCase(), name: String(name || email.split('@')[0]).slice(0, 80), hash: bcrypt.hashSync(password, 10), settings: { ...DEFAULT_SETTINGS }, emailVerified: false, pv: 0, createdAt: Date.now() };
  db.users.push(user);
  save();
  sendVerification(req, user);
  res.json({ token: sign(user), user: pubUser(user) });
}));

app.post('/api/auth/login', authLimiter, (req, res) => {
  const user = db.users.find((u) => u.email === (req.body.email || '').toLowerCase());
  if (!user || !bcrypt.compareSync(req.body.password || '', user.hash)) return res.status(401).json({ error: 'Invalid email or password' });
  if (user.totpEnabled) {
    if (!req.body.code) return res.json({ twoFactorRequired: true });
    if (!verifyTotp(user.totpSecret, req.body.code)) return res.status(401).json({ error: 'That 2-step code is not valid', twoFactorRequired: true });
  }
  res.json({ token: sign(user), user: pubUser(user) });
});

app.post('/api/auth/verify', authLimiter, (req, res) => {
  const h = hashToken(req.body.token);
  const user = db.users.find((u) => u.verifyHash === h && u.verifyExp > Date.now());
  if (!user) return res.status(400).json({ error: 'This verification link is invalid or has expired.' });
  user.emailVerified = true;
  delete user.verifyHash; delete user.verifyExp;
  save();
  res.json({ ok: true });
});

// Always answers OK so the endpoint can't be used to discover which emails have accounts
app.post('/api/auth/forgot', authLimiter, wrap(async (req, res) => {
  const user = db.users.find((u) => u.email === String(req.body.email || '').toLowerCase());
  if (user) {
    const token = randomToken();
    user.resetHash = hashToken(token);
    user.resetExp = Date.now() + 60 * 60000;
    save();
    await sendMail({ to: user.email, subject: 'Reset your FunnelForge password', text: `Hi ${user.name},\n\nReset your password here (valid for 1 hour):\n${appUrl(req)}/reset?token=${token}\n\nIf you didn't ask for this, you can ignore this email.` }).catch((e) => console.error('reset email failed', e.message));
  }
  res.json({ ok: true, emailConfigured: mailEnabled() });
}));

app.post('/api/auth/reset', authLimiter, (req, res) => {
  const { token, password } = req.body;
  if (!password || password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
  const h = hashToken(token);
  const user = db.users.find((u) => u.resetHash === h && u.resetExp > Date.now());
  if (!user) return res.status(400).json({ error: 'This reset link is invalid or has expired.' });
  user.hash = bcrypt.hashSync(password, 10);
  user.pv = (user.pv || 0) + 1; // signs out every other session
  user.emailVerified = true; // they proved access to the inbox
  delete user.resetHash; delete user.resetExp;
  save();
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
  save();
  res.json({ token: sign(req.user) });
});

// Two-step login: setup returns a secret to add to an authenticator app; enable/disable require a valid code
app.post('/api/auth/2fa/setup', auth, (req, res) => {
  if (req.user.totpEnabled) return res.status(400).json({ error: '2-step verification is already on' });
  req.user.totpPending = newTotpSecret();
  save();
  res.json({ secret: req.user.totpPending, otpauth: otpauthUrl(req.user.totpPending, req.user.email) });
});
app.post('/api/auth/2fa/enable', auth, authLimiter, (req, res) => {
  if (!req.user.totpPending || !verifyTotp(req.user.totpPending, req.body.code)) return res.status(400).json({ error: 'That code is not valid — check your authenticator app and try again' });
  req.user.totpSecret = req.user.totpPending;
  req.user.totpEnabled = true;
  delete req.user.totpPending;
  save();
  res.json({ ok: true });
});
app.post('/api/auth/2fa/disable', auth, authLimiter, (req, res) => {
  if (!req.user.totpEnabled || !verifyTotp(req.user.totpSecret, req.body.code)) return res.status(400).json({ error: 'That code is not valid' });
  req.user.totpEnabled = false;
  delete req.user.totpSecret;
  save();
  res.json({ ok: true });
});

const mine = (req) => db.funnels.filter((f) => f.userId === req.user.id);
const myIds = (req) => new Set(mine(req).map((f) => f.id));

// Liveness/readiness for Docker, load balancers and uptime monitors
const startedAt = Date.now();
app.get('/api/health', (_, res) => res.json({ ok: true, uptimeSec: Math.round((Date.now() - startedAt) / 1000), users: db.users.length, funnels: db.funnels.length }));

app.get('/api/me', auth, (req, res) => {
  const ids = myIds(req);
  const s = req.user.settings;
  res.json({
    ...pubUser(req.user), hasDemo: Object.values(demoCounts(ids)).some((n) => n > 0), aiEnabled: aiEnabled(), aiProvider: aiProvider(), mailEnabled: mailEnabled(), emailVerified: req.user.emailVerified !== false, twoFactor: !!req.user.totpEnabled, settings: s,
    onboarding: {
      funnel: ids.size > 0,
      published: mine(req).some((f) => f.published),
      payments: !!(s.payments.razorpayKey || s.payments.stripeKey || s.payments.cashfreeKey || s.payments.phonepeKey),
      tracking: !!(s.tracking.fbPixel || s.tracking.ga4),
      lead: db.leads.some((l) => ids.has(l.funnelId)),
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
  req.user.settings = next;
  ensureSecret(req.user);
  save();
  res.json(req.user.settings);
}));
app.post('/api/settings/webhook-secret', auth, (req, res) => {
  req.user.settings.webhookSecret = newWebhookSecret();
  save();
  res.json({ webhookSecret: req.user.settings.webhookSecret });
});

app.post('/api/settings/test-webhook', auth, wrap(async (req, res) => {
  const d = fireWebhook(req.user.id, 'test.ping', { message: 'Hello from FunnelForge 👋' });
  if (!d) return res.json({ skipped: true });
  await firstAttempt(d);
  res.json({ status: d.lastStatus, error: d.lastError, delivery: d.id });
}));

app.get('/api/webhooks/deliveries', auth, (req, res) => {
  res.json(db.webhooks.filter((w) => w.userId === req.user.id).slice(-50).reverse().map(({ payload, ...w }) => ({ ...w, payload })));
});
app.post('/api/webhooks/deliveries/:did/retry', auth, wrap(async (req, res) => {
  const d = db.webhooks.find((w) => w.id === req.params.did && w.userId === req.user.id);
  if (!d) return res.status(404).json({ error: 'Not found' });
  res.json(await retryNow(d));
}));

// ---------- saved sections (reusable across funnels) ----------
const SAVED_MAX = 200;
app.get('/api/saved', auth, (req, res) => res.json(db.saved.filter((x) => x.userId === req.user.id).reverse().map(({ userId, ...x }) => x)));
app.post('/api/saved', auth, (req, res) => {
  const block = req.body.block;
  if (!block || typeof block.type !== 'string' || !block.props || typeof block.props !== 'object' || Array.isArray(block.props)) return res.status(400).json({ error: 'Nothing to save' });
  if (JSON.stringify(block).length > 300000) return res.status(413).json({ error: 'That section is too large to save' });
  if (db.saved.filter((x) => x.userId === req.user.id).length >= SAVED_MAX) return res.status(400).json({ error: `You can keep up to ${SAVED_MAX} saved sections — delete some first` });
  const item = { id: uid(), userId: req.user.id, name: String(req.body.name || block.type).slice(0, 80), block: { type: block.type, props: block.props }, at: Date.now() };
  db.saved.push(item);
  save();
  const { userId, ...out } = item;
  res.json(out);
});
app.delete('/api/saved/:sid', auth, (req, res) => {
  db.saved = db.saved.filter((x) => !(x.id === req.params.sid && x.userId === req.user.id));
  save();
  res.json({ ok: true });
});

app.get('/api/coupons', auth, (req, res) => res.json(db.coupons.filter((c) => c.userId === req.user.id)));
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
    const own = new Set(db.funnels.filter((f) => f.userId === userId).map((f) => f.id));
    out.funnelIds = (Array.isArray(body.funnelIds) ? body.funnelIds : []).filter((id) => own.has(id));
  }
  return out;
}
app.post('/api/coupons', auth, (req, res) => {
  const code = String(req.body.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 30);
  if (!code) return res.status(400).json({ error: 'Code required' });
  if (db.coupons.some((c) => c.userId === req.user.id && c.code === code)) return res.status(409).json({ error: 'Code already exists' });
  const r = couponRules(req.body, {}, req.user.id);
  if (r.error) return res.status(400).json(r);
  const c = { id: uid(), userId: req.user.id, code, active: true, uses: 0, createdAt: Date.now(), expiresAt: null, maxUses: null, minOrder: null, oncePerCustomer: false, funnelIds: [], ...r };
  db.coupons.push(c);
  save();
  res.json(c);
});
app.put('/api/coupons/:cid', auth, (req, res) => {
  const c = db.coupons.find((x) => x.id === req.params.cid && x.userId === req.user.id);
  if (!c) return res.status(404).json({ error: 'Not found' });
  const r = couponRules(req.body, c, req.user.id);
  if (r.error) return res.status(400).json(r);
  Object.assign(c, r);
  save();
  res.json(c);
});
app.delete('/api/coupons/:cid', auth, (req, res) => {
  db.coupons = db.coupons.filter((x) => !(x.id === req.params.cid && x.userId === req.user.id));
  save();
  res.json({ ok: true });
});

// ---------- funnels ----------
const owned = (req, res) => {
  const f = mine(req).find((x) => x.id === req.params.id);
  if (!f) res.status(404).json({ error: 'Not found' });
  return f;
};
const uniqueSlug = (base) => {
  let s = base.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'funnel';
  while (db.funnels.some((f) => f.slug === s)) s += '-' + uid().slice(0, 3);
  return s;
};
// Every code advertised in an exit popup must actually work at checkout: create missing ones
// (INDIA10 → 10% off). Existing coupons — including paused or edited ones — are left alone.
function ensurePopupCoupons(f) {
  for (const s of f.steps) for (const b of [...s.blocks, ...(s.ab?.blocks || [])]) {
    if (b.type !== 'exitpopup') continue;
    const code = String(b.props?.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!code || db.coupons.some((c) => c.userId === f.userId && c.code === code)) continue;
    const pct = Number(code.match(/(\d{1,2})$/)?.[1]) || 10;
    db.coupons.push({ id: uid(), userId: f.userId, code, type: 'percent', value: Math.min(pct, 90), active: true, uses: 0, auto: true, createdAt: Date.now() });
  }
}
// Back-fill codes for funnels created before this check existed
for (const f of db.funnels) ensurePopupCoupons(f);
save();

const createFunnel = (userId, data) => {
  const f = { id: uid(), userId, name: data.name, slug: uniqueSlug(data.name), published: false, theme: data.theme, steps: data.steps, createdAt: Date.now(), updatedAt: Date.now() };
  db.funnels.push(f);
  ensurePopupCoupons(f);
  save();
  return f;
};

app.get('/api/funnels', auth, (req, res) => {
  const since = Date.now() - 30 * DAY;
  res.json(mine(req).map((f) => {
    const t = totals([f.id], since, Date.now());
    return { id: f.id, name: f.name, slug: f.slug, published: f.published, theme: f.theme, steps: f.steps.map((s) => ({ id: s.id, name: s.name, type: s.type })), hero: f.steps[0]?.blocks.find((b) => b.type === 'hero') || null, createdAt: f.createdAt, updatedAt: f.updatedAt, stats: t };
  }).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)));
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
  const revs = db.revisions.filter((r) => r.funnelId === f.id);
  const last = revs[revs.length - 1];
  if (!force && last && Date.now() - last.at < 60000) return;
  db.revisions.push({ id: uid(), funnelId: f.id, userId: f.userId, at: Date.now(), label: label || 'Edits', data: structuredClone({ name: f.name, theme: f.theme, steps: f.steps }) });
  if (revs.length + 1 > REV_KEEP) { const drop = new Set(revs.slice(0, revs.length + 1 - REV_KEEP).map((r) => r.id)); db.revisions = db.revisions.filter((r) => !drop.has(r.id)); }
}

// Optimistic concurrency: clients send the version they edited; a stale version gets 409 + the latest copy
app.put('/api/funnels/:id', auth, (req, res) => {
  const f = owned(req, res);
  if (!f) return;
  f.version ||= 1;
  if (req.body.baseVersion != null && Number(req.body.baseVersion) !== f.version) {
    return res.status(409).json({ error: 'This funnel was changed somewhere else (another tab, device or teammate).', funnel: f });
  }
  const contentChange = ['name', 'steps', 'theme'].some((k) => k in req.body && JSON.stringify(req.body[k]) !== JSON.stringify(f[k]));
  if (contentChange) snapshot(f);
  for (const k of ['name', 'steps', 'theme', 'published']) if (k in req.body) f[k] = req.body[k];
  if ('steps' in req.body) ensurePopupCoupons(f);
  f.version++;
  f.updatedAt = Date.now();
  save();
  res.json(f);
});

app.get('/api/funnels/:id/revisions', auth, (req, res) => {
  const f = owned(req, res);
  if (!f) return;
  res.json(db.revisions.filter((r) => r.funnelId === f.id).reverse().map((r) => ({ id: r.id, at: r.at, label: r.label, steps: r.data.steps.length, sections: r.data.steps.reduce((a, s) => a + s.blocks.length, 0), name: r.data.name })));
});
app.post('/api/funnels/:id/revisions/:rid/restore', auth, (req, res) => {
  const f = owned(req, res);
  if (!f) return;
  const r = db.revisions.find((x) => x.id === req.params.rid && x.funnelId === f.id);
  if (!r) return res.status(404).json({ error: 'Version not found' });
  snapshot(f, 'Before restoring an older version', true);
  Object.assign(f, structuredClone(r.data));
  f.version = (f.version || 1) + 1;
  f.updatedAt = Date.now();
  ensurePopupCoupons(f);
  save();
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

app.delete('/api/funnels/:id', auth, (req, res) => {
  const f = owned(req, res);
  if (!f) return;
  db.funnels = db.funnels.filter((x) => x.id !== f.id);
  for (const k of ['leads', 'orders', 'events', 'abandoned', 'revisions']) db[k] = db[k].filter((x) => x.funnelId !== f.id);
  save();
  res.json({ ok: true });
});

// ---------- analytics ----------
function totals(ids, from, to) {
  const set = new Set(ids);
  const inRange = (x) => set.has(x.funnelId) && x.at >= from && x.at < to;
  const views = db.events.filter((e) => e.type === 'view' && inRange(e));
  const orders = db.orders.filter(inRange);
  const revenue = orders.reduce((a, o) => a + o.total, 0);
  const visitors = new Set(views.map((v) => v.visitor || v.at)).size;
  return { views: views.length, visitors, leads: db.leads.filter(inRange).length, orders: orders.length, revenue, aov: orders.length ? Math.round(revenue / orders.length) : 0, conversion: visitors ? +((orders.length / visitors) * 100).toFixed(2) : 0, epv: visitors ? +(revenue / visitors).toFixed(2) : 0 };
}
function series(ids, from, days) {
  const set = new Set(ids);
  const out = Array.from({ length: days }, (_, i) => ({ date: localDate(from + i * DAY), views: 0, leads: 0, orders: 0, revenue: 0 }));
  const idx = (at) => Math.floor((at - from) / DAY);
  for (const e of db.events) if (e.type === 'view' && set.has(e.funnelId)) { const i = idx(e.at); if (out[i]) out[i].views++; }
  for (const l of db.leads) if (set.has(l.funnelId)) { const i = idx(l.at); if (out[i]) out[i].leads++; }
  for (const o of db.orders) if (set.has(o.funnelId)) { const i = idx(o.at); if (out[i]) { out[i].orders++; out[i].revenue += o.total; } }
  return out;
}
function sources(ids, from) {
  const set = new Set(ids);
  const m = {};
  const get = (s) => (m[s || 'direct'] ||= { source: s || 'direct', views: 0, leads: 0, orders: 0, revenue: 0 });
  for (const e of db.events) if (e.type === 'view' && set.has(e.funnelId) && e.at >= from) get(e.source).views++;
  for (const l of db.leads) if (set.has(l.funnelId) && l.at >= from) get(l.source).leads++;
  for (const o of db.orders) if (set.has(o.funnelId) && o.at >= from) { const g = get(o.source); g.orders++; g.revenue += o.total; }
  return Object.values(m).sort((a, b) => b.revenue - a.revenue || b.views - a.views);
}
function revenueByKind(ids, from) {
  const set = new Set(ids);
  const m = { main: 0, bump: 0, upsell: 0, downsell: 0, crosssell: 0 };
  for (const o of db.orders) if (set.has(o.funnelId) && o.at >= from) for (const it of o.items) m[it.kind || 'main'] = (m[it.kind || 'main'] || 0) + it.price;
  return m;
}
const range = (req) => reportRange(Math.min(365, Math.max(1, Number(req.query.days) || 30)));

app.get('/api/analytics/overview', auth, (req, res) => {
  const { days, from, to } = range(req);
  const ids = [...myIds(req)];
  const name = Object.fromEntries(mine(req).map((f) => [f.id, f.name]));
  res.json({
    days, totals: totals(ids, from, to), prev: totals(ids, from - days * DAY, from), series: series(ids, from, days), sources: sources(ids, from), byKind: revenueByKind(ids, from),
    funnels: mine(req).map((f) => ({ id: f.id, name: f.name, published: f.published, ...totals([f.id], from, to) })).sort((a, b) => b.revenue - a.revenue),
    recentOrders: db.orders.filter((o) => name[o.funnelId]).slice(-8).reverse().map((o) => ({ ...o, funnel: name[o.funnelId] })),
  });
});

app.get('/api/funnels/:id/analytics', auth, (req, res) => {
  const f = owned(req, res);
  if (!f) return;
  const { days, from, to } = range(req);
  const ev = db.events.filter((e) => e.funnelId === f.id && e.at >= from);
  const count = (stepId, type, variant) => ev.filter((e) => e.stepId === stepId && e.type === type && (!variant || (e.variant || 'A') === variant)).length;
  const orders = db.orders.filter((o) => o.funnelId === f.id && o.at >= from);
  res.json({
    days, totals: totals([f.id], from, to), prev: totals([f.id], from - days * DAY, from), series: series([f.id], from, days), sources: sources([f.id], from), byKind: revenueByKind([f.id], from),
    bumpRate: orders.length ? Math.round((orders.filter((o) => o.items.some((i) => i.kind === 'bump')).length / orders.length) * 100) : 0,
    steps: f.steps.map((s) => ({
      id: s.id, name: s.name, type: s.type, views: count(s.id, 'view'), conversions: count(s.id, 'convert'),
      ab: s.ab?.enabled ? (() => {
        const A = { views: count(s.id, 'view', 'A'), conversions: count(s.id, 'convert', 'A') };
        const B = { views: count(s.id, 'view', 'B'), conversions: count(s.id, 'convert', 'B') };
        return { A, B, result: abResult(A, B) };
      })() : null,
    })),
    leads: db.leads.filter((l) => l.funnelId === f.id).slice(-50).reverse(),
    orders: db.orders.filter((o) => o.funnelId === f.id).slice(-50).reverse(),
  });
});

// ---------- CRM ----------
registerCrm(app, { auth, rateLimit, isTest, onEvent: fireAutomation });
registerChannels(app, { auth, save, wrap, rateLimit, isTest });
registerRazorpaySettings(app, { auth, save, wrap });
registerDomains(app, { auth });
registerAutomations(app, { auth, secret: SECRET, appUrl, rateLimit, isTest });
registerHive(app, { auth, sign, port: process.env.PORT || 4000, rateLimit, isTest, appUrl });

app.get('/api/orders', auth, (req, res) => {
  const name = Object.fromEntries(mine(req).map((f) => [f.id, f.name]));
  res.json({
    orders: db.orders.filter((o) => name[o.funnelId]).map((o) => ({ ...o, funnel: name[o.funnelId] })).reverse(),
    abandoned: db.abandoned.filter((a) => name[a.funnelId] && !a.recovered).map((a) => ({ ...a, funnel: name[a.funnelId] })).reverse(),
  });
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
app.post('/api/ai/generate', auth, aiLimiter, wrap(async (req, res) => {
  const { prompt } = req.body;
  if (!prompt || prompt.length < 5) return res.status(400).json({ error: 'Describe your business or offer in a sentence' });
  const gen = aiEnabled() ? await generateFunnel(prompt) : matchTemplate(prompt);
  const usedAI = aiEnabled() && !gen.fallback;
  const quality = gen.quality;
  delete gen.fallback; delete gen.quality;
  const f = createFunnel(req.user.id, gen);
  if (quality) { f.aiQuality = { ...quality, at: Date.now() }; save(); }
  res.json({ ...f, usedAI, quality });
}));

app.post('/api/ai/edit', auth, aiLimiter, wrap(async (req, res) => {
  const f = mine(req).find((x) => x.id === req.body.funnelId);
  const step = f?.steps.find((s) => s.id === req.body.stepId);
  if (!step) return res.status(404).json({ error: 'Step not found' });
  res.json({ blocks: await editBlocks(step, f.theme, req.body.instruction) });
}));

// Conversational builder: the model (or offline parser) returns actions which we apply to the funnel
app.post('/api/ai/chat', auth, aiLimiter, wrap(async (req, res) => {
  const f = mine(req).find((x) => x.id === req.body.funnelId);
  if (!f) return res.status(404).json({ error: 'Funnel not found' });
  const { message, stepId, history } = req.body;
  if (!message?.trim()) return res.status(400).json({ error: 'Say something 🙂' });
  const out = aiEnabled() ? await chatAI(f, stepId, message, history) : offlineChat(message, f, stepId);
  const before = structuredClone({ name: f.name, theme: f.theme, steps: f.steps });
  const changes = [...new Set(applyActions(f, out.actions || [], stepId))];
  if (changes.length) {
    db.revisions.push({ id: uid(), funnelId: f.id, userId: f.userId, at: Date.now(), label: `Before AI: “${message.slice(0, 60)}”`, data: before });
    f.version = (f.version || 1) + 1;
  }
  if (changes.length) { f.updatedAt = Date.now(); ensurePopupCoupons(f); save(); }
  const reply = out.reply || (changes.length ? `Done! ${changes.join(' · ')}. Anything else?` : 'I could not find anything to change there.');
  res.json({ reply, changes, funnel: f, usedAI: aiEnabled() });
}));

app.get('/api/ai/agents', auth, (_, res) => res.json(AGENTS));
app.post('/api/ai/agent', auth, aiLimiter, wrap(async (req, res) => {
  const { kind, funnelId, extra } = req.body;
  if (!AGENTS[kind]) return res.status(400).json({ error: 'Unknown agent' });
  const f = mine(req).find((x) => x.id === funnelId) || mine(req)[0];
  const hero = f?.steps.flatMap((s) => s.blocks).find((b) => b.type === 'hero')?.props || {};
  const price = f?.steps.flatMap((s) => s.blocks).find((b) => b.type === 'checkout' || b.type === 'pricing')?.props.price || 999;
  const ctx = { product: f?.name || req.body.product || 'your product', price, headline: (hero.headline || f?.name || '').replace(/\*/g, ''), audience: req.body.audience || 'people', extra };
  res.json(await runAgent(kind, ctx));
}));

// ---------- demo data (so analytics are meaningful from minute one) ----------
// Demo records are tagged so they can be removed later. Data seeded before tagging existed is
// recognised by shape: demo events carry no A/B variant, demo orders no coupon field, and demo
// leads/carts use the seeded "name.xxxx@gmail.com" addresses.
const DEMO_EMAIL = /^[a-z]+\.[0-9a-f]{4}@gmail\.com$/;
const isDemo = {
  events: (e) => e.demo || (!('variant' in e) && 'visitor' in e),
  orders: (o) => o.demo || (!('coupon' in o) && DEMO_EMAIL.test(o.email || '')),
  leads: (l) => l.demo || DEMO_EMAIL.test(l.email || ''),
  abandoned: (a) => a.demo || DEMO_EMAIL.test(a.email || ''),
};
const demoCounts = (ids) => Object.fromEntries(Object.entries(isDemo).map(([k, fn]) => [k, db[k].filter((r) => ids.has(r.funnelId) && fn(r)).length]));

app.post('/api/demo/seed', auth, (req, res) => {
  const before = Object.fromEntries(['events', 'orders', 'leads', 'abandoned'].map((k) => [k, db[k].length]));
  if (!mine(req).length) for (const id of ['yoga', 'skincare']) { const t = getTemplate(id); createFunnel(req.user.id, { name: t.name, theme: t.theme, steps: t.steps }).demo = true; }
  const SRC = ['facebook', 'facebook', 'instagram', 'instagram', 'google', 'youtube', 'whatsapp', 'direct', 'direct', 'email'];
  const NAMES = ['Rahul Sharma', 'Priya Mehta', 'Ankit Patel', 'Sneha Reddy', 'Vikram Joshi', 'Anjali Kapoor', 'Rohit Das', 'Neha Gupta', 'Arjun Verma', 'Pooja Nair', 'Karan Bhatia', 'Divya Iyer', 'Aman Khan', 'Kavya Rao'];
  const now = Date.now();
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  for (const f of mine(req)) {
    f.published = true;
    const land = f.steps[0], co = f.steps.find((s) => s.type === 'checkout'), up = f.steps.find((s) => s.type === 'upsell'), down = f.steps.find((s) => s.type === 'downsell'), ty = f.steps.find((s) => s.type === 'thankyou');
    const chk = co?.blocks.find((b) => b.type === 'checkout')?.props;
    const upP = up?.blocks.find((b) => b.type === 'offer')?.props, downP = down?.blocks.find((b) => b.type === 'offer')?.props;
    for (let d = 59; d >= 0; d--) {
      const visitors = Math.round((40 + Math.random() * 50) * (1 + (59 - d) / 70));
      for (let v = 0; v < visitors; v++) {
        const at = now - d * DAY - Math.random() * DAY;
        const source = pick(SRC), visitor = uid();
        db.events.push({ funnelId: f.id, stepId: land.id, type: 'view', at, source, visitor });
        if (Math.random() > 0.22) continue;
        const nm = pick(NAMES), email = `${nm.split(' ')[0].toLowerCase()}.${uid().slice(0, 4)}@gmail.com`;
        db.events.push({ funnelId: f.id, stepId: land.id, type: 'convert', at: at + 6e4, source, visitor });
        if (Math.random() < 0.35) db.events.push({ funnelId: f.id, stepId: land.id, type: 'view', at: Math.min(Date.now() - 6e4, at + DAY * (0.5 + Math.random() * 3)), source: pick(SRC), visitor });
        if (!chk) { db.leads.push({ id: uid(), funnelId: f.id, stepId: land.id, email, name: nm, phone: '', source, visitor, at: at + 6e4 }); if (ty) db.events.push({ funnelId: f.id, stepId: ty.id, type: 'view', at: at + 7e4, source, visitor }); continue; }
        db.events.push({ funnelId: f.id, stepId: co.id, type: 'view', at: at + 7e4, source, visitor });
        if (Math.random() > 0.38) { if (Math.random() < 0.5) db.abandoned.push({ id: uid(), funnelId: f.id, stepId: co.id, email, name: nm, phone: '', visitor, at: at + 8e4, recovered: false }); continue; }
        const items = [{ name: chk.productName, price: Number(chk.price), kind: 'main' }];
        if (chk.bumpEnabled && Math.random() < 0.35) items.push({ name: chk.bumpTitle, price: Number(chk.bumpPrice), kind: 'bump' });
        db.events.push({ funnelId: f.id, stepId: co.id, type: 'convert', at: at + 9e4, source, visitor });
        if (up && upP) {
          db.events.push({ funnelId: f.id, stepId: up.id, type: 'view', at: at + 1e5, source, visitor });
          if (Math.random() < 0.24) { items.push({ name: upP.productName, price: Number(upP.price), kind: 'upsell' }); db.events.push({ funnelId: f.id, stepId: up.id, type: 'convert', at: at + 1.1e5, source, visitor }); }
          else if (down && downP) {
            db.events.push({ funnelId: f.id, stepId: down.id, type: 'view', at: at + 1.2e5, source, visitor });
            if (Math.random() < 0.3) { items.push({ name: downP.productName, price: Number(downP.price), kind: 'downsell' }); db.events.push({ funnelId: f.id, stepId: down.id, type: 'convert', at: at + 1.3e5, source, visitor }); }
          }
        }
        const cs = ty?.blocks.find((b) => b.type === 'crosssell')?.props;
        if (ty) db.events.push({ funnelId: f.id, stepId: ty.id, type: 'view', at: at + 1.4e5, source, visitor });
        if (cs && Math.random() < 0.12) { const it = pick(cs.items); items.push({ name: it.name, price: Number(it.price), kind: 'crosssell' }); }
        items.forEach((it, n) => { it.at = at + 9e4 + n * 1e4; });
        db.orders.push({ id: uid(), funnelId: f.id, email, name: nm, phone: '', items, total: items.reduce((a, i) => a + i.price, 0), source, visitor, at: at + 9e4, status: 'paid' });
      }
    }
  }
  for (const k of ['events', 'orders', 'leads', 'abandoned']) { db[k].slice(before[k]).forEach((r) => { r.demo = true; }); db[k].sort((a, b) => a.at - b.at); }
  save();
  res.json({ ok: true });
});

app.delete('/api/demo', auth, (req, res) => {
  const ids = myIds(req);
  const removed = demoCounts(ids);
  for (const [k, fn] of Object.entries(isDemo)) db[k] = db[k].filter((r) => !(ids.has(r.funnelId) && fn(r)));
  // Funnels the seeder created (and nothing else) are removed too
  const demoFunnels = mine(req).filter((f) => f.demo).map((f) => f.id);
  db.funnels = db.funnels.filter((f) => !demoFunnels.includes(f.id));
  save();
  res.json({ removed: { ...removed, funnels: demoFunnels.length } });
});

// ---------- public funnel runtime ----------
const pub = (req, res) => {
  const f = db.funnels.find((x) => x.slug === req.params.slug);
  const preview = req.query.preview === '1';
  if (!f || (!f.published && !preview)) { res.status(404).json({ error: 'This page is not published yet.' }); return null; }
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

function publicData(f) {
  const owner = db.users.find((u) => u.id === f.userId);
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
    db.events.push({ funnelId: f.id, stepId, type, variant: variant || 'A', source: source || 'direct', visitor, at: Date.now() });
    save();
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
  const lead = { id: uid(), funnelId: f.id, stepId, email: cleanEmail, name: String(name || '').slice(0, 120), phone: cleanPhone, source: source || 'direct', visitor: visitorOf(req), at: Date.now(), ...(Object.keys(fields).length ? { fields } : {}) };
  if (!isPreview(req)) { db.leads.push(lead); save(); fireWebhook(f.userId, 'lead.created', { funnel: f.name, ...lead }); fireAutomation(f.userId, 'lead', { email: lead.email, phone: lead.phone, name: lead.name, funnelId: f.id, source: lead.source }); }
  res.json({ ok: true });
});

app.post('/api/public/:slug/abandon', (req, res) => {
  const f = pub(req, res);
  if (!f) return;
  const { email, name, phone, stepId } = req.body;
  if (!isPreview(req) && email && !db.orders.some((o) => o.funnelId === f.id && o.email === email)) {
    const ex = db.abandoned.find((a) => a.funnelId === f.id && a.email === email);
    if (ex) Object.assign(ex, { name: name || ex.name, phone: phone || ex.phone, visitor: ex.visitor || visitorOf(req), at: Date.now() });
    else db.abandoned.push({ id: uid(), funnelId: f.id, stepId, email, name: name || '', phone: phone || '', visitor: visitorOf(req), at: Date.now(), recovered: false });
    save();
  }
  res.json({ ok: true });
});

// Finds a usable coupon for this funnel; { coupon } or { reason } explaining why not
function couponFor(f, code, { email, subtotal } = {}) {
  const c = db.coupons.find((x) => x.userId === f.userId && x.code === String(code || '').trim().toUpperCase());
  if (!c || !c.active) return { reason: 'That code isn’t valid' };
  if (c.expiresAt && Date.now() > c.expiresAt) return { reason: 'This code has expired' };
  if (c.maxUses && c.uses >= c.maxUses) return { reason: 'This code has reached its usage limit' };
  if (c.funnelIds?.length && !c.funnelIds.includes(f.id)) return { reason: 'This code can’t be used for this product' };
  if (c.minOrder && subtotal != null && subtotal < c.minOrder) return { reason: `This code needs a minimum order of ₹${c.minOrder.toLocaleString('en-IN')}` };
  if (c.oncePerCustomer && email && db.orders.some((o) => o.coupon === c.code && o.email?.toLowerCase() === String(email).toLowerCase() && db.funnels.find((x) => x.id === o.funnelId)?.userId === f.userId)) return { reason: 'You’ve already used this code' };
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

// Simulated payment. Replace the PAYMENT block with Razorpay / Stripe / Cashfree in production.
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
  if (charge.couponObj && !preview) charge.couponObj.uses++;
  // Preview orders live in a throwaway in-memory store and can never touch real orders, carts or coupons
  const store = preview ? previewOrders : db.orders;
  let order = orderId && store.find((o) => o.id === orderId && o.funnelId === f.id);
  if (order) { order.items.push(...items); order.total += charge.total; }
  else {
    order = { id: preview ? `pv-${uid()}` : uid(), funnelId: f.id, email: buyer.email || '', name: buyer.name || '', phone: buyer.phone || '', items, total: charge.total, coupon: charge.usedCoupon, discount: charge.discount, source: buyer.source || 'direct', visitor: buyer.visitor, status: 'paid', at: now, ...(payment ? { provider: payment.provider, mode: payment.mode } : {}) };
    store.push(order);
    if (!preview) db.abandoned.forEach((a) => { if (a.funnelId === f.id && a.email === buyer.email) a.recovered = true; });
  }
  if (preview) { while (previewOrders.length > 500) previewOrders.shift(); }
  else {
    save();
    const updated = order.items.length > items.length;
    fireWebhook(f.userId, updated ? 'order.updated' : 'order.created', { funnel: f.name, ...order });
    fireAutomation(f.userId, updated ? 'offer' : 'purchase', { email: order.email, phone: order.phone, name: order.name, funnelId: f.id, product: items[0]?.name, amount: charge.total, source: order.source });
  }
  // `added` is what this request charged — pixels report that, so upsells aren't double-counted
  return { orderId: order.id, total: order.total, added: charge.total, txn: `${order.id}-${order.items.length}`, discount: charge.discount, preview };
}
const ownerOf = (f) => db.users.find((u) => u.id === f.userId);
const buyerOf = (req, b = req.body) => ({ email: String(b.email || '').trim().slice(0, 200), name: String(b.name || '').slice(0, 120), phone: String(b.phone || '').slice(0, 40), source: b.source || 'direct', visitor: visitorOf(req) });

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
db.payments ||= [];
const findPayment = (id) => db.payments.find((p) => p.id === id);
function finalizePayment(pay, paymentId) {
  if (pay.status === 'paid') return pay.result;
  const f = db.funnels.find((x) => x.id === pay.funnelId);
  if (!f) return null;
  pay.status = 'paid'; pay.paymentId = paymentId; pay.paidAt = Date.now();
  const charge = { ...pay.charge, couponObj: pay.charge.usedCoupon ? db.coupons.find((c) => c.userId === f.userId && c.code === pay.charge.usedCoupon) : null };
  pay.result = recordOrder(f, charge, pay.buyer, { orderId: pay.orderId, payment: { id: paymentId, provider: 'razorpay', mode: pay.mode } });
  save();
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
  const orderId = req.body.orderId && db.orders.find((o) => o.id === req.body.orderId && o.funnelId === f.id) ? req.body.orderId : undefined;
  if (orderId && !buyer.email) Object.assign(buyer, (({ email, name, phone }) => ({ email, name, phone }))(db.orders.find((o) => o.id === orderId)));
  // nothing to charge (e.g. a 100% coupon): record it straight away
  if (charge.total <= 0) return res.json({ provider: 'free', ...recordOrder(f, charge, buyer, { orderId }) });
  const pay = { id: uid(), userId: f.userId, funnelId: f.id, stepId: charge.step.id, orderId, buyer, charge: { items: charge.items, total: charge.total, discount: charge.discount, usedCoupon: charge.usedCoupon }, mode: creds.mode, status: 'created', at: Date.now() };
  let rzp;
  try { rzp = await rzpCreateOrder(creds, { amount: Math.round(charge.total * 100), receipt: pay.id, notes: { funnel: f.name.slice(0, 200), payment: pay.id } }); } catch (e) {
    console.error('Razorpay order failed', e.message);
    return res.status(502).json({ error: 'Payments are temporarily unavailable — please try again in a minute' });
  }
  pay.rzpOrderId = rzp.id;
  db.payments.push(pay); save();
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
  const pay = findPayment(req.body.payment);
  if (!pay || pay.funnelId !== f.id) return res.status(404).json({ error: 'Payment not found' });
  const creds = rzpCreds(ownerOf(f));
  const { razorpay_order_id: oid, razorpay_payment_id: pid, razorpay_signature: sig } = req.body;
  if (!creds || oid !== pay.rzpOrderId || !validPayment(creds.secret, oid, pid, sig)) return res.status(400).json({ error: 'We couldn’t confirm this payment. If money was deducted it will be refunded automatically — please contact the seller.' });
  res.json(finalizePayment(pay, pid));
});
// 3. Webhook backup: Razorpay → /api/razorpay/webhook/<seller id>, signed with the webhook secret
app.post('/api/razorpay/webhook/:uid', (req, res) => {
  const owner = db.users.find((u) => u.id === req.params.uid);
  const creds = owner && rzpCreds(owner);
  const raw = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : '';
  if (!creds?.webhookSecret || !validWebhook(creds.webhookSecret, raw, req.headers['x-razorpay-signature'])) return res.status(400).json({ error: 'Invalid signature' });
  let ev;
  try { ev = JSON.parse(raw); } catch { return res.status(400).json({ error: 'Bad JSON' }); }
  if (['payment.captured', 'order.paid'].includes(ev.event)) {
    const entity = ev.payload?.payment?.entity || {};
    const oid = entity.order_id || ev.payload?.order?.entity?.id;
    const pay = db.payments.find((p) => p.rzpOrderId === oid && p.userId === owner.id);
    if (pay && entity.id) finalizePayment(pay, entity.id);
  }
  res.json({ ok: true }); // always 200 for events we don't use, so Razorpay doesn't retry them
});
// unpaid attempts are kept for 30 days
setInterval(() => { const cut = Date.now() - 30 * DAY; const n = db.payments.length; db.payments = db.payments.filter((p) => p.status === 'paid' || p.at > cut); if (db.payments.length !== n) save(); }, 6 * 3600000).unref();

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

// Live funnel pages are rendered on the server: crawlers and link previews (WhatsApp, Facebook,
// LinkedIn) see real content and meta tags, and visitors see the page before any JS runs.
app.get(['/f/:slug', '/f/:slug/:step'], (req, res, next) => {
  if (!indexHtml) return next();
  const f = db.funnels.find((x) => x.slug === req.params.slug);
  const preview = isPreview(req);
  if (!f || (!f.published && !preview)) return next();
  renderFunnel(req, res, f, req.params.step, { preview });
});
function renderFunnel(req, res, f, stepSlug, { domain = null, preview = false } = {}) {
  if (!indexHtml) return res.status(503).type('text').send('The app is not built yet');
  const data = publicData(f);
  const step = data.steps.find((s) => s.slug === stepSlug) || data.steps[0];
  const hero = step.blocks.find((b) => b.type === 'hero')?.props || data.steps[0].blocks.find((b) => b.type === 'hero')?.props || {};
  const base = domain ? `https://${domain}` : appUrl(req);
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
  const html = indexHtml
    .replace('<title>FunnelForge</title>', '')
    .replace('<!--ff-head-->', head)
    .replace('<!--ff-ssr-->', `${body}<script>window.__FUNNEL__=${json}</script>`);
  res.set('Cache-Control', 'no-cache').type('html').send(html);
}

if (indexHtml) {
  app.use(express.static(dist, { index: false }));
  app.get('*', (_, res) => res.type('html').send(indexHtml));
}

const port = process.env.PORT || 4000;
app.listen(port, () => console.log(`FunnelForge API on :${port} (AI ${aiEnabled() ? 'on' : 'off — offline assistant'}${ssr ? ', server rendering on' : ''})`));
