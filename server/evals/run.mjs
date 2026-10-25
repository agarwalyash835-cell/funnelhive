#!/usr/bin/env node
// The Hive test bank: runs real seller requests (hive-bank.json) through Hive with the real AI model, then grades
// each one by what it did and what the account looks like afterwards (grade.mjs). Run it before every release and
// after changing Hive's tools, instructions or model.
//
// It starts its own copy of the app on a free port with a throwaway database — no real account, email, payment or
// customer is ever touched — and uses the AI key from the environment (KIE_API_KEY / KIE_MODEL, or server/.env).
//
//   node evals/run.mjs                       all cases, 3 at a time
//   node evals/run.mjs --only education,cpn  cases whose industry or id starts with these
//   node evals/run.mjs --limit 20 --concurrency 4 --min 0.9
// On the server:  docker compose exec app node server/evals/run.mjs --limit 30
// Writes evals/reports/hive-<time>.json (or the temp folder when that is read-only); exits 1 when the pass rate is under --min (default 0.9).
import fs from 'node:fs';
import os from 'node:os';
import net from 'node:net';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { grade, summarise, statePaths } from './grade.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const serverDir = path.join(here, '..');
const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };

export function loadBank(file = path.join(here, 'hive-bank.json')) { return JSON.parse(fs.readFileSync(file, 'utf8')).cases; }
export function pick(cases, only, limit) {
  const keys = only ? String(only).split(',').map((s) => s.trim()).filter(Boolean) : null;
  const sel = keys ? cases.filter((c) => keys.some((k) => c.id.startsWith(k) || c.industry === k)) : cases;
  return limit ? sel.slice(0, Number(limit)) : sel;
}

const freePort = () => new Promise((r) => { const s = net.createServer().listen(0, () => { const p = s.address().port; s.close(() => r(p)); }); });
// the app, on its own port and throwaway database; mail, payments and outside services switched off
export async function startApp(env = {}) {
  const port = await freePort();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fh-evals-'));
  const quiet = Object.fromEntries(['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS', 'RESEND_API_KEY', 'RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET', 'STRIPE_SECRET_KEY', 'COMPOSIO_API_KEY', 'SENTRY_DSN', 'WASABI_KEY', 'R2_ACCESS_KEY_ID', 'PAGES_URL', 'APP_URL'].map((k) => [k, '']));
  const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', '--env-file-if-exists=.env', 'index.js'], {
    cwd: serverDir, env: { ...process.env, ...quiet, PORT: String(port), DATA_DIR: dataDir, NODE_ENV: 'test', FF_JOBS: '0', JWT_SECRET: 'evals', ...env }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  child.stdout.on('data', (d) => { log += d; }); child.stderr.on('data', (d) => { log += d; });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 400; i++) { try { await fetch(`${base}/api/templates`); break; } catch { await new Promise((r) => setTimeout(r, 100)); } }
  const api = async (p, method = 'GET', body, token) => {
    const r = await fetch(base + '/api' + p, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, data: await r.json().catch(() => ({})) };
  };
  const stop = async () => { child.kill(); await new Promise((r) => (child.exitCode !== null ? r() : child.once('exit', r))); fs.rmSync(dataDir, { recursive: true, force: true }); };
  return { base, api, stop, log: () => log };
}

const SETUP = {
  funnel: async (api, tk) => { const t = (await api('/templates')).data; const tpl = t.find((x) => /sales/i.test(`${x.kind} ${x.name}`)) || t[0]; await api(`/templates/${tpl.id}/use`, 'POST', {}, tk); },
  product: async (api, tk) => { await api('/products', 'POST', { name: 'Starter programme', description: 'The main programme' }, tk); },
  contacts: async (api, tk) => { for (const [n, e] of [['Asha Rao', 'asha@example.com'], ['Vikram Shah', 'vikram@example.com'], ['Neha Gupta', 'neha@example.com']]) await api('/contacts', 'POST', { name: n, email: e }, tk); },
};

// one case on a fresh account → the facts grade() needs
export async function runCase(app, c, { timeoutMs = 300000 } = {}) {
  const email = `eval-${c.id}-${Date.now()}@evals.test`;
  const reg = await app.api('/auth/register', 'POST', { email, password: 'Evals-Passw0rd-1', name: 'Eval Seller' });
  const tk = reg.data.token;
  if (!tk) return { tools: [], reply: '', state: {}, error: `couldn’t make the test account: ${reg.data.error || reg.status}` };
  await app.api('/privacy', 'PUT', { legalName: 'Eval Seller Pvt Ltd', address: 'Andheri, Mumbai, Maharashtra', grievanceName: 'Eval Seller', grievanceEmail: email, checkbox: false }, tk);
  if (c.kit) await app.api('/crm/kit', 'POST', { id: c.kit }, tk);
  for (const s of c.setup || []) await SETUP[s](app.api, tk);
  const run = { tools: [], reply: '', state: {}, error: null, ms: 0 };
  const t0 = Date.now();
  try {
    const r = await fetch(`${app.base}/api/hive/chat`, { method: 'POST', headers: { authorization: `Bearer ${tk}`, 'content-type': 'application/json' }, body: JSON.stringify({ message: c.message }), signal: AbortSignal.timeout(timeoutMs) });
    if (!r.ok) run.error = (await r.json().catch(() => ({}))).error || `HTTP ${r.status}`;
    else {
      for (const chunk of (await r.text()).split('\n\n')) {
        if (!chunk.startsWith('data: ')) continue;
        const ev = JSON.parse(chunk.slice(6));
        if (ev.type === 'tool') { const t = run.tools.find((x) => x.id === ev.id); if (t) Object.assign(t, ev); else run.tools.push({ ...ev }); }
        else if (ev.type === 'reply') run.reply = ev.text;
        else if (ev.type === 'error') run.error = ev.error;
      }
    }
  } catch (e) { run.error = e.message; }
  run.ms = Date.now() - t0;
  for (const p of statePaths(c)) {
    if (p === '{funnel}') {
      const list = (await app.api('/funnels', 'GET', null, tk)).data;
      const newest = Array.isArray(list) ? [...list].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))[0] : null;
      run.state[p] = newest ? JSON.stringify((await app.api(`/funnels/${newest.id}`, 'GET', null, tk)).data) : null;
    } else run.state[p] = JSON.stringify((await app.api(p, 'GET', null, tk)).data);
  }
  return run;
}

async function pool(items, n, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); } }));
  return out;
}

export async function main({ only = arg('only'), limit = arg('limit'), concurrency = Number(arg('concurrency', 3)), min = Number(arg('min', 0.9)), env = {}, bank, quiet = false } = {}) {
  const cases = pick(bank || loadBank(), only, limit);
  const app = await startApp(env);
  const say = quiet ? () => {} : (s) => process.stdout.write(s);
  try {
    if (!(await app.api('/hive/status', 'GET', null, (await app.api('/auth/register', 'POST', { email: `probe-${Date.now()}@evals.test`, password: 'Evals-Passw0rd-1', name: 'Probe' })).data.token)).data.ready) {
      throw new Error('Hive isn’t switched on in this environment — set KIE_API_KEY (and KIE_MODEL) or run it on the server');
    }
    say(`Running ${cases.length} Hive cases, ${concurrency} at a time…\n`);
    const results = await pool(cases, concurrency, async (c) => {
      const run = await runCase(app, c);
      const g = { ...grade(c, run), ms: run.ms, reply: run.reply.slice(0, 400), steps: run.tools.map((t) => `${t.name}:${t.status}`) };
      say(`${g.pass ? '✔' : '✖'} ${c.id.padEnd(22)} ${(run.ms / 1000).toFixed(0).padStart(4)}s  ${g.pass ? '' : g.fails.join('; ')}${g.warns.length ? `  (${g.warns.join('; ')})` : ''}\n`);
      return g;
    });
    const sum = summarise(results);
    say(`\n${sum.pass}/${sum.total} passed (${(sum.rate * 100).toFixed(1)}%)\n`);
    for (const [ind, x] of Object.entries(sum.byIndustry).sort()) say(`  ${ind.padEnd(14)} ${x.pass}/${x.total}\n`);
    // next to the bank, or (in the app's container, where the code is read-only) the temp folder; EVALS_REPORTS to choose
    let dir = process.env.EVALS_REPORTS || path.join(here, 'reports');
    try { fs.mkdirSync(dir, { recursive: true }); fs.accessSync(dir, fs.constants.W_OK); } catch { dir = path.join(os.tmpdir(), 'fh-evals-reports'); fs.mkdirSync(dir, { recursive: true }); }
    const file = path.join(dir, `hive-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
    fs.writeFileSync(file, JSON.stringify({ at: new Date().toISOString(), model: process.env.KIE_MODEL || null, ...sum, results }, null, 2));
    say(`Report: ${file}\n`);
    return { ...sum, results, ok: sum.rate >= min, file };
  } finally { await app.stop(); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then((r) => process.exit(r.ok ? 0 : 1)).catch((e) => { console.error(e.message); process.exit(2); });
}
