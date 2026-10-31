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
import { T, q, tx, uid, JOBS } from './db.js';
import { platform, isAdmin } from './platform.js';
import { totals, sources } from './analytics.js';
import { copyProduct } from './products.js';
import { funnelLimitError } from './limits.js';
import { randomToken, hashToken } from './security.js';
import { sendMail, appUrl, mailEnabled } from './mail.js';
import { isPlatformHost } from './domains.js';
import { termsOf, clientsOf, AGENCY_ADDONS } from './agency-terms.js';
import { startAgencyAccess, staffMember, staffCovers, accessMode, logAgency } from './agency-access.js';
import { notify } from './notify.js';

const DAY = 86400000;
const clip = (v, n) => String(v ?? '').trim().slice(0, n);
let SECRET = '';
const sig = (s) => crypto.createHmac('sha256', SECRET).update(`report:${s}`).digest('base64url').slice(0, 24);
export const PURGE_DAYS = 30; // a deleted client account is suspended this long (the agency can undo it), then purged
export { clientsOf };

// ---------- plans & limits ----------
export const isAgencyPlan = (u) => /^agency_/.test(u?.billing?.interval || u?.billing?.pending?.interval || '');
export function clientLimit(u) {
  if (!u) return 0;
  if (isAdmin(u)) return 1000;
  // a client (sub-account) of an agency or partner can't have clients of its own: the hierarchy is one level deep
  if (u.agencyId) return 0;
  const t = termsOf(u); // the platform's terms for this agency (agency-terms.js)
  if (t?.status === 'suspended') return 0;
  if (t?.maxClients) return t.maxClients;
  const b = u.billing || {}, max = platform().agency?.maxClients ?? 25;
  if (b.status === 'comped') return max;
  if (isAgencyPlan(u) && ['active', 'past_due', 'cancelled'].includes(b.status)) return max;
  if (b.status === 'trialing') return platform().agency?.trialClients ?? 2; // try it before upgrading
  return 0;
}

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
  const u = T.users.find({ wlDomain: h }); // indexed (db.js users.wlDomain)
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
  if (!snap || snap.kind !== 'funnelhive.snapshot' || !Array.isArray(snap.funnel?.steps) || !snap.funnel.steps.length) throw new Error('That isn’t a FunnelHive funnel file');
  // a hand-edited or damaged file: every page needs a list of sections (one without would break the funnels list
  // and the live page); sections that aren't sections are dropped
  const obj = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
  if (!snap.funnel.steps.every((s) => obj(s) && Array.isArray(s.blocks))) throw new Error('That funnel file is damaged — export it again and retry');
  const okBlock = (b) => obj(b) && typeof b.type === 'string' && (b.props === undefined || obj(b.props));
  snap = { ...snap, funnel: { ...snap.funnel, theme: obj(snap.funnel.theme) ? snap.funnel.theme : {}, steps: snap.funnel.steps.map((s, i) => ({ ...s, name: clip(s.name, 80) || `Page ${i + 1}`, slug: typeof s.slug === 'string' && /^[a-z0-9-]{1,60}$/.test(s.slug) ? s.slug : `page-${i + 1}`, blocks: s.blocks.filter(okBlock), ...(s.ab && obj(s.ab) ? { ab: { ...s.ab, blocks: Array.isArray(s.ab.blocks) ? s.ab.blocks.filter(okBlock) : [] } } : {}) })) } };
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
  const ag = req.agencyAccess;
  const who = req.apiKey ? { kind: 'api', name: `API key · ${req.apiKey.name}` } : ag ? { kind: 'agency', name: ag.staff ? `${ag.actorName} (${ag.agencyName})` : ag.agencyName } : req.actor ? { kind: req.role === 'agency' ? 'agency' : 'team', name: req.actor.name, email: req.actor.email } : req.impersonator ? { kind: 'support', name: 'Platform support' } : { kind: 'owner', name: req.user.name, email: req.user.email };
  try {
    T.activity.insert({ id: uid(), userId: req.user.id, at: Date.now(), method: req.method, path: path.slice(0, 160), who });
    if (Math.random() < 0.02) q(`DELETE FROM activity WHERE userId = ? AND id NOT IN (SELECT id FROM activity WHERE userId = ? ORDER BY at DESC LIMIT 2000)`).run(req.user.id, req.user.id);
  } catch {}
}
// "PUT /api/funnels/abc" → "Edited a funnel"
const WHAT = [[/^POST \/api\/funnels$/, 'Created a funnel'], [/^PUT \/api\/funnels\//, 'Edited a funnel'], [/^DELETE \/api\/funnels\//, 'Deleted a funnel'], [/^POST \/api\/templates\/.+\/use/, 'Created a funnel from a template'], [/^POST \/api\/funnels\/.+\/duplicate/, 'Duplicated a funnel'],
  [/automations/, 'Changed an automation'], [/broadcasts\/.+\/send/, 'Sent a broadcast'], [/broadcasts/, 'Changed a broadcast'], [/^POST \/api\/orders\/.+\/refund/, 'Refunded an order'], [/orders\/.+\/(fulfil|cod)/, 'Updated an order'],
  [/vault\/secrets\/.+\/reveal/, 'Revealed a saved password or note'], [/vault\/secrets/, 'Changed saved passwords'], [/contacts\/.+\/files|vault/, 'Changed vault files'],
  [/^DELETE \/api\/contacts\/[^/]+$/, 'Erased a contact'], [/contacts|pipelines|crm/, 'Updated contacts'], [/products/, 'Changed a product'], [/settings|channels|privacy|google|domains|keys|webhooks/, 'Changed settings'], [/team/, 'Changed the team'], [/calendars|bookings/, 'Changed bookings'], [/webinars/, 'Changed a webinar'], [/coupons/, 'Changed coupons']];
// rows the agency-access log wrote carry their own text; reads during agency access read as "Looked at …"
const describe = (a) => a.what || (a.method === 'GET' ? `Looked at ${a.path.replace('/api/', '').split('/')[0].replace(/-/g, ' ')}` : null) || WHAT.find(([re]) => re.test(`${a.method} ${a.path}`))?.[1] || `${a.method} ${a.path.replace('/api/', '')}`;

// ---------- routes ----------
// ---------- deleted client accounts: suspended for PURGE_DAYS, then purged ----------
let purgeAccount = null; // account.js deleteAccount, given by registerAgency
export function purgeDeletedClients(now = Date.now(), del = purgeAccount) {
  let n = 0;
  for (const r of q("SELECT id FROM users WHERE json_extract(data, '$.deletion.purgeAt') <= ?").all(now)) {
    const c = T.users.get(r.id);
    if (!c?.deletion || c.deletion.purgeAt > now || !del) continue;
    del(c.id);
    n++;
  }
  return n;
}
if (JOBS && process.env.NODE_ENV !== 'test') { setTimeout(() => { try { purgeDeletedClients(); } catch (e) { console.error('client purge failed', e.message); } }, 120000).unref(); setInterval(() => { try { purgeDeletedClients(); } catch (e) { console.error('client purge failed', e.message); } }, 6 * 3600000).unref(); }

// ---------- client report links: expire, and can be revoked (c.report = { v, exp }) ----------
// token: <client id>.<version>.<expiry, base 36>.<signature>; a new link or a revoke bumps the version
export const reportToken = (c) => (c?.report?.exp > Date.now() ? `${c.id}.${c.report.v}.${c.report.exp.toString(36)}.${sig(`${c.id}.${c.report.v}.${c.report.exp.toString(36)}`)}` : null);
export function reportClient(token) {
  const [cid, v, exp, s] = String(token || '').split('.');
  if (!cid || !v || !exp || !s || s !== sig(`${cid}.${v}.${exp}`)) return null;
  const c = T.users.get(cid);
  return c && !c.deletion && String(c.report?.v) === v && c.report.exp.toString(36) === exp && c.report.exp > Date.now() ? c : null;
}

export function registerAgency(app, { auth, secret, createFunnel, deleteAccount, newBilling, signAgency }) {
  SECRET = secret;
  purgeAccount = deleteAccount;
  // who is managing clients: the agency's owner, or its client manager (team role 'clients', maybe limited to
  // some clients). Not an API key, not support, not from inside a client account. owner: owner-only actions.
  const agencyCtx = (req, res, { owner = false } = {}) => {
    const no = (s, error) => { res.status(s).json({ error }); return null; };
    if (req.apiKey) return no(403, 'API keys can’t manage client accounts');
    if (req.agencyAccess) return no(403, 'Go back to your agency to manage client accounts');
    if (req.user.agencyId) return no(404, 'This page doesn’t exist.'); // a sub-account has no agency tools
    if (!req.actor) return { agency: req.user, actor: req.user, staff: null };
    const sm = req.role === 'clients' ? staffMember(req.user.id, req.actor.id) : null;
    if (!sm) return no(403, 'Switch to your own account to manage client accounts');
    if (owner) return no(403, 'Only the agency owner can do this');
    return { agency: req.user, actor: req.actor, staff: sm };
  };
  const myClient = (req, res, opts) => {
    const ctx = agencyCtx(req, res, opts); if (!ctx) return null;
    const c = T.users.get(req.params.cid);
    if (!c || c.agencyId !== ctx.agency.id || (ctx.staff && !staffCovers(ctx.staff, c.id))) { res.status(404).json({ error: 'Client account not found' }); return null; }
    return { c, ...ctx };
  };
  const statsOf = (uid0) => { const now = Date.now(); return totals({ userId: uid0 }, now - 30 * DAY, now); };
  const tok = (c) => reportToken(c);

  app.get('/api/agency', auth, (req, res) => {
    const ctx = agencyCtx(req, res); if (!ctx) return;
    const a = ctx.agency, t = termsOf(a);
    const list = clientsOf(a.id).filter((c) => !ctx.staff || staffCovers(ctx.staff, c.id)).map((c) => ({
      id: c.id, business: c.settings?.businessName || c.name, name: c.name, email: c.passwordSet ? c.email : null, invited: !!c.invitedAt, ownLogin: !!c.passwordSet, createdAt: c.createdAt,
      funnels: T.funnels.count({ userId: c.id }), stats: statsOf(c.id), access: accessMode(c), addons: { tally: !!c.addons?.tally, inventory: !!c.addons?.inventory },
      report: tok(c) ? `/report/${tok(c)}` : null, reportExpires: tok(c) ? c.report.exp : null, deletion: c.deletion ? { at: c.deletion.at, purgeAt: c.deletion.purgeAt } : null,
    }));
    const staff = ctx.staff ? null : T.members.all({ ownerId: a.id }).filter((m) => m.role === 'clients').map((m) => ({ id: m.id, email: m.email, name: m.userId ? T.users.get(m.userId)?.name || '' : '', status: m.status, clientIds: m.clientIds || null }));
    res.json({ limit: clientLimit(a), used: clientsOf(a.id).length, plan: isAgencyPlan(a) ? 'agency' : a.billing?.status, clients: list, whiteLabel: ctx.staff ? {} : a.settings?.whiteLabel || {}, clientMenu: a.settings?.clientMenu || null,
      terms: t ? { kind: t.kind, maxClients: t.maxClients, addons: t.addons, seatCap: t.seatCap, status: t.status } : null, staff, me: ctx.staff ? { role: 'clients', clientIds: ctx.staff.clientIds || null } : { role: 'owner' } });
  });
  app.post('/api/agency/clients', auth, (req, res) => {
    const ctx = agencyCtx(req, res); if (!ctx) return;
    if (ctx.staff?.clientIds?.length) return res.status(403).json({ error: 'You manage only the clients assigned to you — ask the agency owner to add one' });
    const a = ctx.agency;
    const n = clientsOf(a.id).length, limit = clientLimit(a);
    if (n >= limit) return res.status(402).json({ error: limit ? `Your plan includes ${limit} client accounts — contact support for more` : termsOf(a)?.status === 'suspended' ? 'Your agency tools are switched off — contact support' : 'Client accounts come with the Agency plan — upgrade in Plan & billing', upgrade: true });
    const business = clip(req.body?.business, 80);
    if (!business) return res.status(400).json({ error: 'Enter the client’s business name' });
    const id = uid();
    const c = { id, email: `client-${id}@clients.invalid`, name: clip(req.body?.name, 80) || business, hash: bcrypt.hashSync(randomToken(), 8), passwordSet: false, settings: { businessName: business }, emailVerified: true, pv: 0, createdAt: Date.now(), agencyId: a.id, billing: { status: 'agency', startedAt: Date.now() } };
    tx(() => {
      T.users.insert(c);
      // the agency works in the account as its manager
      T.members.insert({ id: uid(), ownerId: id, userId: a.id, email: a.email, role: 'agency', status: 'active', at: Date.now(), acceptedAt: Date.now() });
    });
    // straight in to set it up: an agency-access session like any other (reason recorded)
    const r = startAgencyAccess(req, { actor: ctx.actor, agency: a, client: T.users.get(id), reason: 'Setting up the new account', sign: signAgency });
    res.status(201).json({ id, business, ...(r.token ? { token: r.token, expiresAt: r.expiresAt } : {}) });
  });
  // open a client account: a reason (the client sees it), 2 hours, logged (agency-access.js)
  app.post('/api/agency/clients/:cid/enter', auth, (req, res) => {
    const x = myClient(req, res); if (!x) return;
    const r = startAgencyAccess(req, { actor: x.actor, agency: x.agency, client: x.c, reason: req.body?.reason, sign: signAgency });
    if (r.error) return res.status(r.status).json({ error: r.error, ...(r.agencyAccessOff ? { agencyAccessOff: true } : {}) });
    res.json(r);
  });
  // the client logs in to their own account: a link to set a password, sent to their email. Only while the
  // account has no login of its own — after that the email is the client's (changing it would lock them out)
  app.post('/api/agency/clients/:cid/invite', auth, async (req, res) => {
    const x = myClient(req, res, { owner: true }); if (!x) return;
    const c = x.c;
    if (c.passwordSet) return res.status(409).json({ error: 'The client already logs in with their own email — they can change it in their own Settings', ownLogin: true });
    if (c.deletion) return res.status(409).json({ error: 'This account is scheduled for deletion — restore it first' });
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
    const x = myClient(req, res, { owner: true }); if (!x) return;
    const c = x.c;
    if (!c.passwordSet) return res.status(400).json({ error: 'Invite the client to log in first, so someone owns the account' });
    if (c.deletion) return res.status(409).json({ error: 'This account is scheduled for deletion — restore it first' });
    T.users.update(c.id, (u) => { delete u.agencyId; delete u.report; u.billing = newBilling(); });
    q("UPDATE members SET data = json_set(data, '$.role', 'admin') WHERE json_extract(data, '$.ownerId') = ? AND json_extract(data, '$.userId') = ?").run(c.id, req.user.id);
    res.json({ ok: true });
  });
  // deleting a client: suspended now (its pages go offline, it can't be used), purged after PURGE_DAYS by the
  // job above; the client is told and the agency can undo it until then
  app.delete('/api/agency/clients/:cid', auth, (req, res) => {
    const x = myClient(req, res, { owner: true }); if (!x) return;
    const c = x.c;
    if (req.body?.confirm !== 'DELETE') return res.status(400).json({ error: 'Type DELETE to confirm' });
    if (c.deletion) return res.json({ ok: true, purgeAt: c.deletion.purgeAt });
    const now = Date.now(), purgeAt = now + PURGE_DAYS * DAY;
    T.users.update(c.id, (u) => { u.deletion = { at: now, purgeAt, by: req.user.id }; delete u.report; });
    const when = new Date(purgeAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
    notify(c.id, { kind: 'agency', title: 'Your agency is closing this account', body: `It is paused now and will be deleted with all its data on ${when}. Contact your agency if this is a mistake.` });
    logAgency(c.id, { agencyName: brandFor(req.user)?.brand || req.user.settings?.businessName || req.user.name, staff: false }, { method: 'DELETE', path: '/api/agency/clients', what: `Scheduled this account for deletion on ${when}` });
    res.json({ ok: true, purgeAt });
  });
  app.post('/api/agency/clients/:cid/restore', auth, (req, res) => {
    const x = myClient(req, res, { owner: true }); if (!x) return;
    if (!x.c.deletion) return res.status(400).json({ error: 'This account isn’t scheduled for deletion' });
    T.users.update(x.c.id, (u) => { delete u.deletion; });
    notify(x.c.id, { kind: 'agency', title: 'Your account is back', body: 'Your agency cancelled the deletion — everything works again.' });
    logAgency(x.c.id, { agencyName: brandFor(req.user)?.brand || req.user.settings?.businessName || req.user.name, staff: false }, { method: 'POST', path: '/api/agency/clients/restore', what: 'Cancelled the deletion of this account' });
    res.json({ ok: true });
  });
  // the client report link: a new one (the old stops working), valid 7–365 days; or turned off
  app.post('/api/agency/clients/:cid/report-link', auth, (req, res) => {
    const x = myClient(req, res); if (!x) return;
    if (x.c.deletion) return res.status(409).json({ error: 'This account is scheduled for deletion' });
    const days = Math.min(365, Math.max(1, Math.round(Number(req.body?.days) || 30)));
    const c = T.users.update(x.c.id, (u) => { u.report = { v: (u.report?.v || 0) + 1, exp: Date.now() + days * DAY }; });
    res.json({ url: `/report/${reportToken(c)}`, expiresAt: c.report.exp });
  });
  app.delete('/api/agency/clients/:cid/report-link', auth, (req, res) => {
    const x = myClient(req, res); if (!x) return;
    T.users.update(x.c.id, (u) => { u.report = { v: (u.report?.v || 0) + 1, exp: 0 }; });
    res.json({ ok: true });
  });
  // add-ons the platform lets this agency switch on for its clients (terms.addons)
  app.put('/api/agency/clients/:cid/addons', auth, (req, res) => {
    const x = myClient(req, res, { owner: true }); if (!x) return;
    const allowed = termsOf(req.user)?.addons || [], b = req.body || {};
    const keys = Object.keys(b).filter((k) => AGENCY_ADDONS.includes(k));
    if (!keys.length) return res.status(400).json({ error: `Pick an add-on: ${AGENCY_ADDONS.join(', ')}` });
    const no = keys.find((k) => !allowed.includes(k));
    if (no) return res.status(403).json({ error: `Your agency plan doesn’t include the ${no} add-on for clients — contact support`, addon: no });
    const c = T.users.update(x.c.id, (u) => { u.addons = { ...(u.addons || {}) }; for (const k of keys) u.addons[k] = !!b[k]; });
    res.json({ addons: { tally: !!c.addons?.tally, inventory: !!c.addons?.inventory } });
  });
  // a client manager: all clients, or only the ones assigned (clientIds; empty = all)
  app.put('/api/agency/staff/:mid', auth, (req, res) => {
    const ctx = agencyCtx(req, res, { owner: true }); if (!ctx) return;
    const m = T.members.get(req.params.mid);
    if (!m || m.ownerId !== ctx.agency.id || m.role !== 'clients') return res.status(404).json({ error: 'Not one of your client managers' });
    const ids = req.body?.clientIds;
    if (ids != null && (!Array.isArray(ids) || ids.length > 1000 || ids.some((id) => T.users.get(id)?.agencyId !== ctx.agency.id))) return res.status(400).json({ error: 'Pick clients of your agency' });
    const u = T.members.update(m.id, (x) => { if (ids?.length) x.clientIds = [...new Set(ids)]; else delete x.clientIds; });
    res.json({ id: u.id, clientIds: u.clientIds || null });
  });
  // the menu new and existing client accounts start with (they can still change their own); null = by their industry
  const CLIENT_PAGES = ['/funnels', '/hive', '/orders', '/reports', '/ads', '/products', '/school', '/quotes', '/contacts', '/vault', '/automations', '/broadcasts', '/bookings', '/webinars'];
  app.put('/api/agency/client-menu', auth, (req, res) => {
    if (!agencyCtx(req, res, { owner: true })) return;
    const pages = req.body?.pages;
    const menu = Array.isArray(pages) && pages.length ? [...new Set(pages.filter((x) => CLIENT_PAGES.includes(x)))] : null;
    T.users.update(req.user.id, (x) => { x.settings = { ...(x.settings || {}), clientMenu: menu }; });
    res.json({ clientMenu: menu });
  });
  app.put('/api/agency/white-label', auth, (req, res) => {
    if (!agencyCtx(req, res, { owner: true })) return;
    if (!clientLimit(req.user)) return res.status(402).json({ error: 'White-label comes with the Agency plan', upgrade: true });
    const b = req.body || {};
    const w = { brand: clip(b.brand, 40), logo: clip(b.logo, 500), primary: /^#[0-9a-f]{6}$/i.test(b.primary || '') ? b.primary : '', supportEmail: clip(b.supportEmail, 200), hidePowered: !!b.hidePowered, domain: clip(b.domain, 253).toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '') };
    if (w.logo && !/^(https:\/\/|\/uploads\/)[^\s"'<>]+$/.test(w.logo)) return res.status(400).json({ error: 'The logo must be an https:// image link or an uploaded image' });
    if (w.supportEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(w.supportEmail)) return res.status(400).json({ error: 'Enter a valid support email' });
    if (w.domain && !DOMAIN_RE.test(w.domain)) return res.status(400).json({ error: 'Enter a domain like app.youragency.com' });
    // the platform's own login page can't be rebranded, and a domain already serving a seller's funnel isn't free
    if (w.domain && isPlatformHost(w.domain)) return res.status(400).json({ error: 'Use your own domain, like app.youragency.com' });
    if (w.domain && T.domains.exists({ domain: w.domain })) return res.status(409).json({ error: 'That domain is connected to a funnel — use another subdomain for your app' });
    if (w.domain) { const other = T.users.find({ wlDomain: w.domain }); if (other && other.id !== req.user.id) return res.status(409).json({ error: 'That domain is used by another account' }); }
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
    try { const r = importSnapshot(req.user.id, req.body?.snapshot || req.body, { createFunnel }); res.status(201).json({ id: r.funnel.id, name: r.funnel.name, products: r.products, automations: r.automations }); } catch (e) { res.status(e.status || 400).json({ error: e.message, ...(e.status === 403 ? { limit: 'funnels' } : {}) }); }
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
    const c = reportClient(req.params.token);
    if (!c) return res.status(404).json({ error: 'This report link has expired or was turned off — ask for a new one' });
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
