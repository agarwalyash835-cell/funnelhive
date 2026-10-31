// Agencies & freelancers: client accounts under the agency's plan (limits, switching in, inviting the client,
// handing over, deleting), white-label branding, copying a funnel with its automations and products to a client,
// export / import and share links, the signed client report, and the activity log.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { startServer, register } from './helpers.mjs';

let srv, api, A, me, f, client;
// the server's database, for moving clocks (a session or link "in the past") and checking audit rows
const dbRun = (sql, ...args) => { const db = new DatabaseSync(path.join(srv.dataDir, 'funnelhive.db')); try { db.exec('PRAGMA busy_timeout = 10000'); return db.prepare(sql).run(...args); } finally { db.close(); } };
const dbAll = (sql, ...args) => { const db = new DatabaseSync(path.join(srv.dataDir, 'funnelhive.db')); try { db.exec('PRAGMA busy_timeout = 10000'); return db.prepare(sql).all(...args); } finally { db.close(); } };
const jwtBody = (t) => JSON.parse(Buffer.from(t.split('.')[1], 'base64url').toString());
before(async () => {
  srv = await startServer({ APP_URL: 'https://app.example.in' });
  api = srv.api;
  A = (await register(api)).token;
  me = (await api('/me', 'GET', null, A)).data;
  await api('/settings', 'PUT', { businessName: 'Growth Agency' }, A);
  f = (await api('/templates/coding/use', 'POST', {}, A)).data;
});
let stopped = false;
after(async () => { if (!stopped) await srv.stop(); else { try { (await import('../db.js')).sql.close(); fs.rmSync(srv.dataDir, { recursive: true, force: true }); } catch { /* Windows: a temp dir in use is left behind */ } } });

test('client accounts: trial allows 2; the agency works inside them; access follows the agency', async () => {
  assert.equal((await api('/agency/clients', 'POST', { business: '' }, A)).status, 400);
  const c1 = (await api('/agency/clients', 'POST', { business: 'Sharma Yoga' }, A)).data;
  await api('/agency/clients', 'POST', { business: 'Mehta Bakes' }, A);
  const third = await api('/agency/clients', 'POST', { business: 'Third' }, A);
  assert.equal(third.status, 402, 'the trial includes 2');
  assert.equal(third.data.upgrade, true);
  client = c1;
  // the returned token opens the client's workspace as its agency
  const me2 = (await api('/me', 'GET', null, c1.token)).data;
  assert.deepEqual([me2.workspace.name, me2.workspace.role], ['Sharma Yoga', 'agency']);
  assert.equal((await api('/billing', 'GET', null, c1.token)).status, 403, 'billing is the agency’s');
  assert.equal((await api('/team/members', 'GET', null, c1.token)).status, 200, 'the agency manages the client’s team');
  const fresh = (await api('/templates/yoga/use', 'POST', {}, c1.token)).data;
  assert.ok(fresh.id);
  const list = (await api('/agency', 'GET', null, A)).data;
  assert.deepEqual([list.used, list.limit], [2, 2]);
  assert.equal(list.clients.find((c) => c.id === c1.id).funnels, 1);
});

test('white-label: brand shows for the agency, its clients and on its own app domain', async () => {
  assert.equal((await api('/agency/white-label', 'PUT', { brand: 'GrowthOS', logo: 'javascript:1' }, A)).status, 400);
  // the platform's own login page (and its parent domain / siblings) can never be rebranded by an agency
  for (const domain of ['app.example.in', 'example.in', 'evil.app.example.in']) assert.equal((await api('/agency/white-label', 'PUT', { brand: 'X', domain }, A)).status, 400, domain);
  const r = (await api('/agency/white-label', 'PUT', { brand: 'GrowthOS', primary: '#ff5500', supportEmail: 'help@growth.in', domain: 'https://app.growth.in/' }, A)).data;
  assert.equal(r.whiteLabel.domain, 'app.growth.in');
  assert.equal((await api('/me', 'GET', null, A)).data.brand, 'GrowthOS');
  assert.equal((await api('/me', 'GET', null, client.token)).data.brand, 'GrowthOS', 'inside a client account');
  const site = await (await fetch(`${srv.base}/api/site`, { headers: { 'x-forwarded-host': 'app.growth.in' } })).json();
  assert.equal(site.brand, 'GrowthOS');
  assert.equal((await fetch(`${srv.base}/api/domains/tls-check?domain=app.growth.in`)).status, 200, 'HTTPS certificate allowed');
  const other = (await register(api)).token;
  assert.equal((await api('/agency/white-label', 'PUT', { brand: 'X', domain: 'app.growth.in' }, other)).status, 409);
});

test('snapshots: copy a funnel with its automation and product to a client; export/import; share links', async () => {
  const prod = (await api('/products', 'POST', { name: 'Bootcamp Notes', links: [{ label: 'Notes', url: 'https://example.com/n' }] }, A)).data;
  const co = f.steps.find((s) => s.type === 'checkout');
  co.blocks.find((b) => b.type === 'checkout').props.productId = prod.id;
  f = (await api(`/funnels/${f.id}`, 'PUT', { steps: f.steps }, A)).data;
  await api('/automations', 'POST', { name: 'Buyer welcome', trigger: { type: 'purchase', funnelId: f.id }, steps: [{ type: 'tag', tag: 'buyer' }] }, A);
  const other = (await register(api)).token;
  const otherMe = (await api('/me', 'GET', null, other)).data;
  assert.equal((await api(`/funnels/${f.id}/copy-to`, 'POST', { accountId: otherMe.id }, A)).status, 403, 'only accounts you manage');
  const cp = (await api(`/funnels/${f.id}/copy-to`, 'POST', { accountId: client.id }, A)).data;
  assert.deepEqual([cp.products, cp.automations], [1, 1]);
  const inClient = (await api(`/funnels/${cp.id}`, 'GET', null, client.token)).data;
  const pid = inClient.steps.find((s) => s.type === 'checkout').blocks.find((b) => b.type === 'checkout').props.productId;
  assert.ok(pid && pid !== prod.id, 'points at the client’s own copy');
  assert.equal((await api(`/products/${pid}`, 'GET', null, client.token)).data.name, 'Bootcamp Notes');
  const autos = (await api('/automations', 'GET', null, client.token)).data.automations;
  assert.ok(autos.some((a) => a.name === 'Buyer welcome' && a.trigger.funnelId === cp.id && !a.active), 'paused, re-pointed');
  // export / import
  const snap = (await api(`/funnels/${f.id}/export`, 'GET', null, A)).data;
  assert.equal(snap.kind, 'funnelhive.snapshot');
  const imp = await api('/funnels/import', 'POST', { snapshot: snap }, other);
  assert.equal(imp.status, 201);
  assert.equal((await api('/funnels/import', 'POST', { snapshot: { kind: 'nope' } }, other)).status, 400);
  // share link (freelancer → client)
  const sh = (await api(`/funnels/${f.id}/share`, 'POST', {}, A)).data;
  const token = sh.url.split('/share/')[1];
  assert.equal((await api(`/share/${token}`)).data.name, f.name);
  assert.equal((await api(`/share/${token}/import`, 'POST', {}, other)).status, 201);
  await api(`/funnels/${f.id}/share`, 'DELETE', null, A);
  assert.equal((await api(`/share/${token}`)).status, 404, 'turned off');
});

let mehta, O; // the second client, and its owner's own login
test('entering a client: a reason, a 2-hour marked token, the client told, entry and reads logged', async () => {
  mehta = (await api('/agency', 'GET', null, A)).data.clients.find((c) => c.business === 'Mehta Bakes').id;
  assert.equal((await api(`/agency/clients/${mehta}/enter`, 'POST', {}, A)).status, 400, 'a reason is needed');
  assert.equal((await api(`/agency/clients/${mehta}/enter`, 'POST', { reason: 'x' }, A)).status, 400);
  const sw = await api('/team/switch', 'POST', { ownerId: mehta }, A);
  assert.deepEqual([sw.status, sw.data.agencyEntry], [403, true], 'no plain switch into a client');
  const e = (await api(`/agency/clients/${mehta}/enter`, 'POST', { reason: 'Fixing the checkout page' }, A)).data;
  const p = jwtBody(e.token);
  assert.deepEqual([p.exp - p.iat, p.agencyImp, p.ws], [7200, me.id, mehta]);
  const m = (await api('/me', 'GET', null, e.token)).data;
  assert.deepEqual([m.agencyAccess?.mode, m.agencyAccess?.reason, m.workspace?.role], ['full', 'Fixing the checkout page', 'agency']);
  assert.equal((await api('/contacts', 'GET', null, e.token)).status, 200);
  assert.equal((await api('/auth/refresh', 'POST', {}, e.token)).data.token, null, 'never extended');
  const notes = (await api('/notifications', 'GET', null, e.token)).data.items;
  assert.ok(notes.some((n) => n.kind === 'agency' && /opened your account/.test(n.title) && /Fixing the checkout page/.test(n.body)));
  const act = (await api('/activity', 'GET', null, e.token)).data;
  assert.ok(act.some((a) => a.who.kind === 'agency' && /Opened your account.*Fixing the checkout page/.test(a.what)), 'entry in the activity log');
  assert.ok(act.some((a) => a.who.kind === 'agency' && /Looked at contacts/.test(a.what)), 'reads logged');
  const audit = dbAll('SELECT data FROM audit WHERE userId = ?', mehta).map((r) => JSON.parse(r.data));
  assert.ok(audit.some((x) => x.action === 'agency_enter' && x.actorId === me.id && /Fixing the checkout page/.test(x.detail)));
  // the session ends after 2 hours: the token stops working
  dbRun("UPDATE sessions SET expiresAt = ?, data = json_set(data, '$.expiresAt', ?) WHERE id = ?", Date.now() - 1000, Date.now() - 1000, p.sid);
  assert.equal((await api('/me', 'GET', null, e.token)).status, 401, 'expired');
});

test('the client’s owner decides: agency access full / read-only / off — the agency can’t change it', async () => {
  const inv = (await api(`/agency/clients/${mehta}/invite`, 'POST', { email: 'owner@mehtabakes.in' }, A)).data;
  await api('/auth/reset', 'POST', { token: inv.token, password: 'bakes12345' });
  O = (await api('/auth/login', 'POST', { email: 'owner@mehtabakes.in', password: 'bakes12345' })).data.token;
  const e = (await api(`/agency/clients/${mehta}/enter`, 'POST', { reason: 'Weekly review' }, A)).data.token;
  assert.equal((await api('/agency-access', 'PUT', { mode: 'off' }, e)).status, 403, 'not by the agency');
  const v = (await api('/agency-access', 'GET', null, O)).data;
  assert.equal(v.mode, 'full', 'existing clients start on full');
  assert.ok(v.visits.some((x) => /Weekly review/.test(x.what)), 'the client sees the visits');
  assert.equal((await api('/agency-access', 'PUT', { mode: 'sometimes' }, O)).status, 400);
  assert.equal((await api('/agency-access', 'PUT', { mode: 'read' }, O)).data.mode, 'read');
  assert.equal((await api('/contacts', 'GET', null, e)).status, 200, 'read-only still reads');
  const w = await api('/contacts', 'POST', { email: 'new@lead.in', name: 'New' }, e);
  assert.deepEqual([w.status, w.data.readOnly], [403, true], 'read-only blocks writes');
  assert.equal((await api('/templates/yoga/use', 'POST', {}, e)).status, 403);
  assert.equal((await api('/agency-access', 'PUT', { mode: 'off' }, O)).data.mode, 'off');
  const off = await api('/contacts', 'GET', null, e);
  assert.deepEqual([off.status, off.data.agencyAccessOff], [403, true], 'off: the open session is shut too');
  const enter = await api(`/agency/clients/${mehta}/enter`, 'POST', { reason: 'Please let me in' }, A);
  assert.deepEqual([enter.status, enter.data.agencyAccessOff], [403, true], 'off: entry refused');
  assert.equal((await api('/agency-access', 'PUT', { mode: 'full' }, O)).data.mode, 'full');
  assert.equal((await api('/contacts', 'POST', { email: 'new@lead.in', name: 'New' }, e)).status < 300, true, 'full again');
});

test('agency staff: a client manager works only in the clients assigned to them', async () => {
  const s = await register(api, 'manager@growth.in');
  const inv = (await api('/team/invite', 'POST', { email: 'manager@growth.in', role: 'clients' }, A)).data;
  assert.ok(inv.token, JSON.stringify(inv));
  const S = (await api('/team/accept', 'POST', { token: inv.token }, s.token)).data.token;
  const other = (await register(api)).token;
  assert.equal((await api('/team/invite', 'POST', { email: 'x@y.in', role: 'clients' }, other)).status, 400, 'only agencies have client managers');
  assert.equal((await api(`/agency/staff/${inv.id}`, 'PUT', { clientIds: [client.id] }, S)).status, 403, 'staff can’t assign themselves');
  assert.equal((await api(`/agency/staff/${inv.id}`, 'PUT', { clientIds: [client.id] }, A)).data.clientIds[0], client.id);
  const mine = (await api('/agency', 'GET', null, S)).data;
  assert.deepEqual(mine.clients.map((c) => c.id), [client.id], 'only the assigned client');
  assert.equal((await api(`/agency/clients/${mehta}/enter`, 'POST', { reason: 'look around' }, S)).status, 404);
  assert.equal((await api(`/agency/clients/${mehta}/report-link`, 'POST', {}, S)).status, 404);
  for (const [m, p, b] of [['GET', '/funnels'], ['GET', '/contacts'], ['PUT', '/agency/white-label', { brand: 'Mine' }], ['POST', '/agency/clients', { business: 'Extra' }], ['DELETE', `/agency/clients/${client.id}`, { confirm: 'DELETE' }]]) {
    assert.ok((await api(p, m, b, S)).status >= 400, `staff ${m} ${p}`);
  }
  const e = (await api(`/agency/clients/${client.id}/enter`, 'POST', { reason: 'Update the landing page' }, S)).data;
  assert.ok(e.token);
  const m = (await api('/me', 'GET', null, e.token)).data;
  assert.deepEqual([m.workspace.name, m.workspace.role], ['Sharma Yoga', 'agency']);
  assert.equal((await api('/funnels', 'GET', null, e.token)).status, 200);
  // unassigned: no longer gets in, even with the token they had
  await api(`/agency/staff/${inv.id}`, 'PUT', { clientIds: [mehta] }, A);
  assert.equal((await api('/funnels', 'GET', null, e.token)).status, 401);
  await api(`/agency/staff/${inv.id}`, 'PUT', { clientIds: null }, A);
  assert.equal((await api('/agency', 'GET', null, S)).data.clients.length, 2, 'all clients again');
});

test('deleting a client: suspended for 30 days, the client told, the agency can undo it', async () => {
  assert.equal((await api(`/agency/clients/${mehta}`, 'DELETE', {}, A)).status, 400);
  const d = (await api(`/agency/clients/${mehta}`, 'DELETE', { confirm: 'DELETE' }, A)).data;
  assert.ok(Math.abs(d.purgeAt - (Date.now() + 30 * 86400000)) < 60000);
  const cm = (await api('/me', 'GET', null, O)).data;
  assert.equal(cm.billing.ok, false, 'suspended');
  assert.ok((await api('/notifications', 'GET', null, O)).data.items.some((n) => /closing this account/.test(n.title)), 'the client is told');
  assert.equal((await api('/contacts', 'POST', { email: 'z@z.in', name: 'Z' }, O)).status, 402, 'no writes');
  assert.equal((await api(`/agency/clients/${mehta}/enter`, 'POST', { reason: 'one more look' }, A)).status, 409);
  assert.ok((await api('/agency', 'GET', null, A)).data.clients.find((c) => c.id === mehta).deletion.purgeAt);
  assert.equal((await api(`/agency/clients/${mehta}/restore`, 'POST', {}, A)).status, 200);
  assert.equal((await api('/me', 'GET', null, O)).data.billing.ok, true, 'undone');
  // deleted again; the purge job removes it after 30 days (last test)
  await api(`/agency/clients/${mehta}`, 'DELETE', { confirm: 'DELETE' }, A);
});

test('client report link, activity log, inviting and handing over a client', async () => {
  assert.equal((await api('/agency', 'GET', null, A)).data.clients.find((c) => c.id === client.id).report, null, 'no link until one is made');
  const link = (await api(`/agency/clients/${client.id}/report-link`, 'POST', { days: 7 }, A)).data;
  assert.ok(link.expiresAt > Date.now() + 6 * 86400000 && link.expiresAt < Date.now() + 8 * 86400000, 'expires in 7 days');
  const tok = link.url.split('/report/')[1];
  const r = (await api(`/report/${tok}`)).data;
  assert.equal(r.business, 'Sharma Yoga');
  assert.equal(r.brand, 'GrowthOS');
  assert.equal((await api(`/report/${client.id}.forged`)).status, 404);
  assert.equal((await api(`/report/${tok.replace(/.$/, (ch) => (ch === 'a' ? 'b' : 'a'))}`)).status, 404, 'tampered');
  // revoked: the link stops; a new link works and the old one stays dead
  assert.equal((await api(`/agency/clients/${client.id}/report-link`, 'DELETE', null, A)).status, 200);
  assert.equal((await api(`/report/${tok}`)).status, 404, 'revoked');
  const tok2 = (await api(`/agency/clients/${client.id}/report-link`, 'POST', {}, A)).data.url.split('/report/')[1];
  assert.equal((await api(`/report/${tok2}`)).status, 200);
  assert.equal((await api(`/report/${tok}`)).status, 404);
  // expired: the same link after its date
  dbRun("UPDATE users SET data = json_set(data, '$.report.exp', ?) WHERE id = ?", Date.now() - 1000, client.id);
  assert.equal((await api(`/report/${tok2}`)).status, 404, 'expired');
  const act = (await api('/activity', 'GET', null, client.token)).data;
  assert.ok(act.some((a) => a.who.kind === 'agency' && /funnel/i.test(a.what)), JSON.stringify(act.slice(0, 3)));
  // hand over: needs the client to log in first
  assert.equal((await api(`/agency/clients/${client.id}/detach`, 'POST', {}, A)).status, 400);
  const inv = (await api(`/agency/clients/${client.id}/invite`, 'POST', { email: 'owner@sharmayoga.in' }, A)).data;
  const set = await api('/auth/reset', 'POST', { token: inv.token, password: 'yoga12345' });
  assert.equal(set.status, 200);
  const login = (await api('/auth/login', 'POST', { email: 'owner@sharmayoga.in', password: 'yoga12345' })).data;
  const cm = (await api('/me', 'GET', null, login.token)).data;
  assert.equal(cm.brand, 'GrowthOS');
  assert.equal(cm.billing.agencyManaged, true);
  // once the client has its own login, the agency can't change its email (that would lock the client out)
  const again = await api(`/agency/clients/${client.id}/invite`, 'POST', { email: 'attacker@agency.test' }, A);
  assert.equal(again.status, 409);
  assert.equal((await api('/me', 'GET', null, login.token)).data.email, 'owner@sharmayoga.in');
  assert.equal((await api(`/agency/clients/${client.id}/detach`, 'POST', {}, A)).data.ok, true);
  const after = (await api('/me', 'GET', null, login.token)).data;
  assert.equal(after.billing.status, 'trialing', 'their own trial now');
  assert.equal((await api('/agency', 'GET', null, A)).data.used, 1);
});

// on the same data, with the server stopped: the migration (dry run, apply, idempotent) and the purge job
test('migration to one agency model; deleted clients purged after 30 days', async () => {
  await srv.stop({ keep: true }); stopped = true;
  Object.assign(process.env, { DATA_DIR: srv.dataDir, FF_JOBS: '0', NODE_ENV: 'test', JWT_SECRET: 'test-secret' });
  const { T } = await import('../db.js');
  const AT = await import('../agency-terms.js');
  // an agency on the old fields: partner{} terms and a wallet
  T.users.update(me.id, (x) => { x.partner = { enabled: true, perAccount: 300, creditRate: 10, maxAccounts: 7, since: 1 }; delete x.agency; });
  T.partnerLedger.insert({ id: 'mig-l1', partnerId: me.id, amount: 1234, kind: 'topup', note: 'test', at: Date.now() });
  const dry = AT.migrateAgencies().find((r) => r.id === me.id);
  assert.deepEqual([dry.changed, dry.kind, dry.maxClients, dry.before.wallet, dry.after.wallet, dry.before.clients, dry.after.clients], [true, 'reseller', 7, 1234, 1234, 1, 1]);
  assert.ok(T.users.get(me.id).partner && !T.users.get(me.id).agency, 'a dry run writes nothing');
  const applied = AT.migrateAgencies({ apply: true }).find((r) => r.id === me.id);
  assert.equal(applied.changed, true);
  const u = T.users.get(me.id);
  assert.equal(u.partner, undefined);
  assert.deepEqual([u.agency.kind, u.agency.maxClients, u.agency.rates.perAccount, u.agency.rates.creditRate], ['reseller', 7, 300, 10]);
  assert.ok(AT.migrateAgencies({ apply: true }).every((r) => !r.changed), 'idempotent');
  assert.ok(fs.statSync(AT.backupBeforeMigration()).size > 0, 'backup first');
  // purge: not before 30 days, then gone
  const AG = await import('../agency.js');
  const { deleteAccount } = await import('../account.js');
  assert.equal(AG.purgeDeletedClients(Date.now(), deleteAccount), 0, 'not yet');
  assert.ok(T.users.get(mehta));
  assert.equal(AG.purgeDeletedClients(Date.now() + 31 * 86400000, deleteAccount), 1);
  assert.equal(T.users.get(mehta), null, 'purged');
  assert.equal(T.members.find({ ownerId: mehta }), null);
});
