// AI images: a fake of kie.ai's task API (create → generating → success with a result URL, or fail). The image is
// downloaded and stored in the seller's media (it outlives kie.ai's 14 days), costs 10 credits only when it works,
// and Hive AI can put one straight onto a page.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { startServer, register } from './helpers.mjs';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
let fake, srv, api, T, tok;
const tasks = new Map(), created = [];
before(async () => {
  fake = http.createServer((req, res) => {
    let b = '';
    req.on('data', (c) => { b += c; });
    req.on('end', () => {
      const send = (o) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(o)); };
      if (req.url === '/img.png') { res.setHeader('content-type', 'image/png'); return res.end(PNG); }
      if (req.headers.authorization !== 'Bearer kie-test') return send({ code: 401, msg: 'bad key' });
      if (req.url === '/api/v1/jobs/createTask') {
        const body = JSON.parse(b);
        created.push(body);
        const id = `task_${created.length}`;
        tasks.set(id, { polls: 0, fail: /forbidden/.test(body.input.prompt) });
        return send({ code: 200, msg: 'success', data: { taskId: id } });
      }
      const m = /recordInfo\?taskId=(\w+)/.exec(req.url);
      if (m) {
        const t = tasks.get(m[1]);
        t.polls++;
        if (t.polls < 2) return send({ code: 200, data: { state: 'generating' } });
        if (t.fail) return send({ code: 200, data: { state: 'fail', failMsg: 'content policy' } });
        return send({ code: 200, data: { state: 'success', resultJson: JSON.stringify({ resultUrls: [`http://127.0.0.1:${fake.address().port}/img.png`] }) } });
      }
      res.writeHead(404); res.end();
    });
  }).listen(0);
  await new Promise((r) => setTimeout(r, 30));
  srv = await startServer({ KIE_API_KEY: 'kie-test', KIE_BASE_URL: `http://127.0.0.1:${fake.address().port}` });
  api = srv.api;
  T = (await register(api)).token;
  tok = (await api('/hive/tokens', 'POST', { name: 'test' }, T)).data.token;
});
after(async () => { await srv.stop(); fake.close(); });
const used = async () => (await api('/billing', 'GET', null, T)).data.credits.used;

test('an image from a description: stored in the seller’s media, 10 credits; a refused one costs nothing', async () => {
  const before = await used();
  const r = await api('/ai/image', 'POST', { prompt: 'A calm yoga studio at sunrise, warm light', aspect: '4:5' }, T);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.match(r.data.url, /^\/uploads\/[\w-]+\/[\w-]+\.png$/);
  assert.equal(r.data.aspect, '4:5');
  assert.equal(created.at(-1).input.aspect_ratio, '4:5');
  assert.equal(created.at(-1).model, 'google/nano-banana');
  const img = await fetch(`${srv.base}${r.data.url}`);
  assert.equal(img.status, 200);
  assert.deepEqual(Buffer.from(await img.arrayBuffer()), PNG, 'our own copy of the image');
  await new Promise((x) => setTimeout(x, 50));
  assert.equal(await used(), before + 10);
  const bad = await api('/ai/image', 'POST', { prompt: 'something forbidden' }, T);
  assert.equal(bad.status, 502);
  assert.match(bad.data.error, /content policy/);
  await new Promise((x) => setTimeout(x, 50));
  assert.equal(await used(), before + 10, 'no credits for a failed image');
  assert.equal((await api('/ai/image', 'POST', { prompt: '' }, T)).status, 400);
  assert.equal(created.find((c) => c.input.aspect_ratio === 'weird'), undefined);
  await api('/ai/image', 'POST', { prompt: 'odd shape please', aspect: 'weird' }, T);
  assert.equal(created.at(-1).input.aspect_ratio, '16:9', 'unknown shapes fall back to 16:9');
});

test('Hive AI makes a hero image and puts it on the page', async () => {
  const f = (await api('/templates/yoga/use', 'POST', {}, T)).data;
  const step = f.steps[0], hero = step.blocks.find((b) => b.type === 'hero');
  const r = await (await fetch(`${srv.base}/mcp`, { method: 'POST', headers: { authorization: `Bearer ${tok}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'generate_image', arguments: { prompt: 'Women practising yoga on a terrace in Pune at sunrise, photo', aspect: '16:9', funnelId: f.id, stepId: step.id, sectionId: hero.id } } }) })).json();
  const out = JSON.parse(r.result.content[0].text);
  assert.equal(out.placed, true, JSON.stringify(out));
  const saved = (await api(`/funnels/${f.id}`, 'GET', null, T)).data.steps[0].blocks.find((b) => b.id === hero.id);
  assert.equal(saved.props.image, out.url);
});
