// Resilience: hourly backups skip when nothing changed, the weekly restore drill records its result (and fails the
// backups health check when it fails), files stuck on disk are re-sent to the bucket, disk space shows in health.
// Runs the modules in this process against a throwaway data folder and a local fake S3.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ff-resil-'));
const objects = new Map();
let s3, db, upkeep, web, base;
const S3 = (on) => { if (on) Object.assign(process.env, { S3_ENDPOINT: `http://127.0.0.1:${s3.address().port}`, S3_BUCKET: 'bucket', S3_ACCESS_KEY: 'AK', S3_SECRET_KEY: 'SK', S3_REGION: 'auto' }); else delete process.env.S3_ENDPOINT; };

before(async () => {
  s3 = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const u = new URL(req.url, 'http://x'), key = decodeURIComponent(u.pathname.replace(/^\/bucket\/?/, ''));
      if (req.method === 'PUT') { objects.set(key, Buffer.concat(chunks)); return res.end(); }
      if (req.method === 'GET' && u.searchParams.get('list-type')) return res.end(`<ListBucketResult>${[...objects.keys()].filter((k) => k.startsWith(u.searchParams.get('prefix'))).map((k) => `<Key>${k}</Key>`).join('')}</ListBucketResult>`);
      if ((req.method === 'GET' || req.method === 'HEAD') && objects.has(key)) return res.end(req.method === 'GET' ? objects.get(key) : undefined);
      res.writeHead(404); res.end();
    });
  }).listen(0);
  await new Promise((r) => s3.once('listening', r));
  Object.assign(process.env, { DATA_DIR: dataDir, NODE_ENV: 'test', JWT_SECRET: 'test-secret' });
  db = await import('../db.js');
  upkeep = await import('../upkeep.js');
  const { registerObserve } = await import('../observe.js');
  const app = express();
  registerObserve(app);
  web = app.listen(0);
  await new Promise((r) => web.once('listening', r));
  base = `http://127.0.0.1:${web.address().port}`;
  db.T.users.put({ id: 'u1', email: 'a@test.dev', createdAt: Date.now() });
  db.T.funnels.put({ id: 'f1', userId: 'u1', name: 'F', steps: [], updatedAt: Date.now() });
});
after(() => { web?.close(); s3.close(); try { db.sql.close(); } catch {} fs.rmSync(dataDir, { recursive: true, force: true }); });

test('hourly schedule: due on the first run, a new day, a change or a failed off-site copy — skipped otherwise', () => {
  const same = { sig: 'a', lastSig: 'a', todayExists: true, offsiteOk: true };
  assert.equal(db.backupDue(same), false);
  assert.equal(db.backupDue({ ...same, offsiteOk: null }), false, 'no bucket: nothing to retry');
  assert.equal(db.backupDue({ ...same, lastSig: null }), true);
  assert.equal(db.backupDue({ ...same, sig: 'b' }), true);
  assert.equal(db.backupDue({ ...same, todayExists: false }), true);
  assert.equal(db.backupDue({ ...same, offsiteOk: false }), true);
});

test('hourly backup skips when the database is unchanged, runs after a write', async () => {
  S3(false);
  const f = await db.backupNow();
  assert.ok(f && fs.existsSync(f));
  assert.equal(await db.scheduledBackup(), 'unchanged');
  db.T.funnels.put({ id: 'f2', userId: 'u1', name: 'G', steps: [], updatedAt: Date.now() });
  assert.equal(await db.scheduledBackup(), f, 'a write since the last snapshot: today’s file is refreshed');
  assert.equal(await db.scheduledBackup(), 'unchanged');
});

test('restore drill on the newest local backup records its result; a broken backup fails health/backups', async () => {
  S3(false);
  await db.backupNow();
  const r = await upkeep.runRestoreDrill();
  assert.equal(r.ok, true, r.error);
  assert.match(r.source, /^local:funnelhive-\d{4}-\d{2}-\d{2}\.db$/);
  assert.deepEqual([r.counts.users, r.counts.funnels], [1, 2]);
  assert.equal(db.T.platform.get('restoreDrill').ok, true);
  assert.equal((await fetch(`${base}/api/health/backups`)).status, 200);
  assert.equal(fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith('fh-drill-')).some((n) => fs.existsSync(path.join(os.tmpdir(), n, 'funnelhive.db'))), false, 'temp copy removed');

  const file = path.join(dataDir, 'backups', db.backupFiles()[0].name);
  const good = fs.readFileSync(file);
  fs.writeFileSync(file, 'not a database at all');
  const bad = await upkeep.runRestoreDrill();
  assert.equal(bad.ok, false);
  assert.ok(bad.error);
  const hb = await fetch(`${base}/api/health/backups`);
  assert.equal(hb.status, 503);
  assert.equal((await hb.json()).restoreDrill.ok, false);
  const detail = await (await fetch(`${base}/api/health?detail=1`)).json();
  assert.equal(detail.restoreDrill.ok, false);
  fs.writeFileSync(file, good);
});

test('restore drill on the newest encrypted off-site backup', async () => {
  S3(true);
  try {
    await db.backupNow();
    const key = [...objects.keys()].find((k) => /^backups\/funnelhive-.*\.db\.enc$/.test(k));
    assert.ok(key, 'encrypted copy sent off-site');
    assert.equal(db.offsiteStatus().ok, true);
    const r = await upkeep.runRestoreDrill();
    assert.equal(r.ok, true, r.error);
    assert.equal(r.source, `bucket:${key}`);
    assert.equal(r.counts.funnels, 2);
    // a damaged off-site copy can't be decrypted: the drill says so
    objects.set(key, Buffer.concat([objects.get(key).subarray(0, 40), Buffer.from('tampered'), objects.get(key).subarray(48)]));
    const bad = await upkeep.runRestoreDrill();
    assert.equal(bad.ok, false);
    assert.match(bad.error, /decrypt/);
  } finally { S3(false); }
});

test('uploads and product files kept on disk after a failed bucket copy are re-sent', async () => {
  fs.mkdirSync(path.join(dataDir, 'uploads', 'u1'), { recursive: true });
  fs.writeFileSync(path.join(dataDir, 'uploads', 'u1', 'abc.png'), 'png-bytes');
  fs.mkdirSync(path.join(dataDir, 'products', 'u1'), { recursive: true });
  fs.writeFileSync(path.join(dataDir, 'products', 'u1', 'file1'), 'pdf-bytes');
  db.T.products.put({ id: 'p1', userId: 'u1', name: 'Course', files: [{ id: 'file1', name: 'a.pdf', type: 'application/pdf', size: 9 }], at: Date.now() });
  assert.deepEqual(await upkeep.syncStuckFiles(), { sent: 0, marked: 0 }, 'no bucket: nothing to do');
  S3(true);
  try {
    const r = await upkeep.syncStuckFiles();
    assert.deepEqual(r, { sent: 2, marked: 0 });
    assert.equal(String(objects.get('uploads/u1/abc.png')), 'png-bytes');
    assert.equal(String(objects.get('products/u1/file1')), 'pdf-bytes');
    assert.equal(db.T.products.get('p1').files[0].s3, true);
    assert.ok(fs.existsSync(path.join(dataDir, 'uploads', 'u1', 'abc.png')), 'the local copy stays');
    assert.deepEqual(await upkeep.syncStuckFiles(), { sent: 0, marked: 0 }, 'sent once only');
  } finally { S3(false); }
});

test('disk space: in health details, and its own endpoint for an uptime monitor', async () => {
  const d = await fetch(`${base}/api/health/disk`);
  assert.equal(d.status, 200);
  const body = await d.json();
  assert.equal(body.ok, true);
  assert.equal(typeof body.diskFreeGB, 'number');
  assert.equal(typeof body.diskFreePct, 'number');
  const h = await (await fetch(`${base}/api/health?detail=1`)).json();
  assert.equal(h.disk, true);
  assert.equal(typeof h.diskFreeGB, 'number');
});
