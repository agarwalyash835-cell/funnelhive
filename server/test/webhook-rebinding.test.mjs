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

// chatbot API steps and "learn from my website" read the answer back, so they must be pinned too
test('a chatbot request or page read to a name that resolves privately is refused at the moment of connecting', async () => {
  process.env.DATA_DIR ||= fs.mkdtempSync(path.join(os.tmpdir(), 'ff-wh-'));
  process.env.WEBHOOK_ALLOW_PRIVATE = '0';
  const { fetchPinned } = await import('../webhooks.js');
  const hits = [];
  const inner = http.createServer((req, res) => { hits.push(req.url); res.end('{"secret":1}'); }).listen(0);
  await new Promise((r) => setTimeout(r, 30));
  try {
    await assert.rejects(fetchPinned(`http://localhost:${inner.address().port}/latest/meta-data`), /public internet address/);
    await assert.rejects(fetchPinned(`http://localhost:${inner.address().port}/x`, { method: 'POST', body: '{}' }), /public internet address/);
    assert.equal(hits.length, 0, 'the private server was never reached');
  } finally { inner.close(); }
});

test('fetchPinned reads the answer (status, type, body capped) when private addresses are allowed', async () => {
  process.env.WEBHOOK_ALLOW_PRIVATE = '1';
  const { fetchPinned } = await import('../webhooks.js');
  const srv = http.createServer((req, res) => { let b = ''; req.on('data', (c) => { b += c; }); req.on('end', () => { res.writeHead(201, { 'content-type': 'application/json' }); res.end(JSON.stringify({ got: b, m: req.method, pad: 'x'.repeat(500) })); }); }).listen(0);
  await new Promise((r) => setTimeout(r, 30));
  try {
    const r = await fetchPinned(`http://127.0.0.1:${srv.address().port}/`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"हिंदी":1}' });
    assert.equal(r.status, 201); assert.equal(r.ok, true); assert.match(r.type, /json/);
    assert.equal(JSON.parse(r.text).got, '{"हिंदी":1}');
    assert.equal((await fetchPinned(`http://127.0.0.1:${srv.address().port}/`, { maxBytes: 50 })).text.length, 50);
  } finally { srv.close(); process.env.WEBHOOK_ALLOW_PRIVATE = '0'; }
});
