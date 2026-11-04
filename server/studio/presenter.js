// Presenter scenes: a person speaking the scene's voiceover to camera — the best-converting Indian video ads are
// testimonials, UGC-style talks and founders explaining their product. A scene of type 'presenter' (the script writer
// proposes them for such briefs; the seller can switch any scene) is made from a picture of the person (a cast still
// made for the scene, a Studio image, or the seller's own photo — never a real public figure) and the scene's own
// voiceover line, already recorded and checked (voice.js), lip-synced by the presenter model (models.js
// PRESENTER_MODELS). The clip lasts as long as its line; the editor drops the clip's own sound and lines its first frame
// up with the line in the master voice track (assemble.js render starts/synced), so the voice is never doubled or late.
import { T } from '../db.js';
import { enqueue } from './jobs.js';
import { localCopy, save, rm, ffmpeg, tmpFile, probe } from './media.js';

export const PRESENTER_STYLES = ['ugc', 'testimonial', 'founder'];
const GAP = 0.25; // the breath between lines, as reels.js joins them
// the shortest audio the model takes is 4 s; a second more than the slot so the clip never runs out before the cut
const MIN_AUDIO = 4;

// ---------- never a real public figure ----------
// Obvious names only (film, cricket, politics, business, music): a likeness of a real person in an ad is a legal and
// platform problem ("a lookalike of <name>" names them too, so it's refused the same way).
const FAMOUS = ['shah ?rukh', 'srk', 'amitabh', 'bachchan', 'salman khan', 'aamir khan', 'akshay kumar', 'hrithik', 'ranveer singh', 'ranbir kapoor', 'deepika', 'priyanka chopra', 'alia bhatt', 'katrina kaif', 'kareena', 'anushka sharma', 'kriti sanon', 'shraddha kapoor', 'tiger shroff', 'allu arjun', 'prabhas', 'rajinikanth', 'kamal haasan', 'vijay deverakonda', 'mahesh babu', 'samantha ruth', 'rashmika', 'virat kohli', 'kohli', 'sachin tendulkar', 'tendulkar', 'dhoni', 'rohit sharma', 'hardik pandya', 'jasprit bumrah', 'narendra modi', 'modi ji', 'rahul gandhi', 'kejriwal', 'yogi adityanath', 'mukesh ambani', 'ambani', 'ratan tata', 'gautam adani', 'adani', 'sundar pichai', 'arijit singh', 'diljit', 'badshah', 'elon musk', 'taylor swift', 'cristiano ronaldo', 'ronaldo', 'messi', 'donald trump', 'trump', 'obama', 'kim kardashian', 'mrbeast', 'carryminati', 'bhuvan bam', 'dhruv rathee', 'ranveer allahbadia'];
const FAMOUS_RE = new RegExp(`\\b(${FAMOUS.join('|')})\\b`, 'i');
export const celebrityIn = (...texts) => { const m = FAMOUS_RE.exec(texts.filter(Boolean).join(' \n ')); return m ? m[1] : null; };
export const CELEBRITY_ERROR = 'A presenter has to be an invented person or you — not a real public figure or a lookalike of one';

// ---------- the script ----------
// what the script writer is told for a presenter Reel (SCRIPT_SYSTEM in reels.js takes "type" on any shot)
export const presenterBrief = (style) => (PRESENTER_STYLES.includes(style) ? `\nStyle: ${{ ugc: 'UGC — a real-looking customer filming themselves on a phone, casual and honest', testimonial: 'a customer testimonial — a happy buyer telling what changed for them', founder: 'the founder speaking about why they made the product' }[style]}. Make the hook scene and at least half of the scenes "type": "presenter": that one person (always described the same way) speaking the scene's line straight to the camera, chest-up, mouth closed in the still, natural light, holding or next to the product; keep the other scenes as product shots. The presenter is an invented person — never a real or famous one.` : '');
export const presenterScenes = (script) => (script?.shots || []).filter((s) => s.type === 'presenter').length;

// ---------- the presenter's face ----------
// { image, imageId } → the picture to use, or { error }. Only the seller's own upload (checked by the caller) or one of
// their ready Studio images
export function pickFace(userId, b, ownUpload) {
  if (!b || (!b.image && !b.imageId)) return { face: null };
  if (b.imageId) {
    const a = T.studio.get(String(b.imageId));
    if (!a || a.userId !== userId || a.kind !== 'image' || !a.url) return { error: 'That picture isn’t ready' };
    if (celebrityIn(a.prompt)) return { error: CELEBRITY_ERROR };
    return { face: { image: a.url, imageId: a.id } };
  }
  if (!ownUpload(userId, b.image)) return { error: 'Pick one of your own photos' };
  return { face: { image: b.image } };
}
// a seller's choice of presenter: { face?: { image } | { imageId } | null, scenes?: [i…] made presenters (the others not),
// style? } on a Reel whose script waits (or its storyboard). → the patch, or { error }
export function setPresenter(r, b, ownUpload) {
  const out = { presenter: { ...(r.presenter || {}) } };
  if (b.face !== undefined) {
    if (b.face === null) { delete out.presenter.image; delete out.presenter.imageId; }
    else { const f = pickFace(r.userId, b.face, ownUpload); if (f.error) return f; Object.assign(out.presenter, f.face); }
  }
  if (b.style !== undefined) out.presenter.style = PRESENTER_STYLES.includes(b.style) ? b.style : undefined;
  if (Array.isArray(b.scenes)) {
    const on = new Set(b.scenes.map(Number).filter((i) => Number.isInteger(i) && i >= 0));
    const flip = (s, i) => { const { type, ...rest } = s; return on.has(i) ? { ...rest, type: 'presenter' } : rest; };
    out.script = { ...r.script, shots: r.script.shots.map(flip) };
    if (celebrityIn(...out.script.shots.filter((s) => s.type === 'presenter').map((s) => s.image))) return { error: CELEBRITY_ERROR };
    if (r.shots) out.shots = r.shots.map(flip);
  }
  return out;
}
// a presenter scene's still when the seller gave the face: their picture as it is, already "made" (nothing to pay)
export const faceStill = (r, s) => enqueue(r.userId, { kind: 'image', status: 'ready', tier: r.tier, prompt: s.image, aspect: r.aspect, ref: null, url: r.presenter.image, poster: r.presenter.image, reelId: r.id, presenterFace: true, doneAt: Date.now(), by: r.by }).id;

// ---------- the clip ----------
// the lines a scene speaks: its own (the last scene also every line after it, as the editor times it)
export const linesOf = (r, i) => (i === r.shots.length - 1 ? r.lines.slice(i) : r.lines.slice(i, i + 1));
// ready to order: its still is made and every line it speaks is recorded
// (a presenter scene with no line to speak is made as an ordinary scene)
export const talks = (r, i) => r.shots[i]?.type === 'presenter' && linesOf(r, i).length > 0;
export const presenterReady = (r, i, done) => talks(r, i) && !r.shots[i].clipId && done(T.studio.get(r.shots[i].imageId)) && linesOf(r, i).every((l) => l.url);
// the scene's audio exactly as it sits in the master voiceover (its lines with the same breaths between them), then
// silence to the model's minimum and a second past the slot → a saved WAV; → { url, seconds (of speech) }
async function sceneAudio(r, i) {
  const files = [], temp = [], out = tmpFile('wav');
  try {
    for (const l of linesOf(r, i)) { const c = await localCopy(l.url, (l.url.match(/\.(\w+)$/) || [])[1] || 'wav'); files.push(c.file); if (c.temp) temp.push(c.file); }
    let speech = 0;
    for (const f of files) speech += (await probe(f)).seconds + GAP;
    const whole = Math.max(MIN_AUDIO, speech + 1);
    const chain = files.map((_, k) => `[${k}:a]aresample=44100,aformat=channel_layouts=mono,apad=pad_dur=${GAP}[a${k}]`).join(';');
    await ffmpeg([...files.flatMap((f) => ['-i', f]), '-filter_complex', `${chain};${files.map((_, k) => `[a${k}]`).join('')}concat=n=${files.length}:v=0:a=1,apad=whole_dur=${whole.toFixed(2)}[out]`, '-map', '[out]', '-t', whole.toFixed(2), out]);
    const saved = await save(r.userId, out, 'wav', 'audio/wav');
    return { url: saved.url, seconds: Math.round(whole * 100) / 100 };
  } finally { rm(out, ...temp); }
}
// order scene i's lip-synced clip (one step of the Reel's loop) → the Reel's shots with its clip id
export async function presenterClip(r, i, set) {
  const s = r.shots[i], img = T.studio.get(s.imageId);
  try {
    const audio = await sceneAudio(r, i);
    const direction = `${r.presenter?.style === 'founder' ? 'A founder' : 'A real customer'} speaking warmly and naturally to the camera, small natural head and hand movements, steady framing`;
    const c = enqueue(r.userId, { kind: 'clip', presenter: true, tier: r.tier, prompt: direction, aspect: r.aspect, seconds: audio.seconds, ref: img.url, audio: audio.url, sourceId: img.id, reelId: r.id, enhance: true, by: r.by });
    return set((x) => { x.shots = x.shots.map((y, j) => (j === i ? { ...y, clipId: c.id, seconds: audio.seconds } : y)); });
  } catch (e) {
    console.error('presenter audio failed', r.id, i, e.message);
    return set((x) => { x.status = 'failed'; x.error = `Shot ${i + 1}’s presenter couldn’t be prepared — try again`; x.doneAt = Date.now(); });
  }
}
// lines that changed → presenter scenes that speak them need a new clip (their lips would say the old words)
export function relip(shots, nLines, changed) {
  if (!changed.size) return shots;
  return shots.map((s, i) => {
    if (s.type !== 'presenter' || !s.clipId) return s;
    const mine = i === shots.length - 1 ? Array.from({ length: Math.max(0, nLines - i) }, (_, k) => i + k) : [i];
    return mine.some((k) => changed.has(k)) ? { ...s, clipId: null } : s;
  });
}
// where each scene starts in the master voiceover (joinVoice's spans), for the editor: scene i at its line's start;
// scenes beyond the last line share what's left of it. Only for Reels with a presenter (other Reels keep the usual fit)
export function sceneStarts(shots, spans) {
  if (!shots.some((s) => s.type === 'presenter') || !spans?.length) return null;
  const n = shots.length, end = spans.at(-1)[1];
  const lined = Math.min(n, spans.length), lastStart = spans[lined - 1][0], extra = n - lined;
  return shots.map((_, i) => (i < lined ? spans[i][0] : lastStart + ((end - lastStart) * (i - lined + 1)) / (extra + 1)));
}
