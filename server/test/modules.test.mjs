// Industry tools (modules.js): an account's CRM style hides the tools its industry doesn't use; the platform admin
// (or the account's agency) can switch one back on. The industry alone decides: data from an earlier industry doesn't
// keep a tool in the menu (it's kept, and comes back with the tool).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, register, enable2fa } from './helpers.mjs';

let srv, api, ADMIN;
before(async () => {
  srv = await startServer({ ADMIN_EMAILS: 'owner@mods.test' });
  api = srv.api;
  ADMIN = (await register(api, 'owner@mods.test')).token;
  const link = srv.log().match(/To: owner@mods\.test[\s\S]*?\/verify\?token=([a-f0-9.]+)/);
  await api('/auth/verify', 'POST', { token: link[1] });
  ADMIN = (await enable2fa(api, ADMIN)).token;
});
after(() => srv?.stop());

const hidden = async (tok) => (await api('/me', 'GET', null, tok)).data.nav.hidden;

test('no CRM style yet: every tool shows; Coach & creator: the coaching tools only', async () => {
  const T = (await register(api)).token;
  assert.deepEqual(await hidden(T), []);
  await api('/crm/kit', 'POST', { id: 'general' }, T);
  assert.deepEqual((await hidden(T)).sort(), ['/counter', '/inventory', '/quotes', '/store', '/tally']);
});

test('real estate hides courses, store, webinars and products; the admin can switch one back on', async () => {
  const T = (await register(api)).token, id = (await api('/me', 'GET', null, T)).data.id;
  await api('/crm/kit', 'POST', { id: 'realestate' }, T);
  assert.deepEqual((await hidden(T)).sort(), ['/counter', '/inventory', '/products', '/school', '/store', '/tally', '/webinars']);
  // the admin panel shows what the industry decides and switches webinars on for this account
  const seen = (await api(`/admin/users/${id}`, 'GET', null, ADMIN)).data.modules;
  assert.equal(seen.industry, 'realestate');
  assert.deepEqual(seen.modules.filter((m) => !m.shown).map((m) => m.page).sort(), ['/counter', '/inventory', '/products', '/school', '/store', '/tally', '/webinars']);
  const r = await api(`/admin/users/${id}/action`, 'POST', { action: 'set_modules', pages: ['/webinars', '/not-a-module'] }, ADMIN);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.deepEqual((await hidden(T)).sort(), ['/counter', '/inventory', '/products', '/school', '/store', '/tally']);
  // switching back off: empty list = by industry
  await api(`/admin/users/${id}/action`, 'POST', { action: 'set_modules', pages: [] }, ADMIN);
  assert.ok((await hidden(T)).includes('/webinars'));
  // a seller can't switch it on for themselves
  assert.equal((await api(`/admin/users/${id}/action`, 'POST', { action: 'set_modules', pages: ['/webinars'] }, T)).status, 403);
});

test('the industry decides: a tool with data from before is hidden after switching (its data is kept)', async () => {
  const T = (await register(api)).token;
  const p = await api('/products', 'POST', { name: 'Site visit guide' }, T);
  assert.ok(p.status < 300, JSON.stringify(p.data));
  await api('/crm/kit', 'POST', { id: 'realestate' }, T);
  const h = await hidden(T);
  assert.ok(h.includes('/products'), 'not a real-estate tool: hidden even with a product in it');
  assert.ok(h.includes('/school') && h.includes('/store'));
  assert.equal((await api('/products', 'GET', null, T)).data.products?.length ?? (await api('/products', 'GET', null, T)).data.length, 1, 'the product is still there');
});
