// Kaarigar — handicrafts & ethnic wear. Rich Indian heritage: handmade-paper cream, indigo ink, madder-red brand
// and ochre, Rozha One with Martel Sans (both Devanagari), a block-print border motif, a jharokha-arched hero,
// craft filters (Ajrakh, Bandhani, Chikankari, Madhubani…), cards with the craft and its maker, a handloom mark,
// and a "meet the makers" strip.
export default {
  id: 'crafts', name: 'Kaarigar', industry: 'Handicrafts & ethnic wear', blurb: 'Heritage colours — artisan stories, craft and region tags, handloom mark.',
  font: 'heritage',
  tokens: { brand: '#9b2c2c', accent2: '#e0a33a', bg: '#f6efe3', surface: '#fffaf2', ink: '#1f2550', soft: '#6b6150', line: '#e6d9c2', sale: '#2f6b3a', radius: '6px', radiusSm: '4px', shadow: '0 1px 0 #e6d9c2' },
  layout: { header: 'soft', hero: 'split', cats: 'chips', card: 'craft', product: 'split', footer: 'columns' },
  sections: ['hero', 'filters', 'story', 'new', 'grid', 'trust', 'about'],
  filters: { title: 'shopByCraft', values: ['Ajrakh', 'Bandhani', 'Chikankari', 'Madhubani', 'Block print', 'Kalamkari', 'Ikat', 'Dhokra'] },
  notes: [{ k: 'handloomNote', tag: 'Handloom' }, { k: 'handmadeNote', perk: 'handmade' }],
  copy: { cart: 'bag', grid: 'allCrafts', new: 'newArrivals' },
  demo: 'demo-crafts',
};
