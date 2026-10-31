// Dashboard skins (skins.js): each person picks their own; an agency sets the skin its client accounts start with;
// a person's own pick wins over the agency's; unknown skins are refused.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, register } from './helpers.mjs';

let srv, api;
before(async () => { srv = await startServer({ APP_URL: 'https://app.example.in' }); api = srv.api; });
after(() => srv?.stop());

test('a person picks a skin; unknown ones are refused; empty goes back to the default', async () => {
  const A = (await register(api)).token;
  assert.equal((await api('/me', 'GET', null, A)).data.skin, null);
  assert.equal((await api('/settings', 'PUT', { skin: 'midnight' }, A)).status, 200);
  assert.equal((await api('/me', 'GET', null, A)).data.skin, 'midnight');
  assert.equal((await api('/settings', 'PUT', { skin: 'not-a-skin' }, A)).status, 400);
  assert.equal((await api('/settings', 'PUT', { skin: '' }, A)).status, 200);
  assert.equal((await api('/me', 'GET', null, A)).data.skin, null);
});

test('an agency’s skin is the default in its client accounts; the client’s own pick wins', async () => {
  const ag = (await register(api)).token;
  assert.equal((await api('/agency/white-label', 'PUT', { brand: 'GrowthOS', skin: 'softwash' }, ag)).status, 200);
  assert.equal((await api('/agency/white-label', 'PUT', { brand: 'GrowthOS', skin: '<x>' }, ag)).data.whiteLabel.skin, '', 'unknown skins are dropped');
  assert.equal((await api('/agency/white-label', 'PUT', { brand: 'GrowthOS', skin: 'softwash' }, ag)).status, 200);
  const c = (await api('/agency/clients', 'POST', { business: 'Sharma Sweets' }, ag)).data;
  const inv = await api(`/agency/clients/${c.id}/invite`, 'POST', { email: 'owner@sharma.test' }, ag);
  const own = await api('/auth/reset', 'POST', { token: inv.data.token, password: 'secret123' });
  const ct = own.data.token || (await api('/auth/login', 'POST', { email: 'owner@sharma.test', password: 'secret123' })).data.token;
  assert.ok(ct, JSON.stringify(own.data));
  assert.equal((await api('/me', 'GET', null, ct)).data.skin, 'softwash', 'the agency’s default');
  assert.equal((await api('/settings', 'PUT', { skin: 'warm' }, ct)).status, 200);
  assert.equal((await api('/me', 'GET', null, ct)).data.skin, 'warm', 'their own pick wins');
});
