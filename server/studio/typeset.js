// Studio Designs' typesetter: crisp words, shapes and the logo laid over a background picture by OUR renderer —
// never by the image model (it can't be trusted to spell ₹499 or शुभ दीपावली). ffmpeg + libass do the drawing: libass
// shapes every script with HarfBuzz (Devanagari conjuncts and matras, Gujarati, Tamil, Bengali…) using the Noto fonts
// the server ships (Dockerfile), falling back per glyph through fontconfig.
//   1. measure: every word is drawn once at a reference size and its ink width read back from raw pixels, so the
//      fitting below works with the real fonts and shaping, not a guess (cached; a guess only when ffmpeg can't)
//   2. fit: each text block shrinks and wraps (balanced lines) until it fits its box and line limit
//   3. draw: the template's shapes (panels, scrims, pills, badges, frames) and the fitted lines become one .ass file;
//      ffmpeg puts the photo(s) in their regions, burns the .ass over them and overlays the logo → one PNG
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { FFMPEG } from './ff.js';
import { randomUUID } from 'node:crypto';
import { SAFE } from './standard.js';
const uid = () => randomUUID().slice(0, 8);

// ---------- formats ----------
export const FORMATS = {
  square: { w: 1080, h: 1080, aspect: '1:1', label: 'Square post' },
  portrait: { w: 1080, h: 1350, aspect: '4:5', label: 'Portrait post' },
  story: { w: 1080, h: 1920, aspect: '9:16', label: 'Story' },
  thumbnail: { w: 1280, h: 720, aspect: '16:9', label: 'YouTube thumbnail' },
};
// where nothing important goes: stories lose the top (account bar) and bottom (reply box); posts and thumbnails a margin
// (a thumbnail's bottom-right corner is covered by the video length, so it keeps a little more there)
export function safeBox(W, H) {
  if (H / W > 1.6) return { t: Math.round(H * SAFE.story.top), b: Math.round(H * SAFE.story.bottom), l: Math.round(W * SAFE.story.left), r: Math.round(W * SAFE.story.right) }; // the Creative Standard's story zone
  if (W > H) return { t: Math.round(H * 0.07), b: Math.round(H * 0.1), l: Math.round(W * 0.05), r: Math.round(W * 0.05) };
  return { t: Math.round(H * 0.065), b: Math.round(H * 0.065), l: Math.round(W * 0.065), r: Math.round(W * 0.065) };
}

// ---------- colours ----------
export const hexOk = (v) => /^#[0-9a-f]{6}$/i.test(String(v || ''));
const rgb = (h) => { const s = String(h).replace('#', ''); return [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16) || 0); };
const toHex = (c) => `#${c.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')}`;
export const mix = (a, b, t) => { const x = rgb(a), y = rgb(b); return toHex(x.map((v, i) => v + (y[i] - v) * t)); };
export function luminance(h) { const [r, g, b] = rgb(h).map((v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; }
export const contrast = (a, b) => { const x = luminance(a), y = luminance(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
// white or near-black, whichever reads better on bg
export const ink = (bg, light = '#ffffff', dark = '#141414') => (contrast(light, bg) >= contrast(dark, bg) ? light : dark);
// fg nudged lighter or darker until it reads on bg (at least `min` contrast)
export function readable(fg, bg, min = 3) {
  if (contrast(fg, bg) >= min) return fg;
  const to = luminance(bg) < 0.4 ? '#ffffff' : '#000000';
  for (let t = 0.1; t <= 1; t += 0.1) { const c = mix(fg, to, t); if (contrast(c, bg) >= min) return c; }
  return to;
}
// ASS colours are &HBBGGRR& and alpha &HAA& (00 = solid)
const assC = (h) => { const [r, g, b] = rgb(h); return `&H${[b, g, r].map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase()}&`; };
const assA = (opacity) => `&H${Math.round((1 - Math.max(0, Math.min(1, opacity))) * 255).toString(16).padStart(2, '0').toUpperCase()}&`;

// ---------- fonts ----------
// the script a piece of text is mostly written in (a Hindi line with an English brand name is still Devanagari)
const SCRIPTS = [['devanagari', /[ऀ-ॿ]/g], ['bengali', /[ঀ-৿]/g], ['gurmukhi', /[਀-੿]/g], ['gujarati', /[઀-૿]/g], ['oriya', /[଀-୿]/g], ['tamil', /[஀-௿]/g], ['telugu', /[ఀ-౿]/g], ['kannada', /[ಀ-೿]/g], ['malayalam', /[ഀ-ൿ]/g], ['arabic', /[؀-ۿ]/g]];
export function scriptOf(text) {
  let best = 'latin', n = 0;
  for (const [name, re] of SCRIPTS) { const k = (String(text).match(re) || []).length; if (k > n) { best = name; n = k; } }
  return best;
}
const INDIC_FONT = { devanagari: 'Devanagari', bengali: 'Bengali', gurmukhi: 'Gurmukhi', gujarati: 'Gujarati', oriya: 'Oriya', tamil: 'Tamil', telugu: 'Telugu', kannada: 'Kannada', malayalam: 'Malayalam', arabic: 'Arabic' };
// family: sans | serif | display → the Noto face for the text's script (serif exists for the big scripts; others use sans)
export const FAMILIES = ['sans', 'serif', 'display'];
export function fontFor(text, family = 'sans') {
  const s = scriptOf(text);
  if (s === 'latin') return family === 'serif' ? 'Noto Serif' : 'Noto Sans';
  if (s === 'arabic') return 'Noto Naskh Arabic';
  const serif = family === 'serif' && ['devanagari', 'bengali', 'gujarati', 'tamil', 'telugu', 'kannada', 'malayalam'].includes(s);
  return `Noto ${serif ? 'Serif' : 'Sans'} ${INDIC_FONT[s]}`;
}
const caseless = (text) => scriptOf(text) !== 'latin';

// text safe inside an ASS event
const esc = (s) => String(s ?? '').replace(/[{}\\]/g, '').replace(/\s+/g, ' ').trim();

// ---------- 1. measuring ----------
const REF = 56, ROW = 92;
const CACHE = new Map();
const keyOf = (w, st) => `${st.font}|${st.weight}|${st.italic ? 1 : 0}|${st.spacing || 0}|${w}`;
const styleTags = (st, size) => `\\fn${st.font}\\fs${size}\\b${st.weight || 700}\\i${st.italic ? 1 : 0}\\fsp${((st.spacing || 0) * size).toFixed(2)}`;
// a rough width when ffmpeg isn't there to ask (fractions of the size)
function guess(w, st) {
  let x = 0;
  for (const ch of w) x += /\s/.test(ch) ? 0.26 : /[ऀ-ൿ]/.test(ch) ? 0.42 : /[A-Z0-9₹%]/.test(ch) ? 0.68 : /[a-z]/.test(ch) ? 0.55 : 0.6;
  return x * REF * ((st.weight || 700) >= 800 ? 1.08 : 1) + (st.spacing || 0) * REF * w.length;
}
const header = (W, H) => ['[Script Info]', 'ScriptType: v4.00+', `PlayResX: ${W}`, `PlayResY: ${H}`, 'WrapStyle: 2', 'ScaledBorderAndShadow: yes', 'YCbCr Matrix: None', '', '[V4+ Styles]',
  'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
  'Style: D,Noto Sans,40,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,7,0,0,0,1', '', '[Events]', 'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text'];
const ev = (layer, text) => `Dialogue: ${layer},0:00:00.00,0:00:05.00,D,,0,0,0,,${text}`;

export const tmpDir = () => { const d = path.join(os.tmpdir(), 'funnelhive-designs'); fs.mkdirSync(d, { recursive: true }); return d; };
function ff(args, { cwd, timeoutMs = 60000, raw = false } = {}) {
  return new Promise((resolve, reject) => {
    let p;
    try { p = spawn(FFMPEG(), ['-hide_banner', '-nostdin', '-loglevel', 'error', '-y', ...args], { cwd, windowsHide: true }); } catch (e) { return reject(e); }
    const out = [], err = [];
    p.stdout.on('data', (c) => { if (raw) out.push(c); });
    p.stderr.on('data', (c) => err.push(c));
    const t = setTimeout(() => p.kill('SIGKILL'), timeoutMs);
    p.on('error', (e) => { clearTimeout(t); reject(e); });
    p.on('close', (code) => { clearTimeout(t); if (code === 0) resolve(Buffer.concat(out)); else reject(Object.assign(new Error('The design couldn’t be drawn'), { detail: Buffer.concat(err).toString().slice(-800) })); });
  });
}

// [{ text, st }] → fills CACHE with each word's ink width at REF (one ffmpeg run for everything not yet known)
async function measure(items) {
  const todo = [...new Map(items.filter((x) => !CACHE.has(keyOf(x.text, x.st))).map((x) => [keyOf(x.text, x.st), x])).values()];
  if (!todo.length) return;
  const W = Math.min(6000, Math.max(400, Math.ceil(Math.max(...todo.map((x) => guess(x.text, x.st))) * 1.7) + 60));
  const H = todo.length * ROW + 20;
  const dir = tmpDir(), f = `m-${Date.now().toString(36)}-${uid()}.ass`;
  fs.writeFileSync(path.join(dir, f), `${[...header(W, H), ...todo.map((x, i) => ev(0, `{\\an7\\pos(16,${10 + i * ROW})${styleTags(x.st, REF)}\\bord0\\shad0}${x.text}`))].join('\n')}\n`, 'utf8');
  try {
    const buf = await ff(['-f', 'lavfi', '-i', `color=c=black:s=${W}x${H}`, '-vf', `ass=${f}`, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'gray', 'pipe:1'], { cwd: dir, raw: true });
    if (buf.length < W * H) throw new Error('short read');
    todo.forEach((x, i) => {
      let lo = W, hi = -1;
      const y0 = Math.max(0, 10 + i * ROW - 14), y1 = Math.min(H, 10 + (i + 1) * ROW - 14);
      for (let y = y0; y < y1; y++) { const row = y * W; for (let px = 0; px < W; px++) if (buf[row + px] > 70) { if (px < lo) lo = px; if (px > hi) hi = px; } }
      CACHE.set(keyOf(x.text, x.st), hi < 0 ? guess(x.text, x.st) * 0.5 : hi - Math.min(lo, 16) + 1);
    });
  } catch (e) {
    console.error('design measure failed — guessing widths', e.message, e.detail || '');
    for (const x of todo) CACHE.set(keyOf(x.text, x.st), guess(x.text, x.st));
  } finally { fs.rm(path.join(dir, f), { force: true }, () => {}); }
  if (CACHE.size > 6000) for (const k of [...CACHE.keys()].slice(0, 2000)) CACHE.delete(k);
}
const widthOf = (w, st, size) => { const k = CACHE.get(keyOf(w, st)); if (k == null && w.length > 1 && w.endsWith('…')) return widthOf(w.slice(0, -1), st, size) + widthOf('…', st, size); return ((k ?? guess(w, st)) * size) / REF; };
// a space's advance: "H H" less "HH"
const spaceOf = (st, size) => Math.max(size * 0.18, widthOf('H H', st, size) - widthOf('HH', st, size));
const spaceItems = (st) => [{ text: 'H H', st }, { text: 'HH', st }];

// ---------- 2. fitting ----------
// "*Big* words" → words with a highlight flag (the starred words take the accent colour)
export function tokens(text, upper) {
  const out = [];
  let hot = false;
  for (const raw of esc(text).split(' ')) {
    if (!raw) continue;
    let w = raw;
    const open = w.startsWith('*'), close = w.endsWith('*') && w.length > 1;
    w = w.replace(/^\*+|\*+$/g, '');
    if (open) hot = true;
    if (w) out.push({ w: upper && !caseless(w) ? w.toLocaleUpperCase() : w, hot });
    if (close || (open && raw.length > 1 && raw.endsWith('*'))) hot = false;
  }
  return out;
}
const plain = (text) => esc(text).replace(/\*/g, '');
// words → lines no wider than `limit`
function wrap(words, st, size, limit) {
  const sp = spaceOf(st, size), lines = [];
  let cur = [], w = 0;
  for (const t of words) {
    const tw = widthOf(t.w, st, size);
    if (cur.length && w + sp + tw > limit) { lines.push({ words: cur, width: w }); cur = []; w = 0; }
    w = cur.length ? w + sp + tw : tw;
    cur.push(t);
  }
  if (cur.length) lines.push({ words: cur, width: w });
  return lines;
}
// the biggest size (max → min) at which the block fits its box, lines balanced (no long line over a lonely word);
// still too long at the smallest size: the last line ends in "…"
export function fit(text, { st, w, h, max, min = Math.round(max * 0.45), lh = 1.08, maxLines = 3, upper = false }) {
  const words = tokens(text, upper);
  if (!words.length) return { size: max, lines: [], height: 0, width: 0 };
  min = Math.max(6, Math.min(min, max));
  const sizes = [];
  for (let s = max; s > min; s = Math.floor(s * 0.94)) sizes.push(s);
  sizes.push(min);
  for (const size of sizes) {
    const lines = wrap(words, st, size, w);
    const widest = Math.max(...lines.map((l) => l.width));
    if (lines.length <= maxLines && widest <= w && lines.length * size * lh <= h) return balance(words, st, size, w, lines, lh);
  }
  // doesn't fit: the smallest size, cut to the lines that fit
  const size = min, room = Math.max(1, Math.min(maxLines, Math.floor(h / (size * lh)) || 1));
  let lines = wrap(words, st, size, w);
  if (lines.length > room) {
    lines = lines.slice(0, room);
    const last = lines[room - 1];
    while (last.words.length > 1 && last.width + widthOf('…', st, size) > w) { last.words.pop(); last.width = lineWidth(last.words, st, size); }
    last.words = [...last.words.slice(0, -1), { ...last.words.at(-1), w: `${last.words.at(-1).w}…` }];
    last.width = lineWidth(last.words, st, size);
  }
  // a single word wider than the box: squeeze it horizontally rather than spill out
  return { size, lines, height: lines.length * size * lh, width: Math.min(w, Math.max(...lines.map((l) => l.width))), squeeze: Math.min(1, w / Math.max(...lines.map((l) => l.width))) };
}
const lineWidth = (words, st, size) => words.reduce((a, t, i) => a + widthOf(t.w, st, size) + (i ? spaceOf(st, size) : 0), 0);
// the narrowest width that still gives the same number of lines (binary search) → even lines
function balance(words, st, size, w, lines, lh) {
  let best = lines;
  if (lines.length > 1) {
    let lo = Math.max(...words.map((t) => widthOf(t.w, st, size))), hi = w;
    for (let i = 0; i < 12 && hi - lo > 2; i++) { const mid = (lo + hi) / 2, l = wrap(words, st, size, mid); if (l.length <= lines.length) { best = l; hi = mid; } else lo = mid; }
  }
  return { size, lines: best, height: best.length * size * lh, width: Math.max(...best.map((l) => l.width)), squeeze: 1 };
}

// ---------- 3. drawing ----------
const R = (v) => Math.round(v * 10) / 10;
// a closed path whose box starts at 0,0, placed at x,y (libass aligns a drawing by its own box)
function path0(points) {
  const minX = Math.min(...points.map((p) => p[0])), minY = Math.min(...points.map((p) => p[1]));
  return { x: minX, y: minY, d: `m ${points.map((p, i) => `${R(p[0] - minX)} ${R(p[1] - minY)}${i === 0 ? ' l' : ''}`).join(' ')}` };
}
const roundRect = (w, h, r) => {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  if (!r) return `m 0 0 l ${R(w)} 0 l ${R(w)} ${R(h)} l 0 ${R(h)}`;
  const k = r * 0.4477;
  return `m ${R(r)} 0 l ${R(w - r)} 0 b ${R(w - k)} 0 ${R(w)} ${R(k)} ${R(w)} ${R(r)} l ${R(w)} ${R(h - r)} b ${R(w)} ${R(h - k)} ${R(w - k)} ${R(h)} ${R(w - r)} ${R(h)} l ${R(r)} ${R(h)} b ${R(k)} ${R(h)} 0 ${R(h - k)} 0 ${R(h - r)} l 0 ${R(r)} b 0 ${R(k)} ${R(k)} 0 ${R(r)} 0`;
};
const ellipse = (rx, ry) => { const kx = rx * 0.5523, ky = ry * 0.5523, w = 2 * rx, h = 2 * ry; return `m ${R(rx)} 0 b ${R(rx + kx)} 0 ${R(w)} ${R(ry - ky)} ${R(w)} ${R(ry)} b ${R(w)} ${R(ry + ky)} ${R(rx + kx)} ${R(h)} ${R(rx)} ${R(h)} b ${R(rx - kx)} ${R(h)} 0 ${R(ry + ky)} 0 ${R(ry)} b 0 ${R(ry - ky)} ${R(rx - kx)} 0 ${R(rx)} 0`; };
const starPts = (cx, cy, r) => Array.from({ length: 10 }, (_, i) => { const a = -Math.PI / 2 + (i * Math.PI) / 5, rr = i % 2 ? r * 0.45 : r; return [cx + rr * Math.cos(a), cy + rr * Math.sin(a)]; });

// a template's elements → ASS events (text blocks fitted first) and the logo's slot
//   rect { x, y, w, h, fill, opacity, r, stroke, strokeW, rot, layer }   gradient { x, y, w, h, fill, from, to, dir }
//   ellipse { cx, cy, rx, ry, fill, opacity, stroke, strokeW }   poly { points, fill, opacity }   star { cx, cy, r, fill }
//   text { text, x, y, w, h, align, valign, family, weight, italic, colour, hot, max, min, lh, maxLines, upper, spacing,
//          outline: { colour, w }, shadow: { colour, opacity, dx, dy, blur }, rot }
//   pill { text, x, y, align, valign, fill, colour, size, padX, padY, r, maxW, family, weight, upper, spacing, stroke, rot }
//   stack { x, y, w, h, align, valign, gap, items: [text | pill | rule { w, h, fill } | space { h } | logo { h, w }] }
//   logo { x, y, w, h, align, valign, plate } — the seller's logo (overlaid by ffmpeg); without one, brandText is drawn
function collect(els, out = []) {
  for (const e of els) {
    if (e.type === 'stack') collect(e.items, out);
    else if ((e.type === 'text' || e.type === 'pill') && plain(e.text)) {
      const st = styleOf(e);
      for (const t of tokens(e.text, e.upper)) out.push({ text: t.w, st });
      out.push({ text: '…', st });
      out.push(...spaceItems(st));
    }
  }
  return out;
}
const styleOf = (e) => ({ font: fontFor(plain(e.text), e.family), weight: e.weight || 700, italic: !!e.italic && !caseless(plain(e.text)), spacing: caseless(plain(e.text)) ? 0 : e.spacing || 0 });

function lineText(line, e, base, hot) {
  return line.words.map((t, i) => `${i ? ' ' : ''}${t.hot && hot ? `{\\1c${assC(hot)}}${t.w}{\\1c${assC(base)}}` : t.w}`).join('');
}
// a fitted text block's events, top at y
function textEvents(e, f, x, y, layer) {
  const st = styleOf(e), out = [], an = { left: 7, center: 8, right: 9 }[e.align || 'left'];
  const ax = e.align === 'center' ? x + e.w / 2 : e.align === 'right' ? x + e.w : x;
  const rot = e.rot ? `\\frz${e.rot}\\org(${R(e.org?.[0] ?? x + e.w / 2)},${R(e.org?.[1] ?? y + f.height / 2)})` : '';
  const sq = f.squeeze && f.squeeze < 1 ? `\\fscx${Math.floor(f.squeeze * 100)}` : '';
  const lh = e.lh || 1.08;
  f.lines.forEach((l, i) => {
    const ly = y + i * f.size * lh;
    const body = lineText(l, e, e.colour, e.hot);
    const common = `${styleTags(st, f.size)}${sq}${rot}${e.strike ? '\\s1' : ''}`;
    if (e.shadow) {
      const s = e.shadow, d = s.dx ?? f.size * 0.04, dy = s.dy ?? f.size * 0.05;
      out.push(ev(layer, `{\\an${an}\\pos(${R(ax + d)},${R(ly + dy)})${common}\\1c${assC(s.colour || '#000000')}\\1a${assA(s.opacity ?? 0.45)}\\bord${R(e.outline ? e.outline.w : 0)}\\3c${assC(s.colour || '#000000')}\\3a${assA(s.opacity ?? 0.45)}\\shad0\\blur${R(s.blur ?? f.size * 0.08)}}${l.words.map((t) => t.w).join(' ')}`));
    }
    const ol = e.outline ? `\\bord${R(e.outline.w)}\\3c${assC(e.outline.colour)}` : '\\bord0';
    out.push(ev(layer + 1, `{\\an${an}\\pos(${R(ax)},${R(ly)})${common}\\1c${assC(e.colour)}${ol}\\shad0}${body}`));
  });
  return out;
}
function shapeEvent(layer, x, y, d, { fill = '#000000', opacity = 1, stroke, strokeW = 0, blur = 0, rot, org } = {}) {
  const r = rot ? `\\frz${rot}\\org(${R(org[0])},${R(org[1])})` : '';
  const s = stroke ? `\\bord${R(strokeW)}\\3c${assC(stroke)}\\3a${assA(1)}` : '\\bord0';
  return ev(layer, `{\\an7\\pos(${R(x)},${R(y)})${r}\\1c${assC(fill)}\\1a${assA(stroke && opacity === 0 ? 0 : opacity)}${s}\\shad0${blur ? `\\blur${blur}` : ''}\\p1}${d}{\\p0}`);
}

function fitText(e, h = e.h) {
  const st = styleOf(e);
  return fit(e.text, { st, w: e.w, h, max: e.max, min: e.min, lh: e.lh, maxLines: e.maxLines ?? 3, upper: e.upper });
}
function pillBox(e) {
  const st = styleOf(e), size = e.size, padX = e.padX ?? size * 0.9, padY = e.padY ?? size * 0.45;
  const f = fit(e.text, { st, w: (e.maxW || 2000) - 2 * padX, h: size * 1.2, max: size, min: Math.round(size * 0.6), maxLines: 1, upper: e.upper });
  return { f, w: f.width + 2 * padX, h: f.size + 2 * padY, padX, padY };
}
function pillEvents(e, x, y, layer) {
  const b = pillBox(e), out = [];
  const rot = e.rot ? { rot: e.rot, org: [x + b.w / 2, y + b.h / 2] } : {};
  if (e.shadowBox) out.push(shapeEvent(layer, x + b.h * 0.08, y + b.h * 0.12, roundRect(b.w, b.h, e.r ?? b.h / 2), { fill: '#000000', opacity: 0.3, blur: 6, ...rot }));
  out.push(shapeEvent(layer, x, y, roundRect(b.w, b.h, e.r ?? b.h / 2), { fill: e.fill, opacity: e.opacity ?? 1, stroke: e.stroke, strokeW: e.strokeW, ...rot }));
  out.push(...textEvents({ ...e, w: b.w - 2 * b.padX, align: 'center', lh: 1, rot: e.rot, org: rot.org }, b.f, x + b.padX, y + b.padY, layer + 1));
  return { out, w: b.w, h: b.h };
}
const placeX = (x, w, inner, align) => (align === 'center' ? x + (w - inner) / 2 : align === 'right' ? x + w - inner : x);

// elements → { events, logos: [{ x, y, w, h, ax, ay }] }
export function layout(els, { logo = false } = {}) {
  const events = [], logos = [];
  els.forEach((e, i) => {
    const L = (e.layer ?? i) * 4;
    if (e.type === 'rect') events.push(shapeEvent(L, e.x, e.y, roundRect(e.w, e.h, e.r || 0), { fill: e.fill, opacity: e.opacity ?? 1, stroke: e.stroke, strokeW: e.strokeW, blur: e.blur, rot: e.rot, org: [e.x + e.w / 2, e.y + e.h / 2] }));
    else if (e.type === 'ellipse') events.push(shapeEvent(L, e.cx - e.rx, e.cy - e.ry, ellipse(e.rx, e.ry), { fill: e.fill, opacity: e.opacity ?? 1, stroke: e.stroke, strokeW: e.strokeW, blur: e.blur }));
    else if (e.type === 'poly' || e.type === 'star') { const p = path0(e.type === 'star' ? starPts(e.cx, e.cy, e.r) : e.points); events.push(shapeEvent(L, p.x, p.y, p.d, { fill: e.fill, opacity: e.opacity ?? 1, blur: e.blur })); }
    else if (e.type === 'gradient') {
      // from → to opacity (eased), strongest towards dir. Nested layers, each running from its step to the strong
      // edge: they add up (1 − Π(1 − o)) to the target at every step, with no seams between bands
      const n = 40, vert = e.dir === 'up' || e.dir === 'down', len = vert ? e.h : e.w, toEnd = e.dir === 'down' || e.dir === 'right';
      const from = e.from ?? 0, to = e.to ?? 0.8;
      let prev = 0;
      for (let k = 0; k < n; k++) {
        const t = k / (n - 1), target = from + (to - from) * t * t * (3 - 2 * t);
        const o = prev >= 1 ? 0 : Math.max(0, 1 - (1 - target) / (1 - prev));
        prev = target;
        if (o < 0.004) continue;
        const a = Math.round((k * len) / n), span = len - a; // distance from the weak edge, and what's left to the strong one
        const pos = toEnd ? a : 0, size = span;
        events.push(shapeEvent(L, vert ? e.x : e.x + pos, vert ? e.y + pos : e.y, vert ? roundRect(e.w, size, 0) : roundRect(size, e.h, 0), { fill: e.fill || '#000000', opacity: o }));
      }
    } else if (e.type === 'text') {
      if (!plain(e.text)) return;
      const f = fitText(e);
      const y = e.valign === 'middle' ? e.y + (e.h - f.height) / 2 : e.valign === 'bottom' ? e.y + e.h - f.height : e.y;
      events.push(...textEvents(e, f, e.x, y, L));
    } else if (e.type === 'pill') {
      if (!plain(e.text)) return;
      const b = pillBox(e);
      const x = e.align === 'center' ? e.x - b.w / 2 : e.align === 'right' ? e.x - b.w : e.x;
      const y = e.valign === 'middle' ? e.y - b.h / 2 : e.valign === 'bottom' ? e.y - b.h : e.y;
      events.push(...pillEvents(e, x, y, L).out);
    } else if (e.type === 'logo') {
      if (logo) logos.push({ x: e.x, y: e.y, w: e.w, h: e.h, ax: { left: 0, center: 0.5, right: 1 }[e.align || 'center'], ay: { top: 0, middle: 0.5, bottom: 1 }[e.valign || 'middle'] });
      else if (e.brandText) events.push(...layout([{ type: 'text', text: e.brandText, x: e.x, y: e.y, w: e.w, h: e.h, align: e.align || 'center', valign: e.valign || 'middle', max: Math.round(e.h * 0.62), min: Math.round(e.h * 0.2), maxLines: 1, weight: 800, colour: e.colour || '#ffffff', family: e.family, spacing: 0.04, upper: true, layer: e.layer ?? i }]).events);
    } else if (e.type === 'stack') {
      // fit every item, then place them one under another (gap between), aligned in the box
      const items = e.items.filter((x) => x && (x.type === 'rule' || x.type === 'space' || (x.type === 'logo' && (logo || x.brandText)) || plain(x.text)));
      const sized = items.map((x) => {
        if (x.type === 'text') { const f = fitText({ ...x, w: x.w || e.w }, x.h ?? e.h * (x.share ?? 0.3)); return { x, f, h: f.height }; }
        if (x.type === 'pill') { const b = pillBox({ ...x, maxW: x.maxW || e.w }); return { x, b, h: b.h }; }
        if (x.type === 'logo') return { x, h: x.h };
        return { x, h: x.h };
      });
      const gap = e.gap ?? 20, total = sized.reduce((a, s) => a + s.h, 0) + gap * Math.max(0, sized.length - 1);
      let y = e.valign === 'middle' ? e.y + (e.h - total) / 2 : e.valign === 'bottom' ? e.y + e.h - total : e.y;
      for (const s of sized) {
        const x = s.x, align = x.align || e.align || 'left', w = x.w || e.w;
        if (x.type === 'text') events.push(...textEvents({ ...x, w, align }, s.f, placeX(e.x, e.w, w, align), y + (x.offsetY || 0), L));
        else if (x.type === 'pill') events.push(...pillEvents({ ...x, maxW: x.maxW || e.w }, placeX(e.x, e.w, s.b.w, align), y, L).out);
        else if (x.type === 'rule') events.push(shapeEvent(L, placeX(e.x, e.w, x.w, align), y, roundRect(x.w, x.h, x.h / 2), { fill: x.fill, opacity: x.opacity ?? 1 }));
        else if (x.type === 'logo') {
          const lw = x.w || x.h * 3;
          if (logo) logos.push({ x: placeX(e.x, e.w, lw, align), y, w: lw, h: x.h, ax: { left: 0, center: 0.5, right: 1 }[align], ay: 0.5 });
          else events.push(...layout([{ type: 'text', text: x.brandText, x: placeX(e.x, e.w, lw, align), y, w: lw, h: x.h, align, valign: 'middle', max: Math.round(x.h * 0.62), min: Math.round(x.h * 0.2), maxLines: 1, weight: 800, colour: x.colour || '#ffffff', family: x.family, spacing: 0.04, upper: true, layer: e.layer ?? i }]).events);
        }
        y += s.h + gap;
      }
    }
  });
  return { events, logos };
}

// ---------- the whole picture ----------
// photos: [{ file, x, y, w, h, look: 'blur'|'grey'|'dim'|'' }]; logo: a local file or null; out: the PNG path
export async function compose({ W, H, fill = '#111111', photos = [], elements = [], logo = null, out }) {
  await measure(collect(elements));
  const { events, logos } = layout(elements, { logo: !!logo });
  const dir = tmpDir(), assName = `d-${Date.now().toString(36)}-${uid()}.ass`;
  fs.writeFileSync(path.join(dir, assName), `${[...header(W, H), ...events].join('\n')}\n`, 'utf8');
  const args = ['-f', 'lavfi', '-i', `color=c=0x${fill.replace('#', '')}:s=${W}x${H}`];
  const graph = [];
  let last = '0:v', n = 1;
  for (const p of photos.filter((x) => x.file)) {
    args.push('-i', p.file);
    const w = Math.round(p.w), h = Math.round(p.h), look = { blur: ',boxblur=24:2', grey: ',hue=s=0,eq=brightness=-0.04:contrast=0.92', dim: ',eq=brightness=-0.08' }[p.look] || '';
    graph.push(`[${n}:v]scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},setsar=1${look},format=rgba[p${n}]`, `[${last}][p${n}]overlay=${Math.round(p.x)}:${Math.round(p.y)}[b${n}]`);
    last = `b${n}`; n++;
  }
  graph.push(`[${last}]ass=${assName}[t]`);
  last = 't';
  if (logo && logos.length) {
    args.push('-i', logo);
    const li = n;
    graph.push(`[${li}:v]split=${logos.length}${logos.map((_, k) => `[lg${k}]`).join('')}`);
    logos.forEach((l, k) => {
      graph.push(`[lg${k}]scale=${Math.round(l.w)}:${Math.round(l.h)}:force_original_aspect_ratio=decrease,format=rgba[ls${k}]`, `[${last}][ls${k}]overlay=x='${Math.round(l.x)}+(${Math.round(l.w)}-overlay_w)*${l.ax}':y='${Math.round(l.y)}+(${Math.round(l.h)}-overlay_h)*${l.ay}'[o${k}]`);
      last = `o${k}`;
    });
  }
  graph.push(`[${last}]format=rgb24[final]`);
  try {
    await ff([...args, '-filter_complex', graph.join(';'), '-map', '[final]', '-frames:v', '1', '-update', '1', path.resolve(out)], { cwd: dir, timeoutMs: 90000 });
  } finally { fs.rm(path.join(dir, assName), { force: true }, () => {}); }
  return out;
}
