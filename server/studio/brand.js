// Brand kits: one place for a brand's look in Studio — the name, logo, colours, font, lettering, look book, tone, product
// photos, the closing card's call to action and a legal line. (It replaces the brand block that lived in memory.js and the
// separate font / tone / products row of cast.js; both read and write through here now.)
//   - An account has one or more kits; one is the default. An agency (or a seller with several brands) keeps a kit per
//     client or brand, and each Reel and design is made with one (`kitId`; the default when none).
//   - Locked elements: logo, colours, font, call to action, legal line. A locked element is used exactly as the kit has
//     it in every Reel and design, and nothing else can change it — not the director (chat), not a team member, not an
//     edit. Locks are set and lifted only by the account's owner, or by its agency while working in the account; a lock
//     the agency set can be lifted only by the agency (the client sees it, but can't undo it).
// Kits are rows of kind 'kit' in `studiocast`. The first read of an account with none makes its default kit from what
// memory.js and cast.js held before.
import { T, uid } from '../db.js';
import { cleanLook } from './cinema.js';

// the fonts the editor can draw with (the server image bundles the Noto family, Devanagari included) — Google Fonts, so
// the page can show them as they'll look. Latin-only ones fall back to Noto Sans Devanagari for Hindi or Marathi.
export const BRAND_FONTS = {
  'noto-sans': { name: 'Noto Sans', family: 'Noto Sans', devanagari: false, note: 'Clean and modern' },
  'noto-serif': { name: 'Noto Serif', family: 'Noto Serif', devanagari: false, note: 'Classic, premium' },
  'noto-sans-devanagari': { name: 'Noto Sans Devanagari', family: 'Noto Sans Devanagari', devanagari: true, note: 'Hindi and Marathi, clean' },
  'noto-serif-devanagari': { name: 'Noto Serif Devanagari', family: 'Noto Serif Devanagari', devanagari: true, note: 'Hindi and Marathi, classic' },
};
// the lettering style of designs (designs.js): sans (clean), serif (classic), display (heavy)
export const LETTERING = ['sans', 'serif', 'display'];
export const LOCKABLE = { logo: 'logo', colours: 'brand colours', font: 'font', cta: 'call to action', legal: 'legal line' };
export const MAX_KITS = 25;
const MAX_PRODUCTS = 6, MAX_COLOURS = 3;

const clip = (v, n) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const hex = (v) => (/^#[0-9a-f]{6}$/i.test(String(v || '')) ? String(v).toLowerCase() : '');
const own = (userId, url) => (/\/uploads\/([\w-]+)\/[\w.-]+\.(png|jpe?g|webp)$/i.exec(String(url || ''))?.[1] === userId);

// who is asking — what they may do with locks:
//   'owner'  the account's owner (also locks and unlocks their own locks)
//   'agency' its agency working in the account (locks and unlocks any lock; its own can't be lifted by the client)
//   'member' a team member · 'hive' the director (chat) · 'key' an API key · 'system' Studio learning on its own
// — none of these last four can lock, unlock or change a locked element
export const whoOf = (req) => (req.headers?.['x-hive'] ? 'hive' : req.apiKey ? 'key' : req.agencyAccess ? 'agency' : req.actor || req.impersonator ? 'member' : 'owner');
const canLock = (who, holder = null) => (who === 'agency' ? true : who === 'owner' ? holder !== 'agency' : false);

// ---------- reading ----------
const rowsOf = (userId) => T.studiocast.all({ userId }, { order: 'at' }).filter((k) => k.kind === 'kit');
// the first look at an account with no kits: its default kit from the old brand block (memory.js) and brand row (cast.js)
function migrate(userId) {
  const m = T.studiomem.get(userId)?.brand || {}, b = T.studiocast.get(`brand-${userId}`) || {};
  return T.studiocast.put({ // put: two first reads at once make the same row, not an error
    id: `kit-${userId}`, userId, kind: 'kit', label: '', isDefault: true,
    name: clip(m.name, 80), logo: m.logo || '', colours: (m.colours || []).map(hex).filter(Boolean).slice(0, MAX_COLOURS),
    font: BRAND_FONTS[b.font] ? b.font : 'noto-sans', lettering: LETTERING.includes(m.font) ? m.font : null, look: cleanLook(m.look) || null,
    tone: clip(b.tone, 200), products: (b.products || []).slice(0, MAX_PRODUCTS), cta: '', legal: '', locks: {}, at: Date.now(),
  });
}
export function kitsOf(userId) {
  const rows = rowsOf(userId);
  const list = rows.length ? rows : [migrate(userId)];
  if (!list.some((k) => k.isDefault)) list[0] = T.studiocast.update(list[0].id, (x) => { x.isDefault = true; });
  return list.sort((a, b) => Number(!!b.isDefault) - Number(!!a.isDefault) || a.at - b.at);
}
export const defaultKit = (userId) => kitsOf(userId)[0];
// a kit of this account by id; the default for none or one that isn't theirs
export function kitOf(userId, kitId = null) {
  const all = kitsOf(userId);
  return (kitId && all.find((k) => k.id === kitId)) || all[0];
}
export const ownKit = (userId, kitId) => !kitId || kitsOf(userId).some((k) => k.id === kitId);
export const fontFamily = (k) => (BRAND_FONTS[k?.font] || BRAND_FONTS['noto-sans']).family;
export const locked = (k, field) => !!k?.locks?.[field];
// a kit as the seller (and every Studio module) sees it
export function kitView(k) {
  return {
    id: k.id, label: k.label || k.name || 'Brand kit', isDefault: !!k.isDefault, name: k.name || '', logo: k.logo || '', colours: k.colours || [],
    font: BRAND_FONTS[k.font] ? k.font : 'noto-sans', fontFamily: fontFamily(k), lettering: k.lettering || null, look: k.look || null, tone: k.tone || '',
    products: k.products || [], cta: k.cta || '', legal: k.legal || '',
    locks: Object.fromEntries(Object.keys(LOCKABLE).map((f) => [f, k.locks?.[f] || null])),
  };
}

// ---------- changing ----------
// b: { label, name, logo, colours, font, lettering, look, tone, products, cta, legal, locks: { field: true|false } }
// → { kit } | { error }. who: whoOf(req). A 'system' change (learning) skips locked elements quietly; anyone else is told.
export function patchKit(userId, kitId, b = {}, who = 'owner') {
  const k = kitOf(userId, kitId);
  if (kitId && k.id !== kitId) return { error: 'That brand kit isn’t yours' };
  const next = {}, refuse = [];
  // the locks first: who may set or lift each one
  const locks = { ...(k.locks || {}) };
  for (const [f, on] of Object.entries(b.locks && typeof b.locks === 'object' ? b.locks : {})) {
    if (!LOCKABLE[f] || !!locks[f] === !!on) continue;
    if (!canLock(who, locks[f])) return { error: locks[f] === 'agency' ? `Your agency locked the ${LOCKABLE[f]} — only they can unlock it` : who === 'hive' ? 'Locks are set in the brand kit, not from the chat' : 'Only the account’s owner (or its agency) can lock or unlock brand elements' };
    if (on) locks[f] = who; else delete locks[f];
  }
  // a locked element changes only for someone who could lift its lock (the owner or the agency, in the kit itself)
  const guard = (f) => {
    if (!locks[f] || !k.locks?.[f]) return true;
    if (who !== 'system' && canLock(who, k.locks[f])) return true;
    if (who !== 'system') refuse.push(LOCKABLE[f]);
    return false;
  };
  if (b.label !== undefined) next.label = clip(b.label, 60);
  if (b.name !== undefined) next.name = clip(b.name, 80);
  if (b.logo !== undefined && guard('logo')) { if (b.logo && !own(userId, b.logo)) return { error: 'Pick your own logo' }; next.logo = b.logo || ''; }
  if (b.colours !== undefined && guard('colours')) next.colours = [...new Set([].concat(b.colours || []).map(hex).filter(Boolean))].slice(0, MAX_COLOURS);
  if (b.font !== undefined && guard('font')) { if (b.font && !BRAND_FONTS[b.font]) return { error: 'Pick one of the fonts offered' }; next.font = b.font || 'noto-sans'; }
  if (b.lettering !== undefined && guard('font')) next.lettering = LETTERING.includes(b.lettering) ? b.lettering : null;
  if (b.look !== undefined) next.look = cleanLook(b.look) || null;
  if (b.tone !== undefined) next.tone = clip(b.tone, 200);
  if (b.products !== undefined) { const p = [...new Set([].concat(b.products || []))]; if (p.some((u) => !own(userId, u))) return { error: 'Pick your own product photos' }; next.products = p.slice(0, MAX_PRODUCTS); }
  if (b.cta !== undefined && guard('cta')) next.cta = clip(b.cta, 30);
  if (b.legal !== undefined && guard('legal')) next.legal = clip(b.legal, 160);
  if (refuse.length) return { error: `The ${refuse.join(' and ')} ${refuse.length > 1 ? 'are' : 'is'} locked in the brand kit — unlock ${refuse.length > 1 ? 'them' : 'it'} there first`, locked: true };
  // locking an element that isn't set yet would lock in nothing
  for (const f of Object.keys(locks)) if (!k.locks?.[f]) { const v = f in next ? next[f] : k[f]; if (!v || (Array.isArray(v) && !v.length)) return { error: `Set the ${LOCKABLE[f]} before locking it` }; }
  return { kit: kitView(T.studiocast.update(k.id, (x) => { Object.assign(x, next); x.locks = locks; x.at = x.at || Date.now(); x.changedAt = Date.now(); })) };
}
// another kit (a client's or a brand's): { label, … } — it starts empty, or copies from: kitId
export function addKit(userId, b = {}, who = 'owner') {
  if (['hive', 'key'].includes(who)) return { error: 'Brand kits are added in the brand kit settings' };
  const all = kitsOf(userId);
  if (all.length >= MAX_KITS) return { error: `Up to ${MAX_KITS} brand kits — remove one first` };
  const from = b.from ? all.find((k) => k.id === b.from) : null;
  const base = from ? { ...from, locks: {} } : { name: '', logo: '', colours: [], font: 'noto-sans', lettering: null, look: null, tone: '', products: [], cta: '', legal: '', locks: {} };
  const { id: _i, isDefault: _d, at: _a, changedAt: _c, ...copy } = base;
  const k = T.studiocast.insert({ ...copy, id: `kit-${uid()}`, userId, kind: 'kit', label: clip(b.label, 60) || 'New brand kit', isDefault: false, at: Date.now() });
  const rest = { ...b }; delete rest.from; delete rest.label;
  return Object.keys(rest).length ? patchKit(userId, k.id, rest, who) : { kit: kitView(k) };
}
export function setDefaultKit(userId, kitId, who = 'owner') {
  if (!['owner', 'agency'].includes(who)) return { error: 'Only the account’s owner (or its agency) can change the default brand kit' };
  const all = kitsOf(userId);
  if (!all.some((k) => k.id === kitId)) return { error: 'That brand kit isn’t yours' };
  for (const k of all) if (!!k.isDefault !== (k.id === kitId)) T.studiocast.update(k.id, (x) => { x.isDefault = k.id === kitId; });
  return { kit: kitView(kitOf(userId, kitId)) };
}
export function dropKit(userId, kitId, who = 'owner') {
  if (!['owner', 'agency'].includes(who)) return { error: 'Only the account’s owner (or its agency) can remove a brand kit' };
  const k = kitsOf(userId).find((x) => x.id === kitId);
  if (!k) return { error: 'That brand kit isn’t yours' };
  if (k.isDefault) return { error: 'Make another kit the default first' };
  if (who !== 'agency' && Object.values(k.locks || {}).includes('agency')) return { error: 'Your agency locked parts of this kit — only they can remove it' };
  T.studiocast.del(k.id);
  return { ok: true };
}

// ---------- the locks, applied ----------
// what a Reel change may not do with this kit → the plain reason, or null. b: editReel's body (reels.js)
export function reelLockError(k, b = {}) {
  const out = [];
  if (locked(k, 'logo') && b.logo?.off === true) out.push('hide the logo');
  if (locked(k, 'colours')) {
    const ok = (c) => c === null || c === undefined || (k.colours || []).includes(String(c).toLowerCase());
    if (!ok(b.cardColour)) out.push('use a closing-card colour outside the brand colours');
    if (b.captions && !ok(b.captions.colour)) out.push('use a caption colour outside the brand colours');
  }
  if (locked(k, 'font') && b.captions?.font && b.captions.font !== fontFamily(k)) out.push('use another font');
  if (locked(k, 'cta') && b.endCard && b.endCard.cta !== undefined && clip(b.endCard.cta, 30) !== k.cta) out.push('change the call to action');
  return out.length ? `The brand kit locks this — it can’t ${out.join(', or ')}. Its owner can unlock it in the brand kit.` : null;
}
// a script as the kit says (the locked call to action), before it's saved or made
export const lockScript = (script, k) => (script && locked(k, 'cta') && k.cta ? { ...script, endCard: { ...(script.endCard || {}), cta: k.cta } } : script);
// a Reel's settings as the kit says, at the moment it's edited together (the safety net: whatever the row holds)
export function lockedReel(r, k) {
  const x = { ...r };
  if (locked(k, 'logo') && k.logo) { x.logo = k.logo; x.logoOpts = { ...(x.logoOpts || {}), off: false }; delete x.logoOpts.off; }
  if (locked(k, 'colours')) {
    if (x.cardColour && !(k.colours || []).includes(x.cardColour)) delete x.cardColour;
    if (x.captions?.colour && !(k.colours || []).includes(x.captions.colour)) { x.captions = { ...x.captions }; delete x.captions.colour; }
  }
  if (locked(k, 'font') && x.captions) x.captions = { ...x.captions, font: fontFamily(k) };
  x.script = lockScript(x.script, k);
  return x;
}
// a design as the kit says: { colours, family, brand: { name, logo }, slides (the cta field) } with the locked elements
export function lockedDesign(d, k, fieldsOf = () => []) {
  const x = { ...d };
  if (locked(k, 'colours') && k.colours?.length) x.colours = k.colours.slice(0, 2);
  if (locked(k, 'font') && k.lettering) x.family = k.lettering;
  if (locked(k, 'logo') && k.logo) x.brand = { ...(x.brand || {}), logo: k.logo };
  if (locked(k, 'cta') && k.cta) x.slides = (x.slides || []).map((s) => (fieldsOf(s.template).includes('cta') ? { ...s, text: { ...s.text, cta: k.cta } } : s));
  return x;
}
// what a design change may not do → the reason, or null. b: editDesign's body
export function designLockError(k, b = {}, slides = [], fieldsOf = () => []) {
  const out = [];
  // the kit's own values sent back (an editor sends the whole form) aren't a change
  const sameColours = (c) => JSON.stringify([].concat(c || []).map((x) => String(x).toLowerCase()).slice(0, 2)) === JSON.stringify((k.colours || []).slice(0, 2));
  if (locked(k, 'colours') && Array.isArray(b.colours) && !sameColours(b.colours)) out.push('change its colours');
  if (locked(k, 'font') && k.lettering && b.family !== undefined && b.family !== k.lettering) out.push('change its lettering');
  if (locked(k, 'cta') && [...(Array.isArray(b.slides) ? b.slides : []), ...(b.text ? [{ i: 0, text: b.text }] : [])].some((s) => s?.text?.cta !== undefined && clip(s.text.cta, 30) !== k.cta && fieldsOf(slides[s.i ?? 0]?.template).includes('cta'))) out.push('change the call to action');
  return out.length ? `The brand kit locks this — it can’t ${out.join(', or ')}. Its owner can unlock it in the brand kit.` : null;
}
