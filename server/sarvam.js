// Sarvam AI for Indian languages, on the platform's key (Admin → Sarvam AI; server env SARVAM_API_KEY wins):
//   transcribe — customers' WhatsApp voice notes → text (Saaras v4: 22 Indian languages + English, code-mixed speech);
//                short notes on the quick endpoint, long ones (over ~30 s) through a batch job
//   digitise   — pages in Indian scripts (scanned catalogues, photos of price lists) → text (Document AI, ≤30 pages a job)
//   toEnglish  — a question written in an Indian script → English, so it finds English catalogues (Mayura)
// Sellers never see which service is used. (Each seller's own Sarvam account for AI calling is separate: voice.js.)
import { platform } from './platform.js';
import { decrypt } from './messaging.js';

const BASE = () => String(process.env.SARVAM_BASE_URL || 'https://api.sarvam.ai').replace(/\/+$/, '');
export const sarvamKey = () => process.env.SARVAM_API_KEY || decrypt(platform().sarvam?.keyEnc);
export const sarvamReady = () => !!sarvamKey();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const POLL_MS = Number(process.env.SARVAM_POLL_MS || 3000);

async function call(path, { method = 'POST', json, form, timeoutMs = 60000, key = sarvamKey() } = {}) {
  if (!key) throw new Error('Sarvam isn’t set up');
  let r;
  try {
    r = await fetch(`${BASE()}${path}`, { method, headers: { 'api-subscription-key': key, ...(json ? { 'Content-Type': 'application/json' } : {}) }, body: json ? JSON.stringify(json) : form, signal: AbortSignal.timeout(timeoutMs) });
  } catch { throw Object.assign(new Error('Couldn’t reach Sarvam — try again in a minute'), { status: 0 }); }
  const d = await r.json().catch(() => ({}));
  if (r.ok) return d;
  const msg = d?.error?.message || d?.message || d?.detail || `HTTP ${r.status}`;
  throw Object.assign(new Error(r.status === 403 || r.status === 401 ? 'Sarvam didn’t accept the API key' : `Sarvam: ${String(typeof msg === 'string' ? msg : JSON.stringify(msg)).slice(0, 200)}`), { status: r.status });
}
// spoken replies (the dashboard's voice assistant): text → a WAV in that Indian language (Bulbul)
export async function speak(text, language = 'en-IN') {
  const d = await call('/text-to-speech', { json: { text: String(text).slice(0, 1500), target_language_code: LANGUAGES[language] ? language : 'en-IN', model: process.env.SARVAM_TTS_MODEL || 'bulbul:v2', speaker: process.env.SARVAM_TTS_SPEAKER || 'anushka', enable_preprocessing: true }, timeoutMs: 30000 });
  const b64 = d.audios?.[0];
  if (!b64) throw new Error('Sarvam returned no audio');
  return Buffer.from(b64, 'base64');
}
// a quick check for Admin (a one-word translation)
export const checkSarvamKey = (key) => call('/translate', { key, json: { input: 'Hello', source_language_code: 'en-IN', target_language_code: 'hi-IN', model: 'mayura:v1' }, timeoutMs: 20000 });

// ---------- voice notes ----------
// how long an Ogg/Opus voice note is (WhatsApp's own format): the last page's granule position at 48 kHz
export function oggSeconds(buf) {
  const i = buf.lastIndexOf('OggS');
  if (i < 0 || i + 14 > buf.length) return null;
  const g = Number(buf.readBigUInt64LE(i + 6));
  return g > 0 && g < 48000 * 3600 * 10 ? g / 48000 : null;
}
const SHORT = 28; // seconds the quick endpoint takes comfortably
// → { text, language, seconds }
export async function transcribe(buf, mime, name = 'voice.ogg') {
  const seconds = /ogg|opus/.test(mime) ? oggSeconds(buf) : null;
  if (seconds == null || seconds <= SHORT) {
    const form = new FormData();
    form.append('file', new Blob([buf], { type: mime }), name);
    form.append('model', 'saaras:v4');
    form.append('language_code', 'unknown');
    try {
      const d = await call('/speech-to-text', { form, timeoutMs: 60000 });
      return { text: String(d.transcript || '').trim(), language: d.language_code || '', seconds };
    } catch (e) {
      // too long for the quick endpoint (its length wasn't known up front): the batch job below
      if (!(e.status === 400 || e.status === 413 || e.status === 422) || !/durat|long|length|second|limit/i.test(e.message)) throw e;
    }
  }
  return { ...(await transcribeBatch(buf, mime, name)), seconds };
}
async function transcribeBatch(buf, mime, name) {
  const job = await call('/speech-to-text/job/v1', { json: { job_parameters: { model: 'saaras:v4', language_code: 'unknown' } } });
  const id = job.job_id;
  const links = await call('/speech-to-text/job/v1/upload-files', { json: { job_id: id, files: [name] } });
  const put = await fetch(links.upload_urls?.[name]?.file_url, { method: 'PUT', body: buf, headers: { 'x-ms-blob-type': 'BlockBlob', 'Content-Type': mime }, signal: AbortSignal.timeout(120000) });
  if (!put.ok) throw new Error(`Sarvam upload failed (${put.status})`);
  await call(`/speech-to-text/job/v1/${encodeURIComponent(id)}/start`, { json: {} });
  for (let t = 0; t < 4 * 60000; t += POLL_MS) {
    await sleep(POLL_MS);
    const s = await call(`/speech-to-text/job/v1/${encodeURIComponent(id)}/status`, { method: 'GET' });
    if (s.job_state === 'Failed') throw new Error(`Sarvam couldn’t transcribe this: ${s.error_message || s.job_details?.[0]?.error_message || 'failed'}`);
    if (s.job_state !== 'Completed') continue;
    const out = s.job_details?.find((x) => x.state === 'Success')?.outputs?.[0]?.file_name;
    if (!out) throw new Error('Sarvam returned no transcript');
    const dl = await call('/speech-to-text/job/v1/download-files', { json: { job_id: id, files: [out] } });
    const r = await fetch(dl.download_urls?.[out]?.file_url, { signal: AbortSignal.timeout(60000) });
    const d = await r.json();
    return { text: String(d.transcript || '').trim(), language: d.language_code || '' };
  }
  throw new Error('Sarvam took too long to transcribe this voice note');
}

// ---------- pages in Indian scripts ----------
// which Indian language a text is written in (by script; Devanagari → Hindi), or null when it's mostly Latin
const SCRIPTS = [[0x0900, 0x097f, 'hi-IN'], [0x0980, 0x09ff, 'bn-IN'], [0x0a00, 0x0a7f, 'pa-IN'], [0x0a80, 0x0aff, 'gu-IN'], [0x0b00, 0x0b7f, 'od-IN'], [0x0b80, 0x0bff, 'ta-IN'], [0x0c00, 0x0c7f, 'te-IN'], [0x0c80, 0x0cff, 'kn-IN'], [0x0d00, 0x0d7f, 'ml-IN']];
export function scriptLang(text) {
  const n = {}; let latin = 0;
  for (const ch of String(text)) {
    const c = ch.codePointAt(0);
    if ((c >= 65 && c <= 90) || (c >= 97 && c <= 122)) { latin++; continue; }
    const s = SCRIPTS.find(([a, b]) => c >= a && c <= b);
    if (s) n[s[2]] = (n[s[2]] || 0) + 1;
  }
  const [lang, count] = Object.entries(n).sort((a, b) => b[1] - a[1])[0] || [];
  return lang && count > latin * 0.4 ? lang : null;
}
export const LANGUAGES = { 'en-IN': 'English', 'hi-IN': 'Hindi', 'mr-IN': 'Marathi', 'gu-IN': 'Gujarati', 'bn-IN': 'Bengali', 'ta-IN': 'Tamil', 'te-IN': 'Telugu', 'kn-IN': 'Kannada', 'ml-IN': 'Malayalam', 'pa-IN': 'Punjabi', 'od-IN': 'Odia', 'ur-IN': 'Urdu' };
// the text of each page in the job's result (a ZIP: per-page JSON under metadata/, and the whole document)
function pagesFromZip(files, strFromU8) {
  const keys = Object.keys(files);
  const pageFiles = keys.filter((k) => /page_?(\d+)\.json$/i.test(k)).sort((a, b) => Number(/(\d+)\.json$/i.exec(a)[1]) - Number(/(\d+)\.json$/i.exec(b)[1]));
  const textOf = (o) => {
    if (!o || typeof o !== 'object') return '';
    for (const k of ['markdown', 'md', 'text', 'content', 'page_text', 'html']) if (typeof o[k] === 'string' && o[k].trim()) return o[k];
    // blocks / elements with text
    const list = o.blocks || o.elements || o.layout || o.regions || [];
    return Array.isArray(list) ? list.map((b) => b?.text || b?.content || b?.markdown || '').filter(Boolean).join('\n') : '';
  };
  const pages = pageFiles.map((k, i) => { let o; try { o = JSON.parse(strFromU8(files[k])); } catch {} return { n: Number(/(\d+)\.json$/i.exec(k)[1]) || i + 1, text: textOf(o).replace(/<[^>]+>/g, ' ').trim() }; }).filter((p) => p.text);
  if (pages.length) return pages;
  // no per-page text: the whole document as one page
  const main = keys.find((k) => /\.(md|txt)$/i.test(k)) || keys.find((k) => /\.html?$/i.test(k));
  const text = main ? strFromU8(files[main]).replace(/<[^>]+>/g, ' ').replace(/[ \t]+/g, ' ').trim() : '';
  return text ? [{ n: 1, text }] : [];
}
// a PDF (≤30 pages) or an image → [{ n, text }] (n: the page within what was sent)
export async function digitise(buf, name, mime, language) {
  const form = new FormData();
  form.append('file', new Blob([buf], { type: mime }), name);
  if (language && LANGUAGES[language]) form.append('language', language);
  form.append('output_format', 'md');
  const job = await call('/doc-ai/v1/job/digitise', { form, timeoutMs: 120000 });
  const id = job.job_id;
  for (let t = 0; t < 10 * 60000; t += POLL_MS) {
    await sleep(POLL_MS);
    const s = await call(`/doc-ai/v1/job/${encodeURIComponent(id)}/status`, { method: 'GET' });
    const st = String(s.status || s.job_state || '').toLowerCase();
    if (st === 'failed' || st === 'rejected') throw new Error(`Sarvam couldn’t read this: ${s.error_message || s.message || st}`);
    if (st !== 'completed' && st !== 'partially_completed') continue;
    const dl = await call(`/doc-ai/v1/job/${encodeURIComponent(id)}/download-url`, { method: 'GET' });
    const r = await fetch(dl.url, { method: dl.method || 'GET', signal: AbortSignal.timeout(120000) });
    if (!r.ok) throw new Error(`Sarvam result download failed (${r.status})`);
    const { unzipSync, strFromU8 } = await import('fflate');
    return pagesFromZip(unzipSync(new Uint8Array(await r.arrayBuffer())), strFromU8);
  }
  throw new Error('Sarvam took too long to read this file');
}

// ---------- questions in Indian scripts → English (for searching English catalogues) ----------
const tCache = new Map();
export async function toEnglish(text) {
  const t = String(text).slice(0, 1000);
  if (tCache.has(t)) return tCache.get(t);
  const d = await call('/translate', { json: { input: t, source_language_code: 'auto', target_language_code: 'en-IN', model: 'mayura:v1' }, timeoutMs: 4000 });
  const out = String(d.translated_text || '').trim();
  if (tCache.size > 1000) tCache.delete(tCache.keys().next().value);
  tCache.set(t, out);
  return out;
}
