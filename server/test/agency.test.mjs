// Agencies & freelancers: client accounts under the agency's plan (limits, switching in, inviting the client,
// handing over, deleting), white-label branding, copying a funnel with its automations and products to a client,
// export / import and share links, the signed client report, and the activity log.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, register } from './helpers.mjs';

let srv, api, A, me, f, client;
before(async () => {
  srv = await startServer({ APP_URL: 'https://app.example.in' });
  api = srv.api;
  A = (await register(api)).token;
  me = (await api('/me', 'GET', null, A)).data;
  await api('/settings', 'PUT', { businessName: 'Growth Agency' }, A);
  f = (await api('/templates/coding/use', 'POST', {}, A)).data;
});
after(() => srv.stop());

test('client accounts: trial allows 2; the agency works inside them; access follows the agency', async () => {
  assert.equal((await api('/agency/clients', 'POST', { business: '' }, A)).status, 400);
  const c1 = (await api('/agency/clients', 'POST', { business: 'Sharma Yoga' }, A)).data;
  await api('/agency/clients', 'POST', { business: 'Mehta Bakes' }, A);
  const third = await api('/agency/clients', 'POST', { business: 'Third' }, A);
  assert.equal(third.status, 402, 'the trial includes 2');
  assert.equal(third.data.upgrade, true);
  client = c1;
  // the returned token opens the client's workspace as its agency
  const me2 = (await api('/me', 'GET', null, c1.token)).data;
  assert.deepEqual([me2.workspace.name, me2.workspace.role], ['Sharma Yoga', 'agency']);
  assert.equal((await api('/billing', 'GET', null, c1.token)).status, 403, 'billing is the agency’s');
  assert.equal((await api('/team/members', 'GET', null, c1.token)).status, 200, 'the agency manages the client’s team');
  const fresh = (await api('/templates/yoga/use', 'POST', {}, c1.token)).data;
  assert.ok(fresh.id);
  const list = (await api('/agency', 'GET', null, A)).data;
  assert.deepEqual([list.used, list.limit], [2, 2]);
  assert.equal(list.clients.find((c) => c.id === c1.id).funnels, 1);
});

test('white-label: brand shows for the agency, its clients and on its own app domain', async () => {
  assert.equal((await api('/agency/white-label', 'PUT', { brand: 'GrowthOS', logo: 'javascript:1' }, A)).status, 400);
  const r = (await api('/agency/white-label', 'PUT', { brand: 'GrowthOS', primary: '#ff5500', supportEmail: 'help@growth.in', domain: 'https://app.growth.in/' }, A)).data;
  assert.equal(r.whiteLabel.domain, 'app.growth.in');
  assert.equal((await api('/me', 'GET', null, A)).data.brand, 'GrowthOS');
  assert.equal((await api('/me', 'GET', null, client.token)).data.brand, 'GrowthOS', 'inside a client account');
  const site = await (await fetch(`${srv.base}/api/site`, { headers: { 'x-forwarded-host': 'app.growth.in' } })).json();
  assert.equal(site.brand, 'GrowthOS');
  assert.equal((await fetch(`${srv.base}/api/domains/tls-check?domain=app.growth.in`)).status, 200, 'HTTPS certificate allowed');
  const other = (await register(api)).token;
  assert.equal((await api('/agency/white-label', 'PUT', { brand: 'X', domain: 'app.growth.in' }, other)).status, 409);
});

test('snapshots: copy a funnel with its automation and product to a client; export/import; share links', async () => {
  const prod = (await api('/products', 'POST', { name: 'Bootcamp Notes', links: [{ label: 'Notes', url: 'https://example.com/n' }] }, A)).data;
  const co = f.steps.find((s) => s.type === 'checkout');
  co.blocks.find((b) => b.type === 'checkout').props.productId = prod.id;
  f = (await api(`/funnels/${f.id}`, 'PUT', { steps: f.steps }, A)).data;
  await api('/automations', 'POST', { name: 'Buyer welcome', trigger: { type: 'purchase', funnelId: f.id }, steps: [{ type: 'tag', tag: 'buyer' }] }, A);
  const other = (await register(api)).token;
  const otherMe = (await api('/me', 'GET', null, other)).data;
  assert.equal((await api(`/funnels/${f.id}/copy-to`, 'POST', { accountId: otherMe.id }, A)).status, 403, 'only accounts you manage');
  const cp = (await api(`/funnels/${f.id}/copy-to`, 'POST', { accountId: client.id }, A)).data;
  assert.deepEqual([cp.products, cp.automations], [1, 1]);
  const inClient = (await api(`/funnels/${cp.id}`, 'GET', null, client.token)).data;
  const pid = inClient.steps.find((s) => s.type === 'checkout').blocks.find((b) => b.type === 'checkout').props.productId;
  assert.ok(pid && pid !== prod.id, 'points at the client’s own copy');
  assert.equal((await api(`/products/${pid}`, 'GET', null, client.token)).data.name, 'Bootcamp Notes');
  const autos = (await api('/automations', 'GET', null, client.token)).data.automations;
  assert.ok(autos.some((a) => a.name === 'Buyer welcome' && a.trigger.funnelId === cp.id && !a.active), 'paused, re-pointed');
  // export / import
  const snap = (await api(`/funnels/${f.id}/export`, 'GET', null, A)).data;
  assert.equal(snap.kind, 'funnelhive.snapshot');
  const imp = await api('/funnels/import', 'POST', { snapshot: snap }, other);
  assert.equal(imp.status, 201);
  assert.equal((await api('/funnels/import', 'POST', { snapshot: { kind: 'nope' } }, other)).status, 400);
  // share link (freelancer → client)
  const sh = (await api(`/funnels/${f.id}/share`, 'POST', {}, A)).data;
  const token = sh.url.split('/share/')[1];
  assert.equal((await api(`/share/${token}`)).data.name, f.name);
  assert.equal((await api(`/share/${token}/import`, 'POST', {}, other)).status, 201);
  await api(`/funnels/${f.id}/share`, 'DELETE', null, A);
  assert.equal((await api(`/share/${token}`)).status, 404, 'turned off');
});

test('client report link, activity log, inviting and handing over a client', async () => {
  const list = (await api('/agency', 'GET', null, A)).data;
  const rep = list.clients.find((c) => c.id === client.id).report;
  const r = (await api(rep.replace('/report/', '/report/'))).data;
  assert.equal(r.business, 'Sharma Yoga');
  assert.equal(r.brand, 'GrowthOS');
  assert.equal((await api(`/report/${client.id}.forged`)).status, 404);
  const act = (await api('/activity', 'GET', null, client.token)).data;
  assert.ok(act.some((a) => a.who.kind === 'agency' && /funnel/i.test(a.what)), JSON.stringify(act.slice(0, 3)));
  // hand over: needs the client to log in first
  assert.equal((await api(`/agency/clients/${client.id}/detach`, 'POST', {}, A)).status, 400);
  const inv = (await api(`/agency/clients/${client.id}/invite`, 'POST', { email: 'owner@sharmayoga.in' }, A)).data;
  const set = await api('/auth/reset', 'POST', { token: inv.token, password: 'yoga12345' });
  assert.equal(set.status, 200);
  const login = (await api('/auth/login', 'POST', { email: 'owner@sharmayoga.in', password: 'yoga12345' })).data;
  const cm = (await api('/me', 'GET', null, login.token)).data;
  assert.equal(cm.brand, 'GrowthOS');
  assert.equal(cm.billing.agencyManaged, true);
  assert.equal((await api(`/agency/clients/${client.id}/detach`, 'POST', {}, A)).data.ok, true);
  const after = (await api('/me', 'GET', null, login.token)).data;
  assert.equal(after.billing.status, 'trialing', 'their own trial now');
  assert.equal((await api('/agency', 'GET', null, A)).data.used, 1);
});
