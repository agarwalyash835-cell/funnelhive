// Orders and contacts a page at a time: pages don't overlap and cover everything, the totals are over
// every match (not one page), filters run on the server, and each row is what the full list returns.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, register } from './helpers.mjs';

let srv, api, T, allOrders, allCarts, allContacts;
before(async () => {
  srv = await startServer();
  api = srv.api;
  T = (await register(api)).token;
  assert.equal((await api('/demo/seed', 'POST', {}, T)).status, 200);
  const d = (await api('/orders', 'GET', null, T)).data;
  // a refund, a note and a tag to filter on
  const [a, b] = d.orders;
  assert.equal((await api(`/orders/${a.id}/refund`, 'POST', { items: [0], reason: 'test' }, T)).status, 200);
  await api(`/orders/${b.id}`, 'PUT', { note: 'Wants a GST invoice', tags: ['VIP'] }, T);
  const d2 = (await api('/orders', 'GET', null, T)).data;
  allOrders = d2.orders; allCarts = d2.abandoned;
  allContacts = (await api('/contacts', 'GET', null, T)).data;
  assert.ok(allOrders.length > 100 && allCarts.length > 20 && allContacts.length > 200, `seeded ${allOrders.length} orders, ${allCarts.length} carts, ${allContacts.length} contacts`);
});
after(() => srv.stop());

// every page of a list, following the cursor
async function pages(path, key, cursorKey, extra = '') {
  const seen = [];
  let cursor = '', n = 0, first;
  do {
    const d = (await api(`${path}${extra}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`, 'GET', null, T)).data;
    first ||= d;
    seen.push(...d[key]);
    cursor = d[cursorKey];
    assert.ok(++n < 200, 'the cursor moves on');
  } while (cursor);
  return { rows: seen, first, n };
}
// the Orders page's own rules (client/src/pages/Orders.jsx)
const isTest = (o) => o.mode === 'test' || (!o.provider && !o.demo && o.paymentMethod !== 'cod' && o.total > 0 && !['cod', 'cancelled'].includes(o.status));
const realPaid = (o) => !isTest(o) && !['cod', 'cancelled'].includes(o.status);
const r2 = (n) => Math.round(n * 100) / 100;

test('orders: pages cover every order once, newest first, and the totals are over all of them', async () => {
  const { rows, first, n } = await pages('/orders?limit=37', 'orders', 'nextCursor', '&tab=orders');
  assert.ok(n > 3, 'several pages');
  assert.equal(new Set(rows.map((o) => o.id)).size, rows.length, 'no order twice');
  assert.deepEqual(rows.map((o) => o.id), allOrders.map((o) => o.id), 'the same orders in the same order');
  assert.equal(first.total, allOrders.length);
  const paid = allOrders.filter(realPaid), revenue = paid.reduce((s, o) => s + o.total * (o.fx || 1), 0);
  const k = first.kpis;
  assert.equal(k.paid, paid.length);
  assert.equal(r2(k.revenue), r2(revenue));
  assert.equal(r2(k.aov), r2(revenue / paid.length));
  assert.equal(r2(k.refunded), r2(allOrders.filter((o) => !isTest(o)).reduce((s, o) => s + (o.refunded || 0) * (o.fx || 1), 0)));
  assert.ok(k.refunded > 0, 'the refund counts');
  assert.equal(k.tests, allOrders.filter(isTest).length);
  assert.equal(k.codDue, 0);
  assert.equal(k.abandoned, allCarts.length);
  assert.deepEqual(first.funnels, [...new Set(allOrders.map((o) => o.funnel))].sort());
  // a page's rows carry what the full list's do (funnel name, invoices)
  assert.deepEqual(rows.slice(0, 5), allOrders.slice(0, 5));
});

test('orders: status, funnel, period, search and id filters run on the server', async () => {
  const get = async (qs) => (await api(`/orders?limit=1000&${qs}`, 'GET', null, T)).data;
  const refunded = await get('status=refunded');
  assert.deepEqual(refunded.orders.map((o) => o.id), allOrders.filter((o) => ['refunded', 'partially_refunded'].includes(o.status)).map((o) => o.id));
  assert.equal(refunded.orders.length, 1);
  assert.equal(refunded.kpis.paid, allOrders.filter(realPaid).length, 'the totals follow period / funnel / search, not the status');
  const paid = await get('status=paid');
  assert.equal(paid.total, allOrders.filter((o) => realPaid(o) && o.status !== 'refunded').length);
  const f = allOrders.at(-1).funnel;
  const byFunnel = await get(`funnel=${encodeURIComponent(f)}`);
  assert.deepEqual(byFunnel.orders.map((o) => o.id), allOrders.filter((o) => o.funnel === f).map((o) => o.id));
  assert.ok(byFunnel.orders.length < allOrders.length);
  assert.equal(r2(byFunnel.kpis.revenue), r2(allOrders.filter((o) => o.funnel === f && realPaid(o)).reduce((s, o) => s + o.total, 0)));
  const week = await get('days=7');
  const since = Date.now() - 7 * 864e5;
  assert.deepEqual(week.orders.map((o) => o.id), allOrders.filter((o) => o.at >= since).map((o) => o.id));
  assert.equal((await get('q=gst%20INVOICE')).orders.length, 1, 'notes are searched, any case');
  assert.equal((await get('q=vip')).orders[0].tags[0], 'VIP', 'and tags');
  const who = allOrders[10];
  const byName = await get(`q=${encodeURIComponent(who.email.toUpperCase())}`);
  assert.deepEqual(byName.orders.map((o) => o.id), allOrders.filter((o) => o.email === who.email).map((o) => o.id));
  assert.deepEqual((await get(`id=${who.id}`)).orders.map((o) => o.id), [who.id]);
  assert.equal((await get('status=test')).total, 0);
  // the abandoned list follows the same filters
  assert.deepEqual(byFunnel.abandoned.map((a) => a.id), allCarts.filter((a) => a.funnel === f).map((a) => a.id));
});

test('abandoned checkouts page the same way', async () => {
  const { rows, n } = await pages('/orders?limit=25', 'abandoned', 'abandonedCursor', '&tab=abandoned');
  assert.ok(n > 1);
  assert.equal(new Set(rows.map((a) => a.id)).size, rows.length);
  assert.deepEqual(rows, allCarts);
  const later = (await api(`/orders?limit=25&tab=abandoned&cursor=${encodeURIComponent((await api('/orders?limit=25', 'GET', null, T)).data.abandonedCursor)}`, 'GET', null, T)).data;
  assert.ok(!later.orders && later.abandoned.length, 'a next page carries only its own list');
});

test('contacts: pages cover everyone once, each row as the full list has it, totals over all', async () => {
  const { rows, first, n } = await pages('/contacts?limit=60', 'contacts', 'nextCursor');
  assert.ok(n > 3);
  assert.equal(new Set(rows.map((c) => c.key)).size, rows.length, 'nobody twice');
  assert.equal(rows.length, allContacts.length);
  const byKey = Object.fromEntries(allContacts.map((c) => [c.key, c]));
  for (const c of rows) assert.deepEqual(c, byKey[c.key]);
  for (let i = 1; i < rows.length; i++) assert.ok(rows[i - 1].lastSeen >= rows[i].lastSeen, 'most recent first');
  const customers = allContacts.filter((c) => c.type === 'customer');
  assert.deepEqual(first.kpis, { total: allContacts.length, customers: customers.length, leads: allContacts.length - customers.length, avgLtv: first.kpis.avgLtv });
  assert.equal(r2(first.kpis.avgLtv), r2(customers.reduce((s, c) => s + c.ltv, 0) / customers.length));
  assert.equal(first.total, allContacts.length);
});

test('contacts: search, type, tag and stage filters; keys of every match; export by pages', async () => {
  const get = async (qs) => (await api(`/contacts?limit=1000&${qs}`, 'GET', null, T)).data;
  const keys = (l) => l.map((c) => c.key).sort();
  const custs = await get('type=customer');
  assert.deepEqual(keys(custs.contacts), keys(allContacts.filter((c) => c.type === 'customer')));
  assert.equal(custs.total, custs.contacts.length);
  assert.equal(custs.kpis.total, allContacts.length, 'the totals are the whole list');
  const one = allContacts[5];
  const word = one.name.split(' ')[0].toUpperCase();
  const found = await get(`q=${encodeURIComponent(word)}`);
  assert.deepEqual(keys(found.contacts), keys(allContacts.filter((c) => `${c.name} ${c.email} ${c.phone} ${(c.tags || []).join(' ')}`.toLowerCase().includes(word.toLowerCase()))));
  // tag a few, then find them by tag and by searching the tag
  const tagged = allContacts.slice(0, 7).map((c) => c.key);
  assert.equal((await api('/contacts/bulk', 'POST', { keys: tagged, addTag: 'Webinar-May' }, T)).data.updated, 7);
  assert.deepEqual(keys((await get('tag=webinar-may')).contacts), [...tagged].sort());
  assert.deepEqual(keys((await get('q=webinar-may')).contacts), [...tagged].sort());
  // stage: customers start in the "won" stage; moving one changes where it shows
  const p = (await api('/pipelines', 'GET', null, T)).data[0];
  const won = p.stages.find((s) => s.won), firstStage = p.stages[0];
  const inWon = await get(`pipeline=${p.id}&stage=${won.id}`);
  assert.deepEqual(keys(inWon.contacts), keys(allContacts.filter((c) => c.stages[p.id] === won.id)));
  const mover = inWon.contacts[0];
  await api(`/contacts/${encodeURIComponent(mover.key)}`, 'PATCH', { stage: { pipelineId: p.id, stageId: firstStage.id } }, T);
  assert.ok((await get(`pipeline=${p.id}&stage=${firstStage.id}`)).contacts.some((c) => c.key === mover.key));
  assert.equal((await get(`pipeline=${p.id}&stage=${won.id}`)).total, inWon.total - 1);
  assert.equal(r2(inWon.totalLtv), r2(inWon.contacts.reduce((s, c) => s + c.ltv, 0)), 'the stage’s value');
  // "select all": keys of every match, no rows
  const k = (await api('/contacts?keys=1&type=customer', 'GET', null, T)).data;
  assert.ok(k.keys.length > 100, 'not just one page');
  assert.deepEqual([...k.keys].sort(), keys(allContacts.filter((c) => c.type === 'customer')));
  // sorted by lifetime value, paged
  const { rows } = await pages('/contacts?limit=100&sort=ltv', 'contacts', 'nextCursor');
  assert.equal(rows.length, allContacts.length);
  for (let i = 1; i < rows.length; i++) assert.ok(rows[i - 1].ltv >= rows[i].ltv);
  // the CSV export walks every page: nothing is missed past the first one
  const all = await pages('/contacts?limit=1000', 'contacts', 'nextCursor');
  assert.equal(all.rows.length, allContacts.length);
  // a contact added by hand shows up, and the detail screen still opens
  const added = (await api('/contacts', 'POST', { name: 'Zed Manual', email: 'zed@example.com' }, T)).data.key;
  const z = (await get('q=zed%20manual')).contacts;
  assert.deepEqual(z.map((c) => c.key), [added]);
  assert.equal((await api(`/contacts/${encodeURIComponent(added)}`, 'GET', null, T)).data.name, 'Zed Manual');
  assert.equal((await get('')).contacts[0].key, added, 'the newest activity comes first');
});
