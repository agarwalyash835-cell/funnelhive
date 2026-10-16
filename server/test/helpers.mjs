// Boots a real server on a free port with a throwaway data directory.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const serverDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

const freePort = () => new Promise((res) => {
  const s = net.createServer().listen(0, () => { const p = s.address().port; s.close(() => res(p)); });
});

export async function startServer(env = {}, opts = {}) {
  const port = await freePort();
  const dataDir = opts.dataDir || fs.mkdtempSync(path.join(os.tmpdir(), 'ff-test-'));
  const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', opts.entry || 'index.js'], {
    cwd: serverDir,
    env: { ...process.env, PORT: String(port), DATA_DIR: dataDir, ANTHROPIC_API_KEY: '', KIE_API_KEY: '', JWT_SECRET: 'test-secret', NODE_ENV: 'test', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  child.stdout.on('data', (d) => { log += d; });
  child.stderr.on('data', (d) => { log += d; });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 400; i++) { // up to 40 s: a busy machine (a build running) starts servers slowly
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
  return { base, api, stop, dataDir, log: () => log, child };
}

export async function register(api, email = `u${Date.now()}${Math.random().toString(36).slice(2, 6)}@test.dev`, { legal = true } = {}) {
  const r = await api('/auth/register', 'POST', { email, password: 'secret123', name: 'Tester' });
  // the legal details publishing needs, and no required consent tick, so tests can publish and post sign-ups
  // as before; { legal: false } keeps a brand-new account's defaults (see consent-legal.test.mjs)
  if (legal && r.data.token) await api('/privacy', 'PUT', { legalName: 'Tester Pvt Ltd', address: 'Andheri, Mumbai, Maharashtra', grievanceName: 'Tester', grievanceEmail: email, checkbox: false }, r.data.token);
  return { token: r.data.token, email };
}

// 2-step codes (RFC 6238), without importing the server's modules. steps: -1 / 0 / +1 — the server accepts
// one step either side, and each step only once (replay protection), so a test that needs several codes in a
// row uses consecutive steps
export function totpCode(secret, steps = 0) {
  const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const c of secret.toUpperCase()) { const v = B32.indexOf(c); if (v >= 0) bits += v.toString(2).padStart(5, '0'); }
  const key = Buffer.from(bits.match(/.{8}/g).map((b) => parseInt(b, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000) + steps));
  const h = crypto.createHmac('sha1', key).update(counter).digest();
  return ((h.readUInt32BE(h[h.length - 1] & 0xf) & 0x7fffffff) % 1e6).toString().padStart(6, '0');
}
// turns on 2-step login (platform admins need it for the admin panel); uses the previous step's code, so the
// current one is still free for a login straight after. → { token, secret }
export async function enable2fa(api, token) {
  const { secret } = (await api('/auth/2fa/setup', 'POST', {}, token)).data;
  const r = await api('/auth/2fa/enable', 'POST', { code: totpCode(secret, -1) }, token);
  if (r.status !== 200) throw new Error(`2-step setup failed: ${JSON.stringify(r.data)}`);
  return { token: r.data.token || token, secret };
}
