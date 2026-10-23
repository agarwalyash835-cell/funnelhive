// Locked steps: upsell, downsell and thank-you pages keep their content on the server until the visitor shows an
// order from this funnel (after a checkout) or a sign-up pass (after an opt-in). The editor's preview sees everything,
// and a seller can keep a step open on purpose.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, register } from './helpers.mjs';

const ADDR = { line1: '4 Park Street', city: 'Kolkata', state: 'West Bengal', pincode: '700016' };
let srv, api, T, f;
before(async () => {
  srv = await startServer();
  api = srv.api;
  T = (await register(api)).token;
  f = (await api('/templates/yoga/use', 'POST', {}, T)).data;
  await api(`/funnels/${f.id}`, 'PUT', { published: true }, T);
});
after(() => srv?.stop());

test('paid steps: empty for strangers (data and server-rendered page), opened by an order from this funnel', async () => {
  const pub = (await api(`/public/${f.slug}`)).data;
  const co = pub.steps.find((s) => s.type === 'checkout');
  const later = pub.steps.filter((s) => ['upsell', 'downsell', 'thankyou'].includes(s.type));
  assert.ok(later.length >= 2, 'the template has an upsell and a thank-you page');
  for (const s of later) { assert.equal(s.locked, 'paid'); assert.deepEqual(s.blocks, []); }
  assert.ok(co.blocks.length && !co.locked, 'the checkout itself is open');
  const ty = later.find((s) => s.type === 'thankyou');
  const secret = f.steps.find((s) => s.id === ty.id).blocks[0].id;
  const html = await (await fetch(`${srv.base}/f/${f.slug}/${ty.slug}`)).text();
  assert.ok(!html.includes(secret), 'the server-rendered page holds none of it either');

  const open = (q = '') => api(`/public/${f.slug}/step/${ty.id}${q}`);
  assert.equal((await open()).status, 403);
  assert.equal((await open('?o=nope&p=paid.9999999999999.forgedforgedforgedforg')).status, 403, 'a made-up order or pass opens nothing');
  const order = (await api(`/public/${f.slug}/order`, 'POST', { stepId: co.id, email: 'buyer@x.dev', address: ADDR })).data;
  assert.ok(order.orderId, JSON.stringify(order));
  const full = await open(`?o=${order.orderId}`);
  assert.equal(full.status, 200);
  assert.ok(full.data.blocks.some((b) => b.id === secret));

  // an order from another funnel doesn't open this one
  const g = (await api('/templates/yoga/use', 'POST', {}, T)).data;
  await api(`/funnels/${g.id}`, 'PUT', { published: true }, T);
  const gco = g.steps.find((s) => s.type === 'checkout');
  const other = (await api(`/public/${g.slug}/order`, 'POST', { stepId: gco.id, email: 'buyer@x.dev', address: ADDR })).data;
  assert.equal((await open(`?o=${other.orderId}`)).status, 403);

  // the editor's preview (with its key) sees everything; ?preview=1 alone doesn't
  const key = (await api(`/funnels/${f.id}`, 'GET', null, T)).data.previewKey;
  assert.ok((await api(`/public/${f.slug}?preview=1&pv=${key}`)).data.steps.find((s) => s.id === ty.id).blocks.length);
  assert.deepEqual((await api(`/public/${f.slug}?preview=1`)).data.steps.find((s) => s.id === ty.id).blocks, []);
});

test('a step the seller keeps open, and a thank-you page after a sign-up opened by the pass', async () => {
  const steps = structuredClone((await api(`/funnels/${f.id}`, 'GET', null, T)).data.steps);
  const ty = steps.find((s) => s.type === 'thankyou');
  ty.open = true;
  await api(`/funnels/${f.id}`, 'PUT', { steps }, T);
  assert.ok((await api(`/public/${f.slug}`)).data.steps.find((s) => s.id === ty.id).blocks.length, 'open: shown to everyone');

  // a lead funnel: opt-in page, then thank-you
  const L = (await api('/funnels', 'POST', { name: 'Lead magnet' }, T)).data;
  const optin = { id: 'o1', name: 'Opt-in', slug: 'free-guide', type: 'optin', blocks: [{ id: 'b1', type: 'optin', props: { title: 'Get the guide' } }] };
  const thanks = { id: 't1', name: 'Thanks', slug: 'thanks', type: 'thankyou', blocks: [{ id: 'b2', type: 'text', props: { text: 'Download: https://drive.example/secret-guide' } }] };
  await api(`/funnels/${L.id}`, 'PUT', { steps: [optin, thanks], published: true }, T);
  const lp = (await api(`/public/${L.slug}`)).data;
  assert.equal(lp.steps[1].locked, 'lead');
  assert.ok(!JSON.stringify(lp).includes('secret-guide'));
  assert.equal((await api(`/public/${L.slug}/step/t1`)).status, 403);
  const lead = (await api(`/public/${L.slug}/lead`, 'POST', { email: 'reader@x.dev', name: 'Reader', stepId: 'o1' })).data;
  assert.ok(lead.pass, JSON.stringify(lead));
  const got = await api(`/public/${L.slug}/step/t1?p=${encodeURIComponent(lead.pass)}`);
  assert.equal(got.status, 200);
  assert.match(JSON.stringify(got.data), /secret-guide/);
  // a pass is only good for its own funnel
  assert.equal((await api(`/public/${f.slug}/step/${steps.find((s) => s.type === 'upsell').id}?p=${encodeURIComponent(lead.pass)}`)).status, 403);
});
