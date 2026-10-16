import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { startServer, register } from './helpers.mjs';
import { totp } from '../security.js';

let srv, api, dev;
// Production-like limits, no JWT_SECRET → the server must generate its own. Links in emails are only printed to
// the log outside production, so the link tests use a second (test-mode) server.
before(async () => { srv = await startServer({ NODE_ENV: 'production', JWT_SECRET: '' }); api = srv.api; dev = await startServer(); });
after(async () => { await srv.stop(); await dev.stop(); });

test('no JWT_SECRET: a random secret is generated and persisted (no "dev-secret" default)', async () => {
  const f = path.join(srv.dataDir, '.jwt-secret');
  assert.ok(fs.existsSync(f));
  assert.ok(fs.readFileSync(f, 'utf8').length >= 64);
  const { token } = await register(api);
  assert.equal((await api('/me', 'GET', null, token)).status, 200);
});

test('security headers are set and CORS does not allow foreign origins', async () => {
  const r = await fetch(`${srv.base}/api/templates`, { headers: { Origin: 'https://evil.example' } });
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(r.headers.get('x-powered-by'), null);
  assert.equal(r.headers.get('access-control-allow-origin'), null);
});

test('production: no sign-in or reset links in the logs while email is off', async () => {
  const email = `prodlog${Date.now()}@test.dev`;
  await register(api, email);
  await api('/auth/forgot', 'POST', { email });
  await new Promise((r) => setTimeout(r, 200));
  assert.ok(!/verify\?token=|reset\?token=/.test(srv.log()), 'no tokens printed');
  assert.match(srv.log(), /email not configured — .*Reset link/);
});

test('email verification link works', async () => {
  const { api, log } = dev;
  const email = `verify${Date.now()}@test.dev`;
  const { token } = await register(api, email);
  assert.equal((await api('/me', 'GET', null, token)).data.emailVerified, false);
  await new Promise((r) => setTimeout(r, 200));
  const link = log().match(new RegExp(`To: ${email}[\\s\\S]*?/verify\\?token=([a-f0-9.]+)`));
  assert.ok(link, 'verification link printed to console');
  assert.equal((await api('/auth/verify', 'POST', { token: link[1] })).status, 200);
  assert.equal((await api('/me', 'GET', null, token)).data.emailVerified, true);
  // opened again (a second click, or an email app's link scanner): nothing to do, and no scary "invalid link"
  const again = await api('/auth/verify', 'POST', { token: link[1] });
  assert.deepEqual([again.status, again.data.already], [200, true]);
  assert.equal((await api('/auth/verify', 'POST', { token: 'nothexadecimal.abc' })).status, 400, 'a made-up link is still refused');
});

test('password reset: link resets password and signs out old sessions', async () => {
  const { api, log } = dev;
  const email = `reset${Date.now()}@test.dev`;
  const { token: old } = await register(api, email);
  assert.equal((await api('/auth/forgot', 'POST', { email: 'nobody@test.dev' })).status, 200, 'no account enumeration');
  await api('/auth/forgot', 'POST', { email });
  await new Promise((r) => setTimeout(r, 200));
  const t = log().match(new RegExp(`To: ${email}[\\s\\S]*?/reset\\?token=([a-f0-9.]+)`))[1];
  const r = await api('/auth/reset', 'POST', { token: t, password: 'newpass456' });
  assert.equal(r.status, 200);
  assert.equal((await api('/me', 'GET', null, old)).status, 401, 'old session revoked');
  assert.equal((await api('/me', 'GET', null, r.data.token)).status, 200);
  assert.equal((await api('/auth/login', 'POST', { email, password: 'newpass456' })).status, 200);
  assert.equal((await api('/auth/reset', 'POST', { token: t, password: 'again789' })).status, 400, 'reset link single-use');
});

test('2-step verification (TOTP)', async () => {
  const email = `tfa${Date.now()}@test.dev`;
  const { token } = await register(api, email);
  const { secret } = (await api('/auth/2fa/setup', 'POST', {}, token)).data;
  assert.equal((await api('/auth/2fa/enable', 'POST', { code: '000000' }, token)).status, 400);
  assert.equal((await api('/auth/2fa/enable', 'POST', { code: totp(secret, Date.now() - 30000) }, token)).status, 200);
  const step1 = await api('/auth/login', 'POST', { email, password: 'secret123' });
  assert.equal(step1.data.twoFactorRequired, true);
  assert.ok(!step1.data.token);
  assert.equal((await api('/auth/login', 'POST', { email, password: 'secret123', code: '123456' })).status, 401);
  const ok = await api('/auth/login', 'POST', { email, password: 'secret123', code: totp(secret) });
  assert.ok(ok.data.token);
});

test('rate limiting kicks in on repeated failed logins', async () => {
  let last;
  for (let i = 0; i < 25; i++) last = await api('/auth/login', 'POST', { email: 'x@y.dev', password: 'wrong' });
  assert.equal(last.status, 429);
});
