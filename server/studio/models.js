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
  // voiceover: the voice is an id from VOICES. 'sarvam:…' voices are Sarvam's Bulbul (made for Indian languages, about a
  // second a line); the others are kie.ai's ElevenLabs (the model below), which fall back to Sarvam when kie.ai fails
  voice: { model: 'elevenlabs/text-to-speech-multilingual-v2', female: 'sarvam:priya', male: 'sarvam:aditya' },
  // the reviewer that looks at frames and clips: tried in order, the first that answers wins
  review: { model: 'gemini-3-8-flash-openai', fallback: 'gpt-6-sol' },
};

// voices a seller can pick, with a short sample each. Labels only — sellers never see the vendor. Sarvam's Indian
// voices first (they speak English and 10 Indian languages); then kie.ai's ElevenLabs ids (docs read 2026-11-01).
export const VOICES = [
  { id: 'sarvam:priya', name: 'Priya', note: 'Female · Indian · warm', gender: 'female' },
  { id: 'sarvam:shreya', name: 'Shreya', note: 'Female · Indian · bright', gender: 'female' },
  { id: 'sarvam:ritu', name: 'Ritu', note: 'Female · Indian · calm', gender: 'female' },
  { id: 'sarvam:kavya', name: 'Kavya', note: 'Female · Indian · youthful', gender: 'female' },
  { id: 'sarvam:aditya', name: 'Aditya', note: 'Male · Indian · confident', gender: 'male' },
  { id: 'sarvam:rahul', name: 'Rahul', note: 'Male · Indian · friendly', gender: 'male' },
  { id: 'sarvam:rohan', name: 'Rohan', note: 'Male · Indian · energetic', gender: 'male' },
  { id: 'sarvam:kabir', name: 'Kabir', note: 'Male · Indian · deep', gender: 'male' },
  { id: '2zRM7PkgwBPiau2jvVXc', name: 'Monika', note: 'Female · Indian · warm', gender: 'female' },
  { id: 'Sm1seazb4gs7RSlUVw7c', name: 'Anika', note: 'Female · Indian · bright', gender: 'female' },
  { id: 'P1bg08DkjqiVEzOn76yG', name: 'Viraj', note: 'Male · Indian · confident', gender: 'male' },
  { id: '1U02n4nD6AdIZ9CjF053', name: 'Viraj Smooth', note: 'Male · Indian · smooth', gender: 'male' },
  { id: 'qDuRKMlYmrm8trt5QyBn', name: 'Taksh', note: 'Male · Indian · energetic', gender: 'male' },
  { id: 'FGY2WhTYpPnrIDTdsKH5', name: 'Laura', note: 'Female · American · upbeat', gender: 'female' },
  { id: 'TC0Zp7WVFzhA8zpTlRqV', name: 'Aria', note: 'Female · American · expressive', gender: 'female' },
  { id: 'nPczCjzI2devNBz1zQrb', name: 'Brian', note: 'Male · American · deep', gender: 'male' },
  { id: 'TX3LPaxmHKxFdv7VOQHJ', name: 'Liam', note: 'Male · American · friendly', gender: 'male' },
];
// a sample to hear before choosing: kie.ai hosts ElevenLabs' own; Sarvam's are made once on our server (routes.js)
export const voiceSample = (id) => (id.startsWith('sarvam:') ? `/api/studio/voices/${id.slice(7)}/sample` : `https://static.aiquickdraw.com/elevenlabs/voice/${id}.mp3`);
// a seller's choice → a voice id: a listed id, else the default for 'female' / 'male'
export const voiceId = (choice) => (VOICES.some((v) => v.id === choice) ? choice : studioModels().voice[choice === 'male' ? 'male' : 'female']);
// the Sarvam voice to fall back on for any voice (same gender)
const SARVAM_FALLBACK = { female: 'sarvam:priya', male: 'sarvam:aditya' };
export const sarvamFor = (id) => (id?.startsWith('sarvam:') ? id : SARVAM_FALLBACK[VOICES.find((v) => v.id === id)?.gender === 'male' ? 'male' : 'female']);

// the settings in force: admin overrides on top of the defaults, kind → tier → { model, resolution }
export function studioModels() {
  const o = platform().studio?.models || {};
  const tierOf = (kind) => Object.fromEntries(TIERS.map((t) => [t, { ...DEFAULTS[kind][t], ...(o[kind]?.[t] || {}) }]));
  return { image: tierOf('image'), clip: tierOf('clip'), voice: { ...DEFAULTS.voice, ...(o.voice || {}) }, upscale: { ...DEFAULTS.upscale, ...(o.upscale || {}) }, review: { ...DEFAULTS.review, ...(o.review || {}) } };
}
// ---------- the model menu ----------
// Every video and image model a seller can pick in a tier, by the name they see (the provider behind them stays hidden).
// Prices are the provider's credits from its model pages (kie.ai, read 2026-11-03): per second, or per clip for the
// models that make fixed lengths; the platform admin can correct any of them in platform().studio.prices.
const perSec = (rates) => ({ rates, unit: 'second' });
const perClip = (rates) => ({ rates, unit: 'clip' });
export const VIDEO_MODELS = {
  'seedance-2-mini': { name: 'Seedance 2 Mini', model: 'bytedance/seedance-2-mini', res: ['480p', '720p'], secs: [4, 15], price: perSec({ '480p': 2.4, '720p': 5 }), note: 'Fast and light' },
  'seedance-2': { name: 'Seedance 2', model: 'bytedance/seedance-2', res: ['480p', '720p', '1080p'], secs: [4, 15], price: perSec({ '480p': 11.7, '720p': 24.8, '1080p': 50 }), note: 'Realistic people, steady shots' },
  'seedance-2-5': { name: 'Seedance 2.5', model: 'bytedance/seedance-2-5', res: ['480p', '720p', '1080p'], secs: [4, 30], price: perSec({ '480p': 28, '720p': 63, '1080p': 158 }), note: 'Longer, most controllable shots' },
  'veo-3-1-fast': { name: 'Google Veo 3.1 Fast', model: 'veo-3-1', variant: 'veo3_fast', res: ['720p', '1080p'], lengths: [4, 6, 8], aspects: ['16:9', '9:16'], price: perClip({ '720p': 60, '1080p': 65 }), note: 'Cinematic motion, quick' },
  'veo-3-1': { name: 'Google Veo 3.1', model: 'veo-3-1', variant: 'veo3', res: ['720p', '1080p'], lengths: [4, 6, 8], aspects: ['16:9', '9:16'], price: perClip({ '720p': 250, '1080p': 255 }), note: 'Top cinematic quality' },
  'kling-4': { name: 'Kling 4.0', model: 'kling-4.0/keyframe-to-video', res: ['720p', '1080p'], secs: [3, 30], price: perSec({ '720p': 28.5, '1080p': 42.5 }), note: 'Natural movement, long takes' },
  'grok-imagine': { name: 'Grok Imagine 1.5', model: 'grok-imagine-video-1-5-preview', res: ['480p', '720p'], secs: [1, 15], price: perSec({ '480p': 2.4, '720p': 8 }), note: 'Lively, great value' },
  'gemini-omni': { name: 'Gemini Omni', model: 'google/gemini-omni-flash-1-1', res: ['720p', '1080p'], lengths: [4, 6, 8, 10], aspects: ['16:9', '9:16'], price: perClip({ 4: 63, 6: 84, 8: 105, 10: 126 }), byLength: true, note: 'Strong story and consistency' },
  'wan-3': { name: 'Wan 3.0', model: 'wan/3-0-video', res: ['480p', '720p', '1080p'], secs: [2, 30], price: perSec({ '480p': 8, '720p': 16, '1080p': 32 }), note: 'Good all-rounder' },
};
export const IMAGE_MODELS = {
  'nano-banana-2': { name: 'Nano Banana 2', model: 'nano-banana-2', res: ['1K', '2K', '4K'], refs: 10, price: { '1K': 8, '2K': 12, '4K': 18 }, note: 'Keeps your product exact' },
  'nano-banana-2-1': { name: 'Nano Banana 2.1', model: 'nano-banana-2-1', res: ['1K', '2K', '4K'], refs: 10, price: { '1K': 4, '2K': 6, '4K': 9 }, note: 'Latest — keeps your product exact' },
  'nano-banana-pro': { name: 'Nano Banana Pro', model: 'nano-banana-pro', res: ['1K', '2K', '4K'], refs: 8, price: { '1K': 18, '2K': 18, '4K': 24 }, note: 'Sharpest detail and text' },
  'gpt-image-2': { name: 'GPT Image 2', model: 'gpt-image-2-text-to-image', edit: 'gpt-image-2-image-to-image', res: ['1K', '2K', '4K'], refs: 16, price: { '1K': 6, '2K': 10, '4K': 16 }, note: 'Photoreal, clean product shots' },
  'seedream-5-pro': { name: 'Seedream 5 Pro', model: 'seedream/5-pro-text-to-image', edit: 'seedream/5-pro-image-to-image', res: ['1K', '2K'], refs: 10, price: { '1K': 7, '2K': 14 }, note: 'Realistic portraits' },
  'ideogram-3': { name: 'Ideogram 3', model: 'ideogram/v3-text-to-image', res: ['1K', '2K'], refs: 0, price: { '1K': 7, '2K': 10 }, note: 'Best with words on the picture' },
  'flux-3': { name: 'Flux 3', model: 'flux-3/klein-text-to-image', res: ['1K', '2K', '4K'], refs: 0, price: { '1K': 1.6, '2K': 2.5, '4K': 6.5 }, note: 'Very fast drafts' },
};
// what each tier offers (the first is its default) and the resolutions it allows
export const TIER_MENU = {
  quick: { video: ['seedance-2-mini', 'grok-imagine', 'wan-3'], image: ['nano-banana-2-1', 'flux-3', 'ideogram-3'], clipRes: ['480p', '720p'], clipDefault: '480p', imageRes: '1K' },
  standard: { video: ['seedance-2', 'kling-4', 'veo-3-1-fast', 'gemini-omni', 'grok-imagine', 'wan-3'], image: ['nano-banana-2-1', 'gpt-image-2', 'seedream-5-pro', 'ideogram-3'], clipRes: ['480p', '720p', '1080p'], clipDefault: '720p', imageRes: '2K' },
  cinematic: { video: ['seedance-2-5', 'veo-3-1', 'kling-4', 'gemini-omni'], image: ['nano-banana-pro', 'gpt-image-2', 'seedream-5-pro', 'ideogram-3'], clipRes: ['720p', '1080p'], clipDefault: '1080p', imageRes: '2K' },
};
const tierOf = (tier) => (TIERS.includes(tier) ? tier : 'standard');
const CATALOG = { clip: VIDEO_MODELS, image: IMAGE_MODELS };
const menuKey = (kind) => (kind === 'clip' ? 'video' : 'image');
// the model key a request gets: the one asked for when the tier offers it, else the tier's default
export const modelKey = (kind, tier, key) => { const list = TIER_MENU[tierOf(tier)][menuKey(kind)]; return list.includes(key) ? key : list[0]; };
// → { key, name, model, resolution, entry }. The admin's own model for a tier (platform().studio.models) still wins
// for that tier's default.
export function pick(kind, tier, key) {
  const t = tierOf(tier), k = modelKey(kind, t, key), entry = CATALOG[kind][k];
  const o = platform().studio?.models?.[kind]?.[t];
  if (!key && o?.model && o.model !== entry.model) return { key: k, name: entry.name, model: o.model, resolution: o.resolution || (kind === 'clip' ? TIER_MENU[t].clipDefault : TIER_MENU[t].imageRes), entry: Object.values(CATALOG[kind]).find((e) => e.model === o.model) || null };
  return { key: k, name: entry.name, model: entry.model, resolution: kind === 'clip' ? clipRes(t, null, k) : imageRes(t, k), entry };
}
// the tier's menu as sellers see it (names, notes, what each costs)
export function tierMenu(tier) {
  const t = tierOf(tier), m = TIER_MENU[t];
  return {
    video: m.video.map((k) => ({ id: k, name: VIDEO_MODELS[k].name, note: VIDEO_MODELS[k].note, res: resOf(t, k), per5s: Object.fromEntries(resOf(t, k).map((r) => [r, clipCost(t, 5, r, k)])) })),
    image: m.image.map((k) => ({ id: k, name: IMAGE_MODELS[k].name, note: IMAGE_MODELS[k].note, product: IMAGE_MODELS[k].refs > 0, credits: imageCost(t, k) })),
  };
}

// ---------- what things cost, in credits ----------
// The seller is told this before anything is made (and before any redo), and picks the model and the clip resolution
// where the tier offers a choice.
export const PRICES = {
  voiceLine: 1, // a voiceover line (a few seconds of speech)
  music: 12, // a music bed for one video (the provider publishes no rate for it; a safe estimate)
};
const override = (kind, key) => platform().studio?.prices?.[kind]?.[key];
// the resolutions a model offers within the tier
const resOf = (tier, key) => { const e = VIDEO_MODELS[key], allow = TIER_MENU[tierOf(tier)].clipRes; const r = e.res.filter((x) => allow.includes(x)); return r.length ? r : [e.res.at(-1)]; };
export const CLIP_RES = Object.fromEntries(TIERS.map((t) => [t, TIER_MENU[t].clipRes]));
// a clip resolution the tier and model offer (the tier's own when none is asked for)
export const clipRes = (tier, res, key) => { const t = tierOf(tier), k = modelKey('clip', t, key), opts = resOf(t, k); return opts.includes(res) ? res : opts.includes(TIER_MENU[t].clipDefault) ? TIER_MENU[t].clipDefault : opts.at(-1); };
const imageRes = (tier, key) => { const r = TIER_MENU[tierOf(tier)].imageRes, e = IMAGE_MODELS[key]; return e.res.includes(r) ? r : e.res.at(-1); };
// how long a clip the model will really make for `seconds` (fixed-length models round up to the next length they offer)
export const clipLength = (key, seconds) => { const e = VIDEO_MODELS[key] || VIDEO_MODELS['seedance-2'], s = Math.max(1, Math.round(Number(seconds) || 5)); if (e.lengths) return e.lengths.find((l) => l >= s) ?? e.lengths.at(-1); return Math.min(e.secs[1], Math.max(e.secs[0], s)); };
export const imageCost = (tier, key) => { const t = tierOf(tier), k = modelKey('image', t, key), r = imageRes(t, k); return Math.ceil(override('image', k)?.[r] ?? IMAGE_MODELS[k].price[r]); };
export const clipCost = (tier, seconds, res, key) => {
  const t = tierOf(tier), k = modelKey('clip', t, key), e = VIDEO_MODELS[k], r = clipRes(t, res, k), len = clipLength(k, seconds);
  const rates = { ...e.price.rates, ...(override('clip', k) || {}) }, top = Math.max(...Object.values(rates));
  if (e.price.unit === 'clip') return Math.ceil(e.byLength ? rates[len] ?? top : rates[r] ?? top);
  return Math.ceil((rates[r] ?? top) * len);
};
// a Reel: a still (two in a storyline) and a clip per shot (the clips together run about as long as the video, less
// the closing card), the voiceover and the music
// motion 'video': a still per shot, then an AI clip from it · 'story': an opening AND a closing still per shot (the
// closing one made from the opening one), and the clip moves between them — a told story, two stills a shot · 'photo':
// each still is animated by the editor (a zoom or pan, free) instead of an AI clip: stills and voice only.
export const MOTIONS = ['video', 'story', 'photo'];
export const musicCost = () => Math.ceil(platform().studio?.prices?.music ?? PRICES.music);
export function reelCost({ tier, seconds = 30, shots = 4, lines = 4, res, motion = 'video', vmodel, imodel }) {
  const t = tierOf(tier), v = modelKey('clip', t, vmodel), im = modelKey('image', t, imodel);
  const clipSecs = Math.max(4 * shots, Math.round((Number(seconds) || 30) - 2.5)), perShot = clipSecs / Math.max(1, shots);
  const base = shots * imageCost(t, im) + Math.ceil(lines * PRICES.voiceLine) + musicCost();
  const stills = motion === 'story' ? shots * imageCost(t, im) : 0;
  const total = (r) => base + stills + shots * clipCost(t, perShot, r, v);
  const byRes = Object.fromEntries(resOf(t, v).map((r) => [r, total(r)]));
  return { credits: motion === 'photo' ? base : total(clipRes(t, res, v)), res: clipRes(t, res, v), motion: MOTIONS.includes(motion) ? motion : 'video', vmodel: v, imodel: im, byRes, photo: base, perImage: imageCost(t, im), clipSeconds: clipSecs };
}

// ---------- request → each family's input ----------
const pickAspect = (aspect, allowed, fallback) => (allowed.includes(aspect) ? aspect : fallback);

// an image request → { model, input }: product photos go in as references where the model takes them (an edit model
// when it has a separate one); models that can't take a reference make the picture from the words alone
export function imageRequest(model, { prompt, refs = [], aspect = '1:1', resolution = '1K' }) {
  const e = Object.values(IMAGE_MODELS).find((x) => x.model === model || x.edit === model);
  const r = refs.slice(0, e?.refs ?? 10);
  if (model.startsWith('gpt-image-2')) return { model: r.length ? 'gpt-image-2-image-to-image' : 'gpt-image-2-text-to-image', input: { prompt, ...(r.length ? { input_urls: r } : {}), aspect_ratio: aspect, resolution } };
  if (model.startsWith('seedream/')) return { model: r.length ? 'seedream/5-pro-image-to-image' : 'seedream/5-pro-text-to-image', input: { prompt, ...(r.length ? { image_urls: r } : {}), aspect_ratio: pickAspect(aspect, ['1:1', '4:3', '3:4', '16:9', '9:16', '2:3', '3:2', '21:9'], '1:1'), quality: resolution === '1K' ? 'basic' : 'high', output_format: 'png' } };
  if (model.startsWith('ideogram/')) {
    const size = { '1:1': 'square_hd', '9:16': 'portrait_16_9', '3:4': 'portrait_4_3', '4:5': 'portrait_4_3', '16:9': 'landscape_16_9', '4:3': 'landscape_4_3' }[aspect] || 'square_hd';
    return { model, input: { prompt, rendering_speed: resolution === '1K' ? 'BALANCED' : 'QUALITY', style: 'REALISTIC', image_size: size, expand_prompt: false } };
  }
  if (model.startsWith('flux-3/')) return { model, input: { prompt, aspect_ratio: pickAspect(aspect, ['1:1', '4:3', '3:4', '3:2', '2:3', '16:9', '9:16', '21:9'], '1:1'), resolution, output_format: 'png', num_images: 1, enhance_prompt: false } };
  return { model, input: imageInput(model, { prompt, refs, aspect, resolution }) };
}
export function imageInput(model, { prompt, refs = [], aspect = '1:1', resolution = '1K' }) {
  if (/nano-banana-edit/.test(model)) return { prompt, image_urls: refs.slice(0, 10), aspect_ratio: aspect, output_format: 'png' };
  return { prompt, ...(refs.length ? { image_input: refs.slice(0, /pro/.test(model) ? 8 : 10) } : {}), aspect_ratio: aspect, resolution, output_format: 'png' };
}

// → { input, seconds, resolution } — seconds and resolution as the model will actually render them (for the usage log).
// Clips are made without sound where the model allows it (Studio adds its own voiceover, music and effects; the editor
// drops any sound a model adds anyway).
export function clipInput(model, { prompt, image, last = null, aspect = '9:16', seconds = 5, resolution = '720p', variant = '' }) {
  const frames = (first = 'first_frame_url', end = 'last_frame_url') => ({ ...(image ? { [first]: image } : {}), ...(image && last ? { [end]: last } : {}) });
  if (model.startsWith('bytedance/seedance')) {
    const max = /2-5/.test(model) ? 30 : 15, res = /mini|fast/.test(model) && !['480p', '720p'].includes(resolution) ? '720p' : resolution;
    const s = Math.min(max, Math.max(4, Math.round(seconds)));
    return { input: { prompt, ...frames(), resolution: res, aspect_ratio: aspect, duration: s, generate_audio: false }, seconds: s, resolution: res };
  }
  if (model === 'kling-4.0/keyframe-to-video') {
    const s = Math.min(30, Math.max(3, Math.round(seconds))), res = resolution === '1080p' ? '1080p' : '720p';
    return { input: { prompt, ...frames(), duration: s, resolution: res, aspect_ratio: pickAspect(aspect, ['16:9', '9:16', '1:1', '21:9'], 'auto') }, seconds: s, resolution: res };
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
    const s = [4, 6, 8].find((l) => l >= Math.round(seconds)) ?? 8, res = ['720p', '1080p', '4k'].includes(resolution) ? resolution : '720p';
    return { input: { model: variant || 'veo3_fast', prompt, ...(image ? { image_urls: last ? [image, last] : [image], generation_type: 'FIRST_AND_LAST_FRAMES_2_VIDEO' } : {}), aspect_ratio: pickAspect(aspect, ['16:9', '9:16'], '16:9'), resolution: res, duration: s }, seconds: s, resolution: res };
  }
  if (model.startsWith('grok-imagine-video')) {
    const s = Math.min(15, Math.max(1, Math.round(seconds))), res = ['480p', '720p', '1080p'].includes(resolution) ? resolution : '720p';
    return { input: { prompt, ...frames(), aspect_ratio: pickAspect(aspect, ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3'], 'auto'), resolution: res, duration: s, enable_audio: false }, seconds: s, resolution: res };
  }
  if (model.includes('gemini-omni')) {
    const s = [4, 6, 8, 10].find((l) => l >= Math.round(seconds)) ?? 10, res = ['720p', '1080p', '4k'].includes(resolution) ? resolution : '720p';
    return { input: { prompt, ...frames(), duration: String(s), aspect_ratio: pickAspect(aspect, ['16:9', '9:16'], '16:9'), resolution: res }, seconds: s, resolution: res };
  }
  if (model.startsWith('wan/')) {
    const s = Math.min(30, Math.max(2, Math.round(seconds))), res = ['480p', '720p', '1080p'].includes(resolution) ? resolution : '720p';
    return { input: { prompt, ...frames(), resolution: res.toUpperCase(), aspect_ratio: pickAspect(aspect, ['16:9', '4:3', '1:1', '3:4', '9:16'], 'adaptive'), duration: s, audio: false }, seconds: s, resolution: res };
  }
  // an unknown family: the common shape, and the admin is warned in the log on failure
  return { input: { prompt, ...(image ? { image_url: image } : {}), aspect_ratio: aspect, duration: Math.round(seconds), resolution }, seconds: Math.round(seconds), resolution };
}
