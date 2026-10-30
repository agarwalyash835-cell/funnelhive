// Classic — the original clean store: white, the seller's brand colour, Inter. Fits any business.
export default {
  id: 'classic', name: 'Classic', industry: 'Any business', blurb: 'Clean and simple — your brand colour on white.',
  font: 'modern', useStoreColor: true,
  tokens: { brand: '#6366f1', bg: '#fafafc', surface: '#ffffff', ink: '#16161d', soft: '#6b6b78', line: '#e7e7ee', sale: '#16a34a', radius: '14px', radiusSm: '10px', shadow: '0 1px 2px rgba(16,16,29,.04)' },
  layout: { header: 'simple', hero: 'minimal', cats: 'chips', card: 'classic', product: 'split', footer: 'simple' },
  sections: ['hero', 'grid', 'trust'],
  copy: { cart: 'cart', grid: 'allProducts', new: 'newArrivals' },
  demo: null,
};
