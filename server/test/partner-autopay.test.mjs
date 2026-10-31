// An agency's plans do more than set AI credits: they switch add-ons on and cap funnels, storage and team seats.
// A client can put its plan on auto-pay (a Razorpay subscription on the agency's own account): each paid invoice
// becomes one sale and one more period, however often it's synced, and turning auto-pay off stops future debits.
// Clients paying by hand get a reminder 3 days before the plan ends, once. Razorpay is a local fake.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import { startServer, register, enable2fa } from './helpers.mjs';

const KEY = 'rzp_test_Autopay123456', SECRET = 'autopay_secret_xyz';
const DAY = 86400000;
const sign = (d) => crypto.createHmac('sha256', SECRET).update(d).digest('hex');
const rz = { plans: [], subs: {}, invoices: {}, cancelled: [] };
let fake, srv, api, ADMIN, P, partnerId, C, clientId, plan;
before(async () => {
  fake = http.createServer((req, res) => {
    let b = '';
    req.on('data', (c) => { b += c; });
    req.on('end', () => {
      res.setHeader('content-type', 'application/json');
      const send = (o) => res.end(JSON.stringify(o));
      if (req.headers.authorization !== `Basic ${Buffer.from(`${KEY}:${SECRET}`).toString('base64')}`) { res.writeHead(401); return send({ error: { description: 'Authentication failed' } }); }
      const u = new URL(req.url, 'http://x'), body = b ? JSON.parse(b) : {};
      if (u.pathname === '/plans') { const p = { id: `plan_${rz.plans.length}`, ...body }; rz.plans.push(p); return send(p); }
      if (u.pathname === '/subscriptions') { const id = `sub_${crypto.randomBytes(4).toString('hex')}`; rz.subs[id] = { id, status: 'created', ...body }; rz.invoices[id] = []; return send(rz.subs[id]); }
      let m = /^\/subscriptions\/(\w+)\/cancel$/.exec(u.pathname);
      if (m) { rz.subs[m[1]].status = 'cancelled'; rz.cancelled.push(m[1]); return send(rz.subs[m[1]]); }
      m = /^\/subscriptions\/(\w+)$/.exec(u.pathname);
      if (m) return send(rz.subs[m[1]]);
      if (u.pathname === '/invoices') return send({ items: [...(rz.invoices[u.searchParams.get('subscription_id')] || [])].reverse() });
      send({ id: `order_${crypto.randomBytes(6).toString('hex')}`, amount: body.amount, currency: body.currency });
    });
  }).listen(0);
  await new Promise((r) => setTimeout(r, 30));
  srv = await startServer({ RAZORPAY_API_URL: `http://127.0.0.1:${fake.address().port}`, ADMIN_EMAILS: 'owner@autopay.test' });
  api = srv.api;
  ADMIN = (await register(api, 'owner@autopay.test')).token;
  const link = srv.log().match(/To: owner@autopay\.test[\s\S]*?\/verify\?token=([a-f0-9.]+)/);
  await api('/auth/verify', 'POST', { token: link[1] });
  ADMIN = (await enable2fa(api, ADMIN)).token;
  P = (await register(api, 'agency@autopay.test')).token;
  partnerId = (await api('/me', 'GET', null, P)).data.id;
  // a reseller the platform lets switch the Tally add-on on for its clients (not Inventory)
  assert.equal((await api(`/admin/partners/${partnerId}`, 'PUT', { perAccount: 499, creditRate: 20, maxAccounts: 10, addons: ['tally'] }, ADMIN)).status, 200);
  assert.equal((await api('/channels/razorpay', 'PUT', { keyId: KEY, keySecret: SECRET }, P)).status, 200);
});
after(async () => { await srv?.stop(); fake?.close(); });

const paidInvoice = (sid, amount) => rz.invoices[sid].push({ id: `inv_${crypto.randomBytes(4).toString('hex')}`, status: 'paid', payment_id: `pay_${crypto.randomBytes(4).toString('hex')}`, amount_paid: amount * 100 });
const jobs = (now) => api('/__test/partner-jobs', 'POST', now ? { now } : {});

test('a plan switches its add-ons on and caps funnels and team seats; only add-ons the agency may give', async () => {
  const no = await api('/partner/resale', 'PUT', { plans: [{ name: 'Growth', monthly: 2999, credits: 500, addons: ['inventory'] }], packs: [] }, P);
  assert.equal(no.status, 403); assert.equal(no.data.addon, 'inventory');
  const rs = (await api('/partner/resale', 'PUT', { plans: [{ name: 'Growth', monthly: 2999, yearly: 29990, credits: 500, trialDays: 7, addons: ['tally'], limits: { funnels: 1, seats: 1, storageMB: '' } }], packs: [] }, P)).data.resale;
  plan = rs.plans[0];
  assert.deepEqual(plan.addons, ['tally']); assert.deepEqual(plan.limits, { funnels: 1, storageMB: null, seats: 1 });
  const made = (await api('/partner/accounts', 'POST', { email: 'client@autopay.in', name: 'Ravi', business: 'Ravi Traders', planId: plan.id }, P)).data;
  clientId = made.id;
  assert.equal((await api('/auth/reset', 'POST', { token: made.token, password: 'Client-Passw0rd-1' })).status, 200);
  C = (await api('/auth/login', 'POST', { email: 'client@autopay.in', password: 'Client-Passw0rd-1' })).data.token;
  assert.equal((await api('/me', 'GET', null, C)).data.nav.tally, true, 'the plan switched Tally on');
  assert.equal((await api('/usage', 'GET', null, C)).data.limits.funnels, 1);
  assert.equal((await api('/funnels', 'POST', { name: 'First' }, C)).status < 300, true);
  const second = await api('/funnels', 'POST', { name: 'Second' }, C);
  assert.equal(second.status, 403); assert.equal(second.data.limit, 'funnels');
  assert.equal((await api('/team/invite', 'POST', { email: 'one@autopay.in', role: 'admin' }, C)).status < 300, true);
  assert.ok((await api('/team/invite', 'POST', { email: 'two@autopay.in', role: 'admin' }, C)).status >= 400, 'one seat on this plan');
  // taking the client off the plan takes the plan's add-on away again
  await api(`/partner/clients/${clientId}/plan`, 'PUT', { planId: null }, P);
  assert.equal((await api('/me', 'GET', null, C)).data.nav.tally, false);
  await api(`/partner/clients/${clientId}/plan`, 'PUT', { planId: plan.id, status: 'trialing' }, P);
  assert.equal((await api('/me', 'GET', null, C)).data.nav.tally, true);
});

let sid;
test('auto-pay: the first debit waits for the trial, each paid invoice is one sale, synced any number of times', async () => {
  const pb = (await api('/partner-billing', 'GET', null, C)).data;
  assert.equal(pb.canAutopay, true); assert.equal(pb.autopay, null);
  const st = await api('/partner-billing/autopay', 'POST', { planId: plan.id, interval: 'monthly' }, C);
  assert.equal(st.status, 200, JSON.stringify(st.data));
  sid = st.data.subscription_id;
  assert.equal(st.data.key, KEY, 'the agency’s own Razorpay');
  assert.equal(st.data.startsLater, true, 'the trial is honoured');
  assert.equal(rz.plans[0].item.amount, 299900);
  assert.ok(rz.subs[sid].start_at > Date.now() / 1000 + 5 * 86400);
  // nothing changes until the client approves it
  assert.equal((await api('/me', 'GET', null, C)).data.billing.status, 'trialing');
  assert.equal((await api('/partner-billing/autopay/verify', 'POST', { razorpay_payment_id: 'pay_x', razorpay_subscription_id: sid, razorpay_signature: 'bad' }, C)).status, 400);
  const ok = (await api('/partner-billing/autopay/verify', 'POST', { razorpay_payment_id: 'pay_auth', razorpay_subscription_id: sid, razorpay_signature: sign(`pay_auth|${sid}`) }, C)).data;
  assert.equal(ok.autopay.status, 'authenticated');
  assert.equal(ok.sub.status, 'trialing', 'no charge yet');
  assert.equal((await api('/partner-billing/autopay', 'POST', { planId: plan.id }, C)).status, 409, 'one auto-pay at a time');
  // the first debit lands: one sale, a month paid
  rz.subs[sid].status = 'active'; paidInvoice(sid, 2999);
  await jobs(); await jobs();
  let me = (await api('/me', 'GET', null, C)).data;
  assert.equal(me.billing.status, 'active');
  const end1 = (await api('/partner-billing', 'GET', null, C)).data.sub.periodEnd;
  let sales = (await api('/orders', 'GET', null, P)).data.orders.filter((o) => o.source === 'partner');
  assert.equal(sales.length, 1); assert.equal(sales[0].total, 2999);
  // next month's debit: one more sale, a month more
  paidInvoice(sid, 2999);
  await jobs();
  sales = (await api('/orders', 'GET', null, P)).data.orders.filter((o) => o.source === 'partner');
  assert.equal(sales.length, 2);
  const end2 = (await api('/partner-billing', 'GET', null, C)).data.sub.periodEnd;
  assert.ok(end2 - end1 >= 29 * DAY, 'a month more');
  me = (await api('/me', 'GET', null, C)).data;
  assert.equal(me.nav.tally, true, 'still on the plan’s add-ons');
});

test('another account can’t touch this auto-pay; turning it off stops debits but keeps the paid time', async () => {
  const X = (await register(api)).token;
  assert.equal((await api('/partner-billing/autopay/cancel', 'POST', {}, X)).status, 404);
  const before = (await api('/partner-billing', 'GET', null, C)).data.sub.periodEnd;
  const r = await api('/partner-billing/autopay/cancel', 'POST', {}, C);
  assert.equal(r.status, 200); assert.equal(r.data.autopay.status, 'cancelled');
  assert.deepEqual(rz.cancelled, [sid]);
  assert.equal((await api('/partner-billing', 'GET', null, C)).data.sub.periodEnd, before);
  assert.equal((await api('/me', 'GET', null, C)).data.billing.status, 'active');
});

test('paying by hand: one reminder 3 days before the plan ends, in the agency’s name', async () => {
  const end = (await api('/partner-billing', 'GET', null, C)).data.sub.periodEnd;
  assert.equal((await jobs(end - 10 * DAY)).data.reminders, 0, 'too early');
  const mark = srv.log().length;
  assert.equal((await jobs(end - 2 * DAY)).data.reminders, 1);
  assert.equal((await jobs(end - DAY)).data.reminders, 0, 'once per period');
  assert.match(srv.log().slice(mark), /To: client@autopay\.in[\s\S]*?Growth plan ends on[\s\S]*?\/billing/);
});
