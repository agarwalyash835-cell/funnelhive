// Affiliate program (affiliates.js): sign-up with masked payout details, ?ref= link and coupon attribution (the
// coupon wins), the cookie window, self-referral, the hold period → approved, partial refund / full refund reversal,
// COD earning only once paid (and reversed when cancelled), payouts, cross-seller isolation, the portal's sign-in link.
// A "day" is 1 s here (AFF_DAY_MS), so a 2-day hold and a 3-day cookie window pass within the test.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { startServer, register } from './helpers.mjs';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const ADDR = { line1: '12, MG Road', city: 'Bengaluru', state: 'Karnataka', pincode: '560001' };
const UA = { 'user-agent': 'Mozilla/5.0 (Linux; Android 14) Chrome/126 Mobile' };
let srv, api, A, B, fA, stepA, fB, stepB, prog, aff1, aff2;
const email = () => `b${crypto.randomUUID().slice(0, 8)}@example.in`;

async function shopFunnel(token) {
  let f = (await api('/templates/pickle/use', 'POST', {}, token)).data;
  const step = f.steps.find((s) => s.blocks.some((b) => b.type === 'checkout'));
  const steps = f.steps.map((s) => (s.id !== step.id ? s : { ...s, blocks: s.blocks.map((b) => (b.type === 'checkout' ? { ...b, props: { ...b.props, price: 1000, bumpEnabled: true, bumpPrice: 200, cod: true, shipping: 'address', shippingFee: 50 } } : b)) }));
  f = (await api(`/funnels/${f.id}`, 'PUT', { steps, published: true }, token)).data;
  return [f, f.steps.find((s) => s.id === step.id)];
}
const click = async (f, ref, headers = UA) => (await api(`/public/${f.slug}/aff`, 'POST', { ref }, null, headers)).data;
const buy = async (f, step, extra = {}, path = 'order') => { const r = await api(`/public/${f.slug}/${path}`, 'POST', { stepId: step.id, email: email(), name: 'Asha Rao', phone: '9812345678', address: ADDR, withBump: true, ...extra }); assert.equal(r.status, 200, JSON.stringify(r.data)); return r.data.orderId; };
const comms = async (token = A, qs = '') => (await api(`/affiliates/commissions${qs}`, 'GET', null, token)).data.commissions;
const commOf = async (orderId) => (await comms()).find((c) => c.orderId === orderId);

before(async () => {
  srv = await startServer({ AFF_DAY_MS: '1000', AFF_TICK_MS: '300', APP_URL: 'https://app.example.in' });
  api = srv.api;
  A = (await register(api)).token;
  B = (await register(api)).token;
  [fA, stepA] = await shopFunnel(A);
  [fB, stepB] = await shopFunnel(B);
  const r = await api('/affiliates/program', 'PUT', { enabled: true, slug: 'asha-store', approval: 'auto', defaultRate: { type: 'percent', value: 10 }, holdDays: 2, cookieDays: 3, minPayout: 0, terms: 'Be nice.' }, A);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  prog = r.data.program;
  assert.equal(r.data.signupUrl, 'https://app.example.in/affiliate/asha-store');
  assert.equal((await api('/affiliates/program', 'PUT', { enabled: true, slug: 'asha-store' }, B)).status, 400, 'a page address is one seller’s');
  assert.equal((await api('/affiliates/program', 'PUT', { enabled: true, approval: 'auto' }, B)).status, 200);
});
after(() => srv?.stop());

test('sign-up: auto-approved, payout details stored encrypted and shown masked', async () => {
  const pub = (await api('/aff/asha-store')).data;
  assert.equal(pub.commission, '10% of each sale');
  assert.equal((await api('/aff/asha-store/join', 'POST', { name: 'Priya', email: 'priya@aff.in', phone: '9900011122' })).status, 400, 'terms must be accepted');
  assert.equal((await api('/aff/asha-store/join', 'POST', { name: 'Priya', email: 'priya@aff.in', agree: true, payout: { upi: 'bad upi' } })).status, 400);
  const j = await api('/aff/asha-store/join', 'POST', { name: 'Priya Sharma', email: 'Priya@Aff.in', phone: '9900011122', agree: true, payout: { upi: 'priyasharma@okaxis' } });
  assert.equal(j.status, 200, JSON.stringify(j.data));
  assert.equal(j.data.status, 'approved');
  assert.equal((await api('/aff/asha-store/join', 'POST', { name: 'P', email: 'priya@aff.in', agree: true })).status, 409);
  const list = (await api('/affiliates', 'GET', null, A)).data;
  aff1 = list.affiliates.find((a) => a.email === 'priya@aff.in');
  assert.ok(aff1 && aff1.code === j.data.code);
  assert.match(aff1.payout.upi, /^pr•+@okaxis$/);
  assert.ok(!JSON.stringify(list).includes('priyasharma@okaxis'), 'the full UPI ID is never in the list');
  assert.ok(!('payoutEnc' in aff1));
  assert.equal((await api(`/affiliates/${aff1.id}/payout-details`, 'POST', {}, A)).data.payout.upi, 'priyasharma@okaxis');
  assert.equal((await api(`/affiliates/${aff1.id}/payout-details`, 'POST', {}, B)).status, 404);
  // the seller's invite, with a coupon of their own
  const inv = await api('/affiliates', 'POST', { name: 'Karan Mehta', email: 'karan@aff.in', phone: '9811122233', coupon: 'karan15', payout: { account: '123456789012', ifsc: 'HDFC0001234', holder: 'Karan Mehta' } }, A);
  assert.equal(inv.status, 200, JSON.stringify(inv.data));
  aff2 = inv.data;
  assert.equal(aff2.coupon, 'KARAN15');
  assert.equal(aff2.payout.account, '••••9012');
  const cp = (await api('/coupons', 'GET', null, A)).data.find((c) => c.code === 'KARAN15');
  assert.ok(cp && cp.active && cp.value === 10);
});

test('link attribution: ?ref= click token → order carries the affiliate; shipping earns nothing; bots not counted', async () => {
  const c = await click(fA, aff1.code);
  assert.ok(c.ok && c.token);
  await click(fA, aff1.code, { 'user-agent': 'facebookexternalhit/1.1' });
  assert.equal((await click(fA, 'NOPE123')).ok, false);
  const oid = await buy(fA, stepA, { aff: c.token });
  const cm = await commOf(oid);
  assert.ok(cm, 'commission recorded');
  assert.equal(cm.affiliateId, aff1.id);
  assert.equal(cm.via, 'link');
  assert.equal(cm.status, 'pending');
  assert.equal(cm.amount, 120, '10% of ₹1000 + ₹200 bump, not the ₹50 shipping');
  assert.equal(cm.test, true, 'a demo-checkout order is a test sale');
  const a = (await api('/affiliates', 'GET', null, A)).data.affiliates.find((x) => x.id === aff1.id);
  assert.equal(a.stats.clicks, 1, 'the link-preview bot wasn’t counted');
  // a forged token earns nothing
  const forged = c.token.replace(/.$/, (ch) => (ch === 'A' ? 'B' : 'A'));
  assert.equal(await commOf(await buy(fA, stepA, { aff: forged })), undefined);
  globalThis.linkOrder = oid;
});

test('self-referral is blocked; the coupon beats the link', async () => {
  const t = (await click(fA, aff1.code)).token;
  const self = await buy(fA, stepA, { aff: t, email: 'PRIYA@aff.in' });
  assert.equal(await commOf(self), undefined, 'own email');
  const self2 = await buy(fA, stepA, { aff: t, phone: '+91 99000 11122' });
  assert.equal(await commOf(self2), undefined, 'own phone');
  const viaCoupon = await buy(fA, stepA, { aff: t, coupon: 'KARAN15', withBump: false });
  const cm = await commOf(viaCoupon);
  assert.equal(cm.affiliateId, aff2.id);
  assert.equal(cm.via, 'coupon');
  assert.equal(cm.amount, 90, '10% of ₹900 (after the 10% coupon)');
});

test('cookie window; hold period → approved; partial refund reduces, full refund reverses', async () => {
  const old = (await click(fA, aff1.code)).token;
  const full = await buy(fA, stepA, { aff: (await click(fA, aff1.code)).token });
  await wait(3200); // cookieDays 3 → 3 s; holdDays 2 → 2 s
  assert.equal(await commOf(await buy(fA, stepA, { aff: old })), undefined, 'a click older than the cookie window earns nothing');
  const cm = await commOf(globalThis.linkOrder);
  assert.equal(cm.status, 'approved', 'the hold period ended');
  // refund only the bump (item 1): its share of the commission comes off
  const r = await api(`/orders/${globalThis.linkOrder}/refund`, 'POST', { items: [1] }, A);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  await wait(700); // the job picks it up (reads sync too)
  const after1 = await commOf(globalThis.linkOrder);
  assert.equal(after1.amount, 100);
  assert.equal(after1.refunded, 20);
  assert.equal(after1.status, 'approved');
  assert.equal((await api(`/orders/${full}/refund`, 'POST', {}, A)).status, 200);
  const rev = await commOf(full);
  assert.equal(rev.status, 'reversed');
  assert.equal(rev.amount, 0);
  assert.equal(rev.reason, 'Refunded');
  const f1 = await comms(A, `?status=reversed&affiliateId=${aff1.id}`);
  assert.ok(f1.length >= 1 && f1.every((c) => c.status === 'reversed' && c.affiliateId === aff1.id), 'filters');
  const csv = await fetch(`${srv.base}/api/affiliates/commissions.csv`, { headers: { authorization: `Bearer ${A}` } });
  assert.match(await csv.text(), /^date,affiliate,code,order/);
});

test('COD: earns only once paid; cancelled COD is reversed; payouts mark approved real commissions paid', async () => {
  const t = (await click(fA, aff1.code)).token;
  const cod = await buy(fA, stepA, { aff: t }, 'cod');
  let cm = await commOf(cod);
  assert.equal(cm.status, 'awaiting', 'nothing earned while the cash isn’t collected');
  assert.equal(cm.test, false);
  const cod2 = await buy(fA, stepA, { aff: t }, 'cod');
  await wait(2200);
  assert.equal((await commOf(cod)).status, 'awaiting', 'the hold doesn’t start before the cash');
  assert.equal((await api(`/orders/${cod}/cod`, 'POST', { action: 'paid' }, A)).status, 200);
  assert.equal((await api(`/orders/${cod2}/cod`, 'POST', { action: 'cancel' }, A)).status, 200);
  cm = await commOf(cod);
  assert.equal(cm.status, 'pending');
  assert.equal(cm.amount, 120, 'the COD fee and shipping earn nothing');
  assert.equal((await commOf(cod2)).status, 'reversed');
  assert.equal((await api(`/affiliates/${aff1.id}/payouts`, 'POST', { reference: 'UPI123' }, A)).status, 400, 'only approved real sales can be paid');
  await wait(2200);
  assert.equal((await commOf(cod)).status, 'approved');
  assert.equal((await api(`/affiliates/${aff1.id}/payouts`, 'POST', {}, A)).status, 400, 'a reference is needed');
  const p = await api(`/affiliates/${aff1.id}/payouts`, 'POST', { reference: 'UPI123456' }, A);
  assert.equal(p.status, 200, JSON.stringify(p.data));
  assert.equal(p.data.amount, 120, 'test-checkout commissions aren’t paid out');
  assert.equal((await commOf(cod)).status, 'paid');
  assert.equal((await commOf(globalThis.linkOrder)).status, 'approved', 'the test sale stays unpaid');
  const pl = (await api('/affiliates/payouts', 'GET', null, A)).data.payouts;
  assert.equal(pl[0].reference, 'UPI123456');
  assert.match(pl[0].to, /@okaxis$/);
});

test('cross-seller isolation', async () => {
  const t = (await click(fA, aff1.code)).token;
  assert.equal((await click(fB, aff1.code)).ok, false, 'seller A’s code does nothing on seller B’s funnel');
  const oid = await buy(fB, stepB, { aff: t });
  assert.equal((await comms(B)).length, 0);
  assert.equal((await comms(A)).find((c) => c.orderId === oid), undefined);
  const lb = (await api('/affiliates', 'GET', null, B)).data;
  assert.equal(lb.affiliates.length, 0);
  assert.equal((await api(`/affiliates/${aff1.id}`, 'PUT', { status: 'blocked' }, B)).status, 404);
  assert.equal((await api(`/affiliates/${aff1.id}/payouts`, 'POST', { reference: 'X' }, B)).status, 404);
  // B's affiliate can't use A's coupon-linked code either
  const ib = await api('/affiliates', 'POST', { name: 'Other', email: 'other@aff.in', coupon: 'KARAN15' }, B);
  assert.equal(ib.status, 200, 'coupon codes are per seller');
});

test('portal: sign-in link by email, once; dashboard with links, coupon, masked payout; blocked affiliates are out', async () => {
  assert.equal((await api('/aff/asha-store/login', 'POST', { email: 'nobody@aff.in' })).data.link, undefined);
  const l = (await api('/aff/asha-store/login', 'POST', { email: 'karan@aff.in' })).data.link;
  assert.match(l, /^https:\/\/app\.example\.in\/affiliate\/asha-store\?login=L[0-9a-f]{48}$/);
  const token = new URL(l).searchParams.get('login');
  const s = await api('/aff/asha-store/session', 'POST', { token });
  assert.equal(s.status, 200);
  assert.equal((await api('/aff/asha-store/session', 'POST', { token })).status, 400, 'a link works once');
  const H = { 'x-affiliate': s.data.session };
  const me = (await api('/aff/asha-store/me', 'GET', null, null, H)).data;
  assert.equal(me.me.code, aff2.code);
  assert.equal(me.coupon.code, 'KARAN15');
  assert.ok(me.links.some((x) => x.url.endsWith(`/f/${fA.slug}?ref=${aff2.code}`)));
  assert.equal(me.me.payout.account, '••••9012');
  assert.ok(!JSON.stringify(me).includes('123456789012'));
  assert.equal(me.stats.sales, 1);
  assert.equal(me.commissions[0].amount, 90);
  assert.ok(!JSON.stringify(me.commissions).includes('@example.in'), 'no buyer details for affiliates');
  assert.equal((await api('/aff/asha-store/me', 'GET', null, null, { 'x-affiliate': 'A' + '0'.repeat(48) })).status, 401);
  // blocked: signed out, the coupon stops working
  assert.equal((await api(`/affiliates/${aff2.id}`, 'PUT', { status: 'blocked' }, A)).status, 200);
  assert.equal((await api('/aff/asha-store/me', 'GET', null, null, H)).status, 401);
  assert.equal((await api('/coupons', 'GET', null, A)).data.find((c) => c.code === 'KARAN15').active, false);
  // manual approval: a new sign-up waits, and its link does nothing yet
  await api('/affiliates/program', 'PUT', { approval: 'manual' }, A);
  const j = (await api('/aff/asha-store/join', 'POST', { name: 'Neha', email: 'neha@aff.in', agree: true })).data;
  assert.equal(j.status, 'pending');
  const neha = (await api('/affiliates', 'GET', null, A)).data.affiliates.find((a) => a.email === 'neha@aff.in');
  assert.equal((await click(fA, neha.code)).ok, false);
});
