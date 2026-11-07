// Team rooms: one Hive chat with several teammates in it ("Launch room": Marketer, Sales Manager, Creative Director).
// The seller writes once and the right teammate answers — the one they @mention ("@everyone" asks them all), else
// the one whose work fits the message best. A teammate can hand part of the job to another in the room
// (ask_teammate); each keeps only its own tools, and anything that would change something still waits for the
// seller's Confirm. A room can have a regular task (a morning stand-up): every member reports, then one combined
// summary for the bell (and WhatsApp). Kept on the chat itself: thread.room { name, members, schedule, lastRunDay }.
import { uid } from './db.js';

export const ROOM_MAX = 6; // members in a room
export const HOPS_MAX = 3; // hand-offs in one reply
const DAYS = [0, 1, 2, 3, 4, 5, 6];
const clip = (v, n) => String(v ?? '').trim().slice(0, n);

// a room as saved: real teammates only (2–6), a name, and an optional regular task like a teammate's
export function cleanRoom(b = {}, cur = {}, team = []) {
  const out = { ...cur };
  if ('name' in b || !cur.name) out.name = clip(b.name, 40) || 'Team room';
  if ('members' in b || !cur.members) out.members = [...new Set((Array.isArray(b.members) ? b.members : []).map(String))].filter((id) => team.some((m) => m.id === id)).slice(0, ROOM_MAX);
  if ('schedule' in b) {
    const s = b.schedule || {}, was = cur.schedule || {};
    out.schedule = {
      on: !!s.on,
      time: /^([01]\d|2[0-3]):[0-5]\d$/.test(s.time || '') ? s.time : was.time || '09:30',
      days: [...new Set((Array.isArray(s.days) ? s.days : was.days || [1, 2, 3, 4, 5, 6]).map(Number).filter((d) => DAYS.includes(d)))].sort(),
      task: clip(s.task ?? was.task, 600),
      whatsapp: !!s.whatsapp,
    };
    if (out.schedule.on && (!out.schedule.task || !out.schedule.days.length)) out.schedule.on = false;
  }
  if (!out.id) out.id = uid();
  return out;
}
export const roomMembers = (room, team) => (room?.members || []).map((id) => team.find((m) => m.id === id)).filter(Boolean);

// who the message is addressed to: "@Riya", "@sales manager", "Marketer, …" at the start; "@everyone" / "@all" / "@team" = all
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export function mentioned(text, members) {
  const s = String(text || '');
  if (/(^|\s)@(everyone|all|team|sab|sabhi)\b/i.test(s)) return members;
  const hit = members.filter((m) => {
    const names = [m.name, m.name.split(/[\s—–-]+/)[0]].filter((x) => x && x.length >= 3);
    return names.some((n) => new RegExp(`(^|\\s)@${esc(n)}\\b`, 'i').test(s) || new RegExp(`^\\s*${esc(n)}\\s*[,:]`, 'i').test(s));
  });
  return hit;
}
// with no mention: the member whose areas fit the message best (score = how many of the message's tool groups they
// cover; their name or role words count too); a tie goes to whoever spoke last, then to the first member
export function pickMember(text, members, groupsOf, lastBy = null) {
  if (!members.length) return null;
  const want = groupsOf(text);
  const stem = (w) => w.replace(/(es|s)$/, ''); // reel / reels, poster / posters
  const words = new Set((String(text).toLowerCase().match(/[\p{L}\p{N}]{4,}/gu) || []).map(stem));
  // a specialist beats a generalist on its own ground: matches count for less the more areas a teammate covers
  const score = (m) => (m.groups.filter((g) => want.has(g)).length * 3) / Math.sqrt(Math.max(1, m.groups.length)) + (m.core && want.has('sections') ? 2 : 0)
    + String(`${m.name} ${m.role || ''}`).toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 4 && words.has(stem(w))).length;
  const ranked = members.map((m, i) => ({ m, s: score(m), last: m.id === lastBy ? 1 : 0, i })).sort((a, b) => b.s - a.s || b.last - a.last || a.i - b.i);
  return ranked[0].m;
}

// what each member is told about the room
export function roomNote(room, members, me) {
  const others = members.filter((m) => m.id !== me.id);
  return `\n\nYou're in the team room “${room.name}” with: ${others.map((m) => `${m.name} (${m.role || 'teammate'})`).join('; ')}. The seller's messages here may be for any of you; answer what's yours. If part of the job belongs to another member's work (their tools, not yours), call ask_teammate with their name and exactly what you need, then use their answer — don't tell the seller to go ask them. Messages in this chat starting with [Name] are what that teammate said.`;
}

// the minute a room's task is due in the seller's time zone → its day 'YYYY-MM-DD', else null
export function roomDue(room, tz, now = new Date()) {
  const s = room?.schedule;
  if (!s?.on || !s.task) return null;
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short', hourCycle: 'h23' }).formatToParts(now).map((p) => [p.type, p.value]));
  const dow = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday);
  if (!s.days.includes(dow) || `${parts.hour}:${parts.minute}` < s.time) return null;
  const day = `${parts.year}-${parts.month}-${parts.day}`;
  return room.lastRunDay === day ? null : day;
}

const S = (props, required = []) => ({ type: 'object', properties: props, required, additionalProperties: false });
export const TOOLS = [
  {
    name: 'ask_teammate', description: 'In a team room only: hand part of the job to another teammate in this room (they use their own tools) — e.g. ask the Creative Director for the poster, the Accountant for who owes money. Give their name and exactly what you need; their answer comes back to you.',
    schema: S({ teammate: { type: 'string', description: 'Their name, as in the room' }, request: { type: 'string', description: 'What you need from them, in full' } }, ['teammate', 'request']),
    run: async (ctx, a) => { if (!ctx.askTeammate) throw new Error('Only works in a team room'); return ctx.askTeammate(a.teammate, a.request); },
    summary: (r) => `Asked ${r.teammate}`,
  },
];
export const OK = {};
