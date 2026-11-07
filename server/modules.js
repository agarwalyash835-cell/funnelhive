// Industry modules: the tools that only some businesses need (orders, products, a store, courses, quotes, affiliates,
// bookings, webinars, and the Tally / Inventory / Counter add-ons). An account's CRM style (its industry) decides which
// of them it sees; the rest are hidden from its menu — not just tucked under "More tools" — unless the platform admin
// (Admin / super admin panel) or the account's agency switched one on for it (modulesOn), or its agency put it in the
// menu it sets for its clients (clientMenu). Switching industry changes the menu at once; data in a hidden tool is kept
// and comes back with the tool. Accounts with no CRM style yet, or an AI-designed one, see every tool. The add-ons
// still need switching on for the account as well (tally / inventory in /me).
import { T, q } from './db.js';

export const MODULES = {
  '/orders': 'Orders', '/products': 'Products', '/store': 'Store', '/school': 'School (courses)', '/quotes': 'Quotes',
  '/affiliates': 'Affiliates', '/bookings': 'Bookings', '/webinars': 'Webinars',
  '/tally': 'Tally', '/inventory': 'Inventory', '/counter': 'Counter mode',
};
// per CRM style (crmkits.js ids): the industry modules it uses
export const INDUSTRY_MODULES = {
  general: ['/orders', '/products', '/school', '/affiliates', '/bookings', '/webinars'],
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
  hospitality: ['/orders', '/products', '/store', '/bookings', '/inventory'],
  store: ['/orders', '/products', '/store', '/affiliates', '/quotes', '/inventory', '/counter', '/tally'],
  manufacturer: ['/orders', '/products', '/quotes', '/tally', '/inventory'],
  retailer: ['/orders', '/products', '/store', '/quotes', '/tally', '/inventory', '/counter'],
  distributor: ['/orders', '/products', '/quotes', '/tally', '/inventory'],
  abroad: ['/orders', '/quotes', '/bookings', '/webinars'],
  wellness: ['/orders', '/products', '/store', '/school', '/bookings', '/webinars'],
  saas: ['/orders', '/products', '/quotes', '/affiliates', '/bookings', '/webinars'],
  ngo: ['/orders', '/products', '/webinars'],
  lab: ['/orders', '/products', '/store', '/bookings', '/inventory', '/counter'],
  jewellery: ['/orders', '/products', '/store', '/quotes', '/bookings', '/tally', '/inventory', '/counter'],
  school: ['/orders', '/products', '/bookings', '/webinars'],
  pg: ['/orders', '/quotes', '/bookings'],
  agri: ['/orders', '/products', '/quotes', '/bookings', '/tally', '/inventory', '/counter'],
  caterer: ['/orders', '/products', '/store', '/quotes', '/bookings', '/inventory'],
  franchise: ['/orders', '/quotes', '/bookings', '/webinars'],
  movers: ['/orders', '/quotes', '/bookings'],
  matrimony: ['/orders', '/products', '/bookings'],
  loans: ['/orders', '/quotes', '/bookings'],
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
  const used = fits ? usedModules(u) : new Set(); // shown in Admin ("has data") — it no longer keeps a tool in the menu
  return {
    industry: fits ? industry : null,
    modules: Object.entries(MODULES).map(([page, label]) => {
      const byIndustry = !fits || fits.includes(page);
      return { page, label, industry: byIndustry, on: on.has(page), used: used.has(page), agency: agencyMenu.has(page), shown: byIndustry || on.has(page) || agencyMenu.has(page) };
    }),
  };
}
// the pages this account's menu leaves out
export const hiddenModules = (u) => moduleView(u).modules.filter((m) => !m.shown).map((m) => m.page);
