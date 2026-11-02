// Every CRM style (kit), one by one: what it defines holds together (columns, filters, the money field, won / lost
// stages, its automations and bookings point at real fields and stages); on a fresh account it adds its fields and
// pipeline, a contact takes a value in every field, moves through every stage, the quick filters and the money total
// work, its ready-made automations can be created and its booking setup is complete. And one account switching
// through every style in a row: each one still shows in full.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startServer, register } from './helpers.mjs';

let srv, api, KITS, KIT_AUTOMATIONS, KIT_BOOKING;
const k = (key) => encodeURIComponent(key);
before(async () => {
  process.env.DATA_DIR ||= fs.mkdtempSync(path.join(os.tmpdir(), 'ff-kits-'));
  ({ KITS, KIT_AUTOMATIONS, KIT_BOOKING } = await import('../crmkits.js'));
  srv = await startServer();
  api = srv.api;
});
after(async () => { await srv?.stop(); });

// a value for a field of each type, and what the CRM gives back
const SAMPLE = { text: ['Andheri West', 'Andheri West'], longtext: ['Line one\nLine two', 'Line one\nLine two'], number: ['12', 12], money: ['₹45,00,000', 4500000], phone: ['+91 98765 43210', null], date: ['2026-12-15', '2026-12-15'], url: ['https://example.com/x', 'https://example.com/x'], checkbox: [true, true] };
const sampleFor = (f) => (f.type === 'select' ? [f.options.split(',')[0].trim(), f.options.split(',')[0].trim()] : SAMPLE[f.type]);

test('every style is consistent: its columns, filters, money field, stages, automations and bookings point at real things', () => {
  assert.ok(KITS.length >= 23, `${KITS.length} styles`);
  for (const kit of KITS) {
    const ids = new Map(kit.fields.map((f) => [f.id, f]));
    assert.equal(ids.size, kit.fields.length, `${kit.id}: field ids are unique`);
    for (const f of kit.fields) {
      assert.ok(['text', 'longtext', 'number', 'money', 'phone', 'date', 'select', 'url', 'checkbox'].includes(f.type), `${kit.id}.${f.id}: type ${f.type}`);
      if (f.type === 'select') assert.ok(f.options.split(',').filter((o) => o.trim()).length >= 2, `${kit.id}.${f.id}: options`);
    }
    for (const id of [...kit.columns, ...kit.cardFields]) assert.ok(ids.has(id), `${kit.id}: column / card field ${id}`);
    for (const id of kit.filters) assert.equal(ids.get(id)?.type, 'select', `${kit.id}: filter ${id} is a select`);
    if (kit.valueField) assert.ok(['money', 'number'].includes(ids.get(kit.valueField)?.type), `${kit.id}: money field ${kit.valueField}`);
    assert.ok(kit.columns.length <= 5 && kit.cardFields.length <= 3 && kit.filters.length <= 4, `${kit.id}: list sizes`);
    for (const w of ['title', 'one', 'customers', 'leads', 'value']) assert.ok(kit.labels[w], `${kit.id}: label ${w}`);
    if (kit.id === 'general') continue;
    const stages = kit.pipeline?.stages || [];
    assert.ok(stages.length >= 4, `${kit.id}: a pipeline`);
    assert.equal(stages.filter((s) => s.won).length, 1, `${kit.id}: one won stage`);
    assert.equal(stages.filter((s) => s.lost).length, 1, `${kit.id}: one lost stage`);
    const stage = (name) => stages.some((s) => s.name.toLowerCase() === String(name).toLowerCase());
    const auto = KIT_AUTOMATIONS[kit.id];
    assert.ok(auto, `${kit.id}: ready-made automations`);
    assert.equal(ids.get(auto.date[0])?.type, 'date', `${kit.id}: automation date field ${auto.date[0]}`);
    assert.ok(stage(auto.stuck[0]), `${kit.id}: automation stage “${auto.stuck[0]}”`);
    const b = KIT_BOOKING[kit.id];
    if (!b) continue;
    if (b.date) assert.equal(ids.get(b.date)?.type, 'date', `${kit.id}: booking date field ${b.date}`);
    for (const id of b.ask) assert.ok(ids.has(id), `${kit.id}: booking question ${id}`);
    if (b.booked) assert.ok(stage(b.booked), `${kit.id}: booking stage “${b.booked}”`);
    if (b.done) assert.ok(stage(b.done), `${kit.id}: booking done stage “${b.done}”`);
  }
});

test('each style on a fresh account: fields, pipeline, a contact in every field and stage, filters, totals, automations, bookings', async () => {
  for (const kit of KITS) {
    const T = (await register(api)).token;
    const r = await api('/crm/kit', 'POST', { id: kit.id }, T);
    assert.equal(r.status, 200, kit.id);
    const cur = r.data.current;
    assert.deepEqual([cur.id, cur.labels.title, cur.columns, cur.cardFields, cur.filters, cur.valueField], [kit.id, kit.labels.title, kit.columns, kit.cardFields, kit.filters, kit.valueField], `${kit.id}: shown in full`);
    assert.deepEqual((await api('/crm/kits', 'GET', null, T)).data.current.id, kit.id);
    for (const f of kit.fields) assert.ok(r.data.fields.find((x) => x.id === f.id && x.type === f.type), `${kit.id}: field ${f.id}`);

    // a contact with a value in every field
    const email = `${kit.id}@example.com`;
    assert.equal((await api('/contacts', 'POST', { email, name: 'Asha Rao' }, T)).status, 200, `${kit.id}: contact`);
    const custom = Object.fromEntries(kit.fields.map((f) => [f.id, sampleFor(f)[0]]));
    assert.equal((await api(`/contacts/${k(email)}`, 'PATCH', { custom }, T)).status, 200, `${kit.id}: fields saved`);
    const c = (await api(`/contacts/${k(email)}`, 'GET', null, T)).data;
    for (const f of kit.fields) {
      const want = sampleFor(f)[1];
      if (want === null) assert.ok(c.custom[f.id], `${kit.id}.${f.id}: kept`);
      else assert.deepEqual(c.custom[f.id], want, `${kit.id}.${f.id} (${f.type})`);
    }

    if (kit.pipeline) {
      const p = (await api('/pipelines', 'GET', null, T)).data.find((x) => x.id === cur.pipelineId);
      assert.deepEqual(p?.stages.map((s) => s.name), kit.pipeline.stages.map((s) => s.name), `${kit.id}: pipeline`);
      for (const s of p.stages) {
        assert.equal((await api(`/contacts/${k(email)}`, 'PATCH', { stage: { pipelineId: p.id, stageId: s.id } }, T)).status, 200, `${kit.id}: to ${s.name}`);
        assert.equal((await api(`/contacts/${k(email)}`, 'GET', null, T)).data.stages[p.id], s.id, `${kit.id}: in ${s.name}`);
      }
    }
    // quick filters and the money total
    for (const id of kit.filters) {
      const v = custom[id];
      const hit = (await api(`/contacts?limit=10&cf=${k(JSON.stringify({ [id]: v }))}`, 'GET', null, T)).data;
      assert.equal(hit.total, 1, `${kit.id}: filter ${id}`);
      const other = kit.fields.find((f) => f.id === id).options.split(',')[1].trim();
      assert.equal((await api(`/contacts?limit=10&cf=${k(JSON.stringify({ [id]: other }))}`, 'GET', null, T)).data.total, 0, `${kit.id}: filter ${id} excludes`);
    }
    if (kit.valueField) {
      const want = sampleFor(kit.fields.find((f) => f.id === kit.valueField))[1];
      assert.equal((await api(`/contacts?limit=10&sum=${kit.valueField}`, 'GET', null, T)).data.totalValue, want, `${kit.id}: money total`);
    }
    // ready-made automations: both there and accepted as they are
    const autos = (await api('/crm/kit-automations', 'GET', null, T)).data;
    if (KIT_AUTOMATIONS[kit.id]) {
      assert.equal(autos.recipes.length, 2, `${kit.id}: automations ${JSON.stringify(autos).slice(0, 200)}`);
      for (const a of autos.recipes) {
        const made = await api('/automations', 'POST', a.a, T);
        assert.equal(made.status, 200, `${kit.id}: “${a.title}” ${JSON.stringify(made.data).slice(0, 200)}`);
      }
    } else assert.equal(autos.recipes.length, 0, kit.id);
    // bookings: the date field and stages resolve, the questions are the kit's fields
    const b = (await api('/crm/kit-booking', 'GET', null, T)).data, spec = KIT_BOOKING[kit.id];
    if (spec) {
      assert.equal(b.name, spec.name, kit.id);
      assert.equal(b.dateField?.id || null, spec.date || null, `${kit.id}: booking date field`);
      assert.equal(b.booked?.name || null, spec.booked || null, `${kit.id}: booked stage`);
      assert.equal(b.done?.name || null, spec.done || null, `${kit.id}: done stage`);
      assert.deepEqual(b.preset.questions.map((q) => q.fieldId), spec.ask, `${kit.id}: booking questions`);
    } else assert.equal(b.kit, null, kit.id);
    const tpl = (await api('/calendars/templates', 'GET', null, T)).data.templates;
    if (spec) assert.equal(tpl[0].id, kit.id, `${kit.id}: its call type listed first`);
  }
});

test('one account switching through every style in a row: each still shows in full and keeps its pipeline', async () => {
  const T = (await register(api)).token;
  const email = 'switcher@example.com';
  await api('/contacts', 'POST', { email }, T);
  // data from the first style: a budget, and the contact in its pipeline — this must survive everything below
  const re = (await api('/crm/kit', 'POST', { id: 'realestate' }, T)).data.current;
  const rp = (await api('/pipelines', 'GET', null, T)).data.find((x) => x.id === re.pipelineId);
  await api(`/contacts/${k(email)}`, 'PATCH', { custom: { re_budget: '8000000' }, stage: { pipelineId: rp.id, stageId: rp.stages[2].id } }, T);
  for (const kit of KITS) {
    const r = await api('/crm/kit', 'POST', { id: kit.id }, T);
    assert.equal(r.status, 200, kit.id);
    const cur = r.data.current;
    // each of the style's fields is there: its own, or one in use with the same name and type (shared, not doubled)
    const as = (id) => { const f = kit.fields.find((x) => x.id === id); return r.data.fields.find((x) => x.id === id) || r.data.fields.find((x) => x.label === f.label && x.type === f.type); };
    for (const f of kit.fields) assert.ok(as(f.id), `${kit.id}: field ${f.id} there after switching`);
    const ids = (list) => list.map((id) => as(id).id);
    assert.deepEqual([cur.columns, cur.cardFields, cur.filters, cur.valueField], [ids(kit.columns), ids(kit.cardFields), ids(kit.filters), kit.valueField && as(kit.valueField).id], `${kit.id}: shown in full after switching`);
    for (const id of kit.filters) assert.ok(kit.fields.find((x) => x.id === id).options.split(',').every((o) => as(id).options.includes(o.trim())), `${kit.id}: filter ${id} offers its options`);
    if (kit.pipeline) {
      const p = (await api('/pipelines', 'GET', null, T)).data.find((x) => x.id === cur.pipelineId);
      assert.equal(p?.name, kit.pipeline.name, `${kit.id}: its pipeline after switching`);
    }
    if (KIT_AUTOMATIONS[kit.id]) assert.equal((await api('/crm/kit-automations', 'GET', null, T)).data.recipes.length, 2, `${kit.id}: automations after switching`);
  }
  // nothing in use was dropped to make room: the budget field and value, the pipeline the contact is in
  const c = (await api(`/contacts/${k(email)}`, 'GET', null, T)).data;
  assert.deepEqual([c.custom.re_budget, c.stages[rp.id]], [8000000, rp.stages[2].id]);
  assert.ok((await api('/crm/fields', 'GET', null, T)).data.some((x) => x.id === 're_budget'), 'a field with data stays');
  assert.ok((await api('/pipelines', 'GET', null, T)).data.some((x) => x.id === rp.id), 'a pipeline with a contact stays');
  // and the real estate style, picked again, shows that same pipeline and field
  const again = (await api('/crm/kit', 'POST', { id: 'realestate' }, T)).data.current;
  assert.deepEqual([again.pipelineId, again.valueField], [rp.id, 're_budget']);
});

test('a manufacturer account from before its pipeline was renamed keeps its own "Orders" pipeline; a D2C store doesn’t take it', async () => {
  const T = (await register(api)).token;
  const mf = KITS.find((x) => x.id === 'manufacturer');
  const old = (await api('/pipelines', 'POST', { name: 'Orders', stages: mf.pipeline.stages }, T)).data;
  const cur = (await api('/crm/kit', 'POST', { id: 'manufacturer' }, T)).data.current;
  assert.equal(cur.pipelineId, old.id, 'its own stages found under the old name');
  const st = (await api('/crm/kit', 'POST', { id: 'store' }, T)).data.current;
  assert.notEqual(st.pipelineId, old.id, 'a store’s “Orders” has other stages');
  const p = (await api('/pipelines', 'GET', null, T)).data.find((x) => x.id === st.pipelineId);
  assert.ok(p.stages.some((s) => s.name === 'COD to confirm'));
});
