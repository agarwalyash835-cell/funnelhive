// Studio editor: pure steps on local files that turn clips + a voiceover into a finished ad video.
//   joinClips → fitDuration (to the voiceover) → burnCaptions → overlayLogo → appendEndCard   (picture, per size)
//   mixAudio (voice + music, music ducked under speech) → normaliseLoudness (-14 LUFS)          (sound, once)
//   mux → an mp4; render() runs the whole chain for 9:16, 1:1 and 16:9.
// Pictures are video-only until mux, so every step can be re-run on its own (a caption change re-renders captions only).
import fs from 'node:fs';
import path from 'node:path';
import { run, probe, need, loudness } from './ff.js';
import { writeAss, safeArea } from './captions.js';
import { studioTmp } from './voice.js';

export const ASPECTS = { '9:16': [9, 16], '1:1': [1, 1], '16:9': [16, 9], '4:5': [4, 5] };
// a size's frame in pixels: the shorter side is `short` (1080 for upload; tests use smaller), both sides even
export function dims(aspect = '9:16', short = 1080) {
  const [a, b] = ASPECTS[aspect] || ASPECTS['9:16'];
  const even = (n) => Math.round(n / 2) * 2;
  return a <= b ? { width: even(short), height: even((short * b) / a) } : { width: even((short * a) / b), height: even(short) };
}
const threads = () => (process.env.STUDIO_FF_THREADS ? ['-threads', String(process.env.STUDIO_FF_THREADS)] : []);
// every step re-encodes, and the last one is what people download (mux copies it): a low CRF keeps the five passes
// from piling up blur and blocks
const venc = ({ fps = 30, crf = 16 } = {}) => ['-c:v', 'libx264', '-preset', process.env.STUDIO_X264_PRESET || 'veryfast', '-crf', String(crf), '-pix_fmt', 'yuv420p', '-r', String(fps), ...threads()];
const tmpFile = (dir, name, ext) => path.join(studioTmp(dir), `${name}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}.${ext}`);

// How a picture fits another shape. 'crop' fills the frame (cuts the edges), 'pad' shows it whole over a blurred,
// enlarged copy of itself (no black bars). 'smart' crops when little is lost and pads otherwise — a vertical video in a
// square frame crops (keeps 56%), in a landscape frame it pads (cropping would keep under a third).
export function fitMode(srcW, srcH, w, h, mode = 'smart') {
  if (mode !== 'smart') return mode;
  const r1 = srcW / srcH, r2 = w / h;
  return Math.min(r1, r2) / Math.max(r1, r2) >= 0.55 ? 'crop' : 'pad';
}
// a filter graph piece [inp] → [out] at w×h
export function fitGraph(inp, out, w, h, mode) {
  // crops sit a little above centre: faces and products are rarely at the very bottom of a shot
  // lanczos: a 480p or 720p render scaled up to the frame stays crisp (the default bicubic softens it)
  if (mode === 'crop') return `[${inp}]scale=${w}:${h}:force_original_aspect_ratio=increase:flags=lanczos,crop=${w}:${h}:(iw-${w})/2:(ih-${h})*0.4,setsar=1[${out}]`;
  return `[${inp}]split=2[${out}_a][${out}_b];[${out}_a]scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},boxblur=luma_radius=min(h\\,w)/20:luma_power=2[${out}_bg];`
    + `[${out}_b]scale=${w}:${h}:force_original_aspect_ratio=decrease:flags=lanczos[${out}_fg];[${out}_bg][${out}_fg]overlay=(W-w)/2:(H-h)/2,setsar=1[${out}]`;
}

// how long the crossfade between two shots is: a quick dissolve (a hard cut between AI shots looks like a jump), never
// more than a fifth of the shorter shot
export const xfadeFor = (a, b, d = 0.3) => Math.max(0, Math.min(d, a / 5, b / 5));
// clips (any sizes, any lengths, with or without sound) → one silent video at w×h, each shot dissolving into the next.
// The dissolves overlap the shots, so the result is a little shorter than the clips laid end to end; fitDuration then
// fits it to the voiceover.
export async function joinClips(files, out, { width = 1080, height = 1920, fps = 30, mode = 'smart', fade = 0.3 } = {}) {
  if (!files?.length) throw new Error('Add at least one clip');
  need('scale', 'concat', ...(mode === 'crop' ? ['crop'] : ['crop', 'boxblur', 'overlay']), ...(files.length > 1 && fade > 0 ? ['xfade'] : []));
  const lens = [];
  const parts = files.map((f, i) => {
    const p = probe(f);
    if (!p.hasVideo) throw new Error(`Clip ${i + 1} has no picture`);
    lens.push(p.duration || 0);
    return `${fitGraph(`${i}:v`, `f${i}`, width, height, fitMode(p.width, p.height, width, height, mode))};[f${i}]fps=${fps},format=yuv420p,settb=AVTB[v${i}]`;
  });
  let tail;
  if (files.length > 1 && fade > 0 && lens.every((l) => l > 0)) {
    // [v0][v1]xfade → [x1]; [x1][v2]xfade → [x2] … each offset is where the picture so far ends, less the dissolve
    const steps = [];
    let end = lens[0], prev = 'v0';
    for (let i = 1; i < files.length; i++) {
      const d = xfadeFor(lens[i - 1], lens[i], fade);
      const label = i === files.length - 1 ? 'v' : `x${i}`;
      steps.push(`[${prev}][v${i}]xfade=transition=fade:duration=${d.toFixed(3)}:offset=${Math.max(0, end - d).toFixed(3)}[${label}]`);
      end += lens[i] - d; prev = label;
    }
    tail = steps.join(';');
  } else tail = `${files.map((_, i) => `[v${i}]`).join('')}concat=n=${files.length}:v=1:a=0[v]`;
  await run([...files.flatMap((f) => ['-i', f]), '-filter_complex', `${parts.join(';')};${tail}`, '-map', '[v]', '-an', ...venc({ fps }), out]);
  return out;
}

// exactly `seconds` long: cut the end off, or hold the last frame when the picture is shorter than the voice
export async function fitDuration(video, seconds, out, { fps = 30 } = {}) {
  const d = probe(video).duration;
  const args = ['-i', video];
  // short: slow it down gently first (up to 30% — still looks natural), and only then hold the last frame, so the
  // video never sits frozen for seconds at the end
  if (d < seconds - 0.02) {
    need('tpad');
    const slow = Math.min(1.3, seconds / Math.max(d, 0.1));
    const rest = seconds - d * slow;
    args.push('-vf', [slow > 1.01 ? `setpts=${slow.toFixed(3)}*PTS` : '', rest > 0.02 ? `tpad=stop_mode=clone:stop_duration=${(rest + 0.1).toFixed(3)}` : ''].filter(Boolean).join(',') || 'null');
  }
  await run([...args, '-t', seconds.toFixed(3), '-an', ...venc({ fps }), out]);
  return out;
}

// a video in another shape (9:16 → 1:1 / 16:9), cropped or padded as fitMode decides
export async function fitSize(video, out, { aspect = '9:16', short = 1080, mode = 'smart', fps = 30 } = {}) {
  const { width, height } = dims(aspect, short);
  const p = probe(video);
  const m = fitMode(p.width, p.height, width, height, mode);
  need('scale', 'crop', ...(m === 'pad' ? ['boxblur', 'overlay'] : []));
  await run(['-i', video, '-filter_complex', fitGraph('0:v', 'v', width, height, m), '-map', '[v]', '-an', ...venc({ fps }), out]);
  return out;
}

// burn an .ass caption file in. ffmpeg's filter syntax treats ':' and '\' as special (every Windows path has both),
// so the step runs from the captions' folder and names the file alone.
export async function burnCaptions(video, assFile, out, { fontsDir, fps = 30 } = {}) {
  need('ass');
  const dir = path.dirname(path.resolve(assFile));
  const fx = (p) => p.replace(/\\/g, '/').replace(/([:'\[\],;])/g, '\\$1');
  let vf = `ass=filename=${fx(path.basename(assFile))}`;
  if (fontsDir) vf += `:fontsdir=${fx(path.relative(dir, path.resolve(fontsDir)) || '.')}`;
  await run(['-i', path.resolve(video), '-vf', vf, '-an', ...venc({ fps }), path.resolve(out)], { cwd: dir });
  return out;
}

// a logo in a corner, inside the safe area (below the app's top bar on vertical video), `size` = its width as a fraction of the frame
export async function overlayLogo(video, logo, out, { position = 'top-right', size = 0.2, opacity = 1, fps = 30 } = {}) {
  need('scale', 'overlay');
  const { width: W, height: H } = probe(video);
  const safe = safeArea(W, H);
  const lw = Math.max(16, Math.round((W * size) / 2) * 2);
  const mx = Math.round(W * 0.05);
  const x = /left/.test(position) ? mx : W - lw - mx;
  const y = /bottom/.test(position) ? `${H - safe.bottom}-h` : String(H / W > 1.4 ? safe.top : Math.round(H * 0.05));
  const alpha = opacity < 1 ? `,colorchannelmixer=aa=${Math.max(0, opacity).toFixed(2)}` : '';
  await run(['-i', video, '-i', logo, '-filter_complex', `[1:v]scale=${lw}:-2,format=rgba${alpha}[lg];[0:v][lg]overlay=${x}:${y}:format=auto,format=yuv420p[v]`, '-map', '[v]', '-an', ...venc({ fps }), out]);
  return out;
}

// the closing offer / price card: an image shown full-frame (over its own blurred copy if its shape differs) for `seconds`
export async function appendEndCard(video, image, out, { seconds = 2.5, fps = 30, fade = 0.25 } = {}) {
  need('scale', 'concat', 'overlay', 'boxblur', 'crop');
  const { width: W, height: H } = probe(video);
  const img = probe(image);
  const m = fitMode(img.width || W, img.height || H, W, H, 'pad');
  const graph = `${fitGraph('1:v', 'c0', W, H, m)};[c0]fps=${fps},format=yuv420p,trim=duration=${seconds},fade=t=in:st=0:d=${fade}[card];[0:v]fps=${fps},format=yuv420p,setsar=1[main];[main][card]concat=n=2:v=1:a=0[v]`;
  await run(['-i', video, '-loop', '1', '-t', String(seconds), '-i', image, '-filter_complex', graph, '-map', '[v]', '-an', ...venc({ fps }), out]);
  return out;
}

// voice + music → one stereo track `duration` long. The voice starts after `voiceDelay`; the music loops, sits at
// musicDb and dips under speech (a compressor keyed on the voice; mixing 32% of the untouched music back caps the dip at
// about 10 dB, so the music ducks rather than vanishes), then fades out at the end.
export async function mixAudio({ voice, music, duration, voiceDelay = 0.15, musicDb = -16, duck = true, fadeOut = 1.5 }, out) {
  if (!voice && !music) throw new Error('Add a voiceover or music');
  if (!(duration > 0)) throw new Error('The video has no length');
  need('adelay', 'apad', 'afade', ...(voice && music ? ['amix', ...(duck ? ['sidechaincompress'] : [])] : []));
  const fmt = 'aformat=sample_rates=48000:channel_layouts=stereo';
  const ms = Math.round(voiceDelay * 1000);
  const fo = Math.min(fadeOut, duration / 3);
  const end = `atrim=0:${duration.toFixed(3)},afade=t=out:st=${(duration - fo).toFixed(3)}:d=${fo.toFixed(3)}`;
  const args = [];
  let graph;
  if (voice) args.push('-i', voice);
  if (music) args.push('-stream_loop', '-1', '-i', music);
  if (voice && music) {
    graph = `[0:a]${fmt},adelay=${ms}|${ms},apad[vo];`
      + (duck
        ? `[vo]asplit=2[vmix][vkey];[1:a]${fmt},volume=${musicDb}dB[mu];[mu][vkey]sidechaincompress=threshold=0.015:ratio=10:attack=15:release=400:mix=0.68[md];[vmix][md]`
        : `[1:a]${fmt},volume=${musicDb}dB[md];[vo][md]`)
      + `amix=inputs=2:duration=longest:normalize=0,${end}[a]`;
  } else if (voice) graph = `[0:a]${fmt},adelay=${ms}|${ms},apad,${end}[a]`;
  else graph = `[0:a]${fmt},volume=${musicDb}dB,${end}[a]`;
  await run([...args, '-filter_complex', graph, '-map', '[a]', '-t', duration.toFixed(3), '-c:a', 'pcm_s16le', out]);
  return out;
}

// even loudness for social feeds: -14 LUFS integrated, true peak under -1 dBTP. Two passes (measure, then apply the
// measured values linearly) — one pass of loudnorm guesses and drifts on short clips.
export async function normaliseLoudness(input, out, { target = -14, truePeak = -1, lra = 11 } = {}) {
  need('loudnorm');
  const base = `loudnorm=I=${target}:TP=${truePeak}:LRA=${lra}`;
  const { stderr } = await run(['-i', input, '-map', '0:a:0', '-af', `${base}:print_format=json`, '-f', 'null', '-'], { what: 'The loudness check' });
  let m;
  try { m = JSON.parse(stderr.slice(stderr.lastIndexOf('{'), stderr.lastIndexOf('}') + 1)); } catch { m = null; }
  // silence can't be made louder: keep it as it is
  if (!m || !Number.isFinite(Number(m.input_i)) || Number(m.input_i) < -70) { await run(['-i', input, '-map', '0:a:0', '-c:a', 'pcm_s16le', out]); return out; }
  const af = `${base}:measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true,aresample=48000`;
  await run(['-i', input, '-map', '0:a:0', '-af', af, '-ar', '48000', '-c:a', 'pcm_s16le', out]);
  return out;
}

// picture + sound → the mp4 people download (the picture is copied, not re-encoded)
export async function mux(video, audio, out) {
  const args = ['-i', video];
  if (audio) args.push('-i', audio);
  await run([...args, '-map', '0:v:0', ...(audio ? ['-map', '1:a:0', '-c:a', 'aac', '-b:a', '192k', '-shortest'] : ['-an']), '-c:v', 'copy', '-movflags', '+faststart', out]);
  return out;
}

// The whole edit. → { files: { '9:16': path, … }, duration, lufs }
//   clips: video files in order · voice: the voiceover (one file; lines joined by the caller) · music: optional
//   words: the voiceover's transcript word timings [{ w, start, end }] (from checkLine's transcriber), for captions
//   captions: { style, mode, font, colour, highlight, upper } or null · logo: { file, position, size } or null
//   endCard: { image, seconds } or null · sizes: ['9:16', '1:1', '16:9'] · short: frame's short side
export async function render({ clips, voice, music, words = [], captions = { style: 'pop' }, logo, endCard, sizes = ['9:16'], short = 1080, fps = 30, voiceDelay = 0.15, tail = 0.5, musicDb = -16, fontsDir, outDir, name = 'studio' }) {
  const temp = [];
  const t = (n, ext = 'mp4') => { const f = tmpFile(outDir, n, ext); temp.push(f); return f; };
  try {
    const voiceLen = voice ? probe(voice).duration : 0;
    // with a voiceover the video lasts as long as it does (plus a breath); without one, as long as the clips
    const body = voice ? voiceDelay + voiceLen + tail : clips.reduce((s, c) => s + probe(c).duration, 0);
    const card = endCard?.image ? Math.max(1, Math.min(6, Number(endCard.seconds) || 2.5)) : 0;
    const duration = body + card;

    let audio = null;
    if (voice || music) {
      const mixed = await mixAudio({ voice, music, duration, voiceDelay, musicDb }, t('mix', 'wav'));
      audio = await normaliseLoudness(mixed, t('norm', 'wav'));
    }
    const files = {};
    for (const aspect of [...new Set(sizes)].filter((a) => ASPECTS[a])) {
      const { width, height } = dims(aspect, short);
      let v = await joinClips(clips, t(`join-${aspect.replace(':', 'x')}`), { width, height, fps });
      v = await fitDuration(v, body, t('fit'), { fps });
      if (captions && words.length) {
        const ass = writeAss(words, t('captions', 'ass'), { ...captions, width, height, offset: voiceDelay });
        v = await burnCaptions(v, ass, t('cap'), { fontsDir, fps });
      }
      if (logo?.file) v = await overlayLogo(v, logo.file, t('logo'), { ...logo, fps });
      if (card) v = await appendEndCard(v, endCard.image, t('card'), { seconds: card, fps });
      const final = path.join(studioTmp(outDir), `${name}-${aspect.replace(':', 'x')}-${Date.now().toString(36)}.mp4`);
      files[aspect] = await mux(v, audio, final);
    }
    const lufs = audio ? (await loudness(files[Object.keys(files)[0]])).lufs : null;
    return { files, duration, lufs };
  } finally {
    for (const f of temp) fs.rm(f, { force: true }, () => {});
  }
}
