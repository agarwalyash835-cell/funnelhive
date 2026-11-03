// Studio's quality checks, two layers:
//   1. measured with ffmpeg (free): size and length as ordered, blank or flat images, black frames, freezes, sudden
//      jumps, blur and blockiness;
//   2. an AI reviewer (studio/models.js review) shown the seller's product photo and frames from the render, answering a
//      fixed checklist: same product, garbled text or fake logos, warped hands and faces, matches the shot, consistent
//      from the first frame to the last, safe.
// → { ok, score, issues: [plain words], fix (a note for the next attempt), measured, reviewed }
import fs from 'node:fs';
import { ffmpeg, probe, frames, tmpFile, rm } from './media.js';
import { reviewWith } from './kie.js';
import { studioModels } from './models.js';
import { PRESETS as CAPTION_PRESETS } from './captions.js';

const PASS = 6; // out of 10, the reviewer's lowest checklist score

// ---------- 1. measured ----------
export async function measureImage(file) {
  const p = await probe(file);
  const r = await ffmpeg(['-i', file, '-vf', 'signalstats,metadata=print', '-f', 'null', '-'], { timeoutMs: 30000 });
  const num = (k) => Number((r.err.match(new RegExp(`signalstats\\.${k}=([\\d.]+)`)) || [])[1]);
  const range = num('YMAX') - num('YMIN');
  const issues = [];
  if (!p.width || !p.height) issues.push('The image couldn’t be read');
  else if (Number.isFinite(range) && range < 24) issues.push('The image is blank or almost a single colour');
  return { width: p.width, height: p.height, contrast: Number.isFinite(range) ? range : null, issues };
}

const mean = (s, name) => { const m = s.match(new RegExp(`${name} mean:\\s*([\\d.]+)`)); return m ? Number(m[1]) : null; };
// expect: { seconds, height } as ordered
export async function measureClip(file, expect = {}) {
  const p = await probe(file);
  const issues = [];
  if (!p.video) return { ...p, issues: ['The clip couldn’t be read'] };
  const a = await ffmpeg(['-i', file, '-an', '-vf', 'blackdetect=d=0.25:pix_th=0.08,freezedetect=n=0.003:d=1.2,blurdetect,blockdetect', '-f', 'null', '-'], { timeoutMs: 240000 });
  const blacks = [...a.err.matchAll(/black_duration:([\d.]+)/g)].map((m) => Number(m[1]));
  const freezes = [...a.err.matchAll(/freeze_duration:\s*([\d.]+)/g)].map((m) => Number(m[1]));
  // a single generated shot shouldn't cut: big jumps mid-clip are glitches
  const s = await ffmpeg(['-i', file, '-an', '-vf', "select='gt(scene,0.6)',metadata=print", '-f', 'null', '-'], { timeoutMs: 240000 });
  const jumps = (s.err.match(/lavfi\.scene_score=/g) || []).length;
  const m = { width: p.width, height: p.height, seconds: Math.round(p.seconds * 10) / 10, fps: p.fps, black: Math.round(blacks.reduce((x, y) => x + y, 0) * 10) / 10, frozen: Math.round(freezes.reduce((x, y) => x + y, 0) * 10) / 10, jumps, blur: mean(a.err, 'blur'), blockiness: mean(a.err, 'block') };
  if (expect.height && Math.min(p.width, p.height) + 8 < expect.height) issues.push(`Rendered smaller than ordered (${Math.min(p.width, p.height)}p instead of ${expect.height}p)`);
  if (expect.seconds && p.seconds + 0.6 < expect.seconds) issues.push(`Shorter than ordered (${m.seconds}s instead of ${expect.seconds}s)`);
  if (m.black >= 0.5) issues.push('Has black frames');
  if (m.frozen >= 1.2) issues.push('Freezes for a moment');
  if (jumps > 1) issues.push('Jumps or flickers mid-clip');
  return { ...m, issues };
}

// ---------- 2. the AI reviewer ----------
const CHECKS = (kind, hasRef) => `You are the quality checker for a short ${kind === 'clip' ? 'video clip (the pictures are frames from it, in order)' : 'product image'} made for an Indian small business's ad.
${hasRef ? 'The FIRST picture is the seller\'s real product photo; the rest are the generated result.' : 'All pictures are the generated result.'}
Score each from 0 (bad) to 10 (perfect) and answer only JSON:
{"product_match": ${hasRef ? 'same product as the real photo — shape, colour, label, packaging' : 'null'},
 "text_ok": no garbled letters, fake words or invented logos,
 "anatomy_ok": hands, fingers, faces and bodies look natural (10 if there are no people),
 "matches_brief": shows what was asked,
 "consistency": ${kind === 'clip' ? 'the product, people and scene stay the same from the first frame to the last (no melting, morphing or changing labels)' : '10'},
 "safe": true or false (nothing unsafe, misleading or offensive),
 "issues": ["each problem in a few plain words a shop owner understands"],
 "fix": "one sentence telling the image/video model what to do differently next time, or empty"}`;

export async function review(kind, { brief, items, reference }) {
  const { model, fallback } = studioModels().review;
  const images = [...(reference ? [reference] : []), ...items];
  const v = await reviewWith([model, fallback], { prompt: `${CHECKS(kind, !!reference)}\n\nWhat was asked: ${String(brief || '').slice(0, 1500)}`, images });
  if (!v) return null; // the reviewer is unavailable: measured checks only
  const scores = ['product_match', 'text_ok', 'anatomy_ok', 'matches_brief', 'consistency'].map((k) => v[k]).filter((x) => typeof x === 'number');
  const score = scores.length ? Math.min(...scores) : null;
  return { score, safe: v.safe !== false, issues: (Array.isArray(v.issues) ? v.issues : []).map((x) => String(x).slice(0, 160)).slice(0, 6), fix: String(v.fix || '').slice(0, 300) };
}

// a picture as the reviewer is sent it: at most 768 px, as a JPEG. A 2K PNG is ~10 MB of base64, which reviewers refuse
// ("Inline data URL is too large") — and then the check silently didn't happen
export async function forReview(input, type = 'image/png') {
  const src = typeof input === 'string' ? input : tmpFile(type.includes('jpeg') ? 'jpg' : 'png'), out = tmpFile('jpg');
  try {
    if (typeof input !== 'string') fs.writeFileSync(src, input);
    await ffmpeg(['-i', src, '-frames:v', '1', '-vf', "scale='min(768,iw)':'min(768,ih)':force_original_aspect_ratio=decrease", '-q:v', '4', out], { timeoutMs: 30000 });
    return fs.existsSync(out) ? { buf: fs.readFileSync(out), type: 'image/jpeg' } : { buf: typeof input === 'string' ? fs.readFileSync(input) : input, type };
  } finally { rm(out, ...(typeof input === 'string' ? [] : [src])); }
}

// ---------- together ----------
export async function checkImage(file, { brief, reference }) {
  const measured = await measureImage(file);
  if (measured.issues.length) return { ok: false, score: 0, issues: measured.issues, fix: '', measured, reviewed: false };
  const r = await review('image', { brief, items: [await forReview(file)], reference: reference ? await forReview(reference.buf, reference.type) : null });
  return verdict(measured, r);
}
export async function checkClip(file, { brief, reference, expect }) {
  const measured = await measureClip(file, expect);
  const r = await review('clip', { brief, items: await frames(file, measured.seconds || 5), reference: reference ? await forReview(reference.buf, reference.type) : null });
  return verdict(measured, r);
}
function verdict(measured, r) {
  const issues = [...measured.issues, ...(r?.issues || [])];
  const ok = !measured.issues.length && (!r || (r.safe && (r.score == null || r.score >= PASS)));
  return { ok, score: r?.score ?? null, issues: ok ? [] : issues.length ? issues : ['Didn’t pass the quality check'], fix: r?.fix || '', measured, reviewed: !!r };
}

// ---------- 3. the finished Reel, as a senior editor would watch it ----------
// Frames across the whole video (two in the first 2 seconds: the hook), the script and what was actually said → a score,
// one sentence, and up to 5 notes, each with a fix the seller can apply in one click (studio/reels.js editReel):
//   redo_shot { i, note } (paid) · reword_line { i, text } · end_card { endCard } · captions { style } · or none.
// Free and never holds the Reel up: no reviewer → null.
export const REVIEW_AREAS = ['hook', 'visual', 'pacing', 'captions', 'voice', 'end card', 'story'];
const CAPTION_IDS = Object.keys(CAPTION_PRESETS);
const EDITOR = (n, captions) => `You are a senior video ad editor (the kind agencies pay for) reviewing a FINISHED short video ad made for an Indian small business, before it runs on Instagram Reels / YouTube Shorts. The pictures are frames from the finished video, in order, with the time and scene of each.
Judge it like a premium human editor, cinematographer and sound designer would:
- hook: do the first 2 seconds stop the scroll (a striking picture, a face, movement, a bold first line)?
- story: is it clear what is sold, to whom and why, from problem to result?
- visual: does the main person and the product look the same in every scene (face, age, clothes, packaging)? consistent light and colour? anything warped or fake-looking?
- pacing: does each scene hold as long as it should, nothing dragging or rushed?
- captions: big enough, readable on a phone, not covering faces or the product, not cut off?
- voice: do the words fit the pictures and the brand, in natural spoken language?
- end card: clear brand, offer and call to action, readable at a glance?
- brand fit: does it look and sound like a trustworthy business?
Scenes are numbered 1 to ${n}. Answer only JSON:
{"score": 0-100 as a demanding editor would grade it (85+ ready to run as it is, below 60 not ready),
 "virality": 0-100 — how likely it is to be watched to the end, shared and acted on in an Indian feed (scroll-stopping hook, emotion, relatability, a clear payoff, rewatch value),
 "viralityWhy": "one short sentence: what helps or hurts its reach",
 "summary": "one sentence verdict, in plain words",
 "suggestions": [{"scene": scene number or null, "area": one of ${REVIEW_AREAS.map((a) => `"${a}"`).join(', ')}, "problem": "what's wrong, in a few plain words a shop owner understands", "fix": "what to change", "action": a one-click fix or null}]}
The one-click fixes:
 {"type": "redo_shot", "scene": n, "note": "what the new clip must show or change, written for the video maker"} — costs the seller credits: only for a clear visual problem
 {"type": "reword_line", "scene": n, "text": "the new voiceover line for that scene, in the same language and script, about as long"}
 {"type": "end_card", "endCard": {"headline": max 40 chars, "offer": max 40 chars, "cta": max 30 chars}} — never invent a price or offer the script doesn't have
 {"type": "captions", "style": one of ${CAPTION_IDS.map((c) => `"${c}"`).join(', ')}} (now: ${captions || 'no captions'})
At most 5 suggestions, the most important first; none when it is already excellent. Never mention AI, models or tools.`;

// the reviewer's answer, made safe: known areas, at most 5 notes, and only fixes that point at a real scene and change
// something (scenes come back numbered from 1; they're kept as indexes from 0)
export function cleanReview(v, { lines = [], shots = 0, endCard = {}, captions = null } = {}) {
  if (!v || typeof v !== 'object') return null;
  const s = (x, n) => String(x ?? '').trim().slice(0, n);
  const idx = (x, max) => { const k = Math.round(Number(x)) - 1; return Number.isInteger(k) && k >= 0 && k < max ? k : null; };
  const scenes = Math.max(lines.length, shots);
  const action = (a, scene) => {
    if (!a || typeof a !== 'object') return null;
    const at = a.scene ?? a.i ?? (scene == null ? null : scene + 1);
    if (a.type === 'redo_shot') { const i = idx(at, shots), note = s(a.note, 300); return i != null && note ? { type: 'redo_shot', i, note } : null; }
    if (a.type === 'reword_line') { const i = idx(at, lines.length), text = s(a.text, 220); return i != null && text && text !== lines[i] ? { type: 'reword_line', i, text } : null; }
    if (a.type === 'end_card') {
      const e = a.endCard || {}, card = { headline: s(e.headline, 40) || s(endCard.headline, 40), offer: s(e.offer, 40) || s(endCard.offer, 40), cta: s(e.cta, 30) || s(endCard.cta, 30) };
      return ['headline', 'offer', 'cta'].some((k) => card[k] !== s(endCard[k], 40)) ? { type: 'end_card', endCard: card } : null;
    }
    if (a.type === 'captions') return CAPTION_IDS.includes(a.style) && a.style !== captions ? { type: 'captions', style: a.style } : null;
    return null;
  };
  const suggestions = (Array.isArray(v.suggestions) ? v.suggestions : []).filter((x) => x && s(x.problem, 200)).slice(0, 5).map((x) => {
    let scene = idx(x.scene, scenes);
    const act = action(x.action, scene);
    if (act && 'i' in act) scene = act.i;
    return { scene, area: REVIEW_AREAS.includes(x.area) ? x.area : 'story', problem: s(x.problem, 200), fix: s(x.fix, 300), action: act };
  });
  const pct = (x) => { const n = Number(x); return Number.isFinite(n) ? Math.min(100, Math.max(0, Math.round(n))) : null; };
  return { score: pct(v.score), virality: pct(v.virality), viralityWhy: s(v.viralityWhy, 200), summary: s(v.summary, 240), suggestions, at: Date.now() };
}

// spans: [[start, end] seconds per line] when known, to say which scene each frame is from
export async function reviewReel({ file, script = {}, lines = [], words = null, spans = null, captions = null }) {
  const { model, fallback } = studioModels().review;
  const secs = (await probe(file)).seconds;
  if (!secs) return null;
  // the hook twice (0.3 s, 1.5 s), then evenly to the last frame: 8 in all
  const times = [0.3, Math.min(1.5, secs / 2), ...Array.from({ length: 6 }, (_, k) => 2 + ((secs - 2.3) * (k + 1)) / 6)].filter((t) => t < secs).map((t) => Math.round(t * 10) / 10);
  const images = [];
  for (const t of times) {
    const f = tmpFile('jpg');
    await ffmpeg(['-ss', String(t), '-i', file, '-frames:v', '1', '-vf', "scale='min(512,iw)':-2", '-q:v', '4', f], { timeoutMs: 30000 });
    if (fs.existsSync(f)) { images.push({ t, buf: fs.readFileSync(f), type: 'image/jpeg' }); rm(f); }
  }
  if (!images.length) return null;
  const n = Math.max(lines.length, script.shots?.length || 0);
  const sceneAt = (t) => { if (!spans?.length) return null; const k = spans.findIndex(([, z]) => t <= z + 0.3); return k < 0 ? 'closing card' : `scene ${Math.min(k, n - 1) + 1}`; };
  const said = (Array.isArray(words) ? words.map((w) => w?.w || w?.word || '').join(' ') : '').slice(0, 1500);
  const prompt = `${EDITOR(n, captions)}

The frames: ${images.map((x, k) => `picture ${k + 1} at ${x.t}s${sceneAt(x.t) ? ` (${sceneAt(x.t)})` : ''}`).join('; ')}. The video is ${Math.round(secs * 10) / 10}s long.
The scenes (voiceover line · what the shot shows):
${Array.from({ length: n }, (_, i) => `${i + 1}. “${String(lines[i] || '').slice(0, 220)}” · ${String(script.shots?.[i]?.image || '(voice only)').slice(0, 300)}${script.shots?.[i]?.motion ? ` · moves: ${String(script.shots[i].motion).slice(0, 120)}` : ''}`).join('\n')}
Closing card: ${JSON.stringify(script.endCard || {})}${said ? `\nWhat the voiceover actually says: ${said}` : ''}`;
  const v = await reviewWith([model, fallback], { prompt, images });
  return v ? cleanReview(v, { lines, shots: script.shots?.length || 0, endCard: script.endCard || {}, captions }) : null;
}
