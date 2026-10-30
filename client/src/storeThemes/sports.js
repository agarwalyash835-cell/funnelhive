// Turf — sports & fitness. Dark and energetic: near-black with an acid-lime brand and a hot-orange second colour,
// Teko (condensed, athletic, Devanagari) with Hind, uppercase labels, sharp 4px corners, a full-bleed hero with huge
// slanted type, big image blocks for each sport, cards with a size strip, a size-guide note and a
// "built for Indian conditions" promise row.
export default {
  id: 'sports', name: 'Turf', industry: 'Sports & fitness', blurb: 'Bold and dark — sport blocks, size guide, built for Indian conditions.',
  font: 'athletic',
  tokens: { brand: '#c6ff00', accent2: '#ff6b00', bg: '#0b0c0e', surface: '#16181c', ink: '#f4f5f6', soft: '#9aa1ab', line: '#272b32', sale: '#c6ff00', radius: '4px', radiusSm: '4px', shadow: '0 0 0 1px #272b32', dark: true, upper: true },
  layout: { header: 'center', hero: 'editorial', cats: 'blocks', card: 'sport', product: 'split', footer: 'columns' },
  sections: ['hero', 'categories', 'new', 'grid', 'trust', 'about'],
  notes: [{ k: 'sizeGuide', sizes: true }],
  copy: { cart: 'cart', grid: 'allGear', new: 'trending', trust: 'builtFor' },
  demo: 'demo-sports',
};
