// Mithaas — bakery & sweets. Appetising and playful: warm cream, strawberry-clay brand with a honey-saffron second
// colour, rounded Fredoka over Mukta (Devanagari), soft blobs and pill buttons. The order-by-6-pm delivery strip
// with a PIN-code check comes first; cards carry the FSSAI veg / non-veg mark and the weight; a festive-hamper
// bundle and a custom-cake WhatsApp panel.
export default {
  id: 'bakery', name: 'Mithaas', industry: 'Bakery & sweets', blurb: 'Warm and playful — veg marks, an order-by cut-off, festive hampers, custom cakes.',
  font: 'rounded',
  tokens: { brand: '#c2452d', accent2: '#f3b33d', bg: '#fff7ee', surface: '#ffffff', ink: '#3b1f14', soft: '#7d5b4b', line: '#f2e0cd', sale: '#2f8a3e', radius: '22px', radiusSm: '999px', shadow: '0 8px 22px -14px rgba(59,31,20,.35)', gap: '14px' },
  layout: { header: 'soft', hero: 'banner', cats: 'circles', card: 'treat', product: 'split', footer: 'simple' },
  sections: ['delivery', 'hero', 'categories', 'new', 'bundles', 'grid', 'assist', 'promise', 'about'],
  copy: { cart: 'cart', grid: 'allTreats', new: 'freshToday', bundle: 'buildHamper' },
  assist: { title: 'cakeAssist', actions: ['customCake'] },
  demo: 'demo-bakery',
};
