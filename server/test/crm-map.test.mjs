// Answers into the CRM's own fields: a funnel form's questions fill the industry fields they name (or the one the
// seller picked), amounts in lakh / crore are understood, dropdowns take only their own options, a quiz's result goes
// where the seller pointed it, "not a fit" applicants are tagged, where the lead came from fills "Enquiry from", and
// a portal / lead-form enquiry fills the same fields. A blank answer never clears a field.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, register } from './helpers.mjs';
import { amount, answersToCustom, sourceToCustom } from '../crm-map.js';

let srv, api, T;
before(async () => {
  srv = await startServer();
  api = srv.api;
  T = (await register(api)).token;
  assert.equal((await api('/crm/kit', 'POST', { id: 'realestate' }, T)).status, 200);
});
after(() => srv?.stop());

const DEFS = [
  { id: 're_budget', label: 'Budget (₹)', type: 'money' },
  { id: 're_bhk', label: 'BHK', type: 'select', options: '1 RK, 1 BHK, 2 BHK, 3 BHK, 4 BHK, 5+ BHK' },
  { id: 're_location', label: 'Preferred location', type: 'text' },
  { id: 're_from', label: 'Enquiry from', type: 'select', options: '99acres, MagicBricks, Facebook ads, Google ads, Walk-in, Website' },
];

test('matching: names, Indian amounts, dropdown options, links, sources', () => {
  assert.deepEqual([amount('80 lakh'), amount('1.2 cr'), amount('₹50,000'), amount('50k'), amount('50-60 lakh'), amount('soon')], [8000000, 12000000, 50000, 50000, 5000000, null]);
  assert.deepEqual(answersToCustom(DEFS, { 'What is your budget?': '80 lakh', BHK: '3 bhk', City: 'Pune', Name: 'Asha' }), { re_budget: 8000000, re_bhk: '3 BHK', re_location: 'Pune' });
  assert.deepEqual(answersToCustom(DEFS, { BHK: 'a big house' }), {}, 'a dropdown takes only one of its options');
  assert.deepEqual(answersToCustom(DEFS, { 'Your requirement': '2 BHK' }, { 'Your requirement': 're_bhk' }), { re_bhk: '2 BHK' }, 'the seller’s link wins over wording');
  assert.deepEqual(sourceToCustom(DEFS, 'facebook'), { re_from: 'Facebook ads' });
  assert.deepEqual(sourceToCustom(DEFS, 'direct'), { re_from: 'Website' });
});

test('a funnel form and quiz fill the CRM fields; not-a-fit is tagged; a blank answer clears nothing', async () => {
  const f = (await api('/templates/q-coach/use', 'POST', {}, T)).data;
  const step = f.steps[0];
  const quiz = step.blocks.find((b) => b.type === 'quiz');
  quiz.props.crmField = 're_project';
  step.blocks.push({ id: 'apply1', type: 'form', props: { fields: [
    { label: 'Your requirement', type: 'select', options: '2 BHK, 3 BHK', crmField: 're_bhk' },
    { label: 'Ready to buy in 6 months?', type: 'select', options: 'Yes, No', reject: 'No' },
  ] } });
  const saved = await api(`/funnels/${f.id}`, 'PUT', { steps: f.steps, published: true }, T);
  assert.equal(saved.status, 200, JSON.stringify(saved.data).slice(0, 200));
  const send = (email, fields, extra = {}) => api(`/public/${f.slug}/lead`, 'POST', { stepId: step.id, t: 5000, email, name: 'Asha', fields, ...extra });

  const picks = quiz.props.questions.map(() => 0);
  const r = await send('asha@x.in', { Budget: '80 lakh', City: 'Pune', 'Your requirement': '3 BHK', 'Ready to buy in 6 months?': 'Yes' }, { quiz: { blockId: quiz.id, picks }, attr: { utm_source: 'facebook' } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const c = (await api('/contacts/asha%40x.in', 'GET', null, T)).data;
  const custom = c.custom || c.meta?.custom;
  assert.equal(custom.re_budget, 8000000);
  assert.equal(custom.re_bhk, '3 BHK', 'the linked question');
  assert.equal(custom.re_location, 'Pune', '“City” fills “Preferred location”');
  assert.equal(custom.re_project, r.data.quiz.title, 'the quiz result goes where the seller pointed it');
  assert.equal(custom.re_from, 'Facebook ads', 'where they came from');

  // the same person again: a blank answer leaves the budget; where they first came from stays
  await send('asha@x.in', { Budget: '', City: 'Mumbai', 'Ready to buy in 6 months?': 'Yes' }, { attr: { utm_source: 'google' } });
  const c2 = (await api('/contacts/asha%40x.in', 'GET', null, T)).data;
  const k2 = c2.custom || c2.meta?.custom;
  assert.deepEqual([k2.re_budget, k2.re_location, k2.re_from], [8000000, 'Mumbai', 'Facebook ads']);

  await send('ravi@x.in', { 'Ready to buy in 6 months?': 'No' });
  const ravi = (await api('/contacts/ravi%40x.in', 'GET', null, T)).data;
  assert.ok((ravi.tags || ravi.meta?.tags || []).includes('not a fit'), 'a not-a-fit applicant is tagged');
});

test('a lead-form enquiry (Google Ads) fills the same fields', async () => {
  const ls = (await api('/lead-sources', 'GET', null, T)).data;
  const g = ls.google;
  assert.ok(g?.url && g?.key, 'the seller’s Google lead-form address and key');
  const r = await fetch(srv.base + new URL(g.url).pathname, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ google_key: g.key, lead_id: 'g1', user_column_data: [{ column_id: 'FULL_NAME', string_value: 'Meena K' }, { column_id: 'PHONE_NUMBER', string_value: '+91 98765 43210' }, { column_id: 'CITY', string_value: 'Nagpur' }, { column_id: 'BUDGET', string_value: '1.2 crore' }] }) });
  assert.equal(r.status, 200, await r.text());
  const list = (await api('/contacts', 'GET', null, T)).data;
  const meena = list.find((x) => x.name === 'Meena K');
  assert.ok(meena, 'the enquiry is a contact');
  const c = (await api(`/contacts/${encodeURIComponent(meena.key)}`, 'GET', null, T)).data;
  const custom = c.custom || c.meta?.custom;
  assert.deepEqual([custom.re_location, custom.re_budget, custom.re_from], ['Nagpur', 12000000, 'Google ads']);
});

test('an account that tried other industries: the current industry’s fields win (live case: City, Enquiry from)', async () => {
  const T2 = (await register(api)).token;
  for (const id of ['distributor', 'manufacturer', 'realestate']) assert.equal((await api('/crm/kit', 'POST', { id }, T2)).status, 200);
  const ids = (await api('/crm/fields', 'GET', null, T2)).data.map((x) => x.id);
  assert.ok(ids.includes('mf_city') && ids.includes('ds_from'), 'the old industries’ fields are still there');
  const f = (await api('/templates/q-coach/use', 'POST', {}, T2)).data;
  await api(`/funnels/${f.id}`, 'PUT', { published: true }, T2);
  const r = await api(`/public/${f.slug}/lead`, 'POST', { stepId: f.steps[0].id, t: 5000, email: 'neha@x.in', fields: { City: 'Pune', Budget: '80 lakh' }, attr: { utm_source: 'facebook' } });
  assert.equal(r.status, 200);
  const c = (await api('/contacts/neha%40x.in', 'GET', null, T2)).data;
  const custom = c.custom || c.meta?.custom;
  assert.equal(custom.re_location, 'Pune', 'City → the real estate “Preferred location”, not the old manufacturer “City”');
  assert.equal(custom.mf_city, undefined);
  assert.equal(custom.re_from, 'Facebook ads', 'the current industry’s “Enquiry from”');
  assert.equal(custom.re_budget, 8000000);
});
