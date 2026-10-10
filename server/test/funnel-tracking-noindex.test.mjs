// A funnel's own tracking ids (override the workspace's field by field, server-side events follow the funnel's
// pixel), and hiding pages from search engines (robots meta, X-Robots-Tag, sitemap).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer, register } from './helpers.mjs';

const built = fs.existsSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../../client/dist/index.html'));
let srv, api, T, sink;
const conv = [];
before(async () => {
  sink = http.createServer((req, res) => { let b = ''; req.on('data', (c) => { b += c; }); req.on('end', () => { conv.push({ url: req.url, body: JSON.parse(b || '{}') }); res.setHeader('content-type', 'application/json'); res.end('{"events_received":1}'); }); }).listen(0);
  srv = await startServer({ APP_URL: 'http://app.example.test', META_GRAPH_URL: `http://127.0.0.1:${sink.address().port}/meta`, GA4_MP_URL: `http://127.0.0.1:${sink.address().port}/ga4` });
  api = srv.api;
  T = (await register(api)).token;
  await api('/settings', 'PUT', { tracking: { fbPixel: '111111111', ga4: 'G-WORK1234', googleAds: { conversionId: 'AW-111111111', purchaseLabel: 'WorkPurch1', leadLabel: 'WorkLead1', bookingLabel: '' } } }, T);
});
after(async () => { sink.close(); await srv.stop(); });
const page = async (p) => { const r = await fetch(srv.base + p); return { status: r.status, headers: r.headers, html: await r.text() }; };
const live = async (name, steps) => {
  const f = (await api('/funnels', 'POST', { name }, T)).data;
  return (await api(`/funnels/${f.id}`, 'PUT', { published: true, ...(steps ? { steps: steps(f) } : {}) }, T)).data;
};

test('a funnel’s own tracking ids win field by field; invalid ids are refused', async () => {
  const f = await live('Brand two');
  const put = (b) => api(`/funnels/${f.id}/tracking`, 'PUT', b, T);
  for (const bad of [{ fbPixel: 'abc' }, { ga4: 'UA-12345' }, { googleAds: { conversionId: 'G-123456' } }, { googleAds: { conversionId: 'AW-222222222', leadLabel: 'a b' } }, { googleAds: { purchaseLabel: 'NoIdLabel1' } }]) {
    assert.equal((await put(bad)).status, 400, JSON.stringify(bad));
  }
  assert.equal((await api(`/funnels/${f.id}`, 'GET', null, T)).data.tracking, undefined, 'nothing stored by refused saves');
  // only the pixel: GA4 and Google Ads still come from the workspace
  assert.equal((await put({ fbPixel: '222222222' })).status, 200);
  let t = (await api(`/public/${f.slug}`)).data.tracking;
  assert.deepEqual(t, { fbPixel: '222222222', ga4: 'G-WORK1234', googleAds: { conversionId: 'AW-111111111', purchaseLabel: 'WorkPurch1', leadLabel: 'WorkLead1', bookingLabel: '' } });
  // its own Google Ads id: its labels only (never the workspace's labels for another account)
  const r = (await put({ fbPixel: '222222222', ga4: 'g-fun12345', googleAds: { conversionId: 'aw-222222222', purchaseLabel: 'FunPurch1' } })).data;
  assert.equal(r.tracking.ga4, 'G-FUN12345');
  t = (await api(`/public/${f.slug}`)).data.tracking;
  assert.deepEqual(t, { fbPixel: '222222222', ga4: 'G-FUN12345', googleAds: { conversionId: 'AW-222222222', purchaseLabel: 'FunPurch1', leadLabel: '', bookingLabel: '' } });
  if (built) assert.match((await page(`/f/${f.slug}`)).html, /"fbPixel":"222222222"/, 'the server-rendered page fires the funnel’s pixel');
  // the editor's view: placeholders from the workspace
  const g = (await api(`/funnels/${f.id}/tracking`, 'GET', null, T)).data;
  assert.equal(g.workspace.fbPixel, '111111111');
  assert.equal(g.tracking.fbPixel, '222222222');
  // clear: back to the workspace's ids
  assert.equal((await put({ fbPixel: '', ga4: '', googleAds: {} })).data.tracking, null);
  assert.equal((await api(`/public/${f.slug}`)).data.tracking.fbPixel, '111111111');
  assert.equal((await api(`/funnels/${f.id}`, 'GET', null, T)).data.tracking, undefined);
});

test('server-side events go to the pixel the funnel fires, never another one', async () => {
  await api('/channels/tracking', 'PUT', { metaToken: `EAAWORK${'w'.repeat(40)}` }, T);
  const webinar = async (name) => {
    const g = (await api('/templates/webinar/use', 'POST', {}, T)).data;
    await api(`/funnels/${g.id}`, 'PUT', { published: true, name }, T);
    return g;
  };
  const lead = (g, email) => api(`/public/${g.slug}/lead`, 'POST', { stepId: g.steps[0].id, email, name: 'Asha', eventId: `lead-${email.split('@')[0]}-1234` });
  const hits = async (pixel, n) => { for (let i = 0; i < 50 && conv.filter((c) => c.url.startsWith(`/meta/${pixel}/`)).length < n; i++) await new Promise((r) => setTimeout(r, 100)); return conv.filter((c) => c.url.startsWith(`/meta/${pixel}/`)); };

  const plain = await webinar('Uses the workspace');
  await lead(plain, 'one@example.com');
  assert.equal((await hits('111111111', 1)).length, 1, 'no override: the workspace pixel and token');

  const own = await webinar('Own pixel');
  await api(`/funnels/${own.id}/tracking`, 'PUT', { fbPixel: '333333333' }, T);
  await lead(own, 'two@example.com');
  await new Promise((r) => setTimeout(r, 400));
  assert.equal(conv.filter((c) => c.url.startsWith('/meta/333333333/')).length, 0, 'no token of its own: browser events only');
  assert.equal(conv.filter((c) => c.url.startsWith('/meta/111111111/')).length, 1, 'and nothing to the workspace pixel');

  assert.equal((await api(`/funnels/${own.id}/tracking`, 'PUT', { fbPixel: '333333333', metaToken: 'short' }, T)).status, 400);
  const saved = (await api(`/funnels/${own.id}/tracking`, 'PUT', { fbPixel: '333333333', metaToken: `EAAFUNNEL${'f'.repeat(40)}` }, T)).data;
  assert.equal(saved.tracking.metaToken, true);
  const full = JSON.stringify((await api(`/funnels/${own.id}`, 'GET', null, T)).data);
  assert.ok(!full.includes('metaTokenEnc') && !full.includes('EAAFUNNEL'), 'the token never leaves the server');
  assert.ok(!JSON.stringify((await api(`/public/${own.slug}`)).data).includes('metaToken'));
  await lead(own, 'three@example.com');
  const h = await hits('333333333', 1);
  assert.equal(h.length, 1);
  assert.match(h[0].url, /access_token=EAAFUNNEL/, 'with the funnel’s own token');
  assert.equal(h[0].body.data[0].event_name, 'Lead');
  assert.equal(conv.filter((c) => c.url.startsWith('/meta/111111111/')).length, 1);
});

test('a page hidden from search engines: robots meta, X-Robots-Tag, left out of the sitemap', { skip: !built && 'client not built' }, async () => {
  const f = await live('Hide and seek', (x) => [
    x.steps[0],
    { id: 'n1', name: 'Secret', type: 'sales', slug: 'secret', seo: { title: 'Secret', noindex: 'yes' }, blocks: [] },
    { id: 'n2', name: 'Normal', type: 'sales', slug: 'normal', blocks: [] },
    { id: 'n3', name: 'Thanks', type: 'thankyou', slug: 'thanks', blocks: [] },
  ]);
  assert.equal(f.steps[1].seo.noindex, true, 'stored as a plain boolean');
  const hidden = await page(`/f/${f.slug}/secret`);
  assert.equal(hidden.status, 200);
  assert.match(hidden.html, /<meta name="robots" content="noindex, nofollow">/);
  assert.equal(hidden.headers.get('x-robots-tag'), 'noindex');
  for (const p of [`/f/${f.slug}`, `/f/${f.slug}/normal`]) {
    const n = await page(p);
    assert.doesNotMatch(n.html, /name="robots"/, p);
    assert.equal(n.headers.get('x-robots-tag'), null, p);
  }
  const ty = await page(`/f/${f.slug}/thanks`);
  assert.match(ty.html, /<meta name="robots" content="noindex, nofollow">/, 'thank-you pages are always noindex');
  assert.equal(ty.headers.get('x-robots-tag'), 'noindex');
  let xml = await (await fetch(`${srv.base}/sitemap.xml`)).text();
  assert.ok(xml.includes(`/f/${f.slug}/normal<`));
  for (const s of ['secret', 'thanks']) assert.ok(!xml.includes(`/f/${f.slug}/${s}<`), s);
  // unticking shows it again
  const steps = structuredClone(f.steps); steps[1].seo.noindex = false;
  const f2 = (await api(`/funnels/${f.id}`, 'PUT', { steps }, T)).data;
  assert.equal('noindex' in f2.steps[1].seo, false);
  assert.doesNotMatch((await page(`/f/${f.slug}/secret`)).html, /name="robots"/);
  // the whole funnel hidden
  assert.deepEqual((await api(`/funnels/${f.id}/seo`, 'PUT', { noindex: true }, T)).data.seo, { noindex: true });
  const all = await page(`/f/${f.slug}`);
  assert.match(all.html, /<meta name="robots" content="noindex, nofollow">/);
  assert.equal(all.headers.get('x-robots-tag'), 'noindex');
  xml = await (await fetch(`${srv.base}/sitemap.xml`)).text();
  assert.ok(!xml.includes(`/f/${f.slug}`), 'no step of it in the sitemap');
  assert.equal((await api(`/funnels/${f.id}/seo`, 'PUT', { noindex: false }, T)).data.seo, null);
  assert.equal((await page(`/f/${f.slug}`)).headers.get('x-robots-tag'), null);
});
