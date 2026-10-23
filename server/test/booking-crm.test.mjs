// Bookings follow the CRM style: a real-estate "Site visit" calendar (preset from the style) books a visit → the
// person is listed in the CRM, the Site visit date and the form answers land in their fields, they move to "Site
// visit scheduled" (which starts stage automations); marking it completed moves them on; a no-show is tagged.
// Quote clients are listed in the CRM too.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, register } from './helpers.mjs';

let srv, api, T, pipe, handle;
const k = (x) => encodeURIComponent(x);
const until = async (fn, ms = 4000) => { const end = Date.now() + ms; for (;;) { const v = await fn(); if (v || Date.now() > end) return v; await new Promise((r) => setTimeout(r, 60)); } };
before(async () => {
  srv = await startServer({ AUTOMATION_TICK_MS: '50', APP_URL: 'https://app.example.in' });
  api = srv.api;
  T = (await register(api)).token;
  const kit = (await api('/crm/kit', 'POST', { id: 'realestate' }, T)).data;
  pipe = (await api('/pipelines', 'GET', null, T)).data.find((p) => p.id === kit.current.pipelineId);
  handle = (await api('/booking-page', 'GET', null, T)).data.handle;
});
after(() => srv?.stop());

test('a site visit booking fills the CRM and moves the lead; completed / no-show follow', async () => {
  const kb = (await api('/crm/kit-booking', 'GET', null, T)).data;
  assert.equal(kb.name, 'Site visit');
  assert.equal(kb.booked.name, 'Site visit scheduled');
  assert.equal(kb.dateField.id, 're_visit');
  assert.deepEqual(kb.preset.questions.map((q) => [q.fieldId, q.type]), [['re_type', 'select'], ['re_bhk', 'select'], ['re_location', 'text']]);
  const cal = (await api('/calendars', 'POST', kb.preset, T)).data;
  assert.equal(cal.questions[1].fieldId, 're_bhk', 'questions keep their CRM field');
  // a stage automation picks up the move
  const a = (await api('/automations', 'POST', { name: 'Directions', trigger: { type: 'stage', pipelineId: pipe.id, stageId: kb.booked.id }, steps: [{ type: 'tag', tag: 'send-directions', action: 'add' }] }, T)).data;
  await api(`/automations/${a.id}`, 'PUT', { active: true }, T);

  const page = (await api(`/meet/${handle}/${cal.slug}`)).data;
  const start = page.slots[0];
  const ans = Object.fromEntries(cal.questions.map((q) => [q.id, q.type === 'select' ? q.options[1] : 'Baner, Pune']));
  const r = await api(`/meet/${handle}/${cal.slug}/book`, 'POST', { start, name: 'Kiran Shah', email: 'kiran@example.in', phone: '9876543210', answers: ans });
  assert.equal(r.status, 200, JSON.stringify(r.data));

  const c = (await api(`/contacts/${k('kiran@example.in')}`, 'GET', null, T)).data;
  assert.ok(c.key, 'listed in the CRM');
  assert.match(JSON.stringify(c.timeline), /Booked a call/);
  assert.match(c.custom.re_visit, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(c.custom.re_bhk, cal.questions[1].options[1]);
  assert.equal(c.custom.re_location, 'Baner, Pune');
  assert.equal(c.stages[pipe.id], kb.booked.id);
  assert.ok(await until(async () => (await api(`/contacts/${k('kiran@example.in')}`, 'GET', null, T)).data.tags.includes('send-directions')), 'stage automation ran');

  const b = (await api('/bookings', 'GET', null, T)).data.find((x) => x.email === 'kiran@example.in');
  await api(`/bookings/${b.id}`, 'PUT', { outcome: 'completed' }, T);
  assert.equal((await api(`/contacts/${k('kiran@example.in')}`, 'GET', null, T)).data.stages[pipe.id], kb.done.id, 'completed → Site visit done');
  // a later booking never pulls them back
  await api(`/bookings/${b.id}`, 'PUT', { outcome: 'no_show' }, T);
  const after = (await api(`/contacts/${k('kiran@example.in')}`, 'GET', null, T)).data;
  assert.ok(after.tags.includes('no-show'));
  assert.equal(after.stages[pipe.id], kb.done.id);
});

test('quote clients are listed in the CRM; a coach (no CRM style) gets plain calls', async () => {
  await api('/quotes', 'POST', { client: { name: 'Meera Rao', email: 'meera@client.in' }, title: 'Sprint', items: [{ name: 'Workshop', qty: 1, price: 25000 }], currency: 'INR' }, T);
  const c = (await api(`/contacts/${k('meera@client.in')}`, 'GET', null, T)).data;
  assert.ok(c.key);
  assert.match(JSON.stringify(c.timeline), /Sent a quote/);
  const T2 = (await register(api)).token;
  assert.equal((await api('/crm/kit-booking', 'GET', null, T2)).data.kit, null);
});
