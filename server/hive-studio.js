// Hive tools for Studio (studio/): images and short clips made with AI, checked for quality and saved to the seller's
// media. Renders take a minute or more, so the tools queue the work and Hive reports back with studio_status. Tiers
// only (Quick / Standard / Cinematic) — never a vendor or model name. A clip waits for the seller's OK: it's the
// expensive kind.
const S = (props, required = []) => ({ type: 'object', properties: props, required, additionalProperties: false });
const str = (description) => ({ type: 'string', description });
const num = (description) => ({ type: 'number', description });
const TIER = str('quick (fast drafts) | standard (default) | cinematic (best quality, slowest)');
const brief = (a) => ({ id: a.id, kind: a.kind, status: a.status, tier: a.tier, url: a.url, poster: a.poster, issues: a.issues, prompt: a.prompt.slice(0, 120) });

export const TOOLS = [
  {
    name: 'studio_make_images',
    description: 'Make 1–4 images in Studio: product shots, scenes, ad creatives. Write a detailed visual prompt (subject, setting, light, mood, camera). To keep the seller’s real product exactly as it is, pass productPhoto: the URL of their own uploaded photo. Each image is checked for quality (same product, no garbled text, no warped hands) and redone automatically if it fails. Takes about a minute: say so, then use studio_status.',
    schema: S({ prompt: str('Detailed description of the image'), tier: TIER, aspect: str('9:16 | 1:1 | 16:9 | 4:5 | 3:4'), count: num('How many versions, 1–4 (default 1)'), productPhoto: str('Optional: URL of the seller’s own product photo (/uploads/…)') }, ['prompt']),
    run: async (ctx, a) => {
      const r = await ctx.call('POST', '/studio/images', { prompt: a.prompt, tier: a.tier, aspect: a.aspect || '1:1', count: a.count || 1, ...(a.productPhoto ? { ref: a.productPhoto } : {}) });
      return { ok: true, queued: r.assets.map(brief), note: 'Rendering — usually under a minute. Results appear in Studio.' };
    },
    summary: (r) => `Started ${r.queued.length} image${r.queued.length === 1 ? '' : 's'} in Studio`,
  },
  {
    name: 'studio_make_clip',
    description: 'Make a short video clip (4–15 seconds) in Studio, best from an image (fromImageId: a ready Studio image, used as the first frame) so the product stays the same. Describe the motion: camera move, what happens, mood. Clips are silent (voiceover and music come later). Each clip is checked (same product start to end, no freezes or glitches) and redone if it fails; low-resolution renders are sharpened to 720p. Takes a few minutes.',
    schema: S({ prompt: str('What happens in the clip: motion, camera, mood'), fromImageId: str('Optional: a ready Studio image id to start from'), tier: TIER, aspect: str('9:16 (Reels, default) | 1:1 | 16:9'), seconds: num('4–15, default 5') }, ['prompt']),
    run: async (ctx, a) => {
      const r = await ctx.call('POST', '/studio/clips', { prompt: a.prompt, tier: a.tier, aspect: a.aspect || '9:16', seconds: a.seconds || 5, ...(a.fromImageId ? { sourceId: a.fromImageId } : {}) });
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
    description: 'Make a Studio image or clip again, with what to change (e.g. "brighter", "keep the label facing the camera").',
    schema: S({ id: str('The Studio item id'), note: str('What to change') }, ['id']),
    run: async (ctx, a) => ({ ok: true, item: brief(await ctx.call('POST', `/studio/assets/${encodeURIComponent(a.id)}/redo`, { note: a.note || '' })) }),
    summary: () => 'Asked Studio to redo it',
  },
];

// clips are the costly renders: the seller confirms
export const OK = {
  studio_make_clip: (a) => `Make a ${Math.min(15, Math.max(4, Math.round(a.seconds || 5)))}-second ${({ quick: 'Quick', cinematic: 'Cinematic' })[a.tier] || 'Standard'} video clip in Studio`,
};
