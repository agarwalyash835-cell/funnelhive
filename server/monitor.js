// Better Stack heartbeats (Admin → Monitoring). Better Stack raises an incident — email, SMS, phone call, Slack — when a
// heartbeat stops arriving or arrives on its /fail address:
//   app     — pinged every minute by the jobs process while the database answers and the disk has room, so a crashed
//             app, a dead server, stuck background jobs or a full disk all page the owner
//   backup  — pinged after every hourly backup run: OK when the off-site copy worked (or nothing changed since a good
//             one); /fail, with the reason, when it failed or no storage bucket is connected
// Each URL holds a secret token: stored encrypted, never sent back. Server env vars win: BETTERSTACK_HEARTBEAT_URL,
// BETTERSTACK_BACKUP_HEARTBEAT_URL. (The outside check of the site itself is an uptime monitor made in Better Stack on
// /api/health — nothing to store here.) Last results go to a small file so every app process can show them.
import fs from 'node:fs';
import path from 'node:path';
import { dir, JOBS, q, onBackupReport } from './db.js';
import { platform } from './platform.js';
import { decrypt } from './messaging.js';
import { diskStatus } from './observe.js';

export const HEARTBEATS = { app: 'BETTERSTACK_HEARTBEAT_URL', backup: 'BETTERSTACK_BACKUP_HEARTBEAT_URL' };
// only Better Stack's own heartbeat addresses (tests may use a local fake)
export const validHeartbeat = (u) => /^https:\/\/([a-z0-9-]+\.)*betterstack\.com\/api\/v1\/heartbeat\/[A-Za-z0-9_-]{8,}$/.test(String(u || '').trim())
  || (process.env.NODE_ENV === 'test' && /^http:\/\/127\.0\.0\.1:\d+\/api\/v1\/heartbeat\/[A-Za-z0-9_-]{8,}$/.test(String(u || '').trim()));
export const heartbeatFromEnv = (kind) => !!process.env[HEARTBEATS[kind]];
export function heartbeatUrl(kind) {
  if (process.env[HEARTBEATS[kind]]) return process.env[HEARTBEATS[kind]];
  return decrypt(platform().monitor?.[`${kind}Enc`]) || '';
}

const statusFile = path.join(dir, '.monitor.json');
export const monitorStatus = () => { try { return JSON.parse(fs.readFileSync(statusFile, 'utf8')); } catch { return {}; } };
const record = (kind, r) => { const s = monitorStatus(); s[kind] = r; try { fs.writeFileSync(statusFile, JSON.stringify(s)); } catch {} };

// → { at, ok, sent, status? , error? } or null when no URL is set. ok=false reports a failure (its reason in the body).
export async function ping(kind, ok = true, reason = '', url = heartbeatUrl(kind)) {
  if (!url) return null;
  const target = ok ? url : `${url.replace(/\/+$/, '')}/fail`;
  let res;
  try {
    const r = await fetch(target, { method: reason ? 'POST' : 'GET', body: reason ? String(reason).slice(0, 2000) : undefined, signal: AbortSignal.timeout(10000) });
    res = { at: Date.now(), ok, sent: r.ok, status: r.status, ...(reason ? { reason: String(reason).slice(0, 200) } : {}) };
  } catch (e) { res = { at: Date.now(), ok, sent: false, error: String(e.message).slice(0, 200), ...(reason ? { reason: String(reason).slice(0, 200) } : {}) }; }
  record(kind, res);
  return res;
}

// every backup run reports here (db.js)
onBackupReport((ok, reason) => { ping('backup', ok, reason).catch(() => {}); });

// the app heartbeat: alive = the database answers and the disk isn't full
export function appHealthy() {
  try { q('SELECT 1').get(); } catch (e) { return { ok: false, reason: `database: ${e.message}` }; }
  const d = diskStatus();
  if (d.ok === false) return { ok: false, reason: `disk almost full: ${d.diskFreeGB ?? '?'} GB free` };
  return { ok: true, reason: '' };
}
if (JOBS && process.env.NODE_ENV !== 'test') {
  const beat = () => { const h = appHealthy(); ping('app', h.ok, h.reason).catch(() => {}); };
  setTimeout(beat, 10000).unref();
  setInterval(beat, 60000).unref();
}
