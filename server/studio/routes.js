// Studio's API. Sellers: make images (optionally from their own product photo) and clips (from an image), see them
// render, redo one with a note, delete. The platform admin: switch Studio on per account (it's off until pricing is
// in place, since every render costs real money), move a tier to another model, and see what each account used.
// Sellers never see vendor or model names: only tiers.
import { T, q } from '../db.js';
import fs from 'node:fs';
import path from 'node:path';
import { savePlatform } from '../platform.js';
import { speak } from '../sarvam.js';
import { dir as DATA_DIR } from '../db.js';
import { publicUrlFor } from '../storage.js';
import { adminMiddleware, audit } from '../admin-guard.js';
import { studioReady } from './kie.js';
import { enqueue, view, tick, tierOk } from './jobs.js';
import { TIERS, TIER_NAMES, ASPECTS, DEFAULTS, studioModels, VOICES, voiceSample, voiceId, CLIP_RES, clipRes, imageCost, clipCost, reelCost, MOTIONS, modelKey, tierMenu } from './models.js';
import { writeScript, cleanScript, newReel, approveReel, editReel, retryReel, reelsTick, LENGTHS, CAPTION_IDS, storyboardScene, animateReel, sceneCost } from './reels.js';
import { PRESETS as CAPTION_STYLES } from './captions.js';
import { LANGUAGES } from './voice.js';
import { publicUrl } from './media.js';
import { memoryOf, setMemory, remember, forget, learn, withPrefs } from './memory.js';
import { assessReel, assessPrompt, planHash } from './preflight.js';
import { PRESENTER_STYLES, celebrityIn, CELEBRITY_ERROR, pickFace, setPresenter, presenterScenes } from './presenter.js';

// a Reel as the seller sees it: the script, each shot's still and clip, each voiceover line and its check, the result
const brief = (a) => (a ? view(a) : null);
export function reelView(r) {
  // what it costs (shown before approving: each resolution the tier offers)
  const cost = r.script ? reelCost({ tier: r.tier, seconds: r.seconds, shots: r.script.shots?.length || 4, lines: r.script.lines?.length || 4, res: r.res, motion: r.motion, vmodel: r.vmodel, imodel: r.imodel, presenters: presenterScenes(r.script), face: !!r.presenter?.image }) : null;
  // the check before spending, while it still matches the plan
  const assessment = r.script && r.assessment?.hash === planOf(r) ? r.assessment : null;
  return { ...view(r), cost, res: cost?.res || null, title: r.script?.title || 'Reel', lang: r.lang, voice: r.voice, captions: r.captions, sizes: r.sizes || ['9:16'], script: r.script, shots: (r.shots || []).map((x) => ({ image: brief(T.studio.get(x.imageId)), end: x.endId ? brief(T.studio.get(x.endId)) : null, clip: brief(T.studio.get(x.clipId)), motion: x.motion, seconds: x.seconds, type: x.type || 'scene' })), presenter: r.presenter || null, lines: (r.lines || []).map((l) => ({ text: l.text, url: l.url, tries: l.tries, check: l.check, error: l.error || '' })), outputs: r.outputs || null, links: r.outputs ? Object.fromEntries(Object.entries(r.outputs).map(([k, u]) => [k, publicUrl(u)])) : null, duration: r.duration || null, storyboard: !!r.storyboard, motion: r.motion || 'video', sceneCredits: r.shots ? { start: sceneCost(r, 'start'), end: sceneCost(r, 'end') } : null, ...editorNotes(r), assessment };
}
// the editor's notes on the finished video (studio/qa.js reviewReel), each fix applied through PUT /reels/:id; "reviewing"
// only for a few minutes (a restart mid-review leaves no notes, not a spinner forever)
const editorNotes = (r) => ({ review: r.review || null, reviewing: !!r.reviewing && !r.review && Date.now() - (r.doneAt || 0) < 300000 });
const planOf = (r) => planHash({ script: r.script, aspect: r.aspect, seconds: r.seconds });
const anyView = (a) => (a.kind === 'reel' ? reelView(a) : view(a));

const clip = (v, n) => String(v ?? '').trim().slice(0, n);
export const studioOn = (u) => !!u?.studio?.on;
// a picture the seller already has: only their own uploads (never an arbitrary address — we fetch it to review)
const ownUpload = (userId, url) => {
  const m = /\/uploads\/([\w-]+)\/([\w.-]+\.(png|jpe?g|webp))$/i.exec(String(url || ''));
  if (!m || m[1] !== userId) return false;
  return url === `/uploads/${userId}/${m[2]}` || url === publicUrlFor(`uploads/${userId}/${m[2]}`);
};

export function registerStudio(app, { auth, rateLimit, isTest, wrap }) {
  const limiter = rateLimit({ windowMs: 60000, max: isTest ? 1000 : 20, key: (req) => req.user.id, message: 'You’re making things quickly — wait a minute and try again.' });
  const gate = (req, res) => {
    if (!studioReady()) { res.status(503).json({ error: 'Studio isn’t switched on for this server yet' }); return false; }
    if (!studioOn(req.user)) { res.status(403).json({ error: 'Studio isn’t switched on for your account yet', code: 'STUDIO_OFF' }); return false; }
    return true;
  };
  const who = (req) => req.actor?.email || null;

  app.get('/api/studio', auth, (req, res) => {
    // a Reel's own shots are shown inside the Reel, not again in the gallery
    const rows = T.studio.all({ userId: req.user.id }, { order: 'at', desc: true, limit: 300 }).filter((a) => !a.reelId).slice(0, 200);
    res.json({ on: studioOn(req.user) && studioReady(), tiers: TIERS.map((id) => ({ id, name: TIER_NAMES[id], clipRes: CLIP_RES[id], imageCredits: imageCost(id), clipCreditsPer5s: Object.fromEntries(CLIP_RES[id].map((r) => [r, clipCost(id, 5, r)])), models: tierMenu(id) })), aspects: ASPECTS, languages: Object.entries(LANGUAGES).map(([id, name]) => ({ id, name })), lengths: LENGTHS, captionStyles: CAPTION_IDS.map((id) => ({ id, name: CAPTION_STYLES[id].label })), voices: VOICES.map(({ id, name, note, gender }) => ({ id, name, note, gender, sample: voiceSample(id) })), assets: rows.map(anyView) });
  });
  // images: 1–4 at a time, from words, optionally keeping the seller's real product (their photo as the reference)
  app.post('/api/studio/images', auth, limiter, (req, res) => {
    if (!gate(req, res)) return;
    const b = req.body || {}, prompt = clip(b.prompt, 1500);
    if (prompt.length < 3) return res.status(400).json({ error: 'Describe the image you want' });
    if (b.ref && !ownUpload(req.user.id, b.ref)) return res.status(400).json({ error: 'Pick one of your own photos' });
    const n = Math.min(4, Math.max(1, Math.round(Number(b.count) || 1)));
    const tier = tierOk(b.tier) ? b.tier : 'standard', imodel = b.model ? modelKey('image', tier, b.model) : undefined;
    const made = Array.from({ length: n }, () => enqueue(req.user.id, { kind: 'image', tier, imodel, prompt, aspect: ASPECTS.includes(b.aspect) ? b.aspect : '1:1', ref: b.ref || null, by: who(req), notifyDone: true }));
    res.status(201).json({ assets: made.map(view), credits: n * imageCost(tier, imodel) });
  });
  // clips: from one of the seller's Studio images (or own photo) as the first frame, or from words alone
  app.post('/api/studio/clips', auth, limiter, (req, res) => {
    if (!gate(req, res)) return;
    const b = req.body || {}, prompt = clip(b.prompt, 1500);
    if (prompt.length < 3) return res.status(400).json({ error: 'Describe what should happen in the clip' });
    let ref = null, sourceId = null;
    if (b.sourceId) {
      const s = T.studio.get(b.sourceId);
      if (!s || s.userId !== req.user.id || s.kind !== 'image' || !s.url) return res.status(404).json({ error: 'That image isn’t ready' });
      ref = s.url; sourceId = s.id;
    } else if (b.ref) {
      if (!ownUpload(req.user.id, b.ref)) return res.status(400).json({ error: 'Pick one of your own photos' });
      ref = b.ref;
    }
    const seconds = Math.min(15, Math.max(4, Math.round(Number(b.seconds) || 5)));
    const tier = tierOk(b.tier) ? b.tier : 'standard';
    const vmodel = b.model ? modelKey('clip', tier, b.model) : undefined;
    const a = enqueue(req.user.id, { kind: 'clip', tier, vmodel, res: clipRes(tier, b.res, vmodel), prompt, aspect: ASPECTS.includes(b.aspect) ? b.aspect : '9:16', seconds, ref, sourceId, enhance: b.enhance !== false, by: who(req), notifyDone: true });
    res.status(201).json({ asset: view(a), credits: clipCost(tier, seconds, a.res, vmodel) });
  });
  // what something would cost, before making it: { kind: image|clip|reel, tier, model, count, seconds, res, shots, lines, vmodel, imodel }
  app.post('/api/studio/estimate', auth, (req, res) => {
    const b = req.body || {}, tier = tierOk(b.tier) ? b.tier : 'standard';
    if (b.kind === 'image') return res.json({ credits: Math.min(4, Math.max(1, Math.round(Number(b.count) || 1))) * imageCost(tier, b.model), model: modelKey('image', tier, b.model) });
    if (b.kind === 'clip') { const secs = Math.min(15, Math.max(4, Math.round(Number(b.seconds) || 5))); const k = modelKey('clip', tier, b.model); return res.json({ credits: clipCost(tier, secs, b.res, k), res: clipRes(tier, b.res, k), model: k, byRes: Object.fromEntries(tierMenu(tier).video.find((x) => x.id === k).res.map((r) => [r, clipCost(tier, secs, r, k)])) }); }
    res.json(reelCost({ tier, seconds: LENGTHS.includes(Number(b.seconds)) ? Number(b.seconds) : 30, shots: Math.min(8, Math.max(1, Number(b.shots) || 4)), lines: Math.min(8, Math.max(1, Number(b.lines) || 4)), res: b.res, motion: b.motion, vmodel: b.vmodel, imodel: b.imodel, presenters: Number(b.presenters) || 0, face: !!b.face }));
  });
  const mine = (req, res) => { const a = T.studio.get(req.params.id); if (!a || a.userId !== req.user.id) { res.status(404).json({ error: 'Not found' }); return null; } return a; };
  // a voice's sample, to hear it before choosing: made once per Sarvam voice and kept (no seller data in it, so it's
  // public like any static file — an audio element can't send a sign-in)
  const SAMPLE = 'Namaste! This is how I would sound in your ad — clear, warm and easy to follow.';
  app.get('/api/studio/voices/:speaker/sample', wrap(async (req, res) => {
    const sp = String(req.params.speaker);
    if (!VOICES.some((v) => v.id === `sarvam:${sp}`)) return res.status(404).end();
    const d = path.join(DATA_DIR, 'studio-samples'), f = path.join(d, `${sp}.wav`);
    if (!fs.existsSync(f)) { fs.mkdirSync(d, { recursive: true }); fs.writeFileSync(f, await speak(SAMPLE, 'en-IN', sp)); }
    res.set('Cache-Control', 'public, max-age=604800').type('audio/wav').sendFile(f);
  }));
  app.get('/api/studio/assets/:id', auth, (req, res) => { const a = mine(req, res); if (a) res.json(anyView(a)); });

  // ---------- Reels ----------
  const scriptLimiter = rateLimit({ windowMs: 3600000, max: isTest ? 1000 : 30, key: (req) => req.user.id, message: 'You’ve written a lot of scripts this hour — try again later.' });
  // a brief → the script, straight away (the cheap step); nothing is rendered until it's approved
  app.post('/api/studio/reels', auth, scriptLimiter, wrap(async (req, res) => {
    if (!gate(req, res)) return;
    const b = withPrefs(req.user.id, req.body || {}), brief = clip(b.brief, 1500); // unset choices: the seller's usual
    if (brief.length < 10) return res.status(400).json({ error: 'Tell us what the Reel is about: the product, who it’s for, the offer' });
    for (const k of ['ref', 'logo']) if (b[k] && !ownUpload(req.user.id, b[k])) return res.status(400).json({ error: 'Pick one of your own pictures' });
    const seconds = LENGTHS.includes(Number(b.seconds)) ? Number(b.seconds) : 30;
    const business = req.user.settings?.businessName || req.user.name;
    // a presenter / UGC-style Reel: { presenter: { style: ugc|testimonial|founder, image?|imageId? } } — never a real public figure
    let presenter = null;
    if (b.presenter) {
      if (celebrityIn(brief, b.presenter.note)) return res.status(400).json({ error: CELEBRITY_ERROR });
      const f = pickFace(req.user.id, b.presenter, ownUpload);
      if (f.error) return res.status(400).json({ error: f.error });
      presenter = { style: PRESENTER_STYLES.includes(b.presenter.style) ? b.presenter.style : 'ugc', ...(f.face || {}) };
    }
    let script;
    try { script = await writeScript({ brief, lang: b.lang, seconds, business, aspect: b.aspect, userId: req.user.id, presenter: presenter?.style }); } catch (e) { return res.status(502).json({ error: e.message }); }
    const sizes = (Array.isArray(b.sizes) ? b.sizes : [b.aspect || '9:16']).filter((a) => ['9:16', '1:1', '16:9', '4:5'].includes(a));
    const r = newReel(req.user.id, { brief, aspect: b.aspect, lang: b.lang, seconds, tier: b.tier, vmodel: b.vmodel, imodel: b.imodel, res: b.res, voice: b.voice, captions: b.captions, sizes: sizes.length ? sizes : ['9:16'], ref: b.ref, logo: b.logo, brands: business ? [business] : [], script, presenter, by: who(req) });
    res.status(201).json(reelView(r));
  }));
  const myReel = (req, res, statuses) => {
    const r = mine(req, res); if (!r) return null;
    if (r.kind !== 'reel') { res.status(404).json({ error: 'Not found' }); return null; }
    if (statuses && !statuses.includes(r.status)) { res.status(409).json({ error: r.status === 'producing' || r.status === 'editing' ? 'It’s still being made' : 'It can’t be changed right now' }); return null; }
    return r;
  };
  // the check before spending: quality and virality of the plan, scene by scene and line by line, with changes to apply
  // (free — nothing is rendered). Kept on the Reel until the script changes.
  app.post('/api/studio/reels/:id/assess', auth, scriptLimiter, wrap(async (req, res) => {
    const r = myReel(req, res, ['script_ready', 'storyboard_ready']); if (!r) return;
    const hash = planOf(r);
    if (r.assessment?.hash === hash && !req.body?.again) return res.json(reelView(r));
    const a = await assessReel({ brief: r.prompt, script: r.script, seconds: r.seconds, aspect: r.aspect, motion: req.body?.motion || r.motion, lang: r.lang });
    if (!a) return res.status(503).json({ error: 'The check isn’t available right now — you can still go ahead' });
    res.json(reelView(T.studio.update(r.id, (x) => { x.assessment = { ...a, hash }; })));
  }));
  // the same for one image, ad creative or clip: the words checked, and a stronger version offered
  app.post('/api/studio/assess', auth, scriptLimiter, wrap(async (req, res) => {
    const b = req.body || {}, prompt = clip(b.prompt, 1500);
    if (prompt.length < 3) return res.status(400).json({ error: 'Describe what you want first' });
    const a = await assessPrompt({ kind: b.kind === 'clip' ? 'clip' : 'image', prompt, aspect: b.aspect, seconds: b.seconds, product: !!(b.ref || b.sourceId) });
    if (!a) return res.status(503).json({ error: 'The check isn’t available right now — you can still go ahead' });
    res.json(a);
  }));
  app.put('/api/studio/reels/:id/script', auth, (req, res) => {
    const r = myReel(req, res, ['script_ready']); if (!r) return;
    const b = req.body || {};
    const c = b.script ? cleanScript(b.script) : { script: r.script };
    if (c.error) return res.status(400).json(c);
    if (b.script) learn(r.userId, { kind: 'script_edited', reel: r, script: c.script });
    // the settings can change before anything is made: voice, caption style, sizes
    const sizes = Array.isArray(b.sizes) ? b.sizes.filter((x) => ['9:16', '1:1', '16:9', '4:5'].includes(x)).slice(0, 4) : null;
    res.json(reelView(T.studio.update(r.id, (x) => {
      x.script = c.script;
      if (b.voice) x.voice = voiceId(b.voice);
      if (b.captions !== undefined) x.captions = b.captions && CAPTION_IDS.includes(b.captions.style) ? { style: b.captions.style } : null;
      if (sizes?.length) x.sizes = sizes;
      if (b.res) x.res = clipRes(x.tier, b.res);
    })));
  });
  // the presenter: { face: { image } (their own photo) | { imageId } (a Studio image) | null, scenes: [i…] the scenes a
  // person speaks to camera (the others become ordinary scenes), style } — before anything of those scenes is made
  app.post('/api/studio/reels/:id/presenter', auth, limiter, (req, res) => {
    const r = myReel(req, res, ['script_ready', 'storyboard_ready']); if (!r) return;
    const out = setPresenter(r, req.body || {}, ownUpload);
    if (out.error) return res.status(400).json(out);
    // in a storyboard the scenes' pictures are already drawn: a switched scene keeps its picture as the presenter's (a new
    // face applies to scenes drawn after it)
    res.json(reelView(T.studio.update(r.id, (x) => { x.presenter = out.presenter; if (out.script) x.script = out.script; if (out.shots) x.shots = out.shots; })));
  });
  // the go-ahead: shots and voiceover start (this is where rendering costs begin)
  app.post('/api/studio/reels/:id/approve', auth, limiter, (req, res) => {
    if (!gate(req, res)) return;
    const r = myReel(req, res, ['script_ready']); if (!r) return;
    const c = req.body?.script ? cleanScript(req.body.script) : { script: r.script };
    if (c.error) return res.status(400).json(c);
    if (req.body?.vmodel || req.body?.imodel) T.studio.update(r.id, (x) => { x.vmodel = modelKey('clip', x.tier, req.body.vmodel || x.vmodel); x.imodel = modelKey('image', x.tier, req.body.imodel || x.imodel); });
    if (req.body?.res) T.studio.update(r.id, (x) => { x.res = clipRes(x.tier, req.body.res, x.vmodel); });
    if (req.body?.motion) T.studio.update(r.id, (x) => { x.motion = MOTIONS.includes(req.body.motion) ? req.body.motion : 'video'; });
    learn(r.userId, { kind: 'approve', reel: T.studio.get(r.id), script: c.script });
    res.json(reelView(approveReel(T.studio.get(r.id), c.script, { storyboard: !!req.body?.storyboard })));
  });
  // the storyboard (approved with storyboard: true, stills made): change one scene — { i, note, part } a new picture
  // (one still, two in a storyline), { i, text } new words, { i, to } moved, { i, drop: true } removed
  app.post('/api/studio/reels/:id/storyboard-scene', auth, limiter, (req, res) => {
    if (!gate(req, res)) return;
    const r = myReel(req, res, ['storyboard_ready']); if (!r) return;
    const out = storyboardScene(r, req.body || {});
    if (out.error) return res.status(400).json(out);
    res.json(reelView(out.reel));
  });
  // the go-ahead to animate the storyboard: the clips (this is where most of the cost is), then the edit
  app.post('/api/studio/reels/:id/animate', auth, limiter, (req, res) => {
    if (!gate(req, res)) return;
    const r = myReel(req, res, ['storyboard_ready']); if (!r) return;
    if (req.body?.vmodel) T.studio.update(r.id, (x) => { x.vmodel = modelKey('clip', x.tier, req.body.vmodel); });
    if (req.body?.res) T.studio.update(r.id, (x) => { x.res = clipRes(x.tier, req.body.res, x.vmodel); });
    const out = animateReel(T.studio.get(r.id));
    if (out.error) return res.status(409).json(out);
    res.json(reelView(out.reel));
  });
  // a Reel that stopped part-way: redo only what failed
  app.post('/api/studio/reels/:id/retry', auth, limiter, (req, res) => {
    if (!gate(req, res)) return;
    const r = myReel(req, res, ['failed', 'needs_review']); if (!r) return;
    res.json(reelView(retryReel(r)));
  });
  // changes after it's made: { captions, sizes, lines: [{ i, text }], shots: [{ i, note }], endCard }
  app.put('/api/studio/reels/:id', auth, limiter, (req, res) => {
    if (!gate(req, res)) return;
    const r = myReel(req, res, ['ready', 'needs_review', 'failed']); if (!r) return;
    for (const s of Array.isArray(req.body?.shots) ? req.body.shots : []) learn(r.userId, { kind: 'redo', note: s?.note });
    res.json(reelView(editReel(r, req.body || {})));
  });
  // make it again, with what to change (the note joins the request); a fresh set of attempts
  app.post('/api/studio/assets/:id/redo', auth, limiter, (req, res) => {
    if (!gate(req, res)) return;
    const a = mine(req, res); if (!a) return;
    if (a.kind === 'reel') return res.status(400).json({ error: 'Change a Reel from its own edit options' });
    if (['queued', 'rendering', 'checking'].includes(a.status)) return res.status(409).json({ error: 'It’s still being made' });
    const note = clip(req.body?.note, 300);
    learn(a.userId, { kind: 'redo', note: note || a.fix });
    if (a.kind === 'clip' && req.body?.res) T.studio.update(a.id, (y) => { y.res = clipRes(y.tier, req.body.res); });
    const x = T.studio.update(a.id, (y) => { y.status = 'queued'; y.attempts = 0; y.checkTries = 0; y.notes = note ? [note] : y.fix ? [y.fix] : []; y.error = ''; delete y.qa; delete y.doneAt; delete y.taskId; if (note) y.prompt = `${y.prompt}\n${note}`.slice(0, 1500); });
    res.json(view(x));
  });
  app.delete('/api/studio/assets/:id', auth, (req, res) => {
    const a = mine(req, res); if (!a) return;
    if (a.status === 'rendering') return res.status(409).json({ error: 'Wait for it to finish, then delete it' });
    T.studio.del(a.id);
    res.json({ ok: true });
  });

  // ---------- what Studio remembers about the seller (memory.js): they see it, correct it, add to it or wipe it ----------
  app.get('/api/studio/memory', auth, (req, res) => res.json(memoryOf(req.user.id)));
  // replaces each field given (lists as a whole): the seller's own corrections
  app.put('/api/studio/memory', auth, (req, res) => res.json(setMemory(req.user.id, req.body || {})));
  // adds to it: { likes, avoid, characters, brand, prefs } or { feedback: free text }
  app.post('/api/studio/memory', auth, (req, res) => {
    const b = req.body || {};
    if (b.feedback) learn(req.user.id, { kind: 'feedback', text: b.feedback });
    const { feedback, ...rest } = b;
    res.json(Object.keys(rest).length ? remember(req.user.id, rest) : memoryOf(req.user.id));
  });
  app.delete('/api/studio/memory', auth, (req, res) => { forget(req.user.id); res.json({ ok: true }); });

  // ---------- the platform admin ----------
  const A = [auth, adminMiddleware];
  app.get('/api/admin/studio', ...A, (req, res) => {
    const usage = q(`SELECT json_extract(data, '$.userId') AS userId, COUNT(*) AS items, SUM(json_extract(data, '$.attempts')) AS renders FROM studio GROUP BY userId ORDER BY renders DESC LIMIT 200`).all()
      .map((r) => { const u = T.users.get(r.userId); return { userId: r.userId, email: u?.email || '(deleted)', on: studioOn(u), items: r.items, renders: r.renders || 0 }; });
    // render seconds by model and resolution: the basis for pricing
    const byModel = {};
    for (const row of q('SELECT data FROM studio').all()) for (const u of JSON.parse(row.data).usage || []) { const k = `${u.model} · ${u.resolution || '-'}`; byModel[k] ||= { renders: 0, seconds: 0 }; byModel[k].renders++; byModel[k].seconds += u.seconds || 0; }
    res.json({ ready: studioReady(), models: studioModels(), defaults: DEFAULTS, usage, byModel });
  });
  // a tier on another model: { models: { image|clip: { quick|standard|cinematic: { model, resolution } }, review: { model } } }
  app.put('/api/admin/studio', ...A, (req, res) => {
    const m = req.body?.models || {}, out = {};
    const okModel = (v) => typeof v === 'string' && /^[\w.\-/]{2,80}$/.test(v);
    for (const kind of ['image', 'clip']) for (const t of TIERS) {
      const v = m[kind]?.[t]; if (!v) continue;
      if (v.model && !okModel(v.model)) return res.status(400).json({ error: `${kind} ${t}: that isn’t a model id` });
      if (v.resolution && !/^(480p|720p|1080p|4k|1K|2K|4K)$/.test(v.resolution)) return res.status(400).json({ error: `${kind} ${t}: pick a resolution like 720p or 2K` });
      out[kind] ||= {}; out[kind][t] = { ...(v.model ? { model: v.model } : {}), ...(v.resolution ? { resolution: v.resolution } : {}) };
    }
    for (const k of ['review', 'upscale']) if (m[k]?.model) { if (!okModel(m[k].model)) return res.status(400).json({ error: `${k}: that isn’t a model id` }); out[k] = { model: m[k].model }; }
    savePlatform((s) => { s.studio = { ...(s.studio || {}), models: out }; });
    audit(req, null, 'studio_models', JSON.stringify(out).slice(0, 300));
    res.json({ models: studioModels() });
  });
  app.put('/api/admin/studio/accounts/:uid', ...A, (req, res) => {
    const u = T.users.get(req.params.uid);
    if (!u) return res.status(404).json({ error: 'Account not found' });
    const on = !!req.body?.on;
    T.users.update(u.id, (x) => { x.studio = { ...(x.studio || {}), on, ...(on ? { since: x.studio?.since || Date.now() } : {}) }; });
    audit(req, u.id, on ? 'studio_on' : 'studio_off');
    res.json({ on });
  });
  if (isTest) app.post('/api/__test/studio-tick', async (req, res) => { const n = Number(req.body?.times) || 1; for (let i = 0; i < n; i++) { await tick(); await reelsTick(); } res.json({ ok: true }); });
}
