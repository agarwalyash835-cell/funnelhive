// Three tiers on three addresses, each with its own sign-in:
//   super   the platform owner's admin panel   (SUPER_HOST,  e.g. super.getaihive.in)
//   agency  agencies                           (AGENCY_HOST, e.g. agency.getaihive.in)
//   app     end users (sellers), and every other address the app answers on
// A token carries the tier it was signed in on (aud) and is only accepted on that tier's address, so a token taken
// from one address is useless on another. Tokens from before tiers existed have no aud and count as "app".
// With SUPER_HOST and AGENCY_HOST unset (local dev, tests, a fresh server) everything is "app" — today's behaviour —
// and the admin panel stays in the app.
//
// The super host answers only the admin API, sign-in and health checks. ADMIN_IP_ALLOWLIST (comma list of IPs or
// CIDRs) limits the super host, and the admin API anywhere, to those addresses; req.ip follows TRUST_PROXY.
import net from 'node:net';

const hostOf = (v) => String(v || '').trim().toLowerCase().replace(/^[a-z]+:\/\//, '').replace(/[:/].*$/, '').replace(/\.$/, '');
export const superHost = () => hostOf(process.env.SUPER_HOST);
export const agencyHost = () => hostOf(process.env.AGENCY_HOST);
// the full address of the super host (for links from the app: "Admin", "Back to admin")
export const superUrl = () => (superHost() ? `https://${superHost()}` : '');
export const tiersOn = () => !!(superHost() || agencyHost());
export const TIERS = ['super', 'agency', 'app'];

export function tierOfHost(host) {
  const h = String(host || '').toLowerCase();
  if (superHost() && h === superHost()) return 'super';
  if (agencyHost() && h === agencyHost()) return 'agency';
  return 'app';
}
export const tierOf = (req) => tierOfHost(req.hostname);
// a token's tier: one without aud (signed before tiers existed) is an app token
export const tokenTier = (p) => (TIERS.includes(p?.aud) ? p.aud : 'app');
// is this token accepted on this request's address? (always, while no tier hosts are configured)
// The server's own calls to itself (Hive's tools call the API on 127.0.0.1) carry the caller's app or agency token;
// a loopback address is only reachable from inside the server, never through Caddy. Admin tokens never work there.
const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
export const tierMatches = (p, req) => !tiersOn() || tokenTier(p) === tierOf(req) || (LOOPBACK.has(String(req.hostname || '').toLowerCase()) && tokenTier(p) !== 'super');

// admin sign-ins on the super host: 12 hours, not extended
export const ADMIN_SESSION_MS = 12 * 3600000;
export const sessionMsFor = (aud) => (aud === 'super' ? ADMIN_SESSION_MS : undefined);
export const tokenLifeFor = (aud) => (aud === 'super' ? '12h' : '14d');

// ---------- ADMIN_IP_ALLOWLIST ----------
let listSrc = null, list = null;
function allowlist() {
  const src = String(process.env.ADMIN_IP_ALLOWLIST || '').trim();
  if (src === listSrc) return list;
  listSrc = src;
  if (!src) return (list = null);
  // an entry that can't be read is skipped (and logged); an allowlist of only bad entries lets nobody in
  list = new net.BlockList();
  for (const e of src.split(',').map((s) => s.trim()).filter(Boolean)) {
    const [ip, bits] = e.split('/');
    const fam = net.isIPv4(ip) ? 'ipv4' : net.isIPv6(ip) ? 'ipv6' : null;
    const n = bits == null ? null : Number(bits);
    if (!fam || (n != null && !(Number.isInteger(n) && n >= 0 && n <= (fam === 'ipv4' ? 32 : 128)))) { console.warn(`ADMIN_IP_ALLOWLIST: ignoring "${e}" (not an IP or CIDR)`); continue; }
    if (n == null) list.addAddress(ip, fam); else list.addSubnet(ip, n, fam);
  }
  return list;
}
export const allowlistOn = () => !!allowlist();
export function ipAllowed(ip) {
  const bl = allowlist();
  if (!bl) return true;
  const s = String(ip || '').replace(/^::ffff:(?=\d+\.\d+\.\d+\.\d+$)/, '');
  const fam = net.isIPv4(s) ? 'ipv4' : net.isIPv6(s) ? 'ipv6' : null;
  return !!fam && bl.check(s, fam);
}

// ---------- what each address answers ----------
const ADMIN_API = /^\/api\/admin(\/|$)/;
// the super host: the admin API, signing in and out (and this device's sessions), who's signed in, the public site
// config the sign-in page reads, health checks
const SUPER_API = /^\/api\/(admin(\/|$)|auth\/(login|logout|refresh|sessions)(\/|$)|me$|site$|health(\/|$))/;
const STATIC_FILE = /^\/assets\/|\.(js|mjs|css|map|png|jpe?g|webp|gif|avif|svg|ico|woff2?|webmanifest)$/;

// runs before every route. spaHtml(req): the app's page for this request (null when there's no client build)
export function tierGate(spaHtml) {
  return (req, res, next) => {
    const adminApi = ADMIN_API.test(req.path);
    if (!superHost()) {
      // no super host yet: the admin API answers in the app as before, but still only from allowed addresses
      if (adminApi && !ipAllowed(req.ip)) return res.status(403).json({ error: 'The admin panel isn’t available from this network' });
      return next();
    }
    if (tierOf(req) !== 'super') return adminApi ? res.status(404).json({ error: 'Not found' }) : next();
    if (!ipAllowed(req.ip)) return req.path.startsWith('/api/') ? res.status(403).json({ error: 'The admin panel isn’t available from this network' }) : res.status(403).type('text').send('Not available from this network');
    if (req.path === '/api' || req.path.startsWith('/api/')) {
      if (!SUPER_API.test(req.path) || (req.path === '/api/me' && req.method !== 'GET')) return res.status(404).json({ error: 'Not found' });
      // API keys are for the app, never the admin panel
      if (/fh_live_/.test(String(req.headers.authorization || req.headers['x-api-key'] || ''))) return res.status(401).json({ error: 'API keys can’t be used here' });
      return next();
    }
    if (STATIC_FILE.test(req.path)) return next();
    // every other address on the super host is the admin app's page (never a funnel, store or upload)
    const html = spaHtml(req);
    return html ? res.set('Cache-Control', 'no-cache').type('html').send(html) : res.status(404).type('text').send('Not found');
  };
}

// <meta> tags the app page carries so the browser knows which address it's on (no inline script: the CSP forbids it)
export function tierMeta(req) {
  const esc = (s) => String(s).replace(/[&"<>]/g, (c) => ({ '&': '&amp;', '"': '&quot;', '<': '&lt;', '>': '&gt;' })[c]);
  const appUrl = String(process.env.APP_URL || '').replace(/\/+$/, '');
  return `<meta name="ff-tier" content="${tierOf(req)}" data-super="${esc(superUrl())}" data-app="${esc(appUrl)}">`;
}
