// Admin → Email sending: a Mailercloud (or Resend) key and sender saved from the admin panel (checked with a real
// test email, stored encrypted, never shown back), then used for platform emails and for sellers' emails under their
// own name.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startServer, register, enable2fa } from './helpers.mjs';

let fake, srv, api, ADMIN;
const sent = [], mc = [];
before(async () => {
  fake = http.createServer((req, res) => {
    let b = '';
    req.on('data', (c) => { b += c; });
    req.on('end', () => {
      const auth = req.headers.authorization;
      res.setHeader('content-type', 'application/json');
      // Mailercloud: POST /email, the key as it is in Authorization, { email, version, metadata }
      if (req.url === '/email') {
        if (auth !== 'mc_good_key_1234567890') { res.statusCode = 401; return res.end(JSON.stringify({ status: 'FAILURE', message: 'Invalid API key' })); }
        const body = JSON.parse(b);
        if (body.email.from !== 'no-reply@theaihive.tech' && body.email.from !== 'hello@theaihive.tech') { res.statusCode = 400; return res.end(JSON.stringify({ status: 'FAILURE', statusCode: 9001, message: 'Sender is not verified' })); }
        mc.push(body);
        return res.end(JSON.stringify({ status: 'SUCCESS', statusCode: 1000, message: 'NA' }));
      }
      if (auth !== 'Bearer re_good_key_123') { res.statusCode = 401; return res.end(JSON.stringify({ message: 'API key is invalid' })); }
      const body = JSON.parse(b);
      if (!/theaihive\.tech>?$/.test(body.from)) { res.statusCode = 403; return res.end(JSON.stringify({ message: 'The domain is not verified' })); }
      sent.push(body);
      res.end(JSON.stringify({ id: `em_${sent.length}` }));
    });
  }).listen(0);
  await new Promise((r) => setTimeout(r, 30));
  const base = `http://127.0.0.1:${fake.address().port}`;
  srv = await startServer({ RESEND_BASE_URL: base, MAILERCLOUD_BASE_URL: base, ADMIN_EMAILS: 'owner@mail.test' });
  api = srv.api;
  ADMIN = (await register(api, 'owner@mail.test')).token;
  const link = srv.log().match(/To: owner@mail\.test[\s\S]*?\/verify\?token=([a-f0-9.]+)/);
  await api('/auth/verify', 'POST', { token: link[1] });
  ADMIN = (await enable2fa(api, ADMIN)).token;
});
after(async () => { await srv?.stop(); fake?.close(); });
const put = (mail) => api('/admin/settings', 'PUT', { mail }, ADMIN);

test('Mailercloud: validated with a test email, stored encrypted, then used for platform and seller emails', async () => {
  const g = await api('/admin/settings', 'GET', null, ADMIN);
  assert.equal(g.status, 200, JSON.stringify(g.data).slice(0, 200));
  assert.deepEqual([g.data.mail.ready, g.data.mail.provider], [false, 'mailercloud'], 'Mailercloud is the default');
  assert.equal((await put({ provider: 'mailercloud', from: 'not an email', key: 'mc_good_key_1234567890' })).status, 400);
  assert.match((await put({ provider: 'mailercloud', from: 'FunnelHive <no-reply@theaihive.tech>', key: 'short' })).data.error, /Mailercloud API key/);
  assert.match((await put({ provider: 'mailercloud', from: 'FunnelHive <no-reply@theaihive.tech>', key: 'mc_bad_key_0000000000' })).data.error, /Mailercloud refused: Invalid API key/);
  assert.match((await put({ provider: 'mailercloud', from: 'FunnelHive <no-reply@gmail.com>', key: 'mc_good_key_1234567890' })).data.error, /not verified/);
  const ok = await put({ provider: 'mailercloud', from: 'FunnelHive <no-reply@theaihive.tech>', key: 'mc_good_key_1234567890' });
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  assert.deepEqual([ok.data.mail.ready, ok.data.mail.hasKey, ok.data.mail.provider, ok.data.mail.from], [true, true, 'mailercloud', 'FunnelHive <no-reply@theaihive.tech>']);
  assert.ok(!JSON.stringify(ok.data).includes('mc_good_key_1234567890'), 'the key is never sent back');
  const test1 = mc.at(-1);
  assert.deepEqual([test1.version, test1.email.from, test1.email.fromName, test1.email.recipients.to, test1.metadata.campaignType], ['1.0', 'no-reply@theaihive.tech', 'FunnelHive', [{ email: 'owner@mail.test' }], 'TRANSACTIONAL']);
  assert.ok(test1.metadata.messageId && test1.email.html && test1.email.text);

  // a platform email (password reset) now goes out through Mailercloud
  const n = mc.length;
  await register(api, 'seller@mail.test');
  await api('/auth/forgot', 'POST', { email: 'seller@mail.test' });
  await new Promise((r) => setTimeout(r, 200));
  assert.ok(mc.slice(n).some((m) => m.email.recipients.to[0].email === 'seller@mail.test' && m.email.from === 'no-reply@theaihive.tech'), JSON.stringify(mc.slice(n).map((m) => m.email.subject)));
  assert.ok(mc.slice(n).every((m) => !m.email.replyTo), 'no unverified reply-to is sent to Mailercloud');

  // changing only the sender keeps the saved key
  assert.equal((await put({ from: 'Hive <hello@theaihive.tech>' })).status, 200);
  const g2 = (await api('/admin/settings', 'GET', null, ADMIN)).data.mail;
  assert.deepEqual([g2.from, g2.provider], ['Hive <hello@theaihive.tech>', 'mailercloud']);
  // switching provider needs that provider's key — the Mailercloud key is never sent to Resend
  assert.match((await put({ provider: 'resend' })).data.error, /Resend API key/);
  assert.equal((await put({ clear: true })).data.mail.hasKey, false);
});

test('Mailercloud refusing our unsubscribe headers: the email still goes, once, without them', async () => {
  const hits = [];
  const strict = http.createServer((req, res) => {
    let b = '';
    req.on('data', (c) => { b += c; });
    req.on('end', () => {
      const body = JSON.parse(b);
      hits.push(body);
      res.setHeader('content-type', 'application/json');
      if (body.email.headers) { res.statusCode = 400; return res.end(JSON.stringify({ status: 'FAILURE', message: 'Header List-Unsubscribe is not allowed' })); }
      res.end(JSON.stringify({ status: 'SUCCESS', statusCode: 1000 }));
    });
  }).listen(0);
  await new Promise((r) => setTimeout(r, 30));
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ff-mc-'));
  process.env.MAILERCLOUD_BASE_URL = `http://127.0.0.1:${strict.address().port}`;
  try {
    const { mailercloudSend } = await import('../messaging.js');
    const r = await mailercloudSend('mc_key_1234567890abcdef', { from: '"Asha Yoga" <no-reply@theaihive.tech>', to: 'buyer@mail.test', subject: 'Diwali offer', text: 'Hi\n\nUnsubscribe: https://x/u', html: '<p>Hi</p>', headers: { 'List-Unsubscribe': '<https://x/u>' }, promotional: true });
    assert.ok(r.id);
    assert.equal(hits.length, 2);
    assert.deepEqual([hits[1].email.fromName, hits[1].metadata.campaignType, hits[1].metadata.messageId], ['Asha Yoga', 'PROMOTIONAL', hits[0].metadata.messageId], 'the retry reuses the message id, so it can never arrive twice');
  } finally { strict.close(); delete process.env.MAILERCLOUD_BASE_URL; }
});

test('Resend still works for set-ups from before Mailercloud', async () => {
  const bad = await put({ provider: 'resend', from: 'FunnelHive <no-reply@theaihive.tech>', key: 're_bad_key_999' });
  assert.match(bad.data.error, /Resend refused: API key is invalid/);
  assert.match((await put({ provider: 'resend', from: 'FunnelHive <no-reply@gmail.com>', key: 're_good_key_123' })).data.error, /not verified/);
  const ok = await put({ provider: 'resend', from: 'FunnelHive <no-reply@theaihive.tech>', key: 're_good_key_123' });
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  assert.deepEqual([ok.data.mail.ready, ok.data.mail.provider], [true, 'resend']);
  assert.equal(sent.at(-1).to, 'owner@mail.test');
  const n = sent.length;
  await api('/auth/forgot', 'POST', { email: 'seller@mail.test' });
  await new Promise((r) => setTimeout(r, 200));
  assert.ok(sent.slice(n).some((m) => m.to === 'seller@mail.test' && m.from === 'FunnelHive <no-reply@theaihive.tech>'));
  const s = (await put({ clear: true })).data;
  assert.deepEqual([s.mail.ready, s.mail.hasKey], [false, false]);
});
