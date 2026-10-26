// Sarvam AI for Indian languages, against fake Sarvam and Hive WhatsApp servers: a short voice note goes through the
// quick endpoint, a long one through a batch job; the transcript is what chatbots, keyword rules, the team and the
// contact's timeline see. A scanned Hindi page is read by Sarvam's Document AI; a question in Hindi script is
// translated so it finds an English document.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { zipSync, strToU8 } from 'fflate';
import { PDFDocument } from 'pdf-lib';
import { startServer, register } from './helpers.mjs';

const KEY = 'hk_test_ok_supersecret_123', SKEY = 'sarvam_test_key_123456';
const fake = { sent: [], hook: null, n: 0, stt: [], jobs: {}, doc: [], tr: [] };
let hive, sarvam, srv, api, T;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms = 8000) { for (let t = 0; t < ms; t += 60) { const v = await fn(); if (v) return v; await wait(60); } return fn(); }
const listen = (s) => new Promise((r) => s.listen(0, '127.0.0.1', r));
const raw = (req) => new Promise((r) => { const p = []; req.on('data', (d) => p.push(d)); req.on('end', () => r(Buffer.concat(p))); });
const json = (res, s, o) => { res.writeHead(s, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
// an Ogg voice note of the given length (only the last page's granule position matters)
const ogg = (seconds) => { const b = Buffer.alloc(64, 1); b.write('OggS', 0); b.write('OggS', 20); b.writeBigUInt64LE(BigInt(Math.round(seconds * 48000)), 26); return b; };
const notes = { med_short: ogg(12), med_long: ogg(95) };

before(async () => {
  hive = http.createServer(async (req, res) => {
    const b = await raw(req), p = new URL(req.url, 'http://x').pathname.replace(/^\/wa\/v1/, '');
    const j = /json/.test(req.headers['content-type'] || '') && b.length ? JSON.parse(b) : null;
    if (req.headers.authorization !== `Bearer ${KEY}`) return json(res, 401, { error: 'bad key' });
    const route = `${req.method} ${p}`;
    if (route === 'GET /me') return json(res, 200, { workspace_id: 'ws_1' });
    if (route === 'GET /numbers') return json(res, 200, { numbers: [{ id: 'ch_1', display: '919800000001', phone_number_id: '1111' }] });
    if (route === 'PUT /webhooks') { fake.hook = j; return json(res, 200, { ok: true }); }
    if (route === 'POST /messages') { fake.sent.push(j); return json(res, 202, { id: `msg_${++fake.n}` }); }
    const m = /^\/media\/(\w+)$/.exec(p);
    if (m && notes[m[1]]) { res.writeHead(200, { 'content-type': 'audio/ogg; codecs=opus' }); return res.end(notes[m[1]]); }
    json(res, 404, { error: 'not found' });
  });
  sarvam = http.createServer(async (req, res) => {
    const b = await raw(req), url = new URL(req.url, 'http://x'), p = url.pathname;
    // the batch job's upload and result links (stand-ins for Azure blob URLs)
    if (p.startsWith('/blob/')) {
      const id = p.split('/')[2];
      if (req.method === 'PUT') { fake.jobs[id].uploaded = { size: b.length, type: req.headers['x-ms-blob-type'] }; res.writeHead(201); return res.end(); }
      return json(res, 200, { transcript: 'मुझे 3 kW सोलर का दाम बताइए और subsidy कितनी मिलेगी', language_code: 'hi-IN' });
    }
    if (p === '/zip/doc') { res.writeHead(200, { 'content-type': 'application/zip' }); return res.end(Buffer.from(zipSync({ 'document.md': strToU8('# मूल्य सूची'), 'metadata/page_001.json': strToU8(JSON.stringify({ page_num: 1, markdown: 'मूल्य सूची: सोफा SF-9 — ₹42,000 · डाइनिंग टेबल DT-2 — ₹28,500' })) }))); }
    if (req.headers['api-subscription-key'] !== SKEY) return json(res, 403, { error: { message: 'Invalid API key' } });
    const j = /json/.test(req.headers['content-type'] || '') && b.length ? JSON.parse(b) : null;
    const base = `http://127.0.0.1:${sarvam.address().port}`;
    if (p === '/speech-to-text') {
      const form = await new Response(b, { headers: { 'content-type': req.headers['content-type'] } }).formData();
      fake.stt.push({ model: form.get('model'), lang: form.get('language_code'), size: form.get('file').size });
      return json(res, 200, { request_id: 'r1', transcript: 'Hello, price list bhejo please', language_code: 'en-IN' });
    }
    if (p === '/speech-to-text/job/v1') { const id = `job${Object.keys(fake.jobs).length + 1}`; fake.jobs[id] = { params: j.job_parameters, polls: 0 }; return json(res, 200, { job_id: id }); }
    if (p === '/speech-to-text/job/v1/upload-files') return json(res, 200, { upload_urls: Object.fromEntries(j.files.map((f) => [f, { file_url: `${base}/blob/${j.job_id}/${f}` }])) });
    const st = /^\/speech-to-text\/job\/v1\/(\w+)\/(start|status)$/.exec(p);
    if (st?.[2] === 'start') { fake.jobs[st[1]].started = true; return json(res, 200, { job_id: st[1], job_state: 'Pending' }); }
    if (st?.[2] === 'status') { const x = fake.jobs[st[1]]; x.polls++; return json(res, 200, { job_id: st[1], job_state: x.polls > 1 ? 'Completed' : 'Running', job_details: [{ inputs: [{ file_name: 'voice.ogg' }], outputs: [{ file_name: '0.json' }], state: 'Success' }] }); }
    if (p === '/speech-to-text/job/v1/download-files') return json(res, 200, { download_urls: { [j.files[0]]: { file_url: `${base}/blob/${j.job_id}/out` } } });
    if (p === '/doc-ai/v1/job/digitise') {
      const form = await new Response(b, { headers: { 'content-type': req.headers['content-type'] } }).formData();
      fake.doc.push({ language: form.get('language'), format: form.get('output_format'), name: form.get('file').name });
      return json(res, 200, { job_id: 'doc1', status: 'pending' });
    }
    if (p === '/doc-ai/v1/job/doc1/status') return json(res, 200, { job_id: 'doc1', status: 'completed', usage: { pages_processed: 1, pages_total: 1 } });
    if (p === '/doc-ai/v1/job/doc1/download-url') return json(res, 200, { method: 'GET', url: `${base}/zip/doc` });
    if (p === '/translate') { fake.tr.push(j); return json(res, 200, { translated_text: /वारंटी/.test(j.input) ? 'How many years is the warranty' : 'Hello', source_language_code: 'hi-IN' }); }
    json(res, 404, { error: { message: 'not found' } });
  });
  await listen(hive); await listen(sarvam);
  srv = await startServer({ HIVE_WA_API_URL: `http://127.0.0.1:${hive.address().port}/wa/v1`, SARVAM_API_KEY: SKEY, SARVAM_BASE_URL: `http://127.0.0.1:${sarvam.address().port}`, SARVAM_POLL_MS: '50', WA_KNOW_TICK_MS: '100' });
  api = srv.api;
  T = (await register(api)).token;
  await api('/channels/whatsapp/hive', 'PUT', { apiKey: KEY }, T);
  await api('/channels/whatsapp/hive/webhook', 'POST', {}, T);
});
after(async () => { await srv.stop(); hive.close(); sarvam.close(); });

async function hook(event, data) {
  const id = `whd_${crypto.randomUUID()}`, ts = Date.now();
  const body = JSON.stringify({ id, event, created_at: new Date(ts).toISOString(), number: { id: 'ch_1', display: '919800000001', phone_number_id: '1111' }, data });
  const sig = `sha256=${crypto.createHmac('sha256', fake.hook.secret).update(body).digest('hex')}`;
  await fetch(srv.base + new URL(fake.hook.url).pathname, { method: 'POST', headers: { 'content-type': 'application/json', 'x-hive-signature': sig, 'x-hive-event': event, 'x-hive-delivery-id': id, 'x-hive-timestamp': String(ts) }, body });
}
const conv = async (num) => (await api('/inbox', 'GET', null, T)).data.convs.find((c) => c.num === num);

test('a short voice note is transcribed on the quick endpoint, and a keyword chatbot answers what was said', async () => {
  const f = (await api('/waflows', 'POST', { template: 'lead_capture' }, T)).data;
  await api(`/waflows/${f.id}`, 'PUT', { trigger: { type: 'keyword', keywords: ['price list'] }, active: true }, T);
  const num = '919700000201';
  await hook('message.inbound', { from: num, type: 'audio', text: '', media: { id: 'med_short' }, contact_name: 'Ravi' });
  await waitFor(() => fake.sent.filter((m) => m.to === num).length === 1);
  assert.match(fake.sent.find((m) => m.to === num).text.body, /May I know your name/, 'the transcript started the keyword chatbot');
  assert.deepEqual([fake.stt[0].model, fake.stt[0].lang], ['saaras:v4', 'unknown']);
  const c = await conv(num);
  const m = (await api(`/inbox/${c.id}`, 'GET', null, T)).data.messages.find((x) => x.media);
  assert.deepEqual([m.text, m.transcribed, m.lang, m.media.type], ['Hello, price list bhejo please', true, 'en-IN', 'audio']);
  const tl = (await api(`/contacts/${encodeURIComponent(c.ckey)}`, 'GET', null, T)).data.timeline;
  assert.ok(tl.some((x) => x.title === 'WhatsApp voice note: Hello, price list bhejo please'));
});

test('a voice note over 30 seconds goes through a batch job (upload, start, poll, download)', async () => {
  const num = '919700000202';
  await hook('message.inbound', { from: num, type: 'audio', text: '', media: { id: 'med_long' } });
  const c = await waitFor(async () => { const x = await conv(num); return x?.lastText?.startsWith('🎤') && x; });
  assert.ok(c, 'transcribed');
  assert.match(c.lastText, /सोलर का दाम/);
  const job = fake.jobs.job1;
  assert.deepEqual(job.params, { model: 'saaras:v4', language_code: 'unknown' });
  assert.equal(job.uploaded.type, 'BlockBlob');
  assert.equal(job.started, true);
  assert.equal(fake.stt.length, 1, 'the quick endpoint wasn’t tried for a 95-second note');
  // nobody automatic on this chat: the team is notified with the words, not "[audio]"
  const n = (await api('/notifications', 'GET', null, T)).data.items.find((x) => x.link === `/inbox/${c.id}`);
  assert.match(n.body, /सोलर/);
});

test('a scanned page in Hindi is read by Sarvam; a Hindi-script question finds an English document', async () => {
  const T2 = (await register(api)).token;
  const up = async (name, buf) => (await fetch(`${srv.base}/api/vault/files`, { method: 'POST', headers: { authorization: `Bearer ${T2}`, 'content-type': 'application/octet-stream', 'x-file-name': encodeURIComponent(name) }, body: buf })).json();
  // a scanned page: one picture, no text layer
  const crc = (b) => { const c = Buffer.alloc(4); c.writeUInt32BE(zlib.crc32(b) >>> 0); return c; };
  const part = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); return Buffer.concat([l, td, crc(td)]); };
  const ih = Buffer.alloc(13); ih.writeUInt32BE(300, 0); ih.writeUInt32BE(200, 4); ih[8] = 8; ih[9] = 2;
  const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), part('IHDR', ih), part('IDAT', zlib.deflateSync(Buffer.concat(Array.from({ length: 200 }, () => Buffer.concat([Buffer.from([0]), Buffer.alloc(900, 200)]))))), part('IEND', Buffer.alloc(0))]);
  const scan = await PDFDocument.create();
  scan.addPage([300, 200]).drawImage(await scan.embedPng(png), { x: 0, y: 0, width: 300, height: 200 });
  const f = await up('Hindi price list.pdf', Buffer.from(await scan.save()));
  await api('/wa-agent/docs', 'POST', { fileIds: [f.id], kind: 'document' }, T2);
  const d0 = (await api('/wa-agent/docs', 'GET', null, T2)).data;
  assert.equal(d0.indic, true);
  assert.equal(d0.languages['hi-IN'], 'Hindi');
  // the seller says it's in Hindi: Sarvam reads it
  await api(`/wa-agent/docs/${d0.docs[0].id}`, 'PATCH', { lang: 'hi-IN' }, T2);
  const d = await waitFor(async () => { const x = (await api('/wa-agent/docs', 'GET', null, T2)).data.docs[0]; return x.status === 'ready' && x.lang === 'hi-IN' && x; });
  assert.ok(d, JSON.stringify((await api('/wa-agent/docs', 'GET', null, T2)).data.docs));
  assert.match(d.note, /1 page in Indian scripts read/);
  assert.deepEqual([fake.doc.at(-1).language, fake.doc.at(-1).format], ['hi-IN', 'md']);
  const s = (await api('/wa-agent/search', 'POST', { q: 'सोफा' }, T2)).data;
  assert.match(s.passages[0].text, /सोफा SF-9 — ₹42,000/);

  // an English document, a question in Hindi script: translated, then found
  const g = await up('Warranty.docx', Buffer.from(zipSync({ 'word/document.xml': strToU8('<w:document><w:body><w:p><w:r><w:t>Warranty: 25 years on panels.</w:t></w:r></w:p></w:body></w:document>') })));
  await api('/wa-agent/docs', 'POST', { fileIds: [g.id] }, T2);
  await waitFor(async () => (await api('/wa-agent/docs', 'GET', null, T2)).data.docs.find((x) => x.name === 'Warranty.docx')?.status === 'ready');
  const r = (await api('/wa-agent/search', 'POST', { q: 'पैनल पर कितने साल की वॉरंटी है?' }, T2)).data;
  assert.equal(r.passages[0]?.doc, 'Warranty.docx');
  assert.deepEqual([fake.tr.at(-1).source_language_code, fake.tr.at(-1).target_language_code, fake.tr.at(-1).model], ['auto', 'en-IN', 'mayura:v1']);
});
