// One way to change anything in Studio — the canvas controls and the chat ("make the background darker", "swap scene
// 3 for a close-up", "change the caption font") both come through here, so every change is priced the same way, is
// free whenever it can be, and can be undone (versions.js).
//   target   what the change is aimed at: 'reel' · 'scene:N' (from 0) · 'image' · 'clip' · 'design' · 'slide:N'
//   change   plain fields — EDITS below lists them per target
// planEdit → what would happen and what it costs (nothing changes); applyEdit → snapshot, then the change.
// A picture is EDITED, not made again: the current picture goes in as the reference with the change, so everything the
// seller didn't mention stays as it is (reels.js editStill).
import { T } from '../db.js';
import { imageCost, clipCost, presenterCost, musicCost, voiceId } from './models.js';
import { editReel, editStill, applySettings, storyboardScene, cleanScript, requeued, EDIT_PICTURE, LOOK_BASES, LOGO_PLACES, CARD_STYLES } from './reels.js';
import { editDesign, makeBackground, renderDesign } from './designs.js';
import { enqueue } from './jobs.js';
import { snapshot, restore, busyOf, versionsOf } from './versions.js';
import { cleanCam } from './cinema.js';
import { BRAND_FONTS } from './cast.js';

const clip = (v, n) => String(v ?? '').trim().slice(0, n);
const ACTIVE = ['queued', 'rendering', 'checking'];

// what can be changed, per target — also the Hive tool's description (hive-studio.js studio_edit)
export const EDITS = {
  reel: {
    free: ['captions { style, colour "#rrggbb", font, y 0.1–0.9 (how far down), align left|center } or null for none', `look { base ${LOOK_BASES.join('|')}, brightness, contrast, saturation, warmth: each -2…2 (0 = as made) }`, 'music { off true|false, volume dB -32…-8 (default -19) }', `logo { position ${LOGO_PLACES.join('|')}, size 0.08–0.32, off }`, 'endCard { headline, offer, cta }', `cardStyle ${CARD_STYLES.join('|')}`, 'cardColour "#rrggbb"', 'sizes [9:16, 1:1, 4:5, 16:9]'],
    paid: ['voice (another voice id: every line recorded again)', 'music { mood } (a new track)'],
  },
  scene: {
    free: ['drop true (remove the scene)', 'to N (move it)', 'before it is made: prompt { image, motion, seconds, move, size }'],
    paid: ['picture "what to change in its picture" (the picture is edited, then its clip made again)', 'clip "what to change in the movement" (a new clip from the same picture)', 'move push in|pull out|pan|tilt|dolly|tracking|orbit|handheld|crane|static (a new clip)', 'line "new words" (that line recorded again)'],
  },
  image: { paid: ['picture "what to change" (the picture is edited, everything else kept)'] },
  clip: { paid: ['clip "what to change" (a new clip from the same first frame)'] },
  design: { free: ['text { headline, sub, cta, … } (the first slide)', 'colours ["#rrggbb", "#rrggbb"]', 'family sans|serif|display', 'format square|portrait|story|thumbnail', 'template', 'brand { name }'], paid: ['background "what to change in the picture" (the picture is edited)'] },
  slide: { free: ['text { headline, sub, cta, … }'] },
};

export function parseTarget(t) {
  const m = /^(reel|image|clip|design)$|^(scene|slide):(\d{1,2})$/.exec(String(t || '').trim().toLowerCase());
  if (!m) return null;
  return m[1] ? { part: m[1] } : { part: m[2], i: Number(m[3]) };
}

// the clip a Reel's scene i would cost to make again
const sceneClipCost = (r, i) => {
  const s = r.shots?.[i], c = s?.clipId && T.studio.get(s.clipId);
  if (r.motion === 'photo' || c?.photo) return 0;
  if (c?.presenter) return presenterCost(c.seconds);
  return clipCost(r.tier, c?.seconds || s?.seconds || r.script?.shots?.[i]?.seconds || 5, r.res, r.vmodel);
};
const made = (r) => ['ready', 'needs_review', 'failed'].includes(r.status);

// → { kind: 'reel' | 'script' | 'storyboard' | 'asset' | 'design', body, credits, free, summary } | { error }
export function planEdit(row, target, change = {}) {
  const t = parseTarget(target);
  if (!row || !t) return { error: 'Say what to change: the Reel, a scene, the picture, the clip, the design or a slide' };
  const c = change && typeof change === 'object' ? change : {};
  if (row.kind === 'reel') return planReel(row, t, c);
  if (row.kind === 'design') return planDesign(row, t, c);
  if (row.kind === 'image' || row.kind === 'clip') return planAsset(row, t, c);
  return { error: 'That can’t be changed here' };
}

function planReel(r, t, c) {
  const n = Math.max(r.shots?.length || 0, r.script?.shots?.length || 0, r.lines?.length || r.script?.lines?.length || 0);
  if (t.part === 'scene' && !(t.i >= 0 && t.i < n)) return { error: `There’s no scene ${t.i + 1} — this Reel has ${n}` };
  if (!['reel', 'scene'].includes(t.part)) return { error: 'A Reel is changed as a whole (target "reel") or a scene at a time ("scene:N")' };
  // the script, before anything is made: words and plans only, all free
  if (r.status === 'script_ready') {
    if (t.part !== 'scene') return { kind: 'script', body: pickReel(c), credits: 0, free: true, summary: 'Changed the Reel’s settings' };
    const p = c.prompt || {};
    // a change to the picture before it exists is a change to its description
    const was = r.script?.shots?.[t.i]?.image || '';
    const shot = { ...(c.picture ? { image: `${was}\n${clip(c.picture, 300)}`.trim().slice(0, 600) } : {}), ...(p.image ? { image: clip(p.image, 600) } : {}), ...(p.motion ? { motion: clip(p.motion, 300) } : {}), ...(Number(p.seconds) ? { seconds: Math.min(10, Math.max(4, Math.round(Number(p.seconds)))) } : {}) };
    const cam = cleanCam({ ...(p.move || c.move ? { move: p.move || c.move } : {}), ...(p.size ? { size: p.size } : {}) });
    return { kind: 'script', i: t.i, body: { shot, cam, line: c.line ? clip(c.line, 220) : null, drop: !!c.drop, to: c.to }, credits: 0, free: true, summary: `Scene ${t.i + 1}: the plan changed (nothing is made yet)` };
  }
  // the storyboard: a picture is edited (paid), words / order free
  if (r.status === 'storyboard_ready') {
    if (t.part !== 'scene') return { error: 'Change the storyboard a scene at a time — the Reel’s settings change once it’s made' };
    if (c.picture) return { kind: 'storyboard', body: { i: t.i, picture: clip(c.picture, 300) }, credits: imageCost(r.tier, r.imodel), free: false, summary: `Scene ${t.i + 1}: editing its picture — “${clip(c.picture, 80)}”` };
    if (c.line) return { kind: 'storyboard', body: { i: t.i, text: clip(c.line, 220) }, credits: 0, free: true, summary: `Scene ${t.i + 1}: new words` };
    if (c.drop) return { kind: 'storyboard', body: { i: t.i, drop: true }, credits: 0, free: true, summary: `Dropped scene ${t.i + 1}` };
    if (c.to !== undefined && c.to !== null) return { kind: 'storyboard', body: { i: t.i, to: Number(c.to) }, credits: 0, free: true, summary: `Moved scene ${t.i + 1} to ${Number(c.to) + 1}` };
    return { error: 'For a storyboard scene: picture, line, drop or to' };
  }
  if (!made(r)) return { error: 'It’s still being made — change it once it’s finished' };
  if (t.part === 'reel') {
    const body = pickReel(c);
    if (!Object.keys(body).length) return { error: `Nothing to change — for the whole Reel: ${[...EDITS.reel.free, ...EDITS.reel.paid].join('; ')}` };
    const credits = body.music?.mood ? musicCost() : 0;
    // another voice is recorded again but isn't priced in credits (as everywhere else in Studio): only a new track is
    const paid = !!body.music?.mood;
    return { kind: 'reel', body, credits, free: !paid, summary: describeReel(body) };
  }
  const i = t.i;
  if (c.drop) return { kind: 'reel', body: { drop: [i] }, credits: 0, free: true, summary: `Removed scene ${i + 1} (re-edited, nothing made again)` };
  if (c.to !== undefined && c.to !== null) return { kind: 'reel', body: { move: { i, to: Number(c.to) } }, credits: 0, free: true, summary: `Moved scene ${i + 1} to ${Number(c.to) + 1}` };
  if (c.picture) {
    if (!r.shots?.[i]) return { error: `Scene ${i + 1} is words only — it has no picture` };
    return { kind: 'reel', body: { shots: [{ i, picture: clip(c.picture, 300) }] }, credits: imageCost(r.tier, r.imodel) + sceneClipCost(r, i), free: false, summary: `Scene ${i + 1}: editing its picture — “${clip(c.picture, 80)}”, then a new clip from it` };
  }
  if (c.move) {
    const move = cleanCam({ move: c.move })?.move;
    if (!move) return { error: 'Pick a camera move: push in, pull out, pan, tilt, dolly, tracking, orbit, handheld, crane or static' };
    return { kind: 'reel', body: { shots: [{ i, move, note: clip(c.clip, 300) }] }, credits: sceneClipCost(r, i), free: false, summary: `Scene ${i + 1}: a new clip with a ${move}` };
  }
  if (c.clip !== undefined) return { kind: 'reel', body: { shots: [{ i, note: clip(c.clip, 300) }] }, credits: sceneClipCost(r, i), free: false, summary: `Scene ${i + 1}: a new clip${c.clip ? ` — “${clip(c.clip, 80)}”` : ''}` };
  if (c.line) return { kind: 'reel', body: { lines: [{ i, text: clip(c.line, 220) }] }, credits: 0, free: true, summary: `Scene ${i + 1}: new words, recorded again` };
  return { error: `For a scene: ${[...EDITS.scene.free, ...EDITS.scene.paid].join('; ')}` };
}
// the Reel-wide fields, as editReel takes them
function pickReel(c) {
  const b = {};
  if (c.captions === null || c.captions === false) b.captions = null;
  else if (c.captions && typeof c.captions === 'object') b.captions = c.captions;
  for (const k of ['look', 'music', 'logo', 'endCard']) if (c[k] && typeof c[k] === 'object') b[k] = c[k];
  if (Array.isArray(c.sizes)) b.sizes = c.sizes;
  if (CARD_STYLES.includes(c.cardStyle)) b.cardStyle = c.cardStyle;
  if (c.cardColour !== undefined) b.cardColour = c.cardColour;
  if (c.voice) b.voice = c.voice;
  return b;
}
const describeReel = (b) => [
  b.captions === null ? 'captions off' : b.captions ? `captions${b.captions.style ? ` ${b.captions.style}` : ''}${b.captions.font ? ` in ${b.captions.font}` : ''}${b.captions.y ? ' moved' : ''}` : '',
  b.look ? `the look${b.look.base ? ` (${b.look.base})` : ''}` : '', b.music?.off === true ? 'music off' : b.music?.mood ? 'a new music track' : b.music ? 'the music level' : '',
  b.logo ? 'the logo' : '', b.endCard || b.cardStyle || b.cardColour ? 'the closing card' : '', b.sizes ? 'the sizes' : '', b.voice ? 'another voice' : '',
].filter(Boolean).join(', ').replace(/^./, (x) => x.toUpperCase()) || 'Changed the Reel';

function planDesign(d, t, c) {
  if (t.part === 'slide') {
    if (!d.slides?.[t.i]) return { error: `There’s no slide ${t.i + 1}` };
    if (!c.text || typeof c.text !== 'object') return { error: 'For a slide: text { headline, sub, cta, … }' };
    return { kind: 'design', body: { slides: [{ i: t.i, text: c.text }] }, credits: 0, free: true, summary: `Slide ${t.i + 1}: new words` };
  }
  if (t.part !== 'design') return { error: 'A design is changed as a whole ("design") or a slide at a time ("slide:N")' };
  if (c.background) {
    if (d.bg !== 'ai') return { error: 'This design uses your own picture — change it with another photo' };
    return { kind: 'design', background: clip(c.background, 300), body: {}, credits: imageCost(d.tier, d.imodel), free: false, summary: d.bgUrl ? `Editing the picture — “${clip(c.background, 80)}”` : `Making the picture — “${clip(c.background, 80)}”` };
  }
  const body = {};
  for (const k of ['text', 'brand']) if (c[k] && typeof c[k] === 'object') body[k] = c[k];
  for (const k of ['family', 'format', 'template']) if (c[k]) body[k] = c[k];
  if (Array.isArray(c.colours)) body.colours = c.colours;
  if (!Object.keys(body).length) return { error: `For a design: ${[...EDITS.design.free, ...EDITS.design.paid].join('; ')}` };
  return { kind: 'design', body, credits: 0, free: true, summary: `Changed the design (${Object.keys(body).join(', ')})` };
}

function planAsset(a, t, c) {
  if (a.reelId || a.designId) return { error: 'Change it from its Reel or design' };
  if (a.kind === 'image') {
    const what = clip(c.picture || c.note, 300);
    if (!what) return { error: 'Say what to change in the picture' };
    if (!a.url) return { error: 'It isn’t made yet' };
    return { kind: 'asset', body: { picture: what }, credits: imageCost(a.tier, a.imodel), free: false, summary: `Editing the picture — “${clip(what, 80)}”` };
  }
  const note = clip(c.clip ?? c.note, 300);
  return { kind: 'asset', body: { note }, credits: a.presenter ? presenterCost(a.seconds) : clipCost(a.tier, a.seconds, a.res, a.vmodel), free: false, summary: `A new clip${note ? ` — “${clip(note, 80)}”` : ''}` };
}

// the change, after a snapshot → { row, plan } | { error }
export async function applyEdit(row, target, change, { by = null } = {}) {
  const plan = planEdit(row, target, change);
  if (plan.error) return plan;
  if (busyOf(row) && row.status !== 'storyboard_ready' && row.status !== 'script_ready') return { error: 'It’s still being made — change it once it’s finished' };
  snapshot(row.id, `Before: ${plan.summary}`, by);
  const r = T.studio.get(row.id);
  let out;
  if (plan.kind === 'script') out = applyScript(r, plan);
  else if (plan.kind === 'storyboard') out = applyStoryboard(r, plan.body);
  else if (plan.kind === 'reel') out = { row: editReel(r, plan.body) };
  else if (plan.kind === 'design') out = await applyDesign(r, plan);
  else out = applyAsset(r, plan.body);
  return out.error ? out : { row: out.row, plan };
}

function applyScript(r, plan) {
  if (plan.i === undefined) {
    const b = plan.body;
    // nothing is made yet: the settings are kept for the first edit (a voice chosen now costs nothing either)
    return { row: T.studio.update(r.id, (x) => { applySettings(x, { ...b, endCard: b.endCard ? { ...x.script.endCard, ...b.endCard } : undefined }); if (b.voice) x.voice = voiceId(b.voice); }) };
  }
  const { i, body } = plan;
  return { row: T.studio.update(r.id, (x) => {
    const lines = [...x.script.lines], shots = [...x.script.shots];
    if (body.drop) { if (shots.length < 2 && lines.length < 2) return; shots.splice(i, 1); lines.splice(i, 1); }
    else if (body.to !== undefined && body.to !== null) { const to = Math.max(0, Math.min(shots.length - 1, Number(body.to) || 0)); shots.splice(to, 0, shots.splice(i, 1)[0]); if (lines[i] !== undefined) lines.splice(Math.min(to, lines.length - 1), 0, lines.splice(i, 1)[0]); }
    else {
      if (body.line && lines[i] !== undefined) lines[i] = body.line;
      if (shots[i]) shots[i] = { ...shots[i], ...body.shot, ...(body.cam ? { cam: { ...(shots[i].cam || {}), ...Object.fromEntries(Object.entries(body.cam).filter(([, v]) => v)) } } : {}) };
    }
    // the same cleaning (and the never-a-real-public-figure check) as any script edit; the editor's camera kept as given
    const c = cleanScript({ ...x.script, lines, shots }, { treatment: false });
    if (!c.error) x.script = c.script;
  }) };
}

function applyStoryboard(r, b) {
  if (b.picture) {
    const s = r.shots[b.i];
    if (!s || !editStill(s.imageId, b.picture)) return { error: 'That picture is still being made' };
    return { row: T.studio.update(r.id, (x) => { x.shots = x.shots.map((y, j) => (j === b.i ? { ...y, endId: null } : y)); }) };
  }
  const out = storyboardScene(r, b);
  return out.error ? out : { row: out.reel };
}

async function applyDesign(d, plan) {
  if (plan.background) {
    if (!d.bgUrl) { const out = makeBackground(d, { note: plan.background }); return out.error ? out : { row: out.design }; }
    if (d.status === 'producing') return { error: 'The picture is already being made' };
    const img = enqueue(d.userId, { kind: 'image', tier: d.tier, imodel: d.imodel, prompt: EDIT_PICTURE(plan.background, d.bgPrompt), ref: d.bgUrl, aspect: T.studio.get(d.bgId)?.aspect || '1:1', designId: d.id, textArt: !!d.typography, by: d.by });
    return { row: T.studio.update(d.id, (x) => { x.status = 'producing'; x.bgId = img.id; delete x.error; }) };
  }
  return { row: await editDesign(d, plan.body) };
}

function applyAsset(a, b) {
  if (ACTIVE.includes(a.status)) return { error: 'It’s still being made' };
  if (b.picture) return { row: editStill(a.id, b.picture) };
  return { row: T.studio.update(a.id, (y) => { y.status = 'queued'; y.attempts = 0; y.checkTries = 0; y.notes = b.note ? [b.note] : y.fix ? [y.fix] : []; y.error = ''; if (b.note) y.prompt = `${y.prompt}\n${b.note}`.slice(0, 1500); delete y.qa; delete y.doneAt; delete y.taskId; requeued(y); }) };
}

// undo: the last version (or version n) back → { row } | { error }; a design is drawn again from it
export async function undoEdit(row, n = null, by = null) {
  const out = restore(row.id, n, by);
  if (out.error) return out;
  if (out.redraw) return { row: await renderDesign(out.row) };
  return { row: out.row };
}
export { versionsOf };
// the fonts a caption can use (for the inspector and the chat)
export const CAPTION_FONTS = Object.values(BRAND_FONTS).map((f) => f.family);
