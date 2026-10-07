// CRM: contact timeline, pipelines, custom fields, manual contacts, activities.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, register } from './helpers.mjs';

let srv, api, T, f;
const k = (key) => encodeURIComponent(key);
before(async () => {
  srv = await startServer();
  api = srv.api;
  T = (await register(api)).token;
  f = (await api('/templates/yoga/use', 'POST', {}, T)).data;
  await api(`/funnels/${f.id}`, 'PUT', { published: true }, T);
});
after(() => srv.stop());

test('timeline: first visit, sign-up, purchase, upsell — linked by visitor id', async () => {
  const land = f.steps[0], co = f.steps.find((s) => s.type === 'checkout'), up = f.steps.find((s) => s.type === 'upsell');
  const visitor = 'vis12345ab';
  const ev = (stepId) => api(`/public/${f.slug}/event`, 'POST', { stepId, type: 'view', source: 'instagram', visitor });
  await ev(land.id);
  await api(`/public/${f.slug}/lead`, 'POST', { stepId: land.id, email: 'Asha@Example.com', name: 'Asha', phone: '9876500000', source: 'instagram', visitor });
  const o = (await api(`/public/${f.slug}/order`, 'POST', { stepId: co.id, email: 'asha@example.com', name: 'Asha', visitor })).data;
  await api(`/public/${f.slug}/order`, 'POST', { stepId: up.id, orderId: o.orderId, visitor });

  const list = (await api('/contacts', 'GET', null, T)).data;
  const c = list.find((x) => x.key === 'asha@example.com');
  assert.ok(c, 'contact keyed by lower-case email');
  assert.equal(c.type, 'customer');
  const d = (await api(`/contacts/${k(c.key)}`, 'GET', null, T)).data;
  const types = d.timeline.map((t) => t.type);
  for (const t of ['visit', 'lead', 'purchase', 'upsell']) assert.ok(types.includes(t), `timeline has ${t}`);
  assert.equal(d.timeline.find((t) => t.type === 'visit').title, 'First visit');
  assert.match(d.timeline.find((t) => t.type === 'visit').text, /from instagram/);
  assert.ok(d.timeline.find((t) => t.type === 'upsell').amount > 0);
  assert.equal(d.orderList.length, 1);
  assert.equal(d.phone, '9876500000');
  // other users never see it
  const other = (await register(api)).token;
  assert.equal((await api(`/contacts/${k(c.key)}`, 'GET', null, other)).status, 404);
});

test('pipelines: default created, customers start in Won, moves are logged, last pipeline protected', async () => {
  const pipes = (await api('/pipelines', 'GET', null, T)).data;
  assert.equal(pipes.length, 1);
  const p = pipes[0];
  const won = p.stages.find((s) => s.won);
  const c = (await api('/contacts', 'GET', null, T)).data.find((x) => x.key === 'asha@example.com');
  assert.equal(c.stages[p.id], won.id, 'customer starts in the won stage');
  const lost = p.stages.find((s) => s.lost);
  assert.equal((await api(`/contacts/${k(c.key)}`, 'PATCH', { stage: { pipelineId: p.id, stageId: lost.id } }, T)).status, 200);
  assert.equal((await api(`/contacts/${k(c.key)}`, 'PATCH', { stage: { pipelineId: p.id, stageId: 'nope' } }, T)).status, 400);
  const d = (await api(`/contacts/${k(c.key)}`, 'GET', null, T)).data;
  assert.equal(d.stages[p.id], lost.id);
  assert.equal(d.timeline[0].title, `Moved to ${lost.name}`);
  assert.equal((await api(`/pipelines/${p.id}`, 'DELETE', null, T)).status, 400, 'cannot delete the only pipeline');
  const np = (await api('/pipelines', 'POST', { name: 'Webinar', stages: [{ name: 'Registered' }, { name: 'Attended', color: 'red' }] }, T)).data;
  assert.equal(np.stages.length, 2);
  assert.match(np.stages[1].color, /^#[0-9a-f]{6}$/i, 'bad colours replaced');
  const upd = (await api(`/pipelines/${np.id}`, 'PUT', { stages: [...np.stages, { name: 'Bought' }] }, T)).data;
  assert.equal(upd.stages.length, 3);
  assert.equal((await api(`/pipelines/${np.id}`, 'PUT', { stages: [] }, T)).status, 400);
  assert.equal((await api(`/pipelines/${np.id}`, 'DELETE', null, T)).status, 200);
});

test('custom fields: typed values, unknown fields ignored', async () => {
  const fields = (await api('/crm/fields', 'PUT', { fields: [{ label: 'City', type: 'text' }, { label: 'Budget', type: 'number' }, { label: 'Level', type: 'select', options: 'A, B' }, { label: 'Paid', type: 'checkbox' }, { label: 'X', type: 'evil' }] }, T)).data;
  assert.equal(fields.length, 5);
  assert.equal(fields[4].type, 'text', 'unknown type falls back to text');
  const [city, budget, level, paid] = fields;
  await api(`/contacts/${k('asha@example.com')}`, 'PATCH', { custom: { [city.id]: 'Pune', [budget.id]: '25000', [level.id]: 'B', [paid.id]: 1, hacker: 'x' } }, T);
  const d = (await api(`/contacts/${k('asha@example.com')}`, 'GET', null, T)).data;
  assert.deepEqual(d.custom, { [city.id]: 'Pune', [budget.id]: 25000, [level.id]: 'B', [paid.id]: true });
});

test('manual contacts, notes, WhatsApp log, email without a mail provider', async () => {
  assert.equal((await api('/contacts', 'POST', { name: 'Ravi' }, T)).status, 400, 'needs email or phone');
  assert.equal((await api('/contacts', 'POST', { email: 'bad' }, T)).status, 400);
  const r = (await api('/contacts', 'POST', { name: 'Ravi', phone: '+91 90000 12345' }, T)).data;
  assert.equal(r.key, 'phone:+91 90000 12345');
  assert.equal((await api('/contacts', 'POST', { phone: '+91 90000 12345' }, T)).status, 409);
  const key = k(r.key);
  assert.equal((await api(`/contacts/${key}/activity`, 'POST', { type: 'note', text: '' }, T)).status, 400);
  const note = (await api(`/contacts/${key}/activity`, 'POST', { type: 'note', text: 'Interested in the weekend batch' }, T)).data;
  await api(`/contacts/${key}/activity`, 'POST', { type: 'whatsapp', text: 'Hi Ravi!' }, T);
  assert.equal((await api(`/contacts/${key}/email`, 'POST', { subject: 'Hi', text: 'Hello' }, T)).status, 400, 'no email address yet');
  await api(`/contacts/${key}`, 'PATCH', { email: 'ravi@example.com', tags: ['vip', 'vip', 'webinar'] }, T);
  const sent = (await api(`/contacts/${key}/email`, 'POST', { subject: 'Batch details', text: 'Here you go' }, T)).data;
  assert.equal(sent.status, 'not-configured', 'recorded, not claimed as delivered');
  let d = (await api(`/contacts/${key}`, 'GET', null, T)).data;
  assert.deepEqual(d.tags, ['vip', 'webinar']);
  assert.equal(d.email, 'ravi@example.com');
  assert.deepEqual(d.timeline.slice(0, 3).map((t) => t.type), ['email', 'whatsapp', 'note']);
  assert.ok(d.timeline.some((t) => t.type === 'created'));
  await api(`/contacts/${key}/activity/${note.id}`, 'DELETE', null, T);
  d = (await api(`/contacts/${key}`, 'GET', null, T)).data;
  assert.ok(!d.timeline.some((t) => t.type === 'note'));
});

test('return visits show as "Came back" (demo data has them)', async () => {
  const tok = (await register(api)).token;
  await api('/demo/seed', 'POST', {}, tok);
  const list = (await api('/contacts', 'GET', null, tok)).data;
  let found = null;
  for (const c of list.slice(0, 120)) {
    const d = (await api(`/contacts/${k(c.key)}`, 'GET', null, tok)).data;
    if (d.timeline.some((t) => t.title === 'Came back')) { found = d; break; }
  }
  assert.ok(found, 'some contact has a return visit');
  const visits = found.timeline.filter((t) => t.type === 'visit');
  assert.equal(visits.at(-1).title, 'First visit', 'oldest visit is the first one');
});
