// Double-booking: many people pressing "Book" on the same time at the same moment — exactly one gets it, the
// rest are told it was just taken; paid-call holds block the slot too.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, register } from './helpers.mjs';

let srv, api, v;
before(async () => {
  srv = await startServer({ APP_URL: 'https://app.example.in' });
  api = srv.api;
  const T = (await register(api)).token;
  v = (await api('/templates/v-founders/use', 'POST', {}, T)).data;
  await api(`/funnels/${v.id}`, 'PUT', { published: true }, T);
});
after(() => srv?.stop());

test('20 simultaneous bookings of one slot: exactly one wins', async () => {
  const step = v.steps.find((s) => s.blocks.some((b) => b.type === 'booking'));
  const blockId = step.blocks.find((b) => b.type === 'booking').id;
  const apply = v.steps[1];
  const form = apply.blocks.find((b) => b.type === 'form');
  const slot = (await api(`/public/${v.slug}/slots?stepId=${step.id}&blockId=${blockId}`)).data.slots[2];
  const people = Array.from({ length: 20 }, (_, i) => `racer${i}@example.in`);
  for (const email of people) {
    const fields = Object.fromEntries(form.props.fields.map((f) => [f.label, f.type === 'select' ? f.options.split(', ').find((o) => !(f.reject || '').split(', ').includes(o)) : f.type === 'email' ? email : 'Racer']));
    await api(`/public/${v.slug}/lead`, 'POST', { stepId: apply.id, email, name: 'Racer', fields });
  }
  const results = await Promise.all(people.map((email) => api(`/public/${v.slug}/book`, 'POST', { stepId: step.id, blockId, start: slot, name: 'Racer', email, phone: '9876543210' })));
  const won = results.filter((r) => r.status === 200);
  assert.equal(won.length, 1, JSON.stringify(results.map((r) => r.status)));
  assert.ok(results.filter((r) => r.status === 409).every((r) => /just taken/.test(r.data.error)));
  assert.ok(!(await api(`/public/${v.slug}/slots?stepId=${step.id}&blockId=${blockId}`)).data.slots.includes(slot));
});
