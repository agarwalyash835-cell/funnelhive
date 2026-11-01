// Studio's files: ffmpeg / ffprobe runners, downloading a finished render (kie.ai keeps results only 14 days, so every
// file is copied to our own storage at once), and saving it where uploads go — the storage bucket when there is one,
// else this server's disk — counted against the seller's storage like any upload.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { dir as DATA_DIR, uid } from '../db.js';
import { s3Enabled, putFile, publicUrlFor } from '../storage.js';

const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
export const tmpFile = (ext) => path.join(os.tmpdir(), `studio-${Date.now().toString(36)}-${uid()}.${ext}`);
export const rm = (...files) => { for (const f of files) if (f) fs.rm(f, { force: true }, () => {}); };

// → { code, out, err } — never throws on a non-zero exit (filters that measure things print to stderr)
export function run(bin, args, { timeoutMs = 300000 } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(bin, args, { windowsHide: true });
    let out = '', err = '';
    p.stdout.on('data', (d) => { if (out.length < 4e6) out += d; });
    p.stderr.on('data', (d) => { if (err.length < 4e6) err += d; });
    const t = setTimeout(() => { p.kill('SIGKILL'); reject(new Error(`${bin} took too long`)); }, timeoutMs);
    p.on('error', (e) => { clearTimeout(t); reject(e); });
    p.on('close', (code) => { clearTimeout(t); resolve({ code, out, err }); });
  });
}
export const ffmpeg = (args, o) => run('ffmpeg', ['-hide_banner', '-nostdin', '-y', ...args], o);

// → { width, height, seconds, fps, video, audio }
export async function probe(file) {
  const r = await run('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', file], { timeoutMs: 30000 });
  let d = {};
  try { d = JSON.parse(r.out); } catch { /* unreadable */ }
  const v = (d.streams || []).find((s) => s.codec_type === 'video');
  const [n, dd] = String(v?.avg_frame_rate || '0/1').split('/').map(Number);
  return { width: v?.width || 0, height: v?.height || 0, seconds: Number(d.format?.duration) || 0, fps: dd ? Math.round((n / dd) * 100) / 100 : 0, video: !!v, audio: (d.streams || []).some((s) => s.codec_type === 'audio') };
}

// a render's URL → a local temp file (size-capped)
export async function download(url, ext, maxBytes = 200 * 1024 * 1024) {
  const r = await fetch(url, { signal: AbortSignal.timeout(180000) });
  if (!r.ok) throw new Error('Couldn’t fetch the result');
  const buf = Buffer.from(await r.arrayBuffer());
  if (!buf.length || buf.length > maxBytes) throw new Error('The result came back empty or too large');
  const f = tmpFile(ext);
  fs.writeFileSync(f, buf);
  return f;
}

// a local file → its public URL in the seller's uploads (studio-… names, so they're easy to tell apart)
export async function save(userId, file, ext, type) {
  const { addStorage } = await import('../limits.js'); // loaded here: limits.js pulls in billing, which needs the full server
  const name = `studio-${Date.now().toString(36)}-${uid()}.${ext}`;
  const bytes = fs.statSync(file).size;
  if (s3Enabled()) {
    try {
      await putFile(`uploads/${userId}/${name}`, file, type);
      addStorage(userId, bytes);
      return { url: publicUrlFor(`uploads/${userId}/${name}`) || `/uploads/${userId}/${name}`, bytes };
    } catch (e) { console.error('studio storage upload failed — kept on disk', e.message); }
  }
  const d = path.join(UPLOAD_DIR, userId);
  fs.mkdirSync(d, { recursive: true });
  fs.copyFileSync(file, path.join(d, name));
  addStorage(userId, bytes);
  return { url: `/uploads/${userId}/${name}`, bytes };
}

// our own URL → a local path when it's on this server's disk (else download it)
export async function localCopy(url, ext) {
  const m = /^\/uploads\/([\w-]+)\/([\w.-]+)$/.exec(url || '');
  if (m) { const f = path.join(UPLOAD_DIR, m[1], m[2]); if (fs.existsSync(f)) return { file: f, temp: false }; }
  const abs = /^https?:\/\//.test(url) ? url : `${(process.env.APP_URL || '').replace(/\/$/, '')}${url}`;
  return { file: await download(abs, ext), temp: true };
}
// what a model must be given: a URL it can fetch from the internet
export const publicUrl = (url) => (/^https?:\/\//.test(url) ? url : `${(process.env.APP_URL || '').replace(/\/$/, '')}${url}`);

// frames from a clip as JPEG buffers: the first, one per second, and the last
export async function frames(file, seconds, { max = 8, width = 512 } = {}) {
  const times = [0.05, ...Array.from({ length: Math.max(0, Math.floor(seconds) - 1) }, (_, i) => i + 1), Math.max(0.1, seconds - 0.1)];
  const step = Math.max(1, Math.ceil(times.length / max));
  const pickT = times.filter((_, i) => i % step === 0 || i === times.length - 1).slice(0, max);
  const out = [];
  for (const t of pickT) {
    const f = tmpFile('jpg');
    await ffmpeg(['-ss', String(t), '-i', file, '-frames:v', '1', '-vf', `scale=${width}:-2`, '-q:v', '4', f], { timeoutMs: 30000 });
    if (fs.existsSync(f)) { out.push({ t, buf: fs.readFileSync(f), type: 'image/jpeg' }); rm(f); }
  }
  return out;
}
