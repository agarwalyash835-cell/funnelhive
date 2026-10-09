// Subscriptions: every seller starts on a free trial, then pays monthly or yearly through the platform
// owner's Razorpay account (Razorpay Subscriptions: card or UPI Autopay mandates). GST invoices are
// issued for every charge, and AI use is metered in monthly credits.
//
// Access rules (accessFor):
//   trialing → full access until the trial ends
//   active   → full access; a late renewal webhook gets `graceDays` of slack
//   past_due → Razorpay is retrying a failed charge: full access for `graceDays` after the period ended
//   cancelled→ full access until the paid period ends
//   comped   → free access granted by an admin · suspended → blocked by an admin
// When access ends the account is read-only (nothing can be created or edited, automations pause),
// and its live pages stay up `pagesOfflineAfterDays` more days so buyers mid-checkout aren't stranded.
import crypto from 'node:crypto';
import { T, q, sql, tx, uid, JOBS } from './db.js';
import { platform, platformRzp, savePlatform, isAdmin, STATES, GSTIN_RE } from './platform.js';
import { call as rzpCall } from './razorpay.js';
import { sendMail } from './mail.js';
import { registerIntlBilling, applyStripeSub, cancelStripeSub, platformStripe, isAbroad, currencyFor, intlPrices } from './billing-intl.js';
import { stripe as stripeCall } from './stripe.js';
import { TZ_OFFSET, DAY } from './time.js';

sql.exec('CREATE TABLE IF NOT EXISTS usage (k TEXT PRIMARY KEY, userId TEXT NOT NULL, month TEXT NOT NULL, ai INTEGER NOT NULL DEFAULT 0)');

// ---------- access ----------
export function newBilling(now = Date.now()) {
  return { status: 'trialing', trialEndsAt: now + platform().trialDays * DAY, startedAt: now };
}
export function accessFor(u, now = Date.now()) {
  if (!u) return { ok: false, status: 'none', pagesLive: false };
  if (isAdmin(u)) return { ok: true, status: 'admin', pagesLive: true, admin: true };
  // a client account of an agency: covered by the agency's plan
  if (u.agencyId && u.billing?.status !== 'suspended') {
    const a = T.users.get(u.agencyId);
    const x = accessFor(a, now);
    return { ...x, agencyManaged: true, agency: a?.settings?.whiteLabel?.brand || a?.settings?.businessName || a?.name || '', ...(x.ok ? {} : { reason: 'Your agency’s plan has ended — please contact them.' }) };
  }
  if (!u.billing) {
    // accounts created before subscriptions existed get a fresh trial
    u.billing = newBilling(now);
    T.users.update(u.id, (x) => { x.billing ||= u.billing; });
  }
  const b = u.billing, p = platform();
  const grace = p.graceDays * DAY;
  let ok, endsAt;
  switch (b.status) {
    case 'comped': ok = true; break;
    case 'suspended': return { ok: false, status: 'suspended', pagesLive: false, reason: 'This account has been suspended. Please contact support.' };
    case 'trialing': endsAt = b.trialEndsAt; ok = now < endsAt; break;
    case 'active': endsAt = (b.currentPeriodEnd || 0) + grace; ok = now < endsAt; break;
    case 'past_due': endsAt = (b.currentPeriodEnd || 0) + grace; ok = now < endsAt; break;
    case 'cancelled': endsAt = b.currentPeriodEnd || 0; ok = now < endsAt; break;
    default: endsAt = b.trialEndsAt || 0; ok = now < endsAt;
  }
  const out = { ok, status: ok ? b.status : 'expired', planStatus: b.status, interval: b.interval || null, trialEndsAt: b.trialEndsAt || null, currentPeriodEnd: b.currentPeriodEnd || null, cancelAtPeriodEnd: !!b.cancelAtPeriodEnd, endsAt: endsAt || null };
  if (b.status === 'trialing' && ok) out.daysLeft = Math.max(0, Math.ceil((b.trialEndsAt - now) / DAY));
  if (!ok) {
    out.pagesOfflineAt = (endsAt || now) + p.pagesOfflineAfterDays * DAY;
    out.pagesLive = now < out.pagesOfflineAt;
    out.reason = b.status === 'trialing' || !b.status ? 'Your free trial has ended — choose a plan to keep building.' : 'Your subscription has ended — renew to keep building.';
  } else out.pagesLive = true;
  return out;
}
export const pagesLive = (u) => accessFor(u).pagesLive;

// Writes are refused while an account is locked (it can still sign in, look around, pay and export)
const OPEN_WHEN_LOCKED = /^\/api\/(billing|auth|admin|account)(\/|$)/;
export function lockedOut(req) {
  const a = accessFor(req.user);
  req.access = a;
  if (a.ok || req.method === 'GET' || req.method === 'HEAD' || OPEN_WHEN_LOCKED.test(req.originalUrl || req.url)) return null;
  const url = req.originalUrl || req.url;
  if (/^\/api\/funnels\/[\w-]+$/.test(url) && (req.method === 'DELETE' || (req.method === 'PUT' && Object.keys(req.body || {}).every((k) => k === 'published' || k === 'baseVersion') && req.body?.published === false))) return null;
  return a.reason || 'Your subscription is not active.';
}

// ---------- AI credits (per calendar month, India time) ----------
const monthOf = (t = Date.now()) => new Date(t + TZ_OFFSET).toISOString().slice(0, 7);
export const AI_COST = { generate: 5, chat: 1, edit: 1, agent: 1, hive: 1 };
export function creditLimit(u) {
  const a = accessFor(u);
  if (a.admin) return Infinity;
  if (u.creditLimit != null) return u.creditLimit; // set per account by an admin
  return a.planStatus === 'trialing' ? platform().aiCredits.trial : platform().aiCredits.paid;
}
export function creditsUsed(userId, month = monthOf()) {
  return q('SELECT ai FROM usage WHERE k = ?').get(`${userId}:${month}`)?.ai || 0;
}
// Takes `n` credits, or returns an error message when the month's credits are used up
// → a message when this month's credits can't cover n more, else null (nothing is spent)
export function creditsShort(u, n) {
  const limit = creditLimit(u), month = monthOf();
  if (limit === Infinity || creditsUsed(u.id, month) + n <= limit) return null;
  const next = new Date(Date.parse(`${month}-01T00:00:00Z`) + 32 * DAY);
  return `You’ve used this month’s ${limit.toLocaleString('en-IN')} AI credits — they renew on 1 ${next.toLocaleString('en-IN', { month: 'long', timeZone: 'UTC' })}.`;
}
export function spendCredits(u, n) {
  const short = creditsShort(u, n), month = monthOf();
  if (short) return short;
  q('INSERT INTO usage (k, userId, month, ai) VALUES (?, ?, ?, ?) ON CONFLICT(k) DO UPDATE SET ai = ai + excluded.ai').run(`${u.id}:${month}`, u.id, month, n);
  return null;
}
export const usageSummary = (u) => { const limit = creditLimit(u); return { used: creditsUsed(u.id), limit: limit === Infinity ? null : limit, month: monthOf() }; };

// ---------- prices & GST ----------
const r2 = (x) => Math.round(x * 100) / 100;
// What Razorpay charges for an interval (₹, GST included)
export function chargeFor(interval) {
  const p = platform();
  const amount = p.plans[interval].amount;
  return p.pricesIncludeGst || !p.company.gstin ? amount : Math.round(amount * (1 + p.gstRate / 100));
}
function taxSplit(total, sellerState) {
  const p = platform();
  if (!p.company.gstin) return { registered: false, taxable: total, rate: 0, cgst: 0, sgst: 0, igst: 0 };
  const taxable = r2(total / (1 + p.gstRate / 100)), tax = r2(total - taxable);
  const intra = sellerState && sellerState === p.company.state;
  return { registered: true, taxable, rate: p.gstRate, cgst: intra ? r2(tax / 2) : 0, sgst: intra ? r2(tax - r2(tax / 2)) : 0, igst: intra ? 0 : tax };
}
export function pricing() {
  const p = platform();
  const out = {};
  for (const k of INTERVALS) {
    const total = chargeFor(k);
    out[k] = { amount: total, perMonth: k.endsWith('yearly') ? Math.round(total / 12) : total, gstIncluded: true, ...taxSplit(total, p.company.state) };
  }
  out.yearlySaves = out.monthly.amount * 12 - out.yearly.amount;
  out.agencyYearlySaves = out.agency_monthly.amount * 12 - out.agency_yearly.amount;
  out.agencyClients = p.agency.maxClients;
  return out;
}

// ---------- invoices ----------
function financialYear(t) {
  const d = new Date(t + TZ_OFFSET);
  const y = d.getUTCFullYear(), m = d.getUTCMonth() + 1;
  return m >= 4 ? `${y}-${String((y + 1) % 100).padStart(2, '0')}` : `${y - 1}-${String(y % 100).padStart(2, '0')}`;
}
// One invoice per paid period (key = subscription + period start), numbered per financial year
export function issueInvoice(u, { key, total, interval, from, to, paymentId, at = Date.now() }) {
  return tx(() => {
    const existing = T.invoices.all({ userId: u.id }).find((i) => i.key === key);
    if (existing) return existing;
    const p = platform();
    const fy = financialYear(at);
    const seq = T.platform.get(`seq:${fy}`) || { id: `seq:${fy}`, n: 0 };
    seq.n++;
    T.platform.put(seq);
    const d = u.billing?.details || {};
    return T.invoices.insert({
      id: uid(), userId: u.id, key, number: `${p.company.invoicePrefix || 'FH'}/${fy}/${String(seq.n).padStart(4, '0')}`, at, status: 'paid', paymentId: paymentId || null,
      interval, period: { from, to }, total, ...taxSplit(total, d.state),
      item: `${p.brand} subscription — ${planName(interval || 'monthly')} plan`,
      billedTo: { name: d.name || u.name, email: u.email, gstin: d.gstin || '', address: d.address || '', state: d.state || '', stateCode: STATES[d.state] || '' },
      company: { ...p.company, stateCode: STATES[p.company.state] || '' }, brand: p.brand,
    });
  });
}

// ---------- Razorpay Subscriptions ----------
export const INTERVALS = ['monthly', 'yearly', 'agency_monthly', 'agency_yearly'];
const periodOf = (interval) => (interval.endsWith('yearly') ? 'yearly' : 'monthly');
const planName = (interval) => `${interval.startsWith('agency_') ? 'Agency ' : ''}${periodOf(interval) === 'yearly' ? 'Yearly' : 'Monthly'}`;
async function planId(rzp, interval) {
  const amount = chargeFor(interval);
  const known = platform().razorpay.planIds?.[`${rzp.keyId}:${interval}`];
  if (known?.amount === amount) return known.id;
  // plans can't be edited on Razorpay: a new price means a new plan (existing subscribers keep theirs)
  const plan = await rzpCall(rzp, 'POST', '/plans', { period: periodOf(interval), interval: 1, item: { name: `${platform().brand} ${planName(interval)}`, amount: amount * 100, currency: 'INR' } });
  savePlatform((s) => { s.razorpay ||= {}; s.razorpay.planIds = { ...s.razorpay.planIds, [`${rzp.keyId}:${interval}`]: { id: plan.id, amount } }; });
  return plan.id;
}
// Brings our copy of a subscription in line with Razorpay's; issues the invoice for a newly paid period
export function applySubscription(userId, sub, { paymentId } = {}) {
  let invoice = null, replaced = null;
  const u = T.users.update(userId, (x) => {
    const b = (x.billing ||= newBilling());
    if (b.subscriptionId !== sub.id) {
      if (b.pending?.id !== sub.id) return; // an old subscription: ignore
      if (b.subscriptionId && ['authenticated', 'active'].includes(sub.status)) replaced = b.subscriptionId; // a plan switch
      b.subscriptionId = sub.id; b.interval = b.pending.interval; b.amount = b.pending.amount; delete b.pending; delete b.cancelAtPeriodEnd; delete b.halted;
    }
    const end = sub.current_end ? sub.current_end * 1000 : 0;
    switch (sub.status) {
      case 'authenticated': // mandate set up; first charge when the trial / current period ends
        b.status = 'active'; b.currentPeriodEnd = Math.max(b.currentPeriodEnd || 0, b.trialEndsAt || 0, (sub.start_at || 0) * 1000, end); break;
      case 'active': b.status = 'active'; if (end) b.currentPeriodEnd = end; delete b.halted; break;
      case 'pending': b.status = 'past_due'; if (end) b.currentPeriodEnd = Math.max(b.currentPeriodEnd || 0, end); break;
      case 'halted': b.status = 'past_due'; b.halted = true; break;
      case 'cancelled': case 'completed': case 'expired': b.status = 'cancelled'; break;
      default: break;
    }
    b.rzpStatus = sub.status; b.syncedAt = Date.now();
  });
  // switching plans: the old subscription stops (the new one starts when the paid period ends)
  if (replaced) { const rzp = platformRzp(); if (rzp) rzpCall(rzp, 'POST', `/subscriptions/${replaced}/cancel`, { cancel_at_cycle_end: 0 }).catch((e) => console.error('old subscription cancel failed', e.message)); }
  if (u && u.billing?.subscriptionId === sub.id && sub.status === 'active' && sub.current_start) {
    invoice = issueInvoice(u, { key: `${sub.id}:${sub.current_start}`, total: u.billing.amount || chargeFor(u.billing.interval), interval: u.billing.interval, from: sub.current_start * 1000, to: (sub.current_end || 0) * 1000, paymentId });
    T.users.update(userId, (x) => { x.billing.lastPaymentAt = Date.now(); delete x.billing.notified; });
  }
  return { user: u, invoice };
}
const hmac = (secret, data) => crypto.createHmac('sha256', secret).update(data).digest('hex');
const same = (a, b) => typeof a === 'string' && typeof b === 'string' && a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

export function registerBilling(app, { auth, wrap, rateLimit, isTest: test }) {
  const limiter = rateLimit({ windowMs: 60000, max: test ? 1000 : 10, key: (req) => req.user.id, message: 'Please wait a moment and try again.' });
  const view = (u) => {
    const a = accessFor(u), p = platform(), rzp = platformRzp();
    return {
      access: a, details: u.billing?.details || {}, prices: pricing(), trialDays: p.trialDays, credits: usageSummary(u), aiCredits: p.aiCredits,
      ready: !!rzp, mode: rzp?.mode || null, brand: p.brand, states: Object.keys(STATES), companyRegistered: !!p.company.gstin,
      subscriptionId: u.billing?.subscriptionId || null, halted: !!u.billing?.halted, provider: u.billing?.provider || (u.billing?.subscriptionId ? 'razorpay' : null),
      intl: { ready: !!platformStripe(), mode: platformStripe()?.mode || null, abroad: isAbroad(u), currency: isAbroad(u) ? currencyFor(u.billing.details.country) : null, prices: isAbroad(u) ? intlPrices()[currencyFor(u.billing.details.country)] : null, all: intlPrices() },
      invoices: T.invoices.all({ userId: u.id }, { order: 'at', desc: true }).map((i) => ({ id: i.id, number: i.number, at: i.at, total: i.total, currency: i.currency || 'INR', interval: i.interval, period: i.period })),
    };
  };
  app.get('/api/billing', auth, (req, res) => res.json(view(req.user)));

  app.put('/api/billing/details', auth, (req, res) => {
    const b = req.body || {};
    const name = String(b.name || '').trim().slice(0, 120), gstin = String(b.gstin || '').trim().toUpperCase(), state = String(b.state || ''), address = String(b.address || '').trim().slice(0, 300);
    const country = /^[A-Z]{2}$/.test(String(b.country || '')) ? b.country : 'IN';
    if (!name) return res.status(400).json({ error: 'Enter the name to show on invoices' });
    // outside India: billed in USD / EUR / GBP by card, an export invoice — no state or GSTIN
    if (country !== 'IN') { const u = T.users.update(req.user.id, (x) => { x.billing ||= newBilling(); x.billing.details = { name, address, country, gstin: '', state: '' }; }); return res.json(view(u)); }
    if (!STATES[state]) return res.status(400).json({ error: 'Choose your state (needed for GST)' });
    if (gstin && !GSTIN_RE.test(gstin)) return res.status(400).json({ error: 'That GSTIN doesn’t look right — it has 15 characters, e.g. 27ABCDE1234F1Z5' });
    if (gstin && gstin.slice(0, 2) !== STATES[state]) return res.status(400).json({ error: `A ${state} GSTIN starts with ${STATES[state]}` });
    const u = T.users.update(req.user.id, (x) => { x.billing ||= newBilling(); x.billing.details = { name, gstin, state, address, country: 'IN' }; });
    res.json(view(u));
  });

  // 1. Start a subscription: returns what Razorpay Checkout needs
  app.post('/api/billing/subscribe', auth, limiter, wrap(async (req, res) => {
    const interval = INTERVALS.includes(req.body.interval) ? req.body.interval : 'monthly';
    if (req.user.agencyId) return res.status(400).json({ error: 'This account is covered by your agency’s plan' });
    if (isAbroad(req.user)) return res.status(400).json({ error: 'Your billing country is outside India — subscribe by card in your currency', intl: true });
    const rzp = platformRzp();
    if (!rzp) return res.status(503).json({ error: 'Online payments aren’t set up yet — please contact support.' });
    const u = req.user;
    const b = u.billing || newBilling();
    if (!b.details?.state) return res.status(400).json({ error: 'Add your billing details first', needDetails: true });
    const a = accessFor(u);
    if (b.subscriptionId && ['active', 'past_due'].includes(b.status) && !b.cancelAtPeriodEnd && !b.halted && b.interval === interval) return res.status(409).json({ error: 'You already have an active subscription' });
    // paid time left (trial, or a cancelled plan's remaining period) is honoured: the first charge waits for it
    const startAt = Math.max(a.ok && b.status === 'trialing' ? b.trialEndsAt : 0, a.ok && ['cancelled', 'active'].includes(b.status) ? b.currentPeriodEnd || 0 : 0);
    let sub;
    try {
      sub = await rzpCall(rzp, 'POST', '/subscriptions', {
        plan_id: await planId(rzp, interval), total_count: periodOf(interval) === 'yearly' ? 10 : 120, quantity: 1, customer_notify: 1,
        ...(startAt > Date.now() + DAY ? { start_at: Math.floor(startAt / 1000) } : {}),
        notes: { userId: u.id, email: u.email, interval },
      });
    } catch (e) { console.error('Razorpay subscription failed', e.message); return res.status(502).json({ error: 'Couldn’t reach Razorpay — please try again in a minute.' }); }
    T.users.update(u.id, (x) => { x.billing ||= b; x.billing.pending = { id: sub.id, interval, amount: chargeFor(interval), at: Date.now() }; });
    const p = platform();
    res.json({
      key: rzp.keyId, subscription_id: sub.id, name: p.brand, description: `${planName(interval)} plan · ₹${chargeFor(interval).toLocaleString('en-IN')}${startAt > Date.now() + DAY ? ` · first charge on ${new Date(startAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}` : ''}`,
      prefill: { name: b.details.name || u.name, email: u.email }, notes: { userId: u.id }, startsLater: startAt > Date.now() + DAY,
    });
  }));

  // 2. Checkout's signed result
  app.post('/api/billing/verify', auth, limiter, wrap(async (req, res) => {
    const rzp = platformRzp();
    const { razorpay_payment_id: pid, razorpay_subscription_id: sid, razorpay_signature: sig } = req.body || {};
    const b = req.user.billing || {};
    if (!rzp || !sid || (sid !== b.pending?.id && sid !== b.subscriptionId) || !same(hmac(rzp.secret, `${pid}|${sid}`), String(sig || ''))) return res.status(400).json({ error: 'We couldn’t confirm this payment. If money was deducted it will be refunded automatically.' });
    let sub;
    try { sub = await rzpCall(rzp, 'GET', `/subscriptions/${sid}`); } catch { sub = { id: sid, status: 'authenticated' }; }
    if (sub.status === 'created') sub.status = 'authenticated'; // Razorpay can lag a moment behind checkout
    const { user } = applySubscription(req.user.id, sub, { paymentId: pid });
    res.json(view(user));
  }));

  // Cancel: stays active until the paid period ends (immediately if nothing has been charged yet)
  app.post('/api/billing/cancel', auth, limiter, wrap(async (req, res) => {
    const rzp = platformRzp();
    const b = req.user.billing || {};
    if (!b.subscriptionId || !['active', 'past_due'].includes(b.status)) return res.status(400).json({ error: 'There’s no active subscription to cancel' });
    const unpaid = (b.trialEndsAt || 0) >= (b.currentPeriodEnd || 0) && !T.invoices.exists({ userId: req.user.id });
    try { if (b.provider === 'stripe') await cancelStripeSub(b, unpaid); else if (rzp) await rzpCall(rzp, 'POST', `/subscriptions/${b.subscriptionId}/cancel`, { cancel_at_cycle_end: unpaid ? 0 : 1 }); } catch (e) {
      if (e.status !== 400) return res.status(502).json({ error: 'Couldn’t reach Razorpay — please try again in a minute.' });
    }
    const u = T.users.update(req.user.id, (x) => {
      if (unpaid) { x.billing.status = 'trialing'; delete x.billing.subscriptionId; delete x.billing.currentPeriodEnd; }
      else { x.billing.cancelAtPeriodEnd = true; x.billing.status = 'cancelled'; }
    });
    res.json(view(u));
  }));

  app.get('/api/billing/invoices/:iid', auth, (req, res) => {
    const i = T.invoices.get(req.params.iid);
    if (!i || i.userId !== req.user.id) return res.status(404).json({ error: 'Invoice not found' });
    res.json(i);
  });

  // Razorpay → platform webhook (Settings → Webhooks in the platform's Razorpay dashboard)
  app.post('/api/billing/webhook', (req, res) => {
    const rzp = platformRzp();
    const raw = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : '';
    if (!rzp?.webhookSecret || !same(hmac(rzp.webhookSecret, raw), String(req.headers['x-razorpay-signature'] || ''))) return res.status(400).json({ error: 'Invalid signature' });
    let ev;
    try { ev = JSON.parse(raw); } catch { return res.status(400).json({ error: 'Bad JSON' }); }
    const sub = ev.payload?.subscription?.entity;
    if (String(ev.event || '').startsWith('subscription.') && sub?.id) {
      const userId = sub.notes?.userId || q("SELECT id FROM users WHERE json_extract(data, '$.billing.subscriptionId') = ? OR json_extract(data, '$.billing.pending.id') = ?").get(sub.id, sub.id)?.id;
      if (userId && T.users.get(userId)) {
        const { user } = applySubscription(userId, sub, { paymentId: ev.payload?.payment?.entity?.id });
        if (ev.event === 'subscription.halted' && user) notify(user, 'halted');
      }
    }
    res.json({ ok: true });
  });

  registerIntlBilling(app, { auth, wrap, rateLimit, isTest: test, view, cancelRazorpay: (id) => { const r = platformRzp(); if (r) rzpCall(r, 'POST', `/subscriptions/${id}/cancel`, { cancel_at_cycle_end: 0 }).catch((e) => console.error('old Razorpay subscription cancel failed', e.message)); } });
  if (JOBS && !test) { setTimeout(billingJob, 30000).unref(); setInterval(billingJob, 3600000).unref(); }
}

// ---------- background: catch missed webhooks, remind before the trial ends ----------
async function notify(u, kind) {
  const p = platform(), url = `${process.env.APP_URL || ''}/billing`;
  const m = {
    trial3: ['Your free trial ends in 3 days', `Hi ${u.name},\n\nYour ${p.brand} trial ends in 3 days. Choose a plan to keep your funnels, automations and pages running:\n${url}\n\n₹${chargeFor('monthly').toLocaleString('en-IN')}/month or ₹${chargeFor('yearly').toLocaleString('en-IN')}/year.`],
    trial0: ['Your free trial has ended', `Hi ${u.name},\n\nYour ${p.brand} trial has ended, so your account is read-only. Your live pages stay up for ${p.pagesOfflineAfterDays} more days.\n\nChoose a plan to pick up where you left off:\n${url}`],
    halted: ['We couldn’t charge your subscription', `Hi ${u.name},\n\nRazorpay couldn’t collect your ${p.brand} renewal after several tries. Please update your payment method to keep your account running:\n${url}`],
    ended: ['Your subscription has ended', `Hi ${u.name},\n\nYour ${p.brand} subscription has ended and your account is now read-only. Renew any time:\n${url}`],
  }[kind];
  if (m) await sendMail({ to: u.email, subject: m[0], text: m[1] }).catch(() => {});
}
export async function billingJob(now = Date.now()) {
  const rzp = platformRzp();
  for (const row of q("SELECT data FROM users WHERE plan IN ('active', 'past_due', 'trialing', 'cancelled')").iterate()) {
    const u = JSON.parse(row.data);
    const b = u.billing;
    if (isAdmin(u) || !b) continue;
    try {
      // a renewal is due: ask Razorpay (in case its webhook didn't reach us)
      if (b.subscriptionId && ['active', 'past_due'].includes(b.status) && (b.currentPeriodEnd || 0) < now && now - (b.syncedAt || 0) > 3600000) {
        if (b.provider === 'stripe') { const sc = platformStripe(); if (sc) applyStripeSub(u.id, await stripeCall(sc, 'GET', `/subscriptions/${b.subscriptionId}`)); }
        else if (rzp) applySubscription(u.id, await rzpCall(rzp, 'GET', `/subscriptions/${b.subscriptionId}`));
      }
      const sent = b.notified || {};
      const mark = (k) => T.users.update(u.id, (x) => { x.billing.notified = { ...x.billing.notified, [k]: now }; });
      if (b.status === 'trialing' && !b.subscriptionId) {
        if (b.trialEndsAt - now < 3 * DAY && b.trialEndsAt > now && !sent.trial3) { mark('trial3'); notify(u, 'trial3'); }
        if (b.trialEndsAt <= now && !sent.trial0) { mark('trial0'); notify(u, 'trial0'); }
      }
      if (b.status === 'cancelled' && (b.currentPeriodEnd || 0) <= now && !sent.ended) { mark('ended'); notify(u, 'ended'); }
    } catch (e) { console.error('billing sync failed for', u.id, e.message); }
  }
}
