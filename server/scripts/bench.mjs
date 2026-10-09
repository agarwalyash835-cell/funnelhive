// Load test: boots the production entry (start.js, one process per core) on a throwaway database, seeds a published
// funnel, then hammers the paths that matter at scale and prints requests/second and latency percentiles.
//   node scripts/loadtest.mjs [seconds per scenario] [concurrency]
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';

const SECS = Number(process.argv[2] || 10), CONC = Number(process.argv[3] || 50);
const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = await new Promise((r) => { const s = net.createServer().listen(0, () => { const p = s.address().port; s.close(() => r(p)); }); });
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'ff-load-'));
const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'start.js'], { cwd: dir, env: { ...process.env, PORT: String(port), DATA_DIR: data, JWT_SECRET: 'load', NODE_ENV: 'production', TRUST_PROXY: '0', ANTHROPIC_API_KEY: '', KIE_API_KEY: '' }, stdio: 'ignore' });
const base = `http://127.0.0.1:${port}`;
for (let i = 0; i < 150; i++) { try { await fetch(`${base}/api/health`); break; } catch { await new Promise((r) => setTimeout(r, 200)); } }
const j = async (p, m = 'GET', body, t) => (await fetch(base + p, { method: m, headers: { 'content-type': 'application/json', ...(t ? { authorization: `Bearer ${t}` } : {}) }, body: body ? JSON.stringify(body) : undefined })).json();
const T = (await j('/api/auth/register', 'POST', { email: 'load@test.dev', password: 'secret123', name: 'Load' })).token;
const f = await j('/api/templates/coding/use', 'POST', {}, T);
await j(`/api/funnels/${f.id}`, 'PUT', { published: true }, T);
const co = f.steps.find((s) => s.type === 'checkout');

async function run(name, make) {
  const lat = [];
  let ok = 0, err = 0;
  const end = Date.now() + SECS * 1000;
  let n = 0;
  await Promise.all(Array.from({ length: CONC }, async () => {
    while (Date.now() < end) {
      const { url, init } = make(n++);
      const t0 = performance.now();
      try { const r = await fetch(base + url, init); await r.arrayBuffer(); r.ok ? ok++ : err++; } catch { err++; }
      lat.push(performance.now() - t0);
    }
  }));
  lat.sort((a, b) => a - b);
  const p = (q) => lat[Math.min(lat.length - 1, Math.floor(lat.length * q))].toFixed(0);
  console.log(`${name.padEnd(34)} ${String(Math.round(ok / SECS)).padStart(6)} req/s   p50 ${p(0.5).padStart(4)} ms   p95 ${p(0.95).padStart(4)} ms   p99 ${p(0.99).padStart(4)} ms   errors ${err}`);
}
console.log(`\n${os.cpus().length} CPU cores · ${CONC} concurrent clients · ${SECS}s per scenario\n`);
await run('Live funnel page (server-rendered)', () => ({ url: `/f/${f.slug}`, init: {} }));
await run('Page-view tracking event', (i) => ({ url: `/api/public/${f.slug}/event`, init: { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ stepId: f.steps[0].id, type: 'view', visitor: `v${i % 5000}abcd` }) } }));
await run('Lead sign-up (write + automations)', (i) => ({ url: `/api/public/${f.slug}/lead`, init: { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': `10.0.${(i >> 8) & 255}.${i & 255}` }, body: JSON.stringify({ stepId: f.steps[0].id, email: `lead${i}@load.dev`, name: 'Load Lead' }) } }));
await run('Checkout order (demo payment)', (i) => ({ url: `/api/public/${f.slug}/order`, init: { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ stepId: co.id, email: `buyer${i}@load.dev` }) } }));
await run('Dashboard overview (30 days)', () => ({ url: '/api/analytics/overview?days=30', init: { headers: { authorization: `Bearer ${T}` } } }));
child.kill('SIGTERM');
await new Promise((r) => setTimeout(r, 1500));
fs.rmSync(data, { recursive: true, force: true });
