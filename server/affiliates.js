// Affiliates / referral program. A seller turns on a program (which funnels / products, commission % or flat ₹ per
// product / funnel with a default, cookie window, approval, hold period, minimum payout, terms); people sign up on the
// program's public page (/affiliate/<slug>) or are invited, and each gets a code: links `…?ref=CODE` and, optionally,
// a coupon of their own.
//
// Attribution: a `?ref=` visit gets a signed click token (POST /api/public/:slug/aff) that the page keeps and sends with
// checkout; recordOrder (index.js) calls attributeOrder once the order exists. The affiliate's coupon beats the link;
// the latest link visit wins within the cookie window; buyers can't refer themselves.
//
// The ledger: one commission per attributed order, recomputed from the order itself (settle), so refunds, COD
// cancellations and returns need no hooks of their own — the job (and every read) brings commissions up to date:
//   awaiting (COD, unpaid) → pending (hold period after the money arrived) → approved → paid (seller marks a payout)
//   …or reversed (fully refunded, cancelled, returned). A partial refund takes the refunded items' commission off.
// Payout details (UPI / bank) are stored encrypted and shown masked; payouts are manual (UPI / bank transfer).
import crypto from 'node:crypto';
import { T, q, tx, uid, JOBS, phoneTail, testOrder } from './db.js';
import { encrypt, decrypt, sendEmail } from './messaging.js';
import { randomToken, hashToken } from './security.js';
import { funnelUrl } from './domains.js';
import { notify } from './notify.js';

const DAY = Number(process.env.AFF_DAY_MS) || 86400000; // tests shorten a "day"
const TICK = Number(process.env.AFF_TICK_MS) || 15 * 60000;
const SESSION_DAYS = 30, LINK_MIN = 30;
const OPEN = ['awaiting', 'pending', 'approved'];
const NOT_COMMISSIONABLE = ['shipping', 'cod_fee'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// link previews, crawlers and scripts don't count as clicks
const BOT_UA = /bot|crawl|spider|slurp|preview|facebookexternalhit|whatsapp|telegram|skype|discord|headless|lighthouse|pingdom|curl|wget|python|httpclient|okhttp|axios|node-fetch|go-http|java\/|libwww|scrapy/i;
const clip = (v, n) => String(v ?? '').trim().slice(0, n);
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const lower = (v) => clip(v, 200).toLowerCase();

let SECRET = 'affiliates';
const mac = (s) => crypto.createHmac('sha256', SECRET).update(`aff:${s}`).digest('base64url').slice(0, 22);
// the click token the page keeps: CODE.<time base36>.<signature> — the server alone decides the click time
export const refToken = (code, at = Date.now()) => `${code}.${at.toString(36)}.${mac(`${code}.${at}`)}`;
function readToken(t) {
  const m = /^([A-Z0-9]{3,20})\.([0-9a-z]{1,12})\.([\w-]{22})$/.exec(String(t || ''));
  if (!m) return null;
  const at = parseInt(m[2], 36), good = mac(`${m[1]}.${at}`);
  return crypto.timingSafeEqual(Buffer.from(good), Buffer.from(m[3])) ? { code: m[1], at } : null;
}

// ---------- the program ----------
const DEFAULTS = { enabled: false, slug: '', name: '', funnelIds: [], productIds: [], defaultRate: { type: 'percent', value: 20 }, rates: [], cookieDays: 30, approval: 'manual', holdDays: 30, minPayout: 500, terms: '', couponDiscount: { type: 'percent', value: 10 }, autoCoupon: false };
export const programOf = (userId) => { const p = T.affprogs.get(userId); return { ...DEFAULTS, ...(p || {}), id: userId, userId }; };
const bizName = (owner) => owner?.settings?.businessName || owner?.name || 'our store';
const slugify = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
function freeSlug(base, userId) {
  let s = slugify(base) || 'partners';
  if (s.length < 3) s = `${s}-partners`;
  while (T.affprogs.exists({ slug: s, userId: { ne: userId } })) s = `${s.slice(0, 34)}-${uid().slice(0, 4)}`;
  return s;
}
function cleanRate(v, { maxPct = 100 } = {}) {
  const type = v?.type === 'flat' ? 'flat' : 'percent';
  const value = Number(v?.value);
  if (!Number.isFinite(value) || value < 0) return { error: 'Enter a commission of 0 or more' };
  if (type === 'percent' && value > maxPct) return { error: `A percentage can be at most ${maxPct}%` };
  if (type === 'flat' && value > 1000000) return { error: 'That amount is too large' };
  return { type, value: r2(value) };
}
function cleanProgram(b, cur, userId) {
  const out = {};
  if ('enabled' in b) out.enabled = !!b.enabled;
  if ('name' in b) out.name = clip(b.name, 80);
  if ('slug' in b) {
    const s = slugify(b.slug);
    if (s.length < 3) return { error: 'The page address needs at least 3 letters or numbers' };
    if (T.affprogs.exists({ slug: s, userId: { ne: userId } })) return { error: 'That page address is taken — try another' };
    out.slug = s;
  }
  if ('funnelIds' in b) { const own = new Set(T.funnels.ids({ userId })); out.funnelIds = [...new Set((Array.isArray(b.funnelIds) ? b.funnelIds : []).map(String))].filter((id) => own.has(id)); }
  if ('productIds' in b) { const own = new Set(T.products.ids({ userId })); out.productIds = [...new Set((Array.isArray(b.productIds) ? b.productIds : []).map(String))].filter((id) => own.has(id)); }
  if ('defaultRate' in b) { const r = cleanRate(b.defaultRate); if (r.error) return r; out.defaultRate = r; }
  if ('rates' in b) {
    const funnels = new Set(T.funnels.ids({ userId })), products = new Set(T.products.ids({ userId }));
    out.rates = [];
    for (const x of (Array.isArray(b.rates) ? b.rates : []).slice(0, 200)) {
      const target = x?.target === 'product' ? 'product' : 'funnel', id = String(x?.id || '');
      if (!(target === 'product' ? products : funnels).has(id)) continue;
      const r = cleanRate(x); if (r.error) return r;
      out.rates = out.rates.filter((y) => !(y.target === target && y.id === id)).concat({ target, id, ...r });
    }
  }
  for (const [k, lo, hi, label] of [['cookieDays', 1, 365, 'cookie window'], ['holdDays', 0, 365, 'hold period'], ['minPayout', 0, 1000000, 'minimum payout']]) if (k in b) {
    const n = Number(b[k]);
    if (!Number.isFinite(n) || n < lo || n > hi) return { error: `The ${label} must be between ${lo} and ${hi.toLocaleString('en-IN')}` };
    out[k] = k === 'minPayout' ? Math.round(n) : Math.round(n * 1000) / 1000;
  }
  if ('approval' in b) out.approval = b.approval === 'auto' ? 'auto' : 'manual';
  if ('terms' in b) out.terms = clip(b.terms, 8000);
  if ('couponDiscount' in b) { const r = cleanRate(b.couponDiscount, { maxPct: 90 }); if (r.error) return r; if (!r.value) return { error: 'Enter the discount affiliate coupons give' }; out.couponDiscount = r; }
  if ('autoCoupon' in b) out.autoCoupon = !!b.autoCoupon;
  if (!cur.slug && !out.slug) out.slug = freeSlug(bizName(T.users.get(userId)), userId);
  return out;
}

// ---------- affiliates ----------
function newCode(name) {
  const stem = String(name || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 6) || 'REF';
  for (let i = 0; ; i++) { const c = `${stem}${crypto.randomInt(i > 5 ? 1000 : 10, i > 5 ? 10000 : 100)}`; if (!T.affiliates.exists({ code: c })) return c; }
}
const cleanCode = (v) => String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 20);
// UPI ID or bank account; returns { method, … } | { error } | null (nothing given)
function cleanPayout(p) {
  if (!p || typeof p !== 'object') return null;
  const upi = clip(p.upi, 100).toLowerCase(), account = String(p.account || '').replace(/\s/g, ''), ifsc = clip(p.ifsc, 11).toUpperCase(), holder = clip(p.holder, 100), bank = clip(p.bank, 80);
  if (!upi && !account) return null;
  if (upi && !/^[\w.-]{2,256}@[a-z][a-z0-9.]{1,63}$/.test(upi)) return { error: 'Enter a valid UPI ID (like name@okaxis)' };
  if (account && !/^\d{6,18}$/.test(account)) return { error: 'Enter a valid bank account number (6–18 digits)' };
  if (account && !/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc)) return { error: 'Enter the branch’s IFSC code (like HDFC0001234)' };
  if (account && !holder) return { error: 'Enter the account holder’s name' };
  return { method: upi ? 'upi' : 'bank', ...(upi ? { upi } : {}), ...(account ? { account, ifsc, holder, bank } : {}) };
}
const maskUpi = (u) => { const [a, h] = u.split('@'); return `${a.slice(0, 2)}${'•'.repeat(Math.max(3, Math.min(6, a.length - 2)))}@${h}`; };
const maskOf = (p) => (!p ? null : { method: p.method, ...(p.upi ? { upi: maskUpi(p.upi) } : {}), ...(p.account ? { account: `••••${p.account.slice(-4)}`, ifsc: p.ifsc, holder: p.holder, bank: p.bank || '' } : {}) });
const setPayout = (a, p) => { a.payoutEnc = p ? encrypt(JSON.stringify(p)) : ''; a.payoutMask = maskOf(p); };
const payoutOf = (a) => { try { return a.payoutEnc ? JSON.parse(decrypt(a.payoutEnc)) : null; } catch { return null; } };

// the affiliate's own coupon (created, or an existing unlinked one of the seller's), active while they're approved
function linkCoupon(a, prog, code) {
  code = cleanCode(code).slice(0, 30);
  if (!code) return { error: 'Enter a coupon code' };
  const ex = T.coupons.find({ userId: a.userId, code });
  if (ex && ex.affiliateId && ex.affiliateId !== a.id) return { error: 'That coupon belongs to another affiliate' };
  if (T.affiliates.exists({ userId: a.userId, coupon: code, id: { ne: a.id } })) return { error: 'That coupon belongs to another affiliate' };
  if (ex) T.coupons.put({ ...ex, affiliateId: a.id, active: a.status === 'approved' });
  else T.coupons.insert({ id: uid(), userId: a.userId, code, type: prog.couponDiscount.type, value: prog.couponDiscount.value, ...(prog.couponDiscount.type === 'flat' ? { currency: 'INR' } : {}), active: a.status === 'approved', uses: 0, createdAt: Date.now(), expiresAt: null, maxUses: null, minOrder: null, oncePerCustomer: false, funnelIds: prog.funnelIds || [], affiliateId: a.id });
  if (a.coupon && a.coupon !== code) unlinkCoupon(a);
  a.coupon = code;
  return { ok: true };
}
function unlinkCoupon(a) {
  const c = a.coupon && T.coupons.find({ userId: a.userId, code: a.coupon });
  if (c && c.affiliateId === a.id) T.coupons.put({ ...c, active: false, affiliateId: null });
  a.coupon = null;
}
const syncCouponActive = (a) => { const c = a.coupon && T.coupons.find({ userId: a.userId, code: a.coupon }); if (c && c.affiliateId === a.id && c.active !== (a.status === 'approved')) T.coupons.put({ ...c, active: a.status === 'approved' }); };

function createAffiliate(owner, prog, { name, email, phone, payout, status, invited = false, code, coupon }) {
  return tx(() => {
    const a = { id: uid(), userId: owner.id, name, email, phone, code: code || newCode(name), status, invited, coupon: null, at: Date.now(), ...(status === 'approved' ? { approvedAt: Date.now() } : {}) };
    setPayout(a, payout);
    if (coupon || (prog.autoCoupon && status === 'approved')) { const r = linkCoupon(a, prog, coupon || a.code); if (r.error) throw Object.assign(new Error(r.error), { status: 400 }); }
    T.affiliates.insert(a);
    return a;
  });
}

// ---------- commissions ----------
function rateFor(prog, order, item) {
  return (item.productId && prog.rates.find((x) => x.target === 'product' && x.id === item.productId)) || prog.rates.find((x) => x.target === 'funnel' && x.id === order.funnelId) || prog.defaultRate;
}
function lineCommission(prog, order, item) {
  if (NOT_COMMISSIONABLE.includes(item.kind) || !(Number(item.price) > 0)) return 0;
  if (prog.productIds.length && !prog.productIds.includes(item.productId)) return 0;
  const r = rateFor(prog, order, item);
  return r2(r.type === 'flat' ? r.value : (Number(item.price) * (Number(order.fx) || 1) * r.value) / 100);
}
// Brings a commission up to date with its order. Each item's commission is fixed when the item is first seen (later
// rate changes don't rewrite past sales); refunded items earn nothing, so a partial refund reverses its share.
export function settle(c, order, prog, now = Date.now()) {
  const final = c.status === 'paid' || (c.status === 'reversed' && c.final);
  if (!order) return final ? c : { ...c, status: 'reversed', final: true, reason: 'Order deleted', reversedAt: now, amount: 0 };
  const lines = order.items.map((it, i) => {
    const prev = (c.lines || []).find((l) => l.i === i);
    return { i, name: clip(it.name, 120), kind: it.kind, price: r2(it.price), amount: prev ? prev.amount : lineCommission(prog, order, it), ...(it.refunded ? { refunded: true } : {}) };
  });
  const gross = r2(lines.reduce((s, l) => s + l.amount, 0)), net = r2(lines.filter((l) => !l.refunded).reduce((s, l) => s + l.amount, 0));
  if (c.status === 'paid') return net < c.amount ? { ...c, lines, clawback: r2(c.amount - net) } : c; // refunded after the payout: shown to the seller
  if (final) return c;
  const out = { ...c, lines, gross, amount: net, refunded: r2(gross - net), orderTotal: r2(order.total), test: testOrder(order) };
  delete out.reason;
  const reverse = (reason, fin = true) => Object.assign(out, { status: 'reversed', final: fin, reason, reversedAt: c.reversedAt || now, amount: 0, holdUntil: null });
  if (order.status === 'cancelled') return reverse(order.cancelReason === 'returned' ? 'Returned (RTO)' : 'Order cancelled');
  if (order.rtoAt) return reverse('Returned (RTO)');
  if (gross > 0 && net <= 0) return reverse('Refunded');
  if (gross <= 0) return reverse('Nothing in this order earns commission', false);
  if (order.status === 'cod') return Object.assign(out, { status: 'awaiting', holdUntil: null });
  const paidAt = order.codPaidAt || order.at;
  out.paidAt = paidAt;
  out.holdUntil = paidAt + (c.holdDays ?? prog.holdDays) * DAY;
  if (now >= out.holdUntil) { out.status = 'approved'; out.approvedAt = c.approvedAt || now; } else out.status = 'pending';
  return out;
}
const changed = (a, b) => JSON.stringify(a) !== JSON.stringify(b);
function syncOne(id, progs, now) {
  tx(() => {
    const c = T.affcomms.get(id);
    if (!c) return;
    if (!progs.has(c.userId)) progs.set(c.userId, programOf(c.userId));
    const next = settle(c, T.orders.get(c.orderId), progs.get(c.userId), now);
    if (changed(c, next)) T.affcomms.put(next);
  });
}
// the job: every open commission (holds that ended, refunds, COD paid / cancelled / returned)
export function affTick(now = Date.now(), where = {}) {
  const progs = new Map();
  let n = 0;
  for (const id of T.affcomms.ids({ ...where, status: OPEN })) { try { syncOne(id, progs, now); n++; } catch (e) { console.error('affiliate commission sync failed', id, e.message); } }
  // paid commissions refunded later (clawback note) — only recent ones are worth looking at
  for (const id of T.affcomms.ids({ ...where, status: 'paid', at: { gt: now - 120 * 86400000 } })) { try { syncOne(id, progs, now); } catch {} }
  return n;
}
const selfReferral = (a, order) => (a.email && order.email && a.email === lower(order.email)) || (phoneTail(a.phone).length === 10 && phoneTail(a.phone) === phoneTail(order.phone));

// Called by recordOrder (index.js) inside its transaction, for a new order and for items added to one. Never throws.
export function attributeOrder(f, order, buyer = {}) {
  try {
    if (!order || order.demo || String(order.id).startsWith('pv-')) return;
    if (order.affiliate) {
      const c = T.affcomms.find({ orderId: order.id });
      if (c) T.affcomms.put(settle(c, order, programOf(order.userId)));
      return;
    }
    if (order.items.length !== (order.items.filter((it) => it.at === order.at).length)) return; // an older order getting an upsell: not attributed now
    const prog = programOf(f.userId);
    if (!prog.enabled || (prog.funnelIds.length && !prog.funnelIds.includes(f.id))) return;
    let a = null, via = null;
    // the affiliate's coupon beats any link
    if (order.coupon) { a = T.affiliates.find({ userId: f.userId, coupon: order.coupon }); via = 'coupon'; }
    if (!a || a.status !== 'approved') {
      a = null;
      const t = readToken(buyer.aff);
      if (t && t.at <= Date.now() + 60000 && Date.now() - t.at <= prog.cookieDays * DAY) {
        const x = T.affiliates.find({ code: t.code });
        if (x && x.userId === f.userId && x.status === 'approved') { a = x; via = 'link'; }
      }
    }
    if (!a) return;
    if (selfReferral(a, order)) { order.affiliateBlocked = { code: a.code, reason: 'self-referral' }; T.orders.put(order); return; }
    order.affiliate = { id: a.id, code: a.code, via };
    T.orders.put(order);
    const c = { id: uid(), userId: f.userId, affiliateId: a.id, code: a.code, orderId: order.id, funnelId: f.id, via, status: 'pending', holdDays: prog.holdDays, lines: [], amount: 0, at: order.at };
    T.affcomms.insert(settle(c, order, prog));
  } catch (e) { console.error('affiliate attribution failed', e.message); }
}

// ---------- views ----------
const statsByAffiliate = (userId) => {
  const out = {};
  for (const r of q('SELECT affiliateId, status, COUNT(*) AS n, SUM(amount) AS s FROM affcomms WHERE userId = ? GROUP BY affiliateId, status').all(userId)) {
    const o = (out[r.affiliateId] ||= { sales: 0, awaiting: 0, pending: 0, approved: 0, paid: 0, reversed: 0, clicks: 0 });
    if (r.status !== 'reversed') o.sales += r.n;
    o[r.status] = r2((o[r.status] || 0) + (r.status === 'reversed' ? r.n : r.s || 0));
  }
  for (const r of q('SELECT affiliateId, SUM(n) AS n FROM affclicks WHERE userId = ? GROUP BY affiliateId').all(userId)) (out[r.affiliateId] ||= { sales: 0, awaiting: 0, pending: 0, approved: 0, paid: 0, reversed: 0, clicks: 0 }).clicks = r.n || 0;
  return out;
};
// approved, real (not test-mode) and not yet paid: what the seller owes
const payable = (affiliateId) => T.affcomms.all({ affiliateId, status: 'approved' }).filter((c) => !c.test);
const affView = (a, stats) => ({ id: a.id, name: a.name, email: a.email, phone: a.phone, code: a.code, status: a.status, coupon: a.coupon || null, invited: !!a.invited, payout: a.payoutMask || null, at: a.at, approvedAt: a.approvedAt || null, stats: stats || { sales: 0, awaiting: 0, pending: 0, approved: 0, paid: 0, reversed: 0, clicks: 0 } });
const commView = (c, names = {}) => ({ id: c.id, orderId: c.orderId, affiliateId: c.affiliateId, affiliate: names[c.affiliateId] || c.code, code: c.code, via: c.via, status: c.status, amount: c.amount, gross: c.gross || 0, refunded: c.refunded || 0, orderTotal: c.orderTotal || 0, at: c.at, paidAt: c.paidAt || null, holdUntil: c.holdUntil || null, approvedAt: c.approvedAt || null, payoutId: c.payoutId || null, paidOutAt: c.paidOutAt || null, reason: c.reason || '', clawback: c.clawback || 0, test: !!c.test });
const programView = (p) => { const { id, userId, ...x } = p; return x; };
const linksFor = (prog, code, base) => T.funnels.all({ userId: prog.userId }).filter((f) => f.published && (!prog.funnelIds.length || prog.funnelIds.includes(f.id))).map((f) => ({ funnelId: f.id, funnel: f.name, url: `${funnelUrl(f, base)}?ref=${code}` }));
const rateText = (r) => (r.type === 'flat' ? `₹${r.value.toLocaleString('en-IN')} per sale` : `${r.value}% of each sale`);
const csvCell = (v) => { const s = String(v ?? ''); return /[",\n\r]/.test(s) || /^[=+\-@]/.test(s) ? `"${(/^[=+\-@]/.test(s) ? `'${s}` : s).replace(/"/g, '""')}"` : s; };
const csv = (rows) => (rows.length ? [Object.keys(rows[0]).join(','), ...rows.map((r) => Object.values(r).map(csvCell).join(','))].join('\n') : '');
const day = (t) => new Date(t + 5.5 * 3600000).toISOString().slice(0, 10); // IST day

export function registerAffiliates(app, { auth, wrap, rateLimit, isTest, secret, appUrl, pub, isPreview }) {
  if (secret) SECRET = secret;
  const base = (req) => (process.env.APP_URL || appUrl(req)).replace(/\/+$/, '');
  const limiter = rateLimit({ windowMs: 60000, max: isTest ? 5000 : 60 });
  const joinLimiter = rateLimit({ windowMs: 3600000, max: isTest ? 1000 : 10, message: 'Too many sign-ups from this network — please try again later.' });
  const loginLimiter = rateLimit({ windowMs: 15 * 60000, max: isTest ? 1000 : 8, message: 'Too many tries — wait a few minutes and try again.' });
  const clickLimiter = rateLimit({ windowMs: 60000, max: isTest ? 5000 : 120 });
  const ownAff = (req, res) => { const a = T.affiliates.get(req.params.id); if (!a || a.userId !== req.user.id) { res.status(404).json({ error: 'Affiliate not found' }); return null; } return a; };

  // ----- seller: program, affiliates, commissions, payouts -----
  app.get('/api/affiliates', auth, (req, res) => {
    affTick(Date.now(), { userId: req.user.id });
    const prog = programOf(req.user.id), stats = statsByAffiliate(req.user.id);
    const list = T.affiliates.all({ userId: req.user.id }, { order: 'at', desc: true }).map((a) => ({ ...affView(a, stats[a.id]), payable: r2(payable(a.id).reduce((s, c) => s + c.amount, 0)) }));
    const sum = (k) => r2(list.reduce((s, a) => s + (a.stats[k] || 0), 0));
    res.json({
      program: programView(prog), signupUrl: prog.slug ? `${base(req)}/affiliate/${prog.slug}` : null,
      funnels: T.funnels.all({ userId: req.user.id }).map((f) => ({ id: f.id, name: f.name, published: !!f.published })),
      products: T.products.all({ userId: req.user.id }).map((p) => ({ id: p.id, name: p.name })),
      affiliates: list,
      totals: { affiliates: list.length, pending: list.filter((a) => a.status === 'pending').length, clicks: sum('clicks'), sales: sum('sales'), awaiting: sum('awaiting'), commissionPending: sum('pending'), approved: sum('approved'), paid: sum('paid'), payable: r2(list.reduce((s, a) => s + a.payable, 0)) },
    });
  });
  app.put('/api/affiliates/program', auth, (req, res) => {
    const cur = programOf(req.user.id);
    const r = cleanProgram(req.body || {}, cur, req.user.id);
    if (r.error) return res.status(400).json(r);
    const { id, userId, ...rest } = { ...cur, ...r };
    T.affprogs.put({ ...rest, id: req.user.id, userId: req.user.id, updatedAt: Date.now() });
    res.json({ program: programView(programOf(req.user.id)), signupUrl: `${base(req)}/affiliate/${programOf(req.user.id).slug}` });
  });
  // invite: approved straight away, and emailed their portal link
  app.post('/api/affiliates', auth, wrap(async (req, res) => {
    const b = req.body || {}, prog = programOf(req.user.id);
    if (!prog.slug) T.affprogs.put({ ...programView(prog), ...cleanProgram({}, {}, req.user.id), id: req.user.id, userId: req.user.id });
    const email = lower(b.email), name = clip(b.name, 100);
    if (!name) return res.status(400).json({ error: 'Enter their name' });
    if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'Enter a valid email address' });
    if (T.affiliates.exists({ userId: req.user.id, email })) return res.status(409).json({ error: 'This person is already an affiliate' });
    const code = b.code ? cleanCode(b.code) : '';
    if (b.code && (code.length < 3 || T.affiliates.exists({ code }))) return res.status(400).json({ error: code.length < 3 ? 'A code needs at least 3 letters or numbers' : 'That code is taken — try another' });
    const payout = cleanPayout(b.payout);
    if (payout?.error) return res.status(400).json(payout);
    const a = createAffiliate(req.user, programOf(req.user.id), { name, email, phone: clip(b.phone, 20), payout, status: 'approved', invited: true, code, coupon: b.coupon });
    const p = programOf(req.user.id);
    sendEmail(req.user, { to: email, subject: `You’re invited to the ${p.name || bizName(req.user)} affiliate program`, text: `Hi ${name.split(/\s+/)[0]},\n\n${bizName(req.user)} has added you as an affiliate. Your code: ${a.code}\n\nSee your links, sales and commission here (sign in with this email):\n${base(req)}/affiliate/${p.slug}\n\n— ${bizName(req.user)}` }).catch(() => {});
    res.json(affView(a));
  }));
  app.put('/api/affiliates/:id', auth, (req, res) => {
    const a0 = ownAff(req, res); if (!a0) return;
    const b = req.body || {}, prog = programOf(req.user.id);
    let err = null;
    const a = tx(() => {
      const a = T.affiliates.get(a0.id);
      if ('status' in b) {
        if (!['approved', 'blocked', 'pending'].includes(b.status)) { err = 'Unknown status'; return a; }
        if (b.status === 'approved' && a.status !== 'approved') a.approvedAt = Date.now();
        a.status = b.status;
        if (a.status === 'approved' && !a.coupon && prog.autoCoupon) { const r = linkCoupon(a, prog, a.code); if (r.error) { err = r.error; return a; } }
      }
      if ('name' in b && clip(b.name, 100)) a.name = clip(b.name, 100);
      if ('phone' in b) a.phone = clip(b.phone, 20);
      if ('coupon' in b) {
        if (!b.coupon) unlinkCoupon(a);
        else { const r = linkCoupon(a, prog, b.coupon); if (r.error) { err = r.error; return a; } }
      }
      if ('payout' in b) { const p = cleanPayout(b.payout); if (p?.error) { err = p.error; return a; } setPayout(a, p); }
      syncCouponActive(a);
      if (!err) T.affiliates.put(a);
      return a;
    });
    if (err) return res.status(400).json({ error: err });
    res.json(affView(a, statsByAffiliate(req.user.id)[a.id]));
  });
  // the full UPI ID / account number, to make a payout (never in a list)
  app.post('/api/affiliates/:id/payout-details', auth, (req, res) => {
    const a = ownAff(req, res); if (!a) return;
    res.set('Cache-Control', 'no-store').json({ payout: payoutOf(a) });
  });
  const commissionsFor = (req) => {
    const s = (k) => (typeof req.query[k] === 'string' ? req.query[k].slice(0, 40) : '');
    affTick(Date.now(), { userId: req.user.id });
    const where = { userId: req.user.id };
    if (s('affiliateId')) where.affiliateId = s('affiliateId');
    if (['awaiting', 'pending', 'approved', 'paid', 'reversed'].includes(s('status'))) where.status = s('status');
    const from = Number(s('from')) || 0, to = Number(s('to')) || 0;
    if (from || to) where.at = { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) };
    const names = Object.fromEntries(T.affiliates.all({ userId: req.user.id }).map((a) => [a.id, a.name]));
    return T.affcomms.all(where, { order: 'at', desc: true, limit: Math.min(5000, Number(s('limit')) || 1000) }).map((c) => commView(c, names));
  };
  app.get('/api/affiliates/commissions', auth, (req, res) => res.json({ commissions: commissionsFor(req) }));
  app.get('/api/affiliates/commissions.csv', auth, (req, res) => {
    const rows = commissionsFor(req).map((c) => ({ date: new Date(c.at).toISOString(), affiliate: c.affiliate, code: c.code, order: c.orderId, via: c.via, order_total: c.orderTotal, commission: c.amount, refunded_commission: c.refunded, status: c.status, hold_until: c.holdUntil ? new Date(c.holdUntil).toISOString().slice(0, 10) : '', payout: c.payoutId || '', note: c.reason, test: c.test ? 'yes' : '' }));
    res.set('Content-Disposition', 'attachment; filename="affiliate-commissions.csv"').type('text/csv').send(csv(rows));
  });
  app.get('/api/affiliates/payouts', auth, (req, res) => {
    const names = Object.fromEntries(T.affiliates.all({ userId: req.user.id }).map((a) => [a.id, a.name]));
    const list = T.affpayouts.all({ userId: req.user.id }, { order: 'at', desc: true, limit: 1000 }).map((p) => ({ ...p, affiliate: names[p.affiliateId] || '' }));
    if (req.query.format === 'csv') return res.set('Content-Disposition', 'attachment; filename="affiliate-payouts.csv"').type('text/csv').send(csv(list.map((p) => ({ date: new Date(p.at).toISOString(), affiliate: p.affiliate, amount: p.amount, commissions: p.count, method: p.method, paid_to: p.to, reference: p.reference, note: p.note }))));
    res.json({ payouts: list });
  });
  // the seller paid an affiliate (UPI / bank, outside FunnelHive): their approved commissions are marked paid
  app.post('/api/affiliates/:id/payouts', auth, (req, res) => {
    const a = ownAff(req, res); if (!a) return;
    const b = req.body || {}, prog = programOf(req.user.id);
    const reference = clip(b.reference, 100);
    if (!reference) return res.status(400).json({ error: 'Enter the UPI / bank transaction reference' });
    affTick(Date.now(), { affiliateId: a.id });
    const out = tx(() => {
      const due = payable(a.id);
      const amount = r2(due.reduce((s, c) => s + c.amount, 0));
      if (!due.length || amount <= 0) return { status: 400, error: 'Nothing approved to pay yet' };
      if (amount < prog.minPayout && !b.force) return { status: 400, error: `₹${amount.toLocaleString('en-IN')} is below the minimum payout of ₹${prog.minPayout.toLocaleString('en-IN')}`, belowMinimum: true, amount };
      const m = a.payoutMask;
      const p = T.affpayouts.insert({ id: uid(), userId: a.userId, affiliateId: a.id, amount, count: due.length, commissionIds: due.map((c) => c.id), reference, note: clip(b.note, 300), method: m?.method || '', to: m ? (m.upi || `${m.account} ${m.ifsc}`) : '', at: Date.now(), by: req.user.id });
      for (const c of due) T.affcomms.put({ ...c, status: 'paid', payoutId: p.id, paidOutAt: p.at });
      return p;
    });
    if (out.error) { const { status, ...rest } = out; return res.status(status).json(rest); }
    sendEmail(req.user, { to: a.email, subject: `Commission paid: ₹${out.amount.toLocaleString('en-IN')}`, text: `Hi ${a.name.split(/\s+/)[0]},\n\nWe’ve paid you ₹${out.amount.toLocaleString('en-IN')} for ${out.count} sale${out.count > 1 ? 's' : ''}.\nReference: ${out.reference}\n\nDetails: ${base(req)}/affiliate/${prog.slug}\n\n— ${bizName(req.user)}` }).catch(() => {});
    res.json(out);
  });

  // ----- public: the click, the program page, sign-up, portal -----
  // a ?ref= visit: counted (people only) and answered with the signed click token the page keeps for checkout
  app.post('/api/public/:slug/aff', clickLimiter, (req, res) => {
    const f = pub(req, res); if (!f) return;
    const code = cleanCode(req.body?.ref);
    const prog = programOf(f.userId);
    const a = code && T.affiliates.find({ code });
    if (!prog.enabled || !a || a.userId !== f.userId || a.status !== 'approved' || (prog.funnelIds.length && !prog.funnelIds.includes(f.id))) return res.json({ ok: false });
    if (!isPreview(req) && !BOT_UA.test(String(req.headers['user-agent'] || 'bot'))) {
      const id = `${a.id}:${day(Date.now())}`;
      try { tx(() => { const c = T.affclicks.get(id); T.affclicks.put({ id, affiliateId: a.id, userId: a.userId, day: day(Date.now()), n: (c?.n || 0) + 1 }); }); } catch {}
    }
    res.json({ ok: true, token: refToken(a.code), days: prog.cookieDays });
  });
  const progBySlug = (req, res) => {
    const p = T.affprogs.find({ slug: String(req.params.pslug || '').toLowerCase() });
    const owner = p && T.users.get(p.userId);
    if (!p || !owner || !p.enabled) { res.status(404).json({ error: 'This affiliate program isn’t open' }); return null; }
    return { prog: programOf(p.userId), owner };
  };
  app.get('/api/aff/:pslug', limiter, (req, res) => {
    const x = progBySlug(req, res); if (!x) return;
    const { prog, owner } = x;
    res.json({ name: prog.name || `${bizName(owner)} affiliate program`, business: bizName(owner), terms: prog.terms, commission: rateText(prog.defaultRate), cookieDays: prog.cookieDays, holdDays: prog.holdDays, minPayout: prog.minPayout, approval: prog.approval, color: owner.settings?.brandColor || '' });
  });
  app.post('/api/aff/:pslug/join', joinLimiter, wrap(async (req, res) => {
    const x = progBySlug(req, res); if (!x) return;
    const { prog, owner } = x, b = req.body || {};
    const name = clip(b.name, 100), email = lower(b.email), phone = clip(b.phone, 20);
    if (!name) return res.status(400).json({ error: 'Enter your name' });
    if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'Enter a valid email address' });
    if (phone && phoneTail(phone).length < 10) return res.status(400).json({ error: 'Enter a valid mobile number' });
    if (prog.terms && !b.agree) return res.status(400).json({ error: 'Please accept the program terms' });
    if (T.affiliates.exists({ userId: owner.id, email })) return res.status(409).json({ error: 'You’ve already signed up — sign in with your email', signin: true });
    const payout = cleanPayout(b.payout);
    if (payout?.error) return res.status(400).json(payout);
    const a = createAffiliate(owner, prog, { name, email, phone, payout, status: prog.approval === 'auto' ? 'approved' : 'pending' });
    notify(owner.id, { kind: 'affiliate', title: `New affiliate${a.status === 'pending' ? ' to approve' : ''}: ${name}`, body: email, link: '/affiliates' });
    res.json({ status: a.status, code: a.status === 'approved' ? a.code : null });
  }));
  // sign-in link by email (only to affiliates of this program; the answer is the same either way)
  app.post('/api/aff/:pslug/login', loginLimiter, wrap(async (req, res) => {
    const x = progBySlug(req, res); if (!x) return;
    const { prog, owner } = x;
    const email = lower(req.body?.email);
    if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'Enter a valid email address' });
    const a = T.affiliates.find({ userId: owner.id, email });
    if (!a || a.status === 'blocked') return res.json({ ok: true });
    const token = `L${randomToken().slice(0, 48)}`;
    T.affsess.insert({ id: uid(), affiliateId: a.id, kind: 'link', hash: hashToken(token), expiresAt: Date.now() + LINK_MIN * 60000 });
    const link = `${base(req)}/affiliate/${prog.slug}?login=${token}`;
    sendEmail(owner, { to: email, subject: `Your sign-in link — ${prog.name || `${bizName(owner)} affiliates`}`, text: `Hi ${a.name.split(/\s+/)[0]},\n\nSign in to your affiliate dashboard:\n${link}\n\nThe link works once, for ${LINK_MIN} minutes. If you didn’t ask for it, ignore this email.\n\n— ${bizName(owner)}` }).catch((e) => console.error('affiliate link email failed', e.message));
    res.json({ ok: true, ...(isTest ? { link } : {}) });
  }));
  app.post('/api/aff/:pslug/session', loginLimiter, (req, res) => {
    const x = progBySlug(req, res); if (!x) return;
    const t = String(req.body?.token || '');
    const row = /^L[0-9a-f]{48}$/.test(t) && T.affsess.find({ hash: hashToken(t) });
    const a = row && row.kind === 'link' && row.expiresAt > Date.now() && T.affiliates.get(row.affiliateId);
    if (row) T.affsess.del(row.id); // once only
    if (!a || a.userId !== x.owner.id || a.status === 'blocked') return res.status(400).json({ error: 'This link has expired — ask for a new one' });
    const session = `A${randomToken().slice(0, 48)}`;
    T.affsess.insert({ id: uid(), affiliateId: a.id, kind: 'session', hash: hashToken(session), expiresAt: Date.now() + SESSION_DAYS * 86400000 });
    res.json({ session });
  });
  const portalUser = (req, res, owner) => {
    const t = String(req.headers['x-affiliate'] || '');
    const s = /^A[0-9a-f]{48}$/.test(t) && T.affsess.find({ hash: hashToken(t) });
    const a = s && s.kind === 'session' && s.expiresAt > Date.now() && T.affiliates.get(s.affiliateId);
    if (!a || a.userId !== owner.id || a.status === 'blocked') { res.status(401).json({ error: 'Please sign in again', signin: true }); return null; }
    return a;
  };
  app.get('/api/aff/:pslug/me', limiter, (req, res) => {
    const x = progBySlug(req, res); if (!x) return;
    const a = portalUser(req, res, x.owner); if (!a) return;
    affTick(Date.now(), { affiliateId: a.id });
    const st = statsByAffiliate(a.userId)[a.id];
    const since = day(Date.now() - 29 * 86400000);
    const clicks30 = q('SELECT COALESCE(SUM(n), 0) AS n FROM affclicks WHERE affiliateId = ? AND day >= ?').get(a.id, since).n;
    const coupon = a.coupon && T.coupons.find({ userId: a.userId, code: a.coupon });
    res.set('Cache-Control', 'no-store').json({
      me: { ...affView(a, st), email: a.email },
      program: { name: x.prog.name || `${bizName(x.owner)} affiliate program`, business: bizName(x.owner), commission: rateText(x.prog.defaultRate), cookieDays: x.prog.cookieDays, holdDays: x.prog.holdDays, minPayout: x.prog.minPayout, terms: x.prog.terms },
      links: a.status === 'approved' ? linksFor(x.prog, a.code, base(req)) : [],
      coupon: coupon && a.status === 'approved' ? { code: coupon.code, type: coupon.type, value: coupon.value } : null,
      stats: { ...affView(a, st).stats, clicks30 },
      // no buyer details: the order's date, value and the commission only
      commissions: T.affcomms.all({ affiliateId: a.id }, { order: 'at', desc: true, limit: 200 }).map((c) => ({ id: c.id, ref: c.orderId.slice(-6).toUpperCase(), at: c.at, orderTotal: c.orderTotal || 0, amount: c.status === 'reversed' ? 0 : c.amount, status: c.status, holdUntil: c.holdUntil || null, via: c.via, reason: c.reason || '', test: !!c.test })),
      payouts: T.affpayouts.all({ affiliateId: a.id }, { order: 'at', desc: true, limit: 100 }).map((p) => ({ id: p.id, amount: p.amount, count: p.count, reference: p.reference, at: p.at })),
    });
  });
  app.put('/api/aff/:pslug/me', limiter, (req, res) => {
    const x = progBySlug(req, res); if (!x) return;
    const a0 = portalUser(req, res, x.owner); if (!a0) return;
    const b = req.body || {};
    const p = 'payout' in b ? cleanPayout(b.payout) : undefined;
    if (p?.error) return res.status(400).json(p);
    const a = T.affiliates.update(a0.id, (a) => {
      if (clip(b.name, 100)) a.name = clip(b.name, 100);
      if ('phone' in b) a.phone = clip(b.phone, 20);
      if (p !== undefined) setPayout(a, p);
    });
    res.json({ me: affView(a), payout: a.payoutMask || null });
  });
  app.post('/api/aff/:pslug/logout', limiter, (req, res) => {
    const t = String(req.headers['x-affiliate'] || '');
    if (/^A[0-9a-f]{48}$/.test(t)) T.affsess.delWhere({ hash: hashToken(t) });
    res.json({ ok: true });
  });

  if (JOBS) {
    setInterval(() => { try { affTick(); q('DELETE FROM affsess WHERE expiresAt < ?').run(Date.now()); } catch (e) { console.error('affiliate job failed', e.message); } }, TICK).unref();
  }
}
