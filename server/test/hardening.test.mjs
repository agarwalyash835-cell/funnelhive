// Regression tests for the issues found in the security, data and AI audits.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startServer, register } from './helpers.mjs';
import { totp } from '../security.js';

let srv, api, T, M, Q, A, W;
before(async () => {
  srv = await startServer();
  api = srv.api;
  T = (await register(api)).token;
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ff-hard-'));
  M = await import('../templates.js');
  Q = await import('../quality.js');
  A = await import('../actions.js');
  W = await import('../webhooks.js');
});
after(() => srv.stop());

// ---------- security ----------
test('SSRF guard: IPv4 hidden inside IPv6 is judged as the IPv4 address', () => {
  for (const ip of ['127.0.0.1', '::1', '::ffff:127.0.0.1', '::ffff:7f00:1', '::7f00:1', '::ffff:a9fe:a9fe', '64:ff9b::7f00:1', '::ffff:0:7f00:1', '::ffff:10.0.0.1', 'fe80::1', 'fd00::1', '::', '2002:7f00:1::1'])
    assert.equal(W.isPrivateIp(ip), true, ip);
  for (const ip of ['8.8.8.8', '::ffff:8.8.8.8', '::ffff:808:808', '2606:4700:4700::1111'])
    assert.equal(W.isPrivateIp(ip), false, ip);
});

test('a cross-sell index that isn’t a real item can’t create a free "paid" order', async () => {
  const f = (await api('/templates/yoga/use', 'POST', {}, T)).data;
  await api(`/funnels/${f.id}`, 'PUT', { published: true }, T);
  const ty = f.steps.find((s) => s.type === 'thankyou');
  const cs = ty.blocks.find((b) => b.type === 'crosssell');
  for (const itemIndex of ['__proto__', 'length', 'constructor', -1, 99, '1.5']) {
    const r = await api(`/public/${f.slug}/pay/start`, 'POST', { stepId: ty.id, blockId: cs.id, itemIndex, email: 'victim@x.in' });
    assert.equal(r.status === 400 || r.data.provider === 'demo', true, String(itemIndex));
    const o = await api(`/public/${f.slug}/order`, 'POST', { stepId: ty.id, blockId: cs.id, itemIndex, email: 'victim@x.in' });
    assert.equal(o.status, 400, String(itemIndex));
  }
});

test('password reset still needs the 2-step code when 2-step login is on', async () => {
  const email = `tfa${Date.now()}@test.dev`;
  const tok = (await register(api, email)).token;
  const { secret } = (await api('/auth/2fa/setup', 'POST', {}, tok)).data;
  await api('/auth/2fa/enable', 'POST', { code: totp(secret, Date.now() - 30000) }, tok); // each code works once: consecutive steps below
  await api('/auth/forgot', 'POST', { email });
  await new Promise((r) => setTimeout(r, 200));
  const link = srv.log().match(/reset\?token=([\w.]+)/g)?.pop();
  assert.ok(link, 'reset link printed in the log');
  const token = link.split('=')[1];
  const r = await api('/auth/reset', 'POST', { token, password: 'newpass123' });
  assert.equal(r.data.twoFactorRequired, true);
  assert.equal(r.data.token, undefined, 'no session without the code');
  assert.equal((await api('/auth/login', 'POST', { email, password: 'secret123', code: totp(secret) })).status, 200, 'password unchanged');
  assert.equal((await api('/auth/reset', 'POST', { token, password: 'newpass123', code: '000000' })).status, 401);
  const ok = await api('/auth/reset', 'POST', { token, password: 'newpass123', code: totp(secret, Date.now() + 30000) });
  assert.ok(ok.data.token);
});

test('applications: skipping a qualifying question doesn’t pass it; the step must belong to the funnel; inputs are capped', async () => {
  const v = (await api('/templates/v-founders/use', 'POST', {}, T)).data;
  await api(`/funnels/${v.id}`, 'PUT', { published: true }, T);
  const apply = v.steps[1];
  assert.equal((await api(`/public/${v.slug}/lead`, 'POST', { stepId: apply.id, email: 'skip@x.in', fields: {} })).data.qualified, false);
  assert.equal((await api(`/public/${v.slug}/lead`, 'POST', { stepId: 'nope', email: 'x@x.in' })).status, 400);
  assert.equal((await api(`/public/${v.slug}/lead`, 'POST', { stepId: { huge: 'x'.repeat(5000) }, email: 'x@x.in' })).status, 400);
  const y = (await api('/templates/yoga/use', 'POST', {}, T)).data;
  await api(`/funnels/${y.id}`, 'PUT', { published: true }, T);
  const co = y.steps.find((s) => s.type === 'checkout');
  await api(`/public/${y.slug}/abandon`, 'POST', { notice: true, stepId: co.id, email: 'cart@x.in', name: 'A' });
  await api(`/public/${y.slug}/abandon`, 'POST', { notice: true, stepId: { x: 1 }, email: 'cart@x.in', name: { evil: true }, phone: '9'.repeat(100000) });
  const cart = (await api('/orders', 'GET', null, T)).data.abandoned.find((a) => a.email === 'cart@x.in');
  assert.ok(cart.phone.length <= 40 && typeof cart.name === 'string');
});

test('drafts can’t be read without the preview key; bad funnel input is a 400', async () => {
  const d = (await api('/funnels', 'POST', { name: 'Hidden launch' }, T)).data;
  assert.equal((await api(`/public/${d.slug}?preview=1`)).status, 404);
  const { previewKey } = (await api(`/funnels/${d.id}`, 'GET', null, T)).data;
  assert.equal((await api(`/public/${d.slug}?preview=1&pv=${previewKey}`)).status, 200);
  for (const body of [{ steps: 'oops' }, { steps: [null] }, { name: { x: 1 } }, { published: 'yes' }, { theme: [] }]) assert.equal((await api(`/funnels/${d.id}`, 'PUT', body, T)).status, 400, JSON.stringify(body));
  assert.notEqual((await api('/automations', 'POST', { name: 'x', trigger: { type: 'lead' }, steps: [null] }, T)).status, 500);
  assert.notEqual((await api('/crm/fields', 'PUT', { fields: [null] }, T)).status, 500);
});

test('once-per-customer codes need the email; popup codes only work on their funnel', async () => {
  const f = (await api('/templates/yoga/use', 'POST', {}, T)).data;
  await api(`/funnels/${f.id}`, 'PUT', { published: true }, T);
  const co = f.steps.find((s) => s.type === 'checkout');
  await api('/coupons', 'POST', { code: 'ONCE', value: 10, oncePerCustomer: true }, T);
  assert.equal((await api(`/public/${f.slug}/coupon`, 'POST', { code: 'ONCE', stepId: co.id })).data.valid, false);
  assert.equal((await api(`/public/${f.slug}/coupon`, 'POST', { code: 'ONCE', email: 'a@x.in', stepId: co.id })).data.valid, true);
  const pop = (await api('/coupons', 'GET', null, T)).data.find((c) => c.code === 'INDIA10');
  assert.ok(pop.funnelIds.length >= 1, 'popup coupon is scoped to the funnels that show it');
});

test('demo data never touches real funnels; deleting a funnel keeps its orders', async () => {
  const tok = (await register(api)).token;
  const mine = (await api('/funnels', 'POST', { name: 'My real draft' }, tok)).data;
  await api('/demo/seed', 'POST', {}, tok);
  const after = (await api('/funnels', 'GET', null, tok)).data;
  assert.equal(after.find((f) => f.id === mine.id).published, false, 'the seller’s draft stays unpublished');
  assert.ok(after.filter((f) => f.name.endsWith('(demo)')).length === 2);
  const demo = after.find((f) => f.name.endsWith('(demo)'));
  const full = (await api(`/funnels/${demo.id}`, 'GET', null, tok)).data;
  await api(`/public/${full.slug}/lead`, 'POST', { stepId: full.steps[0].id, email: 'real.person@gmail.in' });
  await api('/demo', 'DELETE', null, tok);
  const left = (await api('/funnels', 'GET', null, tok)).data;
  assert.ok(left.some((f) => f.id === demo.id), 'a demo funnel with a real sign-up is kept');
  // delete a funnel that has an order → the order stays, labelled
  const y = (await api('/templates/yoga/use', 'POST', {}, tok)).data;
  await api(`/funnels/${y.id}`, 'PUT', { published: true }, tok);
  const o = (await api(`/public/${y.slug}/order`, 'POST', { stepId: y.steps.find((s) => s.type === 'checkout').id, email: 'keep@x.in' })).data;
  await api(`/funnels/${y.id}`, 'DELETE', null, tok);
  const kept = (await api('/orders', 'GET', null, tok)).data.orders.find((x) => x.id === o.orderId);
  assert.ok(kept, 'order kept');
  assert.match(kept.funnel, /\(deleted\)$/);
});

test('record ids are 64-bit and inserts never overwrite', async () => {
  const db = await import('../db.js');
  assert.equal(db.uid().length, 16);
  const r = db.T.saved.insert({ userId: 'u1', name: 'a', at: 1 });
  assert.throws(() => db.T.saved.insert({ id: r.id, userId: 'u2', name: 'b', at: 2 }));
  assert.equal(db.T.saved.get(r.id).name, 'a');
});

// ---------- AI ----------
const audit = (t) => { const f = M.getTemplate(t.id); f.theme = t.theme; return f; };
const tpl = (id) => M.allTemplates().find((t) => t.id === id);

test('quality gate: FREE webinar heroes stay free; every priced hero must match; seller questions are never padded', () => {
  const t = tpl('w-ai');
  const f = audit(t);
  const reg = f.steps[0].blocks.find((b) => b.type === 'hero');
  reg.props.cardPrice = 'FREE (worth ₹1,999)';
  assert.deepEqual(Q.audit(f, Q.blueprintOf(t)), []);
  Q.enforce(f, M.getTemplate('w-ai'), Q.blueprintOf(t));
  assert.equal(reg.props.cardPrice, 'FREE (worth ₹1,999)');
  const replay = f.steps[2].blocks.find((b) => b.type === 'hero');
  replay.props.cardPrice = '₹1,234';
  assert.ok(Q.audit(f, Q.blueprintOf(t)).some((i) => /cardPrice/.test(i.msg)), 'the replay hero is checked too');
  // an application form with the seller's own 4 questions stays theirs
  const v = tpl('v-founders');
  const g = audit(v);
  const form = g.steps[1].blocks.find((b) => b.type === 'form');
  form.props.fields = [{ label: 'Full name', type: 'text', required: true }, { label: 'Email', type: 'email', required: true }, { label: 'Which product name do you sell?', type: 'text' }, { label: 'Budget', type: 'select', options: 'Low, High', reject: 'Low' }];
  Q.enforce(g, M.getTemplate('v-founders'), Q.blueprintOf(v));
  assert.deepEqual(form.props.fields.map((x) => x.label), ['Full name', 'Email', 'Which product name do you sell?', 'Budget']);
});

test('quality gate: an unknown layout keeps the AI’s section; webinar thank-you pages land in the right slots', () => {
  const t = tpl('yoga');
  const f = audit(t);
  const hero = f.steps[0].blocks.find((b) => b.type === 'hero');
  hero.props.variant = 'webinar'; hero.props.headline = 'My own *custom* headline for this yoga studio';
  Q.enforce(f, M.getTemplate('yoga'), Q.blueprintOf(t));
  const h2 = f.steps[0].blocks.find((b) => b.type === 'hero');
  assert.equal(h2.props.headline, 'My own *custom* headline for this yoga studio');
  assert.ok(h2.props.variant && h2.props.variant !== 'webinar');
  // AI dropped "You're registered": its post-purchase welcome page must not become the registration confirmation
  const w = tpl('w-bakery');
  const g = audit(w);
  const welcome = g.steps[5];
  g.steps = g.steps.filter((_, i) => i !== 1);
  Q.enforce(g, M.getTemplate('w-bakery'), Q.blueprintOf(w));
  assert.equal(g.steps[5].id, welcome.id, 'the welcome page stays after the checkout');
  assert.notEqual(g.steps[1].id, welcome.id);
});

test('matching: webinar and application prompts get the right kind of funnel; sales prompts never get a webinar', () => {
  const pick = (p) => M.similarTemplates(p, 1)[0];
  assert.equal(pick('Free webinar on stock market investing, sell my course at ₹4,999').type, 'webinar');
  assert.ok(pick('Free webinar on stock market investing, sell my course at ₹4,999').steps.some((s) => s.type === 'checkout'));
  assert.equal(pick('Free masterclass on stock trading').type, 'webinar');
  assert.equal(pick('Fitness coaching for women — apply for a call, programme ₹25,000').type, 'vsl');
  assert.equal(pick('Handmade soy candles ₹799').type, 'sales');
  assert.equal(pick('Maths tuition for class 10, free demo class').id, 'tutoring');
  assert.equal(pick('Free webinar on AI for small business').id, 'w-ai');
});

test('personalisation: one price everywhere on a webinar; clean names; the webinar badge stays', () => {
  const f = M.matchTemplate('Free masterclass: how to start a home bakery, upsell my baking course at ₹3,999 in Jaipur');
  const s = JSON.stringify(f);
  assert.ok(!s.includes('₹5,999'), 'no old price left');
  const replay = f.steps.find((x) => x.slug === 'replay');
  assert.equal(replay.blocks.find((b) => b.type === 'hero').props.cardPrice, '₹3,999');
  assert.ok(!/Trusted in/.test(f.steps[0].blocks.find((b) => b.type === 'hero').props.badge));
  assert.deepEqual(M.parsePrompt('Handmade soy candles at ₹799 in Jaipur').name, 'Handmade Soy Candles');
  assert.equal(M.parsePrompt('Fitness coaching for women — apply for a call').audience, 'women');
});

test('chat: no upsells without a checkout; cross-sells after the purchase; price and hero layout by chat; colours stay colours', () => {
  const v = M.getTemplate('v-founders');
  const r = A.offlineChat('add an upsell', v, v.steps[0].id);
  assert.equal(r.actions.length, 0);
  assert.match(r.reply, /no checkout/);
  const w = M.getTemplate('w-ai');
  const cs = A.offlineChat('add cross-sells', w, w.steps[0].id);
  A.applyActions(w, cs.actions, w.steps[0].id);
  assert.ok(!w.steps[1].blocks.some((b) => b.type === 'crosssell'), 'not on the free registration confirmation');
  assert.ok(w.steps[5].blocks.some((b) => b.type === 'crosssell'));
  const p = A.offlineChat('set price to 7999', w, w.steps[0].id);
  A.applyActions(w, p.actions, w.steps[0].id);
  assert.equal(w.steps[2].blocks.find((b) => b.type === 'hero').props.cardPrice, '₹7,999');
  assert.equal(w.steps[3].blocks.find((b) => b.type === 'checkout').props.price, 7999);
  assert.ok(!JSON.stringify(w.steps[2]).includes('₹14,999'));
  const y = M.getTemplate('yoga');
  const style = y.theme.style;
  A.applyActions(y, A.offlineChat('change colour to gold', y, y.steps[0].id).actions, y.steps[0].id);
  assert.equal(y.theme.style, style);
  A.applyActions(y, A.offlineChat('change the hero to video', y, y.steps[0].id).actions, y.steps[0].id);
  assert.equal(y.steps[0].blocks.find((b) => b.type === 'hero').props.variant, 'video');
});
