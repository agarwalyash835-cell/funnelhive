// The public API: sellers (and Zapier, Pabbly Connect, Make, n8n…) use API keys on the same REST API the app uses.
//   - keys: "full" (everything an admin team member may do) or "read" (read-only, like a viewer); never billing,
//     the account, the team, platform admin or other keys. Stored hashed; 120 requests a minute per key.
//   - REST hooks: POST /api/v1/hooks { url, event } subscribes a URL to an event (how Zapier triggers work);
//     deliveries are signed and retried like the seller's own webhook.
//   - a few integration-shaped endpoints: recent leads / orders / bookings (polling), contact upsert with tags.
import { T, q, uid, contactKey } from './db.js';
import { randomToken, hashToken } from './security.js';
import { checkWebhookUrl } from './webhooks.js';
import { ensureMeta, logActivity, contactList } from './crm.js';
import { fire as fireAutomation } from './automations.js';

export const EVENTS = ['lead.created', 'order.created', 'order.updated', 'order.refunded', 'order.shipped', 'order.cancelled', 'order.renewed', 'order.payment_failed', 'order.plan_ended', 'booking.created', 'booking.rescheduled', 'booking.cancelled', 'webinar.registered', 'webinar.attended', 'webinar.missed'];
const KEY_RE = /^fh_(live)_[0-9a-f]{40}$/;
export const isApiKey = (t) => KEY_RE.test(String(t || ''));
// the auth middleware's API-key step → { user, key } or null
export function keyUser(token) {
  const k = T.apikeys.find({ hash: hashToken(token) });
  const user = k && T.users.get(k.userId);
  if (!user) return null;
  if (Date.now() - (k.lastUsedAt || 0) > 60000) T.apikeys.update(k.id, (x) => { x.lastUsedAt = Date.now(); });
  return { user, key: k, role: k.scope === 'read' ? 'viewer' : 'admin' };
}
// paths an API key never reaches, whatever its scope
export const KEY_NEVER = /^\/api\/(vault|keys|hive\/tokens|channels|google\/calendar|privacy$|me\/|auth\/|account|billing|admin|team)/;

const view = ({ hash, userId, ...k }) => k;
const since = (req) => Math.max(0, Number(req.query.since) || 0);
const limitOf = (req) => Math.min(500, Math.max(1, Number(req.query.limit) || 100));

export function registerApi(app, { auth }) {
  // ---- keys (owners and admins, from the app) ----
  app.get('/api/keys', auth, (req, res) => res.json({ keys: T.apikeys.all({ userId: req.user.id }).sort((a, b) => a.at - b.at).map(view), events: EVENTS, hooks: T.hooksubs.all({ userId: req.user.id }, { order: 'at' }).map(({ userId, ...h }) => h) }));
  app.post('/api/keys', auth, (req, res) => {
    if (T.apikeys.count({ userId: req.user.id }) >= 20) return res.status(400).json({ error: 'You can have up to 20 API keys — revoke one first' });
    const token = `fh_live_${randomToken().slice(0, 40)}`;
    const k = T.apikeys.insert({ id: uid(), userId: req.user.id, ...(req.actor ? { by: req.actor.id } : {}), name: String(req.body?.name || 'API key').trim().slice(0, 60) || 'API key', scope: req.body?.scope === 'read' ? 'read' : 'full', hash: hashToken(token), prefix: token.slice(0, 14), at: Date.now(), lastUsedAt: null });
    res.json({ ...view(k), token });
  });
  app.delete('/api/keys/:id', auth, (req, res) => { T.apikeys.delWhere({ id: req.params.id, userId: req.user.id }); q("DELETE FROM hooksubs WHERE userId = ? AND json_extract(data, '$.keyId') = ?").run(req.user.id, req.params.id); res.json({ ok: true }); }); // its Zapier subscriptions go with it

  // ---- REST hooks (Zapier / Pabbly / Make subscribe and unsubscribe themselves) ----
  app.post('/api/v1/hooks', auth, async (req, res) => {
    const url = String(req.body?.url || req.body?.target_url || req.body?.hookUrl || '').trim();
    const event = String(req.body?.event || '').trim();
    if (!EVENTS.includes(event) && event !== '*') return res.status(400).json({ error: `event must be one of ${EVENTS.join(', ')} or *` });
    try { await checkWebhookUrl(url); } catch (e) { return res.status(400).json({ error: e.message }); }
    if (T.hooksubs.count({ userId: req.user.id }) >= 100) return res.status(400).json({ error: 'Up to 100 subscriptions — remove some first' });
    const h = T.hooksubs.insert({ id: uid(), userId: req.user.id, url: url.slice(0, 500), event, keyId: req.apiKey?.id || null, at: Date.now() });
    res.status(201).json({ id: h.id, url: h.url, event: h.event });
  });
  app.get('/api/v1/hooks', auth, (req, res) => res.json(T.hooksubs.all({ userId: req.user.id }, { order: 'at' }).map(({ userId, ...h }) => h)));
  app.delete('/api/v1/hooks/:id', auth, (req, res) => { T.hooksubs.delWhere({ id: req.params.id, userId: req.user.id }); res.json({ ok: true }); });

  // ---- reads for polling triggers (newest first) ----
  app.get('/api/v1/me', auth, (req, res) => res.json({ id: req.user.id, email: req.user.email, business: req.user.settings?.businessName || req.user.name, key: req.apiKey ? { name: req.apiKey.name, scope: req.apiKey.scope } : null }));
  const funnelNames = (userId) => Object.fromEntries(T.funnels.all({ userId }).map((f) => [f.id, f.name]));
  app.get('/api/v1/leads', auth, (req, res) => {
    const names = funnelNames(req.user.id);
    res.json(T.leads.all({ userId: req.user.id, at: { gt: since(req) } }, { order: 'at', desc: true, limit: limitOf(req) }).map(({ userId, visitor, ...l }) => ({ ...l, funnel: names[l.funnelId] || null })));
  });
  app.get('/api/v1/orders', auth, (req, res) => {
    const names = funnelNames(req.user.id);
    res.json(T.orders.all({ userId: req.user.id, at: { gt: since(req) } }, { order: 'at', desc: true, limit: limitOf(req) }).map(({ userId, visitor, stripeCustomer, ...o }) => ({ ...o, currency: o.currency || 'INR', funnel: names[o.funnelId] || null })));
  });
  app.get('/api/v1/bookings', auth, (req, res) => {
    res.json(T.bookings.all({ userId: req.user.id, status: ['confirmed', 'cancelled', 'rescheduled'] }, { order: 'at', desc: true, limit: 1000 }).filter((b) => b.at > since(req)).slice(0, limitOf(req)).map(({ userId, base, reminded, ...b }) => b));
  });
  app.get('/api/v1/contacts', auth, (req, res) => {
    const s = since(req);
    res.json(contactList(req.user.id).filter((c) => c.lastSeen > s).sort((a, b) => b.lastSeen - a.lastSeen).slice(0, limitOf(req)));
  });
  // ---- contact upsert: create or update, add tags (tag automations run for new tags) ----
  app.post('/api/v1/contacts', auth, (req, res) => {
    const b = req.body || {};
    const email = String(b.email || '').trim().toLowerCase().slice(0, 200), phone = String(b.phone || '').trim().slice(0, 40);
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Invalid email' });
    if (!email && !phone) return res.status(400).json({ error: 'email or phone is required' });
    const key = contactKey(email, phone);
    const m = ensureMeta(req.user.id, key);
    const exists = T.leads.exists({ userId: req.user.id, ckey: key }) || T.orders.exists({ userId: req.user.id, ckey: key }) || m.manual;
    if (!exists) Object.assign(m, { manual: true, email, phone, at: Date.now() });
    if (b.name) m.name = String(b.name).slice(0, 120);
    if (phone && !m.phone) m.phone = phone;
    const before = new Set((m.tags || []).map((t) => t.toLowerCase()));
    const add = (Array.isArray(b.tags) ? b.tags : String(b.tags || '').split(',')).map((t) => String(t).trim().slice(0, 30)).filter(Boolean);
    m.tags = [...new Set([...(m.tags || []), ...add])].slice(0, 20);
    T.crm.put(m);
    if (!exists) logActivity(req.user.id, key, { type: 'created', title: `Added through the API${req.apiKey ? ` (${req.apiKey.name})` : ''}` });
    for (const tag of add.filter((t) => !before.has(t.toLowerCase()))) fireAutomation(req.user.id, 'tag', { key, email, phone, name: m.name, tag });
    res.status(exists ? 200 : 201).json({ key, created: !exists, tags: m.tags });
  });
}

// webhooks.js asks for the subscribed URLs of an event
export const subscribers = (userId, event) => q("SELECT data FROM hooksubs WHERE userId = ? AND json_extract(data, '$.event') IN (?, '*')").all(userId, event).map((r) => JSON.parse(r.data).url);
