// Forge — hardware, tools & building materials. Rugged and industrial: steel grey with charcoal and safety yellow,
// Rajdhani with Mukta (both Devanagari), square corners, hazard-stripe accents, a searchable header, dense list
// cards with spec tables and units (per bag / per kg), a bulk & contractor quote band (WhatsApp) and a spec-sheet
// product page.
export default {
  id: 'hardware', name: 'Forge', industry: 'Hardware & building materials', blurb: 'Rugged and dense — spec tables, per-unit prices, bulk quotes on WhatsApp.',
  font: 'industrial',
  tokens: { brand: '#1f2328', accent2: '#ffc20e', bg: '#eceef1', surface: '#ffffff', ink: '#1a1d21', soft: '#5f6670', line: '#d5d9de', sale: '#2f9e44', radius: '6px', radiusSm: '4px', shadow: '0 1px 0 #d5d9de', gap: '10px', upper: true },
  layout: { header: 'bar', hero: 'banner', cats: 'tiles', card: 'dense', product: 'sheet', footer: 'columns' },
  sections: ['hero', 'categories', 'quote', 'grid', 'trust', 'about'],
  notes: [{ k: 'bulkNote' }],
  copy: { cart: 'cart', grid: 'allMaterials', new: 'bestsellers' },
  demo: 'demo-hardware',
};
