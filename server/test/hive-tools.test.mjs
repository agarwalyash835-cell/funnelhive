// Hive AI's newer tools, called over MCP like any AI client would: checkout (currency, membership, payment plan,
// COD), products, calendar and webinar set-up with time zones, sales numbers, contacts and tags, broadcast drafts
// (never sent unless asked), business settings. Plus: a team member's Hive is held to their role.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, register } from './helpers.mjs';

let srv, api, T, tok, f, w;
const call = async (name, args, token = tok) => {
  const r = await (await fetch(`${srv.base}/mcp`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) })).json();
  const text = r.result?.content?.[0]?.text || '';
  if (r.result?.isError) return { error: text };
  try { return JSON.parse(text); } catch { return { text }; }
};
before(async () => {
  srv = await startServer({ APP_URL: 'https://app.example.in' });
  api = srv.api;
  T = (await register(api)).token;
  tok = (await api('/hive/tokens', 'POST', { name: 'test' }, T)).data.token;
  f = (await api('/templates/coding/use', 'POST', {}, T)).data;
  await api(`/funnels/${f.id}`, 'PUT', { published: true }, T);
  w = (await api('/templates/w-ai/use', 'POST', {}, T)).data;
});
after(() => srv.stop());

test('the new tools are listed', async () => {
  const r = await (await fetch(`${srv.base}/mcp`, { method: 'POST', headers: { authorization: `Bearer ${tok}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) })).json();
  const names = r.result.tools.map((t) => t.name);
  for (const n of ['configure_checkout', 'create_product', 'list_products', 'get_sales', 'configure_calendar', 'list_bookings', 'configure_webinar', 'find_contacts', 'tag_contacts', 'draft_broadcast', 'send_broadcast', 'list_clients', 'copy_funnel_to_client', 'update_business']) assert.ok(names.includes(n), n);
});

test('selling: a product, then a USD membership checkout; a ₹ payment plan with COD', async () => {
  const p = await call('create_product', { name: 'Coaching Vault', lessons: [{ title: 'Welcome', section: 'Start' }, { title: 'Week 1', section: 'Start', dripDays: 7 }] });
  assert.equal(p.lessons, 2);
  const usd = await call('configure_checkout', { funnelId: f.id, price: 49, currency: '$', billing: 'monthly', productId: p.id });
  assert.deepEqual([usd.currency, usd.billing, usd.product], ['$', 'monthly', p.id]);
  assert.match((await call('configure_checkout', { funnelId: f.id, cod: true })).error, /₹/, 'no COD on a $ checkout');
  const inr = await call('configure_checkout', { funnelId: f.id, currency: '₹', billing: 'one-time', price: 29999, installments: { count: 3, amount: 10999 }, cod: true, shipping: true });
  assert.equal(inr.plan, '3 × 10999');
  const chk = (await api(`/funnels/${f.id}`, 'GET', null, T)).data.steps.find((s) => s.type === 'checkout').blocks.find((b) => b.type === 'checkout').props;
  assert.deepEqual([chk.planEnabled, chk.planCount, chk.cod, chk.shipping, chk.billing], [true, 3, true, 'address', '']);
  assert.match((await call('configure_checkout', { funnelId: f.id, currency: 'BTC' })).error, /currency/);
});

test('calls and webinars with time zones', async () => {
  const c = await call('configure_calendar', { name: 'Discovery call', duration: 45, price: 999, timezone: 'Europe/London', hours: { mon: [['09:00', '12:00']], tue: [], wed: [], thu: [], fri: [], sat: [], sun: [] } });
  assert.deepEqual([c.name, c.duration, c.price, c.timezone], ['Discovery call', 45, 999, 'Europe/London']);
  await api(`/public/${w.slug}/sessions`); // the registration page creates its webinar
  const web = await call('configure_webinar', { funnelId: w.id, timezone: 'America/New_York', schedule: { type: 'weekly', days: ['wed'], times: ['20:00'] }, joinUrl: 'https://zoom.us/j/1' });
  assert.equal(web.timezone, 'America/New_York');
  assert.ok(web.next && new Date(web.next).toLocaleString('en-US', { timeZone: 'America/New_York', weekday: 'short', hour: 'numeric', hour12: false }) === 'Wed, 20');
});

test('contacts, tags and a broadcast that stays a draft', async () => {
  await api(`/public/${f.slug}/lead`, 'POST', { stepId: f.steps[0].id, email: 'priya@x.in', name: 'Priya', consent: true });
  await api(`/public/${f.slug}/lead`, 'POST', { stepId: f.steps[0].id, email: 'ravi@x.in', name: 'Ravi' });
  const found = await call('find_contacts', { query: 'priya' });
  assert.equal(found.count, 1);
  await call('tag_contacts', { keys: ['priya@x.in'], tag: 'vip' });
  assert.equal((await call('find_contacts', { tag: 'vip' })).count, 1);
  const d = await call('draft_broadcast', { channel: 'email', name: 'VIP offer', subject: 'For you, {{first_name}}', body: 'Hi {{first_name}}…', segment: { tags: ['vip'] } });
  assert.equal(d.reach, 1);
  const b = (await api(`/broadcasts/${d.id}`, 'GET', null, T)).data;
  assert.equal(b.status, 'draft', 'drafting never sends');
  const sales = await call('get_sales', { days: 30 });
  assert.equal(typeof sales.totals.leads, 'number');
});

test('business settings; a viewer’s Hive can’t change what a viewer can’t', async () => {
  const r = await call('update_business', { timezone: 'Asia/Dubai', consentBanner: true });
  assert.equal(r.timezone, 'Asia/Dubai');
  assert.equal((await api('/privacy', 'GET', null, T)).data.banner, true);
  // a viewer on the team chatting with Hive in the owner's workspace
  const v = await register(api);
  const inv = (await api('/team/invite', 'POST', { email: v.email, role: 'viewer' }, T)).data;
  const ws = (await api('/team/accept', 'POST', { token: inv.token }, v.token)).data.token;
  const res = await fetch(`${srv.base}/api/hive/chat`, { method: 'POST', headers: { authorization: `Bearer ${ws}`, 'content-type': 'application/json' }, body: JSON.stringify({ message: 'change my time zone to London' }) });
  assert.ok([403, 200, 503, 400].includes(res.status), `chat answered ${res.status}`);
  assert.equal((await api('/settings', 'GET', null, T)).data.timezone, 'Asia/Dubai', 'unchanged');
});
