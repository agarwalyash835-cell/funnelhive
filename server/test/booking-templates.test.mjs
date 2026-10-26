// Ready-made call types for every industry (your own first, its CRM effects explained), a call type drafted by AI
// from a sentence (cleaned, questions linked to CRM fields, nothing saved until created), and Hive AI creating a
// call type from an industry template or from scratch.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { startServer, register } from './helpers.mjs';

let srv, api, T, tok, model;
const ai = { last: null, reply: null };
const call = async (name, args) => {
  const r = await (await fetch(`${srv.base}/mcp`, { method: 'POST', headers: { authorization: `Bearer ${tok}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) })).json();
  const text = r.result?.content?.[0]?.text || '';
  if (r.result?.isError) return { error: text };
  try { return JSON.parse(text); } catch { return { text }; }
};
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
  tok = (await api('/hive/tokens', 'POST', { name: 'test' }, T)).data.token;
});
after(async () => { await srv.stop(); model.close(); });

test('every industry has a ready-made call type; your own comes first with what it does in your CRM', async () => {
  let d = (await api('/calendars/templates', 'GET', null, T)).data;
  assert.equal(d.templates.length, 19);
  assert.equal(d.templates[0].id, 'general', 'no CRM style yet: the coach & creator one first');
  assert.equal(d.templates[0].name, 'Discovery call');
  for (const x of d.templates) {
    assert.ok(x.name && x.duration >= 10 && x.industry && x.icon, x.id);
    assert.ok(Object.values(x.hours).some((w) => w.length), `${x.id} has hours`);
  }
  assert.ok(d.templates.find((x) => x.id === 'ngo').questions[0].options.includes('Volunteer'));
  assert.deepEqual(d.templates.find((x) => x.id === 'fitness').hours.mon, [['06:00', '10:00'], ['16:00', '20:00']]);
  // a real-estate CRM: its site visit first, questions saved into its fields, the stages it moves people through
  assert.equal((await api('/crm/kit', 'POST', { id: 'realestate' }, T)).status, 200);
  d = (await api('/calendars/templates', 'GET', null, T)).data;
  const re = d.templates[0];
  assert.deepEqual([re.id, re.mine, re.name, re.duration], ['realestate', true, 'Site visit', 45]);
  assert.deepEqual(re.questions.map((q) => [q.label, q.fieldId]), [['Property type', 're_type'], ['BHK', 're_bhk'], ['Preferred location', 're_location']]);
  assert.equal(re.questions[1].options.includes('2 BHK'), true);
  assert.deepEqual(re.crm, { kit: 'Real estate builder / broker', dateField: 'Site visit', booked: 'Site visit scheduled', done: 'Site visit done' });
  assert.equal(d.templates.find((x) => x.id === 'clinic').crm, null, 'another industry’s CRM effects aren’t claimed');
  // using one is creating a call type from it
  const { id, industry, icon, mine, crm, ...body } = re;
  const c = (await api('/calendars', 'POST', body, T)).data;
  assert.equal(c.name, 'Site visit');
  assert.equal(c.questions[0].fieldId, 're_type');
  assert.deepEqual(c.hours.sun, [['10:00', '18:00']], 'site visits on Sundays too');
});

test('Set up with AI: a sentence becomes a draft call type, cleaned, with questions linked to CRM fields', async () => {
  ai.reply = { name: 'Free site visit', duration: 30, description: 'See the project in person.', location: 'Wakad project site', hours: { mon: [['10:00', '18:00']], sat: [['10:00', '18:00']], sun: [['10:00', '18:00']], tue: [['25:00', '99:00']] }, buffer: 15, noticeHours: 2, daysAhead: 30, perDay: 8, price: 0, currency: 'INR', timezone: 'Mars/Olympus', questions: [{ label: 'BHK', type: 'select', required: true, options: ['2 BHK', '3 BHK'] }, { label: 'Your budget', type: 'text' }] };
  assert.equal((await api('/calendars/ai', 'POST', { prompt: 'hi' }, T)).status, 400);
  const before = (await api('/calendars', 'GET', null, T)).data.length;
  const r = await api('/calendars/ai', 'POST', { prompt: 'Free 30 min site visits all week 10 to 6, ask BHK and budget' }, T);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const dr = r.data.draft;
  assert.deepEqual([dr.name, dr.duration, dr.location, dr.perDay, dr.buffer], ['Free site visit', 30, 'Wakad project site', 8, 15]);
  assert.deepEqual(dr.hours.tue, [], 'impossible hours dropped');
  assert.equal(dr.timezone, undefined, 'a made-up time zone is dropped');
  assert.equal(dr.questions[0].fieldId, 're_bhk', 'a question named like a CRM field saves into it');
  assert.equal(dr.questions[1].fieldId, undefined);
  assert.equal(dr.slug, undefined);
  assert.equal((await api('/calendars', 'GET', null, T)).data.length, before, 'nothing saved until the seller creates it');
  assert.match(ai.last.user, /Industry: Real estate builder \/ broker — their usual booking: Site visit, 45 min/);
  assert.match(ai.last.user, /BHK \(1 RK, 1 BHK/);
  const c = (await api('/calendars', 'POST', dr, T)).data;
  assert.equal(c.name, 'Free site visit');
});

test('Hive AI creates a call type from an industry template (with changes) or from scratch', async () => {
  const r = await call('create_calendar', { template: 'clinic', duration: 15, price: 300 });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual([r.name, r.duration, r.price], ['Appointment', 15, 300]);
  assert.match(r.link, /^\/meet\/[\w-]+\/appointment$/);
  assert.deepEqual(r.questions, ['Concern / reason for visit', 'Gender']);
  const own = await call('create_calendar', { name: 'Kitchen design consult', duration: 40, hours: { sat: [['11:00', '15:00']] } });
  assert.equal(own.name, 'Kitchen design consult');
  assert.match((await call('create_calendar', { template: 'nope' })).error, /No ready-made call type/);
  assert.match((await call('create_calendar', {})).error, /name/);
  const cals = (await api('/calendars', 'GET', null, T)).data.map((c) => c.name);
  assert.ok(cals.includes('Appointment') && cals.includes('Kitchen design consult'));
});
