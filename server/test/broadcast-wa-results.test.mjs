// A WhatsApp broadcast's results: delivered and read from WhatsApp's receipts (Hive's message.status webhook),
// replied from the inbox, not delivered with the reason — and follow-ups to those who didn't read it, or read it
// but didn't reply. A fake Hive WhatsApp API runs locally.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import { startServer, register } from './helpers.mjs';

const KEY = 'hk_test_ok_results_123';
const fake = { sent: [], hook: null, n: 0 };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 6000) => { for (let t = 0; t < ms; t += 50) { const v = await fn(); if (v) return v; await wait(50); } return fn(); };
let hive, srv, api, T, f;

before(async () => {
  hive = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => { body += d; });
    req.on('end', () => {
      const p = new URL(req.url, 'http://x').pathname.replace(/^\/wa\/v1/, '');
      const j = body ? JSON.parse(body) : null;
      const send = (s, o) => { res.writeHead(s, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
      if (req.headers.authorization !== `Bearer ${KEY}`) return send(401, { error: 'Invalid API key' });
      const route = `${req.method} ${p}`;
      if (route === 'GET /me') return send(200, { workspace_id: 'ws_1', prefix: 'hk_test_ok_res' });
      if (route === 'GET /numbers') return send(200, { numbers: [{ id: 'ch_1', display: '919800000001', phone_number_id: '1111' }] });
      if (route === 'GET /templates') return send(200, { templates: [{ id: 't1', name: 'diwali_offer', language: 'en', status: 'APPROVED', category: 'MARKETING', components: [{ type: 'BODY', text: 'Diwali offer for you!' }] }] });
      if (route === 'PUT /webhooks') { fake.hook = j; return send(200, { ok: true }); }
      if (route === 'GET /window') return send(200, { open: true });
      if (route === 'POST /messages') { fake.sent.push(j); return send(202, { id: `msg_${++fake.n}`, wamid: `wamid.${fake.n}`, status: 'queued' }); }
      send(404, { error: 'not found' });
    });
  });
  await new Promise((r) => hive.listen(0, '127.0.0.1', r));
  srv = await startServer({ HIVE_WA_API_URL: `http://127.0.0.1:${hive.address().port}/wa/v1`, HIVE_WA_TICK_MS: '300', BROADCAST_TICK_MS: '100' });
  api = srv.api;
  T = (await register(api)).token;
  assert.equal((await api('/channels/whatsapp/hive', 'PUT', { apiKey: KEY }, T)).status, 200);
  f = (await api('/templates/yoga/use', 'POST', {}, T)).data;
  await api(`/funnels/${f.id}`, 'PUT', { published: true }, T);
  for (const [i, name] of ['Asha', 'Vikram', 'Meera', 'Rohit'].entries()) await api(`/public/${f.slug}/lead`, 'POST', { stepId: f.steps[0].id, email: `${name.toLowerCase()}@example.com`, name, phone: `98111000${i + 1}0`, consent: true });
});
after(async () => { await srv.stop(); hive.close(); });

async function hook(event, data) {
  const id = `whd_${crypto.randomUUID()}`, ts = Date.now();
  const raw = JSON.stringify({ id, event, created_at: new Date(ts).toISOString(), workspace_id: 'ws_1', number: { id: 'ch_1', display: '919800000001', phone_number_id: '1111' }, data });
  const sig = `sha256=${crypto.createHmac('sha256', fake.hook.secret).update(raw).digest('hex')}`;
  const r = await fetch(srv.base + new URL(fake.hook.url).pathname, { method: 'POST', headers: { 'content-type': 'application/json', 'x-hive-signature': sig, 'x-hive-event': event, 'x-hive-delivery-id': id, 'x-hive-timestamp': String(ts) }, body: raw });
  assert.equal(r.status, 200);
}

test('a WhatsApp broadcast reports delivered, read, replied and not delivered — and follows up the non-readers', async () => {
  const b = (await api('/broadcasts', 'POST', { name: 'Diwali', channel: 'whatsapp', wa: { template: 'diwali_offer', language: 'en' }, segment: {} }, T)).data;
  const s = await api(`/broadcasts/${b.id}/send`, 'POST', {}, T);
  assert.equal(s.status, 200, JSON.stringify(s.data));
  await until(async () => (await api(`/broadcasts/${b.id}`, 'GET', null, T)).data.status === 'sent');
  assert.equal(fake.sent.length, 4);
  let d = (await api(`/broadcasts/${b.id}`, 'GET', null, T)).data;
  assert.deepEqual([d.waResults.sent, d.waResults.delivered, d.waResults.read, d.waResults.replied], [4, 0, 0, 0], 'sent, nothing confirmed yet');

  // WhatsApp's receipts: Asha read it, Vikram got it, Meera's failed; Rohit only replied (read receipts off)
  const to = (n) => fake.sent.find((m) => m.to === `9198111000${n}0`).callback_data;
  await hook('message.status', { callback_data: to(1), status: 'delivered' });
  await hook('message.status', { callback_data: to(1), status: 'read' });
  await hook('message.status', { callback_data: to(2), status: 'delivered' });
  await hook('message.status', { callback_data: to(3), status: 'failed', error: { message: 'Number not on WhatsApp' } });
  await hook('message.inbound', { from: '919811100040', type: 'text', text: 'Interested!' });
  d = await until(async () => { const x = (await api(`/broadcasts/${b.id}`, 'GET', null, T)).data; return x.waResults.replied === 1 && x; });
  assert.deepEqual([d.waResults.sent, d.waResults.delivered, d.waResults.read, d.waResults.replied, d.waResults.notDelivered], [4, 3, 2, 1, 1]);
  assert.deepEqual(d.waResults.reasons, [{ reason: 'Number not on WhatsApp', count: 1 }]);

  // follow-ups: didn't read it → Vikram; read it but didn't reply → Asha; didn't receive it → Meera
  const reach = async (who) => { const r = await api(`/broadcasts/${b.id}/retarget`, 'POST', { who }, T); assert.equal(r.status, 200, JSON.stringify(r.data)); return r.data.audience.reach; };
  assert.equal(await reach('not_read'), 1);
  assert.equal(await reach('read_no_reply'), 1);
  assert.equal(await reach('failed'), 1);
  assert.equal(await reach('all'), 4);
  assert.equal((await api(`/broadcasts/${b.id}/retarget`, 'POST', { who: 'not_opened' }, T)).status, 400, 'opens are an email thing');
});
