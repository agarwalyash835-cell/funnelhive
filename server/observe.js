// Observability: health for load balancers / uptime monitors, Prometheus metrics, and error reports to Sentry.
//   GET /api/health          — 200 when the database answers, background jobs are alive and the disk isn't full; 503 otherwise
//   GET /api/health/backups  — for an uptime monitor: fresh backups (local + off-site) and a passing restore drill
//   GET /api/health/disk     — for an uptime monitor: 503 when the data disk has < 5% or < 1 GB free
//   GET /metrics             — Prometheus text (set METRICS_TOKEN; scrape with Authorization: Bearer <token>)
//   SENTRY_DSN=https://<key>@<host>/<project> — server errors, crashes and unhandled rejections are reported (stack,
//                              route, user id — never request bodies, headers or cookies; emails / phones / tokens in
//                              messages are masked)
//   LOG_REQUESTS=1           — one JSON line per request (method, path, status, ms)
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { q, JOBS, dbBytes, backupFiles, offsiteStatus, dir, shutdown } from './db.js';
import { drillStatus } from './upkeep.js';

const startedAt = Date.now();
const worker = process.env.WORKER_INDEX || '0';
const counts = new Map(); // "method status" → n
const buckets = [0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];
const hist = buckets.map(() => 0);
let histSum = 0, histCount = 0, lag = 0;

// event-loop lag: how late a 500 ms timer fires
let tick = Date.now();
setInterval(() => { const now = Date.now(); lag = Math.max(0, now - tick - 500); tick = now; }, 500).unref();

// background jobs prove they're alive (the jobs process writes, any process reads) — a small file next to the
// database rather than a row in it, so a quiet server's database really is unchanged and the hourly backup can skip
const HEARTBEAT = path.join(dir, '.jobs-heartbeat');
if (JOBS) {
  const beat = () => { try { fs.writeFileSync(HEARTBEAT, String(Date.now())); } catch {} };
  beat(); setInterval(beat, 60000).unref();
}
const heartbeatAt = () => { try { return Number(fs.readFileSync(HEARTBEAT, 'utf8')) || 0; } catch { return 0; } };

// free space on the data disk (database, backups, uploads); checked at most every 10 s. Not ok below 5% or 1 GB
// (DISK_MIN_FREE_PCT / DISK_MIN_FREE_GB change the limits)
let diskSeen = { at: 0 };
export function diskStatus() {
  if (Date.now() - diskSeen.at < 10000) return diskSeen.v;
  let v;
  try {
    const s = fs.statfsSync(dir), free = s.bavail * s.bsize, total = s.blocks * s.bsize;
    const diskFreeGB = +(free / 1e9).toFixed(2), diskFreePct = total ? +((free / total) * 100).toFixed(1) : 100;
    v = { ok: diskFreeGB >= Number(process.env.DISK_MIN_FREE_GB ?? 1) && diskFreePct >= Number(process.env.DISK_MIN_FREE_PCT ?? 5), diskFreeGB, diskFreePct };
  } catch { v = { ok: true, diskFreeGB: null, diskFreePct: null }; } // can't tell: don't raise an alarm
  diskSeen = { at: Date.now(), v };
  return v;
}

export function requestMetrics(req, res, next) {
  const t0 = process.hrtime.bigint();
  res.on('finish', () => {
    const s = Number(process.hrtime.bigint() - t0) / 1e9;
    const k = `${req.method} ${String(res.statusCode)[0]}xx`;
    counts.set(k, (counts.get(k) || 0) + 1);
    histSum += s; histCount++;
    buckets.forEach((b, i) => { if (s <= b) hist[i]++; });
    if (process.env.LOG_REQUESTS === '1' && !req.originalUrl.startsWith('/assets')) console.log(JSON.stringify({ t: new Date().toISOString(), w: worker, m: req.method, p: req.originalUrl.split('?')[0].slice(0, 120), s: res.statusCode, ms: Math.round(s * 1000), u: req.user?.id }));
  });
  next();
}

function queues() {
  const n = (sql, ...a) => { try { return q(sql).get(...a)?.n || 0; } catch { return 0; } };
  const now = Date.now();
  return {
    webhooksPending: n("SELECT COUNT(*) AS n FROM webhooks WHERE status = 'pending'"),
    automationRunsDue: n("SELECT COUNT(*) AS n FROM runs WHERE status = 'active' AND nextAt <= ?", now),
    broadcastQueued: n("SELECT COUNT(*) AS n FROM bsends WHERE status = 'queued' AND nextAt <= ?", now),
    conversionsPending: n("SELECT COUNT(*) AS n FROM conversions WHERE json_extract(data, '$.status') IN ('pending', 'retry')"),
  };
}

export function registerObserve(app) {
  // tests only: a slow request, and a shutdown trigger (Windows has no SIGTERM for a child process)
  if (process.env.NODE_ENV === 'test') {
    app.get('/api/health/test-slow', (req, res) => setTimeout(() => res.json({ ok: true, slow: true }), Number(req.query.ms) || 1500));
    app.post('/api/health/test-shutdown', (req, res) => { res.json({ ok: true }); setTimeout(() => shutdown(0), 10); });
  }
  // for an uptime monitor: 503 when no backup (or, with file storage, no off-site copy) succeeded in 30 hours, or
  // when the last weekly restore drill failed
  app.get('/api/health/backups', async (req, res) => {
    const { s3Enabled } = await import('./storage.js');
    const fresh = (t) => t && Date.now() - t < 30 * 3600000;
    const f = backupFiles()[0], off = offsiteStatus(), booting = Date.now() - startedAt < 15 * 60000;
    let local = false;
    try { local = !!f && fresh(fs.statSync(path.join(dir, 'backups', f.name)).mtimeMs); } catch {}
    const offsite = !s3Enabled() ? null : off ? off.ok && fresh(off.at) : booting;
    const drill = drillStatus();
    const ok = (local || booting) && offsite !== false && drill?.ok !== false;
    res.set('Cache-Control', 'no-store').status(ok ? 200 : 503).json({ ok, local, offsite, restoreDrill: drill ? { at: drill.at, ok: drill.ok } : null });
  });
  app.get('/api/health/disk', (req, res) => {
    const d = diskStatus();
    res.set('Cache-Control', 'no-store').status(d.ok ? 200 : 503).json(d);
  });
  app.get('/api/health', (req, res) => {
    let db = true;
    try { q('SELECT 1').get(); } catch { db = false; }
    const hb = heartbeatAt();
    const jobsOk = !hb ? process.env.NODE_ENV === 'test' || Date.now() - startedAt < 180000 : Date.now() - hb < 5 * 60000;
    const disk = diskStatus();
    const ok = db && jobsOk && disk.ok;
    // internals (queues, backups, memory) only with METRICS_TOKEN — or with no token outside production (local dev)
    const detail = req.query.detail === '1' && (process.env.METRICS_TOKEN ? req.headers.authorization === `Bearer ${process.env.METRICS_TOKEN}` : process.env.NODE_ENV !== 'production');
    res.status(ok ? 200 : 503).json({
      ok, db, jobs: jobsOk, disk: disk.ok, uptimeSec: Math.round((Date.now() - startedAt) / 1000), worker,
      ...(detail ? { queues: queues(), dbMB: Math.round(dbBytes() / 1e6), lastBackup: backupFiles()[0] || null, offsite: offsiteStatus(), restoreDrill: drillStatus(), diskFreeGB: disk.diskFreeGB, diskFreePct: disk.diskFreePct, lagMs: lag, rssMB: Math.round(process.memoryUsage().rss / 1e6), load: os.loadavg()[0] } : {}),
    });
  });
  app.get('/metrics', (req, res) => {
    if (!process.env.METRICS_TOKEN || req.headers.authorization !== `Bearer ${process.env.METRICS_TOKEN}`) return res.status(404).end();
    const L = [], w = `worker="${worker}"`;
    const g = (name, help, v, type = 'gauge', labels = w) => { L.push(`# HELP ${name} ${help}`, `# TYPE ${name} ${type}`, `${name}{${labels}} ${v}`); };
    L.push('# HELP ff_http_requests_total Requests by method and status class', '# TYPE ff_http_requests_total counter');
    for (const [k, v] of counts) { const [m, s] = k.split(' '); L.push(`ff_http_requests_total{${w},method="${m}",status="${s}"} ${v}`); }
    L.push('# HELP ff_http_request_seconds Request duration', '# TYPE ff_http_request_seconds histogram');
    buckets.forEach((b, i) => L.push(`ff_http_request_seconds_bucket{${w},le="${b}"} ${hist[i]}`));
    L.push(`ff_http_request_seconds_bucket{${w},le="+Inf"} ${histCount}`, `ff_http_request_seconds_sum{${w}} ${histSum.toFixed(3)}`, `ff_http_request_seconds_count{${w}} ${histCount}`);
    g('ff_event_loop_lag_ms', 'Event loop lag', lag);
    g('ff_process_rss_bytes', 'Resident memory', process.memoryUsage().rss);
    g('ff_db_bytes', 'Database size including WAL', dbBytes());
    for (const [k, v] of Object.entries(queues())) g(`ff_queue_${k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)}`, `Queue depth: ${k}`, v);
    const n = (sql) => { try { return q(sql).get().n; } catch { return 0; } };
    g('ff_users_total', 'Accounts', n('SELECT COUNT(*) AS n FROM users'));
    g('ff_funnels_live', 'Published funnels', n("SELECT COUNT(*) AS n FROM funnels WHERE json_extract(data, '$.published') = 1"));
    g('ff_orders_24h', 'Orders in the last 24 hours', n(`SELECT COUNT(*) AS n FROM orders WHERE at > ${Date.now() - 86400000}`));
    res.type('text/plain; version=0.0.4').send(`${L.join('\n')}\n`);
  });
}

// ---------- Sentry ----------
const dsn = (() => { const m = /^https:\/\/([^@]+)@([^/]+)\/(\d+)$/.exec(process.env.SENTRY_DSN || ''); return m ? { key: m[1], host: m[2], project: m[3] } : null; })();
let sent = 0, windowStart = Date.now();
// nothing personal leaves in an error report: emails, phone numbers and keys / tokens are masked (and a route's
// query string dropped)
export const scrub = (v) => String(v ?? '')
  .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[email]')
  .replace(/\b(Bearer|Basic)\s+\S+/gi, '$1 [token]')
  .replace(/\b(?:sk|pk|rzp|whsec|fh)_[\w-]{8,}/g, '[key]')
  .replace(/\b(?=[\w-]*\d)[\w-]{24,}/g, '[token]')
  .replace(/\+?\d[\d\s-]{8,}\d/g, '[number]');
// returns a promise (resolves when sent, or straight away) so a crashing process can wait for its report
export function reportError(err, ctx = {}) {
  if (!dsn) return Promise.resolve();
  if (Date.now() - windowStart > 60000) { windowStart = Date.now(); sent = 0; }
  if (++sent > 30) return Promise.resolve(); // never flood
  const frames = String(err?.stack || '').split('\n').slice(1, 30).map((l) => { const m = /at (?:(.+?) \()?(.+?):(\d+):(\d+)\)?$/.exec(l.trim()); return m ? { function: m[1] || '?', filename: m[2], lineno: Number(m[3]), colno: Number(m[4]) } : null; }).filter(Boolean).reverse();
  const event = {
    event_id: crypto.randomUUID().replace(/-/g, ''), timestamp: Date.now() / 1000, platform: 'node', level: 'error', server_name: os.hostname(),
    environment: process.env.NODE_ENV || 'production', release: process.env.APP_VERSION || undefined,
    exception: { values: [{ type: err?.name || 'Error', value: scrub(err?.message || err).slice(0, 500), stacktrace: { frames } }] },
    tags: { worker, route: scrub(String(ctx.route || '').split('?')[0]).slice(0, 200) }, user: ctx.userId ? { id: ctx.userId } : undefined,
  };
  return fetch(`https://${dsn.host}/api/${dsn.project}/store/?sentry_version=7&sentry_key=${dsn.key}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(event), signal: AbortSignal.timeout(5000) }).then(() => {}, () => {});
}
// a promise nobody caught: logged and reported, the process carries on (as before)
process.on('unhandledRejection', (e) => { console.error('Unhandled rejection', e); reportError(e, { route: 'unhandledRejection' }); });
// an exception nobody caught leaves the process in an unknown state: log it, report it (up to 2 s), then exit 1 —
// the cluster's primary starts a fresh process (start.js), or Docker restarts the container
process.on('uncaughtException', (e) => {
  console.error('Uncaught exception — restarting', e);
  Promise.race([reportError(e, { route: 'uncaughtException' }), new Promise((r) => setTimeout(r, 2000))]).finally(() => process.exit(1));
});
