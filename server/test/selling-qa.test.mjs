// Selling-stack regressions: a quote's ticked add-ons don't stick to a different line after the seller edits it;
// a refund of [1, 1] refunds the item once; a damaged funnel file is refused (or cleaned) instead of breaking the
// funnels list; a seller's "$$" / "$'" in their copy reaches the live page as typed.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer, register } from './helpers.mjs';

const built = fs.existsSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../../client/dist-ssr/entry-server.js'));
let srv, api, T;
before(async () => { srv = await startServer(); api = srv.api; T = (await register(api)).token; });
after(() => srv.stop());

test('quote: an add-on the client ticked is dropped once it stops being an add-on, and never ticks a new line', async () => {
  const q = (await api('/quotes', 'POST', { title: 'Website', client: { name: 'Asha', email: 'asha@example.in' }, items: [{ name: 'Build', price: 10000 }, { name: 'SEO', price: 3000, optional: true }] }, T)).data;
  const t = new URL(q.link).searchParams.get('t');
  assert.equal((await api(`/q/${q.id}/options`, 'POST', { t, selected: [1] })).data.total, 13000);
  // the seller makes SEO a fixed line, then adds a different add-on at the same place
  let s = (await api(`/quotes/${q.id}`, 'PUT', { items: [{ name: 'Build', price: 10000 }, { name: 'SEO', price: 3000 }] }, T)).data;
  assert.deepEqual(s.selected, []);
  s = (await api(`/quotes/${q.id}`, 'PUT', { items: [{ name: 'Build', price: 10000 }, { name: 'Logo', price: 5000, optional: true }] }, T)).data;
  assert.deepEqual(s.selected, []);
  assert.equal(s.total, 10000, 'the new add-on is not pre-ticked for the client');
});

test('refund: the same item listed twice is refunded once', async () => {
  const f = (await api('/funnels', 'POST', { name: 'Refund twice' }, T)).data;
  const steps = [{ ...f.steps[0] }, { id: 'chk', name: 'Checkout', type: 'checkout', slug: 'checkout', blocks: [{ id: 'c1', type: 'checkout', props: { productName: 'Course', price: 1000, bumpEnabled: true, bumpTitle: 'Workbook', bumpPrice: 200 } }] }];
  assert.equal((await api(`/funnels/${f.id}`, 'PUT', { steps, published: true }, T)).status, 200);
  const o = (await api(`/public/${f.slug}/order`, 'POST', { stepId: 'chk', withBump: true, email: 'ravi@example.in', name: 'Ravi', phone: '9876543210' })).data;
  assert.equal(o.total, 1200);
  const r = await api(`/orders/${o.orderId}/refund`, 'POST', { items: [1, 1, '1'] }, T);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.order.refunded, 200);
  assert.equal(r.data.order.total, 1000);
  assert.equal(r.data.order.refunds.length, 1);
  assert.equal(r.data.order.status, 'partially_refunded');
});

test('import: a damaged funnel file is refused in plain words; stray sections are dropped', async () => {
  const snap = (steps) => ({ snapshot: { kind: 'funnelhive.snapshot', version: 1, funnel: { name: 'Imported', theme: 'x', steps } } });
  const bad = await api('/funnels/import', 'POST', snap([{ name: 'Home', blocks: 'oops' }]), T);
  assert.equal(bad.status, 400);
  assert.match(bad.data.error, /damaged/);
  assert.equal((await api('/funnels/import', 'POST', snap([null]), T)).status, 400);
  const ok = await api('/funnels/import', 'POST', snap([{ blocks: [null, 7, { type: 'text', props: { text: 'नमस्ते' } }, { type: 'text', props: 'x' }] }]), T);
  assert.equal(ok.status, 201, JSON.stringify(ok.data));
  const f = (await api(`/funnels/${ok.data.id}`, 'GET', null, T)).data;
  assert.equal(f.steps[0].blocks.length, 1);
  assert.equal(f.steps[0].blocks[0].props.text, 'नमस्ते');
  assert.equal(f.steps[0].slug, 'page-1');
  assert.equal(f.steps[0].name, 'Page 1');
  assert.deepEqual(f.theme, {});
  assert.equal((await api('/funnels', 'GET', null, T)).status, 200, 'the funnels list still loads');
});

test('one-click upsell: taking the same offer twice is refused (demo and Cash on Delivery orders)', async () => {
  const f = (await api('/funnels', 'POST', { name: 'Upsell twice' }, T)).data;
  const steps = [{ ...f.steps[0] },
    { id: 'chk', name: 'Checkout', type: 'checkout', slug: 'checkout', blocks: [{ id: 'c1', type: 'checkout', props: { productName: 'Kurta', price: 999, cod: true, shipping: 'address' } }] },
    { id: 'up', name: 'Upsell', type: 'upsell', slug: 'upsell', blocks: [{ id: 'o1', type: 'offer', props: { productName: 'Dupatta', price: 299 } }] }];
  assert.equal((await api(`/funnels/${f.id}`, 'PUT', { steps, published: true }, T)).status, 200);
  const buyer = { email: 'meera@example.in', name: 'Meera', phone: '9876543210', address: { line1: '12 MG Road', city: 'Pune', state: 'Maharashtra', pincode: '411001' } };
  // demo checkout
  const o = (await api(`/public/${f.slug}/order`, 'POST', { stepId: 'chk', ...buyer })).data;
  assert.ok(o.orderId, JSON.stringify(o));
  assert.equal((await api(`/public/${f.slug}/order`, 'POST', { stepId: 'up', orderId: o.orderId })).data.total, 1298);
  const again = await api(`/public/${f.slug}/order`, 'POST', { stepId: 'up', orderId: o.orderId });
  assert.equal(again.status, 409);
  assert.equal(again.data.error, 'This is already in your order');
  // Cash on Delivery: the one-click offer joins the COD order once
  const c = (await api(`/public/${f.slug}/cod`, 'POST', { stepId: 'chk', ...buyer })).data;
  assert.ok(c.orderId, JSON.stringify(c));
  const u1 = await api(`/public/${f.slug}/pay/start`, 'POST', { stepId: 'up', orderId: c.orderId });
  assert.equal(u1.data.provider, 'cod', JSON.stringify(u1.data));
  assert.equal(u1.data.total, 1298);
  assert.equal((await api(`/public/${f.slug}/pay/start`, 'POST', { stepId: 'up', orderId: c.orderId })).status, 409);
});

test('live page: "$$" and "$\'" in the seller\'s copy are shown as typed', { skip: !built && 'client not built' }, async () => {
  const f = (await api('/funnels', 'POST', { name: 'Dollars' }, T)).data;
  const steps = structuredClone(f.steps);
  steps[0].blocks[0].props.headline = "Make $$ online — $' and $& too";
  assert.equal((await api(`/funnels/${f.id}`, 'PUT', { steps, published: true }, T)).status, 200);
  const html = await (await fetch(`${srv.base}/f/${f.slug}`)).text();
  assert.match(html, /<title>Make \$\$ online — \$&#39; and \$&amp; too<\/title>/);
  assert.equal(html.split('window.__FUNNEL__=').length, 2, 'one page payload');
  assert.equal(html.split('</html>').length, 2, 'the page isn\'t duplicated into itself');
  assert.ok(html.includes('"headline":"Make $$ online — $\' and $& too"'));
});
