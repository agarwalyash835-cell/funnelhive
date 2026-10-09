// Operations: health (with details behind the metrics token), Prometheus metrics, and the split between the
// dashboard domain (APP_URL) and the live pages domain (PAGES_URL).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, register } from './helpers.mjs';

let srv, api, T, f;
before(async () => {
  srv = await startServer({ APP_URL: 'https://app.brand.in', PAGES_URL: 'https://pages.brand.in', METRICS_TOKEN: 'mtok' });
  api = srv.api;
  T = (await register(api)).token;
  f = (await api('/templates/yoga/use', 'POST', {}, T)).data;
  await api(`/funnels/${f.id}`, 'PUT', { published: true }, T);
});
after(() => srv.stop());
const get = (path, host, headers = {}) => fetch(`${srv.base}${path}`, { redirect: 'manual', headers: { ...(host ? { 'x-forwarded-host': host } : {}), ...headers } });

test('health and metrics', async () => {
  const h = await (await get('/api/health')).json();
  assert.deepEqual([h.ok, h.db], [true, true]);
  assert.equal(h.queues, undefined, 'details need the token');
  const d = await (await get('/api/health?detail=1', null, { authorization: 'Bearer mtok' })).json();
  assert.equal(typeof d.queues.webhooksPending, 'number');
  assert.equal((await get('/metrics')).status, 404);
  const m = await (await get('/metrics', null, { authorization: 'Bearer mtok' })).text();
  assert.match(m, /ff_http_requests_total\{worker="0",method="GET",status="2xx"\} \d+/);
  assert.match(m, /ff_users_total\{worker="0"\} 1/);
  assert.match(m, /ff_http_request_seconds_bucket\{worker="0",le="\+Inf"\}/);
});

test('pages and dashboard live on separate domains', async () => {
  const live = await get(`/f/${f.slug}`, 'app.brand.in');
  assert.equal(live.status, 301);
  assert.equal(live.headers.get('location'), `https://pages.brand.in/f/${f.slug}`);
  assert.notEqual((await get(`/f/${f.slug}?preview=1`, 'app.brand.in')).status, 301, 'editor previews stay');
  const dash = await get('/funnels', 'pages.brand.in');
  assert.equal(dash.headers.get('location'), 'https://app.brand.in/funnels');
  assert.equal((await get(`/api/public/${f.slug}`, 'pages.brand.in')).status, 200, 'page data is served on the pages domain');
  assert.equal((await get('/api/funnels', 'pages.brand.in')).status, 301, 'the app API is not');
  const me = await api('/me', 'GET', null, T);
  assert.equal(me.data.pagesUrl, 'https://pages.brand.in');
});
