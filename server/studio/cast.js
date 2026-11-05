// The seller's cast and brand kit: Studio casts once, like an agency, so the same people and the same brand show up in
// every scene of every video.
//   cast       the recurring people: a name, how they look and what they wear, and their reference pictures — a sheet
//              made once in Studio (a front portrait, then a three-quarter view and a full-body shot made FROM the front
//              one, so it's one face) or the seller's own photos of them. Every still of a scene that shows one of them
//              gets their pictures as image references (with the product photo first), within the model's limit.
//   brand kit  logo and colours (kept in memory.js, which already had them), a font from the ones the editor has, the
//              tone of voice, and product photos (the first is the product for a Reel made without one).
// One row per character and one 'brand' row per seller in `studiocast`. Sellers only ever see tiers and credits.
import { T, JOBS } from '../db.js';
import { enqueue, dropAsset } from './jobs.js';
import { pick, imageCost, TIERS } from './models.js';
import { memoryOf, setMemory, withCharacters } from './memory.js';

export const MAX_CAST = 12;
const MAX_PHOTOS = 4, MAX_PRODUCTS = 6, PER_PERSON = 3;
// the fonts the editor can draw with (the server image bundles the Noto family, Devanagari included) — Google Fonts, so
// the page can show them as they'll look. Latin-only ones fall back to Noto Sans Devanagari for Hindi or Marathi.
export const BRAND_FONTS = {
  'noto-sans': { name: 'Noto Sans', family: 'Noto Sans', devanagari: false, note: 'Clean and modern' },
  'noto-serif': { name: 'Noto Serif', family: 'Noto Serif', devanagari: false, note: 'Classic, premium' },
  'noto-sans-devanagari': { name: 'Noto Sans Devanagari', family: 'Noto Sans Devanagari', devanagari: true, note: 'Hindi and Marathi, clean' },
  'noto-serif-devanagari': { name: 'Noto Serif Devanagari', family: 'Noto Serif Devanagari', devanagari: true, note: 'Hindi and Marathi, classic' },
};
// the reference sheet: the front portrait first, the other two made from it
export const SHEET = [
  { part: 'front', label: 'Front', aspect: '3:4', shot: 'Front-facing head-and-shoulders portrait, looking straight at the camera, relaxed natural expression' },
  { part: 'angle', label: 'Three-quarter', aspect: '3:4', shot: 'Three-quarter view portrait (head turned about 45 degrees), head and shoulders' },
  { part: 'body', label: 'Full body', aspect: '9:16', shot: 'Full-body shot standing, head to toe, the whole outfit visible' },
];

const clip = (v, n) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const hex = (v) => (/^#[0-9a-f]{6}$/i.test(String(v || '')) ? String(v).toLowerCase() : '');
const done = (a) => a && ['ready', 'needs_review'].includes(a.status) && a.url;
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const named = (c, text) => !!c.name && new RegExp(`(^|[^\\p{L}])${esc(c.name)}($|[^\\p{L}])`, 'iu').test(String(text || ''));

// ---------- the cast ----------
export const castOf = (userId) => T.studiocast.all({ userId }, { order: 'at' }).filter((c) => c.kind === 'character');
export const castMember = (userId, id) => { const c = T.studiocast.get(String(id || '')); return c && c.userId === userId && c.kind === 'character' ? c : null; };
// ids or names (Hive passes names) → the seller's characters
export function resolveCast(userId, list) {
  const all = castOf(userId), out = [];
  for (const x of [].concat(list || []).slice(0, MAX_CAST)) { const c = all.find((y) => y.id === x || y.name.toLowerCase() === String(x).trim().toLowerCase()); if (c && !out.includes(c)) out.push(c); }
  return out;
}
// { name, look, outfit, photos } checked; photos only the seller's own uploads (isOwn from routes.js)
export function cleanMember(b, isOwn, base = {}) {
  const o = { name: b.name !== undefined ? clip(b.name, 30) : base.name, look: b.look !== undefined ? clip(b.look, 300) : base.look, outfit: b.outfit !== undefined ? clip(b.outfit, 200) : base.outfit || '' };
  if (b.photos !== undefined) {
    const photos = [...new Set([].concat(b.photos || []))];
    if (photos.some((u) => !isOwn(u))) return { error: 'Pick your own photos of them' };
    o.photos = photos.slice(0, MAX_PHOTOS);
  } else o.photos = base.photos || [];
  if (!o.name || o.name.length < 2) return { error: 'Give them a short name, like Asha' };
  if ((!o.look || o.look.length < 5) && !o.photos.length) return { error: 'Describe how they look (age, face, hair) or add photos of them' };
  return { member: o };
}
export function addMember(userId, m) {
  const all = castOf(userId);
  if (all.length >= MAX_CAST) return { error: `A cast can have up to ${MAX_CAST} people — remove one first` };
  if (all.some((c) => c.name.toLowerCase() === m.name.toLowerCase())) return { error: `There’s already someone called ${m.name}` };
  return { member: T.studiocast.insert({ userId, kind: 'character', ...m, sheet: null, at: Date.now() }) };
}
// their sheet pictures go with them, files and storage too (one still being made goes once it's done: jobs.js dropAsset)
const dropSheet = (c) => { const ids = Object.values(c.sheet?.ids || {}).filter(Boolean); for (const id of ids) dropAsset(T.studio.get(id), ids); };
export function dropMember(c) {
  dropSheet(c);
  T.studiocast.del(c.id);
}

// a character's reference pictures, best first: the sheet (front, three-quarter, full body), then their photos
export function refsOf(c) {
  const sheet = SHEET.map((p) => T.studio.get(c.sheet?.ids?.[p.part])).filter(done).map((a) => a.url);
  return [...new Set([...sheet, ...(c.photos || [])])];
}
export function memberView(c) {
  const parts = SHEET.map((p) => { const a = T.studio.get(c.sheet?.ids?.[p.part]); return { part: p.part, label: p.label, status: a ? a.status : c.sheet && !c.sheet.failed ? 'waiting' : null, url: a?.url || null, id: a?.id || null }; });
  const status = !c.sheet ? 'none' : c.sheet.failed || parts.some((p) => p.status === 'failed') ? 'failed' : parts.every((p) => done(T.studio.get(c.sheet.ids?.[p.part]))) ? 'ready' : 'making';
  return { id: c.id, name: c.name, look: c.look, outfit: c.outfit || '', photos: c.photos || [], sheet: { status, tier: c.sheet?.tier || null, credits: c.sheet?.credits || null, parts }, refs: refsOf(c), at: c.at };
}

// ---------- the reference sheet (paid: three stills on the tier's default image model) ----------
export const sheetCost = (tier) => SHEET.length * imageCost(TIERS.includes(tier) ? tier : 'standard');
const sheetPrompt = (c, p, fromFront) => [`Character reference picture of ${c.name}. ${c.look}${c.outfit ? `. Wearing ${c.outfit}` : ''}.`, `${p.shot}. Even soft studio light, plain light-grey background, sharp focus on the face, no props.`, fromFront ? `The SAME person as the reference picture — identical face, age, skin tone, hair and outfit.` : c.photos?.length ? 'The SAME person as in the reference photos — identical face, age, skin tone and hair.' : ''].filter(Boolean).join('\n');
const sheetImage = (c, p, tier, refs, by) => enqueue(c.userId, { kind: 'image', tier, prompt: sheetPrompt(c, p, p.part !== 'front'), aspect: p.aspect, refs, castId: c.id, by }).id;
// starts it: the front portrait now (from their photos when there are some), the others once it's made
export function startSheet(c, tier, by = null) {
  const t = TIERS.includes(tier) ? tier : 'standard';
  dropSheet(c);
  const front = sheetImage(c, SHEET[0], t, (c.photos || []).slice(0, PER_PERSON), by);
  return T.studiocast.update(c.id, (x) => { x.sheet = { tier: t, credits: sheetCost(t), ids: { front }, by, at: Date.now() }; });
}
export const sheetBusy = (c) => !!c.sheet && !c.sheet.failed && SHEET.some((p) => { const a = T.studio.get(c.sheet.ids?.[p.part]); return !a || ['queued', 'rendering', 'checking'].includes(a.status); });
// once the front portrait is made, the three-quarter view and the full body are made from it (one face)
export function advanceSheets(userId = null) {
  const rows = userId ? castOf(userId) : T.studiocast.all({}).filter((c) => c.kind === 'character');
  for (const c of rows) {
    if (!c.sheet || c.sheet.failed || c.sheet.ids?.angle) continue;
    const front = T.studio.get(c.sheet.ids?.front);
    if (!front || front.status === 'failed') { T.studiocast.update(c.id, (x) => { x.sheet.failed = true; }); continue; }
    if (!done(front)) continue;
    const refs = [front.url, ...(c.photos || []).slice(0, 2)];
    T.studiocast.update(c.id, (x) => { for (const p of SHEET.slice(1)) x.sheet.ids[p.part] = sheetImage(c, p, c.sheet.tier, refs, c.sheet.by); });
  }
}

// ---------- the brand kit ----------
const brandRow = (userId) => T.studiocast.get(`brand-${userId}`);
export function brandKit(userId) {
  const b = brandRow(userId) || {}, m = memoryOf(userId).brand;
  return { name: m.name, logo: m.logo, colours: m.colours, font: BRAND_FONTS[b.font] ? b.font : 'noto-sans', tone: b.tone || '', products: b.products || [] };
}
// { name, logo, colours } go to memory.js (where they always lived); { font, tone, products } here
export function setBrandKit(userId, b, isOwn) {
  if (b.products !== undefined && [].concat(b.products || []).some((u) => !isOwn(u))) return { error: 'Pick your own product photos' };
  if (b.logo && !isOwn(b.logo)) return { error: 'Pick your own logo' };
  if (b.font !== undefined && b.font !== null && !BRAND_FONTS[b.font]) return { error: 'Pick one of the fonts offered' };
  const brand = {};
  for (const k of ['name', 'logo']) if (b[k] !== undefined) brand[k] = b[k] || '';
  if (b.colours !== undefined) brand.colours = [].concat(b.colours || []).map(hex).filter(Boolean);
  if (Object.keys(brand).length) setMemory(userId, { brand });
  const cur = brandRow(userId) || { id: `brand-${userId}`, userId, kind: 'brand' };
  T.studiocast.put({ ...cur, ...(b.font !== undefined ? { font: b.font || 'noto-sans' } : {}), ...(b.tone !== undefined ? { tone: clip(b.tone, 200) } : {}), ...(b.products !== undefined ? { products: [...new Set([].concat(b.products || []))].slice(0, MAX_PRODUCTS) } : {}), at: Date.now() });
  return { kit: brandKit(userId) };
}
export const brandFont = (userId) => BRAND_FONTS[brandKit(userId).font].family;

// ---------- using them ----------
// the script writer is told who the cast are (and who the seller picked for this ad) and the brand's tone
export function castPrompt(userId, picked = []) {
  const all = castOf(userId).slice(0, 8), kit = brandKit(userId), out = [];
  if (all.length) out.push(`Their cast — recurring people with fixed looks (reference pictures keep their faces the same). When a shot shows one of them, call them by name in its prompt and describe them exactly like this: ${all.map((c) => `${c.name} — ${c.look}${c.outfit ? `, wearing ${c.outfit}` : ''}`).join('; ')}`);
  const chosen = resolveCast(userId, picked);
  if (chosen.length) out.push(`Cast this ad with: ${chosen.map((c) => c.name).join(', ')} — they are the people in it, named in every shot they appear in.`);
  if (kit.tone) out.push(`The brand’s tone of voice: ${kit.tone}`);
  return out.length ? `\n\n${out.join('\n')}` : '';
}
// how many reference pictures a still can take: the model the job will really use (jobs.js startRender falls back to the
// tier's default when the chosen model takes none)
export function imageRefLimit(tier, imodel) {
  const m = pick('image', tier, imodel);
  const e = m.entry?.refs === 0 ? pick('image', tier).entry : m.entry;
  return e ? e.refs : /pro/.test(m.model) ? 8 : 10;
}
// the people in a scene: cast named in it; when it names none but shows a person, the ones picked for the Reel
const PERSON = /\b(she|he|her|his|woman|man|girl|boy|lady|mother|father|mom|dad|wife|husband|person|people|customer|friend|family|couple|bride|groom|aunty|uncle|student|chef|model)\b/i;
export function inScene(userId, text, picked = []) {
  const all = castOf(userId).filter((c) => refsOf(c).length || c.look);
  const by = all.filter((c) => named(c, text));
  return by.length ? by : PERSON.test(String(text || '')) ? resolveCast(userId, picked) : [];
}
// a Reel's still → { prompt, ref, refs }: the product photo (or the opening still for a closing one) as `ref`, then each
// person's pictures in turn — every person's best first — so the total stays within the model's limit
export function castShot(r, scene, { prompt = scene, primary } = {}) {
  const kit = brandKit(r.userId);
  const ref = primary !== undefined ? primary : r.ref || kit.products[0] || null;
  const people = inScene(r.userId, scene, r.cast);
  const room = Math.max(0, imageRefLimit(r.tier, r.imodel) - (ref ? 1 : 0));
  const lists = people.map((c) => refsOf(c).slice(0, PER_PERSON)), refs = [], whose = [];
  for (let k = 0; k < PER_PERSON && refs.length < room; k++) lists.forEach((l, i) => { if (l[k] && refs.length < room && !refs.includes(l[k])) { refs.push(l[k]); whose.push(people[i].name); } });
  let p = withCharacters(r.userId, prompt);
  // their look in words too (named or picked), and which reference picture is whom
  const looks = people.filter((c) => !p.includes(c.look)).map((c) => `${c.name}: ${c.look}${c.outfit ? `, wearing ${c.outfit}` : ''}`);
  if (looks.length) p = `${p}\n${looks.join('\n')}`;
  if (refs.length) {
    const at = (n) => n + (ref ? 2 : 1), parts = ref ? [`picture 1 is ${primary !== undefined ? 'the opening of this shot' : 'the product'}`] : [];
    for (const c of people) { const idx = whose.map((w, i) => (w === c.name ? at(i) : 0)).filter(Boolean); if (idx.length) parts.push(`${idx.length > 1 ? `pictures ${idx.join(', ')} are` : `picture ${idx[0]} is`} ${c.name}`); }
    p = `${p}\nReference pictures: ${parts.join('; ')}.`;
  }
  return { prompt: p.slice(0, 1500), ref, ...(refs.length ? { refs } : {}) };
}

// a clip made from words alone (no first frame) with the people picked: their pictures, each person's best first (the
// video model's own limit is applied in models.js clipInput; with a first frame there are none — the still carries them)
export function clipRefs(userId, picked) {
  const lists = resolveCast(userId, picked).map((c) => refsOf(c).slice(0, PER_PERSON)), out = [];
  for (let k = 0; k < PER_PERSON; k++) for (const l of lists) if (l[k] && !out.includes(l[k])) out.push(l[k]);
  return out;
}

if (JOBS && process.env.NODE_ENV !== 'test') setInterval(() => { try { advanceSheets(); } catch (e) { console.error('cast sheets failed', e.message); } }, 7000).unref();
