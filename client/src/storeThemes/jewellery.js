// Swarna — jewellery. Luxe and quiet: ivory paper, deep emerald with an antique-gold second colour, the light Martel
// serif (Latin + Devanagari) over Poppins, hairline gold rules, lots of air. Occasion circles ringed in gold, cards
// with purity · weight under the name, a hallmark / certified badge strip and a "see it on a video call / try at
// home" WhatsApp panel (also on every product page). Product page: a details table (purity, weight, stones).
export default {
  id: 'jewellery', name: 'Swarna', industry: 'Jewellery', blurb: 'Luxe and airy — purity and weight up front, hallmark badges, video call and try-at-home.',
  font: 'regal',
  tokens: { brand: '#0f4d3a', accent2: '#b8893b', bg: '#fbf7ef', surface: '#fffdf8', ink: '#1c2a23', soft: '#6d6a5c', line: '#e9dfca', sale: '#0f4d3a', radius: '2px', radiusSm: '2px', shadow: 'none', upper: true, gap: '20px' },
  layout: { header: 'center', hero: 'split', cats: 'circles', card: 'luxe', product: 'table', footer: 'columns' },
  sections: ['hero', 'promise', 'categories', 'new', 'assist', 'grid', 'trust', 'about'],
  copy: { cart: 'bag', grid: 'theCollection', new: 'newDesigns', cats: 'byOccasion' },
  assist: { title: 'jewelAssist', actions: ['videoCall', 'tryHome'], product: 'videoCall' },
  demo: 'demo-jewellery',
};
