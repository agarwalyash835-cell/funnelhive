// Hive AI: the chat agent (scripted fake model doing real tool calls) and the MCP server.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { startServer, register } from './helpers.mjs';

let fake, srv, api, T;
const lastOutput = (input) => { const o = [...input].reverse().find((x) => x.type === 'function_call_output'); return o ? JSON.parse(o.output.replace(/…\(truncated\)$/, '')) : null; };
const call = (name, args) => ({ status: 'completed', output: [{ type: 'function_call', call_id: `call_${Math.random().toString(36).slice(2)}`, name, arguments: JSON.stringify(args) }] });
const say = (text) => ({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text }] }] });

// A tiny "model": decides the next tool from the conversation so far
function brain(body) {
  if (!body.tools) return say('not json'); // funnel generation request → forces the template fallback
  const input = body.input;
  const user = [...input].reverse().find((x) => x.role === 'user')?.content || '';
  const calls = input.filter((x) => x.type === 'function_call').map((x) => x.name);
  const out = lastOutput(input);
  if (/coupon/i.test(user)) return calls.includes('create_coupon') ? say('Created **HIVE20** — 20% off.') : call('create_coupon', { code: 'HIVE20', type: 'percent', value: 20 });
  if (/build/i.test(user)) {
    if (!calls.length) return call('create_funnel', { brief: 'Yoga studio in Pune, ₹999' });
    if (calls.at(-1) === 'create_funnel') return call('get_page', { funnelId: out.id, stepId: out.steps[0].id, _f: out.id });
    if (calls.at(-1) === 'get_page') {
      const hero = out.sections.find((s) => s.type === 'hero');
      const fid = input.find((x) => x.name === 'get_page') && JSON.parse(input.find((x) => x.name === 'get_page').arguments).funnelId;
      return call('update_section', { funnelId: fid, stepId: out.step.id, sectionId: hero.id, props: { headline: 'Hive built this *in one chat*' } });
    }
    if (calls.at(-1) === 'update_section') return call('create_automation', { name: 'Welcome', trigger: { type: 'lead' }, steps: [{ type: 'wait', amount: 1, unit: 'hours' }, { type: 'email', subject: 'Welcome {{first_name}}', body: 'Hi!' }], activate: true });
    return say('Your funnel is ready:\n- 5 pages\n- new headline\n- welcome automation is on');
  }
  if (/go live with/i.test(user)) return calls.length ? say('Press Confirm to make it live.') : call('publish_funnel', { funnelId: user.split(' ').pop() });
  if (/missing/i.test(user)) return calls.length ? say('That page does not exist.') : call('get_page', { funnelId: 'nope', stepId: 'x' });
  return say('Hello! Tell me what you sell and I will build your funnel.');
}

before(async () => {
  fake = http.createServer((req, res) => { let b = ''; req.on('data', (c) => { b += c; }); req.on('end', () => { res.setHeader('content-type', 'application/json'); let out; if (b.includes('explode please')) { res.writeHead(500); return res.end('{"error":{"message":"model down"}}'); } try { out = brain(JSON.parse(b || '{}')); } catch (e) { out = say(`fake model error: ${e.message}`); } res.end(JSON.stringify(out)); }); }).listen(0);
  await new Promise((r) => setTimeout(r, 30));
  srv = await startServer({ KIE_API_KEY: 'kie-test', KIE_BASE_URL: `http://127.0.0.1:${fake.address().port}` });
  api = srv.api;
  T = (await register(api)).token;
});
after(async () => { await srv.stop(); fake.close(); });

async function chat(body, token = T) {
  const r = await fetch(`${srv.base}/api/hive/chat`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const text = await r.text();
  return { status: r.status, events: text.split('\n\n').filter((x) => x.startsWith('data: ')).map((x) => JSON.parse(x.slice(6))) };
}

test('Hive builds a funnel end to end by chatting: funnel → edit → automation', async () => {
  assert.equal((await api('/hive/status', 'GET', null, T)).data.ready, true);
  const { status, events } = await chat({ message: 'Build me a funnel for my yoga studio' });
  assert.equal(status, 200);
  const tools = events.filter((e) => e.type === 'tool' && e.status !== 'running');
  // switching on an automation (it messages real contacts) waits for the seller's Confirm
  assert.deepEqual(tools.map((e) => [e.name, e.status]), [['create_funnel', 'done'], ['get_page', 'done'], ['update_section', 'done'], ['create_automation', 'confirm']]);
  const reply = events.find((e) => e.type === 'reply');
  assert.ok(reply.funnelId, 'the preview follows the funnel being built');
  const f = (await api(`/funnels/${reply.funnelId}`, 'GET', null, T)).data;
  assert.equal(f.steps.length, 5);
  assert.equal(f.steps[0].blocks.find((b) => b.type === 'hero').props.headline, 'Hive built this *in one chat*');
  assert.ok(!(await api('/automations', 'GET', null, T)).data.automations.some((a) => a.name === 'Welcome'), 'nothing switched on yet');
  const threads = (await api('/hive/threads', 'GET', null, T)).data;
  assert.equal(threads.length, 1);
  const pendingId = reply.tools.find((x) => x.name === 'create_automation').pending;
  const ok = await api(`/hive/threads/${threads[0].id}/confirm`, 'POST', { pendingId }, T);
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  assert.equal((await api(`/hive/threads/${threads[0].id}/confirm`, 'POST', { pendingId }, T)).status, 404, 'a second click does nothing');
  const autos = (await api('/automations', 'GET', null, T)).data.automations;
  assert.ok(autos.some((a) => a.name === 'Welcome' && a.active), 'automation created and switched on after Confirm');
  const t = (await api(`/hive/threads/${threads[0].id}`, 'GET', null, T)).data;
  assert.deepEqual(t.messages.map((m) => m.role), ['user', 'assistant', 'assistant']);
  assert.equal(t.messages[1].tools.length, 4);
  assert.equal(t.messages[1].tools[3].resolved, 'done');
  // follow-up in the same thread
  const again = await chat({ threadId: threads[0].id, message: 'make a coupon' });
  assert.match(again.events.find((e) => e.type === 'reply').text, /HIVE20/);
  assert.ok((await api('/coupons', 'GET', null, T)).data.some((c) => c.code === 'HIVE20'));
});

test('a broadcast or publish the model asks for never runs without the seller’s Confirm; Cancel drops it', async () => {
  const fid = (await api('/funnels', 'GET', null, T)).data[0].id;
  const { events } = await chat({ message: `go live with ${fid}` });
  const tool = events.find((e) => e.type === 'tool' && e.name === 'publish_funnel' && e.status !== 'running');
  assert.equal(tool.status, 'confirm');
  assert.equal((await api(`/funnels/${fid}`, 'GET', null, T)).data.published, false, 'still offline');
  const tid = events.find((e) => e.type === 'thread').threadId;
  const r = (await api(`/hive/threads/${tid}/confirm`, 'POST', { pendingId: tool.pending, ok: false }, T)).data;
  assert.equal(r.cancelled, true);
  assert.equal((await api(`/funnels/${fid}`, 'GET', null, T)).data.published, false, 'cancelled: still offline');
  const other = (await register(api)).token;
  assert.equal((await api(`/hive/threads/${tid}/confirm`, 'POST', { pendingId: tool.pending }, other)).status, 404, 'nobody else can confirm it');
});

test('a chat whose AI call fails costs no credits; a working one costs one', async () => {
  const used = async () => (await api('/billing', 'GET', null, T)).data.credits.used;
  const before = await used();
  const bad = await chat({ message: 'explode please' });
  assert.ok(bad.events.some((e) => e.type === 'error'));
  assert.equal(await used(), before, 'nothing charged for the failure');
  await chat({ message: 'hello' });
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(await used(), before + 1);
});

test('tool errors are reported to the model and the user, not thrown', async () => {
  const { events } = await chat({ message: 'open the missing page' });
  const tool = events.find((e) => e.type === 'tool' && e.status === 'error');
  assert.equal(tool.name, 'get_page');
  assert.match(tool.summary, /failed/);
  assert.equal(events.find((e) => e.type === 'reply').text, 'That page does not exist.');
});

test('Hive only touches the signed-in seller’s own data', async () => {
  const other = (await register(api)).token;
  const mine = (await api('/funnels', 'GET', null, T)).data[0];
  assert.equal((await api(`/hive/threads/${(await api('/hive/threads', 'GET', null, T)).data[0].id}`, 'GET', null, other)).status, 404);
  const mcp = (await api('/hive/tokens', 'POST', { name: 'other' }, other)).data.token;
  const r = await fetch(`${srv.base}/mcp`, { method: 'POST', headers: { authorization: `Bearer ${mcp}`, 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'get_funnel', arguments: { funnelId: mine.id } } }) });
  const d = await r.json();
  assert.equal(d.result.isError, true, 'someone else’s funnel is not reachable');
});

const rpc = (token, body) => fetch(`${srv.base}/mcp`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: JSON.stringify(body) });

test('MCP server: tokens, initialize, tools/list, tools/call', async () => {
  assert.equal((await rpc('nope', { jsonrpc: '2.0', id: 1, method: 'initialize' })).status, 401);
  const tok = (await api('/hive/tokens', 'POST', { name: 'Claude Desktop' }, T)).data;
  assert.match(tok.token, /^ffmcp_[0-9a-f]{48}$/);
  const list = (await api('/hive/tokens', 'GET', null, T)).data;
  assert.ok(!JSON.stringify(list).includes(tok.token), 'token shown once, stored hashed');
  const init = await (await rpc(tok.token, { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } } })).json();
  assert.equal(init.result.serverInfo.name, 'funnelhive-hive');
  assert.ok(init.result.capabilities.tools);
  assert.equal((await rpc(tok.token, { jsonrpc: '2.0', method: 'notifications/initialized' })).status, 202);
  const tools = (await (await rpc(tok.token, { jsonrpc: '2.0', id: 2, method: 'tools/list' })).json()).result.tools;
  for (const n of ['create_funnel', 'update_section', 'add_step', 'create_automation', 'publish_funnel', 'create_coupon']) assert.ok(tools.some((t) => t.name === n && t.inputSchema?.type === 'object'), n);
  const made = await (await rpc(tok.token, { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'create_coupon', arguments: { code: 'MCP15', type: 'percent', value: 15 } } })).json();
  assert.equal(made.result.isError, undefined);
  assert.ok((await api('/coupons', 'GET', null, T)).data.some((c) => c.code === 'MCP15'));
  const bad = await (await rpc(tok.token, { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'create_coupon', arguments: { code: 'BAD', type: 'percent', value: 500 } } })).json();
  assert.equal(bad.result.isError, true, 'platform validation applies to MCP too');
  assert.match(bad.result.content[0].text, /at most 100%/);
  const funnels = await (await rpc(tok.token, { jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'list_funnels', arguments: {} } })).json();
  assert.ok(JSON.parse(funnels.result.content[0].text).length >= 1);
  assert.equal((await (await rpc(tok.token, { jsonrpc: '2.0', id: 6, method: 'nope' })).json()).error.code, -32601);
  await api(`/hive/tokens/${tok.id}`, 'DELETE', null, T);
  assert.equal((await rpc(tok.token, { jsonrpc: '2.0', id: 7, method: 'ping' })).status, 401, 'revoked tokens stop working');
});
