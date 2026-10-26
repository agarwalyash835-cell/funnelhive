// Webinars on Zoom (against a fake Zoom): connecting with Server-to-Server OAuth keys, a Zoom webinar per session,
// a personal Zoom link per registrant, the host's start link, attendance and watch time from Zoom's report;
// attendance from other platforms (CSV, webhook); analytics — show-up, watch time, stayed, replays, sales.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startServer, register } from './helpers.mjs';

const MIN = 60000;
const zoom = { webinars: [], registrants: [], participants: {}, n: 0 };
let fake, srv, api, T, f, w;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms = 5000) { for (let t = 0; t < ms; t += 50) { const v = await fn(); if (v) return v; await wait(50); } return fn(); }
const body = (req) => new Promise((r) => { let b = ''; req.on('data', (d) => { b += d; }); req.on('end', () => r(b ? JSON.parse(b) : {})); });

before(async () => {
  fake = http.createServer(async (req, res) => {
    const j = await body(req);
    const u = new URL(req.url, 'http://x'), send = (s, o) => { res.writeHead(s, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
    if (u.pathname === '/oauth/token') {
      const ok = req.headers.authorization === `Basic ${Buffer.from('cid:secret').toString('base64')}` && u.searchParams.get('account_id') === 'acc1';
      return ok ? send(200, { access_token: 'ztok', expires_in: 3600 }) : send(400, { reason: 'Invalid client_id or client_secret' });
    }
    if (req.headers.authorization !== 'Bearer ztok') return send(401, { code: 124, message: 'Invalid access token' });
    const p = u.pathname.replace(/^\/v2/, '');
    if (p === '/users/me' && req.method === 'GET') return send(200, { email: 'host@zoom.in', first_name: 'Asha', last_name: 'Rao' });
    if (p === '/users/me/webinars' && req.method === 'GET') return send(200, { webinars: [] });
    if (p === '/users/me/webinars' && req.method === 'POST') { const id = 9000 + ++zoom.n; zoom.webinars.push({ id, ...j }); return send(201, { id, join_url: `https://zoom.us/w/${id}`, start_url: 'old' }); }
    let m = p.match(/^\/webinars\/(\d+)\/registrants$/);
    if (m) { zoom.registrants.push({ webinar: m[1], ...j }); return send(201, { registrant_id: 'r1', join_url: `https://zoom.us/w/${m[1]}?tk=${encodeURIComponent(j.email)}` }); }
    if ((m = p.match(/^\/webinars\/(\d+)$/))) return send(200, { id: m[1], start_url: `https://zoom.us/s/${m[1]}?zak=fresh` });
    if ((m = p.match(/^\/report\/webinars\/(\d+)\/participants$/))) return zoom.participants[m[1]] ? send(200, { participants: zoom.participants[m[1]] }) : send(404, { code: 3001, message: 'Webinar does not exist' });
    send(404, { message: 'not found' });
  });
  await new Promise((r) => fake.listen(0, '127.0.0.1', r));
  process.env.ZOOM_API_URL = `http://127.0.0.1:${fake.address().port}/v2`;
  process.env.ZOOM_OAUTH_URL = `http://127.0.0.1:${fake.address().port}/oauth/token`;
  srv = await startServer({ APP_URL: 'https://app.example.in', ZOOM_API_URL: process.env.ZOOM_API_URL, ZOOM_OAUTH_URL: process.env.ZOOM_OAUTH_URL });
  api = srv.api;
  T = (await register(api)).token;
  f = (await api('/templates/w-ai/use', 'POST', {}, T)).data;
  await api(`/funnels/${f.id}`, 'PUT', { published: true }, T);
  await api(`/public/${f.slug}/sessions`);
  w = (await api('/webinars', 'GET', null, T)).data.find((x) => x.funnelId === f.id);
});
after(async () => { await srv.stop(); fake.close(); });

test('Zoom: wrong keys are refused; right keys connect (and the Webinars add-on is noticed)', async () => {
  assert.equal((await api('/zoom', 'GET', null, T)).data.zoom, null);
  const bad = await api('/zoom', 'PUT', { accountId: 'acc1', clientId: 'cid', clientSecret: 'nope' }, T);
  assert.equal(bad.status, 400);
  assert.match(bad.data.error, /didn’t accept/);
  const ok = await api('/zoom', 'PUT', { accountId: 'acc1', clientId: 'cid', clientSecret: 'secret' }, T);
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  assert.deepEqual([ok.data.zoom.email, ok.data.zoom.webinars], ['host@zoom.in', true]);
  assert.ok(!JSON.stringify(ok.data).includes('secret'), 'the secret never comes back');
});

let seat;
test('a session on Zoom: one Zoom webinar per session, a personal Zoom link per registrant, the host’s start link', async () => {
  const at = new Date(Date.now() + 10 * MIN + 330 * MIN).toISOString().slice(0, 16); // in 10 minutes, India time
  assert.equal((await api(`/webinars/${w.id}`, 'PUT', { provider: 'zoom', zoomKind: 'webinar', schedule: { type: 'once', dates: [at] } }, T)).status, 200);
  const step = f.steps[0];
  seat = (await api(`/public/${f.slug}/lead`, 'POST', { stepId: step.id, email: 'Neha@Example.in', name: 'Neha Iyer' })).data.webinar;
  await api(`/public/${f.slug}/lead`, 'POST', { stepId: step.id, email: 'ravi@example.in', name: 'Ravi K' });
  await waitFor(() => zoom.registrants.length === 2);
  assert.equal(zoom.webinars.length, 1, 'two registrants, one Zoom webinar');
  assert.equal(zoom.webinars[0].type, 5);
  assert.equal(zoom.webinars[0].duration, 90);
  assert.equal(zoom.webinars[0].settings.approval_type, 0);
  assert.equal(Date.parse(zoom.webinars[0].start_time), seat.start);
  assert.deepEqual(zoom.registrants.map((r) => [r.email, r.first_name, r.last_name]).sort(), [['neha@example.in', 'Neha', 'Iyer'], ['ravi@example.in', 'Ravi', 'K']]);
  // the room is open (10 minutes before): Join goes to their own Zoom link and marks them attended
  const [id, q] = seat.join.split('/webinar/')[1].split('?');
  const t = new URLSearchParams(q).get('t');
  const j = (await api(`/webinar-reg/${id}/join`, 'POST', { t })).data;
  assert.equal(j.url, `https://zoom.us/w/${zoom.webinars[0].id}?tk=neha%40example.in`);
  const host = (await api(`/webinars/${w.id}/host`, 'POST', {}, T)).data;
  assert.equal(host.url, `https://zoom.us/s/${zoom.webinars[0].id}?zak=fresh`);
});

test('attendance from any platform: a CSV list and a webhook (webinar.gg, Meet, Zapier…) — matched by email', async () => {
  const regs = (await api(`/webinars/${w.id}/registrations`, 'GET', null, T)).data;
  const r = await api(`/webinars/${w.id}/attendance`, 'POST', { session: seat.start, rows: [{ email: 'RAVI@example.in', minutes: 61 }, { email: 'walkin@x.in', minutes: 5 }, { email: 'not an email' }] }, T);
  assert.deepEqual(r.data, { matched: 1, walkIns: 1, people: 2 });
  assert.equal((await api(`/webinars/${w.id}/attendance`, 'POST', { session: 123, rows: [{ email: 'a@b.in' }] }, T)).status, 400);
  const a = (await api(`/webinars/${w.id}/analytics`, 'GET', null, T)).data;
  assert.match(a.hook, /^https:\/\/app\.example\.in\/api\/webinar-hook\/\w+\?t=/);
  const hookPath = new URL(a.hook);
  const h = await (await fetch(`${srv.base}${hookPath.pathname}${hookPath.search}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'neha@example.in', seconds: 1800 }) })).json();
  assert.equal(h.matched, 1);
  assert.equal((await fetch(`${srv.base}${hookPath.pathname}?t=wrong`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status, 404);
  const after2 = (await api(`/webinars/${w.id}/registrations`, 'GET', null, T)).data;
  assert.deepEqual(after2.map((x) => [x.email, x.attended, x.watchMinutes]).sort(), [['neha@example.in', true, 30], ['ravi@example.in', true, 61]]);
  assert.equal(regs.length, 2);
});

test('after a Zoom session: Zoom’s report fills in who came and for how long; analytics adds up show-up, watch time, replays and sales', async () => {
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ff-zoom-'));
  const { T: DB } = await import('../db.js');
  const { initMessaging, encrypt } = await import('../messaging.js');
  initMessaging('test-secret');
  const W = await import('../webinars.js');
  const now = Date.now(), start = now - 2 * 3600000;
  const u = DB.users.insert({ email: 'z@x.in', name: 'Z', zoom: { accountId: 'acc1', clientId: 'cid', clientSecretEnc: encrypt('secret'), webinars: true } });
  const web = DB.webinars.insert({ userId: u.id, funnelId: 'f', name: 'Masterclass', duration: 60, provider: 'zoom', schedule: { type: 'once', dates: [] }, zoom: { sessions: { [start]: { id: '777', kind: 'webinar' } } } });
  const mk = (email, extra = {}) => DB.registrations.insert({ userId: u.id, webinarId: web.id, funnelId: 'f', email, session: start, status: 'registered', sent: {}, at: now - 86400000, ...extra });
  const a = mk('a@x.in'), b = mk('b@x.in'), c = mk('c@x.in', { replayAt: now });
  mk('d@x.in');
  // Zoom's report isn't ready yet: tried again later, nothing marked
  await W.zoomJob(now);
  assert.ok(!DB.registrations.get(a.id).attended);
  zoom.participants['777'] = [
    { name: 'A', user_email: 'A@x.in', join_time: new Date(start + 60000).toISOString(), duration: 1500 },
    { name: 'A', user_email: 'a@x.in', join_time: new Date(start + 40 * 60000).toISOString(), duration: 900 }, // rejoined
    { name: 'B', user_email: 'b@x.in', join_time: new Date(start + 50 * 60000).toISOString(), duration: 300 },
    { name: 'Guest', user_email: '', join_time: new Date(start).toISOString(), duration: 600 },
  ];
  await W.zoomJob(now + 10 * MIN); // too soon after the failed try
  assert.ok(!DB.registrations.get(a.id).attended);
  await W.zoomJob(now + 20 * MIN);
  assert.deepEqual([DB.registrations.get(a.id).attended, DB.registrations.get(a.id).watchSeconds, DB.registrations.get(a.id).joinedAt], [true, 2400, start + 60000]);
  assert.equal(DB.registrations.get(b.id).watchSeconds, 300);
  assert.equal(DB.webinars.get(web.id).zoom.sessions[start].report.walkIns, 1);
  // a sale to A after the session counts; one before it doesn't
  DB.orders.insert({ userId: u.id, funnelId: 'f', email: 'a@x.in', total: 4999, status: 'paid', provider: 'razorpay', items: [], at: start + 3 * 3600000 });
  DB.orders.insert({ userId: u.id, funnelId: 'f', email: 'b@x.in', total: 999, status: 'paid', provider: 'razorpay', items: [], at: start - 86400000 });
  const t = W.webinarAnalytics(DB.webinars.get(web.id)).totals;
  assert.deepEqual([t.registered, t.attended, t.showUp, t.avgMinutes, t.stayed, t.replays, t.buyers, t.revenue], [4, 2, 50, 23, 1, 1, 1, 4999]);
  assert.equal(c.replayAt, now);
});
