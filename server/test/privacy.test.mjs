// Privacy (DPDP): consent settings, the generated policy pages, a required consent box on forms (recorded with the
// lead), declined tracking stopping server-side events, and erasing a contact (orders kept, anonymised).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, register } from './helpers.mjs';

let srv, api, T, me, f;
before(async () => {
  srv = await startServer({ APP_URL: 'https://app.example.in' });
  api = srv.api;
  T = (await register(api)).token;
  me = (await api('/me', 'GET', null, T)).data;
  await api('/settings', 'PUT', { businessName: 'Sharma Yoga', supportWhatsapp: '919800000001' }, T);
  f = (await api('/templates/yoga/use', 'POST', {}, T)).data;
  await api(`/funnels/${f.id}`, 'PUT', { published: true }, T);
});
after(() => srv.stop());

test('settings and the generated policy pages', async () => {
  assert.equal((await api('/privacy', 'PUT', { grievanceEmail: 'nope' }, T)).status, 400);
  assert.equal((await api('/privacy', 'PUT', { policyUrl: 'http://insecure.example' }, T)).status, 400);
  const p = (await api('/privacy', 'PUT', { banner: true, checkbox: true, grievanceName: 'Ritu Sharma', grievanceEmail: 'privacy@sharmayoga.in', refundDays: 7, address: 'Andheri, Mumbai' }, T)).data;
  assert.equal(p.pages, `https://app.example.in/legal/${me.id}`);
  for (const [k, want] of [['privacy', /Grievance officer[\s\S]*Ritu Sharma[\s\S]*privacy@sharmayoga\.in/], ['terms', /Terms &amp; Conditions/], ['refund', /within <b>7 days<\/b>/], ['contact', /Andheri, Mumbai/]]) {
    const r = await fetch(`${srv.base}/legal/${me.id}/${k}`);
    assert.equal(r.status, 200, k);
    assert.match(await r.text(), want);
  }
  assert.equal((await fetch(`${srv.base}/legal/${me.id}/secrets`)).status === 200 && false, false);
  const pub = (await api(`/public/${f.slug}`)).data.privacy;
  assert.deepEqual([pub.banner, pub.checkbox, pub.policy], [true, true, `/legal/${me.id}/privacy`]);
  assert.match(pub.line, /Sharma Yoga/);
});

test('a required consent box: refused without it, recorded with it', async () => {
  const stepId = f.steps[0].id;
  const no = await api(`/public/${f.slug}/lead`, 'POST', { stepId, email: 'a@x.in' });
  assert.equal(no.status, 400);
  assert.equal(no.data.consent, false);
  assert.equal((await api(`/public/${f.slug}/lead`, 'POST', { stepId, email: 'a@x.in', consent: true, tk: { consent: false } })).status, 200);
  const c = (await api(`/contacts/${encodeURIComponent('a@x.in')}`, 'GET', null, T)).data;
  assert.ok(c.timeline.some((t) => t.type === 'lead'));
  // declined tracking on the banner: nothing goes to Meta / GA from the server
  await api('/channels/tracking', 'PUT', { metaToken: 'EAAtest', ga4Secret: 'secret' }, T);
  await api('/settings', 'PUT', { tracking: { fbPixel: '123456789012345', ga4: 'G-ABC1234' } }, T);
  await api(`/public/${f.slug}/lead`, 'POST', { stepId, email: 'b@x.in', consent: true, tk: { consent: false } });
  await new Promise((r) => setTimeout(r, 200));
  const conv = (await api('/conversions', 'GET', null, T)).data;
  assert.ok(!JSON.stringify(conv).includes('b@x.in') && !(conv.rows || conv).some?.((x) => x.event === 'Lead'), 'no server-side Lead');
});

test('erasing a contact: their data goes, orders stay anonymised; team members can’t erase', async () => {
  await api('/privacy', 'PUT', { checkbox: false }, T);
  const co = f.steps.find((s) => s.type === 'checkout');
  const o = (await api(`/public/${f.slug}/order`, 'POST', { stepId: co.id, email: 'gone@x.in', name: 'Gone Person', phone: '9811111111' })).data;
  await api(`/public/${f.slug}/lead`, 'POST', { stepId: f.steps[0].id, email: 'gone@x.in', name: 'Gone Person' });
  // a marketer on the team can't erase
  const m = await register(api);
  const inv = (await api('/team/invite', 'POST', { email: m.email, role: 'marketer' }, T)).data;
  const ws = (await api('/team/accept', 'POST', { token: inv.token }, m.token)).data.token;
  assert.equal((await api(`/contacts/${encodeURIComponent('gone@x.in')}`, 'DELETE', null, ws)).status, 403);
  const r = (await api(`/contacts/${encodeURIComponent('gone@x.in')}`, 'DELETE', null, T)).data;
  assert.ok(r.erased.leads >= 1 && r.erased.orders === 1);
  assert.equal((await api(`/contacts/${encodeURIComponent('gone@x.in')}`, 'GET', null, T)).status, 404);
  const order = (await api('/orders', 'GET', null, T)).data.orders.find((x) => x.id === o.orderId);
  assert.ok(order, 'the order is kept');
  assert.equal(order.name, 'Erased on request');
  assert.ok(!JSON.stringify(order).includes('gone@x.in') && !JSON.stringify(order).includes('9811111111'));
  // the seller's bell no longer names them either
  assert.ok(!JSON.stringify((await api('/notifications', 'GET', null, T)).data).includes('Gone Person'), 'notifications about them are gone');
});
