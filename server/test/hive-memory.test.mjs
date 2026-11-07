// Hive memory and teammate run retry: the seller adds / changes / deletes what Hive remembers (team members can't);
// Hive's instructions carry it, and a teammate's too unless its memory is off; "remember" saves one. A teammate's
// run that fails shows as failed with a Retry, and the retry is told to check what the stopped run already did.
// The AI is a local fake.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { startServer, register } from './helpers.mjs';

let fake, srv, api, T, H;
const asks = [];
let failNext = 0;
before(async () => {
  fake = http.createServer((req, res) => {
    let b = '';
    req.on('data', (c) => { b += c; });
    req.on('end', () => {
      asks.push(JSON.parse(b || '{}'));
      res.setHeader('content-type', 'application/json');
      if (failNext > 0) { failNext--; res.statusCode = 400; return res.end(JSON.stringify({ error: { message: 'bad request' } })); }
      res.end(JSON.stringify({ output: [{ type: 'message', content: [{ type: 'output_text', text: 'Followed up with 3 leads.' }] }] }));
    });
  }).listen(0);
  await new Promise((r) => setTimeout(r, 30));
  srv = await startServer({ KIE_API_KEY: 'kie-test', KIE_BASE_URL: `http://127.0.0.1:${fake.address().port}`, KIE_MODEL: 'deepseek-chat' });
  api = srv.api;
  T = (await register(api)).token;
  await import('../sales.js'); // the app's own module order (hive.js alone makes a loop)
  H = await import('../hive.js');
});
after(async () => { await srv.stop(); fake.close(); });

test('the seller manages what Hive remembers: add, no duplicates, change, delete', async () => {
  assert.deepEqual((await api('/hive/memory', 'GET', null, T)).data.items, []);
  const a = (await api('/hive/memory', 'POST', { text: '  Reply to customers in Hinglish  ' }, T)).data;
  assert.deepEqual([a.text, a.by], ['Reply to customers in Hinglish', 'you']);
  const again = (await api('/hive/memory', 'POST', { text: 'reply to customers in hinglish' }, T)).data;
  assert.equal(again.id, a.id, 'the same thing twice is kept once');
  assert.equal((await api('/hive/memory', 'POST', { text: '   ' }, T)).status, 400);
  const b = (await api('/hive/memory', 'POST', { text: 'We are closed on Sundays', by: 'hive' }, T)).data;
  assert.equal(b.by, 'hive');
  assert.equal((await api(`/hive/memory/${b.id}`, 'PUT', { text: 'Closed on Sundays and Diwali' }, T)).data.text, 'Closed on Sundays and Diwali');
  await api(`/hive/memory/${a.id}`, 'DELETE', null, T);
  assert.deepEqual((await api('/hive/memory', 'GET', null, T)).data.items.map((m) => m.text), ['Closed on Sundays and Diwali']);
});

test('Hive’s instructions carry the memory; a teammate’s too unless its memory is off', async () => {
  const seen = [];
  const model = async ({ instructions, tools }) => { seen.push({ instructions, tools: tools.map((t) => t.name) }); return { output: [{ type: 'message', content: [{ text: 'ok' }] }] }; };
  const ctx = { origin: 'http://t', pending: [], memory: '\n\nThe seller asked you to remember these:\n- Closed on Sundays', call: async () => ({}) };
  const turn = (teammate, message = 'hello') => H.hiveTurn({ ctx, history: [], message, emit: () => {}, model, teammate });
  await turn(null, 'remember that we close at 8');
  assert.match(seen.at(-1).instructions, /Closed on Sundays/);
  assert.ok(seen.at(-1).tools.includes('remember'), 'asked to remember → the remember tool is offered');
  const mate = { id: 'm1', name: 'Sales', role: 'Sales', groups: ['crm'] };
  await turn(mate, 'remember to call Meera');
  assert.match(seen.at(-1).instructions, /Closed on Sundays/);
  assert.ok(seen.at(-1).tools.includes('remember'));
  await turn({ ...mate, memory: false }, 'remember to call Meera');
  assert.doesNotMatch(seen.at(-1).instructions, /Closed on Sundays/, 'memory off → not told');
  assert.ok(!seen.at(-1).tools.includes('remember'));
});

const team = async () => (await api('/hive/team', 'GET', null, T)).data.team;
const settle = async (id, want) => { for (let i = 0; i < 60; i++) { const m = (await team()).find((x) => x.id === id); if (want.includes(m.lastRun?.status)) return m; await new Promise((r) => setTimeout(r, 100)); } throw new Error('the run never settled'); };

test('a failed run shows Failed with Retry; the retry checks what was already done', async () => {
  const m = (await api('/hive/team', 'POST', { preset: 'sales' }, T)).data;
  assert.equal((await api(`/hive/team/${m.id}/retry`, 'POST', null, T)).status, 400, 'nothing to retry yet');
  failNext = 1;
  const r1 = await api(`/hive/team/${m.id}/run`, 'POST', null, T);
  assert.equal(r1.status, 200, JSON.stringify(r1.data));
  const failed = await settle(m.id, ['failed', 'done']);
  assert.equal(failed.lastRun.status, 'failed');
  assert.ok(failed.lastRun.error);
  const before = asks.length;
  const r2 = await api(`/hive/team/${m.id}/retry`, 'POST', null, T);
  assert.equal(r2.status, 200, JSON.stringify(r2.data));
  assert.equal(r2.data.threadId, r1.data.threadId, 'retried in the same chat');
  const done = await settle(m.id, ['done', 'failed']);
  assert.equal(done.lastRun.status, 'done');
  const sent = JSON.stringify(asks.slice(before));
  assert.match(sent, /retries a run that stopped before finishing/);
  assert.equal((await api(`/hive/team/${m.id}/retry`, 'POST', null, T)).status, 400, 'a finished run isn’t retried');
  // the seller's PUT can't fake a run state
  await api(`/hive/team/${m.id}`, 'PUT', { name: 'Riya', lastRun: { status: 'failed' } }, T);
  assert.equal((await team()).find((x) => x.id === m.id).lastRun.status, 'done');
});
