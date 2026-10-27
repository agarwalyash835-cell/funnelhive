#!/usr/bin/env node
// Load test on a throwaway copy of the app — never production. Runs the production entry (start.js) with production
// rate limits, background jobs on, AI / mail / payments off, on its own empty database, then:
//   1. onboards N sellers at once (sign-up, legal details, a sales funnel from a template, published, a product,
//      contacts imported from a spreadsheet)
//   2. sends their visitors in rising waves: open a page (server-rendered), page-view event, some sign up, some order
//   3. the same visitors while every seller keeps their dashboard and contacts open
// Every visitor gets its own IP (as behind Caddy), so per-network limits behave as in real life.
//   node evals/load.mjs                                  200 sellers, waves 25 → 400 visitors at once
//   node evals/load.mjs --sellers 50 --waves 25,50 --secs 20 --cores 2 --contacts 300
// --cores pins the app to that many CPU cores (Windows), to resemble the 2-core server.
import fs from 'node:fs';
import os from 'node:os';
import net from 'node:net';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const SELLERS = Number(arg('sellers', 200)), CONTACTS = Number(arg('contacts', 300)), SECS = Number(arg('secs', 30));
const WAVES = String(arg('waves', '25,50,100,200,400')).split(',').map(Number), CORES = Number(arg('cores', 2)), PROCS = Number(arg('procs', 2));

const freePort = () => new Promise((r) => { const s = net.createServer().listen(0, () => { const p = s.address().port; s.close(() => r(p)); }); });
const port = await freePort();
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fh-load-'));
const quiet = Object.fromEntries(['KIE_API_KEY', 'ANTHROPIC_API_KEY', 'SMTP_HOST', 'SMTP_USER', 'SMTP_PASS', 'RESEND_API_KEY', 'RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET', 'STRIPE_SECRET_KEY', 'COMPOSIO_API_KEY', 'SENTRY_DSN', 'WASABI_KEY', 'R2_ACCESS_KEY_ID', 'PAGES_URL', 'SARVAM_API_KEY', 'OPENROUTER_API_KEY', 'TURNSTILE_SECRET_KEY', 'TURNSTILE_SITE_KEY', 'PLATFORM_RAZORPAY_KEY_ID', 'PLATFORM_RAZORPAY_KEY_SECRET'].map((k) => [k, '']));
const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'start.js'], {
  cwd: serverDir, env: { ...process.env, ...quiet, PORT: String(port), DATA_DIR: dataDir, NODE_ENV: 'production', WEB_CONCURRENCY: String(PROCS), JWT_SECRET: 'load-test-only', APP_URL: `http://127.0.0.1:${port}` }, stdio: ['ignore', 'pipe', 'pipe'],
});
let log = '';
child.stdout.on('data', (d) => { log += d; }); child.stderr.on('data', (d) => { log += d; });
const base = `http://127.0.0.1:${port}`;
for (let i = 0; i < 600; i++) { try { if ((await fetch(`${base}/api/health`)).ok) break; } catch {} await new Promise((r) => setTimeout(r, 100)); }

// the app's processes (the cluster primary + its workers): pin them to CORES cores, read their memory
const ps = (script) => execFileSync('powershell', ['-NoProfile', '-Command', script], { encoding: 'utf8' }).trim();
const tree = `Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -eq ${child.pid} -or $_.ParentProcessId -eq ${child.pid} }`;
if (process.platform === 'win32' && CORES > 0) ps(`${tree} | ForEach-Object { (Get-Process -Id $_.ProcessId).ProcessorAffinity = ${(1 << CORES) - 1} }`);
const memMB = () => { try { return Math.round(Number(ps(`(${tree} | ForEach-Object { (Get-Process -Id $_.ProcessId).WorkingSet64 } | Measure-Object -Sum).Sum`)) / 1048576); } catch { return null; } };

let ipN = 0;
const ip = () => { ipN++; return `203.${(ipN >> 16) & 255}.${(ipN >> 8) & 255}.${ipN & 255}`; };
const stats = new Map();
const rec = (name, ms, status) => { const s = stats.get(name) || { ms: [], codes: {} }; s.ms.push(ms); s.codes[status] = (s.codes[status] || 0) + 1; stats.set(name, s); };
async function hit(name, p, { method = 'GET', body, token, from, raw } = {}) {
  const t0 = performance.now();
  let status = 'ERR', data = null;
  try {
    const r = await fetch(base + p, { method, headers: { 'content-type': 'application/json', 'x-forwarded-for': from || ip(), ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30000) });
    status = r.status;
    data = raw ? await r.text() : await r.json().catch(() => ({}));
  } catch (e) { status = /timeout|abort/i.test(e.message) ? 'TIMEOUT' : 'ERR'; }
  rec(name, performance.now() - t0, status);
  return { status, data };
}
const pct = (a, p) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]; };
function table(title, ms) {
  const rows = [...stats].map(([name, s]) => {
    const n = s.ms.length, bad = Object.entries(s.codes).filter(([c]) => !/^2/.test(c)).reduce((a, [, v]) => a + v, 0);
    return { name, n, rps: ms ? +(n / (ms / 1000)).toFixed(1) : null, p50: Math.round(pct(s.ms, 50)), p95: Math.round(pct(s.ms, 95)), p99: Math.round(pct(s.ms, 99)), max: Math.round(Math.max(...s.ms)), errors: bad, codes: s.codes };
  });
  const all = rows.reduce((a, r) => a + r.n, 0), allBad = rows.reduce((a, r) => a + r.errors, 0);
  const allMs = [...stats.values()].flatMap((s) => s.ms);
  const sum = { title, requests: all, rps: ms ? +(all / (ms / 1000)).toFixed(1) : null, p95: Math.round(pct(allMs, 95)), errorPct: +((allBad / Math.max(1, all)) * 100).toFixed(2), memMB: memMB(), rows };
  process.stdout.write(`\n— ${title}: ${all} requests${ms ? `, ${sum.rps}/s` : ''}, p95 ${sum.p95} ms, errors ${sum.errorPct}%, app memory ${sum.memMB} MB\n`);
  for (const r of rows) process.stdout.write(`   ${r.name.padEnd(22)} n=${String(r.n).padStart(6)}  p50 ${String(r.p50).padStart(5)}  p95 ${String(r.p95).padStart(5)}  p99 ${String(r.p99).padStart(5)}  max ${String(r.max).padStart(6)} ms  ${r.errors ? `✖ ${JSON.stringify(r.codes)}` : ''}\n`);
  stats.clear();
  return sum;
}
const pool = async (items, n, fn) => { let i = 0; await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const k = i++; await fn(items[k], k); } })); };

const report = { at: new Date().toISOString(), sellers: SELLERS, contactsEach: CONTACTS, procs: PROCS, cores: CORES, phases: [] };
const sellers = [];
try {
  // ---------- 1. onboarding ----------
  const list = (await hit('templates', '/api/templates')).data;
  let tpl = null;
  for (const x of list.filter((y) => ['product', 'course'].includes(y.kind))) {
    const types = ((await hit('template', `/api/templates/${x.id}`)).data.steps || []).map((s) => s.type);
    if (types.includes('checkout') && types.includes('thankyou')) { tpl = x; break; }
  }
  const t1 = Date.now();
  await pool(Array.from({ length: SELLERS }, (_, i) => i), 25, async (i) => {
    const from = ip(), email = `seller${i}-${Date.now()}@load.test`;
    const reg = await hit('signup', '/api/auth/register', { method: 'POST', body: { email, password: 'Load-Passw0rd-1', name: `Seller ${i}` }, from });
    const tk = reg.data?.token;
    if (!tk) return;
    await hit('legal details', '/api/privacy', { method: 'PUT', token: tk, from, body: { legalName: `Seller ${i} Pvt Ltd`, address: 'Andheri, Mumbai, Maharashtra', grievanceName: `Seller ${i}`, grievanceEmail: email, checkbox: false } });
    const f = (await hit('funnel from template', `/api/templates/${tpl.id}/use`, { method: 'POST', token: tk, from, body: {} })).data;
    if (!f?.id) return;
    await hit('publish', `/api/funnels/${f.id}`, { method: 'PUT', token: tk, from, body: { published: true } });
    await hit('add product', '/api/products', { method: 'POST', token: tk, from, body: { name: 'Starter programme', description: 'The main programme' } });
    const rows = Array.from({ length: CONTACTS }, (_, k) => ({ Name: `Customer ${i}-${k}`, Email: `c${i}-${k}@example.com`, Phone: `98${String(i).padStart(3, '0')}${String(k).padStart(5, '0')}` }));
    await hit('import contacts', '/api/contacts/import', { method: 'POST', token: tk, from, body: { rows } });
    const full = (await hit('open funnel', `/api/funnels/${f.id}`, { token: tk, from })).data;
    sellers.push({ tk, from, slug: f.slug, pages: (full.steps || []).map((s) => s.slug), sales: full.steps?.[0]?.id, checkout: full.steps?.find((s) => s.type === 'checkout')?.id });
  });
  report.phases.push({ ...table(`Onboarding ${SELLERS} sellers, 25 at a time`, Date.now() - t1), onboarded: sellers.length });
  if (!sellers.length) throw new Error(`no seller could be onboarded:\n${log.slice(-2000)}`);

  // ---------- 2. visitors ----------
  const visitor = async () => {
    const s = sellers[Math.floor(Math.random() * sellers.length)], from = ip(), vid = Math.random().toString(36).slice(2, 12);
    const page = await hit('open page (SSR)', `/f/${s.slug}/${s.pages[0]}`, { from, raw: true });
    if (page.status !== 200) return;
    await hit('page-view event', `/api/public/${s.slug}/event`, { method: 'POST', from, body: { stepId: s.sales, type: 'view', visitor: vid } });
    const r = Math.random();
    if (r < 0.3) await hit('sign up (lead)', `/api/public/${s.slug}/lead`, { method: 'POST', from, body: { stepId: s.sales, email: `v${vid}@example.com`, name: 'Visitor', phone: '9876543210', t: 5000 } });
    if (r < 0.1 && s.checkout) {
      await hit('open checkout', `/f/${s.slug}/${s.pages[1]}`, { from, raw: true });
      await hit('place order', `/api/public/${s.slug}/order`, { method: 'POST', from, body: { stepId: s.checkout, email: `v${vid}@example.com`, name: 'Visitor', phone: '9876543210' } });
    }
  };
  const wave = async (n, secs, extra) => {
    const end = Date.now() + secs * 1000, t0 = Date.now();
    const jobs = Array.from({ length: n }, async () => { while (Date.now() < end) await visitor(); });
    if (extra) jobs.push(extra(end));
    await Promise.all(jobs);
    return Date.now() - t0;
  };
  for (const n of WAVES) {
    const ms = await wave(n, SECS);
    const sum = table(`${n} visitors at once for ${SECS}s`, ms);
    report.phases.push(sum);
    if (sum.errorPct > 20 || sum.p95 > 15000) { process.stdout.write('   (stopping the waves: the app is overloaded)\n'); break; }
  }

  // ---------- 3. visitors + every seller working in the app ----------
  const mid = WAVES[Math.min(2, WAVES.length - 1)];
  const sellersWorking = (end) => pool(sellers, sellers.length, async (s) => {
    while (Date.now() < end) {
      await hit('dashboard: me', '/api/me', { token: s.tk, from: s.from });
      await hit('dashboard: funnels', '/api/funnels', { token: s.tk, from: s.from });
      await hit('dashboard: analytics', '/api/analytics/overview?days=30', { token: s.tk, from: s.from });
      await hit('dashboard: industry', '/api/dashboard/industry?days=30', { token: s.tk, from: s.from });
      await hit('contacts page', '/api/contacts?limit=50', { token: s.tk, from: s.from });
      await hit('contacts search', `/api/contacts?limit=50&q=Customer`, { token: s.tk, from: s.from });
      await new Promise((r) => setTimeout(r, 2000 + Math.random() * 3000)); // a person reading the screen
    }
  });
  const ms = await wave(mid, SECS, sellersWorking);
  report.phases.push(table(`${mid} visitors + all ${sellers.length} sellers using their dashboards`, ms));
  report.health = (await hit('health', '/api/health')).data;
  report.errorsInLog = log.split('\n').filter((l) => /error|exception|SQLITE_BUSY|database is locked|exited/i.test(l)).slice(0, 30);
} finally {
  const file = path.join(os.tmpdir(), `fh-load-${Date.now()}.json`);
  fs.writeFileSync(file, JSON.stringify(report, null, 2));
  process.stdout.write(`\nApp log errors: ${report.errorsInLog?.length ? `\n${report.errorsInLog.join('\n')}` : 'none'}\nReport: ${file}\n`);
  child.kill();
  try { if (process.platform === 'win32') execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); } catch {}
  await new Promise((r) => setTimeout(r, 500));
  fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
}
