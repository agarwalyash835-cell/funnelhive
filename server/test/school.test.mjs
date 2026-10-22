// The school (members area): students sign in with an emailed code, take courses (progress, resume, quizzes whose
// answers never reach the browser, certificates, questions under lessons), and use the community (spaces only the
// right buyers see, posts, comments, likes → points, leaderboard). Device limits, removing a student, the AI tutor
// (against a fake AI) and erasing a contact.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { startServer, register } from './helpers.mjs';

let fake, srv, api, T, handle, course, other, H;
const asks = [];
before(async () => {
  fake = http.createServer((req, res) => {
    let b = '';
    req.on('data', (c) => { b += c; });
    req.on('end', () => {
      const body = JSON.parse(b || '{}');
      asks.push(body);
      const sys = String(body.instructions || '');
      const text = /online courses/.test(sys) ? JSON.stringify({ name: 'Instagram Reels for Coaches', description: 'Grow with short videos', lessons: [{ section: 'Basics', title: 'Your first Reel', body: 'Hook in 2 seconds. Then one idea.' }, { section: 'Basics', title: 'Posting rhythm', body: 'Three a week beats one a day you can’t keep.', quiz: { pass: 60, questions: [{ q: 'How fast is the hook?', options: ['2 s', '20 s'], answer: 0, explain: 'Fast.' }] } }] })
        : /multiple-choice quizzes/.test(sys) ? JSON.stringify({ questions: [{ q: 'Q1?', options: ['a', 'b', 'c'], answer: 2, explain: 'c' }, { q: 'Q2?', options: ['x', 'y'], answer: 0 }] })
        : 'Breathe in for 4 counts, hold for 4, out for 6 — that’s lesson 2.';
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ output: [{ type: 'message', content: [{ type: 'output_text', text }] }] }));
    });
  }).listen(0);
  await new Promise((r) => setTimeout(r, 30));
  srv = await startServer({ KIE_API_KEY: 'kie-test', KIE_BASE_URL: `http://127.0.0.1:${fake.address().port}`, DOMAINS_FAKE_DNS: '1' });
  api = srv.api;
  T = (await register(api)).token;
  course = (await api('/products', 'POST', { name: 'Yoga Foundations' }, T)).data;
  const lessons = [
    { title: 'Welcome', section: 'Start', body: 'How this course works.' },
    { title: 'Breathing', section: 'Start', body: 'Box breathing: in 4, hold 4, out 6.', quiz: { pass: 50, questions: [{ q: 'Breathe out for how long?', options: ['2 counts', '6 counts'], answer: 1, explain: 'Out for 6.' }, { q: 'Hold for?', options: ['4', '10'], answer: 0 }] } },
  ];
  course = (await api(`/products/${course.id}`, 'PUT', { lessons, certificate: { enabled: true, title: 'Certified Yoga Foundations', signer: 'Ananya Rao' } }, T)).data;
  other = (await api('/products', 'POST', { name: 'Advanced Flow', lessons: [] }, T)).data;
  handle = (await api('/school', 'GET', null, T)).data.handle;
  H = (tok) => ({ 'x-student': tok, 'content-type': 'application/json' });
});
after(async () => { await srv.stop(); fake.close(); });
const L = (path, method = 'GET', body, tok) => fetch(`${srv.base}/api/learn/${handle}${path}`, { method, headers: H(tok || ''), body: body ? JSON.stringify(body) : undefined }).then(async (r) => ({ status: r.status, data: await r.json().catch(() => ({})) }));
const signIn = async (email) => {
  const c = await L('/code', 'POST', { email });
  assert.equal(c.status, 200, JSON.stringify(c.data));
  const s = await L('/login', 'POST', { email, code: c.data.code });
  assert.equal(s.status, 200, JSON.stringify(s.data));
  return s.data.token;
};
let asha;

test('sign in: buyers get a code by email; strangers only when the school is open to all; wrong codes refused', async () => {
  await api(`/products/${course.id}/grant`, 'POST', { email: 'asha@x.in', name: 'Asha Verma', notify: false }, T);
  assert.equal((await L('')).data.school.name.length > 0, true);
  assert.equal((await L('/code', 'POST', { email: 'stranger@x.in' })).status, 404, 'not a buyer');
  const c = await L('/code', 'POST', { email: 'Asha@X.in' });
  assert.equal((await L('/login', 'POST', { email: 'asha@x.in', code: '000000' })).status, 400);
  const ok = await L('/login', 'POST', { email: 'asha@x.in', code: c.data.code });
  assert.equal(ok.data.me.name, 'Asha Verma', 'name from the purchase');
  assert.equal((await L('/login', 'POST', { email: 'asha@x.in', code: c.data.code })).status, 400, 'a code works once');
  asha = ok.data.token;
  assert.equal((await L('/home', 'GET', null, 'S' + '0'.repeat(48))).status, 401);
  await api('/school/settings', 'PUT', { openJoin: true, name: 'Ananya’s Yoga School' }, T);
  assert.equal((await L('/code', 'POST', { email: 'stranger@x.in' })).status, 200, 'open school: anyone can join');
});

test('a course: progress and resume, quiz answers stay on the server, certificate when finished', async () => {
  const home = (await L('/home', 'GET', null, asha)).data;
  const c = home.courses.find((x) => x.productId === course.id);
  assert.equal(c.lessons.length, 2);
  const q = c.lessons[1].quiz;
  assert.equal(q.questions.length, 2);
  assert.ok(q.questions.every((x) => !('answer' in x) && !('explain' in x)), 'no answers sent to the browser');
  const p1 = await L('/progress', 'POST', { accessId: c.accessId, lessonId: c.lessons[0].id, done: true, t: 95 }, asha);
  assert.equal(p1.data.complete, false);
  let again = (await L('/home', 'GET', null, asha)).data.courses.find((x) => x.productId === course.id);
  assert.deepEqual([again.resume.lessonId, again.resume.t], [c.lessons[0].id, 95], 'resume where you left off');
  assert.equal((await L('/certificate/' + course.id, 'GET', null, asha)).status, 400, 'not finished yet');
  const fail = (await L('/quiz', 'POST', { accessId: c.accessId, lessonId: c.lessons[1].id, answers: [0, 1] }, asha)).data;
  assert.deepEqual([fail.score, fail.passed], [0, false]);
  assert.equal(fail.results[0].answer, 1, 'the right answers come back after an attempt');
  const pass = (await L('/quiz', 'POST', { accessId: c.accessId, lessonId: c.lessons[1].id, answers: [1, 0] }, asha)).data;
  assert.deepEqual([pass.score, pass.passed], [100, true]);
  assert.equal(pass.cert.title, 'Certified Yoga Foundations', 'finishing the course issues the certificate');
  assert.equal(pass.cert.name, 'Asha Verma');
  // anyone can check it's genuine by its number
  const pub = await (await fetch(`${srv.base}/api/cert/${pass.cert.id}`)).json();
  assert.deepEqual([pub.name, pub.course], ['Asha Verma', 'Yoga Foundations']);
  assert.equal((await fetch(`${srv.base}/api/cert/0000000000000000`)).status, 404);
  const me = (await L('', 'GET', null, asha)).data.me;
  assert.equal(me.points, 1 + 2 + 10, 'lesson + quiz + course');
});

test('questions under a lesson: the seller answers as the school and the student is told', async () => {
  const c = (await L('/home', 'GET', null, asha)).data.courses.find((x) => x.productId === course.id);
  const lid = c.lessons[1].id;
  const qn = await L(`/lesson/${course.id}/${lid}/comments`, 'POST', { body: 'Can I do this lying down?' }, asha);
  assert.equal(qn.status, 200);
  const list = (await api('/school/questions', 'GET', null, T)).data;
  assert.equal(list[0].lesson, 'Breathing');
  assert.equal(list[0].answered, false);
  await api(`/school/questions/${list[0].id}/answer`, 'POST', { body: 'Yes — lying down is perfect.' }, T);
  const thread = (await L(`/lesson/${course.id}/${lid}/comments`, 'GET', null, asha)).data;
  assert.equal(thread[1].author.kind, 'owner');
  assert.equal(thread[1].author.badge, 'Admin');
  const notes = (await L('/notifications', 'GET', null, asha)).data;
  assert.match(notes[0].text, /answered your question/);
  assert.equal((await L(`/lesson/${other.id}/x/comments`, 'GET', null, asha)).status, 404, 'not their course');
});

test('community: spaces only the right buyers see, posts, comments, likes earn points, leaderboard', async () => {
  const general = (await api('/school/spaces', 'POST', { name: 'General', emoji: '👋', access: 'open' }, T)).data;
  const vip = (await api('/school/spaces', 'POST', { name: 'Advanced lounge', access: 'products', productIds: [other.id] }, T)).data;
  const news = (await api('/school/spaces', 'POST', { name: 'Announcements', access: 'buyers', postBy: 'admins' }, T)).data;
  const ravi = await signIn('ravi@x.in'); // joined the open school, bought nothing
  const sees = async (tok) => (await L('/home', 'GET', null, tok)).data.spaces.map((s) => s.name).sort();
  assert.deepEqual(await sees(asha), ['Announcements', 'General']);
  assert.deepEqual(await sees(ravi), ['General']);
  assert.equal((await L(`/spaces/${vip.id}/posts`, 'GET', null, asha)).status, 404, 'a paid space stays hidden');
  assert.equal((await L(`/spaces/${news.id}/posts`, 'POST', { body: 'hi' }, asha)).status, 403, 'announcements: the team posts');
  await api(`/school/spaces/${news.id}/posts`, 'POST', { title: 'Live class Sunday', body: '7 pm on Zoom', pinned: true }, T);
  const post = (await L(`/spaces/${general.id}/posts`, 'POST', { title: 'Day 1 done!', body: 'Loved the breathing lesson' }, ravi)).data;
  const before = (await L('', 'GET', null, ravi)).data.me.points;
  await L('/like', 'POST', { target: `post:${post.id}` }, asha);
  await L('/like', 'POST', { target: `post:${post.id}` }, asha); // twice is still one like
  await L('/like', 'POST', { target: `post:${post.id}` }, ravi); // your own like earns nothing
  assert.equal((await L('', 'GET', null, ravi)).data.me.points, before + 1);
  const cm = (await L(`/posts/${post.id}/comments`, 'POST', { body: 'Well done!' }, asha)).data;
  assert.equal(cm.author.name, 'Asha Verma');
  const full = (await L(`/posts/${post.id}`, 'GET', null, ravi)).data;
  assert.deepEqual([full.post.likes, full.post.comments, full.comments.length], [2, 1, 1]);
  assert.match((await L('/notifications', 'GET', null, ravi)).data[0].text, /commented on your post/);
  const feed = (await L(`/spaces/${news.id}/posts`, 'GET', null, asha)).data;
  assert.equal(feed.posts[0].pinned, true);
  assert.equal(feed.posts[0].author.kind, 'owner');
  const lb = (await L('/leaderboard?days=30', 'GET', null, ravi)).data;
  assert.equal(lb.top[0].name, 'Asha Verma');
  assert.ok(lb.top.some((x) => x.name.startsWith('ravi')));
  // the seller hides a post: gone for students
  await api(`/school/posts/${post.id}`, 'PUT', { hidden: true }, T);
  assert.equal((await L(`/posts/${post.id}`, 'GET', null, ravi)).status, 404);
});

test('devices: past the limit the oldest is signed out; a removed student is locked out', async () => {
  await api('/school/settings', 'PUT', { deviceLimit: 2 }, T);
  const a = await signIn('meera@x.in'), b = await signIn('meera@x.in'), c = await signIn('meera@x.in');
  assert.equal((await L('/home', 'GET', null, a)).status, 401, 'third device signs out the first');
  assert.equal((await L('/home', 'GET', null, c)).status, 200);
  const st = (await api('/school/students', 'GET', null, T)).data.find((s) => s.email === 'meera@x.in');
  assert.equal(st.devices, 2);
  await api(`/school/students/${st.id}`, 'PUT', { banned: true }, T);
  assert.equal((await L('/home', 'GET', null, b)).status, 401);
  assert.equal((await L('/code', 'POST', { email: 'meera@x.in' })).status, 200);
  const code = (await L('/code', 'POST', { email: 'meera@x.in' })).data.code;
  assert.equal((await L('/login', 'POST', { email: 'meera@x.in', code })).status, 403);
});

test('AI tutor: answers from the course (seller’s credits), only for students of that course', async () => {
  const r = await L('/tutor', 'POST', { productId: course.id, question: 'How long do I breathe out?' }, asha);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.match(r.data.answer, /out for 6/);
  assert.match(JSON.stringify(asks.at(-1)), /Box breathing/, 'the course material went to the AI');
  const ravi = await signIn('ravi@x.in');
  assert.equal((await L('/tutor', 'POST', { productId: course.id, question: 'hi there' }, ravi)).status, 404, 'not their course');
});

test('erasing a contact removes their student profile and signs them out', async () => {
  const tok = await signIn('asha@x.in');
  await api(`/contacts/${encodeURIComponent('asha@x.in')}`, 'DELETE', null, T);
  assert.equal((await L('/home', 'GET', null, tok)).status, 401);
  assert.ok(!(await api('/school/students', 'GET', null, T)).data.some((s) => s.email === 'asha@x.in'));
});

test('AI: a whole course from a topic, a quiz from a lesson, and Hive building a course and a space', async () => {
  const c = await api('/ai/course', 'POST', { topic: 'Instagram Reels for coaches', lessons: 8 }, T);
  assert.equal(c.status, 200, JSON.stringify(c.data));
  assert.equal(c.data.lessons?.length, 2, JSON.stringify(c.data).slice(0, 300));
  assert.equal(c.data.lessons[1].quiz.questions[0].answer, 0);
  const qz = await api('/ai/quiz', 'POST', { title: 'Breathing', text: 'Box breathing: in for 4, hold for 4, out for 6. Do it twice a day for calm.' }, T);
  assert.equal(qz.data.questions?.length, 2, JSON.stringify(qz));
  assert.equal(qz.data.questions[0].answer, 2);
  assert.equal((await api('/ai/quiz', 'POST', { text: 'short' }, T)).status, 400);
  const tok = (await api('/hive/tokens', 'POST', { name: 't' }, T)).data.token;
  const call = async (name, args) => { const r = await (await fetch(`${srv.base}/mcp`, { method: 'POST', headers: { authorization: `Bearer ${tok}`,'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) })).json(); return r.result.isError ? { error: r.result.content[0].text } : JSON.parse(r.result.content[0].text); };
  const made = await call('create_course', { topic: 'Reels for coaches', certificate: true });
  assert.deepEqual([made.lessons, made.quizzes], [2, 1], JSON.stringify(made));
  const got = await call('get_course', { productId: made.id });
  assert.equal(got.certificate, true);
  assert.match((await call('add_quiz', { productId: made.id, lessonId: got.lessons[0].id })).error, /Write the lesson first/, 'too little text to quiz on');
  const added = await call('add_quiz', { productId: made.id, lessonId: got.lessons[1].id });
  assert.equal(added.questions, 2);
  const sp = await call('create_space', { name: 'Wins', emoji: '🏆', access: 'open' });
  assert.equal(sp.access, 'open');
  const ov = await call('school_overview', {});
  assert.ok(ov.url.endsWith(`/learn/${handle}`));
  assert.ok(ov.spaces.some((x) => x.name === 'Wins') && ov.courses.some((x) => x.id === made.id));
});

test('level gates: a bonus lesson and an inner-circle space open only once the student reaches the level', async () => {
  const prod = (await api('/products', 'POST', { name: 'Gated course' }, T)).data;
  await api(`/products/${prod.id}`, 'PUT', { lessons: [{ title: 'Open lesson', body: 'Hi' }, { title: 'Bonus', body: 'Secret stuff', minLevel: 2 }] }, T);
  await api(`/products/${prod.id}/grant`, 'POST', { email: 'gate@x.in', name: 'Gita', notify: false }, T);
  const inner = (await api('/school/spaces', 'POST', { name: 'Inner circle', access: 'buyers', minLevel: 2 }, T)).data;
  assert.equal(inner.minLevel, 2);
  const tok = await signIn('gate@x.in');
  let c = (await L('/home', 'GET', null, tok)).data.courses.find((x) => x.productId === prod.id);
  const bonus = c.lessons[1];
  assert.deepEqual([bonus.locked, bonus.needLevel, bonus.body], [true, 2, undefined], 'title only, no content');
  assert.equal((await L('/progress', 'POST', { accessId: c.accessId, lessonId: bonus.id, done: true }, tok)).status, 403);
  const sp = (await L('/home', 'GET', null, tok)).data.spaces.find((x) => x.id === inner.id);
  assert.equal(sp.locked, true, 'shown locked, not hidden');
  const locked = await L(`/spaces/${inner.id}/posts`, 'GET', null, tok);
  assert.equal(locked.status, 403);
  assert.match(locked.data.error, /level 2/);
  // finish the open lesson (1 point) and get likes until level 2 (5 points)
  await L('/progress', 'POST', { accessId: c.accessId, lessonId: c.lessons[0].id, done: true }, tok);
  const general = (await api('/school', 'GET', null, T)).data.spaces.find((x) => x.access === 'open');
  const post = (await L(`/spaces/${general.id}/posts`, 'POST', { body: 'Hello!' }, tok)).data;
  for (const e of ['l1@x.in', 'l2@x.in', 'l3@x.in', 'l4@x.in']) { const t = await signIn(e); await L('/like', 'POST', { target: `post:${post.id}` }, t); }
  assert.equal((await L('', 'GET', null, tok)).data.me.level, 2);
  c = (await L('/home', 'GET', null, tok)).data.courses.find((x) => x.productId === prod.id);
  assert.equal(c.lessons[1].body, 'Secret stuff', 'unlocked');
  assert.equal((await L(`/spaces/${inner.id}/posts`, 'GET', null, tok)).status, 200);
});

test('the members area also opens on the seller’s own domain', async () => {
  const http = await import('node:http');
  const get = (host, p) => new Promise((ok, no) => http.get({ host: '127.0.0.1', port: new URL(srv.base).port, path: p, headers: { host } }, (r) => { let b = ''; r.on('data', (x) => { b += x; }); r.on('end', () => ok({ status: r.statusCode, body: b })); }).on('error', no));
  const f = (await api('/templates/yoga/use', 'POST', {}, T)).data;
  await api(`/funnels/${f.id}`, 'PUT', { published: true }, T);
  const d = (await api('/domains', 'POST', { domain: 'learn.mybrand.in', funnelId: f.id }, T)).data;
  await api(`/domains/${d.id}/verify`, 'POST', {}, T);
  const page = await get('learn.mybrand.in', `/learn/${handle}`);
  assert.equal(page.status, 200);
  assert.match(page.body, /<div id="root">/, 'the app, not the funnel');
  const apiRes = await get('learn.mybrand.in', `/api/learn/${handle}`);
  assert.equal(JSON.parse(apiRes.body).school.name.length > 0, true);
  assert.ok((await api('/school', 'GET', null, T)).data.domainUrls.includes(`https://learn.mybrand.in/learn/${handle}`));
});

test('students can turn reply alerts off and on', async () => {
  const tok = await signIn('alerts@x.in');
  assert.equal((await L('', 'GET', null, tok)).data.me.alerts, true, 'on by default');
  assert.equal((await L('/me', 'PUT', { alerts: false }, tok)).data.alerts, false);
  assert.equal((await L('', 'GET', null, tok)).data.me.alerts, false);
});

test('the members area installs as an app with the school’s name, colour and icon', async () => {
  const m = await (await fetch(`${srv.base}/api/learn/${handle}/manifest.webmanifest`)).json();
  assert.equal(m.display, 'standalone');
  assert.equal(m.start_url, `/learn/${handle}`);
  assert.ok(m.name.length > 0 && m.short_name.length <= 12);
  assert.ok(m.icons.some((i) => i.purpose === 'maskable'));
  const svg = await fetch(`${srv.base}/api/learn/${handle}/icon.svg`);
  assert.match(svg.headers.get('content-type'), /svg/);
  assert.match(await svg.text(), /^<svg[\s\S]+<\/svg>$/);
});
