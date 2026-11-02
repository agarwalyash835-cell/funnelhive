// Studio voiceover: makeLine through a fake task runner (no real AI calls), the pronunciation list, and the listen-back
// check against a fake transcriber — a misread price, a missing word, swapped words, a brand name, a wrong language —
// plus the sound checks on ffmpeg-made audio (long pauses, silence, clipping).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { makeLine, checkLine, compareWords, applyPronunciations, cleanDictionary, tokens, wordTimings, sarvamTranscriber } from '../studio/voice.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-voice-'));
const ff = (...args) => { const r = spawnSync('ffmpeg', ['-hide_banner', '-y', ...args], { encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr); };
// "speech": a tone; pauses are real silence
const tone = path.join(dir, 'tone.wav'), gappy = path.join(dir, 'gappy.wav'), silent = path.join(dir, 'silent.wav'), clipped = path.join(dir, 'clipped.wav');
let fake, served;
before(async () => {
  ff('-f', 'lavfi', '-i', 'sine=f=300:d=3', '-af', 'volume=-12dB', tone);
  ff('-f', 'lavfi', '-i', 'sine=f=300:d=1', '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=mono:d=1.6', '-f', 'lavfi', '-i', 'sine=f=300:d=1', '-filter_complex', '[0:a]volume=-12dB[a];[2:a]volume=-12dB[c];[a][1:a][c]concat=n=3:v=0:a=1', gappy);
  ff('-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=mono', '-t', '2', silent);
  ff('-f', 'lavfi', '-i', 'sine=f=300:d=2', '-af', 'volume=20dB', '-c:a', 'pcm_s16le', clipped);
  served = fs.readFileSync(tone);
  fake = http.createServer((req, res) => { if (req.url === '/vo.wav') { res.setHeader('content-type', 'audio/wav'); return res.end(served); } if (req.url === '/page') return res.end('<html>nope</html>'); res.writeHead(404); res.end(); }).listen(0);
  await new Promise((r) => setTimeout(r, 30));
});
after(() => { fake?.close(); fs.rmSync(dir, { recursive: true, force: true }); });
const url = (p) => `http://127.0.0.1:${fake.address().port}${p}`;
// words spread evenly over [a, b]
const timed = (text, a = 0.1, b = 2.9) => { const ws = text.split(/\s+/); const d = (b - a) / ws.length; return ws.map((w, i) => ({ w, start: a + i * d, end: a + (i + 1) * d - 0.02 })); };
const heard = (text, extra = {}) => async () => ({ text, words: timed(text), ...extra });

test('makeLine: sends the model, voice and the seller’s pronunciations; downloads and keeps the audio', async () => {
  const calls = [], usage = [];
  const runTask = async (job) => { calls.push(job); return { urls: [url('/vo.wav')], raw: {} }; };
  const file = await makeLine({ text: 'Try  Mamaearth onion oil', lang: 'hi', voice: 'v-123', model: 'tts-model-x', dict: { Mamaearth: 'Mama-earth' }, settings: { speed: 1.1, before: 'Hair fall?' }, outDir: dir }, { runTask, onUsage: (u) => usage.push(u) });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].model, 'tts-model-x');
  assert.equal(calls[0].input.text, 'Try Mama-earth onion oil');
  assert.equal(calls[0].input.voice, 'v-123');
  assert.equal(calls[0].input.speed, 1.1);
  assert.equal(calls[0].input.previous_text, 'Hair fall?');
  assert.equal(calls[0].input.language_code, undefined, 'language is only sent on request — some models refuse it');
  assert.match(file, /\.wav$/);
  assert.deepEqual(fs.readFileSync(file), served);
  assert.deepEqual(usage, [{ kind: 'voice', model: 'tts-model-x', chars: 24 }]);
});

test('makeLine: plain-words errors, and no vendor names', async () => {
  await assert.rejects(makeLine({ text: 'Hi', model: 'm' }, {}), /switched on/);
  await assert.rejects(makeLine({ text: '  ', model: 'm' }, { runTask: async () => ({ urls: [] }) }), /Write the line/);
  await assert.rejects(makeLine({ text: 'x'.repeat(5001), model: 'm' }, { runTask: async () => ({ urls: [] }) }), /too long/);
  await assert.rejects(makeLine({ text: 'Hello', model: 'm', outDir: dir }, { runTask: async () => ({ urls: [] }) }), /came back empty/);
  const err = await makeLine({ text: 'Hello', model: 'm', outDir: dir }, { runTask: async () => ({ urls: [url('/page')] }) }).catch((e) => e);
  assert.match(err.message, /isn’t audio/);
  assert.doesNotMatch(err.message, /kie|eleven|sarvam/i);
});

test('pronunciations: whole words, any case, longest first, no double swaps; the saved list is bounded', () => {
  assert.equal(applyPronunciations('Mamaearth and MAMAEARTH, not Mamaearthy', { Mamaearth: 'Mama-earth' }), 'Mama-earth and Mama-earth, not Mamaearthy');
  assert.equal(applyPronunciations('Glowra Plus today', { Glowra: 'Glow-ra', 'Glowra Plus': 'Glow-ra Plus' }), 'Glow-ra Plus today');
  assert.equal(applyPronunciations('A to B', { A: 'B', B: 'C' }), 'B to C');
  const big = Object.fromEntries(Array.from({ length: 400 }, (_, i) => [`name${i}`, `say${i}`]));
  assert.equal(Object.keys(cleanDictionary(big)).length, 200);
  assert.deepEqual(cleanDictionary({ ' a\u0000b ': ' x ', same: 'same', '': 'y' }), { 'a b': 'x' });
});

test('tokens: prices, number words and phone numbers come out as values', () => {
  const t = tokens('Only Rs. 1,299 — call 98765 43210');
  assert.deepEqual(t.filter((x) => x.kind !== 'word').map((x) => [x.kind, x.v]), [['price', '1299'], ['phone', '9876543210']]);
  assert.deepEqual(tokens('one thousand two hundred and ninety nine rupees').map((x) => [x.kind, x.v]), [['price', '1299']]);
  const spelled = tokens('four nine nine rupees')[0];
  assert.equal(spelled.v, '499'); assert.equal(spelled.spelled, true);
  assert.equal(tokens('₹४९९')[0].v, '499', 'Devanagari digits');
});

test('compare: a price read digit by digit, a wrong price, a missing word, swapped words, an extra word', () => {
  let r = compareWords('Get it for just ₹499 today', 'get it for just four nine nine rupees today');
  assert.deepEqual(r.issues, [{ kind: 'price', detail: '₹499 was read as “four nine nine rupees”' }]);
  r = compareWords('Get it for just ₹499 today', 'get it for just ₹449 today');
  assert.deepEqual(r.issues, [{ kind: 'price', detail: '₹499 was read as “₹449”' }]);
  assert.deepEqual(compareWords('Just ₹499', 'just four hundred ninety nine rupees').issues, [], 'said properly is fine');
  r = compareWords('Free delivery on every order', 'delivery on every order');
  assert.deepEqual(r.issues, [{ kind: 'missing', detail: '“Free” was left out' }]);
  assert.equal(r.wer, 0.2);
  assert.deepEqual(compareWords('Fast and free shipping', 'free and fast shipping').issues, [{ kind: 'swapped', detail: '“Fast” and “free” were said the wrong way round' }]);
  assert.deepEqual(compareWords('Order now', 'order um now').issues, [{ kind: 'extra', detail: 'There’s a stray “um” in the voiceover' }]);
  assert.deepEqual(compareWords('Call 98765 43210', 'call nine eight seven six five four three two one zero').issues, [], 'phone numbers are read digit by digit');
  assert.equal(compareWords('Call 98765 43210', 'call nine eight seven six five four three two one one').issues[0].kind, 'phone');
});

test('compare: brand names must come through; the seller’s own pronunciation counts as right', () => {
  assert.deepEqual(compareWords('Try Glowra cream', 'try flower cream', { brands: ['Glowra'] }).issues, [{ kind: 'brand', detail: '“Glowra” sounded like “flower” — add it to your pronunciation list' }]);
  assert.deepEqual(compareWords('Try Mamaearth oil', 'try mama earth oil', { brands: ['Mamaearth'] }).issues, [], 'spacing differences are fine');
  assert.deepEqual(compareWords('Try Ghar Soaps', 'try gar soaps', { dict: { Ghar: 'gar' } }).issues, []);
});

test('Hindi: words keep their vowel signs, Hindi number words are numbers, a price said in Hindi is right', () => {
  const t = (s) => tokens(s).map((x) => (x.kind === 'word' ? x.t : `${x.kind}:${x.v}`));
  assert.deepEqual(t('केरल के इलायची केले, ₹60 प्रति दर्जन।'), ['केरल', 'के', 'इलायची', 'केले', 'price:60', 'प्रति', 'दर्जन'], 'मात्राएँ stay on the words');
  assert.deepEqual(t('साठ रुपये'), ['price:60']);
  assert.deepEqual(t('निन्यानवे रुपये'), ['price:99'], 'every number up to 99 is its own word');
  assert.deepEqual(t('डेढ़ सौ रुपये'), ['price:150']);
  assert.deepEqual(t('दो लाख पचास हज़ार'), ['number:250000']);
  assert.deepEqual(t('नौ आठ सात छह'), ['number:9876'], 'read digit by digit');
  // the line from the first real Hindi Reel: "₹60" spoken as "साठ रुपये" is exactly right
  assert.deepEqual(compareWords('केरल के इलायची केले, प्राकृतिक रूप से पके, ₹60 प्रति दर्जन।', 'केरल के इलायची केले प्राकृतिक रूप से पके साठ रुपये प्रति दर्जन').issues, []);
  // …and a wrong price is still caught
  assert.equal(compareWords('केरल के केले ₹60 प्रति दर्जन', 'केरल के केले सत्तर रुपये प्रति दर्जन').issues[0].kind, 'price');
});

test('checkLine: a clean line passes; a misread price and a missing word fail with plain words', async () => {
  const script = 'Our cotton kurta is now just ₹499 with free delivery';
  let r = await checkLine({ text: script, file: tone, lang: 'en' }, { transcribe: heard('our cotton kurta is now just ₹499 with free delivery') });
  assert.equal(r.ok, true, JSON.stringify(r.issues));
  assert.ok(r.score >= 90);
  r = await checkLine({ text: script, file: tone, lang: 'en' }, { transcribe: heard('our cotton kurta is now just four nine nine rupees with delivery') });
  assert.equal(r.ok, false);
  assert.ok(r.issues.some((i) => i.kind === 'price' && i.detail === '₹499 was read as “four nine nine rupees”'));
  assert.ok(r.issues.some((i) => i.kind === 'missing' && /free/.test(i.detail)));
  assert.ok(r.score < 80);
  // the transcriber gets the file and language
  let got;
  await checkLine({ text: 'hello there', file: tone, lang: 'hi-IN' }, { transcribe: async (f, l) => { got = [f, l]; return { text: 'hello there', words: [] }; } });
  assert.deepEqual(got, [tone, 'hi-IN']);
});

test('checkLine: wrong language', async () => {
  const r = await checkLine({ text: 'यह कुर्ता सिर्फ़ आज के लिए सस्ता है', file: tone, lang: 'hi' }, { transcribe: heard('this kurta is cheap only for today', { language: 'en-IN' }) });
  assert.equal(r.ok, false);
  assert.deepEqual(r.issues[0], { kind: 'language', detail: 'The voice spoke English, not Hindi' });
});

test('checkLine sound: a long pause, silence, clipping, and a rushed pace', async () => {
  let r = await checkLine({ text: 'Buy now pay later', file: gappy, lang: 'en' }, { transcribe: async () => ({ text: 'buy now pay later', words: [{ w: 'buy', start: 0.1, end: 0.5 }, { w: 'now', start: 0.5, end: 0.95 }, { w: 'pay', start: 2.65, end: 3.1 }, { w: 'later', start: 3.1, end: 3.5 }] }) });
  const pause = r.issues.find((i) => i.kind === 'pause');
  assert.ok(pause, JSON.stringify(r.issues));
  assert.match(pause.detail, /1\.\d-second pause after “now”/);
  r = await checkLine({ text: 'Hello', file: silent, lang: 'en' }, { transcribe: heard('hello') });
  assert.deepEqual(r.issues, [{ kind: 'silent', detail: 'No voice could be heard in this line' }]);
  assert.equal(r.ok, false);
  r = await checkLine({ text: 'Big sale', file: clipped, lang: 'en' }, { transcribe: heard('big sale') });
  assert.ok(r.issues.some((i) => i.kind === 'clipping'), JSON.stringify(r.issues));
  const many = 'one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen'.replace(/\w+/g, (w) => `word${w}`);
  r = await checkLine({ text: many, file: tone, lang: 'en' }, { transcribe: heard(many) });
  assert.ok(r.issues.some((i) => i.kind === 'pace' && /rushed/.test(i.detail)), JSON.stringify(r.issues));
});

test('the real transcriber: sends the file with timestamps on, maps chunk timings to words (fake server)', async () => {
  let seen;
  const srv = http.createServer((req, res) => {
    let b = Buffer.alloc(0);
    req.on('data', (c) => { b = Buffer.concat([b, c]); });
    req.on('end', () => {
      seen = { url: req.url, key: req.headers['api-subscription-key'], body: b.toString('latin1') };
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ transcript: 'just ₹499 today', language_code: 'en-IN', timestamps: { words: ['just ₹499', 'today'], start_time_seconds: [0.2, 1.0], end_time_seconds: [0.9, 1.4] } }));
    });
  }).listen(0);
  await new Promise((r) => setTimeout(r, 30));
  const transcribe = sarvamTranscriber({ key: 'k-test', base: `http://127.0.0.1:${srv.address().port}`, model: 'stt-x' });
  const out = await transcribe(tone, 'hi');
  srv.close();
  assert.equal(seen.url, '/speech-to-text');
  assert.equal(seen.key, 'k-test');
  assert.match(seen.body, /name="with_timestamps"\r\n\r\ntrue/);
  assert.match(seen.body, /name="language_code"\r\n\r\nhi-IN/);
  assert.equal(out.text, 'just ₹499 today');
  assert.equal(out.words.length, 3);
  assert.equal(out.words[0].w, 'just'); assert.equal(out.words[0].start, 0.2);
  assert.equal(out.words[2].w, 'today'); assert.equal(out.words[2].end, 1.4);
  await assert.rejects(sarvamTranscriber({ key: '' })(tone, 'en'), /switched on/);
  assert.deepEqual(wordTimings(null), []);
});
