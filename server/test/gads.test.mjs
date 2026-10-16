// Google Ads offline conversions: a secret import feed (Goals → Conversions → Uploads → Schedules → HTTPS) of sales
// credited to the ad click that brought the buyer in (often at the lead stage, days before the sale), and an
// optional hourly Google Ads API upload (beta), tested against a fake Google endpoint.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import { startServer, register } from './helpers.mjs';

const DAY = 86400000;
const now = Date.now();
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
let srv, api, T, tok, uid, db, fake, got = [], gotHeaders = [];

before(async () => {
  // the fake Google: OAuth token, GAQL search, uploadClickConversions (rejects gclid G5 once per call)
  fake = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => { body += d; });
    req.on('end', () => {
      res.setHeader('content-type', 'application/json');
      if (req.url === '/token') return res.end(JSON.stringify({ access_token: 'ya29.fake', expires_in: 3600 }));
      if (req.url.endsWith('/googleAds:search')) return res.end(JSON.stringify({ results: [{ conversionAction: { resourceName: 'customers/1234567890/conversionActions/111', name: 'Imported purchase', status: 'ENABLED' } }, { conversionAction: { resourceName: 'customers/1234567890/conversionActions/333', name: 'Imported lead', status: 'ENABLED' } }] }));
      if (req.url === '/customers/1234567890:uploadClickConversions') {
        const b = JSON.parse(body);
        got.push(...b.conversions); gotHeaders.push(req.headers);
        const bad = b.conversions.findIndex((c) => c.gclid === 'G5');
        return res.end(JSON.stringify({ results: b.conversions.map((c, i) => (i === bad ? {} : { gclid: c.gclid, conversionAction: c.conversionAction })), ...(bad >= 0 ? { partialFailureError: { code: 3, message: 'Partial failure', details: [{ errors: [{ errorCode: { conversionUploadError: 'TOO_RECENT_CONVERSION_ACTION' }, message: 'This conversion action was created too recently.', location: { fieldPathElements: [{ fieldName: 'conversions', index: bad }] } }] }] } } : {}) }));
      }
      res.statusCode = 404; res.end('{}');
    });
  }).listen(0);
  const fbase = `http://127.0.0.1:${fake.address().port}`;
  srv = await startServer({ GOOGLE_ADS_API_URL: fbase, GOOGLE_ADS_TOKEN_URL: `${fbase}/token` });
  api = srv.api;
  const r = await register(api);
  tok = r.token;
  // write sales straight into the server's database (real paid orders need a live payment provider)
  process.env.DATA_DIR = srv.dataDir; process.env.FF_JOBS = '0';
  db = await import('../db.js');
  T = db.T;
  uid = T.users.find({ email: r.email }).id;
  const live = { provider: 'razorpay', mode: 'live', status: 'paid' };
  const order = (id, x) => T.orders.put({ id, userId: uid, funnelId: 'f1', name: 'B', phone: '', items: [{ name: 'Coaching', kind: 'main', price: x.total }], source: 'direct', at: now - DAY, ...live, ...x });
  const lead = (id, x) => T.leads.put({ id, userId: uid, funnelId: 'f1', stepId: 's', name: 'L', phone: '', source: 'google', at: now - 5 * DAY, ...x });
  // the ad click happened at the lead stage; the sale came later through a quote, in dollars
  lead('L1', { email: 'asha@example.in', phone: '9876500001', attr: { utm_source: 'google', gclid: 'G1' }, consent: { given: true, at: now } });
  order('O1', { email: 'asha@example.in', total: 12, currency: 'USD', fx: 83.5, source: 'quote' });
  order('O2', { email: 't@example.in', total: 500, attr: { gclid: 'G2' }, mode: 'test' }); // test keys
  order('O3', { email: 'cod@example.in', total: 400, attr: { gclid: 'G3' }, status: 'cod', paymentMethod: 'cod', provider: undefined, mode: undefined }); // COD not collected
  order('O4', { email: 'ref@example.in', total: 0, refunded: 900, attr: { gclid: 'G4' }, status: 'refunded' }); // fully refunded
  order('O5', { email: 'part@example.in', total: 800, refunded: 200, attr: { gclid: 'G5' }, status: 'partially_refunded' }); // net ₹800
  lead('L2', { email: 'no@example.in', attr: { gclid: 'G6' }, consent: { given: false, at: now } }); // refused
  order('O6', { email: 'no@example.in', total: 300 });
  lead('L9', { email: 'old@example.in', attr: { gclid: 'G9' }, at: now - 120 * DAY }); // click too old
  order('O9', { email: 'old@example.in', total: 300 });
  // for the lead / booking conversions and hashed identifiers
  lead('L3', { email: 'q@example.in', attr: { gclid: 'G7' }, qualified: true, at: now - 2 * DAY }); // consent never asked
  lead('L4', { email: 'C.D@Gmail.com', phone: '+91 98765 00004', qualified: true, consent: { given: true, at: now }, at: now - 2 * DAY }); // no click
  T.bookings.put({ id: 'B1', userId: uid, calendarId: 'c1', email: 'asha@example.in', name: 'Asha', phone: '', start: now + DAY, end: now + DAY + 1800e3, status: 'confirmed', at: now - 3 * DAY });
});
after(async () => { fake?.close(); await srv?.stop(); });

const csv = async (url) => { const r = await fetch(url); return { status: r.status, type: r.headers.get('content-type'), text: await r.text() }; };
const rows = (text) => text.trim().split('\r\n').map((l) => l.split(','));

test('the import feed: sales credited to the earlier lead’s click, net INR, Google’s time format', async () => {
  const st = (await api('/channels/gads', 'GET', null, tok)).data;
  assert.match(st.feedUrl, /\/api\/gads\/offline\.csv\?token=[\w]+\.[0-9a-f]{48}$/);
  assert.deepEqual(st.include, { purchase: true, booking: false, lead: false });
  assert.equal(st.names.purchase, 'FunnelHive purchase');
  const r = await csv(st.feedUrl);
  assert.equal(r.status, 200);
  assert.match(r.type, /text\/csv/);
  const [head, ...body] = rows(r.text);
  assert.deepEqual(head, ['Google Click ID', 'Conversion Name', 'Conversion Time', 'Conversion Value', 'Conversion Currency', 'Order ID']);
  const o1 = body.find((x) => x[5] === 'O1');
  assert.ok(o1, r.text);
  assert.equal(o1[0], 'G1', 'the click from the lead stage');
  assert.equal(o1[1], 'FunnelHive purchase');
  assert.equal(o1[3], '1002', '$12 × 83.5 in rupees');
  assert.equal(o1[4], 'INR');
  const ist = new Date(now - DAY + 330 * 60000).toISOString().slice(0, 19).replace('T', ' ');
  assert.equal(o1[2], `${ist}+05:30`);
  assert.equal(body.find((x) => x[5] === 'O5')?.[3], '800', 'partial refund comes off');
  for (const id of ['O2', 'O3', 'O4', 'O6', 'O9']) assert.ok(!body.some((x) => x[5] === id), `${id} is left out`);
  assert.equal(body.length, 2);
  assert.ok(!r.text.includes('@'), 'no identifiers unless turned on');
  // the Download button: same file as an attachment
  assert.match((await fetch(`${st.feedUrl}&download=1`)).headers.get('content-disposition'), /attachment; filename="google-ads-offline-conversions-/);
});

test('wrong, missing or rotated token → 404', async () => {
  const { feedUrl } = (await api('/channels/gads', 'GET', null, tok)).data;
  assert.equal((await csv(feedUrl.replace(/.$/, (c) => (c === '0' ? '1' : '0')))).status, 404);
  assert.equal((await csv(feedUrl.split('?')[0])).status, 404);
  assert.equal((await csv(`${feedUrl.split('?')[0]}?token=nobody.abc`)).status, 404);
  const other = (await register(api)).token;
  const theirs = (await api('/channels/gads', 'GET', null, other)).data.feedUrl;
  assert.ok(!(await csv(theirs)).text.includes('G1'), 'another workspace sees only its own');
  const next = (await api('/channels/gads/rotate', 'POST', {}, tok)).data.feedUrl;
  assert.notEqual(next, feedUrl);
  assert.equal((await csv(feedUrl)).status, 404, 'the old address stops working');
  assert.equal((await csv(next)).status, 200);
  assert.equal((await fetch(`${srv.base}/api/channels/gads`)).status, 401, 'settings need a login');
});

test('settings: names, which events, hashed identifiers only for consented contacts', async () => {
  assert.equal((await api('/channels/gads', 'PUT', { names: { purchase: '=HYPERLINK("x")' } }, tok)).status, 400, 'no spreadsheet formulas');
  let st = (await api('/channels/gads', 'PUT', { names: { lead: 'Qualified lead (import)' }, include: { booking: true, lead: true } }, tok)).data;
  assert.equal(st.names.lead, 'Qualified lead (import)');
  let body = rows(await (await fetch(st.feedUrl)).text()).slice(1);
  const b1 = body.find((x) => x[5] === 'B1');
  assert.deepEqual([b1[0], b1[1], b1[3], b1[4]], ['G1', 'FunnelHive booking', '', ''], 'a booking: the lead’s click, no value');
  assert.equal(body.find((x) => x[5] === 'L3')?.[1], 'Qualified lead (import)');
  assert.ok(!body.some((x) => x[5] === 'L4'), 'no click and no identifiers: nothing to match');
  assert.equal(st.preview.length, 4);

  st = (await api('/channels/gads', 'PUT', { hashed: true }, tok)).data;
  const [head, ...rest] = rows(await (await fetch(st.feedUrl)).text());
  assert.deepEqual(head, ['Google Click ID', 'Email', 'Phone Number', 'Conversion Name', 'Conversion Time', 'Conversion Value', 'Conversion Currency', 'Order ID']);
  const o1 = rest.find((x) => x[7] === 'O1');
  assert.equal(o1[1], sha('asha@example.in'), 'consented on the form');
  assert.equal(o1[2], '', 'the order has no phone');
  const l3 = rest.find((x) => x[7] === 'L3');
  assert.deepEqual([l3[0], l3[1], l3[2]], ['G7', '', ''], 'never asked: click id only');
  const l4 = rest.find((x) => x[7] === 'L4');
  assert.deepEqual([l4[0], l4[1], l4[2]], ['', sha('cd@gmail.com'), sha('+919876500004')], 'Gmail dots dropped, phone in E.164');
  assert.ok(!rest.some((x) => x.includes('no@example.in') || x[7] === 'O6'));
});

test('Google Ads API upload (beta): test connection, partial failures recorded, never twice', async () => {
  assert.equal((await api('/channels/gads/upload', 'POST', {}, tok)).status, 400, 'not connected');
  assert.equal((await api('/channels/gads', 'PUT', { api: { enabled: true } }, tok)).status, 400, 'needs every detail');
  assert.equal((await api('/channels/gads', 'PUT', { api: { customerId: '12345' } }, tok)).status, 400);
  let st = (await api('/channels/gads', 'PUT', { api: { developerToken: 'devtoken_ABCDEFGHIJ12', clientId: '1234-abc.apps.googleusercontent.com', clientSecret: 'GOCSPX-secret12345', refreshToken: '1//0gRefreshToken', customerId: '123-456-7890', actions: { purchase: '111', lead: 'customers/1234567890/conversionActions/333' }, enabled: true } }, tok)).data;
  assert.equal(st.api.ready, true);
  assert.equal(st.api.developerToken, true);
  assert.equal(st.api.actions.purchase, 'customers/1234567890/conversionActions/111');
  assert.ok(!JSON.stringify(st).includes('GOCSPX'), 'secrets never come back');
  const stored = JSON.stringify(T.users.get(uid).channels.gads);
  assert.ok(!stored.includes('GOCSPX') && !stored.includes('devtoken_'), 'encrypted at rest');

  const t = (await api('/channels/gads/test', 'POST', {}, tok)).data;
  assert.equal(t.ok, true, JSON.stringify(t));

  const r1 = (await api('/channels/gads/upload', 'POST', {}, tok)).data;
  // purchases O1, O5 and leads L3, L4; the booking has no conversion action → skipped
  assert.deepEqual([r1.sent, r1.failed, r1.skipped], [3, 1, 1], JSON.stringify(r1));
  assert.equal(gotHeaders[0]['developer-token'], 'devtoken_ABCDEFGHIJ12');
  assert.equal(gotHeaders[0].authorization, 'Bearer ya29.fake');
  const c1 = got.find((c) => c.orderId === 'O1');
  assert.deepEqual({ gclid: c1.gclid, value: c1.conversionValue, cur: c1.currencyCode, action: c1.conversionAction }, { gclid: 'G1', value: 1002, cur: 'INR', action: 'customers/1234567890/conversionActions/111' });
  assert.match(c1.conversionDateTime, /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d\+05:30$/);
  assert.deepEqual(c1.userIdentifiers, [{ hashedEmail: sha('asha@example.in') }]);
  assert.deepEqual(got.find((c) => c.orderId === 'L4').userIdentifiers.map(Object.keys).flat(), ['hashedEmail', 'hashedPhoneNumber']);
  assert.equal(r1.status.api.failing[0].key, 'purchase:O5');
  assert.match(r1.status.api.failing[0].err, /too recently/);

  got = [];
  const r2 = (await api('/channels/gads/upload', 'POST', {}, tok)).data;
  assert.deepEqual(got.map((c) => c.orderId), ['O5'], 'only the failed one is retried');
  assert.equal(r2.sent, 0);
  got = [];
  await api('/channels/gads/upload', 'POST', {}, tok);
  got = [];
  await api('/channels/gads/upload', 'POST', {}, tok);
  assert.equal(got.length, 0, 'gives up after 3 tries');
  st = (await api('/channels/gads', 'GET', null, tok)).data;
  assert.equal(st.api.uploaded, 3);
  assert.equal(st.api.lastResult.sent, 0);
  // disconnect
  st = (await api('/channels/gads', 'PUT', { api: null }, tok)).data;
  assert.deepEqual([st.api.ready, st.api.enabled, st.api.developerToken], [false, false, false]);
});
