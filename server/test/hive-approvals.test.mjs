// Hive's approvals inbox and AI activity log: everything waiting for the seller's OK is listed across chats (with
// how much it can do), Approve / Decline go through the chat's confirm route and are logged as the seller's, every
// tool Hive really ran is logged, and pinned teammates come first. A teammate's task chat shows unread until opened.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, register } from './helpers.mjs';

let srv, api, T, H, DB, userId;
before(async () => {
  srv = await startServer();
  api = srv.api;
  const r = await register(api);
  T = r.token;
  process.env.DATA_DIR = srv.dataDir; // the test reads and writes the server's own database
  ({ T: DB } = await import('../db.js'));
  await import('../sales.js'); // loads the modules in the app's own order (hive.js alone makes a loop)
  H = await import('../hive.js');
  userId = (await api('/me', 'GET', null, T)).data.id;
});
after(() => srv.stop());

const fc = (name, args = {}) => ({ type: 'function_call', call_id: `c_${Math.random().toString(36).slice(2)}`, name, arguments: JSON.stringify(args) });
const reply = (...output) => ({ output });
const text = (t) => ({ type: 'message', content: [{ text: t }] });
const script = (steps) => { let n = 0; return async () => steps[n++] || reply(text('done')); };
const thread = (extra) => DB.hive.insert({ id: `th${Math.random().toString(36).slice(2, 10)}`, userId, title: 'A chat', funnelId: null, messages: [], at: Date.now(), updatedAt: Date.now(), ...extra });
const pend = (name, args, label, ago = 0) => ({ id: `p${Math.random().toString(36).slice(2, 10)}`, name, args, label, at: Date.now() - ago });

test('pending actions are listed across chats, newest first, with their risk; expired ones are left out', async () => {
  const mate = (await api('/hive/team', 'POST', { name: 'Accountant', emoji: '🧾', groups: ['tally'] }, T)).data;
  const a = thread({ pending: [pend('send_broadcast', { id: 'b1' }, 'Send this broadcast now', 5000), pend('create_coupon', { code: 'X' }, 'Create a coupon', 60000)] });
  const b = thread({ teammateId: mate.id, title: 'Books', pending: [pend('remind_tally_bill', { id: 'x' }, 'Send a payment reminder', 1000), pend('publish_funnel', {}, 'Publish', 25 * 3600000)] });
  const list = (await api('/hive/approvals', 'GET', null, T)).data;
  assert.equal(list.length, 3, 'the one older than a day has expired');
  assert.deepEqual(list.map((x) => x.label), ['Send a payment reminder', 'Send this broadcast now', 'Create a coupon']);
  assert.deepEqual(list.map((x) => x.risk), ['external', 'external', 'write']);
  assert.equal(list[0].threadId, b.id);
  assert.deepEqual([list[0].teammate.name, list[0].teammate.emoji], ['Accountant', '🧾']);
  assert.equal(list[1].teammate, null);
  assert.equal(list[1].threadId, a.id);
  assert.equal(list[2].tool, 'create_coupon');
  assert.equal((await api('/me', 'GET', null, T)).data.nav.approvals, 3, 'the Hive menu item’s badge');
  // someone else sees none of it
  const other = (await register(api)).token;
  assert.deepEqual((await api('/hive/approvals', 'GET', null, other)).data, []);
  for (const t of [a, b]) DB.hive.del(t.id);
});

test('risk: reads, changes and things that reach customers or other apps', () => {
  assert.equal(H.riskOf('list_funnels'), 'read');
  assert.equal(H.riskOf('create_coupon'), 'write');
  assert.equal(H.riskOf('publish_funnel', {}), 'write');
  for (const n of ['send_broadcast', 'answer_question', 'reply_to_post', 'connect_webhook', 'post_to_community', 'invite_team_member', 'remind_tally_bill']) assert.equal(H.riskOf(n, {}), 'external', n);
  assert.equal(H.riskOf('run_app_action', { slug: 'METAADS_CREATE_CAMPAIGN' }), 'external');
});

test('approving or declining clears the item and logs it as the seller’s', async () => {
  const yes = pend('list_funnels', {}, 'Look at your funnels'), no = pend('send_broadcast', { id: 'b1' }, 'Send this broadcast now');
  const t = thread({ pending: [yes, no] });
  const d = await api(`/hive/threads/${t.id}/confirm`, 'POST', { pendingId: no.id, ok: false }, T);
  assert.equal(d.data.cancelled, true);
  const ok = await api(`/hive/threads/${t.id}/confirm`, 'POST', { pendingId: yes.id, ok: true }, T);
  assert.equal(ok.data.ok, true);
  assert.equal((await api('/hive/approvals', 'GET', null, T)).data.filter((x) => x.threadId === t.id).length, 0);
  assert.equal((await api(`/hive/threads/${t.id}/confirm`, 'POST', { pendingId: yes.id, ok: true }, T)).status, 404, 'handled once');
  const log = (await api('/hive/activity', 'GET', null, T)).data.filter((x) => x.threadId === t.id);
  assert.equal(log.length, 2);
  assert.ok(log.every((x) => x.by === 'you' && !('userId' in x)));
  const [ran, declined] = [log.find((x) => x.tool === 'list_funnels'), log.find((x) => x.tool === 'send_broadcast')];
  assert.deepEqual([ran.ok, ran.risk, !!ran.declined], [true, 'read', false]);
  assert.deepEqual([declined.ok, declined.declined, declined.risk], [false, true, 'external']);
  assert.ok(log[0].at >= log[1].at, 'newest first');
});

test('a tool Hive runs is logged (who ran it, ok or failed); a card waiting for OK and a repeated call are not', async () => {
  const mate = (await api('/hive/team', 'POST', { name: 'Seller helper', groups: ['selling'] }, T)).data;
  const log = [];
  const ctx = { origin: 'http://t', pending: [], audit: { userId, threadId: 'thx', by: 'schedule' }, call: async (m, p, b) => { log.push(`${m} ${p}`); if (p.startsWith('/coupons')) throw new Error('nope'); return m === 'GET' ? [] : { id: 'x1', ...b }; } };
  const model = script([reply(fc('list_products')), reply(fc('list_products')), reply(fc('list_products')), reply(fc('create_coupon', { code: 'Q', type: 'percent', value: 5 })), reply(fc('send_broadcast', { id: 'b1' })), reply(text('ok'))]);
  await H.hiveTurn({ ctx, history: [], message: 'coupons', emit: () => {}, model, teammate: (await api('/hive/team', 'GET', null, T)).data.team.find((m) => m.id === mate.id) });
  const rows = (await api(`/hive/activity?teammate=${mate.id}`, 'GET', null, T)).data;
  assert.equal(rows.filter((x) => x.tool === 'list_products').length, 2, 'a read can repeat twice; the third is skipped');
  const c = rows.find((x) => x.tool === 'create_coupon');
  assert.deepEqual([c.ok, c.by, c.risk, c.teammate.name], [false, 'schedule', 'write', 'Seller helper']);
  assert.ok(!rows.some((x) => x.tool === 'send_broadcast'), 'waiting for OK isn’t a run');
  assert.ok((await api('/hive/activity?limit=1', 'GET', null, T)).data.length === 1);
});

test('pinned teammates come first; a task reply shows unread until the seller opens the chat', async () => {
  const before = (await api('/hive/team', 'GET', null, T)).data.team;
  const last = before[before.length - 1];
  const pinned = (await api(`/hive/team/${last.id}`, 'PUT', { pinned: true }, T)).data;
  assert.equal(pinned.pinned, true);
  const after = (await api('/hive/team', 'GET', null, T)).data.team;
  assert.equal(after[0].id, last.id);
  assert.deepEqual(after.slice(1).map((m) => m.id), before.slice(0, -1).map((m) => m.id), 'the rest keep their order');

  const t = thread({ teammateId: last.id, auto: true, messages: [{ role: 'user', text: '⏰ task', auto: true, at: Date.now() - 2000 }, { role: 'assistant', text: 'Report', at: Date.now() - 1000 }] });
  const row = () => api('/hive/threads', 'GET', null, T).then((r) => r.data.find((x) => x.id === t.id));
  assert.equal((await row()).unread, true);
  await api(`/hive/threads/${t.id}`, 'GET', null, T);
  assert.ok(!(await row()).unread, 'opened: seen');
});
