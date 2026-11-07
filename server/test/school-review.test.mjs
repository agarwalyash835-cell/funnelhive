// The app-review login (Google Play asks for one): the seller makes an email + password that signs in without an
// emailed code, opens every course for 30 days, stays out of the CRM, and stops working when switched off or remade.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, register } from './helpers.mjs';

let srv, api, T, handle, courses;
before(async () => {
  srv = await startServer(); api = srv.api; T = (await register(api)).token;
  courses = [];
  for (const name of ['Paisa Panchatantra', 'Yoga Foundations']) {
    const p = (await api('/products', 'POST', { name }, T)).data;
    courses.push((await api(`/products/${p.id}`, 'PUT', { lessons: [{ title: 'Welcome', section: 'Start', body: 'Hi' }] }, T)).data);
  }
  handle = (await api('/school', 'GET', null, T)).data.handle;
});
after(() => srv?.stop());
const L = (path, method = 'GET', body, tok = '') => fetch(`${srv.base}/api/learn/${handle}${path}`, { method, headers: { 'x-student': tok, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }).then(async (r) => ({ status: r.status, data: await r.json().catch(() => ({})) }));

test('a review login signs in with a password and sees every course; nothing lands in the CRM', async () => {
  assert.equal((await api('/school/review-login', 'GET', null, T)).data.review, null);
  const made = (await api('/school/review-login', 'POST', {}, T)).data;
  assert.match(made.password, /^Review-\w{4}-\w{4}-\w{4}$/);
  const days = (made.review.expiresAt - Date.now()) / 86400000;
  assert.ok(days > 29.9 && days <= 30, 'lasts 30 days');
  const { email } = made.review;
  const c = await L('/code', 'POST', { email });
  assert.equal(c.data.password, true, 'asks for the password, no code');
  assert.equal(c.data.code, undefined);
  assert.equal((await L('/login', 'POST', { email, password: 'wrong' })).status, 400);
  const s = await L('/login', 'POST', { email, password: made.password });
  assert.equal(s.status, 200, JSON.stringify(s.data));
  const home = await L('/home', 'GET', null, s.data.token);
  assert.equal(home.status, 200);
  const names = JSON.stringify(home.data);
  for (const p of courses) assert.ok(names.includes(p.name), `${p.name} is in the reviewer's library`);
  const contacts = JSON.stringify((await api('/contacts', 'GET', null, T)).data);
  assert.ok(!contacts.includes(email), 'not a CRM contact');
  // seller's view never shows the password again
  assert.equal(JSON.stringify((await api('/school/review-login', 'GET', null, T)).data).includes(made.password), false);
  globalThis.rv = { email, password: made.password, token: s.data.token };
});

test('making a new one or switching off ends the old password and its sessions', async () => {
  const { email, password, token } = globalThis.rv;
  const again = (await api('/school/review-login', 'POST', {}, T)).data;
  assert.notEqual(again.password, password);
  assert.equal((await L('/login', 'POST', { email, password })).status, 400, 'old password stops');
  assert.equal((await L('/home', 'GET', null, token)).status, 401, 'old session signed out');
  assert.equal((await L('/login', 'POST', { email, password: again.password })).status, 200);
  await api('/school/review-login', 'DELETE', null, T);
  assert.equal((await L('/login', 'POST', { email, password: again.password })).status, 400, 'switched off');
  assert.equal((await L('/code', 'POST', { email })).data.password, undefined, 'back to the normal code flow');
});
