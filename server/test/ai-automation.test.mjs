// "Build with Hive AI": an automation designed from a sentence. The AI gets the seller's own pipelines, fields and
// courses (by id); what it sends back is cleaned like a builder save and created paused for review.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { startServer, register } from './helpers.mjs';

let fake, srv, api, T, seen = '', ids = {};
before(async () => {
  // a stand-in AI: replies with the seller's real ids (read by the test below) plus one made-up step type
  fake = http.createServer((req, res) => {
    let b = '';
    req.on('data', (c) => { b += c; });
    req.on('end', () => {
      const body = JSON.parse(b || '{}');
      const input = JSON.stringify(body);
      seen = input;
      const { pipe, neg } = ids; // what the test read from the API (a real AI reads them from the context it gets)
      const text = JSON.stringify({
        name: 'Site visit follow-up',
        trigger: { type: 'date', fieldId: 're_visit', offsetDays: -1, time: '10:00' },
        steps: [
          { type: 'email', subject: 'See you tomorrow, {{first_name}}', body: 'Your site visit is on {{f_re_visit}}.\n\n— {{business}}' },
          { type: 'notify', subject: 'Call {{name}} about tomorrow’s visit' },
          { type: 'teleport', to: 'mars' },
          { type: 'stage', pipelineId: pipe.id, stageId: neg.id },
        ],
        stopOnPurchase: false,
      });
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ output: [{ type: 'message', content: [{ type: 'output_text', text }] }] }));
    });
  }).listen(0);
  await new Promise((r) => setTimeout(r, 30));
  srv = await startServer({ KIE_API_KEY: 'kie-test', KIE_BASE_URL: `http://127.0.0.1:${fake.address().port}` });
  api = srv.api;
  T = (await register(api)).token;
  const kit = (await api('/crm/kit', 'POST', { id: 'realestate' }, T)).data;
  const pipe = (await api('/pipelines', 'GET', null, T)).data.find((p) => p.id === kit.current.pipelineId);
  ids = { pipe, neg: pipe.stages.find((x) => x.name === 'Negotiation') };
});
after(async () => { await srv?.stop(); fake?.close(); });

test('Build with Hive AI: uses the seller’s own ids, drops anything invalid, starts paused', async () => {
  assert.equal((await api('/ai/automation', 'POST', { description: 'hi' }, T)).status, 400);
  const r = await api('/ai/automation', 'POST', { description: 'Remind buyers the day before their site visit and move them to negotiation' }, T);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.match(seen, /Property sales/, 'the AI was told about the seller’s pipeline');
  assert.match(seen, /re_visit/, '… and their CRM fields');
  const a = r.data;
  assert.equal(a.name, 'Site visit follow-up');
  assert.equal(a.active, false, 'paused until the seller turns it on');
  assert.equal(a.trigger.type, 'date');
  assert.deepEqual(a.steps.map((s) => s.type), ['email', 'notify', 'stage'], 'the made-up step was dropped');
  assert.deepEqual(r.data.check.errors, [], 'complete and ready to switch on');
  assert.equal((await api(`/automations/${a.id}`, 'PUT', { active: true }, T)).status, 200);
});
