// The storefront theme registry. A theme is a plain object (one file each):
//   id, name, industry, blurb      — shown in Store settings' gallery
//   font                           — a FONT_PAIRS id (tokens.js)
//   tokens                         — palette, radius, shadow, gap; dark: true for dark themes; upper: uppercase labels
//   layout { header, hero, cats, card, product, footer } — which variant of each shared section (kit.jsx) to use
//   sections                       — the home page's default section order (SECTION_NAMES in tokens.js)
//   copy { cart, grid, new }       — label keys (i18n.js) for the cart word and section titles
//                                    (optional: cats, bundle — the categories and bundle sections' titles)
//   assist { title, actions, product } (optional) — the WhatsApp help panel: label keys for its title (+Sub), its
//                                    buttons (+Wa: the first message) and the one shown on product pages
//   note (optional)                — a label key shown as a hint on product pages
//   portrait (optional)            — 3:4 product pictures (fashion always; books)
//   demo                           — the handle of its live demo store (server/store-demos.js), or null
// Adding an industry: a new file here, register it below, its id in server/store-themes.js THEME_IDS, any new
// variants in kit.jsx + storeThemes.css (scoped .th-<id>), and a demo catalogue in server/store-demos.js.
import classic from './classic.js';
import fashion from './fashion.js';
import grocery from './grocery.js';
import beauty from './beauty.js';
import electronics from './electronics.js';
import jewellery from './jewellery.js';
import home from './home.js';
import bakery from './bakery.js';
import pharmacy from './pharmacy.js';
import books from './books.js';

export const THEMES = { classic, fashion, grocery, beauty, electronics, jewellery, home, bakery, pharmacy, books };
export const THEME_LIST = [fashion, grocery, beauty, electronics, jewellery, home, bakery, pharmacy, books, classic];
export const themeOf = (id) => THEMES[id] || classic;
