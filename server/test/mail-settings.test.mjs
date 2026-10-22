// Admin → Email sending: a Resend key and sender saved from the admin panel (checked with a real test email,
// stored encrypted, never shown back), then used for platform emails and for sellers' emails under their own name.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { startServer, register, enable2fa } from './helpers.mjs';

let fake, srv, api, ADMIN;
const sent = [];
before(async () => {
  fake = http.createServer((req, res) => {
    let b = '';
    req.on('data', (c) => { b += c; });
    req.on('end', () => {
      const auth = req.headers.authorization;
      res.setHeader('content-type', 'application/json');
      if (auth !== 'Bearer re_good_key_123') { res.statusCode = 401; return res.end(JSON.stringify({ message: 'API key is invalid' })); }
      const body = JSON.parse(b);
      if (!/theaihive\.tech>?$/.test(body.from)) { res.statusCode = 403; return res.end(JSON.stringify({ message: 'The domain is not verified' })); }
      sent.push(body);
      res.end(JSON.stringify({ id: `em_${sent.length}` }));
    });
  }).listen(0);
  await new Promise((r) => setTimeout(r, 30));
  srv = await startServer({ RESEND_BASE_URL: `http://127.0.0.1:${fake.address().port}`, ADMIN_EMAILS: 'owner@mail.test' });
  api = srv.api;
  ADMIN = (await register(api, 'owner@mail.test')).token;
  const link = srv.log().match(/To: owner@mail\.test[\s\S]*?\/verify\?token=([a-f0-9.]+)/);
  await api('/auth/verify', 'POST', { token: link[1] });
  ADMIN = (await enable2fa(api, ADMIN)).token;
});
after(async () => { await srv?.stop(); fake?.close(); });

test('email sending: validated with a test email, stored encrypted, then used for platform and seller emails', async () => {
  const g = await api('/admin/settings', 'GET', null, ADMIN);
  assert.equal(g.status, 200, JSON.stringify(g.data).slice(0, 200));
  let s = g.data;
  assert.equal(s.mail.ready, false);
  const put = (mail) => api('/admin/settings', 'PUT', { mail }, ADMIN);
  assert.equal((await put({ from: 'not an email', key: 're_good_key_123' })).status, 400);
  assert.equal((await put({ from: 'FunnelHive <no-reply@theaihive.tech>', key: 'sk_wrong' })).status, 400, 'must look like a Resend key');
  const bad = await put({ from: 'FunnelHive <no-reply@theaihive.tech>', key: 're_bad_key_999' });
  assert.match(bad.data.error, /Resend refused: API key is invalid/);
  assert.match((await put({ from: 'FunnelHive <no-reply@gmail.com>', key: 're_good_key_123' })).data.error, /not verified/);
  const ok = await put({ from: 'FunnelHive <no-reply@theaihive.tech>', key: 're_good_key_123' });
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  assert.deepEqual([ok.data.mail.ready, ok.data.mail.hasKey, ok.data.mail.from], [true, true, 'FunnelHive <no-reply@theaihive.tech>']);
  assert.ok(!JSON.stringify(ok.data).includes('re_good_key_123'), 'the key is never sent back');
  assert.equal(sent.at(-1).to, 'owner@mail.test');

  // a platform email (password reset) now goes out through Resend
  const n = sent.length;
  await register(api, 'seller@mail.test');
  await api('/auth/forgot', 'POST', { email: 'seller@mail.test' });
  await new Promise((r) => setTimeout(r, 200));
  assert.ok(sent.slice(n).some((m) => m.to === 'seller@mail.test' && m.from === 'FunnelHive <no-reply@theaihive.tech>'), JSON.stringify(sent.slice(n).map((m) => [m.to, m.subject])));

  // changing only the sender keeps the saved key
  assert.equal((await put({ from: 'Hive <hello@theaihive.tech>' })).status, 200);
  assert.equal((await api('/admin/settings', 'GET', null, ADMIN)).data.mail.from, 'Hive <hello@theaihive.tech>');
  // disconnect
  s = (await put({ clear: true })).data;
  assert.deepEqual([s.mail.ready, s.mail.hasKey], [false, false]);
});
