// Object storage: the Signature V4 signer matches AWS's published examples, and with a bucket configured
// (a local fake S3 here) images and product files go to the bucket — product downloads become short signed links.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import { signHeaders, presignQuery } from '../storage.js';
import { startServer, register } from './helpers.mjs';

test('Signature V4 matches the AWS documentation examples', () => {
  const base = { accessKey: 'AKIAIOSFODNN7EXAMPLE', secret: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY', region: 'us-east-1', amz: '20130524T000000Z', host: 'examplebucket.s3.amazonaws.com', path: '/test.txt' };
  assert.equal(signHeaders({ ...base, method: 'GET', headers: { Range: 'bytes=0-9' }, payloadHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855' }).signature, 'f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41');
  assert.ok(presignQuery({ ...base, expires: 86400 }).endsWith('X-Amz-Signature=aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404'));
});

const objects = new Map();
let s3, srv, api, T;
before(async () => {
  s3 = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const key = decodeURIComponent(new URL(req.url, 'http://x').pathname.replace(/^\/bucket\/?/, ''));
      if (!/^AWS4-HMAC-SHA256 Credential=AK\//.test(req.headers.authorization || '') && !req.url.includes('X-Amz-Signature=')) { res.writeHead(403); return res.end('denied'); }
      if (req.method === 'PUT') { objects.set(key, req.headers['x-amz-copy-source'] ? objects.get(decodeURIComponent(req.headers['x-amz-copy-source'].replace(/^\/bucket\//, ''))) : Buffer.concat(chunks)); return res.end(); }
      if (req.method === 'DELETE') { objects.delete(key); res.writeHead(204); return res.end(); }
      if (req.method === 'GET' && new URL(req.url, 'http://x').searchParams.get('list-type')) { const prefix = new URL(req.url, 'http://x').searchParams.get('prefix'); return res.end(`<ListBucketResult>${[...objects.keys()].filter((k) => k.startsWith(prefix)).map((k) => `<Key>${k}</Key>`).join('')}</ListBucketResult>`); }
      if (req.method === 'GET' && objects.has(key)) return res.end(objects.get(key));
      res.writeHead(404); res.end();
    });
  }).listen(0);
  await new Promise((r) => setTimeout(r, 30));
  srv = await startServer({ S3_ENDPOINT: `http://127.0.0.1:${s3.address().port}`, S3_BUCKET: 'bucket', S3_ACCESS_KEY: 'AK', S3_SECRET_KEY: 'SK', S3_REGION: 'auto', S3_PUBLIC_URL: 'https://files.example.in' });
  api = srv.api;
  T = (await register(api)).token;
});
after(async () => { await srv.stop(); s3.close(); });

test('images go to the bucket and are served from its public URL', async () => {
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), crypto.randomBytes(100)]);
  const r = (await api('/uploads', 'POST', { type: 'image/png', data: png.toString('base64') }, T)).data;
  assert.match(r.url, /^https:\/\/files\.example\.in\/uploads\/\w+\/[\w.-]+\.png$/);
  assert.ok([...objects.keys()].some((k) => k.startsWith('uploads/') && objects.get(k).equals(png)));
  const old = await fetch(`${srv.base}${new URL(r.url).pathname}`, { redirect: 'manual' });
  assert.equal(old.status, 301, '/uploads/… on the app redirects to the bucket');
});

test('product files: stored in the bucket, delivered by signed link, removed with the product', async () => {
  const p = (await api('/products', 'POST', { name: 'Guide' }, T)).data;
  const pdf = Buffer.concat([Buffer.from('%PDF-1.7\n'), crypto.randomBytes(4000)]);
  const up = await fetch(`${srv.base}/api/products/${p.id}/files`, { method: 'POST', headers: { authorization: `Bearer ${T}`, 'content-type': 'application/octet-stream', 'x-file-name': 'guide.pdf', 'x-file-type': 'application/pdf' }, body: pdf });
  const { file } = await up.json();
  assert.equal(file.s3, true);
  assert.ok(objects.get(`products/${(await api('/me', 'GET', null, T)).data.id}/${file.id}`).equals(pdf));
  // the seller's own download → a signed link to the bucket
  const dl = await fetch(`${srv.base}/api/products/${p.id}/files/${file.id}`, { headers: { authorization: `Bearer ${T}` }, redirect: 'manual' });
  assert.equal(dl.status, 302);
  const loc = dl.headers.get('location');
  assert.match(loc, /X-Amz-Signature=[0-9a-f]{64}/);
  assert.ok(Buffer.from(await (await fetch(loc)).arrayBuffer()).equals(pdf), 'the signed link works');
  await api(`/products/${p.id}`, 'DELETE', null, T);
  await new Promise((r) => setTimeout(r, 200));
  assert.ok(![...objects.keys()].some((k) => k.endsWith(file.id)), 'deleted from the bucket');
});
