// The WhatsApp inbox, chatbots and AI agent against a fake Hive WhatsApp API and a fake AI service: inbound
// messages become conversations, replies inside the 24-hour window, templates outside it, notes, statuses; a
// chatbot flow (questions saved to the contact, retries, buttons, tags, hand-over); the builder's simulator;
// the AI agent answering and handing over; AI suggestions, summary, rewrite and drafting a chatbot; erasing a contact.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import { startServer, register } from './helpers.mjs';

const KEY = 'hk_test_ok_supersecret_123';
const fake = { sent: [], hook: null, n: 0 };
const ai = { calls: [] };
let hive, model, srv, api, T;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms = 5000) { for (let t = 0; t < ms; t += 50) { const v = await fn(); if (v) return v; await wait(50); } return fn(); }
const sentTo = (num) => fake.sent.filter((m) => m.to === num);
const listen = (s) => new Promise((r) => s.listen(0, '127.0.0.1', r));
const body = (req) => new Promise((r) => { let b = ''; req.on('data', (d) => { b += d; }); req.on('end', () => r(b ? JSON.parse(b) : null)); });

before(async () => {
  hive = http.createServer(async (req, res) => {
    const j = await body(req);
    const url = new URL(req.url, 'http://x'), p = url.pathname.replace(/^\/wa\/v1/, '');
    const send = (s, o) => { res.writeHead(s, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
    if (req.headers.authorization !== `Bearer ${KEY}`) return send(401, { error: 'Invalid API key' });
    const route = `${req.method} ${p}`;
    if (route === 'GET /me') return send(200, { workspace_id: 'ws_1', prefix: 'hk_test_ok_sup' });
    if (route === 'GET /numbers') return send(200, { numbers: [{ id: 'ch_1', display: '919800000001', phone_number_id: '1111' }] });
    if (route === 'GET /templates') return send(200, { templates: [{ name: 'hello_offer', language: 'en', status: 'APPROVED', category: 'MARKETING', components: [{ type: 'BODY', text: 'Hi {{1}}, our new batch starts soon — reply to know more.' }] }] });
    if (route === 'PUT /webhooks') { fake.hook = j; return send(200, { ok: true }); }
    if (route === 'POST /messages') { fake.sent.push(j); return send(202, { id: `msg_${++fake.n}`, wamid: `wamid.${fake.n}`, status: 'queued' }); }
    if (p.startsWith('/media/')) { res.writeHead(200, { 'content-type': 'image/jpeg' }); return res.end(Buffer.from([0xff, 0xd8, 0xff, 0xe0])); }
    send(404, { error: 'not found' });
  });
  // the AI: answers by what it's asked (the system prompt) and the customer's last line
  model = http.createServer(async (req, res) => {
    const j = await body(req);
    const sys = String(j.instructions || ''), user = String(j.input?.at(-1)?.content || '');
    const last = user.split('\n').filter((l) => l.startsWith('Customer:')).at(-1) || user;
    ai.calls.push({ sys, user });
    let text;
    if (sys.includes('sort a customer')) text = JSON.stringify({ intent: /price|buy|cost/i.test(user) ? 'buy' : 'other' });
    else if (sys.includes('WhatsApp assistant')) text = /refund/i.test(last) ? JSON.stringify({ reply: 'So sorry — I’m getting a team member to help you with the refund.', handoff: true, reason: 'Refund request', intent: 'complaint' })
      : JSON.stringify({ reply: 'The Yoga course is *₹1,999* — you can join here: https://x.test/f/yoga 🙂', buttons: ['Join now', 'Ask more'], handoff: false, intent: 'pricing', lead: { name: '', email: /@/.test(last) ? last.match(/\S+@\S+/)[0] : '' } });
    else if (sys.includes('Write 3 different good replies')) text = JSON.stringify({ suggestions: ['Yes, it’s ₹1,999!', 'Which batch suits you?', 'Shall I send the joining link?'] });
    else if (sys.includes('brief the business owner')) text = JSON.stringify({ summary: 'Asked about the price of the yoga course.', sentiment: 'positive', intent: 'pricing', temperature: 'hot', next: 'Send the joining link' });
    else if (sys.includes('You edit WhatsApp messages')) text = `Namaste! ${user}`;
    else if (sys.includes('You design WhatsApp chatbots')) text = JSON.stringify({ name: 'Bakery orders', trigger: { type: 'keyword', keywords: ['cake'] }, nodes: [{ id: 'start', type: 'start' }, { id: 'a', type: 'ask', data: { text: 'Which cake would you like?', var: 'cake' } }, { id: 'b', type: 'handoff', data: { text: 'Thanks! We’ll confirm shortly.' } }], edges: [{ from: 'start', port: 'next', to: 'a' }, { from: 'a', port: 'next', to: 'b' }] });
    else text = '{}';
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ output: [{ type: 'message', content: [{ type: 'output_text', text }] }] }));
  });
  await listen(hive); await listen(model);
  srv = await startServer({ HIVE_WA_API_URL: `http://127.0.0.1:${hive.address().port}/wa/v1`, KIE_API_KEY: 'kie_test', KIE_BASE_URL: `http://127.0.0.1:${model.address().port}`, WA_INBOX_TICK_MS: '200' });
  api = srv.api;
  T = (await register(api)).token;
  assert.equal((await api('/channels/whatsapp/hive', 'PUT', { apiKey: KEY }, T)).status, 200);
  assert.equal((await api('/channels/whatsapp/hive/webhook', 'POST', {}, T)).status, 200);
});
after(async () => { await srv.stop(); hive.close(); model.close(); });

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

test('an inbound message opens a conversation; a person replies inside the 24-hour window; notes stay internal', async () => {
  await say('919700000001', 'Hi, is the yoga course still open?', { contact_name: 'Meera' });
  const c = await waitFor(() => convOf('919700000001'));
  assert.equal(c.name, 'Meera');
  assert.equal(c.unread, 1);
  assert.equal(c.window.open, true);
  const n = (await api('/notifications', 'GET', null, T)).data.items.find((x) => x.kind === 'whatsapp');
  assert.equal(n.link, `/inbox/${c.id}`, 'the bell opens the conversation');
  await say('919700000001', 'Hello?');
  assert.equal((await api('/notifications', 'GET', null, T)).data.items.filter((x) => x.kind === 'whatsapp').length, 1, 'one bell per conversation, not one per message');

  const d = (await api(`/inbox/${c.id}?read=1`, 'GET', null, T)).data;
  assert.deepEqual(d.messages.map((m) => m.text), ['Hi, is the yoga course still open?', 'Hello?']);
  assert.equal(d.conv.unread, 0);
  assert.equal(d.contact.phone, '+919700000001');

  const r = await api(`/inbox/${c.id}/messages`, 'POST', { text: 'Yes! The next batch starts Monday.' }, T);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(sentTo('919700000001').at(-1).text.body, 'Yes! The next batch starts Monday.');
  assert.equal((await api(`/inbox/${c.id}/messages`, 'POST', { note: 'Wants the morning batch' }, T)).status, 200);
  assert.equal(sentTo('919700000001').length, 1, 'a note is never sent');
  const after = await detail(c.id);
  assert.equal(after.conv.human, true);
  assert.ok(after.conv.assignee, 'the person who replied owns the chat');
  assert.deepEqual(after.messages.filter((m) => m.dir === 'note' && m.by === 'team').map((m) => m.text), ['Wants the morning batch']);

  // the delivery status comes back on the webhook
  const out = after.messages.find((m) => m.dir === 'out');
  await hook('message.status', { message_id: 'msg_1', status: 'read', to: '919700000001' });
  await waitFor(async () => (await detail(c.id)).messages.find((m) => m.id === out.id).status === 'read');

  // status, labels, assignee
  const p = await api(`/inbox/${c.id}`, 'PATCH', { status: 'resolved', labels: ['yoga', 'yoga', 'morning'] }, T);
  assert.equal(p.data.conv.status, 'resolved');
  assert.deepEqual(p.data.conv.labels, ['yoga', 'morning']);
  assert.equal((await api(`/inbox/${c.id}`, 'PATCH', { assignee: 'someone-else' }, T)).status, 400);
  assert.equal((await api('/inbox?filter=resolved', 'GET', null, T)).data.convs.some((x) => x.id === c.id), true);
  await say('919700000001', 'One more question');
  assert.equal((await waitFor(() => convOf('919700000001'))).status, 'open', 'a new message reopens a resolved chat');
});

test('outside the 24-hour window only a template goes; a new chat starts with a template', async () => {
  const st = await api('/inbox/start', 'POST', { phone: '98111 00002', template: 'hello_offer', params: ['Ravi'], preview: 'Hi Ravi, our new batch starts soon — reply to know more.' }, T);
  assert.equal(st.status, 200, JSON.stringify(st.data));
  const m = sentTo('919811100002').at(-1);
  assert.equal(m.type, 'template');
  assert.deepEqual(m.template.body, ['Ravi']);
  const r = await api(`/inbox/${st.data.id}/messages`, 'POST', { text: 'hello' }, T);
  assert.equal(r.status, 400);
  assert.equal(r.data.window, false);
  assert.equal((await api('/inbox/templates', 'GET', null, T)).data.templates[0].name, 'hello_offer');
});

test('a media message can be opened from the inbox', async () => {
  await say('919700000077', '', { type: 'image', media: { id: 'med_1', caption: 'my receipt' } });
  const c = await waitFor(() => convOf('919700000077'));
  const m = (await detail(c.id)).messages[0];
  assert.equal(m.media.type, 'image');
  assert.equal(m.media.caption, 'my receipt');
  const r = await fetch(`${srv.base}/api/inbox/${c.id}/media/${m.id}`, { headers: { authorization: `Bearer ${T}` } });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('content-type'), 'image/jpeg');
});

test('chatbots: a keyword starts the flow; answers are checked and saved; buttons, tags, then a person takes over', async () => {
  const t = (await api('/waflows', 'GET', null, T)).data;
  assert.ok(t.templates.some((x) => x.id === 'lead_capture'));
  const f = (await api('/waflows', 'POST', { template: 'lead_capture' }, T)).data;
  assert.deepEqual(f.trigger.keywords, ['hi', 'hello', 'info', 'details']);
  // a keyword flow without keywords can't be switched on
  const bad = await api(`/waflows/${f.id}`, 'PUT', { trigger: { type: 'keyword', keywords: [] }, active: true }, T);
  assert.equal(bad.status, 400);
  assert.match(bad.data.error, /keyword/);
  assert.equal((await api(`/waflows/${f.id}`, 'PUT', { trigger: { type: 'keyword', keywords: ['hi', 'info'] }, active: true }, T)).data.active, true);

  const num = '919700000002';
  await say(num, 'Hi there!');
  await waitFor(() => sentTo(num).length === 1);
  assert.match(sentTo(num)[0].text.body, /May I know your name/);
  await say(num, 'Meera Shah');
  await waitFor(() => sentTo(num).length === 2);
  assert.match(sentTo(num)[1].text.body, /Nice to meet you, Meera!/, 'the saved name is used straight away');
  await say(num, 'not-an-email');
  await waitFor(() => sentTo(num).length === 3);
  assert.match(sentTo(num)[2].text.body, /doesn’t look like an email/);
  await say(num, 'meera@x.in');
  await waitFor(() => sentTo(num).length === 4);
  const btn = sentTo(num)[3];
  assert.equal(btn.type, 'interactive');
  assert.deepEqual(btn.interactive.action.buttons.map((b) => b.reply.title), ['Right away', 'This month', 'Just exploring']);
  await hook('message.inbound', { from: num, type: 'interactive', text: '', interactive_id: 'now', interactive_title: 'Right away' });
  await waitFor(() => sentTo(num).length === 5);
  assert.match(sentTo(num)[4].text.body, /An expert from our team/);

  const c = await waitFor(async () => { const x = await convOf(num); return x?.human && x; });
  assert.equal(c.bot, null);
  const d = await detail(c.id);
  assert.equal(d.contact.name, 'Meera Shah');
  assert.equal(d.contact.email, 'meera@x.in');
  assert.ok(d.contact.tags.includes('hot-lead'));
  assert.ok(d.messages.some((m) => m.dir === 'note' && /Handed to your team/.test(m.text)));
  assert.ok((await api('/notifications', 'GET', null, T)).data.items.some((x) => /needs a person/.test(x.title)));
  const st = (await api(`/waflows/${f.id}`, 'GET', null, T)).data.stats;
  assert.equal(st.runs, 1);
  assert.equal(st.handoffs, 1);

  // with a person on it, the bot stays quiet — even for its keyword
  await say(num, 'hi');
  await wait(300);
  assert.equal(sentTo(num).length, 5);
});

test('"talk to a person" hands over from a running chatbot', async () => {
  const num = '919700000003';
  await say(num, 'info please');
  await waitFor(() => sentTo(num).length === 1);
  await say(num, 'talk to a human');
  await waitFor(() => sentTo(num).length === 2);
  assert.match(sentTo(num)[1].text.body, /connecting you with our team/);
  assert.equal((await convOf(num)).human, true);
});

test('the simulator runs a draft without sending or saving anything', async () => {
  const draft = { name: 'Menu', trigger: { type: 'keyword', keywords: ['menu'] }, nodes: [
    { id: 'start', type: 'start' },
    { id: 'm', type: 'list', data: { text: 'Hi {{first_name}}! Pick one', button: 'Menu', rows: [{ id: 'p', title: 'Prices' }, { id: 'h', title: 'Hours' }] } },
    { id: 'p1', type: 'message', data: { text: 'Plans start at ₹499' } },
    { id: 'c', type: 'condition', data: { rules: [{ field: 'tag', op: 'has', value: 'vip' }] } },
    { id: 'v', type: 'end', data: { text: 'VIP price: ₹399' } },
    { id: 'e', type: 'end', data: { text: 'See you!' } },
  ], edges: [{ from: 'start', port: 'next', to: 'm' }, { from: 'm', port: 'p', to: 'p1' }, { from: 'p1', port: 'next', to: 'c' }, { from: 'c', port: 'yes', to: 'v' }, { from: 'c', port: 'no', to: 'e' }, { from: 'm', port: 'nope', to: 'e' }] };
  const before = fake.sent.length;
  let r = (await api('/waflows/simulate', 'POST', { flow: draft, name: 'Asha Rao', input: { text: 'menu' } }, T)).data;
  assert.equal(r.out[0].kind, 'list');
  assert.equal(r.out[0].text, 'Hi Asha! Pick one');
  assert.equal(r.state.wait, 'reply');
  r = (await api('/waflows/simulate', 'POST', { flow: draft, state: r.state, input: { text: '2' } }, T)).data;
  assert.equal(r.done, true, 'option 2 (Hours) has no next step: the flow ends');
  r = (await api('/waflows/simulate', 'POST', { flow: draft, input: { text: 'menu' } }, T)).data;
  r = (await api('/waflows/simulate', 'POST', { flow: draft, state: r.state, tags: ['vip'], input: { text: 'Prices' } }, T)).data;
  assert.deepEqual(r.out.map((o) => o.text), ['Plans start at ₹499', 'VIP price: ₹399']);
  assert.equal(fake.sent.length, before, 'nothing was sent');
});

test('the AI agent answers from the business knowledge, shares links, and hands a refund to a person', async () => {
  const off = await api('/wa-agent', 'GET', null, T);
  assert.equal(off.data.on, false);
  const on = await api('/wa-agent', 'PUT', { on: true, name: 'Asha', tone: 'friendly', knowledge: 'Yoga for Beginners: ₹1,999, 6 weeks, online.', faqs: [{ q: 'Timings?', a: '7 am and 7 pm' }] }, T);
  assert.equal(on.data.on, true);
  const num = '919700000004';
  await say(num, 'What is the price?');
  await waitFor(() => sentTo(num).length === 1);
  const m = sentTo(num)[0];
  assert.equal(m.type, 'interactive', 'quick replies come as buttons');
  assert.match(m.interactive.body.text, /₹1,999/);
  const call = ai.calls.findLast((x) => x.sys.includes('WhatsApp assistant'));
  assert.match(call.sys, /Yoga for Beginners: ₹1,999/, 'the seller’s knowledge is in the prompt');
  assert.match(call.sys, /Q: Timings\?\nA: 7 am and 7 pm/);
  assert.ok(!/kie|deepseek/i.test(JSON.stringify((await detail((await convOf(num)).id)))), 'no AI vendor is shown');
  const c = await convOf(num);
  assert.equal(c.ai, true);

  await say(num, 'my email is meera@x.in');
  await waitFor(() => sentTo(num).length === 2);
  assert.equal((await detail(c.id)).contact.email, 'meera@x.in', 'an email shared in the chat is saved on the contact');

  await say(num, 'I want a refund');
  await waitFor(() => sentTo(num).length === 3);
  const d = await waitFor(async () => { const x = await detail(c.id); return x.conv.human && x; });
  assert.equal(d.conv.ai, false);
  assert.match(d.conv.handoff.reason, /Refund/);

  // the seller hands it back to the AI from the inbox
  const back = await api(`/inbox/${c.id}`, 'PATCH', { ai: true }, T);
  assert.equal(back.data.conv.ai, true);
  await api('/wa-agent', 'PUT', { on: false }, T);
});

test('an AI concierge flow sorts messages by topic and hands buyers to the agent', async () => {
  await api('/wa-agent', 'PUT', { on: true, auto: false }, T);
  const f = (await api('/waflows', 'POST', { template: 'ai_first' }, T)).data;
  assert.equal(f.trigger.type, 'default');
  assert.equal((await api(`/waflows/${f.id}`, 'PUT', { active: true }, T)).status, 200);
  const num = '919700000005';
  await say(num, 'How much does it cost?');
  await waitFor(() => sentTo(num).length === 1);
  assert.match(sentTo(num)[0].interactive?.body.text || sentTo(num)[0].text?.body, /₹1,999/);
  assert.equal((await convOf(num)).ai, true);
  await api(`/waflows/${f.id}`, 'PUT', { active: false }, T);
  await api('/wa-agent', 'PUT', { on: false }, T);
});

test('AI helpers: reply suggestions, a summary, rewriting a draft, and drafting a chatbot', async () => {
  const c = await convOf('919700000001');
  const s = await api(`/inbox/${c.id}/ai/suggest`, 'POST', {}, T);
  assert.equal(s.data.suggestions.length, 3);
  const sum = await api(`/inbox/${c.id}/ai/summary`, 'POST', {}, T);
  assert.equal(sum.data.summary.temperature, 'hot');
  assert.equal((await detail(c.id)).conv.summary.next, 'Send the joining link');
  const rw = await api('/inbox/ai/rewrite', 'POST', { text: 'batch starts monday', mode: 'hinglish' }, T);
  assert.equal(rw.data.text, 'Namaste! batch starts monday');
  assert.equal((await api('/inbox/ai/rewrite', 'POST', { text: 'x', mode: 'pirate' }, T)).status, 400);
  const g = await api('/waflows/ai', 'POST', { prompt: 'Take cake orders for my bakery' }, T);
  assert.equal(g.status, 200, JSON.stringify(g.data));
  assert.equal(g.data.flow.name, 'Bakery orders');
  assert.deepEqual(g.data.flow.nodes.map((n) => n.type), ['start', 'ask', 'handoff']);
  assert.ok(g.data.flow.nodes[1].x > g.data.flow.nodes[0].x, 'laid out left to right');
});

test('a manual chatbot can be started from the inbox; quick replies are saved', async () => {
  const f = (await api('/waflows', 'POST', { template: 'feedback' }, T)).data;
  await api(`/waflows/${f.id}`, 'PUT', { trigger: { type: 'manual' } }, T);
  const c = await convOf('919700000001');
  const n = sentTo('919700000001').length;
  const r = await api(`/inbox/${c.id}/bot`, 'POST', { flowId: f.id }, T);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(sentTo('919700000001').length, n + 1);
  assert.equal(sentTo('919700000001').at(-1).type, 'interactive');
  await hook('message.inbound', { from: '919700000001', type: 'interactive', text: '😍 Loved it', interactive_id: 'great' });
  await waitFor(() => sentTo('919700000001').length === n + 2);
  assert.match(sentTo('919700000001').at(-1).text.body, /review/);

  const q = await api('/inbox/quick', 'PUT', { quick: [{ short: '/Price', text: 'Our course is ₹1,999' }, { short: '', text: 'x' }] }, T);
  assert.deepEqual(q.data.quick.map((x) => x.short), ['price']);
  assert.equal((await api('/inbox/meta', 'GET', null, T)).data.quick[0].text, 'Our course is ₹1,999');
});

test('erasing a contact removes their WhatsApp conversation', async () => {
  const c = await convOf('919700000003');
  const r = await api(`/contacts/${encodeURIComponent(c.ckey)}`, 'DELETE', null, T);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal((await api(`/inbox/${c.id}`, 'GET', null, T)).status, 404);
});
