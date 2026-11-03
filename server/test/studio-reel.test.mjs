// A Reel end to end (studio/reels.js) with every outside service faked: the script is written first and waits for the
// seller; approving it makes each shot (image → clip, quality-checked) and each voiceover line (listened back to — a
// misread price is redone); then the edit puts it together with captions and the closing card in each size. Changing
// the caption style re-edits only; rewording a line re-voices that line, then re-edits.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { startServer, register, enable2fa } from './helpers.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'reel-test-'));
const ff = (...a) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...a]);
const LINES = ['Pure desi ghee for your whole family', 'Only ₹499 for one litre jar', 'Order today on WhatsApp now'];
const SCRIPT = { title: 'Ghee Reel', lines: LINES, shots: [{ image: 'A jar of ghee on a kitchen counter', motion: 'Slow push-in', seconds: 4 }, { image: 'Ghee poured over hot rice', motion: 'Pour in slow motion', seconds: 4 }], endCard: { headline: 'Shuddh Ghee Co', offer: '₹499 / litre', cta: 'Order on WhatsApp' } };
const created = [], heardQueue = [], spoken = []; // spoken: Sarvam text-to-speech requests
let fake, srv, api, ADMIN, S, sid, reelId;
// the editor's notes on a finished Reel: some fixes point at scenes that don't exist or change nothing, and there are too
// many — the server keeps only what can be applied. reviewDown: the reviewer doesn't answer
const REVIEW = { score: 72, summary: 'Clear offer, but the opening is slow.', suggestions: [
  { scene: 1, area: 'hook', problem: 'The first shot is a still jar', fix: 'Open on the pour', action: { type: 'redo_shot', scene: 1, note: 'Open on golden ghee pouring onto hot rice, close up' } },
  { scene: 2, area: 'voice', problem: 'The price line is flat', fix: 'Say it as a deal', action: { type: 'reword_line', scene: 2, text: 'Just ₹499 for a full litre' } },
  { scene: 9, area: 'visual', problem: 'Scene that isn’t there', fix: 'x', action: { type: 'redo_shot', scene: 9, note: 'nothing' } },
  { scene: null, area: 'captions', problem: 'Captions are small', fix: 'Bigger captions', action: { type: 'captions', style: 'neon' } },
  { scene: null, area: 'sparkle', problem: 'The closing card is busy', fix: 'Shorter call to action', action: { type: 'end_card', endCard: { cta: 'Order now' } } },
  { scene: 1, area: 'pacing', problem: 'One too many', fix: 'x', action: null },
] };
let reviewDown = false, reviewAsks = [];

// what the speech-to-text "hears": each line right, except the price the first time; then the whole voiceover
const timed = (text, start = 0) => { const ws = text.split(' '); return { transcript: text, language_code: 'en-IN', timestamps: { words: ws, start_time_seconds: ws.map((_, i) => start + i * 0.4), end_time_seconds: ws.map((_, i) => start + i * 0.4 + 0.35) } }; };
before(async () => {
  ff('-f', 'lavfi', '-i', 'testsrc2=size=768x1344', '-frames:v', '1', path.join(tmp, 'image.png'));
  // clips as long as ordered (4–10 s), like the real models
  for (let n = 4; n <= 10; n++) ff('-f', 'lavfi', '-i', 'testsrc2=size=720x1280:rate=24', '-t', String(n), '-c:v', 'libx264', '-crf', '28', '-pix_fmt', 'yuv420p', path.join(tmp, `clip${n}.mp4`));
  ff('-f', 'lavfi', '-i', 'sine=frequency=220:duration=2.8', '-ar', '44100', path.join(tmp, 'line.wav'));
  heardQueue.push(timed(LINES[0]), timed('Only four nine nine for one litre jar'), timed(LINES[1]), timed(LINES[2]), timed(LINES.join(' ')));
  fake = http.createServer((req, res) => {
    let b = '';
    req.on('data', (c) => { b += c; });
    req.on('end', () => {
      const url = new URL(req.url, 'http://x'), send = (o) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(o)); };
      if (url.pathname.startsWith('/files/')) return res.end(fs.readFileSync(path.join(tmp, url.pathname.slice(7))));
      if (url.pathname === '/speech-to-text') return send(heardQueue.shift() || timed(LINES.join(' ')));
      if (url.pathname === '/text-to-speech') { spoken.push(JSON.parse(b)); return send({ audios: [fs.readFileSync(path.join(tmp, 'line.wav')).toString('base64')] }); }
      if (url.pathname === '/openai/v1/responses') return send({ output: [{ type: 'message', content: [{ text: JSON.stringify(SCRIPT) }] }] });
      if (url.pathname === '/gemini-3-8-flash-openai/v1/chat/completions' && /senior video ad editor/.test(JSON.parse(b).messages[0].content[0].text)) {
        reviewAsks.push(JSON.parse(b).messages[0].content.length - 1);
        if (reviewDown) { res.writeHead(500); return res.end('{}'); }
        return send({ choices: [{ message: { content: JSON.stringify(REVIEW) } }] });
      }
      if (url.pathname === '/gemini-3-8-flash-openai/v1/chat/completions') return send({ choices: [{ message: { content: JSON.stringify({ product_match: 9, text_ok: 9, anatomy_ok: 10, matches_brief: 9, consistency: 9, safe: true, issues: [], fix: '' }) } }] });
      if (url.pathname === '/api/v1/jobs/createTask') { const body = JSON.parse(b); created.push(body); return send({ code: 200, data: { taskId: `t${created.length - 1}` } }); }
      if (url.pathname === '/api/v1/jobs/recordInfo') {
        const t = created[Number(url.searchParams.get('taskId').slice(1))];
        // kie.ai's voice model is down (as it was on 2 Nov 2026): every task fails
        if (/elevenlabs/.test(t.model)) return send({ code: 200, data: { state: 'fail', failCode: '500', failMsg: 'Internal Error' } });
        // music comes back as tracks with their own links, like the real one
        if (/ai-music-api/.test(t.model)) return send({ code: 200, data: { state: 'success', resultJson: JSON.stringify({ data: [{ audio_url: `http://127.0.0.1:${fake.address().port}/files/line.wav`, duration: 30 }] }) } });
        const file = /seedance|kling/.test(t.model) ?`clip${Math.min(10, Math.max(4, t.input.duration || 5))}.mp4` : 'image.png';
        return send({ code: 200, data: { state: 'success', resultJson: JSON.stringify({ resultUrls: [`http://127.0.0.1:${fake.address().port}/files/${file}`] }) } });
      }
      res.writeHead(404); res.end('{}');
    });
  }).listen(0);
  await new Promise((r) => setTimeout(r, 30));
  const base = `http://127.0.0.1:${fake.address().port}`;
  srv = await startServer({ KIE_API_KEY: 'kie-test', KIE_BASE_URL: base, SARVAM_API_KEY: 'sarvam-test', SARVAM_BASE_URL: base, ADMIN_EMAILS: 'boss@reel.test', APP_URL: 'https://app.reel.test' });
  api = srv.api;
  ADMIN = (await register(api, 'boss@reel.test')).token;
  const link = srv.log().match(/To: boss@reel\.test[\s\S]*?\/verify\?token=([a-f0-9.]+)/);
  await api('/auth/verify', 'POST', { token: link[1] });
  ADMIN = (await enable2fa(api, ADMIN)).token;
  S = (await register(api, 'maker@reel.test')).token;
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
const probe = (file) => { const d = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', file]).toString()); const v = d.streams.find((s) => s.codec_type === 'video'); return { w: v.width, h: v.height, s: Number(d.format.duration), audio: d.streams.some((s) => s.codec_type === 'audio') }; };
const onDisk = (url) => path.join(srv.dataDir, 'uploads', ...url.split('/').slice(2));

test('a brief becomes a script first; nothing renders until the seller approves it', async () => {
  assert.equal((await api('/studio/reels', 'POST', { brief: 'short' }, S)).status, 400);
  const r = await api('/studio/reels', 'POST', { brief: 'Desi ghee from our farm, ₹499 a litre, for families in Pune', lang: 'en', seconds: 15, tier: 'standard', sizes: ['9:16', '1:1'], captions: 'pop' }, S);
  assert.equal(r.status, 201, JSON.stringify(r.data));
  reelId = r.data.id;
  assert.equal(r.data.status, 'script_ready');
  assert.deepEqual(r.data.script.lines, LINES);
  assert.equal(created.length, 0, 'no renders yet');
  // the seller tweaks the closing card before approving
  const edited = { ...r.data.script, endCard: { ...r.data.script.endCard, cta: 'Order on WhatsApp today' } };
  assert.equal((await api(`/studio/reels/${reelId}/script`, 'PUT', { script: edited }, S)).data.script.endCard.cta, 'Order on WhatsApp today');
  // the gallery shows the Reel once, not its shots
  assert.equal((await api('/studio', 'GET', null, S)).data.assets.filter((a) => a.id === reelId).length, 1);
});

test('approved: shots and voiceover are made and checked (a misread price is redone), then edited in each size', async () => {
  const a = await api(`/studio/reels/${reelId}/approve`, 'POST', {}, S);
  assert.equal(a.data.status, 'producing');
  const r = await until(['ready', 'needs_review', 'failed']);
  assert.equal(r.status, 'ready', JSON.stringify({ status: r.status, error: r.error, issues: r.issues, lines: r.lines, shots: r.shots }));
  // the price line was spoken twice: the first one was heard as "four nine nine"
  assert.equal(r.lines[1].tries, 2);
  assert.ok(r.lines.every((l) => l.url && l.check?.ok));
  // the default voice is one of Sarvam's Indian voices (fast, made for Indian languages)
  assert.equal(spoken.length, 4, 'three lines, one redone');
  assert.deepEqual([spoken[0].speaker, spoken[0].model, spoken[0].target_language_code], ['priya', 'bulbul:v3', 'en-IN']);
  assert.equal(created.filter((c) => /elevenlabs/.test(c.model)).length, 0);
  // shots: still, then a clip from it, in order
  assert.equal(created.filter((c) => c.model === 'nano-banana-2-1').length, 2);
  assert.ok(created.filter((c) => /seedance/.test(c.model)).every((c) => /^https:\/\/app\.reel\.test\/uploads\//.test(c.input.first_frame_url)));
  // the outputs: each size, with sound, as long as the voiceover plus the closing card
  assert.deepEqual(Object.keys(r.outputs).sort(), ['1:1', '9:16']);
  const tall = probe(onDisk(r.outputs['9:16'])), square = probe(onDisk(r.outputs['1:1']));
  assert.deepEqual([tall.w, tall.h], [720, 1280]);
  assert.deepEqual([square.w, square.h], [720, 720]);
  assert.ok(tall.audio);
  assert.ok(tall.s > 9 && tall.s < 16, `length ${tall.s}`);
  assert.ok(r.poster);
  assert.match(r.links['9:16'], /^https:\/\/app\.reel\.test\/uploads\//, 'a public link for ads');
  // the editor's notes: frames across the finished video, and only fixes that can be applied
  assert.equal(reviewAsks.at(-1), 8, 'eight frames');
  assert.equal(r.reviewing, false);
  assert.equal(r.review.score, 72);
  assert.equal(r.review.summary, REVIEW.summary);
  assert.equal(r.review.suggestions.length, 5, 'at most five');
  const [a1, a2, a3, a4, a5] = r.review.suggestions;
  assert.deepEqual([a1.scene, a1.action], [0, { type: 'redo_shot', i: 0, note: REVIEW.suggestions[0].action.note }]);
  assert.deepEqual([a2.scene, a2.action], [1, { type: 'reword_line', i: 1, text: 'Just ₹499 for a full litre' }]);
  assert.deepEqual([a3.scene, a3.action], [null, null], 'no scene 9');
  assert.equal(a4.action, null, 'not a caption style');
  assert.equal(a5.area, 'story');
  assert.deepEqual(a5.action, { type: 'end_card', endCard: { headline: 'Shuddh Ghee Co', offer: '₹499 / litre', cta: 'Order now' } }, 'the rest of the card kept');
  assert.equal(r.shots[0].clip.redoCredits > 0, true, 'a redo shows its cost');
});

test('changes: a new caption style re-edits only; a reworded line re-voices that line, then re-edits', async () => {
  const before = (await get()).outputs['9:16'], renders = created.length;
  reviewDown = true; // the reviewer is down: the Reel is made all the same, with no notes
  const e = await api(`/studio/reels/${reelId}`, 'PUT', { captions: { style: 'karaoke' } }, S);
  assert.equal(e.data.status, 'editing');
  const r = await until(['ready', 'needs_review']);
  reviewDown = false;
  assert.equal(r.review, null);
  assert.equal(r.reviewing, false);
  assert.notEqual(r.outputs['9:16'], before);
  assert.equal(created.length, renders, 'nothing re-rendered');
  assert.equal(r.captions.style, 'karaoke');
  heardQueue.push(timed('Fresh desi ghee for your whole family'), timed(['Fresh desi ghee for your whole family', LINES[1], LINES[2]].join(' ')));
  const l = await api(`/studio/reels/${reelId}`, 'PUT', { lines: [{ i: 0, text: 'Fresh desi ghee for your whole family' }] }, S);
  assert.equal(l.data.status, 'producing');
  const r2 = await until(['ready', 'needs_review']);
  assert.equal(spoken.length, 5, 'one line re-voiced');
  assert.equal(r2.script.lines[0], 'Fresh desi ghee for your whole family');
  assert.equal(r2.review?.score, 72, 'reviewed again after the change');
  // a note's fix applied as it is: the closing card one re-edits only
  const card = r2.review.suggestions.find((x) => x.action?.type === 'end_card').action;
  const n = created.length;
  assert.equal((await api(`/studio/reels/${reelId}`, 'PUT', { endCard: card.endCard }, S)).data.status, 'editing');
  const r3 = await until(['ready', 'needs_review']);
  assert.equal(r3.script.endCard.cta, 'Order now');
  assert.equal(created.length, n, 'nothing re-rendered');
  assert.equal((await api(`/studio/reels/${reelId}`, 'PUT', { captions: { style: 'pop' } }, (await register(api)).token)).status, 403, 'not someone else’s');
});

test('another voice: an ElevenLabs voice through kie.ai, and Sarvam takes over when kie.ai can’t speak', async () => {
  // kie.ai's voice model fails every task here: the Reel still gets its voiceover, from Sarvam in the same gender
  const done = spoken.length;
  const e = await api(`/studio/reels/${reelId}`, 'PUT', { voice: 'P1bg08DkjqiVEzOn76yG' }, S);
  assert.equal(e.data.status, 'producing');
  heardQueue.push(...['Fresh desi ghee for your whole family', LINES[1], LINES[2]].map((t) => timed(t)), timed(['Fresh desi ghee for your whole family', LINES[1], LINES[2]].join(' ')));
  const r = await until(['ready', 'needs_review', 'failed']);
  assert.notEqual(r.status, 'failed', JSON.stringify(r.lines));
  assert.ok(created.some((c) => /elevenlabs/.test(c.model) && c.input.voice === 'P1bg08DkjqiVEzOn76yG'), 'kie.ai was asked first');
  assert.ok(spoken.slice(done).every((x) => x.speaker === 'aditya'), 'then a male Sarvam voice');
  // the voice samples: Sarvam's made once and kept
  const g = (await api('/studio', 'GET', null, S)).data;
  const priya = g.voices.find((v) => v.id === 'sarvam:priya');
  assert.equal(priya.sample, '/api/studio/voices/priya/sample');
  const a = await fetch(`${srv.base}${priya.sample}`), b = await fetch(`${srv.base}${priya.sample}`);
  assert.equal(a.headers.get('content-type'), 'audio/wav'); assert.ok((await b.arrayBuffer()).byteLength > 1000);
  assert.equal((await fetch(`${srv.base}/api/studio/voices/nobody/sample`)).status, 404);
});

test('photo motion: stills only (no AI clips), each animated by the editor; the cost is stills and voice', async () => {
  const r0 = (await api('/studio/reels', 'POST', { brief: 'Desi ghee from our farm, ₹499 a litre, for families in Pune', lang: 'en', seconds: 15, tier: 'quick', captions: 'pop' }, S)).data;
  reelId = r0.id;
  const est = r0.cost;
  assert.ok(est.photo < est.credits, JSON.stringify(est));
  const clipsBefore = created.filter((c) => /seedance|kling/.test(c.model)).length;
  heardQueue.push(...LINES.map((l) => timed(l)), timed(LINES.join(' ')));
  const a = await api(`/studio/reels/${reelId}/approve`, 'POST', { motion: 'photo' }, S);
  assert.equal(a.data.cost.motion, 'photo');
  assert.equal(a.data.cost.credits, 2 * a.data.cost.perImage + 3 + 12, 'two Quick stills, three lines and the music');
  const r = await until(['ready', 'needs_review', 'failed']);
  assert.ok(['ready', 'needs_review'].includes(r.status), JSON.stringify({ status: r.status, error: r.error }));
  assert.equal(created.filter((c) => /seedance|kling/.test(c.model)).length, clipsBefore, 'no AI clip ordered');
  assert.ok(r.shots.every((s) => s.clip?.photo && s.clip.status === 'ready'));
  const tall = probe(onDisk(r.outputs['9:16']));
  assert.ok(tall.audio && tall.s > 9 && tall.s < 16, `length ${tall.s}`);
});

test('the closing card: a long headline wraps and pushes the offer down — nothing overlaps, in any size', async () => {
  const { cardLayout } = await import('../studio/assemble.js');
  const card = { headline: 'Get paid faster from your own Tally', offer: '₹2,999/mo · Free setup · 14-day refund', cta: 'Book your free setup today' };
  for (const [W, H] of [[1080, 1920], [1920, 1080], [1080, 1080]]) for (const still of [true, false]) {
    const b = cardLayout(card, W, H, still);
    assert.equal(b.length, 3);
    for (let i = 1; i < b.length; i++) assert.ok(b[i].top > b[i - 1].top + b[i - 1].fs * 1.1, `${W}x${H} block ${i} starts below the one above`);
    assert.ok(b.at(-1).top < H * 0.97, `${W}x${H} fits`);
    if (still) assert.ok(b[0].top >= H * 0.5, 'under the picture');
  }
});

test('storyline in 16:9: each shot gets an opening and a closing still (made from the opening one), and the clip moves between them', async () => {
  const r0 = (await api('/studio/reels', 'POST', { brief: 'Desi ghee from our farm, ₹499 a litre, for families in Pune', lang: 'en', seconds: 15, tier: 'quick', aspect: '16:9', captions: 'pop' }, S)).data;
  reelId = r0.id;
  assert.equal(r0.aspect, '16:9');
  assert.deepEqual(r0.sizes, ['16:9'], 'the size asked for is the one made');
  const n = created.length;
  heardQueue.push(...LINES.map((l) => timed(l)), timed(LINES.join(' ')));
  const a = await api(`/studio/reels/${reelId}/approve`, 'POST', { motion: 'story', res: '480p' }, S);
  assert.equal(a.data.cost.motion, 'story');
  assert.equal(a.data.cost.credits, a.data.cost.byRes['480p']);
  const plain = (await api('/studio/estimate', 'POST', { kind: 'reel', tier: 'quick', seconds: 15, shots: 2, lines: 3, res: '480p' }, S)).data.credits;
  assert.equal(a.data.cost.credits, plain + 2 * a.data.cost.perImage, 'a second still per shot on top of the usual');
  const r = await until(['ready', 'needs_review', 'failed']);
  assert.ok(['ready', 'needs_review'].includes(r.status), JSON.stringify({ status: r.status, error: r.error }));
  const mine = created.slice(n), stills = mine.filter((c) => c.model === 'nano-banana-2-1'), clips = mine.filter((c) => /seedance/.test(c.model));
  assert.equal(stills.length, 4, 'two shots, two stills each');
  assert.equal(stills.filter((c) => c.input.image_input?.length).length, 2, 'each closing still is made from its opening still');
  assert.ok(stills.every((c) => c.input.aspect_ratio === '16:9'));
  assert.equal(clips.length, 2);
  assert.ok(clips.every((c) => c.input.first_frame_url && c.input.last_frame_url && c.input.first_frame_url !== c.input.last_frame_url));
  assert.ok(r.shots.every((s) => s.end?.url));
  const wide = probe(onDisk(r.outputs['16:9']));
  assert.ok(wide.w > wide.h, `${wide.w}x${wide.h}`);
});

test('every Reel gets a music bed in the script’s mood (instrumental, never offered as a choice), made once and reused', () => {
  const music = created.filter((c) => /ai-music-api/.test(c.model));
  assert.ok(music.length >= 1, 'music was made');
  assert.equal(music[0].input.instrumental, true);
  assert.equal(music[0].input.custom_mode, true);
  assert.match(music[0].input.style, /instrumental, no vocals/);
  assert.ok(music[0].input.duration >= 10);
  // a re-edit (new caption style) doesn't make music again: one per Reel
  const reels = new Set(created.filter((c) => /ai-music-api/.test(c.model)).map((c) => c.input.title));
  assert.ok(music.length <= reels.size + 3, `${music.length} music tasks`);
});
