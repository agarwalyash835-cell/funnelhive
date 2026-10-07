// Persistence: SQLite (built into Node ≥ 22.13) with one table per collection.
// Routes keep working with plain in-memory arrays (db.funnels, db.orders, …) and call save();
// save() writes only the records that changed, inside a single transaction (WAL journal → crash-safe).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

export const dir = process.env.DATA_DIR || path.dirname(fileURLToPath(import.meta.url));
fs.mkdirSync(dir, { recursive: true });
export const uid = () => crypto.randomUUID().slice(0, 8);

const COLLECTIONS = ['users', 'funnels', 'leads', 'orders', 'events', 'coupons', 'abandoned', 'revisions', 'webhooks', 'saved', 'crm', 'pipelines', 'automations', 'runs', 'domains', 'msgs', 'autoversions', 'payments', 'hive'];
const APPEND_ONLY = new Set(['events', 'leads']); // never edited in place, only appended or filtered out

const dbFile = path.join(dir, 'funnelforge.db');
const sql = new DatabaseSync(dbFile);
sql.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 5000;');
for (const c of COLLECTIONS) sql.exec(`CREATE TABLE IF NOT EXISTS ${c} (id TEXT PRIMARY KEY, data TEXT NOT NULL)`);

const stmt = Object.fromEntries(COLLECTIONS.map((c) => [c, {
  all: sql.prepare(`SELECT data FROM ${c}`),
  upsert: sql.prepare(`INSERT INTO ${c} (id, data) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data`),
  del: sql.prepare(`DELETE FROM ${c} WHERE id = ?`),
  count: sql.prepare(`SELECT COUNT(*) AS n FROM ${c}`),
}]));

// ---------- one-time migration from the old data.json ----------
const legacy = path.join(dir, 'data.json');
if (fs.existsSync(legacy) && COLLECTIONS.every((c) => stmt[c].count.get().n === 0)) {
  const old = JSON.parse(fs.readFileSync(legacy, 'utf8'));
  sql.exec('BEGIN');
  for (const c of COLLECTIONS) for (const r of old[c] || []) { r.id ||= uid(); stmt[c].upsert.run(r.id, JSON.stringify(r)); }
  sql.exec('COMMIT');
  fs.renameSync(legacy, `${legacy}.migrated-${Date.now()}`);
  console.log(`Migrated data.json → ${path.basename(dbFile)}`);
}

// ---------- load into memory ----------
export const db = {};
const last = {}; // collection → Map(id → json last written)
const tail = {}; // append-only collections: array ref + length last written
for (const c of COLLECTIONS) {
  db[c] = stmt[c].all.all().map((r) => JSON.parse(r.data));
  last[c] = new Map(db[c].map((r) => [r.id, JSON.stringify(r)]));
  tail[c] = { ref: db[c], len: db[c].length };
}
for (const c of ['events', 'leads', 'orders', 'abandoned', 'revisions', 'webhooks']) db[c].sort((a, b) => (a.at || 0) - (b.at || 0));

function flushCollection(c) {
  const arr = db[c] || [];
  const seen = APPEND_ONLY.has(c) && arr === tail[c].ref && arr.length >= tail[c].len ? null : new Set();
  const start = seen ? 0 : tail[c].len;
  for (let i = start; i < arr.length; i++) {
    const r = arr[i];
    r.id ||= uid();
    const json = JSON.stringify(r);
    if (last[c].get(r.id) !== json) { stmt[c].upsert.run(r.id, json); last[c].set(r.id, json); }
    seen?.add(r.id);
  }
  if (seen) for (const id of [...last[c].keys()]) if (!seen.has(id)) { stmt[c].del.run(id); last[c].delete(id); }
  tail[c] = { ref: arr, len: arr.length };
}

export function flush() {
  sql.exec('BEGIN');
  try { for (const c of COLLECTIONS) flushCollection(c); sql.exec('COMMIT'); } catch (e) { sql.exec('ROLLBACK'); throw e; }
}

let timer;
export function save() {
  clearTimeout(timer);
  timer = setTimeout(() => { try { flush(); } catch (e) { console.error('DB write failed', e); } }, 50);
}

// Flush pending writes on shutdown
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { clearTimeout(timer); try { flush(); } catch {} process.exit(0); });

// ---------- daily backups (keeps the last 7) ----------
const backupDir = path.join(dir, 'backups');
function backup() {
  try {
    fs.mkdirSync(backupDir, { recursive: true });
    const f = path.join(backupDir, `funnelforge-${new Date().toISOString().slice(0, 10)}.db`);
    if (!fs.existsSync(f)) { flush(); sql.exec(`VACUUM INTO '${f.replace(/'/g, "''")}'`); }
    fs.readdirSync(backupDir).filter((n) => n.endsWith('.db')).sort().slice(0, -7).forEach((n) => fs.rmSync(path.join(backupDir, n)));
  } catch (e) { console.error('Backup failed', e.message); }
}
if (process.env.NODE_ENV !== 'test') { setTimeout(backup, 5000).unref(); setInterval(backup, 6 * 3600000).unref(); }
