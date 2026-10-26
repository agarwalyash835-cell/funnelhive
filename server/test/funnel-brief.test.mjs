// A vague brief gets a few smart questions before anything is built (the API and Hive AI), pages come in three
// lengths with each section once, and the seller's design picks (style, brand colour) are kept.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { startServer, register } from './helpers.mjs';
import { briefLooksReady } from '../ai.js';
import { trimTemplate } from '../quality.js';
import { getTemplate, similarTemplates } from '../templates.js';

let srv, api, model;
const ai = { clarify: null, calls: 0, asked: '' };
const call = async (tok, name, args) => {
  const r = await (await fetch(`${srv.base}/mcp`, { method: 'POST', headers: { authorization: `Bearer ${tok}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) })).json();
  const text = r.result?.content?.[0]?.text || '';
  if (r.result?.isError) return { error: text };
  try { return JSON.parse(text); } catch { return { text }; }
};
const fresh = async () => {
  const T = (await register(api)).token;
  return { T, tok: (await api('/hive/tokens', 'POST', { name: 'test' }, T)).data.token };
};
before(async () => {
  // the brief check gets ai.clarify; funnel generation gets nothing usable, so it falls back to the (trimmed) template
  model = http.createServer((req, res) => {
    let b = '';
    req.on('data', (d) => { b += d; });
    req.on('end', () => {
      const j = JSON.parse(b);
      ai.calls++;
      const brief = /You ask ONE question at a time/.test(j.instructions);
      if (brief) ai.asked = String(j.input?.at(-1)?.content || '');
      const text = brief ? JSON.stringify(typeof ai.clarify === 'function' ? ai.clarify(ai.asked) : ai.clarify) : 'no json here';
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ output: [{ type: 'message', content: [{ type: 'output_text', text }] }] }));
    });
  });
  await new Promise((r) => model.listen(0, '127.0.0.1', r));
  srv = await startServer({ KIE_API_KEY: 'kie_test', KIE_BASE_URL: `http://127.0.0.1:${model.address().port}`, AI_REPAIR_PASSES: '0' });
  api = srv.api;
});
after(async () => { await srv.stop(); model.close(); });

test('a full brief is ready; a one-liner is not', () => {
  assert.equal(briefLooksReady('Free guide that grows my email list'), false);
  assert.equal(briefLooksReady('Email something'), false);
  assert.equal(briefLooksReady('Online Excel course for working professionals in Pune, ₹1,999, 6 weeks of recorded lessons with weekly live doubt sessions'), true);
});

test('a vague brief gets ONE question at a time, each chosen from the brief and the answers so far — and stops when it’s enough', async () => {
  const { T } = await fresh();
  // first question: picked for this brief (cleaned: id, length, options)
  ai.clarify = { ready: false, understood: 'You want a free guide to grow an email list.', question: { id: 'topic!', q: 'What will the free guide be about?', options: ['Fitness', 'Money', 'Parenting', 42, ''] } };
  let r = await api('/ai/clarify', 'POST', { prompt: 'Free guide that grows my email list' }, T);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.deepEqual([r.data.ready, r.data.asked, r.data.max], [false, 0, 4]);
  assert.deepEqual(r.data.question, { id: 'topic', q: 'What will the free guide be about?', options: ['Fitness', 'Money', 'Parenting'] });
  assert.equal(r.data.understood, 'You want a free guide to grow an email list.');
  assert.ok(!('questions' in r.data), 'never a list of questions');
  // the next one sees the answer so far
  ai.clarify = { ready: false, question: { id: 'who', q: 'Who is the money guide for — salaried folks or business owners?', options: ['Salaried', 'Business owners'] } };
  r = await api('/ai/clarify', 'POST', { prompt: 'Free guide that grows my email list', answers: [{ q: 'What will the free guide be about?', a: 'Money' }] }, T);
  assert.match(ai.asked, /Q: What will the free guide be about\?\nA: Money/);
  assert.match(ai.asked, /Questions asked so far: 1 of at most 4/);
  assert.equal(r.data.asked, 1);
  assert.match(r.data.question.q, /money guide/);
  // enough now → ready; and never more than four questions
  ai.clarify = { ready: true };
  assert.deepEqual((await api('/ai/clarify', 'POST', { prompt: 'Yoga course', answers: [{ q: 'x', a: 'y' }] }, T)).data, { ready: true });
  ai.clarify = { ready: false, question: { q: 'Yet another?' } };
  const four = [1, 2, 3, 4].map((i) => ({ q: `q${i}`, a: `a${i}` }));
  assert.deepEqual((await api('/ai/clarify', 'POST', { prompt: 'Yoga course', answers: four }, T)).data, { ready: true });
  // the model repeats a question it already asked, or fails: the next standard question the brief doesn't cover
  ai.clarify = { ready: false, question: { q: 'What exactly do you sell?' } };
  r = await api('/ai/clarify', 'POST', { prompt: 'Baking class ₹499', answers: [{ q: 'What exactly do you sell?', a: 'Online course' }] }, T);
  assert.equal(r.data.question.id, 'who', 'not asked twice; the price is already in the brief');
  ai.clarify = 'oops';
  r = await api('/ai/clarify', 'POST', { prompt: 'Baking class ₹499' }, T);
  assert.equal(r.data.question.id, 'what');
  // a full brief never reaches the model
  const n = ai.calls;
  assert.deepEqual((await api('/ai/clarify', 'POST', { prompt: 'Online Excel course for working professionals in Pune, ₹1,999, 6 weeks of recorded lessons with weekly live doubt sessions' }, T)).data, { ready: true });
  assert.equal(ai.calls, n);
  assert.equal((await api('/ai/clarify', 'POST', { prompt: '' }, T)).status, 400);
});

test('a free guide / list-building brief gets a sign-up funnel, not a paid sales funnel', () => {
  const shape = (p) => similarTemplates(p, 1)[0].steps.map((s) => s.type).join('>');
  assert.equal(shape('Free guide that grows my email list'), 'optin>thankyou');
  assert.equal(shape('Free ebook on home loans for first-time buyers'), 'optin>thankyou');
  assert.match(shape('Homemade mango pickles delivered across India'), /^sales>checkout/);
  assert.match(shape('Free masterclass on stock trading'), /^optin>thankyou>sales/);
});

test('page lengths: short and standard drop the extras and never repeat a section; detailed is the full template', () => {
  const t = getTemplate('pcod');
  const main = (x) => x.steps[0].blocks.map((b) => b.type);
  assert.ok(main(t).length >= 15);
  const short = main(trimTemplate(t, 'short'));
  const std = main(trimTemplate(t, 'standard'));
  assert.ok(short.length <= 8, short.join());
  assert.ok(std.length < main(t).length && std.length > short.length, std.join());
  for (const ty of ['hellobar', 'stats', 'exitpopup', 'proof']) assert.ok(!std.includes(ty), `standard has no ${ty}`);
  for (const ty of ['hero', 'testimonials', 'faq', 'cta']) assert.ok(short.includes(ty), `short keeps ${ty}`);
  assert.equal(new Set(std).size, std.length);
  assert.deepEqual(main(trimTemplate(t, 'detailed')), main(t));
  // checkout, upsell and thank-you pages are left alone
  assert.deepEqual(trimTemplate(t, 'short').steps.slice(1).map((s) => s.blocks.length), t.steps.slice(1).map((s) => s.blocks.length));
});

test('generate keeps the seller’s length, style and brand colour', async () => {
  const { T } = await fresh();
  const brief = 'PCOD healing programme for women in Pune, ₹2,999';
  const s = (await api('/ai/generate', 'POST', { prompt: brief, length: 'short', style: 'clean', primary: '#1E40AF' }, T)).data;
  const d = (await api('/ai/generate', 'POST', { prompt: brief, length: 'detailed' }, T)).data;
  assert.ok(s.steps[0].blocks.length < d.steps[0].blocks.length, `${s.steps[0].blocks.length} vs ${d.steps[0].blocks.length}`);
  assert.equal(s.theme.style, 'clean');
  assert.equal(s.theme.primary, '#1e40af');
  // nonsense picks are ignored, and no length means standard
  const x = (await api('/ai/generate', 'POST', { prompt: brief, length: 'huge', style: 'nope', primary: 'blue' }, T)).data;
  assert.notEqual(x.theme.style, 'nope');
  assert.ok(x.steps[0].blocks.length > s.steps[0].blocks.length && x.steps[0].blocks.length < d.steps[0].blocks.length);
});

test('Hive AI asks before building from a vague brief, then builds once answered', async () => {
  const { T, tok } = await fresh();
  // one question per turn; the answers come back with the next call, and it builds once that's enough
  ai.clarify = (asked) => (/A: PCOD diet coaching/.test(asked) ? { ready: true } : { ready: false, question: { id: 'what', q: 'What do you sell?', options: ['Course', 'Coaching'] } });
  const before = (await api('/funnels', 'GET', null, T)).data.length;
  const r = await call(tok, 'create_funnel', { brief: 'Email something' });
  assert.equal(r.needsInfo, true, JSON.stringify(r));
  assert.equal(r.question.q, 'What do you sell?');
  assert.match(r.next, /just this ONE question/);
  assert.equal((await api('/funnels', 'GET', null, T)).data.length, before, 'nothing built');
  const ok = await call(tok, 'create_funnel', { brief: 'Email something', answers: [{ q: 'What do you sell?', a: 'PCOD diet coaching, ₹2,999, for women' }], length: 'short' });
  assert.ok(ok.id && ok.steps.length, JSON.stringify(ok).slice(0, 300));
  assert.equal((await api('/funnels', 'GET', null, T)).data.length, before + 1);
});
