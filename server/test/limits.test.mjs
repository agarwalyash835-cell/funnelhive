// Fair-use limits and sign-up protection: the honeypot, throwaway inboxes, Cloudflare Turnstile (a local fake), a
// per-network daily cap on new accounts; funnel and image-storage limits set by the admin, raised per seller.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { startServer } from './helpers.mjs';

const body = (req) => new Promise((r) => { let b = ''; req.on('data', (c) => { b += c; }); req.on('end', () => r(b)); });
const PNG = `data:image/png;base64,${Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...Array(200).fill(0)]).toString('base64')}`;
let ts, srv, api, admin;
before(async () => {
  ts = http.createServer(async (req, res) => { const p = new URLSearchParams(await body(req)); res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ success: p.get('secret') === 'ts_secret' && p.get('response') === 'good-token' })); }).listen(0);
  await new Promise((r) => setTimeout(r, 30));
  srv = await startServer({ TURNSTILE_SITE_KEY: '0xSiteKey', TURNSTILE_SECRET_KEY: 'ts_secret', TURNSTILE_VERIFY_URL: `http://127.0.0.1:${ts.address().port}/verify`, SIGNUPS_PER_IP_DAY: '4', ADMIN_EMAILS: 'owner@limits.test' });
  api = srv.api;
});
after(async () => { await srv.stop(); ts.close(); });
const signup = (email, extra = {}) => api('/auth/register', 'POST', { email, password: 'secret123', name: 'Tester', turnstile: 'good-token', ...extra });

let seller, sellerId;
test('sign-ups: Turnstile checked, honeypot and throwaway inboxes refused, a daily cap per network', async () => {
  assert.equal((await api('/site')).data.turnstileSiteKey, '0xSiteKey');
  assert.equal((await signup('a@real.dev', { turnstile: '' })).status, 400, 'no Turnstile token');
  assert.equal((await signup('a@real.dev', { turnstile: 'forged' })).status, 400, 'Turnstile says no');
  assert.equal((await signup('a@real.dev', { website: 'http://spam.example' })).status, 400, 'honeypot filled');
  assert.equal((await signup('a@mailinator.com')).status, 400, 'throwaway inbox');
  admin = (await signup('owner@limits.test')).data.token;
  await new Promise((r) => setTimeout(r, 200));
  const link = srv.log().match(/To: owner@limits\.test[\s\S]*?\/verify\?token=([a-f0-9.]+)/);
  await api('/auth/verify', 'POST', { token: link[1] });
  const s = await signup('coach@real.dev');
  assert.equal(s.status, 200);
  seller = s.data.token;
  sellerId = (await api('/me', 'GET', null, seller)).data.id;
  assert.equal((await signup('two@real.dev')).status, 200);
  assert.equal((await signup('three@real.dev')).status, 200);
  assert.equal((await signup('five@real.dev')).status, 429, 'the fifth new account from one network today');
  assert.equal((await api('/auth/login', 'POST', { email: 'coach@real.dev', password: 'secret123' })).status, 200, 'logging in is not affected');
});

test('funnel and image limits: trial defaults from the admin, raised for one seller', async () => {
  const have = (await api('/funnels', 'GET', null, seller)).data.length;
  const set = await api('/admin/settings', 'PUT', { limits: { funnelsTrial: have + 1, storageMBTrial: 0 } }, admin);
  assert.equal(set.status, 200);
  assert.equal(set.data.limits.funnelsTrial, have + 1);
  assert.equal((await api('/funnels', 'POST', { name: 'One more' }, seller)).status, 200);
  const no = await api('/funnels', 'POST', { name: 'Too many' }, seller);
  assert.deepEqual([no.status, no.data.limit], [403, 'funnels']);
  assert.equal((await api('/templates/coding/use', 'POST', {}, seller)).status, 403, 'templates count too');
  const up = await api('/uploads', 'POST', { type: 'image/png', data: PNG }, seller);
  assert.deepEqual([up.status, up.data.limit], [413, 'storage']);
  // the admin raises this seller's limits
  assert.equal((await api(`/admin/users/${sellerId}/action`, 'POST', { action: 'set_limits', funnels: 50, storageMB: 10 }, admin)).status, 200);
  assert.equal((await api('/funnels', 'POST', { name: 'Now allowed' }, seller)).status, 200);
  assert.equal((await api('/uploads', 'POST', { type: 'image/png', data: PNG }, seller)).status, 200);
  const d = (await api(`/admin/users/${sellerId}`, 'GET', null, admin)).data;
  assert.deepEqual([d.limits.funnels, d.limits.storageMB, d.usage.funnels], [50, 10, have + 2]);
  assert.ok(d.usage.storageMB >= 0);
  // an agency's client accounts can be raised for that agency alone
  assert.equal((await api(`/admin/users/${sellerId}/action`, 'POST', { action: 'set_limits', agencyClients: 40 }, admin)).status, 200);
  assert.equal((await api(`/admin/users/${sellerId}`, 'GET', null, admin)).data.limits.agencyClients, 40);
  assert.equal((await api('/agency', 'GET', null, seller)).data.limit, 40);
  assert.equal((await api(`/admin/users/${sellerId}/action`, 'POST', { action: 'set_limits', agencyClients: 0 }, admin)).status, 400);
});
