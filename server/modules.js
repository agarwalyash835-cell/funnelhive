// Industry modules: the tools that only some businesses need (orders, products, a store, courses, quotes, affiliates,
// bookings, webinars). An account's CRM style (its industry) decides which of them it sees; the rest are hidden from
// its menu — not just tucked under "More tools" — unless:
//   - the platform admin (Admin / super admin panel) or the account's agency switched it on for the account (modulesOn),
//   - its agency put it in the menu it sets for all its clients (clientMenu),
//   - or the account already uses it (it has data there), so nothing it relies on disappears.
// Accounts with no CRM style yet, or an AI-designed one, see every tool. Add-ons (Tally, Inventory, Studio) are
// switched on per account already and aren't covered here.
import { T, q } from './db.js';

export const MODULES = {
  '/orders': 'Orders', '/products': 'Products', '/store': 'Store', '/school': 'School (courses)', '/quotes': 'Quotes',
  '/affiliates': 'Affiliates', '/bookings': 'Bookings', '/webinars': 'Webinars',
};
// per CRM style (crmkits.js ids): the industry modules it uses
export const INDUSTRY_MODULES = {
  general: ['/orders', '/products', '/store', '/school', '/quotes', '/affiliates', '/bookings', '/webinars'],
  realestate: ['/orders', '/quotes', '/affiliates', '/bookings'],
  clinic: ['/orders', '/products', '/bookings'],
  consultant: ['/orders', '/products', '/quotes', '/bookings', '/webinars'],
  education: ['/orders', '/products', '/school', '/bookings', '/webinars'],
  fitness: ['/orders', '/products', '/store', '/school', '/bookings'],
  finance: ['/orders', '/quotes', '/bookings', '/webinars'],
  interior: ['/orders', '/quotes', '/bookings'],
  events: ['/orders', '/quotes', '/bookings'],
  travel: ['/orders', '/products', '/quotes', '/bookings'],
  auto: ['/orders', '/quotes', '/bookings'],
  professional: ['/orders', '/quotes', '/bookings'],
  recruitment: ['/quotes', '/bookings'],
  homeservices: ['/orders', '/quotes', '/bookings'],
  hospitality: ['/orders', '/products', '/store', '/bookings'],
  store: ['/orders', '/products', '/store', '/affiliates', '/quotes'],
  manufacturer: ['/orders', '/products', '/quotes'],
  retailer: ['/orders', '/products', '/store', '/quotes'],
  distributor: ['/orders', '/products', '/quotes'],
  abroad: ['/orders', '/quotes', '/bookings', '/webinars'],
  wellness: ['/orders', '/products', '/store', '/school', '/bookings', '/webinars'],
  saas: ['/orders', '/products', '/quotes', '/affiliates', '/bookings', '/webinars'],
  ngo: ['/orders', '/products', '/webinars'],
};

export const cleanModules = (pages) => [...new Set((Array.isArray(pages) ? pages : []).filter((p) => MODULES[p]))];

// the modules this account already has data in
function usedModules(u) {
  const has = (sql) => !!q(sql).get(u.id);
  return new Set([
    T.orders.exists({ userId: u.id }) && '/orders',
    T.products.exists({ userId: u.id }) && '/products',
    has("SELECT 1 FROM products WHERE userId = ? AND json_array_length(json_extract(data, '$.lessons')) > 0 LIMIT 1") && '/school', // a course
    T.stores.exists({ userId: u.id }) && '/store',
    T.quotes.exists({ userId: u.id }) && '/quotes',
    T.affiliates.exists({ userId: u.id }) && '/affiliates',
    T.bookings.exists({ userId: u.id }) && '/bookings',
    T.webinars.exists({ userId: u.id }) && '/webinars',
  ].filter(Boolean));
}

// → { industry, modules: [{ page, label, industry: bool, on: bool, used: bool, shown: bool }] } (industry null: all shown)
export function moduleView(u) {
  const industry = u?.settings?.crmKit?.id || null;
  const fits = INDUSTRY_MODULES[industry];
  const on = new Set(cleanModules(u?.modulesOn));
  const agencyMenu = new Set((u?.agencyId && T.users.get(u.agencyId)?.settings?.clientMenu) || []);
  const used = fits ? usedModules(u) : new Set();
  return {
    industry: fits ? industry : null,
    modules: Object.entries(MODULES).map(([page, label]) => {
      const byIndustry = !fits || fits.includes(page);
      return { page, label, industry: byIndustry, on: on.has(page), used: used.has(page), agency: agencyMenu.has(page), shown: byIndustry || on.has(page) || agencyMenu.has(page) || used.has(page) };
    }),
  };
}
// the pages this account's menu leaves out
export const hiddenModules = (u) => moduleView(u).modules.filter((m) => !m.shown).map((m) => m.page);
