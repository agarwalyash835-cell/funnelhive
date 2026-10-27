// "Build with AI" for quotes, webinars and the inbox's rules (aibuild.js), against a fake AI: a sentence → a draft
// that went through the module's own checks, nothing saved; the industry's template is the AI's example.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { startServer, register } from './helpers.mjs';

let srv, api, T, model;
const ai = { last: null, reply: null };
before(async () => {
  model = http.createServer((req, res) => {
    let b = '';
    req.on('data', (d) => { b += d; });
    req.on('end', () => {
      const j = JSON.parse(b);
      ai.last = { sys: j.instructions, user: j.input.at(-1).content };
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(ai.reply) }] }] }));
    });
  });
  await new Promise((r) => model.listen(0, '127.0.0.1', r));
  srv = await startServer({ KIE_API_KEY: 'kie_test', KIE_BASE_URL: `http://127.0.0.1:${model.address().port}` });
  api = srv.api;
  T = (await register(api)).token;
});
after(async () => { await srv.stop(); model.close(); });

test('a quote from a sentence: items, add-ons, details, GST line and terms — cleaned, with the industry’s template as the example', async () => {
  assert.equal((await api('/crm/kit', 'POST', { id: 'interior' }, T)).status, 200);
  ai.reply = { client: { name: 'Mr Shah', company: '', email: 'made-up@x.in' }, title: '3BHK interiors — Baner', intro: 'Thank you for choosing us.', items: [{ name: 'Modular kitchen', detail: 'L-shaped, BWP ply', qty: 1, price: 285000 }, { name: 'Wardrobes', detail: '3 rooms', qty: 3, price: 95000 }], addons: [{ name: 'False ceiling', detail: 'Living room', qty: 1, price: 65000 }], details: [{ label: 'Site', value: 'Baner, Pune' }], taxNote: 'Exclusive of GST @18%', deposit: 40, validDays: 21, terms: '1. 40% advance.' };
  assert.equal((await api('/quotes/ai', 'POST', { prompt: 'hi' }, T)).status, 400);
  const before = (await api('/quotes', 'GET', null, T)).data.length;
  const r = await api('/quotes/ai', 'POST', { prompt: '3BHK interiors for Mr Shah in Baner, modular kitchen and wardrobes, 40% advance' }, T);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const d = r.data.draft;
  assert.deepEqual([d.client.name, d.client.email, d.title, d.deposit, d.validDays, d.taxNote], ['Mr Shah', '', '3BHK interiors — Baner', 40, 21, 'Exclusive of GST @18%']);
  assert.deepEqual(d.items.map((i) => [i.name, i.qty, i.price, !!i.optional]), [['Modular kitchen', 1, 285000, false], ['Wardrobes', 3, 95000, false], ['False ceiling', 1, 65000, true]]);
  assert.match(ai.last.sys, /industry \(Interior designer \/ architect\)/);
  assert.match(ai.last.sys, /Example of a good quote in this industry/);
  assert.equal((await api('/quotes', 'GET', null, T)).data.length, before, 'nothing saved');
  // unpriced nonsense is refused rather than handed over half-made
  ai.reply = { title: 'x', items: [{ name: 'Something', qty: 1, price: 0 }] };
  assert.equal((await api('/quotes/ai', 'POST', { prompt: 'make me some kind of quote please' }, T)).status, 502);
});

test('a webinar’s set-up from a sentence: schedule, length, replay — checked for upcoming sessions, not saved', async () => {
  const f = (await api('/templates/w-ai/use', 'POST', {}, T)).data;
  await api(`/funnels/${f.id}`, 'PUT', { published: true }, T);
  await api(`/public/${f.slug}/sessions`);
  const w = (await api('/webinars', 'GET', null, T)).data.find((x) => x.funnelId === f.id);
  ai.reply = { name: 'Sunday Masterclass', duration: 75, schedule: { type: 'weekly', days: ['sun', 'wed', 'funday'], times: ['11:00', '19:00', '25:99'] }, replayHours: 48 };
  const r = await api(`/webinars/${w.id}/ai`, 'POST', { prompt: 'every Sunday 11 am and Wednesday 7 pm, 75 minutes, replay for 2 days' }, T);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.deepEqual([r.data.draft.name, r.data.draft.duration, r.data.draft.schedule.type, r.data.draft.schedule.days, r.data.draft.schedule.times, r.data.draft.replayHours], ['Sunday Masterclass', 75, 'weekly', ['sun', 'wed'], ['11:00', '19:00'], 48]);
  assert.equal(r.data.next.length, 3);
  assert.match(ai.last.sys, /Today is \d{4}-\d{2}-\d{2}/);
  assert.equal((await api('/webinars', 'GET', null, T)).data.find((x) => x.id === w.id).name, w.name, 'not saved');
  ai.reply = { schedule: { type: 'once', dates: ['2001-01-01T10:00'] } };
  assert.equal((await api(`/webinars/${w.id}/ai`, 'POST', { prompt: 'one session on the first of January 2001' }, T)).status, 502);
});

test('the inbox’s rules from a sentence: hours, away reply, reply-time alert, auto-close, labels — only what was asked changes', async () => {
  ai.reply = { hours: { on: true, days: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'xyz'], from: '10:00', to: '19:00', away: 'We’re closed — back at 10 am 🙏' }, sla: { on: true, minutes: 20, action: 'notify' }, labels: [{ word: 'Price', label: 'Pricing' }] };
  const r = await api('/inbox/rules/ai', 'POST', { prompt: 'open 10 to 7 Monday to Saturday, alert me if a chat waits 20 minutes, tag price messages as Pricing' }, T);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const d = r.data.draft;
  assert.deepEqual([d.hours.on, d.hours.days, d.hours.from, d.hours.to], [true, ['mon', 'tue', 'wed', 'thu', 'fri', 'sat'], '10:00', '19:00']);
  assert.deepEqual([d.sla.on, d.sla.minutes, d.resolve.on], [true, 20, false]);
  assert.deepEqual(d.labels, [{ word: 'price', label: 'Pricing' }]);
});
