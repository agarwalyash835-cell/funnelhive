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
import { rzpCreds, createOrder, validPayment, call as rzpCall } from './razorpay.js';
import { accessFor, usageSummary, resalePlan } from './billing.js';
import { issueInvoice, invoiceUrl } from './sales.js';
import { mailEnabled } from './mail.js';
import { sendBranded, agencyForHost } from './whitelabel.js';
import { randomToken, hashToken } from './security.js';
import { notify } from './notify.js';
import { agencyHost } from './tiers.js';
import { termsOf, termsView as unifiedTermsView, termsPatch, setTerms, isReseller, clientsOf as clientsOfAgency, AGENCY_ADDONS } from './agency-terms.js';

const DAY = 86400000;
const clip = (v, n) => String(v ?? '').trim().slice(0, n);
const r2 = (n) => Math.round(n * 100) / 100;
const int = (v, lo, hi, d) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
const cap = (v, lo, hi) => (v === null || v === undefined || v === '' ? null : int(v, lo, hi, null)); // empty = no cap
const money = (n) => Math.min(10000000, Math.max(0, r2(Number(n) || 0)));
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const FEE_DAYS = 30;

// ---------- the partner's terms (set by the platform) ----------
// A partner is an agency of kind 'reseller'; its terms live in user.agency (agency-terms.js, one place for terms)
export const isPartner = (u) => isReseller(u);
const termsView = (u) => unifiedTermsView(u);
export const clientsOf = clientsOfAgency;
// accounts the platform has given agency terms (or that run clients / a white-label): the admin's partner list
const AGENCIES_SQL = "SELECT data FROM users WHERE json_extract(data, '$.agency.kind') IS NOT NULL OR json_extract(data, '$.partner') IS NOT NULL OR json_extract(data, '$.agencyMaxClients') IS NOT NULL OR json_extract(data, '$.settings.whiteLabel.brand') IS NOT NULL";

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
  const t = termsOf(p);
  const bal = balanceOf(partnerId), floor = -Math.max(500, (t.rates.perAccount || 0) * 2);
  if (bal < floor && !t.hold) {
    setTerms(partnerId, (x) => { x.hold = Date.now(); });
    notify(partnerId, { kind: 'payment_failed', title: 'Your partner wallet is overdrawn — top it up within 7 days', body: `Balance ₹${bal.toLocaleString('en-IN')}. Your clients’ accounts pause if it isn’t topped up.`, link: '/agency' });
  } else if (bal >= floor && t.hold) setTerms(partnerId, (x) => { x.hold = null; });
}

// ---------- the partner's storefront: plans and AI-credit packs ----------
export function cleanResale(b = {}) {
  const plans = (Array.isArray(b.plans) ? b.plans : []).slice(0, 8).map((p) => ({
    id: clip(p?.id, 20) || uid().slice(0, 10), name: clip(p?.name, 40), about: clip(p?.about, 160),
    monthly: money(p?.monthly), yearly: money(p?.yearly), credits: int(p?.credits, 0, 1000000, 0), trialDays: int(p?.trialDays, 0, 60, 0),
    // what else the plan gives: add-ons switched on, and caps (empty = the platform's usual limits)
    addons: Array.isArray(p?.addons) ? [...new Set(p.addons.filter((k) => AGENCY_ADDONS.includes(k)))] : [],
    limits: { funnels: cap(p?.limits?.funnels, 1, 100000), storageMB: cap(p?.limits?.storageMB, 50, 1000000), seats: cap(p?.limits?.seats, 1, 1000) },
  })).filter((p) => p.name && (p.monthly > 0 || p.yearly > 0));
  const packs = (Array.isArray(b.packs) ? b.packs : []).slice(0, 6).map((p) => ({ id: clip(p?.id, 20) || uid().slice(0, 10), credits: int(p?.credits, 1, 1000000, 0), price: money(p?.price) })).filter((p) => p.credits > 0 && p.price > 0);
  return { plans, packs, defaultPlan: plans.some((p) => p.id === b.defaultPlan) ? b.defaultPlan : plans[0]?.id || '' };
}
const resaleOf = (partner) => partner?.settings?.resale || { plans: [], packs: [], defaultPlan: '' };

// a sub-account's plan state as its owner and its partner see it
export const autopayView = (c) => (c?.autopay ? { status: c.autopay.status, planId: c.autopay.planId, interval: c.autopay.interval, amount: c.autopay.amount, nextAt: c.autopay.nextAt || null } : null);
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
  return { sub: subView(applyPlanPerks(c.id, partner), partner) };
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
  // in the partner's brand, the link on its own app domain once DNS has proven it (whitelabel.js)
  let link = '';
  await sendBranded(partner || u, null, (b) => {
    const brand = b.name;
    link = `${(b.agencyId && b.linkBase) || base}/reset?token=${token}`;
    return { to: u.email, subject: `Your ${brand} account is ready`, text: `Hi ${u.name},\n\nYour ${brand} account for ${u.settings?.businessName || u.name} is ready.\n\nChoose your password to sign in (the link works for 7 days):\n${link}\n\n— ${brand}` };
  }).catch(() => {});
  return mailEnabled() ? null : link;
}

// a sign-up on a partner's own app domain becomes that partner's sub-account, on its default plan's trial
export function partnerForHost(host, brandForHost) {
  const b = brandForHost?.(host);
  if (!b) return null;
  // the account whose DNS proved the domain (not an unproven claim on it — whitelabel.js)
  const p = agencyForHost(host);
  return isPartner(p) ? p : null;
}
export function attachSignup(userId, partner) {
  const now = Date.now();
  T.users.update(userId, (x) => { x.agencyId = partner.id; });
  T.members.insert({ id: uid(), ownerId: userId, userId: partner.id, email: partner.email, role: 'agency', status: 'active', at: now, acceptedAt: now });
  const plan = resaleOf(partner).defaultPlan;
  if (plan) setSubPlan(userId, partner, { planId: plan, status: 'trialing' });
}

// ---------- what a plan gives beyond AI credits ----------
// The plan's add-ons are switched on (and the ones a previous plan gave switched off again), and its caps on funnels,
// storage and team seats apply (limits.js, agency-terms.js seatCapError). Run whenever a client's plan or the plan
// itself changes; a client with no plan keeps only what its agency switched on by hand.
export function applyPlanPerks(clientId, partner = null) {
  return T.users.update(clientId, (x) => {
    const plan = resalePlan(x, partner || T.users.get(x.agencyId));
    const was = x.planAddons || [], now = plan?.addons || [];
    x.addons = { ...(x.addons || {}) };
    for (const k of was) if (!now.includes(k)) x.addons[k] = false;
    for (const k of now) x.addons[k] = true;
    x.planAddons = now;
    x.planLimits = Object.fromEntries(Object.entries(plan?.limits || {}).filter(([, v]) => v != null));
  });
}

// ---------- auto-pay: a client's plan renewed by a Razorpay subscription on its partner's own account ----------
// No webhook for the partner to set up: verify records the first payment, and autopayJob reads each subscription's
// paid invoices every few hours (and when the client opens Plan & billing), recording each new one as a sale once.
// The auto-pay lives in client.autopay, apart from client.sub, so an unfinished checkout never changes the plan.
export const AUTOPAY_END = ['cancelled', 'completed', 'expired', 'halted'];
export const autopayOn = (c) => !!c?.autopay?.id && !AUTOPAY_END.includes(c.autopay.status) && c.autopay.status !== 'created';
async function rzpPlanFor(creds, partner, plan, ivl) {
  const amount = ivl === 'yearly' ? plan.yearly : plan.monthly, key = `${creds.keyId}:${plan.id}:${ivl}`;
  const known = partner.settings?.resaleRzpPlans?.[key];
  if (known?.amount === amount) return known.id;
  // Razorpay plans can't be edited: a new price is a new plan (clients already on auto-pay keep theirs)
  const r = await rzpCall(creds, 'POST', '/plans', { period: ivl, interval: 1, item: { name: `${plan.name} (${ivl})`.slice(0, 60), amount: Math.round(amount * 100), currency: 'INR' } });
  T.users.update(partner.id, (x) => { x.settings = { ...x.settings, resaleRzpPlans: { ...(x.settings?.resaleRzpPlans || {}), [key]: { id: r.id, amount } } }; });
  return r.id;
}
export async function syncAutopay(clientId) {
  const c = T.users.get(clientId), ap = c?.autopay;
  if (!ap?.id || AUTOPAY_END.includes(ap.status)) return;
  const p = T.users.get(c.agencyId), creds = rzpCreds(p);
  if (!isPartner(p) || !creds) return;
  const sub = await rzpCall(creds, 'GET', `/subscriptions/${ap.id}`);
  const inv = await rzpCall(creds, 'GET', `/invoices?subscription_id=${ap.id}&count=100`).catch(() => ({ items: [] }));
  for (const i of (inv.items || []).filter((x) => x.status === 'paid' && x.payment_id).reverse()) {
    // claim the invoice first, so verify and the job running at once record it a single time
    let fresh = false;
    T.users.update(c.id, (x) => { const done = x.autopay?.invoices || []; if (x.autopay?.id === ap.id && !done.includes(i.id)) { x.autopay.invoices = [...done, i.id].slice(-60); fresh = true; } });
    if (!fresh) continue;
    const plan = resaleOf(p).plans.find((x) => x.id === ap.planId);
    const charge = { kind: 'plan', planId: ap.planId, interval: ap.interval, amount: r2((i.amount_paid ?? i.amount ?? ap.amount * 100) / 100), label: `${plan?.name || 'Plan'} plan — ${ap.interval === 'yearly' ? '1 year' : '1 month'} (auto-pay)` };
    const pay = T.payments.insert({ id: uid(), userId: p.id, clientId: c.id, funnelId: null, kind: 'partner_sale', autopay: ap.id, charge, status: 'created', at: Date.now(), base: process.env.APP_URL || '' });
    confirmSale(pay, i.payment_id);
  }
  T.users.update(c.id, (x) => { if (x.autopay?.id === ap.id) Object.assign(x.autopay, { status: sub.status === 'created' ? ap.status : sub.status, nextAt: sub.charge_at ? sub.charge_at * 1000 : null, syncedAt: Date.now() }); });
}
export async function autopayJob() {
  for (const row of q("SELECT data FROM users WHERE json_extract(data, '$.autopay.id') IS NOT NULL").all()) {
    const c = JSON.parse(row.data);
    if (autopayOn(c)) await syncAutopay(c.id).catch((e) => console.error('auto-pay sync failed', c.id, e.message));
  }
}

// ---------- reminders: a client paying by hand hears 3 days before its plan (or trial) ends ----------
export async function renewalReminders(now = Date.now()) {
  let sent = 0;
  for (const row of q("SELECT data FROM users WHERE json_extract(data, '$.sub.planId') IS NOT NULL AND json_extract(data, '$.agencyId') IS NOT NULL").all()) {
    const c = JSON.parse(row.data), s = c.sub;
    if (autopayOn(c)) continue;
    const end = s.status === 'active' ? s.periodEnd : s.status === 'trialing' ? s.trialEndsAt : 0;
    if (!end || end - now > 3 * DAY || end < now || s.remindedFor === end) continue;
    const p = T.users.get(c.agencyId);
    if (!isPartner(p)) continue;
    T.users.update(c.id, (x) => { x.sub.remindedFor = end; });
    const plan = resalePlan(c, p), when = new Date(end).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', timeZone: 'Asia/Kolkata' });
    const what = s.status === 'trialing' ? 'Your free trial' : `Your ${plan?.name ? `${plan.name} ` : ''}plan`;
    notify(c.id, { kind: 'payment_failed', title: `${what} ends on ${when}`, body: 'Renew in Plan & billing, or switch on auto-pay, to keep your account running.', link: '/billing' });
    await sendBranded(p, null, (b) => ({ to: c.email, subject: `${what} ends on ${when}`, text: `Hi ${c.name},\n\n${what} for ${c.settings?.businessName || c.name} ends on ${when}.\n\nRenew it, or switch on auto-pay so you never have to think about it:\n${(b.agencyId && b.linkBase) || process.env.APP_URL || ''}/billing\n\n— ${b.name}` })).catch(() => {});
    sent++;
  }
  return sent;
}

// ---------- the platform bills partners: per active sub-account, every 30 days ----------
export function partnerJob(now = Date.now()) {
  for (const row of q("SELECT data FROM users WHERE json_extract(data, '$.partner.enabled') = 1 OR json_extract(data, '$.agency.kind') = 'reseller'").all()) {
    const p = JSON.parse(row.data);
    if (!isPartner(p)) continue;
    const fee = termsOf(p).rates.perAccount || 0;
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
  // /api/admin/agencies* are the same routes under the unified name (the partner screens keep the old paths)
  const listAgencies = (req, res) => {
    if (!adminOnly(req, res)) return;
    const list = q(AGENCIES_SQL).all().map((r) => JSON.parse(r.data)).filter((p) => !p.agencyId);
    res.json(list.map((p) => {
      const cl = clientsOf(p.id);
      return { id: p.id, email: p.email, name: p.name, brand: p.settings?.whiteLabel?.brand || p.settings?.businessName || '', terms: termsView(p), balance: balanceOf(p.id), clients: cl.length, active: cl.filter((c) => accessFor(c).ok).length, onPlans: cl.filter((c) => c.sub).length };
    }));
  };
  app.get(['/api/admin/partners', '/api/admin/agencies'], auth, listAgencies);
  // the agency's terms, in one place: kind (agency / reseller), max clients, add-ons it may switch on for its
  // clients, team seats per client, wholesale rates, status. Old body (enabled, maxAccounts…) still works.
  const putTerms = (req, res) => {
    if (!adminOnly(req, res)) return;
    const p = T.users.get(req.params.uid);
    if (!p || isAdmin(p)) return res.status(404).json({ error: 'Account not found' });
    if (p.agencyId) return res.status(400).json({ error: 'This is a client of another agency — detach it first' });
    const u = setTerms(p.id, (t) => termsPatch(t, req.body || {}));
    // a partner's own workspace is covered by its partnership (it pays through the wallet)
    if (isPartner(u) && !['active', 'comped'].includes(u.billing?.status)) T.users.update(u.id, (x) => { x.billing = { ...(x.billing || {}), status: 'comped', compedAt: Date.now(), compedFor: 'partner' }; });
    audit(req, u.id, 'partner_terms', JSON.stringify(termsView(T.users.get(u.id))));
    res.json({ id: u.id, terms: termsView(T.users.get(u.id)), balance: balanceOf(u.id) });
  };
  app.put(['/api/admin/partners/:uid', '/api/admin/agencies/:uid'], auth, putTerms);
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
    if (b.type === 'agency') {
      // an agency: runs its clients' accounts on the platform's plans; it signs in on the agency address
      setTerms(u.id, (t) => termsPatch(t, { kind: 'agency', maxClients: b.maxClients || null, addons: b.addons, seatCap: b.seatCap ?? null }));
      if (b.comp) u = T.users.update(u.id, (x) => { x.billing = { ...x.billing, status: 'comped', compedFor: 'agency', compedAt: Date.now() }; });
    }
    else if (b.type === 'partner') {
      setTerms(u.id, (t) => termsPatch(t, { kind: 'reseller', perAccount: b.perAccount ?? 499, creditRate: b.creditRate ?? 25, maxClients: b.maxAccounts ?? b.maxClients ?? 50, addons: b.addons, seatCap: b.seatCap ?? null }));
      u = T.users.update(u.id, (x) => { x.billing = { ...x.billing, status: 'comped', compedFor: 'partner' }; });
    }
    else if (b.comp && !partner) u = T.users.update(u.id, (x) => { x.billing = { ...x.billing, status: 'comped', compedAt: Date.now() }; });
    const type = ['partner', 'agency'].includes(b.type) ? b.type : 'user';
    // agencies and partners set their password on the agency address, once the platform has one
    const link = await sendWelcome(u, r.token, type !== 'user' && agencyHost() ? `https://${agencyHost()}` : base(req), partner);
    audit(req, u.id, 'create_account', `${type} ${u.email}${partner ? ` under ${partner.email}` : ''}`);
    res.status(201).json({ id: u.id, email: u.email, type, partnerId: partner?.id || null, ...(link ? { link } : {}), ...(isTest ? { token: r.token } : {}) });
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
      enabled: true, terms: termsView(req.user), balance: balanceOf(req.user.id), resale: resaleOf(req.user), payments: !!rzpCreds(req.user), canTopUp: !!platformRzp(),
      ledger: T.partnerLedger.all({ partnerId: req.user.id }, { order: 'at', desc: true, limit: 50 }).map(({ partnerId, ...l }) => l),
      clients: cl.map((c) => ({ id: c.id, business: c.settings?.businessName || c.name, email: c.passwordSet || c.invitedAt ? c.email : null, sub: subView(c, req.user), autopay: autopayOn(c) ? autopayView(c) : null, credits: usageSummary(c) })),
      revenue30: r2(revenue),
    });
  });
  app.put('/api/partner/resale', auth, (req, res) => {
    if (!partnerOnly(req, res)) return;
    const r = cleanResale(req.body || {});
    const inUse = new Set(clientsOf(req.user.id).map((c) => c.sub?.planId).filter(Boolean));
    const gone = [...inUse].filter((id) => !r.plans.some((p) => p.id === id));
    if (gone.length) return res.status(400).json({ error: 'A plan you’re removing still has clients on it — move them to another plan first' });
    const allowed = termsOf(req.user).addons || [];
    const no = r.plans.flatMap((p) => p.addons).find((k) => !allowed.includes(k));
    if (no) return res.status(403).json({ error: `Your agency plan doesn’t include the ${no} add-on for clients — contact support`, addon: no });
    const u = T.users.update(req.user.id, (x) => { x.settings = { ...x.settings, resale: r }; });
    for (const c of clientsOf(req.user.id)) if (c.sub?.planId) applyPlanPerks(c.id, u);
    res.json({ resale: u.settings.resale });
  });
  app.post('/api/partner/accounts', auth, wrap(async (req, res) => {
    if (!partnerOnly(req, res)) return;
    const max = termsOf(req.user).maxClients || 50;
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
    if (req.body?.planId === null) { T.users.update(c.id, (x) => { delete x.sub; }); applyPlanPerks(c.id, req.user); return res.json({ sub: null }); }
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
    const c = req.user;
    if (autopayOn(c) && Date.now() - (c.autopay.syncedAt || 0) > 15 * 60000) syncAutopay(c.id).catch(() => {});
    res.json({ autopay: autopayView(c), canAutopay: !!rzpCreds(p), resold: true, brand: p.settings?.whiteLabel?.brand || p.settings?.businessName || p.name, supportEmail: p.settings?.whiteLabel?.supportEmail || p.email, plans: r.plans, packs: r.packs, sub: subView(req.user, p), credits: usageSummary(req.user), canPay: !!rzpCreds(p) });
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
    if (req.actor && req.role !== 'admin') return res.status(403).json({ error: 'Only the account owner or an admin can pay' }); // as /pay
    const pay = T.payments.get(req.body?.payment);
    if (!pay || pay.kind !== 'partner_sale' || pay.clientId !== req.user.id) return res.status(404).json({ error: 'Payment not found' });
    const p = T.users.get(pay.userId), creds = rzpCreds(p);
    const { razorpay_order_id: oid, razorpay_payment_id: pid, razorpay_signature: sig } = req.body;
    if (!creds || oid !== pay.rzpOrderId || !validPayment(creds.secret, oid, pid, sig)) return res.status(400).json({ error: 'We couldn’t confirm this payment — if money was deducted it will be refunded' });
    res.json(confirmSale(pay, pid));
  });
  // auto-pay: the client approves a Razorpay subscription (card, or UPI AutoPay) on its partner's account
  const payer = (req, res) => { if (req.actor && req.role !== 'admin') { res.status(403).json({ error: 'Only the account owner or an admin can pay' }); return null; } const p = partnerOf(req); if (!isPartner(p)) { res.status(404).json({ error: 'Not available' }); return null; } return p; };
  app.post('/api/partner-billing/autopay', auth, limiter, wrap(async (req, res) => {
    const p = payer(req, res); if (!p) return;
    const creds = rzpCreds(p);
    if (!creds) return res.status(400).json({ error: 'Online payment isn’t set up yet — please contact your provider' });
    const pl = resaleOf(p).plans.find((x) => x.id === req.body?.planId);
    if (!pl) return res.status(404).json({ error: 'Plan not found' });
    const ivl = req.body?.interval === 'yearly' && pl.yearly > 0 ? 'yearly' : 'monthly', amount = ivl === 'yearly' ? pl.yearly : pl.monthly;
    if (!(amount > 0)) return res.status(400).json({ error: 'That plan isn’t sold for this period' });
    const c = req.user, s = c.sub;
    if (autopayOn(c)) return res.status(409).json({ error: 'Auto-pay is already on — turn it off first to change plans' });
    // time already paid for (or a trial) on this plan is honoured: the first debit waits for it
    const paidTo = s?.planId === pl.id && accessFor(c).ok ? (s.status === 'active' ? s.periodEnd || 0 : s.status === 'trialing' ? s.trialEndsAt || 0 : 0) : 0;
    const later = paidTo > Date.now() + DAY;
    let sub;
    try {
      sub = await rzpCall(creds, 'POST', '/subscriptions', { plan_id: await rzpPlanFor(creds, p, pl, ivl), total_count: ivl === 'yearly' ? 10 : 120, quantity: 1, customer_notify: 1, ...(later ? { start_at: Math.floor(paidTo / 1000) } : {}), notes: { clientId: c.id, partnerId: p.id, planId: pl.id, interval: ivl } });
    } catch (e) { console.error('Partner auto-pay subscription failed', e.message); return res.status(502).json({ error: 'Couldn’t reach Razorpay — please try again in a minute.' }); }
    T.users.update(c.id, (x) => { x.autopay = { id: sub.id, planId: pl.id, interval: ivl, amount, status: 'created', at: Date.now(), invoices: [] }; });
    const brand = p.settings?.whiteLabel?.brand || p.settings?.businessName || p.name;
    res.json({ key: creds.keyId, subscription_id: sub.id, name: brand, description: `${pl.name} · ₹${amount.toLocaleString('en-IN')} every ${ivl === 'yearly' ? 'year' : 'month'}${later ? ` · first charge on ${new Date(paidTo).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}` : ''}`, prefill: { email: c.email, name: c.name }, startsLater: later });
  }));
  app.post('/api/partner-billing/autopay/verify', auth, limiter, wrap(async (req, res) => {
    const p = payer(req, res); if (!p) return;
    const creds = rzpCreds(p), { razorpay_payment_id: pid, razorpay_subscription_id: sid, razorpay_signature: sig } = req.body || {};
    // a subscription's checkout signs "payment_id|subscription_id"
    if (!creds || !sid || sid !== req.user.autopay?.id || !validPayment(creds.secret, pid, sid, sig)) return res.status(400).json({ error: 'We couldn’t confirm auto-pay — if money was deducted it will be refunded' });
    T.users.update(req.user.id, (x) => { if (x.autopay.status === 'created') x.autopay.status = 'authenticated'; x.autopay.approvedAt = Date.now(); });
    await syncAutopay(req.user.id).catch((e) => console.error('auto-pay sync failed', e.message));
    const c = T.users.get(req.user.id);
    res.json({ ok: true, autopay: autopayView(c), sub: subView(c, p) });
  }));
  // stop future debits; the time already paid for stays
  app.post('/api/partner-billing/autopay/cancel', auth, limiter, wrap(async (req, res) => {
    const p = payer(req, res); if (!p) return;
    const ap = req.user.autopay;
    if (!ap?.id || AUTOPAY_END.includes(ap.status)) return res.status(404).json({ error: 'Auto-pay isn’t on' });
    const creds = rzpCreds(p);
    if (creds && ap.status !== 'created') { try { await rzpCall(creds, 'POST', `/subscriptions/${ap.id}/cancel`, { cancel_at_cycle_end: 0 }); } catch (e) { return res.status(502).json({ error: 'Couldn’t reach Razorpay — please try again in a minute.' }); } }
    const c = T.users.update(req.user.id, (x) => { x.autopay.status = 'cancelled'; x.autopay.cancelledAt = Date.now(); });
    res.json({ autopay: autopayView(c) });
  }));
  if (isTest) app.post('/api/__test/partner-jobs', wrap(async (req, res) => { await autopayJob(); res.json({ reminders: await renewalReminders(Number(req.body?.now) || Date.now()) }); }));
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
  if (pay.charge.kind === 'plan') applyPlanPerks(r.c.id, r.p);
  const inv = issueInvoice(r.p, r.order, [{ index: 0, name: r.order.items[0].name, kind: 'main', amount: r.order.total }], { paymentId });
  const result = { ok: true, sub: subView(T.users.get(r.c.id), r.p), credits: usageSummary(T.users.get(r.c.id)), ...(inv ? { invoice: invoiceUrl(pay.base || '', inv) } : {}) };
  T.payments.update(pay.id, (x) => { x.result = result; });
  notify(r.p.id, { kind: 'order', title: `${r.c.settings?.businessName || r.c.name} paid ₹${r.order.total.toLocaleString('en-IN')} · ${r.order.items[0].name}`, body: 'Paid to your Razorpay', link: '/agency' });
  return result;
}

const partnerJobs = () => { partnerJob(); autopayJob().catch((e) => console.error('auto-pay job failed', e.message)); renewalReminders().catch((e) => console.error('renewal reminders failed', e.message)); };
if (JOBS && process.env.NODE_ENV !== 'test') { setTimeout(partnerJobs, 90000).unref(); setInterval(partnerJobs, 6 * 3600000).unref(); }
