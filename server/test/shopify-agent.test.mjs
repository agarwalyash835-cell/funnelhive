// Shopify for the WhatsApp AI agent, against a fake Shopify store (its /api/mcp and /api/ucp/mcp AI endpoints and
// the Admin API), a fake Hive WhatsApp and a fake AI: connecting a store, trying a search, the agent recommending
// live products sent as cards with a "Buy now" checkout button (never out-of-stock ones), store policies, a
// customer's order status with the optional Admin token, and the agent profile Shopify reads.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import { startServer, register } from './helpers.mjs';

const KEY = 'hk_test_ok_supersecret_123';
const fake = { sent: [], hook: null, n: 0, shop: [], ai: [], reply: null };
let hive, store, model, srv, api, T;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms = 6000) { for (let t = 0; t < ms; t += 50) { const v = await fn(); if (v) return v; await wait(50); } return fn(); }
const listen = (s) => new Promise((r) => s.listen(0, '127.0.0.1', r));
const body = (req) => new Promise((r) => { let b = ''; req.on('data', (d) => { b += d; }); req.on('end', () => r(b && /json/.test(req.headers['content-type'] || '') ? JSON.parse(b) : b)); });
const variant = (id, title, available, amount) => ({ id: `gid://shopify/ProductVariant/${id}`, title, price: { amount, currency: 'INR' }, availability: { available }, media: [{ type: 'image', url: `https://cdn.shopify.com/${id}.jpg` }], checkout_url: `https://mystore.myshopify.com/cart/${id}:1` });
const PRODUCTS = [
  { id: 'gid://shopify/Product/1', title: 'Indigo Cotton Kurta', url: 'https://mystore.in/products/indigo-kurta', description: { html: '<p>Hand-block printed <b>cotton</b> kurta.</p>' }, price_range: { min: { amount: 129900, currency: 'INR' }, max: { amount: 129900, currency: 'INR' } }, list_price_range: { min: { amount: 199900, currency: 'INR' } }, variants: [variant(11, 'S', false, 129900), variant(12, 'M', true, 129900), variant(13, 'L', true, 129900)] },
  { id: 'gid://shopify/Product/2', title: 'Blue Silk Kurta', url: 'https://mystore.in/products/silk', price_range: { min: { amount: 349900, currency: 'INR' }, max: { amount: 349900, currency: 'INR' } }, variants: [variant(21, 'M', false, 349900)] },
];

before(async () => {
  hive = http.createServer(async (req, res) => {
    const j = await body(req);
    const p = new URL(req.url, 'http://x').pathname.replace(/^\/wa\/v1/, '');
    const send = (s, o) => { res.writeHead(s, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
    const route = `${req.method} ${p}`;
    if (route === 'GET /me') return send(200, { workspace_id: 'ws_1', prefix: 'hk_test_ok_sup' });
    if (route === 'GET /numbers') return send(200, { numbers: [{ id: 'ch_1', display: '919800000001', phone_number_id: '1111' }] });
    if (route === 'GET /templates') return send(200, { templates: [] });
    if (route === 'PUT /webhooks') { fake.hook = j; return send(200, { ok: true }); }
    if (route === 'POST /messages') { fake.sent.push(j); return send(202, { id: `msg_${++fake.n}`, status: 'queued' }); }
    if (route === 'POST /cloud/1111/messages') { fake.sent.push({ ...j, cloud: true }); return send(202, { id: `msg_${++fake.n}`, status: 'queued' }); }
    send(404, { error: 'not found' });
  });
  // the store: /<host>/api/mcp, /<host>/api/ucp/mcp, /<host>/admin/api/<v>/graphql.json
  store = http.createServer(async (req, res) => {
    const j = await body(req);
    const [, host, ...rest] = new URL(req.url, 'http://x').pathname.split('/');
    const p = `/${rest.join('/')}`;
    const send = (s, o) => { res.writeHead(s, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
    if (host !== 'mystore.myshopify.com') return send(404, {});
    fake.shop.push({ p, j, token: req.headers['x-shopify-access-token'] });
    const out = (v) => send(200, { jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: JSON.stringify(v) }] } });
    if (p === '/api/mcp') return out([{ question: 'What is the return policy?', answer: 'Returns within 7 days of delivery.' }]);
    if (p === '/api/ucp/mcp' && j.params.name === 'search_catalog') return /kurta/i.test(j.params.arguments.catalog.query) ? out({ products: PRODUCTS }) : out({ products: [] });
    if (p.startsWith('/admin/api/')) {
      if (req.headers['x-shopify-access-token'] !== 'shpat_goodtoken123') return send(401, { errors: 'Invalid API key or access token' });
      if (/shop\{/.test(j.query)) return send(200, { data: { shop: { name: 'My Kurta Store', currencyCode: 'INR' } } });
      return send(200, { data: { orders: { nodes: [{ name: '#1001', createdAt: '2026-10-20T10:00:00Z', displayFinancialStatus: 'PAID', displayFulfillmentStatus: 'FULFILLED', totalPriceSet: { shopMoney: { amount: '1299.00', currencyCode: 'INR' } }, lineItems: { nodes: [{ title: 'Indigo Cotton Kurta', quantity: 1 }] }, fulfillments: [{ status: 'SUCCESS', trackingInfo: [{ company: 'Delhivery', number: 'DL123', url: 'https://delhivery.com/track/DL123' }] }] }] } } });
    }
    send(404, {});
  });
  model = http.createServer(async (req, res) => {
    const j = await body(req);
    fake.ai.push({ sys: String(j.instructions || ''), user: String(j.input?.at(-1)?.content || '') });
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(fake.reply || { reply: 'Hi!' }) }] }] }));
  });
  await listen(hive); await listen(store); await listen(model);
  srv = await startServer({ HIVE_WA_API_URL: `http://127.0.0.1:${hive.address().port}/wa/v1`, SHOPIFY_STORE_BASE: `http://127.0.0.1:${store.address().port}`, KIE_API_KEY: 'kie_test', KIE_BASE_URL: `http://127.0.0.1:${model.address().port}` });
  api = srv.api;
  T = (await register(api)).token;
  assert.equal((await api('/channels/whatsapp/hive', 'PUT', { apiKey: KEY }, T)).status, 200);
  assert.equal((await api('/channels/whatsapp/hive/webhook', 'POST', {}, T)).status, 200);
});
after(async () => { await srv.stop(); hive.close(); store.close(); model.close(); });

async function say(from, text) {
  const id = `whd_${crypto.randomUUID()}`, ts = Date.now();
  const raw = JSON.stringify({ id, event: 'message.inbound', created_at: new Date(ts).toISOString(), number: { id: 'ch_1', display: '919800000001', phone_number_id: '1111' }, data: { from, type: 'text', text, timestamp: new Date(ts).toISOString() } });
  const sig = `sha256=${crypto.createHmac('sha256', fake.hook.secret).update(raw).digest('hex')}`;
  const r = await fetch(srv.base + new URL(fake.hook.url).pathname, { method: 'POST', headers: { 'content-type': 'application/json', 'x-hive-signature': sig, 'x-hive-event': 'message.inbound', 'x-hive-delivery-id': id, 'x-hive-timestamp': String(ts) }, body: raw });
  assert.equal(r.status, 200);
}
const sentTo = (num) => fake.sent.filter((m) => m.to === num);

test('connecting a store: it must answer on Shopify’s AI endpoint; a search shows what the agent would find', async () => {
  assert.equal((await api('/shopify', 'PUT', { host: 'notashop.example.com' }, T)).status, 400);
  const r = await api('/shopify', 'PUT', { host: 'https://mystore.myshopify.com/collections/all' }, T);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.deepEqual([r.data.store.host, r.data.store.admin], ['mystore.myshopify.com', false]);
  const t = (await api('/shopify/try', 'POST', { query: 'cotton kurta' }, T)).data;
  const p = t.products[0];
  assert.deepEqual([p.title, p.price, p.mrp, p.available, p.options, p.checkout, p.image], ['Indigo Cotton Kurta', '₹1,299', '₹1,999', true, ['M', 'L'], 'https://mystore.myshopify.com/cart/12:1', 'https://cdn.shopify.com/11.jpg']);
  assert.equal(p.description, 'Hand-block printed cotton kurta.');
  assert.equal(t.products[1].available, false);
  assert.equal(t.policies[0].a, 'Returns within 7 days of delivery.');
  const call = fake.shop.find((x) => x.p === '/api/ucp/mcp');
  assert.match(call.j.params.arguments.meta['ucp-agent'].profile, /^https:\/\//, 'every catalogue call names an agent profile');
  assert.deepEqual(call.j.params.arguments.catalog.context, { address_country: 'IN' });
});

test('the agent profile Shopify reads: catalogue and cart, never checkout', async () => {
  const res = await fetch(`${srv.base}/.well-known/ucp-agent.json`);
  assert.match(res.headers.get('content-type'), /application\/json/);
  const j = await res.json();
  assert.equal(j.ucp.version, '2026-04-08');
  assert.ok(j.ucp.capabilities['dev.ucp.shopping.catalog.search'] && j.ucp.capabilities['dev.ucp.shopping.cart']);
  assert.ok(!j.ucp.capabilities['dev.ucp.shopping.checkout']);
});

test('the WhatsApp agent recommends live products as cards with a Buy now button — never one that’s out of stock', async () => {
  assert.equal((await api('/wa-agent', 'PUT', { on: true, name: 'Riya', tone: 'friendly', knowledge: 'Kurtas for women. Delivery across India.' }, T)).status, 200);
  fake.reply = { reply: 'We have a lovely indigo cotton kurta (P1) for *₹1,299* 😊', buttons: ['Show me more kurtas please'], products: ['P1', 'P2', 'P9'], handoff: false, intent: 'purchase' };
  await say('919700000011', 'blue kurta under 1500?');
  await waitFor(() => sentTo('919700000011').length >= 2);
  await wait(200);
  const out = sentTo('919700000011');
  assert.equal(out.length, 2, 'the reply and one card (P2 is out of stock, P9 doesn’t exist)');
  const card = out.find((m) => m.interactive?.type === 'cta_url');
  const said = out.find((m) => m !== card);
  assert.equal(said.interactive.body.text, 'We have a lovely indigo cotton kurta for *₹1,299* 😊', 'the internal product code never reaches the customer');
  assert.equal(said.interactive.action.buttons[0].reply.title, 'Show me more kurtas', 'a long button is cut at a word, not mid-word');
  assert.equal(card.cloud, true);
  assert.deepEqual(card.interactive.action.parameters, { display_text: 'Buy now', url: 'https://mystore.myshopify.com/cart/12:1' });
  assert.equal(card.interactive.header.image.link, 'https://cdn.shopify.com/11.jpg');
  assert.match(card.interactive.body.text, /\*Indigo Cotton Kurta\*\n₹1,299  ~₹1,999~\nAvailable: M, L/);
  const sys = fake.ai.findLast((x) => x.sys.includes('WhatsApp assistant')).sys;
  assert.match(sys, /SHOPIFY STORE/);
  assert.match(sys, /P1: Indigo Cotton Kurta — ₹1,299 \(was ₹1,999\) — in stock — available: M, L/);
  assert.match(sys, /P2: Blue Silk Kurta — ₹3,499 — OUT OF STOCK/);
  assert.match(sys, /Returns within 7 days/);
  assert.match(sys, /You can’t see orders/);
});

test('order status with the optional Admin token: the customer’s orders by their WhatsApp number, with tracking', async () => {
  assert.equal((await api('/shopify', 'PUT', { adminToken: 'shpat_wrongtoken99' }, T)).status, 400);
  assert.equal((await api('/shopify', 'PUT', { adminToken: 'not-a-token' }, T)).status, 400);
  const ok = await api('/shopify', 'PUT', { adminToken: 'shpat_goodtoken123' }, T);
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  assert.deepEqual([ok.data.store.admin, ok.data.store.name], [true, 'My Kurta Store']);
  assert.ok(!JSON.stringify(ok.data).includes('shpat_'), 'the token never comes back');
  fake.reply = { reply: 'Your order #1001 is on its way 🚚', handoff: false, intent: 'support' };
  await say('919700000012', 'where is my order? kab aayega');
  await waitFor(() => sentTo('919700000012').length >= 1);
  const q = fake.shop.findLast((x) => x.p.startsWith('/admin/api/') && /orders/.test(x.j.query));
  assert.equal(q.j.variables.q, 'phone:+919700000012');
  const sys = fake.ai.findLast((x) => x.sys.includes('WhatsApp assistant')).sys;
  assert.match(sys, /#1001 \(2026-10-20\): 1 × Indigo Cotton Kurta — INR 1299\.00 — payment PAID, FULFILLED — tracking: Delhivery · DL123 · https:\/\/delhivery\.com\/track\/DL123/);
  // disconnecting: the agent is back to its own knowledge
  assert.equal((await api('/shopify', 'DELETE', null, T)).data.store, null);
});
