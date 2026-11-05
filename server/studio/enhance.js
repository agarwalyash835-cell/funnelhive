// Making a 480p render look like 720p, with ffmpeg alone: clean the noise first (so sharpening doesn't sharpen grain
// and compression blocks), scale up with lanczos, then sharpen gently (contrast-adaptive, plus a light unsharp).
// It can't invent detail — small text and fine patterns stay soft — so the result is measured against a plain upscale
// (ffmpeg's blurdetect and blockdetect, no reference needed) and kept only when it's sharper without getting blockier.
// Stronger presets are for noisier sources; "medium" was the best all-rounder on our sample clips.
import fs from 'node:fs';
import { ffmpeg, probe, tmpFile, rm } from './media.js';

const SHORT = 720; // the short side we upscale to (720×1280 for 9:16)
// the short side → 720, whichever way round the video is
const UP = `scale='if(gt(iw,ih),-2,${SHORT})':'if(gt(iw,ih),${SHORT},-2)':flags=lanczos`;
export const PRESETS = {
  light: `hqdn3d=1.2:1.2:3:3,${UP},cas=0.35`,
  medium: `hqdn3d=2:1.5:5:4,${UP},cas=0.5,unsharp=5:5:0.35:5:5:0`,
  strong: `nlmeans=s=2.2:p=5:r=9,${UP},cas=0.7,unsharp=5:5:0.55:5:5:0`,
};
const ENCODE = ['-c:v', 'libx264', '-preset', 'medium', '-crf', '19', '-pix_fmt', 'yuv420p', '-movflags', '+faststart'];

// blur (higher = blurrier) and blockiness (higher = blockier), averaged over the clip
export async function sharpness(file) {
  const r = await ffmpeg(['-i', file, '-an', '-vf', 'blurdetect,blockdetect', '-f', 'null', '-'], { timeoutMs: 240000 });
  const mean = (n) => { const m = r.err.match(new RegExp(`${n} mean:\\s*([\\d.]+)`)); return m ? Number(m[1]) : null; };
  return { blur: mean('blur'), block: mean('block') };
}

// → { file, enhanced, preset, before, after, width, height } — file is the 720p version, or the original when it's
// already 720p+ or the cleanup didn't measurably help. The caller removes `file` when it's a new temp file.
export async function to720(src, { preset = 'medium' } = {}) {
  const p = await probe(src);
  if (!p.video || Math.min(p.width, p.height) >= SHORT) return { file: src, enhanced: false, reason: 'already 720p or more', width: p.width, height: p.height };
  const plain = tmpFile('mp4'), out = tmpFile('mp4'), flat = tmpFile('mp4');
  const audio = p.audio ? ['-c:a', 'aac', '-b:a', '160k'] : ['-an'];
  // a timeout (ffmpeg throws) takes every temp file with it; on success only the one returned is kept
  try {
    await ffmpeg(['-i', src, '-vf', `scale='if(gt(iw,ih),-2,${SHORT})':'if(gt(iw,ih),${SHORT},-2)':flags=bilinear`, ...ENCODE, ...audio, plain]);
    await ffmpeg(['-i', src, '-vf', PRESETS[preset] || PRESETS.medium, ...ENCODE, ...audio, out]);
    if (!fs.existsSync(out)) { rm(plain, out, flat); return { file: src, enhanced: false, reason: 'enhancing failed', width: p.width, height: p.height }; }
    const [before, after] = await Promise.all([sharpness(plain), sharpness(out)]);
    rm(plain);
    const sharper = before.blur == null || after.blur == null || after.blur < before.blur;
    const notBlockier = before.block == null || after.block == null || after.block <= before.block * 1.1;
    const q = await probe(out);
    // not better than a plain upscale: still deliver 720p, but the plain kind (no over-sharpening)
    if (!(sharper && notBlockier)) {
      rm(out);
      await ffmpeg(['-i', src, '-vf', UP, ...ENCODE, ...audio, flat]);
      return { file: flat, enhanced: false, reason: 'sharpening didn’t help this clip', preset, before, after, width: q.width, height: q.height };
    }
    rm(flat);
    return { file: out, enhanced: true, preset, before, after, width: q.width, height: q.height };
  } catch (e) { rm(plain, out, flat); throw e; }
}
