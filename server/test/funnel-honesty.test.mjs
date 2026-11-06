// A brief's honesty rules hold in the funnel the builder makes (brief.js honest + applyHonesty, quality.js sellerMarks):
// "NO fake countdown" is a rule, not a request for a fake one — the countdown waits for the seller's real date;
// "no invented testimonials" leaves slots for real reviews (never sample ones); a "[PLACEHOLDER] refund policy" stays
// the seller's; dates and coupon codes the seller never gave are taken out. Found on the live builder: a Kimi draft
// with 13 made-up reviews, "7 din ka refund, bina sawaal" and a countdown to a date it invented.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { startServer, register } from './helpers.mjs';
import { briefNeeds, applyHonesty, honestAny } from '../brief.js';

const RULES = `## HARD RULES
- NO invented stats, testimonials, buyer counts, "X log already kharid chuke", income claims or "guaranteed sales". Use clearly marked [PLACEHOLDER] slots for real testimonials later.
- NO fake original price ("₹999 ki value"). Use "Launch price ₹299" only.
- NO fake countdown timers or fake "only 3 left". Use urgency only if it's real (e.g. "launch price ends on [DATE]").
11. Honest guarantee ([PLACEHOLDER] for my refund policy)
12. Testimonial slots ([PLACEHOLDER], hidden until filled)`;
const BRIEF = `Grahak Ka Dimaag — an illustrated Hinglish PDF ebook on customer psychology for Indian shopkeepers. Launch price ₹299 by UPI. Order bump: audiobook ₹249.\n${RULES}`;

test('the brief: a rule against fake timers asks for a real one; its honesty rules are read', () => {
  const n = briefNeeds(BRIEF);
  assert.deepEqual(n.honest, { reviews: true, refund: true, deadline: true });
  assert.equal(honestAny(n), true);
  assert.equal(n.endsAt, null);
  assert.ok(n.blocks.includes('countdown'), 'a countdown — to the real date the seller sets');
  assert.match(n.notes.join('\n'), /endsAt 0 — the seller sets the real end date/);
  assert.match(n.notes.join('\n'), /every testimonials item is a slot for a real one/);
  assert.match(n.notes.join('\n'), /guarantee body is "\[PLACEHOLDER — your refund policy\]"/);
  assert.match(n.notes.join('\n'), /write "\[DATE\]"/);
  // a seller who asks for a countdown and reviews gets them, with no honesty rules switched on
  const plain = briefNeeds('Yoga classes in Pune, ₹999. Add a countdown timer and testimonials from our students.');
  assert.ok(plain.blocks.includes('countdown') && plain.blocks.includes('testimonials'));
  assert.equal(honestAny(plain), false);
  // a real date in the brief: the countdown counts to it, and dates aren't stripped
  const dated = briefNeeds('Ebook for shopkeepers, ₹299. Launch price ends on 15 December 2030 at 11 pm. No fake countdown timers.');
  assert.ok(dated.endsAt > Date.now());
  assert.equal(dated.honest.deadline, false);
});

// the shape of the live Kimi draft (made-up reviews, refund promise, an invented deadline, a stray coupon code)
const draft = () => ({ name: 'Grahak Ka Dimaag', steps: [{ type: 'sales', blocks: [
  { type: 'hellobar', props: { messages: [{ text: 'Launch price ₹299 · 5 December 2026, 00:00 IST tak' }, { text: '20 illustrated Hinglish chapters' }] } },
  { type: 'countdown', props: { label: 'Launch price ₹299 · 5 December 2026, 00:00 IST tak', mode: 'fixed', endsAt: 1796409000000, endedText: 'Launch price khatam' } },
  { type: 'testimonials', props: { title: 'Readers', items: [{ name: 'Rakesh Meena, Jaipur', quote: 'Chai stall ke liye combo try kiya.' }, { name: 'Sneha Kulkarni, Pune', quote: 'Profit maths kaam ka laga.' }] } },
  { type: 'pricing', props: { badge: 'Launch price · 5 December 2026 tak', price: 299, mrp: '' } },
  { type: 'guarantee', props: { title: '7 din ka refund, bina sawaal', body: 'PDF pasand na aaye toh 7 din ke andar poora ₹299 wapas.', days: 7 } },
  { type: 'faq', props: { items: [{ q: 'Refund milega?', a: 'Haan, 7 din ke andar poora paisa wapas.' }, { q: 'Language kya hai?', a: 'Roman Hinglish.' }] } },
  { type: 'exitpopup', props: { title: 'Ruk ja!', body: 'Chapter map dekh lo.', code: 'CHAPTER1', buttonText: 'Theek hai' } },
] }] });

test('applyHonesty: slots for real reviews, the seller’s refund policy, no made-up dates or codes', () => {
  const f = draft();
  const done = applyHonesty(f, briefNeeds(BRIEF), BRIEF);
  const [hb, cd, tm, pr, gu, fq, ex] = f.steps[0].blocks;
  assert.ok(tm.props.items.length === 3 && tm.props.items.every((x) => /^\[PLACEHOLDER/.test(x.name) && /^\[PLACEHOLDER/.test(x.quote)));
  assert.equal(gu.props.body, '[PLACEHOLDER — your refund policy]');
  assert.match(gu.props.title, /^\[PLACEHOLDER/);
  assert.equal(gu.props.days, 0);
  assert.equal(fq.props.items[0].a, '[PLACEHOLDER — your refund policy]');
  assert.equal(fq.props.items[1].a, 'Roman Hinglish.', 'other answers untouched');
  assert.deepEqual([cd.props.mode, cd.props.endsAt], ['fixed', 0], 'the countdown waits for the real date');
  assert.equal(hb.props.messages[0].text, 'Launch price ₹299 · [DATE] tak');
  assert.equal(pr.props.badge, 'Launch price · [DATE] tak');
  assert.equal(ex.props.code, '', 'no coupon code the seller never gave');
  assert.ok(done.length >= 6, done.join(' | '));
  // a coupon the seller did give stays
  const g = draft(); applyHonesty(g, briefNeeds(`${BRIEF}\nExit popup coupon: CHAPTER1`), `${BRIEF}\nExit popup coupon: CHAPTER1`);
  assert.equal(g.steps[0].blocks[6].props.code, 'CHAPTER1');
  // without honesty rules nothing changes
  const h = draft(); assert.deepEqual(applyHonesty(h, briefNeeds('Ebook for shopkeepers, ₹299'), ''), []);
  assert.equal(h.steps[0].blocks[2].props.items[0].name, 'Rakesh Meena, Jaipur');
});

// ---------- the builder end to end: a model that writes slots (as asked) and one that invents ----------
let fake, srv, api, T, reply = null;
const seen = [];
before(async () => {
  fake = http.createServer((req, res) => {
    let b = '';
    req.on('data', (c) => { b += c; });
    req.on('end', () => {
      const body = JSON.parse(b || '{}');
      seen.push(body);
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(reply()) }] }] }));
    });
  }).listen(0);
  await new Promise((r) => setTimeout(r, 30));
  srv = await startServer({ KIE_API_KEY: 'kie-test-key', KIE_BASE_URL: `http://127.0.0.1:${fake.address().port}`, AI_REPAIR_PASSES: '1' });
  api = srv.api;
  T = (await register(api)).token;
});
after(async () => { await srv.stop(); fake.close(); });

const funnel = (testimonials, guarantee) => ({ name: 'Grahak Ka Dimaag', theme: { style: 'luxe', primary: '#9c4a2f', secondary: '#c9a13b' }, steps: [
  { name: 'Grahak Ka Dimaag', type: 'sales', slug: 'start', blocks: [
    { type: 'hero', props: { headline: '*Kyun kharidte hain log?* Grahak ka dimaag padho', subheadline: 'Sher aur Ullu ki Hinglish kitab.', ctaText: 'Ebook lo — ₹299' } },
    { type: 'countdown', props: { label: 'Launch price ₹299 khatam hone mein', mode: 'evergreen', minutes: 15 } },
    { type: 'testimonials', props: { title: 'Readers kya kehte hain', items: testimonials } },
    { type: 'guarantee', props: { title: 'Refund policy', body: guarantee, days: 7 } },
  ] },
  { name: 'Checkout', type: 'checkout', slug: 'checkout', blocks: [{ type: 'checkout', props: { productName: 'Grahak Ka Dimaag (PDF)', price: 299, currency: '₹', bumpEnabled: true, bumpPrice: 249, bumpTitle: 'Hinglish audiobook' } }] },
  { name: 'Thank you', type: 'thankyou', slug: 'thanks', blocks: [{ type: 'thankyou', props: { headline: 'Shukriya! Ebook WhatsApp pe aa rahi hai' } }] },
] });
const SLOTS = [0, 1, 2].map(() => ({ name: '[PLACEHOLDER — customer name, city]', quote: '[PLACEHOLDER — a real customer’s words]' }));

test('the model is told the rules, the checker accepts the slots, and an inventing model is corrected', async () => {
  // a model that follows the rules: its slots are not "placeholder text" issues, and no repair invents reviews
  reply = () => funnel(SLOTS, '[PLACEHOLDER — your refund policy]');
  let n = seen.length;
  let r = await api('/ai/generate', 'POST', { prompt: BRIEF }, T);
  assert.equal(r.status, 200, JSON.stringify(r.data).slice(0, 300));
  const sys = seen.slice(n).find((x) => /funnel strategist/.test(x.instructions))?.instructions || '';
  assert.match(sys, /every testimonials item is a slot for a real one/);
  assert.doesNotMatch(sys, /Sample testimonials use realistic Indian names/, 'the bar no longer asks for sample reviews');
  assert.ok(!(r.data.quality.remaining || []).some((x) => /placeholder text/.test(x)), JSON.stringify(r.data.quality.remaining));
  let blocks = r.data.steps.flatMap((s) => s.blocks);
  assert.ok(blocks.find((b) => b.type === 'testimonials').props.items.every((x) => /PLACEHOLDER/.test(x.name)));
  assert.deepEqual([blocks.find((b) => b.type === 'countdown').props.mode, blocks.find((b) => b.type === 'countdown').props.endsAt], ['fixed', 0], 'never a per-visitor timer that restarts');

  // a model that invents anyway: the builder puts the slots back
  reply = () => funnel([{ name: 'Rakesh Meena, Jaipur', quote: 'Bahut kaam ki kitab.' }, { name: 'Sneha Kulkarni, Pune', quote: 'Margin samajh aaya.' }, { name: 'Imran Shaikh, Nagpur', quote: 'Worksheet best hai.' }], '7 din ka refund, bina sawaal — poora ₹299 wapas.');
  n = seen.length;
  r = await api('/ai/generate', 'POST', { prompt: BRIEF }, T);
  assert.equal(r.status, 200, JSON.stringify(r.data).slice(0, 300));
  blocks = r.data.steps.flatMap((s) => s.blocks);
  assert.doesNotMatch(JSON.stringify(r.data.steps), /Rakesh Meena|bina sawaal/);
  assert.equal(blocks.find((b) => b.type === 'guarantee').props.body, '[PLACEHOLDER — your refund policy]');
  assert.ok((r.data.quality.honesty || []).length > 0, 'the report says what was put back');
});
