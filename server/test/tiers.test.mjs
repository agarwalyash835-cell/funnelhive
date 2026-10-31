// Three addresses, three sign-ins (tiers.js): super (admin panel), agency, app. A token only works on the address it
// was signed in on; the super host answers only the admin API, sign-in and health; signing in there needs a platform
// admin with the 2-step code; ADMIN_IP_ALLOWLIST; old tokens without a tier keep working on the app. Plus the admin
// hardening: a new admin needs a second admin's approval, admins can't be opened with support access, support admins
// can't change platform settings, and the audit log records it all.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { startServer, register, enable2fa, totpCode } from './helpers.mjs';

const SUPER = { 'x-forwarded-host': 'super.test' }, AGENCY = { 'x-forwarded-host': 'agency.test' }, APP = { 'x-forwarded-host': 'app.test' };
const OUTSIDE = { ...SUPER, 'x-forwarded-for': '8.8.8.8' };
let srv, api;
const S = {}; // secrets for 2-step codes
const T = {}; // tokens
const ids = {};
before(async () => {
  srv = await startServer({ SUPER_HOST: 'super.test', AGENCY_HOST: 'https://agency.test/', APP_URL: 'https://app.test', ADMIN_EMAILS: 'boss@root.test,boss2@root.test', ADMIN_IP_ALLOWLIST: '127.0.0.1, ::1, 10.9.0.0/16' });
  api = srv.api;
});
after(() => srv?.stop());

const verify = async (email) => { const m = srv.log().match(new RegExp(`To: ${email.replace(/[.@]/g, (c) => `\\${c}`)}[\\s\\S]*?/verify\\?token=([a-f0-9.]+)`)); assert.ok(m, `verification link for ${email}`); await api('/auth/verify', 'POST', { token: m[1] }); };
const login = (email, password, h, code) => api('/auth/login', 'POST', { email, password, ...(code ? { code } : {}) }, null, h);

test('signing in on the super host: admins only, and the 2-step code is required', async () => {
  for (const e of ['boss@root.test', 'boss2@root.test', 'seller@shop.test', 'helper@shop.test']) { T[e] = (await register(api, e)).token; await verify(e); }
  ({ token: T.boss, secret: S.boss } = await enable2fa(api, T['boss@root.test']));
  // a seller can't sign in there at all
  assert.equal((await login('seller@shop.test', 'secret123', SUPER)).status, 403);
  // an admin without 2-step login on is told to turn it on first
  const no2fa = await login('boss2@root.test', 'secret123', SUPER);
  assert.equal(no2fa.status, 403); assert.equal(no2fa.data.code, 'ADMIN_2FA_REQUIRED'); assert.ok(!no2fa.data.token);
  // the right password alone gives no token
  const noCode = await login('boss@root.test', 'secret123', SUPER);
  assert.equal(noCode.status, 200); assert.equal(noCode.data.twoFactorRequired, true); assert.ok(!noCode.data.token);
  assert.equal((await login('boss@root.test', 'secret123', SUPER, '000000')).status, 401);
  const ok = await login('boss@root.test', 'secret123', SUPER, totpCode(S.boss, 0));
  assert.equal(ok.status, 200); assert.ok(ok.data.token);
  T.bossSuper = ok.data.token;
  assert.equal(jwt.decode(T.bossSuper).aud, 'super');
  assert.ok(jwt.decode(T.bossSuper).exp - jwt.decode(T.bossSuper).iat <= 12 * 3600, 'admin sign-ins last 12 hours');
  assert.equal((await api('/admin/overview', 'GET', null, T.bossSuper, SUPER)).status, 200);
  const me = (await api('/me', 'GET', null, T.bossSuper, SUPER)).data;
  assert.equal(me.admin, true); assert.equal(me.adminLevel, 'owner');
  // admin sessions aren't extended
  assert.equal((await api('/auth/refresh', 'POST', {}, T.bossSuper, SUPER)).data.token, null);
});

test('an admin token is refused on the app and agency hosts; the admin API isn’t there', async () => {
  for (const h of [APP, AGENCY]) {
    const r = await api('/me', 'GET', null, T.bossSuper, h);
    assert.equal(r.status, 401); assert.equal(r.data.wrongHost, true);
    assert.equal((await api('/admin/overview', 'GET', null, T.bossSuper, h)).status, 404);
  }
  // the admin's own app sign-in works in the app, but not for the admin API (it lives on the super host now)
  const appTok = (await login('boss@root.test', 'secret123', APP, totpCode(S.boss, 1))).data.token;
  assert.equal(jwt.decode(appTok).aud, 'app');
  assert.equal((await api('/me', 'GET', null, appTok, APP)).status, 200);
  assert.equal((await api('/me', 'GET', null, appTok, APP)).data.admin, false);
  assert.equal((await api('/me', 'GET', null, appTok, APP)).data.adminUrl, 'https://super.test');
  assert.equal((await api('/admin/users', 'GET', null, appTok, APP)).status, 404);
  assert.equal((await api('/admin/partners', 'GET', null, appTok, APP)).status, 404);
  // …and the app token is refused on the super host
  assert.equal((await api('/admin/users', 'GET', null, appTok, SUPER)).status, 401);
});

test('an app token is refused on the super host, and agency and app sign-ins are separate', async () => {
  const seller = T['seller@shop.test']; // registered on 127.0.0.1: an app token
  assert.equal((await api('/me', 'GET', null, seller, APP)).status, 200);
  assert.equal((await api('/me', 'GET', null, seller, SUPER)).status, 401);
  assert.equal((await api('/me', 'GET', null, seller, AGENCY)).status, 401);
  const ag = (await login('seller@shop.test', 'secret123', AGENCY)).data.token;
  assert.equal(jwt.decode(ag).aud, 'agency');
  assert.equal((await api('/me', 'GET', null, ag, AGENCY)).status, 200);
  assert.equal((await api('/me', 'GET', null, ag, APP)).status, 401);
  assert.equal((await api('/me', 'GET', null, ag, SUPER)).status, 401);
});

test('the super host answers only admin, sign-in and health routes', async () => {
  assert.equal((await api('/funnels', 'GET', null, T.bossSuper, SUPER)).status, 404);
  assert.equal((await api('/settings', 'GET', null, T.bossSuper, SUPER)).status, 404);
  assert.equal((await api('/auth/register', 'POST', { email: 'new@x.test', password: 'Very-long-pass-1' }, null, SUPER)).status, 404);
  assert.equal((await api('/auth/google', 'POST', { credential: 'x' }, null, SUPER)).status, 404);
  assert.equal((await api('/auth/2fa/disable', 'POST', { code: '1' }, T.bossSuper, SUPER)).status, 404);
  assert.equal((await api('/templates', 'GET', null, null, SUPER)).status, 404);
  assert.equal((await api('/health', 'GET', null, null, SUPER)).status, 200);
  assert.equal((await api('/site', 'GET', null, null, SUPER)).status, 200);
  // a page that isn't the admin app (a funnel, a store) isn't served there either
  const r = await fetch(`${srv.base}/f/anything`, { headers: SUPER });
  assert.ok(!(await r.text()).includes('__FUNNEL__'));
  // with a client build, every page there is the admin app, marked as the super address (the app's marked as app)
  const page = await fetch(`${srv.base}/anything`, { headers: SUPER });
  if (page.status === 200) {
    assert.match(await page.text(), /<meta name="ff-tier" content="super" data-super="https:\/\/super\.test"/);
    assert.match(await (await fetch(`${srv.base}/login`, { headers: APP })).text(), /<meta name="ff-tier" content="app" data-super="https:\/\/super\.test" data-app="https:\/\/app\.test">/);
  }
});

test('ADMIN_IP_ALLOWLIST: the super host refuses other networks', async () => {
  assert.equal((await api('/admin/overview', 'GET', null, T.bossSuper, OUTSIDE)).status, 403);
  assert.equal((await login('boss@root.test', 'secret123', OUTSIDE, totpCode(S.boss, 2))).status, 403);
  assert.equal((await api('/admin/overview', 'GET', null, T.bossSuper, { ...SUPER, 'x-forwarded-for': '10.9.3.4' })).status, 200);
  // the app itself isn't limited
  assert.equal((await api('/me', 'GET', null, T['seller@shop.test'], { ...APP, 'x-forwarded-for': '8.8.8.8' })).status, 200);
});

test('tokens from before tiers existed (no aud) keep working on the app, not on the super host', async () => {
  const id = (await api('/me', 'GET', null, T['seller@shop.test'])).data.id;
  const old = jwt.sign({ id, pv: 0 }, 'test-secret', { expiresIn: '14d' });
  assert.equal((await api('/me', 'GET', null, old, APP)).status, 200);
  assert.equal((await api('/me', 'GET', null, old)).status, 200);
  assert.equal((await api('/me', 'GET', null, old, SUPER)).status, 401);
  // …and its refresh is an app token
  const fresh = (await api('/auth/refresh', 'POST', {}, old, APP)).data.token;
  assert.equal(jwt.decode(fresh).aud, 'app');
});

test('making an admin needs a second admin’s approval; admins can’t be opened with support access', async () => {
  ({ token: T.boss2, secret: S.boss2 } = await enable2fa(api, T['boss2@root.test']));
  T.boss2Super = (await login('boss2@root.test', 'secret123', SUPER, totpCode(S.boss2, 0))).data.token;
  assert.ok(T.boss2Super);
  const users = (await api('/admin/users', 'GET', null, T.bossSuper, SUPER)).data.users;
  for (const u of users) ids[u.email] = u.id;
  // with two admins on the platform, "make admin" is only a request
  const req1 = await api(`/admin/users/${ids['helper@shop.test']}/action`, 'POST', { action: 'make_admin', level: 'support' }, T.bossSuper, SUPER);
  assert.equal(req1.status, 200); assert.equal(req1.data.pending, true);
  assert.equal((await api(`/admin/users/${ids['helper@shop.test']}`, 'GET', null, T.bossSuper, SUPER)).data.admin, false);
  const rid = req1.data.request.id.replace('adminreq.', '');
  // the one who asked can't approve it
  assert.equal((await api(`/admin/admin-requests/${rid}/approve`, 'POST', {}, T.bossSuper, SUPER)).status, 403);
  assert.equal((await api('/admin/admin-requests', 'GET', null, T.boss2Super, SUPER)).data.length, 1);
  assert.equal((await api(`/admin/admin-requests/${rid}/approve`, 'POST', {}, T.boss2Super, SUPER)).status, 200);
  assert.equal((await api(`/admin/users/${ids['helper@shop.test']}`, 'GET', null, T.bossSuper, SUPER)).data.admin, true);
  assert.equal((await api(`/admin/admin-requests/${rid}/approve`, 'POST', {}, T.boss2Super, SUPER)).status, 404); // used up
  // admins can't log in as other admins
  const imp = await api(`/admin/users/${ids['boss2@root.test']}/action`, 'POST', { action: 'impersonate', reason: 'checking' }, T.bossSuper, SUPER);
  assert.equal(imp.status, 403);
  assert.equal((await api(`/admin/users/${ids['helper@shop.test']}/action`, 'POST', { action: 'impersonate', reason: 'checking' }, T.bossSuper, SUPER)).status, 403);
  // a seller can be, and the support token opens on the app's address
  const ok = await api(`/admin/users/${ids['seller@shop.test']}/action`, 'POST', { action: 'impersonate', reason: 'helping with checkout' }, T.bossSuper, SUPER);
  assert.equal(ok.status, 200); assert.equal(ok.data.openAt, 'https://app.test');
  assert.equal((await api('/me', 'GET', null, ok.data.token, APP)).data.impersonating, true);
  assert.equal((await api('/me', 'GET', null, ok.data.token, SUPER)).status, 401);
});

test('support admins can look and help, but not change the platform', async () => {
  const { secret } = await enable2fa(api, T['helper@shop.test']);
  const sup = (await login('helper@shop.test', 'secret123', SUPER, totpCode(secret, 0))).data.token;
  assert.ok(sup);
  assert.equal((await api('/me', 'GET', null, sup, SUPER)).data.adminLevel, 'support');
  assert.equal((await api('/admin/overview', 'GET', null, sup, SUPER)).status, 200);
  assert.equal((await api('/admin/users', 'GET', null, sup, SUPER)).status, 200);
  assert.equal((await api(`/admin/users/${ids['seller@shop.test']}/action`, 'POST', { action: 'impersonate', reason: 'support ticket 12' }, sup, SUPER)).status, 200);
  assert.equal((await api('/admin/settings', 'PUT', { announcement: 'hi' }, sup, SUPER)).status, 403);
  assert.equal((await api('/admin/restore', 'POST', { name: 'x' }, sup, SUPER)).status, 403);
  assert.equal((await api(`/admin/users/${ids['seller@shop.test']}/action`, 'POST', { action: 'delete', confirm: 'seller@shop.test' }, sup, SUPER)).status, 403);
  assert.equal((await api(`/admin/users/${ids['seller@shop.test']}/action`, 'POST', { action: 'make_admin' }, sup, SUPER)).status, 403);
  assert.equal((await api(`/admin/partners/${ids['seller@shop.test']}/wallet`, 'POST', { amount: 100 }, sup, SUPER)).status, 403);
});

test('the admin role needs a verified email', async () => {
  // an unverified account given the role (as a stale record might have) holds no admin rights
  const r = await register(api, 'unverified@shop.test');
  const id = (await api('/me', 'GET', null, r.token)).data.id;
  assert.equal((await api(`/admin/users/${id}/action`, 'POST', { action: 'make_admin' }, T.bossSuper, SUPER)).status, 400);
});

test('audit rows: admin actions, partner admin and agency client changes', async () => {
  // agency client accounts: create, invite, detach, delete
  const ag = T['seller@shop.test'];
  const c1 = (await api('/agency/clients', 'POST', { business: 'Client One' }, ag, APP)).data;
  const c2 = (await api('/agency/clients', 'POST', { business: 'Client Two' }, ag, APP)).data;
  assert.ok(c1.id && c2.id, 'agency clients created');
  const inv = (await api(`/agency/clients/${c1.id}/invite`, 'POST', { email: 'client.one@shop.test' }, ag, APP)).data;
  await api('/auth/reset', 'POST', { token: inv.token, password: 'Client-Pass-123' });
  assert.equal((await api(`/agency/clients/${c1.id}/detach`, 'POST', {}, ag, APP)).status, 200);
  assert.equal((await api(`/agency/clients/${c2.id}`, 'DELETE', { confirm: 'DELETE' }, ag, APP)).status, 200);
  // partner admin routes
  assert.equal((await api(`/admin/partners/${ids['seller@shop.test']}`, 'PUT', { perAccount: 499 }, T.bossSuper, SUPER)).status, 200);
  assert.equal((await api(`/admin/partners/${ids['seller@shop.test']}/wallet`, 'POST', { amount: 250, note: 'goodwill' }, T.bossSuper, SUPER)).status, 200);
  assert.equal((await api('/admin/partners/bill-now', 'POST', {}, T.bossSuper, SUPER)).status, 200);
  assert.equal((await api('/admin/accounts', 'POST', { email: 'made@shop.test', business: 'Made Co' }, T.bossSuper, SUPER)).status, 201);
  const log = (await api('/admin/audit', 'GET', null, T.bossSuper, SUPER)).data;
  const actions = new Set(log.map((a) => a.action));
  for (const a of ['make_admin_requested', 'make_admin_approved', 'impersonate', 'agency_client_create', 'agency_client_invite', 'agency_client_detach', 'agency_client_delete', 'partner_terms', 'partner_wallet', 'partner_bill_now', 'create_account']) assert.ok(actions.has(a), `audit has ${a}`);
  const del = log.find((a) => a.action === 'agency_client_delete');
  assert.equal(del.userId, c2.id); assert.equal(del.actor, 'seller@shop.test');
  assert.equal(log.find((a) => a.action === 'make_admin_approved').actor, 'boss2@root.test');
});

test('an agency working on its address opens a client there: the client session belongs to the agency address', async () => {
  const e = 'owner@agency-tier.test';
  await register(api, e); await verify(e);
  const ag = (await login(e, 'secret123', AGENCY)).data.token;
  assert.equal(jwt.decode(ag).aud, 'agency');
  const c = await api('/agency/clients', 'POST', { business: 'Tier Client' }, ag, AGENCY);
  assert.equal(c.status, 201, JSON.stringify(c.data));
  assert.equal(jwt.decode(c.data.token).aud, 'agency');
  const inClient = await api('/me', 'GET', null, c.data.token, AGENCY);
  assert.equal(inClient.status, 200);
  assert.equal(inClient.data.workspace?.ownerId, c.data.id, 'working inside the client account');
  assert.ok(inClient.data.agencyAccess, 'marked as agency access');
  assert.equal((await api('/me', 'GET', null, c.data.token, APP)).status, 401, 'not usable on the app address');
  const again = await api(`/agency/clients/${c.data.id}/enter`, 'POST', { reason: 'Checking the store setup' }, ag, AGENCY);
  assert.equal(again.status, 200, JSON.stringify(again.data));
  assert.equal((await api('/me', 'GET', null, again.data.token, AGENCY)).status, 200);
});
