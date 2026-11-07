// The CRM industry alone decides the industry tools in the menu: a coach sees courses, products, bookings and
// webinars — not a store, quotes or the trading add-ons — even if the account has data in them from an earlier
// industry; switching industry changes the menu at once; a platform / agency switch can still add one back.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, register } from './helpers.mjs';

let srv, api, T;
before(async () => { srv = await startServer(); api = srv.api; T = (await register(api)).token; });
after(() => srv?.stop());
const hidden = async () => (await api('/me', 'GET', null, T)).data.nav.hidden;

test('coach & creator: only coaching tools; earlier data doesn’t keep a tool in the menu', async () => {
  // data from an earlier industry: a quote
  const q = await api('/quotes', 'POST', { client: { name: 'Meera Rao', email: 'meera@client.in' }, title: 'Plan', items: [{ name: 'Setup', price: 1000, qty: 1 }] }, T);
  assert.ok(q.status < 400, JSON.stringify(q.data).slice(0, 200));
  assert.equal((await api('/crm/kit', 'POST', { id: 'general' }, T)).status, 200);
  const h = await hidden();
  for (const p of ['/store', '/quotes', '/tally', '/inventory', '/counter']) assert.ok(h.includes(p), `${p} hidden for a coach`);
  for (const p of ['/orders', '/products', '/school', '/bookings', '/webinars', '/affiliates']) assert.ok(!h.includes(p), `${p} shown for a coach`);
});

test('switching industry changes the menu; a retailer gets the trading tools', async () => {
  assert.equal((await api('/crm/kit', 'POST', { id: 'retailer' }, T)).status, 200);
  const h = await hidden();
  for (const p of ['/store', '/quotes', '/tally', '/inventory', '/counter']) assert.ok(!h.includes(p), `${p} shown for a retailer`);
  for (const p of ['/school', '/webinars', '/affiliates']) assert.ok(h.includes(p), `${p} hidden for a retailer`);
  assert.equal((await api('/crm/kit', 'POST', { id: 'general' }, T)).status, 200);
  assert.ok((await hidden()).includes('/quotes'), 'back to coach: quotes go again (the quote itself is kept)');
  assert.equal((await api('/quotes', 'GET', null, T)).data.length ?? (await api('/quotes', 'GET', null, T)).data.quotes?.length, 1);
});
