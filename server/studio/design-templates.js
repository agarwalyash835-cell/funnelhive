// Studio Designs' layouts: each template draws itself for any format (square, portrait, story, thumbnail) from the frame
// size, the safe area, the brand's colours and the words — so a headline that runs long shrinks and wraps inside its box
// instead of spilling, and text always sits on a scrim, panel or tint that keeps it readable over any photo.
// Elements are typeset.js's (rect, gradient, text, pill, stack, logo…). `space` tells the background picture where to
// leave room for the words; `fields` are the words a template takes (the copywriter fills them, the seller edits them).
import { mix, ink, readable, compose, safeBox, FORMATS, FAMILIES, hexOk } from './typeset.js';

const f = (key, label, max) => ({ key, label, max });
// the palette a template works with: the brand's colours when it has them, else the template's own
export function palette(primary, accent) {
  const p = primary, a = accent;
  return { p, a, aD: readable(a, '#141414', 3.2), pDeep: mix(p, '#000000', 0.4), onA: ink(a), onP: ink(p), light: '#fffaf0', cream: mix(p, '#fbf7ef', 0.93) };
}
// the frame: size, safe box and the shorter side (text sizes are fractions of it)
const box = (x) => { const { W, H, s } = x; return { X0: s.l, Y0: s.t, X1: W - s.r, Y1: H - s.b, CW: W - s.l - s.r, CH: H - s.t - s.b, S: Math.min(W, H), land: W > H, tall: H / W > 1.6 }; };
const full = (x, extra = {}) => ({ x: 0, y: 0, w: x.W, h: x.H, src: 'photo', ...extra });
const logoItem = (x, h, colour) => ({ type: 'logo', h, w: h * 3.2, brandText: x.t.brand, colour, family: x.family });

export const TEMPLATES = {
  // ---------- festive ----------
  'festive-glow': {
    name: 'Festive greeting', group: 'post', note: 'Diwali, Holi, Eid, Independence Day — a warm greeting over a glowing scene',
    fields: [f('kicker', 'Small line above', 40), f('headline', 'Greeting', 40), f('sub', 'Message', 120)],
    colours: ['#7a1022', '#f5c542'], family: 'serif',
    space: 'a warm festive scene with soft glowing light and decorations at the top and the edges; the centre and lower half calm, darker and uncluttered for a big greeting',
    sample: { kicker: 'Wishing you a', headline: 'Happy *Diwali*', sub: 'May this festival of lights bring joy, health and prosperity to your family' },
    build(x) {
      const b = box(x), { c, t, S } = { ...x, S: b.S }, m = S * 0.035;
      return {
        photos: [full(x)],
        elements: [
          { type: 'rect', x: 0, y: 0, w: x.W, h: x.H, fill: '#000000', opacity: b.land ? 0.4 : 0.12 },
          { type: 'gradient', x: 0, y: 0, w: x.W, h: x.H * 0.3, dir: 'up', from: 0, to: 0.5 },
          { type: 'gradient', x: 0, y: x.H * 0.3, w: x.W, h: x.H * 0.7, dir: 'down', from: 0.05, to: 0.88, fill: mix(c.pDeep, '#000000', 0.5) },
          { type: 'rect', x: m, y: m, w: x.W - 2 * m, h: x.H - 2 * m, fill: '#000000', opacity: 0, stroke: c.aD, strokeW: S * 0.004, r: S * 0.012 },
          { type: 'rect', x: m + S * 0.016, y: m + S * 0.016, w: x.W - 2 * m - S * 0.032, h: x.H - 2 * m - S * 0.032, fill: '#000000', opacity: 0, stroke: c.aD, strokeW: S * 0.0015, r: S * 0.008 },
          { type: 'stack', x: b.X0 + b.CW * 0.05, y: b.land ? b.Y0 + b.CH * 0.1 : b.Y0 + b.CH * 0.32, w: b.CW * 0.9, h: b.land ? b.CH * 0.9 : b.CH * 0.68, align: 'center', valign: b.land ? 'middle' : 'bottom', gap: S * 0.022, items: [
            { type: 'text', text: t.kicker, family: 'sans', weight: 600, spacing: 0.16, upper: true, colour: c.aD, max: S * 0.042, maxLines: 1, share: 0.08 },
            { type: 'text', text: t.headline, family: x.family, weight: 800, colour: c.light, hot: c.aD, max: S * (b.land ? 0.17 : 0.155), min: S * 0.06, maxLines: 3, share: 0.46, lh: 1.04, shadow: { colour: c.a, opacity: 0.55, dx: 0, dy: 0, blur: S * 0.02 } },
            { type: 'rule', w: S * 0.22, h: S * 0.006, fill: c.aD },
            { type: 'text', text: t.sub, family: 'sans', weight: 500, colour: '#fff6e5', max: S * 0.042, min: S * 0.026, maxLines: 3, share: 0.2, lh: 1.2 },
            { type: 'space', h: S * 0.01 },
            logoItem(x, S * 0.075, c.light),
          ] },
        ],
      };
    },
  },
  'festive-frame': {
    name: 'Festive card', group: 'post', note: 'A photo above an ornate brand-colour card with the greeting',
    fields: [f('kicker', 'Small line above', 40), f('headline', 'Greeting', 40), f('sub', 'Message', 110)],
    colours: ['#5b0f2e', '#e9b949'], family: 'serif',
    space: 'a festive scene with the subject centred, filling the frame, rich colours',
    sample: { kicker: 'Season’s greetings', headline: 'Happy Holi', sub: 'Colours of joy from all of us to you and your family' },
    build(x) {
      const b = box(x), S = b.S, { c, t } = x;
      const split = b.land ? x.W * 0.54 : x.H * (b.tall ? 0.5 : x.H > x.W ? 0.55 : 0.5);
      const panel = b.land ? { x: split, y: 0, w: x.W - split, h: x.H } : { x: 0, y: split, w: x.W, h: x.H - split };
      const inner = b.land ? { x: panel.x + S * 0.08, y: b.Y0, w: panel.w - S * 0.08 - x.s.r, h: b.CH } : { x: b.X0, y: panel.y + S * 0.07, w: b.CW, h: b.Y1 - panel.y - S * 0.07 };
      const o = S * 0.025;
      return {
        photos: [b.land ? { x: 0, y: 0, w: split, h: x.H, src: 'photo' } : { x: 0, y: 0, w: x.W, h: split, src: 'photo' }],
        fill: c.pDeep,
        elements: [
          { type: 'rect', ...panel, fill: c.pDeep },
          { type: 'rect', x: panel.x + o, y: panel.y + o, w: panel.w - 2 * o, h: panel.h - 2 * o, fill: '#000000', opacity: 0, stroke: c.aD, strokeW: S * 0.003, r: S * 0.01 },
          b.land ? { type: 'rect', x: split - S * 0.006, y: 0, w: S * 0.012, h: x.H, fill: c.aD } : { type: 'rect', x: 0, y: split - S * 0.006, w: x.W, h: S * 0.012, fill: c.aD },
          { type: 'poly', points: b.land ? [[split, x.H / 2 - S * 0.045], [split + S * 0.03, x.H / 2], [split, x.H / 2 + S * 0.045], [split - S * 0.03, x.H / 2]] : [[x.W / 2 - S * 0.045, split], [x.W / 2, split - S * 0.03], [x.W / 2 + S * 0.045, split], [x.W / 2, split + S * 0.03]], fill: c.aD },
          { type: 'stack', ...inner, align: 'center', valign: 'middle', gap: S * 0.02, items: [
            { type: 'text', text: t.kicker, family: 'sans', weight: 600, spacing: 0.14, upper: true, colour: c.aD, max: S * 0.036, maxLines: 1, share: 0.1 },
            { type: 'text', text: t.headline, family: x.family, weight: 800, colour: c.light, hot: c.aD, max: S * 0.12, min: S * 0.05, maxLines: 2, share: 0.42, lh: 1.04 },
            { type: 'text', text: t.sub, family: 'sans', weight: 500, colour: mix(c.light, c.pDeep, 0.15), max: S * 0.036, min: S * 0.024, maxLines: 3, share: 0.24, lh: 1.2 },
            logoItem(x, S * 0.065, c.aD),
          ] },
        ],
      };
    },
  },
  // ---------- sales and offers ----------
  'sale-burst': {
    name: 'Big sale', group: 'post', note: 'A loud sale poster: offer burst, headline, dates and a button',
    fields: [f('kicker', 'Tag', 24), f('badge', 'Offer in the burst', 18), f('headline', 'Headline', 40), f('sub', 'Details', 90), f('date', 'Dates', 40), f('cta', 'Button', 24)],
    colours: ['#d7263d', '#ffd23f'], family: 'display',
    space: 'the products or a shopping scene in the upper half, bright and appealing; the bottom 40% simple and darker for text; the top right corner uncluttered',
    sample: { kicker: 'Limited time', badge: 'Up to 50% OFF', headline: 'Mega *Festive* Sale', sub: 'On sarees, kurtas and lehengas — free delivery across India', date: '20–25 October', cta: 'Shop now' },
    build(x) {
      const b = box(x), S = b.S, { c, t } = x, R = S * (b.land ? 0.2 : 0.165);
      const cx = b.land ? b.X1 - R * 1.05 : b.X1 - R * 0.95, cy = b.land ? x.H * 0.47 : b.Y0 + R * 1.05;
      return {
        photos: [full(x)],
        elements: [
          { type: 'gradient', x: 0, y: 0, w: x.W, h: x.H * 0.25, dir: 'up', from: 0, to: 0.35 },
          b.land ? { type: 'gradient', x: 0, y: 0, w: x.W * 0.7, h: x.H, dir: 'left', from: 0, to: 0.85 } : { type: 'gradient', x: 0, y: x.H * 0.4, w: x.W, h: x.H * 0.6, dir: 'down', from: 0, to: 0.92 },
          { type: 'pill', text: t.kicker, x: b.X0, y: b.Y0, fill: c.a, colour: c.onA, size: S * 0.034, upper: true, weight: 800, spacing: 0.08, r: S * 0.008 },
          { type: 'ellipse', cx: cx + S * 0.008, cy: cy + S * 0.012, rx: R, ry: R, fill: '#000000', opacity: 0.3, blur: 8 },
          { type: 'star', cx, cy, r: R * 1.22, fill: mix(c.a, '#ffffff', 0.35), opacity: 0.85 },
          { type: 'ellipse', cx, cy, rx: R, ry: R, fill: c.a },
          { type: 'ellipse', cx, cy, rx: R * 0.88, ry: R * 0.88, fill: '#000000', opacity: 0, stroke: c.onA, strokeW: S * 0.003 },
          { type: 'text', text: t.badge, x: cx - R * 0.68, y: cy - R * 0.62, w: R * 1.36, h: R * 1.24, align: 'center', valign: 'middle', weight: 900, upper: true, colour: c.onA, max: R * 0.55, min: R * 0.2, maxLines: 3, lh: 1.0, rot: -8, org: [cx, cy] },
          { type: 'stack', x: b.X0, y: b.land ? b.Y0 + S * 0.12 : x.H * 0.42, w: b.land ? b.CW * 0.56 : b.CW * 0.94, h: b.land ? b.CH - S * 0.12 : b.Y1 - x.H * 0.42, align: 'left', valign: b.land ? 'middle' : 'bottom', gap: S * 0.02, items: [
            { type: 'text', text: t.headline, weight: 900, upper: true, colour: '#ffffff', hot: c.aD, max: S * (b.land ? 0.13 : 0.12), min: S * 0.05, maxLines: 3, share: 0.5, lh: 1.0, shadow: { opacity: 0.4 } },
            { type: 'text', text: t.sub, weight: 500, colour: '#f3f3f3', max: S * 0.04, min: S * 0.026, maxLines: 2, share: 0.16, lh: 1.2 },
            { type: 'text', text: t.date, weight: 800, colour: c.aD, upper: true, spacing: 0.06, max: S * 0.036, maxLines: 1, share: 0.07 },
            { type: 'pill', text: t.cta, fill: c.a, colour: c.onA, size: S * 0.042, weight: 800, shadowBox: true },
          ] },
        ],
      };
    },
  },
  'offer-banner': {
    name: 'Price offer', group: 'post', note: 'The product photo above a brand-colour band with a big price, the old price struck out and a button',
    fields: [f('headline', 'Product / headline', 50), f('price', 'Price', 16), f('was', 'Old price', 16), f('sub', 'Details', 70), f('cta', 'Button', 24)],
    colours: ['#1d3557', '#ffb703'], family: 'sans',
    space: 'the product as the hero, centred in the upper part of the frame on a clean background, studio light',
    sample: { headline: 'Pure Desi Cow Ghee, 1 litre', price: '₹499', was: '₹699', sub: 'Farm fresh · Free delivery over ₹999', cta: 'Order on WhatsApp' },
    build(x) {
      const b = box(x), S = b.S, { c, t } = x;
      const cut = b.land ? x.W * 0.56 : x.H * (b.tall ? 0.56 : 0.58), tilt = S * 0.06;
      const band = b.land ? [[cut - tilt, 0], [x.W, 0], [x.W, x.H], [cut + tilt * 0.4, x.H]] : [[0, cut + tilt * 0.5], [x.W, cut - tilt * 0.5], [x.W, x.H], [0, x.H]];
      const inner = b.land ? { x: cut + S * 0.06, y: b.Y0, w: b.X1 - cut - S * 0.06, h: b.CH } : { x: b.X0, y: cut + tilt, w: b.CW, h: b.Y1 - cut - tilt };
      return {
        photos: [b.land ? { x: 0, y: 0, w: cut + tilt, h: x.H, src: 'photo' } : { x: 0, y: 0, w: x.W, h: cut + tilt, src: 'photo' }],
        fill: c.p,
        elements: [
          { type: 'poly', points: band, fill: c.p },
          { type: 'poly', points: b.land ? [[cut - tilt - S * 0.02, 0], [cut - tilt, 0], [cut + tilt * 0.4, x.H], [cut + tilt * 0.4 - S * 0.02, x.H]] : [[0, cut + tilt * 0.5 - S * 0.018], [x.W, cut - tilt * 0.5 - S * 0.018], [x.W, cut - tilt * 0.5], [0, cut + tilt * 0.5]], fill: c.a },
          { type: 'stack', ...inner, align: b.land ? 'left' : 'center', valign: 'middle', gap: S * 0.016, items: [
            { type: 'text', text: t.headline, weight: 800, colour: c.onP, hot: readable(c.a, c.p, 3), max: S * 0.065, min: S * 0.035, maxLines: 2, share: 0.26, lh: 1.08 },
            { type: 'text', text: t.price, weight: 900, colour: readable(c.a, c.p, 3), max: S * 0.15, min: S * 0.07, maxLines: 1, share: 0.3, lh: 1.0 },
            { type: 'text', text: t.was, weight: 500, strike: true, colour: mix(c.onP, c.p, 0.3), max: S * 0.045, maxLines: 1, share: 0.12 },
            { type: 'text', text: t.sub, weight: 500, colour: mix(c.onP, c.p, 0.15), max: S * 0.034, min: S * 0.024, maxLines: 2, share: 0.12, lh: 1.2 },
            { type: 'pill', text: t.cta, fill: c.a, colour: c.onA, size: S * 0.04, weight: 800 },
          ] },
          { type: 'logo', x: b.land ? b.X0 : b.X0, y: b.Y0, w: S * 0.24, h: S * 0.08, align: 'left', valign: 'top', brandText: t.brand, colour: '#ffffff' },
        ],
      };
    },
  },
  'product-launch': {
    name: 'New launch', group: 'post', note: 'A product launch: NEW tag, bold headline on the left, price and a button',
    fields: [f('tag', 'Tag', 16), f('headline', 'Headline', 44), f('sub', 'Details', 100), f('price', 'Price', 20), f('cta', 'Button', 24)],
    colours: ['#111827', '#22d3ee'], family: 'sans',
    space: 'the product on the right half of the frame, dramatic studio light, dark background; the left half empty and dark for text',
    sample: { tag: 'New', headline: 'Meet the *Aura* smartwatch', sub: '14-day battery, AMOLED display and SpO2 tracking', price: 'Launch price ₹2,999', cta: 'Pre-order now' },
    build(x) {
      const b = box(x), S = b.S, { c, t } = x, side = !b.tall;
      return {
        photos: [full(x)],
        elements: [
          side ? { type: 'gradient', x: 0, y: 0, w: x.W * 0.78, h: x.H, dir: 'left', from: 0, to: 0.9, fill: mix(c.p, '#000000', 0.6) } : { type: 'gradient', x: 0, y: x.H * 0.38, w: x.W, h: x.H * 0.62, dir: 'down', from: 0, to: 0.92, fill: mix(c.p, '#000000', 0.6) },
          { type: 'pill', text: t.tag, x: b.X0, y: b.Y0, fill: c.a, colour: c.onA, size: S * 0.036, upper: true, weight: 900, spacing: 0.12, r: S * 0.006 },
          { type: 'stack', x: b.X0, y: side ? b.Y0 + S * 0.1 : x.H * 0.45, w: side ? b.CW * 0.56 : b.CW, h: side ? b.CH - S * 0.1 : b.Y1 - x.H * 0.45, align: 'left', valign: side ? 'middle' : 'bottom', gap: S * 0.022, items: [
            { type: 'text', text: t.headline, weight: 900, colour: '#ffffff', hot: c.aD, max: S * 0.105, min: S * 0.05, maxLines: 4, share: 0.48, lh: 1.02 },
            { type: 'text', text: t.sub, weight: 400, colour: '#d9dde3', max: S * 0.036, min: S * 0.025, maxLines: 3, share: 0.18, lh: 1.25 },
            { type: 'text', text: t.price, weight: 800, colour: c.aD, max: S * 0.05, maxLines: 1, share: 0.08 },
            { type: 'pill', text: t.cta, fill: '#ffffff', colour: '#111111', size: S * 0.038, weight: 800 },
            { type: 'space', h: S * 0.01 },
            logoItem(x, S * 0.06, '#ffffff'),
          ] },
        ],
      };
    },
  },
  testimonial: {
    name: 'Customer quote', group: 'post', note: 'A customer’s words in big type, stars and their name',
    fields: [f('quote', 'Their words', 220), f('author', 'Name', 40), f('detail', 'Who they are', 50)],
    colours: ['#1f2a44', '#f4b942'], family: 'serif',
    space: 'a soft, out-of-focus lifestyle scene with the product, calm and even (it sits behind a colour tint)',
    sample: { quote: 'The ghee smells exactly like my nani’s kitchen. My kids now ask for it with every meal!', author: 'Priya Sharma', detail: 'Customer from Pune' },
    build(x) {
      const b = box(x), S = b.S, { c, t } = x;
      return {
        photos: [full(x, { look: 'blur' })],
        elements: [
          { type: 'rect', x: 0, y: 0, w: x.W, h: x.H, fill: c.pDeep, opacity: 0.84 },
          { type: 'text', text: '“', x: b.X0, y: b.Y0 - S * 0.03, w: b.CW, h: S * 0.2, align: 'center', family: 'serif', weight: 900, colour: c.aD, max: S * 0.3, maxLines: 1, lh: 1 },
          ...[-2, -1, 0, 1, 2].map((k) => ({ type: 'star', cx: x.W / 2 + k * S * 0.06, cy: b.Y0 + S * 0.2, r: S * 0.024, fill: c.aD })),
          { type: 'stack', x: b.X0 + b.CW * 0.04, y: b.Y0 + S * 0.26, w: b.CW * 0.92, h: b.CH - S * 0.26 - S * 0.12, align: 'center', valign: 'middle', gap: S * 0.025, items: [
            { type: 'text', text: t.quote, family: x.family, italic: true, weight: 500, colour: '#ffffff', max: S * 0.07, min: S * 0.034, maxLines: 7, share: 0.72, lh: 1.22 },
            { type: 'rule', w: S * 0.1, h: S * 0.005, fill: c.aD },
            { type: 'text', text: t.author, weight: 800, upper: true, spacing: 0.08, colour: c.aD, max: S * 0.038, maxLines: 1, share: 0.07 },
            { type: 'text', text: t.detail, weight: 400, colour: '#cfd5e2', max: S * 0.03, maxLines: 1, share: 0.06 },
          ] },
          { type: 'logo', x: x.W / 2 - S * 0.15, y: b.Y1 - S * 0.08, w: S * 0.3, h: S * 0.08, align: 'center', valign: 'bottom', brandText: t.brand, colour: '#ffffff' },
        ],
      };
    },
  },
  'before-after': {
    name: 'Before / after', group: 'post', note: 'Two photos side by side with labels and the result in words (add your own before photo)',
    fields: [f('before', 'Left label', 14), f('after', 'Right label', 14), f('headline', 'Headline', 50), f('sub', 'Details', 80), f('cta', 'Button', 24)],
    colours: ['#0f172a', '#22c55e'], family: 'sans',
    space: 'the result: the subject centred, bright and clear, filling the frame',
    sample: { before: 'Before', after: 'After', headline: 'Glowing skin in *21 days*', sub: 'With our 100% natural kumkumadi face oil', cta: 'Try it today' },
    build(x) {
      const b = box(x), S = b.S, { c, t } = x, vert = b.tall;
      const barH = vert ? x.H * 0.3 : b.land ? x.H * 0.28 : x.H * 0.26, ph = x.H - barH;
      const A = vert ? { x: 0, y: 0, w: x.W, h: ph / 2 } : { x: 0, y: 0, w: x.W / 2, h: ph };
      const B = vert ? { x: 0, y: ph / 2, w: x.W, h: ph / 2 } : { x: x.W / 2, y: 0, w: x.W / 2, h: ph };
      const hx = vert ? x.W / 2 : x.W / 2, hy = vert ? ph / 2 : ph / 2, r = S * 0.045;
      return {
        photos: [{ ...A, src: 'photo2', look: x.hasPhoto2 ? '' : 'grey' }, { ...B, src: 'photo' }],
        fill: c.p,
        elements: [
          { type: 'rect', x: 0, y: ph, w: x.W, h: barH, fill: c.p },
          vert ? { type: 'rect', x: 0, y: ph / 2 - S * 0.005, w: x.W, h: S * 0.01, fill: '#ffffff' } : { type: 'rect', x: x.W / 2 - S * 0.005, y: 0, w: S * 0.01, h: ph, fill: '#ffffff' },
          { type: 'ellipse', cx: hx, cy: hy, rx: r, ry: r, fill: '#ffffff' },
          { type: 'poly', points: vert ? [[hx - r * 0.35, hy - r * 0.1], [hx + r * 0.35, hy - r * 0.1], [hx, hy - r * 0.5]] : [[hx - r * 0.1, hy - r * 0.35], [hx - r * 0.1, hy + r * 0.35], [hx - r * 0.5, hy]], fill: c.p },
          { type: 'poly', points: vert ? [[hx - r * 0.35, hy + r * 0.1], [hx + r * 0.35, hy + r * 0.1], [hx, hy + r * 0.5]] : [[hx + r * 0.1, hy - r * 0.35], [hx + r * 0.1, hy + r * 0.35], [hx + r * 0.5, hy]], fill: c.p },
          { type: 'pill', text: t.before, x: A.x + S * 0.04, y: Math.max(A.y, vert ? x.s.t : 0) + S * 0.04, fill: '#111111', opacity: 0.8, colour: '#ffffff', size: S * 0.034, upper: true, weight: 800, spacing: 0.1 },
          { type: 'pill', text: t.after, x: B.x + B.w - S * 0.04, y: B.y + S * 0.04, align: 'right', fill: c.a, colour: c.onA, size: S * 0.034, upper: true, weight: 800, spacing: 0.1 },
          { type: 'stack', x: b.X0, y: ph + S * 0.035, w: b.CW, h: Math.min(x.H - x.s.b, x.H - S * 0.03) - ph - S * 0.035, align: 'center', valign: 'middle', gap: S * 0.016, items: [
            { type: 'text', text: t.headline, weight: 900, colour: c.onP, hot: readable(c.a, c.p, 3), max: S * 0.075, min: S * 0.04, maxLines: 2, share: 0.5, lh: 1.04 },
            { type: 'text', text: t.sub, weight: 500, colour: mix(c.onP, c.p, 0.2), max: S * 0.034, min: S * 0.024, maxLines: 2, share: 0.22, lh: 1.2 },
            { type: 'pill', text: t.cta, fill: c.a, colour: c.onA, size: S * 0.034, weight: 800 },
          ] },
        ],
      };
    },
  },
  editorial: {
    name: 'Minimal editorial', group: 'post', note: 'Quiet and premium: a cream panel with a serif headline beside the photo',
    fields: [f('kicker', 'Small line above', 36), f('headline', 'Headline', 60), f('sub', 'Details', 110)],
    colours: ['#2b2118', '#c2410c'], family: 'serif',
    space: 'an elegant, minimal photo of the subject with soft natural light and lots of breathing room',
    sample: { kicker: 'The handloom edit', headline: 'Woven slowly, *worn* for years', sub: 'Pure Chanderi silk sarees, handwoven by artisans in Madhya Pradesh' },
    build(x) {
      const b = box(x), S = b.S, { c, t } = x;
      const cut = b.land ? x.W * 0.46 : x.H * (b.tall ? 0.46 : 0.47), dark = mix(c.p, '#000000', 0.2), cream = c.cream;
      const inner = b.land ? { x: b.X0 + S * 0.02, y: b.Y0, w: cut - b.X0 - S * 0.08, h: b.CH } : { x: b.X0, y: b.Y0, w: b.CW, h: cut - b.Y0 - S * 0.06 };
      return {
        photos: [b.land ? { x: cut, y: 0, w: x.W - cut, h: x.H, src: 'photo' } : { x: 0, y: cut, w: x.W, h: x.H - cut, src: 'photo' }],
        fill: cream,
        elements: [
          { type: 'rect', ...(b.land ? { x: 0, y: 0, w: cut, h: x.H } : { x: 0, y: 0, w: x.W, h: cut }), fill: cream },
          { type: 'stack', ...inner, align: 'left', valign: b.land ? 'middle' : 'bottom', gap: S * 0.02, items: [
            logoItem(x, S * 0.055, dark),
            { type: 'space', h: S * 0.01 },
            { type: 'text', text: t.kicker, weight: 700, upper: true, spacing: 0.16, colour: readable(c.a, cream, 3), max: S * 0.03, maxLines: 1, share: 0.06 },
            { type: 'text', text: t.headline, family: x.family, weight: 600, colour: readable(dark, cream, 7), hot: readable(c.a, cream, 3), max: S * 0.095, min: S * 0.045, maxLines: 3, share: 0.5, lh: 1.08 },
            { type: 'rule', w: S * 0.12, h: S * 0.004, fill: readable(c.a, cream, 3) },
            { type: 'text', text: t.sub, weight: 400, colour: mix(readable(dark, cream, 7), cream, 0.25), max: S * 0.032, min: S * 0.024, maxLines: 3, share: 0.18, lh: 1.3 },
          ] },
        ],
      };
    },
  },
  event: {
    name: 'Event / date', group: 'post', note: 'An announcement with a big date block: a launch, a live session, a store opening, a national day',
    fields: [f('day', 'Day (number)', 6), f('month', 'Month', 10), f('kicker', 'Small line above', 36), f('headline', 'Headline', 50), f('sub', 'Time / place', 80), f('cta', 'Button', 24)],
    colours: ['#0b3d91', '#ff9933'], family: 'sans',
    space: 'the scene for the occasion, with the lower half calmer and darker for text',
    sample: { day: '15', month: 'Aug', kicker: 'Independence Day', headline: 'Freedom *Sale* Live', sub: '9 AM – 9 PM · All stores and online', cta: 'Set a reminder' },
    build(x) {
      const b = box(x), S = b.S, { c, t } = x, bw = S * 0.19, bh = S * 0.21;
      return {
        photos: [full(x)],
        elements: [
          { type: 'rect', x: 0, y: 0, w: x.W, h: x.H, fill: '#000000', opacity: 0.18 },
          b.land ? { type: 'gradient', x: 0, y: 0, w: x.W * 0.72, h: x.H, dir: 'left', from: 0, to: 0.85 } : { type: 'gradient', x: 0, y: x.H * 0.35, w: x.W, h: x.H * 0.65, dir: 'down', from: 0, to: 0.9 },
          { type: 'rect', x: b.X0 + S * 0.006, y: b.Y0 + S * 0.01, w: bw, h: bh, fill: '#000000', opacity: 0.3, r: S * 0.018, blur: 6 },
          { type: 'rect', x: b.X0, y: b.Y0, w: bw, h: bh, fill: c.a, r: S * 0.018 },
          { type: 'rect', x: b.X0, y: b.Y0, w: bw, h: bh * 0.3, fill: c.pDeep, r: S * 0.018 },
          { type: 'rect', x: b.X0, y: b.Y0 + bh * 0.15, w: bw, h: bh * 0.15, fill: c.pDeep },
          { type: 'text', text: t.month, x: b.X0, y: b.Y0 + bh * 0.04, w: bw, h: bh * 0.24, align: 'center', valign: 'middle', weight: 800, upper: true, spacing: 0.1, colour: '#ffffff', max: bh * 0.17, maxLines: 1, lh: 1 },
          { type: 'text', text: t.day, x: b.X0, y: b.Y0 + bh * 0.3, w: bw, h: bh * 0.7, align: 'center', valign: 'middle', weight: 900, colour: c.onA, max: bh * 0.56, maxLines: 1, lh: 1 },
          { type: 'logo', x: b.X1 - S * 0.36, y: b.Y0, w: S * 0.36, h: S * 0.09, align: 'right', valign: 'top', brandText: t.brand, colour: '#ffffff' },
          { type: 'stack', x: b.X0, y: b.land ? b.Y0 + bh + S * 0.04 : x.H * 0.42, w: b.land ? b.CW * 0.6 : b.CW * 0.94, h: b.land ? b.CH - bh - S * 0.04 : b.Y1 - x.H * 0.42, align: 'left', valign: 'bottom', gap: S * 0.02, items: [
            { type: 'text', text: t.kicker, weight: 700, upper: true, spacing: 0.14, colour: c.aD, max: S * 0.036, maxLines: 1, share: 0.08 },
            { type: 'text', text: t.headline, weight: 900, upper: true, colour: '#ffffff', hot: c.aD, max: S * 0.11, min: S * 0.05, maxLines: 3, share: 0.5, lh: 1.0, shadow: { opacity: 0.35 } },
            { type: 'text', text: t.sub, weight: 500, colour: '#eeeeee', max: S * 0.038, min: S * 0.026, maxLines: 2, share: 0.14, lh: 1.2 },
            { type: 'pill', text: t.cta, fill: '#ffffff', colour: '#111111', size: S * 0.038, weight: 800 },
          ] },
        ],
      };
    },
  },
  // ---------- YouTube thumbnails ----------
  'yt-bold': {
    name: 'Thumbnail: bold words', group: 'thumbnail', note: 'Huge outlined words with one in yellow, the face or product on the right',
    fields: [f('headline', 'Big words (2–5)', 32), f('badge', 'Sticker', 16)],
    colours: ['#111111', '#ffe600'], family: 'display',
    space: 'an expressive face or the product on the RIGHT third of the frame, close-up, high contrast and saturated; the left side darker and simple for big text',
    sample: { headline: 'I tried *₹99* ghee', badge: 'Honest review' },
    build(x) {
      const b = box(x), S = b.S, { c, t } = x, side = b.land || !b.tall && x.W === x.H;
      return {
        photos: [full(x)],
        elements: [
          side ? { type: 'gradient', x: 0, y: 0, w: x.W * 0.72, h: x.H, dir: 'left', from: 0, to: 0.88 } : { type: 'gradient', x: 0, y: x.H * 0.4, w: x.W, h: x.H * 0.6, dir: 'down', from: 0, to: 0.9 },
          { type: 'pill', text: t.badge, x: b.X0, y: b.Y0, fill: '#e11d1d', colour: '#ffffff', size: S * 0.055, upper: true, weight: 900, r: S * 0.01, rot: 4, shadowBox: true },
          { type: 'text', text: t.headline, x: b.X0, y: side ? b.Y0 + S * 0.14 : x.H * 0.45, w: side ? b.CW * 0.62 : b.CW, h: side ? b.CH - S * 0.14 : b.Y1 - x.H * 0.45, align: 'left', valign: side ? 'middle' : 'bottom', weight: 900, upper: true, colour: '#ffffff', hot: c.a === '#111111' ? '#ffe600' : readable(c.a, '#111111', 4), max: S * (b.land ? 0.24 : 0.17), min: S * 0.08, maxLines: 3, lh: 0.98, outline: { colour: '#000000', w: S * 0.012 }, shadow: { opacity: 0.6, dx: S * 0.012, dy: S * 0.014, blur: S * 0.012 } },
          { type: 'logo', x: b.X0, y: b.Y1 - S * 0.07, w: S * 0.22, h: S * 0.07, align: 'left', valign: 'bottom', brandText: '', colour: '#ffffff' },
        ],
      };
    },
  },
  'yt-split': {
    name: 'Thumbnail: colour split', group: 'thumbnail', note: 'A slanted brand-colour panel with the words, the photo beside it and an arrow',
    fields: [f('headline', 'Big words (2–6)', 40), f('badge', 'Sticker', 16)],
    colours: ['#e11d48', '#ffe600'], family: 'display',
    space: 'the subject (a face or the product) on the RIGHT half, bright and sharp, simple background',
    sample: { headline: '5 *mistakes* new sellers make', badge: 'Watch first' },
    build(x) {
      const b = box(x), S = b.S, { c, t } = x;
      if (b.land) {
        const e = x.W * 0.47;
        return {
          photos: [{ x: x.W * 0.36, y: 0, w: x.W * 0.64, h: x.H, src: 'photo' }],
          fill: c.p,
          elements: [
            { type: 'poly', points: [[0, 0], [e, 0], [e - S * 0.14, x.H], [0, x.H]], fill: c.p },
            { type: 'poly', points: [[e, 0], [e + S * 0.025, 0], [e - S * 0.14 + S * 0.025, x.H], [e - S * 0.14, x.H]], fill: c.a },
            { type: 'text', text: t.headline, x: b.X0, y: b.Y0, w: e - S * 0.2 - b.X0, h: b.CH - S * 0.1, align: 'left', valign: 'middle', weight: 900, upper: true, colour: c.onP, hot: readable(c.a, c.p, 2.5), max: S * 0.2, min: S * 0.07, maxLines: 4, lh: 0.98, shadow: { opacity: 0.35, dx: S * 0.008, dy: S * 0.01, blur: S * 0.006 } },
            { type: 'poly', points: [[e - S * 0.04, x.H * 0.62], [e + S * 0.12, x.H * 0.62], [e + S * 0.12, x.H * 0.56], [e + S * 0.22, x.H * 0.68], [e + S * 0.12, x.H * 0.8], [e + S * 0.12, x.H * 0.74], [e - S * 0.04, x.H * 0.74]], fill: c.a },
            { type: 'pill', text: t.badge, x: b.X1, y: b.Y0, align: 'right', fill: c.a, colour: c.onA, size: S * 0.055, upper: true, weight: 900, r: S * 0.01, rot: -4, shadowBox: true },
          ],
        };
      }
      const cut = x.H * 0.55;
      return {
        photos: [{ x: 0, y: 0, w: x.W, h: cut + S * 0.1, src: 'photo' }],
        fill: c.p,
        elements: [
          { type: 'poly', points: [[0, cut + S * 0.08], [x.W, cut - S * 0.02], [x.W, x.H], [0, x.H]], fill: c.p },
          { type: 'poly', points: [[0, cut + S * 0.06], [x.W, cut - S * 0.04], [x.W, cut - S * 0.02], [0, cut + S * 0.08]], fill: c.a },
          { type: 'text', text: t.headline, x: b.X0, y: cut + S * 0.12, w: b.CW, h: b.Y1 - cut - S * 0.12, align: 'left', valign: 'middle', weight: 900, upper: true, colour: c.onP, hot: readable(c.a, c.p, 2.5), max: S * 0.16, min: S * 0.07, maxLines: 4, lh: 0.98 },
          { type: 'pill', text: t.badge, x: b.X1, y: b.Y0, align: 'right', fill: c.a, colour: c.onA, size: S * 0.05, upper: true, weight: 900, r: S * 0.01, rot: -4, shadowBox: true },
        ],
      };
    },
  },
  // ---------- carousels: a cover, content slides, an end slide — one background, one look ----------
  'carousel-cover': {
    name: 'Carousel cover', group: 'carousel', note: 'The first slide: a hook that makes people swipe',
    fields: [f('kicker', 'Tag', 30), f('headline', 'Hook', 70), f('sub', 'Promise', 90), f('swipe', 'Swipe label', 16)],
    colours: ['#0f172a', '#38bdf8'], family: 'sans',
    space: 'a striking photo for the topic with the lower half calm and darker for a big title',
    sample: { kicker: 'Save this', headline: '5 ways to make your *ghee* last longer', sub: 'Simple kitchen habits our grandmothers swore by', swipe: 'Swipe' },
    build(x) {
      const b = box(x), S = b.S, { c, t } = x, sh = S * 0.04;
      return {
        photos: [full(x)],
        elements: [
          { type: 'gradient', x: 0, y: x.H * 0.3, w: x.W, h: x.H * 0.7, dir: 'down', from: 0, to: 0.92, fill: mix(c.p, '#000000', 0.5) },
          { type: 'logo', x: b.X0, y: b.Y0, w: S * 0.26, h: S * 0.07, align: 'left', valign: 'top', brandText: t.brand, colour: '#ffffff' },
          { type: 'stack', x: b.X0, y: x.H * 0.36, w: b.CW, h: b.Y1 - x.H * 0.36 - S * 0.1, align: 'left', valign: 'bottom', gap: S * 0.022, items: [
            { type: 'pill', text: t.kicker, fill: c.a, colour: c.onA, size: S * 0.032, upper: true, weight: 800, spacing: 0.08, r: S * 0.008 },
            { type: 'text', text: t.headline, weight: 900, colour: '#ffffff', hot: c.aD, max: S * 0.11, min: S * 0.05, maxLines: 4, share: 0.6, lh: 1.02 },
            { type: 'text', text: t.sub, weight: 400, colour: '#e5e7eb', max: S * 0.04, min: S * 0.026, maxLines: 2, share: 0.16, lh: 1.25 },
          ] },
          { type: 'pill', text: t.swipe, x: b.X1 - sh * 2.2, y: b.Y1, align: 'right', valign: 'bottom', fill: '#ffffff', colour: '#111111', size: S * 0.032, upper: true, weight: 800, spacing: 0.1 },
          { type: 'poly', points: [[b.X1 - sh * 1.6, b.Y1 - S * 0.065], [b.X1 - sh * 0.2, b.Y1 - S * 0.04], [b.X1 - sh * 1.6, b.Y1 - S * 0.015]], fill: '#ffffff' },
        ],
      };
    },
  },
  'carousel-content': {
    name: 'Carousel slide', group: 'carousel', note: 'A numbered point: a heading and a few lines',
    fields: [f('heading', 'Heading', 60), f('body', 'Text', 260)],
    colours: ['#0f172a', '#38bdf8'], family: 'sans', space: '',
    sample: { heading: 'Store it in glass, not plastic', body: 'Glass keeps air and smells out. Use a dry, clean spoon every time — one drop of water is enough to spoil a whole jar.' },
    build(x) {
      const b = box(x), S = b.S, { c, t } = x, n = x.slide || 1, total = x.slides || 1;
      const dots = Math.min(12, total), dr = S * 0.008, dg = S * 0.03;
      return {
        photos: [full(x, { look: 'blur' })],
        elements: [
          { type: 'rect', x: 0, y: 0, w: x.W, h: x.H, fill: mix(c.p, '#000000', 0.45), opacity: 0.88 },
          { type: 'rect', x: 0, y: 0, w: S * 0.018, h: x.H, fill: c.aD },
          { type: 'text', text: String(n).padStart(2, '0'), x: b.X0, y: b.Y0, w: b.CW / 2, h: S * 0.16, align: 'left', weight: 900, colour: c.aD, max: S * 0.15, maxLines: 1, lh: 1 },
          { type: 'logo', x: b.X1 - S * 0.24, y: b.Y0, w: S * 0.24, h: S * 0.06, align: 'right', valign: 'top', brandText: t.brand, colour: '#ffffff' },
          { type: 'stack', x: b.X0, y: b.Y0 + S * 0.2, w: b.CW, h: b.CH - S * 0.2 - S * 0.08, align: 'left', valign: 'middle', gap: S * 0.03, items: [
            { type: 'text', text: t.heading, weight: 800, colour: '#ffffff', hot: c.aD, max: S * 0.085, min: S * 0.045, maxLines: 3, share: 0.32, lh: 1.08 },
            { type: 'rule', w: S * 0.1, h: S * 0.006, fill: c.aD },
            { type: 'text', text: t.body, weight: 400, colour: '#e2e8f0', max: S * 0.048, min: S * 0.03, maxLines: 9, share: 0.56, lh: 1.32 },
          ] },
          ...Array.from({ length: dots }, (_, k) => ({ type: 'ellipse', cx: x.W / 2 + (k - (dots - 1) / 2) * dg, cy: b.Y1 - dr, rx: k === Math.min(n, dots) - 1 ? dr * 1.4 : dr, ry: k === Math.min(n, dots) - 1 ? dr * 1.4 : dr, fill: k === Math.min(n, dots) - 1 ? c.aD : '#ffffff', opacity: k === Math.min(n, dots) - 1 ? 1 : 0.45 })),
        ],
      };
    },
  },
  'carousel-end': {
    name: 'Carousel end', group: 'carousel', note: 'The last slide: what to do next',
    fields: [f('headline', 'Headline', 50), f('sub', 'Line under it', 90), f('cta', 'Button', 30)],
    colours: ['#0f172a', '#38bdf8'], family: 'sans', space: '',
    sample: { headline: 'Found this useful?', sub: 'Save it for later and share it with someone who cooks with ghee', cta: 'Follow for more' },
    build(x) {
      const b = box(x), S = b.S, { c, t } = x;
      return {
        photos: [full(x, { look: 'blur' })],
        elements: [
          { type: 'rect', x: 0, y: 0, w: x.W, h: x.H, fill: c.p, opacity: 0.86 },
          { type: 'stack', x: b.X0 + b.CW * 0.06, y: b.Y0, w: b.CW * 0.88, h: b.CH, align: 'center', valign: 'middle', gap: S * 0.035, items: [
            logoItem(x, S * 0.12, c.onP),
            { type: 'text', text: t.headline, weight: 900, colour: c.onP, hot: readable(c.a, c.p, 3), max: S * 0.1, min: S * 0.05, maxLines: 3, share: 0.34, lh: 1.04 },
            { type: 'text', text: t.sub, weight: 400, colour: mix(c.onP, c.p, 0.15), max: S * 0.04, min: S * 0.028, maxLines: 3, share: 0.2, lh: 1.28 },
            { type: 'pill', text: t.cta, fill: c.a, colour: c.onA, size: S * 0.045, weight: 800, shadowBox: true },
          ] },
        ],
      };
    },
  },
};
export const TEMPLATE_IDS = Object.keys(TEMPLATES);
export const CAROUSEL = { cover: 'carousel-cover', content: 'carousel-content', end: 'carousel-end' };
// the formats each kind suits best (any template draws in any format; these are what the picker offers first)
export const SUGGESTED = { post: ['square', 'portrait', 'story'], thumbnail: ['thumbnail'], carousel: ['portrait', 'square'] };

// one design (or one carousel slide) → a PNG at `out`
//   photo / photo2: local picture files (or null: the brand's colours stand in, as in a free preview)
export async function draw({ format = 'square', template, text = {}, colours = [], family, photo = null, photo2 = null, logo = null, slide = 1, slides = 1, out }) {
  const F = FORMATS[format] || FORMATS.square, T = TEMPLATES[template] || TEMPLATES['sale-burst'];
  const W = F.w, H = F.h, s = safeBox(W, H);
  const c = palette(hexOk(colours[0]) ? colours[0] : T.colours[0], hexOk(colours[1]) ? colours[1] : T.colours[1]);
  const x = { W, H, s, c, t: text, family: FAMILIES.includes(family) ? family : T.family, slide, slides, hasPhoto2: !!photo2 };
  const plan = T.build(x);
  // no picture yet: each photo region is a soft gradient in the brand's colours (a clean preview, never an empty hole)
  const photos = plan.photos.map((p) => ({ ...p, file: p.src === 'photo2' ? photo2 || photo : photo }));
  const stand = [];
  for (const p of photos.filter((q) => !q.file)) {
    stand.push({ type: 'rect', x: p.x, y: p.y, w: p.w, h: p.h, fill: mix(c.p, '#000000', 0.15) }, { type: 'gradient', x: p.x, y: p.y, w: p.w, h: p.h, dir: 'down', from: 0, to: 0.7, fill: mix(c.a, c.p, 0.55) },
      { type: 'ellipse', cx: p.x + p.w * 0.7, cy: p.y + p.h * 0.3, rx: Math.min(p.w, p.h) * 0.35, ry: Math.min(p.w, p.h) * 0.35, fill: c.a, opacity: 0.18, blur: 40 });
  }
  // the stand-ins go under everything else
  const elements = [...stand, ...plan.elements].map((e, i) => ({ ...e, layer: i }));
  await compose({ W, H, fill: plan.fill || '#111111', photos: photos.filter((p) => p.file), elements, logo, out });
  return { width: W, height: H };
}
