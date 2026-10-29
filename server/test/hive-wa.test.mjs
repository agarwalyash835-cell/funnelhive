// Hive WhatsApp (the owner's own WhatsApp API) against a fake Hive server: key check, numbers, webhook
// registration, templates, buyer messages with an Idempotency-Key, the signed webhook (inbound, STOP, echo,
// statuses), phone required at checkout and booking, abandoned-checkout reminders.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startServer, register } from './helpers.mjs';

const KEY = 'hk_test_ok_supersecret_123';
const fake = { reqs: [], sent: [], msgs: new Map(), templates: [{ id: 't0', name: 'fh_quote_sent', language: 'en', status: 'APPROVED', category: 'UTILITY' }], hook: null, failOnce: new Set(), noEdit: false };
// a template as Hive lists it: components as Meta has them ([{ type: 'BODY', text }])
const listed = (j, extra) => ({ name: j.name, language: j.language, category: j.category, components: (j.components || []).map((c) => ({ type: String(c.type).toUpperCase(), text: c.parameters?.[0]?.text ?? c.text })), ...extra });
let hive, hiveUrl, srv, api, T, f, co;
const k = (key) => encodeURIComponent(key);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms = 4000) { for (let t = 0; t < ms; t += 50) { const v = fn(); if (v) return v; await wait(50); } return fn(); }
const sentTo = (num, name) => fake.sent.filter((m) => m.to === num && (!name || m.template?.name === name));

before(async () => {
  hive = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => { body += d; });
    req.on('end', () => {
      const url = new URL(req.url, 'http://x');
      const p = url.pathname.replace(/^\/wa\/v1/, '');
      const j = body ? JSON.parse(body) : null;
      const auth = String(req.headers.authorization || '');
      fake.reqs.push({ method: req.method, path: p, query: Object.fromEntries(url.searchParams), body: j, headers: req.headers });
      const send = (s, o) => { res.writeHead(s, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
      if (auth.includes('hk_test_bad')) return send(401, { error: 'Invalid API key' });
      if (auth.includes('hk_test_nosub')) return send(402, { error: 'WhatsApp API duration not active', code: 'WHATSAPP_API_SUBSCRIPTION_REQUIRED' });
      if (auth !== `Bearer ${KEY}`) return send(401, { error: 'Invalid API key' });
      const route = `${req.method} ${p}`;
      if (route === 'GET /me') return send(200, { workspace_id: 'ws_1', key_id: 'key_1', prefix: 'hk_test_ok_sup', channel_id: null, scopes: [] });
      if (route === 'GET /numbers') return send(200, { numbers: [{ id: 'ch_1', display: '919800000001', phone_number_id: '1111', quality: 'GREEN' }] });
      if (route === 'GET /templates') return send(200, { templates: fake.templates });
      if (route === 'POST /templates') {
        if (fake.templates.some((t) => t.name === j.name)) return send(409, { error: 'Template already exists' });
        const t = listed(j, { id: `t${fake.reqs.length}`, status: 'PENDING' });
        fake.templates.push(t);
        return send(201, t);
      }
      const tm = p.match(/^\/templates\/([\w-]+)$/);
      if (tm && req.method === 'DELETE') {
        const i = fake.templates.findIndex((t) => t.name === tm[1]);
        if (i < 0) return send(404, { error: 'Template not found' });
        fake.templates.splice(i, 1);
        res.writeHead(204); return res.end();
      }
      if (tm && req.method === 'POST') { // edit by id
        const t = fake.templates.find((x) => x.id === tm[1]);
        if (!t || fake.noEdit) return send(400, { error: 'Template cannot be edited right now' });
        Object.assign(t, listed({ ...t, ...j, name: t.name, language: t.language }), { status: 'PENDING', rejected_reason: '' });
        return send(200, t);
      }
      if (route === 'PUT /webhooks') { fake.hook = j; return send(200, { ok: true, url: j.url, events: j.events }); }
      if (route === 'POST /webhooks/test') return send(200, { ok: true });
      if (route === 'GET /window') return send(200, { open: url.searchParams.get('to') === '919811111111' });
      if (route === 'POST /messages') {
        const ik = req.headers['idempotency-key'];
        if (!ik) return send(400, { error: 'Idempotency-Key header is required' });
        if (fake.failOnce.delete(ik)) return send(500, { error: 'temporary failure' });
        if (fake.msgs.has(ik)) return send(202, fake.msgs.get(ik)); // Hive answers a repeated key with the first result
        const r = { id: `msg_${fake.msgs.size + 1}`, wamid: `wamid.${fake.msgs.size + 1}`, status: 'queued' };
        fake.msgs.set(ik, r);
        fake.sent.push({ ...j, key: ik });
        return send(202, r);
      }
      send(404, { error: 'not found' });
    });
  });
  await new Promise((r) => hive.listen(0, '127.0.0.1', r));
  hiveUrl = `http://127.0.0.1:${hive.address().port}/wa/v1`;
  srv = await startServer({ HIVE_WA_API_URL: hiveUrl, HIVE_WA_TICK_MS: '300', HIVE_WA_ABANDON_MS: '400' });
  api = srv.api;
  T = (await register(api)).token;
  f = (await api('/templates/yoga/use', 'POST', {}, T)).data;
  await api(`/funnels/${f.id}`, 'PUT', { published: true }, T);
  co = f.steps.find((s) => s.type === 'checkout');
});
after(async () => { await srv.stop(); hive.close(); });

// a webhook delivery from Hive, signed with the secret FunnelHive registered
async function hook(event, data, { sig, ts = Date.now(), id = `whd_${crypto.randomUUID()}` } = {}) {
  const raw = JSON.stringify({ id, event, created_at: new Date(ts).toISOString(), workspace_id: 'ws_1', number: { id: 'ch_1', display: '919800000001', phone_number_id: '1111' }, data });
  const s = sig ?? `sha256=${crypto.createHmac('sha256', fake.hook.secret).update(raw).digest('hex')}`;
  const r = await fetch(srv.base + new URL(fake.hook.url).pathname, { method: 'POST', headers: { 'content-type': 'application/json', 'x-hive-signature': s, 'x-hive-event': event, 'x-hive-delivery-id': id, 'x-hive-timestamp': String(ts) }, body: raw });
  return { status: r.status, data: await r.json().catch(() => ({})) };
}

test('the API key is checked with Hive (/me): a lapsed subscription and a wrong key are explained; the key never comes back', async () => {
  const nosub = await api('/channels/whatsapp/hive', 'PUT', { apiKey: 'hk_test_nosub_1234' }, T);
  assert.equal(nosub.status, 400);
  assert.equal(nosub.data.error, 'Your Hive WhatsApp API subscription isn’t active');
  const bad = await api('/channels/whatsapp/hive', 'PUT', { apiKey: 'hk_test_bad_1234' }, T);
  assert.equal(bad.status, 400, 'Hive’s 401 is not passed on as our own 401');
  assert.match(bad.data.error, /didn’t accept this API key/);
  assert.equal((await api('/channels/whatsapp/hive', 'PUT', { apiKey: 'sk_nope' }, T)).status, 400);

  const ok = await api('/channels/whatsapp/hive', 'PUT', { apiKey: KEY }, T);
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  assert.equal(ok.data.hasKey, true);
  assert.equal(ok.data.provider, 'hive', 'connecting Hive switches WhatsApp to it');
  assert.equal(ok.data.from, '1111', 'the only connected number is picked');
  assert.equal(ok.data.mode, 'test');
  const ch = (await api('/channels', 'GET', null, T)).data;
  assert.equal(ch.whatsapp.configured, true);
  assert.equal(ch.whatsapp.provider, 'hive');
  for (const body of [ok.data, ch, (await api('/channels/whatsapp/hive', 'GET', null, T)).data]) assert.ok(!JSON.stringify(body).includes(KEY), 'the key is never returned');
  assert.ok(fake.reqs.some((r) => r.path === '/me'));
});

test('numbers are listed; alerts number is normalised; webhook registration needs no copying', async () => {
  const n = (await api('/channels/whatsapp/hive/numbers', 'GET', null, T)).data;
  assert.deepEqual(n.numbers.map((x) => x.display), ['919800000001']);
  assert.equal((await api('/channels/whatsapp/hive', 'PUT', { from: 'nope' }, T)).status, 400);
  assert.equal((await api('/channels/whatsapp/hive', 'PUT', { notifyPhone: '12' }, T)).status, 400);
  assert.equal((await api('/channels/whatsapp/hive', 'PUT', { notifyPhone: '98765 00001' }, T)).data.notifyPhone, '919876500001');

  const v = (await api('/channels/whatsapp/hive/webhook', 'POST', {}, T)).data;
  assert.ok(v.webhook?.connectedAt);
  assert.match(fake.hook.url, /\/api\/hive\/webhook\/[\w]+$/);
  assert.equal(fake.hook.secret.length, 64);
  assert.ok(fake.hook.events.includes('message.echo') && fake.hook.events.includes('template.status'));
  assert.ok(!fake.hook.events.includes('history.sync'), 'old chats stay off');
  assert.deepEqual(fake.hook.channel_ids, ['ch_1']);
  assert.ok(!JSON.stringify(v).includes(fake.hook.secret), 'the webhook secret is never returned');
  assert.equal((await api('/channels/whatsapp/hive/webhook/test', 'POST', {}, T)).status, 200);
});

test('the number can be cleared even when Hive has only one: WhatsApp stops until one is chosen again', async () => {
  // no question to Hive when clearing (it may already refuse the key once the number's channel is cancelled)
  const n = fake.reqs.length;
  const cleared = (await api('/channels/whatsapp/hive', 'PUT', { from: '' }, T)).data;
  assert.deepEqual([cleared.from, cleared.fromLabel, cleared.configured], ['', '', false]);
  assert.equal(fake.reqs.length, n, 'Hive wasn’t called');
  const back = (await api('/channels/whatsapp/hive', 'PUT', { from: '1111' }, T)).data;
  assert.deepEqual([back.from, back.configured], ['1111', true]);
});

test('a webhook deleted on Hive comes back when the key is saved again; a test event shows up even right after another', async () => {
  // the seller deletes the webhook in Hive's dashboard, then pastes the key again here
  fake.hook = null;
  const old = (await api('/channels/whatsapp/hive', 'GET', null, T)).data.webhook.connectedAt;
  const r = (await api('/channels/whatsapp/hive', 'PUT', { apiKey: KEY }, T)).data;
  assert.equal(r.webhookRenewed, true);
  assert.ok(fake.hook?.url && fake.hook.secret.length === 64, 'registered with Hive again');
  assert.ok(r.webhook.connectedAt >= old);
  // the new secret signs deliveries (the old one would be refused)
  assert.equal((await hook('message.status', { message_id: 'nothing', status: 'read' })).status, 200);
  // a test event: its arrival is recorded even though an event came in moments ago
  const t = (await api('/channels/whatsapp/hive/webhook/test', 'POST', {}, T)).data;
  await new Promise((res) => setTimeout(res, 5));
  await hook('webhook.test', {});
  const v = (await api('/channels/whatsapp/hive', 'GET', null, T)).data.webhook;
  assert.ok(v.lastEventAt >= t.testSentAt, JSON.stringify(v));
});

test('templates: the standard set is submitted (existing ones skipped) and approved through template.status', async () => {
  const r = await api('/channels/whatsapp/hive/templates/setup', 'POST', {}, T);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const posts = fake.reqs.filter((x) => x.method === 'POST' && x.path === '/templates');
  assert.equal(posts.length, 12, 'the one already on Hive isn’t submitted again');
  assert.equal(r.data.result.order_receipt, 'SUBMITTED');
  assert.equal(r.data.result.quote_sent, 'APPROVED');
  for (const p of posts) {
    assert.match(p.body.name, /^fh_[a-z_]+$/);
    assert.equal(p.body.category, 'UTILITY');
    assert.equal(p.body.language, 'en');
    const text = p.body.components[0].parameters[0].text;
    assert.equal(p.body.samples.body.length, (text.match(/\{\{\d\}\}/g) || []).length, `${p.body.name}: a sample per variable`);
    assert.ok(!/^\{\{|\}\}$/.test(text.trim()), `${p.body.name}: no variable at the start or end`);
  }
  const byEv = Object.fromEntries(r.data.templates.map((t) => [t.event, t.status]));
  assert.equal(byEv.order_receipt, 'PENDING');
  assert.equal(byEv.quote_sent, 'APPROVED', 'one that already existed is picked up, not duplicated');
  // again: nothing new is submitted while they're in review
  const again = await api('/channels/whatsapp/hive/templates/setup', 'POST', {}, T);
  assert.equal(fake.reqs.filter((x) => x.method === 'POST' && x.path === '/templates').length, 12);
  assert.ok(Object.values(again.data.result).every((s) => ['PENDING', 'APPROVED'].includes(s)), JSON.stringify(again.data.result));

  assert.equal((await hook('template.status', { name: 'fh_order_receipt', status: 'APPROVED' }, { sig: 'sha256=00' })).status, 401, 'bad signature');
  for (const t of fake.templates) {
    t.status = 'APPROVED';
    assert.equal((await hook('template.status', { field: 'message_template_status_update', name: t.name, language: 'en', status: 'APPROVED', template_id: t.id })).status, 200);
  }
  const v = (await api('/channels/whatsapp/hive', 'GET', null, T)).data;
  assert.ok(v.templates.every((t) => t.status === 'APPROVED'), JSON.stringify(v.templates.map((t) => [t.name, t.status])));
  const refreshed = (await api('/channels/whatsapp/hive/templates', 'GET', null, T)).data;
  assert.ok(refreshed.templates.every((t) => t.status === 'APPROVED'));
});

test('checkout: a WhatsApp number is required; the order sends fh_order_receipt with an Idempotency-Key, and the seller an alert', async () => {
  const pub = (await api(`/public/${f.slug}`)).data;
  assert.equal(pub.waRequired, true);
  assert.ok(!JSON.stringify(pub).includes('1111'), 'no WhatsApp settings on the public page');
  const no = await api(`/public/${f.slug}/order`, 'POST', { stepId: co.id, email: 'priya@x.in', name: 'Priya Shah' });
  assert.equal(no.status, 400);
  assert.match(no.data.error, /WhatsApp number/);
  const o = await api(`/public/${f.slug}/order`, 'POST', { stepId: co.id, email: 'priya@x.in', name: 'Priya Shah', phone: '98111 22233' });
  assert.equal(o.status, 200, JSON.stringify(o.data));
  const m = await waitFor(() => sentTo('919811122233', 'fh_order_receipt')[0]);
  assert.ok(m, 'receipt sent');
  assert.equal(m.type, 'template');
  assert.equal(m.from, '1111');
  assert.equal(m.template.language, 'en');
  assert.equal(m.template.body[0], 'Priya');
  assert.match(m.template.body[2], /^₹/);
  assert.equal(m.key, `order_receipt:${o.data.orderId}:919811122233`);
  assert.ok(m.callback_data, 'our message id rides along for status updates');
  const alert = await waitFor(() => sentTo('919876500001', 'fh_seller_alert')[0]);
  assert.ok(alert, 'seller alerted');
  assert.equal(alert.template.body[0], 'order');
  assert.match(alert.template.body[3], /\/orders$/);
  const c = (await api(`/contacts/${k('priya@x.in')}`, 'GET', null, T)).data;
  assert.ok(c.timeline.some((t) => t.type === 'whatsapp' && /order receipt/.test(t.title)), 'logged on the timeline');

  // a delivery status updates the message
  assert.equal((await hook('message.status', { message_id: 'x', wamid: 'w', to: '919811122233', status: 'delivered', callback_data: m.callback_data })).status, 200);
  const rec = (await api('/channels/whatsapp/hive', 'GET', null, T)).data.recent.find((x) => x.id === m.callback_data);
  assert.equal(rec.status, 'delivered');
  await hook('message.status', { status: 'sent', callback_data: m.callback_data });
  assert.equal((await api('/channels/whatsapp/hive', 'GET', null, T)).data.recent.find((x) => x.id === m.callback_data).status, 'delivered', 'never goes backwards');
  await hook('message.status', { status: 'failed', callback_data: m.callback_data, error: { message: 'Number not on WhatsApp' } });
  const after = (await api('/channels/whatsapp/hive', 'GET', null, T)).data.recent.find((x) => x.id === m.callback_data);
  assert.equal(after.status, 'failed');
  assert.equal(after.error, 'Number not on WhatsApp');
  const c2 = (await api(`/contacts/${k('priya@x.in')}`, 'GET', null, T)).data;
  assert.ok(c2.timeline.some((t) => /not delivered/.test(t.title) && t.text === 'Number not on WhatsApp'));
});

test('a retried message is never sent twice (same Idempotency-Key, one record)', async () => {
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ff-hwa-'));
  process.env.HIVE_WA_API_URL = hiveUrl;
  process.env.FF_JOBS = '0';
  const { T: DB } = await import('../db.js');
  const M = await import('../messaging.js');
  M.initMessaging('test-secret');
  const H = await import('../hive-wa.js');
  const u = DB.users.insert({ email: 'inproc@x.in', channels: { whatsapp: { provider: 'hive', hive: { apiKeyEnc: M.encrypt(KEY), from: '1111', templates: { order_receipt: { name: 'fh_order_receipt', language: 'en', status: 'APPROVED' } } } } }, createdAt: Date.now() });
  const args = { to: '+91 97777 00001', params: ['Ana', 'Course', '₹10'], link: 'https://x.in/inv/1', entityId: 'ord1' };
  const ik = 'order_receipt:ord1:919777700001';
  fake.failOnce.add(ik);
  assert.equal((await H.waEvent(u.id, 'order_receipt', args)).status, 'failed', 'Hive hiccup: logged, never thrown');
  const r1 = await H.waEvent(u.id, 'order_receipt', args);
  assert.equal(r1.status, 'sent');
  const r2 = await H.waEvent(u.id, 'order_receipt', args);
  assert.equal(r2.duplicate, true);
  assert.equal(fake.reqs.filter((x) => x.path === '/messages' && x.headers['idempotency-key'] === ik).length, 2, 'the failed try and its retry — not the duplicate');
  assert.equal(sentTo('919777700001').length, 1);
  assert.equal(DB.wamsgs.all({ userId: u.id }).length, 1);
  assert.equal((await H.waEvent(u.id, 'booking_confirmed', args)).status, 'off', 'no approved template: nothing sent');
  assert.equal(H.waNumber('09777700001'), '919777700001');
  assert.equal(H.waNumber('+44 7700 900123'), '447700900123');
  assert.equal(H.waNumber('12345'), '');
});

test('booking: the WhatsApp number is required on the booking page; the confirmation goes out on WhatsApp', async () => {
  const handle = (await api('/booking-page', 'GET', null, T)).data.handle;
  let cal = (await api('/calendars', 'GET', null, T)).data[0];
  const hours = Object.fromEntries(['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].map((d) => [d, [['09:00', '12:00']]]));
  cal = (await api(`/calendars/${cal.id}`, 'PUT', { name: 'Discovery Call', slug: 'discovery', duration: 30, buffer: 0, noticeHours: 0, daysAhead: 5, hours, price: 0 }, T)).data;
  const page = (await api(`/meet/${handle}/${cal.slug}`)).data;
  assert.equal(page.calendar.waRequired, true);
  const body = { start: page.slots[0], name: 'Ravi Kumar', email: 'ravi@x.in' };
  const no = await api(`/meet/${handle}/${cal.slug}/book`, 'POST', body);
  assert.equal(no.status, 400);
  assert.match(no.data.error, /WhatsApp number/);
  const ok = await api(`/meet/${handle}/${cal.slug}/book`, 'POST', { ...body, phone: '9822233344' });
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  const m = await waitFor(() => sentTo('919822233344', 'fh_booking_confirmed')[0]);
  assert.ok(m, 'confirmation sent');
  assert.deepEqual(m.template.body.slice(0, 2), ['Ravi', 'Discovery Call']);
  assert.match(m.template.body[3], /\/booking\//);
  assert.ok(await waitFor(() => fake.sent.find((x) => x.template?.name === 'fh_seller_alert' && x.template.body[0] === 'booking')), 'seller alerted');
});

test('inbound messages: a new contact, a timeline entry and a notification; deliveries count once', async () => {
  const id = 'whd_inbound_1';
  const r = await hook('message.inbound', { from: '919700000001', type: 'text', text: 'Hi, is the course still open?', contact_name: 'Meera', timestamp: new Date().toISOString() }, { id });
  assert.equal(r.status, 200);
  assert.equal((await hook('message.inbound', { from: '919700000001', type: 'text', text: 'Hi, is the course still open?' }, { id })).data.duplicate, true);
  const list = (await api('/contacts', 'GET', null, T)).data;
  const c = list.find((x) => x.key === 'phone:9700000001');
  assert.ok(c, 'contact added');
  assert.equal(c.name, 'Meera');
  const d = (await api(`/contacts/${k(c.key)}`, 'GET', null, T)).data;
  assert.equal(d.timeline.filter((t) => t.title === 'WhatsApp message: Hi, is the course still open?').length, 1);
  const n = (await api('/notifications', 'GET', null, T)).data.items.find((x) => x.kind === 'whatsapp');
  assert.match(n.title, /Meera/);
  assert.match(n.link, /^\/inbox\/\w+$/, 'the bell opens the WhatsApp inbox conversation');

  // a reply to an existing buyer lands on that buyer
  await hook('message.inbound', { from: '919811122233', type: 'text', text: 'Thanks!' });
  assert.ok((await api(`/contacts/${k('priya@x.in')}`, 'GET', null, T)).data.timeline.some((t) => t.title === 'WhatsApp message: Thanks!'));

  // sent from the WhatsApp Business app on the same number (coexistence)
  await hook('message.echo', { from: '919800000001', to: '919700000001', type: 'text', text: 'Yes, it is!' });
  assert.ok((await api(`/contacts/${k(c.key)}`, 'GET', null, T)).data.timeline.some((t) => t.title === 'You (from the WhatsApp app): Yes, it is!'));

  // phone quality is shown in Settings
  await hook('phone.quality', { quality_rating: 'YELLOW', event: 'FLAGGED', limit: 'TIER_1K' });
  assert.equal((await api('/channels/whatsapp/hive', 'GET', null, T)).data.quality.rating, 'YELLOW');
});

test('webhook security: bad or missing signature, stale timestamp, unknown seller', async () => {
  assert.equal((await hook('message.inbound', { from: '919700000009', text: 'x' }, { sig: '' })).status, 401);
  assert.equal((await hook('message.inbound', { from: '919700000009', text: 'x' }, { sig: `sha256=${'a'.repeat(64)}` })).status, 401);
  assert.equal((await hook('message.inbound', { from: '919700000009', text: 'x' }, { ts: Date.now() - 11 * 60000 })).status, 401);
  const r = await fetch(`${srv.base}/api/hive/webhook/nobody`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-hive-signature': 'sha256=00' }, body: '{}' });
  assert.equal(r.status, 401);
  assert.ok(!(await api('/contacts', 'GET', null, T)).data.some((x) => x.key === 'phone:9700000009'));
});

test('STOP opts the contact out: buyer messages, automations and broadcasts skip them', async () => {
  await hook('message.inbound', { from: '919700000001', type: 'text', text: 'STOP' });
  const c = (await api('/contacts', 'GET', null, T)).data.find((x) => x.key === 'phone:9700000001');
  assert.equal(c.waOptOut, true);
  assert.ok((await api(`/contacts/${k(c.key)}`, 'GET', null, T)).data.timeline.some((t) => t.title === 'Unsubscribed from WhatsApp'));
  const o = await api(`/public/${f.slug}/order`, 'POST', { stepId: co.id, email: 'meera@x.in', name: 'Meera', phone: '+91 97000 00001' });
  assert.equal(o.status, 200);
  await wait(600);
  assert.equal(sentTo('919700000001').length, 0, 'no receipt to an opted-out number');
  const manual = await api(`/contacts/${k(c.key)}/whatsapp`, 'POST', { text: 'hello?' }, T);
  assert.equal(manual.status, 502);
  assert.match(manual.data.error, /opted out/);
  assert.equal((await api('/broadcasts/audience', 'POST', { channel: 'whatsapp', segment: {} }, T)).data.left.unsubscribed >= 1, true);
  // Meta's own marketing opt-out does the same
  await hook('message.opt_out', { preferences: [{ wa_id: '919811122233', value: 'stop' }] });
  assert.equal((await api('/contacts', 'GET', null, T)).data.find((x) => x.key === 'priya@x.in').waOptOut, true);
});

test('automation WhatsApp steps go through Hive (one key per run and step) and skip opted-out numbers', async () => {
  const a = (await api('/automations', 'POST', { name: 'Thanks', trigger: { type: 'purchase' }, steps: [{ type: 'whatsapp', mode: 'template', template: 'thanks_v1', language: 'en', params: '{{first_name}}, {{product}}' }] }, T)).data;
  assert.equal((await api(`/automations/${a.id}`, 'PUT', { active: true }, T)).status, 200);
  await api(`/public/${f.slug}/order`, 'POST', { stepId: co.id, email: 'auto@x.in', name: 'Asha Rao', phone: '9444400001' });
  const m = await waitFor(() => sentTo('919444400001', 'thanks_v1')[0]);
  assert.ok(m, 'sent through Hive');
  assert.equal(m.template.body[0], 'Asha');
  assert.match(m.key, /^auto:\w+:\w+$/);
  await api(`/public/${f.slug}/order`, 'POST', { stepId: co.id, email: 'meera2@x.in', name: 'Meera', phone: '9700000001' });
  await wait(800);
  assert.equal(sentTo('919700000001', 'thanks_v1').length, 0);
  const run = (await api(`/automations/${a.id}`, 'GET', null, T)).data.runs.find((r) => r.email === 'meera2@x.in');
  assert.match(run.log.at(-1).detail, /opted out/);
  await api(`/automations/${a.id}`, 'PUT', { active: false }, T);
});

test('abandoned checkouts get one WhatsApp reminder when the toggle is on — not after they buy', async () => {
  assert.equal((await api('/channels/whatsapp/hive', 'PUT', { abandonedReminder: true }, T)).data.abandonedReminder, true);
  await api(`/public/${f.slug}/abandon`, 'POST', { notice: true, stepId: co.id, name: 'Kiran Rao', phone: '9600000001' });
  await api(`/public/${f.slug}/abandon`, 'POST', { notice: true, stepId: co.id, name: 'Bought', phone: '9600000002' });
  await api(`/public/${f.slug}/order`, 'POST', { stepId: co.id, email: 'bought@x.in', name: 'Bought', phone: '9600000002' });
  const m = await waitFor(() => sentTo('919600000001', 'fh_abandoned_checkout')[0]);
  assert.ok(m, 'reminder sent');
  assert.equal(m.template.body[0], 'Kiran');
  assert.match(m.template.body[2], /\/f\//);
  await wait(1000);
  assert.equal(sentTo('919600000001', 'fh_abandoned_checkout').length, 1, 'once per cart');
  assert.equal(sentTo('919600000002', 'fh_abandoned_checkout').length, 0, 'not after buying');
});

test('setup again: a REJECTED template is edited and resubmitted (or deleted and created again if it can’t be edited); the result says what happened', async () => {
  const S = '/channels/whatsapp/hive/templates/setup';
  const ship = fake.templates.find((t) => t.name === 'fh_order_shipped');
  Object.assign(ship, { status: 'REJECTED', rejected_reason: 'INVALID_FORMAT' });
  const v = (await api('/channels/whatsapp/hive/templates', 'GET', null, T)).data.templates.find((t) => t.event === 'order_shipped');
  assert.deepEqual([v.status, v.reason], ['REJECTED', 'INVALID_FORMAT']);
  const r = (await api(S, 'POST', {}, T)).data;
  assert.equal(r.result.order_shipped, 'SUBMITTED');
  assert.equal(Object.values(r.result).filter((s) => s === 'APPROVED').length, 12, JSON.stringify(r.result));
  assert.ok(fake.reqs.some((x) => x.method === 'POST' && x.path === `/templates/${ship.id}`), 'edited in place');
  assert.equal(r.templates.find((t) => t.event === 'order_shipped').status, 'PENDING');

  // can't be edited: deleted and created again, once
  const pay = fake.templates.find((t) => t.name === 'fh_payment_failed');
  Object.assign(pay, { status: 'REJECTED', rejected_reason: 'NONE' });
  fake.noEdit = true;
  assert.equal((await api('/channels/whatsapp/hive/templates', 'GET', null, T)).data.templates.find((t) => t.event === 'payment_failed').reason, '', 'Meta’s “NONE” isn’t shown as a reason');
  const posts = fake.reqs.filter((x) => x.method === 'POST' && x.path === '/templates').length;
  const r2 = (await api(S, 'POST', {}, T)).data;
  fake.noEdit = false;
  assert.equal(r2.result.payment_failed, 'SUBMITTED');
  assert.ok(fake.reqs.some((x) => x.method === 'DELETE' && x.path === '/templates/fh_payment_failed' && x.query.from === '1111'));
  assert.equal(fake.reqs.filter((x) => x.method === 'POST' && x.path === '/templates').length, posts + 1);
  assert.equal(fake.templates.filter((t) => t.name === 'fh_payment_failed').length, 1);
  for (const t of fake.templates) t.status = 'APPROVED';
  await api('/channels/whatsapp/hive/templates', 'GET', null, T);
});

test('own templates: checked like Meta checks them before anything reaches Hive; created with BODY (+FOOTER), listed, deleted', async () => {
  const C = '/channels/whatsapp/hive/templates/custom';
  const ok = { name: 'diwali_offer', category: 'MARKETING', body: 'Hi {{1}}, our Diwali sale is live now with {{2}} off every course in the store until Sunday night.', samples: ['Priya', '30%'], footer: 'Reply STOP to opt out' };
  const n0 = fake.reqs.length;
  for (const [patch, re] of [
    [{ name: 'Diwali Offer' }, /lowercase/],
    [{ name: 'fh_mine' }, /fh_/],
    [{ category: 'AUTHENTICATION' }, /category/],
    [{ body: ok.body.replace('{{2}}', '{{3}}') }, /no gaps/],
    [{ body: ok.body.replace('Hi {{1}}', '{{1}}') }, /can’t start with a variable/],
    [{ body: `${ok.body} {{3}}`, samples: ['a', 'b', 'c'] }, /can’t end with a variable/],
    [{ body: ok.body.replace('{{2}}', '{{2}} {{3}}'), samples: ['a', 'b', 'c'] }, /next to each other/],
    [{ body: 'Hi {{1}}, sale: {{2}} off now' }, /Too many variables.*at least 11 words/],
    [{ samples: ['Priya'] }, /example value per variable \(2 needed\)/],
    [{ samples: ['Priya', ' '] }, /example value for \{\{2\}\}/],
    [{ footer: 'Thanks {{1}}' }, /footer/],
    [{ footer: 'x'.repeat(61) }, /60 characters/],
  ]) {
    const r = await api(C, 'POST', { ...ok, ...patch }, T);
    assert.equal(r.status, 400, JSON.stringify(patch));
    assert.match(r.data.error, re);
  }
  assert.equal(fake.reqs.length, n0, 'nothing reached Hive');

  const r = await api(C, 'POST', ok, T);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const p = fake.reqs.at(-1);
  assert.deepEqual([p.method, p.path, p.body.name, p.body.category, p.body.language, p.body.from], ['POST', '/templates', 'diwali_offer', 'MARKETING', 'en', '1111']);
  assert.deepEqual(p.body.components, [{ type: 'body', parameters: [{ type: 'text', text: ok.body }] }, { type: 'footer', parameters: [{ type: 'text', text: ok.footer }] }]);
  assert.deepEqual(p.body.samples.body, ['Priya', '30%']);
  assert.equal(r.data.template.status, 'PENDING');
  assert.equal((await api(C, 'POST', { ...ok, name: 'new_batch', category: 'UTILITY', footer: '' }, T)).status, 200);
  assert.deepEqual(fake.reqs.at(-1).body.components.map((c) => c.type), ['body'], 'no footer: BODY only');
  const dup = await api(C, 'POST', ok, T);
  assert.equal(dup.status, 400);
  assert.match(dup.data.error, /already have a template with this name/);

  const list = (await api(C, 'GET', null, T)).data.templates;
  assert.deepEqual(list.map((t) => t.name).sort(), ['diwali_offer', 'new_batch'], 'the standard fh_ ones aren’t listed');
  const d = list.find((t) => t.name === 'diwali_offer');
  assert.deepEqual([d.category, d.status, d.body, d.footer], ['MARKETING', 'PENDING', ok.body, ok.footer]);

  assert.equal((await api(`${C}/fh_order_receipt`, 'DELETE', null, T)).status, 400, 'standard templates can’t be deleted');
  assert.ok(fake.templates.some((t) => t.name === 'fh_order_receipt'));
  assert.equal((await api(`${C}/new_batch`, 'DELETE', null, T)).status, 200);
  assert.ok(fake.reqs.some((x) => x.method === 'DELETE' && x.path === '/templates/new_batch' && x.query.from === '1111'));
  assert.ok(!fake.templates.some((t) => t.name === 'new_batch'));
});

test('approved templates for automations and broadcasts: only APPROVED ones, with their variable count; marketers may read them', async () => {
  fake.templates.find((t) => t.name === 'diwali_offer').status = 'APPROVED';
  fake.templates.push({ id: 'p1', name: 'still_pending', language: 'en', status: 'PENDING', category: 'MARKETING', components: [{ type: 'BODY', text: 'Hello {{1}} there' }] });
  const a = await api('/channels/whatsapp/hive/templates/approved', 'GET', null, T);
  assert.equal(a.status, 200, JSON.stringify(a.data));
  const names = a.data.templates.map((t) => t.name);
  assert.ok(!names.includes('still_pending'));
  assert.ok(names.includes('fh_order_receipt'), 'the standard ones too');
  assert.equal(fake.reqs.at(-1).query.status, 'APPROVED');
  const d = a.data.templates.find((t) => t.name === 'diwali_offer');
  assert.deepEqual([d.vars, d.category, d.language], [2, 'MARKETING', 'en']);
  assert.match(d.body, /^Hi \{\{1\}\}/);
  assert.equal(a.data.templates.find((t) => t.name === 'fh_order_receipt').vars, 4);

  const m = await register(api);
  const inv = (await api('/team/invite', 'POST', { email: m.email, role: 'marketer' }, T)).data;
  const ws = (await api('/team/accept', 'POST', { token: inv.token }, m.token)).data.token;
  assert.equal((await api('/channels/whatsapp/hive/templates/approved', 'GET', null, ws)).status, 200);
  assert.equal((await api('/channels/whatsapp/hive/templates/custom', 'GET', null, ws)).status, 403, 'the rest of the settings stay admin-only');
  assert.equal((await api('/channels/whatsapp/hive/templates/custom', 'POST', {}, ws)).status, 403);
});

test('per-event switches; Meta direct can be chosen again; disconnecting keeps Meta details', async () => {
  await api('/channels/whatsapp/hive', 'PUT', { events: { order_receipt: false } }, T);
  await api(`/public/${f.slug}/order`, 'POST', { stepId: co.id, email: 'off@x.in', name: 'Off', phone: '9555500001' });
  await wait(600);
  assert.equal(sentTo('919555500001', 'fh_order_receipt').length, 0, 'switched off');
  assert.ok((await api('/channels/whatsapp/hive/test', 'POST', {}, T)).data.ok, 'test to the seller’s own number');

  await api('/channels/whatsapp', 'PUT', { phoneNumberId: '1234567890123', token: 'EAAG-x' }, T);
  let ch = (await api('/channels', 'GET', null, T)).data;
  assert.equal(ch.whatsapp.provider, 'hive', 'saving Meta details keeps Hive in use');
  assert.equal((await api('/channels/whatsapp/hive', 'GET', null, T)).data.hasKey, true);
  await api('/channels/whatsapp/hive', 'PUT', { provider: 'meta' }, T);
  ch = (await api('/channels', 'GET', null, T)).data;
  assert.equal(ch.whatsapp.provider, 'meta');
  const off = await api('/channels/whatsapp/hive/templates/approved', 'GET', null, T);
  assert.deepEqual([off.status, off.data.templates], [200, null], 'not in use: the editors keep a free-text name');
  assert.equal((await api(`/public/${f.slug}`)).data.waRequired, undefined, 'phone optional again');
  await api('/channels/whatsapp/hive', 'PUT', { clear: true }, T);
  ch = (await api('/channels', 'GET', null, T)).data;
  assert.equal(ch.whatsapp.phoneNumberId, '1234567890123');
  assert.equal((await api('/channels/whatsapp/hive', 'GET', null, T)).data.hasKey, false);
});
