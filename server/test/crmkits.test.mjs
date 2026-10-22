// CRM styles (kits): a ready-made industry CRM adds its fields and pipeline and changes the words; quick filters on
// custom fields; money totals per board column; switching keeps every contact and field; AI designs a custom CRM
// (against a fake AI) that's cleaned before use; Hive can switch the style.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { startServer, register } from './helpers.mjs';

let fake, srv, api, T;
const k = (key) => encodeURIComponent(key);
before(async () => {
  fake = http.createServer((req, res) => {
    let b = '';
    req.on('data', (c) => { b += c; });
    req.on('end', () => {
      const text = JSON.stringify({
        name: 'Interior studio', icon: '🛋️', labels: { title: 'Projects', one: 'Project', customers: 'Clients', leads: 'Enquiries', value: 'Design fee' },
        fields: [{ id: 'is_fee', label: 'Design fee (₹)', type: 'money' }, { id: 'is_room', label: 'Rooms', type: 'select', options: ['Kitchen', 'Bedroom', 'Full home'] }, { id: 'is_x', label: 'Hack', type: 'script' }, { label: '' }],
        pipeline: { name: 'Design projects', stages: [{ name: 'Enquiry' }, { name: 'Site measure' }, { name: 'Signed', won: true }, { name: 'Lost', lost: true }] },
        columns: ['is_fee', 'is_room', 'nope'], cardFields: ['is_fee'], filters: ['is_room', 'is_fee'], valueField: 'is_room', showSales: false,
      });
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ output: [{ type: 'message', content: [{ type: 'output_text', text }] }] }));
    });
  }).listen(0);
  await new Promise((r) => setTimeout(r, 30));
  srv = await startServer({ KIE_API_KEY: 'kie-test', KIE_BASE_URL: `http://127.0.0.1:${fake.address().port}` });
  api = srv.api;
  T = (await register(api)).token;
});
after(async () => { await srv?.stop(); fake?.close(); });

test('ready-made: real estate adds its fields and pipeline, filters and money totals work, switching keeps data', async () => {
  const start = (await api('/crm/kits', 'GET', null, T)).data;
  assert.equal(start.current.id, 'general');
  assert.ok(start.kits.length >= 7);
  const r = (await api('/crm/kit', 'POST', { id: 'realestate' }, T)).data;
  assert.equal(r.current.labels.customers, 'Buyers');
  assert.equal(r.current.valueField, 're_budget');
  assert.ok(r.fields.find((x) => x.id === 're_budget' && x.type === 'money'));
  const pipes = (await api('/pipelines', 'GET', null, T)).data;
  const p = pipes.find((x) => x.id === r.current.pipelineId);
  assert.equal(p.name, 'Property sales');
  assert.ok(p.stages.find((s) => s.name === 'Site visit scheduled'));

  for (const [email, budget, bhk] of [['a@example.com', '₹45,00,000', '2 BHK'], ['b@example.com', '8000000', '3 BHK'], ['c@example.com', '5500000', '2 BHK']]) {
    await api('/contacts', 'POST', { email }, T);
    await api(`/contacts/${k(email)}`, 'PATCH', { custom: { re_budget: budget, re_bhk: bhk } }, T);
  }
  const two = (await api(`/contacts?limit=10&sum=re_budget&cf=${k(JSON.stringify({ re_bhk: '2 BHK' }))}`, 'GET', null, T)).data;
  assert.equal(two.total, 2);
  assert.equal(two.totalValue, 10000000, 'rupee formatting stripped, budgets summed');
  assert.equal(two.contacts[0].custom.re_bhk, '2 BHK');
  assert.equal((await api(`/contacts?limit=10&cf=${k(JSON.stringify({ "x') OR 1=1 --": 'y' }))}`, 'GET', null, T)).data.total, 3, 'bad field ids ignored');

  // switch to clinic and back: nothing removed, nothing duplicated
  await api('/crm/kit', 'POST', { id: 'clinic' }, T);
  const back = (await api('/crm/kit', 'POST', { id: 'realestate' }, T)).data;
  assert.equal(back.current.pipelineId, r.current.pipelineId, 'pipeline reused');
  assert.equal(back.fields.filter((x) => x.id === 're_budget').length, 1);
  assert.ok(back.fields.find((x) => x.id === 'cl_doctor'), 'clinic fields kept');
  assert.equal((await api(`/contacts/${k('b@example.com')}`, 'GET', null, T)).data.custom.re_budget, 8000000);
  assert.equal((await api('/crm/kit', 'POST', { id: 'nope' }, T)).status, 400);
});

test('AI designs a custom CRM, cleaned; Hive switches styles', async () => {
  assert.equal((await api('/ai/crm-kit', 'POST', { description: 'hi' }, T)).status, 400);
  const d = (await api('/ai/crm-kit', 'POST', { description: 'Interior design studio in Mumbai, full home projects' }, T)).data;
  assert.equal(d.kit.id, 'custom');
  assert.deepEqual(d.kit.fields.map((x) => [x.id, x.type]), [['is_fee', 'money'], ['is_room', 'select'], ['is_x', 'text']]);
  assert.equal(d.kit.fields[1].options, 'Kitchen, Bedroom, Full home');
  assert.deepEqual(d.kit.columns, ['is_fee', 'is_room']);
  assert.deepEqual(d.kit.filters, ['is_room'], 'only choice fields filter');
  assert.equal(d.kit.valueField, null, 'value field must be money or number');
  assert.equal(d.kit.labels.one, 'project');
  assert.equal((await api('/crm/kits', 'GET', null, T)).data.current.id, 'realestate', 'a design is only a preview');
  const applied = (await api('/crm/kit', 'POST', { kit: d.kit }, T)).data;
  assert.equal(applied.current.name, 'Interior studio');
  assert.ok((await api('/pipelines', 'GET', null, T)).data.find((p) => p.name === 'Design projects'));

  const tok = (await api('/hive/tokens', 'POST', { name: 't' }, T)).data.token;
  const call = async (name, args) => { const r = await (await fetch(`${srv.base}/mcp`, { method: 'POST', headers: { authorization: `Bearer ${tok}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) })).json(); return r.result.isError ? { error: r.result.content[0].text } : JSON.parse(r.result.content[0].text); };
  const h = await call('setup_crm', { style: 'consultant' });
  assert.equal(h.ok, true, JSON.stringify(h));
  assert.equal((await api('/crm/kits', 'GET', null, T)).data.current.id, 'consultant');
  const c = await call('setup_crm', { style: 'custom', description: 'Interior design studio' });
  assert.equal(c.name, 'Interior studio', JSON.stringify(c));
});
