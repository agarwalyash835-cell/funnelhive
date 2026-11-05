// Hive tools for the seller's cast and brand kit (studio/cast.js): the same people and brand in every Studio video.
// Making a character's reference pictures costs credits, so it waits for the seller's OK, which states the price.
import { sheetCost, SHEET } from './studio/cast.js';
const S = (props, required = []) => ({ type: 'object', properties: props, required, additionalProperties: false });
const str = (description) => ({ type: 'string', description });
const list = (description) => ({ type: 'array', items: { type: 'string' }, description });
const person = (c) => ({ id: c.id, name: c.name, look: c.look, outfit: c.outfit, photos: c.photos.length, sheet: c.sheet.status, pictures: c.refs.length });

export const CAST_TOOLS = [
  {
    name: 'studio_cast',
    description: 'The seller’s cast (recurring people in their ads, each with a look, an outfit and reference pictures that keep their face the same in every scene and video) and their brand kit (name, logo, colours, font, tone, product photos).',
    schema: S({}),
    run: async (ctx) => { const d = await ctx.call('GET', '/studio/cast'); return { ok: true, cast: d.characters.map(person), brand: d.brand, fonts: d.fonts.map((f) => f.id), sheetCredits: d.sheet.credits }; },
    summary: (r) => `Checked the cast (${r.cast.length} ${r.cast.length === 1 ? 'person' : 'people'})`,
  },
  {
    name: 'studio_cast_add',
    description: 'Add a person to the seller’s cast: a short name, how they look (age, face, skin tone, hair, build) and their usual outfit, and optionally the seller’s own photos of them (/uploads/… URLs) — then their face is kept the same in every scene they appear in. Without photos, offer studio_cast_sheet to make their reference pictures.',
    schema: S({ name: str('Short name, e.g. Asha'), look: str('Age, face, skin tone, hair, build'), outfit: str('Optional: what they usually wear'), photos: list('Optional: up to 4 of the seller’s own photos of them') }, ['name']),
    run: async (ctx, a) => ({ ok: true, person: person(await ctx.call('POST', '/studio/cast', { name: a.name, look: a.look || '', outfit: a.outfit || '', ...(a.photos?.length ? { photos: a.photos } : {}) })) }),
    summary: (r) => `Added ${r.person.name} to the cast`,
  },
  {
    name: 'studio_cast_sheet',
    description: 'Make a cast member’s reference pictures in Studio: a front portrait, a three-quarter view and a full-body shot in their outfit (about a minute or two). Costs credits — only when the seller agrees. Check with studio_cast.',
    schema: S({ id: str('The person’s id or name'), tier: str('quick | standard (default) | cinematic') }, ['id']),
    run: async (ctx, a) => {
      const d = await ctx.call('GET', '/studio/cast'), c = d.characters.find((x) => x.id === a.id || x.name.toLowerCase() === String(a.id).toLowerCase());
      if (!c) throw new Error('There’s no one by that name in the cast');
      const e = await ctx.call('POST', `/studio/cast/${encodeURIComponent(c.id)}/sheet-estimate`, { tier: a.tier });
      return { ok: true, person: person(await ctx.call('POST', `/studio/cast/${encodeURIComponent(c.id)}/sheet`, { tier: e.tier, confirm: e.credits })), credits: e.credits, note: 'Making the front portrait first, then the other two from it — check with studio_cast in a minute or two.' };
    },
    summary: (r) => `Making ${r.person.name}’s reference pictures`,
  },
  {
    name: 'studio_brand_kits',
    description: 'The seller’s brand kits — one per brand or agency client — each with its name, logo, colours, font, lettering, tone, product photos, closing-card call to action and legal line, and what it LOCKS (locked elements are used exactly as the kit has them and can’t be changed from the chat or by an edit; only the account’s owner or its agency can unlock them, in the brand kit settings). Pass kitId to studio_make_reel or studio_make_design to make it for that brand.',
    schema: S({}),
    run: async (ctx) => { const d = await ctx.call('GET', '/studio/kits'); return { ok: true, kits: d.kits.map((k) => ({ id: k.id, label: k.label, default: k.isDefault, name: k.name, colours: k.colours, font: k.font, cta: k.cta, legal: k.legal, locked: Object.keys(k.locks).filter((f) => k.locks[f]) })) }; },
    summary: (r) => `Checked the brand kits (${r.kits.length})`,
  },
  {
    name: 'studio_brand_kit',
    description: 'Set a brand kit (kitId from studio_brand_kits; the default kit when left out), used in every Studio video and design made with it: business name, logo (/uploads/…), brand colours (#rrggbb), font (from studio_cast → fonts), lettering for designs (sans | serif | display), tone of voice, product photos (/uploads/…; the first is used when a Reel has no product photo), the closing card’s call to action, a legal line. Only what the seller said. A LOCKED element is refused — tell the seller it’s locked in the brand kit (the owner or agency can unlock it there); never try to unlock it.',
    schema: S({ kitId: str('Optional: which kit (default kit when left out)'), name: str('Optional'), logo: str('Optional'), colours: list('Optional: #rrggbb'), font: str('Optional: a font id'), lettering: str('Optional: sans | serif | display'), tone: str('Optional: e.g. warm, family, no hype'), products: list('Optional: product photo URLs'), cta: str('Optional: the closing card’s call to action, max 30 characters'), legal: str('Optional: a legal line, e.g. T&C apply') }),
    run: async (ctx, a) => { const { kitId, ...b } = a; const { fonts, ...kit } = await ctx.call('PUT', `/studio/brand${kitId ? `?kit=${encodeURIComponent(kitId)}` : ''}`, b); return { ok: true, brand: kit }; },
    summary: () => 'Updated the brand kit',
  },
  {
    name: 'studio_reel_cast',
    description: 'Pick who is in a Reel (names or ids from the cast) while its script waits for approval: their reference pictures go into every scene they appear in, so they look the same throughout.',
    schema: S({ id: str('The Reel id'), characters: list('Names or ids from the cast') }, ['id', 'characters']),
    run: async (ctx, a) => { const r = await ctx.call('PUT', `/studio/reels/${encodeURIComponent(a.id)}/cast`, { characters: a.characters }); return { ok: true, id: r.id, cast: r.cast }; },
    summary: (r) => `Cast ${r.cast.length} ${r.cast.length === 1 ? 'person' : 'people'} in the Reel`,
  },
];

export const CAST_OK = {
  // by name when Hive passed one (an id is never looked up here: the OK must not reveal anything)
  studio_cast_sheet: (a) => { const n = String(a.id || '').slice(0, 30), who = !n || /^[\w-]{12,}$/.test(n) ? 'their' : `${n}’s`; return `Make ${who} ${SHEET.length} reference pictures (front, three-quarter, full body) in Studio — about ${sheetCost(a.tier)} credits`; },
};
