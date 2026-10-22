// Teams: a seller invites staff by email with a role. Each person keeps their own login; a member switches
// into the owner's workspace and from then on acts on the owner's data (the session carries `ws`). What
// a role may do is checked on every authenticated request (see allows), before any route runs.
//   admin     — everything except billing, the team owner's account and platform admin
//   marketer  — funnels, pages, AI, automations, broadcasts, contacts, products, webinars, bookings; reads orders
//   sales     — contacts and pipelines, orders (shipping / COD, no refunds), bookings, buyer access; reads the rest
//   viewer    — read-only, no settings or secrets
// A member can also be limited to some funnels (funnelIds, "this project only"): see scopeAllows.
import { T, q, uid } from './db.js';
import { randomToken, hashToken } from './security.js';
import { sendMail, appUrl, mailEnabled } from './mail.js';
import { brand } from './platform.js';

export const ROLE_NAMES = { agency: 'Agency' };
export const ROLES = {
  admin: 'Admin — everything except billing',
  marketer: 'Marketer — funnels, AI, automations, broadcasts, contacts, products',
  sales: 'Sales & support — contacts, orders, shipping, bookings',
  viewer: 'Viewer — read-only reports',
};
// API keys and MCP tokens a team member created for the owner's account stop working when they leave the team
const revokeKeysBy = (ownerId, userId) => { for (const t of ['apikeys', 'mcptokens']) q(`DELETE FROM ${t} WHERE userId = ? AND json_extract(data, '$.by') = ?`).run(ownerId, userId); };
const TEAM_MAX = Number(process.env.TEAM_MAX || 25);
const INVITE_DAYS = 7;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// never for a member, whatever the role: the owner's billing, account, personal security, platform admin
const OWNER_ONLY = /^\/api\/(billing|account|admin|auth\/|team\/(members|invite))/;
// always fine: who am I, my workspaces, switching, leaving, the notification bell
const ANY = /^\/api\/(me$|team\/(workspaces|switch|leave|accept)$|hive\/status$|notifications(\/read)?$)/;
// secrets and account-wide settings: admins only (GET /api/channels itself only says what's connected)
const SECRET = /^\/api\/(settings|webhooks|keys|adspend\/meta|v1\/hooks|hive\/tokens|channels\/|domains|demo|conversions\/[^/]+\/retry)/;
const WRITE = {
  marketer: /^\/api\/(funnels|templates|saved|uploads|ai\/|hive\/(chat|threads)|coupons|automations|broadcasts|contacts|pipelines|crm\/|products|calendars|webinars|bookings|school)/,
  sales: /^\/api\/(contacts|pipelines|quotes|orders\/[^/]+\/(fulfil|cod)$|bookings|access-admin|products\/[^/]+\/grant$|school\/(questions|posts|comments|students))/,
  viewer: null,
};
// reading anything AI-driven goes through the AI routes, which act as the owner: not for sales / viewers
const NO_READ = { sales: /^\/api\/(hive\/threads|ai\/)/, viewer: /^\/api\/(hive\/threads|ai\/|contacts\/[^/]+$)/ };

export function allows(role, method, path) {
  if (ANY.test(path)) return true;
  // an agency managing its client's account: everything but platform admin, the account itself and billing
  if (role === 'agency') return !/^\/api\/(admin|auth\/|account|billing)/.test(path);
  if (OWNER_ONLY.test(path)) return path === '/api/team/members' && method === 'GET' && role === 'admin';
  if (role === 'admin') return true;
  // the approved WhatsApp templates (names and wording only), for those who build automations and broadcasts
  if (path === '/api/channels/whatsapp/hive/templates/approved') return method === 'GET' && role === 'marketer';
  if (SECRET.test(path)) return false;
  if (method === 'DELETE' && /^\/api\/contacts\/[^/]+$/.test(path)) return false; // erasing a contact: owners and admins
  if (/^\/api\/privacy/.test(path) && method !== 'GET') return false;
  if (method === 'GET') return !NO_READ[role]?.test(path);
  return !!WRITE[role]?.test(path);
}

// A member limited to some funnels (m.funnelIds) works on just those: their pages, revisions, analytics (with
// that funnel's own leads and orders), tracking, legal details and domains, plus what building them needs —
// images, saved sections, templates to look at, the product and calendar lists for checkout and booking
// blocks. Everything account-wide is closed to them: contacts, the Orders page, CRM, broadcasts,
// automations, products and settings, Hive AI (it acts on the whole account), API keys, and making new
// funnels (they couldn't open them). The dashboard's overview only counts their funnels. Their role still
// applies on top (a viewer limited to one funnel only reads it).
export const funnelScope = (m) => (Array.isArray(m?.funnelIds) && m.funnelIds.length ? new Set(m.funnelIds) : null);
const SCOPED_READ = /^\/api\/(funnels|saved|templates(\/[^/]+)?|products|calendars|ai\/agents|analytics\/overview|domains)$/;
const SCOPED_WRITE = /^\/api\/(uploads|saved(\/[^/]+)?|ai\/image)$/;
export function scopeAllows(scope, method, path, body) {
  if (ANY.test(path)) return true;
  const f = path.match(/^\/api\/funnels\/([^/]+)(\/.*)?$/);
  if (f) return scope.has(f[1]) && !/^\/(duplicate|copy-to)$/.test(f[2] || ''); // a copy would be a funnel outside their list
  if (/^\/api\/ai\/(edit|chat|agent)$/.test(path)) return scope.has(body?.funnelId);
  const d = path.match(/^\/api\/domains\/([^/]+)(\/verify)?$/);
  if (d) { const dom = T.domains.get(d[1]); return !!dom && scope.has(dom.funnelId) && (method !== 'PUT' || scope.has(body?.funnelId)); }
  if (path === '/api/domains' && method === 'POST') return scope.has(body?.funnelId);
  return method === 'GET' ? SCOPED_READ.test(path) : SCOPED_WRITE.test(path);
}
// funnelIds from the owner's team screen or Hive AI: their own funnels only; empty / null = every funnel
function cleanFunnelIds(ownerId, v) {
  if (v == null || (Array.isArray(v) && !v.length)) return { ids: null };
  if (!Array.isArray(v) || v.length > 200 || v.some((x) => typeof x !== 'string')) return { error: 'funnelIds must be a list of funnel ids' };
  const ids = [...new Set(v)];
  if (ids.some((id) => T.funnels.get(id)?.userId !== ownerId)) return { error: 'Pick funnels from this account' };
  return { ids };
}

// The auth middleware's workspace step: returns the owner to act as, or an error
export function enterWorkspace(actor, ownerId) {
  const m = T.members.find({ ownerId, userId: actor.id, status: 'active' });
  const owner = m && T.users.get(ownerId);
  return owner ? { owner, member: m } : null;
}

const view = (m) => ({ id: m.id, email: m.email, name: m.userId ? T.users.get(m.userId)?.name || '' : '', role: m.role, funnelIds: m.funnelIds || null, status: m.status, at: m.at, acceptedAt: m.acceptedAt || null, lastSeenAt: m.lastSeenAt || null, invitedBy: m.invitedBy || null });
const bizName = (u) => u.settings?.businessName || u.name || u.email;

export function registerTeam(app, { auth, sign, rateLimit, isTest }) {
  const inviteLimiter = rateLimit({ windowMs: 3600000, max: isTest ? 1000 : 30, key: (req) => req.user.id, message: 'Too many invites — please try again later.' });
  const sendInvite = async (req, owner, m, token) => {
    const who = req.actor?.name || owner.name;
    await sendMail({ to: m.email, subject: `${who} invited you to ${bizName(owner)} on ${brand()}`, text: `Hi,\n\n${who} has invited you to join ${bizName(owner)} on ${brand()} as ${ROLES[m.role].split(' — ')[0]}.\n\nAccept the invitation (valid for ${INVITE_DAYS} days):\n${appUrl(req)}/team/accept?token=${token}\n\nIf you don’t have an account yet, you’ll create one with this email address first.` }).catch((e) => console.error('team invite email failed', e.message));
  };

  // the owner's team (owners and admins)
  app.get('/api/team/members', auth, (req, res) => {
    res.json({ owner: { name: req.user.name, email: req.user.email }, members: T.members.all({ ownerId: req.user.id }, { order: 'at' }).map(view), roles: ROLES, max: TEAM_MAX, canManage: !req.actor || req.role === 'agency' });
  });
  app.post('/api/team/invite', auth, inviteLimiter, async (req, res) => {
    const email = String(req.body?.email || '').trim().toLowerCase().slice(0, 200);
    const role = req.body?.role;
    if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'Enter a valid email address' });
    if (!ROLES[role]) return res.status(400).json({ error: 'Pick a role' });
    const scope = cleanFunnelIds(req.user.id, req.body?.funnelIds);
    if (scope.error) return res.status(400).json({ error: scope.error });
    if (email === req.user.email) return res.status(400).json({ error: 'That’s you — you already own this workspace' });
    if (T.members.count({ ownerId: req.user.id }) >= TEAM_MAX) return res.status(400).json({ error: `Your team can have up to ${TEAM_MAX} people` });
    if (T.members.exists({ ownerId: req.user.id, email })) return res.status(409).json({ error: 'They’re already on your team (or invited)' });
    const token = `${uid()}.${randomToken()}`;
    let m;
    try { m = T.members.insert({ id: token.split('.')[0], ownerId: req.user.id, email, role, status: 'invited', userId: null, ...(scope.ids ? { funnelIds: scope.ids } : {}), inviteHash: hashToken(token), inviteExp: Date.now() + INVITE_DAYS * 86400000, at: Date.now() }); } catch { return res.status(409).json({ error: 'They’re already on your team (or invited)' }); }
    await sendInvite(req, req.user, m, token);
    res.json({ ...view(m), ...(isTest ? { token } : {}), ...(mailEnabled() ? {} : { link: `${appUrl(req)}/team/accept?token=${token}` }) });
  });
  // owners change roles and which funnels someone works on, resend, remove
  const ownMember = (req, res) => { const m = T.members.get(req.params.mid); if (!m || m.ownerId !== req.user.id) { res.status(404).json({ error: 'Not on your team' }); return null; } return m; };
  app.put('/api/team/members/:mid', auth, (req, res) => {
    const m = ownMember(req, res); if (!m) return;
    const b = req.body || {};
    if (('role' in b || !('funnelIds' in b)) && !ROLES[b.role]) return res.status(400).json({ error: 'Pick a role' });
    const scope = 'funnelIds' in b ? cleanFunnelIds(req.user.id, b.funnelIds) : null;
    if (scope?.error) return res.status(400).json({ error: scope.error });
    // keys they made for the whole account would outlast a narrower access, so those stop working
    if (scope?.ids && m.userId) revokeKeysBy(m.ownerId, m.userId);
    res.json(view(T.members.update(m.id, (x) => {
      if ('role' in b) x.role = b.role;
      if (scope) { if (scope.ids) x.funnelIds = scope.ids; else delete x.funnelIds; }
    })));
  });
  app.post('/api/team/members/:mid/resend', auth, inviteLimiter, async (req, res) => {
    const m = ownMember(req, res); if (!m) return;
    if (m.status !== 'invited') return res.status(400).json({ error: 'They’ve already joined' });
    const token = `${m.id}.${randomToken()}`;
    T.members.update(m.id, (x) => { x.inviteHash = hashToken(token); x.inviteExp = Date.now() + INVITE_DAYS * 86400000; });
    await sendInvite(req, req.user, m, token);
    res.json({ ok: true, ...(isTest ? { token } : {}), ...(mailEnabled() ? {} : { link: `${appUrl(req)}/team/accept?token=${token}` }) });
  });
  app.delete('/api/team/members/:mid', auth, (req, res) => {
    const m = ownMember(req, res); if (!m) return;
    T.members.del(m.id); // their open sessions in this workspace stop working on the next request
    revokeKeysBy(m.ownerId, m.userId);
    res.json({ ok: true });
  });

  // the invitee: see the invitation, accept it with the account that has that email
  const byToken = (token) => {
    const s = String(token || '');
    const m = s.includes('.') ? T.members.get(s.split('.')[0]) : null;
    return m && m.status === 'invited' && m.inviteHash === hashToken(s) && m.inviteExp > Date.now() ? m : null;
  };
  app.get('/api/team/invitation', (req, res) => {
    const m = byToken(req.query.token);
    if (!m) return res.status(404).json({ error: 'This invitation has expired or was already used — ask for a new one' });
    const owner = T.users.get(m.ownerId);
    res.json({ email: m.email, role: m.role, roleLabel: ROLES[m.role], business: owner ? bizName(owner) : '', hasAccount: T.users.exists({ email: m.email }) });
  });
  app.post('/api/team/accept', auth, (req, res) => {
    const me = req.actor || req.user;
    const m = byToken(req.body?.token);
    if (!m) return res.status(404).json({ error: 'This invitation has expired or was already used — ask for a new one' });
    if (m.email !== me.email) return res.status(403).json({ error: `This invitation is for ${m.email} — log in with that email to accept it` });
    if (!T.users.get(m.ownerId)) return res.status(404).json({ error: 'That workspace no longer exists' });
    T.members.update(m.id, (x) => { x.status = 'active'; x.userId = me.id; x.acceptedAt = Date.now(); delete x.inviteHash; delete x.inviteExp; });
    res.json({ ok: true, token: sign(me, m.ownerId), ownerId: m.ownerId });
  });

  // everywhere this person can work, and switching between them
  app.get('/api/team/workspaces', auth, (req, res) => {
    const me = req.actor || req.user;
    const teams = T.members.all({ userId: me.id, status: 'active' }).map((m) => { const o = T.users.get(m.ownerId); return o && { ownerId: o.id, name: bizName(o), role: m.role }; }).filter(Boolean);
    res.json({ current: req.actor ? req.user.id : null, own: { name: bizName(me) }, teams });
  });
  app.post('/api/team/switch', auth, (req, res) => {
    const me = req.actor || req.user;
    const to = req.body?.ownerId || null;
    if (!to || to === me.id) return res.json({ token: sign(me), ownerId: null });
    if (!enterWorkspace(me, to)) return res.status(403).json({ error: 'You’re not on that team any more' });
    res.json({ token: sign(me, to), ownerId: to });
  });
  app.post('/api/team/leave', auth, (req, res) => {
    const me = req.actor || req.user;
    const m = T.members.find({ ownerId: req.body?.ownerId || (req.actor ? req.user.id : ''), userId: me.id });
    if (!m) return res.status(404).json({ error: 'You’re not on that team' });
    T.members.del(m.id);
    revokeKeysBy(m.ownerId, m.userId);
    res.json({ ok: true, token: sign(me) });
  });
}
