// Paid calls and Google Calendar: a priced calendar holds the slot while the buyer pays (Razorpay), confirms it on a
// verified payment with an order + invoice, refunds on an early cancellation; Google Calendar busy times block
// slots, each booking becomes a Google event with a Meet link, and cancelling removes it. Razorpay and Google are local fakes.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import { startServer, register } from './helpers.mjs';

const KEY = 'rzp_test_CaLlS1234567', SECRET = 'calls_secret';
const sign = (s, d) => crypto.createHmac('sha256', s).update(d).digest('hex');
const HOUR = 3600000, DAY = 86400000;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 4000) => { const end = Date.now() + ms; while (Date.now() < end) { const v = await fn(); if (v) return v; await wait(50); } return fn(); };
const body = (req) => new Promise((r) => { let b = ''; req.on('data', (c) => { b += c; }); req.on('end', () => r(b)); });
const refunds = [], events = [], deleted = [];
let busy = [];
let rzp, goog, srv, api, T, me, v, cal;

before(async () => {
  rzp = http.createServer(async (req, res) => {
    const b = JSON.parse((await body(req)) || '{}');
    res.setHeader('content-type', 'application/json');
    if (req.method === 'GET') return res.end('{"items":[]}');
    const m = /^\/payments\/(\w+)\/refund$/.exec(req.url);
    if (m) { const r = { id: `rfnd_${refunds.length}`, payment_id: m[1], amount: b.amount }; refunds.push(r); return res.end(JSON.stringify(r)); }
    res.end(JSON.stringify({ id: `order_${crypto.randomBytes(5).toString('hex')}`, amount: b.amount, currency: 'INR' }));
  }).listen(0);
  goog = http.createServer(async (req, res) => {
    const raw = await body(req);
    res.setHeader('content-type', 'application/json');
    if (req.url.startsWith('/token')) {
      const p = new URLSearchParams(raw);
      const idt = `x.${Buffer.from(JSON.stringify({ email: 'coach@gmail.com' })).toString('base64url')}.y`;
      return res.end(JSON.stringify(p.get('grant_type') === 'authorization_code' ? { access_token: 'at1', refresh_token: 'rt1', expires_in: 3600, id_token: idt } : { access_token: 'at2', expires_in: 3600 }));
    }
    if (req.url.startsWith('/cal/freeBusy')) return res.end(JSON.stringify({ calendars: { primary: { busy: busy.map(([s, e]) => ({ start: new Date(s).toISOString(), end: new Date(e).toISOString() })) } } }));
    if (req.method === 'POST' && req.url.startsWith('/cal/calendars/primary/events')) { const ev = { id: `ev${events.length}`, hangoutLink: 'https://meet.google.com/new-meet-xyz', ...JSON.parse(raw), url: req.url }; events.push(ev); return res.end(JSON.stringify(ev)); }
    if (req.method === 'DELETE') { deleted.push(req.url); res.writeHead(204); return res.end(); }
    res.writeHead(404); res.end('{}');
  }).listen(0);
  await wait(30);
  const g = `http://127.0.0.1:${goog.address().port}`;
  srv = await startServer({ RAZORPAY_API_URL: `http://127.0.0.1:${rzp.address().port}`, APP_URL: 'https://app.example.in', GOOGLE_CLIENT_ID: 'cid.apps.googleusercontent.com', GOOGLE_CLIENT_SECRET: 'csecret', GOOGLE_TOKEN_URL: `${g}/token`, GOOGLE_OAUTH_URL: `${g}/auth`, GOOGLE_CALENDAR_API: `${g}/cal`, GOOGLE_REVOKE_URL: `${g}/revoke` });
  api = srv.api;
  T = (await register(api)).token;
  me = (await api('/me', 'GET', null, T)).data;
  assert.equal((await api('/channels/razorpay', 'PUT', { keyId: KEY, keySecret: SECRET }, T)).status, 200);
  v = (await api('/templates/v-founders/use', 'POST', {}, T)).data;
  const st = v.steps.find((s) => s.blocks.some((b) => b.type === 'booking'));
  st.blocks.find((b) => b.type === 'booking').props.qualifiedOnly = false;
  v = (await api(`/funnels/${v.id}`, 'PUT', { steps: v.steps, published: true }, T)).data;
  cal = (await api('/calendars', 'GET', null, T)).data[0];
  const hours = Object.fromEntries(['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].map((d) => [d, [['09:00', '13:00']]]));
  cal = (await api(`/calendars/${cal.id}`, 'PUT', { duration: 60, buffer: 0, noticeHours: 0, daysAhead: 7, hours, price: 1499, refundHours: 24, meetingLink: '' }, T)).data;
});
after(async () => { await srv.stop(); rzp.close(); goog.close(); });

const bookStep = () => v.steps.find((s) => s.blocks.some((b) => b.type === 'booking'));
const blockId = () => bookStep().blocks.find((b) => b.type === 'booking').id;
const slots = async () => (await api(`/public/${v.slug}/slots?stepId=${bookStep().id}&blockId=${blockId()}`)).data;
const book = (start, email) => api(`/public/${v.slug}/book`, 'POST', { stepId: bookStep().id, blockId: blockId(), start, email, name: 'Arjun Mehta', phone: '9876512345' });

test('Google Calendar: connect with OAuth; busy times in Google block those slots', async () => {
  const c = (await api('/google/calendar/connect', 'POST', {}, T)).data;
  const u = new URL(c.url);
  assert.equal(u.searchParams.get('access_type'), 'offline');
  assert.match(u.searchParams.get('scope'), /calendar\.events/);
  assert.equal((await fetch(`${srv.base}/api/google/calendar/callback?code=abc&state=forged.1.x`, { redirect: 'manual' })).headers.get('location'), '/bookings?gcal=expired');
  const back = await fetch(`${srv.base}/api/google/calendar/callback?code=abc&state=${encodeURIComponent(u.searchParams.get('state'))}`, { redirect: 'manual' });
  assert.equal(back.headers.get('location'), '/bookings?gcal=connected');
  const st = (await api('/google/calendar', 'GET', null, T)).data;
  assert.deepEqual([st.connected, st.email], [true, 'coach@gmail.com']);
  assert.ok(!JSON.stringify((await api('/channels', 'GET', null, T)).data).includes('rt1'), 'the token never leaves the server');
  const before = (await slots()).slots;
  busy = [[before[0], before[0] + HOUR]]; // the coach is busy at the first open slot
  await api('/google/calendar', 'PUT', { blockBusy: true }, T); // clears the cache
  const after = (await slots()).slots;
  assert.ok(!after.includes(before[0]), 'busy in Google → not offered');
  assert.equal(after.length, before.length - 1);
  assert.equal((await slots()).calendar.price, 1499);
});

let paid, start;
test('a paid call: the slot is held while paying, confirmed on a verified payment, invoiced and added to Google with Meet', async () => {
  start = (await slots()).slots[0];
  const r = (await book(start, 'arjun@x.in')).data;
  assert.ok(r.pay?.order_id, JSON.stringify(r));
  assert.equal(r.pay.amount, 149900);
  assert.ok(!(await slots()).slots.includes(start), 'held while they pay');
  assert.equal((await book(start, 'other@x.in')).status, 409);
  const pid = `pay_${crypto.randomBytes(4).toString('hex')}`;
  assert.equal((await api(`/public/${v.slug}/book/verify`, 'POST', { payment: r.pay.payment, razorpay_order_id: r.pay.order_id, razorpay_payment_id: pid, razorpay_signature: 'f'.repeat(64) })).status, 400);
  const ok = (await api(`/public/${v.slug}/book/verify`, 'POST', { payment: r.pay.payment, razorpay_order_id: r.pay.order_id, razorpay_payment_id: pid, razorpay_signature: sign(SECRET, `${r.pay.order_id}|${pid}`) })).data;
  assert.ok(ok.ok && ok.orderId, JSON.stringify(ok));
  paid = ok;
  const orders = (await api('/orders', 'GET', null, T)).data.orders;
  const o = orders.find((x) => x.id === ok.orderId);
  assert.equal(o.total, 1499);
  assert.equal(o.items[0].kind, 'booking');
  const ev = await until(() => events.find((e) => e.attendees?.[0]?.email === 'arjun@x.in'));
  assert.ok(ev, 'added to Google Calendar');
  assert.match(ev.url, /conferenceDataVersion=1/, 'with a Meet link (no meeting link of its own)');
  const bk = await until(async () => (await api('/bookings', 'GET', null, T)).data.find((b) => b.email === 'arjun@x.in' && b.google));
  assert.equal(bk.calendar.meetingLink, 'https://meet.google.com/new-meet-xyz');
  assert.equal(bk.paid, 1499);
});

test('cancelling early refunds the call and removes the Google event; a late cancellation keeps the payment', async () => {
  const [id, q] = paid.manage.split('/booking/')[1].split('?');
  const t = new URLSearchParams(q).get('t');
  await api(`/calendars/${cal.id}`, 'PUT', { refundHours: 0 }, T); // any time before the call
  await api(`/booking/${id}/cancel`, 'POST', { t });
  assert.ok(await until(() => refunds.find((x) => x.amount === 149900)), 'refunded through Razorpay');
  assert.ok(await until(() => deleted.some((u) => u.includes('/events/ev'))), 'Google event removed');
  // a call within the refund window: no refund
  await api(`/calendars/${cal.id}`, 'PUT', { refundHours: 720 }, T);
  const s2 = (await slots()).slots[1];
  const r = (await book(s2, 'late@x.in')).data;
  const pid = `pay_${crypto.randomBytes(4).toString('hex')}`;
  const ok = (await api(`/public/${v.slug}/book/verify`, 'POST', { payment: r.pay.payment, razorpay_order_id: r.pay.order_id, razorpay_payment_id: pid, razorpay_signature: sign(SECRET, `${r.pay.order_id}|${pid}`) })).data;
  const [id2, q2] = ok.manage.split('/booking/')[1].split('?');
  const n = refunds.length;
  await api(`/booking/${id2}/cancel`, 'POST', { t: new URLSearchParams(q2).get('t') });
  await wait(300);
  assert.equal(refunds.length, n, 'cancelled too late for a refund');
});

test('without Razorpay a priced call is booked and marked unpaid; disconnecting Google', async () => {
  await api('/channels/razorpay', 'PUT', { clear: true }, T);
  const s = (await slots()).slots[2];
  const r = (await book(s, 'cash@x.in')).data;
  assert.ok(r.ok && !r.pay);
  const bk = (await api('/bookings', 'GET', null, T)).data.find((b) => b.email === 'cash@x.in');
  assert.equal(bk.unpaid, true);
  assert.equal((await api('/google/calendar', 'DELETE', null, T)).data.connected, false);
});
