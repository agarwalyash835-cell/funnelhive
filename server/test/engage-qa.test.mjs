// Engagement QA regressions: Indian numbers typed with a trunk 0 go to +91 (never another country), a phone-only
// contact can't be added twice in different formats, opted-out / withdrawn-consent contacts get no WhatsApp, and a
// broadcast sends once per number even when two contacts share it. A fake WhatsApp Graph API runs locally.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { startServer, register } from './helpers.mjs';

const wa = [];
const until = async (fn, ms = 5000) => { const end = Date.now() + ms; while (Date.now() < end) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, 50)); } return fn(); };
const k = (key) => encodeURIComponent(key);
let graph, srv, api, T;

before(async () => {
  graph = http.createServer((req, res) => {
    let b = '';
    req.on('data', (c) => { b += c; });
    req.on('end', () => { wa.push(JSON.parse(b || '{}')); res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ messages: [{ id: `wamid.${wa.length}` }] })); });
  }).listen(0);
  await new Promise((r) => setTimeout(r, 50));
  srv = await startServer({ WHATSAPP_GRAPH_URL: `http://127.0.0.1:${graph.address().port}`, BROADCAST_TICK_MS: '100', AUTOMATION_TICK_MS: '50', APP_URL: 'http://app.example.test' });
  api = srv.api;
  T = (await register(api)).token;
  assert.equal((await api('/channels/whatsapp', 'PUT', { phoneNumberId: '1234567890', token: 'tok' }, T)).status, 200);
});
after(async () => { await srv.stop(); graph.close(); });

// what the seller's code can't set through the API (a STOP reply sets it in production)
const optOut = (key) => { const db = new DatabaseSync(path.join(srv.dataDir, 'funnelhive.db')); db.prepare("UPDATE crm SET data = json_set(data, '$.waOptOut', json('true')) WHERE key = ?").run(key); db.close(); };

test('a number typed with its trunk 0 is sent to +91, not to another country', async () => {
  const c = await api('/contacts', 'POST', { name: 'Trunk Zero', phone: '098111 00009' }, T);
  assert.equal(c.status, 200);
  const r = await api(`/contacts/${k(c.data.key)}/whatsapp`, 'POST', { text: 'Namaste 🙏 आपका ऑर्डर तैयार है' }, T);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(wa.at(-1).to, '919811100009');
  assert.equal(wa.at(-1).text.body, 'Namaste 🙏 आपका ऑर्डर तैयार है');
});

test('the same phone number in another format is not added as a second contact', async () => {
  const again = await api('/contacts', 'POST', { name: 'Dup', phone: '+91 98111-00009' }, T);
  assert.equal(again.status, 409);
  assert.match(again.data.error, /phone number already exists/);
  assert.equal(again.data.key, 'phone:098111 00009');
  assert.equal((await api('/contacts', 'POST', { name: 'Other', phone: '+91 98111 00010' }, T)).status, 200, 'a different number is fine');
});

test('the contact screen won’t WhatsApp someone who opted out', async () => {
  optOut('phone:098111 00009');
  const n = wa.length;
  const r = await api(`/contacts/${k('phone:098111 00009')}/whatsapp`, 'POST', { text: 'Sale!' }, T);
  assert.equal(r.status, 400);
  assert.match(r.data.error, /opted out/);
  assert.equal(wa.length, n);
});

test('an automation WhatsApp step skips a contact who withdrew marketing consent', async () => {
  const key = (await api('/contacts', 'POST', { name: 'No Consent', phone: '9811100011' }, T)).data.key;
  await api(`/contacts/${k(key)}`, 'PATCH', { optIn: false }, T);
  const a = (await api('/automations', 'POST', { name: 'WA nudge', trigger: { type: 'manual' }, steps: [{ type: 'whatsapp', mode: 'template', template: 'nudge_v1', language: 'en' }] }, T)).data;
  await api(`/automations/${a.id}`, 'PUT', { active: true }, T);
  const n = wa.length;
  assert.equal((await api(`/automations/${a.id}/enroll`, 'POST', { key }, T)).status, 200);
  const run = await until(async () => { const r = (await api(`/automations/${a.id}`, 'GET', null, T)).data.runs?.[0]; return r?.status === 'done' && r; });
  assert.ok(run, 'the run finished');
  assert.match(run.log.at(-1).detail, /withdrew marketing consent/);
  assert.equal(wa.length, n, 'nothing sent');
});

test('a WhatsApp broadcast goes once to a number two contacts share', async () => {
  const consent = { optIn: true };
  const a = (await api('/contacts', 'POST', { name: 'Ravi', email: 'ravi@example.com', phone: '9811100020' }, T)).data.key;
  const b = (await api('/contacts', 'POST', { name: 'Ravi (shop)', email: 'ravi.shop@example.com', phone: '+91 98111 00020' }, T)).data.key;
  for (const key of [a, b]) await api(`/contacts/${k(key)}`, 'PATCH', { ...consent, tags: ['shared'] }, T);
  const aud = (await api('/broadcasts/audience', 'POST', { channel: 'whatsapp', segment: { tags: ['shared'] } }, T)).data;
  assert.equal(aud.reach, 1);
  assert.equal(aud.left.duplicate, 1);
  const bc = (await api('/broadcasts', 'POST', { name: 'Shared', channel: 'whatsapp', wa: { template: 'offer_v1', language: 'en' }, segment: { tags: ['shared'] } }, T)).data;
  const n = wa.length;
  assert.equal((await api(`/broadcasts/${bc.id}/send`, 'POST', {}, T)).status, 200);
  await until(async () => (await api(`/broadcasts/${bc.id}`, 'GET', null, T)).data.status === 'sent');
  await new Promise((r) => setTimeout(r, 300));
  const sent = wa.slice(n).filter((m) => m.template?.name === 'offer_v1');
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, '919811100020');
});
