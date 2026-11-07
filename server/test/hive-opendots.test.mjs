// Hive's workspace abilities: the open web (search through a search API, read public pages — never this machine or a
// private network), the Vault (find, read and save files), files attached in the chat, and the seller's other
// connected apps (Gmail, Calendar, Sheets, Drive) — reading runs, anything that sends or changes waits for an OK.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { startServer, register } from './helpers.mjs';

let srv, api, T, H, W, brave;
before(async () => {
  brave = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    if (req.headers['x-subscription-token'] !== 'test-key') { res.writeHead(401); return res.end('{}'); }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ web: { results: [{ title: `Flats in <strong>${u.searchParams.get('q')}</strong>`, url: 'https://example.com/baner', description: 'From &#8377;1.2 Cr', age: '2 days ago' }] } }));
  });
  await new Promise((r) => brave.listen(0, '127.0.0.1', r));
  srv = await startServer();
  api = srv.api;
  T = (await register(api)).token;
  await import('../sales.js'); // the app's own module order (hive.js alone makes a loop)
  H = await import('../hive.js');
  W = await import('../hive-web.js');
});
after(async () => { await srv?.stop(); brave.close(); });
const tool = (name) => H.TOOLS.find((t) => t.name === name);

test('web: pages are read only from the public web; text comes out clean', async () => {
  for (const u of ['http://localhost:4000', 'http://127.0.0.1/admin', 'http://169.254.169.254/latest/meta-data', 'http://10.0.0.5/', 'http://[::1]/', 'file:///etc/passwd', 'http://user:pw@example.com']) {
    await assert.rejects(tool('read_web_page').run({}, { url: u }), /public web|Only http|login/, u);
  }
  assert.equal(W.publicIp('8.8.8.8'), true);
  assert.equal(W.publicIp('::ffff:192.168.1.1'), false);
  const p = W.pageText('<title>Aranya &amp; Co</title><body><nav>Menu</nav><h1>2 BHK</h1><script>track()</script><p>From ₹1.28 Cr</p></body>');
  assert.deepEqual([p.title, p.text], ['Aranya & Co', '2 BHK\nFrom ₹1.28 Cr']);
});

test('web search: off without a key (says so); with one, results come back clean', async () => {
  delete process.env.BRAVE_SEARCH_API_KEY;
  await assert.rejects(tool('web_search').run({}, { query: 'flats in Baner' }), /isn’t switched on/);
  process.env.BRAVE_SEARCH_API_KEY = 'test-key';
  process.env.BRAVE_SEARCH_URL = `http://127.0.0.1:${brave.address().port}/res/v1/web/search`;
  const r = await tool('web_search').run({}, { query: 'Baner' });
  assert.deepEqual(r.results[0], { title: 'Flats in Baner', url: 'https://example.com/baner', snippet: 'From ₹1.2 Cr', age: '2 days ago' });
  delete process.env.BRAVE_SEARCH_API_KEY;
});

test('Vault: Hive saves a note, finds it and reads it back', async () => {
  const ctx = { call: async (method, path, body) => { const r = await api(path, method, body, T); if (r.status >= 400) throw new Error(r.data.error); return r.data; } };
  const saved = await tool('save_to_vault').run(ctx, { name: 'Aranya site visit script', text: 'Greet. Show the 3 BHK sample flat. Hand over the cost sheet.' });
  assert.equal(saved.name, 'Aranya site visit script.txt');
  const found = await tool('vault_files').run(ctx, { query: 'site visit' });
  assert.equal(found.files[0].id, saved.id);
  const read = await tool('read_vault_file').run(ctx, { fileId: saved.id });
  assert.match(read.text, /3 BHK sample flat/);
  assert.equal((await api(`/hive/vault/${saved.id}/text`, 'GET', null, (await register(api)).token)).status, 404, 'another account can’t read it');
});

test('attached files: read for the model; too-large files refused', async () => {
  const csv = Buffer.from('Flat,Price\n2 BHK,1.28 Cr\n3 BHK,1.85 Cr\n');
  const [r] = await H.readAttachments({ id: 'u1' }, [{ name: 'prices.csv', buf: csv }]);
  assert.match(r.text, /3 BHK/);
  const big = { name: 'huge.pdf', data: Buffer.alloc(7 * 1048576).toString('base64') };
  assert.equal((await api('/hive/chat', 'POST', { message: 'read this', attachments: [big] }, T)).status, 413);
});

test('connected apps: Gmail / Calendar / Sheets / Drive — reading runs, sending waits for an OK naming the app', () => {
  assert.equal(H.needsOk('run_app_action', { slug: 'GMAIL_FETCH_EMAILS' }), null);
  assert.match(H.needsOk('run_app_action', { slug: 'GMAIL_SEND_EMAIL', arguments: {} }), /^In your Gmail account: send email/);
  assert.match(H.needsOk('run_app_action', { slug: 'GOOGLECALENDAR_CREATE_EVENT', arguments: {} }), /Google Calendar/);
  assert.ok(H.startGroups('read https://example.com/brochure for me').has('web'));
  assert.ok(H.startGroups('save this in my vault').has('vault'));
  assert.ok(H.startGroups('check my gmail for the bank email').has('apps'));
});
