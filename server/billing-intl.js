// Selling FunnelHive outside India: sellers whose billing country isn't India subscribe in USD / EUR / GBP by card
// through the platform's Stripe account. Same plans, trial and access rules as the ₹ / Razorpay path (billing.js);
// each paid period gets an export invoice (zero-rated under the platform's LUT, otherwise IGST).
//   Admin → Plan & settings: Stripe keys, prices per currency, LUT.  Env: PLATFORM_STRIPE_PUBLISHABLE_KEY,
//   PLATFORM_STRIPE_SECRET_KEY, PLATFORM_STRIPE_WEBHOOK_SECRET win over the admin panel.
//   Stripe webhook: <APP_URL>/api/billing/stripe-webhook — customer.subscription.* and invoice.paid / invoice.payment_failed
import { T, q, uid, tx } from './db.js';
import { platform, savePlatform } from './platform.js';
import { decrypt, encrypt } from './messaging.js';
import { stripe, validStripeWebhook } from './stripe.js';
import { fxRate } from './fx.js';

export const INTL_DEFAULTS = {
  USD: { monthly: 29, yearly: 290, agency_monthly: 99, agency_yearly: 990 },
  EUR: { monthly: 27, yearly: 270, agency_monthly: 92, agency_yearly: 920 },
  GBP: { monthly: 23, yearly: 230, agency_monthly: 79, agency_yearly: 790 },
};
const EUROZONE = ['AT', 'BE', 'HR', 'CY', 'EE', 'FI', 'FR', 'DE', 'GR', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PT', 'SK', 'SI', 'ES'];
export const currencyFor = (country) => (country === 'GB' ? 'GBP' : EUROZONE.includes(country) ? 'EUR' : 'USD');
export const isAbroad = (u) => { const c = u?.billing?.details?.country; return !!c && c !== 'IN'; };
export const intlPrices = () => { const p = platform().intl?.prices || {}; return Object.fromEntries(Object.keys(INTL_DEFAULTS).map((c) => [c, { ...INTL_DEFAULTS[c], ...(p[c] || {}) }])); };
export const intlPrice = (currency, interval) => intlPrices()[currency]?.[interval];

export function platformStripe() {
  const s = platform().stripe || {};
  const publishableKey = process.env.PLATFORM_STRIPE_PUBLISHABLE_KEY || s.publishableKey;
  const secret = process.env.PLATFORM_STRIPE_SECRET_KEY || (s.secretEnc ? decrypt(s.secretEnc) : '');
  if (!publishableKey || !secret) return null;
  return { publishableKey, secret, webhookSecret: process.env.PLATFORM_STRIPE_WEBHOOK_SECRET || (s.webhookSecretEnc ? decrypt(s.webhookSecretEnc) : ''), mode: publishableKey.startsWith('pk_live_') ? 'live' : 'test' };
}

// ---------- invoices for foreign customers ----------
function financialYear(t) { const d = new Date(t + 330 * 60000); const y = d.getUTCFullYear(), m = d.getUTCMonth() + 1; return m >= 4 ? `${y}-${String((y + 1) % 100).padStart(2, '0')}` : `${y - 1}-${String(y % 100).padStart(2, '0')}`; }
export function issueIntlInvoice(u, { key, total, currency, interval, from, to, paymentId, at = Date.now() }) {
  return tx(() => {
    const existing = T.invoices.all({ userId: u.id }).find((i) => i.key === key);
    if (existing) return existing;
    const p = platform(), fy = financialYear(at);
    const seq = T.platform.get(`seq:${fy}`) || { id: `seq:${fy}`, n: 0 };
    seq.n++;
    T.platform.put(seq);
    const registered = !!p.company.gstin, lut = !!p.intl?.lut;
    // export of services: zero-rated under a LUT, otherwise IGST (included in the price)
    const rate = registered && !lut ? p.gstRate : 0;
    const taxable = Math.round((total / (1 + rate / 100)) * 100) / 100, igst = Math.round((total - taxable) * 100) / 100;
    const d = u.billing?.details || {};
    return T.invoices.insert({
      id: uid(), userId: u.id, key, number: `${p.company.invoicePrefix || 'FH'}/${fy}/${String(seq.n).padStart(4, '0')}`, at, status: 'paid', paymentId: paymentId || null,
      interval, period: { from, to }, total, currency, fx: fxRate(currency), export: true, lut: registered && lut,
      registered, taxable, rate, cgst: 0, sgst: 0, igst,
      item: `${p.brand} subscription — ${interval?.startsWith('agency_') ? 'Agency ' : ''}${String(interval).endsWith('yearly') ? 'Yearly' : 'Monthly'} plan`,
      billedTo: { name: d.name || u.name, email: u.email, gstin: '', address: d.address || '', state: '', country: d.country || '' },
      company: { ...p.company }, brand: p.brand, placeOfSupply: 'Outside India',
    });
  });
}

// ---------- keeping our copy of the subscription in step ----------
const STATUS = { active: 'active', trialing: 'active', past_due: 'past_due', unpaid: 'past_due', canceled: 'cancelled', incomplete_expired: 'cancelled', paused: 'past_due' };
export function applyStripeSub(userId, sub, { cancelOld } = {}) {
  let replaced = null;
  const u = T.users.update(userId, (x) => {
    const b = x.billing ||= {};
    if (b.subscriptionId !== sub.id) {
      if (b.pending?.id !== sub.id) return; // an old subscription: ignore
      if (sub.status === 'incomplete') return; // not paid / not set up yet
      if (b.subscriptionId) replaced = { id: b.subscriptionId, provider: b.provider || 'razorpay' };
      Object.assign(b, { subscriptionId: sub.id, provider: 'stripe', interval: b.pending.interval, amount: b.pending.amount, currency: b.pending.currency, stripeCustomer: sub.customer });
      delete b.pending; delete b.cancelAtPeriodEnd; delete b.halted;
    }
    const st = STATUS[sub.status];
    if (st) b.status = st;
    const end = (sub.status === 'trialing' ? sub.trial_end : sub.current_period_end) || 0;
    if (end) b.currentPeriodEnd = Math.max(b.status === 'past_due' ? b.currentPeriodEnd || 0 : 0, end * 1000);
    b.cancelAtPeriodEnd = !!sub.cancel_at_period_end;
    if (sub.status === 'unpaid') b.halted = true; else delete b.halted;
    b.stripeStatus = sub.status; b.syncedAt = Date.now();
  });
  if (replaced && cancelOld) cancelOld(replaced);
  return u;
}

// ---------- routes ----------
export function registerIntlBilling(app, { auth, wrap, rateLimit, isTest, view, cancelRazorpay }) {
  const limiter = rateLimit({ windowMs: 60000, max: isTest ? 1000 : 10, key: (req) => req.user.id, message: 'Please wait a moment and try again.' });
  const cancelOld = (old) => {
    if (old.provider === 'stripe') { const sc = platformStripe(); if (sc) stripe(sc, 'DELETE', `/subscriptions/${old.id}`).catch((e) => console.error('old Stripe subscription cancel failed', e.message)); }
    else cancelRazorpay(old.id);
  };
  const productFor = async (sc, interval) => {
    const k = `${sc.mode}:${interval}`;
    const have = platform().stripe?.products?.[k];
    if (have) return have;
    const p = await stripe(sc, 'POST', '/products', { name: `${platform().brand} ${interval.startsWith('agency_') ? 'Agency ' : ''}${interval.endsWith('yearly') ? 'Yearly' : 'Monthly'}` });
    savePlatform((s) => { s.stripe = { ...s.stripe, products: { ...s.stripe?.products, [k]: p.id } }; });
    return p.id;
  };

  // subscribe: what Stripe's Payment Element needs (card now, or saved for after the trial)
  app.post('/api/billing/subscribe-intl', auth, limiter, wrap(async (req, res) => {
    const u = req.user, b = u.billing || {};
    if (u.agencyId) return res.status(400).json({ error: 'This account is covered by your agency’s plan' });
    if (!isAbroad(u)) return res.status(400).json({ error: 'Choose your country in billing details first' });
    const sc = platformStripe();
    if (!sc) return res.status(503).json({ error: 'International card payments aren’t set up yet — please contact support.' });
    const interval = ['monthly', 'yearly', 'agency_monthly', 'agency_yearly'].includes(req.body?.interval) ? req.body.interval : 'monthly';
    const currency = currencyFor(b.details.country), amount = intlPrice(currency, interval);
    if (!amount) return res.status(400).json({ error: 'That plan isn’t available in your currency' });
    if (b.subscriptionId && ['active', 'past_due'].includes(b.status) && !b.cancelAtPeriodEnd && b.interval === interval) return res.status(409).json({ error: 'You already have this plan' });
    let customer = b.stripeCustomer;
    if (!customer) { customer = (await stripe(sc, 'POST', '/customers', { email: u.email, name: b.details.name || u.name, address: { country: b.details.country, line1: b.details.address || undefined }, metadata: { userId: u.id } })).id; T.users.update(u.id, (x) => { x.billing.stripeCustomer = customer; }); }
    // time already paid for (trial, or the rest of the current period) is honoured: the first charge waits for it
    const startAt = Math.max(b.status === 'trialing' ? b.trialEndsAt || 0 : 0, ['active', 'cancelled'].includes(b.status) ? b.currentPeriodEnd || 0 : 0);
    const later = startAt > Date.now() + 3600000;
    const sub = await stripe(sc, 'POST', '/subscriptions', {
      customer, items: [{ price_data: { currency: currency.toLowerCase(), product: await productFor(sc, interval), unit_amount: Math.round(amount * 100), recurring: { interval: interval.endsWith('yearly') ? 'year' : 'month' } } }],
      ...(later ? { trial_end: Math.floor(startAt / 1000) } : {}),
      payment_behavior: 'default_incomplete', payment_settings: { save_default_payment_method: 'on_subscription' },
      expand: ['latest_invoice.payment_intent', 'pending_setup_intent'], metadata: { userId: u.id, interval },
    }, { idem: `fh-sub-${u.id}-${interval}-${Math.floor(Date.now() / 60000)}` });
    T.users.update(u.id, (x) => { x.billing.pending = { id: sub.id, interval, amount, currency, provider: 'stripe', at: Date.now() }; });
    const pi = sub.latest_invoice?.payment_intent, si = sub.pending_setup_intent;
    res.json({ provider: 'stripe', publishableKey: sc.publishableKey, subscription: sub.id, clientSecret: pi?.client_secret || si?.client_secret, mode: pi ? 'payment' : 'setup', amount, currency, startsLater: later, name: platform().brand, description: `${interval.startsWith('agency_') ? 'Agency ' : ''}${interval.endsWith('yearly') ? 'Yearly' : 'Monthly'} plan` });
  }));
  // the browser finished the Payment Element: read the subscription back from Stripe
  app.post('/api/billing/stripe/confirm', auth, limiter, wrap(async (req, res) => {
    const sc = platformStripe();
    const b = req.user.billing || {};
    const id = String(req.body?.subscription || '');
    if (!sc || (id !== b.pending?.id && id !== b.subscriptionId)) return res.status(400).json({ error: 'Subscription not found' });
    const sub = await stripe(sc, 'GET', `/subscriptions/${id}`, { expand: ['latest_invoice'] });
    if (sub.status === 'incomplete') return res.status(402).json({ error: 'The payment didn’t go through — please try another card' });
    const u = applyStripeSub(req.user.id, sub, { cancelOld });
    const inv = sub.latest_invoice;
    if (inv?.status === 'paid' && inv.amount_paid > 0) issueIntlInvoice(u, { key: inv.id, total: inv.amount_paid / 100, currency: inv.currency.toUpperCase(), interval: u.billing.interval, from: (inv.period_start || 0) * 1000, to: (inv.period_end || 0) * 1000, paymentId: inv.payment_intent || inv.charge || null });
    res.json(view(T.users.get(req.user.id)));
  }));
  // Stripe → platform: renewals, failed payments, cancellations
  app.post('/api/billing/stripe-webhook', wrap(async (req, res) => {
    const sc = platformStripe();
    const raw = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : '';
    if (!sc?.webhookSecret || !validStripeWebhook(sc.webhookSecret, raw, req.headers['stripe-signature'])) return res.status(400).json({ error: 'Invalid signature' });
    let ev;
    try { ev = JSON.parse(raw); } catch { return res.status(400).json({ error: 'Bad JSON' }); }
    const o = ev.data?.object || {};
    const subId = o.object === 'subscription' ? o.id : o.subscription;
    const userId = o.metadata?.userId || (subId && q("SELECT id FROM users WHERE json_extract(data, '$.billing.subscriptionId') = ? OR json_extract(data, '$.billing.pending.id') = ?").get(subId, subId)?.id);
    if (subId && userId && T.users.get(userId)) {
      const sub = o.object === 'subscription' ? o : await stripe(sc, 'GET', `/subscriptions/${subId}`);
      const u = applyStripeSub(userId, sub, { cancelOld });
      if (ev.type === 'invoice.paid' && o.amount_paid > 0 && u?.billing?.subscriptionId === subId) issueIntlInvoice(u, { key: o.id, total: o.amount_paid / 100, currency: String(o.currency).toUpperCase(), interval: u.billing.interval, from: (o.period_start || 0) * 1000, to: (o.period_end || 0) * 1000, paymentId: o.payment_intent || null });
    }
    res.json({ received: true });
  }));
}

// cancelling (billing.js calls this for Stripe subscriptions): at the end of the paid period, or now if nothing was charged
export async function cancelStripeSub(b, now) {
  const sc = platformStripe();
  if (!sc) throw new Error('Stripe isn’t set up');
  return now ? stripe(sc, 'DELETE', `/subscriptions/${b.subscriptionId}`) : stripe(sc, 'POST', `/subscriptions/${b.subscriptionId}`, { cancel_at_period_end: true });
}
// admin settings: keys, prices per currency, LUT
export async function saveIntlSettings(b) {
  const patch = {};
  if (b.stripe) {
    const cur = platform().stripe || {}, s = b.stripe;
    const next = { ...cur };
    if (s.clear) Object.assign(next, { publishableKey: '', secretEnc: '', webhookSecretEnc: '' });
    else {
      if (s.publishableKey != null) { if (s.publishableKey && !/^pk_(test|live)_\w{10,}$/.test(s.publishableKey)) throw new Error('The publishable key starts with pk_test_ or pk_live_'); next.publishableKey = s.publishableKey; }
      if (s.secretKey) { try { await stripe({ secret: s.secretKey }, 'GET', '/balance'); } catch { throw new Error('Stripe rejected that secret key'); } next.secretEnc = encrypt(s.secretKey); }
      if (s.webhookSecret != null) next.webhookSecretEnc = s.webhookSecret ? encrypt(s.webhookSecret) : '';
    }
    patch.stripe = next;
  }
  if (b.intl) {
    const prices = {};
    for (const [c, row] of Object.entries(b.intl.prices || {})) if (INTL_DEFAULTS[c]) for (const [k, v] of Object.entries(row || {})) if (k in INTL_DEFAULTS[c]) { const n = Number(v); if (!(n > 0 && n < 100000)) throw new Error(`Enter a valid ${c} ${k} price`); (prices[c] ||= {})[k] = Math.round(n * 100) / 100; }
    patch.intl = { ...platform().intl, prices: { ...platform().intl?.prices, ...prices }, ...('lut' in b.intl ? { lut: !!b.intl.lut } : {}) };
  }
  if (Object.keys(patch).length) savePlatform((s) => Object.assign(s, patch));
  return patch;
}
export const intlSettingsView = () => { const s = platform().stripe || {}, sc = platformStripe(); return { stripe: { publishableKey: s.publishableKey || '', hasSecret: !!s.secretEnc || !!process.env.PLATFORM_STRIPE_SECRET_KEY, hasWebhookSecret: !!s.webhookSecretEnc || !!process.env.PLATFORM_STRIPE_WEBHOOK_SECRET, ready: !!sc, mode: sc?.mode || null, webhookPath: '/api/billing/stripe-webhook' }, intl: { prices: intlPrices(), lut: !!platform().intl?.lut } }; };
