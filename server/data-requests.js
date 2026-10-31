// Requests from a seller's buyers under India's DPDP Act, 2023: to see their data, correct it, erase it, or withdraw
// consent. The form is linked from the seller's privacy policy (/legal/:uid/data-request). A request counts once the
// person confirms it from the email it was made for, so nobody can file one for someone else's address. It then waits
// in the seller's queue (Settings → Privacy) with a 30-day deadline. Withdrawing consent applies at once (no more
// marketing email or WhatsApp); the seller exports, erases or corrects, then closes the request with a note the
// person gets by email.
import express from 'express';
import { T, uid } from './db.js';
import { randomToken, hashToken } from './security.js';
import { sendEmail } from './messaging.js';
import { notify } from './notify.js';
import { appUrl, sendMail } from './mail.js';
import { ensureMeta } from './crm.js';
import { eraseContact, privacyOf } from './legal.js';

const DAY = 86400000;
export const DUE_DAYS = 30;
export const KINDS = {
  access: 'See the personal data you hold about me',
  correct: 'Correct my personal data',
  erase: 'Erase my personal data',
  withdraw: 'Withdraw my consent to marketing',
};
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const clip = (v, n) => String(v ?? '').trim().slice(0, n);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const bizOf = (u) => u.settings?.businessName || u.name || 'the seller';

// to the buyer from the seller's own email when it has one, else from the platform's
const tellBuyer = async (u, msg) => { const r = await sendEmail(u, msg).catch((e) => ({ status: 'failed', e })); if (r.status !== 'sent') await sendMail({ ...msg, fromName: bizOf(u), replyTo: u.email }); };

// a plain page in the policy pages' look
const page = (u, title, body) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)} · ${esc(bizOf(u))}</title><meta name="robots" content="noindex">
<style>body{margin:0;font:16px/1.6 -apple-system,Segoe UI,Roboto,sans-serif;color:#1f2937;background:#fafafa}main{max-width:620px;margin:0 auto;padding:40px 20px 60px}h1{font-size:26px;margin:8px 0 6px}nav{font-size:14px;color:#6b7280}nav a{color:#2563eb}label{display:block;font-weight:600;margin:16px 0 6px}input,textarea{width:100%;box-sizing:border-box;font:inherit;padding:10px 12px;border:1px solid #d1d5db;border-radius:10px;background:#fff}textarea{min-height:90px}.opt{display:flex;gap:10px;align-items:flex-start;font-weight:400;margin:8px 0}.opt input{width:auto;margin-top:5px}button{margin-top:20px;font:inherit;font-weight:600;padding:12px 20px;border:0;border-radius:10px;background:#111827;color:#fff;cursor:pointer}.muted{color:#6b7280;font-size:14px}.box{background:#fff;border:1px solid #e5e7eb;border-radius:14px;padding:18px 20px;margin-top:16px}</style></head>
<body><main><nav><b>${esc(bizOf(u))}</b> · <a href="privacy">Privacy Policy</a></nav><h1>${esc(title)}</h1>${body}</main></body></html>`;

const form = (u, err = '', v = {}) => page(u, 'Your data', `<p class="muted">Under India’s Digital Personal Data Protection Act you can ask ${esc(bizOf(u))} to show, correct or erase the personal data it holds about you, or withdraw your consent to marketing. We’ll email you a link to confirm it’s you, and reply within ${DUE_DAYS} days.</p>
${err ? `<div class="box" role="alert" style="border-color:#fca5a5;color:#991b1b">${esc(err)}</div>` : ''}
<form method="post" class="box"><label>What would you like?</label>${Object.entries(KINDS).map(([k, l]) => `<label class="opt"><input type="radio" name="kind" value="${k}"${(v.kind || 'access') === k ? ' checked' : ''}> ${esc(l)}</label>`).join('')}
<label for="dr-email">Your email (the one you used with us)</label><input id="dr-email" name="email" type="email" required maxlength="200" value="${esc(v.email || '')}">
<label for="dr-name">Your name</label><input id="dr-name" name="name" maxlength="120" value="${esc(v.name || '')}">
<label for="dr-phone">Phone or WhatsApp number <span class="muted">(optional, helps us find you)</span></label><input id="dr-phone" name="phone" maxlength="40" value="${esc(v.phone || '')}">
<label for="dr-note">Anything we should know <span class="muted">(what to correct, for example)</span></label><textarea id="dr-note" name="note" maxlength="1000">${esc(v.note || '')}</textarea>
<input type="text" name="website" tabindex="-1" autocomplete="off" aria-hidden="true" style="position:absolute;left:-9999px">
<button>Send request</button></form>`);

export const requestView = (r) => ({ id: r.id, kind: r.kind, kindLabel: KINDS[r.kind], email: r.email, name: r.name, phone: r.phone, note: r.note, status: r.status, at: r.at, confirmedAt: r.confirmedAt || null, dueAt: r.dueAt || null, closedAt: r.closedAt || null, reply: r.reply || '', erased: !!r.erased, contactKey: r.email });

export function registerDataRequests(app, { auth }) {
  const form1 = express.urlencoded({ extended: false, limit: '20kb' });
  const seller = (req, res) => { const u = T.users.get(req.params.uid); if (!u) { res.status(404).type('text').send('Not found'); return null; } return u; };

  // also under a funnel's own policy pages (/legal/:uid/:fid/privacy links here)
  const PATHS = ['/legal/:uid/data-request', '/legal/:uid/:fid/data-request'];
  app.get(PATHS, (req, res) => { const u = seller(req, res); if (u) res.type('html').send(form(u)); });
  app.post(PATHS, form1, async (req, res) => {
    const u = seller(req, res); if (!u) return;
    const b = req.body || {};
    if (b.website) return res.type('html').send(page(u, 'Check your email', '<p>We’ve sent you a link to confirm the request.</p>')); // a bot filled the hidden field
    const v = { kind: KINDS[b.kind] ? b.kind : 'access', email: clip(b.email, 200).toLowerCase(), name: clip(b.name, 120), phone: clip(b.phone, 40), note: clip(b.note, 1000) };
    if (!EMAIL_RE.test(v.email)) return res.status(400).type('html').send(form(u, 'Enter the email address you used with us.', v));
    // a few a day per address, so the form can't be used to flood someone's inbox
    const recent = T.datarequests.all({ userId: u.id }).filter((r) => r.email === v.email && r.at > Date.now() - DAY).length;
    if (recent >= 3) return res.status(429).type('html').send(form(u, 'You’ve sent several requests today — please confirm one from your email, or try again tomorrow.', v));
    const token = `${uid()}.${randomToken()}`;
    T.datarequests.insert({ id: uid(), userId: u.id, ...v, status: 'unconfirmed', tokenHash: hashToken(token), at: Date.now() });
    const link = `${appUrl(req)}/legal/data-request/confirm?token=${encodeURIComponent(token)}`;
    await tellBuyer(u, { to: v.email, subject: `Confirm your data request to ${bizOf(u)}`, text: `Hi${v.name ? ` ${v.name}` : ''},\n\nSomeone (hopefully you) asked ${bizOf(u)} to: ${KINDS[v.kind].toLowerCase()}.\n\nConfirm it here (the link works for 7 days):\n${link}\n\nIf this wasn't you, ignore this email and nothing happens.\n\n— ${bizOf(u)}` });
    res.type('html').send(page(u, 'Check your email', `<p>We’ve sent a link to <b>${esc(v.email)}</b>. Open it to confirm your request — we only act on confirmed requests, so nobody can make one in your name.</p>`));
  });
  app.get('/legal/data-request/confirm', (req, res) => {
    const token = String(req.query.token || '');
    const r = token && T.datarequests.find({ tokenHash: hashToken(token) });
    const u = r && T.users.get(r.userId);
    if (!r || !u || (r.status === 'unconfirmed' && Date.now() - r.at > 7 * DAY)) return res.status(400).type('html').send(page(u || { name: '' }, 'Link expired', '<p>This link is invalid or has expired. Please send your request again.</p>'));
    if (r.status === 'unconfirmed') {
      const now = Date.now();
      T.datarequests.update(r.id, (x) => { x.status = 'open'; x.confirmedAt = now; x.dueAt = now + DUE_DAYS * DAY; });
      // withdrawing consent works straight away: no more marketing email or WhatsApp
      if (r.kind === 'withdraw') {
        const m = ensureMeta(u.id, r.email);
        m.unsubscribed = true; m.waOptOut = true;
        m.activities.push({ id: uid(), at: now, type: 'note', title: 'Withdrew consent to marketing', text: 'Through a data request on the privacy page' });
        T.crm.put(m);
      }
      notify(u.id, { kind: 'support', title: `Data request: ${KINDS[r.kind].toLowerCase()}`, body: `${r.name || r.email} · reply by ${new Date(now + DUE_DAYS * DAY).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`, link: '/settings#legal' });
    }
    const officer = privacyOf(u).grievanceEmail;
    res.type('html').send(page(u, 'Request confirmed', `<p>Thank you — ${esc(bizOf(u))} has your request and will reply to <b>${esc(r.email)}</b> within ${DUE_DAYS} days.${r.kind === 'withdraw' ? ' You won’t get marketing emails or WhatsApp messages from now on; order and receipt messages still reach you.' : ''}</p>${officer ? `<p class="muted">Questions? Write to our grievance officer at ${esc(officer)}.</p>` : ''}`));
  });

  // ---------- the seller's queue ----------
  const mine = (req, res) => { const r = T.datarequests.get(req.params.rid); if (!r || r.userId !== req.user.id || r.status === 'unconfirmed') { res.status(404).json({ error: 'Request not found' }); return null; } return r; };
  app.get('/api/privacy/requests', auth, (req, res) => {
    const list = T.datarequests.all({ userId: req.user.id }, { order: 'at', desc: true, limit: 500 }).filter((r) => r.status !== 'unconfirmed');
    res.json({ requests: list.map(requestView), open: list.filter((r) => r.status === 'open').length, overdue: list.filter((r) => r.status === 'open' && r.dueAt < Date.now()).length });
  });
  // erase: the contact's data goes (orders and invoices stay, anonymised — legal.js eraseContact)
  app.post('/api/privacy/requests/:rid/erase', auth, (req, res) => {
    const r = mine(req, res); if (!r) return;
    const n = eraseContact(req.user.id, r.email);
    const x = T.datarequests.update(r.id, (y) => { y.erased = true; y.erasedAt = Date.now(); });
    res.json({ request: requestView(x), erased: n });
  });
  // close it: done or declined (with a reason), and tell the person
  app.put('/api/privacy/requests/:rid', auth, async (req, res) => {
    const r = mine(req, res); if (!r) return;
    const status = req.body?.status, reply = clip(req.body?.reply, 2000);
    if (!['done', 'declined'].includes(status)) return res.status(400).json({ error: 'Mark it done or declined' });
    if (status === 'declined' && !reply) return res.status(400).json({ error: 'Say why you’re declining — the person gets this note' });
    if (r.kind === 'erase' && status === 'done' && !r.erased) return res.status(400).json({ error: 'Erase their data first' });
    const x = T.datarequests.update(r.id, (y) => { y.status = status; y.reply = reply; y.closedAt = Date.now(); y.closedBy = req.actor?.email || req.user.email; });
    const u = req.user;
    await tellBuyer(u, { to: r.email, subject: `Your data request to ${bizOf(u)}`, text: `Hi${r.name ? ` ${r.name}` : ''},\n\nYour request to ${KINDS[r.kind].toLowerCase()} has been ${status === 'done' ? 'completed' : 'declined'}.${reply ? `\n\n${reply}` : ''}\n\n— ${bizOf(u)}` });
    res.json({ request: requestView(x) });
  });
}
