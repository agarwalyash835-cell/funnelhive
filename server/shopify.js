// Shopify for the WhatsApp AI agent: the seller's store, through Shopify's own AI endpoints — no app to install.
// Every Shopify store answers on https://<store>/api/mcp (shop policies and FAQs) and https://<store>/api/ucp/mcp
// (the Universal Commerce Protocol: catalogue search, products, carts). The agent searches the live catalogue for
// what the customer asks, and sends products as cards whose button opens that item's Shopify checkout.
// Optionally the seller adds an Admin API token (a custom app with read_orders) so "where's my order?" is answered.
import { T } from './db.js';
import { encrypt, decrypt } from './messaging.js';
import { checkPublicHost } from './webhooks.js';

const clip = (v, n) => String(v ?? '').trim().slice(0, n);
const ADMIN_VERSION = process.env.SHOPIFY_API_VERSION || '2026-07';
// Shopify fetches the agent's profile to agree on what it may do (catalogue + cart); ours is served below.
// Until the app has a public https address (local runs, tests), Shopify's own published profile stands in.
const SHOPIFY_PROFILE = 'https://shopify.dev/ucp/agent-profiles/2026-04-08/valid-with-capabilities.json';
const UCP = '2026-04-08';
const cap = (extra = {}) => [{ version: UCP, ...extra }];
export const AGENT_PROFILE = {
  ucp: {
    version: UCP,
    services: { 'dev.ucp.shopping': [{ version: UCP, spec: `https://ucp.dev/${UCP}/specification/overview`, transport: 'mcp', schema: `https://ucp.dev/${UCP}/services/shopping/mcp.openrpc.json` }] },
    capabilities: {
      'dev.ucp.shopping.cart': cap({ spec: `https://ucp.dev/${UCP}/specification/cart`, schema: `https://ucp.dev/${UCP}/schemas/shopping/cart.json` }),
      'dev.ucp.shopping.catalog.search': cap({ spec: `https://ucp.dev/${UCP}/specification/catalog/search`, schema: `https://ucp.dev/${UCP}/schemas/shopping/catalog_search.json` }),
      'dev.ucp.shopping.catalog.lookup': cap({ spec: `https://ucp.dev/${UCP}/specification/catalog/lookup`, schema: `https://ucp.dev/${UCP}/schemas/shopping/catalog_lookup.json` }),
      'dev.shopify.catalog': cap({ spec: 'https://shopify.dev/docs/agents/catalog/storefront-catalog', schema: `https://shopify.dev/ucp/schemas/${UCP}/shopify_catalog.json`, extends: ['dev.ucp.shopping.catalog.lookup', 'dev.ucp.shopping.catalog.search'] }),
    },
    payment_handlers: {},
  },
};
const profileUrl = () => {
  if (process.env.UCP_AGENT_PROFILE) return process.env.UCP_AGENT_PROFILE;
  const app = String(process.env.APP_URL || '').replace(/\/+$/, '');
  return /^https:\/\/[^/]+\.[a-z]{2,}$/i.test(app) && !/localhost/i.test(app) ? `${app}/.well-known/ucp-agent.json` : SHOPIFY_PROFILE;
};
// "mystore", "mystore.myshopify.com", "https://www.mystore.in/products/x" → the store's host
export function storeHost(input) {
  let s = clip(input, 200).toLowerCase().replace(/^https?:\/\//, '').split(/[/?#]/)[0].replace(/:\d+$/, '');
  if (/^[a-z0-9][a-z0-9-]{1,60}$/.test(s)) s = `${s}.myshopify.com`;
  return /^[a-z0-9.-]+\.[a-z]{2,}$/.test(s) ? s : '';
}
const base = (host) => (process.env.SHOPIFY_STORE_BASE ? `${process.env.SHOPIFY_STORE_BASE.replace(/\/+$/, '')}/${host}` : `https://${host}`);

// a store's address can redirect (mystore.in → www.mystore.in): followed by hand, a few hops, each one checked to
// be a public address — never an automatic follow into the server's own network
async function storeFetch(url, init, ms) {
  const signal = AbortSignal.timeout(ms);
  for (let hop = 0; hop < 4; hop++) {
    await checkPublicHost(new URL(url).hostname);
    const res = await fetch(url, { ...init, signal, redirect: 'manual' });
    const to = res.status >= 300 && res.status < 400 && res.headers.get('location');
    if (!to) return res;
    url = new URL(to, url).toString();
    if (!/^https?:/.test(url)) break;
  }
  throw new Error('The store kept redirecting');
}
// one JSON-RPC call to a store's AI endpoint → the tool's result (parsed JSON when it is JSON)
async function rpc(host, path, name, args, ms = 6000) {
  const res = await storeFetch(`${base(host)}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) }, ms);
  if (!res.ok) throw new Error(res.status === 404 ? 'This doesn’t look like a Shopify store' : `The store answered ${res.status}`);
  const j = await res.json();
  if (j.error) throw new Error(j.error.data?.content || j.error.message || 'The store couldn’t answer');
  const text = j.result?.content?.find((c) => c.type === 'text')?.text || '';
  if (j.result?.isError) throw new Error(clip(text, 200) || 'The store couldn’t answer');
  if (j.result?.structuredContent) return j.result.structuredContent;
  try { return JSON.parse(text); } catch { return text; }
}
// catalogue tools need the agent profile; if Shopify can't use ours, its own published one is tried once
async function ucp(host, name, args) {
  const call = (profile) => rpc(host, '/api/ucp/mcp', name, { meta: { 'ucp-agent': { profile } }, ...args });
  const mine = profileUrl();
  try { return await call(mine); } catch (e) { if (mine !== SHOPIFY_PROFILE && /discovery|profile|negotiat|not found/i.test(e.message)) return call(SHOPIFY_PROFILE); throw e; }
}

const money = (m) => {
  if (!m || !Number.isFinite(Number(m.amount))) return '';
  const cur = m.currency || 'INR';
  try { return new Intl.NumberFormat('en-IN', { style: 'currency', currency: cur, maximumFractionDigits: Number(m.amount) % 100 ? 2 : 0 }).format(Number(m.amount) / 100); } catch { return `${cur} ${(Number(m.amount) / 100).toFixed(2)}`; }
};
const plain = (h) => clip(String(h || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' '), 240);
// a product as the agent sees it and the card it sends
function productView(p) {
  const vs = (p.variants || []).slice(0, 30);
  const buy = vs.find((v) => v.availability?.available) || null;
  const image = [...(p.media || []), ...vs.flatMap((v) => v.media || [])].find((m) => m.type === 'image' && /^https:\/\//.test(m.url || ''))?.url || '';
  const options = [...new Set(vs.filter((v) => v.availability?.available).map((v) => v.title).filter((t) => t && t !== 'Default Title'))].slice(0, 12);
  const lo = p.price_range?.min, hi = p.price_range?.max;
  return {
    id: String(p.id || ''), title: clip(p.title, 120), url: /^https:\/\//.test(p.url || '') ? p.url : '', description: plain(p.description?.html || p.description?.plain || p.description),
    price: lo && hi && lo.amount !== hi.amount ? `${money(lo)} – ${money(hi)}` : money(lo || buy?.price), mrp: Number(p.list_price_range?.min?.amount) > Number(lo?.amount) ? money(p.list_price_range.min) : '',
    available: !!buy, options, image, checkout: /^https:\/\//.test(buy?.checkout_url || '') ? buy.checkout_url : '',
  };
}

export const shopOf = (u) => (u?.shopify?.host ? u.shopify : null);
export async function searchProducts(u, query, n = 5) {
  const s = shopOf(u);
  if (!s || !clip(query, 300)) return [];
  const r = await ucp(s.host, 'search_catalog', { catalog: { query: clip(query, 300), context: { address_country: s.country || 'IN', ...(s.currency ? { currency: s.currency } : {}) } } });
  return (r?.products || []).slice(0, n).map(productView).filter((p) => p.title);
}
export async function searchPolicies(u, query) {
  const s = shopOf(u);
  if (!s || !clip(query, 300)) return [];
  const r = await rpc(s.host, '/api/mcp', 'search_shop_policies_and_faqs', { query: clip(query, 300) });
  return (Array.isArray(r) ? r : []).slice(0, 4).map((x) => ({ q: clip(x.question, 200), a: clip(x.answer, 600) })).filter((x) => x.a);
}
// the customer's recent orders (needs the optional Admin API token): status, tracking, items
export async function recentOrders(u, { phone, email }) {
  const s = shopOf(u);
  if (!s?.adminTokenEnc || !s.adminHost || !(phone || email)) return [];
  const q = [phone && `phone:${phone}`, email && `email:${email}`].filter(Boolean).join(' OR ');
  const gql = `query($q:String!){orders(first:3,sortKey:CREATED_AT,reverse:true,query:$q){nodes{name createdAt displayFinancialStatus displayFulfillmentStatus totalPriceSet{shopMoney{amount currencyCode}} lineItems(first:4){nodes{title quantity}} fulfillments(first:2){status trackingInfo(first:1){company number url}}}}}`;
  const res = await fetch(`${base(s.adminHost)}/admin/api/${ADMIN_VERSION}/graphql.json`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': decrypt(s.adminTokenEnc) }, body: JSON.stringify({ query: gql, variables: { q } }), signal: AbortSignal.timeout(6000) });
  if (!res.ok) throw new Error(res.status === 401 || res.status === 403 ? 'The Shopify Admin token was refused' : `Shopify answered ${res.status}`);
  const j = await res.json();
  return (j.data?.orders?.nodes || []).map((o) => ({
    name: o.name, at: o.createdAt, paid: o.displayFinancialStatus, status: o.displayFulfillmentStatus,
    total: `${o.totalPriceSet?.shopMoney?.currencyCode || ''} ${o.totalPriceSet?.shopMoney?.amount || ''}`.trim(),
    items: (o.lineItems?.nodes || []).map((l) => `${l.quantity} × ${l.title}`).join(', '),
    tracking: (o.fulfillments || []).flatMap((f) => f.trackingInfo || []).map((t) => [t.company, t.number, t.url].filter(Boolean).join(' · '))[0] || '',
  }));
}

// what the agent knows from the store for this message: matching products, policy answers, the customer's orders
const ORDER_Q = /\border|track|deliver|dispatch|ship|parcel|courier|refund|return|status|kab (aayega|milega)|#\s?\d{3,}/i;
export async function shopContext(u, { asked, phone, email }) {
  if (!shopOf(u) || !asked) return null;
  const budget = (p) => Promise.race([p, new Promise((r) => setTimeout(() => r(null), 6500))]).catch(() => null);
  const [products, policies, orders] = await Promise.all([budget(searchProducts(u, asked)), budget(searchPolicies(u, asked)), ORDER_Q.test(asked) ? budget(recentOrders(u, { phone, email })) : null]);
  return { products: products || [], policies: policies || [], orders: orders || [], adminOn: !!shopOf(u).adminTokenEnc };
}
export function shopBlock(s) {
  if (!s) return '';
  const lines = ['SHOPIFY STORE (live — prices, stock and sizes right now)'];
  if (s.products.length) lines.push('Products matching what they asked (refer to them by P-number in "products"):', ...s.products.map((p, i) => `P${i + 1}: ${p.title} — ${p.price}${p.mrp ? ` (was ${p.mrp})` : ''} — ${p.available ? 'in stock' : 'OUT OF STOCK'}${p.options.length ? ` — available: ${p.options.join(', ')}` : ''}${p.description ? ` — ${p.description}` : ''}`));
  else lines.push('No product in the store matched this message.');
  if (s.policies.length) lines.push('Store policies / FAQs:', ...s.policies.map((x) => `Q: ${x.q}\nA: ${x.a}`));
  if (s.orders.length) lines.push('THIS CUSTOMER’S RECENT ORDERS:', ...s.orders.map((o) => `${o.name} (${o.at?.slice(0, 10)}): ${o.items} — ${o.total} — payment ${o.paid}, ${o.status}${o.tracking ? ` — tracking: ${o.tracking}` : ''}`));
  else if (s.adminOn) lines.push('No orders found for this customer’s phone number.');
  return lines.join('\n');
}

// ---------- routes ----------
const view = (u) => { const s = shopOf(u); return s ? { host: s.host, name: s.name || '', country: s.country || 'IN', currency: s.currency || '', admin: !!s.adminTokenEnc, adminHost: s.adminHost || '', at: s.at } : null; };
export function registerShopify(app, { auth, wrap, rateLimit, isTest }) {
  const limiter = rateLimit({ windowMs: 60000, max: isTest ? 1000 : 30, key: (req) => req.user?.id || req.ip });
  // the agent profile Shopify reads (catalogue and cart — the agent sends checkout links, it never pays)
  app.get('/.well-known/ucp-agent.json', (req, res) => res.set('Cache-Control', 'public, max-age=3600').type('application/json').send(JSON.stringify(AGENT_PROFILE)));
  app.get('/api/shopify', auth, (req, res) => res.json({ store: view(req.user) }));
  // connect a store: it must answer on Shopify's AI endpoint
  app.put('/api/shopify', auth, limiter, wrap(async (req, res) => {
    const b = req.body || {}, cur = shopOf(req.user) || {};
    const host = b.host != null ? storeHost(b.host) : cur.host;
    if (!host) return res.status(400).json({ error: 'Enter your store address, e.g. mystore.myshopify.com or www.mystore.in' });
    await checkPublicHost(host).catch(() => { throw Object.assign(new Error('Enter your store’s public web address'), { status: 400 }); });
    const next = { ...cur, host, country: /^[A-Z]{2}$/.test(b.country || '') ? b.country : cur.country || 'IN', currency: /^[A-Z]{3}$/.test(b.currency || '') ? b.currency : (b.currency === '' ? '' : cur.currency || ''), at: cur.host === host ? cur.at : Date.now() };
    if (host !== cur.host) {
      try { await rpc(host, '/api/mcp', 'search_shop_policies_and_faqs', { query: 'shipping policy' }, 8000); } catch (e) { return res.status(400).json({ error: `Couldn’t reach a Shopify store at ${host} — ${e.message}` }); }
      next.name = host.replace(/^www\./, '').replace(/\.myshopify\.com$/, '');
    }
    // the optional Admin API token, for order status ("" removes it)
    if ('adminToken' in b) {
      const tok = clip(b.adminToken, 200);
      if (!tok) { delete next.adminTokenEnc; delete next.adminHost; } else {
        const adminHost = storeHost(b.adminHost || (host.endsWith('.myshopify.com') ? host : ''));
        if (!adminHost.endsWith('.myshopify.com')) return res.status(400).json({ error: 'For order status, enter your store’s .myshopify.com address (Shopify admin → Settings → Domains)' });
        if (!/^shpat_[\w-]{10,}$/.test(tok)) return res.status(400).json({ error: 'That isn’t an Admin API access token (it starts with shpat_)' });
        const r = await fetch(`${base(adminHost)}/admin/api/${ADMIN_VERSION}/graphql.json`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': tok }, body: JSON.stringify({ query: '{shop{name currencyCode}}' }), signal: AbortSignal.timeout(8000) }).catch(() => null);
        const j = r?.ok ? await r.json().catch(() => null) : null;
        if (!j?.data?.shop) return res.status(400).json({ error: 'Shopify didn’t accept that token — check it has the read_orders permission' });
        Object.assign(next, { adminTokenEnc: encrypt(tok), adminHost, name: j.data.shop.name || next.name, currency: next.currency || j.data.shop.currencyCode || '' });
      }
    }
    const u = T.users.update(req.user.id, (x) => { x.shopify = next; });
    res.json({ store: view(u) });
  }));
  app.delete('/api/shopify', auth, (req, res) => { T.users.update(req.user.id, (x) => { delete x.shopify; }); res.json({ store: null }); });
  // the settings page's "try a search": what the agent would find
  app.post('/api/shopify/try', auth, limiter, wrap(async (req, res) => {
    if (!shopOf(req.user)) return res.status(400).json({ error: 'Connect your Shopify store first' });
    const q = clip(req.body?.query, 300);
    if (!q) return res.status(400).json({ error: 'Type what a customer might ask' });
    try {
      const [products, policies] = await Promise.all([searchProducts(req.user, q), searchPolicies(req.user, q).catch(() => [])]);
      res.json({ products, policies });
    } catch (e) { res.status(502).json({ error: `The store didn’t answer: ${e.message}` }); }
  }));
}
