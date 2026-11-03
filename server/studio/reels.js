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
import { T, q, JOBS } from '../db.js';
import { askAI } from '../ai.js';
import { studioModels, TIERS, ASPECTS, voiceId, sarvamFor, clipRes } from './models.js';
import { speak, TTS_MODEL } from '../sarvam.js';
import { runTask, studioReady } from './kie.js';
import { enqueue } from './jobs.js';
import { localCopy, save, rm, ffmpeg, tmpFile, probe } from './media.js';
import { makeLine, checkLine, sarvamTranscriber, applyPronunciations, LANGUAGES, langBase } from './voice.js';
import { render, dims, stillMotion, moveFor } from './assemble.js';
import { PRESETS as CAPTION_STYLES } from './captions.js';
import { notify } from '../notify.js';

export const LENGTHS = [15, 30, 45];
export const CAPTION_IDS = Object.keys(CAPTION_STYLES);
const MAX_LINE_TRIES = 3;
const clip = (v, n) => String(v ?? '').trim().slice(0, n);
// the transcriber for the listen-back check and the captions (none without the platform's speech-to-text key)
const transcriber = () => (process.env.SARVAM_API_KEY ? sarvamTranscriber() : null);

// ---------- the script ----------
const SCRIPT_SYSTEM = `You write short vertical video ads (Instagram Reels / YouTube Shorts) for Indian small businesses.
Answer only JSON: {"title": short name, "lines": [voiceover lines], "shots": [{"image": a detailed photo prompt for the shot's opening still (subject, setting, light, camera; no text, logos or captions in the picture), "motion": what moves in the shot (camera move, action), "seconds": 4-8}], "endCard": {"headline": max 40 chars, "offer": price or offer max 40 chars, "cta": call to action max 30 chars}}.
Rules: the first line is a hook that stops the scroll; 3-6 lines, each one short spoken sentence; stay within the word limit given (it's how long the video runs); one shot per line, in order; show the real product in most shots; never invent claims, prices or offers the brief doesn't give (leave offer empty then); write the lines in the language asked, in that language's own script, naturally spoken (common English words are fine).`;

export function cleanScript(s) {
  const lines = (Array.isArray(s?.lines) ? s.lines : []).map((x) => clip(typeof x === 'string' ? x : x?.text, 220)).filter(Boolean).slice(0, 8);
  const shots = (Array.isArray(s?.shots) ? s.shots : []).slice(0, 8).map((x) => ({ image: clip(x?.image, 600), motion: clip(x?.motion, 300), seconds: Math.min(10, Math.max(4, Math.round(Number(x?.seconds) || 5))) })).filter((x) => x.image.length >= 3);
  if (lines.length < 1 || shots.length < 1) return { error: 'The script needs at least one line and one shot' };
  const e = s?.endCard || {};
  return { script: { title: clip(s?.title, 80) || 'Reel', lines, shots, endCard: { headline: clip(e.headline, 40), offer: clip(e.offer, 40), cta: clip(e.cta, 30) } } };
}
// the words a Reel of this length has room for: ~2.4 spoken words a second, after the 2.5-second closing card and a breath
export const wordBudget = (seconds) => Math.max(12, Math.round((seconds - 3) * 2.4));
export const wordCount = (script) => (script.lines || []).join(' ').split(/\s+/).filter(Boolean).length;
const parseScript = (text) => { try { return cleanScript(JSON.parse(String(text).trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, ''))); } catch { return { error: 'not JSON' }; } };
export async function writeScript({ brief, lang, seconds, business }) {
  const budget = wordBudget(seconds);
  const user = `Brief: ${brief}\nBusiness: ${business || 'the seller'}\nLanguage of the voiceover: ${LANGUAGES[langBase(lang)] || 'English'}\nLength: ${seconds} seconds in total, including a 2.5-second closing card — so the voiceover is AT MOST ${budget} words in total, across all lines.`;
  let c = parseScript(await askAI(SCRIPT_SYSTEM, user, { json: true, timeoutMs: 90000 }));
  if (c.error) throw new Error('The AI wrote something that wasn’t a script — please try again');
  // too long for the length asked (a 15-second Reel that runs 22 seconds): ask once to tighten it
  const n = wordCount(c.script);
  if (n > budget * 1.15) {
    const again = parseScript(await askAI(SCRIPT_SYSTEM, `${user}\n\nYour last script had ${n} words — too long. Rewrite it with at most ${budget} words in total: fewer or shorter lines, the same hook and offer.\nLast script: ${JSON.stringify(c.script)}`, { json: true, timeoutMs: 90000 }).catch(() => ''));
    if (!again.error && wordCount(again.script) < n) c = again;
  }
  return c.script;
}

// ---------- start, approve ----------
export function newReel(userId, o) {
  return enqueue(userId, { kind: 'reel', status: 'script_ready', tier: TIERS.includes(o.tier) ? o.tier : 'standard', res: clipRes(o.tier, o.res), prompt: o.brief, aspect: '9:16', seconds: o.seconds, lang: langBase(o.lang) || 'en', voice: voiceId(o.voice), captions: { style: CAPTION_IDS.includes(o.captions) ? o.captions : 'pop' }, sizes: o.sizes, ref: o.ref || null, logo: o.logo || null, brands: o.brands || [], script: o.script, by: o.by || null });
}
// the seller's go-ahead (with their edits): the shots go into the queue, the lines wait to be spoken
export function approveReel(r, script) {
  const shots = script.shots.map((s) => ({ ...s, imageId: enqueue(r.userId, { kind: 'image', tier: r.tier, prompt: s.image, aspect: r.aspect, ref: r.ref, reelId: r.id, by: r.by }).id, clipId: null }));
  return T.studio.update(r.id, (x) => { x.script = script; x.shots = shots; x.lines = script.lines.map((text) => ({ text, url: null, tries: 0, check: null })); x.status = 'producing'; x.approvedAt = Date.now(); delete x.error; });
}

// ---------- producing: shots and lines ----------
const done = (a) => a && ['ready', 'needs_review'].includes(a.status) && a.url;
async function produce(r) {
  // a shot's still is ready (or kept for review): its clip goes into the queue
  let shots = r.shots, changed = false;
  // and once its voiceover line is recorded, so the clip lasts as long as the words over it (the cut lands where the line
  // changes; the last shot also covers any lines beyond the last shot, and the breath before the closing card)
  const said = (i) => (r.lines[i]?.secs ? r.lines[i].secs + 0.25 : null);
  shots = shots.map((s, i) => {
    if (s.clipId) return s;
    const img = T.studio.get(s.imageId);
    if (!done(img)) return s;
    const last = i === shots.length - 1, mine = last ? r.lines.slice(i) : r.lines.slice(i, i + 1);
    if (mine.some((l) => !l.url && l.tries < MAX_LINE_TRIES)) return s; // wait for the words
    const words = mine.reduce((t, l, k) => t + (said(i + k) || 0), 0) + (last ? 0.5 : 0);
    const seconds = words ? Math.min(10, Math.max(4, Math.ceil(words))) : s.seconds;
    changed = true;
    if (r.motion === 'photo') return { ...s, seconds, still: img.url };
    return { ...s, seconds, clipId: enqueue(r.userId, { kind: 'clip', tier: r.tier, res: r.res, prompt: s.motion || s.image, aspect: r.aspect, seconds, ref: img.url, sourceId: img.id, reelId: r.id, enhance: true, by: r.by }).id };
  });
  if (changed) r = T.studio.update(r.id, (x) => { x.shots = shots; });
  // photo motion: the editor animates the still here (free, a few seconds) and it's kept as the shot's clip
  const p = r.shots.findIndex((s) => s.still && !s.clipId);
  if (p >= 0) return photoClip(r, p);
  // a shot that couldn't be made even after its retries: stop with the reason (the seller can Retry), don't wait forever
  const lost = r.shots.findIndex((s) => T.studio.get(s.imageId)?.status === 'failed' || (s.clipId && T.studio.get(s.clipId)?.status === 'failed'));
  if (lost >= 0) {
    const a = T.studio.get(r.shots[lost].clipId) || T.studio.get(r.shots[lost].imageId);
    return T.studio.update(r.id, (x) => { x.status = 'failed'; x.error = `Shot ${lost + 1} couldn’t be made${a?.error ? ` — ${a.error}` : ''}`; x.doneAt = Date.now(); });
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
    await stillMotion(src.file, out, { seconds: s.seconds, aspect: r.aspect, move: moveFor(s.motion || '', i) });
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
const setLine = (r, i, patch) => T.studio.update(r.id, (x) => { x.lines = x.lines.map((l, j) => (j === i ? { ...l, ...patch } : l)); });

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
export async function makeCard(card, colour, aspect, still = null) {
  if (!card || !(card.headline || card.offer || card.cta)) return null;
  const { width: W, height: H } = dims(aspect, 1080);
  const hex = /^#[0-9a-f]{6}$/i.test(colour || '') ? colour : '#111827';
  const button = /^#[0-9a-f]{6}$/i.test(colour || '') ? colour : '#FFD400';
  const ass = tmpFile('ass'), png = tmpFile('png');
  const y = still ? { h: 0.6, o: 0.68, c: 0.79 } : { h: 0.4, o: 0.5, c: 0.62 };
  const L = (style, at, size, text) => `Dialogue: 0,0:00:00.00,0:00:05.00,${style},,0,0,0,,{\\an5\\pos(${W / 2},${Math.round(H * at)})\\fs${Math.round(H * size)}}${assEsc(text)}`;
  const styles = [
    'Style: Card,Noto Sans,60,&H00FFFFFF,&H00FFFFFF,&H78000000,&H00000000,-1,0,0,0,100,100,0,0,1,3,1,5,60,60,60,1',
    // the call to action as a button: dark text on an opaque box in the brand colour (yellow without one)
    `Style: Cta,Noto Sans,60,${/^#(ffd|fff|fe|fd|fc)/i.test(button) ? '&H00111111' : '&H00FFFFFF'},&H00FFFFFF,${assHex(button)},&H00000000,-1,0,0,0,100,100,0,0,3,${Math.round(H * 0.018)},0,5,60,60,60,1`,
  ];
  const events = [card.headline && L('Card', y.h, 0.046, card.headline), card.offer && L('Card', y.o, 0.062, card.offer), card.cta && L('Cta', y.c, 0.034, card.cta)].filter(Boolean);
  fs.writeFileSync(ass, `[Script Info]\nScriptType: v4.00+\nPlayResX: ${W}\nPlayResY: ${H}\nWrapStyle: 0\nScaledBorderAndShadow: yes\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n${styles.join('\n')}\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n${events.join('\n')}\n`);
  const fileArg = ass.replace(/\\/g, '/').replace(/^([A-Za-z]):/, '$1\\:');
  if (still) {
    // the sharp copy: as big as fits in the top part, whatever its shape
    const fw = Math.round(W * 0.72), fh = Math.round(H * 0.44);
    await ffmpeg(['-i', still, '-frames:v', '1', '-filter_complex', `[0]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},boxblur=40:2,eq=brightness=-0.3:saturation=1.15[bg];[0]scale=${fw}:${fh}:force_original_aspect_ratio=decrease[fg];[bg][fg]overlay=(W-w)/2:${Math.round(H * 0.27)}-h/2,ass='${fileArg}'`, png], { timeoutMs: 60000 });
  }
  if (!fs.existsSync(png)) await ffmpeg(['-f', 'lavfi', '-i', `color=c=${hex}:s=${W}x${H}:d=1`, '-frames:v', '1', '-vf', `ass='${fileArg}'`, png], { timeoutMs: 60000 });
  rm(ass);
  return fs.existsSync(png) ? png : null;
}

async function edit(r) {
  const temp = [];
  const local = async (url, ext) => { const c = await localCopy(url, ext); if (c.temp) temp.push(c.file); return c.file; };
  try {
    const clips = [];
    for (const s of r.shots) clips.push(await local(T.studio.get(s.clipId).url, 'mp4'));
    const lineFiles = [];
    for (const l of r.lines) lineFiles.push(await local(l.url, (l.url.match(/\.(\w+)$/) || [])[1] || 'mp3'));
    const voice = await joinVoice(lineFiles);
    temp.push(voice.file);
    const tr = transcriber();
    let words = null;
    if (tr) words = (await tr(voice.file, r.lang).catch((e) => { console.error('caption transcript failed', e.message); return null; }))?.words || null;
    if (!words?.length) words = spreadWords(r.lines, voice.spans);
    const owner = T.users.get(r.userId);
    // the closing card shows the product: the first scene's still
    const firstStill = T.studio.get(r.shots?.[0]?.imageId)?.url;
    const still = firstStill ? await local(firstStill, 'png').catch(() => null) : null;
    const card = await makeCard(r.script.endCard, owner?.settings?.brandColor || owner?.settings?.whiteLabel?.primary, r.aspect, still);
    if (card) temp.push(card);
    const logo = r.logo ? await local(r.logo, 'png').catch(() => null) : null;
    const sizes = (r.sizes?.length ? r.sizes : ['9:16']).filter((a) => ASPECTS.includes(a) && ['9:16', '1:1', '16:9', '4:5'].includes(a));
    const out = await render({ clips, voice: voice.file, words, captions: r.captions?.style ? { style: r.captions.style, ...(r.captions.colour ? { colour: r.captions.colour } : {}) } : null, logo: logo ? { file: logo, position: 'top-right', size: 0.18 } : null, endCard: card ? { image: card, seconds: 2.5 } : null, sizes, short: r.tier === 'cinematic' ? 1080 : 720, name: 'reel' });
    const outputs = {};
    for (const [aspect, f] of Object.entries(out.files)) { temp.push(f); outputs[aspect] = (await save(r.userId, f, 'mp4', 'video/mp4')).url; }
    const first = out.files[sizes[0]] || Object.values(out.files)[0];
    const pf = tmpFile('jpg'); temp.push(pf);
    await ffmpeg(['-ss', '0.5', '-i', first, '-frames:v', '1', '-vf', 'scale=480:-2', '-q:v', '4', pf], { timeoutMs: 30000 });
    const poster = fs.existsSync(pf) ? (await save(r.userId, pf, 'jpg', 'image/jpeg')).url : null;
    // anything kept for review along the way: the Reel is made, but the seller should look
    const flagged = [...r.shots.flatMap((s, i) => (T.studio.get(s.clipId)?.status === 'needs_review' ? [`Shot ${i + 1}: ${(T.studio.get(s.clipId).qa?.issues || []).join('; ')}`] : [])), ...r.lines.flatMap((l, i) => (l.check && !l.check.ok ? [`Line ${i + 1}: ${l.check.issues.join('; ')}`] : []))];
    T.studio.update(r.id, (x) => { x.outputs = outputs; x.url = outputs[sizes[0]] || Object.values(outputs)[0]; x.poster = poster; x.duration = Math.round(out.duration * 10) / 10; x.lufs = out.lufs; x.status = flagged.length ? 'needs_review' : 'ready'; x.qa = { issues: flagged.slice(0, 8) }; x.doneAt = Date.now(); delete x.error; });
    notify(r.userId, { kind: 'support', title: 'Your Reel is ready', body: r.script.title, link: '/studio' });
  } catch (e) {
    console.error('reel edit failed', r.id, e.message, e.detail || '');
    T.studio.update(r.id, (x) => { x.editTries = (x.editTries || 0) + 1; if (x.editTries >= 2) { x.status = 'failed'; x.error = 'The video couldn’t be put together — try again'; x.doneAt = Date.now(); } });
  } finally { rm(...temp); }
}

// ---------- retry: a Reel that stopped (a shot or a line that couldn't be made, or the edit) carries on ----------
// Only what failed is done again: failed shots go back in the queue, lines with no voice get fresh tries, and a Reel
// whose parts are all there is edited again.
export function retryReel(r) {
  for (const s of r.shots || []) for (const id of [s.imageId, s.clipId]) {
    const a = id && T.studio.get(id);
    if (a?.status === 'failed') T.studio.update(a.id, (y) => { y.status = 'queued'; y.attempts = 0; y.error = ''; delete y.taskId; delete y.doneAt; });
  }
  return T.studio.update(r.id, (x) => {
    x.lines = (x.lines || []).map((l) => (l.url ? l : { ...l, tries: 0, error: '' }));
    const ready = x.lines.every((l) => l.url) && (x.shots || []).every((s) => ['ready', 'needs_review'].includes(T.studio.get(s.clipId)?.status));
    x.status = ready ? 'editing' : 'producing'; x.editTries = 0; delete x.error; delete x.doneAt;
  });
}

// ---------- changes after it's made (from the Studio page or Hive) ----------
// { captions?: { style, colour }, sizes?, lines?: [{ i, text }], shots?: [{ i, note }], endCard? }
export function editReel(r, b) {
  const lines = [...r.lines], shots = [...r.shots];
  let reproduce = false;
  // another voice: every line is spoken again
  let voice = null;
  if (b.voice && voiceId(b.voice) !== r.voice) { voice = voiceId(b.voice); for (let i = 0; i < lines.length; i++) lines[i] = { text: lines[i].text, url: null, tries: 0, check: null }; reproduce = true; }
  for (const { i, text } of Array.isArray(b.lines) ? b.lines : []) { if (lines[i] && clip(text, 220)) { lines[i] = { text: clip(text, 220), url: null, tries: 0, check: null }; reproduce = true; } }
  for (const { i, note } of Array.isArray(b.shots) ? b.shots : []) {
    const c = shots[i] && T.studio.get(shots[i].clipId);
    if (!c) continue;
    // photo motion: a new still (with the change), animated again once it's made
    if (c.photo) {
      T.studio.update(shots[i].imageId, (y) => { y.status = 'queued'; y.attempts = 0; y.checkTries = 0; y.notes = note ? [clip(note, 300)] : y.fix ? [y.fix] : []; if (note) y.prompt = `${y.prompt}\n${clip(note, 300)}`.slice(0, 1500); delete y.qa; delete y.taskId; delete y.doneAt; });
      shots[i] = { ...shots[i], still: null, clipId: null };
      reproduce = true;
      continue;
    }
    T.studio.update(c.id, (y) => { y.status = 'queued'; y.attempts = 0; y.checkTries = 0; y.notes = note ? [clip(note, 300)] : y.fix ? [y.fix] : []; if (note) y.prompt = `${y.prompt}\n${clip(note, 300)}`.slice(0, 1500); delete y.qa; delete y.taskId; delete y.doneAt; });
    reproduce = true;
  }
  return T.studio.update(r.id, (x) => {
    if (b.captions) x.captions = { style: CAPTION_IDS.includes(b.captions.style) ? b.captions.style : x.captions?.style || 'pop', ...(/^#[0-9a-f]{6}$/i.test(b.captions.colour || '') ? { colour: b.captions.colour } : {}) };
    if (b.captions === null) x.captions = null;
    if (Array.isArray(b.sizes) && b.sizes.length) x.sizes = b.sizes.filter((a) => ['9:16', '1:1', '16:9', '4:5'].includes(a)).slice(0, 4);
    if (b.endCard) x.script = { ...x.script, endCard: { headline: clip(b.endCard.headline, 40), offer: clip(b.endCard.offer, 40), cta: clip(b.endCard.cta, 30) } };
    if (voice) x.voice = voice;
    x.lines = lines; x.shots = shots; x.script = { ...x.script, lines: lines.map((l) => l.text) };
    x.status = reproduce ? 'producing' : 'editing'; x.editTries = 0; delete x.doneAt; delete x.error;
  });
}

// ---------- the loop ----------
let editing = false, voicing = false;
const busy = new Set();
export async function reelsTick() {
  if (!studioReady()) return;
  const rows = q("SELECT data FROM studio WHERE status IN ('producing', 'editing') ORDER BY at").all().map((x) => JSON.parse(x.data)).filter((x) => x.kind === 'reel');
  const jobs = [];
  for (const r of rows) {
    if (busy.has(r.id)) continue;
    if (r.status === 'producing' && !voicing) { voicing = true; busy.add(r.id); jobs.push(produce(r).catch((e) => console.error('reel step failed', r.id, e.message)).finally(() => { voicing = false; busy.delete(r.id); })); }
    else if (r.status === 'editing' && !editing) { editing = true; busy.add(r.id); jobs.push(edit(r).finally(() => { editing = false; busy.delete(r.id); })); }
  }
  await Promise.all(jobs);
}
if (JOBS && process.env.NODE_ENV !== 'test') setInterval(() => { reelsTick().catch((e) => console.error('reels tick failed', e.message)); }, 6000).unref();
