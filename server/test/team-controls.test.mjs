// Team controls: a custom role's risky actions (refunds, deleting, exporting, publishing, sending) can be switched off
// one by one; the owner can require 2-step verification for the whole team; and the owner can hand the account to a
// team member (the logins swap, the data stays, the old owner stays on as an Admin). Plus buyers' DPDP data requests.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, register, enable2fa, totpCode } from './helpers.mjs';

let srv, api, owner, f;
const AREAS_EDIT = { funnels: 'edit', orders: 'edit', crm: 'edit', dashboard: 'view' };
const verify = async (email) => { const m = srv.log().match(new RegExp(`To: ${email.replace(/[.@]/g, (c) => `\\${c}`)}[\\s\\S]*?/verify\\?token=([a-f0-9.]+)`)); assert.ok(m, `verification link for ${email}`); await api('/auth/verify', 'POST', { token: m[1] }); };
async function join(role, me) {
  me ||= await register(api);
  const inv = (await api('/team/invite', 'POST', { email: me.email, role }, owner.token)).data;
  const r = await api('/team/accept', 'POST', { token: inv.token }, me.token);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return { ...me, ws: r.data.token, mid: inv.id };
}
before(async () => {
  srv = await startServer();
  api = srv.api;
  owner = await register(api, 'owner@controls.test');
  await api('/settings', 'PUT', { businessName: 'Chai Studio' }, owner.token);
  f = (await api('/templates/yoga/use', 'POST', {}, owner.token)).data;
});
after(() => srv.stop());

test('a custom role’s risky actions can be switched off one by one; older roles keep them all', async () => {
  const role = (await api('/team/roles', 'POST', { name: 'Careful editor', perms: AREAS_EDIT, actions: { refund: false, delete: false, export: false, publish: false, send: true } }, owner.token)).data;
  assert.deepEqual(role.actions, { refund: false, delete: false, export: false, publish: false, send: true });
  assert.ok((await api('/team/roles', 'GET', null, owner.token)).data.actions.some((a) => a.key === 'refund'));
  const m = await join(role.id);
  // editing is fine; publishing, exporting, deleting and refunding aren't
  assert.equal((await api(`/funnels/${f.id}`, 'PUT', { name: 'Edited' }, m.ws)).status, 200);
  const pub = await api(`/funnels/${f.id}`, 'PUT', { published: true }, m.ws);
  assert.equal(pub.status, 403); assert.match(pub.data.error, /publish/);
  assert.equal((await api(`/funnels/${f.id}`, 'PUT', { name: 'Again', published: false }, m.ws)).status, 200, 'sending the unchanged state is fine');
  assert.equal((await api(`/funnels/${f.id}/export`, 'GET', null, m.ws)).status, 403);
  assert.equal((await api(`/funnels/${f.id}`, 'DELETE', null, m.ws)).status, 403);
  assert.equal((await api('/orders/nope/refund', 'POST', {}, m.ws)).status, 403);
  assert.equal((await api('/me', 'GET', null, m.ws)).data.workspace.actions.refund, false);
  // switching an action back on takes effect on the next request
  await api(`/team/roles/${role.id}`, 'PUT', { actions: { ...role.actions, export: true, publish: true } }, owner.token);
  assert.equal((await api(`/funnels/${f.id}/export`, 'GET', null, m.ws)).status, 200);
  assert.equal((await api(`/funnels/${f.id}`, 'PUT', { published: true }, m.ws)).status, 200);
  // a role made before actions existed (no actions saved) keeps every action
  const old = (await api('/team/roles', 'POST', { name: 'Old style', perms: AREAS_EDIT }, owner.token)).data;
  assert.ok(Object.values(old.actions).every(Boolean));
  // a manager can't give out an action they don't have
  const mgr = (await api('/team/roles', 'POST', { name: 'Team lead', perms: { ...AREAS_EDIT, team: 'edit' }, actions: { refund: false } }, owner.token)).data;
  const lead = await join(mgr.id);
  assert.equal((await api('/team/roles', 'POST', { name: 'Refunder', perms: { orders: 'edit' }, actions: { refund: true } }, lead.ws)).status, 403);
  assert.equal((await api('/team/roles', 'POST', { name: 'No refunds', perms: { orders: 'edit' }, actions: { refund: false } }, lead.ws)).status, 200);
});

test('the owner can require 2-step verification for the whole team', async () => {
  const m = await join('marketer');
  assert.equal((await api('/team/security', 'PUT', { require2fa: true }, owner.token)).status, 400, 'the owner needs it first');
  ({ token: owner.token, secret: owner.secret } = await enable2fa(api, owner.token));
  assert.equal((await api('/team/security', 'PUT', { require2fa: true }, m.ws)).status, 403, 'members can’t change it');
  const on = await api('/team/security', 'PUT', { require2fa: true }, owner.token);
  assert.equal(on.status, 200); assert.ok(on.data.without >= 1);
  const blocked = await api('/funnels', 'GET', null, m.ws);
  assert.equal(blocked.status, 403); assert.equal(blocked.data.code, 'TEAM_2FA_REQUIRED');
  assert.equal((await api('/me', 'GET', null, m.ws)).status, 200, 'who-am-I still works');
  const list = (await api('/team/members', 'GET', null, owner.token)).data;
  assert.equal(list.require2fa, true);
  assert.equal(list.members.find((x) => x.email === m.email).twoFactor, false);
  // they turn it on in their own account; then the workspace opens again
  await enable2fa(api, m.token);
  const back = (await api('/team/switch', 'POST', { ownerId: (await api('/me', 'GET', null, owner.token)).data.id }, m.token)).data;
  assert.equal((await api('/funnels', 'GET', null, back.token)).status, 200);
  await api('/team/security', 'PUT', { require2fa: false }, owner.token);
});

test('handing the account to a team member: the logins swap, the data stays, the old owner stays as an Admin', async () => {
  const busy = await register(api, 'busy@controls.test'); await verify('busy@controls.test');
  await api('/templates/yoga/use', 'POST', {}, busy.token); // runs a business of their own
  const busyM = await join('admin', busy);
  const heir = await register(api, 'heir@controls.test');
  const h = await join('marketer', heir);
  const list = (await api('/team/members', 'GET', null, owner.token)).data.members;
  assert.equal(list.find((x) => x.id === busyM.mid).canOwn, false);
  assert.equal(list.find((x) => x.id === h.mid).canOwn, false, 'email not verified yet');
  await verify('heir@controls.test');
  assert.equal((await api('/team/members', 'GET', null, owner.token)).data.members.find((x) => x.id === h.mid).canOwn, true);
  const ownerId = (await api('/me', 'GET', null, owner.token)).data.id;
  // checks: members can't, wrong password, no code, no confirmation, a member with their own business
  assert.equal((await api('/team/transfer', 'POST', { memberId: h.mid, password: 'secret123', confirm: 'TRANSFER' }, h.ws)).status, 403);
  assert.equal((await api('/team/transfer', 'POST', { memberId: busyM.mid, password: 'secret123', confirm: 'TRANSFER' }, owner.token)).status, 400);
  assert.equal((await api('/team/transfer', 'POST', { memberId: h.mid, password: 'secret123' }, owner.token)).status, 400, 'TRANSFER typed');
  assert.equal((await api('/team/transfer', 'POST', { memberId: h.mid, password: 'nope', confirm: 'TRANSFER' }, owner.token)).status, 403);
  assert.equal((await api('/team/transfer', 'POST', { memberId: h.mid, password: 'secret123', confirm: 'TRANSFER' }, owner.token)).data.twoFactorRequired, true);
  const ok = await api('/team/transfer', 'POST', { memberId: h.mid, password: 'secret123', confirm: 'TRANSFER', code: totpCode(owner.secret, 0) }, owner.token);
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  // everyone is signed out
  assert.equal((await api('/me', 'GET', null, owner.token)).status, 401);
  assert.equal((await api('/me', 'GET', null, heir.token)).status, 401);
  // the heir signs in with their own login and lands in the account, with its funnels, as the owner
  const heirIn = (await api('/auth/login', 'POST', { email: 'heir@controls.test', password: 'secret123' })).data;
  const me = (await api('/me', 'GET', null, heirIn.token)).data;
  assert.equal(me.id, ownerId); assert.equal(me.workspace, null);
  assert.ok((await api('/funnels', 'GET', null, heirIn.token)).data.some((x) => x.id === f.id));
  // the old owner signs in with their login (and their 2-step code) and is an Admin on the team
  const oldIn = (await api('/auth/login', 'POST', { email: 'owner@controls.test', password: 'secret123', code: totpCode(owner.secret, 1) })).data;
  assert.ok(oldIn.token, JSON.stringify(oldIn));
  const teams = (await api('/team/workspaces', 'GET', null, oldIn.token)).data.teams;
  assert.deepEqual(teams.map((t) => [t.ownerId, t.role]), [[ownerId, 'admin']]);
  assert.equal((await api('/funnels', 'GET', null, oldIn.token)).data.length, 0, 'their personal account is the empty one');
});

test('a buyer’s data request: confirmed by email, in the seller’s queue with a deadline, erased and closed', async () => {
  const s = await register(api, 'seller@dpdp.test');
  const sid = (await api('/me', 'GET', null, s.token)).data.id;
  await api('/settings', 'PUT', { businessName: 'Ghee Co' }, s.token);
  await api('/contacts', 'POST', { name: 'Meena', email: 'meena@buyer.in' }, s.token);
  const policy = await fetch(`${srv.base}/legal/${sid}/privacy`).then((r) => r.text());
  assert.match(policy, /href="data-request"/);
  assert.match(await fetch(`${srv.base}/legal/${sid}/data-request`).then((r) => r.text()), /Withdraw my consent/);
  const post = (body) => fetch(`${srv.base}/legal/${sid}/data-request`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body) });
  assert.equal((await post({ kind: 'erase', email: 'not-an-email' })).status, 400);
  assert.equal((await post({ kind: 'erase', email: 'meena@buyer.in', name: 'Meena' })).status, 200);
  // nothing in the queue until it's confirmed
  assert.equal((await api('/privacy/requests', 'GET', null, s.token)).data.requests.length, 0);
  const link = srv.log().match(/To: meena@buyer\.in[\s\S]*?(\/legal\/data-request\/confirm\?token=[^\s]+)/);
  assert.ok(link, 'a confirmation email: ' + srv.log().slice(-1500));
  assert.match(await fetch(`${srv.base}${link[1]}`).then((r) => r.text()), /Request confirmed/);
  const q1 = (await api('/privacy/requests', 'GET', null, s.token)).data;
  assert.equal(q1.open, 1);
  const r = q1.requests[0];
  assert.equal(r.kind, 'erase'); assert.ok(r.dueAt - r.confirmedAt >= 29 * 86400000);
  // another seller can't see or act on it
  const x = await register(api);
  assert.equal((await api(`/privacy/requests/${r.id}/erase`, 'POST', {}, x.token)).status, 404);
  assert.equal((await api(`/privacy/requests/${r.id}`, 'PUT', { status: 'done' }, s.token)).status, 400, 'erase first');
  assert.equal((await api(`/privacy/requests/${r.id}/erase`, 'POST', {}, s.token)).status, 200);
  assert.equal((await api('/contacts', 'GET', null, s.token)).data.contacts?.some?.((c) => c.email === 'meena@buyer.in') ?? false, false);
  const mark = srv.log().length;
  assert.equal((await api(`/privacy/requests/${r.id}`, 'PUT', { status: 'done', reply: 'All your data is erased.' }, s.token)).data.request.status, 'done');
  assert.match(srv.log().slice(mark), /To: meena@buyer\.in[\s\S]*?completed[\s\S]*?All your data is erased/);
  // withdrawing consent applies on confirmation
  await api('/contacts', 'POST', { name: 'Ravi', email: 'ravi@buyer.in' }, s.token);
  await post({ kind: 'withdraw', email: 'ravi@buyer.in' });
  const l2 = srv.log().match(/To: ravi@buyer\.in[\s\S]*?(\/legal\/data-request\/confirm\?token=[^\s]+)/);
  await fetch(`${srv.base}${l2[1]}`);
  const c = (await api(`/contacts/${encodeURIComponent('ravi@buyer.in')}`, 'GET', null, s.token)).data;
  assert.equal(c.unsubscribed, true); assert.equal(c.waOptOut, true);
});
