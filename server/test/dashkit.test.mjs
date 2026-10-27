// The dashboard for the seller's industry (dashkit.js): a coach sees revenue first, a property broker site visits
// counted from their pipeline, a store COD orders and repeat buyers; the dashboard can be switched to another
// industry without touching the CRM. And the voice assistant's speech endpoints (talk.js), against a fake Sarvam.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { startServer, register } from './helpers.mjs';

let srv, api, T, sarvam;
const said = [];
before(async () => {
  sarvam = http.createServer((req, res) => {
    let b = [];
    req.on('data', (d) => b.push(d));
    req.on('end', () => {
      const raw = Buffer.concat(b);
      res.writeHead(200, { 'content-type': 'application/json' });
      if (req.url === '/speech-to-text') return res.end(JSON.stringify({ transcript: 'इस हफ्ते कितनी बिक्री हुई?', language_code: 'hi-IN', bytes: raw.length }));
      if (req.url === '/text-to-speech') { said.push(JSON.parse(raw)); return res.end(JSON.stringify({ audios: [Buffer.from('RIFF....WAVEfmt fake').toString('base64')] })); }
      res.end('{}');
    });
  });
  await new Promise((r) => sarvam.listen(0, '127.0.0.1', r));
  srv = await startServer({ SARVAM_API_KEY: 'sk_test', SARVAM_BASE_URL: `http://127.0.0.1:${sarvam.address().port}` });
  api = srv.api;
  T = (await register(api)).token;
});
after(async () => { await srv.stop(); sarvam.close(); });

const tile = (d, id) => d.tiles.find((t) => t.id === id || t.base === id);
test('a coach (the default) sees revenue first; a property broker sees site visits from their pipeline', async () => {
  let d = (await api('/dashboard/industry?days=30', 'GET', null, T)).data;
  assert.equal(d.industry.id, 'general');
  assert.equal(d.tiles[0].base, 'revenue');
  assert.equal(d.sales, true);
  assert.ok(tile(d, 'wa:') && tile(d, 'webinar:'));
  // the real-estate CRM: site visits are the headline, counted when someone reaches that stage
  assert.equal((await api('/crm/kit', 'POST', { id: 'realestate' }, T)).status, 200);
  const pipe = (await api('/pipelines', 'GET', null, T)).data.find((p) => p.stages.some((s) => s.name === 'Site visit scheduled'));
  const visit = pipe.stages.find((s) => s.name === 'Site visit scheduled');
  const { key } = (await api('/contacts', 'POST', { name: 'Rohan', phone: '9876500011' }, T)).data;
  assert.equal((await api(`/contacts/${encodeURIComponent(key)}`, 'PATCH', { stage: { pipelineId: pipe.id, stageId: visit.id } }, T)).status, 200);
  d = (await api('/dashboard/industry', 'GET', null, T)).data;
  assert.deepEqual([d.industry.id, d.sales, d.tiles[0].id, d.tiles[0].label, d.tiles[0].value, d.tiles[0].prev, d.tiles[0].sub, d.tiles[0].link], ['realestate', false, 'stage:Site visit scheduled', 'Site visits booked', 1, 0, '1 there now', '/contacts']);
  assert.equal(tile(d, 'leads').label, 'Enquiries');
  assert.ok(!d.tiles.some((t) => t.base === 'revenue'), 'no revenue tiles for an industry that doesn’t sell online');
});

test('switching the dashboard to another industry (the CRM stays); unknown ones are refused; "" goes back', async () => {
  assert.equal((await api('/dashboard/industry', 'PUT', { id: 'nope' }, T)).status, 400);
  let d = (await api('/dashboard/industry', 'PUT', { id: 'store' }, T)).data;
  assert.deepEqual([d.industry.id, d.chosen, d.sales, d.tiles[0].label], ['store', true, true, 'Sales']);
  assert.ok(tile(d, 'cod:') && tile(d, 'abandoned:') && tile(d, 'repeat:'));
  d = (await api('/dashboard/industry', 'PUT', { id: '' }, T)).data;
  assert.equal(d.industry.id, 'realestate', 'back to the CRM’s industry');
});

test('the voice assistant: Sarvam hears the recording (language detected) and speaks the reply', async () => {
  const st = (await api('/talk', 'GET', null, T)).data;
  assert.equal(st.sarvam, true);
  assert.ok(st.languages.some((l) => l.code === 'ta-IN'));
  const short = await fetch(`${srv.base}/api/talk/listen`, { method: 'POST', headers: { authorization: `Bearer ${T}`, 'content-type': 'audio/webm' }, body: Buffer.alloc(10) });
  assert.equal(short.status, 400);
  const r = await (await fetch(`${srv.base}/api/talk/listen`, { method: 'POST', headers: { authorization: `Bearer ${T}`, 'content-type': 'audio/webm;codecs=opus' }, body: Buffer.alloc(4000, 1) })).json();
  assert.deepEqual(r, { text: 'इस हफ्ते कितनी बिक्री हुई?', language: 'hi-IN' });
  const audio = await fetch(`${srv.base}/api/talk/speak`, { method: 'POST', headers: { authorization: `Bearer ${T}`, 'content-type': 'application/json' }, body: JSON.stringify({ text: 'इस हफ्ते *₹12,400* की बिक्री हुई — https://x.in/orders', language: 'hi-IN' }) });
  assert.equal(audio.headers.get('content-type'), 'audio/wav');
  assert.match(Buffer.from(await audio.arrayBuffer()).toString(), /RIFF/);
  assert.deepEqual([said[0].text, said[0].target_language_code], ['इस हफ्ते ₹12,400 की बिक्री हुई —', 'hi-IN'], 'formatting and links aren’t read out');
  assert.equal((await fetch(`${srv.base}/api/talk/listen`, { method: 'POST', headers: { 'content-type': 'audio/webm' }, body: Buffer.alloc(4000) })).status, 401);
});
