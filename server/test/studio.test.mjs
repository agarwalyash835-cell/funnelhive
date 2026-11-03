// Studio (studio/): images and clips made through kie.ai (a local fake here), each one measured with ffmpeg and
// reviewed, retried with the reviewer's fix note, cleaned up from 480p to 720p, saved to the seller's uploads, and
// logged for pricing. Off per account until the platform switches it on; sellers never see model names.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { startServer, register, enable2fa } from './helpers.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-test-'));
const ff = (...a) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...a]);
const tasks = {}, created = [], reviews = [];
let reviewPlan = []; // verdicts to hand out in order (then: pass)
let fake, srv, api, ADMIN, S, sid;

const PASS = { product_match: null, text_ok: 9, anatomy_ok: 10, matches_brief: 9, consistency: 9, safe: true, issues: [], fix: '' };
before(async () => {
  ff('-f', 'lavfi', '-i', 'testsrc2=size=768x768', '-frames:v', '1', path.join(tmp, 'image.png'));
  // a 480p vertical clip with some grain and movement, like a cheap render
  ff('-f', 'lavfi', '-i', 'testsrc2=size=480x854:rate=24,noise=alls=10:allf=t', '-t', '5', '-c:v', 'libx264', '-crf', '28', '-pix_fmt', 'yuv420p', path.join(tmp, 'clip.mp4'));
  fake = http.createServer((req, res) => {
    let b = '';
    req.on('data', (c) => { b += c; });
    req.on('end', () => {
      const url = new URL(req.url, 'http://x'), send = (o) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(o)); };
      if (url.pathname.startsWith('/files/')) return res.end(fs.readFileSync(path.join(tmp, url.pathname.slice(7))));
      if (req.headers.authorization !== 'Bearer kie-test') return send({ code: 401, msg: 'bad key' });
      if (url.pathname === '/api/v1/jobs/createTask') {
        const body = JSON.parse(b), id = `t${created.length}`;
        created.push(body);
        tasks[id] = { body, polls: 0 };
        return send({ code: 200, data: { taskId: id } });
      }
      if (url.pathname === '/api/v1/jobs/recordInfo') {
        const t = tasks[url.searchParams.get('taskId')];
        t.polls++;
        if (t.polls < 2) return send({ code: 200, data: { state: 'generating' } });
        if (/FAIL/.test(t.body.input.prompt)) return send({ code: 200, data: { state: 'fail', failMsg: 'content refused' } });
        const file = /seedance|kling|veo/.test(t.body.model) ? 'clip.mp4' : 'image.png';
        return send({ code: 200, data: { state: 'success', resultJson: JSON.stringify({ resultUrls: [`http://127.0.0.1:${fake.address().port}/files/${file}`] }) } });
      }
      if (url.pathname === '/gemini-3-8-flash-openai/v1/chat/completions') {
        const parts = JSON.parse(b).messages[0].content;
        reviews.push({ model: 'gemini-3-8-flash-openai', images: parts.filter((p) => p.type === 'image_url').length, prompt: parts[0].text });
        const v = reviewPlan.shift() || PASS;
        return send({ choices: [{ message: { content: JSON.stringify(v) } }] });
      }
      res.writeHead(404); res.end('{}');
    });
  }).listen(0);
  await new Promise((r) => setTimeout(r, 30));
  srv = await startServer({ KIE_API_KEY: 'kie-test', KIE_BASE_URL: `http://127.0.0.1:${fake.address().port}`, ADMIN_EMAILS: 'boss@studio.test', APP_URL: 'https://app.studio.test' });
  api = srv.api;
  ADMIN = (await register(api, 'boss@studio.test')).token;
  const link = srv.log().match(/To: boss@studio\.test[\s\S]*?\/verify\?token=([a-f0-9.]+)/);
  await api('/auth/verify', 'POST', { token: link[1] });
  ADMIN = (await enable2fa(api, ADMIN)).token;
  S = (await register(api, 'maker@studio.test')).token;
  sid = (await api('/me', 'GET', null, S)).data.id;
});
after(async () => { await srv?.stop(); fake?.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

const tick = (times = 1) => api('/__test/studio-tick', 'POST', { times });
async function until(id, done = (a) => ['ready', 'needs_review', 'failed'].includes(a.status), max = 40) {
  for (let i = 0; i < max; i++) { await tick(); const a = (await api(`/studio/assets/${id}`, 'GET', null, S)).data; if (done(a)) return a; }
  throw new Error('never finished');
}
const probe = (file) => JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_streams', file]).toString()).streams.find((s) => s.codec_type === 'video');
const onDisk = (url) => path.join(srv.dataDir, 'uploads', ...url.split('/').slice(2));

test('Studio is off until the platform switches it on for the account', async () => {
  const r = await api('/studio/images', 'POST', { prompt: 'A jar of ghee on a wooden table' }, S);
  assert.equal(r.status, 403); assert.equal(r.data.code, 'STUDIO_OFF');
  assert.equal((await api('/me', 'GET', null, S)).data.nav.studio, false);
  assert.equal((await api(`/admin/studio/accounts/${sid}`, 'PUT', { on: true }, S)).status, 403, 'not for sellers');
  assert.equal((await api(`/admin/studio/accounts/${sid}`, 'PUT', { on: true }, ADMIN)).data.on, true);
  assert.equal((await api('/me', 'GET', null, S)).data.nav.studio, true);
  const g = (await api('/studio', 'GET', null, S)).data;
  assert.equal(g.on, true);
  assert.deepEqual(g.tiers.map((t) => t.name), ['Quick', 'Standard', 'Cinematic']);
  assert.ok(!JSON.stringify(g).match(/seedance|nano-banana|kie|gemini/i), 'no model names for sellers');
});

let imageId;
test('an image: rendered, measured, reviewed against the product photo, saved to the seller’s uploads, logged', async () => {
  assert.equal((await api('/studio/images', 'POST', { prompt: 'Ghee jar', ref: 'https://evil.example/x.png' }, S)).status, 400, 'only their own photos');
  const r = await api('/studio/images', 'POST', { prompt: 'A jar of ghee on a wooden table, morning light', tier: 'standard', aspect: '1:1', ref: `/uploads/${sid}/product.png` }, S);
  assert.equal(r.status, 201);
  imageId = r.data.assets[0].id;
  const a = await until(imageId);
  assert.equal(a.status, 'ready', JSON.stringify(a));
  assert.match(a.url, new RegExp(`^/uploads/${sid}/studio-`));
  assert.ok(fs.existsSync(onDisk(a.url)));
  const sent = created.find((c) => c.model === 'nano-banana-2');
  assert.equal(sent.input.resolution, '2K');
  assert.deepEqual(sent.input.image_input, [`https://app.studio.test/uploads/${sid}/product.png`], 'the product photo as a public reference');
  assert.match(sent.input.prompt, /Keep the product exactly as in the reference photo/);
  assert.ok(reviews.length >= 1);
});

test('a clip that fails its review waits for the seller (no paid redo on its own); the redo uses the fix note; always 720p', async () => {
  reviewPlan = [{ ...PASS, consistency: 3, issues: ['The label changes in the last second'], fix: 'Keep the jar label unchanged until the end' }];
  const before = created.length;
  const r = await api('/studio/clips', 'POST', { prompt: 'Slow push-in on the jar as steam rises', tier: 'quick', aspect: '9:16', seconds: 5, sourceId: imageId }, S);
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.equal(r.data.credits, r.data.asset.redoCredits, 'what it costs, said up front');
  let a = await until(r.data.asset.id);
  // every render costs credits: kept for the seller with the reasons, the fix and what a redo would cost — not redone
  assert.deepEqual([a.status, a.attempts, a.fix, a.res], ['needs_review', 1, 'Keep the jar label unchanged until the end', '480p'], JSON.stringify(a));
  assert.ok(a.redoCredits > 0);
  assert.equal(created.length - before, 1, 'one render only');
  assert.ok(a.enhanced, 'brought up to 720p even while it waits for review');
  // the seller asks for the redo: the reviewer's fix goes with it
  const again = await api(`/studio/assets/${a.id}/redo`, 'POST', {}, S);
  assert.equal(again.data.status, 'queued');
  a = await until(a.id);
  assert.equal(a.status, 'ready', JSON.stringify(a));
  const sends = created.slice(before);
  assert.equal(sends.length, 2);
  assert.equal(sends[0].model, 'bytedance/seedance-2-mini');
  assert.deepEqual([sends[0].input.resolution, sends[0].input.duration, sends[0].input.generate_audio, sends[0].input.aspect_ratio], ['480p', 5, false, '9:16']);
  assert.match(sends[0].input.first_frame_url, new RegExp(`^https://app\\.studio\\.test/uploads/${sid}/studio-`));
  assert.match(sends[1].input.prompt, /Avoid this time: Keep the jar label unchanged/);
  // the reviewer saw frames from the clip, with the source image as the reference
  assert.ok(reviews.at(-1).images >= 4, `frames reviewed: ${reviews.at(-1).images}`);
  assert.ok(a.enhanced, 'sharpened, not just stretched');
  const v = probe(onDisk(a.url));
  assert.equal(Math.min(v.width, v.height), 720);
  assert.ok(a.poster && fs.existsSync(onDisk(a.poster)));
});

test('a render that keeps failing stops after three tries; redo starts afresh with the seller’s note', async () => {
  const r = await api('/studio/images', 'POST', { prompt: 'FAIL this one please', tier: 'quick' }, S);
  const a = await until(r.data.assets[0].id);
  assert.equal(a.status, 'failed'); assert.equal(a.attempts, 3); assert.ok(a.error);
  assert.ok(!/kie|nano|seedance/i.test(a.error));
  const again = await api(`/studio/assets/${a.id}/redo`, 'POST', { note: 'a brass jar instead' }, S);
  assert.equal(again.data.status, 'queued'); assert.equal(again.data.attempts, 0);
  const other = await register(api);
  assert.equal((await api(`/studio/assets/${a.id}`, 'GET', null, other.token)).status, 404, 'someone else’s');
});

test('a clip that fails its check is kept for the seller to judge, with the reasons', async () => {
  const bad = { ...PASS, consistency: 2, issues: ['The jar melts halfway through'], fix: 'Keep the jar solid' };
  reviewPlan = [bad];
  const r = await api('/studio/clips', 'POST', { prompt: 'Jar spins', tier: 'quick', seconds: 4 }, S);
  const a = await until(r.data.asset.id);
  assert.equal(a.status, 'needs_review');
  assert.deepEqual(a.issues, ['The jar melts halfway through']);
  assert.ok(a.url, 'still there to look at');
});

test('the admin sees usage by model and resolution, and can move a tier to another model', async () => {
  const d = (await api('/admin/studio', 'GET', null, ADMIN)).data;
  assert.ok(d.byModel['bytedance/seedance-2-mini · 480p'].renders >= 2);
  assert.ok(d.usage.find((u) => u.email === 'maker@studio.test').renders >= 4);
  assert.equal((await api('/admin/studio', 'PUT', { models: { clip: { cinematic: { model: 'kling-4.0/reference-to-video', resolution: '1080p' } } } }, ADMIN)).status, 200);
  assert.equal((await api('/admin/studio', 'PUT', { models: { clip: { quick: { model: 'bad model!' } } } }, ADMIN)).status, 400);
  const before = created.length;
  const r = await api('/studio/clips', 'POST', { prompt: 'Hero shot of the jar', tier: 'cinematic', seconds: 6, sourceId: imageId }, S);
  await tick(2);
  const sent = created.slice(before)[0];
  assert.equal(sent.model, 'kling-4.0/reference-to-video');
  assert.deepEqual([sent.input.resolution, sent.input.duration], ['1080p', 6]);
  assert.match(sent.input.prompt, /^@image_1 /);
  assert.ok(r.data.asset.id);
});

test('what it costs, before anything is made: per image, per clip and per Reel, for each resolution the tier offers', async () => {
  const st = (await api('/studio', 'GET', null, S)).data;
  const std = st.tiers.find((t) => t.id === 'standard');
  assert.deepEqual(std.clipRes, ['480p', '720p']);
  assert.ok(std.clipCreditsPer5s['480p'] < std.clipCreditsPer5s['720p'], JSON.stringify(std));
  assert.deepEqual(st.tiers.find((t) => t.id === 'cinematic').clipRes, ['1080p'], 'no choice there');
  const clip = (await api('/studio/estimate', 'POST', { kind: 'clip', tier: 'standard', seconds: 6, res: '480p' }, S)).data;
  assert.equal(clip.res, '480p');
  assert.ok(clip.byRes['480p'] < clip.byRes['720p']);
  const reel = (await api('/studio/estimate', 'POST', { kind: 'reel', tier: 'standard', seconds: 45, shots: 6, lines: 6 }, S)).data;
  assert.ok(reel.byRes['480p'] < reel.byRes['720p'] && reel.credits === reel.byRes['720p'], JSON.stringify(reel));
  assert.equal((await api('/studio/estimate', 'POST', { kind: 'image', tier: 'standard', count: 3 }, S)).data.credits, 3 * std.imageCredits);
  // a clip at the resolution chosen: 480p on Standard goes to the provider as 480p
  const before = created.length;
  const r = await api('/studio/clips', 'POST', { prompt: 'Jar on a table, slow pan', tier: 'standard', seconds: 5, res: '480p' }, S);
  assert.equal(r.data.asset.res, '480p');
  await until(r.data.asset.id);
  assert.equal(created.slice(before).find((c) => /seedance/.test(c.model))?.input.resolution, '480p');
  // nonsense falls back to the tier's own
  assert.equal((await api('/studio/estimate', 'POST', { kind: 'clip', tier: 'standard', res: '4k' }, S)).data.res, '720p');
});
