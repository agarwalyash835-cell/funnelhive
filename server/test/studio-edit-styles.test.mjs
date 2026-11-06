// Studio edit styles end to end: keyword captions (and Indian scripts in their own face), the new grades and transitions,
// and a full render with a recipe's options (whip cuts, beat-synced cuts, a speed ramp, punch-ins on emphasis, overlays,
// pops / riser / impact) — on tiny ffmpeg-made media so it runs quickly.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { probe } from '../studio/ff.js';
import { buildAss, autoKeywords, PRESETS } from '../studio/captions.js';
import { LOOKS, LOOK_IDS, gradeFilter, transitionFor, TRANSITION_STYLES, fadeOf, hardCut, render } from '../studio/assemble.js';
import { RECIPES, renderOptions, GRADES, TRANSITIONS } from '../studio/recipes.js';
import { overlaysFrom } from '../studio/motion.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-styles-'));
const f = (n) => path.join(dir, n);
const ff = (...args) => { const r = spawnSync('ffmpeg', ['-hide_banner', '-y', ...args], { encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr); };
const words = [{ w: 'Sirf', start: 0.1, end: 0.4 }, { w: '₹4,999', start: 0.45, end: 1.0 }, { w: 'mein', start: 1.05, end: 1.3 }, { w: 'free', start: 1.35, end: 1.7 }, { w: 'delivery!', start: 1.75, end: 2.3 }, { w: 'आज', start: 2.5, end: 2.8 }, { w: 'hi.', start: 2.85, end: 3.1 }];

before(() => {
  ff('-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=30:d=2', f('a.mp4'));
  ff('-f', 'lavfi', '-i', 'testsrc2=size=240x426:rate=30:d=2', f('b.mp4'));
  ff('-f', 'lavfi', '-i', 'color=c=0x2040a0:size=240x426:rate=30:d=2', f('c.mp4'));
  ff('-f', 'lavfi', '-i', 'sine=f=220:d=3.2', '-af', 'volume=12dB', f('voice.wav'));
  // a 120 BPM click track as the music bed
  ff('-f', 'lavfi', '-i', "aevalsrc='0.8*sin(2*PI*900*t)*exp(-60*mod(t,0.5))':s=22050:d=4", f('music.wav'));
  ff('-f', 'lavfi', '-i', 'color=c=yellow:size=300x300', '-frames:v', '1', f('card.png'));
});
after(() => fs.rmSync(dir, { recursive: true, force: true }));

test('captions pop the keywords: numbers, offers and exclamations; the seller’s own list; Devanagari in its own face', () => {
  assert.deepEqual(autoKeywords(words), ['sirf', '₹4999', 'free', 'delivery', 'आज']); // sirf: only
  assert.ok(PRESETS.punch && PRESETS.strip);
  const word = buildAss(words, { style: 'punch', keywords: 'auto' });
  const line = (w) => word.split('\n').find((l) => l.startsWith('Dialogue') && l.includes(w));
  assert.match(line('FREE'), /\\fscx124/); // a keyword lands bigger
  assert.doesNotMatch(line('MEIN'), /\\fscx124/);
  assert.match(line('आज'), /\\fnNoto Sans Devanagari\}आज\{\\fnNoto Sans\}/);
  // a phrase look keeps an unspoken keyword in the highlight colour
  const pop = buildAss(words, { style: 'pop', keywords: ['mein'] });
  assert.ok(pop.split('\n').some((l) => /\{\\c&H0000D4FF\}MEIN/.test(l)), 'mein stays highlighted');
});

test('the industry grades and transitions are real ffmpeg chains', () => {
  for (const g of GRADES) assert.ok(LOOK_IDS.includes(g), `grade ${g}`);
  for (const t of TRANSITIONS) assert.ok(TRANSITION_STYLES.includes(t), `transition ${t}`);
  assert.match(gradeFilter({ base: 'food_pop', warmth: 1 }), /saturation=1\.3.*colorbalance=rm=0\.04/);
  assert.equal(transitionFor(1, 3, 'whip'), 'hblur');
  assert.equal(transitionFor(1, 3, 'zoom'), 'zoomin');
  assert.deepEqual([1, 2, 3].map((i) => transitionFor(i, 4, 'mixed')), ['hblur', 'zoomin', 'fade']);
  assert.ok(hardCut('match') && hardCut('cut') && !hardCut('whip'));
  assert.ok(fadeOf('whip') < fadeOf('dissolve'));
  // every grade renders on a frame
  for (const k of Object.keys(LOOKS).filter((k) => LOOKS[k])) ff('-f', 'lavfi', '-i', 'testsrc=size=64x64:d=0.1', '-vf', LOOKS[k], '-frames:v', '1', f(`g-${k}.png`));
});

test('every recipe’s options are ones the editor takes', () => {
  for (const r of RECIPES) {
    const o = renderOptions(r);
    assert.ok(PRESETS[o.captions.style], `${r.id} captions`);
    assert.ok(LOOKS[o.look.base] !== undefined, `${r.id} grade`);
    assert.ok(TRANSITION_STYLES.includes(o.transitions), `${r.id} transitions`);
  }
});

test('a full render in a recipe’s style: whip cuts on the beat, a speed ramp, punch-ins, overlays and sound design', async () => {
  const ro = renderOptions(RECIPES.find((r) => r.id === 'realestate-walkthrough'));
  const items = (seconds) => overlaysFrom({ price: '₹85 lakh', location: 'Whitefield, Bengaluru', whatsapp: '9800000010', duration: seconds, wants: [{ type: 'price', at: 'hook' }, { type: 'pin', at: 'middle' }, { type: 'cta', at: 'end' }] });
  assert.ok(items(4).length >= 2);
  const out = await render({
    clips: [f('a.mp4'), f('b.mp4'), f('c.mp4')], voice: f('voice.wav'), music: f('music.wav'), words,
    captions: { style: ro.captions.style, keywords: 'auto' }, endCard: { image: f('card.png'), seconds: 1 },
    sizes: ['9:16'], short: 180, outDir: dir, name: 't', look: { base: 'warm_luxe' }, transitions: 'whip',
    sfx: ['whoosh', 'pop', 'riser', 'impact'], emphasis: true, beatSync: true, ramp: 0, overlays: items,
  });
  const p = probe(out.files['9:16']);
  assert.ok(p.hasVideo && p.hasAudio);
  assert.equal(p.width, 180);
  // voice delay + voice + tail + card
  assert.ok(Math.abs(out.duration - (0.15 + 3.2 + 0.5 + 1)) < 0.05, `duration ${out.duration}`);
  assert.ok(Math.abs(p.duration - out.duration) < 0.25, `file ${p.duration}`);
  assert.ok(Number.isFinite(out.lufs) && Math.abs(out.lufs + 14) < 2.5, `lufs ${out.lufs}`);
});
