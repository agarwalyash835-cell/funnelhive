// Admin → Monitoring (Better Stack heartbeats) and the backup recovery key: heartbeat URLs are checked with a real ping
// before they're saved and never sent back; a backup run reports to its heartbeat (/fail, with the reason, while no
// copy leaves the server); the recovery key is shown only on purpose, and every showing is audited.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { startServer, register, enable2fa } from './helpers.mjs';

let fake, srv, api, ADMIN, hb;
const hits = [];
before(async () => {
  fake = http.createServer((req, res) => {
    let b = '';
    req.on('data', (c) => { b += c; });
    req.on('end', () => {
      hits.push({ method: req.method, url: req.url, body: b });
      res.statusCode = /\/heartbeat\/(app|bak)Token/.test(req.url) ? 200 : 404;
      res.end('OK');
    });
  }).listen(0);
  await new Promise((r) => setTimeout(r, 30));
  hb = (t) => `http://127.0.0.1:${fake.address().port}/api/v1/heartbeat/${t}`;
  srv = await startServer({ ADMIN_EMAILS: 'owner@mon.test' });
  api = srv.api;
  ADMIN = (await register(api, 'owner@mon.test')).token;
  const link = srv.log().match(/To: owner@mon\.test[\s\S]*?\/verify\?token=([a-f0-9.]+)/);
  await api('/auth/verify', 'POST', { token: link[1] });
  ADMIN = (await enable2fa(api, ADMIN)).token;
});
after(async () => { await srv?.stop(); fake?.close(); });
const put = (monitor) => api('/admin/settings', 'PUT', { monitor }, ADMIN);
const waitFor = async (fn, ms = 5000) => { const end = Date.now() + ms; while (Date.now() < end) { if (fn()) return true; await new Promise((r) => setTimeout(r, 50)); } return false; };

test('Better Stack heartbeats: checked with a ping, stored encrypted, never shown back', async () => {
  assert.deepEqual((await api('/admin/settings', 'GET', null, ADMIN)).data.monitor.app, { set: false, fromEnv: false, last: null });
  assert.match((await put({ app: 'https://example.com/ping' })).data.error, /heartbeat URL from Better Stack/);
  assert.match((await put({ app: hb('wrongToken123') })).data.error, /didn’t accept the heartbeat \(HTTP 404\)/);
  const ok = await put({ app: hb('appToken12345') });
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  assert.equal(ok.data.monitor.app.set, true);
  assert.deepEqual([ok.data.monitor.app.last.ok, ok.data.monitor.app.last.sent], [true, true]);
  assert.ok(!JSON.stringify(ok.data).includes('appToken12345'), 'the URL (a secret) is never sent back');
  assert.deepEqual(hits.at(-1), { method: 'GET', url: '/api/v1/heartbeat/appToken12345', body: '' });
});

test('the backup heartbeat fails, with the reason, while no copy leaves this server', async () => {
  const ok = await put({ backup: hb('bakToken12345') });
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  assert.ok(await waitFor(() => hits.some((h) => h.url === '/api/v1/heartbeat/bakToken12345/fail')), JSON.stringify(hits));
  const fail = hits.find((h) => h.url === '/api/v1/heartbeat/bakToken12345/fail');
  assert.equal(fail.method, 'POST');
  assert.match(fail.body, /No storage bucket connected/);
  const m = (await api('/admin/settings', 'GET', null, ADMIN)).data.monitor;
  assert.deepEqual([m.backup.set, m.backup.last.ok], [true, false]);
  // removing it
  assert.equal((await put({ backup: '' })).data.monitor.backup.set, false);
});

test('the recovery key: shown only on purpose, audited, and its saving remembered', async () => {
  assert.equal((await api('/admin/recovery-key', 'POST', {}, ADMIN)).status, 400);
  const r = await api('/admin/recovery-key', 'POST', { confirm: 'SHOW' }, ADMIN);
  assert.equal(r.status, 200);
  assert.equal(r.data.key, 'test-secret', 'the one secret that opens the backups and the keys stored in them');
  assert.equal(r.data.env, 'ENCRYPTION_KEY');
  const seller = (await register(api, 'seller@mon.test')).token;
  assert.equal((await api('/admin/recovery-key', 'POST', { confirm: 'SHOW' }, seller)).status, 403, 'sellers never get it');
  assert.equal((await api('/admin/settings', 'GET', null, ADMIN)).data.monitor.recoveryKeySavedAt, 0);
  assert.equal((await api('/admin/recovery-key', 'POST', { saved: true }, ADMIN)).status, 200);
  assert.ok((await api('/admin/settings', 'GET', null, ADMIN)).data.monitor.recoveryKeySavedAt > 0);
  const auditLog = JSON.stringify((await api('/admin/audit', 'GET', null, ADMIN)).data);
  assert.match(auditLog, /recovery key shown/);
  assert.match(auditLog, /recovery key saved/);
});
