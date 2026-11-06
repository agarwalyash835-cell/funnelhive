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
  assert.match(html, /<footer class="seller-foot"/, 'the seller\'s legal footer is in the first HTML');
  assert.doesNotMatch(html, /noindex/);
});

test('the live page hides slots the seller hasn’t filled; the sticky bar shows the real countdown', { skip: !built && 'client not built' }, async () => {
  const steps = structuredClone(f.steps);
  const end = Date.now() + 3 * 864e5;
  steps[0].blocks.push(
    { id: 'hz1', type: 'testimonials', props: { title: 'Readers', items: [{ name: '[PLACEHOLDER — customer name, city]', quote: '[PLACEHOLDER — a real customer’s words]' }, { name: 'Meera Joshi, Pune', quote: 'A real review from a real reader' }] } },
    { id: 'hz2', type: 'guarantee', props: { title: 'Refund policy', body: '[PLACEHOLDER — your refund policy]', days: 0 } },
    { id: 'hz3', type: 'hellobar', props: { messages: [{ text: 'Launch price ends [DATE]' }, { text: 'Pay by UPI' }] } },
    { id: 'hz4', type: 'countdown', props: { label: 'Launch price ends in', mode: 'fixed', endsAt: end } },
    { id: 'hz5', type: 'stickybar', props: { text: 'Launch price', price: '₹1,499', buttonText: 'Buy' } },
  );
  await api(`/funnels/${f.id}`, 'PUT', { steps }, T);
  const { html } = await page(`/f/${f.slug}`);
  const markup = html.slice(html.indexOf('<div id="root">'), html.indexOf('window.__FUNNEL__')).replace(/<!-- -->/g, ''); // React's text separators
  assert.doesNotMatch(markup, /\[PLACEHOLDER|\[DATE\]|\[Add your/, 'no unfilled slot is shown to visitors');
  assert.match(markup, /A real review from a real reader/, 'a real review is shown');
  assert.match(markup, /Pay by UPI/);
  assert.match(markup, /class="sb-timer"[^>]*>⏳ Ends in [23]d \d\d:\d\d:\d\d/, 'the sticky bar counts to the page’s real deadline');
  await api(`/funnels/${f.id}`, 'PUT', { steps: f.steps }, T);
});

test('line icons: icon slots and leading emoji are drawn as brand-coloured icons; emoji pages stay emoji', { skip: !built && 'client not built' }, async () => {
  const steps = structuredClone(f.steps);
  steps[0].blocks.push(
    { id: 'ic1', type: 'features', props: { title: 'Why it works', items: [{ icon: 'truck', title: 'Fast delivery', text: 'Across India' }, { icon: '💪', title: 'Strength', text: 'Daily' }, { icon: '🦄', title: 'Unmapped', text: 'stays an emoji' }] } },
    { id: 'ic2', type: 'cta', props: { headline: 'Join today', buttonText: 'Join', note: '🔒 Secure UPI payments' } },
  );
  const markupOf = async (theme) => {
    await api(`/funnels/${f.id}`, 'PUT', { steps, theme: { ...f.theme, ...theme } }, T);
    const { html } = await page(`/f/${f.slug}`);
    return html.slice(html.indexOf('<div id="root">'), html.indexOf('window.__FUNNEL__')).replace(/<!-- -->/g, '');
  };
  const line = await markupOf({ icons: 'line' });
  assert.match(line, /<span class="ic is-icon"><svg[^>]*class="lucide lucide-truck[^"]*\bpi\b/, 'an icon name is drawn as that icon');
  assert.match(line, /<span class="ic is-icon"><svg[^>]*class="lucide lucide-dumbbell/, 'a mapped emoji is drawn as its icon');
  assert.match(line, /🦄/, 'an emoji the library has no icon for stays');
  assert.match(line, /<svg[^>]*lucide-lock[^>]*pi-lead[^>]*>.*?<\/svg>Secure UPI payments/s, 'a label’s leading emoji becomes its icon');
  assert.doesNotMatch(line, /🔒 Secure|💪/);
  const emoji = await markupOf({ icons: undefined });
  assert.match(emoji, /<svg[^>]*lucide-truck/, 'an icon name is always an icon');
  assert.match(emoji, /💪/, 'with emoji on, emoji stay emoji');
  assert.match(emoji, /🔒 Secure UPI payments/);
  await api(`/funnels/${f.id}`, 'PUT', { steps: f.steps, theme: f.theme }, T);
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
