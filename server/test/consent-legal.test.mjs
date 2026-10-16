// India compliance: marketing broadcasts only to opted-in contacts, consent on by default, abandoned checkouts
// only after the notice was shown, the seller's legal details before publishing, and the platform's own
// company + grievance details on its policy pages.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer, register, enable2fa } from './helpers.mjs';

const k = (key) => encodeURIComponent(key);
let srv, api, T, f, co;
before(async () => {
  srv = await startServer({ ADMIN_EMAILS: 'owner@platform.test' });
  api = srv.api;
  T = (await register(api)).token; // with legal details (see helpers.mjs)
  f = (await api('/templates/yoga/use', 'POST', {}, T)).data;
  assert.equal((await api(`/funnels/${f.id}`, 'PUT', { published: true }, T)).status, 200);
  co = f.steps.find((s) => s.type === 'checkout');
});
after(() => srv.stop());

test('a new account has the consent banner and tick box on', async () => {
  const fresh = (await register(api, undefined, { legal: false })).token;
  const p = (await api('/privacy', 'GET', null, fresh)).data;
  assert.equal(p.banner, true);
  assert.equal(p.checkbox, true);
  assert.equal(p.originDefault, 'India');
  assert.deepEqual(p.missing, ['business legal name', 'business address (city and state at least)', 'contact email', 'grievance officer name']);
});

test('broadcasts reach opted-in leads, not buyers without opt-in; the seller can mark or import opt-in', async () => {
  await api(`/public/${f.slug}/lead`, 'POST', { stepId: f.steps[0].id, email: 'yes@example.com', name: 'Agreed', consent: true });
  await api(`/public/${f.slug}/lead`, 'POST', { stepId: f.steps[0].id, email: 'quiet@example.com', name: 'No consent recorded' });
  const o = await api(`/public/${f.slug}/order`, 'POST', { stepId: co.id, email: 'buyer@example.com', name: 'Buyer' });
  assert.equal(o.status, 200, JSON.stringify(o.data));
  const aud = async () => (await api('/broadcasts/audience', 'POST', { channel: 'email', segment: {} }, T)).data;
  let a = await aud();
  assert.equal(a.reach, 1);
  assert.deepEqual(a.sample.map((c) => c.email), ['yes@example.com']);
  assert.equal(a.left.notOptedIn, 2, 'the buyer and the lead without consent');
  assert.equal((await api('/broadcasts/audience', 'POST', { channel: 'email', segment: { type: 'customers' } }, T)).data.reach, 0, 'buying isn’t agreeing to marketing');

  // the seller records consent by hand, and on import with the tick
  await api(`/contacts/${k('quiet@example.com')}`, 'PATCH', { optIn: true }, T);
  await api('/contacts/import', 'POST', { rows: [{ email: 'csv-yes@example.com' }], consent: true }, T);
  await api('/contacts/import', 'POST', { rows: [{ email: 'csv-no@example.com' }] }, T);
  a = await aud();
  assert.equal(a.reach, 3);
  assert.equal(a.left.notOptedIn, 2, 'the buyer and the import without the tick');
  assert.equal((await api(`/contacts/${k('csv-yes@example.com')}`, 'GET', null, T)).data.optIn, true);
  // withdrawn: left out again
  await api(`/contacts/${k('yes@example.com')}`, 'PATCH', { optIn: false }, T);
  assert.equal((await aud()).reach, 2);
});

test('an abandoned checkout is kept only when the notice was shown and consent wasn’t refused', async () => {
  const carts = async () => (await api('/orders', 'GET', null, T)).data.abandoned.filter((x) => x.email.startsWith('cart'));
  await api(`/public/${f.slug}/abandon`, 'POST', { stepId: co.id, email: 'cart1@example.com', name: 'No notice' });
  await api(`/public/${f.slug}/abandon`, 'POST', { notice: true, consent: false, stepId: co.id, email: 'cart2@example.com' });
  assert.equal((await carts()).length, 0);
  await api(`/public/${f.slug}/abandon`, 'POST', { notice: true, stepId: co.id, email: 'cart3@example.com', name: 'Shown' });
  const c = await carts();
  assert.equal(c.length, 1);
  assert.equal(c[0].email, 'cart3@example.com');
  assert.ok(c[0].noticeAt > 0);
  // erasure removes the cart
  await api(`/contacts/${k('cart3@example.com')}`, 'DELETE', null, T);
  assert.equal((await carts()).length, 0);
});

test('publishing needs the seller’s legal details; a funnel’s own details count; live funnels stay live', async () => {
  const S = (await register(api, undefined, { legal: false })).token;
  const g = (await api('/templates/yoga/use', 'POST', {}, S)).data;
  const bad = await api(`/funnels/${g.id}`, 'PUT', { published: true }, S);
  assert.equal(bad.status, 400);
  assert.match(bad.data.error, /Settings → Business & legal/);
  assert.ok(bad.data.missing.includes('grievance officer name'));
  assert.equal((await api(`/funnels/${g.id}/legal-check`, 'GET', null, S)).data.missing.length, 4);
  // a city alone isn't enough of an address
  await api('/privacy', 'PUT', { grievanceName: 'Ritu Sharma', grievanceEmail: 'privacy@ritu.in', address: 'Mumbai' }, S);
  assert.deepEqual((await api(`/funnels/${g.id}/legal-check`, 'GET', null, S)).data.missing, ['business legal name', 'business address (city and state at least)']);
  // the funnel's own legal details fill the rest
  await api(`/funnels/${g.id}/legal`, 'PUT', { businessName: 'Ritu Yoga LLP', address: 'Bandra, Mumbai, Maharashtra' }, S);
  assert.equal((await api(`/funnels/${g.id}`, 'PUT', { published: true }, S)).status, 200);
  // details removed later: the live funnel keeps saving, and the check reports what's missing
  await api(`/funnels/${g.id}/legal`, 'PUT', {}, S);
  assert.equal((await api(`/funnels/${g.id}`, 'PUT', { published: true, name: 'Still live' }, S)).status, 200);
  assert.equal((await api(`/funnels/${g.id}/legal-check`, 'GET', null, S)).data.missing.length, 2);
  // the seller's pages show the grievance officer with response times
  const me = (await api('/me', 'GET', null, S)).data;
  const html = await (await fetch(`${srv.base}/legal/${me.id}/privacy`)).text();
  assert.match(html, /Ritu Sharma/);
  assert.match(html, /within 48 hours/);
});

test('the platform’s policy pages: company and grievance details, never a placeholder email', async () => {
  let A = (await register(api, 'owner@platform.test')).token;
  await new Promise((r) => setTimeout(r, 150));
  const link = srv.log().match(/To: owner@platform\.test[\s\S]*?\/verify\?token=([a-f0-9.]+)/);
  await api('/auth/verify', 'POST', { token: link[1] });
  A = (await enable2fa(api, A)).token; // the admin panel needs 2-step login
  const r0 = await api('/admin/settings', 'GET', null, A);
  assert.equal(r0.status, 200, JSON.stringify(r0.data));
  const before = r0.data;
  assert.ok(before.companyMissing.includes('Grievance officer name'), 'the admin panel warns');
  assert.equal((await api('/site')).data.company.email, '', 'blank, not a made-up address');
  assert.equal((await api('/admin/settings', 'PUT', { company: { grievanceEmail: 'not-an-email' } }, A)).status, 400);
  const s = (await api('/admin/settings', 'PUT', { company: { name: 'Hive Labs Pvt Ltd', cin: 'U72900MH2026PTC123456', address: 'Baner, Pune', state: 'Maharashtra', phone: '+91 98000 00000', supportEmail: 'support@hivelabs.in', grievanceName: 'Asha Iyer', grievanceEmail: 'grievance@hivelabs.in', grievancePhone: '+91 98000 00001' } }, A)).data;
  assert.deepEqual(s.companyMissing, []);
  const c = (await api('/site')).data.company;
  assert.deepEqual([c.name, c.cin, c.email, c.grievance.name, c.grievance.email, c.grievance.phone], ['Hive Labs Pvt Ltd', 'U72900MH2026PTC123456', 'support@hivelabs.in', 'Asha Iyer', 'grievance@hivelabs.in', '+91 98000 00001']);
  // the pages themselves (client/src/pages/Legal.jsx)
  const src = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../../client/src/pages/Legal.jsx'), 'utf8');
  assert.doesNotMatch(src, /your-domain/);
  for (const h of ['Grievance redressal', 'within 24 hours and resolve it within 15 days', 'Reporting unlawful content', 'Data breaches', 'Children', 'Sub-processors', 'off-site backups for 90 days', 'Data Processor']) assert.ok(src.includes(h), h);
});
