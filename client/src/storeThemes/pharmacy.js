// Arogya — pharmacy & wellness. Clean clinical trust: white and pale teal, a teal brand with a calm green second
// colour, Martel Sans over Hind (both Devanagari), crisp 1px rules. A "genuine medicines · licensed · licence no."
// strip and the WhatsApp-your-prescription panel up top, health-need tiles, cards with salt / pack under the name,
// a details table and a generic-alternative note on the product page (a hint to ask, never a medical claim).
export default {
  id: 'pharmacy', name: 'Arogya', industry: 'Pharmacy & wellness', blurb: 'Clean and trustworthy — prescriptions on WhatsApp, health-need tiles, licence shown.',
  font: 'clinical',
  tokens: { brand: '#0b7a75', accent2: '#1f9d55', bg: '#f4f9f9', surface: '#ffffff', ink: '#0f2a2e', soft: '#557079', line: '#dbe8ea', sale: '#1f9d55', radius: '12px', radiusSm: '8px', shadow: '0 1px 2px rgba(15,42,46,.06)', gap: '12px' },
  layout: { header: 'search', hero: 'minimal', cats: 'tiles', card: 'clinic', product: 'table', footer: 'columns' },
  sections: ['promise', 'assist', 'categories', 'new', 'grid', 'trust', 'about'],
  copy: { cart: 'cart', grid: 'allProducts', new: 'bestsellers', cats: 'byNeed' },
  assist: { title: 'rxAssist', actions: ['sendRx'] },
  note: 'genericHint',
  demo: 'demo-pharmacy',
};
