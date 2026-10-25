// Hive's agent loop under load and in trouble: it starts with a small tool set and loads more on request; reads in
// one reply run together; a change isn't repeated; old results are shortened; a runaway turn stops on its token
// budget; model calls queue behind a platform-wide cap; a hiccup from the AI service is retried. Throwaway database.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'fh-hive-agent-'));
process.env.NODE_ENV = 'test';
process.env.HIVE_MAX_CONCURRENT = '1';
process.env.HIVE_TURN_TOKENS = '50000';
let hits = [], fake;
before(() => new Promise((r) => {
  // a fake AI service: the first call per test answers 503, then a normal reply
  fake = http.createServer((req, res) => { hits.push(Date.now()); res.setHeader('content-type', 'application/json'); if (hits.length === 1) { res.writeHead(503); return res.end('{"error":{"message":"busy"}}'); } res.end(JSON.stringify({ output: [{ type: 'message', content: [{ text: 'hi' }] }] })); }).listen(0, () => {
    process.env.KIE_API_KEY = 'k'; process.env.KIE_BASE_URL = `http://127.0.0.1:${fake.address().port}`; r();
  });
}));
after(() => fake.close());
let H, AI;
const load = async () => { if (!H) { await import('../sales.js'); AI = await import('../ai.js'); H = await import('../hive.js'); } };

const fc = (name, args = {}) => ({ type: 'function_call', call_id: `c_${Math.random().toString(36).slice(2)}`, name, arguments: JSON.stringify(args) });
const reply = (...output) => ({ output });
const text = (t) => ({ type: 'message', content: [{ text: t }] });
// a scripted model: answers in turn; records the tools and input it was sent
function script(steps) {
  const seen = [];
  const model = async ({ input, tools }) => { seen.push({ tools: tools.map((t) => t.name), input: structuredClone(input) }); const s = steps[seen.length - 1]; return typeof s === 'function' ? s() : s || reply(text('done')); };
  return { model, seen };
}
// a tool context whose API calls are recorded; GETs can be slow so overlap shows
function ctxWith(delay = 0, big = null) {
  const log = [];
  let open = 0, maxOpen = 0;
  const call = async (method, p, body) => { open++; maxOpen = Math.max(maxOpen, open); log.push(`${method} ${p}`); await new Promise((r) => setTimeout(r, delay)); open--; if (big && p === '/funnels') return big; return method === 'GET' ? [] : { id: 'x1', code: body?.code, ...body }; };
  return { ctx: { call, origin: 'http://t', pending: [] }, log, max: () => maxOpen };
}
const turn = (model, ctx, message = 'hello', extra = {}) => H.hiveTurn({ ctx, history: [], message, emit: () => {}, model, ...extra });

test('a turn starts small and loads a tool group when the model asks for it', async () => {
  await load();
  const { model, seen } = script([reply(fc('use_tools', { groups: ['quotes'] })), reply(text('ok'))]);
  await turn(model, ctxWith().ctx, 'hello there');
  assert.ok(seen[0].tools.includes('create_funnel') && seen[0].tools.includes('use_tools'));
  assert.ok(!seen[0].tools.includes('create_quote') && !seen[0].tools.includes('add_section'), 'only the core tools at first');
  assert.ok(seen[1].tools.includes('create_quote'), 'the quotes group is loaded for the next call');
  assert.ok(seen[0].tools.length < 25);
  // the message's words pick groups up front
  assert.deepEqual([...H.startGroups('set the checkout price to ₹999')], ['selling']);
  assert.ok(H.startGroups('remind leads on WhatsApp').has('automations'));
});

test('reads in one reply run at the same time; changes run one after another', async () => {
  await load();
  const r = ctxWith(60);
  const { model } = script([reply(fc('list_funnels'), fc('list_products'), fc('list_coupons')), reply(text('ok'))]);
  await turn(model, r.ctx);
  assert.equal(r.max(), 3, 'three reads together');
  const w = ctxWith(30);
  const s2 = script([reply(fc('create_coupon', { code: 'A1', type: 'percent', value: 10 }), fc('create_coupon', { code: 'B2', type: 'percent', value: 10 })), reply(text('ok'))]);
  await turn(s2.model, w.ctx);
  assert.equal(w.max(), 1, 'changes one at a time');
});

test('the same change asked twice in a turn runs once', async () => {
  await load();
  const r = ctxWith();
  const c = { code: 'SAME', type: 'percent', value: 10 };
  const { model, seen } = script([reply(fc('create_coupon', c)), reply(fc('create_coupon', c)), reply(text('ok'))]);
  const out = await turn(model, r.ctx);
  assert.equal(r.log.filter((x) => x.startsWith('POST')).length, 1);
  assert.match(seen[2].input.at(-1).output, /Already done/);
  assert.equal(out.tools.length, 1);
});

test('old tool results are shortened; the last two rounds stay whole', async () => {
  await load();
  const big = Array.from({ length: 400 }, (_, i) => ({ id: `f${i}`, name: `Funnel number ${i}` }));
  const { model, seen } = script([reply(fc('list_funnels')), reply(fc('list_products')), reply(fc('list_coupons')), reply(fc('list_templates')), reply(text('ok'))]);
  await turn(model, ctxWith(0, big).ctx);
  const firstOut = (s) => s.input.find((x) => x.type === 'function_call_output').output;
  assert.ok(firstOut(seen[2]).length > 5000, 'still whole two rounds later');
  assert.ok(firstOut(seen[3]).length < 1700 && /shortened/.test(firstOut(seen[3])), 'shortened after that');
});

test('a runaway turn stops on its token budget with a friendly note', async () => {
  await load();
  const loop = () => ({ output: [fc('list_funnels', { n: Math.random() })], usage: { input_tokens: 30000, output_tokens: 10 } });
  const { model, seen } = script(Array(16).fill(loop));
  const out = await turn(model, ctxWith().ctx);
  assert.equal(seen.length, 2, 'stopped once over 50k input tokens');
  assert.match(out.text, /say “continue”/i);
  assert.equal(out.usage.rounds, 2);
  assert.equal(out.usage.tokensIn, 60000);
});

test('model calls wait for a free slot platform-wide', async () => {
  await load();
  let open = 0, maxOpen = 0;
  const slow = async () => { open++; maxOpen = Math.max(maxOpen, open); await new Promise((r) => setTimeout(r, 40)); open--; return reply(text('ok')); };
  await Promise.all([turn(slow, ctxWith().ctx), turn(slow, ctxWith().ctx), turn(slow, ctxWith().ctx)]);
  assert.equal(maxOpen, 1, 'HIVE_MAX_CONCURRENT=1');
  assert.deepEqual(H.hiveLoad(), { live: 0, waiting: 0, max: 1 });
  // a stopped turn leaves the queue
  const ac = new AbortController();
  const a = turn(slow, ctxWith().ctx), b = turn(slow, ctxWith().ctx, 'hi', { signal: ac.signal }).catch((e) => e);
  ac.abort();
  await a; assert.match((await b).message, /Stopped/);
  assert.deepEqual(H.hiveLoad(), { live: 0, waiting: 0, max: 1 });
});

test('a hiccup from the AI service is retried', async () => {
  await load();
  hits = [];
  const d = await AI.kieResponses({ instructions: 'x', input: [], tools: [], backoffMs: 20 });
  assert.equal(hits.length, 2, 'a 503, then the answer');
  assert.equal(d.output[0].content[0].text, 'hi');
});
