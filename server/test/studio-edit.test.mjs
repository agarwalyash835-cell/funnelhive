// Editing anything by saying what should change (studio/edit.js) and undoing it (studio/versions.js), with kie.ai and
// the reviewer faked: an image is EDITED — the current picture goes to the model as the reference with only the change
// — its cost is shown on a dry run first, the change is kept as a version, and undo brings the picture back. Plus the
// pure parts: the look as a filter chain, the matte closing card's left-aligned layout, targets.
// NOTE: written without node/ffmpeg on the authoring machine — run it before merging.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { startServer, register, enable2fa } from './helpers.mjs';
import { gradeFilter, cardLayout } from '../studio/assemble.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'edit-test-'));
const ff = (...a) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...a]);
const created = [];
let fake, srv, api, ADMIN, S, sid;

before(async () => {
  ff('-f', 'lavfi', '-i', 'testsrc2=size=768x768', '-frames:v', '1', path.join(tmp, 'image.png'));
  fake = http.createServer((req, res) => {
    let b = '';
    req.on('data', (c) => { b += c; });
    req.on('end', () => {
      const url = new URL(req.url, 'http://x'), send = (o) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(o)); };
      if (url.pathname.startsWith('/files/')) return res.end(fs.readFileSync(path.join(tmp, url.pathname.slice(7))));
      if (url.pathname === '/gemini-3-8-flash-openai/v1/chat/completions') return send({ choices: [{ message: { content: JSON.stringify({ product_match: 9, text_ok: 9, anatomy_ok: 10, matches_brief: 9, consistency: 9, safe: true, issues: [], fix: '' }) } }] });
      if (url.pathname === '/api/v1/jobs/createTask') { created.push(JSON.parse(b)); return send({ code: 200, data: { taskId: `t${created.length - 1}` } }); }
      if (url.pathname === '/api/v1/jobs/recordInfo') return send({ code: 200, data: { state: 'success', resultJson: JSON.stringify({ resultUrls: [`http://127.0.0.1:${fake.address().port}/files/image.png`] }) } });
      res.writeHead(404); res.end('{}');
    });
  }).listen(0);
  await new Promise((r) => setTimeout(r, 30));
  const base = `http://127.0.0.1:${fake.address().port}`;
  srv = await startServer({ KIE_API_KEY: 'kie-test', KIE_BASE_URL: base, ADMIN_EMAILS: 'boss@edit.test', APP_URL: 'https://app.edit.test' });
  api = srv.api;
  ADMIN = (await register(api, 'boss@edit.test')).token;
  const link = srv.log().match(/To: boss@edit\.test[\s\S]*?\/verify\?token=([a-f0-9.]+)/);
  await api('/auth/verify', 'POST', { token: link[1] });
  ADMIN = (await enable2fa(api, ADMIN)).token;
  S = (await register(api, 'maker@edit.test')).token;
  sid = (await api('/me', 'GET', null, S)).data.id;
  await api(`/admin/studio/accounts/${sid}`, 'PUT', { on: true }, ADMIN);
});
after(async () => { await srv?.stop(); fake?.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

const tick = (times = 3) => api('/__test/studio-tick', 'POST', { times });
const asset = async (id) => (await api(`/studio/assets/${id}`, 'GET', null, S)).data;

test('an image is edited, not made again: the current picture is the reference; the cost comes first; undo brings it back', async () => {
  const made = await api('/studio/images', 'POST', { prompt: 'A jar of desi ghee on a wooden table, morning light', count: 1, aspect: '1:1' }, S);
  const id = made.data.assets[0].id;
  await tick(4);
  const first = await asset(id);
  assert.equal(first.status, 'ready', JSON.stringify(first));
  assert.deepEqual(first.versions, []);

  // a dry run: what it does and what it costs — nothing is made
  const n = created.length;
  const dry = await api('/studio/edit', 'POST', { id, target: 'image', change: { picture: 'make the background darker' }, dryRun: true }, S);
  assert.equal(dry.status, 200, JSON.stringify(dry.data));
  assert.equal(dry.data.plan.free, false);
  assert.ok(dry.data.plan.credits > 0, 'the cost is shown');
  assert.equal(created.length, n, 'nothing made on a dry run');

  // the edit: the model gets the current picture and only the change
  const done = await api('/studio/edit', 'POST', { id, target: 'image', change: { picture: 'make the background darker' } }, S);
  assert.equal(done.status, 200, JSON.stringify(done.data));
  assert.equal(done.data.item.versions.length, 1, 'the picture before is kept');
  await tick(4);
  const sent = JSON.stringify(created.at(-1).input);
  assert.ok(sent.includes(`https://app.edit.test${first.url}`), 'the current picture went in as the reference');
  assert.match(sent, /make the background darker/);
  assert.match(sent, /keep everything it doesn't mention/i);
  const second = await asset(id);
  assert.equal(second.status, 'ready');
  assert.notEqual(second.url, first.url);

  // undo: the first picture again (and going back is itself a version)
  const back = await api(`/studio/assets/${id}/undo`, 'POST', {}, S);
  assert.equal(back.status, 200, JSON.stringify(back.data));
  assert.equal(back.data.url, first.url);
  assert.equal(back.data.versions.length, 2);
  assert.ok(fs.existsSync(path.join(srv.dataDir, 'uploads', ...second.url.split('/').slice(2))), 'the edited file is still there to go back to');

  // not someone else's; and nonsense targets are refused with what can be changed
  const other = (await register(api)).token;
  assert.equal((await api('/studio/edit', 'POST', { id, target: 'image', change: { picture: 'x' } }, other)).status, 404);
  assert.equal((await api('/studio/edit', 'POST', { id, target: 'scene:9', change: { drop: true } }, S)).status, 400);
  assert.equal((await api('/studio/edit', 'POST', { id, target: 'image', change: {} }, S)).status, 400);
});

test('what an editor can change is listed for the director', async () => {
  const e = (await api('/studio/edits', 'GET', null, S)).data;
  assert.ok(e.reel.free.some((x) => /look/.test(x)));
  assert.ok(e.scene.paid.some((x) => /picture/.test(x)));
  const g = (await api('/studio', 'GET', null, S)).data;
  assert.ok(g.editing.looks.includes('matte'));
  assert.ok(g.editing.fonts.length > 0);
});

test('the look: a named base and nudges, as one filter chain', () => {
  assert.equal(gradeFilter('natural'), '');
  assert.match(gradeFilter('cinematic'), /vignette/);
  assert.match(gradeFilter({ base: 'matte' }), /noise=/);
  const darker = gradeFilter({ base: 'natural', brightness: -1, warmth: 2 });
  assert.match(darker, /brightness=-0\.04/);
  assert.match(darker, /colorbalance=rm=0\.08:bm=-0\.08/);
  assert.equal(gradeFilter({ base: 'natural', brightness: 9 }), gradeFilter({ base: 'natural', brightness: 2 }), 'nudges stop at ±2');
});

test('the matte closing card sits on the left; the classic one is centred', () => {
  const card = { headline: 'Shuddh Ghee Co', offer: '₹499 / litre', cta: 'Order on WhatsApp' };
  const left = cardLayout(card, 1080, 1920, false, 'left'), centre = cardLayout(card, 1080, 1920, false);
  assert.ok(left.every((b) => b.x === 60), 'a left margin');
  assert.ok(centre.every((b) => b.x === 540), 'the middle');
});
