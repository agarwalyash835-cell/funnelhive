// Client links: a temporary link to a finished Reel, image, clip or design, for an agency's client (or anyone the seller
// picks) to watch it and, if allowed, download it — no account, no login.
//   - The link expires (1, 3, 7 or 30 days) and can be switched off at any time. Only a hash of its secret is kept.
//   - It shows the item as it is now (an edit after sharing shows on the same link), in the brand of the kit it was
//     made with: no platform name or logo.
//   - Files are streamed through the link itself, never handed out by their permanent address, so once the link is
//     off or expired nothing it showed can be fetched through it.
// Rows live in `studioshare`: { userId, assetId, tokenHash, at, expiresAt, download, revokedAt, views, lastViewAt, by }.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { T, dir as DATA_DIR } from '../db.js';
import { kitOf } from './brand.js';
import { emailBrand } from '../whitelabel.js';
import { publicUrl } from './media.js';

const DAY = 86400000;
export const SHARE_DAYS = [1, 3, 7, 30];
const MAX_LINKS = 20; // live links per item
const UPLOADS = path.join(DATA_DIR, 'uploads');
const hash = (t) => crypto.createHash('sha256').update(String(t)).digest('hex');
const clip = (v, n) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const slug = (s) => clip(s, 40).toLowerCase().replace(/[^\w]+/g, '-').replace(/^-+|-+$/g, '') || 'studio';
const live = (s, now = Date.now()) => !s.revokedAt && s.expiresAt > now;

const titleOf = (a) => clip(a.kind === 'reel' ? a.script?.title || a.prompt : a.kind === 'design' ? a.slides?.[0]?.text?.headline || a.slides?.[0]?.text?.heading || a.prompt : a.prompt, 80) || ({ reel: 'Reel', design: 'Design', image: 'Image', clip: 'Video' }[a.kind] || 'Studio');
const extOf = (url, d) => (/\.(\w{3,4})(?:\?|$)/.exec(String(url || ''))?.[1] || d).toLowerCase();
// what a link shows: each finished file of the item, in order
export function filesOf(a) {
  if (!a || a.status === 'failed') return [];
  const name = slug(titleOf(a));
  if (a.kind === 'reel') return Object.entries(a.outputs || {}).filter(([, u]) => u).map(([k, url]) => ({ label: k, url, type: 'video', name: `${name}-${k.replace(':', 'x')}.mp4` }));
  if (a.kind === 'design') return (a.outputs || []).filter((o) => o?.url).map((o, i, all) => ({ label: all.length > 1 ? `Slide ${i + 1}` : 'Design', url: o.url, type: 'image', width: o.width || null, height: o.height || null, name: `${name}${all.length > 1 ? `-${i + 1}` : ''}.png` }));
  if (['image', 'clip'].includes(a.kind) && a.url && ['ready', 'needs_review'].includes(a.status)) {
    const video = a.kind === 'clip', ext = extOf(a.url, video ? 'mp4' : 'png');
    return [{ label: video ? 'Video' : 'Image', url: a.url, type: video ? 'video' : 'image', name: `${name}.${ext}` }];
  }
  return [];
}
const shareView = (s) => ({ id: s.id, at: s.at, expiresAt: s.expiresAt, download: !!s.download, live: live(s), revokedAt: s.revokedAt || null, views: s.views || 0, lastViewAt: s.lastViewAt || null, by: s.by || null });

// one file to the browser: from this server's disk (with byte ranges, so a video can be scrubbed), else through to the
// bucket with the same range — the reader never learns where it's kept
async function stream(req, res, url, { name, dl }) {
  res.set('Cache-Control', 'private, max-age=300');
  res.set('X-Robots-Tag', 'noindex, nofollow');
  res.set('Content-Disposition', `${dl ? 'attachment' : 'inline'}; filename="${name.replace(/"/g, '')}"`);
  const m = /^\/uploads\/([\w-]+)\/([\w.-]+)$/.exec(String(url || ''));
  if (m) {
    const f = path.join(UPLOADS, m[1], m[2]);
    if (fs.existsSync(f)) return res.sendFile(f, { headers: { 'Content-Disposition': res.get('Content-Disposition') } });
  }
  const r = await fetch(publicUrl(url), { headers: req.headers.range ? { range: req.headers.range } : {} });
  if (!r.ok && r.status !== 206) return res.status(404).json({ error: 'This file isn’t available any more' });
  res.status(r.status);
  for (const h of ['content-type', 'content-length', 'content-range', 'accept-ranges']) if (r.headers.get(h)) res.set(h, r.headers.get(h));
  Readable.fromWeb(r.body).pipe(res);
}

export function registerShares(app, { auth, limiter, rateLimit, isTest, gate, who, wrap }) {
  const open = rateLimit({ windowMs: 60000, max: isTest ? 1000 : 120, message: 'Too many requests — wait a moment and try again.' });
  const mine = (req, res) => {
    const a = T.studio.get(req.params.id);
    if (!a || a.userId !== req.user.id || !['reel', 'design', 'image', 'clip'].includes(a.kind)) { res.status(404).json({ error: 'Not found' }); return null; }
    return a;
  };

  // the item's links, newest first
  app.get('/api/studio/assets/:id/shares', auth, (req, res) => {
    const a = mine(req, res); if (!a) return;
    res.json({ shares: T.studioshare.all({ assetId: a.id }, { order: 'at', desc: true }).filter((s) => s.userId === a.userId).map(shareView), days: SHARE_DAYS });
  });
  // a new link: { days: 1 | 3 | 7 | 30 (7), download: true | false (true) } → { share, url } — the url is shown only now
  app.post('/api/studio/assets/:id/shares', auth, limiter, (req, res) => {
    if (!gate(req, res)) return;
    const a = mine(req, res); if (!a) return;
    if (!filesOf(a).length) return res.status(409).json({ error: 'Share it once it’s finished' });
    const days = SHARE_DAYS.includes(Number(req.body?.days)) ? Number(req.body.days) : 7;
    const now = Date.now();
    if (T.studioshare.all({ assetId: a.id }).filter((s) => live(s, now)).length >= MAX_LINKS) return res.status(409).json({ error: `Up to ${MAX_LINKS} live links per item — switch an old one off first` });
    const token = crypto.randomBytes(18).toString('base64url');
    const s = T.studioshare.insert({ userId: a.userId, assetId: a.id, tokenHash: hash(token), at: now, expiresAt: now + days * DAY, download: req.body?.download !== false, views: 0, by: who(req) });
    // the agency's own app address when it has one (white-label), else this server's
    const base = emailBrand(req.user, req).linkBase || '';
    res.status(201).json({ share: shareView(s), url: `${base}/view/${token}` });
  });
  // switch a link off (for good)
  app.delete('/api/studio/shares/:sid', auth, (req, res) => {
    const s = T.studioshare.get(req.params.sid);
    if (!s || s.userId !== req.user.id) return res.status(404).json({ error: 'Not found' });
    res.json({ share: shareView(T.studioshare.update(s.id, (x) => { x.revokedAt ||= Date.now(); })) });
  });

  // ---------- the client's side: no login, the link is the key ----------
  const byToken = (req, res, { count = false } = {}) => {
    const s = /^[\w-]{20,40}$/.test(req.params.token) ? T.studioshare.find({ tokenHash: hash(req.params.token) }) : null;
    const a = s && T.studio.get(s.assetId);
    if (!s || !a || a.userId !== s.userId) { res.status(404).json({ error: 'This link doesn’t exist' }); return null; }
    if (!live(s)) { res.status(410).json({ error: s.revokedAt ? 'This link has been switched off' : 'This link has expired', expired: true }); return null; }
    if (count) T.studioshare.update(s.id, (x) => { x.views = (x.views || 0) + 1; x.lastViewAt = Date.now(); });
    return { s, a, files: filesOf(a) };
  };
  app.get('/api/view/:token', open, (req, res) => {
    const x = byToken(req, res, { count: true }); if (!x) return;
    const { s, a, files } = x, k = kitOf(a.userId, a.kitId);
    res.set('Cache-Control', 'no-store').set('X-Robots-Tag', 'noindex, nofollow');
    res.json({
      title: titleOf(a), kind: a.kind, brand: { name: k.name || '', logo: k.logo || '' }, expiresAt: s.expiresAt, download: !!s.download,
      poster: a.poster ? `/api/view/${req.params.token}/poster` : null,
      files: files.map((f, n) => ({ n, label: f.label, type: f.type, width: f.width || null, height: f.height || null, name: f.name })),
      updating: !files.length,
    });
  });
  app.get('/api/view/:token/file/:n', open, wrap(async (req, res) => {
    const x = byToken(req, res); if (!x) return;
    const f = x.files[Number(req.params.n)];
    if (!f) return res.status(404).json({ error: 'Not found' });
    const dl = req.query.dl === '1';
    if (dl && !x.s.download) return res.status(403).json({ error: 'Downloads are off for this link' });
    await stream(req, res, f.url, { name: f.name, dl });
  }));
  app.get('/api/view/:token/poster', open, wrap(async (req, res) => {
    const x = byToken(req, res); if (!x) return;
    if (!x.a.poster) return res.status(404).json({ error: 'Not found' });
    await stream(req, res, x.a.poster, { name: 'poster.jpg', dl: false });
  }));
  // the page itself is the app's; keep it out of search engines and don't pass the link on to other sites
  app.get('/view/:token', (req, res, next) => { res.set('X-Robots-Tag', 'noindex, nofollow').set('Referrer-Policy', 'no-referrer'); next(); });
}
