// Teams: invitations by email, accepting with the matching account, switching workspaces, what each role
// may do (checked on the server for every request), and removing someone cutting their access at once.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, register } from './helpers.mjs';

let srv, api, owner, f;
const invite = async (email, role) => (await api('/team/invite', 'POST', { email, role }, owner.token)).data;
// a new person accepts their invitation → a session inside the owner's workspace
async function join(role) {
  const me = await register(api);
  const inv = await invite(me.email, role);
  const r = await api('/team/accept', 'POST', { token: inv.token }, me.token);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return { ...me, ws: r.data.token, mid: inv.id };
}

before(async () => {
  srv = await startServer();
  api = srv.api;
  owner = await register(api);
  await api('/settings', 'PUT', { businessName: 'Chai Studio' }, owner.token);
  f = (await api('/templates/yoga/use', 'POST', {}, owner.token)).data;
  await api(`/funnels/${f.id}`, 'PUT', { published: true }, owner.token);
});
after(() => srv.stop());

test('invitations: checked, one per email, shown before login, and only the invited email can accept', async () => {
  assert.equal((await api('/team/invite', 'POST', { email: 'bad', role: 'admin' }, owner.token)).status, 400);
  assert.equal((await api('/team/invite', 'POST', { email: 'a@x.in', role: 'boss' }, owner.token)).status, 400);
  const inv = await invite('neha@x.in', 'marketer');
  assert.equal(inv.status, 'invited');
  assert.equal((await api('/team/invite', 'POST', { email: 'NEHA@x.in', role: 'viewer' }, owner.token)).status, 409);
  const info = (await api(`/team/invitation?token=${inv.token}`)).data;
  assert.equal(info.business, 'Chai Studio');
  assert.equal(info.hasAccount, false);
  assert.equal((await api('/team/invitation?token=nope.nope')).status, 404);
  const stranger = await register(api);
  assert.equal((await api('/team/accept', 'POST', { token: inv.token }, stranger.token)).status, 403, 'someone else can’t take the seat');
  const neha = await register(api, 'neha@x.in');
  const ok = await api('/team/accept', 'POST', { token: inv.token }, neha.token);
  assert.equal(ok.status, 200);
  assert.equal((await api('/team/accept', 'POST', { token: inv.token }, neha.token)).status, 404, 'single use');
  // the workspace shows the owner's funnels; /me says who is acting and as what
  const me = (await api('/me', 'GET', null, ok.data.token)).data;
  assert.equal(me.email, 'neha@x.in');
  assert.deepEqual([me.workspace.name, me.workspace.role], ['Chai Studio', 'marketer']);
  assert.ok((await api('/funnels', 'GET', null, ok.data.token)).data.some((x) => x.id === f.id));
  assert.equal((await api('/funnels', 'GET', null, neha.token)).data.length, 0, 'their own workspace is still their own');
  const ws = (await api('/team/workspaces', 'GET', null, neha.token)).data;
  assert.deepEqual(ws.teams.map((t) => [t.name, t.role]), [['Chai Studio', 'marketer']]);
  const back = (await api('/team/switch', 'POST', { ownerId: null }, ok.data.token)).data;
  assert.equal((await api('/me', 'GET', null, back.token)).data.workspace, null);
  assert.equal((await api('/team/switch', 'POST', { ownerId: stranger.token ? 'someone-else' : '' }, neha.token)).status, 403);
});

test('marketer: builds funnels and automations, can’t touch settings, money, team or billing', async () => {
  const m = await join('marketer');
  assert.equal((await api(`/funnels/${f.id}`, 'PUT', { name: 'Renamed by marketer' }, m.ws)).status, 200);
  assert.equal((await api('/automations', 'POST', { name: 'x', trigger: { type: 'lead' }, steps: [] }, m.ws)).status, 200);
  assert.equal((await api('/orders', 'GET', null, m.ws)).status, 200, 'can read orders');
  for (const [method, path, body] of [['PUT', '/settings', { businessName: 'Hacked' }], ['GET', '/settings'], ['PUT', '/channels/razorpay', {}], ['POST', '/orders/x/refund', {}], ['POST', '/team/invite', { email: 'z@x.in', role: 'admin' }], ['GET', '/billing'], ['POST', '/account/delete', {}], ['GET', '/account/export'], ['POST', '/auth/change-password', {}], ['POST', '/hive/tokens', {}], ['GET', '/admin/overview']]) {
    assert.equal((await api(path, method, body, m.ws)).status, 403, `${method} ${path}`);
    // a different spelling of the same path must not slip past the role check
    const odd = path.replace(/^\/(\w)/, (_, ch) => `/${ch.toUpperCase()}`);
    assert.ok([403, 404].includes((await api(odd, method, body, m.ws)).status), `${method} ${odd}`);
  }
  assert.equal((await api('/me', 'GET', null, owner.token)).data.billing.status !== undefined, true);
});

test('sales: contacts and shipping yes, funnels and refunds no; viewer: read-only', async () => {
  const s = await join('sales');
  const lead = await api(`/public/${f.slug}/lead`, 'POST', { stepId: f.steps[0].id, email: 'buyer@x.in', name: 'Buyer' });
  assert.equal(lead.status, 200);
  assert.equal((await api(`/contacts/${encodeURIComponent('buyer@x.in')}`, 'PATCH', { tags: ['hot'] }, s.ws)).status, 200);
  assert.equal((await api(`/funnels/${f.id}`, 'PUT', { name: 'nope' }, s.ws)).status, 403);
  assert.equal((await api('/ai/chat', 'POST', { funnelId: f.id, message: 'hi' }, s.ws)).status, 403);
  assert.equal((await api('/orders/x/refund', 'POST', {}, s.ws)).status, 403);
  assert.equal((await api('/orders/x/fulfil', 'POST', { status: 'shipped' }, s.ws)).status, 404, 'allowed through to the route');
  const v = await join('viewer');
  assert.equal((await api('/analytics/overview', 'GET', null, v.ws)).status, 200);
  assert.equal((await api('/funnels', 'GET', null, v.ws)).status, 200);
  assert.equal((await api('/funnels', 'POST', { name: 'x' }, v.ws)).status, 403);
  assert.equal((await api(`/contacts/${encodeURIComponent('buyer@x.in')}`, 'PATCH', { tags: [] }, v.ws)).status, 403);
  assert.equal((await api('/channels', 'GET', null, v.ws)).status, 200, 'what’s connected, no secrets');
  assert.equal((await api('/webhooks/deliveries', 'GET', null, v.ws)).status, 403);
});

test('admins manage almost everything but not billing or the team; removing someone cuts access at once', async () => {
  const a = await join('admin');
  assert.equal((await api('/settings', 'PUT', { supportWhatsapp: '919800000000' }, a.ws)).status, 200);
  assert.equal((await api('/team/members', 'GET', null, a.ws)).status, 200);
  assert.equal((await api('/team/invite', 'POST', { email: 'q@x.in', role: 'viewer' }, a.ws)).status, 403);
  const made = await api('/keys', 'POST', { name: 'Admin’s Zapier' }, a.ws);
  assert.equal(made.status, 200, JSON.stringify(made.data));
  const key = made.data.token;
  assert.equal((await fetch(`${srv.base}/api/v1/me`, { headers: { 'x-api-key': key } })).status, 200, 'the key works while they’re on the team');
  assert.equal((await api('/billing/cancel', 'POST', {}, a.ws)).status, 403);
  const list = (await api('/team/members', 'GET', null, owner.token)).data;
  assert.ok(list.members.length >= 4);
  // change a role, then remove
  assert.equal((await api(`/team/members/${a.mid}`, 'PUT', { role: 'viewer' }, owner.token)).data.role, 'viewer');
  assert.equal((await api('/settings', 'PUT', { supportWhatsapp: '' }, a.ws)).status, 403, 'the new role applies to the open session');
  assert.equal((await api(`/team/members/${a.mid}`, 'DELETE', null, owner.token)).status, 200);
  assert.equal((await api('/funnels', 'GET', null, a.ws)).status, 401);
  assert.equal((await api('/funnels', 'GET', null, a.token)).status, 200, 'their own account still works');
  assert.equal((await fetch(`${srv.base}/api/v1/me`, { headers: { 'x-api-key': key } })).status, 401, 'the API key they made stops working');
  // another owner can't edit this team
  const other = await register(api);
  const m = list.members.find((x) => x.role === 'sales');
  assert.equal((await api(`/team/members/${m.id}`, 'DELETE', null, other.token)).status, 404);
});

test('a member limited to some funnels sees and works on only those, and nothing account-wide', async () => {
  const g = (await api('/templates/coding/use', 'POST', {}, owner.token)).data; // a second funnel they mustn't see
  const other = await register(api);
  const theirs = (await api('/templates/yoga/use', 'POST', {}, other.token)).data;
  // owners pick funnels from their own account only
  const me = await register(api);
  assert.equal((await api('/team/invite', 'POST', { email: me.email, role: 'marketer', funnelIds: [theirs.id] }, owner.token)).status, 400);
  assert.equal((await api('/team/invite', 'POST', { email: me.email, role: 'marketer', funnelIds: 'all' }, owner.token)).status, 400);
  const inv = (await api('/team/invite', 'POST', { email: me.email, role: 'marketer', funnelIds: [f.id] }, owner.token)).data;
  assert.deepEqual(inv.funnelIds, [f.id]);
  const d = (await api('/team/accept', 'POST', { token: inv.token }, me.token)).data;
  const ws = d.token;
  assert.deepEqual((await api('/me', 'GET', null, ws)).data.workspace.funnelIds, [f.id]);
  // lists show their funnel only
  assert.deepEqual((await api('/funnels', 'GET', null, ws)).data.map((x) => x.id), [f.id]);
  const ov = await api('/analytics/overview', 'GET', null, ws);
  assert.equal(ov.status, 200, JSON.stringify(ov.data));
  assert.deepEqual(ov.data.funnels.map((x) => x.id), [f.id]);
  assert.equal(ov.data.series.length, 30);
  assert.ok(ov.data.recentOrders.every((o) => o.funnelId === f.id));
  // their funnel: open, edit, revisions, analytics (its own leads and orders), tracking
  for (const p of ['', '/revisions', '/analytics', '/tracking', '/legal-check']) assert.equal((await api(`/funnels/${f.id}${p}`, 'GET', null, ws)).status, 200, `GET ${p}`);
  assert.equal((await api(`/funnels/${f.id}`, 'PUT', { name: 'Yoga by the designer' }, ws)).status, 200);
  assert.equal((await api('/uploads', 'POST', { type: 'image/png', data: '' }, ws)).status, 400, 'uploading images reaches the route');
  // any other funnel: 403, whatever the route
  for (const [method, p, body] of [['GET', `/funnels/${g.id}`], ['PUT', `/funnels/${g.id}`, { name: 'x' }], ['GET', `/funnels/${g.id}/revisions`], ['GET', `/funnels/${g.id}/analytics`], ['GET', `/funnels/${g.id}/tracking`], ['PUT', `/funnels/${g.id}/tracking`, {}], ['DELETE', `/funnels/${g.id}`], ['POST', '/ai/chat', { funnelId: g.id, message: 'hi' }], ['POST', '/domains', { domain: 'x.example.in', funnelId: g.id }]]) {
    assert.equal((await api(p, method, body, ws)).status, 403, `${method} ${p}`);
  }
  // new funnels and copies would sit outside their list; account-wide data is closed
  for (const [method, p, body] of [['POST', '/funnels', { name: 'x' }], ['POST', '/templates/yoga/use', {}], ['POST', `/funnels/${f.id}/duplicate`, {}], ['POST', '/funnels/import', {}], ['GET', '/contacts'], ['GET', '/orders'], ['GET', '/automations'], ['GET', '/broadcasts'], ['POST', '/products', { name: 'x' }], ['POST', '/hive/chat', { message: 'hi' }], ['GET', '/hive/threads'], ['GET', '/reports/sales']]) {
    assert.equal((await api(p, method, body, ws)).status, 403, `${method} ${p}`);
  }
  assert.equal((await api('/products', 'GET', null, ws)).status, 200, 'the product list for checkout blocks');
  // the owner widens it to every funnel, and the open session follows at once
  assert.equal((await api(`/team/members/${inv.id}`, 'PUT', { funnelIds: [f.id, g.id] }, owner.token)).data.role, 'marketer');
  assert.equal((await api(`/funnels/${g.id}`, 'GET', null, ws)).status, 200);
  assert.equal((await api(`/team/members/${inv.id}`, 'PUT', { funnelIds: null }, owner.token)).data.funnelIds, null);
  assert.equal((await api('/contacts', 'GET', null, ws)).status, 200);
  assert.equal((await api('/funnels', 'GET', null, ws)).data.length >= 2, true);
  assert.equal((await api(`/team/members/${inv.id}`, 'PUT', { funnelIds: [g.id] }, owner.token)).status, 200);
  assert.equal((await api(`/funnels/${f.id}`, 'GET', null, ws)).status, 403);
  assert.equal((await api(`/team/members/${inv.id}`, 'PUT', { role: 'boss' }, owner.token)).status, 400);
});

test('Hive AI invites a member for some funnels only', async () => {
  const tok = (await api('/hive/tokens', 'POST', { name: 'test' }, owner.token)).data.token;
  const call = async (name, args) => {
    const r = await (await fetch(`${srv.base}/mcp`, { method: 'POST', headers: { authorization: `Bearer ${tok}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) })).json();
    const text = r.result?.content?.[0]?.text || '';
    return r.result?.isError ? { error: text } : JSON.parse(text);
  };
  const r = await call('invite_team_member', { email: 'designer@x.in', role: 'marketer', funnelIds: [f.id] });
  assert.equal(r.funnels, 1, JSON.stringify(r));
  const m = (await call('list_team', {})).members.find((x) => x.email === 'designer@x.in');
  assert.deepEqual(m.funnelIds, [f.id]);
  assert.match((await call('invite_team_member', { email: 'd2@x.in', role: 'marketer', funnelIds: ['nope'] })).error, /funnels/i);
});
