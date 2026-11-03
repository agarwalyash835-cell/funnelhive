// Bookings → Calendar: the bookings of a date range; the seller books someone in at any time (outside their hours too)
// but never on top of another booking; drags a booking to a new time (the old one is marked rescheduled, the customer
// told); blocks a time (lunch, leave) that the booking page then stops offering; and group sessions — several people
// on the same start time until it's full, with the seats left shown.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, register } from './helpers.mjs';

let srv, api, T, cal, handle;
const MIN = 60000, HOUR = 3600000, DAY = 86400000;
// 10:00 IST on a day N days from now (IST is UTC+5:30, no daylight saving)
const ist = (days, hh = 10, mm = 0) => { const d = new Date(Date.now() + 330 * MIN + days * DAY); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), hh, mm) - 330 * MIN; };
before(async () => {
  srv = await startServer({ APP_URL: 'https://app.example.in' });
  api = srv.api;
  T = (await register(api)).token;
  cal = (await api('/calendars', 'GET', null, T)).data[0];
  const hours = Object.fromEntries(['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].map((d) => [d, [['10:00', '13:00']]]));
  cal = (await api(`/calendars/${cal.id}`, 'PUT', { duration: 60, buffer: 0, noticeHours: 0, daysAhead: 14, hours, timezone: 'Asia/Kolkata' }, T)).data;
  handle = (await api('/booking-page', 'GET', null, T)).data.handle;
});
after(async () => { await srv.stop(); });
// a booking made on the public booking page → its id (from the manage link)
const bookOnPage = async (c, start, email, name) => { const r = (await api(`/meet/${handle}/${c.slug}/book`, 'POST', { start, email, name })).data; assert.ok(r.ok, JSON.stringify(r)); return r.manage.match(/\/booking\/([\w-]+)/)[1]; };
const pageSlots = async (c = cal) => (await api(`/meet/${handle}/${c.slug}`)).data;

test('the seller books someone in at any time — outside their hours too — but never on top of another booking', async () => {
  const evening = ist(2, 19);
  assert.ok(!(await pageSlots()).slots.includes(evening), '7 pm isn’t offered on the booking page');
  assert.equal((await api('/bookings', 'POST', { calendarId: cal.id, start: evening, email: 'asha@example.com', name: 'Asha' }, T)).status, 409, 'without "any time", only an offered slot');
  const b = await api('/bookings', 'POST', { calendarId: cal.id, start: evening, email: 'asha@example.com', name: 'Asha', anytime: true }, T);
  assert.equal(b.status, 200, JSON.stringify(b.data));
  assert.equal(b.data.start, evening);
  const clash = await api('/bookings', 'POST', { calendarId: cal.id, start: evening + 30 * MIN, email: 'ravi@example.com', anytime: true }, T);
  assert.equal(clash.status, 409, 'overlaps Asha’s call');
  assert.equal((await api('/bookings', 'POST', { calendarId: cal.id, start: Date.now() - DAY, email: 'x@example.com', anytime: true }, T)).status, 400, 'not in the past');
  // the calendar's range
  const list = (await api(`/bookings?from=${ist(2, 0)}&to=${ist(3, 0)}`, 'GET', null, T)).data;
  assert.deepEqual(list.map((x) => x.name), ['Asha']);
  assert.equal((await api(`/bookings?from=${ist(3, 0)}&to=${ist(4, 0)}`, 'GET', null, T)).data.length, 0);
});

test('dragging a booking to a new time moves it: the old one is marked rescheduled, the slot frees up', async () => {
  const id = await bookOnPage(cal, ist(3, 10), 'meera@example.com', 'Meera');
  const moved = await api(`/bookings/${id}/move`, 'POST', { start: ist(3, 12) }, T);
  assert.equal(moved.status, 200, JSON.stringify(moved.data));
  assert.equal(moved.data.start, ist(3, 12));
  const all = (await api(`/bookings?from=${ist(3, 0)}&to=${ist(4, 0)}`, 'GET', null, T)).data;
  assert.deepEqual(all.map((x) => [x.name, x.status, x.start]).sort((a, c) => a[2] - c[2]), [['Meera', 'rescheduled', ist(3, 10)], ['Meera', 'confirmed', ist(3, 12)]]);
  const s = (await pageSlots()).slots;
  assert.ok(s.includes(ist(3, 10)) && !s.includes(ist(3, 12)), '10 am free again, noon taken');
  // onto another booking: refused
  const other = await bookOnPage(cal, ist(3, 11), 'kavya@example.com', 'Kavya');
  assert.equal((await api(`/bookings/${moved.data.id}/move`, 'POST', { start: ist(3, 11) }, T)).status, 409);
  assert.equal((await api(`/bookings/${other}/move`, 'POST', { start: Date.now() - HOUR }, T)).status, 400);
});

test('a blocked time leaves the booking page; it can be removed; a block over a booking says so', async () => {
  const lunch = await api('/booking-blocks', 'POST', { start: ist(4, 11), end: ist(4, 13), note: 'Site visit' }, T);
  assert.equal(lunch.status, 200, JSON.stringify(lunch.data));
  assert.equal(lunch.data.clash, 0);
  const s = (await pageSlots()).slots;
  assert.ok(s.includes(ist(4, 10)) && !s.includes(ist(4, 11)) && !s.includes(ist(4, 12)), '10 am offered, 11 and 12 blocked');
  assert.equal((await api('/bookings', 'POST', { calendarId: cal.id, start: ist(4, 11, 30), email: 'z@example.com', anytime: true }, T)).status, 409, 'can’t book into your own blocked time');
  // a block over an existing booking: allowed, and counted
  const over = (await api('/booking-blocks', 'POST', { start: ist(3, 11), end: ist(3, 13) }, T)).data;
  assert.equal(over.clash, 2, 'Kavya at 11 and Meera at noon');
  const blocks = (await api('/booking-blocks', 'DELETE', null, T)).status;
  assert.equal(blocks, 404);
  const left = (await api(`/booking-blocks/${lunch.data.block.id}`, 'DELETE', null, T)).data.blocks;
  assert.ok(!left.some((x) => x.id === lunch.data.block.id));
  assert.ok((await pageSlots()).slots.includes(ist(4, 11)), 'unblocked: offered again');
  // bad input
  assert.equal((await api('/booking-blocks', 'POST', { start: ist(5, 12), end: ist(5, 11) }, T)).status, 400);
  assert.equal((await api('/booking-blocks', 'POST', { start: Date.now() - 2 * DAY, end: Date.now() - DAY }, T)).status, 400);
});

test('a group session: several people on the same time until it’s full, with the seats left on the booking page', async () => {
  const g = (await api('/calendars', 'POST', { name: 'Demo class', duration: 60, buffer: 0, noticeHours: 0, daysAhead: 14, seats: 3, hours: Object.fromEntries(['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].map((d) => [d, [['17:00', '19:00']]])), timezone: 'Asia/Kolkata' }, T)).data;
  assert.equal(g.seats, 3);
  const at = ist(5, 17);
  let p = await pageSlots(g);
  assert.deepEqual([p.seats, p.left[at]], [3, 3]);
  for (const e of ['a', 'b']) assert.equal((await api(`/meet/${handle}/${g.slug}/book`, 'POST', { start: at, email: `${e}@example.com`, name: e })).status, 200);
  p = await pageSlots(g);
  assert.equal(p.left[at], 1, '1 seat left');
  assert.ok(p.slots.includes(at + HOUR) && p.left[at + HOUR] === 3, 'the next session untouched');
  assert.equal((await api(`/meet/${handle}/${g.slug}/book`, 'POST', { start: at, email: 'c@example.com', name: 'c' })).status, 200);
  p = await pageSlots(g);
  assert.ok(!p.slots.includes(at), 'full: no longer offered');
  assert.equal((await api(`/meet/${handle}/${g.slug}/book`, 'POST', { start: at, email: 'd@example.com', name: 'd' })).status, 409);
  // a one-to-one calendar shows no seat counts
  assert.equal((await pageSlots()).left, undefined);
});
