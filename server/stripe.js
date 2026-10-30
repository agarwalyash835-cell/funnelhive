// Stripe: international buyers (USD, EUR, GBP…) and cards from anywhere. Each seller connects their own Stripe
// account (publishable + secret key, optional webhook signing secret).
//   one-time   — a PaymentIntent paid in Stripe's Payment Element (on the page, no redirect); the card is saved to
//                a Stripe customer only when the buyer ticked "Save my card for faster checkout" (saveCard), so
//                one-click upsells can charge it off-session — never for INR / Indian cards (RBI: each charge
//                needs the buyer's authentication, so the upsell opens the card form again)
//   membership — a Subscription (monthly / yearly) whose first invoice is paid in the Payment Element
//   instalments— the same, ending after N payments (cancel_at)
// A payment counts only after the server reads it back from Stripe (succeeded, right amount, our payment id),
// from the browser's confirmation or the webhook, whichever comes first.
import crypto from 'node:crypto';
import { T, uid } from './db.js';
import { encrypt, decrypt, setChannel } from './messaging.js';

const API = () => (process.env.STRIPE_API_URL || 'https://api.stripe.com/v1').replace(/\/$/, '');
const SK_RE = /^(sk|rk)_(test|live)_[A-Za-z0-9]{10,200}$/, PK_RE = /^pk_(test|live)_[A-Za-z0-9]{10,200}$/;
// ₹ / $ / € … on a checkout → ISO currency; Stripe amounts are in the smallest unit (cents)
export const CURRENCIES = { '₹': 'INR', $: 'USD', 'US$': 'USD', '€': 'EUR', '£': 'GBP', 'A$': 'AUD', 'C$': 'CAD', 'S$': 'SGD', 'AED': 'AED', 'د.إ': 'AED' };
export const isoOf = (sym) => CURRENCIES[String(sym || '₹').trim()] || (/^[A-Z]{3}$/.test(String(sym || '').trim()) ? String(sym).trim() : 'INR');
export const SYMBOL = { INR: '₹', USD: '$', EUR: '€', GBP: '£', AUD: 'A$', CAD: 'C$', SGD: 'S$', AED: 'AED ' };

export function stripeCreds(u) {
  const s = u?.channels?.stripe;
  if (!s?.secretEnc || !s?.publishableKey) return null;
  return { publishableKey: s.publishableKey, secret: decrypt(s.secretEnc), webhookSecret: s.webhookSecretEnc ? decrypt(s.webhookSecretEnc) : '', mode: s.publishableKey.startsWith('pk_live_') ? 'live' : 'test' };
}
export const stripeStatus = (u) => { const s = u?.channels?.stripe; return { publishableKey: s?.publishableKey || '', hasSecret: !!s?.secretEnc, hasWebhookSecret: !!s?.webhookSecretEnc, mode: s?.publishableKey?.startsWith('pk_live_') ? 'live' : s?.publishableKey ? 'test' : null, configured: !!(s?.secretEnc && s?.publishableKey), webhookUrl: `/api/stripe/webhook/${u.id}` }; };

// Stripe takes form-encoded bodies with nested keys: a[b][0][c]=…
const form = (obj, prefix = '', out = new URLSearchParams()) => {
  for (const [k, v] of Object.entries(obj || {})) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (Array.isArray(v)) v.forEach((x, i) => (typeof x === 'object' ? form(x, `${key}[${i}]`, out) : out.append(`${key}[${i}]`, String(x))));
    else if (typeof v === 'object') form(v, key, out);
    else out.append(key, String(v));
  }
  return out;
};
export async function stripe(c, method, path, params, { idem } = {}) {
  const get = method === 'GET';
  const qs = get && params ? `?${form(params)}` : '';
  const r = await fetch(`${API()}${path}${qs}`, {
    method, headers: { Authorization: `Bearer ${c.secret}`, 'Content-Type': 'application/x-www-form-urlencoded', 'Stripe-Version': '2024-06-20', ...(idem ? { 'Idempotency-Key': idem } : {}) },
    body: get ? undefined : form(params).toString(), signal: AbortSignal.timeout(20000),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(d?.error?.message || `Stripe error ${r.status}`); e.status = r.status; e.code = d?.error?.code; throw e; }
  return d;
}
const minor = (amount, iso) => Math.round(Number(amount) * (['JPY', 'KRW'].includes(iso) ? 1 : 100));

// the buyer as a Stripe customer (one per seller + email), so saved cards work for upsells
async function customerFor(c, userId, buyer) {
  const key = `${c.mode}:${String(buyer.email || '').toLowerCase()}`;
  const row = T.stripecust.find({ userId, key });
  if (row) return row.customerId;
  const cu = await stripe(c, 'POST', '/customers', { email: buyer.email || undefined, name: buyer.name || undefined, phone: buyer.phone || undefined, metadata: { by: 'funnelhive' } });
  try { T.stripecust.insert({ id: uid(), userId, key, customerId: cu.id, at: Date.now() }); } catch {}
  return cu.id;
}

// one-time payment: returns what the Payment Element needs
// saveCard: the buyer's consent to keep the card (RBI card-on-file rules; no tick, nothing is saved)
// what a payment row charges: the whole checkout, or only a COD order's advance (index.js startCodAdvance)
const payAmount = (pay) => pay.prepaid?.amount ?? pay.charge.total;
export async function startStripePayment(c, { userId, pay, iso, buyer, description, saveCard = false }) {
  const customer = await customerFor(c, userId, buyer);
  const pi = await stripe(c, 'POST', '/payment_intents', {
    amount: minor(payAmount(pay), iso), currency: iso.toLowerCase(), customer, description: description.slice(0, 500), receipt_email: buyer.email || undefined,
    automatic_payment_methods: { enabled: true }, ...(saveCard ? { setup_future_usage: 'off_session' } : {}), metadata: { payment: pay.id, funnel: pay.funnelId, ...(saveCard ? { saveCard: 'yes' } : {}) },
  }, { idem: `pi-${pay.id}` });
  return { provider: 'stripe', payment: pay.id, publishableKey: c.publishableKey, clientSecret: pi.client_secret, intent: pi.id, customer };
}
// one-click upsell: charge the card saved at checkout, no form; a card that needs the buyer (3-D Secure) falls back to the form.
// INR, or a card issued in India: never off-session (RBI additional factor of authentication) — null, so the
// buyer confirms in the card form on the page
// Only the exact card that paid this buyer's order, saved with their tick — never another card on the customer
// (customers are per email, and anyone can type an email at checkout)
export async function chargeSaved(c, { pay, iso, customer, pm, description }) {
  if (iso === 'INR' || !pm) return null;
  const card = await stripe(c, 'GET', `/payment_methods/${pm}`);
  if (card.customer !== customer || card.card?.country === 'IN') return null;
  try {
    const pi = await stripe(c, 'POST', '/payment_intents', { amount: minor(pay.charge.total, iso), currency: iso.toLowerCase(), customer, payment_method: pm, off_session: true, confirm: true, description: description.slice(0, 500), metadata: { payment: pay.id, funnel: pay.funnelId } }, { idem: `pi-${pay.id}` });
    return pi;
  } catch (e) {
    if (e.code === 'authentication_required' || e.code === 'card_declined') return null;
    throw e;
  }
}
// membership / instalments: a subscription whose first invoice is paid on the page
export async function startStripeSubscription(c, { userId, pay, iso, buyer, plan, name }) {
  const customer = await customerFor(c, userId, buyer);
  const pkey = crypto.createHash('sha1').update(`${c.mode}|product|${name}`).digest('hex').slice(0, 20);
  let product = T.stripecust.find({ userId, key: pkey })?.customerId;
  if (!product) { product = (await stripe(c, 'POST', '/products', { name: String(name).slice(0, 200), metadata: { by: 'funnelhive' } })).id; try { T.stripecust.insert({ id: uid(), userId, key: pkey, customerId: product, at: Date.now() }); } catch {} }
  const interval = plan.interval === 'yearly' ? 'year' : 'month';
  const now = Math.floor(Date.now() / 1000);
  const extras = pay.charge.items.slice(1).filter((i) => i.price > 0);
  const sub = await stripe(c, 'POST', '/subscriptions', {
    customer, items: [{ price_data: { currency: iso.toLowerCase(), product, unit_amount: minor(plan.amount, iso), recurring: { interval } } }],
    ...(extras.length ? { add_invoice_items: extras.map((i) => ({ price_data: { currency: iso.toLowerCase(), product, unit_amount: minor(i.price, iso) } })) } : {}),
    payment_behavior: 'default_incomplete', payment_settings: { save_default_payment_method: 'on_subscription' },
    // instalments end after the last payment
    ...(plan.type === 'installments' ? { cancel_at: now + (plan.count - 1) * 31 * 86400 + 86400, proration_behavior: 'none' } : {}),
    expand: ['latest_invoice.payment_intent'], metadata: { payment: pay.id, funnel: pay.funnelId },
  }, { idem: `sub-${pay.id}` });
  // the card is kept for the later charges: the buyer is told so in the card form
  const note = `${plan.type === 'installments' ? 'Your card will be saved for the instalments' : 'Your card will be saved for the renewals'}${iso === 'INR' && plan.amount > 15000 ? ' · each charge above ₹15,000 needs your approval in your bank app' : ''}`;
  return { provider: 'stripe', payment: pay.id, publishableKey: c.publishableKey, clientSecret: sub.latest_invoice?.payment_intent?.client_secret, subscription: sub.id, customer, description: `${String(name).slice(0, 200)} — ${note}` };
}
// is this payment really paid? → the PaymentIntent id, or null
export async function confirmedIntent(c, pay) {
  if (pay.stripeSub) {
    const sub = await stripe(c, 'GET', `/subscriptions/${pay.stripeSub}`, { expand: ['latest_invoice.payment_intent'] });
    const pi = sub.latest_invoice?.payment_intent;
    return pi?.status === 'succeeded' && sub.metadata?.payment === pay.id ? pi.id : null;
  }
  const pi = await stripe(c, 'GET', `/payment_intents/${pay.stripeIntent}`);
  // the card the buyer chose to save (setup_future_usage) is the only one one-click upsells may use later
  if (pi.status === 'succeeded' && pi.setup_future_usage === 'off_session' && typeof pi.payment_method === 'string' && pi.metadata?.payment === pay.id && !pay.stripePm) {
    pay.stripePm = pi.payment_method;
    T.payments.update(pay.id, (p) => { p.stripePm = pi.payment_method; });
  }
  return pi.status === 'succeeded' && pi.metadata?.payment === pay.id && pi.amount_received >= minor(payAmount(pay), pay.currency || 'INR') ? pi.id : null;
}
export const stripeRefund = (c, intent, amount, iso, reason) => stripe(c, 'POST', '/refunds', { payment_intent: intent, amount: minor(amount, iso), metadata: { reason: String(reason || '').slice(0, 200) } });

// Stripe-Signature: t=…,v1=… — HMAC-SHA256 of "t.body", within 5 minutes
export function validStripeWebhook(secret, raw, header) {
  if (!secret || !header) return false;
  const parts = Object.fromEntries(String(header).split(',').map((p) => p.split('=')));
  const want = crypto.createHmac('sha256', secret).update(`${parts.t}.${raw}`).digest('hex');
  const got = String(header).split(',').filter((p) => p.startsWith('v1=')).map((p) => p.slice(3));
  return Math.abs(Date.now() / 1000 - Number(parts.t)) < 300 && got.some((g) => g.length === want.length && crypto.timingSafeEqual(Buffer.from(g), Buffer.from(want)));
}

// ---------- settings ----------
export function registerStripeSettings(app, { auth, wrap }) {
  app.get('/api/channels/stripe', auth, (req, res) => res.json(stripeStatus(req.user)));
  app.put('/api/channels/stripe', auth, wrap(async (req, res) => {
    const b = req.body || {};
    if (b.clear) return res.json(stripeStatus(setChannel(req.user.id, 'stripe', undefined)));
    const prev = req.user.channels?.stripe || {};
    const publishableKey = String(b.publishableKey || '').trim();
    if (!PK_RE.test(publishableKey)) return res.status(400).json({ error: 'The publishable key starts with pk_live_ or pk_test_ (Stripe → Developers → API keys)' });
    const secret = String(b.secretKey || '').trim() || (prev.publishableKey === publishableKey && prev.secretEnc ? decrypt(prev.secretEnc) : '');
    if (!SK_RE.test(secret)) return res.status(400).json({ error: 'Paste the secret key (sk_live_… or sk_test_…)' });
    if (secret.split('_')[1] !== publishableKey.split('_')[1]) return res.status(400).json({ error: 'Both keys must be live, or both test' });
    try { await stripe({ secret }, 'GET', '/balance'); } catch (e) { return res.status(400).json({ error: e.status === 401 ? 'Stripe rejected that secret key — copy it again' : `Couldn’t reach Stripe: ${e.message}` }); }
    const wh = String(b.webhookSecret || '').trim();
    if (wh && !/^whsec_[A-Za-z0-9]{10,200}$/.test(wh)) return res.status(400).json({ error: 'The webhook signing secret starts with whsec_' });
    res.json(stripeStatus(setChannel(req.user.id, 'stripe', { publishableKey, secretEnc: encrypt(secret), webhookSecretEnc: wh ? encrypt(wh) : prev.webhookSecretEnc || '', at: Date.now() })));
  }));
}
