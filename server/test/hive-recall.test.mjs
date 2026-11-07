// Hive memory with meaning search, and learned skills. The embedding service and the AI are local fakes: the fake
// embedding puts words that mean the same thing (weekend / sunday / holiday …) on the same axis, so a message can
// find a memory it shares no words with — which keyword search alone can't.
//   - a short list is sent whole; a long one sends the "always" items plus the best matches (words + meaning)
//   - a teammate gets the items for everyone and its own, never another teammate's
//   - learning drafts skills from the day's chats; nothing is used until published; rejected ones aren't redrafted
//   - tidy-up finds items that say the same thing and merges them
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { startServer, register } from './helpers.mjs';

// meaning axes for the fake embedding
const AXES = [
  ['weekend', 'sunday', 'sundays', 'saturday', 'holiday', 'closed', 'off', 'diwali'],
  ['hinglish', 'hindi', 'language', 'english'],
  ['discount', 'offer', 'coupon', 'cheaper', 'price', 'deal'],
  ['delivery', 'courier', 'shipping', 'ship', 'parcel', 'dispatch'],
  ['quote', 'quotation', 'proposal', 'estimate'],
  ['site', 'visit', 'tour', 'see', 'flat', 'property'],
];
const DIMS = 1024;
function vec(text) {
  const v = new Array(DIMS).fill(0);
  const words = String(text).toLowerCase().match(/[a-z]+/g) || [];
  for (const w of words) {
    const a = AXES.findIndex((ax) => ax.includes(w));
    if (a >= 0) v[a] += 1; else v[100 + ([...w].reduce((s, c) => s + c.charCodeAt(0), 0) % 900)] += 0.15; // other words: faint noise
  }
  const n = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
  return v.map((x) => x / n);
}

let ai, srv, api, T;
const asks = [];
let skillsReply = { skills: [] };
before(async () => {
  ai = http.createServer((req, res) => {
    let b = '';
    req.on('data', (c) => { b += c; });
    req.on('end', () => {
      const body = JSON.parse(b || '{}');
      res.setHeader('content-type', 'application/json');
      if (req.url.endsWith('/embeddings')) return res.end(JSON.stringify({ data: body.input.map((t, index) => ({ index, embedding: vec(t) })) }));
      asks.push(body);
      const learning = /reusable SKILLS/.test(body.instructions || '');
      const text = learning ? JSON.stringify(skillsReply) : 'Done.';
      res.end(JSON.stringify({ output: [{ type: 'message', content: [{ type: 'output_text', text }] }] }));
    });
  }).listen(0);
  await new Promise((r) => setTimeout(r, 30));
  const base = `http://127.0.0.1:${ai.address().port}`;
  srv = await startServer({ KIE_API_KEY: 'kie-test', KIE_BASE_URL: base, KIE_MODEL: 'deepseek-chat', OPENROUTER_API_KEY: 'or-test', OPENROUTER_BASE_URL: base, HIVE_MEMORY_ALL_UNDER: '4' });
  api = srv.api;
  T = (await register(api)).token;
});
after(async () => { await srv.stop(); ai.close(); });

const add = async (text, extra = {}) => (await api('/hive/memory', 'POST', { text, ...extra }, T)).data;
const chat = async (message, teammateId) => {
  // the reply streams (server-sent events): read it to the end
  const r = await fetch(`${srv.base}/api/hive/chat`, { method: 'POST', headers: { authorization: `Bearer ${T}`, 'content-type': 'application/json' }, body: JSON.stringify({ message, ...(teammateId ? { teammateId } : {}) }) });
  const body = await r.text();
  assert.ok(r.status < 400, body.slice(0, 300));
  return asks.at(-1)?.instructions || '';
};
// waits until meaning vectors exist: "weekend" shares no word with any memory, so only a meaning match finds it
const waitVectors = async () => { for (let i = 0; i < 40; i++) { await new Promise((r) => setTimeout(r, 150)); const s = (await api('/hive/memory/search?q=weekend', 'GET', null, T)).data.items; if (s.length) return; } };

test('a long memory list sends the always items and the matches by meaning — even with no shared words', async () => {
  await add('Reply to customers in Hinglish', { always: true });
  await add('We are closed on Sundays and Diwali');
  await add('Never give a discount above 10%');
  await add('Courier parcels go out by 4 pm');
  await add('Quotes are valid for 7 days');
  await add('Site visits need a day’s notice');
  await waitVectors();
  const sys = await chat('Can a customer come over this weekend?');
  assert.match(sys, /Reply to customers in Hinglish/, 'an always item is always sent');
  assert.match(sys, /closed on Sundays/, 'weekend → Sundays by meaning (no word in common)');
  assert.doesNotMatch(sys, /Courier parcels/, 'unrelated items stay out once the list is long');
  const sys2 = await chat('what is the best deal I can offer?');
  assert.match(sys2, /discount above 10%/, 'deal → discount by meaning');
  const found = (await api('/hive/memory/search?q=weekend', 'GET', null, T)).data.items.map((x) => x.text);
  assert.equal(found[0], 'We are closed on Sundays and Diwali', 'the Memory search box finds by meaning too');
});

test('a teammate gets items for everyone and its own — never another teammate’s; memory off → none', async () => {
  const sales = (await api('/hive/team', 'POST', { preset: 'sales' }, T)).data;
  const acc = (await api('/hive/team', 'POST', { preset: 'accounts' }, T)).data;
  await add('Always hold weekend site visits for Ravi', { always: true, scope: sales.id });
  const s1 = await chat('who should take the weekend site visit?', sales.id);
  assert.match(s1, /hold weekend site visits for Ravi/);
  assert.match(s1, /Reply to customers in Hinglish/);
  const s2 = await chat('who should take the weekend site visit?', acc.id);
  assert.doesNotMatch(s2, /for Ravi/, 'another teammate’s memory isn’t shared');
  await api(`/hive/team/${acc.id}`, 'PUT', { memory: false }, T);
  assert.doesNotMatch(await chat('weekend?', acc.id), /Reply to customers in Hinglish/, 'memory off → nothing remembered');
});

test('learning drafts skills from the day’s chats; only published ones are used; rejected ones stay out', async () => {
  const threads = (await api('/hive/threads', 'GET', null, T)).data;
  const tid = (threads.threads || threads)[0]?.id;
  skillsReply = { skills: [
    { title: 'Quote format', text: 'When writing a quotation, say prices exclude GST and add the payment schedule.', why: 'The seller corrected a quote twice', threads: [tid] },
    { title: 'Same again', text: 'Reply to customers in Hinglish', why: 'repeat', threads: [] },
  ] };
  const r = (await api('/hive/learn', 'POST', {}, T)).data;
  assert.equal(r.made, 1, 'a lesson already in memory isn’t drafted again');
  const d = r.drafts[0];
  assert.deepEqual([d.status, d.title, d.by], ['draft', 'Quote format', 'hive']);
  assert.ok(d.evidence.why);
  assert.doesNotMatch(await chat('make a quotation for the 2BHK'), /payment schedule/, 'a draft is never used');
  const pub = (await api(`/hive/memory/${d.id}`, 'PUT', { publish: true, scope: 'all', text: 'For a quotation, say prices exclude GST @5% and add the payment schedule.' }, T)).data;
  assert.equal(pub.status, 'active');
  assert.match(await chat('make a quotation for the 2BHK'), /Skills you've learned[\s\S]*payment schedule/, 'published → used when it fits');
  // reject: kept as rejected, so tomorrow's learning doesn't draft it again
  skillsReply = { skills: [{ title: 'Emoji', text: 'Use lots of emojis in every reply to customers.', why: 'once', threads: [] }] };
  const r2 = (await api('/hive/learn', 'POST', {}, T)).data;
  await api(`/hive/memory/${r2.drafts.find((x) => x.title === 'Emoji').id}/reject`, 'POST', {}, T);
  const r3 = (await api('/hive/learn', 'POST', {}, T)).data;
  assert.equal(r3.made, 0, 'a rejected skill isn’t drafted again');
});

test('tidy up: two items that say the same thing are offered for merging, and merge into one', async () => {
  const a = await add('Shop is closed every Sunday');
  let p;
  for (let i = 0; i < 40 && !p; i++) { await new Promise((r) => setTimeout(r, 150)); p = (await api('/hive/memory/similar', 'GET', null, T)).data.pairs.find((x) => [x.a.id, x.b.id].includes(a.id)); }
  assert.ok(p, 'the Sunday items are found as alike');
  const other = p.a.id === a.id ? p.b : p.a;
  const merged = (await api('/hive/memory/merge', 'POST', { keep: other.id, drop: a.id, text: 'Closed on Sundays and Diwali' }, T)).data;
  assert.equal(merged.text, 'Closed on Sundays and Diwali');
  const items = (await api('/hive/memory', 'GET', null, T)).data.items;
  assert.ok(!items.some((x) => x.id === a.id));
});

test('team members can read memory but not change it; the cap and empty text are refused', async () => {
  assert.equal((await api('/hive/memory', 'POST', { text: ' ' }, T)).status, 400);
  const items = (await api('/hive/memory', 'GET', null, T)).data;
  assert.equal(items.max, 500);
});
