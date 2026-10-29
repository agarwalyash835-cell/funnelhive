// Teams: a seller invites staff by email with a role. Each person keeps their own login; a member switches
// into the owner's workspace and from then on acts on the owner's data (the session carries `ws`). What
// a role may do is checked on every authenticated request (see allows), before any route runs.
//   admin     — everything except billing, the team owner's account and platform admin
//   marketer  — funnels, pages, AI, automations, broadcasts, contacts, products, webinars, bookings; reads orders
//   sales     — contacts and pipelines, orders (shipping / COD, no refunds), bookings, buyer access; reads the rest
//   viewer    — read-only, no settings or secrets
// A member can also be limited to some funnels (funnelIds, "this project only"): see scopeAllows.
import { T, q, uid, tx } from './db.js';
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
// (partner tools and a sub-account's plan with its partner are billing too)
const OWNER_ONLY = /^\/api\/(billing|account|admin|auth\/|team\/(members|invite|roles)|partner(-billing)?(\/|$))/;
// always fine: who am I (and my own menu layout), my workspaces, switching, leaving, the notification bell
const ANY = /^\/api\/(me(\/menu)?$|team\/(workspaces|switch|leave|accept)$|hive\/status$|notifications(\/read)?$)/;
// secrets and account-wide settings: admins only (GET /api/channels itself only says what's connected)
const SECRET = /^\/api\/(vault\/secrets|settings|lead-sources|voice\/connect|webhooks|keys|adspend\/meta|v1\/hooks|hive\/tokens|channels\/|domains|demo|conversions\/[^/]+\/retry)/;
const WRITE = {
  marketer: /^\/api\/(inbox|waflows|wa-agent|vault\/(files|folders|shares)|funnels|templates|saved|uploads|ai\/|hive\/(chat|threads)|coupons|automations|broadcasts|campaign-templates|voice\/(campaigns|audience|test-call)|contacts|pipelines|crm\/|products|calendars|webinars|bookings|school)/,
  sales: /^\/api\/(inbox|vault\/(files|folders|shares)|contacts|pipelines|quotes|orders\/[^/]+\/(fulfil|cod)$|bookings|access-admin|products\/[^/]+\/grant$|school\/(questions|posts|comments|students))/,
  viewer: null,
};
// reading anything AI-driven goes through the AI routes, which act as the owner: not for sales / viewers
const NO_READ = { sales: /^\/api\/(hive\/threads|ai\/)/, viewer: /^\/api\/(hive\/threads|ai\/|contacts\/[^/]+(\/files)?$|vault|inbox)/ };

// perms: a custom role's permission per area (see AREAS below); built-in roles keep the rules above
export function allows(role, method, path, perms) {
  if (ANY.test(path)) return true;
  // an agency managing its client's account: everything but platform admin, the account itself and billing
  if (role === 'agency') return !/^\/api\/(admin|auth\/|account|billing)/.test(path);
  if (!BUILT_IN.has(role)) return !!perms && customAllows(perms, method, path);
  if (OWNER_ONLY.test(path)) return ['/api/team/members', '/api/team/roles'].includes(path) && method === 'GET' && role === 'admin';
  if (role === 'admin') return true;
  // the Tally books and Inventory: admins, or a custom role given the Tally area (the built-in presets say none)
  if (/^\/api\/(tally|inventory)(\/|$)/.test(path)) return false;
  // the approved WhatsApp templates (names and wording only), for those who build automations and broadcasts
  if (path === '/api/channels/whatsapp/hive/templates/approved') return method === 'GET' && role === 'marketer';
  if (SECRET.test(path)) return false;
  if (method === 'DELETE' && /^\/api\/contacts\/[^/]+$/.test(path)) return false; // erasing a contact: owners and admins
  if (/^\/api\/privacy/.test(path) && method !== 'GET') return false;
  if (method === 'GET') return !NO_READ[role]?.test(path);
  return !!WRITE[role]?.test(path);
}

// ---------- custom roles: a permission per area ----------
// Each area covers some API paths. A level is none | view (GET only) | edit (everything). A custom role is
// denied anything no area covers (deny by default), on top of what no member ever gets (OWNER_ONLY: billing,
// the account, sign-in, platform admin), API keys / MCP tokens (owners and admins) and erasing a contact.
export const LEVELS = ['none', 'view', 'edit'];
const ALL3 = LEVELS;
export const AREAS = [
  { key: 'dashboard', label: 'Dashboard & reports', desc: 'Overview numbers, reports, the activity log and plan usage (read-only)', levels: ['none', 'view'], re: /^\/api\/(analytics|reports|activity|usage|ads\/report)(\/|$)/ },
  { key: 'funnels', label: 'Funnels, templates & pages', desc: 'Build, edit and publish funnels and their pages, saved sections, templates', levels: ALL3, re: /^\/api\/(funnels|templates|saved)(\/|$)/ },
  { key: 'ai', label: 'Hive AI', desc: 'Chat with Hive and use the AI writing / image tools (Hive still only does what the role allows)', levels: ['none', 'edit'], re: /^\/api\/(hive\/(chat|threads)|ai)(\/|$)/ },
  { key: 'crm', label: 'CRM contacts & pipelines', desc: 'Contacts, notes, tags, deals and pipeline stages, CRM fields and kits', levels: ALL3, re: /^\/api\/(contacts|pipelines|crm)(\/|$)/ },
  { key: 'orders', label: 'Orders, refunds & shipping', desc: 'Orders, refunds, shipping / COD, payment plans and sales invoices', levels: ALL3, re: /^\/api\/(orders|sales-invoices)(\/|$)/ },
  { key: 'products', label: 'Products & courses (School)', desc: 'Products, files, buyer access, coupons, and the School: courses, community, students', levels: ALL3, re: /^\/api\/(products|coupons|access-admin|school)(\/|$)/ },
  { key: 'bookings', label: 'Bookings & calendars', desc: 'Booking pages, call types and booked calls', levels: ALL3, re: /^\/api\/(bookings|calendars)(\/|$)/ },
  { key: 'webinars', label: 'Webinars', desc: 'Webinars, sign-ups and reminders', levels: ALL3, re: /^\/api\/webinars(\/|$)/ },
  { key: 'quotes', label: 'Quotes', desc: 'Custom quotes and quote templates', levels: ALL3, re: /^\/api\/(quotes|quote-templates)(\/|$)/ },
  { key: 'automations', label: 'Automations', desc: 'Follow-up emails and WhatsApp that run by themselves', levels: ALL3, re: /^\/api\/automations(\/|$)/ },
  { key: 'inbox', label: 'WhatsApp inbox & chatbots', desc: 'Chat with customers on WhatsApp, build chatbots and set up the AI agent', levels: ALL3, re: /^\/api\/(inbox|waflows|wa-agent)(\/|$)/ },
  { key: 'broadcasts', label: 'Campaigns', desc: 'WhatsApp and email campaigns to a segment of your list, and AI calling campaigns', levels: ALL3, re: /^\/api\/(broadcasts|voice|campaign-templates)(\/|$)/, viewPost: /^\/api\/(broadcasts|voice)\/audience$/ },
  { key: 'files', label: 'Vault files', desc: 'Private files and folders, and sharing them', levels: ALL3, re: /^\/api\/vault(\/(files|folders|shares)(\/|$)|$)/ },
  { key: 'secrets', label: 'Vault passwords & notes', desc: 'Saved passwords and secure notes (view = can reveal them)', levels: ALL3, re: /^\/api\/vault\/secrets(\/|$)/, viewPost: /^\/api\/vault\/secrets\/[^/]+\/reveal$/ },
  { key: 'tally', label: 'Tally', desc: 'The Tally mirror (ledgers, vouchers, outstanding bills, stock), changes sent to TallyPrime, and the Inventory add-on', levels: ALL3, re: /^\/api\/(tally|inventory)(\/|$)/ },
  { key: 'ads', label: 'Ads & ad spend', desc: 'Ad spend (Meta sync, CSV), conversions sent to ad platforms', levels: ALL3, re: /^\/api\/(adspend|conversions|gads)(\/|$)/ },
  { key: 'settings', label: 'Settings & integrations', desc: 'Business settings, payments and channels, domains, webhooks, apps, privacy', levels: ALL3, re: /^\/api\/(settings|lead-sources|webhooks|v1\/hooks|channels|domains|demo|privacy|integrations|google)(\/|$)/ },
  { key: 'team', label: 'Team management', desc: 'Invite and remove people, edit roles (never billing or deleting the account)', levels: ALL3, re: /^\/api\/team\/(members|invite|roles)(\/|$)/ },
];
const AREA_KEYS = AREAS.map((a) => a.key);
// paths several areas need: allowed when any of the listed areas has the level
const SHARED = [
  { re: /^\/api\/uploads$/, edit: ['funnels', 'products', 'webinars', 'broadcasts', 'automations', 'quotes', 'files', 'settings'] },
  { re: /^\/api\/channels\/whatsapp\/hive\/templates\/approved$/, view: ['automations', 'broadcasts'] },
  { re: /^\/api\/channels$/, view: AREA_KEYS }, // which channels are connected (no secrets): any area that reads
];
const RANK = { none: 0, view: 1, edit: 2 };
const isRead = (method) => method === 'GET' || method === 'HEAD';
export function customAllows(perms, method, path) {
  if (OWNER_ONLY.test(path) && !/^\/api\/team\//.test(path)) return false;
  if (method === 'DELETE' && /^\/api\/contacts\/[^/]+$/.test(path)) return false; // erasing a contact: owners and admins
  const sh = SHARED.find((x) => x.re.test(path));
  if (sh) {
    if (isRead(method) && sh.view) return sh.view.some((k) => RANK[perms[k]] >= 1);
    return !!sh.edit?.some((k) => perms[k] === 'edit');
  }
  const a = AREAS.find((x) => x.re.test(path));
  if (!a) return false; // deny by default
  const lvl = perms[a.key] || 'none';
  if (lvl === 'edit') return true;
  return lvl === 'view' && (isRead(method) || (method === 'POST' && !!a.viewPost?.test(path)));
}
// the four built-in roles in the same area model, for showing what they allow (enforced by the rules above)
const P = (o) => Object.fromEntries(AREA_KEYS.map((k) => [k, o?.[k] || 'none']));
const allLevel = (lvl) => P(Object.fromEntries(AREAS.map((a) => [a.key, a.levels.includes(lvl) ? lvl : a.levels.at(-1)])));
export const PRESETS = {
  admin: { ...allLevel('edit'), team: 'view' },
  marketer: P({ inbox: 'edit', dashboard: 'view', funnels: 'edit', ai: 'edit', crm: 'edit', orders: 'view', products: 'edit', bookings: 'edit', webinars: 'edit', quotes: 'view', automations: 'edit', broadcasts: 'edit', files: 'edit', ads: 'view' }),
  sales: P({ inbox: 'edit', dashboard: 'view', funnels: 'view', crm: 'edit', orders: 'edit', products: 'view', bookings: 'edit', webinars: 'view', quotes: 'edit', automations: 'view', broadcasts: 'view', files: 'edit', ads: 'view' }),
  viewer: P({ dashboard: 'view', funnels: 'view', crm: 'view', orders: 'view', products: 'view', bookings: 'view', webinars: 'view', quotes: 'view', automations: 'view', broadcasts: 'view', ads: 'view' }),
  agency: allLevel('edit'),
};
const PRESET_NOTES = {
  admin: 'Sees the team but can’t change it. No billing or account deletion.',
  marketer: 'No settings, secrets or refunds.',
  sales: 'Orders: shipping and COD only, no refunds. Products: can grant buyer access. School: students and community.',
  viewer: 'Read-only. Contact details and the vault stay hidden.',
};
const BUILT_IN = new Set(Object.keys(ROLES));
const MAX_ROLES = 50;
// a role id from this owner's list: a built-in key or one of their custom roles
export function roleInfo(ownerId, role) {
  if (BUILT_IN.has(role)) return { id: role, name: ROLES[role].split(' — ')[0], desc: ROLES[role].split(' — ')[1], perms: PRESETS[role], builtIn: true };
  if (role === 'agency') return { id: role, name: 'Agency', desc: 'manages this account', perms: PRESETS.agency, builtIn: true };
  const r = typeof role === 'string' && role.startsWith('role_') && T.roles.get(role);
  return r && r.userId === ownerId ? { id: r.id, name: r.name, desc: 'custom role', perms: P(r.perms), builtIn: false } : null;
}
// the permissions the auth middleware checks a custom role against (null for built-in roles; a role that's
// gone grants nothing)
export const customPerms = (ownerId, role) => (BUILT_IN.has(role) || role === 'agency' ? null : roleInfo(ownerId, role)?.perms || P({}));
// what /api/me tells the app (to hide menu items): the role's name and permission per area
export const memberRole = (ownerId, role) => { const r = roleInfo(ownerId, role); return { roleName: r?.name || 'Team member', perms: r?.perms || P({}) }; };
const roleLabel = (ownerId, role) => { const r = roleInfo(ownerId, role); return r ? `${r.name} — ${r.desc}` : 'Team member — custom role'; };
// someone managing the team through a custom role can't hand out more than they have themselves
const within = (mine, perms) => !mine || AREA_KEYS.every((k) => RANK[perms?.[k] || 'none'] <= RANK[mine[k] || 'none']);
function cleanPerms(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return { error: 'perms must be an object of area → none / view / edit' };
  if (Object.keys(v).some((k) => !AREA_KEYS.includes(k))) return { error: 'Unknown permission area' };
  const out = {};
  for (const a of AREAS) {
    const lvl = v[a.key] ?? 'none';
    if (!a.levels.includes(lvl)) return { error: `${a.label}: pick ${a.levels.join(' / ')}` };
    out[a.key] = lvl;
  }
  return { perms: out };
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

const view = (m) => ({ id: m.id, email: m.email, name: m.userId ? T.users.get(m.userId)?.name || '' : '', role: m.role, roleName: roleInfo(m.ownerId, m.role)?.name || 'Team member', funnelIds: m.funnelIds || null, status: m.status, at: m.at, acceptedAt: m.acceptedAt || null, lastSeenAt: m.lastSeenAt || null, invitedBy: m.invitedBy || null });
const bizName = (u) => u.settings?.businessName || u.name || u.email;

// owners, an agency running the account, and members whose custom role can edit the team
const canManage = (req) => !req.actor || req.role === 'agency' || req.customPerms?.team === 'edit';

export function registerTeam(app, { auth, sign, rateLimit, isTest }) {
  const inviteLimiter = rateLimit({ windowMs: 3600000, max: isTest ? 1000 : 30, key: (req) => req.user.id, message: 'Too many invites — please try again later.' });
  const sendInvite = async (req, owner, m, token) => {
    const who = req.actor?.name || owner.name;
    await sendMail({ to: m.email, subject: `${who} invited you to ${bizName(owner)} on ${brand()}`, text: `Hi,\n\n${who} has invited you to join ${bizName(owner)} on ${brand()} as ${roleInfo(m.ownerId, m.role)?.name || 'a team member'}.\n\nAccept the invitation (valid for ${INVITE_DAYS} days):\n${appUrl(req)}/team/accept?token=${token}\n\nIf you don’t have an account yet, you’ll create one with this email address first.` }).catch((e) => console.error('team invite email failed', e.message));
  };

  // the owner's team (owners and admins)
  app.get('/api/team/members', auth, (req, res) => {
    res.json({ owner: { name: req.user.name, email: req.user.email }, members: T.members.all({ ownerId: req.user.id }, { order: 'at' }).map(view), roles: ROLES, customRoles: T.roles.all({ userId: req.user.id }, { order: 'at' }).map((r) => ({ id: r.id, name: r.name })), max: TEAM_MAX, canManage: canManage(req) });
  });
  app.post('/api/team/invite', auth, inviteLimiter, async (req, res) => {
    const email = String(req.body?.email || '').trim().toLowerCase().slice(0, 200);
    const role = req.body?.role;
    if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'Enter a valid email address' });
    if (!roleInfo(req.user.id, role) || role === 'agency') return res.status(400).json({ error: 'Pick a role' });
    if (!within(req.customPerms, roleInfo(req.user.id, role).perms)) return res.status(403).json({ error: 'You can’t give someone more access than you have' });
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
  const ownMember = (req, res) => {
    const m = T.members.get(req.params.mid);
    if (!m || m.ownerId !== req.user.id) { res.status(404).json({ error: 'Not on your team' }); return null; }
    if (!within(req.customPerms, roleInfo(m.ownerId, m.role)?.perms)) { res.status(403).json({ error: 'They have more access than you — ask the owner' }); return null; }
    return m;
  };
  app.put('/api/team/members/:mid', auth, (req, res) => {
    const m = ownMember(req, res); if (!m) return;
    const b = req.body || {};
    if (('role' in b || !('funnelIds' in b)) && (!roleInfo(req.user.id, b.role) || b.role === 'agency')) return res.status(400).json({ error: 'Pick a role' });
    if ('role' in b && !within(req.customPerms, roleInfo(req.user.id, b.role).perms)) return res.status(403).json({ error: 'You can’t give someone more access than you have' });
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

  // ---- roles: the built-in presets (read-only) and the owner's custom roles ----
  const roleView = (ownerId, r) => ({ ...r, members: T.members.all({ ownerId }).filter((m) => m.role === r.id).length });
  app.get('/api/team/roles', auth, (req, res) => {
    const own = req.user.id;
    res.json({
      areas: AREAS.map(({ key, label, desc, levels }) => ({ key, label, desc, levels })),
      roles: [
        ...Object.keys(ROLES).map((k) => roleView(own, { ...roleInfo(own, k), note: PRESET_NOTES[k] })),
        ...T.roles.all({ userId: own }, { order: 'at' }).map((r) => roleView(own, { ...roleInfo(own, r.id), at: r.at, updatedAt: r.updatedAt || null })),
      ],
      canManage: canManage(req),
      max: MAX_ROLES,
    });
  });
  const roleBody = (req, res, cur) => {
    const b = req.body || {};
    const name = 'name' in b || !cur ? String(b.name || '').trim().slice(0, 60) : cur.name;
    if (!name) { res.status(400).json({ error: 'Give the role a name' }); return null; }
    const taken = [...Object.values(ROLES).map((x) => x.split(' — ')[0]), 'Agency', 'Owner', ...T.roles.all({ userId: req.user.id }).filter((r) => r.id !== cur?.id).map((r) => r.name)];
    if (taken.some((x) => x.toLowerCase() === name.toLowerCase())) { res.status(409).json({ error: 'There’s already a role with that name' }); return null; }
    const p = 'perms' in b || !cur ? cleanPerms(b.perms) : { perms: cur.perms };
    if (p.error) { res.status(400).json({ error: p.error }); return null; }
    if (!within(req.customPerms, p.perms)) { res.status(403).json({ error: 'You can’t give a role more access than you have' }); return null; }
    return { name, perms: p.perms };
  };
  const ownRole = (req, res) => {
    const r = T.roles.get(req.params.rid);
    if (!r || r.userId !== req.user.id) { res.status(404).json({ error: BUILT_IN.has(req.params.rid) ? 'Built-in roles can’t be changed — start a new role from one' : 'Role not found' }); return null; }
    if (!within(req.customPerms, P(r.perms))) { res.status(403).json({ error: 'That role has more access than you — ask the owner' }); return null; }
    return r;
  };
  app.post('/api/team/roles', auth, (req, res) => {
    if (!canManage(req)) return res.status(403).json({ error: 'Only the owner can change roles' });
    if (T.roles.count({ userId: req.user.id }) >= MAX_ROLES) return res.status(400).json({ error: `Up to ${MAX_ROLES} custom roles` });
    const v = roleBody(req, res); if (!v) return;
    const r = T.roles.insert({ id: `role_${uid()}`, userId: req.user.id, ...v, at: Date.now() });
    res.json(roleView(req.user.id, { ...roleInfo(req.user.id, r.id), at: r.at }));
  });
  app.put('/api/team/roles/:rid', auth, (req, res) => {
    if (!canManage(req)) return res.status(403).json({ error: 'Only the owner can change roles' });
    const cur = ownRole(req, res); if (!cur) return;
    const v = roleBody(req, res, cur); if (!v) return;
    // takes effect on everyone's next request: the auth middleware reads the role each time
    const r = T.roles.update(cur.id, (x) => { x.name = v.name; x.perms = v.perms; x.updatedAt = Date.now(); });
    res.json(roleView(req.user.id, { ...roleInfo(req.user.id, r.id), at: r.at, updatedAt: r.updatedAt }));
  });
  // deleting a role people have: they move to the replacement role (replaceWith, in the body or the query)
  app.delete('/api/team/roles/:rid', auth, (req, res) => {
    if (!canManage(req)) return res.status(403).json({ error: 'Only the owner can change roles' });
    const cur = ownRole(req, res); if (!cur) return;
    const holders = T.members.all({ ownerId: req.user.id }).filter((m) => m.role === cur.id);
    const to = req.body?.replaceWith ?? req.query.replaceWith;
    if (holders.length) {
      const rep = to && to !== cur.id && to !== 'agency' ? roleInfo(req.user.id, to) : null;
      if (!rep) return res.status(409).json({ error: `${holders.length} ${holders.length > 1 ? 'people have' : 'person has'} this role — pick a role to move them to`, members: holders.length });
      if (!within(req.customPerms, rep.perms)) return res.status(403).json({ error: 'You can’t give someone more access than you have' });
      tx(() => { for (const m of holders) T.members.update(m.id, (x) => { x.role = rep.id; }); T.roles.del(cur.id); });
    } else T.roles.del(cur.id);
    res.json({ ok: true, moved: holders.length });
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
    res.json({ email: m.email, role: m.role, roleLabel: roleLabel(m.ownerId, m.role), business: owner ? bizName(owner) : '', hasAccount: T.users.exists({ email: m.email }) });
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
    const teams = T.members.all({ userId: me.id, status: 'active' }).map((m) => { const o = T.users.get(m.ownerId); return o && { ownerId: o.id, name: bizName(o), role: m.role, roleName: roleInfo(o.id, m.role)?.name || 'Team member' }; }).filter(Boolean);
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
