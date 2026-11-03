// Studio's memory of each seller (studio/memory.js): it learns from what they do — a script edit (shorter lines, a hype
// word taken out, another call to action), the choices they approve with, a redo note — and the next script is written
// with it, the next Reel starts with their usual choices, and their recurring character looks the same in every shot.
// The seller sees all of it, corrects it, and can wipe it. Lists are capped and never repeat an item.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { startServer, register, enable2fa } from './helpers.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mem-test-'));
const SCRIPT = { title: 'Ghee Reel', lines: ['The best desi ghee your family will ever taste, made slowly on our farm', 'Only ₹499 for a one litre jar, delivered to your door', 'Order today on WhatsApp now'], shots: [{ image: 'A jar of ghee on a kitchen counter', motion: 'Slow push-in', seconds: 4 }, { image: 'Ghee poured over hot rice', motion: 'Pour', seconds: 4 }], endCard: { headline: 'Shuddh Ghee Co', offer: '₹499 / litre', cta: 'Order now' } };
const PASS = { product_match: 9, text_ok: 9, anatomy_ok: 10, matches_brief: 9, consistency: 9, safe: true, issues: [], fix: '' };
const prompts = []; // what the script writer was asked
let next = SCRIPT, fake, srv, api, ADMIN, S, S2, sid;

before(async () => {
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=768x768', '-frames:v', '1', path.join(tmp, 'image.png')]);
  const created = [];
  fake = http.createServer((req, res) => {
    let b = '';
    req.on('data', (c) => { b += c; });
    req.on('end', () => {
      const url = new URL(req.url, 'http://x'), send = (o) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(o)); };
      if (url.pathname.startsWith('/files/')) return res.end(fs.readFileSync(path.join(tmp, url.pathname.slice(7))));
      if (url.pathname === '/openai/v1/responses') { prompts.push(JSON.stringify(JSON.parse(b))); return send({ output: [{ type: 'message', content: [{ text: JSON.stringify(next) }] }] }); }
      if (url.pathname === '/gemini-3-8-flash-openai/v1/chat/completions') return send({ choices: [{ message: { content: JSON.stringify(PASS) } }] });
      if (url.pathname === '/api/v1/jobs/createTask') { created.push(JSON.parse(b)); return send({ code: 200, data: { taskId: `t${created.length - 1}` } }); }
      if (url.pathname === '/api/v1/jobs/recordInfo') return send({ code: 200, data: { state: 'success', resultJson: JSON.stringify({ resultUrls: [`http://127.0.0.1:${fake.address().port}/files/image.png`] }) } });
      res.writeHead(404); res.end('{}');
    });
  }).listen(0);
  await new Promise((r) => setTimeout(r, 30));
  srv = await startServer({ KIE_API_KEY: 'kie-test', KIE_BASE_URL: `http://127.0.0.1:${fake.address().port}`, ADMIN_EMAILS: 'boss@mem.test', APP_URL: 'https://app.mem.test' });
  api = srv.api;
  ADMIN = (await register(api, 'boss@mem.test')).token;
  const link = srv.log().match(/To: boss@mem\.test[\s\S]*?\/verify\?token=([a-f0-9.]+)/);
  await api('/auth/verify', 'POST', { token: link[1] });
  ADMIN = (await enable2fa(api, ADMIN)).token;
  S = (await register(api, 'maker@mem.test')).token;
  S2 = (await register(api, 'other@mem.test')).token;
  sid = (await api('/me', 'GET', null, S)).data.id;
  await api('/settings', 'PUT', { businessName: 'Shuddh Ghee Co' }, S);
  await api(`/admin/studio/accounts/${sid}`, 'PUT', { on: true }, ADMIN);
});
after(async () => { await srv?.stop(); fake?.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

const memory = async (t = S) => (await api('/studio/memory', 'GET', null, t)).data;
const reel = (b) => api('/studio/reels', 'POST', { brief: 'Desi ghee from our farm, ₹499 a litre, for families in Pune', ...b }, S);

test('a new seller: nothing remembered, nothing added to the script prompt', async () => {
  const m = await memory();
  assert.deepEqual([m.likes, m.avoid, m.characters, m.wins, m.prefs], [[], [], [], [], {}]);
  const r = await reel({ lang: 'en', seconds: 15 });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.doesNotMatch(prompts.at(-1), /What Studio remembers/);
});

test('it learns from a script edit and from the choices approved with', async () => {
  const r = await reel({ lang: 'en', seconds: 15, tier: 'standard', captions: 'karaoke', sizes: ['16:9'], aspect: '16:9' });
  // shorter lines, "best" taken out, their own call to action
  const edited = { ...r.data.script, lines: ['Pure desi ghee from our farm', 'Only ₹499 a litre', 'Order on WhatsApp'], endCard: { ...r.data.script.endCard, cta: 'Message us on WhatsApp' } };
  assert.equal((await api(`/studio/reels/${r.data.id}/script`, 'PUT', { script: edited }, S)).status, 200);
  let m = await memory();
  assert.ok(m.likes.includes('Short, punchy lines'), JSON.stringify(m));
  assert.ok(m.likes.includes('Call to action like “Message us on WhatsApp”'));
  assert.ok(m.avoid.some((x) => /Hype words like “best”/.test(x)));
  // the go-ahead: its choices become the seller's usual; an edited script isn't a "win"
  assert.equal((await api(`/studio/reels/${r.data.id}/approve`, 'POST', { motion: 'photo' }, S)).status, 200);
  m = await memory();
  assert.deepEqual([m.prefs.tier, m.prefs.captions, m.prefs.aspect, m.prefs.seconds, m.prefs.motion, m.prefs.lang], ['standard', 'karaoke', '16:9', 15, 'photo', 'en']);
  assert.ok(m.prefs.voice);
  assert.deepEqual(m.wins, []);
});

test('the next Reel uses it: the seller’s usual choices, and their taste in the script prompt', async () => {
  next = { ...SCRIPT, title: 'Winter Ghee' };
  const r = await reel({});
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.deepEqual([r.data.aspect, r.data.captions.style, r.data.seconds, r.data.tier], ['16:9', 'karaoke', 15, 'standard']);
  const p = prompts.at(-1);
  assert.match(p, /What Studio remembers about this seller/);
  assert.match(p, /What this seller likes: [^\\]*Short, punchy lines/);
  assert.match(p, /Avoid[^\\]*Hype words/);
  assert.match(p, /landscape 16:9/, 'the remembered frame');
  // what the seller chooses still wins over what's remembered
  assert.equal((await reel({ captions: 'pop', aspect: '9:16', sizes: ['9:16'] })).data.captions.style, 'pop');
  // approved exactly as written: remembered as a win, and shown to the next script
  assert.equal((await api(`/studio/reels/${r.data.id}/approve`, 'POST', {}, S)).status, 200);
  assert.deepEqual((await memory()).wins[0], { title: 'Winter Ghee', hook: SCRIPT.lines[0] });
  await reel({});
  assert.match(prompts.at(-1), /approved as written[^\\]*Winter Ghee/);
});

test('a recurring character is described the same way in every shot that names them', async () => {
  const look = 'a 32-year-old Indian woman, shoulder-length wavy hair, mustard cotton kurta, small gold earrings';
  const m = (await api('/studio/memory', 'PUT', { characters: [{ name: 'Asha', look }] }, S)).data;
  assert.deepEqual(m.characters, [{ name: 'Asha', look }]);
  next = { ...SCRIPT, title: 'Asha’s kitchen', shots: [{ image: 'Asha opens a jar of ghee in her kitchen', motion: 'Push-in', seconds: 4 }, { image: 'Ghee poured over hot rice', motion: 'Pour', seconds: 4 }] };
  const r = await reel({});
  assert.match(prompts.at(-1), /Their characters[^\\]*Asha — a 32-year-old/);
  const a = (await api(`/studio/reels/${r.data.id}/approve`, 'POST', {}, S)).data;
  assert.equal(a.shots[0].image.prompt, `Asha opens a jar of ghee in her kitchen\nAsha: ${look}`);
  assert.equal(a.shots[1].image.prompt, 'Ghee poured over hot rice', 'a shot without her is left alone');
});

test('a redo note is remembered as something to avoid', async () => {
  const img = (await api('/studio/images', 'POST', { prompt: 'A jar of ghee on a wooden table', tier: 'quick' }, S)).data.assets[0];
  for (let i = 0; i < 20; i++) { await api('/__test/studio-tick', 'POST', { times: 1 }); if (['ready', 'needs_review', 'failed'].includes((await api(`/studio/assets/${img.id}`, 'GET', null, S)).data.status)) break; }
  assert.equal((await api(`/studio/assets/${img.id}/redo`, 'POST', { note: 'The label is upside down' }, S)).status, 200);
  assert.equal((await memory()).avoid[0], 'The label is upside down');
});

test('lists are capped, never repeat (any case), and the whole memory stays small', async () => {
  const many = Array.from({ length: 14 }, (_, i) => `Like number ${i} ${'x'.repeat(120)}`);
  let m = (await api('/studio/memory', 'POST', { likes: many, avoid: Array.from({ length: 20 }, (_, i) => `Avoid ${i} ${'y'.repeat(120)}`) }, S)).data;
  assert.equal(m.likes.length, 8);
  assert.ok(m.likes.every((x) => x.length <= 100));
  assert.ok(m.avoid.length <= 10);
  m = (await api('/studio/memory', 'POST', { likes: ['warm morning light'] }, S)).data;
  m = (await api('/studio/memory', 'POST', { likes: ['Warm MORNING light'] }, S)).data;
  assert.equal(m.likes.filter((x) => x.toLowerCase() === 'warm morning light').length, 1);
  assert.equal(m.likes[0], 'Warm MORNING light', 'moved to the front, not repeated');
  // free-text feedback is sorted: a "don't" is something to avoid
  m = (await api('/studio/memory', 'POST', { feedback: 'Don’t use loud music' }, S)).data;
  m = (await api('/studio/memory', 'POST', { feedback: 'don’t use LOUD music' }, S)).data;
  assert.equal(m.avoid[0], 'don’t use LOUD music');
  assert.equal(m.avoid.filter((x) => /loud music/i.test(x)).length, 1);
  m = (await api('/studio/memory', 'POST', { feedback: 'Love the slow close-ups' }, S)).data;
  assert.equal(m.likes[0], 'Love the slow close-ups');
  m = (await api('/studio/memory', 'POST', { characters: [1, 2, 3, 4].map((i) => ({ name: `Person ${i}`, look: 'z'.repeat(400) })) }, S)).data;
  assert.equal(m.characters.length, 3);
  assert.ok(JSON.stringify(m).length < 4300, `${JSON.stringify(m).length} bytes`);
});

test('the seller corrects it (checked), another seller never sees it, and forgetting wipes it', async () => {
  const m = (await api('/studio/memory', 'PUT', { likes: ['Bright colours'], avoid: [], brand: { name: 'Shuddh', colours: ['#FFAA00', 'red', '#123456'], logo: 'https://evil.example/logo.png' }, prefs: { tier: 'bogus', captions: 'pop', aspect: '7:3' } }, S)).data;
  assert.deepEqual(m.likes, ['Bright colours']);
  assert.deepEqual(m.avoid, []);
  assert.deepEqual(m.brand, { name: 'Shuddh', colours: ['#ffaa00', '#123456'], logo: '' });
  assert.deepEqual(m.prefs, { captions: 'pop' });
  assert.equal(m.characters.length, 3, 'fields not given are kept');
  assert.deepEqual((await memory(S2)).likes, []);
  assert.equal((await api('/studio/memory', 'DELETE', null, S)).status, 200);
  const g = await memory();
  assert.deepEqual([g.likes, g.characters, g.prefs], [[], [], {}]);
  await reel({});
  assert.doesNotMatch(prompts.at(-1), /What Studio remembers/);
});
