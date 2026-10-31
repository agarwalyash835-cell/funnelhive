// White-label (whitelabel.js): an agency's app domain gets its brand and an HTTPS certificate only after DNS proves
// it's theirs; on that domain the app never shows the platform's company, GSTIN, prices or admin screens; the
// agency's clients get verify / reset / invite emails in the agency's brand with links on its domain, from the
// agency's own address once that's verified (else the platform's address under the agency's name); the
// authenticator app and the installable app carry the agency's name.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startServer, register } from './helpers.mjs';

const HOST = 'app.growth.in';
let fake, srv, api, A, other, client, down;
const sent = [];
const resend = { status: 'pending', rejectFrom: null };
before(async () => {
  // a fake Resend: sends (/emails) and sending domains (/domains)
  fake = http.createServer((req, res) => {
    let b = '';
    req.on('data', (c) => { b += c; });
    req.on('end', () => {
      res.setHeader('content-type', 'application/json');
      if (req.headers.authorization !== 'Bearer re_test_key') { res.statusCode = 401; return res.end('{"message":"bad key"}'); }
      if (req.url === '/emails') {
        const body = JSON.parse(b);
        if (resend.rejectFrom && body.from.includes(resend.rejectFrom)) { res.statusCode = 403; return res.end('{"message":"The domain is not verified"}'); }
        sent.push(body);
        return res.end(JSON.stringify({ id: `em_${sent.length}` }));
      }
      const records = [{ record: 'SPF', name: 'send', type: 'MX', value: 'feedback-smtp.example.com', priority: 10 }, { record: 'SPF', name: 'send', type: 'TXT', value: 'v=spf1 include:amazonses.com ~all' }, { record: 'DKIM', name: 'resend._domainkey', type: 'TXT', value: 'p=MIGfMA0' }];
      if (req.method === 'POST' && req.url === '/domains') return res.end(JSON.stringify({ id: 'dom_1', name: JSON.parse(b).name, status: 'not_started', records }));
      if (req.method === 'POST' && req.url === '/domains/dom_1/verify') return res.end('{"object":"domain","id":"dom_1"}');
      if (req.method === 'GET' && req.url === '/domains/dom_1') return res.end(JSON.stringify({ id: 'dom_1', status: resend.status, records }));
      res.statusCode = 404; res.end('{}');
    });
  }).listen(0);
  await new Promise((r) => setTimeout(r, 30));
  // DNS answers are faked: every domain resolves, except those listed in this file
  down = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ff-wl-')), 'down.txt');
  fs.writeFileSync(down, HOST);
  srv = await startServer({ APP_URL: 'https://app.example.in', DOMAINS_FAKE_DNS: '1', DOMAINS_FAKE_DOWN: down, RESEND_API_KEY: 're_test_key', RESEND_BASE_URL: `http://127.0.0.1:${fake.address().port}`, WHITE_LABEL_SENDER: 'resend', MAIL_FROM: 'Platform <no-reply@platform.test>' });
  api = srv.api;
  A = (await register(api)).token;
  other = (await register(api)).token;
  client = (await api('/agency/clients', 'POST', { business: 'Sharma Yoga' }, A)).data;
});
after(async () => { await srv?.stop(); fake?.close(); });

const site = (host) => fetch(`${srv.base}/api/site`, { headers: host ? { 'x-forwarded-host': host } : {} }).then((r) => r.json());
const get = (p, host) => fetch(`${srv.base}${p}`, { redirect: 'manual', headers: host ? { 'x-forwarded-host': host } : {} });
const lastTo = (to) => sent.filter((m) => m.to === to || (Array.isArray(m.to) && m.to.includes(to))).at(-1);

test('an unverified agency domain gets no branding and no certificate; DNS proof turns both on', async () => {
  const bad = await api('/agency/white-label', 'PUT', { brand: 'GrowthOS', domain: HOST, termsUrl: 'http://x.in/terms' }, A);
  assert.equal(bad.status, 400, 'policy links must be https');
  const r = await api('/agency/white-label', 'PUT', { brand: 'GrowthOS', primary: '#ff5500', supportEmail: 'help@growth.in', domain: HOST, legalName: 'Growth Agency Pvt Ltd', address: 'Andheri, Mumbai', supportPhone: '+91 98765 43210', termsUrl: 'https://growth.in/terms', privacyUrl: 'https://growth.in/privacy' }, A);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.domainProof.status, 'pending');
  const recs = r.data.domainProof.records;
  assert.ok(recs.some((x) => x.type === 'TXT' && x.name === `_funnelhive.${HOST}` && /^ff-verify=[0-9a-f]+$/.test(x.value)), 'TXT record to prove it');
  assert.ok(recs.some((x) => x.type === 'CNAME' && x.name === HOST && x.value === 'app.example.in'), 'CNAME to this server');

  // unproven: the platform's own page, no brand, no certificate
  const s0 = await site(HOST);
  assert.equal(s0.whiteLabel, undefined);
  assert.notEqual(s0.brand, 'GrowthOS');
  assert.equal((await get(`/api/domains/tls-check?domain=${HOST}`)).status, 404);
  assert.notEqual((await api('/me', 'GET', null, A)).data.whiteLabel.domain, HOST, 'not reported as their domain yet');
  // emails still carry the agency's name, but links go to the platform's address until the domain is proven
  const early = `early${Date.now()}@sharma.test`;
  await api(`/agency/clients/${client.id}/invite`, 'POST', { email: early }, A);
  assert.match(lastTo(early).text, /https:\/\/app\.example\.in\/reset\?token=/);
  assert.match(lastTo(early).subject, /GrowthOS/);
  // the DNS records aren't there yet
  let st = (await api('/agency/white-label/verify', 'POST', {}, A)).data;
  assert.equal(st.domain.status, 'pending');
  assert.match(st.domain.error, /record/);
  // an unproven claim doesn't block someone else (the real owner) from claiming the domain
  assert.equal((await api('/agency/white-label', 'PUT', { brand: 'Squatter', domain: HOST }, other)).status, 200);

  // the records show up: verified
  fs.writeFileSync(down, '');
  st = (await api('/agency/white-label/verify', 'POST', {}, A)).data;
  assert.equal(st.domain.status, 'active');
  assert.equal((await get(`/api/domains/tls-check?domain=${HOST}`)).status, 200, 'HTTPS certificate allowed');
  const s1 = await site(HOST);
  assert.equal(s1.brand, 'GrowthOS');
  assert.equal(s1.whiteLabel.brand, 'GrowthOS');
  // the losing claim is dropped, and the domain can't be claimed again
  const o = (await api('/agency', 'GET', null, other)).data;
  assert.equal(o.whiteLabel.domain, '');
  assert.equal((await api('/agency/white-label', 'PUT', { brand: 'Squatter', domain: HOST }, other)).status, 409);
});

test('on the agency’s domain: no platform company, GSTIN or prices; its own legal details; no admin or pricing pages', async () => {
  const s = await site(HOST);
  assert.equal(s.agencyHost, true);
  for (const k of ['prices', 'trialDays', 'aiCredits', 'gstRegistered']) assert.ok(!(k in s), `no ${k}`);
  assert.ok(!/gstin/i.test(JSON.stringify(s)), 'no GSTIN');
  assert.equal(s.googleClientId, null, 'Google’s sign-in screen would show the platform’s app name');
  assert.deepEqual([s.company.name, s.company.address, s.company.email, s.company.phone, s.company.termsUrl], ['Growth Agency Pvt Ltd', 'Andheri, Mumbai', 'help@growth.in', '+91 98765 43210', 'https://growth.in/terms']);
  // the platform's own domain is unchanged
  const p = await site();
  assert.ok(p.prices && 'gstRegistered' in p);
  assert.equal(p.agencyHost, undefined);
  // pages
  const loc = async (u) => { const r = await get(u, HOST); return [r.status, r.headers.get('location')]; };
  assert.deepEqual(await loc('/admin'), [302, '/']);
  assert.deepEqual(await loc('/admin/invoices/x'), [302, '/']);
  assert.deepEqual(await loc('/pricing'), [302, '/login']);
  assert.deepEqual(await loc('/terms'), [302, 'https://growth.in/terms']);
  assert.deepEqual(await loc('/privacy'), [302, 'https://growth.in/privacy']);
  assert.notEqual((await get('/pricing')).status, 302, 'the platform’s pricing page stays');
});

test('the installable app: a manifest and icon per host', async () => {
  const m = await (await get('/manifest.webmanifest', HOST)).json();
  assert.deepEqual([m.name, m.theme_color, m.start_url], ['GrowthOS', '#ff5500', '/']);
  const c = await (await get('/counter.webmanifest', HOST)).json();
  assert.deepEqual([c.name, c.start_url, c.scope], ['GrowthOS Counter', '/counter', '/counter']);
  const p = await (await get('/manifest.webmanifest')).json();
  assert.notEqual(p.name, 'GrowthOS');
  // the app's page: the brand in the title, its manifest, and the agency marker the app reads first
  const page = await (await get('/login', HOST)).text();
  if (!/not built/.test(page)) {
    assert.match(page, /<title>GrowthOS<\/title>/);
    assert.match(page, /<link rel="manifest" href="\/manifest\.webmanifest">/);
    assert.match(page, /<meta name="ff-agency" content="[^"]*GrowthOS/);
    const plain = await (await get('/login')).text();
    assert.ok(!plain.includes('ff-agency') && !plain.includes('<title>GrowthOS'));
  }
  const icon = await (await get('/brand-icon.svg', HOST)).text();
  assert.match(icon, /#ff5500/);
  assert.match(icon, />G</);
});

test('emails to the agency’s client: its brand and domain links, from the platform address under its name until its sender is verified', async () => {
  const email = `client${Date.now()}@sharma.test`;
  const inv = await api(`/agency/clients/${client.id}/invite`, 'POST', { email }, A);
  assert.equal(inv.status, 200);
  let m = lastTo(email);
  assert.match(m.subject, /GrowthOS/);
  assert.ok(!/FunnelHive/.test(m.subject + m.text), 'no platform name');
  assert.ok(m.text.includes(`https://${HOST}/reset?token=${inv.data.token}`), 'link on the agency’s domain');
  assert.equal(m.from, '"GrowthOS" <no-reply@platform.test>', 'platform address, agency name');
  assert.equal(m.reply_to, 'help@growth.in');
  assert.match(m.html, /#ff5500/);
  // the client sets a password from the invite
  assert.equal((await api('/auth/reset', 'POST', { token: inv.data.token, password: 'client-pass-123' })).status, 200);
  const C = (await api('/auth/login', 'POST', { email, password: 'client-pass-123' })).data.token;
  assert.ok(C);
  // reset (forgot password)
  await api('/auth/forgot', 'POST', { email });
  m = lastTo(email);
  assert.equal(m.subject, 'Reset your GrowthOS password');
  assert.match(m.text, new RegExp(`https://${HOST.replace(/\./g, '\\.')}/reset\\?token=`));
  // the email-verification link: a sign-up made on the agency's domain
  const fresh = `new${Date.now()}@sharma.test`;
  assert.equal((await api('/auth/register', 'POST', { email: fresh, password: 'secret12345', name: 'New' }, null, { 'x-forwarded-host': HOST })).status, 200);
  await new Promise((r) => setTimeout(r, 200)); // sent after the answer
  m = lastTo(fresh);
  assert.equal(m.subject, 'Verify your GrowthOS email');
  assert.match(m.text, new RegExp(`https://${HOST.replace(/\./g, '\\.')}/verify\\?token=`));
  // a team invitation from inside the client's account
  const mate = `mate${Date.now()}@sharma.test`;
  assert.equal((await api('/team/invite', 'POST', { email: mate, role: 'viewer' }, C)).status, 200);
  m = lastTo(mate);
  assert.match(m.subject, /on GrowthOS$/);
  assert.match(m.text, new RegExp(`https://${HOST.replace(/\./g, '\\.')}/team/accept\\?token=`));
  // the authenticator app shows the agency's brand
  const otp = (await api('/auth/2fa/setup', 'POST', {}, C)).data.otpauth;
  assert.match(otp, /^otpauth:\/\/totp\/GrowthOS:/);
  assert.match(otp, /issuer=GrowthOS&/);
  // a platform user: the platform's brand everywhere
  const P = (await register(api)).token;
  assert.match((await api('/auth/2fa/setup', 'POST', {}, P)).data.otpauth, /issuer=FunnelHive&/);
});

test('the agency’s own sender: on its verified domain, SPF/DKIM records to copy, used once verified, platform address as fallback', async () => {
  assert.equal((await api('/agency/white-label/sender', 'PUT', { address: 'hello@gmail.com' }, A)).status, 400, 'must be on the agency’s domain');
  let s = (await api('/agency/white-label/sender', 'PUT', { address: 'hello@growth.in' }, A)).data.sender;
  assert.deepEqual([s.mode, s.address, s.status], ['resend', 'hello@growth.in', 'pending']);
  assert.ok(s.records.some((r) => r.why.startsWith('DKIM') && r.name === 'resend._domainkey.growth.in'));
  assert.ok(s.records.some((r) => r.type === 'TXT' && /spf1/.test(r.value)));
  const email = `c2${Date.now()}@sharma.test`;
  const c2 = (await api('/agency/clients', 'POST', { business: 'Mehta Bakes' }, A)).data;
  await api(`/agency/clients/${c2.id}/invite`, 'POST', { email }, A);
  assert.equal(lastTo(email).from, '"GrowthOS" <no-reply@platform.test>', 'not verified yet: platform address');
  // the provider sees the records
  resend.status = 'verified';
  s = (await api('/agency/white-label/verify', 'POST', {}, A)).data.sender;
  assert.equal(s.status, 'verified');
  await api('/auth/forgot', 'POST', { email });
  assert.equal(lastTo(email).from, '"GrowthOS" <hello@growth.in>', 'the agency’s own address');
  // sending from it fails: the email still goes, from the platform address
  resend.rejectFrom = 'hello@growth.in';
  await api('/auth/forgot', 'POST', { email });
  const m = lastTo(email);
  assert.equal(m.from, '"GrowthOS" <no-reply@platform.test>');
  assert.equal(m.subject, 'Reset your GrowthOS password');
  resend.rejectFrom = null;
  // a platform user's emails are untouched
  const pe = `p${Date.now()}@plain.test`;
  await register(api, pe);
  assert.equal(lastTo(pe).from, 'Platform <no-reply@platform.test>');
  assert.match(lastTo(pe).subject, /FunnelHive/);
});
