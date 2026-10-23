// Bot protection: Turnstile keys saved in Admin (the secret checked with Cloudflare) guard sign-up; funnel forms
// drop submissions sent faster than a person could type. Pop-up analytics: shown / sign-ups per pop-up.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { startServer, register, enable2fa } from './helpers.mjs';

let fake, srv, api, ADMIN, T;
before(async () => {
  // a stand-in for Cloudflare's siteverify: secret 'good-secret' is real; token 'human' passes
  fake = http.createServer((req, res) => {
    let b = '';
    req.on('data', (c) => { b += c; });
    req.on('end', () => {
      const p = new URLSearchParams(b);
      res.setHeader('content-type', 'application/json');
      if (p.get('secret') !== 'good-secret') return res.end(JSON.stringify({ success: false, 'error-codes': ['invalid-input-secret'] }));
      res.end(JSON.stringify(p.get('response') === 'human' ? { success: true } : { success: false, 'error-codes': ['invalid-input-response'] }));
    });
  }).listen(0);
  await new Promise((r) => setTimeout(r, 30));
  srv = await startServer({ TURNSTILE_VERIFY_URL: `http://127.0.0.1:${fake.address().port}/siteverify`, ADMIN_EMAILS: 'owner@bots.test' });
  api = srv.api;
  ADMIN = (await register(api, 'owner@bots.test')).token;
  const link = srv.log().match(/To: owner@bots\.test[\s\S]*?\/verify\?token=([a-f0-9.]+)/);
  await api('/auth/verify', 'POST', { token: link[1] });
  ADMIN = (await enable2fa(api, ADMIN)).token;
  T = (await register(api)).token;
});
after(async () => { await srv?.stop(); fake?.close(); });

test('Turnstile keys from Admin: a wrong secret is refused; once on, sign-up needs the human check', async () => {
  const put = (captcha) => api('/admin/settings', 'PUT', { captcha }, ADMIN);
  assert.equal((await put({ siteKey: 'nope', secret: 'good-secret' })).status, 400);
  assert.match((await put({ siteKey: '0x4AAAAAAAtestkey', secret: 'bad-secret' })).data.error, /didn’t accept/);
  const ok = await put({ siteKey: '0x4AAAAAAAtestkey', secret: 'good-secret' });
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  assert.deepEqual([ok.data.captcha.ready, ok.data.captcha.hasSecret], [true, true]);
  assert.ok(!JSON.stringify(ok.data).includes('good-secret'), 'the secret is never sent back');
  assert.equal((await api('/site')).data.turnstileSiteKey, '0x4AAAAAAAtestkey');
  const signup = (extra) => api('/auth/register', 'POST', { name: 'New', email: `n${Math.random().toString(36).slice(2)}@example.in`, password: 'Long-enough-pass-9', legal: true, ...extra });
  assert.equal((await signup({})).status, 400, 'no human check');
  assert.equal((await signup({ turnstile: 'robot' })).status, 400);
  assert.equal((await signup({ turnstile: 'human' })).status, 200);
  assert.equal((await put({ clear: true })).data.captcha.ready, false);
  assert.equal((await signup({})).status, 200, 'off again');
});

test('funnel forms: sent within a second is dropped quietly; pop-up shown / sign-up counts reach analytics', async () => {
  const f = (await api('/templates/yoga/use', 'POST', {}, T)).data;
  const steps = structuredClone(f.steps);
  steps[0].popups = [{ id: 'pop1', name: 'Exit offer', trigger: { type: 'exit' }, blocks: [{ id: 'ob', type: 'optin', props: { title: 'Wait!' } }] }];
  await api(`/funnels/${f.id}`, 'PUT', { steps, published: true }, T);
  const lead = (email, t) => api(`/public/${f.slug}/lead`, 'POST', { stepId: steps[0].id, email, name: 'X', t, popupId: 'pop1' });
  assert.equal((await lead('bot@example.in', 300)).status, 200, 'the bot is told it worked');
  assert.equal((await lead('person@example.in', 6000)).status, 200);
  const leads = (await api(`/funnels/${f.id}/analytics`, 'GET', null, T)).data.leads.map((l) => l.email);
  assert.ok(leads.includes('person@example.in') && !leads.includes('bot@example.in'), JSON.stringify(leads));

  const ev = (type, visitor) => api(`/public/${f.slug}/event`, 'POST', { stepId: steps[0].id, type, popupId: 'pop1', visitor });
  for (const v of ['a', 'b', 'c', 'd']) await ev('popup_view', v);
  await ev('popup_convert', 'a');
  const pop = (await api(`/funnels/${f.id}/analytics`, 'GET', null, T)).data.steps[0].popups[0];
  assert.deepEqual([pop.name, pop.trigger, pop.views, pop.visitors, pop.signups, pop.rate], ['Exit offer', 'exit', 4, 4, 1, 25]);
});
