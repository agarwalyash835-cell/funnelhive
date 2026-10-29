// Shiprocket (https://apidocs.shiprocket.in) as a courier adapter for shipping.js. Every adapter has the same shape:
//   login(creds) → { token, expiresAt }      pickups(ctx) → [{ name, pincode, city, address }]
//   createOrder(ctx, order) → { orderId, shipmentId }   rates(ctx, q) → { couriers: [...], recommended }
//   assign(ctx, shipmentId, courierId) → { awb, courierId, courier }   pickup / label / manifest(ctx, shipmentId)
//   track(ctx, awb) → { status, events, trackUrl }   webhook(body) → { awb, status, events }   stage(text, id)
// ctx = { token, relogin } — a 401 logs in again once (the token lasts 10 days; shipping.js keeps it ~9).
// Shiprocket's API user (Settings → API → Configure, a separate login from the seller's own) is what's entered.
const BASE = () => String(process.env.SHIPROCKET_BASE_URL || 'https://apiv2.shiprocket.in/v1/external').replace(/\/+$/, '');
const TIMEOUT = 20000;

export class CourierError extends Error { constructor(msg, status = 400, extra = {}) { super(msg); this.status = status; Object.assign(this, extra); } }
const msgOf = (d, status) => {
  const errs = d?.errors && typeof d.errors === 'object' ? Object.values(d.errors).flat().filter(Boolean).join(' · ') : '';
  return String(errs || d?.message || d?.error || `Shiprocket error ${status}`).slice(0, 300);
};

async function call(ctx, method, path, body, retried = false) {
  let r;
  try {
    r = await fetch(`${BASE()}${path}`, { method, headers: { 'Content-Type': 'application/json', ...(ctx?.token ? { Authorization: `Bearer ${ctx.token}` } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(TIMEOUT) });
  } catch { throw new CourierError('Couldn’t reach Shiprocket — please try again in a minute', 502); }
  const d = await r.json().catch(() => ({}));
  if (r.status === 401 && ctx?.relogin && !retried) { ctx.token = await ctx.relogin(); return call(ctx, method, path, body, true); }
  if (!r.ok) throw new CourierError(`Shiprocket: ${msgOf(d, r.status)}`, r.status === 401 ? 400 : r.status >= 500 ? 502 : 400, { courierStatus: r.status });
  return d;
}

export const name = 'Shiprocket';

export async function login({ email, password }) {
  let r;
  try { r = await fetch(`${BASE()}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }), signal: AbortSignal.timeout(TIMEOUT) }); } catch { throw new CourierError('Couldn’t reach Shiprocket — please try again in a minute', 502); }
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d.token) throw new CourierError(r.status === 401 || r.status === 403 || r.status === 400 ? 'Shiprocket didn’t accept that API user email and password (create an API user under Settings → API in Shiprocket)' : `Shiprocket: ${msgOf(d, r.status)}`, 400);
  return { token: String(d.token), expiresAt: Date.now() + 9 * 86400000 };
}

export async function pickups(ctx) {
  const d = await call(ctx, 'GET', '/settings/company/pickup');
  const list = d?.data?.shipping_address || d?.shipping_address || [];
  return list.map((p) => ({ name: String(p.pickup_location || ''), pincode: String(p.pin_code || p.pincode || ''), city: String(p.city || ''), address: [p.address, p.address_2].filter(Boolean).join(', ').slice(0, 200), id: p.id ?? null })).filter((p) => p.name);
}

const two = (n) => String(n).padStart(2, '0');
const srDate = (t) => { const d = new Date(t); return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}`; };

// order: { ref, at, pickup, buyer: { first, last, phone, email, address: { line1, line2, city, state, pincode } }, items: [{ name, sku, qty, price, hsn }],
//          cod, subTotal, shipping, codFee, discount, pkg: { weight, length, breadth, height } }
export async function createOrder(ctx, o) {
  const a = o.buyer.address;
  const body = {
    order_id: o.ref, order_date: srDate(o.at), pickup_location: o.pickup,
    billing_customer_name: o.buyer.first, billing_last_name: o.buyer.last || '', billing_address: a.line1, billing_address_2: a.line2 || '', billing_city: a.city, billing_pincode: a.pincode, billing_state: a.state || '', billing_country: 'India', billing_email: o.buyer.email || '', billing_phone: o.buyer.phone,
    shipping_is_billing: true,
    order_items: o.items.map((i) => ({ name: i.name, sku: i.sku, units: i.qty, selling_price: i.price, discount: 0, tax: '', hsn: i.hsn || '' })),
    payment_method: o.cod ? 'COD' : 'Prepaid', shipping_charges: o.shipping || 0, transaction_charges: o.codFee || 0, total_discount: o.discount || 0, sub_total: o.subTotal,
    length: o.pkg.length, breadth: o.pkg.breadth, height: o.pkg.height, weight: o.pkg.weight,
  };
  const d = await call(ctx, 'POST', '/orders/create/adhoc', body);
  if (!d.shipment_id) throw new CourierError(`Shiprocket didn’t create the shipment: ${msgOf(d, 200)}`, 400);
  return { orderId: String(d.order_id), shipmentId: String(d.shipment_id), awb: d.awb_code ? String(d.awb_code) : '' };
}

// couriers for a lane: { couriers: [{ id, name, rate, etd, days, cod, rating }], recommended }
export async function rates(ctx, { from, to, cod, weight, orderId }) {
  const qs = new URLSearchParams({ pickup_postcode: from, delivery_postcode: to, cod: cod ? '1' : '0', weight: String(weight), ...(orderId ? { order_id: orderId } : {}) });
  const d = await call(ctx, 'GET', `/courier/serviceability/?${qs}`);
  const list = d?.data?.available_courier_companies || [];
  const couriers = list.map((c) => ({ id: Number(c.courier_company_id), name: String(c.courier_name || ''), rate: Number(c.rate ?? c.freight_charge ?? 0), etd: String(c.etd || ''), days: Number(c.estimated_delivery_days) || null, cod: c.cod === undefined ? true : !!Number(c.cod), rating: Number(c.rating) || null })).filter((c) => c.id);
  const rec = Number(d?.data?.shiprocket_recommended_courier_id || d?.data?.recommended_courier_company_id || 0);
  return { couriers, recommended: couriers.some((c) => c.id === rec) ? rec : (couriers.slice().sort((a, b) => a.rate - b.rate)[0]?.id || null) };
}

export async function assign(ctx, shipmentId, courierId) {
  const d = await call(ctx, 'POST', '/courier/assign/awb', { shipment_id: shipmentId, ...(courierId ? { courier_id: courierId } : {}) });
  const x = d?.response?.data || {};
  if (Number(d.awb_assign_status) !== 1 || !x.awb_code) throw new CourierError(`Shiprocket couldn’t assign an AWB: ${msgOf(x.awb_assign_error ? { message: x.awb_assign_error } : d, 200)}`, 400);
  return { awb: String(x.awb_code), courierId: Number(x.courier_company_id) || courierId || null, courier: String(x.courier_name || '') };
}

export async function pickup(ctx, shipmentId) {
  const d = await call(ctx, 'POST', '/courier/generate/pickup', { shipment_id: [shipmentId] });
  const x = d?.response || {};
  return { scheduledFor: String(x.pickup_scheduled_date || ''), token: String(x.pickup_token_number || '') };
}
export async function label(ctx, shipmentId) {
  const d = await call(ctx, 'POST', '/courier/generate/label', { shipment_id: [shipmentId] });
  return String(d.label_url || '');
}
export async function manifest(ctx, shipmentId) {
  const d = await call(ctx, 'POST', '/manifests/generate', { shipment_id: [shipmentId] });
  return String(d.manifest_url || '');
}

const event = (s) => ({ at: Date.parse(String(s.date || '').replace(' ', 'T')) || Date.now(), status: String(s['sr-status-label'] || s.activity || s.status || '').slice(0, 120), activity: String(s.activity || '').slice(0, 200), location: String(s.location || '').slice(0, 120), code: String(s['sr-status'] ?? '') });

export async function track(ctx, awb) {
  const d = await call(ctx, 'GET', `/courier/track/awb/${encodeURIComponent(awb)}`);
  const t = d?.tracking_data || {};
  const cur = (t.shipment_track || [])[0] || {};
  return { status: String(cur.current_status || ''), statusId: Number(t.shipment_status) || null, events: (t.shipment_track_activities || []).map(event), trackUrl: String(t.track_url || ''), etd: String(t.etd || cur.edd || '') };
}

// what Shiprocket POSTs to the tracking webhook (Settings → API → Webhooks)
export function webhook(b = {}) {
  return { awb: String(b.awb || ''), orderRef: String(b.order_id || ''), status: String(b.current_status || b.shipment_status || ''), statusId: Number(b.current_status_id ?? b.shipment_status_id) || null, events: (Array.isArray(b.scans) ? b.scans : []).map(event), courier: String(b.courier_name || ''), etd: String(b.etd || '') };
}

// Shiprocket's status text (and id, as a fallback) → our stage. The text is matched first: ids differ between docs.
const IDS = { 6: 'in_transit', 7: 'delivered', 8: 'cancelled', 9: 'rto_initiated', 10: 'rto_delivered', 12: 'lost', 14: 'rto_initiated', 17: 'out_for_delivery', 18: 'in_transit', 19: 'booked', 21: 'ndr', 38: 'in_transit', 42: 'picked_up' };
export function stage(text, id) {
  const s = String(text || '').toUpperCase().replace(/[_-]+/g, ' ').trim();
  if (/^RTO.*(DELIVERED|ACKNOWLEDGED)/.test(s)) return 'rto_delivered';
  if (/^RTO|RETURN/.test(s)) return 'rto_initiated';
  if (/UNDELIVERED|NDR|FAILED DELIVERY|DELIVERY ATTEMPT/.test(s)) return 'ndr';
  if (/OUT FOR DELIVERY/.test(s)) return 'out_for_delivery';
  if (/^DELIVERED/.test(s)) return 'delivered';
  if (/CANCEL/.test(s)) return 'cancelled';
  if (/LOST|DAMAGED|DESTROYED/.test(s)) return 'lost';
  if (/PICKED UP|PICKUP COMPLETE/.test(s)) return 'picked_up';
  if (/TRANSIT|SHIPPED|REACHED|DESTINATION|HUB|DISPATCH/.test(s)) return 'in_transit';
  if (/PICKUP|MANIFEST|AWB|NEW|BOOKED/.test(s)) return 'booked';
  return IDS[id] || null;
}
