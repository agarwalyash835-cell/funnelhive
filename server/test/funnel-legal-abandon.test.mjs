// Legal details per funnel (several brands in one workspace) and abandoned checkouts with only a phone number.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, register } from './helpers.mjs';

let srv, api, T, me, a, b;
before(async () => {
  srv = await startServer({ APP_URL: 'https://app.example.in' });
  api = srv.api;
  T = (await register(api)).token;
  me = (await api('/me', 'GET', null, T)).data;
  await api('/settings', 'PUT', { businessName: 'Sharma Yoga' }, T);
  a = (await api('/templates/coding/use', 'POST', {}, T)).data;
  b = (await api('/templates/coding/use', 'POST', {}, T)).data;
  for (const f of [a, b]) await api(`/funnels/${f.id}`, 'PUT', { published: true }, T);
});
after(() => srv.stop());

test('a funnel’s own legal details; the other funnel keeps the workspace’s', async () => {
  assert.equal((await api(`/funnels/${a.id}/legal`, 'PUT', { email: 'nope' }, T)).status, 400);
  assert.equal((await api(`/funnels/${a.id}/legal`, 'PUT', { businessName: 'X' }, (await register(api)).token)).status, 404, 'not their funnel');
  const r = (await api(`/funnels/${a.id}/legal`, 'PUT', { businessName: 'Code Academy Pvt Ltd' + ' '.repeat(5) + 'x'.repeat(200), refundDays: 14 }, T)).data;
  assert.equal(r.legal.businessName.length, 120, 'clipped');
  await api(`/funnels/${a.id}/legal`, 'PUT', { businessName: 'Code Academy Pvt Ltd', refundDays: 14 }, T);
  const pa = (await api(`/public/${a.slug}`)).data.privacy, pb = (await api(`/public/${b.slug}`)).data.privacy;
  assert.equal(pa.terms, `/legal/${me.id}/${a.id}/terms`);
  assert.equal(pb.terms, `/legal/${me.id}/terms`);
  const ta = await (await fetch(`${srv.base}${pa.terms}`)).text(), tb = await (await fetch(`${srv.base}${pb.terms}`)).text();
  assert.match(ta, /Code Academy Pvt Ltd/);
  assert.doesNotMatch(ta, /Sharma Yoga/);
  assert.match(tb, /Sharma Yoga/);
  assert.match(await (await fetch(`${srv.base}/legal/${me.id}/${a.id}/refund`)).text(), /within <b>14 days<\/b>/);
  assert.doesNotMatch(await (await fetch(`${srv.base}/legal/someone/${a.id}/terms`)).text(), /Code Academy/, 'only under its owner');
  // the editor's autosave doesn't drop it; clearing every field goes back to the workspace details
  await api(`/funnels/${a.id}`, 'PUT', { name: 'Renamed' }, T);
  assert.equal((await api(`/funnels/${a.id}`, 'GET', null, T)).data.legal.businessName, 'Code Academy Pvt Ltd');
  assert.equal((await api(`/funnels/${a.id}/legal`, 'PUT', { businessName: '', refundDays: '' }, T)).data.legal, null);
  assert.equal((await api(`/public/${a.slug}`)).data.privacy.terms, `/legal/${me.id}/terms`);
});

test('an abandoned checkout with only a phone number, recovered by a later order with that number', async () => {
  const co = b.steps.find((s) => s.type === 'checkout');
  await api(`/public/${b.slug}/abandon`, 'POST', { notice: true, stepId: co.id, phone: '12345' }); // not a phone number
  await api(`/public/${b.slug}/abandon`, 'POST', { notice: true, stepId: co.id, name: 'Ravi', phone: '98765 43210' });
  let d = (await api('/orders', 'GET', null, T)).data;
  assert.equal(d.abandoned.length, 1);
  assert.deepEqual([d.abandoned[0].email, d.abandoned[0].phone, d.abandoned[0].name], ['', '9876543210', 'Ravi']);
  await api(`/public/${b.slug}/abandon`, 'POST', { notice: true, stepId: co.id, name: 'Ravi K', phone: '9876543210' });
  assert.equal((await api('/orders', 'GET', null, T)).data.abandoned.length, 1, 'the same cart, not a second one');
  const o = await api(`/public/${b.slug}/order`, 'POST', { stepId: co.id, email: 'ravi@x.in', name: 'Ravi', phone: '+91 98765 43210' });
  assert.equal(o.status, 200, JSON.stringify(o.data));
  d = (await api('/orders', 'GET', null, T)).data;
  assert.equal(d.abandoned.length, 0, 'recovered by the phone number');
  await api(`/public/${b.slug}/abandon`, 'POST', { notice: true, stepId: co.id, phone: '9876543210' });
  assert.equal((await api('/orders', 'GET', null, T)).data.abandoned.length, 0, 'they already bought');
});
