// Presenter scenes (studio/presenter.js): a person speaking the scene's own voiceover line to camera, lip-synced from a
// picture and that line's audio. With every outside service faked (as in studio-reel.test.mjs): the editor places each
// scene exactly where its line starts and never slows a presenter down; a presenter Reel orders the lip-sync model with
// the line's recorded audio and the chosen face (no still is made for it); the finished video has one sound track (the
// voiceover — the presenter clip's own sound is dropped); costs include it; a reworded line gets a new lip-synced clip;
// a real public figure is refused.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { startServer, register, enable2fa } from './helpers.mjs';
import { render, slotPlan } from '../studio/assemble.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'presenter-test-'));
const ff = (...a) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...a]);
const streams = (file) => JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', file]).toString());
const secondsOf = (file) => Number(streams(file).format.duration);
// the mean grey level of one frame
const grey = (file, t) => { const b = spawnSync('ffmpeg', ['-hide_banner', '-ss', String(t), '-i', file, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'gray', '-s', '32x56', '-'], { maxBuffer: 1 << 24 }).stdout; return b.reduce((s, x) => s + x, 0) / b.length; };
const solid = (name, g, secs, size = '240x426') => ff('-f', 'lavfi', '-i', `color=c=0x${g.toString(16).padStart(2, '0').repeat(3)}:size=${size}:rate=30:d=${secs}`, '-pix_fmt', 'yuv420p', path.join(tmp, name));

// ---------- the editor: cuts on the lines, a presenter keeps its pace ----------
test('slotPlan: each clip starts where its line does, on a frame; the dissolve into a clip starts at its line', () => {
  const p = slotPlan([0, 2, 3.8], 3, 5.65, { fps: 20, voiceDelay: 0.15, fade: 0.3 });
  assert.deepEqual(p.T, [0, 2.15, 3.95]);
  // at 30 fps the cut lands on the nearest frame (within half a frame of the line)
  assert.ok(slotPlan([0, 2, 3.8], 3, 5.65, { fps: 30 }).T.every((t, i) => Math.abs(t - [0, 2.15, 3.95][i]) <= 1 / 60 + 1e-9));
  assert.deepEqual(p.fades, [0, 0.3, 0.3]);
  // every clip but the last runs on through the dissolve into the next; laid end to end less the dissolves = the body
  assert.ok(Math.abs(p.lens.reduce((a, b) => a + b, 0) - p.fades.reduce((a, b) => a + b, 0) - 5.65) < 0.02);
  assert.equal(slotPlan([0, 2, 1], 3, 5.65), null, 'out of order: the usual fit instead');
  assert.equal(slotPlan([0, 2], 3, 5.65), null);
});

test('render with starts: clip i is on screen from its line, the synced one is held (not slowed), one sound track', async () => {
  solid('a.mp4', 40, 3);
  // the "presenter": bright for its first second, mid grey after, and only 1.5 s long (its slot is longer)
  ff('-f', 'lavfi', '-i', 'color=c=0xc8c8c8:size=240x426:rate=30:d=1', '-f', 'lavfi', '-i', 'color=c=0x787878:size=240x426:rate=30:d=0.5', '-f', 'lavfi', '-i', 'sine=f=1000:d=1.5', '-filter_complex', '[0][1]concat=n=2:v=1:a=0[v]', '-map', '[v]', '-map', '2:a', '-pix_fmt', 'yuv420p', path.join(tmp, 'b.mp4'));
  solid('c.mp4', 80, 3);
  ff('-f', 'lavfi', '-i', 'sine=f=220:d=5', path.join(tmp, 'voice.wav'));
  const out = await render({ clips: ['a.mp4', 'b.mp4', 'c.mp4'].map((n) => path.join(tmp, n)), voice: path.join(tmp, 'voice.wav'), captions: null, sizes: ['9:16'], short: 240, starts: [0, 2, 3.8], synced: [false, true, false], outDir: tmp });
  const file = out.files['9:16'];
  assert.ok(Math.abs(secondsOf(file) - 5.65) < 0.1, `length ${secondsOf(file)}`);
  const near = (v, want, at) => assert.ok(Math.abs(v - want) < 14, `at ${at}s: grey ${v.toFixed(0)}, wanted about ${want}`);
  near(grey(file, 2.05), 40, 2.05); // the first clip, until its line ends
  near(grey(file, 2.55), 200, 2.55); // the presenter from its line's start (2.15)
  // 1.2 s into the presenter: its own second second — slowed down it would still be in its first (lips late)
  near(grey(file, 3.35), 120, 3.35);
  near(grey(file, 4.4), 80, 4.4);
  const a = streams(file).streams.filter((s) => s.codec_type === 'audio');
  assert.equal(a.length, 1, 'one sound track');
});

// ---------- a presenter Reel end to end ----------
const LINES = ['I tried every ghee before this one', 'Now my whole family loves it'];
const SCRIPT = { title: 'Ghee Testimonial', lines: LINES, shots: [{ image: 'An Indian woman in her 30s in her kitchen, facing the camera, holding a jar of ghee', motion: 'Steady handheld', seconds: 4, type: 'presenter' }, { image: 'Ghee poured over hot rice', motion: 'Pour in slow motion', seconds: 4 }], endCard: { headline: 'Shuddh Ghee Co', offer: '₹499 / litre', cta: 'Order on WhatsApp' } };
const created = [], heard = [], prompts = [];
const timed = (text) => { const ws = text.split(' '); return { transcript: text, language_code: 'en-IN', timestamps: { words: ws, start_time_seconds: ws.map((_, i) => i * 0.4), end_time_seconds: ws.map((_, i) => i * 0.4 + 0.35) } }; };
let fake, srv, api, ADMIN, S, sid, reelId, faceId;
before(async () => {
  ff('-f', 'lavfi', '-i', 'testsrc2=size=768x1344', '-frames:v', '1', path.join(tmp, 'image.png'));
  for (let n = 4; n <= 10; n++) ff('-f', 'lavfi', '-i', 'testsrc2=size=720x1280:rate=24', '-t', String(n), '-c:v', 'libx264', '-crf', '28', '-pix_fmt', 'yuv420p', path.join(tmp, `clip${n}.mp4`));
  // the lip-synced clip comes back with the speech in it, like the real model
  ff('-f', 'lavfi', '-i', 'testsrc2=size=720x1280:rate=25', '-f', 'lavfi', '-i', 'sine=f=1000:d=6', '-t', '6', '-c:v', 'libx264', '-crf', '28', '-pix_fmt', 'yuv420p', '-c:a', 'aac', path.join(tmp, 'talk.mp4'));
  ff('-f', 'lavfi', '-i', 'sine=frequency=220:duration=2.8', '-ar', '44100', path.join(tmp, 'line.wav'));
  fake = http.createServer((req, res) => {
    let b = '';
    req.on('data', (c) => { b += c; });
    req.on('end', () => {
      const url = new URL(req.url, 'http://x'), send = (o) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(o)); };
      if (url.pathname.startsWith('/files/')) return res.end(fs.readFileSync(path.join(tmp, url.pathname.slice(7))));
      if (url.pathname === '/speech-to-text') return send(heard.shift() || timed(LINES.join(' ')));
      if (url.pathname === '/text-to-speech') return send({ audios: [fs.readFileSync(path.join(tmp, 'line.wav')).toString('base64')] });
      if (url.pathname === '/openai/v1/responses') { const j = JSON.parse(b || '{}'); prompts.push(j.input?.at?.(-1)?.content || ''); return send({ output: [{ type: 'message', content: [{ text: JSON.stringify(SCRIPT) }] }] }); }
      if (url.pathname.endsWith('/chat/completions')) {
        if (/senior video ad editor/.test(b)) return send({ choices: [{ message: { content: JSON.stringify({ score: 80, summary: 'Good', suggestions: [] }) } }] });
        return send({ choices: [{ message: { content: JSON.stringify({ product_match: 9, text_ok: 9, anatomy_ok: 10, matches_brief: 9, consistency: 9, safe: true, issues: [], fix: '' }) } }] });
      }
      if (url.pathname === '/api/v1/jobs/createTask') { created.push(JSON.parse(b)); return send({ code: 200, data: { taskId: `t${created.length - 1}` } }); }
      if (url.pathname === '/api/v1/jobs/recordInfo') {
        const t = created[Number(url.searchParams.get('taskId').slice(1))];
        if (/ai-music-api/.test(t.model)) return send({ code: 200, data: { state: 'success', resultJson: JSON.stringify({ data: [{ audio_url: `http://127.0.0.1:${fake.address().port}/files/line.wav` }] }) } });
        const file = t.model === 'omnihuman-2-0' ? 'talk.mp4' : /seedance/.test(t.model) ? `clip${Math.min(10, Math.max(4, t.input.duration || 5))}.mp4` : 'image.png';
        return send({ code: 200, data: { state: 'success', resultJson: JSON.stringify({ resultUrls: [`http://127.0.0.1:${fake.address().port}/files/${file}`] }) } });
      }
      res.writeHead(404); res.end('{}');
    });
  }).listen(0);
  await new Promise((r) => setTimeout(r, 30));
  const base = `http://127.0.0.1:${fake.address().port}`;
  srv = await startServer({ KIE_API_KEY: 'kie-test', KIE_BASE_URL: base, SARVAM_API_KEY: 'sarvam-test', SARVAM_BASE_URL: base, ADMIN_EMAILS: 'boss@presenter.test', APP_URL: 'https://app.presenter.test' });
  api = srv.api;
  ADMIN = (await register(api, 'boss@presenter.test')).token;
  const link = srv.log().match(/To: boss@presenter\.test[\s\S]*?\/verify\?token=([a-f0-9.]+)/);
  await api('/auth/verify', 'POST', { token: link[1] });
  ADMIN = (await enable2fa(api, ADMIN)).token;
  S = (await register(api, 'maker@presenter.test')).token;
  sid = (await api('/me', 'GET', null, S)).data.id;
  await api('/settings', 'PUT', { businessName: 'Shuddh Ghee Co' }, S);
  await api(`/admin/studio/accounts/${sid}`, 'PUT', { on: true }, ADMIN);
});
after(async () => { await srv?.stop(); fake?.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

const get = async (id = reelId) => (await api(`/studio/assets/${id}`, 'GET', null, S)).data;
async function until(statuses, id = reelId, max = 80) {
  for (let i = 0; i < max; i++) { await api('/__test/studio-tick', 'POST', { times: 1 }); const r = await get(id); if (statuses.includes(r.status)) return r; }
  throw new Error(`stuck at ${(await get(id)).status}`);
}
const onDisk = (url) => path.join(srv.dataDir, 'uploads', ...new URL(url, 'https://x').pathname.split('/').slice(2));

test('a real public figure is never a presenter', async () => {
  const r = await api('/studio/reels', 'POST', { brief: 'Shah Rukh Khan recommends our ghee to every family', presenter: { style: 'testimonial' } }, S);
  assert.equal(r.status, 400);
  assert.match(r.data.error, /not a real public figure/);
});

test('a presenter Reel: the script marks the talking scenes, the cost includes them, the face is the seller’s pick', async () => {
  // the face: a Studio image of an invented person
  const img = await api('/studio/images', 'POST', { prompt: 'Portrait of an Indian woman in her 30s, kitchen, facing camera' }, S);
  faceId = img.data.assets[0].id;
  assert.equal((await until(['ready'], faceId)).status, 'ready');
  const before = created.length;
  const r = await api('/studio/reels', 'POST', { brief: 'Customer testimonial for our desi ghee, ₹499 a litre', lang: 'hi', seconds: 15, presenter: { style: 'testimonial', imageId: faceId } }, S);
  assert.equal(r.status, 201, JSON.stringify(r.data));
  reelId = r.data.id;
  assert.match(prompts.at(-1), /presenter/, 'the script writer is asked for presenter scenes');
  assert.equal(r.data.script.shots[0].type, 'presenter');
  assert.equal(r.data.presenter.imageId, faceId);
  assert.equal(r.data.presenter.style, 'testimonial');
  // the cost: one presenter scene (lip-sync by the second, no still for it), one ordinary clip
  assert.equal(r.data.cost.presenter.scenes, 1);
  assert.equal(r.data.cost.presenter.perSecond, 14);
  const plain = (await api('/studio/estimate', 'POST', { kind: 'reel', tier: 'standard', seconds: 15, shots: 2, lines: 2 }, S)).data;
  const est = (await api('/studio/estimate', 'POST', { kind: 'reel', tier: 'standard', seconds: 15, shots: 2, lines: 2, presenters: 1, face: true }, S)).data;
  assert.equal(est.credits, r.data.cost.credits);
  assert.equal(est.presenter.credits, 14 * 7); // 13 s over 2 scenes: 6.5 s each, charged as 7
  assert.ok(est.credits !== plain.credits && est.storyboard < plain.storyboard, 'the face needs no still');
  assert.equal(created.length, before, 'nothing rendered yet');
  // a presenter scene naming a real person is refused when the script is edited
  const bad = { ...r.data.script, shots: [{ ...r.data.script.shots[0], image: 'Virat Kohli holding the jar' }, r.data.script.shots[1]] };
  assert.equal((await api(`/studio/reels/${reelId}/script`, 'PUT', { script: bad }, S)).status, 400);
  // the seller can switch scenes: both presenters, then back
  const both = await api(`/studio/reels/${reelId}/presenter`, 'POST', { scenes: [0, 1] }, S);
  assert.deepEqual(both.data.script.shots.map((s) => s.type || null), ['presenter', 'presenter']);
  assert.equal(both.data.cost.presenter.scenes, 2);
  const back = await api(`/studio/reels/${reelId}/presenter`, 'POST', { scenes: [0] }, S);
  assert.deepEqual(back.data.script.shots.map((s) => s.type || null), ['presenter', null]);
  assert.equal((await api(`/studio/reels/${reelId}/presenter`, 'POST', { face: { image: 'https://elsewhere.test/a.png' } }, S)).status, 400, 'only their own photo');
});

test('produced: the lip-sync model gets the line’s audio and the face; the video keeps one voice track in step', async () => {
  const before = created.length;
  heard.push(timed(LINES[0]), timed(LINES[1]), timed(LINES.join(' ')));
  assert.equal((await api(`/studio/reels/${reelId}/approve`, 'POST', {}, S)).data.status, 'producing');
  const r = await until(['ready', 'needs_review', 'failed']);
  assert.equal(r.status, 'ready', JSON.stringify({ error: r.error, issues: r.issues, shots: r.shots?.map((s) => s.clip?.issues) }));
  const mine = created.slice(before);
  // a still only for the ordinary scene: the presenter scene's still is the chosen face
  assert.equal(mine.filter((c) => /nano-banana/.test(c.model)).length, 1);
  const talk = mine.filter((c) => c.model === 'omnihuman-2-0');
  assert.equal(talk.length, 1);
  const face = await get(faceId);
  assert.deepEqual(talk[0].input.image_urls, [`https://app.presenter.test${face.url}`]);
  assert.equal(talk[0].input.enable_watermark, false);
  assert.ok(talk[0].input.prompt.length <= 300);
  // the audio: the scene's own line as it sits in the voiceover (2.8 s and the breath), padded past the model's 4 s minimum
  assert.match(talk[0].input.audio_url, /^https:\/\/app\.presenter\.test\/uploads\/.+\.wav$/);
  const audioSecs = secondsOf(onDisk(talk[0].input.audio_url));
  assert.ok(audioSecs >= 4 && audioSecs < 4.3, `audio ${audioSecs}`);
  assert.equal(r.shots[0].type, 'presenter');
  assert.equal(r.shots[0].clip.presenter, true);
  assert.equal(r.shots[0].clip.model, 'OmniHuman 2.0');
  assert.equal(mine.filter((c) => /seedance/.test(c.model)).length, 1, 'an AI clip only for the ordinary scene');
  // the finished video: one sound track (the presenter's own sound dropped), as long as the voiceover and the card
  const file = onDisk(r.outputs['9:16']), s = streams(file);
  assert.equal(s.streams.filter((x) => x.codec_type === 'audio').length, 1);
  const voice = 2.8 + 0.25 + 2.8 + 0.25; // two lines with their breaths, as joined
  assert.ok(Math.abs(Number(s.format.duration) - (0.15 + voice + 0.5 + 2.5)) < 0.3, `length ${s.format.duration}`);
});

test('a reworded line gets a new lip-synced clip; a caption change does not', async () => {
  let r = await api(`/studio/reels/${reelId}`, 'PUT', { captions: { style: 'karaoke' } }, S);
  heard.push(timed(LINES.join(' ')));
  const before = created.length;
  await until(['ready', 'needs_review', 'failed']);
  assert.equal(created.slice(before).filter((c) => c.model === 'omnihuman-2-0').length, 0);
  heard.push(timed('I tried every ghee in the market'), timed(['I tried every ghee in the market', LINES[1]].join(' ')));
  r = await api(`/studio/reels/${reelId}`, 'PUT', { lines: [{ i: 0, text: 'I tried every ghee in the market' }] }, S);
  assert.equal(r.data.status, 'producing');
  const done = await until(['ready', 'needs_review', 'failed']);
  assert.equal(done.status, 'ready', done.error);
  const again = created.slice(before).filter((c) => c.model === 'omnihuman-2-0');
  assert.equal(again.length, 1, 'the presenter speaks the new words');
});
