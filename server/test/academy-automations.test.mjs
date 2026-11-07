// Academy automations: "a student finishes a lesson" (once per lesson, course filter), "reaches X% of a course" (once
// per mark, only the chosen mark) and "hasn't opened their course in N days" (from a timed scan: once per quiet spell,
// again after they come back, never once access ended).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, register } from './helpers.mjs';

let srv, api, T, handle, yoga, flow;
const k = (key) => encodeURIComponent(key);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 6000) => { const end = Date.now() + ms; for (;;) { const v = await fn(); if (v || Date.now() > end) return v; await sleep(60); } };
const L = (path, method = 'GET', body, tok) => fetch(`${srv.base}/api/learn/${handle}${path}`, { method, headers: { 'x-student': tok || '', 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }).then(async (r) => ({ status: r.status, data: await r.json().catch(() => ({})) }));
const course = async (name, n) => {
  const p = (await api('/products', 'POST', { name }, T)).data;
  return (await api(`/products/${p.id}`, 'PUT', { lessons: Array.from({ length: n }, (_, i) => ({ title: `${name} ${i + 1}`, section: 'A', body: 'Read this.' })) }, T)).data;
};
const grant = async (p, email, name) => (await api(`/products/${p.id}/grant`, 'POST', { email, name, notify: false }, T)).data.access;
const signIn = async (email) => {
  const c = await L('/code', 'POST', { email });
  assert.equal(c.status, 200, JSON.stringify(c.data));
  return (await L('/login', 'POST', { email, code: c.data.code })).data.token;
};
const accessOf = async (tok, p) => (await L('/home', 'GET', null, tok)).data.courses.find((x) => x.productId === p.id);
const done = (tok, c, i, on = true) => L('/progress', 'POST', { accessId: c.accessId, lessonId: c.lessons[i].id, done: on }, tok);
const make = async (a) => {
  const c = (await api('/automations', 'POST', a, T)).data;
  const on = await api(`/automations/${c.id}`, 'PUT', { active: true }, T);
  assert.equal(on.status, 200, JSON.stringify(on.data));
  return c;
};
const started = async (id) => (await api('/automations', 'GET', null, T)).data.automations.find((a) => a.id === id).stats?.started || 0;
const timeline = async (email) => JSON.stringify((await api(`/contacts/${k(email)}`, 'GET', null, T)).data.timeline || []);

before(async () => {
  // 1 day × 0.00002 ≈ 1.7 s of test time
  srv = await startServer({ AUTOMATION_TICK_MS: '50', AUTOMATION_TIME_SCALE: '0.00002' });
  api = srv.api;
  T = (await register(api)).token;
  yoga = await course('Yoga', 4);
  flow = await course('Flow', 2);
  handle = (await api('/school', 'GET', null, T)).data.handle;
});
after(() => srv?.stop());

test('a lesson is finished: once per lesson, only for the chosen course, with {{lesson}} and {{product}}', async () => {
  const any = await make({ name: 'Any lesson', trigger: { type: 'lesson_completed' }, steps: [{ type: 'note', text: 'Lesson done: {{lesson}}' }], allowRepeat: true });
  const onlyFlow = await make({ name: 'Flow lesson', trigger: { type: 'lesson_completed', productId: flow.id }, steps: [{ type: 'note', text: 'Flow lesson: {{product}}' }], allowRepeat: true });
  await grant(yoga, 'asha@x.in', 'Asha Verma');
  const tok = await signIn('asha@x.in');
  const c = await accessOf(tok, yoga);
  assert.equal((await done(tok, c, 0)).status, 200);
  assert.ok(await until(async () => /Lesson done: Yoga 1/.test(await timeline('asha@x.in'))), 'the note step ran');
  // unticked and ticked again: no second run
  await done(tok, c, 0, false);
  await done(tok, c, 0);
  await sleep(300);
  assert.equal(await started(any.id), 1);
  assert.equal(await started(onlyFlow.id), 0, 'another course doesn’t start the Flow one');
  await done(tok, c, 1);
  assert.ok(await until(async () => (await started(any.id)) === 2), 'the next lesson runs it again');
  assert.equal(await started(onlyFlow.id), 0);
});

test('reaches X% of a course: once per student, course and mark, only the chosen mark and course', async () => {
  const half = await make({ name: 'Halfway', trigger: { type: 'course_progress', percent: 50 }, steps: [{ type: 'note', text: 'Reached {{percent}} of {{product}}' }], allowRepeat: true });
  const flow75 = await make({ name: 'Flow 75', trigger: { type: 'course_progress', percent: 75, productId: flow.id }, steps: [{ type: 'note', text: 'Flow 75' }], allowRepeat: true });
  assert.equal((await api(`/automations/${half.id}`, 'GET', null, T)).data.trigger.percent, 50);
  const odd = (await api('/automations', 'POST', { name: 'Odd', trigger: { type: 'course_progress', percent: 33 }, steps: [] }, T)).data;
  assert.equal(odd.trigger.percent, 50, 'only 25 / 50 / 75 / 90');
  await grant(yoga, 'ravi@x.in', 'Ravi');
  const tok = await signIn('ravi@x.in');
  const c = await accessOf(tok, yoga);
  await done(tok, c, 0); // 25%
  await sleep(300);
  assert.equal(await started(half.id), 0, '25% isn’t halfway');
  await done(tok, c, 1); // 50%
  assert.ok(await until(async () => /Reached 50% of Yoga/.test(await timeline('ravi@x.in'))), 'fired at 50% with {{percent}}');
  await done(tok, c, 1, false);
  await done(tok, c, 1);
  await done(tok, c, 2); // 75%
  await sleep(300);
  assert.equal(await started(half.id), 1, 'once per mark, even when progress drops and comes back');
  assert.equal(await started(flow75.id), 0, 'Yoga at 75% doesn’t start the Flow one');
  // Flow: 1 of 2 lessons = 50%, then 100% crosses 75
  await grant(flow, 'ravi@x.in', 'Ravi');
  const f = await accessOf(tok, flow);
  await done(tok, f, 0);
  assert.ok(await until(async () => (await started(half.id)) === 2), 'halfway through another course counts again');
  await done(tok, f, 1);
  assert.ok(await until(async () => /Flow 75/.test(await timeline('ravi@x.in'))), 'a jump past the mark fires it');
  assert.equal(await started(flow75.id), 1);
});

test('hasn’t opened their course in N days: once per quiet spell, again after coming back, never when access ended', async () => {
  // a fresh course so earlier students don't count
  const reels = await course('Reels', 3);
  const quiet = await make({ name: 'Quiet', trigger: { type: 'student_inactive', days: 1, productId: reels.id }, steps: [{ type: 'note', text: 'Missed you for {{days}} days in {{product}}' }], allowRepeat: true });
  const other = await make({ name: 'Quiet Flow', trigger: { type: 'student_inactive', days: 1, productId: flow.id }, steps: [{ type: 'note', text: 'Flow quiet' }], allowRepeat: true });
  assert.equal((await api('/automations', 'POST', { name: 'Clamp', trigger: { type: 'student_inactive', days: 400 }, steps: [] }, T)).data.trigger.days, 90);
  await grant(reels, 'meera@x.in', 'Meera');
  const gone = await grant(reels, 'gone@x.in', 'Gone');
  assert.equal((await api(`/access-admin/${gone.id}/revoke`, 'POST', {}, T)).status, 200);
  const tok = await signIn('meera@x.in');
  const c = await accessOf(tok, reels);
  await done(tok, c, 0);
  await sleep(800);
  assert.equal(await started(quiet.id), 0, 'still active inside the window');
  assert.ok(await until(async () => /Missed you for 1 days in Reels/.test(await timeline('meera@x.in')), 8000), 'fired once quiet for a day');
  await sleep(2500); // well past another “day”
  assert.equal(await started(quiet.id), 1, 'once per quiet spell');
  // they come back: a new spell
  await done(tok, c, 1);
  assert.ok(await until(async () => (await started(quiet.id)) === 2, 8000), 'fires again after they came back and went quiet');
  const runs = (await api(`/automations/${quiet.id}`, 'GET', null, T)).data.runs || [];
  assert.ok(runs.every((r) => r.email === 'meera@x.in'), 'never for a student whose access was revoked');
  assert.equal(await started(other.id), 0, 'the Flow one only watches Flow students');
});
