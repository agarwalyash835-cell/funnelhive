// Broadcasts: one email or WhatsApp message to a segment of contacts — now or at a set time.
// Sending is a background job: the audience is frozen when the broadcast starts (one row per recipient),
// rows are claimed one by one (safe with several server processes) and sent a batch at a time, so a big list
// never blocks the server. Only contacts who opted in to marketing are sent to, unsubscribed ones never;
// email opens and clicks are tracked.
import { T, q, tx, uid, JOBS } from './db.js';
import { sendEmail, sendWhatsApp, emailStatus, whatsappStatus } from './messaging.js';
import { contactList, metaFor, logActivity, pipelinesFor } from './crm.js';
import { fill, emailTracking } from './automations.js';
import { sellerTz, zoned, localYmd } from './tz.js';
import { accessFor } from './billing.js';
import { limitsFor } from './limits.js';
import { waOptedOut } from './hive-wa.js';
const sharedCap = (u) => Math.min(SHARED_DAILY, limitsFor(u).broadcastDaily ?? Infinity);

const TICK = Number(process.env.BROADCAST_TICK_MS || 5000);
const BATCH = Number(process.env.BROADCAST_BATCH || 40); // messages per tick, across everyone
const PARALLEL = 5;
const LEASE = 10 * 60000;
// shared senders (the platform's SMTP / Resend) protect everyone's deliverability: a daily cap per seller
const SHARED_DAILY = Number(process.env.BROADCAST_SHARED_DAILY || 300);
const TZ_MIN = Number(process.env.REPORT_TZ_OFFSET_MIN ?? 330);
const DAY = 86400000;
const str = (v, n) => String(v ?? '').trim().slice(0, n);
const low = (v) => String(v ?? '').trim().toLowerCase();
const tagList = (v) => (Array.isArray(v) ? v : String(v || '').split(',')).map((t) => str(t, 40)).filter(Boolean).slice(0, 20);

// ---------- segments ----------
export function cleanSegment(s = {}, userId) {
  const out = { type: ['leads', 'customers'].includes(s.type) ? s.type : 'all', tags: tagList(s.tags), notTags: tagList(s.notTags) };
  const f = s.funnelId && T.funnels.get(s.funnelId);
  if (f && f.userId === userId) out.funnelId = f.id;
  const p = s.pipelineId && T.pipelines.get(s.pipelineId);
  if (p && p.userId === userId && p.stages.some((x) => x.id === s.stageId)) Object.assign(out, { pipelineId: p.id, stageId: s.stageId });
  if (s.source) out.source = str(s.source, 60);
  if (Number(s.days) > 0) out.days = Math.min(3650, Math.round(Number(s.days)));
  if (Number(s.minSpend) > 0) out.minSpend = Math.round(Number(s.minSpend));
  return out;
}
const matches = (c, s, now) => {
  if (s.type === 'leads' && c.type !== 'lead') return false;
  if (s.type === 'customers' && c.type !== 'customer') return false;
  const tags = c.tags.map(low);
  if (s.tags.length && !s.tags.some((t) => tags.includes(low(t)))) return false;
  if (s.notTags.some((t) => tags.includes(low(t)))) return false;
  if (s.funnelId && !c.funnelIds.includes(s.funnelId)) return false;
  if (s.pipelineId && c.stages[s.pipelineId] !== s.stageId) return false;
  if (s.source && low(c.source) !== low(s.source)) return false;
  if (s.days && !(c.firstSeen >= now - s.days * DAY)) return false;
  if (s.minSpend && c.ltv < s.minSpend) return false;
  return true;
};
// who a broadcast reaches on a channel — and who it can't, and why
// demo data (Dashboard → "explore with demo data") is never messaged, whatever address it has
const demoKeys = (userId) => new Set(q("SELECT ckey FROM leads WHERE userId = ? AND demo = 1 UNION SELECT ckey FROM orders WHERE userId = ? AND demo = 1 UNION SELECT ckey FROM abandoned WHERE userId = ? AND demo = 1").all(userId, userId, userId).map((r) => r.ckey));
export function audience(userId, segment, channel) {
  const now = Date.now();
  const demo = demoKeys(userId);
  const all = contactList(userId).filter((c) => !demo.has(c.key) && matches(c, segment, now));
  const reach = [], left = { unsubscribed: 0, notOptedIn: 0, noAddress: 0 };
  for (const c of all) {
    if (c.unsubscribed || (channel === 'whatsapp' && c.waOptOut)) left.unsubscribed++;
    // marketing goes only to people who agreed to it (DPDP; WhatsApp's opt-in rule) — buying something isn't agreeing
    else if (!c.optIn) left.notOptedIn++;
    else if (channel === 'whatsapp' ? String(c.phone).replace(/\D/g, '').length < 10 : !c.email) left.noAddress++;
    else reach.push(c);
  }
  return { matched: all.length, reach, left };
}

// ---------- validation ----------
function clean(b = {}, userId, cur = {}) {
  const channel = (b.channel ?? cur.channel) === 'whatsapp' ? 'whatsapp' : 'email';
  const wa = b.wa ?? cur.wa ?? {};
  return {
    name: str(b.name ?? cur.name, 100) || 'Untitled broadcast',
    channel,
    subject: str(b.subject ?? cur.subject, 200),
    body: String(b.body ?? cur.body ?? '').slice(0, 20000),
    wa: { template: str(wa.template, 120), language: str(wa.language, 10) || 'en', params: str(wa.params, 1000) },
    segment: cleanSegment(b.segment ?? cur.segment, userId),
  };
}
function problems(x, u) {
  if (x.channel === 'email') {
    if (!x.subject) return 'Add a subject line';
    if (!x.body.trim()) return 'Write the email';
    if (!emailStatus(u).configured) return 'Email sending isn’t set up — set it up in Settings → Email sending (SMTP)';
  } else {
    if (!/^[a-z0-9_]{1,120}$/.test(x.wa.template)) return 'Pick the approved WhatsApp template to send (its name, like diwali_offer)';
    if (!whatsappStatus(u).configured) return 'WhatsApp isn’t connected — add your WhatsApp Cloud API details in Settings → WhatsApp';
  }
  return null;
}

const ctxFor = (u, c) => ({ name: c.name || '', first_name: String(c.name || '').split(/\s+/)[0] || '', email: c.email || '', phone: c.phone || '', business: u.settings?.businessName || '' });
const origin = () => process.env.APP_URL || 'http://localhost:4000';
async function deliver(u, b, to) {
  const ctx = ctxFor(u, to);
  if (b.channel === 'email') {
    const msg = { id: uid(), userId: u.id, broadcastId: b.id, key: to.key, subject: fill(b.subject, ctx), at: Date.now(), opens: 0, clicks: 0 };
    const text = fill(b.body, ctx);
    const r = await sendEmail(u, { to: to.email, subject: msg.subject, text, ...emailTracking(origin(), u.id, to.key, msg.id) });
    if (r.status !== 'sent') throw new Error('Email sending isn’t set up');
    T.msgs.insert(msg);
    logActivity(u.id, to.key, { type: 'email', title: `Broadcast sent: ${msg.subject}`, text: text.slice(0, 2000), by: 'broadcast', broadcast: b.name, status: 'sent' });
  } else {
    const params = b.wa.params ? b.wa.params.split(',').map((p) => fill(p.trim(), ctx)) : [];
    const r = await sendWhatsApp(u, to.phone, { template: b.wa.template, language: b.wa.language, params, key: `bc:${b.id}:${to.key}`, ckey: to.key });
    if (r.status !== 'sent') throw new Error('WhatsApp isn’t connected');
    logActivity(u.id, to.key, { type: 'whatsapp', title: `Broadcast sent on WhatsApp: ${b.wa.template}`, text: params.join(' · '), by: 'broadcast', broadcast: b.name, status: 'sent' });
  }
}

// first open / click of a broadcast email (called from the tracking endpoints)
export function broadcastSeen(msg, kind) {
  const b = T.broadcasts.get(msg.broadcastId);
  if (!b) return;
  bump(b.id, kind === 'open' ? 'opened' : 'clicked');
  logActivity(msg.userId, msg.key, { type: 'email', title: kind === 'open' ? `Opened broadcast: ${msg.subject}` : `Clicked a link in broadcast: ${msg.subject}`, text: kind === 'click' ? msg.lastUrl : undefined, by: 'broadcast', broadcast: b.name, status: kind === 'open' ? 'opened' : 'clicked' });
}

// ---------- the job ----------
const dayStart = (now, tz = 'Asia/Kolkata') => zoned(tz, localYmd(tz, now), 0); // the seller's midnight
const sentToday = (userId, now) => q("SELECT COUNT(*) AS n FROM bsends WHERE userId = ? AND sentAt >= ? AND status = 'sent'").get(userId, dayStart(now, sellerTz(T.users.get(userId)))).n;
const bump = (id, k, n = 1) => T.broadcasts.update(id, (x) => { x.stats = { ...x.stats, [k]: (x.stats?.[k] || 0) + n }; });

// a scheduled broadcast that's due: freeze its audience into one row per recipient
function start(b, now) {
  if (q("UPDATE broadcasts SET status = 'sending', data = json_set(data, '$.status', 'sending') WHERE id = ? AND status = 'scheduled'").run(b.id).changes !== 1) return;
  const u = T.users.get(b.userId);
  const { reach } = u ? audience(b.userId, b.segment, b.channel) : { reach: [] };
  tx(() => {
    for (const c of reach) T.bsends.insert({ id: uid(), userId: b.userId, broadcastId: b.id, key: c.key, email: c.email, phone: c.phone, name: c.name, status: 'queued', nextAt: now, sentAt: null, at: now });
    T.broadcasts.update(b.id, (x) => { x.status = 'sending'; x.startedAt = now; x.stats = { total: reach.length, sent: 0, failed: 0, skipped: 0, opened: 0, clicked: 0 }; });
  });
}
let busy = false;
export async function broadcastTick(now = Date.now()) {
  if (busy) return;
  busy = true;
  try {
    for (const b of T.broadcasts.all({ status: 'scheduled', scheduledAt: { lte: now } })) start(b, now);
    // a process that died mid-send: its claimed rows are retried after the lease
    q("UPDATE bsends SET status = 'queued', data = json_set(data, '$.status', 'queued') WHERE status = 'sending' AND nextAt < ?").run(now - LEASE);
    const rows = q(`SELECT id FROM bsends WHERE status = 'queued' AND nextAt <= ? ORDER BY nextAt, at LIMIT ${BATCH}`).all(now);
    const users = new Map(), capLeft = new Map();
    const work = [];
    for (const { id } of rows) {
      const s = T.bsends.get(id);
      if (!s) continue;
      const b = T.broadcasts.get(s.broadcastId);
      if (!b || b.status !== 'sending') { T.bsends.update(id, (x) => { x.status = 'skipped'; x.error = 'Broadcast cancelled'; }); continue; }
      if (!users.has(s.userId)) users.set(s.userId, T.users.get(s.userId));
      const u = users.get(s.userId);
      if (!u || !accessFor(u).ok) { T.bsends.update(id, (x) => { x.nextAt = now + 3600000; }); continue; } // paused until the subscription is active
      // shared email sender: a daily cap; the rest waits for tomorrow
      if (b.channel === 'email' && emailStatus(u).via !== 'your SMTP') {
        if (!capLeft.has(u.id)) capLeft.set(u.id, sharedCap(u) - sentToday(u.id, now));
        if (capLeft.get(u.id) <= 0) { T.bsends.update(id, (x) => { x.nextAt = dayStart(now, sellerTz(u)) + DAY + 60000; }); continue; }
        capLeft.set(u.id, capLeft.get(u.id) - 1);
      }
      if (q("UPDATE bsends SET status = 'sending', nextAt = ?, data = json_set(data, '$.status', 'sending', '$.nextAt', ?) WHERE id = ? AND status = 'queued'").run(now, now, id).changes !== 1) continue; // another process has it
      work.push({ s, b, u });
    }
    for (let i = 0; i < work.length; i += PARALLEL) {
      await Promise.all(work.slice(i, i + PARALLEL).map(async ({ s, b, u }) => {
        // checked again at send time: they may have unsubscribed since the broadcast started
        const m = metaFor(u.id, s.key);
        if (m?.unsubscribed || (b.channel === 'whatsapp' && (m?.waOptOut || waOptedOut(u.id, s.phone)))) { T.bsends.update(s.id, (x) => { x.status = 'skipped'; x.error = 'Unsubscribed'; }); return bump(b.id, 'skipped'); }
        try {
          await deliver(u, b, s);
          T.bsends.update(s.id, (x) => { x.status = 'sent'; x.sentAt = Date.now(); });
          bump(b.id, 'sent');
        } catch (e) {
          T.bsends.update(s.id, (x) => { x.status = 'failed'; x.error = String(e.message).slice(0, 300); });
          bump(b.id, 'failed');
        }
      }));
    }
    // finished broadcasts
    for (const b of T.broadcasts.all({ status: 'sending' })) {
      if (!T.bsends.exists({ broadcastId: b.id, status: 'queued' }) && !T.bsends.exists({ broadcastId: b.id, status: 'sending' })) T.broadcasts.update(b.id, (x) => { x.status = 'sent'; x.doneAt = Date.now(); });
    }
  } catch (e) { console.error('broadcast job failed', e); } finally { busy = false; }
}

// ---------- API ----------
const view = (b) => { const { userId, ...x } = b; return x; };
export function registerBroadcasts(app, { auth, rateLimit, isTest }) {
  const testLimiter = rateLimit({ windowMs: 60000, max: isTest ? 1000 : 6, key: (req) => req.user.id, message: 'Too many test messages — please wait a minute.' });
  const own = (req, res) => { const b = T.broadcasts.get(req.params.bid); if (!b || b.userId !== req.user.id) { res.status(404).json({ error: 'Broadcast not found' }); return null; } return b; };
  const summary = (userId, b) => { const a = audience(userId, b.segment, b.channel); return { matched: a.matched, reach: a.reach.length, left: a.left }; };

  app.get('/api/broadcasts', auth, (req, res) => res.json({
    broadcasts: T.broadcasts.all({ userId: req.user.id }, { order: 'at', desc: true, limit: 200 }).map(view),
    email: emailStatus(req.user), whatsapp: whatsappStatus(req.user), sharedDaily: emailStatus(req.user).via === 'your SMTP' ? null : sharedCap(req.user),
    tags: [...new Set(T.crm.all({ userId: req.user.id }).flatMap((m) => m.tags || []))].sort(),
    pipelines: pipelinesFor(req.user.id).map(({ id, name, stages }) => ({ id, name, stages: stages.map(({ id: sid, name: sn }) => ({ id: sid, name: sn })) })),
  }));
  app.post('/api/broadcasts/audience', auth, (req, res) => {
    const seg = cleanSegment(req.body?.segment, req.user.id);
    const a = audience(req.user.id, seg, req.body?.channel === 'whatsapp' ? 'whatsapp' : 'email');
    res.json({ matched: a.matched, reach: a.reach.length, left: a.left, sample: a.reach.slice(0, 5).map((c) => ({ name: c.name, email: c.email, phone: c.phone })) });
  });
  app.post('/api/broadcasts', auth, (req, res) => {
    if (T.broadcasts.count({ userId: req.user.id }) >= 500) return res.status(400).json({ error: 'You have 500 broadcasts — delete old ones first' });
    const b = T.broadcasts.insert({ id: uid(), userId: req.user.id, ...clean(req.body, req.user.id), status: 'draft', stats: {}, at: Date.now() });
    res.json(view(b));
  });
  app.get('/api/broadcasts/:bid', auth, (req, res) => {
    const b = own(req, res); if (!b) return;
    const failed = T.bsends.all({ broadcastId: b.id, status: 'failed' }, { limit: 200 }).map((s) => ({ name: s.name, email: s.email, phone: s.phone, error: s.error }));
    res.json({ ...view(b), audience: ['draft', 'scheduled'].includes(b.status) ? summary(req.user.id, b) : null, failed });
  });
  app.put('/api/broadcasts/:bid', auth, (req, res) => {
    const b = own(req, res); if (!b) return;
    if (!['draft', 'scheduled'].includes(b.status)) return res.status(400).json({ error: 'This broadcast has already gone out — duplicate it to send again' });
    res.json(view(T.broadcasts.update(b.id, (x) => Object.assign(x, clean(req.body, req.user.id, x)))));
  });
  app.post('/api/broadcasts/:bid/duplicate', auth, (req, res) => {
    const b = own(req, res); if (!b) return;
    res.json(view(T.broadcasts.insert({ id: uid(), userId: req.user.id, ...clean({}, req.user.id, b), name: `${b.name} (copy)`.slice(0, 100), status: 'draft', stats: {}, at: Date.now() })));
  });
  app.delete('/api/broadcasts/:bid', auth, (req, res) => {
    const b = own(req, res); if (!b) return;
    if (b.status === 'sending') return res.status(400).json({ error: 'It’s sending right now — cancel it first' });
    tx(() => { T.bsends.delWhere({ broadcastId: b.id }); T.broadcasts.del(b.id); });
    res.json({ ok: true });
  });
  // send now, or at a time (ms) — the audience is taken at that moment
  app.post('/api/broadcasts/:bid/send', auth, (req, res) => {
    const b = own(req, res); if (!b) return;
    if (!['draft', 'scheduled'].includes(b.status)) return res.status(400).json({ error: 'This broadcast has already gone out' });
    if (!accessFor(req.user).ok) return res.status(402).json({ error: 'Your subscription is inactive — renew to send broadcasts' });
    const p = problems(b, req.user);
    if (p) return res.status(400).json({ error: p });
    const at = req.body?.at ? Number(req.body.at) : Date.now();
    if (!Number.isFinite(at) || at > Date.now() + 90 * DAY) return res.status(400).json({ error: 'Pick a time in the next 90 days' });
    if (!summary(req.user.id, b).reach) return res.status(400).json({ error: 'Nobody in this audience can receive it — check the filters' });
    const out = T.broadcasts.update(b.id, (x) => { x.status = 'scheduled'; x.scheduledAt = Math.max(at, Date.now()); });
    setImmediate(() => broadcastTick());
    res.json(view(out));
  });
  app.post('/api/broadcasts/:bid/cancel', auth, (req, res) => {
    const b = own(req, res); if (!b) return;
    if (b.status === 'scheduled') return res.json(view(T.broadcasts.update(b.id, (x) => { x.status = 'draft'; delete x.scheduledAt; })));
    if (b.status !== 'sending') return res.status(400).json({ error: 'Nothing to cancel' });
    const n = q("UPDATE bsends SET status = 'skipped', data = json_set(data, '$.status', 'skipped', '$.error', 'Broadcast cancelled') WHERE broadcastId = ? AND status = 'queued'").run(b.id).changes;
    res.json(view(T.broadcasts.update(b.id, (x) => { x.status = 'cancelled'; x.doneAt = Date.now(); x.stats = { ...x.stats, skipped: (x.stats?.skipped || 0) + n }; })));
  });
  // a test copy to the seller (email) or a number they give (WhatsApp)
  app.post('/api/broadcasts/:bid/test', auth, testLimiter, async (req, res) => {
    const b = own(req, res); if (!b) return;
    const p = problems(b, req.user);
    if (p) return res.status(400).json({ error: p });
    const to = { key: `test:${req.user.id}`, name: req.user.name || 'You', email: str(req.body?.to, 200) || req.user.email, phone: str(req.body?.phone, 20) };
    if (b.channel === 'whatsapp' && to.phone.replace(/\D/g, '').length < 10) return res.status(400).json({ error: 'Enter the WhatsApp number to send the test to' });
    try {
      const ctx = ctxFor(req.user, to);
      if (b.channel === 'email') await sendEmail(req.user, { to: to.email, subject: `[Test] ${fill(b.subject, ctx)}`, text: fill(b.body, ctx) });
      else await sendWhatsApp(req.user, to.phone, { template: b.wa.template, language: b.wa.language, params: b.wa.params ? b.wa.params.split(',').map((x) => fill(x.trim(), ctx)) : [] });
      res.json({ ok: true });
    } catch (e) { res.status(400).json({ error: `Couldn’t send: ${e.message}` }); }
  });

  if (JOBS) setInterval(() => broadcastTick(), TICK).unref();
}
