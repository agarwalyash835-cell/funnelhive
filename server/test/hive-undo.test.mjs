// Undo and 👍 / 👎 on Hive replies: one click puts back what a reply changed and removes what it made (newest first,
// once); a 👎 keeps the request and the steps for the platform's review. A scripted fake model drives real tools.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { startServer, register, enable2fa } from './helpers.mjs';

let fake, srv, api, T, fid, admin;
const call = (name, args) => ({ type: 'function_call', call_id: `c_${Math.random().toString(36).slice(2)}`, name, arguments: JSON.stringify(args) });
const say = (text) => ({ type: 'message', content: [{ type: 'output_text', text }] });
function brain(body) {
  const user = [...body.input].reverse().find((x) => x.role === 'user')?.content || '';
  const done = body.input.some((x) => x.type === 'function_call_output');
  if (done) return { output: [say('Renamed it and made the coupon.')] };
  if (user.startsWith('rename and coupon')) return { output: [call('update_funnel', { funnelId: fid, name: 'Renamed by Hive' }), call('create_coupon', { code: 'UNDO10', type: 'percent', value: 10 })] };
  if (user.startsWith('a second coupon')) return { output: [call('create_coupon', { code: 'SECOND5', type: 'percent', value: 5 })] };
  return { output: [say('Hello!')] };
}
before(async () => {
  fake = http.createServer((req, res) => { let b = ''; req.on('data', (c) => { b += c; }); req.on('end', () => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(brain(JSON.parse(b || '{}')))); }); }).listen(0);
  await new Promise((r) => setTimeout(r, 30));
  srv = await startServer({ KIE_API_KEY: 'kie-test', KIE_BASE_URL: `http://127.0.0.1:${fake.address().port}`, ADMIN_EMAILS: 'boss@undo.test' });
  api = srv.api;
  T = (await register(api)).token;
  const tpl = (await api('/templates')).data[0];
  fid = (await api(`/templates/${tpl.id}/use`, 'POST', {}, T)).data.id;
  const boss = await register(api, 'boss@undo.test');
  const m = srv.log().match(/To: boss@undo\.test[\s\S]*?\/verify\?token=([a-f0-9.]+)/);
  await api('/auth/verify', 'POST', { token: m[1] });
  admin = (await enable2fa(api, boss.token)).token;
});
after(async () => { await srv.stop(); fake.close(); });

async function chat(body) {
  const r = await fetch(`${srv.base}/api/hive/chat`, { method: 'POST', headers: { authorization: `Bearer ${T}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return (await r.text()).split('\n\n').filter((x) => x.startsWith('data: ')).map((x) => JSON.parse(x.slice(6)));
}

test('undo puts back what a reply changed and removes what it made — newest first, once', async () => {
  const before = (await api(`/funnels/${fid}`, 'GET', null, T)).data.name;
  const ev = await chat({ message: 'rename and coupon please' });
  const r1 = ev.find((e) => e.type === 'reply'), tid = ev.find((e) => e.type === 'thread').threadId;
  assert.ok(r1.undoId);
  assert.equal((await api(`/funnels/${fid}`, 'GET', null, T)).data.name, 'Renamed by Hive');
  assert.ok(JSON.stringify((await api('/coupons', 'GET', null, T)).data).includes('UNDO10'));
  // a later reply: the earlier one can't be undone before it
  const r2 = (await chat({ message: 'a second coupon', threadId: tid })).find((e) => e.type === 'reply');
  assert.equal((await api(`/hive/threads/${tid}/undo`, 'POST', { undoId: r1.undoId }, T)).status, 409);
  const u2 = await api(`/hive/threads/${tid}/undo`, 'POST', { undoId: r2.undoId }, T);
  assert.deepEqual([u2.status, u2.data.report.removed], [200, 1]);
  const u1 = await api(`/hive/threads/${tid}/undo`, 'POST', { undoId: r1.undoId }, T);
  assert.equal(u1.status, 200, JSON.stringify(u1.data));
  assert.deepEqual([u1.data.report.restored, u1.data.report.removed, u1.data.report.failed.length], [1, 1, 0]);
  assert.equal((await api(`/funnels/${fid}`, 'GET', null, T)).data.name, before, 'the funnel is back');
  assert.ok(!JSON.stringify((await api('/coupons', 'GET', null, T)).data).includes('UNDO10'), 'the coupon is gone');
  // the funnel's history keeps the Hive version too, so the undo itself can be reversed
  assert.ok((await api(`/funnels/${fid}/revisions`, 'GET', null, T)).data.some((r) => r.name === 'Renamed by Hive'));
  assert.equal((await api(`/hive/threads/${tid}/undo`, 'POST', { undoId: r1.undoId }, T)).status, 409, 'only once');
  const th = (await api(`/hive/threads/${tid}`, 'GET', null, T)).data;
  assert.ok(th.messages.filter((m) => m.undone).length === 2);
  // a reply that only talked has nothing to undo
  assert.equal((await chat({ message: 'hi', threadId: tid })).find((e) => e.type === 'reply').undoId, null);
});

test('👎 keeps the request and steps for review; the admin sees it; 👍 counts', async () => {
  const ev = await chat({ message: 'rename and coupon again' });
  const tid = ev.find((e) => e.type === 'thread').threadId;
  const m = (await api(`/hive/threads/${tid}`, 'GET', null, T)).data.messages.find((x) => x.role === 'assistant');
  assert.equal((await api(`/hive/threads/${tid}/feedback`, 'POST', { at: m.at, rating: 'down', note: 'wrong coupon value' }, T)).status, 200);
  assert.equal((await api(`/hive/threads/${tid}`, 'GET', null, T)).data.messages.find((x) => x.at === m.at).feedback.rating, 'down');
  const fb = (await api('/admin/hive-feedback', 'GET', null, admin)).data;
  assert.equal(fb.down, 1);
  assert.equal(fb.list[0].request, 'rename and coupon again');
  assert.equal(fb.list[0].note, 'wrong coupon value');
  assert.deepEqual(fb.list[0].tools.map((x) => x.name), ['update_funnel', 'create_coupon']);
  assert.equal((await api(`/admin/hive-feedback/${encodeURIComponent(fb.list[0].id)}/reviewed`, 'POST', {}, admin)).status, 200);
  assert.equal((await api('/admin/hive-feedback', 'GET', null, admin)).data.list.length, 0, 'reviewed ones leave the queue');
  // changing it to 👍
  await api(`/hive/threads/${tid}/feedback`, 'POST', { at: m.at, rating: 'up' }, T);
  assert.deepEqual([(await api('/admin/hive-feedback', 'GET', null, admin)).data.up, (await api('/admin/hive-feedback', 'GET', null, admin)).data.down], [1, 0]);
  // sellers can't read the review queue
  assert.equal((await api('/admin/hive-feedback', 'GET', null, T)).status, 403);
  assert.equal((await api(`/hive/threads/${tid}/feedback`, 'POST', { at: m.at, rating: 'meh' }, T)).status, 400);
});
