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
export const sarvamFor = (id) => (id?.startsWith('sarvam:') ? id : (VOICES.find((v) => v.id === id)?.gender === 'male' ? DEFAULTS.voice.male : DEFAULTS.voice.female));

// the settings in force: admin overrides on top of the defaults, kind → tier → { model, resolution }
export function studioModels() {
  const o = platform().studio?.models || {};
  const tierOf = (kind) => Object.fromEntries(TIERS.map((t) => [t, { ...DEFAULTS[kind][t], ...(o[kind]?.[t] || {}) }]));
  return { image: tierOf('image'), clip: tierOf('clip'), voice: { ...DEFAULTS.voice, ...(o.voice || {}) }, upscale: { ...DEFAULTS.upscale, ...(o.upscale || {}) }, review: { ...DEFAULTS.review, ...(o.review || {}) } };
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
