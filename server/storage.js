// Object storage (S3, Wasabi, Cloudflare R2, Backblaze B2, DigitalOcean Spaces, MinIO…) — optional. When configured:
//   - database backups are copied off the server after every snapshot
//   - uploaded images go to the bucket (served from S3_PUBLIC_URL / CDN, so any server can serve them)
//   - product files go to the bucket (private; buyers get a short-lived signed link)
// Without it everything stays on the local disk, as before.
//   S3_ENDPOINT=https://<account>.r2.cloudflarestorage.com  S3_BUCKET=funnelhive  S3_REGION=auto
//   S3_ACCESS_KEY=…  S3_SECRET_KEY=…  S3_PUBLIC_URL=https://files.yourdomain.in (public read for uploads/)
// Wasabi: S3_ENDPOINT=https://s3.<region>.wasabisys.com  S3_REGION=<region> (e.g. ap-southeast-1)
// Or enter the same details in Admin → File storage (kept encrypted); server env vars win.
import crypto from 'node:crypto';
import fs from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

// the admin panel's storage account (set by platform.js); used when the server env doesn't name one
let fromSettings = () => null;
export const useStorageSettings = (fn) => { fromSettings = fn; };
const clean = (c) => ({ endpoint: String(c.endpoint || '').replace(/\/+$/, ''), bucket: c.bucket || '', region: c.region || 'auto', key: c.key || '', secret: c.secret || '', publicUrl: String(c.publicUrl || '').replace(/\/+$/, '') });
const env = () => (process.env.S3_ENDPOINT
  ? clean({ endpoint: process.env.S3_ENDPOINT, bucket: process.env.S3_BUCKET, region: process.env.S3_REGION, key: process.env.S3_ACCESS_KEY, secret: process.env.S3_SECRET_KEY, publicUrl: process.env.S3_PUBLIC_URL })
  : clean(fromSettings() || {}));
export const storageFromEnv = () => !!process.env.S3_ENDPOINT;
export const s3Enabled = () => { const e = env(); return !!(e.endpoint && e.bucket && e.key && e.secret); };
export const publicUrlFor = (key) => (env().publicUrl ? `${env().publicUrl}/${key.split('/').map(encodeURIComponent).join('/')}` : null);

const hmac = (k, s) => crypto.createHmac('sha256', k).update(s).digest();
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const enc = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
const pathOf = (e, key) => (key ? `/${e.bucket}/${key.split('/').map(enc).join('/')}` : `/${e.bucket}`);
// e: { secret, region }
function signingKey(e, date) { return hmac(hmac(hmac(hmac(`AWS4${e.secret}`, date), e.region), 's3'), 'aws4_request'); }

// Signature V4 — pure, so it can be checked against AWS's published examples (test/storage.test.mjs)
export function signHeaders({ method, host, path, query = {}, headers = {}, payloadHash, amz, region, accessKey, secret }) {
  const date = amz.slice(0, 8);
  const h = { host, 'x-amz-content-sha256': payloadHash, 'x-amz-date': amz, ...headers };
  const lower = Object.fromEntries(Object.entries(h).map(([k, v]) => [k.toLowerCase(), String(v).trim()]));
  const names = Object.keys(lower).sort();
  const qs = Object.keys(query).sort().map((k) => `${enc(k)}=${enc(query[k])}`).join('&');
  const canonical = [method, path, qs, names.map((n) => `${n}:${lower[n]}\n`).join(''), names.join(';'), payloadHash].join('\n');
  const scope = `${date}/${region}/s3/aws4_request`;
  const signature = crypto.createHmac('sha256', signingKey({ secret, region }, date)).update(['AWS4-HMAC-SHA256', amz, scope, sha(canonical)].join('\n')).digest('hex');
  return { headers: { ...h, authorization: `AWS4-HMAC-SHA256 Credential=${accessKey}/${scope}, SignedHeaders=${names.join(';')}, Signature=${signature}` }, qs, signature };
}
export function presignQuery({ host, path, amz, expires, region, accessKey, secret, extra = {} }) {
  const date = amz.slice(0, 8), scope = `${date}/${region}/s3/aws4_request`;
  const query = { 'X-Amz-Algorithm': 'AWS4-HMAC-SHA256', 'X-Amz-Credential': `${accessKey}/${scope}`, 'X-Amz-Date': amz, 'X-Amz-Expires': String(expires), 'X-Amz-SignedHeaders': 'host', ...extra };
  const qs = Object.keys(query).sort().map((k) => `${enc(k)}=${enc(query[k])}`).join('&');
  const canonical = ['GET', path, qs, `host:${host}\n`, 'host', 'UNSIGNED-PAYLOAD'].join('\n');
  const signature = crypto.createHmac('sha256', signingKey({ secret, region }, date)).update(['AWS4-HMAC-SHA256', amz, scope, sha(canonical)].join('\n')).digest('hex');
  return `${qs}&X-Amz-Signature=${signature}`;
}
const stamp = () => new Date().toISOString().replace(/[-:]|\.\d{3}/g, '');

// a signed request (path-style URLs work with every S3-compatible service)
async function request(method, key, { body, type, query = {}, headers = {} } = {}, e = env()) {
  const stream = body instanceof fs.ReadStream;
  const { headers: signed, qs } = signHeaders({ method, host: new URL(e.endpoint).host, path: pathOf(e, key), query, headers: { ...(type ? { 'content-type': type } : {}), ...headers }, payloadHash: body && !stream ? sha(body) : 'UNSIGNED-PAYLOAD', amz: stamp(), region: e.region, accessKey: e.key, secret: e.secret });
  delete signed.host; // fetch sets it
  const r = await fetch(`${e.endpoint}${pathOf(e, key)}${qs ? `?${qs}` : ''}`, { method, body, duplex: stream ? 'half' : undefined, signal: AbortSignal.timeout(10 * 60000), headers: signed });
  if (!r.ok && !(method === 'DELETE' && r.status === 404)) throw new Error(`Storage ${method} ${key}: ${r.status} ${(await r.text().catch(() => '')).slice(0, 200)}`);
  return r;
}
export const putObject = (key, body, type = 'application/octet-stream') => request('PUT', key, { body, type });
// a file from disk (streamed; up to 5 GB)
export const putFile = (key, file, type) => request('PUT', key, { body: fs.createReadStream(file), type, headers: { 'content-length': fs.statSync(file).size } });
export const deleteObject = (key) => request('DELETE', key);
export const copyObject = (from, to) => request('PUT', to, { headers: { 'x-amz-copy-source': pathOf(env(), from) } });
export const headObject = async (key) => { try { await request('HEAD', key); return true; } catch { return false; } };
export async function getObject(key) { return Buffer.from(await (await request('GET', key)).arrayBuffer()); }
// straight to a file on disk (a backup can be bigger than the memory we'd like to hold it in)
export async function getFile(key, file) {
  const r = await request('GET', key);
  await pipeline(Readable.fromWeb(r.body), fs.createWriteStream(file));
}

// a link anyone can use for a few minutes (private product files)
export function presign(key, { expires = 300, filename } = {}, e = env()) {
  const extra = filename ? { 'response-content-disposition': `attachment; filename*=UTF-8''${enc(filename)}` } : {};
  return `${e.endpoint}${pathOf(e, key)}?${presignQuery({ host: new URL(e.endpoint).host, path: pathOf(e, key), amz: stamp(), expires, region: e.region, accessKey: e.key, secret: e.secret, extra })}`;
}

// every key under a prefix (ListObjectsV2, 1000 at a time)
export async function listKeys(prefix, e = env()) {
  const keys = [];
  let token = '';
  for (let i = 0; i < 100; i++) {
    const xml = await (await request('GET', '', { query: { 'list-type': '2', prefix, ...(token ? { 'continuation-token': token } : {}) } }, e)).text();
    keys.push(...[...xml.matchAll(/<Key>([^<]+)<\/Key>/g)].map((m) => m[1].replace(/&amp;/g, '&')));
    token = (/<NextContinuationToken>([^<]+)<\/NextContinuationToken>/.exec(xml) || [])[1] || '';
    if (!token) break;
  }
  return keys;
}
// ---------- video storage: its own bucket for course video (Cloudflare R2 — no download fees) ----------
// VIDEO_S3_ENDPOINT / _BUCKET / _REGION / _ACCESS_KEY / _SECRET_KEY, or Admin → Video storage. Without one, video
// uses the file storage above (or this server's disk).
let fromVideoSettings = () => null;
export const useVideoStorageSettings = (fn) => { fromVideoSettings = fn; };
export const videoStorageFromEnv = () => !!process.env.VIDEO_S3_ENDPOINT;
const venv = () => (process.env.VIDEO_S3_ENDPOINT
  ? clean({ endpoint: process.env.VIDEO_S3_ENDPOINT, bucket: process.env.VIDEO_S3_BUCKET, region: process.env.VIDEO_S3_REGION, key: process.env.VIDEO_S3_ACCESS_KEY, secret: process.env.VIDEO_S3_SECRET_KEY })
  : clean(fromVideoSettings() || {}));
// where signed links point (the browser fetches them): the buckets' origins, for the page's connect-src
export const bucketOrigins = () => [env(), venv()].map((e) => { try { return e.endpoint ? new URL(e.endpoint).origin : null; } catch { return null; } }).filter((o, i, a) => o && a.indexOf(o) === i);
export const videoBucketReady = () => { const e = venv(); return !!(e.endpoint && e.bucket && e.key && e.secret); };
// one bucket's operations: 'video' (its own bucket) or 'files' (the main storage)
export const bucket = (which) => {
  const e = () => (which === 'video' ? venv() : env());
  return {
    putFile: (key, file, type) => request('PUT', key, { body: fs.createReadStream(file), type, headers: { 'content-length': fs.statSync(file).size } }, e()),
    getObject: async (key) => Buffer.from(await (await request('GET', key, {}, e())).arrayBuffer()),
    deleteObject: (key) => request('DELETE', key, {}, e()),
    presign: (key, opts) => presign(key, opts, e()),
    listKeys: (prefix) => listKeys(prefix, e()),
  };
};

export async function deletePrefix(prefix) { for (const k of await listKeys(prefix)) await deleteObject(k).catch(() => {}); }

// prove a storage account works before it's saved: write, read back and delete a small file
export async function testStorage(c) {
  const e = clean(c), key = `funnelhive-check-${Date.now()}.txt`;
  await request('PUT', key, { body: 'ok', type: 'text/plain' }, e);
  const back = await (await request('GET', key, {}, e)).text();
  // browsers (the course video player) fetch signed links straight from the bucket: that needs a CORS rule on it
  const cors = await corsAllows(presign(key, { expires: 120 }, e));
  await request('DELETE', key, {}, e);
  if (back !== 'ok') throw new Error('the file read back didn’t match');
  return { cors };
}
export async function corsAllows(url, origin = 'https://example.com') {
  try {
    const r = await fetch(url, { method: 'OPTIONS', headers: { Origin: origin, 'Access-Control-Request-Method': 'GET' }, signal: AbortSignal.timeout(10000) });
    const a = r.headers.get('access-control-allow-origin');
    return r.ok && (a === '*' || a === origin);
  } catch { return false; }
}
