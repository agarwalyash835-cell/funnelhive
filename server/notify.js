// The seller's in-app notifications (the bell in the top bar): new orders, leads, bookings, quotes, failed
// payments. Email / WhatsApp alerts are on hold, so this is how a seller hears about a sale.
import { T, q, uid } from './db.js';

export const KINDS = ['order', 'lead', 'booking', 'booking_cancelled', 'quote_paid', 'quote_accepted', 'quote_declined', 'payment_failed', 'refund', 'whatsapp', 'support', 'affiliate'];
const KEEP = 500; // per seller; older ones are pruned now and then
const clip = (v, n) => String(v ?? '').trim().slice(0, n);

// Never throws: a notification must never break the sale / lead / booking that caused it
// ckey: the contact it's about, so erasing that contact removes it too
export function notify(userId, { kind, title, body = '', link = '', ckey = '' } = {}) {
  try {
    if (!userId || !KINDS.includes(kind) || !title) return null;
    const n = T.notifications.insert({ id: uid(), userId, kind, title: clip(title, 160), body: clip(body, 300), link: /^\/[\w\-/%.?=&]*$/.test(link) ? link : '', read: false, ...(ckey ? { ckey } : {}), at: Date.now() });
    if (Math.random() < 0.05) q(`DELETE FROM notifications WHERE userId = ? AND id NOT IN (SELECT id FROM notifications WHERE userId = ? ORDER BY at DESC LIMIT ${KEEP})`).run(userId, userId);
    return n;
  } catch (e) { console.error('notification not saved', e.message); return null; }
}

// "₹1,999" / "$49" — the amount as the seller sees it on the Orders page
export const money = (n, iso = 'INR') => {
  try { return new Intl.NumberFormat(iso === 'INR' ? 'en-IN' : 'en-US', { style: 'currency', currency: iso, minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(Number(n) || 0); } catch { return `${iso} ${n}`; }
};

export function registerNotifications(app, { auth }) {
  // the latest 50 and how many are unread (req.user is the workspace owner, so a team shares one bell)
  app.get('/api/notifications', auth, (req, res) => {
    const userId = req.user.id;
    res.json({ items: T.notifications.all({ userId }, { order: 'at', desc: true, limit: 50 }), unread: T.notifications.count({ userId, read: 0 }) });
  });
  // { ids: [...] } or { all: true }
  app.post('/api/notifications/read', auth, (req, res) => {
    const userId = req.user.id, now = Date.now();
    const ids = req.body?.all === true ? T.notifications.ids({ userId, read: 0 }) : Array.isArray(req.body?.ids) ? req.body.ids.slice(0, 200).map(String) : [];
    for (const id of ids) T.notifications.update(id, (n) => (n.userId === userId && !n.read ? Object.assign(n, { read: true, readAt: now }) : n));
    res.json({ ok: true, unread: T.notifications.count({ userId, read: 0 }) });
  });
}

export const unreadCount = (userId) => T.notifications.count({ userId, read: 0 });
