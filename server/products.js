// Digital products: what a seller delivers after a sale — files, links and/or a course — who can
// access them, and each buyer's private library.
//
//  - A product is attached to what a funnel sells (checkout, order bump, upsell/downsell, cross-sell items)
//    or to a free opt-in / form (lead magnet). Access is granted only for verified payments (Razorpay, or a
//    free order while Razorpay is connected) — a demo checkout never hands out paid files.
//  - Buyers get two kinds of link:
//      library link  /access/<token>        every product they have from this seller; only ever sent by email
//                                            (or shared by the seller), because it proves inbox ownership
//      receipt link  /access/o.<id>.<sig>   just what one order / sign-up delivered; shown on the thank-you page
//  - Files are never public: downloads go through short-lived signed URLs, are counted, and can be limited.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { T, q, tx, uid, contactKey, dir as DATA_DIR } from './db.js';
import { encrypt, decrypt, sendEmail, emailStatus } from './messaging.js';
import { waEvent } from './hive-wa.js';
import { randomToken, hashToken } from './security.js';
import { buyerPlans } from './plans.js';
import { stripeCreds } from './stripe.js';
import { s3Enabled, putFile, deleteObject, copyObject, presign } from './storage.js';
import { queueVideo, dropHls } from './video.js';
import { domainOfFunnel } from './domains.js';
import { GST_RATES, cleanHsn } from './sales.js';

const FILE_DIR = path.resolve(DATA_DIR, 'products');
const MB = 1024 * 1024;
export const FILE_MAX = Number(process.env.PRODUCT_FILE_MAX_MB || 2048) * MB;
export const STORAGE_MAX = Number(process.env.PRODUCT_STORAGE_GB || 20) * 1024 * MB;
const DL_TTL = 2 * 3600000; // signed download links work for 2 hours (long enough for a slow video or a big zip)
const DAY = 86400000;
// shown in the browser instead of downloaded when asked to (videos and PDFs in the course player)
const INLINE = /^(video\/(mp4|webm|ogg)|audio\/(mpeg|mp4|ogg|wav)|application\/pdf|image\/(png|jpeg|webp|gif))$/;

let SECRET = '';
const sig = (s) => crypto.createHmac('sha256', SECRET).update(s).digest('base64url').slice(0, 32);
const same = (a, b) => typeof a === 'string' && typeof b === 'string' && a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
const clip = (v, n) => String(v ?? '').trim().slice(0, n);
const httpUrl = (v) => { const s = clip(v, 1000); return /^https?:\/\/[^\s"'<>]+$/i.test(s) ? s : ''; };
const imgUrl = (v) => { const s = clip(v, 1000); return /^\/uploads\/[\w./-]+$/.test(s) || /^https:\/\/[^\s"'<>]+$/i.test(s) ? s : ''; };
const intIn = (v, lo, hi) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : lo; };

// Where a buyer's links point: the funnel's own domain when one is connected, otherwise the app
export function linkBase(funnelId, fallback) {
  const d = funnelId && domainOfFunnel(funnelId);
  return d ? `https://${d}` : (process.env.PAGES_URL || process.env.APP_URL || fallback || '').replace(/\/+$/, '');
}

// ---------- products ----------
// a lesson's quiz: 1–30 questions, each with 2–6 options and the right one; pass mark in %
export function cleanQuiz(z) {
  if (!z || !Array.isArray(z.questions)) return null;
  const questions = z.questions.slice(0, 30).map((x) => {
    const options = (Array.isArray(x?.options) ? x.options : []).map((o) => clip(o, 300)).filter(Boolean).slice(0, 6);
    const answer = Math.round(Number(x?.answer));
    return { q: clip(x?.q, 500), options, answer: answer >= 0 && answer < options.length ? answer : 0, explain: clip(x?.explain, 600) };
  }).filter((x) => x.q && x.options.length >= 2);
  return questions.length ? { questions, pass: intIn(z.pass ?? 70, 0, 100) } : null;
}
function cleanProduct(b = {}, cur = {}) {
  const out = { ...cur };
  if ('name' in b || !cur.id) { out.name = clip(b.name, 120); if (!out.name) return { error: 'Give the product a name' }; }
  if ('description' in b) out.description = clip(b.description, 2000);
  if ('note' in b) out.note = clip(b.note, 4000);
  if ('cover' in b) out.cover = imgUrl(b.cover);
  if ('accessDays' in b) out.accessDays = intIn(b.accessDays, 0, 3650);
  // a certificate when the course is finished (every lesson done, every quiz passed)
  if ('certificate' in b) out.certificate = b.certificate && b.certificate.enabled ? { enabled: true, title: clip(b.certificate.title, 120), signer: clip(b.certificate.signer, 80), signerRole: clip(b.certificate.signerRole, 80) } : { enabled: false };
  if ('downloadLimit' in b) out.downloadLimit = intIn(b.downloadLimit, 0, 1000);
  // physical goods: country of origin, shown at checkout (empty = the seller's default in Settings, else India)
  if ('origin' in b) out.origin = clip(b.origin, 60);
  // GST on its invoice lines: HSN (goods) / SAC (services) and rate; empty = the seller's invoice defaults
  if ('hsn' in b) { const c = cleanHsn(clip(b.hsn, 12)); if (c === null) return { error: 'The HSN / SAC code is 4–8 digits (SAC for services is 6, like 999293)' }; out.hsn = c; }
  if ('gstRate' in b) {
    if (b.gstRate === '' || b.gstRate == null) delete out.gstRate;
    else { const r = Number(b.gstRate); if (!GST_RATES.includes(r)) return { error: `GST rate must be one of ${GST_RATES.join(', ')}%` }; out.gstRate = r; }
  }
  if ('links' in b) {
    if (!Array.isArray(b.links)) return { error: 'Links must be a list' };
    out.links = b.links.slice(0, 50).map((l) => ({ label: clip(l?.label, 120), url: httpUrl(l?.url) })).filter((l) => l.url).map((l) => ({ ...l, label: l.label || l.url }));
  }
  const fileIds = new Set((out.files || []).map((f) => f.id));
  if ('lessons' in b) {
    if (!Array.isArray(b.lessons)) return { error: 'Lessons must be a list' };
    out.lessons = b.lessons.slice(0, 500).map((l) => ({
      id: /^[\w-]{4,20}$/.test(String(l?.id || '')) ? l.id : uid(),
      title: clip(l?.title, 160) || 'Untitled lesson',
      section: clip(l?.section, 80),
      videoUrl: httpUrl(l?.videoUrl),
      videoFileId: fileIds.has(l?.videoFileId) ? l.videoFileId : '',
      body: clip(l?.body, 20000),
      fileIds: (Array.isArray(l?.fileIds) ? l.fileIds : []).filter((x) => fileIds.has(x)).slice(0, 30),
      dripDays: intIn(l?.dripDays, 0, 3650),
      ...(cleanQuiz(l?.quiz) ? { quiz: cleanQuiz(l.quiz) } : {}),
      ...(l?.free ? { free: true } : {}), // a preview lesson anyone signed in can watch
      ...(intIn(l?.minLevel, 1, 9) > 1 ? { minLevel: intIn(l.minLevel, 1, 9) } : {}), // opens when the student reaches this community level
    }));
  }
  // a bundle: buying this also unlocks these products (the seller's own; one level — checked when granting)
  if ('includes' in b) {
    if (!Array.isArray(b.includes)) return { error: 'Included products must be a list' };
    out.includes = [...new Set(b.includes.map((x) => String(x || '')).filter((x) => /^[\w-]{4,40}$/.test(x) && x !== cur.id))].slice(0, 30);
  }
  out.links ||= []; out.lessons ||= []; out.files ||= []; out.includes ||= [];
  out.accessDays ??= 0; out.downloadLimit ??= 0;
  return out;
}
// A copy of a product in another account (snapshots, shared funnels): its files are copied on disk when they're on
// this server; lessons point at the copied files. Buyers and access are never copied.
export function copyProduct(p, toUserId, fromUserId = p.userId) {
  if (!p?.name) return null;
  const files = [], idMap = {};
  for (const f of p.files || []) {
    const src = fromUserId && filePath(fromUserId, f.id);
    const nid = uid();
    if (src && fs.existsSync(src)) {
      fs.mkdirSync(path.join(FILE_DIR, toUserId), { recursive: true });
      fs.copyFileSync(src, filePath(toUserId, nid));
      files.push({ ...f, id: nid, s3: false });
    } else if (fromUserId && f.s3) {
      copyObject(s3Key(fromUserId, f.id), s3Key(toUserId, nid)).catch((e) => console.error('storage copy failed', e.message));
      files.push({ ...f, id: nid, s3: true });
    } else continue;
    idMap[f.id] = nid;
  }
  const lessons = (p.lessons || []).map((l) => ({ ...l, id: uid(), fileIds: (l.fileIds || []).map((x) => idMap[x]).filter(Boolean), videoFileId: l.videoFileId ? idMap[l.videoFileId] || '' : '' }));
  const { id, userId, at, ...rest } = p;
  return T.products.insert({ ...rest, id: uid(), userId: toUserId, files, lessons, includes: [], at: Date.now() }); // a bundle's products live in the other account: re-pick them there
}
export const productsOf = (userId) => T.products.all({ userId }, { order: 'at', desc: true });
const ownProduct = (userId, id) => { const p = T.products.get(id); return p && p.userId === userId ? p : null; };
// files plus their protected streaming copies
const storageUsed = (userId) => q("SELECT COALESCE(SUM(COALESCE(json_extract(f.value, '$.size'), 0) + COALESCE(json_extract(f.value, '$.hls.bytes'), 0)), 0) AS n FROM products p, json_each(p.data, '$.files') f WHERE p.userId = ?").get(userId).n;
const filePath = (userId, fileId) => path.join(FILE_DIR, userId, fileId);
// where a product file lives: this server's disk, or the storage bucket (f.s3)
const s3Key = (userId, fileId) => `products/${userId}/${fileId}`;
const hasFile = (userId, f) => !!f && (fs.existsSync(filePath(userId, f.id)) || !!f.s3);
const dropFile = (userId, f) => { fs.rmSync(filePath(userId, f.id), { force: true }); if (f.s3) deleteObject(s3Key(userId, f.id)).catch((e) => console.error('storage delete failed', e.message)); if (f.hls || /^video\//.test(f.type || '')) dropHls(userId, f).catch(() => {}); };

// What the buyer sees of a product (no internals)
const kindOf = (p) => (p.includes?.length && !p.lessons?.length && !p.files?.length && !p.links?.length ? 'bundle' : p.lessons?.length ? 'course' : p.files?.length ? 'download' : p.links?.length ? 'link' : 'empty');

// Funnels that sell or give away a product (so the seller sees where it's delivered from)
export function productUsage(userId, productId) {
  const out = [];
  for (const f of T.funnels.all({ userId })) {
    for (const s of f.steps) for (const b of [...s.blocks, ...(s.ab?.blocks || [])]) {
      const p = b.props || {};
      const hits = [];
      if (p.productId === productId) hits.push(b.type === 'checkout' ? 'main product' : b.type === 'offer' ? s.type : b.type === 'optin' || b.type === 'form' ? 'free with sign-up' : b.type);
      if (b.type === 'checkout' && p.bumpProductId === productId) hits.push('order bump');
      if (b.type === 'crosssell') (p.items || []).forEach((it) => { if (it.productId === productId) hits.push(`cross-sell: ${it.name}`); });
      for (const h of hits) out.push({ funnelId: f.id, funnel: f.name, step: s.name, as: h });
    }
  }
  return out;
}

// ---------- access ----------
const active = (a, now = Date.now()) => !a.revoked && (!a.expiresAt || a.expiresAt > now);
// One grant per product per order item (or sign-up). Repeating the same grant is a no-op.
export function grant(userId, { email, name = '', phone = '', productId, orderId = null, leadId = null, item = null, via = 'purchase', funnelId = null, theme = null }) {
  const p = ownProduct(userId, productId);
  const ckey = contactKey(email);
  if (!p || !ckey || ckey.startsWith('phone:')) return null;
  return tx(() => {
    const at = Date.now(), expiresAt = p.accessDays ? at + p.accessDays * DAY : null;
    const one = (pid, bundle) => {
      const dupe = (orderId || leadId) && T.access.all({ userId, ckey }).find((a) => a.productId === pid && a.orderId === orderId && (a.leadId || null) === leadId && (a.item ?? null) === item);
      if (dupe) return dupe;
      return T.access.insert({
        id: uid(), userId, productId: pid, email: String(email).trim().toLowerCase(), name: clip(name, 120), phone: clip(phone, 40), orderId, leadId, item, via, funnelId,
        theme: theme ? { primary: theme.primary, style: theme.style } : null, at, expiresAt, revoked: false, dl: {}, progress: {}, ...(bundle ? { bundle } : {}),
      });
    };
    const main = one(productId, null);
    // a bundle unlocks each included product too, for as long as the bundle (a refund of the order revokes them all)
    for (const id of p.includes || []) {
      const inc = id !== productId && ownProduct(userId, id);
      if (inc && !inc.includes?.length) one(inc.id, productId);
    }
    return main;
  });
}
export function revoke(userId, where, reason = 'refunded') {
  let n = 0;
  for (const a of T.access.all({ userId, ...where })) if (!a.revoked) { a.revoked = true; a.revokedAt = Date.now(); a.revokeReason = reason; T.access.put(a); n++; }
  return n;
}

// The buyer's library token (one per buyer per seller), stored encrypted so the same link can be re-sent
export function libraryToken(userId, email) {
  const ckey = contactKey(email);
  if (!ckey) return null;
  return tx(() => {
    const p = T.portals.find({ userId, ckey });
    const known = p && decrypt(p.tokenEnc);
    if (known) return known;
    if (p) T.portals.del(p.id); // unreadable (the encryption key changed): issue a new link
    const token = `L${randomToken().slice(0, 40)}`;
    T.portals.insert({ id: uid(), userId, ckey, tokenHash: hashToken(token), tokenEnc: encrypt(token), at: Date.now() });
    return token;
  });
}
export function resetLibraryToken(userId, email) {
  const ckey = contactKey(email);
  T.portals.delWhere({ userId, ckey });
  return libraryToken(userId, email);
}
export const libraryUrl = (base, token) => `${base}/access/${token}`;
// Receipt links: what one order or sign-up delivered
export const receiptToken = (kind, id) => `${kind}.${id}.${sig(`${kind}.${id}`)}`;

// After a verified sale or sign-up: grant every attached product, email the buyer, return the receipt link
export function deliver({ f, owner, email, name, phone, grants, orderId = null, leadId = null, base, invoiceUrl = null, notify = true }) {
  const made = grants.map((g) => grant(f.userId, { email, name, phone, productId: g.productId, item: g.item ?? null, orderId, leadId, via: leadId ? 'signup' : 'purchase', funnelId: f.id, theme: f.theme })).filter(Boolean);
  if (!made.length) return null;
  const linkBaseUrl = linkBase(f.id, base);
  const receipt = `${linkBaseUrl}/access/${receiptToken(orderId ? 'o' : 'l', orderId || leadId)}`;
  // email the full library link (only the inbox owner gets that one)
  const names = [...new Set(made.map((a) => T.products.get(a.productId)?.name).filter(Boolean))];
  const token = libraryToken(f.userId, email);
  const lib = libraryUrl(linkBaseUrl, token);
  const biz = owner?.settings?.businessName || f.name;
  const first = String(name || '').split(/\s+/)[0] || 'there';
  const text = `Hi ${first},\n\nThank you for your ${leadId ? 'sign-up' : 'purchase'}! Here’s your access to ${names.join(', ')}:\n\n${lib}\n\nThis link is your personal library — bookmark it. Everything you get from ${biz} will appear there.${invoiceUrl ? `\n\nYour invoice: ${invoiceUrl}` : ''}${owner?.settings?.supportWhatsapp ? `\n\nNeed help? WhatsApp us: ${owner.settings.supportWhatsapp}` : ''}\n\n— ${biz}`;
  if (!notify) return { receipt, library: lib, products: names };
  waEvent(owner, 'access_link', { to: phone, params: [first, names.join(', ').slice(0, 200)], link: lib, entityId: orderId || leadId, ckey: contactKey(email) });
  sendEmail(owner, { to: email, subject: `Your access: ${names.join(', ').slice(0, 120)}`, text })
    .then((r) => { for (const a of made) T.access.update(a.id, (x) => { x.emailed = r.status; x.emailedAt = Date.now(); }); })
    .catch((e) => { for (const a of made) T.access.update(a.id, (x) => { x.emailed = 'failed'; x.emailError = String(e.message).slice(0, 200); }); });
  return { receipt, library: lib, products: names };
}

// ---------- the buyer's library ----------
export function resolveToken(token) {
  const t = String(token || '');
  const m = /^([ol])\.([\w-]{4,64})\.([\w-]{32})$/.exec(t);
  if (m) {
    if (!same(sig(`${m[1]}.${m[2]}`), m[3])) return null;
    const list = m[1] === 'o' ? T.access.all({ orderId: m[2] }) : T.access.all({ leadId: m[2] });
    if (!list.length) return null;
    return { scope: 'receipt', userId: list[0].userId, email: list[0].email, rows: list };
  }
  if (!/^L[0-9a-f]{40}$/.test(t)) return null;
  const p = T.portals.find({ tokenHash: hashToken(t) });
  if (!p) return null;
  return { scope: 'library', portal: p, userId: p.userId, email: null, rows: T.access.all({ userId: p.userId, ckey: p.ckey }, { order: 'at', desc: true }) };
}
const signedFile = (aid, fid, inline) => {
  const e = Date.now() + DL_TTL;
  return `/api/access/dl/${aid}/${fid}?e=${e}&s=${sig(`${aid}.${fid}.${e}`)}${inline ? '&inline=1' : ''}`;
};
function libraryView(ctx) {
  const now = Date.now();
  const owner = T.users.get(ctx.userId);
  const byProduct = new Map();
  for (const a of ctx.rows) {
    const cur = byProduct.get(a.productId);
    // the best grant wins: active over ended, the longest-lasting over the shorter
    const better = !cur || (active(a, now) && !active(cur, now)) || (active(a, now) === active(cur, now) && (a.expiresAt || Infinity) > (cur.expiresAt || Infinity));
    if (better) byProduct.set(a.productId, { ...a, progress: { ...(cur?.progress || {}), ...(a.progress || {}) } });
    else cur.progress = { ...(a.progress || {}), ...cur.progress };
  }
  const products = [];
  for (const a of byProduct.values()) {
    const p = T.products.get(a.productId);
    if (!p) continue;
    if (kindOf(p) === 'bundle') continue; // just a wrapper: its products are listed on their own
    const ok = active(a, now);
    const base = { productId: p.id, accessId: a.id, name: p.name, description: p.description || '', cover: p.cover || '', kind: kindOf(p), grantedAt: a.at, expiresAt: a.expiresAt || null, status: ok ? 'active' : a.revoked ? (a.revokeReason === 'refunded' ? 'refunded' : 'revoked') : 'expired' };
    if (!ok) { products.push(base); continue; }
    const left = (fid) => (p.downloadLimit ? Math.max(0, p.downloadLimit - (a.dl?.[fid] || 0)) : null);
    const file = (f) => ({ id: f.id, name: f.name, size: f.size, type: f.type, left: left(f.id), url: left(f.id) === 0 ? null : signedFile(a.id, f.id), view: INLINE.test(f.type) && left(f.id) !== 0 ? signedFile(a.id, f.id, true) : null });
    const inLessons = new Set(p.lessons.flatMap((l) => [...l.fileIds, l.videoFileId].filter(Boolean)));
    products.push({
      ...base, note: p.note || '', downloadLimit: p.downloadLimit || 0,
      files: p.files.filter((f) => !inLessons.has(f.id)).map(file),
      links: p.links,
      lessons: p.lessons.map((l) => {
        const opensAt = a.at + l.dripDays * DAY;
        if (opensAt > now) return { id: l.id, title: l.title, section: l.section, locked: true, opensAt };
        const vf = l.videoFileId && p.files.find((f) => f.id === l.videoFileId);
        return { id: l.id, title: l.title, section: l.section, body: l.body, videoUrl: l.videoUrl, ...(l.quiz ? { quiz: { pass: l.quiz.pass, questions: l.quiz.questions.map((x) => ({ q: x.q, options: x.options })) }, quizResult: a.quiz?.[l.id] || null } : {}), video: vf && vf.hls?.status !== 'ready' ? signedFile(a.id, vf.id, true) : null, ...(vf?.hls?.status === 'ready' ? { hls: { fileId: vf.id } } : {}), files: l.fileIds.map((id) => p.files.find((f) => f.id === id)).filter(Boolean).map(file), done: !!a.progress?.[l.id] };
      }),
    });
  }
  const theme = ctx.rows.find((a) => a.theme)?.theme || null;
  return {
    scope: ctx.scope, email: ctx.rows[0]?.email || '', name: ctx.rows.find((a) => a.name)?.name || '',
    seller: { id: ctx.userId, name: owner?.settings?.businessName || owner?.name || '', whatsapp: owner?.settings?.supportWhatsapp || '', email: owner?.channels?.email?.replyTo || '', school: owner?.bookingHandle ? `/learn/${owner.bookingHandle}` : null },
    theme, products, plans: buyerPlans(ctx.userId, ctx.rows[0]?.email),
  };
}

// ---------- routes ----------
export function registerProducts(app, { auth, wrap, rateLimit, isTest, secret, appUrl }) {
  SECRET = secret;
  const libLimiter = rateLimit({ windowMs: 60000, max: isTest ? 5000 : 60 });
  const recoverLimiter = rateLimit({ windowMs: 15 * 60000, max: isTest ? 1000 : 5, message: 'Please wait a few minutes and try again.', shared: true, name: 'recover' });
  const uploadLimiter = rateLimit({ windowMs: 60000, max: isTest ? 500 : 20, key: (req) => req.user.id });

  // --- seller: products ---
  app.get('/api/products', auth, (req, res) => {
    const counts = Object.fromEntries(q('SELECT productId, COUNT(*) AS n FROM access WHERE userId = ? AND revoked = 0 GROUP BY productId').all(req.user.id).map((r) => [r.productId, r.n]));
    res.json({
      products: productsOf(req.user.id).map((p) => ({ id: p.id, name: p.name, description: p.description, cover: p.cover, kind: kindOf(p), files: p.files.length, lessons: p.lessons.length, links: p.links.length, bytes: p.files.reduce((s, f) => s + (f.size || 0), 0), buyers: counts[p.id] || 0, at: p.at, updatedAt: p.updatedAt })),
      storage: { used: storageUsed(req.user.id), max: STORAGE_MAX, fileMax: FILE_MAX },
      email: emailStatus(req.user),
      payments: !!(req.user.channels?.razorpay?.keyId || stripeCreds(req.user)), // Razorpay or Stripe
      recoverUrl: `${process.env.APP_URL || appUrl(req)}/access?s=${req.user.id}`,
    });
  });
  app.post('/api/products', auth, (req, res) => {
    if (T.products.count({ userId: req.user.id }) >= 500) return res.status(400).json({ error: 'You can have up to 500 products' });
    const p = cleanProduct(req.body, {});
    if (p.error) return res.status(400).json(p);
    res.json(T.products.insert({ ...p, id: uid(), userId: req.user.id, at: Date.now(), updatedAt: Date.now() }));
  });
  app.get('/api/products/:pid', auth, (req, res) => {
    const p = ownProduct(req.user.id, req.params.pid);
    if (!p) return res.status(404).json({ error: 'Product not found' });
    res.json({ ...p, usage: productUsage(req.user.id, p.id) });
  });
  app.put('/api/products/:pid', auth, (req, res) => {
    const cur = ownProduct(req.user.id, req.params.pid);
    if (!cur) return res.status(404).json({ error: 'Product not found' });
    const p = cleanProduct(req.body, cur);
    if (p.error) return res.status(400).json(p);
    if (p.includes?.length) {
      // bundles hold the seller's own products, one level deep (no bundle inside a bundle)
      if (p.includes.some((id) => { const x = ownProduct(req.user.id, id); return !x || x.includes?.length; })) return res.status(400).json({ error: 'A bundle can include your own products — not other bundles' });
      if (T.products.all({ userId: req.user.id }).some((x) => x.id !== cur.id && x.includes?.includes(cur.id))) return res.status(400).json({ error: 'This product is already inside a bundle, so it can’t be a bundle itself' });
    }
    p.updatedAt = Date.now();
    res.json(T.products.put(p));
  });
  app.delete('/api/products/:pid', auth, (req, res) => {
    const p = ownProduct(req.user.id, req.params.pid);
    if (!p) return res.status(404).json({ error: 'Product not found' });
    const buyers = T.access.count({ productId: p.id, revoked: 0 });
    if (buyers && req.query.confirm !== '1') return res.status(409).json({ error: `${buyers} buyer${buyers > 1 ? 's' : ''} still ha${buyers > 1 ? 've' : 's'} access to this product. Deleting it removes their access.`, buyers });
    tx(() => { revoke(req.user.id, { productId: p.id }, 'product deleted'); T.products.del(p.id); });
    for (const f of p.files) dropFile(req.user.id, f);
    res.json({ ok: true });
  });

  // Files arrive as the raw request body (any size up to FILE_MAX) and are streamed straight to disk
  app.post('/api/products/:pid/files', auth, uploadLimiter, wrap(async (req, res) => {
    const p = ownProduct(req.user.id, req.params.pid);
    if (!p) return res.status(404).json({ error: 'Product not found' });
    if (p.files.length >= 200) return res.status(400).json({ error: 'A product can have up to 200 files' });
    const name = clip(decodeURIComponent(String(req.headers['x-file-name'] || 'file')), 200).replace(/[\\/\0<>:"|?*]+/g, '_') || 'file';
    const type = /^[\w.+-]+\/[\w.+-]+$/.test(String(req.headers['x-file-type'] || '')) ? String(req.headers['x-file-type']).toLowerCase() : 'application/octet-stream';
    const declared = Number(req.headers['content-length'] || 0);
    const used = storageUsed(req.user.id);
    if (declared > FILE_MAX) return res.status(413).json({ error: `Files can be up to ${Math.round(FILE_MAX / MB)} MB` });
    if (used + declared > STORAGE_MAX) return res.status(413).json({ error: `Not enough storage left (${Math.round((STORAGE_MAX - used) / MB)} MB free) — remove old files first` });
    const id = `${Date.now().toString(36)}${crypto.randomBytes(6).toString('hex')}`;
    fs.mkdirSync(path.join(FILE_DIR, req.user.id), { recursive: true });
    const dest = filePath(req.user.id, id), tmp = `${dest}.part`;
    let size = 0, tooBig = false;
    await new Promise((resolve, reject) => {
      const out = fs.createWriteStream(tmp);
      req.on('data', (chunk) => {
        size += chunk.length;
        if (size > FILE_MAX || used + size > STORAGE_MAX) { tooBig = true; req.unpipe(out); out.destroy(); req.resume(); resolve(); }
      });
      req.on('error', reject);
      req.on('aborted', () => reject(new Error('Upload cancelled')));
      req.on('close', () => { if (!req.complete && !tooBig) reject(new Error('Upload cancelled')); });
      out.on('error', reject);
      out.on('finish', resolve);
      req.pipe(out);
    }).catch((e) => { fs.rmSync(tmp, { force: true }); throw e; });
    if (tooBig) { fs.rmSync(tmp, { force: true }); return res.status(413).json({ error: `Files can be up to ${Math.round(FILE_MAX / MB)} MB, within your ${Math.round(STORAGE_MAX / 1024 / MB)} GB of storage` }); }
    if (!size) { fs.rmSync(tmp, { force: true }); return res.status(400).json({ error: 'That file is empty' }); }
    fs.renameSync(tmp, dest);
    const file = { id, name, type, size, at: Date.now() };
    // with a storage bucket the file moves there (any server can then hand it out)
    if (s3Enabled()) {
      try { await putFile(s3Key(req.user.id, id), dest, type); file.s3 = true; fs.rmSync(dest, { force: true }); } catch (e) { console.error('storage upload failed — kept on disk', e.message); }
    }
    const saved = T.products.update(p.id, (x) => { x.files = [...(x.files || []), file]; x.updatedAt = Date.now(); });
    if (!saved) { fs.rmSync(dest, { force: true }); return res.status(404).json({ error: 'Product not found' }); }
    // a video becomes a protected stream in the background
    const queued = queueVideo(req.user.id, p.id, file);
    res.json({ file: queued ? { ...file, hls: { status: 'queued' } } : file, product: queued ? T.products.get(p.id) : saved });
  }));
  // prepare (or retry) the protected stream of a video
  app.post('/api/products/:pid/files/:fid/stream', auth, (req, res) => {
    const p = ownProduct(req.user.id, req.params.pid);
    const f = p?.files.find((x) => x.id === req.params.fid);
    if (!f || !/^video\//.test(f.type)) return res.status(404).json({ error: 'Video not found' });
    if (!queueVideo(req.user.id, p.id, f)) return res.status(503).json({ error: 'Protected streaming isn’t available on this server yet' });
    res.json({ ok: true, product: T.products.get(p.id) });
  });
  app.delete('/api/products/:pid/files/:fid', auth, (req, res) => {
    const p = ownProduct(req.user.id, req.params.pid);
    if (!p || !p.files.some((f) => f.id === req.params.fid)) return res.status(404).json({ error: 'File not found' });
    const gone = p.files.find((f) => f.id === req.params.fid);
    const saved = T.products.update(p.id, (x) => {
      x.files = x.files.filter((f) => f.id !== req.params.fid);
      x.lessons = (x.lessons || []).map((l) => ({ ...l, fileIds: l.fileIds.filter((id) => id !== req.params.fid), videoFileId: l.videoFileId === req.params.fid ? '' : l.videoFileId }));
      x.updatedAt = Date.now();
    });
    dropFile(req.user.id, gone);
    res.json(saved);
  });
  // the seller downloads their own file
  app.get('/api/products/:pid/files/:fid', auth, (req, res) => {
    const p = ownProduct(req.user.id, req.params.pid);
    const f = p?.files.find((x) => x.id === req.params.fid);
    if (!hasFile(req.user.id, f)) return res.status(404).json({ error: 'File not found' });
    sendStored(res, req.user.id, f, false);
  });

  // --- seller: who has access ---
  const accessRow = (a) => ({ id: a.id, productId: a.productId, email: a.email, name: a.name, via: a.via, orderId: a.orderId, at: a.at, expiresAt: a.expiresAt, revoked: !!a.revoked, revokeReason: a.revokeReason || null, emailed: a.emailed || null, downloads: Object.values(a.dl || {}).reduce((s, n) => s + n, 0), lessonsDone: Object.keys(a.progress || {}).length, lastSeenAt: a.lastSeenAt || null });
  app.get('/api/products/:pid/buyers', auth, (req, res) => {
    const p = ownProduct(req.user.id, req.params.pid);
    if (!p) return res.status(404).json({ error: 'Product not found' });
    res.json(T.access.all({ productId: p.id }, { order: 'at', desc: true, limit: 2000 }).map(accessRow));
  });
  app.post('/api/products/:pid/grant', auth, (req, res) => {
    const p = ownProduct(req.user.id, req.params.pid);
    if (!p) return res.status(404).json({ error: 'Product not found' });
    const email = clip(req.body.email, 200).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Enter the buyer’s email address' });
    const a = grant(req.user.id, { email, name: req.body.name, productId: p.id, via: 'manual' });
    const base = process.env.APP_URL || appUrl(req);
    const lib = libraryUrl(base, libraryToken(req.user.id, email));
    if (req.body.notify !== false) {
      const biz = req.user.settings?.businessName || req.user.name;
      sendEmail(req.user, { to: email, subject: `You now have access to ${p.name}`, text: `Hi ${String(req.body.name || '').split(/\s+/)[0] || 'there'},\n\n${biz} has given you access to ${p.name}. Open it here:\n\n${lib}\n\nThis link is your personal library — bookmark it.\n\n— ${biz}` })
        .then((r) => T.access.update(a.id, (x) => { x.emailed = r.status; x.emailedAt = Date.now(); }))
        .catch((e) => T.access.update(a.id, (x) => { x.emailed = 'failed'; x.emailError = String(e.message).slice(0, 200); }));
    }
    res.json({ access: accessRow(a), library: lib });
  });
  const ownAccess = (req, res) => { const a = T.access.get(req.params.aid); if (!a || a.userId !== req.user.id) { res.status(404).json({ error: 'Not found' }); return null; } return a; };
  app.post('/api/access-admin/:aid/revoke', auth, (req, res) => {
    const a = ownAccess(req, res); if (!a) return;
    res.json(accessRow(T.access.update(a.id, (x) => { x.revoked = true; x.revokedAt = Date.now(); x.revokeReason = 'revoked'; })));
  });
  app.post('/api/access-admin/:aid/restore', auth, (req, res) => {
    const a = ownAccess(req, res); if (!a) return;
    const days = req.body?.days != null ? intIn(req.body.days, 0, 3650) : null;
    res.json(accessRow(T.access.update(a.id, (x) => { x.revoked = false; delete x.revokeReason; delete x.revokedAt; if (days != null) x.expiresAt = days ? Date.now() + days * DAY : null; })));
  });
  // the buyer's library link (copy it, or email it again); reset gives them a new one and the old stops working
  app.post('/api/access-admin/:aid/link', auth, wrap(async (req, res) => {
    const a = ownAccess(req, res); if (!a) return;
    const token = req.body?.reset ? resetLibraryToken(req.user.id, a.email) : libraryToken(req.user.id, a.email);
    const lib = libraryUrl(linkBase(a.funnelId, process.env.APP_URL || appUrl(req)), token);
    let emailed = null;
    if (req.body?.send) {
      const biz = req.user.settings?.businessName || req.user.name;
      try { emailed = (await sendEmail(req.user, { to: a.email, subject: `Your library at ${biz}`, text: `Hi ${a.name?.split(/\s+/)[0] || 'there'},\n\nHere’s the link to everything you have from ${biz}:\n\n${lib}\n\n— ${biz}` })).status; } catch (e) { return res.status(502).json({ error: `Couldn’t send the email: ${e.message}` }); }
    }
    res.json({ library: lib, emailed });
  }));

  // --- buyer: library ---
  app.get('/api/access/:token', libLimiter, (req, res) => {
    const ctx = resolveToken(req.params.token);
    if (!ctx) return res.status(404).json({ error: 'This link isn’t valid any more. Enter your email below and we’ll send you a fresh one.' });
    if (ctx.scope === 'library') T.portals.update(ctx.portal.id, (p) => { p.lastSeenAt = Date.now(); const ip = hashToken(req.ip).slice(0, 12); p.ips = [ip, ...(p.ips || []).filter((x) => x !== ip)].slice(0, 20); });
    res.set('Cache-Control', 'no-store').json(libraryView(ctx));
  });
  app.post('/api/access/:token/progress', libLimiter, (req, res) => {
    const ctx = resolveToken(req.params.token);
    const a = ctx && ctx.rows.find((x) => x.id === req.body?.accessId && active(x));
    const p = a && T.products.get(a.productId);
    const lesson = p?.lessons.find((l) => l.id === req.body.lessonId);
    if (!lesson) return res.status(404).json({ error: 'Lesson not found' });
    T.access.update(a.id, (x) => { x.progress ||= {}; if (req.body.done === false) delete x.progress[lesson.id]; else x.progress[lesson.id] = Date.now(); x.lastSeenAt = Date.now(); });
    res.json({ ok: true });
  });
  app.get('/api/access/dl/:aid/:fid', libLimiter, (req, res) => {
    const { aid, fid } = req.params;
    const e = Number(req.query.e);
    if (!(e > Date.now()) || !same(sig(`${aid}.${fid}.${e}`), String(req.query.s || ''))) return res.status(403).type('text').send('This download link has expired — open your library again for a fresh one.');
    const a = T.access.get(aid);
    if (!a || !active(a)) return res.status(403).type('text').send('Your access to this product has ended.');
    const p = T.products.get(a.productId);
    const f = p?.files.find((x) => x.id === fid);
    if (!hasFile(p.userId, f)) return res.status(404).type('text').send('File not found');
    // a download counts once per download, not per streamed chunk of a video
    const fresh = !req.headers.range || /^bytes=0-/.test(String(req.headers.range));
    const inline = req.query.inline === '1' && INLINE.test(f.type);
    // opening a PDF or image in the browser is a download too (it can be saved); streaming video isn't
    if (fresh && !(inline && /^(video|audio)\//.test(f.type))) {
      if (p.downloadLimit && (a.dl?.[f.id] || 0) >= p.downloadLimit) return res.status(403).type('text').send(`You’ve used all ${p.downloadLimit} downloads of this file. Contact the seller if you need it again.`);
      T.access.update(a.id, (x) => { x.dl ||= {}; x.dl[f.id] = (x.dl[f.id] || 0) + 1; x.lastSeenAt = Date.now(); });
      T.downloads.insert({ id: uid(), userId: a.userId, accessId: a.id, fileId: f.id, ip: hashToken(req.ip).slice(0, 12), at: Date.now() });
    }
    sendStored(res, p.userId, f, inline);
  });
  // Lost the link: we email it — only to the address that bought, and never say whether it did
  app.post('/api/access-recover', recoverLimiter, wrap(async (req, res) => {
    const seller = T.users.get(String(req.body?.seller || ''));
    const email = clip(req.body?.email, 200).toLowerCase();
    if (seller && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      const rows = T.access.all({ userId: seller.id, ckey: contactKey(email) });
      if (rows.length) {
        const lib = libraryUrl(linkBase(rows[0].funnelId, process.env.APP_URL || appUrl(req)), libraryToken(seller.id, email));
        const biz = seller.settings?.businessName || seller.name;
        await sendEmail(seller, { to: email, subject: `Your library at ${biz}`, text: `Hi,\n\nHere’s your link to everything you have from ${biz}:\n\n${lib}\n\nIf you didn’t ask for this, you can ignore this email.\n\n— ${biz}` }).catch((e) => console.error('library link email failed', e.message));
      }
    }
    res.json({ ok: true });
  }));
}

function sendStored(res, userId, f, inline) {
  res.set({
    'Content-Type': inline ? f.type : (f.type || 'application/octet-stream'),
    'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="${f.name.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, '')}"; filename*=UTF-8''${encodeURIComponent(f.name)}`,
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; media-src 'self'; style-src 'unsafe-inline'",
    'Cache-Control': 'private, no-store',
  });
  // in the bucket: a signed link valid for 5 minutes (enough to start a download or a video stream)
  if (!fs.existsSync(filePath(userId, f.id)) && f.s3) return res.redirect(302, presign(s3Key(userId, f.id), { expires: 300, filename: inline ? undefined : f.name }));
  res.sendFile(filePath(userId, f.id), { acceptRanges: true, headers: {} }, (err) => { if (err && !res.headersSent) res.status(err.status || 500).end(); });
}

// ---------- for the school (the members area) ----------
// everything one student has from one seller, as the library shows it, plus where they left off
export function studentLibrary(userId, ckey) {
  const rows = T.access.all({ userId, ckey }, { order: 'at', desc: true });
  const view = libraryView({ scope: 'library', userId, rows });
  for (const p of view.products) {
    const a = rows.find((x) => x.id === p.accessId);
    const prod = T.products.get(p.productId);
    p.resume = a?.resume || null;
    p.certificate = prod?.certificate?.enabled ? { title: prod.certificate.title || '' } : null;
  }
  return view;
}
export const accessActive = (a, now = Date.now()) => active(a, now);
export const productKind = (p) => kindOf(p);

export const removeProductFiles = (userId) => fs.rmSync(path.join(FILE_DIR, userId), { recursive: true, force: true });
