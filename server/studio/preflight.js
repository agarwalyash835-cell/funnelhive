// The check before anything is paid for: the plan for a Reel (every scene's pictures and movement, every voiceover
// line, the hook, the closing card, the music) or the words for an image, ad creative or clip, read by an AI creative
// director for quality and for how well it will travel in an Indian feed — with changes the seller applies in one click.
// It costs no Studio credits (a text model reads the plan; nothing is rendered), and it never blocks: without an
// answer the seller just goes ahead.
import crypto from 'node:crypto';
import { askAI } from '../ai.js';
import { HOOKS, STRUCTURES } from './standard.js';

const s = (x, n) => String(x ?? '').trim().slice(0, n);
const pct = (x) => { const n = Number(x); return Number.isFinite(n) ? Math.min(100, Math.max(0, Math.round(n))) : null; };
const parse = (t) => { try { return JSON.parse(String(t).trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')); } catch { return null; } };
// the same plan gets the same answer: a Reel keeps its last check until the script changes
export const planHash = (x) => crypto.createHash('sha1').update(JSON.stringify(x)).digest('hex').slice(0, 16);

const DIRECTOR = `You are the creative director of a top Indian performance-marketing agency. Before a cent is spent on production, you check the plan for a short video ad (Instagram Reels / YouTube Shorts / a video sales letter) for an Indian small business — scene by scene, frame by frame, line by line — for production quality and for virality (watched to the end, shared, acted on).
Check:
- hook: do the first scene's picture and first line stop the scroll in under 2 seconds (a face, a striking image, tension, a bold claim the brief supports)?
- each scene: is the picture prompt specific enough to film (subject, setting, light, camera, framing)? does the main person stay the same (age, face, clothes)? is there real movement in the motion? does it show what the line says? anything likely to look fake or warped (hands, text, crowds)?
- voice: natural spoken lines, short sentences, one idea each, in the language asked; not too many words for the length
- story: problem → turn → result → offer, clear in one watch
- end card: brand, offer and call to action, readable at a glance
- virality: emotion, relatability for Indian viewers, a payoff, rewatch value
- playbook: the plan names a hook and a structure (and each scene's beat). Did the first line and first scene really do that hook? Do the scenes really follow that structure?
- cinematography: does each scene's camera plan (size, angle, lens, light, move) make a filmable, varied, agency-grade sequence in one look?
Never invent prices, offers or claims the brief doesn't give. Answer only JSON:
{"quality": 0-100, "virality": 0-100, "verdict": "one plain sentence",
 "playbook": {"hook": true or false (the named hook was executed), "structure": true or false (the named structure was followed), "problem": "or empty"},
 "hook": {"score": 0-100, "problem": "or empty", "line": "a better first line or empty", "image": "a better first picture prompt or empty"},
 "scenes": [{"scene": n from 1, "score": 0-100, "problem": "plain words, or empty when it's good", "image": "a better opening picture prompt or empty", "end": "a better closing picture prompt or empty", "motion": "better movement or empty", "line": "a better voiceover line or empty"}],
 "voice": {"score": 0-100, "problem": "or empty"},
 "endCard": {"headline": "max 40 chars or empty", "offer": "max 40 chars or empty", "cta": "max 30 chars or empty"},
 "music": "a better music direction or empty"}
Only suggest a change when it clearly helps; leave fields empty otherwise. Never mention AI, models or tools.`;

const PROMPT_DIRECTOR = (kind) => `You are the creative director of a top Indian performance-marketing agency. Before anything is paid for, check the request for ${kind === 'clip' ? 'a short video clip' : 'an image (a social media design or an ad creative)'} for an Indian small business: is it specific enough to make well (subject, setting, light, camera, framing${kind === 'clip' ? ', movement' : ', composition, space for text'}), will it look real and on-brand, will it stop the scroll in a feed? Never invent prices or claims. Answer only JSON:
{"quality": 0-100, "virality": 0-100, "verdict": "one plain sentence", "problems": ["plain words", …at most 4], "prompt": "the improved request, ready to use, or empty when it's already strong"}
Never mention AI, models or tools.`;

// a Reel's script → the check, made safe (scene numbers from 1 kept as indexes from 0; only real scenes)
export function cleanPlan(v, script) {
  if (!v || typeof v !== 'object') return null;
  const n = script.shots?.length || 0;
  const scenes = (Array.isArray(v.scenes) ? v.scenes : []).map((x) => ({ i: Math.round(Number(x?.scene)) - 1, score: pct(x?.score), problem: s(x?.problem, 200), image: s(x?.image, 600), end: s(x?.end, 600), motion: s(x?.motion, 300), line: s(x?.line, 220) }))
    .filter((x) => Number.isInteger(x.i) && x.i >= 0 && x.i < n).slice(0, 8);
  const e = v.endCard || {}, card = { headline: s(e.headline, 40), offer: s(e.offer, 40), cta: s(e.cta, 30) };
  return {
    quality: pct(v.quality), virality: pct(v.virality), verdict: s(v.verdict, 240),
    ...(v.playbook && typeof v.playbook === 'object' ? { playbook: { ...(typeof v.playbook.hook === 'boolean' ? { hook: v.playbook.hook } : {}), ...(typeof v.playbook.structure === 'boolean' ? { structure: v.playbook.structure } : {}), problem: s(v.playbook.problem, 200) } } : {}),
    hook: { score: pct(v.hook?.score), problem: s(v.hook?.problem, 200), line: s(v.hook?.line, 220), image: s(v.hook?.image, 600) },
    scenes, voice: { score: pct(v.voice?.score), problem: s(v.voice?.problem, 200) },
    endCard: card.headline || card.offer || card.cta ? card : null, music: s(v.music, 200), at: Date.now(),
  };
}

// → the check, or null when no answer came (the seller goes ahead without it)
export async function assessReel({ brief, script, seconds, aspect, motion, lang }) {
  const user = `Brief: ${s(brief, 1500)}\nLength: ${seconds || 30} seconds · frame ${aspect || '9:16'} · ${motion === 'story' ? 'each scene animates from an opening to a closing picture' : motion === 'photo' ? 'each scene is a still with a slow zoom or pan' : 'each scene animates from its opening picture'} · voiceover language ${lang || 'en'}\nPlan: ${JSON.stringify({ title: script.title, hook: script.hook ? `${script.hook} (${HOOKS[script.hook]?.how || ''})` : 'none named', structure: script.structure ? `${script.structure} (${STRUCTURES[script.structure]?.label || ''})` : 'none named', look: script.look || null, scenes: script.shots.map((x, i) => ({ scene: i + 1, line: script.lines[i] || '', image: x.image, end: x.end || '', motion: x.motion, ...(x.beat ? { beat: x.beat } : {}), ...(x.cam ? { camera: x.cam } : {}), ...(typeof x.product === 'boolean' ? { product: x.product } : {}) })), extraLines: script.lines.slice(script.shots.length), endCard: script.endCard, music: script.music || '' })}`;
  try { return cleanPlan(parse(await askAI(DIRECTOR, user, { json: true, timeoutMs: 90000 })), script); } catch (e) { console.error('studio plan check failed', e.message); return null; }
}
export async function assessPrompt({ kind, prompt, aspect, seconds, product }) {
  const user = `Request: ${s(prompt, 1500)}\nFrame: ${aspect || '1:1'}${kind === 'clip' ? ` · ${seconds || 5} seconds` : ''}${product ? ' · the seller’s real product photo goes in as the reference' : ''}`;
  try {
    const v = parse(await askAI(PROMPT_DIRECTOR(kind), user, { json: true, timeoutMs: 60000 }));
    if (!v) return null;
    return { quality: pct(v.quality), virality: pct(v.virality), verdict: s(v.verdict, 240), problems: (Array.isArray(v.problems) ? v.problems : []).map((x) => s(x, 200)).filter(Boolean).slice(0, 4), prompt: s(v.prompt, 1500) };
  } catch (e) { console.error('studio prompt check failed', e.message); return null; }
}

// a Design (designs.js): the words on every slide and the background picture's prompt, before the picture is paid for
const DESIGN_DIRECTOR = `You are the creative director of a top Indian social media agency. Before the background picture is paid for, check a design (an Instagram post, story, carousel, ad creative or YouTube thumbnail) for an Indian small business: the words on each slide and the prompt for the picture behind them.
Check: does the headline stop the scroll and read in under 2 seconds (few words, one idea)? is the offer, price or date clear where there is one? is there one clear call to action? is the language natural for the audience, spelled right, in the right script, and right for the occasion (festivals: warm, respectful, no hard sell in a greeting)? for a carousel: does the cover make people swipe, does each slide make one point, does the end slide ask for one action? is the picture prompt specific (subject, setting, light) and does it leave calm room for the words, with no text in it?
Never invent prices, offers, dates or claims. Answer only JSON:
{"quality": 0-100, "virality": 0-100, "verdict": "one plain sentence", "problems": ["plain words", …at most 4], "slides": [{"slide": n from 1, "text": {only the fields worth changing: the better words, same language and script}}], "background": "a better picture prompt or empty"}
Only suggest a change when it clearly helps. Never mention AI, models or tools.`;
// → the check, or null without an answer. fields: the field keys each slide takes (anything else is dropped)
export async function assessDesign({ brief, group, format, lang, slides, background, fields }) {
  const user = `Brief: ${s(brief, 1200)}\nKind: ${group || 'post'} · frame ${format || 'square'} · language ${lang || 'en'}\nSlides: ${JSON.stringify(slides.map((x, i) => ({ slide: i + 1, template: x.template, text: x.text })))}\nPicture prompt: ${s(background, 1200)}`;
  try {
    const v = parse(await askAI(DESIGN_DIRECTOR, user, { json: true, timeoutMs: 60000 }));
    if (!v || typeof v !== 'object') return null;
    const changes = (Array.isArray(v.slides) ? v.slides : []).map((x) => {
      const i = Math.round(Number(x?.slide)) - 1, keys = fields[i] || [];
      const text = Object.fromEntries(Object.entries(x?.text || {}).filter(([k, t]) => keys.includes(k) && typeof t === 'string' && t.trim()).map(([k, t]) => [k, s(t, 260)]));
      return { i, text };
    }).filter((x) => Number.isInteger(x.i) && x.i >= 0 && x.i < slides.length && Object.keys(x.text).length).slice(0, 12);
    return { quality: pct(v.quality), virality: pct(v.virality), verdict: s(v.verdict, 240), problems: (Array.isArray(v.problems) ? v.problems : []).map((x) => s(x, 200)).filter(Boolean).slice(0, 4), slides: changes, background: s(v.background, 1200), at: Date.now() };
  } catch (e) { console.error('studio design check failed', e.message); return null; }
}
