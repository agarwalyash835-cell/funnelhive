// Cash on Delivery risk controls (cod.js) against a fake Hive WhatsApp server: everything off by default; the buyer
// confirms or cancels by WhatsApp reply, button or signed link; no answer → unconfirmed (seller told) and resend;
// a buyer's cancel cancels the order (COD orders never took stock, so the stock counter is untouched); PIN code
// rules before payment; max COD value and blocking a number with a bad COD history; RTO marking and counting.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import { startServer, register } from './helpers.mjs';

const KEY = 'hk_test_ok_cod_123456';
const fake = { sent: [], msgs: new Map(), hook: null, templates: [] };
let hive, srv, api, T, f, step;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms = 5000) { for (let t = 0; t < ms; t += 50) { const v = await fn(); if (v) return v; await wait(50); } return fn(); }
const ADDR = { line1: '12, MG Road', city: 'Bengaluru', state: 'Karnataka', pincode: '560001' };
const buyer = (extra = {}) => ({ stepId: step.id, email: `b${crypto.randomUUID().slice(0, 6)}@example.in`, name: 'Ravi Kumar', phone: '9876543210', address: ADDR, ...extra });
const order = async (id) => (await api(`/orders?limit=1&id=${encodeURIComponent(id)}`, 'GET', null, T)).data.orders[0];
const placeCod = async (extra) => { const r = await api(`/public/${f.slug}/cod`, 'POST', buyer(extra)); assert.equal(r.status, 200, JSON.stringify(r.data)); return r.data.orderId; };
const sentTo = (num, pred = () => true) => fake.sent.filter((m) => m.to === num && pred(m));

async function hook(event, data) {
  const id = `whd_${crypto.randomUUID()}`, ts = Date.now();
  const raw = JSON.stringify({ id, event, created_at: new Date(ts).toISOString(), data });
  const s = `sha256=${crypto.createHmac('sha256', fake.hook.secret).update(raw).digest('hex')}`;
  const r = await fetch(srv.base + new URL(fake.hook.url).pathname, { method: 'POST', headers: { 'content-type': 'application/json', 'x-hive-signature': s, 'x-hive-event': event, 'x-hive-delivery-id': id, 'x-hive-timestamp': String(ts) }, body: raw });
  assert.equal(r.status, 200);
}
const setCod = async (patch) => { const r = await api('/settings/cod', 'PUT', patch, T); assert.equal(r.status, 200, JSON.stringify(r.data)); return r.data; };

before(async () => {
  hive = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => { body += d; });
    req.on('end', () => {
      const url = new URL(req.url, 'http://x');
      const p = url.pathname.replace(/^\/wa\/v1/, '');
      const j = body ? JSON.parse(body) : null;
      const send = (s, o) => { res.writeHead(s, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
      if (req.headers.authorization !== `Bearer ${KEY}`) return send(401, { error: 'Invalid API key' });
      const route = `${req.method} ${p}`;
      if (route === 'GET /me') return send(200, { workspace_id: 'ws_1', prefix: 'hk_test_ok_c' });
      if (route === 'GET /numbers') return send(200, { numbers: [{ id: 'ch_1', display: '919800000001', phone_number_id: '1111' }] });
      if (route === 'GET /templates') return send(200, { templates: fake.templates });
      if (route === 'PUT /webhooks') { fake.hook = j; return send(200, { ok: true }); }
      if (route === 'GET /window') return send(200, { open: url.searchParams.get('to') === '919811111111' });
      if (route === 'POST /messages') {
        const ik = req.headers['idempotency-key'];
        if (fake.msgs.has(ik)) return send(202, fake.msgs.get(ik));
        const r = { id: `msg_${fake.msgs.size + 1}`, status: 'queued' };
        fake.msgs.set(ik, r);
        fake.sent.push({ ...j, key: ik });
        return send(202, r);
      }
      send(404, { error: 'not found' });
    });
  });
  await new Promise((r) => hive.listen(0, '127.0.0.1', r));
  srv = await startServer({ HIVE_WA_API_URL: `http://127.0.0.1:${hive.address().port}/wa/v1`, APP_URL: 'https://app.example.in', COD_HOUR_MS: '1500', COD_TICK_MS: '100' });
  api = srv.api;
  T = (await register(api)).token;
  f = (await api('/templates/pickle/use', 'POST', {}, T)).data;
  step = f.steps.find((s) => s.blocks.some((b) => b.type === 'checkout'));
  // COD on, and a "only N left" counter on the checkout
  const steps = f.steps.map((s) => (s.id !== step.id ? s : { ...s, blocks: [...s.blocks.map((b) => (b.type === 'checkout' ? { ...b, props: { ...b.props, cod: true, shipping: 'address' } } : b)), { id: 'stk', type: 'stock', props: { left: 10, setAt: Date.now() - 1000 } }] }));
  f = (await api(`/funnels/${f.id}`, 'PUT', { steps, published: true }, T)).data;
  step = f.steps.find((s) => s.id === step.id);
  // Hive WhatsApp connected, with the COD confirmation template approved
  assert.equal((await api('/channels/whatsapp/hive', 'PUT', { apiKey: KEY }, T)).status, 200);
  assert.equal((await api('/channels/whatsapp/hive/webhook', 'POST', {}, T)).status, 200);
  fake.templates = [{ id: 't1', name: 'fh_cod_confirm', language: 'en', status: 'APPROVED', category: 'UTILITY' }];
  const v = (await api('/channels/whatsapp/hive/templates', 'GET', null, T)).data;
  assert.equal(v.templates.find((t) => t.event === 'cod_confirm').status, 'APPROVED');
});
after(async () => { await srv?.stop(); hive?.close(); });

test('all off by default: no confirmation, no PIN code or risk rules', async () => {
  const s = (await api('/settings/cod', 'GET', null, T)).data;
  assert.deepEqual([s.confirm, s.hours, s.pinMode, s.pins, s.noCod, s.maxCod, s.blockAfter], [false, 24, 'off', '', '', 0, 0]);
  assert.equal(s.confirmReady, true);
  const id = await placeCod();
  await wait(300);
  const o = await order(id);
  assert.equal(o.status, 'cod');
  assert.equal(o.codStatus, undefined, 'no confirmation asked');
  assert.equal(sentTo('919876543210', (m) => m.template?.name === 'fh_cod_confirm').length, 0);
  const pin = (await api(`/public/${f.slug}/pincode?pin=302017`)).data;
  assert.deepEqual([pin.valid, pin.deliverable, pin.cod, pin.state], [true, true, true, 'Rajasthan']);
  assert.equal((await api(`/public/${f.slug}/pincode?pin=012345`)).data.valid, false);
  // a big order, a number with history: still fine while the rules are off
  assert.equal((await api(`/public/${f.slug}/cod`, 'POST', buyer({ withBump: true }))).status, 200);
});

let confirmedId;
test('WhatsApp confirmation: template with a signed link; a YES reply confirms and is thanked', async () => {
  await setCod({ confirm: true, hours: 1 });
  const id = confirmedId = await placeCod();
  assert.equal((await order(id)).codStatus, 'pending');
  const m = await waitFor(() => sentTo('919876543210', (x) => x.template?.name === 'fh_cod_confirm' && x.template.body[3].includes(`/cod/${id}/`))[0]);
  assert.ok(m, 'the confirmation went on WhatsApp');
  assert.equal(m.template.body[0], 'Ravi');
  assert.match(m.template.body[3], /^https:\/\/app\.example\.in\/cod\//);
  const sent = await waitFor(async () => (await order(id)).codConfirm?.sends?.[0]);
  assert.equal(sent.via, 'whatsapp');
  await hook('message.inbound', { from: '919876543210', text: 'Yes', type: 'text', contact_name: 'Ravi' });
  const o = await waitFor(async () => { const x = await order(id); return x.codStatus === 'confirmed' && x; });
  assert.ok(o, 'confirmed');
  assert.deepEqual([o.status, o.codConfirm.by], ['cod', 'whatsapp'], 'still unpaid — confirmed, not paid');
  assert.ok(await waitFor(() => sentTo('919876543210', (x) => x.type === 'text' && /confirmed/.test(x.text?.body)).length), 'thanked in the open window');
  // a later "yes" with nothing awaiting an answer is just a message
  await hook('message.inbound', { from: '919876543210', text: 'yes', type: 'text' });
  assert.equal((await order(id)).codStatus, 'confirmed');
});

test('the signed link: GET only shows it, bad links are refused, Cancel cancels the order (stock counter untouched)', async () => {
  const id = await placeCod({ phone: '9700000001' });
  const link = (await api(`/orders/${id}/cod-risk`, 'GET', null, T)).data.link;
  assert.match(link, new RegExp(`/cod/${id}/[\\w-]{24}$`));
  const path = new URL(link).pathname;
  const page = await fetch(srv.base + path);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Confirm order[\s\S]*Cancel order/);
  assert.equal((await order(id)).codStatus, 'pending', 'opening the link changes nothing');
  assert.equal((await fetch(`${srv.base}/cod/${id}/${'x'.repeat(24)}`)).status, 404);
  assert.equal((await fetch(`${srv.base}/cod/${id}/${'x'.repeat(24)}/cancel`, { method: 'POST' })).status, 404);
  const stockBefore = (await api(`/public/${f.slug}/social?stepId=${step.id}`)).data.stock.stk;
  const c = await fetch(`${srv.base}${path}/cancel`, { method: 'POST' });
  assert.equal(c.status, 200);
  assert.match(await c.text(), /cancelled/);
  const o = await order(id);
  assert.deepEqual([o.status, o.codStatus, o.cancelReason, o.total, o.codConfirm.by], ['cancelled', 'cancelled', 'buyer_cancelled', 0, 'link']);
  assert.ok(o.cancelledAmount > 0);
  assert.equal((await api(`/public/${f.slug}/social?stepId=${step.id}`)).data.stock.stk, stockBefore, 'COD orders never took stock, so there is none to put back');
  assert.equal(stockBefore, 10);
  // answering again changes nothing
  assert.equal((await fetch(`${srv.base}${path}/confirm`, { method: 'POST' })).status, 200);
  assert.equal((await order(id)).status, 'cancelled');
  const n = (await api('/notifications', 'GET', null, T)).data.items;
  assert.ok(n.some((x) => x.title.includes(`cancelled by the buyer · #${id}`)));
});

test('confirm by link, and by the WhatsApp button (inside the 24-hour window when the template is off)', async () => {
  const id = await placeCod({ phone: '9700000002' });
  const path = new URL((await api(`/orders/${id}/cod-risk`, 'GET', null, T)).data.link).pathname;
  assert.equal((await fetch(`${srv.base}${path}/confirm`, { method: 'POST' })).status, 200);
  assert.deepEqual([(await order(id)).codStatus, (await order(id)).codConfirm.by], ['confirmed', 'link']);

  await api('/channels/whatsapp/hive', 'PUT', { events: { cod_confirm: false } }, T);
  const id2 = await placeCod({ phone: '9811111111' });
  const m = await waitFor(() => sentTo('919811111111', (x) => x.type === 'interactive')[0]);
  assert.ok(m, 'buttons sent');
  assert.deepEqual(m.interactive.action.buttons.map((b) => b.reply.id), [`cod:confirm:${id2}`, `cod:cancel:${id2}`]);
  assert.equal((await waitFor(async () => (await order(id2)).codConfirm?.sends?.[0])).via, 'whatsapp_buttons');
  await hook('message.inbound', { from: '919811111111', type: 'interactive', interactive_id: `cod:confirm:${id2}`, interactive_title: 'Confirm' });
  assert.ok(await waitFor(async () => (await order(id2)).codStatus === 'confirmed'));
  // no WhatsApp at all for this number (template off, window closed): email instead — or nothing, which the seller sees
  const id3 = await placeCod({ phone: '9700000003' });
  const s3 = await waitFor(async () => (await order(id3)).codConfirm?.sends?.[0]);
  assert.ok(['email', 'none'].includes(s3.via));
  await api('/channels/whatsapp/hive', 'PUT', { events: { cod_confirm: true } }, T);
});

let lateId;
test('no reply in time → unconfirmed, the seller is notified; Resend asks again', async () => {
  const id = lateId = await placeCod({ phone: '9700000004' });
  await waitFor(() => sentTo('919700000004', (x) => x.template?.name === 'fh_cod_confirm').length);
  const o = await waitFor(async () => { const x = await order(id); return x.codStatus === 'unconfirmed' && x; }, 6000);
  assert.ok(o, 'unconfirmed after the deadline');
  assert.ok(o.codConfirm.expiredAt);
  const n = (await api('/notifications', 'GET', null, T)).data.items;
  assert.ok(n.some((x) => x.title.startsWith(`COD order not confirmed · #${id}`)));
  assert.equal((await api('/orders?status=cod_unconfirmed', 'GET', null, T)).data.orders.filter((x) => x.id === id).length, 1);
  const r = await api(`/orders/${id}/cod`, 'POST', { action: 'resend' }, T);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.deepEqual([r.data.sentVia, r.data.codStatus], ['whatsapp', 'pending']);
  assert.equal(sentTo('919700000004', (x) => x.template?.name === 'fh_cod_confirm').length, 2, 'a second message, not a duplicate of the first');
  assert.equal((await api(`/orders/${confirmedId}/cod`, 'POST', { action: 'resend' }, T)).status, 400, 'confirmed orders aren’t asked again');
  // a late NO still counts
  await hook('message.inbound', { from: '919700000004', text: 'no', type: 'text' });
  assert.ok(await waitFor(async () => (await order(id)).status === 'cancelled'));
});

test('PIN codes: serviceable list with prefixes and ranges, no-COD PIN codes, checked before payment', async () => {
  await setCod({ confirm: false });
  assert.equal((await api('/settings/cod', 'PUT', { pinMode: 'allow', pins: '' }, T)).status, 400, 'a list is needed');
  assert.equal((await api('/settings/cod', 'PUT', { pins: '302xxx, banana' }, T)).status, 400);
  const s = await setCod({ pinMode: 'allow', pins: '302xxx\n560001-560010, 110001', noCod: '560005' });
  assert.equal(s.pins, '302*\n560001-560010\n110001');
  const pin = async (p) => (await api(`/public/${f.slug}/pincode?pin=${p}`)).data;
  assert.deepEqual(await pin('302017'), { valid: true, deliverable: true, cod: true, state: 'Rajasthan', message: '' });
  const far = await pin('400001');
  assert.deepEqual([far.deliverable, far.cod, far.state], [false, false, 'Maharashtra']);
  assert.match(far.message, /don’t deliver/);
  const noCod = await pin('560005');
  assert.deepEqual([noCod.deliverable, noCod.cod], [true, false]);
  assert.match(noCod.message, /pay online/);
  const at = (pincode) => ({ address: { ...ADDR, state: '', pincode } });
  const r1 = await api(`/public/${f.slug}/cod`, 'POST', buyer(at('400001')));
  assert.deepEqual([r1.status, r1.data.code], [400, 'pincode']);
  const r2 = await api(`/public/${f.slug}/cod`, 'POST', buyer(at('560005')));
  assert.deepEqual([r2.status, r2.data.code], [400, 'pincode_cod']);
  assert.match(r2.data.error, /pay online/);
  // online checkout (no payments connected: the demo order) — not delivered there either, but COD-only limits don't apply
  assert.equal((await api(`/public/${f.slug}/order`, 'POST', buyer(at('400001')))).status, 400);
  assert.equal((await api(`/public/${f.slug}/order`, 'POST', buyer(at('560005')))).status, 200);
  assert.equal((await api(`/public/${f.slug}/cod`, 'POST', buyer(at('302017')))).status, 200);
  // all India except
  await setCod({ pinMode: 'except', pins: '19xxxx', noCod: '' });
  assert.equal((await pin('194101')).deliverable, false);
  assert.equal((await pin('560005')).cod, true);
  await setCod({ pinMode: 'off', pins: '' });
});

test('risk rules: a maximum COD value, and no COD for a number with N bad COD orders', async () => {
  await setCod({ maxCod: 100 });
  const big = await api(`/public/${f.slug}/cod`, 'POST', buyer({ phone: '9700000009' }));
  assert.deepEqual([big.status, big.data.code], [400, 'max']);
  assert.equal((await api(`/public/${f.slug}/order`, 'POST', buyer({ phone: '9700000009' }))).status, 200, 'paying online is fine');
  await setCod({ maxCod: 0 });
  // 9700000004: one unanswered-then-cancelled order; 9700000001: one cancelled by link
  assert.equal((await api(`/public/${f.slug}/cod`, 'POST', buyer({ phone: '9700000001' }))).status, 200, 'off by default');
  await setCod({ blockAfter: 1 });
  const blocked = await api(`/public/${f.slug}/cod`, 'POST', buyer({ phone: '+91 97000 00001' }));
  assert.deepEqual([blocked.status, blocked.data.code], [400, 'history']);
  assert.match(blocked.data.error, /pay online/);
  assert.equal((await api(`/public/${f.slug}/cod`, 'POST', buyer({ phone: '9876543210' }))).status, 200, 'confirmed / open orders don’t count');
  await setCod({ blockAfter: 0 });
});

test('RTO: the seller marks a COD order returned to origin; it counts in the buyer’s history, filters and totals', async () => {
  const id = await placeCod({ phone: '9700000005' });
  const before = (await api(`/orders/${id}/cod-risk`, 'GET', null, T)).data;
  assert.deepEqual([before.orders, before.rto, before.bad], [1, 0, 0]);
  const r = await api(`/orders/${id}/cod`, 'POST', { action: 'rto' }, T);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.deepEqual([r.data.status, r.data.cancelReason, r.data.fulfilment.status], ['cancelled', 'returned', 'returned']);
  assert.ok(r.data.rtoAt);
  assert.equal((await api(`/orders/${id}/cod`, 'POST', { action: 'rto' }, T)).status, 400, 'once');
  const h = (await api(`/orders/${id}/cod-risk`, 'GET', null, T)).data;
  assert.deepEqual([h.rto, h.bad], [1, 1]);
  // returned from the Shipping steps counts the same
  const id2 = await placeCod({ phone: '9700000005' });
  await api(`/orders/${id2}/fulfil`, 'POST', { status: 'shipped', courier: 'Delhivery', tracking: 'AWB1' }, T);
  await api(`/orders/${id2}/fulfil`, 'POST', { status: 'returned' }, T);
  assert.equal((await api(`/orders/${id2}/cod-risk`, 'GET', null, T)).data.rto, 2);
  const list = (await api('/orders?status=rto', 'GET', null, T)).data;
  assert.deepEqual(list.orders.map((o) => o.id).sort(), [id, id2].sort());
  assert.equal(list.kpis.rto, 2);
  await setCod({ blockAfter: 2 });
  assert.equal((await api(`/public/${f.slug}/cod`, 'POST', buyer({ phone: '9700000005' }))).data.code, 'history');
  await setCod({ blockAfter: 0 });
  // paid orders aren't RTO'd from here
  const paid = (await api(`/public/${f.slug}/order`, 'POST', buyer())).data.orderId;
  assert.equal((await api(`/orders/${paid}/cod`, 'POST', { action: 'rto' }, T)).status, 400);
});

test('the seller can note the buyer’s answer by phone; settings are checked', async () => {
  const id = await placeCod({ phone: '9700000006' });
  const r = await api(`/orders/${id}/cod`, 'POST', { action: 'confirm' }, T);
  assert.deepEqual([r.status, r.data.codStatus, r.data.codConfirm.by], [200, 'confirmed', 'seller']);
  assert.equal((await api('/settings/cod', 'PUT', { hours: 0 }, T)).status, 400);
  assert.equal((await api('/settings/cod', 'PUT', { blockAfter: -1 }, T)).status, 400);
  assert.equal((await api('/settings/cod', 'PUT', { pinMode: 'some' }, T)).status, 400);
  const other = (await register(api)).token;
  assert.equal((await api(`/orders/${id}/cod-risk`, 'GET', null, other)).status, 404);
  assert.equal((await api(`/orders/${lateId}/cod`, 'POST', { action: 'resend' }, other)).status, 404);
});
