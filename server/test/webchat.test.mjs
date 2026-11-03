// Website chat: the AI agent, chatbots and the team on the seller's website. A signed key (a made-up or reset one opens
// nothing), the widget script, a visitor's chat answered by the AI agent (told it's the website), the chat in the inbox
// marked Website, the team's reply reaching the window, buttons a visitor taps, "talk to a person", the contact form
// (required / optional), a CRM contact from details shared later, the seller's site list, and the public routes open
// to any website.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { startServer, register } from './helpers.mjs';

const ai = { calls: [] };
let model, srv, api, T, base;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms = 6000) { for (let t = 0; t < ms; t += 50) { const v = await fn(); if (v) return v; await wait(50); } return fn(); }
const body = (req) => new Promise((r) => { const parts = []; req.on('data', (d) => parts.push(d)); req.on('end', () => { const b = Buffer.concat(parts).toString(); r(b ? JSON.parse(b) : {}); }); });

before(async () => {
  model = http.createServer(async (req, res) => {
    const j = await body(req);
    const sys = String(j.instructions || ''), user = String(j.input?.at(-1)?.content || '');
    const last = user.split('\n').filter((l) => l.startsWith('Customer:')).at(-1) || '';
    ai.calls.push({ sys, user });
    const text = sys.includes('assistant (') ? JSON.stringify({ reply: /email is/i.test(last) ? 'Thanks, noted!' : 'Yoga for Beginners is ₹1,999 for 6 weeks.', handoff: false, intent: 'pricing', lead: { name: '', email: (last.match(/\S+@\S+\.\w+/) || [''])[0] } }) : '{}';
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ output: [{ type: 'message', content: [{ type: 'output_text', text }] }] }));
  }).listen(0);
  await wait(30);
  srv = await startServer({ KIE_API_KEY: 'kie_test', KIE_BASE_URL: `http://127.0.0.1:${model.address().port}`, WA_INBOX_TICK_MS: '150' });
  api = srv.api; base = srv.base;
  T = (await register(api)).token;
  assert.equal((await api('/wa-agent', 'PUT', { on: true, name: 'Asha', knowledge: 'Yoga for Beginners: ₹1,999, 6 weeks, online.' }, T)).status, 200);
});
after(async () => { await srv?.stop(); model?.close(); });

// the widget's own requests: GET, and POST as text/plain from another website
const pub = (key, path, b, origin = 'https://shop.example.com') => fetch(`${base}/api/public/webchat/${key}${path}`, b ? { method: 'POST', headers: { 'content-type': 'text/plain', origin }, body: JSON.stringify(b) } : { headers: { origin } });
const json = async (r) => ({ status: r.status, data: await r.json(), cors: r.headers.get('access-control-allow-origin') });
const messages = async (key, visitor, since = 0) => (await json(await pub(key, `/messages?visitor=${visitor}&since=${since}`))).data;
const hello = async (key) => (await json(await pub(key, '/hello', {}))).data.visitor;
const inbox = async () => [...(await api('/inbox', 'GET', null, T)).data.convs, ...(await api('/inbox?filter=resolved', 'GET', null, T)).data.convs];

test('off until switched on; a made-up or old key opens nothing; the widget script is served', async () => {
  const s = (await api('/webchat', 'GET', null, T)).data;
  assert.equal(s.on, false);
  assert.match(s.snippet, /<script src="http:\/\/127\.0\.0\.1:\d+\/wc\.js" data-key="[\w-]+\.[\w-]{16}" async><\/script>/);
  assert.equal((await pub(s.key, '/config')).status, 404, 'off: nothing to show');
  const on = (await api('/webchat', 'PUT', { on: true, title: 'Yoga Studio', color: '#16a34a', greeting: 'Namaste! Ask me anything 🙏' }, T)).data;
  const cfg = await json(await pub(on.key, '/config'));
  assert.deepEqual([cfg.status, cfg.cors, cfg.data.title, cfg.data.color, cfg.data.greeting], [200, '*', 'Yoga Studio', '#16a34a', 'Namaste! Ask me anything 🙏']);
  assert.match(cfg.data.subtitle, /Asha usually replies in seconds/);
  assert.equal((await pub(`${on.key.split('.')[0]}.AAAAAAAAAAAAAAAA`, '/config')).status, 404, 'a made-up signature');
  assert.equal((await pub('nobody.AAAAAAAAAAAAAAAA', '/config')).status, 404);
  const reset = (await api('/webchat', 'PUT', { reset: true }, T)).data;
  assert.notEqual(reset.key, on.key);
  assert.equal((await pub(on.key, '/config')).status, 404, 'the old snippet stops');
  assert.equal((await pub(reset.key, '/config')).status, 200);
  const js = await fetch(`${base}/wc.js`);
  assert.equal(js.status, 200);
  assert.match(js.headers.get('content-type'), /javascript/);
  assert.match(await js.text(), /attachShadow/);
});

test('a visitor asks; the AI agent answers (told it’s the website); the chat is in the inbox as Website; the team replies', async () => {
  const { key } = (await api('/webchat', 'GET', null, T)).data;
  const v = await hello(key);
  assert.match(v, /^[\w-]{32}$/);
  const sent = await json(await pub(key, '/send', { visitor: v, text: 'How much is the yoga course?', page: 'https://shop.example.com/yoga' }));
  assert.deepEqual([sent.status, sent.cors], [200, '*']);
  const got = await waitFor(async () => { const m = await messages(key, v); return m.messages.length >= 2 && m; });
  assert.deepEqual(got.messages.map((m) => [m.from, m.text]), [['visitor', 'How much is the yoga course?'], ['bot', 'Yoga for Beginners is ₹1,999 for 6 weeks.']]);
  assert.match(ai.calls.at(-1).sys, /chat window on the business’s website, not WhatsApp/);
  // only what's new
  assert.equal((await messages(key, v, got.messages.at(-1).at)).messages.length, 0);
  const c = (await inbox()).find((x) => x.web);
  assert.ok(c, 'in the inbox');
  assert.deepEqual([c.num, c.web.page, c.ai], ['', 'https://shop.example.com/yoga', true]);
  // the team takes over and replies; a WhatsApp template isn't offered for a website chat
  assert.equal((await api(`/inbox/${c.id}/messages`, 'POST', { template: 'hello_offer' }, T)).status, 400);
  const r = await api(`/inbox/${c.id}/messages`, 'POST', { text: 'Hi, Priya here — want a free trial class?' }, T);
  assert.equal(r.data.message.status, 'sent');
  const team = (await messages(key, v)).messages.at(-1);
  assert.deepEqual([team.from, team.author, team.text], ['team', 'Tester', 'Hi, Priya here — want a free trial class?']);
  // the visitor's next message goes to the team, not the AI
  const before = ai.calls.length;
  await pub(key, '/send', { visitor: v, text: 'Yes please!' });
  await waitFor(async () => (await messages(key, v)).messages.at(-1).text === 'Yes please!');
  await wait(300);
  assert.equal(ai.calls.length, before, 'a person has the chat now');
  // another visitor can't read this chat
  assert.equal((await messages(key, await hello(key))).messages.length, 0);
  assert.equal((await json(await pub(key, '/send', { visitor: 'short', text: 'hi' }))).status, 400);
});

test('a chatbot on the website: its buttons come to the window and a tap takes its path; “talk to a person” hands over', async () => {
  const { key } = (await api('/webchat', 'GET', null, T)).data;
  const N = (id, type, data = {}) => ({ id, type, data });
  const flow = (await api('/waflows', 'POST', { flow: { name: 'Classes', trigger: { type: 'keyword', keywords: ['classes'] }, nodes: [N('start', 'start'), N('b', 'buttons', { text: 'Online or at the studio?', buttons: [{ id: 'on', title: 'Online' }, { id: 'st', title: 'Studio' }] }), N('l', 'link', { text: 'Join online', label: 'Join', url: 'https://x.test/join' }), N('s', 'end', { text: 'See you at the studio!' })],
    edges: [{ from: 'start', port: 'next', to: 'b' }, { from: 'b', port: 'on', to: 'l' }, { from: 'b', port: 'st', to: 's' }] } }, T)).data;
  assert.equal((await api(`/waflows/${flow.id}`, 'PUT', { active: true }, T)).status, 200);
  const v = await hello(key);
  await pub(key, '/send', { visitor: v, text: 'Tell me about classes' });
  const q = await waitFor(async () => (await messages(key, v)).messages.find((m) => m.choices));
  assert.deepEqual([q.text, q.choices], ['Online or at the studio?', [{ id: 'on', title: 'Online' }, { id: 'st', title: 'Studio' }]]);
  await pub(key, '/send', { visitor: v, text: 'Online', iid: 'on' });
  const link = await waitFor(async () => (await messages(key, v)).messages.find((m) => m.cta));
  assert.deepEqual([link.text, link.cta], ['Join online', { label: 'Join', url: 'https://x.test/join' }], 'the link button, without the address pasted in the text');
  const v2 = await hello(key);
  await pub(key, '/send', { visitor: v2, text: 'talk to a person' });
  await waitFor(async () => (await messages(key, v2)).human);
  assert.match((await messages(key, v2)).messages.at(-1).text, /connecting you with our team/i);
});

test('the contact form: required asks first; details given → a CRM contact; an email shared later makes one too', async () => {
  const { key } = (await api('/webchat', 'PUT', { ask: 'required' }, T)).data;
  const v = await hello(key);
  const no = await json(await pub(key, '/send', { visitor: v, text: 'hi' }));
  assert.deepEqual([no.status, no.data.ask], [400, true]);
  assert.equal((await json(await pub(key, '/send', { visitor: v, text: 'hi', name: 'Meera Shah', phone: '+91 98765 43210' }))).status, 200);
  const c = await waitFor(async () => (await inbox()).find((x) => x.web?.phone === '+91 98765 43210'));
  assert.equal(c.name, 'Meera Shah');
  assert.ok(c.ckey, 'a CRM contact');
  assert.equal((await api(`/contacts/${encodeURIComponent(c.ckey)}`, 'GET', null, T)).data.source, 'website chat');
  // optional: no form needed; the visitor tells the AI their email → now a contact
  await api('/webchat', 'PUT', { ask: 'optional' }, T);
  const v2 = await hello(key);
  await pub(key, '/send', { visitor: v2, text: 'my email is ravi@example.com' });
  const c2 = await waitFor(async () => (await inbox()).find((x) => x.web && x.ckey && x.ckey.includes('ravi@example.com')));
  assert.ok(c2, 'the email made a contact');
});

test('only on the seller’s own sites when they list them', async () => {
  const { key } = (await api('/webchat', 'PUT', { sites: 'https://www.myyoga.in, studio.example.org' }, T)).data;
  assert.equal((await pub(key, '/config', null, 'https://shop.example.com')).status, 403);
  assert.equal((await pub(key, '/config', null, 'https://myyoga.in')).status, 200);
  assert.equal((await pub(key, '/config', null, 'https://blog.myyoga.in')).status, 200, 'a subdomain');
  assert.deepEqual((await api('/webchat', 'GET', null, T)).data.sites, ['myyoga.in', 'studio.example.org']);
  await api('/webchat', 'PUT', { sites: '' }, T);
});

test('on the seller’s FunnelHive pages when they choose it (with their site list too); never in the editor preview', async () => {
  const f = (await api('/funnels', 'POST', { name: 'Yoga' }, T)).data;
  const live = (await api(`/funnels/${f.id}`, 'PUT', { published: true }, T)).data;
  const html = async (p) => (await fetch(base + p)).text();
  const { key } = (await api('/webchat', 'PUT', { pages: true, sites: 'myyoga.in' }, T)).data;
  const pageHtml = await html(`/f/${live.slug}`);
  if (!/<html/i.test(pageHtml)) return; // the client isn't built here: no live pages to check
  assert.ok(pageHtml.includes(`<script src="/wc.js" data-key="${key}" async></script>`), 'the bubble on the live page');
  assert.ok(!(await html(`/f/${live.slug}?preview=1`)).includes('/wc.js'), 'not in the preview');
  // the page's own host may use it though it isn't in the site list
  const host = new URL(base).host;
  assert.equal((await fetch(`${base}/api/public/webchat/${key}/config`, { headers: { referer: `http://${host}/f/${live.slug}` } })).status, 200);
  await api('/webchat', 'PUT', { pages: false, sites: '' }, T);
  assert.ok(!(await html(`/f/${live.slug}`)).includes('/wc.js'), 'off: gone');
});
