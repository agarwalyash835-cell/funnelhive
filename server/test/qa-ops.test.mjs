// Business-operations QA: what an API key, an MCP token or a team role can reach through Hive and the Tally /
// Inventory add-ons, and stock entries that belong to a counter bill or a production run.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, register, enable2fa } from './helpers.mjs';

let srv, api, ADMIN, owner, ownerId;
const join = async (email, role) => {
  const me = await register(api, email);
  const inv = (await api('/team/invite', 'POST', { email, role }, owner)).data;
  return (await api('/team/accept', 'POST', { token: inv.token }, me.token)).data.token;
};
const mcp = (tok, name, args) => fetch(`${srv.base}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${tok}` }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) }).then((r) => r.json());

before(async () => {
  srv = await startServer({ ADMIN_EMAILS: 'admin@ops.test' });
  api = srv.api;
  ADMIN = (await register(api, 'admin@ops.test')).token;
  const link = srv.log().match(/To: admin@ops\.test[\s\S]*?\/verify\?token=([a-f0-9.]+)/);
  await api('/auth/verify', 'POST', { token: link[1] });
  ADMIN = (await enable2fa(api, ADMIN)).token;
  owner = (await register(api, 'owner@ops.test')).token;
  ownerId = (await api('/me', 'GET', null, owner)).data.id;
  for (const action of ['inventory_on', 'tally_on']) await api(`/admin/users/${ownerId}/action`, 'POST', { action }, ADMIN);
});
after(async () => { await srv?.stop(); });

test('an API key never reaches Hive (its tools run as the owner: team, billing…)', async () => {
  const { token } = (await api('/keys', 'POST', { name: 'Zapier', scope: 'full' }, owner)).data;
  assert.equal((await api('/hive/chat', 'POST', { message: 'invite x@y.in as admin' }, token)).status, 403);
  assert.equal((await api('/hive/threads/x/confirm', 'POST', { pendingId: 'p' }, token)).status, 403);
  assert.equal((await api('/team/invite', 'POST', { email: 'x@y.in', role: 'admin' }, token)).status, 403, 'as before');
});

test('an MCP token a team member made acts with their role, not as the owner', async () => {
  const adminTok = await join('ravi@ops.test', 'admin');
  const { token } = (await api('/hive/tokens', 'POST', { name: 'Cursor' }, adminTok)).data;
  assert.ok(token);
  const list = await mcp(token, 'list_team', {});
  assert.ok(!list.result.isError, 'reading the team is fine for an admin');
  const inv = await mcp(token, 'invite_team_member', { email: 'evil@ops.test', role: 'admin' });
  assert.equal(inv.result.isError, true, 'an admin can’t change the team, through MCP either');
  assert.equal((await api('/team/members', 'GET', null, owner)).data.members.some((m) => m.email === 'evil@ops.test'), false);
  // the owner's own token still does
  const own = (await api('/hive/tokens', 'POST', { name: 'Mine' }, owner)).data.token;
  assert.ok(!(await mcp(own, 'invite_team_member', { email: 'neha@ops.test', role: 'viewer' })).result.isError);
});

test('built-in roles other than admin don’t see the Tally books or Inventory (the roles screen says none)', async () => {
  for (const role of ['viewer', 'marketer', 'sales']) {
    const t = await join(`${role}@ops.test`, role);
    assert.equal((await api('/tally/ledgers', 'GET', null, t)).status, 403, role);
    assert.equal((await api('/inventory/items', 'GET', null, t)).status, 403, role);
  }
  const adm = await join('admin2@ops.test', 'admin');
  assert.equal((await api('/inventory/items', 'GET', null, adm)).status, 200);
  // a custom role given the Tally area can
  const role = (await api('/team/roles', 'POST', { name: 'Stock clerk', perms: { tally: 'view' } }, owner)).data;
  const clerk = await join('clerk@ops.test', role.id);
  assert.equal((await api('/inventory/items', 'GET', null, clerk)).status, 200);
  assert.equal((await api('/inventory/items', 'POST', { name: 'X' }, clerk)).status, 403, 'view only');
});

test('stock entries of a counter bill or a production run can’t be undone one by one', async () => {
  const inv = (p, m = 'GET', b) => api(`/inventory${p}`, m, b, owner);
  const soap = (await inv('/items', 'POST', { name: 'Soap', sale_rate: 30, gst_percent: 18 })).data;
  const oil = (await inv('/items', 'POST', { name: 'Oil' })).data; // no sale rate
  await inv('/moves', 'POST', { kind: 'PURCHASE', itemId: soap.id, qty: 10 });
  await inv('/moves', 'POST', { kind: 'PURCHASE', itemId: oil.id, qty: 10 });
  // no rate anywhere: asked for, never billed at ₹0
  const free = await inv('/pro/bills', 'POST', { lines: [{ itemId: oil.id, qty: 1 }] });
  assert.equal(free.status, 400);
  assert.match(free.data.error, /Rate of Oil is missing/);
  assert.equal((await inv('/pro/bills', 'POST', { lines: [{ itemId: oil.id, qty: 1, rate: 0 }] })).status, 200, 'an explicit ₹0 is fine');

  const bill = (await inv('/pro/bills', 'POST', { lines: [{ itemId: soap.id, qty: 2 }] })).data;
  assert.equal(bill.total, 71);
  const r = await inv(`/moves/${bill.moveIds[0]}`, 'DELETE');
  assert.equal(r.status, 409);
  assert.match(r.data.error, /counter bill CB-0002 — cancel the bill/);
  assert.equal((await inv(`/items/${soap.id}`)).data.item.stock, 8);
  const note = (await inv(`/pro/bills/${bill.id}/return`, 'POST', { lines: [{ line: 0, qty: 1 }] })).data;
  assert.match((await inv(`/moves/${note.moveIds[0]}`, 'DELETE')).data.error, /credit note CN-0001/);

  // a production run comes off as a whole
  const box = (await inv('/items', 'POST', { name: 'Gift Box', sale_rate: 200 })).data;
  const bom = (await inv('/pro/boms', 'PUT', { itemId: box.id, lines: [{ itemId: soap.id, qty: 2 }, { itemId: oil.id, qty: 1 }] })).data;
  const made = (await inv(`/pro/boms/${bom.id}/produce`, 'POST', { qty: 2 })).data;
  assert.equal(made.produced, 2);
  assert.equal((await inv(`/items/${soap.id}`)).data.item.stock, 5);
  const undo = (await inv(`/moves/${made.moves[0]}`, 'DELETE')).data;
  assert.equal(undo.removed, 3, 'both components and the finished goods');
  assert.deepEqual([(await inv(`/items/${soap.id}`)).data.item.stock, (await inv(`/items/${box.id}`)).data.item.stock], [9, 0]);
});

test('an agency’s API key can’t invite into, hand over or delete a client account', async () => {
  const ag = (await register(api)).token;
  const c = (await api('/agency/clients', 'POST', { business: 'Client Co' }, ag)).data;
  const { token } = (await api('/keys', 'POST', { name: 'Script', scope: 'full' }, ag)).data;
  assert.equal((await api(`/agency/clients/${c.id}/invite`, 'POST', { email: 'taker@ops.test' }, token)).status, 404);
  assert.equal((await api(`/agency/clients/${c.id}`, 'DELETE', { confirm: 'DELETE' }, token)).status, 404);
  assert.equal((await api('/agency', 'GET', null, ag)).data.clients.length, 1, 'still there');
});
