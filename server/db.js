// Persistence: SQLite (built into Node ≥ 22.13). Every record is read and written on its own through
// indexed columns, so memory use and request times stay flat no matter how many sellers, funnels or
// page views there are. Each table stores the record as JSON plus the columns used to look it up.
//
//   T.funnels.get(id) · T.funnels.find({ slug }) · T.funnels.all({ userId }, { order: 'updatedAt', desc: true })
//   T.funnels.insert(f) · T.funnels.put(f) · T.funnels.update(id, (f) => { f.name = 'x'; }) · T.funnels.del(id)
//
// node:sqlite is synchronous: a read → change → write with no `await` in between can't interleave with
// another request, so it is atomic. Code that awaits between reading and writing re-reads (or uses update).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync, backup as sqliteBackup } from 'node:sqlite';

export const dir = process.env.DATA_DIR || path.dirname(fileURLToPath(import.meta.url));
fs.mkdirSync(dir, { recursive: true });
export const uid = () => crypto.randomUUID().slice(0, 8);
// In cluster mode only one process runs background jobs (automations, webhook retries, backups…)
export const JOBS = process.env.FF_JOBS !== '0';
// One contact per email (or per phone number when there is no email)
export const contactKey = (email, phone) => (email ? String(email).trim().toLowerCase() : phone ? `phone:${String(phone).trim()}` : '');

const dbFile = path.join(dir, 'funnelforge.db');
export const sql = new DatabaseSync(dbFile);
sql.exec(`PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 5000;
  PRAGMA cache_size = -65536; PRAGMA temp_store = MEMORY; PRAGMA mmap_size = 268435456;`);

// Prepared statements are cached by their SQL text
const stmts = new Map();
export const q = (text) => { let s = stmts.get(text); if (!s) { s = sql.prepare(text); stmts.set(text, s); } return s; };

let depth = 0;
// Runs fn inside one transaction (nested calls join the outer one). fn must be synchronous.
// IMMEDIATE takes the write lock up front, so a read → change → write can't interleave with another
// process (cluster mode); other processes wait (busy_timeout) instead of failing.
export function tx(fn) {
  if (depth) return fn();
  depth++;
  sql.exec('BEGIN IMMEDIATE');
  try { const r = fn(); sql.exec('COMMIT'); return r; } catch (e) { sql.exec('ROLLBACK'); throw e; } finally { depth--; }
}

// ---------- schema ----------
// cols: lookup columns, filled from the record's field of the same name unless a function is given.
const bool = (v) => (v ? 1 : 0);
const lower = (v) => (v ? String(v).trim().toLowerCase() : null);
const SCHEMA = {
  users: { cols: { email: (u) => lower(u.email), plan: (u) => u.billing?.status || null, createdAt: 0 }, unique: [['email']], index: [['createdAt']] },
  funnels: { cols: { userId: 0, slug: 0, updatedAt: 0 }, unique: [['slug']], index: [['userId', 'updatedAt']] },
  revisions: { cols: { funnelId: 0, userId: 0, at: 0 }, index: [['funnelId', 'at']] },
  leads: { cols: { userId: 0, funnelId: 0, ckey: (l) => contactKey(l.email, l.phone), visitor: 0, source: 0, at: 0, demo: (r) => bool(r.demo) }, index: [['userId', 'at'], ['funnelId', 'at'], ['userId', 'ckey'], ['visitor']] },
  orders: { cols: { userId: 0, funnelId: 0, ckey: (o) => contactKey(o.email), visitor: 0, source: 0, total: 0, at: 0, demo: (r) => bool(r.demo) }, index: [['userId', 'at'], ['funnelId', 'at'], ['userId', 'ckey'], ['visitor']] },
  abandoned: { cols: { userId: 0, funnelId: 0, ckey: (a) => contactKey(a.email), visitor: 0, at: 0, recovered: (a) => bool(a.recovered), demo: (r) => bool(r.demo) }, index: [['userId', 'at'], ['funnelId', 'ckey'], ['userId', 'ckey'], ['visitor']] },
  coupons: { cols: { userId: 0, code: 0 }, unique: [['userId', 'code']] },
  webhooks: { cols: { userId: 0, status: 0, nextAt: 0, at: 0 }, index: [['userId', 'at'], ['status', 'nextAt']] },
  saved: { cols: { userId: 0, at: 0 }, index: [['userId', 'at']] },
  crm: { cols: { userId: 0, key: 0 }, unique: [['userId', 'key']] },
  pipelines: { cols: { userId: 0, at: 0 }, index: [['userId', 'at']] },
  automations: { cols: { userId: 0, triggerType: (a) => a.trigger?.type || null, active: (a) => bool(a.active), hookToken: 0 }, index: [['userId', 'triggerType', 'active'], ['triggerType', 'active'], ['hookToken']] },
  runs: { cols: { userId: 0, automationId: 0, key: 0, email: (r) => lower(r.ctx?.email), status: 0, nextAt: 0, at: 0, doneAt: 0 }, index: [['automationId', 'key'], ['automationId', 'status'], ['status', 'nextAt'], ['userId', 'status', 'email']] },
  domains: { cols: { userId: 0, domain: 0, funnelId: 0, status: 0, createdAt: 0 }, index: [['domain'], ['userId'], ['funnelId'], ['status', 'createdAt']] },
  msgs: { cols: { userId: 0, automationId: 0, runId: 0, at: 0 }, index: [['automationId'], ['runId'], ['at']] },
  autoversions: { cols: { automationId: 0, at: 0 }, index: [['automationId', 'at']] },
  payments: { cols: { userId: 0, funnelId: 0, rzpOrderId: 0, status: 0, at: 0 }, index: [['rzpOrderId'], ['status', 'at']] },
  hive: { cols: { userId: 0, updatedAt: 0 }, index: [['userId', 'updatedAt']] },
  mcptokens: { cols: { userId: 0, hash: 0 }, unique: [['hash']], index: [['userId']] },
  // platform: subscription invoices, admin audit log, platform settings (plans, prices)
  invoices: { cols: { userId: 0, status: 0, at: 0, number: 0 }, index: [['userId', 'at'], ['status', 'at']], unique: [['number']] },
  audit: { cols: { actorId: 0, userId: 0, at: 0 }, index: [['at'], ['userId', 'at']] },
  platform: { cols: {} },
};
const COLS = Object.fromEntries(Object.entries(SCHEMA).map(([t, d]) => [t, Object.keys(d.cols)]));

function createTable(t) {
  const d = SCHEMA[t];
  sql.exec(`CREATE TABLE IF NOT EXISTS ${t} (id TEXT PRIMARY KEY, ${COLS[t].map((c) => `${c}`).concat('data TEXT NOT NULL').join(', ')})`);
  for (const cols of d.unique || []) sql.exec(`CREATE UNIQUE INDEX IF NOT EXISTS ux_${t}_${cols.join('_')} ON ${t} (${cols.join(', ')})`);
  for (const cols of d.index || []) sql.exec(`CREATE INDEX IF NOT EXISTS ix_${t}_${cols.join('_')} ON ${t} (${cols.join(', ')})`);
}
// Reports read page views straight from these covering indexes (no table lookups)
function createEvents() {
  sql.exec(`CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY, userId TEXT, funnelId TEXT, stepId TEXT, type TEXT, variant TEXT, source TEXT, visitor TEXT, at INTEGER NOT NULL, demo INTEGER DEFAULT 0);
    DROP INDEX IF EXISTS ix_events_funnel; DROP INDEX IF EXISTS ix_events_user;
    CREATE INDEX IF NOT EXISTS ix_ev_user ON events (userId, type, at, funnelId, visitor, source);
    CREATE INDEX IF NOT EXISTS ix_ev_funnel ON events (funnelId, type, at, stepId, variant, visitor, source);
    CREATE INDEX IF NOT EXISTS ix_ev_at ON events (at);
    CREATE INDEX IF NOT EXISTS ix_ev_demo ON events (userId) WHERE demo = 1;
    CREATE INDEX IF NOT EXISTS ix_events_visitor ON events (visitor);`);
}

// ---------- tables ----------
const colValue = (t, c, obj) => {
  const f = SCHEMA[t].cols[c];
  const v = typeof f === 'function' ? f(obj) : obj[c];
  return v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v;
};
// where: { col: value | [values] | { gt, gte, lt, lte, ne } }
function whereSql(t, where = {}) {
  const parts = [], args = [];
  for (const [c, v] of Object.entries(where)) {
    if (c !== 'id' && !COLS[t].includes(c)) throw new Error(`${t}.${c} is not an indexed column`);
    if (v === undefined) continue;
    if (v === null) parts.push(`${c} IS NULL`);
    else if (Array.isArray(v)) { if (!v.length) { parts.push('0'); continue; } parts.push(`${c} IN (${v.map(() => '?').join(',')})`); args.push(...v); }
    else if (typeof v === 'object') {
      for (const [op, x] of Object.entries(v)) { parts.push(`${c} ${{ gt: '>', gte: '>=', lt: '<', lte: '<=', ne: 'IS NOT' }[op]} ?`); args.push(typeof x === 'boolean' ? (x ? 1 : 0) : x); }
    } else { parts.push(`${c} = ?`); args.push(typeof v === 'boolean' ? (v ? 1 : 0) : v); }
  }
  return { text: parts.length ? ` WHERE ${parts.join(' AND ')}` : '', args };
}
const parse = (row) => (row ? JSON.parse(row.data) : null);

function table(t) {
  const cols = COLS[t];
  const upsertText = `INSERT INTO ${t} (id, ${cols.concat('data').join(', ')}) VALUES (${['?', ...cols, 'data'].map(() => '?').join(', ')}) ON CONFLICT(id) DO UPDATE SET ${cols.concat('data').map((c) => `${c} = excluded.${c}`).join(', ')}`;
  const api = {
    name: t,
    get: (id) => (id == null ? null : parse(q(`SELECT data FROM ${t} WHERE id = ?`).get(String(id)))),
    find(where, opts = {}) { return api.all(where, { ...opts, limit: 1 })[0] || null; },
    all(where = {}, { order, desc, limit, offset } = {}) {
      const w = whereSql(t, where);
      const text = `SELECT data FROM ${t}${w.text}${order ? ` ORDER BY ${order}${desc ? ' DESC' : ''}` : ''}${limit != null ? ` LIMIT ${Number(limit) | 0}` : ''}${offset ? ` OFFSET ${Number(offset) | 0}` : ''}`;
      return q(text).all(...w.args).map(parse);
    },
    // streams rows one at a time (for scans that could be large)
    *iter(where = {}, { order, desc } = {}) {
      const w = whereSql(t, where);
      for (const row of q(`SELECT data FROM ${t}${w.text}${order ? ` ORDER BY ${order}${desc ? ' DESC' : ''}` : ''}`).iterate(...w.args)) yield JSON.parse(row.data);
    },
    count(where = {}) { const w = whereSql(t, where); return q(`SELECT COUNT(*) AS n FROM ${t}${w.text}`).get(...w.args).n; },
    exists(where) { const w = whereSql(t, where); return !!q(`SELECT 1 FROM ${t}${w.text} LIMIT 1`).get(...w.args); },
    ids(where = {}) { const w = whereSql(t, where); return q(`SELECT id FROM ${t}${w.text}`).all(...w.args).map((r) => r.id); },
    put(obj) {
      obj.id ||= uid();
      q(upsertText).run(String(obj.id), ...cols.map((c) => colValue(t, c, obj)), JSON.stringify(obj));
      return obj;
    },
    insert(obj) { return api.put(obj); },
    // read → change → write as one step (also across processes); fn may mutate the record or return a replacement
    update(id, fn) {
      return tx(() => {
        const cur = api.get(id);
        if (!cur) return null;
        const next = fn(cur) || cur;
        return api.put(next);
      });
    },
    del(id) { q(`DELETE FROM ${t} WHERE id = ?`).run(String(id)); },
    delWhere(where) { const w = whereSql(t, where); if (!w.text) throw new Error('delWhere needs a condition'); return q(`DELETE FROM ${t}${w.text}`).run(...w.args).changes; },
  };
  return api;
}

// ---------- counters shared by all processes (rate limits on sign-in and similar) ----------
sql.exec('CREATE TABLE IF NOT EXISTS counters (k TEXT PRIMARY KEY, n INTEGER NOT NULL, reset INTEGER NOT NULL)');
// Adds one hit to key k in the current window; returns { n, reset }
export function hit(k, windowMs) {
  const now = Date.now();
  return q(`INSERT INTO counters (k, n, reset) VALUES (?, 1, ?) ON CONFLICT(k) DO UPDATE SET
    n = CASE WHEN reset < ? THEN 1 ELSE n + 1 END, reset = CASE WHEN reset < ? THEN excluded.reset ELSE reset END RETURNING n, reset`).get(k, now + windowMs, now, now);
}
if (JOBS) setInterval(() => { try { q('DELETE FROM counters WHERE reset < ?').run(Date.now()); } catch {} }, 600000).unref();

// ---------- page-view events (high volume: real columns, no JSON) ----------
const EVENT_COLS = ['userId', 'funnelId', 'stepId', 'type', 'variant', 'source', 'visitor', 'at', 'demo'];
const insertEvent = () => q(`INSERT INTO events (${EVENT_COLS.join(', ')}) VALUES (${EVENT_COLS.map(() => '?').join(', ')})`);
export const Events = {
  add(e) { insertEvent().run(...EVENT_COLS.map((c) => (c === 'demo' ? (e.demo ? 1 : 0) : e[c] ?? null))); },
  addMany(list) { tx(() => { const s = insertEvent(); for (const e of list) s.run(...EVENT_COLS.map((c) => (c === 'demo' ? (e.demo ? 1 : 0) : e[c] ?? null))); }); },
};

// ---------- migrations ----------
const version = () => sql.prepare('PRAGMA user_version').get().user_version;
const tableCols = (t) => sql.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);
const tableExists = (t) => !!sql.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(t);
const LEGACY = ['users', 'funnels', 'leads', 'orders', 'events', 'coupons', 'abandoned', 'revisions', 'webhooks', 'saved', 'crm', 'pipelines', 'automations', 'runs', 'domains', 'msgs', 'autoversions', 'payments', 'hive'];
// records written before userId was stored on them get it from their funnel
// Demo data seeded before records were tagged is recognised by shape: demo events carry no A/B variant,
// demo orders no coupon field, and demo leads/carts use the seeded "name.xxxx@gmail.com" addresses.
const DEMO_EMAIL = /^[a-z]+\.[0-9a-f]{4}@gmail\.com$/;
const LEGACY_DEMO = {
  events: (e) => !('variant' in e) && 'visitor' in e,
  orders: (o) => !('coupon' in o) && DEMO_EMAIL.test(o.email || ''),
  leads: (l) => DEMO_EMAIL.test(l.email || ''),
  abandoned: (a) => DEMO_EMAIL.test(a.email || ''),
};
function backfill(t, r, owner) {
  if (['leads', 'orders', 'abandoned', 'events'].includes(t) && !r.userId) r.userId = owner.get(r.funnelId) || null;
  if (LEGACY_DEMO[t] && !r.demo && LEGACY_DEMO[t](r)) r.demo = true;
  return r;
}
function importRecords(source) {
  // source(t) → iterable of records, for every legacy collection
  const T0 = Date.now();
  const owner = new Map();
  tx(() => {
    for (const t of LEGACY) {
      if (t === 'events') { const s = insertEvent(); for (const e of source(t)) { backfill(t, e, owner); s.run(...EVENT_COLS.map((c) => (c === 'demo' ? (e.demo ? 1 : 0) : e[c] ?? null))); } continue; }
      const tb = T[t];
      for (const r of source(t)) {
        if (t === 'funnels') owner.set(r.id, r.userId);
        if (t === 'users') { for (const tok of r.mcpTokens || []) T.mcptokens.put({ ...tok, userId: r.id }); delete r.mcpTokens; }
        tb.put(backfill(t, r, owner));
      }
    }
  });
  console.log(`Database upgraded to indexed storage in ${((Date.now() - T0) / 1000).toFixed(1)}s`);
}

export const T = {};
const v0 = version();
const legacyTables = v0 < 2 && LEGACY.filter((t) => tableExists(t) && tableCols(t).join(',') === 'id,data');
if (legacyTables?.length) {
  // v1 (one JSON blob per row, everything loaded into memory) → v2 (indexed columns)
  console.log('Upgrading the database to indexed storage (one-time)…');
  for (const t of legacyTables) sql.exec(`ALTER TABLE ${t} RENAME TO legacy_${t}`);
}
for (const t of Object.keys(SCHEMA)) { createTable(t); T[t] = table(t); }
createEvents();
if (legacyTables?.length) {
  importRecords(function* (t) {
    if (!legacyTables.includes(t)) return;
    for (const row of sql.prepare(`SELECT data FROM legacy_${t}`).iterate()) yield JSON.parse(row.data);
  });
  for (const t of legacyTables) sql.exec(`DROP TABLE legacy_${t}`);
}
// one-time migration from the original data.json
const legacyJson = path.join(dir, 'data.json');
if (fs.existsSync(legacyJson) && T.users.count() === 0 && T.funnels.count() === 0) {
  const old = JSON.parse(fs.readFileSync(legacyJson, 'utf8'));
  importRecords((t) => old[t] || []);
  fs.renameSync(legacyJson, `${legacyJson}.migrated-${Date.now()}`);
}
if (v0 < 2) sql.exec('PRAGMA user_version = 2');
// planner statistics (sampled, so it stays quick on big databases)
sql.exec('PRAGMA analysis_limit = 1000; PRAGMA optimize = 0x10002;');

// ---------- maintenance ----------
// Flush the write-ahead log on shutdown
// (the cluster's primary process only runs upgrades; its app processes each handle their own shutdown)
if (process.env.FF_PRIMARY !== '1') for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { try { sql.exec('PRAGMA wal_checkpoint(TRUNCATE)'); sql.close(); } catch {} process.exit(0); });

// Daily backups (keeps the last 7). Uses SQLite's online backup in small steps so the app keeps serving.
const backupDir = path.join(dir, 'backups');
let backingUp = false;
export async function backupNow() {
  if (backingUp) return null;
  backingUp = true;
  try {
    fs.mkdirSync(backupDir, { recursive: true });
    const f = path.join(backupDir, `funnelforge-${new Date().toISOString().slice(0, 10)}.db`);
    if (!fs.existsSync(f)) {
      const tmp = `${f}.partial`;
      fs.rmSync(tmp, { force: true });
      if (sqliteBackup) await sqliteBackup(sql, tmp, { rate: 200 });
      else sql.exec(`VACUUM INTO '${tmp.replace(/'/g, "''")}'`);
      fs.renameSync(tmp, f);
    }
    fs.readdirSync(backupDir).filter((n) => n.endsWith('.db')).sort().slice(0, -7).forEach((n) => fs.rmSync(path.join(backupDir, n)));
    return f;
  } catch (e) { console.error('Backup failed', e.message); return null; } finally { backingUp = false; }
}
export const backupFiles = () => { try { return fs.readdirSync(backupDir).filter((n) => n.endsWith('.db')).sort().reverse().map((n) => ({ name: n, bytes: fs.statSync(path.join(backupDir, n)).size })); } catch { return []; } };
export const dbBytes = () => { try { return fs.statSync(dbFile).size + (fs.existsSync(`${dbFile}-wal`) ? fs.statSync(`${dbFile}-wal`).size : 0); } catch { return 0; } };
if (JOBS && process.env.NODE_ENV !== 'test') { setTimeout(backupNow, 5000).unref(); setInterval(backupNow, 6 * 3600000).unref(); }

// Keep the query planner's statistics fresh (cheap; SQLite only re-analyzes what changed a lot)
if (JOBS) setInterval(() => { try { sql.exec('PRAGMA optimize'); } catch {} }, 3600000).unref();
