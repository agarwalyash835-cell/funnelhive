// Selling FunnelHive abroad: a seller in the US picks their country, sees USD prices, subscribes by card through the
// platform's Stripe (first charge after the trial), renewals arrive by signed webhook with export invoices, and
// cancelling ends at the period end. Stripe is a local fake.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import { startServer, register } from './helpers.mjs';

const PK = 'pk_test_PlatformKey1234567', SK = 'sk_test_PlatformSecret1234567', WH = 'whsec_PlatformHook12345';
const subs = {};
let st, srv, api, T, me;
const body = (req) => new Promise((r) => { let b = ''; req.on('data', (c) => { b += c; }); req.on('end', () => r(b)); });
before(async () => {
  st = http.createServer(async (req, res) => {
    const p = Object.fromEntries(new URLSearchParams(await body(req)));
    const url = new URL(req.url, 'http://x');
    res.setHeader('content-type', 'application/json');
    const send = (o) => res.end(JSON.stringify(o));
    if (url.pathname === '/customers') return send({ id: 'cus_plat' });
    if (url.pathname === '/products') return send({ id: 'prod_plat' });
    if (url.pathname === '/subscriptions' && req.method === 'POST') {
      const id = `sub_${crypto.randomBytes(4).toString('hex')}`;
      const trial = Number(p.trial_end) || 0;
      subs[id] = { id, object: 'subscription', customer: 'cus_plat', status: 'incomplete', trial_end: trial || null, current_period_end: trial || Math.floor(Date.now() / 1000) + 30 * 86400, metadata: { userId: p['metadata[userId]'] }, amount: Number(p['items[0][price_data][unit_amount]']), currency: p['items[0][price_data][currency]'], cancel_at_period_end: false };
      return send({ ...subs[id], ...(trial ? { pending_setup_intent: { client_secret: 'seti_secret' } } : { latest_invoice: { payment_intent: { client_secret: 'pi_secret' } } }) });
    }
    const m = /^\/subscriptions\/(\w+)$/.exec(url.pathname);
    if (m && req.method === 'GET') return send(subs[m[1]]);
    if (m && req.method === 'POST') { subs[m[1]].cancel_at_period_end = p.cancel_at_period_end === 'true'; return send(subs[m[1]]); }
    if (m && req.method === 'DELETE') { subs[m[1]].status = 'canceled'; return send(subs[m[1]]); }
    res.writeHead(404); send({});
  }).listen(0);
  await new Promise((r) => setTimeout(r, 30));
  srv = await startServer({ STRIPE_API_URL: `http://127.0.0.1:${st.address().port}`, PLATFORM_STRIPE_PUBLISHABLE_KEY: PK, PLATFORM_STRIPE_SECRET_KEY: SK, PLATFORM_STRIPE_WEBHOOK_SECRET: WH });
  api = srv.api;
  T = (await register(api)).token;
  me = (await api('/me', 'GET', null, T)).data;
});
after(async () => { await srv.stop(); st.close(); });
const hook = (ev) => { const raw = JSON.stringify(ev), t = Math.floor(Date.now() / 1000); return fetch(`${srv.base}/api/billing/stripe-webhook`, { method: 'POST', headers: { 'content-type': 'application/json', 'stripe-signature': `t=${t},v1=${crypto.createHmac('sha256', WH).update(`${t}.${raw}`).digest('hex')}` }, body: raw }); };

let subId;
test('a seller in the US: USD prices, card subscription that charges after the trial', async () => {
  const d = (await api('/billing/details', 'PUT', { name: 'Jane Coach LLC', country: 'US', address: 'Austin, TX' }, T)).data;
  assert.deepEqual([d.intl.abroad, d.intl.currency, d.intl.prices.monthly, d.intl.ready], [true, 'USD', 29, true]);
  assert.equal((await api('/billing/subscribe', 'POST', { interval: 'monthly' }, T)).data.intl, true, 'the ₹ path points them to card billing');
  const s = (await api('/billing/subscribe-intl', 'POST', { interval: 'agency_monthly' }, T)).data;
  assert.deepEqual([s.provider, s.mode, s.currency, s.amount, s.startsLater], ['stripe', 'setup', 'USD', 99, true]);
  subId = s.subscription;
  assert.equal(subs[subId].amount, 9900);
  assert.equal(subs[subId].currency, 'usd');
  // the card is saved: Stripe reports the subscription trialing
  subs[subId].status = 'trialing';
  const b = (await api('/billing/stripe/confirm', 'POST', { subscription: subId }, T)).data;
  assert.equal(b.access.status, 'active');
  assert.equal(b.provider, 'stripe');
  assert.equal((await api('/agency', 'GET', null, T)).data.limit, 25, 'the Agency plan’s client accounts');
});

test('renewal by webhook: an export invoice in USD; a forged webhook is refused', async () => {
  subs[subId].status = 'active';
  const inv = { id: 'in_1', object: 'invoice', subscription: subId, amount_paid: 9900, currency: 'usd', period_start: Math.floor(Date.now() / 1000), period_end: Math.floor(Date.now() / 1000) + 30 * 86400, payment_intent: 'pi_1', metadata: {} };
  assert.equal((await fetch(`${srv.base}/api/billing/stripe-webhook`, { method: 'POST', headers: { 'content-type': 'application/json', 'stripe-signature': 't=1,v1=00' }, body: JSON.stringify({ type: 'invoice.paid', data: { object: inv } }) })).status, 400);
  assert.equal((await hook({ type: 'invoice.paid', data: { object: inv } })).status, 200);
  await hook({ type: 'invoice.paid', data: { object: inv } }); // delivered twice: one invoice
  const list = (await api('/billing', 'GET', null, T)).data.invoices;
  assert.equal(list.length, 1);
  assert.deepEqual([list[0].currency, list[0].total], ['USD', 99]);
  const full = (await api(`/billing/invoices/${list[0].id}`, 'GET', null, T)).data;
  assert.deepEqual([full.export, full.placeOfSupply, full.billedTo.country], [true, 'Outside India', 'US']);
});

test('cancelling ends at the period end; a failed renewal marks the account past due', async () => {
  const c = (await api('/billing/cancel', 'POST', {}, T)).data;
  assert.equal(subs[subId].cancel_at_period_end, true);
  assert.equal(c.access.cancelAtPeriodEnd, true);
  subs[subId].status = 'past_due';
  await hook({ type: 'customer.subscription.updated', data: { object: subs[subId] } });
  assert.equal((await api('/billing', 'GET', null, T)).data.access.planStatus, 'past_due');
});
