// When the AI can't write a funnel, the seller is never handed another business's template as theirs, never sees a
// developer error, and pays nothing. And a brief written as a full prompt ("You are a world-class…", "# MASTER PROMPT",
// a quoted product name) gives the funnel the product's name — not the prompt's first line — without breaking anything.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { startServer, register } from './helpers.mjs';
import { parsePrompt, matchTemplate } from '../templates.js';

const GRAHAK = `You are a world-class direct-response funnel designer, conversion copywriter and front-end developer who builds high-converting funnels for Indian D2C and info-product brands.

## THE PRODUCT
- Name: "Grahak Ka Dimaag: Kyun Kharidte Hain Log?"
- What it is: a premium illustrated Hinglish PDF ebook, 20 chapters, about customer psychology for shopkeepers and first-time D2C sellers.

## PRICING & FUNNEL
Landing/sales page → checkout ₹299 (launch price). Order bump: Hinglish audiobook ₹249.

## DELIVERABLES
B. Sales/landing page: complete, production-ready, single-file HTML + Tailwind (CDN). F. 10 Meta ad hooks. Output each deliverable under a clear heading.`;
const QUOTED = '"Grahak Ka Dimaag: Kyun Kharidte Hain Log?" — an illustrated Hinglish PDF ebook on customer psychology for Indian shopkeepers, launch price ₹299 by UPI';
const MASTER = `# MASTER PROMPT: BUILD A COMPLETE HIGH-CONVERTING SALES FUNNEL
Act as an expert sales funnel strategist, direct-response copywriter, conversion rate optimisation specialist, UI/UX designer, and marketing automation expert.
Your task is to DESIGN AND BUILD a complete, functional, professional, high-converting sales funnel using the information and assets I provide.
IMPORTANT: Do not just give me a strategy, suggestions, or wireframe. Actually build the funnel pages and configure the complete customer journey using the capabilities available on your platform.
1. UNDERSTAND THE BUSINESS
First, analyse all the business information, product details, documents, images, logos, and references I provide.`;

test('the name a brief states wins; a prompt’s instructions and headings never become the name', () => {
  assert.equal(parsePrompt(GRAHAK).name, 'Grahak Ka Dimaag: Kyun Kharidte Hain Log?');
  assert.equal(parsePrompt(QUOTED).name, 'Grahak Ka Dimaag: Kyun Kharidte Hain Log?');
  assert.equal(parsePrompt(MASTER).name, null, 'a long prompt with no product in it has no name to guess');
  assert.doesNotMatch(String(parsePrompt(GRAHAK).name), /world-class|funnel designer/i);
  // short one-liners keep working as before
  assert.equal(parsePrompt('Online yoga classes for working women, ₹499').name, 'Online Yoga Classes');
  assert.equal(parsePrompt('Homemade mango pickles delivered across India').name, 'Homemade Mango Pickles');
});

test('a name with quote marks in it goes into a template without breaking it', () => {
  const f = matchTemplate('"Shuddh" Ghee — "A2" desi cow ghee from our farm, ₹899 a litre');
  assert.ok(f.steps.length > 0);
  assert.match(f.name, /Shuddh Ghee/);
  assert.doesNotMatch(JSON.stringify(f), /\\"Shuddh/, 'no stray quote marks in the copy');
});

let fake, srv, api, T;
before(async () => {
  // a model that never returns funnel JSON (the brief asked for headings and HTML instead)
  fake = http.createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ output: [{ type: 'message', content: [{ type: 'output_text', text: '## A. Strategy\n```mermaid\ngraph TD; A-->B\n```\n<script>tailwind.config = { theme: { extend: {} } }</script>' }] }] }));
    });
  }).listen(0);
  await new Promise((r) => setTimeout(r, 30));
  srv = await startServer({ KIE_API_KEY: 'kie-test-key', KIE_BASE_URL: `http://127.0.0.1:${fake.address().port}`, AI_REPAIR_PASSES: '0' });
  api = srv.api;
  T = (await register(api)).token;
});
after(async () => { await srv.stop(); fake.close(); });

const count = async () => (await api('/funnels', 'GET', null, T)).data.length;
const credits = async () => { const me = (await api('/me', 'GET', null, T)).data; return JSON.stringify([me.credits, me.aiCredits, me.usage?.credits]); };

test('the AI fails on the seller’s own product: nothing is made, a plain reason, no credits', async () => {
  const before = await count(), c0 = await credits();
  for (const prompt of [GRAHAK, QUOTED]) {
    const r = await api('/ai/generate', 'POST', { prompt, length: 'detailed' }, T);
    assert.equal(r.status, 503, JSON.stringify(r.data).slice(0, 300));
    assert.match(r.data.error, /couldn’t write your funnel.*no credits/);
    assert.doesNotMatch(r.data.error, /JSON|position|Unexpected|Expected/, 'never a developer error');
    assert.equal(r.data.retry, true);
  }
  assert.equal(await count(), before, 'no other business’s template saved as theirs');
  assert.equal(await credits(), c0, 'nothing charged');
});

test('even when a template is about the same kind of business, its sample copy is never handed over as theirs', async () => {
  const before = await count();
  const r = await api('/ai/generate', 'POST', { prompt: 'Online yoga classes for working women, ₹499' }, T);
  assert.equal(r.status, 503, JSON.stringify(r.data).slice(0, 300));
  assert.match(r.data.error, /pick a template below/);
  assert.equal(await count(), before);
});
