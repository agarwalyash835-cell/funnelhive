// Privacy & consent for a seller's funnels (India's DPDP Act 2023), and the policy pages payment gateways ask for.
//   - a consent banner: tracking pixels load only after the visitor accepts; a refusal also stops server-side events
//   - a consent line (optionally a required checkbox) on opt-in and application forms, recorded with each lead
//   - generated Privacy, Terms, Refund and Contact pages from the business details (or the seller's own URL)
//   - erasing a contact on request: their sign-ups and messages are deleted; orders are kept for tax law but
//     anonymised
import { T, q, tx } from './db.js';
import { invoicingOf } from './sales.js';
import { brand } from './platform.js';

const clip = (v, n) => String(v ?? '').trim().slice(0, n);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const PRIVACY_DEFAULTS = { banner: false, checkbox: false, consentText: '', policyUrl: '', grievanceName: '', grievanceEmail: '', refundDays: 7, address: '' };
export const privacyOf = (u) => ({ ...PRIVACY_DEFAULTS, ...(u?.settings?.privacy || {}) });
export const legalBase = (base, userId, f) => `${base}/legal/${userId}${legalOf(f) ? `/${f.id}` : ''}`;
// a funnel's own business details (several brands in one workspace); blank fields use the workspace's
export const LEGAL_FIELDS = { businessName: 120, email: 200, phone: 40, address: 400 };
export const legalOf = (f) => { const l = f?.legal; return l && (Object.keys(LEGAL_FIELDS).some((k) => l[k]) || l.refundDays != null) ? l : null; };
export function cleanLegal(b = {}) {
  const out = {};
  for (const [k, n] of Object.entries(LEGAL_FIELDS)) { const v = clip(b[k], n); if (v) out[k] = v; }
  if (out.email && !EMAIL_RE.test(out.email)) return { error: 'Enter a valid email for this funnel’s legal pages' };
  if (b.refundDays !== '' && b.refundDays != null) out.refundDays = Math.min(365, Math.max(0, Math.round(Number(b.refundDays) || 0)));
  return out;
}
export const consentLine = (u) => privacyOf(u).consentText || `I agree to the Privacy Policy and to receive updates from ${u?.settings?.businessName || u?.name || 'the seller'} by email and WhatsApp. I can unsubscribe any time.`;

// what a funnel page needs to show the banner and the consent line
export function publicPrivacy(u, base, f) {
  const p = privacyOf(u);
  return { banner: !!p.banner, checkbox: !!p.checkbox, line: consentLine(u), policy: p.policyUrl || `${legalBase(base, u.id, f)}/privacy`, terms: `${legalBase(base, u.id, f)}/terms` };
}

// ---------- the generated pages ----------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
function details(u, f) {
  const inv = invoicingOf(u), p = privacyOf(u), l = legalOf(f) || {};
  return {
    name: l.businessName || inv.legalName || u.settings?.businessName || u.name,
    brand: l.businessName || u.settings?.businessName || inv.legalName || u.name,
    email: l.email || p.grievanceEmail || u.channels?.email?.replyTo || inv.email || u.email,
    phone: l.phone || u.settings?.supportWhatsapp || '',
    address: l.address || p.address || inv.address || '',
    gstin: inv.gstin || '',
    officer: p.grievanceName || l.businessName || inv.legalName || u.name,
    refundDays: l.refundDays != null ? Number(l.refundDays) || 0 : Number(p.refundDays) || 0,
  };
}
const PAGES = {
  privacy: (d) => ['Privacy Policy', `
<p>This policy explains how <b>${esc(d.name)}</b> (“we”) collects and uses your personal data when you use our pages, sign up, book a call or buy from us. We are the <i>Data Fiduciary</i> under India’s Digital Personal Data Protection Act, 2023.</p>
<h2>What we collect</h2><ul><li>Details you give us: name, email, phone/WhatsApp number, answers to forms, and a delivery or billing address and GSTIN if you buy.</li><li>Payment confirmations from our payment partners (Razorpay / Stripe). We never see or store your card or UPI details.</li><li>How you use our pages (pages viewed, the ad or link you came from) — and, only if you accept the cookie notice, advertising cookies from Meta and Google.</li></ul>
<h2>Why we use it</h2><ul><li>To deliver what you signed up for or bought: access links, bookings, webinars, invoices and shipping.</li><li>To send you updates and offers by email and WhatsApp, when you agreed to receive them. You can unsubscribe from any email, or reply STOP on WhatsApp.</li><li>To keep tax records (orders and GST invoices are kept for 8 years as the law requires).</li><li>To measure and improve our advertising, only with your consent.</li></ul>
<h2>Who we share it with</h2><p>Only the services that help us run this business — our website platform (${esc(brand())}), payment gateways, email and WhatsApp providers, shipping partners and, with your consent, Meta and Google for ad measurement. We never sell your data.</p>
<h2>Your rights</h2><p>You can ask us to access, correct or erase your personal data, withdraw your consent at any time, and nominate someone to exercise these rights for you. Write to us and we’ll respond within 30 days.</p>
<h2>Grievance officer</h2><p>${esc(d.officer)}<br>${esc(d.email)}${d.phone ? `<br>${esc(d.phone)}` : ''}${d.address ? `<br>${esc(d.address)}` : ''}</p><p>If we don’t resolve your complaint, you may approach the Data Protection Board of India.</p>`],
  terms: (d) => ['Terms & Conditions', `
<p>These terms apply when you buy from or sign up with <b>${esc(d.name)}</b>${d.gstin ? ` (GSTIN ${esc(d.gstin)})` : ''}.</p>
<h2>Purchases</h2><p>Prices are shown on the checkout page, including GST where applicable. Your order is confirmed once the payment succeeds; digital products are delivered by email right away, physical products are shipped to the address you give us, and calls are confirmed for the time you book.</p>
<h2>Payment plans and memberships</h2><p>If you choose instalments or a membership, you authorise the agreed recurring charges. Memberships renew until you cancel — you can cancel from the library link we email you. Access may be paused if a payment fails.</p>
<h2>Use of our content</h2><p>Courses, downloads and materials are for your personal use. Please don’t share your access link or redistribute the content.</p>
<h2>Results</h2><p>Testimonials and examples are real but individual — results vary and are not guaranteed.</p>
<h2>Liability and disputes</h2><p>Our liability is limited to the amount you paid for the product. These terms are governed by the laws of India${d.address ? `, with courts at our place of business having jurisdiction` : ''}.</p>
<h2>Contact</h2><p>${esc(d.email)}${d.phone ? ` · ${esc(d.phone)}` : ''}</p>`],
  refund: (d) => ['Refund & Cancellation Policy', `
<p>${d.refundDays ? `We offer a refund within <b>${d.refundDays} days</b> of purchase if you’re not satisfied — write to ${esc(d.email)} with your order number.` : `Because our products are delivered instantly, purchases are non-refundable unless the product is defective or not delivered — write to ${esc(d.email)} and we’ll make it right.`}</p>
<h2>How refunds are paid</h2><p>Approved refunds go back to the original payment method (card, UPI or bank) within 5–7 working days through our payment partner. Access to digital products ends when a refund is issued.</p>
<h2>Physical products</h2><p>Orders can be cancelled before they ship. Damaged or wrong items are replaced or refunded — share a photo within 48 hours of delivery. Cash on Delivery orders refused at the door are cancelled.</p>
<h2>Calls and sessions</h2><p>Booked calls can be rescheduled from your confirmation email. Paid calls are refunded if cancelled within the notice period shown when you booked.</p>
<h2>Memberships and payment plans</h2><p>You can cancel a membership any time; you keep access until the end of the period you paid for. Instalments already paid for a delivered programme are not refundable unless stated on the offer.</p>`],
  contact: (d) => ['Contact Us', `
<p><b>${esc(d.name)}</b></p>${d.address ? `<p>${esc(d.address)}</p>` : ''}<p>Email: ${esc(d.email)}</p>${d.phone ? `<p>WhatsApp / phone: ${esc(d.phone)}</p>` : ''}${d.gstin ? `<p>GSTIN: ${esc(d.gstin)}</p>` : ''}<p>We reply within 1–2 working days.</p>`],
};
export function legalPage(u, kind, f) {
  const make = PAGES[kind];
  if (!make || !u) return null;
  const d = details(u, f);
  const [title, body] = make(d);
  const nav = Object.keys(PAGES).map((k) => `<a href="${k}"${k === kind ? ' aria-current="page"' : ''}>${PAGES[k](d)[0].replace(' & Conditions', '').replace(' & Cancellation Policy', '').replace(' Policy', '')}</a>`).join(' · ');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)} · ${esc(d.brand)}</title><meta name="robots" content="index,follow">
<style>body{margin:0;font:16px/1.65 -apple-system,Segoe UI,Roboto,sans-serif;color:#1f2937;background:#fafafa}main{max-width:760px;margin:0 auto;padding:40px 20px 60px}h1{font-size:30px;margin:8px 0 4px}h2{font-size:18px;margin:28px 0 6px}nav{font-size:14px;color:#6b7280}nav a{color:#4f46e5;text-decoration:none}nav a[aria-current]{font-weight:700;color:#111}.upd{color:#6b7280;font-size:13px}ul{padding-left:20px}footer{margin-top:40px;font-size:13px;color:#9ca3af}</style></head>
<body><main><nav><b>${esc(d.brand)}</b> · ${nav}</nav><h1>${esc(title)}</h1><p class="upd">Last updated ${new Date(u.settings?.privacy?.updatedAt || u.createdAt || Date.now()).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}</p>${body}<footer>${esc(d.name)}</footer></main></body></html>`;
}

// ---------- erasing a contact ----------
// Their data goes; orders and invoices stay (tax law) with the personal details removed.
export function eraseContact(userId, key) {
  const k = String(key || '').toLowerCase().startsWith('phone:') ? String(key) : String(key || '').toLowerCase();
  if (!k) return null;
  const n = {};
  tx(() => {
    n.leads = T.leads.delWhere({ userId, ckey: k });
    n.abandoned = T.abandoned.delWhere({ userId, ckey: k });
    n.crm = T.crm.delWhere({ userId, key: k });
    n.runs = T.runs.all({ userId }).filter((r) => r.key === k).map((r) => (T.runs.del(r.id), 1)).length;
    n.msgs = q("DELETE FROM msgs WHERE userId = ? AND json_extract(data, '$.key') = ?").run(userId, k).changes;
    n.bsends = q("DELETE FROM bsends WHERE userId = ? AND json_extract(data, '$.key') = ?").run(userId, k).changes;
    if (!k.startsWith('phone:')) {
      n.access = T.access.delWhere({ userId, ckey: k });
      n.portals = T.portals.delWhere({ userId, ckey: k });
      n.registrations = T.registrations.delWhere({ userId, ckey: k });
      n.bookings = T.bookings.delWhere({ userId, ckey: k });
      // orders: anonymised, amounts kept
      n.orders = 0;
      for (const o of T.orders.all({ userId, ckey: k })) {
        T.orders.update(o.id, (x) => { x.email = `erased-${x.id}@erased.invalid`; x.name = 'Erased on request'; x.phone = ''; delete x.address; delete x.attr; delete x.visitor; x.erasedAt = Date.now(); });
        n.orders++;
      }
      for (const i of T.sinvoices.all({ userId })) if (String(i.billedTo?.email || '').toLowerCase() === k) T.sinvoices.update(i.id, (x) => { x.billedTo = { ...x.billedTo, email: '', phone: '', person: '' }; });
    }
  });
  return n;
}

export function registerLegal(app, { auth, appUrl }) {
  app.get('/api/privacy', auth, (req, res) => res.json({ ...privacyOf(req.user), consentLine: consentLine(req.user), pages: legalBase(process.env.APP_URL || appUrl(req), req.user.id) }));
  app.put('/api/privacy', auth, (req, res) => {
    const b = req.body || {}, cur = privacyOf(req.user);
    const out = { ...cur };
    for (const k of ['banner', 'checkbox']) if (k in b) out[k] = !!b[k];
    if ('consentText' in b) out.consentText = clip(b.consentText, 400);
    if ('policyUrl' in b) { const u = clip(b.policyUrl, 300); if (u && !/^https:\/\/[^\s"'<>]+$/.test(u)) return res.status(400).json({ error: 'The policy link must start with https://' }); out.policyUrl = u; }
    if ('grievanceName' in b) out.grievanceName = clip(b.grievanceName, 120);
    if ('grievanceEmail' in b) { const e = clip(b.grievanceEmail, 200); if (e && !EMAIL_RE.test(e)) return res.status(400).json({ error: 'Enter a valid email for the grievance officer' }); out.grievanceEmail = e; }
    if ('address' in b) out.address = clip(b.address, 400);
    if ('refundDays' in b) out.refundDays = Math.min(365, Math.max(0, Math.round(Number(b.refundDays) || 0)));
    out.updatedAt = Date.now();
    const u = T.users.update(req.user.id, (x) => { x.settings = { ...x.settings, privacy: out }; });
    res.json({ ...privacyOf(u), consentLine: consentLine(u), pages: legalBase(process.env.APP_URL || appUrl(req), u.id) });
  });
  app.delete('/api/contacts/:key', auth, (req, res) => {
    const n = eraseContact(req.user.id, req.params.key);
    if (!n) return res.status(400).json({ error: 'Which contact?' });
    res.json({ ok: true, erased: n });
  });
  // the public pages (also on the seller's own domains)
  app.get('/legal/:uid/:kind', (req, res, next) => {
    const html = legalPage(T.users.get(req.params.uid), req.params.kind);
    if (!html) return next();
    res.set('Cache-Control', 'public, max-age=300').type('html').send(html);
  });
  // one funnel's pages, with its own business details where it has them
  app.get('/legal/:uid/:fid/:kind', (req, res, next) => {
    const f = T.funnels.get(req.params.fid);
    if (!f || f.userId !== req.params.uid) return next();
    const html = legalPage(T.users.get(req.params.uid), req.params.kind, f);
    if (!html) return next();
    res.set('Cache-Control', 'public, max-age=300').type('html').send(html);
  });
  // the seller sets a funnel's legal details (kept out of the editor's autosave, so no version bump)
  app.put('/api/funnels/:id/legal', auth, (req, res) => {
    const f = T.funnels.get(req.params.id);
    if (!f || f.userId !== req.user.id) return res.status(404).json({ error: 'Funnel not found' });
    const l = cleanLegal(req.body || {});
    if (l.error) return res.status(400).json(l);
    const nf = T.funnels.update(f.id, (x) => { if (Object.keys(l).length) x.legal = l; else delete x.legal; });
    res.json({ legal: nf.legal || null, pages: legalBase(process.env.APP_URL || appUrl(req), f.userId, nf) });
  });
}
