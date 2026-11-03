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
