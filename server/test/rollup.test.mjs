// Page-view rollup: raw views older than the retention window become daily totals; every report gives the same
// numbers before and after (views, unique visitors, the daily chart, sources, per-step A/B counts, per-funnel totals),
// raw rows are deleted, deletions reach the totals, and running it again changes nothing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ff-rollup-'));
process.env.EVENTS_FLUSH_MS = '0';
process.env.ROLLUP_PAUSE_MS = '0';
const { T, q, Events } = await import('../db.js');
const A = await import('../analytics.js');
const { rollupEvents, rolledUntil, dropRollups } = await import('../rollup.js');
const { reportRange, DAY } = await import('../time.js');

const now = Date.parse('2026-10-09T10:00:00Z');
const OFF = 330 * 60000;
T.users.insert({ id: 'u1', email: 'a@x.in', name: 'A', settings: { timezone: 'Asia/Kolkata' }, createdAt: 1 });
T.users.insert({ id: 'u2', email: 'b@x.in', name: 'B', settings: { timezone: 'America/New_York' }, createdAt: 1 });
// 150 days of traffic on two funnels; each visitor visits on one day only (so unique visitors stay exact)
const rows = [];
let vid = 0;
for (let d = 0; d < 150; d++) {
  const dayStart = now - d * DAY;
  for (let i = 0; i < 3 + (d % 5); i++) {
    const v = `v${vid++}`;
    const at = dayStart - 3600000 * (1 + (i % 8));
    rows.push({ userId: 'u1', funnelId: 'f1', stepId: 's1', type: 'view', variant: i % 2 ? 'B' : 'A', source: ['instagram', 'google', null][i % 3], visitor: v, at });
    if (i % 3 === 0) rows.push({ userId: 'u1', funnelId: 'f1', stepId: 's2', type: 'view', variant: 'A', source: 'instagram', visitor: v, at: at + 60000 });
    if (i % 4 === 0) rows.push({ userId: 'u1', funnelId: 'f1', stepId: 's1', type: 'convert', variant: 'A', source: 'instagram', visitor: v, at: at + 120000 });
    rows.push({ userId: 'u1', funnelId: 'f2', stepId: 'x1', type: 'view', variant: 'A', source: 'direct', visitor: `w${vid}`, at: at + 30000 });
  }
  rows.push({ userId: 'u2', funnelId: 'g1', stepId: 'y1', type: 'view', variant: 'A', source: 'facebook', visitor: `n${d}`, at: dayStart - 5 * 3600000 });
}
Events.addMany(rows);

function snapshot() {
  const out = {};
  for (const days of [7, 30, 90, 120, 365]) {
    const { from, to } = reportRange(days, now, OFF);
    out[days] = {
      totals: A.totals({ userId: 'u1' }, from, to), funnel: A.totals({ funnelId: 'f1' }, from, to),
      byFunnel: ['f1', 'f2'].map((f) => A.totalsByFunnel('u1', from, to)(f)),
      series: A.series({ userId: 'u1' }, from, days, OFF).map((x) => x.views),
      sources: A.sources({ userId: 'u1' }, from).map((s) => [s.source, s.views]).sort(),
      steps: (() => { const c = A.stepCounts('f1', from); return ['s1', 's2'].flatMap((s) => [c(s, 'view', 'A'), c(s, 'view', 'B'), c(s, 'convert', 'A')]); })(),
    };
  }
  return out;
}

test('every report is the same after the rollup; old raw rows are gone', async () => {
  const before = snapshot();
  const rawBefore = q('SELECT COUNT(*) AS n FROM events').get().n;
  const r = await rollupEvents(now, 90);
  assert.ok(r.deleted > 0 && r.rolled > 0, JSON.stringify(r));
  assert.equal(rolledUntil(), Math.floor((now - 90 * DAY) / DAY) * DAY);
  assert.equal(q('SELECT COUNT(*) AS n FROM events WHERE at < ?').get(rolledUntil()).n, 0, 'raw rows older than the window deleted');
  assert.ok(q('SELECT COUNT(*) AS n FROM events').get().n < rawBefore * 0.7);
  const after = snapshot();
  assert.deepEqual(after, before);
});

test('running again changes nothing; a later run moves the boundary on', async () => {
  const before = snapshot();
  assert.equal((await rollupEvents(now, 90)).rolled, 0);
  assert.deepEqual(snapshot(), before);
  await rollupEvents(now + 10 * DAY, 90); // ten days later
  assert.deepEqual(snapshot(), before, 'still the same numbers for the same ranges');
});

test('deleting a funnel or an account removes its daily totals too', async () => {
  const { from, to } = reportRange(365, now, OFF);
  assert.ok(A.totals({ funnelId: 'f2' }, from, to).views > 0);
  dropRollups.funnel('f2');
  q('DELETE FROM events WHERE funnelId = ?').run('f2');
  assert.equal(A.totals({ funnelId: 'f2' }, from, to).views, 0);
  dropRollups.user('u2');
  q('DELETE FROM events WHERE userId = ?').run('u2');
  assert.equal(A.totals({ userId: 'u2' }, from, to).views, 0);
});

test('a chunk interrupted half-way is wiped and redone, never counted twice', async () => {
  const next = rolledUntil(); // the next chunk the rollup will process
  // what an interrupted run would leave behind: some of that chunk's totals written, the boundary not moved
  q("INSERT INTO pv_days (userId, funnelId, stepId, type, variant, source, demo, day, part, n) VALUES ('u1', 'f1', 's1', 'view', 'A', 'leftover', 0, ?, ?, 999)").run(next, next);
  await rollupEvents(now + 11 * DAY, 90);
  assert.equal(q("SELECT COUNT(*) AS n FROM pv_days WHERE source = 'leftover'").get().n, 0);
  assert.ok(rolledUntil() > next);
});
