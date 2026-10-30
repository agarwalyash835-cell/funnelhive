// Playbox — toys & kids. Bright and rounded: warm cream, tomato-red brand with a sunny yellow, deep-purple ink,
// Baloo 2 with Mukta (both Devanagari), chunky "toy" shadows, a confetti banner, big age-group tiles (0–2 … 9–12)
// that filter the shop, cards with age chips and a BIS safety mark, and a gift-wrap note on the product page.
export default {
  id: 'toys', name: 'Playbox', industry: 'Toys & kids', blurb: 'Bright and playful — shop by age, safety marks, free gift-wrap note.',
  font: 'friendly',
  tokens: { brand: '#ff5a36', accent2: '#ffc83d', bg: '#fffaf0', surface: '#ffffff', ink: '#2b2350', soft: '#6b6585', line: '#f1e6d6', sale: '#0ca678', radius: '24px', radiusSm: '999px', shadow: '0 5px 0 #f1e3cc', gap: '14px' },
  layout: { header: 'search', hero: 'banner', cats: 'tiles', card: 'toy', product: 'split', footer: 'columns' },
  sections: ['hero', 'filters', 'categories', 'new', 'grid', 'trust', 'about'],
  filters: { title: 'shopByAge', chip: 'ageChip', values: ['0–2', '3–5', '6–8', '9–12'] },
  notes: [{ k: 'giftNote', perk: 'giftWrap' }, { k: 'safetyNote', perk: 'bis' }],
  copy: { cart: 'cart', grid: 'allToys', new: 'bestsellers' },
  demo: 'demo-toys',
};
