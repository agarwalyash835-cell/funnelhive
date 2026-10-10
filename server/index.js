import express from 'express';
import crypto from 'node:crypto';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { T, Events, q, tx, uid, contactKey, testOrder, dir as DATA_DIR, JOBS } from './db.js';
import { generateFunnel, editBlocks, aiEnabled, aiProvider, chatAI, AGENTS, runAgent } from './ai.js';
import { templateList, getTemplate, matchTemplate } from './templates.js';
import { applyActions, offlineChat } from './actions.js';
import { abResult } from './stats.js';
import { DAY, reportRange } from './time.js';
import { totals, totalsByFunnel, series, sources, revenueByKind, stepCounts, bumpRate, campaigns, refundsTotal } from './analytics.js';
import { loadSecret, rateLimit, securityHeaders, randomToken, hashToken, newTotpSecret, verifyTotp, otpauthUrl } from './security.js';
import { sendMail, mailEnabled, appUrl } from './mail.js';
import { registerCrm } from './crm.js';
import { initMessaging, registerChannels, sendEmail } from './messaging.js';
import { rzpCreds, createOrder as rzpCreateOrder, validPayment, validWebhook, registerRazorpaySettings } from './razorpay.js';
import { registerDomains, domainRouter, funnelUrl, domainOfFunnel , pagesSplit, pagesBase, sitemapUrls, sitemapXml, robotsTxt, noindexStep } from './domains.js';
import { registerAutomations, fire as fireAutomation } from './automations.js';
import { registerHive } from './hive.js';
import { registerBilling, accessFor, lockedOut, newBilling, spendCredits, creditsShort, usageSummary, AI_COST, pricing } from './billing.js';
import { platform, isAdmin, brand } from './platform.js';
import { registerAdmin } from './admin.js';
import { registerAccount } from './account.js';
import { verifyGoogleToken, googleClientId } from './google.js';
import { signupGuard, turnstileSiteKey, funnelLimitError, storageLimitError, addStorage } from './limits.js';
import { enqueue as fireWebhook, firstAttempt, retryNow, ensureSecret, newWebhookSecret, checkWebhookUrl } from './webhooks.js';
import { registerProducts, deliver, resolveToken } from './products.js';
import { registerTracking, trackServer, cleanAttr, cleanTk, safeEventId, cleanTrackingIds, trackingFor, funnelTrackingView } from './tracking.js';
import { registerSales, issueInvoice, invoiceUrl, invoicingOf, cleanInvoicing, cleanBuyerGst, refundFromWebhook, INVOICING_DEFAULTS } from './sales.js';
import { linkBase } from './products.js';
import { registerBookings, confirmPaidBooking } from './bookings.js';
import { registerQuotes, confirmQuotePayment } from './quotes.js';
import { registerGcal } from './gcal.js';
import { stripeCreds, isoOf, SYMBOL, startStripePayment, startStripeSubscription, chargeSaved, confirmedIntent, validStripeWebhook, registerStripeSettings } from './stripe.js';
import { fxRate } from './fx.js';
import { registerLegal, publicPrivacy, privacyOf, consentLine } from './legal.js';
import { registerApi, isApiKey, keyUser, KEY_NEVER } from './api.js';
import { registerAgency, logRequest, brandFor, brandForHost } from './agency.js';
import { registerAdSpend, withSpend, totalSpend } from './adspend.js';
import { deleteAccount as deleteAccountData } from './account.js';
import { registerFulfilment, cleanAddress } from './fulfilment.js';
import { registerBroadcasts } from './broadcasts.js';
import { registerTeam, enterWorkspace, allows } from './team.js';
import { planFor, startSubscription, validSubscription, onSubscriptionEvent, registerPlans, syncStripePlan } from './plans.js';
import { s3Enabled, putObject, publicUrlFor, presign } from './storage.js';
import { registerObserve, requestMetrics, reportError } from './observe.js';
import { sellerTz, offsetAt, validTz, COMMON_TZ, zoned } from './tz.js';
import { dropRollups, trimRollups } from './rollup.js';
import { registerWebinars, registrationFor, previewSession } from './webinars.js';
import { notify, money, registerNotifications, unreadCount } from './notify.js';
import { checkoutPhone, phoneTail, ordersByPhone } from './db.js';

const SECRET = loadSecret(DATA_DIR);
initMessaging(SECRET);
const app = express();
app.set('trust proxy', process.env.TRUST_PROXY ? (/^\d+$/.test(process.env.TRUST_PROXY) ? Number(process.env.TRUST_PROXY) : process.env.TRUST_PROXY) : 'loopback, linklocal, uniquelocal');
app.use(requestMetrics); // request counts and timings (observe.js)
app.use(pagesSplit); // PAGES_URL: live pages and the dashboard on separate domains (domains.js)
app.disable('x-powered-by');
app.use(securityHeaders);
// Same-origin by default; allow extra origins (e.g. a marketing site) via CORS_ORIGINS=https://a.com,https://b.com
const ALLOWED = (process.env.CORS_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
app.use(cors({ origin: (origin, cb) => cb(null, !origin || ALLOWED.includes(origin)) }));
app.use('/api/uploads', express.json({ limit: '8mb' }));
app.use('/api/razorpay/webhook', express.raw({ type: '*/*', limit: '1mb' }));
app.use('/api/billing/webhook', express.raw({ type: '*/*', limit: '1mb' }));
app.use('/api/stripe/webhook', express.raw({ type: '*/*', limit: '1mb' }));
app.use('/api/billing/stripe-webhook', express.raw({ type: '*/*', limit: '1mb' }));
app.use(express.json({ limit: '4mb' }));
// Requests on a seller's own domain (offer.theirbrand.in) show their funnel
app.use(domainRouter((...a) => renderFunnel(...a)));

const isTest = process.env.NODE_ENV === 'test';
const authLimiter = rateLimit({ windowMs: 15 * 60000, max: isTest ? 1000 : 20, message: 'Too many attempts — please wait 15 minutes and try again.', shared: true, name: 'auth' });
// Many real buyers can share one IP (mobile carrier NAT, office Wi-Fi): page-view pings get a high limit of their own,
// sign-ups and payments a generous one
const publicLimiter = rateLimit({ windowMs: 60000, max: isTest ? 5000 : 300 });
// activity log: every successful change, and who made it (see agency.js)
app.use('/api', (req, res, next) => { res.on('finish', () => logRequest(req, res)); next(); });
// API keys: 120 requests a minute each
const keyLimiter = rateLimit({ windowMs: 60000, max: isTest ? 100000 : 120, key: (req) => String(req.headers.authorization || req.headers['x-api-key'] || '').slice(-12), message: 'API rate limit: 120 requests a minute per key' });
app.use('/api', (req, res, next) => (/fh_live_/.test(String(req.headers.authorization || req.headers['x-api-key'] || '')) ? keyLimiter(req, res, next) : next()));
const eventLimiter = rateLimit({ windowMs: 60000, max: isTest ? 5000 : 1500 });
const aiLimiter = rateLimit({ windowMs: 60000, max: isTest ? 1000 : 20, key: (req) => req.user?.id || req.ip, message: 'You are sending AI requests too quickly — please wait a minute.' });
app.use('/api/public', (req, res, next) => (req.method !== 'POST' ? next() : req.path.endsWith('/event') ? eventLimiter(req, res, next) : publicLimiter(req, res, next)));

const wrap = (fn) => (req, res) => Promise.resolve(fn(req, res)).catch((e) => {
  if (e.status >= 400 && e.status < 500) return res.status(e.status).json({ error: e.message });
  console.error(e);
  reportError(e, { route: `${req.method} ${req.route?.path || req.path}`, userId: req.user?.id });
  res.status(500).json({ error: e.message });
});

// ---------- auth ----------
const DEFAULT_SETTINGS = { businessName: '', currency: '₹', supportWhatsapp: '', payments: { provider: 'razorpay', razorpayKey: '', stripeKey: '', cashfreeKey: '', phonepeKey: '', mode: 'test' }, tracking: { fbPixel: '', ga4: '' }, webhookUrl: '', customDomain: '', invoicing: { ...INVOICING_DEFAULTS } };
// pv (password version) lets us invalidate every existing session when the password changes
// ws: a team member working in another seller's workspace (see team.js)
const sign = (u, ws) => jwt.sign({ id: u.id, pv: u.pv || 0, ...(ws ? { ws } : {}) }, SECRET, { expiresIn: '30d' });
// an admin "logging in as" a seller (support): short-lived, and the seller's account shows it
const signAs = (u, adminId) => jwt.sign({ id: u.id, pv: u.pv || 0, imp: adminId }, SECRET, { expiresIn: '2h' });
const pubUser = (u) => ({ id: u.id, email: u.email, name: u.name });
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const withDefaults = (u) => { u.settings = { ...DEFAULT_SETTINGS, ...(u.settings || {}) }; return u; };
const auth = (req, res, next) => {
  try {
    const t = (req.headers.authorization || '').replace('Bearer ', '') || String(req.headers['x-api-key'] || '');
    // an API key (Zapier, Pabbly, your own code): the seller's account, with a key's limits — see api.js
    if (isApiKey(t)) {
      const k = keyUser(t);
      if (!k) return res.status(401).json({ error: 'Invalid API key' });
      const path = req.originalUrl.split('?')[0];
      if (KEY_NEVER.test(path) || !allows(k.role, req.method, path)) return res.status(403).json({ error: k.role === 'viewer' ? 'This API key is read-only' : 'API keys can’t do that' });
      req.user = withDefaults(k.user); req.apiKey = k.key; req.role = k.role;
      const locked = lockedOut(req);
      if (locked) return res.status(402).json({ error: locked, locked: true });
      return next();
    }
    const p = jwt.verify(t, SECRET);
    req.user = T.users.get(p.id);
    if (!req.user || (p.pv || 0) !== (req.user.pv || 0)) throw new Error();
    if (p.imp) req.impersonator = p.imp;
    if (p.ws) {
      // a team member acting in the owner's workspace: everything below works on the owner's data
      const w = enterWorkspace(req.user, p.ws);
      if (!w) return res.status(401).json({ error: 'You no longer have access to that team', workspaceGone: true });
      req.actor = req.user; req.role = w.member.role; req.user = w.owner;
      if (!allows(req.role, req.method, req.originalUrl.split('?')[0])) return res.status(403).json({ error: 'Your role on this team doesn’t allow that — ask the owner', role: req.role });
      if (Date.now() - (w.member.lastSeenAt || 0) > 10 * 60000) T.members.update(w.member.id, (m) => { m.lastSeenAt = Date.now(); });
    }
    withDefaults(req.user);
    if (Date.now() - (req.user.lastSeenAt || 0) > 10 * 60000 && !p.imp && !p.ws) T.users.update(req.user.id, (u) => { u.lastSeenAt = Date.now(); });
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
  // checked up front, charged only when the request succeeded — a validation error or a failed AI call costs nothing
  const err = creditsShort(req.user, AI_COST[kind]);
  if (err) return res.status(402).json({ error: err, credits: true });
  res.on('finish', () => { if (res.statusCode < 400) spendCredits(req.user, AI_COST[kind]); });
  next();
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
  const g = await signupGuard(req, email);
  if (g) return res.status(g.status).json({ error: g.error });
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
    const bad = await signupGuard(req, g.email, { google: true });
    if (bad) return res.status(bad.status).json({ error: bad.error });
    user = { id: uid(), email: g.email, name: g.name, hash: bcrypt.hashSync(randomToken(), 10), passwordSet: false, googleId: g.sub, settings: { ...DEFAULT_SETTINGS }, emailVerified: true, pv: 0, createdAt: Date.now(), billing: newBilling() };
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
  if (!user) {
    // a link opened twice (or pre-opened by an email app's link scanner) — the account is already verified
    const id = String(req.body.token || '').split('.')[0], u = /^[0-9a-f]{16}$/.test(id) && T.users.get(id);
    if (u && u.emailVerified !== false) return res.json({ ok: true, already: true });
    return res.status(400).json({ error: 'This verification link is invalid or has expired.' });
  }
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
  // with 2-step login on, the reset link alone isn't enough: the authenticator code is needed too
  if (user.totpEnabled && !verifyTotp(user.totpSecret, req.body.code)) return res.status(req.body.code ? 401 : 200).json({ twoFactorRequired: true, ...(req.body.code ? { error: 'That 2-step code is not valid' } : {}) });
  user.hash = bcrypt.hashSync(password, 10);
  user.passwordSet = true;
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
// the editor's preview links carry this key, so unpublished funnels can't be read by guessing a slug
const previewKey = (f) => crypto.createHmac('sha256', SECRET).update(`pv.${f.id}`).digest('base64url').slice(0, 22);
const validPreviewKey = (f, k) => typeof k === 'string' && k.length === 22 && crypto.timingSafeEqual(Buffer.from(k), Buffer.from(previewKey(f)));
const withKey = (f) => ({ ...f, previewKey: previewKey(f), ...(f.tracking ? { tracking: funnelTrackingView(f) } : {}) }); // a funnel's own CAPI token never leaves the server

// health, metrics and error reporting: observe.js
registerObserve(app);

const demoCount = (userId) => ({
  events: q('SELECT COUNT(*) AS n FROM events WHERE userId = ? AND demo = 1').get(userId).n,
  orders: T.orders.count({ userId, demo: 1 }), leads: T.leads.count({ userId, demo: 1 }), abandoned: T.abandoned.count({ userId, demo: 1 }),
});
app.get('/api/me', auth, (req, res) => {
  const s = req.user.settings;
  const funnels = q('SELECT COUNT(*) AS n, COALESCE(SUM(json_extract(data, \'$.published\')), 0) AS pub FROM funnels WHERE userId = ?').get(req.user.id);
  res.json({
    ...pubUser(req.actor || req.user), hasDemo: !!q('SELECT 1 FROM events WHERE userId = ? AND demo = 1 LIMIT 1').get(req.user.id) || T.orders.exists({ userId: req.user.id, demo: 1 }) || T.leads.exists({ userId: req.user.id, demo: 1 }),
    aiEnabled: aiEnabled(), aiProvider: aiProvider(), mailEnabled: mailEnabled(), emailVerified: (req.actor || req.user).emailVerified !== false, twoFactor: !!(req.actor || req.user).totpEnabled, settings: s,
    billing: req.access || accessFor(req.user), credits: usageSummary(req.user), admin: !req.actor && isAdmin(req.user), brand: (brandFor(req.user) || (req.actor && brandFor(req.actor)))?.brand || platform().brand, whiteLabel: brandFor(req.user) || (req.actor && brandFor(req.actor)) || null, agency: !!(req.user.agencyId || req.user.settings?.whiteLabel?.brand), announcement: platform().announcement || '',
    impersonating: !!req.impersonator, pagesUrl: (process.env.PAGES_URL || '').replace(/\/+$/, ''),
    workspace: req.actor ? { ownerId: req.user.id, name: req.user.settings.businessName || req.user.name, role: req.role } : null,
    teams: T.members.count({ userId: (req.actor || req.user).id, status: 'active' }),
    // the sidebar: which optional tools this account has started using (they join the menu), and what needs attention
    nav: {
      used: { products: T.products.exists({ userId: req.user.id }), quotes: T.quotes.exists({ userId: req.user.id }), bookings: T.bookings.exists({ userId: req.user.id }), webinars: T.webinars.exists({ userId: req.user.id }), automations: T.automations.exists({ userId: req.user.id }), broadcasts: T.broadcasts.exists({ userId: req.user.id }) },
      ship: q("SELECT COUNT(*) AS n FROM orders WHERE userId = ? AND json_extract(data, '$.fulfilment.status') = 'pending' AND json_extract(data, '$.status') NOT IN ('cancelled', 'refunded')").get(req.user.id).n,
      calls: T.bookings.count({ userId: req.user.id, status: 'confirmed', start: { gte: Date.now(), lte: Date.now() + 86400000 } }),
      unread: unreadCount(req.user.id), // notifications (the bell)
    },
    onboarding: {
      funnel: funnels.n > 0,
      published: funnels.pub > 0,
      payments: !!(s.payments.razorpayKey || s.payments.stripeKey || s.payments.cashfreeKey || s.payments.phonepeKey),
      tracking: !!(s.tracking.fbPixel || s.tracking.ga4 || s.tracking.googleAds?.conversionId),
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
  // the business's time zone: booking hours, webinars, "wait until 10:00" and report days follow it
  if ('timezone' in body) { const tz = String(body.timezone || '').trim(); if (tz && !validTz(tz)) return res.status(400).json({ error: 'Unknown time zone' }); next.timezone = tz || 'Asia/Kolkata'; }
  if (body.payments && typeof body.payments === 'object') {
    next.payments = { ...s.payments };
    for (const k of ['provider', 'razorpayKey', 'stripeKey', 'cashfreeKey', 'phonepeKey', 'mode']) if (k in body.payments) next.payments[k] = String(body.payments[k] ?? '').trim().slice(0, 200);
  }
  // Meta pixel, GA4 and Google Ads ids (the same checks as a funnel's own: tracking.js)
  if (body.tracking && typeof body.tracking === 'object') {
    const t = cleanTrackingIds(body.tracking, s.tracking);
    if (t.error) return res.status(400).json(t);
    next.tracking = t;
  }
  if (body.invoicing && typeof body.invoicing === 'object') {
    const inv = cleanInvoicing(body.invoicing, s.invoicing);
    if (inv.error) return res.status(400).json(inv);
    next.invoicing = inv;
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
  // "10" means 10% or ₹10 — switching between them without a new amount would silently change the discount
  if (cur.id && type !== (cur.type || 'percent') && !('value' in body)) return { error: 'Enter the discount again when switching between % off and a flat amount' };
  // a flat amount is in one currency (₹500 off is not $500 off); % off works in any
  if (type === 'flat') {
    const c = 'currency' in body ? String(body.currency || 'INR').toUpperCase() : cur.currency || 'INR';
    if (!SYMBOL[c]) return { error: 'Choose a currency for the discount' };
    out.currency = c;
  }
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
    else {
      // a date ("expires 31 Oct") lasts to the end of that day in the seller's time zone, not UTC midnight
      const ymd = /^\d{4}-\d{2}-\d{2}$/.test(String(body.expiresAt)) ? String(body.expiresAt) : null;
      const t = ymd ? zoned(sellerTz(T.users.get(userId)), ymd, 24 * 60) - 1 : new Date(body.expiresAt).getTime();
      if (!Number.isFinite(t)) return { error: 'Invalid expiry date' };
      out.expiresAt = t;
    }
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
    if (!code) continue;
    const ex = T.coupons.find({ userId: f.userId, code });
    // a code another funnel's popup created also works here; codes the seller made themselves are left alone
    if (ex) { if (ex.auto && ex.funnelIds?.length && !ex.funnelIds.includes(f.id)) T.coupons.put({ ...ex, funnelIds: [...ex.funnelIds, f.id] }); continue; }
    const pct = Number(code.match(/(\d{1,2})$/)?.[1]) || 10;
    T.coupons.insert({ id: uid(), userId: f.userId, code, type: 'percent', value: Math.min(pct, 50), active: true, uses: 0, auto: true, funnelIds: [f.id], createdAt: Date.now() });
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
    id: f.id, name: f.name, slug: f.slug, published: f.published, theme: f.theme, previewKey: previewKey(f), steps: f.steps.map((s) => ({ id: s.id, name: s.name, type: s.type })), hero: f.steps[0]?.blocks.find((b) => b.type === 'hero') || null, createdAt: f.createdAt, updatedAt: f.updatedAt, stats: stats(f.id),
  })));
});

const funnelCap = (req, res, next) => { const e = funnelLimitError(req.user); return e ? res.status(403).json({ error: e, limit: 'funnels' }) : next(); };
app.post('/api/funnels', auth, funnelCap, (req, res) => {
  const name = (typeof req.body.name === 'string' && req.body.name.trim().slice(0, 120)) || 'Untitled funnel';
  res.json(createFunnel(req.user.id, {
    name, theme: { style: 'aurora', primary: '#6366f1', secondary: '#ec4899' },
    steps: [{ id: uid(), name: 'Landing page', type: 'landing', slug: 'start', blocks: [{ id: uid(), type: 'hero', props: { badge: '⭐ Trusted by 10,000+ customers', headline: 'Your big promise — *the result they want*', subheadline: 'One sentence that makes your visitor want it.', ctaText: 'Get Started', secondaryText: 'See how it works', socialText: 'Loved by 10,000+ customers', rating: 4.9, reviews: '2,300', image: '', cardEmoji: '🚀', cardTitle: name, cardPrice: '₹499', cardMrp: '₹1,999', cardPoints: [{ text: 'Key benefit one' }, { text: 'Key benefit two' }], chip1: '🔥 120 joined today', chip2: '🔒 Secure payment' } }] }],
  }));
});

app.get('/api/funnels/:id', auth, (req, res) => { const f = owned(req, res); if (f) res.json(withKey(f)); });

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
  const b = req.body || {};
  if ('steps' in b && (!Array.isArray(b.steps) || b.steps.some((s) => !s || typeof s !== 'object' || !Array.isArray(s.blocks)))) return res.status(400).json({ error: 'steps must be a list of pages' });
  if ('name' in b && (typeof b.name !== 'string' || !b.name.trim())) return res.status(400).json({ error: 'Give the funnel a name' });
  if ('name' in b) b.name = b.name.trim().slice(0, 120);
  if ('published' in b && typeof b.published !== 'boolean') return res.status(400).json({ error: 'published must be true or false' });
  if ('theme' in b && (!b.theme || typeof b.theme !== 'object' || Array.isArray(b.theme))) return res.status(400).json({ error: 'Invalid theme' });
  // a step's "hide from search engines" is stored as a plain true, or not at all
  if ('steps' in b) for (const s of b.steps) if (s.seo && typeof s.seo === 'object') { if (s.seo.noindex) s.seo.noindex = true; else delete s.seo.noindex; }
  if (req.body.baseVersion != null && Number(req.body.baseVersion) !== f.version) {
    return res.status(409).json({ error: 'This funnel was changed somewhere else (another tab, device or teammate).', funnel: withKey(f) });
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
  res.json(withKey(f));
});
// hide the whole funnel from search engines (every step noindex, none in the sitemap); outside the autosave like legal/tracking
app.put('/api/funnels/:id/seo', auth, (req, res) => {
  const f = owned(req, res);
  if (!f) return;
  const nf = T.funnels.update(f.id, (x) => { if (req.body?.noindex) x.seo = { ...x.seo, noindex: true }; else if (x.seo) { delete x.seo.noindex; if (!Object.keys(x.seo).length) delete x.seo; } });
  res.json({ seo: nf.seo || null });
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
  res.json(withKey(f));
});

// ---------- image uploads ----------
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
// Optional CDN in front of /uploads (e.g. Cloudflare / CloudFront pulling from this server)
const CDN_URL = /^https:\/\/[^\s"'<>]+$/.test(process.env.CDN_URL || '') ? process.env.CDN_URL.replace(/\/+$/, '') : '';
globalThis.__FF_CDN__ = CDN_URL; // read by the server renderer
const IMG_TYPES = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'image/avif': 'avif' };
const MAGIC = { png: [0x89, 0x50, 0x4e, 0x47], jpg: [0xff, 0xd8, 0xff], gif: [0x47, 0x49, 0x46], webp: [0x52, 0x49, 0x46, 0x46] };
app.post('/api/uploads', auth, rateLimit({ windowMs: 60000, max: isTest ? 500 : 30, key: (req) => req.user.id }), wrap(async (req, res) => {
  const ext = IMG_TYPES[req.body.type];
  if (!ext) return res.status(400).json({ error: 'Please upload a PNG, JPG, WebP, GIF or AVIF image' });
  const buf = Buffer.from(String(req.body.data || '').replace(/^data:[^,]+,/, ''), 'base64');
  if (!buf.length) return res.status(400).json({ error: 'Empty file' });
  if (buf.length > 5 * 1024 * 1024) return res.status(413).json({ error: 'Images must be 5 MB or smaller' });
  // check the bytes really are that image type (not a renamed script)
  if (MAGIC[ext] && !MAGIC[ext].every((b, i) => buf[i] === b)) return res.status(400).json({ error: 'That file does not look like a valid image' });
  if (ext === 'webp' && buf.toString('latin1', 8, 12) !== 'WEBP') return res.status(400).json({ error: 'That file does not look like a valid image' });
  if (ext === 'avif' && !(buf.toString('latin1', 4, 8) === 'ftyp' && /^avi[fs]$/.test(buf.toString('latin1', 8, 12)))) return res.status(400).json({ error: 'That file does not look like a valid image' });
  // optional phone-sized copy from the editor's optimiser → served through srcset
  const small = ext === 'webp' && req.body.small ? Buffer.from(String(req.body.small).replace(/^data:[^,]+,/, ''), 'base64') : null;
  const smallOk = small && small.length && small.length <= 1024 * 1024 && small.toString('latin1', 0, 4) === 'RIFF' && small.toString('latin1', 8, 12) === 'WEBP';
  const bytes = buf.length + (smallOk ? small.length : 0);
  const full = storageLimitError(req.user, bytes);
  if (full) return res.status(413).json({ error: full, limit: 'storage' });
  const dir = path.join(UPLOAD_DIR, req.user.id);
  fs.mkdirSync(dir, { recursive: true });
  const base = `${Date.now().toString(36)}-${uid()}`;
  const name = smallOk ? `${base}.v.webp` : `${base}.${ext}`;
  // with a storage bucket, images live there (and are served by any server, or straight from its public URL / CDN)
  if (s3Enabled()) {
    try {
      await putObject(`uploads/${req.user.id}/${name}`, buf, req.body.type);
      if (smallOk) await putObject(`uploads/${req.user.id}/${base}.v-800.webp`, small, 'image/webp');
      addStorage(req.user.id, bytes);
      return res.json({ url: publicUrlFor(`uploads/${req.user.id}/${name}`) || `/uploads/${req.user.id}/${name}`, bytes: buf.length });
    } catch (e) { console.error('storage upload failed — kept on disk', e.message); }
  }
  fs.writeFileSync(path.join(dir, name), buf);
  if (smallOk) fs.writeFileSync(path.join(dir, `${base}.v-800.webp`), small);
  addStorage(req.user.id, bytes);
  res.json({ url: `/uploads/${req.user.id}/${name}`, bytes: buf.length });
}));
app.use('/uploads', express.static(UPLOAD_DIR, { maxAge: '30d', immutable: true, setHeaders: (res) => res.setHeader('Content-Security-Policy', "default-src 'none'") }));
// not on this server's disk: it's in the bucket
app.get('/uploads/:uid/:name', (req, res, next) => {
  if (!s3Enabled() || !/^[\w-]+$/.test(req.params.uid) || !/^[\w.-]+$/.test(req.params.name)) return next();
  const key = `uploads/${req.params.uid}/${req.params.name}`;
  // a public bucket URL never changes; a signed link (private bucket) expires, so its redirect is cached far less than its life
  const pub = publicUrlFor(key);
  res.set('Cache-Control', pub ? 'public, max-age=86400' : 'public, max-age=3600').redirect(pub ? 301 : 302, pub || presign(key, { expires: 86400 }));
});

app.post('/api/funnels/:id/duplicate', auth, funnelCap, (req, res) => {
  const f = owned(req, res);
  if (!f) return;
  const copy = structuredClone(f);
  copy.steps.forEach((s) => { s.id = uid(); s.blocks.forEach((b) => { b.id = uid(); }); });
  res.json(createFunnel(req.user.id, { name: `${f.name} (copy)`, theme: copy.theme, steps: copy.steps }));
});

function deleteFunnel(f) {
  tx(() => {
    T.funnels.del(f.id);
    for (const t of ['leads', 'orders']) for (const r of T[t].all({ funnelId: f.id })) if (!r.funnelName) { r.funnelName = f.name; T[t].put(r); }
    for (const t of ['abandoned', 'revisions']) T[t].delWhere({ funnelId: f.id });
    q('DELETE FROM events WHERE funnelId = ?').run(f.id);
    dropRollups.funnel(f.id);
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
// report days follow the seller's own time zone
const range = (req) => reportRange(Math.min(365, Math.max(1, Number(req.query.days) || 30)), Date.now(), offsetAt(sellerTz(req.user)) * 60000);

app.get('/api/analytics/overview', auth, (req, res) => {
  const { days, from, to } = range(req);
  const scope = { userId: req.user.id };
  const funnels = T.funnels.all({ userId: req.user.id });
  const name = Object.fromEntries(funnels.map((f) => [f.id, f.name]));
  const per = totalsByFunnel(req.user.id, from, to);
  res.json({
    days, totals: totals(scope, from, to), prev: totals(scope, from - days * DAY, from), series: series(scope, from, days, range(req).off), sources: sources(scope, from), byKind: revenueByKind(scope, from),
    campaigns: withSpend(req.user.id, campaigns(scope, from, to), from, to), refunded: refundsTotal(scope, from, to), adSpend: totalSpend(req.user.id, from, to),
    funnels: funnels.map((f) => ({ id: f.id, name: f.name, published: f.published, ...per(f.id) })).sort((a, b) => b.revenue - a.revenue),
    recentOrders: T.orders.all({ userId: req.user.id }, { order: 'at', desc: true, limit: 8 }).map((o) => ({ ...o, funnel: name[o.funnelId] || `${o.funnelName || 'Deleted funnel'} (deleted)` })),
  });
});

app.get('/api/funnels/:id/analytics', auth, (req, res) => {
  const f = owned(req, res);
  if (!f) return;
  const { days, from, to } = range(req);
  const scope = { funnelId: f.id };
  const count = stepCounts(f.id, from);
  res.json({
    days, totals: totals(scope, from, to), prev: totals(scope, from - days * DAY, from), series: series(scope, from, days, range(req).off), sources: sources(scope, from), byKind: revenueByKind(scope, from),
    bumpRate: bumpRate(f.id, from), campaigns: campaigns(scope, from, to), refunded: refundsTotal(scope, from, to),
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
registerBroadcasts(app, { auth, rateLimit, isTest });
registerTeam(app, { auth, sign, rateLimit, isTest });
registerPlans(app, { auth, resolveToken });
registerHive(app, { auth, sign, port: process.env.PORT || 4000, rateLimit, isTest, appUrl, credits: credits('hive') });
registerBilling(app, { auth, wrap, rateLimit, isTest });
registerAdmin(app, { auth, wrap, signAs });
registerAccount(app, { auth, rateLimit, isTest });
registerProducts(app, { auth, wrap, rateLimit, isTest, secret: SECRET, appUrl });
registerTracking(app, { auth, wrap });
registerSales(app, { auth, wrap, secret: SECRET, appUrl });

const ORDERS_MAX = 5000; // newest first; CSV export covers the same list
app.get('/api/orders', auth, (req, res) => {
  const fs_ = T.funnels.all({ userId: req.user.id });
  const name = Object.fromEntries(fs_.map((f) => [f.id, f.name]));
  const byId = Object.fromEntries(fs_.map((f) => [f.id, f]));
  const invoices = {};
  const bases = {}; // one domain lookup per funnel, not per invoice
  const baseOf = (fid) => (bases[fid] ??= linkBase(fid, process.env.APP_URL || appUrl(req)));
  for (const i of T.sinvoices.all({ userId: req.user.id }, { order: 'at' })) (invoices[i.orderId] ||= []).push({ id: i.id, number: i.number, type: i.type, total: i.total, url: invoiceUrl(baseOf(i.funnelId), i) });
  res.json({
    payments: !!rzpCreds(req.user),
    orders: T.orders.all({ userId: req.user.id }, { order: 'at', desc: true, limit: ORDERS_MAX }).map((o) => ({ ...o, funnel: name[o.funnelId] || (!o.funnelId ? o.funnelName || 'Direct' : `${o.funnelName || 'Deleted funnel'} (deleted)`), invoices: invoices[o.id] || [] })),
    abandoned: T.abandoned.all({ userId: req.user.id, recovered: 0 }, { order: 'at', desc: true, limit: ORDERS_MAX }).filter((a) => name[a.funnelId]).map((a) => { const f = byId[a.funnelId], st = f.steps?.find((s) => s.id === a.stepId); return { ...a, funnel: name[a.funnelId], link: f.published ? funnelUrl(f, process.env.APP_URL || appUrl(req), st?.slug) : null }; }),
  });
});

// the seller's own note and tags on an order
app.put('/api/orders/:id', auth, (req, res) => {
  const o = T.orders.get(req.params.id);
  if (!o || o.userId !== req.user.id) return res.status(404).json({ error: 'Order not found' });
  const b = req.body || {};
  const out = T.orders.update(o.id, (x) => {
    if ('note' in b) x.note = String(b.note ?? '').slice(0, 2000);
    if ('tags' in b) x.tags = [...new Set((Array.isArray(b.tags) ? b.tags : []).map((t) => String(t).trim().slice(0, 30)).filter(Boolean))].slice(0, 10);
  });
  res.json({ note: out.note || '', tags: out.tags || [] });
});

// ---------- public site: prices and company details for the landing, pricing and policy pages ----------
app.get('/api/site', (req, res) => {
  const p = platform(), pr = pricing();
  const wl = brandForHost(req.hostname); // an agency's own app domain: their brand on the login page
  res.json({ ...(wl ? { whiteLabel: wl } : {}), pagesUrl: process.env.PAGES_URL || '', brand: wl?.brand || p.brand, googleClientId: googleClientId() || null, turnstileSiteKey: turnstileSiteKey(), trialDays: p.trialDays, aiCredits: p.aiCredits, signupsOpen: p.signupsOpen, prices: { monthly: pr.monthly.amount, yearly: pr.yearly.amount, yearlyPerMonth: pr.yearly.perMonth, yearlySaves: pr.yearlySaves }, gstRegistered: !!p.company.gstin, company: { name: p.company.name, email: p.company.email, address: p.company.address, state: p.company.state, gstin: p.company.gstin } });
});

// ---------- templates ----------
app.get('/api/templates', (_, res) => res.json(templateList()));
app.get('/api/templates/:tid', (req, res) => { const t = getTemplate(req.params.tid); t ? res.json(t) : res.status(404).json({ error: 'Not found' }); });
app.post('/api/templates/:tid/use', auth, funnelCap, (req, res) => {
  const t = getTemplate(req.params.tid);
  if (!t) return res.status(404).json({ error: 'Not found' });
  res.json(createFunnel(req.user.id, { name: t.name, theme: t.theme, steps: t.steps }));
});

// ---------- AI ----------
app.post('/api/ai/generate', auth, funnelCap, aiLimiter, credits('generate'), wrap(async (req, res) => {
  const { prompt } = req.body;
  if (!prompt || prompt.length < 5) return res.status(400).json({ error: 'Describe your business or offer in a sentence' });
  // Hindi pages: the copy is written in Hindi, and the page's built-in words follow (theme.lang)
  const hindi = req.body.lang === 'hi';
  const ask = hindi ? `${prompt}

Write every word of the page copy in Hindi (Devanagari script) — natural, conversational Hindi a buyer in India would use. Keep brand names, prices, numbers and units as they are.` : prompt;
  const gen = aiEnabled() ? await generateFunnel(ask) : matchTemplate(prompt);
  if (hindi) gen.theme = { ...gen.theme, lang: 'hi', headingFont: gen.theme?.headingFont || 'Mukta', bodyFont: gen.theme?.bodyFont || 'Hind' };
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
  res.json({ reply, changes, funnel: withKey(f), usedAI: aiEnabled() });
}));

app.get('/api/ai/agents', auth, (_, res) => res.json(AGENTS));
app.post('/api/ai/agent', auth, aiLimiter, credits('agent'), wrap(async (req, res) => {
  const { kind, funnelId, extra } = req.body;
  if (!AGENTS[kind]) return res.status(400).json({ error: 'Unknown agent' });
  const f = ownFunnel(req, funnelId) || T.funnels.find({ userId: req.user.id });
  const hero = f?.steps.flatMap((s) => s.blocks).find((b) => b.type === 'hero')?.props || {};
  const priced = f?.steps.flatMap((s) => s.blocks).find((b) => b.type === 'checkout' || b.type === 'pricing')?.props.price;
  const price = priced || (f?.steps.some((s) => s.blocks.some((b) => b.type === 'form')) ? 'by application (high-ticket — sold on a call)' : f ? 'free (lead generation)' : 999);
  const ctx = { product: f?.name || req.body.product || 'your product', price, headline: (hero.headline || f?.name || '').replace(/\*/g, ''), audience: req.body.audience || 'people', extra };
  res.json(await runAgent(kind, ctx));
}));

// ---------- demo data (so analytics are meaningful from minute one) ----------
// Every demo record is tagged demo=1 so it can be removed later.
app.post('/api/demo/seed', auth, (req, res) => {
  const userId = req.user.id;
  tx(() => {
    if (!T.funnels.all({ userId }).some((f) => f.demo)) for (const id of ['yoga', 'skincare']) { const t = getTemplate(id); const f = createFunnel(userId, { name: `${t.name} (demo)`, theme: t.theme, steps: t.steps }); f.demo = true; T.funnels.put(f); }
    const SRC = ['facebook', 'facebook', 'instagram', 'instagram', 'google', 'youtube', 'whatsapp', 'direct', 'direct', 'email'];
    const NAMES = ['Rahul Sharma', 'Priya Mehta', 'Ankit Patel', 'Sneha Reddy', 'Vikram Joshi', 'Anjali Kapoor', 'Rohit Das', 'Neha Gupta', 'Arjun Verma', 'Pooja Nair', 'Karan Bhatia', 'Divya Iyer', 'Aman Khan', 'Kavya Rao'];
    const now = Date.now();
    const pick = (a) => a[Math.floor(Math.random() * a.length)];
    const events = [];
    const ev = (e) => events.push({ ...e, userId, demo: true });
    for (const f of T.funnels.all({ userId }).filter((x) => x.demo)) {
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
          const nm = pick(NAMES), email = `${nm.split(' ')[0].toLowerCase()}.${uid().slice(0, 4)}@example.com`; // a reserved domain: demo contacts can never be emailed for real
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
    dropRollups.demo(userId);
    for (const t of ['orders', 'leads', 'abandoned']) T[t].delWhere({ userId, demo: 1 });
    // Funnels the seeder created are removed too — unless real people signed up or bought there, then they're kept as normal funnels
    for (const f of T.funnels.all({ userId })) if (f.demo) {
      if (T.orders.exists({ funnelId: f.id }) || T.leads.exists({ funnelId: f.id })) { delete f.demo; f.published = false; T.funnels.put(f); continue; }
      deleteFunnel(f); demoFunnels++;
    }
  });
  res.json({ removed: { ...removed, funnels: demoFunnels } });
});

// ---------- public funnel runtime ----------
// a funnel is live when it's published and its owner's account still serves pages
const live = (f, preview) => f && (f.published || preview) && accessFor(T.users.get(f.userId)).pagesLive;
// Previews of unpublished funnels need the key the editor puts on its preview links (?preview=1&pv=…)
const draftOk = (f, req) => f && (f.published || (req.query.preview === '1' && validPreviewKey(f, req.query.pv)));
const pub = (req, res) => {
  const f = T.funnels.find({ slug: req.params.slug });
  if (!draftOk(f, req) || !live(f, req.query.preview === '1')) { res.status(404).json({ error: 'This page is not available right now.' }); return null; }
  return f;
};
const isPreview = (req) => req.query.preview === '1';
const allBlocks = (s) => [...s.blocks, ...(s.ab?.blocks || [])];
// a paid call is a sale like any other: an order, a GST invoice, the Purchase event
const bookingSale = (f, pay, paymentId, base) => recordOrder(f, { ...pay.charge, couponObj: null }, pay.buyer, { payment: { id: paymentId, provider: pay.provider || 'razorpay', mode: pay.mode, currency: pay.currency || 'INR', ...(pay.stripeCustomer ? { customer: pay.stripeCustomer } : {}) }, verified: true, base: base || pay.base });
registerBookings(app, { auth, wrap, rateLimit, isTest, secret: SECRET, appUrl, pub, isPreview, allBlocks, sale: bookingSale });
registerQuotes(app, { auth, wrap, rateLimit, isTest, appUrl });
registerGcal(app, { auth, secret: SECRET, appUrl });
registerStripeSettings(app, { auth, wrap });
registerLegal(app, { auth, appUrl });
registerApi(app, { auth });
registerAdSpend(app, { auth, wrap });
registerAgency(app, { auth, secret: SECRET, createFunnel, deleteAccount: deleteAccountData, newBilling, signFor: sign });
registerWebinars(app, { auth, secret: SECRET, appUrl, pub });
registerFulfilment(app, { auth, appUrl });
registerNotifications(app, { auth });

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

// a funnel sells in one currency: its checkout's (₹ by default)
const funnelIso = (f) => isoOf(f.steps.flatMap((s) => allBlocks(s)).find((b) => b.type === 'checkout')?.props?.currency);
function publicData(f, owner = T.users.get(f.userId)) {
  const inv = invoicingOf(owner);
  // tracking: the funnel's own ids where it has them, else the workspace's
  return { name: f.name, slug: f.slug, theme: f.theme, currency: funnelIso(f), ...(owner ? { privacy: publicPrivacy(owner, '', f) } : {}), steps: resolveWhatsApp(f.steps, owner?.settings?.supportWhatsapp), tracking: trackingFor(owner, f), ...(inv.enabled && inv.gstin ? { gstInvoices: true } : {}), ...(owner && !rzpCreds(owner) && !stripeCreds(owner) ? { testCheckout: true } : {}) };
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
  const { email, name, phone, source } = req.body;
  const stepId = typeof req.body.stepId === 'string' ? req.body.stepId : '';
  if (!f.steps.some((s) => s.id === stepId)) return res.status(400).json({ error: 'Bad step' });
  const cleanEmail = String(email || '').trim().slice(0, 200);
  const cleanPhone = String(phone || '').trim().slice(0, 40);
  if (cleanEmail && !EMAIL_RE.test(cleanEmail)) return res.status(400).json({ error: 'Please enter a valid email address' });
  if (!cleanEmail && !cleanPhone) return res.status(400).json({ error: 'Please enter your email or phone number' });
  // Custom form answers: at most 30 fields, 2,000 characters each
  const fields = {};
  if (req.body.fields && typeof req.body.fields === 'object') {
    for (const [k, v] of Object.entries(req.body.fields).slice(0, 30)) fields[String(k).slice(0, 80)] = typeof v === 'boolean' ? v : String(v ?? '').slice(0, 2000);
  }
  // applications: the step's form says which answers mean "not a fit" — checked here, not trusted from the browser
  const step = f.steps.find((s) => s.id === stepId);
  const low = (v) => String(v ?? '').trim().toLowerCase();
  const rules = (step ? allBlocks(step) : []).filter((b) => b.type === 'form').flatMap((b) => (b.props.fields || []).filter((fd) => fd.reject).map((fd) => [fd.label, String(fd.reject).split(',').map(low).filter(Boolean)]));
  // an applicant who skips a qualifying question doesn't pass it
  const qualified = rules.length ? !rules.some(([label, bad]) => !low(fields[label]) || bad.includes(low(fields[label]))) : undefined;
  const attr = cleanAttr(req.body.attr);
  // consent (DPDP): required when the seller asks for a ticked box; recorded with the wording shown
  const owner = ownerOf(f);
  if (privacyOf(owner).checkbox && req.body.consent !== true) return res.status(400).json({ error: 'Please tick the box to agree before continuing', consent: false });
  const consent = req.body.consent === true || req.body.consent === false ? { given: req.body.consent, at: Date.now(), text: consentLine(owner).slice(0, 400) } : null;
  const lead = { id: uid(), userId: f.userId, funnelId: f.id, stepId, ...(consent ? { consent } : {}), email: cleanEmail, name: String(name || '').slice(0, 120), phone: cleanPhone, source: String(source || 'direct').slice(0, 40), visitor: visitorOf(req), at: Date.now(), ...(Object.keys(fields).length ? { fields } : {}), ...(qualified !== undefined ? { qualified } : {}), ...(attr ? { attr } : {}) };
  // the browser reports the same Lead with this id, so Meta counts it once
  const eventId = safeEventId(req.body.eventId) || `lead-${lead.id}`;
  let access = null, webinar = null;
  if (isPreview(req)) webinar = previewSession(f, step, allBlocks);
  else {
    T.leads.insert(lead);
    // a webinar registration page: this sign-up gets a seat in a session (the next one, or the one they picked)
    if (qualified !== false) webinar = registrationFor(f, step, allBlocks, req.body, { email: cleanEmail, name: lead.name, phone: cleanPhone, leadId: lead.id, base: appUrl(req) });
    const { userId, ...out } = lead;
    // a free product attached to this opt-in / form (lead magnet) — not for applicants who aren't a fit
    const gift = (step ? allBlocks(step) : []).find((b) => (b.type === 'optin' || b.type === 'form') && b.props?.productId)?.props.productId;
    if (gift && cleanEmail && qualified !== false) access = deliver({ f, owner: ownerOf(f), email: cleanEmail, name: lead.name, phone: cleanPhone, grants: [{ productId: gift }], leadId: lead.id, base: appUrl(req) });
    fireWebhook(f.userId, 'lead.created', { funnel: f.name, ...out, ...(access ? { access: access.library } : {}) });
    fireAutomation(f.userId, 'lead', { email: lead.email, phone: lead.phone, name: lead.name, funnelId: f.id, source: lead.source, ...(qualified !== undefined ? { qualified } : {}), ...(access ? { accessLink: access.library } : {}) });
    trackServer(f.userId, { name: 'Lead', funnelId: f.id, id: eventId, buyer: lead, tk: cleanTk(req.body.tk, req) });
    notify(f.userId, { kind: 'lead', title: `${qualified === undefined ? 'New lead' : qualified ? 'New application (qualified)' : 'New application (not a fit)'} · ${lead.name || cleanEmail || cleanPhone} · ${f.name}`, body: [cleanEmail, cleanPhone].filter(Boolean).join(' · '), link: `/contacts/${encodeURIComponent(contactKey(cleanEmail, cleanPhone))}` });
  }
  res.json({ ok: true, eventId, ...(qualified !== undefined ? { qualified } : {}), ...(access ? { access: access.receipt } : {}), ...(webinar && !webinar.error ? { webinar } : {}) });
});

// An abandoned checkout: an email, or only a valid phone number (WhatsApp follow-up), and no order yet
app.post('/api/public/:slug/abandon', (req, res) => {
  const f = pub(req, res);
  if (!f) return;
  let email = String(req.body.email || '').trim().slice(0, 200);
  const name = String(req.body.name || '').slice(0, 120), raw = String(req.body.phone || '').slice(0, 40);
  if (!EMAIL_RE.test(email)) email = '';
  const ph = checkoutPhone(raw), phone = ph || raw;
  const stepId = f.steps.some((s) => s.id === req.body.stepId) ? req.body.stepId : null;
  const ckey = contactKey(email, ph);
  if (!isPreview(req) && (email || ph) && !T.orders.exists({ funnelId: f.id, ckey }) && !(ph && ordersByPhone({ funnelId: f.id }, ph).length)) {
    // a phone-only cart becomes this one once the email is typed too
    const ex = T.abandoned.find({ funnelId: f.id, ckey }) || (email && ph && T.abandoned.find({ funnelId: f.id, ckey: contactKey(null, ph) }));
    if (ex) T.abandoned.put(Object.assign(ex, { email: email || ex.email, name: name || ex.name, phone: phone || ex.phone, visitor: ex.visitor || visitorOf(req), at: Date.now() }));
    else { const attr = cleanAttr(req.body.attr); T.abandoned.insert({ id: uid(), userId: f.userId, funnelId: f.id, stepId, email, name, phone, visitor: visitorOf(req), at: Date.now(), recovered: false, ...(attr ? { attr } : {}) }); }
  }
  res.json({ ok: true });
});
// a purchase recovers the funnel's abandoned checkouts with the buyer's email or phone number
function recoverAbandoned(f, buyer) {
  const rows = buyer.email ? T.abandoned.all({ funnelId: f.id, ckey: contactKey(buyer.email) }) : [];
  const t = phoneTail(buyer.phone);
  if (t.length >= 8) rows.push(...T.abandoned.all({ funnelId: f.id, recovered: 0 }).filter((a) => !rows.some((r) => r.id === a.id) && phoneTail(a.phone) === t));
  for (const a of rows) { a.recovered = true; T.abandoned.put(a); }
}

// Finds a usable coupon for this funnel; { coupon } or { reason } explaining why not
function couponFor(f, code, { email, subtotal } = {}) {
  const c = T.coupons.find({ userId: f.userId, code: String(code || '').trim().toUpperCase() });
  if (!c || !c.active) return { reason: 'That code isn’t valid' };
  if (c.expiresAt && Date.now() > c.expiresAt) return { reason: 'This code has expired' };
  if (c.maxUses && c.uses >= c.maxUses) return { reason: 'This code has reached its usage limit' };
  if (c.funnelIds?.length && !c.funnelIds.includes(f.id)) return { reason: 'This code can’t be used for this product' };
  // a flat amount only means something in its own currency (₹500 off must never become $500 off)
  const iso = funnelIso(f);
  if (c.type === 'flat' && (c.currency || 'INR') !== iso) return { reason: `This code is for prices in ${c.currency || 'INR'} and can’t be used for this product` };
  if (c.minOrder && subtotal != null && subtotal < c.minOrder) return { reason: `This code needs a minimum order of ${SYMBOL[iso] || '₹'}${c.minOrder.toLocaleString('en-IN')}` };
  if (c.oncePerCustomer && !email) return { reason: 'Enter your email first — this code is one per customer' };
  // refunded or cancelled orders don't use up the customer's one go
  if (c.oncePerCustomer && T.orders.all({ userId: f.userId, ckey: contactKey(email) }).some((o) => o.coupon === c.code && o.status !== 'refunded' && o.status !== 'cancelled')) return { reason: 'You’ve already used this code' };
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
  let discount = 0, usedCoupon = null, couponObj = null, plan = null;
  if (blockId) {
    const cs = blocks.find((b) => b.id === blockId && b.type === 'crosssell');
    const idx = Number(itemIndex);
    const it = Number.isInteger(idx) && idx >= 0 && Array.isArray(cs?.props.items) ? cs.props.items[idx] : null;
    if (!it || typeof it !== 'object' || !it.name) return { status: 400, error: 'Item not found' };
    items.push({ name: it.name, price: Number(it.price) || 0, kind: 'crosssell', ...(it.productId ? { productId: String(it.productId) } : {}) });
  } else {
    const b = blocks.find((x) => x.type === 'checkout' || x.type === 'offer');
    if (!b) return { status: 400, error: 'Nothing to buy on this step' };
    const p = b.props;
    if (b.type === 'checkout') {
      const price = Number(p.price) || 0;
      // instalments / membership (Razorpay Subscriptions) — see plans.js
      plan = planFor(p, body);
      if (plan?.error) return { status: 400, error: plan.error };
      if (plan?.type === 'installments' && coupon) return { status: 400, error: 'Coupons apply when you pay in full — remove it to pay in instalments', coupon: false };
      // a coupon would lower every renewal (and a 100% one would mean free access for good)
      if (plan?.type === 'recurring' && coupon) return { status: 400, error: 'Coupons can’t be used on a membership — remove it to continue', coupon: false };
      if (coupon) {
        const r = couponFor(f, coupon, { email, subtotal: price });
        // never charge a different amount than the shopper saw: a code that stopped working is reported, not ignored
        if (!r.coupon) return { status: 400, error: `${r.reason} — remove it to continue`, coupon: false };
        discount = discountFor(r.coupon, price); usedCoupon = r.coupon.code; couponObj = r.coupon;
      }
      if (plan) plan.amount = plan.type === 'installments' ? plan.amount : price - discount;
      items.push({ name: p.productName, price: plan ? plan.amount : price - discount, kind: 'main', ...(p.productId ? { productId: String(p.productId) } : {}) });
      if (withBump && p.bumpEnabled) items.push({ name: p.bumpTitle, price: Number(p.bumpPrice) || 0, kind: 'bump', ...(p.bumpProductId ? { productId: String(p.bumpProductId) } : {}) });
      if (p.shipping === 'address' && Number(p.shippingFee) > 0) items.push({ name: 'Shipping', price: Math.round(Number(p.shippingFee)), kind: 'shipping' });
      if (body.method === 'cod' && p.cod && Number(p.codFee) > 0) items.push({ name: 'Cash on Delivery fee', price: Math.round(Number(p.codFee)), kind: 'cod_fee' });
    } else items.push({ name: p.productName || p.headline, price: Number(p.price) || 0, kind: step.type === 'downsell' ? 'downsell' : 'upsell', ...(p.productId ? { productId: String(p.productId) } : {}) });
  }
  const chk = blocks.find((x) => x.type === 'checkout')?.props;
  return { step, items, total: items.reduce((a, i) => a + i.price, 0), discount, usedCoupon, couponObj, ...(plan ? { plan } : {}), needsAddress: !blockId && chk?.shipping === 'address', codAllowed: !blockId && !!chk?.cod };
}
// a checkout that ships something needs a valid address
const addressError = (charge, buyer) => (charge.needsAddress && !buyer.address ? (buyer.addressError || 'Please enter your delivery address') : null);
// Records a paid charge: a new order, or more items on the buyer's order (upsells, cross-sells).
// verified: the money really arrived (Razorpay, or a free order while Razorpay is connected) — only then are
// products delivered, invoices issued and the sale reported to the ad platforms from the server.
function recordOrder(f, charge, buyer, { orderId, preview, payment, verified = false, base = '', testMode = false, cod = false } = {}) {
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
      // re-checked here, inside the transaction: two buyers can start with the last use at once. The paid order is
      // honoured either way (they paid the discounted price); the count just never passes the limit, so no one else starts
      if (charge.couponObj) T.coupons.update(charge.couponObj.id, (c) => { if (!c.maxUses || (c.uses || 0) < c.maxUses) c.uses = (c.uses || 0) + 1; });
      const ex = orderId && T.orders.get(orderId);
      if (ex && ex.funnelId === f.id) { order = ex; order.items.push(...items); for (const it of items) it.txn = `${order.id}-${order.items.length}`; order.total += charge.total; T.orders.put(order); }
      else {
        const id = uid();
        for (const it of items) it.txn = `${id}-${items.length}`;
        order = T.orders.insert({ id, userId: f.userId, funnelId: f.id, email: buyer.email || '', name: buyer.name || '', phone: buyer.phone || '', items, total: charge.total, coupon: charge.usedCoupon, discount: charge.discount, source: buyer.source || 'direct', visitor: buyer.visitor, status: 'paid', at: now, ...(payment ? { provider: payment.provider, mode: payment.mode } : {}), ...(buyer.attr ? { attr: buyer.attr } : {}), ...(buyer.gst ? { gst: buyer.gst } : {}), ...(buyer.address ? { address: buyer.address, fulfilment: { status: 'pending', at: now } } : {}), ...(cod ? { status: 'cod', paymentMethod: 'cod' } : {}), ...(charge.plan ? { plan: { ...charge.plan, subId: payment?.subId || null, provider: payment?.provider || null, status: payment?.subId ? 'active' : 'demo', paid: 1, startedAt: now } } : {}), ...(payment?.customer ? { stripeCustomer: payment.customer } : {}), ...((payment?.currency || funnelIso(f)) !== 'INR' ? { currency: payment?.currency || funnelIso(f), fx: fxRate(payment?.currency || funnelIso(f)) } : {}) });
        recoverAbandoned(f, buyer);
      }
    });
    const updated = order.items.length > items.length;
    const first = order.items.length - items.length;
    const owner = ownerOf(f);
    let access = null, invoice = null;
    if (verified) {
      const inv = issueInvoice(owner, order, items.map((it, i) => ({ index: first + i, name: it.name, kind: it.kind, amount: it.price })).filter((l) => l.amount > 0), { paymentId: payment?.id || null, gst: order.gst || buyer.gst || (order.address?.state ? { state: order.address.state } : null), test: payment ? payment.mode === 'test' : testMode });
      invoice = inv ? invoiceUrl(linkBase(f.id, base), inv) : null;
      const grants = items.map((it, i) => (it.productId ? { productId: it.productId, item: first + i } : null)).filter(Boolean);
      const delivered = updated && T.access.exists({ orderId: order.id });
      if (grants.length && order.email) access = deliver({ f, owner, email: order.email, name: order.name, phone: order.phone, grants, orderId: order.id, base, invoiceUrl: invoice, notify: !delivered });
      else if (invoice && order.email) {
        const biz = owner.settings?.businessName || f.name;
        sendEmail(owner, { to: order.email, subject: `Your invoice from ${biz}`, text: `Hi ${String(order.name || '').split(/\s+/)[0] || 'there'},\n\nThank you for your purchase. Your invoice: ${invoice}\n\n— ${biz}` }).catch((e) => console.error('invoice email failed', e.message));
      }
      trackServer(f.userId, { name: 'Purchase', funnelId: f.id, id: items[0].txn, value: charge.total, currency: funnelIso(f), orderId: order.id, items: items.map((it) => ({ id: it.productId || `${f.id}:${it.kind}`, name: it.name, price: it.price })), buyer: order, tk: buyer.tk });
    } else if (cod) {
      // a Cash on Delivery order is a real sale: reported now; invoiced and delivered when the cash is collected
      trackServer(f.userId, { name: 'Purchase', funnelId: f.id, id: items[0].txn, value: charge.total, currency: funnelIso(f), orderId: order.id, items: items.map((it) => ({ id: it.productId || `${f.id}:${it.kind}`, name: it.name, price: it.price })), buyer: order, tk: buyer.tk });
    } else if (items.some((it) => it.productId)) order = T.orders.update(order.id, (o) => { o.undelivered = true; }) || order; // demo checkout: nothing is handed out without a payment
    // the seller's bell (sample-data orders aside); test-mode sales are marked so they aren't mistaken for money
    if (!order.demo) notify(f.userId, { kind: 'order', title: `${updated ? 'Upsell' : cod ? 'New COD order' : 'New order'} · ${money(charge.total, order.currency || 'INR')} · ${order.name || order.email || order.phone || 'a buyer'}${testOrder(order) ? ' (test)' : ''}`, body: `${items.map((it) => it.name).join(', ')} — ${f.name}`, link: '/orders' });
    const { userId, ...out } = order;
    fireWebhook(f.userId, updated ? 'order.updated' : 'order.created', { funnel: f.name, ...out, ...(access ? { access: access.library } : {}), ...(invoice ? { invoice } : {}) });
    fireAutomation(f.userId, updated ? 'offer' : 'purchase', { email: order.email, phone: order.phone, name: order.name, funnelId: f.id, product: items[0]?.name, amount: charge.total, source: order.source, ...(access ? { accessLink: access.library } : {}), ...(invoice ? { invoiceLink: invoice } : {}) });
    return { orderId: order.id, total: order.total, added: charge.total, txn: items[0]?.txn || `${order.id}-${order.items.length}`, discount: charge.discount, preview, ...(access ? { access: access.receipt } : {}), ...(invoice ? { invoice } : {}) };
  }
  // `added` is what this request charged — pixels report that, so upsells aren't double-counted
  return { orderId: order.id, total: order.total, added: charge.total, txn: `${order.id}-${order.items.length}`, discount: charge.discount, preview };
}
const ownerOf = (f) => T.users.get(f.userId);
const buyerOf = (req, b = req.body) => {
  const attr = cleanAttr(b.attr), gst = cleanBuyerGst(b.gst), address = cleanAddress(b.address);
  return { ...(address && !address.error ? { address } : {}), ...(address?.error ? { addressError: address.error } : {}), email: String(b.email || '').trim().slice(0, 200), name: String(b.name || '').slice(0, 120), phone: String(b.phone || '').slice(0, 40), source: String(b.source || 'direct').slice(0, 40), visitor: visitorOf(req), tk: cleanTk(b.tk, req), ...(attr ? { attr } : {}), ...(gst && !gst.error ? { gst } : {}), ...(gst?.error ? { gstError: gst.error } : {}) };
};

// Demo / preview checkout (no payment provider). Refused once real payments are connected,
// so nobody can create "paid" orders without paying.
app.post('/api/public/:slug/order', (req, res) => {
  const f = pub(req, res);
  if (!f) return;
  const preview = isPreview(req);
  if (!preview && (rzpCreds(ownerOf(f)) || stripeCreds(ownerOf(f)))) return res.status(409).json({ error: 'This funnel takes real payments', provider: rzpCreds(ownerOf(f)) ? 'razorpay' : 'stripe' });
  const charge = buildCharge(f, req.body);
  if (charge.error) return res.status(charge.status).json(charge);
  const buyer = buyerOf(req);
  if (buyer.gstError) return res.status(400).json({ error: buyer.gstError });
  if (addressError(charge, buyer)) return res.status(400).json({ error: addressError(charge, buyer) });
  delete buyer.tk; // nothing is reported to ad platforms from the server for unpaid demo orders
  res.json(recordOrder(f, charge, buyer, { orderId: req.body.orderId, preview, base: appUrl(req) }));
});

// ---------- Cash on Delivery ----------
// Works with or without Razorpay. The order is booked unpaid (status "cod") and settled when it's delivered.
const codLimiter = rateLimit({ windowMs: 3600000, max: isTest ? 1000 : 10, message: 'Too many orders from this network — please try again later.' });
app.post('/api/public/:slug/cod', codLimiter, (req, res) => {
  const f = pub(req, res);
  if (!f) return;
  const charge = buildCharge(f, { ...req.body, method: 'cod' });
  if (charge.error) return res.status(charge.status).json(charge);
  if (!charge.codAllowed) return res.status(400).json({ error: 'Cash on Delivery isn’t available for this product' });
  if (charge.plan) return res.status(400).json({ error: 'Instalments and memberships are paid online' });
  const buyer = buyerOf(req);
  if (buyer.gstError) return res.status(400).json({ error: buyer.gstError });
  if (addressError(charge, buyer)) return res.status(400).json({ error: addressError(charge, buyer) });
  if (!/^\d{10}$/.test(String(buyer.phone).replace(/\D/g, '').replace(/^91(?=\d{10}$)/, ''))) return res.status(400).json({ error: 'Please enter your 10-digit mobile number — the courier will call before delivery' });
  if (isPreview(req)) return res.json(recordOrder(f, charge, buyer, { preview: true }));
  res.json({ provider: 'cod', ...recordOrder(f, charge, buyer, { cod: true, base: appUrl(req) }) });
});

// ---------- Razorpay ----------
function finalizePayment(pay, paymentId, base) {
  if (pay.kind === 'booking') { confirmPaidBooking(pay, paymentId, base); return pay.result || null; }
  if (pay.kind === 'quote') return confirmQuotePayment(pay, paymentId, base);
  if (pay.status === 'paid') return pay.result;
  const f = T.funnels.get(pay.funnelId);
  if (!f) return null;
  pay.status = 'paid'; pay.paymentId = paymentId; pay.paidAt = Date.now();
  const charge = { ...pay.charge, couponObj: pay.charge.usedCoupon ? T.coupons.find({ userId: f.userId, code: pay.charge.usedCoupon }) : null };
  pay.result = recordOrder(f, charge, pay.buyer, { orderId: pay.orderId, payment: { id: paymentId, provider: pay.provider || 'razorpay', mode: pay.mode, ...(pay.plan ? { subId: pay.stripeSub || pay.rzpOrderId } : {}), ...(pay.stripeCustomer ? { customer: pay.stripeCustomer } : {}) }, verified: true, base: base || pay.base });
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
  const prevCod = !preview && req.body.orderId && T.orders.get(req.body.orderId);
  const onCod = prevCod && prevCod.funnelId === f.id && prevCod.status === 'cod'; // COD works without Razorpay
  const sc = stripeCreds(owner), iso = funnelIso(f);
  const prevStripe = prevCod && prevCod.funnelId === f.id && prevCod.stripeCustomer;
  const useStripe = !!sc && (iso !== 'INR' || !creds || !!prevStripe);
  if (!onCod && (preview || (!creds && !sc))) return res.json({ provider: 'demo' });
  if (!onCod && iso !== 'INR' && !sc) return res.status(400).json({ error: `This checkout is priced in ${iso} — card payments in ${iso} need Stripe connected (Settings → Payments)` });
  const charge = buildCharge(f, req.body);
  if (charge.error) return res.status(charge.status).json(charge);
  const buyer = buyerOf(req);
  if (buyer.gstError) return res.status(400).json({ error: buyer.gstError });
  if (addressError(charge, buyer)) return res.status(400).json({ error: addressError(charge, buyer) });
  const prev = req.body.orderId && T.orders.get(req.body.orderId);
  // one-click offers after a Cash on Delivery checkout are added to that COD order (paid together on delivery)
  if (prev && prev.funnelId === f.id && prev.status === 'cod') return res.json({ provider: 'cod', ...recordOrder(f, charge, { ...buyer, email: prev.email, name: prev.name, phone: prev.phone }, { orderId: prev.id, cod: true, base: appUrl(req) }) });
  const orderId = prev && prev.funnelId === f.id ? prev.id : undefined;
  if (orderId && !buyer.email) Object.assign(buyer, { email: prev.email, name: prev.name, phone: prev.phone });
  // nothing to charge (e.g. a 100% coupon): record it straight away
  if (charge.total <= 0) return res.json({ provider: 'free', ...recordOrder(f, charge, buyer, { orderId, verified: true, base: appUrl(req), testMode: (useStripe ? sc : creds).mode === 'test' }) });
  const pay = { id: uid(), userId: f.userId, funnelId: f.id, stepId: charge.step.id, orderId, buyer, charge: { items: charge.items, total: charge.total, discount: charge.discount, usedCoupon: charge.usedCoupon }, mode: (useStripe ? sc : creds).mode, status: 'created', at: Date.now(), base: appUrl(req), ...(useStripe ? { provider: 'stripe', currency: iso } : {}) };
  // the buyer pressed Pay on the checkout: InitiateCheckout, with the browser's event id so Meta counts it once
  if (!orderId && charge.items[0]?.kind === 'main') trackServer(f.userId, { name: 'InitiateCheckout', funnelId: f.id, id: safeEventId(req.body.eventId) || `ic-${pay.id}`, value: charge.total, currency: funnelIso(f), items: charge.items.map((it) => ({ id: it.productId || `${f.id}:${it.kind}`, name: it.name, price: it.price })), buyer, tk: buyer.tk });
  if (useStripe) {
    const description = charge.items.map((i) => i.name).join(' + ');
    try {
      if (charge.plan) {
        if (orderId) return res.status(400).json({ error: 'Instalments and memberships can’t be added to an earlier order' });
        pay.plan = charge.plan; pay.charge.plan = charge.plan;
        const r = await startStripeSubscription(sc, { userId: f.userId, pay, iso, buyer, plan: charge.plan, name: charge.items[0].name });
        Object.assign(pay, { stripeSub: r.subscription, stripeCustomer: r.customer, rzpOrderId: r.subscription });
        T.payments.insert(pay);
        return res.json(r);
      }
      // one-click: the card saved at checkout
      if (prevStripe) {
        pay.stripeCustomer = prevStripe;
        const pi = await chargeSaved(sc, { pay, iso, customer: prevStripe, description });
        if (pi?.status === 'succeeded') { Object.assign(pay, { stripeIntent: pi.id, rzpOrderId: pi.id }); T.payments.insert(pay); return res.json({ provider: 'stripe', ...finalizePayment(pay, pi.id, appUrl(req)) }); }
      }
      if (!orderId && charge.items[0]?.kind === 'main') trackServer(f.userId, { name: 'InitiateCheckout', funnelId: f.id, id: safeEventId(req.body.eventId) || `ic-${pay.id}`, value: charge.total, currency: funnelIso(f), items: charge.items.map((it) => ({ id: it.productId || `${f.id}:${it.kind}`, name: it.name, price: it.price })), buyer, tk: buyer.tk });
      const r = await startStripePayment(sc, { userId: f.userId, pay, iso, buyer, description });
      Object.assign(pay, { stripeIntent: r.intent, stripeCustomer: r.customer, rzpOrderId: r.intent });
      T.payments.insert(pay);
      return res.json({ ...r, amount: charge.total, currency: iso, name: (owner.settings || {}).businessName || f.name, description, color: f.theme?.primary || '#6366f1' });
    } catch (e) {
      console.error('Stripe payment failed', e.message);
      return res.status(502).json({ error: 'Card payments are temporarily unavailable — please try again in a minute' });
    }
  }
  if (charge.plan) {
    if (orderId) return res.status(400).json({ error: 'Instalments and memberships can’t be added to an earlier order' });
    let sub;
    try { sub = await startSubscription(creds, { userId: f.userId, charge, payId: pay.id, funnelName: f.name }); } catch (e) {
      console.error('Razorpay subscription failed', e.message);
      return res.status(502).json({ error: e.status === 400 ? `Payment plans need Subscriptions turned on in your Razorpay account (${e.message})` : 'Payments are temporarily unavailable — please try again in a minute' });
    }
    pay.rzpOrderId = sub.id; pay.plan = charge.plan; pay.charge.plan = charge.plan;
    T.payments.insert(pay);
    const s = owner.settings || {};
    return res.json({ provider: 'razorpay', payment: pay.id, key: creds.keyId, subscription_id: sub.id, name: s.businessName || f.name, description: `${charge.items[0].name} — ${charge.plan.type === 'installments' ? `${charge.plan.count} monthly payments` : `billed ${charge.plan.interval}`}`.slice(0, 250), prefill: { name: buyer.name, email: buyer.email, contact: buyer.phone }, color: f.theme?.primary || '#6366f1' });
  }
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
  const { razorpay_order_id: oid, razorpay_payment_id: pid, razorpay_signature: sig, razorpay_subscription_id: sid } = req.body;
  if (pay.plan) {
    if (!creds || sid !== pay.rzpOrderId || !validSubscription(creds.secret, sid, pid, sig)) return res.status(400).json({ error: 'We couldn’t confirm this payment. If money was deducted it will be refunded automatically — please contact the seller.' });
    return res.json(finalizePayment(pay, pid, appUrl(req)));
  }
  if (!creds || oid !== pay.rzpOrderId || !validPayment(creds.secret, oid, pid, sig)) return res.status(400).json({ error: 'We couldn’t confirm this payment. If money was deducted it will be refunded automatically — please contact the seller.' });
  res.json(finalizePayment(pay, pid, appUrl(req)));
});
// Stripe: the Payment Element confirmed on the page — read it back from Stripe before it counts
app.post('/api/public/:slug/pay/stripe/verify', wrap(async (req, res) => {
  const f = pub(req, res);
  if (!f) return;
  const pay = T.payments.get(req.body.payment);
  if (!pay || pay.funnelId !== f.id || pay.provider !== 'stripe') return res.status(404).json({ error: 'Payment not found' });
  if (pay.status === 'paid') return res.json(pay.result);
  const sc = stripeCreds(ownerOf(f));
  const id = sc && await confirmedIntent(sc, pay).catch(() => null);
  if (!id) return res.status(400).json({ error: 'We couldn’t confirm this payment yet. If money was deducted it will be refunded automatically — please contact the seller.' });
  res.json(finalizePayment(pay, id, appUrl(req)));
}));
app.post('/api/stripe/webhook/:uid', wrap(async (req, res) => {
  const owner = T.users.get(req.params.uid);
  const sc = owner && stripeCreds(owner);
  const raw = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : '';
  if (!sc?.webhookSecret || !validStripeWebhook(sc.webhookSecret, raw, req.headers['stripe-signature'])) return res.status(400).json({ error: 'Invalid signature' });
  let ev;
  try { ev = JSON.parse(raw); } catch { return res.status(400).json({ error: 'Bad JSON' }); }
  const obj = ev.data?.object || {};
  // a one-time payment (or a subscription's first invoice) that the browser never reported back
  if (ev.type === 'payment_intent.succeeded' && obj.metadata?.payment) {
    const pay = T.payments.get(obj.metadata.payment);
    if (pay && pay.userId === owner.id && pay.status !== 'paid' && await confirmedIntent(sc, pay).catch(() => null)) finalizePayment(pay, obj.id, appUrl(req));
  }
  if ((ev.type.startsWith('invoice.') || ev.type.startsWith('customer.subscription.')) && (obj.subscription || obj.object === 'subscription')) syncStripePlan(obj.subscription || obj.id, { finalize: finalizePayment, base: appUrl(req) });
  res.json({ received: true });
}));
// 3. Webhook backup: Razorpay → /api/razorpay/webhook/<seller id>, signed with the webhook secret
app.post('/api/razorpay/webhook/:uid', wrap(async (req, res) => {
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
    if (pay && entity.id) finalizePayment(pay, entity.id, appUrl(req));
  }
  // subscriptions: answered only once synced — a 500 makes Razorpay retry, so no renewal or failure is missed
  if (String(ev.event).startsWith('subscription.')) {
    try { await onSubscriptionEvent(ev, { finalize: finalizePayment, base: appUrl(req) }); } catch { return res.status(500).json({ error: 'Couldn’t sync this subscription — please retry' }); }
  }
  // refunds made in the Razorpay dashboard are recorded here too (access removed, credit note, reports)
  if (['refund.processed', 'refund.created'].includes(ev.event) && ev.payload?.refund?.entity) refundFromWebhook(owner, ev.payload.refund.entity);
  res.json({ ok: true }); // always 200 for events we don't use, so Razorpay doesn't retry them
}));

// ---------- housekeeping ----------
// unpaid payment attempts are kept for 30 days; raw page-view events for 400 days (reports go back 365)
const EVENTS_KEEP_DAYS = Number(process.env.EVENTS_KEEP_DAYS || 400);
function housekeeping() {
  const now = Date.now();
  q("DELETE FROM payments WHERE status IS NOT 'paid' AND at < ?").run(now - 30 * DAY);
  // in batches so a large delete never holds the database for long
  // page views: rollup.js folds old raw rows into daily totals; the totals are trimmed after EVENTS_KEEP_DAYS
  trimRollups(now - EVENTS_KEEP_DAYS * DAY).catch((e) => console.error('page-view totals trim failed', e.message));
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
  // an unknown or unpublished funnel is a real 404 (not a 200 page search engines would index)
  if (!f || !draftOk(f, req)) return res.status(404).set('Cache-Control', 'no-cache').type('html').send(indexHtml.replace('<!--ff-head-->', '<meta name="robots" content="noindex">'));
  renderFunnel(req, res, f, req.params.step, { preview });
});
// robots.txt + sitemap of every live funnel on the pages address (funnels on a seller's own domain are listed there instead)
const liveBase = (req) => pagesBase() || appUrl(req);
app.get('/robots.txt', (req, res) => res.set('Cache-Control', 'public, max-age=3600').type('text').send(robotsTxt(liveBase(req))));
app.get('/sitemap.xml', (req, res) => {
  const live = new Map(), urls = [];
  for (const f of T.funnels.iter({}, { order: 'updatedAt', desc: true })) {
    if (!f.published || domainOfFunnel(f.id)) continue;
    if (!live.has(f.userId)) live.set(f.userId, !!accessFor(ownerOf(f)).pagesLive);
    if (live.get(f.userId)) urls.push(...sitemapUrls(f, liveBase(req), false));
    if (urls.length >= 50000) break; // the sitemap format's limit
  }
  res.set('Cache-Control', 'public, max-age=3600').type('application/xml').send(sitemapXml(urls.slice(0, 50000)));
});
function renderFunnel(req, res, f, stepSlug, { domain = null, preview = false } = {}) {
  if (!indexHtml) return res.status(503).type('text').send('The app is not built yet');
  const owner = ownerOf(f);
  if (!accessFor(owner).pagesLive) return res.status(404).type('html').send('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Not available</title><p style="font:16px system-ui;padding:40px;text-align:center">This page isn’t available right now.</p>');
  const base = domain ? `https://${domain}` : appUrl(req);
  const key = JSON.stringify([f.id, f.version || 0, f.updatedAt, f.slug, stepSlug || '', domain, domainOfFunnel(f.id), preview, base, owner?.settings?.supportWhatsapp || '', owner?.settings?.tracking || {}, f.tracking || null, f.seo || null, !!(owner?.settings?.invoicing?.enabled && owner?.settings?.invoicing?.gstin), !!rzpCreds(owner), !!stripeCreds(owner)]);
  let html = cacheGet(key);
  if (!html) {
    html = renderHtml(f, owner, stepSlug, { domain, preview, base });
    cacheSet(key, html);
  }
  // a step hidden from search engines (or a checkout / upsell / thank-you step) says so in a header too
  if (noindexStep(f, f.steps.find((s) => s.slug === stepSlug) || f.steps[0])) res.set('X-Robots-Tag', 'noindex');
  res.set('Cache-Control', 'no-cache').type('html').send(html);
}
function renderHtml(f, owner, stepSlug, { domain, preview, base }) {
  const data = publicData(f, owner);
  const step = data.steps.find((s) => s.slug === stepSlug) || data.steps[0];
  const hero = step.blocks.find((b) => b.type === 'hero')?.props || data.steps[0].blocks.find((b) => b.type === 'hero')?.props || {};
  // Same rule as the browser: SEO title → this step's headline → step + funnel name
  const title = step.seo?.title || plain(step.blocks.find((b) => b.type === 'hero')?.props.headline) || `${step.name} · ${f.name}`;
  const desc = step.seo?.description || plain(hero.subheadline) || f.name;
  // link-preview picture: the hero's image, else the first picture on this step
  const pic = hero.image || step.blocks.map((b) => b.props?.image || b.props?.photo || b.props?.images?.[0]?.src || b.props?.items?.find?.((i) => i?.image)?.image).find((x) => typeof x === 'string' && x) || '';
  const img = pic ? (/^https?:/.test(pic) ? pic : (CDN_URL && pic.startsWith('/uploads/') ? CDN_URL : base) + pic) : '';
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
    preview ? '<meta name="robots" content="noindex">' : noindexStep(f, step) && '<meta name="robots" content="noindex, nofollow">',
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
  // the build's files carry a content hash in their names (/assets/index-AbC123.js): cache them for a year;
  // everything else (index.html, favicon…) is revalidated so a new deploy shows up straight away
  app.use(express.static(dist, { index: false, setHeaders: (res, file) => { if (/[\\/]assets[\\/]/.test(file)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable'); } }));
  app.get('*', (_, res) => res.set('Cache-Control', 'no-cache').type('html').send(indexHtml));
}

const port = process.env.PORT || 4000;
const worker = process.env.WORKER_INDEX;
// anything a route throws (or a malformed JSON body): a JSON error — never an HTML page with the stack trace
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  const status = Number(err.status || err.statusCode) || 500;
  if (status >= 500) { console.error(err); reportError(err, { route: `${req.method} ${req.route?.path || req.path}`, userId: req.user?.id }); }
  res.status(status).json({ error: status >= 500 ? 'Something went wrong — please try again' : err.type === 'entity.parse.failed' ? 'The request body isn’t valid JSON' : err.message || 'Bad request' });
});
app.listen(port, () => { if (!worker || worker === '0') console.log(`FunnelHive API on :${port} (AI ${aiEnabled() ? 'on' : 'off — offline assistant'}${ssr ? ', server rendering on' : ''}${worker ? `, ${process.env.WEB_CONCURRENCY} processes` : ''})`); });
