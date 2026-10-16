// The dashboard's language (settings.uiLang): English by default, Hindi on request, anything else refused,
// and other settings stay as they were.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, register } from './helpers.mjs';

let srv, api, T;
before(async () => {
  srv = await startServer();
  api = srv.api;
  T = (await register(api)).token;
});
after(() => srv.stop());

test('a new account uses English', async () => {
  const me = (await api('/me', 'GET', null, T)).data;
  assert.equal(me.uiLang, 'en');
});

test('Hindi saves, shows on /me and keeps the other settings', async () => {
  await api('/settings', 'PUT', { businessName: 'Priya Classes' }, T);
  const r = await api('/settings', 'PUT', { uiLang: 'hi' }, T);
  assert.equal(r.status, 200);
  assert.equal(r.data.uiLang, 'hi');
  assert.equal(r.data.businessName, 'Priya Classes');
  const me = (await api('/me', 'GET', null, T)).data;
  assert.equal(me.uiLang, 'hi');
  assert.equal(me.settings.uiLang, 'hi');
});

test('an unknown language is refused and nothing changes', async () => {
  for (const bad of ['fr', '', 'HI', null, 1, '<script>']) {
    const r = await api('/settings', 'PUT', { uiLang: bad }, T);
    assert.equal(r.status, 400, `uiLang ${JSON.stringify(bad)}`);
  }
  assert.equal((await api('/me', 'GET', null, T)).data.uiLang, 'hi');
});

test('switching back to English works', async () => {
  const r = await api('/settings', 'PUT', { uiLang: 'en' }, T);
  assert.equal(r.status, 200);
  assert.equal((await api('/me', 'GET', null, T)).data.uiLang, 'en');
});
