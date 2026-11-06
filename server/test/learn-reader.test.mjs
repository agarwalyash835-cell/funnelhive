// The members area's read-only PDF reader, audiobook chapters and language: a PDF opens through a short-lived ticket
// tied to the signed-in member and travels encrypted (never as a fetchable PDF); a read-only PDF has no download link
// and the download route refuses it; each lesson keeps its own play position; the seller picks the school's language.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { startServer, register } from './helpers.mjs';

const TTL = 3000; // reading links run out after 3 s here (10 minutes in real use)
let srv, api, T, handle, book, pdfFile, mp3, asha, ravi;
const pdf = Buffer.concat([Buffer.from('%PDF-1.7\n'), crypto.randomBytes(3000), Buffer.from('\n%%EOF')]);
before(async () => {
  srv = await startServer({ READER_TTL_MS: String(TTL) });
  api = srv.api;
  T = (await register(api)).token;
  book = (await api('/products', 'POST', { name: 'Paisa Panchatantra' }, T)).data;
  const upload = (name, content, type) => fetch(`${srv.base}/api/products/${book.id}/files`, { method: 'POST', headers: { authorization: `Bearer ${T}`, 'content-type': 'application/octet-stream', 'x-file-name': encodeURIComponent(name), 'x-file-type': type }, body: content }).then((r) => r.json());
  pdfFile = (await upload('ebook.pdf', pdf, 'application/pdf')).file;
  mp3 = (await upload('chapter-1.mp3', crypto.randomBytes(2000), 'audio/mpeg')).file;
  book = (await api(`/products/${book.id}`, 'PUT', { audiobook: true, lessons: [{ title: 'Read the book', fileIds: [pdfFile.id] }, { title: 'Chapter 1', fileIds: [mp3.id] }, { title: 'Chapter 2', fileIds: [] }] }, T)).data;
  handle = (await api('/school', 'GET', null, T)).data.handle;
  for (const email of ['asha@x.in', 'ravi@x.in']) await api(`/products/${book.id}/grant`, 'POST', { email, notify: false }, T);
  asha = await signIn('asha@x.in');
  ravi = await signIn('ravi@x.in');
});
after(() => srv.stop());

const H = (tok) => ({ 'x-student': tok || '', 'content-type': 'application/json' });
const L = (path, method = 'GET', body, tok) => fetch(`${srv.base}/api/learn/${handle}${path}`, { method, headers: H(tok), body: body ? JSON.stringify(body) : undefined }).then(async (r) => ({ status: r.status, data: await r.json().catch(() => ({})) }));
async function signIn(email) {
  const c = await L('/code', 'POST', { email });
  return (await L('/login', 'POST', { email, code: c.data.code })).data.token;
}
const courseOf = async (tok) => (await L('/home', 'GET', null, tok)).data.courses.find((c) => c.productId === book.id);
const decrypt = (buf, key, iv) => { const d = crypto.createDecipheriv('aes-256-ctr', Buffer.from(key, 'base64'), Buffer.from(iv, 'base64')); return Buffer.concat([d.update(buf), d.final()]); };

test('the reader: a ticket for the signed-in member; the file arrives encrypted and only to that member', async () => {
  const c = await courseOf(asha);
  const r = await L('/reader', 'POST', { accessId: c.accessId, fileId: pdfFile.id }, asha);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.mark, 'asha@x.in', 'her email goes over every page');
  const get = (tok) => fetch(srv.base + r.data.src, { headers: tok ? { 'x-student': tok } : {} });
  assert.equal((await get()).status, 401, 'opening the link without being signed in gets nothing');
  const other = await get(ravi);
  assert.equal(other.status, 403, 'another member can’t use her link');
  assert.match((await other.json()).error, /another member/);
  const mine = await get(asha);
  assert.equal(mine.status, 200);
  assert.equal(mine.headers.get('content-type'), 'application/octet-stream');
  assert.match(mine.headers.get('cache-control'), /no-store/);
  const body = Buffer.from(await mine.arrayBuffer());
  assert.equal(body.length, pdf.length);
  assert.notEqual(body.subarray(0, 5).toString(), '%PDF-', 'not a PDF on the wire');
  assert.ok(decrypt(body, r.data.key, r.data.iv).equals(pdf), 'the page decrypts it back to the book');
  // a tampered ticket, and someone else's file
  assert.equal((await fetch(srv.base + r.data.src.replace(/.$/, (x) => (x === 'a' ? 'b' : 'a')), { headers: { 'x-student': asha } })).status, 403);
  assert.equal((await L('/reader', 'POST', { accessId: c.accessId, fileId: mp3.id }, asha)).status, 404, 'only PDFs open in the reader');
  assert.equal((await L('/reader', 'POST', { accessId: c.accessId, fileId: pdfFile.id }, ravi)).status, 404, 'his session, her access: refused');
});

test('the reader: links run out', async () => {
  const c = await courseOf(asha);
  const r = await L('/reader', 'POST', { accessId: c.accessId, fileId: pdfFile.id }, asha);
  await new Promise((ok) => setTimeout(ok, TTL + 200));
  const late = await fetch(srv.base + r.data.src, { headers: { 'x-student': asha } });
  assert.equal(late.status, 403);
  assert.equal((await late.json()).expired, true);
});

test('read-only PDFs: no download link, and the download route refuses even a link made before', async () => {
  let c = await courseOf(asha);
  const before = c.lessons[0].files[0];
  assert.ok(before.url && before.view, 'downloadable by default (today’s behaviour)');
  assert.equal((await api(`/products/${book.id}/files/${mp3.id}`, 'PUT', { readOnly: true }, T)).status, 400, 'only PDFs can be read-only');
  const saved = (await api(`/products/${book.id}/files/${pdfFile.id}`, 'PUT', { readOnly: true }, T)).data;
  assert.equal(saved.files.find((f) => f.id === pdfFile.id).readOnly, true);
  c = await courseOf(asha);
  const f = c.lessons[0].files[0];
  assert.deepEqual([f.readOnly, f.url, f.view], [true, null, null]);
  for (const url of [before.url, before.view]) {
    const r = await fetch(srv.base + url);
    assert.equal(r.status, 403, url);
    assert.match(await r.text(), /members area only/);
  }
  const r = await L('/reader', 'POST', { accessId: c.accessId, fileId: pdfFile.id }, asha);
  assert.deepEqual([r.status, r.data.readOnly], [200, true], 'still opens in the reader');
  await api(`/products/${book.id}/files/${pdfFile.id}`, 'PUT', { readOnly: false }, T);
  assert.ok((await courseOf(asha)).lessons[0].files[0].url, 'and back to downloadable');
});

test('audiobook: each chapter keeps its own position, per member', async () => {
  let c = await courseOf(asha);
  assert.equal(c.audiobook, true);
  const [, ch1, ch2] = c.lessons;
  assert.ok(ch1.files[0].view, 'the chapter streams');
  await L('/progress', 'POST', { accessId: c.accessId, lessonId: ch1.id, t: 312 }, asha);
  await L('/progress', 'POST', { accessId: c.accessId, lessonId: ch2.id, t: 45 }, asha);
  c = await courseOf(asha);
  assert.deepEqual([c.lessons[1].pos, c.lessons[2].pos], [312, 45]);
  assert.deepEqual([c.resume.lessonId, c.resume.t], [ch2.id, 45], 'and the book resumes on the last chapter played');
  assert.equal((await courseOf(ravi)).lessons[1].pos, undefined, 'his own place, not hers');
});

test('language: the seller picks it; unknown codes fall back to English', async () => {
  assert.equal((await L('')).data.school.lang, 'en');
  await api('/school/settings', 'PUT', { lang: 'ta' }, T);
  assert.equal((await L('')).data.school.lang, 'ta');
  await api('/school/settings', 'PUT', { lang: 'klingon' }, T);
  assert.equal((await L('')).data.school.lang, 'en');
  await api('/school/settings', 'PUT', { lang: 'hinglish' }, T);
  assert.equal((await L('')).data.school.lang, 'hinglish');
});

test('No downloads: nothing has a link, old links stop working, audio only as a stream; the watermark follows the Academy', async () => {
  const upload = (name, content, type) => fetch(`${srv.base}/api/products/${book.id}/files`, { method: 'POST', headers: { authorization: `Bearer ${T}`, 'content-type': 'application/octet-stream', 'x-file-name': encodeURIComponent(name), 'x-file-type': type }, body: content }).then((r) => r.json());
  const sheet = (await upload('worksheet.docx', crypto.randomBytes(500), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')).file;
  const before = (await courseOf(asha)).files.find((f) => f.id === sheet.id);
  assert.ok(before.url, 'downloads on: the worksheet has a link');

  const s = (await api('/school/settings', 'PUT', { noDownloads: true, watermark: 'strong' }, T)).data;
  assert.deepEqual([s.noDownloads, s.watermark], [true, 'strong']);
  const c = await courseOf(asha);
  const all = [...c.files, ...c.lessons.flatMap((l) => l.files || [])];
  assert.ok(all.every((f) => !f.url && !f.view), 'no file has a link');
  assert.equal(all.find((f) => f.id === sheet.id).blocked, true, 'a Word file can’t be shown');
  assert.equal(all.find((f) => f.id === pdfFile.id).readOnly, true, 'every PDF opens in the reader only');
  assert.ok(all.find((f) => f.id === mp3.id).stream, 'audio is offered only as a stream');
  // a link handed out before the switch: refused now
  const old = await fetch(srv.base + before.url);
  assert.equal(old.status, 403);
  assert.match(await old.text(), /downloads are switched off/);

  // audio: a stream ticket once it's ready, never a file (here it isn't ready yet)
  const au = await L('/audio', 'POST', { accessId: c.accessId, fileId: mp3.id }, asha);
  assert.equal(au.status, 409);
  assert.match(au.data.error, /being prepared/);
  assert.equal((await L('/audio', 'POST', { accessId: c.accessId, fileId: mp3.id }, ravi)).status, 404, 'not with another member’s access');
  assert.equal((await L('/audio', 'POST', { accessId: c.accessId, fileId: pdfFile.id }, asha)).status, 404, 'only audio streams here');

  // the watermark: strong reaches the reader; the product's own switch still turns it off
  const r = await L('/reader', 'POST', { accessId: c.accessId, fileId: pdfFile.id }, asha);
  assert.deepEqual([r.data.markStyle, r.data.mark, r.data.readOnly], ['strong', 'asha@x.in', true]);
  await api(`/products/${book.id}`, 'PUT', { watermark: false }, T);
  const off = await L('/reader', 'POST', { accessId: c.accessId, fileId: pdfFile.id }, asha);
  assert.deepEqual([off.data.markStyle, off.data.mark], ['off', '']);
  assert.equal((await api('/school/settings', 'PUT', { watermark: 'loud' }, T)).data.watermark, 'subtle', 'an unknown strength falls back to subtle');
  await api(`/products/${book.id}`, 'PUT', { watermark: true }, T);
  await api('/school/settings', 'PUT', { noDownloads: false }, T);
});
