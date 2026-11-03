// The music bed under a video: an instrumental made for it, in the mood the script asks for, a few seconds longer than
// the video so it can fade out under the closing card. Sellers never choose it or see what makes it (it's part of the
// video's credits); the editor ducks it under the voice (assemble.js mixAudio).
import { runTask } from './kie.js';
import { download } from './media.js';

export const MUSIC_MODEL = { model: 'ai-music-api/generate', version: 'V6' };
const clip = (v, n) => String(v ?? '').trim().slice(0, n);
// the style asked for, kept to music words: never vocals, never a named artist
export const musicStyle = (mood) => `${clip(mood, 300) || 'Warm, hopeful modern corporate, light piano and soft pulsing synths, gentle build'}, instrumental, no vocals, clean mix for a voiceover`;

// → a local audio file, or null when no music could be made (the video is still made, without it)
export async function makeMusic({ mood, seconds = 30, title = 'Background' }) {
  const duration = Math.min(360, Math.max(10, Math.ceil(Number(seconds) || 30) + 4));
  try {
    const { urls } = await runTask({ model: MUSIC_MODEL.model, input: { model: MUSIC_MODEL.version, custom_mode: true, instrumental: true, title: clip(title, 80) || 'Background', style: musicStyle(mood), negative_tags: 'vocals, singing, lyrics, harsh, distorted', duration }, timeoutMs: 300000, pollMs: 5000 });
    return urls[0] ? await download(urls[0], 'mp3') : null;
  } catch (e) {
    console.error('studio music failed', e.message);
    return null;
  }
}
