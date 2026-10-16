// Pop-up builder: a step's pop-ups are saved cleaned and capped, reach the live page, and sign-ups from them are leads.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, register } from './helpers.mjs';

let srv, api, T, f;
before(async () => {
  srv = await startServer();
  api = srv.api;
  T = (await register(api)).token;
  f = (await api('/funnels', 'POST', { name: 'Popup test' }, T)).data;
});
after(() => srv.stop());

const optin = (id) => ({ id, type: 'optin', props: { title: 'Free guide', buttonText: 'Send it' } });
const save = (popups) => api(`/funnels/${f.id}`, 'PUT', { steps: [{ ...f.steps[0], popups }] }, T);

test('saving pop-ups keeps up to 3, with known blocks only and safe settings', async () => {
  const many = Array.from({ length: 30 }, (_, i) => ({ id: `t${i}`, type: 'text', props: { title: 'x' } }));
  const r = await save([
    { id: 'p1', name: 'Exit offer', size: 'center', trigger: { type: 'exit' }, frequency: 'visitor', blocks: [optin('b1'), { id: 'b2', type: 'checkout', props: {} }, { id: 'b3', type: 'countdown', props: { mode: 'evergreen', minutes: 5 } }, { id: 'b4', type: 'nope', props: {} }] },
    { id: 'p1', name: '', size: 'giant', trigger: { type: 'delay', value: 99999 }, frequency: 'often', blocks: many },
    { id: 'p3', name: 'Scroll', size: 'bar', trigger: { type: 'scroll', value: 40 }, after: 'next', blocks: [] },
    { id: 'p4', name: 'Fourth', blocks: [] },
    'junk',
  ]);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const pops = r.data.steps[0].popups;
  assert.equal(pops.length, 3, 'at most 3 pop-ups');
  assert.deepEqual(pops[0].blocks.map((b) => b.type), ['optin', 'countdown'], 'checkout and unknown blocks dropped');
  assert.equal(pops[0].blocks[1].props.mode, 'fixed', 'pop-up countdowns end at a fixed time');
  assert.notEqual(pops[1].id, 'p1', 'duplicate ids are replaced');
  assert.equal(pops[1].name, 'Pop-up 2');
  assert.equal(pops[1].size, 'center');
  assert.equal(pops[1].frequency, 'session');
  assert.deepEqual(pops[1].trigger, { type: 'delay', value: 600 });
  assert.equal(pops[1].blocks.length, 20, 'at most 20 blocks each');
  assert.deepEqual(pops[2].trigger, { type: 'scroll', value: 40 });
  assert.equal(pops[2].after, 'next');
  // an empty list removes them
  const none = await save([]);
  assert.equal(none.data.steps[0].popups, undefined);
  f = (await save([{ id: 'p1', name: 'Exit offer', trigger: { type: 'exit' }, blocks: [optin('b1')] }])).data;
});

test('the live funnel carries the pop-ups; a sign-up from a pop-up is a lead; views are recorded', async () => {
  const pubd = await api(`/funnels/${f.id}`, 'PUT', { published: true }, T);
  assert.equal(pubd.status, 200, JSON.stringify(pubd.data));
  const live = (await api(`/public/${f.slug}`)).data;
  assert.equal(live.steps[0].popups[0].id, 'p1');
  assert.equal(live.steps[0].popups[0].blocks[0].type, 'optin');
  const stepId = live.steps[0].id;
  assert.equal((await api(`/public/${f.slug}/event`, 'POST', { stepId, type: 'popup_view', popupId: 'p1', visitor: 'vis-1' })).status, 200);
  const lead = await api(`/public/${f.slug}/lead`, 'POST', { stepId, popupId: 'p1', email: 'popup@example.in', name: 'Asha', consent: true, visitor: 'vis-1' });
  assert.equal(lead.status, 200, JSON.stringify(lead.data));
  assert.equal((await api(`/public/${f.slug}/event`, 'POST', { stepId, type: 'popup_convert', popupId: 'p1', visitor: 'vis-1' })).status, 200);
  const contacts = (await api('/contacts', 'GET', null, T)).data;
  assert.ok(contacts.some((c) => c.email === 'popup@example.in' && c.type === 'lead'), 'the pop-up sign-up is a lead');
  // a pop-up id the step doesn't have is ignored, not an error
  assert.equal((await api(`/public/${f.slug}/event`, 'POST', { stepId, type: 'popup_view', popupId: 'nope' })).status, 200);
});
