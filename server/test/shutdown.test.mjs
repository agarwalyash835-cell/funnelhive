// Graceful shutdown: on SIGTERM (a deploy, docker stop) a request in flight still gets its answer, new connections
// are refused, and the process exits cleanly. Also: health turns 503 when the data disk is (nearly) full.
// Windows can't deliver SIGTERM to a child process, so there the test-only shutdown route starts the same shutdown.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.mjs';

test('a request in flight finishes after SIGTERM; then the server exits', async () => {
  const srv = await startServer();
  try {
    const exited = new Promise((r) => srv.child.once('exit', (code, signal) => r({ code, signal })));
    const t0 = Date.now();
    const slow = fetch(`${srv.base}/api/health/test-slow?ms=1500`).then(async (r) => ({ status: r.status, body: await r.json() }));
    await new Promise((r) => setTimeout(r, 300));
    if (process.platform === 'win32') await fetch(`${srv.base}/api/health/test-shutdown`, { method: 'POST' });
    else srv.child.kill('SIGTERM');
    const res = await slow;
    assert.equal(res.status, 200, 'the request in flight got its answer');
    assert.equal(res.body.slow, true);
    assert.ok(Date.now() - t0 >= 1400);
    const { code } = await exited;
    assert.equal(code, 0, 'clean exit');
    await assert.rejects(fetch(`${srv.base}/api/health`), 'no new requests once stopped');
  } finally { await srv.stop(); }
});

test('health is 503 when the data disk is (nearly) full', async () => {
  const srv = await startServer({ DISK_MIN_FREE_PCT: '101' });
  try {
    const h = await srv.api('/health');
    assert.equal(h.status, 503);
    assert.deepEqual([h.data.ok, h.data.db, h.data.disk], [false, true, false]);
    const d = await srv.api('/health/disk');
    assert.equal(d.status, 503);
    assert.equal(typeof d.data.diskFreePct, 'number');
  } finally { await srv.stop(); }
});
