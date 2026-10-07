// Reporting days follow the business's timezone (India by default), not the server's.
export const DAY = 86400000;
export const TZ_OFFSET = (Number(process.env.REPORT_TZ_OFFSET_MIN ?? 330) || 0) * 60000; // IST = UTC+5:30

// Timestamp of the most recent local midnight at or before t
export const dayStart = (t) => Math.floor((t + TZ_OFFSET) / DAY) * DAY - TZ_OFFSET;
// Local calendar date (YYYY-MM-DD) of timestamp t
export const localDate = (t) => new Date(t + TZ_OFFSET).toISOString().slice(0, 10);

// Last `days` whole local days, ending tonight at local midnight
export function reportRange(days, now = Date.now()) {
  const to = dayStart(now) + DAY;
  return { days, from: to - days * DAY, to };
}
