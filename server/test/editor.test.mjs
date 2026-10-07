import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, register } from './helpers.mjs';

let srv, api, T;
before(async () => { srv = await startServer(); api = srv.api; T = (await register(api)).token; });
after(() => srv.stop());

// 1×1 transparent PNG
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

test('image upload: stored, served with a safe header, validated', async () => {
  const r = await api('/uploads', 'POST', { type: 'image/png', data: `data:image/png;base64,${PNG}` }, T);
  assert.equal(r.status, 200);
  const img = await fetch(srv.base + r.data.url);
  assert.equal(img.status, 200);
  assert.equal(img.headers.get('content-type'), 'image/png');
  assert.equal(img.headers.get('content-security-policy'), "default-src 'none'");
  assert.equal((await api('/uploads', 'POST', { type: 'image/svg+xml', data: PNG }, T)).status, 400, 'svg refused');
  assert.equal((await api('/uploads', 'POST', { type: 'image/png', data: Buffer.from('<script>alert(1)</script>').toString('base64') }, T)).status, 400, 'fake png refused');
  assert.equal((await api('/uploads', 'POST', { type: 'image/png', data: PNG })).status, 401, 'login required');
});

test('optimised uploads keep a phone-sized copy; fake WebP refused', async () => {
  const webp = (n) => Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 '), Buffer.alloc(n)]).toString('base64');
  const r = await api('/uploads', 'POST', { type: 'image/webp', data: webp(500), small: `data:image/webp;base64,${webp(100)}` }, T);
  assert.equal(r.status, 200);
  assert.match(r.data.url, /\.v\.webp$/);
  assert.equal((await fetch(srv.base + r.data.url)).status, 200);
  const sm = await fetch(srv.base + r.data.url.replace('.v.webp', '.v-800.webp'));
  assert.equal(sm.status, 200);
  assert.equal(sm.headers.get('content-type'), 'image/webp');
  const plain = await api('/uploads', 'POST', { type: 'image/webp', data: webp(50), small: Buffer.from('nope').toString('base64') }, T);
  assert.match(plain.data.url, /\/[^/.]+\.webp$/, 'bad small copy ignored → plain name');
  assert.equal((await api('/uploads', 'POST', { type: 'image/webp', data: Buffer.from('RIFF0000AVI LIST').toString('base64') }, T)).status, 400, 'RIFF that is not WebP refused');
});

test('optimistic concurrency: stale saves get 409 with the latest copy', async () => {
  const f = (await api('/funnels', 'POST', { name: 'Shared' }, T)).data;
  const tabA = await api(`/funnels/${f.id}`, 'PUT', { name: 'Edited in tab A', baseVersion: 1 }, T);
  assert.equal(tabA.status, 200);
  assert.equal(tabA.data.version, 2);
  const tabB = await api(`/funnels/${f.id}`, 'PUT', { name: 'Edited in tab B', baseVersion: 1 }, T);
  assert.equal(tabB.status, 409);
  assert.equal(tabB.data.funnel.name, 'Edited in tab A');
  // saves without baseVersion (older clients) still work
  assert.equal((await api(`/funnels/${f.id}`, 'PUT', { published: true }, T)).status, 200);
});

test('version history: restore points survive reloads and can be restored', async () => {
  const f = (await api('/templates/yoga/use', 'POST', {}, T)).data;
  const original = f.steps[0].blocks.length;
  const steps = structuredClone(f.steps);
  steps[0].blocks = steps[0].blocks.slice(0, 3); // an accidental mass delete
  const saved = (await api(`/funnels/${f.id}`, 'PUT', { steps, baseVersion: f.version || 1 }, T)).data;
  assert.equal(saved.steps[0].blocks.length, 3);
  const revs = (await api(`/funnels/${f.id}/revisions`, 'GET', null, T)).data;
  assert.equal(revs.length, 1);
  assert.ok(revs[0].sections > saved.steps.reduce((a, s) => a + s.blocks.length, 0));
  const restored = (await api(`/funnels/${f.id}/revisions/${revs[0].id}/restore`, 'POST', {}, T)).data;
  assert.equal(restored.steps[0].blocks.length, original);
  assert.ok(restored.version > saved.version, 'restore bumps the version so open editors notice');
  assert.equal((await api(`/funnels/${f.id}/revisions`, 'GET', null, T)).data[0].label, 'Before restoring an older version');
});

test('AI chat creates a restore point and bumps the version', async () => {
  const f = (await api('/templates/gym/use', 'POST', {}, T)).data;
  const r = (await api('/ai/chat', 'POST', { funnelId: f.id, stepId: f.steps[0].id, message: 'make it dark' }, T)).data;
  assert.ok(r.funnel.version > (f.version || 1));
  const revs = (await api(`/funnels/${f.id}/revisions`, 'GET', null, T)).data;
  assert.match(revs[0].label, /Before AI/);
});
