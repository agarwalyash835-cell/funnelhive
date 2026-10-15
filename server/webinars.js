// Webinars: the schedule behind a registration page (one-off dates, weekly, or daily "evergreen" sessions), who
// registered for which session, each registrant's personal joining link (which records attendance), and the
// emails around it: confirmation, a day before, an hour before, "we're live", and the replay afterwards.
//
// Times are UTC milliseconds; schedules are written in the webinar's local time (India by default, UTC+5:30).
import crypto from 'node:crypto';
import { T, tx, uid, contactKey, JOBS } from './db.js';
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

function cleanWebinar(b = {}, cur = {}) {
  const out = { ...cur };
  if ('name' in b || !cur.id) out.name = clip(b.name, 120) || cur.name || 'Live masterclass';
  if ('duration' in b || !cur.id) out.duration = intIn(b.duration, 15, 480, cur.duration || 90);
  if ('tzOffset' in b || !cur.id) out.tzOffset = intIn(b.tzOffset, -720, 840, cur.tzOffset ?? 330);
  if ('timezone' in b && (!b.timezone || validTz(b.timezone))) out.timezone = b.timezone || undefined;
  if ('joinUrl' in b) { const l = clip(b.joinUrl, 500); out.joinUrl = /^https:\/\/[^\s"'<>]+$/i.test(l) ? l : ''; }
  if ('replayUrl' in b) { const l = clip(b.replayUrl, 500); out.replayUrl = /^https:\/\/[^\s"'<>]+$/i.test(l) ? l : ''; }
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
  return { registration: r };
}

function notify(r, w, kind) {
  const owner = T.users.get(r.userId);
  if (!owner) return;
  const biz = owner.settings?.businessName || owner.name;
  const link = joinUrl(r.base, r), first = String(r.name || '').split(/\s+/)[0] || 'there';
  const replay = w.replayUrl || (r.replayStep ? `${r.base}${r.replayStep}` : '');
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
  for (const r of T.registrations.all({ session: { gte: now - 3 * HOUR, lte: now + 25 * HOUR } })) {
    if (r.status === 'cancelled') continue;
    const w = T.webinars.get(r.webinarId);
    if (!w) continue;
    const left = r.session - now, end = r.session + w.duration * MIN;
    const due = left > 2 * HOUR && left <= 24 * HOUR + 2 * MIN ? 'day' : left > 5 * MIN && left <= HOUR + 2 * MIN ? 'hour' : left <= 2 * MIN && left > -10 * MIN ? 'live' : now >= end + 15 * MIN && now < end + 3 * HOUR ? 'replay' : null;
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
if (JOBS && process.env.NODE_ENV !== 'test') setInterval(() => { try { webinarJob(); } catch (e) { console.error('webinar job failed', e.message); } }, 60000).unref();

const outReg = (r) => ({ id: r.id, email: r.email, name: r.name, phone: r.phone, session: r.session, status: r.status, attended: !!r.attended, joinedAt: r.joinedAt || null, at: r.at });

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
  app.get('/api/webinars/:wid/registrations', auth, (req, res) => {
    const w = T.webinars.get(req.params.wid);
    if (!w || w.userId !== req.user.id) return res.status(404).json({ error: 'Webinar not found' });
    res.json(T.registrations.all({ webinarId: w.id }, { order: 'session', desc: true, limit: 5000 }).map(outReg));
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
    res.set('Cache-Control', 'no-store').json({
      name: w?.name, duration: w?.duration, tzOffset: w ? offsetAt(webTz(w)) : 330, timezone: w ? webTz(w) : 'Asia/Kolkata', session: r.session, end, seller: owner?.settings?.businessName || owner?.name || '', email: r.email,
      state: now < r.session - 15 * MIN ? 'soon' : now <= end ? 'live' : 'over',
      replay: now > end && (w?.replayUrl || r.replayStep) && (!w.replayHours || now < end + w.replayHours * HOUR) ? (w.replayUrl || `${r.base}${r.replayStep}`) : null,
    });
  });
  app.post('/api/webinar-reg/:rid/join', (req, res) => {
    const r = byToken(req, res); if (!r) return;
    const w = T.webinars.get(r.webinarId);
    const now = Date.now(), end = r.session + (w?.duration || 90) * MIN;
    if (now < r.session - 15 * MIN) return res.status(400).json({ error: 'The room opens 15 minutes before the start' });
    if (now > end) return res.status(400).json({ error: 'This session has ended' });
    if (!w?.joinUrl) return res.status(409).json({ error: 'The host hasn’t added the joining link yet — please refresh in a minute' });
    if (!r.attended) T.registrations.update(r.id, (x) => { x.attended = true; x.joinedAt = now; });
    res.json({ url: w.joinUrl });
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
