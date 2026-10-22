// Messages to a seller's contacts: email (the seller's own SMTP, or the server's SMTP / Resend)
// and WhatsApp (Meta WhatsApp Cloud API). Passwords and tokens are stored encrypted (AES-256-GCM).
import crypto from 'node:crypto';
import nodemailer from 'nodemailer';
import dns from 'node:dns/promises';
import net from 'node:net';
import { checkPublicHost, allowPrivate, isPrivateIp } from './webhooks.js';
import { T } from './db.js';

let KEY = null;
export function initMessaging(secret) { KEY = crypto.createHash('sha256').update(`channels:${process.env.ENCRYPTION_KEY || secret}`).digest(); }
export function encrypt(text) {
  if (!text) return '';
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const enc = Buffer.concat([c.update(String(text), 'utf8'), c.final()]);
  return `v1:${iv.toString('base64')}:${c.getAuthTag().toString('base64')}:${enc.toString('base64')}`;
}
export function decrypt(blob) {
  if (!blob) return '';
  try {
    const [, iv, tag, data] = String(blob).split(':');
    const d = crypto.createDecipheriv('aes-256-gcm', KEY, Buffer.from(iv, 'base64'));
    d.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([d.update(Buffer.from(data, 'base64')), d.final()]).toString('utf8');
  } catch { return ''; }
}

// ---------- email ----------
// the platform's own sender (Resend), entered in Admin → Email sending; server env vars win
var mailSettings; // var (no initialiser) + function declarations: platform.js registers this during a circular import, before this file runs
export function useMailSettings(fn) { mailSettings = fn; }
export function resendKey() { return process.env.RESEND_API_KEY || mailSettings?.()?.resendKey || ''; }
export function mailFrom() { return process.env.MAIL_FROM || mailSettings?.()?.from || 'FunnelHive <no-reply@funnelhive.app>'; }
// a seller's emails go out from the platform address under the seller's own name ("Asha Yoga" <no-reply@…>)
const fromAs = (name) => { const addr = (/<([^>]+)>/.exec(mailFrom()) || [])[1] || mailFrom(); return name ? `"${String(name).replace(/["<>]/g, '')}" <${addr}>` : mailFrom(); };
export async function resendSend(key, payload) {
  const r = await fetch(`${process.env.RESEND_BASE_URL || 'https://api.resend.com'}/emails`, { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(10000) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(d.message || `Email provider error ${r.status}`); e.status = r.status; throw e; }
  return d;
}
const envSmtp = () => (process.env.SMTP_HOST ? { host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT || 587), secure: process.env.SMTP_SECURE ? process.env.SMTP_SECURE === 'true' : Number(process.env.SMTP_PORT) === 465, user: process.env.SMTP_USER || '', pass: process.env.SMTP_PASS || '' } : null);
const userSmtp = (u) => { const e = u?.channels?.email; return e?.host ? { host: e.host, port: e.port, secure: e.secure, user: e.user, pass: decrypt(e.passEnc) } : null; };
export function emailStatus(u) {
  if (userSmtp(u)) return { configured: true, via: 'your SMTP' };
  if (envSmtp()) return { configured: true, via: 'server SMTP' };
  if (resendKey()) return { configured: true, via: 'Resend' };
  return { configured: false };
}
const transports = new Map();
function transportFor(cfg) {
  const k = JSON.stringify(cfg);
  if (!transports.has(k)) transports.set(k, nodemailer.createTransport({ host: cfg.ip || cfg.host, ...(cfg.ip ? { servername: cfg.host } : {}), port: cfg.port, secure: !!cfg.secure, auth: cfg.user ? { user: cfg.user, pass: cfg.pass } : undefined, connectionTimeout: 15000, greetingTimeout: 15000, socketTimeout: 20000 }));
  return transports.get(k);
}
// track: { link(url) → tracked url, pixel: url } — open/click tracking for automation emails
const htmlOf = (text, track) => `<div style="font:15px/1.6 -apple-system,Segoe UI,Roboto,sans-serif;color:#1f2937;max-width:560px">${String(text).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]).replace(/(https?:\/\/[^\s<]+)/g, (u) => `<a href="${(track ? track.link(u.replace(/&amp;/g, '&')) : u.replace(/&amp;/g, '&')).replace(/&/g, '&amp;').replace(/"/g, '&quot;')}">${u}</a>`).replace(/\n/g, '<br>')}</div>${track?.pixel ? `<img src="${track.pixel}" width="1" height="1" alt="" style="display:block;border:0;width:1px;height:1px">` : ''}`;

// → { status: 'sent', id } | { status: 'not-configured' }; throws on a provider error
export async function sendEmail(u, { to, subject, text, unsubscribeUrl, cfgOverride, track }) {
  const own = cfgOverride || userSmtp(u);
  const e = u?.channels?.email || {};
  const fromName = e.fromName || u?.settings?.businessName || 'FunnelHive';
  const body = unsubscribeUrl ? `${text}\n\n—\nDon’t want these emails? Unsubscribe: ${unsubscribeUrl}` : text;
  const headers = unsubscribeUrl ? { 'List-Unsubscribe': `<${unsubscribeUrl}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' } : undefined;
  // a seller's SMTP host is re-checked on send (DNS can change after saving) and the connection goes to the very
  // address that was checked, so a DNS answer that flips to a private address can't slip in between
  let smtp = own || envSmtp();
  if (own) { await checkPublicHost(own.host); if (!allowPrivate() && !net.isIP(own.host)) { const { address } = await dns.lookup(own.host); if (isPrivateIp(address)) throw new Error('This must be a public internet address'); smtp = { ...own, ip: address }; } }
  if (smtp) {
    const from = own ? `"${fromName.replace(/"/g, '')}" <${e.fromEmail || smtp.user}>` : process.env.MAIL_FROM || `"${fromName.replace(/"/g, '')}" <${smtp.user}>`;
    const info = await transportFor(smtp).sendMail({ from, to, subject, text: body, html: htmlOf(body, track), replyTo: e.replyTo || undefined, headers });
    return { status: 'sent', id: info.messageId };
  }
  if (resendKey()) {
    const d = await resendSend(resendKey(), { from: u ? fromAs(fromName) : mailFrom(), to, subject, text: body, html: htmlOf(body, track), reply_to: e.replyTo || u?.email, headers });
    return { status: 'sent', id: d.id };
  }
  return { status: 'not-configured' };
}

// ---------- WhatsApp (Meta Cloud API) ----------
const GRAPH = process.env.WHATSAPP_GRAPH_URL || 'https://graph.facebook.com/v21.0';
export const waTo = (p = '') => { const d = String(p).replace(/\D/g, ''); return d.length === 10 ? `91${d}` : d.replace(/^0+/, ''); };
// other providers (the owner's Hive WhatsApp API — hive-wa.js) plug in here; Meta direct stays the default
// (a hoisted function holding the list, so a provider can register while this module is still loading)
export function registerWhatsAppProvider(name, p) { registerWhatsAppProvider.list = { ...registerWhatsAppProvider.list, [name]: p }; }
const waProvider = (u) => { const n = u?.channels?.whatsapp?.provider; return n && n !== 'meta' ? registerWhatsAppProvider.list?.[n] || null : null; };
export function whatsappStatus(u) {
  const p = waProvider(u);
  if (p) return { configured: p.configured(u), provider: u.channels.whatsapp.provider };
  const w = u?.channels?.whatsapp; return { configured: !!(w?.phoneNumberId && w?.tokenEnc) };
}

// msg: { text } (only inside the 24-hour customer-service window) or { template, language, params: [] }
// (Hive also takes key — the Idempotency-Key, so a retry never sends twice — and ckey, the contact)
export async function sendWhatsApp(u, to, msg) {
  const p = waProvider(u);
  if (p) return p.send(u, to, msg);
  const w = u?.channels?.whatsapp;
  if (!w?.phoneNumberId || !w?.tokenEnc) return { status: 'not-configured' };
  const num = waTo(to);
  if (num.length < 10) throw new Error('Not a valid phone number');
  const body = msg.template
    ? { messaging_product: 'whatsapp', to: num, type: 'template', template: { name: msg.template, language: { code: msg.language || 'en' }, ...(msg.params?.length ? { components: [{ type: 'body', parameters: msg.params.map((t) => ({ type: 'text', text: String(t || '-').slice(0, 1000) })) }] } : {}) } }
    : { messaging_product: 'whatsapp', to: num, type: 'text', text: { body: String(msg.text).slice(0, 4096), preview_url: true } };
  const r = await fetch(`${GRAPH}/${encodeURIComponent(w.phoneNumberId)}/messages`, {
    method: 'POST', headers: { Authorization: `Bearer ${decrypt(w.tokenEnc)}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body), signal: AbortSignal.timeout(15000),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const m = data?.error?.error_data?.details || data?.error?.message || `HTTP ${r.status}`;
    // 131047: outside the 24h window — free text not allowed, a template is required
    throw new Error(data?.error?.code === 131047 ? 'More than 24 hours since this contact last messaged you — WhatsApp only allows approved templates now' : `WhatsApp: ${m}`);
  }
  return { status: 'sent', id: data?.messages?.[0]?.id };
}

// ---------- settings API (secrets never leave the server) ----------
const str = (v, n) => String(v ?? '').trim().slice(0, n);
export const publicChannels = (u) => {
  const e = u.channels?.email || {}, w = u.channels?.whatsapp || {};
  return {
    email: { host: e.host || '', port: e.port || 465, secure: e.secure ?? true, user: e.user || '', hasPassword: !!e.passEnc, fromName: e.fromName || '', fromEmail: e.fromEmail || '', replyTo: e.replyTo || '', ...emailStatus(u) },
    whatsapp: { phoneNumberId: w.phoneNumberId || '', businessId: w.businessId || '', hasToken: !!w.tokenEnc, provider: w.provider || 'meta', ...whatsappStatus(u) },
    razorpay: (({ keyId = '', secretEnc, webhookSecretEnc } = {}) => ({ keyId, hasSecret: !!secretEnc, hasWebhookSecret: !!webhookSecretEnc, mode: keyId.startsWith('rzp_live_') ? 'live' : keyId ? 'test' : null, configured: !!(keyId && secretEnc), webhookUrl: `/api/razorpay/webhook/${u.id}` }))(u.channels?.razorpay),
  };
};
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Saves one channel (email / whatsapp / razorpay) on the latest copy of the account; undefined removes it
export function setChannel(userId, name, value) {
  return T.users.update(userId, (u) => { u.channels = { ...u.channels }; if (value === undefined) delete u.channels[name]; else u.channels[name] = value; });
}
export function registerChannels(app, { auth, wrap, rateLimit, isTest }) {
  const testLimiter = rateLimit({ windowMs: 60000, max: isTest ? 1000 : 6, key: (req) => req.user.id, message: 'Too many test messages — please wait a minute.' });
  app.get('/api/channels', auth, (req, res) => res.json(publicChannels(req.user)));
  app.put('/api/channels/email', auth, wrap(async (req, res) => {
    const b = req.body || {};
    if (b.clear) return res.json(publicChannels(setChannel(req.user.id, 'email', undefined)));
    const host = str(b.host, 200).toLowerCase();
    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(host) && !/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return res.status(400).json({ error: 'Enter the SMTP server, e.g. smtp.gmail.com' });
    const port = Number(b.port);
    if (![25, 465, 587, 2525].includes(port) && !(allowPrivate() && port > 0 && port < 65536)) return res.status(400).json({ error: 'Use port 465 (SSL) or 587 (STARTTLS) — 25 and 2525 also work' });
    const fromEmail = str(b.fromEmail, 200);
    if (fromEmail && !EMAIL_RE.test(fromEmail)) return res.status(400).json({ error: 'The “from” address isn’t a valid email' });
    const replyTo = str(b.replyTo, 200);
    if (replyTo && !EMAIL_RE.test(replyTo)) return res.status(400).json({ error: 'The reply-to address isn’t a valid email' });
    const prevE = req.user.channels?.email || {};
    if (!str(b.user, 200) || (!b.pass && !prevE.passEnc)) return res.status(400).json({ error: 'Enter the SMTP username and password' });
    try { await checkPublicHost(host); } catch (e) { return res.status(400).json({ error: `SMTP server: ${e.message}` }); }
    const prev = req.user.channels?.email || {};
    res.json(publicChannels(setChannel(req.user.id, 'email', { host, port, secure: b.secure ?? port === 465, user: str(b.user, 200), passEnc: b.pass ? encrypt(String(b.pass).slice(0, 500)) : prev.passEnc || '', fromName: str(b.fromName, 80), fromEmail, replyTo })));
  }));
  app.put('/api/channels/whatsapp', auth, (req, res) => {
    const b = req.body || {};
    const prev = req.user.channels?.whatsapp || {};
    // the Hive WhatsApp settings (and which provider is in use) stay when the Meta details change
    const keep = prev.hive ? { hive: prev.hive, ...(prev.provider ? { provider: prev.provider } : {}) } : {};
    if (b.clear) return res.json(publicChannels(setChannel(req.user.id, 'whatsapp', prev.hive ? keep : undefined)));
    const phoneNumberId = str(b.phoneNumberId, 40);
    if (!/^\d{6,30}$/.test(phoneNumberId)) return res.status(400).json({ error: 'The Phone number ID is a long number from Meta → WhatsApp → API setup' });
    const token = str(b.token, 1000);
    if (!token && !prev.tokenEnc) return res.status(400).json({ error: 'Paste your permanent access token' });
    res.json(publicChannels(setChannel(req.user.id, 'whatsapp', { ...keep, phoneNumberId, businessId: str(b.businessId, 40), tokenEnc: token ? encrypt(token) : prev.tokenEnc })));
  });
  app.post('/api/channels/email/test', auth, testLimiter, wrap(async (req, res) => {
    const to = str(req.body.to || req.user.email, 200);
    if (!EMAIL_RE.test(to)) return res.status(400).json({ error: 'Enter a valid email address' });
    try {
      const r = await sendEmail(req.user, { to, subject: 'Test email from FunnelHive ✅', text: `This is a test.\n\nIf you can read this, emails to your contacts will be delivered through ${emailStatus(req.user).via || 'your mail server'}.` });
      if (r.status !== 'sent') return res.status(400).json({ error: 'Email sending isn’t set up yet — add your SMTP details first' });
      res.json({ ok: true, to });
    } catch (e) { res.status(400).json({ error: `Couldn’t send: ${e.message}` }); }
  }));
  app.post('/api/channels/whatsapp/test', auth, testLimiter, wrap(async (req, res) => {
    const to = str(req.body.to, 30);
    try {
      const r = await sendWhatsApp(req.user, to, { template: str(req.body.template, 120) || 'hello_world', language: str(req.body.language, 10) || 'en_US' });
      if (r.status !== 'sent') return res.status(400).json({ error: 'WhatsApp isn’t connected yet' });
      res.json({ ok: true, id: r.id });
    } catch (e) { res.status(400).json({ error: e.message }); }
  }));
}
