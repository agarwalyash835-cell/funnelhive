import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dayStart, localDate, reportRange, DAY } from '../time.js';

// 2026-10-05 23:00 IST = 17:30 UTC; 2026-10-06 00:30 IST = 2026-10-05 19:00 UTC
const lateNightIST = Date.UTC(2026, 9, 5, 17, 30);
const justAfterMidnightIST = Date.UTC(2026, 9, 5, 19, 0);

test('dates follow India time regardless of server timezone', () => {
  assert.equal(localDate(lateNightIST), '2026-10-05');
  assert.equal(localDate(justAfterMidnightIST), '2026-10-06', 'UTC still says Oct 5, IST says Oct 6');
  assert.equal(dayStart(justAfterMidnightIST), Date.UTC(2026, 9, 5, 18, 30), 'IST midnight = 18:30 UTC');
});

test('report range covers whole IST days ending tonight', () => {
  const r = reportRange(7, justAfterMidnightIST);
  assert.equal(r.to - r.from, 7 * DAY);
  assert.equal(localDate(r.to - 1), '2026-10-06');
  assert.equal(localDate(r.from), '2026-09-30');
  assert.ok(lateNightIST >= r.from && lateNightIST < r.to);
});
