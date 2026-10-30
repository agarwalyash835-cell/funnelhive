// A store's catalogue for the places buyers shop from, refreshed on every read (no upload by hand):
//   /s/<handle>/feed/google.xml — Google Merchant Center (free listings + Shopping ads): RSS 2.0 with g: fields.
//     Physical products only (Google doesn't list downloads); sold-out items stay listed as out_of_stock.
//   /s/<handle>/feed/meta.csv   — Meta Commerce Manager (Instagram / Facebook shop, WhatsApp catalogue, dynamic ads).
//   /s/<handle>/sitemap.xml     — the store's pages for Google search (home, products, policy pages).
// Only an open store's visible products; the seller pastes each link once (Store → Sell on Google & Instagram).
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]);
// plain text for a feed: no tags, no control characters, one line per paragraph, within the field's limit
const plain = (v, n) => String(v ?? '').replace(/<[^>]*>/g, ' ').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').replace(/[ \t]+/g, ' ').trim().slice(0, n);
const csvCell = (v) => { const s = String(v ?? ''); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const inr = (n) => `${Number(n).toFixed(2)} INR`;
const CDN = () => (/^https:\/\/[^\s"'<>]+$/.test(process.env.CDN_URL || '') ? process.env.CDN_URL.replace(/\/+$/, '') : '');

// one product as both feeds describe it → { id, title, description, link, image, more, price, sale, availability, category, brand, digital }
function feedItem(l, { storeUrl, base, brand }) {
  const abs = (u) => (/^https?:\/\//.test(u) ? u : `${CDN() && u.startsWith('/uploads/') ? CDN() : base}${u}`);
  const [first, ...rest] = (l.images || []).filter(Boolean).map(abs);
  const onSale = l.mrp && l.mrp > l.price;
  return {
    id: l.id, title: plain(l.title, 150), description: plain(l.description, 5000) || plain(l.title, 150),
    link: `${storeUrl}/p/${l.id}`, image: first || '', more: rest.slice(0, 10),
    price: onSale ? l.mrp : l.price, sale: onSale ? l.price : null,
    availability: l.kind === 'digital' || !l.soldOut ? 'in stock' : 'out of stock',
    category: plain(l.category, 750), brand: plain(brand, 100), digital: l.kind === 'digital',
  };
}

export function googleXml(items, { title, storeUrl, description }) {
  const row = (x) => [
    `<g:id>${esc(x.id)}</g:id>`, `<g:title>${esc(x.title)}</g:title>`, `<g:description>${esc(x.description)}</g:description>`,
    `<g:link>${esc(x.link)}</g:link>`, x.image && `<g:image_link>${esc(x.image)}</g:image_link>`,
    ...x.more.map((u) => `<g:additional_image_link>${esc(u)}</g:additional_image_link>`),
    `<g:availability>${x.availability.replace(' ', '_')}</g:availability>`, '<g:condition>new</g:condition>',
    `<g:price>${inr(x.price)}</g:price>`, x.sale != null && `<g:sale_price>${inr(x.sale)}</g:sale_price>`,
    x.brand && `<g:brand>${esc(x.brand)}</g:brand>`, '<g:identifier_exists>no</g:identifier_exists>',
    x.category && `<g:product_type>${esc(x.category)}</g:product_type>`,
  ].filter(Boolean).join('');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0"><channel><title>${esc(title)}</title><link>${esc(storeUrl)}</link><description>${esc(description)}</description>\n${items.map((x) => `<item>${row(x)}</item>`).join('\n')}\n</channel></rss>\n`;
}

const META_COLS = ['id', 'title', 'description', 'availability', 'condition', 'price', 'sale_price', 'link', 'image_link', 'additional_image_link', 'brand', 'product_type'];
export function metaCsv(items) {
  const rows = items.map((x) => [x.id, x.title, x.description, x.availability, 'new', inr(x.price), x.sale != null ? inr(x.sale) : '', x.link, x.image, x.more.join(','), x.brand, x.category]);
  return `${[META_COLS, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n')}\r\n`;
}

export function sitemapXml(urls) {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `<url><loc>${esc(u)}</loc></url>`).join('\n')}\n</urlset>\n`;
}

// deps from store.js: { openStore, catalog, publicStore, storeUrl, appUrl }
export function registerStoreFeeds(app, { openStore, catalog, publicStore, storeUrl, appUrl, rateLimit, isTest }) {
  const lim = rateLimit({ windowMs: 60000, max: isTest ? 2000 : 60, key: (req) => `${req.ip}:sfeed`, message: 'Too many requests — please wait a minute.' });
  // an open, real store (demo stores and previews have no feed) → { s, owner, items, url, st } or answered
  const open = (req, res) => {
    const o = openStore(req, res, { buying: true, quote: true });
    if (!o) return null;
    if (o.demo) { res.status(404).type('text').send('Demo stores have no feed'); return null; }
    const url = storeUrl(req, o.s), st = publicStore(o.s, o.owner);
    const base = (process.env.PAGES_URL || appUrl(req)).replace(/\/+$/, '');
    const items = catalog(o.s, o.owner).filter((l) => l.price > 0).map((l) => feedItem(l, { storeUrl: url, base, brand: st.name }));
    return { ...o, items, url, st };
  };
  const cache = (res) => res.set('Cache-Control', 'public, max-age=3600');
  app.get('/s/:handle/feed/google.xml', lim, (req, res) => {
    const x = open(req, res);
    if (!x) return;
    cache(res).type('application/xml').send(googleXml(x.items.filter((i) => !i.digital && i.image), { title: x.st.name, storeUrl: x.url, description: x.st.tagline || x.st.name }));
  });
  app.get('/s/:handle/feed/meta.csv', lim, (req, res) => {
    const x = open(req, res);
    if (!x) return;
    cache(res).type('text/csv; charset=utf-8').send(metaCsv(x.items.filter((i) => i.image)));
  });
  app.get('/s/:handle/sitemap.xml', lim, (req, res) => {
    const x = open(req, res);
    if (!x) return;
    const urls = [x.url, ...x.items.map((i) => i.link), ...x.st.policyPages.filter((p) => !p.draft).map((p) => `${x.url}/policy/${p.k}`)];
    cache(res).type('application/xml').send(sitemapXml(urls));
  });
}
