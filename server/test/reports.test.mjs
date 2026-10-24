// Revenue reports (/api/reports): the totals are the sum of the real orders (test orders and unpaid COD left out),
// refunds and refund rate, buyers and cohorts, lifetime value, recurring revenue, and each account sees only its own.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startServer, register } from './helpers.mjs';

const r2 = (n) => Math.round(n * 100) / 100;
const isTest = (o) => o.mode === 'test' || (!o.provider && !o.demo && o.paymentMethod !== 'cod' && o.total > 0 && !['cod', 'cancelled'].includes(o.status));
const realPaid = (o) => !isTest(o) && !['cod', 'cancelled'].includes(o.status);

let srv, api, T, T2, f, orders;
before(async () => {
  srv = await startServer();
  api = srv.api;
  T = (await register(api)).token;
  T2 = (await register(api)).token;
  assert.equal((await api('/demo/seed', 'POST', {}, T)).status, 200);
  // a funnel of our own: one order with no payment provider (a test order) and one Cash on Delivery not yet collected
  f = (await api('/templates/coding/use', 'POST', {}, T)).data;
  for (const s of f.steps) for (const b of s.blocks) if (b.type === 'checkout') Object.assign(b.props, { currency: '₹', price: 5000, billing: '', planEnabled: false, shipping: '', cod: true, bumpEnabled: false });
  f = (await api(`/funnels/${f.id}`, 'PUT', { steps: f.steps, published: true }, T)).data;
  const co = f.steps.find((s) => s.type === 'checkout');
  assert.equal((await api(`/public/${f.slug}/order`, 'POST', { stepId: co.id, email: 'tester@x.in', name: 'Test Buyer' })).status, 200);
  const cod = await api(`/public/${f.slug}/cod`, 'POST', { stepId: co.id, email: 'cod@x.in', name: 'COD Buyer', phone: '9876543210' });
  assert.equal(cod.status, 200, JSON.stringify(cod.data));
  // a refund of a real (sample) order
  const list = (await api('/orders', 'GET', null, T)).data.orders;
  const demo = list.find((o) => o.demo && o.items.length > 1);
  assert.equal((await api(`/orders/${demo.id}/refund`, 'POST', { items: [0], reason: 'test' }, T)).status, 200);
  orders = (await api('/orders', 'GET', null, T)).data.orders;
});
after(() => srv.stop());

test('totals are the sum of the real orders: test orders and unpaid COD left out, refunds off', async () => {
  assert.ok(orders.some((o) => o.email === 'tester@x.in' && isTest(o)), 'the order without a provider is a test order');
  assert.ok(orders.some((o) => o.email === 'cod@x.in' && o.status === 'cod'), 'the COD order is still unpaid');
  const real = orders.filter(realPaid);
  const r = (await api('/reports?days=all', 'GET', null, T)).data;
  const o = r.overview;
  const net = r2(real.reduce((s, x) => s + x.total * (x.fx || 1), 0)), refunds = r2(real.reduce((s, x) => s + (x.refunded || 0) * (x.fx || 1), 0));
  assert.equal(o.orders, real.length);
  assert.equal(o.net, net);
  assert.equal(o.refunds, refunds);
  assert.ok(o.refunds > 0, 'the refund counts');
  assert.equal(o.gross, r2(net + refunds), 'gross = net + refunds');
  assert.equal(o.refundRate, Math.round((refunds / (net + refunds)) * 1000) / 10, 'refund rate = refunds / gross');
  assert.equal(o.buyers, new Set(real.map((x) => x.email.toLowerCase())).size);
  assert.equal(o.aov, r2(net / real.length));
  assert.equal(o.perBuyer, r2(net / o.buyers));
  assert.equal(o.newBuyers + o.returningBuyers, o.buyers);
  assert.equal(o.newBuyers, o.buyers, 'over all time every buyer is new');
  // the same money, split by funnel, product and source
  for (const rows of [r.byFunnel, r.products, r.sources]) {
    assert.equal(r2(rows.reduce((s, x) => s + x.net, 0)), net);
    assert.equal(rows.reduce((s, x) => s + x.orders, 0), real.length);
  }
  assert.ok(!r.byFunnel.some((x) => x.id === f.id), 'our funnel only has a test order and unpaid COD');
  assert.ok(!r.ltv.top.some((x) => ['tester@x.in', 'cod@x.in'].includes(x.email)));
  // offer mix: items add up to the money, and add-ons are bumps / upsells / downsells / cross-sells
  assert.equal(r2(Object.values(o.kinds).reduce((s, v) => s + v, 0)), net);
  assert.equal(o.addOnRevenue, r2(['bump', 'upsell', 'downsell', 'crosssell'].reduce((s, k) => s + (o.kinds[k] || 0), 0)));
  assert.equal(r2(r.series.reduce((s, x) => s + x.net, 0)), net);
  assert.equal(o.prev, null);
});

test('cohorts add up to the buyers; lifetime value is net revenue per buyer', async () => {
  const r = (await api('/reports?days=all', 'GET', null, T)).data;
  assert.ok(r.cohorts.rows.length >= 1);
  assert.equal(r.cohorts.rows.reduce((s, x) => s + x.buyers, 0), r.overview.buyers, 'every buyer is in exactly one cohort');
  for (const row of r.cohorts.rows) {
    assert.equal(row.cells.length, 12);
    const seen = row.cells.filter(Boolean);
    for (let i = 1; i < seen.length; i++) assert.ok(seen[i].ltv >= seen[i - 1].ltv && seen[i].repeat >= seen[i - 1].repeat, 'cumulative');
  }
  // revenue per buyer at the latest month, times the cohort, is all the cohort's money
  const total = r.cohorts.rows.reduce((s, x) => s + x.cells.filter(Boolean).at(-1).ltv * x.buyers, 0);
  // (each cohort's per-buyer value is rounded to the paisa, so the sum may be off by up to half a paisa per buyer)
  const slack = r.cohorts.rows.reduce((s, x) => s + x.buyers * 0.005, 0) + r.cohorts.rows.length;
  assert.ok(Math.abs(total - r.overview.net) <= slack, `${total} vs ${r.overview.net}`);
  assert.equal(r.ltv.buyers, r.overview.buyers);
  assert.equal(r.ltv.total, r.overview.net);
  assert.equal(r.ltv.avg, r2(r.overview.net / r.overview.buyers));
  assert.equal(r.ltv.byFunnel.reduce((s, x) => s + x.buyers, 0), r.ltv.buyers);
  assert.ok(r.ltv.top.length > 0 && r.ltv.top.length <= 10);
  assert.ok(r.ltv.top.every((x, i, a) => !i || a[i - 1].total >= x.total), 'highest first');
  const best = r.ltv.top[0], theirs = orders.filter((o) => realPaid(o) && o.email.toLowerCase() === best.key);
  assert.equal(best.total, r2(theirs.reduce((s, o) => s + o.total * (o.fx || 1), 0)));
  assert.equal(best.orders, theirs.length);
});

test('periods, the funnel filter and the parts of the report', async () => {
  const r30 = (await api('/reports?days=30', 'GET', null, T)).data;
  const since = r30.period.from;
  const real30 = orders.filter((o) => realPaid(o) && o.at >= since);
  assert.equal(r30.overview.orders, real30.length);
  assert.ok(r30.overview.prev && r30.overview.prev.orders > 0, 'the 30 days before');
  assert.equal(r30.series.length, 30);
  const demoF = r30.byFunnel[0];
  const one = (await api(`/reports?days=30&funnel=${demoF.id}`, 'GET', null, T)).data;
  assert.equal(one.overview.net, demoF.net);
  assert.deepEqual(one.byFunnel.map((x) => x.id), [demoF.id]);
  const ymd = (t) => new Date(t + 330 * 60000).toISOString().slice(0, 10);
  const custom = (await api(`/reports?from=${ymd(since)}&to=${ymd(Date.now())}`, 'GET', null, T)).data;
  assert.equal(custom.overview.net, r30.overview.net, 'a custom range of the same days');
  const part = (await api('/reports/overview?days=30', 'GET', null, T)).data;
  assert.deepEqual(part.overview, r30.overview);
  assert.equal(part.cohorts, undefined);
  assert.ok(Array.isArray((await api('/reports/cohorts?days=30', 'GET', null, T)).data.cohorts.rows));
  assert.equal((await api('/reports/nope', 'GET', null, T)).status, 404);
  assert.equal((await api('/reports')).status, 401);
});

test('another account sees none of it', async () => {
  const funnelId = (await api('/reports?days=all', 'GET', null, T)).data.byFunnel[0].id;
  for (const qs of ['days=all', `days=all&funnel=${funnelId}`]) {
    const r = (await api(`/reports?${qs}`, 'GET', null, T2)).data;
    assert.deepEqual([r.overview.orders, r.overview.net, r.overview.buyers, r.cohorts.rows.length, r.ltv.top.length, r.byFunnel.length, r.products.length], [0, 0, 0, 0, 0, 0, 0]);
    assert.deepEqual(r.funnels, []);
  }
});

// recurring revenue, renewals in the cohorts and new vs returning buyers, on orders written straight to a database
test('memberships, instalments, renewals and returning buyers', async () => {
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ff-reports-'));
  const { T: DB } = await import('../db.js');
  const R = await import('../reports.js');
  const DAY = 86400000, now = Date.now(), live = { provider: 'razorpay', mode: 'live', status: 'paid', userId: 'u1', funnelId: 'f1', source: 'direct' };
  const item = (price, kind = 'main', extra = {}) => ({ name: kind === 'main' ? 'Membership' : kind, kind, price, ...extra });
  const old = now - 70 * DAY; // a month or two back, so a renewal falls in a later month
  DB.orders.insert({ id: 'm1', email: 'a@x.in', ...live, at: old, items: [item(1000), item(1000, 'renewal', { at: old + 31 * DAY })], total: 2000, plan: { type: 'recurring', interval: 'monthly', amount: 1000, status: 'active' } });
  DB.orders.insert({ id: 'm2', email: 'b@x.in', ...live, at: now - 5 * DAY, items: [item(12000)], total: 12000, plan: { type: 'recurring', interval: 'yearly', amount: 12000, status: 'active', cancelAtEnd: true } });
  DB.orders.insert({ id: 'm3', email: 'c@x.in', ...live, at: now - 5 * DAY, items: [item(500)], total: 500, plan: { type: 'recurring', interval: 'monthly', amount: 500, status: 'pending' } });
  DB.orders.insert({ id: 'i1', email: 'd@x.in', ...live, at: now - 5 * DAY, items: [item(3000)], total: 3000, plan: { type: 'installments', interval: 'monthly', count: 3, amount: 3000, paid: 1, status: 'active' } });
  DB.orders.insert({ id: 'cancelled', email: 'e@x.in', ...live, at: now - 5 * DAY, items: [item(700)], total: 700, plan: { type: 'recurring', interval: 'monthly', amount: 700, status: 'cancelled' } });
  DB.orders.insert({ id: 'test', email: 'f@x.in', ...live, mode: 'test', at: now - 5 * DAY, items: [item(900)], total: 900, plan: { type: 'recurring', interval: 'monthly', amount: 900, status: 'active' } });
  DB.orders.insert({ id: 'usd', email: 'a@x.in', ...live, at: now - 2 * DAY, items: [item(10, 'main', { name: 'Ebook' })], total: 10, currency: 'USD', fx: 80 }); // a returning buyer
  const u = { id: 'u1', settings: {} };
  const r = R.buildReport(u, R.reportPeriod({ days: '30' }, 'Asia/Kolkata'), '');
  assert.deepEqual([r.recurring.members, r.recurring.mrr, r.recurring.pastDue, r.recurring.ending], [2, 2000, 1, 1], 'monthly ₹1,000 + yearly ₹12,000 / 12; the retrying one and the cancelled / test ones don’t count');
  assert.deepEqual([r.recurring.plans, r.recurring.instalmentsLeft, r.recurring.instalmentsDue], [1, 2, 6000]);
  assert.equal(r.recurring.arr, 24000);
  // in the last 30 days: b, c, d, e are new; a bought before (m1, 70 days ago) and came back
  assert.deepEqual([r.overview.buyers, r.overview.newBuyers, r.overview.returningBuyers, r.overview.returningRevenue], [5, 4, 1, 800]);
  assert.equal(r.overview.net, 12000 + 500 + 3000 + 700 + 800, 'a cancelled membership was still paid for; the test one wasn’t');
  // a's cohort: ₹1,000 in month 0, the renewal a month later, the ebook this month — a repeat buyer from month 1
  const all = R.buildReport(u, R.reportPeriod({ days: 'all' }, 'Asia/Kolkata'), '');
  const row = all.cohorts.rows.find((x) => x.buyers === 1 && x.cells[0].ltv === 1000);
  assert.ok(row, JSON.stringify(all.cohorts.rows));
  assert.equal(row.cells[0].repeat, 0);
  assert.equal(row.cells.filter(Boolean).at(-1).ltv, 2800);
  assert.equal(row.cells.filter(Boolean).at(-1).repeat, 100);
  assert.equal(all.cohorts.rows.reduce((s, x) => s + x.buyers, 0), all.overview.buyers);
  assert.equal(all.ltv.top[0].email, 'b@x.in');
  assert.equal(all.ltv.top.find((x) => x.email === 'a@x.in').total, 2800);
  // ad spend: a campaign whose tagged sales all landed on one funnel counts there; the rest only overall
  DB.orders.insert({ id: 'ad', email: 'g@x.in', ...live, funnelId: 'f2', at: now - DAY, items: [item(4000)], total: 4000, attr: { utm_source: 'facebook', utm_campaign: 'Diwali Sale' } });
  DB.adspend.insert({ id: 's1', userId: 'u1', platform: 'meta', date: new Date(now - DAY).toISOString().slice(0, 10), campaign: 'diwali-sale', key: 'diwalisale', spend: 1000, at: now - DAY });
  DB.adspend.insert({ id: 's2', userId: 'u1', platform: 'meta', date: new Date(now - DAY).toISOString().slice(0, 10), campaign: 'Brand', key: 'brand', spend: 500, at: now - DAY });
  const ads = R.buildReport(u, R.reportPeriod({ days: '30' }, 'Asia/Kolkata'), '');
  assert.deepEqual([ads.overview.spend, ads.spend.unmapped, ads.overview.roas], [1500, 500, Math.round(((17000 + 4000) / 1500) * 100) / 100]);
  const f2 = ads.byFunnel.find((x) => x.id === 'f2');
  assert.deepEqual([f2.spend, f2.roas], [1000, 4]);
  assert.equal(ads.byFunnel.find((x) => x.id === 'f1').spend, null);
  assert.equal(ads.sources.find((x) => x.name === 'facebook').net, 4000, 'utm_source first');
});
