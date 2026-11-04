// The Creative Standard: what every Studio video and design must meet before it's called "ready" — written down as
// numbers and checked by code, not left to an AI's opinion. Per format (reel, ad, vsl, story, feed, carousel,
// thumbnail): platform safe zones, readable captions, the hook in the first 2 seconds, the product early, the cut pace,
// the length, captions on for sound-off viewing, a call to action at the end. Plus the playbook: every script names one
// hook and one structure (HOOKS, STRUCTURES) and is checked for having actually done them.
// Each rule → { id, label, ok (true | false | null = not checkable yet), detail, fix, auto (fixed by the editor, free) }.
// Free fixes are applied without asking (caption size and position: captions.js captionPlace; captions turned on;
// punch-in cuts for pace: assemble.js) or offered as a suggested script (a shorter first line, the product moved up).
// Nothing here ever spends credits. The gate (gateOf): ready only when the rules pass AND the final review scored at
// least QUALITY_BAR; otherwise needs_review with the failing rules and their fixes.
import { captionPlace } from './captions.js';
import { STRIKING, treatmentOf } from './cinema.js';

// the reviewer's score (0-100) a finished Reel or design needs to be "ready"
export const QUALITY_BAR = 80;
// Safe zones, fractions of the frame where the app's own UI sits on top of the picture:
//   vertical  Reels / Shorts: account bar and icons over the top ~14%; caption, audio and buttons over the bottom
//             20-35% (a longer post caption pushes it higher) — key text stays above the bottom 25%; like/share strip
//             on the right ~14%
//   story     Stories: account bar over the top ~14%, the reply box over the bottom ~20%
//   flat      thumbnails, web and square video: no overlay, a margin (a little more at the bottom: player controls,
//             a thumbnail's length badge)
//   post      feed posts and carousels: no overlay, an even margin
export const SAFE = {
  vertical: { top: 0.14, bottom: 0.25, left: 0.07, right: 0.14 },
  story: { top: 0.14, bottom: 0.2, left: 0.07, right: 0.07 },
  flat: { top: 0.06, bottom: 0.08, left: 0.06, right: 0.06 },
  post: { top: 0.06, bottom: 0.06, left: 0.06, right: 0.06 },
};
// the smallest caption, as a fraction of the frame's short side: ~54 px on a 1080-wide Reel, about 20 pt on a phone.
// Landscape frames are watched bigger (web, TV), so a little smaller is fine there.
export const MIN_CAPTION = { vertical: 0.05, flat: 0.04 };
export const minCaption = (w, h) => (h / w > 1.4 ? MIN_CAPTION.vertical : MIN_CAPTION.flat);
// the hook: the first line, spoken in about 2-3 seconds (~2.4 spoken words a second), and the voice starts at once
export const HOOK_MAX_WORDS = 7;
export const VOICE_STARTS_BY = 0.6; // seconds
export const WORDS_PER_SECOND = 2.4;
export const CARD_SECONDS = 2.5;

// per format. seconds: [min, max] total; shot: [min, max] average seconds between cuts; productBy: the product (or the
// result / hero) on screen by this second; headline: most words in a design's headline; slides: [min, max]
export const FORMATS = {
  reel: { label: 'Reel / Short (9:16)', safe: 'vertical', seconds: [7, 60], shot: [1.5, 3.5], productBy: 5, captions: true, cta: true },
  // ads: the product by ~3s — right after a short hook (a 7-word hook is spoken in about 3 seconds)
  ad: { label: 'Paid video ad', safe: 'vertical', seconds: [6, 45], shot: [1.2, 3], productBy: 3.5, captions: true, cta: true },
  vsl: { label: 'Web video (16:9)', safe: 'flat', seconds: [15, 600], shot: [2, 6], productBy: 10, captions: true, cta: true },
  story: { label: 'Story (9:16)', safe: 'story', seconds: [5, 60], shot: [1.5, 4], productBy: 5, captions: true, cta: true, headline: 8 },
  feed: { label: 'Feed post', safe: 'post', seconds: [6, 60], shot: [1.5, 4], productBy: 5, captions: true, cta: true, headline: 8 },
  carousel: { label: 'Carousel', safe: 'post', slides: [3, 10], headline: 8, cta: true },
  thumbnail: { label: 'YouTube thumbnail', safe: 'flat', headline: 5 },
};
// the editor cuts within a long shot (a punch-in) so no picture holds longer than this: under the format's slowest pace
export const cutEvery = (format) => (FORMATS[format]?.shot ? FORMATS[format].shot[1] - 0.5 : 0);

// ---------- the playbook ----------
export const HOOKS = {
  question: { label: 'Question', how: 'open on a question the viewer answers in their head' },
  bold_claim: { label: 'Bold claim', how: 'a confident, specific claim the brief supports' },
  pattern_interrupt: { label: 'Pattern interrupt', how: 'something unexpected in the first frame or words' },
  before_after: { label: 'Before / after', how: 'the problem state, then the result' },
  pov: { label: 'POV', how: '"POV:" — the viewer is put in the moment' },
  social_proof: { label: 'Social proof', how: 'how many people, reviews or results' },
  curiosity: { label: 'Curiosity gap', how: 'promise something they only learn by watching' },
  number_list: { label: 'Number / list', how: '"3 reasons…", a number up front' },
};
// beats: the vocabulary each line is labelled with; core: the beats that must appear, in this order
export const STRUCTURES = {
  pas: { label: 'Problem → Agitate → Solve', core: ['problem', 'solution'] },
  aida: { label: 'AIDA', core: ['attention', 'desire'] },
  demo: { label: 'Demo', core: ['demo', 'result'] },
  ugc: { label: 'UGC testimonial', core: ['experience', 'result'] },
  founder: { label: 'Founder story', core: ['story', 'product'] },
  offer_first: { label: 'Offer first', core: ['offer'] },
};
export const BEATS = ['hook', 'problem', 'agitate', 'solution', 'attention', 'interest', 'desire', 'action', 'demo', 'result', 'experience', 'recommend', 'story', 'product', 'offer', 'value', 'proof', 'before', 'after', 'cta'];
// the playbook as the script writer reads it
export const playbookPrompt = () => `Hooks (pick one, name it in "hook"): ${Object.entries(HOOKS).map(([k, h]) => `${k} — ${h.how}`).join('; ')}.
Structures (pick one, name it in "structure"; label every shot's "beat" from: ${BEATS.join(', ')}): ${Object.entries(STRUCTURES).map(([k, s]) => `${k} — ${s.label} (beats ${s.core.join(' → ')})`).join('; ')}.`;

const words = (t) => String(t || '').split(/\s+/).filter(Boolean);
const WORD_NUMBERS = /\b(one|two|three|four|five|six|seven|eight|nine|ten|top|ek|do|teen|char|paanch)\b/i;
// did the first line do what the named hook says? true / false, or null when code can't tell (the creative director
// checks those before spending: preflight.js playbook)
export function hookDone(hook, script) {
  const l = String(script?.lines?.[0] || ''), beats = (script?.shots || []).map((s) => s.beat);
  if (hook === 'question') return /[?？]/.test(l);
  if (hook === 'number_list') return /[\d०-९]/.test(l) || WORD_NUMBERS.test(l);
  if (hook === 'pov') return /\bpov\b/i.test(l);
  if (hook === 'social_proof') return /[\d०-९]/.test(l) || /\b(customers?|reviews?|families|people|log|grahak|bought|sold|trusted|stars?|rating)\b/i.test(l);
  if (hook === 'before_after') return beats.includes('before') && beats.includes('after') ? true : /\b(before|after|pehle|baad)\b/i.test((script?.lines || []).join(' ')) || null;
  if (hook === 'bold_claim') return !/[?？]/.test(l);
  return null;
}
// the structure's core beats in order among the shots' beats; null when the shots aren't labelled
export function structureDone(structure, script) {
  const beats = (script?.shots || []).map((s) => s.beat).filter(Boolean);
  const core = STRUCTURES[structure]?.core;
  if (!core || !beats.length) return null;
  let k = 0;
  for (const b of beats) if (b === core[k]) k++;
  return k === core.length;
}

// ---------- a video ----------
// which format a Reel is held to: chosen, else from its frame and purpose (an ad test variant is an ad)
export function reelFormat(r) {
  if (FORMATS[r?.format]?.shot) return r.format;
  if (r?.aspect === '16:9') return 'vsl';
  if (['1:1', '4:5'].includes(r?.aspect)) return 'feed';
  return r?.variant || r?.parentId ? 'ad' : 'reel';
}
const frameOf = (aspect) => ({ '16:9': [1920, 1080], '1:1': [1080, 1080], '4:5': [1080, 1350] }[aspect] || [1080, 1920]);
// how long each line is spoken: measured once recorded, else from its words
const lineSecs = (script, secs = []) => (script.lines || []).map((l, i) => (Number(secs[i]) > 0 ? Number(secs[i]) : words(l).length / WORDS_PER_SECOND) + 0.25);
// shot i's share of the voiceover (the last shot also covers any lines beyond the shots)
const shotSecs = (script, secs) => { const ls = lineSecs(script, secs), n = script.shots?.length || 0; return Array.from({ length: n }, (_, i) => (i === n - 1 ? ls.slice(i).reduce((a, b) => a + b, 0) : ls[i] || 0)); };
const rule = (id, label, ok, detail = '', fix = '', auto = false) => ({ id, label, ok, detail, fix, ...(auto ? { auto: true } : {}) });

// the hook split at its first natural break (or after HOOK_MAX_WORDS words); the rest joins the next line
export function splitHook(script) {
  const ws = words(script.lines[0]);
  if (ws.length <= HOOK_MAX_WORDS) return null;
  let k = ws.findIndex((w, i) => i >= 2 && i < HOOK_MAX_WORDS && /[,.!?।:—-]$/.test(w));
  k = k < 0 ? HOOK_MAX_WORDS : k + 1;
  const lines = [ws.slice(0, k).join(' '), [ws.slice(k).join(' '), script.lines[1] || ''].filter(Boolean).join(' '), ...script.lines.slice(2)];
  return { ...script, lines };
}
// scene i (its shot and its line) moved to position `to`
export function moveScene(script, i, to) {
  const shots = [...script.shots], lines = [...script.lines];
  shots.splice(to, 0, shots.splice(i, 1)[0]);
  if (i < lines.length) lines.splice(Math.min(to, lines.length - 1), 0, lines.splice(i, 1)[0]);
  return { ...script, shots, lines };
}

// a script (before spending) or a finished Reel (measured: { duration, segments, firstWord }) against its format.
// o: { format, seconds (ordered), aspect, captions ({ style } | null), secs (each line's spoken seconds), assessment }
// → { format, label, passed, rules, script (the suggested script with the free fixes, or null), changes }
export function checkVideo(script, o = {}) {
  const format = FORMATS[o.format]?.shot ? o.format : 'reel', F = FORMATS[format], rules = [];
  const shots = script?.shots || [], lines = script?.lines || [];
  let fixed = script, changes = [];
  // the playbook: named, and done
  const hook = HOOKS[script?.hook] ? script.hook : '', structure = STRUCTURES[script?.structure] ? script.structure : '';
  const pb = o.assessment?.playbook || {};
  rules.push(rule('hook_named', 'Hook picked from the playbook', !!hook, hook ? HOOKS[hook].label : 'No hook named', hook ? '' : `Pick one: ${Object.values(HOOKS).map((h) => h.label).join(', ')}`));
  rules.push(rule('structure_named', 'Structure picked from the playbook', !!structure, structure ? STRUCTURES[structure].label : 'No structure named', structure ? '' : `Pick one: ${Object.values(STRUCTURES).map((s) => s.label).join(', ')}`));
  if (hook) { const d = hookDone(hook, script) ?? (typeof pb.hook === 'boolean' ? pb.hook : null); rules.push(rule('hook_done', `The first line is a ${HOOKS[hook].label.toLowerCase()} hook`, d, d == null ? 'The creative director checks this before you spend' : d ? '' : `It doesn’t ${HOOKS[hook].how}`, d === false ? `Rewrite the first line to ${HOOKS[hook].how}` : '')); }
  if (structure) { const d = structureDone(structure, script) ?? (typeof pb.structure === 'boolean' ? pb.structure : null); rules.push(rule('structure_done', `The story follows ${STRUCTURES[structure].label}`, d, d == null ? 'The creative director checks this before you spend' : d ? '' : `Missing the ${STRUCTURES[structure].core.join(' → ')} beats in order`, d === false ? `Make the scenes go ${STRUCTURES[structure].core.join(' → ')}` : '')); }
  // the hook: a short first line and a striking first frame
  const n0 = words(lines[0]).length, split = splitHook(script);
  rules.push(rule('hook_short', `The first line lands in about 2 seconds (≤ ${HOOK_MAX_WORDS} words)`, n0 > 0 && n0 <= HOOK_MAX_WORDS, `${n0} words`, split ? 'Split it: the hook first, the rest joins the next line' : ''));
  if (split) { fixed = split; changes.push('The first line is split so the hook lands in 2 seconds'); }
  const c0 = shots[0]?.cam;
  const striking = c0 ? STRIKING.includes(c0.size) || (c0.move && c0.move !== 'static') : /close[- ]?up|macro|extreme close|push|zoom|dolly|tracking|whip/i.test(`${shots[0]?.image || ''} ${shots[0]?.motion || ''}`);
  rules.push(rule('hook_frame', 'The first frame is striking (close, macro or moving)', !!striking, c0 ? `${c0.size || 'shot'}${c0.move ? ` · ${c0.move}` : ''}` : '', striking ? '' : 'Open close on a face, a hand or the product, or move the camera'));
  // the shots: varied sizes, the product early
  if (shots.some((s) => s.cam)) {
    const same = shots.findIndex((s, i) => i && s.cam?.size && s.cam.size === shots[i - 1].cam?.size);
    rules.push(rule('shot_variety', 'No two shots the same size back to back', same < 0, same < 0 ? shots.map((s) => s.cam?.size || '?').join(' → ') : `Shots ${same} and ${same + 1} are both ${shots[same].cam.size}`, same < 0 ? '' : 'Change one of them to a wider or closer shot'));
  }
  const ss = shotSecs(script, o.secs), startOf = (i) => 0.15 + ss.slice(0, i).reduce((a, b) => a + b, 0);
  if (shots.some((s) => typeof s.product === 'boolean')) {
    const p = shots.findIndex((s) => s.product);
    const at = p < 0 ? null : startOf(p), ok = p >= 0 && at <= F.productBy;
    let fix = p < 0 ? 'Show the product (or the result) in one of the first scenes' : '';
    // the product's scene moves up to right after the hook (the hook stays first); if even that's late, it belongs in
    // the opening shot too
    if (p > 1 && !ok) { fixed = moveScene(fixed, p, 1); changes.push(`Scene ${p + 1} (the product) moves up to scene 2`); }
    if (p > 0 && !ok) fix = `${p > 1 ? `Move scene ${p + 1} up to scene 2` : ''}${startOf(1) > F.productBy ? `${p > 1 ? ', and s' : 'S'}how the product in the opening shot` : ''}`;
    rules.push(rule('product_early', `The product is on screen by ${F.productBy}s`, ok, p < 0 ? 'No scene shows the product' : `From ${Math.round(at * 10) / 10}s (scene ${p + 1})`, fix));
  }
  // pace: the average time between cuts, counting the editor's punch-ins within long shots
  const every = cutEvery(format), measured = o.measured || null;
  const cuts = measured?.segments || ss.reduce((a, s) => a + (s > every * 1.25 ? Math.ceil(s / every) : 1), 0);
  const body = measured?.duration ? measured.duration - (script?.endCard?.cta || script?.endCard?.headline ? CARD_SECONDS : 0) : ss.reduce((a, b) => a + b, 0.4);
  const pace = cuts ? body / cuts : 0;
  rules.push(rule('pace', `A cut every ${F.shot[0]}–${F.shot[1]}s`, pace >= F.shot[0] - 0.05 && pace <= F.shot[1] + 0.05, `${Math.round(pace * 10) / 10}s on average over ${cuts} cuts`, pace < F.shot[0] ? 'Fewer, longer scenes' : pace > F.shot[1] ? 'More scenes, or shorter lines' : '', !measured && cuts > shots.length));
  // length: in the format's range and close to what was ordered
  const total = measured?.duration || body + CARD_SECONDS, ordered = Number(o.seconds) || 0;
  const lenOk = total >= F.seconds[0] && total <= F.seconds[1] && (!ordered || total <= ordered * 1.2 + 1);
  rules.push(rule('length', `${F.seconds[0]}–${F.seconds[1]}s${ordered ? `, about the ${ordered}s ordered` : ''}`, lenOk, `${Math.round(total * 10) / 10}s${measured ? '' : ' (estimated)'}`, lenOk ? '' : total < F.seconds[0] ? 'Add a scene' : `Cut it to about ${Math.round((ordered || F.seconds[1]) * 0.8 * WORDS_PER_SECOND)} spoken words`));
  if (measured && measured.firstWord != null) rules.push(rule('voice_starts', `The voice starts within ${VOICE_STARTS_BY}s`, measured.firstWord <= VOICE_STARTS_BY, `${Math.round(measured.firstWord * 100) / 100}s`, 'Start on the first word — no silent opening'));
  // captions: on (most feeds play muted), readable, inside the safe zone
  const style = o.captions?.style || null;
  rules.push(rule('captions_on', 'Captions on (most people watch with the sound off)', !!style, style || 'Off', style ? '' : 'Turn captions on', !style));
  if (style) {
    const [W, H] = frameOf(o.aspect), p = captionPlace(style, W, H), z = SAFE[F.safe] || SAFE.flat;
    const inside = p.top >= H * z.top - 1 && p.bottom <= H * (1 - z.bottom) + 1;
    rules.push(rule('caption_safe', `Captions clear of the app’s buttons (top ${Math.round(z.top * 100)}%, bottom ${Math.round(z.bottom * 100)}%)`, inside, p.moved ? 'Moved into the safe zone' : 'Inside the safe zone', inside ? '' : 'Pick another caption style', p.moved));
    rules.push(rule('caption_size', 'Captions big enough to read on a phone', true, p.enlarged ? `Enlarged to ${p.size}px` : `${p.size}px`, '', p.enlarged));
  }
  // the end: a call to action
  if (F.cta) { const cta = String(script?.endCard?.cta || '').trim(); rules.push(rule('cta', 'A call to action on the closing card', !!cta, cta || 'None', cta ? '' : 'Add one, like “Order on WhatsApp”')); }
  const passed = rules.every((x) => x.ok !== false);
  return { format, label: F.label, passed, rules, script: fixed !== script ? fixed : null, changes };
}
// a Reel's standard: the stored one from its last edit (measured), else its plan checked now
export function reelStandard(r, assessment = null) {
  if (!r?.script) return null;
  if (r.standard && ['ready', 'needs_review'].includes(r.status)) return r.standard;
  return checkVideo(r.script, { format: reelFormat(r), seconds: r.seconds, aspect: r.aspect, captions: r.captions, secs: (r.lines || []).map((l) => l.secs), assessment });
}

// what reelView shows: the standard (rules ✓/✗, the suggested script), the treatment, the playbook picks and the gate
export function standardView(r, assessment = null) {
  const s = r?.script;
  return { standard: reelStandard(r, assessment), treatment: treatmentOf(s), hook: s?.hook ? { id: s.hook, label: HOOKS[s.hook].label } : null, structure: s?.structure ? { id: s.structure, label: STRUCTURES[s.structure].label } : null, gate: r?.gate || null };
}

// ---------- a design ----------
export function designFormat(d) {
  if (d.group === 'carousel') return 'carousel';
  if (d.group === 'thumbnail' || d.format === 'thumbnail') return 'thumbnail';
  return d.format === 'story' ? 'story' : 'feed';
}
const bare = (t) => String(t || '').replace(/\*/g, '').trim();
// d: the design; fields(template) → the template's field keys; safe: the typesetter's safe box for its frame
export function checkDesign(d, { fields = () => [], safe = null, size = null } = {}) {
  const format = designFormat(d), F = FORMATS[format], rules = [];
  const slides = d.slides || [], first = slides[0]?.text || {};
  const head = bare(first.headline), n = words(head).length;
  if (!(d.typography && d.bgUrl)) rules.push(rule('headline_short', `The headline reads in under 2 seconds (≤ ${F.headline} words)`, n > 0 && n <= F.headline, n ? `${n} words` : 'No headline', n > F.headline ? 'Cut it to the one idea that matters' : n ? '' : 'Add a headline'));
  if (F.slides) rules.push(rule('slides', `${F.slides[0]}–${F.slides[1]} slides`, slides.length >= F.slides[0] && slides.length <= F.slides[1], `${slides.length} slides`, slides.length < F.slides[0] ? 'Add a slide' : 'Drop a slide'));
  // a call to action wherever the template has room for one (a greeting or a quote has none)
  const ctaSlide = F.slides ? slides.at(-1) : slides[0];
  if (F.cta && ctaSlide && fields(ctaSlide.template).includes('cta')) { const c = bare(ctaSlide.text?.cta); rules.push(rule('cta', 'A call to action', !!c, c || 'None', c ? '' : 'Add the one thing to do next, like “Order on WhatsApp”')); }
  // the typesetter keeps every word inside its safe box: that box must be at least the format's zone
  if (safe && size) {
    const z = SAFE[F.safe] || SAFE.flat, ok = safe.t >= Math.floor(size.h * z.top) && safe.b >= Math.floor(size.h * z.bottom);
    rules.push(rule('safe_zone', `Words clear of the app’s overlays (top ${Math.round(z.top * 100)}%, bottom ${Math.round(z.bottom * 100)}%)`, ok, `${Math.round((safe.t / size.h) * 100)}% / ${Math.round((safe.b / size.h) * 100)}% kept clear`, ok ? '' : 'Use a story template'));
  }
  if (d.bg === 'ai') rules.push(rule('final_picture', 'The real picture, not the preview', !!d.bgUrl, d.bgUrl ? 'Made' : 'Brand colours stand in for it', d.bgUrl ? '' : 'Make the picture'));
  const passed = rules.every((x) => x.ok !== false);
  return { format, label: F.label, passed, rules, script: null, changes: [] };
}

// ---------- the gate ----------
// ready only when every rule passes and the final review scored at least QUALITY_BAR
export function gateOf(standard, score) {
  const failing = (standard?.rules || []).filter((x) => x.ok === false);
  const scored = typeof score === 'number';
  const ready = !!standard && !failing.length && scored && score >= QUALITY_BAR;
  const issues = [...failing.map((x) => `${x.label}: ${x.detail}${x.fix ? ` — ${x.fix}` : ''}`), ...(scored ? (score < QUALITY_BAR ? [`The review scored ${score}; ${QUALITY_BAR} is the bar`] : []) : ['The final review didn’t run — watch it before posting'])];
  return { ready, score: scored ? score : null, bar: QUALITY_BAR, issues };
}
