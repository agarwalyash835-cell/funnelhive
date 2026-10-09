import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer, register } from './helpers.mjs';

const built = fs.existsSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../../client/dist-ssr/entry-server.js'));
let srv, api, T, f;
before(async () => {
  srv = await startServer(); api = srv.api; T = (await register(api)).token;
  f = (await api('/templates/yoga/use', 'POST', {}, T)).data;
  await api(`/funnels/${f.id}`, 'PUT', { published: true }, T);
});
after(() => srv.stop());
const page = async (p) => { const r = await fetch(srv.base + p); return { status: r.status, html: await r.text() }; };

test('live page is server-rendered with SEO + link-preview tags', { skip: !built && 'client not built' }, async () => {
  const { html } = await page(`/f/${f.slug}`);
  assert.match(html, /<title>Lose belly fat &amp; stress in 21 days — just 30 minutes of yoga a day<\/title>/);
  assert.match(html, /<meta property="og:title" content="Lose belly fat/);
  assert.match(html, /<meta property="og:description" content="Live Hindi\/English classes/);
  assert.match(html, /<link rel="canonical" href="http:\/\/127\.0\.0\.1:\d+\/f\/21-day-yoga-reset"/);
  assert.match(html, /<div id="root"><div class="page s-organic"/, 'page markup is in the HTML');
  assert.match(html, /Built around your real life/, 'section content is crawlable');
  assert.match(html, /Acharya Kavita Rao/, 'deep sections are rendered too');
  assert.match(html, /fonts\.googleapis\.com\/css2\?family=Fraunces/, 'this style\'s fonts (Organic: Fraunces + Nunito Sans)');
  assert.doesNotMatch(html, /family=Poppins|family=Outfit|family=Sora|family=Plus\+Jakarta/, 'other styles\' fonts are not loaded');
  assert.match(html, /window\.__FUNNEL__=/);
  assert.doesNotMatch(html, /noindex/);
});

test('step SEO title/description override, and step URLs work', { skip: !built && 'client not built' }, async () => {
  const steps = structuredClone(f.steps);
  steps[1].seo = { title: 'Secure checkout', description: 'Pay with UPI' };
  await api(`/funnels/${f.id}`, 'PUT', { steps }, T);
  const { html } = await page(`/f/${f.slug}/checkout`);
  assert.match(html, /<title>Secure checkout<\/title>/);
  assert.match(html, /<meta name="description" content="Pay with UPI">/);
  assert.match(html, /class="sec sec-checkout/);
});

test('unpublished funnels are not rendered; previews are noindex', { skip: !built && 'client not built' }, async () => {
  const d = (await api('/funnels', 'POST', { name: 'Secret draft' }, T)).data;
  const live = await page(`/f/${d.slug}`);
  assert.doesNotMatch(live.html, /Secret draft|__FUNNEL__/);
  const guess = await page(`/f/${d.slug}?preview=1`);
  assert.doesNotMatch(guess.html, /Secret draft|__FUNNEL__/, 'a draft can’t be read by guessing its slug');
  assert.equal((await api(`/public/${d.slug}?preview=1`)).status, 404);
  const { previewKey } = (await api(`/funnels/${d.id}`, 'GET', null, T)).data;
  const pv = await page(`/f/${d.slug}?preview=1&pv=${previewKey}`);
  assert.match(pv.html, /<meta name="robots" content="noindex">/);
  assert.equal((await api(`/public/${d.slug}?preview=1&pv=${previewKey}`)).status, 200);
});

test('funnel content cannot break out of the HTML (XSS)', { skip: !built && 'client not built' }, async () => {
  const evil = '</script><script>alert(1)</script><img src=x onerror=alert(2)>';
  const steps = structuredClone(f.steps);
  steps[0].blocks.find((b) => b.type === 'hero').props.headline = evil;
  await api(`/funnels/${f.id}`, 'PUT', { name: evil, steps }, T);
  const { html } = await page(`/f/${f.slug}`);
  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
  assert.doesNotMatch(html, /<img src=x onerror/);
  assert.match(html, /\\u003c\/script>/, 'embedded JSON is escaped');
});

test('app routes still serve the SPA', { skip: !built && 'client not built' }, async () => {
  const { status, html } = await page('/funnels');
  assert.equal(status, 200);
  assert.match(html, /<div id="root">/);
  assert.match(html, /<title>FunnelHive<\/title>/);
});

test('CDN_URL serves uploaded images from the CDN, with phone-sized srcset', { skip: !built && 'client not built' }, async () => {
  const cdn = await startServer({ CDN_URL: 'https://cdn.example.com/' });
  try {
    const tok = (await register(cdn.api)).token;
    const g = (await cdn.api('/templates/yoga/use', 'POST', {}, tok)).data;
    const steps = g.steps.map((s, i) => (i ? s : { ...s, blocks: s.blocks.map((b) => (b.type === 'hero' ? { ...b, props: { ...b.props, image: '/uploads/u1/pic.v.webp' } } : b)) }));
    await cdn.api(`/funnels/${g.id}`, 'PUT', { published: true, steps }, tok);
    const html = await (await fetch(`${cdn.base}/f/${g.slug}`)).text();
    assert.match(html, /<meta property="og:image" content="https:\/\/cdn\.example\.com\/uploads\/u1\/pic\.v\.webp"/);
    assert.match(html, /src="https:\/\/cdn\.example\.com\/uploads\/u1\/pic\.v\.webp"/);
    assert.match(html, /srcSet="https:\/\/cdn\.example\.com\/uploads\/u1\/pic\.v-800\.webp 800w/i);
    assert.match(html, /window\.__FF_CDN__="https:\/\/cdn\.example\.com"/);
  } finally { await cdn.stop(); }
});

test('built-in buttons can open a link or scroll; unsafe links fall back to the next step', { skip: !built && 'client not built' }, async () => {
  const tok = (await register(api)).token;
  const g = (await api('/templates/yoga/use', 'POST', {}, tok)).data;
  const set = (type, props) => g.steps[0].blocks.map((b) => (b.type === type ? { ...b, props: { ...b.props, ...props } } : b));
  g.steps[0].blocks = set('hero', { ctaAction: 'url', ctaUrl: 'https://wa.me/919876543210', ctaNewTab: true });
  g.steps[0].blocks = set('cta', { buttonAction: 'scroll', buttonUrl: '#Pricing' });
  g.steps[0].blocks = set('pricing', { buttonAction: 'url', buttonUrl: 'javascript:alert(1)' });
  await api(`/funnels/${g.id}`, 'PUT', { published: true, steps: g.steps }, tok);
  const html = await (await fetch(`${srv.base}/f/${g.slug}`)).text();
  assert.match(html, /<a class="btn big[^"]*" href="https:\/\/wa\.me\/919876543210" target="_blank" rel="noopener noreferrer">/);
  assert.match(html, /<a class="btn big[^"]*" href="#pricing">/);
  assert.doesNotMatch(html, /href="javascript:/i, "unsafe link never rendered as a link");
});
