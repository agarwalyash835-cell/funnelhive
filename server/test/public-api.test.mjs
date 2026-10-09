// The public API: keys (full / read-only, hashed, revocable), what a key can't reach, REST-hook subscriptions
// delivered on real events (Zapier-style), polling endpoints and the contact upsert with tags.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { startServer, register } from './helpers.mjs';

const got = [];
let sink, srv, api, T, f, full, read;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 4000) => { const end = Date.now() + ms; while (Date.now() < end) { const v = await fn(); if (v) return v; await wait(50); } return fn(); };
before(async () => {
  sink = http.createServer((req, res) => { let b = ''; req.on('data', (c) => { b += c; }); req.on('end', () => { got.push({ url: req.url, body: JSON.parse(b || '{}'), sig: req.headers['x-funnelhive-signature'] || req.headers['x-signature'] }); res.end('ok'); }); }).listen(0);
  srv = await startServer({ APP_URL: 'https://app.example.in', ALLOW_PRIVATE_WEBHOOKS: '1' });
  api = srv.api;
  T = (await register(api)).token;
  f = (await api('/templates/yoga/use', 'POST', {}, T)).data;
  await api(`/funnels/${f.id}`, 'PUT', { published: true }, T);
});
after(async () => { await srv.stop(); sink.close(); });
const K = (key, path, method = 'GET', body) => api(path, method, body, null, { 'x-api-key': key });

test('keys: created once (shown once), stored hashed, read-only keys can only read', async () => {
  full = (await api('/keys', 'POST', { name: 'Zapier', scope: 'full' }, T)).data;
  read = (await api('/keys', 'POST', { name: 'Reports', scope: 'read' }, T)).data;
  assert.match(full.token, /^fh_live_[0-9a-f]{40}$/);
  const list = (await api('/keys', 'GET', null, T)).data;
  assert.equal(list.keys.length, 2);
  assert.ok(!JSON.stringify(list).includes(full.token), 'never shown again');
  assert.equal((await K(full.token, '/v1/me')).data.key.scope, 'full');
  assert.equal((await api('/funnels', 'GET', null, full.token)).status, 200, 'Bearer works too');
  assert.equal((await K(read.token, '/funnels')).status, 200);
  assert.equal((await K(read.token, '/funnels', 'POST', { name: 'x' })).status, 403);
  assert.equal((await K('fh_live_' + '0'.repeat(40), '/funnels')).status, 401);
  for (const [p, m] of [['/keys', 'POST'], ['/billing', 'GET'], ['/account/export', 'GET'], ['/team/members', 'GET'], ['/channels', 'GET'], ['/hive/tokens', 'POST']]) assert.equal((await K(full.token, p, m, m === 'GET' ? undefined : {})).status, 403, `${m} ${p}`);
});

test('REST hooks: subscribe, receive real events, unsubscribe', async () => {
  const url = `http://127.0.0.1:${sink.address().port}/zap`;
  assert.equal((await K(full.token, '/v1/hooks', 'POST', { url, event: 'nope' })).status, 400);
  const h = (await K(full.token, '/v1/hooks', 'POST', { url, event: 'lead.created' })).data;
  assert.ok(h.id);
  await api(`/public/${f.slug}/lead`, 'POST', { stepId: f.steps[0].id, email: 'zap@x.in', name: 'Zap Lead' });
  const hit = await until(() => got.find((g) => g.url === '/zap' && g.body.event === 'lead.created'));
  assert.equal(hit.body.data.email, 'zap@x.in');
  assert.equal((await K(full.token, `/v1/hooks/${h.id}`, 'DELETE')).status, 200);
  const n = got.length;
  await api(`/public/${f.slug}/lead`, 'POST', { stepId: f.steps[0].id, email: 'after@x.in' });
  await wait(300);
  assert.equal(got.filter((g) => g.url === '/zap').length, got.slice(0, n).filter((g) => g.url === '/zap').length, 'unsubscribed');
});

test('polling endpoints and the contact upsert (tags fire automations)', async () => {
  const leads = (await K(read.token, '/v1/leads?limit=5')).data;
  assert.ok(leads.length >= 2 && leads[0].at >= leads[1].at, 'newest first');
  assert.equal(leads[0].funnel, f.name);
  assert.equal((await K(read.token, `/v1/leads?since=${Date.now() + 1000}`)).data.length, 0);
  const a = (await api('/automations', 'POST', { name: 'VIP welcome', trigger: { type: 'tag', tag: 'vip' }, steps: [{ type: 'tag', tag: 'welcomed' }] }, T)).data;
  await api(`/automations/${a.id}`, 'PUT', { active: true }, T);
  const c1 = await K(full.token, '/v1/contacts', 'POST', { email: 'New@Client.in', name: 'New Client', tags: ['vip'] });
  assert.equal(c1.status, 201);
  const c2 = await K(full.token, '/v1/contacts', 'POST', { email: 'new@client.in', tags: 'vip, paid' });
  assert.equal(c2.status, 200);
  assert.ok(['paid', 'vip'].every((t) => c2.data.tags.includes(t)));
  const c = await until(async () => { const x = (await api(`/contacts/${encodeURIComponent('new@client.in')}`, 'GET', null, T)).data; return x.tags?.includes('welcomed') && x; });
  assert.ok(c, 'the tag automation ran');
  assert.equal((await K(read.token, '/v1/contacts', 'POST', { email: 'x@x.in' })).status, 403);
  assert.equal((await api(`/keys/${full.id}`, 'DELETE', null, T)).status, 200);
  assert.equal((await K(full.token, '/v1/me')).status, 401, 'revoked');
});
