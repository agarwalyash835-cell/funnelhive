// Reel effects on tiny ffmpeg-made media (320x180, a few seconds) so it runs quickly: jump cuts, punch-ins, made-from-
// scratch sound effects, beat finding, speed ramps, b-roll, split screens and auto-reframe following a subject.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { probe } from '../studio/ff.js';
import {
  jumpCutPlan, remapWords, cutTalkingHead, emphasisTimes, punchOnEmphasis, SFX_KINDS, sfxFilter, addSfx, beatsFromSamples, beatTimes,
  snapToBeats, rampExtra, speedRamp, TRANSITIONS, xfadeName, brollOver, splitScreen, wipeReveal, trackCentres, reframeTrack,
} from '../studio/reelfx.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-reelfx-'));
const f = (n) => path.join(dir, n);
const ff = (...args) => { const r = spawnSync('ffmpeg', ['-hide_banner', '-y', ...args], { encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr); };
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);
const frame = (file, t, w, h) => spawnSync('ffmpeg', ['-hide_banner', '-ss', String(t), '-i', file, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'gray', '-s', `${w}x${h}`, '-'], { maxBuffer: 1 << 26 }).stdout;
const diff = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]); return s / a.length; };
const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
const rms = (file, from, to) => { const r = spawnSync('ffmpeg', ['-hide_banner', '-i', file, '-af', `atrim=${from}:${to},astats=measure_perchannel=none`, '-f', 'null', '-'], { encoding: 'utf8' }); const m = /RMS level dB:\s*(-?[\d.]+|-inf)/.exec(r.stderr.slice(r.stderr.lastIndexOf('Overall'))); return m[1] === '-inf' ? -200 : Number(m[1]); };

// hello world · 1 s pause · um · again
const words = [{ w: 'Hello', start: 0, end: 0.5 }, { w: 'world', start: 0.6, end: 1.0 }, { w: 'um', start: 2.0, end: 2.3 }, { w: 'again', start: 2.4, end: 2.8 }];

before(() => {
  ff('-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=30:d=3', '-f', 'lavfi', '-i', 'sine=f=300:d=3', '-shortest', '-pix_fmt', 'yuv420p', f('head.mp4'));
  ff('-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=30:d=3', '-pix_fmt', 'yuv420p', f('main.mp4'));
  ff('-f', 'lavfi', '-i', 'color=c=red:size=200x200:rate=30:d=1', '-pix_fmt', 'yuv420p', f('red.mp4'));
  ff('-f', 'lavfi', '-i', 'color=c=blue:size=320x180:rate=30:d=2', '-pix_fmt', 'yuv420p', f('blue.mp4'));
  ff('-f', 'lavfi', '-i', 'sine=f=200:d=3', '-af', 'volume=-24dB', f('quiet.wav'));
  // a click every 0.5 s (120 BPM)
  ff('-f', 'lavfi', '-i', "aevalsrc=exprs='if(lt(mod(t,0.5),0.01),0.9*sin(2*PI*1000*t),0)':d=6:s=22050", f('clicks.wav'));
  // a bright box on the right of a dark frame, drifting slightly
  ff('-f', 'lavfi', '-i', 'color=c=black:size=320x180:rate=30:d=2', '-f', 'lavfi', '-i', 'color=c=white:size=40x40:rate=30:d=2',
    '-filter_complex', "[0:v][1:v]overlay=x='240+10*t':y=70,format=yuv420p[v]", '-map', '[v]', f('boxright.mp4'));
});
after(() => fs.rmSync(dir, { recursive: true, force: true }));

test('jump cut plan: a 1 s pause and an "um" are cut, speech is kept with a little padding', () => {
  const { keep, removed } = jumpCutPlan(words, { duration: 3 });
  assert.equal(keep.length, 2);
  near(keep[0].start, 0, 0.001, 'starts at 0');
  near(keep[0].end, 1.08, 0.001, 'hello world + pad');
  // the second piece starts after the um (pad never reaches into it)
  assert.ok(keep[1].start >= 2.3 && keep[1].start <= 2.4, `after um: ${keep[1].start}`);
  near(keep[1].end, 2.88, 0.001, 'again + pad');
  near(removed, 3 - (1.08 + (2.88 - keep[1].start)), 0.002, 'removed');
  assert.ok(removed > 1.3, 'the pause and the um');
  // Hindi hesitation counts as a filler; with fillers off it stays
  const hi = [{ w: 'नमस्ते', start: 0, end: 0.5 }, { w: 'उम्म', start: 0.55, end: 0.8 }, { w: 'दोस्तों', start: 0.85, end: 1.3 }];
  assert.equal(jumpCutPlan(hi).keep.length, 2);
  assert.equal(jumpCutPlan(hi, { fillers: false }).keep.length, 1);
});

test('remapped words move earlier by the cut time; the filler is gone', () => {
  const { keep } = jumpCutPlan(words, { duration: 3 });
  const r = remapWords(words, keep);
  assert.deepEqual(r.map((w) => w.w), ['Hello', 'world', 'again']);
  assert.equal(r[0].start, 0);
  const shift = keep[1].start - keep[0].end;
  near(r[2].start, 2.4 - shift, 0.002, 'again shifted');
});

test('cut talking head: picture and sound trimmed to the keep pieces', async () => {
  const keep = [{ start: 0, end: 1 }, { start: 1.5, end: 2.5 }];
  const out = await cutTalkingHead(f('head.mp4'), keep, f('cut.mp4'), { fps: 30 });
  const p = probe(out);
  near(p.duration, 2, 0.12, 'duration ≈ sum of keep');
  assert.ok(p.hasAudio);
  assert.equal(p.width, 320);
  // the second piece is punched in: its frame differs from the source frame at the same moment
  assert.ok(diff(frame(out, 1.3, 320, 180), frame(f('head.mp4'), 1.8, 320, 180)) > 3, 'punched framing');
  // fitted to a vertical frame
  const v = probe(await cutTalkingHead(f('head.mp4'), keep, f('cutv.mp4'), { width: 180, height: 320 }));
  assert.deepEqual([v.width, v.height], [180, 320]);
});

test('emphasis: prices, numbers, keywords and shouts, at least 1.2 s apart; punch-ins keep the length', async () => {
  const ws = [{ w: 'only', start: 0, end: 0.3 }, { w: '₹499', start: 0.4, end: 0.8 }, { w: '50%', start: 1.0, end: 1.3 }, { w: 'free', start: 2.0, end: 2.3 }, { w: 'now!', start: 3.5, end: 3.8 }];
  assert.deepEqual(emphasisTimes(ws, ['FREE']), [0.4, 2, 3.5]);
  const out = await punchOnEmphasis(f('main.mp4'), [1], f('punch.mp4'), { fps: 30 });
  near(probe(out).duration, 3, 0.1, 'same length');
  assert.ok(diff(frame(out, 1.3, 320, 180), frame(f('main.mp4'), 1.3, 320, 180)) > 3, 'zoomed during the punch');
  assert.ok(diff(frame(out, 2.5, 320, 180), frame(f('main.mp4'), 2.5, 320, 180)) < 6, 'back to normal after');
});

test('sound effects: each kind renders; mixed in, the track is louder at the event', async () => {
  assert.deepEqual(SFX_KINDS, ['whoosh', 'riser', 'pop', 'impact']);
  for (const k of SFX_KINDS) ff('-f', 'lavfi', '-i', sfxFilter(k), f(`sfx-${k}.wav`));
  near(probe(f('sfx-riser.wav')).duration, 1.2, 0.05, 'riser length');
  assert.throws(() => sfxFilter('boing'), /no “boing”/);
  const out = await addSfx(f('quiet.wav'), [{ kind: 'impact', at: 1.5 }, { kind: 'riser', at: 1.5 }], f('withsfx.wav'));
  const p = probe(out);
  near(p.duration, 3, 0.05, 'same length');
  assert.ok(rms(out, 1.5, 1.8) > rms(out, 0.1, 0.25) + 6, `louder at the event: ${rms(out, 1.5, 1.8)} vs ${rms(out, 0.1, 0.25)}`);
  // riser builds before the event
  assert.ok(rms(out, 1.1, 1.45) > rms(out, 0.1, 0.25) + 3, 'riser rising into it');
  // no voice: an sfx-only track
  const only = await addSfx(null, [{ kind: 'pop', at: 0.5 }, { kind: 'whoosh', at: 1 }], f('only.wav'), { duration: 2 });
  near(probe(only).duration, 2, 0.05, 'sfx-only length');
  assert.ok(rms(only, 0.75, 1.25) > rms(only, 1.6, 2) + 20, 'whoosh audible, silence after');
});

test('beats: ~120 BPM from a synthetic click track and from an ffmpeg-made one; snapping to the grid', async () => {
  const rate = 8000, s = new Float32Array(rate * 5);
  for (let b = 0.25; b < 5; b += 0.5) for (let i = 0; i < 80; i++) s[Math.round(b * rate) + i] = 0.9 * Math.sin(i);
  const r = beatsFromSamples(s, rate);
  near(r.bpm, 120, 2, 'bpm');
  near(r.beats[0] % 0.5, 0.25, 0.03, 'phase on the clicks');
  assert.deepEqual(beatsFromSamples(new Float32Array(rate * 2), rate), { bpm: 0, beats: [] });
  const t = await beatTimes(f('clicks.wav'));
  near(t.bpm, 120, 2, 'ffmpeg click bpm');
  assert.ok(t.beats.every((b) => Math.min(b % 0.5, 0.5 - (b % 0.5)) < 0.03), `beats on the clicks: ${t.beats.slice(0, 4)}`);
  assert.deepEqual(snapToBeats([0.1, 0.9, 1.6, 1.62], [0, 0.5, 1, 1.5, 2], 0.2), [0, 1, 1.5, 1.62]);
  assert.deepEqual(snapToBeats([0.26], [0, 0.5], 0.2), [0.26], 'too far: left alone');
});

test('speed ramp: longer by the slow-down; transitions map to xfade names', async () => {
  const out = await speedRamp(f('main.mp4'), f('ramp.mp4'), { at: 1, len: 1.2, speed: 0.5, steps: 3 });
  const extra = rampExtra(1.2, 0.5, 3);
  near(extra, 0.8, 0.001, 'planned extra');
  near(probe(out).duration, 3 + extra, 0.12, 'ramped length');
  assert.equal(TRANSITIONS.whip, 'hblur'); assert.equal(TRANSITIONS.zoom, 'zoomin'); assert.equal(TRANSITIONS.cut, null);
  assert.deepEqual([0, 1, 2, 3].map((i) => xfadeName('mixed', i)), ['hblur', 'zoomin', null, 'hblur']);
  assert.equal(xfadeName('dissolve'), 'fade');
});

test('b-roll covers the main picture only during its slot, and keeps the sound', async () => {
  const out = await brollOver(f('head.mp4'), [{ file: f('red.mp4'), at: 1, len: 1 }], f('broll.mp4'));
  const p = probe(out);
  near(p.duration, 3, 0.1, 'main length');
  assert.ok(p.hasAudio);
  assert.ok(diff(frame(out, 1.5, 320, 180), frame(f('head.mp4'), 1.5, 320, 180)) > 20, 'insert shows');
  assert.ok(diff(frame(out, 0.5, 320, 180), frame(f('head.mp4'), 0.5, 320, 180)) < 6, 'main before');
  assert.ok(diff(frame(out, 2.5, 320, 180), frame(f('head.mp4'), 2.5, 320, 180)) < 6, 'main after');
});

test('split screen and wipe reveal: right sizes', async () => {
  const v = probe(await splitScreen(f('main.mp4'), f('blue.mp4'), f('split.mp4'), { width: 180, height: 320, gap: 8 }));
  assert.deepEqual([v.width, v.height], [180, 320]);
  near(v.duration, 2, 0.1, 'shorter clip');
  const h = probe(await splitScreen(f('main.mp4'), f('blue.mp4'), f('splith.mp4'), { layout: 'horizontal', width: 320, height: 180, seconds: 1 }));
  assert.deepEqual([h.width, h.height], [320, 180]);
  const w = await wipeReveal(f('main.mp4'), f('blue.mp4'), f('wipe.mp4'), { at: 1, dur: 0.5 });
  const pw = probe(w);
  assert.deepEqual([pw.width, pw.height], [320, 180]);
  near(pw.duration, 3, 0.1, 'before up to the wipe, then all of after');
  assert.ok(diff(frame(w, 2.2, 320, 180), frame(f('blue.mp4'), 1, 320, 180)) < 6, 'after shown at the end');
});

test('reframe follows a subject on the right side', async () => {
  // pure: a bright block at x 120..140 of a 160-wide frame
  const w = 160, h = 90, fr = new Uint8Array(w * h);
  for (let y = 35; y < 55; y++) for (let x = 120; x < 140; x++) fr[y * w + x] = 255;
  const c = trackCentres([fr, fr], w, h, 50);
  assert.ok(c.every((x) => x > 110), `centres ${c}`);
  assert.deepEqual(trackCentres([new Uint8Array(w * h)], w, h, 50), [80], 'empty frame: the middle');
  const out = await reframeTrack(f('boxright.mp4'), f('reframed.mp4'), { aspect: '9:16', short: 180 });
  const p = probe(out);
  assert.deepEqual([p.width, p.height], [180, 320]);
  // a centre crop would miss the box entirely; the tracked crop has it in frame
  assert.ok(mean(frame(out, 1, 180, 320)) > 10, 'box in the vertical frame');
});
