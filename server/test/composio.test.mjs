// Apps through Composio: the owner's project key (checked) turns on Settings → Apps & ads; a seller connects Meta
// Ads through Composio's hosted page under their own user id; Hive finds and runs that seller's actions — reads run,
// new campaigns are forced paused, and apps they haven't connected (or the owner hasn't offered) are refused.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { startServer, register, enable2fa } from './helpers.mjs';

let fake, srv, api, ADMIN, T, sellerId;
const calls = [], sent = [];
let connected = []; // what the stand-in Composio holds
const twoAccounts = new Set(); // sellers whose Meta connection has a second brand's ad account
before(async () => {
  fake = http.createServer((req, res) => {
    let b = '';
    req.on('data', (c) => { b += c; });
    req.on('end', () => {
      const body = b ? JSON.parse(b) : null;
      const url = new URL(req.url, 'http://x');
      calls.push({ method: req.method, path: url.pathname, query: Object.fromEntries(url.searchParams), body, key: req.headers['x-api-key'] });
      const send = (code, d) => { res.statusCode = code; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(d)); };
      if (req.headers['x-api-key'] !== 'cmp_good') return send(401, { error: { message: 'Invalid API key' } });
      const p = url.pathname.replace('/api/v3.1', '');
      if (p === '/auth_configs' && req.method === 'GET') return send(200, { items: url.searchParams.get('toolkit_slug') === 'metaads' ? [{ id: 'ac_meta', status: 'ENABLED' }] : [] });
      if (p === '/auth_configs' && req.method === 'POST') return send(201, { auth_config: { id: `ac_${body.toolkit.slug}` } });
      if (p === '/connected_accounts/link') { connected.push({ id: 'ca_1', status: 'ACTIVE', toolkit: { slug: 'metaads' }, user_id: body.user_id, created_at: 'now' }); return send(201, { redirect_url: 'https://connect.composio.dev/link/abc' }); }
      if (p === '/connected_accounts' && req.method === 'GET') return send(200, { items: connected.filter((c) => c.user_id === url.searchParams.get('user_ids')) });
      if (p.startsWith('/connected_accounts/') && req.method === 'DELETE') { connected = connected.filter((c) => `/connected_accounts/${c.id}` !== p); return send(200, { success: true }); }
      if (p === '/tools') return send(200, { items: url.searchParams.get('toolkit_slug') === 'metaads' ? [
        { slug: 'METAADS_GET_INSIGHTS', name: 'Get insights', description: 'Campaign performance insights', input_parameters: { properties: { object_id: {} } } },
        { slug: 'METAADS_CREATE_CAMPAIGN', name: 'Create campaign', description: 'Create a campaign', input_parameters: { properties: { name: {}, status: {} } } },
      ] : [{ slug: 'GOOGLEADS_SEARCH_STREAM_GAQL', name: 'Search', description: 'Google Ads report' }] });
      const slug = p.split('/').pop();
      if (slug === 'METAADS_GET_AD_ACCOUNTS') return send(200, { successful: true, data: { data: [{ id: 'act_1111111', account_id: '1111111', name: 'Asha Studio' }, ...(twoAccounts.has(body.user_id) ? [{ id: 'act_4444444', account_id: '4444444', name: 'Asha Kids' }] : [])] } });
      if (slug === 'METAADS_LIST_AD_ACCOUNT_PIXELS') return send(200, { successful: true, data: { pixels: body.arguments.ad_account_id === '4444444' ? [{ id: '5555555', name: 'Kids pixel' }] : [{ id: '2222222', name: 'Main pixel' }] } });
      if (slug === 'METAADS_GET_INSIGHTS' && body.arguments.object_id === 'act_4444444') return send(200, { successful: true, data: { data: [{ date_start: '2026-10-20', campaign_name: 'Kids Launch', adset_name: 'Parents', ad_name: 'Reel K', ad_id: '130001', spend: '700' }] } });
      if (slug === 'METAADS_SEND_CONVERSION_EVENTS') { sent.push(body); return send(200, { successful: true, data: { events_received: body.arguments.events.length } }); }
      if (slug === 'METAADS_GET_INSIGHTS' && body.arguments.level === 'ad') return send(200, { successful: true, data: { data: [{ date_start: '2026-10-20', campaign_name: 'Diwali Sale', adset_name: 'Women 25-40', ad_name: 'Reel A', ad_id: '120001', spend: '1500.50', impressions: '9000', clicks: '210' }, { date_start: '2026-10-21', campaign_name: 'Diwali Sale', adset_name: 'Women 25-40', ad_name: 'Reel A', ad_id: '120001', spend: '900' }] } });
      if (p.startsWith('/tools/execute/')) return send(200, { successful: true, data: { slug: p.split('/').pop(), args: body.arguments, user: body.user_id }, error: null });
      send(404, { error: { message: 'not found' } });
    });
  }).listen(0);
  await new Promise((r) => setTimeout(r, 30));
  srv = await startServer({ COMPOSIO_BASE_URL: `http://127.0.0.1:${fake.address().port}`, ADMIN_EMAILS: 'owner@cmp.test', APP_URL: 'https://app.example.in', AUTOMATION_TICK_MS: '50', AUTOMATION_TIME_SCALE: '0.001' });
  api = srv.api;
  ADMIN = (await register(api, 'owner@cmp.test')).token;
  const link = srv.log().match(/To: owner@cmp\.test[\s\S]*?\/verify\?token=([a-f0-9.]+)/);
  await api('/auth/verify', 'POST', { token: link[1] });
  ADMIN = (await enable2fa(api, ADMIN)).token;
  const reg = await register(api);
  T = reg.token;
  sellerId = (await api('/me', 'GET', null, T)).data.id;
});
after(async () => { await srv?.stop(); fake?.close(); });

test('off until the owner adds a valid Composio key; then a seller connects Meta Ads under their own user id', async () => {
  assert.equal((await api('/integrations', 'GET', null, T)).data.ready, false);
  assert.match((await api('/admin/settings', 'PUT', { composio: { key: 'cmp_bad' } }, ADMIN)).data.error, /didn’t accept/);
  const ok = await api('/admin/settings', 'PUT', { composio: { key: 'cmp_good', apps: ['metaads'] } }, ADMIN);
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  assert.equal(ok.data.composio.ready, true);
  assert.ok(!JSON.stringify(ok.data).includes('cmp_good'), 'the key is never sent back');

  const i = (await api('/integrations', 'GET', null, T)).data;
  assert.deepEqual(i.apps.map((a) => a.app), ['metaads'], 'Google Ads stays off until the owner offers it');
  assert.equal((await api('/integrations/googleads/connect', 'POST', {}, T)).status, 400);
  const c = await api('/integrations/metaads/connect', 'POST', {}, T);
  assert.equal(c.data.url, 'https://connect.composio.dev/link/abc');
  const linkCall = calls.find((x) => x.path.endsWith('/connected_accounts/link'));
  assert.equal(linkCall.body.auth_config_id, 'ac_meta');
  assert.equal(linkCall.body.user_id, `fh_${sellerId}`);
  assert.match(linkCall.body.callback_url, /^https:\/\/app\.example\.in\/settings\?connected=metaads/);
  assert.equal((await api('/integrations', 'GET', null, T)).data.connections[0].status, 'ACTIVE');
});

test('Hive finds and runs the seller’s actions; new campaigns are forced paused; disconnect removes access', async () => {
  const tools = (await api('/integrations/tools?q=insights', 'GET', null, T)).data;
  assert.deepEqual(tools.connected, ['Meta Ads']);
  assert.equal(tools.tools[0].slug, 'METAADS_GET_INSIGHTS');
  assert.equal(tools.tools[0].readOnly, true);
  const read = (await api('/integrations/run', 'POST', { slug: 'METAADS_GET_INSIGHTS', arguments: { object_id: 'act_1' } }, T)).data;
  assert.equal(read.ok, true);
  assert.equal(read.data.user, `fh_${sellerId}`, 'runs as this seller only');
  const made = (await api('/integrations/run', 'POST', { slug: 'METAADS_CREATE_CAMPAIGN', arguments: { name: 'Webinar', status: 'ACTIVE' } }, T)).data;
  assert.equal(made.data.args.status, 'PAUSED', 'a new campaign never starts live');
  assert.equal((await api('/integrations/run', 'POST', { slug: 'GOOGLEADS_SEARCH_STREAM_GAQL', arguments: {} }, T)).status, 400, 'an app not offered or not connected');
  assert.equal((await api('/integrations/run', 'POST', { slug: 'METAADS_DELETE_EVERYTHING', arguments: {} }, T)).status, 400, 'unknown actions are refused');
  // another seller sees none of it
  const T2 = (await register(api)).token;
  assert.deepEqual((await api('/integrations', 'GET', null, T2)).data.connections, []);
  assert.equal((await api('/integrations/run', 'POST', { slug: 'METAADS_GET_INSIGHTS', arguments: {} }, T2)).status, 400);
  // disconnect
  await api('/integrations/connections/ca_1', 'DELETE', null, T);
  assert.equal((await api('/integrations/run', 'POST', { slug: 'METAADS_GET_INSIGHTS', arguments: {} }, T)).status, 400);
});

const until = async (fn, ms = 5000) => { const end = Date.now() + ms; for (;;) { const v = await fn(); if (v || Date.now() > end) return v; await new Promise((r) => setTimeout(r, 60)); } };
test('one Meta connection: pick the ad account and pixel, and the pixel, conversions, the “Send to Meta” step and ad spend all use it', async () => {
  await api('/integrations/metaads/connect', 'POST', {}, T);
  const opts = (await api('/integrations/meta', 'GET', null, T)).data;
  assert.deepEqual(opts.accounts.map((a) => a.id), ['1111111']);
  assert.equal(opts.account, '1111111', 'a single ad account is picked for them');
  assert.deepEqual(opts.pixels.map((p) => p.id), ['2222222']);
  assert.equal((await api('/integrations/meta', 'PUT', { account: '1111111', pixel: '9999999' }, T)).status, 400, 'a pixel from elsewhere is refused');
  const saved = (await api('/integrations/meta', 'PUT', { account: '1111111', pixel: '2222222' }, T)).data;
  assert.equal(saved.pixelOnPages, true);
  assert.equal((await api('/settings', 'GET', null, T)).data?.tracking?.fbPixel ?? (await api('/me', 'GET', null, T)).data.settings.tracking.fbPixel, '2222222', 'the pixel goes on the pages');
  assert.equal((await api('/channels/tracking', 'GET', null, T)).data.viaApps, true);
  // spend pulled in the background, through the same connection
  assert.ok(await until(async () => (await api('/adspend', 'GET', null, T)).data.platforms?.some((p) => p.p === 'meta' && p.n === 2)), 'spend synced');
  assert.equal((await api('/adspend', 'GET', null, T)).data.meta.via, 'apps');
  const ads = (await api('/ads/report?days=3650', 'GET', null, T)).data;
  const reel = ads.rows.find((r) => r.adId === '120001');
  assert.deepEqual([reel?.ad, reel?.adset, reel?.spend, reel?.clicks], ['Reel A', 'Women 25-40', 2401, 210], 'spend per ad from the Meta connection');
  assert.equal(ads.setup.meta, true);

  // the automation step: a contact reaching “qualified” is sent to Meta, hashed, through Composio
  const c = (await api('/automations', 'POST', { name: 'Qualified → Meta', trigger: { type: 'tag', tag: 'qualified' }, steps: [{ type: 'meta', event: 'QualifiedLead' }, { type: 'meta', event: 'Purchase', value: '4999' }] }, T)).data;
  const on = await api(`/automations/${c.id}`, 'PUT', { active: true }, T);
  assert.equal(on.status, 200, JSON.stringify(on.data));
  assert.equal(on.data.warnings?.length ?? 0, 0, 'no “Meta isn’t connected” warning');
  await api('/contacts', 'POST', { email: 'Ravi@Example.in', phone: '98765 43210', name: 'Ravi Kumar' }, T);
  await api(`/contacts/${encodeURIComponent('ravi@example.in')}`, 'PATCH', { tags: ['qualified'] }, T);
  assert.ok(await until(() => sent.length >= 2), 'both events went out');
  const [q1, p1] = sent.map((b) => b.arguments);
  assert.equal(sent[0].user_id, `fh_${sellerId}`);
  assert.equal(q1.pixel_or_dataset_id, '2222222');
  assert.equal(q1.confirm_production, true);
  const e = q1.events[0];
  assert.equal(e.event_name, 'QualifiedLead');
  assert.equal(e.action_source, 'system_generated');
  assert.match(e.customer_data.email_sha256[0], /^[a-f0-9]{64}$/);
  assert.match(e.customer_data.phone_sha256[0], /^[a-f0-9]{64}$/);
  assert.ok(!JSON.stringify(sent).includes('ravi@example.in') && !JSON.stringify(sent).includes('9876543210'), 'never sent in the clear');
  assert.deepEqual(p1.events[0].custom_data, { value: 4999, currency: 'INR' });
  assert.ok(await until(async () => (await api('/conversions', 'GET', null, T)).data.filter((d) => d.status === 'sent').length >= 2), 'logged as sent');

  // disconnecting Meta stops it all
  const conn = (await api('/integrations', 'GET', null, T)).data.connections.find((x) => x.app === 'metaads');
  await api(`/integrations/connections/${conn.id}`, 'DELETE', null, T);
  assert.equal((await api('/channels/tracking', 'GET', null, T)).data.viaApps, false);
  const got = (await api('/automations', 'GET', null, T)).data.channels.meta;
  assert.equal(got, false);
});

test('every app action comes out of the seller’s AI credits (the owner sets how many); at zero nothing runs', async () => {
  const reg = await register(api), T3 = reg.token, id3 = (await api('/me', 'GET', null, T3)).data.id;
  await api('/integrations/metaads/connect', 'POST', {}, T3);
  assert.equal((await api(`/admin/users/${id3}/action`, 'POST', { action: 'set_credits', limit: 2 }, ADMIN)).status, 200);
  const runs = () => calls.filter((c) => c.path.includes('/tools/execute/') && c.body?.user_id === `fh_${id3}`).length;
  const run = () => api('/integrations/run', 'POST', { slug: 'METAADS_GET_INSIGHTS', arguments: { object_id: 'act_1' } }, T3);
  assert.equal((await run()).status, 200);
  assert.equal((await run()).status, 200);
  assert.equal((await api('/me', 'GET', null, T3)).data.credits.used, 2, 'one credit per action by default');
  const out = await run();
  assert.equal(out.status, 402);
  assert.equal(out.data.credits, true);
  assert.equal(runs(), 2, 'refused before Composio is called');
  // background work through the connection stops too (here: reading the ad accounts)
  assert.match((await api('/integrations/meta', 'GET', null, T3)).data.error, /AI credits/);
  assert.equal(runs(), 2);
  // the owner's rate: 0 makes actions free, anything else must be a whole number up to 100
  assert.equal((await api('/admin/settings', 'PUT', { composio: { creditsPerCall: 1.5 } }, ADMIN)).status, 400);
  const free = await api('/admin/settings', 'PUT', { composio: { creditsPerCall: 0 } }, ADMIN);
  assert.equal(free.data.composio.creditsPerCall, 0);
  assert.equal((await run()).status, 200);
  assert.equal((await api('/me', 'GET', null, T3)).data.credits.used, 2);
  await api('/admin/settings', 'PUT', { composio: { creditsPerCall: 1 } }, ADMIN);
});

test('with app connections on, Meta is connected only through Apps & ads: no pasted tokens', async () => {
  const T4 = (await register(api)).token;
  const token = 'EAAB'.padEnd(60, 'x');
  assert.equal((await api('/adspend', 'GET', null, T4)).data.apps, true);
  assert.equal((await api('/channels/tracking', 'GET', null, T4)).data.apps, true);
  const spend = await api('/adspend/meta', 'PUT', { account: '1111111', token }, T4);
  assert.equal(spend.status, 400);
  assert.match(spend.data.error, /Apps & ads/);
  assert.match((await api('/channels/tracking', 'PUT', { metaToken: token }, T4)).data.error, /Apps & ads/);
  assert.equal((await api('/channels/tracking', 'PUT', { metaToken: '' }, T4)).status, 200, 'removing a token still works');
  assert.equal((await api('/adspend/meta', 'PUT', { clear: true }, T4)).status, 200);
  const f = (await api('/templates/yoga/use', 'POST', {}, T4)).data;
  const own = await api(`/funnels/${f.id}/tracking`, 'PUT', { fbPixel: '3333333', metaToken: token }, T4);
  assert.match(own.data.error, /Apps & ads/);
  assert.equal((await api(`/funnels/${f.id}/tracking`, 'GET', null, T4)).data.apps, true);
});

test('more brands: spend syncs from every picked ad account, and a funnel can fire another brand’s pixel through the connection', async () => {
  const T5 = (await register(api)).token, id5 = (await api('/me', 'GET', null, T5)).data.id;
  twoAccounts.add(`fh_${id5}`);
  await api('/integrations/metaads/connect', 'POST', {}, T5);
  assert.deepEqual((await api('/integrations/meta', 'GET', null, T5)).data.accounts.map((a) => a.id), ['1111111', '4444444']);
  assert.equal((await api('/integrations/meta', 'PUT', { account: '1111111', pixel: '2222222', accounts: ['9999999'] }, T5)).status, 400, 'an ad account from elsewhere is refused');
  const saved = (await api('/integrations/meta', 'PUT', { account: '1111111', pixel: '2222222', accounts: ['4444444'] }, T5)).data;
  assert.deepEqual(saved.selected.accounts, ['1111111', '4444444']);
  // spend from both accounts, in one report
  assert.equal((await api('/adspend/meta/sync', 'POST', { days: 30 }, T5)).data.rows, 3);
  const rows = (await api('/ads/report?days=3650', 'GET', null, T5)).data.rows;
  assert.deepEqual(['120001', '130001'].map((id) => rows.find((r) => r.adId === id)?.spend), [2401, 700]);
  assert.deepEqual((await api('/adspend', 'GET', null, T5)).data.meta.accounts, ['1111111', '4444444']);

  // a funnel for the second brand: its pixel is picked from the connection, and its leads go there server-side
  const g = (await api('/templates/webinar/use', 'POST', {}, T5)).data;
  await api(`/funnels/${g.id}`, 'PUT', { published: true }, T5);
  const tr = (await api(`/funnels/${g.id}/tracking`, 'GET', null, T5)).data;
  assert.ok(tr.pixels.some((p) => p.id === '5555555' && p.account === '4444444'));
  assert.match((await api(`/funnels/${g.id}/tracking`, 'PUT', { fbPixel: '7777777' }, T5)).data.error, /Meta connection/, 'a pixel outside the connection is refused');
  assert.equal((await api(`/funnels/${g.id}/tracking`, 'PUT', { fbPixel: '5555555' }, T5)).status, 200);
  const mine = () => sent.filter((b) => b.user_id === `fh_${id5}`).map((b) => b.arguments.pixel_or_dataset_id);
  await api(`/public/${g.slug}/lead`, 'POST', { stepId: g.steps[0].id, email: 'kids@example.com', name: 'Asha', eventId: 'lead-kids-123456' });
  assert.ok(await until(() => mine().includes('5555555')), 'the funnel’s own pixel, through the connection');
  assert.ok(!mine().includes('2222222'), 'never the main pixel instead');
});
