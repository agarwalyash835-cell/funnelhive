// Smoke test for a running server (local, staging or live) — read-only, safe to point at production.
// Checks health, the landing and login pages, the app bundle, public APIs and (optionally) a published funnel,
// with timings. Exits 1 if anything fails, so it can run after every deploy or from a cron / uptime check.
//
//   node server/scripts/smoke.mjs https://app.yourdomain.com
//   node server/scripts/smoke.mjs https://app.yourdomain.com --funnel my-funnel-slug --token $METRICS_TOKEN
const args = process.argv.slice(2);
const base = (args.find((a) => /^https?:\/\//.test(a)) || process.env.APP_URL || 'http://localhost:4000').replace(/\/$/, '');
const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const funnel = opt('--funnel'), token = opt('--token') || process.env.METRICS_TOKEN;
const SLOW = Number(opt('--slow-ms') || 1500);
let failed = 0;
const results = [];

async function check(name, path, test, headers = {}) {
  const t = Date.now();
  try {
    const r = await fetch(base + path, { headers: { 'user-agent': 'FunnelHive-smoke/1', ...headers }, redirect: 'manual', signal: AbortSignal.timeout(15000) });
    const body = await r.text();
    const ms = Date.now() - t;
    const err = test(r, body);
    results.push({ name, ok: !err, ms, note: err || (ms > SLOW ? `slow (${ms} ms)` : '') });
    if (err) failed++;
    return { r, body };
  } catch (e) {
    results.push({ name, ok: false, ms: Date.now() - t, note: e.name === 'TimeoutError' ? 'timed out after 15 s' : e.message });
    failed++;
    return null;
  }
}
const json = (b) => { try { return JSON.parse(b); } catch { return null; } };

const health = await check('health', '/api/health', (r, b) => (r.status !== 200 ? `HTTP ${r.status} ${b.slice(0, 120)}` : !json(b)?.db ? 'database not ok' : null));
if (token) {
  await check('health detail', '/api/health?detail=1', (r, b) => {
    const d = json(b);
    if (r.status !== 200 || !d?.queues) return `HTTP ${r.status}`;
    const backupAge = d.lastBackup ? null : 'no backup yet';
    if (d.offsite && d.offsite.ok === false) return `off-site backup failing: ${d.offsite.error}`;
    return backupAge;
  }, { authorization: `Bearer ${token}` });
}
const home = await check('landing page', '/', (r, b) => (r.status !== 200 ? `HTTP ${r.status}` : !/<div id="root"|<html/i.test(b) ? 'not an HTML page' : null));
await check('login page', '/login', (r) => (r.status !== 200 ? `HTTP ${r.status}` : null));
const asset = home?.body.match(/\/assets\/[\w.-]+\.js/)?.[0];
if (asset) await check('app bundle', asset, (r) => (r.status !== 200 ? `HTTP ${r.status}` : null));
else { results.push({ name: 'app bundle', ok: false, ms: 0, note: 'no /assets/*.js linked from the landing page' }); failed++; }
await check('site settings', '/api/site', (r, b) => (r.status !== 200 || !json(b)?.brand ? `HTTP ${r.status}` : null));
await check('templates', '/api/templates', (r, b) => (r.status !== 200 || !(json(b)?.length > 0) ? `HTTP ${r.status}, ${json(b)?.length ?? 0} templates` : null));
await check('policy page', '/privacy', (r) => (r.status !== 200 ? `HTTP ${r.status}` : null));
await check('auth required', '/api/funnels', (r) => (r.status !== 401 ? `expected 401 without a login, got ${r.status}` : null));
if (funnel) {
  await check(`funnel data (${funnel})`, `/api/public/${encodeURIComponent(funnel)}`, (r, b) => (r.status !== 200 || !json(b)?.steps ? `HTTP ${r.status}` : null));
  await check(`funnel page (${funnel})`, `/f/${encodeURIComponent(funnel)}`, (r, b) => (r.status !== 200 ? `HTTP ${r.status}` : b.length < 500 ? 'page looks empty' : null));
}

const w = Math.max(...results.map((x) => x.name.length));
console.log(`Smoke test · ${base}${health?.r ? ` · up ${json(health.body)?.uptimeSec ?? '?'} s` : ''}\n`);
for (const x of results) console.log(`${x.ok ? '✓' : '✗'} ${x.name.padEnd(w)}  ${String(x.ms).padStart(5)} ms  ${x.note || ''}`);
console.log(failed ? `\n${failed} check(s) FAILED` : '\nAll checks passed');
process.exitCode = failed ? 1 : 0;
