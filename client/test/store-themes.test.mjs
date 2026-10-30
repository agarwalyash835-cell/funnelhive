// Storefront themes' pure helpers: tokens → CSS variables (accent override, readable ink, dark-theme lift), font
// links, section order, labels in Hindi with English fallback — and the theme / font / hero / section ids the
// server accepts match what the client can render.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { THEMES } from '../src/storeThemes/index.js';
import { themeVars, fontHref, sectionsOf, heroOf, FONT_PAIRS, HERO_LAYOUTS, SECTION_NAMES, contrast, inkOn, offPct, bundleOf, compareSet, cartTotal, catIcon, waLink } from '../src/storeThemes/tokens.js';
import { label, LABELS } from '../src/storeThemes/i18n.js';
import { THEME_IDS, FONT_IDS, HERO_IDS, SECTION_IDS, PERK_IDS } from '../../server/store-themes.js';

test('the server and the client know the same themes, fonts, hero layouts and sections', () => {
  assert.deepEqual(Object.keys(THEMES).sort(), [...THEME_IDS].sort());
  assert.deepEqual(Object.keys(FONT_PAIRS).sort(), [...FONT_IDS].sort());
  assert.deepEqual(Object.keys(HERO_LAYOUTS).sort(), [...HERO_IDS].sort());
  assert.deepEqual(Object.keys(SECTION_NAMES).sort(), [...SECTION_IDS].sort());
  for (const p of PERK_IDS) assert.ok(LABELS.en[p] && LABELS.hi[p], `label for perk ${p}`);
  for (const th of Object.values(THEMES)) {
    assert.ok(FONT_PAIRS[th.font], `${th.id} font`);
    assert.ok(th.sections.every((s) => SECTION_IDS.includes(s)), `${th.id} sections`);
    assert.ok(HERO_IDS.includes(th.layout.hero), `${th.id} hero`);
    for (const k of ['cart', 'grid', 'new']) assert.ok(LABELS.en[th.copy[k]], `${th.id} copy.${k}`);
  }
});

test('theme tokens → CSS variables: accent override, readable text on the brand colour, dark themes lift dark accents', () => {
  const v = themeVars(THEMES.grocery, {});
  assert.equal(v['--st-brand'], '#0c8a43');
  assert.equal(v['--st-brand-ink'], '#ffffff');
  assert.match(v['--st-font-h'], /Baloo 2/);
  assert.equal(themeVars(THEMES.grocery, { accent: '#ffd23f' })['--st-brand-ink'], '#111111', 'dark text on yellow');
  assert.equal(themeVars(THEMES.grocery, { accent: 'red' })['--st-brand'], '#0c8a43', 'a bad accent is ignored');
  assert.match(themeVars(THEMES.grocery, { font: 'tech' })['--st-font-h'], /Space Grotesk/);
  // classic keeps the store's old brand colour; other themes use their own unless the seller overrides
  assert.equal(themeVars(THEMES.classic, {}, '#aa5500')['--st-brand'], '#aa5500');
  assert.equal(themeVars(THEMES.fashion, {}, '#aa5500')['--st-brand'], '#1b1a17');
  const dark = themeVars(THEMES.electronics, { accent: '#111827' });
  assert.ok(contrast(dark['--st-brand'], THEMES.electronics.tokens.bg) >= 2.6, 'a near-black accent is lifted on the dark theme');
  assert.equal(inkOn('#000000'), '#ffffff');
});

test('fonts, sections and hero layout', () => {
  assert.equal(fontHref('friendly'), 'https://fonts.googleapis.com/css2?family=Baloo+2:wght@600;700;800&family=Mukta:wght@400;500;700&display=swap');
  assert.equal(fontHref('modern'), 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');
  assert.deepEqual(sectionsOf(THEMES.beauty, {}), THEMES.beauty.sections);
  assert.deepEqual(sectionsOf(THEMES.beauty, { sections: ['hero', 'bogus', 'trust'] }), ['hero', 'trust', 'grid'], 'all products are always there');
  assert.equal(heroOf(THEMES.fashion, {}), 'editorial');
  assert.equal(heroOf(THEMES.fashion, { hero: 'split' }), 'split');
  assert.equal(heroOf(THEMES.fashion, { hero: 'nope' }), 'editorial');
});

test('labels in Hindi fall back to English; catalogue helpers', () => {
  assert.equal(label('hi', 'addToCart'), 'कार्ट में डालें');
  assert.equal(label('hi', 'onlyLeft', { n: 3 }), 'सिर्फ़ 3 बचे');
  assert.equal(label('xx', 'viewCart'), 'View cart');
  for (const k of Object.keys(LABELS.en)) assert.ok(LABELS.hi[k], `Hindi label for ${k}`);
  assert.equal(offPct(750, 1000), 25);
  assert.equal(offPct(1000, null), 0);
  const L = [{ id: 'a', category: 'Cleanse', price: 300, highlights: ['x'] }, { id: 'b', category: 'Treat', price: 500, highlights: ['y', 'z'] }, { id: 'c', category: 'Treat', price: 700, highlights: ['q'] }, { id: 'd', category: 'Moisturise', price: 400, soldOut: true }];
  assert.deepEqual(bundleOf(L, ['Cleanse', 'Treat', 'Moisturise']).map((l) => l.id), ['a', 'b']);
  assert.deepEqual(compareSet(L, ['Cleanse', 'Treat']).items.map((l) => l.id), ['b', 'c']);
  assert.equal(cartTotal([{ id: 'a', qty: 2 }, { id: 'gone', qty: 1 }], { a: { price: 300, kind: 'physical' } }), 600);
  assert.equal(catIcon('Fruits & Veg'), '🥦');
  assert.equal(waLink('+91 98765 43210', 'Hi there'), 'https://wa.me/919876543210?text=Hi%20there');
});
