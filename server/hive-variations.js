// Hive tools for hook variations and the ad test (studio/variations.js): new openings for a finished Reel (free to
// write and check), made as their own Reels (only the new opening costs credits — the seller confirms), launched as a
// PAUSED Meta test (the seller confirms), then the results per variant, the winner, and more like the winner.
import { T } from './db.js';
const S = (props, required = []) => ({ type: 'object', properties: props, required, additionalProperties: false });
const str = (description) => ({ type: 'string', description });
const num = (description) => ({ type: 'number', description });
const ANGLES = { type: 'array', items: { type: 'string', enum: ['pain', 'benefit', 'proof', 'offer', 'curiosity'] }, description: 'Angles to try: pain | benefit | proof (social proof) | offer (offer first) | curiosity. Default: all five' };
const idea = (x) => ({ key: x.key, angle: x.angle, hook: x.hook, picture: x.image.slice(0, 160), ...(x.line2 ? { line2: x.line2 } : {}), scores: x.check ? { quality: x.check.quality, virality: x.check.virality, hook: x.check.hook, problem: x.check.problem } : null, credits: x.credits, ...(x.made ? { made: x.made } : {}) });

export const TOOLS = [
  {
    name: 'studio_variations',
    description: 'Hook variations of a finished Reel, the way agencies test 5–10 openings per concept: new first lines and first pictures (optionally the first two scenes) in different angles, each scored for quality, virality and hook strength, with the credits each would cost (only its new opening is made — every other scene, line and the music are reused). Free: nothing is made. fromWinner: true writes new ones in the angle that won in ads (after studio_variant_results found a winner). Show them to the seller; make the ones they pick with studio_make_variations.',
    schema: S({ id: str('The Reel id'), angles: ANGLES, count: num('How many, 1–6 (default 5)'), scenes: num('1 (default: the first scene) or 2 (the first two)'), fromWinner: { type: 'boolean', description: 'Write more like the ad winner' } }, ['id']),
    run: async (ctx, a) => { const r = await ctx.call('POST', `/studio/reels/${encodeURIComponent(a.id)}/variations/ideas`, { angles: a.angles, count: a.count || 5, scenes: a.scenes, fromWinner: !!a.fromWinner }); return { ok: true, from: r.from, ideas: r.ideas.items.map(idea), note: 'Nothing is made yet. Show each hook with its scores and credits; studio_make_variations with the keys the seller picks (use id = from).' }; },
    summary: (r) => `Wrote ${r.ideas.length} new opening${r.ideas.length === 1 ? '' : 's'}`,
  },
  {
    name: 'studio_make_variations',
    description: 'Make the picked hook variations (keys from studio_variations) as their own Reels: only each new opening is rendered, everything else is reused. Takes a few minutes; check with studio_status. Costs credits — only once the seller agrees.',
    schema: S({ id: str('The Reel the ideas were written from (from)'), keys: { type: 'array', items: { type: 'string' }, description: 'The idea keys to make' } }, ['id', 'keys']),
    run: async (ctx, a) => { const r = await ctx.call('POST', `/studio/reels/${encodeURIComponent(a.id)}/variations`, { keys: a.keys }); return { ok: true, credits: r.credits, variants: r.variants.map((v) => ({ id: v.id, title: v.title, status: v.status, angle: v.variant?.angle, hook: v.variant?.hook })) }; },
    summary: (r) => `Making ${r.variants.length} variation${r.variants.length === 1 ? '' : 's'}`,
  },
  {
    name: 'studio_launch_variants',
    description: 'Test a Reel and its finished variations as Meta ads: one PAUSED campaign and ad set, one ad per version named FH-<id> with the tracking URL parameters, so the results come back to each Reel. Nothing spends until the seller switches it on in Ads Manager. When Meta isn’t connected, or the connection can’t upload video, it returns the plan to set up by hand (plan.steps, ad names, urlParams) — walk the seller through it. planOnly: just the plan.',
    schema: S({ id: str('The Reel id (the original or any variation)'), link: str('The page the ads send people to (https://…)'), dailyBudget: num('Daily budget in rupees for the ad set (default 500)'), pageId: str('Optional: the Facebook Page id the ads run from'), ids: { type: 'array', items: { type: 'string' }, description: 'Optional: only these versions' }, planOnly: { type: 'boolean', description: 'Only the plan, nothing created' } }, ['id']),
    run: async (ctx, a) => { const { id, ...b } = a; return ctx.call('POST', `/studio/reels/${encodeURIComponent(id)}/launch`, b); },
    summary: (r) => (r.launched ? `Created a paused test with ${r.created.ads.length} ads` : 'Prepared the ad test plan'),
  },
  {
    name: 'studio_variant_results',
    description: 'How each version of a Reel did as an ad: spend, impressions, hook rate, CTR, cost per lead, ROAS — and the winner once there’s enough data (each needs a minimum spend and impressions; the win must be clear). A winner is remembered for future scripts; clear losers are remembered to avoid. Then offer studio_variations with fromWinner.',
    schema: S({ id: str('The Reel id'), days: num('Days to look back (default 30)') }, ['id']),
    run: async (ctx, a) => ctx.call('GET', `/studio/reels/${encodeURIComponent(a.id)}/results${a.days ? `?days=${Number(a.days)}` : ''}`),
    summary: (r) => (r.decided ? 'Found the winning hook' : 'Checked the variants’ results'),
  },
];

export const OK = {
  studio_make_variations: (a) => { const r = T.studio.get(String(a.id || '')); const n = (a.keys || []).length; const c = r?.variantIdeas ? r.variantIdeas.items.filter((x) => (a.keys || []).includes(x.key)).reduce((t, x) => t + (x.credits || 0), 0) : 0; return `Make ${n} hook variation${n === 1 ? '' : 's'} of the Reel (only each new opening is made)${c ? ` — about ${c} credits` : ''}`; },
  studio_launch_variants: (a) => (a.planOnly ? null : `Create a PAUSED Meta test campaign with one ad per version${a.dailyBudget ? ` (₹${Math.round(a.dailyBudget)} a day once you switch it on)` : ''} — nothing spends until you turn it on in Ads Manager`),
};
