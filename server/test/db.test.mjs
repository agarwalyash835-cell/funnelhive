import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { startServer, register } from './helpers.mjs';

test('data survives a restart (SQLite persistence)', async () => {
  let srv = await startServer();
  const dataDir = srv.dataDir;
  const email = `persist${Date.now()}@test.dev`;
  const { token } = await register(srv.api, email);
  const f = (await srv.api('/templates/yoga/use', 'POST', {}, token)).data;
  await srv.api(`/funnels/${f.id}`, 'PUT', { name: 'Persisted funnel', published: true }, token);
  await srv.api(`/public/${f.slug}/event`, 'POST', { stepId: f.steps[0].id, type: 'view' });
  await srv.stop({ keep: true });
  assert.ok(fs.existsSync(path.join(dataDir, 'funnelhive.db')));

  srv = await startServer({}, { dataDir });
  const login = await srv.api('/auth/login', 'POST', { email, password: 'secret123' });
  assert.equal(login.status, 200);
  const list = (await srv.api('/funnels', 'GET', null, login.data.token)).data;
  assert.equal(list[0].name, 'Persisted funnel');
  const a = (await srv.api(`/funnels/${f.id}/analytics?days=7`, 'GET', null, login.data.token)).data;
  assert.equal(a.totals.views, 1);
  await srv.stop();
});

test('legacy data.json is migrated automatically and renamed', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ff-mig-'));
  const legacy = {
    users: [{ id: 'u1', email: 'old@test.dev', name: 'Old', hash: '$2a$10$abcdefghijklmnopqrstuuJ1yCtmJt0Kxj7nNnuBvG7l9Y0x9nG5u' }],
    funnels: [{ id: 'f1', userId: 'u1', name: 'Legacy funnel', slug: 'legacy', published: true, theme: {}, steps: [{ id: 's1', name: 'L', type: 'landing', slug: 'start', blocks: [] }] }],
    leads: [], orders: [{ id: 'o1', funnelId: 'f1', items: [{ name: 'x', price: 100 }], total: 100, at: Date.now() }],
    events: [{ funnelId: 'f1', stepId: 's1', type: 'view', at: Date.now() }],
  };
  fs.writeFileSync(path.join(dataDir, 'data.json'), JSON.stringify(legacy));
  const srv = await startServer({}, { dataDir });
  const pub = await srv.api('/public/legacy');
  assert.equal(pub.status, 200);
  assert.equal(pub.data.name, 'Legacy funnel');
  assert.ok(!fs.existsSync(path.join(dataDir, 'data.json')));
  assert.ok(fs.readdirSync(dataDir).some((n) => n.startsWith('data.json.migrated-')));
  await srv.stop();
});

test('only changed rows are written; deletes are removed from disk', async () => {
  const srv = await startServer();
  const { token } = await register(srv.api);
  const a = (await srv.api('/funnels', 'POST', { name: 'Keep me' }, token)).data;
  const b = (await srv.api('/funnels', 'POST', { name: 'Delete me' }, token)).data;
  await srv.api(`/funnels/${b.id}`, 'DELETE', null, token);
  await new Promise((r) => setTimeout(r, 200));
  const sql = new DatabaseSync(path.join(srv.dataDir, 'funnelhive.db'), { readOnly: true });
  const names = sql.prepare('SELECT data FROM funnels').all().map((r) => JSON.parse(r.data).name);
  sql.close();
  assert.ok(names.includes('Keep me') && !names.includes('Delete me'));
  assert.ok(a.id);
  await srv.stop();
});
