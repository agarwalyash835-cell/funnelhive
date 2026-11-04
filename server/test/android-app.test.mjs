// The installable app and the Play Store app: the app manifest's PNG icons, Digital Asset Links for the Android app
// (only with a valid signing-key fingerprint), and camera / microphone allowed for the app's own pages only.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.mjs';

const PRINT = Array.from({ length: 32 }, (_, i) => (i * 7 % 256).toString(16).padStart(2, '0')).join(':');
let srv, bare;
before(async () => {
  srv = await startServer({ ANDROID_CERT_SHA256: ` ${PRINT.toLowerCase()} , not-a-fingerprint` });
  bare = await startServer({ ANDROID_CERT_SHA256: '' });
});
after(() => { srv.stop(); bare.stop(); });

test('asset links name the Android app and only well-formed fingerprints', async () => {
  const r = await fetch(`${srv.base}/.well-known/assetlinks.json`);
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), [{ relation: ['delegate_permission/common.handle_all_urls'], target: { namespace: 'android_app', package_name: 'in.getaihive.app', sha256_cert_fingerprints: [PRINT.toUpperCase()] } }]);
  assert.equal((await fetch(`${bare.base}/.well-known/assetlinks.json`)).status, 404, 'no fingerprint set: no asset links');
});

test('camera and microphone are allowed for the app itself, nothing else', async () => {
  const pp = (await fetch(`${srv.base}/login`)).headers.get('permissions-policy');
  assert.equal(pp, 'camera=(self), microphone=(self), geolocation=()');
});

test('the app manifest has PNG icons, including a maskable one', async () => {
  const m = await (await fetch(`${srv.base}/manifest.webmanifest`)).json();
  const png = m.icons.filter((i) => i.type === 'image/png');
  assert.deepEqual(png.map((i) => i.sizes).sort(), ['192x192', '512x512', '512x512']);
  assert.ok(png.some((i) => i.purpose === 'maskable'));
  assert.equal(m.start_url, '/');
  const c = await (await fetch(`${srv.base}/counter.webmanifest`)).json();
  assert.equal(c.icons[0].src, '/counter-icon.svg', 'counter mode keeps its own icon');
});
