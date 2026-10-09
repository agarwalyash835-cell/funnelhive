// Time zones beyond India: zone maths across daylight saving, a New York seller's booking slots, a London webinar,
// and "wait until 10:00" in the seller's own zone.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { zoned, localYmd, offsetAt, formatIn } from '../tz.js';
import { nextTimeOfDay } from '../automations.js';
import { startServer, register } from './helpers.mjs';

test('zone maths: daylight saving, fixed offsets, local days', () => {
  assert.equal(new Date(zoned('America/New_York', '2026-03-07', 600)).toISOString(), '2026-03-07T15:00:00.000Z');
  assert.equal(new Date(zoned('America/New_York', '2026-03-09', 600)).toISOString(), '2026-03-09T14:00:00.000Z', 'after the clocks change');
  assert.equal(new Date(zoned('Europe/London', '2026-07-01', 540)).toISOString(), '2026-07-01T08:00:00.000Z');
  assert.equal(new Date(zoned('fixed:330', '2026-10-11', 1170)).toISOString(), '2026-10-11T14:00:00.000Z');
  assert.equal(localYmd('America/Los_Angeles', Date.parse('2026-07-16T03:00:00Z')), '2026-07-15');
  assert.equal(offsetAt('Asia/Kolkata'), 330);
  assert.match(formatIn('America/New_York', Date.parse('2026-07-15T23:30:00Z')), /7:30 pm EDT/);
  // "wait until 10:00" for a seller in Dubai (UTC+4)
  const now = Date.parse('2026-10-08T05:00:00Z'); // 09:00 in Dubai
  assert.equal(new Date(nextTimeOfDay('10:00', now, 'Asia/Dubai')).toISOString(), '2026-10-08T06:00:00.000Z');
  assert.equal(new Date(nextTimeOfDay('08:00', now, 'Asia/Dubai')).toISOString(), '2026-10-09T04:00:00.000Z', 'tomorrow when it has passed');
});

let srv, api, T, v, cal;
before(async () => {
  srv = await startServer({ APP_URL: 'https://app.example.com' });
  api = srv.api;
  T = (await register(api)).token;
  assert.equal((await api('/settings', 'PUT', { timezone: 'Mars/Olympus' }, T)).status, 400);
  assert.equal((await api('/settings', 'PUT', { timezone: 'America/New_York' }, T)).data.timezone, 'America/New_York');
  v = (await api('/templates/v-founders/use', 'POST', {}, T)).data;
  await api(`/funnels/${v.id}`, 'PUT', { published: true }, T);
  cal = (await api('/calendars', 'GET', null, T)).data[0];
});
after(() => srv.stop());

test('a New York seller: booking hours are New York hours, and the page says so', async () => {
  const hours = Object.fromEntries(['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].map((d) => [d, [['09:00', '11:00']]]));
  await api(`/calendars/${cal.id}`, 'PUT', { duration: 60, buffer: 0, noticeHours: 0, daysAhead: 10, hours }, T);
  assert.equal((await api(`/calendars/${cal.id}`, 'PUT', { timezone: 'Nowhere/Land' }, T)).status, 400);
  const st = v.steps.find((s) => s.blocks.some((b) => b.type === 'booking'));
  const r = (await api(`/public/${v.slug}/slots?stepId=${st.id}&blockId=${st.blocks.find((b) => b.type === 'booking').id}`)).data;
  assert.equal(r.calendar.timezone, 'America/New_York');
  assert.ok(r.slots.length > 5);
  for (const s of r.slots) {
    const hh = new Date(s).toLocaleString('en-US', { timeZone: 'America/New_York', hour: '2-digit', hour12: false });
    assert.ok(['09', '10'].includes(hh), `slot at ${hh}:00 New York time`);
  }
});

test('a London webinar: “every Sunday 18:00” is 18:00 London time, shown with its zone', async () => {
  const w = (await api('/templates/w-ai/use', 'POST', {}, T)).data;
  await api(`/funnels/${w.id}`, 'PUT', { published: true }, T);
  await api(`/public/${w.slug}/sessions`); // creates the webinar for this page
  const web = (await api('/webinars', 'GET', null, T)).data.find((x) => x.funnelId === w.id);
  await api(`/webinars/${web.id}`, 'PUT', { timezone: 'Europe/London', schedule: { type: 'weekly', days: ['sun'], times: ['18:00'] } }, T);
  const s = (await api(`/public/${w.slug}/sessions`)).data;
  assert.equal(s.timezone, 'Europe/London');
  const d = new Date(s.sessions[0]);
  assert.equal(d.toLocaleString('en-GB', { timeZone: 'Europe/London', weekday: 'short', hour: '2-digit', minute: '2-digit' }), 'Sun 18:00');
});
