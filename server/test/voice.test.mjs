// AI calling campaigns on the seller's own Sarvam account (a fake Sarvam here): connecting checks the key, the
// audience is only contacts who agreed to marketing (never "DND"), hours stay inside 9 am–9 pm, launching creates the
// campaign and streams the contacts with their variables, and each call's result lands on the contact.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { startServer, register } from './helpers.mjs';

let srv, api, T, fake, seen = { campaigns: [], cohorts: [], status: [], outbound: [] }, failCohort = false, campaignStatus = 'scheduled';
const KEY = 'sk_test_sarvam_1234';
before(async () => {
  fake = http.createServer((req, res) => {
    let b = ''; req.on('data', (c) => { b += c; });
    req.on('end', () => {
      res.setHeader('content-type', 'application/json');
      if (req.headers['x-api-key'] !== KEY) { res.writeHead(401); return res.end('{"detail":"Invalid API key"}'); }
      const body = b ? JSON.parse(b) : null, u = req.url;
      if (req.method === 'GET' && u.includes('/app-authoring/v1/orgs/org1/workspaces/ws1/deployments')) return res.end(JSON.stringify({ items: [{ deployment_id: 'dep-1', app_id: 'admissions-caller', app_version: 3, phone_numbers: ['+918047168000'], channel_direction: 'outbound', name: 'Admissions caller', status: 'active' }, { deployment_id: 'dep-2', app_id: 'support', app_version: 1, channel_direction: 'inbound', name: 'Support line' }], total: 2 }));
      if (req.method === 'POST' && u.endsWith('/scheduling/v1/orgs/org1/workspaces/ws1/campaigns')) { seen.campaigns.push(body); return res.end(JSON.stringify({ campaign_id: `camp-${seen.campaigns.length}`, status: 'scheduled', name: body.name })); }
      if (req.method === 'POST' && /\/campaigns\/camp-\d+\/cohorts\/stream$/.test(u)) { if (failCohort) { res.writeHead(422); return res.end(JSON.stringify({ error: { code: 'invalid', message: 'agent variable missing' } })); } seen.cohorts.push(body); return res.end(JSON.stringify({ cohort_id: 'co-1', status: 'processing', result: { total_records: body.users.length, valid_records: body.users.length, rejected_records: 0 } })); }
      if (req.method === 'PUT' && /\/campaigns\/camp-\d+\/status$/.test(u)) { seen.status.push([u, body.action]); return res.end(JSON.stringify({ status: { pause: 'paused', resume: 'active', cancel: 'cancelled' }[body.action] })); }
      if (req.method === 'GET' && /\/campaigns\/camp-\d+$/.test(u)) return res.end(JSON.stringify({ status: campaignStatus }));
      if (req.method === 'POST' && u.endsWith('/outbounds/v1/orgs/org1/workspaces/ws1/outbounds')) { seen.outbound.push(body); return res.end('{"attempt_id":"att-test"}'); }
      res.writeHead(404); res.end('{"detail":"Not Found"}');
    });
  }).listen(0);
  await new Promise((r) => setTimeout(r, 30));
  srv = await startServer({ SARVAM_API_BASE: `http://127.0.0.1:${fake.address().port}`, APP_URL: 'https://app.test' });
  api = srv.api;
  T = (await register(api)).token;
  // contacts: two who agreed to marketing, one of them DND-tagged, one who didn't agree, one without a phone
  for (const [name, phone, extra] of [['Riya Sen', '9876500101', { optIn: true }], ['Kabir Das', '+91 98765 00102', { optIn: true }], ['Dnd Person', '9876500103', { optIn: true, tags: ['DND'] }], ['No Consent', '9876500104', {}], ['Mail Only', '', { optIn: true }]]) {
    const c = (await api('/contacts', 'POST', { name, phone, email: phone ? undefined : 'mail@only.in' }, T)).data;
    await api(`/contacts/${encodeURIComponent(c.key)}`, 'PATCH', extra, T);
  }
});
after(async () => { await srv.stop(); fake.close(); });

test('connecting Sarvam: the key is checked, kept secret, and only calling agents are offered', async () => {
  const base = { orgId: 'org1', workspaceId: 'ws1', connectionId: 'conn-exotel-001', agentNumber: '08047168000' };
  assert.equal((await api('/voice/connect', 'PUT', { ...base, apiKey: 'wrong' }, T)).status, 400);
  const r = await api('/voice/connect', 'PUT', { ...base, apiKey: KEY }, T);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const v = (await api('/voice', 'GET', null, T)).data;
  assert.deepEqual([v.connected, v.keyHint, v.agentNumber], [true, '…1234', '+918047168000']);
  assert.deepEqual(v.agents.map((a) => a.name), ['Admissions caller'], 'inbound-only agents aren’t offered');
  assert.ok(!JSON.stringify(v).includes(KEY));
});

test('a calling campaign: consented contacts only, 9–9 hours, launched with variables; one launch only', async () => {
  const c = (await api('/voice/campaigns', 'POST', { name: 'Demo class follow-up', appId: 'admissions-caller', appVersion: 3, vars: [{ agent: 'customer_name', field: 'first_name' }, { agent: 'biz', field: 'business' }], schedule: { from: '08:00', to: '19:00' } }, T)).data;
  const d = (await api(`/voice/campaigns/${c.id}`, 'GET', null, T)).data;
  assert.deepEqual([d.audience.reach, d.audience.left.dnd, d.audience.left.notOptedIn], [2, 1, 1]);
  assert.match((await api(`/voice/campaigns/${c.id}/launch`, 'POST', {}, T)).data.error, /9:00 am and 9:00 pm/);
  await api(`/voice/campaigns/${c.id}`, 'PUT', { schedule: { from: '10:00', to: '19:00', days: ['Monday', 'Saturday'] } }, T);
  assert.match((await api(`/voice/campaigns/${c.id}/launch`, 'POST', {}, T)).data.error, /agreed to be called/);
  await api(`/voice/campaigns/${c.id}`, 'PUT', { consent: true }, T);
  const l = await api(`/voice/campaigns/${c.id}/launch`, 'POST', {}, T);
  assert.equal(l.status, 200, JSON.stringify(l.data));
  assert.deepEqual([l.data.status, l.data.sarvamId, l.data.stats.uploaded], ['scheduled', 'camp-1', 2]);
  const sent = seen.campaigns[0];
  assert.deepEqual(sent.allowed_schedule, { allowed_start_time: '10:00', allowed_end_time: '19:00', allowed_days: ['Monday', 'Saturday'], timezone: 'Asia/Kolkata' });
  assert.deepEqual([sent.app_config.app_id, sent.app_config.app_version, sent.app_config.connection_configs[0].connection_id], ['admissions-caller', 3, 'conn-exotel-001']);
  assert.match(sent.webhook_config.url, /^https:\/\/app\.test\/api\/voice\/hook\/[a-f0-9]{36}$/);
  const users = seen.cohorts[0].users;
  assert.deepEqual(users.map((x) => x.user_phone_number).sort(), ['+919876500101', '+919876500102']);
  assert.deepEqual(users.find((x) => x.user_phone_number === '+919876500101').app_variables, { customer_name: 'Riya' }, 'empty variables are left out');
  assert.equal((await api(`/voice/campaigns/${c.id}/launch`, 'POST', {}, T)).status, 400, 'only once');
  // pause, and Sarvam's own status is mirrored
  assert.equal((await api(`/voice/campaigns/${c.id}/status`, 'POST', { action: 'pause' }, T)).data.status, 'paused');
  campaignStatus = 'ended';
  assert.equal((await api(`/voice/campaigns/${c.id}`, 'GET', null, T)).data.status, 'ended');
});

test('each call’s result lands on the contact: outcome tag, answers, transcript; interested leads notify', async () => {
  const c = (await api('/voice', 'GET', null, T)).data.campaigns[0];
  const tok = seen.campaigns[0].webhook_config.url.split('/').pop();
  const riya = (await api('/contacts?q=Riya', 'GET', null, T)).data;
  const key = JSON.stringify(riya).match(/"key":"([^"]+)"/)[1];
  const p = { attempt_id: 'att-1', campaign_id: 'camp-1', user_identifier: key, user_phone_number: '+919876500101', connectivity_status: 'connected', completion_status: 'completed', duration: 42.5, interaction_id: 'x', metadata: { campaign: c.id }, output_agent_variables: { outcome: 'interested', preferred_time: 'evening' }, interaction_transcript: [{ role: 'agent', en_text: 'Hi Riya, calling about the demo class.' }, { role: 'user', en_text: 'Yes, please book Saturday.' }] };
  assert.equal((await api(`/voice/hook/${tok}`, 'POST', p)).status, 200);
  await api(`/voice/hook/${tok}`, 'POST', p); // delivered twice
  const m = (await api(`/contacts/${encodeURIComponent(key)}`, 'GET', null, T)).data;
  assert.ok(m.tags.includes('AI call: interested'));
  const s = JSON.stringify(m);
  assert.match(s, /AI call — talked 43s · interested/);
  assert.match(s, /preferred time: evening/);
  assert.match(s, /Customer: Yes, please book Saturday/);
  assert.match(JSON.stringify((await api('/notifications', 'GET', null, T)).data), /Interested on an AI call · Riya Sen/);
  await api(`/voice/hook/${tok}`, 'POST', { ...p, attempt_id: 'att-2', connectivity_status: 'no_answer', next_action_status: 'retry', output_agent_variables: {}, interaction_transcript: [] });
  const d = (await api(`/voice/campaigns/${c.id}`, 'GET', null, T)).data;
  assert.deepEqual([d.stats.attempts, d.stats.connected, d.stats.noAnswer], [2, 1, 1], 'the repeat delivery counted once');
  assert.equal((await api('/voice/hook/nope', 'POST', p)).status, 404);
});

test('a launch that fails half-way is cancelled at Sarvam and stays a draft; test calls; viewers can’t connect', async () => {
  failCohort = true;
  const c = (await api('/voice/campaigns', 'POST', { name: 'Will fail', appId: 'admissions-caller', appVersion: 3, consent: true }, T)).data;
  const r = await api(`/voice/campaigns/${c.id}/launch`, 'POST', {}, T);
  assert.match(r.data.error, /agent variable missing/);
  assert.ok(seen.status.some(([u, a]) => u.includes('camp-2') && a === 'cancel'), 'nothing half-launched keeps dialling');
  assert.equal((await api(`/voice/campaigns/${c.id}`, 'GET', null, T)).data.status, 'draft');
  failCohort = false;
  const t = await api('/voice/test-call', 'POST', { phone: '9876500999', appId: 'admissions-caller', appVersion: 3 }, T);
  assert.deepEqual([t.status, t.data.attemptId], [200, 'att-test']);
  assert.equal(seen.outbound[0].user_config.user_phone_number, '+919876500999');
  const vw = await register(api);
  const inv = (await api('/team/invite', 'POST', { email: vw.email, role: 'marketer' }, T)).data;
  const mk = (await api('/team/accept', 'POST', { token: inv.token }, vw.token)).data.token;
  assert.equal((await api('/voice/connect', 'PUT', { orgId: 'x', workspaceId: 'y', connectionId: 'z', agentNumber: '9876500000', apiKey: 'k' }, mk)).status, 403, 'a marketer runs campaigns but can’t connect the account');
  assert.equal((await api('/voice/campaigns', 'POST', { name: 'By marketer' }, mk)).status, 200);
});
