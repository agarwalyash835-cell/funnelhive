// Webinars: the registration page's sessions, seats, personal joining links, attendance, reminders and replays.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startServer, register } from './helpers.mjs';

let srv, api, T, f, w;
const MIN = 60000, HOUR = 3600000;
const ist = (t) => new Date(t + 330 * MIN);
before(async () => {
  srv = await startServer({ APP_URL: 'https://app.example.in' });
  api = srv.api;
  T = (await register(api)).token;
  f = (await api('/templates/w-ai/use', 'POST', {}, T)).data;
  await api(`/funnels/${f.id}`, 'PUT', { published: true }, T);
});
after(() => srv.stop());

const reg = () => f.steps[0];
test('the schedule is read from the registration page (“This Sunday · 11:00 AM IST”)', async () => {
  const s = (await api(`/public/${f.slug}/sessions`)).data;
  assert.ok(s.sessions.length >= 1);
  const d = ist(s.sessions[0]);
  assert.equal(d.getUTCDay(), 0, 'a Sunday');
  assert.equal(`${d.getUTCHours()}:${d.getUTCMinutes()}`, '11:0');
  assert.ok(s.sessions[0] > Date.now() - 15 * MIN);
  w = (await api('/webinars', 'GET', null, T)).data.find((x) => x.funnelId === f.id);
  assert.equal(w.duration, 90);
});

let seat;
test('signing up takes a seat with a personal joining link; signing up again keeps the same seat', async () => {
  const r = (await api(`/public/${f.slug}/lead`, 'POST', { stepId: reg().id, email: 'Neha@Example.in', name: 'Neha Iyer', phone: '9876543210' })).data;
  assert.ok(r.webinar, JSON.stringify(r));
  assert.match(r.webinar.join, /^https:\/\/app\.example\.in\/webinar\/\w+\?t=/);
  seat = r.webinar;
  const again = (await api(`/public/${f.slug}/lead`, 'POST', { stepId: reg().id, email: 'neha@example.in' })).data;
  assert.equal(again.webinar.join, seat.join);
  const regs = (await api(`/webinars/${w.id}/registrations`, 'GET', null, T)).data;
  assert.equal(regs.length, 1);
  const [id, q] = seat.join.split('/webinar/')[1].split('?');
  const t = new URLSearchParams(q).get('t');
  const page = (await api(`/webinar-reg/${id}?t=${t}`)).data;
  assert.equal(page.state, 'soon');
  assert.equal((await api(`/webinar-reg/${id}/join`, 'POST', { t })).status, 400, 'the room isn’t open yet');
  assert.equal((await api(`/webinar-reg/${id}?t=wrong`)).status, 404);
  assert.match(await (await fetch(`${srv.base}/api/webinar-reg/${id}/ics?t=${t}`)).text(), /BEGIN:VEVENT/);
});

test('several daily sessions: the visitor picks one; a schedule without upcoming sessions is refused', async () => {
  const past = ist(Date.now() - 2 * 86400000).toISOString().slice(0, 16);
  assert.equal((await api(`/webinars/${w.id}`, 'PUT', { schedule: { type: 'once', dates: [past] } }, T)).status, 400);
  await api(`/webinars/${w.id}`, 'PUT', { schedule: { type: 'daily', times: ['10:00', '19:00'], show: 3 } }, T);
  const s = (await api(`/public/${f.slug}/sessions`)).data.sessions;
  assert.equal(s.length, 3);
  const r = (await api(`/public/${f.slug}/lead`, 'POST', { stepId: reg().id, email: 'pick@example.in', session: s[2] })).data;
  assert.equal(r.webinar.start, s[2]);
  const bad = (await api(`/public/${f.slug}/lead`, 'POST', { stepId: reg().id, email: 'bad@example.in', session: 12345 })).data;
  assert.equal(bad.webinar.start, s[0], 'an unknown session falls back to the next one');
});

test('a live session: joining opens the host’s room and records attendance', async () => {
  const startedLocal = ist(Date.now() - 5 * MIN).toISOString().slice(0, 16);
  await api(`/webinars/${w.id}`, 'PUT', { schedule: { type: 'once', dates: [startedLocal] }, joinUrl: 'https://zoom.us/j/123456' }, T);
  const r = (await api(`/public/${f.slug}/lead`, 'POST', { stepId: reg().id, email: 'live@example.in' })).data;
  const [id, q] = r.webinar.join.split('/webinar/')[1].split('?');
  const t = new URLSearchParams(q).get('t');
  assert.equal((await api(`/webinar-reg/${id}?t=${t}`)).data.state, 'live');
  assert.equal((await api(`/webinar-reg/${id}/join`, 'POST', { t })).data.url, 'https://zoom.us/j/123456');
  const regs = (await api(`/webinars/${w.id}/registrations`, 'GET', null, T)).data;
  assert.equal(regs.find((x) => x.email === 'live@example.in').attended, true);
});

test('preview sign-ups never take a seat', async () => {
  const { previewKey } = (await api(`/funnels/${f.id}`, 'GET', null, T)).data;
  const before = (await api(`/webinars/${w.id}/registrations`, 'GET', null, T)).data.length;
  const r = (await api(`/public/${f.slug}/lead?preview=1&pv=${previewKey}`, 'POST', { stepId: reg().id, email: 'pv@example.in' })).data;
  assert.equal(r.webinar.preview, true);
  assert.equal((await api(`/webinars/${w.id}/registrations`, 'GET', null, T)).data.length, before);
});

test('reminders, then the replay and attended / missed follow-ups — each once', async () => {
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ff-wb-'));
  const { T: DB } = await import('../db.js');
  const W = await import('../webinars.js');
  const web = DB.webinars.insert({ userId: 'u', funnelId: 'f', name: 'Masterclass', duration: 60, tzOffset: 330, schedule: { type: 'daily', times: ['10:00'] }, emails: { day: true, hour: true, live: true, replay: true }, replayHours: 48, replayUrl: 'https://youtu.be/x', at: 1 });
  const now = Date.now();
  const mk = (email, session, extra = {}) => DB.registrations.insert({ userId: 'u', webinarId: web.id, funnelId: 'f', email, session, status: 'registered', sent: {}, base: 'https://x.in', at: now, ...extra });
  const tomorrow = mk('a@x.in', now + 20 * HOUR), soon = mk('b@x.in', now + 40 * MIN), live = mk('c@x.in', now + MIN);
  const went = mk('d@x.in', now - 80 * MIN, { attended: true }), missed = mk('e@x.in', now - 80 * MIN);
  W.webinarJob(now); W.webinarJob(now + 1000);
  const g = (r) => DB.registrations.get(r.id);
  assert.ok(g(tomorrow).sent.day && !g(tomorrow).sent.hour);
  assert.ok(g(soon).sent.hour && !g(soon).sent.live);
  assert.ok(g(live).sent.live);
  assert.equal(g(went).status, 'attended');
  assert.equal(g(missed).status, 'missed');
  assert.ok(g(missed).sent.replay);
});
