// Aangan — home décor & furniture. Warm and roomy: sand and clay with an olive second colour, Fraunces (a soft
// old-style serif) over Hind, big landscape (4:3) pictures, material and size under each name, an EMI pill, a
// "shop the room" collage with numbered pins, a delivery-and-installation strip and badges (EMI, installation).
export default {
  id: 'home', name: 'Aangan', industry: 'Home décor & furniture', blurb: 'Warm and roomy — shop the room, sizes and materials, EMI and installation.',
  font: 'warm',
  tokens: { brand: '#8a4b2a', accent2: '#6d7a4f', bg: '#f4eee5', surface: '#fffaf2', ink: '#2b2420', soft: '#77695c', line: '#e4d8c7', sale: '#6d7a4f', radius: '8px', radiusSm: '6px', shadow: '0 1px 2px rgba(43,36,32,.06)', gap: '18px' },
  layout: { header: 'bar', hero: 'editorial', cats: 'portrait', card: 'room', product: 'table', footer: 'columns' },
  sections: ['hero', 'delivery', 'categories', 'room', 'promise', 'new', 'grid', 'assist', 'about'],
  copy: { cart: 'cart', grid: 'allPieces', new: 'newArrivals', cats: 'byRoom' },
  assist: { title: 'decorAssist', actions: ['sendPhoto'] },
  demo: 'demo-home',
};
