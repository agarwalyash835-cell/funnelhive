// Page storage: one funnel stays under 2 MB, and funnel content plus restore points count towards the seller's
// storage (Plan & billing → Usage). Saves that don't grow a funnel always go through.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, register, enable2fa } from './helpers.mjs';

let srv, api, ADMIN, T;
before(async () => {
  srv = await startServer({ ADMIN_EMAILS: 'owner@pages.test' });
  api = srv.api;
  ADMIN = (await register(api, 'owner@pages.test')).token;
  const link = srv.log().match(/To: owner@pages\.test[\s\S]*?\/verify\?token=([a-f0-9.]+)/);
  await api('/auth/verify', 'POST', { token: link[1] });
  ADMIN = (await enable2fa(api, ADMIN)).token;
  T = (await register(api)).token;
});
after(() => srv?.stop());

const filler = (kb) => 'x'.repeat(kb * 1024);
const withText = (steps, kb) => { const s = structuredClone(steps); s[0].blocks.push({ id: 'big', type: 'text', props: { text: filler(kb) } }); return s; };

test('a funnel over 2 MB is refused; usage shows pages', async () => {
  const f = (await api('/templates/yoga/use', 'POST', {}, T)).data;
  const big = await api(`/funnels/${f.id}`, 'PUT', { steps: withText(f.steps, 2100) }, T);
  assert.equal(big.status, 413, JSON.stringify(big.data));
  assert.equal(big.data.limit, 'funnelSize');
  const u = (await api('/usage', 'GET', null, T)).data;
  assert.ok(u.usage.pagesMB >= 0 && u.limits.storageMB > 0, JSON.stringify(u));
  assert.equal(u.usage.funnels, 1);
});

test('growing past the storage limit is refused; shrinking still saves', async () => {
  assert.equal((await api('/admin/settings', 'PUT', { limits: { storageMBTrial: 1 } }, ADMIN)).status, 200);
  const f = (await api('/funnels', 'POST', { name: 'Big one' }, T)).data;
  const base = (await api(`/funnels/${f.id}`, 'GET', null, T)).data.steps;
  // the yoga funnel from the first test still counts; this one takes most of the 1 MB
  const first = await api(`/funnels/${f.id}`, 'PUT', { steps: withText(base, 400) }, T);
  assert.equal(first.status, 200, JSON.stringify(first.data));
  const grow = await api(`/funnels/${f.id}`, 'PUT', { steps: withText(base, 700) }, T);
  assert.equal(grow.status, 403, JSON.stringify(grow.data).slice(0, 200));
  assert.equal(grow.data.limit, 'storage');
  assert.match(grow.data.error, /1 MB of storage/);
  const shrink = await api(`/funnels/${f.id}`, 'PUT', { steps: withText(base, 100) }, T);
  assert.equal(shrink.status, 200, 'a smaller funnel always saves');
});
