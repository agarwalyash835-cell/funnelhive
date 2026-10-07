// Boots a real server on a free port with a throwaway data directory.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';

const serverDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

const freePort = () => new Promise((res) => {
  const s = net.createServer().listen(0, () => { const p = s.address().port; s.close(() => res(p)); });
});

export async function startServer(env = {}, opts = {}) {
  const port = await freePort();
  const dataDir = opts.dataDir || fs.mkdtempSync(path.join(os.tmpdir(), 'ff-test-'));
  const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'index.js'], {
    cwd: serverDir,
    env: { ...process.env, PORT: String(port), DATA_DIR: dataDir, ANTHROPIC_API_KEY: '', KIE_API_KEY: '', JWT_SECRET: 'test-secret', NODE_ENV: 'test', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  child.stdout.on('data', (d) => { log += d; });
  child.stderr.on('data', (d) => { log += d; });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 100; i++) {
    try { await fetch(`${base}/api/templates`); break; } catch { await new Promise((r) => setTimeout(r, 100)); }
  }
  const api = async (p, method = 'GET', body, token, headers = {}) => {
    const r = await fetch(base + '/api' + p, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
    const data = await r.json().catch(() => ({}));
    return { status: r.status, data, headers: r.headers };
  };
  const stop = async ({ keep = false } = {}) => {
    await new Promise((r) => setTimeout(r, 150)); // let the debounced write land
    child.kill();
    await new Promise((r) => child.exitCode !== null ? r() : child.once('exit', r));
    if (!keep) for (let i = 0; i < 10; i++) { try { fs.rmSync(dataDir, { recursive: true, force: true }); break; } catch { await new Promise((r) => setTimeout(r, 100)); } }
  };
  return { base, api, stop, dataDir, log: () => log };
}

export async function register(api, email = `u${Date.now()}${Math.random().toString(36).slice(2, 6)}@test.dev`) {
  const r = await api('/auth/register', 'POST', { email, password: 'secret123', name: 'Tester' });
  return { token: r.data.token, email };
}
