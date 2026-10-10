// Contacts: CSV import (merging, skipping, tags, no automations) and a contact's data export (access request).
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
  const land = f.steps[0], co = f.steps.find((s) => s.type === 'checkout');
  await api(`/public/${f.slug}/lead`, 'POST', { stepId: land.id, email: 'asha@example.com', name: 'Asha', phone: '9876500000', visitor: 'visimport1' });
  await api(`/public/${f.slug}/order`, 'POST', { stepId: co.id, email: 'buyer@example.com', name: 'Bina', visitor: 'visimport2' });
});
after(() => srv.stop());

test('import: creates, merges by email then phone, skips bad rows, adds tags — and fires no automation', async () => {
  const auto = (await api('/automations', 'POST', { name: 'On vip', trigger: { type: 'tag', tag: 'vip' }, steps: [{ type: 'tag', tag: 'got-vip-flow' }] }, T)).data;
  await api(`/automations/${auto.id}`, 'PUT', { active: true }, T);
  const before = (await api('/contacts', 'GET', null, T)).data.length;
  const rows = [
    { Email: 'New1@Example.com', Name: 'New One', Tags: 'vip; webinar', Stage: 'Interested', City: 'Pune' },
    { Email: 'asha@example.com', Name: 'Someone Else', Tags: 'vip' },
    { Phone: '+91 98765 11111', Name: 'Phone Only' },
    { Phone: '9876511111', Tags: 'repeat,vip' },
    { Email: 'not-an-email', Name: 'Bad' },
    { Name: 'Nobody' },
  ];
  const mapping = { Email: 'email', Name: 'name', Tags: 'tags', Stage: 'stage', Phone: 'phone', City: 'extra' };
  const r = await api('/contacts/import', 'POST', { rows, mapping, tags: ['imported'] }, T);
  assert.equal(r.status, 200);
  assert.deepEqual({ created: r.data.created, updated: r.data.updated, skipped: r.data.skipped }, { created: 2, updated: 2, skipped: 2 });
  assert.deepEqual(r.data.errors.map((e) => e.row), [5, 6]);

  const list = (await api('/contacts', 'GET', null, T)).data;
  assert.equal(list.length, before + 2);
  const n1 = list.find((c) => c.key === 'new1@example.com');
  assert.deepEqual(n1.tags, ['vip', 'webinar', 'imported']);
  assert.equal(n1.source, 'import');
  assert.equal(n1.type, 'lead');
  const pipes = (await api('/pipelines', 'GET', null, T)).data;
  assert.equal(pipes[0].stages.find((s) => s.id === n1.stages[pipes[0].id]).name, 'Interested');
  const d1 = (await api(`/contacts/${k(n1.key)}`, 'GET', null, T)).data;
  assert.ok(d1.timeline.some((t) => t.type === 'note' && /City: Pune/.test(t.text)), 'unmapped columns are kept in a note');
  assert.ok(d1.timeline.some((t) => t.type === 'created' && /CSV/.test(t.title)));

  const asha = list.find((c) => c.key === 'asha@example.com');
  assert.equal(asha.name, 'Asha', 'an existing name is not overwritten');
  assert.ok(asha.tags.includes('vip') && asha.tags.includes('imported'));
  const ph = list.find((c) => c.key === 'phone:+91 98765 11111');
  assert.ok(ph, 'phone-only contact created');
  assert.deepEqual(ph.tags, ['imported', 'repeat', 'vip'], 'second row merged into the same person by phone');

  // re-importing the same file changes nothing new
  const again = (await api('/contacts/import', 'POST', { rows: rows.slice(0, 1), mapping }, T)).data;
  assert.equal(again.updated, 1);
  assert.equal((await api(`/contacts/${k('new1@example.com')}`, 'GET', null, T)).data.timeline.filter((t) => t.type === 'note').length, 1);

  // imported tags never start the tag automation
  await new Promise((res) => setTimeout(res, 600));
  assert.equal((await api(`/automations/${auto.id}`, 'GET', null, T)).data.runs.length, 0);
  assert.ok(!(await api(`/contacts/${k('new1@example.com')}`, 'GET', null, T)).data.tags.includes('got-vip-flow'));

  assert.equal((await api('/contacts/import', 'POST', { rows: [] }, T)).status, 400);
  assert.equal((await api('/contacts/import', 'POST', { rows: Array.from({ length: 10001 }, () => ({ e: '' })) }, T)).status, 400);
});

test('export: everything about one contact, as a download; other sellers get 404', async () => {
  const get = (key, token = T) => fetch(`${srv.base}/api/contacts/${k(key)}/export`, { headers: { authorization: `Bearer ${token}` } });
  const r = await get('buyer@example.com');
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-disposition'), /attachment; filename="contact-buyer@example\.com\.json"/);
  const d = await r.json();
  assert.equal(d.contact.email, 'buyer@example.com');
  assert.equal(d.orders.length, 1);
  assert.ok(d.orders[0].items.length && d.orders[0].total > 0);
  assert.ok(!JSON.stringify(d).includes('"userId"'));

  const a = await (await get('asha@example.com')).json();
  assert.equal(a.leads.length, 1);
  assert.equal(a.leads[0].phone, '9876500000');
  assert.ok(a.crm.tags.includes('vip'));

  const other = (await register(api)).token;
  assert.equal((await get('buyer@example.com', other)).status, 404);
  assert.equal((await get('nobody@example.com')).status, 404);
});
