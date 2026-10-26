// Zoom for webinars, through the seller's own Zoom account: a Server-to-Server OAuth app (account ID, client ID,
// client secret — the secret stored encrypted). Each webinar session becomes its own Zoom webinar (with the Zoom
// Webinars add-on: every registrant gets a personal link) or Zoom meeting; afterwards Zoom's participant report
// says who came and for how long, which fills in attendance and watch time.
import { T } from './db.js';
import { encrypt, decrypt } from './messaging.js';

const API = () => String(process.env.ZOOM_API_URL || 'https://api.zoom.us/v2').replace(/\/+$/, '');
const OAUTH = () => String(process.env.ZOOM_OAUTH_URL || 'https://zoom.us/oauth/token');
const clip = (v, n) => String(v ?? '').trim().slice(0, n);
const tokens = new Map(); // userId → { token, exp }

export const zoomOf = (u) => (u?.zoom?.clientSecretEnc ? u.zoom : null);
async function tokenFor(creds, cacheKey) {
  const hit = cacheKey && tokens.get(cacheKey);
  if (hit && hit.exp > Date.now() + 60000) return hit.token;
  const basic = Buffer.from(`${creds.clientId}:${creds.clientSecret}`).toString('base64');
  const res = await fetch(`${OAUTH()}?grant_type=account_credentials&account_id=${encodeURIComponent(creds.accountId)}`, { method: 'POST', headers: { Authorization: `Basic ${basic}` }, signal: AbortSignal.timeout(10000) });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.access_token) throw new Error(j.reason || j.error_description || j.error || 'Zoom didn’t accept these app keys');
  if (cacheKey) tokens.set(cacheKey, { token: j.access_token, exp: Date.now() + (Number(j.expires_in) || 3600) * 1000 });
  return j.access_token;
}
const credsOf = (z) => ({ accountId: z.accountId, clientId: z.clientId, clientSecret: decrypt(z.clientSecretEnc) });
async function call(token, method, path, body) {
  const res = await fetch(`${API()}${path}`, { method, headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(15000) });
  if (res.status === 204) return null;
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(j.message || `Zoom answered ${res.status}`), { status: res.status, code: j.code });
  return j;
}
export async function zoomCall(u, method, path, body) {
  const z = zoomOf(u);
  if (!z) throw new Error('Connect Zoom first');
  try { return await call(await tokenFor(credsOf(z), u.id), method, path, body); } catch (e) {
    if (e.status === 401) { tokens.delete(u.id); return call(await tokenFor(credsOf(z), u.id), method, path, body); }
    throw e;
  }
}
// checks the keys; webinars: whether this Zoom account has the Webinars add-on (else sessions are meetings)
export async function connectZoom(userId, b = {}) {
  const creds = { accountId: clip(b.accountId, 80), clientId: clip(b.clientId, 80), clientSecret: clip(b.clientSecret, 200) };
  if (!creds.accountId || !creds.clientId || !creds.clientSecret) throw Object.assign(new Error('Enter the Account ID, Client ID and Client secret of your Zoom app'), { status: 400 });
  let token;
  try { token = await tokenFor(creds); } catch (e) { throw Object.assign(new Error(`Zoom didn’t accept these keys — ${e.message}`), { status: 400 }); }
  const me = await call(token, 'GET', '/users/me').catch((e) => { throw Object.assign(new Error(`Connected, but Zoom refused to read your account (${e.message}) — add the user:read scope to the app`), { status: 400 }); });
  const webinars = await call(token, 'GET', '/users/me/webinars?page_size=1').then(() => true, () => false);
  tokens.set(userId, { token, exp: Date.now() + 50 * 60000 });
  const u = T.users.update(userId, (x) => { x.zoom = { accountId: creds.accountId, clientId: creds.clientId, clientSecretEnc: encrypt(creds.clientSecret), email: clip(me.email, 200), name: clip(`${me.first_name || ''} ${me.last_name || ''}`, 120), webinars, at: Date.now() }; });
  return zoomView(u);
}
export const zoomView = (u) => { const z = zoomOf(u); return z ? { email: z.email, name: z.name, webinars: !!z.webinars, at: z.at } : null; };
export function disconnectZoom(userId) { tokens.delete(userId); T.users.update(userId, (x) => { delete x.zoom; }); }

// ---------- sessions ----------
// the Zoom webinar / meeting for one session, created the first time it's needed (one at a time per session)
const making = new Map();
export const kindFor = (u, w) => (w.zoomKind === 'meeting' || !zoomOf(u)?.webinars ? 'meeting' : 'webinar');
export async function zoomSession(u, w, start) {
  const key = `${w.id}:${start}`;
  const have = T.webinars.get(w.id)?.zoom?.sessions?.[start];
  if (have) return have;
  if (making.has(key)) return making.get(key);
  const p = (async () => {
    const kind = kindFor(u, w);
    const body = {
      topic: clip(w.name, 200), type: kind === 'webinar' ? 5 : 2, start_time: new Date(start).toISOString().replace(/\.\d{3}Z$/, 'Z'), timezone: 'UTC', duration: w.duration, agenda: clip(w.name, 2000),
      settings: kind === 'webinar' ? { approval_type: 0, registration_type: 1, host_video: true, panelists_video: true, practice_session: false, auto_recording: w.zoomRecord ? 'cloud' : 'none', registrants_email_notification: false }
        : { join_before_host: false, waiting_room: false, mute_upon_entry: true, auto_recording: w.zoomRecord ? 'cloud' : 'none' },
    };
    const r = await zoomCall(u, 'POST', `/users/me/${kind}s`, body);
    const s = { id: String(r.id), kind, joinUrl: clip(r.join_url, 500), at: Date.now() };
    T.webinars.update(w.id, (x) => { x.zoom = { ...x.zoom, sessions: { ...x.zoom?.sessions, [start]: s } }; });
    return s;
  })().finally(() => making.delete(key));
  making.set(key, p);
  return p;
}
// a registrant's own link (Zoom webinars only; a meeting has one link for everyone)
export async function zoomRegistrant(u, w, r) {
  const s = await zoomSession(u, w, r.session);
  if (s.kind !== 'webinar') return s.joinUrl;
  const [first, ...rest] = String(r.name || r.email.split('@')[0]).trim().split(/\s+/);
  const z = await zoomCall(u, 'POST', `/webinars/${s.id}/registrants`, { email: r.email, first_name: clip(first, 60) || 'Guest', last_name: clip(rest.join(' '), 60), ...(r.phone ? { phone: clip(r.phone, 40) } : {}) });
  return clip(z.join_url, 500);
}
// the host's start link (fresh — Zoom's start links expire after two hours)
export async function zoomStartUrl(u, w, start) {
  const s = await zoomSession(u, w, start);
  const r = await zoomCall(u, 'GET', `/${s.kind}s/${s.id}`);
  return r.start_url;
}
// who came and for how long: Zoom's participant report (ready a little while after the session ends)
export async function zoomReport(u, s) {
  const out = [];
  let next = '';
  for (let i = 0; i < 20; i++) {
    const r = await zoomCall(u, 'GET', `/report/${s.kind}s/${s.id}/participants?page_size=300${next ? `&next_page_token=${encodeURIComponent(next)}` : ''}`);
    out.push(...(r.participants || []));
    next = r.next_page_token;
    if (!next) break;
  }
  // one row per person (rejoining makes several): total seconds, first join
  const by = new Map();
  for (const p of out) {
    const k = String(p.user_email || '').toLowerCase() || `name:${p.name}`;
    const cur = by.get(k) || { email: String(p.user_email || '').toLowerCase(), name: clip(p.name, 120), seconds: 0, joinedAt: Infinity };
    cur.seconds += Number(p.duration) || 0;
    cur.joinedAt = Math.min(cur.joinedAt, Date.parse(p.join_time) || Infinity);
    by.set(k, cur);
  }
  return [...by.values()].map((x) => ({ ...x, joinedAt: Number.isFinite(x.joinedAt) ? x.joinedAt : null }));
}
