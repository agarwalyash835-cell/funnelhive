// Atelier — fashion & apparel. Editorial: warm paper background, ink-black type, a high-contrast Bodoni serif with
// Jost, square corners, no shadows, full-bleed photography, portrait (3:4) cards with size chips, a lookbook strip.
export default {
  id: 'fashion', name: 'Atelier', industry: 'Fashion & apparel', blurb: 'Editorial and image-led — big pictures, size chips, a lookbook.',
  font: 'editorial',
  tokens: { brand: '#1b1a17', accent2: '#b4532a', bg: '#f6f2ec', surface: '#fffdfa', ink: '#1b1a17', soft: '#6f685f', line: '#e4ddd2', sale: '#b4532a', radius: '0px', radiusSm: '0px', shadow: 'none', upper: true },
  layout: { header: 'center', hero: 'editorial', cats: 'portrait', card: 'editorial', product: 'stack', footer: 'columns' },
  sections: ['hero', 'categories', 'new', 'lookbook', 'grid', 'trust', 'about'],
  copy: { cart: 'bag', grid: 'allStyles', new: 'justDropped' },
  demo: 'demo-fashion',
};
