// Dashboard & Analytics revenue is real money, the same as the Orders page: test orders (test keys, or placed
// with no payment provider), unpaid COD and cancelled orders don't count; refunds come off; sample-data orders
// still count. Orders saved before the paid / net columns existed are filled in when the database opens.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ff-revenue-'));
const now = Date.now();
const DAY = 86400000;

// a database from before: the orders table without the paid / net columns
const old = new DatabaseSync(path.join(process.env.DATA_DIR, 'funnelhive.db'));
old.exec('CREATE TABLE orders (id TEXT PRIMARY KEY, userId, funnelId, ckey, visitor, source, total, inr, at, demo, data TEXT NOT NULL)');
const ins = old.prepare('INSERT INTO orders (id, userId, funnelId, ckey, visitor, source, total, inr, at, demo, data) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
for (const o of [
  { id: 'old-live', userId: 'u1', funnelId: 'f1', source: 'direct', total: 100, status: 'paid', provider: 'razorpay', mode: 'live', items: [{ name: 'Course', kind: 'main', price: 100 }], at: now - 2 * DAY },
  { id: 'old-test', userId: 'u1', funnelId: 'f1', source: 'direct', total: 900, status: 'paid', items: [{ name: 'Course', kind: 'main', price: 900 }], at: now - 2 * DAY },
]) ins.run(o.id, o.userId, o.funnelId, null, null, o.source, o.total, o.total, o.at, 0, JSON.stringify(o));
old.close();

const { T } = await import('../db.js');
const A = await import('../analytics.js');

const item = (price, kind = 'main', extra = {}) => ({ name: kind, kind, price, ...extra });
const at = now - DAY;
const live = { provider: 'razorpay', mode: 'live', status: 'paid' };
for (const o of [
  { id: 'paid', funnelId: 'f1', total: 1000, items: [item(1000)], source: 'instagram', attr: { utm_source: 'facebook', utm_campaign: 'diwali' }, ...live },
  { id: 'test-keys', funnelId: 'f1', total: 500, items: [item(500)], source: 'instagram', attr: { utm_source: 'facebook', utm_campaign: 'diwali' }, provider: 'razorpay', mode: 'test', status: 'paid' },
  { id: 'no-provider', funnelId: 'f1', total: 700, items: [item(700), item(99, 'bump')], source: 'direct', status: 'paid' },
  { id: 'demo', funnelId: 'f2', total: 300, items: [item(300)], source: 'direct', status: 'paid', demo: true },
  { id: 'cod-due', funnelId: 'f2', total: 400, items: [item(400)], source: 'direct', status: 'cod', paymentMethod: 'cod' },
  { id: 'cod-collected', funnelId: 'f2', total: 250, items: [item(250)], source: 'direct', status: 'paid', paymentMethod: 'cod' },
  { id: 'cod-cancelled', funnelId: 'f2', total: 0, cancelledAmount: 600, items: [item(600, 'main', { refunded: { at, cod: true } })], source: 'direct', status: 'cancelled', paymentMethod: 'cod' },
  // ₹1,000 order, the ₹200 bump refunded: total is already down to 800
  { id: 'part-refund', funnelId: 'f1', total: 800, refunded: 200, items: [item(800), item(200, 'bump', { refunded: { at } })], source: 'instagram', attr: { utm_source: 'facebook', utm_campaign: 'diwali' }, ...live, status: 'partially_refunded' },
  // a refunded test order: its refund isn't real money either
  { id: 'test-refund', funnelId: 'f1', total: 0, refunded: 500, items: [item(500, 'main', { refunded: { at } })], source: 'direct', provider: 'razorpay', mode: 'test', status: 'refunded' },
  { id: 'usd', funnelId: 'f1', total: 10, currency: 'USD', fx: 80, items: [item(10)], source: 'direct', provider: 'stripe', mode: 'live', status: 'paid' },
]) T.orders.insert({ userId: 'u1', email: `${o.id}@x.in`, at, ...o });

const from = now - 7 * DAY, to = now + 1;
const scope = { userId: 'u1' };

test('orders saved before the paid / net columns are filled in on start', () => {
  assert.equal(T.orders.count({ paid: 1, funnelId: 'f1', source: 'direct', at: { lt: now - 1.5 * DAY } }), 1, 'the old live order counts, the old test order not');
  assert.equal(T.orders.count({ net: 900 }), 0);
});

test('totals: real money only — no test orders, unpaid COD, cancelled orders; refunds off; demo orders count', () => {
  const t = A.totals(scope, from, to);
  // 100 (old live) + 1000 + 300 (demo) + 250 (COD collected) + 800 (after refund) + 800 (USD 10 × 80)
  assert.equal(t.revenue, 3250);
  assert.equal(t.orders, 6);
  assert.equal(t.aov, Math.round(3250 / 6));
  const f1 = A.totalsByFunnel('u1', from, to);
  assert.deepEqual([f1('f1').revenue, f1('f1').orders, f1('f2').revenue, f1('f2').orders], [2700, 4, 550, 2]);
  const s = A.series(scope, now - 7 * DAY, 8, 0);
  assert.equal(s.reduce((a, d) => a + d.revenue, 0), 3250);
  assert.equal(s.reduce((a, d) => a + d.orders, 0), 6);
  const src = A.sources(scope, from);
  assert.deepEqual(src.find((x) => x.source === 'instagram'), { source: 'instagram', views: 0, leads: 0, orders: 2, revenue: 1800 });
});

test('offer mix, campaigns, refunds and bump rate leave test orders out', () => {
  const k = A.revenueByKind(scope, from);
  assert.equal(k.main, 100 + 1000 + 300 + 250 + 800 + 800);
  assert.equal(k.bump, 0, 'the test order’s bump and the refunded bump don’t count');
  const c = A.campaigns(scope, from, to).find((x) => x.campaign === 'diwali');
  assert.deepEqual([c.orders, c.revenue, c.refunded], [2, 1800, 200]);
  assert.equal(A.refundsTotal(scope, from, to), 200);
  assert.equal(A.bumpRate('f1', from), Math.round((1 / 4) * 100), 'one of the four real f1 orders had a bump');
});

test('the numbers follow the order: COD collected, a refund, a test order', () => {
  T.orders.update('cod-due', (o) => { o.status = 'paid'; });
  assert.equal(A.totals(scope, from, to).revenue, 3650);
  T.orders.update('paid', (o) => { o.refunded = 1000; o.total = 0; o.status = 'refunded'; });
  assert.equal(A.totals(scope, from, to).revenue, 2650);
  assert.equal(A.refundsTotal(scope, from, to), 1200);
});
