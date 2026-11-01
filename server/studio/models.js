// Studio's models: which kie.ai model sits behind each tier. Sellers only ever see the tier names (Quick, Standard,
// Cinematic) — never a vendor or model. The platform admin can move a tier to a newer model (platform().studio) without
// a code change; anything not set there uses these defaults. Each model family takes its input in its own shape
// (kie.ai docs, read 2026-11-01), so the builders below turn one request into the right `input`.
import { platform } from '../platform.js';

export const TIERS = ['quick', 'standard', 'cinematic'];
export const TIER_NAMES = { quick: 'Quick', standard: 'Standard', cinematic: 'Cinematic' };
export const ASPECTS = ['9:16', '1:1', '16:9', '4:5', '3:4'];

export const DEFAULTS = {
  // images: the same model at a higher resolution for the better tiers; product photos go in as references
  image: { quick: { model: 'nano-banana-2', resolution: '1K' }, standard: { model: 'nano-banana-2', resolution: '2K' }, cinematic: { model: 'nano-banana-2', resolution: '2K' } },
  // clips: rendered without sound (Studio adds its own voiceover and music)
  clip: { quick: { model: 'bytedance/seedance-2-mini', resolution: '480p' }, standard: { model: 'bytedance/seedance-2', resolution: '720p' }, cinematic: { model: 'bytedance/seedance-2-5', resolution: '1080p' } },
  // an AI upscaler, when the ffmpeg cleanup isn't enough (paid, optional)
  upscale: { model: 'topaz/video-upscale' },
  // the reviewer that looks at frames and clips (a Gemini model through kie.ai)
  review: { model: 'gemini-2.5-flash' },
};

// the settings in force: admin overrides on top of the defaults, kind → tier → { model, resolution }
export function studioModels() {
  const o = platform().studio?.models || {};
  const tierOf = (kind) => Object.fromEntries(TIERS.map((t) => [t, { ...DEFAULTS[kind][t], ...(o[kind]?.[t] || {}) }]));
  return { image: tierOf('image'), clip: tierOf('clip'), upscale: { ...DEFAULTS.upscale, ...(o.upscale || {}) }, review: { ...DEFAULTS.review, ...(o.review || {}) } };
}
export const pick = (kind, tier) => studioModels()[kind][TIERS.includes(tier) ? tier : 'standard'];

// ---------- request → each family's input ----------
const nearest = (n, allowed) => allowed.reduce((a, b) => (Math.abs(b - n) < Math.abs(a - n) ? b : a));

export function imageInput(model, { prompt, refs = [], aspect = '1:1', resolution = '1K' }) {
  if (/nano-banana-edit/.test(model)) return { prompt, image_urls: refs.slice(0, 10), aspect_ratio: aspect, output_format: 'png' };
  return { prompt, ...(refs.length ? { image_input: refs.slice(0, 10) } : {}), aspect_ratio: aspect, resolution, output_format: 'png' };
}

// → { input, seconds, resolution } — seconds and resolution as the model will actually render them (for the usage log)
export function clipInput(model, { prompt, image, aspect = '9:16', seconds = 5, resolution = '720p' }) {
  if (model.startsWith('bytedance/seedance')) {
    const max = /2-5/.test(model) ? 30 : 15, res = /mini|fast/.test(model) && !['480p', '720p'].includes(resolution) ? '720p' : resolution;
    const s = Math.min(max, Math.max(4, Math.round(seconds)));
    return { input: { prompt, ...(image ? { first_frame_url: image } : {}), resolution: res, aspect_ratio: aspect, duration: s, generate_audio: false }, seconds: s, resolution: res };
  }
  if (model.startsWith('kling-4')) {
    const s = Math.min(30, Math.max(3, Math.round(seconds))), res = resolution === '1080p' ? '1080p' : '720p';
    return { input: { prompt: image ? `@image_1 ${prompt}` : prompt, ...(image ? { image_urls: [image] } : {}), duration: s, resolution: res, aspect_ratio: ['16:9', '9:16', '1:1'].includes(aspect) ? aspect : '9:16' }, seconds: s, resolution: res };
  }
  if (model.startsWith('kling')) {
    const s = Math.min(15, Math.max(3, Math.round(seconds))), mode = resolution === '1080p' ? 'pro' : 'std';
    return { input: { prompt, ...(image ? { image_urls: [image] } : {}), duration: String(s), mode, sound: false, multi_shots: false, aspect_ratio: ['16:9', '9:16', '1:1'].includes(aspect) ? aspect : '9:16' }, seconds: s, resolution: mode === 'pro' ? '1080p' : '720p' };
  }
  if (model.startsWith('veo')) {
    const s = nearest(seconds, [4, 6, 8]), res = ['720p', '1080p', '4k'].includes(resolution) ? resolution : '720p';
    return { input: { model: 'veo3_fast', prompt, ...(image ? { image_urls: [image], generation_type: 'FIRST_AND_LAST_FRAMES_2_VIDEO' } : {}), aspect_ratio: ['16:9', '9:16'].includes(aspect) ? aspect : '9:16', resolution: res, duration: s }, seconds: s, resolution: res };
  }
  // an unknown family: the common shape, and the admin is warned in the log on failure
  return { input: { prompt, ...(image ? { image_url: image } : {}), aspect_ratio: aspect, duration: Math.round(seconds), resolution }, seconds: Math.round(seconds), resolution };
}
