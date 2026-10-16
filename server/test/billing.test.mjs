// Subscriptions (trial → Razorpay Subscriptions → GST invoices), account locking, AI credits and the
// admin panel. A local fake of Razorpay's API stands in for the real one.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import { startServer, register, enable2fa } from './helpers.mjs';

const KEY = 'rzp_test_Platform12345', SECRET = 'platform_secret', WH = 'platform_wh';
const plans = [], subs = {};
let fake, srv, api, ADMIN, S1, S1email;
const sign = (s, d) => crypto.createHmac('sha256', s).update(d).digest('hex');
const DAY = 86400000;

before(async () => {
  fake = http.createServer((req, res) => {
    let b = '';
    req.on('data', (c) => { b += c; });
    req.on('end', () => {
      res.setHeader('content-type', 'application/json');
      if (req.headers.authorization !== `Basic ${Buffer.from(`${KEY}:${SECRET}`).toString('base64')}`) { res.writeHead(401); return res.end(JSON.stringify({ error: { description: 'Authentication failed' } })); }
      const body = b ? JSON.parse(b) : {};
      if (req.method === 'GET' && req.url.startsWith('/plans')) return res.end(JSON.stringify({ items: plans }));
      if (req.method === 'POST' && req.url === '/plans') { const p = { id: `plan_${plans.length + 1}`, ...body }; plans.push(p); return res.end(JSON.stringify(p)); }
      if (req.method === 'POST' && req.url === '/subscriptions') { const s = { id: `sub_${crypto.randomBytes(4).toString('hex')}`, status: 'created', ...body }; subs[s.id] = s; return res.end(JSON.stringify(s)); }
      const m = req.url.match(/^\/subscriptions\/(sub_\w+)(\/cancel)?$/);
      if (m && subs[m[1]]) {
        if (m[2]) { subs[m[1]].cancelled = body; subs[m[1]].status = body.cancel_at_cycle_end ? subs[m[1]].status : 'cancelled'; }
        return res.end(JSON.stringify(subs[m[1]]));
      }
      res.writeHead(404); res.end('{}');
    });
  }).listen(0);
  await new Promise((r) => setTimeout(r, 30));
  srv = await startServer({ RAZORPAY_API_URL: `http://127.0.0.1:${fake.address().port}`, ADMIN_EMAILS: 'owner@funnelhive.test' });
  api = srv.api;
  ADMIN = (await register(api, 'owner@funnelhive.test')).token;
  await new Promise((r) => setTimeout(r, 150));
  const link = srv.log().match(/To: owner@funnelhive\.test[\s\S]*?\/verify\?token=([a-f0-9.]+)/);
  await api('/auth/verify', 'POST', { token: link[1] });
  ({ token: ADMIN } = await enable2fa(api, ADMIN)); // the admin panel needs 2-step login
  ({ token: S1, email: S1email } = await register(api));
});
after(async () => { await srv.stop(); fake.close(); });

const webhook = (event, sub, payment) => {
  const raw = JSON.stringify({ event, payload: { subscription: { entity: sub }, ...(payment ? { payment: { entity: payment } } : {}) } });
  return fetch(`${srv.base}/api/billing/webhook`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-razorpay-signature': sign(WH, raw) }, body: raw });
};

test('new sellers start a 14-day trial with trial AI credits; only admins reach the admin panel', async () => {
  const me = (await api('/me', 'GET', null, S1)).data;
  assert.equal(me.billing.status, 'trialing');
  assert.equal(me.billing.daysLeft, 14);
  assert.equal(me.credits.limit, 100);
  assert.equal(me.admin, false);
  assert.equal((await api('/admin/overview', 'GET', null, S1)).status, 403);
  const a = (await api('/me', 'GET', null, ADMIN)).data;
  assert.equal(a.admin, true);
  assert.equal(a.billing.status, 'admin');
  assert.equal((await api('/admin/overview', 'GET', null, ADMIN)).status, 200);
});

test('admin sets prices, company GST details and the platform Razorpay account', async () => {
  const bad = await api('/admin/settings', 'PUT', { razorpay: { keyId: KEY, keySecret: 'wrong' } }, ADMIN);
  assert.equal(bad.status, 400);
  assert.equal((await api('/admin/settings', 'PUT', { company: { gstin: 'NOTAGSTIN' } }, ADMIN)).status, 400);
  const s = await api('/admin/settings', 'PUT', { company: { name: 'Hive Labs Pvt Ltd', gstin: '27ABCDE1234F1Z5', state: 'Maharashtra', address: 'Pune', invoicePrefix: 'FH' }, razorpay: { keyId: KEY, keySecret: SECRET, webhookSecret: WH } }, ADMIN);
  assert.equal(s.status, 200, JSON.stringify(s.data));
  assert.equal(s.data.razorpay.ready, true);
  assert.equal(s.data.razorpay.hasSecret, true);
  assert.ok(!JSON.stringify(s.data).includes(SECRET), 'secret never returned');
  assert.equal(s.data.prices.monthly.amount, 1499);
  assert.equal(s.data.prices.yearly.amount, 14999);
  assert.equal(s.data.prices.yearlySaves, 1499 * 12 - 14999);
  const audit = (await api('/admin/audit', 'GET', null, ADMIN)).data;
  assert.ok(audit.some((x) => x.action === 'settings' && /razorpay/.test(x.detail)));
});

let subId;
test('subscribing during the trial: mandate now, first charge when the trial ends; invoice on each charge', async () => {
  const need = await api('/billing/subscribe', 'POST', { interval: 'monthly' }, S1);
  assert.equal(need.status, 400);
  assert.equal(need.data.needDetails, true);
  assert.equal((await api('/billing/details', 'PUT', { name: 'Asha Yoga', state: 'Karnataka', gstin: '27ABCDE1234F1Z5' }, S1)).status, 400, 'GSTIN must match the state');
  assert.equal((await api('/billing/details', 'PUT', { name: 'Asha Yoga', state: 'Karnataka', gstin: '29ABCDE1234F1Z5', address: 'Bengaluru' }, S1)).status, 200);
  const co = (await api('/billing/subscribe', 'POST', { interval: 'monthly' }, S1)).data;
  assert.equal(co.key, KEY);
  assert.equal(co.startsLater, true);
  subId = co.subscription_id;
  const sub = subs[subId];
  assert.equal(plans.at(-1).item.amount, 149900, 'plan amount in paise');
  assert.ok(sub.start_at * 1000 > Date.now() + 13 * DAY, 'first charge waits for the trial to end');
  assert.equal(sub.notes.userId.length > 0, true);
  // checkout result with a forged signature is refused
  assert.equal((await api('/billing/verify', 'POST', { razorpay_payment_id: 'pay_1', razorpay_subscription_id: subId, razorpay_signature: 'nope' }, S1)).status, 400);
  sub.status = 'authenticated';
  const v = await api('/billing/verify', 'POST', { razorpay_payment_id: 'pay_1', razorpay_subscription_id: subId, razorpay_signature: sign(SECRET, `pay_1|${subId}`) }, S1);
  assert.equal(v.status, 200, JSON.stringify(v.data));
  assert.equal(v.data.access.status, 'active');
  assert.equal(v.data.invoices.length, 0, 'nothing charged yet');
  // Razorpay charges at the end of the trial and tells us by webhook
  assert.equal((await fetch(`${srv.base}/api/billing/webhook`, { method: 'POST', headers: { 'x-razorpay-signature': 'bad' }, body: '{}' })).status, 400);
  const start = Math.floor(Date.now() / 1000);
  Object.assign(sub, { status: 'active', current_start: start, current_end: start + 30 * 86400 });
  assert.equal((await webhook('subscription.charged', sub, { id: 'pay_2' })).status, 200);
  await webhook('subscription.charged', sub, { id: 'pay_2' }); // Razorpay retries are harmless
  const b = (await api('/billing', 'GET', null, S1)).data;
  assert.equal(b.invoices.length, 1);
  const inv = (await api(`/billing/invoices/${b.invoices[0].id}`, 'GET', null, S1)).data;
  assert.match(inv.number, /^FH\/20\d\d-\d\d\/0001$/);
  assert.equal(inv.total, 1499);
  assert.equal(inv.taxable, 1270.34);
  assert.equal(inv.igst, 228.66, 'Karnataka buyer, Maharashtra seller → IGST');
  assert.equal(inv.cgst, 0);
  assert.equal(inv.billedTo.gstin, '29ABCDE1234F1Z5');
  assert.equal(inv.company.name, 'Hive Labs Pvt Ltd');
  assert.equal((await api(`/billing/invoices/${inv.id}`, 'GET', null, ADMIN)).status, 404, 'a seller’s invoice is theirs');
  assert.equal((await api('/me', 'GET', null, S1)).data.credits.limit, 1500, 'paid plan credits');
  const ov = (await api('/admin/overview', 'GET', null, ADMIN)).data;
  assert.equal(ov.mrr, 1499);
  assert.equal(ov.paying.monthly, 1);
  assert.equal(ov.revenue30, 1499);
});

test('a failed renewal keeps the account working for the grace period; cancelling keeps it until the period ends', async () => {
  const sub = subs[subId];
  await webhook('subscription.halted', { ...sub, status: 'halted' });
  let me = (await api('/me', 'GET', null, S1)).data;
  assert.equal(me.billing.ok, true);
  assert.equal(me.billing.planStatus, 'past_due');
  await webhook('subscription.charged', { ...sub, status: 'active', current_start: sub.current_start + 30 * 86400, current_end: sub.current_end + 30 * 86400 }, { id: 'pay_3' });
  me = (await api('/me', 'GET', null, S1)).data;
  assert.equal(me.billing.status, 'active');
  assert.equal((await api('/billing', 'GET', null, S1)).data.invoices.length, 2);
  const c = await api('/billing/cancel', 'POST', {}, S1);
  assert.equal(c.status, 200, JSON.stringify(c.data));
  assert.deepEqual(sub.cancelled, { cancel_at_cycle_end: 1 });
  assert.equal(c.data.access.ok, true, 'paid time is kept');
  assert.equal(c.data.access.cancelAtPeriodEnd, true);
});

test('when the trial is over the account is read-only; live pages go offline after the grace days', async () => {
  await api('/admin/settings', 'PUT', { trialDays: 0, pagesOfflineAfterDays: 0 }, ADMIN);
  await new Promise((r) => setTimeout(r, 5100)); // platform settings are cached for 5s per process
  const { token } = await register(api);
  const me = (await api('/me', 'GET', null, token)).data;
  assert.equal(me.billing.ok, false);
  assert.equal(me.billing.status, 'expired');
  const r = await api('/funnels', 'POST', { name: 'x' }, token);
  assert.equal(r.status, 402);
  assert.equal(r.data.locked, true);
  assert.equal((await api('/funnels', 'GET', null, token)).status, 200, 'can still look around');
  assert.equal((await api('/billing', 'GET', null, token)).status, 200, 'and pay');
  await api('/admin/settings', 'PUT', { trialDays: 14, pagesOfflineAfterDays: 7 }, ADMIN);
});

test('admin actions: comp, suspend (pages offline, signed out), credits, impersonate, delete', async () => {
  const { token: t2, email: e2 } = await register(api);
  const id2 = (await api('/me', 'GET', null, t2)).data.id;
  const f = (await api('/templates/yoga/use', 'POST', {}, t2)).data;
  await api(`/funnels/${f.id}`, 'PUT', { published: true }, t2);
  assert.equal((await api(`/public/${f.slug}`)).status, 200);
  const act = (action, extra = {}) => api(`/admin/users/${id2}/action`, 'POST', { action, ...extra }, ADMIN);
  const list = (await api(`/admin/users?q=${encodeURIComponent(e2)}`, 'GET', null, ADMIN)).data;
  assert.equal(list.users.length, 1);
  assert.equal(list.users[0].funnels, 1);

  // AI credits: a custom limit, then the month's credits run out
  assert.equal((await act('set_credits', { limit: 5 })).status, 200);
  assert.equal((await api('/ai/generate', 'POST', { prompt: 'Yoga classes in Pune' }, t2)).status, 200);
  const out = await api('/ai/generate', 'POST', { prompt: 'Yoga classes in Pune' }, t2);
  assert.equal(out.status, 402);
  assert.equal(out.data.credits, true);
  assert.equal((await api('/me', 'GET', null, t2)).data.credits.used, 5);

  assert.equal((await act('suspend', { note: 'chargeback' })).status, 200);
  assert.equal((await api('/me', 'GET', null, t2)).status, 401, 'signed out');
  assert.equal((await api(`/public/${f.slug}`)).status, 404, 'pages offline at once');
  assert.equal((await act('unsuspend')).status, 200);
  assert.equal((await api(`/public/${f.slug}`)).status, 200);
  assert.equal((await act('comp', { note: 'partner' })).status, 200);
  const detail = (await api(`/admin/users/${id2}`, 'GET', null, ADMIN)).data;
  assert.equal(detail.access.status, 'comped');
  assert.deepEqual(detail.audit.map((x) => x.action).slice(0, 4), ['comp', 'unsuspend', 'suspend', 'set_credits']);

  assert.equal((await act('impersonate')).status, 400, 'a reason is needed');
  const imp = (await act('impersonate', { reason: 'Helping with a refund' })).data.token;
  const asSeller = (await api('/me', 'GET', null, imp)).data;
  assert.equal(asSeller.email, e2);
  assert.equal(asSeller.impersonating, true);
  assert.equal((await api('/admin/overview', 'GET', null, imp)).status, 403);

  assert.equal((await act('delete', { confirm: 'wrong' })).status, 400);
  assert.equal((await act('delete', { confirm: e2 })).status, 200);
  assert.equal((await api(`/public/${f.slug}`)).status, 404);
  assert.equal((await api(`/admin/users/${id2}`, 'GET', null, ADMIN)).status, 404);
});

test('sellers can export their data and delete their account', async () => {
  const { token, email } = await register(api);
  await api('/templates/yoga/use', 'POST', {}, token);
  const ex = await fetch(`${srv.base}/api/account/export`, { headers: { authorization: `Bearer ${token}` } });
  assert.match(ex.headers.get('content-disposition'), /attachment/);
  const data = await ex.json();
  assert.equal(data.account.email, email);
  assert.equal(data.funnels.length, 1);
  assert.ok(!JSON.stringify(data).includes('"hash"'), 'no password hash in the export');
  assert.equal((await api('/account/delete', 'POST', { password: 'wrong', confirm: 'DELETE' }, token)).status, 401);
  assert.equal((await api('/account/delete', 'POST', { password: 'secret123', confirm: 'DELETE' }, token)).status, 200);
  assert.equal((await api('/me', 'GET', null, token)).status, 401);
  // a seller with a running subscription cancels it first
  assert.equal((await api('/account/delete', 'POST', { password: 'secret123', confirm: 'DELETE' }, S1)).status, 200, 'S1 already cancelled → allowed');
  void S1email;
});
