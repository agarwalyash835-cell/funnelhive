// Studio motion graphics: the animated bits an editor adds on top of a Reel — a price tag that pops, a number that rolls
// up, a map pin that drops on the shop's area, a lower third, a progress bar, an OFFER badge, the closing call-to-action
// panel. All of it is ONE .ass subtitle file (libass shapes + override tags, no drawtext), so it burns in with the same
// burnCaptions step as the captions and every script (Devanagari, Tamil…) is shaped properly. Everything sits inside the
// safe area Reels/Shorts leave clear of their own buttons.
import fs from 'node:fs';
import { safeArea, assTime } from './captions.js';
import { scriptOf, fontFor } from './typeset.js';

export const OVERLAY_TYPES = ['price', 'counter', 'pin', 'lowerThird', 'progress', 'badge', 'cta', 'label'];

// ---------- numbers ----------
// Indian grouping: the last three digits, then pairs (12,50,000 not 1,250,000)
function group(intStr) {
  if (intStr.length <= 3) return intStr;
  return `${intStr.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${intStr.slice(-3)}`;
}
export function formatNumber(n, { prefix = '', suffix = '', decimals = 0 } = {}) {
  const v = Number(n);
  if (!Number.isFinite(v)) return `${prefix}0${suffix}`;
  const [i, d] = Math.abs(v).toFixed(Math.max(0, Math.min(4, decimals | 0))).split('.');
  return `${v < 0 ? '-' : ''}${prefix}${group(i)}${d ? `.${d}` : ''}${suffix}`;
}
export const formatINR = (n, { decimals = 0 } = {}) => formatNumber(n, { prefix: '₹', decimals });

// ---------- ASS bits ----------
const R = (v) => Math.round(v * 10) / 10;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const hexOk = (v) => /^#[0-9a-f]{6}$/i.test(String(v || ''));
// override-tag colour &HBBGGRR& and alpha &HAA& (0 = solid; `a` here is transparency 0–1)
const col = (hex) => { const h = (hexOk(hex) ? hex : '#ffffff').slice(1); return `&H${h.slice(4, 6)}${h.slice(2, 4)}${h.slice(0, 2)}&`.toUpperCase(); };
const alpha = (a) => `&H${Math.round(clamp(a, 0, 1) * 255).toString(16).padStart(2, '0').toUpperCase()}&`;
// text that's safe inside an event: no override blocks, no escapes, one line
const clean = (s) => String(s ?? '').replace(/[{}\\]/g, '').replace(/\s+/g, ' ').trim();

const roundRect = (w, h, r) => {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  const k = r * 0.4477;
  return `m ${R(r)} 0 l ${R(w - r)} 0 b ${R(w - k)} 0 ${R(w)} ${R(k)} ${R(w)} ${R(r)} l ${R(w)} ${R(h - r)} b ${R(w)} ${R(h - k)} ${R(w - k)} ${R(h)} ${R(w - r)} ${R(h)} l ${R(r)} ${R(h)} b ${R(k)} ${R(h)} 0 ${R(h - k)} 0 ${R(h - r)} l 0 ${R(r)} b 0 ${R(k)} ${R(k)} 0 ${R(r)} 0`;
};
const rect = (w, h) => `m 0 0 l ${R(w)} 0 l ${R(w)} ${R(h)} l 0 ${R(h)}`;
const poly = (pts) => `m ${pts.map(([x, y], i) => `${R(x)} ${R(y)}${i === 0 ? ' l' : ''}`).join(' ')}`;
const circle = (r) => { const k = r * 0.5523, d = 2 * r; return `m ${R(r)} 0 b ${R(r + k)} 0 ${R(d)} ${R(r - k)} ${R(d)} ${R(r)} b ${R(d)} ${R(r + k)} ${R(r + k)} ${R(d)} ${R(r)} ${R(d)} b ${R(r - k)} ${R(d)} 0 ${R(r + k)} 0 ${R(r)} b 0 ${R(r - k)} ${R(r - k)} 0 ${R(r)} 0`; };
// a price tag: pointed on the left, square on the right
const tag = (w, h) => poly([[0, h / 2], [h * 0.38, 0], [w, 0], [w, h], [h * 0.38, h]]);
// a starburst badge: `n` spikes, inner radius a fraction of the outer
const burst = (r, n = 16, inner = 0.84) => poly(Array.from({ length: n * 2 }, (_, i) => { const a = -Math.PI / 2 + (i * Math.PI) / n, rr = i % 2 ? r * inner : r; return [r + rr * Math.cos(a), r + rr * Math.sin(a)]; }));
// a map pin: a round head tapering to a point at the bottom (2r wide, 2.6r tall)
const pinShape = (r) => `m ${R(r)} ${R(2.6 * r)} b ${R(0.55 * r)} ${R(2 * r)} 0 ${R(1.55 * r)} 0 ${R(r)} b 0 ${R(0.45 * r)} ${R(0.45 * r)} 0 ${R(r)} 0 b ${R(1.55 * r)} 0 ${R(2 * r)} ${R(0.45 * r)} ${R(2 * r)} ${R(r)} b ${R(2 * r)} ${R(1.55 * r)} ${R(1.45 * r)} ${R(2 * r)} ${R(r)} ${R(2.6 * r)}`;
// a chat bubble (round, tail at the bottom left) as one contour, so no fill-rule surprises where the tail meets it
const bubble = (s) => {
  const r = s / 2, pts = [];
  for (let i = 0; i <= 20; i++) { const a = (125 + (i * 300) / 20) * (Math.PI / 180); pts.push([r + r * Math.cos(a), r + r * Math.sin(a)]); }
  return poly([...pts, [s * 0.02, s]]);
};
// a handset-sized phone body
const phoneShape = (s) => roundRect(s * 0.56, s, s * 0.12);
// a drawing inside a line of text, in its own colour (it flows with the words, so a pulse moves both together)
const inlineDrawing = (d, fill, back) => `{\\1c${col(fill)}\\p1}${d}{\\p0\\1c${col(back)}}`;

// rough ink width of a line (fractions of the font size); good enough to size pills and shrink long lines
function est(t, fs) {
  let x = 0;
  for (const ch of String(t)) x += /\s/.test(ch) ? 0.28 : /[ऀ-ൿ]/.test(ch) ? 0.52 : /[A-Z0-9₹%@#]/.test(ch) ? 0.7 : /[a-z]/.test(ch) ? 0.56 : 0.6;
  return x * fs * 1.12; // bold Noto runs ~10% wider than these regular-weight fractions
}
// shrink until it fits maxW (not below min); still too wide → two balanced lines
function fitText(t, maxW, fs, min = fs * 0.55) {
  let size = fs;
  while (est(t, size) > maxW && size > min) size -= 1;
  if (est(t, size) <= maxW || !t.includes(' ')) return { fs: Math.round(size), text: t, lines: 1, w: Math.min(maxW, est(t, size)) };
  const words = t.split(' ');
  let best = null;
  for (let i = 1; i < words.length; i++) {
    const a = words.slice(0, i).join(' '), b = words.slice(i).join(' ');
    const w = Math.max(est(a, 1), est(b, 1));
    if (!best || w < best.w) best = { a, b, w };
  }
  size = Math.max(min, Math.min(fs, Math.floor(maxW / best.w)));
  return { fs: Math.round(size), text: `${best.a}\\N${best.b}`, lines: 2, w: Math.min(maxW, best.w * size) };
}

// ---------- the overlays ----------
// opts: { width, height, items, font, accent, ink, duration? (s — nothing runs past it) }
// items: see OVERLAY_TYPES; each { type, at (s), dur (s), pos?: 'top'|'middle'|'bottom', ... }
export function overlayAss({ width = 1080, height = 1920, items = [], font = 'Noto Sans', accent = '#ffd400', ink = '#111111', duration = Infinity } = {}) {
  const W = Math.max(16, Math.round(width)), H = Math.max(16, Math.round(height));
  if (!hexOk(accent)) accent = '#ffd400';
  if (!hexOk(ink)) ink = '#111111';
  const s = safeArea(W, H);
  const b = { x0: s.left, x1: W - s.right, y0: s.top, y1: H - s.bottom };
  b.w = b.x1 - b.x0; b.h = b.y1 - b.y0; b.cx = (b.x0 + b.x1) / 2;
  const u = Math.min(W, H); // sizes scale with the short side
  const yOf = (pos, def) => ({ top: b.y0 + b.h * 0.14, middle: b.y0 + b.h * 0.45, bottom: b.y1 - b.h * 0.16 })[pos] ?? ({ top: b.y0 + b.h * 0.14, middle: b.y0 + b.h * 0.45, bottom: b.y1 - b.h * 0.16 })[def];
  // the face for a piece of text: an Indian script gets its Noto face (a Latin brand font has no such glyphs)
  const fn = (t) => `\\fn${scriptOf(t) === 'latin' ? font : fontFor(t)}`;
  // text tags: font, size, bold, fill, outline
  const tx = (t, fs, { c = '#ffffff', bord = 0, oc = ink, shad = 0, bold = true } = {}) => `${fn(t)}\\fs${Math.round(fs)}\\b${bold ? 1 : 0}\\1c${col(c)}\\3c${col(oc)}\\4c${col('#000000')}\\4a${alpha(0.55)}\\bord${R(bord)}\\shad${R(shad)}`;
  const shape = (fill, a = 0) => `\\1c${col(fill)}\\1a${alpha(a)}\\bord0\\shad0\\p1`;

  const events = [];
  const MAX_EVENTS = 3000;
  const ev = (layer, start, end, text, style = 'M') => { if (events.length < MAX_EVENTS && end - start >= 0.01) events.push({ layer, start, end, style, text }); };

  for (const raw of Array.isArray(items) ? items : []) {
    if (!raw || !OVERLAY_TYPES.includes(raw.type)) continue; // unknown types are skipped, not fatal
    const at = clamp(Number(raw.at) || 0, 0, Number.isFinite(duration) ? duration : 1e6);
    const want = Number(raw.dur) > 0 ? Number(raw.dur) : raw.type === 'progress' && Number.isFinite(duration) ? duration - at : 2.5;
    const end = Math.min(at + want, Number.isFinite(duration) ? duration : Infinity);
    const dur = end - at;
    if (!(dur >= 0.2)) continue;
    const ms = Math.round(dur * 1000);
    const out = Math.min(200, Math.round(ms * 0.15)); // fade-out length

    if (raw.type === 'price') {
      const text = clean(raw.text);
      if (!text) continue;
      const f = fitText(text, b.w * 0.62, u * 0.11, u * 0.06);
      const h = f.fs * (f.lines === 2 ? 2.3 : 1.45), w = f.w + h * 0.38 + f.fs * 1.0;
      const x = b.cx, y = yOf(raw.pos, 'middle');
      // pops in with an overshoot and a little wobble, settles tilted (a hand-stuck price tag)
      const pop = `\\an5\\pos(${R(x)},${R(y)})\\fscx0\\fscy0\\frz-14\\t(0,200,\\fscx118\\fscy118\\frz7)\\t(200,340,\\fscx100\\fscy100\\frz4)\\fad(0,${out})`;
      ev(1, at, end, `{${pop}\\4c${col('#000000')}${shape('#000000', 0.6)}\\blur${R(u * 0.012)}}${tag(w + u * 0.01, h + u * 0.01)}`);
      ev(2, at, end, `{${pop}${shape(accent)}}${tag(w, h)}`);
      ev(3, at, end, `{${pop}${tx(text, f.fs, { c: ink })}}${text}`);
      const sub = clean(raw.sub);
      if (sub) {
        const g = fitText(sub, b.w * 0.8, u * 0.052, u * 0.035);
        ev(3, at, end, `{\\an8\\pos(${R(x)},${R(y + h * 0.62 + u * 0.02)})${tx(sub, g.fs, { bord: u * 0.007, shad: u * 0.004 })}\\alpha&HFF&\\t(260,420,\\alpha&H00&)\\fad(0,${out})}${g.text}`);
      }
    } else if (raw.type === 'counter') {
      const from = Number(raw.from) || 0, to = Number(raw.to);
      if (!Number.isFinite(to)) continue;
      const decimals = Number.isFinite(Number(raw.decimals)) ? Number(raw.decimals) : (Number.isInteger(to) && Number.isInteger(from) ? 0 : 1);
      const fmt = (v) => (raw.money ? formatINR(v, { decimals }) : formatNumber(v, { prefix: clean(raw.prefix), suffix: clean(raw.suffix), decimals }));
      const x = b.cx, y = yOf(raw.pos, 'middle');
      const f = fitText(fmt(to), b.w * 0.9, u * 0.15, u * 0.07);
      const base = `\\an5\\pos(${R(x)},${R(y)})${tx(fmt(to), f.fs, { c: accent, bord: u * 0.009, shad: u * 0.006 })}`;
      // rolls up with an ease-out over ~70% of its time, then holds on the real figure; ~15 steps a second, capped
      const roll = dur * 0.7, n = clamp(Math.round(roll * 15), 2, 60);
      const ease = (p) => 1 - (1 - p) ** 3;
      for (let i = 0; i <= n; i++) {
        const t0 = at + (roll * i) / n, t1 = i === n ? end : at + (roll * (i + 1)) / n;
        const v = i === n ? to : from + (to - from) * ease(i / n);
        const first = i === 0 ? '\\fscx60\\fscy60\\t(0,140,\\fscx100\\fscy100)' : '';
        const last = i === n ? `\\fscx112\\fscy112\\t(0,160,\\fscx100\\fscy100)\\fad(0,${out})` : '';
        ev(2, t0, t1, `{${base}${first}${last}}${fmt(decimals ? v : Math.round(v))}`);
      }
      const label = clean(raw.label);
      if (label) {
        const g = fitText(label, b.w * 0.9, u * 0.055, u * 0.035);
        ev(2, at, end, `{\\an8\\pos(${R(x)},${R(y + f.fs * 0.62)})${tx(label, g.fs, { bord: u * 0.007, shad: u * 0.004 })}\\fad(250,${out})}${g.text}`);
      }
    } else if (raw.type === 'pin') {
      const text = clean(raw.text);
      if (!text) continue;
      const r = u * 0.045;
      const g = fitText(text, b.w - 2 * r - u * 0.08, u * 0.052, u * 0.032);
      const tw = g.w + u * 0.06, th = g.fs * (g.lines === 2 ? 2.4 : 1.5);
      const left = b.x0 + Math.max(0, (b.w - (2 * r + u * 0.025 + tw)) / 2);
      const px = left + r, py = yOf(raw.pos, 'top') + r * 1.3; // py: the pin's tip
      // drops in, bounces once, settles: a chain of moves (ASS has no easing on \move)
      const drop = u * 0.35, hop = r * 0.45;
      const segs = [[0, 0.26, -drop, 0], [0.26, 0.38, 0, -hop], [0.38, 0.5, -hop, 0], [0.5, dur, 0, 0]];
      const head = 1.6 * r; // pin tip → head centre
      for (const [a, z, d0, d1] of segs) {
        if (a >= dur) break;
        const t0 = at + a, t1 = at + Math.min(z, dur), len = Math.round((t1 - t0) * 1000);
        const mv = (dy) => (d0 === d1 ? `\\pos(${R(px)},${R(py + dy + d0)})` : `\\move(${R(px)},${R(py + dy + d0)},${R(px)},${R(py + dy + d1)},0,${len})`);
        const fade = z >= dur ? `\\fad(0,${out})` : '';
        ev(2, t0, t1, `{\\an2${mv(0)}${fade}${shape(accent)}}${pinShape(r)}`);
        ev(3, t0, t1, `{\\an5${mv(-head)}${fade}${shape(ink)}}${circle(r * 0.38)}`);
      }
      // the place name slides in beside the pin on a dark pill
      const tx0 = px + r + u * 0.025, ty = py - head;
      const slide = (x) => `\\move(${R(x + u * 0.08)},${R(ty)},${R(x)},${R(ty)},200,460)\\fad(260,${out})`;
      ev(1, at, end, `{\\an4${slide(tx0)}${shape(ink, 0.25)}}${roundRect(tw, th, th / 2)}`);
      ev(2, at, end, `{\\an4${slide(tx0 + u * 0.03)}${tx(text, g.fs)}}${g.text}`);
    } else if (raw.type === 'lowerThird') {
      const title = clean(raw.title ?? raw.text);
      if (!title) continue;
      const g = fitText(title, b.w * 0.86, u * 0.06, u * 0.038);
      const bh = g.fs * (g.lines === 2 ? 2.4 : 1.55), bw = Math.min(b.w, g.w + u * 0.08);
      const x = b.x0, y = yOf(raw.pos, 'bottom') - bh / 2;
      // the bar wipes in from the left (an animated clip), the title follows a beat later; both wipe out to the right
      const wipe = (delay) => {
        const a = Math.min(delay, ms / 3), z = Math.min(a + 300, ms / 2), o = Math.max(z, ms - 260);
        return `\\clip(${R(x)},${R(y - 2)},${R(x)},${R(y + bh + 2)})\\t(${a},${z},\\clip(${R(x)},${R(y - 2)},${R(x + bw)},${R(y + bh + 2)}))\\t(${o},${ms},\\clip(${R(x + bw)},${R(y - 2)},${R(x + bw)},${R(y + bh + 2)}))`;
      };
      ev(1, at, end, `{\\an7\\pos(${R(x)},${R(y)})${wipe(0)}${shape(accent)}}${rect(bw, bh)}`);
      ev(2, at, end, `{\\an4\\pos(${R(x + u * 0.04)},${R(y + bh / 2)})${wipe(120)}${tx(title, g.fs, { c: ink })}}${g.text}`);
      const sub = clean(raw.sub);
      if (sub) {
        const h2 = fitText(sub, b.w * 0.86, u * 0.045, u * 0.032);
        ev(2, at, end, `{\\an7\\pos(${R(x + u * 0.01)},${R(y + bh + u * 0.015)})${tx(sub, h2.fs, { bord: u * 0.006, shad: u * 0.004 })}\\fad(380,${Math.min(260, out + 60)})}${h2.text}`);
      }
    } else if (raw.type === 'progress') {
      const c = hexOk(raw.colour) ? raw.colour : accent;
      const h = Math.max(3, Math.round(u * 0.008)), y = b.y0 + u * 0.01;
      ev(0, at, end, `{\\an7\\pos(${R(b.x0)},${R(y)})${shape('#ffffff', 0.7)}}${rect(b.w, h)}`);
      ev(1, at, end, `{\\an7\\pos(${R(b.x0)},${R(y)})\\clip(${R(b.x0)},${R(y)},${R(b.x0)},${R(y + h)})\\t(0,${ms},\\clip(${R(b.x0)},${R(y)},${R(b.x1)},${R(y + h)}))${shape(c)}}${rect(b.w, h)}`);
    } else if (raw.type === 'badge') {
      const text = clean(raw.text);
      if (!text) continue;
      const r = u * 0.13;
      const x = b.x1 - r - u * 0.01, y = raw.pos === 'bottom' ? b.y1 - r - b.h * 0.1 : raw.pos === 'middle' ? b.y0 + b.h * 0.45 : b.y0 + r + b.h * 0.04;
      const spin = `\\an5\\pos(${R(x)},${R(y)})\\fscx0\\fscy0\\frz-200\\t(0,380,\\fscx112\\fscy112\\frz10)\\t(380,520,\\fscx100\\fscy100\\frz0)\\fad(0,${out})`;
      const g = fitText(text.toLocaleUpperCase(), r * 1.4, r * 0.48, r * 0.24);
      ev(1, at, end, `{${spin}${shape(accent)}}${burst(r)}`);
      ev(2, at, end, `{${spin}${tx(text, g.fs, { c: ink })}}${scriptOf(text) === 'latin' ? g.text : fitText(text, r * 1.4, r * 0.48, r * 0.24).text}`);
    } else if (raw.type === 'cta') {
      const headline = clean(raw.headline) || 'Order now';
      const offer = clean(raw.offer), phone = clean(raw.phone), whatsapp = clean(raw.whatsapp);
      const pad = u * 0.05, inner = b.w - 2 * pad;
      const hl = fitText(headline, inner, u * 0.075, u * 0.045);
      const of = offer ? fitText(offer, inner, u * 0.055, u * 0.034) : null;
      const btnFs = Math.round(u * 0.05), btnH = btnFs * 1.9;
      const glyph = whatsapp ? inlineDrawing(bubble(btnFs * 0.9), '#25D366', ink) : phone ? inlineDrawing(phoneShape(btnFs * 0.9), ink, ink) : '';
      const btnText = whatsapp ? `WhatsApp ${whatsapp}` : phone ? `Call ${phone}` : 'Tap to order';
      const btnW = Math.min(inner, est(btnText, btnFs) + btnFs * (glyph ? 1.4 : 0) + u * 0.08);
      const second = whatsapp && phone ? `Call ${phone}` : '';
      const gap = u * 0.025;
      const hlH = hl.fs * 1.2 * hl.lines, ofH = of ? of.fs * 1.2 * of.lines : 0, secH = second ? u * 0.05 : 0;
      const ph = pad + hlH + (of ? gap + ofH : 0) + gap * 1.4 + btnH + (second ? gap + secH : 0) + pad;
      const top = raw.pos === 'top' ? b.y0 + b.h * 0.04 : raw.pos === 'middle' ? b.y0 + (b.h - ph) / 2 : b.y1 - ph;
      const dy = u * 0.18;
      // everything slides up together and fades in
      const up = (an, x, y) => `\\an${an}\\move(${R(x)},${R(y + dy)},${R(x)},${R(y)},0,380)\\fad(240,${out})`;
      ev(1, at, end, `{${up(8, b.cx, top)}${shape(ink, 0.18)}}${roundRect(b.w, ph, u * 0.04)}`);
      let y = top + pad;
      ev(2, at, end, `{${up(8, b.cx, y)}${tx(headline, hl.fs)}}${hl.text}`);
      y += hlH;
      if (of) { y += gap; ev(2, at, end, `{${up(8, b.cx, y)}${tx(offer, of.fs, { c: accent })}}${of.text}`); y += ofH; }
      y += gap * 1.4;
      // the button breathes (a gentle pulse every 1.2 s once it has landed) so the eye goes to it
      let pulse = '';
      for (let t = 600; t + 600 <= ms - out; t += 1200) pulse += `\\t(${t},${t + 300},\\fscx106\\fscy106)\\t(${t + 300},${t + 600},\\fscx100\\fscy100)`;
      const by = y + btnH / 2;
      ev(2, at, end, `{${up(5, b.cx, by)}${pulse}${shape(accent)}}${roundRect(btnW, btnH, btnH / 2)}`);
      ev(3, at, end, `{${up(5, b.cx, by)}${pulse}${tx(btnText, btnFs, { c: ink })}}${glyph}${glyph ? ' ' : ''}${btnText}`);
      y += btnH;
      if (second) { y += gap; ev(2, at, end, `{${up(8, b.cx, y)}${tx(second, u * 0.042)}}${inlineDrawing(phoneShape(u * 0.04), '#ffffff', '#ffffff')} ${second}`); }
    } else if (raw.type === 'label') {
      const text = clean(raw.text);
      if (!text) continue;
      const g = fitText(text, b.w * 0.45, u * 0.055, u * 0.034);
      // x, y: fractions of the frame (0–1), kept inside the safe area
      const x = Number.isFinite(Number(raw.x)) && raw.x !== null && raw.x !== '' ? clamp(Number(raw.x) * W, b.x0 + g.w / 2 + u * 0.02, b.x1 - g.w / 2 - u * 0.02) : b.cx;
      const y = Number.isFinite(Number(raw.y)) && raw.y !== null && raw.y !== '' ? clamp(Number(raw.y) * H, b.y0 + g.fs, b.y1 - g.fs) : yOf(raw.pos, 'top');
      ev(2, at, end, `{\\an5\\pos(${R(x)},${R(y)})${tx(text, g.fs, { oc: ink, bord: u * 0.018 })}\\3a${alpha(0.15)}\\fad(150,${out})}${g.text}`, 'B');
    }
  }

  events.sort((p, q) => p.start - q.start || p.layer - q.layer);
  const style = (name, borderStyle) => `Style: ${name},${font},${Math.round(u * 0.06)},&H00FFFFFF,&H00FFFFFF,&H00${col(ink).slice(2, -1)},&H80000000,-1,0,0,0,100,100,0,0,${borderStyle},0,0,5,${s.left},${s.right},0,1`;
  return `${[
    '[Script Info]', 'ScriptType: v4.00+', `PlayResX: ${W}`, `PlayResY: ${H}`, 'WrapStyle: 2', 'ScaledBorderAndShadow: yes', 'YCbCr Matrix: TV.709', '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    // M: text and shapes; B: a label on a solid box (BorderStyle 3 can't be switched on per event)
    style('M', 1), style('B', 3), '',
    '[Events]', 'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
    ...events.map((e) => `Dialogue: ${e.layer},${assTime(e.start)},${assTime(e.end)},${e.style},,0,0,0,,${e.text}`),
  ].join('\n')}\n`;
}

// write the overlays next to the render; → the file path
export function writeOverlays(file, opts) {
  fs.writeFileSync(file, overlayAss(opts), 'utf8');
  return file;
}

// ---------- from a recipe ----------
// '₹4,999 only' / 'Rs 4999' / 'Rs. 4,999/-' → { value: 4999, rest: 'only' }; no number → null
function parsePrice(v) {
  if (typeof v === 'number') return Number.isFinite(v) && v > 0 ? { value: v, rest: '' } : null;
  const s = clean(v), m = /(\d[\d,]*(?:\.\d+)?)/.exec(s);
  if (!m) return null;
  const value = Number(m[1].replace(/,/g, ''));
  if (!Number.isFinite(value)) return null;
  const rest = clean(s.replace(m[0], ' ').replace(/₹|\bINR\b|\bRs\.?(?=\s|$|\d)|\/-/gi, ' ')).replace(/^[\s.,:;-]+|[\s.,:;-]+$/g, '');
  return { value, rest };
}
// 5000 / '1,200+ happy customers' / '₹2 lakh saved' / '98% on time' → counter fields; no number → null
const MULT = { k: 1e3, thousand: 1e3, lakh: 1e5, lac: 1e5, l: 1e5, cr: 1e7, crore: 1e7, m: 1e6, million: 1e6 };
function parseStat(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? { to: v } : null;
  const s = clean(v), m = /(\d[\d,]*(?:\.\d+)?)\s*(k|thousand|lakhs?|lacs?|l|cr|crores?|m|million)?\b\s*([+%])?/i.exec(s);
  if (!m) return null;
  const unit = (m[2] || '').toLowerCase().replace(/s$/, '');
  const to = Number(m[1].replace(/,/g, '')) * (MULT[unit] || 1);
  if (!Number.isFinite(to)) return null;
  const money = /₹|\bRs\.?|\bINR\b/i.test(s);
  const label = clean(s.replace(m[0], ' ').replace(/₹|\bINR\b|\bRs\.?(?=\s|$|\d)/gi, ' ')).replace(/^[\s.,:;-]+|[\s.,:;-]+$/g, '');
  return { to, money, suffix: m[3] || '', label };
}
// where a wish lands: hook (just after the first beat), middle (40–60%), end (the last ~2.5 s); or a number of seconds
function slot(at, D, type) {
  const def = { price: 'middle', counter: 'middle', cta: 'end', progress: 'all' }[type] || 'hook';
  const w = at ?? def;
  if (typeof w === 'number' && Number.isFinite(w)) return { at: clamp(w, 0, D), dur: Math.min(2.5, D - clamp(w, 0, D)) };
  if (w === 'all') return { at: 0, dur: D };
  if (w === 'end') return { at: Math.max(0, D - 2.5), dur: Math.min(2.5, D) };
  if (w === 'middle') return { at: D * 0.4, dur: Math.max(1.5, D * 0.2) };
  return { at: Math.min(0.4, D * 0.1), dur: Math.min(2.4, D * 0.5) };
}
const FROM = { price: 'price', counter: 'stat', pin: 'location', lowerThird: 'business', badge: 'offer', label: 'deadline' };
const cap1 = (s) => (s ? s[0].toLocaleUpperCase() + s.slice(1) : s);

// A recipe's overlay wishes → timed items for overlayAss. Wishes whose source value is missing are dropped (no empty
// pins or ₹0 tags). wants: [{ type, from? (which field feeds it), at?: 'hook'|'middle'|'end'|seconds, text?, pos? }]
export function overlaysFrom({ offer, price, location, business, stat, deadline, name, phone, whatsapp, duration = 15, wants = [] } = {}) {
  const D = Math.max(1, Number(duration) || 15);
  const src = { offer, price, location, business, stat, deadline, name, phone, whatsapp };
  const items = [];
  let cta = false;
  for (const w of Array.isArray(wants) ? wants : []) {
    if (!w || !OVERLAY_TYPES.includes(w.type)) continue;
    if (w.type === 'cta') { cta = w; continue; }
    const { at, dur } = slot(w.at, D, w.type);
    const base = { type: w.type, at, dur, ...(w.pos ? { pos: w.pos } : {}) };
    if (w.type === 'progress') { items.push({ ...base, at: 0, dur: D, ...(w.colour ? { colour: w.colour } : {}) }); continue; }
    const key = w.from || FROM[w.type] || (w.type === 'lowerThird' ? 'name' : null);
    let value = key ? src[key] : w.text;
    if (w.type === 'lowerThird' && (value == null || value === '') && !w.from) value = name;
    if (value == null || clean(value) === '') continue;
    if (w.type === 'price') {
      const p = parsePrice(value);
      if (!p) continue;
      items.push({ ...base, text: formatINR(p.value, { decimals: Number.isInteger(p.value) ? 0 : 2 }), ...(p.rest ? { sub: cap1(p.rest) } : {}) });
    } else if (w.type === 'counter') {
      const c = parseStat(value);
      if (!c) continue;
      items.push({ ...base, from: 0, to: c.to, ...(c.money ? { money: true } : {}), ...(c.suffix ? { suffix: c.suffix } : {}), ...(c.label || w.label ? { label: cap1(w.label || c.label) } : {}) });
    } else if (w.type === 'lowerThird') {
      const sub = w.sub ?? (key !== 'location' && location ? location : undefined);
      items.push({ ...base, title: clean(value), ...(sub ? { sub: clean(sub) } : {}) });
    } else {
      items.push({ ...base, text: clean(value) });
    }
  }
  if (cta && (clean(phone) || clean(whatsapp) || clean(offer))) {
    const headline = clean(cta.text) || (clean(whatsapp) ? 'Message us on WhatsApp' : clean(phone) ? 'Call us today' : 'Book now');
    items.push({ type: 'cta', at: Math.max(0, D - 2.5), dur: Math.min(2.5, D), headline, ...(clean(offer) ? { offer: clean(offer) } : {}), ...(clean(phone) ? { phone: clean(phone) } : {}), ...(clean(whatsapp) ? { whatsapp: clean(whatsapp) } : {}), ...(cta.pos ? { pos: cta.pos } : {}) });
  }
  return items.sort((p, q) => p.at - q.at);
}
