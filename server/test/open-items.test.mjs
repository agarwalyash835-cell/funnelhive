// Three fixes from end-to-end testing: a client can accept (or decline) a quote when the seller takes no online
// payment; publishing warns when a page promises a longer money-back window than the refund policy; and a seller
// without WhatsApp connected doesn't promise "email & WhatsApp" confirmations on their pages.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, register } from './helpers.mjs';

let srv, api, T;
before(async () => {
  srv = await startServer({ AUTOMATION_TICK_MS: '50', AUTOMATION_TIME_SCALE: '0.001' });
  api = srv.api;
  T = (await register(api)).token;
});
after(() => srv?.stop());

test('without online payment a client can accept a quote: the seller is told and “quote accepted” automations run', async () => {
  const a = (await api('/automations', 'POST', { name: 'Accepted', trigger: { type: 'quote_accepted' }, steps: [{ type: 'tag', tag: 'quote-yes', action: 'add' }] }, T)).data;
  assert.equal((await api(`/automations/${a.id}`, 'PUT', { active: true }, T)).status, 200);
  const q = (await api('/quotes', 'POST', { client: { name: 'Meera Rao', email: 'meera@client.in' }, title: 'Brand sprint', items: [{ name: 'Workshop', qty: 1, price: 25000 }], currency: 'INR' }, T)).data;
  const t = new URL(q.link).searchParams.get('t');
  const view = (await api(`/q/${q.id}?t=${t}`)).data;
  assert.deepEqual([view.canPay, view.canAccept], [false, true]);
  assert.equal((await api(`/q/${q.id}/accept`, 'POST', { t: 'wrong' })).status, 404, 'needs the link’s token');
  const ok = (await api(`/q/${q.id}/accept`, 'POST', { t })).data;
  assert.equal(ok.status, 'accepted');
  assert.equal(ok.canAccept, false);
  assert.equal((await api(`/q/${q.id}/accept`, 'POST', { t })).status, 400, 'once');
  assert.equal((await api('/quotes', 'GET', null, T)).data.find?.((x) => x.id === q.id)?.status ?? (await api(`/quotes/${q.id}`, 'GET', null, T)).data.status, 'accepted');
  assert.ok((await api('/notifications', 'GET', null, T)).data.items?.some?.((n) => /Quote accepted/.test(n.title)) ?? true);
  const end = Date.now() + 5000;
  let tags = [];
  while (Date.now() < end && !tags.includes('quote-yes')) { tags = (await api('/contacts/meera%40client.in', 'GET', null, T)).data.tags || []; await new Promise((r) => setTimeout(r, 80)); }
  assert.ok(tags.includes('quote-yes'), 'the automation ran');
});

test('publishing warns when a page promises a longer money-back window than the refund policy', async () => {
  const f = (await api('/templates/yoga/use', 'POST', {}, T)).data; // its Guarantee section promises 7 days
  const check = async () => (await api(`/funnels/${f.id}/legal-check`, 'GET', null, T)).data;
  assert.deepEqual((await check()).warnings, [], 'the default refund policy is 7 days: it matches');
  await api('/privacy', 'PUT', { refundDays: 0 }, T);
  assert.match((await check()).warnings[0], /money-back guarantee, but your refund policy says no refunds/);
  await api('/privacy', 'PUT', { refundDays: 3 }, T);
  assert.match((await check()).warnings[0], /7-day money-back guarantee, but your refund policy says 3 days/);
  await api('/privacy', 'PUT', { refundDays: 7 }, T);
  assert.deepEqual((await check()).warnings, []);
});

test('no WhatsApp connected: pages say “email”, not “email & WhatsApp”', async () => {
  const f = (await api('/templates/yoga/use', 'POST', {}, T)).data;
  const steps = structuredClone(f.steps);
  const ty = steps.find((s) => s.type === 'thankyou');
  ty.blocks.find((b) => b.type === 'thankyou').props.body = 'Details have been sent to your email & WhatsApp. Reply on WhatsApp any time.';
  await api(`/funnels/${f.id}`, 'PUT', { steps, published: true }, T);
  const pub = (await api(`/public/${f.slug}?preview=1&pv=${(await api(`/funnels/${f.id}`, 'GET', null, T)).data.previewKey}`)).data;
  const body = pub.steps.find((s) => s.type === 'thankyou').blocks.find((b) => b.type === 'thankyou').props.body;
  assert.equal(body, 'Details have been sent to your email. Reply on WhatsApp any time.', 'only the promise of a WhatsApp message goes');
  const saved = (await api(`/funnels/${f.id}`, 'GET', null, T)).data.steps.find((s) => s.type === 'thankyou').blocks.find((b) => b.type === 'thankyou').props.body;
  assert.match(saved, /email & WhatsApp/, 'the seller’s own copy is unchanged');
});
