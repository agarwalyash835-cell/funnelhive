// Studio's queue. Every image or clip is a row in `studio` that moves
//   queued → rendering (a kie.ai task is running) → checking (downloaded, measured, reviewed) → ready
// and on a failed check is kept as needs_review with the reasons: every render costs credits, so a redo only happens when
// the seller asks for it (routes.js redo, with its cost shown first). A render that failed or timed out on the provider
// isn't charged, so that one is retried on its own (at most twice), then marked failed. Rows are the state, so a restart picks up where it left off; the task id lets a render
// that was running carry on. One check runs at a time (ffmpeg is the heavy part on this server) and a few renders.
// Every attempt is written to the row's usage log (model, resolution, seconds, outcome) for pricing later.
import fs from 'node:fs';
import { T, q, uid, JOBS } from '../db.js';
import { pick, imageRequest, clipInput, clipRes, imageCost, clipCost, TIERS } from './models.js';
import { startTask, taskState, studioReady } from './kie.js';
import { download, save, localCopy, publicUrl, rm, ffmpeg, tmpFile } from './media.js';
import { checkImage, checkClip } from './qa.js';
import { to720 } from './enhance.js';
import { notify } from '../notify.js';

export const MAX_ATTEMPTS = 3; // the first try and two retries
// renders run on kie.ai (several at once is fine); checks run here — ffmpeg is heavy, so one per CPU core
const MAX_RENDERING = Number(process.env.STUDIO_MAX_RENDERING || 8), PER_USER = 4, MAX_CHECKING = Number(process.env.STUDIO_MAX_CHECKING || 2);
const RENDER_TIMEOUT = 25 * 60000;
const ACTIVE = ['queued', 'rendering', 'checking'];

const KEEP_PRODUCT = 'Keep the product exactly as in the reference photo: same shape, colour, label and packaging. Photorealistic. No added text, words, logos or watermarks.';
const KEEP_CLIP = 'Keep the product and any people exactly as in the first frame for the whole clip; smooth, natural camera movement; no text, captions or logos.';
// the request as sent: the seller's words, the house rules, and what earlier attempts got wrong
function promptFor(a) {
  const notes = (a.notes || []).filter(Boolean).slice(-3);
  // a design's background with AI typography (designs.js) carries its quoted headline: only other words are ruled out
  const rule = a.textArt ? 'No other text, logos or watermarks.' : 'Photorealistic. No added text, words, logos or watermarks.';
  return [a.prompt, a.kind === 'clip' ? KEEP_CLIP : a.ref ? KEEP_PRODUCT : rule, notes.length ? `Avoid this time: ${notes.join(' ')}` : ''].filter(Boolean).join('\n').slice(0, 4000);
}

export const view = (a) => ({ id: a.id, kind: a.kind, tier: a.tier, prompt: a.prompt, aspect: a.aspect, seconds: a.seconds || null, status: a.status, url: a.url || null, poster: a.poster || null, ref: a.ref || null, sourceId: a.sourceId || null, issues: a.qa?.issues || [], score: a.qa?.score ?? null, enhanced: !!a.enhanced, measured: a.qa?.measured ? { width: a.qa.measured.width, height: a.qa.measured.height, seconds: a.qa.measured.seconds ?? null } : null, reviewed: !!a.qa?.reviewed, fix: a.fix || '', res: a.kind === 'clip' ? clipRes(a.tier, a.res, a.vmodel) : null, photo: !!a.photo, model: a.kind === 'image' || a.kind === 'clip' ? pick(a.kind, a.tier, a.kind === 'clip' ? a.vmodel : a.imodel).name : null, redoCredits: a.kind === 'image' || a.photo ? imageCost(a.tier, a.imodel) : a.kind === 'clip' ? clipCost(a.tier, a.seconds, a.res, a.vmodel) : null, attempts: a.attempts || 0, error: a.error || '', at: a.at, doneAt: a.doneAt || null, by: a.by || null });

export function enqueue(userId, a) {
  const row = { id: uid(), userId, status: 'queued', attempts: 0, notes: [], usage: [], at: Date.now(), ...a };
  return T.studio.insert(row);
}
const set = (id, fn) => T.studio.update(id, fn);
const lastUsage = (x, patch) => { const u = x.usage?.at(-1); if (u) Object.assign(u, patch); };

// ---------- one step for one row ----------
async function startRender(a) {
  let m = pick(a.kind, a.tier, a.kind === 'clip' ? a.vmodel : a.imodel);
  // a model that can't take a product photo: the tier's default makes the stills that must keep the product
  if (a.kind === 'image' && a.ref && m.entry?.refs === 0) m = pick('image', a.tier);
  let req, model = m.model;
  if (a.kind === 'image') { const q = imageRequest(m.model, { prompt: promptFor(a), refs: a.ref ? [publicUrl(a.ref)] : [], aspect: a.aspect, resolution: m.resolution }); model = q.model; req = { input: q.input, resolution: m.resolution, seconds: 0 }; }
  else req = clipInput(m.model, { prompt: promptFor(a), image: a.ref ? publicUrl(a.ref) : null, last: a.last ? publicUrl(a.last) : null, aspect: a.aspect, seconds: a.seconds || 5, resolution: clipRes(a.tier, a.res, m.key), variant: m.entry?.variant || '' });
  const taskId = await startTask({ model, input: req.input });
  set(a.id, (x) => {
    x.status = 'rendering'; x.taskId = taskId; x.attempts = (x.attempts || 0) + 1; x.startedAt = Date.now(); x.model = model; x.resolution = req.resolution;
    x.usage = [...(x.usage || []), { attempt: x.attempts, model, resolution: req.resolution, seconds: req.seconds, at: Date.now(), outcome: 'rendering' }];
  });
}
function retryOrFail(a, why, { note = '', keep = null } = {}) {
  set(a.id, (x) => {
    lastUsage(x, { outcome: why });
    if ((x.attempts || 0) < MAX_ATTEMPTS && !keep) { x.status = 'queued'; if (note) x.notes = [...(x.notes || []), note].slice(-5); delete x.taskId; return; }
    if (keep) { Object.assign(x, keep); x.status = 'needs_review'; } else { x.status = 'failed'; x.error = 'The AI couldn’t make this one — try different words, or try again'; }
    x.doneAt = Date.now(); delete x.taskId;
  });
}
async function poll(a) {
  const st = await taskState(a.taskId);
  if (st.state === 'success' && st.urls.length) return set(a.id, (x) => { x.status = 'checking'; x.result = st.urls[0]; });
  if (st.state === 'fail') { console.error('studio render failed', a.id, a.model, st.failMsg); return retryOrFail(a, 'render failed'); }
  if (Date.now() - (a.startedAt || a.at) > RENDER_TIMEOUT) return retryOrFail(a, 'render timed out');
}
async function check(a) {
  const ext = a.kind === 'image' ? 'png' : 'mp4';
  let file, ref, made = [];
  try {
    file = await download(a.result, ext);
    if (a.ref) { const c = await localCopy(a.ref, 'png').catch(() => null); if (c) { ref = { buf: fs.readFileSync(c.file), type: 'image/png' }; if (c.temp) made.push(c.file); } }
    const qa = a.kind === 'image' ? await checkImage(file, { brief: a.prompt, reference: ref }) : await checkClip(file, { brief: a.prompt, reference: ref, expect: { seconds: a.usage?.at(-1)?.seconds, height: parseInt(a.resolution, 10) || 0 } });
    let deliver = file, enhanced = false;
    // a clip below 720p is always brought up to 720p (enhance.js) before it's saved — kept for review or not
    if (a.kind === 'clip' && a.enhance !== false) { const e = await to720(file); if (e.file !== file) { made.push(e.file); deliver = e.file; enhanced = e.enhanced; } }
    const saved = await save(a.userId, deliver, ext, a.kind === 'image' ? 'image/png' : 'video/mp4');
    let poster = null;
    if (a.kind === 'clip') { const pf = tmpFile('jpg'); made.push(pf); await ffmpeg(['-ss', '0.1', '-i', deliver, '-frames:v', '1', '-vf', 'scale=480:-2', '-q:v', '4', pf], { timeoutMs: 30000 }); if (fs.existsSync(pf)) poster = (await save(a.userId, pf, 'jpg', 'image/jpeg')).url; }
    const keep = { url: saved.url, poster, bytes: saved.bytes, qa: { ok: qa.ok, score: qa.score, issues: qa.issues, measured: qa.measured, reviewed: qa.reviewed }, enhanced };
    // didn't pass: kept with the reasons and the reviewer's fix note — the seller decides whether a paid redo is worth it
    if (!qa.ok) { console.log('studio needs review', a.id, qa.issues.join('; ')); return retryOrFail(a, 'failed check', { keep: { ...keep, fix: qa.fix || '' } }); }
    set(a.id, (x) => { Object.assign(x, keep); x.status = 'ready'; x.doneAt = Date.now(); delete x.taskId; delete x.result; lastUsage(x, { outcome: 'ready' }); });
    if (a.notifyDone) notify(a.userId, { kind: 'support', title: `Your Studio ${a.kind === 'clip' ? 'clip' : 'image'} is ready`, body: a.prompt.slice(0, 80), link: '/studio' });
  } catch (e) {
    console.error('studio check failed', a.id, e.message);
    // the render is paid for and still there: check it again (free) rather than render it again
    set(a.id, (x) => { x.checkTries = (x.checkTries || 0) + 1; if (x.checkTries >= 3) { x.status = 'failed'; x.error = 'It was made but couldn’t be checked — try again'; x.doneAt = Date.now(); lastUsage(x, { outcome: 'check error' }); } });
  } finally { rm(file, ...made); }
}

// ---------- the loop ----------
let checking = 0;
const working = new Set();
export async function tick() {
  if (!studioReady()) return;
  const rows = q(`SELECT data FROM studio WHERE status IN (${ACTIVE.map(() => '?').join(',')}) ORDER BY at`).all(...ACTIVE).map((r) => JSON.parse(r.data));
  let rendering = rows.filter((r) => r.status === 'rendering').length;
  const perUser = {};
  for (const r of rows) if (r.status === 'rendering') perUser[r.userId] = (perUser[r.userId] || 0) + 1;
  const jobs = [];
  for (const a of rows) {
    if (working.has(a.id)) continue;
    if (a.status === 'queued') {
      if (rendering >= MAX_RENDERING || (perUser[a.userId] || 0) >= PER_USER) continue;
      rendering++; perUser[a.userId] = (perUser[a.userId] || 0) + 1;
      jobs.push(guard(a, () => startRender(a).catch((e) => { console.error('studio start failed', a.id, e.message); set(a.id, (x) => { x.status = 'failed'; x.error = e.message; x.doneAt = Date.now(); }); })));
    } else if (a.status === 'rendering') jobs.push(guard(a, () => poll(a)));
    else if (a.status === 'checking' && checking < MAX_CHECKING) { checking++; jobs.push(guard(a, () => check(a)).finally(() => { checking--; })); }
  }
  await Promise.all(jobs);
}
const guard = (a, fn) => { working.add(a.id); return Promise.resolve().then(fn).catch((e) => console.error('studio step failed', a.id, e.message)).finally(() => working.delete(a.id)); };

export const tierOk = (t) => TIERS.includes(t);
if (JOBS && process.env.NODE_ENV !== 'test') setInterval(() => { tick().catch((e) => console.error('studio tick failed', e.message)); }, 5000).unref();
