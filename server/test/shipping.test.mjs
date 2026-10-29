// Courier integration (shipping.js + couriers/shiprocket.js) against a fake Shiprocket: connect (login, pickups,
// secrets encrypted and never returned), rates, ship (adhoc order → AWB → pickup → label / manifest), COD refusals
// and the override, bulk, tracking by webhook (secret URL) and by poll, delivered COD → paid, RTO → cancelled and
// counted, NDR → the seller is told, the token refreshed on 401, PIN code serviceability, and another seller locked out.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { startServer, register } from './helpers.mjs';

// ---------- the fake Shiprocket ----------
const fake = { logins: 0, token: '', orders: [], assigns: [], pickups: 0, track: {}, trackCalls: 0, expireNext: false };
const COURIERS = { 10: 'Delhivery Surface', 24: 'Xpressbees' };
const fakeServer = http.createServer(async (req, res) => {
  let body = '';
  for await (const c of req) body += c;
  const b = body ? JSON.parse(body) : {};
  const url = new URL(req.url, 'http://x');
  const send = (s, d) => { res.writeHead(s, { 'content-type': 'application/json' }); res.end(JSON.stringify(d)); };
  if (url.pathname === '/auth/login') {
    if (b.email !== 'api@seller.in' || b.password !== 'good-pass') return send(400, { message: 'Invalid email and password combination' });
    fake.logins++; fake.token = `tok-${fake.logins}`;
    return send(200, { token: fake.token, email: b.email });
  }
  if (req.headers.authorization !== `Bearer ${fake.token}` || fake.expireNext) { fake.expireNext = false; fake.token = 'expired'; return send(401, { message: 'Token has expired' }); }
  if (url.pathname === '/settings/company/pickup') return send(200, { data: { shipping_address: [{ id: 1, pickup_location: 'Primary', pin_code: '560034', city: 'Bengaluru', address: 'Koramangala' }, { id: 2, pickup_location: 'Delhi WH', pin_code: '110001', city: 'Delhi', address: 'CP' }] } });
  if (url.pathname === '/orders/create/adhoc') { fake.orders.push(b); const n = fake.orders.length; return send(200, { order_id: 5000 + n, shipment_id: 9000 + n, status: 'NEW', status_code: 1 }); }
  if (url.pathname === '/courier/serviceability/') {
    const to = url.searchParams.get('delivery_postcode'), cod = url.searchParams.get('cod') === '1';
    if (to === '799001' || (to === '799002' && cod)) return send(200, { status: 404, data: { available_courier_companies: [] } });
    return send(200, { status: 200, data: { shiprocket_recommended_courier_id: 10, available_courier_companies: [{ courier_company_id: 10, courier_name: COURIERS[10], rate: 72, etd: 'Nov 3, 2026', estimated_delivery_days: '4', rating: 4.1 }, { courier_company_id: 24, courier_name: COURIERS[24], rate: 65, etd: 'Nov 4, 2026', estimated_delivery_days: '5' }] } });
  }
  if (url.pathname === '/courier/assign/awb') { fake.assigns.push(b); return send(200, { awb_assign_status: 1, response: { data: { awb_code: `AWB${b.shipment_id}`, courier_company_id: b.courier_id, courier_name: COURIERS[b.courier_id], shipment_id: b.shipment_id } } }); }
  if (url.pathname === '/courier/generate/pickup') { fake.pickups++; return send(200, { pickup_status: 1, response: { pickup_scheduled_date: '2026-10-31 10:00:00', pickup_token_number: 'PT1' } }); }
  if (url.pathname === '/courier/generate/label') return send(200, { label_created: 1, label_url: `https://labels.example/${b.shipment_id[0]}.pdf` });
  if (url.pathname === '/manifests/generate') return send(200, { status: 1, manifest_url: `https://manifests.example/${b.shipment_id[0]}.pdf` });
  const m = url.pathname.match(/^\/courier\/track\/awb\/(.+)$/);
  if (m) {
    fake.trackCalls++;
    const st = fake.track[m[1]] || 'PICKUP SCHEDULED';
    return send(200, { tracking_data: { track_status: 1, shipment_status: 0, shipment_track: [{ awb_code: m[1], current_status: st }], shipment_track_activities: [{ date: '2026-10-30 12:00:00', status: 'X', activity: `${st} at hub`, location: 'Delhi', 'sr-status-label': st }], track_url: `https://shiprocket.co/tracking/${m[1]}` } });
  }
  send(404, { message: 'not found' });
});

let srv, api, T, other, f, step;
const ADDR = { line1: '12, MG Road', line2: '', city: 'Bengaluru', state: 'Karnataka', pincode: '560001' };
let n = 0;
const codOrder = async (extra = {}) => {
  const r = await api(`/public/${f.slug}/cod`, 'POST', { stepId: step.id, email: `b${++n}@example.in`, name: 'Ravi Kumar', phone: `98765432${String(n).padStart(2, '0')}`, address: ADDR, ...extra });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return r.data.id || r.data.orderId || r.data.order?.id;
};
const order = async (id) => (await api(`/orders?limit=1&id=${encodeURIComponent(id)}`, 'GET', null, T)).data.orders[0];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

before(async () => {
  await new Promise((r) => fakeServer.listen(0, '127.0.0.1', r));
  srv = await startServer({ APP_URL: 'https://app.example.in', SHIPROCKET_BASE_URL: `http://127.0.0.1:${fakeServer.address().port}`, SHIP_POLL_MS: '400', SHIP_POLL_AGE_MS: '0', SHIP_POLL_GAP_MS: '0' });
  api = srv.api;
  T = (await register(api)).token;
  other = (await register(api)).token;
  f = (await api('/templates/pickle/use', 'POST', {}, T)).data;
  await api(`/funnels/${f.id}`, 'PUT', { published: true }, T);
  await api('/settings', 'PUT', { invoicing: { enabled: true, legalName: 'Amma Pickles LLP', gstin: '29ABCDE1234F1Z5', address: 'Indiranagar, Bengaluru', rate: 12 } }, T);
  step = f.steps.find((s) => s.blocks.some((b) => b.type === 'checkout'));
  const steps = f.steps.map((s) => (s.id !== step.id ? s : { ...s, blocks: s.blocks.map((b) => (b.type === 'checkout' ? { ...b, props: { ...b.props, cod: true, shippingFee: 49, codFee: 30 } } : b)) }));
  f = (await api(`/funnels/${f.id}`, 'PUT', { steps }, T)).data;
});
after(async () => { await srv.stop(); fakeServer.close(); });

test('connect: the API user is checked, pickups fetched, secrets stored encrypted and never returned', async () => {
  const none = (await api('/settings/shipping', 'GET', null, T)).data;
  assert.equal(none.shiprocket.connected, false);
  assert.equal((await api('/settings/shipping/nope', 'PUT', { email: 'a@b.in', password: 'x' }, T)).status, 404);
  const bad = await api('/settings/shipping/shiprocket', 'PUT', { email: 'api@seller.in', password: 'wrong' }, T);
  assert.equal(bad.status, 400);
  assert.match(bad.data.error, /didn’t accept/);
  const r = await api('/settings/shipping/shiprocket', 'PUT', { email: 'api@seller.in', password: 'good-pass', pkg: { weight: 0.8, length: 20, breadth: 15, height: 10 } }, T);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const s = r.data.shiprocket;
  assert.equal(s.connected, true);
  assert.equal(s.hasPassword, true);
  assert.deepEqual(s.pickups.map((p) => p.name), ['Primary', 'Delhi WH']);
  assert.equal(s.pickup, 'Primary');
  assert.equal(s.pkg.weight, 0.8);
  assert.match(s.webhookUrl, /^https:\/\/app\.example\.in\/api\/tracking-updates\/[0-9a-f]{48}$/);
  assert.doesNotMatch(s.webhookUrl, /shiprocket|kartrocket|\/sr|\/kr/i, 'Shiprocket refuses webhook URLs with these words');
  const text = JSON.stringify(r.data) + JSON.stringify((await api('/settings/shipping', 'GET', null, T)).data) + JSON.stringify((await api('/me', 'GET', null, T)).data) + JSON.stringify((await api('/channels', 'GET', null, T)).data);
  assert.ok(!text.includes('good-pass') && !text.includes(fake.token), 'no password or token in any response');
  await sleep(200);
  const disk = fs.readdirSync(srv.dataDir).filter((x) => /\.db/.test(x)).map((x) => fs.readFileSync(path.join(srv.dataDir, x)).toString('latin1')).join('');
  assert.ok(!disk.includes('good-pass') && !disk.includes(fake.token), 'stored encrypted');
  // saving other settings keeps the password; another pickup must be one of theirs
  assert.equal((await api('/settings/shipping/shiprocket', 'PUT', { pickup: 'Nowhere' }, T)).status, 400);
  const k = await api('/settings/shipping/shiprocket', 'PUT', { pickup: 'Delhi WH', notifyBuyer: true }, T);
  assert.equal(k.data.shiprocket.pickup, 'Delhi WH');
  assert.equal(fake.logins, 1, 'no new login when the password isn’t changed');
  await api('/settings/shipping/shiprocket', 'PUT', { pickup: 'Primary' }, T);
});

let codA;
test('rates; COD orders the buyer hasn’t confirmed are refused (with an override), cancelled ones always', async () => {
  codA = await codOrder();
  const rates = await api(`/orders/${codA}/shipping/rates`, 'GET', null, T);
  assert.equal(rates.status, 200, JSON.stringify(rates.data));
  assert.equal(rates.data.couriers.length, 2);
  assert.equal(rates.data.recommended, 10);
  assert.equal(rates.data.couriers.find((c) => c.id === 24).rate, 65);
  // the seller asks buyers to confirm: an unconfirmed COD order needs an override
  await api('/settings/cod', 'PUT', { confirm: true }, T);
  const refused = await api(`/orders/${codA}/shipping/shiprocket`, 'POST', {}, T);
  assert.equal(refused.status, 409);
  assert.equal(refused.data.code, 'cod_unconfirmed');
  assert.equal(refused.data.canOverride, true);
  assert.match(refused.data.error, /hasn’t confirmed|didn’t confirm/);
  assert.equal(fake.orders.length, 0, 'nothing booked');
  // the buyer cancels: never shipped
  const codX = await codOrder();
  await api(`/orders/${codX}/cod`, 'POST', { action: 'mark_cancelled' }, T);
  const c = await api(`/orders/${codX}/shipping/shiprocket`, 'POST', { override: true }, T);
  assert.equal(c.status, 400);
  assert.match(c.data.error, /cancelled/);
  // confirmed → ships with the chosen courier
  await api(`/orders/${codA}/cod`, 'POST', { action: 'confirm' }, T);
  const s = await api(`/orders/${codA}/shipping/shiprocket`, 'POST', { courierId: 24 }, T);
  assert.equal(s.status, 200, JSON.stringify(s.data));
  const sh = s.data.shipment;
  assert.equal(sh.awb, 'AWB9001');
  assert.equal(sh.courier, 'Xpressbees');
  assert.equal(sh.labelUrl, 'https://labels.example/9001.pdf');
  assert.equal(sh.manifestUrl, 'https://manifests.example/9001.pdf');
  assert.equal(sh.pickup.scheduledFor, '2026-10-31 10:00:00');
  assert.equal(s.data.fulfilment.status, 'shipped');
  assert.equal(s.data.fulfilment.stage, 'booked');
  assert.equal(s.data.fulfilment.tracking, 'AWB9001');
  assert.equal(s.data.status, 'cod', 'still unpaid in transit');
  const body = fake.orders[0];
  assert.equal(body.payment_method, 'COD');
  assert.equal(body.pickup_location, 'Primary');
  assert.equal(body.billing_pincode, '560001');
  assert.equal(body.billing_phone.length, 10);
  assert.equal(body.billing_customer_name, 'Ravi');
  assert.equal(body.shipping_charges, 49);
  assert.equal(body.transaction_charges, 30);
  assert.equal(body.weight, 0.8);
  assert.ok(body.order_items.length >= 1 && body.order_items.every((i) => i.sku && i.units >= 1 && i.selling_price > 0));
  assert.equal(body.sub_total + body.shipping_charges + body.transaction_charges - body.total_discount, s.data.total, 'COD to collect = the order total');
  assert.deepEqual(fake.assigns[0], { shipment_id: '9001', courier_id: 24 });
  // twice is refused
  const again = await api(`/orders/${codA}/shipping/shiprocket`, 'POST', {}, T);
  assert.equal(again.status, 400);
  assert.match(again.data.error, /Already shipped/);
});

test('another seller can’t see rates for, ship or track your order', async () => {
  const codB = await codOrder();
  assert.equal((await api(`/orders/${codB}/shipping/rates`, 'GET', null, other)).status, 404);
  assert.equal((await api(`/orders/${codB}/shipping/shiprocket`, 'POST', { override: true }, other)).status, 404);
  assert.equal((await api(`/orders/${codA}/shipping-track`, 'POST', {}, other)).status, 404);
  const bulk = (await api('/shipping/shiprocket/bulk', 'POST', { orders: [codB], override: true }, other)).data;
  assert.equal(bulk.shipped, 0);
  assert.equal(bulk.results[0].error, 'Order not found');
  assert.equal((await order(codB)).shipment, undefined);
});

let hookUrl;
const hook = (awb, status, headers = {}) => { fake.track[awb] = status; return fetch(hookUrl, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify({ awb, current_status: status, order_id: 'x', courier_name: 'Xpressbees', scans: [{ date: '2026-10-30 18:00:00', activity: `${status} — scan`, location: 'Bengaluru', 'sr-status-label': status }] }) }); };
test('tracking webhook: secret URL, out for delivery, delivered COD → paid and invoiced', async () => {
  hookUrl = (await api('/settings/shipping', 'GET', null, T)).data.shiprocket.webhookUrl.replace('https://app.example.in', srv.base);
  assert.equal((await fetch(`${srv.base}/api/tracking-updates/${'0'.repeat(48)}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"awb":"AWB9001","current_status":"DELIVERED"}' })).status, 404);
  assert.equal((await hook('AWB9001', 'DELIVERED', { 'x-api-key': 'wrong' })).status, 401);
  assert.equal((await order(codA)).status, 'cod', 'a refused update changed nothing');
  const ping = await fetch(hookUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  assert.equal(ping.status, 200, 'Shiprocket’s test ping gets a 200');
  assert.equal((await hook('AWB9001', 'OUT FOR DELIVERY')).status, 200);
  let o = await order(codA);
  assert.equal(o.shipment.stage, 'out_for_delivery');
  assert.equal(o.fulfilment.stage, 'out_for_delivery');
  assert.ok(o.shipment.events.some((e) => /OUT FOR DELIVERY/.test(e.status)));
  assert.equal((await hook('AWB9001', 'DELIVERED')).status, 200);
  o = await order(codA);
  assert.equal(o.fulfilment.status, 'delivered');
  assert.equal(o.status, 'paid', 'delivered COD counts as collected, as in the manual flow');
  assert.equal(o.invoices.length, 1);
  await hook('AWB9001', 'DELIVERED');
  assert.equal((await order(codA)).invoices.length, 1, 'a repeated update does nothing twice');
});

test('bulk ship; RTO cancels the unpaid COD order and counts in the buyer’s record; NDR tells the seller', async () => {
  const a = await codOrder({ phone: '9000000001' }), b = await codOrder({ phone: '9000000002' }), gone = await codOrder();
  await api(`/orders/${gone}/cod`, 'POST', { action: 'cancel' }, T);
  const noOverride = (await api('/shipping/shiprocket/bulk', 'POST', { orders: [a] }, T)).data;
  assert.equal(noOverride.results[0].code, 'cod_unconfirmed');
  const r = (await api('/shipping/shiprocket/bulk', 'POST', { orders: [a, b, gone], override: true }, T)).data;
  assert.equal(r.shipped, 2, JSON.stringify(r));
  assert.equal(r.failed, 1);
  assert.match(r.results[2].error, /cancelled/);
  assert.equal(r.results[0].courier, 'Delhivery Surface', 'the recommended courier');
  const oa = await order(a), ob = await order(b);
  assert.ok(oa.shipment.codOverride, 'the override is recorded');
  await hook(oa.shipment.awb, 'RTO INITIATED');
  const back = await order(a);
  assert.equal(back.status, 'cancelled');
  assert.ok(back.rtoAt);
  assert.equal(back.shipment.stage, 'rto_initiated');
  assert.equal((await api(`/orders/${a}/cod-risk`, 'GET', null, T)).data.rto, 1);
  await hook(oa.shipment.awb, 'RTO DELIVERED');
  assert.equal((await order(a)).shipment.stage, 'rto_delivered');
  await hook(ob.shipment.awb, 'UNDELIVERED');
  const nd = await order(b);
  assert.equal(nd.shipment.stage, 'ndr');
  assert.ok(nd.shipment.ndr.reason);
  assert.equal(nd.status, 'cod');
  const bell = (await api('/notifications', 'GET', null, T)).data.items;
  assert.ok(bell.some((x) => /Delivery failed/.test(x.title)));
  assert.ok(bell.some((x) => /RTO/.test(x.title)));
  assert.equal((await api('/orders?status=ndr', 'GET', null, T)).data.orders.length, 1, 'the NDR filter');
});

test('the poll picks up what the webhook missed; an expired token is refreshed', async () => {
  const c = await codOrder();
  await api(`/orders/${c}/cod`, 'POST', { action: 'confirm' }, T);
  const s = (await api(`/orders/${c}/shipping/shiprocket`, 'POST', {}, T)).data;
  fake.track[s.shipment.awb] = 'IN TRANSIT';
  let o;
  for (let i = 0; i < 40; i++) { await sleep(150); o = await order(c); if (o.shipment.stage === 'in_transit') break; }
  assert.equal(o.shipment.stage, 'in_transit');
  assert.ok(o.shipment.polledAt);
  const before = fake.logins;
  fake.expireNext = true;
  const t = await api(`/orders/${c}/shipping-track`, 'POST', {}, T);
  assert.equal(t.status, 200, JSON.stringify(t.data));
  assert.ok(fake.logins > before, 'logged in again after a 401');
});

test('checkout PIN code check asks Shiprocket only when the seller turns it on', async () => {
  const pin = async (p) => (await api(`/public/${f.slug}/pincode?pin=${p}`)).data;
  assert.equal((await pin('799001')).deliverable, true, 'off: the seller’s own rules only');
  await api('/settings/shipping/shiprocket', 'PUT', { checkPincode: true }, T);
  assert.equal((await pin('799001')).deliverable, false);
  const p2 = await pin('799002');
  assert.equal(p2.deliverable, true);
  assert.equal(p2.cod, false);
  const ok = await pin('560001');
  assert.equal(ok.deliverable, true);
  assert.equal(ok.cod, true);
});

test('disconnect forgets the credentials', async () => {
  const r = (await api('/settings/shipping/shiprocket', 'DELETE', null, T)).data;
  assert.equal(r.shiprocket.connected, false);
  const c = await codOrder();
  assert.match((await api(`/orders/${c}/shipping/shiprocket`, 'POST', { override: true }, T)).data.error, /Connect Shiprocket/);
});
