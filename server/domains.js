// Custom domains: a seller points offer.theirbrand.in at this server and it shows one of their funnels.
// Ownership is proven with a TXT record; routing with a CNAME (or A record) to this server.
// HTTPS: run behind Caddy with on-demand TLS — Caddy asks /api/domains/tls-check before issuing a certificate.
import dns from 'node:dns/promises';
import crypto from 'node:crypto';
import { T, uid, JOBS } from './db.js';

const HOST_RE = /^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const hostOf = (u) => { try { return new URL(u).hostname.toLowerCase(); } catch { return ''; } };
export const cnameTarget = () => (process.env.CNAME_TARGET || hostOf(process.env.APP_URL || '')).toLowerCase().replace(/\.$/, '');
const serverIp = () => (process.env.SERVER_IP || '').trim();
const appHosts = () => new Set(['localhost', '127.0.0.1', '::1', hostOf(process.env.APP_URL || ''), cnameTarget(), ...(process.env.APP_HOSTS || '').split(',')].map((s) => s.trim().toLowerCase()).filter(Boolean));
const fakeDns = () => process.env.DOMAINS_FAKE_DNS === '1'; // tests only

export const normalizeDomain = (raw) => String(raw || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/[/?#].*$/, '').replace(/:\d+$/, '').replace(/\.$/, '');
export const activeDomain = (host) => (host ? T.domains.find({ domain: host, status: 'active' }) : null);
export const domainOfFunnel = (funnelId) => T.domains.find({ funnelId, status: 'active' })?.domain || null;
// Public address of a funnel (custom domain when connected), optionally of one step
export function funnelUrl(f, origin, stepSlug) {
  const d = domainOfFunnel(f.id);
  if (d) return `https://${d}${stepSlug ? `/${stepSlug}` : ''}`;
  return `${origin}/f/${f.slug}${stepSlug ? `/${stepSlug}` : ''}`;
}

async function check(d) {
  const r = { txt: false, route: false };
  if (fakeDns()) { r.txt = r.route = true; return r; }
  try { r.txt = (await dns.resolveTxt(`_funnelforge.${d.domain}`)).some((parts) => parts.join('').trim() === `ff-verify=${d.token}`); } catch {}
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
    x.checkedAt = Date.now();
    if (r.txt && r.route) {
      x.status = 'active'; x.error = null; x.activatedAt ||= Date.now();
      // the domain is proven to be theirs: drop anyone else's unverified claim on it
      for (const other of T.domains.all({ domain: x.domain })) if (other.id !== x.id) T.domains.del(other.id);
    } else {
      x.status = 'pending';
      x.error = !r.txt && !r.route ? 'Neither DNS record found yet' : !r.txt ? 'TXT record not found yet' : `The domain doesn’t point to this server yet (CNAME to ${cnameTarget() || serverIp()})`;
    }
  }) || d;
}

const view = (d) => { const { userId, ...x } = d; return x; };
export function registerDomains(app, { auth }) {
  const records = (d) => {
    const target = cnameTarget(), ip = serverIp();
    const sub = d.domain.split('.').length > 2;
    return [
      { type: 'TXT', name: `_funnelforge.${d.domain}`, value: `ff-verify=${d.token}`, why: 'Proves the domain is yours' },
      sub || !ip ? { type: 'CNAME', name: d.domain, value: target || '(your server address — ask your administrator to set APP_URL)', why: 'Sends visitors to your funnel' } : { type: 'A', name: d.domain, value: ip, why: 'Sends visitors to your funnel' },
    ];
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
    if (T.domains.exists({ domain, status: 'active' })) return res.status(409).json({ error: 'This domain is already connected to an account' });
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
  app.get('/api/domains/tls-check', (req, res) => res.status(activeDomain(normalizeDomain(req.query.domain)) ? 200 : 404).end());

  // re-check pending domains in the background for 3 days after they're added
  if (JOBS) setInterval(() => {
    const now = Date.now();
    for (const d of T.domains.all({ status: 'pending', createdAt: { gt: now - 3 * 86400000 } })) if (now - (d.checkedAt || 0) > 5 * 60000) verify(d).catch(() => {});
  }, 60000).unref();
}

// Requests arriving on a connected domain show that funnel: "/" is its first step, "/<step>" the others.
export function domainRouter(renderFunnel) {
  return (req, res, next) => {
    const host = (req.hostname || '').toLowerCase();
    if (!host || appHosts().has(host)) return next();
    const d = activeDomain(host);
    if (!d) return next();
    if (/^\/(api\/public\/|assets\/|uploads\/|u\/)/.test(req.path) || /\.(js|css|map|png|jpe?g|webp|gif|avif|svg|ico|woff2?)$/.test(req.path)) return next();
    if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not found' });
    const f = T.funnels.get(d.funnelId);
    if (!f || !f.published) return res.status(404).type('html').send('<!doctype html><meta charset="utf-8"><title>Not available</title><p style="font:16px system-ui;padding:40px;text-align:center">This page isn’t available right now.</p>');
    if (req.path === '/robots.txt') return res.type('text').send('User-agent: *\nAllow: /\n');
    const m = /^\/([a-z0-9-]*)\/?$/i.exec(req.path);
    if (!m) return res.redirect(302, '/');
    return renderFunnel(req, res, f, m[1] || null, { domain: d.domain });
  };
}
