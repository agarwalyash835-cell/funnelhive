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
