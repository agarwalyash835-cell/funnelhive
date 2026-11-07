// Hive tools for the open web: search it, and read a page (a competitor's site, a product listing, an article, a
// government notice). Pages are fetched by this server — only public http(s) addresses, never this machine or a
// private network (a page or a prompt can't point Hive at internal services) — and handed to the model as plain text.
import dns from 'node:dns/promises';
import net from 'node:net';

const S = (props, required = []) => ({ type: 'object', properties: props, required, additionalProperties: false });
const str = (description) => ({ type: 'string', description });
const UA = 'Mozilla/5.0 (compatible; FunnelHiveBot/1.0; +https://app.getaihive.in)';
const PAGE_MAX = 2 * 1024 * 1024, TEXT_MAX = 12000;

// private, loopback, link-local, CGNAT and other non-public ranges
const PRIVATE4 = [[0, 8], [10, 8], [100.64, 10], [127, 8], [169.254, 16], [172.16, 12], [192.0, 24], [192.168, 16], [198.18, 15], [224, 4], [240, 4]];
const ip4n = (ip) => ip.split('.').reduce((n, x) => n * 256 + Number(x), 0);
const inRange = (ip, [base, bits]) => { const b = String(base).split('.'); while (b.length < 4) b.push('0'); const mask = bits ? (2 ** 32 - 2 ** (32 - bits)) : 0; return (ip4n(ip) & mask) >>> 0 === (ip4n(b.join('.')) & mask) >>> 0; };
export function publicIp(ip) {
  if (net.isIPv4(ip)) return !PRIVATE4.some((r) => inRange(ip, r));
  if (net.isIPv6(ip)) {
    const x = ip.toLowerCase();
    if (x === '::1' || x === '::' || /^f[cd]/.test(x) || /^fe[89ab]/.test(x) || /^ff/.test(x)) return false;
    const v4 = x.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    return v4 ? publicIp(v4[1]) : true;
  }
  return false;
}
// → the URL if it's a public web address, else throws
export async function safeUrl(raw) {
  let u;
  try { u = new URL(String(raw || '').trim()); } catch { throw new Error('That isn’t a web address'); }
  if (!['http:', 'https:'].includes(u.protocol)) throw new Error('Only http(s) pages can be read');
  if (u.username || u.password) throw new Error('Addresses with a login in them can’t be read');
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (/^(localhost|.*\.local|.*\.internal)$/i.test(host)) throw new Error('That address isn’t on the public web');
  const ips = net.isIP(host) ? [host] : (await dns.lookup(host, { all: true }).catch(() => { throw new Error('That website couldn’t be found'); })).map((a) => a.address);
  if (!ips.length || !ips.every(publicIp)) throw new Error('That address isn’t on the public web');
  return u;
}
// fetch with redirects checked one by one (a public page can't redirect into a private one)
async function fetchPublic(raw, { accept = 'text/html,*/*;q=0.8' } = {}) {
  let url = await safeUrl(raw);
  for (let hop = 0; hop < 5; hop++) {
    const r = await fetch(url, { redirect: 'manual', headers: { 'User-Agent': UA, Accept: accept, 'Accept-Language': 'en-IN,en;q=0.9,hi;q=0.8' }, signal: AbortSignal.timeout(12000) });
    if (r.status >= 300 && r.status < 400 && r.headers.get('location')) { url = await safeUrl(new URL(r.headers.get('location'), url).href); continue; }
    return { r, url };
  }
  throw new Error('That page redirects too many times');
}
async function bodyText(r) {
  const reader = r.body?.getReader();
  if (!reader) return '';
  const parts = []; let n = 0;
  for (;;) { const { value, done } = await reader.read(); if (done) break; n += value.length; parts.push(value); if (n > PAGE_MAX) { reader.cancel().catch(() => {}); break; } }
  return Buffer.concat(parts.map((p) => Buffer.from(p))).toString('utf8');
}
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', ndash: '–', mdash: '—', hellip: '…', rupee: '₹' };
const decode = (s) => s.replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, e) => (e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : ENT[e.toLowerCase()] ?? m));
// readable text of an HTML page: headings and paragraphs kept on their own lines; scripts, styles and menus dropped
export function pageText(html) {
  const title = decode((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '').replace(/\s+/g, ' ').trim());
  const desc = decode(html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)/i)?.[1] || '');
  const body = (html.match(/<main[\s\S]*?<\/main>/i)?.[0] || html.match(/<body[\s\S]*<\/body>/i)?.[0] || html)
    .replace(/<(script|style|noscript|svg|nav|footer|form|iframe)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<(br|\/p|\/h[1-6]|\/li|\/tr|\/div|\/section|\/article)[^>]*>/gi, '\n')
    .replace(/<li[^>]*>/gi, '\n• ')
    .replace(/<[^>]+>/g, ' ');
  const text = decode(body).split('\n').map((l) => l.replace(/[ \t ]+/g, ' ').trim()).filter(Boolean).join('\n').replace(/\n{3,}/g, '\n\n');
  return { title, description: desc, text };
}

// the search: Brave Search's API (a key from https://api-dashboard.search.brave.com — the free plan covers about
// 2,000 searches a month), set as BRAVE_SEARCH_API_KEY in the server's environment by the platform owner
const SEARCH_KEY = () => process.env.BRAVE_SEARCH_API_KEY || '';
const SEARCH_URL = () => process.env.BRAVE_SEARCH_URL || 'https://api.search.brave.com/res/v1/web/search';
export const webSearchReady = () => !!SEARCH_KEY();
const plain = (s) => decode(String(s || '').replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
export const resultsOf = (d) => (d?.web?.results || []).map((x) => ({ title: plain(x.title), url: x.url, snippet: plain(x.description), ...(x.age ? { age: x.age } : {}) }));

export const TOOLS = [
  {
    name: 'web_search', description: 'Search the web (news, competitors, prices, suppliers, government rules, festivals, trends). Returns titles, links and snippets; use read_web_page on the 1–3 that matter. Add the city or "India" when it helps.',
    schema: S({ query: str('What to search for'), country: str('Optional 2-letter country code (default IN)') }, ['query']),
    run: async (ctx, a) => {
      if (!webSearchReady()) throw new Error('Web search isn’t switched on for this platform yet — I can still read any page you send me a link to');
      const q = new URLSearchParams({ q: String(a.query).slice(0, 300), country: /^[a-z]{2}$/i.test(a.country || '') ? a.country.toUpperCase() : 'IN', count: '8' });
      let r;
      try { r = await fetch(`${SEARCH_URL()}?${q}`, { headers: { Accept: 'application/json', 'X-Subscription-Token': SEARCH_KEY() }, signal: AbortSignal.timeout(12000) }); } catch { throw new Error('Web search isn’t reachable right now — try again in a minute'); }
      if (r.status === 429) throw new Error('Web search is busy (too many searches) — try again later');
      if (!r.ok) throw new Error(`Web search didn’t answer (HTTP ${r.status})`);
      return { query: a.query, results: resultsOf(await r.json()).slice(0, 8) };
    },
    summary: (r) => `Searched the web for “${String(r.query).slice(0, 60)}” (${r.results.length} results)`,
  },
  {
    name: 'read_web_page', description: 'Read one public web page and get its text (title, description, main content). Use for a link the seller gives, a competitor’s page, or a result from web_search.',
    schema: S({ url: str('The page address (https://…)') }, ['url']),
    run: async (ctx, a) => {
      const { r, url } = await fetchPublic(a.url);
      if (!r.ok) throw new Error(`That page answered HTTP ${r.status}`);
      const type = r.headers.get('content-type') || '';
      if (!/text\/html|text\/plain|application\/xhtml/i.test(type)) throw new Error(`That address isn’t a web page (${type.split(';')[0] || 'unknown type'})`);
      const raw = await bodyText(r);
      const p = /text\/plain/i.test(type) ? { title: '', description: '', text: raw } : pageText(raw);
      return { url: url.href, title: p.title, description: p.description, text: p.text.slice(0, TEXT_MAX), truncated: p.text.length > TEXT_MAX };
    },
    summary: (r) => `Read ${r.title ? `“${r.title.slice(0, 60)}”` : new URL(r.url).hostname}`,
  },
];
export const OK = {};
