// Meta's Marketing Messages API for broadcasts (Meta direct): marketing templates go to /marketing_messages once the
// WhatsApp Business Account is onboarded; utility templates, accounts that aren't onboarded and a failed MM call use
// /messages. The route each message took is counted on the broadcast. A fake Graph API runs locally.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { startServer, register } from './helpers.mjs';

const WABA = '102290129340398', PN = '106540352242922';
const calls = [];
const state = { onboarding: 'ELIGIBLE', mmFail: false };
const CATEGORY = { diwali_offer: 'MARKETING', sale_fail: 'MARKETING', order_update: 'UTILITY' };
const until = async (fn, ms = 5000) => { const end = Date.now() + ms; while (Date.now() < end) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, 50)); } return fn(); };
let graph, srv, api, T, f;

before(async () => {
  graph = http.createServer((req, res) => {
    let b = '';
    req.on('data', (c) => { b += c; });
    req.on('end', () => {
      const u = new URL(req.url, 'http://x');
      calls.push({ method: req.method, path: u.pathname, query: u.search, body: b ? JSON.parse(b) : null });
      const out = (code, d) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(d)); };
      if (req.method === 'GET' && u.pathname === `/${WABA}`) return out(200, { id: WABA, marketing_messages_onboarding_status: state.onboarding });
      if (req.method === 'GET' && u.pathname === `/${WABA}/message_templates`) { const name = u.searchParams.get('name'); return out(200, { data: [{ name, language: 'en', category: CATEGORY[name] || 'MARKETING' }] }); }
      if (u.pathname === `/${PN}/marketing_messages` && state.mmFail) return out(400, { error: { message: 'Marketing Messages API unavailable', code: 131063 } });
      if (req.method === 'POST') return out(200, { messaging_product: 'whatsapp', messages: [{ id: `wamid.${calls.length}` }] });
      out(404, { error: { message: 'not found' } });
    });
  }).listen(0);
  await new Promise((r) => setTimeout(r, 50));
  srv = await startServer({ WHATSAPP_GRAPH_URL: `http://127.0.0.1:${graph.address().port}`, BROADCAST_TICK_MS: '100' });
  api = srv.api;
  T = (await register(api)).token;
  f = (await api('/templates/yoga/use', 'POST', {}, T)).data;
  await api(`/funnels/${f.id}`, 'PUT', { published: true }, T);
  const lead = (email, name, phone) => api(`/public/${f.slug}/lead`, 'POST', { stepId: f.steps[0].id, email, name, phone, consent: true });
  await lead('asha@example.com', 'Asha Rao', '9811100001');
  await lead('vikram@example.com', 'Vikram Singh', '9811100002');
});
after(async () => { await srv.stop(); graph.close(); });

const sends = (path) => calls.filter((c) => c.method === 'POST' && c.path === `/${PN}/${path}`);
async function broadcast(template) {
  const b = (await api('/broadcasts', 'POST', { name: template, channel: 'whatsapp', wa: { template, language: 'en' }, segment: {} }, T)).data;
  const r = await api(`/broadcasts/${b.id}/send`, 'POST', {}, T);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return until(async () => { const d = (await api(`/broadcasts/${b.id}`, 'GET', null, T)).data; return d.status === 'sent' && d; });
}

test('settings show the status; eligible but terms not accepted → marketing templates still go to /messages', async () => {
  const c = (await api('/channels/whatsapp', 'PUT', { phoneNumberId: PN, businessId: WABA, token: 'EAAG-test' }, T)).data;
  assert.equal(c.whatsapp.mm.status, 'unknown');
  const checked = await api('/channels/whatsapp/mm/check', 'POST', {}, T);
  assert.equal(checked.status, 200);
  assert.equal(checked.data.whatsapp.mm.status, 'terms');
  assert.ok(calls.some((x) => x.path === `/${WABA}` && x.query.includes('marketing_messages_onboarding_status')));
  const n = sends('messages').length;
  const d = await broadcast('diwali_offer');
  assert.equal(d.stats.sent, 2);
  assert.ok(!d.stats.mm);
  assert.equal(sends('messages').length, n + 2);
  assert.equal(sends('marketing_messages').length, 0);
});

test('onboarded → a marketing template goes to /marketing_messages and is counted', async () => {
  state.onboarding = 'ONBOARDED';
  assert.equal((await api('/channels/whatsapp/mm/check', 'POST', {}, T)).data.whatsapp.mm.status, 'on');
  const before = sends('messages').length;
  const d = await broadcast('diwali_offer');
  assert.equal(d.stats.sent, 2);
  assert.equal(d.stats.mm, 2);
  const mm = sends('marketing_messages');
  assert.equal(mm.length, 2);
  assert.equal(mm[0].body.type, 'template');
  assert.equal(mm[0].body.template.name, 'diwali_offer');
  assert.equal(mm[0].body.recipient_type, 'individual');
  assert.equal(sends('messages').length, before, 'nothing went through /messages');
});

test('onboarded → a utility template still goes to /messages', async () => {
  const mmBefore = sends('marketing_messages').length, before = sends('messages').length;
  const d = await broadcast('order_update');
  assert.equal(d.stats.sent, 2);
  assert.ok(!d.stats.mm);
  assert.equal(sends('marketing_messages').length, mmBefore);
  assert.equal(sends('messages').length, before + 2);
});

test('a Graph error on /marketing_messages falls back to /messages once per message', async () => {
  state.mmFail = true;
  const mmBefore = sends('marketing_messages').length, before = sends('messages').length;
  const d = await broadcast('sale_fail');
  assert.equal(d.stats.sent, 2);
  assert.equal(d.stats.failed || 0, 0);
  assert.ok(!d.stats.mm);
  assert.equal(sends('marketing_messages').length, mmBefore + 2);
  assert.equal(sends('messages').length, before + 2);
  state.mmFail = false;
});

test('a test send from a broadcast never uses the Marketing Messages API', async () => {
  const b = (await api('/broadcasts', 'POST', { name: 't', channel: 'whatsapp', wa: { template: 'diwali_offer', language: 'en' }, segment: {} }, T)).data;
  const mmBefore = sends('marketing_messages').length;
  assert.equal((await api(`/broadcasts/${b.id}/test`, 'POST', { phone: '9811100009' }, T)).status, 200);
  assert.equal(sends('marketing_messages').length, mmBefore);
});
