// What a video should be made with, for what it's for: the seller says (or the brief shows) whether it's a quick
// social post, a paid ad, a sales video for a web page, a talking testimonial, a product demo or a cinematic brand
// film, and Studio recommends the tier, video and stills models, resolution, frame and style — with why, what it
// costs, and a cheaper and a more premium choice beside it. The seller can always change it; nothing is spent here.
import { reelCost, modelKey } from './models.js';

// each purpose → its recommended settings and the reason in plain words
export const PURPOSES = {
  social: {
    label: 'Social post (Reel / Short)', aspect: '9:16', seconds: 30,
    pick: { tier: 'standard', vmodel: 'seedance-2', imodel: 'nano-banana-2-1', res: '720p', motion: 'story' },
    why: 'Realistic people and steady story scenes at 720p look sharp on a phone; the storyline keeps one person through the story.',
    cheaper: { tier: 'quick', vmodel: 'grok-imagine', imodel: 'nano-banana-2-1', res: '480p', motion: 'video' },
    premium: { tier: 'standard', vmodel: 'veo-3-1-fast', imodel: 'gpt-image-2', res: '1080p', motion: 'story' },
  },
  ad: {
    label: 'Paid ad (Meta / YouTube)', aspect: '9:16', seconds: 15,
    pick: { tier: 'standard', vmodel: 'veo-3-1-fast', imodel: 'gpt-image-2', res: '1080p', motion: 'story' },
    why: 'Ads live or die in the first 2 seconds: cinematic movement and crisp 1080p product shots stop the scroll, and a short ad keeps the cost per version low for testing hooks.',
    cheaper: { tier: 'standard', vmodel: 'seedance-2', imodel: 'nano-banana-2-1', res: '480p', motion: 'story' },
    premium: { tier: 'cinematic', vmodel: 'veo-3-1', imodel: 'nano-banana-pro', res: '1080p', motion: 'story' },
  },
  vsl: {
    label: 'Sales video for a web page (VSL)', aspect: '16:9', seconds: 45,
    pick: { tier: 'standard', vmodel: 'seedance-2', imodel: 'nano-banana-2-1', res: '720p', motion: 'story' },
    why: 'A wide story that explains the offer: consistent people and clear scenes matter more than flashy effects, and the length keeps the cost per second in check.',
    cheaper: { tier: 'quick', vmodel: 'seedance-2-mini', imodel: 'nano-banana-2-1', res: '480p', motion: 'story' },
    premium: { tier: 'standard', vmodel: 'kling-4', imodel: 'gpt-image-2', res: '1080p', motion: 'story' },
  },
  testimonial: {
    label: 'Talking testimonial / founder / UGC', aspect: '9:16', seconds: 30, presenter: 'testimonial',
    pick: { tier: 'standard', vmodel: 'seedance-2', imodel: 'nano-banana-2-1', res: '720p', motion: 'video' },
    why: 'A real-looking person speaking to camera converts best; the talking scenes are lip-synced to the voiceover and the rest are short product cut-aways.',
    cheaper: { tier: 'quick', vmodel: 'seedance-2-mini', imodel: 'nano-banana-2-1', res: '480p', motion: 'photo' },
    premium: { tier: 'standard', vmodel: 'kling-4', imodel: 'seedream-5-pro', res: '1080p', motion: 'video' },
  },
  product: {
    label: 'Product showcase / demo', aspect: '9:16', seconds: 30,
    pick: { tier: 'standard', vmodel: 'kling-4', imodel: 'gpt-image-2', res: '720p', motion: 'video' },
    why: 'Natural, smooth movement around the product and photoreal stills that keep the packaging exact.',
    cheaper: { tier: 'standard', vmodel: 'seedance-2', imodel: 'nano-banana-2-1', res: '720p', motion: 'video' },
    premium: { tier: 'cinematic', vmodel: 'kling-4', imodel: 'nano-banana-pro', res: '1080p', motion: 'video' },
  },
  brand: {
    label: 'Cinematic brand film / launch', aspect: '16:9', seconds: 45,
    pick: { tier: 'cinematic', vmodel: 'veo-3-1', imodel: 'nano-banana-pro', res: '1080p', motion: 'story' },
    why: 'The top-quality look for a launch or a brand story: film-grade movement and light at 1080p.',
    cheaper: { tier: 'standard', vmodel: 'veo-3-1-fast', imodel: 'gpt-image-2', res: '1080p', motion: 'story' },
    premium: null, // already the top: Google's best video model at 1080p
  },
  draft: {
    label: 'Quick draft to try an idea', aspect: '9:16', seconds: 15,
    pick: { tier: 'quick', vmodel: 'seedance-2-mini', imodel: 'nano-banana-2-1', res: '480p', motion: 'photo' },
    why: 'The cheapest way to see the idea, the words and the pacing before paying for a finished video.',
    cheaper: null,
    premium: { tier: 'quick', vmodel: 'grok-imagine', imodel: 'nano-banana-2-1', res: '480p', motion: 'video' },
  },
};
export const PURPOSE_IDS = Object.keys(PURPOSES);

// a guess from the brief's words (free, no AI) — the seller confirms or changes it
export function guessPurpose(brief = '') {
  const t = String(brief).toLowerCase();
  if (/\b(testimonial|review video|customer says|ugc|founder|talking|speaks? to (the )?camera|spokes(person|man|woman))\b/.test(t)) return 'testimonial';
  if (/\b(vsl|video sales letter|sales video|landing page|website video|explainer)\b/.test(t)) return 'vsl';
  if (/\b(brand film|launch film|cinematic|premium film|brand story|tvc)\b/.test(t)) return 'brand';
  if (/\b(ad|ads|advert|campaign|meta|facebook ad|instagram ad|youtube ad|promo|performance)\b/.test(t)) return 'ad';
  if (/\b(demo|how it works|unboxing|showcase|product video|features?)\b/.test(t)) return 'product';
  if (/\b(draft|test idea|rough|quick try)\b/.test(t)) return 'draft';
  return 'social';
}

// → the recommendation with its cost, and the cheaper / premium choices with theirs
export function recommend({ brief, purpose, seconds, shots = 4, lines = 4 }) {
  const id = PURPOSES[purpose] ? purpose : guessPurpose(brief), p = PURPOSES[id];
  const secs = [15, 30, 45].includes(Number(seconds)) ? Number(seconds) : p.seconds;
  const priced = (s) => {
    if (!s) return null;
    const settings = { ...s, vmodel: modelKey('clip', s.tier, s.vmodel), imodel: modelKey('image', s.tier, s.imodel), aspect: p.aspect, seconds: secs, ...(p.presenter ? { presenter: p.presenter } : {}) };
    return { settings, credits: reelCost({ tier: s.tier, seconds: secs, shots, lines, res: s.res, motion: s.motion, vmodel: settings.vmodel, imodel: settings.imodel }).credits };
  };
  return { purpose: id, label: p.label, guessed: !PURPOSES[purpose], why: p.why, ...priced(p.pick), cheaper: priced(p.cheaper), premium: priced(p.premium), purposes: PURPOSE_IDS.map((k) => ({ id: k, label: PURPOSES[k].label })) };
}
