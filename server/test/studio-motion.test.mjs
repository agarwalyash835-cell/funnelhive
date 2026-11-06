// Studio motion graphics: Indian number formatting, the overlay .ass file (valid, in time order, inside the video's
// length, the counter landing on its real figure, Indian scripts in their Noto face), recipe wishes → timed items, and
// an overlay really burnt onto a small lavfi clip by ffmpeg's ass filter.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { formatINR, formatNumber, overlayAss, writeOverlays, overlaysFrom, OVERLAY_TYPES } from '../studio/motion.js';
import { safeArea } from '../studio/captions.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-motion-'));
const f = (n) => path.join(dir, n);
const ff = (args, opts = {}) => { const r = spawnSync('ffmpeg', ['-hide_banner', '-y', ...args], { encoding: 'utf8', ...opts }); assert.equal(r.status, 0, r.stderr); };
// one frame as raw grey bytes
const frame = (file, t, w, h) => spawnSync('ffmpeg', ['-hide_banner', '-ss', String(t), '-i', file, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'gray', '-s', `${w}x${h}`, '-'], { maxBuffer: 1 << 26 }).stdout;
const secs = (t) => { const [h, m, s] = t.split(':'); return Number(h) * 3600 + Number(m) * 60 + Number(s); };
const dialogues = (ass) => ass.split('\n').filter((l) => l.startsWith('Dialogue:')).map((l) => {
  const p = l.slice(10).split(',');
  return { layer: Number(p[0]), start: secs(p[1]), end: secs(p[2]), style: p[3], text: p.slice(9).join(',') };
});
const all = [
  { type: 'progress', dur: 12 },
  { type: 'pin', text: 'Whitefield, Bengaluru', at: 0.4, dur: 2.4 },
  { type: 'badge', text: '50% OFF', at: 0.6, dur: 2 },
  { type: 'price', text: '₹4,999', sub: 'Only today', at: 3, dur: 2.5 },
  { type: 'counter', from: 0, to: 1250000, money: true, label: 'saved by our customers', at: 5.5, dur: 3 },
  { type: 'lowerThird', title: 'Sharma Sweets', sub: 'Since 1985', at: 1, dur: 3 },
  { type: 'label', text: 'BEFORE', x: 0.25, y: 0.3, at: 2, dur: 2 },
  { type: 'cta', headline: 'Order on WhatsApp', offer: 'Free delivery today', phone: '98765 43210', whatsapp: '98765 43210', at: 9.5, dur: 4 },
  { type: 'fireworks', at: 1, dur: 1 },
];

before(() => { ff(['-f', 'lavfi', '-i', 'color=c=0x2040a0:size=270x480:rate=30:d=3', '-pix_fmt', 'yuv420p', f('plain.mp4')]); });
after(() => fs.rmSync(dir, { recursive: true, force: true }));

test('Indian number formatting', () => {
  assert.equal(formatINR(1250000), '₹12,50,000');
  assert.equal(formatINR(999), '₹999');
  assert.equal(formatINR(4999), '₹4,999');
  assert.equal(formatINR(100000), '₹1,00,000');
  assert.equal(formatINR(123456789), '₹12,34,56,789');
  assert.equal(formatNumber(1200, { suffix: '+' }), '1,200+');
  assert.equal(formatNumber(4.567, { decimals: 1, suffix: '★' }), '4.6★');
  assert.equal(formatNumber(-1500, { prefix: '₹' }), '-₹1,500');
  assert.equal(OVERLAY_TYPES.length, 8);
});

test('overlayAss: a valid file, events in time order and inside the video, unknown types skipped', () => {
  const ass = overlayAss({ width: 1080, height: 1920, items: all, duration: 12 });
  assert.match(ass, /^\[Script Info\]/);
  assert.match(ass, /PlayResX: 1080\nPlayResY: 1920/);
  assert.match(ass, /\[V4\+ Styles\][\s\S]*Style: M,[\s\S]*\[Events\]\nFormat: Layer, Start, End/);
  const ev = dialogues(ass);
  assert.ok(ev.length > 20, `${ev.length} events`);
  for (let i = 1; i < ev.length; i++) assert.ok(ev[i].start >= ev[i - 1].start, 'sorted by start');
  for (const e of ev) { assert.ok(e.start >= 0 && e.end <= 12 && e.end > e.start, `${e.start}-${e.end} inside 0-12 s`); assert.ok(!/fireworks/i.test(e.text)); }
  // the cta asked for 9.5 + 4 s; it stops at the video's end
  assert.ok(ev.some((e) => /WhatsApp 98765 43210/.test(e.text) && e.end === 12));
  // animation really used: pop-in overshoot, animated clip wipes, a moving pin, a spinning badge
  assert.ok(ev.some((e) => /\\t\(0,200,\\fscx118/.test(e.text)), 'price pops');
  assert.ok(ev.some((e) => /\\t\(0,\d+,\\clip\(/.test(e.text)), 'progress grows with an animated clip');
  assert.ok(ev.some((e) => /\\move\(/.test(e.text) && /\\p1/.test(e.text)), 'pin drops');
  assert.ok(ev.some((e) => /\\frz-200/.test(e.text)), 'badge spins');
  assert.ok(ev.some((e) => e.style === 'B' && /BEFORE/.test(e.text)), 'label on its box style');
  // every \pos is inside the safe area
  const s = safeArea(1080, 1920);
  for (const e of ev) for (const m of e.text.matchAll(/\\pos\(([\d.]+),([\d.]+)\)/g)) {
    const [x, y] = [Number(m[1]), Number(m[2])];
    assert.ok(x >= s.left - 1 && x <= 1080 - s.right + 1 && y >= s.top - 1 && y <= 1920 - s.bottom + 1, `pos ${x},${y} inside the safe area: ${e.text.slice(0, 60)}`);
  }
  // text can't break out of its event
  const evil = dialogues(overlayAss({ items: [{ type: 'label', text: 'A{\\fs300}B\\N', at: 0, dur: 1 }] }));
  assert.equal(evil.length, 1);
  assert.match(evil[0].text, /\}Afs300BN$/);
});

test('counter rolls up and lands exactly on its figure; event count capped', () => {
  const ev = dialogues(overlayAss({ items: [{ type: 'counter', from: 0, to: 1250000, money: true, at: 1, dur: 3 }] }));
  const nums = ev.map((e) => e.text.replace(/\{[^}]*\}/g, ''));
  assert.equal(nums.at(-1), '₹12,50,000');
  assert.equal(nums[0], '₹0');
  const vals = nums.map((n) => Number(n.replace(/[₹,]/g, '')));
  for (let i = 1; i < vals.length; i++) assert.ok(vals[i] >= vals[i - 1], 'never counts backwards');
  // ease-out: the figure is reached at ~70% of the time and then held
  near(ev.at(-1).start, 1 + 3 * 0.7, 0.02, 'held from 70%');
  assert.equal(ev.at(-1).end, 4);
  const long = dialogues(overlayAss({ items: [{ type: 'counter', to: 500, suffix: '+', at: 0, dur: 600 }] }));
  assert.ok(long.length <= 61, `${long.length} events for a 10-minute counter`);
  assert.equal(long.at(-1).text.replace(/\{[^}]*\}/g, ''), '500+');
});
function near(a, b, tol, msg) { assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`); }

test('Indian scripts get their Noto face', () => {
  const ass = overlayAss({ items: [{ type: 'price', text: '₹499', sub: 'सिर्फ आज', at: 0, dur: 2 }, { type: 'pin', text: 'சென்னை', at: 0, dur: 2 }] });
  assert.match(ass, /\\fnNoto Sans Devanagari[^}]*\}सिर्फ आज/);
  assert.match(ass, /\\fnNoto Sans Tamil[^}]*\}சென்னை/);
  assert.match(ass, /\\fnNoto Sans\\fs\d+[^}]*\}₹499/);
});

test('overlaysFrom: wishes → timed items, missing values skipped, prices and stats parsed', () => {
  const items = overlaysFrom({
    price: 'Rs 4999 only', location: 'Whitefield, Bengaluru', stat: '1,200+ happy customers', offer: '50% OFF', phone: '98765 43210', whatsapp: '98765 43210', duration: 20,
    wants: [{ type: 'pin', at: 'hook' }, { type: 'price', at: 'middle' }, { type: 'counter' }, { type: 'badge', at: 'hook' }, { type: 'label', from: 'deadline' }, { type: 'lowerThird' }, { type: 'cta' }, { type: 'sparkles' }],
  });
  const by = Object.fromEntries(items.map((x) => [x.type, x]));
  assert.deepEqual(Object.keys(by).sort(), ['badge', 'counter', 'cta', 'pin', 'price'], 'no deadline/business given → no label/lowerThird');
  assert.equal(by.price.text, '₹4,999');
  assert.equal(by.price.sub, 'Only');
  assert.ok(by.price.at >= 20 * 0.4 - 0.01 && by.price.at + by.price.dur <= 20 * 0.6 + 0.01, 'middle = 40–60%');
  assert.ok(by.pin.at >= 0.4 - 0.01 && by.pin.at + by.pin.dur <= 2.8 + 0.01, 'hook ≈ 0.4–2.8 s');
  assert.deepEqual([by.counter.to, by.counter.suffix, by.counter.label], [1200, '+', 'Happy customers']);
  assert.deepEqual([by.cta.at, by.cta.dur, by.cta.whatsapp, by.cta.offer], [17.5, 2.5, '98765 43210', '50% OFF']);
  for (let i = 1; i < items.length; i++) assert.ok(items[i].at >= items[i - 1].at);
  assert.equal(overlaysFrom({ price: '₹4,999 only', duration: 10, wants: [{ type: 'price' }] })[0].text, '₹4,999');
  assert.equal(overlaysFrom({ stat: 2500, duration: 10, wants: [{ type: 'counter' }] })[0].to, 2500);
  assert.equal(overlaysFrom({ price: 'call for price', duration: 10, wants: [{ type: 'price' }] }).length, 0);
  // cta only when asked for and there's something to act on
  assert.equal(overlaysFrom({ duration: 10, wants: [{ type: 'cta' }] }).length, 0);
  assert.equal(overlaysFrom({ phone: '98765 43210', duration: 10, wants: [] }).length, 0);
  // and the items render
  assert.ok(dialogues(overlayAss({ items, duration: 20 })).length > 10);
});

test('an overlay really burns in: the frame during the price tag differs from the one before it', () => {
  const ass = writeOverlays(f('overlay.ass'), { width: 270, height: 480, duration: 3, items: [{ type: 'price', text: '₹4,999', sub: 'Only today', at: 1, dur: 2 }] });
  assert.equal(ass, f('overlay.ass'));
  // run from the .ass file's folder with just its name (no Windows drive-letter escaping), like burnCaptions does
  ff(['-i', f('plain.mp4'), '-vf', `ass=filename=${path.basename(ass)}`, '-an', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', f('burnt.mp4')], { cwd: dir });
  const a = frame(f('burnt.mp4'), 0.5, 270, 480), b = frame(f('burnt.mp4'), 1.8, 270, 480);
  assert.equal(a.length, 270 * 480);
  let changed = 0;
  for (let i = 0; i < a.length; i++) if (Math.abs(a[i] - b[i]) > 40) changed++;
  assert.ok(changed > 270 * 480 * 0.02, `${changed} pixels changed`);
  // and before the tag the picture is untouched (plain colour)
  const plain = frame(f('plain.mp4'), 0.5, 270, 480);
  let diff0 = 0;
  for (let i = 0; i < a.length; i++) if (Math.abs(a[i] - plain[i]) > 12) diff0++;
  assert.ok(diff0 < 50, `${diff0} pixels differ before the overlay`);
});
