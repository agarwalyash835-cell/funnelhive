// Hive tools for Studio (studio/): images and short clips made with AI, checked for quality and saved to the seller's
// media. Renders take a minute or more, so the tools queue the work and Hive reports back with studio_status. Tiers
// only (Quick / Standard / Cinematic) — never a vendor or model name. A clip waits for the seller's OK: it's the
// expensive kind. Every render costs credits: the seller's OK (OK below) says how many, a shot that fails its quality
// check is never redone on its own, and clips can be made at a lower resolution (fewer credits, sharpened to 720p).
import { T } from './db.js';
import { imageCost, clipCost, clipRes, reelCost } from './studio/models.js';
const S = (props, required = []) => ({ type: 'object', properties: props, required, additionalProperties: false });
const str = (description) => ({ type: 'string', description });
const num = (description) => ({ type: 'number', description });
const TIER = str('quick (fast drafts) | standard (default) | cinematic (best quality, slowest)');
const RES = str('Clip resolution: 480p (fewer credits, sharpened up to 720p) or 720p (default) — Quick and Standard only. Tell the seller what each costs and let them choose');
const brief = (a) => ({ id: a.id, kind: a.kind, status: a.status, tier: a.tier, url: a.url, poster: a.poster, issues: a.issues, ...(a.redoCredits ? { redoCredits: a.redoCredits, fix: a.fix || '' } : {}), ...(a.cost ? { cost: a.cost } : {}), prompt: a.prompt.slice(0, 120), ...(a.kind === 'reel' ? { title: a.title, links: a.links, shots: a.shots?.map((s) => s.clip?.status || s.image?.status || 'queued'), lines: a.lines?.map((l) => (l.url ? (l.check && !l.check.ok ? 'needs a look' : 'done') : 'pending')) } : {}) });

export const TOOLS = [
  {
    name: 'studio_make_images',
    description: 'Make 1–4 images in Studio: product shots, scenes, ad creatives. Write a detailed visual prompt (subject, setting, light, mood, camera). To keep the seller’s real product exactly as it is, pass productPhoto: the URL of their own uploaded photo. Each image is checked for quality (same product, no garbled text, no warped hands); one that fails is kept with the reasons and is only redone if the seller asks (a redo costs credits). Takes about a minute: say so, then use studio_status.',
    schema: S({ prompt: str('Detailed description of the image'), tier: TIER, aspect: str('9:16 | 1:1 | 16:9 | 4:5 | 3:4'), count: num('How many versions, 1–4 (default 1)'), productPhoto: str('Optional: URL of the seller’s own product photo (/uploads/…)') }, ['prompt']),
    run: async (ctx, a) => {
      const r = await ctx.call('POST', '/studio/images', { prompt: a.prompt, tier: a.tier, aspect: a.aspect || '1:1', count: a.count || 1, ...(a.productPhoto ? { ref: a.productPhoto } : {}) });
      return { ok: true, queued: r.assets.map(brief), note: 'Rendering — usually under a minute. Results appear in Studio.' };
    },
    summary: (r) => `Started ${r.queued.length} image${r.queued.length === 1 ? '' : 's'} in Studio`,
  },
  {
    name: 'studio_make_clip',
    description: 'Make a short video clip (4–15 seconds) in Studio, best from an image (fromImageId: a ready Studio image, used as the first frame) so the product stays the same. Describe the motion: camera move, what happens, mood. Clips are silent (voiceover and music come later). Each clip is checked (same product start to end, no freezes or glitches); one that fails is kept with the reasons and only redone if the seller asks. 480p renders are sharpened to 720p. Takes a few minutes.',
    schema: S({ prompt: str('What happens in the clip: motion, camera, mood'), fromImageId: str('Optional: a ready Studio image id to start from'), tier: TIER, res: RES, aspect: str('9:16 (Reels, default) | 1:1 | 16:9'), seconds: num('4–15, default 5') }, ['prompt']),
    run: async (ctx, a) => {
      const r = await ctx.call('POST', '/studio/clips', { prompt: a.prompt, tier: a.tier, res: a.res, aspect: a.aspect || '9:16', seconds: a.seconds || 5, ...(a.fromImageId ? { sourceId: a.fromImageId } : {}) });
      return { ok: true, queued: brief(r.asset), note: 'Rendering — usually a few minutes. It appears in Studio when ready.' };
    },
    summary: () => 'Started a clip in Studio',
  },
  {
    name: 'studio_status',
    description: 'What’s in Studio: the latest images and clips with their status (queued, rendering, checking, ready, needs_review with the reasons, failed) and links.',
    schema: S({ ids: { type: 'array', items: { type: 'string' }, description: 'Optional: only these ids' } }),
    run: async (ctx, a) => {
      const d = await ctx.call('GET', '/studio');
      const list = (a.ids?.length ? d.assets.filter((x) => a.ids.includes(x.id)) : d.assets.slice(0, 12)).map(brief);
      return { on: d.on, items: list };
    },
    summary: (r) => `Checked Studio (${r.items.length} item${r.items.length === 1 ? '' : 's'})`,
  },
  {
    name: 'studio_redo',
    description: 'Make a Studio image or clip again, with what to change (e.g. "brighter", "keep the label facing the camera"). It costs credits (redoCredits in studio_status): only when the seller asks; with no note, the quality check\x27s own fix is used.',
    schema: S({ id: str('The Studio item id'), note: str('What to change') }, ['id']),
    run: async (ctx, a) => ({ ok: true, item: brief(await ctx.call('POST', `/studio/assets/${encodeURIComponent(a.id)}/redo`, { note: a.note || '' })) }),
    summary: () => 'Asked Studio to redo it',
  },
  // ---------- Reels: brief → script (cheap, shown to the seller) → approve → shots + voiceover + edit ----------
  {
    name: 'studio_make_reel',
    description: 'Start a finished vertical ad video (Reel / Short) from a brief: Studio writes the script first — hook, voiceover lines, one shot per line, a closing offer card — and nothing is rendered yet. Show the seller the script (lines and shots), offer changes, then call studio_approve_reel. Ask for the product, the audience and the offer if the brief lacks them. Pass productPhoto (their own uploaded photo) so the real product appears in the shots.',
    schema: S({ brief: str('What to advertise: product, who it’s for, the offer, the mood'), lang: str('Voiceover language code: en, hi, mr, gu, bn, ta, te, kn, ml, pa, or, ur (default en)'), seconds: num('15, 30 or 45 (default 30)'), tier: TIER, voice: str('female | male'), captions: str('pop | lower | karaoke | minimal (default pop)'), sizes: { type: 'array', items: { type: 'string' }, description: 'Any of 9:16, 1:1, 16:9, 4:5 (default 9:16)' }, productPhoto: str('Optional: URL of their own product photo (/uploads/…)'), logo: str('Optional: URL of their logo (/uploads/…)') }, ['brief']),
    run: async (ctx, a) => {
      const r = await ctx.call('POST', '/studio/reels', { brief: a.brief, lang: a.lang || 'en', seconds: a.seconds || 30, tier: a.tier, voice: a.voice, captions: a.captions, sizes: a.sizes, ...(a.productPhoto ? { ref: a.productPhoto } : {}), ...(a.logo ? { logo: a.logo } : {}) });
      return { ok: true, id: r.id, status: r.status, script: r.script, cost: r.cost, note: 'Nothing is rendered yet. Show this script to the seller with what it costs (cost.byRes: credits at each resolution) and let them pick the resolution, then approve it (with their changes) via studio_approve_reel.' };
    },
    summary: (r) => `Wrote a Reel script (${r.script.lines.length} lines, ${r.script.shots.length} shots)`,
  },
  {
    name: 'studio_approve_reel',
    description: 'Make the Reel from its script (optionally the seller’s edited script: { title, lines: [..], shots: [{ image, motion, seconds }], endCard: { headline, offer, cta } }). Shots and voiceover are made and quality-checked, then edited together with captions — this takes several minutes; say so and check with studio_status. motion "photo" animates each still with a zoom or pan instead of making AI clips: far fewer credits (stills and voice only), for tight budgets.',
    schema: S({ id: str('The Reel id'), script: { type: 'object', description: 'Optional: the edited script' }, res: RES, motion: { type: 'string', enum: ['video', 'photo'], description: 'video (AI clips, default) | photo (stills with a zoom or pan, far cheaper)' } }, ['id']),
    run: async (ctx, a) => ({ ok: true, reel: brief(await ctx.call('POST', `/studio/reels/${encodeURIComponent(a.id)}/approve`, { ...(a.script ? { script: a.script } : {}), ...(a.res ? { res: a.res } : {}), ...(a.motion ? { motion: a.motion } : {}) })) }),
    summary: () => 'Started making the Reel',
  },
  {
    name: 'studio_edit_reel',
    description: 'Change a finished Reel: caption style or colour ({ captions: { style, colour: "#rrggbb" } }), sizes, reword voiceover lines ({ lines: [{ i, text }] }, 0-based), redo shots with a note ({ shots: [{ i, note }] }), or the closing card ({ endCard: { headline, offer, cta } }). Only what changed is redone. A finished Reel’s links (per size) are in studio_status — use those to upload it to an ad with the ads tools once the seller agrees.',
    schema: S({ id: str('The Reel id'), captions: { type: 'object', description: '{ style, colour }' }, sizes: { type: 'array', items: { type: 'string' } }, lines: { type: 'array', items: { type: 'object' } }, shots: { type: 'array', items: { type: 'object' } }, endCard: { type: 'object' } }, ['id']),
    run: async (ctx, a) => { const { id, ...b } = a; return { ok: true, reel: brief(await ctx.call('PUT', `/studio/reels/${encodeURIComponent(id)}`, b)) }; },
    summary: () => 'Changed the Reel',
  },
];

// clips and Reels are the costly renders: the seller confirms
const TIER_NAME = (t) => ({ quick: 'Quick', cinematic: 'Cinematic' })[t] || 'Standard';
const secs = (a) => Math.min(15, Math.max(4, Math.round(a.seconds || 5)));
export const OK = {
  studio_make_images: (a) => { const n = Math.min(4, Math.max(1, Math.round(a.count || 1))); return `Make ${n} ${TIER_NAME(a.tier)} image${n === 1 ? '' : 's'} in Studio — about ${n * imageCost(a.tier)} credits`; },
  studio_make_clip: (a) => `Make a ${secs(a)}-second ${TIER_NAME(a.tier)} video clip at ${clipRes(a.tier, a.res)} in Studio — about ${clipCost(a.tier, secs(a), a.res)} credits`,
  studio_redo: (a) => { const x = T.studio.get(String(a.id || '')); const c = x?.kind === 'image' ? imageCost(x.tier) : x?.kind === 'clip' ? clipCost(x.tier, x.seconds, x.res) : null; return `Make it again in Studio${c ? ` — about ${c} credits` : ''}`; },
  studio_approve_reel: (a) => { const r = T.studio.get(String(a.id || '')), sc = a.script || r?.script; const c = r && sc ? reelCost({ tier: r.tier, seconds: r.seconds, shots: sc.shots?.length || 4, lines: sc.lines?.length || 4, res: a.res || r.res, motion: a.motion || r.motion }) : null; return `Make this Reel: its shots, voiceover and edit${c ? ` ${c.motion === 'photo' ? 'as stills with photo motion' : `at ${c.res}`} — about ${c.credits} credits` : ''}`; },
  studio_edit_reel: (a) => { if (!a.shots?.length) return null; const r = T.studio.get(String(a.id || '')); const c = (a.shots || []).reduce((t, { i }) => { const x = r?.shots?.[i] && T.studio.get(r.shots[i].clipId); return t + (x ? clipCost(x.tier, x.seconds, x.res) : 0); }, 0); return `Redo ${a.shots.length} shot${a.shots.length === 1 ? '' : 's'} of the Reel and edit it again${c ? ` — about ${c} credits` : ''}`; },
};
