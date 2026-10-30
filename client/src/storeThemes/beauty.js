// Glow — beauty & skincare. Soft premium: blush background, deep plum ink, a dusty-rose brand, Cormorant Garamond
// with Manrope, generous pill radii and soft shadows, arch-shaped hero picture, round category bubbles, cards with
// ingredient / benefit chips and ratings, and a three-step routine bundle.
export default {
  id: 'beauty', name: 'Glow', industry: 'Beauty & skincare', blurb: 'Soft and premium — ingredient chips, ratings, routine bundles.',
  font: 'soft',
  tokens: { brand: '#a4506b', accent2: '#e9cfc4', bg: '#fbf5f2', surface: '#ffffff', ink: '#2e1f27', soft: '#7d6a72', line: '#f0e2dc', sale: '#a4506b', radius: '22px', radiusSm: '999px', shadow: '0 10px 30px -12px rgba(120,60,80,.18)' },
  layout: { header: 'soft', hero: 'split', cats: 'circles', card: 'soft', product: 'soft', footer: 'columns' },
  sections: ['hero', 'categories', 'new', 'bundles', 'grid', 'trust', 'about'],
  copy: { cart: 'bag', grid: 'allProducts', new: 'bestsellers' },
  demo: 'demo-beauty',
};
