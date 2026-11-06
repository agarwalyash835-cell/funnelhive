// Hive teammates: hire a ready-made specialist or your own; a teammate sees only its own tools, can't call others,
// asks before changes when told to, and a scheduled run (nobody watching) never changes anything on its own.
// The schedule runs once a day at the seller's local time.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, register } from './helpers.mjs';

let srv, api, T, H, TM;
before(async () => {
  srv = await startServer();
  api = srv.api;
  T = (await register(api)).token;
  await import('../sales.js'); // loads the modules in the app's own order (hive.js alone makes a loop)
  H = await import('../hive.js');
  TM = await import('../hive-team.js');
});
after(() => srv.stop());

const fc = (name, args = {}) => ({ type: 'function_call', call_id: `c_${Math.random().toString(36).slice(2)}`, name, arguments: JSON.stringify(args) });
const reply = (...output) => ({ output });
const text = (t) => ({ type: 'message', content: [{ text: t }] });
function script(steps) {
  const seen = [];
  const model = async ({ instructions, tools }) => { seen.push({ instructions, tools: tools.map((t) => t.name) }); const s = steps[seen.length - 1]; return s || reply(text('done')); };
  return { model, seen };
}
const ctxWith = () => { const log = []; return { log, ctx: { origin: 'http://t', pending: [], call: async (m, p, b) => { log.push(`${m} ${p}`); return m === 'GET' ? [] : { id: 'x1', ...b }; } } }; };
const turn = (model, ctx, teammate, message = 'hello') => H.hiveTurn({ ctx, history: [], message, emit: () => {}, model, teammate });

test('hire a ready-made teammate, change it, and let it go; unknown areas are dropped', async () => {
  const list = (await api('/hive/team', 'GET', null, T)).data;
  assert.ok(list.presets.length >= 5 && list.groups.some((g) => g.id === 'crm'));
  assert.deepEqual(list.team, []);
  const sales = (await api('/hive/team', 'POST', { preset: 'sales' }, T)).data;
  assert.equal(sales.name, 'Sales Manager');
  assert.ok(sales.schedule.on && sales.schedule.task);
  const ch = await api(`/hive/team/${sales.id}`, 'PUT', { name: 'Riya — Sales', groups: ['crm', 'nonsense'], schedule: { on: true, time: '25:99', days: [1, 9], task: 'Follow-ups' } }, T);
  assert.equal(ch.status, 200);
  assert.deepEqual(ch.data.groups, ['crm'], 'only areas that exist');
  assert.deepEqual([ch.data.schedule.time, ch.data.schedule.days], ['09:30', [1]], 'a bad time keeps the old one; bad days are dropped');
  assert.equal((await api('/hive/team', 'POST', { name: 'Nobody', groups: [] }, T)).status, 400, 'a teammate needs something to work on');
  assert.equal((await api('/hive/team', 'POST', { preset: 'nope' }, T)).status, 400);
  const own = (await api('/hive/team', 'POST', { name: 'GST helper', groups: ['tally'], askFirst: true }, T)).data;
  assert.equal((await api('/hive/team', 'GET', null, T)).data.team.length, 2);
  await api(`/hive/team/${own.id}`, 'DELETE', null, T);
  assert.equal((await api('/hive/team', 'GET', null, T)).data.team.length, 1);
});

test('a teammate sees only its tools, is told who it is, and can’t call another teammate’s tools', async () => {
  const m = TM.cleanMate({ name: 'Accountant', role: 'the books', groups: ['tally'], askFirst: false }, {}, Object.keys(H.TOOL_GROUPS));
  const { model, seen } = script([reply(fc('use_tools', { groups: ['selling', 'tally'] })), reply(fc('create_coupon', { code: 'X', type: 'percent', value: 5 })), reply(text('ok'))]);
  const { ctx, log } = ctxWith();
  await turn(model, ctx, m, 'who owes me money in tally');
  assert.match(seen[0].instructions, /working as “Accountant”/);
  assert.ok(!seen[0].tools.includes('create_funnel'), 'no funnel tools unless it builds funnels');
  assert.ok(seen[0].tools.includes('tally_overview'));
  assert.ok(!seen[1].tools.includes('create_coupon'), 'use_tools can’t load a group it isn’t allowed');
  assert.ok(!log.some((l) => l.startsWith('POST /coupons')), 'a tool outside its work is refused');
});

test('ask-first teammates and unattended runs turn every change into a Confirm card; reads still run', async () => {
  const m = TM.cleanMate({ name: 'Sales', groups: ['crm', 'selling'], askFirst: true }, {}, Object.keys(H.TOOL_GROUPS));
  const { model } = script([reply(fc('list_products'), fc('create_coupon', { code: 'Y', type: 'percent', value: 5 })), reply(text('ok'))]);
  const { ctx, log } = ctxWith();
  await turn(model, ctx, m, 'make a coupon');
  assert.ok(log.includes('GET /products'), 'reading runs');
  assert.ok(!log.some((l) => l.startsWith('POST /coupons')), 'the change waits');
  assert.equal(ctx.pending.length, 1);
  assert.match(ctx.pending[0].label, /^Sales: /);

  const free = TM.cleanMate({ name: 'Marketer', groups: ['selling'], askFirst: false }, {}, Object.keys(H.TOOL_GROUPS));
  const s2 = script([reply(fc('create_coupon', { code: 'Z', type: 'percent', value: 5 })), reply(text('ok'))]);
  const w = ctxWith();
  await turn(s2.model, { ...w.ctx, unattended: true }, free);
  assert.ok(!w.log.some((l) => l.startsWith('POST /coupons')), 'a scheduled run never changes anything on its own');
  const live = ctxWith();
  await turn(script([reply(fc('create_coupon', { code: 'Z', type: 'percent', value: 5 })), reply(text('ok'))]).model, live.ctx, free);
  assert.ok(live.log.some((l) => l.startsWith('POST /coupons')), 'with the seller chatting, it just does it');
});

test('the schedule: due once a day at the seller’s time, on its days only', () => {
  const m = TM.cleanMate({ name: 'S', groups: ['crm'], schedule: { on: true, time: '09:30', days: [1], task: 'go' } }, {}, ['crm']);
  const ist = (iso) => TM.dueDay(m, 'Asia/Kolkata', new Date(iso));
  assert.equal(ist('2026-11-09T03:59:00Z'), null, 'Monday 9:29 IST: not yet');
  assert.equal(ist('2026-11-09T04:00:00Z'), '2026-11-09', 'Monday 9:30 IST');
  assert.equal(ist('2026-11-09T10:00:00Z'), '2026-11-09', 'a late tick the same day still runs it');
  assert.equal(ist('2026-11-10T04:00:00Z'), null, 'not on Tuesday');
  assert.equal(TM.dueDay({ ...m, lastRunDay: '2026-11-09' }, 'Asia/Kolkata', new Date('2026-11-09T05:00:00Z')), null, 'never twice a day');
  assert.equal(TM.dueDay({ ...m, schedule: { ...m.schedule, on: false } }, 'Asia/Kolkata', new Date('2026-11-09T05:00:00Z')), null);
  assert.equal(TM.cleanMate({ schedule: { on: true, task: '', days: [1] } }, {}, []).schedule.on, false, 'no task, no schedule');
});
