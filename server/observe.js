// Observability: health for load balancers / uptime monitors, Prometheus metrics, and error reports to Sentry.
//   GET /api/health          — 200 when the database answers and background jobs are alive; 503 otherwise
//   GET /metrics             — Prometheus text (set METRICS_TOKEN; scrape with Authorization: Bearer <token>)
//   SENTRY_DSN=https://<key>@<host>/<project> — server errors are reported (stack, route, user id — no request bodies)
//   LOG_REQUESTS=1           — one JSON line per request (method, path, status, ms)
import os from 'node:os';
import crypto from 'node:crypto';
import { T, q, JOBS, dbBytes, backupFiles, offsiteStatus } from './db.js';

const startedAt = Date.now();
const worker = process.env.WORKER_INDEX || '0';
const counts = new Map(); // "method status" → n
const buckets = [0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];
const hist = buckets.map(() => 0);
let histSum = 0, histCount = 0, lag = 0;

// event-loop lag: how late a 500 ms timer fires
let tick = Date.now();
setInterval(() => { const now = Date.now(); lag = Math.max(0, now - tick - 500); tick = now; }, 500).unref();

// background jobs prove they're alive (the jobs process writes, any process reads)
const HEARTBEAT = 'heartbeat';
if (JOBS) {
  const beat = () => { try { T.platform.put({ id: HEARTBEAT, at: Date.now(), pid: process.pid }); } catch {} };
  beat(); setInterval(beat, 60000).unref();
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
  app.get('/api/health', (req, res) => {
    let db = true;
    try { q('SELECT 1').get(); } catch { db = false; }
    const hb = (() => { try { return T.platform.get(HEARTBEAT)?.at || 0; } catch { return 0; } })();
    const jobsOk = !hb ? process.env.NODE_ENV === 'test' || Date.now() - startedAt < 180000 : Date.now() - hb < 5 * 60000;
    const ok = db && jobsOk;
    // internals (queues, backups, memory) only with METRICS_TOKEN — or with no token outside production (local dev)
    const detail = req.query.detail === '1' && (process.env.METRICS_TOKEN ? req.headers.authorization === `Bearer ${process.env.METRICS_TOKEN}` : process.env.NODE_ENV !== 'production');
    res.status(ok ? 200 : 503).json({
      ok, db, jobs: jobsOk, uptimeSec: Math.round((Date.now() - startedAt) / 1000), worker,
      ...(detail ? { queues: queues(), dbMB: Math.round(dbBytes() / 1e6), lastBackup: backupFiles()[0] || null, offsite: offsiteStatus(), lagMs: lag, rssMB: Math.round(process.memoryUsage().rss / 1e6), load: os.loadavg()[0] } : {}),
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
export function reportError(err, ctx = {}) {
  if (!dsn) return;
  if (Date.now() - windowStart > 60000) { windowStart = Date.now(); sent = 0; }
  if (++sent > 30) return; // never flood
  const frames = String(err?.stack || '').split('\n').slice(1, 30).map((l) => { const m = /at (?:(.+?) \()?(.+?):(\d+):(\d+)\)?$/.exec(l.trim()); return m ? { function: m[1] || '?', filename: m[2], lineno: Number(m[3]), colno: Number(m[4]) } : null; }).filter(Boolean).reverse();
  const event = {
    event_id: crypto.randomUUID().replace(/-/g, ''), timestamp: Date.now() / 1000, platform: 'node', level: 'error', server_name: os.hostname(),
    environment: process.env.NODE_ENV || 'production', release: process.env.APP_VERSION || undefined,
    exception: { values: [{ type: err?.name || 'Error', value: String(err?.message || err).slice(0, 500), stacktrace: { frames } }] },
    tags: { worker, route: ctx.route || '' }, user: ctx.userId ? { id: ctx.userId } : undefined,
  };
  fetch(`https://${dsn.host}/api/${dsn.project}/store/?sentry_version=7&sentry_key=${dsn.key}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(event), signal: AbortSignal.timeout(5000) }).catch(() => {});
}
process.on('unhandledRejection', (e) => { console.error('Unhandled rejection', e); reportError(e, { route: 'unhandledRejection' }); });
