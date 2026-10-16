// Background upkeep (the jobs process only):
//   - weekly restore drill: the newest off-site backup (or, without a storage bucket, the newest one on this disk) is
//     downloaded, decrypted and checked in a throwaway folder — integrity, tables, row counts. The result is kept in
//     platform 'restoreDrill' and shown in Admin → Overview, /api/health?detail=1 and /api/health/backups (503 when the
//     last drill failed). The live database is never touched. (server/scripts/restore-drill.mjs also boots the app.)
//   - files stuck on this disk: an upload whose copy to the bucket failed is sent again every 30 minutes
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { T, q, sql, dir, JOBS } from './db.js';
import { s3Enabled, listKeys, getFile, headObject, putFile } from './storage.js';
import { isEncryptedFile, decryptFile } from './backup-crypt.js';

const WEEK = 7 * 86400000;
const MUST = ['users', 'funnels', 'orders', 'leads', 'payments', 'platform'];
const COUNTED = ['users', 'funnels', 'orders'];
export const drillStatus = () => { try { return T.platform.get('restoreDrill') || null; } catch { return null; } };

let drilling = false;
export async function runRestoreDrill() {
  if (drilling) return null;
  drilling = true;
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'fh-drill-'));
  const target = path.join(work, 'funnelhive.db');
  const result = { at: Date.now(), ok: false, source: '', error: '', counts: {} };
  try {
    // 1. the newest backup: off-site when there's a bucket (that's the copy that matters if this server is lost)
    if (s3Enabled()) {
      const keys = (await listKeys('backups/')).filter((k) => /funnelhive-\d{4}-\d{2}-\d{2}\.db(\.enc)?$/.test(k)).sort();
      if (!keys.length) throw new Error('no backups in the storage bucket yet');
      result.source = `bucket:${keys.at(-1)}`;
      await getFile(keys.at(-1), `${target}.download`);
    } else {
      const bdir = path.join(dir, 'backups');
      const files = fs.existsSync(bdir) ? fs.readdirSync(bdir).filter((n) => /^funnelhive-\d{4}-\d{2}-\d{2}\.db$/.test(n)).sort() : [];
      if (!files.length) throw new Error('no backups on this server yet');
      result.source = `local:${files.at(-1)}`;
      fs.copyFileSync(path.join(bdir, files.at(-1)), `${target}.download`);
    }
    if (isEncryptedFile(`${target}.download`)) { await decryptFile(`${target}.download`, target, dir); fs.rmSync(`${target}.download`, { force: true }); }
    else fs.renameSync(`${target}.download`, target);
    // 2. the file itself
    let db;
    try { db = new DatabaseSync(target, { readOnly: true }); } catch (e) { throw new Error(`not a database: ${e.message}`); }
    try {
      const integrity = db.prepare('PRAGMA integrity_check').all().map((r) => Object.values(r)[0]);
      if (integrity.join() !== 'ok') throw new Error(`integrity check: ${integrity.slice(0, 3).join('; ')}`);
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name);
      const missing = MUST.filter((t) => !tables.includes(t));
      if (missing.length) throw new Error(`missing tables: ${missing.join(', ')}`);
      for (const t of COUNTED) result.counts[t] = db.prepare(`SELECT COUNT(*) AS n FROM "${t}"`).get().n;
    } finally { db.close(); }
    // 3. a backup with no sellers / funnels / orders while the live database has them is no backup
    const empty = COUNTED.filter((t) => !result.counts[t] && (q(`SELECT COUNT(*) AS n FROM "${t}"`).get()?.n || 0) > 0);
    if (empty.length) throw new Error(`the backup has no ${empty.join(', ')} but the live database does`);
    result.ok = true;
  } catch (e) {
    result.error = String(e.message || e).slice(0, 300);
    console.error('Restore drill failed', result.error);
  } finally {
    drilling = false;
    for (let i = 0; i < 5; i++) { try { fs.rmSync(work, { recursive: true, force: true }); break; } catch { await new Promise((r) => setTimeout(r, 200)); } }
  }
  try { T.platform.put({ id: 'restoreDrill', ...result }); } catch {}
  return result;
}
// once a week; a failed drill is tried again after 6 hours (a fixed backup clears the alarm)
const drillIfDue = () => { const d = drillStatus(); if (!d || Date.now() - d.at > (d.ok ? WEEK : 6 * 3600000)) runRestoreDrill().catch(() => {}); };

// ---------- files stuck on this disk ----------
// Image uploads and product files go to the bucket when there is one; if that copy failed they were kept here.
// Each run sends up to 300 of them (a missing bucket copy only: already-there files are just marked). Images stay
// on disk too (served from here first, as before); product files get their s3 flag so any server can hand them out.
if (JOBS) sql.exec('CREATE TABLE IF NOT EXISTS synced_files (key TEXT PRIMARY KEY, at INTEGER)');
const TYPES = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', avif: 'image/avif' };
let syncing = false;
export async function syncStuckFiles({ max = 300 } = {}) {
  if (syncing || !s3Enabled()) return { sent: 0, marked: 0 };
  syncing = true;
  const out = { sent: 0, marked: 0 };
  try {
    const done = (k) => !!q('SELECT 1 AS x FROM synced_files WHERE key = ?').get(k);
    const mark = (k) => q('INSERT OR IGNORE INTO synced_files (key, at) VALUES (?, ?)').run(k, Date.now());
    const up = path.join(dir, 'uploads');
    const users = fs.existsSync(up) ? fs.readdirSync(up).filter((u) => /^[\w-]+$/.test(u)) : [];
    for (const u of users) {
      let names = [];
      try { names = fs.readdirSync(path.join(up, u)).filter((n) => /^[\w.-]+$/.test(n) && !n.endsWith('.part')); } catch { continue; }
      for (const n of names) {
        const key = `uploads/${u}/${n}`;
        if (done(key)) continue;
        if (out.sent + out.marked >= max) return out;
        if (await headObject(key)) { mark(key); out.marked++; continue; }
        await putFile(key, path.join(up, u, n), TYPES[n.split('.').pop().toLowerCase()] || 'application/octet-stream');
        mark(key); out.sent++;
      }
    }
    for (const r of q("SELECT id, userId, data FROM products WHERE EXISTS (SELECT 1 FROM json_each(data, '$.files') f WHERE json_extract(f.value, '$.s3') IS NOT 1)").all()) {
      for (const f of JSON.parse(r.data).files || []) {
        const local = path.join(dir, 'products', r.userId, f.id);
        if (f.s3 || !/^[\w-]+$/.test(f.id || '') || !fs.existsSync(local)) continue;
        if (out.sent + out.marked >= max) return out;
        const key = `products/${r.userId}/${f.id}`;
        if (await headObject(key)) out.marked++;
        else { await putFile(key, local, f.type || 'application/octet-stream'); out.sent++; }
        T.products.update(r.id, (p) => { const g = (p.files || []).find((x) => x.id === f.id); if (g) g.s3 = true; });
      }
    }
  } catch (e) { console.error('Re-sending files to storage failed', e.message); } finally { syncing = false; }
  return out;
}

if (JOBS && process.env.NODE_ENV !== 'test') {
  setTimeout(drillIfDue, 15 * 60000).unref(); setInterval(drillIfDue, 6 * 3600000).unref();
  setTimeout(() => syncStuckFiles(), 5 * 60000).unref(); setInterval(() => syncStuckFiles(), 30 * 60000).unref();
}
