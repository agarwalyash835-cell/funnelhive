// Automation coverage of the rest of the platform: course access (give / remove), starting another automation, timeline
// notes, "a client opens a quote", and "a student signs in to the members area for the first time".
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, register } from './helpers.mjs';

let srv, api, T, course, handle;
const until = async (fn, ms = 5000) => { const end = Date.now() + ms; for (;;) { const v = await fn(); if (v || Date.now() > end) return v; await new Promise((r) => setTimeout(r, 60)); } };
before(async () => {
  srv = await startServer({ AUTOMATION_TICK_MS: '50', AUTOMATION_TIME_SCALE: '0.001', APP_URL: 'https://app.example.in' });
  api = srv.api;
  T = (await register(api)).token;
  course = (await api('/products', 'POST', { name: 'Reels Mastery', lessons: [{ section: 'Start', title: 'Hooks', body: 'Hook in two seconds.' }] }, T)).data;
  handle = (await api('/school', 'GET', null, T)).data.handle;
});
after(() => srv?.stop());

const make = async (a) => {
  const c = (await api('/automations', 'POST', a, T)).data;
  const on = await api(`/automations/${c.id}`, 'PUT', { active: true }, T);
  assert.equal(on.status, 200, JSON.stringify(on.data));
  return c;
};
const timeline = async (key) => JSON.stringify((await api(`/contacts/${encodeURIComponent(key)}`, 'GET', null, T)).data.timeline || []);

test('give course access, start another automation and add a note; then remove access', async () => {
  const onboarding = await make({ name: 'Onboarding', trigger: { type: 'manual' }, steps: [{ type: 'tag', tag: 'onboarding', action: 'add' }] });
  assert.equal((await api('/automations', 'POST', { name: 'Bad', trigger: { type: 'tag', tag: 'x' }, steps: [{ type: 'access', productId: 'nope' }] }, T)).status, 200);
  const bad = (await api('/automations', 'GET', null, T)).data.automations.find((a) => a.name === 'Bad');
  assert.match((await api(`/automations/${bad.id}`, 'PUT', { active: true }, T)).data.error, /choose the product/i);
  await make({
    name: 'Buyer setup', trigger: { type: 'tag', tag: 'vip' },
    steps: [{ type: 'access', productId: course.id, action: 'grant', notify: false }, { type: 'enroll', automationId: onboarding.id }, { type: 'note', text: 'VIP {{first_name}} got the course' }],
  });
  await api('/contacts', 'POST', { email: 'asha@example.in', name: 'Asha Rao' }, T);
  await api(`/contacts/${encodeURIComponent('asha@example.in')}`, 'PATCH', { tags: ['vip'] }, T);
  const got = await until(async () => (await api(`/products/${course.id}/buyers`, 'GET', null, T)).data?.buyers?.some?.((b) => b.email === 'asha@example.in') || (await timeline('asha@example.in')).includes('VIP Asha got the course'));
  assert.ok(got, 'the course was given and the note written');
  assert.ok(await until(async () => (await api(`/contacts/${encodeURIComponent('asha@example.in')}`, 'GET', null, T)).data.tags.includes('onboarding')), 'the other automation ran');
  assert.match(await timeline('asha@example.in'), /Access to Reels Mastery given/);
  await make({ name: 'Remove', trigger: { type: 'tag', tag: 'refund-ok' }, steps: [{ type: 'access', productId: course.id, action: 'revoke' }] });
  await api(`/contacts/${encodeURIComponent('asha@example.in')}`, 'PATCH', { tags: ['vip', 'refund-ok'] }, T);
  assert.ok(await until(async () => /Access to Reels Mastery removed/.test(await timeline('asha@example.in'))));
});

test('a client opening a quote and a student’s first sign-in start automations', async () => {
  const qa = await make({ name: 'Quote opened', trigger: { type: 'quote_viewed' }, steps: [{ type: 'tag', tag: 'quote-opened', action: 'add' }] });
  const sa = await make({ name: 'Welcome student', trigger: { type: 'student_joined' }, steps: [{ type: 'tag', tag: 'student', action: 'add' }] });
  const q = (await api('/quotes', 'POST', { client: { name: 'Meera Rao', email: 'meera@client.in' }, title: 'Brand sprint', items: [{ name: 'Workshop', qty: 1, price: 25000 }], currency: 'INR' }, T)).data;
  await api(`/q/${q.id}?t=${new URL(q.link).searchParams.get('t')}`);
  // (a quote client becomes a CRM contact once they pay, so the run itself is checked)
  assert.ok(await until(async () => (await api(`/automations/${qa.id}`, 'GET', null, T)).data.runs?.some((r) => r.email === 'meera@client.in' && r.status === 'done')), 'quote opened');

  await api(`/products/${course.id}/grant`, 'POST', { email: 'ravi@example.in', name: 'Ravi', notify: false }, T);
  const L = async (p, body) => (await fetch(`${srv.base}/api/learn/${handle}${p}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).json();
  const { code } = await L('/code', { email: 'ravi@example.in' });
  assert.ok((await L('/login', { email: 'ravi@example.in', code })).token);
  assert.ok(await until(async () => (await api(`/automations/${sa.id}`, 'GET', null, T)).data.runs?.some((r) => r.email === 'ravi@example.in')), 'first sign-in');
  await L('/login', { email: 'ravi@example.in', code: (await L('/code', { email: 'ravi@example.in' })).code });
  await new Promise((r) => setTimeout(r, 300));
  assert.equal((await api(`/automations/${sa.id}`, 'GET', null, T)).data.stats.started, 1, 'only the first sign-in');
});
