// The school: a seller's members area. Students sign in with a one-time code sent to their email (no passwords),
// take the courses they bought (progress, resume, quizzes, questions under each lesson, certificates) and meet in the
// community (spaces, posts, comments, likes). Activity earns points and levels; a leaderboard shows who's most
// helpful. The AI tutor answers from the course's own lessons. Address: /learn/<the seller's handle>.
import crypto from 'node:crypto';
import { T, q, tx, uid, contactKey } from './db.js';
import { hashToken, randomToken } from './security.js';
import { sendEmail } from './messaging.js';
import { handleOf } from './bookings.js';
import { studentLibrary, accessActive, cleanQuiz } from './products.js';
import { aiEnabled, aiText, aiJson } from './ai.js';
import { creditsShort, spendCredits } from './billing.js';
import { brand } from './platform.js';
import { waEvent } from './hive-wa.js';
import { ticket } from './video.js';

const DAY = 86400000;
const SESSION_DAYS = 60;
const CODE_MIN = 10;
const clip = (v, n) => String(v ?? '').trim().slice(0, n);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const first = (name) => String(name || '').trim().split(/\s+/)[0] || '';
const initials = (name) => String(name || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';

// ---------- the school's settings (on the seller's account) ----------
export const SCHOOL_DEFAULTS = { name: '', tagline: '', logo: '', cover: '', color: '', openJoin: false, deviceLimit: 3, tutor: true, levels: ['Newcomer', 'Learner', 'Regular', 'Contributor', 'Achiever', 'Expert', 'Mentor', 'Master', 'Legend'], welcome: '' };
export const schoolOf = (u) => ({ ...SCHOOL_DEFAULTS, ...(u?.settings?.school || {}) });
const schoolName = (u) => schoolOf(u).name || u?.settings?.businessName || u?.name || brand();

// Skool-style levels: the points needed to reach level 1–9
export const LEVELS = [0, 5, 20, 65, 155, 515, 2015, 8015, 33015];
export const levelOf = (pts) => { let l = 1; for (let i = 0; i < LEVELS.length; i++) if (pts >= LEVELS[i]) l = i + 1; return l; };
const levelView = (u, pts) => {
  const lvl = levelOf(pts), names = schoolOf(u).levels;
  return { level: lvl, levelName: names[lvl - 1] || `Level ${lvl}`, points: pts, from: LEVELS[lvl - 1], next: lvl < LEVELS.length ? LEVELS[lvl] : null };
};

// ---------- students ----------
const studentKey = (email) => contactKey(String(email || '').trim().toLowerCase());
export function ensureStudent(userId, { email, name = '', phone = '' }) {
  const ckey = studentKey(email);
  if (!ckey || ckey.startsWith('phone:')) return null;
  return tx(() => {
    const cur = T.students.find({ userId, ckey });
    if (cur) {
      if ((name && !cur.name) || (phone && !cur.phone)) return T.students.update(cur.id, (s) => { if (name && !s.name) s.name = clip(name, 80); if (phone && !s.phone) s.phone = clip(phone, 30); });
      return cur;
    }
    // a name from their purchases or sign-ups when they didn't give one
    const known = name || T.access.all({ userId, ckey }).find((a) => a.name)?.name || T.leads.find({ userId, ckey })?.name || '';
    return T.students.insert({ id: uid(), userId, ckey, email: String(email).trim().toLowerCase(), name: clip(known, 80), phone: clip(phone, 30), bio: '', points: 0, banned: false, at: Date.now(), lastSeenAt: Date.now() });
  });
}
const accessRows = (s) => T.access.all({ userId: s.userId, ckey: s.ckey });
const hasAnyAccess = (s, now = Date.now()) => accessRows(s).some((a) => accessActive(a, now));
const productIdsOf = (s, now = Date.now()) => new Set(accessRows(s).filter((a) => accessActive(a, now)).map((a) => a.productId));

// points: a ledger (for 7- and 30-day leaderboards) plus the running total on the student
function award(s, n, why, ref = '') {
  if (!s || !n) return;
  T.points.insert({ id: uid(), userId: s.userId, studentId: s.id, n, why, ref, at: Date.now() });
  T.students.update(s.id, (x) => { x.points = Math.max(0, (x.points || 0) + n); });
}
// a student's notification: in the members area, plus an email (and WhatsApp once its template is approved) — at
// most one alert every 30 minutes per student, and never when they've turned alerts off
const ALERT_GAP = 30 * 60000;
function notify(owner, studentId, note) {
  if (!studentId) return;
  const n = T.snotes.insert({ id: uid(), studentId, read: false, at: Date.now(), ...note });
  const s = T.students.get(studentId);
  if (!s || s.alertsOff || s.banned || Date.now() - (s.lastAlertAt || 0) < ALERT_GAP) return;
  T.students.update(s.id, (x) => { x.lastAlertAt = Date.now(); });
  const name = schoolName(owner);
  const link = `${(process.env.APP_URL || '').replace(/\/+$/, '')}/learn/${handleOf(owner)}/${note.link || ''}`;
  const text = `Hi ${first(s.name) || 'there'},\n\n${note.text}.\n\nRead it and reply here:\n${link}\n\nYou get these because you take part in ${name}. Turn them off any time in your profile.\n\n— ${name}`;
  sendEmail(owner, { to: s.email, subject: `${note.text} — ${name}`, text }).catch(() => {});
  const phone = s.phone || T.access.all({ userId: s.userId, ckey: s.ckey }).find((a) => a.phone)?.phone;
  if (phone) waEvent(owner, 'community_reply', { to: phone, params: [first(s.name) || 'there', name, note.text], link, entityId: n.id, ckey: s.ckey }).catch(() => {});
}

// ---------- sessions (one per device; the oldest drops off past the school's device limit) ----------
function startSession(owner, s, device) {
  const token = `S${randomToken().slice(0, 48)}`;
  const limit = Math.max(1, Math.min(10, Number(schoolOf(owner).deviceLimit) || 3));
  tx(() => {
    const live = T.ssessions.all({ studentId: s.id }).filter((x) => x.expiresAt > Date.now()).sort((a, b) => b.lastSeenAt - a.lastSeenAt);
    for (const old of live.slice(limit - 1)) T.ssessions.del(old.id);
    T.ssessions.insert({ id: uid(), studentId: s.id, userId: s.userId, hash: hashToken(token), device: clip(device, 120), at: Date.now(), lastSeenAt: Date.now(), expiresAt: Date.now() + SESSION_DAYS * DAY });
  });
  return token;
}

// ---------- one-time sign-in codes ----------
const codeKey = (userId, ckey) => `${userId}:${ckey}`;
const hashCode = (key, code) => crypto.createHash('sha256').update(`${key}:${code}`).digest('hex');

// ---------- what a student may see ----------
// open: anyone signed in · buyers: anyone with an active purchase · products: buyers of those products
export function canSee(s, space, owned = productIdsOf(s)) {
  if (!space || space.archived) return false;
  if (space.access === 'open') return true;
  if (space.access === 'products') return (space.productIds || []).some((id) => owned.has(id));
  return owned.size > 0;
}
// level gates: a space or a lesson can open only from a community level (earned with points)
const levelOk = (s, min) => levelOf(s?.points || 0) >= (min || 1);
export function lessonGate(s, product, lessonId) {
  const l = product?.lessons?.find((x) => x.id === lessonId);
  return l && !levelOk(s, l.minLevel) ? l.minLevel : 0;
}
const spacesOf = (userId) => T.spaces.all({ userId }, { order: 'at' }).filter((x) => !x.archived).sort((a, b) => (a.order ?? 999) - (b.order ?? 999) || a.at - b.at);
const spaceView = (x, s) => ({ id: x.id, name: x.name, emoji: x.emoji || '💬', description: x.description || '', access: x.access, productIds: x.productIds || [], postBy: x.postBy || 'members', minLevel: x.minLevel || 1, ...(s && !levelOk(s, x.minLevel) ? { locked: true } : {}) });

// an author on a post or comment: a student, or the school itself (the owner / their team)
function authorView(owner, a) {
  if (a.kind === 'owner') return { kind: 'owner', name: a.name || schoolName(owner), initials: initials(a.name || schoolName(owner)), badge: 'Admin', logo: schoolOf(owner).logo || '' };
  const s = T.students.get(a.id);
  if (!s) return { kind: 'student', name: 'Former member', initials: '?' };
  return { kind: 'student', id: s.id, name: s.name || first(s.email.split('@')[0]), initials: initials(s.name || s.email), level: levelOf(s.points || 0) };
}
const likesOf = (target) => q('SELECT COUNT(*) AS n FROM reacts WHERE target = ?').get(target).n;
const repliesOf = (target) => q('SELECT COUNT(*) AS n FROM replies WHERE target = ?').get(target).n;
const likedBy = (target, studentId) => !!studentId && T.reacts.exists({ target, studentId });
function postView(owner, p, me) {
  const t = `post:${p.id}`;
  return { id: p.id, spaceId: p.spaceId, title: p.title || '', body: p.body || '', images: p.images || [], pinned: !!p.pinned, at: p.at, editedAt: p.editedAt || null, author: authorView(owner, p.author), likes: likesOf(t), liked: likedBy(t, me?.id), comments: repliesOf(t), mine: !!me && p.author.kind === 'student' && p.author.id === me.id };
}
function replyView(owner, r, me) {
  const t = `reply:${r.id}`;
  return { id: r.id, parentId: r.parentId || null, body: r.body, at: r.at, author: authorView(owner, r.author), likes: likesOf(t), liked: likedBy(t, me?.id), mine: !!me && r.author.kind === 'student' && r.author.id === me.id };
}

// ---------- leaderboard ----------
function leaderboard(owner, days, me) {
  const since = days ? Date.now() - days * DAY : 0;
  const rows = days
    ? q('SELECT studentId, SUM(json_extract(data, \'$.n\')) AS n FROM points WHERE userId = ? AND at >= ? GROUP BY studentId HAVING n > 0 ORDER BY n DESC LIMIT 10').all(owner.id, since)
    : q('SELECT id AS studentId, json_extract(data, \'$.points\') AS n FROM students WHERE userId = ? AND json_extract(data, \'$.points\') > 0 ORDER BY n DESC LIMIT 10').all(owner.id);
  const top = rows.map((r, i) => ({ rank: i + 1, points: r.n, ...authorView(owner, { kind: 'student', id: r.studentId }) }));
  return { days, top, me: me ? { points: me.points || 0, ...levelView(owner, me.points || 0) } : null };
}

// ---------- certificates ----------
// finished = every lesson done and every quiz passed
export function courseComplete(product, access) {
  const lessons = product.lessons || [];
  return lessons.length > 0 && lessons.every((l) => access.progress?.[l.id] && (!l.quiz || access.quiz?.[l.id]?.passed));
}
function issueCert(owner, s, product) {
  const have = T.certs.find({ studentId: s.id, productId: product.id });
  if (have) return have;
  const c = T.certs.insert({ id: crypto.randomBytes(8).toString('hex'), userId: owner.id, studentId: s.id, productId: product.id, name: s.name || s.email, course: product.name, title: product.certificate?.title || '', signer: product.certificate?.signer || '', signerRole: product.certificate?.signerRole || '', school: schoolName(owner), at: Date.now() });
  award(s, 10, 'course', product.id);
  return c;
}
const certView = (c) => ({ id: c.id, name: c.name, course: c.course, title: c.title || 'Certificate of completion', signer: c.signer, signerRole: c.signerRole, school: c.school, at: c.at });

// ---------- routes ----------
export function registerSchool(app, { auth, wrap, rateLimit, isTest, appUrl, credits = () => (req, res, next) => next() }) {
  const limiter = rateLimit({ windowMs: 60000, max: isTest ? 5000 : 120 });
  const codeLimiter = rateLimit({ windowMs: 15 * 60000, max: isTest ? 1000 : 6, message: 'Too many codes — wait a few minutes and try again.', shared: true, name: 'school-code' });
  const writeLimiter = rateLimit({ windowMs: 60000, max: isTest ? 1000 : 20, message: 'You’re posting quickly — wait a moment.' });
  const tutorLimiter = rateLimit({ windowMs: 60000, max: isTest ? 1000 : 6, message: 'Give the tutor a moment — try again shortly.' });
  const sellerByHandle = (h) => { const r = q("SELECT id FROM users WHERE json_extract(data, '$.bookingHandle') = ?").get(String(h || '').toLowerCase()); return r && T.users.get(r.id); };
  const school = (req, res) => { const u = sellerByHandle(req.params.handle); if (!u) { res.status(404).json({ error: 'This school doesn’t exist' }); return null; } return u; };
  // the signed-in student (header X-Student: <session token>)
  const student = (req, res, owner, { quiet = false } = {}) => {
    const t = String(req.headers['x-student'] || '');
    const sess = /^S[0-9a-f]{48}$/.test(t) && T.ssessions.find({ hash: hashToken(t) });
    const s = sess && sess.expiresAt > Date.now() && T.students.get(sess.studentId);
    if (!s || s.userId !== owner.id || s.banned) { if (!quiet) res.status(401).json({ error: s?.banned ? 'Your access to this community has been removed' : 'Please sign in again', signin: true }); return null; }
    if (Date.now() - (sess.lastSeenAt || 0) > 5 * 60000) { T.ssessions.update(sess.id, (x) => { x.lastSeenAt = Date.now(); }); T.students.update(s.id, (x) => { x.lastSeenAt = Date.now(); }); }
    return s;
  };
  const meView = (owner, s) => ({ id: s.id, email: s.email, name: s.name, bio: s.bio || '', alerts: !s.alertsOff, initials: initials(s.name || s.email), ...levelView(owner, s.points || 0) });
  const publicSchool = (owner) => {
    const sc = schoolOf(owner);
    return { name: schoolName(owner), tagline: sc.tagline, logo: sc.logo, cover: sc.cover, color: sc.color || owner.settings?.brandColor || '#6366f1', openJoin: !!sc.openJoin, tutor: !!sc.tutor && aiEnabled(), levels: sc.levels, levelPoints: LEVELS, welcome: sc.welcome };
  };

  // --- public: the school's front door ---
  app.get('/api/learn/:handle', limiter, (req, res) => {
    const owner = school(req, res); if (!owner) return;
    const s = student(req, res, owner, { quiet: true });
    res.set('Cache-Control', 'no-store').json({ school: publicSchool(owner), me: s ? meView(owner, s) : null });
  });
  // the installable app (add to home screen): the school's name, colour and icon
  app.get('/api/learn/:handle/manifest.webmanifest', limiter, (req, res) => {
    const owner = school(req, res); if (!owner) return;
    const sc = publicSchool(owner), h = req.params.handle, icon = `/api/learn/${h}/icon.svg`;
    const short = sc.name.length > 12 ? sc.name.split(/\s+/)[0].slice(0, 12) : sc.name;
    res.set('Cache-Control', 'public, max-age=600').type('application/manifest+json').send(JSON.stringify({
      name: sc.name, short_name: short, description: sc.tagline || `Courses and community — ${sc.name}`,
      id: `/learn/${h}`, start_url: `/learn/${h}`, scope: `/learn/${h}`, display: 'standalone', orientation: 'portrait', background_color: '#f6f6fa', theme_color: sc.color,
      icons: [...(sc.logo ? [{ src: sc.logo, sizes: 'any', purpose: 'any' }] : []), { src: icon, sizes: 'any', type: 'image/svg+xml', purpose: 'any' }, { src: `${icon}?m=1`, sizes: 'any', type: 'image/svg+xml', purpose: 'maskable' }],
    }));
  });
  app.get('/api/learn/:handle/icon.svg', limiter, (req, res) => {
    const owner = school(req, res); if (!owner) return;
    const sc = publicSchool(owner);
    const letter = (sc.name.trim()[0] || 'S').toUpperCase().replace(/[<>&"']/g, '');
    const color = /^#[0-9a-f]{6}$/i.test(sc.color) ? sc.color : '#6366f1';
    const r = req.query.m ? 0 : 112; // maskable icons fill the whole square
    res.set('Cache-Control', 'public, max-age=600').type('image/svg+xml').send(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" rx="${r}" fill="${color}"/><text x="256" y="256" dy=".35em" text-anchor="middle" font-family="system-ui, -apple-system, Segoe UI, Roboto, sans-serif" font-size="260" font-weight="800" fill="#fff">${letter}</text></svg>`);
  });
  // a sign-in code by email — only to people who belong (bought, signed up, or the school is open to all)
  app.post('/api/learn/:handle/code', codeLimiter, wrap(async (req, res) => {
    const owner = school(req, res); if (!owner) return;
    const email = clip(req.body?.email, 200).toLowerCase();
    if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'Enter a valid email address' });
    const ckey = studentKey(email);
    const known = T.students.exists({ userId: owner.id, ckey }) || T.access.exists({ userId: owner.id, ckey });
    if (!known && !schoolOf(owner).openJoin) return res.status(404).json({ error: 'We couldn’t find a purchase with this email. Use the email you bought with, or contact the seller.', notMember: true });
    const code = String(crypto.randomInt(100000, 1000000));
    const key = codeKey(owner.id, ckey);
    tx(() => { T.scodes.delWhere({ key }); T.scodes.insert({ id: uid(), key, hash: hashCode(key, code), tries: 0, expiresAt: Date.now() + CODE_MIN * 60000 }); });
    const name = schoolName(owner);
    // sent in the background: the page asks for the code straight away
    sendEmail(owner, { to: email, subject: `${code} is your sign-in code for ${name}`, text: `Your code to sign in to ${name}:\n\n${code}\n\nIt works for ${CODE_MIN} minutes. If you didn’t ask for it, you can ignore this email.` }).catch((e) => console.error('school code email failed', e.message));
    res.json({ ok: true, ...(isTest ? { code } : {}) });
  }));
  app.post('/api/learn/:handle/login', codeLimiter, (req, res) => {
    const owner = school(req, res); if (!owner) return;
    const email = clip(req.body?.email, 200).toLowerCase();
    const ckey = studentKey(email), key = codeKey(owner.id, ckey);
    const row = ckey && T.scodes.find({ key });
    const bad = () => res.status(400).json({ error: 'That code isn’t right — check the latest email, or ask for a new code' });
    if (!row || row.expiresAt < Date.now() || row.tries >= 5) return bad();
    if (row.hash !== hashCode(key, String(req.body?.code || '').trim())) { T.scodes.update(row.id, (x) => { x.tries = (x.tries || 0) + 1; }); return bad(); }
    T.scodes.del(row.id);
    const s = ensureStudent(owner.id, { email, name: req.body?.name });
    if (!s) return bad();
    if (s.banned) return res.status(403).json({ error: 'Your access to this community has been removed' });
    res.json({ token: startSession(owner, s, req.headers['user-agent']), me: meView(owner, s) });
  });
  // the emailed library link signs you straight in
  app.post('/api/learn/:handle/link', codeLimiter, (req, res) => {
    const owner = school(req, res); if (!owner) return;
    const t = String(req.body?.token || '');
    const p = /^L[0-9a-f]{40}$/.test(t) && T.portals.find({ tokenHash: hashToken(t) });
    if (!p || p.userId !== owner.id) return res.status(400).json({ error: 'This link has expired — sign in with your email instead' });
    const email = T.access.find({ userId: owner.id, ckey: p.ckey })?.email || p.ckey;
    const s = ensureStudent(owner.id, { email });
    if (!s || s.banned) return res.status(403).json({ error: 'Your access to this community has been removed' });
    res.json({ token: startSession(owner, s, req.headers['user-agent']), me: meView(owner, s) });
  });
  app.post('/api/learn/:handle/logout', limiter, (req, res) => {
    const t = String(req.headers['x-student'] || '');
    if (/^S[0-9a-f]{48}$/.test(t)) T.ssessions.delWhere({ hash: hashToken(t) });
    res.json({ ok: true });
  });

  // --- the student: home, profile, notifications ---
  app.get('/api/learn/:handle/home', limiter, (req, res) => {
    const owner = school(req, res); if (!owner) return;
    const s = student(req, res, owner); if (!s) return;
    const lib = studentLibrary(owner.id, s.ckey);
    const owned = productIdsOf(s);
    const spaces = spacesOf(owner.id).filter((x) => canSee(s, x, owned)).map((x) => spaceView(x, s));
    const visible = new Set(spaces.filter((x) => !x.locked).map((x) => x.id));
    // lessons above the student's level show as locked (title only)
    for (const c of lib.products) {
      const prod = T.products.get(c.productId);
      if (c.lessons) c.lessons = c.lessons.map((l) => { const need = lessonGate(s, prod, l.id); return need ? { id: l.id, title: l.title, section: l.section, locked: true, needLevel: need } : l; });
    }
    const recent = T.posts.all({ userId: owner.id }, { order: 'at', desc: true, limit: 40 }).filter((p) => visible.has(p.spaceId) && !p.hidden).slice(0, 5).map((p) => postView(owner, p, s));
    const unread = q('SELECT COUNT(*) AS n FROM snotes WHERE studentId = ? AND read = 0').get(s.id).n;
    const certs = T.certs.all({ studentId: s.id }).map(certView);
    res.set('Cache-Control', 'no-store').json({ me: meView(owner, s), courses: lib.products, plans: lib.plans, spaces, recent, leaderboard: leaderboard(owner, 30, s), unread, certs, seller: lib.seller });
  });
  app.put('/api/learn/:handle/me', writeLimiter, (req, res) => {
    const owner = school(req, res); if (!owner) return;
    const s = student(req, res, owner); if (!s) return;
    const n = T.students.update(s.id, (x) => { if ('name' in req.body) x.name = clip(req.body.name, 80); if ('bio' in req.body) x.bio = clip(req.body.bio, 300); if ('alerts' in req.body) x.alertsOff = !req.body.alerts; });
    res.json(meView(owner, n));
  });
  app.get('/api/learn/:handle/notifications', limiter, (req, res) => {
    const owner = school(req, res); if (!owner) return;
    const s = student(req, res, owner); if (!s) return;
    const list = T.snotes.all({ studentId: s.id }, { order: 'at', desc: true, limit: 30 });
    if (req.query.read === '1') q('UPDATE snotes SET read = 1, data = json_set(data, \'$.read\', json(\'true\')) WHERE studentId = ? AND read = 0').run(s.id);
    res.json(list.map(({ studentId, ...n }) => n));
  });

  // --- courses: progress, resume, quizzes, questions under a lesson, certificates ---
  const ownAccess = (s, accessId) => { const a = T.access.get(accessId); return a && a.userId === s.userId && contactKey(a.email) === s.ckey && accessActive(a) ? a : null; };
  app.post('/api/learn/:handle/progress', limiter, (req, res) => {
    const owner = school(req, res); if (!owner) return;
    const s = student(req, res, owner); if (!s) return;
    const a = ownAccess(s, req.body?.accessId);
    const p = a && T.products.get(a.productId);
    const lesson = p?.lessons.find((l) => l.id === req.body.lessonId);
    if (!lesson) return res.status(404).json({ error: 'Lesson not found' });
    if (lessonGate(s, p, lesson.id)) return res.status(403).json({ error: `Reach level ${lesson.minLevel} to unlock this lesson` });
    let firstTime = false;
    const n = T.access.update(a.id, (x) => {
      x.progress ||= {};
      if (req.body.done === false) delete x.progress[lesson.id];
      else if (req.body.done === true && !x.progress[lesson.id]) { x.progress[lesson.id] = Date.now(); firstTime = true; }
      // where they left off: this lesson (and the video position)
      x.resume = { lessonId: lesson.id, t: Math.max(0, Math.round(Number(req.body.t) || 0)), at: Date.now() };
      x.lastSeenAt = Date.now();
    });
    if (firstTime) award(s, 1, 'lesson', `${p.id}:${lesson.id}`);
    const cert = p.certificate?.enabled && courseComplete(p, n) ? certView(issueCert(owner, T.students.get(s.id), p)) : null;
    res.json({ ok: true, complete: courseComplete(p, n), cert });
  });
  app.post('/api/learn/:handle/quiz', limiter, (req, res) => {
    const owner = school(req, res); if (!owner) return;
    const s = student(req, res, owner); if (!s) return;
    const a = ownAccess(s, req.body?.accessId);
    const p = a && T.products.get(a.productId);
    const lesson = p?.lessons.find((l) => l.id === req.body.lessonId);
    if (!lesson?.quiz) return res.status(404).json({ error: 'Quiz not found' });
    if (lessonGate(s, p, lesson.id)) return res.status(403).json({ error: `Reach level ${lesson.minLevel} to unlock this lesson` });
    const answers = Array.isArray(req.body.answers) ? req.body.answers : [];
    const results = lesson.quiz.questions.map((x, i) => ({ correct: Number(answers[i]) === x.answer, answer: x.answer, explain: x.explain }));
    const score = Math.round((results.filter((r) => r.correct).length / results.length) * 100);
    const passed = score >= lesson.quiz.pass;
    let firstPass = false;
    const n = T.access.update(a.id, (x) => {
      x.quiz ||= {};
      const prev = x.quiz[lesson.id];
      if (passed && !prev?.passed) firstPass = true;
      x.quiz[lesson.id] = { score: Math.max(score, prev?.score || 0), passed: passed || !!prev?.passed, tries: (prev?.tries || 0) + 1, at: Date.now() };
      if (passed) { x.progress ||= {}; x.progress[lesson.id] ||= Date.now(); }
    });
    if (firstPass) award(s, 2, 'quiz', `${p.id}:${lesson.id}`);
    const cert = p.certificate?.enabled && courseComplete(p, n) ? certView(issueCert(owner, T.students.get(s.id), p)) : null;
    res.json({ score, passed, pass: lesson.quiz.pass, results, cert });
  });
  // a protected lesson video: a signed link for this student (the player shows their email over it)
  app.post('/api/learn/:handle/video', limiter, (req, res) => {
    const owner = school(req, res); if (!owner) return;
    const s = student(req, res, owner); if (!s) return;
    const a = ownAccess(s, req.body?.accessId);
    const p = a && T.products.get(a.productId);
    const lesson = p?.lessons.find((l) => l.videoFileId === req.body?.fileId);
    const f = lesson && p.files.find((x) => x.id === lesson.videoFileId);
    if (!f || a.at + (lesson.dripDays || 0) * DAY > Date.now()) return res.status(404).json({ error: 'Video not found' });
    if (lessonGate(s, p, lesson.id)) return res.status(403).json({ error: `Reach level ${lesson.minLevel} to unlock this lesson` });
    if (f.hls?.status !== 'ready') return res.status(409).json({ error: 'This video is still being prepared — try again in a few minutes' });
    res.set('Cache-Control', 'no-store').json({ src: `/api/hls/${a.id}/${f.id}/master.m3u8?t=${encodeURIComponent(ticket(a.id, f.id, s.id))}`, mark: s.email });
  });
  app.get('/api/learn/:handle/certificate/:pid', limiter, (req, res) => {
    const owner = school(req, res); if (!owner) return;
    const s = student(req, res, owner); if (!s) return;
    const p = T.products.get(req.params.pid);
    const a = p && accessRows(s).find((x) => x.productId === p.id && accessActive(x));
    if (!a || !p.certificate?.enabled) return res.status(404).json({ error: 'No certificate for this course' });
    if (!courseComplete(p, a)) return res.status(400).json({ error: 'Finish every lesson (and pass the quizzes) to get your certificate' });
    res.json(certView(issueCert(owner, s, p)));
  });
  // lesson questions: a thread under each lesson, visible to everyone in the course
  const lessonTarget = (pid, lid) => `lesson:${pid}:${lid}`;
  const inCourse = (s, pid) => accessRows(s).some((a) => a.productId === pid && accessActive(a));
  app.get('/api/learn/:handle/lesson/:pid/:lid/comments', limiter, (req, res) => {
    const owner = school(req, res); if (!owner) return;
    const s = student(req, res, owner); if (!s) return;
    if (!inCourse(s, req.params.pid)) return res.status(404).json({ error: 'Course not found' });
    res.json(T.replies.all({ target: lessonTarget(req.params.pid, req.params.lid) }, { order: 'at' }).filter((r) => !r.hidden).map((r) => replyView(owner, r, s)));
  });
  app.post('/api/learn/:handle/lesson/:pid/:lid/comments', writeLimiter, (req, res) => {
    const owner = school(req, res); if (!owner) return;
    const s = student(req, res, owner); if (!s) return;
    const p = T.products.get(req.params.pid);
    if (!p || p.userId !== owner.id || !inCourse(s, p.id) || !p.lessons.some((l) => l.id === req.params.lid)) return res.status(404).json({ error: 'Lesson not found' });
    const body = clip(req.body?.body, 3000);
    if (!body) return res.status(400).json({ error: 'Write something first' });
    const target = lessonTarget(p.id, req.params.lid);
    const parent = req.body?.parentId && T.replies.get(req.body.parentId);
    const r = T.replies.insert({ id: uid(), userId: owner.id, target, parentId: parent?.target === target ? parent.id : null, body, author: { kind: 'student', id: s.id }, at: Date.now() });
    if (parent?.author?.kind === 'student' && parent.author.id !== s.id) notify(owner, parent.author.id, { kind: 'reply', text: `${s.name || 'Someone'} replied to your question`, link: `course/${p.id}/${req.params.lid}` });
    res.json(replyView(owner, r, s));
  });

  // --- the AI tutor: answers from this course's own lessons (the seller's AI credits; a daily cap per student) ---
  app.post('/api/learn/:handle/tutor', tutorLimiter, wrap(async (req, res) => {
    const owner = school(req, res); if (!owner) return;
    const s = student(req, res, owner); if (!s) return;
    if (!schoolOf(owner).tutor || !aiEnabled()) return res.status(404).json({ error: 'The AI tutor isn’t switched on for this school' });
    const p = T.products.get(req.body?.productId);
    if (!p || !inCourse(s, p.id)) return res.status(404).json({ error: 'Course not found' });
    const question = clip(req.body?.question, 1000);
    if (question.length < 3) return res.status(400).json({ error: 'Ask a question' });
    const today = q("SELECT COUNT(*) AS n FROM points WHERE studentId = ? AND json_extract(data, '$.why') = 'tutor' AND at >= ?").get(s.id, Date.now() - DAY).n;
    if (today >= 30) return res.status(429).json({ error: 'You’ve asked the tutor 30 questions today — it’s back tomorrow' });
    if (creditsShort(owner, 1)) return res.status(503).json({ error: 'The tutor is resting right now — ask your question under the lesson instead' });
    const lesson = p.lessons.find((l) => l.id === req.body?.lessonId);
    const outline = p.lessons.map((l, i) => `${i + 1}. ${l.title}`).join('\n');
    const material = [lesson && `CURRENT LESSON: ${lesson.title}\n${lesson.body || ''}`, ...p.lessons.filter((l) => l !== lesson && l.body).map((l) => `LESSON: ${l.title}\n${l.body}`)].filter(Boolean).join('\n\n').slice(0, 24000);
    const system = `You are the friendly tutor for the course "${p.name}" by ${schoolName(owner)}. Answer the student's question using the course material below. If the material doesn't cover it, say so briefly and suggest asking under the lesson so the instructor can answer — never invent facts about the course, prices or the instructor. Keep answers short, clear and encouraging; use simple English (or the student's language if they write in Hindi/Hinglish). No medical, legal or financial guarantees.\n\nCOURSE OUTLINE:\n${outline}\n\nCOURSE MATERIAL:\n${material}`;
    const history = (Array.isArray(req.body.history) ? req.body.history : []).slice(-6).map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: clip(m.content, 2000) }));
    let answer;
    try { answer = await aiText(system, question, history); } catch (e) { return res.status(502).json({ error: 'The tutor couldn’t answer just now — try again in a moment' }); }
    spendCredits(owner, 1);
    T.points.insert({ id: uid(), userId: owner.id, studentId: s.id, n: 0, why: 'tutor', ref: p.id, at: Date.now() }); // counts towards the daily cap
    res.json({ answer: String(answer || '').trim().slice(0, 4000) });
  }));

  // --- community: spaces, posts, comments, likes ---
  const ownSpace = (owner, s, id) => { const x = T.spaces.get(id); return x && x.userId === owner.id && canSee(s, x) && levelOk(s, x.minLevel) ? x : null; };
  app.get('/api/learn/:handle/spaces/:sid/posts', limiter, (req, res) => {
    const owner = school(req, res); if (!owner) return;
    const s = student(req, res, owner); if (!s) return;
    const sp = ownSpace(owner, s, req.params.sid);
    if (!sp) { const x = T.spaces.get(req.params.sid); return x && x.userId === owner.id && canSee(s, x) ? res.status(403).json({ error: `Reach level ${x.minLevel} to unlock this space`, needLevel: x.minLevel }) : res.status(404).json({ error: 'Space not found' }); }
    const before = Number(req.query.before) || Infinity;
    const all = T.posts.all({ spaceId: sp.id }, { order: 'at', desc: true }).filter((p) => !p.hidden);
    const pinned = before === Infinity ? all.filter((p) => p.pinned) : [];
    const page = all.filter((p) => !p.pinned && p.at < before).slice(0, 20);
    res.json({ space: spaceView(sp, s), posts: [...pinned, ...page].map((p) => postView(owner, p, s)), more: all.filter((p) => !p.pinned && p.at < before).length > 20 });
  });
  app.post('/api/learn/:handle/spaces/:sid/posts', writeLimiter, (req, res) => {
    const owner = school(req, res); if (!owner) return;
    const s = student(req, res, owner); if (!s) return;
    const sp = ownSpace(owner, s, req.params.sid);
    if (!sp) return res.status(404).json({ error: 'Space not found' });
    if (sp.postBy === 'admins') return res.status(403).json({ error: 'Only the team posts in this space — reply in the comments' });
    const title = clip(req.body?.title, 200), body = clip(req.body?.body, 10000);
    if (!title && !body) return res.status(400).json({ error: 'Write something first' });
    const p = T.posts.insert({ id: uid(), userId: owner.id, spaceId: sp.id, title, body, images: [], author: { kind: 'student', id: s.id }, pinned: false, at: Date.now() });
    res.json(postView(owner, p, s));
  });
  const ownPost = (owner, s, id) => { const p = T.posts.get(id); return p && p.userId === owner.id && !p.hidden && ownSpace(owner, s, p.spaceId) ? p : null; };
  app.get('/api/learn/:handle/posts/:id', limiter, (req, res) => {
    const owner = school(req, res); if (!owner) return;
    const s = student(req, res, owner); if (!s) return;
    const p = ownPost(owner, s, req.params.id);
    if (!p) return res.status(404).json({ error: 'Post not found' });
    res.json({ post: postView(owner, p, s), comments: T.replies.all({ target: `post:${p.id}` }, { order: 'at' }).filter((r) => !r.hidden).map((r) => replyView(owner, r, s)) });
  });
  app.put('/api/learn/:handle/posts/:id', writeLimiter, (req, res) => {
    const owner = school(req, res); if (!owner) return;
    const s = student(req, res, owner); if (!s) return;
    const p = ownPost(owner, s, req.params.id);
    if (!p || p.author.kind !== 'student' || p.author.id !== s.id) return res.status(404).json({ error: 'Post not found' });
    const n = T.posts.update(p.id, (x) => { if ('title' in req.body) x.title = clip(req.body.title, 200); if ('body' in req.body) x.body = clip(req.body.body, 10000); x.editedAt = Date.now(); });
    res.json(postView(owner, n, s));
  });
  app.delete('/api/learn/:handle/posts/:id', writeLimiter, (req, res) => {
    const owner = school(req, res); if (!owner) return;
    const s = student(req, res, owner); if (!s) return;
    const p = ownPost(owner, s, req.params.id);
    if (!p || p.author.kind !== 'student' || p.author.id !== s.id) return res.status(404).json({ error: 'Post not found' });
    removePost(p);
    res.json({ ok: true });
  });
  app.post('/api/learn/:handle/posts/:id/comments', writeLimiter, (req, res) => {
    const owner = school(req, res); if (!owner) return;
    const s = student(req, res, owner); if (!s) return;
    const p = ownPost(owner, s, req.params.id);
    if (!p) return res.status(404).json({ error: 'Post not found' });
    const body = clip(req.body?.body, 3000);
    if (!body) return res.status(400).json({ error: 'Write something first' });
    const parent = req.body?.parentId && T.replies.get(req.body.parentId);
    const r = T.replies.insert({ id: uid(), userId: owner.id, target: `post:${p.id}`, parentId: parent?.target === `post:${p.id}` ? parent.id : null, body, author: { kind: 'student', id: s.id }, at: Date.now() });
    const who = s.name || 'Someone';
    if (p.author.kind === 'student' && p.author.id !== s.id) notify(owner, p.author.id, { kind: 'comment', text: `${who} commented on your post`, link: `post/${p.id}` });
    if (parent?.author?.kind === 'student' && parent.author.id !== s.id && parent.author.id !== p.author.id) notify(owner, parent.author.id, { kind: 'reply', text: `${who} replied to your comment`, link: `post/${p.id}` });
    res.json(replyView(owner, r, s));
  });
  app.delete('/api/learn/:handle/comments/:id', writeLimiter, (req, res) => {
    const owner = school(req, res); if (!owner) return;
    const s = student(req, res, owner); if (!s) return;
    const r = T.replies.get(req.params.id);
    if (!r || r.userId !== owner.id || r.author.kind !== 'student' || r.author.id !== s.id) return res.status(404).json({ error: 'Comment not found' });
    T.replies.del(r.id); T.reacts.delWhere({ target: `reply:${r.id}` });
    res.json({ ok: true });
  });
  // like / unlike a post or comment: the author gets a point (never for liking your own)
  app.post('/api/learn/:handle/like', writeLimiter, (req, res) => {
    const owner = school(req, res); if (!owner) return;
    const s = student(req, res, owner); if (!s) return;
    const [kind, id] = String(req.body?.target || '').split(':');
    const item = kind === 'post' ? ownPost(owner, s, id) : kind === 'reply' ? T.replies.get(id) : null;
    if (!item || item.userId !== owner.id) return res.status(404).json({ error: 'Not found' });
    const target = `${kind}:${id}`;
    const author = item.author?.kind === 'student' && item.author.id !== s.id ? T.students.get(item.author.id) : null;
    const on = req.body?.on !== false;
    const had = T.reacts.exists({ target, studentId: s.id });
    if (on && !had) { try { T.reacts.insert({ id: uid(), target, studentId: s.id, at: Date.now() }); award(author, 1, 'like', target); } catch {} }
    if (!on && had) { T.reacts.delWhere({ target, studentId: s.id }); award(author, -1, 'unlike', target); }
    res.json({ likes: likesOf(target), liked: on });
  });
  app.get('/api/learn/:handle/leaderboard', limiter, (req, res) => {
    const owner = school(req, res); if (!owner) return;
    const s = student(req, res, owner); if (!s) return;
    const days = [7, 30].includes(Number(req.query.days)) ? Number(req.query.days) : 0;
    res.json({ ...leaderboard(owner, days, s), levels: schoolOf(owner).levels, levelPoints: LEVELS });
  });

  // --- public: anyone can check a certificate is genuine ---
  app.get('/api/cert/:id', limiter, (req, res) => {
    const c = /^[0-9a-f]{16}$/.test(req.params.id) && T.certs.get(req.params.id);
    if (!c) return res.status(404).json({ error: 'No certificate with this number' });
    res.set('Cache-Control', 'public, max-age=300').json(certView(c));
  });

  // --- AI: a whole course from a topic, and quizzes for a lesson ---
  const COURSE_SYSTEM = `You write online courses for Indian coaches, trainers and creators. Reply with ONLY JSON:
{"name": "course name", "description": "one line", "lessons": [{"section": "module name", "title": "lesson title", "body": "the lesson itself: 150-400 words of real teaching — explanations, steps, examples, an exercise; plain text with line breaks, no markdown headings", "quiz": {"pass": 70, "questions": [{"q": "question", "options": ["a", "b", "c", "d"], "answer": 0, "explain": "why"}]}}]}
Rules: modules (sections) in a sensible order, 3-6 lessons each; add a quiz (3-5 questions, the answer index into options) to the last lesson of each module only; practical, specific, accurate; Indian context and examples unless the topic is elsewhere; never promise income, cures or guaranteed results; write in the language asked for.`;
  app.post('/api/ai/course', auth, rateLimit({ windowMs: 60000, max: isTest ? 100 : 3, key: (req) => req.user.id, message: 'Give it a minute before the next course.' }), credits('generate'), wrap(async (req, res) => {
    if (!aiEnabled()) return res.status(503).json({ error: 'AI isn’t switched on for this server yet' });
    const topic = clip(req.body?.topic, 500);
    if (topic.length < 4) return res.status(400).json({ error: 'Describe what the course should teach' });
    const n = Math.max(3, Math.min(30, Math.round(Number(req.body?.lessons) || 10)));
    const brief = `Topic: ${topic}\nFor: ${clip(req.body?.audience, 300) || 'beginners'}\nLevel: ${clip(req.body?.level, 40) || 'beginner'}\nAbout ${n} lessons.\nLanguage: ${clip(req.body?.language, 30) || 'English'}${req.body?.notes ? `\nThe creator's notes / outline to follow:\n${clip(req.body.notes, 6000)}` : ''}`;
    let out;
    try { out = await aiJson(COURSE_SYSTEM, brief); } catch (e) { return res.status(502).json({ error: 'The AI couldn’t write the course just now — please try again' }); }
    const lessons = (Array.isArray(out?.lessons) ? out.lessons : []).slice(0, 60).map((l) => ({ title: clip(l?.title, 160), section: clip(l?.section, 80), body: clip(l?.body, 20000), ...(cleanQuiz(l?.quiz) ? { quiz: cleanQuiz(l.quiz) } : {}) })).filter((l) => l.title);
    if (!lessons.length) return res.status(502).json({ error: 'The AI returned an empty course — please try again' });
    res.json({ name: clip(out.name, 120) || topic.slice(0, 120), description: clip(out.description, 300), lessons });
  }));
  app.post('/api/ai/quiz', auth, rateLimit({ windowMs: 60000, max: isTest ? 100 : 10, key: (req) => req.user.id }), credits('edit'), wrap(async (req, res) => {
    if (!aiEnabled()) return res.status(503).json({ error: 'AI isn’t switched on for this server yet' });
    const text = clip(req.body?.text, 20000), title = clip(req.body?.title, 160);
    if (text.length < 40) return res.status(400).json({ error: 'Write the lesson first — the quiz is made from it' });
    const count = Math.max(2, Math.min(10, Math.round(Number(req.body?.count) || 4)));
    let out;
    try { out = await aiJson(`You write fair multiple-choice quizzes that check a student understood a lesson. Reply with ONLY JSON: {"questions": [{"q": "question", "options": ["a", "b", "c", "d"], "answer": 0, "explain": "one line why"}]}. ${count} questions, 3-4 options each, one clearly right answer (its index in options), drawn ONLY from the lesson text; same language as the lesson.`, `Lesson: ${title}\n\n${text}`); } catch (e) { return res.status(502).json({ error: 'The AI couldn’t write the quiz just now — please try again' }); }
    const quiz = cleanQuiz({ pass: 70, questions: out?.questions });
    if (!quiz) return res.status(502).json({ error: 'The AI returned no usable questions — please try again' });
    res.json(quiz);
  }));

  // ---------- the seller: settings, spaces, posting as the school, moderation, students ----------
  const ownerAuthor = (req) => ({ kind: 'owner', name: '' }); // shown as the school's name
  app.get('/api/school', auth, (req, res) => {
    const u = req.user;
    const handle = handleOf(u);
    const spaces = T.spaces.all({ userId: u.id }, { order: 'at' }).filter((x) => !x.archived).sort((a, b) => (a.order ?? 999) - (b.order ?? 999) || a.at - b.at)
      .map((x) => ({ ...spaceView(x), posts: T.posts.count({ spaceId: x.id }) }));
    const courses = T.products.all({ userId: u.id }, { order: 'at', desc: true }).filter((p) => p.lessons?.length).map((p) => ({ id: p.id, name: p.name, lessons: p.lessons.length, quizzes: p.lessons.filter((l) => l.quiz).length, certificate: !!p.certificate?.enabled, students: q('SELECT COUNT(DISTINCT ckey) AS n FROM access WHERE userId = ? AND json_extract(data, \'$.productId\') = ?').get(u.id, p.id).n }));
    res.json({
      settings: schoolOf(u), handle, url: `${(process.env.APP_URL || appUrl(req)).replace(/\/+$/, '')}/learn/${handle}`, aiEnabled: aiEnabled(),
      // the same members area on the seller's own connected domains
      domainUrls: T.domains.all({ userId: u.id, status: 'active' }).map((d) => `https://${d.domain}/learn/${handle}`),
      stats: { students: T.students.count({ userId: u.id }), active7: q('SELECT COUNT(*) AS n FROM students WHERE userId = ? AND json_extract(data, \'$.lastSeenAt\') > ?').get(u.id, Date.now() - 7 * DAY).n, posts: T.posts.count({ userId: u.id }), certificates: T.certs.count({ userId: u.id }) },
      spaces, courses,
    });
  });
  app.put('/api/school/settings', auth, (req, res) => {
    const b = req.body || {}, cur = schoolOf(req.user), out = { ...cur };
    for (const [k, n] of [['name', 80], ['tagline', 200], ['welcome', 2000]]) if (k in b) out[k] = clip(b[k], n);
    for (const k of ['logo', 'cover']) if (k in b) { const v = clip(b[k], 500); out[k] = /^(https:\/\/|\/uploads\/)[^\s"'<>]*$/.test(v) ? v : ''; }
    if ('color' in b) out.color = /^#[0-9a-f]{6}$/i.test(b.color || '') ? b.color : '';
    if ('openJoin' in b) out.openJoin = !!b.openJoin;
    if ('tutor' in b) out.tutor = !!b.tutor;
    if ('deviceLimit' in b) out.deviceLimit = Math.max(1, Math.min(10, Math.round(Number(b.deviceLimit)) || 3));
    if (Array.isArray(b.levels)) out.levels = SCHOOL_DEFAULTS.levels.map((d, i) => clip(b.levels[i], 30) || d);
    const u = T.users.update(req.user.id, (x) => { x.settings = { ...x.settings, school: out }; });
    res.json(schoolOf(u));
  });
  const cleanSpace = (b, cur = {}) => {
    const out = { ...cur };
    if ('name' in b || !cur.id) { out.name = clip(b.name, 60); if (!out.name) return { error: 'Give the space a name' }; }
    if ('emoji' in b) out.emoji = clip(b.emoji, 4) || '💬';
    if ('description' in b) out.description = clip(b.description, 300);
    if ('access' in b || !cur.id) out.access = ['open', 'buyers', 'products'].includes(b.access) ? b.access : 'buyers';
    if ('productIds' in b) out.productIds = (Array.isArray(b.productIds) ? b.productIds : []).map(String).filter((id) => T.products.get(id)?.userId === cur.userId).slice(0, 30);
    if ('postBy' in b || !cur.id) out.postBy = b.postBy === 'admins' ? 'admins' : 'members';
    if ('minLevel' in b) out.minLevel = Math.max(1, Math.min(9, Math.round(Number(b.minLevel)) || 1));
    if ('order' in b) out.order = Math.round(Number(b.order)) || 0;
    return out;
  };
  const mySpace = (req, res) => { const x = T.spaces.get(req.params.sid); if (!x || x.userId !== req.user.id) { res.status(404).json({ error: 'Space not found' }); return null; } return x; };
  app.post('/api/school/spaces', auth, (req, res) => {
    if (T.spaces.count({ userId: req.user.id }) >= 30) return res.status(400).json({ error: 'You can have up to 30 spaces' });
    const x = cleanSpace(req.body || {}, { userId: req.user.id });
    if (x.error) return res.status(400).json(x);
    res.json(spaceView(T.spaces.insert({ ...x, id: uid(), userId: req.user.id, at: Date.now() })));
  });
  app.put('/api/school/spaces/:sid', auth, (req, res) => {
    const cur = mySpace(req, res); if (!cur) return;
    const x = cleanSpace(req.body || {}, cur);
    if (x.error) return res.status(400).json(x);
    T.spaces.put(x);
    res.json(spaceView(x));
  });
  app.delete('/api/school/spaces/:sid', auth, (req, res) => {
    const cur = mySpace(req, res); if (!cur) return;
    tx(() => { for (const p of T.posts.all({ spaceId: cur.id })) removePost(p); T.spaces.del(cur.id); });
    res.json({ ok: true });
  });
  // the seller's view of a space: every post (hidden ones too), posting as the school
  app.get('/api/school/spaces/:sid/posts', auth, (req, res) => {
    const sp = mySpace(req, res); if (!sp) return;
    res.json(T.posts.all({ spaceId: sp.id }, { order: 'at', desc: true, limit: 100 }).sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0)).map((p) => ({ ...postView(req.user, p, null), hidden: !!p.hidden })));
  });
  app.post('/api/school/spaces/:sid/posts', auth, (req, res) => {
    const sp = mySpace(req, res); if (!sp) return;
    const title = clip(req.body?.title, 200), body = clip(req.body?.body, 10000);
    if (!title && !body) return res.status(400).json({ error: 'Write something first' });
    const images = (Array.isArray(req.body?.images) ? req.body.images : []).map((v) => clip(v, 500)).filter((v) => /^(https:\/\/|\/uploads\/)[^\s"'<>]*$/.test(v)).slice(0, 4);
    const p = T.posts.insert({ id: uid(), userId: req.user.id, spaceId: sp.id, title, body, images, author: ownerAuthor(req), pinned: !!req.body?.pinned, at: Date.now() });
    res.json(postView(req.user, p, null));
  });
  const myPost = (req, res) => { const p = T.posts.get(req.params.id); if (!p || p.userId !== req.user.id) { res.status(404).json({ error: 'Post not found' }); return null; } return p; };
  app.get('/api/school/posts/:id', auth, (req, res) => {
    const p = myPost(req, res); if (!p) return;
    res.json({ post: { ...postView(req.user, p, null), hidden: !!p.hidden }, comments: T.replies.all({ target: `post:${p.id}` }, { order: 'at' }).map((r) => ({ ...replyView(req.user, r, null), hidden: !!r.hidden })) });
  });
  app.put('/api/school/posts/:id', auth, (req, res) => {
    const p = myPost(req, res); if (!p) return;
    const n = T.posts.update(p.id, (x) => {
      if ('pinned' in req.body) x.pinned = !!req.body.pinned;
      if ('hidden' in req.body) x.hidden = !!req.body.hidden;
      if (x.author.kind === 'owner') { if ('title' in req.body) x.title = clip(req.body.title, 200); if ('body' in req.body) x.body = clip(req.body.body, 10000); }
    });
    res.json({ ...postView(req.user, n, null), hidden: !!n.hidden });
  });
  app.delete('/api/school/posts/:id', auth, (req, res) => { const p = myPost(req, res); if (!p) return; removePost(p); res.json({ ok: true }); });
  app.post('/api/school/posts/:id/comments', auth, (req, res) => {
    const p = myPost(req, res); if (!p) return;
    const body = clip(req.body?.body, 3000);
    if (!body) return res.status(400).json({ error: 'Write something first' });
    const r = T.replies.insert({ id: uid(), userId: req.user.id, target: `post:${p.id}`, parentId: null, body, author: ownerAuthor(req), at: Date.now() });
    if (p.author.kind === 'student') notify(req.user, p.author.id, { kind: 'comment', text: `${schoolName(req.user)} replied to your post`, link: `post/${p.id}` });
    res.json(replyView(req.user, r, null));
  });
  app.delete('/api/school/comments/:id', auth, (req, res) => {
    const r = T.replies.get(req.params.id);
    if (!r || r.userId !== req.user.id) return res.status(404).json({ error: 'Comment not found' });
    T.replies.del(r.id); T.reacts.delWhere({ target: `reply:${r.id}` });
    res.json({ ok: true });
  });
  // questions under lessons, newest first — answered by the seller as the school
  app.get('/api/school/questions', auth, (req, res) => {
    const rows = q("SELECT data FROM replies WHERE userId = ? AND target LIKE 'lesson:%' ORDER BY at DESC LIMIT 100").all(req.user.id).map((r) => JSON.parse(r.data));
    res.json(rows.map((r) => {
      const [, pid, lid] = r.target.split(':');
      const p = T.products.get(pid);
      return { ...replyView(req.user, r, null), productId: pid, lessonId: lid, course: p?.name || '', lesson: p?.lessons.find((l) => l.id === lid)?.title || '', answered: T.replies.all({ target: r.target }).some((x) => x.parentId === r.id && x.author.kind === 'owner') };
    }));
  });
  app.post('/api/school/questions/:id/answer', auth, (req, res) => {
    const r = T.replies.get(req.params.id);
    if (!r || r.userId !== req.user.id || !r.target.startsWith('lesson:')) return res.status(404).json({ error: 'Question not found' });
    const body = clip(req.body?.body, 3000);
    if (!body) return res.status(400).json({ error: 'Write an answer first' });
    const a = T.replies.insert({ id: uid(), userId: req.user.id, target: r.target, parentId: r.id, body, author: ownerAuthor(req), at: Date.now() });
    const [, pid, lid] = r.target.split(':');
    if (r.author.kind === 'student') notify(req.user, r.author.id, { kind: 'reply', text: `${schoolName(req.user)} answered your question`, link: `course/${pid}/${lid}` });
    res.json(replyView(req.user, a, null));
  });
  // students: who they are, how far along, points; remove (ban) or sign them out everywhere
  app.get('/api/school/students', auth, (req, res) => {
    const list = T.students.all({ userId: req.user.id }, { order: 'at', desc: true, limit: 500 });
    res.json(list.map((s) => {
      const rows = accessRows(s).filter((a) => accessActive(a));
      const courses = rows.map((a) => { const p = T.products.get(a.productId); const n = p?.lessons?.length || 0; return n ? { id: p.id, name: p.name, done: p.lessons.filter((l) => a.progress?.[l.id]).length, lessons: n } : null; }).filter(Boolean);
      return { id: s.id, name: s.name, email: s.email, points: s.points || 0, level: levelOf(s.points || 0), banned: !!s.banned, lastSeenAt: s.lastSeenAt, at: s.at, courses, devices: T.ssessions.all({ studentId: s.id }).filter((x) => x.expiresAt > Date.now()).length };
    }));
  });
  app.put('/api/school/students/:id', auth, (req, res) => {
    const s = T.students.get(req.params.id);
    if (!s || s.userId !== req.user.id) return res.status(404).json({ error: 'Student not found' });
    const n = T.students.update(s.id, (x) => { if ('banned' in req.body) x.banned = !!req.body.banned; });
    if (req.body.signOut || n.banned) T.ssessions.delWhere({ studentId: s.id });
    res.json({ ok: true, banned: !!n.banned });
  });
}

function removePost(p) {
  tx(() => {
    for (const r of T.replies.all({ target: `post:${p.id}` })) T.reacts.delWhere({ target: `reply:${r.id}` });
    T.replies.delWhere({ target: `post:${p.id}` });
    T.reacts.delWhere({ target: `post:${p.id}` });
    T.posts.del(p.id);
  });
}

// for the video player's links: this access row, still active, belonging to this (not removed) student
export function studentAccess(accessId, studentId) {
  const a = T.access.get(accessId), s = T.students.get(studentId);
  return a && s && !s.banned && a.userId === s.userId && contactKey(a.email) === s.ckey && accessActive(a) ? a : null;
}

// a student erased with their contact (DPDP): their profile, sessions and points go; their posts read "Former member"
export function eraseStudent(userId, ckey) {
  const s = T.students.find({ userId, ckey });
  if (!s) return 0;
  tx(() => { T.ssessions.delWhere({ studentId: s.id }); T.points.delWhere({ studentId: s.id }); T.snotes.delWhere({ studentId: s.id }); T.reacts.delWhere({ studentId: s.id }); T.certs.delWhere({ studentId: s.id }); T.students.del(s.id); });
  return 1;
}
