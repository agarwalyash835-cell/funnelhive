// Apps through Composio: the owner's project key (checked) turns on Settings → Apps & ads; a seller connects Meta
// Ads through Composio's hosted page under their own user id; Hive finds and runs that seller's actions — reads run,
// new campaigns are forced paused, and apps they haven't connected (or the owner hasn't offered) are refused.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { startServer, register, enable2fa } from './helpers.mjs';

let fake, srv, api, ADMIN, T, sellerId;
const calls = [];
let connected = []; // what the stand-in Composio holds
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
      if (p.startsWith('/tools/execute/')) return send(200, { successful: true, data: { slug: p.split('/').pop(), args: body.arguments, user: body.user_id }, error: null });
      send(404, { error: { message: 'not found' } });
    });
  }).listen(0);
  await new Promise((r) => setTimeout(r, 30));
  srv = await startServer({ COMPOSIO_BASE_URL: `http://127.0.0.1:${fake.address().port}`, ADMIN_EMAILS: 'owner@cmp.test', APP_URL: 'https://app.example.in' });
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
