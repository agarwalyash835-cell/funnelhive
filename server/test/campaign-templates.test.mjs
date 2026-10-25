// Campaign templates: the library is complete and valid for every industry (WhatsApp rules included); using one
// makes a draft on the chosen channel; details only the seller knows block sending until filled; Build with AI
// writes a new one in the same format, and an answer that breaks WhatsApp's rules is sent back to be fixed.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { startServer, register } from './helpers.mjs';
import { catalog, problemsOf } from '../campaigntpl.js';

let srv, api, T, fake, calls = 0;
const AI = (wabody) => ({
  name: 'Weekend batch reminder', goal: 'Fill the weekend batch', when: 'A week before the batch starts', audience: { type: 'leads' },
  email: { subject: '{{first_name}}, our weekend batch starts soon', body: `Hi {{first_name}},\n\nOur weekend batch starts on [batch start date] and a few seats are still open. Classes run on Saturdays and Sundays, so you can learn without missing school or work.\n\nCome for a free demo class first and meet the faculty — there is no fee and no obligation.\n\nBook your demo here: [link]\n\nWarm regards,\nTeam {{business}}` },
  whatsapp: { name: 'edu_weekend_batch_ai', category: 'MARKETING', body: wabody, vars: [{ key: 'first_name', example: 'Riya' }, { fill: 'Batch start date', example: '5 May' }], footer: 'Reply STOP to opt out' },
  call: { goal: 'Book a demo class', opening: 'Namaste {{customer_name}}, this is {{business_name}} calling about our weekend batch.', script: ['Our weekend batch is starting soon.', 'It suits students who study on weekdays.', 'We are offering a free demo class.'], questions: ['Are you free on weekends?', 'Which subject do you need help with?'], objections: [{ said: 'Fees are high', reply: 'We have instalments.' }, { said: 'I will think about it', reply: 'Shall I book a free demo so you can decide?' }], closing: 'I have noted it — you will get the details on WhatsApp.', outcomes: ['booked_demo', 'callback', 'not_interested'], variables: ['customer_name', 'business_name'] },
});
before(async () => {
  fake = http.createServer((req, res) => {
    let b = ''; req.on('data', (c) => { b += c; });
    req.on('end', () => {
      calls++;
      // first answer breaks a WhatsApp rule (ends with a variable); the second is fixed
      const t = calls === 1 ? AI('Hi {{1}}, our weekend batch starts on {{2}}') : AI('Hi {{1}}, our weekend batch starts on {{2}}. Reply YES for a free demo class this week.');
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(t) }] }] }));
    });
  }).listen(0);
  await new Promise((r) => setTimeout(r, 30));
  srv = await startServer({ KIE_API_KEY: 'kie-test', KIE_BASE_URL: `http://127.0.0.1:${fake.address().port}` });
  api = srv.api;
  T = (await register(api)).token;
  await api('/crm/kit', 'POST', { id: 'education' }, T);
});
after(async () => { await srv.stop(); fake.close(); });

test('the library: 20 industries, 7 occasions each, every template passes the rules', async () => {
  const { byIndustry, errors } = await catalog({ fresh: true });
  assert.deepEqual(errors, []);
  assert.equal(Object.keys(byIndustry).length, 20);
  for (const [ind, list] of Object.entries(byIndustry)) assert.equal(list.length, 7, ind);
  const all = Object.values(byIndustry).flat();
  assert.equal(new Set(all.map((t) => t.whatsapp.name)).size, all.length, 'WhatsApp names are unique');
  assert.ok(all.some((t) => t.whatsapp.category === 'UTILITY') && all.some((t) => t.whatsapp.category === 'MARKETING'));
});

test('your industry comes first; using a template makes a draft on each channel', async () => {
  const d = (await api('/campaign-templates', 'GET', null, T)).data;
  assert.equal(d.industry, 'education');
  assert.equal(d.industries[0].id, 'education');
  const id = d.templates.find((t) => t.industry === 'education').id;
  const full = (await api(`/campaign-templates/${id}`, 'GET', null, T)).data;
  assert.ok(full.email.body && full.whatsapp.body && full.callScript.includes('Opening:'));
  // email
  const e = (await api('/campaign-templates/use', 'POST', { id, channel: 'email' }, T)).data;
  const eb = (await api(`/broadcasts/${e.id}`, 'GET', null, T)).data;
  assert.deepEqual([eb.channel, eb.subject, eb.status], ['email', full.email.subject, 'draft']);
  // a detail only the seller knows blocks sending
  if (/\[[^\]]+\]/.test(full.email.subject + full.email.body)) assert.match((await api(`/broadcasts/${e.id}/send`, 'POST', {}, T)).data.error, /^Fill in \[/);
  // WhatsApp: the template name and its variables, ready to submit to Meta
  const w = (await api('/campaign-templates/use', 'POST', { id, channel: 'whatsapp' }, T)).data;
  assert.equal(w.submit.name, full.whatsapp.name);
  assert.equal(w.submit.samples.length, full.whatsapp.vars.length);
  const wb = (await api(`/broadcasts/${w.id}`, 'GET', null, T)).data;
  assert.equal(wb.wa.template, full.whatsapp.name);
  assert.match(wb.wa.params, /^\{\{first_name\}\}/);
  // AI call: a calling campaign draft with its variables mapped and the script attached
  const c = (await api('/campaign-templates/use', 'POST', { id, channel: 'call' }, T)).data;
  const cb = (await api(`/voice/campaigns/${c.id}`, 'GET', null, T)).data;
  assert.deepEqual(cb.vars.find((v) => v.agent === 'customer_name'), { agent: 'customer_name', field: 'first_name' });
  assert.ok(cb.script.includes('Opening:'));
});

test('Build with AI: a campaign in the same format; an answer breaking WhatsApp’s rules is fixed first', async () => {
  const r = await api('/campaign-templates/ai', 'POST', { brief: 'Remind last month’s enquiries that the weekend batch starts soon' }, T);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(calls, 2, 'asked again after the first answer broke a rule');
  assert.equal(problemsOf(r.data), '');
  assert.match(r.data.whatsapp.body, /Reply YES/);
  const u = (await api('/campaign-templates/use', 'POST', { template: r.data, channel: 'email' }, T)).data;
  assert.equal((await api(`/broadcasts/${u.id}`, 'GET', null, T)).data.name, 'Weekend batch reminder');
  // a broken template from the page is refused
  assert.equal((await api('/campaign-templates/use', 'POST', { template: { ...r.data, whatsapp: { ...r.data.whatsapp, body: '{{1}} hi' } }, channel: 'email' }, T)).status, 400);
  assert.equal((await api('/campaign-templates/ai', 'POST', { brief: 'hi' }, T)).status, 400);
});
