// White-label for agencies, kept apart from agency.js so it can change on its own:
//   - app domain ownership: an agency's app domain (app.agency.com) gets its brand and an HTTPS certificate only
//     after a TXT record proves it's theirs and a CNAME (or A) record points it here — the same proof as a seller's
//     funnel domain (domains.js). Re-checked in the background and on demand; a verified domain is only given up
//     after repeated failed checks over a whole day.
//   - email brand: for any account, the name, logo, colour, link base (the agency's verified domain, else APP_URL)
//     and sender its system emails use (sendBranded). An agency can send from its own address (on its verified
//     domain) through the platform's Resend account (WHITE_LABEL_SENDER=resend) or its own SMTP; when that isn't
//     verified or fails, mail goes from the platform's address under the agency's name.
//   - per-host app shell: the page title, web-app manifests and icon, and what /api/site may say on an agency's
//     domain (never the platform's company, GSTIN or prices).
import dns from 'node:dns/promises';
import net from 'node:net';
import crypto from 'node:crypto';
import nodemailer from 'nodemailer';
import { T, q, JOBS } from './db.js';
import { platform } from './platform.js';
import { sendMail, appUrl } from './mail.js';
import { resendSend, platformMailer, encrypt, decrypt } from './messaging.js';
import { checkPublicHost, allowPrivate, isPrivateIp } from './webhooks.js';
import { checkDomainDns, dnsRecords, cnameTarget, isApex, registrableDomain } from './domains.js';
import { brandFor, clientLimit } from './agency.js';

const DAY = 86400000;
const HOST_RE = /^(?=.{4,253}$)([a-z0-9](-?[a-z0-9])*\.)+[a-z]{2,}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const LAPSE_FAILS = 3;
const clip = (v, n) => String(v ?? '').trim().slice(0, n);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// ---------- app domain ownership ----------
// u.wlDomain = { domain, token, status: 'pending' | 'active', checkedAt, verifiedAt, error, failures, failingSince }
// — it belongs to settings.whiteLabel.domain only while the two match (a new domain starts a new proof)
export function verifiedDomainOf(u) {
  const d = u?.settings?.whiteLabel?.domain, p = u?.wlDomain;
  return d && p?.domain === d && p.status === 'active' ? d : null;
}
// the agency whose verified app domain this host is (or null)
export function agencyForHost(host) {
  const h = String(host || '').toLowerCase().split(':')[0];
  if (!h || !HOST_RE.test(h)) return null;
  const rows = T.users.all({ wlDomain: h }); // indexed (db.js users.wlDomain)
  return rows.find((u) => u.settings?.whiteLabel?.brand && verifiedDomainOf(u) === h) || null;
}
// another account has already proven this domain
export const domainTakenByOther = (domain, userId) => T.users.all({ wlDomain: String(domain).toLowerCase() }).some((u) => u.id !== userId && verifiedDomainOf(u) === domain);

// after the white-label is saved: a new (or removed) domain starts (or drops) its proof
export function syncDomainProof(userId) {
  return T.users.update(userId, (x) => {
    const d = x.settings?.whiteLabel?.domain;
    if (!d) { delete x.wlDomain; return; }
    if (x.wlDomain?.domain !== d) x.wlDomain = { domain: d, token: crypto.randomBytes(12).toString('hex'), status: 'pending', error: null, createdAt: Date.now() };
  });
}
export function domainView(u) {
  const p = u?.wlDomain;
  if (!p?.domain || p.domain !== u.settings?.whiteLabel?.domain) return null;
  return { domain: p.domain, status: p.status, error: p.error || null, checkedAt: p.checkedAt || null, verifiedAt: p.verifiedAt || null, records: dnsRecords(p, { what: 'your app', www: false }) };
}
export async function verifyAgencyDomain(userId) {
  const p = T.users.get(userId)?.wlDomain;
  if (!p?.domain) return null;
  const r = await checkDomainDns(p);
  let won = false;
  // DNS lookups take a while: apply the result to the latest copy (the domain may have been changed meanwhile)
  const u = T.users.update(userId, (x) => {
    const d = x.wlDomain;
    if (!d || d.domain !== p.domain || d.token !== p.token) return;
    const now = Date.now();
    d.checkedAt = now;
    if (d.status === 'active') {
      // a verified domain only has to keep pointing here (agencies often delete the TXT record afterwards)
      if (r.route) { d.error = null; d.failures = 0; d.failingSince = null; return; }
      d.failures = (d.failures || 0) + 1; d.failingSince ||= now;
      d.error = `${d.domain} stopped pointing to this server (${isApex(d.domain) ? 'A record' : `CNAME to ${cnameTarget()}`}) — fix the DNS record to keep it working`;
      if (d.failures >= LAPSE_FAILS && now - d.failingSince >= DAY) { d.status = 'pending'; d.lapsedAt = now; }
    } else if (r.txt && r.route) {
      Object.assign(d, { status: 'active', error: null, failures: 0, failingSince: null, lapsedAt: null });
      d.verifiedAt ||= now; won = true;
    } else {
      d.status = 'pending';
      d.error = !r.txt && !r.route ? 'Neither DNS record found yet' : !r.txt ? 'TXT record not found yet' : `The domain doesn’t point to this server yet (${isApex(d.domain) ? 'A record' : `CNAME to ${cnameTarget()}`})`;
    }
  });
  // proven: anyone else's unproven claim on the same domain is dropped
  if (won) for (const row of q("SELECT data FROM users WHERE json_extract(data, '$.settings.whiteLabel.domain') = ? AND id != ?").all(p.domain, userId)) {
    T.users.update(JSON.parse(row.data).id, (x) => { if (x.settings?.whiteLabel) x.settings.whiteLabel.domain = ''; delete x.wlDomain; delete x.wlSender; });
  }
  return u;
}

// ---------- the agency's own sender ----------
// u.wlSender = { address, mode: 'resend' | 'smtp', status: 'pending' | 'verified' | 'failed', providerId, records,
//   smtp: { host, port, secure, user, passEnc }, checkedAt, error }
const resendKey = () => process.env.RESEND_API_KEY || (platformMailer()?.provider === 'resend' ? platformMailer().key : '');
// the provider API that creates and verifies sending domains is behind a flag (it changes the platform's Resend account)
export const senderMode = () => (process.env.WHITE_LABEL_SENDER === 'resend' && resendKey() ? 'resend' : 'smtp');
const resendBase = () => process.env.RESEND_BASE_URL || 'https://api.resend.com';
async function resendApi(method, path, body) {
  const r = await fetch(`${resendBase()}${path}`, { method, headers: { Authorization: `Bearer ${resendKey()}`, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(10000) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(d.message || `Email provider error ${r.status}`), { status: r.status });
  return d;
}
const senderDomainOk = (address, appDomain) => { const d = address.split('@')[1] || ''; const root = registrableDomain(appDomain); return d === root || d.endsWith(`.${root}`); };
export function senderOf(owner) {
  const s = owner?.wlSender, app = verifiedDomainOf(owner);
  return s?.status === 'verified' && app && senderDomainOk(s.address, app) ? s : null;
}
export function senderView(u) {
  const s = u?.wlSender;
  const base = { mode: senderMode(), appDomain: verifiedDomainOf(u) };
  if (!s) return { ...base, address: '', status: 'none' };
  const domain = s.address.split('@')[1];
  const records = s.mode === 'resend'
    ? (s.records || []).map((r) => ({ type: r.type, name: r.name ? `${r.name}.${domain}` : domain, value: r.value, ...(r.priority != null ? { priority: r.priority } : {}), why: r.record === 'DKIM' ? 'DKIM: signs your emails' : r.record === 'SPF' ? 'SPF: allows us to send for you' : r.record || '' }))
    : [{ type: 'TXT', name: domain, value: 'v=spf1 include:<your email provider> ~all', why: 'SPF: copy the exact value from your email provider' }, { type: 'TXT', name: `<selector>._domainkey.${domain}`, value: '<DKIM key from your email provider>', why: 'DKIM: your email provider gives you this record' }];
  return { ...base, address: s.address, status: senderOf(u) ? 'verified' : s.status === 'verified' ? 'pending' : s.status, error: s.error || null, checkedAt: s.checkedAt || null, records, ...(s.smtp ? { smtp: { host: s.smtp.host, port: s.smtp.port, secure: !!s.smtp.secure, user: s.smtp.user } } : {}) };
}
async function smtpConfig(s) {
  const cfg = { host: s.smtp.host, port: Number(s.smtp.port) || 587, secure: !!s.smtp.secure, auth: s.smtp.user ? { user: s.smtp.user, pass: decrypt(s.smtp.passEnc) } : undefined, connectionTimeout: 15000, greetingTimeout: 15000, socketTimeout: 20000 };
  // the host is re-checked at use (DNS can change after saving), and the connection goes to the address checked
  await checkPublicHost(cfg.host);
  if (!allowPrivate() && !net.isIP(cfg.host)) { const { address } = await dns.lookup(cfg.host); if (isPrivateIp(address)) throw new Error('This must be a public internet address'); return { ...cfg, host: address, tls: { servername: cfg.host } }; }
  return cfg;
}
// asks the provider (or the SMTP server) whether the sender works now
export async function checkSender(userId) {
  const s = T.users.get(userId)?.wlSender;
  if (!s) return null;
  let status = 'pending', error = null;
  try {
    if (s.mode === 'resend') {
      await resendApi('POST', `/domains/${s.providerId}/verify`).catch(() => {});
      const d = await resendApi('GET', `/domains/${s.providerId}`);
      status = d.status === 'verified' ? 'verified' : d.status === 'failed' ? 'failed' : 'pending';
      if (status !== 'verified') error = status === 'failed' ? 'The provider couldn’t find the DNS records — check them and try again' : 'Waiting for the DNS records to show up (this can take a few hours)';
      if (Array.isArray(d.records)) s.records = d.records;
    } else {
      await nodemailer.createTransport(await smtpConfig(s)).verify();
      status = 'verified';
    }
  } catch (e) { status = s.mode === 'smtp' ? 'failed' : s.status === 'verified' ? 'verified' : 'pending'; error = e.message; }
  return T.users.update(userId, (x) => { if (x.wlSender?.address !== s.address) return; Object.assign(x.wlSender, { status, error, checkedAt: Date.now(), ...(s.records ? { records: s.records } : {}) }); });
}
async function sendViaAgency(s, msg) {
  if (s.mode === 'resend') return resendSend(resendKey(), { from: msg.from, to: msg.to, subject: msg.subject, text: msg.text, html: msg.html, ...(msg.replyTo ? { reply_to: msg.replyTo } : {}) });
  return nodemailer.createTransport(await smtpConfig(s)).sendMail({ from: msg.from, to: msg.to, subject: msg.subject, text: msg.text, html: msg.html, replyTo: msg.replyTo || undefined });
}

// ---------- the brand an account's emails go out under ----------
// the agency whose white-label applies to an account: its agency's, or its own when it is one
const agencyOf = (u) => { const o = u?.agencyId ? T.users.get(u.agencyId) : u; return o?.settings?.whiteLabel?.brand ? o : null; };
// → { name, logo, color, linkBase, supportEmail, agencyId, sender }. Without an agency, a request made on an agency's
// domain (a sign-up there) still gets that agency's brand.
export function emailBrand(u, req) {
  const owner = agencyOf(u) || (req ? agencyForHost(req.hostname) : null);
  const app = String(process.env.APP_URL || (req ? appUrl(req) : '')).replace(/\/+$/, '');
  if (!owner) return { name: platform().brand, logo: '', color: '', linkBase: app, supportEmail: '', agencyId: null, sender: null };
  const w = owner.settings.whiteLabel, d = verifiedDomainOf(owner), linkBase = d ? `https://${d}` : app;
  return { name: w.brand, logo: w.logo ? (w.logo.startsWith('/') ? `${linkBase}${w.logo}` : w.logo) : '', color: w.primary || '', linkBase, supportEmail: w.supportEmail || '', agencyId: owner.id, sender: senderOf(owner) };
}
export function brandedHtml(b, text) {
  const color = /^#[0-9a-f]{6}$/i.test(b.color) ? b.color : '#4f46e5';
  const body = esc(text).replace(/(https?:\/\/[^\s<]+)/g, (u) => `<a href="${u}" style="color:${color}">${u}</a>`).replace(/\n/g, '<br>');
  const head = b.logo ? `<img src="${esc(b.logo)}" alt="${esc(b.name)}" height="36" style="height:36px;border:0;display:block">` : `<b style="font-size:18px;color:${color}">${esc(b.name)}</b>`;
  return `<div style="font:15px/1.6 -apple-system,Segoe UI,Roboto,sans-serif;color:#1f2937;max-width:560px;margin:0 auto"><div style="padding:14px 0;border-bottom:3px solid ${color}">${head}</div><div style="padding:20px 0">${body}</div>${b.supportEmail ? `<p style="color:#6b7280;font-size:13px">Need help? Write to ${esc(b.supportEmail)}</p>` : ''}</div>`;
}
// one system email to a person, in the brand of account u (see emailBrand). msg: { to, subject, text } — or a
// function (brand) → { to, subject, text }, so links can use the brand's link base.
export async function sendBranded(u, req, msg) {
  const b = emailBrand(u, req);
  const m = typeof msg === 'function' ? msg(b) : msg;
  if (!b.agencyId) return sendMail(m);
  const html = brandedHtml(b, m.text), replyTo = b.supportEmail || undefined;
  if (b.sender) {
    try { await sendViaAgency(b.sender, { ...m, html, replyTo, from: `"${b.name.replace(/["<>]/g, '')}" <${b.sender.address}>` }); return { sent: true, via: 'agency' }; } catch (e) { console.error(`agency sender failed (${b.sender.address}), sending from the platform address instead:`, e.message); }
  }
  // the platform's address under the agency's name
  return sendMail({ ...m, html, fromName: b.name, replyTo });
}

// ---------- per-host app shell ----------
// what /api/site says on an agency's domain: its brand and legal details, never the platform's company or prices
export function agencySite(wl, common) {
  return { ...common, agencyHost: true, whiteLabel: wl, brand: wl.brand, googleClientId: null, company: { name: wl.legalName || wl.brand, address: wl.address || '', email: wl.supportEmail || '', phone: wl.supportPhone || '', termsUrl: wl.termsUrl || '', privacyUrl: wl.privacyUrl || '' } };
}
const hostBrand = (req) => { const a = agencyForHost(req.hostname); return a ? { ...brandFor(a), domain: verifiedDomainOf(a) } : null; };
// the app's index.html for this host: the brand's name in the title, its manifest and colour, and (on an agency's
// domain) a meta tag the app reads before anything loads
export function brandedIndex(html, req) {
  const wl = hostBrand(req), name = wl?.brand || platform().brand;
  const head = `<link rel="manifest" href="/manifest.webmanifest"><meta name="theme-color" content="${esc(wl?.primary || '#1c1917')}">${wl ? `<meta name="ff-agency" content="${esc(JSON.stringify({ brand: wl.brand, logo: wl.logo, primary: wl.primary, legalName: wl.legalName || '', supportEmail: wl.supportEmail || '', termsUrl: wl.termsUrl || '', privacyUrl: wl.privacyUrl || '' }))}">${wl.logo ? `<link rel="icon" href="${esc(wl.logo)}">` : ''}` : ''}`;
  return html.replace(/<title>[^<]*<\/title>/, `<title>${esc(name)}</title>`).replace('<!--ff-head-->', () => `${head}<!--ff-head-->`);
}

export function registerWhiteLabel(app, { auth, rateLimit, isTest }) {
  const owner = (req, res) => {
    if (req.actor || req.apiKey) { res.status(403).json({ error: 'Only the agency owner can change the white-label' }); return null; }
    if (req.user.agencyId || !clientLimit(req.user)) { res.status(402).json({ error: 'White-label comes with the Agency plan', upgrade: true }); return null; }
    // a domain saved before proofs existed gets its proof (and DNS records to add) the first time it's looked at
    if (req.user.settings?.whiteLabel?.domain && req.user.wlDomain?.domain !== req.user.settings.whiteLabel.domain) req.user = syncDomainProof(req.user.id);
    return req.user;
  };
  const status = (u) => ({ domain: domainView(u), sender: senderView(u) });
  const limiter = rateLimit({ windowMs: 600000, max: isTest ? 1000 : 30, key: (req) => req.user.id, message: 'Too many checks — please wait a few minutes.' });

  app.get('/api/agency/white-label/status', auth, (req, res) => { if (!owner(req, res)) return; res.json(status(req.user)); });
  // check the DNS records now (and the sender, when there is one)
  app.post('/api/agency/white-label/verify', auth, limiter, async (req, res) => {
    if (!owner(req, res)) return;
    await verifyAgencyDomain(req.user.id).catch(() => {});
    if (T.users.get(req.user.id).wlSender) await checkSender(req.user.id).catch(() => {});
    res.json(status(T.users.get(req.user.id)));
  });
  // the "from" address for emails to the agency's clients: { address, smtp?: { host, port, secure, user, pass } }
  app.put('/api/agency/white-label/sender', auth, limiter, async (req, res) => {
    const u = owner(req, res); if (!u) return;
    const address = clip(req.body?.address, 200).toLowerCase();
    if (!address) { T.users.update(u.id, (x) => { delete x.wlSender; }); return res.json(status(T.users.get(u.id))); }
    const appDomain = verifiedDomainOf(u);
    if (!appDomain) return res.status(400).json({ error: 'Verify your app domain first — the sender address must be on it' });
    if (!EMAIL_RE.test(address)) return res.status(400).json({ error: 'Enter an email address like hello@youragency.com' });
    if (!senderDomainOk(address, appDomain)) return res.status(400).json({ error: `Use an address on ${registrableDomain(appDomain)}` });
    const mode = senderMode(), prev = u.wlSender;
    const s = { address, mode, status: 'pending', error: null, createdAt: Date.now() };
    if (mode === 'resend') {
      const domain = address.split('@')[1];
      if (prev?.mode === 'resend' && prev.address.split('@')[1] === domain && prev.providerId) Object.assign(s, { providerId: prev.providerId, records: prev.records });
      else {
        try {
          let d;
          try { d = await resendApi('POST', '/domains', { name: domain }); } catch (e) { const list = await resendApi('GET', '/domains'); d = (list.data || []).find((x) => x.name === domain); if (!d) throw e; d = await resendApi('GET', `/domains/${d.id}`); }
          Object.assign(s, { providerId: d.id, records: d.records || [] });
        } catch (e) { return res.status(502).json({ error: `The email provider refused this domain: ${e.message}` }); }
      }
    } else {
      const b = req.body?.smtp || {};
      const host = clip(b.host, 200).toLowerCase(), user = clip(b.user, 200), pass = String(b.pass || '');
      if (!host || !user) return res.status(400).json({ error: 'Enter your SMTP server and username (from your email provider)' });
      try { await checkPublicHost(host); } catch (e) { return res.status(400).json({ error: e.message }); }
      const keepPass = !pass && prev?.smtp?.host === host && prev.smtp.user === user;
      if (!pass && !keepPass) return res.status(400).json({ error: 'Enter the SMTP password' });
      s.smtp = { host, port: Math.min(65535, Math.max(1, Number(b.port) || 587)), secure: !!b.secure, user, passEnc: keepPass ? prev.smtp.passEnc : encrypt(pass) };
    }
    T.users.update(u.id, (x) => { x.wlSender = s; });
    await checkSender(u.id).catch(() => {});
    res.json(status(T.users.get(u.id)));
  });

  // the installable app's manifest and icon, in the brand of the domain it's opened on
  const brandOfReq = (req) => { const wl = hostBrand(req); return { name: wl?.brand || platform().brand, color: wl?.primary || '#1c1917', logo: wl?.logo || '' }; };
  const manifest = (req, extra) => {
    const b = brandOfReq(req);
    const icons = b.logo ? [{ src: b.logo, sizes: 'any', purpose: 'any' }] : [{ src: '/brand-icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }, { src: '/brand-icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'maskable' }];
    return { name: b.name, short_name: b.name.slice(0, 12), id: '/', start_url: '/', scope: '/', display: 'standalone', background_color: '#f6f5f2', theme_color: b.color, icons, ...extra(b) };
  };
  const sendManifest = (res, m) => res.set('Cache-Control', 'no-cache').type('application/manifest+json').send(JSON.stringify(m));
  app.get('/manifest.webmanifest', (req, res) => sendManifest(res, manifest(req, () => ({}))));
  app.get('/counter.webmanifest', (req, res) => sendManifest(res, manifest(req, (b) => ({ name: `${b.name} Counter`, short_name: 'Counter', description: 'Bill at the shop counter: scan, bill, print — works offline', id: '/counter', start_url: '/counter', scope: '/counter', orientation: 'portrait', ...(b.logo ? {} : { icons: [{ src: '/counter-icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }, { src: '/counter-icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'maskable' }] }) }))));
  app.get('/brand-icon.svg', (req, res) => {
    const b = brandOfReq(req), color = /^#[0-9a-f]{6}$/i.test(b.color) ? b.color : '#1c1917';
    res.set('Cache-Control', 'public, max-age=3600').type('image/svg+xml').send(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" rx="96" fill="${color}"/><text x="256" y="340" font-family="Arial,Helvetica,sans-serif" font-size="280" font-weight="700" fill="#fff" text-anchor="middle">${esc((b.name.trim()[0] || 'A').toUpperCase())}</text></svg>`);
  });

  // on an agency's domain: no platform pricing or admin screens; its own terms and privacy links when it has them
  app.get(/^\/(admin|pricing|terms|privacy)(\/|$)/, (req, res, next) => {
    const a = agencyForHost(req.hostname);
    if (!a) return next();
    const w = a.settings.whiteLabel, seg = req.path.split('/')[1];
    if (seg === 'admin') return res.redirect(302, '/');
    if (seg === 'pricing') return res.redirect(302, '/login');
    const url = seg === 'terms' ? w.termsUrl : w.privacyUrl;
    return url ? res.redirect(302, url) : next();
  });

  // re-check domains being set up every few minutes for 3 days, verified ones once a day (every 6 hours while
  // failing); senders being set up every 10 minutes, verified ones once a day
  if (JOBS && !isTest) setInterval(() => {
    const now = Date.now();
    for (const row of q("SELECT data FROM users WHERE json_extract(data, '$.wlDomain.domain') IS NOT NULL").all()) {
      const u = JSON.parse(row.data), d = u.wlDomain;
      if (d.status === 'pending' ? Math.max(d.createdAt || 0, d.lapsedAt || 0) > now - 3 * DAY && now - (d.checkedAt || 0) > 5 * 60000 : now - (d.checkedAt || d.verifiedAt || 0) > (d.failures ? 6 : 24) * 3600000) verifyAgencyDomain(u.id).catch(() => {});
      const s = u.wlSender;
      if (s && (s.status === 'verified' ? now - (s.checkedAt || 0) > DAY : (s.createdAt || 0) > now - 3 * DAY && now - (s.checkedAt || 0) > 10 * 60000)) checkSender(u.id).catch(() => {});
    }
  }, 60000).unref();
}
