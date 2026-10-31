// Safe agency access: how an agency (its owner, or its client managers) works inside a client account.
//   - entering needs a reason, and gives a 2-hour session marked as agency access (session.agencyImp + the token's
//     agencyImp claim); it is never extended and can't be swapped for a normal sign-in
//   - the client is told (bell) and sees it in their activity log, with what the agency looked at (reads are
//     logged too, one row per page per minute)
//   - the client's own owner decides: agency access full / read-only / off (user.agencyAccessMode; default full)
//   - agency staff: team members of the agency with the "Client manager" role (team.js role 'clients'), limited
//     to the clients assigned to them (member.clientIds) when the agency picked some
// The auth middleware calls enterWorkspace (team.js → agencyEntry here) and then agencyGate.
import { T, uid } from './db.js';
import { startSession } from './security.js';
import { tierOf } from './tiers.js';
import { notify } from './notify.js';

export const ACCESS_HOURS = 2;
export const MODES = ['full', 'read', 'off'];
export const accessMode = (client) => (MODES.includes(client?.agencyAccessMode) ? client.agencyAccessMode : 'full');
const MODE_TEXT = { full: 'full access', read: 'read-only' };
const clip = (v, n) => String(v ?? '').trim().slice(0, n);
const bizName = (u) => u?.settings?.whiteLabel?.brand || u?.settings?.businessName || u?.name || u?.email || '';

// a client manager of the agency (role 'clients'), and whether this client is one of theirs
export const staffMember = (agencyId, userId) => { const m = T.members.find({ ownerId: agencyId, userId, status: 'active' }); return m?.role === 'clients' ? m : null; };
export const staffCovers = (m, clientId) => !m?.clientIds?.length || m.clientIds.includes(clientId);

// The workspace step for an agency: only through its own live agency-access session for this client, the client
// still under this agency, the agency still on the client's team (the client can remove it), and staff still
// assigned. Returns what the auth middleware needs, or null (→ 401 "no longer have access").
export function agencyEntry(actor, owner, p, m) {
  if (!p?.sid || !m) return null;
  const s = T.sessions.get(p.sid);
  if (!s?.agencyImp || s.ws !== owner.id || s.userId !== actor.id) return null;
  if (p.agencyImp && p.agencyImp !== s.agencyImp) return null;
  const agencyId = s.agencyImp;
  if (owner.agencyId !== agencyId || m.userId !== agencyId) return null;
  const agency = T.users.get(agencyId);
  if (!agency) return null;
  const staff = actor.id !== agencyId;
  if (staff) { const sm = staffMember(agencyId, actor.id); if (!sm || !staffCovers(sm, owner.id)) return null; }
  return { owner, member: { ...m, role: 'agency' }, agency: { agencyId, agencyName: bizName(agency), actorId: actor.id, actorName: actor.name || actor.email, staff, reason: s.reason || '', expiresAt: s.expiresAt, sid: s.id } };
}

// After entry: the client's setting (off → 403, read-only → no writes) and the read log. Returns { status, body }
// to refuse, or null to go on.
const NAV = /^\/api\/(auth\/(refresh|logout)|team\/switch)$/;
const QUIET = /^\/api\/(me(\/menu)?|notifications(\/read)?|events|hive\/status|team\/workspaces|public\/.*)$/;
const READ = new Set(['GET', 'HEAD']);
const seen = new Map(); // sid:path → when last logged (a read is logged once a minute)
export function agencyGate(req, res, w) {
  if (!w?.agency) return null;
  req.agencyAccess = { ...w.agency, mode: accessMode(w.owner) };
  const path = req.originalUrl.split('?')[0].toLowerCase();
  if (req.agencyAccess.mode === 'off') return { status: 403, body: { error: `${bizName(w.owner)} has turned off agency access to their account`, agencyAccessOff: true } };
  if (req.agencyAccess.mode === 'read' && !READ.has(req.method) && !NAV.test(path)) return { status: 403, body: { error: 'This client allows read-only access — you can look, but not change anything', readOnly: true } };
  if (req.method === 'GET' && !QUIET.test(path)) {
    const k = `${w.agency.sid}:${path}`, now = Date.now();
    if (now - (seen.get(k) || 0) > 60000) {
      if (seen.size > 5000) seen.clear();
      seen.set(k, now);
      res.on('finish', () => { if (res.statusCode < 400) logAgency(w.owner.id, w.agency, { method: 'GET', path: path.slice(0, 160) }); });
    }
  }
  return null;
}

const whoOf = (a) => ({ kind: 'agency', name: a.staff ? `${a.actorName} (${a.agencyName})` : a.agencyName, email: '' });
export function logAgency(clientId, a, { method, path, what = '' }) {
  try { T.activity.insert({ id: uid(), userId: clientId, at: Date.now(), method, path, who: whoOf(a), ...(what ? { what } : {}) }); } catch {}
}

// Open a client account: checks the client's setting, starts the 2-hour session, tells the client, logs it.
// sign(actor, clientId, agencyId, sid) makes the token (index.js signAgency). → { token, expiresAt, mode } or { status, error }
export function startAgencyAccess(req, { actor, agency, client, reason, sign }) {
  reason = clip(reason, 200);
  if (reason.length < 3) return { status: 400, error: 'Say why you’re opening this account — your client sees it' };
  if (req.impersonator) return { status: 403, error: 'Support access can’t open client accounts' };
  if (client.agencyId !== agency.id) return { status: 404, error: 'Client account not found' };
  if (client.deletion) return { status: 409, error: 'This account is scheduled for deletion — restore it first' };
  const mode = accessMode(client);
  if (mode === 'off') return { status: 403, error: `${bizName(client)} has turned off agency access to their account`, agencyAccessOff: true };
  const m = T.members.find({ ownerId: client.id, userId: agency.id, status: 'active' });
  if (!m || m.role !== 'agency') return { status: 403, error: 'Your agency is no longer on this client’s team' };
  // the session and token belong to the address the agency works from (tiers.js) — agency. or the app's
  const aud = tierOf(req) === 'super' ? 'app' : tierOf(req);
  const sid = startSession(req, actor, { ms: ACCESS_HOURS * 3600000, aud });
  const s = T.sessions.update(sid, (x) => { x.agencyImp = agency.id; x.ws = client.id; x.reason = reason; });
  const a = { agencyId: agency.id, agencyName: bizName(agency), actorId: actor.id, actorName: actor.name || actor.email, staff: actor.id !== agency.id, sid };
  const what = `Opened your account (${MODE_TEXT[mode]}, ${ACCESS_HOURS} hours): “${reason}”`;
  logAgency(client.id, a, { method: 'ENTER', path: '/api/agency/enter', what });
  T.audit.insert({ id: uid(), actorId: actor.id, actor: actor.email, userId: client.id, action: 'agency_enter', detail: `${a.agencyName}${a.staff ? ` · ${a.actorName}` : ''} · ${mode} · ${reason}`.slice(0, 500), at: Date.now() });
  // the client hears about it (the bell; their team sees it too)
  notify(client.id, { kind: 'agency', title: `${a.agencyName} opened your account`, body: `${a.staff ? `${a.actorName}: ` : ''}${reason} (${MODE_TEXT[mode]}, ${ACCESS_HOURS} hours)`, link: '/settings' });
  return { token: sign(actor, client.id, agency.id, sid, aud), expiresAt: s.expiresAt, mode };
}

// The client's own owner: agency access full / read-only / off, and the recent agency visits
export function registerAgencyAccess(app, { auth }) {
  const ownerOnly = (req, res) => { if (req.actor || req.apiKey || req.impersonator) { res.status(403).json({ error: 'Only the account’s owner can change agency access' }); return false; } return true; };
  const view = (u) => {
    const a = u.agencyId ? T.users.get(u.agencyId) : null;
    const visits = T.activity.all({ userId: u.id }, { order: 'at', desc: true, limit: 300 }).filter((x) => x.method === 'ENTER').slice(0, 10).map((x) => ({ at: x.at, who: x.who?.name || '', what: x.what || '' }));
    return { mode: accessMode(u), agency: a ? bizName(a) : null, visits };
  };
  app.get('/api/agency-access', auth, (req, res) => { if (!ownerOnly(req, res)) return; res.json(view(req.user)); });
  app.put('/api/agency-access', auth, (req, res) => {
    if (!ownerOnly(req, res)) return;
    const mode = req.body?.mode;
    if (!MODES.includes(mode)) return res.status(400).json({ error: 'Pick full, read-only or off' });
    const u = T.users.update(req.user.id, (x) => { x.agencyAccessMode = mode; });
    res.json(view(u));
  });
}
