// Studio editor on ffmpeg-made media (testsrc / sine / anullsrc), at small frame sizes so it runs quickly: joining
// clips of different shapes, fitting to the voiceover, captions that really render, music ducked under the voice,
// loudness landing on -14 LUFS, and a full render to 9:16, 1:1 and 16:9 with logo and end card.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { probe, need, missingFilters, loudness } from '../studio/ff.js';
import { buildAss, writeAss, safeArea, phrases, assColour, PRESETS } from '../studio/captions.js';
import { dims, fitMode, joinClips, fitDuration, fitSize, burnCaptions, overlayLogo, appendEndCard, mixAudio, normaliseLoudness, render } from '../studio/assemble.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-asm-'));
const f = (n) => path.join(dir, n);
const ff = (...args) => { const r = spawnSync('ffmpeg', ['-hide_banner', '-y', ...args], { encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr); };
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);
// one frame as raw grey bytes
const frame = (file, t, w, h) => spawnSync('ffmpeg', ['-hide_banner', '-ss', String(t), '-i', file, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'gray', '-s', `${w}x${h}`, '-'], { maxBuffer: 1 << 26 }).stdout;
// RMS level (dB) of a stretch of a file's audio
const rms = (file, from, to, pre = '') => { const r = spawnSync('ffmpeg', ['-hide_banner', '-i', file, '-af', `${pre}atrim=${from}:${to},astats=measure_perchannel=none`, '-f', 'null', '-'], { encoding: 'utf8' }); return Number(/RMS level dB:\s*(-?[\d.]+)/.exec(r.stderr.slice(r.stderr.lastIndexOf('Overall')))[1]); };

const words = [{ w: 'Just', start: 0.1, end: 0.4 }, { w: '₹499', start: 0.45, end: 1.0 }, { w: 'today', start: 1.05, end: 1.5 }, { w: 'only.', start: 1.55, end: 1.9 }];
before(() => {
  ff('-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=30:d=2', f('wide.mp4'));
  ff('-f', 'lavfi', '-i', 'testsrc=size=240x426:rate=25:d=1.5', '-f', 'lavfi', '-i', 'sine=f=500:d=1.5', '-shortest', f('tall.mp4'));
  ff('-f', 'lavfi', '-i', 'color=c=0x2040a0:size=240x426:rate=30:d=2', f('plain.mp4'));
  // lavfi's sine is only 1/8 full scale; a real voiceover peaks near 0 dBFS
  ff('-f', 'lavfi', '-i', 'sine=f=220:d=2', '-af', 'volume=12dB', f('voice.wav'));
  ff('-f', 'lavfi', '-i', 'sine=f=880:d=1.3', '-af', 'volume=-6dB', f('music.wav'));
  ff('-f', 'lavfi', '-i', 'color=c=white:size=64x32', '-frames:v', '1', f('logo.png'));
  ff('-f', 'lavfi', '-i', 'color=c=yellow:size=300x300', '-frames:v', '1', f('card.png'));
});
after(() => fs.rmSync(dir, { recursive: true, force: true }));

test('this ffmpeg has every filter Studio needs; a missing one is a clear, plain error', () => {
  assert.deepEqual(missingFilters(), []);
  assert.throws(() => need('ass', 'no_such_filter'), (e) => /can’t do no_such_filter yet/.test(e.message) && e.missing[0] === 'no_such_filter');
});

test('sizes and fit: even pixel sizes; vertical → square crops, vertical → landscape pads', () => {
  assert.deepEqual(dims('9:16'), { width: 1080, height: 1920 });
  assert.deepEqual(dims('1:1', 240), { width: 240, height: 240 });
  assert.deepEqual(dims('16:9', 240), { width: 426, height: 240 });
  assert.equal(fitMode(1080, 1920, 1080, 1080), 'crop');
  assert.equal(fitMode(1080, 1920, 1920, 1080), 'pad');
  assert.equal(fitMode(1920, 1080, 1080, 1920, 'crop'), 'crop');
});

test('captions: built from word timings, inside the safe area, four looks', () => {
  assert.deepEqual(Object.keys(PRESETS), ['pop', 'lower', 'karaoke', 'minimal']);
  assert.equal(assColour('#ffd400'), '&H0000D4FF');
  const pop = buildAss(words, { style: 'pop' });
  const events = pop.split('\n').filter((l) => l.startsWith('Dialogue:'));
  // the Reels look: 2-3 words on screen, one event per word, the word being spoken in the highlight colour
  assert.equal(events.length, 4, 'one event per word');
  assert.match(events[0], /0:00:00\.10,0:00:00\.45/, 'a word holds until the next starts');
  assert.match(events[1], /\\c&H0000D4FF[^}]*\}₹499/, 'the spoken word (here the price) in the highlight colour');
  assert.match(events[2], /TODAY/);
  // the line's bottom sits above the Reels bottom strip and below the top bar
  const style = pop.split('\n').find((l) => l.startsWith('Style:')).split(',');
  const marginV = Number(style[21]), safe = safeArea(1080, 1920);
  assert.ok(marginV >= safe.bottom && marginV <= 1920 - safe.top, `marginV ${marginV}`);
  assert.ok(Number(style[19]) >= safe.left && Number(style[20]) >= safe.right);
  // phrase looks: grouped at punctuation / pauses; karaoke times each word; lower-third has a box (BorderStyle 3)
  assert.deepEqual(phrases(words, { maxWords: 3 }).map((g) => g.length), [3, 1]);
  const kar = buildAss(words, { style: 'karaoke' });
  assert.match(kar, /\{\\k\d+\}Just \{\\k\d+\}₹499/);
  assert.equal(buildAss(words, { style: 'lower' }).split('\n').find((l) => l.startsWith('Style:')).split(',')[15], '3');
  // braces and backslashes in what was heard can't inject ASS commands
  assert.doesNotMatch(buildAss([{ w: '{\\pos(0,0)}hi', start: 0, end: 1 }], { style: 'minimal' }), /\\pos/);
  // the offset moves every event (the voice starts a beat in)
  assert.match(buildAss(words, { style: 'pop', offset: 0.15 }), /Dialogue: 0,0:00:00\.25/);
});

test('join clips of different shapes and frame rates → one silent video of the right size and length', async () => {
  const out = await joinClips([f('wide.mp4'), f('tall.mp4')], f('joined.mp4'), { width: 240, height: 426, fps: 30 });
  const p = probe(out);
  assert.equal(p.width, 240); assert.equal(p.height, 426);
  // the shots dissolve into each other: shorter than laid end to end by the crossfade
  const { xfadeFor } = await import('../studio/assemble.js');
  near(p.duration, 3.5 - xfadeFor(probe(f('wide.mp4')).duration, probe(f('tall.mp4')).duration), 0.1, 'duration');
  near(p.fps, 30, 0.01, 'fps');
  assert.equal(p.hasAudio, false);
});

test('fit to the voiceover: longer pictures are cut, shorter ones hold the last frame', async () => {
  near(probe(await fitDuration(f('wide.mp4'), 1.2, f('cut.mp4'))).duration, 1.2, 0.07, 'cut');
  near(probe(await fitDuration(f('wide.mp4'), 3.4, f('held.mp4'))).duration, 3.4, 0.07, 'held');
  const sq = probe(await fitSize(f('tall.mp4'), f('sq.mp4'), { aspect: '1:1', short: 240 }));
  assert.deepEqual([sq.width, sq.height], [240, 240]);
  const land = probe(await fitSize(f('tall.mp4'), f('land.mp4'), { aspect: '16:9', short: 240 }));
  assert.deepEqual([land.width, land.height], [426, 240]);
});

test('captions really render onto the picture', async () => {
  const ass = writeAss(words, f('cap.ass'), { style: 'pop', width: 240, height: 426 });
  const out = await burnCaptions(f('plain.mp4'), ass, f('captioned.mp4'));
  const a = frame(f('plain.mp4'), 0.7, 240, 426), b = frame(out, 0.7, 240, 426);
  let changed = 0;
  for (let i = 0; i < a.length; i++) if (Math.abs(a[i] - b[i]) > 40) changed++;
  assert.ok(changed > 300, `caption pixels: ${changed}`);
  // and nothing before the first word
  const a0 = frame(f('plain.mp4'), 0.02, 240, 426), b0 = frame(out, 0.02, 240, 426);
  let early = 0;
  for (let i = 0; i < a0.length; i++) if (Math.abs(a0[i] - b0[i]) > 40) early++;
  assert.ok(early < 20, `before the first word: ${early}`);
});

test('logo and end card', async () => {
  const withLogo = await overlayLogo(f('plain.mp4'), f('logo.png'), f('logo.mp4'), { position: 'top-right', size: 0.25 });
  const a = frame(f('plain.mp4'), 1, 240, 426), b = frame(withLogo, 1, 240, 426);
  // the logo is in the top-right, below the top bar (safe area), not top-left
  const at = (buf, x, y) => buf[y * 240 + x];
  const safe = safeArea(240, 426);
  assert.ok(Math.abs(at(a, 240 - 12 - 20, safe.top + 6) - at(b, 240 - 12 - 20, safe.top + 6)) > 20, 'logo top-right');
  assert.ok(Math.abs(at(a, 20, safe.top + 6) - at(b, 20, safe.top + 6)) < 8, 'nothing top-left');
  const carded = await appendEndCard(withLogo, f('card.png'), f('carded.mp4'), { seconds: 1.5 });
  const p = probe(carded);
  near(p.duration, 3.5, 0.1, 'video + card');
  assert.deepEqual([p.width, p.height], [240, 426]);
});

test('music dips under the voice; loudness lands on -14 LUFS', async () => {
  const ducked = await mixAudio({ voice: f('voice.wav'), music: f('music.wav'), duration: 4, voiceDelay: 0.15, musicDb: -10 }, f('ducked.wav'));
  const flat = await mixAudio({ voice: f('voice.wav'), music: f('music.wav'), duration: 4, voiceDelay: 0.15, musicDb: -10, duck: false }, f('flat.wav'));
  near(probe(ducked).duration, 4, 0.05, 'mix length (music looped to fill it)');
  // the music alone (its 880 Hz tone; steep high-passes remove the 220 Hz voice): ~10 dB down while the voice speaks, back after
  const music = (file, a, b) => rms(file, a, b, 'highpass=f=600,'.repeat(4));
  const dip = music(flat, 0.6, 1.8) - music(ducked, 0.6, 1.8);
  assert.ok(dip > 6 && dip < 13, `dip ${dip} dB`);
  near(music(ducked, 3.0, 3.6), music(flat, 3.0, 3.6), 1.5, 'music level after the voice ends');
  const norm = await normaliseLoudness(ducked, f('norm.wav'));
  const l = await loudness(norm);
  near(l.lufs, -14, 1, 'integrated loudness');
  assert.ok(l.truePeak <= -0.5, `true peak ${l.truePeak}`);
  // voice only, music only
  near(probe(await mixAudio({ voice: f('voice.wav'), duration: 3 }, f('vo-only.wav'))).duration, 3, 0.05, 'voice only');
  near(probe(await mixAudio({ music: f('music.wav'), duration: 2 }, f('mu-only.wav'))).duration, 2, 0.05, 'music only');
  await assert.rejects(mixAudio({ duration: 2 }, f('none.wav')), /voiceover or music/);
});

test('full render: three sizes, trimmed to the voiceover plus the end card, captions, logo, -14 LUFS', async () => {
  const out = await render({
    clips: [f('wide.mp4'), f('tall.mp4')], voice: f('voice.wav'), music: f('music.wav'), words,
    captions: { style: 'karaoke' }, logo: { file: f('logo.png') }, endCard: { image: f('card.png'), seconds: 1 },
    sizes: ['9:16', '1:1', '16:9'], short: 240, outDir: dir, name: 'test',
  });
  // 0.15 s lead-in + 2 s voice + 0.5 s tail + 1 s card
  near(out.duration, 3.65, 0.01, 'planned length');
  const want = { '9:16': [240, 426], '1:1': [240, 240], '16:9': [426, 240] };
  for (const [aspect, [w, h]] of Object.entries(want)) {
    const p = probe(out.files[aspect]);
    assert.deepEqual([p.width, p.height], [w, h], aspect);
    near(p.duration, 3.65, 0.12, `${aspect} length`);
    assert.equal(p.hasAudio, true);
    assert.match(out.files[aspect], /\.mp4$/);
  }
  near(out.lufs, -14, 1.2, 'final loudness');
  // temp files are cleaned up: only the three finals carry the name
  assert.equal(fs.readdirSync(dir).filter((n) => /^test-/.test(n)).length, 3);
});
