// Studio voiceover, one line at a time:
//   makeLine   — a script line → a local audio file, through the platform's AI task runner (runTask, from the job engine)
//   checkLine  — listen back: transcribe what was actually said and compare it to the script (words, numbers, prices,
//                phone numbers, brand names, language), then check the audio itself (pace, long pauses, distortion, loudness)
//   pronunciations — a seller's own spellings for tricky names, applied before the line is spoken
// Model and voice ids always come in as parameters; sellers never see which service is behind a tier.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { run, probe, need } from './ff.js';

// the speech service's limit for one request (a line is far shorter; this is the hard stop)
const MAX_CHARS = 5000;
const MAX_AUDIO = 25 * 1024 * 1024;
export const LANGUAGES = { en: 'English', hi: 'Hindi', mr: 'Marathi', gu: 'Gujarati', bn: 'Bengali', ta: 'Tamil', te: 'Telugu', kn: 'Kannada', ml: 'Malayalam', pa: 'Punjabi', od: 'Odia', ur: 'Urdu' };
// 'hi-IN' / 'HI' / 'hindi' → 'hi'
export const langBase = (l) => { const s = String(l || '').toLowerCase(); const b = s.slice(0, 2); return LANGUAGES[b] ? b : Object.keys(LANGUAGES).find((k) => LANGUAGES[k].toLowerCase() === s) || (s ? b : ''); };

// ---------- pronunciation dictionary ----------
// a seller's saved map { "Mamaearth": "Mama-earth", "Ghee": "ghee" } → cleaned (bounded, no control characters)
export function cleanDictionary(dict) {
  const out = {};
  const strip = (s) => String(s ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  for (const [k, v] of Object.entries(dict && typeof dict === 'object' ? dict : {}).slice(0, 300)) {
    const name = strip(k).slice(0, 60), say = strip(v).slice(0, 80);
    if (name && say && name !== say && Object.keys(out).length < 200) out[name] = say;
  }
  return out;
}
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const wordRe = (name, flags = 'giu') => new RegExp(`(?<![\\p{L}\\p{N}])${esc(name)}(?![\\p{L}\\p{N}])`, flags);
// the text the voice actually reads: whole-word, case-insensitive swaps, longest names first ("Mamaearth Onion" before "Mamaearth")
export function applyPronunciations(text, dict) {
  let out = String(text ?? '');
  const entries = Object.entries(cleanDictionary(dict)).sort((a, b) => b[0].length - a[0].length);
  // placeholders first, so one swap's output is never swapped again
  const held = [];
  for (const [name, say] of entries) out = out.replace(wordRe(name), () => { held.push(say); return `\u0001${held.length - 1}\u0002`; });
  return out.replace(/\u0001(\d+)\u0002/g, (_, i) => held[i]);
}

// ---------- making a line ----------
// the task input for a text-to-speech model: text and voice plus the usual delivery settings. language_code only on
// request — some models refuse it outright.
export function ttsInput({ text, voice, lang, stability = 0.5, similarity = 0.75, style = 0, speed = 1, before = '', after = '', enforceLanguage = false }) {
  const input = { text, stability, similarity_boost: similarity, style, speed: Math.min(1.2, Math.max(0.7, Number(speed) || 1)) };
  if (voice) input.voice = voice;
  // the lines either side keep the delivery continuous when a script is spoken line by line
  if (before) input.previous_text = String(before).slice(-MAX_CHARS);
  if (after) input.next_text = String(after).slice(0, MAX_CHARS);
  if (enforceLanguage && langBase(lang)) input.language_code = langBase(lang);
  return input;
}
// what kind of audio a buffer holds, from its first bytes → file extension (or null)
export function audioExt(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf.toString('latin1', 0, 3) === 'ID3' || (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0)) return 'mp3';
  if (buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WAVE') return 'wav';
  if (buf.toString('latin1', 0, 4) === 'OggS') return 'ogg';
  if (buf.toString('latin1', 0, 4) === 'fLaC') return 'flac';
  if (buf.toString('latin1', 4, 8) === 'ftyp') return 'm4a';
  return null;
}
export const studioTmp = (dir) => { const d = dir || path.join(os.tmpdir(), 'funnelhive-studio'); fs.mkdirSync(d, { recursive: true }); return d; };
const newName = (prefix, ext) => `${prefix}-${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}.${ext}`;

// { text, lang, voice, model, dict?, settings?, outDir? } → local audio file path.
// runTask({ model, input, timeoutMs }) → { urls, raw } is the job engine's; onUsage({ kind, model, chars }) records what was spent.
export async function makeLine({ text, lang, voice, model, dict, settings = {}, outDir, timeoutMs = 120000 }, { runTask, download = fetch, onUsage } = {}) {
  if (typeof runTask !== 'function') throw new Error('Voiceovers aren’t switched on yet');
  if (!model) throw new Error('No voice tier was chosen');
  const spoken = applyPronunciations(String(text ?? '').replace(/\s+/g, ' ').trim(), dict);
  if (!spoken) throw new Error('Write the line you want spoken');
  if (spoken.length > MAX_CHARS) throw new Error('This line is too long — split it into shorter lines');
  const { urls } = await runTask({ model, input: ttsInput({ ...settings, text: spoken, voice, lang }), timeoutMs });
  const url = urls?.[0];
  if (!/^https?:\/\//.test(url || '')) throw new Error('The voiceover came back empty — please try again');
  const r = await download(url, { signal: AbortSignal.timeout(60000) });
  const buf = Buffer.from(await r.arrayBuffer());
  if (!r.ok || !buf.length) throw new Error('Couldn’t download the voiceover');
  if (buf.length > MAX_AUDIO) throw new Error('The voiceover came back too large');
  const ext = audioExt(buf);
  if (!ext) throw new Error('The voiceover came back as something that isn’t audio');
  const file = path.join(studioTmp(outDir), newName('vo', ext));
  fs.writeFileSync(file, buf);
  onUsage?.({ kind: 'voice', model, chars: spoken.length });
  return file;
}

// ---------- listening back: the words ----------
const ONES = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19 };
const TENS = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
const SCALES = { hundred: 100, thousand: 1e3, lakh: 1e5, lakhs: 1e5, lac: 1e5, crore: 1e7, crores: 1e7, million: 1e6 };
const CURRENCY = new Set(['₹', 'rs', 'inr', 'rupee', 'rupees', 'rupaye', 'rupay', 'रुपये', 'रुपए', 'रुपया', 'रु']);
const FILLERS = new Set(['um', 'uh', 'umm', 'uhh', 'hmm', 'ah', 'er', 'erm']);
const DEVA_DIGITS = /[०-९]/g;
const isNumWord = (w) => w in ONES || w in TENS || w in SCALES || w === 'double' || w === 'triple';

// a line of text → tokens { t, raw, kind: 'word'|'number'|'price'|'phone', v?, spelled? }
export function tokens(text) {
  const parts = String(text ?? '').normalize('NFC').replace(DEVA_DIGITS, (d) => String(d.charCodeAt(0) - 0x966))
    .replace(/₹/g, ' ₹ ').replace(/\b(rs|inr)\.?(?=\s*\d)/gi, ' ₹ ').replace(/(\d)\/-/g, '$1 ')
    .replace(/(\d),(?=\d)/g, '$1').replace(/(\p{L})-(\p{L})/gu, '$1 $2')
    .split(/\s+/).map((raw) => ({ raw, t: raw.toLowerCase().replace(/^[^\p{L}\p{N}₹]+|[^\p{L}\p{N}₹]+$/gu, '').replace(/[।॥]/g, '') }))
    .filter((x) => x.t);
  // number words → one number token ("four hundred ninety nine" → 499; "four nine nine" → 499, read digit by digit)
  const out = [];
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (/^\d+(\.\d+)?$/.test(p.t)) { out.push({ kind: 'number', t: p.t, v: p.t, raw: p.raw, parts: [p.t] }); continue; }
    if (!isNumWord(p.t) || p.t === 'double' && !(parts[i + 1]?.t in ONES)) { out.push({ kind: 'word', t: p.t, raw: p.raw }); continue; }
    let j = i; const run = [];
    while (j < parts.length && (isNumWord(parts[j].t) || (parts[j].t === 'and' && run.length && isNumWord(parts[j + 1]?.t || '')))) run.push(parts[j++]);
    const words = run.map((x) => x.t).filter((w) => w !== 'and');
    let v;
    // single digits one after another (with "double five"): a reading digit by digit
    if (words.length > 1 && words.every((w) => (w in ONES && ONES[w] < 10) || w === 'double' || w === 'triple')) {
      let s = '';
      for (let k = 0; k < words.length; k++) { const rep = words[k] === 'double' ? 2 : words[k] === 'triple' ? 3 : 0; if (rep) { s += String(ONES[words[++k]] ?? '').repeat(rep); } else s += ONES[words[k]]; }
      out.push({ kind: 'number', t: s, v: s, raw: run.map((x) => x.raw).join(' '), parts: s.split(''), spelled: true });
    } else {
      let total = 0, cur = 0;
      for (const w of words) {
        if (w in ONES) cur += ONES[w]; else if (w in TENS) cur += TENS[w];
        else if (w === 'hundred') cur = (cur || 1) * 100; else if (w in SCALES) { total += (cur || 1) * SCALES[w]; cur = 0; }
      }
      v = String(total + cur);
      out.push({ kind: 'number', t: v, v, raw: run.map((x) => x.raw).join(' '), parts: [v] });
    }
    i = j - 1;
  }
  // numbers side by side are one number ("98765 43210", "4 9 9"); a currency word next to one makes it a price
  const merged = [];
  for (const tk of out) {
    const last = merged[merged.length - 1];
    if (tk.kind === 'number' && last?.kind === 'number' && !last.v.includes('.') && !tk.v.includes('.')) {
      last.v += tk.v; last.t = last.v; last.raw += ` ${tk.raw}`; last.parts.push(...tk.parts); last.spelled = last.spelled || tk.spelled;
      continue;
    }
    merged.push(tk);
  }
  const final = [];
  for (let i = 0; i < merged.length; i++) {
    const tk = merged[i];
    if (tk.kind === 'word' && CURRENCY.has(tk.t) && merged[i + 1]?.kind === 'number') { const n = merged[++i]; final.push({ ...n, kind: 'price', raw: `${tk.raw} ${n.raw}` }); continue; }
    if (tk.kind === 'number' && merged[i + 1]?.kind === 'word' && CURRENCY.has(merged[i + 1].t)) { final.push({ ...tk, kind: 'price', raw: `${tk.raw} ${merged[++i].raw}` }); continue; }
    if (tk.kind === 'word' && tk.t === '₹') continue;
    // several single digits read out one by one is how a phone number sounds; 10+ digits is one whatever way it's said
    if (tk.kind === 'number' && tk.v.replace(/\D/g, '').length >= 10) tk.kind = 'phone';
    // "4 9 9" written as separate digits is a digit-by-digit reading too
    if (tk.kind === 'number' && tk.parts.length > 1 && tk.parts.every((p) => p.length === 1)) tk.spelled = true;
    final.push(tk);
  }
  return final;
}

// how alike two words are, 0..1 (edit distance over the longer length)
export function similarity(a, b) {
  if (a === b) return 1;
  const m = a.length, n = b.length;
  if (!m || !n) return 0;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return 1 - prev[n] / Math.max(m, n);
}
const isNum = (tk) => tk.kind !== 'word';
// do two tokens count as the same spoken word? numbers by value; words exactly, or nearly for longer words
// (speech-to-text spells "colour"/"color" its own way)
const same = (a, b) => (isNum(a) || isNum(b) ? isNum(a) && isNum(b) && a.v === b.v : a.t === b.t || (Math.min(a.t.length, b.t.length) >= 4 && similarity(a.t, b.t) >= 0.8));

// word-level alignment of the script against what was heard → [{ op: 'eq'|'sub'|'del'|'ins', s?, h? }]
export function align(script, heard) {
  const m = script.length, n = heard.length;
  const D = Array.from({ length: m + 1 }, (_, i) => { const r = new Array(n + 1).fill(0); r[0] = i; return r; });
  for (let j = 0; j <= n; j++) D[0][j] = j;
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) D[i][j] = Math.min(D[i - 1][j] + 1, D[i][j - 1] + 1, D[i - 1][j - 1] + (same(script[i - 1], heard[j - 1]) ? 0 : 1));
  const ops = [];
  let i = m, j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && D[i][j] === D[i - 1][j - 1] + (same(script[i - 1], heard[j - 1]) ? 0 : 1)) { ops.push({ op: same(script[i - 1], heard[j - 1]) ? 'eq' : 'sub', s: script[--i], h: heard[--j] }); continue; }
    if (i > 0 && D[i][j] === D[i - 1][j] + 1) { ops.push({ op: 'del', s: script[--i] }); continue; }
    ops.push({ op: 'ins', h: heard[--j] });
  }
  return ops.reverse();
}

const q = (s) => `“${s}”`;
const shown = (tk) => (tk.kind === 'price' ? `₹${tk.v}` : tk.kind === 'phone' ? tk.v : tk.raw.replace(/^[^\p{L}\p{N}₹]+|[^\p{L}\p{N}₹]+$/gu, ''));
// these mean the line has to be made again; the rest are worth a look
const SERIOUS = new Set(['number', 'price', 'phone', 'brand', 'missing', 'swapped', 'language', 'silent']);

// compare a script line with what was heard → { wer, issues }
export function compareWords(scriptText, heardText, { brands = [], dict = {} } = {}) {
  // a name spoken with the seller's own pronunciation and heard back that way is right, not a misread
  let heardFixed = String(heardText ?? '');
  for (const [name, say] of Object.entries(cleanDictionary(dict))) heardFixed = heardFixed.replace(wordRe(say), name);
  const S = tokens(scriptText), H = tokens(heardFixed);
  const ops = align(S, H);
  const errors = ops.filter((o) => o.op !== 'eq').length;
  const wer = S.length ? Math.min(1, errors / S.length) : (H.length ? 1 : 0);
  const issues = [];
  const used = new Set();

  // swapped neighbours: "free fast" heard as "fast free"
  for (let k = 0; k + 1 < ops.length; k++) {
    const a = ops[k], b = ops[k + 1];
    if (a.op === 'sub' && b.op === 'sub' && same(a.s, b.h) && same(b.s, a.h)) { issues.push({ kind: 'swapped', detail: `${q(shown(a.s))} and ${q(shown(b.s))} were said the wrong way round` }); used.add(a); used.add(b); k++; continue; }
    const c = ops[k + 2];
    // "fast and free" heard as "free and fast"
    if (c && a.op === 'sub' && b.op === 'eq' && c.op === 'sub' && same(a.s, c.h) && same(c.s, a.h)) { issues.push({ kind: 'swapped', detail: `${q(shown(a.s))} and ${q(shown(c.s))} were said the wrong way round` }); used.add(a); used.add(c); k += 2; continue; }
    if (c && ((a.op === 'del' && b.op === 'eq' && c.op === 'ins' && same(a.s, c.h)) || (a.op === 'ins' && b.op === 'eq' && c.op === 'del' && same(a.h, c.s)))) {
      const moved = a.s || a.h;
      issues.push({ kind: 'swapped', detail: `${q(shown(moved))} and ${q(shown(b.s))} were said the wrong way round` }); used.add(a); used.add(c); k += 2;
    }
  }
  // numbers, prices and phone numbers must come through exactly
  for (const o of ops) {
    if (used.has(o) || !o.s || !isNum(o.s)) continue;
    const s = o.s, label = s.kind === 'price' ? `₹${s.v}` : s.kind === 'phone' ? `The phone number ${s.raw}` : s.v;
    const kind = s.kind === 'price' ? 'price' : s.kind === 'phone' ? 'phone' : 'number';
    if (o.op === 'del') { issues.push({ kind, detail: `${label} wasn’t heard in the voiceover` }); used.add(o); continue; }
    // what was heard: digits tidied ("₹449"), spoken words as they came ("four forty nine")
    if (o.op === 'sub') { issues.push({ kind, detail: `${label} was read as ${q(isNum(o.h) && !/\p{L}/u.test(o.h.raw) ? shown(o.h) : o.h.raw)}` }); used.add(o); continue; }
    // a price read out digit by digit ("four nine nine") sounds wrong; phone numbers are meant to be read that way
    if (o.op === 'eq' && s.kind === 'price' && o.h.spelled && !s.spelled) { issues.push({ kind, detail: `${label} was read as ${q(o.h.raw)}` }); used.add(o); }
  }
  // brand and product names (and every name in the pronunciation list): heard as written, allowing for spacing
  const flat = (s) => tokens(s).map((t) => t.t).join('');
  const heardFlat = flat(heardFixed);
  const names = [...new Set([...brands, ...Object.keys(cleanDictionary(dict))].map((x) => String(x).trim()).filter(Boolean))];
  // a name's words (and words squeezed in beside them, "mama earth" for "Mamaearth") are judged as the name, not word by word
  const nameWords = new Set(names.flatMap((b) => tokens(b).map((t) => t.t)));
  ops.forEach((o, k) => {
    if (!o.s || !nameWords.has(o.s.t)) return;
    used.add(o);
    for (let z = k + 1; ops[z]?.op === 'ins'; z++) used.add(ops[z]);
    for (let z = k - 1; ops[z]?.op === 'ins'; z--) used.add(ops[z]);
  });
  for (const b of names) {
    if (!wordRe(b, 'iu').test(String(scriptText))) continue;
    const want = flat(b);
    if (!want || heardFlat.includes(want)) continue;
    // the closest stretch of what was heard, for the message
    let best = '', bestSim = 0;
    const words = H.map((t) => t.t);
    for (let a = 0; a < words.length; a++) for (let z = a + 1; z <= Math.min(words.length, a + 4); z++) { const sim = similarity(want, words.slice(a, z).join('')); if (sim > bestSim) { bestSim = sim; best = H.slice(a, z).map((t) => t.raw).join(' '); } }
    if (bestSim >= 0.92) continue;
    issues.push({ kind: 'brand', detail: best && bestSim >= 0.4 ? `${q(b)} sounded like ${q(best)} — add it to your pronunciation list` : `${q(b)} wasn’t heard clearly — add it to your pronunciation list` });
  }
  // the rest, grouped into runs: words left out, words added, words misread
  const runs = [];
  for (const o of ops) {
    if (o.op === 'eq' || used.has(o)) { runs.push(null); continue; }
    const last = runs[runs.length - 1];
    if (last && last.op === o.op) last.items.push(o); else runs.push({ op: o.op, items: [o] });
  }
  for (const r of runs.filter(Boolean)) {
    if (r.op === 'del') issues.push({ kind: 'missing', detail: `${q(r.items.map((o) => shown(o.s)).join(' '))} was left out` });
    else if (r.op === 'ins') {
      const words = r.items.map((o) => shown(o.h));
      if (words.every((w) => FILLERS.has(w.toLowerCase()))) issues.push({ kind: 'extra', detail: `There’s a stray ${q(words.join(' '))} in the voiceover` });
      else issues.push({ kind: 'extra', detail: `${q(words.join(' '))} was added — it isn’t in your script` });
    } else issues.push({ kind: 'misread', detail: `${q(r.items.map((o) => shown(o.s)).join(' '))} sounded like ${q(r.items.map((o) => shown(o.h)).join(' '))}` });
  }
  return { wer, issues };
}

// which writing system a text is mostly in → a language it suggests ('en' for Latin), or null
const SCRIPTS = [[0x0900, 0x097f, 'hi'], [0x0980, 0x09ff, 'bn'], [0x0a00, 0x0a7f, 'pa'], [0x0a80, 0x0aff, 'gu'], [0x0b00, 0x0b7f, 'od'], [0x0b80, 0x0bff, 'ta'], [0x0c00, 0x0c7f, 'te'], [0x0c80, 0x0cff, 'kn'], [0x0d00, 0x0d7f, 'ml'], [0x0600, 0x06ff, 'ur']];
function scriptOf(text) {
  const n = {};
  for (const ch of String(text)) {
    const c = ch.codePointAt(0);
    const k = (c >= 65 && c <= 90) || (c >= 97 && c <= 122) ? 'en' : SCRIPTS.find(([a, b]) => c >= a && c <= b)?.[2];
    if (k) n[k] = (n[k] || 0) + 1;
  }
  return Object.entries(n).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
}
// Devanagari is shared by Hindi and Marathi; by script alone they look alike
const sameScript = (a, b) => a === b || (['hi', 'mr'].includes(a) && ['hi', 'mr'].includes(b));

// ---------- listening back: the sound ----------
// one ffmpeg pass: silences, peaks/clipping and loudness → raw measurements
export async function measureAudio(file) {
  need('silencedetect', 'astats', 'ebur128');
  const { stderr } = await run(['-i', file, '-map', '0:a:0', '-af', 'silencedetect=noise=-38dB:d=0.5,astats=measure_perchannel=none,ebur128=peak=true', '-f', 'null', '-'], { what: 'The voiceover check' });
  const duration = probe(file).duration;
  const silences = [];
  for (const m of stderr.matchAll(/silence_(start|end): (-?[\d.]+)/g)) {
    if (m[1] === 'start') silences.push({ start: Math.max(0, Number(m[2])), end: duration });
    else if (silences.length) silences[silences.length - 1].end = Number(m[2]);
  }
  const overall = stderr.slice(stderr.lastIndexOf('Overall'));
  const num = (src, re) => { const m = re.exec(src); return m && Number.isFinite(Number(m[1])) ? Number(m[1]) : null; };
  const sum = stderr.slice(stderr.lastIndexOf('Summary:'));
  return {
    duration, silences,
    peakDb: num(overall, /Peak level dB:\s*(-?[\d.]+)/), peakCount: num(overall, /Peak count:\s*([\d.]+)/), flatFactor: num(overall, /Flat factor:\s*([\d.]+)/),
    lufs: num(sum, /I:\s*(-?[\d.]+)\s*LUFS/), truePeak: num(sum, /Peak:\s*(-?[\d.]+)\s*dBFS/),
  };
}
// natural speaking pace, words a second (ad voiceovers run brisk; below or above this sounds off)
export const PACE = { min: 1.7, max: 4.3 };
export const LONG_PAUSE = 0.8;

// the sound of a line, given the words heard with their timings → issues
export function soundIssues(m, words = []) {
  const issues = [];
  const timed = words.filter((w) => Number.isFinite(w.start) && Number.isFinite(w.end));
  if (m.lufs == null || m.lufs < -50) return [{ kind: 'silent', detail: 'No voice could be heard in this line' }];
  const first = timed.length ? timed[0].start : (m.silences[0]?.start < 0.05 ? m.silences[0].end : 0);
  const last = timed.length ? timed[timed.length - 1].end : (m.silences.at(-1)?.end >= m.duration - 0.05 ? m.silences.at(-1).start : m.duration);
  const inside = m.silences.filter((s) => s.start > first + 0.05 && s.end < last - 0.05);
  // pace over the time spent talking (long pauses don't count against it)
  const n = timed.length || words.length;
  const talk = Math.max(0.1, last - first - inside.filter((s) => s.end - s.start >= LONG_PAUSE).reduce((a, s) => a + s.end - s.start, 0));
  if (n >= 4) {
    const wps = n / talk;
    if (wps < PACE.min) issues.push({ kind: 'pace', detail: `The voice is slow (${wps.toFixed(1)} words a second) — it may drag` });
    else if (wps > PACE.max) issues.push({ kind: 'pace', detail: `The voice is rushed (${wps.toFixed(1)} words a second) — it may be hard to follow` });
  }
  for (const s of inside) {
    const len = s.end - s.start;
    if (len < LONG_PAUSE) continue;
    const before = [...timed].reverse().find((w) => w.end <= s.start + 0.1);
    issues.push({ kind: 'pause', detail: `There’s a ${len.toFixed(1)}-second pause${before ? ` after ${q(before.w)}` : ''}` });
  }
  if (first >= 1) issues.push({ kind: 'pause', detail: `The line starts with ${first.toFixed(1)} seconds of silence` });
  // hard clipping: the waveform sits flat at full scale for many samples
  if (m.peakDb != null && m.peakDb > -0.1 && ((m.peakCount ?? 0) > 50 || (m.flatFactor ?? 0) > 1)) issues.push({ kind: 'clipping', detail: 'The voice sounds distorted in places (it’s too loud and clips)' });
  if (m.lufs < -30) issues.push({ kind: 'loudness', detail: 'The voice is very quiet' });
  return issues;
}

// listen back: { text, file, lang, brands?, dict? } with transcribe(file, lang) → { text, words: [{ w, start, end }], language? }
// → { ok, score, issues: [{ kind, detail }], heard, wer, measured }
export async function checkLine({ text, file, lang, brands = [], dict = {} }, { transcribe } = {}) {
  if (typeof transcribe !== 'function') throw new Error('The voiceover check isn’t switched on yet');
  const [heard, measured] = await Promise.all([transcribe(file, lang), measureAudio(file)]);
  const heardText = String(heard?.text ?? (heard?.words || []).map((w) => w.w).join(' '));
  const words = Array.isArray(heard?.words) ? heard.words : [];
  const { wer, issues } = compareWords(text, heardText, { brands, dict });
  // wrong language: the transcriber says so, or what came back is in another script — and little of the line matched
  const want = langBase(lang), saidLang = langBase(heard?.language), saidScript = scriptOf(heardText), scriptScript = scriptOf(text);
  if (want && wer > 0.5 && ((saidLang && saidLang !== want) || (saidScript && scriptScript && !sameScript(saidScript, scriptScript)))) {
    const other = LANGUAGES[saidLang] || (saidScript && LANGUAGES[saidScript]);
    issues.unshift({ kind: 'language', detail: other && other !== LANGUAGES[want] ? `The voice spoke ${other}, not ${LANGUAGES[want] || 'the script’s language'}` : `The voice didn’t speak ${LANGUAGES[want] || 'the script’s language'}` });
  }
  issues.push(...soundIssues(measured, words.length ? words : heardText.split(/\s+/).filter(Boolean).map((w) => ({ w }))));
  const serious = issues.filter((i) => SERIOUS.has(i.kind)).length;
  const minor = issues.length - serious;
  const score = Math.max(0, Math.min(100, Math.round(100 * (1 - wer) - 15 * serious - 4 * minor)));
  return { ok: !serious && wer <= 0.15, score, issues, heard: heardText, wer: Math.round(wer * 1000) / 1000, measured };
}

// ---------- a real transcriber (speech-to-text with word timings) ----------
// Swappable: anything with the same shape — transcribe(file, lang) → { text, words: [{ w, start, end }], language } — works.
// Uses the platform's key (env SARVAM_API_KEY); the quick endpoint takes about 30 seconds of audio, which a line fits.
export function sarvamTranscriber({ key = process.env.SARVAM_API_KEY, base = process.env.SARVAM_BASE_URL || 'https://api.sarvam.ai', model = process.env.SARVAM_STT_MODEL || 'saarika:v2.5', fetchImpl = fetch } = {}) {
  return async function transcribe(file, lang) {
    if (!key) throw new Error('The voiceover check isn’t switched on yet');
    const buf = fs.readFileSync(file);
    const ext = path.extname(file).slice(1).toLowerCase();
    const mime = { mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', flac: 'audio/flac', m4a: 'audio/mp4' }[ext] || 'application/octet-stream';
    const form = new FormData();
    form.append('file', new Blob([buf], { type: mime }), path.basename(file));
    form.append('model', model);
    const b = langBase(lang);
    form.append('language_code', LANGUAGES[b] ? `${b}-IN` : 'unknown');
    form.append('with_timestamps', 'true');
    let r;
    try { r = await fetchImpl(`${String(base).replace(/\/+$/, '')}/speech-to-text`, { method: 'POST', headers: { 'api-subscription-key': key }, body: form, signal: AbortSignal.timeout(60000) }); } catch { throw new Error('The voiceover check couldn’t run — try again in a minute'); }
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error('The voiceover check couldn’t run'), { detail: JSON.stringify(d).slice(0, 300), status: r.status });
    return { text: String(d.transcript || '').trim(), words: wordTimings(d.timestamps), language: d.language_code || '' };
  };
}
// the service times chunks (a word or a few); split each into words and share its time out by length
export function wordTimings(ts) {
  const list = ts?.words || [], st = ts?.start_time_seconds || [], en = ts?.end_time_seconds || [];
  const out = [];
  list.forEach((chunk, i) => {
    const ws = String(chunk).split(/\s+/).filter(Boolean);
    const a = Number(st[i]), z = Number(en[i]);
    if (!ws.length || !Number.isFinite(a) || !Number.isFinite(z)) return;
    const total = ws.reduce((s, w) => s + w.length, 0) || 1;
    let t = a;
    for (const w of ws) { const d = ((z - a) * w.length) / total; out.push({ w, start: Math.round(t * 1000) / 1000, end: Math.round((t + d) * 1000) / 1000 }); t += d; }
  });
  return out;
}
export const transcribe = (file, lang) => sarvamTranscriber()(file, lang);
