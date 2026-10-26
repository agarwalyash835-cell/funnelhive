// WhatsApp forms (Meta WhatsApp Flows) in chatbots, against a fake Hive WhatsApp API and a fake Meta Graph API:
// without a Meta connection the form node asks its questions one by one and saves the answers; with one, the
// form is turned into Flow JSON and published, goes out as an interactive flow message through Hive, and the
// customer's nfm_reply saves the answers to the contact (CRM fields, timeline) and moves the chatbot on.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import { startServer, register } from './helpers.mjs';

const KEY = 'hk_test_ok_supersecret_123';
const fake = { sent: [], hook: null, n: 0, cloudFails: false };
const meta = { calls: [], n: 0 };
let hive, graph, srv, api, T;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms = 5000) { for (let t = 0; t < ms; t += 50) { const v = await fn(); if (v) return v; await wait(50); } return fn(); }
const sentTo = (num) => fake.sent.filter((m) => m.to === num);
const listen = (s) => new Promise((r) => s.listen(0, '127.0.0.1', r));
const body = (req) => new Promise((r) => { const parts = []; req.on('data', (d) => parts.push(d)); req.on('end', () => { const b = Buffer.concat(parts); r(/json/.test(req.headers['content-type'] || '') && b.length ? JSON.parse(b) : b); }); });

before(async () => {
  hive = http.createServer(async (req, res) => {
    const j = await body(req);
    const p = new URL(req.url, 'http://x').pathname.replace(/^\/wa\/v1/, '');
    const send = (s, o) => { res.writeHead(s, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
    if (req.headers.authorization !== `Bearer ${KEY}`) return send(401, { error: 'Invalid API key' });
    const route = `${req.method} ${p}`;
    if (route === 'GET /me') return send(200, { workspace_id: 'ws_1', prefix: 'hk_test_ok_sup' });
    if (route === 'GET /numbers') return send(200, { numbers: [{ id: 'ch_1', display: '919800000001', phone_number_id: '1111' }] });
    if (route === 'GET /templates') return send(200, { templates: [] });
    if (route === 'PUT /webhooks') { fake.hook = j; return send(200, { ok: true }); }
    if (route === 'POST /messages') { fake.sent.push(j); return send(202, { id: `msg_${++fake.n}`, status: 'queued' }); }
    if (req.method === 'POST' && /^\/cloud\/[^/]+\/messages$/.test(p)) {
      if (fake.cloudFails) return send(400, { error: 'Flow not available for this number' });
      fake.sent.push({ ...j, cloud: true }); return send(202, { id: `msg_${++fake.n}`, status: 'queued' });
    }
    send(404, { error: 'not found' });
  });
  // Meta's Graph API: flows are created, get their JSON, and are published
  graph = http.createServer(async (req, res) => {
    const raw = await body(req);
    const p = new URL(req.url, 'http://x').pathname;
    meta.calls.push({ method: req.method, path: p, auth: req.headers.authorization, type: req.headers['content-type'] || '', body: Buffer.isBuffer(raw) ? raw.toString('utf8') : raw });
    const send = (s, o) => { res.writeHead(s, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
    if (req.headers.authorization !== 'Bearer EAAtesttoken') return send(401, { error: { message: 'Invalid OAuth access token' } });
    if (req.method === 'POST' && p === '/555000111/flows') return send(200, { id: `9000${++meta.n}` });
    if (req.method === 'POST' && /^\/9000\d+\/assets$/.test(p)) return send(200, { success: true, validation_errors: [] });
    if (req.method === 'POST' && /^\/9000\d+\/publish$/.test(p)) return send(200, { success: true });
    send(404, { error: { message: 'Unknown path' } });
  });
  await listen(hive); await listen(graph);
  srv = await startServer({ HIVE_WA_API_URL: `http://127.0.0.1:${hive.address().port}/wa/v1`, WHATSAPP_GRAPH_URL: `http://127.0.0.1:${graph.address().port}`, WA_INBOX_TICK_MS: '150' });
  api = srv.api;
  T = (await register(api)).token;
  assert.equal((await api('/channels/whatsapp/hive', 'PUT', { apiKey: KEY }, T)).status, 200);
  assert.equal((await api('/channels/whatsapp/hive/webhook', 'POST', {}, T)).status, 200);
});
after(async () => { await srv.stop(); hive.close(); graph.close(); });

async function hook(event, data) {
  const id = `whd_${crypto.randomUUID()}`, ts = Date.now();
  const raw = JSON.stringify({ id, event, created_at: new Date(ts).toISOString(), number: { id: 'ch_1', display: '919800000001', phone_number_id: '1111' }, data });
  const sig = `sha256=${crypto.createHmac('sha256', fake.hook.secret).update(raw).digest('hex')}`;
  const r = await fetch(srv.base + new URL(fake.hook.url).pathname, { method: 'POST', headers: { 'content-type': 'application/json', 'x-hive-signature': sig, 'x-hive-event': event, 'x-hive-delivery-id': id, 'x-hive-timestamp': String(ts) }, body: raw });
  assert.equal(r.status, 200);
}
const say = (from, text, extra = {}) => hook('message.inbound', { from, type: 'text', text, timestamp: new Date().toISOString(), ...extra });
const convOf = async (num) => (await api('/inbox', 'GET', null, T)).data.convs.find((c) => c.num === num);
const detail = async (id) => (await api(`/inbox/${id}`, 'GET', null, T)).data;
const bodyOf = (m) => m.text?.body || m.interactive?.body?.text || '';

let budgetField;
const FORM = () => ({
  text: 'Hi {{first_name}}! Book your site visit 👇', title: 'Book a site visit', cta: 'Book visit', submit: 'Book my visit',
  fields: [
    { id: 'name', type: 'text', label: 'Your name', required: true, var: 'name', save: 'name' },
    { id: 'email', type: 'email', label: 'Email', required: true, var: 'email', save: 'email' },
    { id: 'slot', type: 'radio', label: 'Preferred time', required: true, var: 'slot', options: [{ id: 'm', title: 'Morning' }, { id: 'e', title: 'Evening' }] },
    { id: 'budget', type: 'dropdown', label: 'Budget', var: 'budget', save: `custom:${budgetField}`, options: [{ id: 'lo', title: 'Under ₹50 lakh' }, { id: 'hi', title: 'Above ₹50 lakh' }] },
    { id: 'notes', type: 'long', label: 'Anything else?', var: 'notes' },
  ],
});
async function makeBot(keyword) {
  const flow = { name: 'Site visits', trigger: { type: 'keyword', keywords: [keyword] }, nodes: [
    { id: 'start', type: 'start' }, { id: 'f', type: 'form', data: FORM() },
    { id: 'end', type: 'end', data: { text: 'Thanks {{first_name}}! See you in the {{slot}} ({{budget}}).' } },
  ], edges: [{ from: 'start', port: 'next', to: 'f' }, { from: 'f', port: 'next', to: 'end' }] };
  const f = (await api('/waflows', 'POST', { flow }, T)).data;
  assert.deepEqual(f.problems, [], JSON.stringify(f.problems));
  assert.equal((await api(`/waflows/${f.id}`, 'PUT', { active: true }, T)).status, 200);
  return f;
}

test('without a Meta connection the form asks its questions one by one, checks them and saves the answers', async () => {
  const fields = (await api('/crm/fields', 'PUT', { fields: [{ label: 'Budget', type: 'text' }] }, T)).data;
  budgetField = fields.find((x) => x.label === 'Budget')?.id;
  assert.ok(budgetField, JSON.stringify(fields));
  const f = await makeBot('sitevisit');
  assert.equal(f.forms.f, false, 'not published');
  assert.equal((await api('/waflows', 'GET', null, T)).data.meta, false);
  const pub = await api(`/waflows/${f.id}/forms/f/publish`, 'POST', {}, T);
  assert.equal(pub.status, 400);
  assert.match(pub.data.error, /direct Meta connection/);

  const num = '919700000101';
  await say(num, 'sitevisit');
  await waitFor(() => sentTo(num).length === 2);
  assert.match(bodyOf(sentTo(num)[0]), /Book your site visit/);
  assert.match(bodyOf(sentTo(num)[1]), /\(1\/5\) Your name/);
  await say(num, 'Kiran Rao');
  await waitFor(() => sentTo(num).length === 3);
  await say(num, 'not an email');
  await waitFor(() => sentTo(num).length === 4);
  assert.match(bodyOf(sentTo(num)[3]), /doesn’t look like an email/);
  await say(num, 'kiran@x.in');
  await waitFor(() => sentTo(num).length === 5);
  const choose = sentTo(num)[4];
  assert.equal(choose.interactive.type, 'button', 'two choices go as buttons');
  assert.deepEqual(choose.interactive.action.buttons.map((b) => b.reply.title), ['Morning', 'Evening']);
  await hook('message.inbound', { from: num, type: 'interactive', text: 'Evening', interactive_id: 'e', interactive_title: 'Evening' });
  await waitFor(() => sentTo(num).length === 6);
  assert.match(bodyOf(sentTo(num)[5]), /Budget — or reply \*skip\*/);
  await say(num, '1');
  await waitFor(() => sentTo(num).length === 7);
  await say(num, 'skip');
  await waitFor(() => sentTo(num).length === 8);
  assert.equal(bodyOf(sentTo(num)[7]), 'Thanks Kiran! See you in the Evening (Under ₹50 lakh).');

  const c = await convOf(num);
  assert.equal(c.bot, null);
  const d = await detail(c.id);
  assert.equal(d.contact.name, 'Kiran Rao');
  assert.equal(d.contact.email, 'kiran@x.in');
  const ct = (await api(`/contacts/${encodeURIComponent(d.contact.key)}`, 'GET', null, T)).data;
  assert.equal(ct.custom?.[budgetField], 'Under ₹50 lakh', JSON.stringify(ct.custom));
  assert.ok(JSON.stringify(ct.timeline).includes('Filled WhatsApp form: Book a site visit'));
});

test('with Meta: the form is published as Flow JSON, sent as a flow message, and the reply saves and continues', async () => {
  // the seller's direct Meta details (Hive stays the provider for the inbox)
  assert.equal((await api('/channels/whatsapp', 'PUT', { phoneNumberId: '111122223333', businessId: '555000111', token: 'EAAtesttoken' }, T)).status, 200);
  assert.equal((await api('/waflows', 'GET', null, T)).data.meta, true);
  const f = await makeBot('book visit');
  const pub = await api(`/waflows/${f.id}/forms/f/publish`, 'POST', {}, T);
  assert.equal(pub.status, 200, JSON.stringify(pub.data));
  const node = pub.data.nodes.find((n) => n.id === 'f');
  assert.match(node.data.flowId, /^9000\d+$/);
  assert.equal(pub.data.forms.f, true);
  const [create, asset, publish] = meta.calls.slice(-3);
  assert.equal(create.path, '/555000111/flows');
  assert.ok(create.body.categories.includes('LEAD_GENERATION'));
  assert.equal(asset.path, `/${node.data.flowId}/assets`);
  assert.match(asset.type, /multipart\/form-data/);
  assert.match(asset.body, /name="asset_type"\r\n\r\nFLOW_JSON/);
  const json = JSON.parse(asset.body.slice(asset.body.indexOf('{"version"'), asset.body.lastIndexOf('}') + 1));
  assert.equal(json.version, '7.3');
  const scr = json.screens[0];
  assert.equal(scr.terminal, true);
  assert.deepEqual(scr.layout.children.map((x) => x.type), ['TextInput', 'TextInput', 'RadioButtonsGroup', 'Dropdown', 'TextArea', 'Footer']);
  assert.equal(scr.layout.children[1]['input-type'], 'email');
  assert.deepEqual(scr.layout.children[2]['data-source'], [{ id: 'm', title: 'Morning' }, { id: 'e', title: 'Evening' }]);
  assert.equal(scr.layout.children.at(-1)['on-click-action'].name, 'complete');
  assert.equal(scr.layout.children.at(-1)['on-click-action'].payload.slot, '${form.slot}');
  assert.equal(publish.path, `/${node.data.flowId}/publish`);
  // publishing again with nothing changed doesn't make another flow
  const n0 = meta.calls.length;
  assert.equal((await api(`/waflows/${f.id}/forms/f/publish`, 'POST', {}, T)).status, 200);
  assert.equal(meta.calls.length, n0);

  const num = '919700000102';
  await say(num, 'book visit', { contact_name: 'Neha' });
  await waitFor(() => sentTo(num).length === 1);
  const m = sentTo(num)[0];
  assert.equal(m.cloud, true, 'goes through Hive’s Cloud API pass-through');
  assert.equal(m.type, 'interactive');
  assert.equal(m.interactive.type, 'flow');
  const prm = m.interactive.action.parameters;
  assert.equal(prm.flow_id, node.data.flowId);
  assert.equal(prm.flow_cta, 'Book visit');
  assert.equal(prm.flow_action, 'navigate');
  assert.deepEqual(prm.flow_action_payload, { screen: 'FORM' });
  assert.match(m.interactive.body.text, /Hi Neha!/);
  assert.match(prm.flow_token, /^fh1\./);

  // a forged token is shown, never trusted
  await hook('message.inbound', { from: num, type: 'interactive', text: '', interactive: { type: 'nfm_reply', nfm_reply: { name: 'flow', body: 'Sent', response_json: JSON.stringify({ flow_token: prm.flow_token.slice(0, -3) + 'abc', name: 'Hacker' }) } } });
  await wait(300);
  assert.equal(sentTo(num).length, 1);

  await hook('message.inbound', { from: num, type: 'interactive', text: '', interactive: { type: 'nfm_reply', nfm_reply: { name: 'flow', body: 'Sent', response_json: JSON.stringify({ flow_token: prm.flow_token, name: 'Neha Gupta', email: 'NEHA@x.in', slot: 'm', budget: 'hi', notes: 'Corner flat please' }) } } });
  await waitFor(() => sentTo(num).length === 2);
  assert.equal(bodyOf(sentTo(num)[1]), 'Thanks Neha! See you in the Morning (Above ₹50 lakh).');
  const c = await convOf(num);
  const d = await detail(c.id);
  assert.equal(d.contact.name, 'Neha Gupta');
  assert.equal(d.contact.email, 'neha@x.in');
  const shown = d.messages.filter((x) => x.dir === 'in' && x.type === 'form');
  assert.equal(shown.length, 2);
  assert.equal(shown[0].form.title, 'Form', 'the forged reply shows its raw answers only');
  assert.equal(shown[1].form.title, 'Book a site visit');
  assert.deepEqual(shown[1].form.answers.map((a) => a.value), ['Neha Gupta', 'NEHA@x.in', 'Morning', 'Above ₹50 lakh', 'Corner flat please']);
  assert.equal(d.messages.find((x) => x.dir === 'out' && x.form).form.cta, 'Book visit');
  const ct = (await api(`/contacts/${encodeURIComponent(d.contact.key)}`, 'GET', null, T)).data;
  assert.equal(ct.custom?.[budgetField], 'Above ₹50 lakh');
  assert.ok(JSON.stringify(ct.timeline).includes('Filled WhatsApp form: Book a site visit'));

  // an edited form isn't live any more: the chatbot asks in the chat until it's published again
  const edited = FORM(); edited.fields[0].label = 'Full name';
  const g = (await api(`/waflows/${f.id}`, 'PUT', { nodes: pub.data.nodes.map((n) => (n.id === 'f' ? { ...n, data: { ...n.data, ...edited } } : n)) }, T)).data;
  assert.equal(g.forms.f, false);
  const before = meta.calls.length;
  const again = await api(`/waflows/${f.id}/forms/f/publish`, 'POST', {}, T);
  assert.equal(again.status, 200);
  assert.equal(meta.calls.length, before + 3, 'a published flow can’t change: a new one is made');
  assert.notEqual(again.data.nodes.find((n) => n.id === 'f').data.flowId, node.data.flowId);
});

test('a form that can’t be sent falls back to asking in the chat; a typed reply switches to the chat too', async () => {
  fake.cloudFails = true;
  const num = '919700000103';
  await say(num, 'book visit');
  await waitFor(() => sentTo(num).length === 2);
  fake.cloudFails = false;
  assert.match(bodyOf(sentTo(num)[0]), /Book your site visit/, 'the form’s message still goes');
  assert.match(bodyOf(sentTo(num)[1]), /\(1\/5\) Full name/);
  const c = await convOf(num);
  assert.ok((await detail(c.id)).messages.some((m) => m.dir === 'note' && /couldn’t be sent/.test(m.text)));
  assert.equal(c.bot.wait, 'reply');

  const num2 = '919700000104';
  await say(num2, 'book visit');
  await waitFor(() => sentTo(num2).length === 1);
  assert.equal(sentTo(num2)[0].interactive.type, 'flow');
  await say(num2, 'can I just type here?');
  await waitFor(() => sentTo(num2).length === 3);
  assert.match(bodyOf(sentTo(num2)[1]), /let’s do it right here/);
  assert.match(bodyOf(sentTo(num2)[2]), /\(1\/5\) Full name/);
});

test('industry templates: the real-estate site visit form works without Meta', async () => {
  const d = (await api('/waflows', 'GET', null, T)).data;
  const t = d.industries.find((i) => i.id === 'realestate').templates.find((x) => x.id === 'ind:realestate:form');
  assert.ok(t);
  const f = (await api('/waflows', 'POST', { template: t.id }, T)).data;
  assert.deepEqual(f.problems, []);
  const form = f.nodes.find((n) => n.type === 'form');
  assert.equal(form.data.fields.length, 5);
  // the simulator asks the form's questions in the chat
  const r = (await api(`/waflows/${f.id}/simulate`, 'POST', { input: { text: 'site visit' } }, T)).data;
  assert.match(r.out.at(-1).text, /\(1\/5\) Your name/);
  const r2 = (await api(`/waflows/${f.id}/simulate`, 'POST', { input: { text: 'Asha' }, state: r.state }, T)).data;
  assert.match(r2.out[0].text, /\(2\/5\) Visit date/);
  assert.equal(r2.state.got.name, 'Asha');
});
