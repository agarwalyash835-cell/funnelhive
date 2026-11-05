// Studio captions: an ASS subtitle file built from what was actually said (the transcript's word timings, not the
// script — so captions land on the beat even when the voice ad-libs or pauses). Word-by-word or phrase by phrase, in a
// few looks, kept inside the area Reels/Shorts leave clear of their own buttons and readable over any picture
// (thick outline or a box behind the text).
import fs from 'node:fs';
import { SAFE, minCaption } from './standard.js';

// ASS colours are &HAABBGGRR (alpha 00 = solid)
export function assColour(hex, alpha = 0) {
  const h = String(hex || '#ffffff').replace('#', '').padEnd(6, 'f').slice(0, 6);
  const a = Math.round(Math.max(0, Math.min(1, alpha)) * 255).toString(16).padStart(2, '0');
  return `&H${a}${h.slice(4, 6)}${h.slice(2, 4)}${h.slice(0, 2)}`.toUpperCase();
}

// The safe area in pixels, from the Creative Standard's zones (standard.js SAFE): Reels/Shorts cover the top ~14%
// (account bar), the bottom ~25% (caption, music, buttons) and a strip on the right (like/share buttons). Square and
// landscape frames have no overlay, just a margin.
export function safeArea(width, height) {
  const z = height / width > 1.4 ? SAFE.vertical : SAFE.flat;
  return { top: Math.round(height * z.top), bottom: Math.round(height * z.bottom), left: Math.round(width * z.left), right: Math.round(width * z.right) };
}

// The looks. size is a fraction of the frame's shorter side; y is where the text sits (fraction of the frame height,
// clamped to the safe area). mode: 'word' (one word at a time) or 'phrase'.
export const PRESETS = {
  // the Reels look: two or three big bold words at a time, the one being spoken in the highlight colour with a small
  // pop, in the lower third (clear of the product in the middle of the frame)
  pop: { label: 'Bold pop', mode: 'phrase', pop: true, size: 0.088, bold: true, upper: true, colour: '#ffffff', highlight: '#ffd400', outline: 0.1, shadow: 0.03, box: false, y: 0.72, maxWords: 3 },
  // a calm phrase in a soft box, low on the screen
  lower: { label: 'Clean lower-third', mode: 'phrase', size: 0.056, bold: true, upper: false, colour: '#ffffff', highlight: '#ffffff', outline: 0.25, shadow: 0, box: true, boxColour: '#000000', boxAlpha: 0.45, y: 0.78, maxWords: 6 },
  // the phrase is shown whole and each word lights up as it's spoken
  karaoke: { label: 'Karaoke highlight', mode: 'phrase', size: 0.075, bold: true, upper: false, colour: '#ffffff', highlight: '#22d3ee', outline: 0.08, shadow: 0.02, box: false, y: 0.66, maxWords: 4, karaoke: true },
  // small and quiet, for videos where the picture carries the message
  minimal: { label: 'Minimal', mode: 'phrase', size: 0.045, bold: false, upper: false, colour: '#ffffff', highlight: '#ffffff', outline: 0.06, shadow: 0.03, box: false, y: 0.8, maxWords: 7 },
  // the house look: left-aligned, bone white with the spoken word in muted mustard (no neon, no box), a thin charcoal
  // edge and a soft shadow instead of a hard black outline; bold, two or three words that pop as they're said
  matte: { label: 'Matte left', mode: 'phrase', pop: true, size: 0.082, bold: true, upper: true, colour: '#ede8e0', highlight: '#c9a13b', outline: 0.05, outlineColour: '#1e1e1c', shadow: 0.04, box: false, y: 0.7, maxWords: 3, align: 'left' },
};
// ASS alignment on the bottom row: 1 left, 2 centre, 3 right
const ALIGN = { left: 1, center: 2, right: 3 };

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
// h:mm:ss.cc
export function assTime(s) {
  const cs = Math.max(0, Math.round(s * 100));
  const h = Math.floor(cs / 360000), m = Math.floor(cs / 6000) % 60, sec = Math.floor(cs / 100) % 60, c = cs % 100;
  return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}.${String(c).padStart(2, '0')}`;
}
// text that's safe inside an ASS event: no override blocks, no hard line breaks
const clean = (s) => String(s ?? '').replace(/[{}]/g, '').replace(/\\/g, '').replace(/\s+/g, ' ').trim();
const isNumberish = (w) => /\d|₹/.test(w);

// a word as shown: without the punctuation that ends it (phrases still break on it)
const bare = (w) => String(w).replace(/[,.;:!?।]+$/u, '') || w;

// split timed words into caption phrases: a phrase ends at a pause, at the end of a sentence, or when it's full
export function phrases(words, { maxWords = 5, maxChars = 28, gap = 0.35 } = {}) {
  const out = [];
  let cur = [];
  const flush = () => { if (cur.length) out.push(cur); cur = []; };
  words.forEach((w, i) => {
    const next = words[i + 1];
    cur.push(w);
    const chars = cur.map((x) => x.w).join(' ').length;
    if (!next || cur.length >= maxWords || chars >= maxChars || /[.!?।,;:]$/.test(w.w) || next.start - w.end > gap) flush();
  });
  flush();
  return out;
}

// where a look's captions land in a frame — the Creative Standard's free fixes applied: never smaller than the
// readable minimum (standard.js), and the block (two lines at most) moved inside the safe area.
// → { size, marginV (bottom edge from the frame's bottom), top, bottom (px from the frame's top), moved, enlarged }
export function captionPlace(look, width, height) {
  const P = typeof look === 'string' ? PRESETS[look] || PRESETS.pop : look;
  const short = Math.min(width, height), min = minCaption(width, height);
  const size = Math.round(short * Math.max(P.size, min));
  const safe = safeArea(width, height), want = Math.round(height * (1 - P.y));
  // the line's bottom edge, bottom-aligned, kept between the safe top and bottom
  const marginV = clamp(want, safe.bottom, height - safe.top - size * 2);
  return { size, marginV, top: height - marginV - size * 2, bottom: height - marginV, moved: marginV !== want, enlarged: P.size < min };
}

// words [{ w, start, end }] → the text of an .ass file
// opts: { style ('pop'|'lower'|'karaoke'|'minimal'|'matte'), mode?, width, height, font, colour?, highlight?, upper?,
// y? (0–1 down the frame; kept inside the safe area by captionPlace), align? ('left'|'center'; left sits at the safe
// area's left margin), offset (s) }
export function buildAss(words, { style = 'pop', mode, width = 1080, height = 1920, font = 'Noto Sans', colour, highlight, upper, y, align, offset = 0 } = {}) {
  const P = { ...(PRESETS[style] || PRESETS.pop) };
  if (colour) P.colour = colour;
  if (highlight) P.highlight = highlight;
  if (upper != null) P.upper = !!upper;
  if (Number.isFinite(Number(y)) && y !== null && y !== '') P.y = clamp(Number(y), 0, 1);
  if (align === 'left' || align === 'center') P.align = align;
  const m = mode || P.mode;
  const list = (words || []).map((w) => ({ w: clean(w.w), start: Number(w.start) + offset, end: Number(w.end) + offset })).filter((w) => w.w && Number.isFinite(w.start) && Number.isFinite(w.end) && w.end >= w.start);
  const { size, marginV } = captionPlace(P, width, height);
  const safe = safeArea(width, height);
  const outline = P.box ? Math.max(6, Math.round(size * P.outline)) : Math.max(2, Math.round(size * P.outline));
  const shadow = Math.round(size * P.shadow);
  // BorderStyle 3 = an opaque box behind the text (OutlineColour fills it); 1 = outline + shadow
  const outlineColour = P.box ? assColour(P.boxColour, P.boxAlpha) : assColour(P.outlineColour || '#000000', 0);
  const style0 = ['Main', font, size, assColour(P.karaoke ? P.highlight : P.colour), assColour(P.karaoke ? P.colour : P.highlight), outlineColour, assColour(P.outlineColour || '#000000', 0.4), P.bold ? -1 : 0, 0, 0, 0, 100, 100, 0, 0, P.box ? 3 : 1, outline, shadow, ALIGN[P.align] || 2, safe.left, safe.right, marginV, 1];
  const head = [
    '[Script Info]', 'ScriptType: v4.00+', `PlayResX: ${width}`, `PlayResY: ${height}`, 'WrapStyle: 0', 'ScaledBorderAndShadow: yes', 'YCbCr Matrix: TV.709', '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    `Style: ${style0.join(',')}`, '',
    '[Events]', 'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ];
  const up = (s) => (P.upper ? s.toLocaleUpperCase() : s);
  const hi = assColour(P.highlight);
  const events = [];
  const ev = (a, b, text) => events.push(`Dialogue: 0,${assTime(a)},${assTime(b)},Main,,0,0,0,,${text}`);
  if (m === 'word') {
    list.forEach((w, i) => {
      // hold each word until the next one starts (no flicker between words), but not across a long pause
      const next = list[i + 1];
      const end = next && next.start - w.end < 0.6 ? next.start : Math.max(w.end, w.start + 0.25);
      const colourTag = isNumberish(w.w) ? `\\c${hi}` : '';
      ev(w.start, end, `{\\fscx82\\fscy82\\t(0,90,\\fscx108\\fscy108)\\t(90,160,\\fscx100\\fscy100)${colourTag}}${up(w.w)}`);
    });
  } else {
    const groups = phrases(list, { maxWords: P.maxWords || 5, maxChars: Math.max(14, Math.round(((width - safe.left - safe.right) / (size * 0.55)) * 1.6)) });
    groups.forEach((g, i) => {
      const start = g[0].start, next = groups[i + 1];
      const end = next && next[0].start - g[g.length - 1].end < 0.6 ? next[0].start : g[g.length - 1].end + 0.3;
      if (P.pop) {
        // the phrase stays put; each word lights up (and pops) while it's spoken
        g.forEach((w, k) => {
          const until = k + 1 < g.length ? g[k + 1].start : end;
          const text = g.map((x, j) => (j === k ? `{\\c${hi}\\fscx112\\fscy112\\t(0,120,\\fscx100\\fscy100)}${up(bare(x.w))}{\\c${assColour(P.colour)}\\fscx100\\fscy100}` : up(bare(x.w)))).join(' ');
          ev(k ? w.start : start, until, text);
        });
      } else if (P.karaoke) {
        // \k counts in centiseconds: each word's highlight runs from its start to the next word's start
        let t = start;
        const parts = g.map((w, k) => {
          const until = k + 1 < g.length ? g[k + 1].start : w.end;
          const lead = Math.max(0, Math.round((w.start - t) * 100));
          const dur = Math.max(1, Math.round((until - w.start) * 100));
          t = until;
          return `${lead ? `{\\k${lead}}` : ''}{\\k${dur}}${up(w.w)}`;
        });
        ev(start, end, `{\\fad(60,60)}${parts.join(' ')}`);
      } else {
        ev(start, end, `{\\fad(80,80)}${g.map((w) => (isNumberish(w.w) && P.highlight !== P.colour ? `{\\c${hi}}${up(w.w)}{\\c${assColour(P.colour)}}` : up(w.w))).join(' ')}`);
      }
    });
  }
  return `${[...head, ...events].join('\n')}\n`;
}

// write the captions next to the render; → the file path
export function writeAss(words, file, opts) {
  fs.writeFileSync(file, buildAss(words, opts), 'utf8');
  return file;
}
