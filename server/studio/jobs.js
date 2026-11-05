// Studio's queue. Every image or clip is a row in `studio` that moves
//   queued → rendering (a kie.ai task is running) → checking (downloaded, measured, reviewed) → ready
// and on a failed check is kept as needs_review with the reasons: every render costs credits, so a redo only happens when
// the seller asks for it (routes.js redo, with its cost shown first). A render that failed or timed out on the provider
// isn't charged, so that one is retried on its own (at most twice), then marked failed. A slow task gets a second window,
// and is looked at once more before a new one is started (it's billed if it finishes). A start that didn't get through
// (a blip, the provider's balance) waits and tries again; the balance running out holds every start until it's topped
// up. A check tried again reuses the file it already saved. Rows are the state, so a restart picks up where it left off; the task id lets a render
// that was running carry on. One check runs at a time (ffmpeg is the heavy part on this server) and a few renders.
// Every attempt is written to the row's usage log (model, resolution, seconds, outcome) for pricing later.
import fs from 'node:fs';
import path from 'node:path';
import { T, q, uid, JOBS, dir as DATA_DIR } from '../db.js';
import { s3Enabled, deleteObject } from '../storage.js';
import { pick, imageRequest, clipInput, clipRes, imageCost, clipCost, TIERS, presenterModel, presenterInput, presenterCost } from './models.js';
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
// a start that didn't get through (a network blip, the provider busy): tried again later, waiting longer each time
export const MAX_START_TRIES = 5;
const backoff = (n) => Math.min(30 * 60000, 30000 * 2 ** n); // 30 s, 1 min, 2 min, 4 min …
const PAUSE_WAIT = 2 * 60000; // the provider's balance ran out: no row is started until this has passed (then it's tried again)
let pausedUntil = 0;

const KEEP_PRODUCT = 'Keep the product exactly as in the reference photo: same shape, colour, label and packaging. Photorealistic. No added text, words, logos or watermarks.';
const KEEP_CLIP = 'Keep the product and any people exactly as in the first frame for the whole clip; smooth, natural camera movement; no text, captions or logos.';
const KEEP_PEOPLE = 'Keep every person exactly as in their reference pictures: the same face, age, skin tone, hair, body and outfit.';
// the request as sent: the seller's words, the house rules, and what earlier attempts got wrong
function promptFor(a) {
  const notes = (a.notes || []).filter(Boolean).slice(-3);
  // a design's background with AI typography (designs.js) carries its quoted headline: only other words are ruled out
  const rule = a.textArt ? 'No other text, logos or watermarks.' : 'Photorealistic. No added text, words, logos or watermarks.';
  return [a.prompt, a.kind === 'clip' ? KEEP_CLIP : a.ref ? KEEP_PRODUCT : rule, a.refs?.length ? KEEP_PEOPLE : '', notes.length ? `Avoid this time: ${notes.join(' ')}` : ''].filter(Boolean).join('\n').slice(0, 4000);
}

export const view = (a) => ({ id: a.id, kind: a.kind, tier: a.tier, prompt: a.prompt, aspect: a.aspect, seconds: a.seconds || null, status: a.status, url: a.url || null, poster: a.poster || null, ref: a.ref || null, sourceId: a.sourceId || null, issues: a.qa?.issues || [], score: a.qa?.score ?? null, enhanced: !!a.enhanced, measured: a.qa?.measured ? { width: a.qa.measured.width, height: a.qa.measured.height, seconds: a.qa.measured.seconds ?? null } : null, reviewed: !!a.qa?.reviewed, fix: a.fix || '', res: a.kind === 'clip' ? clipRes(a.tier, a.res, a.vmodel) : null, photo: !!a.photo, model: a.presenter ? presenterModel().name : a.kind === 'image' || a.kind === 'clip' ? pick(a.kind, a.tier, a.kind === 'clip' ? a.vmodel : a.imodel).name : null, presenter: !!a.presenter, redoCredits: a.presenter ? presenterCost(a.seconds) : a.kind === 'image' || a.photo ? imageCost(a.tier, a.imodel) : a.kind === 'clip' ? clipCost(a.tier, a.seconds, a.res, a.vmodel) : null, attempts: a.attempts || 0, error: a.error || '', at: a.at, doneAt: a.doneAt || null, by: a.by || null });

export function enqueue(userId, a) {
  const row = { id: uid(), userId, status: 'queued', attempts: 0, notes: [], usage: [], at: Date.now(), ...a };
  return T.studio.insert(row);
}
const set = (id, fn) => T.studio.update(id, fn);
const lastUsage = (x, patch) => { const u = x.usage?.at(-1); if (u) Object.assign(u, patch); };

// ---------- removing what was made ----------
const UPLOADS = path.join(DATA_DIR, 'uploads');
// Studio's own saved files ([{ url, bytes }] or urls) → removed from disk or the bucket, their bytes given back to the
// seller's storage. Only studio-… files of that seller: their own uploads are never touched.
export async function dropFiles(userId, files = []) {
  const { addStorage } = await import('../limits.js');
  for (const o of files) {
    const url = typeof o === 'string' ? o : o?.url;
    const m = /\/uploads\/([\w-]+)\/(studio-[\w.-]+\.\w+)$/.exec(url || '');
    if (!m || m[1] !== userId) continue;
    const f = path.join(UPLOADS, m[1], m[2]);
    if (fs.existsSync(f)) fs.rmSync(f, { force: true });
    else if (s3Enabled()) await deleteObject(`uploads/${m[1]}/${m[2]}`).catch(() => {});
    if (o?.bytes) addStorage(userId, -o.bytes);
  }
}
// a row and its files. One still being rendered or checked is marked and goes once it's done (its file is saved then).
// A file another of the seller's rows still points at (a face picked from it, a reference) is kept; `together` are the
// ids going at the same time (a cast's sheet), which don't count.
export function dropAsset(a, together = []) {
  if (!a) return;
  if (['rendering', 'checking'].includes(a.status) || working.has(a.id)) { set(a.id, (x) => { x.drop = true; }); return; }
  T.studio.del(a.id);
  for (const id of T.studioshare.ids({ assetId: a.id })) T.studioshare.del(id); // its client links (share.js) go with it
  const others = T.studio.all({ userId: a.userId }).filter((x) => x.id !== a.id && !together.includes(x.id));
  const used = new Set(others.flatMap((x) => [x.url, x.poster, x.ref, x.bgUrl, x.audio, ...(x.refs || [])]).filter(Boolean));
  const files = [{ url: a.url, bytes: a.bytes }, { url: a.poster, bytes: a.posterBytes }, a.saved, a.posterSaved].filter((o) => o?.url && !used.has(o.url));
  const seen = new Set();
  dropFiles(a.userId, files.filter((o) => !seen.has(o.url) && seen.add(o.url))).catch((e) => console.error('studio files not removed', a.id, e.message));
}
// a row that was marked to go while it was busy, once it's finished
const retire = (id) => { const x = T.studio.get(id); if (x?.drop && !['queued', 'rendering', 'checking'].includes(x.status)) dropAsset(x); };

// ---------- one step for one row ----------
// the provider call alone: its errors can be passing (a blip, the balance) and are tried again; a bad request isn't
const begin = (model, input) => startTask({ model, input }).catch((e) => { throw Object.assign(e, { transient: true }); });
const started = (a, taskId, model, req) => set(a.id, (x) => {
  x.status = 'rendering'; x.taskId = taskId; x.attempts = (x.attempts || 0) + 1; x.startedAt = Date.now(); x.model = model; x.resolution = req.resolution;
  delete x.overtime; delete x.startTries; delete x.notBefore; delete x.paused;
  x.usage = [...(x.usage || []), { attempt: x.attempts, model, resolution: req.resolution, seconds: req.seconds, at: Date.now(), outcome: 'rendering' }];
});
async function startRender(a) {
  // the last attempt timed out but its task may still finish (and is billed if it does): look once more before paying again
  if (a.staleTask) {
    const st = await taskState(a.staleTask).catch(() => null);
    if (st?.state === 'success' && st.urls.length) return set(a.id, (x) => { x.status = 'checking'; x.result = st.urls[0]; delete x.staleTask; lastUsage(x, { outcome: 'finished late' }); });
    set(a.id, (x) => { delete x.staleTask; });
  }
  // a presenter (reels.js): the person's picture and the line's audio → a lip-synced clip as long as the audio
  if (a.presenter) {
    const p = presenterModel(), notes = (a.notes || []).filter(Boolean).slice(-2);
    const req = presenterInput(p.model, { image: publicUrl(a.ref), audio: publicUrl(a.audio), prompt: [a.prompt, ...notes].join(' '), seconds: a.seconds });
    return started(a, await begin(p.model, req.input), p.model, req);
  }
  let m = pick(a.kind, a.tier, a.kind === 'clip' ? a.vmodel : a.imodel);
  // the product photo first, then the cast's reference pictures (cast.js — already within the model's limit)
  const refs = [a.ref, ...(a.refs || [])].filter(Boolean).map(publicUrl);
  // a model that can't take a reference picture: the tier's default makes the stills that must keep the product or a face
  if (a.kind === 'image' && refs.length && m.entry?.refs === 0) m = pick('image', a.tier);
  let req, model = m.model;
  if (a.kind === 'image') { const q = imageRequest(m.model, { prompt: promptFor(a), refs, aspect: a.aspect, resolution: m.resolution }); model = q.model; req = { input: q.input, resolution: m.resolution, seconds: 0 }; }
  else req = clipInput(m.model, { prompt: promptFor(a), image: a.ref ? publicUrl(a.ref) : null, last: a.last ? publicUrl(a.last) : null, aspect: a.aspect, seconds: a.seconds || 5, resolution: clipRes(a.tier, a.res, m.key), variant: m.entry?.variant || '', refs: (a.refs || []).map(publicUrl) });
  return started(a, await begin(model, req.input), model, req);
}
// a start that threw: a passing provider error waits and tries again (the balance running out holds every start until
// it's topped up, with no limit); anything else, or too many tries, fails the row
function startFailed(a, e) {
  console.error('studio start failed', a.id, e.message);
  if (e.paused) pausedUntil = Date.now() + PAUSE_WAIT;
  set(a.id, (x) => {
    if (e.paused) { x.paused = true; x.notBefore = pausedUntil; return; }
    x.startTries = (x.startTries || 0) + 1;
    if (e.transient && x.startTries < MAX_START_TRIES) { x.notBefore = Date.now() + backoff(x.startTries - 1); return; }
    x.status = 'failed'; x.error = e.message; x.doneAt = Date.now(); delete x.notBefore;
  });
  retire(a.id);
}
function retryOrFail(a, why, { note = '', keep = null, stale = null } = {}) {
  set(a.id, (x) => {
    lastUsage(x, { outcome: why });
    delete x.overtime;
    if ((x.attempts || 0) < MAX_ATTEMPTS && !keep) { x.status = 'queued'; if (note) x.notes = [...(x.notes || []), note].slice(-5); if (stale) x.staleTask = stale; delete x.taskId; return; }
    if (keep) { Object.assign(x, keep); x.status = 'needs_review'; } else { x.status = 'failed'; x.error = 'The AI couldn’t make this one — try different words, or try again'; }
    x.doneAt = Date.now(); delete x.taskId; delete x.saved; delete x.posterSaved;
  });
  retire(a.id);
}
async function poll(a) {
  const st = await taskState(a.taskId);
  if (st.state === 'success' && st.urls.length) return set(a.id, (x) => { x.status = 'checking'; x.result = st.urls[0]; });
  if (st.state === 'fail') { console.error('studio render failed', a.id, a.model, st.failMsg); return retryOrFail(a, 'render failed'); }
  if (Date.now() - (a.startedAt || a.at) > RENDER_TIMEOUT) {
    // a slow task may still finish, and it's billed when it does: one more window before another render is paid for
    if (!a.overtime) return set(a.id, (x) => { x.overtime = true; x.startedAt = Date.now(); });
    return retryOrFail(a, 'render timed out', { stale: a.taskId });
  }
}
async function check(a) {
  const ext = a.kind === 'image' ? 'png' : 'mp4';
  let file, ref, made = [];
  try {
    file = await download(a.result, ext);
    if (a.ref) { const c = await localCopy(a.ref, 'png').catch(() => null); if (c) { ref = { buf: fs.readFileSync(c.file), type: 'image/png' }; if (c.temp) made.push(c.file); } }
    const qa = a.kind === 'image' ? await checkImage(file, { brief: a.prompt, reference: ref }) : await checkClip(file, { brief: a.prompt, reference: ref, expect: { seconds: a.usage?.at(-1)?.seconds, height: parseInt(a.resolution, 10) || 0 } });
    // a check tried again after the file was saved uses that file (saved once, counted once)
    let saved = a.saved, deliver = file, enhanced = !!saved?.enhanced;
    if (!saved) {
      // a clip below 720p is always brought up to 720p (enhance.js) before it's saved — kept for review or not
      if (a.kind === 'clip' && a.enhance !== false) { const e = await to720(file); if (e.file !== file) { made.push(e.file); deliver = e.file; enhanced = e.enhanced; } }
      saved = { ...(await save(a.userId, deliver, ext, a.kind === 'image' ? 'image/png' : 'video/mp4')), enhanced };
      set(a.id, (x) => { x.saved = saved; });
    }
    let posterSaved = a.posterSaved || null;
    if (a.kind === 'clip' && !posterSaved) { const pf = tmpFile('jpg'); made.push(pf); await ffmpeg(['-ss', '0.1', '-i', deliver, '-frames:v', '1', '-vf', 'scale=480:-2', '-q:v', '4', pf], { timeoutMs: 30000 }); if (fs.existsSync(pf)) { posterSaved = await save(a.userId, pf, 'jpg', 'image/jpeg'); set(a.id, (x) => { x.posterSaved = posterSaved; }); } }
    const keep = { url: saved.url, poster: posterSaved?.url || null, bytes: saved.bytes, posterBytes: posterSaved?.bytes || 0, qa: { ok: qa.ok, score: qa.score, issues: qa.issues, measured: qa.measured, reviewed: qa.reviewed }, enhanced };
    // didn't pass: kept with the reasons and the reviewer's fix note — the seller decides whether a paid redo is worth it
    if (!qa.ok) { console.log('studio needs review', a.id, qa.issues.join('; ')); return retryOrFail(a, 'failed check', { keep: { ...keep, fix: qa.fix || '' } }); }
    set(a.id, (x) => { Object.assign(x, keep); x.status = 'ready'; x.doneAt = Date.now(); delete x.taskId; delete x.result; delete x.saved; delete x.posterSaved; lastUsage(x, { outcome: 'ready' }); });
    retire(a.id);
    if (a.notifyDone && T.studio.get(a.id)) notify(a.userId, { kind: 'support', title: `Your Studio ${a.kind === 'clip' ? 'clip' : 'image'} is ready`, body: a.prompt.slice(0, 80), link: '/studio' });
  } catch (e) {
    console.error('studio check failed', a.id, e.message);
    // the render is paid for and still there: check it again (free) rather than render it again. Given up on: the file
    // saved on the way goes too
    const x = set(a.id, (y) => { y.checkTries = (y.checkTries || 0) + 1; if (y.checkTries >= 3) { y.status = 'failed'; y.error = 'It was made but couldn’t be checked — try again'; y.doneAt = Date.now(); lastUsage(y, { outcome: 'check error' }); } });
    if (x?.status === 'failed') {
      const files = [x.saved, x.posterSaved].filter(Boolean);
      set(a.id, (y) => { delete y.saved; delete y.posterSaved; });
      dropFiles(a.userId, files).catch(() => {});
      retire(a.id);
    }
  } finally { rm(file, ...made); }
}

// ---------- the loop ----------
let checking = 0, ticking = false;
const working = new Set();
// One tick at a time: a second call while starts and polls are running returns at once. Checks (ffmpeg, minutes) are
// awaited after that, so the next tick can start renders meanwhile (`working` keeps a row from being picked twice).
export async function tick() {
  if (ticking || !studioReady()) return;
  ticking = true;
  const checks = [];
  try {
    const rows = q(`SELECT data FROM studio WHERE status IN (${ACTIVE.map(() => '?').join(',')}) ORDER BY at`).all(...ACTIVE).map((r) => JSON.parse(r.data));
    // a row still being started counts as rendering, so the limits hold
    const busy = (r) => r.status === 'rendering' || (r.status === 'queued' && working.has(r.id));
    let rendering = 0;
    const perUser = {};
    for (const r of rows) if (busy(r)) { rendering++; perUser[r.userId] = (perUser[r.userId] || 0) + 1; }
    const jobs = [], now = Date.now();
    for (const a of rows) {
      if (working.has(a.id)) continue;
      if (a.status === 'queued') {
        if (a.drop) { dropAsset(a); continue; }
        if (now < pausedUntil || (a.notBefore && now < a.notBefore)) continue;
        if (rendering >= MAX_RENDERING || (perUser[a.userId] || 0) >= PER_USER) continue;
        rendering++; perUser[a.userId] = (perUser[a.userId] || 0) + 1;
        jobs.push(guard(a, () => startRender(a).catch((e) => startFailed(a, e))));
      } else if (a.status === 'rendering') jobs.push(guard(a, () => poll(a)));
      else if (a.status === 'checking' && checking < MAX_CHECKING) { checking++; checks.push(guard(a, () => check(a)).finally(() => { checking--; })); }
    }
    await Promise.all(jobs);
  } finally { ticking = false; }
  await Promise.all(checks);
}
const guard = (a, fn) => { working.add(a.id); return Promise.resolve().then(fn).catch((e) => console.error('studio step failed', a.id, e.message)).finally(() => working.delete(a.id)); };

export const tierOk = (t) => TIERS.includes(t);
if (JOBS && process.env.NODE_ENV !== 'test') setInterval(() => { tick().catch((e) => console.error('studio tick failed', e.message)); }, 5000).unref();
