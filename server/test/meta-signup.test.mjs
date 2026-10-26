// WhatsApp sign-up through Meta Embedded Signup against a fake Graph API: hidden until the owner sets the app up
// (secret checked with Meta, never shown), the code exchange saves the channel, a new number is registered and a
// WhatsApp Business app number (coexistence) is not, the signed app webhook feeds the inbox (messages, echoes
// from the phone app, contacts), and imported chat history never sets off a chatbot.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import { startServer, register, enable2fa } from './helpers.mjs';

const APP_ID = '1234567890123', CONFIG_ID = '9876543210987', SECRET = 'a'.repeat(30) + 'b1', BIZ = 'EAAbusinesstoken_secret_xyz';
const g = { reqs: [], sent: [] };
let fake, srv, api, ADMIN, S1, S2;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms = 4000) { for (let t = 0; t < ms; t += 50) { const v = await fn(); if (v) return v; await wait(50); } return fn(); }
const calls = (method, re) => g.reqs.filter((r) => r.method === method && re.test(r.path));

before(async () => {
  fake = http.createServer((req, res) => {
    let b = '';
    req.on('data', (d) => { b += d; });
    req.on('end', () => {
      const url = new URL(req.url, 'http://x');
      const p = url.pathname.replace(/^\/v26\.0/, '');
      const q = Object.fromEntries(url.searchParams);
      const j = /json/.test(req.headers['content-type'] || '') && b ? JSON.parse(b) : null;
      g.reqs.push({ method: req.method, path: p, query: q, body: j, auth: req.headers.authorization || '' });
      const send = (s, o) => { res.writeHead(s, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
      if (p === `/${APP_ID}`) return q.access_token === `${APP_ID}|${SECRET}` ? send(200, { id: APP_ID, name: 'FunnelHive' }) : send(400, { error: { message: 'Invalid OAuth access token signature.', code: 190 } });
      if (p === '/oauth/access_token') return q.client_secret === SECRET && q.client_id === APP_ID && q.code.startsWith('good') ? send(200, { access_token: BIZ, token_type: 'bearer' }) : send(400, { error: { message: 'This authorization code has expired.', code: 100 } });
      if (req.headers.authorization !== `Bearer ${BIZ}`) return send(401, { error: { message: 'Invalid token', code: 190 } });
      if (p === '/1110001/phone_numbers') return send(200, { data: [{ id: '5550001', display_phone_number: '+91 98000 00001', verified_name: 'Asha Yoga', is_on_biz_app: false }] });
      if (p === '/2220002/phone_numbers') return send(200, { data: [{ id: '5550002', display_phone_number: '+91 98000 00002', verified_name: 'Ravi Sweets', is_on_biz_app: true, platform_type: 'CLOUD_API' }] });
      if (/^\/\d+\/subscribed_apps$/.test(p)) return send(200, { success: true });
      if (/^\/\d+\/register$/.test(p)) return send(200, { success: true });
      if (/^\/\d+\/smb_app_data$/.test(p)) return send(200, { messaging_product: 'whatsapp', request_id: `req_${j.sync_type}` });
      if (/^\/\d+\/messages$/.test(p)) { g.sent.push({ pnid: p.split('/')[1], ...j }); return send(200, { messaging_product: 'whatsapp', messages: [{ id: `wamid.out${g.sent.length}` }] }); }
      if (p === '/2220002/message_templates') return send(200, { data: [{ name: 'order_update', language: 'en', category: 'UTILITY', status: 'APPROVED', components: [{ type: 'BODY', text: 'Hi {{1}}, your order {{2}} is ready for pickup today.' }] }] });
      send(404, { error: { message: `No route ${p}` } });
    });
  }).listen(0);
  await wait(30);
  srv = await startServer({ META_GRAPH_BASE: `http://127.0.0.1:${fake.address().port}`, ADMIN_EMAILS: 'owner@meta.test' });
  api = srv.api;
  ADMIN = (await register(api, 'owner@meta.test')).token;
  const link = srv.log().match(/To: owner@meta\.test[\s\S]*?\/verify\?token=([a-f0-9.]+)/);
  await api('/auth/verify', 'POST', { token: link[1] });
  ADMIN = (await enable2fa(api, ADMIN)).token;
  S1 = (await register(api)).token;
  S2 = (await register(api)).token;
});
after(async () => { await srv?.stop(); fake?.close(); });

const hook = (body, secret = SECRET) => {
  const raw = JSON.stringify(body);
  return fetch(`${srv.base}/api/meta/webhook`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-hub-signature-256': `sha256=${crypto.createHmac('sha256', secret).update(raw).digest('hex')}` }, body: raw });
};
const change = (field, value, pnid = '5550002', waba = '2220002') => ({ object: 'whatsapp_business_account', entry: [{ id: waba, changes: [{ field, value: { messaging_product: 'whatsapp', metadata: { display_phone_number: '919800000002', phone_number_id: pnid }, ...value } }] }] });

test('hidden until the owner sets up the Meta app; the app secret is checked and never shown', async () => {
  assert.deepEqual((await api('/channels/whatsapp/signup', 'GET', null, S1)).data, { available: false });
  assert.equal((await api('/channels/whatsapp/signup', 'POST', { code: 'good1', wabaId: '1110001' }, S1)).status, 404);
  // a seller can't reach the owner's settings
  assert.equal((await api('/admin/settings', 'PUT', { metaSignup: { appId: APP_ID, configId: CONFIG_ID, secret: SECRET } }, S1)).status, 403);
  assert.equal((await api('/admin/settings', 'GET', null, S1)).status, 403);
  const put = (m) => api('/admin/settings', 'PUT', { metaSignup: m }, ADMIN);
  assert.match((await put({ appId: 'abc', configId: CONFIG_ID, secret: SECRET })).data.error, /App ID/);
  assert.match((await put({ appId: APP_ID, configId: CONFIG_ID, secret: 'f'.repeat(32) })).data.error, /Meta didn’t accept/);
  assert.equal((await api('/channels/whatsapp/signup', 'GET', null, S1)).data.available, false, 'a refused secret is not saved');
  const ok = await put({ appId: APP_ID, configId: CONFIG_ID, secret: SECRET });
  assert.equal(ok.status, 200, JSON.stringify(ok.data).slice(0, 200));
  const m = ok.data.metaSignup;
  assert.equal(m.ready, true);
  assert.equal(m.hasSecret, true);
  assert.equal(m.webhookPath, '/api/meta/webhook');
  assert.ok(m.verifyToken.length >= 20);
  assert.ok(!JSON.stringify(ok.data).includes(SECRET) && !JSON.stringify(ok.data).includes('secretEnc'), 'the secret never goes back to the browser');
  // a later save keeps the secret when it's left empty
  assert.equal((await put({ appId: APP_ID, configId: CONFIG_ID, esVersion: 'v4' })).data.metaSignup.esVersion, 'v4');
  await put({ esVersion: 'v5' });
  const s = await api('/channels/whatsapp/signup', 'GET', null, S1);
  assert.deepEqual({ ...s.data, connected: undefined }, { available: true, appId: APP_ID, configId: CONFIG_ID, graphVersion: 'v26.0', esVersion: 'v5', connected: undefined });
  assert.ok(!JSON.stringify(s.data).includes(SECRET));
  // Meta's webhook check
  const v = await fetch(`${srv.base}/api/meta/webhook?hub.mode=subscribe&hub.verify_token=${encodeURIComponent(m.verifyToken)}&hub.challenge=12345`);
  assert.equal(await v.text(), '12345');
  assert.equal((await fetch(`${srv.base}/api/meta/webhook?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=1`)).status, 403);
});

test('a new number: code exchanged, account subscribed, number registered with a PIN, channel saved', async () => {
  const bad = await api('/channels/whatsapp/signup', 'POST', { code: 'expired', wabaId: '1110001', phoneNumberId: '5550001' }, S1);
  assert.match(bad.data.error, /30 seconds/);
  const r = await api('/channels/whatsapp/signup', 'POST', { code: 'good1', wabaId: '1110001', phoneNumberId: '5550001', coexistence: false }, S1);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.connected.display, '919800000001');
  assert.equal(r.data.connected.coexistence, false);
  assert.equal(calls('POST', /^\/1110001\/subscribed_apps$/).length, 1);
  const reg = calls('POST', /^\/5550001\/register$/);
  assert.equal(reg.length, 1);
  assert.match(reg[0].body.pin, /^\d{6}$/);
  assert.equal(calls('POST', /^\/5550001\/smb_app_data$/).length, 0, 'no app sync for a new number');
  const ch = (await api('/channels', 'GET', null, S1)).data.whatsapp;
  assert.deepEqual([ch.configured, ch.provider, ch.phoneNumberId, ch.businessId, ch.hasToken], [true, 'meta', '5550001', '1110001', true]);
  assert.ok(!JSON.stringify(ch).includes(BIZ), 'the token stays on the server');
  // automations and tests send through the saved channel
  assert.equal((await api('/inbox', 'GET', null, S1)).data.connected, true);
  // the same number can't be taken by another account
  assert.equal((await api('/channels/whatsapp/signup', 'POST', { code: 'good2', wabaId: '1110001', phoneNumberId: '5550001' }, S2)).status, 409);
});

test('coexistence: never registered, contacts synced, echoes and messages reach the inbox, bots run on live messages only', async () => {
  const before = calls('POST', /\/register$/).length;
  // the popup only shared the account: the number is looked up
  const r = await api('/channels/whatsapp/signup', 'POST', { code: 'good3', wabaId: '2220002', coexistence: true }, S2);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(calls('POST', /\/register$/).length, before, 'a WhatsApp Business app number is not registered again');
  assert.equal(r.data.connected.coexistence, true);
  assert.equal(r.data.connected.history, null, 'history is off unless asked for');
  assert.equal(r.data.connected.canImportHistory, true);
  await waitFor(() => calls('POST', /^\/5550002\/smb_app_data$/).length);
  assert.deepEqual(calls('POST', /^\/5550002\/smb_app_data$/).map((x) => x.body.sync_type), ['smb_app_state_sync']);

  // a welcome chatbot is on
  const f = (await api('/waflows', 'POST', { flow: { name: 'Hi', trigger: { type: 'welcome' }, nodes: [{ id: 'start', type: 'start' }, { id: 'm1', type: 'message', data: { text: 'Welcome to Ravi Sweets!' } }], edges: [{ from: 'start', port: 'next', to: 'm1' }] } }, S2)).data;
  assert.equal((await api(`/waflows/${f.id}`, 'PUT', { active: true }, S2)).status, 200);

  // unsigned / wrongly signed events are refused
  assert.equal((await hook(change('messages', {}), 'f'.repeat(32))).status, 401);

  // the seller opts in to history afterwards: chats come in marked imported, nothing replies to them
  const h = await api('/channels/whatsapp/signup/history', 'POST', {}, S2);
  assert.equal(h.status, 200, JSON.stringify(h.data));
  assert.equal(h.data.connected.history.state, 'importing');
  assert.equal((await api('/channels/whatsapp/signup/history', 'POST', {}, S2)).status, 400, 'only once');
  const t0 = Math.floor(Date.now() / 1000) - 30 * 86400;
  assert.equal((await hook(change('history', { history: [{ metadata: { phase: 0, chunk_order: 1, progress: 100 }, threads: [{ id: '919811111111', messages: [
    { from: '919811111111', id: 'wamid.h1', timestamp: String(t0), type: 'text', text: { body: 'Do you deliver to Andheri?' }, history_context: { status: 'READ' } },
    { from: '919800000002', to: '919811111111', id: 'wamid.h2', timestamp: String(t0 + 60), type: 'text', text: { body: 'Yes, free above ₹500' }, history_context: { status: 'READ' } },
  ] }] }] }))).status, 200);
  const sentBefore = g.sent.length;
  await wait(400);
  let list = (await api('/inbox', 'GET', null, S2)).data.convs;
  const old = list.find((c) => c.num === '919811111111');
  assert.ok(old, 'the imported chat is in the inbox');
  const om = (await api(`/inbox/${old.id}`, 'GET', null, S2)).data.messages;
  assert.deepEqual(om.map((m) => [m.dir, m.text, !!m.imported]), [['in', 'Do you deliver to Andheri?', true], ['out', 'Yes, free above ₹500', true]]);
  assert.equal(g.sent.length, sentBefore, 'no chatbot ran on imported history');
  // a repeated chunk isn't imported twice
  await hook(change('history', { history: [{ metadata: { progress: 100 }, threads: [{ id: '919811111111', messages: [{ from: '919811111111', id: 'wamid.h1', timestamp: String(t0), type: 'text', text: { body: 'Do you deliver to Andheri?' } }] }] }] }));
  await wait(200);
  assert.equal((await api(`/inbox/${old.id}`, 'GET', null, S2)).data.messages.length, 2);
  assert.equal((await api('/channels/whatsapp/signup', 'GET', null, S2)).data.connected.history.state, 'done');

  // a live message from a new customer: the welcome chatbot answers over Meta
  assert.equal((await hook(change('messages', { contacts: [{ profile: { name: 'Meera' }, wa_id: '919822222222' }], messages: [{ from: '919822222222', id: 'wamid.in1', timestamp: String(Math.floor(Date.now() / 1000)), type: 'text', text: { body: 'Hello' } }] }))).status, 200);
  const reply = await waitFor(() => g.sent.find((m) => m.to === '919822222222'));
  assert.ok(reply, 'the chatbot replied');
  assert.equal(reply.pnid, '5550002');
  assert.equal(reply.text.body, 'Welcome to Ravi Sweets!');
  list = (await api('/inbox', 'GET', null, S2)).data.convs;
  const live = list.find((c) => c.num === '919822222222');
  assert.equal(live.name, 'Meera');
  // the delivery status comes back on the webhook
  await hook(change('messages', { statuses: [{ id: 'wamid.out' + g.sent.length, status: 'delivered', recipient_id: '919822222222' }] }));
  await waitFor(async () => (await api(`/inbox/${live.id}`, 'GET', null, S2)).data.messages.some((m) => m.status === 'delivered'));
  assert.ok((await api(`/inbox/${live.id}`, 'GET', null, S2)).data.messages.some((m) => m.dir === 'out' && m.status === 'delivered'));
  // the same message delivered twice by Meta is handled once
  await hook(change('messages', { messages: [{ from: '919822222222', id: 'wamid.in1', timestamp: '1', type: 'text', text: { body: 'Hello' } }] }));
  await wait(200);
  assert.equal((await api(`/inbox/${live.id}`, 'GET', null, S2)).data.messages.filter((m) => m.dir === 'in').length, 1);

  // the seller answers from the WhatsApp Business app: shown as theirs, and the chat is handed to a person
  await hook(change('smb_message_echoes', { message_echoes: [{ from: '919800000002', to: '919822222222', id: 'wamid.echo1', timestamp: String(Math.floor(Date.now() / 1000)), type: 'text', text: { body: 'Hi Meera, Ravi here' } }] }));
  const echo = await waitFor(async () => (await api(`/inbox/${live.id}`, 'GET', null, S2)).data.messages.find((m) => m.text === 'Hi Meera, Ravi here'));
  assert.equal(echo.by, 'app');
  assert.equal(echo.dir, 'out');

  // contacts from the app
  await hook(change('smb_app_state_sync', { state_sync: [{ type: 'contact', contact: { full_name: 'Kiran Patel', first_name: 'Kiran', phone_number: '919833333333' }, action: 'add', metadata: { timestamp: '1' } }] }));
  const c = await waitFor(async () => { const d = (await api('/contacts?q=Kiran', 'GET', null, S2)).data; return JSON.stringify(d).includes('Kiran Patel'); });
  assert.ok(c, 'the app contact is in Contacts');

  // approved templates for the inbox come from the seller's own account
  const tp = (await api('/inbox/templates', 'GET', null, S2)).data.templates;
  assert.deepEqual(tp.map((t) => [t.name, t.vars]), [['order_update', 2]]);
  // events for a number nobody connected here are ignored
  assert.equal((await hook(change('messages', { messages: [{ from: '919844444444', id: 'wamid.x', type: 'text', text: { body: 'Hi' } }] }, '9990009', '9990009'))).status, 200);
});
