// Quiz funnels: the quiz template, scoring on the server (by result votes and by points), answers on the lead,
// tags and a timeline note on the CRM contact, the “finishes a quiz” automation with {{quiz_result}}, and the
// quiz report (started → each question → finished, and the split of results).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, register } from './helpers.mjs';

let srv, api, T;
const until = async (fn, ms = 5000) => { const end = Date.now() + ms; for (;;) { const v = await fn(); if (v || Date.now() > end) return v; await new Promise((r) => setTimeout(r, 60)); } };
before(async () => {
  srv = await startServer({ AUTOMATION_TICK_MS: '50', AUTOMATION_TIME_SCALE: '0.001' });
  api = srv.api;
  T = (await register(api)).token;
});
after(() => srv?.stop());

test('a quiz funnel: the result is scored on the server, the answers and tags reach the CRM, automations follow up per result', async () => {
  const f = (await api('/templates/q-coach/use', 'POST', {}, T)).data;
  assert.ok(f.id, JSON.stringify(f));
  await api(`/funnels/${f.id}`, 'PUT', { published: true }, T);
  const step = f.steps[0];
  const quiz = step.blocks.find((b) => b.type === 'quiz');
  assert.ok(quiz?.id, 'the template has a quiz block');
  assert.equal(quiz.props.questions.length, 5);

  const a = (await api('/automations', 'POST', { name: '1:1 follow-up', trigger: { type: 'quiz', outcome: 'The 1:1 Coaching Path' }, steps: [{ type: 'note', text: 'Quiz said {{quiz_result}}' }] }, T)).data;
  assert.equal((await api(`/automations/${a.id}`, 'PUT', { active: true }, T)).status, 200);

  const ev = (type, visitor, question) => api(`/public/${f.slug}/event`, 'POST', { stepId: step.id, type, blockId: quiz.id, question, visitor });
  for (const v of ['v1', 'v2', 'v3']) await ev('quiz_start', v);
  for (const v of ['v1', 'v2', 'v3']) await ev('quiz_answer', v, 0);
  for (const v of ['v1', 'v2']) for (const n of [1, 2, 3, 4]) await ev('quiz_answer', v, n);
  assert.equal((await ev('quiz_answer', 'v9', 99)).status, 200, 'a bad question number is ignored');

  const send = (body) => api(`/public/${f.slug}/lead`, 'POST', { stepId: step.id, t: 5000, ...body });
  assert.equal((await send({ email: 'x@example.in', quiz: { blockId: 'nope', picks: [] } })).status, 400, 'a quiz that isn’t on the page');
  // mostly the third answer → the 1:1 path; the budget answer adds high-budget
  const r = (await send({ email: 'meera@example.in', phone: '9876543210', name: 'Meera Shah', visitor: 'v1', quiz: { blockId: quiz.id, picks: [[2], [2], [1], [2], [2]] } })).data;
  assert.equal(r.quiz.title, 'The 1:1 Coaching Path');
  assert.equal(r.quiz.buttonText, 'Book my free call');
  assert.ok(!('outcomes' in r.quiz) && !('questions' in r.quiz), 'only the visitor’s own result is sent back');
  // a browser that claims another result can't: the server scores the answers
  const r2 = (await send({ email: 'ravi@example.in', name: 'Ravi', visitor: 'v2', quiz: { blockId: quiz.id, picks: [[0], [0], [0], [7, 1], 'x'], outcome: 2 } })).data;
  assert.equal(r2.quiz.title, 'The Self-Starter Path');

  const c = (await api(`/contacts/${encodeURIComponent('meera@example.in')}`, 'GET', null, T)).data;
  assert.ok(c.tags.includes('quiz-1on1') && c.tags.includes('high-budget'), JSON.stringify(c.tags));
  assert.match(JSON.stringify(c.timeline), /Quiz result: The 1:1 Coaching Path/);
  const lead = (await api(`/funnels/${f.id}/analytics`, 'GET', null, T)).data.leads.find((l) => l.email === 'meera@example.in');
  assert.equal(lead.quiz.outcome, 'The 1:1 Coaching Path');
  assert.equal(lead.fields['What would you invest to solve this in the next 90 days?'], '₹30,000+');

  // only the matching result started the automation, with the result in its message
  assert.ok(await until(async () => /Quiz said The 1:1 Coaching Path/.test(JSON.stringify((await api(`/contacts/${encodeURIComponent('meera@example.in')}`, 'GET', null, T)).data.timeline))));
  const runs = (await api(`/automations/${a.id}`, 'GET', null, T)).data.runs || [];
  assert.deepEqual(runs.map((x) => x.email), ['meera@example.in']);

  const qz = (await api(`/funnels/${f.id}/analytics`, 'GET', null, T)).data.steps[0].quizzes[0];
  assert.equal(qz.started, 3);
  assert.deepEqual(qz.questions.map((x) => x.answered), [3, 2, 2, 2, 2]);
  assert.equal(qz.finished, 2);
  assert.deepEqual(qz.outcomes.map((o) => o.n), [1, 0, 1]);
});

test('points scoring: the total picks the result by its “from” score', async () => {
  const f = (await api('/templates/q-fitness/use', 'POST', {}, T)).data;
  const steps = structuredClone(f.steps);
  const qb = steps[0].blocks.find((b) => b.type === 'quiz');
  qb.props.scoring = 'points';
  qb.props.questions = [{ q: 'Sleep?', answers: [{ text: '<6h', points: 0 }, { text: '7–8h', points: 5 }] }, { q: 'Steps?', answers: [{ text: '<3k', points: 0 }, { text: '10k+', points: 5 }] }];
  qb.props.outcomes = [{ title: 'Low', min: 0 }, { title: 'High', min: 8 }, { title: 'Mid', min: 4 }];
  await api(`/funnels/${f.id}`, 'PUT', { steps, published: true }, T);
  const send = (picks, email) => api(`/public/${f.slug}/lead`, 'POST', { stepId: steps[0].id, t: 5000, email, quiz: { blockId: qb.id, picks } });
  assert.equal((await send([[0], [0]], 'a@ex.in')).data.quiz.title, 'Low');
  assert.equal((await send([[1], [0]], 'b@ex.in')).data.quiz.title, 'Mid');
  assert.equal((await send([[1], [1]], 'c@ex.in')).data.quiz.title, 'High');
});
