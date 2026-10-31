// Partners: white-label resellers (GoHighLevel "SaaS mode"-style). Three levels of accounts:
//   1. the platform (super admin) — turns an agency into a partner and sets its wholesale terms;
//   2. the partner — an agency with reselling on: sells its own plans and AI-credit packs to the sub-accounts it
//      creates (or that sign up on its own app domain), and collects that money in its own Razorpay;
//   3. the sub-account — a client account (agencyId = the partner) on one of the partner's plans; its owner runs
//      the team (roles & permissions in team.js).
// The platform bills the partner from a prepaid wallet: a fee per active sub-account every 30 days, and the AI
// credits sub-accounts actually use, at the partner's wholesale rate (written by billing.js → spendCredits).
// Sub-accounts without a partner plan stay "covered by the agency" exactly as before.
import bcrypt from 'bcryptjs';
import { T, q, tx, uid, JOBS } from './db.js';
import { platform, platformRzp, isAdmin } from './platform.js';
import { adminCheck, audit } from './admin-guard.js';
import { rzpCreds, createOrder, validPayment } from './razorpay.js';
import { accessFor, usageSummary, resalePlan } from './billing.js';
import { issueInvoice, invoiceUrl } from './sales.js';
import { sendMail, mailEnabled } from './mail.js';
import { randomToken, hashToken } from './security.js';
import { notify } from './notify.js';

const DAY = 86400000;
const clip = (v, n) => String(v ?? '').trim().slice(0, n);
const r2 = (n) => Math.round(n * 100) / 100;
const int = (v, lo, hi, d) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
const money = (n) => Math.min(10000000, Math.max(0, r2(Number(n) || 0)));
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const FEE_DAYS = 30;

// ---------- the partner's terms (set by the platform) ----------
export const isPartner = (u) => !!u?.partner?.enabled;
const termsView = (p = {}) => ({ enabled: !!p.enabled, perAccount: p.perAccount ?? 0, creditRate: p.creditRate ?? 0, maxAccounts: p.maxAccounts ?? 50, since: p.since || null, hold: p.hold || null });
export const clientsOf = (partnerId) => q("SELECT data FROM users WHERE json_extract(data, '$.agencyId') = ?").all(partnerId).map((r) => JSON.parse(r.data));

// ---------- the wallet (₹; credits in, fees and AI usage out) ----------
export const balanceOf = (partnerId) => r2(q("SELECT COALESCE(SUM(json_extract(data, '$.amount')), 0) AS n FROM partnerLedger WHERE partnerId = ?").get(partnerId).n);
export function ledger(partnerId, amount, kind, note, extra = {}) {
  return T.partnerLedger.insert({ id: uid(), partnerId, amount: r2(amount), kind, note: clip(note, 200), at: Date.now(), ...extra });
}
// a partner below the floor (two months of one account's fee in debt) goes on hold; its sub-accounts keep working
// for 7 days (billing.js), then lock until the wallet is topped up
function checkHold(partnerId) {
  const p = T.users.get(partnerId);
  if (!isPartner(p)) return;
  const bal = balanceOf(partnerId), floor = -Math.max(500, (p.partner.perAccount || 0) * 2);
  if (bal < floor && !p.partner.hold) {
    T.users.update(partnerId, (x) => { x.partner.hold = Date.now(); });
    notify(partnerId, { kind: 'payment_failed', title: 'Your partner wallet is overdrawn — top it up within 7 days', body: `Balance ₹${bal.toLocaleString('en-IN')}. Your clients’ accounts pause if it isn’t topped up.`, link: '/agency' });
  } else if (bal >= floor && p.partner.hold) T.users.update(partnerId, (x) => { delete x.partner.hold; });
}

// ---------- the partner's storefront: plans and AI-credit packs ----------
export function cleanResale(b = {}) {
  const plans = (Array.isArray(b.plans) ? b.plans : []).slice(0, 8).map((p) => ({
    id: clip(p?.id, 20) || uid().slice(0, 10), name: clip(p?.name, 40), about: clip(p?.about, 160),
    monthly: money(p?.monthly), yearly: money(p?.yearly), credits: int(p?.credits, 0, 1000000, 0), trialDays: int(p?.trialDays, 0, 60, 0),
  })).filter((p) => p.name && (p.monthly > 0 || p.yearly > 0));
  const packs = (Array.isArray(b.packs) ? b.packs : []).slice(0, 6).map((p) => ({ id: clip(p?.id, 20) || uid().slice(0, 10), credits: int(p?.credits, 1, 1000000, 0), price: money(p?.price) })).filter((p) => p.credits > 0 && p.price > 0);
  return { plans, packs, defaultPlan: plans.some((p) => p.id === b.defaultPlan) ? b.defaultPlan : plans[0]?.id || '' };
}
const resaleOf = (partner) => partner?.settings?.resale || { plans: [], packs: [], defaultPlan: '' };

// a sub-account's plan state as its owner and its partner see it
export function subView(c, partner = T.users.get(c.agencyId)) {
  const s = c.sub;
  if (!s) return null;
  const plan = resalePlan(c, partner);
  return { planId: s.planId, plan: plan ? { name: plan.name, credits: plan.credits } : null, interval: s.interval || 'monthly', status: s.status, trialEndsAt: s.trialEndsAt || null, periodEnd: s.periodEnd || null, extraCredits: c.extraCredits || 0, access: accessFor(c) };
}
// put a sub-account on one of its partner's plans: a trial (the plan's trial days), comped (free, the partner's
// call), or active for a period the partner already collected for (paid outside the app)
export function setSubPlan(clientId, partner, { planId, status = 'trialing', interval = 'monthly', days } = {}) {
  const plan = resaleOf(partner).plans.find((p) => p.id === planId);
  if (!plan) return { error: 'Pick one of your plans' };
  if (!['trialing', 'comped', 'active'].includes(status)) return { error: 'Pick trial, free or active' };
  const now = Date.now(), ivl = interval === 'yearly' ? 'yearly' : 'monthly';
  const c = T.users.update(clientId, (x) => {
    x.sub = { ...(x.sub || {}), planId: plan.id, interval: ivl, status, since: x.sub?.since || now };
    if (status === 'trialing') x.sub.trialEndsAt = now + (Number(days) || plan.trialDays || 14) * DAY;
    if (status === 'active') x.sub.periodEnd = Math.max(now, x.sub.periodEnd || 0) + (Number(days) || (ivl === 'yearly' ? 365 : 30)) * DAY;
  });
  return { sub: subView(c, partner) };
}

// a new sub-account with an owner login (set-password link by email); used by the partner and the super admin
export function createAccount({ email, name, business, partner = null, planId = '', by = 'admin' }) {
  email = clip(email, 200).toLowerCase();
  if (!EMAIL_RE.test(email)) return { error: 'Enter a valid email address' };
  if (T.users.exists({ email })) return { error: 'That email already has an account', status: 409 };
  const id = uid(), now = Date.now();
  const u = { id, email, name: clip(name, 80) || clip(business, 80) || email.split('@')[0], hash: bcrypt.hashSync(randomToken(), 8), passwordSet: false, settings: { businessName: clip(business, 80) || clip(name, 80) }, emailVerified: false, pv: 0, createdAt: now, createdBy: by, invitedAt: now, billing: { status: 'trialing', trialEndsAt: now + platform().trialDays * DAY, startedAt: now } };
  const token = `${id}.${randomToken()}`;
  u.resetHash = hashToken(token); u.resetExp = now + 7 * DAY;
  if (partner) u.agencyId = partner.id;
  tx(() => {
    T.users.insert(u);
    if (partner) T.members.insert({ id: uid(), ownerId: id, userId: partner.id, email: partner.email, role: 'agency', status: 'active', at: now, acceptedAt: now });
  });
  if (partner && planId) setSubPlan(id, partner, { planId, status: 'trialing' });
  return { user: T.users.get(id), token };
}
async function sendWelcome(u, token, base, partner) {
  const brand = partner?.settings?.whiteLabel?.brand || platform().brand;
  const host = partner?.settings?.whiteLabel?.domain ? `https://${partner.settings.whiteLabel.domain}` : base;
  const link = `${host}/reset?token=${token}`;
  await sendMail({ to: u.email, subject: `Your ${brand} account is ready`, text: `Hi ${u.name},\n\nYour ${brand} account for ${u.settings?.businessName || u.name} is ready.\n\nChoose your password to sign in (the link works for 7 days):\n${link}\n\n— ${brand}` }).catch(() => {});
  return mailEnabled() ? null : link;
}

// a sign-up on a partner's own app domain becomes that partner's sub-account, on its default plan's trial
export function partnerForHost(host, brandForHost) {
  const b = brandForHost?.(host);
  if (!b) return null;
  const row = q("SELECT data FROM users WHERE json_extract(data, '$.settings.whiteLabel.domain') = ?").get(String(host).toLowerCase().split(':')[0]);
  const p = row && JSON.parse(row.data);
  return isPartner(p) ? p : null;
}
export function attachSignup(userId, partner) {
  const now = Date.now();
  T.users.update(userId, (x) => { x.agencyId = partner.id; });
  T.members.insert({ id: uid(), ownerId: userId, userId: partner.id, email: partner.email, role: 'agency', status: 'active', at: now, acceptedAt: now });
  const plan = resaleOf(partner).defaultPlan;
  if (plan) setSubPlan(userId, partner, { planId: plan, status: 'trialing' });
}

// ---------- the platform bills partners: per active sub-account, every 30 days ----------
export function partnerJob(now = Date.now()) {
  for (const row of q("SELECT data FROM users WHERE json_extract(data, '$.partner.enabled') = 1").all()) {
    const p = JSON.parse(row.data);
    const fee = p.partner.perAccount || 0;
    for (const c of clientsOf(p.id)) {
      if (!fee || !accessFor(c, now).ok) continue; // a lapsed sub-account isn't billed
      if (c.partnerFeeAt && now - c.partnerFeeAt < FEE_DAYS * DAY) continue;
      tx(() => {
        ledger(p.id, -fee, 'account_fee', `${c.settings?.businessName || c.name} — ${FEE_DAYS} days`, { clientId: c.id });
        T.users.update(c.id, (x) => { x.partnerFeeAt = now; });
      });
    }
    checkHold(p.id);
  }
}

// ---------- routes ----------
export function registerPartners(app, { auth, wrap, rateLimit, isTest, appUrl }) {
  const limiter = rateLimit({ windowMs: 60000, max: isTest ? 1000 : 30, key: (req) => req.user.id });
  const base = (req) => process.env.APP_URL || appUrl(req);
  const adminOnly = (req, res) => { const bad = adminCheck(req); if (bad) { res.status(bad.status).json(bad.body); return false; } return true; }; // admin-guard.js
  const partnerOnly = (req, res) => { if (req.actor || req.apiKey) { res.status(403).json({ error: 'Only the partner account’s owner can do this' }); return false; } if (!isPartner(req.user)) { res.status(403).json({ error: 'Reselling isn’t switched on for this account' }); return false; } return true; };
  const myClient = (req, res) => { const c = T.users.get(req.params.cid); if (!c || c.agencyId !== req.user.id) { res.status(404).json({ error: 'Client account not found' }); return null; } return c; };

  // ---- super admin ----
  app.get('/api/admin/partners', auth, (req, res) => {
    if (!adminOnly(req, res)) return;
    const list = q("SELECT data FROM users WHERE json_extract(data, '$.partner.enabled') = 1 OR json_extract(data, '$.agencyMaxClients') IS NOT NULL OR json_extract(data, '$.settings.whiteLabel.brand') IS NOT NULL").all().map((r) => JSON.parse(r.data));
    res.json(list.map((p) => {
      const cl = clientsOf(p.id);
      return { id: p.id, email: p.email, name: p.name, brand: p.settings?.whiteLabel?.brand || p.settings?.businessName || '', terms: termsView(p.partner), balance: balanceOf(p.id), clients: cl.length, active: cl.filter((c) => accessFor(c).ok).length, onPlans: cl.filter((c) => c.sub).length };
    }));
  });
  app.put('/api/admin/partners/:uid', auth, (req, res) => {
    if (!adminOnly(req, res)) return;
    const p = T.users.get(req.params.uid);
    if (!p || isAdmin(p)) return res.status(404).json({ error: 'Account not found' });
    if (p.agencyId) return res.status(400).json({ error: 'This is a client of another agency — detach it first' });
    const b = req.body || {};
    const terms = { ...(p.partner || {}), enabled: b.enabled !== false, perAccount: money(b.perAccount ?? p.partner?.perAccount ?? 499), creditRate: money(b.creditRate ?? p.partner?.creditRate ?? 25), maxAccounts: int(b.maxAccounts ?? p.partner?.maxAccounts, 1, 10000, 50), since: p.partner?.since || Date.now() };
    const u = T.users.update(p.id, (x) => {
      x.partner = terms;
      x.agencyMaxClients = terms.enabled ? terms.maxAccounts : x.agencyMaxClients;
      // a partner's own workspace is covered by its partnership (it pays through the wallet)
      if (terms.enabled && !['active', 'comped'].includes(x.billing?.status)) x.billing = { ...(x.billing || {}), status: 'comped', compedAt: Date.now(), compedFor: 'partner' };
    });
    audit(req, p.id, 'partner_terms', JSON.stringify(termsView(u.partner)));
    res.json({ id: u.id, terms: termsView(u.partner), balance: balanceOf(u.id) });
  });
  app.post('/api/admin/partners/:uid/wallet', auth, (req, res) => {
    if (!adminOnly(req, res)) return;
    const p = T.users.get(req.params.uid);
    if (!isPartner(p)) return res.status(404).json({ error: 'Partner not found' });
    const amount = r2(Number(req.body?.amount));
    if (!amount || Math.abs(amount) > 10000000) return res.status(400).json({ error: 'Enter an amount (negative to deduct)' });
    ledger(p.id, amount, 'adjust', clip(req.body?.note, 200) || (amount > 0 ? 'Added by the platform' : 'Deducted by the platform'), { by: req.user.email });
    checkHold(p.id);
    audit(req, p.id, 'partner_wallet', `${amount}${req.body?.note ? ` · ${clip(req.body.note, 200)}` : ''}`);
    res.json({ balance: balanceOf(p.id) });
  });
  // run the partner billing now (it also runs every 6 hours): fees for sub-accounts due, holds checked
  app.post('/api/admin/partners/bill-now', auth, (req, res) => { if (!adminOnly(req, res)) return; partnerJob(); audit(req, null, 'partner_bill_now'); res.json({ ok: true }); });
  app.get('/api/admin/partners/:uid/clients', auth, (req, res) => {
    if (!adminOnly(req, res)) return;
    const p = T.users.get(req.params.uid);
    if (!p) return res.status(404).json({ error: 'Account not found' });
    res.json(clientsOf(p.id).map((c) => ({ id: c.id, email: c.passwordSet || c.invitedAt ? c.email : null, business: c.settings?.businessName || c.name, sub: subView(c, p), createdAt: c.createdAt })));
  });
  // create an account directly: an end user (on its own, or under a partner) or a new partner
  app.post('/api/admin/accounts', auth, wrap(async (req, res) => {
    if (!adminOnly(req, res)) return;
    const b = req.body || {};
    const partner = b.partnerId ? T.users.get(b.partnerId) : null;
    if (b.partnerId && !partner) return res.status(404).json({ error: 'Partner not found' });
    const r = createAccount({ email: b.email, name: b.name, business: b.business, partner, planId: b.planId, by: `admin:${req.user.email}` });
    if (r.error) return res.status(r.status || 400).json({ error: r.error });
    let u = r.user;
    if (b.type === 'partner') u = T.users.update(u.id, (x) => { x.partner = { enabled: true, perAccount: money(b.perAccount ?? 499), creditRate: money(b.creditRate ?? 25), maxAccounts: int(b.maxAccounts, 1, 10000, 50), since: Date.now() }; x.agencyMaxClients = x.partner.maxAccounts; x.billing = { ...x.billing, status: 'comped', compedFor: 'partner' }; });
    else if (b.comp && !partner) u = T.users.update(u.id, (x) => { x.billing = { ...x.billing, status: 'comped', compedAt: Date.now() }; });
    const link = await sendWelcome(u, r.token, base(req), partner);
    audit(req, u.id, 'create_account', `${b.type === 'partner' ? 'partner' : 'user'} ${u.email}${partner ? ` under ${partner.email}` : ''}`);
    res.status(201).json({ id: u.id, email: u.email, type: b.type === 'partner' ? 'partner' : 'user', partnerId: partner?.id || null, ...(link ? { link } : {}), ...(isTest ? { token: r.token } : {}) });
  }));
  // move an end user under a partner, to another partner, or make it independent again
  app.put('/api/admin/users/:uid/partner', auth, (req, res) => {
    if (!adminOnly(req, res)) return;
    const c = T.users.get(req.params.uid);
    if (!c || isAdmin(c)) return res.status(404).json({ error: 'Account not found' });
    if (isPartner(c)) return res.status(400).json({ error: 'A partner can’t be moved under another partner' });
    const to = req.body?.partnerId ? T.users.get(req.body.partnerId) : null;
    if (req.body?.partnerId && !isPartner(to)) return res.status(404).json({ error: 'Partner not found' });
    tx(() => {
      if (c.agencyId) q("DELETE FROM members WHERE json_extract(data, '$.ownerId') = ? AND json_extract(data, '$.userId') = ? AND json_extract(data, '$.role') = 'agency'").run(c.id, c.agencyId);
      T.users.update(c.id, (x) => { if (to) x.agencyId = to.id; else { delete x.agencyId; delete x.sub; if (!x.billing || x.billing.status === 'suspended') x.billing = { status: 'trialing', trialEndsAt: Date.now() + platform().trialDays * DAY, startedAt: Date.now() }; } });
      if (to) T.members.insert({ id: uid(), ownerId: c.id, userId: to.id, email: to.email, role: 'agency', status: 'active', at: Date.now(), acceptedAt: Date.now() });
    });
    audit(req, c.id, 'move_account', to ? `to partner ${to.email}` : 'made independent');
    res.json({ ok: true, partnerId: to?.id || null });
  });

  // ---- the partner ----
  app.get('/api/partner', auth, (req, res) => {
    if (req.actor) return res.status(403).json({ error: 'Switch to your own account' });
    if (!isPartner(req.user)) return res.json({ enabled: false });
    const cl = clientsOf(req.user.id), since = Date.now() - 30 * DAY;
    const revenue = q("SELECT COALESCE(SUM(total), 0) AS n FROM orders WHERE userId = ? AND json_extract(data, '$.source') = 'partner' AND at >= ? AND paid = 1").get(req.user.id, since).n;
    res.json({
      enabled: true, terms: termsView(req.user.partner), balance: balanceOf(req.user.id), resale: resaleOf(req.user), payments: !!rzpCreds(req.user), canTopUp: !!platformRzp(),
      ledger: T.partnerLedger.all({ partnerId: req.user.id }, { order: 'at', desc: true, limit: 50 }).map(({ partnerId, ...l }) => l),
      clients: cl.map((c) => ({ id: c.id, business: c.settings?.businessName || c.name, email: c.passwordSet || c.invitedAt ? c.email : null, sub: subView(c, req.user), credits: usageSummary(c) })),
      revenue30: r2(revenue),
    });
  });
  app.put('/api/partner/resale', auth, (req, res) => {
    if (!partnerOnly(req, res)) return;
    const r = cleanResale(req.body || {});
    const inUse = new Set(clientsOf(req.user.id).map((c) => c.sub?.planId).filter(Boolean));
    const gone = [...inUse].filter((id) => !r.plans.some((p) => p.id === id));
    if (gone.length) return res.status(400).json({ error: 'A plan you’re removing still has clients on it — move them to another plan first' });
    const u = T.users.update(req.user.id, (x) => { x.settings = { ...x.settings, resale: r }; });
    res.json({ resale: u.settings.resale });
  });
  app.post('/api/partner/accounts', auth, wrap(async (req, res) => {
    if (!partnerOnly(req, res)) return;
    const max = req.user.partner.maxAccounts || 50;
    if (clientsOf(req.user.id).length >= max) return res.status(402).json({ error: `Your partnership includes ${max} accounts — ask us for more` });
    const b = req.body || {};
    const r = createAccount({ email: b.email, name: b.name, business: b.business, partner: req.user, planId: b.planId, by: `partner:${req.user.id}` });
    if (r.error) return res.status(r.status || 400).json({ error: r.error });
    if (b.planId && b.status && b.status !== 'trialing') setSubPlan(r.user.id, req.user, { planId: b.planId, status: b.status, interval: b.interval, days: b.days });
    const link = await sendWelcome(r.user, r.token, base(req), req.user);
    res.status(201).json({ id: r.user.id, ...(link ? { link } : {}), ...(isTest ? { token: r.token } : {}) });
  }));
  app.put('/api/partner/clients/:cid/plan', auth, (req, res) => {
    if (!partnerOnly(req, res)) return;
    const c = myClient(req, res); if (!c) return;
    if (req.body?.planId === null) { T.users.update(c.id, (x) => { delete x.sub; }); return res.json({ sub: null }); }
    const r = setSubPlan(c.id, req.user, req.body || {});
    if (r.error) return res.status(400).json(r);
    res.json(r);
  });
  app.post('/api/partner/clients/:cid/credits', auth, (req, res) => {
    if (!partnerOnly(req, res)) return;
    const c = myClient(req, res); if (!c) return;
    const n = int(req.body?.credits, -1000000, 1000000, 0);
    if (!n) return res.status(400).json({ error: 'Enter a number of credits' });
    const u = T.users.update(c.id, (x) => { x.extraCredits = Math.max(0, (x.extraCredits || 0) + n); });
    res.json({ extraCredits: u.extraCredits });
  });
  // top up the wallet: the partner pays the platform (platform Razorpay)
  app.post('/api/partner/wallet/topup', auth, limiter, wrap(async (req, res) => {
    if (!partnerOnly(req, res)) return;
    const rzp = platformRzp();
    if (!rzp) return res.status(503).json({ error: 'Online top-ups aren’t switched on yet — contact us to add funds' });
    const amount = money(req.body?.amount);
    if (amount < 500) return res.status(400).json({ error: 'The minimum top-up is ₹500' });
    const pay = { id: uid(), userId: req.user.id, funnelId: null, kind: 'partner_topup', amount, status: 'created', at: Date.now() };
    const o = await createOrder(rzp, { amount: Math.round(amount * 100), receipt: pay.id, notes: { partner: req.user.id, payment: pay.id } });
    T.payments.insert({ ...pay, rzpOrderId: o.id });
    res.json({ payment: pay.id, key: rzp.keyId, order_id: o.id, amount: o.amount, currency: 'INR', name: platform().brand, description: 'Partner wallet top-up', prefill: { email: req.user.email, name: req.user.name } });
  }));
  app.post('/api/partner/wallet/verify', auth, (req, res) => {
    const p = T.payments.get(req.body?.payment);
    if (!p || p.kind !== 'partner_topup' || p.userId !== req.user.id) return res.status(404).json({ error: 'Payment not found' });
    const rzp = platformRzp();
    const { razorpay_order_id: oid, razorpay_payment_id: pid, razorpay_signature: sig } = req.body;
    if (!rzp || oid !== p.rzpOrderId || !validPayment(rzp.secret, oid, pid, sig)) return res.status(400).json({ error: 'We couldn’t confirm this payment — if money was deducted it will be refunded' });
    const done = tx(() => {
      const fresh = T.payments.get(p.id);
      if (fresh.status === 'paid') return false;
      T.payments.update(p.id, (x) => { x.status = 'paid'; x.paymentId = pid; x.paidAt = Date.now(); });
      ledger(req.user.id, fresh.amount, 'topup', 'Wallet top-up', { paymentId: pid });
      return true;
    });
    checkHold(req.user.id);
    res.json({ ok: true, credited: done, balance: balanceOf(req.user.id) });
  });

  // ---- the sub-account: its plan with its partner ----
  const partnerOf = (req) => { const u = req.user; return u.agencyId ? T.users.get(u.agencyId) : null; };
  app.get('/api/partner-billing', auth, (req, res) => {
    const p = partnerOf(req);
    if (!isPartner(p)) return res.json({ resold: false });
    const r = resaleOf(p);
    res.json({ resold: true, brand: p.settings?.whiteLabel?.brand || p.settings?.businessName || p.name, supportEmail: p.settings?.whiteLabel?.supportEmail || p.email, plans: r.plans, packs: r.packs, sub: subView(req.user, p), credits: usageSummary(req.user), canPay: !!rzpCreds(p) });
  });
  app.post('/api/partner-billing/pay', auth, limiter, wrap(async (req, res) => {
    if (req.actor && req.role !== 'admin') return res.status(403).json({ error: 'Only the account owner or an admin can pay' });
    const p = partnerOf(req);
    if (!isPartner(p)) return res.status(404).json({ error: 'Not available' });
    const creds = rzpCreds(p);
    if (!creds) return res.status(400).json({ error: 'Online payment isn’t set up yet — please contact your provider' });
    const r = resaleOf(p), b = req.body || {};
    let charge;
    if (b.kind === 'pack') { const k = r.packs.find((x) => x.id === b.packId); if (!k) return res.status(404).json({ error: 'Pack not found' }); charge = { kind: 'pack', packId: k.id, credits: k.credits, amount: k.price, label: `${k.credits.toLocaleString('en-IN')} AI credits` }; }
    else {
      const pl = r.plans.find((x) => x.id === b.planId); if (!pl) return res.status(404).json({ error: 'Plan not found' });
      const ivl = b.interval === 'yearly' && pl.yearly > 0 ? 'yearly' : 'monthly';
      const amount = ivl === 'yearly' ? pl.yearly : pl.monthly;
      if (!(amount > 0)) return res.status(400).json({ error: 'That plan isn’t sold for this period' });
      charge = { kind: 'plan', planId: pl.id, interval: ivl, amount, label: `${pl.name} plan — ${ivl === 'yearly' ? '1 year' : '1 month'}` };
    }
    const pay = { id: uid(), userId: p.id, clientId: req.user.id, funnelId: null, kind: 'partner_sale', charge, status: 'created', at: Date.now(), base: base(req) };
    const o = await createOrder(creds, { amount: Math.round(charge.amount * 100), receipt: pay.id, notes: { account: req.user.id, payment: pay.id } });
    T.payments.insert({ ...pay, mode: creds.mode, rzpOrderId: o.id });
    res.json({ payment: pay.id, key: creds.keyId, order_id: o.id, amount: o.amount, currency: 'INR', name: p.settings?.whiteLabel?.brand || p.settings?.businessName || p.name, description: charge.label, prefill: { email: req.user.email, name: req.user.name } });
  }));
  app.post('/api/partner-billing/verify', auth, (req, res) => {
    const pay = T.payments.get(req.body?.payment);
    if (!pay || pay.kind !== 'partner_sale' || pay.clientId !== req.user.id) return res.status(404).json({ error: 'Payment not found' });
    const p = T.users.get(pay.userId), creds = rzpCreds(p);
    const { razorpay_order_id: oid, razorpay_payment_id: pid, razorpay_signature: sig } = req.body;
    if (!creds || oid !== pay.rzpOrderId || !validPayment(creds.secret, oid, pid, sig)) return res.status(400).json({ error: 'We couldn’t confirm this payment — if money was deducted it will be refunded' });
    res.json(confirmSale(pay, pid));
  });
}

// a sub-account paid its partner: extend the plan or add the credits, and record the sale (with an invoice in the
// partner's name) in the partner's own orders. Once, even if confirmed twice.
export function confirmSale(pay, paymentId) {
  const r = tx(() => {
    const fresh = T.payments.get(pay.id);
    if (fresh.status === 'paid') return { again: true, result: fresh.result };
    const c = T.users.get(fresh.clientId), p = T.users.get(fresh.userId), ch = fresh.charge, now = Date.now();
    if (ch.kind === 'pack') T.users.update(c.id, (x) => { x.extraCredits = (x.extraCredits || 0) + ch.credits; });
    else T.users.update(c.id, (x) => {
      const keep = x.sub?.status === 'active' && x.sub.planId === ch.planId ? Math.max(now, x.sub.periodEnd || 0) : now;
      x.sub = { ...(x.sub || {}), planId: ch.planId, interval: ch.interval, status: 'active', since: x.sub?.since || now, periodEnd: keep + (ch.interval === 'yearly' ? 365 : 30) * DAY };
    });
    const id = uid();
    const item = { name: ch.label, price: ch.amount, kind: 'main', at: now, paymentId, txn: `${id}-1` };
    const order = T.orders.insert({ id, userId: p.id, funnelId: null, funnelName: 'Plan & credits', email: c.email, name: c.settings?.businessName || c.name, phone: '', items: [item], total: ch.amount, discount: 0, source: 'partner', status: 'paid', provider: 'razorpay', mode: fresh.mode, at: now, paymentId });
    T.payments.update(fresh.id, (x) => { x.status = 'paid'; x.paymentId = paymentId; x.paidAt = now; x.orderId = order.id; });
    return { order, p, c };
  });
  if (r.again) return r.result;
  const inv = issueInvoice(r.p, r.order, [{ index: 0, name: r.order.items[0].name, kind: 'main', amount: r.order.total }], { paymentId });
  const result = { ok: true, sub: subView(T.users.get(r.c.id), r.p), credits: usageSummary(T.users.get(r.c.id)), ...(inv ? { invoice: invoiceUrl(pay.base || '', inv) } : {}) };
  T.payments.update(pay.id, (x) => { x.result = result; });
  notify(r.p.id, { kind: 'order', title: `${r.c.settings?.businessName || r.c.name} paid ₹${r.order.total.toLocaleString('en-IN')} · ${r.order.items[0].name}`, body: 'Paid to your Razorpay', link: '/agency' });
  return result;
}

if (JOBS && process.env.NODE_ENV !== 'test') { setTimeout(() => partnerJob(), 90000).unref(); setInterval(() => partnerJob(), 6 * 3600000).unref(); }
