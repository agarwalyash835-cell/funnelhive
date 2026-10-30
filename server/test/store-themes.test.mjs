// Storefront themes (store-themes.js), the live demo stores (store-demos.js) and "Describe your shop" (store-ai.js),
// against a fake AI: theme fields checked and saved; demo stores browsable, cart priced, checkout refused; the AI's
// draft cleaned, charged, and changing nothing until Apply; refused when AI is off.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import { startServer, register } from './helpers.mjs';
import { DEMO_THEMES } from '../store-demos.js';

// the page's head is rendered into the built client's index.html — only checked when the client is built
const built = fs.existsSync(new URL('../../client/dist/index.html', import.meta.url));

let srv, api, A, model, ebook, guide, other;
const ai = { last: null, reply: null };
const used = async (t = A) => (await api('/billing', 'GET', null, t)).data.credits.used;
before(async () => {
  model = http.createServer((req, res) => {
    let b = '';
    req.on('data', (d) => { b += d; });
    req.on('end', () => {
      const j = JSON.parse(b);
      ai.last = { sys: j.instructions, user: j.input.at(-1).content };
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(ai.reply) }] }] }));
    });
  });
  await new Promise((r) => model.listen(0, '127.0.0.1', r));
  srv = await startServer({ KIE_API_KEY: 'kie_test', KIE_BASE_URL: `http://127.0.0.1:${model.address().port}` });
  api = srv.api;
  A = (await register(api, 'shop@themes.test')).token;
  ebook = (await api('/products', 'POST', { name: 'Saree draping guide' }, A)).data;
  guide = (await api('/products', 'POST', { name: 'Blouse patterns pack' }, A)).data;
  other = (await api('/products', 'POST', { name: 'Not mine' }, (await register(api)).token)).data;
});
after(async () => { await srv?.stop(); model?.close(); });

test('theme and theme options are checked and saved, and the public store carries them', async () => {
  assert.equal((await api('/store', 'PUT', { handle: 'demo-mine' }, A)).status, 400, 'demo- addresses are kept for the demo stores');
  assert.equal((await api('/store', 'PUT', { theme: 'neon' }, A)).status, 400);
  assert.equal((await api('/store', 'PUT', { themeOptions: { accent: 'green' } }, A)).status, 400);
  assert.equal((await api('/store', 'PUT', { themeOptions: { font: 'comic' } }, A)).status, 400);
  assert.equal((await api('/store', 'PUT', { themeOptions: { heroImage: 'http://evil.example/x.png' } }, A)).status, 400);
  const r = await api('/store', 'PUT', { handle: 'kesari', enabled: true, name: 'Kesari', theme: 'fashion', themeOptions: { accent: '#b4532a', font: 'editorial', hero: 'editorial', sections: ['hero', 'lookbook', 'bogus', 'grid', 'hero'], perks: ['exchange', 'teleport'], announcement: 'Free shipping above ₹999', offers: [{ title: 'Flat 10%', code: 'fl at10!' }], lang: 'hi', seo: { title: 'Kesari — block prints', description: 'Hand-block printed kurtas' } }, policyPages: { refund: { text: 'Returns within 7 days.', draft: true } } }, A);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const o = r.data.store.themeOptions;
  assert.equal(r.data.store.theme, 'fashion');
  assert.deepEqual(o.sections, ['hero', 'lookbook', 'grid']);
  assert.deepEqual(o.perks, ['exchange']);
  assert.equal(o.offers[0].code, 'FLAT10');
  assert.equal(o.lang, 'hi');
  const l = await api('/store/listings', 'POST', { kind: 'product', refId: ebook.id, price: 199, highlights: ['PDF', 'PDF', '40 pages'], sizes: ['A4'], badge: 'New drop' }, A);
  assert.equal(l.status, 200);
  assert.deepEqual(l.data.highlights, ['PDF', '40 pages']);
  const p = await api('/s/kesari');
  assert.equal(p.status, 200);
  assert.equal(p.data.store.theme, 'fashion');
  assert.equal(p.data.store.themeOptions.accent, '#b4532a');
  assert.deepEqual(p.data.listings[0].highlights, ['PDF', '40 pages']);
  assert.equal(p.data.listings[0].badge, 'New drop');
  // a policy page still marked draft isn't shown to buyers; once reviewed it is
  assert.deepEqual(p.data.store.policyPages, []);
  assert.equal((await api('/s/kesari/policy/refund')).status, 404);
  assert.equal((await api('/store', 'PUT', { policyPages: { refund: { text: 'Returns within 7 days.', draft: false } } }, A)).status, 200);
  assert.equal((await api('/s/kesari/policy/refund')).data.policy.text, 'Returns within 7 days.');
  // the page's title and description come from the store's SEO settings
  if (built) {
    const html = await (await fetch(`${srv.base}/s/kesari`)).text();
    assert.match(html, /<title>Kesari — block prints<\/title>/);
    assert.match(html, /name="description" content="Hand-block printed kurtas"/);
  }
});

test('demo stores: browsable with a priced cart and pictures, checkout refused', async () => {
  for (const t of DEMO_THEMES) {
    const r = await api(`/s/demo-${t}`);
    assert.equal(r.status, 200, t);
    assert.equal(r.data.store.demo, true);
    assert.equal(r.data.store.theme, t);
    assert.ok(r.data.listings.length >= 12 && r.data.listings.length <= 24, `${t}: ${r.data.listings.length} products`);
    assert.ok(r.data.listings.every((l) => l.price > 0 && l.title && l.category && l.images[0]));
    // a photo (client/public/demo, served with the built app) when one was made, else the drawn SVG
    for (const src of [...r.data.listings.map((l) => l.images[0]), r.data.store.themeOptions.heroImage].filter(Boolean)) {
      if (src.startsWith('/demo/')) assert.ok(fs.existsSync(new URL(`../../client/public${src}`, import.meta.url)), `${t}: missing ${src}`);
      else assert.match(src, /^\/api\/s\/demo-[a-z]+\/art\/[a-z]+-\d\d\.svg$/);
    }
    // the drawn fallback always works
    const img = await fetch(`${srv.base}/api/s/demo-${t}/art/${r.data.listings[0].id}.svg`);
    assert.equal(img.status, 200);
    assert.match(img.headers.get('content-type'), /image\/svg\+xml/);
    assert.match(await img.text(), /^<svg /);
  }
  assert.equal((await api('/s/demo-nothing')).status, 404);
  const { listings } = (await api('/s/demo-grocery')).data;
  assert.equal((await api(`/s/demo-grocery/p/${listings[0].id}`)).data.listing.title, listings[0].title);
  const cart = [{ id: listings[0].id, qty: 2 }];
  const q = await api('/s/demo-grocery/quote', 'POST', { cart });
  assert.equal(q.status, 200);
  assert.equal(q.data.subtotal, listings[0].price * 2);
  const buyer = { cart, name: 'Asha', email: 'a@x.in', phone: '9876543210', address: { line1: '1 MG Road', city: 'Pune', state: 'Maharashtra', pincode: '411001' } };
  for (const p of ['/order', '/cod', '/pay/start']) {
    const r = await api(`/s/demo-grocery${p}`, 'POST', buyer);
    assert.equal(r.status, 403, p);
    assert.equal(r.data.demo, true);
  }
  assert.equal((await api('/s/demo-grocery/pincode?pin=411001')).data.deliverable, true);
  assert.equal((await api('/s/demo-grocery/pincode?pin=12')).data.valid, false);
  if (built) {
    const html = await (await fetch(`${srv.base}/s/demo-beauty`)).text();
    assert.match(html, /<title>Nyra Botanics/);
    assert.match(html, /noindex/);
  }
});

test('describe your shop: the AI draft is cleaned and charged, nothing changes until Apply', async () => {
  const before = await used();
  const storeBefore = (await api('/store', 'GET', null, A)).data;
  assert.equal((await api('/store/ai-setup', 'POST', { prompt: 'hi' }, A)).status, 400);
  ai.reply = {
    theme: 'kirana-ish', lang: 'en', accent: 'not-a-colour', font: 'editorial', hero: 'split',
    name: 'Kesari Studio', tagline: 'Hand-block prints from Jaipur', about: '<b>Small</b> studio of printers.',
    announcement: 'Free shipping above ₹999', heroTitle: 'The Monsoon Edit', heroText: 'Breezy cottons.', heroCta: 'Shop now',
    categories: ['Kurtas', 'Sarees', 'Kurtas', ''], sections: ['hero', 'lookbook', 'nonsense'], perks: ['exchange', 'free-money'],
    offers: [{ title: 'Flat ₹100 off', note: 'above ₹1499', code: 'MADEUP' }],
    seo: { title: 'Kesari Studio', description: 'Hand-block printed kurtas and sarees' },
    policies: { refund: 'Refunds\nWithin 7 days of delivery.', shipping: 'Ships in 2 days.', terms: '', privacy: 'We keep your data safe.' },
    listings: [
      { ref: `product:${ebook.id}`, title: 'How to drape a saree', description: 'A picture guide.', category: 'Sarees', highlights: ['Step by step', 'PDF'], badge: 'Bestseller' },
      { ref: `product:${guide.id}`, title: 'Blouse patterns', description: 'Twelve patterns.', category: 'Unknown' },
      { ref: `product:${other.id}`, title: 'Someone else’s', description: 'x' },
    ],
    bannerPrompt: 'Sunlit studio with block-printed fabric',
  };
  const r = await api('/store/ai-setup', 'POST', { prompt: 'Hum Jaipur se hand-block print kurte aur sarees bechte hain, 999 se upar free shipping', picks: [`product:${ebook.id}`, `product:${guide.id}`, `product:${other.id}`] }, A);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const d = r.data.draft;
  assert.equal(d.theme, 'fashion', 'an unknown theme falls back to the description’s industry');
  assert.equal(d.options.accent, undefined, 'a bad colour is dropped');
  assert.equal(d.options.font, 'editorial');
  assert.deepEqual(d.options.sections, ['hero', 'lookbook', 'grid']);
  assert.deepEqual(d.options.perks, ['exchange']);
  assert.equal(d.options.offers[0].code, '', 'the AI never sets coupon codes');
  assert.deepEqual(d.categories, ['Kurtas', 'Sarees']);
  assert.equal(d.about, 'Small studio of printers.');
  assert.equal(d.policyPages.refund.draft, true);
  assert.equal(d.policyPages.terms, undefined);
  assert.deepEqual(d.listings.map((l) => [l.ref.split(':')[1], l.category]), [[ebook.id, 'Sarees'], [guide.id, '']], 'only the seller’s own products');
  assert.match(ai.last.sys, /Return ONLY JSON/);
  assert.match(ai.last.user, /Saree draping guide/);
  assert.doesNotMatch(ai.last.user, /Not mine/);
  assert.equal(await used(), before + 5, 'a store draft costs 5 credits');
  // nothing changed yet
  const mid = (await api('/store', 'GET', null, A)).data;
  assert.deepEqual([mid.store.theme, mid.store.name, mid.store.tagline], [storeBefore.store.theme, storeBefore.store.name, storeBefore.store.tagline]);
  assert.deepEqual(mid.listings, storeBefore.listings);
  // a junk answer is refused and costs nothing
  ai.reply = { nonsense: true };
  assert.equal((await api('/store/ai-setup', 'POST', { prompt: 'a shop that sells nice things' }, A)).status, 502);
  assert.equal(await used(), before + 5);
  // Apply: the reviewed refund page is kept, drafts filled, the listed product updated, the unpriced one skipped
  d.options.heroImage = 'https://elsewhere.example/banner.png';
  const ap = await api('/store/ai-setup/apply', 'POST', { draft: d }, A);
  assert.equal(ap.status, 200, JSON.stringify(ap.data));
  assert.deepEqual([ap.data.updated, ap.data.created, ap.data.skipped], [1, 0, ['Blouse patterns']]);
  const after = (await api('/store', 'GET', null, A)).data;
  assert.equal(after.store.theme, 'fashion');
  assert.equal(after.store.name, 'Kesari Studio');
  assert.equal(after.store.themeOptions.heroTitle, 'The Monsoon Edit');
  assert.equal(after.store.themeOptions.heroImage, undefined, 'only the seller’s own uploads as the banner');
  assert.equal(after.store.themeOptions.lang, 'en');
  assert.equal(after.store.policyPages.refund.text, 'Returns within 7 days.', 'a reviewed page is kept');
  assert.equal(after.store.policyPages.shipping.draft, true);
  const l = after.listings.find((x) => x.refId === ebook.id);
  assert.deepEqual([l.title, l.category, l.badge, l.price], ['How to drape a saree', 'Sarees', 'Bestseller', 199]);
});

test('rewrite one listing with AI: a draft, not saved', async () => {
  const l = (await api('/store', 'GET', null, A)).data.listings[0];
  ai.reply = { title: 'Saree Draping Guide (PDF)', description: 'Learn six drapes with clear photos.', highlights: ['6 drapes', 'Photo steps'] };
  const before = await used();
  const r = await api(`/store/listings/${l.id}/ai`, 'POST', { hint: 'mention Nivi drape' }, A);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.draft.title, 'Saree Draping Guide (PDF)');
  assert.match(ai.last.user, /Nivi drape/);
  assert.equal(await used(), before + 1);
  assert.equal((await api('/store', 'GET', null, A)).data.listings[0].title, l.title, 'not saved');
});

test('AI setup is refused clearly when AI isn’t switched on', async () => {
  const s2 = await startServer();
  try {
    const t = (await register(s2.api)).token;
    const r = await s2.api('/store/ai-setup', 'POST', { prompt: 'We sell fresh vegetables and groceries in Pune' }, t);
    assert.equal(r.status, 503);
    assert.match(r.data.error, /AI isn’t switched on/);
    assert.equal((await s2.api('/billing', 'GET', null, t)).data.credits.used, 0);
  } finally { await s2.stop(); }
});
