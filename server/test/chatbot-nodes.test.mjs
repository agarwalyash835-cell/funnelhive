// Every chatbot step in real chats, end to end: a signed Hive WhatsApp webhook in, the messages WhatsApp accepted
// out (a fake Hive API), the contact updated, the seller's own API and webhook called, the AI answering (a fake
// AI), timers firing ("No reply", Wait), forms asked in the chat, "Go to chatbot", hand-over and "End".
// Steps: start, message (text / image / file), buttons, list, ask (text / email / number / location / file), form,
// condition, link, template, set, tag, api, webhook, hours, split, jump, goto, wait, ai_route, ai_reply, ai_agent,
// handoff, end.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import { startServer, register } from './helpers.mjs';

const KEY = 'hk_test_ok_supersecret_123';
const fake = { sent: [], hook: null, n: 0, calls: [], hooks: [] };
let hive, own, model, srv, api, T;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms = 6000) { for (let t = 0; t < ms; t += 50) { const v = await fn(); if (v) return v; await wait(50); } return fn(); }
const listen = (s) => new Promise((r) => s.listen(0, '127.0.0.1', r));
const body = (req) => new Promise((r) => { const parts = []; req.on('data', (d) => parts.push(d)); req.on('end', () => { const b = Buffer.concat(parts).toString(); r(b && /json/.test(req.headers['content-type'] || '') ? JSON.parse(b) : b); }); });

before(async () => {
  hive = http.createServer(async (req, res) => {
    const j = await body(req);
    const p = new URL(req.url, 'http://x').pathname.replace(/^\/wa\/v1/, '');
    const send = (s, o) => { res.writeHead(s, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
    if (req.headers.authorization !== `Bearer ${KEY}`) return send(401, { error: 'Invalid API key' });
    const route = `${req.method} ${p}`;
    if (route === 'GET /me') return send(200, { workspace_id: 'ws_1', prefix: 'hk_test_ok_sup' });
    if (route === 'GET /numbers') return send(200, { numbers: [{ id: 'ch_1', display: '919800000001', phone_number_id: '1111' }] });
    if (route === 'GET /templates') return send(200, { templates: [{ name: 'hello_offer', language: 'en', status: 'APPROVED', category: 'MARKETING', components: [{ type: 'BODY', text: 'Hi {{1}}, our new batch starts soon.' }] }] });
    if (route === 'PUT /webhooks') { fake.hook = j; return send(200, { ok: true }); }
    // like the real API: interactive messages in Hive's own shape only
    if (route === 'POST /messages' && j?.type === 'interactive' && !['buttons', 'list'].includes(j.interactive?.kind)) return send(400, { error: { code: 'INVALID_INPUT', message: 'interactive: Invalid input' } });
    if (route === 'POST /messages') { fake.sent.push(j); return send(202, { id: `msg_${++fake.n}`, status: 'queued' }); }
    if (route === 'POST /cloud/1111/messages') { fake.sent.push({ ...j, cloud: true }); return send(202, { id: `msg_${++fake.n}`, status: 'queued' }); }
    send(404, { error: 'not found' });
  });
  // the seller's own system: an order lookup, and a webhook that collects the answers
  own = http.createServer(async (req, res) => {
    const j = await body(req);
    if (req.url.startsWith('/hook')) fake.hooks.push(j); else fake.calls.push({ method: req.method, url: req.url, body: j });
    res.writeHead(req.url.startsWith('/down') ? 503 : 200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ order: { status: 'shipped', eta: '5 Nov' } }));
  });
  // the AI: topics by keyword; answers from the knowledge, a refund isn't something it's sure of
  model = http.createServer(async (req, res) => {
    const j = await body(req);
    const sys = String(j.instructions || ''), user = String(j.input?.at(-1)?.content || '');
    const last = user.split('\n').filter((l) => l.startsWith('Customer:')).at(-1) || user;
    let text = '{}';
    if (sys.includes('sort a customer')) { const msg = user.split('Message:').at(-1); text = JSON.stringify({ intent: /price|cost/i.test(msg) ? 'buy' : /refund|broken/i.test(msg) ? 'issue' : 'other' }); }
    else if (sys.includes('WhatsApp assistant')) text = /refund|broken/i.test(last) ? JSON.stringify({ reply: 'Let me get a team member for this.', handoff: true, reason: 'Refund request' })
      : JSON.stringify({ reply: 'The course is ₹1,999 for 6 weeks.', handoff: false, intent: 'pricing', lead: { name: '', email: '' } });
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ output: [{ type: 'message', content: [{ type: 'output_text', text }] }] }));
  });
  await listen(hive); await listen(own); await listen(model);
  srv = await startServer({ HIVE_WA_API_URL: `http://127.0.0.1:${hive.address().port}/wa/v1`, KIE_API_KEY: 'kie_test', KIE_BASE_URL: `http://127.0.0.1:${model.address().port}`, WA_INBOX_TICK_MS: '100', WA_RULE_MINUTE_MS: '300' });
  api = srv.api;
  T = (await register(api)).token;
  assert.equal((await api('/channels/whatsapp/hive', 'PUT', { apiKey: KEY }, T)).status, 200);
  assert.equal((await api('/channels/whatsapp/hive/webhook', 'POST', {}, T)).status, 200);
  await api('/wa-agent', 'PUT', { knowledge: 'Yoga course: ₹1,999, 6 weeks, online.' }, T);
});
after(async () => { await srv.stop(); hive.close(); own.close(); model.close(); });

async function hook(event, data) {
  const id = `whd_${crypto.randomUUID()}`, ts = Date.now();
  const raw = JSON.stringify({ id, event, created_at: new Date(ts).toISOString(), number: { id: 'ch_1', display: '919800000001', phone_number_id: '1111' }, data });
  const sig = `sha256=${crypto.createHmac('sha256', fake.hook.secret).update(raw).digest('hex')}`;
  const r = await fetch(srv.base + new URL(fake.hook.url).pathname, { method: 'POST', headers: { 'content-type': 'application/json', 'x-hive-signature': sig, 'x-hive-event': event, 'x-hive-delivery-id': id, 'x-hive-timestamp': String(ts) }, body: raw });
  assert.equal(r.status, 200);
}
const say = (from, text, extra = {}) => hook('message.inbound', { from, type: 'text', text, timestamp: new Date().toISOString(), ...extra });
const tap = (from, id, title) => hook('message.inbound', { from, type: 'interactive', text: title, interactive_id: id, timestamp: new Date().toISOString() });
const ownUrl = (path) => `http://127.0.0.1:${own.address().port}${path}`;
const N = (id, type, data = {}) => ({ id, type, x: 0, y: 0, data });
const E = (list) => list.map(([from, port, to]) => ({ from, port, to }));
// open chats first, then resolved ones (End can resolve the chat)
const convOf = async (num) => (await api('/inbox', 'GET', null, T)).data.convs.find((c) => c.num === num) || (await api('/inbox?filter=resolved', 'GET', null, T)).data.convs.find((c) => c.num === num);
// what the business sent (the inbox's own "we're closed" reply aside)
const outOf = async (num) => { const c = await convOf(num); return c ? (await api(`/inbox/${c.id}`, 'GET', null, T)).data.messages.filter((m) => m.dir === 'out' && !/closed right now/.test(m.text)) : []; };
const notesOf = async (num) => { const c = await convOf(num); return c ? (await api(`/inbox/${c.id}`, 'GET', null, T)).data.messages.filter((m) => m.dir === 'note').map((m) => m.text) : []; };
// waits until the chat has `n` messages from the business, then returns them
const outs = async (num, n) => { await waitFor(async () => (await outOf(num)).length >= n); return outOf(num); };
async function live(flow) {
  const f = (await api('/waflows', 'POST', { flow }, T)).data;
  assert.deepEqual(f.problems, [], `${flow.name}: ${JSON.stringify(f.problems)}`);
  assert.equal((await api(`/waflows/${f.id}`, 'PUT', { active: true }, T)).status, 200);
  return f;
}
const contact = async (num) => { const c = await convOf(num); return (await api(`/contacts/${encodeURIComponent(c.ckey)}`, 'GET', null, T)).data; };

test('message, tag, update contact, condition, buttons, list, ask (with a retry), link, template, webhook, API, hours, split, jump, end', async () => {
  const pipe = (await api('/pipelines', 'GET', null, T)).data[0];
  const flow = await live({ name: 'Every step', trigger: { type: 'keyword', keywords: ['tour'] }, nodes: [
    N('start', 'start'),
    N('m1', 'message', { text: 'Hi {{first_name}}! 👋' }),
    N('m2', 'message', { text: 'Our brochure', image: 'https://x.test/b.jpg' }),
    N('m3', 'message', { text: 'Price list', media: { type: 'document', url: 'https://x.test/prices.pdf', filename: 'prices.pdf' } }),
    N('t', 'tag', { add: ['vip', 'cold'] }),
    N('s', 'set', { actions: [{ do: 'var', key: 'city', value: 'Pune' }, { do: 'var', key: 'ref', value: 'a&b #1' }, { do: 'field', key: 'email', value: 'old@example.com' }, { do: 'untag', key: 'cold' }, { do: 'stage', key: pipe.id, value: pipe.stages[1].id }] }),
    N('c', 'condition', { match: 'all', rules: [{ field: 'tag', op: 'eq', value: 'vip' }, { field: 'var:city', op: 'eq', value: 'Pune' }] }),
    N('cno', 'end', { text: 'Condition took the wrong path' }),
    N('b', 'buttons', { text: 'Want the tour, {{first_name}}?', footer: 'Tap one', buttons: [{ id: 'y', title: 'Yes please' }, { id: 'n', title: 'No' }] }),
    N('bn', 'end', { text: 'Wrong button path' }),
    N('l', 'list', { text: 'Pick a day', button: 'Days', header: 'Tour days', rows: [{ id: 'mon', title: 'Monday' }, { id: 'tue', title: 'Tuesday', desc: 'Afternoon' }] }),
    N('lm', 'end', { text: 'Wrong row path' }),
    N('q', 'ask', { text: 'Your email for the confirmation?', var: 'mail', save: 'email', validate: 'email', retry: 'Hmm, that email looks off — try again?' }),
    N('k', 'link', { text: 'Your tour on {{l_choice}}', label: 'See the map', url: 'https://x.test/tour?d={{l_choice}}' }),
    N('tp', 'template', { name: 'hello_offer', language: 'en', params: ['{{first_name}}'], preview: 'Hi {{first_name}}, our new batch starts soon.' }),
    N('w', 'webhook', { url: ownUrl('/hook') }),
    N('a', 'api', { method: 'GET', url: ownUrl('/orders?mail={{mail}}&ref={{ref}}'), map: [{ var: 'status', path: 'order.status' }, { var: 'eta', path: 'order.eta' }] }),
    N('aok', 'message', { text: 'Order {{status}}, arriving {{eta}}' }),
    N('afail', 'end', { text: 'API took the wrong path' }),
    N('h', 'hours', {}),
    N('sp', 'split', { branches: [{ id: 'a', label: 'Offer A', weight: 50 }, { id: 'b', label: 'Offer B', weight: 50 }] }),
    N('j', 'jump', { nodeId: 'e' }),
    N('skipped', 'message', { text: 'Jump didn’t skip me' }),
    N('e', 'end', { text: 'See you on {{l_choice}}, {{first_name}}!', resolve: true }),
  ], edges: E([['start', 'next', 'm1'], ['m1', 'next', 'm2'], ['m2', 'next', 'm3'], ['m3', 'next', 't'], ['t', 'next', 's'], ['s', 'next', 'c'], ['c', 'yes', 'b'], ['c', 'no', 'cno'],
    ['b', 'y', 'l'], ['b', 'n', 'bn'], ['l', 'tue', 'q'], ['l', 'mon', 'lm'], ['q', 'next', 'k'], ['k', 'next', 'tp'], ['tp', 'next', 'w'], ['w', 'next', 'a'], ['a', 'ok', 'aok'], ['a', 'fail', 'afail'],
    ['aok', 'next', 'h'], ['h', 'open', 'sp'], ['h', 'closed', 'sp'], ['sp', 'a', 'j'], ['sp', 'b', 'j'], ['j', 'next', 'skipped'], ['skipped', 'next', 'e']]) });

  const num = '919700000101';
  await say(num, 'I want the tour', { contact_name: 'Asha Rao' });
  let o = await outs(num, 4);
  assert.deepEqual(o.map((m) => [m.type, m.text, m.status]), [['text', 'Hi Asha! 👋', 'sent'], ['image', 'Our brochure', 'sent'], ['document', 'Price list', 'sent'], ['interactive', 'Want the tour, Asha?', 'sent']]);
  assert.equal(o[1].media.link, 'https://x.test/b.jpg');
  assert.equal(o[2].media.filename, 'prices.pdf');
  assert.deepEqual(o[3].buttons, ['Yes please', 'No']);
  // with a footer it goes through Meta's pass-through (Hive's own shape has no footer)
  const sentButtons = fake.sent.filter((m) => m.to === num).at(-1);
  assert.deepEqual([sentButtons.cloud, sentButtons.interactive.footer.text, sentButtons.interactive.action.buttons.map((x) => x.reply.id)], [true, 'Tap one', ['y', 'n']]);
  // the contact: tags (one removed), field, stage
  let c = await contact(num);
  assert.deepEqual([c.tags.includes('vip'), c.tags.includes('cold'), c.email, c.stages[pipe.id]], [true, false, 'old@example.com', pipe.stages[1].id]);

  await tap(num, 'y', 'Yes please');
  o = await outs(num, 5);
  assert.deepEqual([o[4].type, o[4].text, o[4].list?.rows, o[4].status], ['interactive', 'Pick a day', ['Monday', 'Tuesday'], 'sent']);
  await say(num, '2'); // a row by its number
  o = await outs(num, 6);
  assert.equal(o[5].text, 'Your email for the confirmation?');
  await say(num, 'asha at example');
  o = await outs(num, 7);
  assert.equal(o[6].text, 'Hmm, that email looks off — try again?', 'the step’s own retry message');
  await say(num, 'asha@example.com');
  o = await outs(num, 11);
  assert.deepEqual(o.slice(7).map((m) => [m.type, m.text, m.status]), [
    ['interactive', 'Your tour on Tuesday\n\n🔗 See the map: https://x.test/tour?d=Tuesday', 'sent'], ['template', 'Hi Asha, our new batch starts soon.', 'sent'], ['text', 'Order shipped, arriving 5 Nov', 'sent'], ['text', 'See you on Tuesday, Asha!', 'sent']]);
  const cta = fake.sent.find((m) => m.to === num && m.interactive?.type === 'cta_url');
  assert.deepEqual(cta.interactive.action.parameters, { display_text: 'See the map', url: 'https://x.test/tour?d=Tuesday' });
  const tpl = fake.sent.find((m) => m.to === num && m.type === 'template');
  assert.equal(tpl.template.name, 'hello_offer');
  assert.match(JSON.stringify(tpl.template), /Asha/, 'the template’s {{1}} is filled');
  // the webhook got the answers; the API got the email
  const h = await waitFor(() => fake.hooks.find((x) => x.contact?.phone === `+${num}`));
  assert.deepEqual([h.event, h.answers.mail, h.answers.city, h.answers.l_choice], ['whatsapp.chatbot', 'asha@example.com', 'Pune', 'Tuesday']);
  assert.match(fake.calls.at(-1).url, /mail=asha%40example\.com/);
  c = await contact(num);
  assert.equal(c.email, 'asha@example.com', 'the question saved over the earlier value');
  // End resolved the chat; every step it went through is counted
  const conv = await convOf(num);
  assert.equal(conv.status, 'resolved');
  const f = (await api(`/waflows/${flow.id}`, 'GET', null, T)).data;
  for (const id of ['m1', 'm2', 'm3', 't', 's', 'c', 'b', 'l', 'q', 'k', 'tp', 'w', 'a', 'aok', 'h', 'sp', 'j', 'e']) assert.ok(f.stats.nodes[id] >= 1, `reached ${id}`);
  for (const id of ['cno', 'bn', 'lm', 'afail', 'skipped']) assert.ok(!f.stats.nodes[id], `never reached ${id}`);
  assert.deepEqual([f.stats.runs, f.stats.done], [1, 1]);
});

test('the other paths: condition "no", a button by its title, "Other", list row by tap, API "Didn’t work", the closed hours path', async () => {
  // business hours: closed every day
  assert.equal((await api('/inbox/rules', 'PUT', { hours: { on: true, days: [], from: '09:00', to: '18:00' } }, T)).status, 200);
  await live({ name: 'Paths', trigger: { type: 'keyword', keywords: ['paths'] }, nodes: [
    N('start', 'start'), N('c', 'condition', { match: 'any', rules: [{ field: 'tag', op: 'eq', value: 'nobody-has-this' }] }), N('cy', 'end', { text: 'wrong' }),
    N('b', 'buttons', { text: 'Pick', buttons: [{ id: 'x', title: 'Xray' }, { id: 'z', title: 'Zulu' }] }),
    N('b2', 'buttons', { text: 'Pick again', buttons: [{ id: 'x', title: 'Xray' }] }), N('oth', 'message', { text: 'That’s something else' }),
    N('l', 'list', { text: 'Row?', rows: [{ id: 'r1', title: 'One' }, { id: 'r2', title: 'Two' }] }),
    N('a', 'api', { method: 'POST', url: ownUrl('/down'), body: '{"x":1}' }), N('aok', 'end', { text: 'wrong api path' }), N('af', 'message', { text: 'API down' }),
    N('h', 'hours'), N('open', 'end', { text: 'wrong hours path' }), N('closed', 'end', { text: 'We’re closed' }),
  ], edges: E([['start', 'next', 'c'], ['c', 'yes', 'cy'], ['c', 'no', 'b'], ['b', 'z', 'b2'], ['b2', 'other', 'oth'], ['oth', 'next', 'l'], ['l', 'r1', 'a'], ['a', 'ok', 'aok'], ['a', 'fail', 'af'], ['af', 'next', 'h'], ['h', 'open', 'open'], ['h', 'closed', 'closed']]) });
  const num = '919700000102';
  await say(num, 'paths');
  await outs(num, 1);
  await say(num, 'zulu'); // the title, typed
  await outs(num, 2);
  await say(num, 'something random');
  await outs(num, 4);
  await tap(num, 'r1', 'One');
  const o = await outs(num, 6);
  assert.deepEqual(o.map((m) => m.text), ['Pick', 'Pick again', 'That’s something else', 'Row?', 'API down', 'We’re closed']);
  assert.ok((await notesOf(num)).some((t) => /API request didn’t work \(503\)/.test(t)), 'the team sees why');
  await api('/inbox/rules', 'PUT', { hours: { on: false } }, T);
});

test('timers: a question’s "No reply" path, then Wait, then on; an answer in time takes the normal path and no late nudge goes', async () => {
  await live({ name: 'Timers', trigger: { type: 'keyword', keywords: ['timer'] }, nodes: [
    N('start', 'start'), N('q', 'ask', { text: 'Your name?', var: 'nm', timeout: 1 }), N('nudge', 'message', { text: 'Still there?' }),
    N('w', 'wait', { minutes: 1 }), N('after', 'end', { text: 'Back after the wait' }), N('got', 'end', { text: 'Thanks {{nm}}' }),
  ], edges: E([['start', 'next', 'q'], ['q', 'timeout', 'nudge'], ['q', 'next', 'got'], ['nudge', 'next', 'w'], ['w', 'next', 'after']]) });
  const num = '919700000103';
  const t0 = Date.now();
  await say(num, 'timer');
  const o = await outs(num, 3);
  assert.deepEqual(o.map((m) => m.text), ['Your name?', 'Still there?', 'Back after the wait']);
  assert.ok(Date.now() - t0 >= 550, 'both timers waited their minute');
  // answering in time takes the normal path
  const num2 = '919700000104';
  await say(num2, 'timer');
  await outs(num2, 1);
  await say(num2, 'Ravi');
  assert.deepEqual((await outs(num2, 2)).map((m) => m.text), ['Your name?', 'Thanks Ravi']);
  await wait(800);
  assert.equal((await outOf(num2)).length, 2, 'no late nudge after the answer');
});

test('numbers as customers type them', async () => {
  const { numberOf } = await import('../wainbox.js');
  for (const [inp, want] of [['₹75,000', '75000'], ['about ₹75,000', '75000'], ['Rs. 50000', '50000'], ['50,000/-', '50000'], ['75k', '75000'], ['1.5 lakh', '150000'], ['2 cr', '20000000'], ['12,50,000', '1250000'], ['3', '3'], ['₹', null], ['not sure', null]]) assert.equal(numberOf(inp), want, inp);
});

test('ask: number, location and file questions; a form asked in the chat saves its answers', async () => {
  await live({ name: 'Questions', trigger: { type: 'keyword', keywords: ['quote'] }, nodes: [
    N('start', 'start'), N('n', 'ask', { text: 'Budget?', var: 'budget', validate: 'number' }), N('loc', 'ask', { text: 'Where?', var: 'where', validate: 'location' }),
    N('file', 'ask', { text: 'Send a photo of the site', var: 'pic', validate: 'file' }),
    N('f', 'form', { title: 'Details', text: 'A few details', fields: [{ id: 'nm', type: 'text', label: 'Your name', required: true, var: 'nm', save: 'name' }, { id: 'slot', type: 'radio', label: 'Time', required: true, var: 'slot', options: [{ id: 'm', title: 'Morning' }, { id: 'e', title: 'Evening' }] }] }),
    N('e', 'end', { text: '{{nm}}: {{budget}}, {{slot}}, {{where}}, {{pic}}' }),
  ], edges: E([['start', 'next', 'n'], ['n', 'next', 'loc'], ['loc', 'next', 'file'], ['file', 'next', 'f'], ['f', 'next', 'e']]) });
  const num = '919700000105';
  await say(num, 'quote');
  await outs(num, 1);
  await say(num, 'about ₹75,000');
  await outs(num, 2);
  await hook('message.inbound', { from: num, type: 'location', text: '[location]', location: { latitude: 18.52, longitude: 73.85, name: 'Site' }, timestamp: new Date().toISOString() });
  await outs(num, 3);
  await hook('message.inbound', { from: num, type: 'image', text: '', image: { id: 'media_9', mime_type: 'image/jpeg' }, timestamp: new Date().toISOString() });
  let o = await outs(num, 5);
  assert.deepEqual(o.slice(3).map((m) => m.text), ['A few details', '(1/2) Your name']);
  await say(num, 'Meera');
  o = await outs(num, 6);
  assert.deepEqual(o[5].buttons || o[5].list?.rows, ['Morning', 'Evening']);
  await tap(num, 'e', 'Evening');
  o = await outs(num, 7);
  assert.match(o[6].text, /^Meera: 75000, Evening, https:\/\/maps\.google\.com\/\?q=18\.52,73\.85 \(Site\), \[image/);
  assert.equal((await contact(num)).name, 'Meera', 'the form saved the name');
});

test('AI: the topic picks the path, "AI reply" answers then goes on, unsure → its path; the AI agent takes over; hand-over; go to chatbot', async () => {
  const person = await live({ name: 'Person', trigger: { type: 'manual' }, nodes: [N('start', 'start'), N('m', 'message', { text: 'Our team will call you about {{topic}}' }), N('h', 'handoff', { text: 'Connecting you now 🙏', note: 'Wants a call about {{topic}}' })],
    edges: E([['start', 'next', 'm'], ['m', 'next', 'h']]) });
  await live({ name: 'AI desk', trigger: { type: 'keyword', keywords: ['help'] }, nodes: [
    N('start', 'start'), N('r', 'ai_route', { intents: [{ id: 'buy', label: 'Price', desc: 'cost, fees' }, { id: 'issue', label: 'Problem' }] }),
    N('ar', 'ai_reply', { note: 'Short' }), N('more', 'message', { text: 'Anything else?' }), N('uns', 'end', { text: 'Unsure path' }),
    N('s', 'set', { actions: [{ do: 'var', key: 'topic', value: 'a problem' }] }), N('g', 'goto', { flowId: person.id }), N('agent', 'ai_agent', { note: 'Be brief' }),
  ], edges: E([['start', 'next', 'r'], ['r', 'buy', 'ar'], ['ar', 'next', 'more'], ['ar', 'unsure', 'uns'], ['r', 'issue', 's'], ['s', 'next', 'g'], ['r', 'other', 'agent']]) });

  const a = '919700000106';
  await say(a, 'help, what does it cost?');
  assert.deepEqual((await outs(a, 2)).map((m) => [m.text, m.status]), [['The course is ₹1,999 for 6 weeks.', 'sent'], ['Anything else?', 'sent']]);

  const b = '919700000107';
  await say(b, 'help, my order is broken');
  const ob = await outs(b, 2);
  assert.deepEqual(ob.map((m) => m.text), ['Our team will call you about a problem', 'Connecting you now 🙏'], 'went to the other chatbot with the answers, which handed over');
  const cb = await waitFor(async () => { const c = await convOf(b); return c.human && c; });
  assert.ok(cb.human, 'a person has the chat now');
  await say(b, 'hello?');
  await wait(400);
  assert.equal((await outOf(b)).length, 2, 'the bot stays quiet once a person has it');

  // a price question the AI isn't sure about (a refund): its "AI wasn't sure" path, nothing from the AI sent
  const u = '919700000109';
  await say(u, 'help, what does a refund cost?');
  assert.deepEqual((await outs(u, 1)).map((m) => m.text), ['Unsure path']);

  const c = '919700000108';
  await say(c, 'help me with the timings');
  const oc = await outs(c, 1);
  assert.equal(oc[0].text, 'The course is ₹1,999 for 6 weeks.', 'the AI agent answered');
  assert.equal((await convOf(c)).ai, true, 'and keeps the chat');
});
