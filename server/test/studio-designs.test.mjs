// Studio Designs (studio/designs.js, typeset.js) with every outside service faked: a brief → the words in Hindi and a
// free preview drawn by our own typesetter (never the image model); the check before spending; the background picture
// as the only paid step; free re-draws for every change; long words shrink and wrap to fit; a carousel is N slides on
// one background, downloadable as a zip.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { startServer, register, enable2fa } from './helpers.mjs';
import { fit, fontFor, scriptOf } from '../studio/typeset.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'design-test-'));
const ff = (...a) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...a]);
const HINDI = { template: 'festive-glow', background: 'Diyas glowing on a rangoli at dusk, warm bokeh, the centre calm and dark', text: { kicker: 'आपको और आपके परिवार को', headline: 'शुभ *दीपावली*', sub: 'यह रोशनी का त्योहार आपके जीवन में खुशियाँ और समृद्धि लाए' } };
const CAROUSEL = { background: 'A jar of golden ghee on a wooden kitchen counter, morning light', cover: { kicker: 'Save this', headline: '5 ways to keep *ghee* fresh', sub: 'Habits our grandmothers swore by', swipe: 'Swipe' }, slides: [{ heading: 'Use glass jars', body: 'Glass keeps air and smells out.' }, { heading: 'Dry spoon only', body: 'One drop of water can spoil a jar.' }, { heading: 'Keep it away from the stove', body: 'Heat makes it go rancid faster.' }], end: { headline: 'Found this useful?', sub: 'Share it with someone who cooks', cta: 'Follow for more' } };
const CHECK = { quality: 74, virality: 66, verdict: 'Warm greeting; the message is long.', problems: ['The message is long for a phone'], slides: [{ slide: 1, text: { sub: 'रोशनी और खुशियों से भरी हो आपकी दिवाली', bogus: 'dropped' } }, { slide: 7, text: { headline: 'ghost' } }], background: '' };
const created = [], copyAsks = [];
let copy = HINDI, fake, srv, api, ADMIN, S, sid;

before(async () => {
  ff('-f', 'lavfi', '-i', 'mandelbrot=s=1024x1024', '-frames:v', '1', path.join(tmp, 'image.png'));
  fake = http.createServer((req, res) => {
    let b = '';
    req.on('data', (c) => { b += c; });
    req.on('end', () => {
      const url = new URL(req.url, 'http://x'), send = (o) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(o)); };
      if (url.pathname.startsWith('/files/')) return res.end(fs.readFileSync(path.join(tmp, url.pathname.slice(7))));
      if (url.pathname === '/openai/v1/responses') {
        const j = JSON.parse(b || '{}');
        if (/creative director/.test(j.instructions || '')) return send({ output: [{ type: 'message', content: [{ text: JSON.stringify(CHECK) }] }] });
        copyAsks.push(j.input?.at(-1)?.content || '');
        return send({ output: [{ type: 'message', content: [{ text: JSON.stringify(copy) }] }] });
      }
      if (/chat\/completions$/.test(url.pathname)) return send({ choices: [{ message: { content: JSON.stringify({ product_match: 9, text_ok: 9, anatomy_ok: 10, matches_brief: 9, consistency: 9, safe: true, issues: [], fix: '' }) } }] });
      if (url.pathname === '/api/v1/jobs/createTask') { created.push(JSON.parse(b)); return send({ code: 200, data: { taskId: `t${created.length - 1}` } }); }
      if (url.pathname === '/api/v1/jobs/recordInfo') return send({ code: 200, data: { state: 'success', resultJson: JSON.stringify({ resultUrls: [`http://127.0.0.1:${fake.address().port}/files/image.png`] }) } });
      res.writeHead(404); res.end('{}');
    });
  }).listen(0);
  await new Promise((r) => setTimeout(r, 30));
  const base = `http://127.0.0.1:${fake.address().port}`;
  srv = await startServer({ KIE_API_KEY: 'kie-test', KIE_BASE_URL: base, ADMIN_EMAILS: 'boss@design.test', APP_URL: 'https://app.design.test' });
  api = srv.api;
  ADMIN = (await register(api, 'boss@design.test')).token;
  const link = srv.log().match(/To: boss@design\.test[\s\S]*?\/verify\?token=([a-f0-9.]+)/);
  await api('/auth/verify', 'POST', { token: link[1] });
  ADMIN = (await enable2fa(api, ADMIN)).token;
  S = (await register(api, 'maker@design.test')).token;
  sid = (await api('/me', 'GET', null, S)).data.id;
  await api('/settings', 'PUT', { businessName: 'Shuddh Ghee Co' }, S);
  await api(`/admin/studio/accounts/${sid}`, 'PUT', { on: true }, ADMIN);
  await api('/studio/memory', 'PUT', { brand: { colours: ['#7a1022', '#f5c542'], font: 'serif' } }, S);
});
after(async () => { await srv?.stop(); fake?.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

const onDisk = (url) => path.join(srv.dataDir, 'uploads', ...url.split('/').slice(2));
const size = (file) => { const d = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_streams', file]).toString()); return [d.streams[0].width, d.streams[0].height]; };
async function until(id, statuses, max = 40) {
  for (let i = 0; i < max; i++) { await api('/__test/studio-tick', 'POST', { times: 1 }); const d = (await api(`/studio/designs/${id}`, 'GET', null, S)).data; if (statuses.includes(d.status)) return d; }
  throw new Error('stuck');
}
let did, firstUrl;

test('a Hindi festive design: the words are written and typeset in a free preview, nothing rendered by the provider', async () => {
  assert.equal((await api('/studio/designs', 'POST', { brief: 'x' }, S)).status, 400);
  const r = await api('/studio/designs', 'POST', { brief: 'Diwali greeting for our customers', template: 'festive-glow', format: 'portrait', lang: 'hi' }, S);
  assert.equal(r.status, 201, JSON.stringify(r.data));
  did = r.data.id;
  assert.equal(r.data.status, 'draft');
  assert.equal(r.data.preview, true);
  assert.equal(created.length, 0, 'no picture is made before the go-ahead');
  assert.match(copyAsks.at(-1), /Language: Hindi/);
  assert.equal(r.data.slides[0].text.headline, 'शुभ *दीपावली*');
  assert.deepEqual(r.data.colours, ['#7a1022', '#f5c542'], 'the brand colours from memory');
  assert.equal(r.data.family, 'serif', 'the brand lettering from memory');
  assert.ok(r.data.credits > 0);
  const file = onDisk(r.data.url);
  assert.deepEqual(size(file), [1080, 1350]);
  firstUrl = r.data.url;
  // the gallery shows the design once
  assert.equal((await api('/studio', 'GET', null, S)).data.assets.filter((a) => a.id === did).length, 1);
  // a copy of the Hindi render for a human to look at (shaping of conjuncts and matras)
  fs.copyFileSync(file, path.join(os.tmpdir(), 'studio-design-hindi-preview.png'));
});

test('the check before spending: better words for real fields only', async () => {
  const r = await api(`/studio/designs/${did}/assess`, 'POST', {}, S);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.assessment.quality, 74);
  assert.deepEqual(r.data.assessment.slides, [{ i: 0, text: { sub: 'रोशनी और खुशियों से भरी हो आपकी दिवाली' } }]);
  assert.equal(created.length, 0);
});

test('the go-ahead makes one background picture without words, then every slide is drawn on it', async () => {
  const r = await api(`/studio/designs/${did}/make`, 'POST', {}, S);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.status, 'producing');
  // drawn, but held at needs_review by the Creative Standard's gate: the director's check scored it 74 (the bar is 80)
  const d = await until(did, ['ready', 'needs_review', 'failed']);
  assert.equal(d.status, 'needs_review', d.error);
  assert.equal(d.standard.passed, true, JSON.stringify(d.standard.rules));
  assert.ok(d.gate.issues.some((x) => /scored 74; 80 is the bar/.test(x)));
  assert.equal(created.length, 1);
  assert.match(created[0].input.prompt, /No text, letters/);
  assert.equal(created[0].input.aspect_ratio, '4:5');
  assert.equal(d.preview, false);
  assert.deepEqual(size(onDisk(d.url)), [1080, 1350]);
  assert.ok(!fs.existsSync(onDisk(firstUrl)), 'the preview file is replaced, not kept');
  fs.copyFileSync(onDisk(d.url), path.join(os.tmpdir(), 'studio-design-hindi.png'));
  // the background picture isn't shown again on its own in the gallery
  assert.ok(!(await api('/studio', 'GET', null, S)).data.assets.some((a) => a.id === d.picture.id));
});

test('edits are free re-draws: words, colours, template and size change without calling the provider', async () => {
  const before = created.length;
  const r = await api(`/studio/designs/${did}`, 'PUT', { slides: [{ i: 0, text: { sub: 'रोशनी और खुशियों से भरी हो आपकी दिवाली' } }], colours: ['#0b3d91', '#ff9933'], format: 'story' }, S);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.slides[0].text.sub, 'रोशनी और खुशियों से भरी हो आपकी दिवाली');
  assert.equal(r.data.slides[0].text.headline, 'शुभ *दीपावली*', 'untouched words stay');
  assert.deepEqual(size(onDisk(r.data.url)), [1080, 1920]);
  const t = await api(`/studio/designs/${did}`, 'PUT', { template: 'festive-frame' }, S);
  assert.equal(t.data.slides[0].template, 'festive-frame');
  assert.equal(t.data.status, 'ready');
  assert.equal(created.length, before, 'no provider call for an edit');
  assert.ok(t.data.version >= 4);
});

test('long text shrinks and wraps to fit its box', () => {
  const st = { font: fontFor('x'), weight: 900 };
  const short = fit('Big sale', { st, w: 900, h: 400, max: 130, maxLines: 3 });
  const long = fit('The biggest festive sale of the year on every saree kurta and lehenga in our store this week only', { st, w: 900, h: 400, max: 130, maxLines: 3 });
  assert.equal(short.size, 130);
  assert.ok(long.size < short.size, `${long.size} < ${short.size}`);
  assert.ok(long.lines.length <= 3);
  assert.ok(long.lines.length * long.size * 1.08 <= 400 + 1);
  assert.ok(long.lines.every((l) => l.width <= 900));
  // far too long for the box at the smallest size: cut with an ellipsis, still inside the line limit
  const huge = fit(Array.from({ length: 80 }, () => 'word').join(' '), { st, w: 600, h: 200, max: 80, min: 40, maxLines: 2 });
  assert.equal(huge.lines.length, 2);
  assert.match(huge.lines.at(-1).words.at(-1).w, /…$/);
  assert.equal(scriptOf('शुभ दीपावली from Shuddh'), 'devanagari');
  assert.equal(fontFor('નવું વર્ષ'), 'Noto Sans Gujarati');
});

test('a carousel: a brief becomes N slides on one background, downloadable as a zip', async () => {
  copy = CAROUSEL;
  const r = await api('/studio/designs', 'POST', { brief: 'How to keep ghee fresh for months', group: 'carousel', slides: 5, lang: 'en' }, S);
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.equal(r.data.slides.length, 5);
  assert.deepEqual(r.data.slides.map((s) => s.template), ['carousel-cover', 'carousel-content', 'carousel-content', 'carousel-content', 'carousel-end']);
  assert.equal(r.data.outputs.length, 5);
  for (const u of r.data.outputs) assert.deepEqual(size(onDisk(u)), [1080, 1350]);
  const before = created.length;
  await api(`/studio/designs/${r.data.id}/make`, 'POST', {}, S);
  const d = await until(r.data.id, ['ready', 'failed']);
  assert.equal(d.status, 'ready');
  assert.equal(created.length, before + 1, 'one picture for the whole carousel');
  const z = await fetch(`${srv.base}/api/studio/designs/${d.id}/zip`, { headers: { Authorization: `Bearer ${S}` } });
  assert.equal(z.status, 200);
  const { unzipSync } = await import('fflate');
  const files = Object.keys(unzipSync(new Uint8Array(await z.arrayBuffer())));
  assert.deepEqual(files, ['01-cover.png', '02-slide.png', '03-slide.png', '04-slide.png', '05-end.png']);
});

test('AI typography (English only): a words-capable model paints the headline; the typesetter leaves it out', async () => {
  copy = { template: 'sale-burst', background: 'Shopping bags on a bright backdrop', text: { kicker: 'Today only', badge: '40% OFF', headline: 'Mega Sale', sub: 'On everything', date: '', cta: 'Shop now' } };
  const r = await api('/studio/designs', 'POST', { brief: 'A one-day sale on everything', template: 'sale-burst', lang: 'en', typography: true }, S);
  assert.equal(r.data.typography, true);
  await api(`/studio/designs/${r.data.id}/make`, 'POST', {}, S);
  const d = await until(r.data.id, ['ready', 'failed']);
  assert.equal(d.status, 'ready');
  const job = created.at(-1);
  assert.match(job.model, /gpt-image-2|ideogram/);
  assert.match(job.input.prompt, /"Mega Sale"/);
  assert.doesNotMatch(job.input.prompt, /No added text/);
  // a Hindi design never gets AI lettering
  copy = HINDI;
  const h = await api('/studio/designs', 'POST', { brief: 'Diwali greeting', template: 'festive-glow', lang: 'hi', typography: true }, S);
  assert.equal(h.data.typography, false);
});

test('only the seller’s own pictures, and only their own designs', async () => {
  assert.equal((await api('/studio/designs', 'POST', { brief: 'Diwali greeting for all', photo: 'https://evil.example/x.png' }, S)).status, 400);
  const other = (await register(api, 'other@design.test')).token;
  assert.equal((await api(`/studio/designs/${did}`, 'GET', null, other)).status, 404);
  assert.equal((await api(`/studio/designs/${did}`, 'PUT', { text: { headline: 'x' } }, other)).status, 404);
});

test('deleting a design removes its slide files and its background picture', async () => {
  const d = (await api('/studio/designs', 'POST', { brief: 'Diwali greeting from our store', group: 'post', template: 'festive-greeting', format: 'square', lang: 'en', bg: 'none' }, S)).data;
  const files = (d.slides || []).map((s) => s.url).filter(Boolean);
  assert.ok(files.length, JSON.stringify(d).slice(0, 300));
  assert.equal((await api(`/studio/assets/${d.id}`, 'DELETE', null, S)).status, 200);
  await new Promise((r) => setTimeout(r, 300));
  for (const u of files) assert.equal(fs.existsSync(path.join(srv.dataDir, 'uploads', ...u.split('/').slice(2))), false, `${u} removed`);
  assert.equal((await api(`/studio/designs/${d.id}`, 'GET', null, S)).status, 404);
});
