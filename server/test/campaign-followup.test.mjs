// Following up a campaign (the same people, or those who didn't open / click / receive it) and the sales a campaign
// brought: orders its recipients paid for in the 7 days after it reached them. Throwaway database.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'fh-followup-'));
process.env.NODE_ENV = 'test';
let T, uid, B, CRM, user, bc;
const HOUR = 3600000, now = Date.now();
before(async () => {
  ({ T, uid } = await import('../db.js')); await import('../sales.js');
  B = await import('../broadcasts.js'); CRM = await import('../crm.js');
  user = T.users.insert({ id: uid(), email: 'seller@x.in', name: 'S', settings: {} });
  for (const e of ['a@x.in', 'b@x.in', 'c@x.in', 'd@x.in']) { const k = CRM.ensureContact(user.id, { email: e, name: e[0].toUpperCase() }, 'booking'); T.crm.update(CRM.metaFor(user.id, k).id, (m) => { m.optIn = true; }); }
  bc = T.broadcasts.insert({ id: uid(), userId: user.id, name: 'Diwali offer', channel: 'email', subject: 'Diwali', body: 'Hi', segment: { type: 'all', tags: [], notTags: [] }, status: 'sent', startedAt: now - 2 * HOUR, stats: {}, at: now - 3 * HOUR });
  const send = (email, status) => T.bsends.insert({ id: uid(), userId: user.id, broadcastId: bc.id, key: email, email, status, sentAt: status === 'sent' ? now - 2 * HOUR : null, nextAt: 0, at: now - 2 * HOUR });
  send('a@x.in', 'sent'); send('b@x.in', 'sent'); send('c@x.in', 'sent'); send('d@x.in', 'failed');
  const msg = (key, opens, clicks) => T.msgs.insert({ id: uid(), userId: user.id, broadcastId: bc.id, key, subject: 'Diwali', opens, clicks, at: now - 2 * HOUR });
  msg('a@x.in', 2, 1); msg('b@x.in', 1, 0); msg('c@x.in', 0, 0);
});
const who = (w) => B.audience(user.id, B.cleanSegment({ from: { broadcastId: bc.id, who: w } }, user.id), 'email').reach.map((c) => c.key).sort();

test('follow-ups go to exactly the right people', () => {
  assert.deepEqual(who('all'), ['a@x.in', 'b@x.in', 'c@x.in']);
  assert.deepEqual(who('not_opened'), ['c@x.in']);
  assert.deepEqual(who('opened'), ['a@x.in', 'b@x.in']);
  assert.deepEqual(who('not_clicked'), ['b@x.in', 'c@x.in']);
  assert.deepEqual(who('clicked'), ['a@x.in']);
  assert.deepEqual(who('failed'), ['d@x.in']);
  // another account's campaign can't be used as an audience
  const other = T.users.insert({ id: uid(), email: 'o@x.in', name: 'O', settings: {} });
  assert.equal(B.cleanSegment({ from: { broadcastId: bc.id, who: 'all' } }, other.id).from, undefined);
});

test('sales: paid orders by recipients within 7 days after it reached them', () => {
  const order = (email, total, at, extra = {}) => T.orders.insert({ id: uid(), userId: user.id, email, total, status: 'paid', provider: 'razorpay', at, ...extra });
  order('a@x.in', 1999, now - HOUR); // after the campaign: counted
  order('a@x.in', 499, now - 30 * 60000); // a second order by the same buyer
  order('b@x.in', 5000, now - 3 * HOUR); // before it reached them: not counted
  order('c@x.in', 999, now - HOUR, { status: 'cancelled' }); // not paid
  order('z@x.in', 7000, now - HOUR); // not a recipient
  assert.deepEqual(B.campaignSales(T.broadcasts.get(bc.id)), { buyers: 1, orders: 2, revenue: 2498 });
});
