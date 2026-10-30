// Solo — a D2C single-brand site. One hero product up front: warm cream with a vivid terracotta brand and peach,
// Poppins throughout (Devanagari too), big rounded blocks, a product spotlight hero you can buy from, benefit
// blocks, how it works, "us vs regular", a testimonial strip and a subscribe-and-save note.
export default {
  id: 'brand', name: 'Solo', industry: 'D2C brand (one hero product)', blurb: 'Brand-site feel — hero product, benefits, how it works, vs regular, reviews.',
  font: 'bold',
  tokens: { brand: '#e2552d', accent2: '#ffd9a8', bg: '#fbf7f2', surface: '#ffffff', ink: '#1c1410', soft: '#6f6259', line: '#efe6dc', sale: '#1f8a4c', radius: '22px', radiusSm: '14px', shadow: '0 12px 32px -18px rgba(60,30,10,.35)' },
  layout: { header: 'simple', hero: 'spotlight', cats: 'chips', card: 'clean', product: 'split', footer: 'columns' },
  sections: ['hero', 'benefits', 'steps', 'versus', 'reviews', 'grid', 'trust', 'about'],
  notes: [{ k: 'subscribeNote', perk: 'subscribe' }],
  copy: { cart: 'cart', grid: 'shopRange', new: 'bestsellers' },
  demo: 'demo-brand',
};
