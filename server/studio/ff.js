// ffmpeg for Studio: run a command, read a file's shape, measure loudness, and know which filters this build has.
// Everything works on local files; errors are short and in plain words (the last lines of ffmpeg's own report go
// on err.detail for the logs, never to sellers).
import { spawn, spawnSync } from 'node:child_process';

export const FFMPEG = () => process.env.FFMPEG_PATH || 'ffmpeg';
export const FFPROBE = () => process.env.FFPROBE_PATH || 'ffprobe';

// → { code, stderr }; rejects when ffmpeg fails (unless ok() says the code is fine)
export function run(args, { cwd, timeoutMs = 10 * 60000, what = 'The video editor' } = {}) {
  return new Promise((resolve, reject) => {
    let p;
    try { p = spawn(FFMPEG(), ['-hide_banner', '-nostdin', '-y', ...args], { cwd, windowsHide: true }); } catch (e) { return reject(Object.assign(new Error(`${what} isn’t available on this server`), { detail: e.message })); }
    let err = '';
    // keep the tail only: a long render prints megabytes of progress
    p.stderr.on('data', (c) => { err += c; if (err.length > 400000) err = err.slice(-200000); });
    const t = setTimeout(() => p.kill('SIGKILL'), timeoutMs);
    p.on('error', (e) => { clearTimeout(t); reject(Object.assign(new Error(`${what} isn’t available on this server`), { detail: e.message })); });
    p.on('close', (code) => {
      clearTimeout(t);
      if (code === 0) return resolve({ code, stderr: err });
      reject(Object.assign(new Error(`${what} couldn’t finish this video`), { detail: err.split('\n').slice(-12).join('\n'), code }));
    });
  });
}

// → { duration, width, height, fps, hasVideo, hasAudio }
export function probe(file) {
  const r = spawnSync(FFPROBE(), ['-v', 'error', '-show_entries', 'stream=codec_type,width,height,r_frame_rate:format=duration', '-of', 'json', file], { encoding: 'utf8', timeout: 60000, windowsHide: true });
  if (r.status !== 0) throw Object.assign(new Error('This file couldn’t be read as audio or video'), { detail: r.stderr || r.error?.message });
  const d = JSON.parse(r.stdout || '{}');
  const v = (d.streams || []).find((s) => s.codec_type === 'video');
  const [n, den] = String(v?.r_frame_rate || '0/1').split('/').map(Number);
  return { duration: Number(d.format?.duration) || 0, width: v?.width || 0, height: v?.height || 0, fps: den ? n / den : 0, hasVideo: !!v, hasAudio: (d.streams || []).some((s) => s.codec_type === 'audio') };
}

// the filters this ffmpeg build has (cached: the binary doesn't change while we run)
let FILTERS = null;
export function filters() {
  if (FILTERS) return FILTERS;
  const r = spawnSync(FFMPEG(), ['-hide_banner', '-filters'], { encoding: 'utf8', timeout: 15000, windowsHide: true });
  FILTERS = new Set();
  for (const line of String(r.stdout || '').split('\n')) { const m = /^\s*[TSC.|]{2,3}\s+(\w+)\s+\S+->\S+/.exec(line); if (m) FILTERS.add(m[1]); }
  return FILTERS;
}
// the filters Studio relies on, and what a seller loses without each
export const NEEDED = {
  ass: 'captions on the video', overlay: 'logos and end cards', scale: 'resizing', pad: 'fitting sizes', crop: 'fitting sizes', boxblur: 'blurred backgrounds for other sizes',
  concat: 'joining clips', tpad: 'holding the last frame', loudnorm: 'even loudness', ebur128: 'measuring loudness', silencedetect: 'finding long pauses', astats: 'finding distorted audio',
  sidechaincompress: 'lowering music under the voice', amix: 'mixing voice and music', adelay: 'timing the voice', afade: 'fading music out', apad: 'padding audio', asplit: 'lowering music under the voice', fade: 'fading in the end card', zoompan: 'photo motion',
};
// → names of missing filters (empty when this build has everything)
export const missingFilters = (names = Object.keys(NEEDED)) => names.filter((n) => !filters().has(n));
// throw a clear error when a step needs a filter this build lacks
export function need(...names) {
  const miss = missingFilters(names);
  if (miss.length) throw Object.assign(new Error(`This server’s video editor can’t do ${miss.map((n) => NEEDED[n] || n).join(', ')} yet`), { missing: miss });
}

// integrated loudness and true peak of a file's audio → { lufs, truePeak, lra }
export async function loudness(file) {
  need('ebur128');
  const { stderr } = await run(['-i', file, '-map', '0:a:0', '-af', 'ebur128=peak=true', '-f', 'null', '-'], { what: 'The loudness check' });
  const sum = stderr.slice(stderr.lastIndexOf('Summary:'));
  const num = (re) => { const m = re.exec(sum); return m ? Number(m[1]) : null; };
  return { lufs: num(/I:\s*(-?[\d.]+|-inf)\s*LUFS/), lra: num(/LRA:\s*(-?[\d.]+)\s*LU/), truePeak: num(/Peak:\s*(-?[\d.]+|-inf)\s*dBFS/) };
}
