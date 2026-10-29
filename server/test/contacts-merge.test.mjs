// Contact de-duplication: new chats and lead-source enquiries join the contact that already has the number;
// likely duplicates are listed with a reason; merging moves orders, timeline, conversations and automation runs
// to the kept contact and never widens consent; another seller's contacts can't be merged; 20 at most.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import { startServer, register } from './helpers.mjs';

const KEY = 'hk_test_ok_supersecret_123';
const fake = { sent: [], hook: null, n: 0 };
let hive, srv, api, T, f, ls;
const k = (key) => encodeURIComponent(key);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms = 5000) { for (let t = 0; t < ms; t += 50) { const v = await fn(); if (v) return v; await wait(50); } return fn(); }
const body = (req) => new Promise((r) => { const parts = []; req.on('data', (d) => parts.push(d)); req.on('end', () => { const b = Buffer.concat(parts); r(b.length ? JSON.parse(b) : {}); }); });

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
    if (route === 'POST /messages') { fake.sent.push(j); return send(202, { id: `msg_${++fake.n}`, wamid: `wamid.${fake.n}`, status: 'queued' }); }
    send(404, { error: 'not found' });
  });
  await new Promise((r) => hive.listen(0, '127.0.0.1', r));
  srv = await startServer({ HIVE_WA_API_URL: `http://127.0.0.1:${hive.address().port}/wa/v1`, INBOUND_EMAIL_DOMAIN: 'in.test.dev' });
  api = srv.api;
  T = (await register(api)).token;
  assert.equal((await api('/channels/whatsapp/hive', 'PUT', { apiKey: KEY }, T)).status, 200);
  assert.equal((await api('/channels/whatsapp/hive/webhook', 'POST', {}, T)).status, 200);
  f = (await api('/templates/yoga/use', 'POST', {}, T)).data;
  await api(`/funnels/${f.id}`, 'PUT', { published: true }, T);
  ls = (await api('/lead-sources', 'GET', null, T)).data;
});
after(async () => { await srv.stop(); hive.close(); });

async function hook(event, data) {
  const id = `whd_${crypto.randomUUID()}`, ts = Date.now();
  const raw = JSON.stringify({ id, event, created_at: new Date(ts).toISOString(), number: { id: 'ch_1', display: '919800000001', phone_number_id: '1111' }, data });
  const sig = `sha256=${crypto.createHmac('sha256', fake.hook.secret).update(raw).digest('hex')}`;
  const r = await fetch(srv.base + new URL(fake.hook.url).pathname, { method: 'POST', headers: { 'content-type': 'application/json', 'x-hive-signature': sig, 'x-hive-event': event, 'x-hive-delivery-id': id, 'x-hive-timestamp': String(ts) }, body: raw });
  assert.equal(r.status, 200);
}
const say = (from, text) => hook('message.inbound', { from, type: 'text', text, timestamp: new Date().toISOString() });
const convOf = async (num) => (await api('/inbox', 'GET', null, T)).data.convs.find((c) => c.num === num);
const keys = async () => (await api('/contacts', 'GET', null, T)).data.map((c) => c.key);
const lead = (b) => api(`/public/${f.slug}/lead`, 'POST', { stepId: f.steps[0].id, ...b });
const order = (b) => api(`/public/${f.slug}/order`, 'POST', { stepId: f.steps.find((s) => s.type === 'checkout').id, ...b });
const path = (u) => new URL(u).pathname.replace(/^\/api/, '');

test('starting a WhatsApp chat with a number an email contact already has: the chat joins that contact', async () => {
  assert.equal((await api('/contacts', 'POST', { email: 'meera@example.com', name: 'Meera', phone: '+91 98111 00002' }, T)).status, 200);
  const st = await api('/inbox/start', 'POST', { phone: '098111 00002', template: 'hello_offer', params: ['Meera'] }, T);
  assert.equal(st.status, 200, JSON.stringify(st.data));
  const d = (await api(`/inbox/${st.data.id}`, 'GET', null, T)).data;
  assert.equal(d.contact.key, 'meera@example.com');
  assert.ok(!(await keys()).some((x) => x.startsWith('phone:') && x.endsWith('9811100002')), 'no phone-only duplicate');
});

test('lead sources: an enquiry with only a phone joins the email contact with that number; a new email joins a phone-only contact', async () => {
  assert.equal((await api('/contacts', 'POST', { email: 'kavya@example.com', name: 'Kavya Rao', phone: '9876512345' }, T)).status, 200);
  const q = new URLSearchParams({ leadid: 'JD-1', name: 'Kavya', mobile: '+91 98765 12345', category: 'Interiors', city: 'Bengaluru' });
  assert.equal((await api(`${path(ls.justdial.url)}?${q}`, 'GET')).status, 200);
  const c = (await api(`/contacts/${k('kavya@example.com')}`, 'GET', null, T)).data;
  assert.ok(c.tags.includes('JustDial'));
  assert.match(JSON.stringify(c.timeline), /New enquiry from JustDial/);
  assert.ok(!(await keys()).some((x) => x.startsWith('phone:') && x.endsWith('9876512345')));
  // IndiaMART: first a phone-only enquiry, then the same number with an email — still one contact
  const im = (id, extra) => api(path(ls.indiamart.pushUrl), 'POST', { CODE: 200, STATUS: 'SUCCESS', RESPONSE: { UNIQUE_QUERY_ID: id, SENDER_NAME: 'Gopal', SENDER_MOBILE: '+91-9811155555', QUERY_PRODUCT_NAME: 'Pumps', ...extra } });
  await im('IM-1');
  await im('IM-2', { SENDER_EMAIL: 'gopal@example.com' });
  const ks = (await keys()).filter((x) => x.includes('9811155555') || x === 'gopal@example.com');
  assert.deepEqual(ks, ['phone:9811155555']);
  const g = (await api(`/contacts/${k('phone:9811155555')}`, 'GET', null, T)).data;
  assert.equal(g.email, 'gopal@example.com');
  assert.equal(JSON.stringify(g.timeline).match(/New enquiry from IndiaMART/g).length, 2);
});

let A = 'asha@example.com', B = 'phone:9123400000', C = 'asha.k@example.com', autoId;
test('duplicates: same phone, same email, similar name in the same city — each with its reason', async () => {
  // A: signed up with email and number; B: the same number, no email, on another form; C: bought with another email, same number
  await lead({ email: A, name: 'Asha Verma', phone: '9123400000' });
  await lead({ phone: '9123400000', name: 'Asha V' });
  assert.equal((await order({ email: C, name: 'Asha', phone: '+91 91234 00000' })).status, 200);
  // two people with near-identical names in the same city (a CRM field "City")
  const fields = (await api('/crm/fields', 'PUT', { fields: [{ label: 'City', type: 'text' }] }, T)).data;
  for (const [email, name] of [['ravi1@example.com', 'Ravi Kumar'], ['ravi.k@example.org', 'Kumar Ravi']]) {
    await api('/contacts', 'POST', { email, name }, T);
    await api(`/contacts/${k(email)}`, 'PATCH', { custom: { [fields[0].id]: 'Pune' } }, T);
  }
  const { groups } = (await api('/contacts/duplicates', 'GET', null, T)).data;
  const g1 = groups.find((g) => g.contacts.some((c) => c.key === A));
  assert.ok(g1, JSON.stringify(groups));
  assert.deepEqual(g1.contacts.map((c) => c.key).sort(), [A, C, B].sort());
  assert.ok(g1.reasons.some((r) => /Same phone number/.test(r)));
  assert.equal(g1.suggested, C, 'the buyer is suggested as the one to keep');
  const g2 = groups.find((g) => g.contacts.some((c) => c.key === 'ravi1@example.com'));
  assert.deepEqual(g2.contacts.map((c) => c.key).sort(), ['ravi.k@example.org', 'ravi1@example.com']);
  assert.match(g2.reasons.join(), /Similar name in Pune/);
  // only this contact's groups
  assert.equal((await api(`/contacts/duplicates?key=${k(B)}`, 'GET', null, T)).data.groups.length, 1);
});

test('merge: orders, timeline, inbox chat and automation runs follow the kept contact; an email opt-out is kept', async () => {
  // the number chats on WhatsApp (the chat lands on one of the three); C is in an automation; A has a note and a stage
  await say('919123400000', 'Hi, is the batch full?');
  assert.ok(await waitFor(() => convOf('919123400000')));
  await api(`/contacts/${k(B)}`, 'PATCH', { tags: ['walk-in'] }, T);
  await api(`/contacts/${k(A)}/activity`, 'POST', { type: 'note', text: 'Prefers mornings' }, T);
  const pipe = (await api('/pipelines', 'GET', null, T)).data[0];
  const interested = pipe.stages.find((s) => s.name === 'Interested');
  await api(`/contacts/${k(A)}`, 'PATCH', { stage: { pipelineId: pipe.id, stageId: interested.id } }, T);
  const auto = (await api('/automations', 'POST', { name: 'Nurture', trigger: { type: 'tag', tag: 'never-used' }, steps: [{ type: 'wait', amount: 30, unit: 'days' }, { type: 'tag', tag: 'nurtured' }] }, T)).data;
  autoId = auto.id;
  await api(`/automations/${auto.id}`, 'PUT', { active: true }, T);
  assert.equal((await api(`/automations/${auto.id}/enroll`, 'POST', { key: C }, T)).status, 200);
  // B unsubscribed from emails
  const optOut = await api(`/contacts/${k(B)}`, 'PATCH', { unsubscribed: true }, T);
  assert.equal(optOut.status, 200);

  // preview first
  const pv = (await api('/contacts/merge', 'POST', { keys: [A, B, C], primary: A, dryRun: true }, T)).data;
  assert.equal(pv.key, A);
  assert.equal(pv.kept.orders, 1);
  assert.equal(pv.kept.unsubscribed, true);
  assert.ok(pv.kept.tags.includes('walk-in'));
  assert.ok((await keys()).includes(B), 'a preview changes nothing');

  const r = await api('/contacts/merge', 'POST', { keys: [B, C], primary: A }, T);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.key, A);
  assert.ok(r.data.moved.orders >= 1 && r.data.moved.leads >= 1 && r.data.moved.runs >= 1);
  const all = await keys();
  assert.ok(all.includes(A) && !all.includes(B) && !all.includes(C));
  const d = (await api(`/contacts/${k(A)}`, 'GET', null, T)).data;
  assert.equal(d.orders, 1, 'C’s order is A’s now');
  assert.equal(d.type, 'customer');
  assert.equal(d.orderList.length, 1);
  assert.ok(d.tags.includes('walk-in'));
  assert.equal(d.unsubscribed, true, 'opted out on one copy = opted out');
  assert.equal(d.stages[pipe.id], pipe.stages.find((s) => s.won).id, 'the furthest stage (a buyer: won) is kept');
  const t = JSON.stringify(d.timeline);
  assert.match(t, /Prefers mornings/);
  assert.match(t, /Merged 2 duplicate contacts into this one/);
  assert.equal(d.timeline.filter((x) => x.type === 'lead').length, 2, 'both sign-ups on one timeline');
  assert.equal((await convOf('919123400000')).ckey, A);
  const runs = (await api(`/automations/${autoId}`, 'GET', null, T)).data.runs;
  assert.ok(runs.length && runs.every((x) => x.key === A), JSON.stringify(runs));
  assert.equal((await api(`/contacts/${k(C)}`, 'GET', null, T)).status, 404);
});

test('merge keeps a WhatsApp opt-out from any copy, and a phone-only primary is filed under the other copy’s email', async () => {
  await lead({ phone: '9000011111', name: 'Nikhil' });
  await say('919000011111', 'STOP');
  await waitFor(async () => (await api(`/contacts/${k('phone:9000011111')}`, 'GET', null, T)).data.waOptOut);
  assert.equal((await api(`/contacts/${k('phone:9000011111')}`, 'GET', null, T)).data.waOptOut, true);
  await lead({ email: 'nikhil@example.com', name: 'Nikhil S' });
  const r = await api('/contacts/merge', 'POST', { keys: ['phone:9000011111', 'nikhil@example.com'], primary: 'phone:9000011111' }, T);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.key, 'nikhil@example.com');
  const d = (await api(`/contacts/${k('nikhil@example.com')}`, 'GET', null, T)).data;
  assert.equal(d.waOptOut, true, 'consent is never widened');
  assert.equal(d.name, 'Nikhil', 'the primary’s details win');
  assert.equal(d.phone, '9000011111');
  // the inbox still knows the number opted out
  assert.equal((await api('/inbox/start', 'POST', { phone: '9000011111', template: 'hello_offer' }, T)).status, 400);
});

test('another seller’s contacts can’t be merged; more than 20 at once is refused', async () => {
  const other = (await register(api)).token;
  await api('/contacts', 'POST', { email: 'mine@example.com', name: 'Mine' }, other);
  const r = await api('/contacts/merge', 'POST', { keys: ['ravi1@example.com', 'ravi.k@example.org'], primary: 'ravi1@example.com' }, other);
  assert.equal(r.status, 404);
  const mixed = await api('/contacts/merge', 'POST', { keys: ['mine@example.com', 'ravi1@example.com'] }, other);
  assert.equal(mixed.status, 404);
  assert.ok((await keys()).includes('ravi.k@example.org') && (await keys()).includes('ravi1@example.com'), 'the owner’s contacts are untouched');
  assert.equal((await api('/contacts/duplicates', 'GET', null, other)).data.groups.length, 0);
  const many = Array.from({ length: 21 }, (_, i) => `p${i}@example.com`);
  assert.equal((await api('/contacts/merge', 'POST', { keys: many }, T)).status, 400);
  assert.equal((await api('/contacts/merge', 'POST', { keys: ['ravi1@example.com'] }, T)).status, 400);
});

test('Hive: duplicates can be listed; a merge waits for Confirm', async () => {
  const { TOOLS, OK } = await import('../hive-contacts.js');
  assert.deepEqual(TOOLS.map((t) => t.name), ['find_duplicate_contacts', 'merge_contacts']);
  assert.match(OK.merge_contacts({ primary: 'a@x.in', keys: ['a@x.in', 'phone:9876500000'] }), /Merge 1 contact\(s\) into a@x\.in/);
  assert.equal(OK.find_duplicate_contacts, undefined, 'reading needs no Confirm');
});
