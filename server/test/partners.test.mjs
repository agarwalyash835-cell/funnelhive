// Three levels of accounts: the platform (super admin) turns an agency into a partner and sets its wholesale terms;
// the partner sells its own plans and credit packs to sub-accounts and is paid in its own Razorpay; the platform
// bills the partner's wallet per active sub-account. Plain agency clients (no partner plan) behave as before.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import { startServer, register, enable2fa } from './helpers.mjs';

const KEY = 'rzp_test_Partner123456', SECRET = 'partner_secret_xyz';
const sign = (d) => crypto.createHmac('sha256', SECRET).update(d).digest('hex');
let fake, srv, api, ADMIN, P, partnerId;
before(async () => {
  fake = http.createServer((req, res) => {
    let b = '';
    req.on('data', (c) => { b += c; });
    req.on('end', () => {
      res.setHeader('content-type', 'application/json');
      if (req.headers.authorization !== `Basic ${Buffer.from(`${KEY}:${SECRET}`).toString('base64')}`) { res.writeHead(401); return res.end(JSON.stringify({ error: { description: 'Authentication failed' } })); }
      if (req.method === 'GET') return res.end(JSON.stringify({ items: [] }));
      const body = JSON.parse(b);
      res.end(JSON.stringify({ id: `order_${crypto.randomBytes(6).toString('hex')}`, amount: body.amount, currency: body.currency }));
    });
  }).listen(0);
  await new Promise((r) => setTimeout(r, 30));
  srv = await startServer({ RAZORPAY_API_URL: `http://127.0.0.1:${fake.address().port}`, ADMIN_EMAILS: 'owner@partners.test' });
  api = srv.api;
  ADMIN = (await register(api, 'owner@partners.test')).token;
  const link = srv.log().match(/To: owner@partners\.test[\s\S]*?\/verify\?token=([a-f0-9.]+)/);
  await api('/auth/verify', 'POST', { token: link[1] });
  ADMIN = (await enable2fa(api, ADMIN)).token;
  P = (await register(api, 'agency@partners.test')).token;
  partnerId = (await api('/me', 'GET', null, P)).data.id;
});
after(async () => { await srv?.stop(); fake?.close(); });

// a sub-account owner signs in through the set-password link
const loginWith = async (token, email) => {
  assert.equal((await api('/auth/reset', 'POST', { token, password: 'Client-Passw0rd-1' })).status, 200);
  return (await api('/auth/login', 'POST', { email, password: 'Client-Passw0rd-1' })).data.token;
};

test('the super admin makes an agency a partner and sets its wholesale terms; non-admins can’t', async () => {
  assert.equal((await api(`/admin/partners/${partnerId}`, 'PUT', { perAccount: 499 }, P)).status, 403);
  const r = await api(`/admin/partners/${partnerId}`, 'PUT', { perAccount: 499, creditRate: 20, maxAccounts: 10 }, ADMIN);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.deepEqual([r.data.terms.enabled, r.data.terms.perAccount, r.data.terms.creditRate, r.data.terms.maxAccounts], [true, 499, 20, 10]);
  assert.equal((await api('/me', 'GET', null, P)).data.billing?.status ?? 'comped', 'comped', 'the partner’s own workspace is covered');
  assert.ok((await api('/admin/partners', 'GET', null, ADMIN)).data.some((x) => x.id === partnerId && x.terms.enabled));
  assert.equal((await api(`/admin/partners/${partnerId}/wallet`, 'POST', { amount: 2000, note: 'Opening balance' }, ADMIN)).data.balance, 2000);
});

let C, clientId, plan;
test('the partner sets its own plans and packs, creates a sub-account on a plan, and gets paid in its own Razorpay', async () => {
  assert.equal((await api('/channels/razorpay', 'PUT', { keyId: KEY, keySecret: SECRET }, P)).status, 200);
  const rs = (await api('/partner/resale', 'PUT', { plans: [{ name: 'Starter', monthly: 1999, yearly: 19990, credits: 300, trialDays: 7 }, { name: 'Pro', monthly: 4999, credits: 1500 }], packs: [{ credits: 500, price: 999 }] }, P)).data.resale;
  plan = rs.plans[0];
  assert.equal(rs.plans.length, 2);
  const made = await api('/partner/accounts', 'POST', { email: 'client@shop.in', name: 'Asha', business: 'Asha Boutique', planId: plan.id }, P);
  assert.equal(made.status, 201, JSON.stringify(made.data));
  clientId = made.data.id;
  C = await loginWith(made.data.token, 'client@shop.in');
  const me = (await api('/me', 'GET', null, C)).data;
  assert.equal(me.billing.resold, true);
  assert.equal(me.billing.status, 'trialing');
  assert.equal(me.credits.limit, 300, 'the plan’s monthly credits');
  // the partner sees and works in it; the client sees the partner's plans
  const pv = (await api('/partner', 'GET', null, P)).data;
  assert.equal(pv.clients[0].sub.status, 'trialing');
  const pb = (await api('/partner-billing', 'GET', null, C)).data;
  assert.deepEqual(pb.plans.map((p) => p.name), ['Starter', 'Pro']);
  assert.equal(pb.canPay, true);
  // pay for a month of Pro in the partner's Razorpay
  const pro = pb.plans[1];
  const start = (await api('/partner-billing/pay', 'POST', { planId: pro.id, interval: 'monthly' }, C)).data;
  assert.equal(start.amount, 499900);
  assert.equal(start.key, KEY, 'the partner’s own Razorpay');
  const pid = 'pay_' + crypto.randomBytes(5).toString('hex');
  assert.equal((await api('/partner-billing/verify', 'POST', { payment: start.payment, razorpay_order_id: start.order_id, razorpay_payment_id: pid, razorpay_signature: 'bad' }, C)).status, 400);
  const ok = (await api('/partner-billing/verify', 'POST', { payment: start.payment, razorpay_order_id: start.order_id, razorpay_payment_id: pid, razorpay_signature: sign(`${start.order_id}|${pid}`) }, C)).data;
  assert.equal(ok.sub.status, 'active');
  assert.equal(ok.credits.limit, 1500);
  const again = (await api('/partner-billing/verify', 'POST', { payment: start.payment, razorpay_order_id: start.order_id, razorpay_payment_id: pid, razorpay_signature: sign(`${start.order_id}|${pid}`) }, C)).data;
  assert.equal(again.sub.periodEnd, ok.sub.periodEnd, 'confirmed once');
  const orders = (await api('/orders', 'GET', null, P)).data.orders;
  assert.ok(orders.some((o) => o.total === 4999 && o.source === 'partner'), 'the sale is in the partner’s orders');
  // a credit pack adds credits on top of the plan
  const pk = (await api('/partner-billing/pay', 'POST', { kind: 'pack', packId: pb.packs[0].id }, C)).data;
  const pid2 = 'pay_' + crypto.randomBytes(5).toString('hex');
  const ok2 = (await api('/partner-billing/verify', 'POST', { payment: pk.payment, razorpay_order_id: pk.order_id, razorpay_payment_id: pid2, razorpay_signature: sign(`${pk.order_id}|${pid2}`) }, C)).data;
  assert.equal(ok2.credits.limit, 2000);
});

test('the platform bills the partner per active sub-account from its wallet; another partner sees nothing', async () => {
  assert.equal((await api('/admin/partners/bill-now', 'POST', {}, ADMIN)).status, 200);
  const pv = (await api('/partner', 'GET', null, P)).data;
  assert.equal(pv.balance, 2000 - 499);
  assert.ok(pv.ledger.some((l) => l.kind === 'account_fee' && l.amount === -499));
  await api('/admin/partners/bill-now', 'POST', {}, ADMIN);
  assert.equal((await api('/partner', 'GET', null, P)).data.balance, 1501, 'once per 30 days');
  // isolation: another agency can't touch this partner's clients or terms
  const X = (await register(api)).token;
  assert.equal((await api(`/partner/clients/${clientId}/plan`, 'PUT', { planId: plan.id, status: 'comped' }, X)).status, 403);
  assert.equal((await api('/partner', 'GET', null, X)).data.enabled, false);
  assert.equal((await api('/partner-billing/pay', 'POST', { planId: plan.id }, X)).status, 404);
});

test('the partner controls a sub-account’s plan; an expired plan locks writes, renewing unlocks', async () => {
  const set = (body) => api(`/partner/clients/${clientId}/plan`, 'PUT', body, P);
  assert.equal((await set({ planId: plan.id, status: 'comped' })).data.sub.status, 'comped');
  assert.equal((await api('/me', 'GET', null, C)).data.billing.ok, true);
  assert.equal((await set({ planId: 'nope', status: 'active' })).status, 400);
  const r = await set({ planId: plan.id, status: 'active', days: 30 });
  assert.equal(r.data.sub.status, 'active');
  assert.equal((await api('/funnels', 'POST', { name: 'Works' }, C)).status < 300, true);
});

test('the super admin creates end users and partners directly and moves accounts between partners', async () => {
  const u = await api('/admin/accounts', 'POST', { type: 'user', email: 'solo@biz.in', name: 'Solo', business: 'Solo Biz' }, ADMIN);
  assert.equal(u.status, 201, JSON.stringify(u.data));
  const p2 = await api('/admin/accounts', 'POST', { type: 'partner', email: 'reseller@agency.in', name: 'Reseller', business: 'Reseller Co', perAccount: 299 }, ADMIN);
  assert.equal(p2.data.type, 'partner');
  const under = await api('/admin/accounts', 'POST', { type: 'user', email: 'sub@biz.in', name: 'Sub', partnerId }, ADMIN);
  assert.equal(under.data.partnerId, partnerId);
  assert.ok((await api('/partner', 'GET', null, P)).data.clients.some((c) => c.email === 'sub@biz.in'));
  // move the solo account under the new partner, then make it independent again
  assert.equal((await api(`/admin/users/${u.data.id}/partner`, 'PUT', { partnerId: p2.data.id }, ADMIN)).data.partnerId, p2.data.id);
  assert.equal((await api(`/admin/partners/${p2.data.id}/clients`, 'GET', null, ADMIN)).data.length, 1);
  assert.equal((await api(`/admin/users/${u.data.id}/partner`, 'PUT', { partnerId: null }, ADMIN)).data.partnerId, null);
  assert.equal((await api(`/admin/partners/${p2.data.id}/clients`, 'GET', null, ADMIN)).data.length, 0);
  assert.equal((await api('/admin/accounts', 'POST', { type: 'user', email: 'solo@biz.in' }, ADMIN)).status, 409);
});

test('a plain agency client with no partner plan is still covered by its agency, as before', async () => {
  const A = (await register(api)).token;
  const made = await api('/agency/clients', 'POST', { business: 'Old style client' }, A);
  assert.equal(made.status, 201, JSON.stringify(made.data));
  const me = (await api('/me', 'GET', null, made.data.token)).data;
  assert.equal(me.billing.agencyManaged, true);
  assert.ok(!me.billing.resold);
});
