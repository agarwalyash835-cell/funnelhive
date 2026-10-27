// Webinars: the schedule behind a registration page (one-off dates, weekly, or daily "evergreen" sessions), who
// registered for which session, each registrant's personal joining link (which records attendance), and the
// emails around it: confirmation, a day before, an hour before, "we're live", and the replay afterwards.
// Where it's held: any link (Google Meet, YouTube Live…), the seller's Zoom (zoom.js) — each session its own Zoom
// webinar or meeting, a personal Zoom link per registrant, watch time from Zoom's report — or the seller's webinar.gg
// (wgg.js) — each session its own room, registrants dropped straight in with a join token, attendance from the room.
// Attendance from other platforms comes in as a CSV upload or a webhook. Analytics: show-up, watch time, sales.
//
// Times are UTC milliseconds; schedules are written in the webinar's local time (India by default, UTC+5:30).
import crypto from 'node:crypto';
import { T, tx, uid, contactKey, JOBS, paidOrder } from './db.js';
import { zoomOf, zoomView, connectZoom, disconnectZoom, zoomRegistrant, zoomStartUrl, zoomReport, kindFor } from './zoom.js';
import { wggOf, wggView, connectWgg, disconnectWgg, wggSession, wggJoinUrl, wggHostUrl, wggReport, wggCall } from './wgg.js';
import { sendEmail } from './messaging.js';
import { waEvent } from './hive-wa.js';
import { enqueue as fireWebhook } from './webhooks.js';
import { fire as fireAutomation } from './automations.js';
import { linkBase } from './products.js';
import { tzOf, sellerTz, zoned, localYmd, addDays, dowOfYmd, formatIn, offsetAt, validTz } from './tz.js';
import { domainOfFunnel } from './domains.js';

const MIN = 60000, HOUR = 3600000, DAY = 86400000;
const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const LATE_JOIN = 15 * MIN; // registering up to 15 minutes into a session puts you in that session
let SECRET = '';
const sig = (s) => crypto.createHmac('sha256', SECRET).update(s).digest('base64url').slice(0, 24);
const same = (a, b) => typeof a === 'string' && typeof b === 'string' && a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
const clip = (v, n) => String(v ?? '').trim().slice(0, n);
const intIn = (v, lo, hi, d) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };

export function cleanWebinar(b = {}, cur = {}) {
  const out = { ...cur };
  if ('name' in b || !cur.id) out.name = clip(b.name, 120) || cur.name || 'Live masterclass';
  if ('duration' in b || !cur.id) out.duration = intIn(b.duration, 15, 480, cur.duration || 90);
  if ('tzOffset' in b || !cur.id) out.tzOffset = intIn(b.tzOffset, -720, 840, cur.tzOffset ?? 330);
  if ('timezone' in b && (!b.timezone || validTz(b.timezone))) out.timezone = b.timezone || undefined;
  if ('joinUrl' in b) { const l = clip(b.joinUrl, 500); out.joinUrl = /^https:\/\/[^\s"'<>]+$/i.test(l) ? l : ''; }
  if ('replayUrl' in b) { const l = clip(b.replayUrl, 500); out.replayUrl = /^https:\/\/[^\s"'<>]+$/i.test(l) ? l : ''; }
  // where it's held: a link (any platform) or the seller's Zoom; Zoom sessions are webinars (add-on) or meetings
  if ('provider' in b || !cur.id) out.provider = ['link', 'zoom', 'webinargg'].includes(b.provider) ? b.provider : cur.provider || 'link';
  if ('zoomKind' in b) out.zoomKind = b.zoomKind === 'meeting' ? 'meeting' : 'webinar';
  if ('zoomRecord' in b) out.zoomRecord = !!b.zoomRecord;
  if ('wggRecord' in b) out.wggRecord = !!b.wggRecord;
  if ('replayHours' in b || !cur.id) out.replayHours = intIn(b.replayHours, 0, 720, cur.replayHours ?? 48);
  if ('emails' in b || !cur.id) out.emails = { day: b.emails?.day ?? cur.emails?.day ?? true, hour: b.emails?.hour ?? cur.emails?.hour ?? true, live: b.emails?.live ?? cur.emails?.live ?? true, replay: b.emails?.replay ?? cur.emails?.replay ?? true };
  if ('schedule' in b || !cur.id) {
    const s = b.schedule && typeof b.schedule === 'object' ? b.schedule : cur.schedule || { type: 'weekly', days: ['sun'], times: ['11:00'] };
    const type = ['once', 'weekly', 'daily'].includes(s.type) ? s.type : 'weekly';
    out.schedule = {
      type,
      dates: type === 'once' ? (Array.isArray(s.dates) ? s.dates : []).filter((d) => /^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d$/.test(d)).slice(0, 50) : [],
      days: type === 'weekly' ? (Array.isArray(s.days) ? s.days : []).filter((d) => DAYS.includes(d)) : [],
      times: type !== 'once' ? (Array.isArray(s.times) ? s.times : []).filter((t) => HHMM.test(t)).slice(0, 6) : [],
      // daily evergreen sessions: how many upcoming ones a visitor can choose from
      show: intIn(s.show, 1, 6, 3),
    };
  }
  return out;
}

// Upcoming sessions (UTC ms), soonest first. A session counts until 15 minutes after it starts.
// a webinar's zone: its own, else its seller's (India by default)
export const webTz = (w) => tzOf(w, sellerTz(T.users.get(w.userId)));
export function upcoming(w, now = Date.now(), limit = 6) {
  const tz = webTz(w);
  const s = w.schedule || {};
  const out = [];
  if (s.type === 'once') for (const d of s.dates) { const [ymd, hm] = d.split('T'); const [h, m] = hm.split(':').map(Number); out.push(zoned(tz, ymd, h * 60 + m)); }
  else {
    // local days in the webinar's zone, so "every Sunday 11:00" stays 11:00 through daylight-saving changes
    let ymd = localYmd(tz, now);
    for (let i = 0; i < 60 && out.length < 40; i++, ymd = addDays(ymd, 1)) {
      const dow = DAYS[dowOfYmd(ymd)];
      if (s.type === 'weekly' && !s.days.includes(dow)) continue;
      for (const t of s.times) { const [h, m] = t.split(':').map(Number); out.push(zoned(tz, ymd, h * 60 + m)); }
    }
  }
  return [...new Set(out)].filter((t) => t + LATE_JOIN > now).sort((a, b) => a - b).slice(0, s.type === 'daily' ? Math.min(limit, s.show) : limit);
}

// A sensible first webinar for a registration page, read from its event hero ("This Sunday" · "7:00 PM IST" · "90 min")
export function webinarFromFunnel(f) {
  const hero = f.steps.flatMap((s) => s.blocks).find((b) => b.type === 'hero' && ['event', 'stage', 'poster'].includes(b.props?.variant))?.props || {};
  const day = DAYS.find((d) => new RegExp(`\\b${d}`, 'i').test(hero.eventDate || '')) || 'sun';
  const m = String(hero.eventTime || '').match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
  let h = m ? Number(m[1]) : 11; const min = m?.[2] ? Number(m[2]) : 0;
  if (m?.[3] && /pm/i.test(m[3]) && h < 12) h += 12;
  if (m?.[3] && /am/i.test(m[3]) && h === 12) h = 0;
  const every = /every\s*day|daily/i.test(hero.eventDate || '');
  return cleanWebinar({
    name: hero.cardTitle || f.name, duration: Number((String(hero.eventLength || '').match(/(\d+)\s*min/) || [])[1]) || 90,
    schedule: every ? { type: 'daily', times: [`${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`] } : { type: 'weekly', days: [day], times: [`${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`] },
  });
}
export function webinarFor(f, id) {
  if (id) { const w = T.webinars.get(id); if (w && w.userId === f.userId) return w; }
  return T.webinars.find({ funnelId: f.id }) || T.webinars.insert({ ...webinarFromFunnel(f), id: uid(), userId: f.userId, funnelId: f.id, at: Date.now() });
}

// ---------- registering ----------
const joinToken = (r) => sig(`wr.${r.id}`);
export const joinUrl = (base, r) => `${base}/webinar/${r.id}?t=${joinToken(r)}`;
const when = (t, tz) => formatIn(tz || 'Asia/Kolkata', t);
export function register(f, w, { email, name = '', phone = '', session, leadId = null, base = '', replayStep = null }) {
  const sessions = upcoming(w);
  if (!sessions.length) return { error: 'There are no upcoming sessions right now — please check back soon' };
  const start = sessions.includes(Number(session)) ? Number(session) : sessions[0];
  const ckey = contactKey(email, phone);
  // one seat per person per session: registering again returns the same seat
  const r = tx(() => T.registrations.all({ webinarId: w.id, ckey }).find((x) => x.session === start && x.status !== 'cancelled')
    || T.registrations.insert({ id: uid(), userId: f.userId, webinarId: w.id, funnelId: f.id, leadId, email: clip(email, 200).toLowerCase(), name: clip(name, 120), phone: clip(phone, 40), session: start, status: 'registered', sent: {}, base, replayStep, at: Date.now() }));
  if (r.at < Date.now() - 2000) return { registration: r, again: true };
  const link = joinUrl(base, r);
  fireWebhook(f.userId, 'webinar.registered', { webinar: w.name, session: new Date(start).toISOString(), email: r.email, name: r.name, phone: r.phone, join: link });
  fireAutomation(f.userId, 'webinar_registered', { email: r.email, phone: r.phone, name: r.name, funnelId: f.id, webinarTime: when(start, webTz(w)), joinLink: link });
  notify(r, w, 'confirm');
  if (w.provider === 'zoom') zoomLink(r.id).catch((e) => console.error('Zoom registrant failed', e.message));
  // webinar.gg: the session's room is made now, so joining later is instant
  const owner = T.users.get(f.userId);
  if (w.provider === 'webinargg' && wggOf(owner)) wggSession(owner, w, start, webTz(w)).catch((e) => console.error('webinar.gg room failed', e.message));
  return { registration: r };
}

function notify(r, w, kind) {
  const owner = T.users.get(r.userId);
  if (!owner) return;
  const biz = owner.settings?.businessName || owner.name;
  const link = joinUrl(r.base, r), first = String(r.name || '').split(/\s+/)[0] || 'there';
  const replay = w.replayUrl || T.webinars.get(w.id)?.wgg?.sessions?.[r.session]?.recording || (r.replayStep ? `${r.base}${r.replayStep}` : '');
  const msg = {
    confirm: [`You’re in: ${w.name} — ${when(r.session, webTz(w))}`, `Hi ${first},\n\nYour seat for ${w.name} is confirmed.\n\n📅 ${when(r.session, webTz(w))} (${w.duration} minutes)\n\nYour personal joining link (don’t share it):\n${link}\n\nAdd it to your calendar from the same link. See you there!\n\n— ${biz}`],
    day: [`Tomorrow: ${w.name}`, `Hi ${first},\n\nA reminder that ${w.name} is on ${when(r.session, webTz(w))}.\n\nYour joining link: ${link}\n\n— ${biz}`],
    hour: [`Starting in 1 hour: ${w.name}`, `Hi ${first},\n\n${w.name} starts at ${when(r.session, webTz(w))}. Grab a notebook and join a few minutes early:\n${link}\n\n— ${biz}`],
    live: [`🔴 We’re live: ${w.name}`, `Hi ${first},\n\nWe’re starting now — join here:\n${link}\n\n— ${biz}`],
    replay: replay ? [r.attended ? `The replay: ${w.name}` : `You missed it — here’s the replay of ${w.name}`, `Hi ${first},\n\n${r.attended ? 'Thanks for joining live! ' : 'We missed you live. '}Here’s the full replay${w.replayHours ? ` — it’s up for ${w.replayHours} hours` : ''}:\n${replay}\n\n— ${biz}`] : null,
  }[kind];
  if (msg && r.email) sendEmail(owner, { to: r.email, subject: msg[0], text: msg[1] }).catch((e) => console.error('webinar email failed', e.message));
  if (kind === 'day' || kind === 'hour') waEvent(owner, 'webinar_reminder', { to: r.phone, params: [w.name, when(r.session, webTz(w))], link, entityId: `${r.id}-${kind}`, ckey: contactKey(r.email, r.phone) });
}

// ---------- reminders, attendance follow-up, replays ----------
export function webinarJob(now = Date.now()) {
  // looks back far enough for the replay of the longest session (8 h) — sent up to 3 h after it ends
  for (const r of T.registrations.all({ session: { gte: now - (8 * HOUR + 3 * HOUR + 15 * MIN), lte: now + 25 * HOUR } })) {
    if (r.status === 'cancelled') continue;
    const w = T.webinars.get(r.webinarId);
    if (!w) continue;
    const left = r.session - now, end = r.session + w.duration * MIN;
    const due = left > 2 * HOUR && left <= 24 * HOUR + 2 * MIN ? 'day' : left > 5 * MIN && left <= HOUR + 2 * MIN ? 'hour' : left <= 2 * MIN && left > -10 * MIN ? 'live' : now >= end + (liveOf(T.users.get(w.userId), w) ? 45 : 15) * MIN && now < end + 3 * HOUR ? 'replay' : null;
    if (!due || r.sent?.[due]) continue;
    const claimed = tx(() => { const x = T.registrations.get(r.id); if (x.sent?.[due]) return null; x.sent = { ...x.sent, [due]: now }; if (due === 'replay') x.status = x.attended ? 'attended' : 'missed'; return T.registrations.put(x); });
    if (!claimed) continue;
    if (due === 'replay') {
      fireAutomation(r.userId, claimed.attended ? 'webinar_attended' : 'webinar_missed', { email: r.email, phone: r.phone, name: r.name, funnelId: r.funnelId, webinarTime: when(r.session, webTz(w)), joinLink: joinUrl(r.base, r) });
      fireWebhook(r.userId, claimed.attended ? 'webinar.attended' : 'webinar.missed', { webinar: w.name, session: new Date(r.session).toISOString(), email: r.email, name: r.name });
    }
    if (w.emails?.[due] !== false) notify(claimed, w, due);
  }
}
if (JOBS && process.env.NODE_ENV !== 'test') setInterval(() => { try { webinarJob(); } catch (e) { console.error('webinar job failed', e.message); } zoomJob().catch((e) => console.error('Zoom report job failed', e.message)); }, 60000).unref();

// ---------- Zoom and webinar.gg: personal links, attendance and watch time ----------
// the platform this webinar runs on, when the seller has connected it ('zoom' | 'webinargg' | null)
const liveOf = (u, w) => (w.provider === 'zoom' && zoomOf(u) ? 'zoom' : w.provider === 'webinargg' && wggOf(u) ? 'webinargg' : null);
// a registrant's own Zoom link, made once (Zoom webinars give each registrant one; meetings share one)
async function zoomLink(rid) {
  const r = T.registrations.get(rid), w = r && T.webinars.get(r.webinarId), u = w && T.users.get(w.userId);
  if (!r || !w || w.provider !== 'zoom' || !zoomOf(u)) return null;
  if (r.zoomJoin) return r.zoomJoin;
  const url = await zoomRegistrant(u, w, r);
  if (url) T.registrations.update(r.id, (x) => { x.zoomJoin = url; });
  return url;
}
// rows: [{ email, seconds, joinedAt }] for one session → registrants marked attended, with watch time; the rest are walk-ins
export function applyAttendance(w, session, rows, source) {
  const regs = T.registrations.all({ webinarId: w.id }).filter((r) => r.session === session && r.status !== 'cancelled');
  const byEmail = new Map(regs.map((r) => [r.email, r]));
  let matched = 0;
  for (const x of rows) {
    const r = x.email && byEmail.get(x.email);
    if (!r) continue;
    matched++;
    T.registrations.update(r.id, (y) => {
      y.attended = true;
      if (y.status === 'missed') y.status = 'attended';
      if (x.seconds > (y.watchSeconds || 0)) y.watchSeconds = Math.round(x.seconds);
      if (x.joinedAt && (!y.joinedAt || x.joinedAt < y.joinedAt)) y.joinedAt = x.joinedAt;
      y.attendSource = source;
    });
  }
  return { matched, walkIns: rows.length - matched, people: rows.length };
}
// after each session: the platform's report (Zoom: participants with minutes; webinar.gg: who attended, room totals).
// Reports take a few minutes: tried 20 minutes after the end, then every 15 minutes for 3 days — or right away when
// webinar.gg's webhook says the session ended.
let liveBusy = false;
export async function zoomJob(now = Date.now()) {
  if (liveBusy) return;
  liveBusy = true;
  try {
    for (const w of T.webinars.all({})) {
      const u = T.users.get(w.userId), kind = liveOf(u, w), box = kind === 'zoom' ? 'zoom' : 'wgg';
      if (!kind || !w[box]?.sessions) continue;
      for (const [start, s] of Object.entries(w[box].sessions)) {
        const end = Number(start) + w.duration * MIN;
        if (s.report || now > end + 3 * DAY || (!s.ended && now < end + 20 * MIN) || (s.tryAt && now - s.tryAt < 15 * MIN)) continue;
        T.webinars.update(w.id, (x) => { x[box].sessions[start] = { ...x[box].sessions[start], tryAt: now }; });
        let rows, extra = {};
        try {
          if (kind === 'zoom') rows = await zoomReport(u, s);
          else { const r = await wggReport(u, s); rows = r.rows; extra = r.metrics ? { metrics: r.metrics } : {}; }
        } catch (e) { if (![400, 404, 409].includes(e.status)) console.error(`${kind} report failed`, e.message); continue; }
        const got = applyAttendance(w, Number(start), rows, kind);
        const secs = rows.map((x) => x.seconds).filter((x) => x > 0);
        T.webinars.update(w.id, (x) => { x[box].sessions[start] = { ...x[box].sessions[start], report: { at: now, ...got, ...extra, avgMinutes: secs.length ? Math.round(secs.reduce((a, b) => a + b, 0) / secs.length / 60) : 0 } }; });
      }
    }
  } finally { liveBusy = false; }
}

// ---------- analytics: registered → attended → stayed → bought, per session ----------
export function webinarAnalytics(w) {
  const now = Date.now(), regs = T.registrations.all({ webinarId: w.id }).filter((r) => r.status !== 'cancelled');
  const len = w.duration * MIN;
  // a sale within 14 days of their session
  const bought = (r) => T.orders.all({ userId: w.userId, ckey: contactKey(r.email, r.phone) }).filter((o) => paidOrder(o) && !o.demo && o.at >= r.session && o.at <= r.session + 14 * DAY);
  const stat = (list) => {
    const past = list.filter((r) => r.session + len < now), came = past.filter((r) => r.attended), timed = came.filter((r) => r.watchSeconds > 0);
    const orders = list.flatMap(bought), buyers = new Set(orders.map((o) => o.email || o.id)).size;
    return {
      registered: list.length, past: past.length, attended: came.length, showUp: past.length ? Math.round((came.length / past.length) * 100) : null,
      avgMinutes: timed.length ? Math.round(timed.reduce((a, r) => a + r.watchSeconds, 0) / timed.length / 60) : null,
      stayed: timed.filter((r) => r.watchSeconds * 1000 >= len / 2).length, timed: timed.length,
      replays: past.filter((r) => !r.attended && r.replayAt).length,
      buyers, revenue: Math.round(orders.reduce((a, o) => a + (Number(o.total) || 0) * (Number(o.fx) || 1), 0)),
    };
  };
  const bySession = new Map();
  for (const r of regs) bySession.set(r.session, [...(bySession.get(r.session) || []), r]);
  // sign-ups per day, the last 30 days
  const days = Array.from({ length: 30 }, (_, i) => new Date(now - (29 - i) * DAY).toISOString().slice(0, 10));
  const perDay = Object.fromEntries(days.map((d) => [d, 0]));
  for (const r of regs) { const d = new Date(r.at).toISOString().slice(0, 10); if (d in perDay) perDay[d]++; }
  return {
    totals: stat(regs),
    sessions: [...bySession.entries()].sort((a, b) => b[0] - a[0]).slice(0, 50).map(([t, list]) => ({ session: t, ...stat(list), zoom: w.zoom?.sessions?.[t]?.report || null, wgg: w.wgg?.sessions?.[t]?.report || null })),
    signups: days.map((d) => ({ day: d, n: perDay[d] })),
  };
}

const outReg = (r) => ({ id: r.id, email: r.email, name: r.name, phone: r.phone, session: r.session, status: r.status, attended: !!r.attended, joinedAt: r.joinedAt || null, watchMinutes: r.watchSeconds ? Math.round(r.watchSeconds / 60) : null, replay: !!r.replayAt, at: r.at });
const hookToken = (w) => sig(`wh.${w.id}`);
// a list of attendees (CSV upload or webhook): emails, and minutes watched when the platform gives them
const rowsFrom = (list) => (Array.isArray(list) ? list : []).slice(0, 20000).map((x) => ({ email: clip(x?.email, 200).toLowerCase(), seconds: Number(x?.seconds) > 0 ? Number(x.seconds) : Number(x?.minutes) > 0 ? Number(x.minutes) * 60 : 0, joinedAt: Date.parse(x?.joinedAt || x?.join_time || '') || null })).filter((x) => /@/.test(x.email));

// ---------- routes ----------
export function registerWebinars(app, { auth, secret, appUrl, pub }) {
  SECRET = secret;
  // --- seller ---
  app.get('/api/webinars', auth, (req, res) => {
    const funnels = Object.fromEntries(T.funnels.all({ userId: req.user.id }).map((f) => [f.id, f]));
    // every funnel that has a webinar registration page gets its webinar (created from the page on first look)
    for (const f of Object.values(funnels)) if (f.steps.some((s) => s.blocks.some((b) => (b.type === 'optin' || b.type === 'form') && 'webinarId' in (b.props || {})))) webinarFor(f);
    res.json(T.webinars.all({ userId: req.user.id }, { order: 'at', desc: true }).map((w) => {
      const regs = T.registrations.all({ webinarId: w.id });
      const next = upcoming(w)[0] || null;
      return { timezone: webTz(w),  ...w, funnel: funnels[w.funnelId]?.name || null, next, registered: regs.length, upcomingSeats: regs.filter((r) => r.session === next && r.status !== 'cancelled').length, attended: regs.filter((r) => r.attended).length, past: regs.filter((r) => r.session + w.duration * MIN < Date.now()).length };
    }));
  });
  app.put('/api/webinars/:wid', auth, (req, res) => {
    const cur = T.webinars.get(req.params.wid);
    if (!cur || cur.userId !== req.user.id) return res.status(404).json({ error: 'Webinar not found' });
    const w = cleanWebinar(req.body, cur);
    if (!upcoming(w).length) return res.status(400).json({ error: 'This schedule has no upcoming sessions — add a future date or a weekly time' });
    res.json(T.webinars.put(w));
  });
  // the seller's Zoom: connect with a Server-to-Server OAuth app's keys
  app.get('/api/zoom', auth, (req, res) => res.json({ zoom: zoomView(req.user) }));
  app.put('/api/zoom', auth, async (req, res) => { try { res.json({ zoom: await connectZoom(req.user.id, req.body) }); } catch (e) { res.status(e.status || 502).json({ error: e.message }); } });
  app.delete('/api/zoom', auth, (req, res) => { disconnectZoom(req.user.id); res.json({ zoom: null }); });
  // the seller's webinar.gg: an API token (Settings → Integrations), and the webhook link to paste back there
  const wggHook = (req) => `${appUrl(req)}/api/webinargg/hook/${req.user.id}?t=${sig(`wgg.${req.user.id}`)}`;
  app.get('/api/webinargg', auth, (req, res) => res.json({ webinargg: wggView(req.user), hook: wggHook(req) }));
  app.put('/api/webinargg', auth, async (req, res) => { try { res.json({ webinargg: await connectWgg(req.user.id, req.body), hook: wggHook(req) }); } catch (e) { res.status(e.status || 502).json({ error: e.message }); } });
  app.delete('/api/webinargg', auth, (req, res) => { disconnectWgg(req.user.id); res.json({ webinargg: null }); });
  const own = (req, res) => { const w = T.webinars.get(req.params.wid); if (!w || w.userId !== req.user.id) { res.status(404).json({ error: 'Webinar not found' }); return null; } return w; };
  app.get('/api/webinars/:wid/analytics', auth, (req, res) => { const w = own(req, res); if (w) res.json({ ...webinarAnalytics(w), hook: `${appUrl(req)}/api/webinar-hook/${w.id}?t=${hookToken(w)}` }); });
  // the host's "Start the session" link for Zoom (made fresh: Zoom's start links expire)
  app.post('/api/webinars/:wid/host', auth, async (req, res) => {
    const w = own(req, res); if (!w) return;
    const kind = liveOf(req.user, w);
    if (!kind) return res.status(400).json({ error: 'This webinar isn’t on a connected Zoom or webinar.gg' });
    const start = Number(req.body?.session) || upcoming(w)[0];
    if (!start) return res.status(400).json({ error: 'There’s no upcoming session' });
    try { res.json(kind === 'zoom' ? { url: await zoomStartUrl(req.user, w, start), kind: kindFor(req.user, w) } : { url: await wggHostUrl(req.user, w, start, webTz(w)), kind: 'webinargg' }); } catch (e) { res.status(502).json({ error: `${kind === 'zoom' ? 'Zoom' : 'webinar.gg'}: ${e.message}` }); }
  });
  // attendance from another platform (webinar.gg, Meet, YouTube…): an uploaded list for one session
  app.post('/api/webinars/:wid/attendance', auth, (req, res) => {
    const w = own(req, res); if (!w) return;
    const session = Number(req.body?.session);
    if (!T.registrations.all({ webinarId: w.id }).some((r) => r.session === session)) return res.status(400).json({ error: 'Choose a session that has registrations' });
    const rows = rowsFrom(req.body?.rows);
    if (!rows.length) return res.status(400).json({ error: 'No email addresses found in that file' });
    res.json(applyAttendance(w, session, rows, 'import'));
  });
  app.get('/api/webinars/:wid/registrations', auth, (req, res) => {
    const w = T.webinars.get(req.params.wid);
    if (!w || w.userId !== req.user.id) return res.status(404).json({ error: 'Webinar not found' });
    res.json(T.registrations.all({ webinarId: w.id }, { order: 'session', desc: true, limit: 5000 }).map(outReg));
  });

  // --- public: attendance from a webinar platform's webhook or Zapier (one person, or a list), signed by the link ---
  app.post('/api/webinar-hook/:wid', (req, res) => {
    const w = T.webinars.get(req.params.wid);
    if (!w || !same(String(req.query.t || ''), hookToken(w))) return res.status(404).json({ error: 'Unknown webinar link' });
    const b = req.body || {};
    const rows = rowsFrom(Array.isArray(b.attendees) ? b.attendees : [b]);
    if (!rows.length) return res.status(400).json({ error: 'Send an email (and minutes or seconds watched)' });
    // the session: the one given, else the latest that has started
    const sessions = [...new Set(T.registrations.all({ webinarId: w.id }).map((r) => r.session))].sort((a, b2) => b2 - a);
    const given = Date.parse(b.session || '') || Number(b.session);
    const session = sessions.find((t) => t === given) || sessions.find((t) => t <= Date.now() + 15 * MIN);
    if (!session) return res.status(400).json({ error: 'No session to record this for' });
    res.json(applyAttendance(w, session, rows, 'webhook'));
  });

  // --- public: webinar.gg's webhook (the seller pastes this link in webinar.gg → Settings → Integrations).
  // The payload isn't trusted: it only says which room to look at, and that room must be one of ours.
  app.post('/api/webinargg/hook/:uid', (req, res) => {
    const u = T.users.get(req.params.uid);
    if (!u || !same(String(req.query.t || ''), sig(`wgg.${u.id}`))) return res.status(404).json({ error: 'Unknown link' });
    res.json({ ok: true });
    const ev = String(req.body?.event || ''), d = req.body?.data || {}, room = String(d.webinarId || '');
    if (!room || !wggOf(u)) return;
    for (const w of T.webinars.all({ userId: u.id })) {
      const start = Object.entries(w.wgg?.sessions || {}).find(([, s]) => s.id === room)?.[0];
      if (!start) continue;
      // the session ended: its attendance is fetched on the next run, not 20 minutes later
      if (ev === 'webinar.ended' || ev === 'webinar.slot.ended') T.webinars.update(w.id, (x) => { x.wgg.sessions[start] = { ...x.wgg.sessions[start], ended: Date.now(), tryAt: 0 }; });
      // a recording: the replay for that session's registrants (checked with webinar.gg that the room is ours)
      const link = [d.mp4Url, d.mainUrl, d.m3u8Url].find((x) => /^https:\/\/\S+$/.test(x || ''));
      if (ev === 'webinar.recording.created' && link) wggCall(u, 'GET', `/v1/webinar/${encodeURIComponent(room)}`).then(() => T.webinars.update(w.id, (x) => { x.wgg.sessions[start] = { ...x.wgg.sessions[start], recording: link.slice(0, 500) }; })).catch(() => {});
    }
  });

  // --- public: the sessions a registration page offers ---
  app.get('/api/public/:slug/sessions', (req, res) => {
    const f = pub(req, res);
    if (!f) return;
    const id = String(req.query.webinarId || '');
    // previews never create a webinar
    const w = req.query.preview === '1' ? (id && T.webinars.get(id)?.userId === f.userId ? T.webinars.get(id) : T.webinars.find({ funnelId: f.id }) || webinarFromFunnel(f)) : webinarFor(f, id);
    res.json({ name: w.name, duration: w.duration, tzOffset: offsetAt(webTz(w)), timezone: webTz(w), sessions: upcoming(w, Date.now(), 4) });
  });

  // --- public: a registrant's personal page (countdown, add to calendar, join → attendance) ---
  const byToken = (req, res) => {
    const r = T.registrations.get(req.params.rid);
    if (!r || !same(String(req.query.t || req.body?.t || ''), joinToken(r))) { res.status(404).json({ error: 'This link isn’t valid' }); return null; }
    return r;
  };
  app.get('/api/webinar-reg/:rid', (req, res) => {
    const r = byToken(req, res); if (!r) return;
    const w = T.webinars.get(r.webinarId), owner = T.users.get(r.userId);
    const now = Date.now(), end = r.session + (w?.duration || 90) * MIN;
    if (now > end && !r.attended && !r.replayAt) T.registrations.update(r.id, (x) => { x.replayAt = now; }); // a replay view (analytics)
    res.set('Cache-Control', 'no-store').json({
      name: w?.name, duration: w?.duration, tzOffset: w ? offsetAt(webTz(w)) : 330, timezone: w ? webTz(w) : 'Asia/Kolkata', session: r.session, end, seller: owner?.settings?.businessName || owner?.name || '', email: r.email,
      state: now < r.session - 15 * MIN ? 'soon' : now <= end ? 'live' : 'over',
      replay: now > end && (w?.replayUrl || r.replayStep) && (!w.replayHours || now < end + w.replayHours * HOUR) ? (w.replayUrl || `${r.base}${r.replayStep}`) : null,
    });
  });
  app.post('/api/webinar-reg/:rid/join', async (req, res) => {
    const r = byToken(req, res); if (!r) return;
    const w = T.webinars.get(r.webinarId);
    const now = Date.now(), end = r.session + (w?.duration || 90) * MIN;
    if (now < r.session - 15 * MIN) return res.status(400).json({ error: 'The room opens 15 minutes before the start' });
    if (now > end) return res.status(400).json({ error: 'This session has ended' });
    let url = w?.joinUrl;
    // Zoom: their own registrant link, else the session's link (made now if it isn't yet)
    const owner = w && T.users.get(w.userId), kind = w && liveOf(owner, w);
    if (kind === 'zoom') url = await zoomLink(r.id).catch(() => null) || T.webinars.get(w.id)?.zoom?.sessions?.[r.session]?.joinUrl || url;
    // webinar.gg: the room with a fresh join token — straight in, no form or OTP
    if (kind === 'webinargg') url = await wggJoinUrl(owner, w, r, webTz(w)).catch(() => null) || url;
    if (!url) return res.status(409).json({ error: 'The host hasn’t added the joining link yet — please refresh in a minute' });
    if (!r.attended) T.registrations.update(r.id, (x) => { x.attended = true; x.joinedAt = now; });
    res.json({ url });
  });
  app.get('/api/webinar-reg/:rid/ics', (req, res) => {
    const r = byToken(req, res); if (!r) return;
    const w = T.webinars.get(r.webinarId) || { name: 'Webinar', duration: 90 };
    const z = (t) => new Date(t).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    const link = joinUrl(r.base, r);
    res.set({ 'Content-Type': 'text/calendar; charset=utf-8', 'Content-Disposition': 'attachment; filename="webinar.ics"' }).send(['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//FunnelHive//Webinars//EN', 'BEGIN:VEVENT', `UID:${r.id}@funnelhive`, `DTSTAMP:${z(Date.now())}`, `DTSTART:${z(r.session)}`, `DTEND:${z(r.session + w.duration * MIN)}`, `SUMMARY:${String(w.name).replace(/[,;]/g, ' ')}`, `DESCRIPTION:Join: ${link}`, `URL:${link}`, 'END:VEVENT', 'END:VCALENDAR'].join('\r\n'));
  });
}
// previews show the next session without saving anything
export function previewSession(f, step, allBlocks) {
  const blk = allBlocks(step).find((b) => (b.type === 'optin' || b.type === 'form') && 'webinarId' in (b.props || {}));
  if (!blk) return null;
  const w = (blk.props.webinarId && T.webinars.get(blk.props.webinarId)) || T.webinars.find({ funnelId: f.id }) || webinarFromFunnel(f);
  const start = upcoming(w)[0];
  return start ? { start, end: start + w.duration * MIN, join: null, name: w.name, tzOffset: offsetAt(webTz(w)), timezone: webTz(w), preview: true } : null;
}
// used by the lead endpoint: is this sign-up a webinar registration, and for which session?
export function registrationFor(f, step, allBlocks, body, { email, name, phone, leadId, base }) {
  const blk = allBlocks(step).find((b) => (b.type === 'optin' || b.type === 'form') && 'webinarId' in (b.props || {}));
  if (!blk || !email) return null;
  const w = webinarFor(f, blk.props.webinarId);
  const replayStep = f.steps.find((s) => s.type === 'sales' && s.blocks.some((b) => b.type === 'pricing'));
  const replayPath = replayStep ? (domainOfFunnel(f.id) ? `/${replayStep.slug}` : `/f/${f.slug}/${replayStep.slug}`) : null;
  const out = register(f, w, { email, name, phone, session: body.session, leadId, base: linkBase(f.id, base), replayStep: replayPath });
  if (out.error) return out;
  return { start: out.registration.session, end: out.registration.session + w.duration * MIN, join: joinUrl(linkBase(f.id, base), out.registration), name: w.name, tzOffset: offsetAt(webTz(w)), timezone: webTz(w) };
}
