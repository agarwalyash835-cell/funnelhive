// A webhook host whose DNS answer turns private after the URL was checked (DNS rebinding) is refused when connecting.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';

test('a webhook whose name resolves to a private address is refused at the moment of connecting', async () => {
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ff-wh-'));
  process.env.WEBHOOK_ALLOW_PRIVATE = '0';
  const { postPinned } = await import('../webhooks.js');
  const hits = [];
  const inner = http.createServer((req, res) => { hits.push(req.url); res.end('ok'); }).listen(0);
  await new Promise((r) => setTimeout(r, 30));
  try {
    await assert.rejects(postPinned(`http://localhost:${inner.address().port}/admin`, { headers: {}, body: '{}' }), /public internet address/);
    assert.equal(hits.length, 0, 'the private server was never reached');
  } finally { inner.close(); }
});
