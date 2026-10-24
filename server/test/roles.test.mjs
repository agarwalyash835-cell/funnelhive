// Custom team roles: the owner names a role and picks none / view / edit per area; members with it get exactly
// that (deny by default for anything no area covers), changes apply on the next request, deleting a role in use
// needs a replacement, and the built-in roles keep their old rules.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, register } from './helpers.mjs';
import { allows, customAllows, AREAS, PRESETS } from '../team.js';

let srv, api, owner, f, writer;
const invite = async (email, role, token = owner.token) => api('/team/invite', 'POST', { email, role }, token);
async function join(role, token = owner.token) {
  const me = await register(api);
  const inv = await invite(me.email, role, token);
  assert.equal(inv.status, 200, JSON.stringify(inv.data));
  const r = await api('/team/accept', 'POST', { token: inv.data.token }, me.token);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return { ...me, ws: r.data.token, mid: inv.data.id };
}
const none = Object.fromEntries(AREAS.map((a) => [a.key, 'none']));

before(async () => {
  srv = await startServer();
  api = srv.api;
  owner = await register(api);
  f = (await api('/templates/yoga/use', 'POST', {}, owner.token)).data;
  await api(`/funnels/${f.id}`, 'PUT', { published: true }, owner.token);
  await api(`/public/${f.slug}/lead`, 'POST', { stepId: f.steps[0].id, email: 'buyer@x.in', name: 'Buyer' });
});
after(() => srv.stop());

test('roles list: built-in presets marked, areas described; checked input', async () => {
  const d = (await api('/team/roles', 'GET', null, owner.token)).data;
  assert.deepEqual(d.roles.filter((r) => r.builtIn).map((r) => r.id), ['admin', 'marketer', 'sales', 'viewer']);
  assert.equal(d.areas.length, AREAS.length);
  assert.ok(d.areas.find((a) => a.key === 'dashboard').levels.join() === 'none,view');
  assert.equal(d.canManage, true);
  assert.equal((await api('/team/roles', 'POST', { name: '', perms: {} }, owner.token)).status, 400);
  assert.equal((await api('/team/roles', 'POST', { name: 'X', perms: { crm: 'admin' } }, owner.token)).status, 400);
  assert.equal((await api('/team/roles', 'POST', { name: 'X', perms: { dashboard: 'edit' } }, owner.token)).status, 400, 'dashboard is read-only');
  assert.equal((await api('/team/roles', 'POST', { name: 'X', perms: { nope: 'view' } }, owner.token)).status, 400);
  assert.equal((await api('/team/roles', 'POST', { name: 'marketer', perms: {} }, owner.token)).status, 409, 'not a built-in name');
  assert.equal((await api('/team/roles/marketer', 'PUT', { name: 'Mine' }, owner.token)).status, 404, 'built-ins are read-only');
});

test('a custom role: view contacts, edit funnels, nothing else', async () => {
  const r = await api('/team/roles', 'POST', { name: 'Content writer', perms: { ...none, crm: 'view', funnels: 'edit', dashboard: 'view' } }, owner.token);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  writer = { role: r.data };
  assert.equal(r.data.builtIn, false);
  assert.equal((await api('/team/roles', 'POST', { name: 'content WRITER', perms: {} }, owner.token)).status, 409);
  const m = await join(r.data.id);
  Object.assign(writer, m);
  const me = (await api('/me', 'GET', null, m.ws)).data;
  assert.equal(me.workspace.roleName, 'Content writer');
  assert.equal(me.perms.crm, 'view');
  assert.equal(me.perms.settings, 'none');
  // contacts: view, not edit
  assert.equal((await api('/contacts', 'GET', null, m.ws)).status, 200);
  assert.equal((await api(`/contacts/${encodeURIComponent('buyer@x.in')}`, 'PATCH', { tags: ['hot'] }, m.ws)).status, 403);
  // funnels: edit
  assert.equal((await api(`/funnels/${f.id}`, 'PUT', { name: 'By the writer' }, m.ws)).status, 200);
  assert.equal((await api('/analytics/overview', 'GET', null, m.ws)).status, 200);
  // the rest: closed
  for (const [method, path, body] of [['GET', '/vault/secrets'], ['GET', '/vault/files'], ['GET', '/settings'], ['PUT', '/settings', { businessName: 'x' }], ['GET', '/billing'], ['POST', '/account/delete', { confirm: 'DELETE' }], ['GET', '/account/export'], ['GET', '/orders'], ['POST', '/team/invite', { email: 'z@x.in', role: 'viewer' }], ['GET', '/team/members'], ['POST', '/team/roles', { name: 'Boss', perms: {} }], ['POST', '/keys', {}], ['GET', '/admin/overview'], ['POST', '/hive/chat', { message: 'hi' }]]) {
    assert.equal((await api(path, method, body, m.ws)).status, 403, `${method} ${path}`);
  }
  // deny by default: a path no area covers (a built-in viewer could read it)
  assert.equal((await api('/agency', 'GET', null, m.ws)).status, 403);
  assert.equal(customAllows({ ...none, funnels: 'edit' }, 'GET', '/api/something-new'), false);
  assert.equal(customAllows(PRESETS.admin, 'POST', '/api/keys'), false, 'API keys: owners and admins');
  assert.equal(customAllows(PRESETS.admin, 'DELETE', '/api/contacts/a@b.in'), false, 'erasing a contact: owners and admins');
  assert.equal(customAllows(PRESETS.admin, 'GET', '/api/billing'), false);
  // always fine: who am I, workspaces, notifications
  assert.equal((await api('/team/workspaces', 'GET', null, m.ws)).data.teams[0].roleName, 'Content writer');
  assert.equal((await api('/notifications', 'GET', null, m.ws)).status, 200);
});

test('editing a role takes effect on the next request', async () => {
  const ws = writer.ws;
  assert.equal((await api(`/contacts/${encodeURIComponent('buyer@x.in')}`, 'PATCH', { tags: ['warm'] }, ws)).status, 403);
  const up = await api(`/team/roles/${writer.role.id}`, 'PUT', { perms: { ...none, crm: 'edit', funnels: 'view' } }, owner.token);
  assert.equal(up.status, 200, JSON.stringify(up.data));
  assert.equal(up.data.members, 1);
  assert.equal((await api(`/contacts/${encodeURIComponent('buyer@x.in')}`, 'PATCH', { tags: ['warm'] }, ws)).status, 200);
  assert.equal((await api(`/funnels/${f.id}`, 'PUT', { name: 'Again' }, ws)).status, 403);
  assert.equal((await api(`/funnels/${f.id}`, 'GET', null, ws)).status, 200);
  assert.equal((await api('/analytics/overview', 'GET', null, ws)).status, 403, 'dashboard dropped');
  assert.equal((await api(`/contacts/${encodeURIComponent('buyer@x.in')}`, 'DELETE', null, ws)).status, 403, 'erasing stays with owners and admins');
});

test('vault secrets and team management through a custom role, never beyond your own access', async () => {
  const lead = await api('/team/roles', 'POST', { name: 'Team lead', perms: { ...none, crm: 'edit', team: 'edit', secrets: 'view' } }, owner.token);
  const m = await join(lead.data.id);
  assert.equal((await api('/vault/secrets', 'GET', null, m.ws)).status, 200);
  assert.equal((await api('/vault/secrets', 'POST', { kind: 'note', title: 'x', notes: 'y' }, m.ws)).status, 403, 'view only');
  // the team: sees it, invites with roles within their own access
  const tm = (await api('/team/members', 'GET', null, m.ws)).data;
  assert.equal(tm.canManage, true);
  assert.equal((await api('/team/invite', 'POST', { email: 'tele@x.in', role: 'admin' }, m.ws)).status, 403);
  assert.equal((await api('/team/invite', 'POST', { email: 'tele@x.in', role: 'marketer' }, m.ws)).status, 403);
  const tele = await api('/team/roles', 'POST', { name: 'Telecaller', perms: { ...none, crm: 'edit' } }, m.ws);
  assert.equal(tele.status, 200, JSON.stringify(tele.data));
  assert.equal((await api('/team/roles', 'POST', { name: 'Big', perms: { ...none, settings: 'edit' } }, m.ws)).status, 403);
  assert.equal((await api(`/team/roles/${lead.data.id}`, 'PUT', { perms: { ...none, crm: 'edit', team: 'edit', secrets: 'edit' } }, m.ws)).status, 403, 'can’t raise their own role');
  assert.equal((await api('/team/invite', 'POST', { email: 'tele@x.in', role: tele.data.id }, m.ws)).status, 200);
  // can't touch someone with more access (the writer has funnels: view)
  assert.equal((await api(`/team/members/${writer.mid}`, 'DELETE', null, m.ws)).status, 403);
  assert.equal((await api('/billing', 'GET', null, m.ws)).status, 403);
  assert.equal((await api('/account/delete', 'POST', { confirm: 'DELETE' }, m.ws)).status, 403);
});

test('deleting a role in use needs a replacement', async () => {
  const del = await api(`/team/roles/${writer.role.id}`, 'DELETE', null, owner.token);
  assert.equal(del.status, 409);
  assert.equal(del.data.members, 1);
  assert.equal((await api(`/team/roles/${writer.role.id}`, 'DELETE', { replaceWith: writer.role.id }, owner.token)).status, 409);
  assert.equal((await api(`/team/roles/${writer.role.id}`, 'DELETE', { replaceWith: 'boss' }, owner.token)).status, 409);
  const ok = await api(`/team/roles/${writer.role.id}`, 'DELETE', { replaceWith: 'viewer' }, owner.token);
  assert.equal(ok.status, 200);
  assert.equal(ok.data.moved, 1);
  const me = (await api('/me', 'GET', null, writer.ws)).data;
  assert.equal(me.workspace.role, 'viewer');
  assert.equal((await api('/orders', 'GET', null, writer.ws)).status, 200, 'a viewer reads orders');
  // an unused role just goes
  const spare = await api('/team/roles', 'POST', { name: 'Spare', perms: none }, owner.token);
  assert.equal((await api(`/team/roles/${spare.data.id}`, 'DELETE', null, owner.token)).status, 200);
  assert.ok(!(await api('/team/roles', 'GET', null, owner.token)).data.roles.some((r) => r.id === spare.data.id));
});

test('another account can’t see, use or change your roles', async () => {
  const mine = (await api('/team/roles', 'POST', { name: 'Private', perms: { ...none, crm: 'view' } }, owner.token)).data;
  const other = await register(api);
  assert.ok(!(await api('/team/roles', 'GET', null, other.token)).data.roles.some((r) => r.id === mine.id));
  assert.equal((await api(`/team/roles/${mine.id}`, 'PUT', { name: 'Stolen' }, other.token)).status, 404);
  assert.equal((await api(`/team/roles/${mine.id}`, 'DELETE', null, other.token)).status, 404);
  assert.equal((await api('/team/invite', 'POST', { email: 'q@x.in', role: mine.id }, other.token)).status, 400);
});

test('built-in roles: enforcement unchanged; admins read roles but can’t change them', async () => {
  // the old rules, spot-checked through the same function
  assert.equal(allows('marketer', 'PUT', '/api/funnels/x'), true);
  assert.equal(allows('marketer', 'GET', '/api/settings'), false);
  assert.equal(allows('sales', 'POST', '/api/orders/x/refund'), false);
  assert.equal(allows('sales', 'POST', '/api/orders/x/fulfil'), true);
  assert.equal(allows('viewer', 'GET', '/api/agency'), true);
  assert.equal(allows('viewer', 'POST', '/api/contacts'), false);
  assert.equal(allows('admin', 'GET', '/api/team/members'), true);
  assert.equal(allows('admin', 'POST', '/api/team/invite'), false);
  assert.equal(allows('admin', 'GET', '/api/team/roles'), true);
  assert.equal(allows('admin', 'POST', '/api/team/roles'), false);
  assert.equal(allows('agency', 'POST', '/api/team/roles'), true);
  assert.equal(allows('role_gone', 'GET', '/api/funnels'), false, 'a custom role with no permissions gets nothing');
  const a = await join('admin');
  assert.equal((await api('/team/roles', 'GET', null, a.ws)).status, 200);
  assert.equal((await api('/team/roles', 'POST', { name: 'Y', perms: none }, a.ws)).status, 403);
  const me = (await api('/me', 'GET', null, a.ws)).data;
  assert.equal(me.workspace.roleName, 'Admin');
  assert.equal(me.perms.settings, 'edit');
  assert.equal((await api('/me', 'GET', null, owner.token)).data.perms, null, 'owners have no perms map');
});
