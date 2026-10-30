// Panna — books & stationery. Bookish and editorial: paper cream, oxblood with a mustard second colour, Tiro
// Devanagari Hindi (a book face in both scripts) over Literata, ruled section heads, 3:4 covers with a spine shadow
// and the author under the title. A big-type text hero, shelf chips, a school-list bundle and a bulk / institution
// enquiry panel on WhatsApp.
export default {
  id: 'books', name: 'Panna', industry: 'Books & stationery', blurb: 'Bookish and editorial — covers and authors, school-list bundles, bulk enquiries.',
  font: 'bookish', portrait: true,
  tokens: { brand: '#7b2d26', accent2: '#c9952b', bg: '#f6f1e7', surface: '#fffcf5', ink: '#1f1a14', soft: '#6b6155', line: '#e2d8c5', sale: '#7b2d26', radius: '3px', radiusSm: '3px', shadow: 'none' },
  layout: { header: 'center', hero: 'minimal', cats: 'chips', card: 'book', product: 'table', footer: 'columns' },
  sections: ['hero', 'categories', 'new', 'bundles', 'grid', 'assist', 'about'],
  copy: { cart: 'bag', grid: 'allBooks', new: 'newReleases', cats: 'browseShelves', bundle: 'schoolList' },
  assist: { title: 'bulkAssist', actions: ['bulkEnquiry'] },
  demo: 'demo-books',
};
