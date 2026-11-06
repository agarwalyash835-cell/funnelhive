// Reel effects: the moves a short-form editor makes by hand, as small steps on local files.
//   cutting  — jump cuts that drop pauses and "um"s, punch-ins on the words that matter
//   sound    — whooshes, risers, pops and impacts made from scratch (no sample files), beat finding, snapping to beats
//   motion   — speed ramps, transitions, b-roll over a talking head, split screens, a wipe reveal, auto-reframe to 9:16
// Every ffmpeg step takes local files, writes `out` and returns it; the planning parts are pure and tested on their own.
import fs from 'node:fs';
import path from 'node:path';
import { run, probe, need } from './ff.js';
import { studioTmp } from './voice.js';

const threads = () => (process.env.STUDIO_FF_THREADS ? ['-threads', String(process.env.STUDIO_FF_THREADS)] : []);
// same encode as the editor's other steps: a low CRF so passes stacked on each other don't pile up blocks
const venc = ({ fps = 30, crf = 16 } = {}) => ['-c:v', 'libx264', '-preset', process.env.STUDIO_X264_PRESET || 'veryfast', '-crf', String(crf), '-pix_fmt', 'yuv420p', '-r', String(fps), ...threads()];
const tmpFile = (name, ext) => path.join(studioTmp(), `${name}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}.${ext}`);
const even = (n) => Math.max(2, Math.round(n / 2) * 2);
const s3 = (x) => Number(x).toFixed(3);
// fill a w×h frame, cutting the edges; a little above centre (faces and products are rarely at the very bottom)
const cropFit = (w, h) => `scale=${w}:${h}:force_original_aspect_ratio=increase:flags=lanczos,crop=${w}:${h}:(iw-${w})/2:(ih-${h})*0.4,setsar=1`;
// the same frame, framed `k` times tighter (an editor's punch-in)
const tighter = (w, h, k) => `scale=${even(w * k)}:${even(h * k)}:flags=lanczos,crop=${w}:${h}:(iw-${w})/2:(ih-${h})*0.4,setsar=1`;

// ───────────────────────────── cutting ─────────────────────────────

// sounds that aren't words — cut out of a talking head (English and Hindi hesitations)
const FILLERS = new Set(['um', 'umm', 'ummm', 'uh', 'uhh', 'uhm', 'hmm', 'hm', 'mm', 'ah', 'ahh', 'er', 'erm', 'उम्म', 'उम', 'अं', 'हम्म'].map((w) => w.normalize('NFC')));
const bare = (w) => String(w ?? '').normalize('NFC').toLowerCase().replace(/[^\p{L}\p{M}\p{N}₹%]+/gu, '');
export const isFiller = (w) => FILLERS.has(bare(w));

// words [{ w, start, end }] → { keep: [{ start, end }], removed: seconds }
// Speech is kept; a pause longer than maxGap and every filler word are cut. Each kept piece gets `pad` either side (so
// a word's first and last sounds aren't clipped) but never reaches into the word or filler beside it.
export function jumpCutPlan(words, { duration, maxGap = 0.35, pad = 0.08, fillers = true, minKeep = 0.25 } = {}) {
  const ws = (words || []).filter((w) => Number.isFinite(w?.start) && Number.isFinite(w?.end) && w.end >= w.start).sort((a, b) => a.start - b.start);
  const total = Number(duration) > 0 ? Number(duration) : (ws.at(-1)?.end || 0) + pad;
  if (!ws.length) return { keep: total > 0 ? [{ start: 0, end: total }] : [], removed: 0 };
  // runs of kept words with no long pause and no filler between them
  const groups = [];
  let cur = null;
  ws.forEach((w, i) => {
    if (fillers && isFiller(w.w)) { cur = null; return; }
    const prev = ws[i - 1];
    if (cur && prev && cur.last === i - 1 && w.start - prev.end <= maxGap) { cur.end = w.end; cur.last = i; return; }
    cur = { start: w.start, end: w.end, first: i, last: i };
    groups.push(cur);
  });
  let keep = groups.map((g) => {
    const lo = g.first > 0 ? ws[g.first - 1].end : 0, hi = g.last < ws.length - 1 ? ws[g.last + 1].start : total;
    let s = Math.max(lo, g.start - pad, 0), e = Math.min(hi, g.end + pad, total);
    // a flash of a piece looks like a glitch: widen it to minKeep where there's room
    if (e - s < minKeep) { const c = (s + e) / 2; s = Math.max(lo, 0, c - minKeep / 2); e = Math.min(hi, total, s + minKeep); }
    return { start: s, end: e };
  }).filter((k) => k.end > k.start);
  // overlapping or touching pieces → one
  keep = keep.reduce((out, k) => { const l = out.at(-1); if (l && k.start <= l.end + 1e-3) l.end = Math.max(l.end, k.end); else out.push({ ...k }); return out; }, []);
  const kept = keep.reduce((t, k) => t + k.end - k.start, 0);
  return { keep: keep.map((k) => ({ start: +s3(k.start), end: +s3(k.end) })), removed: +s3(Math.max(0, total - kept)) };
}

// the words moved onto the cut timeline; a word in a removed part is dropped
export function remapWords(words, keep) {
  const out = [];
  for (const w of words || []) {
    const mid = (w.start + w.end) / 2;
    let at = 0;
    for (const k of keep) {
      if (mid >= k.start && mid <= k.end) {
        const m = (t) => at + Math.min(k.end - k.start, Math.max(0, t - k.start));
        out.push({ ...w, start: +s3(m(w.start)), end: +s3(m(w.end)) });
        break;
      }
      at += k.end - k.start;
    }
  }
  return out;
}

// a talking head cut down to the keep pieces (picture and sound), every other piece framed `punch` tighter so each jump
// cut reads as a deliberate change of shot rather than a skip. width/height: fit to that frame (cropped).
export async function cutTalkingHead(video, keep, out, { punch = 1.15, fps = 30, width, height } = {}) {
  const p = probe(video);
  if (!p.hasVideo) throw new Error('This clip has no picture');
  const ks = (keep || []).map((k) => ({ start: Math.max(0, k.start), end: Math.min(p.duration || Infinity, k.end) })).filter((k) => k.end - k.start > 0.02);
  if (!ks.length) throw new Error('Nothing is left to keep in this clip');
  const W = even(width || p.width), H = even(height || p.height);
  const n = ks.length;
  need('split', 'trim', 'setpts', 'concat', 'scale', 'crop', 'fps', ...(p.hasAudio ? ['asplit', 'atrim', 'asetpts', 'afade', 'aformat'] : []));
  const parts = [`[0:v]fps=${fps},${cropFit(W, H)},split=${n}${ks.map((_, i) => `[s${i}]`).join('')}`];
  ks.forEach((k, i) => parts.push(`[s${i}]trim=start=${s3(k.start)}:end=${s3(k.end)},setpts=PTS-STARTPTS${i % 2 && punch > 1 ? `,${tighter(W, H, punch)}` : ''}[v${i}]`));
  if (p.hasAudio) {
    parts.push(`[0:a]aformat=sample_rates=48000:channel_layouts=stereo,asplit=${n}${ks.map((_, i) => `[t${i}]`).join('')}`);
    // 10 ms fades at each cut: a waveform cut mid-cycle clicks
    ks.forEach((k, i) => { const len = k.end - k.start, f = Math.min(0.01, len / 4); parts.push(`[t${i}]atrim=start=${s3(k.start)}:end=${s3(k.end)},asetpts=PTS-STARTPTS,afade=t=in:d=${s3(f)},afade=t=out:st=${s3(len - f)}:d=${s3(f)}[a${i}]`); });
  }
  const ins = ks.map((_, i) => (p.hasAudio ? `[v${i}][a${i}]` : `[v${i}]`)).join('');
  parts.push(`${ins}concat=n=${n}:v=1:a=${p.hasAudio ? 1 : 0}[v]${p.hasAudio ? '[a]' : ''}`);
  await run(['-i', video, '-filter_complex', parts.join(';'), '-map', '[v]', ...(p.hasAudio ? ['-map', '[a]', '-c:a', 'aac', '-b:a', '192k'] : ['-an']), ...venc({ fps }), out]);
  return out;
}

// when the speaker leans on a word: numbers, prices, percentages, the seller's keywords, and anything shouted ('!').
// At least 1.2 s apart — punch-ins closer than that feel like shaking.
export function emphasisTimes(words, keywords = [], { gap = 1.2 } = {}) {
  const keys = new Set(keywords.map(bare).filter(Boolean));
  const out = [];
  for (const w of [...(words || [])].sort((a, b) => a.start - b.start)) {
    const raw = String(w.w ?? '');
    const hit = /[\d₹%०-९]/.test(raw) || /!\s*$/.test(raw) || keys.has(bare(raw));
    if (hit && (!out.length || w.start - out.at(-1) >= gap)) out.push(+s3(w.start));
  }
  return out;
}

// a zoom punch-in at each time for `hold` seconds (video only): the picture is split at the punches and the punched
// pieces are framed `zoom` tighter
export async function punchOnEmphasis(video, times, out, { zoom = 1.15, hold = 0.8, fps = 30 } = {}) {
  const p = probe(video);
  if (!p.hasVideo) throw new Error('This clip has no picture');
  const W = even(p.width), H = even(p.height), d = p.duration;
  const ts = [...new Set((times || []).filter((t) => t >= 0 && t < d - 0.05))].sort((a, b) => a - b);
  const segs = [];
  let at = 0;
  ts.forEach((t, i) => {
    if (t < at) return;
    const end = Math.min(t + hold, ts[i + 1] ?? d, d);
    if (t > at + 0.01) segs.push({ s: at, e: t, z: false });
    segs.push({ s: t, e: end, z: true });
    at = end;
  });
  if (at < d - 0.01) segs.push({ s: at, e: d, z: false });
  need('split', 'trim', 'setpts', 'concat', 'scale', 'crop', 'fps');
  const n = segs.length;
  const graph = [`[0:v]fps=${fps},scale=${W}:${H},setsar=1,split=${n}${segs.map((_, i) => `[s${i}]`).join('')}`,
    ...segs.map((g, i) => `[s${i}]trim=start=${s3(g.s)}${i < n - 1 ? `:end=${s3(g.e)}` : ''},setpts=PTS-STARTPTS${g.z ? `,${tighter(W, H, zoom)}` : ''}[v${i}]`),
    `${segs.map((_, i) => `[v${i}]`).join('')}concat=n=${n}:v=1:a=0[v]`].join(';');
  await run(['-i', video, '-filter_complex', graph, '-map', '[v]', '-an', ...venc({ fps }), out]);
  return out;
}

// ───────────────────────────── sound ─────────────────────────────

export const SFX_KINDS = ['whoosh', 'riser', 'pop', 'impact'];
// how long each sound is, and where its "moment" sits: a riser builds up to the event, a whoosh swells through it
export const SFX_LEN = { whoosh: 0.6, riser: 1.2, pop: 0.08, impact: 0.4 };
const SFX_FILTERS = { whoosh: ['anoisesrc', 'highpass', 'lowpass', 'afade'], riser: ['aevalsrc', 'afade'], pop: ['aevalsrc'], impact: ['aevalsrc', 'lowpass'] };
// a lavfi source chain that makes the sound from scratch (48 kHz stereo)
export function sfxFilter(kind) {
  const fmt = 'aformat=sample_rates=48000:channel_layouts=stereo';
  switch (kind) {
    // pink noise through a band, swelling in and falling away
    case 'whoosh': return `anoisesrc=color=pink:duration=0.6:amplitude=0.8:seed=11:sample_rate=48000,highpass=f=500,lowpass=f=5000,afade=t=in:d=0.3:curve=exp,afade=t=out:st=0.3:d=0.3:curve=exp,${fmt}`;
    // a sine sweeping 200 → 1000 Hz (phase is the integral of the rising pitch), getting louder up to the event
    case 'riser': return `aevalsrc=exprs='0.6*(t/1.2)*sin(2*PI*(200*t+800*t*t*t/3.6))':d=1.2:s=48000,afade=t=out:st=1.17:d=0.03,${fmt}`;
    // an 80 ms blip with a fast decay
    case 'pop': return `aevalsrc=exprs='0.9*sin(2*PI*(1100-500*t/0.08)*t)*exp(-45*t)':d=0.08:s=48000,${fmt}`;
    // a 55 Hz thump with a short burst of noise on the front (the "hit")
    case 'impact': return `aevalsrc=exprs='0.95*sin(2*PI*55*t)*exp(-7*t)+0.5*(2*random(0)-1)*exp(-60*t)':d=0.4:s=48000,lowpass=f=2500,${fmt}`;
    default: throw new Error(`There’s no “${kind}” sound effect`);
  }
}
// where a sound starts so its moment lands on `at`
const sfxStart = (kind, at) => (kind === 'riser' ? at - SFX_LEN.riser : kind === 'whoosh' ? at - SFX_LEN.whoosh / 2 : at);

// events [{ kind, at }] mixed into `audio` (or onto silence `duration` long when audio is null) → a 48 kHz stereo wav
export async function addSfx(audio, events, out, { gainDb = -14, duration } = {}) {
  const len = Number(duration) > 0 ? Number(duration) : audio ? probe(audio).duration : 0;
  if (!(len > 0)) throw new Error('The sound effects need a length');
  const evs = (events || []).filter((e) => SFX_KINDS.includes(e?.kind) && e.at >= 0 && e.at < len).sort((a, b) => a.at - b.at).slice(0, 24);
  need('amix', 'adelay', 'atrim', 'asetpts', 'volume', 'asplit', 'apad', 'aformat', ...(audio ? [] : ['anullsrc']), ...new Set(evs.flatMap((e) => SFX_FILTERS[e.kind])));
  const fmt = 'aformat=sample_rates=48000:channel_layouts=stereo';
  const args = audio ? ['-i', audio] : ['-f', 'lavfi', '-t', s3(len), '-i', 'anullsrc=r=48000:cl=stereo'];
  const graph = [`[0:a]${fmt},apad[base]`];
  // one source per kind, split to each of its events
  const kinds = [...new Set(evs.map((e) => e.kind))];
  kinds.forEach((k, j) => {
    args.push('-f', 'lavfi', '-i', sfxFilter(k));
    const mine = evs.filter((e) => e.kind === k);
    graph.push(`[${j + 1}:a]volume=${gainDb}dB,asplit=${mine.length}${mine.map((e) => `[k${evs.indexOf(e)}]`).join('')}`);
  });
  evs.forEach((e, i) => {
    const s = sfxStart(e.kind, e.at), skip = Math.max(0, -s), ms = Math.round(Math.max(0, s) * 1000);
    // a riser near the start loses its front, not its ending
    graph.push(`[k${i}]atrim=start=${s3(skip)},asetpts=PTS-STARTPTS,adelay=${ms}|${ms}[e${i}]`);
  });
  graph.push(`[base]${evs.map((_, i) => `[e${i}]`).join('')}amix=inputs=${evs.length + 1}:duration=first:normalize=0,atrim=0:${s3(len)}[a]`);
  await run([...args, '-filter_complex', graph.join(';'), '-map', '[a]', '-t', s3(len), '-ar', '48000', '-c:a', 'pcm_s16le', out]);
  return out;
}

// samples (mono, -1..1) at `rate` → { bpm, beats: [s…] }. An energy-onset envelope at 10 ms steps, its autocorrelation
// over 70–180 BPM for the tempo, and the beat phase that lands on the most onset energy. Pure and deterministic.
export function beatsFromSamples(samples, rate) {
  const hop = Math.max(1, Math.round(rate * 0.01)), hopS = hop / rate;
  const n = Math.floor(samples.length / hop);
  if (n < 20) return { bpm: 0, beats: [] };
  const env = new Float64Array(n);
  for (let i = 0; i < n; i++) { let e = 0; for (let j = i * hop, end = j + hop; j < end; j++) e += samples[j] * samples[j]; env[i] = Math.log(1e-6 + e / hop); }
  // onsets: where the energy jumps up (half-wave rectified difference)
  const on = new Float64Array(n);
  for (let i = 1; i < n; i++) on[i] = Math.max(0, env[i] - env[i - 1]);
  const total = on.reduce((a, b) => a + b, 0);
  if (total < 1e-6) return { bpm: 0, beats: [] };
  const minLag = Math.max(1, Math.floor(60 / 180 / hopS)), maxLag = Math.min(n - 1, Math.ceil(60 / 70 / hopS));
  const ac = (lag) => { let s = 0; for (let i = 0; i + lag < n; i++) s += on[i] * on[i + lag]; return s / (n - lag); };
  let best = minLag, bestV = -1;
  const vals = {};
  for (let lag = minLag; lag <= maxLag; lag++) { vals[lag] = ac(lag); if (vals[lag] > bestV) { bestV = vals[lag]; best = lag; } }
  if (bestV <= 0) return { bpm: 0, beats: [] };
  // sub-step period from the peak's neighbours (a parabola through three points)
  let period = best;
  const a = vals[best - 1], c = vals[best + 1];
  if (a !== undefined && c !== undefined) { const den = a - 2 * bestV + c; if (den < 0) period = best + Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / den)); }
  // phase: the offset whose beat grid collects the most onset energy (±1 step of slack per beat)
  let phase = 0, phaseV = -1;
  for (let p = 0; p < best; p++) {
    let s = 0;
    for (let x = p; x < n; x += period) { const i = Math.round(x); s += Math.max(on[i] || 0, 0.5 * (on[i - 1] || 0), 0.5 * (on[i + 1] || 0)); }
    if (s > phaseV) { phaseV = s; phase = p; }
  }
  const beats = [];
  for (let x = phase; x < n; x += period) beats.push(+s3(x * hopS));
  return { bpm: +(60 / (period * hopS)).toFixed(1), beats };
}

// a music file's beat grid. ffmpeg decodes to raw mono 11 kHz PCM in a temp file (run() keeps only ffmpeg's report);
// the rest is plain JS.
export async function beatTimes(audioFile, { maxSeconds = 90 } = {}) {
  const raw = tmpFile('beats', 'pcm');
  try {
    await run(['-i', audioFile, '-t', String(maxSeconds), '-vn', '-ac', '1', '-ar', '11025', '-f', 's16le', '-c:a', 'pcm_s16le', raw], { what: 'The beat finder' });
    const buf = fs.readFileSync(raw);
    const s = new Float32Array(buf.length >> 1);
    for (let i = 0; i < s.length; i++) s[i] = buf.readInt16LE(i * 2) / 32768;
    return beatsFromSamples(s, 11025);
  } finally { fs.rm(raw, { force: true }, () => {}); }
}

// each time moved to the nearest beat within `tol` seconds (else left alone), still in increasing order
export function snapToBeats(times, beats, tol = 0.25) {
  const bs = [...(beats || [])].sort((a, b) => a - b);
  let prev = -Infinity;
  return (times || []).map((t) => {
    let lo = 0, hi = bs.length - 1;
    while (lo < hi) { const m = (lo + hi) >> 1; if (bs[m] < t) lo = m + 1; else hi = m; }
    const near = [bs[lo - 1], bs[lo]].filter((b) => b !== undefined).sort((a, b) => Math.abs(a - t) - Math.abs(b - t))[0];
    let v = near !== undefined && Math.abs(near - t) <= tol ? near : t;
    // two times snapping onto one beat: the later one keeps its own time (or sits just after)
    if (v <= prev) v = t > prev ? t : prev + 0.01;
    prev = v;
    return +s3(v);
  });
}

// ───────────────────────────── motion ─────────────────────────────

// a ramp's pieces over `len` seconds of source: speeds stepping 1 → speed, holding, then back. steps counts the levels
// from 1 to speed (3: 1, 0.75, 0.5); the ramps take half the stretch, the slowest speed the other half.
export function rampPlan(len, speed = 0.5, steps = 3) {
  const k = Math.max(0, Math.round(steps) - 2);
  const levels = Array.from({ length: k }, (_, i) => 1 - ((1 - speed) * (i + 1)) / (k + 1));
  if (!k) return [{ len, speed }];
  const r = (len * 0.25) / k;
  return [...levels.map((s) => ({ len: r, speed: s })), { len: len * 0.5, speed }, ...[...levels].reverse().map((s) => ({ len: r, speed: s }))];
}
export const rampExtra = (len, speed = 0.5, steps = 3) => rampPlan(len, speed, steps).reduce((t, p) => t + p.len * (1 / p.speed - 1), 0);

// the stretch from `at` slowed to `speed` with stepped easing in and out (video only; the result is longer)
export async function speedRamp(video, out, { at, len = 1.2, speed = 0.5, steps = 3, fps = 30 } = {}) {
  const p = probe(video);
  if (!p.hasVideo) throw new Error('This clip has no picture');
  const d = p.duration;
  const s0 = Math.max(0, Math.min(Number(at) || 0, d - 0.1)), L = Math.min(len, d - s0);
  const sp = Math.max(0.1, Math.min(1, speed));
  const pieces = [];
  if (s0 > 0.01) pieces.push({ s: 0, e: s0, speed: 1 });
  let x = s0;
  for (const r of rampPlan(L, sp, steps)) { pieces.push({ s: x, e: x + r.len, speed: r.speed }); x += r.len; }
  if (x < d - 0.01) pieces.push({ s: x, e: d, speed: 1 });
  need('split', 'trim', 'setpts', 'concat', 'fps');
  const n = pieces.length;
  const graph = [`[0:v]fps=${fps},setsar=1,split=${n}${pieces.map((_, i) => `[s${i}]`).join('')}`,
    ...pieces.map((g, i) => `[s${i}]trim=start=${s3(g.s)}${i < n - 1 ? `:end=${s3(g.e)}` : ''},setpts=(PTS-STARTPTS)/${g.speed.toFixed(4)}[v${i}]`),
    // fps after the join: a slowed piece has gaps between its frames, filled by repeating them
    `${pieces.map((_, i) => `[v${i}]`).join('')}concat=n=${n}:v=1:a=0,fps=${fps}[v]`].join(';');
  await run(['-i', video, '-filter_complex', graph, '-map', '[v]', '-an', ...venc({ fps }), out]);
  return out;
}

// the reel transitions as xfade names (null: a hard cut). whip is a horizontal smear (hblur), zoom punches through the
// cut (zoomin) — both in ffmpeg 5+; 'match' is a cut the editor lines up on movement, so it's a hard cut here
export const TRANSITIONS = { whip: 'hblur', zoom: 'zoomin', cut: null, dissolve: 'fade', match: null };
const MIXED = ['whip', 'zoom', 'cut'];
export function xfadeName(style, i = 0) {
  if (style === 'mixed') return TRANSITIONS[MIXED[((i % 3) + 3) % 3]];
  return style in TRANSITIONS ? TRANSITIONS[style] : 'fade';
}

// b-roll: inserts [{ file, at, len }] cover the main picture for those times (fitted to its frame); main's sound stays
export async function brollOver(main, inserts, out, { fps = 30 } = {}) {
  const p = probe(main);
  if (!p.hasVideo) throw new Error('The main clip has no picture');
  const W = even(p.width), H = even(p.height);
  const ins = (inserts || []).filter((x) => x?.file && x.at >= 0 && x.at < p.duration && x.len > 0);
  need('scale', 'crop', 'overlay', 'trim', 'setpts', 'tpad', 'fps');
  const graph = [`[0:v]fps=${fps},scale=${W}:${H},setsar=1,format=yuv420p[m0]`];
  ins.forEach((x, i) => {
    const len = Math.min(x.len, p.duration - x.at);
    // held on its last frame if it's shorter than its slot; moved to start at `at`
    graph.push(`[${i + 1}:v]fps=${fps},${cropFit(W, H)},format=yuv420p,tpad=stop_mode=clone:stop_duration=${s3(len)},trim=duration=${s3(len)},setpts=PTS-STARTPTS+${s3(x.at)}/TB[b${i}]`);
    graph.push(`[m${i}][b${i}]overlay=0:0:eof_action=pass:enable='between(t,${s3(x.at)},${s3(x.at + len)})'[m${i + 1}]`);
  });
  graph.push(`[m${ins.length}]null[v]`);
  await run(['-i', main, ...ins.flatMap((x) => ['-i', x.file]), '-filter_complex', graph.join(';'), '-map', '[v]', ...(p.hasAudio ? ['-map', '0:a:0', '-c:a', 'aac', '-b:a', '192k'] : ['-an']), '-t', s3(p.duration), ...venc({ fps }), out]);
  return out;
}

// two clips at once, each fitted to its half with a thin gap: top/bottom ('vertical') or side by side (video only)
export async function splitScreen(a, b, out, { layout = 'vertical', width = 1080, height = 1920, gap = 8, seconds, fps = 30 } = {}) {
  const W = even(width), H = even(height), g = Math.max(0, Math.round(gap / 2) * 2);
  const vert = layout !== 'horizontal';
  const [w1, h1] = vert ? [W, even((H - g) / 2)] : [even((W - g) / 2), H];
  const [w2, h2] = vert ? [W, H - g - h1] : [W - g - w1, H];
  const len = Number(seconds) > 0 ? Number(seconds) : Math.min(probe(a).duration || 0, probe(b).duration || 0);
  if (!(len > 0)) throw new Error('These clips have no length');
  need('scale', 'crop', 'pad', 'fps', vert ? 'vstack' : 'hstack');
  const graph = `[0:v]fps=${fps},${cropFit(w1, h1)},format=yuv420p,pad=${vert ? `${w1}:${h1 + g}` : `${w1 + g}:${h1}`}:0:0:black[a];`
    + `[1:v]fps=${fps},${cropFit(w2, h2)},format=yuv420p[b];[a][b]${vert ? 'vstack' : 'hstack'}=inputs=2:shortest=1[v]`;
  await run(['-i', a, '-i', b, '-filter_complex', graph, '-map', '[v]', '-an', '-t', s3(len), ...venc({ fps }), out]);
  return out;
}

// before → after with a wipe across at `at` (the "glow-up" reveal); both fitted to one frame, video only
export async function wipeReveal(before, after, out, { at = 1.5, dur = 0.6, width, height, fps = 30 } = {}) {
  const p = probe(before);
  const W = even(width || p.width), H = even(height || p.height);
  need('xfade', 'scale', 'crop', 'fps', 'tpad', 'settb');
  // the before shot is held on its last frame if it ends before the wipe does
  const graph = `[0:v]fps=${fps},${cropFit(W, H)},format=yuv420p,tpad=stop_mode=clone:stop_duration=${s3(at + dur)},settb=AVTB[a];`
    + `[1:v]fps=${fps},${cropFit(W, H)},format=yuv420p,settb=AVTB[b];[a][b]xfade=transition=wipeleft:duration=${s3(dur)}:offset=${s3(at)}[v]`;
  await run(['-i', before, '-i', after, '-filter_complex', graph, '-map', '[v]', '-an', ...venc({ fps }), out]);
  return out;
}

// frames (grey bytes, w×h each) → for each, the centre x (in frame pixels) of the cropW-wide window holding the most
// edge + motion energy: where the subject is. Smoothed across frames so the crop glides rather than jitters; a frame with
// nothing in it keeps the last centre (the first: the middle).
export function trackCentres(frames, w, h, cropW) {
  const half = cropW / 2, lo = half, hi = w - half;
  if (cropW >= w) return frames.map(() => w / 2);
  const raw = [];
  let last = w / 2;
  frames.forEach((f, k) => {
    const prev = frames[k - 1];
    const col = new Float64Array(w);
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        col[x] += Math.abs(f[i + 1] - f[i - 1]) + Math.abs(f[i + w] - f[i - w]) + (prev ? 2 * Math.abs(f[i] - prev[i]) : 0);
      }
    }
    // sliding window sum over cropW columns
    const cw = Math.max(1, Math.round(cropW));
    let s = 0, best = -1, bx = 0, sum = 0;
    for (let x = 0; x < w; x++) sum += col[x];
    for (let x = 0; x < cw; x++) s += col[x];
    for (let x = 0; x + cw <= w; x++) {
      if (x) s += col[x + cw - 1] - col[x - 1];
      if (s > best) { best = s; bx = x; }
    }
    // too little anywhere (a flat frame): no signal, hold where we were
    if (sum > w * h * 0.5) last = bx + cw / 2;
    raw.push(last);
  });
  // a 3-tap average, then kept inside the frame
  return raw.map((x, i) => { const n = [raw[i - 1], x, raw[i + 1]].filter((v) => v !== undefined); return Math.min(hi, Math.max(lo, n.reduce((a, b) => a + b, 0) / n.length)); });
}

// a landscape clip → vertical (or any taller shape), the crop following the subject. Low-res grey frames are sampled
// (samples per second), the subject found in each, and the crop's x moves piecewise-linearly between them (at most 30
// keyframes). A clip that's already narrow enough, or that can't be sampled, gets a plain centre crop.
export async function reframeTrack(video, out, { aspect = '9:16', short = 1080, samples = 2, fps = 30 } = {}) {
  const p = probe(video);
  if (!p.hasVideo) throw new Error('This clip has no picture');
  const [a, b] = String(aspect).split(':').map(Number);
  const ar = a > 0 && b > 0 ? a / b : 9 / 16;
  const outW = even(ar <= 1 ? short : short * ar), outH = even(ar <= 1 ? short / ar : short);
  need('scale', 'crop', 'fps', 'format');
  const cropW = Math.min(p.width, even(p.height * ar));
  let xExpr = `(iw-${cropW})/2`;
  if (cropW < p.width - 4) {
    const sw = 160, sh = even((p.height * sw) / p.width), raw = tmpFile('track', 'gray');
    try {
      await run(['-i', video, '-vf', `fps=${samples},scale=${sw}:${sh},format=gray`, '-f', 'rawvideo', '-pix_fmt', 'gray', raw], { what: 'The reframer' });
      const buf = fs.readFileSync(raw), size = sw * sh, frames = [];
      for (let o = 0; o + size <= buf.length; o += size) frames.push(buf.subarray(o, o + size));
      if (frames.length) {
        const k = p.width / sw;
        let keys = trackCentres(frames, sw, sh, cropW / k).map((c, i) => ({ t: i / samples, x: Math.round(Math.min(p.width - cropW, Math.max(0, c * k - cropW / 2))) }));
        if (keys.length > 30) keys = Array.from({ length: 30 }, (_, i) => keys[Math.round((i * (keys.length - 1)) / 29)]);
        // x(t): straight lines between keyframes, held before the first and after the last
        let e = String(keys.at(-1).x);
        for (let i = keys.length - 2; i >= 0; i--) {
          const k0 = keys[i], k1 = keys[i + 1];
          e = `if(lt(t,${s3(k1.t)}),${k0.x}+${k1.x - k0.x}*(t-${s3(k0.t)})/${s3(k1.t - k0.t)},${e})`;
        }
        xExpr = `if(lt(t,${s3(keys[0].t)}),${keys[0].x},${e})`;
      }
    } catch (err) { console.error('studio reframe: centre crop', err.message); } finally { fs.rm(raw, { force: true }, () => {}); }
  }
  const graph = `[0:v]fps=${fps},crop=${cropW}:${p.height}:x='${xExpr}':y=0,scale=${outW}:${outH}:flags=lanczos,setsar=1,format=yuv420p[v]`;
  await run(['-i', video, '-filter_complex', graph, '-map', '[v]', ...(p.hasAudio ? ['-map', '0:a:0', '-c:a', 'aac', '-b:a', '192k'] : ['-an']), ...venc({ fps }), out]);
  return out;
}
