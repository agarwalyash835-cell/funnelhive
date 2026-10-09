// Broadcasts: segments (type, tags, funnel), unsubscribed contacts left out, personalised emails sent by the
// background job with tracking + unsubscribe, WhatsApp templates, scheduling and cancelling.
// A tiny SMTP sink and a fake WhatsApp Graph API run locally, so nothing leaves the machine.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import http from 'node:http';
import { startServer, register } from './helpers.mjs';

const mails = [], wa = [];
const readable = (m) => Buffer.from(m.replace(/\n[ \t]+/g, ' ').replace(/=\?UTF-8\?Q\?(.+?)\?=/gi, (x, q) => q.replace(/_/g, ' ')).replace(/=\n/g, '').replace(/=([0-9A-F]{2})/g, (x, h) => String.fromCharCode(parseInt(h, 16))), 'latin1').toString('utf8');
const until = async (fn, ms = 5000) => { const end = Date.now() + ms; while (Date.now() < end) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, 50)); } return fn(); };
const k = (key) => encodeURIComponent(key);
let smtp, graph, srv, api, T, f;

before(async () => {
  smtp = net.createServer((sock) => {
    let buf = '', data = false, cur = '';
    sock.write('220 sink\r\n');
    sock.on('data', (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf('\r\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 2);
        if (data) { if (line === '.') { data = false; mails.push(readable(cur)); cur = ''; sock.write('250 queued\r\n'); } else cur += `${line}\n`; continue; }
        const c = line.slice(0, 4).toUpperCase();
        if (c === 'EHLO' || c === 'HELO') sock.write('250-sink\r\n250 AUTH PLAIN\r\n');
        else if (c === 'AUTH') sock.write('235 ok\r\n');
        else if (c === 'DATA') { data = true; sock.write('354 go\r\n'); }
        else if (c === 'QUIT') { sock.write('221 bye\r\n'); sock.end(); }
        else sock.write('250 ok\r\n');
      }
    });
  }).listen(0);
  graph = http.createServer((req, res) => {
    let b = '';
    req.on('data', (c) => { b += c; });
    req.on('end', () => { wa.push(JSON.parse(b || '{}')); res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ messages: [{ id: `wamid.${wa.length}` }] })); });
  }).listen(0);
  await new Promise((r) => setTimeout(r, 50));
  srv = await startServer({ WHATSAPP_GRAPH_URL: `http://127.0.0.1:${graph.address().port}`, BROADCAST_TICK_MS: '100', APP_URL: 'http://app.example.test' });
  api = srv.api;
  T = (await register(api)).token;
  f = (await api('/templates/yoga/use', 'POST', {}, T)).data;
  await api(`/funnels/${f.id}`, 'PUT', { published: true }, T);
  const lead = (email, name, phone) => api(`/public/${f.slug}/lead`, 'POST', { stepId: f.steps[0].id, email, name, phone });
  await lead('asha@example.com', 'Asha Rao', '9811100001');
  await lead('vikram@example.com', 'Vikram Singh', '9811100002');
  await lead('meera@example.com', 'Meera Das');
  await lead('gone@example.com', 'Gone Person', '9811100004');
  await api(`/contacts/${k('asha@example.com')}`, 'PATCH', { tags: ['vip'] }, T);
  await api(`/contacts/${k('vikram@example.com')}`, 'PATCH', { tags: ['vip', 'cold'] }, T);
});
after(async () => { await srv.stop(); smtp.close(); graph.close(); });

test('audience: filters by tags, excludes tags, and leaves out unsubscribed / unreachable contacts', async () => {
  const all = (await api('/broadcasts/audience', 'POST', { channel: 'email', segment: {} }, T)).data;
  assert.equal(all.reach, 4);
  const vip = (await api('/broadcasts/audience', 'POST', { channel: 'email', segment: { tags: ['VIP'], notTags: ['cold'] } }, T)).data;
  assert.equal(vip.reach, 1);
  assert.equal(vip.sample[0].email, 'asha@example.com');
  const waA = (await api('/broadcasts/audience', 'POST', { channel: 'whatsapp', segment: {} }, T)).data;
  assert.equal(waA.reach, 3);
  assert.equal(waA.left.noAddress, 1, 'Meera has no phone');
  assert.equal((await api('/broadcasts/audience', 'POST', { channel: 'email', segment: { type: 'customers' } }, T)).data.reach, 0);
});

test('a draft can’t be sent until email is set up; then it goes out personalised, tracked and unsubscribable', async () => {
  const b = (await api('/broadcasts', 'POST', { name: 'Diwali', channel: 'email', subject: 'Happy Diwali {{first_name}} 🪔', body: 'Hi {{first_name}}, 30% off this week: https://example.com/sale', segment: {} }, T)).data;
  assert.equal(b.status, 'draft');
  const blocked = await api(`/broadcasts/${b.id}/send`, 'POST', {}, T);
  assert.equal(blocked.status, 400);
  assert.match(blocked.data.error, /SMTP/);
  await api('/channels/email', 'PUT', { host: '127.0.0.1', port: smtp.address().port, secure: false, user: 'me', pass: 'x', fromName: 'Yoga Studio' }, T);
  // one contact unsubscribes before it goes out
  await api(`/contacts/${k('gone@example.com')}`, 'PATCH', { tags: [] }, T);
  const test1 = await api(`/broadcasts/${b.id}/test`, 'POST', {}, T);
  assert.equal(test1.status, 200);
  assert.ok(mails.some((m) => m.includes('[Test] Happy Diwali')));
  const before = mails.length;
  assert.equal((await api(`/broadcasts/${b.id}/send`, 'POST', {}, T)).data.status, 'scheduled');
  const done = await until(async () => { const d = (await api(`/broadcasts/${b.id}`, 'GET', null, T)).data; return d.status === 'sent' && d; });
  assert.ok(done, 'finished');
  assert.equal(done.stats.total, 4);
  assert.equal(done.stats.sent, 4);
  const sent = mails.slice(before);
  const asha = sent.find((m) => m.includes('Happy Diwali Asha'));
  assert.ok(asha);
  assert.match(asha, /Hi Asha, 30% off/);
  assert.match(asha, /List-Unsubscribe: <http:\/\/app\.example\.test\/u\//);
  assert.equal((await api(`/broadcasts/${b.id}`, 'PUT', { subject: 'x' }, T)).status, 400, 'sent broadcasts are locked');
  // a click is recorded (and counts as an open)
  const link = /href="http:\/\/app\.example\.test(\/t\/c\/[^"]+)"/.exec(asha)[1].replace(/&amp;/g, '&');
  const r = await fetch(srv.base + link, { redirect: 'manual' });
  assert.equal(r.headers.get('location'), 'https://example.com/sale');
  const after1 = (await api(`/broadcasts/${b.id}`, 'GET', null, T)).data;
  assert.equal(after1.stats.clicked, 1);
  assert.equal(after1.stats.opened, 1);
  const c = (await api(`/contacts/${k('asha@example.com')}`, 'GET', null, T)).data;
  assert.ok(c.timeline.some((t) => t.title === 'Broadcast sent: Happy Diwali Asha 🪔'));
  // unsubscribing leaves them out of the next broadcast
  const unsub = /Unsubscribe: (http:\/\/app\.example\.test\/u\/\S+)/.exec(sent.find((m) => m.includes('Happy Diwali Gone')))[1].replace('http://app.example.test', srv.base);
  await fetch(unsub);
  const a2 = (await api('/broadcasts/audience', 'POST', { channel: 'email', segment: {} }, T)).data;
  assert.equal(a2.reach, 3);
  assert.equal(a2.left.unsubscribed, 1);
});

test('WhatsApp broadcasts send the approved template with personalised parameters', async () => {
  await api('/channels/whatsapp', 'PUT', { phoneNumberId: '1234567890', token: 'EAAG-test' }, T);
  const b = (await api('/broadcasts', 'POST', { name: 'Reminder', channel: 'whatsapp', wa: { template: 'class_reminder', language: 'en', params: '{{first_name}}' }, segment: { tags: ['vip'] } }, T)).data;
  await api(`/broadcasts/${b.id}/send`, 'POST', {}, T);
  const done = await until(async () => { const d = (await api(`/broadcasts/${b.id}`, 'GET', null, T)).data; return d.status === 'sent' && d; });
  assert.equal(done.stats.sent, 2);
  const names = wa.filter((m) => m.template?.name === 'class_reminder').map((m) => m.template.components[0].parameters[0].text).sort();
  assert.deepEqual(names, ['Asha', 'Vikram']);
  const bad = (await api('/broadcasts', 'POST', { channel: 'whatsapp', wa: { template: 'Not A Template!' } }, T)).data;
  assert.equal((await api(`/broadcasts/${bad.id}/send`, 'POST', {}, T)).status, 400);
});

test('scheduled broadcasts wait, can be cancelled back to a draft, and belong to their owner', async () => {
  const b = (await api('/broadcasts', 'POST', { name: 'Later', channel: 'email', subject: 'Soon', body: 'Hello {{first_name}}', segment: {} }, T)).data;
  const s = (await api(`/broadcasts/${b.id}/send`, 'POST', { at: Date.now() + 3600000 }, T)).data;
  assert.equal(s.status, 'scheduled');
  await new Promise((r) => setTimeout(r, 400));
  assert.equal((await api(`/broadcasts/${b.id}`, 'GET', null, T)).data.status, 'scheduled', 'not before its time');
  assert.equal((await api(`/broadcasts/${b.id}`, 'PUT', { subject: 'Sooner' }, T)).data.subject, 'Sooner', 'editable until it starts');
  const other = (await register(api)).token;
  assert.equal((await api(`/broadcasts/${b.id}`, 'GET', null, other)).status, 404);
  assert.equal((await api(`/broadcasts/${b.id}/cancel`, 'POST', {}, other)).status, 404);
  assert.equal((await api(`/broadcasts/${b.id}/cancel`, 'POST', {}, T)).data.status, 'draft');
  assert.equal((await api(`/broadcasts/${b.id}`, 'DELETE', null, T)).status, 200);
});
