// Agencies and freelancers.
//   - client accounts: an agency creates accounts for its clients, works in them from one login (switcher), and
//     pays for all of them with one Agency plan; a client can be invited to log in, handed over (detached) or deleted
//   - white-label: the agency's name, logo, colour, support email and its own app domain replace the platform's
//     brand for the agency and its clients
//   - snapshots: copy a funnel (with its automations and products) to a client account, export / import it as a
//     file, or share a link anyone can import from — how freelancers deliver funnels
//   - client reports: a private read-only link with a client's numbers
//   - activity log: who changed what in an account (owner, team member, agency, API key)
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { T, q, tx, uid } from './db.js';
import { platform, isAdmin } from './platform.js';
import { totals, sources } from './analytics.js';
import { copyProduct } from './products.js';
import { funnelLimitError } from './limits.js';
import { randomToken, hashToken } from './security.js';
import { sendMail, appUrl, mailEnabled } from './mail.js';
import { isPlatformHost } from './domains.js';

const DAY = 86400000;
const clip = (v, n) => String(v ?? '').trim().slice(0, n);
let SECRET = '';
const sig = (s) => crypto.createHmac('sha256', SECRET).update(`report:${s}`).digest('base64url').slice(0, 24);

// ---------- plans & limits ----------
export const isAgencyPlan = (u) => /^agency_/.test(u?.billing?.interval || u?.billing?.pending?.interval || '');
export function clientLimit(u) {
  if (!u) return 0;
  if (isAdmin(u)) return 1000;
  if (u.agencyMaxClients) return u.agencyMaxClients;
  const b = u.billing || {}, max = platform().agency?.maxClients ?? 25;
  if (b.status === 'comped') return max;
  if (isAgencyPlan(u) && ['active', 'past_due', 'cancelled'].includes(b.status)) return max;
  if (b.status === 'trialing') return platform().agency?.trialClients ?? 2; // try it before upgrading
  return 0;
}
export const clientsOf = (agencyId) => q("SELECT data FROM users WHERE json_extract(data, '$.agencyId') = ?").all(agencyId).map((r) => JSON.parse(r.data));

// ---------- white-label ----------
// the brand an account sees: its agency's (or its own, for an agency), else the platform's
export function brandFor(u) {
  const owner = u?.agencyId ? T.users.get(u.agencyId) : u;
  const w = owner?.settings?.whiteLabel;
  return w?.brand ? { brand: w.brand, logo: w.logo || '', primary: w.primary || '', supportEmail: w.supportEmail || '', hidePowered: !!w.hidePowered, agency: true } : null;
}
const DOMAIN_RE = /^(?=.{4,253}$)([a-z0-9](-?[a-z0-9])*\.)+[a-z]{2,}$/;
// an agency's own app domain (app.agency.com) — login page and dashboard in their brand
export function brandForHost(host) {
  const h = String(host || '').toLowerCase().split(':')[0];
  if (!h || !DOMAIN_RE.test(h)) return null;
  const row = q("SELECT data FROM users WHERE json_extract(data, '$.settings.whiteLabel.domain') = ?").get(h);
  const u = row && JSON.parse(row.data);
  return u ? { ...brandFor(u), domain: h } : null;
}
export const isAgencyDomain = (host) => !!brandForHost(host);

// ---------- snapshots ----------
const PRODUCT_KEYS = ['productId', 'bumpProductId'];
function snapshotOf(f) {
  const blocks = f.steps.flatMap((s) => [...s.blocks, ...(s.ab?.blocks || [])]);
  const productIds = [...new Set(blocks.flatMap((b) => [...PRODUCT_KEYS.map((k) => b.props?.[k]), ...(b.props?.items || []).map((i) => i?.productId)]).filter(Boolean))];
  return {
    kind: 'funnelhive.snapshot', version: 1, at: Date.now(),
    funnel: { name: f.name, theme: f.theme, steps: f.steps, seo: f.seo || null },
    automations: T.automations.all({ userId: f.userId }).filter((a) => a.trigger?.funnelId === f.id).map(({ name, trigger, steps, stopOnPurchase, allowRepeat }) => ({ name, trigger, steps, stopOnPurchase, allowRepeat })),
    products: productIds.map((id) => T.products.get(id)).filter((p) => p && p.userId === f.userId).map((p) => ({ ...p })),
  };
}
const newIds = (steps) => steps.map((s) => ({ ...s, id: uid(), blocks: s.blocks.map((b) => ({ ...b, id: uid() })), ...(s.ab?.blocks ? { ab: { ...s.ab, blocks: s.ab.blocks.map((b) => ({ ...b, id: uid() })) } } : {}) }));
// A snapshot into an account: a new funnel (draft), its automations (paused), products with their files
export function importSnapshot(userId, snap, { createFunnel, withProducts = true, sourceUserId = null }) {
  if (!snap || snap.kind !== 'funnelhive.snapshot' || !snap.funnel?.steps?.length) throw new Error('That isn’t a FunnelHive funnel file');
  const lim = funnelLimitError(T.users.get(userId));
  if (lim) throw Object.assign(new Error(lim), { status: 403 });
  const steps = newIds(structuredClone(snap.funnel.steps)).slice(0, 30);
  // products: copied (files too when they come from this server) and re-pointed; otherwise the link is removed
  const map = {};
  if (withProducts) for (const p of (snap.products || []).slice(0, 30)) { const c = copyProduct(p, userId, sourceUserId); if (c) map[p.id] = c.id; }
  const fix = (b) => {
    const pr = { ...b.props };
    for (const k of PRODUCT_KEYS) if (pr[k]) pr[k] = map[pr[k]] || '';
    if (Array.isArray(pr.items)) pr.items = pr.items.map((i) => (i?.productId ? { ...i, productId: map[i.productId] || '' } : i));
    if ('calendarId' in pr) pr.calendarId = ''; // the account's own default calendar
    if ('webinarId' in pr) pr.webinarId = ''; // a webinar is set up from the account's own schedule
    return { ...b, props: pr };
  };
  for (const s of steps) { s.blocks = s.blocks.map(fix); if (s.ab?.blocks) s.ab.blocks = s.ab.blocks.map(fix); }
  const f = createFunnel(userId, { name: clip(snap.funnel.name, 80) || 'Imported funnel', theme: snap.funnel.theme, steps });
  for (const a of (snap.automations || []).slice(0, 20)) {
    T.automations.insert({ id: uid(), userId, name: clip(a.name, 80), trigger: { ...a.trigger, funnelId: f.id }, steps: a.steps, stopOnPurchase: a.stopOnPurchase, allowRepeat: a.allowRepeat, active: false, stats: {}, at: Date.now() });
  }
  return { funnel: f, products: Object.keys(map).length, automations: Math.min(20, (snap.automations || []).length) };
}

// ---------- activity log ----------
const NOISY = /^\/api\/(public|hive\/chat|ai\/|me$|events|team\/switch|access\/|booking\/|webinar-reg)/;
export function logRequest(req, res) {
  if (!req.user || req.method === 'GET' || res.statusCode >= 400) return;
  const path = req.originalUrl.split('?')[0];
  if (NOISY.test(path)) return;
  const who = req.apiKey ? { kind: 'api', name: `API key · ${req.apiKey.name}` } : req.actor ? { kind: req.role === 'agency' ? 'agency' : 'team', name: req.actor.name, email: req.actor.email } : req.impersonator ? { kind: 'support', name: 'Platform support' } : { kind: 'owner', name: req.user.name, email: req.user.email };
  try {
    T.activity.insert({ id: uid(), userId: req.user.id, at: Date.now(), method: req.method, path: path.slice(0, 160), who });
    if (Math.random() < 0.02) q(`DELETE FROM activity WHERE userId = ? AND id NOT IN (SELECT id FROM activity WHERE userId = ? ORDER BY at DESC LIMIT 2000)`).run(req.user.id, req.user.id);
  } catch {}
}
// "PUT /api/funnels/abc" → "Edited a funnel"
const WHAT = [[/^POST \/api\/funnels$/, 'Created a funnel'], [/^PUT \/api\/funnels\//, 'Edited a funnel'], [/^DELETE \/api\/funnels\//, 'Deleted a funnel'], [/^POST \/api\/templates\/.+\/use/, 'Created a funnel from a template'], [/^POST \/api\/funnels\/.+\/duplicate/, 'Duplicated a funnel'],
  [/automations/, 'Changed an automation'], [/broadcasts\/.+\/send/, 'Sent a broadcast'], [/broadcasts/, 'Changed a broadcast'], [/^POST \/api\/orders\/.+\/refund/, 'Refunded an order'], [/orders\/.+\/(fulfil|cod)/, 'Updated an order'],
  [/^DELETE \/api\/contacts\/[^/]+$/, 'Erased a contact'], [/contacts|pipelines|crm/, 'Updated contacts'], [/products/, 'Changed a product'], [/settings|channels|privacy|google|domains|keys|webhooks/, 'Changed settings'], [/team/, 'Changed the team'], [/calendars|bookings/, 'Changed bookings'], [/webinars/, 'Changed a webinar'], [/coupons/, 'Changed coupons']];
const describe = (a) => WHAT.find(([re]) => re.test(`${a.method} ${a.path}`))?.[1] || `${a.method} ${a.path.replace('/api/', '')}`;

// ---------- routes ----------
export function registerAgency(app, { auth, secret, createFunnel, deleteAccount, newBilling, signFor }) {
  SECRET = secret;
  const myClient = (req, res) => { const c = T.users.get(req.params.cid); if (!c || c.agencyId !== (req.actor || req.user).id || req.actor) { res.status(404).json({ error: 'Client account not found' }); return null; } return c; };
  const reportToken = (cid) => `${cid}.${sig(cid)}`;
  const statsOf = (uid0) => { const now = Date.now(); return totals({ userId: uid0 }, now - 30 * DAY, now); };

  app.get('/api/agency', auth, (req, res) => {
    if (req.actor) return res.status(403).json({ error: 'Switch to your own account to manage client accounts' });
    const list = clientsOf(req.user.id).map((c) => ({ id: c.id, business: c.settings?.businessName || c.name, name: c.name, email: c.passwordSet ? c.email : null, invited: !!c.invitedAt, createdAt: c.createdAt, funnels: T.funnels.count({ userId: c.id }), stats: statsOf(c.id), report: `/report/${reportToken(c.id)}` }));
    res.json({ limit: clientLimit(req.user), used: list.length, plan: isAgencyPlan(req.user) ? 'agency' : req.user.billing?.status, clients: list, whiteLabel: req.user.settings?.whiteLabel || {} });
  });
  app.post('/api/agency/clients', auth, (req, res) => {
    if (req.actor || req.apiKey) return res.status(403).json({ error: 'Only the agency owner can add client accounts' });
    const n = clientsOf(req.user.id).length, limit = clientLimit(req.user);
    if (n >= limit) return res.status(402).json({ error: limit ? `Your plan includes ${limit} client accounts — contact support for more` : 'Client accounts come with the Agency plan — upgrade in Plan & billing', upgrade: true });
    const business = clip(req.body?.business, 80);
    if (!business) return res.status(400).json({ error: 'Enter the client’s business name' });
    const id = uid();
    const c = { id, email: `client-${id}@clients.invalid`, name: clip(req.body?.name, 80) || business, hash: bcrypt.hashSync(randomToken(), 8), passwordSet: false, settings: { businessName: business }, emailVerified: true, pv: 0, createdAt: Date.now(), agencyId: req.user.id, billing: { status: 'agency', startedAt: Date.now() } };
    tx(() => {
      T.users.insert(c);
      // the agency works in the account as its manager
      T.members.insert({ id: uid(), ownerId: id, userId: req.user.id, email: req.user.email, role: 'agency', status: 'active', at: Date.now(), acceptedAt: Date.now() });
    });
    res.status(201).json({ id, business, token: signFor(req.user, id) });
  });
  // the client logs in to their own account: a link to set a password, sent to their email
  app.post('/api/agency/clients/:cid/invite', auth, async (req, res) => {
    const c = myClient(req, res); if (!c) return;
    const email = clip(req.body?.email, 200).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Enter the client’s email address' });
    if (email !== c.email && T.users.exists({ email })) return res.status(409).json({ error: 'That email already has an account — invite it from the client account’s Team settings instead' });
    const token = `${c.id}.${randomToken()}`;
    // the new email isn't proven until the client opens the link sent to it (the reset marks it verified): until
    // then it can't pick up admin rights or be linked by a Google sign-in as if the agency owned that inbox
    T.users.update(c.id, (x) => { x.email = email; x.emailVerified = false; x.resetHash = hashToken(token); x.resetExp = Date.now() + 7 * DAY; x.invitedAt = Date.now(); });
    const b = brandFor(req.user)?.brand || platform().brand;
    await sendMail({ to: email, subject: `Your ${b} account is ready`, text: `Hi,\n\n${req.user.settings?.whiteLabel?.brand || req.user.settings?.businessName || req.user.name} has set up your ${b} account for ${c.settings?.businessName || ''}.\n\nChoose your password to log in (link valid for 7 days):\n${process.env.APP_URL || appUrl(req)}/reset?token=${token}\n` }).catch(() => {});
    res.json({ ok: true, ...(process.env.NODE_ENV === 'test' ? { token } : {}), ...(mailEnabled() ? {} : { link: `${process.env.APP_URL || appUrl(req)}/reset?token=${token}` }) });
  });
  // hand the account over: the client becomes independent (their own trial / plan); the agency stays on its team
  app.post('/api/agency/clients/:cid/detach', auth, (req, res) => {
    const c = myClient(req, res); if (!c) return;
    if (!c.passwordSet) return res.status(400).json({ error: 'Invite the client to log in first, so someone owns the account' });
    T.users.update(c.id, (x) => { delete x.agencyId; x.billing = newBilling(); });
    q("UPDATE members SET data = json_set(data, '$.role', 'admin') WHERE json_extract(data, '$.ownerId') = ? AND json_extract(data, '$.userId') = ?").run(c.id, req.user.id);
    res.json({ ok: true });
  });
  app.delete('/api/agency/clients/:cid', auth, (req, res) => {
    const c = myClient(req, res); if (!c) return;
    if (req.body?.confirm !== 'DELETE') return res.status(400).json({ error: 'Type DELETE to confirm' });
    deleteAccount(c.id);
    res.json({ ok: true });
  });
  app.put('/api/agency/white-label', auth, (req, res) => {
    if (req.actor || req.apiKey) return res.status(403).json({ error: 'Only the agency owner can change the white-label' });
    if (!clientLimit(req.user)) return res.status(402).json({ error: 'White-label comes with the Agency plan', upgrade: true });
    const b = req.body || {};
    const w = { brand: clip(b.brand, 40), logo: clip(b.logo, 500), primary: /^#[0-9a-f]{6}$/i.test(b.primary || '') ? b.primary : '', supportEmail: clip(b.supportEmail, 200), hidePowered: !!b.hidePowered, domain: clip(b.domain, 253).toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '') };
    if (w.logo && !/^(https:\/\/|\/uploads\/)[^\s"'<>]+$/.test(w.logo)) return res.status(400).json({ error: 'The logo must be an https:// image link or an uploaded image' });
    if (w.supportEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(w.supportEmail)) return res.status(400).json({ error: 'Enter a valid support email' });
    if (w.domain && !DOMAIN_RE.test(w.domain)) return res.status(400).json({ error: 'Enter a domain like app.youragency.com' });
    // the platform's own login page can't be rebranded, and a domain already serving a seller's funnel isn't free
    if (w.domain && isPlatformHost(w.domain)) return res.status(400).json({ error: 'Use your own domain, like app.youragency.com' });
    if (w.domain && T.domains.exists({ domain: w.domain })) return res.status(409).json({ error: 'That domain is connected to a funnel — use another subdomain for your app' });
    if (w.domain) { const other = brandForHost(w.domain); if (other && q("SELECT id FROM users WHERE json_extract(data, '$.settings.whiteLabel.domain') = ?").get(w.domain)?.id !== req.user.id) return res.status(409).json({ error: 'That domain is used by another account' }); }
    const u = T.users.update(req.user.id, (x) => { x.settings = { ...x.settings, whiteLabel: w }; });
    res.json({ whiteLabel: u.settings.whiteLabel, dns: w.domain ? { type: 'CNAME', name: w.domain, value: new URL(process.env.APP_URL || 'https://app.example.com').hostname } : null });
  });

  // ---- snapshots & sharing ----
  const ownFunnel = (req, res) => { const f = T.funnels.get(req.params.id); if (!f || f.userId !== req.user.id) { res.status(404).json({ error: 'Funnel not found' }); return null; } return f; };
  app.get('/api/funnels/:id/export', auth, (req, res) => {
    const f = ownFunnel(req, res); if (!f) return;
    const snap = snapshotOf(f);
    snap.products = snap.products.map(({ userId, ...p }) => ({ ...p, files: [] })); // files don't travel in the JSON
    res.set('Content-Disposition', `attachment; filename="${f.slug}.funnelhive.json"`).json(snap);
  });
  app.post('/api/funnels/import', auth, (req, res) => {
    try { const r = importSnapshot(req.user.id, req.body?.snapshot || req.body, { createFunnel }); res.status(201).json({ id: r.funnel.id, name: r.funnel.name, products: r.products, automations: r.automations }); } catch (e) { res.status(400).json({ error: e.message }); }
  });
  // copy to one of my client accounts (or any account where I'm agency / admin)
  app.post('/api/funnels/:id/copy-to', auth, (req, res) => {
    const f = ownFunnel(req, res); if (!f) return;
    const me = req.actor || req.user, target = String(req.body?.accountId || '');
    const m = T.members.find({ ownerId: target, userId: me.id, status: 'active' });
    if (!(m && ['agency', 'admin'].includes(m.role)) && target !== me.id) return res.status(403).json({ error: 'You can copy funnels only to accounts you manage' });
    const lim = funnelLimitError(T.users.get(target));
    if (lim) return res.status(403).json({ error: lim, limit: 'funnels' });
    const r = importSnapshot(target, snapshotOf(f), { createFunnel, sourceUserId: f.userId });
    res.status(201).json({ id: r.funnel.id, accountId: target, products: r.products, automations: r.automations });
  });
  app.post('/api/funnels/:id/share', auth, (req, res) => {
    const f = ownFunnel(req, res); if (!f) return;
    const token = f.shareToken || randomToken().slice(0, 24);
    T.funnels.update(f.id, (x) => { x.shareToken = token; x.shareProducts = req.body?.products !== false; });
    res.json({ url: `${process.env.APP_URL || appUrl(req)}/share/${token}`, token });
  });
  app.delete('/api/funnels/:id/share', auth, (req, res) => { const f = ownFunnel(req, res); if (!f) return; T.funnels.update(f.id, (x) => { delete x.shareToken; }); res.json({ ok: true }); });
  const shared = (token) => (/^[0-9a-f]{24}$/.test(String(token)) ? q("SELECT data FROM funnels WHERE json_extract(data, '$.shareToken') = ?").get(token) : null);
  app.get('/api/share/:token', (req, res) => {
    const row = shared(req.params.token);
    if (!row) return res.status(404).json({ error: 'This share link has been turned off' });
    const f = JSON.parse(row.data), owner = T.users.get(f.userId);
    res.json({ name: f.name, by: owner?.settings?.businessName || owner?.name || '', steps: f.steps.map((s) => ({ name: s.name, type: s.type })), theme: f.theme, hero: f.steps[0]?.blocks.find((b) => b.type === 'hero')?.props?.headline || '' });
  });
  app.post('/api/share/:token/import', auth, (req, res) => {
    const row = shared(req.params.token);
    if (!row) return res.status(404).json({ error: 'This share link has been turned off' });
    const f = JSON.parse(row.data);
    const lim = funnelLimitError(req.user);
    if (lim) return res.status(403).json({ error: lim, limit: 'funnels' });
    const r = importSnapshot(req.user.id, snapshotOf(f), { createFunnel, withProducts: f.shareProducts !== false, sourceUserId: f.userId });
    res.status(201).json({ id: r.funnel.id, name: r.funnel.name });
  });

  // ---- client report (public, read-only, signed) ----
  app.get('/api/report/:token', (req, res) => {
    const [cid, s] = String(req.params.token).split('.');
    const c = cid && s === sig(cid) ? T.users.get(cid) : null;
    if (!c) return res.status(404).json({ error: 'Report not found' });
    const days = Math.min(365, Math.max(7, Number(req.query.days) || 30)), now = Date.now();
    const b = brandFor(c);
    res.set('Cache-Control', 'no-store').json({
      business: c.settings?.businessName || c.name, days, brand: b?.brand || platform().brand, logo: b?.logo || '',
      totals: totals({ userId: c.id }, now - days * DAY, now), prev: totals({ userId: c.id }, now - 2 * days * DAY, now - days * DAY),
      sources: sources({ userId: c.id }, now - days * DAY).slice(0, 8),
      funnels: T.funnels.all({ userId: c.id }).map((f) => ({ name: f.name, published: !!f.published, ...totals({ funnelId: f.id }, now - days * DAY, now) })).sort((a, b2) => b2.revenue - a.revenue).slice(0, 20),
    });
  });

  // ---- activity ----
  app.get('/api/activity', auth, (req, res) => {
    res.json(T.activity.all({ userId: req.user.id }, { order: 'at', desc: true, limit: Math.min(500, Number(req.query.limit) || 200) }).map((a) => ({ at: a.at, who: a.who, what: describe(a) })));
  });
}
