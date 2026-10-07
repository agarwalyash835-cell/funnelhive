// Cluster mode: several app processes share one database. Requests land on different processes,
// yet every automation step and every webhook is sent exactly once.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { startServer, register } from './helpers.mjs';

let srv, api, T, f, hook;
const hits = [];
const until = async (fn, ms = 8000) => { const end = Date.now() + ms; while (Date.now() < end) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, 50)); } return fn(); };

before(async () => {
  hook = http.createServer((req, res) => { let b = ''; req.on('data', (c) => { b += c; }); req.on('end', () => { hits.push({ path: req.url, body: JSON.parse(b || '{}') }); res.end('ok'); }); }).listen(0);
  await new Promise((r) => setTimeout(r, 30));
  srv = await startServer({ WEB_CONCURRENCY: '3', AUTOMATION_TICK_MS: '50', AUTOMATION_TIME_SCALE: '0.001', WEBHOOK_TICK_MS: '50' }, { entry: 'start.js' });
  api = srv.api;
  for (let i = 0; i < 50 && !(await api('/health')).data.ok; i++) await new Promise((r) => setTimeout(r, 100));
  T = (await register(api)).token;
  f = (await api('/templates/yoga/use', 'POST', {}, T)).data;
  await api(`/funnels/${f.id}`, 'PUT', { published: true }, T);
});
after(async () => { await srv.stop(); hook.close(); });

test('cluster: each lead is sent to the seller webhook and through the automation exactly once', async () => {
  const base = `http://127.0.0.1:${hook.address().port}`;
  assert.equal((await api('/settings', 'PUT', { webhookUrl: `${base}/seller` }, T)).status, 200);
  const a = (await api('/automations', 'POST', { name: 'Ping', trigger: { type: 'lead' }, steps: [{ type: 'wait', amount: 1, unit: 'minutes' }, { type: 'webhook', url: `${base}/automation` }] }, T)).data;
  assert.equal((await api(`/automations/${a.id}`, 'PUT', { active: true }, T)).status, 200);
  const stepId = f.steps[0].id;
  const N = 30;
  // all at once, so they spread over the processes
  const out = await Promise.all(Array.from({ length: N }, (_, i) => api(`/public/${f.slug}/lead`, 'POST', { stepId, email: `buyer${i}@cluster.test`, name: `B${i}` })));
  assert.ok(out.every((r) => r.status === 200));
  const seller = () => hits.filter((h) => h.path === '/seller' && h.body.event === 'lead.created');
  const auto = () => hits.filter((h) => h.path === '/automation');
  await until(() => seller().length >= N && auto().length >= N, 15000);
  await new Promise((r) => setTimeout(r, 800)); // anything sent twice would arrive by now
  const emails = (list, pick) => list.map(pick).sort();
  assert.equal(seller().length, N, 'seller webhook: one delivery per lead');
  assert.deepEqual([...new Set(emails(seller(), (h) => h.body.data.email))].length, N);
  assert.equal(auto().length, N, 'automation webhook step: once per contact');
  assert.deepEqual([...new Set(emails(auto(), (h) => h.body.data.contact.email))].length, N);
  const view = (await api(`/automations/${a.id}`, 'GET', null, T)).data;
  assert.equal(view.stats.started, N);
  assert.equal(view.stats.completed, N, 'counters from different processes add up');
});

test('cluster: a change made through one process is seen by all of them', async () => {
  await api(`/funnels/${f.id}`, 'PUT', { name: 'Renamed in cluster' }, T);
  const names = await Promise.all(Array.from({ length: 12 }, () => api(`/funnels/${f.id}`, 'GET', null, T).then((r) => r.data.name)));
  assert.ok(names.every((n) => n === 'Renamed in cluster'));
});
