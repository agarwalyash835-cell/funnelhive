// Who may use the platform's admin API (admin.js, and the partner admin routes in partners.js), and the audit log.
//   - a platform admin (platform.js isAdmin: verified email), signed in as themselves — not support access, not a
//     team member, not an API key — with 2-step login on
//   - a support admin can look at everything and log in as a seller (with a reason), and only a few small changes;
//     making admins, deleting accounts, restoring backups, platform settings and partner money are the owner's
// Which address the admin API answers on (the super host) and from which networks: tiers.js.
import { T, q, uid } from './db.js';
import { isAdmin, adminLevel } from './platform.js';

// every change an admin (or an agency, for its client accounts) makes: who, to which account, what
export const audit = (req, userId, action, detail = '') => T.audit.insert({ id: uid(), actorId: req.impersonator || (req.actor || req.user).id, actor: (req.actor || req.user).email, userId, action, detail: String(detail).slice(0, 500), at: Date.now() });

// what a support admin may change (everything else that isn't a GET is for owners)
const SUPPORT_ACTIONS = new Set(['impersonate', 'extend_trial', 'sign_out']);
const SUPPORT_POSTS = [/^\/api\/admin\/hive-feedback\/[^/]+\/reviewed$/, /^\/api\/admin\/backup$/];
function supportMay(req) {
  if (req.method === 'GET' || req.method === 'HEAD') return true;
  const p = req.originalUrl.split('?')[0];
  if (req.method === 'POST' && /^\/api\/admin\/users\/[^/]+\/action$/.test(p)) return SUPPORT_ACTIONS.has(req.body?.action);
  return req.method === 'POST' && SUPPORT_POSTS.some((r) => r.test(p));
}

// null when the request may go on, otherwise { status, body } to answer with
export function adminCheck(req) {
  if (!isAdmin(req.user) || req.impersonator || req.actor || req.apiKey) return { status: 403, body: { error: 'Admins only' } };
  // the admin panel needs 2-step login on: a stolen password alone must never reach every seller's account
  if (!req.user.totpEnabled) return { status: 403, body: { error: 'Turn on two-factor authentication (Settings → Security) to use the admin panel', code: 'ADMIN_2FA_REQUIRED' } };
  if (adminLevel(req.user) !== 'owner' && !supportMay(req)) return { status: 403, body: { error: 'Support admins can’t do that — ask the platform owner', code: 'ADMIN_OWNER_ONLY' } };
  return null;
}
export const adminMiddleware = (req, res, next) => { const bad = adminCheck(req); return bad ? res.status(bad.status).json(bad.body) : next(); };

// ---------- new admins need a second admin's approval ----------
// With more than one admin on the platform, "make admin" only records a request; another owner admin approves it.
// Requests are kept in the platform table (id "adminreq.<id>") and expire after 7 days.
export const ADMIN_REQUEST_MS = 7 * 86400000;
export function allAdmins() {
  const emails = (process.env.ADMIN_EMAILS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  const rows = q(`SELECT data FROM users WHERE json_extract(data, '$.role') IN ('admin', 'support')${emails.length ? ` OR email IN (${emails.map(() => '?').join(',')})` : ''}`).all(...emails);
  return rows.map((r) => JSON.parse(r.data)).filter(isAdmin);
}
export const adminRequests = () => q("SELECT data FROM platform WHERE id LIKE 'adminreq.%'").all().map((r) => JSON.parse(r.data)).filter((r) => r.status === 'pending' && Date.now() - r.at < ADMIN_REQUEST_MS).sort((a, b) => b.at - a.at);
export function requestAdmin(req, target, level) {
  const r = { id: `adminreq.${uid()}`, userId: target.id, email: target.email, level, by: req.user.id, byEmail: req.user.email, at: Date.now(), status: 'pending' };
  T.platform.put(r);
  return r;
}
export const grantAdmin = (userId, level) => T.users.update(userId, (x) => { x.role = level === 'support' ? 'support' : 'admin'; });
