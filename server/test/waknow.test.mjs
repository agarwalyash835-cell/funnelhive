// The WhatsApp AI agent's documents and memory, against fake OpenRouter (embeddings), AI and Hive WhatsApp servers:
// a PDF, an Excel price list and a Word file from the Vault are read into passages, the catalogue's products are
// listed, keyword + meaning search finds the right page, the agent answers from it and attaches the catalogue;
// what the customer says is remembered (facts on the contact, a rolling summary of a long chat).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import { zipSync, strToU8 } from 'fflate';
import { startServer, register } from './helpers.mjs';

const KEY = 'hk_test_ok_supersecret_123';
const fake = { sent: [], uploads: [], hook: null, n: 0, embeds: 0, ai: [] };
let hive, model, router, srv, api, T;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms = 8000) { for (let t = 0; t < ms; t += 60) { const v = await fn(); if (v) return v; await wait(60); } return fn(); }
const listen = (s) => new Promise((r) => s.listen(0, '127.0.0.1', r));
const body = (req) => new Promise((r) => { const p = []; req.on('data', (d) => p.push(d)); req.on('end', () => { const b = Buffer.concat(p); r(/json/.test(req.headers['content-type'] || '') && b.length ? JSON.parse(b) : b); }); });
const json = (res, s, o) => { res.writeHead(s, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };

// ---- files the way sellers have them ----
function pdf(pages) {
  const objs = [];
  const kids = pages.map((_, i) => `${4 + i * 2} 0 R`).join(' ');
  objs[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objs[2] = `<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`;
  objs[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';
  pages.forEach((lines, i) => {
    const stream = `BT /F1 12 Tf 72 760 Td 14 TL ${lines.map((l) => `(${l.replace(/[()\\]/g, '')}) Tj T*`).join(' ')} ET`;
    objs[4 + i * 2] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + i * 2} 0 R >>`;
    objs[5 + i * 2] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  });
  let out = '%PDF-1.4\n';
  const at = [];
  for (let i = 1; i < objs.length; i++) { at[i] = out.length; out += `${i} 0 obj\n${objs[i]}\nendobj\n`; }
  const x = out.length;
  out += `xref\n0 ${objs.length}\n0000000000 65535 f \n${at.slice(1).map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objs.length} /Root 1 0 R >>\nstartxref\n${x}\n%%EOF`;
  return Buffer.from(out, 'latin1');
}
function xlsx(rows) {
  const strings = [...new Set(rows.flat().map(String))];
  const cell = (v, r, c) => `<c r="${String.fromCharCode(65 + c)}${r + 1}" t="s"><v>${strings.indexOf(String(v))}</v></c>`;
  return Buffer.from(zipSync({
    'xl/workbook.xml': strToU8('<workbook><sheets><sheet name="Kitchens" sheetId="1"/></sheets></workbook>'),
    'xl/sharedStrings.xml': strToU8(`<sst>${strings.map((s) => `<si><t>${s.replace(/&/g, '&amp;')}</t></si>`).join('')}</sst>`),
    'xl/worksheets/sheet1.xml': strToU8(`<worksheet><sheetData>${rows.map((r, i) => `<row r="${i + 1}">${r.map((v, c) => cell(v, i, c)).join('')}</row>`).join('')}</sheetData></worksheet>`),
  }));
}
const docx = (paras) => Buffer.from(zipSync({ 'word/document.xml': strToU8(`<w:document><w:body>${paras.map((p) => `<w:p><w:r><w:t>${p}</w:t></w:r></w:p>`).join('')}</w:body></w:document>`) }));

// a bag-of-words "embedding": texts sharing words point the same way (enough to check meaning search wiring)
const vec = (t) => { const v = new Array(1024).fill(0); for (const w of String(t).toLowerCase().match(/[a-z]{4,}/g) || []) v[[...w].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7) % 1024] += 1; if (!v.some(Boolean)) v[0] = 1; return v; };

before(async () => {
  hive = http.createServer(async (req, res) => {
    const j = await body(req), p = new URL(req.url, 'http://x').pathname.replace(/^\/wa\/v1/, '');
    if (req.headers.authorization !== `Bearer ${KEY}`) return json(res, 401, { error: 'bad key' });
    const route = `${req.method} ${p}`;
    if (route === 'GET /me') return json(res, 200, { workspace_id: 'ws_1' });
    if (route === 'GET /numbers') return json(res, 200, { numbers: [{ id: 'ch_1', display: '919800000001', phone_number_id: '1111' }] });
    if (route === 'PUT /webhooks') { fake.hook = j; return json(res, 200, { ok: true }); }
    if (route === 'POST /media') { fake.uploads.push(j.toString('latin1')); return json(res, 200, { id: `media_${fake.uploads.length}` }); }
    if (route === 'POST /messages') { fake.sent.push(j); return json(res, 202, { id: `msg_${++fake.n}`, status: 'queued' }); }
    json(res, 404, { error: 'not found' });
  });
  router = http.createServer(async (req, res) => {
    const j = await body(req);
    if (req.headers.authorization !== 'Bearer sk-or-test-key-123456') return json(res, 401, { error: { message: 'No auth' } });
    fake.embeds++;
    json(res, 200, { model: j.model, data: j.input.map((t, index) => ({ index, embedding: vec(t) })) });
  });
  model = http.createServer(async (req, res) => {
    const j = await body(req);
    const sys = String(j.instructions || ''), user = String(j.input?.at(-1)?.content || '');
    fake.ai.push({ sys, user });
    let out = {};
    if (sys.includes('list every product')) out = { products: [...user.matchAll(/Model: (\S+) · Name: ([^·\n]+) · Price: (\d+)/g)].map((m) => ({ sku: m[1], name: m[2].trim(), price: Number(m[3]), category: 'Kitchen', specs: 'Marine ply', page: 1 })) };
    else if (sys.includes('describe a business document')) out = /kitchen/i.test(user) ? { summary: 'Modular kitchen price list with every model', category: 'Kitchens' } : { summary: 'Company policies', category: 'Policies' };
    else if (sys.includes('WhatsApp assistant')) {
      const last = user.split('\n').filter((l) => l.startsWith('Customer:')).at(-1) || '';
      const doc = /DOCUMENTS YOU CAN SEND[^\n]*\n- (\w+):/.exec(sys)?.[1];
      out = { reply: /catalogue|price list/i.test(last) ? 'Sure! Sending our kitchen price list 📎' : 'Our L-shape kitchen KL-200 is *₹1,85,000*.', send: /catalogue|price list/i.test(last) && doc ? [doc, 'not-a-real-doc'] : [], facts: /budget/i.test(last) ? ['Budget is about ₹2 lakh for the kitchen'] : [], handoff: false, intent: 'pricing' };
    } else if (sys.includes('running summary')) out = { summary: 'Wants an L-shape kitchen for a 2 BHK in Wakad, budget ₹2 lakh.' };
    else if (sys.includes('lasting facts about the CUSTOMER')) out = { facts: ['Lives in Wakad, Pune'] };
    json(res, 200, { output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(out) }] }] });
  });
  await listen(hive); await listen(router); await listen(model);
  srv = await startServer({
    HIVE_WA_API_URL: `http://127.0.0.1:${hive.address().port}/wa/v1`, KIE_API_KEY: 'kie_test', KIE_BASE_URL: `http://127.0.0.1:${model.address().port}`,
    OPENROUTER_API_KEY: 'sk-or-test-key-123456', OPENROUTER_BASE_URL: `http://127.0.0.1:${router.address().port}/api/v1`, WA_KNOW_TICK_MS: '100', WA_INBOX_TICK_MS: '150',
  });
  api = srv.api;
  T = (await register(api)).token;
  await api('/channels/whatsapp/hive', 'PUT', { apiKey: KEY }, T);
  await api('/channels/whatsapp/hive/webhook', 'POST', {}, T);
});
after(async () => { await srv.stop(); hive.close(); router.close(); model.close(); });

const upload = async (name, buf, folder) => (await fetch(`${srv.base}/api/vault/files${folder ? `?folder=${folder}` : ''}`, { method: 'POST', headers: { authorization: `Bearer ${T}`, 'content-type': 'application/octet-stream', 'x-file-name': encodeURIComponent(name) }, body: buf })).json();
async function hook(event, data) {
  const id = `whd_${crypto.randomUUID()}`, ts = Date.now();
  const raw = JSON.stringify({ id, event, created_at: new Date(ts).toISOString(), number: { id: 'ch_1', display: '919800000001', phone_number_id: '1111' }, data });
  const sig = `sha256=${crypto.createHmac('sha256', fake.hook.secret).update(raw).digest('hex')}`;
  await fetch(srv.base + new URL(fake.hook.url).pathname, { method: 'POST', headers: { 'content-type': 'application/json', 'x-hive-signature': sig, 'x-hive-event': event, 'x-hive-delivery-id': id, 'x-hive-timestamp': String(ts) }, body: raw });
}
const say = (from, text) => hook('message.inbound', { from, type: 'text', text, contact_name: 'Meera Shah' });
const docs = async () => (await api('/wa-agent/docs', 'GET', null, T)).data.docs;
let catalogue, brochure;

test('Vault files become the agent’s documents: PDF pages, Excel rows, Word paragraphs; catalogues list their products', async () => {
  const folder = (await api('/wa-agent/folder', 'GET', null, T)).data.folderId;
  assert.ok(folder, 'an “AI agent knowledge” folder in the Vault');
  const xl = await upload('Kitchen price list 2026.xlsx', xlsx([['Model', 'Name', 'Price'], ['KL-200', 'L-shape kitchen', '185000'], ['KP-110', 'Parallel kitchen', '145000'], ['KU-300', 'U-shape kitchen', '230000']]), folder);
  const pd = await upload('Wardrobe brochure.pdf', pdf([['Sliding wardrobes in walnut finish', 'Soft-close hinges, 10 year warranty'], ['Installation takes 7 days', 'Free site measurement in Pune']]));
  const wd = await upload('Policies.docx', docx(['Refunds within 7 days of delivery.', 'We deliver across Pune and Mumbai.']));
  const old = await upload('Old list.doc', Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 1, 2, 3]));
  assert.equal((await api('/wa-agent/docs', 'POST', { fileIds: ['nope'] }, T)).status, 400);
  assert.equal((await api('/wa-agent/docs', 'POST', { fileIds: [xl.id], kind: 'catalogue' }, T)).status, 200);
  await api('/wa-agent/docs', 'POST', { fileIds: [pd.id, wd.id, old.id] }, T);
  // ready (keywords) first, the meaning-search vectors right after
  const all = await waitFor(async () => { const l = await docs(); return l.every((d) => d.status === 'failed' || (d.status === 'ready' && d.vectors > 0)) && l; });
  catalogue = all.find((d) => d.name.startsWith('Kitchen'));
  brochure = all.find((d) => d.name.startsWith('Wardrobe'));
  assert.equal(catalogue.status, 'ready', JSON.stringify(catalogue));
  assert.equal(catalogue.kind, 'catalogue');
  assert.equal(catalogue.products, 3);
  assert.equal(catalogue.summary, 'Modular kitchen price list with every model');
  assert.ok(catalogue.vectors > 0, 'meaning-search vectors made');
  assert.equal(brochure.status, 'ready');
  assert.equal(brochure.pages, 2);
  assert.equal(all.find((d) => d.name === 'Policies.docx').status, 'ready');
  const o = all.find((d) => d.name === 'Old list.doc');
  assert.equal(o.status, 'failed');
  assert.match(o.error, /save it as \.docx or PDF/);
  const prods = (await api(`/wa-agent/docs/${catalogue.id}/products`, 'GET', null, T)).data.products;
  assert.deepEqual(prods.map((p) => [p.sku, p.price]).sort(), [['KL-200', 185000], ['KP-110', 145000], ['KU-300', 230000]]);
  assert.ok(fake.ai.find((x) => x.sys.includes('list every product')).user.includes('Model: KL-200 · Name: L-shape kitchen · Price: 185000'), 'Excel rows read as “Header: value” lines');
});

test('search: keywords (model numbers) and meaning, merged; the right products and documents come back', async () => {
  const bySku = (await api('/wa-agent/search', 'POST', { q: 'price of KU-300?' }, T)).data;
  assert.equal(bySku.products[0].sku, 'KU-300');
  assert.equal(bySku.docs[0].id, catalogue.id);
  const byWords = (await api('/wa-agent/search', 'POST', { q: 'how long does wardrobe installation take' }, T)).data;
  assert.equal(byWords.passages[0].doc, 'Wardrobe brochure.pdf');
  assert.equal(byWords.passages[0].page, 2);
  assert.match(byWords.passages[0].text, /Installation takes 7 days/);
  // a document the seller doesn't want sent is still used for answers, but never attached
  await api(`/wa-agent/docs/${brochure.id}`, 'PATCH', { send: false }, T);
  assert.ok(!(await api('/wa-agent/search', 'POST', { q: 'wardrobe installation' }, T)).data.docs.some((d) => d.id === brochure.id));
});

test('the agent answers from the documents, attaches the catalogue it was offered, and remembers the customer', async () => {
  await api('/wa-agent', 'PUT', { on: true, knowledge: 'We design modular kitchens in Pune.' }, T);
  const num = '919700000101';
  await say(num, 'What does the KL-200 L-shape kitchen cost?');
  await waitFor(() => fake.sent.filter((m) => m.to === num).length === 1);
  const call = fake.ai.findLast((x) => x.sys.includes('WhatsApp assistant'));
  assert.match(call.sys, /MATCHING PRODUCTS[\s\S]*L-shape kitchen \[KL-200\] — ₹1,85,000/);
  assert.match(call.sys, /THIS CUSTOMER\nName: Meera Shah/);

  await say(num, 'my budget is 2 lakh, please send the price list');
  await waitFor(() => fake.sent.filter((m) => m.to === num).length === 3);
  const doc = fake.sent.filter((m) => m.to === num).at(-1);
  assert.equal(doc.type, 'document');
  assert.equal(doc.document.filename, 'Kitchen price list 2026.xlsx');
  assert.match(fake.uploads.at(-1), /filename="Kitchen price list 2026.xlsx"/);
  assert.equal(fake.sent.filter((m) => m.to === num).length, 3, 'an id the agent wasn’t offered is ignored');
  const c = (await api('/inbox', 'GET', null, T)).data.convs.find((x) => x.num === num);
  const d = (await api(`/inbox/${c.id}`, 'GET', null, T)).data;
  assert.deepEqual(d.contact.facts.map((f) => f.text), ['Budget is about ₹2 lakh for the kitchen']);
  // next message: the fact is in what the agent knows
  await say(num, 'ok thanks');
  await waitFor(() => fake.sent.filter((m) => m.to === num).length === 4);
  assert.match(fake.ai.findLast((x) => x.sys.includes('WhatsApp assistant')).sys, /What we know from earlier chats:\n- Budget is about ₹2 lakh/);
  // the same catalogue isn't sent twice in a day
  await say(num, 'send the catalogue again');
  await waitFor(() => fake.sent.filter((m) => m.to === num).length === 5);
  await wait(300);
  assert.equal(fake.sent.filter((m) => m.to === num && m.type === 'document').length, 1);
  // the seller can make the agent forget a fact
  const fid = d.contact.facts[0].id;
  await api(`/inbox/${c.id}`, 'PATCH', { forget: fid }, T);
  assert.equal((await api(`/inbox/${c.id}`, 'GET', null, T)).data.contact.facts.length, 0);
});

test('a long chat is summed up, and the summary goes to the agent with the latest messages', async () => {
  const num = '919700000102';
  for (let i = 0; i < 17; i++) { await say(num, `Question number ${i + 1} about the kitchen`); await waitFor(() => fake.sent.filter((m) => m.to === num).length === i + 1); }
  const c = (await api('/inbox', 'GET', null, T)).data.convs.find((x) => x.num === num);
  const mem = await waitFor(async () => (await api(`/inbox/${c.id}`, 'GET', null, T)).data.conv.memory);
  assert.match(mem, /Wants an L-shape kitchen/);
  await say(num, 'one more thing');
  await waitFor(() => fake.sent.filter((m) => m.to === num).length === 18);
  assert.match(fake.ai.findLast((x) => x.sys.includes('WhatsApp assistant')).sys, /Earlier in this chat \(summary\): Wants an L-shape kitchen/);
});

test('a chat a person resolves teaches the agent lasting facts; documents can be removed', async () => {
  const num = '919700000103';
  await api('/wa-agent', 'PUT', { auto: false }, T);
  await say(num, 'Hi, I live in Wakad');
  await say(num, 'Looking for a kitchen');
  const c = await waitFor(async () => (await api('/inbox', 'GET', null, T)).data.convs.find((x) => x.num === num));
  await api(`/inbox/${c.id}/messages`, 'POST', { text: 'Happy to help!' }, T);
  await api(`/inbox/${c.id}`, 'PATCH', { status: 'resolved' }, T);
  await waitFor(async () => (await api(`/inbox/${c.id}`, 'GET', null, T)).data.contact.facts.length === 1);
  assert.equal((await api(`/inbox/${c.id}`, 'GET', null, T)).data.contact.facts[0].text, 'Lives in Wakad, Pune');

  assert.equal((await api(`/wa-agent/docs/${brochure.id}`, 'DELETE', null, T)).status, 200);
  assert.ok(!(await docs()).some((d) => d.id === brochure.id));
  assert.equal((await api('/wa-agent/search', 'POST', { q: 'wardrobe installation' }, T)).data.passages.filter((p) => p.doc === 'Wardrobe brochure.pdf').length, 0);
  assert.ok((await api('/vault/files', 'GET', null, T)).data.files?.some?.((f) => f.name === 'Wardrobe brochure.pdf') ?? true, 'the file stays in the Vault');
});
