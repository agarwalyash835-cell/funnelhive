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

test('Cash on Delivery: upsells and the order confirmation open, what they paid for waits until the cash is collected', async () => {
  const C = (await api('/templates/yoga/use', 'POST', {}, T)).data;
  const steps = structuredClone(C.steps);
  const co = steps.find((s) => s.type === 'checkout');
  co.blocks = co.blocks.map((b) => (b.type === 'checkout' ? { ...b, props: { ...b.props, cod: true } } : b));
  const ty = steps.find((s) => s.type === 'thankyou');
  ty.blocks = [
    { id: 'conf', type: 'thankyou', props: { headline: 'Order confirmed', body: 'See you soon.', steps: [{ text: 'Join the group: https://chat.whatsapp.com/secretgroup' }, { text: 'Save our number' }] } },
    { id: 'vid', type: 'video', props: { url: 'https://youtu.be/secretlesson' } },
    { id: 'txt', type: 'text', props: { text: 'Your download: https://drive.example/secret-file' } },
    ...ty.blocks.filter((b) => b.type === 'crosssell'),
  ];
  await api(`/funnels/${C.id}`, 'PUT', { steps, published: true }, T);
  const order = await api(`/public/${C.slug}/cod`, 'POST', { stepId: co.id, email: 'cod@x.dev', name: 'Cod Buyer', phone: '9876543210', address: ADDR });
  assert.equal(order.status, 200, JSON.stringify(order.data));
  const open = (id, oid = order.data.orderId) => api(`/public/${C.slug}/step/${id}?o=${oid}`);

  const up = steps.find((s) => s.type === 'upsell');
  assert.ok((await open(up.id)).data.blocks.length, 'the upsell offer opens for a COD order');
  const page = await open(ty.id);
  assert.equal(page.status, 200);
  assert.ok(!/secretgroup|secretlesson|secret-file/.test(JSON.stringify(page.data)), 'no paid content before the cash is collected');
  assert.equal(page.data.awaitingPayment, true);
  const conf = page.data.blocks.find((b) => b.id === 'conf');
  assert.equal(conf.props.headline, 'Order confirmed', 'the order confirmation still shows');
  assert.match(conf.props.steps[0].text, /access once your payment is received/);
  assert.ok(conf.props.steps.some((s) => s.text === 'Save our number'));

  // the seller marks it paid: everything opens
  assert.equal((await api(`/orders/${order.data.orderId}/cod`, 'POST', { action: 'paid' }, T)).status, 200);
  const paid = await open(ty.id);
  assert.match(JSON.stringify(paid.data), /secretgroup[\s\S]*secretlesson[\s\S]*secret-file/);
  assert.equal(paid.data.awaitingPayment, undefined);

  // a seller can say the page holds nothing paid
  const order2 = (await api(`/public/${C.slug}/cod`, 'POST', { stepId: co.id, email: 'cod2@x.dev', name: 'Cod Two', phone: '9876543211', address: ADDR })).data;
  assert.ok(!/secretlesson/.test(JSON.stringify((await open(ty.id, order2.orderId)).data)));
  const s2 = structuredClone((await api(`/funnels/${C.id}`, 'GET', null, T)).data.steps);
  s2.find((s) => s.id === ty.id).codFull = 'yes';
  await api(`/funnels/${C.id}`, 'PUT', { steps: s2 }, T);
  assert.equal((await api(`/funnels/${C.id}`, 'GET', null, T)).data.steps.find((s) => s.id === ty.id).codFull, true);
  assert.match(JSON.stringify((await open(ty.id, order2.orderId)).data), /secretlesson/);
});
