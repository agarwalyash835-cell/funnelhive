// Physical products: delivery address at checkout, Cash on Delivery (with and without fees), shipping with
// courier tracking, delivered COD → paid + invoiced, returned COD → cancelled, and the seller's controls.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, register } from './helpers.mjs';

let srv, api, T, f, step;
const ADDR = { line1: '12, MG Road', line2: 'Near Metro', city: 'Bengaluru', state: 'Karnataka', pincode: '560001' };
const buyer = (extra = {}) => ({ stepId: step.id, email: 'ravi@example.in', name: 'Ravi Kumar', phone: '9876543210', address: ADDR, ...extra });
before(async () => {
  srv = await startServer({ APP_URL: 'https://app.example.in' });
  api = srv.api;
  T = (await register(api)).token;
  f = (await api('/templates/pickle/use', 'POST', {}, T)).data;
  await api(`/funnels/${f.id}`, 'PUT', { published: true }, T);
  await api('/settings', 'PUT', { invoicing: { enabled: true, legalName: 'Amma Pickles LLP', gstin: '29ABCDE1234F1Z5', address: 'Indiranagar, Bengaluru', rate: 12 } }, T);
  step = f.steps.find((s) => s.blocks.some((b) => b.type === 'checkout'));
});
after(() => srv.stop());

const setCheckout = async (props) => {
  const steps = f.steps.map((s) => (s.id !== step.id ? s : { ...s, blocks: s.blocks.map((b) => (b.type === 'checkout' ? { ...b, props: { ...b.props, ...props } } : b)) }));
  f = (await api(`/funnels/${f.id}`, 'PUT', { steps }, T)).data;
  step = f.steps.find((s) => s.id === step.id);
};
const order = async (id) => (await api('/orders', 'GET', null, T)).data.orders.find((o) => o.id === id);

test('a shipping checkout needs a valid address', async () => {
  assert.equal(step.blocks.find((b) => b.type === 'checkout').props.shipping, 'address', 'physical product templates ship');
  const none = await api(`/public/${f.slug}/cod`, 'POST', buyer({ address: undefined }));
  assert.equal(none.status, 400);
  assert.match(none.data.error, /address/i);
  assert.match((await api(`/public/${f.slug}/cod`, 'POST', buyer({ address: { ...ADDR, pincode: '0123' } }))).data.error, /PIN/);
  assert.match((await api(`/public/${f.slug}/cod`, 'POST', buyer({ address: { ...ADDR, state: 'Atlantis' } }))).data.error, /state/i);
  assert.match((await api(`/public/${f.slug}/cod`, 'POST', buyer({ phone: '123' }))).data.error, /mobile/i);
  assert.equal((await api(`/public/${f.slug}/order`, 'POST', buyer({ address: undefined }))).status, 400, 'the demo checkout checks it too');
});

let cod;
test('Cash on Delivery: booked unpaid with delivery + COD fees as line items', async () => {
  await setCheckout({ shippingFee: 49, codFee: 30, cod: true });
  const r = await api(`/public/${f.slug}/cod`, 'POST', buyer());
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.provider, 'cod');
  cod = await order(r.data.id || r.data.orderId || r.data.order?.id);
  assert.ok(cod, JSON.stringify(r.data));
  assert.equal(cod.status, 'cod');
  assert.deepEqual(cod.address, ADDR);
  assert.equal(cod.fulfilment.status, 'pending');
  assert.ok(cod.items.some((i) => i.kind === 'shipping' && i.price === 49));
  assert.ok(cod.items.some((i) => i.kind === 'cod_fee' && i.price === 30));
  assert.equal(cod.total, cod.items.reduce((a, i) => a + i.price, 0));
  assert.equal(cod.invoices.length, 0, 'no invoice until the cash is collected');
  // online checkouts never pay the COD fee
  const online = await api(`/public/${f.slug}/order`, 'POST', buyer({ email: 'online@example.in' }));
  const o = await order(online.data.id || online.data.orderId || online.data.order?.id);
  assert.ok(!o.items.some((i) => i.kind === 'cod_fee'));
  assert.ok(o.items.some((i) => i.kind === 'shipping'));
});

test('COD can be switched off, and is never offered on a checkout that doesn’t allow it', async () => {
  await setCheckout({ cod: false });
  assert.equal((await api(`/public/${f.slug}/cod`, 'POST', buyer())).status, 400);
  await setCheckout({ cod: true });
});

test('shipping emails tracking; delivered COD becomes paid and invoiced', async () => {
  assert.equal((await api(`/orders/${cod.id}/fulfil`, 'POST', { status: 'lost' }, T)).status, 400);
  const s = (await api(`/orders/${cod.id}/fulfil`, 'POST', { status: 'shipped', courier: 'Delhivery', tracking: 'AWB123' }, T)).data;
  assert.equal(s.fulfilment.status, 'shipped');
  assert.match(s.fulfilment.trackingUrl, /delhivery\.com.*AWB123/);
  assert.equal(s.status, 'cod', 'still unpaid while in transit');
  const d = (await api(`/orders/${cod.id}/fulfil`, 'POST', { status: 'delivered' }, T)).data;
  assert.equal(d.status, 'paid');
  assert.equal(d.fulfilment.status, 'delivered');
  const o = await order(cod.id);
  assert.equal(o.invoices.length, 1, 'invoiced once on delivery');
  const inv = (await api('/sales-invoices', 'GET', null, T)).data.find((i) => i.orderId === cod.id);
  assert.equal(inv.placeOfSupply, 'Karnataka', 'goods: supplied where delivered');
  assert.equal(inv.total, cod.total);
  assert.equal((await api(`/orders/${cod.id}/cod`, 'POST', { action: 'paid' }, T)).status, 400, 'settling twice is refused');
});

test('a returned (RTO) COD order is cancelled and leaves revenue', async () => {
  const r = await api(`/public/${f.slug}/cod`, 'POST', buyer({ email: 'rto@example.in' }));
  const id = r.data.id || r.data.orderId || r.data.order?.id;
  await api(`/orders/${id}/fulfil`, 'POST', { status: 'shipped', courier: 'DTDC', tracking: 'X1' }, T);
  const back = (await api(`/orders/${id}/fulfil`, 'POST', { status: 'returned' }, T)).data;
  assert.equal(back.status, 'cancelled');
  assert.equal(back.total, 0);
  assert.equal((await api(`/orders/${id}/fulfil`, 'POST', { status: 'shipped' }, T)).status, 400, 'a cancelled order can’t ship');
  // cancel before shipping, and the owner check
  const r2 = await api(`/public/${f.slug}/cod`, 'POST', buyer({ email: 'cancel@example.in' }));
  const id2 = r2.data.id || r2.data.orderId || r2.data.order?.id;
  const other = (await register(api)).token;
  assert.equal((await api(`/orders/${id2}/cod`, 'POST', { action: 'cancel' }, other)).status, 404);
  assert.equal((await api(`/orders/${id2}/cod`, 'POST', { action: 'cancel' }, T)).data.status, 'cancelled');
});
