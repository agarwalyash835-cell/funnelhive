// CRM automations: "a contact field changes" (optionally to one value), the "update a field" step (with today /
// +N days for dates and {{f_field}} variables), "stuck in a stage for N days" (once per time they entered it), and
// the ready-made automations for the current CRM style (built with this seller's own stage and field ids).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, register } from './helpers.mjs';

let srv, api, T, pipe;
const k = (key) => encodeURIComponent(key);
const until = async (fn, ms = 4000) => { const end = Date.now() + ms; for (;;) { const v = await fn(); if (v || Date.now() > end) return v; await new Promise((r) => setTimeout(r, 60)); } };
before(async () => {
  srv = await startServer({ AUTOMATION_TICK_MS: '50', AUTOMATION_TIME_SCALE: '0.0001' });
  api = srv.api;
  T = (await register(api)).token;
  const kit = (await api('/crm/kit', 'POST', { id: 'realestate' }, T)).data;
  pipe = (await api('/pipelines', 'GET', null, T)).data.find((p) => p.id === kit.current.pipelineId);
  await api('/contacts', 'POST', { email: 'rohan@example.in', name: 'Rohan Mehta' }, T);
});
after(() => srv?.stop());

const make = async (a) => {
  const c = (await api('/automations', 'POST', a, T)).data;
  const on = await api(`/automations/${c.id}`, 'PUT', { active: true }, T);
  assert.equal(on.status, 200, JSON.stringify(on.data));
  return c;
};
const contact = async () => (await api(`/contacts/${k('rohan@example.in')}`, 'GET', null, T)).data;

test('a field change starts an automation (only for the chosen value); the field step sets fields', async () => {
  await make({
    name: 'Loan needed', trigger: { type: 'field', fieldId: 're_loan', value: 'needed' },
    steps: [{ type: 'tag', tag: 'loan-lead', action: 'add' }, { type: 'field', fieldId: 're_visit', value: '+2 days' }, { type: 'field', fieldId: 're_purpose', value: 'Investment' }],
  });
  await api(`/contacts/${k('rohan@example.in')}`, 'PATCH', { custom: { re_loan: 'Not needed' } }, T);
  await new Promise((r) => setTimeout(r, 400));
  assert.ok(!(await contact()).tags.includes('loan-lead'), 'another value doesn’t start it');
  await api(`/contacts/${k('rohan@example.in')}`, 'PATCH', { custom: { re_loan: 'Needed' } }, T);
  const c = await until(async () => { const x = await contact(); return x.tags.includes('loan-lead') && x.custom.re_purpose ? x : null; });
  assert.ok(c, 'ran');
  assert.equal(c.custom.re_purpose, 'Investment');
  assert.match(c.custom.re_visit, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(Date.parse(c.custom.re_visit) > Date.now(), '+2 days is in the future');
  // saving the same value again isn't a change
  const runs = async (name) => (await api('/automations', 'GET', null, T)).data.automations.find((a) => a.name === name).stats.started;
  const before = await runs('Loan needed');
  await api(`/contacts/${k('rohan@example.in')}`, 'PATCH', { custom: { re_loan: 'Needed' } }, T);
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(await runs('Loan needed'), before);
});

test('stuck in a stage: fires after N days in it, once per time the contact entered it', async () => {
  const neg = pipe.stages.find((s) => s.name === 'Negotiation');
  await make({ name: 'Stuck', trigger: { type: 'stuck', pipelineId: pipe.id, stageId: neg.id, days: 1 }, steps: [{ type: 'tag', tag: 'stuck', action: 'add' }] });
  await api(`/contacts/${k('rohan@example.in')}`, 'PATCH', { stage: { pipelineId: pipe.id, stageId: neg.id } }, T);
  // 1 day × 0.0001 = under 9 seconds of test time
  const c = await until(async () => (await contact()).tags.includes('stuck'), 15000);
  assert.ok(c, 'fired once they had been in Negotiation long enough');
});

test('ready-made automations for the CRM style use the seller’s own ids and switch on cleanly', async () => {
  const r = (await api('/crm/kit-automations', 'GET', null, T)).data;
  assert.equal(r.kit, 'Real estate builder / broker');
  assert.deepEqual(r.recipes.map((x) => x.title), ['Site visit reminder', 'Deal stuck in negotiation']);
  const stuck = r.recipes[1].a.trigger;
  assert.equal(stuck.pipelineId, pipe.id);
  assert.equal(stuck.stageId, pipe.stages.find((s) => s.name === 'Negotiation').id);
  for (const x of r.recipes) await make(x.a);
  // a coach (no CRM style) gets none
  const T2 = (await register(api)).token;
  assert.deepEqual((await api('/crm/kit-automations', 'GET', null, T2)).data.recipes, []);
});
