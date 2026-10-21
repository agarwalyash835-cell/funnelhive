// Booking calendars: availability → slots → booking from an application funnel → manage link, reminders.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startServer, register } from './helpers.mjs';

let srv, api, T, v, cal, hooks = [], sink;
const HOUR = 3600000, DAY = 86400000;
before(async () => {
  sink = http.createServer((req, res) => { let b = ''; req.on('data', (c) => { b += c; }); req.on('end', () => { hooks.push(JSON.parse(b)); res.end('ok'); }); }).listen(0);
  srv = await startServer({ APP_URL: 'https://app.example.in' });
  api = srv.api;
  T = (await register(api)).token;
  await api('/settings', 'PUT', { webhookUrl: `http://127.0.0.1:${sink.address().port}/h` }, T);
  v = (await api('/templates/v-founders/use', 'POST', {}, T)).data;
  await api(`/funnels/${v.id}`, 'PUT', { published: true }, T);
});
after(async () => { await srv.stop(); sink.close(); });

const bookStep = () => v.steps.find((s) => s.blocks.some((b) => b.type === 'booking'));
const blockId = () => bookStep().blocks.find((b) => b.type === 'booking').id;
const slots = async () => (await api(`/public/${v.slug}/slots?stepId=${bookStep().id}&blockId=${blockId()}`)).data;

test('every seller gets a default calendar; hours, notice and days off shape the slots', async () => {
  const list = (await api('/calendars', 'GET', null, T)).data;
  assert.equal(list.length, 1);
  cal = list[0];
  // every day 09:00–13:00 IST, 60-minute calls, no gap, no notice
  const hours = Object.fromEntries(['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].map((d) => [d, [['09:00', '13:00']]]));
  const tomorrow = new Date(Date.now() + 330 * 60000 + DAY).toISOString().slice(0, 10);
  cal = (await api(`/calendars/${cal.id}`, 'PUT', { duration: 60, buffer: 0, noticeHours: 0, daysAhead: 7, hours, blocked: [tomorrow], meetingLink: 'https://meet.google.com/abc-defg-hij', reminders: { day: true, hour: true } }, T)).data;
  const s = await slots();
  assert.equal(s.calendar.duration, 60);
  assert.ok(s.slots.length >= 20 && s.slots.length <= 32, `4 a day for ~7 days (got ${s.slots.length})`);
  assert.ok(s.slots.every((t) => t > Date.now()));
  assert.ok(s.slots.every((t) => { const h = new Date(t + 330 * 60000).getUTCHours(); return h >= 9 && h < 13; }), 'all within 09:00–13:00 IST');
  assert.ok(!s.slots.some((t) => new Date(t + 330 * 60000).toISOString().slice(0, 10) === tomorrow), 'blocked day has no slots');
  assert.equal((await api(`/calendars/${cal.id}`, 'PUT', { hours: { mon: [['18:00', '09:00']] } }, T)).data.hours.mon.length, 0, 'an end before the start is dropped');
  await api(`/calendars/${cal.id}`, 'PUT', { hours }, T);
});

let booking;
test('only applicants who qualified can book; a slot can’t be booked twice', async () => {
  const s = (await slots()).slots;
  const apply = v.steps[1];
  const form = apply.blocks.find((b) => b.type === 'form');
  const body = { stepId: bookStep().id, blockId: blockId(), start: s[0], name: 'Priya Nair', email: 'priya@example.in', phone: '9876543210', notes: 'Doing ₹12L/month' };
  assert.equal((await api(`/public/${v.slug}/book`, 'POST', body)).status, 403, 'no application yet');
  // a qualified application
  const fields = Object.fromEntries(form.props.fields.map((f) => [f.label, f.type === 'select' ? f.options.split(', ').find((o) => !(f.reject || '').split(', ').includes(o)) : f.type === 'email' ? 'priya@example.in' : 'Priya']));
  assert.equal((await api(`/public/${v.slug}/lead`, 'POST', { stepId: apply.id, email: 'priya@example.in', name: 'Priya Nair', fields })).data.qualified, true);
  const r = await api(`/public/${v.slug}/book`, 'POST', body);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.match(r.data.manage, /^https:\/\/app\.example\.in\/booking\/\w+\?t=/);
  assert.equal(r.data.meetingLink, 'https://meet.google.com/abc-defg-hij');
  booking = r.data;
  assert.ok(!(await slots()).slots.includes(s[0]), 'the slot is gone');
  // someone else (qualified) tries the same slot
  await api(`/public/${v.slug}/lead`, 'POST', { stepId: apply.id, email: 'other@example.in', fields });
  assert.equal((await api(`/public/${v.slug}/book`, 'POST', { ...body, email: 'other@example.in' })).status, 409);
  assert.equal((await api(`/public/${v.slug}/book`, 'POST', { ...body, start: s[0] + 7 * 60000, email: 'other@example.in' })).status, 409, 'a time that isn’t a slot is refused');
  const list = (await api('/bookings', 'GET', null, T)).data;
  assert.equal(list.length, 1);
  assert.equal(list[0].funnel, v.name);
  await new Promise((res) => setTimeout(res, 300));
  assert.ok(hooks.some((h) => h.event === 'booking.created' && h.data.booking.email === 'priya@example.in'));
});

test('the buyer’s link: view, calendar file, reschedule, cancel — and nobody else’s', async () => {
  const [id, query] = booking.manage.split('/booking/')[1].split('?');
  const t = new URLSearchParams(query).get('t');
  const b = (await api(`/booking/${id}?t=${t}`)).data;
  assert.equal(b.status, 'confirmed');
  assert.ok(b.slots.length > 0 && b.canChange);
  assert.ok(b.slots.includes(b.start), 'the booking being moved doesn’t block the times around it (even its own)');
  assert.equal((await api(`/booking/${id}?t=wrongwrongwrongwrongwron`)).status, 404);
  const ics = await fetch(`${srv.base}/api/booking/${id}/ics?t=${t}`);
  assert.match(ics.headers.get('content-type'), /text\/calendar/);
  assert.match(await ics.text(), /BEGIN:VEVENT[\s\S]*URL:https:\/\/meet\.google\.com/);
  const moved = (await api(`/booking/${id}/reschedule`, 'POST', { t, start: b.slots[3] })).data;
  assert.equal(moved.start, b.slots[3]);
  assert.equal((await api(`/booking/${id}?t=${t}`)).data.status, 'rescheduled');
  const [id2, q2] = moved.manage.split('/booking/')[1].split('?');
  const t2 = new URLSearchParams(q2).get('t');
  assert.equal((await api(`/booking/${id2}/cancel`, 'POST', { t: t2 })).data.status, 'cancelled');
  assert.ok((await slots()).slots.includes(b.slots[3]), 'a cancelled slot opens up again');
  await new Promise((res) => setTimeout(res, 300));
  assert.ok(hooks.some((h) => h.event === 'booking.rescheduled') && hooks.some((h) => h.event === 'booking.cancelled'));
  const other = (await register(api)).token;
  assert.equal((await api(`/bookings/${id2}/cancel`, 'POST', {}, other)).status, 404);
});

test('reminders go out once, a day and an hour before', async () => {
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ff-bk-'));
  const { T: DB } = await import('../db.js');
  const B = await import('../bookings.js');
  const c = DB.calendars.insert({ userId: 'u', name: 'Call', duration: 30, buffer: 0, noticeHours: 0, daysAhead: 7, hours: {}, blocked: [], tzOffset: 330, reminders: { day: true, hour: true }, at: 1 });
  const now = Date.now();
  const soon = DB.bookings.insert({ userId: 'u', calendarId: c.id, email: 'a@x.in', start: now + 50 * 60000, end: now + 80 * 60000, status: 'confirmed', reminded: {}, at: now });
  const tomorrow = DB.bookings.insert({ userId: 'u', calendarId: c.id, email: 'b@x.in', start: now + 23 * HOUR, end: now + 23.5 * HOUR, status: 'confirmed', reminded: {}, at: now });
  B.reminderJob(now);
  B.reminderJob(now + 1000);
  assert.ok(DB.bookings.get(soon.id).reminded.hour && !DB.bookings.get(soon.id).reminded.day);
  assert.ok(DB.bookings.get(tomorrow.id).reminded.day && !DB.bookings.get(tomorrow.id).reminded.hour);
});
