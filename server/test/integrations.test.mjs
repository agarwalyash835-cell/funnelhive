// Coupons (limits & rules), settings validation, webhook address guard, purchase amounts for pixels.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, register } from './helpers.mjs';

let srv, api, T, f, co, up;
before(async () => {
  // private addresses blocked, exactly like production
  srv = await startServer({ WEBHOOK_ALLOW_PRIVATE: '0' });
  api = srv.api;
  T = (await register(api)).token;
  f = (await api('/templates/yoga/use', 'POST', {}, T)).data;
  await api(`/funnels/${f.id}`, 'PUT', { published: true }, T);
  co = f.steps.find((s) => s.type === 'checkout');
  up = f.steps.find((s) => s.type === 'upsell');
});
after(() => srv.stop());
const order = (body) => api(`/public/${f.slug}/order`, 'POST', { stepId: co.id, ...body });
const price = () => Number(co.blocks.find((b) => b.type === 'checkout').props.price);

test('coupon values: % between 1 and 100, ₹ positive; discounts never exceed the price', async () => {
  for (const [type, value] of [['percent', 150], ['percent', 0], ['flat', -500], ['flat', 'abc']]) {
    assert.equal((await api('/coupons', 'POST', { code: `BAD${type}${value}`, type, value }, T)).status, 400, `${type} ${value} refused`);
  }
  const full = (await api('/coupons', 'POST', { code: 'FREE100', type: 'percent', value: 100 }, T)).data;
  assert.equal((await api(`/coupons/${full.id}`, 'PUT', { value: 500 }, T)).status, 400, 'edits are validated too');
  const r = (await order({ email: 'free@x.dev', coupon: 'FREE100' })).data;
  assert.equal(r.total, 0);
  await api('/coupons', 'POST', { code: 'HUGEFLAT', type: 'flat', value: 999999 }, T);
  const r2 = (await order({ email: 'flat@x.dev', coupon: 'hugeflat' })).data;
  assert.equal(r2.total, 0, 'flat discount capped at the price — never negative');
});

test('coupon rules: expiry, usage limit, minimum order, once per customer, funnel restriction', async () => {
  await api('/coupons', 'POST', { code: 'OLD', type: 'percent', value: 10, expiresAt: '2020-01-01' }, T);
  let c = (await api(`/public/${f.slug}/coupon`, 'POST', { code: 'OLD', stepId: co.id })).data;
  assert.deepEqual([c.valid, c.reason], [false, 'This code has expired']);
  assert.equal((await order({ email: 'old@x.dev', coupon: 'OLD' })).status, 400, 'expired code at payment → error, not a silent full charge');

  await api('/coupons', 'POST', { code: 'TWICE', type: 'flat', value: 50, maxUses: 2 }, T);
  assert.equal((await order({ email: 'a1@x.dev', coupon: 'TWICE' })).status, 200);
  assert.equal((await order({ email: 'a2@x.dev', coupon: 'TWICE' })).status, 200);
  c = (await api(`/public/${f.slug}/coupon`, 'POST', { code: 'TWICE' })).data;
  assert.equal(c.reason, 'This code has reached its usage limit');

  await api('/coupons', 'POST', { code: 'BIGBUY', type: 'percent', value: 10, minOrder: price() + 1 }, T);
  c = (await api(`/public/${f.slug}/coupon`, 'POST', { code: 'BIGBUY', stepId: co.id })).data;
  assert.match(c.reason, /minimum order/);

  await api('/coupons', 'POST', { code: 'ONCE', type: 'percent', value: 10, oncePerCustomer: true }, T);
  assert.equal((await order({ email: 'Repeat@x.dev', coupon: 'ONCE' })).status, 200);
  c = (await api(`/public/${f.slug}/coupon`, 'POST', { code: 'ONCE', email: 'repeat@x.dev' })).data;
  assert.equal(c.reason, 'You’ve already used this code');
  assert.equal((await order({ email: 'repeat@x.dev', coupon: 'ONCE' })).status, 400);
  assert.equal((await order({ email: 'new@x.dev', coupon: 'ONCE' })).status, 200, 'other customers can still use it');

  const other = (await api('/funnels', 'POST', { name: 'Other' }, T)).data;
  await api('/coupons', 'POST', { code: 'ONLYOTHER', type: 'percent', value: 10, funnelIds: [other.id, 'not-mine'] }, T);
  const list = (await api('/coupons', 'GET', null, T)).data;
  assert.deepEqual(list.find((x) => x.code === 'ONLYOTHER').funnelIds, [other.id], 'only own funnels kept');
  c = (await api(`/public/${f.slug}/coupon`, 'POST', { code: 'ONLYOTHER' })).data;
  assert.equal(c.reason, 'This code can’t be used for this product');
});

test('pixels get the amount of each sale, with a unique id per sale', async () => {
  const a = (await order({ email: 'pix@x.dev' })).data;
  assert.equal(a.added, a.total);
  const b = (await api(`/public/${f.slug}/order`, 'POST', { stepId: up.id, orderId: a.orderId })).data;
  assert.equal(b.total, a.total + b.added, 'order total is cumulative…');
  assert.ok(b.added > 0 && b.added < b.total, '…but the upsell event reports only the upsell');
  assert.notEqual(a.txn, b.txn);
});

test('settings: pixel IDs validated, unknown keys ignored', async () => {
  assert.equal((await api('/settings', 'PUT', { tracking: { fbPixel: '<script>' } }, T)).status, 400);
  assert.equal((await api('/settings', 'PUT', { tracking: { ga4: 'UA-123' } }, T)).status, 400);
  const s = (await api('/settings', 'PUT', { tracking: { fbPixel: '123456789012345', ga4: 'g-abc1234' }, isAdmin: true, webhookSecret: 'mine' }, T)).data;
  assert.equal(s.tracking.ga4, 'G-ABC1234');
  assert.equal(s.isAdmin, undefined);
  assert.notEqual(s.webhookSecret, 'mine');
});

test('webhooks: private / internal addresses are refused', async () => {
  for (const url of ['http://169.254.169.254/latest/meta-data', 'http://127.0.0.1:8080/x', 'http://localhost/x', 'http://10.0.0.5/hook', 'http://[::1]/x', 'ftp://example.com/x', 'not a url', 'http://user:pw@example.com/']) {
    const r = await api('/settings', 'PUT', { webhookUrl: url }, T);
    assert.equal(r.status, 400, `${url} refused`);
  }
  assert.equal((await api('/settings', 'GET', null, T)).data.webhookUrl, '', 'nothing was saved');
  assert.equal((await api('/settings', 'PUT', { webhookUrl: '' }, T)).status, 200, 'clearing is fine');
});
