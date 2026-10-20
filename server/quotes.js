// Quotes / proposals with a pay link — how consultants, coaches and agencies sell a custom engagement.
// The seller writes a quote (line items, currency, an optional deposit, valid-until, terms), sends the private link,
// and the client reads it and pays: Razorpay for ₹, Stripe by card for any currency. Each payment becomes a normal
// order (Orders, refunds, GST / export invoice, contacts, automations, webhooks); with a deposit the balance is paid
// later through the same link.
import crypto from 'node:crypto';
import { T, tx, uid, contactKey } from './db.js';
import { sendEmail } from './messaging.js';
import { waEvent, waReady } from './hive-wa.js';
import { enqueue as fireWebhook } from './webhooks.js';
import { fire as fireAutomation } from './automations.js';
import { rzpCreds, createOrder as rzpCreateOrder, validPayment } from './razorpay.js';
import { stripeCreds, startStripePayment, confirmedIntent, CURRENCIES } from './stripe.js';
import { issueInvoice, invoiceUrl, cleanBuyerGst } from './sales.js';
import { linkBase } from './products.js';
import { fxRate } from './fx.js';
import { notify } from './notify.js';

const DAY = 86400000;
const ISO = [...new Set(Object.values(CURRENCIES))];
const clip = (v, n) => String(v ?? '').trim().slice(0, n);
const r2 = (n) => Math.round(n * 100) / 100;
const total = (q) => r2(q.items.reduce((s, i) => s + i.qty * i.price, 0));
const paidOf = (q) => r2((q.payments || []).reduce((s, p) => s + p.amount, 0));
// what the next payment is: the deposit first (when there is one), then the balance
const dueNow = (q) => { const t = total(q), paid = paidOf(q); if (paid >= t) return 0; return !paid && q.deposit ? r2(Math.min(t, (t * q.deposit) / 100)) : r2(t - paid); };
const sameToken = (a, b) => { const x = Buffer.from(String(a || '')), y = Buffer.from(String(b || '')); return x.length === y.length && crypto.timingSafeEqual(x, y); };
const statusOf = (q, now = Date.now()) => {
  const t = total(q), paid = paidOf(q);
  if (paid > 0) return paid >= t ? 'paid' : 'deposit_paid';
  if (q.status === 'declined') return 'declined';
  if (q.validUntil && q.validUntil < now && q.status !== 'draft') return 'expired';
  return q.status || 'draft';
};

export function cleanQuote(b = {}, cur = {}) {
  const out = {};
  if ('client' in b || !cur.id) {
    const c = b.client || {};
    // GST details checked like a checkout's: a real GSTIN, and the state it was registered in
    const g = cleanBuyerGst({ gstin: c.gstin, company: c.company, state: c.state });
    if (g?.error) return { error: g.error };
    out.client = { name: clip(c.name, 120), email: clip(c.email, 200).toLowerCase(), phone: clip(c.phone, 40), company: clip(c.company, 160), gstin: g?.gstin || '', state: g?.state || '' };
  }
  if ('title' in b || !cur.id) out.title = clip(b.title, 160) || 'Proposal';
  if ('intro' in b || !cur.id) out.intro = clip(b.intro, 5000);
  if ('terms' in b || !cur.id) out.terms = clip(b.terms, 5000);
  if ('items' in b || !cur.id) out.items = (Array.isArray(b.items) ? b.items : []).slice(0, 50).map((i) => ({ name: clip(i?.name, 200), detail: clip(i?.detail, 1000), qty: Math.max(1, Math.min(10000, Math.round(Number(i?.qty) || 1))), price: Math.max(0, Math.min(10000000, r2(Number(i?.price) || 0))) })).filter((i) => i.name);
  if ('currency' in b || !cur.id) out.currency = ISO.includes(b.currency) ? b.currency : cur.currency || 'INR';
  if ('deposit' in b || !cur.id) out.deposit = Math.max(0, Math.min(100, Math.round(Number(b.deposit) || 0)));
  if ('validDays' in b) out.validUntil = Number(b.validDays) > 0 ? Date.now() + Math.min(365, Number(b.validDays)) * DAY : null;
  else if ('validUntil' in b) out.validUntil = Number(b.validUntil) > 0 ? Number(b.validUntil) : null;
  else if (!cur.id) out.validUntil = Date.now() + 14 * DAY;
  return out;
}
const problems = (q) => (!q.items.length ? 'Add at least one item with a price' : total(q) <= 0 ? 'The total must be more than zero' : null);

export const quoteLink = (q, base) => `${base}/q/${q.id}?t=${q.token}`;
const sellerView = (q, base) => ({ ...q, total: total(q), paid: paidOf(q), due: dueNow(q), status: statusOf(q), link: quoteLink(q, base) });
function publicView(q) {
  const owner = T.users.get(q.userId), s = owner?.settings || {};
  const st = statusOf(q);
  const provider = q.currency === 'INR' && rzpCreds(owner) ? 'razorpay' : stripeCreds(owner) ? 'stripe' : null;
  return {
    id: q.id, number: q.number, title: q.title, intro: q.intro, terms: q.terms, items: q.items, currency: q.currency, deposit: q.deposit, validUntil: q.validUntil, at: q.at,
    total: total(q), paid: paidOf(q), due: dueNow(q), status: st, client: { name: q.client.name, company: q.client.company },
    seller: { name: s.businessName || owner?.name || '', email: s.supportEmail || owner?.email || '', whatsapp: s.supportWhatsapp || '' },
    provider, canPay: !!provider && ['draft', 'sent', 'viewed', 'deposit_paid'].includes(st) && dueNow(q) > 0,
    invoices: (q.payments || []).filter((p) => p.invoice).map((p) => ({ amount: p.amount, at: p.at, url: p.invoice })),
  };
}

// a payment arrived (browser or webhook): record the sale once, invoice it, tell everyone
// the browser and the webhook can confirm the same payment at once on different processes: re-read it inside one
// transaction, so the deposit / payment is recorded once
export function confirmQuotePayment(pay, paymentId, base) {
  return tx(() => {
    const fresh = T.payments.get(pay.id) || pay;
    const r = confirmQuotePaymentOnce(fresh, paymentId, base);
    Object.assign(pay, fresh);
    return r;
  });
}
function confirmQuotePaymentOnce(pay, paymentId, base) {
  if (pay.status === 'paid') return pay.result;
  const quote = T.quotes.get(pay.quoteId);
  if (!quote) return null;
  const owner = T.users.get(quote.userId);
  const now = Date.now(), iso = quote.currency, c = quote.client;
  const item = { name: pay.charge.items[0].name, price: pay.charge.total, kind: 'quote', quoteId: quote.id, at: now, paymentId };
  let order;
  tx(() => {
    const ex = quote.orderId && T.orders.get(quote.orderId);
    if (ex) { order = ex; item.txn = `${order.id}-${order.items.length + 1}`; order.items.push(item); order.total = r2(order.total + item.price); T.orders.put(order); }
    else {
      const id = uid();
      item.txn = `${id}-1`;
      order = T.orders.insert({ id, userId: quote.userId, funnelId: null, funnelName: `Quote ${quote.number}`, quoteId: quote.id, email: c.email, name: c.name, phone: c.phone, items: [item], total: item.price, discount: 0, source: 'quote', status: 'paid', at: now, provider: pay.provider || 'razorpay', mode: pay.mode, ...(iso !== 'INR' ? { currency: iso, fx: fxRate(iso) } : {}), ...(pay.stripeCustomer ? { stripeCustomer: pay.stripeCustomer } : {}) });
    }
    pay.status = 'paid'; pay.paymentId = paymentId; pay.paidAt = now;
    T.payments.put(pay);
  });
  const g = c.gstin ? cleanBuyerGst({ gstin: c.gstin, company: c.company || c.name, state: c.state }) : null;
  const gst = g && !g.error ? g : null;
  const inv = issueInvoice(owner, order, [{ index: order.items.length - 1, name: item.name, kind: 'quote', amount: item.price }], { paymentId, gst });
  const link = inv ? invoiceUrl(linkBase(null, base || pay.base), inv) : null;
  const q2 = T.quotes.update(quote.id, (x) => { x.orderId = order.id; (x.payments ||= []).push({ amount: item.price, at: now, paymentId, provider: pay.provider || 'razorpay', ...(link ? { invoice: link } : {}) }); x.status = statusOf(x); x.updatedAt = now; });
  pay.result = { ok: true, status: q2.status, paid: paidOf(q2), due: dueNow(q2), ...(link ? { invoice: link } : {}), orderId: order.id };
  T.payments.put(pay);
  const biz = owner.settings?.businessName || owner.name;
  const money = fmt(item.price, iso);
  waEvent(owner, 'order_receipt', { to: c.phone, params: [String(c.name || '').split(/\s+/)[0] || 'there', quote.title, money], link: link || quoteLink(quote, base || pay.base), entityId: order.id + '-' + order.items.length, ckey: contactKey(c.email, c.phone) });
  if (c.email) sendEmail(owner, { to: c.email, subject: `Payment received — ${quote.title}`, text: `Hi ${c.name.split(/\s+/)[0] || 'there'},\n\nThank you — we received ${money} for “${quote.title}” (${quote.number}).${q2.status === 'deposit_paid' ? ` The balance of ${fmt(dueNow(q2), iso)} can be paid any time from the same link.` : ''}${link ? `\n\nYour invoice: ${link}` : ''}\n\n— ${biz}` }).catch((e) => console.error('quote receipt failed', e.message));
  sendEmail(owner, { to: owner.email, subject: `${c.name || c.email} paid ${money} — ${quote.number}`, text: `${c.name || c.email} paid ${money} for “${quote.title}” (${quote.number}).${q2.status === 'deposit_paid' ? `\nBalance still due: ${fmt(dueNow(q2), iso)}.` : '\nThe quote is now fully paid.'}` }).catch(() => {});
  notify(quote.userId, { kind: 'quote_paid', title: `${q2.status === 'deposit_paid' ? 'Deposit paid' : 'Quote paid'} · ${money} · ${c.name || c.email}${pay.mode === 'test' ? ' (test)' : ''}`, body: `${quote.title} (${quote.number})`, link: '/quotes' });
  const { userId, ...out } = order;
  fireWebhook(quote.userId, 'order.created', { funnel: `Quote ${quote.number}`, ...out, ...(link ? { invoice: link } : {}) });
  fireAutomation(quote.userId, 'purchase', { email: c.email, phone: c.phone, name: c.name, funnelId: null, product: quote.title, amount: item.price, source: 'quote' });
  return pay.result;
}
const fmt = (n, iso) => { try { return new Intl.NumberFormat(iso === 'INR' ? 'en-IN' : 'en-US', { style: 'currency', currency: iso, minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(n); } catch { return `${iso} ${n}`; } };

export function registerQuotes(app, { auth, wrap, rateLimit, isTest, appUrl }) {
  const base = (req) => process.env.APP_URL || appUrl(req);
  const own = (req, res) => { const q = T.quotes.get(req.params.qid); if (!q || q.userId !== req.user.id) { res.status(404).json({ error: 'Quote not found' }); return null; } return q; };
  const limiter = rateLimit({ windowMs: 60000, max: isTest ? 5000 : 30 });

  app.get('/api/quotes', auth, (req, res) => res.json(T.quotes.all({ userId: req.user.id }, { order: 'at', desc: true, limit: 500 }).map((q) => sellerView(q, base(req)))));
  app.get('/api/quotes/:qid', auth, (req, res) => { const q = own(req, res); if (q) res.json(sellerView(q, base(req))); });
  app.post('/api/quotes', auth, (req, res) => {
    if (T.quotes.count({ userId: req.user.id }) >= 2000) return res.status(400).json({ error: 'You have 2,000 quotes — delete old drafts first' });
    const clean = cleanQuote(req.body);
    if (clean.error) return res.status(400).json(clean);
    const seq = T.users.update(req.user.id, (u) => { u.quoteSeq = (u.quoteSeq || 0) + 1; }).quoteSeq;
    const q = T.quotes.insert({ id: uid(), userId: req.user.id, number: `Q-${String(seq).padStart(4, '0')}`, token: crypto.randomBytes(12).toString('hex'), status: 'draft', payments: [], at: Date.now(), updatedAt: Date.now(), ...clean });
    res.json(sellerView(q, base(req)));
  });
  app.put('/api/quotes/:qid', auth, (req, res) => {
    const q = own(req, res); if (!q) return;
    if (paidOf(q) > 0) return res.status(400).json({ error: 'This quote has been paid — duplicate it to make changes' });
    const clean = cleanQuote(req.body, q);
    if (clean.error) return res.status(400).json(clean);
    res.json(sellerView(T.quotes.update(q.id, (x) => { Object.assign(x, clean); if (x.status === 'declined' || x.status === 'expired') x.status = 'draft'; x.updatedAt = Date.now(); }), base(req)));
  });
  app.post('/api/quotes/:qid/duplicate', auth, (req, res) => {
    const q = own(req, res); if (!q) return;
    const seq = T.users.update(req.user.id, (u) => { u.quoteSeq = (u.quoteSeq || 0) + 1; }).quoteSeq;
    const { id, number, token, payments, orderId, status, at, updatedAt, viewedAt, sentAt, validUntil, ...rest } = q;
    res.json(sellerView(T.quotes.insert({ ...rest, id: uid(), number: `Q-${String(seq).padStart(4, '0')}`, token: crypto.randomBytes(12).toString('hex'), status: 'draft', payments: [], at: Date.now(), updatedAt: Date.now(), validUntil: Date.now() + 14 * DAY }), base(req)));
  });
  app.delete('/api/quotes/:qid', auth, (req, res) => {
    const q = own(req, res); if (!q) return;
    if (paidOf(q) > 0) return res.status(400).json({ error: 'A paid quote is kept with its order — it can’t be deleted' });
    T.quotes.del(q.id);
    res.json({ ok: true });
  });
  // email the link to the client (from the seller's email setup)
  app.post('/api/quotes/:qid/send', auth, wrap(async (req, res) => {
    const q = own(req, res); if (!q) return;
    const p = problems(q);
    if (p) return res.status(400).json({ error: p });
    const owner = T.users.get(q.userId), biz = owner.settings?.businessName || owner.name;
    // by email, and on WhatsApp (Hive) when the client has a number — either one is enough
    if (!q.client.email && !(q.client.phone && waReady(owner, 'quote_sent'))) return res.status(400).json({ error: 'Add the client’s email address first' });
    waEvent(owner, 'quote_sent', { to: q.client.phone, params: [q.client.name.split(/\s+/)[0] || 'there', q.title, fmt(total(q), q.currency || 'INR')], link: quoteLink(q, base(req)), entityId: `${q.id}-${q.sentAt || 0}`, ckey: contactKey(q.client.email, q.client.phone) });
    const note = clip(req.body?.message, 2000);
    if (q.client.email) await sendEmail(owner, { to: q.client.email, subject: `${biz}: ${q.title} (${q.number})`, text: `Hi ${q.client.name.split(/\s+/)[0] || 'there'},\n\n${note || `Here’s my proposal for “${q.title}”.`}\n\nView it${dueNow(q) > 0 ? ' and pay securely' : ''} here:\n${quoteLink(q, base(req))}\n\n${q.validUntil ? `Valid until ${new Date(q.validUntil).toDateString()}.\n\n` : ''}— ${biz}` });
    res.json(sellerView(T.quotes.update(q.id, (x) => { if (['draft', 'expired'].includes(statusOf(x))) x.status = 'sent'; x.sentAt = Date.now(); }), base(req)));
  }));

  // --- public: the client's link ---
  const pub = (req, res) => {
    const q = T.quotes.get(req.params.qid);
    if (!q || !sameToken(req.query.t || req.body?.t, q.token)) { res.status(404).json({ error: 'This quote link isn’t valid — ask for a new one' }); return null; }
    return q;
  };
  app.get('/api/q/:qid', limiter, (req, res) => {
    let q = pub(req, res); if (!q) return;
    if (q.status === 'sent' || q.status === 'draft') { if (!req.query.preview) q = T.quotes.update(q.id, (x) => { x.status = 'viewed'; x.viewedAt ||= Date.now(); }); }
    res.set('Cache-Control', 'no-store').json(publicView(q));
  });
  app.post('/api/q/:qid/decline', limiter, (req, res) => {
    const q = pub(req, res); if (!q) return;
    if (paidOf(q) > 0) return res.status(400).json({ error: 'This quote has already been paid' });
    const x = T.quotes.update(q.id, (y) => { y.status = 'declined'; y.declineReason = clip(req.body?.reason, 500); y.updatedAt = Date.now(); });
    const owner = T.users.get(q.userId);
    notify(q.userId, { kind: 'quote_declined', title: `Quote declined · ${q.client.name || q.client.email} · ${q.number}`, body: x.declineReason || q.title, link: '/quotes' });
    sendEmail(owner, { to: owner.email, subject: `${q.client.name || 'Your client'} declined ${q.number}`, text: `${q.client.name || q.client.email} declined “${q.title}” (${q.number}).${x.declineReason ? `\n\nReason: ${x.declineReason}` : ''}` }).catch(() => {});
    res.json(publicView(x));
  });
  // accept & pay: the amount is decided here (deposit or balance), never by the browser
  app.post('/api/q/:qid/pay', limiter, wrap(async (req, res) => {
    const q = pub(req, res); if (!q) return;
    const v = publicView(q);
    if (!v.canPay) return res.status(400).json({ error: v.status === 'expired' ? 'This quote has expired — ask for a new one' : v.status === 'declined' ? 'This quote was declined' : v.status === 'paid' ? 'This quote is already paid' : 'Online payment isn’t set up for this quote — please contact the seller' });
    const owner = T.users.get(q.userId), amount = v.due, iso = q.currency;
    const label = `${q.title} — ${q.number}${q.deposit && !v.paid && amount < v.total ? ` (${q.deposit}% deposit)` : v.paid ? ' (balance)' : ''}`;
    const buyer = { email: q.client.email, name: q.client.name, phone: q.client.phone, source: 'quote' };
    const pay = { id: uid(), userId: q.userId, funnelId: null, kind: 'quote', quoteId: q.id, buyer, charge: { items: [{ name: label, price: amount, kind: 'quote' }], total: amount, discount: 0 }, status: 'created', at: Date.now(), base: base(req), currency: iso };
    try {
      if (v.provider === 'razorpay') {
        const creds = rzpCreds(owner);
        const rz = await rzpCreateOrder(creds, { amount: Math.round(amount * 100), receipt: pay.id, notes: { quote: q.number, payment: pay.id } });
        Object.assign(pay, { mode: creds.mode, rzpOrderId: rz.id });
        T.payments.insert(pay);
        return res.json({ provider: 'razorpay', payment: pay.id, key: creds.keyId, order_id: rz.id, amount: rz.amount, currency: 'INR', name: v.seller.name, description: label.slice(0, 250), prefill: { name: buyer.name, email: buyer.email, contact: buyer.phone } });
      }
      const sc = stripeCreds(owner);
      Object.assign(pay, { mode: sc.mode, provider: 'stripe' });
      const st = await startStripePayment(sc, { userId: q.userId, pay, iso, buyer, description: label });
      Object.assign(pay, { stripeIntent: st.intent, stripeCustomer: st.customer, rzpOrderId: st.intent });
      T.payments.insert(pay);
      return res.json({ ...st, amount, currency: iso, name: v.seller.name, description: label });
    } catch (e) {
      console.error('quote payment failed', e.message);
      return res.status(502).json({ error: 'Payments are temporarily unavailable — please try again in a minute' });
    }
  }));
  const payOf = (req, res, q) => { const p = T.payments.get(req.body?.payment); if (!p || p.kind !== 'quote' || p.quoteId !== q.id) { res.status(404).json({ error: 'Payment not found' }); return null; } return p; };
  app.post('/api/q/:qid/verify', limiter, (req, res) => {
    const q = pub(req, res); if (!q) return;
    const p = payOf(req, res, q); if (!p) return;
    const creds = rzpCreds(T.users.get(q.userId));
    const { razorpay_order_id: oid, razorpay_payment_id: pid, razorpay_signature: sig } = req.body;
    if (!creds || oid !== p.rzpOrderId || !validPayment(creds.secret, oid, pid, sig)) return res.status(400).json({ error: 'We couldn’t confirm this payment. If money was deducted it will be refunded automatically — please contact the seller.' });
    res.json(confirmQuotePayment(p, pid, base(req)));
  });
  app.post('/api/q/:qid/stripe/verify', limiter, wrap(async (req, res) => {
    const q = pub(req, res); if (!q) return;
    const p = payOf(req, res, q); if (!p) return;
    if (p.status === 'paid') return res.json(p.result);
    const sc = stripeCreds(T.users.get(q.userId));
    const id = sc && await confirmedIntent(sc, p).catch(() => null);
    if (!id) return res.status(400).json({ error: 'We couldn’t confirm this payment yet. If money was deducted it will be refunded automatically — please contact the seller.' });
    res.json(confirmQuotePayment(p, id, base(req)));
  }));
}
