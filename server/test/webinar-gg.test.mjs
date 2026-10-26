// Webinars on webinar.gg (against a fake webinar.gg API, shaped like its docs): connecting with an API token, a room
// per session, registrants dropped straight into the room with a join token, the host's studio link, the webhook
// (session ended → attendance fetched now; recording → that session's replay), and attendance from the room.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startServer, register } from './helpers.mjs';

const MIN = 60000;
const gg = { rooms: [], tokens: [], invites: {}, n: 0 };
let fake, srv, api, T, f, w, hook;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms = 5000) { for (let t = 0; t < ms; t += 50) { const v = await fn(); if (v) return v; await wait(50); } return fn(); }
const body = (req) => new Promise((r) => { let b = ''; req.on('data', (d) => { b += d; }); req.on('end', () => r(b ? JSON.parse(b) : {})); });

before(async () => {
  fake = http.createServer(async (req, res) => {
    const j = await body(req);
    const u = new URL(req.url, 'http://x'), p = u.pathname.replace(/^\/api/, '');
    const send = (s, data, error = '') => { res.writeHead(s, { 'content-type': 'application/json' }); res.end(JSON.stringify({ success: s < 300, data: s < 300 ? data : null, error })); };
    if (req.headers.authorization === 'Bearer wg_live_free') return send(403, null, 'Premium plan required');
    if (req.headers.authorization !== 'Bearer wg_live_good') return send(401, null, 'Invalid or expired API token');
    if (p === '/v1/webinar/' && req.method === 'GET') return send(200, { webinars: [], pagination: { total: 0, page: 1, limit: 1 } });
    if (p === '/v1/webinar/' && req.method === 'POST') { const id = `room${++gg.n}`; gg.rooms.push({ id, ...j }); return send(201, { id, url: `https://webinar.gg/webinar-page/${id}`, ...j, status: 'scheduled' }); }
    if (p === '/v1/webinar/join-token') { gg.tokens.push(j); return send(200, { token: `join_${gg.tokens.length}`, expiresInSeconds: 600 }); }
    let m = p.match(/^\/v1\/webinar\/([\w-]+)\/invite$/);
    if (m) { const all = gg.invites[m[1]] || []; const page = Number(u.searchParams.get('page')); return send(200, { users: all.slice(page * 20, page * 20 + 20), pagination: { total: all.length, page, limit: 20 } }); }
    if ((m = p.match(/^\/webinar\/([\w-]+)\/metrics$/))) return gg.invites[m[1]] ? send(200, { totalUsers: 42, maxLiveUsers: 28, durationMinutes: 61 }) : send(409, null, 'Analytics unavailable');
    if ((m = p.match(/^\/v1\/webinar\/([\w-]+)$/))) return gg.rooms.some((r) => r.id === m[1]) ? send(200, { id: m[1] }) : send(404, null, 'Webinar not found');
    send(404, null, 'not found');
  });
  await new Promise((r) => fake.listen(0, '127.0.0.1', r));
  process.env.WEBINARGG_API_URL = `http://127.0.0.1:${fake.address().port}/api`;
  srv = await startServer({ APP_URL: 'https://app.example.in', WEBINARGG_API_URL: process.env.WEBINARGG_API_URL });
  api = srv.api;
  T = (await register(api)).token;
  f = (await api('/templates/w-ai/use', 'POST', {}, T)).data;
  await api(`/funnels/${f.id}`, 'PUT', { published: true }, T);
  await api(`/public/${f.slug}/sessions`);
  w = (await api('/webinars', 'GET', null, T)).data.find((x) => x.funnelId === f.id);
});
after(async () => { await srv.stop(); fake.close(); });

test('webinar.gg: a bad token or a free plan is refused; a good token connects and gives the webhook link to paste back', async () => {
  assert.match((await api('/webinargg', 'PUT', { token: 'nope' }, T)).data.error, /didn’t accept/);
  assert.match((await api('/webinargg', 'PUT', { token: 'wg_live_free' }, T)).data.error, /premium/);
  const r = await api('/webinargg', 'PUT', { token: 'wg_live_good', email: 'Host@Biz.in' }, T);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.webinargg.email, 'host@biz.in');
  assert.match(r.data.hook, /^https:\/\/app\.example\.in\/api\/webinargg\/hook\/\w+\?t=/);
  assert.ok(!JSON.stringify(r.data).includes('wg_live_good'));
  hook = new URL(r.data.hook);
});

let seat, start;
test('a room per session; Join drops the registrant straight in with a join token; the host gets the studio', async () => {
  const at = new Date(Date.now() + 10 * MIN + 330 * MIN).toISOString().slice(0, 16); // in 10 minutes, India time
  assert.equal((await api(`/webinars/${w.id}`, 'PUT', { provider: 'webinargg', wggRecord: true, schedule: { type: 'once', dates: [at] } }, T)).status, 200);
  seat = (await api(`/public/${f.slug}/lead`, 'POST', { stepId: f.steps[0].id, email: 'neha@example.in', name: 'Neha Iyer', phone: '+919876543210' })).data.webinar;
  start = seat.start;
  await api(`/public/${f.slug}/lead`, 'POST', { stepId: f.steps[0].id, email: 'ravi@example.in', name: 'Ravi' });
  await waitFor(() => gg.rooms.length);
  await wait(100);
  assert.equal(gg.rooms.length, 1, 'one room for the session');
  const room = gg.rooms[0];
  const [h, mi] = at.slice(11).split(':').map(Number);
  assert.deepEqual([room.title, room.date, room.time, room.meridiem, room.timezone, room.durationMinutes, room.authentication, room.recordingEnabled],
    [w.name, at.slice(0, 10), `${String(h % 12 || 12).padStart(2, '0')}:${String(mi).padStart(2, '0')}`, h < 12 ? 'AM' : 'PM', 'Asia/Kolkata', 90, false, true]);
  const [id, q] = seat.join.split('/webinar/')[1].split('?');
  const j = (await api(`/webinar-reg/${id}/join`, 'POST', { t: new URLSearchParams(q).get('t') })).data;
  assert.equal(j.url, 'https://webinar.gg/webinar-page/room1?token=join_1');
  assert.deepEqual(gg.tokens[0], { webinarId: 'room1', firstName: 'Neha', lastName: 'Iyer', email: 'neha@example.in', phone: '+919876543210', passcode: '' });
  const host = (await api(`/webinars/${w.id}/host`, 'POST', {}, T)).data;
  assert.equal(host.url, 'https://webinar.gg/webinar-page/room1?token=join_2');
  assert.equal(gg.tokens[1].email, 'host@biz.in');
});

test('the webhook: signed link only; "ended" fetches attendance right away; a recording becomes that session’s replay', async () => {
  const post = (path, b) => fetch(`${srv.base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });
  assert.equal((await post(`${hook.pathname}?t=wrong`, {})).status, 404);
  assert.equal((await post(`${hook.pathname}${hook.search}`, { event: 'webinar.ended', data: { webinarId: 'room1' } })).status, 200);
  assert.equal((await post(`${hook.pathname}${hook.search}`, { event: 'webinar.recording.created', data: { webinarId: 'room1', mp4Url: 'https://cdn.webinar.gg/rec/room1.mp4' } })).status, 200);
  // a room that isn't ours is ignored
  await post(`${hook.pathname}${hook.search}`, { event: 'webinar.recording.created', data: { webinarId: 'room999', mp4Url: 'https://evil.example/x.mp4' } });
  const s = await waitFor(async () => { const x = (await api('/webinars', 'GET', null, T)).data.find((y) => y.id === w.id)?.wgg?.sessions?.[start]; return x?.recording && x; });
  assert.equal(s.recording, 'https://cdn.webinar.gg/rec/room1.mp4');
  assert.ok(s.ended > 0);
});

test('after the session: the room’s attendee list marks who came; the totals are kept with the session', async () => {
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ff-wgg-'));
  const { T: DB } = await import('../db.js');
  const { initMessaging, encrypt } = await import('../messaging.js');
  initMessaging('test-secret');
  const W = await import('../webinars.js');
  const now = Date.now(), at = now - 2 * 3600000;
  const u = DB.users.insert({ email: 'h@x.in', name: 'H', webinargg: { tokenEnc: encrypt('wg_live_good'), email: 'h@x.in' } });
  const web = DB.webinars.insert({ userId: u.id, funnelId: 'f', name: 'Live', duration: 60, provider: 'webinargg', schedule: { type: 'once', dates: [] }, wgg: { sessions: { [at]: { id: 'roomX', url: 'https://webinar.gg/webinar-page/roomX' } } } });
  const mk = (email) => DB.registrations.insert({ userId: u.id, webinarId: web.id, funnelId: 'f', email, session: at, status: 'registered', sent: {}, at: now - 86400000 });
  const regs = Array.from({ length: 23 }, (_, i) => mk(`p${i}@x.in`));
  // 23 registrants on two pages: 21 attended, one didn't, one hasn't been decided, and the host
  gg.invites.roomX = [...regs.map((r, i) => ({ email: r.email.toUpperCase(), firstName: 'P', lastName: String(i), isHost: false, attended: i < 21 ? true : i === 21 ? false : null })), { email: 'h@x.in', isHost: true, attended: true }];
  await W.zoomJob(now);
  const got = regs.map((r) => DB.registrations.get(r.id).attended === true);
  assert.equal(got.filter(Boolean).length, 21);
  assert.equal(got[21], false);
  const rep = DB.webinars.get(web.id).wgg.sessions[at].report;
  assert.deepEqual([rep.matched, rep.walkIns, rep.metrics.totalUsers, rep.metrics.peak], [21, 0, 42, 28]);
  assert.equal(W.webinarAnalytics(DB.webinars.get(web.id)).totals.showUp, 91);
});
