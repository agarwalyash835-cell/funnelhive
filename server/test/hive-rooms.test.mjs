// Team rooms: a chat with several teammates. The one @mentioned answers ("@everyone": all, in order); with no
// mention, the one whose work fits; a teammate hands part of the job to another (ask_teammate) and uses the answer;
// a room's regular task has every member report, then one combined summary. The AI is a local fake that answers
// as whichever teammate it's told it is.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { startServer, register } from './helpers.mjs';

let ai, srv, api, T;
const calls = [];
before(async () => {
  ai = http.createServer((req, res) => {
    let b = '';
    req.on('data', (c) => { b += c; });
    req.on('end', () => {
      const body = JSON.parse(b || '{}');
      const sys = String(body.instructions || ''), input = JSON.stringify(body.input || '');
      const items = Array.isArray(body.input) ? body.input : [];
      const newest = JSON.stringify([...items].reverse().find((x) => x.role === 'user')?.content || ''); // this turn's message, not the history
      const who = /You are working as “([^”]+)”/.exec(sys)?.[1] || (/combine the reports/i.test(sys) ? 'SUMMARY' : 'Hive');
      calls.push(who);
      res.setHeader('content-type', 'application/json');
      const say = (text) => res.end(JSON.stringify({ output: [{ type: 'message', content: [{ type: 'output_text', text }] }] }));
      if (who === 'SUMMARY') return say('Team summary: 2 reports in, nothing waiting for you.');
      // the Marketer hands the poster to the Creative Director, then answers with it
      if (who === 'Marketer' && /poster/i.test(newest) && !/function_call_output/.test(input) && (body.tools || []).some((t) => t.name === 'ask_teammate')) {
        return res.end(JSON.stringify({ output: [{ type: 'function_call', call_id: 'c1', name: 'ask_teammate', arguments: JSON.stringify({ teammate: 'Creative Director', request: 'Make the Diwali poster' }) }] }));
      }
      if (who === 'Marketer' && /function_call_output/.test(input)) return say('Launch plan ready, with the poster from the Creative Director.');
      say(`${who} here: done.`);
    });
  }).listen(0);
  await new Promise((r) => setTimeout(r, 30));
  srv = await startServer({ KIE_API_KEY: 'kie-test', KIE_BASE_URL: `http://127.0.0.1:${ai.address().port}`, KIE_MODEL: 'deepseek-chat' });
  api = srv.api;
  T = (await register(api)).token;
});
after(async () => { await srv.stop(); ai.close(); });

const chat = async (threadId, message) => {
  const r = await fetch(`${srv.base}/api/hive/chat`, { method: 'POST', headers: { authorization: `Bearer ${T}`, 'content-type': 'application/json' }, body: JSON.stringify({ threadId, message }) });
  const text = await r.text();
  assert.equal(r.status, 200, text.slice(0, 300));
  return text.split('\n\n').filter((x) => x.startsWith('data: ')).map((x) => JSON.parse(x.slice(6)));
};
const thread = async (id) => (await api(`/hive/threads/${id}`, 'GET', null, T)).data;
let room, mk, cd, acc;

test('a room needs two or more of your teammates; it shows in the chat list', async () => {
  mk = (await api('/hive/team', 'POST', { preset: 'marketing' }, T)).data;
  cd = (await api('/hive/team', 'POST', { preset: 'creative' }, T)).data;
  acc = (await api('/hive/team', 'POST', { preset: 'accounts' }, T)).data;
  assert.equal((await api('/hive/rooms', 'POST', { name: 'Solo', members: [mk.id] }, T)).status, 400);
  assert.equal((await api('/hive/rooms', 'POST', { name: 'Ghosts', members: [mk.id, 'nobody'] }, T)).status, 400, 'only real teammates count');
  room = (await api('/hive/rooms', 'POST', { name: 'Diwali launch', members: [mk.id, cd.id, acc.id] }, T)).data;
  assert.deepEqual([room.title, room.room.members.length], ['👥 Diwali launch', 3]);
  const list = (await api('/hive/threads', 'GET', null, T)).data;
  assert.equal(list.find((t) => t.id === room.id).room.name, 'Diwali launch');
});

test('@mention picks who answers; with none, the teammate whose work fits answers', async () => {
  let evs = await chat(room.id, '@Accountant how much do customers owe us?');
  assert.deepEqual(evs.filter((e) => e.type === 'reply').map((e) => e.by), [acc.id]);
  evs = await chat(room.id, 'Check the Tally outstanding and payment reminders');
  assert.deepEqual(evs.filter((e) => e.type === 'reply').map((e) => e.by), [acc.id], 'Tally → the Accountant');
  evs = await chat(room.id, 'Make a Reel and a festive poster in Studio');
  assert.deepEqual(evs.filter((e) => e.type === 'reply').map((e) => e.by), [cd.id], 'Studio → the Creative Director');
});

test('@everyone: each member answers in turn, and each answer is saved as theirs', async () => {
  const evs = await chat(room.id, '@everyone quick update please');
  assert.deepEqual(evs.filter((e) => e.type === 'reply').map((e) => e.by), [mk.id, cd.id, acc.id]);
  const t = await thread(room.id);
  assert.deepEqual(t.messages.slice(-3).map((m) => m.by), [mk.id, cd.id, acc.id]);
});

test('a teammate hands part of the job to another and uses the answer', async () => {
  calls.length = 0;
  const evs = await chat(room.id, '@Marketer plan the Diwali launch with a poster');
  const replies = evs.filter((e) => e.type === 'reply');
  assert.deepEqual(replies.map((e) => e.by), [cd.id, mk.id], 'the Creative Director’s answer comes first, then the Marketer’s');
  assert.match(replies[1].text, /poster from the Creative Director/);
  assert.ok(evs.some((e) => e.type === 'thinking' && /Marketer asked Creative Director/.test(e.text)));
  assert.ok(calls.includes('Creative Director'));
  const tools = (await thread(room.id)).messages.at(-1).tools.map((x) => x.name);
  assert.ok(tools.includes('ask_teammate'));
  assert.ok(!(await thread(room.id)).pending?.some((p) => p.name === 'ask_teammate'), 'a hand-off never waits for a Confirm');
});

test('the room’s regular task: every member reports, then one combined summary', async () => {
  const r = await api(`/hive/rooms/${room.id}`, 'PUT', { schedule: { on: true, time: '09:30', days: [1, 2, 3, 4, 5], task: 'Morning stand-up: what you did and what needs the owner' } }, T);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.room.schedule.on, true);
  assert.equal((await api(`/hive/rooms/${room.id}/run`, 'POST', null, T)).status, 200);
  let t;
  for (let i = 0; i < 60; i++) { t = await thread(room.id); if (t.messages.at(-1)?.by === 'summary') break; await new Promise((x) => setTimeout(x, 100)); }
  const last = t.messages.slice(-5);
  assert.match(last[0].text, /Morning stand-up/);
  assert.deepEqual(last.slice(1).map((m) => m.by), [mk.id, cd.id, acc.id, 'summary']);
  assert.match(last[4].text, /Team summary/);
});
