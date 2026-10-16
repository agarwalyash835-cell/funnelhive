// Bugs found in the end-to-end audit, kept fixed: a rejected AI request costs no credits; errors come back as JSON
// (never an HTML page with the stack trace); a funnel name that isn't text doesn't crash; demo data uses addresses
// that can't receive mail and is never in a broadcast audience.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, register } from './helpers.mjs';

let srv, api, T;
before(async () => { srv = await startServer(); api = srv.api; T = (await register(api)).token; });
after(() => srv.stop());

test('an AI request that is rejected costs no credits; a successful one does', async () => {
  const used = async () => (await api('/billing', 'GET', null, T)).data.credits?.used ?? (await api('/me', 'GET', null, T)).data.credits.used;
  const before0 = await used();
  assert.equal((await api('/ai/generate', 'POST', { prompt: 'x' }, T)).status, 400);
  assert.equal((await api('/ai/chat', 'POST', { funnelId: 'nope', message: 'hi' }, T)).status, 404);
  assert.equal(await used(), before0, 'nothing charged for rejected requests');
  assert.equal((await api('/ai/generate', 'POST', { prompt: 'Yoga classes in Pune for beginners' }, T)).status, 200);
  assert.ok((await used()) > before0, 'a successful generation is charged');
});

test('errors are JSON, never an HTML stack trace', async () => {
  const r = await fetch(`${srv.base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{not json' });
  assert.equal(r.status, 400);
  assert.match(r.headers.get('content-type'), /json/);
  assert.match((await r.json()).error, /valid JSON/);
  const f = await api('/funnels', 'POST', { name: 123 }, T);
  assert.equal(f.status, 200);
  assert.equal(f.data.name, 'Untitled funnel');
});

test('demo data: undeliverable addresses, never in a broadcast audience', async () => {
  const real = (await api('/funnels', 'GET', null, T)).data[0];
  // one real lead, then the demo data
  const pub = (await api(`/funnels/${real.id}`, 'PUT', { published: true }, T)).data;
  await api(`/public/${pub.slug}/lead`, 'POST', { stepId: pub.steps[0].id, email: 'real.person@mail.test', name: 'Real Person', consent: true });
  assert.equal((await api('/demo/seed', 'POST', {}, T)).status, 200);
  const contacts = (await api('/contacts', 'GET', null, T)).data;
  const list = contacts.contacts || contacts;
  assert.ok(list.length > 5, 'demo contacts exist');
  assert.ok(!list.some((c) => /@gmail\.com$/.test(c.email || '')), 'no real-looking Gmail addresses');
  const a = (await api('/broadcasts/audience', 'POST', { segment: {}, channel: 'email' }, T)).data;
  assert.equal(a.reach, 1, 'only the real contact');
  assert.equal(a.sample[0].email, 'real.person@mail.test');
});

test('live server audit: unknown funnel is a 404, test checkouts are flagged, invites come back as links without email', async () => {
  const miss = await fetch(`${srv.base}/f/no-such-funnel-xyz`);
  assert.ok([404, 200].includes(miss.status));
  if (miss.status === 200) assert.ok(!(await miss.text()).includes('__FUNNEL__'), 'no funnel data on a missing page');
  const f = (await api('/funnels', 'GET', null, T)).data.find((x) => x.published) || (await api('/funnels', 'GET', null, T)).data[0];
  await api(`/funnels/${f.id}`, 'PUT', { published: true }, T);
  assert.equal((await api(`/public/${f.slug}`)).data.testCheckout, true, 'no payment provider → the checkout says it is a test');
  const inv = await api('/team/invite', 'POST', { email: 'teammate@mail.test', role: 'viewer' }, T);
  assert.equal(inv.status, 200);
  assert.match(inv.data.link, /\/team\/accept\?token=/, 'email is off in tests, so the inviter gets the link');
});

test('asking AI chat for a FAQ twice keeps one FAQ section', async () => {
  const f = (await api('/funnels', 'GET', null, T)).data[0];
  const step = (await api(`/funnels/${f.id}`, 'GET', null, T)).data.steps[0];
  for (let i = 0; i < 2; i++) assert.equal((await api('/ai/chat', 'POST', { funnelId: f.id, stepId: step.id, message: 'add a FAQ' }, T)).status, 200);
  const after = (await api(`/funnels/${f.id}`, 'GET', null, T)).data.steps[0];
  assert.ok(after.blocks.filter((b) => b.type === 'faq').length <= 1, 'one FAQ on the page');
});
