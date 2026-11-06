// Funnel writing is streamed (ai.js kie + readSse): the AI provider's gateway closes a request that sends nothing for
// ~100 s (HTTP 524), and a detailed funnel takes longer to write. Streamed, the words arrive as they're written. The
// reader takes Claude's stream, the Responses API's and chat-completions style, a provider that answers in one piece
// anyway, and a model that refuses to stream (asked again in one piece).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { startServer, register } from './helpers.mjs';
import { readSse } from '../ai.js';

const FUNNEL = { name: 'Grahak Ka Dimaag', theme: { style: 'luxe', primary: '#c9a13b', secondary: '#2b2b2b' }, steps: [
  { name: 'Grahak Ka Dimaag', type: 'sales', slug: 'start', blocks: [{ type: 'hero', props: { headline: 'Kyun Kharidte Hain *Log?*', subheadline: 'Sher aur Ullu ke saath grahak ka dimaag samjho.', ctaText: 'Ebook lo — ₹299' } }] },
  { name: 'Checkout', type: 'checkout', slug: 'checkout', blocks: [{ type: 'checkout', props: { productName: 'Grahak Ka Dimaag (PDF ebook)', price: 299, currency: '₹', bumpEnabled: true, bumpPrice: 249, bumpTitle: 'Hinglish audiobook' } }] },
  { name: 'Thank you', type: 'thankyou', slug: 'thanks', blocks: [{ type: 'thankyou', props: { headline: 'Shukriya! Ebook WhatsApp pe aa rahi hai' } }] },
] };
const text = JSON.stringify(FUNNEL);
const pieces = (s, n = 7) => Array.from({ length: n }, (_, i) => s.slice(Math.floor((i * s.length) / n), Math.floor(((i + 1) * s.length) / n)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('the stream reader: Claude, Responses API, chat-completions, a completed-only stream and an error', () => {
  const sse = (events) => events.map((e) => `event: ${e.type || 'message'}\ndata: ${JSON.stringify(e)}\n`).join('\n');
  const parts = pieces(text);
  const claude = sse([{ type: 'message_start', message: {} }, { type: 'ping' }, ...parts.map((p) => ({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: p } })), { type: 'message_stop' }]);
  assert.equal(readSse(claude, () => '').text, text);
  const responses = sse([{ type: 'response.created' }, ...parts.map((p) => ({ type: 'response.output_text.delta', delta: p })), { type: 'response.completed', response: { output: [] } }]);
  assert.equal(readSse(responses, () => '').text, text);
  const completedOnly = sse([{ type: 'response.completed', response: { output: [{ type: 'message', content: [{ text }] }] } }]);
  assert.equal(readSse(completedOnly, (d) => d.output[0].content[0].text).text, text);
  const chat = `${parts.map((p) => `data: ${JSON.stringify({ choices: [{ delta: { content: p } }] })}`).join('\n\n')}\n\ndata: [DONE]\n`;
  assert.equal(readSse(chat, () => '').text, text);
  const err = readSse(sse([{ type: 'error', error: { message: 'Overloaded' } }]), () => '');
  assert.deepEqual([err.text, err.error], ['', 'Overloaded']);
});

test('the model’s thinking is never taken as the answer; a stream with only the finished text works too', () => {
  const sse = (events) => events.map((e) => `data: ${JSON.stringify(e)}\n`).join('\n');
  const parts = pieces(text);
  // a reasoning model on the Responses API: thinking deltas first, then the answer
  const reasoning = sse([{ type: 'response.reasoning_summary_text.delta', delta: 'Let me plan the funnel…' }, { type: 'response.reasoning_text.delta', delta: 'thinking' }, ...parts.map((p) => ({ type: 'response.output_text.delta', delta: p })), { type: 'response.output_text.done', text }]);
  assert.equal(readSse(reasoning, () => '').text, text);
  // chat-completions with reasoning_content (DeepSeek style)
  const ds = sse([{ object: 'chat.completion.chunk', choices: [{ delta: { reasoning_content: 'hmm' } }] }, ...parts.map((p) => ({ object: 'chat.completion.chunk', choices: [{ delta: { content: p } }] }))]);
  assert.equal(readSse(ds, () => '').text, text);
  // only the finished text, at the end
  const only = readSse(sse([{ type: 'response.in_progress' }, { type: 'response.output_text.done', text }]), () => '');
  assert.equal(only.text, text);
  assert.deepEqual(only.types, ['response.in_progress', 'response.output_text.done']);
  // a stream of events with no answer: empty text and the event names for the log
  const none = readSse(sse([{ type: 'response.created', response: { output: [] } }, { type: 'response.reasoning_text.delta', delta: 'x' }]), () => '');
  assert.equal(none.text, '');
  assert.deepEqual(none.types, ['response.created', 'response.reasoning_text.delta']);
});

// a provider that streams slowly, in pieces (as a long draft really arrives)
const seen = [];
function provider(format) {
  return http.createServer((req, res) => {
    let b = '';
    req.on('data', (c) => { b += c; });
    req.on('end', async () => {
      const body = JSON.parse(b || '{}');
      seen.push({ url: req.url, stream: body.stream });
      if (format === 'refuses' && body.stream) { res.writeHead(400, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ code: 400, msg: 'stream is not supported for this model' })); }
      if (!body.stream) { res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify(format === 'claude' ? { content: [{ type: 'text', text }] } : { output: [{ type: 'message', content: [{ type: 'output_text', text }] }] })); }
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      for (const p of pieces(text)) {
        const e = format === 'claude' ? { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: p } } : { type: 'response.output_text.delta', delta: p };
        res.write(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`);
        await sleep(120);
      }
      res.end(format === 'claude' ? 'event: message_stop\ndata: {"type":"message_stop"}\n\n' : 'event: response.completed\ndata: {"type":"response.completed","response":{"output":[]}}\n\n');
    });
  }).listen(0);
}
const servers = [];
after(async () => { for (const [s, p] of servers) { await s.stop(); p.close(); } });
async function builder(format, env = {}) {
  const p = provider(format);
  await sleep(30);
  const s = await startServer({ KIE_API_KEY: 'kie-test-key', KIE_BASE_URL: `http://127.0.0.1:${p.address().port}`, AI_REPAIR_PASSES: '0', ...env });
  servers.push([s, p]);
  return { api: s.api, T: (await register(s.api)).token };
}
const brief = 'Grahak Ka Dimaag — an illustrated Hinglish PDF ebook on customer psychology for Indian shopkeepers, launch price ₹299 by UPI';

test('a funnel written as a stream (Responses API) is built from the streamed words', async () => {
  const { api, T } = await builder('responses');
  const n = seen.length;
  const r = await api('/ai/generate', 'POST', { prompt: brief }, T);
  assert.equal(r.status, 200, JSON.stringify(r.data).slice(0, 300));
  assert.equal(r.data.usedAI, true);
  assert.equal(r.data.name, 'Grahak Ka Dimaag');
  assert.equal(r.data.steps.flatMap((s) => s.blocks).find((b) => b.type === 'checkout').props.price, 299);
  assert.ok(seen.slice(n).some((x) => x.stream === true && /\/openai\/v1\/responses$/.test(x.url)), 'asked to stream');
});

test('a funnel written as a Claude-style stream is built too', async () => {
  const { api, T } = await builder('claude', { KIE_MODEL: 'claude-test-model' });
  const n = seen.length;
  const r = await api('/ai/generate', 'POST', { prompt: brief }, T);
  assert.equal(r.status, 200, JSON.stringify(r.data).slice(0, 300));
  assert.equal(r.data.usedAI, true);
  assert.match(JSON.stringify(r.data.steps), /Kyun Kharidte Hain/);
  assert.ok(seen.slice(n).some((x) => x.stream === true && /\/claude\/v1\/messages$/.test(x.url)));
});

test('a stream still coming when our time limit ends: the log says so, with what had arrived (never "0 bytes")', async () => {
  // pieces 1.2 s apart, a 3 s budget: our limit ends it part-way
  const slow = http.createServer((req, res) => {
    req.resume();
    req.on('end', async () => {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      for (const p of pieces(text)) { if (res.destroyed) return; res.write(`data: ${JSON.stringify({ type: 'response.output_text.delta', delta: p })}\n\n`); await sleep(1200); }
      res.end();
    });
  }).listen(0);
  await sleep(30);
  const s = await startServer({ KIE_API_KEY: 'kie-test-key', KIE_BASE_URL: `http://127.0.0.1:${slow.address().port}`, AI_REPAIR_PASSES: '0', AI_FUNNEL_BUDGET_MS: '3000' });
  servers.push([s, slow]);
  const T = (await register(s.api)).token;
  const r = await s.api('/ai/generate', 'POST', { prompt: brief }, T);
  assert.equal(r.status, 503, JSON.stringify(r.data).slice(0, 200));
  await sleep(200);
  const log = s.log();
  assert.match(log, /our time limit \(\d+s\) ended it while the reply was still coming — \d+s, first byte \ds, \d+ bytes, \d+ chars of answer so far/);
  assert.doesNotMatch(log, /bytes=0|0 bytes, 0 chars/);
});

test('a model that refuses to stream is asked again in one piece', async () => {
  const { api, T } = await builder('refuses');
  const n = seen.length;
  const r = await api('/ai/generate', 'POST', { prompt: brief }, T);
  assert.equal(r.status, 200, JSON.stringify(r.data).slice(0, 300));
  assert.equal(r.data.usedAI, true);
  const calls = seen.slice(n).map((x) => x.stream);
  assert.ok(calls.includes(true) && calls.includes(false), JSON.stringify(calls));
});
