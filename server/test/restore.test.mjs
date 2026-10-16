// Restoring the database from the admin panel: checked, staged, swapped in on restart, and itself undoable.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { startServer, register, enable2fa, totpCode } from './helpers.mjs';

const ADMIN = { ADMIN_EMAILS: 'boss@restore.test' };
const asAdmin = async (srv) => {
  const A = (await register(srv.api, 'boss@restore.test')).token;
  const link = srv.log().match(/To: boss@restore\.test[\s\S]*?\/verify\?token=([a-f0-9.]+)/);
  await srv.api('/auth/verify', 'POST', { token: link[1] });
  return enable2fa(srv.api, A); // the admin panel needs 2-step login
};

test('restore: a bad file is refused; a good backup comes back after the restart; the old database is kept', async () => {
  let srv = await startServer(ADMIN);
  const dataDir = srv.dataDir;
  try {
    const { token: A, secret } = await asAdmin(srv);
    const f1 = (await srv.api('/funnels', 'POST', { name: 'Before the backup' }, A)).data;
    assert.ok(f1.id);
    assert.equal((await srv.api('/admin/backup', 'POST', {}, A)).data.ok, true);
    const hb = await srv.api('/health/backups');
    assert.equal(hb.status, 200);
    assert.equal(hb.data.local, true, 'the uptime monitor sees a fresh backup');
    const backups = (await srv.api('/admin/backups', 'GET', null, A)).data;
    assert.equal(backups.local.length, 1);
    const name = backups.local[0].name;
    // made after the backup: gone once it's restored
    await srv.api('/funnels', 'POST', { name: 'After the backup' }, A);

    assert.equal((await srv.api('/admin/restore', 'POST', { name, from: 'local' }, A)).status, 400, 'needs RESTORE typed');
    fs.writeFileSync(path.join(dataDir, 'backups', 'funnelhive-2001-01-01.db'), 'not a database');
    const bad = await srv.api('/admin/restore', 'POST', { name: 'funnelhive-2001-01-01.db', from: 'local', confirm: 'RESTORE' }, A);
    assert.equal(bad.status, 400);
    assert.match(bad.data.error, /can’t be used/);
    assert.equal((await srv.api('/admin/restore', 'POST', { name: '../funnelhive.db', from: 'local', confirm: 'RESTORE' }, A)).status, 400, 'no paths');
    fs.rmSync(path.join(dataDir, 'backups', 'funnelhive-2001-01-01.db'));

    const r = await srv.api('/admin/restore', 'POST', { name, from: 'local', confirm: 'RESTORE' }, A);
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.ok(fs.existsSync(path.join(dataDir, 'restore-pending.db')), 'staged for the restart');
    await srv.stop({ keep: true });

    srv = await startServer(ADMIN, { dataDir });
    const login = (await srv.api('/auth/login', 'POST', { email: 'boss@restore.test', password: 'secret123', code: totpCode(secret) })).data.token;
    const names = (await srv.api('/funnels', 'GET', null, login)).data.map((f) => f.name);
    assert.ok(names.includes('Before the backup'));
    assert.ok(!names.includes('After the backup'), 'later changes are replaced');
    assert.ok(!fs.existsSync(path.join(dataDir, 'restore-pending.db')));
    const after = (await srv.api('/admin/backups', 'GET', null, login)).data;
    assert.equal(after.safety.length, 1, 'the replaced database is kept, so the restore can be undone');
  } finally { await srv.stop(); }
});

test('restore is admin-only', async () => {
  const srv = await startServer(ADMIN);
  try {
    const T = (await register(srv.api)).token;
    assert.equal((await srv.api('/admin/backups', 'GET', null, T)).status, 403);
    assert.equal((await srv.api('/admin/restore', 'POST', { name: 'x.db', confirm: 'RESTORE' }, T)).status, 403);
  } finally { await srv.stop(); }
});
