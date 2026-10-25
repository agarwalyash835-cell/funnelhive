// The account hierarchy, checked as a matrix: super admin → partner (white-label admin) → sub-account owner →
// the sub-account's team. Each level reaches only what it's given: admin tools only for the platform's admin with
// 2-step login; partner tools only for partners' owners; a sub-account can't become an agency; team members never
// reach billing, partner tools or admin; nobody reaches another branch of the tree.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, register, enable2fa } from './helpers.mjs';

let srv, api;
const A = {}; // actors: name → token
let partnerId, subId, otherSubId;
before(async () => {
  srv = await startServer({ ADMIN_EMAILS: 'boss@root.test,boss2@root.test' });
  api = srv.api;
  const verify = async (email, token) => { const m = srv.log().match(new RegExp(`To: ${email.replace(/[.@]/g, (c) => `\\${c}`)}[\\s\\S]*?/verify\\?token=([a-f0-9.]+)`)); if (m) await api('/auth/verify', 'POST', { token: m[1] }); return token; };
  A.super = (await enable2fa(api, await verify('boss@root.test', (await register(api, 'boss@root.test')).token))).token;
  A.adminNo2fa = await verify('boss2@root.test', (await register(api, 'boss2@root.test')).token);
  A.partner = (await register(api, 'partner@agency.test')).token;
  partnerId = (await api('/me', 'GET', null, A.partner)).data.id;
  assert.equal((await api(`/admin/partners/${partnerId}`, 'PUT', { perAccount: 499, creditRate: 20 }, A.super)).status, 200);
  await api('/partner/resale', 'PUT', { plans: [{ name: 'Basic', monthly: 999, credits: 100 }] }, A.partner);
  A.agency = (await register(api, 'plain@agency.test')).token; // an agency that isn't a partner
  A.seller = (await register(api, 'solo@seller.test')).token; // an independent seller
  // the partner's sub-account, its owner signs in
  const sub = (await api('/partner/accounts', 'POST', { email: 'owner@sub.test', name: 'Sub Owner', business: 'Sub Co' }, A.partner)).data;
  subId = sub.id;
  await api('/auth/reset', 'POST', { token: sub.token, password: 'Sub-Passw0rd-1' });
  A.sub = (await api('/auth/login', 'POST', { email: 'owner@sub.test', password: 'Sub-Passw0rd-1' })).data.token;
  const other = (await api('/partner/accounts', 'POST', { email: 'owner@other.test', business: 'Other Co' }, A.partner)).data;
  otherSubId = other.id;
  // the partner's own team member (built-in admin), acting in the partner's workspace
  const pm = await register(api, 'staff@agency.test');
  const pinv = (await api('/team/invite', 'POST', { email: 'staff@agency.test', role: 'admin' }, A.partner)).data;
  A.partnerStaff = (await api('/team/accept', 'POST', { token: pinv.token }, pm.token)).data.token;
  // the sub-account's team: a custom role that may only view the CRM, and a built-in viewer
  const role = (await api('/team/roles', 'POST', { name: 'Telecaller', perms: { crm: 'view' } }, A.sub)).data;
  const tc = await register(api, 'caller@sub.test');
  const tinv = (await api('/team/invite', 'POST', { email: 'caller@sub.test', role: role.id }, A.sub)).data;
  A.subCaller = (await api('/team/accept', 'POST', { token: tinv.token }, tc.token)).data.token;
  const vw = await register(api, 'viewer@sub.test');
  const vinv = (await api('/team/invite', 'POST', { email: 'viewer@sub.test', role: 'viewer' }, A.sub)).data;
  A.subViewer = (await api('/team/accept', 'POST', { token: vinv.token }, vw.token)).data.token;
});
after(() => srv?.stop());

const status = async (who, method, path, body) => (await api(path, method, body ?? (method === 'GET' ? null : {}), A[who])).status;
const ok = (s) => s >= 200 && s < 300;
async function only(allowed, method, path, body) {
  for (const who of Object.keys(A)) {
    const s = await status(who, method, path, typeof body === 'function' ? body() : body);
    if (allowed.includes(who)) assert.ok(ok(s), `${who} should reach ${method} ${path} (got ${s})`);
    else assert.ok(!ok(s), `${who} must NOT reach ${method} ${path} (got ${s})`);
  }
}

test('super admin tools: only the platform admin, and only with 2-step login', async () => {
  for (const p of ['/admin/overview', '/admin/users', '/admin/settings', '/admin/partners', '/admin/audit', '/admin/ai-usage']) await only(['super'], 'GET', p);
  await only(['super'], 'GET', `/admin/partners/${partnerId}/clients`);
  await only(['super'], 'POST', `/admin/partners/${partnerId}/wallet`, { amount: 10, note: 'test' });
  let n = 0;
  await only(['super'], 'POST', '/admin/accounts', () => ({ type: 'user', email: `made${n++}@x.test` }));
  assert.equal((await api('/admin/overview', 'GET', null, A.adminNo2fa)).data.code, 'ADMIN_2FA_REQUIRED', 'an admin without 2-step login is asked to turn it on');
  // only the real admin is told it's an admin
  for (const who of Object.keys(A)) assert.equal(!!(await api('/me', 'GET', null, A[who])).data.admin, who === 'super' || who === 'adminNo2fa', who);
});

test('an admin “logged in as” a seller has none of the admin powers', async () => {
  const sellerId = (await api('/me', 'GET', null, A.seller)).data.id;
  const as = (await api(`/admin/users/${sellerId}/action`, 'POST', { action: 'impersonate', reason: 'support check' }, A.super)).data.token;
  assert.ok(as);
  assert.equal((await api('/me', 'GET', null, as)).data.admin, false);
  assert.ok(!ok((await api('/admin/overview', 'GET', null, as)).status));
  assert.ok(!ok((await api('/admin/accounts', 'POST', { email: 'x9@x.test' }, as)).status));
});

test('partner tools: only partners’ owners — not their staff, plain agencies, sub-accounts or sellers', async () => {
  await only(['partner'], 'PUT', '/partner/resale', { plans: [{ id: undefined, name: 'Basic', monthly: 999, credits: 100 }] });
  let n = 0;
  await only(['partner'], 'POST', '/partner/accounts', () => ({ email: `sub${n++}@new.test`, business: 'New' }));
  await only(['partner'], 'POST', `/partner/clients/${subId}/credits`, { credits: 10 });
  for (const who of Object.keys(A)) {
    const d = (await api('/partner', 'GET', null, A[who])).data;
    assert.equal(!!d.enabled, who === 'partner', `${who} sees partner tools`);
  }
});

test('a sub-account can’t act as an agency or partner: no clients, no white-label, no agency page', async () => {
  assert.equal(await status('sub', 'GET', '/agency'), 404);
  assert.ok(!ok(await status('sub', 'POST', '/agency/clients', { business: 'Nested' })));
  assert.ok(!ok(await status('sub', 'PUT', '/agency/white-label', { brand: 'Mine' })));
  assert.ok(!ok(await status('sub', 'POST', '/partner/accounts', { email: 'n@x.test', business: 'N' })));
  // its plan page shows its partner's plans
  assert.equal((await api('/partner-billing', 'GET', null, A.sub)).data.resold, true);
  // a plain agency and an independent seller keep their agency page (the Agency plan upsell)
  assert.equal(await status('agency', 'GET', '/agency'), 200);
});

test('team members never reach billing, partner tools, admin or team management unless given it', async () => {
  for (const who of ['partnerStaff', 'subCaller', 'subViewer']) {
    for (const [m, p] of [['GET', '/billing'], ['GET', '/partner'], ['GET', '/partner-billing'], ['POST', '/partner/accounts'], ['GET', '/admin/overview'], ['POST', '/account/delete'], ['GET', '/account/export'], ['POST', '/team/invite']]) {
      assert.ok(!ok(await status(who, m, p, m === 'GET' ? null : { email: 'z@z.test', role: 'viewer' })), `${who} ${m} ${p}`);
    }
  }
  // the custom role sees exactly its area: CRM read-only, nothing else
  assert.ok(ok(await status('subCaller', 'GET', '/contacts')));
  assert.ok(!ok(await status('subCaller', 'POST', '/contacts', { email: 'new@lead.in', name: 'New' })));
  for (const p of ['/funnels', '/orders', '/settings', '/vault', '/automations', '/team/roles']) assert.ok(!ok(await status('subCaller', 'GET', p)), `subCaller GET ${p}`);
  const me = (await api('/me', 'GET', null, A.subCaller)).data;
  assert.equal(me.workspace.custom, true);
  assert.equal(me.perms.crm, 'view');
  assert.equal(me.perms.funnels || 'none', 'none');
});

test('nobody reaches another branch of the tree', async () => {
  // the partner works inside its own sub-accounts; a plain agency or another seller can't switch into them
  assert.ok(ok((await api('/team/switch', 'POST', { ownerId: subId }, A.partner)).status), 'the partner opens its sub-account');
  for (const who of ['agency', 'seller', 'sub']) assert.ok(!ok(await status(who, 'POST', '/team/switch', { ownerId: who === 'sub' ? otherSubId : subId })), `${who} can’t switch into a sub-account`);
  assert.ok(!ok(await status('sub', 'POST', '/team/switch', { ownerId: partnerId })), 'a sub-account can’t open its partner');
  // a sub-account owner can't touch a sibling's plan, and the partner can't touch another partner's accounts
  assert.ok(!ok(await status('sub', 'PUT', `/partner/clients/${otherSubId}/plan`, { planId: 'x', status: 'comped' })));
  const p2 = (await api('/admin/accounts', 'POST', { type: 'partner', email: 'second@partner.test' }, A.super)).data;
  await api('/auth/reset', 'POST', { token: p2.token, password: 'Second-Passw0rd-1' });
  const P2 = (await api('/auth/login', 'POST', { email: 'second@partner.test', password: 'Second-Passw0rd-1' })).data.token;
  assert.equal((await api(`/partner/clients/${subId}/plan`, 'PUT', { planId: 'x', status: 'comped' }, P2)).status, 404);
  assert.equal((await api(`/partner/clients/${subId}/credits`, 'POST', { credits: 5 }, P2)).status, 404);
  assert.equal((await api('/partner', 'GET', null, P2)).data.clients.length, 0);
  assert.equal((await api('/team/switch', 'POST', { ownerId: subId }, P2)).status >= 400, true);
});
