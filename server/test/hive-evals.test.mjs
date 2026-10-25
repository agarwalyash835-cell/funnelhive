// The Hive test bank (server/evals): every case is well-formed and names real tools, the grader judges by what
// happened, and the runner works end to end — here against a scripted fake model (the real run uses the real one).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { grade, summarise } from '../evals/grade.mjs';
import { loadBank, pick, main } from '../evals/run.mjs';

test('the bank: unique ids, real tools and CRM styles, valid checks', async () => {
  process.env.DATA_DIR ||= fs.mkdtempSync(path.join(os.tmpdir(), 'fh-evals-bank-'));
  await import('../sales.js');
  const { TOOLS } = await import('../hive.js');
  const { KITS } = await import('../crmkits.js').catch(() => ({}));
  const names = new Set(TOOLS.map((t) => t.name));
  const cases = loadBank();
  assert.ok(cases.length >= 150, `${cases.length} cases`);
  assert.equal(new Set(cases.map((c) => c.id)).size, cases.length, 'ids are unique');
  for (const c of cases) {
    assert.ok(c.message && c.industry && c.expect, c.id);
    for (const n of [...(c.expect.tools || []), ...(c.expect.anyTools || []), ...(c.expect.notTools || []), ...(c.expect.confirm || [])]) assert.ok(names.has(n), `${c.id}: no tool ${n}`);
    for (const s of c.setup || []) assert.ok(['funnel', 'product', 'contacts'].includes(s), `${c.id}: setup ${s}`);
    for (const s of c.expect.state || []) { assert.ok(s.get === '{funnel}' || s.get.startsWith('/'), c.id); new RegExp(s.match); }
    for (const k of ['reply', 'replyNot']) if (c.expect[k]) new RegExp(c.expect[k]);
    if (c.kit && KITS) assert.ok(KITS.some((x) => x.id === c.kit), `${c.id}: CRM style ${c.kit}`);
  }
  assert.ok(new Set(cases.map((c) => c.industry)).size >= 20, 'every focus industry is covered');
  assert.deepEqual(pick(cases, 'education').map((c) => c.industry).filter((x) => x !== 'education'), []);
  assert.equal(pick(cases, null, 5).length, 5);
});

test('the grader judges by what happened', () => {
  const c = { id: 'a', industry: 'x', expect: { tools: ['create_coupon'], notTools: ['send_broadcast'], confirm: ['remove_step'], state: [{ get: '/coupons', match: 'SAVE10' }] } };
  const ok = grade(c, { tools: [{ name: 'create_coupon', status: 'done' }, { name: 'remove_step', status: 'confirm' }, { name: 'send_broadcast', status: 'confirm' }], reply: 'Made SAVE10.', state: { '/coupons': '[{"code":"SAVE10"}]' } });
  assert.deepEqual([ok.pass, ok.fails], [true, []]);
  const bad = grade(c, { tools: [{ name: 'remove_step', status: 'done' }, { name: 'send_broadcast', status: 'done' }, { name: 'get_page', status: 'error' }], reply: 'Sorry, I can’t create coupons.', state: { '/coupons': '[]' } });
  assert.equal(bad.pass, false);
  assert.equal(bad.fails.length, 5, bad.fails.join(' | ')); // no coupon, sent, deleted without Confirm, state, refusal
  assert.equal(bad.warns.length, 1);
  assert.equal(grade({ id: 'b', industry: 'x', refusalOk: true, expect: {} }, { tools: [], reply: 'I can’t book flights, but…', state: {} }).pass, true);
  assert.deepEqual(summarise([{ industry: 'a', pass: true }, { industry: 'a', pass: false }, { industry: 'b', pass: true }]).byIndustry, { a: { pass: 1, total: 2 }, b: { pass: 1, total: 1 } });
});

test('the runner: its own app and throwaway database, a fresh account per case, graded and reported', async () => {
  // a fake model that makes the coupon named in the request
  const fake = http.createServer((req, res) => {
    let b = ''; req.on('data', (x) => { b += x; });
    req.on('end', () => {
      const body = JSON.parse(b || '{}'), input = body.input || [];
      const user = [...input].reverse().find((x) => x.role === 'user')?.content || '';
      const code = /coupon (\w+)/i.exec(user)?.[1];
      const out = input.some((x) => x.type === 'function_call_output') || !code ? [{ type: 'message', content: [{ text: 'Done — your coupon is ready.' }] }]
        : [{ type: 'function_call', call_id: 'c1', name: 'create_coupon', arguments: JSON.stringify({ code, type: 'percent', value: 10 }) }];
      res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ output: out }));
    });
  }).listen(0);
  await new Promise((r) => setTimeout(r, 30));
  const bank = [
    { id: 't-coupon', industry: 'test', message: 'Create a coupon SAVE10 for 10% off.', setup: ['contacts'], expect: { tools: ['create_coupon'], state: [{ get: '/coupons', match: 'SAVE10' }] } },
    { id: 't-miss', industry: 'test', message: 'Set up my booking calendar for 30 minutes.', expect: { tools: ['configure_calendar'] } },
  ];
  try {
    const r = await main({ bank, concurrency: 2, min: 0.9, quiet: true, env: { KIE_API_KEY: 'kie-test', KIE_BASE_URL: `http://127.0.0.1:${fake.address().port}` } });
    assert.deepEqual(r.results.map((x) => [x.id, x.pass]), [['t-coupon', true], ['t-miss', false]]);
    assert.deepEqual(r.results[1].fails, ['didn’t use configure_calendar']);
    assert.equal(r.ok, false, '50% is under the bar');
    assert.ok(fs.existsSync(r.file));
    fs.rmSync(r.file);
  } finally { fake.close(); }
});
