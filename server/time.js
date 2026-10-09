// Reporting days follow the business's timezone (India by default), not the server's.
export const DAY = 86400000;
export const TZ_OFFSET = (Number(process.env.REPORT_TZ_OFFSET_MIN ?? 330) || 0) * 60000; // IST = UTC+5:30

// Timestamp of the most recent local midnight at or before t
export const dayStart = (t, off = TZ_OFFSET) => Math.floor((t + off) / DAY) * DAY - off;
// Local calendar date (YYYY-MM-DD) of timestamp t
export const localDate = (t, off = TZ_OFFSET) => new Date(t + off).toISOString().slice(0, 10);

// Last `days` whole local days, ending tonight at local midnight
// off: the seller's offset from UTC in ms (their time zone today), so "today" is their today
export function reportRange(days, now = Date.now(), off = TZ_OFFSET) {
  const to = dayStart(now, off) + DAY;
  return { days, from: to - days * DAY, to, off };
}
