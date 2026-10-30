// Volt — electronics & mobiles. Dark and technical: near-black graphite, electric-blue brand with a cyan second
// colour, Space Grotesk with Inter, a glowing gradient banner, a category rail, spec cards (highlights as a spec list,
// EMI / warranty badges), a compare table and a spec-sheet product page.
export default {
  id: 'electronics', name: 'Volt', industry: 'Electronics & mobiles', blurb: 'Dark and techy — spec highlights, compare, EMI and warranty badges.',
  font: 'tech',
  tokens: { brand: '#3b82f6', accent2: '#22d3ee', bg: '#0b0d12', surface: '#141821', ink: '#e8ecf4', soft: '#8b94a7', line: '#232a37', sale: '#34d399', radius: '14px', radiusSm: '10px', shadow: '0 0 0 1px #232a37', dark: true },
  layout: { header: 'bar', hero: 'banner', cats: 'rail', card: 'spec', product: 'tech', footer: 'columns' },
  sections: ['hero', 'categories', 'new', 'compare', 'grid', 'trust', 'about'],
  copy: { cart: 'cart', grid: 'allProducts', new: 'trending' },
  demo: 'demo-electronics',
};
