// The seller's bell: orders and leads land as notifications; read state; nobody else sees them.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, register } from './helpers.mjs';

let srv, api, T, f;
before(async () => {
  srv = await startServer();
  api = srv.api;
  T = (await register(api)).token;
  f = (await api('/templates/yoga/use', 'POST', {}, T)).data;
  await api(`/funnels/${f.id}`, 'PUT', { published: true }, T);
});
after(() => srv.stop());

test('a checkout order notifies the seller (a demo checkout is marked as a test)', async () => {
  const co = f.steps.find((s) => s.type === 'checkout');
  assert.equal((await api(`/notifications`, 'GET', null, T)).data.unread, 0);
  await api(`/public/${f.slug}/order?preview=1`, 'POST', { stepId: co.id, email: 'pv@x.in' });
  assert.equal((await api(`/notifications`, 'GET', null, T)).data.items.length, 0, 'preview orders never notify');
  const o = await api(`/public/${f.slug}/order`, 'POST', { stepId: co.id, email: 'priya@x.in', name: 'Priya' });
  assert.equal(o.status, 200, JSON.stringify(o.data));
  const r = (await api('/notifications', 'GET', null, T)).data;
  assert.equal(r.unread, 1);
  const n = r.items[0];
  assert.equal(n.kind, 'order');
  assert.match(n.title, /^New order · ₹[\d,]+ · Priya \(test\)$/);
  assert.equal(n.link, '/orders');
  assert.equal((await api('/me', 'GET', null, T)).data.nav.unread, 1, '/me carries the count for the badge');
});

test('a lead notifies the seller with a link to the contact', async () => {
  await api(`/public/${f.slug}/lead`, 'POST', { stepId: f.steps[0].id, email: 'Lead@X.in', name: 'Asha' });
  const r = (await api('/notifications', 'GET', null, T)).data;
  assert.equal(r.unread, 2);
  const n = r.items.find((x) => x.kind === 'lead');
  assert.match(n.title, /^New lead · Asha · /);
  assert.equal(n.link, `/contacts/${encodeURIComponent('lead@x.in')}`);
});

test('marking read lowers the unread count; another seller can’t see or read them', async () => {
  const { items } = (await api('/notifications', 'GET', null, T)).data;
  const other = (await register(api)).token;
  assert.deepEqual((await api('/notifications', 'GET', null, other)).data, { items: [], unread: 0 });
  await api('/notifications/read', 'POST', { ids: items.map((n) => n.id) }, other);
  assert.equal((await api('/notifications', 'GET', null, T)).data.unread, 2, 'someone else’s ids are ignored');
  assert.equal((await api('/notifications', 'GET', null)).status, 401);

  assert.equal((await api('/notifications/read', 'POST', { ids: [items[0].id] }, T)).data.unread, 1);
  const r = (await api('/notifications', 'GET', null, T)).data;
  assert.equal(r.items.find((n) => n.id === items[0].id).read, true);
  assert.equal((await api('/notifications/read', 'POST', { all: true }, T)).data.unread, 0);
  assert.equal((await api('/me', 'GET', null, T)).data.nav.unread, 0);
});
