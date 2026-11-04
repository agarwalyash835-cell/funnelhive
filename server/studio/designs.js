// Studio Designs: posts with words on them — festive greetings, sale and offer posters, launches, customer quotes,
// before/after, events, story graphics, YouTube thumbnails and Instagram carousels — in English or any Indian language,
// on the seller's brand (colours, logo, font style from Studio's memory).
//   draft      the AI wrote the words (and the background picture's prompt) for the chosen template; a free preview is
//              drawn with the brand's colours standing in for the picture (or the seller's own photo, final at once).
//              The words can be checked for quality and virality (preflight.js) — nothing has been spent yet.
//   producing  the background picture is being made (one Studio image, through the same queue and quality check as any
//              other — jobs.js); it carries no words, the typesetter (typeset.js) adds them
//   ready      every slide drawn; any change to the words, colours, template, font or size is a free re-draw on the
//              same picture (no new picture, no credits) · failed: the picture couldn't be made — make it again
// A carousel is one design with several slides (a cover, content slides, an end slide) on one background: one look.
// "AI typography" (English only, clearly marked): the picture model paints the headline itself in a stylised way —
// only with the models that are good at words — and the typesetter draws everything else.
import fs from 'node:fs';
import path from 'node:path';
import { T, q, JOBS, dir as DATA_DIR } from '../db.js';
import { askAI } from '../ai.js';
import { studioReady } from './kie.js';
import { enqueue, view } from './jobs.js';
import { imageCost, modelKey, TIER_MENU, TIERS } from './models.js';
import { localCopy, save, rm, tmpFile } from './media.js';
import { memoryOf } from './memory.js';
import { LANGUAGES, langBase } from './voice.js';
import { FORMATS, FAMILIES, hexOk } from './typeset.js';
import { TEMPLATES, TEMPLATE_IDS, CAROUSEL, draw } from './design-templates.js';
import { s3Enabled, deleteObject } from '../storage.js';
import { planHash } from './preflight.js';

export const GROUPS = ['post', 'thumbnail', 'carousel'];
export const BACKGROUNDS = ['ai', 'photo', 'none'];
const TYPO_MODELS = ['gpt-image-2', 'ideogram-3'];
const clip = (v, n) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const parse = (t) => { try { return JSON.parse(String(t).trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')); } catch { return null; } };
const groupOf = (id) => TEMPLATES[id]?.group || 'post';

// a slide's words, cleaned to the template's fields (anything else dropped, each to its length)
export function cleanText(template, t = {}) {
  const T0 = TEMPLATES[template];
  const out = {};
  for (const f of T0?.fields || []) out[f.key] = clip(t[f.key], f.max + 4);
  return out;
}
// what a design costs: the background picture when the AI makes it; the words and every re-draw are free
export const designCost = (d) => (d.bg === 'ai' ? imageCost(d.tier, d.imodel) : 0);
// the image model for the background: a words-capable one for AI typography (when the tier offers it)
function bgModel(tier, imodel, typography) {
  if (!typography) return imodel ? modelKey('image', tier, imodel) : undefined;
  const menu = TIER_MENU[TIERS.includes(tier) ? tier : 'standard'].image;
  return TYPO_MODELS.includes(imodel) && menu.includes(imodel) ? imodel : TYPO_MODELS.find((m) => menu.includes(m)) || undefined;
}

// ---------- the words ----------
const fieldList = (id) => TEMPLATES[id].fields.map((f) => `"${f.key}": ${f.label.toLowerCase()} (max ${f.max} chars)`).join(', ');
const COPY_RULES = `Rules: write every field in the language asked, in that language's own script, the way people there really write ads (common English words like Sale, Offer, Free delivery are fine; numbers and prices in digits with ₹); headlines are short and punchy (2-7 words) and stop the scroll; put *stars* around the one or two words of the headline that matter most (they are shown in the accent colour); never invent prices, discounts, dates, phone numbers or claims the brief doesn't give — leave those fields empty instead; never put the business name in the headline unless asked. "background" is a detailed photo prompt in English for the picture behind the words (subject, setting, light, camera, mood), every person Indian unless the brief says otherwise, with NO text, letters, numbers, logos or signs anywhere in it, composed as described.`;
const SINGLE = (ids) => `You are the senior copywriter and art director of a top Indian social media agency. You write the words for one design (an Instagram post, story, ad creative or YouTube thumbnail) for an Indian small business, and the prompt for its background picture.
${ids.length > 1 ? `First pick the best template for the brief from: ${ids.map((id) => `${id} (${TEMPLATES[id].note})`).join('; ')}.\n` : ''}Answer only JSON: {${ids.length > 1 ? '"template": the id, ' : ''}"background": "...", "text": {the template's fields}}.
${COPY_RULES}`;
const CAROUSEL_SYSTEM = `You are the senior copywriter and art director of a top Indian social media agency. You write an Instagram carousel for an Indian small business: a cover that makes people swipe, content slides with one clear point each, and an end slide that asks for one action. Answer only JSON:
{"background": "...", "cover": {${fieldList(CAROUSEL.cover)}}, "slides": [{${fieldList(CAROUSEL.content)}}], "end": {${fieldList(CAROUSEL.end)}}}
The body of a content slide is 1-3 short sentences. ${COPY_RULES}`;

// → { template, background, slides: [{ template, text }] }
export async function writeCopy({ brief, group = 'post', template, slides = 5, lang = 'en', business = '', format = 'square', typography = false }) {
  const language = LANGUAGES[langBase(lang)] || 'English', F = FORMATS[format] || FORMATS.square;
  if (group === 'carousel') {
    const n = Math.min(10, Math.max(3, Math.round(Number(slides) || 5)));
    const user = `Brief: ${brief}\nBusiness: ${business || 'the seller'}\nLanguage: ${language}\nSlides: ${n} in total — the cover, ${n - 2} content slides, the end slide\nBackground (shared by every slide, darkened behind the words): ${TEMPLATES[CAROUSEL.cover].space}; frame ${F.aspect}`;
    const v = parse(await askAI(CAROUSEL_SYSTEM, user, { json: true, timeoutMs: 90000 }));
    if (!v?.cover) throw new Error('The AI wrote something that wasn’t a carousel — please try again');
    const content = (Array.isArray(v.slides) ? v.slides : []).slice(0, n - 2);
    if (!content.length) throw new Error('The AI wrote something that wasn’t a carousel — please try again');
    return { template: CAROUSEL.cover, background: clip(v.background, 1200), slides: [{ template: CAROUSEL.cover, text: cleanText(CAROUSEL.cover, v.cover) }, ...content.map((s) => ({ template: CAROUSEL.content, text: cleanText(CAROUSEL.content, s) })), { template: CAROUSEL.end, text: cleanText(CAROUSEL.end, v.end) }] };
  }
  const ids = TEMPLATES[template] ? [template] : TEMPLATE_IDS.filter((id) => TEMPLATES[id].group === group);
  const fields = ids.map((id) => `${id}: ${fieldList(id)}; picture: ${TEMPLATES[id].space}`).join('\n');
  const user = `Brief: ${brief}\nBusiness: ${business || 'the seller'}\nLanguage: ${language}\nFrame: ${F.label} (${F.aspect})\nTemplate fields and how the picture is composed:\n${fields}${typography ? '\nThe headline will be painted INTO the picture as stylised lettering: keep it in English, at most 5 words, no stars.' : ''}`;
  const v = parse(await askAI(SINGLE(ids), user, { json: true, timeoutMs: 90000 }));
  if (!v?.text) throw new Error('The AI wrote something that wasn’t a design — please try again');
  const id = ids.includes(v.template) ? v.template : ids[0];
  return { template: id, background: clip(v.background, 1200), slides: [{ template: id, text: cleanText(id, v.text) }] };
}

// the background prompt as sent: the art director's prompt, where the words go, and (AI typography) the headline
export function backgroundPrompt(d) {
  const space = TEMPLATES[d.slides[0].template]?.space;
  const head = d.typography ? clip(d.slides[0].text.headline, 60).replace(/\*/g, '') : '';
  return [d.bgPrompt, space ? `Composition: ${space}.` : '', head ? `Paint the words "${head}" into the picture as bold, stylised display lettering that fits the scene, spelled exactly like that, placed where the composition leaves room.` : 'No text, letters, numbers, logos or signs anywhere.'].filter(Boolean).join('\n').slice(0, 1500);
}

// ---------- drawing ----------
const UPLOADS = path.join(DATA_DIR, 'uploads');
// the files behind a design's previous slides: removed when it's re-drawn (only the latest version is kept)
async function dropOutputs(userId, outputs = []) {
  const { addStorage } = await import('../limits.js');
  for (const o of outputs) {
    const m = /\/uploads\/([\w-]+)\/(studio-[\w.-]+\.png)$/.exec(o?.url || '');
    if (!m || m[1] !== userId) continue;
    const f = path.join(UPLOADS, m[1], m[2]);
    if (fs.existsSync(f)) fs.rmSync(f, { force: true });
    else if (s3Enabled()) await deleteObject(`uploads/${m[1]}/${m[2]}`).catch(() => {});
    if (o.bytes) addStorage(userId, -o.bytes);
  }
}
// a picture the design uses → a local file (and whether it's a temp copy to delete)
async function fileOf(url) { if (!url) return null; try { return await localCopy(url, 'png'); } catch (e) { console.error('design picture unavailable', e.message); return null; } }

// every slide drawn on the design's current picture(s) → saved; the old files go
export async function renderDesign(d) {
  const made = [];
  const [photo, photo2, logo] = await Promise.all([fileOf(d.bgUrl || d.photo), fileOf(d.photo2), fileOf(d.brand?.logo)]);
  for (const c of [photo, photo2, logo]) if (c?.temp) made.push(c.file);
  const outputs = [];
  try {
    for (let i = 0; i < d.slides.length; i++) {
      const s = d.slides[i], out = tmpFile('png');
      made.push(out);
      // AI typography: the picture already carries the headline, so the typesetter leaves it out
      const text = { ...s.text, brand: d.brand?.name || '', ...(d.typography && d.bgUrl && i === 0 ? { headline: '' } : {}) };
      const dim = await draw({ format: d.format, template: s.template, text, colours: d.colours, family: d.family, photo: photo?.file || null, photo2: photo2?.file || null, logo: logo?.file || null, slide: i, slides: Math.max(1, d.slides.length - 2), out });
      const saved = await save(d.userId, out, 'png', 'image/png');
      outputs.push({ url: saved.url, bytes: saved.bytes, width: dim.width, height: dim.height });
    }
  } finally { rm(...made); }
  const old = T.studio.get(d.id)?.outputs || [];
  const x = T.studio.update(d.id, (y) => { y.outputs = outputs; y.version = (y.version || 0) + 1; y.drawnAt = Date.now(); if (y.status !== 'producing') y.status = y.bg === 'ai' && !y.bgUrl ? 'draft' : 'ready'; delete y.error; });
  await dropOutputs(d.userId, old);
  return x;
}

// ---------- making one ----------
// opts: { brief, group, format, template, lang, slides, bg, photo, photo2, tier, imodel, typography, colours, family, text, by }
export async function newDesign(user, o) {
  const mem = memoryOf(user.id);
  const group = GROUPS.includes(o.group) ? o.group : TEMPLATES[o.template] ? groupOf(o.template) : 'post';
  const format = FORMATS[o.format] ? o.format : group === 'thumbnail' ? 'thumbnail' : group === 'carousel' ? 'portrait' : 'square';
  const lang = LANGUAGES[langBase(o.lang)] ? langBase(o.lang) : mem.prefs?.lang || 'en';
  const typography = !!o.typography && lang === 'en' && group !== 'carousel' && o.bg !== 'photo' && o.bg !== 'none';
  const business = mem.brand?.name || user.settings?.businessName || user.name || '';
  const tier = TIERS.includes(o.tier) ? o.tier : mem.prefs?.tier || 'standard';
  let copy;
  if (o.text && TEMPLATES[o.template] && group !== 'carousel') copy = { template: o.template, background: clip(o.background || o.brief, 1200), slides: [{ template: o.template, text: cleanText(o.template, o.text) }] };
  else copy = await writeCopy({ brief: o.brief, group, template: o.template, slides: o.slides, lang, business, format, typography });
  const colours = (Array.isArray(o.colours) && o.colours.filter(hexOk).length ? o.colours.filter(hexOk) : mem.brand?.colours || []).slice(0, 2);
  const bg = BACKGROUNDS.includes(o.bg) ? o.bg : o.photo ? 'photo' : 'ai';
  const d = enqueue(user.id, {
    kind: 'design', status: 'draft', group, format, lang, prompt: clip(o.brief, 1500), bgPrompt: copy.background, bg, typography, tier,
    imodel: bgModel(tier, o.imodel, typography), photo: bg === 'photo' ? o.photo || null : null, photo2: o.photo2 || null, colours,
    family: FAMILIES.includes(o.family) ? o.family : FAMILIES.includes(mem.brand?.font) ? mem.brand.font : null,
    brand: { name: business, logo: mem.brand?.logo || '' }, slides: copy.slides, outputs: [], by: o.by || null,
  });
  return renderDesign(d);
}
// the go-ahead for the background picture (this is where credits are spent); with a note, the picture changes
export function makeBackground(d, { note = '' } = {}) {
  if (d.bg !== 'ai') return { error: 'This design uses your own picture — there’s nothing to make' };
  if (d.status === 'producing') return { error: 'The picture is already being made' };
  const prompt = note ? `${backgroundPrompt(d)}\nChange: ${clip(note, 300)}` : backgroundPrompt(d);
  const img = enqueue(d.userId, { kind: 'image', tier: d.tier, imodel: d.imodel, prompt, aspect: FORMATS[d.format].aspect, ref: null, designId: d.id, textArt: !!d.typography, by: d.by });
  return { design: T.studio.update(d.id, (x) => { x.status = 'producing'; x.bgId = img.id; delete x.error; }) };
}
// changes after it's made — all free re-draws: { slides: [{ i, text }] | full list, template, colours, family, format,
// photo / photo2 (own pictures), brand: { name } }
export async function editDesign(d, b = {}) {
  const x = T.studio.update(d.id, (y) => {
    if (Array.isArray(b.slides)) {
      for (const [k, s] of b.slides.entries()) {
        const i = Number.isInteger(s?.i) ? s.i : k;
        if (!y.slides[i]) continue;
        const tpl = s.template && TEMPLATES[s.template] && groupOf(s.template) === groupOf(y.slides[i].template) ? s.template : y.slides[i].template;
        y.slides[i] = { template: tpl, text: cleanText(tpl, { ...y.slides[i].text, ...(s.text || {}) }) };
      }
    }
    if (b.template && TEMPLATES[b.template] && y.group !== 'carousel') y.slides = [{ template: b.template, text: cleanText(b.template, { ...y.slides[0].text, ...(b.text || {}) }) }];
    else if (b.text && y.slides[0]) y.slides[0].text = cleanText(y.slides[0].template, { ...y.slides[0].text, ...b.text });
    if (Array.isArray(b.colours)) y.colours = b.colours.filter(hexOk).slice(0, 2);
    if (b.family !== undefined) y.family = FAMILIES.includes(b.family) ? b.family : null;
    if (FORMATS[b.format]) y.format = b.format;
    if (b.brand?.name !== undefined) y.brand = { ...y.brand, name: clip(b.brand.name, 80) };
    if (b.photo !== undefined) { y.photo = b.photo || null; if (b.photo) { y.bg = 'photo'; y.bgUrl = null; } }
    if (b.photo2 !== undefined) y.photo2 = b.photo2 || null;
    if (b.background !== undefined && y.bg === 'ai') y.bgPrompt = clip(b.background, 1200);
  });
  return renderDesign(x);
}
// the slides as a zip (carousels are posted slide by slide, in order)
export async function zipDesign(d) {
  const { zipSync } = await import('fflate');
  const files = {}, made = [];
  try {
    for (const [i, o] of (d.outputs || []).entries()) {
      const c = await localCopy(o.url, 'png');
      if (c.temp) made.push(c.file);
      files[`${String(i + 1).padStart(2, '0')}-${d.group === 'carousel' ? (i === 0 ? 'cover' : i === d.outputs.length - 1 ? 'end' : 'slide') : d.format}.png`] = new Uint8Array(fs.readFileSync(c.file));
    }
  } finally { rm(...made); }
  return Buffer.from(zipSync(files, { level: 0 }));
}

// a design as the seller sees it (the provider and model never appear)
export function designView(d) {
  const bgRow = d.bgId ? T.studio.get(d.bgId) : null;
  const hash = planHash({ slides: d.slides, bg: d.bgPrompt });
  return {
    id: d.id, kind: 'design', status: d.status, group: d.group, format: d.format, size: FORMATS[d.format] ? { width: FORMATS[d.format].w, height: FORMATS[d.format].h, label: FORMATS[d.format].label } : null,
    lang: d.lang, prompt: d.prompt, background: d.bgPrompt, bg: d.bg, typography: !!d.typography, tier: d.tier, colours: d.colours, family: d.family || TEMPLATES[d.slides[0]?.template]?.family || 'sans',
    brand: d.brand, photo: d.photo, photo2: d.photo2, slides: d.slides.map((s, i) => ({ template: s.template, name: TEMPLATES[s.template]?.name || s.template, text: s.text, url: d.outputs?.[i]?.url || null })),
    url: d.outputs?.[0]?.url || null, outputs: (d.outputs || []).map((o) => o.url), version: d.version || 0, picture: bgRow ? view(bgRow) : null, pictureReady: !!d.bgUrl,
    credits: d.bg === 'ai' ? designCost(d) : 0, preview: d.bg === 'ai' && !d.bgUrl, error: d.error || '', assessment: d.assessment?.hash === hash ? d.assessment : null, at: d.at, by: d.by || null,
  };
}
export const designHash = (d) => planHash({ slides: d.slides, bg: d.bgPrompt });

// ---------- the loop: a design waiting on its picture is drawn once the picture is in ----------
const busy = new Set();
export async function designsTick() {
  if (!studioReady()) return;
  const rows = q("SELECT data FROM studio WHERE status = 'producing' ORDER BY at").all().map((x) => JSON.parse(x.data)).filter((x) => x.kind === 'design');
  for (const d of rows) {
    if (busy.has(d.id)) continue;
    const img = T.studio.get(d.bgId);
    if (!img) { T.studio.update(d.id, (x) => { x.status = 'failed'; x.error = 'The picture went missing — make it again'; }); continue; }
    if (img.status === 'failed') { T.studio.update(d.id, (x) => { x.status = 'failed'; x.error = img.error || 'The picture couldn’t be made — make it again'; }); continue; }
    // a picture that didn't pass its check is still used (it's paid for); its notes show with the design
    if (!['ready', 'needs_review'].includes(img.status) || !img.url) continue;
    busy.add(d.id);
    try {
      T.studio.update(d.id, (x) => { x.bgUrl = img.url; x.status = 'ready'; });
      await renderDesign(T.studio.get(d.id));
    } catch (e) {
      console.error('design draw failed', d.id, e.message, e.detail || '');
      T.studio.update(d.id, (x) => { x.status = 'failed'; x.error = 'The design couldn’t be drawn — try again'; });
    } finally { busy.delete(d.id); }
  }
}
if (JOBS && process.env.NODE_ENV !== 'test') setInterval(() => { designsTick().catch((e) => console.error('designs tick failed', e.message)); }, 5000).unref();

// the template menu as sellers see it
export const templateMenu = () => TEMPLATE_IDS.map((id) => ({ id, name: TEMPLATES[id].name, group: TEMPLATES[id].group, note: TEMPLATES[id].note, fields: TEMPLATES[id].fields, colours: TEMPLATES[id].colours, family: TEMPLATES[id].family, sample: TEMPLATES[id].sample }));
export const formatMenu = () => Object.entries(FORMATS).map(([id, f]) => ({ id, label: f.label, width: f.w, height: f.h, aspect: f.aspect }));
