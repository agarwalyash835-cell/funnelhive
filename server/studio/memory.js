// Studio's memory of each seller: what it has learned about how they like their ads, so the next script starts closer
// to what they'd approve. One small record per seller (≤ 4 KB, every list capped, newest first):
//   brand       their business name, brand colours, logo
//   likes       look and tone they like (from script edits, feedback, or told directly)
//   avoid       what not to do again (from redo notes, quality-check fixes they used, feedback)
//   characters  the recurring people in their ads ({ name, look }), so faces and clothes stay the same across videos
//   prefs       the choices they made last time: tier, models, voice, captions, frame, length, language
//   wins        scripts they approved exactly as written (the title and the hook)
// learn(userId, event) is called from the Studio API as the seller works; the seller sees and corrects all of it
// (GET / PUT / DELETE /api/studio/memory). Learning never calls the AI: cheap heuristics only.
import { T } from '../db.js';
import { TIERS, VOICES, MOTIONS, modelKey } from './models.js';
import { PRESETS as CAPTION_STYLES } from './captions.js';
import { LANGUAGES } from './voice.js';

const CAP = { likes: 8, avoid: 10, characters: 3, wins: 5, colours: 3 };
const LEN = { item: 100, name: 30, look: 200, title: 60, hook: 100 };
const MAX_BYTES = 4096;
const FRAMES = ['9:16', '16:9', '1:1', '4:5'];
const clip = (v, n) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const hex = (v) => (/^#[0-9a-f]{6}$/i.test(String(v || '')) ? String(v).toLowerCase() : '');
const empty = () => ({ brand: { name: '', colours: [], logo: '' }, likes: [], avoid: [], characters: [], prefs: {}, wins: [] });
// an item joins the front of its list; one already there (any case) moves to the front instead of repeating
const key = (x) => String(typeof x === 'object' ? x.name || x.title : x).toLowerCase();
const add = (list, items, cap) => { let out = [...list]; for (const x of [].concat(items).reverse()) { if (!key(x)) continue; out = [x, ...out.filter((y) => key(y) !== key(x))]; } return out.slice(0, cap); };
const items = (v, n = LEN.item) => [].concat(v ?? []).map((x) => clip(x, n)).filter((x) => x.length >= 2);
const person = (c) => ({ name: clip(c?.name, LEN.name), look: clip(c?.look, LEN.look) });
const ownLogo = (userId, url) => (/^\/uploads\/[\w-]+\/[\w.-]+\.(png|jpe?g|webp)$/i.test(String(url || '')) && String(url).split('/')[2] === userId ? url : '');

export function memoryOf(userId) {
  const m = T.studiomem.get(userId);
  const e = empty();
  return m ? { brand: { ...e.brand, ...m.brand }, likes: m.likes || [], avoid: m.avoid || [], characters: m.characters || [], prefs: m.prefs || {}, wins: m.wins || [], at: m.at || null } : { ...e, at: null };
}
// only choices that still exist are kept (a model taken off the menu is forgotten)
function cleanPrefs(p = {}, base = {}) {
  const o = { ...base };
  if (TIERS.includes(p.tier)) o.tier = p.tier;
  const tier = o.tier || 'standard';
  if (p.vmodel && modelKey('clip', tier, p.vmodel) === p.vmodel) o.vmodel = p.vmodel;
  if (p.imodel && modelKey('image', tier, p.imodel) === p.imodel) o.imodel = p.imodel;
  if (VOICES.some((v) => v.id === p.voice)) o.voice = p.voice;
  if (CAPTION_STYLES[p.captions]) o.captions = p.captions;
  if (FRAMES.includes(p.aspect)) o.aspect = p.aspect;
  if (LANGUAGES[p.lang]) o.lang = p.lang;
  if ([15, 30, 45].includes(Number(p.seconds))) o.seconds = Number(p.seconds);
  if (/^(480p|720p|1080p|4k)$/.test(p.res || '')) o.res = p.res;
  if (MOTIONS.includes(p.motion)) o.motion = p.motion;
  for (const k of Object.keys(p)) if (p[k] === null) delete o[k]; // null: forget that one
  return o;
}
function save(userId, m) {
  const out = { id: userId, userId, brand: m.brand, likes: m.likes, avoid: m.avoid, characters: m.characters, prefs: m.prefs, wins: m.wins, at: Date.now() };
  // over the size limit: drop the oldest item of the longest list until it fits
  while (JSON.stringify(out).length > MAX_BYTES) {
    const k = ['wins', 'likes', 'avoid', 'characters'].sort((a, b) => JSON.stringify(out[b]).length - JSON.stringify(out[a]).length)[0];
    if (!out[k].length) break;
    out[k] = out[k].slice(0, -1);
  }
  T.studiomem.put(out);
  return memoryOf(userId);
}

// add to what Studio remembers: { likes, avoid, characters: [{ name, look }], brand: { name, colours, logo }, prefs, wins }
export function remember(userId, p = {}) {
  const m = memoryOf(userId);
  if (p.brand) {
    const b = p.brand;
    if (b.name !== undefined) m.brand.name = clip(b.name, 80);
    if (b.colours !== undefined) m.brand.colours = add(m.brand.colours, [].concat(b.colours).map(hex).filter(Boolean), CAP.colours);
    if (b.logo !== undefined) m.brand.logo = ownLogo(userId, b.logo);
  }
  if (p.likes) m.likes = add(m.likes, items(p.likes), CAP.likes);
  if (p.avoid) m.avoid = add(m.avoid, items(p.avoid), CAP.avoid);
  if (p.characters) m.characters = add(m.characters, [].concat(p.characters).map(person).filter((c) => c.name && c.look), CAP.characters);
  if (p.wins) m.wins = add(m.wins, [].concat(p.wins).map((w) => ({ title: clip(w?.title, LEN.title), hook: clip(w?.hook, LEN.hook) })).filter((w) => w.title), CAP.wins);
  if (p.prefs) m.prefs = cleanPrefs(p.prefs, m.prefs);
  return save(userId, m);
}
// the seller's own corrections: each field given replaces what was there (lists as a whole)
export function setMemory(userId, b = {}) {
  const m = memoryOf(userId);
  if (b.brand) m.brand = { name: b.brand.name !== undefined ? clip(b.brand.name, 80) : m.brand.name, colours: b.brand.colours !== undefined ? add([], [].concat(b.brand.colours).map(hex).filter(Boolean), CAP.colours) : m.brand.colours, logo: b.brand.logo !== undefined ? ownLogo(userId, b.brand.logo) : m.brand.logo };
  for (const k of ['likes', 'avoid']) if (b[k] !== undefined) m[k] = add([], items(b[k]), CAP[k]);
  if (b.characters !== undefined) m.characters = add([], [].concat(b.characters).map(person).filter((c) => c.name && c.look), CAP.characters);
  if (b.wins !== undefined) m.wins = add([], [].concat(b.wins).map((w) => ({ title: clip(w?.title, LEN.title), hook: clip(w?.hook, LEN.hook) })).filter((w) => w.title), CAP.wins);
  if (b.prefs !== undefined) m.prefs = cleanPrefs(b.prefs || {});
  return save(userId, m);
}
export const forget = (userId) => T.studiomem.del(userId);

// ---------- learning ----------
// what a script edit says about the seller's taste: shorter or longer lines, more or less energy, the script they
// write in, hype words taken out, the call to action they prefer
const HYPE = /\b(best|amazing|incredible|guaranteed|revolutionary|unbelievable|number one|no\. ?1|world[- ]class|miracle)\b/gi;
const words = (lines) => lines.join(' ').split(/\s+/).filter(Boolean);
const latin = (s) => { const l = (s.match(/[a-z]/gi) || []).length, o = (s.match(/[ऀ-෿]/g) || []).length; return l + o ? l / (l + o) : 1; };
export function toneOf(before, after) {
  const likes = [], avoid = [];
  const a = before?.lines || [], b = after?.lines || [];
  if (a.length && b.length) {
    const pa = words(a).length / a.length, pb = words(b).length / b.length;
    if (pb < pa * 0.8) likes.push('Short, punchy lines');
    else if (pb > pa * 1.25) likes.push('Fuller, more detailed lines');
    const ea = (a.join(' ').match(/!/g) || []).length, eb = (b.join(' ').match(/!/g) || []).length;
    if (eb > ea) likes.push('Energetic lines with exclamations');
    else if (ea && !eb) likes.push('A calm tone, no exclamation marks');
    const la = latin(a.join(' ')), lb = latin(b.join(' '));
    if (la < 0.5 && lb >= 0.5) likes.push('Voiceover written in Roman letters (Hinglish style)');
    else if (la >= 0.5 && lb < 0.5) likes.push('Voiceover in the language’s own script');
    const gone = [...new Set((a.join(' ').match(HYPE) || []).map((x) => x.toLowerCase()))].filter((w) => !b.join(' ').toLowerCase().includes(w));
    if (gone.length) avoid.push(`Hype words like “${gone.slice(0, 3).join('”, “')}”`);
  }
  const ca = clip(before?.endCard?.cta, 30), cb = clip(after?.endCard?.cta, 30);
  if (cb && cb !== ca) likes.push(`Call to action like “${cb}”`);
  return { likes, avoid };
}
const same = (x, y) => JSON.stringify({ l: x?.lines, s: x?.shots, e: x?.endCard, t: x?.title }) === JSON.stringify({ l: y?.lines, s: y?.shots, e: y?.endCard, t: y?.title });
const NEG = /^(don['’]?t|do not|never|no|avoid|stop|without|less)\b/i;

// events: { kind: 'approve', reel, script } · { kind: 'redo', note } · { kind: 'script_edited', reel, script }
// · { kind: 'feedback', text }. Never throws: learning must not break the request it rides on.
export function learn(userId, e = {}) {
  try {
    if (e.kind === 'approve' && e.reel) {
      const r = e.reel;
      const p = { prefs: { tier: r.tier, vmodel: r.vmodel, imodel: r.imodel, voice: r.voice, captions: r.captions?.style, aspect: r.aspect, lang: r.lang, seconds: r.seconds, res: r.res, motion: r.motion || 'video' } };
      if (r.logo) p.brand = { logo: r.logo };
      // approved exactly as the AI wrote it: a win to write more like
      if (!r.edited && e.script && same(e.script, r.script)) p.wins = [{ title: e.script.title, hook: e.script.lines?.[0] }];
      else if (e.script && !same(e.script, r.script)) Object.assign(p, toneOf(r.script, e.script));
      return remember(userId, p);
    }
    if (e.kind === 'script_edited' && e.reel && e.script) {
      if (same(e.script, e.reel.script)) return null;
      T.studio.update(e.reel.id, (x) => { x.edited = true; });
      const t = toneOf(e.reel.script, e.script);
      return t.likes.length || t.avoid.length ? remember(userId, t) : null;
    }
    if (e.kind === 'redo') return clip(e.note, LEN.item).length >= 2 ? remember(userId, { avoid: [e.note] }) : null;
    if (e.kind === 'feedback') { const t = clip(e.text, LEN.item); return t.length >= 2 ? remember(userId, NEG.test(t) ? { avoid: [t] } : { likes: [t] }) : null; }
  } catch (err) { console.error('studio memory: couldn’t learn', e.kind, err.message); }
  return null;
}

// ---------- using it ----------
// the block folded into the script prompt; '' when nothing is known yet
export function memoryPrompt(m, business = '') {
  const out = [];
  const b = m.brand || {};
  const brand = [b.name && b.name !== business ? b.name : '', b.colours?.length ? `brand colours ${b.colours.join(', ')} (use them in sets, props and clothes where natural)` : ''].filter(Boolean);
  if (brand.length) out.push(`Their brand: ${brand.join(' · ')}`);
  if (m.likes?.length) out.push(`What this seller likes: ${m.likes.join('; ')}`);
  if (m.avoid?.length) out.push(`Avoid (they asked for changes like these before): ${m.avoid.join('; ')}`);
  if (m.characters?.length) out.push(`Their characters (when one fits the brief, use them, call them by name in the shot prompts and describe them exactly like this): ${m.characters.map((c) => `${c.name} — ${c.look}`).join('; ')}`);
  if (m.wins?.length) out.push(`Scripts they approved as written (match this style, don't copy them): ${m.wins.map((w) => `“${w.title}”${w.hook ? `: ${w.hook}` : ''}`).join('; ')}`);
  return out.length ? `\n\nWhat Studio remembers about this seller (follow it unless the brief says otherwise):\n${out.join('\n')}` : '';
}
// a new Reel's unspecified choices from the seller's last ones (models only when it's the same tier)
export function withPrefs(userId, o = {}) {
  const p = memoryOf(userId).prefs, m = { ...o };
  const unset = (k) => m[k] === undefined || m[k] === null || m[k] === '';
  if (unset('tier') && p.tier) m.tier = p.tier;
  const tier = m.tier || 'standard';
  if (p.tier === tier) for (const k of ['vmodel', 'imodel', 'res']) if (unset(k) && p[k]) m[k] = p[k];
  for (const k of ['voice', 'captions', 'aspect', 'lang', 'seconds']) if (unset(k) && p[k]) m[k] = p[k];
  if (unset('logo')) { const l = memoryOf(userId).brand.logo; if (l) m.logo = l; }
  return m;
}
// a shot's prompt naming one of the seller's characters gets their description, so they look the same in every video
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export function withCharacters(userId, prompt) {
  const cs = memoryOf(userId).characters.filter((c) => c.name && new RegExp(`\\b${esc(c.name)}\\b`, 'i').test(prompt) && !String(prompt).includes(c.look));
  return cs.length ? `${prompt}\n${cs.map((c) => `${c.name}: ${c.look}`).join('\n')}`.slice(0, 1500) : prompt;
}
