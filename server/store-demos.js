// Live demo stores at /s/demo-<theme>: a realistic Indian catalogue per flagship theme, read-only (the cart and its
// prices work; checkout is refused with a "start your own store" call to action). Product pictures are drawn here
// as small SVGs (generated, so license-safe and a few hundred bytes each) — served at /api/s/demo-<theme>/art/<id>.svg.
// Adding an industry: add its catalogue to DEMOS and, if its products need new shapes, a drawing to ART.

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// ---------- drawings ----------
// each: (fg, ac, label) → SVG body. Fashion is drawn on 300×400 (3:4), everything else on 400×400.
const FASHION = {
  kurta: (f, a) => `<path d="M110 60 L135 52 Q150 74 165 52 L190 60 L235 120 L215 135 L195 112 L205 330 L95 330 L105 112 L85 135 L65 120 Z" fill="${f}"/><path d="M150 70 V140" stroke="${a}" stroke-width="3"/><path d="M98 300 H202" stroke="${a}" stroke-width="6" opacity=".7"/>`,
  dress: (f, a) => `<path d="M122 52 H130 L136 96 H164 L170 52 H178 L186 122 Q226 232 246 336 H54 Q74 232 114 122 Z" fill="${f}"/><path d="M106 160 H194" stroke="${a}" stroke-width="4" opacity=".6"/><path d="M84 250 H216" stroke="${a}" stroke-width="4" opacity=".6"/>`,
  coord: (f, a) => `<path d="M105 60 L130 52 Q150 70 170 52 L195 60 L226 106 L206 119 L192 100 V162 H108 V100 L94 119 L74 106 Z" fill="${f}"/><path d="M110 172 H190 L200 346 H160 L150 214 L140 346 H100 Z" fill="${f}"/><path d="M108 172 H192" stroke="${a}" stroke-width="5"/>`,
  saree: (f, a) => `<path d="M120 58 H180 L190 120 Q216 230 232 346 H68 Q90 230 110 120 Z" fill="${f}"/><path d="M178 58 L206 70 L132 204 L104 192 Z" fill="${a}" opacity=".85"/><path d="M68 334 H232" stroke="${a}" stroke-width="12"/>`,
  jeans: (f, a) => `<path d="M100 52 H200 L212 346 H162 L150 140 L138 346 H88 Z" fill="${f}"/><path d="M100 68 H200" stroke="${a}" stroke-width="3" opacity=".7"/><path d="M110 76 Q118 104 140 100 M190 76 Q182 104 160 100" stroke="${a}" stroke-width="2.5" fill="none" opacity=".7"/>`,
  jacket: (f, a) => `<path d="M100 60 L130 50 L150 76 L170 50 L200 60 L246 202 L224 212 L200 130 L205 302 H95 L100 130 L76 212 L54 202 Z" fill="${f}"/><path d="M150 76 V302" stroke="${a}" stroke-width="3"/><path d="M130 50 L150 96 L170 50" stroke="${a}" stroke-width="3" fill="none"/>`,
  tee: (f, a, l) => `<path d="M95 70 L130 58 Q150 80 170 58 L205 70 L240 120 L210 138 L195 118 V300 H105 V118 L90 138 L60 120 Z" fill="${f}"/>${l ? `<text x="150" y="190" text-anchor="middle" font-family="Arial Black,Arial,sans-serif" font-weight="900" font-size="26" fill="${a}">${esc(l)}</text>` : ''}`,
  tote: (f, a) => `<path d="M112 150 Q112 84 150 84 Q188 84 188 150" stroke="${a}" stroke-width="9" fill="none"/><rect x="76" y="140" width="148" height="176" rx="8" fill="${f}"/><path d="M76 180 H224" stroke="${a}" stroke-width="4" opacity=".5"/>`,
  dupatta: (f, a) => `<path d="M60 112 Q150 82 240 112 V292 Q150 262 60 292 Z" fill="${f}"/><path d="M60 140 Q150 110 240 140 M60 264 Q150 234 240 264" stroke="${a}" stroke-width="5" fill="none"/><path d="M70 296 v18 M90 291 v18 M110 287 v18 M130 284 v18 M150 283 v18 M170 284 v18 M190 287 v18 M210 291 v18 M230 296 v18" stroke="${a}" stroke-width="3"/>`,
  flats: (f, a) => `<ellipse cx="150" cy="250" rx="62" ry="118" fill="${f}"/><ellipse cx="150" cy="250" rx="48" ry="104" fill="${a}" opacity=".25"/><path d="M104 214 Q150 186 196 214" stroke="${a}" stroke-width="12" fill="none"/><circle cx="150" cy="168" r="10" fill="${a}"/>`,
};
const label = (x, y, w, t, fg, size = 26) => `<rect x="${x - w / 2}" y="${y - size}" width="${w}" height="${size * 1.6}" rx="6" fill="#fff" opacity=".92"/><text x="${x}" y="${y + size * 0.25}" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-weight="800" font-size="${size}" fill="${fg}">${esc(t)}</text>`;
const GROCERY = {
  fruit: (f, a) => `<circle cx="200" cy="222" r="104" fill="${f}"/><ellipse cx="160" cy="180" rx="26" ry="16" fill="#fff" opacity=".35"/><path d="M200 122 Q204 96 214 84" stroke="#5b3b1a" stroke-width="7" fill="none" stroke-linecap="round"/><path d="M210 104 Q252 76 274 106 Q238 124 210 104 Z" fill="${a}"/>`,
  onion: (f, a) => `<path d="M200 96 Q286 196 258 276 Q200 336 142 276 Q114 196 200 96 Z" fill="${f}"/><path d="M200 120 Q236 200 222 290 M200 120 Q164 200 178 290" stroke="#fff" stroke-width="4" fill="none" opacity=".4"/><path d="M190 300 l-10 26 M210 300 l10 26 M200 302 v28" stroke="${a}" stroke-width="4"/>`,
  bunch: (f, a) => `<path d="M110 140 Q190 340 306 186" stroke="${f}" stroke-width="44" fill="none" stroke-linecap="round"/><path d="M118 120 Q214 300 312 150" stroke="${f}" stroke-width="40" fill="none" stroke-linecap="round" opacity=".88"/><path d="M104 136 l-14 -26" stroke="${a}" stroke-width="16" stroke-linecap="round"/>`,
  pack: (f, a, l) => `<rect x="118" y="82" width="164" height="252" rx="18" fill="${f}"/><path d="M118 98 l12 -16 l12 16 l12 -16 l12 16 l12 -16 l12 16 l12 -16 l12 16 l12 -16 l12 16 l12 -16 l12 16 l12 -16 l10 16" fill="${f}"/><ellipse cx="200" cy="268" rx="46" ry="32" fill="#fff" opacity=".28"/>${label(200, 190, 132, l, a, 24)}`,
  sack: (f, a, l) => `<path d="M140 92 Q200 70 260 92 L250 118 Q300 230 286 330 H114 Q100 230 150 118 Z" fill="${f}"/><path d="M146 112 Q200 126 254 112" stroke="${a}" stroke-width="8" fill="none"/>${label(200, 236, 140, l, a, 26)}`,
  bottle: (f, a, l) => `<rect x="182" y="66" width="36" height="30" rx="5" fill="${a}"/><path d="M178 96 H222 L224 128 Q262 150 262 196 V320 Q262 340 242 340 H158 Q138 340 138 320 V196 Q138 150 176 128 Z" fill="${f}"/>${label(200, 258, 104, l, a, 20)}`,
  carton: (f, a, l) => `<path d="M140 132 L170 86 H230 L260 132 Z" fill="${a}"/><rect x="140" y="132" width="120" height="200" fill="${f}"/><rect x="186" y="70" width="28" height="18" fill="${a}"/>${label(200, 236, 98, l, a, 20)}`,
  jar: (f, a, l) => `<rect x="146" y="96" width="108" height="34" rx="8" fill="${a}"/><rect x="132" y="126" width="136" height="202" rx="22" fill="${f}"/>${label(200, 238, 112, l, a, 20)}`,
  eggs: (f, a) => `<rect x="86" y="214" width="228" height="96" rx="20" fill="${a}"/>${[118, 164, 210, 256, 302].slice(0, 4).map((x, i) => `<ellipse cx="${x + 22}" cy="${206 - (i % 2) * 6}" rx="24" ry="32" fill="${f}"/>`).join('')}`,
  bread: (f, a) => `<path d="M100 300 V176 Q100 120 200 120 Q300 120 300 176 V300 Z" fill="${f}"/><path d="M140 300 V170 M180 300 V160 M220 300 V160 M260 300 V170" stroke="${a}" stroke-width="5" opacity=".6"/>`,
  bar: (f, a, l) => `<rect x="104" y="182" width="192" height="104" rx="34" fill="${f}"/><rect x="118" y="146" width="164" height="60" rx="26" fill="${f}" opacity=".7"/><text x="200" y="246" text-anchor="middle" font-family="Georgia,serif" font-style="italic" font-size="30" fill="${a}">${esc(l)}</text>`,
  tube: (f, a, l) => `<path d="M92 170 H282 L320 184 V218 L282 232 H92 Q80 232 80 220 V182 Q80 170 92 170 Z" fill="${f}"/><rect x="318" y="182" width="24" height="38" rx="5" fill="${a}"/>${label(180, 206, 104, l, a, 18)}`,
};
const BEAUTY = {
  dropper: (f, a, l) => `<path d="M188 70 Q200 52 212 70 V118 H188 Z" fill="${a}"/><rect x="178" y="116" width="44" height="26" rx="4" fill="#2b2b2b" opacity=".85"/><rect x="146" y="140" width="108" height="184" rx="24" fill="${f}"/><text x="200" y="246" text-anchor="middle" font-family="Georgia,serif" font-size="20" fill="#fff">${esc(l)}</text>`,
  tube: (f, a, l) => `<path d="M160 86 H240 L254 300 H146 Z" fill="${f}"/><rect x="164" y="298" width="72" height="34" rx="6" fill="${a}"/><text x="200" y="200" text-anchor="middle" font-family="Georgia,serif" font-size="20" fill="${a}" transform="rotate(-90 200 200)">${esc(l)}</text>`,
  jar: (f, a, l) => `<rect x="118" y="160" width="164" height="38" rx="10" fill="${a}"/><rect x="108" y="194" width="184" height="124" rx="30" fill="${f}"/><text x="200" y="266" text-anchor="middle" font-family="Georgia,serif" font-size="22" fill="${a}">${esc(l)}</text>`,
  pump: (f, a, l) => `<path d="M188 70 H250 V84 H206 V112 H188 Z" fill="${a}"/><rect x="178" y="110" width="44" height="30" rx="4" fill="${a}"/><rect x="140" y="138" width="120" height="196" rx="30" fill="${f}"/><text x="200" y="246" text-anchor="middle" font-family="Georgia,serif" font-size="20" fill="${a}">${esc(l)}</text>`,
  stick: (f, a) => `<rect x="170" y="190" width="60" height="140" rx="10" fill="${f}"/><rect x="176" y="120" width="48" height="76" rx="8" fill="${a}"/><path d="M176 132 Q200 92 224 120 V132 Z" fill="${a}"/>`,
  oil: (f, a, l) => `<rect x="184" y="64" width="32" height="40" rx="6" fill="${a}"/><path d="M182 104 H218 V140 Q270 160 270 210 V310 Q270 336 244 336 H156 Q130 336 130 310 V210 Q130 160 182 140 Z" fill="${f}"/><text x="200" y="262" text-anchor="middle" font-family="Georgia,serif" font-size="20" fill="#fff">${esc(l)}</text>`,
};
const TECH = {
  phone: (f, a) => `<rect x="134" y="64" width="132" height="272" rx="24" fill="#15181f" stroke="${f}" stroke-width="4"/><rect x="144" y="78" width="112" height="244" rx="16" fill="url(#scr)"/><rect x="152" y="88" width="46" height="62" rx="12" fill="#0b0d12" opacity=".85"/><circle cx="166" cy="104" r="8" fill="${a}" opacity=".7"/><circle cx="166" cy="132" r="8" fill="${a}" opacity=".7"/><circle cx="186" cy="118" r="5" fill="#fff" opacity=".6"/>`,
  tablet: (f, a) => `<rect x="76" y="94" width="248" height="212" rx="20" fill="#15181f" stroke="${f}" stroke-width="4"/><rect x="88" y="106" width="224" height="188" rx="12" fill="url(#scr)"/>`,
  laptop: (f) => `<rect x="96" y="96" width="208" height="146" rx="10" fill="#15181f" stroke="${f}" stroke-width="4"/><rect x="106" y="106" width="188" height="126" rx="4" fill="url(#scr)"/><path d="M70 252 H330 L316 280 H84 Z" fill="${f}"/>`,
  buds: (f, a) => `<rect x="124" y="176" width="152" height="118" rx="52" fill="${f}"/><path d="M124 226 H276" stroke="#0b0d12" stroke-width="3" opacity=".5"/><circle cx="200" cy="262" r="5" fill="${a}"/><ellipse cx="160" cy="138" rx="26" ry="30" fill="${f}"/><rect x="150" y="150" width="16" height="44" rx="8" fill="${f}"/><ellipse cx="240" cy="138" rx="26" ry="30" fill="${f}"/><rect x="234" y="150" width="16" height="44" rx="8" fill="${f}"/>`,
  headphones: (f, a) => `<path d="M112 230 Q112 96 200 96 Q288 96 288 230" stroke="${f}" stroke-width="18" fill="none" stroke-linecap="round"/><rect x="88" y="206" width="54" height="96" rx="24" fill="${f}"/><rect x="258" y="206" width="54" height="96" rx="24" fill="${f}"/><rect x="100" y="222" width="30" height="64" rx="14" fill="${a}" opacity=".5"/><rect x="270" y="222" width="30" height="64" rx="14" fill="${a}" opacity=".5"/>`,
  watch: (f, a) => `<rect x="164" y="50" width="72" height="300" rx="20" fill="${f}" opacity=".55"/><rect x="138" y="128" width="124" height="144" rx="34" fill="#15181f" stroke="${f}" stroke-width="5"/><circle cx="200" cy="200" r="44" fill="none" stroke="${a}" stroke-width="8" stroke-dasharray="190 300" transform="rotate(-90 200 200)"/><text x="200" y="208" text-anchor="middle" font-family="Arial,sans-serif" font-weight="700" font-size="22" fill="#fff">10:08</text>`,
  speaker: (f, a) => `<rect x="112" y="110" width="176" height="200" rx="60" fill="${f}"/><circle cx="200" cy="210" r="58" fill="#0b0d12" opacity=".5"/><circle cx="200" cy="210" r="30" fill="${a}" opacity=".6"/>${[0, 1, 2, 3, 4].map((i) => `<circle cx="${148 + i * 26}" cy="138" r="4" fill="#0b0d12" opacity=".5"/>`).join('')}`,
  powerbank: (f, a) => `<rect x="130" y="80" width="140" height="240" rx="22" fill="${f}"/>${[0, 1, 2, 3].map((i) => `<circle cx="${170 + i * 20}" cy="276" r="5" fill="${a}"/>`).join('')}<rect x="180" y="92" width="40" height="10" rx="5" fill="#0b0d12" opacity=".6"/>`,
  charger: (f, a) => `<rect x="190" y="70" width="8" height="40" rx="3" fill="#cfd5e2"/><rect x="214" y="70" width="8" height="40" rx="3" fill="#cfd5e2"/><rect x="146" y="106" width="120" height="132" rx="26" fill="${f}"/><rect x="190" y="210" width="34" height="10" rx="5" fill="${a}"/><path d="M206 250 Q206 330 140 330" stroke="${f}" stroke-width="10" fill="none" stroke-linecap="round"/>`,
  cable: (f, a) => `<path d="M120 150 Q200 70 280 150 Q340 230 260 280 Q180 330 140 270" stroke="${f}" stroke-width="14" fill="none" stroke-linecap="round"/><rect x="104" y="128" width="34" height="58" rx="10" fill="${a}" transform="rotate(-30 121 157)"/><rect x="122" y="250" width="34" height="58" rx="10" fill="${a}" transform="rotate(40 139 279)"/>`,
  plug: (f, a) => `<rect x="130" y="110" width="140" height="180" rx="30" fill="${f}"/><circle cx="178" cy="196" r="10" fill="#0b0d12" opacity=".6"/><circle cx="222" cy="196" r="10" fill="#0b0d12" opacity=".6"/><circle cx="200" cy="240" r="7" fill="${a}"/>`,
  bulb: (f, a) => `<circle cx="200" cy="168" r="84" fill="${a}" opacity=".18"/><path d="M200 92 Q262 92 262 160 Q262 196 232 222 V250 H168 V222 Q138 196 138 160 Q138 92 200 92 Z" fill="${f}"/><rect x="168" y="250" width="64" height="44" rx="8" fill="#9aa3b5"/><path d="M168 264 H232 M168 280 H232" stroke="#0b0d12" stroke-width="3" opacity=".4"/>`,
  router: (f, a) => `<path d="M140 190 L120 92 M260 190 L280 92 M200 190 V82" stroke="${f}" stroke-width="10" stroke-linecap="round"/><rect x="92" y="186" width="216" height="80" rx="20" fill="${f}"/>${[0, 1, 2, 3].map((i) => `<circle cx="${144 + i * 28}" cy="226" r="5" fill="${a}"/>`).join('')}`,
};

// [shape, background, foreground, accent, label?]
const draw = {
  fashion: (k, bg, fg, ac, l) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 400" width="600" height="800"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset=".72" stop-color="${bg}"/><stop offset="1" stop-color="#000" stop-opacity=".08"/></linearGradient></defs><rect width="300" height="400" fill="${bg}"/><rect width="300" height="400" fill="url(#g)"/><ellipse cx="150" cy="356" rx="96" ry="10" fill="#000" opacity=".08"/>${(FASHION[k] || FASHION.tee)(fg, ac, l)}</svg>`,
  grocery: (k, bg, fg, ac, l) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400" width="400" height="400"><rect width="400" height="400" fill="#fff"/><circle cx="200" cy="210" r="168" fill="${bg}"/><ellipse cx="200" cy="350" rx="110" ry="10" fill="#000" opacity=".06"/>${(GROCERY[k] || GROCERY.pack)(fg, ac, l)}</svg>`,
  beauty: (k, bg, fg, ac, l) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400" width="400" height="400"><rect width="400" height="400" fill="${bg}"/><path d="M90 360 V170 Q90 60 200 60 Q310 60 310 170 V360 Z" fill="#fff" opacity=".45"/><ellipse cx="200" cy="338" rx="96" ry="9" fill="#000" opacity=".07"/>${(BEAUTY[k] || BEAUTY.jar)(fg, ac, l)}</svg>`,
  electronics: (k, bg, fg, ac) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400" width="400" height="400"><defs><radialGradient id="bgr" cx=".5" cy=".42" r=".7"><stop offset="0" stop-color="${bg}"/><stop offset="1" stop-color="#0b0d12"/></radialGradient><linearGradient id="scr" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${ac}"/><stop offset="1" stop-color="#1e1b4b"/></linearGradient></defs><rect width="400" height="400" fill="url(#bgr)"/><circle cx="200" cy="200" r="120" fill="${ac}" opacity=".12"/>${(TECH[k] || TECH.phone)(fg, ac)}</svg>`,
};

// ---------- catalogues ----------
// product rows: [title, category, price, mrp, description, art[], extras]
const P = (title, category, price, mrp, description, art, x = {}) => ({ title, category, price, mrp, description, art, ...x });
const SZ = ['XS', 'S', 'M', 'L', 'XL', 'XXL'];
const DEMOS = {
  fashion: {
    store: {
      name: 'Kesari Studio', tagline: 'Hand-block prints and easy cottons, made in Jaipur',
      about: 'A small studio of printers and tailors in Sanganer. Every piece is hand-block printed with natural dyes in small batches — so when a print sells out, it is usually gone for good.',
      categories: ['Kurtas', 'Dresses', 'Co-ords', 'Sarees', 'Denim', 'Accessories'],
      shipping: { fee: 79, freeAbove: 999 }, cod: { enabled: true, fee: 0 },
      theme: 'fashion',
      themeOptions: { announcement: 'Free shipping above ₹999 · Easy 7-day exchange · COD available', heroTitle: 'The Monsoon Edit', heroText: 'Breezy cottons and hand-block prints in colours that hold their own against grey skies.', heroCta: 'Shop the drop', perks: ['freeDelivery', 'exchange', 'handmade'], lang: 'en' },
    },
    items: [
      P('Indigo Dabu Straight Kurta', 'Kurtas', 1499, 2199, 'Mud-resist Dabu print on soft cambric cotton. Straight fit, side slits, 3/4 sleeves.\nLength 44 in · Hand wash cold', ['kurta', '#e9e4dc', '#2f3f73', '#d9c7a3'], { sizes: SZ, badge: 'New drop', highlights: ['Pure cotton', 'Natural indigo', 'Hand-block printed'] }),
      P('Mustard Bagru A-line Kurta', 'Kurtas', 1299, 1899, 'Bagru print in turmeric yellow on a flared A-line. Pairs with white palazzos or denim.', ['kurta', '#f1eadf', '#d7a32b', '#7a4b1c'], { sizes: SZ, highlights: ['Cotton cambric', 'A-line', 'Pockets'] }),
      P('Ivory Chikankari Kurta', 'Kurtas', 2499, 3299, 'Hand-embroidered Lucknowi chikankari on soft mul cotton. Comes with a matching slip.', ['kurta', '#ece7e1', '#f7f3ea', '#c9b896'], { sizes: SZ, badge: 'Bestseller', highlights: ['Hand embroidery', 'Mul cotton', 'With slip'] }),
      P('Sky Linen Kurta for Men', 'Kurtas', 1599, 2299, 'Relaxed-fit linen-blend kurta with a band collar and wooden buttons.', ['kurta', '#e6ebee', '#8fb2cf', '#3e5b74'], { sizes: ['S', 'M', 'L', 'XL', 'XXL'], highlights: ['Linen blend', 'Band collar'] }),
      P('Terracotta Tiered Midi Dress', 'Dresses', 1899, 2699, 'Three-tier cotton midi with a smocked back and adjustable tie straps.', ['dress', '#efe6dc', '#b4532a', '#f0c9a8'], { sizes: SZ, badge: 'New drop', highlights: ['Smocked back', 'Pockets', 'Lined'] }),
      P('Sage Linen Shirt Dress', 'Dresses', 2199, null, 'A belted shirt dress in breathable linen-cotton. Office to dinner in one piece.', ['dress', '#e8ebe3', '#93a787', '#4c5d44'], { sizes: SZ, highlights: ['Linen-cotton', 'Self belt'] }),
      P('Rust Hand-block Co-ord Set', 'Co-ords', 2799, 3599, 'Boxy short kurta with straight pants in a rust floral block print.', ['coord', '#f0e7de', '#a4472b', '#f2d2b6'], { sizes: SZ, badge: 'New drop', highlights: ['2-piece set', 'Elastic waist'] }),
      P('Olive Lounge Set', 'Co-ords', 1699, 2199, 'Brushed cotton top and joggers — the set you will live in on weekends.', ['coord', '#e9eae2', '#6b7448', '#c9cdb1'], { sizes: SZ, highlights: ['Brushed cotton', 'Relaxed fit'] }),
      P('Maheshwari Silk-Cotton Saree', 'Sarees', 3499, 4499, 'Handwoven in Maheshwar with a zari border. 5.5 m with a 0.8 m unstitched blouse piece.', ['saree', '#efe5e5', '#8c2f4b', '#d8b45a'], { badge: 'Handwoven', highlights: ['Silk-cotton', 'Zari border', 'Blouse piece'] }),
      P('Blush Kota Doria Saree', 'Sarees', 2899, null, 'Featherlight Kota Doria checks in blush pink with a gota-patti border.', ['saree', '#f4eaea', '#e6a9b0', '#b98a4a'], { highlights: ['Kota Doria', 'Gota border'] }),
      P('High-rise Straight Jeans', 'Denim', 1799, 2499, 'Rigid 100% cotton denim with a high rise and a straight, ankle-grazing leg.', ['jeans', '#e7e9ec', '#3c5a86', '#c7d2e2'], { sizes: ['26', '28', '30', '32', '34', '36'], highlights: ['100% cotton', 'High rise'] }),
      P('Relaxed Denim Jacket', 'Denim', 2499, 3299, 'An oversized trucker jacket in mid-wash denim. Wear it over kurtas too.', ['jacket', '#e7e9ec', '#5a7aa6', '#24375a'], { sizes: SZ, highlights: ['Oversized', 'Mid-wash'] }),
      P('Oversized Graphic Tee', 'Co-ords', 799, 999, 'Heavy 240 GSM cotton tee with a hand-drawn chai print.', ['tee', '#ecebe8', '#f5f2ea', '#b4532a', 'CHAI'], { sizes: SZ, highlights: ['240 GSM', 'Drop shoulder'] }),
      P('Handwoven Jute Tote', 'Accessories', 899, null, 'Sturdy jute tote with a cotton lining and an inner pocket. Fits a 14" laptop.', ['tote', '#efe9df', '#c49a62', '#6b4a24'], { highlights: ['Lined', 'Inner pocket'] }),
      P('Block-print Mul Dupatta', 'Accessories', 799, 999, 'Soft mul dupatta with tassels, printed to match our indigo kurtas.', ['dupatta', '#ebe7e2', '#3c4f86', '#e9dcc0'], { highlights: ['Mul cotton', '2.2 m'] }),
      P('Tan Kolhapuri Flats', 'Accessories', 1199, 1499, 'Handcrafted leather Kolhapuris with a cushioned sole.', ['flats', '#efe8df', '#a8682f', '#5d3510'], { sizes: ['36', '37', '38', '39', '40', '41'], highlights: ['Real leather', 'Cushioned'] }),
    ],
  },
  grocery: {
    store: {
      name: 'Sharma General Store', tagline: 'Ghar ka saaman, darwaze tak — fresh every morning',
      about: 'Your neighbourhood kirana since 1998, now online. Order by 7 pm for same-day delivery in Indiranagar, HAL and Domlur.',
      categories: ['Fruits & Veg', 'Dairy & Bread', 'Atta, Rice & Dal', 'Masala & Oil', 'Snacks', 'Beverages', 'Household', 'Personal Care'],
      shipping: { fee: 25, freeAbove: 199 }, cod: { enabled: true, fee: 0 },
      theme: 'grocery',
      themeOptions: { announcement: 'Free delivery above ₹199 · Pay by UPI or cash on delivery', deliveryNote: 'Delivery in 45 minutes · Order by 7 pm for same-day', heroTitle: 'Fresh sabzi, daily essentials', heroText: 'Picked from the mandi at 6 am and at your door before lunch.', heroCta: 'Start shopping', offers: [{ title: 'Flat ₹50 off', note: 'On your first order above ₹499', code: 'PEHLA50' }, { title: 'Buy 2 get 1', note: 'On all masala packs this week' }, { title: 'Free delivery', note: 'On every order above ₹199' }], perks: ['fastDelivery', 'fresh', 'freeDelivery'], lang: 'en' },
    },
    items: [
      P('Robusta Bananas', 'Fruits & Veg', 58, 70, 'Ripe, sweet Robusta bananas from Hosur farms.', ['bunch', '#fff4c7', '#f2c230', '#5b8f2a'], { unit: '1 dozen', badge: 'Fresh today' }),
      P('Onion', 'Fruits & Veg', 39, 49, 'Nashik red onions, sorted and dry.', ['onion', '#f9e1e6', '#b23a5a', '#7a8b3b'], { unit: '1 kg' }),
      P('Tomato (Hybrid)', 'Fruits & Veg', 22, 30, 'Firm, bright tomatoes — good for curries and salads.', ['fruit', '#ffe2dc', '#e0402a', '#3f8f3a'], { unit: '500 g' }),
      P('Shimla Apples', 'Fruits & Veg', 149, 180, 'Crunchy Royal Delicious apples from Himachal.', ['fruit', '#ffe4e4', '#c8263a', '#3f8f3a'], { unit: '1 kg', badge: 'Season’s best' }),
      P('Toned Milk', 'Dairy & Bread', 28, null, 'Pasteurised toned milk, delivered chilled.', ['carton', '#e4f0ff', '#f3f7fd', '#2b6cc4', 'MILK'], { unit: '500 ml' }),
      P('Fresh Malai Paneer', 'Dairy & Bread', 90, 99, 'Soft paneer made this morning. Keep refrigerated.', ['jar', '#fff6df', '#fbf6e9', '#c99b2e', 'PANEER'], { unit: '200 g' }),
      P('Whole Wheat Bread', 'Dairy & Bread', 45, null, 'Baked overnight, no maida.', ['bread', '#fbeedd', '#cf8a45', '#8a5422'], { unit: '400 g' }),
      P('Farm Eggs', 'Dairy & Bread', 54, 60, 'Brown eggs from free-range hens in Doddaballapur.', ['eggs', '#fff3e3', '#e7b98a', '#8a5a2b'], { unit: '6 pcs' }),
      P('Chakki Fresh Atta', 'Atta, Rice & Dal', 245, 290, 'Stone-ground whole wheat atta. Soft rotis, every time.', ['sack', '#fff1d6', '#e8c27a', '#9a5a12', 'ATTA'], { unit: '5 kg', badge: 'Bestseller' }),
      P('Basmati Rice', 'Atta, Rice & Dal', 129, 165, 'Aged long-grain basmati for biryani and pulao.', ['sack', '#eef6e8', '#f6f1e3', '#4c7d2a', 'BASMATI'], { unit: '1 kg' }),
      P('Toor Dal', 'Atta, Rice & Dal', 159, 185, 'Unpolished toor dal — cooks fast, tastes like home.', ['pack', '#fff4d6', '#f0b429', '#7a4b06', 'TOOR DAL'], { unit: '1 kg' }),
      P('Cold-pressed Mustard Oil', 'Masala & Oil', 199, 240, 'Kachi ghani mustard oil, pressed in Bharatpur.', ['bottle', '#fff7d6', '#e3b021', '#6b4a06', 'MUSTARD'], { unit: '1 L' }),
      P('Garam Masala', 'Masala & Oil', 75, 90, 'Whole spices roasted and ground in small batches.', ['jar', '#fde7dc', '#9c3d1e', '#f3c8a4', 'GARAM'], { unit: '100 g' }),
      P('Turmeric Powder', 'Masala & Oil', 58, 70, 'High-curcumin Salem haldi.', ['pack', '#fff3c4', '#f4b400', '#7a5200', 'HALDI'], { unit: '200 g' }),
      P('Masala Peanuts', 'Snacks', 55, null, 'Crunchy besan-coated peanuts with a chatpata kick.', ['pack', '#ffe6d6', '#e0612b', '#fff', 'PEANUTS'], { unit: '200 g' }),
      P('Classic Salted Chips', 'Snacks', 20, null, 'Thin, crisp potato chips with just salt.', ['pack', '#fff3c9', '#f6c12b', '#1f3f8a', 'CHIPS'], { unit: '52 g' }),
      P('Assam Masala Chai', 'Beverages', 140, 160, 'Strong CTC leaves blended with elaichi and ginger.', ['pack', '#f6e6dc', '#7a2e1a', '#f4d6b5', 'CHAI'], { unit: '250 g', badge: 'Bestseller' }),
      P('Instant Coffee', 'Beverages', 165, null, 'Smooth, rich instant coffee for your morning cup.', ['jar', '#efe3d9', '#4b2e1e', '#e2c4a3', 'COFFEE'], { unit: '50 g' }),
      P('Lemon Dishwash Liquid', 'Household', 99, 115, 'Cuts grease fast, gentle on hands.', ['bottle', '#eaf8df', '#7cc243', '#2f6b12', 'DISHWASH'], { unit: '500 ml' }),
      P('Floor Cleaner – Pine', 'Household', 179, 199, 'Kills 99.9% of germs with a fresh pine smell.', ['bottle', '#e1f3ee', '#1f9d7a', '#0b4d3c', 'FLOOR'], { unit: '1 L' }),
      P('Neem Bathing Bar', 'Personal Care', 120, 140, 'Neem and tulsi soap — pack of 4.', ['bar', '#e6f4e1', '#7fb069', '#1f4d14', 'neem'], { unit: '4 × 100 g' }),
      P('Herbal Toothpaste', 'Personal Care', 89, 99, 'Clove and babool toothpaste with no artificial colour.', ['tube', '#e3f2fb', '#f7fbff', '#1f6fb2', 'HERBAL'], { unit: '150 g' }),
    ],
  },
  beauty: {
    store: {
      name: 'Nyra Botanics', tagline: 'Clean, Ayurveda-inspired skincare made for Indian skin',
      about: 'Formulated in Pune with dermatologists, tested on Indian skin types in heat and humidity. No parabens, no sulphates, never tested on animals.',
      categories: ['Cleanse', 'Treat', 'Moisturise', 'Protect', 'Hair', 'Body'],
      shipping: { fee: 49, freeAbove: 599 }, cod: { enabled: true, fee: 0 },
      theme: 'beauty',
      themeOptions: { announcement: 'Free shipping above ₹599 · Free mini cleanser on orders above ₹999', heroTitle: 'Glow that starts with your routine', heroText: 'Three steps, ten minutes, real results in four weeks. Gentle actives with Ayurvedic botanicals.', heroCta: 'Build my routine', perks: ['crueltyFree', 'authentic', 'freeDelivery'], lang: 'en' },
    },
    items: [
      P('Ubtan Brightening Face Wash', 'Cleanse', 349, 399, 'A soap-free gel cleanser with turmeric and saffron that leaves skin soft, never tight.\nHow to use: massage onto damp skin for 30 seconds, rinse.', ['tube', '#f8e6da', '#f3c37a', '#9c5a1b', 'Ubtan'], { highlights: ['Turmeric', 'Saffron', 'Soap-free'], rating: 4.6, reviews: 1243, badge: 'Bestseller' }),
      P('Rice Water Gentle Cleanser', 'Cleanse', 299, null, 'Low-pH milky cleanser with fermented rice water for dry and sensitive skin.', ['pump', '#f4ece6', '#fbf7f1', '#b08a6e', 'Rice'], { highlights: ['pH 5.5', 'Rice water', 'Fragrance-free'], rating: 4.4, reviews: 512 }),
      P('Vitamin C 10% Glow Serum', 'Treat', 699, 899, 'Stable ethyl ascorbic acid with ferulic acid and amla for brighter, even skin tone.', ['dropper', '#fbe3d3', '#f08a3c', '#7a3a10', 'Vit C'], { highlights: ['10% Vitamin C', 'Ferulic acid', 'Amla'], rating: 4.7, reviews: 2087, badge: 'Bestseller' }),
      P('Niacinamide 5% Clear Serum', 'Treat', 549, 649, 'Calms oil and visible pores with niacinamide, zinc and neem.', ['dropper', '#e7eef0', '#8fb7c2', '#2b5560', 'Niacin'], { highlights: ['5% Niacinamide', 'Zinc PCA', 'Neem'], rating: 4.5, reviews: 864 }),
      P('Kumkumadi Night Oil', 'Treat', 899, 1099, 'A 16-herb Ayurvedic facial oil with saffron for overnight radiance.', ['oil', '#f6e1dc', '#c2523a', '#f3d3a1', 'Kumkumadi'], { highlights: ['Saffron', '16 herbs', 'Night use'], rating: 4.6, reviews: 731 }),
      P('Ceramide Barrier Moisturiser', 'Moisturise', 499, 599, 'Lightweight gel-cream with 3 ceramides and squalane that holds moisture all day.', ['jar', '#efe7ee', '#f8f2f6', '#8c5a7a', 'Barrier'], { highlights: ['3 ceramides', 'Squalane', 'Non-greasy'], rating: 4.6, reviews: 958 }),
      P('Aloe & Cucumber Gel', 'Moisturise', 299, null, 'Cooling 92% aloe gel for oily skin and after-sun.', ['jar', '#e6f2e6', '#f2faf2', '#4e8a52', 'Aloe'], { highlights: ['92% aloe', 'Cooling'], rating: 4.3, reviews: 402 }),
      P('SPF 50 PA++++ Sunscreen Gel', 'Protect', 449, 525, 'No white cast, no grease — a water-light gel for the Indian summer.', ['tube', '#fdf0d8', '#fbe2a6', '#b5762b', 'SPF 50'], { highlights: ['SPF 50 PA++++', 'No white cast', 'Gel'], rating: 4.7, reviews: 1630, badge: 'New' }),
      P('Tinted Sunscreen SPF 40', 'Protect', 499, null, 'Sheer tint that evens skin tone for medium to deep skin.', ['pump', '#f4e2d6', '#c8916c', '#6b3f22', 'Tint'], { highlights: ['SPF 40', 'Sheer tint'], rating: 4.2, reviews: 288 }),
      P('Onion & Bhringraj Hair Oil', 'Hair', 399, 499, 'Cold-pressed oils with red onion and bhringraj to reduce hair fall.', ['oil', '#efe6f3', '#7a3f8a', '#f0d9f5', 'Bhringraj'], { highlights: ['Red onion', 'Bhringraj', 'Cold-pressed'], rating: 4.4, reviews: 1104 }),
      P('Rosemary Scalp Serum', 'Hair', 549, null, 'Leave-in serum with rosemary and redensyl for thicker-looking hair.', ['dropper', '#e8efe6', '#6f9a6a', '#22421f', 'Rosemary'], { highlights: ['Rosemary', 'Redensyl'], rating: 4.3, reviews: 377 }),
      P('Shea & Kokum Body Butter', 'Body', 449, 549, 'Rich whipped butter for very dry elbows, knees and heels.', ['jar', '#f6ebe2', '#fff8f0', '#a0663a', 'Kokum'], { highlights: ['Shea', 'Kokum', '48h moisture'], rating: 4.5, reviews: 590 }),
      P('Beetroot Tinted Lip Balm', 'Body', 199, 249, 'A natural pink tint with beetroot and ghee.', ['stick', '#f8e1e6', '#d8577a', '#a8325a'], { highlights: ['Beetroot', 'Ghee'], rating: 4.4, reviews: 820 }),
      P('Sandalwood Body Wash', 'Body', 349, null, 'Creamy sulphate-free body wash with real sandalwood oil.', ['pump', '#f3e9dc', '#e8d2b0', '#7a5426', 'Chandan'], { highlights: ['Sulphate-free', 'Sandalwood'], rating: 4.3, reviews: 214 }),
    ],
  },
  electronics: {
    store: {
      name: 'Volt Mobiles', tagline: 'Phones, audio and accessories — with GST bill and brand warranty',
      about: 'An authorised multi-brand store in Lamington Road, Mumbai since 2009. Every device is sealed, billed with GST and covered by brand warranty.',
      categories: ['Mobiles', 'Audio', 'Wearables', 'Laptops', 'Accessories', 'Smart Home'],
      shipping: { fee: 0, freeAbove: 0 }, cod: { enabled: true, fee: 49 },
      theme: 'electronics',
      themeOptions: { announcement: 'No-cost EMI on cards above ₹3,000 · Free shipping across India', heroTitle: 'Nova 5G. Faster than your feed.', heroText: '120 Hz AMOLED, 50 MP OIS camera and a 5000 mAh battery that charges in 35 minutes.', heroCta: 'Buy now', perks: ['emi', 'warranty', 'authentic', 'freeDelivery'], lang: 'en' },
    },
    items: [
      P('Nova 5G (8 GB / 128 GB)', 'Mobiles', 17999, 21999, 'A 6.7" 120 Hz AMOLED display, 50 MP camera with OIS and 45 W fast charging.', ['phone', '#1d2a4a', '#3b4a6b', '#3b82f6'], { highlights: ['6.7" 120 Hz AMOLED', '50 MP OIS camera', '5000 mAh · 45 W', '5G dual SIM'], rating: 4.5, reviews: 3120, badge: 'Bestseller' }),
      P('Nova Lite 5G (6 GB / 128 GB)', 'Mobiles', 12999, 15999, 'Big battery, clean software and 5G on a budget.', ['phone', '#1a3a3a', '#2f5d5d', '#22d3ee'], { highlights: ['6.6" 90 Hz LCD', '50 MP camera', '6000 mAh', '5G'], rating: 4.3, reviews: 1874 }),
      P('Pixelite Pro (12 GB / 256 GB)', 'Mobiles', 32999, 38999, 'Flagship camera with a 3× periscope, IP68 and 4 years of updates.', ['phone', '#2a1d4a', '#4b3b6b', '#a78bfa'], { highlights: ['6.8" LTPO 1–120 Hz', '3× periscope zoom', 'IP68', '4 OS updates'], rating: 4.6, reviews: 942, badge: 'New launch' }),
      P('Slate 11 Tablet (8 GB / 128 GB)', 'Mobiles', 17999, 22999, 'An 11" 2K screen with quad speakers — for classes, Netflix and notes.', ['tablet', '#1d2a3a', '#334155', '#38bdf8'], { highlights: ['11" 2K 90 Hz', 'Quad speakers', '8000 mAh'], rating: 4.4, reviews: 611 }),
      P('AirBeat ANC Earbuds', 'Audio', 2499, 4999, 'Hybrid noise cancelling, 40 hours with the case and a low-latency game mode.', ['buds', '#1d2433', '#e5e7eb', '#22d3ee'], { highlights: ['ANC up to 32 dB', '40 h battery', 'IPX5', 'Game mode'], rating: 4.3, reviews: 5240, badge: 'Deal' }),
      P('Studio Over-ear Headphones', 'Audio', 3999, 6999, 'Wireless over-ears with 40 mm drivers and 60 hours of play.', ['headphones', '#1f2433', '#9ca3af', '#f97316'], { highlights: ['40 mm drivers', '60 h battery', 'Multipoint'], rating: 4.4, reviews: 1308 }),
      P('BassBox 20 W Speaker', 'Audio', 1999, 3499, 'Room-filling sound, IPX7 waterproof, 12 hours of party.', ['speaker', '#2a1f33', '#4b5563', '#ec4899'], { highlights: ['20 W output', 'IPX7', '12 h'], rating: 4.2, reviews: 2210 }),
      P('Pulse Smartwatch 1.96"', 'Wearables', 2999, 5999, 'AMOLED always-on display, Bluetooth calling and 100+ sport modes.', ['watch', '#1d2a33', '#475569', '#34d399'], { highlights: ['1.96" AMOLED', 'BT calling', 'SpO2 + HR', '7-day battery'], rating: 4.1, reviews: 3876 }),
      P('Fit Band 2', 'Wearables', 1499, 2499, 'A slim band for steps, sleep and stress — 14 days on a charge.', ['watch', '#1d2433', '#334155', '#facc15'], { highlights: ['14-day battery', 'Sleep tracking', '5 ATM'], rating: 4.0, reviews: 980 }),
      P('AeroBook 14 (i5, 16 GB, 512 GB)', 'Laptops', 54990, 64990, 'A 1.3 kg aluminium laptop with a 2.8K OLED screen and a full-day battery.', ['laptop', '#1d2433', '#64748b', '#60a5fa'], { highlights: ['Core i5 13th gen', '16 GB · 512 GB SSD', '14" 2.8K OLED', '1.3 kg'], rating: 4.5, reviews: 402 }),
      P('PowerCell 20000 mAh', 'Accessories', 1499, 2499, '22.5 W fast charging for phones and 20 W PD for iPhone. Charges 3 devices at once.', ['powerbank', '#1f2433', '#334155', '#22d3ee'], { highlights: ['20000 mAh', '22.5 W fast', '3 outputs'], rating: 4.3, reviews: 6120 }),
      P('65 W GaN Fast Charger', 'Accessories', 1799, 2999, 'Charges a laptop, phone and earbuds from one small brick.', ['charger', '#1f2433', '#e5e7eb', '#3b82f6'], { highlights: ['65 W GaN', 'USB-C + A', 'BIS certified'], rating: 4.4, reviews: 1450 }),
      P('Braided USB-C Cable 1.5 m', 'Accessories', 299, 599, 'Nylon braided, 60 W, tested for 20,000 bends.', ['cable', '#1f2433', '#9ca3af', '#f97316'], { highlights: ['60 W', '1.5 m braided'], rating: 4.2, reviews: 3011 }),
      P('Smart Wi-Fi Plug 16 A', 'Smart Home', 799, 1299, 'Run your geyser or AC on a schedule from your phone or voice assistant.', ['plug', '#1f2433', '#e5e7eb', '#34d399'], { highlights: ['16 A', 'Energy meter', 'Works with voice assistants'], rating: 4.1, reviews: 760 }),
      P('Smart LED Bulb 12 W', 'Smart Home', 499, 899, '16 million colours and tunable white, no hub needed.', ['bulb', '#2a2433', '#fde68a', '#facc15'], { highlights: ['12 W · B22', '16M colours'], rating: 4.0, reviews: 1122 }),
      P('Wi-Fi 6 Router AX1800', 'Smart Home', 3499, 4999, 'Dual-band Wi-Fi 6 that covers a 3BHK without dead zones.', ['router', '#1f2433', '#475569', '#60a5fa'], { highlights: ['Wi-Fi 6 AX1800', '4 antennas', 'Mesh ready'], rating: 4.3, reviews: 540 }),
    ],
  },
};

export const DEMO_THEMES = Object.keys(DEMOS);
export const isDemoHandle = (h) => /^demo-/.test(String(h || ''));
const handleOf = (t) => `demo-${t}`;
const themeOfHandle = (h) => (isDemoHandle(h) ? String(h).slice(5) : null);
const idOf = (t, i) => `${t}-${String(i + 1).padStart(2, '0')}`;
const imgOf = (t, id) => `/api/s/${handleOf(t)}/art/${id}.svg`;

// the public store, shaped like store.js publicStore
export function demoStore(handle) {
  const t = themeOfHandle(handle), d = DEMOS[t];
  if (!d) return null;
  const s = d.store;
  return {
    handle, name: s.name, tagline: s.tagline, about: s.about, color: '#6366f1', logo: '', categories: s.categories, policies: {}, policyPages: [],
    shipping: s.shipping, cod: s.cod, payments: 'demo', enabled: true, demo: true, pincode: true, whatsapp: '',
    theme: s.theme, themeOptions: { whatsapp: false, ...s.themeOptions },
  };
}
export function demoListings(handle) {
  const t = themeOfHandle(handle), d = DEMOS[t];
  if (!d) return [];
  return d.items.map((p, i) => {
    const id = idOf(t, i);
    const stock = i % 7 === 3 ? 3 : 40;
    return {
      id, title: p.title, description: p.description, category: p.category, images: [imgOf(t, id)], price: p.price, ...(p.mrp && p.mrp > p.price ? { mrp: p.mrp } : {}),
      kind: 'physical', unit: p.unit || '', stock, soldOut: false,
      ...(p.highlights ? { highlights: p.highlights } : {}), ...(p.sizes ? { sizes: p.sizes } : {}), ...(p.badge ? { badge: p.badge } : {}),
      ...(p.rating ? { rating: p.rating, reviews: p.reviews } : {}),
    };
  });
}
// the cart's prices for a demo store (same rules as the real quote: shipping and its free-above amount)
export function demoQuote(handle, body = {}) {
  const st = demoStore(handle), all = new Map(demoListings(handle).map((l) => [l.id, l]));
  const lines = [];
  for (const x of Array.isArray(body.cart) ? body.cart.slice(0, 50) : []) {
    const l = all.get(String(x?.id || '')), qty = Math.min(999, Math.floor(Number(x?.qty)));
    if (!l) return { status: 400, error: 'Something in your cart is no longer available — please remove it and try again', code: 'unavailable' };
    if (!(qty >= 1)) return { status: 400, error: 'Quantities must be 1 or more' };
    lines.push({ id: l.id, title: l.title, qty, unitPrice: l.price, amount: l.price * qty });
  }
  if (!lines.length) return { status: 400, error: 'Your cart is empty' };
  if (body.coupon) return { status: 400, error: 'Coupons work in your own store — this is a demo — remove it to continue', coupon: false, code: 'coupon' };
  const subtotal = lines.reduce((s, l) => s + l.amount, 0);
  const shipping = st.shipping.fee > 0 && !(st.shipping.freeAbove > 0 && subtotal >= st.shipping.freeAbove) ? st.shipping.fee : 0;
  const codFee = body.method === 'cod' && st.cod.fee > 0 ? st.cod.fee : 0;
  return { lines, subtotal, discount: 0, coupon: null, shipping, codFee, total: subtotal + shipping + codFee, needsAddress: true, codAllowed: true, digital: false, demo: true };
}
// → the SVG text for a demo product (or the store's own banner, id "hero"), or null
export function demoArt(handle, id) {
  const t = themeOfHandle(handle), d = DEMOS[t];
  if (!d) return null;
  const i = d.items.findIndex((_, j) => idOf(t, j) === id);
  if (i < 0) return null;
  const [k, bg, fg, ac, l] = d.items[i].art;
  return draw[t](k, bg, fg, ac, l);
}
