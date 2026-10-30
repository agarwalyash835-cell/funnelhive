// Storefront themes — what the server needs to know about them: the ids it accepts and how a store's theme
// options are cleaned. The look itself (tokens, layouts, sections) lives in client/src/storeThemes/; these lists
// must match it (client/test/store-themes.test.mjs checks they do).
// No imports: the client's tests import this file directly.

export const THEME_IDS = ['classic', 'fashion', 'grocery', 'beauty', 'electronics', 'jewellery', 'home', 'bakery', 'pharmacy', 'books',
  'toys', 'sports', 'hardware', 'crafts', 'brand'];
export const FONT_IDS = ['modern', 'editorial', 'friendly', 'soft', 'tech', 'elegant', 'regal', 'warm', 'rounded', 'clinical', 'bookish',
  'athletic', 'industrial', 'heritage', 'bold'];
export const HERO_IDS = ['editorial', 'split', 'banner', 'minimal', 'spotlight'];
export const SECTION_IDS = ['hero', 'delivery', 'offers', 'categories', 'new', 'lookbook', 'bundles', 'compare', 'grid', 'trust', 'about',
  'promise', 'assist', 'room', 'filters', 'story', 'quote', 'benefits', 'steps', 'versus', 'reviews'];
export const PERK_IDS = ['freeDelivery', 'fastDelivery', 'returns7', 'exchange', 'warranty', 'emi', 'authentic', 'crueltyFree', 'fresh', 'handmade',
  'hallmark', 'certified', 'installation', 'licensed', 'bakedFresh',
  'bis', 'giftWrap', 'heatReady', 'monsoonReady', 'gstInvoice', 'bulkRates', 'handloom', 'subscribe'];
export const POLICY_KEYS = ['refund', 'shipping', 'terms', 'privacy'];

// a sentence's likely industry, for when the AI names no theme (or one we don't have)
const HINTS = [
  // checked first: their words would otherwise be caught by broader ones below ("decoration" → ration, "mithai" …)
  ['crafts', /handicraft|handloom|artisan|ajrakh|bandhani|bandhej|chikankari|madhubani|kalamkari|ikat|dhokra|pashmina|हस्तशिल्प|हथकरघा/i],
  ['jewellery', /jewel|jewell?ery|jewelry|\bgold\b|silver|diamond|ornament|kundan|polki|mangalsutra|bangle|earring|jhumka|gehne|ज्वेल|गहन|सोन/i],
  ['home', /furniture|d[eé]cor|home ?furnish|interior|sofa|lamp|rug|carpet|curtain|cushion|bedsheet|wardrobe|teak|फ़र्नीचर|फर्नीचर/i],
  ['bakery', /baker|bakery|cake|pastr|cookie|sweet ?shop|sweets|mithai|halwai|laddoo|ladoo|hamper|मिठाई|केक|बेकरी/i],
  ['pharmacy', /pharma|chemist|medical store|medicine|medicos|drug ?store|surgical|दवा|मेडिकल/i],
  ['books', /\bbooks?\b|bookstore|book ?shop|stationer|novel|notebook|school ?supplies|publisher|किताब|पुस्तक/i],
  ['hardware', /hardware|\btools?\b|cement|\btmt\b|plumbing|sanitary|building material|construction|\bpaints?\b|electricals|\bpipes?\b|sariya|सरिया|सीमेंट|हार्डवेयर/i],
  ['toys', /\btoys?\b|kids|children|baby|infant|khilon|खिलौन|बच्च/i],
  ['sports', /sport|fitness|gym|cricket|football|badminton|yoga|athlet|running|cycling|dumbbell|खेल|फिटनेस/i],
  ['grocery', /kirana|grocer|grocery|ration|atta|dal|masala|vegetable|sabzi|fruit|dairy|doodh|provision|supermarket|किराना|राशन|सब्ज़ी|सब्जी/i],
  ['beauty', /beauty|skin|skincare|cosmetic|makeup|serum|cream|hair ?care|salon|soap|ayurved|सौंदर्य|स्किन/i],
  ['electronics', /electronic|mobile|phone|laptop|gadget|charger|earbud|headphone|speaker|accessor|repair|smart ?watch|मोबाइल/i],
  ['brand', /\bd2c\b|direct.to.consumer|one product|single product|our (own )?brand|hero product|subscription/i],
  ['fashion', /fashion|cloth|apparel|kurta|kurti|saree|sari|lehenga|dress|tshirt|t-shirt|jeans|ethnic|boutique|footwear|shoe|कपड़|साड़ी|कुर्ता/i],
];
export const guessTheme = (text) => (HINTS.find(([, re]) => re.test(String(text || ''))) || ['classic'])[0];

const clip = (v, n) => String(v ?? '').replace(/[<>]/g, '').trim().slice(0, n);
const HEX = /^#[0-9a-fA-F]{6}$/;
const imgOk = (u) => /^(https:\/\/|\/uploads\/)[^\s"'<>]{1,500}$/.test(String(u || ''));
const list = (v, n, len) => [...new Set((Array.isArray(v) ? v : []).map((x) => clip(x, len)).filter(Boolean))].slice(0, n);

// A store's theme options → the cleaned object, or { error } (lenient: what's wrong is dropped instead — for AI drafts)
export function cleanThemeOptions(b = {}, { lenient = false } = {}) {
  const o = {};
  const bad = (msg) => (lenient ? null : { error: msg });
  b = b && typeof b === 'object' ? b : {};
  if ('accent' in b) { const c = clip(b.accent, 9); if (c && !HEX.test(c)) { const e = bad('Accent colour is a hex colour like #0c8a43'); if (e) return e; } else o.accent = c; }
  if ('font' in b) { const f = clip(b.font, 20); if (f && !FONT_IDS.includes(f)) { const e = bad('Choose one of the font pairs'); if (e) return e; } else o.font = f; }
  if ('hero' in b) { const h = clip(b.hero, 20); if (h && !HERO_IDS.includes(h)) { const e = bad('Choose one of the hero layouts'); if (e) return e; } else o.hero = h; }
  if ('heroImage' in b) { const u = String(b.heroImage || ''); if (u && !imgOk(u)) { const e = bad('The banner must be an uploaded image'); if (e) return e; } else o.heroImage = u; }
  for (const [k, n] of [['announcement', 140], ['heroTitle', 90], ['heroText', 240], ['heroCta', 30], ['deliveryNote', 120], ['credentials', 120]]) if (k in b) o[k] = clip(b[k], n);
  if ('sections' in b) o.sections = list(b.sections, SECTION_IDS.length, 20).filter((s) => SECTION_IDS.includes(s));
  if ('perks' in b) o.perks = list(b.perks, 6, 20).filter((s) => PERK_IDS.includes(s));
  if ('offers' in b) {
    o.offers = (Array.isArray(b.offers) ? b.offers : []).slice(0, 6).map((x) => ({ title: clip(x?.title, 60), note: clip(x?.note, 80), code: clip(x?.code, 20).toUpperCase().replace(/[^A-Z0-9_-]/g, '') })).filter((x) => x.title);
  }
  // how it works (D2C) and testimonials — the seller's own words; the AI never writes testimonials (store-ai.js)
  if ('steps' in b) o.steps = (Array.isArray(b.steps) ? b.steps : []).slice(0, 4).map((x) => ({ title: clip(x?.title, 60), note: clip(x?.note, 140) })).filter((x) => x.title);
  if ('reviews' in b) o.reviews = (Array.isArray(b.reviews) ? b.reviews : []).slice(0, 6).map((x) => ({ name: clip(x?.name, 40), place: clip(x?.place, 40), text: clip(x?.text, 240) })).filter((x) => x.name && x.text);
  if ('lang' in b) o.lang = b.lang === 'hi' ? 'hi' : 'en';
  if ('whatsapp' in b) o.whatsapp = b.whatsapp !== false;
  if ('seo' in b) o.seo = { title: clip(b.seo?.title, 70), description: clip(b.seo?.description, 170) };
  return o;
}

// Policy pages written on the store (the AI drafts them; a draft isn't shown to buyers until the seller reviews it)
export function cleanPolicyPages(b = {}, cur = {}) {
  const out = {};
  for (const k of POLICY_KEYS) {
    const p = b?.[k];
    if (p === undefined) { if (cur[k]) out[k] = cur[k]; continue; }
    const text = String((typeof p === 'string' ? p : p?.text) ?? '').replace(/<[^>]*>/g, '').trim().slice(0, 8000);
    if (text) out[k] = { text, draft: typeof p === 'object' ? p.draft !== false : true, at: Date.now() };
  }
  return out;
}

// extra listing fields themes show: spec / benefit highlights, sizes (shown, not chosen at checkout), a badge, a byline, diet,
// tags (age group, craft, region… — the themes' quick filters) and the maker ("Khatri family, Ajrakhpur")
export function cleanListingExtras(b, out) {
  if ('highlights' in b) out.highlights = list(b.highlights, 6, 40);
  if ('sizes' in b) out.sizes = list(b.sizes, 12, 10);
  if ('badge' in b) out.badge = clip(b.badge, 20);
  // a line under the title (author · publisher, salt and strength, purity · weight) and the FSSAI veg / non-veg mark
  if ('byline' in b) out.byline = clip(b.byline, 80);
  if ('diet' in b) out.diet = ['veg', 'nonveg'].includes(b.diet) ? b.diet : '';
  if ('tags' in b) out.tags = list(b.tags, 6, 24);
  if ('maker' in b) out.maker = clip(b.maker, 80);
  return out;
}
