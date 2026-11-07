// Hive teammates: specialists the seller "hires" inside Hive AI — a Sales Manager, an Accountant, a Marketer…
// Each one has a name, a role and its own instructions; works only with the tool groups it's allowed (a teammate
// that keeps the books can't publish a funnel); can be told to ask before every change; and can run a task on a
// schedule (a morning follow-up list). A scheduled run never acts on its own: anything that would change
// something waits as a Confirm card in the teammate's chat, and the seller hears about it in the bell and on
// WhatsApp. Teammates live on the account (settings.hiveTeam), so a team shares them.
import { T, q, uid, JOBS } from './db.js';
import { sellerTz } from './tz.js';
import { notify } from './notify.js';

export const MAX_TEAM = 8;
const DAYS = [0, 1, 2, 3, 4, 5, 6]; // Sunday = 0
const clip = (v, n) => String(v ?? '').trim().slice(0, n);

// ready-made teammates for Indian small businesses; the seller can rename and change every one
export const PRESETS = [
  {
    preset: 'sales', name: 'Sales Manager', emoji: '🤝', color: '#16a34a', role: 'Leads, follow-ups, calls and quotes',
    groups: ['crm', 'automations', 'calls', 'quotes', 'broadcasts', 'apps', 'vault'], core: false, askFirst: false,
    instructions: 'Keep every lead moving. Spot hot leads that went quiet, list who to call or WhatsApp today and why, and draft follow-up messages in the customer’s language (Hinglish is fine). Never send a broadcast unless the seller says so.',
    schedule: { on: true, time: '09:30', days: [1, 2, 3, 4, 5, 6], task: 'Morning follow-up list: new leads since yesterday, hot leads not contacted for 2+ days, and today’s calls / site visits. For each, one line on what to say. Draft follow-ups, but don’t send anything.', whatsapp: true },
  },
  {
    preset: 'accounts', name: 'Accountant', emoji: '📒', color: '#0ea5e9', role: 'Tally, money owed both ways, payment reminders',
    groups: ['tally', 'inventory', 'vault', 'apps'], core: false, askFirst: true,
    instructions: 'Look after the books. Be exact with amounts (₹, Indian number format) and dates; never guess a figure. Flag overdue money first. Anything saved into Tally or sent to a party waits for the seller’s OK.',
    schedule: { on: true, time: '10:00', days: [1], task: 'Weekly money check: who owes us the most and for how long, bills we must pay this week, and anything unusual in last week’s vouchers. Suggest payment reminders for the oldest dues.', whatsapp: true },
  },
  {
    preset: 'marketing', name: 'Marketer', emoji: '📣', color: '#f59e0b', role: 'Funnels, offers, ads and Studio creatives',
    groups: ['sections', 'selling', 'ads', 'studio', 'website', 'broadcasts', 'web'], core: true, askFirst: false,
    instructions: 'Grow sales. Look at traffic, conversion and ad results before suggesting changes, and propose one clear test at a time. Write copy that is specific and local to the seller’s customers.',
    schedule: { on: false, time: '11:00', days: [1], task: 'Weekly growth check: last 7 days of funnel traffic, conversion and sales (and ads if connected). Name the one change most likely to bring more sales, and draft it.', whatsapp: false },
  },
  {
    preset: 'support', name: 'Customer Support', emoji: '💬', color: '#8b5cf6', role: 'Customers, orders, bookings and members',
    groups: ['crm', 'calls', 'school', 'selling'], core: false, askFirst: true,
    instructions: 'Help the seller look after customers: find a customer’s orders, bookings and course progress, and draft polite, warm replies in the customer’s language. Never promise refunds or discounts the seller hasn’t approved.',
    schedule: { on: false, time: '18:00', days: [1, 2, 3, 4, 5], task: 'End-of-day check: unhappy reviews, failed payments, cancelled bookings and members stuck in a course today. Draft a reply for each.', whatsapp: false },
  },
  {
    preset: 'stock', name: 'Store & Stock Manager', emoji: '📦', color: '#ef4444', role: 'Stock, reorders, godowns and dead stock',
    groups: ['inventory', 'inventory_pro', 'tally'], core: false, askFirst: true,
    instructions: 'Keep the shelves right: low stock, what to reorder and how much (from recent sales), batches near expiry, and stock that isn’t moving. Use units the seller uses (bags, boxes, pcs).',
    schedule: { on: true, time: '19:00', days: [1, 2, 3, 4, 5, 6], task: 'Evening stock report: items below reorder level with a suggested order quantity, batches expiring in 30 days, and the top 5 slow-moving items.', whatsapp: true },
  },
  {
    preset: 'academy', name: 'Academy Manager', emoji: '🎓', color: '#0d9488', role: 'Students, questions, community and courses',
    groups: ['school', 'vault'], core: false, askFirst: true,
    instructions: 'Look after the Academy’s students. Spot who is stuck or hasn’t started, answer questions under lessons warmly and clearly in the student’s language, keep the community lively, and suggest course fixes where many students drop off. Answers and posts reach students, so they wait for the seller’s OK.',
    schedule: { on: true, time: '09:00', days: [1, 2, 3, 4, 5, 6], task: 'Morning Academy check: unanswered student questions (draft an answer for each), students stuck for 7+ days or not started (who, which course, how far), and new community posts that need a reply. End with the one course fix that would help most.', whatsapp: true },
  },
  {
    preset: 'creative', name: 'Creative Director', emoji: '🎬', color: '#ec4899', role: 'Reels, posters and product shots in Studio',
    groups: ['studio'], core: false, askFirst: false,
    instructions: 'Make scroll-stopping creatives for the seller’s brand: strong hook in the first second, the brand kit’s colours and fonts, and text in the language the customers read. Always say what a paid creation costs before making it.',
    schedule: { on: false, time: '10:30', days: [1, 4], task: 'Plan this week’s posts: three post ideas tied to what is selling and any festival this week, with the hook and caption for each.', whatsapp: false },
  },
];

// a teammate as saved: only known groups, sane limits; `groups` is the Hive tool-group ids that exist
export function cleanMate(b = {}, cur = {}, groups = []) {
  const out = { ...cur };
  if (!out.id) out.id = uid();
  for (const [k, n] of [['name', 40], ['role', 120], ['instructions', 2000]]) if (k in b) out[k] = clip(b[k], n);
  if ('emoji' in b) out.emoji = clip(b.emoji, 8) || '✨';
  if ('color' in b) out.color = /^#[0-9a-f]{6}$/i.test(b.color || '') ? b.color : '#6366f1';
  if ('groups' in b) out.groups = [...new Set((Array.isArray(b.groups) ? b.groups : []).filter((g) => groups.includes(g)))];
  if ('core' in b) out.core = !!b.core;
  if ('askFirst' in b) out.askFirst = !!b.askFirst;
  if ('memory' in b) out.memory = !!b.memory; // uses Hive's memory (on unless switched off)
  if ('learn' in b) out.learn = !!b.learn; // drafts skills from its chats each night (on unless switched off)
  if ('pinned' in b) out.pinned = !!b.pinned; // shown first in the team list
  if ('preset' in b && !cur.preset) out.preset = clip(b.preset, 20);
  if ('schedule' in b) {
    const s = b.schedule || {}, was = cur.schedule || {};
    out.schedule = {
      on: !!s.on,
      time: /^([01]\d|2[0-3]):[0-5]\d$/.test(s.time || '') ? s.time : was.time || '09:30',
      days: [...new Set((Array.isArray(s.days) ? s.days : was.days || DAYS).map(Number).filter((d) => DAYS.includes(d)))].sort(),
      task: clip(s.task ?? was.task, 600),
      whatsapp: !!s.whatsapp,
    };
    if (out.schedule.on && (!out.schedule.task || !out.schedule.days.length)) out.schedule.on = false; // nothing to do, or never
  }
  if (!out.name) out.name = 'Teammate';
  if (!out.emoji) out.emoji = '✨';
  if (!out.color) out.color = '#6366f1';
  if (!Array.isArray(out.groups)) out.groups = [];
  return out;
}
export const teamOf = (u) => (Array.isArray(u?.settings?.hiveTeam) ? u.settings.hiveTeam : []);
export const mateOf = (u, id) => (id ? teamOf(u).find((m) => m.id === id) || null : null);

// what the model is told when it works as this teammate
export function mateNote(m, about = {}) {
  const areas = m.groups.map((g) => about[g] ? `${g} (${about[g]})` : g).join('; ');
  return `\n\nYou are working as “${m.name}”, the seller's ${m.role || 'teammate'} inside Hive (not the general Hive builder). ${m.instructions || ''}
Your tools cover only: ${m.core ? 'building and editing funnels; ' : ''}${areas || 'reading the account'}. If the seller asks for something outside your work, say in one line which teammate or the main Hive chat can do it — don't attempt it.${m.askFirst ? ' Every change you make waits for the seller’s Confirm; describe each in one line.' : ''} Start replies with the answer, not a greeting.`;
}

// the minute a teammate's task is due in the seller's own time zone → 'YYYY-MM-DD' (its day), else null
export function dueDay(m, tz, now = new Date()) {
  const s = m?.schedule;
  if (!s?.on || !s.task) return null;
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short', hourCycle: 'h23' }).formatToParts(now).map((p) => [p.type, p.value]));
  const dow = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday);
  if (!s.days.includes(dow) || `${parts.hour}:${parts.minute}` < s.time) return null; // a late tick still runs it (same day)
  const day = `${parts.year}-${parts.month}-${parts.day}`;
  return m.lastRunDay === day ? null : day;
}

// the accounts that have a scheduled teammate (looked up again every 10 minutes, not every tick)
let withTeam = { at: 0, ids: [] };
const scheduledUsers = () => {
  if (Date.now() - withTeam.at > 600000) {
    withTeam = { at: Date.now(), ids: q("SELECT id FROM users WHERE json_extract(data, '$.settings.hiveTeam') IS NOT NULL").all().map((r) => r.id) };
  }
  return withTeam.ids;
};
export const forgetTeamCache = () => { withTeam.at = 0; };

// a run that started this long ago and never finished was interrupted (a turn gives up well before this)
export const RUN_STALE_MS = Number(process.env.HIVE_RUN_STALE_MS) || 20 * 60000;
// the teammate's last run: { status: running | done | failed, startedAt, endedAt, day, threadId, error }
export function setRun(userId, mateId, run, keepStart = false) {
  T.users.update(userId, (u) => {
    const m = teamOf(u).find((x) => x.id === mateId);
    if (m) m.lastRun = { ...(keepStart ? { startedAt: m.lastRun?.startedAt } : {}), ...run };
  });
}

// marks a teammate's run for the day (so a restart or a slow tick never runs it twice)
export function markRun(userId, mateId, day) {
  let claimed = false;
  T.users.update(userId, (u) => {
    const m = teamOf(u).find((x) => x.id === mateId);
    if (m && m.lastRunDay !== day) { m.lastRunDay = day; m.lastRunAt = Date.now(); claimed = true; }
  });
  return claimed;
}

// every minute: run the teammates whose time has come. `run(user, mate, { scheduled })` does the work (hive.js)
export function startTeamJobs(run, view = (m) => m) {
  if (!JOBS || process.env.NODE_ENV === 'test') return;
  const busy = new Set();
  setInterval(() => {
    for (const id of scheduledUsers()) {
      const u = T.users.get(id);
      if (!u) continue;
      const tz = sellerTz(u);
      for (const m of teamOf(u)) {
        // a run that never finished: the seller hears once, and Retry waits for them in the team dialog
        if (m.lastRun?.status === 'running' && !busy.has(`${u.id}:${m.id}`) && view(m).lastRun.status === 'interrupted') {
          setRun(u.id, m.id, { ...m.lastRun, status: 'interrupted' });
          notify(u.id, { kind: 'hive', title: `${m.name}’s task stopped before finishing`, body: 'Check what it already did in its chat, then press Retry in Hive → Your AI team.', link: m.lastRun.threadId ? `/hive?thread=${m.lastRun.threadId}` : '/hive' });
        }
        const day = dueDay(m, tz);
        const key = `${u.id}:${m.id}`;
        if (!day || busy.has(key) || !markRun(u.id, m.id, day)) continue;
        busy.add(key);
        run(u, m, { scheduled: day }).catch((e) => {
          console.error(`teammate ${m.name} (${u.id}) failed:`, e.message);
          notify(u.id, { kind: 'hive', title: `${m.name} couldn’t finish today’s task`, body: e.message, link: '/hive' });
        }).finally(() => busy.delete(key));
      }
    }
  }, 60000).unref();
}
