// Lead sources: IndiaMART (push and pull), JustDial and Google Ads lead forms deliver enquiries into the CRM —
// contact made, enquiry on the timeline, source tag, a bell notification, no duplicates; the private addresses can
// be rotated; only owners and admins see or change them. IndiaMART is a fake here.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { startServer, register } from './helpers.mjs';

let srv, api, T, ls, im, imCalls = [];
const IM_ROWS = [
  { UNIQUE_QUERY_ID: 'IM-1001', QUERY_TYPE: 'W', SENDER_NAME: 'Suresh Patel', SENDER_MOBILE: '+91-9811100001', SENDER_EMAIL: 'suresh@example.com', SENDER_COMPANY: 'Patel Agro', SENDER_CITY: 'Rajkot', SENDER_STATE: 'Gujarat', QUERY_PRODUCT_NAME: 'Drip irrigation kit', QUERY_MESSAGE: 'Need 50 kits' },
  { UNIQUE_QUERY_ID: 'IM-1002', QUERY_TYPE: 'B', SENDER_NAME: 'IndiaMART Buyer', SENDER_MOBILE: '+91-9811100002', QUERY_PRODUCT_NAME: 'Sprinklers' },
];
before(async () => {
  im = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x'); imCalls.push(Object.fromEntries(u.searchParams));
    res.setHeader('content-type', 'application/json');
    if (u.searchParams.get('glusr_crm_key') !== 'GOOD-KEY-1234') return res.end(JSON.stringify({ CODE: 401, STATUS: 'FAILURE', MESSAGE: 'Key is incorrect', TOTAL_RECORDS: 0, RESPONSE: [] }));
    res.end(JSON.stringify({ CODE: 200, STATUS: 'SUCCESS', TOTAL_RECORDS: IM_ROWS.length, RESPONSE: IM_ROWS }));
  }).listen(0);
  await new Promise((r) => setTimeout(r, 30));
  srv = await startServer({ INBOUND_EMAIL_DOMAIN: 'in.test.dev', INDIAMART_API_URL: `http://127.0.0.1:${im.address().port}/v2/` });
  api = srv.api;
  T = (await register(api)).token;
  ls = (await api('/lead-sources', 'GET', null, T)).data;
});
after(async () => { await srv.stop(); im.close(); });
const contacts = async () => JSON.stringify((await api('/contacts', 'GET', null, T)).data);
const path = (u) => new URL(u).pathname.replace(/^\/api/, '');

test('the account gets private addresses: IndiaMART push, JustDial, Google (with a key) and a lead email', () => {
  assert.match(ls.indiamart.pushUrl, /\/api\/leads\/in\/[a-f0-9]{36}\/indiamart$/);
  assert.match(ls.justdial.url, /\/justdial$/);
  assert.ok(ls.google.key.length >= 20);
  assert.match(ls.email.address, /^leads-[a-f0-9]{10}@in\.test\.dev$/);
  assert.ok(ls.email.portals.includes('99acres') && ls.email.portals.includes('MagicBricks') && ls.email.portals.includes('Sulekha'));
});

test('IndiaMART push: a contact with the enquiry on its timeline and an IndiaMART tag; the same enquiry twice counts once', async () => {
  const body = { CODE: 200, STATUS: 'SUCCESS', RESPONSE: { UNIQUE_QUERY_ID: '621654886', QUERY_TYPE: 'B', SENDER_NAME: 'Prabhat', SENDER_MOBILE: '+91-9999900001', SENDER_COUNTRY_ISO: 'IN', QUERY_PRODUCT_NAME: 'Mineral Water Bottle', QUERY_MESSAGE: 'Need 1000 bottles' } };
  const r = await api(path(ls.indiamart.pushUrl), 'POST', body);
  assert.deepEqual([r.status, r.data.CODE], [200, 200]);
  await api(path(ls.indiamart.pushUrl), 'POST', body);
  const c = (await api('/contacts/phone%3A9999900001', 'GET', null, T)).data;
  assert.equal(c.name, 'Prabhat');
  assert.ok(c.tags.includes('IndiaMART'));
  assert.equal(JSON.stringify(c).match(/New enquiry from IndiaMART/g).length, 1, 'once, though it arrived twice');
  assert.match(JSON.stringify(c), /Mineral Water Bottle/);
  const n = (await api('/notifications', 'GET', null, T)).data;
  assert.match(JSON.stringify(n), /New lead from IndiaMART · Prabhat/);
});

test('JustDial: as a GET with parameters or a posted form', async () => {
  const q = new URLSearchParams({ leadid: 'JD-77', prefix: 'Ms', name: 'Kavya Rao', mobile: '9876512345', category: 'Interior Designers', area: 'Indiranagar', city: 'Bengaluru' });
  assert.equal((await api(`${path(ls.justdial.url)}?${q}`, 'GET')).status, 200);
  const r = await fetch(ls.justdial.url.replace(/^https?:\/\/[^/]+/, srv.base), { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'leadid=JD-78&name=Anil+Kumar&mobile=09876512346&category=Modular+Kitchen&city=Bengaluru' });
  assert.equal(r.status, 200);
  const all = await contacts();
  assert.match(all, /Ms Kavya Rao/);
  assert.match(all, /Anil Kumar/);
  const c = (await api('/contacts/phone%3A9876512346', 'GET', null, T)).data;
  assert.ok(c.tags.includes('JustDial'), 'a leading 0 is dropped from the number');
});

test('Google Ads lead form: only with the right key; a test lead is tagged as one', async () => {
  const b = { lead_id: 'G-1', is_test: false, user_column_data: [{ column_id: 'FULL_NAME', string_value: 'Meera Iyer' }, { column_id: 'PHONE_NUMBER', string_value: '+919845012345' }, { column_id: 'EMAIL', string_value: 'meera@example.com' }, { column_id: 'WHICH_COURSE', string_value: 'NEET 2027' }] };
  assert.equal((await api(path(ls.google.url), 'POST', { ...b, google_key: 'wrong' })).status, 403);
  assert.equal((await api(path(ls.google.url), 'POST', { ...b, google_key: ls.google.key })).status, 200);
  const c = (await api(`/contacts/${encodeURIComponent('meera@example.com')}`, 'GET', null, T)).data;
  assert.equal(c.name, 'Meera Iyer');
  assert.match(JSON.stringify(c), /which course: NEET 2027/);
  await api(path(ls.google.url), 'POST', { ...b, lead_id: 'G-2', is_test: true, google_key: ls.google.key, user_column_data: [{ column_id: 'EMAIL', string_value: 'gtest@example.com' }] });
  assert.ok((await api(`/contacts/${encodeURIComponent('gtest@example.com')}`, 'GET', null, T)).data.tags.includes('test lead'));
  // the counts on the settings card
  const st = (await api('/lead-sources', 'GET', null, T)).data.stats;
  assert.equal(st.google_ads.count, 1, 'test leads aren’t counted');
});

test('IndiaMART pull: the key is checked first, kept encrypted, and enquiries come in', async () => {
  assert.equal((await api('/lead-sources/indiamart', 'PUT', { key: 'BAD' }, T)).status, 400);
  const r = await api('/lead-sources/indiamart', 'PUT', { key: 'GOOD-KEY-1234' }, T);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.deepEqual([r.data.pulled, r.data.indiamart.connected, r.data.indiamart.keyHint], [2, true, '…1234']);
  assert.ok(!JSON.stringify(r.data).includes('GOOD-KEY-1234'), 'the key is never sent back');
  const call = imCalls.at(-1);
  assert.match(call.start_time, /^\d{2}-[A-Z][a-z]{2}-\d{4}\d{2}:\d{2}:\d{2}$/, 'IndiaMART’s format: 01-Jan-202209:00:00');
  assert.match(await contacts(), /Suresh Patel/);
  assert.ok(!JSON.stringify((await api('/settings', 'GET', null, T)).data).includes('GOOD-KEY'), 'not in the settings either');
  assert.equal((await api('/lead-sources/indiamart', 'DELETE', null, T)).data.indiamart.connected, false);
});

test('test buttons, rotating the addresses, unknown addresses, and who may see them', async () => {
  const t = await api('/lead-sources/test/justdial', 'POST', {}, T);
  assert.equal(t.data.ok, true);
  assert.equal((await api('/leads/in/nope/justdial', 'POST', { name: 'x', mobile: '9876500000' })).status, 404);
  const old = ls.justdial.url;
  const n = (await api('/lead-sources/rotate', 'POST', {}, T)).data;
  assert.notEqual(n.justdial.url, old);
  assert.equal((await api(path(old), 'POST', { leadid: 'x', name: 'Late', mobile: '9876500009' })).status, 404, 'the old address stops working');
  assert.equal((await api(path(n.justdial.url), 'POST', { leadid: 'y', name: 'Fresh', mobile: '9876500010' })).status, 200);
  // a viewer on the team can't see the addresses
  const vw = await register(api);
  const inv = (await api('/team/invite', 'POST', { email: vw.email, role: 'viewer' }, T)).data;
  const v = (await api('/team/accept', 'POST', { token: inv.token }, vw.token)).data.token;
  assert.equal((await api('/lead-sources', 'GET', null, v)).status, 403);
});
