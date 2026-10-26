// webinar.gg for webinars, through the seller's own webinar.gg account (an API token from Settings → Integrations;
// the API needs their premium plan). Each session becomes its own webinar.gg room; "Join" mints a short-lived join
// token so the registrant lands straight in the room (no form, no OTP), and the host gets their studio the same way.
// Afterwards the room's attendee list says who came, and its metrics give the totals; webinar.gg's webhook tells
// us when a session ended (so attendance comes in right away) and hands over the recording for the replay.
import { T } from './db.js';
import { encrypt, decrypt } from './messaging.js';

const API = () => String(process.env.WEBINARGG_API_URL || 'https://webinar-api.webinar.gg/api').replace(/\/+$/, '');
const clip = (v, n) => String(v ?? '').trim().slice(0, n);

export const wggOf = (u) => (u?.webinargg?.tokenEnc ? u.webinargg : null);
export const wggView = (u) => { const g = wggOf(u); return g ? { email: g.email || '', at: g.at } : null; };
async function call(token, method, path, body) {
  const res = await fetch(`${API()}${path}`, { method, headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(15000) });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || j.success === false) {
    const msg = res.status === 403 ? 'webinar.gg needs a premium plan for the API (or this isn’t your webinar)' : res.status === 401 ? 'webinar.gg didn’t accept the API token' : res.status === 429 ? 'webinar.gg is busy — try again in a minute' : j.error || `webinar.gg answered ${res.status}`;
    throw Object.assign(new Error(msg), { status: res.status });
  }
  return j.data ?? j;
}
export const wggCall = (u, method, path, body) => { const g = wggOf(u); if (!g) throw new Error('Connect webinar.gg first'); return call(decrypt(g.tokenEnc), method, path, body); };

export async function connectWgg(userId, b = {}) {
  const token = clip(b.token, 300);
  if (!token) throw Object.assign(new Error('Paste your webinar.gg API token (Settings → Integrations)'), { status: 400 });
  try { await call(token, 'GET', '/v1/webinar/?page=1&limit=1'); } catch (e) { throw Object.assign(new Error(e.message), { status: 400 }); }
  const u = T.users.update(userId, (x) => { x.webinargg = { tokenEnc: encrypt(token), email: clip(b.email, 200).toLowerCase() || String(x.email || '').toLowerCase(), at: Date.now() }; });
  return wggView(u);
}
export function disconnectWgg(userId) { T.users.update(userId, (x) => { delete x.webinargg; }); }

// a moment as webinar.gg wants it: the date, a 12-hour time and AM/PM in the webinar's own time zone
function localParts(t, tz) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: true }).formatToParts(new Date(t)).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour === '00' ? '12' : p.hour}:${p.minute}`, meridiem: String(p.dayPeriod || 'AM').toUpperCase() };
}
// the room for one session, created the first time it's needed (one at a time per session)
const making = new Map();
export async function wggSession(u, w, start, tz) {
  const key = `${w.id}:${start}`;
  const have = T.webinars.get(w.id)?.wgg?.sessions?.[start];
  if (have) return have;
  if (making.has(key)) return making.get(key);
  const p = (async () => {
    const r = await wggCall(u, 'POST', '/v1/webinar/', { title: clip(w.name, 200), ...localParts(start, tz), timezone: tz, durationMinutes: w.duration, authentication: false, requireLogin: false, recordingEnabled: !!w.wggRecord });
    const s = { id: String(r.id), url: clip(r.url, 500), at: Date.now() };
    T.webinars.update(w.id, (x) => { x.wgg = { ...x.wgg, sessions: { ...x.wgg?.sessions, [start]: s } }; });
    return s;
  })().finally(() => making.delete(key));
  making.set(key, p);
  return p;
}
// straight into the room: the room link with a fresh join token (10 minutes, up to 10 uses)
async function joinLink(u, s, who) {
  const [first, ...rest] = String(who.name || who.email.split('@')[0]).trim().split(/\s+/);
  const t = await wggCall(u, 'POST', '/v1/webinar/join-token', { webinarId: s.id, firstName: clip(first, 60) || 'Guest', lastName: clip(rest.join(' '), 60) || '-', email: who.email, phone: clip(who.phone, 40), passcode: '' });
  return `${s.url}${s.url.includes('?') ? '&' : '?'}token=${encodeURIComponent(t.token)}`;
}
export async function wggJoinUrl(u, w, r, tz) {
  const s = await wggSession(u, w, r.session, tz);
  try { return await joinLink(u, s, r); } catch { return s.url; } // the room's own join form still works
}
// the host studio, signed in as the webinar.gg account's owner
export async function wggHostUrl(u, w, start, tz) {
  const s = await wggSession(u, w, start, tz);
  return joinLink(u, s, { email: wggOf(u).email || u.email, name: u.name || 'Host', phone: '' });
}
// after the session: who attended (the room's attendee list) and the totals (its metrics)
export async function wggReport(u, s) {
  const rows = [];
  for (let page = 0; page < 100; page++) {
    const d = await wggCall(u, 'GET', `/v1/webinar/${encodeURIComponent(s.id)}/invite?page=${page}&limit=20`);
    const users = d.users || [];
    rows.push(...users.filter((x) => x.attended === true && !x.isHost).map((x) => ({ email: String(x.email || '').toLowerCase(), name: clip(`${x.firstName || ''} ${x.lastName || ''}`, 120), seconds: 0, joinedAt: null })));
    if (users.length < 20 || rows.length >= (d.pagination?.total ?? Infinity)) break;
  }
  const m = await wggCall(u, 'GET', `/webinar/${encodeURIComponent(s.id)}/metrics`).catch(() => null);
  return { rows, metrics: m ? { totalUsers: m.totalUsers ?? null, peak: m.maxLiveUsers ?? null, minutes: m.durationMinutes ?? null } : null };
}
