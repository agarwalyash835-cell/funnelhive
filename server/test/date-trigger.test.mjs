// Yearly date triggers with an offset across New Year ("3 days before 2 Jan" fires on 30 Dec), once per occasion.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

test('“3 days before” a 2 January birthday fires on 30 December, once', async () => {
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ff-dates-'));
  const { T } = await import('../db.js');
  const A = await import('../automations.js');
  const u = T.users.insert({ email: 'seller@x.in', settings: { timezone: 'Asia/Kolkata' }, billing: { status: 'active', plan: 'pro' }, at: 1 });
  const a = T.automations.insert({ userId: u.id, name: 'Birthday', active: true, allowRepeat: true, trigger: { type: 'date', fieldId: 'bday', yearly: true, offsetDays: -3, time: '09:00' }, steps: [{ id: 's1', type: 'tag', tag: 'bday-soon' }], at: 1 });
  T.crm.insert({ userId: u.id, key: 'asha@x.in', email: 'asha@x.in', name: 'Asha', custom: { bday: '1990-01-02' }, tags: [], activities: [], at: 1 });
  const runs = () => T.runs.all({ automationId: a.id });
  A.scanDates(Date.parse('2026-12-29T06:00:00Z')); // 29 Dec, 11:30 India time: too early
  assert.equal(runs().length, 0);
  A.scanDates(Date.parse('2026-12-30T06:00:00Z')); // 30 Dec, 11:30: three days before 2 Jan 2027
  assert.equal(runs().length, 1, 'fired across New Year');
  A.scanDates(Date.parse('2026-12-30T08:00:00Z'));
  A.scanDates(Date.parse('2027-01-02T06:00:00Z'));
  assert.equal(runs().length, 1, 'once for that birthday');
  T.runs.update(runs()[0].id, (r) => { r.status = 'done'; }); // that year's flow finished
  A.scanDates(Date.parse('2027-12-30T06:00:00Z'));
  assert.equal(runs().length, 2, 'and again the next year');
});
