// The Creative Standard (studio/standard.js) and the cinematography layer (studio/cinema.js): rules checked by code, not
// by an AI's opinion. The treatment's shot sizes vary and the first frame is striking whatever the writer sent; captions
// land inside the platform's safe zone at a readable size; the hook rules (a short first line that does what the named
// hook says, the product early) come with free suggested script fixes; and the gate keeps a weak Reel at needs_review
// with the failing rules, after the free fixes (captions turned back on) were applied and re-checked — with no extra paid
// render. Every outside service is faked, as in studio-reel.test.mjs.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { startServer, register, enable2fa } from './helpers.mjs';
import { checkVideo, checkDesign, gateOf, splitHook, SAFE, MIN_CAPTION, QUALITY_BAR, HOOK_MAX_WORDS, reelFormat } from '../studio/standard.js';
import { enforceTreatment, filmPrompt, movePrompt, STRIKING } from '../studio/cinema.js';
import { captionPlace, buildAss, PRESETS } from '../studio/captions.js';
import { safeBox } from '../studio/typeset.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'standard-test-'));
const ff = (...a) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...a]);
const LINES = ['Is your ghee really pure?', 'Ours is slow-cooked on our farm', 'Order today on WhatsApp now'];
// the writer sends every shot at the same size, the opening one static: the treatment rules fix that for free
const LOOK = { palette: ['#f5c542', 'warm wood', 'cream'], mood: 'warm, homely', lighting: 'soft morning window key, bounce fill', lens: '35mm and 85mm primes', film: 'Kodak Portra, gentle contrast' };
const SCRIPT = { title: 'Pure Ghee', hook: 'question', structure: 'pas', look: LOOK, lines: LINES,
  shots: [
    { image: 'A jar of golden ghee on a kitchen counter', motion: 'Steam rises', seconds: 4, beat: 'problem', product: true, cam: { size: 'medium', angle: 'eye level', lens: '50mm', light: 'window light', composition: 'jar on the left third', blocking: 'jar alone on the counter', move: 'static' } },
    { image: 'Ghee poured over hot rice', motion: 'Pour in slow motion', seconds: 4, beat: 'solution', product: true, cam: { size: 'medium', angle: 'high', lens: '50mm', light: 'window light', composition: 'centred', blocking: 'a hand pours', move: 'tilt' } },
  ],
  endCard: { headline: 'Shuddh Ghee Co', offer: '₹499 / litre', cta: 'Order on WhatsApp' }, music: 'Warm flute' };
const created = [], scriptAsks = [], heardQueue = [];
let reviewScore = 60, reviews = 0, fake, srv, api, ADMIN, S, sid, reelId;
const timed = (text, start = 0) => { const ws = text.split(' '); return { transcript: text, language_code: 'en-IN', timestamps: { words: ws, start_time_seconds: ws.map((_, i) => start + i * 0.4), end_time_seconds: ws.map((_, i) => start + i * 0.4 + 0.35) } }; };

before(async () => {
  ff('-f', 'lavfi', '-i', 'testsrc2=size=768x1344', '-frames:v', '1', path.join(tmp, 'image.png'));
  for (let n = 4; n <= 10; n++) ff('-f', 'lavfi', '-i', 'testsrc2=size=720x1280:rate=24', '-t', String(n), '-c:v', 'libx264', '-crf', '28', '-pix_fmt', 'yuv420p', path.join(tmp, `clip${n}.mp4`));
  ff('-f', 'lavfi', '-i', 'sine=frequency=220:duration=2.8', '-ar', '44100', path.join(tmp, 'line.wav'));
  fake = http.createServer((req, res) => {
    let b = '';
    req.on('data', (c) => { b += c; });
    req.on('end', () => {
      const url = new URL(req.url, 'http://x'), send = (o) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(o)); };
      if (url.pathname.startsWith('/files/')) return res.end(fs.readFileSync(path.join(tmp, url.pathname.slice(7))));
      if (url.pathname === '/speech-to-text') return send(heardQueue.shift() || timed(LINES.join(' ')));
      if (url.pathname === '/text-to-speech') return send({ audios: [fs.readFileSync(path.join(tmp, 'line.wav')).toString('base64')] });
      if (url.pathname === '/openai/v1/responses') { const j = JSON.parse(b || '{}'); scriptAsks.push(`${j.instructions || ''}\n${j.input?.at(-1)?.content || ''}`); return send({ output: [{ type: 'message', content: [{ text: JSON.stringify(SCRIPT) }] }] }); }
      if (/chat\/completions$/.test(url.pathname) && /senior video ad editor/.test(b)) { reviews++; return send({ choices: [{ message: { content: JSON.stringify({ score: reviewScore, virality: 70, summary: 'Checked.', suggestions: [] }) } }] }); }
      if (/chat\/completions$/.test(url.pathname)) return send({ choices: [{ message: { content: JSON.stringify({ product_match: 9, text_ok: 9, anatomy_ok: 10, matches_brief: 9, consistency: 9, safe: true, issues: [], fix: '' }) } }] });
      if (url.pathname === '/api/v1/jobs/createTask') { created.push(JSON.parse(b)); return send({ code: 200, data: { taskId: `t${created.length - 1}` } }); }
      if (url.pathname === '/api/v1/jobs/recordInfo') {
        const t = created[Number(url.searchParams.get('taskId').slice(1))];
        if (/ai-music-api/.test(t.model)) return send({ code: 200, data: { state: 'success', resultJson: JSON.stringify({ data: [{ audio_url: `http://127.0.0.1:${fake.address().port}/files/line.wav`, duration: 30 }] }) } });
        const file = /seedance|kling|veo|grok/.test(t.model) ? `clip${Math.min(10, Math.max(4, t.input.duration || 5))}.mp4` : 'image.png';
        return send({ code: 200, data: { state: 'success', resultJson: JSON.stringify({ resultUrls: [`http://127.0.0.1:${fake.address().port}/files/${file}`] }) } });
      }
      res.writeHead(404); res.end('{}');
    });
  }).listen(0);
  await new Promise((r) => setTimeout(r, 30));
  const base = `http://127.0.0.1:${fake.address().port}`;
  srv = await startServer({ KIE_API_KEY: 'kie-test', KIE_BASE_URL: base, SARVAM_API_KEY: 'sarvam-test', SARVAM_BASE_URL: base, ADMIN_EMAILS: 'boss@standard.test', APP_URL: 'https://app.standard.test' });
  api = srv.api;
  ADMIN = (await register(api, 'boss@standard.test')).token;
  const link = srv.log().match(/To: boss@standard\.test[\s\S]*?\/verify\?token=([a-f0-9.]+)/);
  await api('/auth/verify', 'POST', { token: link[1] });
  ADMIN = (await enable2fa(api, ADMIN)).token;
  S = (await register(api, 'maker@standard.test')).token;
  sid = (await api('/me', 'GET', null, S)).data.id;
  await api('/settings', 'PUT', { businessName: 'Shuddh Ghee Co' }, S);
  await api(`/admin/studio/accounts/${sid}`, 'PUT', { on: true }, ADMIN);
});
after(async () => { await srv?.stop(); fake?.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

const get = async () => (await api(`/studio/assets/${reelId}`, 'GET', null, S)).data;
async function until(statuses, max = 80) {
  for (let i = 0; i < max; i++) { await api('/__test/studio-tick', 'POST', { times: 1 }); const r = await get(); if (statuses.includes(r.status)) return r; }
  throw new Error(`stuck at ${(await get()).status}`);
}
const ruleOf = (st, id) => st.rules.find((x) => x.id === id);

test('the treatment: no two shot sizes alike back to back, a striking first frame, every still in one look', () => {
  const { shots, changes } = enforceTreatment([{ image: 'a', cam: { size: 'wide', move: 'static' } }, { image: 'b', cam: { size: 'wide' } }, { image: 'c', cam: { size: 'wide' } }, { image: 'd', cam: { size: 'close' } }]);
  for (let i = 1; i < shots.length; i++) assert.notEqual(shots[i].cam.size, shots[i - 1].cam.size, `shots ${i} and ${i + 1}`);
  assert.ok(STRIKING.includes(shots[0].cam.size) || shots[0].cam.move !== 'static', 'the first frame moves or is close');
  assert.equal(changes.length, 2);
  // the stills share the look; the clip prompt leads with the camera move
  const p = filmPrompt({ image: 'Ghee on rice', cam: { size: 'macro', angle: 'high', light: 'rim light', move: 'push in' } }, LOOK);
  assert.match(p, /^Ghee on rice/);
  assert.match(p, /extreme close-up macro/);
  assert.match(p, /100mm macro lens/);
  assert.match(p, /Kodak Portra/);
  assert.match(movePrompt({ motion: 'Steam rises', cam: { move: 'dolly' } }), /^Camera: slow dolly\. Steam rises/);
  assert.equal(filmPrompt({ image: 'plain' }, null), 'plain', 'an old script without a treatment is untouched');
});

test('captions: inside the safe zone and readable, in every look and frame — the free fixes applied', () => {
  for (const id of Object.keys(PRESETS)) {
    const p = captionPlace(id, 1080, 1920);
    assert.ok(p.top >= 1920 * SAFE.vertical.top, `${id} clear of the top bar`);
    assert.ok(p.bottom <= 1920 * (1 - SAFE.vertical.bottom), `${id} clear of the bottom ${SAFE.vertical.bottom * 100}%`);
    assert.ok(p.size >= 1080 * MIN_CAPTION.vertical - 1, `${id} at least ${MIN_CAPTION.vertical} of the width`);
    const style = buildAss([{ w: 'Hi', start: 0, end: 0.4 }], { style: id }).split('\n').find((l) => l.startsWith('Style:')).split(',');
    assert.equal(Number(style[2]), p.size, 'the render uses the same placement');
    assert.ok(Number(style[21]) >= 1920 * SAFE.vertical.bottom, 'the line sits above the Reels UI');
  }
  // the quiet look is moved and enlarged on a Reel: both counted as free fixes
  const st = checkVideo(SCRIPT, { format: 'reel', seconds: 15, aspect: '9:16', captions: { style: 'minimal' } });
  assert.equal(ruleOf(st, 'caption_safe').ok, true);
  assert.equal(ruleOf(st, 'caption_safe').auto, true);
  assert.equal(ruleOf(st, 'caption_size').auto, true);
  // captions off fails the sound-off rule (and is fixed for free in the edit)
  const off = checkVideo(SCRIPT, { format: 'reel', seconds: 15, aspect: '9:16', captions: null });
  assert.equal(ruleOf(off, 'captions_on').ok, false);
  assert.equal(off.passed, false);
});

test('the hook rules: a short first line that does what the named hook says, the product early — with suggested fixes', () => {
  const good = checkVideo({ ...SCRIPT, shots: enforceTreatment(SCRIPT.shots).shots }, { format: 'ad', seconds: 15, aspect: '9:16', captions: { style: 'pop' } });
  assert.equal(good.passed, true, JSON.stringify(good.rules.filter((x) => x.ok === false)));
  assert.equal(reelFormat({ aspect: '9:16', variant: { angle: 'pain' } }), 'ad');
  assert.equal(reelFormat({ aspect: '16:9' }), 'vsl');
  // a long first line that isn't a question, and the product only in the last scene
  const bad = { ...SCRIPT, lines: ['Our family has made pure desi ghee on our own farm for three generations now', 'Cows graze on open fields', 'Slow-cooked in small batches', 'Order on WhatsApp'], shots: [{ ...SCRIPT.shots[0], product: false, beat: 'problem' }, { ...SCRIPT.shots[1], product: false, beat: 'agitate', cam: { ...SCRIPT.shots[1].cam, size: 'wide' } }, { image: 'The jar on a table', motion: 'Orbit', product: true, beat: 'solution', cam: { size: 'close', move: 'orbit' } }] };
  const st = checkVideo(bad, { format: 'ad', seconds: 15, aspect: '9:16', captions: { style: 'pop' } });
  assert.equal(ruleOf(st, 'hook_short').ok, false);
  assert.equal(ruleOf(st, 'hook_done').ok, false, 'a question hook needs a question');
  assert.equal(ruleOf(st, 'product_early').ok, false);
  assert.match(ruleOf(st, 'product_early').fix, /Move scene 3 up to scene 2/);
  // the suggested script: the hook split to ≤ 7 words (the rest joins the next line), the product's scene moved up
  // behind the hook — the seller applies it in one click, free (nothing is made yet)
  assert.ok(st.script.lines[0].split(' ').length <= HOOK_MAX_WORDS);
  assert.equal(st.script.lines.join(' ').split(' ').length, bad.lines.join(' ').split(' ').length, 'no word lost');
  assert.equal(st.script.shots[1].product, true);
  assert.equal(st.script.shots[0].image, bad.shots[0].image, 'the hook scene stays first');
  assert.equal(splitHook(SCRIPT), null);
  // no hook or structure named: both fail
  const legacy = checkVideo({ lines: LINES, shots: [{ image: 'a jar', motion: 'still' }], endCard: {} }, { format: 'reel', captions: { style: 'pop' } });
  assert.deepEqual(['hook_named', 'structure_named', 'hook_frame', 'cta'].map((id) => ruleOf(legacy, id).ok), [false, false, false, false]);
});

test('the gate: ready only with every rule passing and a review score at the bar', () => {
  const st = checkVideo({ ...SCRIPT, shots: enforceTreatment(SCRIPT.shots).shots }, { format: 'reel', seconds: 15, aspect: '9:16', captions: { style: 'pop' } });
  assert.equal(gateOf(st, QUALITY_BAR).ready, true);
  assert.equal(gateOf(st, QUALITY_BAR - 1).ready, false);
  assert.equal(gateOf(st, null).ready, false, 'no review, not ready');
  const off = checkVideo(SCRIPT, { format: 'reel', seconds: 15, aspect: '9:16', captions: null });
  assert.equal(gateOf(off, 95).ready, false, 'a failing rule holds even a great score');
  assert.ok(gateOf(off, 95).issues.some((x) => /Captions on/.test(x)));
});

test('designs: the headline, the call to action, the safe zone — checked by code', () => {
  const fields = (t) => (t === 'sale' ? ['headline', 'cta'] : ['headline']);
  const story = checkDesign({ group: 'post', format: 'story', bg: 'photo', slides: [{ template: 'sale', text: { headline: 'Mega *Diwali* Sale', cta: '' } }] }, { fields, safe: safeBox(1080, 1920), size: { w: 1080, h: 1920 } });
  assert.equal(ruleOf(story, 'headline_short').ok, true);
  assert.equal(ruleOf(story, 'cta').ok, false);
  assert.equal(ruleOf(story, 'safe_zone').ok, true, 'the typesetter keeps the story zone');
  const thumb = checkDesign({ group: 'thumbnail', format: 'thumbnail', bg: 'ai', bgUrl: null, slides: [{ template: 'x', text: { headline: 'Seven words is far too many here' } }] }, { fields });
  assert.equal(ruleOf(thumb, 'headline_short').ok, false, 'thumbnails: 5 words at most');
  assert.equal(ruleOf(thumb, 'final_picture').ok, false);
});

test('a weak Reel: made, the free fix (captions back on) applied and re-checked, held at needs_review — no extra paid render', async () => {
  const r0 = await api('/studio/reels', 'POST', { brief: 'Desi ghee from our farm, ₹499 a litre, for families in Pune', lang: 'en', seconds: 15, tier: 'standard', captions: 'pop' }, S);
  assert.equal(r0.status, 201, JSON.stringify(r0.data));
  reelId = r0.data.id;
  // the script came back with its treatment, the playbook picks and the standard
  const sizes = r0.data.treatment.shots.map((c) => c.size);
  assert.notEqual(sizes[0], sizes[1], 'the second medium became another size');
  assert.notEqual(r0.data.treatment.shots[0].move, 'static', 'the opening shot moves');
  assert.deepEqual([r0.data.hook.id, r0.data.structure.id], ['question', 'pas']);
  assert.equal(r0.data.standard.format, 'reel');
  assert.ok(r0.data.standard.rules.every((x) => x.ok !== false), JSON.stringify(r0.data.standard.rules.filter((x) => x.ok === false)));
  assert.match(scriptAsks.at(-1), /Hooks \(pick one/, 'the writer is given the playbook');
  // the seller turns captions off before approving
  await api(`/studio/reels/${reelId}/script`, 'PUT', { captions: null }, S);
  assert.equal(ruleOf((await get()).standard, 'captions_on').ok, false);
  heardQueue.push(...LINES.map((l) => timed(l)));
  await api(`/studio/reels/${reelId}/approve`, 'POST', {}, S);
  const r = await until(['ready', 'needs_review', 'failed']);
  assert.equal(r.status, 'needs_review', JSON.stringify({ error: r.error, issues: r.issues }));
  // the stills went out with the treatment: the frame and the look
  const stills = created.filter((c) => /nano-banana|gpt-image|seedream/.test(c.model));
  assert.ok(stills.every((c) => /Frame: /.test(c.input.prompt) && /Kodak Portra/.test(c.input.prompt)), stills.map((c) => c.input.prompt).join('\n---\n'));
  // the free fix: captions back on, edited again and re-checked (reviewed twice); nothing paid made again
  assert.equal(r.captions.style, 'pop');
  assert.equal(reviews, 2, 'reviewed, fixed, reviewed again');
  const paid = created.length;
  assert.deepEqual([stills.length, created.filter((c) => /seedance|kling|veo|grok/.test(c.model)).length, created.filter((c) => /ai-music-api/.test(c.model)).length], [2, 2, 1], 'two stills, two clips, one music bed — once');
  // what's left fails only the score: the gate says so, with the bar
  assert.equal(r.standard.passed, true, JSON.stringify(r.standard.rules.filter((x) => x.ok === false)));
  assert.equal(ruleOf(r.standard, 'captions_on').ok, true);
  assert.ok(ruleOf(r.standard, 'pace').ok, ruleOf(r.standard, 'pace').detail);
  assert.ok(Number(/over (\d+) cuts/.exec(ruleOf(r.standard, 'pace').detail)[1]) > r.shots.length, 'the editor punched in on the long shot');
  assert.equal(ruleOf(r.standard, 'voice_starts').ok, true);
  assert.deepEqual([r.gate.ready, r.gate.score, r.gate.bar], [false, 60, QUALITY_BAR]);
  assert.ok(r.issues.some((x) => /scored 60; 80 is the bar/.test(x)), JSON.stringify(r.issues));
  // a free change (another caption look) re-edits and re-checks: now it scores at the bar → ready, still nothing paid
  reviewScore = 88;
  assert.equal((await api(`/studio/reels/${reelId}`, 'PUT', { captions: { style: 'karaoke' } }, S)).data.status, 'editing');
  const r2 = await until(['ready', 'needs_review', 'failed']);
  assert.equal(r2.status, 'ready', JSON.stringify(r2.issues));
  assert.equal(r2.gate.ready, true);
  assert.equal(created.length, paid, 'no extra paid render');
});

test('the look book: the first approved video’s look is kept for the brand and handed to the next script', async () => {
  const mem = (await api('/studio/memory', 'GET', null, S)).data;
  assert.equal(mem.brand.look.film, LOOK.film);
  await api('/studio/reels', 'POST', { brief: 'Desi ghee for Diwali gifting, ₹499 a litre', lang: 'en', seconds: 15 }, S);
  assert.match(scriptAsks.at(-1), /look book[^\n]*Kodak Portra/);
});
