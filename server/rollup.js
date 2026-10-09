// Page-view storage that stays small. Raw page views (one row each) are kept for EVENTS_RAW_DAYS (90 by default);
// older ones are folded into daily totals per funnel / step / event type / A-B variant / source, in each seller's
// own time zone, and the raw rows are deleted. Reports read daily totals before the boundary and raw rows after it,
// so their numbers don't change — except unique visitors on days older than the boundary, which become the sum of
// each day's unique visitors (someone who came back on two of those days counts twice).
//
// The job never holds the database for long: each UTC day is aggregated while only reading, then written in small
// batches (each its own short transaction, ~0.1 s) with pauses in between, so live page views, sign-ups and orders keep
// flowing. Every total row records the day-chunk it came from (part), so a chunk interrupted half-way is wiped and
// redone on the next run — never counted twice.
import { sql, q, tx, T, JOBS } from './db.js';
import { offsetAt, sellerTz } from './tz.js';

export const DAY = 86400000;
const KEEP_DAYS = () => Math.max(7, Number(process.env.EVENTS_RAW_DAYS || 90));
const BATCH = Number(process.env.ROLLUP_BATCH || 1000); // rows per write transaction
const PAUSE_MS = Number(process.env.ROLLUP_PAUSE_MS ?? 25); // breathing room between write batches

sql.exec(`
CREATE TABLE IF NOT EXISTS pv_days (
  userId TEXT NOT NULL, funnelId TEXT NOT NULL, stepId TEXT NOT NULL, type TEXT NOT NULL, variant TEXT NOT NULL, source TEXT NOT NULL,
  demo INTEGER NOT NULL, day INTEGER NOT NULL, part INTEGER NOT NULL, n INTEGER NOT NULL,
  PRIMARY KEY (funnelId, day, stepId, type, variant, source, demo, part)) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS pv_days_user ON pv_days (userId, day);
CREATE INDEX IF NOT EXISTS pv_days_part ON pv_days (part);
CREATE TABLE IF NOT EXISTS pv_visitors (
  userId TEXT NOT NULL, funnelId TEXT NOT NULL, demo INTEGER NOT NULL, day INTEGER NOT NULL, part INTEGER NOT NULL, v INTEGER NOT NULL,
  PRIMARY KEY (funnelId, day, demo, part)) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS pv_visitors_user ON pv_visitors (userId, day);
CREATE INDEX IF NOT EXISTS pv_visitors_part ON pv_visitors (part);
DROP TABLE IF EXISTS eventdays; DROP TABLE IF EXISTS eventvisitors;
`);

// everything before this instant lives in the daily totals; from it on, in raw rows
const KEY = 'eventsRollup';
export const rolledUntil = () => { try { return T.platform.get(KEY)?.until || 0; } catch { return 0; } };
const pause = (ms = PAUSE_MS) => new Promise((r) => setTimeout(r, ms));
// delete in small transactions: WHERE must use an indexed column
async function deleteInBatches(sqlText, ...args) {
  let n = 0;
  for (;;) { const c = q(`${sqlText} LIMIT ${BATCH})`).run(...args).changes; n += c; if (c < BATCH) return n; await pause(); }
}

// Fold raw page views older than the boundary into daily totals, then delete them — one UTC day at a time.
let running = false;
export async function rollupEvents(now = Date.now(), keepDays = KEEP_DAYS()) {
  if (running) return { rolled: 0, deleted: 0, busy: true };
  running = true;
  try {
    const until = Math.floor((now - keepDays * DAY) / DAY) * DAY; // a UTC midnight, keepDays ago
    let start = rolledUntil();
    if (until <= start) return { rolled: 0, deleted: 0, until: start };
    if (!start) {
      const first = q('SELECT MIN(at) AS t FROM events').get().t;
      if (first == null) { T.platform.put({ id: KEY, until, at: Date.now() }); return { rolled: 0, deleted: 0, until }; }
      start = Math.floor(first / DAY) * DAY;
    }
    sql.exec(`CREATE TEMP TABLE IF NOT EXISTS tzoff (userId TEXT PRIMARY KEY, off INTEGER NOT NULL);
      CREATE TEMP TABLE IF NOT EXISTS agg_days (userId TEXT, funnelId TEXT, stepId TEXT, type TEXT, variant TEXT, source TEXT, demo INTEGER, day INTEGER, part INTEGER, n INTEGER);
      CREATE TEMP TABLE IF NOT EXISTS agg_vis (userId TEXT, funnelId TEXT, demo INTEGER, day INTEGER, part INTEGER, v INTEGER);`);
    // CROSS JOIN keeps page views as the outer loop: one pass over the day (by its at index), each seller's offset looked up
    const day = '(((e.at + o.off) / 86400000) * 86400000 - o.off)';
    let rolled = 0, deleted = 0;
    for (let a = start; a < until; a += DAY) {
      const b = Math.min(a + DAY, until);
      // 1. read only: each seller's day boundary (their time zone's offset), then the day's totals into temp tables
      q('DELETE FROM temp.tzoff').run(); q('DELETE FROM temp.agg_days').run(); q('DELETE FROM temp.agg_vis').run();
      const ins = q('INSERT OR REPLACE INTO temp.tzoff (userId, off) VALUES (?, ?)');
      for (const r of q('SELECT DISTINCT userId FROM events WHERE at >= ? AND at < ? AND userId IS NOT NULL').all(a, b)) ins.run(r.userId, offsetAt(sellerTz(T.users.get(r.userId)), b) * 60000);
      q(`INSERT INTO temp.agg_days SELECT e.userId, e.funnelId, COALESCE(e.stepId, ''), e.type, COALESCE(e.variant, 'A'), COALESCE(e.source, ''), COALESCE(e.demo, 0), ${day}, ${a}, COUNT(*)
        FROM events e CROSS JOIN temp.tzoff o WHERE o.userId = e.userId AND e.at >= ? AND e.at < ? AND e.funnelId IS NOT NULL GROUP BY 1, 2, 3, 4, 5, 6, 7, 8`).run(a, b);
      q(`INSERT INTO temp.agg_vis SELECT e.userId, e.funnelId, COALESCE(e.demo, 0), ${day}, ${a}, COUNT(DISTINCT COALESCE(e.visitor, e.at))
        FROM events e CROSS JOIN temp.tzoff o WHERE o.userId = e.userId AND e.at >= ? AND e.at < ? AND e.type = 'view' AND e.funnelId IS NOT NULL GROUP BY 1, 2, 3, 4`).run(a, b);
      await pause(0);
      // 2. write in small batches: first wipe anything a half-finished earlier run left for this chunk
      await deleteInBatches('DELETE FROM pv_days WHERE (funnelId, day, stepId, type, variant, source, demo, part) IN (SELECT funnelId, day, stepId, type, variant, source, demo, part FROM pv_days WHERE part = ?', a);
      await deleteInBatches('DELETE FROM pv_visitors WHERE (funnelId, day, demo, part) IN (SELECT funnelId, day, demo, part FROM pv_visitors WHERE part = ?', a);
      const total = q('SELECT MAX(rowid) AS m FROM temp.agg_days').get().m || 0;
      for (let r = 0; r < total; r += BATCH) {
        rolled += tx(() => q('INSERT INTO pv_days (userId, funnelId, stepId, type, variant, source, demo, day, part, n) SELECT userId, funnelId, stepId, type, variant, source, demo, day, part, n FROM temp.agg_days WHERE rowid > ? AND rowid <= ?').run(r, r + BATCH).changes);
        await pause();
      }
      const totalV = q('SELECT MAX(rowid) AS m FROM temp.agg_vis').get().m || 0;
      for (let r = 0; r < totalV; r += BATCH) {
        tx(() => q('INSERT INTO pv_visitors (userId, funnelId, demo, day, part, v) SELECT userId, funnelId, demo, day, part, v FROM temp.agg_vis WHERE rowid > ? AND rowid <= ?').run(r, r + BATCH));
        await pause();
      }
      // 3. the chunk is complete: move the boundary (reports now read its totals, not its raw rows)
      T.platform.put({ id: KEY, until: b, at: Date.now() });
      // 4. its raw rows are no longer read: delete them in small batches
      deleted += await deleteInBatches('DELETE FROM events WHERE id IN (SELECT id FROM events WHERE at < ?', b);
    }
    return { rolled, deleted, until };
  } finally { running = false; }
}

// ---------- reading the totals (analytics.js) ----------
// col: 'userId' | 'funnelId'. Only days before the boundary are in the totals.
const inRange = (from, to) => { const b = rolledUntil(); return b > from ? [from, Math.min(to, b + DAY)] : null; };
export function oldViews(col, id, from, to) {
  const r = inRange(from, to);
  if (!r) return { views: 0, visitors: 0 };
  const v = q(`SELECT COALESCE(SUM(n), 0) AS n FROM pv_days WHERE ${col} = ? AND type = 'view' AND day >= ? AND day < ?`).get(id, r[0], r[1]).n;
  const u = q(`SELECT COALESCE(SUM(v), 0) AS n FROM pv_visitors WHERE ${col} = ? AND day >= ? AND day < ?`).get(id, r[0], r[1]).n;
  return { views: v, visitors: u };
}
export function oldViewsByFunnel(userId, from, to) {
  const r = inRange(from, to);
  if (!r) return {};
  const out = {};
  for (const x of q("SELECT funnelId, SUM(n) AS n FROM pv_days WHERE userId = ? AND type = 'view' AND day >= ? AND day < ? GROUP BY funnelId").all(userId, r[0], r[1])) (out[x.funnelId] ||= { views: 0, visitors: 0 }).views = x.n;
  for (const x of q('SELECT funnelId, SUM(v) AS n FROM pv_visitors WHERE userId = ? AND day >= ? AND day < ? GROUP BY funnelId').all(userId, r[0], r[1])) (out[x.funnelId] ||= { views: 0, visitors: 0 }).visitors = x.n;
  return out;
}
export function oldViewsByDay(col, id, from, to) {
  const r = inRange(from, to);
  if (!r) return [];
  return q(`SELECT CAST((day - ?) / 86400000 AS INTEGER) AS d, SUM(n) AS n FROM pv_days WHERE ${col} = ? AND type = 'view' AND day >= ? AND day < ? GROUP BY d`).all(from, id, r[0], r[1]);
}
export function oldViewsBySource(col, id, from) {
  const r = inRange(from, Date.now() + DAY);
  if (!r) return [];
  return q(`SELECT NULLIF(source, '') AS source, SUM(n) AS n FROM pv_days WHERE ${col} = ? AND type = 'view' AND day >= ? AND day < ? GROUP BY source`).all(id, r[0], r[1]);
}
export function oldStepCounts(funnelId, from) {
  const r = inRange(from, Date.now() + DAY);
  if (!r) return [];
  return q("SELECT NULLIF(stepId, '') AS stepId, type, variant, SUM(n) AS n FROM pv_days WHERE funnelId = ? AND type IN ('view', 'convert') AND day >= ? AND day < ? GROUP BY stepId, type, variant").all(funnelId, r[0], r[1]);
}
// the raw part of a range: never before the boundary
export const rawFrom = (from) => Math.max(from, rolledUntil());

// keeping the totals in step with deletions
export const dropRollups = {
  user: (userId) => { q('DELETE FROM pv_days WHERE userId = ?').run(userId); q('DELETE FROM pv_visitors WHERE userId = ?').run(userId); },
  funnel: (funnelId) => { q('DELETE FROM pv_days WHERE funnelId = ?').run(funnelId); q('DELETE FROM pv_visitors WHERE funnelId = ?').run(funnelId); },
  demo: (userId) => { q('DELETE FROM pv_days WHERE userId = ? AND demo = 1').run(userId); q('DELETE FROM pv_visitors WHERE userId = ? AND demo = 1').run(userId); },
};
// daily totals older than keepDays (EVENTS_KEEP_DAYS) are dropped
export const trimRollups = async (before) => {
  await deleteInBatches('DELETE FROM pv_days WHERE (funnelId, day, stepId, type, variant, source, demo, part) IN (SELECT funnelId, day, stepId, type, variant, source, demo, part FROM pv_days WHERE day < ?', before);
  await deleteInBatches('DELETE FROM pv_visitors WHERE (funnelId, day, demo, part) IN (SELECT funnelId, day, demo, part FROM pv_visitors WHERE day < ?', before);
};

if (JOBS && process.env.NODE_ENV !== 'test') {
  const run = () => rollupEvents().then((r) => { if (r.rolled || r.deleted) console.log(`Page views: ${r.deleted} raw rows folded into daily totals (up to ${new Date(r.until).toISOString().slice(0, 10)})`); }).catch((e) => console.error('page-view rollup failed', e.message));
  setTimeout(run, 90000).unref();
  setInterval(run, 6 * 3600000).unref();
}
