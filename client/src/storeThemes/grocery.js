// Kirana — grocery & daily needs. Dense and fast: mint-white background, leaf-green brand with a turmeric-yellow
// second colour, rounded Baloo 2 + Mukta (both read well in Hindi), icon category tiles, compact cards with quick
// − / + steppers, a delivery strip and an offers rail.
export default {
  id: 'grocery', name: 'Kirana', industry: 'Grocery & kirana', blurb: 'Dense and quick — category tiles, quick add, delivery and offers up top.',
  font: 'friendly',
  tokens: { brand: '#0c8a43', accent2: '#ffc83d', bg: '#f3f7f2', surface: '#ffffff', ink: '#14261b', soft: '#5d6b62', line: '#e1e9e2', sale: '#0c8a43', radius: '14px', radiusSm: '10px', shadow: '0 1px 3px rgba(20,38,27,.08)', gap: '10px' },
  layout: { header: 'search', hero: 'banner', cats: 'tiles', card: 'compact', product: 'split', footer: 'simple' },
  sections: ['delivery', 'categories', 'offers', 'hero', 'new', 'grid', 'trust'],
  copy: { cart: 'cart', grid: 'allProducts', new: 'bestsellers' },
  demo: 'demo-grocery',
};
