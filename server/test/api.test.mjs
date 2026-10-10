// Regression suite: the behaviour that already works must keep working.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, register } from './helpers.mjs';
// checkouts of physical products ask where to ship
const ADDR = { line1: '4 Park Street', city: 'Kolkata', state: 'West Bengal', pincode: '700016' };

let srv, api, T, funnel;
before(async () => {
  srv = await startServer();
  api = srv.api;
  T = (await register(api)).token;
});
after(() => srv.stop());

test('auth: register, login, me, bad password', async () => {
  const email = `login${Date.now()}@test.dev`;
  assert.equal((await api('/auth/register', 'POST', { email, password: 'secret123' })).status, 200);
  assert.equal((await api('/auth/register', 'POST', { email, password: 'secret123' })).status, 409);
  const ok = await api('/auth/login', 'POST', { email, password: 'secret123' });
  assert.equal(ok.status, 200);
  assert.ok(ok.data.token);
  assert.equal((await api('/auth/login', 'POST', { email, password: 'wrong-pass' })).status, 401);
  const me = await api('/me', 'GET', null, ok.data.token);
  assert.equal(me.data.email, email);
  assert.equal((await api('/me')).status, 401);
});

test('health endpoint for Docker / load balancers', async () => {
  const h = await api('/health');
  assert.equal(h.status, 200);
  assert.equal(h.data.ok, true);
});

test('templates: 103 listed (53 sales, 25 VSL + application, 25+ webinar), each loads with a hero', async () => {
  const list = (await api('/templates')).data;
  assert.equal(list.length, 103);
  assert.equal(list.filter((t) => t.type === 'vsl').length, 25);
  assert.ok(list.filter((t) => t.type === 'webinar').length >= 25);
  assert.ok(list.every((t) => t.hero?.type === 'hero'));
  const vsl = (await api('/templates/v-founders')).data;
  assert.deepEqual(vsl.steps.map((s) => s.type), ['sales', 'optin', 'thankyou']);
  assert.ok(vsl.steps[1].blocks.find((b) => b.type === 'form').props.fields.some((f) => f.reject), 'the application screens applicants');
  const web = (await api('/templates/w-ai')).data;
  assert.deepEqual(web.steps.map((s) => s.type), ['optin', 'thankyou', 'sales', 'checkout', 'upsell', 'thankyou']);
  const t = (await api('/templates/yoga')).data;
  assert.deepEqual(t.steps.map((s) => s.type), ['sales', 'checkout', 'upsell', 'downsell', 'thankyou']);
});

test('ai generate (offline) builds a 5-step funnel', async () => {
  const r = await api('/ai/generate', 'POST', { prompt: 'Homemade mango pickles delivered across India' }, T);
  assert.equal(r.status, 200);
  funnel = r.data;
  assert.deepEqual(funnel.steps.map((s) => s.type), ['sales', 'checkout', 'upsell', 'downsell', 'thankyou']);
});

test('offline generation uses the prompt: name, price, city, audience', async () => {
  const f = (await api('/ai/generate', 'POST', { prompt: 'Online yoga classes for working women, ₹799 in Pune' }, T)).data;
  assert.equal(f.name, 'Online Yoga Classes');
  const blocks = f.steps.flatMap((s) => s.blocks);
  const hero = blocks.find((b) => b.type === 'hero').props;
  const chk = blocks.find((b) => b.type === 'checkout').props;
  assert.equal(chk.price, 799);
  assert.equal(chk.productName, 'Online Yoga Classes');
  assert.ok(chk.mrp > 799);
  assert.equal(hero.cardPrice, '₹799');
  assert.match(hero.badge, /Pune/);
  assert.match(hero.subheadline, /working women/);
  const up = blocks.find((b) => b.type === 'offer').props;
  assert.ok(up.price < 799 && up.price > 99, 'upsell scaled with the new price');
  // no price/city in the prompt → template values are kept
  const g = (await api('/ai/generate', 'POST', { prompt: 'UPSC coaching with personal mentorship' }, T)).data;
  assert.equal(g.steps.flatMap((s) => s.blocks).find((b) => b.type === 'checkout').props.price, 4999);
});

test('funnel CRUD: list, update, duplicate, other user cannot access', async () => {
  const list = (await api('/funnels', 'GET', null, T)).data;
  assert.ok(list.some((f) => f.id === funnel.id));
  const up = await api(`/funnels/${funnel.id}`, 'PUT', { name: 'Renamed', published: true }, T);
  assert.equal(up.data.name, 'Renamed');
  funnel = up.data;
  const dup = await api(`/funnels/${funnel.id}/duplicate`, 'POST', {}, T);
  assert.equal(dup.data.name, 'Renamed (copy)');
  const other = (await register(api)).token;
  assert.equal((await api(`/funnels/${funnel.id}`, 'GET', null, other)).status, 404);
});

test('ai chat (offline) applies structural edits', async () => {
  const r = await api('/ai/chat', 'POST', { funnelId: funnel.id, stepId: funnel.steps[0].id, message: 'make it dark and change colour to green' }, T);
  assert.equal(r.data.funnel.theme.style, 'midnight');
  assert.equal(r.data.funnel.theme.primary, '#16a34a');
  const r2 = await api('/ai/chat', 'POST', { funnelId: funnel.id, stepId: funnel.steps[0].id, message: 'remove the countdown and add a video' }, T);
  const types = r2.data.funnel.steps[0].blocks.map((b) => b.type);
  assert.ok(!types.includes('countdown') && types.includes('video'));
  funnel = r2.data.funnel;
});

test('public runtime: checkout + bump + coupon, upsell, cross-sell', async () => {
  await api('/coupons', 'POST', { code: 'save10', type: 'percent', value: 10 }, T);
  const pub = (await api(`/public/${funnel.slug}`)).data;
  const co = pub.steps.find((s) => s.type === 'checkout');
  const chk = co.blocks.find((b) => b.type === 'checkout').props;
  assert.equal((await api(`/public/${funnel.slug}/coupon`, 'POST', { code: 'SAVE10' })).data.valid, true);
  const o = (await api(`/public/${funnel.slug}/order`, 'POST', { stepId: co.id, email: 'b@x.dev', withBump: true, coupon: 'SAVE10', address: ADDR })).data;
  const disc = Math.round(chk.price * 0.1);
  assert.equal(o.total, chk.price - disc + chk.bumpPrice);
  const up = pub.steps.find((s) => s.type === 'upsell');
  const o2 = (await api(`/public/${funnel.slug}/order`, 'POST', { stepId: up.id, orderId: o.orderId })).data;
  assert.equal(o2.orderId, o.orderId);
  const ty = pub.steps.find((s) => s.type === 'thankyou');
  const cs = ty.blocks.find((b) => b.type === 'crosssell');
  const o3 = (await api(`/public/${funnel.slug}/order`, 'POST', { stepId: ty.id, orderId: o.orderId, blockId: cs.id, itemIndex: 0 })).data;
  assert.equal(o3.total, o2.total + Number(cs.props.items[0].price));
  const orders = (await api('/orders', 'GET', null, T)).data.orders;
  const mine = orders.find((x) => x.id === o.orderId);
  assert.deepEqual(mine.items.map((i) => i.kind), ['main', 'bump', 'upsell', 'crosssell']);
});

test('public runtime: leads, events, abandoned carts recovered by purchase', async () => {
  const pub = (await api(`/public/${funnel.slug}`)).data;
  const co = pub.steps.find((s) => s.type === 'checkout');
  await api(`/public/${funnel.slug}/event`, 'POST', { stepId: pub.steps[0].id, type: 'view', source: 'instagram', visitor: 'v1' });
  await api(`/public/${funnel.slug}/lead`, 'POST', { stepId: pub.steps[0].id, email: 'lead@x.dev' });
  await api(`/public/${funnel.slug}/abandon`, 'POST', { stepId: co.id, email: 'ab@x.dev', name: 'Ab' });
  let d = (await api('/orders', 'GET', null, T)).data;
  assert.ok(d.abandoned.some((a) => a.email === 'ab@x.dev'));
  // the recovery link goes back to the checkout they left
  assert.match(d.abandoned.find((a) => a.email === 'ab@x.dev').link, new RegExp(`/f/${funnel.slug}/${co.slug}$`));
  // the seller's own note and tags on an order
  const oid = d.orders[0].id;
  assert.deepEqual((await api(`/orders/${oid}`, 'PUT', { note: 'Called them', tags: ['VIP', ' VIP ', '', 'wholesale'] }, T)).data, { note: 'Called them', tags: ['VIP', 'wholesale'] });
  assert.equal((await api('/orders', 'GET', null, T)).data.orders.find((o) => o.id === oid).note, 'Called them');
  assert.equal((await api(`/orders/${oid}`, 'PUT', { note: 'x' }, (await register(api)).token)).status, 404, 'not someone else’s order');
  await api(`/public/${funnel.slug}/order`, 'POST', { stepId: co.id, email: 'ab@x.dev', address: ADDR });
  d = (await api('/orders', 'GET', null, T)).data;
  assert.ok(!d.abandoned.some((a) => a.email === 'ab@x.dev'));
  const contacts = (await api('/contacts', 'GET', null, T)).data;
  assert.ok(contacts.some((c) => c.email === 'lead@x.dev' && c.type === 'lead'));
});

test('unpublished funnel is not public', async () => {
  const f = (await api('/funnels', 'POST', { name: 'Draft one' }, T)).data;
  assert.equal((await api(`/public/${f.slug}`)).status, 404);
});

test('analytics: overview & funnel analytics shapes', async () => {
  const o = (await api('/analytics/overview?days=30', 'GET', null, T)).data;
  assert.equal(o.series.length, 30);
  assert.ok(Number.isInteger(o.totals.orders) && typeof o.totals.revenue === 'number');
  const fa = (await api(`/funnels/${funnel.id}/analytics?days=7`, 'GET', null, T)).data;
  assert.equal(fa.series.length, 7);
  assert.equal(fa.steps.length, funnel.steps.length);
});

test('demo seed creates data; marketing agents respond', async () => {
  const fresh = (await register(api)).token;
  await api('/demo/seed', 'POST', {}, fresh);
  const o = (await api('/analytics/overview?days=30', 'GET', null, fresh)).data;
  assert.ok(o.totals.orders > 50);
  const ag = (await api('/ai/agent', 'POST', { kind: 'ads' }, fresh)).data;
  assert.ok(ag.outputs.length >= 3);
});

test('demo data can be removed without touching real data', async () => {
  const { token } = await register(api);
  const f = (await api('/templates/yoga/use', 'POST', {}, token)).data;
  await api(`/funnels/${f.id}`, 'PUT', { published: true }, token);
  const co = f.steps.find((s) => s.type === 'checkout');
  // one real visit + order before seeding
  await api(`/public/${f.slug}/event`, 'POST', { stepId: f.steps[0].id, type: 'view', visitor: 'real1' });
  await api(`/public/${f.slug}/order`, 'POST', { stepId: co.id, email: 'real.buyer@shop.in' });
  await api('/demo/seed', 'POST', {}, token);
  assert.equal((await api('/me', 'GET', null, token)).data.hasDemo, true);
  const del = (await api('/demo', 'DELETE', null, token)).data;
  assert.ok(del.removed.orders > 10 && del.removed.events > 100);
  const o = (await api('/analytics/overview?days=30', 'GET', null, token)).data;
  assert.equal(o.totals.orders, 0, 'placed with no payment provider: a test order, not revenue');
  assert.deepEqual((await api('/orders', 'GET', null, token)).data.orders.map((x) => x.email), ['real.buyer@shop.in'], 'the real order survives');
  assert.equal(o.totals.views, 1, 'the real visit survives');
  assert.equal((await api('/me', 'GET', null, token)).data.hasDemo, false);
  assert.equal((await api('/funnels', 'GET', null, token)).data.length, 1, 'user funnel kept');
});

test('preview mode never touches real orders, carts or coupon counts', async () => {
  const { token } = await register(api);
  const f = (await api('/templates/yoga/use', 'POST', {}, token)).data;
  await api(`/funnels/${f.id}`, 'PUT', { published: true }, token);
  await api('/coupons', 'POST', { code: 'PV10', value: 10 }, token);
  const co = f.steps.find((s) => s.type === 'checkout'), up = f.steps.find((s) => s.type === 'upsell');
  const real = (await api(`/public/${f.slug}/order`, 'POST', { stepId: co.id, email: 'real@x.dev' })).data;
  await api(`/public/${f.slug}/abandon`, 'POST', { stepId: co.id, email: 'cart@x.dev' });
  // preview: accept an upsell using the REAL order id, buy with the cart email and a coupon
  const pv = (await api(`/public/${f.slug}/order?preview=1`, 'POST', { stepId: up.id, orderId: real.orderId })).data;
  assert.ok(pv.orderId.startsWith('pv-'));
  await api(`/public/${f.slug}/order?preview=1`, 'POST', { stepId: co.id, email: 'cart@x.dev', coupon: 'PV10' });
  const d = (await api('/orders', 'GET', null, token)).data;
  const r = d.orders.find((o) => o.id === real.orderId);
  assert.deepEqual(r.items.map((i) => i.kind), ['main'], 'real order unchanged');
  assert.equal(d.orders.length, 1, 'no preview orders saved');
  assert.ok(d.abandoned.some((a) => a.email === 'cart@x.dev'), 'cart still abandoned');
  assert.equal((await api('/coupons', 'GET', null, token)).data.find((c) => c.code === 'PV10').uses, 0, 'coupon uses unchanged');
  // preview still keeps a running total across steps
  const p1 = (await api(`/public/${f.slug}/order?preview=1`, 'POST', { stepId: co.id, email: 'p@x.dev' })).data;
  const p2 = (await api(`/public/${f.slug}/order?preview=1`, 'POST', { stepId: up.id, orderId: p1.orderId })).data;
  assert.ok(p2.total > p1.total);
});

test('exit-popup coupon codes are created automatically and work at checkout', async () => {
  const { token } = await register(api);
  const f = (await api('/templates/skincare/use', 'POST', {}, token)).data;
  const code = f.steps[0].blocks.find((b) => b.type === 'exitpopup').props.code;
  const c = (await api('/coupons', 'GET', null, token)).data.find((x) => x.code === code);
  assert.ok(c && c.active && c.type === 'percent' && c.value === 10);
  await api(`/funnels/${f.id}`, 'PUT', { published: true }, token);
  assert.equal((await api(`/public/${f.slug}/coupon`, 'POST', { code })).data.valid, true);
  // changing the popup code in the editor creates the new code too
  const steps = structuredClone(f.steps);
  steps[0].blocks.find((b) => b.type === 'exitpopup').props.code = 'DIWALI25';
  await api(`/funnels/${f.id}`, 'PUT', { steps }, token);
  const d = (await api('/coupons', 'GET', null, token)).data.find((x) => x.code === 'DIWALI25');
  assert.equal(d.value, 25);
  // a paused coupon is not silently re-activated
  await api(`/coupons/${c.id}`, 'PUT', { active: false }, token);
  await api(`/funnels/${f.id}`, 'PUT', { steps: f.steps }, token);
  assert.equal((await api('/coupons', 'GET', null, token)).data.find((x) => x.code === code).active, false);
});

test('WhatsApp buttons use the seller number from Settings, or are hidden', async () => {
  const { token } = await register(api);
  const f = (await api('/templates/pickle/use', 'POST', {}, token)).data;
  await api(`/funnels/${f.id}`, 'PUT', { published: true }, token);
  const wa = async () => (await api(`/public/${f.slug}`)).data.steps.flatMap((s) => s.blocks).filter((b) => b.type === 'whatsapp');
  assert.equal((await wa()).length, 0, 'no fake number shown when Settings is empty');
  await api('/settings', 'PUT', { supportWhatsapp: '098765 43210' }, token);
  const blocks = await wa();
  assert.ok(blocks.length >= 2);
  assert.ok(blocks.every((b) => b.props.number === '919876543210'));
  // a number typed directly into a block wins
  const steps = structuredClone(f.steps);
  steps[0].blocks.find((b) => b.type === 'whatsapp').props.number = '+91 91234 56789';
  await api(`/funnels/${f.id}`, 'PUT', { steps }, token);
  assert.equal((await wa())[0].props.number, '919123456789');
});

test('A/B analytics report significance, not just "leading"', async () => {
  const { token } = await register(api);
  const f = (await api('/templates/yoga/use', 'POST', {}, token)).data;
  const steps = structuredClone(f.steps);
  steps[0].ab = { enabled: true, split: 50, blocks: structuredClone(steps[0].blocks) };
  await api(`/funnels/${f.id}`, 'PUT', { steps, published: true }, token);
  const ev = (type, variant, n) => Promise.all(Array.from({ length: n }, () => api(`/public/${f.slug}/event`, 'POST', { stepId: f.steps[0].id, type, variant })));
  await ev('view', 'A', 30); await ev('view', 'B', 30);
  let ab = (await api(`/funnels/${f.id}/analytics`, 'GET', null, token)).data.steps[0].ab;
  assert.equal(ab.result.status, 'collecting');
  await ev('view', 'A', 170); await ev('view', 'B', 170);
  await ev('convert', 'A', 10); await ev('convert', 'B', 40);
  ab = (await api(`/funnels/${f.id}/analytics`, 'GET', null, token)).data.steps[0].ab;
  assert.equal(ab.result.winner, 'B');
  assert.ok(ab.result.confidence > 95);
});

test('form builder: custom answers, phone-only leads, validation', async () => {
  const { token } = await register(api);
  const f = (await api('/funnels', 'POST', { name: 'Form test' }, token)).data;
  await api(`/funnels/${f.id}`, 'PUT', { published: true }, token);
  const sid = f.steps[0].id;
  const ok = await api(`/public/${f.slug}/lead`, 'POST', { stepId: sid, email: 'form@x.dev', name: 'Asha', fields: { 'Business type': 'Bakery', 'Monthly budget': '₹20,000', 'Agree to terms': true } });
  assert.equal(ok.status, 200);
  assert.equal((await api(`/public/${f.slug}/lead`, 'POST', { stepId: sid, phone: '+91 98765 43210', fields: { City: 'Pune' } })).status, 200, 'phone-only lead accepted');
  assert.equal((await api(`/public/${f.slug}/lead`, 'POST', { stepId: sid, email: 'not-an-email' })).status, 400);
  assert.equal((await api(`/public/${f.slug}/lead`, 'POST', { stepId: sid, fields: { a: 'b' } })).status, 400, 'needs email or phone');
  const huge = Object.fromEntries(Array.from({ length: 50 }, (_, i) => [`f${i}`, 'x'.repeat(5000)]));
  await api(`/public/${f.slug}/lead`, 'POST', { stepId: sid, email: 'big@x.dev', fields: huge });
  const leads = (await api(`/funnels/${f.id}/analytics`, 'GET', null, token)).data.leads;
  const a = leads.find((l) => l.email === 'form@x.dev');
  assert.equal(a.fields['Business type'], 'Bakery');
  assert.equal(a.fields['Agree to terms'], true);
  const big = leads.find((l) => l.email === 'big@x.dev');
  assert.equal(Object.keys(big.fields).length, 30);
  assert.equal(big.fields.f0.length, 2000);
  const contacts = (await api('/contacts', 'GET', null, token)).data;
  assert.ok(contacts.some((c) => c.phone === '+91 98765 43210' && c.email === '' && c.fields.City === 'Pune'));
  assert.equal(contacts.find((c) => c.email === 'form@x.dev').fields['Monthly budget'], '₹20,000');
});

test('saved sections: per-user library, validation, delete', async () => {
  const { token } = await register(api);
  const block = { type: 'cta', props: { headline: 'Join now', _style: { bg: '#111' } } };
  const r = await api('/saved', 'POST', { name: 'My CTA', block }, token);
  assert.equal(r.status, 200);
  assert.equal(r.data.name, 'My CTA');
  assert.equal(r.data.userId, undefined, 'owner id not leaked');
  assert.deepEqual(r.data.block, block);
  assert.equal((await api('/saved', 'POST', { name: 'x', block: { type: 'cta', props: null } }, token)).status, 400);
  assert.equal((await api('/saved', 'POST', { name: 'x', block: { type: 'cta', props: [] } }, token)).status, 400);
  assert.equal((await api('/saved', 'POST', { name: 'x', block: { type: 'html', props: { html: 'x'.repeat(310000) } } }, token)).status, 413);
  assert.equal((await api('/saved', 'GET', null, T)).data.length, 0, 'other users cannot see it');
  await api(`/saved/${r.data.id}`, 'DELETE', null, T);
  assert.equal((await api('/saved', 'GET', null, token)).data.length, 1, 'other users cannot delete it');
  await api(`/saved/${r.data.id}`, 'DELETE', null, token);
  assert.equal((await api('/saved', 'GET', null, token)).data.length, 0);
});

test('site-wide fonts are linked in the server-rendered page', async () => {
  const { token } = await register(api);
  const f = (await api('/funnels', 'POST', { name: 'Font test' }, token)).data;
  await api(`/funnels/${f.id}`, 'PUT', { published: true, theme: { ...f.theme, headingFont: 'Mukta', bodyFont: 'Lora', radius: 'pill' } }, token);
  const html = await (await fetch(`${srv.base}/f/${f.slug}`)).text();
  if (!html.includes('ff-ssr') && !html.includes('fonts.googleapis')) return; // client build absent: SSR disabled
  assert.match(html, /family=Mukta/);
  assert.match(html, /family=Lora/);
});

test('settings & coupons CRUD', async () => {
  const s = (await api('/settings', 'PUT', { businessName: 'Acme', tracking: { ga4: 'G-TEST' } }, T)).data;
  assert.equal(s.businessName, 'Acme');
  assert.equal(s.tracking.ga4, 'G-TEST');
  const list = (await api('/coupons', 'GET', null, T)).data;
  const c = list.find((x) => x.code === 'SAVE10');
  assert.equal((await api(`/coupons/${c.id}`, 'PUT', { active: false }, T)).data.active, false);
  assert.equal((await api(`/public/${funnel.slug}/coupon`, 'POST', { code: 'SAVE10' })).data.valid, false);
});
