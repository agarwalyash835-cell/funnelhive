// Time zones: sellers, booking calendars and webinars each have an IANA zone (Asia/Kolkata, America/New_York,
// Europe/London…) so schedules follow local clocks — daylight saving included. Older calendars and webinars stored
// a fixed UTC offset in minutes (tzOffset); they keep working as "fixed:<minutes>" zones.
export const DEFAULT_TZ = 'Asia/Kolkata';
const fmtCache = new Map();
const partsFmt = (tz) => {
  if (!fmtCache.has(tz)) fmtCache.set(tz, new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }));
  return fmtCache.get(tz);
};
export function validTz(tz) {
  if (/^fixed:-?\d{1,3}$/.test(String(tz))) return true;
  try { partsFmt(String(tz)); return true; } catch { return false; }
}
// the zone a calendar / webinar / seller uses
export const tzOf = (x, fallback = DEFAULT_TZ) => (x?.timezone && validTz(x.timezone) ? x.timezone : x?.tzOffset != null && x.tzOffset !== 330 ? `fixed:${x.tzOffset}` : fallback);
export const sellerTz = (u) => (u?.settings?.timezone && validTz(u.settings.timezone) ? u.settings.timezone : DEFAULT_TZ);

// minutes ahead of UTC at instant t
export function offsetAt(tz, t = Date.now()) {
  const fixed = /^fixed:(-?\d+)$/.exec(tz);
  if (fixed) return Number(fixed[1]);
  const p = Object.fromEntries(partsFmt(tz).formatToParts(new Date(t)).map((x) => [x.type, x.value]));
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second);
  return Math.round((asUtc - Math.floor(t / 1000) * 1000) / 60000);
}
// the UTC instant of a local wall-clock time: date "YYYY-MM-DD" + minutes after midnight (DST-safe)
export function zoned(tz, ymd, minutes = 0) {
  const wall = Date.parse(`${ymd}T00:00:00Z`) + minutes * 60000;
  let t = wall - offsetAt(tz, wall) * 60000;
  const again = wall - offsetAt(tz, t) * 60000; // across a DST change the first guess can be an hour out
  if (again !== t) t = again;
  return t;
}
export const localYmd = (tz, t) => new Date(t + offsetAt(tz, t) * 60000).toISOString().slice(0, 10);
export const localDow = (tz, t) => new Date(t + offsetAt(tz, t) * 60000).getUTCDay();
export const addDays = (ymd, n) => new Date(Date.parse(`${ymd}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
export const dowOfYmd = (ymd) => new Date(`${ymd}T12:00:00Z`).getUTCDay();

// "Sunday, 12 October, 7:00 pm IST" — in the zone, with its short name
export function formatIn(tz, t, opts = {}) {
  const fixed = /^fixed:(-?\d+)$/.exec(tz);
  const o = { weekday: 'long', day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit', hour12: true, ...opts };
  if (fixed) {
    const off = Number(fixed[1]);
    const s = new Date(t + off * 60000).toLocaleString('en-IN', { ...o, timeZone: 'UTC' });
    return `${s} ${off === 330 ? 'IST' : `GMT${off >= 0 ? '+' : '-'}${Math.floor(Math.abs(off) / 60)}${Math.abs(off) % 60 ? `:${String(Math.abs(off) % 60).padStart(2, '0')}` : ''}`}`;
  }
  const s = new Date(t).toLocaleString('en-IN', { ...o, timeZone: tz });
  const name = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'short' }).formatToParts(new Date(t)).find((x) => x.type === 'timeZoneName')?.value || '';
  return `${s} ${tz === 'Asia/Kolkata' || tz === 'Asia/Calcutta' ? 'IST' : name}`;
}
// common zones for pickers (the browser can offer every zone; this keeps the server list short)
export const COMMON_TZ = ['Asia/Kolkata', 'Asia/Dubai', 'Asia/Singapore', 'Asia/Kathmandu', 'Asia/Dhaka', 'Asia/Karachi', 'Asia/Colombo', 'Asia/Tokyo', 'Asia/Hong_Kong', 'Australia/Sydney', 'Australia/Perth', 'Pacific/Auckland', 'Europe/London', 'Europe/Dublin', 'Europe/Berlin', 'Europe/Paris', 'Europe/Amsterdam', 'Africa/Johannesburg', 'Africa/Lagos', 'Africa/Nairobi', 'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'America/Toronto', 'America/Sao_Paulo', 'America/Mexico_City', 'UTC'];
