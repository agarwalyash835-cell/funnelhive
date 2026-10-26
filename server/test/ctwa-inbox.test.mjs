// Click-to-WhatsApp ads end to end, against a fake Hive WhatsApp API: a message with an ad referral (from Hive, and
// a Meta Cloud API body turned into the same event) is stored on the chat and the contact, shows as the chat's ad
// chip, is found by the "From ads" filter, starts the chatbot made for that ad (else the one for any ad), and the
// Ads page lists the chats per ad.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startServer, register } from './helpers.mjs';

const KEY = 'hk_test_ok_supersecret_123';
const fake = { sent: [], hook: null, n: 0 };
let hive, srv, api, T, metaInbound;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms = 5000) { for (let t = 0; t < ms; t += 50) { const v = await fn(); if (v) return v; await wait(50); } return fn(); }
const listen = (s) => new Promise((r) => s.listen(0, '127.0.0.1', r));
const body = (req) => new Promise((r) => { const parts = []; req.on('data', (d) => parts.push(d)); req.on('end', () => { const b = Buffer.concat(parts); r(b.length ? JSON.parse(b) : {}); }); });

before(async () => {
  // ctwa.js opens a database when loaded: a throwaway one, never the server folder's
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'fh-ctwa-e2e-'));
  process.env.FF_JOBS = '0';
  ({ metaInbound } = await import('../ctwa.js'));
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
    if (route === 'POST /messages' || route === 'POST /cloud/1111/messages') { fake.sent.push(j); return send(202, { id: `msg_${++fake.n}`, status: 'queued' }); }
    send(404, { error: 'not found' });
  });
  await listen(hive);
  srv = await startServer({ HIVE_WA_API_URL: `http://127.0.0.1:${hive.address().port}/wa/v1`, WA_INBOX_TICK_MS: '150' });
  api = srv.api;
  T = (await register(api)).token;
  assert.equal((await api('/channels/whatsapp/hive', 'PUT', { apiKey: KEY }, T)).status, 200);
  assert.equal((await api('/channels/whatsapp/hive/webhook', 'POST', {}, T)).status, 200);
});
after(async () => { await srv.stop(); hive.close(); });

async function hook(event, data) {
  const id = `whd_${crypto.randomUUID()}`, ts = Date.now();
  const raw = JSON.stringify({ id, event, created_at: new Date(ts).toISOString(), number: { id: 'ch_1', display: '919800000001', phone_number_id: '1111' }, data });
  const sig = `sha256=${crypto.createHmac('sha256', fake.hook.secret).update(raw).digest('hex')}`;
  const r = await fetch(srv.base + new URL(fake.hook.url).pathname, { method: 'POST', headers: { 'content-type': 'application/json', 'x-hive-signature': sig, 'x-hive-event': event, 'x-hive-delivery-id': id, 'x-hive-timestamp': String(ts) }, body: raw });
  assert.equal(r.status, 200);
}
const ref = (id, headline) => ({ source_type: 'ad', source_id: id, source_url: `https://fb.me/${id}`, headline, body: 'Tap to chat', media_type: 'image', ctwa_clid: `clid_${id}` });
const say = (from, text, extra = {}) => hook('message.inbound', { from, type: 'text', text, timestamp: new Date().toISOString(), ...extra });
const convs = async (filter = 'all') => (await api(`/inbox?filter=${filter}`, 'GET', null, T)).data;
const convOf = async (num) => (await convs()).convs.find((c) => c.num === num);
const textsTo = (num) => fake.sent.filter((m) => m.to === num).map((m) => m.text?.body || m.interactive?.body?.text || m.body || '');
async function bot(name, trigger, text) {
  const f = (await api('/waflows', 'POST', { flow: { name, trigger, nodes: [{ id: 'start', type: 'start' }, { id: 'a', type: 'end', data: { text } }], edges: [{ from: 'start', port: 'next', to: 'a' }] } }, T)).data;
  const r = await api(`/waflows/${f.id}`, 'PUT', { active: true }, T);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return r.data;
}

test('Hive: a message from an ad is stored on the chat and the contact, shows as a chip, and the "From ads" filter finds it', async () => {
  await say('919711111111', 'Hi! Is this offer still on?', { contact_name: 'Kavya', referral: ref('120055', 'Diwali yoga offer') });
  await say('919711111112', 'Hello', { contact_name: 'Plain' });
  const c = await waitFor(() => convOf('919711111111'));
  assert.deepEqual(c.ad && [c.ad.id, c.ad.headline, c.ad.url], ['120055', 'Diwali yoga offer', 'https://fb.me/120055']);
  assert.equal(c.firstAd, null, 'the same ad as the first one');
  await waitFor(() => convOf('919711111112'));
  const ads = await convs('ads');
  assert.deepEqual(ads.convs.map((x) => x.num), ['919711111111']);
  assert.equal(ads.counts.ads, 1);
  const d = (await api(`/inbox/${c.id}`, 'GET', null, T)).data;
  assert.equal(d.messages.find((m) => m.dir === 'in').ad.id, '120055', 'the message that came from the ad');
  // the CRM contact: source and timeline
  const ct = (await api(`/contacts/${encodeURIComponent(c.ckey)}`, 'GET', null, T)).data;
  assert.equal(ct.contact?.source ?? ct.source, 'whatsapp ad');
  assert.ok(JSON.stringify(ct).includes('Came from ad: Diwali yoga offer'));
  // a missing referral is fine (no ad on the plain chat)
  assert.equal((await convOf('919711111112')).ad, null);
});

test('chatbots: a chat from an ad starts the chatbot for that ad, else the one for any ad, over keywords', async () => {
  await bot('Any ad', { type: 'ad' }, 'Thanks for tapping our ad!');
  const only = await bot('Reel 777', { type: 'ad', adIds: ['777', ' bad id!'] }, 'Here is the Reel 777 offer');
  assert.deepEqual(only.trigger.adIds, ['777', 'badid']);
  await bot('Hi keyword', { type: 'keyword', keywords: ['hi'] }, 'Keyword reply');
  await say('919722222221', 'hi', { referral: ref('777', 'Reel 777') });
  await say('919722222222', 'hi', { referral: ref('888', 'Other ad') });
  await say('919722222223', 'hi');
  assert.ok(await waitFor(() => textsTo('919722222221').includes('Here is the Reel 777 offer')));
  assert.ok(await waitFor(() => textsTo('919722222222').includes('Thanks for tapping our ad!')));
  assert.ok(await waitFor(() => textsTo('919722222223').includes('Keyword reply')), 'no ad: the keyword chatbot as before');
  assert.equal(textsTo('919722222221').length, 1);
});

test('Meta Cloud API: a webhook body with a referral goes through the same path', async () => {
  const [d] = metaInbound({ entry: [{ changes: [{ value: { metadata: { phone_number_id: '1111' }, contacts: [{ wa_id: '919733333331', profile: { name: 'Meta Lead' } }], messages: [{ from: '919733333331', id: 'wamid.x', type: 'text', text: { body: 'Price?' }, referral: ref('999', 'Meta ad') }] } }] }] });
  await say(d.from, d.text, d);
  const c = await waitFor(() => convOf('919733333331'));
  assert.deepEqual([c.name, c.ad?.id, c.ad?.headline], ['Meta Lead', '999', 'Meta ad']);
});

test('Ads page: WhatsApp chats per ad', async () => {
  const r = (await api('/ads/whatsapp?days=30', 'GET', null, T)).data;
  const by = (id) => r.rows.find((x) => x.adId === id);
  assert.deepEqual([by('120055').chats, by('777').chats, by('888').chats, by('999').chats], [1, 1, 1, 1]);
  assert.equal(r.totals.chats, 4);
  assert.equal(by('120055').headline, 'Diwali yoga offer');
  assert.equal((await api('/ads/whatsapp', 'GET')).status, 401);
});
