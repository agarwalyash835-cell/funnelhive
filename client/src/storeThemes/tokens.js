// Pure helpers for storefront themes (no React, no DOM) — tested in client/test/store-themes.test.mjs.
// A theme's design tokens + the store's options (accent, font pair, hero layout, sections) → CSS variables and
// the choices the renderer makes.

export const FONT_PAIRS = {
  modern: { name: 'Modern', heading: 'Inter', body: 'Inter', hw: '700;800', bw: '400;500;600' },
  editorial: { name: 'Editorial', heading: 'Bodoni Moda', body: 'Jost', hw: '500;600', bw: '400;500' },
  friendly: { name: 'Friendly', heading: 'Baloo 2', body: 'Mukta', hw: '600;700;800', bw: '400;500;700' },
  soft: { name: 'Soft', heading: 'Cormorant Garamond', body: 'Manrope', hw: '500;600', bw: '400;500;600' },
  tech: { name: 'Tech', heading: 'Space Grotesk', body: 'Inter', hw: '500;700', bw: '400;500;600' },
  elegant: { name: 'Elegant', heading: 'DM Serif Display', body: 'DM Sans', hw: '400', bw: '400;500;700' },
  // these five carry Devanagari in at least one face (Martel, Poppins, Hind, Mukta, Tiro Devanagari Hindi)
  regal: { name: 'Regal', heading: 'Martel', body: 'Poppins', hw: '300;700', bw: '300;400;500', serif: true },
  warm: { name: 'Warm', heading: 'Fraunces', body: 'Hind', hw: '500;600', bw: '400;500;600', serif: true },
  rounded: { name: 'Rounded', heading: 'Fredoka', body: 'Mukta', hw: '500;600;700', bw: '400;500;700' },
  clinical: { name: 'Clinical', heading: 'Martel Sans', body: 'Hind', hw: '700;800', bw: '400;500;600' },
  bookish: { name: 'Bookish', heading: 'Tiro Devanagari Hindi', body: 'Literata', hw: '400', bw: '400;500;700', serif: true },
  athletic: { name: 'Athletic', heading: 'Teko', body: 'Hind', hw: '500;600;700', bw: '400;500;600' },
  industrial: { name: 'Industrial', heading: 'Rajdhani', body: 'Mukta', hw: '600;700', bw: '400;500;700' },
  heritage: { name: 'Heritage', heading: 'Rozha One', body: 'Martel Sans', hw: '400', bw: '400;600;700' },
  bold: { name: 'Bold', heading: 'Poppins', body: 'Poppins', hw: '600;700;800', bw: '400;500' },
};
export const HERO_LAYOUTS = { editorial: 'Full-bleed picture', split: 'Text and picture side by side', banner: 'Bold banner', minimal: 'Text only', spotlight: 'One hero product' };
export const SECTION_NAMES = {
  hero: 'Hero banner', delivery: 'Delivery strip', offers: 'Offers', categories: 'Categories', new: 'New arrivals', lookbook: 'Lookbook', bundles: 'Routine bundle', compare: 'Compare', grid: 'All products', trust: 'Why buy from us', about: 'About the store',
  promise: 'Trust badges', assist: 'WhatsApp help', room: 'Shop the room',
  filters: 'Quick filters (age, craft…)', story: 'Meet the makers', quote: 'Bulk quote', benefits: 'Hero product benefits', steps: 'How it works', versus: 'Us vs regular', reviews: 'Customer reviews',
};

const stack = (f, fallback) => `'${f}', ${fallback}`;
// the Google Fonts stylesheet for a font pair (display=swap: text shows at once in the fallback font)
export function fontHref(id) {
  const p = FONT_PAIRS[id] || FONT_PAIRS.modern;
  const fam = (name, w) => `family=${name.replace(/ /g, '+')}:wght@${w}`;
  const parts = p.heading === p.body ? [fam(p.heading, [...new Set(`${p.bw};${p.hw}`.split(';'))].sort((a, b) => a - b).join(';'))] : [fam(p.heading, p.hw), fam(p.body, p.bw)];
  return `https://fonts.googleapis.com/css2?${parts.join('&')}&display=swap`;
}

// ---------- colour ----------
const HEX = /^#[0-9a-f]{6}$/i;
export const isHex = (h) => HEX.test(String(h || ''));
const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const hex = (a) => `#${a.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')}`;
// t = 0 → a, t = 1 → b
export const mix = (a, b, t) => { const x = rgb(a), y = rgb(b); return hex(x.map((v, i) => v + (y[i] - v) * t)); };
export const luminance = (h) => { const [r, g, b] = rgb(h).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
export const contrast = (a, b) => { const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
// readable text on a colour
export const inkOn = (h) => (contrast(h, '#ffffff') >= contrast(h, '#111111') ? '#ffffff' : '#111111');

// the brand colour the store uses: the seller's accent override, else the theme's own (the classic theme keeps
// the store's old "brand colour" setting)
export function brandOf(theme, opts = {}, storeColor) {
  if (isHex(opts.accent)) return opts.accent;
  if (theme.useStoreColor && isHex(storeColor)) return storeColor;
  return theme.tokens.brand;
}

// theme + options → CSS custom properties for the store's root element
export function themeVars(theme, opts = {}, storeColor) {
  const k = theme.tokens, brand = brandOf(theme, opts, storeColor);
  const f = FONT_PAIRS[opts.font] || FONT_PAIRS[theme.font] || FONT_PAIRS.modern;
  // on a dark theme a dark accent would vanish: lift it towards white until it reads
  let b = brand;
  for (let i = 0; i < 6 && contrast(b, k.bg) < 2.6; i++) b = mix(b, k.dark ? '#ffffff' : '#000000', 0.18);
  return {
    '--st-brand': b, '--st-brand-ink': inkOn(b), '--st-brand-soft': mix(b, k.bg, k.dark ? 0.8 : 0.9),
    '--st-accent2': k.accent2 || b, '--st-bg': k.bg, '--st-surface': k.surface, '--st-ink': k.ink, '--st-soft': k.soft, '--st-line': k.line,
    '--st-sale': k.sale || '#16a34a', '--st-radius': k.radius, '--st-radius-sm': k.radiusSm, '--st-shadow': k.shadow, '--st-gap': k.gap || '16px',
    '--st-font-h': stack(f.heading, f.serif || f.heading.includes('Serif') || ['Bodoni Moda', 'Cormorant Garamond', 'Rozha One'].includes(f.heading) ? 'Georgia, serif' : 'system-ui, sans-serif'),
    '--st-font-b': stack(f.body, 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif'),
    '--st-case': k.upper ? 'uppercase' : 'none', '--st-track': k.upper ? '.14em' : '0',
  };
}

export const fontOf = (theme, opts = {}) => (FONT_PAIRS[opts.font] ? opts.font : theme.font);
export const heroOf = (theme, opts = {}) => (HERO_LAYOUTS[opts.hero] ? opts.hero : theme.layout.hero);
// the home page's sections in order (the store's own order, or the theme's); 'grid' is always there
export function sectionsOf(theme, opts = {}) {
  const own = (Array.isArray(opts.sections) ? opts.sections : []).filter((s) => SECTION_NAMES[s]);
  const list = own.length ? [...new Set(own)] : theme.sections;
  return list.includes('grid') ? list : [...list, 'grid'];
}

// ---------- catalogue helpers ----------
export const offPct = (price, mrp) => (mrp > price && price >= 0 ? Math.round((1 - price / mrp) * 100) : 0);
export const rupees = (n) => '₹' + Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });
const ICONS = [
  // toys, sports, hardware, crafts (first: they're more specific than the general words below)
  [/baby|toddler|infant/i, '🍼'], [/block|building set|lego/i, '🧱'], [/stem|science|robot/i, '🤖'], [/pretend|role play/i, '🚒'], [/outdoor|active play/i, '🪁'], [/art & craft|crayon/i, '🖍️'], [/board game|puzzle|books & games/i, '🎲'],
  [/cricket/i, '🏏'], [/football|soccer/i, '⚽'], [/badminton|racket|tennis/i, '🏸'], [/gym|fitness|weights/i, '🏋️'], [/running|marathon/i, '👟'], [/yoga/i, '🧘'], [/cycl|bicycle/i, '🚴'], [/swim/i, '🏊'],
  [/cement|concrete|sand|brick/i, '🧱'], [/steel|tmt|rebar/i, '🏗️'], [/plumb|pipe|sanitary|bath fitting/i, '🚰'], [/electrical|wire|switch|mcb/i, '⚡'], [/paint/i, '🎨'], [/tool/i, '🛠️'], [/hardware|fastener|screw/i, '🔩'],
  [/stole|dupatta|shawl/i, '🧣'], [/wall art|painting/i, '🖼️'], [/home d[eé]cor|cushion|textile/i, '🪔'], [/pottery|brass|terracotta|ceramic/i, '🏺'],
  [/cold brew|coffee/i, '☕'], [/brew gear|mug|tumbler/i, '🥤'],
  [/fruit|veg|sabzi|फल|सब्ज/i, '🥦'], [/dairy|milk|bread|bakery|egg|दूध/i, '🥛'], [/atta|rice|dal|staple|grain|आटा|चावल|दाल/i, '🌾'], [/masala|spice|oil|मसाल|तेल/i, '🌶️'],
  [/snack|namkeen|biscuit|chips|नमकीन/i, '🍪'], [/beverage|drink|tea|chai|coffee|juice|चाय/i, '☕'], [/household|clean|home care|घर/i, '🧽'], [/personal|soap|tooth|bath/i, '🧴'],
  [/mobile|phone|फ़ोन|मोबाइल/i, '📱'], [/audio|ear|head|speaker/i, '🎧'], [/wear|watch|band/i, '⌚'], [/laptop|computer/i, '💻'], [/smart home|plug|bulb|router/i, '💡'], [/access|charger|cable|cover/i, '🔌'],
  [/cleanse|wash/i, '🫧'], [/treat|serum/i, '💧'], [/moistur|cream/i, '🧴'], [/protect|sun|spf/i, '☀️'], [/hair/i, '💇'], [/body|lip/i, '🌸'],
  [/kurta|kurti|ethnic/i, '👘'], [/dress/i, '👗'], [/saree|sari/i, '🥻'], [/denim|jeans/i, '👖'], [/shoe|foot|flat/i, '👡'], [/bag|access/i, '👜'], [/co-ord|tee|shirt|top/i, '👕'],
  [/gift/i, '🎁'], [/book|guide|course/i, '📘'], [/toy|kid/i, '🧸'], [/jewel/i, '💍'], [/pet/i, '🐾'], [/sweet|mithai/i, '🍬'],
  [/diabet|sugar/i, '🩸'], [/heart|bp\b/i, '🫀'], [/pain|fever/i, '💊'], [/vitamin|supplement|immun/i, '🌿'], [/cold|cough|flu/i, '🤧'], [/baby|mother/i, '👶'], [/device|monitor/i, '🩺'], [/first aid/i, '🩹'],
];
export const catIcon = (name) => (ICONS.find(([re]) => re.test(String(name || ''))) || [null, '🛍️'])[1];
// wa.me link with a first message
export const waLink = (num, text) => `https://wa.me/${String(num || '').replace(/\D/g, '')}${text ? `?text=${encodeURIComponent(text)}` : ''}`;
// what the cart adds up to, for the sticky bar (the server prices the real checkout)
export const cartTotal = (cart, byId) => cart.reduce((s, x) => s + (byId[x.id] ? byId[x.id].price * (byId[x.id].kind === 'digital' ? 1 : x.qty) : 0), 0);
// one product from each of the first three categories — a "routine" / "complete the look" bundle
export function bundleOf(listings, categories, n = 3) {
  const out = [];
  for (const c of categories) { const l = listings.find((x) => x.category === c && !x.soldOut); if (l) out.push(l); if (out.length >= n) break; }
  return out.length >= 2 ? out : [];
}
// products worth comparing: the first category with 2+ products that list highlights
export function compareSet(listings, categories, n = 3) {
  for (const c of categories) { const l = listings.filter((x) => x.category === c && x.highlights?.length); if (l.length >= 2) return { category: c, items: l.slice(0, n) }; }
  return null;
}
