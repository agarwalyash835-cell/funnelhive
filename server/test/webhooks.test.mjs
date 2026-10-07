import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import { startServer, register } from './helpers.mjs';

// A receiver that fails the first 2 deliveries, then accepts
let received = [], failFirst = 2, receiver, url;
before(async () => {
  receiver = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      received.push({ headers: req.headers, body });
      if (failFirst-- > 0) { res.writeHead(500); return res.end('nope'); }
      res.writeHead(200); res.end('ok');
    });
  }).listen(0);
  url = `http://127.0.0.1:${receiver.address().port}/hook`;
});
after(() => receiver.close());

test('webhooks: signed, retried until delivered, logged', async () => {
  const srv = await startServer({ WEBHOOK_RETRY_SCALE: '0.002', WEBHOOK_TICK_MS: '50' });
  try {
    const { token } = await register(srv.api);
    const s = (await srv.api('/settings', 'PUT', { webhookUrl: url, webhookSecret: 'whsec_attacker' }, token)).data;
    assert.match(s.webhookSecret, /^whsec_[0-9a-f]{48}$/, 'client cannot choose the secret');
    const f = (await srv.api('/templates/yoga/use', 'POST', {}, token)).data;
    await srv.api(`/funnels/${f.id}`, 'PUT', { published: true }, token);
    await srv.api(`/public/${f.slug}/lead`, 'POST', { stepId: f.steps[0].id, email: 'hook@x.dev' });

    // 0s, 60ms, 240ms with the shrunk schedule → third attempt succeeds
    for (let i = 0; i < 60 && received.length < 3; i++) await new Promise((r) => setTimeout(r, 50));
    assert.equal(received.length, 3, 'two failures then a success');
    const last = received[2];
    const [t, v1] = last.headers['x-funnelforge-signature'].split(',').map((p) => p.split('=')[1]);
    const expected = crypto.createHmac('sha256', s.webhookSecret).update(`${t}.${last.body}`).digest('hex');
    assert.equal(v1, expected, 'signature verifies with the account secret');
    assert.equal(last.headers['x-funnelforge-event'], 'lead.created');
    const payload = JSON.parse(last.body);
    assert.equal(payload.data.email, 'hook@x.dev');
    assert.equal(payload.id, last.headers['x-funnelforge-delivery'], 'delivery id for idempotency');

    await new Promise((r) => setTimeout(r, 100));
    const log = (await srv.api('/webhooks/deliveries', 'GET', null, token)).data;
    assert.equal(log[0].status, 'delivered');
    assert.equal(log[0].attempts, 3);

    // test button reports the real result; rotation changes the secret
    const ping = (await srv.api('/settings/test-webhook', 'POST', {}, token)).data;
    assert.equal(ping.status, 200);
    const rotated = (await srv.api('/settings/webhook-secret', 'POST', {}, token)).data.webhookSecret;
    assert.notEqual(rotated, s.webhookSecret);
  } finally { await srv.stop(); }
});

test('webhooks: unreachable endpoint ends as failed after all retries', async () => {
  const srv = await startServer({ WEBHOOK_RETRY_SCALE: '0.0002', WEBHOOK_TICK_MS: '20' });
  try {
    const { token } = await register(srv.api);
    await srv.api('/settings', 'PUT', { webhookUrl: 'http://127.0.0.1:1/nothing-here' }, token);
    await srv.api('/settings/test-webhook', 'POST', {}, token);
    let log;
    for (let i = 0; i < 100; i++) { log = (await srv.api('/webhooks/deliveries', 'GET', null, token)).data; if (log[0].status === 'failed') break; await new Promise((r) => setTimeout(r, 50)); }
    assert.equal(log[0].status, 'failed');
    assert.equal(log[0].attempts, 6);
    assert.ok(log[0].lastError);
  } finally { await srv.stop(); }
});
