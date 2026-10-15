// Booking calendars: a seller's weekly availability, the slots it opens on funnel pages (the "book your call"
// step of an application funnel), the bookings themselves, reminders and the buyer's reschedule / cancel link.
//
// Times are stored as UTC milliseconds; availability is written in the calendar's local time (India by default,
// UTC+5:30 — no daylight saving, so a fixed offset is exact).
import crypto from 'node:crypto';
import { T, q, tx, uid, contactKey, JOBS } from './db.js';
import { sendEmail } from './messaging.js';
import { enqueue as fireWebhook } from './webhooks.js';
import { fire as fireAutomation } from './automations.js';
import { linkBase } from './products.js';
import { cachedBusy, refreshBusy, addEvent, removeEvent } from './gcal.js';
import { rzpCreds, createOrder as rzpCreateOrder, validPayment, call as rzpCall } from './razorpay.js';
import { stripeCreds, startStripePayment, confirmedIntent, stripeRefund, CURRENCIES } from './stripe.js';
const CALL_CURRENCIES = [...new Set(Object.values(CURRENCIES))];
import { tzOf, sellerTz, zoned, localYmd, addDays, dowOfYmd, formatIn, offsetAt, validTz } from './tz.js';
import { refundOrder, issueInvoice, invoiceUrl } from './sales.js';
import { fxRate } from './fx.js';
import { notify } from './notify.js';
import { waEvent, sellerAlert, waRequired, waPhoneOk } from './hive-wa.js';

const MIN = 60000, HOUR = 3600000, DAY = 86400000;
const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
let SECRET = '';
const sig = (s) => crypto.createHmac('sha256', SECRET).update(s).digest('base64url').slice(0, 24);
const same = (a, b) => typeof a === 'string' && typeof b === 'string' && a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
const clip = (v, n) => String(v ?? '').trim().slice(0, n);
const intIn = (v, lo, hi, d) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
const toMin = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };

export const DEFAULT_HOURS = { mon: [['10:00', '18:00']], tue: [['10:00', '18:00']], wed: [['10:00', '18:00']], thu: [['10:00', '18:00']], fri: [['10:00', '18:00']], sat: [['10:00', '14:00']], sun: [] };
function cleanCalendar(b = {}, cur = {}) {
  const out = { ...cur };
  if ('name' in b || !cur.id) out.name = clip(b.name, 80) || cur.name || 'Strategy call';
  if ('description' in b) out.description = clip(b.description, 600);
  if ('duration' in b || !cur.id) out.duration = intIn(b.duration, 10, 240, cur.duration || 30);
  if ('buffer' in b || !cur.id) out.buffer = intIn(b.buffer, 0, 120, cur.buffer ?? 10);
  if ('noticeHours' in b || !cur.id) out.noticeHours = intIn(b.noticeHours, 0, 336, cur.noticeHours ?? 4);
  if ('daysAhead' in b || !cur.id) out.daysAhead = intIn(b.daysAhead, 1, 120, cur.daysAhead ?? 21);
  if ('perDay' in b || !cur.id) out.perDay = intIn(b.perDay, 0, 100, cur.perDay ?? 0); // 0 = no daily cap
  if ('tzOffset' in b || !cur.id) out.tzOffset = intIn(b.tzOffset, -720, 840, cur.tzOffset ?? 330);
  if ('timezone' in b) { if (b.timezone && !validTz(b.timezone)) return { error: 'Unknown time zone' }; out.timezone = b.timezone || undefined; }
  if ('location' in b) out.location = clip(b.location, 200);
  if ('meetingLink' in b) { const l = clip(b.meetingLink, 500); out.meetingLink = /^https:\/\/[^\s"'<>]+$/i.test(l) ? l : ''; }
  if ('reminders' in b || !cur.id) out.reminders = { day: b.reminders?.day ?? cur.reminders?.day ?? true, hour: b.reminders?.hour ?? cur.reminders?.hour ?? true };
  if ('hours' in b || !cur.id) {
    const h = b.hours && typeof b.hours === 'object' ? b.hours : cur.hours || DEFAULT_HOURS;
    out.hours = Object.fromEntries(DAYS.map((d) => [d, (Array.isArray(h[d]) ? h[d] : []).filter((w) => Array.isArray(w) && HHMM.test(w[0]) && HHMM.test(w[1]) && toMin(w[0]) < toMin(w[1])).slice(0, 4)]));
  }
  // paid calls: the buyer pays (Razorpay in ₹, or Stripe by card in any currency) before the slot is confirmed; refunded when cancelled early enough
  if ('price' in b || !cur.id) out.price = intIn(b.price, 0, 1000000, cur.price ?? 0);
  if ('currency' in b || !cur.id) out.currency = CALL_CURRENCIES.includes(b.currency) ? b.currency : cur.currency || 'INR';
  if ('refundHours' in b || !cur.id) out.refundHours = intIn(b.refundHours, 0, 720, cur.refundHours ?? 24);
  // the public booking page: its address, whether it's listed on your profile, the lengths people may pick,
  // how often start times are offered (0 = automatic), and your own questions on the form
  if ('slug' in b || !cur.id) out.slug = slugify(b.slug || cur.slug || out.name || 'call');
  if ('listed' in b || !cur.id) out.listed = b.listed ?? cur.listed ?? true;
  if ('durations' in b || !cur.id) out.durations = [...new Set((Array.isArray(b.durations) ? b.durations : cur.durations || []).map((m) => intIn(m, 10, 240, 0)).filter(Boolean))].sort((x, y) => x - y).slice(0, 6);
  if (!out.durations?.length || !out.durations.includes(out.duration)) out.durations = [...new Set([out.duration, ...(out.durations || [])])].sort((x, y) => x - y);
  if ('interval' in b || !cur.id) out.interval = [0, 10, 15, 20, 30, 60].includes(Number(b.interval)) ? Number(b.interval) : cur.interval ?? 0;
  if ('questions' in b || !cur.id) out.questions = (Array.isArray(b.questions) ? b.questions : cur.questions || []).filter((q) => q && clip(q.label, 200)).slice(0, 10).map((q) => ({ id: clip(q.id, 20) || uid().slice(0, 8), label: clip(q.label, 200), type: ['text', 'long', 'phone', 'select'].includes(q.type) ? q.type : 'text', required: !!q.required, ...(q.type === 'select' ? { options: (Array.isArray(q.options) ? q.options : String(q.options || '').split(',')).map((o) => clip(o, 80)).filter(Boolean).slice(0, 12) } : {}) }));
  if ('blocked' in b || !cur.id) out.blocked = (Array.isArray(b.blocked) ? b.blocked : cur.blocked || []).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).slice(0, 365);
  return out;
}
export const calendarsOf = (userId) => T.calendars.all({ userId }, { order: 'at' });
const slugify = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'call';
// start times on the clock: a 10/15/20/30/60-minute call starts every that many minutes, other lengths on
// the quarter or half hour (never 4:40, 5:20 …) — unless the calendar sets its own interval
const stepOf = (cal, dur) => cal.interval || ([10, 15, 20, 30, 60].includes(dur) ? dur : dur < 30 ? 15 : 30);
const priceFor = (cal, dur) => (cal.price > 0 ? Math.round((cal.price * dur) / cal.duration) : 0);
const lengthOf = (cal, d) => { const n = Number(d); return (cal.durations || [cal.duration]).includes(n) ? n : cal.duration; };
// the seller's public booking address: /meet/<handle>/<calendar slug>
export function handleOf(u) {
  if (u.bookingHandle) return u.bookingHandle;
  const base = slugify(u.settings?.businessName || u.name || u.email.split('@')[0]).slice(0, 30);
  let h = base, i = 1;
  while (q("SELECT 1 FROM users WHERE json_extract(data, '$.bookingHandle') = ?").get(h)) h = `${base}-${++i}`;
  T.users.update(u.id, (x) => { x.bookingHandle = h; });
  return h;
}
const userByHandle = (h) => { const r = q("SELECT id FROM users WHERE json_extract(data, '$.bookingHandle') = ?").get(String(h || '').toLowerCase()); return r && T.users.get(r.id); };
// a slug unique among this seller's calendars
const uniqueSlug = (userId, slug, selfId) => { let s = slug, i = 1; while (calendarsOf(userId).some((x) => x.slug === s && x.id !== selfId)) s = `${slug}-${++i}`; return s; };
// answers to the calendar's own questions → { label: answer }, or an error for a missing required one
function cleanAnswers(cal, a = {}) {
  const out = {};
  for (const q of cal.questions || []) {
    const v = clip(a?.[q.id], q.type === 'long' ? 2000 : 300);
    if (q.required && !v) return { error: `Please answer: ${q.label}` };
    if (q.type === 'select' && v && !(q.options || []).includes(v)) return { error: `Please pick an option for: ${q.label}` };
    if (v) out[q.label] = v;
  }
  return { answers: out };
}
// Every seller gets a sensible default the first time a booking block needs one
export function defaultCalendar(userId) {
  return calendarsOf(userId)[0] || T.calendars.insert({ ...cleanCalendar({ name: 'Strategy call', duration: 30 }), id: uid(), userId, at: Date.now() });
}
const calendarFor = (userId, id) => (id && T.calendars.get(id)?.userId === userId ? T.calendars.get(id) : defaultCalendar(userId));

// ---------- slots ----------
// a calendar's zone: its own, else its seller's (India by default)
export const calTz = (cal) => tzOf(cal, sellerTz(T.users.get(cal.userId)));
export function freeSlots(cal, from = Date.now(), now = Date.now(), dur = cal.duration) {
  const tz = calTz(cal);
  const earliest = now + cal.noticeHours * HOUR;
  const until = now + cal.daysAhead * DAY;
  // taken: confirmed bookings, slots held while someone pays, and busy times in the seller's Google Calendar
  const taken = T.bookings.all({ calendarId: cal.id, status: ['confirmed', 'held'], start: { gte: from - DAY, lte: until + DAY } }).filter((b) => b.status === 'confirmed' || b.holdUntil > now);
  const busy = taken.map((b) => [b.start - cal.buffer * MIN, b.end + cal.buffer * MIN]).concat(cachedBusy(cal.userId).map(([a, b]) => [a - cal.buffer * MIN, b + cal.buffer * MIN]));
  const perDayCount = {};
  for (const b of taken) perDayCount[localYmd(tz, b.start)] = (perDayCount[localYmd(tz, b.start)] || 0) + 1;
  const out = [];
  const step = stepOf(cal, dur);
  // walk the calendar's local days; each window is turned into real instants in its zone (daylight saving included)
  const lastDay = localYmd(tz, until);
  for (let key = localYmd(tz, Math.max(from, now)), i = 0; key <= lastDay && i < 400; key = addDays(key, 1), i++) {
    if (cal.blocked.includes(key)) continue;
    if (cal.perDay && (perDayCount[key] || 0) >= cal.perDay) continue;
    const dow = DAYS[dowOfYmd(key)];
    let today = 0;
    for (const [a, b] of cal.hours[dow] || []) {
      for (let m = toMin(a); m + dur <= toMin(b); m += step) {
        const s = zoned(tz, key, m), e = s + dur * MIN;
        if (s < earliest || s > until) continue;
        if (busy.some(([bs, be]) => s < be && e > bs)) continue;
        if (cal.perDay && (perDayCount[key] || 0) + today >= cal.perDay) break;
        out.push(s);
      }
    }
    if (out.length > 600) break;
  }
  return out;
}

// ---------- booking ----------
const manageToken = (b) => sig(`bk.${b.id}`);
export const manageUrl = (base, b) => `${base}/booking/${b.id}?t=${manageToken(b)}`;
const when = (t, tz) => formatIn(tz || 'Asia/Kolkata', t);
function icsOf(b, cal, owner) {
  const z = (t) => new Date(t).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const esc = (s) => String(s || '').replace(/[\\;,]/g, (c) => `\\${c}`).replace(/\n/g, '\\n');
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//FunnelHive//Bookings//EN', 'METHOD:PUBLISH', 'BEGIN:VEVENT', `UID:${b.id}@funnelhive`, `DTSTAMP:${z(Date.now())}`, `DTSTART:${z(b.start)}`, `DTEND:${z(b.end)}`,
    `SUMMARY:${esc(`${cal.name} with ${owner?.settings?.businessName || owner?.name || ''}`.trim())}`, `DESCRIPTION:${esc([cal.meetingLink && `Join: ${cal.meetingLink}`, cal.location].filter(Boolean).join('\n'))}`,
    cal.meetingLink ? `URL:${cal.meetingLink}` : '', `LOCATION:${esc(cal.meetingLink || cal.location || '')}`, b.status === 'cancelled' ? 'STATUS:CANCELLED' : 'STATUS:CONFIRMED', 'END:VEVENT', 'END:VCALENDAR'].filter(Boolean).join('\r\n');
}
function notifyBuyer(b, kind, base) {
  const owner = T.users.get(b.userId), cal = T.calendars.get(b.calendarId);
  if (!owner || !cal) return;
  const biz = owner.settings?.businessName || owner.name;
  const link = manageUrl(base || b.base, b), ics = `${base || b.base}/api/booking/${b.id}/ics?t=${manageToken(b)}`;
  const first = String(b.name || '').split(/\s+/)[0] || 'there';
  const meet = cal.meetingLink || b.meetLink;
  const join = meet ? `\n\nJoin here: ${meet}` : cal.location ? `\n\nWhere: ${cal.location}` : '';
  const text = {
    confirmed: [`Your ${cal.name} is booked ✅`, `Hi ${first},\n\nYou’re booked for ${cal.name} with ${biz} on ${when(b.start, calTz(cal))} (${Math.round((b.end - b.start) / MIN)} minutes).${join}\n\nAdd it to your calendar: ${ics}\nNeed to change it? Reschedule or cancel here: ${link}\n\n— ${biz}`],
    day: [`Tomorrow: ${cal.name} with ${biz}`, `Hi ${first},\n\nA reminder that your ${cal.name} is on ${when(b.start, calTz(cal))}.${join}\n\nCan’t make it? Reschedule here: ${link}\n\n— ${biz}`],
    hour: [`Starting in 1 hour: ${cal.name}`, `Hi ${first},\n\nYour ${cal.name} with ${biz} starts at ${when(b.start, calTz(cal))}.${join}\n\n— ${biz}`],
    cancelled: [`Cancelled: ${cal.name} on ${when(b.start, calTz(cal))}`, `Hi ${first},\n\nYour ${cal.name} on ${when(b.start, calTz(cal))} has been cancelled.${b.cancelledBy === 'buyer' ? '' : ' Book a new time whenever you like.'}\n\n— ${biz}`],
  }[kind];
  if (text && b.email) sendEmail(owner, { to: b.email, subject: text[0], text: text[1] }).catch((e) => console.error('booking email failed', e.message));
  // the same on WhatsApp (Hive), when the buyer gave a number
  const wa = { to: b.phone, ckey: contactKey(b.email, b.phone) }, call = cal.name, at = when(b.start, calTz(cal));
  if (kind === 'confirmed') waEvent(owner, b.replaces ? 'booking_changed' : 'booking_confirmed', { ...wa, params: b.replaces ? [first, call, `moved to ${at}`] : [first, call, at], link, entityId: b.id });
  if (kind === 'day' || kind === 'hour') waEvent(owner, 'booking_reminder', { ...wa, params: [call, at], link: meet || link, entityId: `${b.id}-${kind}` });
  if (kind === 'cancelled') waEvent(owner, 'booking_changed', { ...wa, params: [first, call, 'cancelled'], link, entityId: `${b.id}-cancelled` });
  if (!b.email) return;
  // the seller hears about new bookings and cancellations
  if (kind === 'confirmed' || kind === 'cancelled') sendEmail(owner, { to: owner.email, subject: `${kind === 'confirmed' ? 'New booking' : 'Booking cancelled'}: ${b.name || b.email} · ${when(b.start, calTz(cal))}`, text: `${cal.name}\n${b.name || ''} · ${b.email}${b.phone ? ` · ${b.phone}` : ''}\n${when(b.start, calTz(cal))}${Object.entries(b.answers || {}).map(([q, a]) => `\n\n${q}\n${a}`).join('')}${b.notes ? `\n\nNotes: ${b.notes}` : ''}` }).catch(() => {});
}
const outBooking = (b, cal) => ({ id: b.id, start: b.start, end: b.end, minutes: Math.round((b.end - b.start) / MIN), status: b.status, name: b.name, email: b.email, phone: b.phone, notes: b.notes || '', answers: b.answers || null, outcome: b.outcome || null, source: b.source || null, calendar: cal ? { id: cal.id, name: cal.name, duration: cal.duration, meetingLink: cal.meetingLink || b.meetLink || '', location: cal.location || '', tzOffset: offsetAt(calTz(cal)), timezone: calTz(cal), price: cal.price || 0, currency: cal.currency || 'INR', refundHours: cal.refundHours ?? 24 } : null, funnelId: b.funnelId, at: b.at, cancelledBy: b.cancelledBy || null, paid: b.paid ? b.amount || true : null, orderId: b.orderId || null, refunded: !!b.refunded, unpaid: !!b.unpaid, google: !!b.gEventId });

// A booking (or reschedule) for one slot; refuses a slot that isn't free — checked inside one transaction
export function book(cal, { start, email, name, phone, notes, funnelId = null, stepId = null, base = '', leadId = null, replaces = null, attr, hold = false, carry = null, unpaid = false, duration, answers, source }) {
  const s = Number(start), dur = lengthOf(cal, duration);
  const ans = answers && typeof answers === 'object' && !Array.isArray(answers) ? answers : null;
  const cleanEmail = clip(email, 200).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) return { error: 'Please enter a valid email address' };
  const b = tx(() => {
    const ok = freeSlots(cal, s - DAY, Date.now(), dur).includes(s);
    if (!ok) return null;
    return T.bookings.insert({ id: uid(), userId: cal.userId, calendarId: cal.id, funnelId, stepId, leadId, email: cleanEmail, name: clip(name, 120), phone: clip(phone, 40), notes: clip(notes, 1000), start: s, end: s + dur * MIN, ...(ans && Object.keys(ans).length ? { answers: ans } : {}), ...(source ? { source } : {}), status: hold ? 'held' : 'confirmed', ...(hold ? { holdUntil: Date.now() + HOLD } : {}), at: Date.now(), base, reminded: {}, ...(replaces ? { replaces } : {}), ...(attr ? { attr } : {}), ...(carry || {}), ...(unpaid ? { unpaid: true } : {}) });
  });
  if (!b) return { error: 'That time was just taken — please pick another slot', taken: true };
  if (hold) return { booking: b };
  confirmed(b, cal, base, !!replaces);
  return { booking: b };
}
// a slot is held for this long while the buyer pays
const HOLD = 15 * MIN;
// everything that follows a confirmed booking: Google Calendar (with a Meet link), emails, webhook, automations
function confirmed(b, cal, base, rescheduled) {
  const data = { email: b.email, phone: b.phone, name: b.name, funnelId: b.funnelId, bookingTime: when(b.start, calTz(cal)), bookingLink: manageUrl(base, b), meetingLink: cal.meetingLink || '' };
  fireWebhook(cal.userId, rescheduled ? 'booking.rescheduled' : 'booking.created', { booking: outBooking(b, cal), manage: manageUrl(base, b) });
  notify(cal.userId, { kind: 'booking', title: `${rescheduled ? 'Booking moved' : 'New booking'} · ${b.name || b.email || b.phone} · ${cal.name}`, body: data.bookingTime, link: '/bookings' });
  sellerAlert(cal.userId, { kind: rescheduled ? 'booking change' : 'booking', where: cal.name, what: `${b.name || b.email || b.phone} at ${data.bookingTime}`, path: '/bookings', entityId: b.id });
  // the Google event (and its Meet link) first, so the confirmation email can include the link
  addEvent(b, cal).then((ev) => {
    const fresh = T.bookings.get(b.id) || b;
    fireAutomation(cal.userId, 'booking', { ...data, meetingLink: cal.meetingLink || ev?.meetLink || '' });
    notifyBuyer(fresh, 'confirmed', base);
  });
}

// ---------- paid calls ----------
// The webhook or the browser reports the payment: confirm the held slot, record the sale, or refund if the slot is gone
let recordSale = null;
export async function confirmPaidBooking(pay, paymentId, base) {
  if (pay.status === 'paid') return pay.result;
  const b0 = T.bookings.get(pay.bookingId);
  const cal = b0 && T.calendars.get(b0.calendarId);
  if (!b0 || !cal) return { error: 'Booking not found' };
  const owner = T.users.get(pay.userId);
  // paid after the hold ran out and someone else took the time: money back
  const clash = b0.status !== 'confirmed' && T.bookings.all({ calendarId: cal.id, status: 'confirmed', start: { gte: b0.start - DAY, lte: b0.end + DAY } }).some((x) => x.id !== b0.id && x.start < b0.end && x.end > b0.start);
  if (clash) {
    try {
      if (pay.provider === 'stripe') { const sc = stripeCreds(owner); if (sc) await stripeRefund(sc, paymentId, pay.charge.total, pay.currency || 'INR', 'slot no longer available'); }
      else { const creds = rzpCreds(owner); if (creds) await rzpCall(creds, 'POST', `/payments/${paymentId}/refund`, { amount: Math.round(pay.charge.total * 100), notes: { reason: 'slot no longer available' } }); }
    } catch (e) { console.error('auto refund failed', e.message); }
    T.bookings.update(b0.id, (x) => { x.status = 'failed'; x.refunded = true; });
    pay.status = 'paid'; pay.paymentId = paymentId; pay.result = { error: 'Sorry — that time was taken while you were paying. Your payment is being refunded; please pick another slot.', refunded: true };
    T.payments.put(pay);
    return pay.result;
  }
  const f = pay.funnelId && T.funnels.get(pay.funnelId);
  const sale = f && recordSale ? recordSale(f, pay, paymentId, base) : !f ? callSale(owner, cal, pay, paymentId, base) : null;
  const b = T.bookings.update(b0.id, (x) => { x.status = 'confirmed'; delete x.holdUntil; x.paid = true; x.amount = pay.charge.total; x.paymentId = paymentId; if (sale?.orderId) x.orderId = sale.orderId; });
  pay.status = 'paid'; pay.paymentId = paymentId; pay.paidAt = Date.now();
  pay.result = { ok: true, start: b.start, end: b.end, manage: manageUrl(base || pay.base, b), meetingLink: cal.meetingLink || '', ...(sale?.invoice ? { invoice: sale.invoice } : {}), orderId: sale?.orderId };
  T.payments.put(pay);
  if (b0.status !== 'confirmed') confirmed(b, cal, base || pay.base, false);
  return pay.result;
}
function callSale(owner, cal, pay, paymentId, base) {
  try {
    const now = Date.now(), iso = pay.currency || cal.currency || 'INR', bu = pay.buyer || {};
    const item = { name: pay.charge.items[0].name, price: pay.charge.total, kind: 'booking', at: now, paymentId, txn: '' };
    const id = uid(); item.txn = `${id}-1`;
    const order = T.orders.insert({ id, userId: owner.id, funnelId: null, funnelName: `Booking · ${cal.name}`, email: bu.email || '', name: bu.name || '', phone: bu.phone || '', items: [item], total: pay.charge.total, discount: 0, source: bu.source || 'booking page', status: 'paid', at: now, provider: pay.provider || 'razorpay', mode: pay.mode, ...(iso !== 'INR' ? { currency: iso, fx: fxRate(iso) } : {}), ...(pay.stripeCustomer ? { stripeCustomer: pay.stripeCustomer } : {}) });
    const inv = issueInvoice(owner, order, [{ index: 0, name: item.name, kind: 'booking', amount: item.price }], { paymentId });
    return { orderId: order.id, ...(inv ? { invoice: invoiceUrl(base || pay.base, inv) } : {}) };
  } catch (e) { console.error('booking sale not recorded', e.message); return null; }
}
export function cancel(b, by = 'buyer', reason = '') {
  if (b.status !== 'confirmed') return b;
  const cal = T.calendars.get(b.calendarId);
  const out = T.bookings.update(b.id, (x) => { x.status = 'cancelled'; x.cancelledBy = by; x.cancelledAt = Date.now(); x.cancelReason = clip(reason, 300); });
  removeEvent(b);
  // a paid call is refunded when the seller cancels, or the buyer cancels early enough
  if (b.paid && b.orderId && (by !== 'buyer' || b.start - Date.now() >= (cal?.refundHours ?? 24) * HOUR)) {
    const owner = T.users.get(b.userId), order = T.orders.get(b.orderId);
    if (owner && order) refundOrder(owner, order, { reason: `Booking cancelled by the ${by === 'buyer' ? 'buyer' : 'seller'}`, by }).then((r) => { if (!r?.error) T.bookings.update(b.id, (x) => { x.refunded = true; }); }).catch((e) => console.error('booking refund failed', e.message));
  }
  fireWebhook(b.userId, 'booking.cancelled', { booking: outBooking(out, cal) });
  if (by === 'buyer') notify(b.userId, { kind: 'booking_cancelled', title: `Booking cancelled · ${b.name || b.email || b.phone}${cal ? ` · ${cal.name}` : ''}`, body: [when(b.start, cal ? calTz(cal) : undefined), out.cancelReason].filter(Boolean).join(' — '), link: '/bookings' });
  fireAutomation(b.userId, 'booking_cancelled', { email: b.email, phone: b.phone, name: b.name, funnelId: b.funnelId, bookingTime: when(b.start, cal ? calTz(cal) : undefined), meetingLink: cal?.meetingLink || '' });
  notifyBuyer(out, 'cancelled');
  return out;
}

// ---------- reminders (a minute's resolution is plenty) ----------
export function reminderJob(now = Date.now()) {
  for (const b of T.bookings.all({ status: 'confirmed', start: { gt: now, lte: now + 25 * HOUR } })) {
    const cal = T.calendars.get(b.calendarId);
    if (!cal) continue;
    const left = b.start - now;
    const due = left <= HOUR + 2 * MIN ? 'hour' : left <= 24 * HOUR + 2 * MIN && left > 2 * HOUR ? 'day' : null;
    if (!due || b.reminded?.[due] || !cal.reminders?.[due]) continue;
    // claimed in a transaction so two processes never send the same reminder
    const claimed = tx(() => { const x = T.bookings.get(b.id); if (x.reminded?.[due]) return false; x.reminded = { ...x.reminded, [due]: now }; T.bookings.put(x); return true; });
    if (claimed) notifyBuyer(b, due);
  }
}
if (JOBS && process.env.NODE_ENV !== 'test') setInterval(() => { try { reminderJob(); } catch (e) { console.error('reminders failed', e.message); } }, 60000).unref();

// ---------- routes ----------
export function registerBookings(app, { auth, wrap, rateLimit, isTest, secret, appUrl, pub, isPreview, allBlocks, sale }) {
  SECRET = secret;
  recordSale = sale;
  const bookLimiter = rateLimit({ windowMs: 60000, max: isTest ? 5000 : 30 });

  // --- seller ---
  app.get('/api/calendars', auth, (req, res) => {
    defaultCalendar(req.user.id);
    // calendars from before booking pages get their address
    for (const x of calendarsOf(req.user.id)) if (!x.slug) T.calendars.update(x.id, (y) => { y.slug = uniqueSlug(req.user.id, slugify(y.name), y.id); });
    res.json(calendarsOf(req.user.id).map((c) => ({ ...c, timezone: calTz(c) }))); });
  app.post('/api/calendars', auth, (req, res) => {
    if (T.calendars.count({ userId: req.user.id }) >= 20) return res.status(400).json({ error: 'You can have up to 20 calendars' });
    const c = cleanCalendar(req.body);
    if (c.error) return res.status(400).json(c);
    c.slug = uniqueSlug(req.user.id, c.slug);
    res.json(T.calendars.insert({ ...c, id: uid(), userId: req.user.id, at: Date.now() }));
  });
  app.put('/api/calendars/:cid', auth, (req, res) => {
    const cur = T.calendars.get(req.params.cid);
    if (!cur || cur.userId !== req.user.id) return res.status(404).json({ error: 'Calendar not found' });
    const c = cleanCalendar(req.body, cur);
    if (c.error) return res.status(400).json(c);
    c.slug = uniqueSlug(req.user.id, c.slug || slugify(c.name), cur.id);
    res.json(T.calendars.put(c));
  });
  app.delete('/api/calendars/:cid', auth, (req, res) => {
    const cur = T.calendars.get(req.params.cid);
    if (!cur || cur.userId !== req.user.id) return res.status(404).json({ error: 'Calendar not found' });
    if (T.bookings.exists({ calendarId: cur.id, status: 'confirmed', start: { gt: Date.now() } })) return res.status(409).json({ error: 'This calendar has upcoming bookings — cancel them first' });
    T.calendars.del(cur.id);
    res.json({ ok: true });
  });
  app.get('/api/bookings', auth, (req, res) => {
    const from = Number(req.query.from) || Date.now() - 30 * DAY;
    const cals = Object.fromEntries(calendarsOf(req.user.id).map((c) => [c.id, c]));
    const funnels = Object.fromEntries(T.funnels.all({ userId: req.user.id }).map((f) => [f.id, f.name]));
    // slots held for a payment that never came aren't bookings
    res.json(T.bookings.all({ userId: req.user.id, start: { gte: from }, status: ['confirmed', 'cancelled', 'rescheduled'] }, { order: 'start', limit: 2000 }).map((b) => ({ ...outBooking(b, cals[b.calendarId]), funnel: funnels[b.funnelId] || null })));
  });
  // how the call went: completed or no-show (null clears it)
  app.put('/api/bookings/:bid', auth, (req, res) => {
    const b = T.bookings.get(req.params.bid);
    if (!b || b.userId !== req.user.id) return res.status(404).json({ error: 'Booking not found' });
    const o = req.body?.outcome ?? null;
    if (o !== null && !['completed', 'no_show'].includes(o)) return res.status(400).json({ error: 'Outcome must be completed or no_show' });
    res.json(outBooking(T.bookings.update(b.id, (x) => { if (o) x.outcome = o; else delete x.outcome; }), T.calendars.get(b.calendarId)));
  });
  // your booking page address
  app.get('/api/booking-page', auth, (req, res) => res.json({ handle: handleOf(req.user) }));
  app.put('/api/booking-page', auth, (req, res) => {
    // not slugify(): its 'call' fallback would turn an empty or symbols-only address into a real one
    const h = String(req.body?.handle ?? '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30);
    if (h.length < 3) return res.status(400).json({ error: 'Use at least 3 letters or numbers' });
    const other = userByHandle(h);
    if (other && other.id !== req.user.id) return res.status(409).json({ error: 'That address is taken — try another' });
    T.users.update(req.user.id, (x) => { x.bookingHandle = h; });
    res.json({ handle: h });
  });
  app.post('/api/bookings/:bid/cancel', auth, (req, res) => {
    const b = T.bookings.get(req.params.bid);
    if (!b || b.userId !== req.user.id) return res.status(404).json({ error: 'Booking not found' });
    res.json(outBooking(cancel(b, 'seller', req.body?.reason), T.calendars.get(b.calendarId)));
  });

  // one booking path for funnel pages and booking pages: free call, priced call without payments
  // (booked, marked unpaid), or a 15-minute hold while the buyer pays by UPI/card (Razorpay) or card (Stripe)
  async function startBooking(req, res, { cal, owner, base, input, funnelId = null, stepId = null, title, color }) {
    const dur = lengthOf(cal, input.duration), price = priceFor(cal, dur), iso = cal.currency || 'INR';
    const creds = price > 0 && iso === 'INR' ? rzpCreds(owner) : null, sc = price > 0 && !creds ? stripeCreds(owner) : null;
    const holdPay = (b, mode) => ({ id: uid(), userId: owner.id, funnelId, stepId, kind: 'booking', bookingId: b.id, buyer: { email: b.email, name: b.name, phone: b.phone, source: String(req.body.source || 'direct').slice(0, 40), ...(req.body.attr ? { attr: req.body.attr } : {}) }, charge: { items: [{ name: `${cal.name} (${dur} min) — ${when(b.start, calTz(cal))}`, price, kind: 'booking' }], total: price, discount: 0 }, mode, status: 'created', at: Date.now(), base });
    const shop = owner.settings?.businessName || title;
    if (sc) {
      // paid call by card: hold the slot for 15 minutes while the buyer pays in the Stripe form
      const r = book(cal, { ...input, hold: true });
      if (r.error) return res.status(r.taken ? 409 : 400).json({ error: r.error });
      const pay = { ...holdPay(r.booking, sc.mode), provider: 'stripe', currency: iso };
      let st;
      try { st = await startStripePayment(sc, { userId: owner.id, pay, iso, buyer: pay.buyer, description: pay.charge.items[0].name }); } catch (e) {
        console.error('Stripe booking payment failed', e.message);
        T.bookings.update(r.booking.id, (x) => { x.status = 'failed'; });
        return res.status(502).json({ error: 'Card payments are temporarily unavailable — please try again in a minute' });
      }
      Object.assign(pay, { stripeIntent: st.intent, stripeCustomer: st.customer, rzpOrderId: st.intent });
      T.payments.insert(pay);
      return res.json({ pay: { ...st, amount: price, currency: iso, name: shop, description: pay.charge.items[0].name.slice(0, 250), color }, holdUntil: r.booking.holdUntil });
    }
    if (creds) {
      // paid call: hold the slot for 15 minutes and open a Razorpay payment for it
      const r = book(cal, { ...input, hold: true });
      if (r.error) return res.status(r.taken ? 409 : 400).json({ error: r.error });
      const pay = holdPay(r.booking, creds.mode);
      let rz;
      try { rz = await rzpCreateOrder(creds, { amount: Math.round(price * 100), receipt: pay.id, notes: { booking: r.booking.id, payment: pay.id } }); } catch (e) {
        T.bookings.update(r.booking.id, (x) => { x.status = 'failed'; });
        return res.status(502).json({ error: 'Payments are temporarily unavailable — please try again in a minute' });
      }
      pay.rzpOrderId = rz.id;
      T.payments.insert(pay);
      return res.json({ pay: { provider: 'razorpay', payment: pay.id, key: creds.keyId, order_id: rz.id, amount: rz.amount, currency: rz.currency || 'INR', name: shop, description: pay.charge.items[0].name.slice(0, 250), prefill: { name: r.booking.name, email: r.booking.email, contact: r.booking.phone }, color }, holdUntil: r.booking.holdUntil });
    }
    // a priced call while payments aren't connected is booked, marked unpaid for the seller to collect
    const r = book(cal, { ...input, unpaid: price > 0 });
    if (r.error) return res.status(r.taken ? 409 : 400).json({ error: r.error });
    res.json({ ok: true, start: r.booking.start, end: r.booking.end, manage: manageUrl(base, r.booking), meetingLink: cal.meetingLink || '' });
  }
  const verifyRzp = async (req, res, pay, owner, base) => {
    const creds = rzpCreds(owner);
    const { razorpay_order_id: oid, razorpay_payment_id: pid, razorpay_signature: s } = req.body;
    if (!creds || oid !== pay.rzpOrderId || !validPayment(creds.secret, oid, pid, s)) return res.status(400).json({ error: 'We couldn’t confirm this payment. If money was deducted it will be refunded automatically — please contact the seller.' });
    const r = await confirmPaidBooking(pay, pid, base);
    res.status(r.error ? 409 : 200).json(r);
  };
  const verifyStripe = async (req, res, pay, owner, base) => {
    if (pay.status === 'paid') return res.status(pay.result?.error ? 409 : 200).json(pay.result);
    const sc = stripeCreds(owner);
    const id = sc && await confirmedIntent(sc, pay).catch(() => null);
    if (!id) return res.status(400).json({ error: 'We couldn’t confirm this payment yet. If money was deducted it will be refunded automatically — please contact the seller.' });
    const r = await confirmPaidBooking(pay, id, base);
    res.status(r.error ? 409 : 200).json(r);
  };
  const calInfo = (cal, owner) => ({ name: cal.name, duration: cal.duration, durations: cal.durations || [cal.duration], tzOffset: offsetAt(calTz(cal)), timezone: calTz(cal), description: cal.description || '', location: cal.meetingLink || owner?.channels?.gcal?.refreshEnc ? 'Video call' : cal.location || '', price: cal.price || 0, prices: Object.fromEntries((cal.durations || [cal.duration]).map((d) => [d, priceFor(cal, d)])), currency: cal.currency || 'INR', refundHours: cal.refundHours ?? 24, questions: cal.questions || [], ...(waRequired(owner) ? { waRequired: true } : {}) });

  // --- public: slots and booking on a funnel page ---
  const blockOf = (f, stepId, blockId) => { const st = f.steps.find((s) => s.id === stepId); return st && allBlocks(st).find((b) => b.id === blockId && b.type === 'booking'); };
  app.get('/api/public/:slug/slots', wrap(async (req, res) => {
    const f = pub(req, res);
    if (!f) return;
    const blk = blockOf(f, req.query.stepId, req.query.blockId);
    if (!blk) return res.status(404).json({ error: 'Calendar not found' });
    const cal = calendarFor(f.userId, blk.props.calendarId);
    await refreshBusy(f.userId, cal.daysAhead + 1);
    const dur = lengthOf(cal, req.query.d);
    res.json({ calendar: calInfo(cal, T.users.get(f.userId)), duration: dur, slots: freeSlots(cal, Date.now(), Date.now(), dur) });
  }));
  app.post('/api/public/:slug/book', bookLimiter, wrap(async (req, res) => {
    const f = pub(req, res);
    if (!f) return;
    const blk = blockOf(f, req.body?.stepId, req.body?.blockId);
    if (!blk) return res.status(404).json({ error: 'Calendar not found' });
    const cal = calendarFor(f.userId, blk.props.calendarId);
    if (isPreview(req)) return res.json({ ok: true, preview: true, start: Number(req.body.start) });
    // application funnels: only applicants who qualified may book
    const rules = f.steps.flatMap((s) => allBlocks(s)).some((b) => b.type === 'form' && (b.props.fields || []).some((x) => x.reject));
    const ckey = contactKey(req.body.email);
    if (rules && blk.props.qualifiedOnly !== false && !T.leads.all({ funnelId: f.id, ckey }).some((l) => l.qualified === true)) return res.status(403).json({ error: 'Please complete the application first — booking opens once it’s approved' });
    await refreshBusy(f.userId, cal.daysAhead + 1);
    const base = linkBase(f.id, process.env.APP_URL || appUrl(req));
    const ans = cleanAnswers(cal, req.body.answers);
    if (ans.error) return res.status(400).json({ error: ans.error });
    const owner = T.users.get(f.userId);
    if (waRequired(owner) && !waPhoneOk(req.body.phone)) return res.status(400).json({ error: 'Please enter your WhatsApp number' });
    const input = { start: req.body.start, email: req.body.email, name: req.body.name, phone: req.body.phone, notes: req.body.notes, duration: req.body.duration, answers: ans.answers, funnelId: f.id, stepId: req.body.stepId, base, attr: req.body.attr, source: 'funnel' };
    await startBooking(req, res, { cal, owner, base, input, funnelId: f.id, stepId: req.body.stepId, title: f.name, color: f.theme?.primary || '#b45309' });
  }));
  app.post('/api/public/:slug/book/verify', bookLimiter, wrap(async (req, res) => {
    const f = pub(req, res);
    if (!f) return;
    const pay = T.payments.get(req.body?.payment);
    if (!pay || pay.funnelId !== f.id || pay.kind !== 'booking') return res.status(404).json({ error: 'Payment not found' });
    await verifyRzp(req, res, pay, T.users.get(f.userId), linkBase(f.id, process.env.APP_URL || appUrl(req)));
  }));

  // a card payment confirmed in the Stripe form: read it back from Stripe before the slot counts as paid
  app.post('/api/public/:slug/book/stripe/verify', bookLimiter, wrap(async (req, res) => {
    const f = pub(req, res);
    if (!f) return;
    const pay = T.payments.get(req.body?.payment);
    if (!pay || pay.funnelId !== f.id || pay.kind !== 'booking' || pay.provider !== 'stripe') return res.status(404).json({ error: 'Payment not found' });
    await verifyStripe(req, res, pay, T.users.get(f.userId), linkBase(f.id, process.env.APP_URL || appUrl(req)));
  }));

  // --- public: your own booking pages, /meet/<handle> and /meet/<handle>/<call> ---
  const meetLimiter = rateLimit({ windowMs: 60000, max: isTest ? 5000 : 120 });
  const sellerOf = (req, res) => { const u = userByHandle(req.params.handle); if (!u) res.status(404).json({ error: 'This booking page doesn’t exist' }); return u; };
  const meetCal = (req, res, u) => { const cal = calendarsOf(u.id).find((x) => (x.slug || slugify(x.name)) === req.params.cal); if (!cal) res.status(404).json({ error: 'This call type doesn’t exist any more' }); return cal; };
  const sellerInfo = (u) => ({ name: u.settings?.businessName || u.name || '', person: u.name || '', logo: u.settings?.logo || '' });
  const meetBase = (req) => process.env.APP_URL || appUrl(req);
  app.get('/api/meet/:handle', meetLimiter, (req, res) => {
    const u = sellerOf(req, res); if (!u) return;
    res.set('Cache-Control', 'no-store').json({ seller: sellerInfo(u), calendars: calendarsOf(u.id).filter((x) => x.listed !== false).map((x) => ({ slug: x.slug || slugify(x.name), name: x.name, description: x.description || '', durations: x.durations || [x.duration], price: x.price || 0, currency: x.currency || 'INR', color: x.color || '' })) });
  });
  app.get('/api/meet/:handle/:cal', meetLimiter, wrap(async (req, res) => {
    const u = sellerOf(req, res); if (!u) return;
    const cal = meetCal(req, res, u); if (!cal) return;
    await refreshBusy(u.id, cal.daysAhead + 1);
    const dur = lengthOf(cal, req.query.d);
    res.set('Cache-Control', 'no-store').json({ seller: sellerInfo(u), calendar: calInfo(cal, u), duration: dur, slots: freeSlots(cal, Date.now(), Date.now(), dur) });
  }));
  app.post('/api/meet/:handle/:cal/book', bookLimiter, wrap(async (req, res) => {
    const u = sellerOf(req, res); if (!u) return;
    const cal = meetCal(req, res, u); if (!cal) return;
    const ans = cleanAnswers(cal, req.body?.answers);
    if (ans.error) return res.status(400).json({ error: ans.error });
    if (waRequired(u) && !waPhoneOk(req.body?.phone)) return res.status(400).json({ error: 'Please enter your WhatsApp number' });
    await refreshBusy(u.id, cal.daysAhead + 1);
    const base = meetBase(req);
    const input = { start: req.body.start, email: req.body.email, name: req.body.name, phone: req.body.phone, notes: req.body.notes, duration: req.body.duration, answers: ans.answers, base, attr: req.body.attr, source: 'booking page' };
    await startBooking(req, res, { cal, owner: u, base, input, title: sellerInfo(u).name || cal.name, color: '#b45309' });
  }));
  const meetPay = (req, res, u) => { const pay = T.payments.get(req.body?.payment); if (!pay || pay.userId !== u.id || pay.funnelId || pay.kind !== 'booking') { res.status(404).json({ error: 'Payment not found' }); return null; } return pay; };
  app.post('/api/meet/:handle/:cal/verify', bookLimiter, wrap(async (req, res) => {
    const u = sellerOf(req, res); if (!u) return;
    const pay = meetPay(req, res, u); if (!pay) return;
    await verifyRzp(req, res, pay, u, meetBase(req));
  }));
  app.post('/api/meet/:handle/:cal/stripe/verify', bookLimiter, wrap(async (req, res) => {
    const u = sellerOf(req, res); if (!u) return;
    const pay = meetPay(req, res, u); if (!pay || pay.provider !== 'stripe') { if (pay) res.status(404).json({ error: 'Payment not found' }); return; }
    await verifyStripe(req, res, pay, u, meetBase(req));
  }));

  // --- public: the buyer's manage link (reschedule / cancel / add to calendar) ---
  const byToken = (req, res) => {
    const b = T.bookings.get(req.params.bid);
    if (!b || !same(String(req.query.t || req.body?.t || ''), manageToken(b))) { res.status(404).json({ error: 'Booking not found' }); return null; }
    return b;
  };
  app.get('/api/booking/:bid', (req, res) => {
    const b = byToken(req, res); if (!b) return;
    const cal = T.calendars.get(b.calendarId), owner = T.users.get(b.userId);
    res.set('Cache-Control', 'no-store').json({ ...outBooking(b, cal), seller: owner?.settings?.businessName || owner?.name || '', slots: b.status === 'confirmed' && cal ? freeSlots(cal, Date.now(), Date.now(), Math.round((b.end - b.start) / MIN)) : [], canChange: b.status === 'confirmed' && b.start > Date.now() });
  });
  app.get('/api/booking/:bid/ics', (req, res) => {
    const b = byToken(req, res); if (!b) return;
    res.set({ 'Content-Type': 'text/calendar; charset=utf-8', 'Content-Disposition': `attachment; filename="booking.ics"` }).send(icsOf(b, T.calendars.get(b.calendarId) || { name: 'Call' }, T.users.get(b.userId)));
  });
  app.post('/api/booking/:bid/cancel', bookLimiter, (req, res) => {
    const b = byToken(req, res); if (!b) return;
    if (b.start < Date.now()) return res.status(400).json({ error: 'This call has already happened' });
    res.json(outBooking(cancel(b, 'buyer', req.body?.reason), T.calendars.get(b.calendarId)));
  });
  app.post('/api/booking/:bid/reschedule', bookLimiter, (req, res) => {
    const b = byToken(req, res); if (!b) return;
    if (b.status !== 'confirmed' || b.start < Date.now()) return res.status(400).json({ error: 'This booking can’t be changed any more' });
    const cal = T.calendars.get(b.calendarId);
    // the old time stops counting before the new one is checked (a slot right next to it may need its buffer)
    const r = book(cal, { start: req.body?.start, email: b.email, name: b.name, phone: b.phone, notes: b.notes, duration: Math.round((b.end - b.start) / MIN), answers: b.answers, source: b.source, funnelId: b.funnelId, stepId: b.stepId, base: b.base, replaces: b.id, carry: b.paid ? { paid: true, amount: b.amount, paymentId: b.paymentId, orderId: b.orderId } : b.unpaid ? { unpaid: true } : null });
    if (r.error) return res.status(r.taken ? 409 : 400).json({ error: r.error });
    T.bookings.update(b.id, (x) => { x.status = 'rescheduled'; x.movedTo = r.booking.id; });
    removeEvent(b);
    res.json({ ...outBooking(r.booking, cal), manage: manageUrl(b.base || process.env.APP_URL || appUrl(req), r.booking) });
  });
}
