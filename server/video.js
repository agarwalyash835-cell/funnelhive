// Protected course video. Each video uploaded to a product is turned into encrypted streaming video (HLS, AES-128,
// 360p + 720p, 6-second pieces) by ffmpeg in a low-priority background queue. The pieces are useless without the
// key, and the key is only handed to a signed-in student who has access — through links that expire. The player
// shows the student's email moving over the video. Pieces live in the storage bucket (or this server's disk).
import { spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { T, uid, JOBS, dir as DATA_DIR } from './db.js';
import { encrypt, decrypt } from './messaging.js';
import { s3Enabled, getFile, bucket, videoBucketReady } from './storage.js';
// where a video's pieces are: its own video bucket, the main file bucket, or (null) this server's disk
const storeOf = (hls) => hls?.store || (hls?.s3 ? 'files' : null);

const HLS_DIR = path.resolve(DATA_DIR, 'hls');
const TICKET_HOURS = 6;
let SECRET = 'video';
export const setVideoSecret = (s) => { SECRET = String(s || 'video'); };

// ---------- is ffmpeg here? ----------
let FF = null;
export function ffmpegReady() {
  if (FF !== null) return FF;
  try { FF = spawnSync(process.env.FFMPEG_PATH || 'ffmpeg', ['-version'], { timeout: 5000 }).status === 0; } catch { FF = false; }
  return FF;
}
const FFMPEG = () => process.env.FFMPEG_PATH || 'ffmpeg';
const FFPROBE = () => process.env.FFPROBE_PATH || 'ffprobe';

// ---------- the queue ----------
// a video file on a product → a job; the file shows its streaming status to the seller
export function queueVideo(userId, productId, file) {
  if (!/^video\//.test(file?.type || '') || !ffmpegReady()) return null;
  T.products.update(productId, (p) => { const f = p.files.find((x) => x.id === file.id); if (f) f.hls = { status: 'queued', at: Date.now() }; });
  return T.vjobs.insert({ id: uid(), userId, productId, fileId: file.id, status: 'queued', tries: 0, at: Date.now() });
}
const setHls = (productId, fileId, hls) => T.products.update(productId, (p) => { const f = p.files?.find((x) => x.id === fileId); if (f) f.hls = hls; });
const fileOf = (productId, fileId) => T.products.get(productId)?.files?.find((x) => x.id === fileId) || null;
const hlsKey = (userId, fileId, name) => `hls/${userId}/${fileId}/${name}`;
const localDir = (userId, fileId) => path.join(HLS_DIR, userId, fileId);

function run(cmd, args, { timeoutMs = 3 * 3600000 } = {}) {
  return new Promise((resolve, reject) => {
    // low priority on Linux, so the site stays fast while a video is prepared
    const useNice = process.platform !== 'win32' && spawnSync('nice', ['-n', '0', 'true']).status === 0;
    const p = useNice ? spawn('nice', ['-n', '15', cmd, ...args]) : spawn(cmd, args);
    let err = '';
    p.stderr.on('data', (d) => { err = (err + d).slice(-4000); });
    const t = setTimeout(() => p.kill('SIGKILL'), timeoutMs);
    p.on('error', (e) => { clearTimeout(t); reject(e); });
    p.on('close', (code) => { clearTimeout(t); code === 0 ? resolve() : reject(new Error(err.split('\n').filter(Boolean).slice(-2).join(' ') || `${cmd} exited ${code}`)); });
  });
}
function probe(file) {
  const r = spawnSync(FFPROBE(), ['-v', 'error', '-show_entries', 'stream=codec_type,height:format=duration', '-of', 'json', file], { encoding: 'utf8', timeout: 60000 });
  try { const j = JSON.parse(r.stdout || '{}'); return { seconds: Math.round(Number(j.format?.duration) || 0), audio: (j.streams || []).some((s) => s.codec_type === 'audio'), height: Math.max(0, ...(j.streams || []).filter((s) => s.codec_type === 'video').map((s) => Number(s.height) || 0)) }; } catch { return { seconds: 0, audio: true, height: 720 }; }
}

// turn one uploaded video into encrypted HLS
export async function processJob(job) {
  const f = fileOf(job.productId, job.fileId);
  if (!f) { T.vjobs.del(job.id); return null; }
  setHls(job.productId, job.fileId, { status: 'processing', at: Date.now() });
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'ffv-'));
  try {
    // the source: on this server's disk, or fetched from the bucket
    let src = path.join(DATA_DIR, 'products', job.userId, job.fileId);
    if (!fs.existsSync(src)) { src = path.join(work, 'source'); await getFile(`products/${job.userId}/${job.fileId}`, src); }
    const info = probe(src);
    const key = crypto.randomBytes(16), iv = crypto.randomBytes(16).toString('hex');
    fs.writeFileSync(path.join(work, 'k.key'), key);
    fs.writeFileSync(path.join(work, 'k.info'), `key://k\n${path.join(work, 'k.key')}\n${iv}\n`);
    const out = path.join(work, 'out');
    fs.mkdirSync(out);
    // two qualities, never larger than the source: 360p for slow mobile data, up to 720p otherwise
    const hi = Math.min(720, info.height || 720), lo = Math.min(360, hi);
    const rungs = hi > lo ? [[lo, '700k', '1000k'], [hi, '2400k', '3400k']] : [[lo, '900k', '1300k']];
    const split = rungs.length > 1 ? `[0:v]split=${rungs.length}${rungs.map((_, i) => `[s${i}]`).join('')};${rungs.map(([h], i) => `[s${i}]scale=-2:${h}[v${i}]`).join(';')}` : `[0:v]scale=-2:${lo}[v0]`;
    const args = ['-y', '-hide_banner', '-loglevel', 'error', '-i', src, '-filter_complex', split];
    rungs.forEach(([, br, max], i) => { args.push('-map', `[v${i}]`); if (info.audio) args.push('-map', '0:a:0'); args.push(`-b:v:${i}`, br, `-maxrate:v:${i}`, max, `-bufsize:v:${i}`, max); });
    args.push('-c:v', 'libx264', '-preset', 'veryfast', '-profile:v', 'main', '-pix_fmt', 'yuv420p', '-g', '48', '-keyint_min', '48', '-sc_threshold', '0', '-threads', '2');
    if (info.audio) args.push('-c:a', 'aac', '-b:a', '96k', '-ac', '2');
    args.push('-f', 'hls', '-hls_time', '6', '-hls_playlist_type', 'vod', '-hls_key_info_file', path.join(work, 'k.info'),
      '-hls_segment_filename', path.join(out, 'v%v', 's%04d.ts'), '-master_pl_name', 'master.m3u8',
      '-var_stream_map', rungs.map((_, i) => (info.audio ? `v:${i},a:${i}` : `v:${i}`)).join(' '), path.join(out, 'v%v', 'index.m3u8'));
    await run(FFMPEG(), args);
    // store the pieces: the bucket when there is one, else this server's disk
    const files = [];
    const walk = (d, rel = '') => { for (const n of fs.readdirSync(d)) { const p = path.join(d, n), r = rel ? `${rel}/${n}` : n; if (fs.statSync(p).isDirectory()) walk(p, r); else files.push([p, r]); } };
    walk(out);
    const bytes = files.reduce((n, [p]) => n + fs.statSync(p).size, 0);
    let store = videoBucketReady() ? 'video' : s3Enabled() ? 'files' : null;
    if (store) {
      try {
        for (const [p, r] of files) await bucket(store).putFile(hlsKey(job.userId, job.fileId, r), p, r.endsWith('.m3u8') ? 'application/vnd.apple.mpegurl' : 'video/mp2t');
      } catch (e) { console.error('video upload to storage failed — kept on disk', e.message); store = null; }
    }
    if (!store) { fs.rmSync(localDir(job.userId, job.fileId), { recursive: true, force: true }); fs.mkdirSync(path.dirname(localDir(job.userId, job.fileId)), { recursive: true }); fs.cpSync(out, localDir(job.userId, job.fileId), { recursive: true }); }
    // the file may have been deleted while we worked
    if (!fileOf(job.productId, job.fileId)) { await dropHls(job.userId, { id: job.fileId, hls: { store } }); T.vjobs.del(job.id); return null; }
    const hls = { status: 'ready', keyEnc: encrypt(key.toString('hex')), variants: rungs.map(([h]) => h), seconds: info.seconds, bytes, store, at: Date.now() };
    setHls(job.productId, job.fileId, hls);
    T.vjobs.del(job.id);
    return hls;
  } catch (e) {
    const tries = (job.tries || 0) + 1;
    if (tries < 2) T.vjobs.update(job.id, (x) => { x.status = 'queued'; x.tries = tries; x.error = String(e.message).slice(0, 300); });
    else { T.vjobs.del(job.id); setHls(job.productId, job.fileId, { status: 'failed', error: String(e.message).slice(0, 300), at: Date.now() }); }
    console.error('video processing failed', job.fileId, e.message);
    return null;
  } finally { fs.rmSync(work, { recursive: true, force: true }); }
}
// one video at a time per server; a job stuck "processing" for 4 hours (a crash) goes back in the queue
let busy = false;
export async function runVideoQueue() {
  if (busy || !ffmpegReady()) return;
  busy = true;
  try {
    for (const j of T.vjobs.all({ status: 'processing' })) if (Date.now() - (j.startedAt || 0) > 4 * 3600000) T.vjobs.update(j.id, (x) => { x.status = 'queued'; });
    const job = T.vjobs.all({ status: 'queued' }, { order: 'at', limit: 1 })[0];
    if (!job) return;
    const claimed = T.vjobs.update(job.id, (x) => { if (x.status !== 'queued') return; x.status = 'processing'; x.startedAt = Date.now(); });
    if (claimed?.status === 'processing' && claimed.startedAt) await processJob(claimed);
  } finally { busy = false; }
}
if (JOBS) setInterval(() => { runVideoQueue().catch((e) => console.error('video queue', e.message)); }, Number(process.env.VIDEO_TICK_MS || 20000)).unref();

export async function dropHls(userId, f) {
  fs.rmSync(localDir(userId, f.id), { recursive: true, force: true });
  const st = storeOf(f.hls);
  if (st) { try { const b = bucket(st); for (const k of await b.listKeys(`hls/${userId}/${f.id}/`)) await b.deleteObject(k).catch(() => {}); } catch {} }
  T.vjobs.delWhere({ fileId: f.id });
}

// ---------- tickets: short-lived signed links for one student, one video ----------
const sig = (s) => crypto.createHmac('sha256', SECRET).update(`hls:${s}`).digest('hex').slice(0, 32);
export function ticket(accessId, fileId, studentId) {
  const exp = Date.now() + TICKET_HOURS * 3600000;
  return `${studentId}.${exp}.${sig(`${accessId}.${fileId}.${studentId}.${exp}`)}`;
}
function checkTicket(accessId, fileId, t) {
  const [studentId, exp, s] = String(t || '').split('.');
  if (!studentId || !(Number(exp) > Date.now()) || s !== sig(`${accessId}.${fileId}.${studentId}.${exp}`)) return null;
  return studentId;
}

// ---------- serving ----------
const cache = new Map(); // playlists read from the bucket, for a few minutes
async function readText(userId, fileId, store, name) {
  if (!store) return fs.readFileSync(path.join(localDir(userId, fileId), ...name.split('/')), 'utf8');
  const k = hlsKey(userId, fileId, name), hit = cache.get(k);
  if (hit && Date.now() - hit.at < 300000) return hit.text;
  const text = (await bucket(store).getObject(k)).toString('utf8');
  if (cache.size > 500) cache.clear();
  cache.set(k, { text, at: Date.now() });
  return text;
}
export function registerVideo(app, { secret, wrap, rateLimit, isTest, activeFor }) {
  setVideoSecret(secret);
  const limiter = rateLimit({ windowMs: 60000, max: isTest ? 10000 : 2000 });
  // the ticket's student must still have access to this video's product (refunds and removals end it at once)
  const guard = (req, res) => {
    const { aid, fid } = req.params;
    const studentId = checkTicket(aid, fid, req.query.t);
    const a = studentId && activeFor(aid, studentId);
    const p = a && T.products.get(a.productId);
    const f = p?.files.find((x) => x.id === fid);
    if (!f || f.hls?.status !== 'ready') { res.status(403).type('text').send('This video link has expired — reopen the lesson'); return null; }
    res.set({ 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' });
    return { a, p, f, q: `t=${encodeURIComponent(req.query.t)}` };
  };
  const base = (aid, fid) => `/api/hls/${aid}/${fid}`;
  app.get('/api/hls/:aid/:fid/master.m3u8', limiter, wrap(async (req, res) => {
    const g = guard(req, res); if (!g) return;
    const text = await readText(g.p.userId, g.f.id, storeOf(g.f.hls), 'master.m3u8');
    res.type('application/vnd.apple.mpegurl').send(text.replace(/^(v\d+)[\\/]index\.m3u8\r?$/gm, (m, v) => `${base(req.params.aid, g.f.id)}/${v}/index.m3u8?${g.q}`));
  }));
  app.get('/api/hls/:aid/:fid/:v/index.m3u8', limiter, wrap(async (req, res) => {
    const g = guard(req, res); if (!g) return;
    if (!/^v\d+$/.test(req.params.v)) return res.status(404).end();
    const text = await readText(g.p.userId, g.f.id, storeOf(g.f.hls), `${req.params.v}/index.m3u8`);
    const seg = (name) => (storeOf(g.f.hls) ? bucket(storeOf(g.f.hls)).presign(hlsKey(g.p.userId, g.f.id, `${req.params.v}/${name}`), { expires: TICKET_HOURS * 3600 }) : `${base(req.params.aid, g.f.id)}/${req.params.v}/${name}?${g.q}`);
    res.type('application/vnd.apple.mpegurl').send(text
      .replace(/URI="key:\/\/k"/g, `URI="${base(req.params.aid, g.f.id)}/key?${g.q}"`)
      .replace(/^(s\d{4}\.ts)$/gm, (m, name) => seg(name)));
  }));
  // the key: 16 bytes, only for the ticket's student
  app.get('/api/hls/:aid/:fid/key', limiter, (req, res) => {
    const g = guard(req, res); if (!g) return;
    res.type('application/octet-stream').send(Buffer.from(decrypt(g.f.hls.keyEnc), 'hex'));
  });
  // pieces on this server's disk (bucket pieces come from signed bucket links)
  app.get('/api/hls/:aid/:fid/:v/:seg', limiter, (req, res) => {
    const g = guard(req, res); if (!g) return;
    if (!/^v\d+$/.test(req.params.v) || !/^s\d{4}\.ts$/.test(req.params.seg)) return res.status(404).end();
    res.type('video/mp2t').sendFile(path.join(localDir(g.p.userId, g.f.id), req.params.v, req.params.seg), (err) => { if (err && !res.headersSent) res.status(404).end(); });
  });
}
