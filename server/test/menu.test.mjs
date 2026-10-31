// The sidebar: it starts from the business's industry (its CRM kit) or its agency's default; each person's own
// layout is saved on their account, per workspace; only the agency owner sets the client menu. Menus never grant access.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, register } from './helpers.mjs';

let srv, api, owner, agency, viewer, clientId, clientTok;
before(async () => {
  srv = await startServer();
  api = srv.api;
  owner = (await register(api, 'clinic@menu.test')).token;
  agency = (await register(api, 'agency@menu.test')).token;
  const vw = await register(api, 'viewer@menu.test');
  const inv = (await api('/team/invite', 'POST', { email: 'viewer@menu.test', role: 'viewer' }, owner)).data;
  viewer = (await api('/team/accept', 'POST', { token: inv.token }, vw.token)).data.token;
});
after(() => srv?.stop());

test('the menu starts from the industry; a person’s layout is their own and only keeps known pages', async () => {
  assert.equal((await api('/me', 'GET', null, owner)).data.nav.industry, null, 'no industry picked: the standard menu');
  assert.equal((await api('/crm/kit', 'POST', { id: 'clinic' }, owner)).status, 200);
  assert.equal((await api('/me', 'GET', null, owner)).data.nav.industry, 'clinic');
  const r = await api('/me/menu', 'PUT', { pinned: ['/quotes', '/admin', 'x'], hidden: ['/ads'], closed: ['Sell', '<b>'] }, owner);
  assert.equal(r.status, 200);
  assert.deepEqual(r.data, { pinned: ['/quotes'], hidden: ['/ads'], closed: ['Sell'] });
  assert.deepEqual((await api('/me', 'GET', null, owner)).data.nav.prefs.pinned, ['/quotes']);
  // a read-only member saves their own layout, which doesn't touch the owner's
  assert.equal((await api('/me/menu', 'PUT', { pinned: ['/webinars'] }, viewer)).status, 200);
  assert.deepEqual((await api('/me', 'GET', null, viewer)).data.nav.prefs.pinned, ['/webinars']);
  assert.deepEqual((await api('/me', 'GET', null, owner)).data.nav.prefs.pinned, ['/quotes']);
  // pinning a page never opens it: the viewer still can't open the vault
  assert.ok((await api('/vault', 'GET', null, viewer)).status >= 400);
});

test('an agency sets its clients’ menu; clients, members and plain accounts can’t', async () => {
  const c = await api('/agency/clients', 'POST', { business: 'Client Co' }, agency); // a trial's client slot
  assert.ok(c.data.id, JSON.stringify(c.data));
  clientId = c.data.id;
  assert.equal((await api('/agency/client-menu', 'PUT', { pages: ['/contacts', '/bookings', '/admin'] }, agency)).data.clientMenu.join(), '/contacts,/bookings');
  clientTok = c.data.token; // creating a client opens it (an agency-access session)
  assert.deepEqual((await api('/me', 'GET', null, clientTok)).data.nav.clientMenu, ['/contacts', '/bookings']);
  assert.ok((await api('/agency/client-menu', 'PUT', { pages: ['/funnels'] }, clientTok)).status >= 400, 'not from inside a client');
  assert.equal((await api('/agency/client-menu', 'PUT', { pages: [] }, agency)).data.clientMenu, null, 'empty = back to by industry');
});

test('members can’t set a client menu', async () => {
  assert.equal((await api('/agency/client-menu', 'PUT', { pages: ['/funnels'] }, viewer)).status, 403);
});
