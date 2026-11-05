// Client links (studio/share.js): a temporary link to a finished Studio item that anyone can open without an account.
// It shows the brand kit's name (never the platform's), streams the files through the link (never their permanent
// address), honours "watch only", counts opens, and stops working once switched off or the item is deleted.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { startServer, register, enable2fa } from './helpers.mjs';

let fake, srv, api, S, other, did;
const raw = (p, opts) => fetch(`${srv.base}/api${p}`, opts);

before(async () => {
  fake = http.createServer((req, res) => { res.writeHead(404); res.end('{}'); }).listen(0);
  await new Promise((r) => setTimeout(r, 30));
  srv = await startServer({ KIE_API_KEY: 'kie-test', KIE_BASE_URL: `http://127.0.0.1:${fake.address().port}`, ADMIN_EMAILS: 'boss@share.test', APP_URL: 'https://app.share.test' });
  api = srv.api;
  let ADMIN = (await register(api, 'boss@share.test')).token;
  const link = srv.log().match(/To: boss@share\.test[\s\S]*?\/verify\?token=([a-f0-9.]+)/);
  await api('/auth/verify', 'POST', { token: link[1] });
  ADMIN = (await enable2fa(api, ADMIN)).token;
  S = (await register(api, 'maker@share.test')).token;
  const sid = (await api('/me', 'GET', null, S)).data.id;
  await api(`/admin/studio/accounts/${sid}`, 'PUT', { on: true }, ADMIN);
  other = (await register(api)).token;
  await api('/studio/brand', 'PUT', { name: 'Shuddh Ghee Co' }, S);
  const d = await api('/studio/designs', 'POST', { template: 'offer-banner', text: { headline: 'Pure Desi Ghee', price: '₹499', cta: 'Shop now' }, bg: 'none', group: 'post' }, S);
  assert.equal(d.status, 201, JSON.stringify(d.data));
  did = d.data.id;
});
after(async () => { await srv?.stop(); fake?.close(); });

const tokenOf = (url) => url.split('/view/')[1];

test('a watch-only link: the client sees it in the brand kit’s name, streamed through the link, without download', async () => {
  const r = await api(`/studio/assets/${did}/shares`, 'POST', { days: 3, download: false }, S);
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.match(r.data.url, /^https:\/\/app\.share\.test\/view\/[\w-]{24}$/);
  assert.equal(r.data.share.download, false);
  assert.ok(Math.abs(r.data.share.expiresAt - (Date.now() + 3 * 86400000)) < 60000);
  const t = tokenOf(r.data.url);

  const v = await raw(`/view/${t}`); // no login
  assert.equal(v.status, 200);
  assert.match(v.headers.get('x-robots-tag') || '', /noindex/);
  const body = await v.json();
  assert.equal(body.kind, 'design');
  assert.equal(body.brand.name, 'Shuddh Ghee Co');
  assert.equal(body.download, false);
  assert.equal(body.files.length, 1);
  assert.doesNotMatch(JSON.stringify(body.files), /uploads/, 'never the file’s permanent address');

  const f = await raw(`/view/${t}/file/0`);
  assert.equal(f.status, 200);
  assert.match(f.headers.get('content-type'), /image\/png/);
  assert.match(f.headers.get('content-disposition'), /^inline/);
  assert.ok((await f.arrayBuffer()).byteLength > 1000);
  assert.equal((await raw(`/view/${t}/file/0?dl=1`)).status, 403, 'watch only');
  assert.equal((await raw(`/view/${t}/file/9`)).status, 404);
});

test('a download link, the list with opens counted, and only the owner sees or switches them off', async () => {
  const r = await api(`/studio/assets/${did}/shares`, 'POST', { days: 99 }, S);
  assert.equal(r.status, 201);
  assert.ok(Math.abs(r.data.share.expiresAt - (Date.now() + 7 * 86400000)) < 60000, 'an unknown length is 7 days');
  const t = tokenOf(r.data.url);
  await raw(`/view/${t}`);
  const dl = await raw(`/view/${t}/file/0?dl=1`);
  assert.equal(dl.status, 200);
  assert.match(dl.headers.get('content-disposition'), /^attachment; filename="pure-desi-ghee\.png"/);

  const list = (await api(`/studio/assets/${did}/shares`, 'GET', null, S)).data.shares;
  assert.equal(list.length, 2);
  assert.equal(list[0].views, 1);
  assert.equal(list[0].live, true);
  assert.equal(JSON.stringify(list).includes(t), false, 'the secret is never shown again');

  assert.equal((await api(`/studio/assets/${did}/shares`, 'GET', null, other)).status, 404);
  assert.equal((await api(`/studio/shares/${list[0].id}`, 'DELETE', null, other)).status, 404);
  assert.equal((await api(`/studio/assets/${did}/shares`, 'POST', {}, other)).status, 403, 'Studio is off for them');

  // switched off: the page says so, and nothing streams any more
  const off = await api(`/studio/shares/${list[0].id}`, 'DELETE', null, S);
  assert.equal(off.data.share.live, false);
  const gone = await raw(`/view/${t}`);
  assert.equal(gone.status, 410);
  assert.equal((await gone.json()).expired, true);
  assert.equal((await raw(`/view/${t}/file/0`)).status, 410);
  assert.equal((await raw('/view/not-a-real-token-at-all-xx')).status, 404);
});

test('deleting the item ends its links', async () => {
  const r = await api(`/studio/assets/${did}/shares`, 'POST', {}, S);
  const t = tokenOf(r.data.url);
  assert.equal((await raw(`/view/${t}`)).status, 200);
  const del = await api(`/studio/assets/${did}`, 'DELETE', null, S);
  assert.ok([200, 204].includes(del.status), JSON.stringify(del.data));
  assert.equal((await raw(`/view/${t}`)).status, 404);
});
