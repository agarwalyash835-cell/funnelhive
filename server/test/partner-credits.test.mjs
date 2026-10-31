// A partner sub-account's AI credits: the plan's monthly credits first, then the packs it bought (drawn down for
// good); the partner's wallet pays the platform for every credit used at its wholesale rate; a partner whose wallet
// has been on hold for over 7 days pauses its sub-accounts. Runs on a throwaway database.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'fh-partner-'));
process.env.NODE_ENV = 'test';
let T, uid, B, P, AT, partner, client;
const DAY = 86400000;
before(async () => {
  ({ T, uid } = await import('../db.js')); await import('../sales.js');
  B = await import('../billing.js');
  P = await import('../partners.js');
  AT = await import('../agency-terms.js');
  partner = T.users.insert({ id: uid(), email: 'p@x.in', name: 'P', billing: { status: 'comped' }, partner: { enabled: true, perAccount: 499, creditRate: 20, maxAccounts: 10 }, settings: { resale: { plans: [{ id: 'basic', name: 'Basic', monthly: 999, credits: 100 }], packs: [], defaultPlan: 'basic' } } });
  client = T.users.insert({ id: uid(), email: 'c@x.in', name: 'C', agencyId: partner.id, billing: { status: 'trialing', trialEndsAt: Date.now() + 14 * DAY }, sub: { planId: 'basic', status: 'active', periodEnd: Date.now() + 20 * DAY }, extraCredits: 50, settings: {} });
});
const fresh = () => T.users.get(client.id);

test('plan credits first, then packs; the partner pays wholesale per credit used', () => {
  assert.equal(B.creditLimit(fresh()), 150);
  assert.equal(B.spendCredits(fresh(), 90), null);
  assert.equal(fresh().extraCredits, 50, 'still inside the plan');
  assert.equal(B.spendCredits(fresh(), 30), null);
  assert.equal(fresh().extraCredits, 30, '20 came out of the pack');
  assert.equal(B.creditLimit(fresh()), 150, 'the month’s limit doesn’t shrink as the pack is used');
  assert.match(B.spendCredits(fresh(), 31), /used this month/);
  assert.equal(B.spendCredits(fresh(), 30), null);
  assert.equal(fresh().extraCredits, 0);
  const cost = T.partnerLedger.all({ partnerId: partner.id }).reduce((s, l) => s + l.amount, 0);
  assert.equal(cost, -30, '150 credits at ₹20 per 100');
});

test('access follows the sub-account’s own plan and the partner’s standing', () => {
  assert.equal(B.accessFor(fresh()).ok, true);
  T.users.update(client.id, (x) => { x.sub.periodEnd = Date.now() - 30 * DAY; });
  const a = B.accessFor(fresh());
  assert.equal(a.ok, false);
  assert.match(a.reason, /plan has ended/);
  T.users.update(client.id, (x) => { x.sub.periodEnd = Date.now() + 10 * DAY; });
  T.users.update(partner.id, (x) => { x.partner.hold = Date.now() - 8 * DAY; });
  assert.match(B.accessFor(fresh()).reason, /paused/);
  T.users.update(partner.id, (x) => { delete x.partner.hold; });
  assert.equal(B.accessFor(fresh()).ok, true);
});

test('fees: once per 30 days per active sub-account; an overdrawn wallet goes on hold and back', () => {
  P.partnerJob();
  assert.equal(P.balanceOf(partner.id), -30 - 499);
  P.partnerJob();
  assert.equal(P.balanceOf(partner.id), -529, 'not charged twice');
  P.ledger(partner.id, -1000, 'adjust', 'test');
  P.partnerJob();
  assert.ok(AT.termsOf(T.users.get(partner.id)).hold, 'below the floor: on hold');
  P.ledger(partner.id, 5000, 'topup', 'test');
  P.partnerJob();
  assert.ok(!AT.termsOf(T.users.get(partner.id)).hold, 'topped up: off hold');
});
