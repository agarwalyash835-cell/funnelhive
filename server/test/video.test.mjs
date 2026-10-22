// Protected course video: an uploaded MP4 becomes encrypted HLS in the background (real ffmpeg; skipped where it isn't
// installed); a signed-in student gets a short-lived link; the key only reaches them; raw file links stop being handed
// out; tampered links, other students and removed students are refused.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { startServer, register } from './helpers.mjs';

const HAVE_FFMPEG = spawnSync('ffmpeg', ['-version']).status === 0 && spawnSync('ffprobe', ['-version']).status === 0;
let srv, api, T, handle, p, lessonId, mp4;
before(async () => {
  if (!HAVE_FFMPEG) return;
  mp4 = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ffv-test-')), 'clip.mp4');
  const r = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=size=1280x720:rate=24', '-f', 'lavfi', '-i', 'sine=frequency=440', '-t', '3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', mp4]);
  assert.equal(r.status, 0, String(r.stderr));
  srv = await startServer({ VIDEO_TICK_MS: '200' });
  api = srv.api;
  T = (await register(api)).token;
  p = (await api('/products', 'POST', { name: 'Protected course' }, T)).data;
  handle = (await api('/school', 'GET', null, T)).data.handle;
});
after(async () => { if (srv) await srv.stop(); });
const L = (pth, method = 'GET', body, tok) => fetch(`${srv.base}/api/learn/${handle}${pth}`, { method, headers: { 'x-student': tok || '', 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }).then(async (r) => ({ status: r.status, data: await r.json().catch(() => ({})) }));
const signIn = async (email) => { const c = await L('/code', 'POST', { email }); return (await L('/login', 'POST', { email, code: c.data.code })).data.token; };

test('an uploaded video becomes an encrypted stream only a signed-in buyer can play', { skip: !HAVE_FFMPEG && 'ffmpeg not installed' }, async () => {
  const up = await fetch(`${srv.base}/api/products/${p.id}/files`, { method: 'POST', headers: { authorization: `Bearer ${T}`, 'x-file-name': 'clip.mp4', 'x-file-type': 'video/mp4', 'content-length': String(fs.statSync(mp4).size) }, body: fs.readFileSync(mp4) }).then((r) => r.json());
  assert.equal(up.file.hls.status, 'queued');
  const fid = up.file.id;
  const saved = (await api(`/products/${p.id}`, 'PUT', { lessons: [{ title: 'Lesson 1', section: '', videoFileId: fid, body: 'Watch this.' }] }, T)).data;
  lessonId = saved.lessons[0].id;
  // the background queue prepares it
  let f;
  for (let i = 0; i < 150; i++) { f = (await api(`/products/${p.id}`, 'GET', null, T)).data.files.find((x) => x.id === fid); if (['ready', 'failed'].includes(f.hls?.status)) break; await new Promise((r) => setTimeout(r, 200)); }
  assert.equal(f.hls.status, 'ready', JSON.stringify(f.hls));
  assert.ok(f.hls.seconds >= 2 && f.hls.bytes > 0);
  assert.deepEqual(f.hls.variants, [360, 720], 'two qualities for a 720p video');
  await api(`/products/${p.id}/grant`, 'POST', { email: 'viewer@x.in', name: 'Vee', notify: false }, T);
  const tok = await signIn('viewer@x.in');
  const course = (await L('/home', 'GET', null, tok)).data.courses.find((c) => c.productId === p.id);
  const lesson = course.lessons[0];
  assert.equal(lesson.video, null, 'no raw file link once the protected stream is ready');
  assert.equal(lesson.hls.fileId, fid);
  const v = await L('/video', 'POST', { accessId: course.accessId, fileId: fid }, tok);
  assert.equal(v.status, 200, JSON.stringify(v.data));
  assert.equal(v.data.mark, 'viewer@x.in', 'the watermark is the student');
  const master = await (await fetch(`${srv.base}${v.data.src}`)).text();
  const variant = master.split('\n').find((l) => l.startsWith('/api/hls/'));
  assert.ok(variant, JSON.stringify(master));
  const pl = await (await fetch(`${srv.base}${variant}`)).text();
  assert.match(pl, /#EXT-X-KEY:METHOD=AES-128,URI="\/api\/hls\/[^"]+\/key\?t=/);
  const keyUrl = pl.match(/URI="([^"]+)"/)[1];
  const key = Buffer.from(await (await fetch(`${srv.base}${keyUrl}`)).arrayBuffer());
  assert.equal(key.length, 16, 'the 16-byte key');
  const seg = pl.split('\n').find((l) => l.includes('.ts'));
  const piece = Buffer.from(await (await fetch(`${srv.base}${seg}`)).arrayBuffer());
  assert.ok(piece.length > 1000);
  assert.notEqual(piece[0], 0x47, 'the piece is encrypted (not a plain MPEG-TS sync byte)');
  // tampered or missing tickets
  assert.equal((await fetch(`${srv.base}${keyUrl.replace(/t=[^&]+/, 't=nope')}`)).status, 403);
  assert.equal((await fetch(`${srv.base}${keyUrl.replace(/\.(\d+)\./, (m, d) => `.${Number(d) + 1000}.`)}`)).status, 403, 'a changed expiry breaks the signature');
  // someone who didn't buy can't get a link; a removed student's links stop working
  const other = await signIn('stranger@x.in').catch(() => null);
  if (other) assert.equal((await L('/video', 'POST', { accessId: course.accessId, fileId: fid }, other)).status, 404);
  const st = (await api('/school/students', 'GET', null, T)).data.find((s) => s.email === 'viewer@x.in');
  await api(`/school/students/${st.id}`, 'PUT', { banned: true }, T);
  assert.equal((await fetch(`${srv.base}${keyUrl}`)).status, 403, 'removed: the key is refused at once');
  // deleting the file removes the stream too
  await api(`/products/${p.id}/files/${fid}`, 'DELETE', null, T);
  assert.equal((await fetch(`${srv.base}${seg}`)).status, 403);
});

test('with a video bucket (R2) set, the pieces go there and play from signed bucket links', { skip: !HAVE_FFMPEG && 'ffmpeg not installed' }, async () => {
  const http = await import('node:http');
  const objects = new Map();
  const s3 = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    const key = decodeURIComponent(u.pathname.replace(/^\/vids\/?/, ''));
    if (req.method === 'PUT') { const chunks = []; req.on('data', (c) => chunks.push(c)); req.on('end', () => { objects.set(key, Buffer.concat(chunks)); res.end(); }); return; }
    if (req.method === 'GET' && u.searchParams.get('list-type') === '2') { const pre = u.searchParams.get('prefix') || ''; res.end(`<ListBucketResult>${[...objects.keys()].filter((k) => k.startsWith(pre)).map((k) => `<Key>${k}</Key>`).join('')}</ListBucketResult>`); return; }
    if (req.method === 'GET') { const b = objects.get(key); if (!b) { res.writeHead(404); return res.end(); } return res.end(b); }
    if (req.method === 'DELETE') { objects.delete(key); return res.end(); }
    res.writeHead(400); res.end();
  }).listen(0);
  await new Promise((r) => setTimeout(r, 30));
  const s = await startServer({ VIDEO_TICK_MS: '200', VIDEO_S3_ENDPOINT: `http://127.0.0.1:${s3.address().port}`, VIDEO_S3_BUCKET: 'vids', VIDEO_S3_REGION: 'auto', VIDEO_S3_ACCESS_KEY: 'k', VIDEO_S3_SECRET_KEY: 's' });
  try {
    const tok = (await register(s.api)).token;
    const prod = (await s.api('/products', 'POST', { name: 'R2 course' }, tok)).data;
    const up = await fetch(`${s.base}/api/products/${prod.id}/files`, { method: 'POST', headers: { authorization: `Bearer ${tok}`, 'x-file-name': 'c.mp4', 'x-file-type': 'video/mp4', 'content-length': String(fs.statSync(mp4).size) }, body: fs.readFileSync(mp4) }).then((r) => r.json());
    let f;
    for (let i = 0; i < 150; i++) { f = (await s.api(`/products/${prod.id}`, 'GET', null, tok)).data.files[0]; if (['ready', 'failed'].includes(f.hls?.status)) break; await new Promise((r) => setTimeout(r, 200)); }
    assert.equal(f.hls.status, 'ready', JSON.stringify(f.hls));
    assert.equal(f.hls.store, 'video');
    assert.ok([...objects.keys()].some((k) => k.endsWith('master.m3u8')) && [...objects.keys()].some((k) => k.endsWith('.ts')), 'pieces are in the video bucket');
    await s.api(`/products/${prod.id}`, 'PUT', { lessons: [{ title: 'L', videoFileId: up.file.id }] }, tok);
    await s.api(`/products/${prod.id}/grant`, 'POST', { email: 'r2@x.in', notify: false }, tok);
    const h = (await s.api('/school', 'GET', null, tok)).data.handle;
    const LL = (pth, method = 'GET', body, t) => fetch(`${s.base}/api/learn/${h}${pth}`, { method, headers: { 'x-student': t || '', 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }).then((r) => r.json());
    const code = (await LL('/code', 'POST', { email: 'r2@x.in' })).code;
    const st = (await LL('/login', 'POST', { email: 'r2@x.in', code })).token;
    const c = (await LL('/home', 'GET', null, st)).courses[0];
    const v = await LL('/video', 'POST', { accessId: c.accessId, fileId: up.file.id }, st);
    const master = await (await fetch(`${s.base}${v.src}`)).text();
    const variant = master.split('\n').find((l) => l.startsWith('/api/hls/'));
    const pl = await (await fetch(`${s.base}${variant}`)).text();
    const seg = pl.split('\n').find((l) => l.includes('.ts'));
    assert.match(seg, new RegExp(`^http://127\.0\.0\.1:${s3.address().port}/vids/hls/.+X-Amz-Signature=`), 'pieces come straight from a signed bucket link');
    assert.ok((await fetch(seg)).ok);
    await s.api(`/products/${prod.id}/files/${up.file.id}`, 'DELETE', null, tok);
    await new Promise((r) => setTimeout(r, 300));
    assert.ok(![...objects.keys()].some((k) => k.startsWith('hls/')), 'deleting the video empties its bucket folder');
  } finally { await s.stop(); s3.close(); }
});
