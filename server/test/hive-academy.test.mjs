// Hive in the Academy: it reads students' progress (stuck / not started / finished), their questions and community
// posts; answers and replies reach students only after the seller's Confirm; it changes Academy settings (with a
// Confirm) and edits a course's lessons — rename, module, drip, reorder; removing lessons needs a Confirm.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, register } from './helpers.mjs';

let srv, api, T, H, handle, course, asha, ravi, ctx;
const L = (path, method = 'GET', body, tok) => fetch(`${srv.base}/api/learn/${handle}${path}`, { method, headers: { 'x-student': tok || '', 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }).then(async (r) => ({ status: r.status, data: await r.json().catch(() => ({})) }));
const signIn = async (email) => { const c = await L('/code', 'POST', { email }); return (await L('/login', 'POST', { email, code: c.data.code })).data.token; };
const run = (name, args) => H.runTool(ctx, name, args);

before(async () => {
  srv = await startServer();
  api = srv.api;
  T = (await register(api)).token;
  await import('../sales.js'); // the app's own module order (hive.js alone makes a loop)
  H = await import('../hive.js');
  ctx = { origin: srv.base, call: async (method, path, body) => { const r = await api(path, method, body, T); if (r.status >= 400) throw new Error(r.data.error || `HTTP ${r.status}`); return r.data; } };
  course = (await api('/products', 'POST', { name: 'Paisa Panchatantra' }, T)).data;
  course = (await api(`/products/${course.id}`, 'PUT', { lessons: [{ title: 'Intro', body: 'Hello' }, { title: 'Budgeting', body: 'Plan' }, { title: 'Investing', body: 'Grow' }] }, T)).data;
  handle = (await api('/school', 'GET', null, T)).data.handle;
  for (const email of ['asha@x.in', 'ravi@x.in']) await api(`/products/${course.id}/grant`, 'POST', { email, notify: false }, T);
  asha = await signIn('asha@x.in');
  ravi = await signIn('ravi@x.in');
});
after(() => srv?.stop());

test('reads students’ progress: finished, not started, stuck', async () => {
  const home = (await L('/home', 'GET', null, asha)).data.courses.find((c) => c.productId === course.id);
  for (const l of course.lessons) await L('/progress', 'POST', { accessId: home.accessId, lessonId: l.id, done: true }, asha);
  const all = await run('academy_students', {});
  assert.equal(all.total, 2);
  const a = all.students.find((s) => s.email === 'asha@x.in');
  assert.equal(a.courses[0].percent, 100, JSON.stringify(a));
  assert.deepEqual((await run('academy_students', { filter: 'finished' })).students.map((s) => s.email), ['asha@x.in']);
  assert.deepEqual((await run('academy_students', { filter: 'not_started' })).students.map((s) => s.email), ['ravi@x.in']);
  assert.equal((await run('academy_students', { course: 'nonexistent course' })).total, 0, 'a course filter that matches nothing');
});

test('questions and community posts: read freely; answers and replies wait for a Confirm', async () => {
  const l = course.lessons[1];
  assert.equal((await L(`/lesson/${course.id}/${l.id}/comments`, 'POST', { body: 'How much should I save each month?' }, ravi)).status, 200);
  const qs = await run('academy_questions', {});
  assert.equal(qs.total, 1);
  assert.deepEqual([qs.questions[0].lesson, qs.questions[0].question], ['Budgeting', 'How much should I save each month?']);
  assert.ok(H.needsOk('answer_question', { questionId: qs.questions[0].id, answer: 'Start with 20%' }), 'answering waits for the seller');
  await run('answer_question', { questionId: qs.questions[0].id, answer: 'Start with 20% of what you earn.' });
  assert.equal((await run('academy_questions', {})).total, 0, 'answered questions drop off the list');

  const sp = (await api('/school/spaces', 'POST', { name: 'Wins' }, T)).data;
  const post = await L(`/spaces/${sp.id}/posts`, 'POST', { title: 'Saved my first ₹1,000!', body: 'Thanks to lesson 2' }, asha);
  assert.equal(post.status, 200, JSON.stringify(post.data));
  const posts = await run('academy_posts', {});
  assert.ok(posts.posts.some((p) => p.title === 'Saved my first ₹1,000!'));
  assert.ok(H.needsOk('reply_to_post', { postId: post.data.id, text: 'Congratulations!' }));
  await run('reply_to_post', { postId: post.data.id, text: 'Congratulations, Asha!' });
  const thread = (await api(`/school/posts/${post.data.id}`, 'GET', null, T)).data;
  assert.ok(thread.comments.some((c) => c.body === 'Congratulations, Asha!'));
});

test('Academy settings change only with a Confirm', async () => {
  assert.match(H.needsOk('academy_settings', { watermark: 'strong', appOnly: true }), /watermark → strong/);
  const r = await run('academy_settings', { watermark: 'strong', noDownloads: true, appOnly: true });
  assert.deepEqual([r.settings.watermark, r.settings.noDownloads, r.settings.appOnly], ['strong', true, true]);
  await run('academy_settings', { watermark: 'subtle', noDownloads: false, appOnly: false });
});

test('edit a course: rename, modules, drip, reorder; removing lessons needs a Confirm; unknown ids are refused', async () => {
  const [a, b, c] = course.lessons.map((l) => l.id);
  assert.equal(H.needsOk('edit_course', { productId: course.id, lessons: [{ id: a, title: 'Welcome' }] }), null, 'plain edits just happen');
  const r = await run('edit_course', { productId: course.id, name: 'Paisa Panchatantra 2.0', lessons: [{ id: a, title: 'Welcome', section: 'Start here' }, { id: c, dripDays: 7, minLevel: 2 }], order: [c, a, b] });
  assert.equal(r.name, 'Paisa Panchatantra 2.0');
  assert.deepEqual(r.lessons.map((l) => l.id), [c, a, b]);
  assert.deepEqual([r.lessons[1].title, r.lessons[1].section, r.lessons[0].dripDays, r.lessons[0].minLevel], ['Welcome', 'Start here', 7, 2]);
  const full = (await api(`/products/${course.id}`, 'GET', null, T)).data;
  assert.equal(full.lessons.find((l) => l.id === b).body, 'Plan', 'lesson text stays');
  assert.match(H.needsOk('edit_course', { productId: course.id, remove: [b] }), /DELETE 1 lesson/);
  await assert.rejects(run('edit_course', { productId: course.id, lessons: [{ id: 'nope1234', title: 'x' }] }), /Unknown lesson id/);
});

test('the Academy tools come with the school group, and the Academy Manager is a ready-made teammate', async () => {
  for (const n of ['academy_students', 'academy_questions', 'answer_question', 'academy_settings', 'edit_course']) assert.ok(H.TOOL_GROUPS.school.tools.includes(n), n);
  assert.ok(H.startGroups('which students are stuck in my course?').has('school'));
  const TM = await import('../hive-team.js');
  const am = TM.PRESETS.find((p) => p.preset === 'academy');
  assert.ok(am && am.groups.includes('school') && am.askFirst && am.schedule.on);
});
