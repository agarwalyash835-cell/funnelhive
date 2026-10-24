// Booking a call from the CRM: the seller sees a calendar's free times and books a contact into one — the same
// booking as the public booking page (no double-booking, CRM timeline), scoped to the seller.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, register } from './helpers.mjs';

let srv, api, T;
before(async () => {
  srv = await startServer();
  api = srv.api;
  T = (await register(api)).token;
});
after(() => srv?.stop());

test('a seller books a contact into a free slot from the CRM; the slot is then taken; other sellers can’t', async () => {
  let cals = (await api('/calendars', 'GET', null, T)).data;
  cals = Array.isArray(cals) ? cals : cals.calendars || [];
  if (!cals.length) { await api('/calendars', 'POST', { name: 'Consultation', duration: 30 }, T); cals = (await api('/calendars', 'GET', null, T)).data; cals = Array.isArray(cals) ? cals : cals.calendars; }
  const cal = cals[0];
  await api('/contacts', 'POST', { email: 'riya@client.in', name: 'Riya Sen', phone: '9876512345' }, T);
  const s = (await api(`/calendars/${cal.id}/slots`, 'GET', null, T)).data;
  assert.ok(s.slots.length > 0, 'free times');
  const start = s.slots[0];
  assert.equal((await api('/bookings', 'POST', { calendarId: cal.id, start, name: 'Riya Sen' }, T)).status, 400, 'needs an email');
  const b = await api('/bookings', 'POST', { calendarId: cal.id, start, email: 'riya@client.in', name: 'Riya Sen', phone: '9876512345', notes: 'From the CRM' }, T);
  assert.equal(b.status, 200, JSON.stringify(b.data));
  assert.equal(b.data.status, 'confirmed');
  assert.ok(!(await api(`/calendars/${cal.id}/slots`, 'GET', null, T)).data.slots.includes(start), 'the slot is gone');
  assert.equal((await api('/bookings', 'POST', { calendarId: cal.id, start, email: 'other@client.in' }, T)).status, 409, 'no double booking');
  const list = (await api('/bookings', 'GET', null, T)).data;
  assert.ok((Array.isArray(list) ? list : list.bookings || []).some((x) => x.email === 'riya@client.in'));
  const c = (await api('/contacts/riya%40client.in', 'GET', null, T)).data;
  assert.ok(JSON.stringify(c.timeline).length > 0);
  const T2 = (await register(api)).token;
  assert.equal((await api(`/calendars/${cal.id}/slots`, 'GET', null, T2)).status, 404);
  assert.equal((await api('/bookings', 'POST', { calendarId: cal.id, start: s.slots[1], email: 'x@y.in' }, T2)).status, 404);
});
