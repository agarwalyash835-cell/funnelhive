// The chatbot builder's newer steps against a fake Hive WhatsApp API and a fake "seller's own" API: link buttons,
// update contact (variables, fields, tags, stages, opt-out), API requests with their answer saved, business hours,
// random split, go to another chatbot, "no reply" paths, location / file questions, long waits that need a template,
// and the "reached" count on every step.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import { startServer, register } from './helpers.mjs';

const KEY = 'hk_test_ok_supersecret_123';
const fake = { sent: [], hook: null, n: 0, calls: [] };
let hive, own, srv, api, T;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms = 5000) { for (let t = 0; t < ms; t += 50) { const v = await fn(); if (v) return v; await wait(50); } return fn(); }
const listen = (s) => new Promise((r) => s.listen(0, '127.0.0.1', r));
const body = (req) => new Promise((r) => { const parts = []; req.on('data', (d) => parts.push(d)); req.on('end', () => { const b = Buffer.concat(parts).toString(); r(b && /json/.test(req.headers['content-type'] || '') ? JSON.parse(b) : b); }); });
const sentTo = (num) => fake.sent.filter((m) => m.to === num);

before(async () => {
  hive = http.createServer(async (req, res) => {
    const j = await body(req);
    const p = new URL(req.url, 'http://x').pathname.replace(/^\/wa\/v1/, '');
    const send = (s, o) => { res.writeHead(s, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
    const route = `${req.method} ${p}`;
    if (route === 'GET /me') return send(200, { workspace_id: 'ws_1', prefix: 'hk_test_ok_sup' });
    if (route === 'GET /numbers') return send(200, { numbers: [{ id: 'ch_1', display: '919800000001', phone_number_id: '1111' }] });
    if (route === 'GET /templates') return send(200, { templates: [] });
    if (route === 'PUT /webhooks') { fake.hook = j; return send(200, { ok: true }); }
    if (route === 'POST /messages') { fake.sent.push(j); return send(202, { id: `msg_${++fake.n}`, status: 'queued' }); }
    if (route === 'POST /cloud/1111/messages') { fake.sent.push({ ...j, cloud: true }); return send(202, { id: `msg_${++fake.n}`, status: 'queued' }); }
    send(404, { error: 'not found' });
  });
  // the seller's own system: order status by phone
  own = http.createServer(async (req, res) => {
    const j = await body(req);
    fake.calls.push({ method: req.method, url: req.url, auth: req.headers.authorization, body: j });
    res.writeHead(req.url.startsWith('/down') ? 500 : 200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ order: { status: 'shipped', items: [{ name: 'Blue kurta' }] } }));
  });
  await listen(hive); await listen(own);
  srv = await startServer({ HIVE_WA_API_URL: `http://127.0.0.1:${hive.address().port}/wa/v1`, WA_INBOX_TICK_MS: '150' });
  api = srv.api;
  T = (await register(api)).token;
  assert.equal((await api('/channels/whatsapp/hive', 'PUT', { apiKey: KEY }, T)).status, 200);
  assert.equal((await api('/channels/whatsapp/hive/webhook', 'POST', {}, T)).status, 200);
});
after(async () => { await srv.stop(); hive.close(); own.close(); });

async function hook(event, data) {
  const id = `whd_${crypto.randomUUID()}`, ts = Date.now();
  const raw = JSON.stringify({ id, event, created_at: new Date(ts).toISOString(), number: { id: 'ch_1', display: '919800000001', phone_number_id: '1111' }, data });
  const sig = `sha256=${crypto.createHmac('sha256', fake.hook.secret).update(raw).digest('hex')}`;
  const r = await fetch(srv.base + new URL(fake.hook.url).pathname, { method: 'POST', headers: { 'content-type': 'application/json', 'x-hive-signature': sig, 'x-hive-event': event, 'x-hive-delivery-id': id, 'x-hive-timestamp': String(ts) }, body: raw });
  assert.equal(r.status, 200);
}
const say = (from, text) => hook('message.inbound', { from, type: 'text', text, timestamp: new Date().toISOString() });
const ownUrl = (path) => `http://127.0.0.1:${own.address().port}${path}`;
const node = (id, type, data, x = 0) => ({ id, type, x, y: 0, data });
const sim = async (flow, extra = {}) => (await api('/waflows/simulate', 'POST', { flow, name: 'Asha Rao', ...extra }, T)).data;

test('API request: the answer is saved into variables and the "Worked" path runs; a failing API takes "Didn’t work"', async () => {
  const flow = {
    trigger: { type: 'keyword', keywords: ['track'] },
    nodes: [node('start', 'start', {}), node('a', 'api', { method: 'POST', url: ownUrl('/orders?phone={{phone}}'), headers: [{ key: 'Authorization', value: 'Bearer s3cret' }], body: '{"name":"{{first_name}}","note":"{{note}}"}', map: [{ var: 'status', path: 'order.status' }, { var: 'item', path: 'order.items.0.name' }] }),
      node('ok', 'message', { text: 'Your {{item}} is {{status}} 🚚' }), node('bad', 'message', { text: 'Can’t check right now' }), node('s', 'set', { actions: [{ do: 'var', key: 'note', value: 'He said "hi"' }] })],
    edges: [{ from: 'start', port: 'next', to: 's' }, { from: 's', port: 'next', to: 'a' }, { from: 'a', port: 'ok', to: 'ok' }, { from: 'a', port: 'fail', to: 'bad' }],
  };
  let r = await sim(flow, { input: { text: 'track' } });
  assert.equal(r.out[0].text, 'Your Blue kurta is shipped 🚚');
  const call = fake.calls.at(-1);
  assert.equal(call.method, 'POST');
  assert.match(call.url, /phone=%2B919800000000|phone=\+919800000000/);
  assert.equal(call.auth, 'Bearer s3cret');
  assert.deepEqual(call.body, { name: 'Asha', note: 'He said "hi"' }, 'answers go into the JSON safely');
  flow.nodes[1].data.url = ownUrl('/down');
  r = await sim(flow, { input: { text: 'track' } });
  assert.equal(r.out[0].text, 'Can’t check right now');
  assert.equal(r.fx.find((e) => e.type === 'api').status, 500);
});

test('link buttons, conditions on numbers, random split, business hours, location and file questions', async () => {
  const flow = {
    trigger: { type: 'keyword', keywords: ['hi'] },
    nodes: [node('start', 'start', {}), node('q', 'ask', { text: 'Your budget?', var: 'budget', validate: 'number' }), node('c', 'condition', { match: 'all', rules: [{ field: 'var:budget', op: 'gt', value: '50000' }] }),
      node('l', 'link', { text: 'Book your site visit, {{first_name}}', label: 'Book now', url: 'https://x.test/meet/{{budget}}' }), node('sp', 'split', { branches: [{ id: 'a', label: 'Offer A', weight: 50 }, { id: 'b', label: 'Offer B', weight: 50 }] }),
      node('h', 'hours', {}), node('m1', 'message', { text: 'A' }), node('m2', 'message', { text: 'B' }), node('loc', 'ask', { text: 'Share your location', var: 'where', validate: 'location' }), node('end', 'end', { text: 'Thanks' })],
    edges: [{ from: 'start', port: 'next', to: 'q' }, { from: 'q', port: 'next', to: 'c' }, { from: 'c', port: 'yes', to: 'l' }, { from: 'c', port: 'no', to: 'sp' }, { from: 'l', port: 'next', to: 'h' },
      { from: 'sp', port: 'a', to: 'm1' }, { from: 'sp', port: 'b', to: 'm2' }, { from: 'h', port: 'open', to: 'loc' }, { from: 'h', port: 'closed', to: 'loc' }, { from: 'loc', port: 'next', to: 'end' }],
  };
  let r = await sim(flow, { input: { text: 'hi' } });
  r = await sim(flow, { state: r.state, input: { text: '₹75,000' } });
  assert.deepEqual([r.out[0].kind, r.out[0].text, r.out[0].cta], ['cta', 'Book your site visit, Asha', { label: 'Book now', url: 'https://x.test/meet/75000' }]);
  assert.equal(r.out.at(-1).text, 'Share your location', 'business hours took a path either way');
  let r2 = await sim(flow, { state: r.state, input: { text: 'Andheri' } });
  assert.match(r2.out[0].text, /share your location/i, 'typed text isn’t a location');
  r2 = await sim(flow, { state: r.state, input: { location: true } });
  assert.equal(r2.out[0].text, 'Thanks');
  // a low budget → the A/B split picks one of its paths
  r = await sim(flow, { input: { text: 'hi' } });
  r = await sim(flow, { state: r.state, input: { text: '20000' } });
  assert.ok(['A', 'B'].includes(r.out[0].text));
  assert.ok(['Offer A', 'Offer B'].includes(r.fx.find((e) => e.type === 'split').label));
  assert.ok(r.seen.includes('sp'), 'the steps it went through come back');
});

test('"No reply" path: only when the step has a time limit; long waits need a template next', async () => {
  const flow = {
    name: 'Nudge', trigger: { type: 'keyword', keywords: ['offer'] },
    nodes: [node('start', 'start', {}), node('b', 'buttons', { text: 'Want the offer?', image: 'https://x.test/p.jpg', footer: 'Reply STOP to opt out', buttons: [{ id: 'y', title: 'Yes' }], timeout: 30 }), node('n', 'message', { text: 'Still there? 🙂' }), node('y', 'message', { text: 'Great!' })],
    edges: [{ from: 'start', port: 'next', to: 'b' }, { from: 'b', port: 'y', to: 'y' }, { from: 'b', port: 'timeout', to: 'n' }],
  };
  let r = await sim(flow, { input: { text: 'offer' } });
  assert.equal(r.out[0].image, 'https://x.test/p.jpg');
  assert.ok(r.state.until > Date.now() + 29 * 60000, 'waits with a time limit');
  r = await sim(flow, { state: r.state, input: { timeout: true } });
  assert.equal(r.out[0].text, 'Still there? 🙂');
  // saved: the timeout edge stays; without a time limit it's dropped
  let f = (await api('/waflows', 'POST', { flow }, T)).data;
  assert.ok(f.edges.some((e) => e.port === 'timeout'));
  f = (await api(`/waflows/${f.id}`, 'PUT', { nodes: flow.nodes.map((x) => (x.id === 'b' ? { ...x, data: { ...x.data, timeout: 0 } } : x)), edges: flow.edges }, T)).data;
  assert.ok(!f.edges.some((e) => e.port === 'timeout'));
  // a 2-day wait followed by a plain message can't go live
  const long = { ...flow, nodes: [...flow.nodes, node('w', 'wait', { minutes: 2880 }), node('t', 'template', { name: 'hello_offer', params: ['{{first_name}}'] })], edges: [...flow.edges.filter((e) => e.from !== 'b' || e.port !== 'y'), { from: 'b', port: 'y', to: 'w' }, { from: 'w', port: 'next', to: 'y' }] };
  f = (await api('/waflows', 'POST', { flow: long }, T)).data;
  assert.ok(f.problems.some((p) => /template/.test(p.msg)));
  f = (await api(`/waflows/${f.id}`, 'PUT', { nodes: long.nodes, edges: long.edges.map((e) => (e.from === 'w' ? { ...e, to: 't' } : e)) }, T)).data;
  assert.ok(!f.problems.some((p) => /template/.test(p.msg)));
});

test('a real chat: link button, update contact (field, tag removed, stage, opt-out), go to another chatbot, reached counts', async () => {
  const pipe = (await api('/pipelines', 'GET', null, T)).data[0];
  const second = (await api('/waflows', 'POST', { flow: { name: 'Second', trigger: { type: 'manual' }, nodes: [node('start', 'start', {}), node('m', 'message', { text: 'Hello from the second bot, {{city}}' }), node('o', 'set', { actions: [{ do: 'optout' }] })], edges: [{ from: 'start', port: 'next', to: 'm' }, { from: 'm', port: 'next', to: 'o' }] } }, T)).data;
  const flow = (await api('/waflows', 'POST', { flow: {
    name: 'Main', trigger: { type: 'keyword', keywords: ['join'] },
    nodes: [node('start', 'start', {}), node('t', 'tag', { add: ['cold'] }), node('s', 'set', { actions: [{ do: 'field', key: 'email', value: 'asha@example.com' }, { do: 'untag', key: 'cold' }, { do: 'stage', key: pipe.id, value: pipe.stages[1].id }, { do: 'var', key: 'city', value: 'Pune' }] }),
      node('l', 'link', { text: 'Pay here', label: 'Pay ₹999', url: 'https://x.test/pay' }), node('g', 'goto', { flowId: second.id })],
    edges: [{ from: 'start', port: 'next', to: 't' }, { from: 't', port: 'next', to: 's' }, { from: 's', port: 'next', to: 'l' }, { from: 'l', port: 'next', to: 'g' }],
  } }, T)).data;
  assert.deepEqual(flow.problems, []);
  assert.equal((await api(`/waflows/${flow.id}`, 'PUT', { active: true }, T)).status, 200);
  await say('919700000077', 'join');
  const link = await waitFor(() => sentTo('919700000077').find((m) => m.interactive?.type === 'cta_url'));
  assert.equal(link.cloud, true);
  assert.deepEqual(link.interactive.action.parameters, { display_text: 'Pay ₹999', url: 'https://x.test/pay' });
  const next = await waitFor(() => sentTo('919700000077').find((m) => /second bot/.test(m.text?.body || '')));
  assert.equal(next.text.body, 'Hello from the second bot, Pune', 'the answers carry over');
  const conv = (await api('/inbox', 'GET', null, T)).data.convs.find((c) => c.num === '919700000077');
  const c = (await api(`/contacts/${encodeURIComponent(conv.ckey)}`, 'GET', null, T)).data;
  assert.equal(c.email, 'asha@example.com');
  assert.ok(!c.tags.includes('cold'), 'tag removed');
  assert.equal(c.stages[pipe.id], pipe.stages[1].id);
  assert.ok(await waitFor(async () => (await api(`/contacts/${encodeURIComponent(conv.ckey)}`, 'GET', null, T)).data.timeline.some((a) => /Unsubscribed/.test(a.title))), 'opted out by the second bot');
  const f = (await api(`/waflows/${flow.id}`, 'GET', null, T)).data;
  assert.deepEqual([f.stats.runs, f.stats.nodes.s, f.stats.nodes.l], [1, 1, 1]);
});
