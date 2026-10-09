// Google Calendar for booking calendars. The seller connects their Google account once (OAuth, offline access):
//   - busy times in their Google Calendar block those slots on booking pages (free/busy, cached for 5 minutes)
//   - every booking is added to their Google Calendar with the buyer as a guest, and a Google Meet link when the
//     booking calendar has no meeting link of its own; cancelling or rescheduling updates it
// Needs GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET (the same Google Cloud project as "Continue with Google"), with
// <APP_URL>/api/google/calendar/callback as an authorised redirect URI and the Calendar API enabled.
import crypto from 'node:crypto';
import { T } from './db.js';
import { encrypt, decrypt, setChannel } from './messaging.js';
import { googleClientId } from './google.js';

const AUTH_URL = () => process.env.GOOGLE_OAUTH_URL || 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = () => process.env.GOOGLE_TOKEN_URL || 'https://oauth2.googleapis.com/token';
const API = () => (process.env.GOOGLE_CALENDAR_API || 'https://www.googleapis.com/calendar/v3').replace(/\/$/, '');
const SCOPES = 'https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.freebusy openid email';
const clientSecret = () => (process.env.GOOGLE_CLIENT_SECRET || '').trim();
export const gcalAvailable = () => !!(googleClientId() && clientSecret());
let SECRET = '';
const sig = (s) => crypto.createHmac('sha256', SECRET).update(`gcal:${s}`).digest('base64url').slice(0, 32);

export const gcalStatus = (u) => { const g = u?.channels?.gcal; return { available: gcalAvailable(), connected: !!g?.refreshEnc, email: g?.email || '', blockBusy: g?.blockBusy !== false, addEvents: g?.addEvents !== false }; };

// ---------- tokens ----------
const access = new Map(); // userId → { token, exp }
async function tokenFor(u) {
  const g = u?.channels?.gcal;
  if (!g?.refreshEnc) return null;
  const c = access.get(u.id);
  if (c && c.exp > Date.now() + 60000) return c.token;
  const r = await fetch(TOKEN_URL(), { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: googleClientId(), client_secret: clientSecret(), refresh_token: decrypt(g.refreshEnc), grant_type: 'refresh_token' }), signal: AbortSignal.timeout(10000) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d.access_token) {
    // revoked in Google: stop trying, show "reconnect" in Settings
    if (d.error === 'invalid_grant') T.users.update(u.id, (x) => { if (x.channels?.gcal) x.channels.gcal.broken = true; });
    throw new Error(d.error_description || d.error || `Google ${r.status}`);
  }
  access.set(u.id, { token: d.access_token, exp: Date.now() + (d.expires_in || 3600) * 1000 });
  return d.access_token;
}
async function gapi(u, method, path, body) {
  const t = await tokenFor(u);
  if (!t) return null;
  const r = await fetch(`${API()}${path}`, { method, headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(10000) });
  if (r.status === 204 || r.status === 410) return {};
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error?.message || `Google Calendar ${r.status}`);
  return d;
}

// ---------- busy times ----------
const busyCache = new Map(); // userId → { at, from, to, list: [[start, end]] }
export const cachedBusy = (userId) => busyCache.get(userId)?.list || [];
// refresh the seller's busy times (call before showing slots); failures keep the last known list
export async function refreshBusy(userId, days = 60) {
  const u = T.users.get(userId);
  const g = u?.channels?.gcal;
  if (!g?.refreshEnc || g.blockBusy === false || g.broken) { busyCache.delete(userId); return []; }
  const c = busyCache.get(userId);
  if (c && Date.now() - c.at < 5 * 60000) return c.list;
  try {
    const from = new Date(Date.now() - 86400000).toISOString(), to = new Date(Date.now() + days * 86400000).toISOString();
    const d = await gapi(u, 'POST', '/freeBusy', { timeMin: from, timeMax: to, items: [{ id: g.calendarId || 'primary' }] });
    const list = (d?.calendars?.[g.calendarId || 'primary']?.busy || []).map((b) => [Date.parse(b.start), Date.parse(b.end)]).filter(([a, b]) => a < b);
    // our own bookings are in Google too: they're already busy here, and must not block their own reschedule
    const ours = new Set(T.bookings.all({ userId, status: 'confirmed', start: { gte: Date.now() - 86400000 } }).filter((b) => b.gEventId).map((b) => `${b.start}-${b.end}`));
    const out = list.filter(([a, b]) => !ours.has(`${a}-${b}`));
    busyCache.set(userId, { at: Date.now(), list: out });
    return out;
  } catch (e) { console.error('google free/busy failed', e.message); return c?.list || []; }
}

// ---------- events ----------
export async function addEvent(b, cal) {
  const u = T.users.get(b.userId);
  const g = u?.channels?.gcal;
  if (!g?.refreshEnc || g.addEvents === false || g.broken) return null;
  try {
    const meet = !cal.meetingLink;
    const ev = await gapi(u, 'POST', `/calendars/${encodeURIComponent(g.calendarId || 'primary')}/events?sendUpdates=all${meet ? '&conferenceDataVersion=1' : ''}`, {
      summary: `${cal.name} — ${b.name || b.email}`,
      description: [b.notes && `Notes: ${b.notes}`, b.phone && `Phone: ${b.phone}`, cal.meetingLink && `Join: ${cal.meetingLink}`, 'Booked through FunnelHive'].filter(Boolean).join('\n'),
      start: { dateTime: new Date(b.start).toISOString() }, end: { dateTime: new Date(b.end).toISOString() },
      attendees: [{ email: b.email, displayName: b.name || undefined }],
      location: cal.meetingLink || cal.location || undefined,
      ...(meet ? { conferenceData: { createRequest: { requestId: `ff-${b.id}`, conferenceSolutionKey: { type: 'hangoutsMeet' } } } } : {}),
      reminders: { useDefault: true },
    });
    const link = ev?.hangoutLink || ev?.conferenceData?.entryPoints?.find((x) => x.entryPointType === 'video')?.uri || '';
    busyCache.delete(b.userId);
    T.bookings.update(b.id, (x) => { x.gEventId = ev?.id || null; if (link) x.meetLink = link; });
    return { id: ev?.id, meetLink: link };
  } catch (e) { console.error('google event failed', e.message); return null; }
}
export async function removeEvent(b) {
  if (!b.gEventId) return;
  const u = T.users.get(b.userId);
  try { await gapi(u, 'DELETE', `/calendars/${encodeURIComponent(u?.channels?.gcal?.calendarId || 'primary')}/events/${encodeURIComponent(b.gEventId)}?sendUpdates=all`); busyCache.delete(b.userId); } catch (e) { console.error('google event delete failed', e.message); }
}

// ---------- connect / disconnect ----------
export function registerGcal(app, { auth, secret, appUrl }) {
  SECRET = secret;
  const redirect = (req) => `${process.env.APP_URL || appUrl(req)}/api/google/calendar/callback`;
  app.get('/api/google/calendar', auth, (req, res) => res.json(gcalStatus(req.user)));
  // returns the Google consent URL (the app opens it)
  app.post('/api/google/calendar/connect', auth, (req, res) => {
    if (!gcalAvailable()) return res.status(400).json({ error: 'Google Calendar isn’t set up on this server yet (GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET)' });
    const state = `${req.user.id}.${Date.now()}`;
    const url = `${AUTH_URL()}?${new URLSearchParams({ client_id: googleClientId(), redirect_uri: redirect(req), response_type: 'code', scope: SCOPES, access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true', state: `${state}.${sig(state)}` })}`;
    res.json({ url });
  });
  app.get('/api/google/calendar/callback', async (req, res) => {
    const done = (msg) => res.redirect(302, `/bookings?gcal=${encodeURIComponent(msg)}`);
    const [uidPart, ts, s] = String(req.query.state || '').split('.');
    if (!uidPart || !s || s !== sig(`${uidPart}.${ts}`) || Date.now() - Number(ts) > 15 * 60000) return done('expired');
    if (req.query.error || !req.query.code) return done('cancelled');
    try {
      const r = await fetch(TOKEN_URL(), { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ code: String(req.query.code), client_id: googleClientId(), client_secret: clientSecret(), redirect_uri: redirect(req), grant_type: 'authorization_code' }), signal: AbortSignal.timeout(10000) });
      const d = await r.json();
      if (!r.ok || !d.refresh_token) return done('failed');
      let email = '';
      try { email = JSON.parse(Buffer.from(String(d.id_token || '').split('.')[1] || '', 'base64url').toString()).email || ''; } catch {}
      const u = T.users.get(uidPart);
      if (!u) return done('failed');
      setChannel(u.id, 'gcal', { refreshEnc: encrypt(d.refresh_token), email, calendarId: 'primary', blockBusy: true, addEvents: true, at: Date.now() });
      access.set(u.id, { token: d.access_token, exp: Date.now() + (d.expires_in || 3600) * 1000 });
      busyCache.delete(u.id);
      done('connected');
    } catch (e) { console.error('google connect failed', e.message); done('failed'); }
  });
  app.put('/api/google/calendar', auth, (req, res) => {
    const g = req.user.channels?.gcal;
    if (!g) return res.status(400).json({ error: 'Connect Google Calendar first' });
    const out = { ...g, ...('blockBusy' in (req.body || {}) ? { blockBusy: !!req.body.blockBusy } : {}), ...('addEvents' in (req.body || {}) ? { addEvents: !!req.body.addEvents } : {}) };
    busyCache.delete(req.user.id);
    res.json(gcalStatus(setChannel(req.user.id, 'gcal', out)));
  });
  app.delete('/api/google/calendar', auth, async (req, res) => {
    const g = req.user.channels?.gcal;
    if (g?.refreshEnc) fetch(`${process.env.GOOGLE_REVOKE_URL || 'https://oauth2.googleapis.com/revoke'}?token=${encodeURIComponent(decrypt(g.refreshEnc))}`, { method: 'POST', signal: AbortSignal.timeout(5000) }).catch(() => {});
    access.delete(req.user.id); busyCache.delete(req.user.id);
    res.json(gcalStatus(setChannel(req.user.id, 'gcal', undefined)));
  });
}
