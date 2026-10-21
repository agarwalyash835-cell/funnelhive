// Hive AI tools for what sellers used to do only by hand: split tests, tracking pixels, their own domain, team
// invites, webhooks to other tools, copying a funnel — called over MCP like any AI client would.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, register } from './helpers.mjs';

let srv, api, T, tok, f;
const call = async (name, args, token = tok) => {
  const r = await (await fetch(`${srv.base}/mcp`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) })).json();
  const text = r.result?.content?.[0]?.text || '';
  if (r.result?.isError) return { error: text };
  try { return JSON.parse(text); } catch { return { text }; }
};
before(async () => {
  srv = await startServer({ APP_URL: 'https://app.example.in', SERVER_IP: '203.0.113.7', DOMAINS_FAKE_DNS: '1' });
  api = srv.api;
  T = (await register(api)).token;
  tok = (await api('/hive/tokens', 'POST', { name: 'test' }, T)).data.token;
  f = (await api('/templates/coding/use', 'POST', {}, T)).data;
});
after(() => srv.stop());

test('split test: start with a new headline for B, see results, keep the winner', async () => {
  const step = f.steps[0], hero = step.blocks.find((b) => b.type === 'hero');
  const r = await call('split_test', { funnelId: f.id, stepId: step.id, action: 'start', split: 40, changes: [{ sectionId: hero.id, props: { headline: 'Variant B headline' } }] });
  assert.equal(r.split, 40, JSON.stringify(r));
  assert.equal(r.changed, 1);
  let s = (await api(`/funnels/${f.id}`, 'GET', null, T)).data.steps[0];
  assert.equal(s.ab.enabled, true);
  assert.equal(s.ab.blocks.find((b) => b.type === 'hero').props.headline, 'Variant B headline');
  assert.notEqual(s.blocks.find((b) => b.type === 'hero').props.headline, 'Variant B headline', 'variant A unchanged');
  assert.match((await call('split_test', { funnelId: f.id, stepId: step.id, action: 'edit', changes: [{ sectionId: 'nope', props: {} }] })).error, /section ids/);
  const res = await call('split_test', { funnelId: f.id, stepId: step.id, action: 'results' });
  assert.equal(res.running, true);
  assert.ok(res.A && res.B);
  await call('split_test', { funnelId: f.id, stepId: step.id, action: 'pick', winner: 'B' });
  s = (await api(`/funnels/${f.id}`, 'GET', null, T)).data.steps[0];
  assert.equal(s.blocks.find((b) => b.type === 'hero').props.headline, 'Variant B headline', 'B became the page');
  assert.equal(s.ab.enabled, false);
  assert.ok(s.blocks.every((b) => !('from' in b)));
});

test('tracking: account-wide ids, a funnel’s own pixel, bad ids refused', async () => {
  const a = await call('set_tracking', { fbPixel: '123456789012345', ga4: 'G-ABC1234' });
  assert.deepEqual([a.scope, a.tracking.fbPixel, a.tracking.ga4], ['account', '123456789012345', 'G-ABC1234']);
  assert.match((await call('set_tracking', { fbPixel: 'pixel-abc' })).error, /Pixel ID/);
  const fn = await call('set_tracking', { funnelId: f.id, fbPixel: '999999999999' });
  assert.deepEqual([fn.scope, fn.tracking.fbPixel], ['funnel', '999999999999']);
  const g = await call('set_tracking', { googleAdsId: 'AW-123456789', purchaseLabel: 'AbC-D_efG12' });
  assert.equal(g.tracking.googleAds, 'AW-123456789');
  assert.equal((await api('/settings', 'GET', null, T)).data.tracking.fbPixel, '123456789012345', 'the earlier pixel is kept');
});

test('own domain: DNS records to add, then a status check', async () => {
  const d = await call('connect_domain', { domain: 'offer.mybrand.in', funnelId: f.id });
  assert.equal(d.domain, 'offer.mybrand.in', JSON.stringify(d));
  assert.ok(d.records.some((r) => r.type === 'CNAME' && r.value === 'app.example.in'));
  assert.ok(d.records.some((r) => r.type === 'TXT'));
  assert.match((await call('connect_domain', { domain: 'app.example.in', funnelId: f.id })).error, /own address/);
  const list = await call('check_domain', {});
  assert.equal(list[0].domain, 'offer.mybrand.in');
  const c = await call('check_domain', { domainId: d.domainId });
  assert.equal(c.status, 'active', 'records found: live');
  assert.equal(c.live, 'https://offer.mybrand.in');
});

test('team, webhooks and copies', async () => {
  const inv = await call('invite_team_member', { email: 'va@x.in', role: 'marketer' });
  assert.equal(inv.role, 'marketer', JSON.stringify(inv));
  assert.ok((await call('list_team', {})).members.some((m) => m.email === 'va@x.in'));
  assert.match((await call('invite_team_member', { email: 'b@x.in', role: 'god' })).error, /role/);
  const w = await call('connect_webhook', { url: 'https://hooks.example.com/abc' });
  assert.equal(w.url, 'https://hooks.example.com/abc');
  assert.equal((await call('connect_webhook', { url: '' })).url, '');
  const copy = await call('duplicate_funnel', { funnelId: f.id });
  assert.match(copy.name, /\(copy\)$/);
  assert.notEqual(copy.id, f.id);
});

test('websites: a template with four linked pages, the menu rendered by the server, and Hive building one', async () => {
  const sites = (await api('/templates')).data.filter((t) => t.type === 'website');
  assert.ok(sites.length >= 3);
  const site = (await api(`/templates/${sites[0].id}/use`, 'POST', {}, T)).data;
  assert.deepEqual(site.steps.map((s) => s.slug), ['home', 'about', 'services', 'contact']);
  assert.ok(site.steps.every((s) => s.blocks[0].type === 'navbar' && s.blocks.at(-1).type === 'footer'), 'menu first, footer last on every page');
  const body = JSON.stringify(site);
  assert.doesNotMatch(body, /10,000\+|joined today|Rated 4\.9/, 'no made-up proof');
  // the server-rendered menu links each page and marks the current one
  const pv = encodeURIComponent((await api(`/funnels/${site.id}`, 'GET', null, T)).data.previewKey);
  const html = await (await fetch(`${srv.base}/f/${site.slug}/about?preview=1&pv=${pv}`)).text();
  const nav = html.match(/<nav class="nav-links"[\s\S]*?<\/nav>/)[0];
  for (const href of [`/f/${site.slug}"`, `/f/${site.slug}/about"`, `/f/${site.slug}/services"`, `/f/${site.slug}/contact"`]) assert.ok(nav.includes(`href="${href}`), href);
  assert.match(nav, /class=" on" aria-current="page" href="\/f\/[^/]+\/about"/);
  // on the seller's own domain the pages live at /about, /contact…
  const pub = await api(`/funnels/${site.id}`, 'PUT', { published: true }, T);
  assert.equal(pub.status, 200, JSON.stringify(pub.data));
  const dom = await call('connect_domain', { domain: 'www-site.mybrand.in', funnelId: site.id });
  await call('check_domain', { domainId: dom.domainId });
  const http = await import('node:http');
  const own = await new Promise((ok, no) => http.get({ host: '127.0.0.1', port: new URL(srv.base).port, path: '/about', headers: { host: 'www-site.mybrand.in' } }, (r) => { let b = ''; r.on('data', (c) => { b += c; }); r.on('end', () => ok({ status: r.statusCode, body: b })); }).on('error', no));
  assert.equal(own.status, 200);
  const onav = own.body.match(/<nav class="nav-links"[\s\S]*?<\/nav>/)[0];
  assert.ok(onav.includes('href="/"') && onav.includes('href="/contact"') && onav.includes('aria-current="page" href="/about"'), onav);
  // Hive builds one from a description
  const w = await call('create_website', { brand: 'Kavya Yoga Studio', tagline: 'Small-batch yoga classes in Indiranagar', headline: 'Yoga that *fits your week*', services: [{ icon: '🧘', title: 'Morning batch', text: 'Mon–Fri, 6:30 am', price: '₹2,500/month' }, { icon: '🌙', title: 'Evening batch', text: 'Mon–Fri, 7 pm' }], contact: { whatsapp: '9876543210', email: 'hi@kavya.in' }, style: 'organic', primary: '#16a34a' });
  assert.deepEqual(w.pages, ['home', 'about', 'services', 'contact'], JSON.stringify(w));
  const built = (await api(`/funnels/${w.id}`, 'GET', null, T)).data;
  assert.equal(built.theme.style, 'organic');
  const services = built.steps[2].blocks.find((b) => b.type === 'features').props.items;
  assert.equal(services[0].title, 'Morning batch · ₹2,500/month');
  assert.equal(built.steps[3].blocks.find((b) => b.type === 'whatsapp').props.number, '919876543210');
  assert.ok(built.steps.every((s) => s.id && s.blocks.every((b) => b.id)), 'every page and section has an id');
});
