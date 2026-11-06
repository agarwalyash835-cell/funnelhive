// Reels: a finished vertical ad video from one brief. The cheap step comes first and waits for the seller:
//   script_ready  the AI wrote the hook, voiceover lines, shots and closing card — the seller edits / approves it
//   producing     each shot is an image (keeping the real product) then a clip from it, through the same queue and
//                 quality checks as any Studio item (jobs.js); meanwhile each voiceover line is spoken, listened back
//                 to (voice.js checkLine) and redone up to twice if it was misread
//   editing       the clips, the voiceover, captions timed from what was actually said, the logo and the closing card
//                 are put together (assemble.js) in each size asked for
//   ready / needs_review / failed
// Changes after that (edit): new caption style or sizes → editing again; a reworded line or a redone shot → producing.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { T, q, JOBS, dir as DATA_DIR } from '../db.js';
import { studioAI } from '../ai.js';
import { studioModels, TIERS, ASPECTS, voiceId, sarvamFor, clipRes, modelKey, clipLength, imageCost } from './models.js';
import { speak, TTS_MODEL } from '../sarvam.js';
import { runTask, studioReady } from './kie.js';
import { enqueue } from './jobs.js';
import { localCopy, save, rm, ffmpeg, tmpFile, probe } from './media.js';
import { makeLine, checkLine, sarvamTranscriber, applyPronunciations, LANGUAGES, langBase } from './voice.js';
import { render, dims, stillMotion, moveFor, cardLayout, wideCard, TRANSITION_STYLES, LOOK_IDS } from './assemble.js';
import { overlaysFrom } from './motion.js';
import { makeMusic, MUSIC_MODEL } from './music.js';
import { PRESETS as CAPTION_STYLES } from './captions.js';
import { notify } from '../notify.js';
import { memoryOf, memoryPrompt, withPrefs } from './memory.js';
import { reviewReel } from './qa.js';
import { planHash } from './preflight.js';
import { castShot, castPrompt, resolveCast, brandFont, brandKit, BRAND_FONTS } from './cast.js';
import { kitOf, locked, lockScript, lockedReel, reelLockError } from './brand.js';
import { celebrityIn, CELEBRITY_ERROR, presenterBrief, faceStill, presenterReady, presenterClip, relip, sceneStarts, talks } from './presenter.js';
import { cleanCam, cleanLook, enforceTreatment, filmPrompt, movePrompt } from './cinema.js';
import { HOOKS, STRUCTURES, BEATS, playbookPrompt, checkVideo, reelFormat, cutEvery, gateOf, HOOK_MAX_WORDS } from './standard.js';
import { recipeById, recipePrompt, renderOptions } from './recipes.js';

export const LENGTHS = [15, 30, 45];
export const CAPTION_IDS = Object.keys(CAPTION_STYLES);
const MAX_LINE_TRIES = 3;
const clip = (v, n) => String(v ?? '').trim().slice(0, n);
// the edit's kept parts (assemble.js render cache): one folder per Reel on this server, outside the seller's storage
const keyOf = (x) => crypto.createHash('sha1').update(JSON.stringify(x)).digest('hex').slice(0, 16);
export const cacheDir = (id) => path.join(DATA_DIR, 'studio-cache', String(id).replace(/[^\w-]/g, ''));
export const dropCache = (id) => fs.rm(cacheDir(id), { recursive: true, force: true }, () => {});
// the transcriber for the listen-back check and the captions (none without the platform's speech-to-text key)
const transcriber = () => (process.env.SARVAM_API_KEY ? sarvamTranscriber() : null);

// ---------- the script ----------
const SCRIPT_SYSTEM = `You write short video ads (Instagram Reels, YouTube Shorts, video sales letters) for Indian small businesses.
You are also the director of photography: you write the treatment with the script — one look for the whole video and a camera plan for every shot — so every still is a planned, filmable frame.
Answer only JSON: {"title": short name, "hook": the hook's id from the playbook below, "structure": the structure's id from the playbook, "look": {"palette": 3-4 colours (hex or names), "mood": a few words, "lighting": the lighting setup (key, fill, practicals, time of day), "lens": the lenses / focal lengths, "film": the film look and grade}, "lines": [voiceover lines], "shots": [{"image": a detailed photo prompt for the shot's opening still (subject, setting, light, camera; no text, logos or captions in the picture), "end": a detailed photo prompt for the shot's closing still — the SAME people, place, clothes and light as the opening still, with only what changed by the end of the shot (the action finished, the camera moved), "motion": what moves in the shot (camera move, action), "seconds": 4-8, "beat": this shot's beat from the playbook, "product": true when the product (or the result it gives) is clearly on screen, else false, "cam": {"size": wide|full|medium|close|macro, "angle": eye level|low|high|overhead|dutch|over the shoulder|pov, "lens": focal length like 35mm, "light": this shot's light, "composition": the framing (thirds, symmetry, negative space, foreground), "blocking": where the people and product are and what they do, "move": static|push in|pull out|pan|tilt|dolly|tracking|orbit|handheld|crane}, "type": "presenter" only for a scene where one person speaks the line straight to the camera (testimonials, UGC, a founder talking) — leave it out otherwise}], "endCard": {"headline": max 40 chars, "offer": price or offer max 40 chars, "cta": call to action max 30 chars}, "music": the background music for this ad in a few words — genre, instruments, tempo, mood (instrumental, no artist names)}.
${playbookPrompt()}
Rules: the first line is the hook — at most ${HOOK_MAX_WORDS} words, doing exactly what the chosen hook says, and it stops the scroll in under 2 seconds; the first shot is a striking frame (close or macro on a face, hands or the product, or a moving camera); the product (or its result) is on screen by the second shot; never two shots of the same size back to back — mix wide, medium, close and macro like an agency edit; every image prompt carries the look (palette, light, lens) so the stills match; 3-6 lines, each one short spoken sentence; stay within the word limit given (it's how long the video runs); one shot per line, in order; the shots follow the chosen structure's beats, with the same main person throughout (described the same way in every prompt — age, look, clothes); every person is Indian unless the brief says otherwise; show the real product in most shots; the closing card always has a call to action; never invent claims, prices or offers the brief doesn't give (leave offer empty then); write the lines in the language asked, in that language's own script, naturally spoken (common English words are fine).`;

// treatment false: the editor's own camera plan is kept as given (no sizes changed for variety) — the rules are still
// reported by the Creative Standard
export function cleanScript(s, { treatment = true } = {}) {
  const lines = (Array.isArray(s?.lines) ? s.lines : []).map((x) => clip(typeof x === 'string' ? x : x?.text, 220)).filter(Boolean).slice(0, 8);
  // the treatment (cinema.js) rides along on each shot: its beat, whether the product is on screen, its camera plan
  const bool = (v) => (v === true || v === 'true' ? true : v === false || v === 'false' ? false : null);
  const shots0 = (Array.isArray(s?.shots) ? s.shots : []).slice(0, 8).map((x) => { const cam = cleanCam(x?.cam), product = bool(x?.product); return { image: clip(x?.image, 600), end: clip(x?.end, 600), motion: clip(x?.motion, 300), seconds: Math.min(10, Math.max(4, Math.round(Number(x?.seconds) || 5))), ...(x?.type === 'presenter' ? { type: 'presenter' } : {}), ...(BEATS.includes(x?.beat) ? { beat: x.beat } : {}), ...(product !== null ? { product } : {}), ...(cam ? { cam } : {}) }; }).filter((x) => x.image.length >= 3);
  if (lines.length < 1 || shots0.length < 1) return { error: 'The script needs at least one line and one shot' };
  // a person speaking to camera is never a real public figure (presenter.js)
  if (celebrityIn(...shots0.filter((x) => x.type === 'presenter').map((x) => x.image))) return { error: CELEBRITY_ERROR };
  // the cinematography rules (varied sizes, a striking first frame), applied whatever was sent
  const { shots } = treatment ? enforceTreatment(shots0) : { shots: shots0 };
  const e = s?.endCard || {}, look = cleanLook(s?.look);
  return { script: { title: clip(s?.title, 80) || 'Reel', ...(HOOKS[s?.hook] ? { hook: s.hook } : {}), ...(STRUCTURES[s?.structure] ? { structure: s.structure } : {}), ...(look ? { look } : {}), lines, shots, music: clip(s?.music, 200), endCard: { headline: clip(e.headline, 40), offer: clip(e.offer, 40), cta: clip(e.cta, 30) } } };
}
// the words a Reel of this length has room for: ~2.4 spoken words a second, after the 2.5-second closing card and a breath
export const wordBudget = (seconds) => Math.max(12, Math.round((seconds - 3) * 2.4));
export const wordCount = (script) => (script.lines || []).join(' ').split(/\s+/).filter(Boolean).length;
const parseScript = (text) => { try { return cleanScript(JSON.parse(String(text).trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, ''))); } catch { return { error: 'not JSON' }; } };
export async function writeScript({ brief, lang, seconds, business, aspect = '9:16', userId = null, cast = [], presenter = null, kitId = null, recipe = null }) {
  const budget = wordBudget(seconds);
  // the brand the ad is for: the Reel's brand kit (an agency's client, or one of the seller's brands), else the default
  const kit = userId ? brandKit(userId, kitId) : null;
  const mem = userId ? { ...memoryOf(userId), brand: { name: kit.name, colours: kit.colours, ...(kit.look ? { look: kit.look } : {}) } } : null;
  const user = `Brief: ${brief}\nBusiness: ${kit?.name || business || 'the seller'}\nLanguage of the voiceover: ${LANGUAGES[langBase(lang)] || 'English'}\nFrame: ${aspect === '16:9' ? 'landscape 16:9 (a video on a web page) — compose every still wide' : aspect === '1:1' ? 'square 1:1' : 'vertical 9:16'}${presenterBrief(presenter)}\nLength: ${seconds} seconds in total, including a 2.5-second closing card — so the voiceover is AT MOST ${budget} words in total, across all lines.${userId ? memoryPrompt(mem, kit?.name || business) + castPrompt(userId, cast, kitId) : ''}${recipeById(recipe) ? `\nThe edit style the seller picked (follow its hook, pace and shots):\n${recipePrompt(recipeById(recipe))}` : ''}`;
  let c = parseScript(await studioAI(SCRIPT_SYSTEM, user, { json: true, timeoutMs: 90000 }));
  if (c.error) throw new Error('The AI wrote something that wasn’t a script — please try again');
  // too long for the length asked (a 15-second Reel that runs 22 seconds), or breaking the Creative Standard's script
  // rules (standard.js): ask once to fix it, and keep whichever breaks fewer
  const misses = (sc) => { const n = wordCount(sc); return [...(n > budget * 1.15 ? [`${n} words — too long: at most ${budget} words in total, fewer or shorter lines, the same hook and offer`] : []), ...scriptMisses(sc, { aspect, seconds })]; };
  const was = misses(c.script);
  if (was.length) {
    const again = parseScript(await studioAI(SCRIPT_SYSTEM, `${user}\n\nYour last script breaks these rules — rewrite it to meet every one:\n- ${was.join('\n- ')}\nLast script: ${JSON.stringify(c.script)}`, { json: true, timeoutMs: 90000 }).catch(() => ''));
    if (!again.error && misses(again.script).length < was.length) c = again;
  }
  return kit ? lockScript(c.script, kitOf(userId, kitId)) : c.script;
}
// the Creative Standard's rules a script can fix by itself (the playbook, the hook, the first frame, the product early, the
// call to action) → what's wrong, in words for the writer
const SCRIPT_RULES = ['hook_named', 'structure_named', 'hook_done', 'structure_done', 'hook_short', 'hook_frame', 'shot_variety', 'product_early', 'cta'];
export const scriptMisses = (script, { aspect, seconds } = {}) => checkVideo(script, { format: reelFormat({ aspect }), seconds, aspect, captions: { style: 'pop' } }).rules
  .filter((x) => x.ok === false && SCRIPT_RULES.includes(x.id)).map((x) => `${x.label}: ${x.detail}${x.fix ? ` — ${x.fix}` : ''}`);

// ---------- start, approve ----------
export const REEL_ASPECTS = ['9:16', '16:9', '1:1', '4:5'];
export function newReel(userId, o) {
  // made with a brand kit (the default when none): its logo when none was picked, and always when the kit locks it
  const k = kitOf(userId, o.kitId), picked = o.logo;
  o = withPrefs(userId, o); // what the seller didn't choose: their usual (memory.js — the default kit's logo)
  if (!k.isDefault) o.logo = picked || k.logo || null;
  if (k.logo && locked(k, 'logo')) o.logo = k.logo;
  if (o.script) o.script = lockScript(o.script, k);
  // an industry edit style (recipes.js): its caption look and grade unless the seller picked their own
  const rc = recipeById(o.recipe), ro = rc ? renderOptions(rc) : null;
  return enqueue(userId, { kind: 'reel', status: 'script_ready', kitId: k.id, tier: TIERS.includes(o.tier) ? o.tier : 'standard', vmodel: o.vmodel ? modelKey('clip', o.tier, o.vmodel) : undefined, imodel: o.imodel ? modelKey('image', o.tier, o.imodel) : undefined, res: clipRes(o.tier, o.res, o.vmodel), ...(['video', 'story', 'photo'].includes(o.motion) ? { motion: o.motion } : {}), prompt: o.brief, aspect: REEL_ASPECTS.includes(o.aspect) ? o.aspect : '9:16', seconds: o.seconds, lang: langBase(o.lang) || 'en', voice: voiceId(o.voice), captions: { style: CAPTION_IDS.includes(o.captions) ? o.captions : ro?.captions.style || 'pop' }, ...(rc ? { recipe: rc.id, grade: { base: ro.look.base } } : {}), sizes: o.sizes, ref: o.ref || null, logo: o.logo || null, brands: o.brands || [], cast: resolveCast(userId, o.cast).map((c) => c.id), script: o.script, ...(o.presenter ? { presenter: o.presenter } : {}), by: o.by || null });
}
// the seller's go-ahead (with their edits): the shots go into the queue, the lines wait to be spoken. Storyboard first
// ({ storyboard: true }): only the stills are made (and the lines spoken), then it waits at storyboard_ready for scene
// changes and the go-ahead to animate (animateReel) — the clips, the expensive part, are paid for only then
export function approveReel(r, script, o = {}) {
  // a presenter scene with the seller's chosen face: that picture is its still (presenter.js)
  const shots = script.shots.map((s) => ({ ...s, imageId: s.type === 'presenter' && r.presenter?.image ? faceStill(r, s) : enqueue(r.userId, { kind: 'image', tier: r.tier, imodel: r.imodel, ...castShot(r, s.image, { prompt: filmPrompt(s, script.look) }), aspect: r.aspect, reelId: r.id, by: r.by }).id, clipId: null }));
  return T.studio.update(r.id, (x) => { x.script = script; x.shots = shots; x.lines = script.lines.map((text) => ({ text, url: null, tries: 0, check: null })); x.status = 'producing'; x.approvedAt = Date.now(); if (o.storyboard) x.storyboard = true; else delete x.storyboard; delete x.error; });
}

// ---------- the storyboard: change a scene, then animate ----------
const stillsDone = (r) => r.shots.every((s, i) => done(T.studio.get(s.imageId)) && (r.motion !== 'story' || talks(r, i) || done(T.studio.get(s.endId))));
// a still made again with the note (the job runs it through the queue and its checks again)
const remake = (id, note) => T.studio.update(id, (y) => { y.status = 'queued'; y.attempts = 0; y.checkTries = 0; y.notes = note ? [note] : y.fix ? [y.fix] : []; y.error = ''; if (note) y.prompt = `${y.prompt}\n${note}`.slice(0, 1500); delete y.qa; delete y.taskId; delete y.doneAt; requeued(y); });
// what remaking scene i's picture costs: one still; in a storyline the opening still also brings a new closing one
export const sceneCost = (r, part) => imageCost(r.tier, r.imodel) * (r.motion === 'story' && part !== 'end' ? 2 : 1);
// one change at a time: { i, note, part: 'start'|'end' } a new picture · { i, text } new words · { i, to } moved · { i, drop }
export function storyboardScene(r, b) {
  const i = Number(b.i), shots = [...r.shots], lines = [...r.lines];
  if (!(i >= 0 && i < Math.max(shots.length, lines.length))) return { error: 'There’s no such scene' };
  if (b.drop) {
    if ((i < shots.length && shots.length < 2) || (i < lines.length && lines.length < 2)) return { error: 'A Reel needs at least one scene' };
    shots.splice(i, 1); lines.splice(i, 1);
  } else if (b.to !== undefined && b.to !== null) {
    const to = Math.min(shots.length - 1, Math.max(0, Number(b.to) || 0));
    if (i >= shots.length) return { error: 'That scene has no picture to move' };
    shots.splice(to, 0, shots.splice(i, 1)[0]);
    if (i < lines.length && to < lines.length) lines.splice(to, 0, lines.splice(i, 1)[0]);
  } else if (clip(b.text, 220)) {
    if (!lines[i]) return { error: 'That scene has no line' };
    lines[i] = { text: clip(b.text, 220), url: null, tries: 0, check: null };
  } else {
    const s = shots[i];
    if (!s) return { error: 'That scene has no picture' };
    const note = clip(b.note, 300), end = b.part === 'end' && s.endId;
    if (end) remake(s.endId, note);
    else {
      remake(s.imageId, note);
      // a storyline's closing still is made from the opening one: it's made again once the new opening still is ready
      if (s.endId) { T.studio.del(s.endId); shots[i] = { ...s, endId: null }; }
    }
    if (note) shots[i] = { ...shots[i], [end ? 'end' : 'image']: `${shots[i][end ? 'end' : 'image'] || ''}\n${note}`.trim().slice(0, 600) };
  }
  return { reel: T.studio.update(r.id, (x) => { x.shots = shots; x.lines = lines; x.script = { ...x.script, lines: lines.map((l) => l.text), shots: shots.map(({ image, end, motion, seconds, type, beat, product, cam }) => ({ image, end, motion, seconds, ...(type ? { type } : {}), ...(beat ? { beat } : {}), ...(typeof product === 'boolean' ? { product } : {}), ...(cam ? { cam } : {}) })) }; }) };
}
// the go-ahead to animate: the clips are made (once every line is recorded), then the edit
export function animateReel(r) {
  if (!stillsDone(r)) return { error: 'A scene’s picture is still being made — animate once they’re all there' };
  return { reel: T.studio.update(r.id, (x) => { delete x.storyboard; x.status = 'producing'; delete x.error; }) };
}
// a storyboard with work going on (a still being made again, lines still to record): the loop keeps it moving
const storyboardBusy = (r) => r.lines.some((l) => !l.url && l.tries < MAX_LINE_TRIES) || !stillsDone(r);

// ---------- producing: shots and lines ----------
const done = (a) => a && ['ready', 'needs_review'].includes(a.status) && a.url;
async function produce(r) {
  // a shot's still is ready (or kept for review): its clip goes into the queue
  let shots = r.shots, changed = false;
  // and once its voiceover line is recorded, so the clip lasts as long as the words over it (the cut lands where the line
  // changes; the last shot also covers any lines beyond the last shot, and the breath before the closing card)
  const said = (i) => (r.lines[i]?.secs ? r.lines[i].secs + 0.25 : null);
  // storyline: once a shot's opening still is made, its closing still is made from it (same people and place), and the
  // clip moves from one to the other
  const story = r.motion === 'story';
  shots = shots.map((s, i) => {
    if (s.clipId) return s;
    const img = T.studio.get(s.imageId);
    if (!done(img)) return s;
    if (talks(r, i)) return s; // a presenter: ordered below, once its words are recorded (presenter.js)
    if (story && !s.endId) { changed = true; return { ...s, endId: enqueue(r.userId, { kind: 'image', tier: r.tier, imodel: r.imodel, ...castShot(r, `${s.image}
${s.end}`, { primary: img.url, prompt: `${s.end ? filmPrompt(s, r.script?.look, 'end') : `${s.image}. The moment the shot ends: ${s.motion}`}
Keep the same people, faces, clothes, place and light as the reference picture — only what the action changed.` }), aspect: r.aspect, reelId: r.id, by: r.by }).id }; }
    const endImg = story ? T.studio.get(s.endId) : null;
    if (story && !done(endImg)) return s;
    if (r.storyboard) return s; // the storyboard: stills only, until the seller animates it
    const last = i === shots.length - 1, mine = last ? r.lines.slice(i) : r.lines.slice(i, i + 1);
    if (mine.some((l) => !l.url && l.tries < MAX_LINE_TRIES)) return s; // wait for the words
    const words = mine.reduce((t, l, k) => t + (said(i + k) || 0), 0) + (last ? 0.5 : 0);
    const seconds = clipLength(modelKey('clip', r.tier, r.vmodel), Math.min(story ? 15 : 10, words ? Math.max(4, Math.ceil(words)) : s.seconds)); // fixed-length models round up
    changed = true;
    if (r.motion === 'photo') return { ...s, seconds, still: img.url };
    // clipNote: what the seller asked to change when this clip was made again (editReel)
    return { ...s, seconds, clipId: enqueue(r.userId, { kind: 'clip', tier: r.tier, vmodel: r.vmodel, res: r.res, prompt: [movePrompt(s), s.clipNote].filter(Boolean).join('\n').slice(0, 1500), aspect: r.aspect, seconds, ref: img.url, ...(endImg ? { last: endImg.url } : {}), sourceId: img.id, reelId: r.id, enhance: true, by: r.by }).id };
  });
  if (changed) r = T.studio.update(r.id, (x) => { x.shots = shots; });
  // a presenter scene whose still and words are ready: its lip-synced clip, made from that line's audio
  const t = r.storyboard ? -1 : r.shots.findIndex((_, k) => presenterReady(r, k, done));
  if (t >= 0) return presenterClip(r, t, (fn) => T.studio.update(r.id, fn));
  // photo motion: the editor animates the still here (free, a few seconds) and it's kept as the shot's clip
  const p = r.shots.findIndex((s) => s.still && !s.clipId);
  if (p >= 0) return photoClip(r, p);
  // a shot that couldn't be made even after its retries: stop with the reason (the seller can Retry), don't wait forever
  const lost = r.shots.findIndex((s) => T.studio.get(s.imageId)?.status === 'failed' || (s.endId && T.studio.get(s.endId)?.status === 'failed') || (s.clipId && T.studio.get(s.clipId)?.status === 'failed'));
  if (lost >= 0) {
    const a = T.studio.get(r.shots[lost].clipId) || T.studio.get(r.shots[lost].imageId);
    return T.studio.update(r.id, (x) => { x.status = 'failed'; x.error = `Shot ${lost + 1} couldn’t be made${a?.error ? ` — ${a.error}` : ''}`; x.doneAt = Date.now(); });
  }
  // every still is there: the storyboard waits for the seller (the lines go on being recorded meanwhile)
  if (r.storyboard && r.status === 'producing' && stillsDone(r)) {
    r = T.studio.update(r.id, (x) => { x.status = 'storyboard_ready'; });
    notify(r.userId, { kind: 'support', title: 'Your storyboard is ready', body: r.script.title, link: '/studio' });
  }
  // one voiceover line per step
  const i = r.lines.findIndex((l) => !l.url && l.tries < MAX_LINE_TRIES);
  if (i >= 0) return voiceLine(r, i);
  const clipsDone = r.shots.every((s) => done(T.studio.get(s.clipId)));
  if (clipsDone && r.lines.every((l) => l.url)) T.studio.update(r.id, (x) => { x.status = 'editing'; });
}
async function photoClip(r, i) {
  const s = r.shots[i], out = tmpFile('mp4');
  let src;
  try {
    src = await localCopy(s.still, 'png');
    await stillMotion(src.file, out, { seconds: s.seconds, aspect: r.aspect, move: moveFor(s.cam?.move ? movePrompt(s) : s.motion || '', i) });
    const saved = await save(r.userId, out, 'mp4', 'video/mp4');
    const c = enqueue(r.userId, { kind: 'clip', status: 'ready', tier: r.tier, prompt: s.motion || s.image, aspect: r.aspect, seconds: s.seconds, ref: s.still, sourceId: s.imageId, reelId: r.id, url: saved.url, poster: s.still, photo: true, doneAt: Date.now(), by: r.by });
    T.studio.update(r.id, (x) => { x.shots = x.shots.map((y, j) => (j === i ? { ...y, clipId: c.id } : y)); });
  } catch (e) {
    console.error('photo motion failed', r.id, i, e.message);
    T.studio.update(r.id, (x) => { x.status = 'failed'; x.error = `Shot ${i + 1} couldn’t be animated — try again`; x.doneAt = Date.now(); });
  } finally { rm(out, src?.temp ? src.file : null); }
}

// one line spoken: Sarvam for its own voices (and whenever kie.ai can't — then it's skipped for 10 minutes rather than
// failing line after line), kie.ai's ElevenLabs for the others. → a local audio file
let kieVoiceDownUntil = 0;
async function speakLine(r, i, usage) {
  const m = studioModels().voice, line = r.lines[i], id = voiceId(r.voice);
  const viaSarvam = async (v) => {
    const buf = await speak(applyPronunciations(line.text, r.dict), `${langBase(r.lang) || 'en'}-IN`, v.slice(7));
    const f = tmpFile('wav');
    fs.writeFileSync(f, buf);
    usage({ model: TTS_MODEL(), chars: line.text.length });
    return f;
  };
  if (id.startsWith('sarvam:') || Date.now() < kieVoiceDownUntil) return viaSarvam(sarvamFor(id));
  try {
    return await makeLine({ text: line.text, lang: r.lang, voice: id, model: m.model, dict: r.dict, settings: { before: r.lines[i - 1]?.text || '', after: r.lines[i + 1]?.text || '' } }, { runTask, onUsage: usage });
  } catch (e) {
    console.error('voice: kie.ai couldn’t speak the line, using Sarvam', e.message);
    kieVoiceDownUntil = Date.now() + 10 * 60000;
    return viaSarvam(sarvamFor(id));
  }
}
async function voiceLine(r, i) {
  const line = r.lines[i];
  const usage = (u) => T.studio.update(r.id, (x) => { x.usage = [...(x.usage || []), { kind: 'voice', model: u.model, chars: u.chars, at: Date.now() }]; });
  let file;
  try {
    file = await speakLine(r, i, usage);
    const tr = transcriber();
    const check = tr ? await checkLine({ text: line.text, file, lang: r.lang, brands: r.brands }, { transcribe: tr }).catch((e) => { console.error('voice check failed', e.message); return null; }) : null;
    const tries = line.tries + 1;
    // misread: try again (the next step), unless that was the last try — then keep it and say what's wrong
    if (check && !check.ok && tries < MAX_LINE_TRIES) return setLine(r, i, { tries, check: brief(check) });
    const ext = (file.match(/\.(\w+)$/) || [])[1] || 'mp3';
    const secs = Math.round(((await probe(file)).seconds || 0) * 100) / 100; // how long it's spoken: sets its shot's length
    const saved = await save(r.userId, file, ext, ext === 'mp3' ? 'audio/mpeg' : `audio/${ext}`);
    setLine(r, i, { tries, url: saved.url, secs, check: check ? brief(check) : null });
  } catch (e) {
    console.error('voice line failed', r.id, i, e.message);
    setLine(r, i, { tries: line.tries + 1, error: e.message });
    if (line.tries + 1 >= MAX_LINE_TRIES) T.studio.update(r.id, (x) => { x.status = 'failed'; x.error = `The voiceover for line ${i + 1} couldn’t be made: ${e.message}`; x.doneAt = Date.now(); });
  } finally { rm(file); }
}
const brief = (c) => ({ ok: c.ok, score: c.score, issues: (c.issues || []).map((x) => x.detail).slice(0, 5) });
// by its words (the storyboard can move or drop a scene while its line is being recorded)
const setLine = (r, i, patch) => T.studio.update(r.id, (x) => { const t = r.lines[i].text, k = x.lines[i]?.text === t ? i : x.lines.findIndex((l) => l.text === t && !l.url); x.lines = x.lines.map((l, j) => (j === k ? { ...l, ...patch } : l)); });

// ---------- editing ----------
// the lines → one voiceover with a short breath between them; → { file, spans: [[start, end] per line] }
async function joinVoice(files) {
  const out = tmpFile('wav'), GAP = 0.25, spans = [];
  let t = 0;
  for (const f of files) { const d = (await probe(f)).seconds; spans.push([t, t + d]); t += d + GAP; }
  const inputs = files.flatMap((f) => ['-i', f]);
  const chain = files.map((_, i) => `[${i}:a]aresample=44100,aformat=channel_layouts=mono,apad=pad_dur=${GAP}[a${i}]`).join(';');
  await ffmpeg([...inputs, '-filter_complex', `${chain};${files.map((_, i) => `[a${i}]`).join('')}concat=n=${files.length}:v=0:a=1[out]`, '-map', '[out]', out]);
  return { file: out, spans };
}
// no transcriber: spread each line's words over its time (captions still follow the voice, line by line)
const spreadWords = (lines, spans) => lines.flatMap((l, i) => { const ws = l.text.split(/\s+/).filter(Boolean), [a, z] = spans[i]; const d = (z - a) / (ws.length || 1); return ws.map((w, k) => ({ w, start: a + k * d, end: a + (k + 1) * d })); });

// the closing card, drawn with the caption renderer (libass). With a picture of the product (the first scene's still):
// that picture blurred and darkened as the background, a sharp copy of it on top, then the headline, the offer and the
// call to action as a button. Without one: the same text on the brand colour.
const assEsc = (s) => String(s || '').replace(/[{}\\]/g, '').replace(/\n/g, ' ');
const assHex = (hex, a = 0) => `&H${Math.round(a * 255).toString(16).padStart(2, '0').toUpperCase()}${hex.slice(5, 7)}${hex.slice(3, 5)}${hex.slice(1, 3)}`.toUpperCase();
// style 'matte' (the house look): words left-aligned at a margin in bone white, the call to action as words in a muted
// accent (no button box), a calm charcoal or brand-colour ground, the picture behind it darker and less saturated.
// 'classic': centred words and a button.
export const CARD_STYLES = ['classic', 'matte'];
const MATTE = { ground: '#2B2B2B', text: '#EDE8E0', accent: '#C9A13B' };
// legal: the brand kit's legal line, small along the bottom (left on the matte card)
export async function makeCard(card, colour, aspect, still = null, { style = 'classic', font = 'Noto Sans', legal = '' } = {}) {
  if (!card || !(card.headline || card.offer || card.cta || legal)) return null;
  const { width: W, height: H } = dims(aspect, 1080);
  const brand = /^#[0-9a-f]{6}$/i.test(colour || '') ? colour : null;
  const matte = style === 'matte';
  const hex = brand || (matte ? MATTE.ground : '#111827');
  const ff = String(font || 'Noto Sans').replace(/[,\r\n]/g, ' ');
  // the button in the brand colour over a picture; on the plain brand-colour card it would vanish, so it's white there
  const button = brand ? (still ? brand : '#FFFFFF') : '#FFD400';
  const ass = tmpFile('ass'), png = tmpFile('png');
  const styles = matte ? [
    `Style: Card,${ff},60,${assHex(MATTE.text)},${assHex(MATTE.text)},&H00000000,&H00000000,-1,0,0,0,100,100,0,0,1,0,0,7,60,60,60,1`,
    `Style: Cta,${ff},60,${assHex(MATTE.accent)},${assHex(MATTE.accent)},&H00000000,&H00000000,-1,0,0,0,100,100,2,0,1,0,0,7,60,60,60,1`,
  ] : [
    `Style: Card,${ff},60,&H00FFFFFF,&H00FFFFFF,&H78000000,&H00000000,-1,0,0,0,100,100,0,0,1,3,1,5,60,60,60,1`,
    // the call to action as a button: dark text on an opaque box in the brand colour (yellow without one)
    `Style: Cta,${ff},60,${/^#(ffd|fff|fe|fd|fc)/i.test(button) ? '&H00111111' : '&H00FFFFFF'},&H00FFFFFF,${assHex(button)},&H00000000,-1,0,0,0,100,100,0,0,3,${Math.round(H * 0.018)},0,5,60,60,60,1`,
  ];
  const an = matte ? 7 : 8;
  const events = cardLayout(card, W, H, !!still, matte ? 'left' : 'center').map((b) => `Dialogue: 0,0:00:00.00,0:00:05.00,${b.style},,0,0,0,,{\\an${an}\\pos(${b.x},${b.top})\\fs${b.fs}}${b.lines.map(assEsc).join('\\N')}`);
  if (legal) {
    // above the bottom of the frame (a feed's own buttons sit lower on a vertical video), wrapped by the renderer
    styles.push(`Style: Legal,${ff},${Math.round(H * 0.016)},${assHex(matte ? MATTE.text : '#FFFFFF', 0.25)},&H00FFFFFF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,${matte ? 1 : 2},60,60,${Math.round(H * (H > W * 1.4 ? 0.06 : 0.04))},1`);
    events.push(`Dialogue: 0,0:00:00.00,0:00:05.00,Legal,,0,0,0,,${assEsc(legal)}`);
  }
  fs.writeFileSync(ass, `[Script Info]\nScriptType: v4.00+\nPlayResX: ${W}\nPlayResY: ${H}\nWrapStyle: 0\nScaledBorderAndShadow: yes\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n${styles.join('\n')}\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n${events.join('\n')}\n`);
  const fileArg = ass.replace(/\\/g, '/').replace(/^([A-Za-z]):/, '$1\\:');
  if (still) {
    // the sharp copy: as big as fits in the top part, whatever its shape (in a wide frame: the left side)
    const wide = wideCard(W, H, still), fw = Math.round(W * (wide ? 0.46 : 0.72)), fh = Math.round(H * (wide ? 0.8 : 0.44));
    await ffmpeg(['-i', still, '-frames:v', '1', '-filter_complex', `[0]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},boxblur=40:2,eq=brightness=${matte ? '-0.38:saturation=0.7' : '-0.3:saturation=1.15'}[bg];[0]scale=${fw}:${fh}:force_original_aspect_ratio=decrease[fg];[bg][fg]overlay=${wide ? `${Math.round(W * 0.27)}-w/2:(H-h)/2` : `(W-w)/2:${Math.round(H * 0.27)}-h/2`},ass='${fileArg}'`, png], { timeoutMs: 60000 });
  }
  if (!fs.existsSync(png)) await ffmpeg(['-f', 'lavfi', '-i', `color=c=${hex}:s=${W}x${H}:d=1`, '-frames:v', '1', '-vf', `ass='${fileArg}'`, png], { timeoutMs: 60000 });
  rm(ass);
  return fs.existsSync(png) ? png : null;
}

// How a Reel is cut, from its edit style (recipes.js renderOptions; null for a Reel made without one) and the seller's
// own picks (r.transitions). → { transitions, sfx, punch (s), emphasis, beatSync, ramp (shot index, -1: none) }
//   every: the Creative Standard's longest hold for this format (standard.js cutEvery)
// Beat-synced cuts need a music bed and free cuts: a presenter's scenes are tied to their lines, so not then.
// The speed ramp goes on the first close or macro shot (the product's hero moment), never on a presenter speaking.
export function editStyle(r, ro, { starts = null, music = false, every = 0 } = {}) {
  const emphasis = ro?.punch === 'emphasis';
  const punch = ro?.punch === 'off' || emphasis ? 0 : Math.min(...[every, ro?.cutEvery].filter((x) => x > 0), Infinity);
  let ramp = -1;
  if (ro?.speedRamp) {
    const ok = (r.shots || []).map((s, i) => !talks(r, i));
    ramp = (r.shots || []).findIndex((s, i) => ok[i] && ['close', 'macro'].includes((s.cam || r.script?.shots?.[i]?.cam || {}).size));
    if (ramp < 0) ramp = ok.indexOf(true);
  }
  return {
    transitions: TRANSITION_STYLES.includes(r.transitions) ? r.transitions : ro?.transitions || 'cinematic',
    sfx: ro ? (ro.sfx?.length ? [...ro.sfx] : false) : true,
    punch: Number.isFinite(punch) ? punch : 0, emphasis, beatSync: !!(ro?.beatSync && music && !starts), ramp,
  };
}

async function edit(r) {
  // the brand kit's locked elements, whatever the row holds (the logo, the colours, the font, the call to action)
  const kit = kitOf(r.userId, r.kitId);
  r = lockedReel(r, kit);
  const temp = [];
  const local = async (url, ext) => { const c = await localCopy(url, ext); if (c.temp) temp.push(c.file); return c.file; };
  try {
    const clips = [];
    for (const s of r.shots) clips.push(await local(T.studio.get(s.clipId).url, 'mp4'));
    const lineFiles = [];
    for (const l of r.lines) lineFiles.push(await local(l.url, (l.url.match(/\.(\w+)$/) || [])[1] || 'mp3'));
    const voice = await joinVoice(lineFiles);
    temp.push(voice.file);
    // the transcript is kept with the voiceover it came from: a re-edit that didn't change a line doesn't send it again
    const voiceKey = keyOf(r.lines.map((l) => l.url));
    let words = r.words?.key === voiceKey ? r.words.list : null;
    const tr = transcriber();
    if (!words && tr) {
      words = (await tr(voice.file, r.lang).catch((e) => { console.error('caption transcript failed', e.message); return null; }))?.words || null;
      if (words?.length) T.studio.update(r.id, (x) => { x.words = { key: voiceKey, list: words }; });
    }
    if (!words?.length) words = spreadWords(r.lines, voice.spans);
    const owner = T.users.get(r.userId);
    const font = brandFont(r.userId, r.kitId);
    // the closing card shows the product: the first scene's still
    const firstStill = T.studio.get(r.shots?.[0]?.imageId)?.url;
    const still = firstStill ? await local(firstStill, 'png').catch(() => null) : null;
    // the card's colour: the Reel's own, else the kit's (first when the kit is a client's or its colours are locked)
    const kitColour = kit.colours?.[0], kitFirst = !kit.isDefault || locked(kit, 'colours');
    const card = await makeCard(r.script.endCard, r.cardColour || (kitFirst && kitColour) || owner?.settings?.brandColor || owner?.settings?.whiteLabel?.primary || kitColour, r.aspect, still, { style: r.cardStyle || 'classic', font, legal: kit.legal || '' });
    if (card) temp.push(card);
    const logo = r.logo && !r.logoOpts?.off ? await local(r.logo, 'png').catch(() => null) : null;
    // the music bed: made once for the Reel (in the script's mood, as long as the voiceover) and kept, so re-edits reuse it
    let music = null;
    if (r.music !== false) {
      if (!r.musicUrl) {
        const made = await makeMusic({ mood: r.script.music, seconds: (await probe(voice.file)).seconds + 3, title: r.script.title });
        if (made) { temp.push(made); const saved = await save(r.userId, made, 'mp3', 'audio/mpeg'); T.studio.update(r.id, (x) => { x.musicUrl = saved.url; x.usage = [...(x.usage || []), { kind: 'music', model: MUSIC_MODEL.version, at: Date.now() }]; }); music = made; }
      } else music = await local(r.musicUrl, 'mp3').catch(() => null);
    }
    const sizes = (r.sizes?.length ? r.sizes : ['9:16']).filter((a) => ASPECTS.includes(a) && ['9:16', '1:1', '16:9', '4:5'].includes(a));
    // presenter scenes: each scene starts exactly where its line does, and a presenter keeps its pace (lips in sync)
    const starts = sceneStarts(r.shots, voice.spans);
    // the Creative Standard's pace for this format: long shots get punch-in cuts (free, in the edit)
    const format = reelFormat(r);
    // the heavy parts are kept between edits (assemble.js render cache): their keys are everything they depend on
    const look = r.grade || 'cinematic', musicDb = Number.isFinite(r.musicDb) ? r.musicDb : -19, short = r.tier === 'cinematic' ? 1080 : 720;
    // the industry edit style (recipes.js): its transitions, sound design, pace, overlays and beat-synced cuts
    const ro = recipeById(r.recipe) ? renderOptions(recipeById(r.recipe)) : null;
    const fx = editStyle(r, ro, { starts, music: !!music, every: cutEvery(format) });
    const clipUrls = r.shots.map((s) => T.studio.get(s.clipId)?.url || '');
    const cache = { dir: cacheDir(r.id), pic: keyOf([clipUrls, voiceKey, look, format, starts, short, fx.transitions, fx.ramp, fx.beatSync, fx.emphasis]), audio: keyOf([clipUrls, voiceKey, r.music === false ? 'off' : r.musicUrl || 'new', musicDb, starts, fx.sfx, fx.beatSync, fx.transitions]) };
    const caps = r.captions?.style ? { style: r.captions.style, font: r.captions.font || font, ...(r.captions.colour ? { colour: r.captions.colour } : {}), ...(Number.isFinite(r.captions.y) ? { y: r.captions.y } : {}), ...(r.captions.align ? { align: r.captions.align } : {}), ...(ro?.captions.keywords ? { keywords: ro.captions.keywords } : {}) } : null;
    // the motion graphics the style asks for, filled from what the seller told us (missing values are left out)
    const info = r.overlayInfo || {};
    // (timed once render knows how long the picture runs before the closing card)
    const overlays = ro?.overlays?.length ? (duration) => overlaysFrom({ offer: r.script.endCard?.offer, price: info.price || r.script.endCard?.offer, location: info.location, business: kit.name || owner?.settings?.businessName, stat: info.stat, deadline: info.deadline, name: info.name || kit.name, phone: info.phone, whatsapp: info.whatsapp || owner?.settings?.supportWhatsapp, duration, wants: ro.overlays }) : null;
    const out = await render({ ...(starts ? { starts, synced: r.shots.map((s, i) => talks(r, i)) } : {}), clips, voice: voice.file, music, musicDb, words, look, transitions: fx.transitions, sfx: fx.sfx, punch: fx.punch, emphasis: fx.emphasis, beatSync: fx.beatSync, ramp: fx.ramp, overlays, captions: caps, logo: logo ? { file: logo, position: r.logoOpts?.position || 'top-right', size: r.logoOpts?.size || 0.18 } : null, endCard: card ? { image: card, seconds: 2.5 } : null, sizes, short, name: 'reel', cache });
    const outputs = {};
    for (const [aspect, f] of Object.entries(out.files)) { temp.push(f); outputs[aspect] = (await save(r.userId, f, 'mp4', 'video/mp4')).url; }
    const first = out.files[sizes[0]] || Object.values(out.files)[0];
    const pf = tmpFile('jpg'); temp.push(pf);
    await ffmpeg(['-ss', '0.5', '-i', first, '-frames:v', '1', '-vf', 'scale=480:-2', '-q:v', '4', pf], { timeoutMs: 30000 });
    const poster = fs.existsSync(pf) ? (await save(r.userId, pf, 'jpg', 'image/jpeg')).url : null;
    // anything kept for review along the way: the Reel is made, but the seller should look
    const flagged = [...r.shots.flatMap((s, i) => (T.studio.get(s.clipId)?.status === 'needs_review' ? [`Shot ${i + 1}: ${(T.studio.get(s.clipId).qa?.issues || []).join('; ')}`] : [])), ...r.lines.flatMap((l, i) => (l.check && !l.check.ok ? [`Line ${i + 1}: ${l.check.issues.join('; ')}`] : []))];
    const url = outputs[sizes[0]] || Object.values(outputs)[0];
    T.studio.update(r.id, (x) => { x.outputs = outputs; x.url = url; x.poster = poster; x.duration = Math.round(out.duration * 10) / 10; x.lufs = out.lufs; x.doneAt = Date.now(); x.reviewing = true; delete x.review; delete x.error; });
    // the editor's notes on the finished video (free; a reviewer that fails costs nothing — the Reel then waits for a look)
    const review = await reviewReel({ file: first, script: r.script, lines: r.lines.map((l) => l.text), words, spans: voice.spans, captions: r.captions?.style || null }).catch((e) => { console.error('reel review failed', r.id, e.message); return null; });
    // the gate (standard.js): ready only when every rule of its format passes, measured on the render, AND the review
    // scored at least the bar; otherwise needs_review with the failing rules and their fixes
    const measured = { duration: out.duration, segments: out.segments, firstWord: words[0] ? Number(words[0].start) + 0.15 : null };
    const assessment = r.assessment?.hash === planHash({ script: r.script, aspect: r.aspect, seconds: r.seconds }) ? r.assessment : null;
    const standard = checkVideo(r.script, { format, seconds: r.seconds, aspect: r.aspect, captions: r.captions, secs: r.lines.map((l) => l.secs), assessment, measured });
    const gate = gateOf(standard, review?.score);
    // a free fix the standard makes without asking: captions back on (most feeds play muted) — once, then re-edited and
    // re-checked (the seller can turn them off again). Nothing paid is ever redone here.
    const fixCaptions = standard.rules.some((x) => x.id === 'captions_on' && x.ok === false) && !(r.autoFixed || []).includes('captions');
    let status = null;
    T.studio.update(r.id, (x) => {
      if (x.url !== url || !x.doneAt) return; // changed since
      x.review = review; delete x.reviewing; x.standard = standard; x.gate = gate;
      if (fixCaptions) { x.captions = { style: 'pop' }; x.autoFixed = [...(x.autoFixed || []), 'captions']; x.status = 'editing'; x.editTries = 0; delete x.doneAt; return; }
      status = x.status = flagged.length || !gate.ready ? 'needs_review' : 'ready';
      x.qa = { issues: [...flagged, ...gate.issues].slice(0, 10) };
    });
    if (status) notify(r.userId, { kind: 'support', title: status === 'ready' ? 'Your Reel is ready' : 'Your Reel is made — have a look before posting', body: r.script.title, link: '/studio' });
  } catch (e) {
    console.error('reel edit failed', r.id, e.message, e.detail || '');
    T.studio.update(r.id, (x) => { x.editTries = (x.editTries || 0) + 1; if (x.editTries >= 2) { x.status = 'failed'; x.error = 'The video couldn’t be put together — try again'; x.doneAt = Date.now(); } });
  } finally { rm(...temp); }
}

// ---------- retry: a Reel that stopped (a shot or a line that couldn't be made, or the edit) carries on ----------
// Only what failed is done again: failed shots go back in the queue, lines with no voice get fresh tries, and a Reel
// whose parts are all there is edited again.
export function retryReel(r) {
  for (const s of r.shots || []) for (const id of [s.imageId, s.endId, s.clipId]) {
    const a = id && T.studio.get(id);
    if (a?.status === 'failed') T.studio.update(a.id, (y) => { y.status = 'queued'; y.attempts = 0; y.error = ''; delete y.taskId; delete y.doneAt; requeued(y); });
  }
  return T.studio.update(r.id, (x) => {
    x.lines = (x.lines || []).map((l) => (l.url ? l : { ...l, tries: 0, error: '' }));
    const ready = x.lines.every((l) => l.url) && (x.shots || []).every((s) => ['ready', 'needs_review'].includes(T.studio.get(s.clipId)?.status));
    x.status = ready ? 'editing' : 'producing'; x.editTries = 0; delete x.error; delete x.doneAt;
  });
}

// ---------- changes after it's made (from the Studio page, Hive or studio/edit.js) ----------
// Free (re-edit only): captions { style, colour, font, y, align } | null · sizes · endCard · cardStyle · cardColour ·
//   look { base, brightness, contrast, saturation, warmth } · music { off, volume } · logo { position, size, off }
// Paid: voice (every line again) · lines [{ i, text }] · music { mood } (a new track) ·
//   shots [{ i, note } a new clip from the same picture | { i, picture } the picture itself edited, then a new clip |
//          { i, move, note? } the camera move changed, a new clip]
// A changed shot gets a NEW clip row (the old one stays until versions.js lets it go), so an edit can be undone.
export const LOOK_BASES = LOOK_IDS;
export const LOGO_PLACES = ['top-left', 'top-right', 'bottom-left', 'bottom-right'];
const CAPTION_FONTS = Object.values(BRAND_FONTS).map((f) => f.family);
const hexOk = (v) => /^#[0-9a-f]{6}$/i.test(String(v || ''));
const nudge = (v, was) => (v === undefined || v === null ? was || 0 : Math.max(-2, Math.min(2, Math.round(Number(v) || 0))));
export const cleanGrade = (g, was = {}) => {
  const w = typeof was === 'string' ? { base: was } : was || {};
  const out = { base: LOOK_BASES.includes(g?.base) ? g.base : w.base || 'cinematic' };
  for (const k of ['brightness', 'contrast', 'saturation', 'warmth']) { const n = nudge(g?.[k], w[k]); if (n) out[k] = n; }
  return out;
};
// the words for a picture edited in place: the current picture goes in as the reference, so only the change is made
export const EDIT_PICTURE = (what, was = '') => `Edit the reference picture: ${clip(what, 300)}. Change only what this asks; keep everything it doesn't mention exactly as it is — the product, the people (faces, hair, clothes), the place, the light and the look.${was ? `\nThe picture shows: ${clip(was, 600)}` : ''}`;
export function editStill(id, what) {
  const img = T.studio.get(id);
  if (!img?.url || ['queued', 'rendering', 'checking'].includes(img.status)) return null;
  return T.studio.update(id, (y) => { y.status = 'queued'; y.attempts = 0; y.checkTries = 0; y.notes = []; y.error = ''; y.ref = img.url; y.prompt = EDIT_PICTURE(what, img.basePrompt || img.prompt); y.basePrompt ||= img.prompt; y.edits = [...(y.edits || []), clip(what, 300)].slice(-5); delete y.qa; delete y.taskId; delete y.doneAt; requeued(y); });
}
// a row made again starts clean of the queue's own retry marks (jobs.js)
export const requeued = (y) => { for (const k of ['staleTask', 'overtime', 'startTries', 'notBefore', 'paused', 'saved', 'posterSaved']) delete y[k]; return y; };
export function editReel(r, b) {
  const lines = [...r.lines], shots = [...r.shots], plan = [...(r.script?.shots || [])];
  let reproduce = false;
  // another voice: every line is spoken again
  let voice = null;
  if (b.voice && voiceId(b.voice) !== r.voice) { voice = voiceId(b.voice); for (let i = 0; i < lines.length; i++) lines[i] = { text: lines[i].text, url: null, tries: 0, check: null }; reproduce = true; }
  for (const { i, text } of Array.isArray(b.lines) ? b.lines : []) { if (lines[i] && clip(text, 220)) { lines[i] = { text: clip(text, 220), url: null, tries: 0, check: null }; reproduce = true; } }
  for (const sb of Array.isArray(b.shots) ? b.shots : []) {
    const i = Number(sb?.i), s = shots[i];
    if (!s) continue;
    const note = clip(sb.note, 300);
    // the picture itself, edited with the change (then a new clip from it; a storyline's closing picture follows it)
    if (clip(sb.picture, 300)) {
      if (!editStill(s.imageId, sb.picture)) continue;
      shots[i] = { ...s, endId: null, clipId: null, still: null, clipNote: '' };
      reproduce = true;
      continue;
    }
    const c = s.clipId && T.studio.get(s.clipId);
    // another camera move: the plan changes and a new clip follows it
    if (sb.move) {
      const move = cleanCam({ move: sb.move })?.move;
      if (!move) continue;
      const cam = { ...(s.cam || plan[i]?.cam || {}), move };
      shots[i] = { ...s, cam, clipId: null, still: null, clipNote: note };
      if (plan[i]) plan[i] = { ...plan[i], cam };
      reproduce = true;
      continue;
    }
    if (!c) continue;
    // photo motion: a new still (with the change), animated again once it's made
    if (c.photo) {
      T.studio.update(s.imageId, (y) => { y.status = 'queued'; y.attempts = 0; y.checkTries = 0; y.notes = note ? [note] : y.fix ? [y.fix] : []; if (note) y.prompt = `${y.prompt}\n${note}`.slice(0, 1500); delete y.qa; delete y.taskId; delete y.doneAt; requeued(y); });
      shots[i] = { ...s, still: null, clipId: null };
      reproduce = true;
      continue;
    }
    // a new clip from the same picture, with the note (or the quality check's own fix)
    shots[i] = { ...s, clipId: null, clipNote: note || c.fix || '' };
    reproduce = true;
  }
  // a scene dropped or moved after it's made: only the edit runs again (its picture, clip and line go with it)
  const order = (from, to) => { for (const list of [shots, lines, plan]) if (from < list.length) list.splice(Math.min(to, list.length - 1), 0, list.splice(from, 1)[0]); };
  for (const i of (Array.isArray(b.drop) ? b.drop : []).map(Number).filter((i) => i >= 0).sort((a, z) => z - a)) {
    if (shots.length < 2 && lines.length < 2) break;
    if (i < shots.length && shots.length > 1) shots.splice(i, 1);
    if (i < lines.length && lines.length > 1) lines.splice(i, 1);
    if (i < plan.length && plan.length > 1) plan.splice(i, 1);
  }
  if (b.move && Number.isInteger(Number(b.move.i)) && Number.isInteger(Number(b.move.to))) order(Number(b.move.i), Math.max(0, Number(b.move.to)));
  // a presenter speaking a line that changed (or in another voice) gets a new lip-synced clip
  const relipped = relip(shots, lines.length, new Set(lines.flatMap((l, i) => (!l.url && r.lines[i]?.url ? [i] : []))));
  for (let i = 0; i < shots.length; i++) if (relipped[i] !== shots[i]) { shots[i] = relipped[i]; reproduce = true; }
  return T.studio.update(r.id, (x) => {
    applySettings(x, b);
    if (voice) x.voice = voice;
    x.lines = lines; x.shots = shots; x.script = { ...x.script, lines: lines.map((l) => l.text), ...(plan.length ? { shots: plan } : {}) };
    x.status = reproduce ? 'producing' : 'editing'; x.editTries = 0; delete x.doneAt; delete x.error;
  });
}
// the free settings, on the row being updated (also before the Reel is made: studio/edit.js)
export function applySettings(x, b) {
  // another edit style (recipes.js): its caption look, grade and transitions come with it; anything else in the same
  // change (b.captions, b.look, b.transitions below) still wins. null: back to the standard edit.
  if (b.recipe === null) delete x.recipe;
  else if (recipeById(b.recipe)) {
    const ro = renderOptions(recipeById(b.recipe));
    x.recipe = b.recipe;
    x.captions = { ...(x.captions || {}), style: ro.captions.style };
    x.grade = { ...(typeof x.grade === 'object' ? x.grade : {}), base: ro.look.base };
    delete x.transitions;
  }
  {
    if (b.captions) {
      const was = x.captions || {};
      x.captions = { style: CAPTION_IDS.includes(b.captions.style) ? b.captions.style : was.style || 'pop' };
      const colour = b.captions.colour === undefined ? was.colour : b.captions.colour, font = b.captions.font === undefined ? was.font : b.captions.font;
      const y = b.captions.y === undefined ? was.y : Number(b.captions.y), align = b.captions.align === undefined ? was.align : b.captions.align;
      if (hexOk(colour)) x.captions.colour = colour;
      if (CAPTION_FONTS.includes(font)) x.captions.font = font;
      if (Number.isFinite(y) && y >= 0.1 && y <= 0.9) x.captions.y = Math.round(y * 100) / 100;
      if (['left', 'center'].includes(align)) x.captions.align = align;
    }
    if (b.captions === null) x.captions = null;
    if (Array.isArray(b.sizes)) { const s = b.sizes.filter((a) => ['9:16', '1:1', '16:9', '4:5'].includes(a)).slice(0, 4); if (s.length) x.sizes = s; }
    if (b.endCard) x.script = { ...x.script, endCard: { headline: clip(b.endCard.headline, 40), offer: clip(b.endCard.offer, 40), cta: clip(b.endCard.cta, 30) } };
    if (CARD_STYLES.includes(b.cardStyle)) x.cardStyle = b.cardStyle;
    if (b.cardColour === null) delete x.cardColour; else if (hexOk(b.cardColour)) x.cardColour = b.cardColour;
    if (b.look) x.grade = cleanGrade(b.look, x.grade || 'cinematic');
    if (TRANSITION_STYLES.includes(b.transitions)) x.transitions = b.transitions;
    if (b.transitions === null) delete x.transitions;
    // what the overlays show (a price, the place, a number to count up, the phone or WhatsApp on the closing panel)
    if (b.overlayInfo && typeof b.overlayInfo === 'object') {
      const o = { ...(x.overlayInfo || {}) };
      for (const k of ['price', 'location', 'stat', 'deadline', 'name']) if (b.overlayInfo[k] !== undefined) o[k] = clip(b.overlayInfo[k], 60);
      for (const k of ['phone', 'whatsapp']) if (b.overlayInfo[k] !== undefined) o[k] = clip(String(b.overlayInfo[k]).replace(/[^\d+ -]/g, ''), 20);
      x.overlayInfo = Object.fromEntries(Object.entries(o).filter(([, v]) => v));
    }
    if (b.music) {
      if (b.music.off === true) x.music = false;
      if (b.music.off === false) delete x.music;
      if (b.music.volume !== undefined && Number.isFinite(Number(b.music.volume))) x.musicDb = Math.max(-32, Math.min(-8, Math.round(Number(b.music.volume))));
      if (clip(b.music.mood, 200)) { x.script = { ...x.script, music: clip(b.music.mood, 200) }; delete x.musicUrl; delete x.music; }
    }
    if (b.logo) {
      const was = x.logoOpts || {};
      x.logoOpts = { position: LOGO_PLACES.includes(b.logo.position) ? b.logo.position : was.position || 'top-right', size: Number.isFinite(Number(b.logo.size)) ? Math.max(0.08, Math.min(0.32, Number(b.logo.size))) : was.size || 0.18, ...(b.logo.off === true || (b.logo.off === undefined && was.off) ? { off: true } : {}) };
    }
  }
  return x;
}

// ---------- the loop ----------
// A few Reels move at once, at most PER_ACCOUNT of one seller's (a seller's batch can't hold up everyone else's): the
// voiceover steps are light; the edit runs ffmpeg, the heavy part, so fewer of those.
const MAX_PRODUCING = Number(process.env.STUDIO_MAX_REELS || 4), MAX_EDITING = Number(process.env.STUDIO_MAX_EDITS || 1), PER_ACCOUNT = 2;
const busy = new Map(); // reel id → { userId, editing }
export async function reelsTick() {
  if (!studioReady()) return;
  const rows = q("SELECT data FROM studio WHERE status IN ('producing', 'editing', 'storyboard_ready') ORDER BY at").all().map((x) => JSON.parse(x.data)).filter((x) => x.kind === 'reel' && (x.status !== 'storyboard_ready' || storyboardBusy(x)));
  const jobs = [], perAccount = new Map();
  let producing = 0, editing = 0;
  for (const b of busy.values()) { perAccount.set(b.userId, (perAccount.get(b.userId) || 0) + 1); if (b.editing) editing++; else producing++; }
  for (const r of rows) {
    if (busy.has(r.id) || (perAccount.get(r.userId) || 0) >= PER_ACCOUNT) continue;
    const run = (fn, isEdit) => { busy.set(r.id, { userId: r.userId, editing: isEdit }); perAccount.set(r.userId, (perAccount.get(r.userId) || 0) + 1); jobs.push(fn(r).catch((e) => console.error('reel step failed', r.id, e.message)).finally(() => busy.delete(r.id))); };
    if (['producing', 'storyboard_ready'].includes(r.status) && producing < MAX_PRODUCING) { producing++; run(produce, false); }
    else if (r.status === 'editing' && editing < MAX_EDITING) { editing++; run(edit, true); }
  }
  await Promise.all(jobs);
}
if (JOBS && process.env.NODE_ENV !== 'test') setInterval(() => { reelsTick().catch((e) => console.error('reels tick failed', e.message)); }, 6000).unref();
