// Booking pages (/meet/<handle>/<call>): profile, clean start times, several lengths, own questions, outcomes.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, register } from './helpers.mjs';

let srv, api, T, cal, handle;
const MIN = 60000;
before(async () => {
  srv = await startServer({ APP_URL: 'https://app.example.in' });
  api = srv.api;
  T = (await register(api)).token;
});
after(() => srv.stop());

test('every seller gets a booking page address; it can be changed but not taken twice', async () => {
  handle = (await api('/booking-page', 'GET', null, T)).data.handle;
  assert.match(handle, /^[a-z0-9-]{3,}$/);
  assert.equal((await api('/booking-page', 'PUT', { handle: 'Asha Coaching!' }, T)).data.handle, 'asha-coaching');
  handle = 'asha-coaching';
  const T2 = (await register(api)).token;
  assert.equal((await api('/booking-page', 'PUT', { handle: 'asha-coaching' }, T2)).status, 409);
  assert.equal((await api('/booking-page', 'PUT', { handle: 'ab' }, T)).status, 400);
});

test('call types: clean start times, several lengths, hidden ones only by link', async () => {
  cal = (await api('/calendars', 'GET', null, T)).data[0];
  assert.ok(cal.slug, 'old calendars get an address');
  const hours = Object.fromEntries(['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].map((d) => [d, [['09:00', '12:00']]]));
  cal = (await api(`/calendars/${cal.id}`, 'PUT', { name: 'Strategy Call', slug: 'Strategy Call', duration: 30, durations: [30, 60], buffer: 10, noticeHours: 0, daysAhead: 5, hours, price: 0, questions: [{ id: 'goal', label: 'What do you want help with?', type: 'long', required: true }, { id: 'size', label: 'Team size', type: 'select', options: '1-5, 6-20, 20+' }] }, T)).data;
  assert.equal(cal.slug, 'strategy-call');
  assert.deepEqual(cal.durations, [30, 60]);
  const hidden = (await api('/calendars', 'POST', { name: 'VIP session', listed: false, hours }, T)).data;

  const prof = (await api(`/meet/${handle}`)).data;
  assert.deepEqual(prof.calendars.map((c) => c.slug), ['strategy-call'], 'hidden call types are not listed');
  assert.equal((await api(`/meet/${handle}/${hidden.slug}`)).status, 200, 'but open by link');
  assert.equal((await api(`/meet/nobody-here/x`)).status, 404);

  const page = (await api(`/meet/${handle}/strategy-call`)).data;
  assert.equal(page.duration, 30);
  assert.equal(page.calendar.questions.length, 2);
  // 30-minute buffer 10: starts on the hour and half hour, never 9:40
  assert.ok(page.slots.length > 10);
  assert.ok(page.slots.every((t) => new Date(t).getUTCMinutes() % 30 === 0), 'clean start times');
  const long = (await api(`/meet/${handle}/strategy-call?d=60`)).data;
  assert.equal(long.duration, 60);
  assert.ok(long.slots.every((t) => { const m = new Date(t + 330 * MIN); return m.getUTCHours() * 60 + m.getUTCMinutes() + 60 <= 12 * 60; }), 'a 60-minute call ends by 12:00');
});

test('booking from the page: required answers, chosen length, seller outcomes', async () => {
  const page = (await api(`/meet/${handle}/strategy-call?d=60`)).data;
  const body = { start: page.slots[0], duration: 60, name: 'Ravi K', email: 'ravi@example.in', phone: '9876500000' };
  const miss = await api(`/meet/${handle}/strategy-call/book`, 'POST', body);
  assert.equal(miss.status, 400);
  assert.match(miss.data.error, /What do you want help with/);
  assert.equal((await api(`/meet/${handle}/strategy-call/book`, 'POST', { ...body, answers: { goal: 'Grow', size: 'lots' } })).status, 400, 'select must be one of the options');
  const r = await api(`/meet/${handle}/strategy-call/book`, 'POST', { ...body, answers: { goal: 'Grow my funnels', size: '6-20' } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.end - r.data.start, 60 * MIN);
  assert.match(r.data.manage, /^https:\/\/app\.example\.in\/booking\//);
  assert.equal((await api(`/meet/${handle}/strategy-call/book`, 'POST', { ...body, answers: { goal: 'again' } })).status, 409, 'no double booking');

  const list = (await api('/bookings', 'GET', null, T)).data;
  const b = list.find((x) => x.email === 'ravi@example.in');
  assert.equal(b.minutes, 60);
  assert.deepEqual(b.answers, { 'What do you want help with?': 'Grow my funnels', 'Team size': '6-20' });
  assert.equal(b.source, 'booking page');
  assert.equal((await api(`/bookings/${b.id}`, 'PUT', { outcome: 'no_show' }, T)).data.outcome, 'no_show');
  assert.equal((await api(`/bookings/${b.id}`, 'PUT', { outcome: 'bogus' }, T)).status, 400);

  // rescheduling keeps the length and the answers
  const [id, q] = r.data.manage.split('/booking/')[1].split('?');
  const t = new URLSearchParams(q).get('t');
  const m = (await api(`/booking/${id}?t=${t}`)).data;
  const moved = (await api(`/booking/${id}/reschedule`, 'POST', { t, start: m.slots[2] })).data;
  assert.equal(moved.end - moved.start, 60 * MIN);
  assert.equal(moved.answers['Team size'], '6-20');
});
