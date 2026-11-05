// A seller's own product (a name and niche no template knows) must stay the funnel's subject: the brief reaches the
// model, and the page the seller gets is about that product — never a template's other business filling the gaps.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { startServer, register } from './helpers.mjs';
import { sameNiche, similarTemplates } from '../templates.js';

const PROMPT = 'Zentrova SitRight — our own smart posture belt that buzzes gently when you slouch, ₹2,499, for office workers who sit all day';
const seen = [];
let draft;
// a decent first draft about the product, shaped the way models often answer: a "landing" page instead of the
// template's "sales" page, a checkout and a thank-you page, no upsell / downsell, a few sections short
const zentrovaDraft = () => ({
  name: 'Zentrova SitRight', theme: { style: 'clean', primary: '#4a5560', secondary: '#b5654a' },
  steps: [
    { name: 'Zentrova SitRight', type: 'landing', slug: 'start', blocks: [
      { type: 'hero', props: { headline: 'Sit straight all day with *Zentrova SitRight*', subheadline: 'The Zentrova posture belt buzzes gently the moment you slouch.', ctaText: 'Get my Zentrova belt', image: '' } },
      { type: 'features', props: { title: 'Why Zentrova SitRight works', items: [{ title: 'Zentrova slouch sensor', text: 'Feels a slouch within 2 seconds.' }, { title: 'Zentrova gentle buzz', text: 'A soft nudge, never a shock.' }, { title: 'Zentrova all-day battery', text: 'Charges once a week over USB-C.' }] } },
      { type: 'testimonials', props: { title: 'Zentrova at work', items: [{ name: 'Ritu Sharma, Pune', quote: 'My Zentrova belt fixed my desk slouch in two weeks.' }, { name: 'Arjun Mehta, Bengaluru', quote: 'Zentrova SitRight is the only gadget I wear daily.' }, { name: 'Neha Iyer, Chennai', quote: 'Zentrova stopped my evening back ache.' }] } },
      { type: 'faq', props: { title: 'Zentrova questions', items: [{ q: 'Is Zentrova visible under a shirt?', a: 'The Zentrova belt is 6 mm thin.' }, { q: 'Does Zentrova need an app?', a: 'No, Zentrova works on its own.' }, { q: 'Zentrova warranty?', a: 'One year on every Zentrova belt.' }] } },
      { type: 'cta', props: { headline: 'Start sitting right with Zentrova', buttonText: 'Order Zentrova SitRight' } },
    ] },
    { name: 'Checkout', type: 'checkout', slug: 'checkout', blocks: [{ type: 'checkout', props: { productName: 'Zentrova SitRight posture belt', description: 'The Zentrova belt, charger and pouch', price: 2499, currency: '₹', bumpEnabled: false, buttonText: 'Order Zentrova' } }] },
    { name: 'Thank you', type: 'thankyou', slug: 'thanks', blocks: [{ type: 'thankyou', props: { headline: 'Your Zentrova SitRight is on its way', body: 'We pack every Zentrova belt within a day.', steps: [{ text: 'Zentrova ships in 24 hours' }, { text: 'Track your Zentrova order on WhatsApp' }] } }] },
  ],
});
let fake, srv, api, T;
before(async () => {
  fake = http.createServer((req, res) => {
    let b = '';
    req.on('data', (c) => { b += c; });
    req.on('end', () => {
      const body = JSON.parse(b || '{}');
      seen.push(body);
      // every funnel call (draft and repairs) gets the same draft back
      const text = JSON.stringify(draft());
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ output: [{ type: 'message', content: [{ type: 'output_text', text }] }] }));
    });
  }).listen(0);
  await new Promise((r) => setTimeout(r, 30));
  srv = await startServer({ KIE_API_KEY: 'kie-test-key', KIE_BASE_URL: `http://127.0.0.1:${fake.address().port}`, AI_REPAIR_PASSES: '1' });
  api = srv.api;
  T = (await register(api)).token;
});
after(async () => { await srv.stop(); fake.close(); });

const strings = (v, out = []) => { if (typeof v === 'string') out.push(v); else if (Array.isArray(v)) v.forEach((x) => strings(x, out)); else if (v && typeof v === 'object') Object.values(v).forEach((x) => strings(x, out)); return out; };

test('the seller’s own product reaches the model and is what the funnel sells', async () => {
  draft = zentrovaDraft;
  const n = seen.length;
  const r = await api('/ai/generate', 'POST', { prompt: PROMPT }, T);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const f = r.data;
  // the brief reached the model word for word
  const first = seen.slice(n).find((x) => /funnel strategist and copywriter/.test(x.instructions));
  assert.ok(first, 'the funnel model was called');
  assert.equal(first.input.at(-1).content, PROMPT);
  assert.equal(f.usedAI, true);
  // the first page the visitor sees is the seller's own page about their product
  const page = f.steps[0];
  const hero = page.blocks.find((b) => b.type === 'hero');
  assert.match(hero?.props?.headline || '', /Zentrova/, `the first page's hero is about the product: ${hero?.props?.headline}`);
  // the checkout sells the seller's product, at their price
  const chk = f.steps.flatMap((s) => s.blocks).find((b) => b.type === 'checkout').props;
  assert.match(chk.productName, /Zentrova/);
  assert.equal(chk.price, 2499);
  // nothing from a template's other business: every hero, checkout and offer on the seller's pages names the product
  for (const st of f.steps) for (const b of st.blocks.filter((x) => ['hero', 'checkout', 'offer', 'thankyou'].includes(x.type))) {
    const txt = strings(b.props).join(' ');
    assert.match(txt, /Zentrova/, `${st.type} page ${b.type} is about another business: ${txt.slice(0, 200)}`);
  }
  assert.ok(!/\bSIP|mutual fund/i.test(JSON.stringify(f.steps)), 'no copy from an unrelated template');
});

test('a template of the same kind of business still tops up, but the AI’s own main page keeps its place', async () => {
  const cake = /Mithai|cake/i;
  assert.equal(sameNiche('Home bakery in Pune selling custom birthday cakes, ₹899', similarTemplates('Home bakery in Pune selling custom birthday cakes, ₹899', 1)[0]), true);
  assert.equal(sameNiche(PROMPT, similarTemplates(PROMPT, 1)[0]), false);
  draft = () => {
    const d = zentrovaDraft();
    d.name = 'Pune Cake Studio';
    d.steps[0].blocks[0].props.headline = 'Custom birthday cakes baked fresh in *Pune Cake Studio*';
    return d;
  };
  const f = (await api('/ai/generate', 'POST', { prompt: 'Home bakery in Pune selling custom birthday cakes, ₹899' }, T)).data;
  assert.ok(f.quality.filledFromTemplate.length > 0, 'the same-niche template filled the gaps');
  assert.equal(f.steps[0].type, 'sales');
  assert.match(f.steps[0].blocks.find((b) => b.type === 'hero').props.headline, /Pune Cake Studio/, 'the AI’s page is the first page, not the template’s');
  assert.ok(cake.test(JSON.stringify(f.steps)));
});
