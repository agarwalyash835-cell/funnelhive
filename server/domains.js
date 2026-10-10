// Custom domains: a seller points offer.theirbrand.in at this server and it shows one of their funnels.
// Ownership is proven with a TXT record; routing with a CNAME (or A record) to this server.
// HTTPS: run behind Caddy with on-demand TLS — Caddy asks /api/domains/tls-check before issuing a certificate.
import dns from 'node:dns/promises';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { brandForHost } from './agency.js';
import { T, uid, JOBS } from './db.js';

const HOST_RE = /^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const hostOf = (u) => { try { return new URL(u).hostname.toLowerCase(); } catch { return ''; } };
export const cnameTarget = () => (process.env.CNAME_TARGET || hostOf(process.env.APP_URL || '')).toLowerCase().replace(/\.$/, '');
const serverIp = () => (process.env.SERVER_IP || '').trim();
const appHosts = () => new Set(['localhost', '127.0.0.1', '::1', hostOf(process.env.APP_URL || ''), hostOf(process.env.PAGES_URL || ''), cnameTarget(), ...(process.env.APP_HOSTS || '').split(',')].map((s) => s.trim().toLowerCase()).filter(Boolean));
const fakeDns = () => process.env.DOMAINS_FAKE_DNS === '1'; // tests only
// tests only: a file listing domains whose DNS "stops working"
const fakeDown = (domain) => { try { return fs.readFileSync(process.env.DOMAINS_FAKE_DOWN, 'utf8').split(/\s+/).includes(domain); } catch { return false; } };
// Two-part public suffixes: brand.co.in is a whole (apex) domain, like brand.in — it can't take a CNAME
const MULTI_SUFFIXES = new Set(['co.in', 'org.in', 'net.in', 'firm.in', 'gen.in', 'ind.in', 'ac.in', 'edu.in', 'gov.in', 'res.in', 'co.uk', 'org.uk', 'me.uk', 'ltd.uk', 'plc.uk', 'ac.uk', 'gov.uk', 'com.au', 'net.au', 'org.au', 'co.nz', 'org.nz', 'com.sg', 'edu.sg', 'com.my', 'co.za', 'com.br', 'com.ar', 'com.mx', 'co.jp', 'co.kr', 'com.cn', 'com.hk', 'com.tw', 'co.id', 'com.ph', 'com.pk', 'com.bd', 'com.np', 'com.lk', 'co.ke', 'com.ng', 'com.tr', 'com.sa', 'co.il', 'com.eg']);
export const isApex = (domain) => { const p = domain.split('.'); return p.length === (MULTI_SUFFIXES.has(p.slice(-2).join('.')) ? 3 : 2); };
// a live domain is only given up after repeated failed checks over a whole day (one DNS blip never takes a site down)
const LAPSE_FAILS = 3, LAPSE_MS = 24 * 3600000;

export const normalizeDomain = (raw) => String(raw || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/[/?#].*$/, '').replace(/:\d+$/, '').replace(/\.$/, '');
export const activeDomain = (host) => (host ? T.domains.find({ domain: host, status: 'active' }) : null);
// www.<apex> ↔ <apex>: the other spelling of a connected domain (when it isn't connected on its own) → the connected one
const wwwTwin = (host) => (!host || activeDomain(host) ? null : host.startsWith('www.') ? activeDomain(host.slice(4)) : activeDomain(`www.${host}`));
export const domainOfFunnel = (funnelId) => T.domains.find({ funnelId, status: 'active' })?.domain || null;
// Public address of a funnel (custom domain when connected), optionally of one step
// PAGES_URL (optional): live funnel pages on their own domain (e.g. https://pages.yourbrand.in), apart from the
// dashboard — buyers' pages never share cookies or reputation with the app
export const pagesBase = () => String(process.env.PAGES_URL || '').replace(/\/+$/, '');
export function funnelUrl(f, origin, stepSlug) {
  const d = domainOfFunnel(f.id);
  if (d) return `https://${d}${stepSlug ? `/${stepSlug}` : ''}`;
  return `${pagesBase() || origin}/f/${f.slug}${stepSlug ? `/${stepSlug}` : ''}`;
}
// Sitemaps list the pages worth finding in search: not checkout, upsell or thank-you steps (they only make sense
// mid-purchase), nor a step its owner marked noindex
const MID_FUNNEL = new Set(['checkout', 'upsell', 'downsell', 'thankyou']);
export const sitemapUrls = (f, base, onDomain) => (f.steps || []).filter((s) => !MID_FUNNEL.has(s.type) && !s.seo?.noindex)
  .map((s) => ({ loc: `${base}${onDomain ? '' : `/f/${f.slug}`}${s === f.steps[0] ? (onDomain ? '/' : '') : `/${s.slug}`}`, lastmod: f.updatedAt }));
const xmlEsc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]);
export const sitemapXml = (urls) => `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `<url><loc>${xmlEsc(u.loc)}</loc>${u.lastmod ? `<lastmod>${new Date(u.lastmod).toISOString().slice(0, 10)}</lastmod>` : ''}</url>\n`).join('')}</urlset>\n`;
export const robotsTxt = (base) => `User-agent: *\nAllow: /\nSitemap: ${base}/sitemap.xml\n`;
// what buyers open from a live page (libraries, invoices, bookings, webinars, shared reports) — served on the
// pages domain and on sellers' own domains alike, so the two lists can't drift apart
const BUYER = 'access|invoice|booking|meet|webinar|legal|share|report', BUYER_API = 'public|access|access-recover|booking|meet|webinar-reg|report|share';
const BUYER_PATHS = new RegExp(`^/(${BUYER})(/|$)|^/api/(${BUYER_API})(/|$)`);
// what may be served on the pages domain: funnel pages and what buyers open from them
const PAGES_PATHS = new RegExp(`^/(f|${BUYER}|uploads|assets|t|u|favicon|robots\\.txt|sitemap)(/|$|\\.)|^/api/(${BUYER_API}|health|site|stripe/webhook|razorpay/webhook)(/|$)`);
export function pagesSplit(req, res, next) {
  const pages = pagesBase(), app = String(process.env.APP_URL || '').replace(/\/+$/, '');
  if (!pages || !app) return next();
  const host = req.hostname, pagesHost = new URL(pages).hostname, appHost = new URL(app).hostname;
  if (host === pagesHost && !PAGES_PATHS.test(req.path)) return res.redirect(301, `${app}${req.originalUrl}`);
  // a live page opened on the dashboard's domain moves to the pages domain (previews stay with the editor)
  if (host === appHost && /^\/f\//.test(req.path) && req.query.preview !== '1') return res.redirect(301, `${pages}${req.originalUrl}`);
  next();
}

async function check(d) {
  const r = { txt: false, route: false };
  if (fakeDns()) { r.txt = r.route = !fakeDown(d.domain); return r; }
  try { r.txt = (await dns.resolveTxt(`_funnelhive.${d.domain}`)).some((parts) => parts.join('').trim() === `ff-verify=${d.token}`); } catch {}
  const target = cnameTarget(), ip = serverIp();
  if (!target && !ip) { r.route = true; return r; } // the server's own address isn't configured — only ownership can be checked
  try { if (target && (await dns.resolveCname(d.domain)).some((c) => c.toLowerCase().replace(/\.$/, '') === target)) r.route = true; } catch {}
  if (!r.route) {
    try {
      const a = await dns.resolve4(d.domain);
      const ours = ip ? [ip] : await dns.resolve4(target).catch(() => []);
      if (a.some((x) => ours.includes(x))) r.route = true;
    } catch {}
  }
  return r;
}
async function verify(d) {
  const r = await check(d);
  // DNS lookups take a while: apply the result to the latest copy (it may have been edited or removed)
  return T.domains.update(d.id, (x) => {
    const now = Date.now();
    x.checkedAt = now;
    if (x.status === 'active') {
      // a live domain only has to keep pointing here (sellers often delete the TXT record once it's verified)
      if (r.route) { x.error = null; x.failures = 0; x.failingSince = null; return; }
      // keep serving through a DNS blip: only after repeated failures over a whole day is it given up
      x.failures = (x.failures || 0) + 1; x.failingSince ||= now;
      x.error = `The domain stopped pointing to this server (CNAME to ${cnameTarget() || serverIp()}) — fix the DNS record to keep it live`;
      if (x.failures >= LAPSE_FAILS && now - x.failingSince >= LAPSE_MS) { x.status = 'pending'; x.lapsedAt = now; }
    } else if (r.txt && r.route) {
      x.status = 'active'; x.error = null; x.failures = 0; x.failingSince = null; x.lapsedAt = null; x.activatedAt ||= now;
      // the domain is proven to be theirs: drop anyone else's claim on it (unverified, or one that stopped pointing here)
      for (const other of T.domains.all({ domain: x.domain })) if (other.id !== x.id) T.domains.del(other.id);
    } else {
      x.status = 'pending';
      x.error = !r.txt && !r.route ? 'Neither DNS record found yet' : !r.txt ? 'TXT record not found yet' : `The domain doesn’t point to this server yet (${isApex(x.domain) ? `A record to ${serverIp() || 'this server’s IP'}` : `CNAME to ${cnameTarget() || serverIp()}`})`;
    }
  }) || d;
}

const view = (d) => { const { userId, ...x } = d; return x; };
export function registerDomains(app, { auth }) {
  const records = (d) => {
    const target = cnameTarget(), ip = serverIp();
    const txt = { type: 'TXT', name: `_funnelhive.${d.domain}`, value: `ff-verify=${d.token}`, why: 'Proves the domain is yours' };
    if (!isApex(d.domain)) return [txt, { type: 'CNAME', name: d.domain, value: target || '(your server address — ask your administrator to set APP_URL)', why: 'Sends visitors to your funnel' }];
    // a whole domain (brand.in, brand.co.in) can't take a CNAME: it needs an A record; www follows it to the same funnel
    return [txt,
      { type: 'A', name: d.domain, value: ip || '(this server’s IP address — ask your administrator to set SERVER_IP)', why: 'Sends visitors to your funnel' },
      { type: 'CNAME', name: `www.${d.domain}`, value: target || d.domain, why: `Optional: www.${d.domain} opens the same funnel`, optional: true }];
  };
  const out = (d) => ({ ...view(d), records: records(d) });
  const own = (req, res) => { const d = T.domains.get(req.params.did); if (!d || d.userId !== req.user.id) { res.status(404).json({ error: 'Domain not found' }); return null; } return d; };
  const ownFunnel = (req, id) => { const f = id && T.funnels.get(id); return f && f.userId === req.user.id ? f : null; };

  app.get('/api/domains', auth, (req, res) => res.json({ domains: T.domains.all({ userId: req.user.id }, { order: 'createdAt' }).map(out), target: cnameTarget() || null, serverIp: serverIp() || null }));
  app.post('/api/domains', auth, (req, res) => {
    const domain = normalizeDomain(req.body.domain);
    if (!HOST_RE.test(domain)) return res.status(400).json({ error: 'Enter a domain like offer.yourbrand.in' });
    if (appHosts().has(domain)) return res.status(400).json({ error: 'That’s this app’s own address' });
    if (!ownFunnel(req, req.body.funnelId)) return res.status(400).json({ error: 'Choose which funnel this domain should show' });
    // a live domain can't be claimed — unless it stopped pointing here (then whoever proves ownership with the TXT record takes it over)
    const live = T.domains.find({ domain, status: 'active' });
    if (live && !live.failures) return res.status(409).json({ error: 'This domain is already connected to an account' });
    if (T.domains.exists({ domain, userId: req.user.id })) return res.status(409).json({ error: 'You’ve already added this domain' });
    if (T.domains.count({ userId: req.user.id }) >= 20) return res.status(400).json({ error: 'You can connect up to 20 domains' });
    const d = { id: uid(), userId: req.user.id, domain, funnelId: req.body.funnelId, token: crypto.randomBytes(12).toString('hex'), status: 'pending', error: null, createdAt: Date.now() };
    T.domains.insert(d);
    res.json(out(d));
  });
  app.put('/api/domains/:did', auth, (req, res) => {
    const d = own(req, res);
    if (!d) return;
    if (!ownFunnel(req, req.body.funnelId)) return res.status(400).json({ error: 'Choose one of your funnels' });
    d.funnelId = req.body.funnelId; T.domains.put(d);
    res.json(out(d));
  });
  app.post('/api/domains/:did/verify', auth, async (req, res) => {
    const d = own(req, res);
    if (!d) return;
    res.json(out(await verify(d)));
  });
  app.delete('/api/domains/:did', auth, (req, res) => {
    const d = own(req, res);
    if (!d) return;
    T.domains.del(d.id);
    res.json({ ok: true });
  });
  // Caddy on_demand_tls "ask" endpoint: only issue certificates for connected domains
  // (the www / bare twin of a connected domain too, so its redirect works over HTTPS)
  app.get('/api/domains/tls-check', (req, res) => { const h = normalizeDomain(req.query.domain); res.status(activeDomain(h) || wwwTwin(h) || brandForHost(h) ? 200 : 404).end(); });

  // re-check pending domains in the background for 3 days after they're added (or after they lapsed),
  // and live ones once a day — every 6 hours while failing, so a lapse is confirmed or cleared within a day
  if (JOBS) setInterval(() => {
    const now = Date.now();
    for (const d of T.domains.all({ status: 'pending' })) if (Math.max(d.createdAt || 0, d.lapsedAt || 0) > now - 3 * 86400000 && now - (d.checkedAt || 0) > 5 * 60000) verify(d).catch(() => {});
    for (const d of T.domains.all({ status: 'active' })) if (now - (d.checkedAt || d.activatedAt || 0) > (d.failures ? 6 : 24) * 3600000) verify(d).catch(() => {});
  }, 60000).unref();
}

// Requests arriving on a connected domain show that funnel: "/" is its first step, "/<step>" the others.
export function domainRouter(renderFunnel) {
  return (req, res, next) => {
    const host = (req.hostname || '').toLowerCase();
    if (!host || appHosts().has(host)) return next();
    const d = activeDomain(host);
    if (!d) {
      // www.brand.in when brand.in is connected (or the other way round): send visitors to the connected spelling
      const twin = wwwTwin(host);
      return twin ? res.redirect(301, `https://${twin.domain}${req.originalUrl}`) : next();
    }
    // buyers' libraries, invoices, bookings and shared reports open on the brand's own domain too (served by the app)
    if (BUYER_PATHS.test(req.path)) return next();
    if (/^\/(api\/public\/|assets\/|uploads\/|u\/)/.test(req.path) || /\.(js|css|map|png|jpe?g|webp|gif|avif|svg|ico|woff2?)$/.test(req.path)) return next();
    if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not found' });
    const f = T.funnels.get(d.funnelId);
    if (!f || !f.published) return res.status(404).type('html').send('<!doctype html><meta charset="utf-8"><title>Not available</title><p style="font:16px system-ui;padding:40px;text-align:center">This page isn’t available right now.</p>');
    if (req.path === '/robots.txt') return res.set('Cache-Control', 'public, max-age=3600').type('text').send(robotsTxt(`https://${d.domain}`));
    if (req.path === '/sitemap.xml') return res.set('Cache-Control', 'public, max-age=3600').type('application/xml').send(sitemapXml(sitemapUrls(f, `https://${d.domain}`, true)));
    const m = /^\/([a-z0-9-]*)\/?$/i.exec(req.path);
    if (!m) { const qs = req.originalUrl.indexOf('?'); return res.redirect(302, qs < 0 ? '/' : `/${req.originalUrl.slice(qs)}`); } // keep UTM / fbclid
    return renderFunnel(req, res, f, m[1] || null, { domain: d.domain });
  };
}
