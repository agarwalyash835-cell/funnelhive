// Payment reminders for unpaid Tally bills (bills receivable): one tap on a bill, or automatically for overdue bills —
// WhatsApp (the approved fh_payment_due template) and / or email, to the party's number and email from the bill, its
// ledger or the CRM. Each send is kept on the bill (survives syncs) and on the contact's timeline.
// Settings (u.tally): contacts (Tally → CRM, tally-crm.js), reminders { on, afterDays, everyDays, channel }, payNote
// (how customers pay: UPI ID, bank details) — added to reminder emails.
import { T, JOBS, contactKey } from './db.js';
import { sendEmail } from './messaging.js';
import { waEvent } from './hive-wa.js';
import { logActivity } from './crm.js';
import { tallyOn, selectedCompany } from './tally.js';

const DAY = 86400000;
const inr = (n) => `₹${Math.round(Number(n) || 0).toLocaleString('en-IN')}`;
const fmt = (d) => (d ? new Date(`${d}T00:00:00+05:30`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }) : '');
const phone10 = (p) => { const d = String(p || '').replace(/\D/g, ''); return d.length >= 10 ? d.slice(-10) : ''; };
export const REMIND_DEFAULTS = { on: false, afterDays: 1, everyDays: 7, channel: 'both' };
export const tallyPrefs = (u) => ({ contacts: u?.tally?.contacts !== false, reminders: { ...REMIND_DEFAULTS, ...(u?.tally?.reminders || {}) }, payNote: u?.tally?.payNote || '' });

// where to reach the party: the bill, then its ledger
const reach = (o) => {
  const l = (o.ledgerId && T.tledgers.get(o.ledgerId)) || null;
  const email = String(o.party_email || l?.email || '').trim().toLowerCase(), phone = phone10(o.party_phone || l?.phone);
  return { email, phone, key: contactKey(email, phone) };
};

// → { whatsapp: status, email: status } (status: sent | off | no-phone | no-email | failed…)
export async function remind(u, o, channel = 'both') {
  if (o.bill_type === 'PAYABLE') throw Object.assign(new Error('Reminders are for money owed to you'), { status: 400 });
  if (!['PENDING', 'PARTIAL', 'OVERDUE'].includes(o.status)) throw Object.assign(new Error('This bill is already paid'), { status: 400 });
  const biz = u.settings?.businessName || u.name || 'us';
  const { email, phone, key } = reach(o);
  const due = Number(o.pending_amount ?? o.amount ?? 0), bill = o.bill_number || 'on account';
  const out = {};
  if (channel !== 'email') {
    if (!phone) out.whatsapp = 'no-phone';
    else out.whatsapp = (await waEvent(u, 'payment_due', { to: phone, params: [String(o.party_name).split(/\s+/)[0], biz, bill, inr(due), fmt(o.due_date) || 'its due date'], entityId: `${o.id}:${new Date().toISOString().slice(0, 10)}`, ckey: key })).status;
  }
  if (channel !== 'whatsapp') {
    if (!email) out.email = 'no-email';
    else {
      const pay = tallyPrefs(u).payNote;
      const text = `Hi ${o.party_name},\n\nThis is a friendly reminder that bill ${bill} for ${inr(due)}${o.due_date ? ` was due on ${fmt(o.due_date)}` : ' is pending'}.${o.days_overdue > 0 ? ` It is now ${o.days_overdue} day${o.days_overdue === 1 ? '' : 's'} past due.` : ''}\n\n${pay ? `How to pay:\n${pay}\n\n` : ''}If you have already paid, please reply with the payment reference so we can update our records.\n\nThank you,\n${biz}`;
      try { out.email = (await sendEmail(u, { to: email, subject: `Payment reminder: bill ${bill} — ${inr(due)}`, text })).status; } catch (e) { out.email = 'failed'; console.error('Tally reminder email failed', e.message); }
    }
  }
  const sent = Object.values(out).includes('sent');
  if (sent) {
    T.touts.update(o.id, (x) => { x.reminders = [...(x.reminders || []), { at: Date.now(), ...out }].slice(-20); x.lastReminderAt = Date.now(); });
    if (key && out.email === 'sent') logActivity(u.id, key, { type: 'email', title: `Payment reminder: bill ${bill} (${inr(due)})`, text: 'Sent from Tally', status: 'sent' });
  }
  return out;
}

// automatic: overdue bills afterDays past due, again every everyDays; a few per seller per run
export async function reminderJob(now = Date.now()) {
  for (const u of T.users.iter()) {
    if (!tallyOn(u)) continue;
    const p = tallyPrefs(u).reminders;
    if (!p.on) continue;
    const company = selectedCompany(u.id);
    if (!company) continue;
    let n = 0;
    for (const o of T.touts.all({ companyId: company.id, active: 1, status: 'OVERDUE' })) {
      if (n >= 25) break;
      if (o.bill_type === 'PAYABLE' || (o.days_overdue || 0) < p.afterDays) continue;
      if (o.lastReminderAt && now - o.lastReminderAt < p.everyDays * DAY) continue;
      n++;
      await remind(u, o, p.channel).catch((e) => console.error('Tally auto-reminder failed', e.message));
    }
  }
}

export function registerTallyReminders(app, { auth, wrap, rateLimit, isTest }) {
  const on = (req, res, next) => (tallyOn(req.user) ? next() : res.status(403).json({ error: 'Tally isn’t switched on for your account', code: 'TALLY_OFF' }));
  const limit = rateLimit({ windowMs: 60000, max: isTest ? 1000 : 30, key: (req) => req.user.id, message: 'Too many reminders at once — wait a minute.' });
  app.get('/api/tally/settings', auth, on, (req, res) => res.json(tallyPrefs(req.user)));
  app.put('/api/tally/settings', auth, on, (req, res) => {
    const b = req.body || {}, cur = tallyPrefs(req.user);
    const r = b.reminders || {};
    const next = {
      contacts: b.contacts == null ? cur.contacts : !!b.contacts,
      reminders: { on: r.on == null ? cur.reminders.on : !!r.on, afterDays: Math.min(90, Math.max(0, Math.round(Number(r.afterDays ?? cur.reminders.afterDays) || 0))), everyDays: (() => { const n = Number(r.everyDays ?? cur.reminders.everyDays); return Number.isFinite(n) ? Math.min(60, Math.max(1, Math.round(n))) : 7; })(), channel: ['whatsapp', 'email', 'both'].includes(r.channel) ? r.channel : cur.reminders.channel },
      payNote: b.payNote == null ? cur.payNote : String(b.payNote).slice(0, 500),
    };
    T.users.update(req.user.id, (u) => { u.tally = { ...u.tally, ...next }; });
    res.json(next);
  });
  app.post('/api/tally/outstandings/:id/remind', auth, on, limit, wrap(async (req, res) => {
    const o = T.touts.get(req.params.id);
    if (!o || o.userId !== req.user.id) return res.status(404).json({ error: 'Bill not found' });
    try { res.json(await remind(T.users.get(req.user.id), o, ['whatsapp', 'email', 'both'].includes(req.body?.channel) ? req.body.channel : 'both')); } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  }));
  // twice a day is plenty: it only acts on bills that are due a reminder
  if (JOBS && !isTest) { setTimeout(() => reminderJob().catch(() => {}), 120000).unref(); setInterval(() => reminderJob().catch((e) => console.error('Tally reminders failed', e.message)), 12 * 3600000).unref(); }
}
