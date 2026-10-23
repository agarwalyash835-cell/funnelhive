// AI through kie.ai: a local fake of kie.ai checks what we send (template examples, auth) and
// answers like the real API. Never touches real credits.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { startServer, register } from './helpers.mjs';

const seen = [];
let mode = 'good';
const funnel = {
  name: 'Fake Bakery', theme: { style: 'fresh', primary: '#e11d48', secondary: '#f59e0b' },
  steps: [
    { name: 'Landing', type: 'sales', slug: 'start', blocks: [{ type: 'hero', props: { headline: 'Fresh cakes in *Pune*' } }, ...['stats', 'problem', 'features', 'testimonials', 'faq', 'cta'].map((type) => ({ type, props: {} })), { type: 'not_a_block', props: {} }] },
    { name: 'Checkout', type: 'checkout', slug: 'checkout', blocks: [{ type: 'checkout', props: { productName: 'Cake box', price: 499 } }] },
  ],
};
let fake, srv, api, T;
before(async () => {
  fake = http.createServer((req, res) => {
    let b = '';
    req.on('data', (c) => { b += c; });
    req.on('end', () => {
      const body = JSON.parse(b || '{}');
      seen.push({ url: req.url, auth: req.headers.authorization, body });
      res.setHeader('content-type', 'application/json');
      if (mode === 'unauthorized') return res.end(JSON.stringify({ code: 401, msg: 'The API key is not authorized to use this model.', data: null }));
      let text;
      if (/funnel strategist and copywriter/.test(body.instructions)) text = mode === 'broken' ? 'Sorry, here you go: {"name":' : JSON.stringify(funnel);
      else if (/AI funnel strategist/.test(body.instructions)) text = JSON.stringify({ reply: 'Done!', actions: [] });
      else text = JSON.stringify({ outputs: ['Ad one', 'Ad two'] });
      res.end(JSON.stringify({ status: 'completed', output: [{ type: 'reasoning', summary: [] }, { type: 'message', content: [{ type: 'output_text', text }] }] }));
    });
  }).listen(0);
  await new Promise((r) => setTimeout(r, 30));
  srv = await startServer({ KIE_API_KEY: 'kie-test-key', KIE_BASE_URL: `http://127.0.0.1:${fake.address().port}` });
  api = srv.api;
  T = (await register(api)).token;
});
after(async () => { await srv.stop(); fake.close(); });

test('funnel generation goes through kie.ai with our templates as examples, and is validated', async () => {
  const me = (await api('/me', 'GET', null, T)).data;
  assert.equal(me.aiEnabled, true);
  assert.equal(me.aiProvider, undefined, 'sellers never see the AI vendor or model (the platform owner does)');
  const r = (await api('/ai/generate', 'POST', { prompt: 'Home bakery in Pune selling custom birthday cakes' }, T)).data;
  assert.equal(r.usedAI, true);
  assert.equal(r.name, 'Fake Bakery');
  assert.ok(!r.steps[0].blocks.some((b) => b.type === 'not_a_block'), 'unknown blocks dropped');
  const call = seen.find((x) => /funnel strategist and copywriter/.test(x.body.instructions));
  assert.equal(call.url, '/openai/v1/responses');
  assert.equal(call.auth, 'Bearer kie-test-key');
  assert.equal(call.body.model, 'deepseek-v4-1-flash');
  assert.equal(call.body.stream, false);
  assert.match(call.body.instructions, /EXAMPLE — a complete funnel from our template library for a similar business \("Authentic Mithai Gift Hamper"\)/, 'closest template (sweets, for a bakery) included as the example');
  assert.match(call.body.instructions, /"type":"hero"/);
});

test('chat edits and marketing agents carry the template reference too', async () => {
  const f = (await api('/funnels', 'POST', { name: 'Chat test' }, T)).data;
  const c = (await api('/ai/chat', 'POST', { funnelId: f.id, stepId: f.steps[0].id, message: 'make it punchier' }, T)).data;
  assert.equal(c.reply, 'Done!');
  const chatCall = seen.findLast((x) => /AI funnel strategist/.test(x.body.instructions));
  assert.match(chatCall.body.instructions, /REFERENCE — one example of every block/);
  const a = (await api('/ai/agent', 'POST', { kind: 'ads', funnelId: f.id }, T)).data;
  assert.deepEqual(a.outputs, ['Ad one', 'Ad two']);
});

test('broken JSON is retried; failures fall back to the closest template (never a broken funnel)', async () => {
  mode = 'broken';
  const n = seen.length;
  const r = (await api('/ai/generate', 'POST', { prompt: 'Yoga classes for busy professionals' }, T)).data;
  assert.equal(r.usedAI, false, 'reported honestly as a template, not AI');
  assert.ok(r.steps[0].blocks.some((b) => b.type === 'hero'));
  assert.ok(seen.length - n >= 2, 'retried before giving up');
  mode = 'unauthorized';
  const u = (await api('/ai/generate', 'POST', { prompt: 'Spoken English course' }, T)).data;
  assert.equal(u.usedAI, false);
  const chat = await api('/ai/chat', 'POST', { funnelId: u.id, stepId: u.steps[0].id, message: 'hi' }, T);
  assert.equal(chat.status, 500);
  assert.match(chat.data.error, /AI is busy/, 'the vendor’s own error stays in the server log');
  assert.doesNotMatch(chat.data.error, /kie|deepseek|authorized/i);
  mode = 'good';
});

test('quality gate: a weak first draft is repaired, and whatever is still missing comes from the template', async () => {
  mode = 'good';
  const r = (await api('/ai/generate', 'POST', { prompt: 'Home bakery in Pune selling custom birthday cakes, ₹899' }, T)).data;
  const q = r.quality;
  assert.ok(q.firstDraftIssues > 10, 'the fake first draft is far below the bar');
  assert.equal(q.repairPasses, 2, 'the model was asked to repair it twice');
  assert.ok(q.filledFromTemplate.length > 0, 'the rest was topped up from the template');
  assert.equal(q.finalIssues, 0, `what the seller gets meets the bar — left: ${JSON.stringify(q.remaining)}`);
  assert.deepEqual(r.steps.map((s) => s.type), ['sales', 'checkout', 'upsell', 'downsell', 'thankyou']);
  assert.ok(r.steps[0].blocks.length >= 12, 'a full landing page, as in the matched template');
  assert.equal(r.name, 'Fake Bakery', 'the AI’s own content is kept');
  const repairCalls = seen.filter((x) => /fails the quality bar/.test(JSON.stringify(x.body.input)));
  assert.ok(repairCalls.length >= 1, 'repair prompts list the exact problems');
});
