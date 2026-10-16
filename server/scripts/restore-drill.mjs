// Restore drill: proves a backup really restores. Copies the newest backup (or --file, or the newest one in the
// storage bucket with --bucket) to a throwaway folder, checks the file (integrity, tables, row counts, how fresh it
// is), then boots the app on the copy with background jobs OFF (no emails, automations or webhooks fire) and checks
// that it answers. Your live database is never opened.
//
//   node server/scripts/restore-drill.mjs                    newest file in DATA_DIR/backups
//   node server/scripts/restore-drill.mjs --file x.db        a specific backup
//   node server/scripts/restore-drill.mjs --bucket           newest backup in the S3 / R2 bucket (S3_* env)
// Off-site copies (backups/*.db.enc) are encrypted: they're decrypted with ENCRYPTION_KEY (or the JWT secret) first.
//   add --keep to keep the restored copy for a look around
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const here = path.dirname(fileURLToPath(import.meta.url));
const serverDir = path.join(here, '..');
const args = process.argv.slice(2);
const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const dataDir = process.env.DATA_DIR || serverDir;
const fail = (msg) => { console.error(`\n✗ RESTORE DRILL FAILED: ${msg}`); process.exit(1); };
const ok = (msg) => console.log(`✓ ${msg}`);
const t0 = Date.now();

// 1. the backup
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'fh-restore-'));
const target = path.join(work, 'funnelhive.db');
let source;
if (args.includes('--bucket')) {
  // storage entered in the admin panel (no S3_* env): read it from the live database, read-only
  if (!process.env.S3_ENDPOINT && fs.existsSync(path.join(dataDir, 'funnelhive.db'))) {
    const live = new DatabaseSync(path.join(dataDir, 'funnelhive.db'), { readOnly: true });
    const s = JSON.parse(live.prepare("SELECT data FROM platform WHERE id = 'settings'").get()?.data || '{}').storage;
    live.close();
    if (s?.secretEnc) {
      const crypto = await import('node:crypto');
      const key = crypto.createHash('sha256').update(`channels:${process.env.ENCRYPTION_KEY || process.env.JWT_SECRET}`).digest();
      const [, iv, tag, data] = String(s.secretEnc).split(':');
      const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64')); d.setAuthTag(Buffer.from(tag, 'base64'));
      Object.assign(process.env, { S3_ENDPOINT: s.endpoint, S3_BUCKET: s.bucket, S3_REGION: s.region || 'auto', S3_ACCESS_KEY: s.key, S3_SECRET_KEY: Buffer.concat([d.update(Buffer.from(data, 'base64')), d.final()]).toString() });
    }
  }
  const { s3Enabled, listKeys, getObject } = await import('../storage.js');
  if (!s3Enabled()) fail('no storage bucket configured (S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY)');
  const keys = (await listKeys('backups/')).map((k) => (typeof k === 'string' ? k : k.key)).filter((k) => /\.db(\.enc)?$/.test(k)).sort();
  if (!keys.length) fail('no backups in the bucket yet');
  source = `bucket:${keys.at(-1)}`;
  const buf = await getObject(keys.at(-1));
  const { isEncrypted, decryptBuffer } = await import('../backup-crypt.js');
  try { fs.writeFileSync(target, isEncrypted(buf) ? decryptBuffer(buf, dataDir) : buf); } catch (e) { fail(e.message); }
  if (isEncrypted(buf)) ok('decrypted the off-site copy');
} else {
  source = opt('--file');
  if (!source) {
    const bdir = path.join(dataDir, 'backups');
    const files = fs.existsSync(bdir) ? fs.readdirSync(bdir).filter((n) => n.endsWith('.db')).sort() : [];
    if (!files.length) fail(`no backups in ${bdir} — start the app once (it backs up 5 s after start) or press Admin → Back up now`);
    source = path.join(bdir, files.at(-1));
  }
  if (!fs.existsSync(source)) fail(`${source} not found`);
  const { isEncrypted, decryptBuffer } = await import('../backup-crypt.js');
  const buf = fs.readFileSync(source);
  try { fs.writeFileSync(target, isEncrypted(buf) ? decryptBuffer(buf, dataDir) : buf); } catch (e) { fail(e.message); }
}
const mb = (fs.statSync(target).size / 1e6).toFixed(1);
ok(`copied ${source} (${mb} MB) → ${work}`);

// 2. the file itself
const db = new DatabaseSync(target, { readOnly: true });
const integrity = db.prepare('PRAGMA integrity_check').all().map((r) => Object.values(r)[0]);
if (integrity.join() !== 'ok') fail(`integrity check: ${integrity.slice(0, 5).join('; ')}`);
ok('integrity check: ok');
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map((r) => r.name);
const MUST = ['users', 'funnels', 'orders', 'leads', 'payments', 'platform'];
const missing = MUST.filter((t) => !tables.includes(t));
if (missing.length) fail(`missing tables: ${missing.join(', ')}`);
const counts = Object.fromEntries(tables.map((t) => [t, db.prepare(`SELECT COUNT(*) AS n FROM "${t}"`).get().n]));
console.log(`  rows: ${Object.entries(counts).filter(([, n]) => n).map(([t, n]) => `${t} ${n.toLocaleString('en-IN')}`).join(' · ')}`);
const newest = (t, col) => { try { return db.prepare(`SELECT MAX(${col}) AS m FROM "${t}"`).get().m || 0; } catch { return 0; } };
const last = Math.max(newest('events', 'at'), newest('orders', 'at'), newest('leads', 'at'), newest('audit', 'at'));
if (last) ok(`newest activity in the backup: ${new Date(last).toISOString()} (${((Date.now() - last) / 3600000).toFixed(1)} h ago)`);
const pub = db.prepare("SELECT json_extract(data, '$.slug') AS slug FROM funnels WHERE json_extract(data, '$.published') = 1 LIMIT 1").get()?.slug;
db.close();

// 3. boot the app on the copy (jobs off, no mail / payment / AI keys: nothing leaves this machine)
const port = await new Promise((r) => { const s = net.createServer().listen(0, () => { const p = s.address().port; s.close(() => r(p)); }); });
const env = { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, DATA_DIR: work, PORT: String(port), FF_JOBS: '0', NODE_ENV: 'production', APP_URL: `http://127.0.0.1:${port}` };
const app = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', path.join(serverDir, 'index.js')], { env, stdio: ['ignore', 'pipe', 'pipe'] });
let log = '';
app.stdout.on('data', (d) => { log += d; });
app.stderr.on('data', (d) => { log += d; });
const stop = () => { try { app.kill(); } catch {} };
const base = `http://127.0.0.1:${port}`;
const get = async (p) => { const r = await fetch(base + p, { signal: AbortSignal.timeout(10000) }); return { status: r.status, body: await r.text() }; };
let up = false;
for (let i = 0; i < 120 && !up; i++) { await new Promise((r) => setTimeout(r, 500)); try { up = (await get('/api/health')).status > 0; } catch {} if (app.exitCode != null) break; }
if (!up) { stop(); fail(`the app didn't start on the restored copy:\n${log.slice(-2000)}`); }
const h = JSON.parse((await get('/api/health')).body);
if (!h.db) { stop(); fail('the app started but can’t read the restored database'); }
ok(`the app boots on the restored copy (port ${port}, database ok)`);
const site = await get('/api/site');
if (site.status !== 200) { stop(); fail(`/api/site → ${site.status}`); }
ok(`site settings load (${JSON.parse(site.body).brand})`);
if (pub) {
  const f = await get(`/api/public/${encodeURIComponent(pub)}`);
  if (f.status !== 200) { stop(); fail(`published funnel /${pub} → ${f.status}`); }
  ok(`a published funnel (${pub}) serves from the restored data`);
}
stop();
await new Promise((r) => setTimeout(r, 500));
if (args.includes('--keep')) console.log(`  restored copy kept in ${work}`);
else try { fs.rmSync(work, { recursive: true, force: true }); } catch {}
console.log(`\nRESTORE DRILL PASSED in ${((Date.now() - t0) / 1000).toFixed(1)} s — this backup restores.`);
