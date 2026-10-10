// Google Ads conversion settings on public pages; sitemap.xml + robots.txt on the pages address and on custom domains.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { startServer, register } from './helpers.mjs';

let srv, api, T;
before(async () => {
  srv = await startServer({ APP_URL: 'http://app.example.test', DOMAINS_FAKE_DNS: '1' });
  api = srv.api;
  T = (await register(api)).token;
});
after(() => srv.stop());

const get = (host, path) => new Promise((resolve, reject) => {
  const u = new URL(srv.base);
  http.get({ host: u.hostname, port: u.port, path, headers: { host } }, (res) => { let b = ''; res.on('data', (c) => { b += c; }); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: b })); }).on('error', reject);
});
const steps = (f) => [
  f.steps[0],
  { id: 's2', name: 'Watch', type: 'sales', slug: 'watch', blocks: [] },
  { id: 's3', name: 'Hidden', type: 'sales', slug: 'hidden', seo: { noindex: true }, blocks: [] },
  { id: 's4', name: 'Checkout', type: 'checkout', slug: 'checkout', blocks: [] },
  { id: 's5', name: 'Thanks', type: 'thankyou', slug: 'thank-you', blocks: [] },
];

test('Google Ads ids are validated and reach the public page data', async () => {
  const put = (googleAds) => api('/settings', 'PUT', { tracking: { googleAds } }, T);
  assert.equal((await put({ conversionId: 'G-123456' })).status, 400);
  assert.equal((await put({ conversionId: 'AW-12345' })).status, 400, 'too short');
  assert.equal((await put({ conversionId: 'AW-123456789', purchaseLabel: 'a b' })).status, 400);
  assert.equal((await put({ conversionId: 'AW-123456789', leadLabel: 'x'.repeat(41) })).status, 400);
  const f = (await api('/funnels', 'POST', { name: 'Ads funnel' }, T)).data;
  await api(`/funnels/${f.id}`, 'PUT', { published: true }, T);
  assert.equal((await api(`/public/${f.slug}`)).data.tracking.googleAds, undefined, 'nothing until set');
  const s = (await put({ conversionId: 'aw-123456789', purchaseLabel: 'AbC-D_efG12', leadLabel: 'Lead1234', bookingLabel: '' })).data;
  assert.equal(s.tracking.googleAds.conversionId, 'AW-123456789');
  const pub = (await api(`/public/${f.slug}`)).data;
  assert.deepEqual(pub.tracking.googleAds, { conversionId: 'AW-123456789', purchaseLabel: 'AbC-D_efG12', leadLabel: 'Lead1234', bookingLabel: '' });
});

test('sitemap.xml lists published funnels’ public steps only; robots.txt points at it', async () => {
  const f = (await api('/funnels', 'POST', { name: 'Yoga Course' }, T)).data;
  await api(`/funnels/${f.id}`, 'PUT', { published: true, steps: steps(f) }, T);
  const draft = (await api('/funnels', 'POST', { name: 'Secret draft' }, T)).data;
  const r = await fetch(`${srv.base}/sitemap.xml`);
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /xml/);
  assert.match(r.headers.get('cache-control'), /max-age=3600/);
  const xml = await r.text();
  assert.match(xml, new RegExp(`<loc>http://app.example.test/f/${f.slug}</loc><lastmod>\\d{4}-\\d\\d-\\d\\d</lastmod>`));
  assert.ok(xml.includes(`/f/${f.slug}/watch<`));
  for (const s of ['hidden', 'checkout', 'thank-you']) assert.ok(!xml.includes(`/f/${f.slug}/${s}<`), `${s} is left out`);
  assert.ok(!xml.includes(draft.slug), 'unpublished funnels are left out');
  assert.match(await (await fetch(`${srv.base}/robots.txt`)).text(), /Sitemap: http:\/\/app\.example\.test\/sitemap\.xml/);

  // on a connected domain: that funnel's steps at the domain's own addresses
  const d = (await api('/domains', 'POST', { domain: 'yoga.example.in', funnelId: f.id }, T)).data;
  assert.equal((await api(`/domains/${d.id}/verify`, 'POST', null, T)).data.status, 'active');
  const dx = await get('yoga.example.in', '/sitemap.xml');
  assert.equal(dx.status, 200);
  assert.match(dx.body, /<loc>https:\/\/yoga\.example\.in\/<\/loc>/);
  assert.match(dx.body, /<loc>https:\/\/yoga\.example\.in\/watch<\/loc>/);
  assert.ok(!/checkout|thank-you|hidden/.test(dx.body));
  assert.match((await get('yoga.example.in', '/robots.txt')).body, /Sitemap: https:\/\/yoga\.example\.in\/sitemap\.xml/);
  assert.ok(!(await (await fetch(`${srv.base}/sitemap.xml`)).text()).includes(`/f/${f.slug}`), 'listed under its own domain instead');
});
